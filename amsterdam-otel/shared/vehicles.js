// Şehir içi ulaşım: satın alınabilir bisiklet ve scooter. Sunucu (doğrulama) ve istemci
// (sürüş fiziği, modeller) AYNI değerleri kullanır.

/**
 * speed: en yüksek hız (m/sn; yürüme 3, koşma 5) · accel: ivme (m/sn²) · turn: dönüş hızı (rad/sn)
 * eye: sürücünün göz yüksekliği · seats: 2 → arkaya bir arkadaş binebilir
 */
export const VEHICLE_TYPES = Object.freeze([
  {
    id: 'bike', name: 'Bisiklet', icon: '🚲', price: 35, to: 'Bisiklete', from: 'Bisikletten', poss: 'bisikleti', speed: 7, accel: 4.5, turn: 2.3, eye: 1.78,
    desc: 'Amsterdam usulü: arkadaki bagaja bir arkadaşın oturur. Sessiz ve çevik.',
    colors: ['#1f4d3a', '#2d4f7c', '#9c2f2f', '#1c1c1f', '#d9a441'],
  },
  {
    id: 'scooter', name: 'Elektrikli scooter', icon: '🛵', price: 60, to: 'Scooter\'a', from: 'Scooter\'dan', poss: 'scooter\'ı', speed: 9.5, accel: 6, turn: 2.0, eye: 1.72,
    desc: 'Uzun selesine iki kişi rahat sığar. Daha hızlı ama daha geniş döner.',
    colors: ['#7fc8c2', '#e36f1e', '#f4f1e8', '#d7263d', '#6a4c93'],
  },
]);
export const VEHICLE_BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(VEHICLE_TYPES.map((v) => [v.id, v]))));

export const VEHICLE_RULES = Object.freeze({
  MOUNT_RANGE: 1.8, // araca binmek için en fazla uzaklık (sunucu + 1 m tolerans)
  REVERSE: 1.6, // geri vites en yüksek hız
  PASSENGER_BACK: 0.55, // yolcu sürücünün bu kadar arkasında oturur
  RIDER_RADIUS: 0.34, // sürerken çarpışma yarıçapı
});

/** Sürücünün konumundan yolcunun konumu (yaw: sürücünün kamera yönü, ileri = (-sin, -cos)) */
export function passengerSeat(x, z, yaw) {
  const b = VEHICLE_RULES.PASSENGER_BACK;
  return { x: x + Math.sin(yaw) * b, z: z + Math.cos(yaw) * b };
}
