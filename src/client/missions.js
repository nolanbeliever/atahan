// Objective chain that walks the player through the survival loop.
import { ITEMS } from '../shared/items.js';

export const MISSIONS = [
  { id: 'armory', title: 'Gear up', text: 'Search the armory lockers inside the police station.', poi: 'armory' },
  { id: 'supplies', title: 'Supply run', text: 'Collect 3 food or drink items. The supermarket is east of the station.', poi: 'market', need: 3 },
  { id: 'meds', title: 'Medicine', text: 'Find a medkit or antibiotics in St. Mercy Hospital\'s pharmacy.', poi: 'pharmacy' },
  { id: 'fuel', title: 'Fuel', text: 'Get a fuel can at the petrol station, or refuel a car at a pump.', poi: 'petrol' },
  { id: 'drive', title: 'Wheels', text: 'Drive any vehicle 300 m. Engines are loud — zombies will hear you.', poi: 'vehicle', need: 300 },
  { id: 'radio', title: 'Signal', text: 'Use the emergency radio in the police dispatch office to call for evac.', poi: 'radio' },
  { id: 'holdout', title: 'Hold out', text: 'The radio drew a horde! Survive until the evac helicopter arrives.', poi: 'police', time: 180 },
];

export class Missions {
  constructor(game) { this.g = game; this.idx = 0; this.progress = 0; this.timer = 0; this.done = false; }
  current() {
    if (this.done || this.idx >= MISSIONS.length) return null;
    const m = MISSIONS[this.idx];
    const g = this.g, p = g.player;
    let target = null;
    if (m.poi === 'armory') { const c = g.W.containers.find(c => c.name === 'Armory locker'); target = c && { x: c.x, z: c.z }; }
    else if (m.poi === 'vehicle') { let bd = 1e9; for (const v of g.session.view.vehicles) { if (!v) continue; const d = Math.hypot(v.x - p.body.x, v.z - p.body.z); if (d < bd) { bd = d; target = { x: v.x, z: v.z }; } } if (p.veh !== null) target = null; }
    else target = g.W.pois[m.poi] || null;
    let text = m.text;
    if (m.need && m.id === 'supplies') text += ` (${this.progress}/${m.need})`;
    if (m.id === 'drive') text = `Drive any vehicle 300 m (${Math.round(this.progress)} m).`;
    if (m.id === 'holdout') text = `${m.text} ${Math.max(0, Math.ceil(this.timer))} s`;
    const out = { title: `${this.idx + 1}/${MISSIONS.length} · ${m.title}`, text, target };
    if (target) {
      out.dist = Math.hypot(target.x - p.body.x, target.z - p.body.z);
      const a = Math.atan2(target.x - p.body.x, -(target.z - p.body.z)) * 180 / Math.PI;
      out.dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((a + 360) % 360) / 45) % 8];
    }
    return out;
  }
  id() { return this.done || this.idx >= MISSIONS.length ? null : MISSIONS[this.idx].id; }
  advance() {
    const m = MISSIONS[this.idx];
    this.g.hud.toast(`Objective complete: ${m.title}`, true);
    this.g.audio.pickup();
    this.idx++; this.progress = 0;
    if (this.idx >= MISSIONS.length) { this.done = true; return; }
    const n = MISSIONS[this.idx];
    if (n.time) this.timer = n.time;
    setTimeout(() => this.g.hud.toast(`New objective: ${n.title}`), 1200);
    this.g.autosave();
  }
  // called on gameplay events
  onItem(id, n) {
    const m = this.id(), d = ITEMS[id];
    if (m === 'supplies' && (d.type === 'food' || d.type === 'drink')) { this.progress += n; if (this.progress >= 3) this.advance(); }
  }
  update(dt) {
    const m = this.id(), g = this.g, p = g.player;
    if (!m) return;
    if (m === 'armory' && (p.inv.has('pistol') || p.inv.has('shotgun'))) this.advance();
    else if (m === 'meds' && (p.inv.has('medkit') || p.inv.has('antibiotics'))) this.advance();
    else if (m === 'fuel' && (p.inv.has('fuelcan') || g.stats.refuels > 0)) this.advance();
    else if (m === 'drive') { this.progress = g.stats.driven; if (this.progress >= 300) this.advance(); }
    else if (m === 'holdout') {
      this.timer -= dt;
      if (this.timer <= 25 && !this.heli) { this.heli = true; const poi = g.W.pois.police; g.audio.helicopter(poi.x, 30, poi.z, 25); g.hud.toast('You hear rotor blades approaching…', true); }
      if (this.timer <= 0) { this.done = true; g.onWin(); }
    }
  }
  toJSON() { return { idx: this.idx, progress: this.progress, timer: this.timer, done: this.done }; }
  load(o) { Object.assign(this, { idx: o.idx || 0, progress: o.progress || 0, timer: o.timer || 0, done: !!o.done }); }
}
