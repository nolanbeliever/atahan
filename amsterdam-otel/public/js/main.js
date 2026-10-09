import { EVT, formatMoney } from '/shared/constants.js';
import { detectDevice } from './core/Device.js';
import { loadSettings, saveSettings, resolveQuality } from './core/Settings.js';
import { Engine } from './core/Engine.js';
import { TextureFactory } from './world/Textures.js';
import { createMaterials } from './world/Materials.js';
import { Collision } from './world/Collision.js';
import { buildHotel } from './world/HotelWorld.js';
import { InputState } from './controls/InputState.js';
import { KeyboardMouse } from './controls/KeyboardMouse.js';
import { TouchControls } from './controls/TouchControls.js';
import { PlayerController } from './controls/PlayerController.js';
import { GameState } from './game/GameState.js';
import { GuestView } from './game/GuestView.js';
import { RemotePlayers } from './game/RemotePlayers.js';
import { Interaction } from './game/Interaction.js';
import { CoffeeShopSystem } from './game/CoffeeShopSystem.js';
import { TripEffects } from './game/TripEffects.js';
import { HouseSystem } from './game/HouseSystem.js';
import { TvSystem } from './game/TvSystem.js';
import { Network } from './net/Network.js';
import { HUD } from './ui/HUD.js';
import { SettingsPanel } from './ui/SettingsPanel.js';

// ---- Cihaz, ayarlar, motor --------------------------------------------------

const device = detectDevice();
document.body.classList.toggle('touch', device.touch);
const settings = loadSettings(device);
const quality = resolveQuality(settings.quality, device);

const canvas = document.getElementById('game');
const hud = new HUD();
const engine = new Engine({ canvas, device, quality, fpsCap: settings.fps });

// ---- Dünya ------------------------------------------------------------------

const factory = new TextureFactory(quality.texSize, quality.anisotropy);
const { mats, tex } = createMaterials(factory);
const collision = new Collision();
const world = buildHotel({ engine, mats, tex, factory, collision, quality });
engine.onDegrade = (what) => {
  if (what === 'textures') factory.setSize(Math.max(64, factory.size / 2));
};

// ---- Girdi ve oyuncu ----------------------------------------------------------

const input = new InputState(() => engine.wake());
const kbm = new KeyboardMouse({ input, canvas });
const touch = device.touch ? new TouchControls({ input, root: document.getElementById('touch-ui') }) : null;
const player = new PlayerController({ camera: engine.camera, collision, input });

// ---- Oyun durumu ve ağ --------------------------------------------------------

const state = new GameState();
const guests = new GuestView(engine.scene);
const remotes = new RemotePlayers(engine.scene);
const net = new Network();
const interaction = new Interaction({
  scene: engine.scene, world, state, player, hud, touch, net, desktop: !device.touch,
});
input.onAction((source) => {
  // Dekorasyon modunda Aksiyon/E/tık = eşyayı yerleştir
  if (house.build.active) house.place();
  else interaction.trigger(source);
});

// ---- Modal paneller (coffee shop, slot, yaş onayı) ---------------------------------
// Panel açıkken girdi kapanır, fare kilidi bırakılır ve 3D render tamamen durur.

let suppressPause = false; // panel açarken bırakılan fare kilidi "duraklat" ekranı açmasın
const modal = {
  stack: [],
  onClose: new Map(),
  open(el, onClose) {
    if (this.stack.includes(el)) return;
    this.stack.push(el);
    if (onClose) this.onClose.set(el, onClose);
    el.hidden = false;
    input.setEnabled(false);
    touch?.reset();
    touch?.show(false);
    if (kbm.locked) {
      suppressPause = true;
      document.exitPointerLock();
    }
    engine.setPaused(true);
  },
  close(el) {
    const i = this.stack.indexOf(el);
    if (i < 0) return;
    this.stack.splice(i, 1);
    // Gizlenen paneldeki kutuda odak kalırsa sonraki oyun tuşları oraya gider (Esc ile kapanış)
    if (el.contains(document.activeElement)) document.activeElement.blur();
    el.hidden = true;
    const cb = this.onClose.get(el);
    this.onClose.delete(el);
    cb?.();
    if (this.stack.length === 0) {
      setPlaying(true);
      if (!device.touch && !kbm.dragFallback) kbm.lock(); // buton tıklaması = kullanıcı hareketi
    }
  },
  closeTop() {
    const top = this.stack[this.stack.length - 1];
    if (top) this.close(top);
  },
  get active() { return this.stack.length > 0; },
};

const trip = new TripEffects({ engine, player, collision, hud, net, remotes, settings });
const tv = new TvSystem({ net, hud, modal, engine, device });
const house = new HouseSystem({
  engine, building: world.house, collision, net, hud, interaction, player, remotes, device, tv,
});
tv.house = house;
house.getWallet = () => shop.wallet;
// Dekorasyon modu komutları (B, R, C, X, 1-9) coffee shop'tan ÖNCE işlenir
input.onCommand((cmd) => house.command(cmd) || tv.command(cmd));
const shop = new CoffeeShopSystem({ net, hud, interaction, input, modal, device });

