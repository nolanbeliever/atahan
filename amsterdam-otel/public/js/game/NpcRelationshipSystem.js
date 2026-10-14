import { EVT, DRINKS } from '/shared/constants.js';
import { BAR, HOUSE_BY_ID, houseAt, isInsideBar } from '/shared/layout.js';
import { REGULAR_BY_NAME, TOPICS, TOPIC_BY_ID, FRIEND_RULES as F } from '/shared/friends.js';
import { makeCharacter } from './Characters.js';

const COUNTER_FRONT = BAR.counter.minZ; // müşteri tarafı (tezgâhın önü)

/**
 * Bar De Tulp müdavimleriyle arkadaşlık (istemci).
 *  - Barda oturan müşterinin önüne (tezgâhın müşteri tarafı) gelip E → diyalog:
 *    💬 Sohbet et (konu seç) · 😄 Espri yap · 🥤 İçecek ısmarla · 🏠 Eve davet et (%80+).
 *    Her kişinin arkadaşlık çubuğu (%0–100) panelde görünür; seçimlerin etkisini sunucu hesaplar.
 *  - Davet edilen müdavim oyuncunun Achterstraat'taki evinde belirir (herkes görür).
 *    Ev sahibi yanına gidip E → sohbet, birlikte TV izleme, uğurlama.
 *  - Karakterler paylaşılan düşük poligonlu modellerdir; yalnızca ziyaret değişince sahne güncellenir.
 */
