import {
  ROOM_IDS, ROOM_STATUS, ROOM_STATUS_LABEL, DAY_NAMES, formatClock, formatMoney, roomFloor,
} from '/shared/constants.js';

const MAX_TOASTS = 4;
const TOAST_MS = 4200;

/**
 * DOM tabanlı arayüz. Tüm yazımlar önbellekle karşılaştırılır; değer
 * değişmediyse DOM'a dokunulmaz (gereksiz layout/paint yok).
 */
export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      day: $('hud-day'),
      clock: $('hud-clock'),
      open: $('hud-open'),
      money: $('hud-money'),
      wallet: $('hud-wallet'),
      trip: $('trip-banner'),
      rooms: $('room-list'),
      weekend: $('weekend-banner'),
      toasts: $('toasts'),
      prompt: $('prompt'),
      crosshair: $('crosshair'),
      fps: $('fps'),
      conn: $('conn-status'),
      stars: $('hud-stars'),
      boosts: $('boost-chips'),
    };
    this.cache = new Map();
    this.roomEls = new Map();
    this.floorHeads = new Map();
    for (const id of ROOM_IDS) {
      const floor = roomFloor(id);
      // Üst katlar açılınca liste kat kat gruplanır (kapalı katlar gizli)
      if (!this.floorHeads.has(floor)) {
        const head = document.createElement('li');
        head.className = 'floor-head';
        head.textContent = `${floor}. kat`;
        head.hidden = true;
        this.el.rooms.append(head);
        this.floorHeads.set(floor, head);
      }
      const li = document.createElement('li');
      li.className = ROOM_STATUS.EMPTY;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      const pre = document.createElement('span');
      pre.className = 'pre';
      pre.textContent = 'Oda ';
      name.append(pre, id);
      const state = document.createElement('span');
      state.className = 'state';
      state.textContent = ROOM_STATUS_LABEL[ROOM_STATUS.EMPTY];
      li.append(dot, name, state);
      li.hidden = floor > 1;
      this.el.rooms.append(li);
      this.roomEls.set(id, { li, state, floor });
    }
  }

  /** Açık kat sayısı: kapalı katların odaları listede görünmez; birden çok katta başlıklar çıkar */
  setFloors(n) {
    if (this.cache.get('floors') === n) return;
    this.cache.set('floors', n);
    for (const e of this.roomEls.values()) e.li.hidden = e.floor > n;
    for (const [f, head] of this.floorHeads) head.hidden = n < 2 || f > n;
    this.el.rooms.classList.toggle('multi', n > 1);
  }

  /**
   * Geçici bonus çipleri (konser kalabalığı, reklam kampanyası): "🎸 Konser kalabalığı · bar ×2 · 1sa 20dk"
   * @param list EVT.BOOSTS  @param nowTotal güncel mutlak oyun dakikası
   */
  setBoosts(list, nowTotal) {
    const el = this.el.boosts;
    const items = (list ?? []).filter((b) => b.untilTotal > nowTotal);
    const text = items.map((b) => {
      const left = Math.max(0, Math.round(b.untilTotal - nowTotal));
      const fx = [];
      if (b.guestSpawn > 1) fx.push(`misafir ×${+b.guestSpawn.toFixed(1)}`);
      if (b.barSpawn > 1) fx.push(`bar ×${+b.barSpawn.toFixed(1)}`);
      if (b.barTip > 1) fx.push(`bahşiş +%${Math.round((b.barTip - 1) * 100)}`);
      const time = left >= 60 ? `${Math.floor(left / 60)}sa ${left % 60}dk` : `${left}dk`;
      return `${b.icon} ${b.label}${fx.length ? ` · ${fx.join(' · ')}` : ''} · ${time}`;
    }).join('\n');
    el.hidden = !text;
    this.set('boosts', el, text);
  }

  /** Yıldız göstergesi (★★★☆☆) + itibar */
  setStars(stars, reputation, next) {
    const text = `${'★'.repeat(stars)}${'☆'.repeat(Math.max(0, 5 - stars))}`;
    this.set('stars', this.el.stars, text);
    this.el.stars.title = next ? `İtibar ${reputation} / ${next} (sonraki yıldız)` : `İtibar ${reputation} — en yüksek seviye`;
  }

  set(key, el, text) {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    el.textContent = text;
  }

  setRooms(rooms) {
    for (const r of rooms.values()) {
      const e = this.roomEls.get(r.id);
      if (!e) continue;
      let label = ROOM_STATUS_LABEL[r.status] ?? r.status;
      if (r.status === ROOM_STATUS.DIRTY) {
        const left = (r.bedMade ? 0 : 1) + r.trash.filter(Boolean).length + Object.values(r.issues ?? {}).filter(Boolean).length;
        label += ` · ${left} iş`;
      }
      if (this.cache.get(`room:${r.id}`) === label) continue;
      this.cache.set(`room:${r.id}`, label);
      e.li.className = r.status;
      e.li.title = `Oda ${r.id}: ${label}`;
      // Kompakt (çok katlı) görünümde kirli odanın kalan iş sayısı rozet olarak
      if (r.status === ROOM_STATUS.DIRTY) e.li.dataset.left = label.replace(/\D+/g, '');
      else delete e.li.dataset.left;
      e.state.textContent = label;
    }
  }

  setClock(day, minute, weekend, open, night = false) {
    this.set('day', this.el.day, DAY_NAMES[day] ?? '');
    this.set('clock', this.el.clock, formatClock(minute));
    const chip = night ? 'GECE' : weekend ? 'KAPALI' : open ? 'AÇIK' : 'RESEPSİYON KAPALI';
    if (this.cache.get('chip') !== chip) {
      this.cache.set('chip', chip);
      this.el.open.textContent = night ? '🌙 GECE · EVE GİT' : weekend ? 'HAFTA SONU' : open ? 'AÇIK' : 'KABUL YOK';
      this.el.open.className = `chip ${night ? 'night' : weekend ? 'closed' : open ? 'open' : 'night'}`;
    }
    this.el.weekend.hidden = !weekend;
  }

  setMoney(value) {
    this.set('money', this.el.money, formatMoney(value));
  }

  setWallet(value) {
    this.set('wallet', this.el.wallet, formatMoney(value));
  }

  /** @param kind 'good' | 'bad' | null */
  setTrip(kind, text = '') {
    const el = this.el.trip;
    el.hidden = !kind;
    if (!kind) return;
    if (this.cache.get('tripKind') !== kind) {
      this.cache.set('tripKind', kind);
      el.className = kind;
    }
    this.set('trip', el, text);
  }

  toast(text, kind = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.append(t);
    while (this.el.toasts.children.length > MAX_TOASTS) this.el.toasts.firstChild.remove();
    setTimeout(() => {
      t.classList.add('hide');
      setTimeout(() => t.remove(), 400);
    }, TOAST_MS);
  }

  /** @param p { key?, text } | { info } | null */
  setPrompt(p) {
    const key = p ? JSON.stringify(p) : '';
    if (this.cache.get('prompt') === key) return;
    this.cache.set('prompt', key);
    const el = this.el.prompt;
    el.replaceChildren();
    if (!p) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.classList.toggle('info', !!p.info);
    if (p.info) {
      el.textContent = p.info;
      return;
    }
    if (p.key) {
      const k = document.createElement('kbd');
      k.textContent = p.key;
      el.append(k);
    } else {
      const k = document.createElement('kbd');
      k.textContent = 'Aksiyon';
      el.append(k);
    }
    el.append(document.createTextNode(p.text));
  }

  setCrosshairReady(on) {
    if (this.cache.get('cross') === on) return;
    this.cache.set('cross', on);
    this.el.crosshair.classList.toggle('ready', on);
  }

  setConnection(text, error = false) {
    this.el.conn.textContent = text;
    this.el.conn.classList.toggle('error', error);
  }

  setFps(text) {
    this.el.fps.hidden = text === null;
    if (text !== null) this.set('fps', this.el.fps, text);
  }
}
