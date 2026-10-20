import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import {
  DOOR, COLORS, PARTS, PART_NAMES, partDef, DRESS_CODE_BY_ID, VENUE_NAME, CUES_BAD, ambienceFeeMul,
} from '/shared/bouncer.js';
import { mat, SKIN_COLORS } from './Characters.js';
import { panel } from '../world/CarWorldKit.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const yawTo = (x, z, tx, tz) => Math.atan2(-(tx - x), -(tz - z));

// Kapı görevlisinin kamerası: kontrol noktasındaki misafire 1.6 m'den, hafif yukarıdan (yakın plan)
const CAM = (() => {
  const [cx, cz] = DOOR.check;
  const dx = DOOR.stand[0] - cx;
  const dz = DOOR.stand[1] - cz;
  const d = Math.hypot(dx, dz);
  const x = cx + (dx / d) * 1.55;
  const z = cz + (dz / d) * 1.55;
  // Misafir ekranın soluna düşsün (sağda HUD var)
  return Object.freeze({ x, z, eye: 1.5, yaw: yawTo(x, z, cx, cz) - 0.3, pitch: -0.22 });
})();
const BOARD_Z = -10 - 0.25 - 0.02; // kuzey duvarının iç yüzü (BasementBuilding T = 0.25)

// ---- NPC kıyafeti (parçalar paylaşılan geometri; renkler Characters.mat önbelleğinden) ---------------
let G = null;
function geos() {
  if (G) return G;
  const shoe = (x, h) => new THREE.BoxGeometry(0.11, h, 0.22).translate(x, h / 2, 0.05);
  G = {
    pants: new THREE.CylinderGeometry(0.226, 0.215, 0.56, 12, 1, true).translate(0, 0.33, 0),
    skirt: new THREE.CylinderGeometry(0.2, 0.27, 0.46, 12, 1, true).translate(0, 0.42, 0),
    shorts: new THREE.CylinderGeometry(0.228, 0.228, 0.26, 12, 1, true).translate(0, 0.49, 0),
    legs: new THREE.CylinderGeometry(0.19, 0.17, 0.36, 10).translate(0, 0.18, 0),
    shoeL: shoe(-0.09, 0.08), shoeR: shoe(0.09, 0.08),
    flatL: shoe(-0.09, 0.025), flatR: shoe(0.09, 0.025),
    heelL: new THREE.BoxGeometry(0.03, 0.09, 0.03).translate(-0.09, 0.045, -0.05),
    heelR: new THREE.BoxGeometry(0.03, 0.09, 0.03).translate(0.09, 0.045, -0.05),
    jacketL: new THREE.BoxGeometry(0.07, 0.6, 0.44).translate(-0.21, 0.82, 0),
    jacketR: new THREE.BoxGeometry(0.07, 0.6, 0.44).translate(0.21, 0.82, 0),
    jacketB: new THREE.BoxGeometry(0.44, 0.6, 0.07).translate(0, 0.82, -0.2),
    hood: new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).rotateX(-1.2).translate(0, 1.2, -0.12),
    number: new THREE.BoxGeometry(0.22, 0.2, 0.01).translate(0, 0.9, -0.226),
    bow: new THREE.BoxGeometry(0.14, 0.05, 0.03).translate(0, 1.17, 0.19),
    glasses: new THREE.BoxGeometry(0.2, 0.045, 0.02).translate(0, 1.39, 0.15),
    cap: new THREE.CylinderGeometry(0.16, 0.16, 0.07, 12).translate(0, 1.5, 0),
    brim: new THREE.BoxGeometry(0.2, 0.015, 0.14).translate(0, 1.47, 0.16),
    band: new THREE.TorusGeometry(0.235, 0.02, 4, 18).rotateX(Math.PI / 2).translate(0, 0.6, 0),
  };
  return G;
}
const neonMats = new Map();
function neonMat(hex) {
  let m = neonMats.get(hex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: hex });
    neonMats.set(hex, m);
  }
  return m;
}
const colorMat = (id) => {
  const c = COLORS[id];
  if (!c) return mat('#777777');
  return c.neon ? neonMat(c.hex) : mat(c.hex);
};

