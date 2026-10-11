import * as THREE from 'three';
import {
  EVT, BAR_RULES, DRINKS, DRINK_BY_ID, FOOD, FOOD_BY_ID, INGREDIENTS, INGREDIENT_BY_ID,
} from '/shared/constants.js';
import { BAR, isInsideBar } from '/shared/layout.js';

const T = BAR_RULES.T;
// Hareketi kilitleyen (istasyona bağlı) eylemler; ısırırken yürünebilir
const LOCKING = new Set(['pour', 'shake', 'wash']);
const BUSY_TEXT = {
  take: '🥛 Bardak alıyorsun…',
  pour: '🫗 Dolduruyorsun…',
  shake: '🍸 Çalkalıyorsun…',
  serve: '🍹 Servis ediyorsun…',
  collect: '🫙 Topluyorsun…',
  wash: '🧽 Yıkıyorsun…',
  buy: '🛍️ Alıyorsun…',
  bite: '😋 Isırıyorsun…',
};
const PATIENCE_URGENT = 0.35; // altında baloncuk ve çubuk kırmızı

const recipeIcons = (d) => d.ingredients.map((i) => INGREDIENT_BY_ID[i].icon).join('') + (d.shake ? '🍸' : '');
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Bardaktaki karışımın rengi: tam bir tarife uyuyorsa içeceğin rengi, değilse malzemelerin ortalaması */
function mixColor(pours, shaken) {
  if (!pours.length) return null;
  const exact = DRINKS.find((d) => sameSet(d.ingredients, pours) && d.shake === shaken);
  if (exact) return exact.color;
  const c = new THREE.Color(0, 0, 0);
  const tmp = new THREE.Color();
  for (const id of pours) c.add(tmp.set(INGREDIENT_BY_ID[id].color));
  c.multiplyScalar(1 / pours.length);
  return `#${c.getHexString()}`;
}

/** Elde tutulan bardağın tarife göre eksikleri (servis öncesi ipucu) */
function missingFor(drink, hold) {
  const miss = [];
  for (const i of drink.ingredients) if (!hold.pours.includes(i)) miss.push(INGREDIENT_BY_ID[i].icon);
  const extra = hold.pours.filter((i) => !drink.ingredients.includes(i)).map((i) => INGREDIENT_BY_ID[i].icon);
  if (drink.shake && !hold.shaken) miss.push('🍸');
  return { miss, extra, wrongShake: !drink.shake && hold.shaken };
}

// ---- Uzak oyuncular: elde nesne + tek kol (paylaşılan geometri/malzeme) ------------
let remoteKit = null;
function getRemoteKit() {
  if (remoteKit) return remoteKit;
  const mat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
  remoteKit = {
    arm: new THREE.CapsuleGeometry(0.04, 0.26, 3, 8).translate(0, -0.17, 0),
    hand: new THREE.SphereGeometry(0.045, 8, 6),
    glass: new THREE.CylinderGeometry(0.038, 0.032, 0.1, 10).translate(0, 0.05, 0),
    liquid: new THREE.CylinderGeometry(0.033, 0.03, 0.07, 10).translate(0, 0.037, 0),
    brownie: new THREE.BoxGeometry(0.08, 0.035, 0.06),
    wafel: new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14),
    glassMat: mat(0xdff3ff, { transparent: true, opacity: 0.45, depthWrite: false }),
    dirtyMat: mat(0xc9c2a8, { transparent: true, opacity: 0.6, depthWrite: false }),
    skin: mat(0xe7b48f),
    brownieMat: mat(0x4a2a17),
    wafelMat: mat(0xc98a3d),
    liquidMats: new Map(),
    sleeves: new Map(),
  };
  return remoteKit;
}
const cachedMat = (map, hex) => {
  let m = map.get(hex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex });
    map.set(hex, m);
  }
  return m;
};

