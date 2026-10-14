// Ev matbaası (sahte para) ve polis baskını — sunucu (kurallar, doğrulama) ve istemci (görsel,
// istemler) aynı tabloyu kullanır. Tamamen oyun içi para; basılan para oyuncunun KİŞİSEL cüzdanına
// gider (otel kasasına değil).

export const PRESS = Object.freeze({
  PRICE: 600, // € — kurulum, cüzdandan, bir kez
  BATCH_MS: 45_000, // bir parti baskı süresi (gerçek ms)
  BATCH_VALUE: 500, // € — parti bitince cüzdana
  RAID_CHANCE: 0.3, // her partide baskın ihtimali
  RAID_FROM: 0.15, // baskın partinin %15–85'i arasında bir anda gelir
  RAID_TO: 0.85,
  WARNING_MS: 15_000, // uyarıdan polisin kapıya gelişine kadar
  STASH_MS: 2_000, // matbaayı ve parayı gizlemek (basılı tut)
  POLICE_MS: 6_000, // polislerin kapıda arama süresi (görsel)
  FINE: 1_000, // yakalanırsan cezası (cüzdanda ne varsa en fazla bu kadar)
  SEIZE_DAYS: 1, // yakalanırsan matbaa bu kadar oyun günü mühürlü
  RANGE: 1.4, // matbaaya / gizli bölmeye uzaklık (sunucu + 1 m tolerans)
  HIDE_MOVE: 0.8, // gizli bölmedeyken bu kadar yürürsen bölmeden çıkarsın
});

/**
 * Bir oyuncu evindeki sabit noktalar (ev sınırlarına göre): matbaa arka duvarın sol köşesinde,
 * gizli bölme doğu duvarında, yatağın önünde (kitaplık gibi görünen döner panel) — ikisi
 * birbirinden uzak: baskında hangisine koşacağına karar vermelisin.
 * @param h shared/layout.js PLAYER_HOUSES öğesi
 */
export function pressSpots(h) {
  const b = h.bounds;
  const r = (v) => Math.round(v * 100) / 100;
  return {
    press: { x: r(b.minX + 0.75), z: r(b.maxZ - 0.75) }, // makinenin merkezi
    pressPoint: [r(b.minX + 0.75), r(b.maxZ - 1.75)], // önünde durulan nokta
    hideout: { x: r(b.maxX - 0.14), z: r(b.minZ + 2.6) }, // duvardaki panel
    hidePoint: [r(b.maxX - 0.75), r(b.minZ + 2.6)],
    hideSpot: [r(b.maxX - 0.35), r(b.minZ + 2.6)], // bölmenin içi (oyuncu buraya alınır)
  };
}

export const TELEPORT_RULES = Object.freeze({
  COOLDOWN_MS: 4_000,
});
