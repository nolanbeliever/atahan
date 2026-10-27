// Boot: menus, settings UI, singleplayer/multiplayer start, lifecycle handling.
import { Settings, IS_TOUCH, IS_IOS, PRESETS } from './client/settings.js';
import { Input } from './client/input.js';
import { AudioSys } from './client/audio.js';
import { Game } from './client/game.js';
import { LocalSession, RemoteSession } from './client/session.js';
import { generateWorld } from './shared/world.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const settings = new Settings();
const audio = new AudioSys(settings);
const canvas = $('c');
const input = new Input(canvas, settings);
let game = null;
let world = null;

// ---- error surface (helps on iPad where there is no console)
addEventListener('error', (e) => showErr(e.message + (e.filename ? `\n${e.filename}:${e.lineno}` : '')));
addEventListener('unhandledrejection', (e) => showErr(String(e.reason && e.reason.stack || e.reason)));
function showErr(m) { const b = $('errbox'); b.textContent = 'Error: ' + m; b.classList.remove('hidden'); setTimeout(() => b.classList.add('hidden'), 12000); console.error(m); }

// ---- WebGL support check
(function checkGL() {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) { $('deviceHint').textContent = 'WebGL is not available in this browser — the game cannot run here.'; $('btnNew').disabled = true; }
})();

document.body.classList.toggle('touch', IS_TOUCH);
applyTouchPrefs();
$('deviceHint').textContent = `${IS_TOUCH ? 'Touch controls' : 'Keyboard & mouse'} · graphics: ${PRESETS[settings.preset].label}${IS_IOS ? ' · tip: Share → Add to Home Screen for fullscreen' : ''}`;
// prevent page scroll / pinch zoom / double-tap zoom during play
document.addEventListener('touchmove', (e) => { if (!e.target.closest('.panel-inner, .menu-inner')) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

function show(id) { for (const s of ['menu', 'settings', 'controls', 'credits', 'mp', 'loading']) $(s).classList.toggle('hidden', s !== id); }
let returnTo = 'menu';
function openSub(id, from) { returnTo = from; for (const s of ['menu', 'settings', 'controls', 'credits', 'mp']) $(s).classList.add('hidden'); $(id).classList.remove('hidden'); if (from === 'pause') $('pause').classList.add('hidden'); }
function back() { for (const s of ['settings', 'controls', 'credits', 'mp']) $(s).classList.add('hidden'); if (returnTo === 'pause') $('pause').classList.remove('hidden'); else $('menu').classList.remove('hidden'); }
document.querySelectorAll('.back').forEach(b => b.onclick = () => { audio.ui(); back(); });

function refreshMenu() {
  let save = null;
  try { save = JSON.parse(localStorage.getItem('dd_save') || 'null'); } catch (e) { save = null; }
  $('btnContinue').classList.toggle('hidden', !save);
  $('menuDay').textContent = save ? save.day : 1;
  $('btnNew').textContent = save ? 'Singleplayer — New game' : 'Singleplayer — Play';
}
refreshMenu();

$('btnContinue').onclick = () => { audio.init(); startSP(true); };
$('btnNew').onclick = () => {
  audio.init();
  if (localStorage.getItem('dd_save') && !confirm('Start a new game? Your current save will be overwritten when the game autosaves.')) return;
  startSP(false);
};
$('btnMP').onclick = () => { audio.init(); audio.ui(); $('mp-url').value = settings.server || defaultServer(); $('mp-name').value = settings.name || ''; openSub('mp', 'menu'); };
$('btnSettings').onclick = () => { audio.ui(); loadSettingsUI(); openSub('settings', 'menu'); };
$('btnControls').onclick = () => { audio.ui(); openSub('controls', 'menu'); };
$('btnCredits').onclick = () => { audio.ui(); openSub('credits', 'menu'); };
const fsEl = document.documentElement;
if (!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen)) $('btnFullscreen').classList.add('hidden');
$('btnFullscreen').onclick = () => goFullscreen();
function goFullscreen() {
  try {
    const p = fsEl.requestFullscreen ? fsEl.requestFullscreen({ navigationUI: 'hide' }) : fsEl.webkitRequestFullscreen();
    if (p && p.then) p.then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {});
  } catch (e) { /* not supported */ }
}

function defaultServer() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return location.port === '5173' || location.port === '4173' ? `${proto}://${location.hostname}:8787` : `${proto}://${location.host}`;
}

