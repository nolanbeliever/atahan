import { WALL_H } from '/shared/layout.js';
import { DRINKS, FOOD, INGREDIENTS, INGREDIENT_BY_ID } from '/shared/constants.js';
import { signDrawer, drawSkyline } from './Textures.js';

// Bar De Tulp'un prosedürel dokuları: tabela/menü/etiket atlası ve duvar dokusu.
// Tüm tabelalar TEK atlasta → barSign malzemesi tek draw call.

// ---- Doku atlası ------------------------------------------------------------
// Bölgeler kanvas oranıyla: [x0, y0, x1, y1] (y aşağı doğru)
export const ATLAS = Object.freeze({
  menu: [0, 0, 1, 0.5], // 2:1
  door: [0, 0.5, 0.75, 0.6875], // 4:1
  board: [0.75, 0.5, 1, 0.875], // 2:3 (lobideki ayaklı kara tahta)
  label: (i) => [i * 0.15, 0.6875, (i + 1) * 0.15, 0.8125], // 1.2:1 (dispenser etiketleri)
  tulips: [0, 0.8125, 0.1875, 1],
  canal: [0.1875, 0.8125, 0.375, 1],
  clock: [0.375, 0.8125, 0.5625, 1],
  tag: (i) => [0.5625, 0.8125 + i * 0.09375, 0.75, 0.90625 + i * 0.09375], // 2:1 fiyat kartları
  tiles: [0.75, 0.875, 1, 1], // 2:1 Delft çinileri
});

const CHALK = '#f4efe2';
const CHALK_GOLD = '#ffd27a';
const SERIF = 'Georgia, "Times New Roman", serif';

/** Atlas bölgesine kırpılmış çizim (bölge içinde yerel koordinatlar) */
function inRegion(ctx, W, H, r, fn) {
  const x = r[0] * W;
  const y = r[1] * H;
  const w = (r[2] - r[0]) * W;
  const h = (r[3] - r[1]) * H;
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  fn(w, h);
  ctx.restore();
}

