import * as THREE from 'three';

// Tüm dokular Canvas ile PROSEDÜREL üretilir: indirilecek görsel dosyası yok
// (mobil veri + pil tasarrufu) ve çözünürlük cihaza göre seçilebilir.
// Doku çözünürlüğü çalışma anında yarıya indirilebilir (uyarlanabilir kalite).

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TextureFactory {
  constructor(size, anisotropy) {
    this.size = size;
    this.anisotropy = anisotropy;
    this.entries = [];
  }

  /**
   * @param draw  (ctx, w, h, rnd) => void
   * @param opt   { w: genişlik çarpanı, h: yükseklik çarpanı, repeat: döşenebilir mi, seed }
   */
  make(draw, { w = 1, h = 1, repeat = true, seed = 1, minSize = 32 } = {}) {
    const tex = new THREE.CanvasTexture(document.createElement('canvas'));
    tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
    }
    tex.anisotropy = this.anisotropy;
    const entry = { tex, draw, w, h, seed, minSize };
    this.paint(entry);
    this.entries.push(entry);
    return tex;
  }

  paint(entry) {
    const cw = Math.max(entry.minSize, Math.round(this.size * entry.w));
    const ch = Math.max(entry.minSize, Math.round(this.size * entry.h));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    entry.draw(ctx, cw, ch, mulberry32(entry.seed));
    entry.tex.image = canvas;
    entry.tex.needsUpdate = true;
  }

  /** Tüm dokuları yeni çözünürlükte yeniden çizer (GPU belleği serbest kalır) */
  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    for (const e of this.entries) {
      e.tex.dispose();
      this.paint(e);
    }
  }
}

// ---------------------------------------------------------------------------
// Çizim fonksiyonları
// ---------------------------------------------------------------------------

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/** Siyah-beyaz mermer dama (klasik Amsterdam kanal evi zemini) — 2x2 karo */
export function drawMarble(ctx, w, h, rnd) {
  const t = w / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#202228' : '#ebe6dc';
      ctx.fillRect(i * t, j * t, t, t);
    }
  }
  ctx.lineWidth = Math.max(1, w / 220);
  for (let k = 0; k < 9; k++) {
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = rnd() < 0.5 ? '#8f897d' : '#5a5e68';
    ctx.beginPath();
    ctx.moveTo(rnd() * w, rnd() * h);
    ctx.bezierCurveTo(rnd() * w, rnd() * h, rnd() * w, rnd() * h, rnd() * w, rnd() * h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, w / 180);
  ctx.strokeRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(t, 0); ctx.lineTo(t, h);
  ctx.moveTo(0, t); ctx.lineTo(w, t);
  ctx.stroke();
}

/** Ahşap parke */
export function drawPlanks(ctx, w, h, rnd, base = '#9a6a3f') {
  const rows = 6;
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    ctx.fillStyle = shade(base, 0.82 + rnd() * 0.3);
    ctx.fillRect(0, y, w, rh);
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = shade(base, 0.6);
    for (let k = 0; k < 6; k++) ctx.fillRect(0, y + rnd() * rh, w, Math.max(1, h / 256));
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(40,24,12,0.55)';
    ctx.fillRect(0, y, w, Math.max(1, h / 200));
    let x = rnd() * w * 0.5;
    while (x < w) {
      ctx.fillRect(x, y, Math.max(1, w / 220), rh);
      x += w * (0.4 + rnd() * 0.45);
    }
  }
}

/** Koridor halısı: bordo üzerine altın baklava deseni */
export function drawCarpet(ctx, w, h) {
  ctx.fillStyle = '#6e1b28';
  ctx.fillRect(0, 0, w, h);
  const n = 4;
  const c = w / n;
  ctx.fillStyle = '#c99a3c';
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cx = i * c + c / 2;
      const cy = j * c + c / 2;
      const s = c * 0.22;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy); ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = '#2a0a10';
  ctx.lineWidth = Math.max(1, w / 128);
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(i * c, 0); ctx.lineTo(i * c, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * c); ctx.lineTo(w, i * c); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Krem çizgili duvar kâğıdı */
export function drawWallpaper(ctx, w, h) {
  ctx.fillStyle = '#efe4cc';
  ctx.fillRect(0, 0, w, h);
  const n = 6;
  const sw = w / n;
  ctx.fillStyle = '#e2d3b3';
  for (let i = 0; i < n; i++) ctx.fillRect(i * sw, 0, sw * 0.42, h);
  ctx.fillStyle = 'rgba(160,120,70,0.25)';
  const r = Math.max(1, w / 128);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.beginPath();
      ctx.arc(i * sw + sw * 0.71, (j + 0.5) * (h / 4), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Amsterdam tuğlası */
export function drawBrick(ctx, w, h, rnd) {
  ctx.fillStyle = '#c4b49b';
  ctx.fillRect(0, 0, w, h);
  const rows = 8;
  const cols = 4;
  const bh = h / rows;
  const bw = w / cols;
  const m = Math.max(1, w / 128);
  const palette = ['#8a3b24', '#7a3320', '#94452b', '#6e2f1e', '#843a26'];
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let c = -1; c < cols; c++) {
      ctx.fillStyle = palette[Math.floor(rnd() * palette.length)];
      ctx.fillRect(c * bw + off + m / 2, r * bh + m / 2, bw - m, bh - m);
    }
  }
}

