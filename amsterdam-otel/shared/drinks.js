// Bar De Tulp içecek kütüphanesi (ALKOLSÜZ). Sunucu (tarif doğrulama, fiyat, bahşiş) ve istemci
// (tarif kitabı, malzeme dolabı, bardak rengi) aynı tabloları kullanır.
//
// Malzemeler üç istasyondan alınır:
//   dispenser: arka tezgâhtaki 5 musluk (limon, çilek, süt, kakao, soda)
//   cooler:    barın batı ucundaki camlı soğutucu dolap (meyve suları, şuruplar, nane, buz, kahve…)
//   taps:      tezgâhın batı ucundaki fıçı kulesi (fıçı limonata, zencefilli gazoz, elma gazozu)
// İçecek hazırlama: temiz bardak al → malzemeleri (sırası serbest) koy → shake: true ise çalkala → servis.
// Fıçı ve şat içecekleri tek ya da iki malzemeyle doğrudan bardağa doldurulur.

const byId = (list) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x.id, x]))));

export const INGREDIENTS = Object.freeze([
  // Musluklar (arka tezgâh)
  { id: 'lemon', name: 'Limon suyu', icon: '🍋', color: '#f2df4a', station: 'dispenser' },
  { id: 'strawberry', name: 'Çilek şurubu', icon: '🍓', color: '#e23a4e', station: 'dispenser' },
  { id: 'milk', name: 'Süt', icon: '🥛', color: '#f3efe4', station: 'dispenser' },
  { id: 'cocoa', name: 'Kakao', icon: '🍫', color: '#6a3c20', station: 'dispenser' },
  { id: 'soda', name: 'Soda', icon: '🫧', color: '#cdeefb', station: 'dispenser' },
  // Soğutucu dolap
  { id: 'lime', name: 'Misket limonu', icon: '🟢', color: '#9bd34a', station: 'cooler' },
  { id: 'mint', name: 'Taze nane', icon: '🌿', color: '#3f9b4a', station: 'cooler' },
  { id: 'ice', name: 'Buz', icon: '🧊', color: '#e8f6ff', station: 'cooler' },
  { id: 'sugar', name: 'Şeker şurubu', icon: '🍬', color: '#f7efd2', station: 'cooler' },
  { id: 'orange', name: 'Portakal suyu', icon: '🍊', color: '#f59a23', station: 'cooler' },
  { id: 'pineapple', name: 'Ananas suyu', icon: '🍍', color: '#f6d64a', station: 'cooler' },
  { id: 'coconut', name: 'Hindistan cevizi kreması', icon: '🥥', color: '#f5f1e6', station: 'cooler' },
  { id: 'cranberry', name: 'Kızılcık suyu', icon: '🫐', color: '#b3263f', station: 'cooler' },
  { id: 'peach', name: 'Şeftali püresi', icon: '🍑', color: '#f7a26b', station: 'cooler' },
  { id: 'grenadine', name: 'Nar şurubu', icon: '🍒', color: '#c4122f', station: 'cooler' },
  { id: 'cola', name: 'Kola', icon: '🥤', color: '#3a1d12', station: 'cooler' },
  { id: 'tonic', name: 'Tonik', icon: '🍸', color: '#e9f4f2', station: 'cooler' },
  { id: 'ginger', name: 'Zencefil özü', icon: '🫚', color: '#e0b25a', station: 'cooler' },
  { id: 'espresso', name: 'Espresso', icon: '☕', color: '#3b2314', station: 'cooler' },
  { id: 'tea', name: 'Soğuk demleme çay', icon: '🧋', color: '#a8582a', station: 'cooler' },
  { id: 'grape', name: 'Kırmızı üzüm suyu', icon: '🍇', color: '#6b1638', station: 'cooler' },
  { id: 'whiteGrape', name: 'Beyaz üzüm suyu', icon: '🍈', color: '#e8e2a0', station: 'cooler' },
  { id: 'energy', name: 'Enerji içeceği', icon: '⚡', color: '#d8f03c', station: 'cooler' },
  // Fıçı kulesi
  { id: 'tapLemonade', name: 'Fıçı limonata', icon: '🍋', color: '#f4e27a', station: 'taps' },
  { id: 'tapGinger', name: 'Fıçı zencefilli gazoz', icon: '🫚', color: '#d9a441', station: 'taps' },
  { id: 'tapApple', name: 'Fıçı elma gazozu', icon: '🍏', color: '#e9d36a', station: 'taps' },
]);
export const INGREDIENT_BY_ID = byId(INGREDIENTS);

