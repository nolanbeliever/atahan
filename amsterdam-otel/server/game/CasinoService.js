import { EVT, BAR_CUSTOMER_NAMES } from '../../shared/constants.js';
import { isInsideCasino } from '../../shared/layout.js';
import {
  TABLE_BY_ID, CASINO_RULES as R, BJ_RULES, POKER_RULES as PR, DICE_RULES, STREETS, HIDDEN_CARD,
  makeDeck, shuffle, bjValue, isBlackjack, dealerShouldHit, bjSettle, evalHand, handStrength,
} from '../../shared/casino.js';

// İstemci girdileri: yalnızca doğru tipteki değer kabul edilir. Number()/String() ile ÇEVRİLMEZ
// ({ toString: 1 } gibi bir nesne çevrilirken TypeError fırlatır).
const str = (v) => (typeof v === 'string' ? v : '');
const int = (v) => (Number.isInteger(v) ? v : NaN);
const err = (error) => ({ ok: false, error });

// Prototipsiz arama tabloları: 'constructor' / '__proto__' gibi anahtarlar undefined döner
const lookup = (keys) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(keys.map((k) => [k, true]))));
const ACTS = lookup(['sit', 'leave', 'bet', 'hit', 'stand', 'double', 'stake', 'fold', 'check', 'call', 'raise', 'rebuy']);
const SOURCES = lookup(['wallet', 'kasa']);

const emptySeats = () => Array.from({ length: R.SEATS }, () => null);
const newBj = () => ({ phase: 'idle', seats: emptySeats(), dealer: [], endsAt: 0, turn: -1, turnEndsAt: 0, round: 0 });
const newDice = () => ({ phase: 'idle', seats: emptySeats(), npcs: [], endsAt: 0, pot: 0, winner: null, round: 0 });
const newPoker = () => ({
  phase: 'idle', // 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'result'
  seats: emptySeats(),
  deck: [],
  board: [],
  button: -1,
  toAct: -1,
  turnEndsAt: 0,
  botActAt: 0,
  endsAt: 0, // idle: yeni elin başlama anı (0 = beklenmiyor) · result: sonuç ekranının bitişi
  street: -1,
  currentBet: 0,
  raises: 0,
  needs: new Set(), // bu sokakta hâlâ hamle yapması gereken koltuklar
  dead: 0, // elin ortasında kalkanların pottaki fişleri
  handNo: 0,
  winners: [],
});

const ACTION_LABEL = Object.freeze({
  fold: 'Çekildi', check: 'Pas', call: 'Gördü', raise: 'Artırdı', bet: 'Bahis', allin: 'All-in', sb: 'Küçük kör', bb: 'Büyük kör',
});

/**
 * Yeraltı Kart Kulübü — sunucu yetkili kart / zar masaları.
 *  - Blackjack (krupiyeye karşı, 4 koltuk): bahis penceresi → dağıtım → sırayla Kart/Dur/İkiye katla
 *    (süre dolunca dur) → krupiye 17'ye kadar çeker → ödeme (blackjack 3:2, kazanç 1:1, berabere iade).
 *  - Poker (sabit limitli Texas Hold'em, 4 koltuk): boş koltuklara NPC oyuncular oturur; kör 1/2,
 *    bahis 2/4, sokak başına en fazla 3 artırma, yan potlar, el değerlendirici shared/casino.js'te.
 *    Masaya otururken fiş alınır (BUY_IN), kalkınca kalan fiş aynı kaynağa bozdurulur.
 *  - Zar düellosu: oturanlar ve 1–2 NPC kendi seçtiği tutarı pota koyar, herkes 2 zar atar,
 *    en yüksek toplam potun tamamını alır (beraberlikte yalnızca berabere kalanlar yeniden atar).
 *  - Para kaynağı her bahiste seçilir: 'wallet' (kişisel cüzdan, varsayılan) ya da 'kasa' (otelin
 *    ortak kasası: tur başına en fazla €50 ve kasada en az €500). Kazanç aynı kaynağa döner.
 *  - Başkalarının poker kartları el sonuna (showdown) kadar YAYINLANMAZ; kendi kartların yalnızca
 *    sana gider (EVT.CASINO_PRIVATE). Zamanlayıcılar sim.tick → update(now) ile ilerler; masada kimse
 *    oturmuyorsa hiçbir iş yapılmaz. Rastgelelik sim.rng (testlerde tohumlanır).
 */
export class CasinoService {
  constructor(sim) {
    this.sim = sim;
    this.seated = new Map(); // oyuncu id → { table, seat }
    this.bj = newBj();
    this.poker = newPoker();
    this.dice = newDice();
    this.shoe = [];
  }

  get rng() { return this.sim.rng; }

  table(id) { return this[id]; }

  // ---- Para --------------------------------------------------------------------------

