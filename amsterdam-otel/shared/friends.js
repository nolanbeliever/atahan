// Bar De Tulp müdavimleri ve arkadaşlık sistemi — sunucu (doğrulama) ve istemci
// (diyalog menüsü) AYNI verileri kullanır.
//
// Her bar müşterisinin bir adı vardır (BAR_CUSTOMER_NAMES); aynı ad = aynı kişi.
// Oyuncu her kişiyle ayrı bir arkadaşlık seviyesi (%0–100) biriktirir: doğru konuyu açmak,
// esprisini beğeneceği birine espri yapmak ve sevdiği içeceği ısmarlamak seviyeyi artırır.
// %80'de kişi oyuncunun Achterstraat'taki evine davet edilebilir.

export const TOPICS = Object.freeze([
  { id: 'bikes', label: 'Bisikletler', icon: '🚲' },
  { id: 'music', label: 'Müzik', icon: '🎵' },
  { id: 'football', label: 'Futbol', icon: '⚽' },
  { id: 'food', label: 'Yemek', icon: '🧇' },
  { id: 'art', label: 'Sanat', icon: '🎨' },
  { id: 'travel', label: 'Seyahat', icon: '✈️' },
  { id: 'games', label: 'Oyunlar', icon: '🎮' },
  { id: 'animals', label: 'Hayvanlar', icon: '🐶' },
]);
const byId = (list, key = 'id') => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x[key], x]))));
export const TOPIC_BY_ID = byId(TOPICS);

/**
 * love: en sevdiği konu · like: sevdiği · dislike: sıkıldığı konu
 * humor: 'love' espriye bayılır · 'ok' bazen güler · 'meh' espriden hoşlanmaz
 * drink: en sevdiği içecek (DRINKS kimliği)
 */
export const REGULARS = Object.freeze([
  { name: 'Sanne', bio: 'Kanal kenarında bisiklet tamir ediyor.', love: 'bikes', like: 'travel', dislike: 'football', humor: 'love', drink: 'lemonade' },
  { name: 'Daan', bio: 'Ajax taraftarı, maç kaçırmaz.', love: 'football', like: 'food', dislike: 'art', humor: 'ok', drink: 'chocolate' },
  { name: 'Emma', bio: 'Rijksmuseum\'da rehber.', love: 'art', like: 'music', dislike: 'games', humor: 'meh', drink: 'mocktail' },
  { name: 'Lars', bio: 'Gece DJ\'lik yapıyor.', love: 'music', like: 'games', dislike: 'animals', humor: 'love', drink: 'mocktail' },
  { name: 'Noor', bio: 'Barınakta gönüllü.', love: 'animals', like: 'food', dislike: 'football', humor: 'ok', drink: 'milkshake' },
  { name: 'Bram', bio: 'Stroopwafel fırını işletiyor.', love: 'food', like: 'bikes', dislike: 'travel', humor: 'love', drink: 'chocolate' },
  { name: 'Fleur', bio: 'Lale tarlalarının fotoğrafçısı.', love: 'travel', like: 'art', dislike: 'games', humor: 'ok', drink: 'lemonade' },
  { name: 'Jesse', bio: 'Oyun geliştirici, hep kulaklıklı.', love: 'games', like: 'music', dislike: 'bikes', humor: 'love', drink: 'milkshake' },
  { name: 'Lotte', bio: 'Kedisi Kaas ile ünlü.', love: 'animals', like: 'art', dislike: 'football', humor: 'meh', drink: 'chocolate' },
  { name: 'Thijs', bio: 'Her hafta sonu başka bir şehirde.', love: 'travel', like: 'football', dislike: 'food', humor: 'ok', drink: 'lemonade' },
  { name: 'Mila', bio: 'Konservatuvarda keman öğrencisi.', love: 'music', like: 'animals', dislike: 'games', humor: 'meh', drink: 'mocktail' },
  { name: 'Sem', bio: 'Kanal teknesinde yaşıyor.', love: 'bikes', like: 'animals', dislike: 'art', humor: 'love', drink: 'milkshake' },
]);
export const REGULAR_BY_NAME = byId(REGULARS, 'name');

export const JOKES = Object.freeze([
  'Laleler neden hep erken uyanır? Çünkü soğandan kalkarlar! 🌷',
  'Yel değirmeni ötekine ne demiş? "Bu işin havasındayım!" 🌬️',
  'Stroopwafel neden hiç taraf tutmaz? Çünkü hep arada kalır! 🧇',
  'Kanaldaki ördek neden otele gelmemiş? Zaten kendi "su"iti varmış! 🦆',
  'Bisikletim neden yatıyor? İki tekerlek üstünde durmaktan yorulmuş! 🚲',
  'Barmen neden hep sakin? Her şeyi çalkalamadan önce düşünür! 🍸',
]);

export const FRIEND_RULES = Object.freeze({
  INVITE_AT: 80, // bu seviyede eve davet açılır
  RANGE: 2.2, // müşteriyle konuşmak için en fazla uzaklık (sunucu + 1 m tolerans)
  CHAT: Object.freeze({ love: 15, like: 8, neutral: 2, dislike: -6 }),
  JOKE: Object.freeze({ love: 12, ok: 5, meh: -4 }),
  TREAT_FAV: 16, // en sevdiği içecek
  TREAT_OTHER: 7,
  HOME_CHAT: 4, // evde sohbet
  HOME_CHAT_COOLDOWN_MS: 20_000,
  TV_TOGETHER: 6, // evde birlikte TV izleme (ziyaret başına bir kez)
  VISIT_DONE: 5, // keyifli geçen ziyaret bitince
  MOOD_TIP: 1.2, // ertesi gün oda bahşişleri +%20
});

/** Konunun kişi için etkisi: 'love' | 'like' | 'dislike' | 'neutral' */
export function topicFit(reg, topic) {
  if (topic === reg.love) return 'love';
  if (topic === reg.like) return 'like';
  if (topic === reg.dislike) return 'dislike';
  return 'neutral';
}

export const clampLevel = (v) => Math.min(100, Math.max(0, Math.round(v)));
