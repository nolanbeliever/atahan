import * as THREE from 'three';
import { EVT, formatMoney } from '/shared/constants.js';
import { HOUSE_BY_ID, houseAt } from '/shared/layout.js';
import { PRESS, pressSpots } from '/shared/counterfeit.js';
import { makeCharacter } from './Characters.js';

const mat = (color, o = {}) => new THREE.MeshLambertMaterial({ color, ...o });
const M = {
  body: mat('#2f4a3a'), steel: mat('#9aa3ab'), dark: mat('#1d2126'), roller: mat('#c9a25e'),
  paper: mat('#f2efe4'), cash: mat('#6fa865'), band: mat('#e9e2c4'), tarp: mat('#3d5a80'),
  wood: mat('#6b4423'), book: [mat('#8a2f2f'), mat('#2b5ea7'), mat('#3f7d3a'), mat('#d9a441'), mat('#5a3a22')],
  red: new THREE.MeshBasicMaterial({ color: 0xff2a2a }), blue: new THREE.MeshBasicMaterial({ color: 0x2a6bff }),
};

/** Tek bir matbaa (masa + silindirler + kâğıt + para destesi) ve örtü; ev köşesine yerleşir */
function makePress() {
  const g = new THREE.Group();
  const box = (m, w, h, d, x, y, z) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  box(M.dark, 1.0, 0.75, 0.62, 0, 0.375, 0);
  box(M.body, 0.92, 0.32, 0.56, 0, 0.91, 0);
  for (const dz of [-0.12, 0.12]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 12), M.roller);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, 1.12, dz);
    g.add(r);
  }
  box(M.steel, 0.08, 0.4, 0.08, -0.44, 1.2, 0.25);
  box(M.paper, 0.5, 0.1, 0.34, 0.15, 1.12, -0.32); // besleme kâğıdı
  // Basılan para desteleri (ilerledikçe görünür)
  const stacks = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Group();
    const cash = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.08), M.cash);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.062, 0.082), M.band);
    s.add(cash, band);
    s.position.set(-0.3 + (i % 3) * 0.2, 0.78 + Math.floor(i / 3) * 0.065, 0.18);
    s.visible = false;
    g.add(s);
    stacks.push(s);
  }
  // Örtü (gizlenince makinenin üstüne)
  const tarp = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.3, 0.72), M.tarp);
  tarp.position.y = 0.65;
  tarp.visible = false;
  g.add(tarp);
  // Kırmızı çalışma lambası (baskı sürerken yanar)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0x334433 }));
  lamp.position.set(0.4, 1.1, 0.29);
  g.add(lamp);
  return { g, stacks, tarp, lamp };
}

/** Gizli bölme: duvara yaslı kitaplık görünümlü döner panel */
function makeHideout() {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.1, 1.0), M.wood);
  frame.position.y = 1.05;
  g.add(frame);
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3 + ((row + i) % 3) * 0.04, 0.1), M.book[(row * 2 + i) % M.book.length]);
      b.position.set(-0.04, 0.35 + row * 0.48 + 0.16, -0.38 + i * 0.15);
      g.add(b);
    }
  }
  return g;
}

/**
 * Ev matbaası (sahte para) + polis baskını — istemci (sunucu: server/house/CounterfeitService.js).
 *  - Kendi evinde arka sol köşede "Matbaa kur" (€600, cüzdandan) → "Para bas" (45 sn, +€500 cüzdana).
 *  - Baskın uyarısı: kırmızı bant + 15 sn geri sayım + siren; matbaanın başında 2 sn basılı tut
 *    (örtüyle gizle) ya da doğu duvarındaki kitaplık panelinden gizli bölmeye kaç. Polis kapıya gelir
 *    (iki polis + tepe lambası), arar ve gider.
 * Pil: modeller durum değişince güncellenir; para desteleri saniyede bir (yalnızca baskı sürerken ve
 * evdeyken), polis lambası yalnızca polis kapıdayken yanıp söner. Siren WebAudio, yalnızca uyarıda.
 */
export class HomeCounterfeitSystem {
  constructor({ engine, net, hud, interaction, house, player, sfx, settings }) {
    Object.assign(this, { engine, net, hud, interaction, house, player, sfx, settings });
    this.states = new Map(); // houseId → durum
    this.views = new Map(); // houseId → { press, hideout }
    this.police = null; // { group, light, until }
    this.working = false;
    const $ = (id) => document.getElementById(id);
    this.el = { banner: $('raid-banner'), time: $('raid-time'), hint: $('raid-hint'), hide: $('hide-overlay'), unhide: $('hide-exit') };
    this.el.unhide.addEventListener('click', () => this.unhide());
    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
    setInterval(() => this.tick(), 1000);
  }

  get myHouse() { return this.house.ownedHouseId; }

  // ---- Durum ---------------------------------------------------------------------------