  /** Bu kaynaktan `amount` alınabilir mi? kasaRound: bu turda kasadan zaten alınan */
  payCheck(p, source, amount, kasaRound = 0) {
    if (source === 'kasa') {
      if (kasaRound + amount > R.KASA_MAX_PER_ROUND) return err(`Kasadan tur başına en fazla €${R.KASA_MAX_PER_ROUND} oynanabilir.`);
      if (!(this.sim.money >= R.KASA_MIN_BALANCE)) return err(`Kasadan oynamak için kasada en az €${R.KASA_MIN_BALANCE} olmalı.`);
      return null;
    }
    if (!(p.wallet >= amount)) return err('Cüzdanında yeterli para yok.');
    return null;
  }

  take(p, source, amount, reason) {
    if (source === 'kasa') this.treasury(-amount, reason);
    else {
      p.wallet -= amount;
      this.sim.shop.sendSelf(p); // anahtarlı oyuncunun cüzdanı da kaydedilir
    }
  }

  give(p, source, amount, reason) {
    if (!(amount > 0) || !p) return;
    if (source === 'kasa') this.treasury(amount, reason);
    else {
      p.wallet += amount;
      this.sim.shop.sendSelf(p);
    }
  }

  /** Otel kasası (kalıcı): herkese ekonomi olayı + kayıt */
  treasury(delta, reason) {
    this.sim.money += delta;
    this.sim.out(EVT.ECONOMY, this.sim.economy(delta, reason));
    this.sim.house.scheduleSave();
  }

  /** İstemciden gelen tutar ve kaynak: yalnızca izin verilen aralıktaki tamsayı */
  readBet(data, min, max) {
    const amount = int(data.amount);
    if (!(amount >= min && amount <= max)) return { error: `Tutar €${min}–€${max} arasında olmalı.` };
    const source = data.source === undefined ? 'wallet' : str(data.source);
    if (!SOURCES[source]) return { error: 'Geçersiz para kaynağı.' };
    return { amount, source };
  }

  // ---- Yayın ---------------------------------------------------------------------------

  changed(id) { this.sim.out(EVT.CASINO_STATE, this.publicState(id)); }

  publicState(id) {
    if (id === 'bj') return this.bjPublic();
    if (id === 'poker') return this.pokerPublic();
    return this.dicePublic();
  }

  /** WELCOME snapshot: üç masanın açık durumu + bu oyuncunun koltuğu ve kendi kartları */
  serialize(selfId) {
    const s = this.seated.get(selfId);
    let mine = null;
    if (s) {
      mine = { table: s.table, seat: s.seat };
      const ps = s.table === 'poker' ? this.poker.seats[s.seat] : null;
      if (ps?.inHand) Object.assign(mine, { handNo: this.poker.handNo, cards: [...ps.hole] });
    }
    return { bj: this.bjPublic(), poker: this.pokerPublic(), dice: this.dicePublic(), mine };
  }

  // ---- Giriş noktası -------------------------------------------------------------------

  /** @returns {{ ok: true, ... } | { ok: false, error }} */
  act(p, data, now = this.sim.now()) {
    if (!data || typeof data !== 'object') return err('Geçersiz istek.');
    const act = str(data.act);
    if (!ACTS[act]) return err('Geçersiz işlem.');
    if (act === 'sit') return this.sit(p, data, now);
    const s = this.seated.get(p.id);
    if (!s) return err('Önce bir masaya otur.');
    if (data.table !== s.table) return err('Bu masada oturmuyorsun.');
    if (act === 'leave') return this.leave(p, now);
    if (s.table === 'bj') return this.bjAct(p, s.seat, act, data, now);
    if (s.table === 'poker') return this.pokerAct(p, s.seat, act, now);
    return this.diceAct(p, s.seat, act, data, now);
  }

  sit(p, data, now) {
    const def = TABLE_BY_ID[str(data.table)];
    if (!def) return err('Böyle bir masa yok.');
    if (this.seated.has(p.id)) return err('Zaten bir masada oturuyorsun — önce kalk.');
    if (!isInsideCasino(p.x, p.z)) return err('Kart Kulübü\'nün içinde olmalısın.');
    if (Math.hypot(p.x - def.center[0], p.z - def.center[1]) > R.RANGE + 1.5) return err('Masaya yaklaş.');
    const t = this.table(def.id);
    const free = (i) => !t.seats[i] || (def.id === 'poker' && t.seats[i].kind === 'bot');
    let seat;
    if (data.seat === undefined) {
      seat = t.seats.findIndex((x) => !x);
      if (seat < 0 && def.id === 'poker') seat = t.seats.findIndex((x, i) => free(i));
    } else {
      seat = int(data.seat);
      if (!(seat >= 0 && seat < R.SEATS)) return err('Geçersiz koltuk.');
    }
    if (!(seat >= 0) || !free(seat)) return err(seat >= 0 ? 'Bu koltuk dolu.' : 'Masada boş koltuk yok.');

    const base = { kind: 'human', id: p.id, name: p.name };
    if (def.id === 'poker') {
      const source = data.source === undefined ? 'wallet' : str(data.source);
      if (!SOURCES[source]) return err('Geçersiz para kaynağı.');
      const no = this.payCheck(p, source, PR.BUY_IN);
      if (no) return no;
      if (t.seats[seat]) this.pokerRemoveSeat(seat, now); // NPC kalkıp yerini verir (elindeyse çekilir)
      this.take(p, source, PR.BUY_IN, 'Kart Kulübü · poker fişi');
      t.seats[seat] = { ...base, ...this.pokerSeatReset(), chips: PR.BUY_IN, source };
      if (t.phase === 'idle' && !t.endsAt) t.endsAt = now + PR.START_MS;
    } else if (def.id === 'bj') {
      t.seats[seat] = { ...base, ...bjSeatReset() };
    } else {
      t.seats[seat] = { ...base, ...diceSeatReset() };
    }
    this.seated.set(p.id, { table: def.id, seat });
    this.changed(def.id);
    return { ok: true, table: def.id, seat };
  }

