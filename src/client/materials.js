// Procedural PBR materials. Every texture is painted at startup on a canvas (no
// downloads), tiled in metres (world UVs) and tinted by vertex colours.
import * as THREE from 'three';
import { mulberry32 } from '../shared/util.js';

let R = mulberry32(99);
const rnd = (a = 0, b = 1) => a + (b - a) * R();
const pick = (a) => a[Math.floor(R() * a.length)];

function canvas(s) { const c = document.createElement('canvas'); c.width = c.height = s; return c; }
function rgba(r, g, b, a = 1) { return `rgba(${r | 0},${g | 0},${b | 0},${a})`; }

function speckle(ctx, s, n, base, spread, size = 2, alpha = 0.5) {
  for (let i = 0; i < n; i++) {
    const v = base + rnd(-spread, spread);
    ctx.fillStyle = rgba(v, v, v, alpha * rnd(0.3, 1));
    const w = rnd(1, size);
    ctx.fillRect(rnd(0, s), rnd(0, s), w, w);
  }
}
function blotch(ctx, s, n, color, rmin, rmax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = rnd(0, s), y = rnd(0, s), r = rnd(rmin, rmax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace('A', alpha * rnd(0.4, 1)));
    g.addColorStop(1, color.replace('A', 0));
    ctx.fillStyle = g;
    // tile-safe: draw wrapped copies
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) { ctx.save(); ctx.translate(ox, oy); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.restore(); }
  }
}
function cracks(ctx, s, n, col, w = 1) {
  ctx.strokeStyle = col; ctx.lineWidth = w;
  for (let i = 0; i < n; i++) {
    let x = rnd(0, s), y = rnd(0, s), a = rnd(0, 6.28);
    ctx.beginPath(); ctx.moveTo(x, y);
    const len = rnd(10, 40);
    for (let k = 0; k < len; k++) { a += rnd(-0.6, 0.6); x += Math.cos(a) * 3; y += Math.sin(a) * 3; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}
function streaks(ctx, s, n, col) {
  for (let i = 0; i < n; i++) {
    const x = rnd(0, s), w = rnd(2, 10), h = rnd(s * 0.2, s * 0.8), y = rnd(-s * 0.2, s * 0.5);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, col.replace('A', 0.25)); g.addColorStop(1, col.replace('A', 0));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
}

const P = {
  asphalt(ctx, s) {
    ctx.fillStyle = '#56575b'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, s * 40, 85, 40, 2, 0.6);
    blotch(ctx, s, 6, 'rgba(20,20,22,A)', s * 0.05, s * 0.25, 0.5);
    blotch(ctx, s, 4, 'rgba(110,108,104,A)', s * 0.05, s * 0.2, 0.25);
    cracks(ctx, s, 5, 'rgba(15,15,15,0.8)', 1.5);
  },
  sidewalk(ctx, s) {
    ctx.fillStyle = '#a9a7a1'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, s * 20, 165, 30, 2, 0.5);
    blotch(ctx, s, 5, 'rgba(60,55,50,A)', s * 0.05, s * 0.2, 0.35);
    ctx.strokeStyle = 'rgba(60,60,60,0.8)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * s / 2, 0); ctx.lineTo(i * s / 2, s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * s / 2); ctx.lineTo(s, i * s / 2); ctx.stroke(); }
    cracks(ctx, s, 3, 'rgba(40,40,40,0.7)', 1);
  },
  concrete(ctx, s, base = 158) {
    ctx.fillStyle = rgba(base, base - 2, base - 6); ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, s * 25, base, 35, 2, 0.4);
    blotch(ctx, s, 8, 'rgba(70,65,55,A)', s * 0.05, s * 0.3, 0.3);
    streaks(ctx, s, 14, 'rgba(50,45,40,A)');
    cracks(ctx, s, 2, 'rgba(50,50,50,0.6)', 1);
    // panel joints
    ctx.fillStyle = 'rgba(60,60,60,0.5)'; ctx.fillRect(0, 0, s, 2); ctx.fillRect(0, 0, 2, s);
  },
  concreteDark(ctx, s) { P.concrete(ctx, s, 110); },
  brick(ctx, s, palette = [[150, 70, 50], [135, 60, 45], [165, 85, 60], [120, 55, 40], [140, 80, 65]], mortar = '#a09888') {
    ctx.fillStyle = mortar; ctx.fillRect(0, 0, s, s);
    const rows = 16, cols = 8, bh = s / rows, bw = s / cols;
    for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
      const off = (r % 2) * bw / 2;
      const [cr, cg, cb] = pick(palette);
      const v = rnd(-15, 15);
      ctx.fillStyle = rgba(cr + v, cg + v, cb + v);
      ctx.fillRect(c * bw + off + 1, r * bh + 1, bw - 2, bh - 2);
    }
    speckle(ctx, s, s * 10, 90, 40, 2, 0.3);
    blotch(ctx, s, 6, 'rgba(30,25,20,A)', s * 0.05, s * 0.3, 0.35);
    streaks(ctx, s, 8, 'rgba(20,20,20,A)');
  },
  brickDark(ctx, s) { P.brick(ctx, s, [[90, 70, 60], [80, 60, 52], [105, 85, 70], [70, 58, 50]], '#7a7268'); },
  plaster(ctx, s) {
    ctx.fillStyle = '#e8e4dc'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, s * 20, 225, 25, 2, 0.4);
    blotch(ctx, s, 8, 'rgba(90,80,65,A)', s * 0.04, s * 0.25, 0.3);
    streaks(ctx, s, 16, 'rgba(60,55,45,A)');
    // peeled patches showing brick
    for (let i = 0; i < 3; i++) {
      const x = rnd(0, s * 0.8), y = rnd(0, s * 0.8), w = rnd(s * 0.05, s * 0.15), h = rnd(s * 0.04, s * 0.1);
      ctx.fillStyle = 'rgba(150,90,70,0.8)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(80,70,60,0.6)'; ctx.strokeRect(x, y, w, h);
    }
    cracks(ctx, s, 3, 'rgba(70,65,60,0.6)', 1);
  },
  siding(ctx, s) {
    ctx.fillStyle = '#e4e0d8'; ctx.fillRect(0, 0, s, s);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const y = i * s / n;
      const g = ctx.createLinearGradient(0, y, 0, y + s / n);
      g.addColorStop(0, 'rgba(255,255,255,0.3)'); g.addColorStop(0.85, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g; ctx.fillRect(0, y, s, s / n);
    }
    blotch(ctx, s, 6, 'rgba(80,90,60,A)', s * 0.05, s * 0.2, 0.25);
    streaks(ctx, s, 10, 'rgba(60,55,45,A)');
  },
  roofTar(ctx, s) { ctx.fillStyle = '#4a4846'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, s * 50, 80, 50, 2, 0.6); blotch(ctx, s, 6, 'rgba(25,25,25,A)', s * 0.05, s * 0.3, 0.5); },
  shingle(ctx, s) {
    ctx.fillStyle = '#909090'; ctx.fillRect(0, 0, s, s);
    const rows = 10, cols = 6;
    for (let r = 0; r < rows; r++) for (let c = -1; c < cols; c++) {
      const v = rnd(110, 170), off = (r % 2) * s / cols / 2;
      ctx.fillStyle = rgba(v, v, v); ctx.fillRect(c * s / cols + off + 1, r * s / rows, s / cols - 2, s / rows - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(c * s / cols + off, r * s / rows + s / rows - 3, s / cols, 3);
    }
    speckle(ctx, s, s * 10, 100, 40, 2, 0.3);
    blotch(ctx, s, 4, 'rgba(60,80,40,A)', s * 0.05, s * 0.2, 0.3);
  },
  metal(ctx, s) {
    ctx.fillStyle = '#d0d0d0'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) { const v = rnd(190, 220); ctx.fillStyle = rgba(v, v, v, 0.5); ctx.fillRect(0, i, s, 1); }
    blotch(ctx, s, 6, 'rgba(90,80,70,A)', s * 0.03, s * 0.15, 0.35);
    ctx.strokeStyle = 'rgba(80,80,80,0.4)';
    for (let i = 0; i < 20; i++) { ctx.beginPath(); const x = rnd(0, s), y = rnd(0, s); ctx.moveTo(x, y); ctx.lineTo(x + rnd(-30, 30), y + rnd(-5, 5)); ctx.stroke(); }
  },
  rust(ctx, s) {
    ctx.fillStyle = '#dcdcdc'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, s * 10, 200, 30, 2, 0.4);
    blotch(ctx, s, 14, 'rgba(140,70,30,A)', s * 0.02, s * 0.15, 0.8);
    blotch(ctx, s, 8, 'rgba(90,40,20,A)', s * 0.02, s * 0.08, 0.7);
    streaks(ctx, s, 12, 'rgba(120,60,20,A)');
  },
  corrugated(ctx, s) {
    ctx.fillStyle = '#d4d4d4'; ctx.fillRect(0, 0, s, s);
    const n = 16;
    for (let i = 0; i < n; i++) {
      const x = i * s / n;
      const g = ctx.createLinearGradient(x, 0, x + s / n, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.5, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, s / n, s);
    }
    blotch(ctx, s, 10, 'rgba(130,65,30,A)', s * 0.02, s * 0.12, 0.6);
    streaks(ctx, s, 12, 'rgba(100,50,20,A)');
  },
  wood(ctx, s, base = [190, 160, 125]) {
    ctx.fillStyle = rgba(...base); ctx.fillRect(0, 0, s, s);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x = i * s / n, v = rnd(-20, 20);
      ctx.fillStyle = rgba(base[0] + v, base[1] + v, base[2] + v); ctx.fillRect(x, 0, s / n - 2, s);
      ctx.strokeStyle = 'rgba(80,50,30,0.25)';
      for (let k = 0; k < 8; k++) { ctx.beginPath(); const gx = x + rnd(0, s / n); ctx.moveTo(gx, 0); ctx.bezierCurveTo(gx + rnd(-6, 6), s / 3, gx + rnd(-6, 6), s * 2 / 3, gx + rnd(-4, 4), s); ctx.stroke(); }
      ctx.fillStyle = 'rgba(40,25,15,0.7)'; ctx.fillRect(x + s / n - 2, 0, 2, s);
    }
    blotch(ctx, s, 5, 'rgba(40,30,20,A)', s * 0.05, s * 0.2, 0.3);
  },
  woodDark(ctx, s) { P.wood(ctx, s, [110, 85, 60]); },
  floorWood(ctx, s) {
    ctx.fillStyle = '#8a6440'; ctx.fillRect(0, 0, s, s);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const y = i * s / n;
      let x = rnd(-s, 0);
      while (x < s) {
        const w = rnd(s * 0.3, s * 0.7), v = rnd(-25, 25);
        ctx.fillStyle = rgba(140 + v, 100 + v, 65 + v); ctx.fillRect(x, y + 1, w - 2, s / n - 2);
        x += w;
      }
    }
    speckle(ctx, s, s * 10, 80, 30, 2, 0.25);
    blotch(ctx, s, 5, 'rgba(30,20,10,A)', s * 0.05, s * 0.2, 0.4);
  },
  tile(ctx, s) {
    ctx.fillStyle = '#9a9c98'; ctx.fillRect(0, 0, s, s);
    const n = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = rnd(215, 235); ctx.fillStyle = rgba(v, v, v - 4); ctx.fillRect(i * s / n + 1, j * s / n + 1, s / n - 2, s / n - 2); }
    blotch(ctx, s, 5, 'rgba(90,80,60,A)', s * 0.05, s * 0.3, 0.3);
    cracks(ctx, s, 1, 'rgba(60,60,60,0.6)', 1);
  },
  tileCheck(ctx, s) {
    const n = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = (i + j) % 2 ? rnd(200, 215) : rnd(120, 135); ctx.fillStyle = rgba(v, v, v); ctx.fillRect(i * s / n, j * s / n, s / n, s / n); }
    ctx.strokeStyle = 'rgba(60,60,60,0.4)';
    for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * s / n, 0); ctx.lineTo(i * s / n, s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * s / n); ctx.lineTo(s, i * s / n); ctx.stroke(); }
    blotch(ctx, s, 6, 'rgba(70,60,45,A)', s * 0.05, s * 0.3, 0.3);
  },
  carpet(ctx, s) { ctx.fillStyle = '#a0a0a8'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, s * 60, 150, 40, 2, 0.5); blotch(ctx, s, 6, 'rgba(60,50,40,A)', s * 0.05, s * 0.25, 0.4); },
  wallInt(ctx, s) {
    ctx.fillStyle = '#ece8e0'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, s * 10, 225, 20, 2, 0.3);
    blotch(ctx, s, 6, 'rgba(110,95,70,A)', s * 0.05, s * 0.3, 0.35);
    streaks(ctx, s, 8, 'rgba(90,80,60,A)');
    // grime band at floor level (v=0 at bottom of each 3m tile)
    const g = ctx.createLinearGradient(0, s, 0, s * 0.8); g.addColorStop(0, 'rgba(60,50,40,0.5)'); g.addColorStop(1, 'rgba(60,50,40,0)');
    ctx.fillStyle = g; ctx.fillRect(0, s * 0.8, s, s * 0.2);
    for (let i = 0; i < 2; i++) { ctx.fillStyle = 'rgba(200,190,170,0.9)'; const x = rnd(0, s), y = rnd(0, s * 0.7); ctx.fillRect(x, y, rnd(10, 30), rnd(8, 20)); }
  },
  fabric(ctx, s) {
    ctx.fillStyle = '#d0d0d0'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) { ctx.fillStyle = `rgba(0,0,0,${rnd(0.02, 0.08)})`; ctx.fillRect(i, 0, 1, s); ctx.fillRect(0, i, s, 1); }
    blotch(ctx, s, 5, 'rgba(70,60,40,A)', s * 0.05, s * 0.2, 0.35);
  },
  solid(ctx, s) { ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, s * 8, 220, 20, 2, 0.3); blotch(ctx, s, 3, 'rgba(80,70,60,A)', s * 0.05, s * 0.2, 0.2); },
  crate(ctx, s) {
    ctx.fillStyle = '#b89a70'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 5; i++) { const v = rnd(-15, 15); ctx.fillStyle = rgba(180 + v, 150 + v, 110 + v); ctx.fillRect(0, i * s / 5 + 2, s, s / 5 - 4); }
    ctx.fillStyle = '#8a6a48'; ctx.fillRect(0, 0, s, s * 0.08); ctx.fillRect(0, s * 0.92, s, s * 0.08); ctx.fillRect(0, 0, s * 0.08, s); ctx.fillRect(s * 0.92, 0, s * 0.08, s);
    ctx.save(); ctx.translate(s / 2, s / 2); ctx.rotate(Math.PI / 4); ctx.fillRect(-s * 0.7, -s * 0.04, s * 1.4, s * 0.08); ctx.restore();
    blotch(ctx, s, 3, 'rgba(50,35,20,A)', s * 0.05, s * 0.2, 0.3);
  },
  sandbag(ctx, s) { ctx.fillStyle = '#c0b088'; ctx.fillRect(0, 0, s, s); for (let i = 0; i < s; i += 3) { ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(i, 0, 1, s); ctx.fillRect(0, i, s, 1); } blotch(ctx, s, 4, 'rgba(70,60,40,A)', s * 0.1, s * 0.3, 0.4); },
  tarp(ctx, s) { ctx.fillStyle = '#d8d8d0'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, s * 10, 200, 30, 3, 0.3); blotch(ctx, s, 5, 'rgba(60,50,40,A)', s * 0.05, s * 0.25, 0.35); },
  grass(ctx, s) {
    ctx.fillStyle = '#4e5a32'; ctx.fillRect(0, 0, s, s);
    blotch(ctx, s, 12, 'rgba(110,90,55,A)', s * 0.05, s * 0.25, 0.6);
    blotch(ctx, s, 10, 'rgba(70,95,40,A)', s * 0.05, s * 0.2, 0.5);
    for (let i = 0; i < s * 30; i++) { const g = rnd(60, 120); ctx.fillStyle = rgba(g * 0.7, g, g * 0.45, 0.6); ctx.fillRect(rnd(0, s), rnd(0, s), 1, rnd(2, 5)); }
  },
  dirt(ctx, s) { ctx.fillStyle = '#6a5a46'; ctx.fillRect(0, 0, s, s); speckle(ctx, s, s * 40, 100, 40, 3, 0.5); blotch(ctx, s, 10, 'rgba(40,32,24,A)', s * 0.05, s * 0.25, 0.4); blotch(ctx, s, 6, 'rgba(80,90,50,A)', s * 0.05, s * 0.15, 0.4); },
};

