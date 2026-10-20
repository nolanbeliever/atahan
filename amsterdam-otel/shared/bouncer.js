// VIP Bouncer: −1. Kat Eğlence Katı'nın ("Neon Kelder") kapısı. Asansör / merdivenle inen misafirler
// kuzey duvarı boyunca kadife ipin arkasında sıraya girer; kapıdaki görevli (oyuncu ya da işe alınan
// bouncer NPC) kıyafet kuralına, davetiyeye / oda kartına ve davranışa bakıp içeri alır ya da geri çevirir.
// Kurallar YALNIZCA kıyafet parçaları ve davranışla ilgilidir — beden, ten, cinsiyet, yaş ölçüt değildir.

const freeze = Object.freeze;

// ---- Yerleşim (bodrumun kuzeybatısı; asansör x 32, merdiven x 37, kuzey duvarı z −10) ---------------

export const DOOR = freeze({
  check: freeze([38.1, -11.65]), // sıranın başı: kontrol edilen misafir burada durur (doğuya, kürsüye bakar)
  gate: freeze([39.3, -11.65]), // içeri alınan buradan salona geçer
  podium: freeze([39.05, -12.55]), // kürsü (dress code tabletiyle)
  stand: freeze([39.35, -13.05]), // görevlinin durduğu yer (kuzeybatıya, misafire bakar)
  spare: freeze([39.9, -11.2]), // ikinci bouncer / oyuncu kapıdayken NPC'nin beklediği yer
  // Sıra: kontrol noktasının batısında, ipin kuzeyinde (5 kişi)
  slots: freeze([[36.9, -11.65], [35.8, -11.65], [34.7, -11.65], [33.6, -11.65], [32.5, -11.65]].map((p) => freeze(p))),
  back: freeze([[37.4, -11.05], [33.5, -11.05]].map((p) => freeze(p))), // geri çevrilen: sıranın arkasından asansöre
  rope: freeze({ minX: 31.2, maxX: 37.7, z: -12.3 }), // kadife ip (sırayı salondan ayırır)
  board: freeze([39.9, -10.16]), // kuzey duvarındaki "Bu geceki kural" panosu
  range: 1.6, // kürsü etkileşim menzili
  reach: 4, // görevli kürsüden bu kadar uzaklaşırsa kapıdan ayrılmış sayılır
});

// ---- Kıyafet parçaları ------------------------------------------------------------------------------
// s (stil): formal · smart · casual · beach · sport

export const COLORS = freeze({
  beyaz: freeze({ name: 'Beyaz', hex: '#f2f2ee' }),
  siyah: freeze({ name: 'Siyah', hex: '#1b1b1f' }),
  lacivert: freeze({ name: 'Lacivert', hex: '#1f2f56' }),
  bordo: freeze({ name: 'Bordo', hex: '#6e1f2b' }),
  gri: freeze({ name: 'Gri', hex: '#7b7f87' }),
  bej: freeze({ name: 'Bej', hex: '#cdb894' }),
  kirmizi: freeze({ name: 'Kırmızı', hex: '#c2263b' }),
  neonpembe: freeze({ name: 'Neon pembe', hex: '#ff3fd2', neon: true }),
  neonyesil: freeze({ name: 'Neon yeşil', hex: '#62ff4f', neon: true }),
  neonsari: freeze({ name: 'Neon sarı', hex: '#f4ff3a', neon: true }),
});
export const COLOR_IDS = freeze(Object.keys(COLORS));

