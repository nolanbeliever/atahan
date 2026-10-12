import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { CASINO, isInsideCasino } from '../shared/layout.js';
import {
  card, evalHand, bjValue, isBlackjack, dealerShouldHit, bjSettle, HAND_CAT, CASINO_TABLES,
  CASINO_RULES, BJ_RULES, POKER_RULES, DICE_RULES, STREETS,
} from '../shared/casino.js';

const config = {
  dayLengthSec: 100_000, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 500,
};

function seeded(seed = 11) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = (s) => s.split(' ').map(card);

/** Sahte saatle kurulum: oyuncu Kart Kulübü'nde, istenen masanın yanında */
function setup({ seed = 11, money = 1000 } = {}) {
  let now = 4_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 11 }, rng: seeded(seed), now: () => now });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  sim.bar.nextSpawnAt = Infinity;
  sim.money = money;
  const out = [];
  const to = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  const casino = sim.casino;
  const add = (name, table = 'bj', seat = 0) => {
    const p = sim.addPlayer(name);
    sim.bar.nextSpawnAt = Infinity;
    goTo(p, table, seat);
    return p;
  };
  const goTo = (p, table, seat = 0) => {
    const s = CASINO_TABLES[table].seats[seat];
    sim.movePlayer(p.id, s.x, s.z, s.yaw);
  };
  const act = (p, data) => sim.casinoAct(p.id, data);
  const ok = (p, data) => {
    const r = act(p, data);
    assert.equal(r.ok, true, `${data.act}: ${r.error}`);
    return r;
  };
  const tick = (ms) => { now += ms; sim.tick(now); };
  const states = (table) => out.filter((e) => e.event === EVT.CASINO_STATE && e.payload.table === table).map((e) => e.payload);
  return { sim, casino, out, to, add, goTo, act, ok, tick, states, now: () => now };
}

// ---- El değerlendirici ----------------------------------------------------------------