// alpha decals (unit UVs)
const DECALS = {
  blood(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const a = rnd(0, 6.28), d = i < 4 ? rnd(0, s * 0.08) : rnd(s * 0.05, s * 0.42), r = i < 4 ? rnd(s * 0.12, s * 0.2) : rnd(2, s * 0.05);
      ctx.fillStyle = `rgba(${rnd(70, 110)},${rnd(5, 15)},${rnd(5, 12)},${rnd(0.7, 0.95)})`;
      ctx.beginPath(); ctx.arc(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, r, 0, 7); ctx.fill();
    }
  },
  stain(ctx, s) { ctx.clearRect(0, 0, s, s); const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(10,10,8,0.7)'); g.addColorStop(0.6, 'rgba(15,14,10,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, s, s); },
  puddle(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(15,18,22,0.85)';
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const a = i / 24 * 6.283, r = s * (0.34 + 0.12 * Math.sin(a * 3 + 1) + rnd(-0.03, 0.03)); i ? ctx.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r) : ctx.moveTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); }
    ctx.fill();
  },
  crack(ctx, s) { ctx.clearRect(0, 0, s, s); cracks(ctx, s, 6, 'rgba(10,10,10,0.85)', 2); },
  patch(ctx, s) { ctx.clearRect(0, 0, s, s); ctx.fillStyle = 'rgba(30,30,32,0.85)'; ctx.fillRect(s * 0.1, s * 0.2, s * 0.8, s * 0.6); speckle(ctx, s, 400, 50, 20, 2, 0.5); },
  rug(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    const c = pick(['#7a2a2a', '#2a4a6a', '#5a4a2a', '#3a5a3a']);
    ctx.fillStyle = c; ctx.fillRect(s * 0.02, s * 0.02, s * 0.96, s * 0.96);
    ctx.strokeStyle = 'rgba(220,200,160,0.7)'; ctx.lineWidth = s * 0.03; ctx.strokeRect(s * 0.1, s * 0.1, s * 0.8, s * 0.8);
    ctx.strokeRect(s * 0.25, s * 0.25, s * 0.5, s * 0.5);
    blotch(ctx, s, 4, 'rgba(30,20,10,A)', s * 0.05, s * 0.2, 0.5);
  },
  bodybag(ctx, s) { ctx.clearRect(0, 0, s, s); ctx.fillStyle = 'rgba(25,28,30,0.95)'; ctx.beginPath(); ctx.ellipse(s / 2, s / 2, s * 0.46, s * 0.3, 0, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(120,120,120,0.6)'; ctx.beginPath(); ctx.moveTo(s * 0.1, s / 2); ctx.lineTo(s * 0.9, s / 2); ctx.stroke(); },
  glassShards(ctx, s) { ctx.clearRect(0, 0, s, s); for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(200,220,230,${rnd(0.3, 0.8)})`; const x = rnd(s * 0.1, s * 0.9), y = rnd(s * 0.1, s * 0.9); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rnd(-6, 6), y + rnd(-6, 6)); ctx.lineTo(x + rnd(-6, 6), y + rnd(-6, 6)); ctx.fill(); } },
  helipad(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(230,230,220,0.9)'; ctx.lineWidth = s * 0.04; ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.42, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(230,230,220,0.9)'; ctx.font = `bold ${s * 0.5}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('H', s / 2, s / 2 + s * 0.03);
  },
  poster(ctx, s) {
    ctx.fillStyle = pick(['#d8d0b8', '#c84a3a', '#3a5a8a']); ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#111'; ctx.font = `bold ${s * 0.16}px Arial`; ctx.textAlign = 'center';
    ctx.fillText(pick(['MISSING', 'EVACUATE', 'QUARANTINE', 'STAY INSIDE']), s / 2, s * 0.3);
    ctx.font = `${s * 0.08}px Arial`; ctx.fillText('ZONE 4 · CDC NOTICE', s / 2, s * 0.5);
    blotch(ctx, s, 4, 'rgba(60,50,30,A)', s * 0.1, s * 0.3, 0.4);
  },
  paint(ctx, s) { ctx.fillStyle = 'rgba(230,230,220,0.85)'; ctx.fillRect(0, 0, s, s); for (let i = 0; i < s * 0.8; i++) { ctx.clearRect(rnd(0, s), rnd(0, s), rnd(1, 3), rnd(1, 3)); } },
  paintY(ctx, s) { ctx.fillStyle = 'rgba(220,180,40,0.85)'; ctx.fillRect(0, 0, s, s); for (let i = 0; i < s * 0.8; i++) { ctx.clearRect(rnd(0, s), rnd(0, s), rnd(1, 3), rnd(1, 3)); } },
  fence(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(150,150,145,1)'; ctx.lineWidth = Math.max(1, s / 90);
    const n = 10;
    for (let i = -n; i < 2 * n; i++) { ctx.beginPath(); ctx.moveTo(i * s / n, 0); ctx.lineTo(i * s / n + s, s); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i * s / n, s); ctx.lineTo(i * s / n + s, 0); ctx.stroke(); }
  },
  glass(ctx, s) {
    ctx.fillStyle = 'rgba(160,180,190,0.25)'; ctx.fillRect(0, 0, s, s);
    blotch(ctx, s, 8, 'rgba(90,80,60,A)', s * 0.05, s * 0.3, 0.5);
    cracks(ctx, s, 2, 'rgba(230,240,250,0.6)', 1);
  },
};

