// Cloud saves via the Dead District server (stored in Postgres/Neon there).
// Each device gets a random save code (e.g. K7QX-9MZD-2HPA); entering the same code
// on another device continues the same save. Everything degrades to local-only
// storage when the server is unreachable.

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const b = new Uint8Array(12);
  (self.crypto || window.crypto).getRandomValues(b);
  let s = '';
  for (let i = 0; i < 12; i++) { s += ALPHA[b[i] % ALPHA.length]; if (i === 3 || i === 7) s += '-'; }
  return s;
}
export const CODE_RE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){2}$/;

export class Cloud {
  constructor(settings) {
    this.settings = settings;
    let c = null;
    try { c = localStorage.getItem('dd_cloud_code'); } catch (e) { /* private mode */ }
    if (!c || !CODE_RE.test(c)) { c = newCode(); try { localStorage.setItem('dd_cloud_code', c); } catch (e) { /* */ } }
    this.code = c;
    this.base = null; // resolved server origin, or false if unavailable
    this.lastPut = {};
    this.status = 'checking';
  }
  setCode(c) {
    c = String(c || '').trim().toUpperCase();
    if (!CODE_RE.test(c)) return false;
    this.code = c;
    try { localStorage.setItem('dd_cloud_code', c); } catch (e) { /* */ }
    return true;
  }
  candidates() {
    const out = [];
    const s = this.settings.server;
    if (s) out.push(s.replace(/^ws/, 'http').replace(/\/$/, ''));
    out.push(location.origin);
    if (location.port === '5173' || location.port === '4173') out.push(`${location.protocol}//${location.hostname}:8787`);
    return [...new Set(out)];
  }
  // Finds a Dead District server that answers /health.
  async resolve() {
    if (this.base !== null) return this.base;
    for (const b of this.candidates()) {
      try {
        const r = await fetchT(`${b}/health`, {}, 3000);
        if (r.ok) { const j = await r.json(); if (j.game === 'dead-district') { this.base = b; this.status = j.saves === 'postgres' ? 'online' : 'online (server has no database)'; return b; } }
      } catch (e) { /* try next */ }
    }
    this.base = false; this.status = 'offline';
    return false;
  }
  async load(slot) {
    const b = await this.resolve();
    if (!b) return null;
    try {
      const r = await fetchT(`${b}/api/save/${this.code}/${slot}`, {}, 6000);
      if (!r.ok) return null;
      const j = await r.json();
      return j.data || null;
    } catch (e) { return null; }
  }
  // Throttled upload; force=true bypasses the throttle (sleep, quit, objective done).
  async save(slot, data, force = false) {
    const now = Date.now();
    if (!force && now - (this.lastPut[slot] || 0) < 20000) return false;
    this.lastPut[slot] = now;
    const b = await this.resolve();
    if (!b) return false;
    try {
      const r = await fetchT(`${b}/api/save/${this.code}/${slot}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: this.settings.name || '', data }), keepalive: JSON.stringify(data).length < 60000 }, 8000);
      this.status = r.ok ? 'online' : `error ${r.status}`;
      return r.ok;
    } catch (e) { this.status = 'offline'; return false; }
  }
}

function fetchT(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}
