import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { CAR_BY_ID, DRAG_TRACK as T, DRAG_LANES, stageLaneAt } from '/shared/cars.js';
import { buildDragStrip } from '../world/DragStripBuilding.js';

const BULBS = Object.freeze([
  // [ad, y, açık renk, kapalı renk, yarıçap]
  ['pre', 3.05, 0xfff4c8, 0x3a3524, 0.07],
  ['stage', 2.85, 0xfff4c8, 0x3a3524, 0.07],
  ['a1', 2.45, 0xffb21a, 0x3a2a08, 0.11],
  ['a2', 2.15, 0xffb21a, 0x3a2a08, 0.11],
  ['a3', 1.85, 0xffb21a, 0x3a2a08, 0.11],
  ['green', 1.5, 0x2cff6a, 0x0b3018, 0.12],
  ['red', 1.16, 0xff2a2a, 0x3a0a0a, 0.11],
]);
const FOUL = Object.freeze({ jump: 'KIRMIZI IŞIK', lane: 'ŞERİT İHLALİ', invalid: 'GEÇERSİZ', dnf: 'DNF', left: 'AYRILDI' });
const sec = (v) => (v == null ? '—' : v.toFixed(3));

/**
 * Drag pisti (istemci): sahne + yarış arayüzü.
 *  - Pist grubu (DragStripBuilding) UndergroundGarage alan yöneticisine 'drag' olarak kaydolur:
 *    yalnızca oyuncu oradayken görünür, kamera uzak düzlemi 700 m'ye çıkar, otel dünyası çizilmez.
 *  - Sahneye giriş otomatik: arabayla şeridinde çizginin gerisinde dur (≈0.6 sn) → seçili moda
 *    (🏁 Solo / ⚔️ Düello) göre sunucuya 'stage'. Işık ağacı sunucunun treeAt / greenAt zamanlarıyla
 *    senkron yanar (ön sahne / sahne / 3 sarı / yeşil; kırmızı = jump start).
 *  - Sürerken alttaki göstergede canlı süre; sonuç sunucudan gelir (RT, 0–100, 1/8, 1/4 mil ET, hız
 *    tuzağı, kazanan). Bitiş köprüsündeki şerit tabloları ve paddock tabelası (son yarış + ilk 5)
 *    yalnızca sonuç değişince yeniden çizilir. 🏆 düğmesi liderlik tablosunu açar.
 *  - Ses: yarışçıysan sarılarda kısa bip, yeşilde tiz bip (paylaşılan Sfx bağlamı).
 * Pil: pist dışında update hemen döner; pistte de yalnızca geri sayım / yarış sürerken ya da
 * sürerken kare istenir.
 */