let started = false; // oyuncu "Oyna"ya bastı
let joined = false; // bu bağlantıda sunucu "welcome" gönderdi
let positioned = false; // ilk doğma konumu alındı

// ---- Kare sistemleri (sıra önemli) ------------------------------------------------

const ctx = { px: 0, pz: 0, guestNear: (x, z, r) => guests.near(x, z, r) };
engine.addSystem((dt) => player.update(dt));
engine.addSystem((dt) => guests.update(dt, net.serverNow()));
engine.addSystem((dt) => remotes.update(dt));
engine.addSystem((dt) => trip.update(dt));
engine.addSystem((dt) => house.update(dt));
engine.addSystem((dt) => {
  ctx.px = player.pos.x;
  ctx.pz = player.pos.z;
  return world.update(dt, ctx);
});
engine.addSystem(() => {
  interaction.update();
  if (player.moved && joined) net.sendMove(player.pos.x, player.pos.z, player.yaw);
  return false;
});

engine.start();
engine.renderOnce(); // menünün arkasında otel görünsün
engine.setPaused(true); // menü açıkken hiç kare çizilmez

// ---- Menü / duraklatma ----------------------------------------------------------

const overlay = document.getElementById('overlay');
const playBtn = document.getElementById('btn-play');
const nameInput = document.getElementById('name-input');
const nameField = document.getElementById('name-field');
const overlaySub = document.getElementById('overlay-sub');
const overlayTitle = overlay.querySelector('h1');
nameInput.value = settings.name;

function setPlaying(on) {
  overlay.hidden = on;
  input.setEnabled(on);
  engine.setPaused(!on);
  touch?.show(on);
  if (!on) touch?.reset();
}

function showPause() {
  overlayTitle.textContent = 'Duraklatıldı';
  overlaySub.textContent = 'Oyun beklemede — işlemci ve GPU dinleniyor.';
  nameField.hidden = true;
  playBtn.textContent = 'Devam Et';
  setPlaying(false);
}

function tryFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

playBtn.addEventListener('click', () => {
  trip.audio.unlock(); // tarayıcılar sesi yalnızca kullanıcı hareketiyle açar
  if (!started) {
    started = true;
    settings.name = nameInput.value.trim().slice(0, 16);
    saveSettings(settings);
    if (net.connected) net.join(settings.name);
  }
  if (device.touch) {
    tryFullscreen();
    setPlaying(true);
  } else if (kbm.dragFallback) {
    setPlaying(true);
  } else {
    kbm.lock(); // pointerlockchange → setPlaying(true)
  }
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') playBtn.click();
});

document.addEventListener('pointerlockchange', () => {
  if (kbm.locked) {
    if (!modal.active) setPlaying(true);
  } else if (suppressPause) {
    suppressPause = false;
  } else if (started && !device.touch && !modal.active) {
    showPause();
  }
});
document.addEventListener('pointerlockerror', () => {
  // Panel kapanışından sonraki yeniden kilitleme reddedilirse: oyun sürer, tıklayınca kilitlenir
  if (kbm.everLocked) return;
  kbm.dragFallback = true;
  setPlaying(true);
  hud.toast('Fare kilitlenemedi: bakmak için sol tuşla sürükleyin. Esc ile duraklat.', 'warn');
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (modal.active) {
    modal.closeTop();
    return;
  }
  if (house.build.active) {
    house.toggleBuild(false);
    return;
  }
  if (!started || !overlay.hidden) return;
  // Kilitliyse kilidi bırak (pointerlockchange → showPause), değilse doğrudan duraklat
  if (kbm.locked) document.exitPointerLock();
  else showPause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    input.clear();
    touch?.reset();
    net.flushMove();
  }
});

const settingsPanel = new SettingsPanel({
  settings,
  device,
  engine,
  onOpenChange(open) {
    if (open) {
      input.setEnabled(false);
      if (kbm.locked) document.exitPointerLock();
    } else if (started && (device.touch || kbm.dragFallback)) {
      setPlaying(true);
    }
  },
  onShowFps: (on) => updateFps(on),
});

// ---- Ağ olayları ----------------------------------------------------------------

net.on('connect', async () => {
  hud.setConnection('Bağlandı ✓');
  await net.syncClock();
  playBtn.disabled = false;
  if (!started) playBtn.textContent = 'Oyna';
  if (started) net.join(settings.name);
});
net.on('disconnect', () => {
  joined = false;
  hud.setConnection('Bağlantı koptu, yeniden bağlanılıyor…', true);
  hud.toast('Sunucu bağlantısı koptu, yeniden bağlanılıyor…', 'warn');
});
net.on('connect_error', () => {
  hud.setConnection('Sunucuya ulaşılamıyor, tekrar deneniyor…', true);
});