const MAT_DEF = {
  asphalt: { tile: 6, rough: 0.92, bump: 1.2 },
  sidewalk: { tile: 3, rough: 0.9, bump: 1 },
  concrete: { tile: 4, rough: 0.92, bump: 1 },
  concreteDark: { tile: 4, rough: 0.9, bump: 1 },
  brick: { tile: 2, rough: 0.9, bump: 2.2 },
  brickDark: { tile: 2, rough: 0.9, bump: 2.2 },
  plaster: { tile: 4, rough: 0.95, bump: 1 },
  siding: { tile: 3, rough: 0.85, bump: 1 },
  roofTar: { tile: 4, rough: 0.95, bump: 1 },
  shingle: { tile: 2, rough: 0.9, bump: 1.5 },
  metal: { tile: 2, rough: 0.55, metal: 0.6 },
  rust: { tile: 2, rough: 0.75, metal: 0.35, bump: 1 },
  corrugated: { tile: 2, rough: 0.6, metal: 0.5, bump: 2 },
  wood: { tile: 1.5, rough: 0.85, bump: 1 },
  woodDark: { tile: 1.5, rough: 0.85, bump: 1 },
  floorWood: { tile: 2, rough: 0.7 },
  tile: { tile: 1.2, rough: 0.45 },
  tileCheck: { tile: 1.2, rough: 0.5 },
  carpet: { tile: 2, rough: 1 },
  wallInt: { tile: 3, rough: 0.95 },
  fabric: { tile: 1, rough: 1 },
  solid: { tile: 1, rough: 0.8 },
  crate: { tile: 1, rough: 0.85 },
  sandbag: { tile: 0.6, rough: 1 },
  tarp: { tile: 2, rough: 0.9, side: THREE.DoubleSide },
  grass: { tile: 4, rough: 1 },
  dirt: { tile: 4, rough: 1 },
};