export const TOPS = freeze({
  gomlek: freeze({ name: 'Gömlek', s: 'formal' }),
  bluz: freeze({ name: 'İpek bluz', s: 'formal' }),
  triko: freeze({ name: 'Triko kazak', s: 'smart' }),
  polo: freeze({ name: 'Polo yaka', s: 'smart' }),
  tisort: freeze({ name: 'Tişört', s: 'casual' }),
  atlet: freeze({ name: 'Atlet', s: 'beach' }),
  kapusonlu: freeze({ name: 'Kapüşonlu', s: 'sport' }),
  forma: freeze({ name: 'Spor forması', s: 'sport' }),
});
export const BOTTOMS = freeze({
  kumas: freeze({ name: 'Kumaş pantolon', s: 'formal' }),
  etek: freeze({ name: 'Kalem etek', s: 'formal' }),
  chino: freeze({ name: 'Chino', s: 'smart' }),
  kot: freeze({ name: 'Kot pantolon', s: 'casual' }),
  sort: freeze({ name: 'Şort', s: 'beach' }),
  esofman: freeze({ name: 'Eşofman altı', s: 'sport' }),
});
export const SHOES = freeze({
  klasik: freeze({ name: 'Klasik ayakkabı', s: 'formal' }),
  topuklu: freeze({ name: 'Topuklu', s: 'formal' }),
  loafer: freeze({ name: 'Loafer', s: 'smart' }),
  sneaker: freeze({ name: 'Temiz sneaker', s: 'casual' }),
  terlik: freeze({ name: 'Terlik', s: 'beach' }),
  kosu: freeze({ name: 'Koşu ayakkabısı', s: 'sport' }),
});
export const JACKETS = freeze({
  blazer: freeze({ name: 'Blazer ceket', s: 'formal' }),
  deri: freeze({ name: 'Deri ceket', s: 'smart' }),
  yagmurluk: freeze({ name: 'Yağmurluk', s: 'casual' }),
});
export const ACCESSORIES = freeze({
  papyon: freeze({ name: 'Papyon', s: 'formal' }),
  gozluk: freeze({ name: 'Güneş gözlüğü', s: 'smart' }),
  kep: freeze({ name: 'Kep şapka', s: 'sport' }),
  neon: freeze({ name: 'Neon bileklik', s: 'smart', neon: true }),
});

const PART_TABLE = freeze({ top: TOPS, bottom: BOTTOMS, shoes: SHOES, jacket: JACKETS, acc: ACCESSORIES });
export const PARTS = freeze(['top', 'bottom', 'shoes', 'jacket', 'acc']);
export const PART_NAMES = freeze({ top: 'Üst', bottom: 'Alt', shoes: 'Ayakkabı', jacket: 'Ceket', acc: 'Aksesuar' });

export const partDef = (part, id) => (id ? PART_TABLE[part]?.[id] ?? null : null);

// ---- Bu gecenin kıyafet kuralı ----------------------------------------------------------------------

export const DRESS_CODES = freeze([
  freeze({
    id: 'sik', name: 'Şık Gece', icon: '🎩',
    rules: freeze(['Üst, alt ve ayakkabı şık (formal / smart) olmalı', 'Tişört, kot, sneaker, spor ve plaj kıyafeti yok']),
  }),
  freeze({
    id: 'smart', name: 'Smart Casual', icon: '👔',
    rules: freeze(['Rahat ama özenli: tişört, kot, temiz sneaker olur', 'Eşofman, forma, kapüşonlu, şort, atlet, terlik yok']),
  }),
  freeze({
    id: 'beyaz', name: 'Beyaz Parti', icon: '🤍',
    rules: freeze(['Üst ve alt BEYAZ olmalı', 'Terlik, şort, atlet yok']),
  }),
  freeze({
    id: 'neon', name: 'Neon Gece', icon: '💡',
    rules: freeze(['En az bir NEON renk parça ya da neon bileklik', 'Terlik, şort, atlet yok']),
  }),
]);
export const DRESS_CODE_BY_ID = freeze(Object.fromEntries(DRESS_CODES.map((c) => [c.id, c])));

/** Oyun gününe göre bu gecenin kuralı (her gün sırayla değişir) */
export const dressCodeFor = (dayCount) => DRESS_CODES[((dayCount % DRESS_CODES.length) + DRESS_CODES.length) % DRESS_CODES.length];

const styleOf = (part, id) => partDef(part, id)?.s ?? null;

