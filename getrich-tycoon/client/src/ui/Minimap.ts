// Minimap & full map rendering on a 2D canvas.

import { ROADS, ZONES, PLOTS, PLOT_HALF, BUILDINGS, WORLD_BOUNDS, INTERACTABLES } from '../../../shared/world';
import type { Game } from '../game/Game';

export const INTERACT_COLORS: Record<string, string> = {
  market: '#f4a261',
  auction: '#c77dff',
  repair: '#e76f51',
  parts: '#e9c46a',
  wash: '#00bbf9',
  fuel: '#ef233c',
  bank: '#2a9d8f',
  custom: '#f15bb5',
};

export function drawMap(g: CanvasRenderingContext2D, size: number, game: Game, cx: number, cz: number, range: number, yaw: number | null): void {
  const s = size / (range * 2);
  const tx = (x: number) => (x - cx) * s + size / 2;
  const tz = (z: number) => (z - cz) * s + size / 2;
  g.save();
  g.clearRect(0, 0, size, size);
  g.fillStyle = '#1d3b24';
  g.fillRect(0, 0, size, size);
  if (yaw !== null) {
    // Rotate so that "forward" points up.
    g.translate(size / 2, size / 2);
    g.rotate(yaw + Math.PI);
    g.translate(-size / 2, -size / 2);
  }
  g.fillStyle = '#2e3440';
  const W = WORLD_BOUNDS;
  g.fillStyle = '#26402b';
  g.fillRect(tx(-W), tz(-W), W * 2 * s, W * 2 * s);
  for (const z of ZONES) {
    g.fillStyle = z.color + '38';
    g.fillRect(tx(z.cx - 44), tz(z.cz - 44), 88 * s, 88 * s);
  }
  g.fillStyle = '#4a4f5c';
  for (const r of ROADS) g.fillRect(tx(r.minX), tz(r.minZ), (r.maxX - r.minX) * s, (r.maxZ - r.minZ) * s);
  g.fillStyle = '#8d93a3';
  for (const b of BUILDINGS) g.fillRect(tx(b.box.minX), tz(b.box.minZ), (b.box.maxX - b.box.minX) * s, (b.box.maxZ - b.box.minZ) * s);
  const me = game.store.playerId;
  for (const p of PLOTS) {
    const d = game.store.dealerships.get(p.id);
    g.strokeStyle = d ? (d.ownerId === me ? '#ffc53d' : '#4f8cff') : 'rgba(255,255,255,0.35)';
    g.lineWidth = d?.ownerId === me ? 3 : 1.5;
    g.strokeRect(tx(p.cx - PLOT_HALF), tz(p.cz - PLOT_HALF), PLOT_HALF * 2 * s, PLOT_HALF * 2 * s);
  }
  for (const i of INTERACTABLES) {
    g.fillStyle = INTERACT_COLORS[i.kind] ?? '#fff';
    g.beginPath();
    g.arc(tx(i.x), tz(i.z), Math.max(3, 3.2 * s), 0, Math.PI * 2);
    g.fill();
  }
  // Own vehicles
  for (const e of game.entities.vehicles.values()) {
    if (e.data.ownerId !== me || e.kind !== 'public') continue;
    g.fillStyle = '#ffc53d';
    g.fillRect(tx(e.x) - 2.5, tz(e.z) - 2.5, 5, 5);
  }
  // NPC customers
  g.fillStyle = '#ffd166';
  for (const n of game.entities.npcs.values()) {
    const l = n.buffer.latest;
    if (l) g.fillRect(tx(l.x) - 1.5, tz(l.z) - 1.5, 3, 3);
  }
  // Other players
  for (const [id, e] of game.entities.players) {
    if (id === me) continue;
    const l = e.buffer.latest;
    if (!l) continue;
    g.fillStyle = '#4f8cff';
    g.beginPath();
    g.arc(tx(l.x), tz(l.z), 4, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // Me (always centred when rotating)
  const pos = game.position();
  const mx = yaw !== null ? size / 2 : tx(pos.x);
  const mz = yaw !== null ? size / 2 : tz(pos.z);
  g.save();
  g.translate(mx, mz);
  g.rotate(yaw !== null ? yaw - pos.rot : Math.PI - pos.rot);
  g.fillStyle = '#2ee59d';
  g.strokeStyle = '#06241a';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, -8);
  g.lineTo(6, 6);
  g.lineTo(0, 3);
  g.lineTo(-6, 6);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 220;
    this.canvas.height = 220;
    this.g = this.canvas.getContext('2d')!;
  }

  draw(game: Game, x: number, z: number, yaw: number): void {
    drawMap(this.g, this.canvas.width, game, x, z, 75, yaw);
  }
}
