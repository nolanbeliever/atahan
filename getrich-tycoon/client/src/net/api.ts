// HTTP API (authentication) and server URL configuration.

const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim().replace(/\/$/, '') ?? '';

/** Base URL of the game server ('' = same origin as the page). */
export function serverUrl(): string {
  return configured;
}

export interface AuthResult {
  token: string;
  playerId: string;
  name: string;
}

export async function authRequest(kind: 'login' | 'register', name: string, password: string): Promise<AuthResult> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}/api/auth/${kind}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
  } catch {
    throw new Error('Cannot reach the game server. Check your connection and try again.');
  }
  let body: { ok?: boolean; error?: string } & Partial<AuthResult> = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || !body.ok) throw new Error(body.error ?? `Server error (${res.status}).`);
  return { token: body.token!, playerId: body.playerId!, name: body.name! };
}

export async function logoutRequest(token: string): Promise<void> {
  try {
    await fetch(`${serverUrl()}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    /* ignore */
  }
}

const TOKEN_KEY = 'getrich.token';

export const session = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};
