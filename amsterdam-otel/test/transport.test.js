import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT, ROOM_STATUS } from '../shared/constants.js';
import { VEHICLE_KIOSK, ROOM_BY_ID, isOutdoors, isInsideSteeg, buildWallSegments } from '../shared/layout.js';
import { VEHICLE_BY_ID, passengerSeat } from '../shared/vehicles.js';
import { ISSUE_IDS, MAINT_RULES, issueSpots } from '../shared/maintenance.js';

const config = {
  dayLengthSec: 100_000, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16, startWallet: 200, starterBed: false,
};
const KEY_A = 'a'.repeat(32);
const KEY_B = 'b'.repeat(32);

function memoryStore(initial = null) {
  return { data: initial, load() { return this.data; }, save(d) { this.data = JSON.parse(JSON.stringify(d)); } };
}

function setup({ store = null } = {}) {
  let now = 7_000_000;
  const sim = new HotelSimulation({ config: { ...config, startDay: 1, startHour: 11 }, now: () => now, house: { store } });
  sim.start = () => { sim.lastTick = now; };
  sim.stop = () => {};
  const out = [];
  const to = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  sim.on('to', (id, event, payload) => to.push({ id, event, payload }));
  const events = (e) => out.filter((x) => x.event === e).map((x) => x.payload);
  const atKiosk = (p) => sim.movePlayer(p.id, VEHICLE_KIOSK.pos[0], VEHICLE_KIOSK.pos[1], 0);
  return { sim, out, to, events, atKiosk, advance: (ms) => { now += ms; } };
}

test('steeg: sokaktan Achterstraat\'a açık geçit; açık hava alanları', () => {
  assert.ok(isInsideSteeg(17, 10));
  assert.ok(isOutdoors(17, 10) && isOutdoors(0, -3) && isOutdoors(0, 30));
  assert.ok(!isOutdoors(0, 5) && !isOutdoors(0, 36) && !isOutdoors(12, 4));
  // Steeg'in içinden (x 16.4..17.6) sokaktan Achterstraat'a kadar hiçbir katı duvar geçmez
  const solid = buildWallSegments().filter((s) => !s.lintel);
  for (let z = 0; z <= 27; z += 0.25) {
    for (const x of [16.45, 17.0, 17.55]) {
      const hit = solid.find((s) => x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ);
      assert.ok(!hit, `(${x}, ${z}) duvarda: ${JSON.stringify(hit)}`);
    }
  }
});

test('satın alma: büfede, para düşer, iki kez alınmaz, araç park yerinde belirir', () => {
  const { sim, events, atKiosk } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  sim.movePlayer(a.id, 0, 5, 0);
  assert.match(sim.vehicleAct(a.id, { act: 'buy', type: 'bike' }).error, /büfeye/);
  atKiosk(a);
  const w = a.wallet;
  const r = sim.vehicleAct(a.id, { act: 'buy', type: 'bike' });
  assert.ok(r.ok, r.error);
  assert.equal(a.wallet, w - VEHICLE_BY_ID.bike.price);
  assert.match(sim.vehicleAct(a.id, { act: 'buy', type: 'bike' }).error, /Zaten/);
  const list = events(EVT.VEHICLES).at(-1);
  assert.equal(list.length, 1);
  assert.equal(list[0].ownerId, a.id);
  assert.deepEqual([list[0].x, list[0].z], VEHICLE_KIOSK.spawn);
  for (const bad of [null, {}, { act: 'buy', type: '__proto__' }, { act: 'buy', type: { toString: 1 } }, { act: 'mount', id: '1' }, { act: 'fly' }]) {
    assert.equal(sim.vehicleAct(a.id, bad).ok, false, JSON.stringify(bad));
  }
  a.wallet = 1;
  assert.match(sim.vehicleAct(a.id, { act: 'buy', type: 'scooter' }).error, /gerekli/);
});