/**
 * Kıyafet kurala uyuyor mu? @returns {string|null} ihlal açıklaması (uyuyorsa null)
 * dress: { top, topC, bottom, bottomC, shoes, shoesC, jacket, jacketC, acc }
 */
export function dressViolation(code, dress) {
  const st = (p) => styleOf(p, dress[p]);
  const nm = (p) => partDef(p, dress[p])?.name ?? '';
  const id = typeof code === 'string' ? code : code.id;
  if (id === 'sik') {
    for (const p of ['top', 'bottom', 'shoes']) if (st(p) !== 'formal' && st(p) !== 'smart') return `${nm(p)} şık gece için uygun değil`;
    if (dress.jacket && st('jacket') === 'casual') return `${nm('jacket')} şık gece için uygun değil`;
    if (dress.acc && st('acc') === 'sport') return `${nm('acc')} şık gece için uygun değil`;
    return null;
  }
  for (const p of ['top', 'bottom', 'shoes']) if (st(p) === 'beach') return `${nm(p)} ile içeri girilmez`;
  if (id === 'smart') {
    for (const p of ['top', 'bottom', 'shoes']) if (st(p) === 'sport') return `${nm(p)} smart casual değil`;
    return null;
  }
  if (id === 'beyaz') {
    if (dress.topC !== 'beyaz') return `Üst beyaz değil (${COLORS[dress.topC]?.name ?? '?'})`;
    if (dress.bottomC !== 'beyaz') return `Alt beyaz değil (${COLORS[dress.bottomC]?.name ?? '?'})`;
    return null;
  }
  if (id === 'neon') {
    const neon = ['top', 'bottom', 'shoes', 'jacket'].some((p) => dress[p] && COLORS[dress[`${p}C`]]?.neon) || dress.acc === 'neon';
    return neon ? null : 'Üzerinde neon parça yok';
  }
  return null;
}

// ---- Davranış ve kart -----------------------------------------------------------------------------

export const CUES_OK = freeze([
  'Gülümsüyor, sakince sırasını bekliyor',
  'Arkadaşıyla sohbet ediyor',
  'Kibarca selam verdi',
  'Telefonundan davetiyesini gösteriyor',
  'Müziğe hafifçe eşlik ediyor',
]);
export const CUES_BAD = freeze([
  'Bağırıyor, öndekileri itiyor',
  'Yumruklarını sıkmış, kavga arıyor',
  'Sıradakilere laf atıyor',
  'Güvenliğe hakaret ediyor',
]);

/** Ziyaretçi soyadları (davetiye / kara liste: "Sanne K.") */
export const SURNAME_INITIALS = freeze(['K.', 'V.', 'B.', 'D.', 'Y.', 'A.', 'M.', 'T.', 'S.', 'H.']);
export const VENUE_NAME = 'Hotel De Tulp';
export const FAKE_VENUES = freeze(['Hotel De Tulip', 'Hotel Da Tulp', 'Hotel De Tolp']);

export const BOUNCER_RULES = freeze({
  QUEUE_MAX: 5,
  UNMANNED_MS: 1300, // kapıda kimse yokken sıradaki misafir bu sürede kendiliğinden girer
  NPC_CHECK_MS: 2600, // bouncer NPC'nin bir misafiri kontrol süresi (moral / seviye çarpanı uygulanır)
  DECIDE_GAP_MS: 350, // iki karar arası en az (çift tık)
  OK_CHANCE: 0.62, // misafirin kurallara tamamen uyma olasılığı
  INCIDENT_MIN_MS: 14_000, // içeri giren sorunlu misafir bu aralıkta olay çıkarır
  INCIDENT_MAX_MS: 32_000,
  UNMANNED_INCIDENT: 0.6, // kapı boşken giren sorunlu misafirin olay çıkarma olasılığı
  AMBIENCE_START: 60, // "Ortam" puanı (0–100)
  AMBIENCE_DRIFT: 0.25, // her gün 60'a doğru bu oranda yaklaşır
  DELTA: freeze({ admitOk: 1, rejectBad: 2, rejectOk: -3, admitDress: -3, incident: -8 }),
  REP_EVERY: 4, // her 4 doğru kararda +1 itibar
  BLACKLIST: 3, // panodaki kara liste uzunluğu
});

