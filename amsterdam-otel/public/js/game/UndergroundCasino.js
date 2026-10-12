import { EVT, formatMoney } from '/shared/constants.js';
import { CASINO, isInsideCasino, isInsideSteeg } from '/shared/layout.js';
import {
  RANKS, SUITS, cardRank, cardSuit, isRedSuit, evalHand, bjValue, TABLE_BY_ID, CASINO_TABLES, CASINO_RULES,
  BJ_RULES, POKER_RULES, DICE_RULES, STREETS,
} from '/shared/casino.js';
import { makeCharacter } from './Characters.js';

const SRC_KEY = 'amsterdam-otel:casinoSource:v1';
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const CHIPS = [2, 5, 10, 25, 50];
const DOOR_RANGE = 1.7; // kapının bu kadar yakınında kanat açılır
const SEAT_RANGE = 1.35;
const STATUS_TR = { bust: 'Patladı', stand: 'Durdu', blackjack: 'Blackjack!', playing: 'Oynuyor', bet: 'Bahis kondu' };
const RESULT_TR = { blackjack: 'Blackjack! 3:2', win: 'Kazandı', push: 'Berabere', lose: 'Kaybetti' };

/** HTML kaçışı (isimler sunucuda temizlenir ama yine de) */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cardHtml(c) {
  if (c == null || c < 0) return '<span class="cz-card back" aria-label="kapalı kart"></span>';
  const r = RANKS[cardRank(c)];
  const s = SUITS[cardSuit(c)];
  return `<span class="cz-card${isRedSuit(c) ? ' red' : ''}" aria-label="${r}${s}"><b>${r}</b><i>${s}</i></span>`;
}
const cardsHtml = (list) => (list || []).map(cardHtml).join('');
const srcIcon = (src) => (src === 'kasa' ? ' 🏦' : '');

/**
 * Yeraltı Kart Kulübü (istemci).
 *  - Steeg'deki tabelasız kapı (yaklaşınca içeri açılır) ve masa koltukları Etkileşim sistemine
 *    hedef olarak eklenir: "🃏 Blackjack masasına otur", "♠ Poker masasına otur", "🎲 Zar masasına otur".
 *  - Oturmak 18+ onayı ister (coffee shop'la aynı bayrak). Oturunca oyuncu koltuğa ışınlanır ve
 *    masa paneli açılır (modal: 3D motor durur → pil). Kartlar DOM/CSS ile çizilir.
 *  - Panel yalnızca sunucudan durum olayı gelince yeniden çizilir; geri sayım için panel açıkken
 *    tek bir setTimeout zinciri çalışır, ilerleme çubuğu CSS geçişiyle akar.
 *  - Panel kapanınca (Kalk / Esc) masadan kalkılır. Her şey sunucuda doğrulanır (CasinoService).
 *  - 3D: poker masasındaki NPC oyuncular ve zar turuna katılan NPC'ler durum değişince görünür olur.
 */