/** Arnavut kaldırımı */
export function drawCobble(ctx, w, h, rnd) {
  ctx.fillStyle = '#4c4a47';
  ctx.fillRect(0, 0, w, h);
  const rows = 6;
  const cols = 6;
  const sh = h / rows;
  const sw = w / cols;
  const g = Math.max(1, w / 90);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * sw * 0.5;
    for (let c = 0; c < cols; c++) {
      const tone = 0.85 + rnd() * 0.3;
      ctx.fillStyle = shade('#8a867f', tone);
      const x = c * sw + off;
      for (const dx of [0, -w]) {
        ctx.beginPath();
        // roundRect eski Safari'de yok → düz dikdörtgene geri düş
        if (ctx.roundRect) ctx.roundRect(x + dx + g, r * sh + g, sw - 2 * g, sh - 2 * g, sh * 0.3);
        else ctx.rect(x + dx + g, r * sh + g, sw - 2 * g, sh - 2 * g);
        ctx.fill();
      }
    }
  }
}

/** Mobilya ahşabı */
export function drawWood(ctx, w, h, rnd) {
  ctx.fillStyle = '#7a4f2e';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.18;
  for (let k = 0; k < 26; k++) {
    ctx.fillStyle = rnd() < 0.5 ? '#4a2d17' : '#a06a3e';
    ctx.fillRect(0, rnd() * h, w, Math.max(1, h / (60 + rnd() * 80)));
  }
  ctx.globalAlpha = 1;
}

/** Kanal evleri silueti (pencere manzarası ve arka plan için) — 2:1 */
export function drawSkyline(ctx, w, h, rnd) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#9cc6e6');
  sky.addColorStop(1, '#dcebf6');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const colors = ['#5b3a29', '#7a2e22', '#2f3b3d', '#e9e1d0', '#3d4a3a', '#8c5a3c', '#a63d2f', '#433531', '#d9cdb4', '#1f3b5a'];
  const ground = h * 0.94;
  let x = 0;
  while (x < w - 1) {
    let hw = w * (0.07 + rnd() * 0.05);
    if (w - (x + hw) < w * 0.06) hw = w - x; // son ev tam otursun (kesintisiz tekrar)
    const top = h * (0.28 + rnd() * 0.2);
    const color = colors[Math.floor(rnd() * colors.length)];
    const light = color === '#e9e1d0' || color === '#d9cdb4';
    ctx.fillStyle = color;
    ctx.fillRect(x, top, hw, ground - top);
    // Çatı (kademeli / boyunlu / üçgen)
    const type = Math.floor(rnd() * 3);
    const gh = h * 0.08;
    ctx.beginPath();
    if (type === 0) {
      const s = hw / 6;
      ctx.moveTo(x, top);
      ctx.lineTo(x, top - gh * 0.33); ctx.lineTo(x + s, top - gh * 0.33);
      ctx.lineTo(x + s, top - gh * 0.66); ctx.lineTo(x + 2 * s, top - gh * 0.66);
      ctx.lineTo(x + 2 * s, top - gh); ctx.lineTo(x + 4 * s, top - gh);
      ctx.lineTo(x + 4 * s, top - gh * 0.66); ctx.lineTo(x + 5 * s, top - gh * 0.66);
      ctx.lineTo(x + 5 * s, top - gh * 0.33); ctx.lineTo(x + hw, top - gh * 0.33);
      ctx.lineTo(x + hw, top);
    } else if (type === 1) {
      ctx.moveTo(x + hw * 0.15, top);
      ctx.quadraticCurveTo(x + hw * 0.3, top - gh * 0.4, x + hw * 0.32, top - gh);
      ctx.lineTo(x + hw * 0.68, top - gh);
      ctx.quadraticCurveTo(x + hw * 0.7, top - gh * 0.4, x + hw * 0.85, top);
    } else {
      ctx.moveTo(x, top);
      ctx.lineTo(x + hw / 2, top - gh);
      ctx.lineTo(x + hw, top);
    }
    ctx.closePath();
    ctx.fill();
    // Pencereler
    const cols = hw > w * 0.09 ? 3 : 2;
    const ww = hw / (cols * 2 + 1);
    const rowsN = Math.max(2, Math.floor((ground - top) / (h * 0.11)));
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = x + ww * (1 + c * 2);
        const wy = top + h * 0.04 + r * ((ground - top - h * 0.06) / rowsN);
        ctx.fillStyle = light ? '#3b3b3b' : '#f3efe6';
        ctx.fillRect(wx - 1, wy - 1, ww + 2, h * 0.07 + 2);
        ctx.fillStyle = '#2d3e4e';
        ctx.fillRect(wx + 1, wy + 1, ww - 2, h * 0.07 - 2);
      }
    }
    // Ev ayırıcı
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, top, Math.max(1, w / 400), ground - top);
    x += hw;
  }
  ctx.fillStyle = '#56544f';
  ctx.fillRect(0, ground, w, h - ground);
}

