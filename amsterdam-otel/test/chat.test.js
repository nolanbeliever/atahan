import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotelSimulation } from '../server/game/HotelSimulation.js';
import { EVT } from '../shared/constants.js';
import { CHAT_RULES, cleanChat } from '../shared/chat.js';

const config = {
  dayLengthSec: 240, weekendSpeed: 2, tickMs: 100, spawnMinMin: 40, spawnMaxMin: 90,
  stayMinMin: 150, stayMaxMin: 420, clockBroadcastMs: 5000, maxPlayers: 16,
};

function setup() {
  let now = 1_000_000;
  const sim = new HotelSimulation({ config, now: () => now });
  sim.start = () => {};
  sim.stop = () => {};
  const out = [];
  sim.on('out', (event, payload) => out.push({ event, payload }));
  return { sim, out, advance: (ms) => { now += ms; } };
}

test('sohbet: mesaj herkese yayınlanır, isim ve renkle; yeni gelen son mesajları görür', () => {
  const { sim, out } = setup();
  const a = sim.addPlayer('Ayşe');
  const r = sim.chat(a.id, '  merhaba   herkes  ');
  assert.ok(r.ok);
  const msg = out.filter((e) => e.event === EVT.CHAT).at(-1).payload;
  assert.equal(msg.text, 'merhaba herkes');
  assert.equal(msg.name, 'Ayşe');
  assert.equal(msg.id, a.id);
  assert.equal(msg.color, a.color);
  const b = sim.addPlayer('Burak');
  assert.equal(sim.snapshot(b.id).chat.at(-1).text, 'merhaba herkes');
});

test('sohbet: boş / bozuk / tekrar mesaj reddedilir; geçmiş sınırlı; kaba kelimeler yıldızlanır', () => {
  const { sim, advance } = setup();
  const a = sim.addPlayer('Ayşe');
  for (const bad of ['', '   ', null, 42, {}, ['x'], { toString: () => 'x' }, '‮​']) {
    assert.equal(sim.chat(a.id, bad).ok, false, JSON.stringify(bad));
  }
  assert.ok(sim.chat(a.id, 'selam').ok);
  assert.match(sim.chat(a.id, 'selam').error, /tekrar/);
  advance(CHAT_RULES.REPEAT_MS + 1);
  assert.ok(sim.chat(a.id, 'selam').ok);
  for (let i = 0; i < CHAT_RULES.HISTORY + 10; i++) sim.chat(a.id, `mesaj ${i}`);
  assert.equal(sim.chatLog.length, CHAT_RULES.HISTORY);
  assert.equal(sim.chat(a.id, 'x'.repeat(500)).text.length, CHAT_RULES.MAX_LEN);
  assert.equal(sim.chat(a.id, 'naber amk <script>').text, 'naber *** script');
  assert.equal(cleanChat('Siktir git'), '****** git');
  assert.equal(cleanChat('sıkıcı bir gün, ağaç, müsiki, götürdüm'), 'sıkıcı bir gün, ağaç, müsiki, götürdüm');
  assert.equal(cleanChat('FUCK'), '****');
});