export const DRINK_CATEGORIES = Object.freeze([
  { id: 'shot', name: 'Şatlar', icon: '🥃', desc: 'Küçük bardakta tek yudum — doğrudan doldur.' },
  { id: 'tap', name: 'Fıçı & Şişe', icon: '🫗', desc: 'Fıçıdan / şişeden bardağa doldur.' },
  { id: 'mocktail', name: 'Kokteyller (alkolsüz)', icon: '🍹', desc: 'Çok malzemeli — çalkala ya da bardakta karıştır.' },
  { id: 'soft', name: 'Soft & Klasikler', icon: '🥤', desc: 'Hızlı ve basit.' },
]);
export const DRINK_CATEGORY_BY_ID = byId(DRINK_CATEGORIES);

/**
 * glass: bardak tipi (görsel / tarif kitabı). like: bilinen bir kokteylin alkolsüz karşılığıysa adı.
 * Fiyat zorluğa göre: basit €8–14, kokteyl €25–40. Bahşiş fiyata ve servis hızına göre (BAR_RULES).
 */
export const DRINKS = Object.freeze([
  // Şatlar
  { id: 'espressoShot', cat: 'shot', name: 'Espresso Shot', icon: '☕', price: 8, ingredients: ['espresso'], shake: false, glass: 'shot', color: '#3b2314' },
  { id: 'gingerShot', cat: 'shot', name: 'Zencefil Shot', icon: '🫚', price: 9, ingredients: ['ginger', 'lemon'], shake: false, glass: 'shot', color: '#e6c75a' },
  { id: 'pomShot', cat: 'shot', name: 'Nar Shot', icon: '🍒', price: 9, ingredients: ['grenadine', 'lime'], shake: false, glass: 'shot', color: '#c4122f' },
  { id: 'vitaminShot', cat: 'shot', name: 'Vitamin Shot', icon: '🍊', price: 10, ingredients: ['orange', 'ginger', 'lemon'], shake: true, glass: 'shot', color: '#f3a83a' },
  // Fıçı & şişe
  { id: 'tapLemonade', cat: 'tap', name: 'Fıçı Limonata', icon: '🍋', price: 8, ingredients: ['tapLemonade'], shake: false, glass: 'pint', color: '#f4e27a' },
  { id: 'gingerBeer', cat: 'tap', name: 'Zencefilli Gazoz', icon: '🫚', price: 9, ingredients: ['tapGinger', 'ice'], shake: false, glass: 'pint', color: '#d9a441' },
  { id: 'appleFizz', cat: 'tap', name: 'Köpüklü Elma', icon: '🍾', price: 12, ingredients: ['tapApple'], shake: false, glass: 'flute', color: '#e9d36a', like: 'Şampanya' },
  { id: 'redGrape', cat: 'tap', name: 'Kırmızı Üzüm Suyu', icon: '🍇', price: 10, ingredients: ['grape'], shake: false, glass: 'wine', color: '#6b1638', like: 'Kırmızı şarap' },
  { id: 'whiteGrape', cat: 'tap', name: 'Beyaz Üzüm Suyu', icon: '🥂', price: 10, ingredients: ['whiteGrape', 'ice'], shake: false, glass: 'wine', color: '#e8e2a0', like: 'Beyaz şarap' },
  // Kokteyller (alkolsüz)
  { id: 'virginMojito', cat: 'mocktail', name: 'Virgin Mojito', icon: '🌿', price: 32, ingredients: ['lime', 'mint', 'sugar', 'soda', 'ice'], shake: false, glass: 'highball', color: '#c9ecb2', like: 'Mojito' },
  { id: 'virginMargarita', cat: 'mocktail', name: 'Virgin Margarita', icon: '🍈', price: 28, ingredients: ['lime', 'orange', 'sugar', 'ice'], shake: true, glass: 'coupe', color: '#e3ef8a', like: 'Margarita' },
  { id: 'pinaColada', cat: 'mocktail', name: 'Virgin Piña Colada', icon: '🍍', price: 30, ingredients: ['pineapple', 'coconut', 'ice'], shake: true, glass: 'highball', color: '#f8eebf', like: 'Piña Colada' },
  { id: 'beachSunset', cat: 'mocktail', name: 'Plaj Günbatımı', icon: '🌅', price: 30, ingredients: ['peach', 'orange', 'cranberry', 'ice'], shake: true, glass: 'highball', color: '#f0743e', like: 'Sex on the Beach' },
  { id: 'longIsland', cat: 'mocktail', name: 'Long Island Buzlu Çay', icon: '🧋', price: 36, ingredients: ['tea', 'lemon', 'cola', 'sugar', 'ice'], shake: false, glass: 'highball', color: '#8a4a22', like: 'Long Island Iced Tea' },
  { id: 'virginSpritz', cat: 'mocktail', name: 'Virgin Spritz', icon: '🍊', price: 26, ingredients: ['orange', 'tonic', 'soda', 'ice'], shake: false, glass: 'wine', color: '#f78a2c', like: 'Aperol Spritz' },
  { id: 'espressoMartini', cat: 'mocktail', name: 'Virgin Espresso Martini', icon: '☕', price: 30, ingredients: ['espresso', 'sugar', 'ice'], shake: true, glass: 'coupe', color: '#4a2a17', like: 'Espresso Martini' },
  { id: 'virginCosmo', cat: 'mocktail', name: 'Virgin Cosmopolitan', icon: '🍸', price: 30, ingredients: ['cranberry', 'lime', 'orange', 'ice'], shake: true, glass: 'coupe', color: '#d64563', like: 'Cosmopolitan' },
  { id: 'tonicLime', cat: 'mocktail', name: 'Tonik & Misket', icon: '🍸', price: 25, ingredients: ['tonic', 'lime', 'ice'], shake: false, glass: 'highball', color: '#e4f3e0', like: 'Gin Tonic' },
  { id: 'gingerSour', cat: 'mocktail', name: 'Zencefil Sour', icon: '🍋', price: 32, ingredients: ['ginger', 'lemon', 'sugar', 'ice'], shake: true, glass: 'coupe', color: '#ecd27a', like: 'Whiskey Sour' },
  { id: 'shirleyTemple', cat: 'mocktail', name: 'Shirley Temple', icon: '🍒', price: 26, ingredients: ['grenadine', 'tapGinger', 'lime', 'ice'], shake: false, glass: 'highball', color: '#e8505b' },
  { id: 'tropicalStorm', cat: 'mocktail', name: 'Tropik Fırtına', icon: '🥥', price: 40, ingredients: ['pineapple', 'orange', 'coconut', 'grenadine', 'ice'], shake: true, glass: 'highball', color: '#f7a64a' },
  // Soft & klasikler (eski 4 içecek de burada)
  { id: 'cola', cat: 'soft', name: 'Kola', icon: '🥤', price: 8, ingredients: ['cola', 'ice'], shake: false, glass: 'highball', color: '#3a1d12' },
  { id: 'orangeJuice', cat: 'soft', name: 'Portakal Suyu', icon: '🍊', price: 8, ingredients: ['orange'], shake: false, glass: 'highball', color: '#f59a23' },
  { id: 'icedTea', cat: 'soft', name: 'Buzlu Çay', icon: '🧋', price: 10, ingredients: ['tea', 'lemon', 'ice'], shake: false, glass: 'highball', color: '#a8582a' },
  { id: 'energy', cat: 'soft', name: 'Enerji İçeceği', icon: '⚡', price: 9, ingredients: ['energy', 'ice'], shake: false, glass: 'highball', color: '#d8f03c' },
  { id: 'sodaLime', cat: 'soft', name: 'Soda & Misket', icon: '🫧', price: 8, ingredients: ['soda', 'lime'], shake: false, glass: 'highball', color: '#dff3dc' },
  { id: 'lemonade', cat: 'soft', name: 'Limonata', icon: '🍋', price: 10, ingredients: ['lemon', 'soda'], shake: false, glass: 'highball', color: '#f4e46c' },
  { id: 'mocktail', cat: 'mocktail', name: 'Çilekli Mocktail', icon: '🍹', price: 25, ingredients: ['strawberry', 'lemon', 'soda'], shake: true, glass: 'coupe', color: '#ef5d6e' },
  { id: 'milkshake', cat: 'soft', name: 'Çilekli Milkshake', icon: '🥤', price: 14, ingredients: ['milk', 'strawberry'], shake: true, glass: 'highball', color: '#f4a7b6' },
  { id: 'chocolate', cat: 'soft', name: 'Sıcak Çikolata', icon: '☕', price: 12, ingredients: ['milk', 'cocoa'], shake: false, glass: 'mug', color: '#7b4a2b' },
]);
export const DRINK_BY_ID = byId(DRINKS);

/** Zorluk: malzeme sayısı + çalkalama (1..6) — sabır süresi ve sipariş ağırlığı için */
export const drinkDifficulty = (d) => d.ingredients.length + (d.shake ? 1 : 0);

/** Sipariş ağırlıkları: basit içecekler daha sık, ama kokteyller de düzenli gelir */
export const ORDER_WEIGHT = Object.freeze({ shot: 0.8, tap: 1.0, mocktail: 0.9, soft: 1.0 });

/** Tarif metni: "🟢 Misket limonu + 🌿 Nane + … · çalkala" */
export function recipeText(d) {
  const parts = d.ingredients.map((i) => `${INGREDIENT_BY_ID[i].icon} ${INGREDIENT_BY_ID[i].name}`);
  return `${parts.join(' + ')}${d.shake ? ' · 🍸 çalkala' : ''}`;
}