/**
 * Bar De Tulp (alkolsüz bar) — istemci tarafı.
 *  - Etkileşim: bakılan istasyona göre bağlama duyarlı E / Aksiyon
 *    (bardak al, koy, çalkala, servis et, topla, yıka, yiyecek al).
 *  - Her adım sunucuda zaman doğrulamalı; istemci animasyonu İYİMSER oynatır,
 *    sunucu reddederse geri alır. Isırık (2 sn) her yerde: F / Aksiyon.
 *  - HUD: sipariş listesi (sabır çubukları CSS transition ile — kare başı DOM yok),
 *    eylem ilerleme çubuğu, eldeki bardağın tarif şeridi.
 *  - Müşteri başlarında sipariş baloncuğu, tezgâhta bardaklar, uzak oyuncularda
 *    elde tutulan nesne + kol animasyonu.
 */
export class BarSystem {
  constructor({ engine, net, hud, interaction, player, remotes, guests, settings, sfx, vm, view, device, getWallet }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.remotes = remotes;
    this.guests = guests;
    this.settings = settings;
    this.sfx = sfx;
    this.vm = vm;
    this.view = view; // BarBuilding'in döndürdüğü BarView
    this.device = device;
    this.getWallet = getWallet || (() => Infinity);

    this.state = null; // EVT.BAR_STATE
    this.hold = null; // sunucudaki el durumu
    this.local = null; // { act, t0, dur, until } — oynayan iyimser eylem
    this.pending = false; // sunucu yanıtı bekleniyor (yavaş ağda animasyondan uzun sürebilir)
    this.inside = false;
    this.remote = new Map(); // oyuncu id → { hold, color, act, until, fx }
    this.customerGlass = new Map(); // müşteri id → mesh (içerken elinde bardak)
    this.bubbles = [];
    this.bubbleTex = new Map();
    this.timers = [];

    const $ = (id) => document.getElementById(id);
    this.el = {
      orders: $('bar-orders'),
      title: $('bar-title'),
      list: $('bar-order-list'),
      progress: $('bar-progress'),
      progressFill: $('bar-progress').firstElementChild,
      held: $('bar-held'),
    };
    this.rowEls = new Map(); // tabure → satır öğeleri

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
    const prevHint = interaction.idleHint;
    interaction.idleHint = () => this.idleHint() || prevHint?.();

    this.buildBubbles();
    // Sabır çubuğu renk kademesi + baloncuk rengi: saniyede bir (yalnızca bardayken)
    setInterval(() => this.tickPatience(), 1000);
  }

  // ---- Sunucu durumu -------------------------------------------------------------

  applySnapshot(bar) {
    if (bar) this.onState(bar, true);
  }

  /** Kişisel durum (EVT.SELF.bar / WELCOME.self.bar) */
  applySelf(selfBar) {
    this.hold = selfBar?.hold ?? null;
    if (!this.local) this.syncHold();
  }

