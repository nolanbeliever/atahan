// Bilardo ve bowling için deterministik 2B fizik (sunucu ve istemci AYNI kodu çalıştırır).
// Sunucu atışı simüle edip sonucu (cebe giren toplar / devrilen labutlar) yetkili olarak belirler;
// istemciler aynı başlangıç durumu + aynı başlangıç hızıyla (sunucunun hesapladığı vx, vz) animasyonu
// yeniden oynatır ve sonunda sunucunun son konumlarına oturur. Adım içinde yalnızca + − × ÷ ve sqrt
// kullanılır (trigonometri yok) → her motorda bit düzeyinde aynı sonuç.

const freeze = Object.freeze;

// ---- Bilardo (8-ball) -------------------------------------------------------------------------
// Masa koordinatları: x uzun kenar boyunca 0..L, z 0..W (dünyada masa merkezine göre kaydırılır).

export const POOL = freeze({
  L: 2.24,
  W: 1.12,
  R: 0.028575,
  POCKET_R: 0.064, // top merkezi cep merkezine bu kadar yaklaşınca cebe girer
  MOUTH: 0.11, // cep ağzı: bu yarıçap içinde bant yok
  DECEL: 0.5, // çuha sürtünmesi (m/sn²)
  CUSHION: 0.78,
  BALL_E: 0.94,
  DT: 1 / 240,
  MAX_STEPS: 240 * 18,
  STOP: 0.006,
  MAX_SPEED: 6.0,
  MIN_SPEED: 0.25,
});

export const POOL_POCKETS = freeze([
  freeze([0, 0]), freeze([POOL.L / 2, -0.014]), freeze([POOL.L, 0]),
  freeze([0, POOL.W]), freeze([POOL.L / 2, POOL.W + 0.014]), freeze([POOL.L, POOL.W]),
]);

export const POOL_HEAD = freeze([POOL.L * 0.25, POOL.W / 2]); // beyaz topun yeri
export const POOL_FOOT = freeze([POOL.L * 0.73, POOL.W / 2]); // üçgenin tepesi

/** Standart üçgen: 8 ortada, arka köşelerde bir düz bir parçalı; sıra rng ile karışır */
export function poolRack(rng = Math.random) {
  const R = POOL.R;
  const dx = R * Math.sqrt(3) + 0.0004;
  const slots = [];
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) slots.push([POOL_FOOT[0] + row * dx, POOL_FOOT[1] + (k - row / 2) * (2 * R + 0.0004)]);
  }
  // Yer: 0 tepe, 4 orta (8 numara), 10 ve 14 arka köşeler
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const take = (arr) => arr.splice(Math.floor(rng() * arr.length), 1)[0];
  const order = new Array(15).fill(0);
  order[4] = 8;
  order[10] = take(solids);
  order[14] = take(stripes);
  const rest = [...solids, ...stripes];
  for (let s = 0; s < 15; s++) if (!order[s]) order[s] = take(rest);
  const balls = [{ id: 0, x: POOL_HEAD[0], z: POOL_HEAD[1] }];
  order.forEach((id, s) => balls.push({ id, x: round5(slots[s][0]), z: round5(slots[s][1]) }));
  return balls;
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

/** Atış simülasyonu durumu (adım adım: istemci animasyonu için) */
export function poolSimStart(balls, vx, vz) {
  const st = {
    balls: balls.map((b) => ({ id: b.id, x: b.x, z: b.z, vx: 0, vz: 0, on: true })),
    pocketed: [],
    firstHit: null,
    rails: 0,
    steps: 0,
    done: false,
  };
  const cue = st.balls.find((b) => b.id === 0);
  if (cue) {
    cue.vx = vx;
    cue.vz = vz;
  }
  return st;
}

function inMouth(x, z) {
  const m2 = POOL.MOUTH * POOL.MOUTH;
  for (const p of POOL_POCKETS) {
    const dx = x - p[0];
    const dz = z - p[1];
    if (dx * dx + dz * dz < m2) return true;
  }
  return false;
}