export class DragRaceTrack {
  constructor({ engine, net, hud, player, modal, device, settings, sfx, garage, vehicles, remotes, state, input }) {
    Object.assign(this, { engine, net, hud, player, modal, device, settings, sfx, garage, vehicles, remotes, state });
    // Masaüstünde fare kilitliyken panel düğmelerine tıklanmaz: G = Solo / Düello, L = liderlik tablosu
    input?.onCommand((cmd) => {
      if (this.garage.area !== 'drag') return false;
      if (cmd === 'dragMode') this.setMode(this.mode === 'solo' ? 'duel' : 'solo');
      else if (cmd === 'dragBoard') this.openBoard();
      else return false;
      return true;
    });
    this.st = { phase: 'idle', racers: [], last: null, board: [] };
    this.mode = 'solo';
    this.stillFor = 0;
    this.pending = false;
    this.latch = false; // sonuçtan sonra sahne kutusundan çıkmadan yeniden sahneye girilmez
    this.lastBoardRun = -1;
    this.beeped = -1;
    this.localFinish = null;
    this.resultUntil = 0;

    const strip = buildDragStrip({ collision: garage.collision });
    this.strip = strip;
    engine.scene.add(strip.group);
    garage.addArea('drag', strip.group, 700);
    this.buildTree(strip.group);
    this.buildBoards(strip.group);

    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('drag-hud'), status: $('drag-status'), solo: $('drag-solo'), duel: $('drag-duel'), boardBtn: $('drag-board-btn'),
      result: $('drag-result'), panel: $('drag-panel'), table: $('drag-table'), modes: $('drag-modes'),
    };
    this.el.solo.addEventListener('click', () => this.setMode('solo'));
    this.el.duel.addEventListener('click', () => this.setMode('duel'));
    this.el.boardBtn.addEventListener('click', () => this.openBoard());
    $('drag-close').addEventListener('click', () => this.modal.close(this.el.panel));
    const prev = garage.onArea;
    garage.onArea = (id, from) => {
      prev?.(id, from);
      this.onArea(id);
    };
  }

  // ---- Sahne parçaları -------------------------------------------------------------------------

  buildTree(group) {
    const t = T.tree;
    const g = new THREE.Group();
    g.position.set(t.x, 0.35, t.z);
    const housing = new THREE.MeshLambertMaterial({ color: 0x1a1c1f });
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.2, 0.16), housing);
    pole.position.y = 1.6;
    g.add(pole);
    this.bulbs = Object.create(null);
    for (const lane of DRAG_LANES) {
      const sx = lane === 'L' ? -1 : 1;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 2.2, 0.2), housing);
      box.position.set(sx * 0.27, 2.1, 0);
      g.add(box);
      this.bulbs[lane] = Object.create(null);
      for (const [name, y, on, off, r] of BULBS) {
        const mat = new THREE.MeshBasicMaterial({ color: off });
        const m = new THREE.Mesh(new THREE.CircleGeometry(r, 14), mat);
        m.position.set(sx * 0.27 + (name === 'pre' || name === 'stage' ? sx * 0.06 : 0), y, 0.105);
        g.add(m);
        this.bulbs[lane][name] = { mat, on, off, lit: false };
      }
    }
    group.add(g);
  }

  setBulb(lane, name, lit) {
    const b = this.bulbs[lane][name];
    if (b.lit === lit) return false;
    b.lit = lit;
    b.mat.color.setHex(lit ? b.on : b.off);
    return true;
  }

  buildBoards(group) {
    this.boards = Object.create(null);
    const make = (w, h, x, y, z, pw, ph) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: tex }));
      m.position.set(x, y, z);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      group.add(m);
      return { c, tex };
    };
    // Bitiş köprüsünün altında iki şerit tablosu (yaklaşan arabalara bakar)
    for (const lane of DRAG_LANES) this.boards[lane] = make(512, 160, T.lanes[lane].x, 5.55, T.finishZ + 0.33, 4.4, 1.38);
    // Paddock tabelası (son yarış + ilk 5)
    this.boards.start = make(512, 384, 163, 3.3, 9.25, 8.2, 3.6);
    this.drawBoards();
  }

  drawBoards() {
    const last = this.st.last;
    for (const lane of DRAG_LANES) {
      const { c, tex } = this.boards[lane];
      const g = c.getContext('2d');
      g.fillStyle = '#07090c';
      g.fillRect(0, 0, c.width, c.height);
      const r = last?.results?.find((x) => x.lane === lane);
      g.fillStyle = '#ff7a1a';
      g.font = '800 30px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(lane === 'L' ? 'SOL' : 'SAĞ', 18, 40);
      g.textAlign = 'right';
      g.fillStyle = '#9fe2ff';
      g.font = '700 26px system-ui, sans-serif';
      g.fillText(r ? r.name : '—', 494, 40);
      g.textAlign = 'center';
      if (!r) {
        g.fillStyle = '#5a6470';
        g.font = '700 40px ui-monospace, monospace';
        g.fillText('-.---', 256, 118);
      } else if (r.foul) {
        g.fillStyle = '#ff3b30';
        g.font = '800 46px system-ui, sans-serif';
        g.fillText(FOUL[r.foul] ?? 'DNF', 256, 118);
      } else {
        g.fillStyle = r.win ? '#2cff6a' : '#ffd27a';
        g.font = '800 54px ui-monospace, monospace';
        g.fillText(`${sec(r.et)} s`, 256, 108);
        g.fillStyle = '#ffffff';
        g.font = '600 24px ui-monospace, monospace';
        g.fillText(`RT ${sec(r.rt)} · ${Math.round(r.trap)} km/s${r.win ? ' · 🏆' : ''}`, 256, 146);
      }
      tex.needsUpdate = true;
    }
    const { c, tex } = this.boards.start;
    const g = c.getContext('2d');
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ff7a1a';
    g.font = '800 34px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('🏆 EN İYİ ¼ MİL', 256, 44);
    g.font = '600 24px ui-monospace, monospace';
    g.textAlign = 'left';
    const board = this.st.board ?? [];
    for (let i = 0; i < 6; i++) {
      const e = board[i];
      g.fillStyle = i === 0 ? '#ffd27a' : '#e8edf2';
      const y = 92 + i * 44;
      g.fillText(`${i + 1}.`, 24, y);
      g.fillText(e ? e.name.slice(0, 12) : '—', 70, y);
      g.textAlign = 'right';
      g.fillText(e ? `${sec(e.et)} s` : '', 488, y);
      g.textAlign = 'left';
    }
    tex.needsUpdate = true;
    this.engine.requestRender();
  }

  // ---- Sunucu durumu ---------------------------------------------------------------------------

  onState(s) {
    if (!s) return;
    const prevRun = this.st.last?.runNo;
    this.st = s;
    if (s.last && s.last.runNo !== prevRun && s.last.runNo !== this.lastBoardRun) {
      this.lastBoardRun = s.last.runNo;
      const mine = s.last.results.find((x) => x.id === this.vehicles.selfId);
      if (mine) {
        this.showResult(mine, s.last);
        this.latch = true;
      }
      this.resultUntil = performance.now() + 5000;
    }
    this.drawBoards();
    if (!this.el.panel.hidden) this.renderBoard();
    this.updateHud(true);
    this.engine.wake();
  }

  showResult(r, last) {
    this.localFinish = null;
    const el = this.el.result;
    el.hidden = false;
    el.replaceChildren();
    const mk = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      e.textContent = text;
      return e;
    };
    const head = r.foul ? `🔴 ${FOUL[r.foul] ?? 'Bitmedi'}` : last.mode === 'duel' ? (r.win ? '🏆 KAZANDIN!' : '🥈 Kaybettin') : '🏁 Koşu tamam';
    el.append(mk('b', r.foul ? 'bad' : r.win ? 'win' : '', head));
    if (!r.foul) {
      const grid = mk('div', 'drag-grid', '');
      for (const [k, v] of [['Reaksiyon', `${sec(r.rt)} s`], ['0–100', `${r.t100 == null ? '—' : r.t100.toFixed(2)} s`], ['⅛ mil', `${sec(r.e8)} s`], ['¼ mil ET', `${sec(r.et)} s`], ['Hız tuzağı', `${Math.round(r.trap)} km/s`], ['Toplam', `${sec(r.total)} s`]]) {
        grid.append(mk('span', null, k), mk('b', null, v));
      }
      el.append(grid);
    }
    clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => { el.hidden = true; }, 12_000);
  }

  // ---- Arayüz ------------------------------------------------------------------------------------

  onArea(id) {
    this.el.hud.hidden = id !== 'drag';
    if (id === 'drag') this.updateHud(true);
    else this.garage.cockpit.setTimer(null);
  }

  setMode(m) {
    this.mode = m;
    this.updateHud(true);
  }

  myRacer() {
    return this.st.racers?.find((r) => r.id === this.vehicles.selfId) ?? null;
  }

  updateHud(force = false) {
    if (this.garage.area !== 'drag') return;
    this.el.solo.classList.toggle('on', this.mode === 'solo');
    this.el.duel.classList.toggle('on', this.mode === 'duel');
    const driving = this.vehicles.drivingCar;
    this.el.modes.hidden = !driving;
    const me = this.myRacer();
    const st = this.st;
    let text;
    if (!driving) text = 'Arabanla gel: garajdaki 🏁 tünelden sür. Yürüyerek izleyebilirsin.';
    else if (me && st.phase === 'waiting') text = '⚔️ Rakip bekleniyor… diğer şeride biri gelince ışıklar yanar.';
    else if (me && st.phase === 'countdown') text = '🚦 Sahnedesin — sarıları izle, YEŞİLDE gaz!';
    else if (me && st.phase === 'running') text = '🟢 GAZ! Şeridinden çıkma.';
    else if (st.phase === 'countdown' || st.phase === 'running') text = '⏳ Pistte yarış var — bitmesini bekle.';
    else if (st.phase === 'waiting') text = `⚔️ ${st.racers[0]?.name ?? 'Biri'} düello için bekliyor — boş şeride gir!`;
    else if (this.prestagedSelf() && !this.inStage()) text = '🟡 Ön sahnedesin — biraz daha ilerle, çizginin hemen gerisinde dur.';
    else if (this.inStage() && Math.abs(this.player.vel) >= 0.5) text = '🛑 Dur — tam durunca sahneye girersin.';
    else text = `${this.mode === 'solo' ? '🏁 Solo' : '⚔️ Düello'}: şeridinde (SOL / SAĞ) çizginin hemen gerisinde dur.${this.device.touch ? '' : ' (G: mod · L: 🏆)'}`;
    if (force || text !== this.lastText) {
      this.lastText = text;
      this.el.status.textContent = text;
    }
  }

  openBoard() {
    this.renderBoard();
    this.modal.open(this.el.panel);
  }

  renderBoard() {
    const tb = this.el.table;
    tb.replaceChildren();
    const row = (cells, cls = '') => {
      const tr = document.createElement('tr');
      if (cls) tr.className = cls;
      for (const c of cells) {
        const td = document.createElement(cls === 'th' ? 'th' : 'td');
        td.textContent = c;
        tr.append(td);
      }
      tb.append(tr);
    };
    row(['#', 'Sürücü', 'Araba', '¼ mil', 'Tuzak', 'RT'], 'th');
    const board = this.st.board ?? [];
    if (!board.length) row(['', 'Henüz koşu yok — ilk sen ol!', '', '', '', '']);
    board.forEach((e, i) => row([String(i + 1), e.name, CAR_BY_ID[e.model]?.name ?? e.model, `${sec(e.et)} s`, `${Math.round(e.trap)} km/s`, sec(e.rt)], i === 0 ? 'gold' : ''));
  }

  // ---- Kare ----------------------------------------------------------------------------------------

  /** @returns {boolean} kare gerekli mi */
  update(dt) {
    if (this.garage.area !== 'drag') return false;
    const now = this.net.serverNow();
    const st = this.st;
    const p = this.player.pos;
    const driving = this.vehicles.drivingCar;
    let active = false;
    // Yel değirmeni kanatları yalnızca sürerken (zaten kare çiziliyor) döner
    if (driving && Math.abs(this.player.vel) > 0.5) for (const s of this.strip.sails) s.rotation.z += dt * 0.6;

    // ---- Otomatik sahneye giriş ----
    const lane = driving ? stageLaneAt(p.x, p.z) : null;
    if (!lane) this.latch = false;
    if (lane && !this.latch && !this.pending && !this.myRacer() && (st.phase === 'idle' || st.phase === 'waiting') && Math.abs(this.player.vel) < 0.5) {
      this.stillFor += dt;
      active = true; // motor uyumasın: duran arabada sahne sayacı işlesin
      if (this.stillFor > 0.6) this.stage(lane);
    } else {
      this.stillFor = 0;
    }

    // ---- Işık ağacı ----
    let changed = false;
    const recent = st.last && performance.now() < this.resultUntil ? st.last : null;
    for (const l of DRAG_LANES) {
      const racer = st.racers?.find((r) => r.lane === l);
      const pre = this.prestaged(l);
      changed = this.setBulb(l, 'pre', pre || !!racer) || changed;
      const staged = !!racer && !racer.done && (st.phase !== 'running' || now < st.greenAt + 400);
      changed = this.setBulb(l, 'stage', staged || (!!racer && st.phase === 'countdown')) || changed;
      const counting = (st.phase === 'countdown' || st.phase === 'running') && racer;
      for (let i = 0; i < 3; i++) {
        const on = !!counting && now >= st.treeAt + i * T.amberMs && now < st.greenAt;
        changed = this.setBulb(l, `a${i + 1}`, on) || changed;
      }
      const lr = recent?.results?.find((x) => x.lane === l);
      const red = racer?.foul === 'jump' || racer?.foul === 'lane' || (lr && (lr.foul === 'jump' || lr.foul === 'lane'));
      const green = !red && ((counting && now >= st.greenAt) || (lr && !lr.foul));
      changed = this.setBulb(l, 'green', !!green) || changed;
      changed = this.setBulb(l, 'red', !!red) || changed;
    }
    if (changed) active = true;

    // ---- Geri sayım bipleri + canlı süre ----
    const me = this.myRacer();
    if (me && (st.phase === 'countdown' || st.phase === 'running')) {
      active = true;
      const step = Math.floor((now - st.treeAt) / T.amberMs); // 0,1,2 sarı · 3 yeşil
      if (step >= 0 && step <= 3 && this.beeped !== st.runNo * 10 + step) {
        this.beeped = st.runNo * 10 + step;
        this.beep(step === 3 ? 1320 : 660, step === 3 ? 0.35 : 0.12);
      }
      if (now >= st.greenAt) {
        if (this.localFinish === null && p.z <= T.finishZ) this.localFinish = now - st.greenAt;
        const t = (this.localFinish ?? now - st.greenAt) / 1000;
        this.garage.cockpit.setTimer(`⏱ ${t.toFixed(2)} s${this.localFinish !== null ? ' ✓' : ''}`, this.localFinish !== null ? 'done' : 'run');
      } else {
        this.garage.cockpit.setTimer('🚦 HAZIR…', 'wait');
      }
    } else if (driving) {
      this.garage.cockpit.setTimer(null);
    }
    if (this.player.moved || active) this.updateHud();
    return active || (recent !== null && changed);
  }

  inStage() {
    return this.vehicles.drivingCar && !!stageLaneAt(this.player.pos.x, this.player.pos.z);
  }

  prestagedSelf() {
    return this.vehicles.drivingCar && !!stageLaneAt(this.player.pos.x, this.player.pos.z, { min: T.stage.min - 0.5, max: T.prestage });
  }

  /** Bu şeridin ön sahne bölgesinde bir araba (kendim ya da başka sürücü) var mı */
  prestaged(lane) {
    const box = { min: T.stage.min - 0.5, max: T.prestage };
    if (this.vehicles.drivingCar && stageLaneAt(this.player.pos.x, this.player.pos.z, box) === lane) return true;
    for (const v of this.vehicles.list) {
      if (v.type !== 'car' || v.driver == null || v.driver === this.vehicles.selfId) continue;
      const r = this.remotes.get(v.driver);
      if (r && stageLaneAt(r.obj.position.x, r.obj.position.z, box) === lane) return true;
    }
    return false;
  }

  async stage(lane) {
    this.pending = true;
    this.stillFor = 0;
    const res = await this.net.request(EVT.DRAG_ACT, { act: 'stage', lane, mode: this.mode });
    this.pending = false;
    if (!res.ok) {
      this.latch = true; // tekrar tekrar denemesin: kutudan çıkıp gir
      this.hud.toast(`🏁 ${res.error || 'Sahneye girilemedi.'}`, 'warn');
      return;
    }
    this.localFinish = null;
    this.el.result.hidden = true;
    this.hud.toast(res.phase === 'waiting' ? '⚔️ Sahnedesin — rakip bekleniyor (90 sn).' : '🚦 Sahnedesin! Yeşili bekle…', 'info');
  }

  beep(freq, dur) {
    if (!this.settings.sound) return;
    const ctx = this.sfx.begin?.(dur * 1000 + 100);
    if (!ctx) return;
    try {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch { /* ses yok */ }
  }

  setNight(t) { this.strip.setNight(t); }
}