export class NpcRelationshipSystem {
  constructor({ engine, net, hud, interaction, house, bar, modal, device, settings, sfx }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.house = house;
    this.bar = bar;
    this.modal = modal;
    this.device = device;
    this.settings = settings;
    this.sfx = sfx;
    this.selfId = null;
    this.levels = Object.create(null); // ad → seviye (SELF)
    this.mood = false;
    this.visits = []; // EVT.FRIEND_VISITS
    this.actors = new Map(); // ad → { obj, key }
    this.target = null; // panel açıkken: { mode: 'bar', customer, name } | { mode: 'home', name }
    this.view = 'main'; // 'main' | 'topics' | 'drinks'
    this.topicChoices = new Map(); // müşteri kimliği → gösterilen 3 konu (panel her açılışta değişmesin)
    this.pending = false;

    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('friend-panel'),
      name: $('friend-name'),
      bio: $('friend-bio'),
      fill: $('friend-fill'),
      pct: $('friend-pct'),
      reply: $('friend-reply'),
      actions: $('friend-actions'),
    };
    this.el.actions.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (b && !b.disabled) this.onButton(b.dataset.a, b.dataset.v);
    });

    // Barmenin istasyon hedeflerinden ÖNCE değerlendirilir (müşteri tarafındayken)
    interaction.providers.unshift({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  // ---- Sunucu durumu ---------------------------------------------------------------

  applySelf(friends) {
    if (!friends) return;
    this.levels = Object.assign(Object.create(null), friends.levels ?? {});
    this.mood = !!friends.mood;
    if (this.target) this.render();
    this.interaction.invalidate();
  }

  /** EVT.FRIEND_VISITS / snapshot.visits */
  setVisits(list) {
    this.visits = Array.isArray(list) ? list : [];
    const seen = new Set();
    for (const v of this.visits) {
      seen.add(v.name);
      const key = `${v.houseId}:${v.x}:${v.z}:${v.face}`;
      let a = this.actors.get(v.name);
      if (!a) {
        a = { obj: makeCharacter(v.look ?? {}), key: '' };
        this.engine.scene.add(a.obj);
        this.actors.set(v.name, a);
      }
      if (a.key !== key) {
        a.key = key;
        a.obj.position.set(v.x, 0, v.z);
        a.obj.rotation.y = v.face;
      }
    }
    for (const [name, a] of this.actors) {
      if (seen.has(name)) continue;
      this.engine.scene.remove(a.obj);
      this.actors.delete(name);
    }
    if (this.target?.mode === 'home' && !this.myVisit()) this.modal.close(this.el.panel);
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  myVisit() {
    return this.visits.find((v) => v.ownerId === this.selfId) ?? null;
  }

  // ---- Hedefler ----------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (this.house.build.active) return null;
    if (isInsideBar(px, pz)) return this.barTarget(px, pz, f);
    const h = houseAt(px, pz);
    return h ? this.homeTarget(h, px, pz, f) : null;
  }

  barTarget(px, pz, f) {
    // Elinde bardak / yiyecek varken barmenlik önceliklidir; tezgâhın arkasından konuşulmaz
    if (this.bar.hold || this.bar.local || pz > COUNTER_FRONT) return null;
    const S = this.bar.state;
    if (!S) return null;
    let best = null;
    let bestD = Infinity;
    S.stools.forEach((st, i) => {
      if ((st.state !== 'waiting' && st.state !== 'drinking') || st.customer == null || !REGULAR_BY_NAME[st.name]) return;
      const [x, z] = BAR.stools[i].seat;
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > F.RANGE) return;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 0.6 && dot < 0.6) return;
      if (d < bestD) {
        bestD = d;
        best = { st, x, z };
      }
    });
    if (!best) return null;
    const { st } = best;
    const lvl = this.levels[st.name] ?? 0;
    return {
      x: best.x, z: best.z, marker: false, short: 'Konuş',
      label: `💬 ${st.name} ile konuş · 🤝 %${lvl}`,
      use: () => this.open({ mode: 'bar', customer: st.customer, name: st.name }),
    };
  }

  homeTarget(h, px, pz, f) {
    for (const v of this.visits) {
      if (v.houseId !== h.id) continue;
      const dx = v.x - px;
      const dz = v.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > F.RANGE) continue;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 0.6 && dot < 0.4) continue;
      const at = { x: v.x, z: v.z, marker: false };
      if (v.ownerId === this.selfId) {
        return { ...at, short: 'Konuş', label: `💬 ${v.name} ile vakit geçir · 🤝 %${this.levels[v.name] ?? 0}`, use: () => this.open({ mode: 'home', name: v.name }) };
      }
      return { ...at, short: 'Selam', label: `👋 ${v.name} (${v.ownerName} adlı oyuncunun misafiri)`, use: () => this.hud.toast(`${v.name}: "Merhaba! ${v.ownerName} beni davet etti." 🙂`, 'info') };
    }
    return null;
  }

  // ---- Diyalog paneli ------------------------------------------------------------------

  open(target) {
    this.target = target;
    this.view = 'main';
    this.el.reply.textContent = target.mode === 'bar'
      ? `${target.name}: "Selam! Nasılsın?"`
      : `${target.name}: "Evin çok güzelmiş!"`;
    this.render();
    this.modal.open(this.el.panel, () => { this.target = null; });
  }

  topicsFor(t) {
    let list = this.topicChoices.get(t.customer);
    if (list) return list;
    const reg = REGULAR_BY_NAME[t.name];
    const others = TOPICS.map((x) => x.id).filter((id) => id !== reg.love && id !== reg.like);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    // Biri sevdiği (ya da en sevdiği) konu; ötekiler rastgele — hangisi olduğunu biyografiden tahmin et
    const good = Math.random() < 0.5 ? reg.love : reg.like;
    list = [good, others[0], others[1]].sort(() => Math.random() - 0.5);
    this.topicChoices.set(t.customer, list);
    if (this.topicChoices.size > 40) this.topicChoices.delete(this.topicChoices.keys().next().value);
    return list;
  }

  render() {
    const t = this.target;
    if (!t) return;
    const reg = REGULAR_BY_NAME[t.name];
    const lvl = this.levels[t.name] ?? 0;
    this.el.name.textContent = t.mode === 'home' ? `🏠 ${t.name} evinde` : `🍹 ${t.name}`;
    this.el.bio.textContent = reg?.bio ?? '';
    this.el.fill.style.width = `${lvl}%`;
    this.el.fill.classList.toggle('max', lvl >= F.INVITE_AT);
    this.el.pct.textContent = `🤝 Arkadaşlık: %${lvl}`;
    const btns = [];
    const b = (a, label, { v = '', disabled = false, primary = false } = {}) => btns.push({ a, label, v, disabled, primary });
    if (t.mode === 'bar') {
      if (this.view === 'topics') {
        for (const id of this.topicsFor(t)) {
          const tp = TOPIC_BY_ID[id];
          b('topic', `${tp.icon} ${tp.label}`, { v: id });
        }
        b('back', '← Geri');
      } else if (this.view === 'drinks') {
        const wallet = this.house.getWallet();
        // 30 içecekten kısa liste: soft / fıçı / şatlar + müdavimin en sevdiği (kokteyl olsa da)
        const fav = REGULAR_BY_NAME[t.name]?.drink;
        for (const d of DRINKS.filter((x) => x.cat !== 'mocktail' || x.id === fav)) {
          b('drink', `${d.icon} ${d.name} · €${d.price}`, { v: d.id, disabled: wallet < d.price });
        }
        b('back', '← Geri');
      } else {
        b('chat', '💬 Sohbet et');
        b('joke', '😄 Espri yap');
        b('treat', '🥤 İçecek ısmarla');
        const canInvite = lvl >= F.INVITE_AT;
        b('invite', canInvite ? '🏠 Eve davet et' : `🏠 Eve davet et (%${F.INVITE_AT}'de)`, { disabled: !canInvite, primary: canInvite });
        b('close', 'Kapat');
      }
    } else {
      b('homeChat', '💬 Sohbet et');
      b('tv', '📺 Birlikte TV izle');
      b('bye', '👋 Uğurla');
      b('close', 'Kapat');
    }
    this.el.actions.replaceChildren(...btns.map((x) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = x.primary ? 'primary' : 'secondary';
      el.dataset.a = x.a;
      el.dataset.v = x.v;
      el.disabled = x.disabled || this.pending;
      el.textContent = x.label;
      return el;
    }));
  }

  onButton(a, v) {
    const t = this.target;
    if (!t) return;
    if (a === 'close') return this.modal.close(this.el.panel);
    if (a === 'back') this.view = 'main';
    else if (a === 'chat') this.view = 'topics';
    else if (a === 'treat') this.view = 'drinks';
    else if (a === 'topic') return this.send({ act: 'chat', customer: t.customer, topic: v });
    else if (a === 'drink') return this.send({ act: 'treat', customer: t.customer, drink: v });
    else if (a === 'joke' || a === 'invite') return this.send({ act: a, customer: t.customer });
    else if (a === 'homeChat' || a === 'tv' || a === 'bye') return this.send({ act: a });
    this.render();
  }

  async send(data) {
    if (this.pending) return;
    this.pending = true;
    this.render();
    const res = await this.net.request(EVT.FRIEND_ACT, data);
    this.pending = false;
    this.view = 'main';
    if (!this.target) return;
    if (!res.ok) {
      this.el.reply.textContent = `⚠ ${res.error || 'Olmadı.'}`;
      this.render();
      return;
    }
    if (typeof res.level === 'number') this.levels[res.name] = res.level;
    const delta = res.delta ? ` (${res.delta > 0 ? '+' : ''}${res.delta})` : '';
    this.el.reply.textContent = data.act === 'joke'
      ? `Sen: "${res.joke}"\n${res.reply}${delta}`
      : `${res.reply}${delta}`;
    if (res.delta > 0 && this.settings?.sound) this.sfx?.clink?.();
    if (data.act === 'invite') {
      this.hud.toast(`🏠 ${res.name} ${HOUSE_BY_ID[res.houseId]?.name ?? 'evine'} geliyor — Achterstraat'a git!`, 'clean');
      this.modal.close(this.el.panel);
      return;
    }
    if (data.act === 'bye') {
      this.hud.toast(res.reply, 'info');
      this.modal.close(this.el.panel);
      return;
    }
    this.render();
  }

  reset(selfId) {
    this.selfId = selfId;
    if (this.target) this.modal.close(this.el.panel);
  }
}
