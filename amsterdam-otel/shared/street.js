// Achterstraat Cadde İmparatorluğu (Street Monopoly): caddedeki dükkânlar, fiyatlar, günlük kiralar,
// "Achterstraat King" unvanı ve otel prestij bonusu. Sunucu (StreetMonopolyService) ve istemci
// (StreetMonopoly.js: cepheler, kapıdan satın alma, telefon + Resepsiyon PC "Achterstraat Real Estate") AYNI
// tabloyu kullanır. Yerleşim: shared/layout.js ALLEY (eski kısım) + ALLEY_EAST (Achterstraat Oost).
//
//   z=33 ┌─[🎵 Platenzaak]─[☕ 't Hoekje]─[🍟 Frietkot]─┐
//        geçit                                  ⛽ │ Tankstation (doğu ucu)
//   z=26 └─[🛒 Buurtsuper]─[🧀 Kaas]─[💐 Bloem]─[🚲 Fiets]┘
//      x=18                                         x=44
// Eski Achterstraat'ta (otelin doğusundaki komşu binalar) ☕ Koffiehuis De Vos ve 🥐 Bakkerij.

/**
 * side: 'S' güney sıra (cephe kuzeye bakar), 'N' kuzey sıra (güneye bakar), 'E' doğu ucu (batıya bakar).
 * x0..x1: cephe genişliği (E için z0..z1), door: kapının ortası (S/N: x, E: z), point: kapının önü (etkileşim).
 * price: oyuncunun kişisel cüzdanından bir kez; rent: her oyun günü başında sahibinin cüzdanına.
 * Satın alınan dükkân oyuncunundur ama tabelası otelin markasına geçer ("… · by Hotel De Tulp").
 */
export const STREET_PROPS = Object.freeze([
  {
    id: 'koffie', name: 'Koffiehuis De Vos', type: 'Kafe', icon: '☕', price: 6000, rent: 420,
    area: 'Achterstraat', side: 'S', x0: 8.1, x1: 11.6, door: 10.0, point: [10.0, 26.95], awning: '#2f6b3a', tint: '#7a3a2a', top: 7.0, old: true,
  },
  {
    id: 'bakkerij', name: 'Bakkerij Brood & Zo', type: 'Fırın', icon: '🥐', price: 5500, rent: 380,
    area: 'Achterstraat', side: 'S', x0: 11.6, x1: 15.0, door: 13.6, point: [13.2, 27.0], awning: '#b5603a', tint: '#7f8a78', top: 7.8, old: true,
  },
  {
    id: 'super', name: 'Buurtsuper Achterstraat', type: 'Bakkal', icon: '🛒', price: 8000, rent: 560,
    area: 'Achterstraat Oost', side: 'S', x0: 18.1, x1: 22.8, door: 21.6, point: [21.6, 26.95], awning: '#c8382a', tint: '#8e4a32', top: 7.4,
  },
  {
    id: 'kaas', name: 'Kaashandel Gouda', type: 'Peynirci', icon: '🧀', price: 7000, rent: 480,
    area: 'Achterstraat Oost', side: 'S', x0: 22.8, x1: 27.4, door: 26.2, point: [26.2, 26.95], awning: '#e8a42a', tint: '#d8cbb0', top: 6.8,
  },
  {
    id: 'bloem', name: 'Bloemenwinkel Tulpje', type: 'Çiçekçi', icon: '💐', price: 4500, rent: 300,
    area: 'Achterstraat Oost', side: 'S', x0: 27.4, x1: 32.0, door: 30.8, point: [30.8, 26.95], awning: '#d6457a', tint: '#5e3326', top: 7.6,
  },
  {
    id: 'fiets', name: 'Fietsenmaker Wiel', type: 'Bisiklet tamircisi', icon: '🚲', price: 5000, rent: 340,
    area: 'Achterstraat Oost', side: 'S', x0: 32.0, x1: 37.0, door: 35.6, point: [35.6, 26.95], awning: '#2d4f7c', tint: '#a7764f', top: 7.0,
  },
  {
    id: 'platen', name: 'Platenzaak Vinyl', type: 'Plak dükkânı', icon: '🎵', price: 6500, rent: 440,
    area: 'Achterstraat Oost', side: 'N', x0: 18.1, x1: 24.4, door: 19.6, point: [19.6, 32.05], awning: '#3a2a4a', tint: '#3c3a38', top: 7.2,
  },
  {
    id: 'hoekje', name: "Café 't Hoekje", type: 'Kafe', icon: '☕', price: 9000, rent: 640,
    area: 'Achterstraat Oost', side: 'N', x0: 24.4, x1: 30.7, door: 25.9, point: [25.9, 32.05], awning: '#1f5a5a', tint: '#b5603a', top: 7.8,
  },
  {
    id: 'friet', name: 'Frietkot Patat', type: 'Patates kızartmacı', icon: '🍟', price: 5500, rent: 390,
    area: 'Achterstraat Oost', side: 'N', x0: 30.7, x1: 37.0, door: 32.2, point: [32.2, 32.05], awning: '#f2c14e', tint: '#e4dac2', top: 6.9,
  },
  {
    id: 'tank', name: 'Tankstation Achterstraat', type: 'Benzinlik', icon: '⛽', price: 18000, rent: 1300,
    area: 'Achterstraat Oost', side: 'E', x0: 27.2, x1: 31.8, door: 29.5, point: [42.9, 29.5], awning: '#d7263d', tint: '#e9e6df', top: 4.2,
  },
]);
export const STREET_PROP_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(STREET_PROPS.map((p) => [p.id, p]))));

export const STREET_RULES = Object.freeze({
  RANGE: 2.0, // dükkân kapısına en fazla uzaklık (sunucu +1 m gecikme toleransı ekler)
  KING_TITLE: 'Achterstraat King',
  KING_REPUTATION: 200, // tek seferlik itibar (prestij)
  KING_ROOM_PRICE: 1.1, // kalıcı: oda ücretleri +%10
  BRAND: 'Hotel De Tulp',
});

export const STREET_TOTAL_PRICE = STREET_PROPS.reduce((a, p) => a + p.price, 0);
export const STREET_TOTAL_RENT = STREET_PROPS.reduce((a, p) => a + p.rent, 0);

/** Geri dönüş süresi (oyun günü) */
export const paybackDays = (p) => Math.ceil(p.price / p.rent);
