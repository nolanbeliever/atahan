// Minimap & full map rendering on a 2D canvas.

import { CCTV_CAMERAS, cameraYaw } from '../../../shared/cctv';
import { CARRIAGEWAY_EDGE, DRAG_STRIP, JUNCTIONS, JUNCTION_APRON, LOOP_LEN, pathPoint } from '../../../shared/highway';
import { SANAYI } from '../../../shared/sanayiLayout';
import { ALLEYS, alleyMouths } from '../../../shared/alleys';
import { HEISTS } from '../../../shared/heists';
import { BURGLARY_TARGETS } from '../../../shared/burglary';
import { VILLAS } from '../../../shared/compounds';
import { GANG_ZONES, PLAYER_ZONE_COLOR } from '../../../shared/gangs';
import { DEPOT, DOCK_CONTAINERS, containerDoor, gateBarricades } from '../../../shared/docks';
import { POLICE_STATIONS } from '../../../shared/police';
import { findDrop } from '../../../shared/telegram';
import { ROADS, ZONES, PLOTS, PLOT_HALF, BUILDINGS, INTERACTABLES, CITY_HALF } from '../../../shared/world';
import { BOULEVARD, CONTAINER_STACKS, DOCKS, DOCKS_GATE, DOCKS_ROAD, HILL, TOUGE_HALF, TOUGE_PATH } from '../../../shared/farShore';
import { BRIDGES, BRIDGE_HALF, FAR_ROADS, WATER, WORLD_BOX } from '../../../shared/strait';
import { SHOWROOMS, findShowroom } from '../../../shared/showrooms';
import { ANPR_CAMERAS, TOLL_PLAZAS } from '../../../shared/tolls';
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
  ammu: '#e63946',
  hospital: '#ff5c7a',
  motogear: '#ff7a1a',
  realestate: '#ff8a5c',
};

