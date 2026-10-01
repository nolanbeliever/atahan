// Minimap & full map rendering on a 2D canvas.

import { CCTV_CAMERAS, cameraYaw } from '../../../shared/cctv';
import { CARRIAGEWAY_EDGE, DRAG_STRIP, JUNCTIONS, JUNCTION_APRON, LOOP_LEN, pathPoint } from '../../../shared/highway';
import { SANAYI } from '../../../shared/sanayiLayout';
import { ROADS, ZONES, PLOTS, PLOT_HALF, BUILDINGS, WORLD_BOUNDS, INTERACTABLES, CITY_HALF } from '../../../shared/world';
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
  drag: '#ff8c1a',
  pawn: '#ff4fd8',
  sanayi: '#ffb020',
};

/** Places with their own map symbol (drawn upright on a round badge). */
const BADGES: Record<string, string> = { sanayi: '🔧', pawn: '$' };

function badge(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, glyph: string, turn: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(-turn);
  g.fillStyle = '#10141c';
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.5, r * 0.22);
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = color;
  g.font = `900 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, 0, r * 0.06);
  g.restore();
}

/** Centreline of the ring highway (computed once). */
const RING: { x: number; z: number }[] = Array.from({ length: 181 }, (_, i) => pathPoint((i / 180) * LOOP_LEN));


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
  g.fillStyle = '#22391f';
  g.fillRect(tx(-W), tz(-W), W * 2 * s, W * 2 * s);
  g.fillStyle = '#26402b';
  g.fillRect(tx(-CITY_HALF), tz(-CITY_HALF), CITY_HALF * 2 * s, CITY_HALF * 2 * s);
  for (const z of ZONES) {
    g.fillStyle = z.color + '38';
    if (z.id === 'sanayi') {
      const y = SANAYI.yard;
      g.fillStyle = '#5a4a3c';
      g.fillRect(tx(y.minX), tz(y.minZ), (y.maxX - y.minX) * s, (y.maxZ - y.minZ) * s);
    } else g.fillRect(tx(z.cx - 44), tz(z.cz - 44), 88 * s, 88 * s);
  }
  // Highway ring, junction roads and the drag strip.
  g.strokeStyle = '#4a4f5c';
  g.lineJoin = 'round';
  for (const j of JUNCTIONS) {
    const a = pathPoint(j.s, -JUNCTION_APRON);
    g.lineWidth = 12 * s;
    g.beginPath();
    g.moveTo(tx(j.cityX), tz(j.cityZ));
    g.lineTo(tx(a.x), tz(a.z));
    g.stroke();
  }
  g.lineWidth = CARRIAGEWAY_EDGE * 2 * s;
  g.beginPath();
  RING.forEach((p, i) => (i === 0 ? g.moveTo(tx(p.x), tz(p.z)) : g.lineTo(tx(p.x), tz(p.z))));
  g.closePath();
  g.stroke();
  g.strokeStyle = 'rgba(242,194,48,0.7)';
  g.lineWidth = Math.max(1, 0.6 * s);
  g.stroke();
  g.fillStyle = '#4a4f5c';
  g.fillRect(tx(DRAG_STRIP.wallX[0]), tz(DRAG_STRIP.wallZ[0]), (DRAG_STRIP.wallX[1] - DRAG_STRIP.wallX[0]) * s, (DRAG_STRIP.wallZ[1] - DRAG_STRIP.wallZ[0]) * s);
  g.fillStyle = '#4a4f5c';
  for (const r of ROADS) g.fillRect(tx(r.minX), tz(r.minZ), (r.maxX - r.minX) * s, (r.maxZ - r.minZ) * s);
  g.fillStyle = '#8d93a3';
  for (const b of BUILDINGS) g.fillRect(tx(b.box.minX), tz(b.box.minZ), (b.box.maxX - b.box.minX) * s, (b.box.maxZ - b.box.minZ) * s);
  // Sanayi: driveway, the hall (open to the north) and the Pawn Shop.
  g.fillStyle = '#4a4f5c';
  g.fillRect(tx(SANAYI.entry.x - SANAYI.entry.width / 2), tz(156), SANAYI.entry.width * s, (SANAYI.yard.minZ + 8 - 156) * s);
  const hall = SANAYI.hall;
  g.fillStyle = '#6b6258';
  g.fillRect(tx(hall.minX), tz(hall.minZ), (hall.maxX - hall.minX) * s, (hall.maxZ - hall.minZ) * s);
  g.strokeStyle = '#8d93a3';
  g.lineWidth = Math.max(1.5, s);
  g.beginPath();
  g.moveTo(tx(hall.minX), tz(hall.minZ));
  g.lineTo(tx(hall.minX), tz(hall.maxZ));
  g.lineTo(tx(hall.maxX), tz(hall.maxZ));
  g.lineTo(tx(hall.maxX), tz(hall.minZ));
  g.stroke();
  g.fillStyle = '#8d93a3';
  g.fillRect(tx(SANAYI.pawn.minX), tz(SANAYI.pawn.minZ), (SANAYI.pawn.maxX - SANAYI.pawn.minX) * s, (SANAYI.pawn.maxZ - SANAYI.pawn.minZ) * s);
  const me = game.store.playerId;
  for (const p of PLOTS) {
    const d = game.store.dealerships.get(p.id);
    g.strokeStyle = d ? (d.ownerId === me ? '#ffc53d' : '#4f8cff') : 'rgba(255,255,255,0.35)';
    g.lineWidth = d?.ownerId === me ? 3 : 1.5;
    g.strokeRect(tx(p.cx - PLOT_HALF), tz(p.cz - PLOT_HALF), PLOT_HALF * 2 * s, PLOT_HALF * 2 * s);
  }
  const turn = yaw !== null ? yaw + Math.PI : 0;
  for (const i of INTERACTABLES) {
    const glyph = BADGES[i.kind];
    if (glyph) {
      badge(g, tx(i.x), tz(i.z), Math.max(7, 3.2 * s), INTERACT_COLORS[i.kind] ?? '#fff', glyph, turn);
      continue;
    }
    g.fillStyle = INTERACT_COLORS[i.kind] ?? '#fff';
    g.beginPath();
    g.arc(tx(i.x), tz(i.z), Math.max(3, 3.2 * s), 0, Math.PI * 2);
    g.fill();
  }
  // CCTV cameras and the cones they watch.
  const now = game.store.serverNow();
  g.fillStyle = 'rgba(255,50,60,0.38)';
  for (const c of CCTV_CAMERAS) {
    const yaw = cameraYaw(c, now);
    g.beginPath();
    g.moveTo(tx(c.x), tz(c.z));
    for (let k = -2; k <= 2; k++) {
      const a = yaw + (c.fov * k) / 2;
      g.lineTo(tx(c.x + Math.sin(a) * c.range), tz(c.z + Math.cos(a) * c.range));
    }
    g.closePath();
    g.fill();
  }
  // Street race: the route (racers, and while it is open) and the start flag.
  const race = game.race.view;
  const route = game.race.route;
  if (race && route) {
    const me = game.race.me();
    if (me || race.phase === 'open') {
      g.save();
      g.strokeStyle = me ? 'rgba(255,211,90,0.9)' : 'rgba(255,138,61,0.7)';
      g.lineWidth = Math.max(2, 1.6 * s);
      g.setLineDash([6, 4]);
      g.beginPath();
      route.points.forEach((p, i) => (i === 0 ? g.moveTo(tx(p.x), tz(p.z)) : g.lineTo(tx(p.x), tz(p.z))));
      g.stroke();
      g.restore();
    }
    if (me && me.place === null && !me.dnf) {
      const cp = route.points[Math.min(me.next, route.points.length - 1)]!;
      g.fillStyle = me.next === route.points.length - 1 ? '#2ee59d' : '#ffd35a';
      g.beginPath();
      g.arc(tx(cp.x), tz(cp.z), Math.max(4, 3.5 * s), 0, Math.PI * 2);
      g.fill();
    }
    if (race.phase === 'open' || race.phase === 'countdown') {
      const st = route.points[0]!;
      badge(g, tx(st.x), tz(st.z), Math.max(8, 3.6 * s), '#ff8a3d', '🏁', turn);
    }
  }
  // Parked cars that can be broken into (flashing red while the alarm sounds).
  const blink = Math.floor(performance.now() / 250) % 2 === 0;
  for (const c of game.store.street.values()) {
    const alarm = game.theft.alarmOn(c.id);
    if (alarm && !blink) continue;
    g.fillStyle = alarm ? '#ff3b4e' : 'rgba(190,150,255,0.85)';
    g.fillRect(tx(c.x) - 2, tz(c.z) - 2, 4, 4);
  }
  // Own vehicles
  for (const e of game.entities.vehicles.values()) {
    if (e.data.ownerId !== me || e.kind !== 'public') continue;
    g.fillStyle = '#ffc53d';
    g.fillRect(tx(e.x) - 2.5, tz(e.z) - 2.5, 5, 5);
  }
  // Highway traffic
  g.fillStyle = 'rgba(230,236,245,0.85)';
  for (const c of game.traffic.cars.values()) g.fillRect(tx(c.x) - 1.5, tz(c.z) - 1.5, 3, 3);
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
  private range = 75;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 220;
    this.canvas.height = 220;
    this.g = this.canvas.getContext('2d')!;
  }

  draw(game: Game, x: number, z: number, yaw: number): void {
    // Zoom out at highway speeds.
    const range = 75 + Math.min(70, Math.abs(game.speed) * 1.6);
    this.range += (range - this.range) * 0.08;
    drawMap(this.g, this.canvas.width, game, x, z, this.range, yaw);
  }
}