/** Ortam → Eğlence Katı NPC ücret çarpanı (0.8 … 1.4) */
export const ambienceFeeMul = (a) => 0.8 + 0.6 * (Math.min(Math.max(a, 0), 100) / 100);
/** Ortam → NPC gelme aralığı çarpanı (1.3 … 0.8; küçük = daha sık) */
export const ambienceSpawnMul = (a) => 1.3 - 0.5 * (Math.min(Math.max(a, 0), 100) / 100);

/** Bouncer NPC'nin isabeti (seviye ve moral / hız çarpanıyla) */
export function bouncerAccuracy(level, speedMul = 1) {
  return Math.min(0.97, 0.7 + 0.05 * (Math.max(1, level) - 1) + (1 - speedMul) * 0.8);
}

// ---- Rastgele profil (sunucu; testler deterministik rng verir) ------------------------------------------

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** Kurala UYAN parçalar (kurala göre filtre) */
function allowedIds(code, part) {
  const table = PART_TABLE[part];
  const ids = Object.keys(table);
  const s = (id) => table[id].s;
  if (code === 'sik') {
    if (part === 'jacket') return ids.filter((id) => s(id) !== 'casual');
    if (part === 'acc') return ids.filter((id) => s(id) !== 'sport');
    return ids.filter((id) => s(id) === 'formal' || s(id) === 'smart');
  }
  if (part === 'jacket' || part === 'acc') return ids;
  if (code === 'smart') return ids.filter((id) => s(id) !== 'beach' && s(id) !== 'sport');
  return ids.filter((id) => s(id) !== 'beach');
}

const PLAIN = COLOR_IDS.filter((c) => !COLORS[c].neon);
const NEON = COLOR_IDS.filter((c) => COLORS[c].neon);

/** Kurala uyan bir kıyafet */
export function compliantDress(rng, code) {
  const d = {};
  for (const part of PARTS) {
    const optional = part === 'jacket' || part === 'acc';
    if (optional && rng() < 0.55) {
      d[part] = null;
      if (part !== 'acc') d[`${part}C`] = null;
      continue;
    }
    d[part] = pick(rng, allowedIds(code, part));
    if (part !== 'acc') d[`${part}C`] = pick(rng, rng() < 0.15 ? NEON : PLAIN);
  }
  if (code === 'beyaz') {
    d.topC = 'beyaz';
    d.bottomC = 'beyaz';
  }
  if (code === 'neon' && dressViolation('neon', d)) {
    if (rng() < 0.5) d.acc = 'neon';
    else d.topC = pick(rng, NEON);
  }
  return d;
}

/** Kurala UYMAYAN tek bir değişiklik (bir parça ya da renk) */
export function breakDress(rng, code, d) {
  const out = { ...d };
  if (code === 'beyaz' && rng() < 0.6) {
    out[rng() < 0.5 ? 'topC' : 'bottomC'] = pick(rng, PLAIN.filter((c) => c !== 'beyaz'));
    return out;
  }
  if (code === 'neon' && rng() < 0.6) {
    for (const p of ['top', 'bottom', 'shoes', 'jacket']) if (out[`${p}C`] && COLORS[out[`${p}C`]].neon) out[`${p}C`] = pick(rng, PLAIN);
    if (out.acc === 'neon') out.acc = null;
    return out;
  }
  const part = pick(rng, ['top', 'bottom', 'shoes']);
  const table = PART_TABLE[part];
  const bad = Object.keys(table).filter((id) => {
    const test = { ...out, [part]: id };
    return dressViolation(code, test) !== null;
  });
  if (bad.length) out[part] = pick(rng, bad);
  return out;
}
