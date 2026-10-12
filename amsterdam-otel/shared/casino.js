// Yeraltı Kart Kulübü — sunucu ve istemcinin ortak kuralları ve masa yerleşimi.
// Barın arkasındaki gizli oda (bkz. shared/layout.js CASINO): blackjack (krupiyeye karşı),
// basitleştirilmiş sabit limitli Texas Hold'em (boş koltuklarda NPC oyuncular) ve zar düellosu.
// Yalnızca saf JavaScript: hem Node.js hem tarayıcı doğrudan import eder.

/**
 * Kart = 0..51 tamsayı. rank = c % 13 (0 = "2" … 8 = "10", 9 = J, 10 = Q, 11 = K, 12 = A),
 * suit = floor(c / 13) (0 ♠, 1 ♥, 2 ♦, 3 ♣). Ağda da böyle gider (kısa); -1 = kapalı kart.
 */
export const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
export const SUITS = Object.freeze(['♠', '♥', '♦', '♣']);
export const HIDDEN_CARD = -1;

export const cardRank = (c) => c % 13;
export const cardSuit = (c) => Math.floor(c / 13);
export const isRedSuit = (c) => cardSuit(c) === 1 || cardSuit(c) === 2;
export const cardLabel = (c) => (c < 0 ? '🂠' : `${RANKS[cardRank(c)]}${SUITS[cardSuit(c)]}`);
/** Kart rengi/rütbe kodu: '2♠' → { rank: 0, suit: 0 } (testlerde okunaklı kart yazmak için) */
export function card(text) {
  const m = /^(10|[2-9JQKA])([♠♥♦♣shdc])$/.exec(text);
  if (!m) throw new Error(`Geçersiz kart: ${text}`);
  const suit = '♠♥♦♣'.includes(m[2]) ? '♠♥♦♣'.indexOf(m[2]) : 'shdc'.indexOf(m[2]);
  return suit * 13 + RANKS.indexOf(m[1]);
}

/** Fisher–Yates karıştırma (rng = sim.rng → testlerde tohumlanabilir) */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function makeDeck(decks = 1) {
  const out = [];
  for (let d = 0; d < decks; d++) for (let c = 0; c < 52; c++) out.push(c);
  return out;
}

// ---- Blackjack ----------------------------------------------------------------------

/** El değeri: aslar 11 sayılır, 21'i aşarsa 1'e düşer. soft = hâlâ 11 sayılan bir as var */
export function bjValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c < 0) continue;
    const r = cardRank(c);
    if (r === 12) {
      aces++;
      total += 11;
    } else {
      total += r >= 8 ? 10 : r + 2;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (cards) => cards.length === 2 && bjValue(cards).total === 21;

/** Krupiye kuralı: 17'ye kadar çeker, her 17'de (yumuşak 17 dahil) durur */
export const dealerShouldHit = (cards) => bjValue(cards).total < 17;

/**
 * Blackjack ödemesi (bahis dahil geri dönen tutar). Blackjack 3:2 (küsurat aşağı yuvarlanır),
 * kazanç 1:1, berabere (push) bahis iade, kayıp 0.
 * @returns {{ result: 'blackjack'|'win'|'push'|'lose', payout: number }}
 */
export function bjSettle(player, dealer, bet) {
  const pv = bjValue(player).total;
  const dv = bjValue(dealer).total;
  const pbj = isBlackjack(player);
  const dbj = isBlackjack(dealer);
  if (pv > 21) return { result: 'lose', payout: 0 };
  if (pbj && dbj) return { result: 'push', payout: bet };
  if (pbj) return { result: 'blackjack', payout: bet + Math.floor(bet * 1.5) };
  if (dbj) return { result: 'lose', payout: 0 };
  if (dv > 21 || pv > dv) return { result: 'win', payout: bet * 2 };
  if (pv === dv) return { result: 'push', payout: bet };
  return { result: 'lose', payout: 0 };
}

// ---- Poker: el değerlendirici -------------------------------------------------------

export const HAND_NAMES = Object.freeze([
  'Yüksek kart', 'Per', 'Döper', 'Üçlü', 'Kent', 'Renk', 'Ful', 'Kare', 'Floş',
]);
export const HAND_CAT = Object.freeze({
  HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8,
});

/** 5 kartın puanı: kategori * 13^5 + sıralı eşitlik bozucular (büyük olan kazanır) */
function score5(cards) {
  const ranks = cards.map(cardRank).sort((a, b) => b - a);
  const flush = cards.every((c) => cardSuit(c) === cardSuit(cards[0]));
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 12 && uniq[1] === 3) straightHigh = 3; // A-2-3-4-5 (as küçük sayılır)
  }
  // Gruplar: önce adet, sonra rütbe (ör. ful: üçlünün rütbesi, sonra perin)
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  let cat;
  let tb;
  if (straightHigh >= 0 && flush) {
    cat = HAND_CAT.STRAIGHT_FLUSH; tb = [straightHigh];
  } else if (shape === '41') {
    cat = HAND_CAT.QUADS; tb = groups.map((g) => g[0]);
  } else if (shape === '32') {
    cat = HAND_CAT.FULL_HOUSE; tb = groups.map((g) => g[0]);
  } else if (flush) {
    cat = HAND_CAT.FLUSH; tb = ranks;
  } else if (straightHigh >= 0) {
    cat = HAND_CAT.STRAIGHT; tb = [straightHigh];
  } else if (shape === '311') {
    cat = HAND_CAT.TRIPS; tb = groups.map((g) => g[0]);
  } else if (shape === '221') {
    cat = HAND_CAT.TWO_PAIR; tb = groups.map((g) => g[0]);
  } else if (shape === '2111') {
    cat = HAND_CAT.PAIR; tb = groups.map((g) => g[0]);
  } else {
    cat = HAND_CAT.HIGH; tb = ranks;
  }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 13 + (tb[i] ?? 0);
  return { cat, score: s, straightHigh };
}