function chalkboard(ctx, w, h, rnd, frame) {
  ctx.fillStyle = '#5a3a22';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#26352e');
  g.addColorStop(1, '#19231f');
  ctx.fillStyle = g;
  ctx.fillRect(frame, frame, w - 2 * frame, h - 2 * frame);
  // Silinmiş tebeşir izleri
  ctx.fillStyle = '#ffffff';
  for (let k = 0; k < 28; k++) {
    ctx.globalAlpha = 0.015 + rnd() * 0.02;
    ctx.beginPath();
    ctx.ellipse(frame + rnd() * (w - 2 * frame), frame + rnd() * (h - 2 * frame), w * (0.04 + rnd() * 0.1), h * (0.02 + rnd() * 0.05), rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function tulipDoodle(ctx, x, y, s, color) {
  ctx.strokeStyle = '#8fd19e';
  ctx.lineWidth = Math.max(1, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x - s * 0.1, y - s * 0.6, x, y - s * 1.1);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.32, y - s * 1.55);
  ctx.lineTo(x - s * 0.16, y - s * 1.3);
  ctx.lineTo(x, y - s * 1.6);
  ctx.lineTo(x + s * 0.16, y - s * 1.3);
  ctx.lineTo(x + s * 0.32, y - s * 1.55);
  ctx.quadraticCurveTo(x + s * 0.34, y - s * 1.05, x, y - s * 1.02);
  ctx.quadraticCurveTo(x - s * 0.34, y - s * 1.05, x - s * 0.32, y - s * 1.55);
  ctx.fill();
}

/** Menü panosu: içecekler (tarifiyle), atıştırmalıklar, fiyatlar */
function drawMenu(ctx, w, h, rnd) {
  chalkboard(ctx, w, h, rnd, h * 0.045);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = CHALK;
  ctx.font = `700 ${Math.round(h * 0.105)}px ${SERIF}`;
  ctx.fillText('Bar De Tulp · Alkolsüz', w / 2, h * 0.15, w * 0.7);
  tulipDoodle(ctx, w * 0.1, h * 0.25, h * 0.11, '#e8505b');
  tulipDoodle(ctx, w * 0.9, h * 0.25, h * 0.11, '#f2c84b');
  ctx.strokeStyle = 'rgba(244,239,226,0.55)';
  ctx.lineWidth = Math.max(1, h * 0.006);
  ctx.setLineDash([h * 0.02, h * 0.015]);
  ctx.beginPath();
  ctx.moveTo(w * 0.18, h * 0.245);
  ctx.lineTo(w * 0.82, h * 0.245);
  ctx.moveTo(w * 0.615, h * 0.3);
  ctx.lineTo(w * 0.615, h * 0.9);
  ctx.stroke();
  ctx.setLineDash([]);

  const row = (y, icon, name, sub, price, x0, x1) => {
    ctx.textAlign = 'center';
    ctx.font = `${Math.round(h * 0.075)}px ${SERIF}`;
    ctx.fillText(icon, x0 + h * 0.045, y);
    ctx.textAlign = 'left';
    ctx.fillStyle = CHALK;
    ctx.font = `600 ${Math.round(h * 0.06)}px ${SERIF}`;
    ctx.fillText(name, x0 + h * 0.11, y - h * 0.012, x1 - x0 - h * 0.3);
    ctx.fillStyle = '#b9d8c3';
    ctx.font = `${Math.round(h * 0.042)}px ${SERIF}`;
    ctx.fillText(sub, x0 + h * 0.11, y + h * 0.046, x1 - x0 - h * 0.3);
    ctx.textAlign = 'right';
    ctx.fillStyle = CHALK_GOLD;
    ctx.font = `700 ${Math.round(h * 0.064)}px ${SERIF}`;
    ctx.fillText(`€${price}`, x1, y);
  };

  // İçecekler (malzeme ikonlarıyla — tarifi panodan okuyabilesin)
  ctx.textAlign = 'left';
  ctx.fillStyle = CHALK_GOLD;
  ctx.font = `italic 700 ${Math.round(h * 0.062)}px ${SERIF}`;
  ctx.fillText('İçecekler', w * 0.06, h * 0.32);
  DRINKS.forEach((d, i) => {
    const recipe = d.ingredients.map((id) => INGREDIENT_BY_ID[id].icon).join(' + ');
    row(h * (0.43 + i * 0.128), d.icon, d.name, d.shake ? `${recipe} · çalkala` : recipe, d.price, w * 0.05, w * 0.585);
  });

  // Atıştırmalıklar
  ctx.textAlign = 'left';
  ctx.fillStyle = CHALK_GOLD;
  ctx.font = `italic 700 ${Math.round(h * 0.062)}px ${SERIF}`;
  ctx.fillText('Atıştırmalık', w * 0.645, h * 0.32);
  FOOD.forEach((f, i) => {
    row(h * (0.43 + i * 0.128), f.icon, f.name, `${f.bites} ısırık`, f.price, w * 0.64, w * 0.94);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = CHALK;
  ctx.font = `italic ${Math.round(h * 0.05)}px ${SERIF}`;
  ctx.fillText('%0 alkol · %100 gezellig', w * 0.79, h * 0.76, w * 0.3);
  ctx.fillStyle = '#b9d8c3';
  ctx.font = `${Math.round(h * 0.042)}px ${SERIF}`;
  ctx.fillText('Barmen sensin! 🍹', w * 0.79, h * 0.84, w * 0.3);
}

/** Lobideki ayaklı kara tahta (2:3) */
function drawBoard(ctx, w, h, rnd) {
  chalkboard(ctx, w, h, rnd, w * 0.07);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = CHALK;
  ctx.font = `700 ${Math.round(w * 0.12)}px ${SERIF}`;
  ctx.fillText('Bar De Tulp', w / 2, h * 0.13, w * 0.8);
  ctx.fillStyle = CHALK_GOLD;
  ctx.font = `italic ${Math.round(w * 0.09)}px ${SERIF}`;
  ctx.fillText('Günün içeceği', w / 2, h * 0.25, w * 0.8);
  ctx.font = `${Math.round(w * 0.24)}px ${SERIF}`;
  ctx.fillText(DRINKS[1].icon, w / 2, h * 0.42);
  ctx.fillStyle = CHALK;
  ctx.font = `600 ${Math.round(w * 0.1)}px ${SERIF}`;
  ctx.fillText(DRINKS[1].name, w / 2, h * 0.58, w * 0.82);
  ctx.fillStyle = CHALK_GOLD;
  ctx.font = `700 ${Math.round(w * 0.14)}px ${SERIF}`;
  ctx.fillText(`€${DRINKS[1].price}`, w / 2, h * 0.7);
  ctx.fillStyle = '#b9d8c3';
  ctx.font = `${Math.round(w * 0.07)}px ${SERIF}`;
  ctx.fillText('alkolsüz · içeride →', w / 2, h * 0.84, w * 0.74);
}

function drawLabel(ctx, w, h, ing) {
  ctx.fillStyle = '#3a2614';
  ctx.fillRect(0, 0, w, h);
  const m = h * 0.07;
  ctx.fillStyle = '#f6efdc';
  ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
  ctx.fillStyle = ing.color;
  ctx.fillRect(m, m, w - 2 * m, h * 0.15);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(h * 0.38)}px ${SERIF}`;
  ctx.fillText(ing.icon, w / 2, h * 0.5);
  ctx.fillStyle = '#2a1d0e';
  ctx.font = `700 ${Math.round(h * 0.15)}px system-ui, sans-serif`;
  ctx.fillText(ing.name, w / 2, h * 0.82, w * 0.88);
}

function drawTag(ctx, w, h, food) {
  ctx.fillStyle = '#3a2614';
  ctx.fillRect(0, 0, w, h);
  const m = h * 0.08;
  ctx.fillStyle = '#f6efdc';
  ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `${Math.round(h * 0.42)}px ${SERIF}`;
  ctx.fillText(food.icon, w * 0.08, h * 0.52);
  ctx.fillStyle = '#2a1d0e';
  ctx.font = `700 ${Math.round(h * 0.26)}px ${SERIF}`;
  ctx.fillText(food.name, w * 0.32, h * 0.36, w * 0.62);
  ctx.fillStyle = '#9c2f2f';
  ctx.font = `700 ${Math.round(h * 0.3)}px ${SERIF}`;
  ctx.fillText(`€${food.price}`, w * 0.32, h * 0.7);
}

/** Eski "Holland" lale tarlası afişi */
function drawTulipPoster(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  sky.addColorStop(0, '#d9a75a');
  sky.addColorStop(1, '#f1d9a0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // Yel değirmeni silueti
  ctx.fillStyle = '#4a3020';
  const cx = w * 0.72;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.06, h * 0.5);
  ctx.lineTo(cx - w * 0.035, h * 0.26);
  ctx.lineTo(cx + w * 0.035, h * 0.26);
  ctx.lineTo(cx + w * 0.06, h * 0.5);
  ctx.fill();
  ctx.save();
  ctx.translate(cx, h * 0.27);
  ctx.rotate(0.3);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.fillRect(-w * 0.012, 0, w * 0.024, h * 0.2);
  }
  ctx.restore();
  // Perspektifli lale sıraları
  const colors = ['#c8202f', '#f2c84b', '#e8709a', '#e36f1e', '#c8202f', '#f2c84b'];
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.moveTo(w * 0.5 + (i - n / 2) * w * 0.02, h * 0.5);
    ctx.lineTo(w * 0.5 + (i + 1 - n / 2) * w * 0.02, h * 0.5);
    ctx.lineTo(w * 0.5 + (i + 1 - n / 2) * w * 0.4, h);
    ctx.lineTo(w * 0.5 + (i - n / 2) * w * 0.4, h);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(40,90,40,0.35)';
  for (let i = 0; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.5 + (i - n / 2) * w * 0.02, h * 0.5);
    ctx.lineTo(w * 0.5 + (i - n / 2) * w * 0.4 - w * 0.03, h);
    ctx.lineTo(w * 0.5 + (i - n / 2) * w * 0.4 + w * 0.03, h);
    ctx.fill();
  }
  ctx.fillStyle = '#2a1d0e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.13)}px ${SERIF}`;
  ctx.fillText('HOLLAND', w * 0.36, h * 0.15, w * 0.6);
  // Yıllanmış vernik
  ctx.fillStyle = 'rgba(110,70,20,0.22)';
  ctx.fillRect(0, 0, w, h);
}

/** Kanal manzarası yağlı boya (yıllanmış) */
function drawCanalPainting(ctx, w, h, rnd) {
  drawSkyline(ctx, w, h * 0.68, rnd);
  const water = ctx.createLinearGradient(0, h * 0.64, 0, h);
  water.addColorStop(0, '#3f6a78');
  water.addColorStop(1, '#22414d');
  ctx.fillStyle = water;
  ctx.fillRect(0, h * 0.64, w, h * 0.36);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  for (let k = 0; k < 18; k++) ctx.fillRect(rnd() * w, h * (0.68 + rnd() * 0.3), w * (0.05 + rnd() * 0.12), Math.max(1, h * 0.008));
  ctx.fillStyle = 'rgba(120,80,30,0.3)';
  ctx.fillRect(0, 0, w, h);
}

function drawClock(ctx, w, h) {
  const r = Math.min(w, h) / 2;
  ctx.fillStyle = '#3a2614';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#f3e9d2';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, r * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(w / 2, h / 2);
  ctx.fillStyle = '#2a1d0e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 0.22)}px ${SERIF}`;
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.fillText(String(i), Math.sin(a) * r * 0.68, -Math.cos(a) * r * 0.68);
  }
  const hand = (a, len, wid) => {
    ctx.save();
    ctx.rotate(a);
    ctx.fillRect(-wid / 2, -len, wid, len + r * 0.08);
    ctx.restore();
  };
  hand((10.2 / 12) * Math.PI * 2, r * 0.42, r * 0.07);
  hand((2 / 12) * Math.PI * 2, r * 0.62, r * 0.045);
  ctx.fillStyle = '#c9a25e';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

function drawDelftTiles(ctx, w, h) {
  const cols = 8;
  const rows = 4;
  const tw = w / cols;
  const th = h / rows;
  ctx.fillStyle = '#c9c6bd';
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = Math.max(1, tw * 0.04);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * tw;
      const y = r * th;
      ctx.fillStyle = '#f4f2ea';
      ctx.fillRect(x + 1, y + 1, tw - 2, th - 2);
      ctx.strokeStyle = '#2b5ea7';
      ctx.fillStyle = '#2b5ea7';
      // Köşe süsleri
      const k = tw * 0.14;
      for (const [cx, cy] of [[x, y], [x + tw, y], [x, y + th], [x + tw, y + th]]) {
        ctx.beginPath();
        ctx.arc(cx, cy, k, 0, Math.PI * 2);
        ctx.fill();
      }
      // Ortada dönüşümlü motif: çiçek / küçük yel değirmeni
      const mx = x + tw / 2;
      const my = y + th / 2;
      ctx.beginPath();
      if ((r + c) % 2 === 0) {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          ctx.moveTo(mx, my);
          ctx.arc(mx + Math.cos(a) * tw * 0.12, my + Math.sin(a) * th * 0.12, tw * 0.09, 0, Math.PI * 2);
        }
        ctx.fill();
      } else {
        ctx.moveTo(mx - tw * 0.1, my + th * 0.25);
        ctx.lineTo(mx - tw * 0.05, my - th * 0.05);
        ctx.lineTo(mx + tw * 0.05, my - th * 0.05);
        ctx.lineTo(mx + tw * 0.1, my + th * 0.25);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(mx - tw * 0.22, my - th * 0.27);
        ctx.lineTo(mx + tw * 0.22, my + th * 0.17);
        ctx.moveTo(mx + tw * 0.22, my - th * 0.27);
        ctx.lineTo(mx - tw * 0.22, my + th * 0.17);
        ctx.stroke();
      }
    }
  }
}