  onState(s, silent = false) {
    const prev = this.state;
    this.state = s;
    if (!silent && prev && this.inside) this.announce(prev, s);
    this.view?.setRack(s.rack);
    this.syncCustomers();
    s.stools.forEach((st, i) => {
      // İçerken bardak müşterinin elinde; kalkınca kirli bardak tezgâhta kalır
      const inHand = st.glass === 'full' && this.customerGlass.has(st.customer);
      const color = st.glass === 'full' ? (DRINK_BY_ID[st.drink]?.color ?? null) : null;
      this.view?.setStoolGlass(i, inHand ? null : st.glass, color);
    });
    this.renderOrders();
    this.renderBubbles();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  /** Bar durumundaki değişikliklerden kısa bildirimler (yalnızca bardaysan) */
  announce(prev, s) {
    s.stools.forEach((st, i) => {
      const p = prev.stools[i];
      if (!p) return;
      if (st.state === 'waiting' && p.state !== 'waiting') {
        const d = DRINK_BY_ID[st.order];
        if (d) this.hud.toast(`${d.icon} ${st.name}: "Bir ${d.name} lütfen!"`, 'info');
      } else if (p.state === 'waiting' && st.state === 'empty') {
        this.hud.toast(`😤 ${p.name} beklemekten sıkıldı ve gitti.`, 'warn');
      } else if (p.state === 'drinking' && st.state === 'empty' && st.glass === 'dirty') {
        this.hud.toast('🫙 Tezgâhta kirli bardak kaldı — topla, lavaboda yıka.', 'info');
      }
    });
  }

  // ---- Etkileşim hedefleri -------------------------------------------------------

  findTarget(px, pz, f) {
    if (!this.state || !isInsideBar(px, pz)) return null;
    if (this.local) return null; // eylem sürerken (Interaction meşgul metnini gösterir)
    const h = this.hold;
    const S = this.state;
    const cands = [];
    const add = (pt, label, short, use) => cands.push({ x: pt[0], z: pt[1], label, short, use });
    const stools = BAR.stools;

    if (!h) {
      if (S.rack > 0) add(BAR.glassRack, `🥛 Temiz bardak al (rafta ${S.rack})`, 'Al', () => this.act('take'));
      else add(BAR.glassRack, '🥛 Temiz bardak kalmadı — kirli bardakları topla', 'Raf', () => this.hud.toast('Temiz bardak kalmadı — tezgâhtaki kirli bardakları toplayıp lavaboda yıka.', 'warn'));
      for (const food of FOOD) {
        add(BAR.food[food.id], `${food.icon} ${food.name} al · €${food.price}`, 'Al', () => {
          if (this.getWallet() < food.price) this.hud.toast(`${food.name} için €${food.price} gerekli.`, 'warn');
          else this.act('buy', { food: food.id });
        });
      }
      S.stools.forEach((st, i) => {
        if (st.glass === 'dirty') add(stools[i].spot, '🫙 Kirli bardağı topla', 'Topla', () => this.act('collect', { stool: i }));
      });
      for (const ing of INGREDIENTS) add(BAR.dispensers[ing.id], `${ing.icon} ${ing.name} — önce temiz bardak al`, ing.icon, () => this.hud.toast('Önce raftan temiz bir bardak al.', 'info'));
    } else if (h.kind === 'glass') {
      for (const ing of INGREDIENTS) {
        const pt = BAR.dispensers[ing.id];
        if (h.pours.includes(ing.id)) add(pt, `${ing.icon} ${ing.name} — zaten koydun`, ing.icon, () => this.hud.toast(`${ing.name} zaten bardakta.`, 'info'));
        else if (h.pours.length >= BAR_RULES.MAX_POURS) add(pt, '🥛 Bardak dolu', ing.icon, () => this.hud.toast('Bardak dolu — servis et ya da lavaboda dök.', 'info'));
        else add(pt, `${ing.icon} ${ing.name} koy`, 'Koy', () => this.act('pour', { ing: ing.id }));
      }
      if (!h.pours.length) add(BAR.shaker, '🍸 Önce malzeme koy', 'Çalkala', () => this.hud.toast('Boş bardak çalkalanmaz — önce malzeme koy.', 'info'));
      else if (h.shaken) add(BAR.shaker, '🍸 Zaten çalkalandı', 'Çalkala', () => this.hud.toast('Bu içecek zaten çalkalandı.', 'info'));
      else add(BAR.shaker, '🍸 Çalkala', 'Çalkala', () => this.act('shake'));
      S.stools.forEach((st, i) => {
        if (st.state !== 'waiting') return;
        const d = DRINK_BY_ID[st.order];
        if (!d) return;
        const m = missingFor(d, h);
        if (!m.miss.length && !m.extra.length && !m.wrongShake) {
          add(stools[i].spot, `✅ Servis et: ${st.name} · ${d.icon} ${d.name}`, 'Servis', () => this.act('serve', { stool: i }));
        } else {
          const why = [
            m.miss.length ? `eksik ${m.miss.join(' ')}` : '',
            m.extra.length ? `fazla ${m.extra.join(' ')}` : '',
            m.wrongShake ? 'çalkalanmamalıydı' : '',
          ].filter(Boolean).join(' · ');
          add(stools[i].spot, `⚠ ${st.name} ${d.icon} ${d.name} istiyor (${why})`, 'Servis', () => this.hud.toast(`${d.name} = ${recipeIcons(d)} · ${why}`, 'warn'));
        }
      });
      add(BAR.sink, '🚰 İçeceği dök, bardağı yıka', 'Dök', () => this.act('wash'));
    } else if (h.kind === 'dirty') {
      if (h.count < BAR_RULES.MAX_DIRTY_HELD) {
        S.stools.forEach((st, i) => {
          if (st.glass === 'dirty') add(stools[i].spot, `🫙 Kirli bardağı topla (elinde ${h.count})`, 'Topla', () => this.act('collect', { stool: i }));
        });
      }
      add(BAR.sink, `🧽 Bardakları yıka (${h.count})`, 'Yıka', () => this.act('wash'));
    }
    // h.kind === 'food': hedef yok → Aksiyon / F ısırır

    let best = null;
    let bestScore = Infinity;
    for (const c of cands) {
      const dx = c.x - px;
      const dz = c.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > BAR.range) continue;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 0.7 && dot < 0.5) continue; // sık dizili istasyonlar: dar bakış konisi
      const score = d - dot * 0.9;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best && { x: best.x, z: best.z, label: best.label, short: best.short, marker: false, use: best.use };
  }