export class Materials {
  constructor(quality = 'medium', anisotropy = 4) {
    this.q = quality;
    this.size = quality === 'low' ? 128 : quality === 'medium' ? 256 : 512;
    this.aniso = anisotropy;
    this.cache = new Map();
    this.textures = [];
  }
  tex(painter, s, tile, srgb = true) {
    R = mulberry32(s * 31 + painter.name.length * 7 + (painter.name.charCodeAt(0) || 0));
    const c = canvas(s);
    painter(c.getContext('2d'), s);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (tile) t.repeat.set(1 / tile, 1 / tile);
    t.anisotropy = this.aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(t);
    return t;
  }
  get(key) {
    let m = this.cache.get(key);
    if (m) return m;
    m = this.create(key);
    this.cache.set(key, m);
    return m;
  }
  create(key) {
    const bumpOK = this.q !== 'low';
    if (MAT_DEF[key]) {
      const d = MAT_DEF[key];
      const map = this.tex(P[key], this.size, d.tile);
      const m = new THREE.MeshStandardMaterial({ map, roughness: d.rough, metalness: d.metal || 0, vertexColors: true, side: d.side || THREE.FrontSide });
      // Bump mapping is intentionally off: its derivative-based normals can go NaN at
      // grazing angles on large ground planes, and bloom then smears the NaN across the frame.
      void bumpOK;
      m.userData.wet = key === 'asphalt' || key === 'sidewalk' || key === 'roofTar' || key === 'concreteDark';
      m.userData.baseRough = d.rough;
      return m;
    }
    if (key === 'glass' || key === 'glassBlue') {
      const map = this.tex(DECALS.glass, 128, 1.5);
      return new THREE.MeshStandardMaterial({ map, color: key === 'glassBlue' ? 0x5a7a9a : 0x8aa0aa, transparent: true, opacity: key === 'glassBlue' ? 0.65 : 0.45, roughness: 0.15, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide, vertexColors: true });
    }
    if (key === 'fence') {
      const map = this.tex(DECALS.fence, 128, 1, true);
      return new THREE.MeshStandardMaterial({ map, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.6, vertexColors: true });
    }
    if (key === 'frame') return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.4, vertexColors: true });
    if (key === 'paint' || key === 'paintY') {
      const map = this.tex(DECALS[key], 64, 1);
      return new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true });
    }
    if (DECALS[key]) {
      const map = this.tex(DECALS[key], key === 'helipad' || key === 'poster' ? 256 : 128, 0);
      const puddle = key === 'puddle';
      const m = new THREE.MeshStandardMaterial({ map, transparent: true, roughness: puddle ? 0.05 : key === 'blood' ? 0.35 : 0.9, metalness: puddle ? 0.4 : 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, vertexColors: true });
      if (key === 'poster') { m.transparent = false; m.depthWrite = true; }
      return m;
    }
    if (key === 'lamp') return new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffd8a0, emissiveIntensity: 2.2 });
    if (key === 'lampCool') return new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xe0f0ff, emissiveIntensity: 1.6, vertexColors: true });
    if (key === 'emRed') return new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 3 });
    if (key === 'emBlue') return new THREE.MeshStandardMaterial({ color: 0x000022, emissive: 0x2040ff, emissiveIntensity: 3 });
    if (key.startsWith('sign:')) return this.sign(key);
    return new THREE.MeshStandardMaterial({ color: 0xff00ff });
  }
  sign(key) {
    const [, text, col] = key.split(':');
    const c = document.createElement('canvas');
    const w = 512, h = Math.max(64, Math.round(512 / Math.max(3, text.length * 0.62)));
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    R = mulberry32(text.length * 131);
    ctx.fillStyle = col || '#222'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 4; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#f4f0e6';
    let fs = h * 0.62;
    ctx.font = `bold ${fs}px Arial Black, Arial, sans-serif`;
    while (ctx.measureText(text).width > w * 0.9 && fs > 10) { fs -= 2; ctx.font = `bold ${fs}px Arial Black, Arial, sans-serif`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
    // weathering
    blotch(ctx, Math.max(w, h), 8, 'rgba(30,25,20,A)', 10, 60, 0.45);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = 'rgba(20,20,20,0.6)'; ctx.fillRect(rnd(0, w), rnd(0, h), rnd(5, 30), rnd(3, 10)); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.aniso;
    this.textures.push(t);
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.08, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  }
  // wet look when raining: lower roughness on outdoor surfaces
  setWet(w) {
    for (const m of this.cache.values()) if (m.userData.wet) m.roughness = m.userData.baseRough * (1 - 0.55 * w);
  }
  dispose() { for (const t of this.textures) t.dispose(); for (const m of this.cache.values()) m.dispose(); }
}