test('sürüş: yalnızca sahibi sürer; arkadaş arkaya biner ve sürücüyle birlikte taşınır; yolcunun kendi hareketi yok sayılır', () => {
  const { sim, events, atKiosk, to } = setup();
  const a = sim.addPlayer('Ali', KEY_A);
  const b = sim.addPlayer('Bea', KEY_B);
  atKiosk(a);
  const { id } = sim.vehicleAct(a.id, { act: 'buy', type: 'scooter' });
  const [vx, vz] = VEHICLE_KIOSK.spawn;
  // B yanına gelir: sürücü koltuğu sahibin → B yolcu olur
  sim.movePlayer(b.id, vx + 0.8, vz, 0);
  const rb = sim.vehicleAct(b.id, { act: 'mount', id });
  assert.ok(rb.ok, rb.error);
  assert.equal(rb.seat, 'passenger');
  // A sürücü
  sim.movePlayer(a.id, vx - 0.8, vz, 0);
  const ra = sim.vehicleAct(a.id, { act: 'mount', id });
  assert.equal(ra.seat, 'driver');
  assert.deepEqual([a.x, a.z], [vx, vz]);
  assert.equal(sim.vehicleAct(a.id, { act: 'mount', id }).ok, false);
  // Sürücü steeg'e doğru gider → yolcu arkasında taşınır
  sim.movePlayer(a.id, 17, 5, Math.PI);
  const seat = passengerSeat(17, 5, Math.PI);
  assert.ok(Math.abs(b.x - seat.x) < 0.01 && Math.abs(b.z - seat.z) < 0.01, `${b.x},${b.z}`);
  sim.movePlayer(b.id, 0, 0, 1.2); // yolcu konum gönderse de taşınmaz, yalnızca bakar
  assert.ok(Math.abs(b.x - seat.x) < 0.01);
  assert.equal(b.yaw, 1.2);
  const v = sim.vehicles.vehicles.get(id);
  assert.deepEqual([v.x, v.z], [17, 5]);
  // Kapalı alanda park edilmez
  sim.movePlayer(a.id, 0, 5, 0);
  assert.match(sim.vehicleAct(a.id, { act: 'dismount' }).error, /park edemezsin/);
  // Achterstraat'ta park: yolcu da iner, yanına bırakılır
  sim.movePlayer(a.id, 5, 30, 0);
  assert.ok(sim.vehicleAct(a.id, { act: 'dismount' }).ok);
  assert.equal(a.vehicle, null);
  assert.equal(b.vehicle, null);
  assert.ok(isOutdoors(b.x, b.z));
  assert.ok(to.some((m) => m.id === b.id && m.event === EVT.VEHICLE_SEAT && m.payload.seat === null));
  const last = events(EVT.VEHICLES).at(-1)[0];
  assert.deepEqual([last.x, last.z, last.driver, last.passenger], [5, 30, null, null]);
  // B sahibi değil: sürücü koltuğuna oturamaz (yalnızca yolcu)
  sim.movePlayer(b.id, 5.5, 30, 0);
  assert.equal(sim.vehicleAct(b.id, { act: 'mount', id }).seat, 'passenger');
  assert.ok(sim.vehicleAct(b.id, { act: 'dismount' }).ok);
});

test('kalıcılık: araç ve son park yeri anahtara bağlı; sürücü çıkınca araç park eder ve dünyadan kalkar', () => {
  const store = memoryStore();
  const s1 = setup({ store });
  const a = s1.sim.addPlayer('Ali', KEY_A);
  s1.atKiosk(a);
  const { id } = s1.sim.vehicleAct(a.id, { act: 'buy', type: 'bike' });
  s1.sim.movePlayer(a.id, ...VEHICLE_KIOSK.spawn, 0);
  s1.sim.vehicleAct(a.id, { act: 'mount', id });
  s1.sim.movePlayer(a.id, 17, 20, 0);
  s1.sim.removePlayer(a.id);
  assert.equal(s1.sim.vehicles.vehicles.size, 0);
  s1.sim.house.flush();
  const s2 = setup({ store });
  const a2 = s2.sim.addPlayer('Ali', KEY_A);
  const v = [...s2.sim.vehicles.vehicles.values()][0];
  assert.equal(v.type, 'bike');
  assert.deepEqual([v.x, v.z], [17, 20]);
  assert.deepEqual(s2.sim.snapshot(a2.id).self.vehicles.owned, ['bike']);
  // Bozuk kayıt: kapalı alandaki konum büfeye, bilinmeyen tür yok sayılır
  const data = JSON.parse(JSON.stringify(store.data));
  const hash = Object.keys(data.vehicles)[0];
  data.vehicles[hash] = { bike: { x: 0, z: 5, yaw: 0 }, tank: { x: 1, z: 1 } };
  const s3 = setup({ store: memoryStore(data) });
  s3.sim.addPlayer('Ali', KEY_A);
  const vs = [...s3.sim.vehicles.vehicles.values()];
  assert.equal(vs.length, 1);
  assert.deepEqual([vs[0].x, vs[0].z], VEHICLE_KIOSK.spawn);
});