  /** Masadan kalk (ayrılma / bağlantı kopması / odadan çıkma) */
  leave(p, now = this.sim.now()) {
    const s = this.seated.get(p.id);
    if (!s) return err('Bir masada oturmuyorsun.');
    this.seated.delete(p.id);
    const t = this.table(s.table);
    const seat = t.seats[s.seat];
    let cashout = 0;
    if (s.table === 'bj') {
      // Dağıtımdan önce kalkan bahsini geri alır; dağıtımdan sonra bahis masada kalır (kumarhane kuralı)
      if (seat.bet > 0 && t.phase === 'betting') this.give(p, seat.source, seat.bet, 'Kart Kulübü · bahis iadesi');
      t.seats[s.seat] = null;
      if (t.phase === 'playing' && t.turn === s.seat) this.bjNextTurn(now);
      else if (t.phase === 'betting' && !t.seats.some((x) => x?.bet > 0)) Object.assign(t, { phase: 'idle', endsAt: 0 });
    } else if (s.table === 'poker') {
      cashout = seat.chips;
      this.give(p, seat.source, cashout, 'Kart Kulübü · fiş bozdurma');
      seat.chips = 0;
      this.pokerRemoveSeat(s.seat, now);
    } else {
      if (seat.stake > 0 && t.phase === 'betting') this.give(p, seat.source, seat.stake, 'Kart Kulübü · zar iadesi');
      t.seats[s.seat] = null;
      if (t.phase === 'betting' && !t.seats.some((x) => x?.stake > 0)) Object.assign(t, { phase: 'idle', endsAt: 0 });
    }
    // Masada başka gerçek oyuncu kalmadıysa masa sıfırlanır (NPC'ler kalkar, zamanlayıcı kalmaz)
    if (!t.seats.some((x) => x?.kind === 'human')) this.resetTable(s.table);
    this.changed(s.table);
    return { ok: true, cashout };
  }

  resetTable(id) {
    if (id === 'bj') this.bj = newBj();
    else if (id === 'poker') this.poker = newPoker();
    else this.dice = newDice();
  }

  /** Oyuncu oyundan çıkarken (sim.players'tan silinmeden ve cüzdanı kaydedilmeden ÖNCE) */
  removePlayer(p) {
    if (this.seated.has(p.id)) this.leave(p);
  }

  update(now) {
    if (!this.seated.size) return; // kimse oturmuyorsa hiçbir zamanlayıcı yok
    // Odadan çıkan oyuncu masadan kalkmış sayılır
    for (const id of [...this.seated.keys()]) {
      const p = this.sim.players.get(id);
      if (p && !isInsideCasino(p.x, p.z)) {
        this.leave(p, now);
        this.sim.toPlayer(p.id, EVT.NOTIFY, { text: 'Kart Kulübü\'nden çıktın — masadan kalktın.', kind: 'info' });
      }
    }
    this.bjUpdate(now);
    this.pokerUpdate(now);
    this.diceUpdate(now);
  }

  // ==== Blackjack ========================================================================

  draw() {
    if (!this.shoe.length) this.shoe = shuffle(makeDeck(BJ_RULES.DECKS), this.rng);
    return this.shoe.pop();
  }

  bjAct(p, i, act, data, now) {
    const t = this.bj;
    const seat = t.seats[i];
    if (act === 'bet') {
      if (t.phase !== 'idle' && t.phase !== 'betting') return err('Bu el sürüyor — bir sonraki elde bahis koy.');
      if (seat.bet > 0) return err('Bahsini zaten koydun.');
      const b = this.readBet(data, BJ_RULES.MIN_BET, BJ_RULES.MAX_BET);
      if (b.error) return err(b.error);
      const no = this.payCheck(p, b.source, b.amount);
      if (no) return no;
      this.take(p, b.source, b.amount, 'Kart Kulübü · blackjack bahsi');
      Object.assign(seat, { bet: b.amount, source: b.source, kasa: b.source === 'kasa' ? b.amount : 0, status: 'bet' });
      if (t.phase === 'idle') Object.assign(t, { phase: 'betting', endsAt: now + BJ_RULES.BET_WINDOW_MS });
      // Oturan herkes bahsini koyduysa beklemeden dağıt
      if (t.seats.every((x) => !x || x.bet > 0)) this.bjDeal(now);
      this.changed('bj');
      return { ok: true };
    }
    if (act !== 'hit' && act !== 'stand' && act !== 'double') return err('Bu masada geçersiz işlem.');
    if (t.phase !== 'playing' || t.turn !== i) return err('Sıra sende değil.');
    if (act === 'hit') {
      seat.cards.push(this.draw());
      const v = bjValue(seat.cards).total;
      if (v > 21) seat.status = 'bust';
      else if (v === 21) seat.status = 'stand';
    } else if (act === 'stand') {
      seat.status = 'stand';
    } else {
      if (seat.cards.length !== 2 || seat.doubled) return err('Yalnızca ilk iki kartla ikiye katlanır.');
      const no = this.payCheck(p, seat.source, seat.bet, seat.kasa);
      if (no) return no;
      this.take(p, seat.source, seat.bet, 'Kart Kulübü · ikiye katlama');
      if (seat.source === 'kasa') seat.kasa += seat.bet;
      seat.bet *= 2;
      seat.doubled = true;
      seat.cards.push(this.draw());
      seat.status = bjValue(seat.cards).total > 21 ? 'bust' : 'stand';
    }
    if (seat.status !== 'playing') this.bjNextTurn(now);
    else t.turnEndsAt = now + R.TURN_MS; // kart çekince süre yenilenir
    this.changed('bj');
    return { ok: true };
  }

