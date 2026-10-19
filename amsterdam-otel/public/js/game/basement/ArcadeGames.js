// Retro atari oyunları (kanvas, 320×240): Neon Yılan, Tuğla Kırıcı, Lale İstilası.
// Her oyun kendi küçük durum makinesidir: step(dt, keys) → puanı günceller, bitince over = true.
// Atari paneli açıkken 3D render tamamen durur; yalnızca bu kanvas kendi rAF döngüsüyle çizilir.

export const ARCADE_W = 320;
export const ARCADE_H = 240;

const NEON = ['#ff2bd6', '#28e7ff', '#ffd23f', '#7cff4f', '#8a5bff', '#ff7a3d'];

function text(g, t, x, y, size = 14, color = '#fff', align = 'center') {
  g.fillStyle = color;
  g.font = `bold ${size}px "Courier New", monospace`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(t, x, y);
}

/** Neon Yılan: ızgarada yılan, elmaları ye, kendine / duvara çarpma */
class Snake {
  constructor() {
    this.cell = 10;
    this.cols = 32;
    this.rows = 22;
    this.body = [[8, 11], [7, 11], [6, 11]];
    this.dir = [1, 0];
    this.next = [1, 0];
    this.acc = 0;
    this.speed = 7;
    this.score = 0;
    this.over = false;
    this.placeFood();
  }

  placeFood() {
    do {
      this.food = [Math.floor(Math.random() * this.cols), Math.floor(Math.random() * this.rows)];
    } while (this.body.some(([x, y]) => x === this.food[0] && y === this.food[1]));
  }

  step(dt, k) {
    if (k.left && this.dir[0] !== 1) this.next = [-1, 0];
    else if (k.right && this.dir[0] !== -1) this.next = [1, 0];
    else if (k.up && this.dir[1] !== 1) this.next = [0, -1];
    else if (k.down && this.dir[1] !== -1) this.next = [0, 1];
    this.acc += dt * this.speed;
    while (this.acc >= 1 && !this.over) {
      this.acc -= 1;
      this.dir = this.next;
      const [hx, hy] = this.body[0];
      const nx = hx + this.dir[0];
      const ny = hy + this.dir[1];
      if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows || this.body.some(([x, y]) => x === nx && y === ny)) {
        this.over = true;
        return;
      }
      this.body.unshift([nx, ny]);
      if (nx === this.food[0] && ny === this.food[1]) {
        this.score += 10;
        this.speed = Math.min(16, this.speed + 0.35);
        this.placeFood();
        this.ate = true;
      } else {
        this.body.pop();
      }
    }
  }

  draw(g) {
    const c = this.cell;
    const oy = 20;
    g.strokeStyle = '#28e7ff';
    g.strokeRect(0.5, oy + 0.5, this.cols * c - 1, this.rows * c - 1);
    g.fillStyle = '#ff2bd6';
    g.fillRect(this.food[0] * c + 2, oy + this.food[1] * c + 2, c - 4, c - 4);
    this.body.forEach(([x, y], i) => {
      g.fillStyle = i === 0 ? '#ffffff' : NEON[3];
      g.fillRect(x * c + 1, oy + y * c + 1, c - 2, c - 2);
    });
  }
}

/** Tuğla Kırıcı: raket + top, 6 sıra tuğla; 3 can, tüm tuğlalar bitince yeni (daha hızlı) seviye */
class Breakout {
  constructor() {
    this.score = 0;
    this.lives = 3;
    this.level = 1;
    this.over = false;
    this.px = 160;
    this.newLevel();
  }