test('poker: el değerlendirici tüm kategorileri tanır', () => {
  const cases = [
    ['2♠ 7♥ 9♦ J♣ K♠', HAND_CAT.HIGH, 'Yüksek kart'],
    ['2♠ 2♥ 9♦ J♣ K♠', HAND_CAT.PAIR, 'Per'],
    ['2♠ 2♥ 9♦ 9♣ K♠', HAND_CAT.TWO_PAIR, 'Döper'],
    ['7♠ 7♥ 7♦ J♣ K♠', HAND_CAT.TRIPS, 'Üçlü'],
    ['5♠ 6♥ 7♦ 8♣ 9♠', HAND_CAT.STRAIGHT, 'Kent'],
    ['A♠ 2♥ 3♦ 4♣ 5♠', HAND_CAT.STRAIGHT, 'Kent'],
    ['2♥ 7♥ 9♥ J♥ K♥', HAND_CAT.FLUSH, 'Renk'],
    ['7♠ 7♥ 7♦ K♣ K♠', HAND_CAT.FULL_HOUSE, 'Ful'],
    ['7♠ 7♥ 7♦ 7♣ K♠', HAND_CAT.QUADS, 'Kare'],
    ['5♦ 6♦ 7♦ 8♦ 9♦', HAND_CAT.STRAIGHT_FLUSH, 'Floş'],
    ['10♣ J♣ Q♣ K♣ A♣', HAND_CAT.STRAIGHT_FLUSH, 'Royal floş'],
  ];
  let prev = -1;
  for (const [hand, cat, name] of cases) {
    const e = evalHand(C(hand));
    assert.equal(e.cat, cat, hand);
    assert.equal(e.name, name, hand);
    if (hand !== 'A♠ 2♥ 3♦ 4♣ 5♠' && hand !== '5♠ 6♥ 7♦ 8♣ 9♠') assert.ok(e.score > prev || cat === prev, hand);
    prev = Math.max(prev, e.score);
  }
  // Kategori sıralaması
  const order = cases.map(([h]) => evalHand(C(h)).cat);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('poker: kickerlar, as-küçük kent ve 7 karttan en iyi el', () => {
  const s = (h) => evalHand(C(h)).score;
  // Aynı per, kicker kazanır
  assert.ok(s('K♠ K♥ A♦ 7♣ 3♠') > s('K♦ K♣ Q♦ 7♥ 3♥'));
  assert.ok(s('K♠ K♥ A♦ 7♣ 4♠') > s('K♦ K♣ A♣ 7♥ 3♥'));
  // Döper: büyük per, sonra küçük per, sonra kicker
  assert.ok(s('Q♠ Q♥ 3♦ 3♣ 2♠') > s('J♠ J♥ 10♦ 10♣ A♠'));
  assert.ok(s('Q♠ Q♥ 4♦ 4♣ 2♠') > s('Q♦ Q♣ 3♦ 3♥ A♠'));
  assert.ok(s('Q♠ Q♥ 4♦ 4♣ 5♠') > s('Q♦ Q♣ 4♥ 4♠ 3♠'));
  // Ful: önce üçlü
  assert.ok(s('3♠ 3♥ 3♦ 2♣ 2♠') > s('2♦ 2♥ 2♣ A♣ A♠'));
  // A-2-3-4-5 en küçük kent; 6 yüksek kent ondan büyük
  assert.ok(s('2♠ 3♥ 4♦ 5♣ 6♠') > s('A♠ 2♥ 3♦ 4♣ 5♠'));
  assert.ok(s('10♠ J♥ Q♦ K♣ A♠') > s('9♠ 10♥ J♦ Q♣ K♠'));
  // Renk: en yüksek karttan karşılaştırılır
  assert.ok(s('A♥ 9♥ 7♥ 4♥ 2♥') > s('K♥ Q♥ J♥ 9♥ 7♥'));
  // Eşit eller → aynı puan (pot bölünür)
  assert.equal(s('A♠ K♥ 9♦ 7♣ 3♠'), s('A♥ K♦ 9♣ 7♠ 3♥'));
  // 7 kart: masadaki kent herkesin; ama renk daha iyi
  const e = evalHand(C('2♥ 9♥ 5♥ 6♣ 7♦ 8♠ K♥'));
  assert.equal(e.cat, HAND_CAT.STRAIGHT);
  const f = evalHand(C('2♥ 9♥ 5♥ 6♥ 7♦ 8♠ K♥'));
  assert.equal(f.cat, HAND_CAT.FLUSH);
  assert.equal(f.best.length, 5);
  // 7 karttan iki çift + daha iyi kicker
  assert.equal(evalHand(C('A♠ A♥ K♦ K♣ Q♠ Q♥ J♦')).score, evalHand(C('A♠ A♥ K♦ K♣ Q♠')).score);
});

// ---- Blackjack kuralları ---------------------------------------------------------------

test('blackjack: yumuşak as, blackjack, patlama ve krupiye kuralı', () => {
  assert.deepEqual(bjValue(C('A♠ 6♥')), { total: 17, soft: true });
  assert.deepEqual(bjValue(C('A♠ 6♥ 10♦')), { total: 17, soft: false });
  assert.deepEqual(bjValue(C('A♠ A♥ 9♦')), { total: 21, soft: true });
  assert.deepEqual(bjValue(C('A♠ A♥ A♦ A♣')), { total: 14, soft: true });
  assert.equal(bjValue(C('K♠ Q♥ 2♦')).total, 22);
  assert.equal(isBlackjack(C('A♠ K♥')), true);
  assert.equal(isBlackjack(C('A♠ 5♥ 5♦')), false); // üç kartla 21 blackjack değildir
  assert.equal(dealerShouldHit(C('10♠ 6♥')), true);
  assert.equal(dealerShouldHit(C('A♠ 6♥')), false); // yumuşak 17'de durur
  assert.equal(dealerShouldHit(C('10♠ 7♥')), false);
});

test('blackjack: ödemeler (3:2, 1:1, push, kayıp)', () => {
  assert.deepEqual(bjSettle(C('A♠ K♥'), C('10♠ 9♥'), 10), { result: 'blackjack', payout: 25 });
  assert.deepEqual(bjSettle(C('A♠ K♥'), C('10♠ 9♥'), 5), { result: 'blackjack', payout: 12 }); // 7.5 → 7
  assert.deepEqual(bjSettle(C('A♠ K♥'), C('A♦ Q♥'), 10), { result: 'push', payout: 10 });
  assert.deepEqual(bjSettle(C('10♠ K♥'), C('A♦ Q♥'), 10), { result: 'lose', payout: 0 });
  assert.deepEqual(bjSettle(C('10♠ 9♥'), C('10♦ 8♥'), 10), { result: 'win', payout: 20 });
  assert.deepEqual(bjSettle(C('10♠ 8♥'), C('10♦ 8♥'), 10), { result: 'push', payout: 10 });
  assert.deepEqual(bjSettle(C('10♠ 7♥'), C('10♦ 8♥'), 10), { result: 'lose', payout: 0 });
  assert.deepEqual(bjSettle(C('10♠ 2♥ 5♦'), C('10♦ 6♥ 9♣'), 10), { result: 'win', payout: 20 }); // krupiye patladı
  assert.deepEqual(bjSettle(C('10♠ 6♥ 9♦'), C('10♦ 6♥ 9♣'), 10), { result: 'lose', payout: 0 }); // önce oyuncu patlar
});

// ---- Blackjack masası (servis) ------------------------------------------------------------

/** Ayakkabıyı sırayla çekilecek kartlarla doldur (draw sondan alır) */
const stack = (casino, cards) => { casino.shoe = [...Array(80).fill(0), ...C(cards).reverse()]; };

test('blackjack: tam el — kart çek, dur, krupiye 17, cüzdan hesabı', () => {
  const { casino, add, ok, act, states } = setup();
  const p = add('Ayşe', 'bj', 0);
  ok(p, { act: 'sit', table: 'bj', seat: 0 });
  // Dağıtım sırası: oyuncu, krupiye, oyuncu, krupiye; sonra çekilenler
  stack(casino, '10♠ 6♦ 2♥ 10♣ 7♣ 5♥');
  ok(p, { act: 'bet', table: 'bj', amount: 10 }); // tek oyuncu: beklemeden dağıtılır
  assert.equal(p.wallet, 490);
  let st = states('bj').pop();
  assert.equal(st.phase, 'playing');
  assert.equal(st.dealer[1], -1, 'krupiyenin ikinci kartı kapalı');
  assert.equal(st.dealerTotal, 6);
  assert.deepEqual(st.seats[0].cards, C('10♠ 2♥'));
  ok(p, { act: 'hit', table: 'bj' }); // 10+2+7 = 19
  assert.equal(states('bj').pop().seats[0].total, 19);
  ok(p, { act: 'stand', table: 'bj' });
  st = states('bj').pop();
  assert.equal(st.phase, 'result');
  // Krupiye 16 → çeker (5) → 21
  assert.deepEqual(st.dealer, C('6♦ 10♣ 5♥'));
  assert.equal(st.seats[0].result, 'lose');
  assert.equal(p.wallet, 490);
  assert.equal(act(p, { act: 'hit', table: 'bj' }).ok, false);
});

test('blackjack: kazanç, ikiye katlama, blackjack 3:2 ve sonuçtan sonra yeni tur', () => {
  const { casino, add, ok, tick, states } = setup();
  const p = add('Ayşe', 'bj', 1);
  ok(p, { act: 'sit', table: 'bj', seat: 1 });
  stack(casino, '6♠ 10♦ 5♥ 7♣ 10♥');
  ok(p, { act: 'bet', table: 'bj', amount: 10 });
  ok(p, { act: 'double', table: 'bj' }); // 6+5+10 = 21, krupiye 17'de durur
  assert.equal(p.wallet, 500 - 20 + 40);
  let st = states('bj').pop();
  assert.equal(st.seats[1].result, 'win');
  assert.equal(st.seats[1].payout, 40);
  // Sonuç ekranı biter → yeni tur
  tick(CASINO_RULES.RESULT_MS + 10);
  st = states('bj').pop();
  assert.equal(st.phase, 'idle');
  assert.equal(st.seats[1].bet, 0);
  stack(casino, 'A♠ 9♦ K♥ 7♣');
  ok(p, { act: 'bet', table: 'bj', amount: 20 });
  st = states('bj').pop();
  assert.equal(st.phase, 'result');
  assert.equal(st.seats[1].result, 'blackjack');
  assert.equal(p.wallet, 520 - 20 + 50);
});

test('blackjack: krupiye blackjack\'i eli hemen bitirir; süre dolunca otomatik dur', () => {
  const { casino, add, ok, tick, states } = setup();
  const p = add('Ayşe');
  ok(p, { act: 'sit', table: 'bj', seat: 0 });
  stack(casino, '10♠ A♦ 9♥ K♣');
  ok(p, { act: 'bet', table: 'bj', amount: 10 });
  let st = states('bj').pop();
  assert.equal(st.phase, 'result');
  assert.equal(st.seats[0].result, 'lose');
  assert.equal(p.wallet, 490);
  tick(CASINO_RULES.RESULT_MS + 10);
  stack(casino, '10♠ 7♦ 6♥ 10♣');
  ok(p, { act: 'bet', table: 'bj', amount: 10 });
  assert.equal(states('bj').pop().phase, 'playing');
  tick(CASINO_RULES.TURN_MS + 10); // 16'da süre doldu → durdu; krupiye 17
  st = states('bj').pop();
  assert.equal(st.phase, 'result');
  assert.equal(st.seats[0].status, 'done');
  assert.equal(st.seats[0].result, 'lose');
});

test('blackjack: iki oyuncu — bahis penceresi, sıra, ortada kalkan', () => {
  const { casino, sim, add, ok, act, tick, states } = setup();
  const a = add('Ayşe', 'bj', 0);
  const b = add('Burak', 'bj', 3);
  ok(a, { act: 'sit', table: 'bj', seat: 0 });
  ok(b, { act: 'sit', table: 'bj', seat: 3 });
  ok(a, { act: 'bet', table: 'bj', amount: 10 });
  assert.equal(states('bj').pop().phase, 'betting');
  // Bahis penceresinde kalkan bahsini geri alır
  ok(a, { act: 'leave', table: 'bj' });
  assert.equal(a.wallet, 500);
  assert.equal(states('bj').pop().phase, 'idle');
  ok(a, { act: 'sit', table: 'bj', seat: 0 });
  ok(a, { act: 'bet', table: 'bj', amount: 10 });
  tick(BJ_RULES.BET_WINDOW_MS + 10); // Burak bahis koymadı: süre dolunca yalnızca Ayşe oynar
  let st = states('bj').pop();
  assert.ok(st.phase === 'playing' || st.phase === 'result');
  if (st.phase === 'playing') {
    assert.equal(st.turn, 0);
    assert.equal(act(b, { act: 'hit', table: 'bj' }).ok, false, 'sıra Burak\'ta değil');
    // Dağıtımdan sonra kalkan bahsini kaybeder (kumarhane kuralı), el kapanır
    ok(a, { act: 'leave', table: 'bj' });
    assert.equal(a.wallet, 490);
    st = states('bj').pop();
    assert.equal(st.phase, 'result');
    assert.equal(st.seats[0], null);
  }
  // Burak hâlâ oturuyor: masa sıfırlanmadı
  assert.equal(casino.seated.get(b.id).table, 'bj');
  sim.removePlayer(b.id);
  assert.equal(casino.seated.size, 0);
  assert.equal(casino.bj.phase, 'idle');
});

// ---- Kasa (otel kasası) kuralları --------------------------------------------------------

test('kasa: €500 altı reddedilir, tur başına €50 sınırı, kazanç kasaya döner, ekonomi yayını', () => {
  const { sim, casino, out, add, ok, act, states } = setup({ money: 400 });
  const p = add('Ayşe');
  ok(p, { act: 'sit', table: 'bj', seat: 0 });
  let r = act(p, { act: 'bet', table: 'bj', amount: 10, source: 'kasa' });
  assert.equal(r.ok, false);
  assert.match(r.error, /500/);
  sim.money = 1000;
  r = act(p, { act: 'bet', table: 'bj', amount: 60, source: 'kasa' });
  assert.equal(r.ok, false);
  assert.match(r.error, /50/);
  stack(casino, '6♠ 10♦ 5♥ 7♣ 10♥');
  const before = out.length;
  ok(p, { act: 'bet', table: 'bj', amount: 30, source: 'kasa' });
  assert.equal(sim.money, 970);
  assert.equal(p.wallet, 500, 'cüzdan değişmez');
  const eco = out.slice(before).filter((e) => e.event === EVT.ECONOMY).map((e) => e.payload);
  assert.equal(eco[0].money, 970);
  assert.equal(eco[0].delta, -30);
  // İkiye katlamak kasadan 60 eder → sınır aşılır
  r = act(p, { act: 'double', table: 'bj' });
  assert.equal(r.ok, false);
  assert.match(r.error, /50/);
  ok(p, { act: 'hit', table: 'bj' }); // 21
  assert.equal(states('bj').pop().seats[0].result, 'win');
  assert.equal(sim.money, 1030, 'kazanç kasaya döner');
  assert.equal(p.wallet, 500);
});

// ---- Zar düellosu ------------------------------------------------------------------------

/** Sıralı rng: verilen değerleri sırayla döndürür, bitince 0.5 */
const scripted = (vals) => () => (vals.length ? vals.shift() : 0.5);

test('zar: en yüksek toplam potu alır; beraberlikte yalnızca berabere kalanlar yeniden atar', () => {
  const { sim, add, ok, states } = setup();
  const p = add('Ayşe', 'dice', 0);
  ok(p, { act: 'sit', table: 'dice', seat: 0 });
  const shuffle11 = Array(11).fill(0);
  // 1 NPC (0.9 ≥ 0.5), isim karıştırma, NPC payı €2; Ayşe 6+6, NPC 1+1
  sim.rng = scripted([0.9, ...shuffle11, 0, 0.99, 0.99, 0, 0]);
  ok(p, { act: 'stake', table: 'dice', amount: 5 });
  let st = states('dice').pop();
  assert.equal(st.phase, 'result');
  assert.equal(st.pot, 7);
  assert.equal(st.winner.npc, false);
  assert.equal(st.winner.amount, 7);
  assert.deepEqual(st.seats[0].rolls, [[6, 6]]);
  assert.equal(p.wallet, 500 - 5 + 7);

  // Beraberlik: 6+1 = 1+6 → yeniden atış 4+4 / 1+1
  const p2 = add('Burak', 'dice', 1);
  ok(p2, { act: 'sit', table: 'dice', seat: 1 });
  sim.casino.diceUpdate(Infinity); // sonuç ekranını bitir
  sim.rng = scripted([0.9, ...shuffle11, 0, 0.99, 0, 0, 0, 0, 0.99, 0.5, 0.5, 0, 0]);
  ok(p, { act: 'stake', table: 'dice', amount: 4 });
  ok(p2, { act: 'stake', table: 'dice', amount: 4 });
  st = states('dice').pop();
  assert.equal(st.phase, 'result');
  // Ayşe 6+1=7, Burak 1+1=2, NPC 1+6=7 → Ayşe ve NPC yeniden atar
  assert.deepEqual(st.seats[0].rolls, [[6, 1], [4, 4]]);
  assert.deepEqual(st.seats[1].rolls, [[1, 1]]);
  assert.deepEqual(st.npcs[0].rolls, [[1, 6], [1, 1]]);
  assert.equal(st.winner.name, 'Ayşe');
  assert.equal(st.pot, 10);
  assert.equal(p.wallet, 502 - 4 + 10);
  assert.equal(p2.wallet, 496);
});

test('zar: NPC kazanırsa pot kasaya da cüzdana da dönmez; bahis penceresinde kalkana iade', () => {
  const { sim, add, ok, tick, states } = setup();
  const p = add('Ayşe', 'dice', 2);
  const q = add('Can', 'dice', 3);
  ok(p, { act: 'sit', table: 'dice', seat: 2 });
  ok(q, { act: 'sit', table: 'dice', seat: 3 });
  ok(p, { act: 'stake', table: 'dice', amount: 10, source: 'kasa' });
  assert.equal(sim.money, 990);
  ok(p, { act: 'leave', table: 'dice' });
  assert.equal(sim.money, 1000, 'iade kasaya');
  ok(p, { act: 'sit', table: 'dice', seat: 2 });
  sim.rng = scripted([0.2, ...Array(11).fill(0), 0, 0, 0, 0, 0, 0.99, 0.99]);
  ok(p, { act: 'stake', table: 'dice', amount: 10, source: 'kasa' });
  tick(DICE_RULES.BET_WINDOW_MS + 10); // Can katılmadı → süre dolunca atılır
  const st = states('dice').pop();
  assert.equal(st.phase, 'result');
  assert.equal(st.npcs.length, 2);
  assert.equal(st.winner.npc, true);
  assert.equal(sim.money, 990);
});

// ---- Poker -------------------------------------------------------------------------------

/** Masadaki toplam fiş (koltuklar + pot) — el boyunca korunmalı */
const chipTotal = (casino) => casino.poker.seats.reduce((s, x) => s + (x?.chips || 0), 0) + casino.potTotal();

function playHand(ctx, humans, decide = () => 'call') {
  const { casino, ok, tick } = ctx;
  const t = casino.poker;
  for (let guard = 0; guard < 400 && t.phase !== 'result'; guard++) {
    if (STREETS.includes(t.phase)) {
      const s = t.seats[t.toAct];
      const h = s.kind === 'human' ? humans.find((x) => x.id === s.id) : null;
      if (h) {
        let a = decide(t, s);
        if (a === 'call' && t.currentBet === s.streetBet) a = 'check';
        ok(h, { act: a, table: 'poker' });
        continue;
      }
    }
    tick(POKER_RULES.BOT_MAX_MS + 1);
  }
  assert.equal(t.phase, 'result', 'el showdown/sonuçla bitmeli');
}

test('poker: NPC\'lerle tam el showdown\'a kadar; kartlar gizli, fişler korunur', () => {
  const ctx = setup({ seed: 5 });
  const { casino, add, ok, tick, out, to, states } = ctx;
  const p = add('Ayşe', 'poker', 0);
  ok(p, { act: 'sit', table: 'poker', seat: 0 });
  assert.equal(p.wallet, 500 - POKER_RULES.BUY_IN);
  tick(POKER_RULES.START_MS + 1);
  const t = casino.poker;
  assert.equal(t.phase, 'preflop');
  assert.equal(t.seats.filter((s) => s?.kind === 'bot').length, 3, 'boş koltuklara NPC oturur');
  assert.equal(chipTotal(casino), 80);
  // Kendi kartları yalnızca kendisine
  const priv = to.filter((e) => e.event === EVT.CASINO_PRIVATE);
  assert.equal(priv.length, 1);
  assert.equal(priv[0].id, p.id);
  assert.equal(priv[0].payload.cards.length, 2);
  let maxBoard = 0;
  playHand(ctx, [p], (tt) => { maxBoard = Math.max(maxBoard, tt.board.length); return 'call'; });
  assert.equal(chipTotal(casino), 80, 'fişler korunur');
  // Yayınlarda el sürerken kimsenin kartı yok
  for (const st of states('poker')) {
    if (st.phase === 'result') continue;
    for (const s of st.seats) if (s) assert.equal(s.cards, null);
  }
  const end = states('poker').pop();
  assert.ok(end.winners.length >= 1);
  const won = end.winners.reduce((s, w) => s + w.amount, 0);
  assert.ok(won > 0);
  // Showdown'a kalan herkesin kartı ve el adı açılır
  const shown = end.seats.filter((s) => s?.cards);
  if (end.board.length === 5 && shown.length > 1) for (const s of shown) assert.ok(s.handName);
  // Sonuçtan sonra yeni el başlar
  tick(CASINO_RULES.RESULT_MS + 1);
  assert.ok(STREETS.includes(casino.poker.phase) || casino.poker.phase === 'idle');
  assert.ok(out.some((e) => e.event === EVT.CASINO_STATE));
});

test('poker: her zaman çekilen insan; süre dolunca otomatik pas/çekil', () => {
  const ctx = setup({ seed: 9 });
  const { casino, add, ok, tick } = ctx;
  const p = add('Ayşe', 'poker', 2);
  ok(p, { act: 'sit', table: 'poker', seat: 2 });
  tick(POKER_RULES.START_MS + 1);
  const t = casino.poker;
  // İnsanın sırası gelene kadar NPC'ler oynar
  for (let g = 0; g < 50 && t.phase !== 'result' && t.seats[t.toAct]?.id !== p.id; g++) tick(POKER_RULES.BOT_MAX_MS + 1);
  if (t.phase !== 'result') {
    const s = t.seats[2];
    const facing = t.currentBet > s.streetBet;
    tick(CASINO_RULES.TURN_MS + 1);
    if (facing) assert.equal(s.folded, true, 'süre doldu → çekildi');
    else assert.equal(s.lastAction, 'Pas');
  }
  assert.equal(chipTotal(casino), 80);
});

test('poker: yan pot ve bölünen pot doğru dağıtılır', () => {
  const { casino, add, ok } = setup();
  const p = add('Ayşe', 'poker', 0);
  ok(p, { act: 'sit', table: 'poker', seat: 0 });
  const t = casino.poker;
  const mk = (name, hole, committed, chips = 0) => ({
    kind: 'bot', id: null, name, chips, source: null, ...casino.pokerSeatReset(), inHand: true, hole: C(hole), committed, allIn: chips === 0,
  });
  // A (all-in 5) en iyi el; B ikinci; C üçüncü. Ana pot 15 → A, yan pot 10 → B
  t.seats = [mk('A', 'A♠ A♥', 5), mk('B', 'K♠ K♥', 10), mk('C', 'Q♠ Q♥', 10, 3), null];
  t.board = C('2♣ 7♦ 9♠ J♥ 3♦');
  t.button = 3;
  t.phase = 'river';
  casino.pokerShowdown(0, [0, 1, 2]);
  assert.equal(t.seats[0].chips, 15);
  assert.equal(t.seats[1].chips, 10);
  assert.equal(t.seats[2].chips, 3);
  // Bölünen pot: masadaki kent herkesin → 21 fiş üçe bölünür
  t.seats = [mk('A', '2♠ 3♥', 7), mk('B', '2♥ 3♠', 7), mk('C', '4♣ 4♦', 7), null];
  t.board = C('5♣ 6♦ 7♠ 8♥ 9♦');
  t.dead = 0;
  casino.pokerShowdown(0, [0, 1, 2]);
  assert.deepEqual(t.seats.slice(0, 3).map((s) => s.chips), [7, 7, 7]);
  // Tek sayılı bölüşüm: artık fiş düğmenin solundaki kazanana
  t.seats = [mk('A', 'A♠ K♥', 3), mk('B', 'A♥ K♠', 2), null, null];
  t.board = C('2♣ 7♦ 9♠ J♥ 3♦');
  t.button = 1;
  casino.pokerShowdown(0, [0, 1]);
  assert.equal(t.seats[0].chips + t.seats[1].chips, 5);
  assert.equal(t.seats[0].chips, 3); // düğme 1 → solundaki koltuk 0
});

test('poker: iki gerçek oyuncu aynı masada; elin ortasında kalkan çekilir ve fişi bozdurulur', () => {
  const ctx = setup({ seed: 21 });
  const { casino, sim, add, ok, act, tick, to } = ctx;
  const a = add('Ayşe', 'poker', 0);
  const b = add('Burak', 'poker', 1);
  ok(a, { act: 'sit', table: 'poker', seat: 0, source: 'wallet' });
  assert.equal(act(b, { act: 'sit', table: 'poker', seat: 0 }).ok, false, 'insan koltuğu dolu');
  ok(b, { act: 'sit', table: 'poker', seat: 1 });
  tick(POKER_RULES.START_MS + 1);
  const t = casino.poker;
  assert.equal(t.seats.filter((s) => s?.kind === 'human').length, 2);
  assert.equal(t.seats.filter((s) => s?.kind === 'bot').length, 2);
  const privIds = to.filter((e) => e.event === EVT.CASINO_PRIVATE).map((e) => e.id).sort();
  assert.deepEqual(privIds, [a.id, b.id].sort());
  // Ayşe'nin sırası gelene kadar oynat (Burak hep görür)
  for (let g = 0; g < 100 && t.phase !== 'result' && t.seats[t.toAct]?.id !== a.id; g++) {
    if (t.seats[t.toAct]?.id === b.id) ok(b, { act: t.currentBet > t.seats[1].streetBet ? 'call' : 'check', table: 'poker' });
    else tick(POKER_RULES.BOT_MAX_MS + 1);
  }
  if (t.phase !== 'result') {
    const committed = t.seats[0].committed;
    const chips = t.seats[0].chips;
    const r = ok(a, { act: 'leave', table: 'poker' });
    assert.equal(r.cashout, chips);
    assert.equal(a.wallet, 500 - POKER_RULES.BUY_IN + chips);
    assert.equal(t.seats[0], null);
    assert.ok(t.dead >= committed);
    assert.equal(chipTotal(casino) + chips, 80, 'pottaki fişleri masada kalır');
    // El Burak ile sürer
    playHand(ctx, [b]);
  }
  // Burak bağlantısını kaybeder → fişleri cüzdanına bozdurulur, masa sıfırlanır
  tick(CASINO_RULES.RESULT_MS + 1);
  const bChips = casino.poker.seats[1]?.chips ?? 0;
  const before = b.wallet;
  sim.removePlayer(b.id);
  assert.equal(b.wallet, before + bChips);
  assert.equal(casino.poker.phase, 'idle');
  assert.equal(casino.poker.seats.every((s) => s === null), true, 'NPC\'ler de kalkar');
  assert.equal(casino.seated.size, 0);
});

test('poker: oturan NPC elin ortasında yerini insana verir; fiş bitince yeniden alınır', () => {
  const ctx = setup({ seed: 3 });
  const { casino, add, ok, act, tick } = ctx;
  const a = add('Ayşe', 'poker', 0);
  ok(a, { act: 'sit', table: 'poker', seat: 0 });
  tick(POKER_RULES.START_MS + 1);
  const t = casino.poker;
  const b = add('Burak', 'poker', 3);
  assert.equal(t.seats[3].kind, 'bot');
  ok(b, { act: 'sit', table: 'poker', seat: 3 });
  assert.equal(t.seats[3].kind, 'human');
  assert.equal(t.seats[3].inHand, false, 'sonraki elde oyuna girer');
  // Fiş yokken yeniden alım; fişi varken reddedilir
  assert.equal(act(b, { act: 'rebuy', table: 'poker' }).ok, false);
  t.seats[3].chips = 0;
  ok(b, { act: 'rebuy', table: 'poker' });
  assert.equal(t.seats[3].chips, POKER_RULES.BUY_IN);
  assert.equal(b.wallet, 500 - 2 * POKER_RULES.BUY_IN);
});

// ---- Geçersiz girdiler ------------------------------------------------------------------

test('geçersiz girdiler: prototip anahtarları, yanlış tipler, oturmadan işlem, yetersiz para, uzaklık', () => {
  const { sim, add, act, ok } = setup();
  const p = add('Ayşe');
  const bad = [
    null, undefined, 5, 'sit', [], {},
    { act: '__proto__' }, { act: 'constructor' }, { act: 'toString' }, { act: { toString: 1 } }, { act: ['sit'] },
    { act: 'sit', table: '__proto__' }, { act: 'sit', table: 'constructor' }, { act: 'sit', table: { toString: 1 } },
    { act: 'sit', table: 'roulette' }, { act: 'sit', table: 'bj', seat: '1' }, { act: 'sit', table: 'bj', seat: 9 },
    { act: 'sit', table: 'bj', seat: -1 }, { act: 'sit', table: 'bj', seat: 1.5 }, { act: 'sit', table: 'bj', seat: { toString: 1 } },
    { act: 'sit', table: 'poker', source: 'bank' }, { act: 'sit', table: 'poker', source: { toString: 1 } },
  ];
  for (const d of bad) {
    const r = sim.casinoAct(p.id, d);
    assert.equal(r.ok, false, JSON.stringify(d));
  }
  // Oturmadan işlem
  for (const a of ['bet', 'hit', 'stand', 'double', 'stake', 'fold', 'check', 'call', 'raise', 'rebuy', 'leave']) {
    assert.equal(act(p, { act: a, table: 'bj', amount: 5 }).ok, false, a);
  }
  ok(p, { act: 'sit', table: 'bj', seat: 2 });
  assert.equal(act(p, { act: 'sit', table: 'dice' }).ok, false, 'iki masada birden oturulmaz');
  assert.equal(act(p, { act: 'bet', table: 'poker', amount: 5 }).ok, false, 'yanlış masa');
  for (const amount of ['10', 10.5, { toString: 1 }, null, NaN, Infinity, -5, 0, 1, 101, 1e9]) {
    assert.equal(act(p, { act: 'bet', table: 'bj', amount }).ok, false, typeof amount);
  }
  for (const source of ['bank', '__proto__', { toString: 1 }, 1, null]) {
    assert.equal(act(p, { act: 'bet', table: 'bj', amount: 5, source }).ok, false, typeof source);
  }
  assert.equal(act(p, { act: 'fold', table: 'bj' }).ok, false, 'blackjack masasında poker işlemi');
  assert.equal(act(p, { act: 'hit', table: 'bj' }).ok, false, 'el yokken kart çekilmez');
  // Yetersiz para
  p.wallet = 3;
  const r = act(p, { act: 'bet', table: 'bj', amount: 5 });
  assert.equal(r.ok, false);
  assert.match(r.error, /Cüzdan/);
  assert.equal(p.wallet, 3);
  ok(p, { act: 'leave', table: 'bj' });
  // Fişi yetmeyen poker'e oturamaz
  sim.movePlayer(p.id, CASINO_TABLES.poker.seats[0].x, CASINO_TABLES.poker.seats[0].z, 0);
  assert.equal(act(p, { act: 'sit', table: 'poker' }).ok, false);
  // Kulübün dışından / uzaktan oturulmaz
  p.wallet = 500;
  sim.movePlayer(p.id, 17, 20, 0); // steeg, kapının önü
  assert.equal(isInsideCasino(17, 20), false);
  assert.equal(act(p, { act: 'sit', table: 'bj' }).ok, false);
  sim.movePlayer(p.id, 14.5, 24.5, 0); // kulübün içinde ama blackjack masasından uzak
  assert.equal(act(p, { act: 'sit', table: 'bj' }).ok, false);
  assert.equal(sim.casino.seated.size, 0);
});

test('odadan çıkan oyuncu masadan kalkar; kimse oturmuyorsa zamanlayıcı kalmaz', () => {
  const { sim, casino, add, ok, tick, to } = setup();
  const p = add('Ayşe', 'dice', 0);
  ok(p, { act: 'sit', table: 'dice', seat: 0 });
  ok(p, { act: 'stake', table: 'dice', amount: 5 });
  assert.equal(casino.dice.phase, 'result');
  sim.movePlayer(p.id, CASINO.doorPoint[0], CASINO.doorPoint[1], 0);
  tick(100);
  assert.equal(casino.seated.size, 0);
  assert.ok(to.some((e) => e.id === p.id && e.event === EVT.NOTIFY));
  assert.equal(casino.dice.phase, 'idle');
  assert.equal(casino.dice.endsAt, 0);
  assert.equal(casino.poker.endsAt, 0);
  assert.equal(casino.bj.endsAt, 0);
  // Snapshot alanı
  const snap = sim.snapshot(p.id);
  assert.equal(snap.casino.mine, null);
  assert.equal(snap.casino.bj.table, 'bj');
});

test('snapshot: oturan oyuncu kendi poker kartlarını görür, başkalarınınkini görmez', () => {
  const { sim, casino, add, ok, tick } = setup({ seed: 2 });
  const a = add('Ayşe', 'poker', 0);
  const b = add('Burak', 'poker', 1);
  ok(a, { act: 'sit', table: 'poker', seat: 0 });
  ok(b, { act: 'sit', table: 'poker', seat: 1 });
  tick(POKER_RULES.START_MS + 1);
  const sa = sim.snapshot(a.id).casino;
  assert.equal(sa.mine.table, 'poker');
  assert.deepEqual(sa.mine.cards, casino.poker.seats[0].hole);
  for (const s of sa.poker.seats) if (s) assert.equal(s.cards, null);
  assert.ok(!JSON.stringify(sa.poker).includes('"hole"'));
});