  bjDeal(now) {
    const t = this.bj;
    if (this.shoe.length < BJ_RULES.RESHUFFLE_AT) this.shoe = shuffle(makeDeck(BJ_RULES.DECKS), this.rng);
    const players = t.seats.filter((x) => x?.bet > 0);
    t.round++;
    t.dealer = [];
    for (let k = 0; k < 2; k++) {
      for (const s of players) s.cards.push(this.draw());
      t.dealer.push(this.draw());
    }
    for (const s of players) s.status = isBlackjack(s.cards) ? 'blackjack' : 'playing';
    // Krupiye blackjack'i: açık kart as ya da 10'luksa bakar; varsa el hemen biter
    if (isBlackjack(t.dealer)) {
      this.bjFinish(now);
      return;
    }
    t.phase = 'playing';
    t.turn = -1;
    this.bjNextTurn(now);
  }

  bjNextTurn(now) {
    const t = this.bj;
    const next = t.seats.findIndex((x) => x?.status === 'playing');
    if (next < 0) {
      this.bjFinish(now);
      return;
    }
    t.turn = next;
    t.turnEndsAt = now + R.TURN_MS;
  }

  bjFinish(now) {
    const t = this.bj;
    // Ayakta kalan (patlamamış, blackjack'siz) biri varsa krupiye 17'ye kadar çeker
    if (t.seats.some((x) => x?.status === 'stand')) {
      while (dealerShouldHit(t.dealer)) t.dealer.push(this.draw());
    }
    for (const s of t.seats) {
      if (!s || !(s.bet > 0)) continue;
      const r = bjSettle(s.cards, t.dealer, s.bet);
      s.result = r.result;
      s.payout = r.payout;
      s.status = 'done';
      this.give(this.sim.players.get(s.id), s.source, r.payout, 'Kart Kulübü · blackjack kazancı');
    }
    Object.assign(t, { phase: 'result', endsAt: now + R.RESULT_MS, turn: -1, turnEndsAt: 0 });
  }

  bjUpdate(now) {
    const t = this.bj;
    if (t.phase === 'betting' && now >= t.endsAt) this.bjDeal(now);
    else if (t.phase === 'playing' && now >= t.turnEndsAt) {
      t.seats[t.turn].status = 'stand'; // süre doldu: otomatik dur
      this.bjNextTurn(now);
    } else if (t.phase === 'result' && now >= t.endsAt) {
      for (const s of t.seats) if (s) Object.assign(s, bjSeatReset());
      Object.assign(t, { phase: 'idle', dealer: [], endsAt: 0 });
    } else return;
    this.changed('bj');
  }

  bjPublic() {
    const t = this.bj;
    const hide = t.phase === 'playing';
    const dealer = t.dealer.map((c, i) => (hide && i === 1 ? HIDDEN_CARD : c));
    return {
      table: 'bj',
      phase: t.phase,
      endsAt: t.endsAt,
      turn: t.turn,
      turnEndsAt: t.turnEndsAt,
      round: t.round,
      dealer,
      dealerTotal: t.dealer.length ? bjValue(hide ? [t.dealer[0]] : t.dealer).total : 0,
      minBet: BJ_RULES.MIN_BET,
      maxBet: BJ_RULES.MAX_BET,
      seats: t.seats.map((s) => s && {
        id: s.id,
        name: s.name,
        bet: s.bet,
        source: s.source,
        cards: [...s.cards],
        total: bjValue(s.cards).total,
        soft: bjValue(s.cards).soft,
        status: s.status,
        doubled: s.doubled,
        result: s.result,
        payout: s.payout,
      }),
    };
  }

  // ==== Zar düellosu =======================================================================