/** Tek fizik adımı; @returns {boolean} hâlâ hareket var mı */
export function poolStep(st) {
  if (st.done) return false;
  const { R, DT, DECEL, CUSHION, BALL_E, L, W } = POOL;
  const balls = st.balls;
  const n = balls.length;
  let moving = false;
  for (let i = 0; i < n; i++) {
    const b = balls[i];
    if (!b.on || (b.vx === 0 && b.vz === 0)) continue;
    b.x += b.vx * DT;
    b.z += b.vz * DT;
    const sp = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    const ns = sp - DECEL * DT;
    if (ns <= POOL.STOP) {
      b.vx = 0;
      b.vz = 0;
    } else {
      const k = ns / sp;
      b.vx *= k;
      b.vz *= k;
      moving = true;
    }
    // Cep
    const p2 = POOL.POCKET_R * POOL.POCKET_R;
    let sunk = false;
    for (const p of POOL_POCKETS) {
      const dx = b.x - p[0];
      const dz = b.z - p[1];
      if (dx * dx + dz * dz < p2) {
        sunk = true;
        break;
      }
    }
    if (sunk) {
      b.on = false;
      b.vx = 0;
      b.vz = 0;
      st.pocketed.push(b.id);
      continue;
    }
    // Bantlar (cep ağzında yok; ağızdan taşan top yine de masada tutulur)
    const mouth = inMouth(b.x, b.z);
    if (!mouth || b.x < -0.05 || b.x > L + 0.05 || b.z < -0.05 || b.z > W + 0.05) {
      if (b.x < R) { b.x = R + (R - b.x); b.vx = -b.vx * CUSHION; b.vz *= 0.97; st.rails++; }
      else if (b.x > L - R) { b.x = (L - R) - (b.x - (L - R)); b.vx = -b.vx * CUSHION; b.vz *= 0.97; st.rails++; }
      if (b.z < R) { b.z = R + (R - b.z); b.vz = -b.vz * CUSHION; b.vx *= 0.97; st.rails++; }
      else if (b.z > W - R) { b.z = (W - R) - (b.z - (W - R)); b.vz = -b.vz * CUSHION; b.vx *= 0.97; st.rails++; }
    }
  }
  // Top–top çarpışmaları (eşit kütle)
  const d2min = 4 * R * R;
  for (let i = 0; i < n; i++) {
    const a = balls[i];
    if (!a.on) continue;
    for (let j = i + 1; j < n; j++) {
      const c = balls[j];
      if (!c.on) continue;
      const dx = a.x - c.x;
      const dz = a.z - c.z;
      const dd = dx * dx + dz * dz;
      if (dd >= d2min || dd === 0) continue;
      const d = Math.sqrt(dd);
      const nx = dx / d;
      const nz = dz / d;
      const push = (2 * R - d) / 2;
      a.x += nx * push;
      a.z += nz * push;
      c.x -= nx * push;
      c.z -= nz * push;
      const rv = (a.vx - c.vx) * nx + (a.vz - c.vz) * nz;
      if (rv < 0) {
        const jm = -(1 + BALL_E) * rv / 2;
        a.vx += jm * nx;
        a.vz += jm * nz;
        c.vx -= jm * nx;
        c.vz -= jm * nz;
        moving = true;
      }
      if (st.firstHit === null) {
        if (a.id === 0) st.firstHit = c.id;
        else if (c.id === 0) st.firstHit = a.id;
      }
    }
  }
  st.steps++;
  if (!moving || st.steps >= POOL.MAX_STEPS) {
    st.done = true;
    for (const b of balls) { b.vx = 0; b.vz = 0; }
  }
  return !st.done;
}

/** Atışı sonuna kadar simüle et */
export function poolSimulate(balls, vx, vz) {
  const st = poolSimStart(balls, vx, vz);
  while (poolStep(st));
  return {
    balls: st.balls.filter((b) => b.on).map((b) => ({ id: b.id, x: round5(b.x), z: round5(b.z) })),
    pocketed: st.pocketed,
    firstHit: st.firstHit,
    steps: st.steps,
  };
}

/** Güç (0..1) → beyaz topun hızı */
export const poolSpeed = (power) => POOL.MIN_SPEED + (POOL.MAX_SPEED - POOL.MIN_SPEED) * power * power;

export const ballGroup = (id) => (id === 0 ? 'cue' : id === 8 ? 'eight' : id < 8 ? 'solid' : 'stripe');

// ---- Bowling ----------------------------------------------------------------------------------
// Kulvar koordinatları: u kulvar boyunca sağa (kulvarın ortası 0), v faul çizgisinden labutlara doğru.

export const BOWL = freeze({
  LANE_W: 1.066,
  BALL_R: 0.109,
  PIN_R: 0.061,
  HEAD_V: 15.0, // baş labut (faul çizgisinden)
  ROW: 0.264,
  SPACING: 0.3048,
  DECK_END: 16.05, // labut alanının sonu (arkası çukur)
  DT: 1 / 240,
  MAX_STEPS: 240 * 7,
  BALL_M: 6.8,
  PIN_M: 1.5,
  E_BALL: 0.62,
  E_PIN: 0.7,
  PIN_DECEL: 2.2,
  KNOCK: 0.3, // bu hıza ulaşan labut devrilmiş sayılır
  MIN_SPEED: 5.0,
  MAX_SPEED: 9.5,
  MAX_ANGLE: 0.07, // rad
  MAX_U: 0.42, // bırakış noktası (kulvar ortasından)
  HOOK: 0.55, // falso: v > 8 m'den sonra yanal ivme (m/sn²) × spin
});

/** 10 labutun yerleri (u, v) — sıra: baş labut, 2–3, 4–6, 7–10 */
export const BOWL_PINS = freeze((() => {
  const out = [];
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k <= row; k++) out.push(freeze([round5((k - row / 2) * BOWL.SPACING), round5(BOWL.HEAD_V + row * BOWL.ROW)]));
  }
  return out;
})());

export const ALL_PINS = 0x3ff;

/** standing: 10 bitlik maske (bit i = labut i ayakta) */
export function bowlSimStart(standing, u0, vu, vv, spin = 0) {
  return {
    ball: { u: u0, v: 0, vu, vv, gutter: false },
    spin,
    pins: BOWL_PINS.map(([u, v], i) => ({ i, u, v, vu: 0, vv: 0, on: (standing >> i) & 1, down: false })),
    steps: 0,
    done: false,
  };
}

