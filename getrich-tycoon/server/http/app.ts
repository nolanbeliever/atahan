// Express application: security headers, auth API, health check, static client.

import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AuthService } from '../auth';
import type { ServerConfig } from '../config';
import { GameError } from '../errors';
import { createLogger } from '../logger';
import { KeyedRateLimiter } from '../rateLimit';

const log = createLogger('http');

export interface HealthInfo {
  db: string;
  online: () => number;
  /** Called after a logout so open game sockets of that player are closed. */
  onLogout?: (playerId: string) => void;
}

export function createApp(cfg: ServerConfig, auth: AuthService, health: HealthInfo): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy ? 1 : false);

  const wsOrigins = cfg.corsOrigins.map((o) => o.replace(/^http/, 'ws')).join(' ');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        `connect-src 'self' ws: wss: ${cfg.corsOrigins.join(' ')} ${wsOrigins}`.trim(),
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    if (cfg.env === 'production') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });

  if (cfg.corsOrigins.length > 0) {
    app.use('/api', (req, res, next) => {
      const origin = req.headers.origin;
      if (origin && cfg.corsOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      }
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  app.use('/api', express.json({ limit: '4kb' }));

  const authLimiter = new KeyedRateLimiter(cfg.authRatePerMinute, cfg.authRatePerMinute / 60);
  const limit = (req: Request, res: Response, next: NextFunction) => {
    if (!authLimiter.take(req.ip ?? 'unknown')) {
      res.status(429).json({ ok: false, error: 'Too many attempts. Please wait a minute.' });
      return;
    }
    next();
  };

  const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      const body = (await fn(req)) as object;
      res.json({ ok: true, ...body });
    } catch (err) {
      if (err instanceof GameError) {
        const status = err.code === 'conflict' ? 409 : err.code === 'forbidden' ? 401 : 400;
        res.status(status).json({ ok: false, error: err.message });
        return;
      }
      log.error('auth request failed', { error: (err as Error).message });
      res.status(500).json({ ok: false, error: 'Server error. Please try again.' });
    }
  };

  // Account creation is additionally capped per IP and globally per hour (alt-account farming, scrypt CPU).
  const registerIp = new KeyedRateLimiter(cfg.registerPerHour, cfg.registerPerHour / 3600);
  const registerGlobal = new KeyedRateLimiter(cfg.registerGlobalPerHour, cfg.registerGlobalPerHour / 3600);
  const registerLimit = (req: Request, res: Response, next: NextFunction) => {
    if (!registerIp.take(req.ip ?? 'unknown') || !registerGlobal.take('all')) {
      res.status(429).json({ ok: false, error: 'Too many new accounts right now. Please try again later.' });
      return;
    }
    next();
  };

  app.post('/api/auth/register', limit, registerLimit, handle((req) => auth.register(req.body?.name, req.body?.password)));
  app.post('/api/auth/login', limit, handle((req) => auth.login(req.body?.name, req.body?.password)));
  app.post(
    '/api/auth/logout',
    handle(async (req) => {
      if (typeof req.body?.token === 'string') {
        const playerId = await auth.logout(req.body.token);
        if (playerId) health.onLogout?.(playerId);
      }
      return {};
    }),
  );

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()), online: health.online(), db: health.db });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  // Malformed JSON bodies etc. Never leak stack traces.
  app.use((err: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err.status && err.status < 500) {
      res.status(err.status).json({ ok: false, error: 'Bad request' });
      return;
    }
    log.error('http error', { error: err.message });
    res.status(500).json({ ok: false, error: 'Server error' });
  });

  const indexFile = path.join(cfg.clientDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use('/assets', express.static(path.join(cfg.clientDir, 'assets'), { immutable: true, maxAge: '365d', fallthrough: false }));
    app.use(express.static(cfg.clientDir, { index: false, maxAge: '1h' }));
    app.get('/', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('text/plain')
        .send('GetRich Tycoon server is running. The client is not built: run `npm run build` or use `npm run dev` (Vite on :5173).');
    });
  }
  return app;
}
