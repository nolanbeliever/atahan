// Achterstraat Canlı Müzik Sahnesi: sahne yeri, müzisyen grupları, set / mola takvimi ve
// kalabalığın toplandığı yarım çember. Sunucu (kurallar, doğrulama, kalabalık NPC'leri) ve
// istemci (sahne modeli, panel, prosedürel müzik) aynı tabloları kullanır.
//
//   z=26 ════════ komşu binaların arka duvarı ═════════
//         │  [hoparlör]  ┌ ACHTERSTRAAT LIVE ┐ [hoparlör] │
//         │      sahne (x −14.9 … −10.1, z 26.25 … 28.45) │  ← ahşap platform 0.45 m
//                         └─ basamak ─┘
//                 ·   ·   ·   ·   ·      ← kalabalık (yarım çember, iki sıra)
//   z=32.3 ─────────── evlerin önündeki kaldırım ───────────
// Batıda köşe ağacı (x −16.45), doğuda sokak lambası (x −9.45) ve ≥ 1.6 m yürüme yolu kalır.

import { DAY_START_MIN, DAY_END_MIN } from './constants.js';

const byId = (list) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x.id, x]))));

export const STAGE = Object.freeze({
  PRICE: 900, // € — otelin kasasından, bir kez (Resepsiyon PC → Yükseltmeler)
  bounds: Object.freeze({ minX: -14.9, maxX: -10.1, minZ: 26.25, maxZ: 28.45 }),
  steps: Object.freeze({ minX: -13.15, maxX: -11.85, minZ: 28.45, maxZ: 28.9 }),
  height: 0.45, // platform yüksekliği (m)
  center: Object.freeze([-12.5, 27.35]), // sahnenin ortası (ses kaynağı burada)
  front: Object.freeze([-12.5, 28.45]), // ön kenarın ortası (kalabalık buna bakar)
  point: Object.freeze([-12.5, 29.35]), // basamakların önü: E → müzisyen paneli
  range: 2.4, // etkileşim mesafesi (sunucu +1 m gecikme toleransı ekler)
  HEAR_RANGE: 35, // bu mesafenin ötesinde müzik çalmaz (zamanlayıcı durur)
  ANIM_RANGE: 30, // müzisyen / kalabalık animasyonu yalnızca bu mesafede
});

/**
 * Kiralanabilir gruplar (günlük ücret otelin kasasından). crowd: sete gelen kalabalık,
 * barTip / barSpawn: set bitince kalabalık bara geçtiğinde verilen geçici bar bonusu.
 */
export const STAGE_ACTS = Object.freeze([
  {
    id: 'guitar', name: 'Akustik Gitarist', icon: '🎸', fee: 120, crowd: 5, members: 1,
    barTip: 1.5, barSpawn: 1.8, bpm: 96,
    desc: 'Parmakla çalınan akorlar, sakin bir sokak akşamı. Kalabalık sallanıp alkışlar.',
  },
  {
    id: 'dj', name: 'DJ Kabini', icon: '🎧', fee: 220, crowd: 9, members: 1,
    barTip: 1.6, barSpawn: 2.0, bpm: 124,
    desc: 'Dört vuruşlu house ritmi ve bas synth. En kalabalık dans pisti.',
  },
  {
    id: 'jazz', name: 'Caz Grubu', icon: '🎷', fee: 350, crowd: 7, members: 3,
    barTip: 1.8, barSpawn: 2.0, bpm: 132,
    desc: '3 kişi: saksafon, kontrbas, davul. Swing ritmi, en cömert bahşişler.',
  },
]);
export const STAGE_ACT_BY_ID = byId(STAGE_ACTS);

export const STAGE_RULES = Object.freeze({
  SET_MIN: 240, // set süresi (oyun dakikası) — varsayılan gün hızında ~60 gerçek sn
  BREAK_MIN: 60, // setler arası mola (~15 gerçek sn)
  HIRE_FROM_MIN: DAY_START_MIN, // 07:00
  HIRE_UNTIL_MIN: 22 * 60, // 22:00'den sonra o gün için grup tutulamaz
  END_MIN: DAY_END_MIN, // 23:00: son set biter, kalabalık dağılır (bar bonusu yok)
  BOOST_MIN: 120, // set sonu bar bonusunun süresi (oyun dakikası)
  MAX_CROWD: 10,
  CROWD_SPEED: 1.5, // m/sn
  CROWD_GAP_MS: 1100, // kalabalık birer birer gelir (gerçek ms)
  TIP_PER_FAN: 3, // set sonunda sahnenin yanında oyuncu varsa: seyirci başına bahşiş kavanozu (kasaya)
  TIP_RANGE: 14, // bahşiş kavanozu için oyuncunun sahneye uzaklığı (m)
});

/**
 * Kayıttaki rezervasyonun o anki durumu (oyun dakikası `total` ile).
 * @param b { startTotal, endTotal } — set 0 startTotal'da başlar; SET → MOLA → SET … endTotal'a kadar
 * @returns {{ phase: 'set'|'break'|'over', setNo: number, from: number, to: number }}
 *   from/to: içinde bulunulan evrenin başlangıç / bitişi (mutlak oyun dakikası)
 */
export function stagePhaseAt(b, total) {
  if (!b || total >= b.endTotal) return { phase: 'over', setNo: -1, from: b?.endTotal ?? 0, to: Infinity };
  const cycle = STAGE_RULES.SET_MIN + STAGE_RULES.BREAK_MIN;
  const el = Math.max(0, total - b.startTotal);
  const setNo = Math.floor(el / cycle);
  const start = b.startTotal + setNo * cycle;
  const setEnd = Math.min(start + STAGE_RULES.SET_MIN, b.endTotal);
  if (total < setEnd) return { phase: 'set', setNo, from: start, to: setEnd };
  return { phase: 'break', setNo, from: setEnd, to: Math.min(start + cycle, b.endTotal) };
}

/**
 * Kalabalığın durduğu noktalar: sahnenin önünde iki sıralı gevşek yarım çember (önce ön sıra,
 * ortadan kenarlara). Hepsi Achterstraat'ın içinde, evlerin önündeki kaldırımın (z 32.3) güneyinde.
 */
export const CROWD_SPOTS = Object.freeze((() => {
  const [cx, cz] = STAGE.front;
  const out = [];
  const row = (r, angles) => {
    for (const a of angles) {
      const rad = (a * Math.PI) / 180;
      out.push(Object.freeze([Math.round((cx + Math.sin(rad) * r) * 100) / 100, Math.round((cz + 0.15 + Math.cos(rad) * r) * 100) / 100]));
    }
  };
  row(1.75, [0, -38, 38, -72, 72]);
  row(2.95, [-18, 18, -50, 50, 0]);
  return out;
})());

/** Kalabalığın yüzü: sahnenin ortasına bakar (karakterin önü +Z → atan2(dx, dz)) */
export function faceStage(x, z) {
  return Math.atan2(STAGE.center[0] - x, STAGE.center[1] - z);
}

/** (x, z) sahnenin etkileşim noktasına yakın mı (sunucu: +1 m tolerans) */
export function nearStage(x, z, slack = 0) {
  return Math.hypot(x - STAGE.point[0], z - STAGE.point[1]) <= STAGE.range + slack;
}