/**
 * 5–7 karttan en iyi 5'li el. @returns {{ cat, score, name, best: number[] }}
 * score büyük olan kazanır; eşitse pot bölünür.
 */
export function evalHand(cards) {
  if (cards.length < 5 || cards.length > 7) throw new Error('5–7 kart gerekli');
  let best = null;
  const n = cards.length;
  const idx = [0, 1, 2, 3, 4];
  // n'den 5'li tüm kombinasyonlar (en fazla 21)
  for (;;) {
    const hand = idx.map((i) => cards[i]);
    const s = score5(hand);
    if (!best || s.score > best.score) best = { ...s, best: hand };
    let k = 4;
    while (k >= 0 && idx[k] === n - 5 + k) k--;
    if (k < 0) break;
    idx[k]++;
    for (let j = k + 1; j < 5; j++) idx[j] = idx[j - 1] + 1;
  }
  const royal = best.cat === HAND_CAT.STRAIGHT_FLUSH && best.straightHigh === 12;
  return { cat: best.cat, score: best.score, name: royal ? 'Royal floş' : HAND_NAMES[best.cat], best: best.best };
}

/**
 * NPC oyuncular için kaba el gücü 0..1 (rastgelelik CasinoService'te eklenir).
 * Flop öncesi: yüksek kartlar, per, aynı renk, ardışıklık. Sonrası: kategori + per yüksekliği.
 */
export function handStrength(hole, board) {
  const [a, b] = hole.map(cardRank).sort((x, y) => y - x);
  if (board.length < 3) {
    let s = (a + b) / 30; // 0 .. 0.8
    if (a === b) s += 0.35 + a / 60;
    if (cardSuit(hole[0]) === cardSuit(hole[1])) s += 0.06;
    if (a - b === 1) s += 0.04;
    return Math.min(1, s);
  }
  const e = evalHand([...hole, ...board]);
  const base = [0.12, 0.42, 0.62, 0.74, 0.82, 0.86, 0.92, 0.97, 1][e.cat];
  // Per / yüksek kart: rütbe ne kadar yüksekse o kadar güçlü (masadaki ortak per pek sayılmaz)
  if (e.cat <= HAND_CAT.PAIR) {
    const boardOnly = board.length >= 5 && evalHand(board).score >= e.score;
    const top = Math.floor(e.score / 13 ** 4) % 13;
    return boardOnly ? 0.1 : base + top / 60;
  }
  return base;
}