  /** Hedef yokken gösterilecek ipucu (yiyecek tutuyorsan: ısır) */
  idleHint() {
    const h = this.hold;
    if (h?.kind !== 'food' || this.local) return null;
    const food = FOOD_BY_ID[h.food];
    return food ? { text: `${food.icon} ${food.name} ısır (${h.bitesLeft}/${food.bites})`, short: 'Isır' } : null;
  }

  // ---- Girdi -------------------------------------------------------------------

  /** main.js onAction zinciri: true dönerse girdi tüketildi */
  onAction() {
    if (this.local || this.pending) return true; // eylem sürerken ikinci basış yok sayılır
    if (this.hold?.kind === 'food' && !this.interaction.current) {
      this.bite();
      return true;
    }
    return false;
  }

  /** main.js komut zinciri ('consume' = F) */
  command(cmd) {
    if (cmd !== 'consume' || this.hold?.kind !== 'food') return false;
    if (!this.local && !this.pending) this.bite();
    return true;
  }

  bite() {
    this.act('bite');
  }

  // ---- Eylemler (iyimser) ----------------------------------------------------------

  /** Eylem başarılı olursa elin alacağı durum (animasyonun sonu için tahmin) */
  predict(act, extra) {
    const h = this.hold;
    switch (act) {
      case 'take': return { kind: 'glass', pours: [], shaken: false };
      case 'pour': return { ...h, pours: [...h.pours, extra.ing] };
      case 'shake': return { ...h, shaken: true };
      case 'serve': return null;
      case 'collect': return { kind: 'dirty', count: (h?.kind === 'dirty' ? h.count : 0) + 1 };
      case 'wash': return null;
      case 'buy': return { kind: 'food', food: extra.food, bitesLeft: FOOD_BY_ID[extra.food].bites };
      case 'bite': return h.bitesLeft > 1 ? { ...h, bitesLeft: h.bitesLeft - 1 } : null;
      default: return h;
    }
  }

  async act(act, extra = {}) {
    if (this.local || this.pending) return;
    const prev = this.hold;
    const next = this.predict(act, extra);
    const dur = T[act];
    const now = performance.now();
    this.local = { act, t0: now, dur, until: now + dur };
    this.hold = next; // iyimser; sunucu yanıtı gerçeği yazar
    if (LOCKING.has(act)) this.player.lockUntil = now + dur;
    this.interaction.setBusy(BUSY_TEXT[act]);
    this.el.progress.hidden = false;
    this.el.progressFill.style.transform = 'scaleX(0)';
    this.vm?.play(act, dur, this.vmOpts(act, prev, next, extra));
    this.playSound(act, dur);
    this.renderHeld();
    this.engine.wake();

    this.pending = true;
    const res = await this.net.request(EVT.BAR_ACT, { act, ...extra });
    this.pending = false;
    if (!res.ok) {
      // Geri al: animasyonu kes, eli eski haline döndür
      this.hold = prev;
      this.player.lockUntil = 0;
      this.vm?.cancel(this.vmHold(prev));
      this.finishLocal();
      this.hud.toast(res.error || 'Olmadı.', 'warn');
      return;
    }
    if ('hold' in res) this.hold = res.hold ?? null;
    if (act === 'serve') this.playLater(() => this.sound('coin'), dur * 0.8);
    if (act === 'bite' && !this.hold) {
      const food = FOOD_BY_ID[extra.food ?? prev?.food];
      this.playLater(() => this.hud.toast(`😋 ${food ? food.name : 'Yiyecek'} bitti. Afiyet olsun!`, 'info'), dur);
    }
  }

