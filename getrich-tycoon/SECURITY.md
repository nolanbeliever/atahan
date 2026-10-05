# Security

## Threat model

The browser is **untrusted**. A player can modify the client, replay or forge packets, run several accounts, and
send requests concurrently. The server therefore owns every piece of state that matters: money, bank, ownership,
prices, inventory, XP and levels, dealership ownership and levels, auction state and positions. Clients send
*intentions* (inputs and RPCs with IDs and numbers). The server validates them and decides the outcome.

## Protections

### Authentication
- Accounts are a name plus password. Passwords are hashed with **scrypt** (N=32768, r=8, p=1, 16-byte random salt) and
  compared in constant time. OWASP suggests N=2^17, which needs 128 MB per hash and is too heavy for a 512 MB free-tier
  instance. Existing hashes keep their own parameters.
- A login with an unknown name still performs a hash, so response timing doesn't reveal which names exist.
- Session tokens are 256-bit random values. Only their **SHA-256 hash** is stored. They expire after 30 days, and logout deletes them.
- Sockets must present a valid token during the handshake or the connection is refused. A second login kicks the old
  socket, and logging out disconnects any open game socket.
- Login and registration are rate limited per IP (`AUTH_RATE_PER_MINUTE`, default 10/min).
- Account creation is further capped per IP (`REGISTER_PER_HOUR`, default 10) and server-wide
  (`REGISTER_GLOBAL_PER_HOUR`, default 500).
- Socket handshakes are rate limited per IP.

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
- RPC and chat limits are tracked **per player**, so reconnecting does not reset them.
- At most 12 simultaneous sockets per IP. The slot is reserved during the handshake, so parallel handshakes can't overshoot.
- The leaderboard, which is expensive to compute, is cached for 15 s.
- Alternate-account farming: see "Anti-exploit rules" in ECONOMY.md. In short:
  - price floors and caps;
  - level 3 required to buy from players;
  - no XP or achievements from player-to-player sales;
  - registration caps.
- Asking prices **and auction bids** are capped at 2.5 × market value, and trades pay a commission. This limits money
  transfer between alternate accounts.
- Auction settlement re-checks the end time and the current leader after acquiring its locks, so a last-second
  (anti-sniping) bid can't be settled early.
- Connection setup is serialized per account, so two simultaneous logins can't both register a session.

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
- With `TRUST_PROXY=true` (automatic on Render), per-IP limits walk `X-Forwarded-For` from the right, skip private
  addresses (load balancers) and at most one Cloudflare edge, and use the first remaining entry. Entries further left
  are client-supplied and are never reached. A request relayed through a Cloudflare Worker is keyed on the Worker's
  address. The setting is off elsewhere by default. Enable it only when clients can't reach the server port directly.
- On Render the server refuses to start without `DATABASE_URL`, so a missing setting can't silently fall back to the
  ephemeral SQLite file.
- A determined attacker with many IP addresses can still create alternate accounts. The trading rules make that
  unprofitable rather than impossible.
- Tokens are stored in `localStorage`. The strict CSP and the absence of dynamic HTML reduce the XSS risk, but
  HttpOnly-cookie sessions would be stronger.
- The in-memory world and single-process locks assume one server instance (see ARCHITECTURE.md).

## Reporting

Please report vulnerabilities privately to the repository owner instead of opening a public issue.