/** Places with their own map symbol (drawn upright on a round badge). */
const BADGES: Record<string, string> = { sanayi: '🔧', pawn: '$', ammu: '🔫', hospital: '✚', motogear: '⛑', realestate: '🏢' };

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
  const W = WORLD_BOX;
  g.fillStyle = '#22391f';
  g.fillRect(tx(W.minX), tz(W.minZ), (W.maxX - W.minX) * s, (W.maxZ - W.minZ) * s);
  // The strait (it runs off the map north and south).
  g.fillStyle = '#1d4f7a';
  g.fillRect(tx(WATER.west), tz(W.minZ - 400), (WATER.east - WATER.west) * s, (W.maxZ - W.minZ + 800) * s);
  g.fillRect(tx(WATER.east), tz(W.maxZ), 1400 * s, 600 * s);
  // The far shore: the hill (shaded), the docks yard, the roads, the touge.
  const hill = g.createRadialGradient(tx(HILL.x), tz(HILL.z), 0, tx(HILL.x), tz(HILL.z), HILL.rx * s);
  hill.addColorStop(0, '#5d6b45');
  hill.addColorStop(1, 'rgba(93,107,69,0)');
  g.fillStyle = hill;
  g.beginPath();
  g.ellipse(tx(HILL.x), tz(HILL.z), HILL.rx * s, HILL.rz * s, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5c5e63';
  g.fillRect(tx(DOCKS.minX), tz(DOCKS.minZ), (DOCKS.maxX - DOCKS.minX) * s, (DOCKS.maxZ - DOCKS.minZ) * s);
  g.fillStyle = '#4a4f5c';
  for (const r of [...FAR_ROADS, BOULEVARD, DOCKS_ROAD, DOCKS_GATE]) g.fillRect(tx(r.minX), tz(r.minZ), (r.maxX - r.minX) * s, (r.maxZ - r.minZ) * s);
  g.fillStyle = '#b5532f';
  for (const c of CONTAINER_STACKS) g.fillRect(tx(c.minX), tz(c.minZ), (c.maxX - c.minX) * s, (c.maxZ - c.minZ) * s);
  g.save();
  g.strokeStyle = '#4a4f5c';
  g.lineWidth = Math.max(2, TOUGE_HALF * 2 * s);
  g.lineJoin = 'round';
  g.beginPath();
  TOUGE_PATH.forEach((p, i) => (i === 0 ? g.moveTo(tx(p.x), tz(p.z)) : g.lineTo(tx(p.x), tz(p.z))));
  g.stroke();
  g.restore();
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
  // The bridges over the highway and the water: decks with their towers.
  for (const b of BRIDGES) {
    g.fillStyle = '#5b6170';
    g.fillRect(tx(b.x0), tz(b.z - BRIDGE_HALF), (b.x1 - b.x0) * s, BRIDGE_HALF * 2 * s);
    g.fillStyle = '#e8e2d4';
    for (const x of b.towers) for (const side of [-1, 1]) g.fillRect(tx(x) - 2, tz(b.z + side * (BRIDGE_HALF + 2)) - 2, 4, 4);
  }
  g.fillStyle = '#4a4f5c';
  g.fillRect(tx(DRAG_STRIP.wallX[0]), tz(DRAG_STRIP.wallZ[0]), (DRAG_STRIP.wallX[1] - DRAG_STRIP.wallX[0]) * s, (DRAG_STRIP.wallZ[1] - DRAG_STRIP.wallZ[0]) * s);
  g.fillStyle = '#4a4f5c';
  for (const r of ROADS) g.fillRect(tx(r.minX), tz(r.minZ), (r.maxX - r.minX) * s, (r.maxZ - r.minZ) * s);
  g.fillStyle = '#8d93a3';
  for (const b of BUILDINGS) g.fillRect(tx(b.box.minX), tz(b.box.minZ), (b.box.maxX - b.box.minX) * s, (b.box.maxZ - b.box.minZ) * s);
  for (const v of VILLAS) g.fillRect(tx(v.box.minX), tz(v.box.minZ), (v.box.maxX - v.box.minX) * s, (v.box.maxZ - v.box.minZ) * s);
  // Gang territories: the zone in its holder's colour (the gang's, or purple once a player holds it),
  // the name and a dominance bar (the holder's control; a war: how far the attacker has got).
  const turn0 = yaw === null ? 0 : yaw + Math.PI;
  for (const z of GANG_ZONES) {
    const v = game.gangs.zones.find((q) => q.id === z.id);
    const color = v?.owner ? PLAYER_ZONE_COLOR : z.color;
    const b = z.box;
    const pulse = v?.war || v?.attackUntil ? 0.12 + 0.1 * Math.sin(performance.now() / 160) : 0.12;
    g.save();
    g.globalAlpha = pulse;
    g.fillStyle = color;
    g.fillRect(tx(b.minX), tz(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    g.globalAlpha = 0.85;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.5, 1.2 * s);
    g.setLineDash([Math.max(3, 5 * s), Math.max(2, 3 * s)]);
    g.strokeRect(tx(b.minX), tz(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
    g.setLineDash([]);
    g.restore();
    // Label and dominance bar at the zone's middle (upright on a rotating map).
    const cx2 = tx((b.minX + b.maxX) / 2);
    const cz2 = tz((b.minZ + b.maxZ) / 2);
    if (size >= 300 || (b.maxX - b.minX) * s > 60) {
      g.save();
      g.translate(cx2, cz2);
      g.rotate(-turn0);
      const w = Math.max(54, Math.min(110, (b.maxX - b.minX) * s * 0.6));
      g.fillStyle = 'rgba(8,10,16,0.75)';
      g.fillRect(-w / 2 - 4, -16, w + 8, 26);
      g.fillStyle = color;
      g.font = `900 ${size >= 300 ? 11 : 9}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${z.name} · ${v?.owner ? v.ownerName ?? 'Oyuncu' : z.gang}`, 0, -8);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(-w / 2, 2, w, 5);
      g.fillStyle = PLAYER_ZONE_COLOR;
      g.fillRect(-w / 2, 2, (w * (v?.dominance ?? 0)) / 100, 5);
      g.restore();
    }
  }
  // The back alleys (bikes and ATVs only): an orange dashed line through the block.
  g.strokeStyle = '#ff9a3c';
  g.lineWidth = Math.max(1.5, 1.6 * s);
  g.setLineDash([Math.max(2, 3 * s), Math.max(2, 2 * s)]);
  for (const a of ALLEYS) {
    const [m0, m1] = alleyMouths(a, 0);
    g.beginPath();
    g.moveTo(tx(m0.x), tz(m0.z));
    g.lineTo(tx(m1.x), tz(m1.z));
    g.stroke();
  }
  g.setLineDash([]);
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
  // Toll plazas (a green bar across the road) and the number-plate cameras (red dots).
  for (const p of TOLL_PLAZAS) {
    g.fillStyle = '#2bff88';
    g.fillRect(tx(p.x - 1.5), tz(p.z - 13), 3 * s, 26 * s);
  }
  g.fillStyle = '#ff3b30';
  for (const c of ANPR_CAMERAS) {
    g.beginPath();
    g.arc(tx(c.x), tz(c.z), Math.max(2, 1.6 * s), 0, Math.PI * 2);
    g.fill();
  }
  // The showrooms on the Galeri Bulvarı, in their theme colours.
  for (const sr of SHOWROOMS) {
    g.fillStyle = sr.theme.main;
    g.fillRect(tx(sr.box.minX), tz(sr.box.minZ), (sr.box.maxX - sr.box.minX) * s, (sr.box.maxZ - sr.box.minZ) * s);
    g.strokeStyle = sr.theme.accent;
    g.lineWidth = Math.max(1.5, s * 0.8);
    g.strokeRect(tx(sr.box.minX), tz(sr.box.minZ), (sr.box.maxX - sr.box.minX) * s, (sr.box.maxZ - sr.box.minZ) * s);
  }
  const me = game.store.playerId;
  for (const p of PLOTS) {
    const d = game.store.dealerships.get(p.id);
    g.strokeStyle = d ? (d.ownerId === me ? '#ffc53d' : '#4f8cff') : 'rgba(255,255,255,0.35)';
    g.lineWidth = d?.ownerId === me ? 3 : 1.5;
    g.strokeRect(tx(p.cx - PLOT_HALF), tz(p.cz - PLOT_HALF), PLOT_HALF * 2 * s, PLOT_HALF * 2 * s);
  }
  const turn = yaw !== null ? yaw + Math.PI : 0;
  for (const i of INTERACTABLES) {
    // The hitman's alley stays off the map.
    if (i.kind === 'hitman') continue;
    const sr = findShowroom(i.showroomId);
    if (sr) {
      badge(g, tx(i.x), tz(i.z), Math.max(7, 3.2 * s), sr.theme.accent, sr.id === 'blackmarket' ? '☠' : '🚗', turn);
      continue;
    }
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
  // A hitman contract: the venue or the search area, a pulsing red circle.
  const job = game.store.contract;
  if (job) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    g.save();
    g.fillStyle = `rgba(255,50,60,${0.12 + 0.1 * pulse})`;
    g.strokeStyle = 'rgba(255,70,85,0.95)';
    g.lineWidth = 2;
    g.setLineDash(job.kind === 'hit' ? [5, 4] : []);
    g.beginPath();
    g.arc(tx(job.x), tz(job.z), Math.max(8, job.radius * s), 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
    badge(g, tx(job.x), tz(job.z), Math.max(8, 3.6 * s), '#ff4655', '🎯', turn);
  }
  // Heist targets: a money bag (red, flashing, while the alarm rings); the docks for the showroom job.
  const ring = Math.floor(performance.now() / 300) % 2 === 0;
  for (const hs of HEISTS) {
    const alarm = game.heistAlarms.has(hs.id);
    badge(g, tx(hs.door.x), tz(hs.door.z), Math.max(6, 2.8 * s), alarm && ring ? '#ff3b47' : '#b8901e', '💰', turn);
  }
  // The docks: the robbable containers (green: can be cut now), my import's container, the depot
  // while I carry a load, the trap's barricades.
  for (const k of DOCK_CONTAINERS) {
    const v = game.docks.state?.containers.find((c) => c.id === k.id);
    const mine = game.docks.orders.orders.some((o) => o.containerId === k.id && o.status === 'ready');
    g.fillStyle = mine ? '#ffb020' : v?.open ? '#555b63' : v?.ready ? '#2ee59d' : '#ff3040';
    g.fillRect(tx(k.box.minX), tz(k.box.minZ), Math.max(3, (k.box.maxX - k.box.minX) * s), Math.max(2, (k.box.maxZ - k.box.minZ) * s));
    if (mine) {
      const d = containerDoor(k);
      badge(g, tx(d.x), tz(d.z), Math.max(8, 3.4 * s), '#ffb020', '📦', turn);
    }
  }
  if (game.docks.orders.orders.some((o) => o.status === 'loaded')) badge(g, tx(DEPOT.x), tz(DEPOT.z), Math.max(9, 4 * s), '#ffb020', '🏭', turn);
  const trap = game.docks.state?.ambush;
  if (trap) {
    g.fillStyle = '#ff2030';
    for (const b of gateBarricades()) if (trap.barricades.includes(b.id)) g.fillRect(tx(b.x) - 2, tz(b.z) - 2, 4, 4);
  }
  // The gangs' hangouts (a flag in the holder's colour).
  for (const z of GANG_ZONES) {
    const v = game.gangs.zones.find((q) => q.id === z.id);
    badge(g, tx(z.venue.door.x), tz(z.venue.door.z), Math.max(6, 2.8 * s), v?.owner ? PLAYER_ZONE_COLOR : z.color, v?.war ? '⚔' : '⚑', turn);
  }
  // Night burglaries: an open lock on the places that can be done tonight; red while one rings.
  const night = game.burglary.night();
  for (const t of BURGLARY_TARGETS) {
    const v = game.burglary.targets.find((x) => x.id === t.id);
    if (v?.alarm) badge(g, tx(t.door.x), tz(t.door.z), Math.max(6, 2.8 * s), ring ? '#ff3b47' : '#7a0010', '🚨', turn);
    else if (night) badge(g, tx(t.door.x), tz(t.door.z), Math.max(6, 2.6 * s), v && v.readyAt > game.store.serverNow() ? '#5b6472' : '#2ee59d', '🔓', turn);
  }
  // Telegram: the deal cars waiting for me, my orders' dead drops.
  for (const c of game.dealCars.mine()) badge(g, tx(c.x), tz(c.z), Math.max(8, 3.4 * s), c.kind === 'supplier' ? '#8a5cff' : '#2aa3df', c.kind === 'supplier' ? '📦' : '🤝', turn);
  for (const o of game.store.tg?.orders ?? []) {
    const d = o.status === 'drop' && o.dropId ? findDrop(o.dropId) : undefined;
    if (d) badge(g, tx(d.x), tz(d.z), Math.max(8, 3.4 * s), '#ff8a3d', '📍', turn);
  }
  const hv = game.ui?.heist.current;
  if (hv?.drop) badge(g, tx(hv.drop.x), tz(hv.drop.z), Math.max(9, 4 * s), '#ffc53d', '🏁', turn);
  // The police stations, and the taped-off crime scenes.
  for (const st of POLICE_STATIONS) badge(g, tx((st.box.minX + st.box.maxX) / 2), tz((st.box.minZ + st.box.maxZ) / 2), Math.max(8, 3.6 * s), '#3b7bff', '🚓', turn);
  for (const v of game.crimeScenes.list()) badge(g, tx(v.x), tz(v.z), Math.max(8, 3.4 * s), '#ffd400', '🚧', turn);
  // Police checkpoints (a dog's head where there's a K9 unit).
  for (const v of game.trafficStops.list()) badge(g, tx(v.x), tz(v.z), Math.max(8, 3.4 * s), '#2ee59d', v.k9 ? '🐕' : '🛑', turn);
  // A police call out for me: the reported scene in a pulsing red ring; with the police scanner,
  // the units on their way (blue).
  const call = game.wanted.call;
  if (call) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    const r = Math.max(9, call.r * s);
    g.save();
    g.fillStyle = `rgba(255,40,50,${0.1 + 0.12 * pulse})`;
    g.strokeStyle = `rgba(255,45,60,${0.75 + 0.25 * pulse})`;
    g.lineWidth = 2.5 + pulse * 1.5;
    g.beginPath();
    g.arc(tx(call.x), tz(call.z), r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.setLineDash([4, 4]);
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(tx(call.x), tz(call.z), r * (1.25 + 0.35 * ((performance.now() / 900) % 1)), 0, Math.PI * 2);
    g.stroke();
    g.restore();
    for (const [ux, uz] of call.units ?? []) {
      g.fillStyle = Math.floor(performance.now() / 200) % 2 ? '#ff3b47' : '#3b7bff';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(tx(ux), tz(uz), 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
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
  // NPC customers (and police officers on foot in blue)
  for (const [id, n] of game.entities.npcs) {
    if (id.startsWith('hmc_')) continue;
    const l = n.buffer.latest;
    g.fillStyle = id.startsWith('cop_') || id.startsWith('csi_') ? '#5b8cff' : '#ffd166';
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
