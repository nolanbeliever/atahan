// Oyuncular arası yazılı sohbet: mesaj temizleme.
// Sunucu her mesajı burada temizler; istemci de gönderirken aynı sınırları uygular.

export const CHAT_RULES = Object.freeze({
  MAX_LEN: 160,
  HISTORY: 30, // yeni bağlanan oyuncuya gönderilen son mesaj sayısı
  REPEAT_MS: 4000, // aynı mesajı bu süre içinde tekrar göndermek engellenir
  BUBBLE_MS: 6000, // konuşma balonunun ekranda kalma süresi
});

// Küfür filtresi yok: oyuncular serbestçe yazar. Yalnızca ırkçı / homofobik hakaret kelimeleri yıldızlanır.
const SLURS = ['nigger', 'nigga', 'faggot'];

/** Hakaret kelimelerini yıldızla (kelimenin başı eşleşirse; büyük/küçük ve basit harf oyunları dahil) */
export function maskRude(text) {
  return text.replace(/[\p{L}\p{N}$]+/gu, (w) => {
    const n = w.toLocaleLowerCase('tr-TR').replace(/1/g, 'i').replace(/0/g, 'o').replace(/3/g, 'e').replace(/4/g, 'a');
    return SLURS.some((r) => n.startsWith(r)) ? '*'.repeat(Math.min(w.length, 6)) : w;
  });
}

/**
 * Mesajı temizler: string değilse ya da boşsa null. Kontrol karakterleri ve açılı parantezler atılır,
 * boşluklar sadeleşir, uzunluk sınırlanır.
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
