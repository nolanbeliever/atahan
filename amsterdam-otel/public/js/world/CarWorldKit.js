import * as THREE from 'three';

// Garaj ve drag pisti için küçük prosedürel doku / tabela yardımcıları (Canvas, tek seferlik).
// Dokular bir kez çizilir; sahnede yalnızca birleştirilmiş statik mesh'ler kullanır.

/** Tekrarlanan (repeat) kanvas dokusu */
export function canvasTexture(w, h, draw, { repeat = true, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 2;
  return t;
}

/** Basit sözde rastgele (aynı doku her açılışta aynı) */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Beton: lekeli gri, ince çatlaklar */
export function drawConcrete(base = '#8d8f91', seed = 7, stains = 0.25) {
  return (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = Math.floor(r() * 40 - 20);
      g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 400})`;
      g.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
    }
    for (let i = 0; i < 6; i++) {
      const grd = g.createRadialGradient(r() * w, r() * h, 2, r() * w, r() * h, 20 + r() * 50);
      grd.addColorStop(0, `rgba(30,28,25,${stains * r()})`);
      grd.addColorStop(1, 'rgba(30,28,25,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }
    g.strokeStyle = 'rgba(40,40,40,0.25)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, w - 1, h - 1); // döşeme derzi
  };
}

/** Asfalt: koyu, taneli */
export function drawAsphalt(base = '#3a3c3f', seed = 3) {
  return (g, w, h) => {
    const r = rng(seed);
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const v = r();
      g.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.12})` : `rgba(0,0,0,${v * 0.18})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
  };
}

/** Sarı-siyah ikaz şeridi */
export function drawHazard(g, w, h) {
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#16181b';
  for (let x = -h; x < w + h; x += h) {
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x + h / 2, h);
    g.lineTo(x + h, 0);
    g.lineTo(x + h / 2, 0);
    g.closePath();
    g.fill();
  }
}

/** Satranç (bitiş) deseni */
export function drawChecker(g, w, h) {
  const n = 8;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4';
    g.fillRect((i * w) / n, (j * h) / n, w / n, h / n);
  }
}

/** Tabela malzemesi: satırlar (ilk satır büyük). emissive: ışıklı tabela (MeshBasic) */
export function signMaterial(lines, { bg = '#1b2430', fg = '#ffffff', w = 512, h = 160, border = true, glow = false, font = 'system-ui, sans-serif' } = {}) {
  const tex = canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (border) {
      g.strokeStyle = fg;
      g.lineWidth = Math.max(4, h * 0.035);
      g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
    }
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((t, i) => {
      const big = i === 0;
      g.font = `800 ${Math.round(h * (lines.length === 1 ? 0.55 : big ? 0.36 : 0.2))}px ${font}`;
      g.fillText(t, w / 2, h * ((i + 0.5) / lines.length) * (lines.length === 1 ? 1 : 0.92) + (lines.length === 1 ? 0 : h * 0.04), w * 0.92);
    });
  }, { repeat: false });
  return glow ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ map: tex });
}

/** Düzlem tabela (facing: 'z+' | 'z-' | 'x+' | 'x-' | 'up') */
export function panel(mat, w, h, x, y, z, facing = 'z+') {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  if (facing === 'up') m.rotation.x = -Math.PI / 2;
  else m.rotation.y = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 }[facing];
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}
