// Lüks paketlerin prosedürel dokuları (Canvas, görsel dosya yok). Hepsi TextureFactory ile üretilir:
// uyarlanabilir kalite dokuları küçültünce bunlar da yeniden çizilir. Yalnızca paket ilk kez
// etkinleşince (HotelArchitectureUpgrades) bir kez üretilir — paketsiz otelde hiç bellek harcamaz.

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.min(255, Math.max(0, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Balıksırtı parke (oda zemini) */
export function drawHerringbone(ctx, w, h, rnd, base = '#8a5a34') {
  ctx.fillStyle = shade(base, 0.7);
  ctx.fillRect(0, 0, w, h);
  const n = 4; // döşenebilir: 4 × 4 hücre
  const c = w / n;
  const plankW = c / 2;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * c;
      const y = j * c;
      for (let k = 0; k < 2; k++) {
        ctx.fillStyle = shade(base, 0.85 + rnd() * 0.3);
        if ((i + j) % 2 === 0) ctx.fillRect(x + k * plankW + 1, y + 1, plankW - 2, c - 2);
        else ctx.fillRect(x + 1, y + k * plankW + 1, c - 2, plankW - 2);
      }
    }
  }
  // Damar
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = shade(base, 0.45);
  for (let k = 0; k < 90; k++) ctx.fillRect(rnd() * w, rnd() * h, Math.max(1, w / 90), Math.max(1, h / 400));
  ctx.globalAlpha = 1;
}

/** Damask duvar kâğıdı: koyu krem üzerine altın motif, altta ince bordür */
export function drawDamask(ctx, w, h, rnd, bg = '#e8dcc0', fg = '#b8925a') {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const n = 3;
  const c = w / n;
  ctx.fillStyle = fg;
  ctx.globalAlpha = 0.42;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cx = i * c + (j % 2 ? c / 2 : 0) + c / 4;
      const cy = j * (h / n) + h / n / 2;
      const s = c * 0.22;
      // Stilize damask: dört yaprak + baklava
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 1.4);
      ctx.quadraticCurveTo(cx + s, cy - s * 0.4, cx, cy);
      ctx.quadraticCurveTo(cx - s, cy - s * 0.4, cx, cy - s * 1.4);
      ctx.moveTo(cx, cy + s * 1.4);
      ctx.quadraticCurveTo(cx + s, cy + s * 0.4, cx, cy);
      ctx.quadraticCurveTo(cx - s, cy + s * 0.4, cx, cy + s * 1.4);
      ctx.moveTo(cx - s * 1.1, cy);
      ctx.quadraticCurveTo(cx - s * 0.3, cy - s * 0.6, cx, cy);
      ctx.quadraticCurveTo(cx - s * 0.3, cy + s * 0.6, cx - s * 1.1, cy);
      ctx.moveTo(cx + s * 1.1, cy);
      ctx.quadraticCurveTo(cx + s * 0.3, cy - s * 0.6, cx, cy);
      ctx.quadraticCurveTo(cx + s * 0.3, cy + s * 0.6, cx + s * 1.1, cy);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#000';
  for (let k = 0; k < 40; k++) ctx.fillRect(rnd() * w, 0, Math.max(1, w / 256), h);
  ctx.globalAlpha = 1;
}

/** Lüks koridor halısı: lacivert zemin, altın kenar bandı ve madalyonlar */
export function drawLuxCarpet(ctx, w, h) {
  ctx.fillStyle = '#1d2a4a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c9a25e';
  ctx.lineWidth = Math.max(2, w / 48);
  ctx.globalAlpha = 0.8;
  ctx.strokeRect(w * 0.06, h * 0.06, w * 0.88, h * 0.88);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#c9a25e';
  const r = w * 0.16;
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2 - r); ctx.lineTo(w / 2 + r, h / 2); ctx.lineTo(w / 2, h / 2 + r); ctx.lineTo(w / 2 - r, h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7d2433';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#c9a25e';
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Açık renk tik ahşap güverte (çatı terası) */
export function drawDeck(ctx, w, h, rnd) {
  const rows = 8;
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    ctx.fillStyle = shade('#b98a5a', 0.85 + rnd() * 0.25);
    ctx.fillRect(0, r * rh, w, rh);
    ctx.fillStyle = 'rgba(60,35,15,0.55)';
    ctx.fillRect(0, r * rh, w, Math.max(1, h / 160));
    let x = rnd() * w * 0.4;
    while (x < w) {
      ctx.fillRect(x, r * rh, Math.max(1, w / 200), rh);
      x += w * (0.35 + rnd() * 0.4);
    }
  }
}