/** @returns {boolean} hâlâ hareket var mı */
export function bowlStep(st) {
  if (st.done) return false;
  const { DT, BALL_R, PIN_R, LANE_W, PIN_DECEL, KNOCK } = BOWL;
  const ball = st.ball;
  const half = LANE_W / 2;
  // Top
  if (!ball.gutter && ball.v > 8 && ball.v < BOWL.HEAD_V) ball.vu += st.spin * BOWL.HOOK * DT;
  ball.u += ball.vu * DT;
  ball.v += ball.vv * DT;
  if (!ball.gutter && Math.abs(ball.u) > half - BALL_R * 0.35 && ball.v < BOWL.HEAD_V - 0.2) {
    ball.gutter = true; // oluğa düştü: labutlara değmez
    ball.vu = 0;
    ball.u = ball.u > 0 ? half + 0.12 : -half - 0.12;
  }
  let moving = ball.v < BOWL.DECK_END + 0.6;
  // Labutlar
  const pins = st.pins;
  for (const p of pins) {
    if (!p.on) continue;
    if (p.vu !== 0 || p.vv !== 0) {
      p.u += p.vu * DT;
      p.v += p.vv * DT;
      const sp = Math.sqrt(p.vu * p.vu + p.vv * p.vv);
      const ns = sp - PIN_DECEL * DT;
      if (ns <= 0.01) { p.vu = 0; p.vv = 0; } else { const k = ns / sp; p.vu *= k; p.vv *= k; moving = true; }
      if (p.v > BOWL.DECK_END || Math.abs(p.u) > half + 0.15) p.down = true; // çukura / oluğa düştü
    }
  }
  // Top–labut
  if (!ball.gutter) {
    const rr = BALL_R + PIN_R;
    for (const p of pins) {
      if (!p.on) continue;
      const du = p.u - ball.u;
      const dv = p.v - ball.v;
      const dd = du * du + dv * dv;
      if (dd >= rr * rr || dd === 0) continue;
      const d = Math.sqrt(dd);
      const nu = du / d;
      const nv = dv / d;
      p.u = ball.u + nu * rr;
      p.v = ball.v + nv * rr;
      const rv = (ball.vu - p.vu) * nu + (ball.vv - p.vv) * nv;
      if (rv > 0) {
        const jm = (1 + BOWL.E_BALL) * rv / (1 / BOWL.BALL_M + 1 / BOWL.PIN_M);
        ball.vu -= (jm / BOWL.BALL_M) * nu;
        ball.vv -= (jm / BOWL.BALL_M) * nv;
        p.vu += (jm / BOWL.PIN_M) * nu;
        p.vv += (jm / BOWL.PIN_M) * nv;
        moving = true;
      }
    }
  }
  // Labut–labut
  const pp = 4 * PIN_R * PIN_R;
  for (let a = 0; a < pins.length; a++) {
    const p = pins[a];
    if (!p.on) continue;
    for (let b = a + 1; b < pins.length; b++) {
      const q = pins[b];
      if (!q.on) continue;
      const du = p.u - q.u;
      const dv = p.v - q.v;
      const dd = du * du + dv * dv;
      if (dd >= pp || dd === 0) continue;
      const d = Math.sqrt(dd);
      const nu = du / d;
      const nv = dv / d;
      const push = (2 * PIN_R - d) / 2;
      p.u += nu * push; p.v += nv * push;
      q.u -= nu * push; q.v -= nv * push;
      const rv = (p.vu - q.vu) * nu + (p.vv - q.vv) * nv;
      if (rv < 0) {
        const jm = -(1 + BOWL.E_PIN) * rv / 2;
        p.vu += jm * nu; p.vv += jm * nv;
        q.vu -= jm * nu; q.vv -= jm * nv;
        moving = true;
      }
    }
  }
  for (const p of pins) {
    if (p.on && !p.down && p.vu * p.vu + p.vv * p.vv > KNOCK * KNOCK) p.down = true;
  }
  st.steps++;
  if (!moving || st.steps >= BOWL.MAX_STEPS) st.done = true;
  return !st.done;
}

/** Atışı sonuna kadar simüle et → { knocked: devrilen labut sayısı, standing: kalan maske, steps } */
export function bowlSimulate(standing, u0, vu, vv, spin = 0) {
  const st = bowlSimStart(standing, u0, vu, vv, spin);
  while (bowlStep(st));
  let left = 0;
  let knocked = 0;
  for (const p of st.pins) {
    if (!p.on) continue;
    if (p.down) knocked++;
    else left |= 1 << p.i;
  }
  return { knocked, standing: left, steps: st.steps, gutter: st.ball.gutter };
}

export const bowlSpeed = (power) => BOWL.MIN_SPEED + (BOWL.MAX_SPEED - BOWL.MIN_SPEED) * power;

export function countPins(mask) {
  let n = 0;
  for (let i = 0; i < 10; i++) if ((mask >> i) & 1) n++;
  return n;
}