  vmOpts(act, prev, next, extra) {
    const after = this.vmHold(next);
    switch (act) {
      case 'pour': {
        const fill0 = this.fillOf(prev);
        return { color: mixColor(next.pours, next.shaken) || INGREDIENT_BY_ID[extra.ing].color, fromFill: fill0, toFill: this.fillOf(next), after };
      }
      case 'shake':
        return { color: mixColor(next.pours, true), after };
      case 'bite': {
        const food = FOOD_BY_ID[prev.food];
        return { food: prev.food, bitesLeft: next ? next.bitesLeft : 0, bites: food.bites, after };
      }
      default:
        return { after };
    }
  }

  fillOf(h) {
    return h?.kind === 'glass' ? Math.min(0.9, h.pours.length * 0.3) : 0;
  }

  /** Sunucu el durumu → ViewModel tutuş biçimi */
  vmHold(h) {
    if (!h) return null;
    if (h.kind === 'glass') return { kind: 'glass', fill: this.fillOf(h), color: mixColor(h.pours, h.shaken) };
    if (h.kind === 'dirty') return { kind: 'dirty', count: h.count };
    if (h.kind === 'food') return { kind: 'food', food: h.food, bitesLeft: h.bitesLeft, bites: FOOD_BY_ID[h.food]?.bites ?? h.bitesLeft };
    return null;
  }