  newLevel() {
    this.bricks = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) this.bricks.push({ x: 4 + c * 31.2, y: 34 + r * 12, alive: true, row: r });
    this.serve();
  }

  serve() {
    this.ball = { x: this.px, y: 200, vx: 90 * (Math.random() < 0.5 ? -1 : 1), vy: -150 - this.level * 20, stuck: true };
  }

  step(dt, k) {
    const sp = 260;
    if (k.left) this.px -= sp * dt;
    if (k.right) this.px += sp * dt;
    if (k.pointer != null) this.px = k.pointer;
    this.px = Math.max(24, Math.min(296, this.px));
    const b = this.ball;
    if (b.stuck) {
      b.x = this.px;
      b.y = 214;
      if (k.fire) b.stuck = false;
      return;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 4 || b.x > 316) { b.vx = -b.vx; b.x = Math.max(4, Math.min(316, b.x)); this.hit = true; }
    if (b.y < 24) { b.vy = Math.abs(b.vy); this.hit = true; }
    if (b.y > 214 && b.y < 224 && Math.abs(b.x - this.px) < 26 && b.vy > 0) {
      b.vy = -Math.abs(b.vy) * 1.02;
      b.vx = (b.x - this.px) * 6;
      this.hit = true;
    }
    if (b.y > 244) {
      this.lives--;
      if (this.lives <= 0) this.over = true;
      else this.serve();
      return;
    }
    for (const br of this.bricks) {
      if (!br.alive || b.x < br.x || b.x > br.x + 29 || b.y < br.y || b.y > br.y + 10) continue;
      br.alive = false;
      b.vy = -b.vy;
      this.score += (6 - br.row) * 5;
      this.hit = true;
      break;
    }
    if (this.bricks.every((br) => !br.alive)) {
      this.level++;
      this.score += 100;
      this.newLevel();
    }
  }

  draw(g) {
    for (const br of this.bricks) {
      if (!br.alive) continue;
      g.fillStyle = NEON[br.row % NEON.length];
      g.fillRect(br.x, br.y, 29, 10);
    }
    g.fillStyle = '#ffffff';
    g.fillRect(this.px - 24, 220, 48, 6);
    g.beginPath();
    g.arc(this.ball.x, this.ball.y, 4, 0, Math.PI * 2);
    g.fill();
    text(g, '♥'.repeat(this.lives), 314, 12, 12, '#ff2bd6', 'right');
    if (this.ball.stuck) text(g, 'BOŞLUK / 🔥: BAŞLAT', 160, 150, 12, '#ffd23f');
  }
}

/** Lale İstilası: aşağı inen lale filosu; gemi ateş eder; 3 can */
class Invaders {
  constructor() {
    this.score = 0;
    this.lives = 3;
    this.over = false;
    this.px = 160;
    this.shots = [];
    this.bombs = [];
    this.cool = 0;
    this.wave = 0;
    this.spawnWave();
  }