  diceAct(p, i, act, data, now) {
    const t = this.dice;
    const seat = t.seats[i];
    if (act !== 'stake') return err('Bu masada geçersiz işlem.');
    if (t.phase !== 'idle' && t.phase !== 'betting') return err('Zarlar atılıyor — bir sonraki tura katıl.');
    if (seat.stake > 0) return err('Pota zaten koydun.');
    const b = this.readBet(data, DICE_RULES.MIN_STAKE, DICE_RULES.MAX_STAKE);
    if (b.error) return err(b.error);
    const no = this.payCheck(p, b.source, b.amount);
    if (no) return no;
    this.take(p, b.source, b.amount, 'Kart Kulübü · zar potu');
    Object.assign(seat, { stake: b.amount, source: b.source });
    if (t.phase === 'idle') Object.assign(t, { phase: 'betting', endsAt: now + DICE_RULES.BET_WINDOW_MS });
    if (t.seats.every((x) => !x || x.stake > 0)) this.diceRoll(now);
    this.changed('dice');
    return { ok: true };
  }

  randInt(min, max) { return min + Math.floor(this.rng() * (max - min + 1)); }

  diceRoll(now) {
    const t = this.dice;
    t.round++;
    // 1–2 NPC her tura katılır (barın müdavimleri)
    const npcCount = 1 + (this.rng() < 0.5 ? 1 : 0);
    const names = BAR_CUSTOMER_NAMES.filter(() => true);
    shuffle(names, this.rng);
    t.npcs = names.slice(0, npcCount).map((name) => ({
      name, stake: this.randInt(DICE_RULES.NPC_MIN_STAKE, DICE_RULES.NPC_MAX_STAKE), rolls: [], total: 0,
    }));
    const all = [...t.seats.filter((x) => x?.stake > 0), ...t.npcs];
    t.pot = all.reduce((sum, x) => sum + x.stake, 0);
    let contenders = all;
    for (let r = 0; r <= DICE_RULES.MAX_REROLLS && contenders.length > 1; r++) {
      let best = -1;
      for (const c of contenders) {
        const roll = [this.randInt(1, 6), this.randInt(1, 6)];
        c.rolls.push(roll);
        c.total = roll[0] + roll[1];
        best = Math.max(best, c.total);
      }
      contenders = contenders.filter((c) => c.total === best);
    }
    const win = contenders.length === 1 ? contenders[0] : contenders[Math.floor(this.rng() * contenders.length)];
    const human = win.kind === 'human';
    t.winner = { name: win.name, npc: !human, seat: human ? t.seats.indexOf(win) : -1, amount: t.pot, total: win.total };
    if (human) this.give(this.sim.players.get(win.id), win.source, t.pot, 'Kart Kulübü · zar potu');
    Object.assign(t, { phase: 'result', endsAt: now + R.RESULT_MS });
  }

  diceUpdate(now) {
    const t = this.dice;
    if (t.phase === 'betting' && now >= t.endsAt) this.diceRoll(now);
    else if (t.phase === 'result' && now >= t.endsAt) {
      for (const s of t.seats) if (s) Object.assign(s, diceSeatReset());
      Object.assign(t, { phase: 'idle', endsAt: 0, npcs: [], pot: 0, winner: null });
    } else return;
    this.changed('dice');
  }

  dicePublic() {
    const t = this.dice;
    const pub = (x) => ({ name: x.name, stake: x.stake, rolls: x.rolls.map((r) => [...r]), total: x.total });
    return {
      table: 'dice',
      phase: t.phase,
      endsAt: t.endsAt,
      round: t.round,
      pot: t.phase === 'result' ? t.pot : t.seats.reduce((sum, x) => sum + (x?.stake || 0), 0),
      minStake: DICE_RULES.MIN_STAKE,
      maxStake: DICE_RULES.MAX_STAKE,
      seats: t.seats.map((s) => s && { id: s.id, source: s.source, ...pub(s) }),
      npcs: t.npcs.map(pub),
      winner: t.winner ? { ...t.winner } : null,
    };
  }

  // ==== Poker ==============================================================================

  pokerSeatReset() {
    return {
      hole: [], inHand: false, folded: false, allIn: false, streetBet: 0, committed: 0, lastAction: null, won: 0, handName: null, show: false,
    };
  }

  inHand(i) {
    const s = this.poker.seats[i];
    return !!s && s.inHand && !s.folded;
  }

  /** i'den sonraki (saat yönünde) koşulu sağlayan koltuk; yoksa -1 */
  nextSeat(from, pred) {
    for (let k = 1; k <= R.SEATS; k++) {
      const i = (from + k + R.SEATS) % R.SEATS;
      if (pred(i)) return i;
    }
    return -1;
  }

  pokerAct(p, i, act, now) {
    const t = this.poker;
    const seat = t.seats[i];
    if (act === 'rebuy') {
      if (seat.inHand && !seat.folded && STREETS.includes(t.phase)) return err('El bitince fiş alabilirsin.');
      if (seat.chips >= PR.BIG_BLIND) return err('Hâlâ fişin var.');
      const no = this.payCheck(p, seat.source, PR.BUY_IN);
      if (no) return no;
      this.take(p, seat.source, PR.BUY_IN, 'Kart Kulübü · poker fişi');
      seat.chips += PR.BUY_IN;
      if (t.phase === 'idle' && !t.endsAt) t.endsAt = now + PR.START_MS;
      this.changed('poker');
      return { ok: true };
    }
    if (act !== 'fold' && act !== 'check' && act !== 'call' && act !== 'raise') return err('Bu masada geçersiz işlem.');
    if (!STREETS.includes(t.phase) || t.toAct !== i) return err('Sıra sende değil.');
    const res = this.pokerApply(i, act);
    if (!res.ok) return res;
    this.pokerAdvance(now);
    this.changed('poker');
    return { ok: true };
  }

