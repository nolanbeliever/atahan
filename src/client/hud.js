// DOM HUD: vitals, compass, clock, mission tracker, minimap & full map, toasts,
// hit markers, damage direction, inventory and loot panels.
import { ITEMS } from '../shared/items.js';
import { SIZE } from '../shared/world.js';
import { MAX_SLOTS } from './inventory.js';

const $ = (id) => document.getElementById(id);
const DESC = {
  melee: (d) => `Melee weapon · damage ${d.dmg} · reach ${d.range} m`,
  gun: (d) => `Firearm · damage ${d.dmg}${d.pellets > 1 ? ' × ' + d.pellets : ''} · magazine ${d.mag} · uses ${ITEMS[d.ammo].name}. Gunshots attract zombies from far away.`,
  ammo: () => 'Ammunition. Reload with R or the reload button.',
  heal: (d) => `Restores ${d.heal} health${d.stopBleed ? ', stops bleeding' : ''}${d.cure ? ', cures infection' : ''}${d.stamina ? ', boosts stamina' : ''}.`,
  drink: (d) => `Quenches thirst (+${d.thirst}).`,
  food: (d) => `Satisfies hunger (+${d.hunger}).`,
  fuel: (d) => `${d.fuel} litres of petrol. Use next to a vehicle to refuel it.`,
  battery: () => 'Recharges your flashlight.',
  junk: () => 'Scrap. Not much use… yet.',
};

export class Hud {
  constructor(game) {
    this.g = game;
    this.el = {
      hud: $('hud'), clock: $('clock'), zone: $('zone'), strip: $('compassStrip'), mission: $('mission'), mini: $('minimap'),
      hp: document.querySelector('.bar.hp i'), st: document.querySelector('.bar.st i'), fo: document.querySelector('.bar.fo i'), wa: document.querySelector('.bar.wa i'),
      status: $('status'), wname: $('wname'), ammo: $('ammo'), prompt: $('prompt'), toasts: $('toasts'), hurt: $('hurtfx'), dmgdir: $('dmgdir'),
      hit: $('hitmarker'), cross: $('crosshair'), fps: $('fps'), veh: $('vehhud'), vspeed: $('vspeed'), vfuel: $('vfuel'), vhp: $('vhp'),
      usebar: $('usebar'), weaponbox: $('weaponbox'), net: $('netinfo'),
    };
    // compass strip
    const dirs = ['N', '·', 'NE', '·', 'E', '·', 'SE', '·', 'S', '·', 'SW', '·', 'W', '·', 'NW', '·'];
    let h = '';
    for (let r = 0; r < 3; r++) for (const d of dirs) h += `<span class="${d.length && d !== '·' ? 'c' : ''}">${d}</span>`;
    this.el.strip.innerHTML = h;
    this.miniCtx = this.el.mini.getContext('2d');
    this.mapImg = null;
    this.hurtV = 0;
    this.hitT = 0;
    this.lastPrompt = '';
  }