  spawnWave() {
    this.wave++;
    this.fleet = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) this.fleet.push({ x: 40 + c * 30, y: 34 + r * 20, alive: true, row: r });
    this.fdx = 22 + this.wave * 6;
  }

  step(dt, k) {
    if (k.left) this.px -= 170 * dt;
    if (k.right) this.px += 170 * dt;
    if (k.pointer != null) this.px = k.pointer;
    this.px = Math.max(12, Math.min(308, this.px));
    this.cool -= dt;
    if (k.fire && this.cool <= 0) {
      this.shots.push({ x: this.px, y: 212 });
      this.cool = 0.38;
      this.fired = true;
    }
    for (const s of this.shots) s.y -= 260 * dt;
    this.shots = this.shots.filter((s) => s.y > 20);
    const alive = this.fleet.filter((f) => f.alive);
    let edge = false;
    for (const f of alive) {
      f.x += this.fdx * dt;
      if (f.x < 12 || f.x > 308) edge = true;
    }
    if (edge) {
      this.fdx = -this.fdx;
      for (const f of alive) f.y += 8;
    }
    if (alive.length && Math.random() < dt * (0.8 + this.wave * 0.3)) {
      const f = alive[Math.floor(Math.random() * alive.length)];
      this.bombs.push({ x: f.x, y: f.y + 6 });
    }
    for (const bm of this.bombs) bm.y += 110 * dt;
    this.bombs = this.bombs.filter((bm) => bm.y < 240);
    for (const s of this.shots) {
      for (const f of alive) {
        if (f.alive && Math.abs(s.x - f.x) < 10 && Math.abs(s.y - f.y) < 8) {
          f.alive = false;
          s.y = -99;
          this.score += (4 - f.row) * 10;
          this.hit = true;
        }
      }
    }
    for (const bm of this.bombs) {
      if (Math.abs(bm.x - this.px) < 11 && bm.y > 208 && bm.y < 224) {
        bm.y = 999;
        this.lives--;
        this.hurt = true;
        if (this.lives <= 0) this.over = true;
      }
    }
    if (alive.some((f) => f.alive && f.y > 200)) this.over = true;
    if (!this.fleet.some((f) => f.alive)) {
      this.score += 150;
      this.spawnWave();
    }
  }

  draw(g) {
    for (const f of this.fleet) {
      if (!f.alive) continue;
      // Lale: üç yaprak + sap
      g.fillStyle = NEON[f.row];
      g.beginPath();
      g.moveTo(f.x - 7, f.y - 4);
      g.lineTo(f.x - 4, f.y + 4);
      g.lineTo(f.x + 4, f.y + 4);
      g.lineTo(f.x + 7, f.y - 4);
      g.lineTo(f.x + 3, f.y);
      g.lineTo(f.x, f.y - 6);
      g.lineTo(f.x - 3, f.y);
      g.closePath();
      g.fill();
      g.fillStyle = '#7cff4f';
      g.fillRect(f.x - 1, f.y + 4, 2, 4);
    }
    g.fillStyle = '#28e7ff';
    g.beginPath();
    g.moveTo(this.px, 208);
    g.lineTo(this.px - 11, 222);
    g.lineTo(this.px + 11, 222);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    for (const s of this.shots) g.fillRect(s.x - 1, s.y - 5, 2, 8);
    g.fillStyle = '#ff7a3d';
    for (const bm of this.bombs) g.fillRect(bm.x - 2, bm.y - 3, 4, 6);
    text(g, '♥'.repeat(this.lives), 314, 12, 12, '#ff2bd6', 'right');
  }
}

const FACTORY = { snake: Snake, breakout: Breakout, invaders: Invaders };

export function makeArcadeGame(id) {
  return new (FACTORY[id] ?? Snake)();
}

/** Ortak çerçeve: arka plan, puan, rekor */
export function drawArcade(g, game, best, title) {
  g.fillStyle = '#05020c';
  g.fillRect(0, 0, ARCADE_W, ARCADE_H);
  // Tarama çizgileri (CRT hissi)
  g.fillStyle = 'rgba(255,255,255,0.03)';
  for (let y = 0; y < ARCADE_H; y += 3) g.fillRect(0, y, ARCADE_W, 1);
  game.draw(g);
  text(g, `PUAN ${game.score}`, 6, 10, 12, '#ffd23f', 'left');
  text(g, `REKOR ${Math.max(best, game.score)}`, 160, 10, 12, '#28e7ff');
  if (game.over) {
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 80, ARCADE_W, 80);
    text(g, 'OYUN BİTTİ', 160, 105, 22, '#ff2bd6');
    text(g, `${title} · ${game.score} puan`, 160, 135, 12, '#ffffff');
  }
}

/** Makine ekranındaki bekleme görüntüsü (dokuya bir kez çizilir) */
export function drawAttract(g, w, h, title, playing, seed = 1) {
  g.fillStyle = '#05020c';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = NEON[(i + seed) % NEON.length];
    g.globalAlpha = 0.5;
    g.fillRect(((i * 37 + seed * 13) % w), ((i * 53 + seed * 7) % (h - 30)) + 20, 6, 6);
  }
  g.globalAlpha = 1;
  text(g, title, w / 2, h * 0.38, Math.round(h * 0.11), '#ffd23f');
  text(g, playing ? '▶ OYUNDA' : 'JETON AT · €1', w / 2, h * 0.68, Math.round(h * 0.09), playing ? '#7cff4f' : '#ff2bd6');
}
