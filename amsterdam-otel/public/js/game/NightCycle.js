import { EVT, NIGHT, DAY_END_MIN } from '/shared/constants.js';
import { FURNITURE_BY_ID, itemBox } from '/shared/house.js';
import { HOUSE_BY_ID, houseAt } from '/shared/layout.js';

const FADE_SEC = 2.2; // gece / gündüz ışık geçişi

/**
 * Gece döngüsü (istemci):
 *  - 21:00'den sonra gökyüzü kararmaya başlar, 23:00'te gece (otel kapanır). Işık geçişi
 *    birkaç saniyelik tek seferlik bir animasyon; gece boyunca karede ek iş yoktur.
 *  - Evdeki yatağın yanında E / Aksiyon → yatağa yat (sunucu doğrular: saat, ev, yatak).
 *    Uyurken ekran kararır, kaç oyuncunun uyuduğu gösterilir. Herkes uyuyunca sabah olur.
 *  - Yürüyünce ya da tekrar E'ye basınca kalkarsın.
 */
export class NightCycle {
  constructor({ engine, net, hud, interaction, player, house, state, world, device, sfx, settings }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.house = house;
    this.state = state;
    this.world = world;
    this.device = device;
    this.sfx = sfx;
    this.settings = settings;

    this.selfId = null;
    this.night = false;
    this.canSleep = false; // 21:00+ ya da gece
    this.level = 0; // görünen karanlık 0..1
    this.target = 0;
    this.sleeping = null; // { x, z } yattığın yer
    this.pending = false;
    this.sleepers = { ids: [], total: 0 };

    const $ = (id) => document.getElementById(id);
    this.el = { overlay: $('sleep-overlay'), text: $('sleep-text'), sub: $('sleep-sub') };
    $('sleep-wake').addEventListener('click', () => this.wake());

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  // ---- Saat --------------------------------------------------------------------------

  /** main.js saat güncellemesi (saniyede bir ve her CLOCK olayında) */
  onClock(minute) {
    const night = !!this.state.clock?.night;
    const canSleep = night || minute >= NIGHT.SLEEP_FROM_MIN;
    if (night !== this.night) {
      this.night = night;
      if (!night && this.sleeping) this.endSleep(true);
    }
    if (canSleep !== this.canSleep) {
      this.canSleep = canSleep;
      this.interaction.invalidate();
      this.engine.requestRender();
    }
    // Hep gündüz: akşam alacakaranlığı yok; karanlık yalnızca gece açıksa (NIGHT_LENGTH_SEC > 0)
    const target = night ? 1 : 0;
    if (target !== this.target) {
      this.target = target;
      this.fade = { from: this.level, at: performance.now() };
      this.engine.wake(); // geçiş animasyonu
    }
  }

  // ---- Yatak etkileşimi --------------------------------------------------------------

  /** Oyuncunun yatabileceği ev mi: kendi evi, Bizim Ev ya da içeri alındığı ev */
  canUseHouse(houseId) {
    return !HOUSE_BY_ID[houseId]?.owned || houseId === this.house.ownedHouseId || this.house.accessCheck(houseId);
  }

  findTarget(px, pz, f) {
    const h = houseAt(px, pz);
    if (!h || this.house.build.active) return null;
    let best = null;
    let bestD = Infinity;
    for (const it of this.house.itemsOf(h.id)) {
      if (it.type !== 'bed') continue;
      const b = itemBox(FURNITURE_BY_ID.bed, it);
      const cx = Math.min(Math.max(px, b.minX), b.maxX);
      const cz = Math.min(Math.max(pz, b.minZ), b.maxZ);
      const d = Math.hypot(px - cx, pz - cz);
      if (d > NIGHT.BED_RANGE) continue;
      const dot = d > 1e-3 ? ((cx - px) * f.x + (cz - pz) * f.z) / d : 1;
      if (d > 0.5 && dot < 0.3) continue;
      if (d < bestD) {
        bestD = d;
        best = { it, x: cx, z: cz };
      }
    }
    if (!best) return null;
    const at = { x: best.x, z: best.z, marker: false };
    if (this.sleeping) return { ...at, short: 'Kalk', label: '☀️ Yataktan kalk', use: () => this.wake() };
    if (!this.canUseHouse(h.id)) return { ...at, short: 'Yatak', label: '🛏 Yatak — burası senin evin değil', use: () => this.hud.toast('Kendi evindeki yatakta uyuyabilirsin.', 'info') };
    if (!this.canSleep) {
      return { ...at, short: 'Yatak', label: '🛏 Yatak — 21:00\'den sonra uyuyabilirsin', use: () => this.hud.toast('Henüz uykun yok — akşam 21:00\'den sonra yatabilirsin.', 'info') };
    }
    return { ...at, short: 'Uyu', label: this.night ? '🛏 Yatağa yat ve uyu' : '🛏 Erkenden yat (herkes uyursa sabah olur)', use: () => this.sleep() };
  }

  async sleep() {
    if (this.pending || this.sleeping) return;
    this.pending = true;
    const res = await this.net.request(EVT.SLEEP, { on: true });
    this.pending = false;
    if (!res.ok) {
      this.hud.toast(res.error || 'Uyuyamadın.', 'warn');
      return;
    }
    // Uyku durumu yanıttan önce gelir (aynı bağlantı, sıralı). Listede yoksan sabah çoktan
    // oldu (son uyuyan sendin): uyku ekranı yerine doğrudan günaydın.
    if (!this.sleepers.ids.includes(this.selfId)) {
      this.morningToast();
      return;
    }
    this.startSleep();
  }

  startSleep() {
    const p = this.player.pos;
    this.sleeping = { x: p.x, z: p.z };
    this.el.overlay.hidden = false;
    void this.el.overlay.offsetWidth;
    this.el.overlay.classList.add('on');
    document.body.classList.add('sleeping');
    this.renderSleepers();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  /** Kalk (oyuncu isteği) */
  wake() {
    if (!this.sleeping) return;
    this.endSleep(false);
    this.net.request(EVT.SLEEP, { on: false });
  }

  /** @param morning sabah oldu (sunucu herkesi uyandırdı) */
  endSleep(morning) {
    if (!this.sleeping) return;
    this.sleeping = null;
    this.el.overlay.classList.remove('on');
    document.body.classList.remove('sleeping');
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      if (!this.sleeping) this.el.overlay.hidden = true;
    }, 900);
    if (morning) this.morningToast();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  morningToast() {
    this.hud.toast('☀️ Günaydın! Yeni gün başladı — otele dönme zamanı.', 'clean');
    if (this.settings?.sound) this.sfx?.clink?.();
  }

  /** EVT.SLEEP_STATE ya da snapshot.sleep */
  onSleepState(s) {
    if (!s || !Array.isArray(s.ids)) return;
    this.sleepers = s;
    const meAsleep = s.ids.includes(this.selfId);
    // Sunucu beni uyanık sayıyorsa (sabah oldu / yürüdüm / yeniden bağlandım) uykudan çık
    if (this.sleeping && !meAsleep && !this.pending) this.endSleep(!s.ids.length);
    this.renderSleepers();
  }

  renderSleepers() {
    if (!this.sleeping) return;
    const { ids, total } = this.sleepers;
    const n = Math.max(ids.length, 1);
    this.el.text.textContent = this.night ? '💤 Uyuyorsun…' : '💤 Erkenden yattın…';
    this.el.sub.textContent = total > 1
      ? `${n}/${total} oyuncu uyuyor — herkes uyuyunca sabah olur.`
      : 'Sabah oluyor…';
  }

  /** Yeni bağlantı: sunucuda uyku durumu sıfırdır */
  reset(selfId) {
    this.selfId = selfId;
    if (this.sleeping) this.endSleep(false);
  }

  // ---- Kare güncellemesi --------------------------------------------------------------

  /** @returns {boolean} ışık geçişi sürüyor mu */
  update(dt) {
    // Yürüyen uyanır (sunucu da aynı kuralı uygular)
    if (this.sleeping) {
      const p = this.player.pos;
      if (Math.hypot(p.x - this.sleeping.x, p.z - this.sleeping.z) > NIGHT.WAKE_MOVE) this.wake();
    }
    if (this.level === this.target) return false;
    // Gerçek saate bağlı geçiş: yavaş karelerde (düşük FPS) de FADE_SEC sürer
    const k = this.fade ? Math.min(1, (performance.now() - this.fade.at) / (FADE_SEC * 1000)) : 1;
    this.level = k >= 1 ? this.target : this.fade.from + (this.target - this.fade.from) * k;
    this.world.setNightLevel(this.level);
    return this.level !== this.target;
  }
}
