// 2B (XZ düzlemi) çember – eksene hizalı kutu çarpışması.
// Fizik motoru yok: ~100 kutu için birkaç çarpma/toplama, karede ihmal edilebilir maliyet.

const STEP = 0.12; // tünellemeyi önlemek için alt adım uzunluğu (duvar kalınlığı 0.2)

export class Collision {
  constructor() {
    this.boxes = [];
  }

  /** @returns {{minX,maxX,minZ,maxZ,enabled}} sonradan açılıp kapatılabilir kutu */
  add(minX, maxX, minZ, maxZ, enabled = true) {
    const b = { minX, maxX, minZ, maxZ, enabled };
    this.boxes.push(b);
    return b;
  }

  /** Merkez + yarıçapla küçük engel (saksı, direk vb.) */
  addAround(x, z, half) {
    return this.add(x - half, x + half, z - half, z + half);
  }

  move(pos, dx, dz, radius) {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / STEP));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      pos.x += sx;
      pos.z += sz;
      this.resolve(pos, radius);
    }
  }

  resolve(pos, r) {
    const r2 = r * r;
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < this.boxes.length; i++) {
        const b = this.boxes[i];
        if (!b.enabled) continue;
        const cx = pos.x < b.minX ? b.minX : pos.x > b.maxX ? b.maxX : pos.x;
        const cz = pos.z < b.minZ ? b.minZ : pos.z > b.maxZ ? b.maxZ : pos.z;
        const ox = pos.x - cx;
        const oz = pos.z - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 >= r2) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          pos.x = cx + (ox / d) * r;
          pos.z = cz + (oz / d) * r;
        } else {
          // Merkez kutunun içinde: en yakın kenardan dışarı it
          const left = pos.x - b.minX;
          const right = b.maxX - pos.x;
          const back = pos.z - b.minZ;
          const front = b.maxZ - pos.z;
          const m = Math.min(left, right, back, front);
          if (m === left) pos.x = b.minX - r;
          else if (m === right) pos.x = b.maxX + r;
          else if (m === back) pos.z = b.minZ - r;
          else pos.z = b.maxZ + r;
        }
      }
    }
  }
}