  // static map image from colliders (building outlines) and roads
  buildMap() {
    const W = this.g.W;
    const s = 2;
    const c = document.createElement('canvas'); c.width = c.height = SIZE * s;
    const x = c.getContext('2d');
    x.fillStyle = '#2b2a28'; x.fillRect(0, 0, c.width, c.height);
    // lots
    for (const cell of W.cells) {
      if (cell.type === 'road') continue;
      const col = { park: '#2f3a26', house: '#34392c', police: '#253a2a' }[cell.type] || '#353330';
      x.fillStyle = col; x.fillRect((cell.x0 + 16) * s, (cell.z0 + 16) * s, 56 * s, 56 * s);
    }
    x.fillStyle = '#4a4844';
    for (const cl of W.colliders) {
      if (cl.y1 < 2.2 || cl.y0 > 1 || cl.glass) continue;
      x.fillRect(cl.x0 * s, cl.z0 * s, Math.max(1, (cl.x1 - cl.x0) * s), Math.max(1, (cl.z1 - cl.z0) * s));
    }
    for (const z of W.zones) { x.strokeStyle = 'rgba(80,200,120,0.6)'; x.lineWidth = 2; x.strokeRect(z.x0 * s, z.z0 * s, (z.x1 - z.x0) * s, (z.z1 - z.z0) * s); }
    this.mapImg = c; this.mapScale = s;
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  toast(msg, big = false) {
    const d = document.createElement('div');
    d.textContent = msg; if (big) d.className = 'big';
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 3300);
  }
  hurt(k) { this.hurtV = Math.min(1, this.hurtV + 0.3 + k); }
  damageFrom(x, z) {
    const p = this.g.player;
    const a = Math.atan2(x - p.body.x, z - p.body.z);
    const rel = a - p.facing;
    this.el.dmgdir.style.transform = `rotate(${-rel}rad)`;
    this.el.dmgdir.style.opacity = 1;
    clearTimeout(this._dd); this._dd = setTimeout(() => { this.el.dmgdir.style.opacity = 0; }, 700);
  }
  hitmark(kill) {
    this.el.hit.classList.toggle('kill', !!kill);
    this.el.hit.style.opacity = 1;
    clearTimeout(this._hm); this._hm = setTimeout(() => { this.el.hit.style.opacity = 0; }, kill ? 260 : 140);
  }
  prompt(text) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    if (!text) { this.el.prompt.classList.add('hidden'); return; }
    const key = this.g.input.touchMode ? '✋' : 'E';
    this.el.prompt.innerHTML = `<kbd>${key}</kbd>${text}`;
    this.el.prompt.classList.remove('hidden');
  }
  weapon(p) {
    const id = p.inv.equipped, w = ITEMS[id];
    this.el.wname.textContent = w.name;
    if (w.type === 'gun') this.el.ammo.innerHTML = `${p.inv.mag[id] || 0}<small> / ${p.inv.count(w.ammo)}</small>`;
    else this.el.ammo.textContent = '';
    this.el.cross.classList.toggle('melee', w.type !== 'gun');
    this.el.weaponbox.classList.toggle('show', w.type === 'gun');
  }

  update(dt, fps) {
    const g = this.g, p = g.player;
    this.el.hp.style.width = p.hp + '%';
    this.el.st.style.width = p.stamina + '%';
    this.el.fo.style.width = p.hunger + '%';
    this.el.wa.style.width = p.thirst + '%';
    const st = [];
    if (p.bleed > 0) st.push('<em class="bad">🩸 Bleeding</em>');
    if (p.infection > 0) st.push(`<em class="bad">☣ Infected ${Math.round(p.infection)}%</em>`);
    if (p.hunger < 20) st.push('<em class="bad">Starving</em>');
    if (p.thirst < 20) st.push('<em class="bad">Dehydrated</em>');
    if (p.light || p.battery < 100) st.push(`<em>🔦 ${Math.round(p.battery)}%</em>`);
    if (g.inSafe()) st.push('<em style="color:#7fd890">⛨ Safe zone</em>');
    const sh = st.join('');
    if (sh !== this._st) { this.el.status.innerHTML = sh; this._st = sh; }
    const t = g.session.time;
    const hh = Math.floor(t), mm = Math.floor((t - hh) * 60);
    const day = g.session.view.day || 1;
    this.el.clock.textContent = `Day ${day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    this.el.zone.textContent = g.zoneName;
    // compass: yaw 0 looks to -z (north)
    const py = p.veh !== null ? g.vehicle(p.veh).yaw + Math.PI : p.yaw;
    let heading = (-py * 180 / Math.PI) % 360;
    if (heading < 0) heading += 360;
    const px = (heading / 22.5) * 30;
    this.el.strip.style.transform = `translateX(${this.el.strip.parentElement.clientWidth / 2 - 15 - px - 16 * 30}px)`;
    // hurt overlay
    this.hurtV = Math.max(0, this.hurtV - dt * 1.2);
    const low = p.hp < 30 ? (0.35 + Math.sin(performance.now() * 0.006) * 0.1) * (1 - p.hp / 30) : 0;
    this.el.hurt.style.opacity = Math.min(1, this.hurtV + low);
    // vehicle
    const inVeh = p.veh !== null;
    this.el.veh.classList.toggle('hidden', !inVeh);
    if (inVeh) {
      const v = g.vehicle(p.veh);
      this.el.vspeed.textContent = Math.round(Math.abs(v.speed) * 3.6);
      const tank = g.vtype(v).tank;
      this.el.vfuel.textContent = `⛽ ${Math.round(v.fuel / tank * 100)}%`;
      this.el.vhp.textContent = `🔧 ${Math.round(v.hp)}%`;
    }
    this.el.cross.style.display = inVeh || p.tpBlend > 0.5 && !g.input.down('aim') && false ? 'none' : '';
    if (p.useT > 0) {
      this.el.usebar.classList.remove('hidden');
      this.el.usebar.firstChild.style.width = (100 * (1 - p.useT / p.useTotal)) + '%';
      this.el.usebar.lastChild.textContent = 'Using ' + ITEMS[p.useItem].name;
    } else this.el.usebar.classList.add('hidden');
    if (g.settings.showFps) { this.el.fps.classList.remove('hidden'); this.el.fps.textContent = `${fps} fps · ${g.renderInfo}`; } else this.el.fps.classList.add('hidden');
    if (g.session.mp) { this.el.net.classList.remove('hidden'); this.el.net.textContent = `Room ${g.roomCode} · ${g.session.view.players.size} online · ${Math.round(g.session.ping)} ms`; }
    this.minimap();
  }

  mission(m) {
    const el = this.el.mission;
    if (!m) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('.mt').textContent = m.title;
    el.querySelector('.md').textContent = m.text;
    el.querySelector('.mdist').textContent = m.dist !== undefined ? `${Math.round(m.dist)} m ${m.dir || ''}` : '';
  }

  minimap() {
    const g = this.g, p = g.player, ctx = this.miniCtx, W = 160, R = 70;
    if (!this.mapImg) return;
    const view = 55; // metres radius
    const k = R / view;
    const px = p.body.x, pz = p.body.z;
    const yaw = p.veh !== null ? g.vehicle(p.veh).yaw + Math.PI : p.yaw;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.arc(80, 80, 78, 0, 7); ctx.clip();
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, W, W);
    ctx.translate(80, 80);
    ctx.rotate(yaw);
    const s = this.mapScale;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.mapImg, (px - view * 1.5) * s, (pz - view * 1.5) * s, view * 3 * s, view * 3 * s, -view * 1.5 * k, -view * 1.5 * k, view * 3 * k, view * 3 * k);
    ctx.globalAlpha = 1;
    // zombies the player could plausibly hear/see
    for (const z of g.session.view.zombies) {
      if (z.dead) continue;
      const dx = (z.x - px), dz = (z.z - pz), d = Math.hypot(dx, dz);
      if (d > 32 && z.state !== 'chase') continue;
      if (d > view) continue;
      ctx.fillStyle = z.state === 'chase' || z.state === 'attack' ? '#ff4030' : 'rgba(220,90,70,0.7)';
      ctx.fillRect(dx * k - 2, dz * k - 2, 4, 4);
    }
    for (const v of g.session.view.vehicles) { if (!v) continue; const dx = v.x - px, dz = v.z - pz; if (Math.hypot(dx, dz) < view) { ctx.fillStyle = '#7ab0ff'; ctx.fillRect(dx * k - 3, dz * k - 3, 6, 6); } }
    for (const o of g.session.view.players.values()) { if (o.id === g.session.id) continue; const dx = o.x - px, dz = o.z - pz; ctx.fillStyle = '#60e0a0'; ctx.beginPath(); ctx.arc(dx * k, dz * k, 3.5, 0, 7); ctx.fill(); }
    // mission target
    const m = g.missions.current();
    if (m && m.target) {
      let dx = (m.target.x - px) * k, dz = (m.target.z - pz) * k;
      const d = Math.hypot(dx, dz);
      if (d > R - 6) { dx *= (R - 6) / d; dz *= (R - 6) / d; }
      ctx.fillStyle = '#e0a040'; ctx.beginPath(); ctx.arc(dx, dz, 5, 0, 7); ctx.fill();
    }
    ctx.restore();
    // player arrow
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(80, 72); ctx.lineTo(86, 88); ctx.lineTo(80, 84); ctx.lineTo(74, 88); ctx.closePath(); ctx.fill();
  }

  drawMap(canvas) {
    const g = this.g, p = g.player, ctx = canvas.getContext('2d');
    const S = canvas.width, k = S / SIZE;
    ctx.drawImage(this.mapImg, 0, 0, S, S);
    ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
    const labels = { police: 'POLICE · SAFEHOUSE', hospital: 'HOSPITAL', market: 'SUPERMARKET', petrol: 'PETROL', camp: 'RELIEF CAMP' };
    for (const [key, txt] of Object.entries(labels)) {
      const poi = g.W.pois[key]; if (!poi) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; const w = ctx.measureText(txt).width + 10; ctx.fillRect(poi.x * k - w / 2, poi.z * k - 9, w, 18);
      ctx.fillStyle = key === 'police' ? '#7fd890' : '#e8e0d0'; ctx.fillText(txt, poi.x * k, poi.z * k + 5);
    }
    for (const v of g.session.view.vehicles) { if (!v) continue; ctx.fillStyle = '#7ab0ff'; ctx.fillRect(v.x * k - 4, v.z * k - 4, 8, 8); }
    const m = g.missions.current();
    if (m && m.target) { ctx.strokeStyle = '#e0a040'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(m.target.x * k, m.target.z * k, 10, 0, 7); ctx.stroke(); }
    for (const o of g.session.view.players.values()) { if (o.id === g.session.id) continue; ctx.fillStyle = '#60e0a0'; ctx.beginPath(); ctx.arc(o.x * k, o.z * k, 5, 0, 7); ctx.fill(); }
    ctx.save(); ctx.translate(p.body.x * k, p.body.z * k); ctx.rotate(-(p.yaw));
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---------------- inventory panel
  renderInventory(sel) {
    const g = this.g, inv = g.player.inv;
    const grid = $('invGrid');
    grid.innerHTML = '';
    inv.slots.forEach((s, i) => {
      const d = ITEMS[s.id];
      const el = document.createElement('div');
      el.className = 'slot' + (i === sel ? ' sel' : '') + (s.id === inv.equipped ? ' eq' : '');
      el.innerHTML = `${d.icon || '?'}<small>${d.name}</small>${s.n > 1 ? `<b>${s.n}</b>` : ''}`;
      el.onclick = () => { g.audio.ui(); this.renderInventory(i); };
      grid.appendChild(el);
    });
    $('invCap').textContent = `${inv.slots.length} / ${MAX_SLOTS} slots`;
    const det = $('invDetail');
    const s = inv.slots[sel];
    const btns = det.querySelector('.dbtns');
    btns.innerHTML = '';
    if (!s) { det.querySelector('.dname').textContent = 'Select an item'; det.querySelector('.ddesc').textContent = ''; }
    else {
      const d = ITEMS[s.id];
      det.querySelector('.dname').textContent = `${d.icon} ${d.name}${s.n > 1 ? ' ×' + s.n : ''}`;
      det.querySelector('.ddesc').textContent = (DESC[d.type] || (() => ''))(d);
      const add = (label, fn, primary) => { const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary'; b.onclick = () => { g.audio.ui(); fn(); this.renderInventory(Math.min(sel, inv.slots.length - 1)); }; btns.appendChild(b); };
      if (d.type === 'melee' || d.type === 'gun') add(inv.equipped === s.id ? 'Equipped' : 'Equip', () => g.player.equip(s.id), true);
      if (['heal', 'food', 'drink', 'battery', 'fuel'].includes(d.type)) add('Use', () => { g.useItem(s.id); g.closePanels(); }, true);
      add('Drop one', () => g.dropItem(s.id, 1));
      if (s.n > 1) add('Drop all', () => g.dropItem(s.id, s.n));
    }
    const p = g.player;
    $('invStats').textContent = `Health ${Math.round(p.hp)} · Food ${Math.round(p.hunger)} · Water ${Math.round(p.thirst)} · Kills ${g.stats.kills} · Battery ${Math.round(p.battery)}%`;
  }

  renderLoot(cid) {
    const g = this.g, inv = g.player.inv;
    const items = g.session.contItems(cid) || [];
    const wc = g.W.containers[cid];
    $('lootTitle').textContent = wc.name;
    const box = $('lootItems');
    box.innerHTML = items.length ? '' : '<p class="note">Nothing useful left here.</p>';
    items.forEach((it, i) => {
      const d = ITEMS[it.id];
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `${d.icon}<small>${d.name}</small>${it.n > 1 ? `<b>${it.n}</b>` : ''}`;
      el.onclick = () => { g.audio.pickup(); g.session.take(cid, i, it.n); };
      box.appendChild(el);
    });
    $('lootAll').disabled = !items.length;
    const mine = $('lootMine');
    mine.innerHTML = '';
    inv.slots.forEach((s) => {
      const d = ITEMS[s.id];
      const el = document.createElement('div');
      el.className = 'slot' + (s.id === inv.equipped ? ' eq' : '');
      el.innerHTML = `${d.icon}<small>${d.name}</small>${s.n > 1 ? `<b>${s.n}</b>` : ''}`;
      el.onclick = () => { g.audio.ui(); const n = s.n; if (inv.remove(s.id, n)) g.session.put(cid, s.id, n); this.renderLoot(cid); };
      mine.appendChild(el);
    });
  }
}
