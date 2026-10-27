// Player inventory: stacked slots, weapon hotbar and loaded magazines.
import { ITEMS, isWeapon } from '../shared/items.js';

export const MAX_SLOTS = 18;

export class Inventory {
  constructor() {
    this.slots = []; // {id, n}
    this.mag = {}; // weapon id -> rounds loaded
    this.equipped = 'fists';
    this.onChange = null;
  }
  count(id) { let n = 0; for (const s of this.slots) if (s.id === id) n += s.n; return n; }
  has(id) { return this.count(id) > 0; }
  weapons() { return ['fists', ...this.slots.filter(s => isWeapon(s.id)).map(s => s.id)]; }
  // returns how many could NOT be added
  add(id, n = 1) {
    const def = ITEMS[id];
    if (!def) return n;
    let left = n;
    if (def.stack > 1) for (const s of this.slots) {
      if (s.id !== id || s.n >= def.stack) continue;
      const k = Math.min(def.stack - s.n, left); s.n += k; left -= k;
      if (!left) break;
    }
    while (left > 0 && this.slots.length < MAX_SLOTS) {
      const k = Math.min(def.stack, left);
      this.slots.push({ id, n: k }); left -= k;
      if (isWeapon(id) && def.type === 'gun' && this.mag[id] === undefined) this.mag[id] = 0;
    }
    this.changed();
    return left;
  }
  remove(id, n = 1) {
    let left = n;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s.id !== id) continue;
      const k = Math.min(s.n, left); s.n -= k; left -= k;
      if (s.n <= 0) this.slots.splice(i, 1);
    }
    if (isWeapon(id) && !this.has(id)) { if (this.equipped === id) this.equipped = 'fists'; delete this.mag[id]; }
    this.changed();
    return n - left;
  }
  changed() { if (this.onChange) this.onChange(); }
  toJSON() { return { slots: this.slots, mag: this.mag, equipped: this.equipped }; }
  load(o) { this.slots = (o.slots || []).filter(s => ITEMS[s.id]); this.mag = o.mag || {}; this.equipped = o.equipped && (o.equipped === 'fists' || this.has(o.equipped)) ? o.equipped : 'fists'; this.changed(); }
}