// ---------------------------------------------------------------- settings UI
const KEYS = ['preset', 'renderScale', 'fov', 'brightness', 'adaptive', 'showFps', 'master', 'sfx', 'ambient', 'sens', 'touchSens', 'touchScale', 'touchOpacity', 'invertY', 'leftHanded', 'autoSprint', 'aimAssist', 'headBob', 'thirdPerson', 'dayLength', 'name'];
function fmt(k, v) { if (k === 'dayLength') return Math.round(v / 60) + ' min'; if (k === 'fov') return v + '°'; return Number(v).toFixed(2); }
function loadSettingsUI() {
  for (const k of KEYS) {
    const el = $('s-' + k);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else el.value = settings[k];
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = fmt(k, settings[k]);
  }
}
for (const k of KEYS) {
  const el = $('s-' + k);
  if (!el) continue;
  el.addEventListener('input', () => {
    settings[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = fmt(k, settings[k]);
    settings.save();
    applyLive(k);
  });
}
function applyLive(k) {
  if (['master', 'sfx', 'ambient'].includes(k)) audio.applyVolumes();
  if (['touchScale', 'touchOpacity', 'leftHanded'].includes(k)) applyTouchPrefs();
  if (game && (k === 'renderScale' || k === 'preset')) game.resize();
  if (game && k === 'thirdPerson') game.player.setThirdPerson(settings.thirdPerson);
}
function applyTouchPrefs() {
  document.documentElement.style.setProperty('--ts', settings.touchScale);
  document.documentElement.style.setProperty('--to', settings.touchOpacity);
  document.body.classList.toggle('lefty', !!settings.leftHanded);
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('#settings .tab').forEach(t => t.classList.toggle('hidden', t.dataset.tab !== b.dataset.tab));
});
$('settingsBack').onclick = () => { audio.ui(); back(); };

// ---------------------------------------------------------------- game start
async function loadWorld(progress) {
  progress(0.05, 'Generating the district');
  await new Promise(r => setTimeout(r, 30));
  if (!world) world = generateWorld(1337);
  else world = generateWorld(world.seed); // fresh door / loot state
  progress(0.3, 'Building navigation');
  await new Promise(r => setTimeout(r, 0));
  return world;
}

function progressFn() {
  show('loading');
  return (v, t) => { $('loadbar').style.width = Math.round(v * 100) + '%'; $('loadtxt').textContent = t; };
}

async function startSP(cont) {
  const progress = progressFn();
  try {
    let save = null;
    if (cont) { try { save = JSON.parse(localStorage.getItem('dd_save')); } catch (e) { save = null; } }
    const W = await loadWorld(progress);
    const session = new LocalSession(W, { maxZombies: settings.gfx.zombies, dayLength: settings.dayLength, time: 18.4 });
    await launch(W, session, save, progress);
  } catch (e) { showErr(e.stack || e.message); show('menu'); }
}

async function launch(W, session, save, progress) {
  if (game) { game.dispose(); game = null; }
  game = new Game(canvas, settings, audio, input);
  game.onQuit = (msg) => quitToMenu(msg);
  await game.init(W, session, progress);
  progress(0.75, 'Raising buildings');
  await new Promise(r => setTimeout(r, 0));
  game.begin(save);
  progress(0.95, 'Compiling shaders');
  await new Promise(r => setTimeout(r, 0));
  try { game.renderer.compile(game.scene, game.camera); } catch (e) { /* optional */ }
  show(null);
  $('touch').classList.toggle('hidden', !(IS_TOUCH || input.touchMode));
  checkOrientation();
  if (IS_TOUCH && (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen) && !IS_IOS) goFullscreen();
}

function quitToMenu(msg) {
  if (game) { if (!game.session.mp) game.autosave(); game.dispose(); game = null; }
  for (const id of ['pause', 'death', 'win', 'inv', 'loot', 'map']) $(id).classList.add('hidden');
  $('hud').classList.add('hidden');
  input.enabled = false; input.unlock();
  refreshMenu();
  show('menu');
  if (msg) $('deviceHint').textContent = msg;
}

