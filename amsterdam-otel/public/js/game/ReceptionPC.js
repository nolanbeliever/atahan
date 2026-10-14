import * as THREE from 'three';
import { EVT, ROOM_STATUS, formatMoney, roomFloor } from '/shared/constants.js';
import { RECEPTION_PC, ELEVATOR, floorAt } from '/shared/layout.js';
import { FLOOR_UPGRADES, MAX_FLOOR, STAR_THRESHOLDS, INSPECTION } from '/shared/hotel.js';
import { makePanel } from '../world/Props.js';

/** Hedef oyuncunun önünde mi (mesafe + bakış açısı) */
function facing(px, pz, f, x, z, range, minDot = 0.35) {
  const dx = x - px;
  const dz = z - pz;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  return d < 0.6 || (dx * f.x + dz * f.z) / d >= minDot;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** Cephedeki yıldız tabelası (★★★☆☆) — yalnızca yıldız değişince yeniden çizilir */
function drawStars(ctx, w, h, stars) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1b2a3a';
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, h - 8, 14);
  ctx.fill();
  ctx.strokeStyle = '#c9a25e';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.font = `700 ${Math.round(h * 0.62)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = (w - 40) / 5;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < stars ? '#ffd23f' : 'rgba(255,255,255,0.18)';
    ctx.fillText('★', 20 + step * (i + 0.5), h / 2 + 2);
  }
}

/**
 * Resepsiyon bilgisayarı + asansör.
 *  - Resepsiyon masasındaki monitörde E → panel: Genel (yıldız, itibar, kasa, odalar, denetim),
 *    Yükseltmeler (kasa parasıyla üst kat), Çalışanlar (temizlikçi al / çıkar — HotelWorkerSystem çizer).
 *  - Lobideki ve her katın sahanlığındaki asansör kapısında E → kat seçimi; sunucu konumu
 *    doğrulayıp oyuncuyu kata ışınlar (kısa kararma geçişi).
 *  - HUD'daki yıldızlar, oda listesinin kat filtresi ve cephedeki yıldız tabelası.
 * Pil: panel yalnızca açıkken ve durum değişince çizilir; karede iş yok.
 */
export class ReceptionPC {
  constructor({ engine, net, hud, interaction, player, modal, device, sfx, state, workers }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.modal = modal;
    this.device = device;
    this.sfx = sfx;
    this.state = state;
    this.workers = workers; // HotelWorkerSystem (Çalışanlar sekmesi)
    this.hotel = { growth: { reputation: 0, stars: 1, next: STAR_THRESHOLDS[1], floors: 1, plaques: 0 }, workers: [], inspection: { active: null } };
    this.tab = 'overview';
    this.busy = false;
    this.onChange = []; // durum değişince haber verilecekler (denetim, işçi sistemi)

    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('pc-panel'), body: $('pc-body'), tabs: $('pc-tabs'), msg: $('pc-msg'),
      lift: $('lift-panel'), liftList: $('lift-floors'), liftMsg: $('lift-msg'), fade: $('lift-fade'),
    };
    $('pc-close').addEventListener('click', () => this.modal.close(this.el.panel));
    $('lift-close').addEventListener('click', () => this.modal.close(this.el.lift));
    this.el.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      this.tab = b.dataset.tab;
      this.render();
    });

    // Cephedeki yıldız tabelası (HOTEL tabelasının sağında)
    this.starCanvas = document.createElement('canvas');
    this.starCanvas.width = 320;
    this.starCanvas.height = 84;
    this.starTex = new THREE.CanvasTexture(this.starCanvas);
    this.starTex.colorSpace = THREE.SRGBColorSpace;
    const starMat = new THREE.MeshBasicMaterial({ map: this.starTex, transparent: true });
    engine.scene.add(makePanel(starMat, 1.25, 0.33, 2.62, 3.73, -0.125, 'z-'));
    this.drawnStars = -1;
    this.updateStarSign(1);

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  get growth() { return this.hotel.growth; }

  // ---- Durum ------------------------------------------------------------------------

  /** snapshot.hotel / EVT.HOTEL_STATE */
  setState(h) {
    if (!h) return;
    this.hotel = h;
    const g = h.growth;
    this.hud.setStars(g.stars, g.reputation, g.next);
    this.hud.setFloors(g.floors);
    this.updateStarSign(g.stars);
    if (!this.el.panel.hidden) this.render();
    if (!this.el.lift.hidden) this.renderLift();
    for (const cb of this.onChange) cb(h);
    this.interaction.invalidate();
  }

  /** Kasa / oda değişince açık paneli tazele */
  refresh() {
    if (!this.el.panel.hidden) this.render();
  }

  updateStarSign(stars) {
    if (this.drawnStars === stars) return;
    this.drawnStars = stars;
    drawStars(this.starCanvas.getContext('2d'), this.starCanvas.width, this.starCanvas.height, stars);
    this.starTex.needsUpdate = true;
    this.engine.requestRender();
  }

  // ---- Etkileşim -----------------------------------------------------------------------

  findTarget(px, pz, f) {
    const [mx, mz] = RECEPTION_PC.point;
    if (facing(px, pz, f, mx, mz, RECEPTION_PC.range) && facing(px, pz, f, RECEPTION_PC.monitor[0], RECEPTION_PC.monitor[1], 2.2, 0.2)) {
      return {
        x: mx, z: mz, short: 'PC', label: '💻 Resepsiyon bilgisayarı (yükseltmeler, çalışanlar)', use: () => this.openPc(),
      };
    }
    const floor = floorAt(px, pz);
    const e = floor === 1 ? ELEVATOR.lobby : ELEVATOR.floor(floor);
    if (facing(px, pz, f, e.point[0], e.point[1], ELEVATOR.range, 0.2)) {
      const n = this.growth.floors;
      return {
        x: e.point[0],
        z: e.point[1],
        short: 'Asansör',
        label: n > 1 ? `🛗 Asansör (${floor}. kattasın)` : '🛗 Asansör — üst kat yok (Resepsiyon PC\'den kat ekle)',
        use: () => this.openLift(floor),
      };
    }
    return null;
  }

  // ---- Resepsiyon PC paneli ---------------------------------------------------------------

  openPc() {
    this.el.msg.textContent = '';
    this.render();
    this.modal.open(this.el.panel);
  }

  say(text, ok = false) {
    this.el.msg.textContent = text || '';
    this.el.msg.className = `note ${ok ? 'ok' : ''}`;
  }

  async act(data, okText) {
    if (this.busy) return null;
    this.busy = true;
    const res = await this.net.request(EVT.HOTEL_ACT, data);
    this.busy = false;
    if (!res.ok) {
      this.say(res.error || 'Olmadı.');
      return res;
    }
    if (okText) this.say(okText, true);
    return res;
  }

  render() {
    for (const b of this.el.tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const body = this.el.body;
    body.replaceChildren();
    if (this.tab === 'upgrades') this.renderUpgrades(body);
    else if (this.tab === 'workers') this.workers.renderTab(body, this);
    else this.renderOverview(body);
  }

  renderOverview(body) {
    const g = this.growth;
    const money = this.state.economy?.money ?? 0;
    const stars = el('div', 'pc-stars', `${'★'.repeat(g.stars)}${'☆'.repeat(5 - g.stars)}`);
    const lo = STAR_THRESHOLDS[g.stars - 1];
    const bar = el('div', 'pc-bar');
    const fill = el('i');
    fill.style.width = g.next ? `${Math.round(((g.reputation - lo) / (g.next - lo)) * 100)}%` : '100%';
    bar.append(fill);
    const repText = el('div', 'pc-small', g.next
      ? `İtibar ${g.reputation} · sonraki yıldız ${g.next}'de (temiz oda +2, yerleşen misafir +1, odasız giden misafir −2)`
      : `İtibar ${g.reputation} · en yüksek seviye!`);

    const rooms = [...this.state.rooms.values()].filter((r) => roomFloor(r.id) <= g.floors);
    const count = (st) => rooms.filter((r) => r.status === st).length;
    const grid = el('div', 'pc-grid');
    const stat = (label, value) => {
      const c = el('div', 'pc-stat');
      c.append(el('small', null, label), el('b', null, value));
      return c;
    };
    grid.append(
      stat('Kasa', formatMoney(money)),
      stat('Kat / oda', `${g.floors} kat · ${rooms.length} oda`),
      stat('Boş · Dolu · Kirli', `${count(ROOM_STATUS.EMPTY)} · ${count(ROOM_STATUS.OCCUPIED)} · ${count(ROOM_STATUS.DIRTY)}`),
      stat('Temizlikçi', `${this.hotel.workers.length}`),
      stat('Onay plaketi', g.plaques ? `🏅 × ${g.plaques}` : '—'),
      stat('Bugün', formatMoney(this.state.economy?.today?.earned ?? 0)),
    );

    const insp = el('div', 'pc-insp');
    const ins = this.hotel.inspection;
    insp.append(el('b', null, '🏛️ Belediye denetimi'));
    let info;
    if (ins.active) info = 'Denetim sürüyor! Ekranın üstündeki listeye bak.';
    else if (g.stars < INSPECTION.MIN_STARS) info = `Otel ${INSPECTION.MIN_STARS}★ olunca müfettiş hafta içi habersiz gelebilir.`;
    else if (ins.doneToday) info = 'Bugün denetlendiniz.';
    else info = `Müfettiş hafta içi habersiz gelebilir; hazırsan şimdi çağır. Başarı: ödül + plaket. Başarısızlık: €${INSPECTION.FINE} ceza, bir yıldız kaybı.`;
    insp.append(el('div', 'pc-small', info));
    if (ins.last) insp.append(el('div', `pc-small ${ins.last.pass ? 'ok' : 'bad'}`, ins.last.pass ? 'Son denetim: ✅ başarılı' : 'Son denetim: ❌ başarısız'));
    if (!ins.active && g.stars >= INSPECTION.MIN_STARS && !ins.doneToday) {
      const btn = el('button', 'pc-btn', '🏛️ Müfettişi çağır');
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        const res = await this.act({ act: 'inspect' }, 'Müfettiş yolda!');
        if (res?.ok) this.modal.close(this.el.panel);
      });
      insp.append(btn);
    }
    body.append(stars, bar, repText, grid, insp);
  }

  renderUpgrades(body) {
    const g = this.growth;
    const money = this.state.economy?.money ?? 0;
    body.append(el('p', 'pc-small', 'Her kat 4 oda ekler, misafirler daha sık gelir. Parası otelin kasasından ödenir. Üst katlara lobideki asansörle (resepsiyonun kuzeyi) çıkılır.'));
    const list = el('div', 'pc-list');
    const ground = el('div', 'product');
    ground.append(el('div', 'icon', '🏨'), (() => {
      const d = el('div');
      d.append(el('div', 'name', '1. kat · Oda 101–104'), el('div', 'owned', 'Açık ✓'));
      return d;
    })(), el('span'));
    list.append(ground);
    for (const up of FLOOR_UPGRADES) {
      const row = el('div', 'product');
      const info = el('div');
      info.append(el('div', 'name', `${up.floor}. kat · Oda ${up.floor}01–${up.floor}04`));
      const open = g.floors >= up.floor;
      let note;
      if (open) note = el('div', 'owned', 'Açık ✓');
      else note = el('div', 'desc', `${formatMoney(up.price)} · en az ${up.stars}★${g.stars < up.stars ? ` (şu an ${g.stars}★)` : ''}`);
      info.append(note);
      const btn = el('button', null, open ? '✓' : 'İnşa et');
      btn.type = 'button';
      btn.disabled = open || up.floor !== g.floors + 1 || g.stars < up.stars || money < up.price;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = await this.act({ act: 'buyFloor', floor: up.floor }, `🏗️ ${up.floor}. kat açıldı! Asansörle çık.`);
        if (!res?.ok) btn.disabled = false;
      });
      row.append(el('div', 'icon', open ? '🏢' : '🏗️'), info, btn);
      list.append(row);
    }
    this.stage?.renderUpgradeRow(list, this); // 🎤 Canlı müzik sahnesi (LiveStageSystem)
    body.append(list);
    if (g.floors < MAX_FLOOR) {
      const up = FLOOR_UPGRADES[g.floors - 1];
      const why = g.stars < up.stars ? `Önce otelin ${up.stars} yıldız olması gerek.` : money < up.price ? `Kasada ${formatMoney(up.price - money)} daha lazım.` : 'Hazır — inşa edebilirsin!';
      body.append(el('p', 'pc-small', `Sıradaki: ${up.floor}. kat. ${why}`));
    }
  }

  // ---- Asansör -------------------------------------------------------------------------

  openLift(floor) {
    this.liftFrom = floor;
    this.el.liftMsg.textContent = '';
    this.renderLift();
    this.modal.open(this.el.lift);
  }

  renderLift() {
    const n = this.growth.floors;
    const list = this.el.liftList;
    list.replaceChildren();
    for (let f = MAX_FLOOR; f >= 1; f--) {
      const b = el('button', 'lift-btn', String(f));
      b.type = 'button';
      const here = f === this.liftFrom;
      b.classList.toggle('here', here);
      b.disabled = here || f > n;
      b.title = f > n ? 'Henüz yok' : here ? 'Buradasın' : `${f}. kata git`;
      b.addEventListener('click', () => this.ride(f));
      list.append(b);
    }
    if (n === 1) this.el.liftMsg.textContent = 'Henüz üst kat yok — Resepsiyon PC → Yükseltmeler.';
  }

  async ride(floor) {
    if (this.busy) return;
    this.busy = true;
    const res = await this.net.request(EVT.HOTEL_ACT, { act: 'elevator', floor });
    this.busy = false;
    if (!res.ok) {
      this.el.liftMsg.textContent = res.error || 'Asansör çalışmadı.';
      return;
    }
    this.modal.close(this.el.lift);
    // Kısa kararma: ışınlanma asansör yolculuğu gibi görünsün
    const fade = this.el.fade;
    fade.textContent = `🛗 ${floor}. kat`;
    fade.hidden = false;
    fade.classList.add('on');
    this.sfx?.clink?.();
    this.player.setPose(res.x, res.z, res.yaw);
    this.net.sendMove(res.x, res.z, res.yaw);
    this.net.flushMove?.();
    this.interaction.invalidate();
    this.engine.wake();
    setTimeout(() => {
      fade.classList.remove('on');
      setTimeout(() => { fade.hidden = true; }, 350);
    }, 450);
  }
}