net.on(EVT.WELCOME, (snap) => {
  joined = true;
  state.selfId = snap.selfId;
  state.setClock(snap.clock);
  state.setRooms(snap.rooms);
  state.economy = snap.economy;
  shop.applySelf(snap.self);
  trip.setSelfTrip(snap.self?.trip);
  house.selfId = snap.selfId;
  house.applySnapshot(snap.house);
  world.applyRooms(snap.rooms);
  world.setWeekend(snap.clock.weekend);
  hud.setRooms(state.rooms);
  hud.setMoney(snap.economy.money);
  guests.clear();
  for (const g of snap.guests) guests.upsert(g);
  remotes.clear();
  for (const p of snap.players) {
    if (p.id !== snap.selfId) remotes.add(p);
    else if (!positioned) {
      player.setPose(p.x, p.z, p.yaw);
      positioned = true;
    }
  }
  // Yeniden bağlanmada mevcut konumu bildir
  net.sendMove(player.pos.x, player.pos.z, player.yaw);
  updateClock();
  interaction.invalidate();
  engine.requestRender();
});

net.on(EVT.CLOCK, (c) => {
  state.setClock(c);
  world.setWeekend(c.weekend);
  updateClock();
});

net.on(EVT.ROOMS, (rooms) => {
  state.setRooms(rooms);
  world.applyRooms(rooms);
  hud.setRooms(state.rooms);
  interaction.invalidate();
  engine.wake();
});

net.on(EVT.ECONOMY, (e) => {
  state.economy = e;
  hud.setMoney(e.money);
  if (e.delta > 0) hud.toast(`+${formatMoney(e.delta)} · ${e.reason}`, 'money');
});

net.on(EVT.GUEST_UPSERT, (g) => {
  guests.upsert(g);
  engine.requestRender();
});
net.on(EVT.GUEST_REMOVE, (id) => {
  guests.remove(id);
  engine.requestRender();
});

net.on(EVT.PLAYER_JOIN, (p) => {
  if (!joined || p.id === state.selfId) return;
  remotes.add(p);
  hud.toast(`${p.name} vardiyaya katıldı.`, 'info');
  engine.requestRender();
});
net.on(EVT.PLAYER_LEAVE, (id) => {
  remotes.remove(id);
  engine.requestRender();
});
net.on(EVT.PLAYERS, (batch) => {
  remotes.applyBatch(batch, state.selfId);
  engine.wake();
});
net.on(EVT.NOTIFY, (n) => hud.toast(n.text, n.kind));

// Coffee shop / trip
net.on(EVT.SELF, (self) => {
  shop.applySelf(self);
  if (house.build.active) engine.requestRender(); // önizleme rengi (yeterli para var mı) güncellensin
});
net.on(EVT.PLAYER_TRIP, (t) => {
  if (t.id !== state.selfId) return; // başkalarının trip'i: yavaşlamaları ve animasyonları yeterli
  const tripState = t.type ? { type: t.type, endsAt: t.endsAt } : null;
  shop.setTrip(tripState);
  trip.setSelfTrip(tripState);
});
net.on(EVT.PLAYER_EMOTE, (e) => {
  if (e.id !== state.selfId) trip.playRemoteEmote(e.id, e.type);
});

// Bizim Ev
net.on(EVT.HOUSE_ADDED, (item) => house.onAdded(item));
net.on(EVT.HOUSE_REMOVED, (id) => house.onRemoved(id));
net.on(EVT.HOUSE_LIGHTS_STATE, (on) => house.setLights(on));
net.on(EVT.HOUSE_TV_STATE, (s) => house.onTvState(s));

// ---- Saat / FPS göstergesi (saniyede bir, render döngüsünden bağımsız) -------------

function updateClock() {
  if (!state.clock) return;
  const minute = state.minuteAt(net.serverNow());
  hud.setClock(state.clock.day, minute, state.weekend, state.isOpenAt(minute));
}
setInterval(updateClock, 1000);

let fpsTimer = 0;
let lastFrames = 0;
function updateFps(on) {
  clearInterval(fpsTimer);
  if (!on) {
    hud.setFps(null);
    return;
  }
  lastFrames = engine.renderedFrames;
  fpsTimer = setInterval(() => {
    const frames = engine.renderedFrames - lastFrames;
    lastFrames = engine.renderedFrames;
    const mode = engine.paused ? 'duraklatıldı' : engine.sleeping ? 'uyku' : 'aktif';
    hud.setFps(`${frames} FPS / ${engine.fpsCap} · ölçek ${engine.pixelRatio.toFixed(2)} · ${mode}`);
  }, 1000);
}
updateFps(settings.showFps);

// ---- Pil: düşük pil + şarjda değilse 30 FPS --------------------------------------

navigator.getBattery?.().then((battery) => {
  const check = () => {
    const low = !battery.charging && battery.level <= 0.2;
    if (low && !engine.batterySaver) hud.toast('Düşük pil: FPS 30 ile sınırlandı.', 'warn');
    engine.setBatterySaver(low);
  };
  battery.addEventListener('levelchange', check);
  battery.addEventListener('chargingchange', check);
  check();
}).catch(() => {});

// Geliştirme/test için konsoldan erişim
window.__otel = { engine, state, player, net, world, interaction, settingsPanel, shop, trip, modal, house, tv };