// pause / death / win buttons
$('pResume').onclick = () => { audio.ui(); game.pause(false); };
$('pSave').onclick = () => { if (game.session.mp) { game.hud.toast('Saving is singleplayer only'); return; } game.autosave(); game.hud.toast('Game saved'); audio.ui(); };
$('pSettings').onclick = () => { loadSettingsUI(); openSub('settings', 'pause'); };
$('pControls').onclick = () => openSub('controls', 'pause');
$('pQuit').onclick = () => quitToMenu();
$('dRespawn').onclick = () => { game.respawn(); };
$('dLoad').onclick = () => { $('death').classList.add('hidden'); quitToMenu(); startSP(true); };
$('dQuit').onclick = () => quitToMenu();
$('wContinue').onclick = () => { $('win').classList.add('hidden'); };
$('wQuit').onclick = () => quitToMenu();
$('invClose').onclick = () => game.closePanels();
$('lootClose').onclick = () => game.closePanels();
$('mapClose').onclick = () => game.closePanels();
$('lootAll').onclick = () => {
  const id = game.lootId, items = game.session.contItems(id) || [];
  audio.pickup();
  for (let i = items.length - 1; i >= 0; i--) game.session.take(id, i, items[i].n);
};

// ---------------------------------------------------------------- multiplayer lobby
let remote = null;
$('mp-connect').onclick = async () => {
  audio.ui();
  const url = $('mp-url').value.trim() || defaultServer();
  settings.server = url; settings.name = $('mp-name').value.trim() || settings.name || 'Survivor'; settings.save();
  $('mp-status').textContent = 'Connecting…';
  if (remote) remote.close();
  remote = new RemoteSession(url);
  try {
    await remote.connect();
    $('mp-status').textContent = 'Connected.';
    $('mp-lobby').classList.remove('hidden');
    remote.on('rooms', (d) => renderRooms(d.rooms));
    remote.on('err', (d) => { $('mp-status').textContent = d.msg; });
    remote.on('joined', (d) => joinedRoom(d));
    remote.on('close', () => { if (!game) { $('mp-status').textContent = 'Disconnected.'; $('mp-lobby').classList.add('hidden'); } });
    remote.list();
  } catch (e) { $('mp-status').textContent = `${e.message}. Is the server running at ${url}?`; }
};
$('mp-refresh').onclick = () => remote && remote.list();
$('mp-create').onclick = () => remote && remote.create(settings.name || 'Survivor', $('mp-public').checked);
$('mp-join').onclick = () => { const c = $('mp-code').value.trim().toUpperCase(); if (c && remote) remote.joinRoom(c, settings.name || 'Survivor'); };
function renderRooms(rooms) {
  const box = $('mp-rooms');
  box.innerHTML = rooms.length ? '' : '<p class="note">No public sessions yet — create one.</p>';
  for (const r of rooms) {
    const d = document.createElement('div'); d.className = 'room';
    d.innerHTML = `<span><b>${r.code}</b> · ${escapeHtml(r.host)} · ${r.players}/${r.max} players · day ${r.day}</span>`;
    const b = document.createElement('button'); b.textContent = 'Join'; b.onclick = () => remote.joinRoom(r.code, settings.name || 'Survivor');
    d.appendChild(b); box.appendChild(d);
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
async function joinedRoom(d) {
  const progress = progressFn();
  try {
    world = null;
    const W = generateWorld(d.seed);
    world = W;
    progress(0.3, 'Syncing with server');
    remote.applyJoin(d, W);
    await launch(W, remote, null, progress);
    game.roomCode = d.code;
    game.hud.toast(`Joined room ${d.code} — share this code with friends`, true);
  } catch (e) { showErr(e.stack || e.message); show('mp'); }
}

// ---------------------------------------------------------------- lifecycle
document.addEventListener('visibilitychange', () => {
  if (!game) return;
  if (document.hidden) { if (!game.paused && !game.session.mp) game.pause(true); audio.suspend(); input.releaseAll(); }
  else audio.resume();
});
addEventListener('pagehide', () => { if (game && !game.session.mp) game.autosave(); });
document.addEventListener('pointerlockchange', () => {
  if (!game || !game.running || input.touchMode) return;
  if (!document.pointerLockElement && !game.paused && !game.panel && !game.player.dead && $('win').classList.contains('hidden')) game.pause(true);
});
let rotateDismissed = false;
$('rotateDismiss').onclick = () => { rotateDismissed = true; $('rotate').classList.add('hidden'); };
function checkOrientation() {
  const portrait = innerHeight > innerWidth;
  $('rotate').classList.toggle('hidden', !(IS_TOUCH && portrait && game && !rotateDismissed));
}
addEventListener('resize', checkOrientation);
addEventListener('orientationchange', () => setTimeout(checkOrientation, 300));
// first gesture unlocks audio on iOS
addEventListener('pointerdown', () => audio.init(), { once: true });
// expose for automated tests
window.__dd = { get game() { return game; }, settings, input, startSP, THREE };