  /** Koltuğa fiş koy (fişi yetmezse all-in) */
  put(s, amount) {
    const x = Math.min(amount, s.chips);
    s.chips -= x;
    s.streetBet += x;
    s.committed += x;
    if (s.chips === 0) s.allIn = true;
    return x;
  }

  /** Hamleyi uygula (sıra kontrolü çağıranda) */
  pokerApply(i, act) {
    const t = this.poker;
    const s = t.seats[i];
    const toCall = t.currentBet - s.streetBet;
    if (act === 'fold') {
      s.folded = true;
      s.lastAction = ACTION_LABEL.fold;
    } else if (act === 'check') {
      if (toCall > 0) return err(`Pas geçemezsin — €${toCall} görmen gerek.`);
      s.lastAction = ACTION_LABEL.check;
    } else if (act === 'call') {
      this.put(s, toCall);
      s.lastAction = s.allIn ? ACTION_LABEL.allin : toCall > 0 ? ACTION_LABEL.call : ACTION_LABEL.check;
    } else {
      if (t.currentBet > 0 && t.raises >= PR.MAX_RAISES) return err('Artırma sınırı doldu — gör ya da çekil.');
      if (s.chips <= toCall) return err('Artıracak fişin yok — gör ya da çekil.');
      const size = t.street < 2 ? PR.SMALL_BET : PR.BIG_BET;
      const target = t.currentBet + size;
      const opening = t.currentBet === 0;
      this.put(s, target - s.streetBet);
      // Tam artırma sayılır; eksik all-in artırması sınırı doldurmaz ama diğerleri yine görmeli
      if (!opening && s.streetBet >= target) t.raises++;
      t.currentBet = Math.max(t.currentBet, s.streetBet);
      s.lastAction = s.allIn ? ACTION_LABEL.allin : opening ? ACTION_LABEL.bet : ACTION_LABEL.raise;
      t.needs = new Set();
      for (let k = 0; k < R.SEATS; k++) if (k !== i && this.canAct(k)) t.needs.add(k);
    }
    t.needs.delete(i);
    return { ok: true };
  }

  canAct(i) {
    const s = this.poker.seats[i];
    return !!s && s.inHand && !s.folded && !s.allIn;
  }

  pokerStart(now) {
    const t = this.poker;
    t.endsAt = 0;
    t.winners = [];
    // Fişi bitmiş NPC kalkar; insan fişsizse eli seyreder (Fiş al / Kalk)
    for (let i = 0; i < R.SEATS; i++) {
      const s = t.seats[i];
      if (s?.kind === 'bot' && s.chips < PR.BIG_BLIND) t.seats[i] = null;
    }
    const humans = t.seats.filter((s) => s?.kind === 'human' && s.chips >= PR.BIG_BLIND);
    if (!humans.length) {
      t.phase = 'idle';
      for (const s of t.seats) if (s) Object.assign(s, this.pokerSeatReset());
      return;
    }
    // Boş koltuklara NPC oyuncular (barın müdavimleri)
    const used = new Set(t.seats.filter(Boolean).map((s) => s.name));
    const pool = BAR_CUSTOMER_NAMES.filter((n) => !used.has(n));
    shuffle(pool, this.rng);
    for (let i = 0; i < R.SEATS; i++) {
      if (!t.seats[i]) t.seats[i] = { kind: 'bot', id: null, name: pool.pop() ?? `NPC ${i + 1}`, chips: PR.BOT_CHIPS, source: null };
    }
    t.handNo++;
    t.deck = shuffle(makeDeck(1), this.rng);
    t.board = [];
    t.dead = 0;
    for (const s of t.seats) Object.assign(s, this.pokerSeatReset(), { inHand: s.chips >= PR.BIG_BLIND });
    const live = (i) => t.seats[i].inHand;
    t.button = this.nextSeat(t.button < 0 ? Math.floor(this.rng() * R.SEATS) : t.button, live);
    const n = t.seats.filter((s) => s.inHand).length;
    for (let k = 0; k < 2; k++) {
      for (let j = 1; j <= R.SEATS; j++) {
        const s = t.seats[(t.button + j) % R.SEATS];
        if (s.inHand) s.hole.push(t.deck.pop());
      }
    }
    // Körler (iki kişide düğme küçük kördür)
    const sb = n === 2 ? t.button : this.nextSeat(t.button, live);
    const bb = this.nextSeat(sb, live);
    this.put(t.seats[sb], PR.SMALL_BLIND);
    t.seats[sb].lastAction = ACTION_LABEL.sb;
    this.put(t.seats[bb], PR.BIG_BLIND);
    t.seats[bb].lastAction = ACTION_LABEL.bb;
    t.street = 0;
    t.phase = STREETS[0];
    t.currentBet = Math.max(t.seats[sb].streetBet, t.seats[bb].streetBet);
    t.raises = 0;
    t.needs = new Set();
    for (let i = 0; i < R.SEATS; i++) if (this.canAct(i)) t.needs.add(i);
    // Kendi kartların yalnızca sana
    for (const s of t.seats) {
      if (s.kind === 'human' && s.inHand) this.sim.toPlayer(s.id, EVT.CASINO_PRIVATE, { table: 'poker', handNo: t.handNo, cards: [...s.hole] });
    }
    t.toAct = bb;
    this.pokerAdvance(now);
  }