/** Delft mavisi yel değirmeni tablosu (çerçeveli) */
export function drawWindmill(ctx, w, h) {
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(0, 0, w, h);
  const b = w * 0.06;
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(b, b, w - 2 * b, h - 2 * b);
  const blue = '#1f4e9c';
  ctx.strokeStyle = blue;
  ctx.fillStyle = blue;
  ctx.lineWidth = Math.max(1, w / 100);
  ctx.strokeRect(b * 1.6, b * 1.6, w - b * 3.2, h - b * 3.2);
  const gy = h * 0.74;
  ctx.beginPath();
  ctx.moveTo(b * 1.6, gy);
  ctx.quadraticCurveTo(w * 0.5, gy - h * 0.05, w - b * 1.6, gy);
  ctx.stroke();
  // Değirmen gövdesi
  const cx = w * 0.42;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.07, gy - h * 0.01);
  ctx.lineTo(cx - w * 0.04, h * 0.36);
  ctx.lineTo(cx + w * 0.04, h * 0.36);
  ctx.lineTo(cx + w * 0.07, gy - h * 0.01);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, h * 0.36, w * 0.045, Math.PI, 0);
  ctx.fill();
  // Kanatlar
  ctx.save();
  ctx.translate(cx, h * 0.38);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.fillRect(-w * 0.008, 0, w * 0.016, h * 0.26);
    ctx.strokeRect(w * 0.008, h * 0.06, w * 0.05, h * 0.19);
  }
  ctx.restore();
  // Laleler
  for (let i = 0; i < 9; i++) {
    const tx = w * 0.62 + (i % 3) * w * 0.08;
    const ty = gy + h * 0.05 + Math.floor(i / 3) * h * 0.05;
    ctx.beginPath();
    ctx.moveTo(tx, ty); ctx.lineTo(tx, ty - h * 0.04); ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx, ty - h * 0.05, w * 0.014, 0, Math.PI * 2);
    ctx.fill();
  }
  // Kuşlar
  ctx.beginPath();
  for (const [bx, by] of [[0.66, 0.24], [0.74, 0.3], [0.7, 0.18]]) {
    ctx.moveTo(w * bx - w * 0.02, h * by);
    ctx.quadraticCurveTo(w * bx - w * 0.01, h * by - h * 0.015, w * bx, h * by);
    ctx.quadraticCurveTo(w * bx + w * 0.01, h * by - h * 0.015, w * bx + w * 0.02, h * by);
  }
  ctx.stroke();
}

/** Metin tabelası çizer (döşenmez) */
export function signDrawer({ title, sub = '', bg = '#1f4d3a', fg = '#f6e7c1', border = '#c9a25e' }) {
  return (ctx, w, h) => {
    ctx.fillStyle = border;
    ctx.fillRect(0, 0, w, h);
    const m = Math.max(2, h * 0.07);
    ctx.fillStyle = bg;
    ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hasSub = !!sub;
    ctx.font = `700 ${Math.round(h * (hasSub ? 0.42 : 0.55))}px Georgia, "Times New Roman", serif`;
    ctx.fillText(title, w / 2, h * (hasSub ? 0.42 : 0.53), w * 0.92);
    if (hasSub) {
      ctx.font = `italic ${Math.round(h * 0.2)}px Georgia, serif`;
      ctx.fillText(sub, w / 2, h * 0.77, w * 0.9);
    }
  };
}

/** Karakter altına yumuşak gölge lekesi (blob shadow) — sabit 64px */
export function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
