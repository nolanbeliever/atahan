import {
  ROOM_IDS, ROOM_STATUS, ROOM_STATUS_LABEL, DAY_NAMES, formatClock, formatMoney,
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
    };
    this.cache = new Map();
    this.roomEls = new Map();
    for (const id of ROOM_IDS) {
      const li = document.createElement('li');
      li.className = ROOM_STATUS.EMPTY;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      name.textContent = `Oda ${id}`;
      const state = document.createElement('span');
      state.className = 'state';
      state.textContent = ROOM_STATUS_LABEL[ROOM_STATUS.EMPTY];
      li.append(dot, name, state);
      this.el.rooms.append(li);
      this.roomEls.set(id, { li, state });
    }
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
        const left = (r.bedMade ? 0 : 1) + r.trash.filter(Boolean).length;
        label += ` · ${left} iş`;
      }
      if (this.cache.get(`room:${r.id}`) === label) continue;
      this.cache.set(`room:${r.id}`, label);
      e.li.className = r.status;
      e.state.textContent = label;
    }
  }

  setClock(day, minute, weekend, open) {
    this.set('day', this.el.day, DAY_NAMES[day] ?? '');
    this.set('clock', this.el.clock, formatClock(minute));
    const chip = weekend ? 'KAPALI' : open ? 'AÇIK' : 'RESEPSİYON KAPALI';
    if (this.cache.get('chip') !== chip) {
      this.cache.set('chip', chip);
      this.el.open.textContent = weekend ? 'HAFTA SONU' : open ? 'AÇIK' : 'KABUL YOK';
      this.el.open.className = `chip ${weekend ? 'closed' : open ? 'open' : 'night'}`;
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