  /** Hamleden sonra: el bitti mi, sokak bitti mi, sıra kimde */
  pokerAdvance(now) {
    const t = this.poker;
    const alive = [];
    for (let i = 0; i < R.SEATS; i++) if (this.inHand(i)) alive.push(i);
    if (alive.length <= 1) {
      this.pokerAward(now, alive);
      return;
    }
    if (t.needs.size === 0) {
      // Sokak bitti: bahisler pota, sıradaki kartlar
      for (const s of t.seats) if (s) s.streetBet = 0;
      t.currentBet = 0;
      t.raises = 0;
      const active = alive.filter((i) => !t.seats[i].allIn);
      if (t.street >= 3 || active.length <= 1) {
        // Kalan kartlar açılır (all-in'de bahis turu kalmaz) → showdown
        while (t.board.length < 5) t.board.push(t.deck.pop());
        this.pokerShowdown(now, alive);
        return;
      }
      t.street++;
      t.phase = STREETS[t.street];
      const deal = t.street === 1 ? 3 : 1;
      for (let k = 0; k < deal; k++) t.board.push(t.deck.pop());
      for (const s of t.seats) if (s && s.inHand && !s.folded && !s.allIn) s.lastAction = null;
      t.needs = new Set(active);
      t.toAct = t.button;
    }
    t.toAct = this.nextSeat(t.toAct, (i) => t.needs.has(i));
    const s = t.seats[t.toAct];
    if (s.kind === 'human') {
      t.turnEndsAt = now + R.TURN_MS;
      t.botActAt = 0;
    } else {
      t.turnEndsAt = 0;
      t.botActAt = now + PR.BOT_MIN_MS + this.rng() * (PR.BOT_MAX_MS - PR.BOT_MIN_MS);
    }
  }

  potTotal() {
    const t = this.poker;
    return t.dead + t.seats.reduce((sum, s) => sum + (s?.committed || 0), 0);
  }

  /** Herkes çekildi: kalan oyuncu (kart göstermeden) potu alır */
  pokerAward(now, alive) {
    const t = this.poker;
    const total = this.potTotal();
    const w = alive[0];
    if (w !== undefined) {
      t.seats[w].chips += total;
      t.seats[w].won = total;
      t.winners = [{ seat: w, name: t.seats[w].name, amount: total, handName: null }];
    }
    this.pokerEnd(now);
  }