  /** snapshot.counterfeit / EVT.COUNTERFEIT_STATE */
  setState(list) {
    const seen = new Set();
    for (const s of list ?? []) {
      seen.add(s.houseId);
      this.states.set(s.houseId, s);
      this.applyView(s);
    }
    for (const id of [...this.states.keys()]) {
      if (seen.has(id)) continue;
      this.states.delete(id);
      const v = this.views.get(id);
      if (v) {
        this.engine.scene.remove(v.press.g, v.hideout);
        this.views.delete(id);
      }
    }
    this.renderBanner();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  applyView(s) {
    let v = this.views.get(s.houseId);
    const def = HOUSE_BY_ID[s.houseId];
    if (!def) return;
    if (!v) {
      const sp = pressSpots(def);
      const press = makePress();
      press.g.position.set(sp.press.x, 0, sp.press.z);
      press.g.rotation.y = Math.PI; // ön yüzü odaya (−Z)
      const hideout = makeHideout();
      hideout.position.set(sp.hideout.x - 0.03, 0, sp.hideout.z);
      this.engine.scene.add(press.g, hideout);
      v = { press, hideout };
      this.views.set(s.houseId, v);
    }
    v.press.tarp.visible = !!s.raid?.stashed;
    v.press.lamp.material.color.setHex(s.printing && !s.raid ? 0xff3b30 : s.seized ? 0x6b6b6b : 0x334433);
    this.updateStacks(s, v);
  }

  updateStacks(s, v) {
    let n = 0;
    if (s.printing && !s.raid) {
      const left = Math.max(0, s.printing.endsAt - this.net.serverNow());
      n = Math.round((1 - left / PRESS.BATCH_MS) * 6);
    } else if (s.printing) n = 3;
    v.press.stacks.forEach((st, i) => { st.visible = i < n; });
  }

  /** Saniyede bir: geri sayım bandı + (evdeysen) para desteleri */
  tick() {
    const mine = this.states.get(this.myHouse);
    if (mine?.raid) this.renderBanner();
    if (mine?.printing) {
      const v = this.views.get(this.myHouse);
      if (v && houseAt(this.player.pos.x, this.player.pos.z)?.id === this.myHouse) {
        this.updateStacks(mine, v);
        this.interaction.invalidate();
        this.engine.requestRender();
      }
    }
    if (this.police && performance.now() > this.police.until) this.removePolice();
  }

  renderBanner() {
    const s = this.states.get(this.myHouse);
    const r = s?.raid;
    const b = this.el.banner;
    if (!r || r.police) {
      b.hidden = true;
      this.siren(false);
      if (!r && this.hidden) this.showHidden(false);
      return;
    }
    b.hidden = false;
    const left = Math.max(0, Math.ceil((r.endsAt - this.net.serverNow()) / 1000));
    this.el.time.textContent = `${left} sn`;
    const me = this.selfHidden(r);
    this.el.hint.textContent = r.stashed ? '✅ Matbaa ve para örtünün altında — polis gelince sakin ol.'
      : me ? '🤫 Gizli bölmedesin — kıpırdama!'
        : 'Matbaanın başında E: gizle (2 sn) · ya da doğu duvarındaki kitaplıktan gizli bölmeye kaç!';
    this.siren(!r.stashed && !me);
  }

  selfHidden(r) { return r?.hidden?.includes(this.selfId); }

  // ---- Etkileşim ------------------------------------------------------------------------

  findTarget(px, pz, f) {
    const id = this.myHouse;
    if (!id || this.working) return null;
    if (houseAt(px, pz)?.id !== id) return null;
    const sp = pressSpots(HOUSE_BY_ID[id]);
    const s = this.states.get(id);
    const facing = ([x, z], range = PRESS.RANGE + 0.4) => {
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      return d <= range && (d < 0.5 || (dx * f.x + dz * f.z) / d > 0.2);
    };
    const pressAt = [sp.press.x, sp.press.z];
    const nearPress = facing(sp.pressPoint) && facing(pressAt, 2.2);
    if (s?.raid && !s.raid.police) {
      if (!s.raid.stashed && nearPress) {
        return { x: sp.press.x, z: sp.press.z, short: 'Gizle', label: '🧺 Matbaayı ve parayı ÖRT (basılı tut 2 sn)', use: () => this.stash() };
      }
      if (facing(sp.hidePoint) && facing([sp.hideout.x, sp.hideout.z], 2.0)) {
        return { x: sp.hidePoint[0], z: sp.hidePoint[1], short: 'Saklan', label: '🚪 Gizli bölmeye kaç!', use: () => this.hide() };
      }
      return null;
    }
    if (!nearPress) return null;
    const at = { x: sp.press.x, z: sp.press.z };
    if (!s) return { ...at, short: 'Kur', label: `🖨️ Ev matbaası kur (${formatMoney(PRESS.PRICE)}, cüzdandan)`, use: () => this.act({ act: 'buy' }, '🖨️ Matbaa kuruldu. Dikkat: polis her an gelebilir!') };
    if (s.seized) return { ...at, short: '🔒', label: '🔒 Matbaa polis tarafından mühürlendi — yarın', use: () => {} };
    if (s.printing) {
      const left = Math.max(0, Math.ceil((s.printing.endsAt - this.net.serverNow()) / 1000));
      return { ...at, short: 'Basılıyor', label: `🖨️ Basılıyor… ${left} sn`, use: () => {} };
    }
    return {
      ...at, short: 'Bas', label: `🖨️ Para bas (${PRESS.BATCH_MS / 1000} sn · +${formatMoney(PRESS.BATCH_VALUE)} · polis riski %${Math.round(PRESS.RAID_CHANCE * 100)})`,
      use: () => this.act({ act: 'print' }, '🖨️ Baskı başladı — kulağın kapıda olsun.'),
    };
  }

  async act(data, okText) {
    const res = await this.net.request(EVT.COUNTERFEIT_ACT, data);
    if (!res.ok) this.hud.toast(res.error || 'Olmadı.', 'warn');
    else if (okText) this.hud.toast(okText, 'info');
    return res;
  }

  async stash() {
    if (this.working) return;
    this.working = true;
    const res = await this.act({ act: 'stash', step: 'begin' });
    if (!res.ok) {
      this.working = false;
      return;
    }
    const t0 = performance.now();
    const step = () => {
      const left = PRESS.STASH_MS - (performance.now() - t0);
      if (left > 0) {
        this.interaction.setBusy(`🧺 Örtüyorsun… ${(left / 1000).toFixed(1)} sn`);
        setTimeout(step, 100);
        return;
      }
      this.interaction.setBusy(null);
      this.act({ act: 'stash', step: 'finish' }, '🧺 Matbaa ve para gizlendi.').finally(() => { this.working = false; });
    };
    step();
  }

  async hide() {
    const res = await this.act({ act: 'hide' });
    if (!res.ok) return;
    this.player.setPose(res.x, res.z, this.player.yaw);
    this.net.sendMove(res.x, res.z, this.player.yaw);
    this.net.flushMove?.();
    this.showHidden(true);
  }

  async unhide() {
    this.showHidden(false);
    await this.act({ act: 'unhide' });
  }

  showHidden(on) {
    this.hidden = on;
    this.el.hide.hidden = !on;
  }

  /** Oyuncu yürüyünce bölmeden çıkar (sunucu da çıkarır) */
  onMoved() {
    if (!this.hidden) return;
    const sp = pressSpots(HOUSE_BY_ID[this.myHouse]);
    if (Math.hypot(this.player.pos.x - sp.hideSpot[0], this.player.pos.z - sp.hideSpot[1]) > PRESS.HIDE_MOVE) this.showHidden(false);
  }

  // ---- Polis kapıda ---------------------------------------------------------------------

  /** EVT.COUNTERFEIT_RAID: iki polis + tepe lambalı direk kapının önünde */
  onRaid(r) {
    this.removePolice();
    const group = new THREE.Group();
    for (const dx of [-0.5, 0.5]) {
      const cop = makeCharacter({ skin: (dx > 0 ? 2 : 0), hair: 0, hat: true }, { color: '#1c2b4a' });
      cop.position.set(r.x + dx, 0, r.z - 0.4);
      group.add(cop);
    }
    const light = new THREE.Group();
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.red);
    const blue = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.blue);
    red.position.x = -0.12;
    blue.position.x = 0.12;
    light.add(red, blue);
    light.position.set(r.x + 1.4, 1.9, r.z - 0.9);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), M.steel);
    pole.position.set(r.x + 1.4, 0.95, r.z - 0.9);
    group.add(light, pole);
    this.engine.scene.add(group);
    this.police = { group, red, blue, until: performance.now() + Math.max(2000, r.until - this.net.serverNow()) };
    this.engine.requestRender();
    if (houseAt(this.player.pos.x, this.player.pos.z)?.id === r.houseId || r.houseId === this.myHouse) {
      this.hud.toast(r.safe ? '👮 Polis kapıda… arıyorlar… bir şey bulamadılar.' : '🚔 Polis kapıda — yakalandın!', r.safe ? 'info' : 'warn');
    }
  }

  removePolice() {
    if (!this.police) return;
    this.engine.scene.remove(this.police.group);
    this.police = null;
    this.engine.requestRender();
  }

  /** Kare sistemi: polis lambası yanıp söner (yalnızca polis varken) */
  update() {
    const p = this.police;
    if (!p) return false;
    const on = Math.floor(performance.now() / 250) % 2 === 0;
    p.red.visible = on;
    p.blue.visible = !on;
    return true;
  }

  // ---- Siren (WebAudio, yalnızca uyarıda) -------------------------------------------------

  siren(on) {
    if (!on) {
      if (this.sirenNodes) {
        try { this.sirenNodes.osc.stop(); } catch { /* yok say */ }
        this.sirenNodes = null;
      }
      return;
    }
    if (this.sirenNodes || this.settings?.sound === false) return;
    const ctx = this.sfx?.begin(PRESS.WARNING_MS + 1000); // bağlamı uyarı boyunca uyanık tut
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 760;
    lfo.type = 'square';
    lfo.frequency.value = 1.6;
    lfoGain.gain.value = 160;
    gain.gain.value = 0.035;
    lfo.connect(lfoGain).connect(osc.frequency);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    lfo.start();
    osc.onended = () => lfo.stop();
    this.sirenNodes = { osc };
  }

  reset(selfId) {
    this.selfId = selfId;
    this.showHidden(false);
  }
}