/** Misafirin kıyafetini karakterin üstüne giydir (imza değişmedikçe yeniden kurulmaz) */
function dressCharacter(it, data) {
  const u = it.obj.userData;
  const d = data.dress;
  const sig = d ? JSON.stringify(d) : '';
  if (u.dressSig === sig) return;
  u.dressSig = sig;
  if (u.dressGroup) {
    u.inner.remove(u.dressGroup);
    u.dressGroup = null;
  }
  if (!d) {
    if (u.body && u.bodyMat0) u.body.material = u.bodyMat0;
    return;
  }
  const g = geos();
  const grp = new THREE.Group();
  const add = (geo, m) => grp.add(new THREE.Mesh(geo, m));
  const skin = mat(SKIN_COLORS[(data.look?.skin ?? 0) % SKIN_COLORS.length]);
  u.bodyMat0 ??= u.body.material;
  u.body.material = colorMat(d.topC);
  if (d.top === 'kapusonlu') add(g.hood, colorMat(d.topC));
  if (d.top === 'forma') add(g.number, mat('#f2f2ee'));
  if (d.top === 'atlet') add(g.band, skin);
  const bottom = colorMat(d.bottomC);
  if (d.bottom === 'sort') {
    add(g.shorts, bottom);
    add(g.legs, skin);
  } else if (d.bottom === 'etek') {
    add(g.skirt, bottom);
    add(g.legs, skin);
  } else {
    add(g.pants, bottom);
  }
  const shoes = colorMat(d.shoesC);
  if (d.shoes === 'terlik') {
    add(g.flatL, shoes);
    add(g.flatR, shoes);
  } else {
    add(g.shoeL, shoes);
    add(g.shoeR, shoes);
    if (d.shoes === 'topuklu') {
      add(g.heelL, shoes);
      add(g.heelR, shoes);
    }
  }
  if (d.jacket) {
    const j = colorMat(d.jacketC);
    add(g.jacketL, j);
    add(g.jacketR, j);
    add(g.jacketB, j);
  }
  if (d.acc === 'papyon') add(g.bow, mat('#7a1a1a'));
  else if (d.acc === 'gozluk') add(g.glasses, mat('#111111'));
  else if (d.acc === 'kep') {
    add(g.cap, mat('#3b4a6b'));
    add(g.brim, mat('#3b4a6b'));
  } else if (d.acc === 'neon') add(g.band, neonMat('#62ff4f'));
  grp.traverse((o) => { o.layers.mask = it.obj.layers.mask; });
  u.inner.add(grp);
  u.dressGroup = grp;
}

/** Bir kıyafeti okunur metne çevir (HUD listesi) */
export function dressLines(d) {
  if (!d) return [];
  return PARTS.filter((p) => d[p]).map((p) => {
    const c = p === 'acc' ? null : COLORS[d[`${p}C`]];
    return { part: PART_NAMES[p], name: partDef(p, d[p])?.name ?? d[p], color: c?.name ?? null, hex: c?.hex ?? null, neon: !!c?.neon || d[p] === 'neon' };
  });
}

/**
 * VIP Bouncer — Eğlence Katı ("Neon Kelder") kapısı, istemci.
 *  - Bodrumun kuzeybatısında kadife ip + altın direkler, kürsü (tablet), "VIP KAPI" neon tabelası ve
 *    duvarda "Bu gece" panosu (kıyafet kuralı, kara liste, Ortam puanı) — durum değişince yeniden çizilir.
 *  - Misafirlerin kıyafeti (wire'daki `dress`) karakterin üstüne giydirilir: herkes aynı kıyafeti görür.
 *  - Kürsüde E → kapı modu: kamera sıranın başındaki misafire yakın plan; HUD'da kural, kart (oda kartı /
 *    davetiye), tavır ve kıyafet listesi. ✅ İçeri al (Y / 1) · ❌ Geri çevir (N / 2) · ✕ Kapıdan ayrıl (Q / Esc).
 * Pil: pano yalnızca durum değişince çizilir; kapı modunda yalnızca kamera güncellenir.
 */