  /** Showdown: yan potlar katkı seviyelerine göre; her potu en iyi el(ler) alır */
  pokerShowdown(now, alive) {
    const t = this.poker;
    const evals = new Map();
    for (const i of alive) {
      const s = t.seats[i];
      const e = evalHand([...s.hole, ...t.board]);
      evals.set(i, e);
      s.handName = e.name;
      s.show = true;
    }
    const contrib = [];
    for (let i = 0; i < R.SEATS; i++) if (t.seats[i]?.committed > 0) contrib.push(i);
    const levels = [...new Set(alive.map((i) => t.seats[i].committed))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const i of contrib) amount += Math.max(0, Math.min(t.seats[i].committed, level) - prev);
      const eligible = alive.filter((i) => t.seats[i].committed >= level);
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }
    // Kalkanların fişleri ve (olası) seviye üstü artık ana pota
    const counted = pots.reduce((sum, x) => sum + x.amount, 0);
    const rest = this.potTotal() - counted;
    if (rest > 0) {
      if (pots.length) pots[0].amount += rest;
      else pots.push({ amount: rest, eligible: alive });
    }
    const won = new Map();
    for (const pot of pots) {
      let best = -1;
      for (const i of pot.eligible) best = Math.max(best, evals.get(i).score);
      const winners = pot.eligible.filter((i) => evals.get(i).score === best);
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      // Artık fiş düğmenin solundan başlayarak dağıtılır
      winners.sort((a, b) => ((a - t.button - 1 + R.SEATS) % R.SEATS) - ((b - t.button - 1 + R.SEATS) % R.SEATS));
      for (const i of winners) {
        const x = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        won.set(i, (won.get(i) || 0) + x);
      }
    }
    t.winners = [];
    for (const [i, amount] of won) {
      const s = t.seats[i];
      s.chips += amount;
      s.won = amount;
      t.winners.push({ seat: i, name: s.name, amount, handName: s.handName });
    }
    this.pokerEnd(now);
  }

  pokerEnd(now) {
    const t = this.poker;
    Object.assign(t, { phase: 'result', endsAt: now + R.RESULT_MS, toAct: -1, turnEndsAt: 0, botActAt: 0, needs: new Set(), dead: 0 });
    for (const s of t.seats) {
      if (!s) continue;
      s.committed = 0; // pot dağıtıldı
      s.streetBet = 0;
      if (s?.kind === 'human' && s.chips < PR.BIG_BLIND) {
        this.sim.toPlayer(s.id, EVT.NOTIFY, { text: '♠ Fişin bitti — yeni fiş al ya da masadan kalk.', kind: 'info' });
      }
    }
  }

  /**
   * Koltuğu boşalt (oyuncu kalktı ya da NPC yerini verdi). Eldeyse çekilmiş sayılır; koyduğu fişler
   * potta kalır (dead). Sıra ondaysa el ilerler.
   */
  pokerRemoveSeat(i, now) {
    const t = this.poker;
    const s = t.seats[i];
    if (!s) return;
    const live = STREETS.includes(t.phase);
    if (live && s.inHand) {
      t.dead += s.committed;
      s.committed = 0;
      s.folded = true;
      t.needs.delete(i);
    }
    t.seats[i] = null;
    if (!live) return;
    const alive = [];
    for (let k = 0; k < R.SEATS; k++) if (this.inHand(k)) alive.push(k);
    if (alive.length <= 1) this.pokerAward(now, alive);
    else if (t.toAct === i) this.pokerAdvance(now);
  }

  /** Basit NPC: el gücü + rastgelelik; artırma sınırına ve pot oranına bakar */
  botDecide(i) {
    const t = this.poker;
    const s = t.seats[i];
    const strength = handStrength(s.hole, t.board) + (this.rng() - 0.5) * 0.3;
    const toCall = t.currentBet - s.streetBet;
    const canRaise = s.chips > toCall && (t.currentBet === 0 || t.raises < PR.MAX_RAISES);
    if (toCall === 0) {
      if (canRaise && (strength > 0.62 || this.rng() < 0.08)) return 'raise';
      return 'check';
    }
    if (canRaise && strength > 0.8) return 'raise';
    const need = 0.3 + 0.07 * t.raises + (t.street >= 2 ? 0.05 : 0);
    if (strength > need) return 'call';
    // Ucuz görme: pota göre küçük bahsi bazen görür
    if (toCall * 4 <= this.potTotal() && strength > 0.18 && this.rng() < 0.5) return 'call';
    return 'fold';
  }

  pokerUpdate(now) {
    const t = this.poker;
    if (t.phase === 'idle') {
      if (t.endsAt && now >= t.endsAt) this.pokerStart(now);
      else return;
    } else if (t.phase === 'result') {
      if (now < t.endsAt) return;
      this.pokerStart(now);
    } else {
      const s = t.seats[t.toAct];
      if (s.kind === 'bot') {
        if (now < t.botActAt) return;
        const res = this.pokerApply(t.toAct, this.botDecide(t.toAct));
        if (!res.ok) this.pokerApply(t.toAct, t.currentBet > s.streetBet ? 'call' : 'check');
      } else {
        if (now < t.turnEndsAt) return;
        // Süre doldu: pas mümkünse pas, değilse çekil
        this.pokerApply(t.toAct, t.currentBet > s.streetBet ? 'fold' : 'check');
      }
      this.pokerAdvance(now);
    }
    this.changed('poker');
  }

  pokerPublic() {
    const t = this.poker;
    const live = STREETS.includes(t.phase);
    return {
      table: 'poker',
      phase: t.phase,
      handNo: t.handNo,
      board: [...t.board],
      // Sonuçta pot dağıtılmıştır: dağıtılan toplam gösterilir
      pot: t.phase === 'result' ? t.winners.reduce((sum, w) => sum + w.amount, 0) : this.potTotal(),
      currentBet: t.currentBet,
      raises: t.raises,
      maxRaises: PR.MAX_RAISES,
      betSize: t.street >= 2 ? PR.BIG_BET : PR.SMALL_BET,
      button: t.button,
      toAct: live ? t.toAct : -1,
      turnEndsAt: t.turnEndsAt,
      endsAt: t.endsAt,
      buyIn: PR.BUY_IN,
      blinds: [PR.SMALL_BLIND, PR.BIG_BLIND],
      winners: t.winners.map((w) => ({ ...w })),
      seats: t.seats.map((s) => s && {
        kind: s.kind,
        id: s.id,
        name: s.name,
        chips: s.chips,
        source: s.source,
        streetBet: s.streetBet || 0,
        committed: s.committed || 0,
        inHand: !!s.inHand,
        folded: !!s.folded,
        allIn: !!s.allIn,
        lastAction: s.lastAction ?? null,
        won: s.won || 0,
        handName: s.show ? s.handName : null,
        // Kapalı kartlar yalnızca showdown'da (çekilmeyenlerin) açılır
        cards: t.phase === 'result' && s.show ? [...s.hole] : null,
        cardCount: s.inHand && !s.folded ? s.hole?.length ?? 0 : 0,
      }),
    };
  }
}

function bjSeatReset() {
  return { bet: 0, source: 'wallet', kasa: 0, cards: [], status: 'idle', doubled: false, result: null, payout: 0 };
}

function diceSeatReset() {
  return { stake: 0, source: 'wallet', rolls: [], total: 0 };
}
