import * as THREE from 'three';
import { EVT, ROOM_STATUS } from '/shared/constants.js';
import { ROOMS, BASE_FLOORS, isInsideRoom } from '/shared/layout.js';
import { ISSUE_BY_ID, ISSUE_IDS, MAINT_RULES, issueSpots, sinkBox } from '/shared/maintenance.js';

// ---- Görseller --------------------------------------------------------------------

function stainTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < 9; i++) {
    const x = 64 + (rnd() - 0.5) * 60;
    const y = 64 + (rnd() - 0.5) * 60;
    const r = 10 + rnd() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(70,40,18,0.9)');
    g.addColorStop(0.7, 'rgba(90,55,25,0.6)');
    g.addColorStop(1, 'rgba(90,55,25,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Odalarda detaylı temizlik ve tamirat (mini oyunlar).
 *  - Kirli odada yatak/çöp işlerine ek olarak 1–2 arıza çıkar (sunucu belirler):
 *    yerde / duvarda leke, patlak ampul, damlayan musluk, atan sigorta. Her arıza 3D'de görünür.
 *  - Arızaya bakıp E / Aksiyon → mini oyun paneli:
 *      🧽 Leke: bezle ovarak sil (fare / parmakla sürükle; leke %85 silinince biter)
 *      💡 Ampul: patlak ampulü basılı tutarak sök → yenisini al → basılı tutarak tak
 *      🔧 Musluk: gidip gelen ibre yeşil bölgedeyken "Sık!" (3 kez)
 *      ⚡ Sigorta: inen şalterleri kaldır, sonra ana şalteri kaldır
 *  - Sunucu, mini oyunun en kısa süresinden önce bitirmeyi kabul etmez. Odayı eksiksiz
 *    (tüm arızalar dahil) bitirene tamir başına ek bahşiş, hızlı bitirene hız bonusu verilir.
 *  - Pil: arızalar statik mesh'lerdir; mini oyun animasyonu yalnızca panel açıkken çalışır
 *    (3D motor panel açıkken zaten duraklatılmıştır).
 */
export class HotelMaintenanceSystem {
  constructor({ engine, net, hud, interaction, player, collision, modal, device, settings, sfx, vm }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.modal = modal;
    this.device = device;
    this.settings = settings;
    this.sfx = sfx;
    this.vm = vm;
    this.states = new Map(); // roomId → oda durumu (ROOMS)
    this.views = new Map(); // roomId → { [issue]: Object3D }
    this.game = null; // süren mini oyun
    this.pending = false;

    this.collision = collision;
    this.vmats = {
      stain: [0, 1, 2].map((i) => new THREE.MeshLambertMaterial({
        map: stainTexture(17 + i * 31), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      })),
      ceramic: new THREE.MeshLambertMaterial({ color: 0xf2f2ee }),
      chrome: new THREE.MeshLambertMaterial({ color: 0xb9bec4 }),
      grey: new THREE.MeshLambertMaterial({ color: 0x8a8f96 }),
      dark: new THREE.MeshBasicMaterial({ color: 0x2a2a2c }),
      water: new THREE.MeshBasicMaterial({ color: 0x8fc9ff, transparent: true, opacity: 0.75 }),
      red: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
      green: new THREE.MeshBasicMaterial({ color: 0x3cff7a }),
      mirror: new THREE.MeshLambertMaterial({ color: 0xbfd6e6 }),
    };
    // 1–4. katlar hemen; lüks katların odaları ilk ziyarette (addRooms, kat grubuna)
    ROOMS.forEach((room, ri) => { if (room.floor <= BASE_FLOORS) this.addRoom(room, ri, engine.scene); });
    this.applyAll();

    // Mini oyun paneli
    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('maint-panel'), title: $('maint-title'), hint: $('maint-hint'), stage: $('maint-stage'), fill: $('maint-fill'),
    };
    $('maint-cancel').addEventListener('click', () => this.modal.close(this.el.panel));
    this.onKey = (e) => {
      if (!this.game?.key) return;
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
        e.preventDefault();
        this.game.key();
      }
    };
    window.addEventListener('keydown', this.onKey);

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  /** Lüks katların odaları (HotelArchitectureUpgrades): arıza görselleri kat grubuna eklenir */
  addRooms(rooms, parent) {
    for (const room of rooms) {
      if (!this.views.has(room.id)) this.addRoom(room, ROOMS.indexOf(room), parent);
    }
    this.applyAll();
  }

  /** Tek odanın lavabosu ve arıza görselleri (statik mesh'ler; arızalar görünürlükle açılır) */
  addRoom(room, ri, scene) {
    const collision = this.collision;
    const {
      stain: stainMats, ceramic, chrome, grey, dark, water, red, green,
    } = this.vmats;
    const keep = (m) => {
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
      return m;
    };
    const s = room.side;
    const sp = issueSpots(room);
    const v = {};
    // Lavabo (her odada; statik)
    const sb = sinkBox(room);
    const sx = (sb.minX + sb.maxX) / 2;
    const z0 = room.bounds.minZ;
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.78, 10), ceramic);
    pedestal.position.set(sx, 0.39, z0 + 0.3);
    keep(pedestal);
    const basin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.44), ceramic);
    basin.position.set(sx, 0.86, z0 + 0.32);
    keep(basin);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), chrome);
    spout.position.set(sx, 1.02, z0 + 0.17);
    keep(spout);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.14), chrome);
    neck.position.set(sx, 1.11, z0 + 0.23);
    keep(neck);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.6), this.vmats.mirror);
    mirror.position.set(sx, 1.55, z0 + 0.105);
    keep(mirror);
    collision.add(sb.minX, sb.maxX, sb.minZ, sb.maxZ);
    // Musluk damlıyor: damla + su birikintisi
    const leak = new THREE.Group();
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5).scale(1, 1.4, 1), water);
    drop.position.set(sx, 1.0, z0 + 0.29);
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.26, 14).rotateX(-Math.PI / 2), water);
    puddle.position.set(sx + 0.1, 0.008, z0 + 0.75);
    leak.add(drop, puddle);
    scene.add(leak);
    v.faucet = leak;

    // Yerde leke
    const floorStain = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), stainMats[ri % 3]);
    floorStain.position.set(sp.stainFloor.x, 0.011, sp.stainFloor.z);
    v.stainFloor = keep(floorStain);
    // Duvarda leke (koridor duvarının oda tarafı)
    const wallStain = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.7), stainMats[(ri + 1) % 3]);
    wallStain.position.set(s * 1.605, sp.stainWall.y, sp.stainWall.z);
    wallStain.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    v.stainWall = keep(wallStain);
    // Patlak ampul: tavan lambasının altında koyu kapak + sarkan kırık ampul
    const bulb = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.CircleGeometry(0.23, 16).rotateX(Math.PI / 2), dark);
    cover.position.set(sp.bulb.x, 3.162, sp.bulb.z);
    const broken = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), grey);
    broken.position.set(sp.bulb.x, 3.08, sp.bulb.z);
    bulb.add(cover, broken);
    scene.add(bulb);
    v.bulb = bulb;
    // Sigorta kutusu (her odada; atınca kırmızı ışık)
    const fx = s * 1.65;
    const fuseBox = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.32), grey);
    fuseBox.position.set(fx, sp.fuse.y, sp.fuse.z);
    keep(fuseBox);
    const ledRed = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.05), red);
    ledRed.position.set(fx + s * 0.055, sp.fuse.y + 0.14, sp.fuse.z);
    const ledGreen = new THREE.Mesh(ledRed.geometry, green);
    ledGreen.position.copy(ledRed.position);
    for (const m of [ledRed, ledGreen]) {
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
    }
    v.fuse = ledRed;
    v.fuseOk = ledGreen;
    this.views.set(room.id, v);
  }

  // ---- Oda durumu ---------------------------------------------------------------------

  /** EVT.ROOMS / snapshot.rooms */
  onRooms(list) {
    for (const st of list ?? []) this.states.set(st.id, st);
    this.applyAll();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  pendingIssue(roomId, issue) {
    const st = this.states.get(roomId);
    return !!st && st.status === ROOM_STATUS.DIRTY && !!st.issues?.[issue];
  }

  applyAll() {
    for (const [roomId, v] of this.views) {
      for (const id of ISSUE_IDS) v[id].visible = this.pendingIssue(roomId, id);
      v.fuseOk.visible = !v.fuse.visible;
    }
  }

  // ---- Etkileşim --------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (this.game) return null;
    const room = ROOMS.find((r) => isInsideRoom(r, px, pz));
    if (!room) return null;
    const spots = issueSpots(room);
    let best = null;
    let bestScore = Infinity;
    for (const id of ISSUE_IDS) {
      if (!this.pendingIssue(room.id, id)) continue;
      const sp = spots[id];
      const dx = sp.x - px;
      const dz = sp.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > MAINT_RULES.RANGE) continue;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 0.6 && dot < 0.35) continue;
      const score = d - dot * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = { id, sp };
      }
    }
    if (!best) return null;
    const def = ISSUE_BY_ID[best.id];
    return {
      x: best.sp.x, z: best.sp.z, marker: !best.sp.wall && best.id !== 'bulb', short: def.icon,
      label: `${def.icon} ${def.label}`, use: () => this.start(room.id, best.id),
    };
  }

  async start(roomId, issue) {
    if (this.pending || this.game) return;
    this.pending = true;
    const res = await this.net.request(EVT.MAINT, { act: 'begin', roomId, issue });
    this.pending = false;
    if (!res.ok) {
      this.hud.toast(res.error || 'Başlatılamadı.', 'warn');
      return;
    }
    const def = ISSUE_BY_ID[issue];
    this.game = { roomId, issue, def, startedAt: performance.now(), done: false, key: null, cleanup: [] };
    this.el.title.textContent = `${def.icon} ${def.label}`;
    this.el.fill.style.width = '0%';
    this.el.stage.replaceChildren();
    this.modal.open(this.el.panel, () => this.endGame());
    const builder = { scrub: this.scrubGame, bulb: this.bulbGame, faucet: this.faucetGame, fuse: this.fuseGame }[def.game];
    builder.call(this, this.game);
  }

  progress(t) {
    this.el.fill.style.width = `${Math.round(Math.min(1, Math.max(0, t)) * 100)}%`;
  }

  /** Mini oyun başarıyla bitti → sunucuya bildir (en kısa süreyi bekleyerek) */
  async succeed(g) {
    if (g.done || this.game !== g) return;
    g.done = true;
    g.key = null;
    this.progress(1);
    this.el.hint.textContent = '✓ Tamam!';
    if (this.settings?.sound) this.sfx?.clink?.();
    const wait = g.def.minMs + MAINT_RULES.SLACK_MS - (performance.now() - g.startedAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await this.net.request(EVT.MAINT, { act: 'finish', roomId: g.roomId, issue: g.issue });
    if (this.game === g) this.modal.close(this.el.panel);
    if (!res.ok) {
      this.hud.toast(res.error || 'Olmadı.', 'warn');
      return;
    }
    // İyimser: arızayı hemen gizle (sunucunun ROOMS yayını doğrular)
    const st = this.states.get(g.roomId);
    if (st?.issues) st.issues[g.issue] = false;
    this.applyAll();
    this.vm?.play?.('pickup', 650, { item: 'paper' });
    this.hud.toast(`${g.def.icon} ${g.def.label.replace(/ (sil|değiştir|sık|kaldır)$/, '')} tamam!${res.finished ? ' Oda tertemiz ✨' : ''}`, 'clean');
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  endGame() {
    const g = this.game;
    this.game = null;
    if (!g) return;
    for (const fn of g.cleanup) fn();
    this.el.stage.replaceChildren();
    this.interaction.invalidate();
  }

  loop(g, fn) {
    let raf = 0;
    const tick = (t) => {
      if (this.game !== g || g.done) return;
      fn(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    g.cleanup.push(() => cancelAnimationFrame(raf));
  }

  // ---- 🧽 Leke: ovarak sil (kazı-kazan) --------------------------------------------------

  scrubGame(g) {
    this.el.hint.textContent = this.device.touch ? 'Parmağınla lekenin üstünde ov.' : 'Fareyi basılı tutup lekenin üstünde ov.';
    const W = 180;
    const H = 120;
    const wrap = document.createElement('div');
    wrap.className = 'maint-scrub';
    const bg = document.createElement('canvas');
    const stain = document.createElement('canvas');
    for (const c of [bg, stain]) {
      c.width = W;
      c.height = H;
      wrap.append(c);
    }
    const b = bg.getContext('2d');
    const wall = g.issue === 'stainWall';
    b.fillStyle = wall ? '#e9e0cf' : '#b98a5a';
    b.fillRect(0, 0, W, H);
    b.strokeStyle = wall ? 'rgba(0,0,0,0.05)' : 'rgba(60,35,15,0.25)';
    for (let x = 0; x < W; x += wall ? 30 : 22) {
      b.beginPath();
      b.moveTo(x, 0);
      b.lineTo(x, H);
      b.stroke();
    }
    const s = stain.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const x = 40 + Math.random() * (W - 80);
      const y = 25 + Math.random() * (H - 50);
      const r = 10 + Math.random() * 22;
      const grd = s.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(80,45,18,0.95)');
      grd.addColorStop(1, 'rgba(80,45,18,0)');
      s.fillStyle = grd;
      s.beginPath();
      s.arc(x, y, r, 0, Math.PI * 2);
      s.fill();
    }
    const total = (() => {
      const d = s.getImageData(0, 0, W, H).data;
      let a = 0;
      for (let i = 3; i < d.length; i += 4) a += d[i];
      return a || 1;
    })();
    s.globalCompositeOperation = 'destination-out';
    let rubbing = false;
    let moves = 0;
    const rub = (e) => {
      const r = stain.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W;
      const y = ((e.clientY - r.top) / r.height) * H;
      // Bez: ortası tam siler, kenarı yumuşak (birkaç geçişte tertemiz)
      const grd = s.createRadialGradient(x, y, 0, x, y, 20);
      grd.addColorStop(0, 'rgba(0,0,0,0.9)');
      grd.addColorStop(0.6, 'rgba(0,0,0,0.6)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      s.fillStyle = grd;
      s.beginPath();
      s.arc(x, y, 20, 0, Math.PI * 2);
      s.fill();
      if (++moves % 5) return;
      const d = s.getImageData(0, 0, W, H).data;
      let a = 0;
      for (let i = 3; i < d.length; i += 4) a += d[i];
      const cleaned = 1 - a / total;
      this.progress(cleaned / 0.85);
      if (cleaned >= 0.85) this.succeed(g);
    };
    stain.addEventListener('pointerdown', (e) => {
      rubbing = true;
      stain.setPointerCapture?.(e.pointerId);
      rub(e);
    });
    stain.addEventListener('pointermove', (e) => { if (rubbing) rub(e); });
    const stop = () => { rubbing = false; };
    stain.addEventListener('pointerup', stop);
    stain.addEventListener('pointercancel', stop);
    this.el.stage.append(wrap);
  }

  // ---- 💡 Ampul: sök → al → tak ----------------------------------------------------------

  bulbGame(g) {
    const box = document.createElement('div');
    box.className = 'maint-bulb';
    box.innerHTML = '<div class="socket"></div><div class="bulb broken">💡</div>';
    const bulbEl = box.querySelector('.bulb');
    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'primary';
    take.textContent = '📦 Kutudan yeni ampul al';
    take.hidden = true;
    this.el.stage.append(box, take);
    let phase = 0; // 0 sök, 1 al, 2 tak
    let hold = 0;
    let holding = false;
    const HOLD_MS = 900;
    const hints = ['Patlak ampulü sökmek için üstüne basılı tut.', 'Kutudan yeni bir ampul al.', 'Yeni ampulü takmak için basılı tut.'];
    this.el.hint.textContent = hints[0];
    // Ampul dönerken imlecin altından kayar: tutuş, işaretçi yakalanarak bırakılana kadar sürer
    bulbEl.addEventListener('pointerdown', (e) => {
      holding = phase !== 1;
      bulbEl.setPointerCapture?.(e.pointerId);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) bulbEl.addEventListener(ev, () => { holding = false; });
    g.key = () => {
      if (phase === 1) take.click();
    };
    take.addEventListener('click', () => {
      if (phase !== 1) return;
      phase = 2;
      hold = 0;
      take.hidden = true;
      bulbEl.hidden = false;
      bulbEl.classList.remove('broken');
      bulbEl.style.transform = 'translateY(30px)';
      this.el.hint.textContent = hints[2];
    });
    let last = performance.now();
    this.loop(g, (t) => {
      const dt = t - last;
      last = t;
      if (!holding || phase === 1) return;
      hold = Math.min(HOLD_MS, hold + dt);
      const k = hold / HOLD_MS;
      bulbEl.style.transform = phase === 0 ? `translateY(${k * 30}px) rotate(${k * 540}deg)` : `translateY(${(1 - k) * 30}px) rotate(${(1 - k) * 540}deg)`;
      this.progress(phase === 0 ? k * 0.45 : 0.55 + k * 0.45);
      if (hold < HOLD_MS) return;
      holding = false;
      if (phase === 0) {
        phase = 1;
        bulbEl.hidden = true;
        take.hidden = false;
        this.progress(0.5);
        this.el.hint.textContent = hints[1];
      } else {
        bulbEl.classList.add('lit');
        this.succeed(g);
      }
    });
  }

  // ---- 🔧 Musluk: zamanlama --------------------------------------------------------------

  faucetGame(g) {
    const bar = document.createElement('div');
    bar.className = 'maint-timing';
    bar.innerHTML = '<i class="zone"></i><b class="needle"></b>';
    const zone = bar.querySelector('.zone');
    const needle = bar.querySelector('.needle');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary';
    btn.textContent = '🔧 Sık!';
    const drops = document.createElement('div');
    drops.className = 'maint-drops';
    this.el.stage.append(drops, bar, btn);
    const NEED = 3;
    let hits = 0;
    let width = 0.24;
    let center = 0.3 + Math.random() * 0.4;
    let pos = 0;
    let speed = 0.85; // tur/sn (git-gel)
    const setZone = () => {
      zone.style.left = `${(center - width / 2) * 100}%`;
      zone.style.width = `${width * 100}%`;
      drops.textContent = '💧'.repeat(NEED - hits) || '✨';
    };
    setZone();
    this.el.hint.textContent = `İbre yeşil bölgedeyken "Sık!"a bas${this.device.touch ? '' : ' (ya da Boşluk / E)'} — ${NEED} kez.`;
    const press = () => {
      if (g.done) return;
      if (Math.abs(pos - center) <= width / 2) {
        hits++;
        this.progress(hits / NEED);
        if (hits >= NEED) {
          drops.textContent = '✨';
          this.succeed(g);
          return;
        }
        width = Math.max(0.12, width - 0.05);
        speed += 0.2;
        center = 0.15 + Math.random() * 0.7;
        setZone();
        this.el.hint.textContent = `Güzel! ${NEED - hits} kez daha.`;
      } else {
        bar.classList.remove('miss');
        void bar.offsetWidth;
        bar.classList.add('miss');
        this.el.hint.textContent = 'Kaçtı — ibreyi yeşilde yakala!';
      }
    };
    btn.addEventListener('click', press);
    g.key = press;
    const t0 = performance.now();
    this.loop(g, (t) => {
      const ph = ((t - t0) / 1000) * speed;
      pos = Math.abs(((ph % 2) + 2) % 2 - 1); // 0→1→0 üçgen dalga
      needle.style.left = `${pos * 100}%`;
    });
  }

  // ---- ⚡ Sigorta: şalterleri kaldır ---------------------------------------------------------

  fuseGame(g) {
    const panel = document.createElement('div');
    panel.className = 'maint-fuse';
    const N = 6;
    const tripped = new Set();
    while (tripped.size < 2 + Math.floor(Math.random() * 2)) tripped.add(Math.floor(Math.random() * N));
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'main down';
    main.textContent = 'ANA ŞALTER';
    main.disabled = true;
    const total = tripped.size;
    this.el.hint.textContent = 'Kırmızı (inmiş) şalterleri kaldır, sonra ana şalteri kaldır.';
    for (let i = 0; i < N; i++) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = `sw ${tripped.has(i) ? 'down' : 'up'}`;
      sw.textContent = `${i + 1}`;
      sw.addEventListener('click', () => {
        if (!tripped.has(i)) return;
        tripped.delete(i);
        sw.className = 'sw up';
        this.progress(((total - tripped.size) / total) * 0.8);
        if (!tripped.size) {
          main.disabled = false;
          this.el.hint.textContent = 'Şimdi ana şalteri kaldır!';
        }
      });
      panel.append(sw);
    }
    main.addEventListener('click', () => {
      if (tripped.size) return;
      main.className = 'main up';
      this.succeed(g);
    });
    this.el.stage.append(panel, main);
  }
}