export function drawBarAtlas(ctx, W, H, rnd) {
  ctx.fillStyle = '#3a2614';
  ctx.fillRect(0, 0, W, H);
  inRegion(ctx, W, H, ATLAS.menu, (w, h) => drawMenu(ctx, w, h, rnd));
  inRegion(ctx, W, H, ATLAS.door, (w, h) => signDrawer({
    title: '🍹 BAR De Tulp', sub: 'Alkolsüz · Alcoholvrij', bg: '#2a1a10', fg: '#f6e7c1',
  })(ctx, w, h));
  inRegion(ctx, W, H, ATLAS.board, (w, h) => drawBoard(ctx, w, h, rnd));
  INGREDIENTS.forEach((ing, i) => inRegion(ctx, W, H, ATLAS.label(i), (w, h) => drawLabel(ctx, w, h, ing)));
  FOOD.forEach((f, i) => inRegion(ctx, W, H, ATLAS.tag(i), (w, h) => drawTag(ctx, w, h, f)));
  inRegion(ctx, W, H, ATLAS.tulips, (w, h) => drawTulipPoster(ctx, w, h));
  inRegion(ctx, W, H, ATLAS.canal, (w, h) => drawCanalPainting(ctx, w, h, rnd));
  inRegion(ctx, W, H, ATLAS.clock, (w, h) => drawClock(ctx, w, h));
  inRegion(ctx, W, H, ATLAS.tiles, (w, h) => drawDelftTiles(ctx, w, h));
}

