// Sunucu ayarları. Tümü ortam değişkenleriyle değiştirilebilir.

function num(name, fallback, min = Number.MIN_VALUE) {
  const raw = process.env[name];
  const v = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(v) && v >= min ? v : fallback;
}

export const config = Object.freeze({
  port: num('PORT', 3000),
  // Bir oyun gününün (07:00 → 23:00) gerçek süresi (saniye)
  dayLengthSec: num('DAY_LENGTH_SEC', 240),
  // Hafta sonu (otel kapalı) günleri kaç kat hızlı aksın
  weekendSpeed: num('WEEKEND_SPEED', 2),
  // Simülasyon adımı. Misafir hareketi istemcide hesaplandığı için
  // sunucu düşük frekansta çalışabilir.
  tickMs: num('TICK_MS', 100),
  // Yeni misafir gelişleri arası (oyun dakikası)
  spawnMinMin: num('SPAWN_MIN_MIN', 40),
  spawnMaxMin: num('SPAWN_MAX_MIN', 90),
  // Konaklama süresi (oyun dakikası). Gece yarısını aşan konaklamalar
  // ertesi sabah 07:00'de çıkış yapar.
  stayMinMin: num('STAY_MIN_MIN', 150),
  stayMaxMin: num('STAY_MAX_MIN', 420),
  // Saat senkronunun istemcilere tekrar gönderilme aralığı
  clockBroadcastMs: num('CLOCK_BROADCAST_MS', 5000),
  maxPlayers: num('MAX_PLAYERS', 16),
  // Yeni bağlanan oyuncunun kişisel cüzdanı (€)
  startWallet: num('START_WALLET', 30, 0),
  // Başlangıç günü (0 = Pazartesi … 5 = Cumartesi, 6 = Pazar) ve saati (7–22)
  startDay: Math.floor(num('START_DAY', 0, 0)) % 7,
  startHour: Math.min(22, Math.max(7, num('START_HOUR', 7, 0))),
});