export class UndergroundCasino {
  constructor({ engine, net, hud, interaction, player, modal, device, sfx, shop, state, world, vehicles, collision }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.modal = modal;
    this.device = device;
    this.sfx = sfx;
    this.shop = shop;
    this.state = state;
    this.view = world.casino;
    this.selfId = null;
    this.tables = { bj: null, poker: null, dice: null };
    this.priv = null; // { handNo, cards } kendi poker kartların
    this.open = null; // panel açıkken masa id
    this.joining = false; // poker: fiş alma ekranı
    this.pending = false;
    this.leaving = false;
    this.msg = '';
    this.amount = { bj: 10, dice: 5 };
    this.source = 'wallet';
    try { if (localStorage.getItem(SRC_KEY) === 'kasa') this.source = 'kasa'; } catch { /* yok say */ }
    this.tickTimer = 0;
    this.lastResultKey = '';

    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('casino-panel'),
      title: $('cz-title'),
      wallet: $('cz-wallet'),
      kasa: $('cz-kasa'),
      table: $('cz-table'),
      status: $('cz-status'),
      timer: $('cz-timer'),
      timerBar: $('cz-timer').firstElementChild,
      timerText: $('cz-time'),
      controls: $('cz-controls'),
      msg: $('cz-msg'),
    };
    this.el.panel.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-a]');
      if (btn && !btn.disabled) this.onButton(btn.dataset.a, btn.dataset.v);
    });
    // Para göstergesi: cüzdan (SELF) ve kasa (ECONOMY) değişince panel açıksa güncellenir
    net.on(EVT.SELF, () => this.renderMoney());
    net.on(EVT.ECONOMY, () => this.renderMoney());

    // Araçla kulübe girilmesin (sürücüye özel engel)
    if (vehicles?.riderWalls && collision) vehicles.riderWalls.push(collision.add(15.88, 16.12, CASINO.door.from, CASINO.door.to, false));

    // 3D: kapı kanadı (yalnızca kapının yakınındayken ya da kanat hareket ederken iş yapar)
    engine.addSystem((dt) => this.updateDoor(dt));
    this.bots = []; // poker koltuklarındaki NPC'ler
    this.diceNpcs = [];

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  // ---- Sunucu durumu -----------------------------------------------------------------

  reset(selfId) {
    this.selfId = selfId;
    this.priv = null;
  }

  /** WELCOME.casino */
  applySnapshot(c) {
    if (!c) return;
    for (const id of ['bj', 'poker', 'dice']) if (c[id]) this.tables[id] = c[id];
    this.priv = c.mine?.cards ? { handNo: c.mine.handNo, cards: c.mine.cards } : null;
    this.sync3d();
    // Yeniden bağlanınca sunucu bizi masadan kaldırmıştır: panel açıksa kapanır
    if (this.open && !this.mySeat(this.open) && !this.joining) this.close();
    else if (this.open) this.render();
  }

  /** EVT.CASINO_STATE */
  onState(s) {
    if (!s || !TABLE_BY_ID[s.table]) return;
    this.tables[s.table] = s;
    if (s.table === 'poker' && this.priv && this.priv.handNo !== s.handNo) this.priv = null;
    this.sync3d(s.table);
    if (this.open !== s.table) return;
    if (!this.mySeat(s.table) && !this.joining && !this.pending) {
      this.close(); // sunucu masadan kaldırdı (odadan çıkma vb.)
      return;
    }
    this.render();
  }

  /** EVT.CASINO_PRIVATE: kendi kapalı kartların */
  onPrivate(p) {
    if (p?.table !== 'poker') return;
    this.priv = { handNo: p.handNo, cards: p.cards };
    if (this.open === 'poker') this.render();
  }

  mySeat(table) {
    const t = this.tables[table];
    if (!t || this.selfId == null) return null;
    const i = t.seats.findIndex((s) => s && s.kind !== 'bot' && s.id === this.selfId);
    return i < 0 ? null : { i, s: t.seats[i] };
  }

  // ---- 3D ------------------------------------------------------------------------------

  updateDoor(dt) {
    const v = this.view;
    if (!v) return false;
    const { x, z } = this.player.pos;
    const [dx, dz] = v.doorCenter;
    const near = Math.abs(x - dx) < DOOR_RANGE && Math.abs(z - dz) < DOOR_RANGE;
    const goal = near ? 1 : 0;
    const t = v.door.t;
    if (t === goal) return false;
    const step = dt * 2.4;
    v.setDoor(Math.abs(goal - t) <= step ? goal : t + Math.sign(goal - t) * step);
    return true;
  }

  /** Poker koltuklarındaki NPC'ler ve zar turundaki NPC'ler (yalnızca durum değişince) */
  sync3d(table = null) {
    const scene = this.engine.scene;
    if (!table || table === 'poker') {
      const T = CASINO_TABLES.poker;
      const seats = this.tables.poker?.seats ?? [];
      T.seats.forEach((pt, i) => {
        const bot = seats[i]?.kind === 'bot';
        let obj = this.bots[i];
        if (bot && !obj) {
          obj = makeCharacter({ body: i + 2, skin: i + 1, hair: i, hat: i === 3 });
          // Oturuyormuş gibi: koltukta biraz alçakta, gövdeyi masa saklar
          const ox = Math.sin(pt.yaw) * 0.18; // masadan geriye
          const oz = Math.cos(pt.yaw) * 0.18;
          obj.position.set(pt.x + ox, -0.3, pt.z + oz);
          obj.rotation.y = pt.yaw + Math.PI;
          obj.userData.blob.visible = false;
          scene.add(obj);
          this.bots[i] = obj;
        }
        if (obj) obj.visible = bot;
      });
    }
    if (!table || table === 'dice') {
      const npcs = this.tables.dice?.npcs ?? [];
      const spots = [[15.1, 15.85, -Math.PI * 0.25], [13.7, 17.15, Math.PI * 0.75]];
      spots.forEach(([x, z, yaw], i) => {
        let obj = this.diceNpcs[i];
        if (npcs[i] && !obj) {
          obj = makeCharacter({ body: 5 + i, skin: 2 + i, hair: 3 - i });
          obj.position.set(x, 0, z);
          obj.rotation.y = yaw;
          scene.add(obj);
          this.diceNpcs[i] = obj;
        }
        if (obj) obj.visible = !!npcs[i];
      });
    }
    this.engine.requestRender();
  }

  // ---- Etkileşim -------------------------------------------------------------------------

  findTarget(px, pz, f) {
    const facing = (x, z, range, minDot = 0.25) => {
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > range) return -1;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      return d > 0.7 && dot < minDot ? -1 : d - dot * 0.5;
    };
    const [doorX, doorZ] = this.view.doorCenter;
    if (isInsideSteeg(px, pz)) {
      if (facing(doorX, doorZ, 1.9) < 0) return null;
      return {
        x: CASINO.doorPoint[0], z: CASINO.doorPoint[1], marker: false, short: 'Gir',
        label: '🚪 Kart Kulübü — içeri gir',
        use: () => this.walkThrough(15.2, Math.PI / 2, 'Fedai başıyla selam veriyor: "Hoş geldin. Sessiz ol, iyi oyna."'),
      };
    }
    if (!isInsideCasino(px, pz)) return null;
    if (px > 14.6 && facing(doorX, doorZ, 1.5) >= 0) {
      return {
        x: 15.4, z: doorZ, marker: false, short: 'Çık', label: '🚪 Steeg\'e çık',
        use: () => this.walkThrough(16.8, -Math.PI / 2, null),
      };
    }
    let best = null;
    let bestScore = Infinity;
    for (const def of Object.values(CASINO_TABLES)) {
      const t = this.tables[def.id];
      def.seats.forEach((pt, i) => {
        const s = t?.seats[i];
        if (s && s.kind !== 'bot') return; // dolu koltuk
        const score = facing(pt.x, pt.z, SEAT_RANGE, -0.2);
        if (score < 0 || score >= bestScore) return;
        bestScore = score;
        best = { def, i, pt };
      });
    }
    if (!best) return null;
    const { def, i, pt } = best;
    const label = def.id === 'bj' ? '🃏 Blackjack masasına otur'
      : def.id === 'poker' ? `♠ Poker masasına otur (€${POKER_RULES.BUY_IN} fiş)` : '🎲 Zar masasına otur';
    return { x: pt.x, z: pt.z, label, short: 'Otur', use: () => this.sitDown(def.id, i) };
  }

  walkThrough(x, yaw, text) {
    this.player.setPose(x, this.view.doorCenter[1], yaw);
    this.net.sendMove(this.player.pos.x, this.player.pos.z, this.player.yaw);
    this.net.flushMove();
    if (text) this.hud.toast(text, 'info');
    this.engine.requestRender();
  }

  sitDown(table, seat) {
    this.shop.requireAge(() => this.openTable(table, seat),
      'Yeraltı Kart Kulübü kumar (oyun içi para ile blackjack, poker, zar) içerir. Devam etmek için 18 yaşından büyük olmalısın.');
  }

  openTable(table, seat) {
    this.open = table;
    this.seat = seat;
    this.msg = '';
    this.joining = table === 'poker';
    this.render();
    this.modal.open(this.el.panel, () => this.onPanelClosed());
    if (!this.joining) this.join(table, seat, undefined);
  }

  async join(table, seat, source) {
    this.pending = true;
    this.render();
    const res = await this.net.request(EVT.CASINO_ACT, source ? { act: 'sit', table, seat, source } : { act: 'sit', table, seat });
    this.pending = false;
    if (this.open !== table) {
      if (res.ok) this.net.request(EVT.CASINO_ACT, { act: 'leave', table }); // panel bu arada kapandı
      return;
    }
    if (!res.ok) {
      this.joining = false;
      this.hud.toast(res.error || 'Oturulamadı.', 'warn');
      this.close();
      return;
    }
    this.joining = false;
    // Koltuğa ışın: diğer oyuncular seni masada görür
    const pt = CASINO_TABLES[table].seats[res.seat];
    this.player.setPose(pt.x, pt.z, pt.yaw);
    this.net.sendMove(pt.x, pt.z, pt.yaw);
    this.net.flushMove();
    this.render();
  }

  close() {
    if (!this.el.panel.hidden) this.modal.close(this.el.panel);
    else this.onPanelClosed();
  }

  onPanelClosed() {
    const table = this.open;
    this.open = null;
    this.joining = false;
    clearTimeout(this.tickTimer);
    this.tickTimer = 0;
    if (table && this.mySeat(table)) {
      this.net.request(EVT.CASINO_ACT, { act: 'leave', table }).then((res) => {
        if (res.ok && res.cashout > 0) this.hud.toast(`♠ Fişlerin bozduruldu: +${formatMoney(res.cashout)}`, 'money');
      });
    }
    this.interaction.invalidate();
  }

  // ---- Panel düğmeleri -------------------------------------------------------------------

  onButton(a, v) {
    const table = this.open;
    if (!table) return;
    if (a === 'leave') {
      this.close();
      return;
    }
    if (a === 'join') {
      this.join(table, this.seat, v === 'kasa' ? 'kasa' : 'wallet');
      return;
    }
    if (a === 'src') {
      this.source = v === 'kasa' ? 'kasa' : 'wallet';
      try { localStorage.setItem(SRC_KEY, this.source); } catch { /* yok say */ }
      this.render();
      return;
    }
    if (a === 'amt') {
      const lim = table === 'bj' ? [BJ_RULES.MIN_BET, BJ_RULES.MAX_BET] : [DICE_RULES.MIN_STAKE, DICE_RULES.MAX_STAKE];
      const max = this.source === 'kasa' ? Math.min(lim[1], CASINO_RULES.KASA_MAX_PER_ROUND) : lim[1];
      let n = this.amount[table];
      if (v === '+') n += n >= 20 ? 5 : 1;
      else if (v === '-') n -= n > 20 ? 5 : 1;
      else n = Number.parseInt(v, 10) || n;
      this.amount[table] = Math.min(Math.max(n, lim[0]), max);
      this.render();
      return;
    }
    const data = { act: a, table };
    if (a === 'bet' || a === 'stake') {
      data.amount = this.amount[table];
      data.source = this.source;
    }
    this.send(data);
  }

  async send(data) {
    if (this.pending) return;
    this.pending = true;
    this.msg = '';
    this.render();
    const res = await this.net.request(EVT.CASINO_ACT, data);
    this.pending = false;
    if (!res.ok) this.msg = res.error || 'Olmadı.';
    if (this.open) this.render();
  }

  // ---- Çizim ---------------------------------------------------------------------------

  renderMoney() {
    if (!this.open) return;
    this.el.wallet.textContent = formatMoney(this.shop.wallet);
    this.el.kasa.textContent = formatMoney(this.state.economy?.money ?? 0);
  }

  render() {
    const id = this.open;
    if (!id) return;
    const def = TABLE_BY_ID[id];
    this.el.title.textContent = `${def.icon} ${def.name}`;
    this.renderMoney();
    const t = this.tables[id];
    const me = this.mySeat(id);
    let deadline = 0;
    let total = 1;
    if (this.joining) {
      this.renderJoin();
    } else if (!t || !me) {
      this.el.table.innerHTML = '<p class="cz-wait">Masaya oturuluyor…</p>';
      this.el.controls.innerHTML = '';
      this.el.status.textContent = '';
    } else if (id === 'bj') {
      [deadline, total] = this.renderBj(t, me);
    } else if (id === 'poker') {
      [deadline, total] = this.renderPoker(t, me);
    } else {
      [deadline, total] = this.renderDice(t, me);
    }
    this.el.msg.textContent = this.msg;
    if (this.pending) for (const b of this.el.controls.querySelectorAll('button')) b.disabled = true;
    this.setTimer(deadline, total);
  }

  /** Geri sayım: çubuk CSS geçişiyle akar, metin yarım saniyede bir (yalnızca panel açıkken) */
  setTimer(deadline, total) {
    clearTimeout(this.tickTimer);
    this.tickTimer = 0;
    const bar = this.el.timerBar;
    const left = deadline - this.net.serverNow();
    if (!(left > 0)) {
      this.el.timer.hidden = true;
      return;
    }
    this.el.timer.hidden = false;
    const key = `${deadline}`;
    if (this.timerKey !== key) {
      this.timerKey = key;
      bar.style.transition = 'none';
      bar.style.transform = `scaleX(${Math.min(1, left / total)})`;
      void bar.offsetWidth; // geçişi baştan başlat
      bar.style.transition = `transform ${left}ms linear`;
      bar.style.transform = 'scaleX(0)';
    }
    const tick = () => {
      const ms = deadline - this.net.serverNow();
      this.el.timerText.textContent = ms > 0 ? `${Math.ceil(ms / 1000)} sn` : '';
      if (ms > 0 && this.open) this.tickTimer = setTimeout(tick, Math.min(500, ms));
    };
    tick();
  }

  amountControls(table, verb, min, max) {
    const kasaMax = Math.min(max, CASINO_RULES.KASA_MAX_PER_ROUND);
    const cap = this.source === 'kasa' ? kasaMax : max;
    if (this.amount[table] > cap) this.amount[table] = cap;
    const n = this.amount[table];
    const kasaOk = (this.state.economy?.money ?? 0) >= CASINO_RULES.KASA_MIN_BALANCE;
    const chips = CHIPS.filter((c) => c >= min && c <= cap)
      .map((c) => `<button type="button" class="cz-chip${c === n ? ' sel' : ''}" data-a="amt" data-v="${c}">€${c}</button>`).join('');
    return `
      <div class="cz-row cz-amount">
        <button type="button" class="cz-step" data-a="amt" data-v="-" aria-label="Azalt">−</button>
        <b class="cz-amt">€${n}</b>
        <button type="button" class="cz-step" data-a="amt" data-v="+" aria-label="Artır">+</button>
        <span class="cz-chips">${chips}</span>
      </div>
      <div class="cz-row cz-src" role="group" aria-label="Para kaynağı">
        <button type="button" class="cz-seg${this.source === 'wallet' ? ' sel' : ''}" data-a="src" data-v="wallet">🎒 Cüzdan</button>
        <button type="button" class="cz-seg${this.source === 'kasa' ? ' sel' : ''}" data-a="src" data-v="kasa">🏦 Kasa</button>
      </div>
      ${this.source === 'kasa' ? `<p class="cz-note">Otel kasasından: tur başına en fazla €${CASINO_RULES.KASA_MAX_PER_ROUND}, kasada en az €${CASINO_RULES.KASA_MIN_BALANCE} olmalı${kasaOk ? '' : ' — şu an yetersiz'}. Kazanç kasaya döner.</p>` : ''}
      <div class="cz-row"><button type="button" class="primary" data-a="${table === 'bj' ? 'bet' : 'stake'}">${verb} €${n}${srcIcon(this.source)}</button></div>`;
  }

  renderJoin() {
    const P = POKER_RULES;
    const kasa = this.state.economy?.money ?? 0;
    const kasaOk = kasa >= CASINO_RULES.KASA_MIN_BALANCE;
    this.el.status.textContent = '';
    this.el.table.innerHTML = `
      <div class="cz-join">
        <p>Sabit limitli Texas Hold'em · kör €${P.SMALL_BLIND}/€${P.BIG_BLIND} · bahis €${P.SMALL_BET}/€${P.BIG_BET} · sokak başına en fazla ${P.MAX_RAISES} artırma.</p>
        <p>Boş koltuklarda barın müdavimleri oynar. Masaya €${P.BUY_IN} fişle oturursun; kalkınca kalan fişlerin aynı kaynağa bozdurulur.</p>
      </div>`;
    this.el.controls.innerHTML = `
      <div class="cz-row">
        <button type="button" class="primary" data-a="join" data-v="wallet" ${this.shop.wallet >= P.BUY_IN ? '' : 'disabled'}>🎒 Cüzdandan €${P.BUY_IN} fiş al</button>
      </div>
      <div class="cz-row">
        <button type="button" class="cz-alt" data-a="join" data-v="kasa" ${kasaOk ? '' : 'disabled'}>🏦 Kasadan €${P.BUY_IN} fiş al</button>
      </div>
      ${kasaOk ? '' : `<p class="cz-note">Kasadan oynamak için kasada en az €${CASINO_RULES.KASA_MIN_BALANCE} olmalı.</p>`}`;
    if (this.pending) this.el.status.textContent = 'Masaya oturuluyor…';
  }

  seatBox(inner, { me = false, turn = false, empty = false, dim = false, win = false } = {}) {
    const cls = ['cz-seat'];
    if (me) cls.push('me');
    if (turn) cls.push('turn');
    if (empty) cls.push('empty');
    if (dim) cls.push('dim');
    if (win) cls.push('win');
    return `<div class="${cls.join(' ')}">${inner}</div>`;
  }

  renderBj(t, me) {
    const myS = me.s;
    const dealer = t.dealer.length
      ? `${cardsHtml(t.dealer)} <span class="cz-total">${t.dealerTotal}${t.phase === 'playing' ? '+?' : ''}</span>` : '<span class="cz-muted">—</span>';
    const seats = t.seats.map((s, i) => {
      if (!s) return this.seatBox('<span class="cz-name">Boş koltuk</span>', { empty: true });
      const v = s.cards.length ? `<span class="cz-total">${s.total}${s.soft && s.total < 21 ? ' (yumuşak)' : ''}</span>` : '';
      const net = s.payout - s.bet;
      const tag = s.result ? `${RESULT_TR[s.result]}${net > 0 ? ` +€${net}` : ''}` : STATUS_TR[s.status] ?? '';
      return this.seatBox(`
        <div class="cz-name">${esc(s.name)}${s.bet ? ` <span class="cz-bet">€${s.bet}${srcIcon(s.source)}</span>` : ''}</div>
        <div class="cz-cards">${cardsHtml(s.cards)}</div>
        <div class="cz-tag">${v} ${esc(tag)}</div>`, { me: i === me.i, turn: t.phase === 'playing' && t.turn === i, win: s.payout > s.bet && s.result !== 'push' });
    }).join('');
    this.el.table.innerHTML = `
      <div class="cz-dealer"><span class="cz-label">Krupiye</span><div class="cz-cards">${dealer}</div></div>
      <p class="cz-rule">Krupiye 17'de durur · Blackjack 3:2</p>
      <div class="cz-seats">${seats}</div>`;

    let status = '';
    let controls = '';
    let deadline = 0;
    let total = 1;
    if (t.phase === 'idle' || t.phase === 'betting') {
      status = t.phase === 'idle' ? 'Bahsini koy — ilk bahisten sonra diğerleri için kısa bir süre beklenir.' : 'Bahisler alınıyor…';
      if (t.phase === 'betting') { deadline = t.endsAt; total = BJ_RULES.BET_WINDOW_MS; }
      if (!myS.bet) controls = this.amountControls('bj', 'Bahis koy', t.minBet, t.maxBet);
      else status = `Bahsin: €${myS.bet}${srcIcon(myS.source)} — kartlar birazdan dağıtılıyor.`;
    } else if (t.phase === 'playing') {
      const turnS = t.seats[t.turn];
      deadline = t.turnEndsAt;
      total = CASINO_RULES.TURN_MS;
      if (t.turn === me.i) {
        status = `Sıra sende: elin ${myS.total}. Kart çek ya da dur.`;
        const canDouble = myS.cards.length === 2;
        controls = `<div class="cz-row cz-actions">
          <button type="button" class="primary" data-a="hit">🂠 Kart çek</button>
          <button type="button" class="primary cz-stand" data-a="stand">✋ Dur</button>
          ${canDouble ? `<button type="button" class="cz-alt" data-a="double">×2 İkiye katla (€${myS.bet})</button>` : ''}
        </div>`;
      } else {
        status = myS.bet ? `Sıra: ${turnS?.name ?? '…'} — bekle.` : 'Bu eli izliyorsun — sonraki elde bahis koyabilirsin.';
      }
    } else if (t.phase === 'result') {
      deadline = t.endsAt;
      total = CASINO_RULES.RESULT_MS;
      if (myS.result) {
        status = myS.result === 'lose' ? `Kaybettin (€${myS.bet}).` : myS.result === 'push' ? `Berabere — bahsin iade (€${myS.bet}).`
          : `${myS.result === 'blackjack' ? 'Blackjack! ' : ''}Kazandın: +€${myS.payout - myS.bet}`;
        this.celebrate(`bj:${t.round}`, myS.result === 'win' || myS.result === 'blackjack');
      } else status = 'El bitti — yeni el birazdan.';
    }
    this.el.status.textContent = status;
    this.el.controls.innerHTML = controls;
    return [deadline, total];
  }

  renderPoker(t, me) {
    const myS = me.s;
    const live = STREETS.includes(t.phase);
    const board = [0, 1, 2, 3, 4].map((k) => (t.board[k] != null ? cardHtml(t.board[k]) : '<span class="cz-card slot"></span>')).join('');
    const myCards = this.priv?.handNo === t.handNo && myS.inHand ? this.priv.cards : null;
    const seats = t.seats.map((s, i) => {
      if (!s) return this.seatBox('<span class="cz-name">Boş koltuk</span>', { empty: true });
      const mine = i === me.i;
      let cards = '';
      if (mine && myCards) cards = cardsHtml(myCards);
      else if (s.cards) cards = cardsHtml(s.cards);
      else if (s.cardCount) cards = cardsHtml(Array(s.cardCount).fill(-1));
      const btn = t.button === i ? '<span class="cz-btn" title="Krupiye düğmesi">D</span>' : '';
      const bet = s.streetBet ? ` <span class="cz-bet">€${s.streetBet}</span>` : '';
      let tag = s.lastAction ?? '';
      if (s.won) tag = `+€${s.won}${s.handName ? ` · ${s.handName}` : ''}`;
      else if (s.handName) tag = s.handName;
      if (!s.inHand && s.kind === 'human') tag = s.chips < (t.blinds?.[1] ?? 2) ? 'Fişi yok' : 'Sonraki eli bekliyor';
      return this.seatBox(`
        <div class="cz-name">${btn}${s.kind === 'bot' ? '🤖 ' : ''}${esc(s.name)}${srcIcon(s.source)}</div>
        <div class="cz-cards">${cards}</div>
        <div class="cz-tag"><span class="cz-chipcount">€${s.chips}</span>${bet} ${esc(tag)}</div>`,
      { me: mine, turn: live && t.toAct === i, dim: s.folded || (!s.inHand && live), win: s.won > 0 });
    }).join('');
    const handName = myCards && t.board.length >= 3 ? evalHand([...myCards, ...t.board]).name : '';
    this.el.table.innerHTML = `
      <div class="cz-board"><div class="cz-cards">${board}</div><span class="cz-pot">Pot: €${t.pot}</span></div>
      ${handName ? `<p class="cz-rule">Elin: <b>${esc(handName)}</b></p>` : `<p class="cz-rule">Kör €${t.blinds[0]}/€${t.blinds[1]} · bahis €${t.betSize}</p>`}
      <div class="cz-seats">${seats}</div>`;

    let status = '';
    let controls = '';
    let deadline = 0;
    let total = 1;
    const broke = myS.chips < t.blinds[1];
    if (live) {
      const turnS = t.seats[t.toAct];
      if (t.toAct === me.i) {
        deadline = t.turnEndsAt;
        total = CASINO_RULES.TURN_MS;
        const toCall = t.currentBet - myS.streetBet;
        const canRaise = myS.chips > toCall && (t.currentBet === 0 || t.raises < t.maxRaises);
        const raiseTo = t.currentBet + t.betSize;
        status = toCall > 0 ? `Sıra sende: €${toCall} görmen gerek.` : 'Sıra sende.';
        controls = `<div class="cz-row cz-actions">
          <button type="button" class="cz-fold" data-a="fold">Çekil</button>
          ${toCall > 0
    ? `<button type="button" class="primary" data-a="call">Gör €${Math.min(toCall, myS.chips)}${toCall >= myS.chips ? ' (all-in)' : ''}</button>`
    : '<button type="button" class="primary" data-a="check">Pas</button>'}
          <button type="button" class="cz-alt" data-a="raise" ${canRaise ? '' : 'disabled'}>${t.currentBet === 0 ? `Bahis €${t.betSize}` : `Artır → €${raiseTo}`}</button>
        </div>`;
        if (t.currentBet > 0 && t.raises >= t.maxRaises) status += ' (artırma sınırı doldu)';
      } else {
        if (turnS?.kind === 'human') { deadline = t.turnEndsAt; total = CASINO_RULES.TURN_MS; }
        status = myS.inHand && !myS.folded ? `${turnS?.name ?? '…'} düşünüyor…` : 'Bu eli izliyorsun.';
      }
    } else if (t.phase === 'result') {
      deadline = t.endsAt;
      total = CASINO_RULES.RESULT_MS;
      const w = t.winners.map((x) => `${x.name} +€${x.amount}${x.handName ? ` (${x.handName})` : ''}`).join(', ');
      status = w ? `🏆 ${w}` : 'El bitti.';
      this.celebrate(`poker:${t.handNo}`, t.winners.some((x) => x.seat === me.i));
    } else {
      deadline = t.endsAt;
      total = POKER_RULES.START_MS;
      status = broke ? 'Fişin bitti — yeni fiş al ya da kalk.' : t.endsAt ? 'Yeni el birazdan başlıyor…' : 'Oyuncular bekleniyor…';
    }
    if (broke && !(live && myS.inHand && !myS.folded)) {
      controls += `<div class="cz-row"><button type="button" class="primary" data-a="rebuy">€${t.buyIn} fiş al${srcIcon(myS.source)}</button></div>`;
    }
    this.el.status.textContent = status;
    this.el.controls.innerHTML = controls;
    return [deadline, total];
  }

  renderDice(t, me) {
    const myS = me.s;
    const dice = (rolls) => rolls.map((r, k) => `<span class="cz-dice${k < rolls.length - 1 ? ' old' : ''}">${DICE_FACES[r[0] - 1]}${DICE_FACES[r[1] - 1]}</span>`).join('');
    const w = t.winner;
    const row = (x, opts, label) => this.seatBox(`
      <div class="cz-name">${label}</div>
      <div class="cz-cards">${x.rolls?.length ? dice(x.rolls) : ''}</div>
      <div class="cz-tag">${x.stake ? `<span class="cz-bet">€${x.stake}${srcIcon(x.source)}</span>` : 'Pay bekleniyor'} ${x.rolls?.length ? `<b>${x.total}</b>` : ''}</div>`, opts);
    const seats = t.seats.map((s, i) => (s
      ? row(s, { me: i === me.i, win: w && !w.npc && w.seat === i }, esc(s.name))
      : this.seatBox('<span class="cz-name">Boş koltuk</span>', { empty: true })));
    const npcs = t.npcs.map((n) => row(n, { win: w?.npc && w.name === n.name }, `🤖 ${esc(n.name)}`));
    this.el.table.innerHTML = `
      <div class="cz-board"><span class="cz-pot">Pot: €${t.pot}</span></div>
      <p class="cz-rule">Herkes 2 zar atar · en yüksek toplam potun tamamını alır · beraberlikte yeniden atılır</p>
      <div class="cz-seats">${[...seats, ...npcs].join('')}</div>`;
    let status = '';
    let controls = '';
    let deadline = 0;
    let total = 1;
    if (t.phase === 'idle' || t.phase === 'betting') {
      if (t.phase === 'betting') { deadline = t.endsAt; total = DICE_RULES.BET_WINDOW_MS; }
      if (!myS.stake) {
        status = 'Payını seç ve pota koy. 1–2 müdavim de katılır.';
        controls = this.amountControls('dice', 'Pota koy', t.minStake, t.maxStake);
      } else status = 'Diğer oyuncular bekleniyor…';
    } else if (t.phase === 'result') {
      deadline = t.endsAt;
      total = CASINO_RULES.RESULT_MS;
      const mine = w && !w.npc && w.seat === me.i;
      status = w ? `${mine ? '🏆 Kazandın' : `${w.name} kazandı`}: €${w.amount} (toplam ${w.total})` : '';
      this.celebrate(`dice:${t.round}`, mine);
    }
    this.el.status.textContent = status;
    this.el.controls.innerHTML = controls;
    return [deadline, total];
  }

  /** Kazanınca bir kez ses */
  celebrate(key, won) {
    if (this.lastResultKey === key) return;
    this.lastResultKey = key;
    if (won) this.sfx?.coin?.();
  }
}