/** Havuz suyu (dalgacıklı turkuaz; doku kaydırılarak canlandırılır) */
export function drawPoolWater(ctx, w, h, rnd) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#2fb7d6');
  g.addColorStop(1, '#1f8fc4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = Math.max(1, w / 110);
  for (let k = 0; k < 26; k++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const s = w * (0.05 + rnd() * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + s / 2, y - s * 0.25, x + s, y);
    ctx.stroke();
  }
}

/** Havuz kenarı / fayans (açık mavi karo) */
export function drawPoolTile(ctx, w, h) {
  ctx.fillStyle = '#d9eef4';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#8fc3d6';
  ctx.lineWidth = Math.max(1, w / 64);
  const n = 4;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo((i * w) / n, 0); ctx.lineTo((i * w) / n, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, (i * h) / n); ctx.lineTo(w, (i * h) / n); ctx.stroke();
  }
}

/** Gökdelen cam giydirme cephe: mavi cam, ince alüminyum kayıtlar (1 karo = 1 kat × 2 pencere) */
export function drawCurtainWall(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#5f8fb3');
  g.addColorStop(0.55, '#2f5878');
  g.addColorStop(1, '#3d6d92');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Gökyüzü yansıması
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#e6f2fb';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.1); ctx.lineTo(w * 0.6, 0); ctx.lineTo(w, 0); ctx.lineTo(0, h * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#c9d2d9';
  const m = Math.max(2, w / 40);
  ctx.fillRect(0, 0, w, m); // döşeme bandı
  ctx.fillRect(0, h * 0.82, w, Math.max(2, h * 0.18)); // parapet
  ctx.fillRect(0, 0, m, h);
  ctx.fillRect(w / 2 - m / 2, 0, m, h);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, h * 0.82, w, Math.max(1, h / 64));
}

/** Kitaplık sırtları (Library Lounge): renkli kitaplar, 4 raf */
export function drawBooks(ctx, w, h, rnd) {
  ctx.fillStyle = '#3b2414';
  ctx.fillRect(0, 0, w, h);
  const shelves = 4;
  const sh = h / shelves;
  const colors = ['#7d2433', '#1d3a5a', '#2f5d3a', '#c9a25e', '#5a3a22', '#8a6f3a', '#2b2b2f', '#a8452e', '#e8dcc0'];
  for (let s = 0; s < shelves; s++) {
    let x = w * 0.02;
    const y1 = s * sh + sh * 0.92;
    while (x < w * 0.98) {
      const bw = w * (0.012 + rnd() * 0.018);
      const bh = sh * (0.6 + rnd() * 0.28);
      ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
      ctx.fillRect(x, y1 - bh, bw - 1, bh);
      ctx.fillStyle = 'rgba(230,200,120,0.5)';
      ctx.fillRect(x, y1 - bh * 0.8, bw - 1, Math.max(1, sh / 40));
      x += bw + (rnd() < 0.08 ? w * 0.03 : 0);
    }
    ctx.fillStyle = '#6b4a2c';
    ctx.fillRect(0, y1, w, sh * 0.08);
  }
}

/** Altın harfli tabela (şeffaf zemin): "HOTEL AMSTERDAM ★" */
export function goldLettering(text, { bg = null, color = '#f2c75c', shadow = '#6b4a10', font = 'Georgia, "Times New Roman", serif' } = {}) {
  return (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(h * 0.62)}px ${font}`;
    ctx.fillStyle = shadow;
    ctx.fillText(text, w / 2 + h * 0.03, h / 2 + h * 0.05, w * 0.96);
    const g = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.8);
    g.addColorStop(0, '#fff0b8');
    g.addColorStop(0.5, color);
    g.addColorStop(1, '#b8862e');
    ctx.fillStyle = g;
    ctx.fillText(text, w / 2, h / 2, w * 0.96);
  };
}

/** Alkolsüz meyve suyu menü panosu (lounge ve çatı büfesi) */
export function menuBoard(title, lines, { bg = '#14261c', fg = '#f6e7c1', accent = '#f2c75c' } = {}) {
  return (ctx, w, h) => {
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h);
    const m = Math.max(3, h * 0.04);
    ctx.fillStyle = bg;
    ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent;
    ctx.font = `700 ${Math.round(h * 0.16)}px Georgia, serif`;
    ctx.fillText(title, w / 2, h * 0.17, w * 0.9);
    ctx.fillStyle = fg;
    ctx.font = `${Math.round(h * 0.095)}px system-ui, sans-serif`;
    lines.forEach((t, i) => ctx.fillText(t, w / 2, h * (0.38 + i * 0.15), w * 0.9));
  };
}