  syncHold() {
    this.vm?.setHold(this.vmHold(this.hold));
    this.renderHeld();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  finishLocal() {
    this.local = null;
    this.el.progress.hidden = true;
    this.interaction.setBusy(null);
    this.syncHold();
  }

  // ---- Ses ---------------------------------------------------------------------

  sound(name, ...args) {
    if (!this.settings.sound) return;
    this.sfx?.[name]?.(...args);
  }

  playLater(fn, ms) {
    this.timers.push(setTimeout(fn, ms));
    if (this.timers.length > 20) this.timers.splice(0, 10);
  }

  playSound(act, dur) {
    if (act === 'pour') this.sound('pour', dur);
    else if (act === 'shake') this.playLater(() => this.sound('shake', dur * 0.7), dur * 0.12);
    else if (act === 'wash') this.sound('wash', dur);
    else if (act === 'bite') {
      this.playLater(() => this.sound('bite'), dur * 0.32);
      this.playLater(() => this.sound('bite'), dur * 0.55);
    } else if (act === 'take' || act === 'serve' || act === 'collect') this.playLater(() => this.sound('clink'), dur * 0.6);
  }

  // ---- Kare güncellemesi ------------------------------------------------------------

  /** @returns {boolean} animasyon / ilerleme sürüyor mu */
  update() {
    let active = false;
    const now = performance.now();
    const inside = isInsideBar(this.player.pos.x, this.player.pos.z);
    if (inside !== this.inside) this.onInsideChange(inside);

    if (this.local) {
      const k = Math.min(1, (now - this.local.t0) / this.local.dur);
      this.el.progressFill.style.transform = `scaleX(${k.toFixed(3)})`;
      if (k >= 1) this.finishLocal();
      active = true; // bittiği karede de çiz
    }
    if (this.updateRemotes()) active = true;
    return active;
  }

  onInsideChange(inside) {
    this.inside = inside;
    this.el.orders.hidden = !inside;
    document.body.classList.toggle('at-bar', inside);
    if (inside) {
      this.renderOrders();
      if (!this.greeted) {
        this.greeted = true;
        this.hud.toast('🍹 Bar De Tulp! Raftan bardak al, siparişi hazırla, servis et.', 'info');
      }
    }
  }

  // ---- HUD -----------------------------------------------------------------------

  renderOrders() {
    const s = this.state;
    if (!s || !this.inside) return;
    const title = s.open ? `🍹 Bar De Tulp · raf ${s.rack}/${BAR_RULES.GLASSES}` : '🍹 Bar kapalı · 10:00\'da açılır';
    if (this.el.title.textContent !== title) this.el.title.textContent = title;
    const serverNow = this.net.serverNow();
    const rows = [];
    s.stools.forEach((st, i) => {
      if (st.state === 'waiting' || st.state === 'drinking' || st.glass === 'dirty') rows.push(i);
    });
    // Satırları tabureye göre yeniden kullan; yalnızca değişen satıra dokun
    const keep = new Set(rows);
    for (const [i, row] of this.rowEls) {
      if (!keep.has(i)) {
        row.el.remove();
        this.rowEls.delete(i);
      }
    }
    for (const i of rows) {
      const st = s.stools[i];
      let row = this.rowEls.get(i);
      if (!row) {
        const el = document.createElement('div');
        el.className = 'order';
        const ic = document.createElement('span');
        ic.className = 'ic';
        const nm = document.createElement('span');
        nm.className = 'nm';
        const pat = document.createElement('span');
        pat.className = 'pat';
        const fill = document.createElement('i');
        pat.append(fill);
        el.append(ic, nm, pat);
        row = { el, ic, nm, pat, fill, key: '' };
        this.rowEls.set(i, row);
      }
      this.el.list.append(row.el); // tabure sırasını koru
      const d = DRINK_BY_ID[st.order];
      let key;
      if (st.state === 'waiting' && d) key = `w:${st.customer}:${st.waitUntil}`;
      else if (st.state === 'drinking') key = `d:${st.customer}`;
      else key = 'dirty';
      if (row.key === key) continue;
      row.key = key;
      row.el.classList.toggle('waiting', st.state === 'waiting');
      if (st.state === 'waiting' && d) {
        row.ic.textContent = d.icon;
        // Tarif ikonları başta: dar panelde ad kesilse de ne yapılacağı görünsün
        row.nm.textContent = `${recipeIcons(d)} ${d.name} · ${st.name}`;
        row.pat.hidden = false;
        this.startPatienceBar(row, st, serverNow);
      } else if (st.state === 'drinking') {
        row.ic.textContent = '✓';
        row.nm.textContent = `${st.name} içiyor`;
        row.pat.hidden = true;
      } else {
        row.ic.textContent = '🫙';
        row.nm.textContent = 'Kirli bardak — topla';
        row.pat.hidden = true;
      }
    }
    this.el.list.classList.toggle('empty', !rows.length);
    this.tickPatience();
  }

  /** Sabır çubuğu: tek bir CSS transition (motor uyurken de akar) */
  startPatienceBar(row, st, serverNow) {
    const left = Math.max(0, st.waitUntil - serverNow);
    const frac = st.patienceMs > 0 ? Math.min(1, left / st.patienceMs) : 0;
    const i = row.fill;
    i.style.transition = 'none';
    i.style.transform = `scaleX(${frac.toFixed(3)})`;
    void i.offsetWidth; // reflow: geçiş baştan başlasın
    i.style.transition = `transform ${left}ms linear`;
    i.style.transform = 'scaleX(0)';
  }

  /** Saniyede bir: sabır kademesi (renk) ve baloncuk aciliyeti */
  tickPatience() {
    const s = this.state;
    if (!s) return;
    const serverNow = this.net.serverNow();
    let bubbleChanged = false;
    s.stools.forEach((st, i) => {
      const urgent = st.state === 'waiting' && st.patienceMs > 0 && (st.waitUntil - serverNow) / st.patienceMs < PATIENCE_URGENT;
      const row = this.rowEls.get(i);
      if (row && row.el.classList.contains('urgent') !== urgent) row.el.classList.toggle('urgent', urgent);
      const b = this.bubbles[i];
      if (b && b.visible && b.userData.urgent !== urgent) {
        b.userData.urgent = urgent;
        b.material.map = this.getBubbleTex(st.order, urgent);
        bubbleChanged = true;
      }
    });
    if (bubbleChanged) this.engine.requestRender();
  }

  /** Eldeki bardağın / yiyeceğin şeridi (prompt'un üstünde) */
  renderHeld() {
    const h = this.hold;
    const el = this.el.held;
    let text = '';
    if (h?.kind === 'glass') {
      const parts = h.pours.map((id) => INGREDIENT_BY_ID[id].icon);
      const drink = DRINKS.find((d) => sameSet(d.ingredients, h.pours) && d.shake === h.shaken);
      text = `🥛 Bardağında: ${parts.length ? parts.join(' ') : 'boş'}${h.shaken ? ' · 🍸 çalkalandı' : ''}`;
      if (drink) text += ` → ${drink.icon} ${drink.name} hazır!`;
    } else if (h?.kind === 'dirty') {
      text = `🫙 Kirli bardak ×${h.count} — lavaboda yıka`;
    } else if (h?.kind === 'food') {
      const food = FOOD_BY_ID[h.food];
      const key = this.device.touch ? 'Aksiyon' : 'F / E';
      if (food) text = `${food.icon} ${food.name} · ${h.bitesLeft}/${food.bites} ısırık kaldı — ${key}: ısır`;
    }
    el.hidden = !text;
    if (text && el.textContent !== text) el.textContent = text;
  }

  // ---- 3D: sipariş baloncukları, müşterinin elindeki bardak ------------------------------

  buildBubbles() {
    BAR.stools.forEach((s, i) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }));
      const a = this.view?.bubbleAnchor?.(i);
      sprite.position.set(a ? a.x : s.seat[0], a ? a.y : 2.05, a ? a.z : s.seat[1]);
      sprite.scale.set(0.42, 0.42, 1);
      sprite.renderOrder = 4;
      sprite.visible = false;
      sprite.userData = { order: null, urgent: false };
      this.engine.scene.add(sprite);
      this.bubbles.push(sprite);
    });
  }

  getBubbleTex(order, urgent) {
    const key = `${order}:${urgent}`;
    let tex = this.bubbleTex.get(key);
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = urgent ? '#ffd6d2' : '#fffaf0';
    g.strokeStyle = urgent ? '#e5534b' : '#ff7a1a';
    g.lineWidth = 7;
    g.beginPath();
    g.roundRect(10, 8, 108, 88, 26);
    g.moveTo(52, 96);
    g.lineTo(64, 120);
    g.lineTo(76, 96);
    g.fill();
    g.stroke();
    g.font = '58px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#222';
    g.fillText(DRINK_BY_ID[order]?.icon ?? '?', 64, 54);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.bubbleTex.set(key, tex);
    return tex;
  }

  renderBubbles() {
    const s = this.state;
    s.stools.forEach((st, i) => {
      const b = this.bubbles[i];
      if (!b) return;
      const show = st.state === 'waiting' && !!DRINK_BY_ID[st.order];
      b.visible = show;
      if (show && b.userData.order !== st.order) {
        b.userData.order = st.order;
        b.userData.urgent = false;
        b.material.map = this.getBubbleTex(st.order, false);
        b.material.needsUpdate = true;
      }
    });
  }

  /** İçen müşterinin elinde içeceği göster (GuestView nesnesine bağlı) */
  syncCustomers() {
    const kit = getRemoteKit();
    const drinking = new Map();
    for (const st of this.state.stools) if (st.state === 'drinking' && st.customer != null) drinking.set(st.customer, st.drink);
    for (const [id, mesh] of this.customerGlass) {
      if (drinking.has(id) && this.guests.items.get(id)?.obj === mesh.parent?.parent) continue;
      mesh.parent?.remove(mesh);
      this.customerGlass.delete(id);
    }
    for (const [id, drink] of drinking) {
      if (this.customerGlass.has(id)) continue;
      const g = this.guests.items.get(id);
      if (!g) continue;
      const glass = new THREE.Group();
      glass.add(new THREE.Mesh(kit.glass, kit.glassMat));
      glass.add(new THREE.Mesh(kit.liquid, cachedMat(kit.liquidMats, DRINK_BY_ID[drink]?.color ?? '#ffffff')));
      glass.position.set(0.17, 0.98, 0.2); // gövdenin önünde, sağda (karakterin önü +Z)
      g.obj.userData.inner.add(glass);
      this.customerGlass.set(id, glass);
    }
  }

  // ---- Uzak oyuncular ----------------------------------------------------------------

  /** EVT.PLAYER_BAR ya da publicPlayer.bar */
  onRemoteBar(id, bar) {
    if (!bar) return;
    let r = this.remote.get(id);
    if (!r) {
      r = { hold: null, color: null, act: null, until: 0, t0: 0, fx: null };
      this.remote.set(id, r);
    }
    r.hold = bar.hold ?? null;
    r.color = bar.color ?? null;
    r.act = bar.act ?? null;
    r.until = bar.until ?? 0;
    r.t0 = this.net.serverNow();
    this.applyRemoteFx(id, r);
    this.engine.wake();
  }

  removeRemote(id) {
    this.remote.delete(id);
  }

  applyRemoteFx(id, r) {
    const rp = this.remotes.get(id);
    if (!rp) return;
    const kit = getRemoteKit();
    const acting = r.act && this.net.serverNow() < r.until;
    if (!r.hold && !acting) {
      if (r.fx) r.fx.pivot.visible = false;
      return;
    }
    if (!r.fx || r.fx.owner !== rp.obj) {
      const pivot = new THREE.Group();
      pivot.position.set(0.2, 1.1, 0.03); // sağ omuz (karakterin önü +Z)
      const arm = new THREE.Mesh(kit.arm, cachedMat(kit.sleeves, rp.color ?? '#ff7a1a'));
      const hand = new THREE.Mesh(kit.hand, kit.skin);
      hand.position.y = -0.36;
      const item = new THREE.Group();
      item.position.y = -0.38;
      pivot.add(arm, hand, item);
      rp.obj.userData.inner.add(pivot);
      r.fx = { pivot, item, owner: rp.obj, key: '' };
    }
    const fx = r.fx;
    fx.pivot.visible = true;
    const key = `${r.hold}:${r.color}`;
    if (fx.key !== key) {
      fx.key = key;
      fx.item.clear();
      if (r.hold === 'glass') {
        fx.item.add(new THREE.Mesh(kit.glass, kit.glassMat));
        if (r.color) fx.item.add(new THREE.Mesh(kit.liquid, cachedMat(kit.liquidMats, r.color)));
      } else if (r.hold === 'dirty') {
        fx.item.add(new THREE.Mesh(kit.glass, kit.dirtyMat));
      } else if (r.hold === 'brownie') {
        fx.item.add(new THREE.Mesh(kit.brownie, kit.brownieMat));
      } else if (r.hold === 'stroopwafel') {
        fx.item.add(new THREE.Mesh(kit.wafel, kit.wafelMat));
      }
    }
    this.poseRemote(r, this.net.serverNow());
  }

  /** Kol pozu: tutarken ön kol öne; eyleme göre ısırma / çalkalama / dökme / uzanma */
  poseRemote(r, serverNow) {
    const fx = r.fx;
    if (!fx) return false;
    const reduce = this.settings.reduceMotion ? 0.3 : 1;
    let rx = -1.2;
    let rz = 0;
    let acting = false;
    if (r.act && serverNow < r.until) {
      acting = true;
      const dur = Math.max(1, r.until - r.t0);
      const k = Math.min(1, Math.max(0, (serverNow - r.t0) / dur));
      const bell = Math.sin(Math.PI * k);
      const tSec = (serverNow - r.t0) / 1000;
      if (r.act === 'bite') rx = -1.2 - 1.25 * Math.sin(Math.PI * Math.min(1, k * 1.25));
      else if (r.act === 'shake') rx = -1.5 + Math.sin(tSec * 22) * 0.3 * reduce;
      else if (r.act === 'pour') rz = 0.7 * bell;
      else rx = -1.2 - 0.45 * bell;
    }
    fx.pivot.rotation.set(rx, 0, rz);
    fx.item.rotation.set(-rx, 0, -rz); // nesne dik dursun
    if (!r.hold && !acting) fx.pivot.visible = false;
    return acting;
  }

  updateRemotes() {
    if (!this.remote.size) return false;
    const serverNow = this.net.serverNow();
    let active = false;
    for (const [id, r] of this.remote) {
      if (!r.fx) continue;
      if (!this.remotes.get(id)) {
        this.remote.delete(id);
        continue;
      }
      const wasActing = r.act !== null;
      const acting = this.poseRemote(r, serverNow);
      if (acting) active = true;
      else if (wasActing) {
        r.act = null;
        active = true; // eylemin bittiği son pozu da çiz
      }
    }
    return active;
  }
}
