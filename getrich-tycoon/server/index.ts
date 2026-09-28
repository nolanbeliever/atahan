// Production/dev entry point.

import { createLogger } from './logger';
import { createServer } from './main';

const log = createLogger('main');

createServer()
  .then((server) => {
    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log.info('shutting down', { signal });
      const force = setTimeout(() => process.exit(1), 10_000);
      force.unref();
      server
        .close()
        .then(() => process.exit(0))
        .catch((err) => {
          log.error('shutdown failed', { error: (err as Error).message });
          process.exit(1);
        });
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  })
  .catch((err) => {
    log.error('failed to start server', { error: (err as Error).message });
    process.exit(1);
  });

process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', { error: reason instanceof Error ? reason.message : String(reason) });
});
