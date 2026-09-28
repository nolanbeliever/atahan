# Security

## Threat model

The browser is **untrusted**. A player can modify the client, replay or forge packets, run several accounts, and
send requests concurrently. The server therefore owns every piece of state that matters: money, bank, ownership,
prices, inventory, XP and levels, dealership ownership and levels, auction state and positions. Clients send
*intentions* (inputs and RPCs with IDs and numbers). The server validates them and decides the outcome.

## Protections

### Authentication
- Accounts are a name plus password. Passwords are hashed with **scrypt** (N=16384, r=8, p=1, 16-byte random salt) and
  compared in constant time.
- A login with an unknown name still performs a hash, so response timing doesn't reveal which names exist.
- Session tokens are 256-bit random values. Only their **SHA-256 hash** is stored. They expire after 30 days, and logout deletes them.
- Sockets must present a valid token during the handshake or the connection is refused. A second login kicks the old socket.
- Login and registration are rate limited per IP (`AUTH_RATE_PER_MINUTE`, default 10/min).

### Input validation
- Every RPC parameter is checked by strict validators (`server/validate.ts`):
  - IDs must match `[A-Za-z0-9_-]{1,64}`;
  - numbers must be finite integers within bounds (no negative, NaN, float or huge values);
  - enums are whitelisted;
  - customization options must exist in the catalog.
- Unknown RPC methods are rejected, and malformed packets are ignored.
- Socket.IO `maxHttpBufferSize` is 32 KB and HTTP JSON bodies are capped at 4 KB.

### Transaction integrity
- Keyed locks per player, vehicle, listing, plot and auction serialize conflicting actions. Keys are acquired in sorted
  order, so two actions can't deadlock.
- Each action commits in **one ACID database transaction**, and memory is updated only after the commit succeeds.
- The database enforces `CHECK (money >= 0)`, `CHECK (bank >= 0)`, a unique `(plot_id, slot)` index, one dealership per
  owner and one listing per vehicle.
- Purchases carry an `expectedPrice`. The server recomputes the price and rejects a mismatch, so a client can never set a
  price and a buyer is never charged more than they saw.
- Request-ID de-duplication stops retried or duplicated packets from executing twice.
- The race tests (`tests/integration/core.test.ts`) prove only one of two simultaneous buyers can win a car.
- Auction bids are escrowed: debited immediately and refunded when outbid. Sellers can't bid on their own auctions.
- Vehicles that are being driven, in the shop, listed or at auction can't be sold, moved or modified.

### Anti-cheat for movement
- Movement comes from key bitmasks, not positions. The server simulates with the shared physics and enforces a real-time
  budget (speed-hack protection), `dt` limits, collisions and world bounds.
- Proximity to a location (bank, garage, auction house, your own lot) is checked against the server's own position of the
  player, with some slack for latency.

### Abuse limits
- Rate limits: RPC 12/s (burst 30), input 40 msg/s, chat 5 messages then 0.5/s, with a 10 s mute when spamming and
  duplicate-message suppression.
- At most 12 simultaneous sockets per IP.
- Asking prices are capped at 2.5 × market value, and trades pay a commission. This limits money transfer between
  alternate accounts.

### XSS and injection
- The UI inserts player-controlled strings (names, chat, dealership names) only with `textContent`. Name tags and signs are
  drawn to a canvas. `innerHTML` is used only for static, bundled SVG icons.
- All SQL uses parameterized queries. There is no string-built SQL with user data.
- A strict **Content Security Policy** is in place (`script-src 'self'`, no `object-src`, `frame-ancestors 'none'`), along with
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and HSTS in production.
- Dealership names and chat are sanitized: control and bidi characters are stripped, whitespace collapsed and length limited.

### Secrets and errors
- Credentials come only from environment variables. `.env` is git-ignored and `.env.example` contains placeholders.
- `npm run check:secrets` scans tracked files for credentials.
- Clients receive only friendly error messages. Unexpected errors are logged server-side (message only, without stack
  traces or secrets) and reported to the client as "Something went wrong".
- Logs never include passwords, tokens or connection strings.

## Known limitations

- There is no e-mail verification, password reset or CAPTCHA. Registration is limited only by rate. Consider adding
  CAPTCHA or proof-of-work if bots become a problem.
- The per-IP limits rely on `X-Forwarded-For` when `TRUST_PROXY=true`. Only enable it behind a proxy that overwrites the header.
- Tokens are stored in `localStorage`. The strict CSP and the absence of dynamic HTML reduce the XSS risk, but
  HttpOnly-cookie sessions would be stronger.
- The in-memory world and single-process locks assume one server instance (see ARCHITECTURE.md).

## Reporting

Please report vulnerabilities privately to the repository owner instead of opening a public issue.
