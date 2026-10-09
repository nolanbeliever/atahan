// Misafir rotaları için deterministik yol hesapları.
// Sunucu yalnızca rotayı ve başlangıç zamanını gönderir; istemci konumu
// her karede bu fonksiyonlarla kendisi hesaplar. Böylece hareket eden
// misafirler için saniyede onlarca ağ mesajı göndermeye gerek kalmaz.

export function pathLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return len;
}

/**
 * Yol üzerinde `dist` metre ilerideki noktayı döndürür.
 * `out` nesnesi yeniden kullanılır (her karede çöp üretmemek için).
 */
export function samplePath(path, dist, out = { x: 0, z: 0, dirX: 0, dirZ: 1, done: false }) {
  if (path.length === 1 || dist <= 0) {
    out.x = path[0][0];
    out.z = path[0][1];
    if (path.length > 1) {
      const dx = path[1][0] - path[0][0];
      const dz = path[1][1] - path[0][1];
      const l = Math.hypot(dx, dz) || 1;
      out.dirX = dx / l;
      out.dirZ = dz / l;
    }
    out.done = path.length === 1;
    return out;
  }
  let remaining = dist;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][0], az = path[i - 1][1];
    const dx = path[i][0] - ax, dz = path[i][1] - az;
    const seg = Math.hypot(dx, dz);
    if (seg === 0) continue;
    out.dirX = dx / seg;
    out.dirZ = dz / seg;
    if (remaining <= seg) {
      out.x = ax + out.dirX * remaining;
      out.z = az + out.dirZ * remaining;
      out.done = false;
      return out;
    }
    remaining -= seg;
  }
  const last = path[path.length - 1];
  out.x = last[0];
  out.z = last[1];
  out.done = true;
  return out;
}