export class VipBouncer {
  constructor({ engine, net, hud, interaction, player, guests, basement, collision, touch, sfx }) {
    Object.assign(this, { engine, net, hud, interaction, player, guests, basement, touch, sfx });
    this.state = null;
    this.selfId = null;
    this.mode = false;
    this.pending = false;
    this.camPos = { x: CAM.x, z: CAM.z };
    this.cam = { x: CAM.x, z: CAM.z, eye: CAM.eye, yaw: CAM.yaw, pitch: CAM.pitch };
    this.hudKey = '';
    this.boardKey = '';

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/bouncer.css';
    document.head.append(link);

    this.buildProps(basement.view.group, collision);
    this.buildHud();

    // Misafir kıyafetleri (diğer kancalardan sonra: katman maskesi doğru olsun)
    const upsert = guests.upsert.bind(guests);
    guests.upsert = (data) => {
      upsert(data);
      const it = guests.items.get(data.id);
      if (it && (data.dress || it.obj.userData.dressSig)) dressCharacter(it, data);
    };

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  // ---- Dünya ---------------------------------------------------------------------------------------

  buildProps(group, collision) {
    const gold = new THREE.MeshLambertMaterial({ color: 0xd9b24a, emissive: 0x2a1e00 });
    const velvet = new THREE.MeshLambertMaterial({ color: 0x8b0f2b, emissive: 0x1a0008 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x15121d });
    const R = DOOR.rope;
    const post = new THREE.CylinderGeometry(0.035, 0.05, 0.95, 8).translate(0, 0.475, 0);
    const base = new THREE.CylinderGeometry(0.15, 0.17, 0.04, 12).translate(0, 0.02, 0);
    const knob = new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0.98, 0);
    const n = Math.max(2, Math.round((R.maxX - R.minX) / 1.3) + 1);
    const xs = [];
    for (let i = 0; i < n; i++) xs.push(R.minX + ((R.maxX - R.minX) * i) / (n - 1));
    const meshes = [];
    for (const x of xs) {
      for (const [geo, m] of [[post, gold], [base, gold], [knob, gold]]) {
        const me = new THREE.Mesh(geo, m);
        me.position.set(x, 0, R.z);
        meshes.push(me);
      }
    }
    // İp: direkler arasında hafif sarkık (iki parça)
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i];
      const b = xs[i + 1];
      const span = b - a;
      for (const [x0, x1, y0, y1] of [[a, a + span / 2, 0.9, 0.78], [a + span / 2, b, 0.78, 0.9]]) {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const me = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 6), velvet);
        me.position.set((x0 + x1) / 2, (y0 + y1) / 2, R.z);
        me.rotation.z = Math.atan2(-(x1 - x0), y1 - y0); // silindirin ekseni (0,1) → ip parçasının yönü
        meshes.push(me);
      }
    }
    collision.add(R.minX - 0.05, R.maxX + 0.05, R.z - 0.07, R.z + 0.07);
    // Kürsü + tablet
    const [px, pz] = DOOR.podium;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.05, 0.42).translate(0, 0.525, 0), dark);
    pod.position.set(px, 0, pz);
    pod.rotation.y = -0.6;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.48).translate(0, 1.07, 0), gold);
    top.position.copy(pod.position);
    top.rotation.y = pod.rotation.y;
    const tablet = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.22).translate(0, 1.1, 0), new THREE.MeshBasicMaterial({ color: 0x28e7ff }));
    tablet.position.copy(pod.position);
    tablet.rotation.y = pod.rotation.y;
    meshes.push(pod, top, tablet);
    collision.addAround(px, pz, 0.3);
    // Kontrol noktası: zeminde ışıklı halka
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.4, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff4fe0 }));
    ring.position.set(DOOR.check[0], 0.012, DOOR.check[1]);
    meshes.push(ring);
    for (const m of meshes) {
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
    }
    // Duvardaki "Bu gece" panosu (dinamik doku) ve VIP KAPI neon tabelası
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 512;
    this.boardCanvas.height = 384;
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    group.add(panel(new THREE.MeshBasicMaterial({ map: this.boardTex }), 1.4, 1.05, DOOR.board[0], 1.62, BOARD_Z, 'z-'));
    const sign = document.createElement('canvas');
    sign.width = 512;
    sign.height = 128;
    const g = sign.getContext('2d');
    g.fillStyle = '#0b0716';
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 6;
    g.strokeRect(6, 6, 500, 116);
    g.fillStyle = '#ffd23f';
    g.font = '800 64px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('🛡️ VIP KAPI', 256, 68);
    const st = new THREE.CanvasTexture(sign);
    st.colorSpace = THREE.SRGBColorSpace;
    group.add(panel(new THREE.MeshBasicMaterial({ map: st }), 1.3, 0.32, DOOR.board[0], 2.48, BOARD_Z, 'z-'));
    this.drawBoard();
  }

  drawBoard() {
    const s = this.state;
    const key = s ? JSON.stringify([s.code, s.day, s.blacklist, Math.round(s.ambience)]) : 'none';
    if (key === this.boardKey) return;
    this.boardKey = key;
    const g = this.boardCanvas.getContext('2d');
    const W = 512;
    const H = 384;
    g.fillStyle = '#100a1c';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#ff4fe0';
    g.lineWidth = 6;
    g.strokeRect(6, 6, W - 12, H - 12);
    g.textAlign = 'left';
    g.textBaseline = 'top';
    if (!s) {
      g.fillStyle = '#ffffff';
      g.font = '700 30px system-ui, sans-serif';
      g.fillText('Kapı kapalı', 24, 24);
    } else {
      const code = DRESS_CODE_BY_ID[s.code];
      g.fillStyle = '#ff9be8';
      g.font = '700 22px system-ui, sans-serif';
      g.fillText(`BU GECE · Gün ${s.day + 1}`, 24, 20);
      g.fillStyle = '#ffffff';
      g.font = '800 38px system-ui, sans-serif';
      g.fillText(`${code.icon} ${code.name}`, 24, 50);
      g.font = '500 19px system-ui, sans-serif';
      g.fillStyle = '#e6dcff';
      code.rules.forEach((r, i) => g.fillText(`• ${r}`, 24, 104 + i * 26, W - 48));
      g.fillStyle = '#ff6b6b';
      g.font = '700 21px system-ui, sans-serif';
      g.fillText('⛔ KARA LİSTE', 24, 172);
      g.font = '500 20px system-ui, sans-serif';
      g.fillStyle = '#ffd0d0';
      g.fillText(s.blacklist.join(' · ') || '—', 24, 200, W - 48);
      g.fillStyle = '#9fe8ff';
      g.font = '600 18px system-ui, sans-serif';
      g.fillText(`Davetiye: "${VENUE_NAME}" + bugünün tarihi`, 24, 236, W - 48);
      // Ortam çubuğu
      const a = Math.max(0, Math.min(100, s.ambience));
      g.fillStyle = '#ffffff';
      g.font = '700 21px system-ui, sans-serif';
      g.fillText(`✨ Ortam ${Math.round(a)}/100`, 24, 282);
      g.fillStyle = 'rgba(255,255,255,.15)';
      g.fillRect(24, 316, W - 48, 22);
      g.fillStyle = a >= 70 ? '#62ff4f' : a >= 40 ? '#ffd23f' : '#ff5a4f';
      g.fillRect(24, 316, ((W - 48) * a) / 100, 22);
      g.fillStyle = '#c9b8ff';
      g.font = '500 16px system-ui, sans-serif';
      g.fillText(`Misafir ücretleri ×${ambienceFeeMul(a).toFixed(2)}`, 24, 346);
    }
    this.boardTex.needsUpdate = true;
    this.engine.requestRender();
  }

  // ---- Durum ---------------------------------------------------------------------------------------

  reset(selfId) {
    this.selfId = selfId;
    if (this.mode) this.exitMode(false);
  }

  onState(s) {
    if (!s) return;
    this.state = s;
    this.drawBoard();
    if (this.mode && s.post?.id !== this.selfId && !this.pending) this.exitMode(false);
    this.hudKey = '';
    this.interaction.invalidate();
    this.engine.wake?.();
  }

  // ---- Etkileşim -------------------------------------------------------------------------------------

  findTarget(px, pz) {
    if (this.mode || !this.basement.inBasement || !this.state?.active) return null;
    const [sx, sz] = DOOR.stand;
    if (Math.hypot(px - sx, pz - sz) > DOOR.range) return null;
    const post = this.state.post;
    if (post && post.id !== this.selfId) {
      return { x: sx, z: sz, short: 'Kapı', label: `🛡️ Kapıda ${post.name} duruyor`, use: () => {} };
    }
    const q = this.state.queue;
    return {
      x: DOOR.podium[0], z: DOOR.podium[1], short: 'Kapı',
      label: `🛡️ VIP kapı — kürsüye geç (${q ? `sırada ${q} misafir` : 'sıra boş'})`,
      use: () => this.takePost(),
    };
  }

  async request(data) {
    if (this.pending) return { ok: false };
    this.pending = true;
    const res = await this.net.request(EVT.BOUNCER_ACT, data);
    this.pending = false;
    if (!res.ok && res.error) this.hud.toast(res.error, 'warn');
    return res;
  }

  async takePost() {
    const res = await this.request({ act: 'post' });
    if (res.ok) this.enterMode();
  }

  enterMode() {
    this.mode = true;
    const p = this.player;
    this.cam.x = p.pos.x;
    this.cam.z = p.pos.z;
    this.cam.eye = p.eye ?? 1.6;
    this.cam.yaw = p.yaw;
    this.cam.pitch = p.pitch ?? 0;
    this.player.setFollow(() => this.camPos, CAM.eye);
    this.interaction.setEnabled(false);
    this.hud.setPrompt?.(null);
    this.touch?.setLabel?.(null);
    document.body.classList.add('bc-door');
    this.el.hud.hidden = false;
    this.hudKey = '';
    this.engine.wake?.();
  }

  exitMode(send = true) {
    if (!this.mode) return;
    this.mode = false;
    this.player.setFollow(null);
    this.player.pitch = 0;
    const [sx, sz] = DOOR.stand;
    const yaw = yawTo(sx, sz, DOOR.check[0], DOOR.check[1]);
    this.player.setPose(sx, sz, yaw);
    this.net.sendMove(sx, sz, yaw);
    this.interaction.setEnabled(true);
    document.body.classList.remove('bc-door');
    this.el.hud.hidden = true;
    if (send) this.net.request(EVT.BOUNCER_ACT, { act: 'leave' });
    this.engine.wake?.();
  }

  async decide(admit) {
    const f = this.state?.front;
    if (!this.mode || !f) return;
    if (this.net.serverNow() < f.readyAt) {
      this.hud.toast('Misafir daha kapıya gelmedi.', 'info');
      return;
    }
    const res = await this.request({ act: 'decide', id: f.id, admit });
    if (res.ok && admit) this.sfx?.clink?.();
  }

  /** Aksiyon (E / tık): kapı modunda yutulur (yanlışlıkla karar verilmesin) */
  onAction() { return this.mode; }

  command(cmd) {
    if (!this.mode) return false;
    if (cmd === 'ringYes' || cmd === 'select:0') this.decide(true);
    else if (cmd === 'ringNo' || cmd === 'select:1') this.decide(false);
    else if (cmd === 'cycle') this.exitMode(true);
    return true; // kapı modunda diğer komutlar kapalı
  }

  onEscape() {
    if (!this.mode) return false;
    this.exitMode(true);
    return true;
  }

  update(dt) {
    if (!this.mode) return false;
    const k = Math.min(1, dt * 6);
    const c = this.cam;
    c.x += (CAM.x - c.x) * k;
    c.z += (CAM.z - c.z) * k;
    c.eye += (CAM.eye - c.eye) * k;
    c.yaw = lerpAngle(c.yaw, CAM.yaw, k);
    c.pitch += (CAM.pitch - c.pitch) * k;
    this.camPos.x = c.x;
    this.camPos.z = c.z;
    const p = this.player;
    p.eye = c.eye;
    p.yaw = c.yaw;
    p.pitch = c.pitch;
    p.pos.x = c.x;
    p.pos.z = c.z;
    p.apply();
    this.renderHud();
    return true;
  }

  // ---- HUD ---------------------------------------------------------------------------------------------

  buildHud() {
    const hud = el('div', 'panel');
    hud.id = 'bc-hud';
    hud.hidden = true;
    const head = el('div', 'bc-head');
    const code = el('div', 'bc-code');
    const amb = el('div', 'bc-amb');
    const ambBar = el('div', 'bc-bar');
    const ambFill = el('i');
    ambBar.append(ambFill);
    const guest = el('div', 'bc-guest');
    const last = el('div', 'bc-last');
    const btns = el('div', 'bc-btns');
    const yes = el('button', 'bc-yes', '✅ İçeri al (Y)');
    const no = el('button', 'bc-no', '❌ Geri çevir (N)');
    const quit = el('button', 'bc-quit', '✕ Kapıdan ayrıl (Q)');
    for (const b of [yes, no, quit]) b.type = 'button';
    yes.addEventListener('click', () => this.decide(true));
    no.addEventListener('click', () => this.decide(false));
    quit.addEventListener('click', () => this.exitMode(true));
    btns.append(yes, no, quit);
    hud.append(head, code, amb, ambBar, guest, last, btns);
    document.body.append(hud);
    this.el = { hud, head, code, amb, ambFill, guest, last, yes, no };
  }

  renderHud() {
    const s = this.state;
    if (!s) return;
    const f = s.front;
    const ready = !!f && this.net.serverNow() >= f.readyAt;
    const key = JSON.stringify([s.code, s.ambience, s.queue, f?.id, ready, s.last?.id, s.blacklist]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    const code = DRESS_CODE_BY_ID[s.code];
    this.el.head.textContent = `🛡️ VIP Kapı · sırada ${s.queue}`;
    this.el.code.replaceChildren(
      el('b', null, `Bu gece: ${code.icon} ${code.name}`),
      ...code.rules.map((r) => el('div', 'bc-rule', `• ${r}`)),
      el('div', 'bc-rule bc-black', `⛔ Kara liste: ${s.blacklist.join(', ')} · Davetiye: "${VENUE_NAME}", Gün ${s.day + 1}`),
    );
    this.el.amb.textContent = `✨ Ortam ${Math.round(s.ambience)}/100 · misafir ücreti ×${ambienceFeeMul(s.ambience).toFixed(2)}`;
    this.el.ambFill.style.width = `${Math.max(0, Math.min(100, s.ambience))}%`;
    const g = this.el.guest;
    if (!f) {
      g.replaceChildren(el('div', 'bc-empty', 'Sıra boş — misafir bekleniyor…'));
    } else {
      const c = f.card;
      const card = el('div', `bc-card ${c.type}`);
      card.append(
        el('div', 'bc-card-t', c.type === 'room' ? `🔑 Oda kartı · Oda ${c.room}` : '💌 Davetiye'),
        el('div', 'bc-card-n', c.name),
        el('div', 'bc-card-m', `${c.venue} · Gün ${c.day + 1}`),
      );
      const bad = CUES_BAD.includes(f.cue);
      const cue = el('div', `bc-cue${bad ? ' bad' : ''}`, `🗣️ ${f.cue}`);
      const list = el('ul', 'bc-dress');
      for (const l of dressLines(f.dress)) {
        const li = el('li');
        const sw = el('i', `bc-sw${l.neon ? ' neon' : ''}`);
        if (l.hex) sw.style.background = l.hex;
        li.append(sw, el('span', null, `${l.part}: ${l.name}${l.color ? ` · ${l.color}` : ''}`));
        list.append(li);
      }
      g.replaceChildren(el('div', 'bc-who', ready ? `👤 ${f.name}` : `👤 ${f.name} — kapıya geliyor…`), card, cue, list);
    }
    const l = s.last;
    this.el.last.textContent = l ? `${l.correct ? '✅' : '❌'} Son: ${l.name} ${l.admit ? 'içeri alındı' : 'geri çevrildi'}${l.reason ? ` (${l.reason})` : ''}${l.by === 'npc' ? ' · bouncer' : l.by === 'none' ? ' · kontrolsüz' : ''}` : '';
    this.el.yes.disabled = !ready;
    this.el.no.disabled = !ready;
  }
}