// ---- Masalar ve kurallar ------------------------------------------------------------

export const MONEY_SOURCES = Object.freeze(['wallet', 'kasa']);

export const CASINO_RULES = Object.freeze({
  RANGE: 2.4, // koltuğa / masa merkezine en fazla uzaklık (m; sunucu +1 m gecikme toleransı ekler)
  SEATS: 4,
  // Otel kasasından (sim.money) oynamak: tur başına en fazla €50 ve kasada en az €500 olmalı
  KASA_MAX_PER_ROUND: 50,
  KASA_MIN_BALANCE: 500,
  TURN_MS: 15_000, // sıra süresi (dolunca blackjack: dur; poker: pas ya da çekil)
  RESULT_MS: 5_000, // sonuç ekranı, sonra yeni tur
});

export const BJ_RULES = Object.freeze({
  DECKS: 6,
  RESHUFFLE_AT: 60, // ayakkabıda bu kadar kart kalınca yeniden karıştır
  MIN_BET: 2,
  MAX_BET: 100,
  BET_WINDOW_MS: 12_000, // ilk bahisten sonra diğerlerinin bahis süresi
});

export const POKER_RULES = Object.freeze({
  SMALL_BLIND: 1,
  BIG_BLIND: 2,
  SMALL_BET: 2, // flop öncesi ve flop
  BIG_BET: 4, // turn ve river
  MAX_RAISES: 3, // sokak başına en fazla artırma (açılış bahsi ve büyük kör sayılmaz)
  BUY_IN: 20, // masaya otururken alınan fiş (cüzdan ya da kasa); kalkınca bozdurulur
  BOT_CHIPS: 20,
  START_MS: 2_500, // ilk oyuncu oturunca / el bitince yeni ele kadar
  BOT_MIN_MS: 700, // NPC düşünme süresi
  BOT_MAX_MS: 1_600,
});

export const DICE_RULES = Object.freeze({
  MIN_STAKE: 1,
  MAX_STAKE: 100,
  BET_WINDOW_MS: 10_000,
  NPC_MIN_STAKE: 2,
  NPC_MAX_STAKE: 10,
  MAX_REROLLS: 20, // beraberlikte yeniden atış (sonsuz döngü sigortası)
});

export const STREETS = Object.freeze(['preflop', 'flop', 'turn', 'river']);

/**
 * Masa yerleşimi (dünya metresi). seats[i] = oyuncunun oturduğu nokta + masaya bakış yönü (yaw).
 * İstemci oturunca oyuncuyu bu noktaya ışınlar (diğerleri onu koltukta görür).
 * Yaw: kamera −Z'ye bakarken 0; masaya bakmak için atan2(-(dx), -(dz)).
 */
function seatsAround(cx, cz, pts) {
  return Object.freeze(pts.map(([x, z]) => Object.freeze({ x, z, yaw: Math.atan2(-(cx - x), -(cz - z)) })));
}

export const CASINO_TABLES = Object.freeze({
  bj: Object.freeze({
    id: 'bj',
    name: 'Blackjack',
    icon: '🃏',
    center: [10.8, 16.9],
    dealer: [10.8, 15.75],
    seats: seatsAround(10.8, 16.5, [[9.5, 17.35], [10.27, 17.97], [11.33, 17.97], [12.1, 17.35]]),
  }),
  poker: Object.freeze({
    id: 'poker',
    name: 'Poker',
    icon: '♠',
    center: [12.2, 22.9],
    seats: seatsAround(12.2, 22.9, [[12.2, 21.65], [10.45, 22.9], [12.2, 24.15], [13.95, 22.9]]),
  }),
  dice: Object.freeze({
    id: 'dice',
    name: 'Zar',
    icon: '🎲',
    center: [14.4, 16.5],
    seats: seatsAround(14.4, 16.5, [[14.4, 17.45], [13.45, 16.5], [15.35, 16.5], [14.4, 15.55]]),
  }),
});
// Prototipsiz arama: 'constructor' / '__proto__' gibi anahtarlar undefined döner
export const TABLE_BY_ID = Object.freeze(Object.assign(Object.create(null), CASINO_TABLES));
export const TABLE_IDS = Object.freeze(Object.keys(CASINO_TABLES));
