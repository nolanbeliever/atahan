// Oyuncular arası yazılı sohbet: mesaj temizleme ve kaba kelime filtresi.
// Sunucu her mesajı burada temizler; istemci de gönderirken aynı sınırları uygular.

export const CHAT_RULES = Object.freeze({
  MAX_LEN: 160,
  HISTORY: 30, // yeni bağlanan oyuncuya gönderilen son mesaj sayısı
  REPEAT_MS: 4000, // aynı mesajı bu süre içinde tekrar göndermek engellenir
  BUBBLE_MS: 6000, // konuşma balonunun ekranda kalma süresi
});

// Kaba kelimeler (Türkçe + İngilizce kökler). Kelimenin başı eşleşirse tamamı yıldızlanır;
// kısa kökler yalnızca tam kelime olarak eşleşir ("sıkıcı", "müsiki", "ağaç" gibi masum kelimeler etkilenmez).
const ROOTS = [
  'siktir', 'sikerim', 'sikeyim', 'sikik', 'sikim', 'sikiş', 'orospu', 'oruspu', 'yarrak', 'yarak', 'amcık', 'amına', 'amina',
  'amk', 'aq', 'piç', 'pezevenk', 'gavat', 'kahpe', 'şerefsiz', 'göt', 'götveren', 'ibne', 'puşt', 'yavşak', 'dalyarak', 'taşşak',
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'cunt', 'whore', 'bastard', 'nigger', 'nigga', 'faggot',
];
const EXACT = new Set(['amk', 'aq', 'göt', 'piç', 'sik', 'dick', 'oç', 'mk', 'amq']);
const PREFIX = [...ROOTS.filter((r) => r.length >= 5), 'fuck', 'shit', 'cunt'];

/** Harfleri sadeleştir (büyük/küçük, tekrar eden harfler, bazı sayı-harf değişimleri) */
function normalize(word) {
  return word
    .toLocaleLowerCase('tr-TR')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/\$/g, 's')
    .replace(/(.)\1{2,}/g, '$1$1');
}

function isRude(word) {
  const w = normalize(word);
  if (!w) return false;
  if (EXACT.has(w)) return true;
  return PREFIX.some((r) => w.startsWith(r));
}

/** Kaba kelimeleri yıldızla */
export function maskRude(text) {
  return text.replace(/[\p{L}\p{N}$]+/gu, (w) => (isRude(w) ? '*'.repeat(Math.min(w.length, 6)) : w));
}

/**
 * Mesajı temizler: string değilse ya da boşsa null. Kontrol karakterleri ve açılı parantezler atılır,
 * boşluklar sadeleşir, uzunluk sınırlanır, kaba kelimeler yıldızlanır.
 */
export function cleanChat(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_RULES.MAX_LEN);
  return text ? maskRude(text) : null;
}