test('tamirat: begin → mini oyun süresi → finish; erken bitirme ve uzaktan tamir yok; tamir + hız bonusu', () => {
  const { sim, to, advance } = setup();
  const p = sim.addPlayer('Ali', KEY_A);
  const room = sim.rooms.get('101');
  const layout = ROOM_BY_ID['101'];
  sim.rooms.makeDirty(room);
  room.bedMade = true;
  room.trash.fill(false);
  for (const k of ISSUE_IDS) room.issues[k] = false;
  room.issues.bulb = true;
  room.issues.faucet = true;
  const spots = issueSpots(layout);
  // Uzaktan / odanın dışından olmaz
  sim.movePlayer(p.id, 0, 15, 0);
  assert.match(sim.maint(p.id, { act: 'begin', roomId: '101', issue: 'bulb' }).error, /içinde/);
  sim.movePlayer(p.id, spots.fuse.x + 0.3, spots.fuse.z, 0);
  assert.match(sim.maint(p.id, { act: 'begin', roomId: '101', issue: 'faucet' }).error, /yaklaş/);
  // Olmayan arıza
  assert.match(sim.maint(p.id, { act: 'begin', roomId: '101', issue: 'fuse' }).error, /zaten/);
  // Bozuk girdiler
  for (const bad of [null, {}, { act: 'begin', roomId: '101', issue: '__proto__' }, { act: 'x', roomId: '101', issue: 'bulb' }, { act: 'begin', roomId: { toString: 1 }, issue: 'bulb' }]) {
    assert.equal(sim.maint(p.id, bad).ok, false, JSON.stringify(bad));
  }
  sim.movePlayer(p.id, spots.bulb.x, spots.bulb.z, 0);
  assert.match(sim.maint(p.id, { act: 'finish', roomId: '101', issue: 'bulb' }).error, /Önce/);
  assert.equal(sim.maint(p.id, { act: 'begin', roomId: '101', issue: 'bulb' }).game, 'bulb');
  advance(300);
  assert.match(sim.maint(p.id, { act: 'finish', roomId: '101', issue: 'bulb' }).error, /hızlı/);
  advance(1500);
  assert.ok(sim.maint(p.id, { act: 'finish', roomId: '101', issue: 'bulb' }).ok);
  assert.equal(room.issues.bulb, false);
  // Son iş: oda biter, bahşiş + 2 tamir × €2 + hız bonusu
  sim.movePlayer(p.id, spots.faucet.x, spots.faucet.z + 0.5, 0);
  sim.maint(p.id, { act: 'begin', roomId: '101', issue: 'faucet' });
  advance(1600);
  const w = p.wallet;
  const r = sim.maint(p.id, { act: 'finish', roomId: '101', issue: 'faucet' });
  assert.ok(r.ok && r.finished, r.error);
  assert.equal(room.status, ROOM_STATUS.EMPTY);
  const gained = p.wallet - w;
  const extra = 2 * MAINT_RULES.REPAIR_BONUS + MAINT_RULES.FAST_BONUS;
  assert.ok(gained >= 4 + extra && gained <= 12 + extra, String(gained));
  const msg = to.filter((m) => m.id === p.id && m.event === EVT.NOTIFY).at(-1).payload.text;
  assert.match(msg, /Tamirat teşekkürü \+€4/);
  assert.match(msg, /Hızlı ve eksiksiz/);
});

test('tamirat: yavaş bitirilen odada hız bonusu yok', () => {
  const { sim, to, advance } = setup();
  const p = sim.addPlayer('Ali');
  const room = sim.rooms.get('102');
  const layout = ROOM_BY_ID['102'];
  sim.rooms.makeDirty(room);
  room.trash.fill(false);
  for (const k of ISSUE_IDS) room.issues[k] = false;
  sim.movePlayer(p.id, layout.bed.x - 1.6, layout.bed.z, 0);
  room.startedAt = sim.now() - MAINT_RULES.FAST_MS - 1;
  advance(1);
  assert.ok(sim.interact(p.id, '102', 'bed'));
  const msg = to.filter((m) => m.id === p.id && m.event === EVT.NOTIFY).at(-1).payload.text;
  assert.doesNotMatch(msg, /Hızlı/);
});