/**
 * Bar duvarı (bir karo = WALL_H x WALL_H, UV.barWall): altta koyu ahşap çerçeveli
 * lambri, üstte tavana doğru koyulaşan "nikotin sarısı" sıva — klasik bruin café.
 */
export function drawBarWall(ctx, w, h, rnd) {
  const yRail = h * (1 - 1.15 / WALL_H); // lambri pervazı 1.15 m
  const plaster = ctx.createLinearGradient(0, 0, 0, yRail);
  plaster.addColorStop(0, '#6f4e2e');
  plaster.addColorStop(0.3, '#9c7142');
  plaster.addColorStop(1, '#b98c55');
  ctx.fillStyle = plaster;
  ctx.fillRect(0, 0, w, yRail);
  // Sıva lekeleri (yatayda döşenebilir: kenardan taşan karşıya da çizilir)
  for (let k = 0; k < 60; k++) {
    const x = rnd() * w;
    const y = rnd() * yRail;
    const r = (0.04 + rnd() * 0.1) * w;
    const tone = rnd() < 0.6 ? '70,40,15' : '255,225,170';
    for (const dx of [-w, 0, w]) {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      g.addColorStop(0, `rgba(${tone},0.09)`);
      g.addColorStop(1, `rgba(${tone},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y - r, 2 * r, 2 * r);
    }
  }
  // Tablo çıtası (2.8 m)
  const yPic = h * (1 - 2.8 / WALL_H);
  ctx.fillStyle = '#3b2414';
  ctx.fillRect(0, yPic, w, Math.max(2, h * 0.012));

  // Lambri: koyu çerçeve + kabartma paneller
  ctx.fillStyle = '#35200f';
  ctx.fillRect(0, yRail, w, h - yRail);
  const n = 5;
  const pw = w / n;
  const lh = h - yRail;
  for (let i = 0; i < n; i++) {
    const x0 = i * pw + pw * 0.11;
    const x1 = (i + 1) * pw - pw * 0.11;
    const y0 = yRail + lh * 0.16;
    const y1 = h - lh * 0.17;
    ctx.fillStyle = '#4e2f19';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#1e1008';
    for (let k = 0; k < 7; k++) ctx.fillRect(x0 + rnd() * (x1 - x0), y0, Math.max(1, w / 300), y1 - y0);
    ctx.globalAlpha = 1;
    const e = Math.max(1, w / 200);
    ctx.fillStyle = 'rgba(255,215,160,0.16)';
    ctx.fillRect(x0, y0, x1 - x0, e);
    ctx.fillRect(x0, y0, e, y1 - y0);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x0, y1 - e, x1 - x0, e);
    ctx.fillRect(x1 - e, y0, e, y1 - y0);
  }
  // Pervaz ve süpürgelik
  ctx.fillStyle = '#26160a';
  ctx.fillRect(0, yRail - h * 0.012, w, h * 0.026);
  ctx.fillStyle = 'rgba(255,215,160,0.22)';
  ctx.fillRect(0, yRail - h * 0.012, w, Math.max(1, h * 0.004));
  ctx.fillStyle = '#1e1108';
  ctx.fillRect(0, h - h * 0.035, w, h * 0.035);
}
