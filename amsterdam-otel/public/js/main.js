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
import { ExteriorCustomization } from './game/ExteriorCustomization.js';
import { InteractiveTV } from './game/InteractiveTV.js';
import { HouseVisitingSystem } from './game/HouseVisitingSystem.js';
import { NightCycle } from './game/NightCycle.js';
import { HerbalBotanySystem } from './game/HerbalBotanySystem.js';
import { NpcRelationshipSystem } from './game/NpcRelationshipSystem.js';
import { CityVehicleSystem } from './game/CityVehicleSystem.js';
import { HotelMaintenanceSystem } from './game/HotelMaintenanceSystem.js';
import { ChatSystem } from './game/ChatSystem.js';
import { ReceptionPC } from './game/ReceptionPC.js';
import { HotelWorkerSystem } from './game/HotelWorkerSystem.js';
import { UndergroundCasino } from './game/UndergroundCasino.js';
import { BarSystem } from './game/BarSystem.js';
import { RecipeBook } from './game/RecipeBook.js';
import { HomeCounterfeitSystem } from './game/HomeCounterfeitSystem.js';
import { FastTravelSystem } from './game/FastTravelSystem.js';
import { UndergroundGarage } from './game/UndergroundGarage.js';
import { DragRaceTrack } from './game/DragRaceTrack.js';
import { MixologyBarSystem } from './game/MixologyBarSystem.js';
import { GourmetRestaurant } from './game/GourmetRestaurant.js';
import { KitchenSystem } from './game/KitchenSystem.js';
import { LiveStageSystem } from './game/LiveStageSystem.js';
import { StreetEvents } from './game/StreetEvents.js';
import { SmartphoneSystem } from './game/SmartphoneSystem.js';
import { InstaHotelMarketing } from './game/InstaHotelMarketing.js';
import { HotelArchitectureUpgrades } from './game/HotelArchitectureUpgrades.js';
import { EntertainmentBasement } from './game/EntertainmentBasement.js';
import { ViewModel } from './game/ViewModel.js';
import { Sfx } from './core/Sfx.js';
import { Network } from './net/Network.js';
import { HUD } from './ui/HUD.js';
import { SettingsPanel } from './ui/SettingsPanel.js';

// ---- Cihaz, ayarlar, motor --------------------------------------------------

const device = detectDevice();
document.body.classList.toggle('touch', device.touch);
const settings = loadSettings(device);

/** Tarayıcıda saklanan gizli oyuncu anahtarı: aynı ev ve cüzdan yeniden bağlanınca geri gelir */
function getPlayerKey() {
  const KEY = 'amsterdam-otel:key:v1';
  try {
    const old = localStorage.getItem(KEY);
    if (old && /^[0-9a-f]{32}$/.test(old)) return old;
  } catch { /* gizli sekme: oturumluk anahtar */ }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const key = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem(KEY, key); } catch { /* yok say */ }
  return key;
}
const playerKey = getPlayerKey();
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
  // Telefon kamerası (vizör): E / Space / tık / Aksiyon = deklanşör
  if (phone.onAction(source)) return;
  // Dekorasyon modunda Aksiyon/E/tık = eşyayı yerleştir
  if (house.build.active) house.place();
  // Dış cephe modunda: sprey (basılı tut) / tabela / balkon
  else if (exterior.active) exterior.action();
  // Bar: eylem sürerken girdi yutulur; elde yiyecek varsa ve hedef yoksa ısırır
  // Restoran mutfağı: eylem sürerken (ya da buzdolabından malzemeler alınırken) girdi yutulur
  else if (basement.onAction(source)) return; // Eğlence Katı: oyun modunda Aksiyon oyuna gider
  else if (kitchen.onAction(source)) return;
  else if (!bar.onAction(source)) interaction.trigger(source);
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

const sfx = new Sfx(); // paylaşılan WebAudio sentezi (kıkırdama, dökme, çalkalama, ısırma…)
const trip = new TripEffects({ engine, player, collision, hud, net, remotes, settings, audio: sfx });
const vm = new ViewModel({ engine, settings }); // birinci şahıs eller
const tv = new InteractiveTV({ net, hud, modal, engine, device, settings });
const house = new HouseSystem({
  engine, building: world.house, collision, net, hud, interaction, player, remotes, device, tv,
});
tv.house = house;
house.getWallet = () => shop.wallet;
// Achterstraat'taki oyuncu evleri: kapılar, zil, misafir erişimi
const visits = new HouseVisitingSystem({
  engine, net, hud, interaction, player, house, world: world.playerHouses, device, sfx, settings,
});
// Dekorasyon modu komutları (B, R, C, X, 1-9) coffee shop'tan ÖNCE işlenir
// Bar 'consume' (F) komutunu elde yiyecek varsa sahiplenir (coffee shop'a gitmez)
input.onCommand((cmd) => basement.command(cmd) || phone.command(cmd) || exterior.command(cmd) || house.command(cmd) || tv.command(cmd) || bar.command(cmd) || visits.command(cmd) || chat.command(cmd) || kitchen.command(cmd) || recipes.command(cmd) || travel.command(cmd));
const shop = new CoffeeShopSystem({ net, hud, interaction, input, modal, device });
// Shop'tan SONRA: boşta ipucu zincirini (idleHint) sarar
const bar = new BarSystem({
  engine, net, hud, interaction, player, remotes, guests, settings, sfx, vm,
  view: world.bar, device, getWallet: () => shop.wallet,
});
// Bar: 30 alkolsüz içecek — tarif kitabı (K / kürsü / 📖) ve soğutucu dolap + fıçı kulesi
const recipes = new RecipeBook({ interaction, modal, player });
const mixology = new MixologyBarSystem({ bar, hud, modal, recipes });
// Gece döngüsü (yatakta uyuma) ve ev bahçesi (saksı + tohum)
const night = new NightCycle({
  engine, net, hud, interaction, player, house, state, world, device, sfx, settings,
});
const botany = new HerbalBotanySystem({
  engine, net, hud, interaction, house, state, modal, device, sfx, settings, vm,
});
// Bar müdavimleriyle arkadaşlık (sohbet, espri, içecek ısmarlama, eve davet)
const friends = new NpcRelationshipSystem({
  engine, net, hud, interaction, house, bar, modal, device, settings, sfx,
});
// Şehir içi ulaşım (bisiklet / scooter, arkaya yolcu) ve oda tamiratı (mini oyunlar)
const vehicles = new CityVehicleSystem({
  engine, net, hud, interaction, player, remotes, collision, modal, device, settings, sfx, getWallet: () => shop.wallet,
});
// Yeraltı Kart Kulübü (steeg'deki gizli kapı: blackjack, poker, zar — 18+ onayı coffee shop'la ortak)
const casino = new UndergroundCasino({
  engine, net, hud, interaction, player, modal, device, sfx, shop, state, world, vehicles, collision,
});
const maint = new HotelMaintenanceSystem({
  engine, net, hud, interaction, player, collision, modal, device, settings, sfx, vm,
});
// Oyuncular arası sohbet (Enter / 💬) ve konuşma balonları
const chat = new ChatSystem({ engine, net, hud, input, remotes, device, settings, sfx });
// Otelin büyümesi: Resepsiyon PC (yıldız, kat, çalışan), asansör, temizlikçiler
const workers = new HotelWorkerSystem({ guests, hud });
const reception = new ReceptionPC({
  engine, net, hud, interaction, player, modal, device, sfx, state, workers,
});
reception.onChange.push((h) => workers.setState(h));
// Gurme Restoran "De Gouden Lepel" (lobinin batısı): masalar, açık büfe, siparişler, aşçı / garson; FPV mutfak
const restaurant = new GourmetRestaurant({
  engine, net, hud, interaction, player, guests, view: world.restaurant, workers,
});
const kitchen = new KitchenSystem({
  engine, net, hud, interaction, player, modal, settings, sfx, device, restaurant, remotes,
});
// Achterstraat canlı müzik sahnesi (Resepsiyon PC'den satın alınır) + konser kalabalığı
const stage = new LiveStageSystem({
  engine, net, hud, interaction, player, modal, sfx, settings, state, mats, collision,
  isPaused: () => document.hidden || !document.getElementById('overlay').hidden,
});
reception.stage = stage;
const street = new StreetEvents({ guests, world, player, camera: engine.camera, stage, settings });
// Akıllı telefon (P / 📱): kamera + galeri, InstaHotel reklam kampanyaları (turist akını), otel özeti
const phone = new SmartphoneSystem({
  engine, input, player, modal, device, settings, sfx, state, net, hud, house, reception, touch,
});
const insta = new InstaHotelMarketing({ net, hud, phone, state, settings, sfx });
// Ev matbaası + polis baskını ve hızlı ışınlanma (M / telefonda 🗺️ Işınlan)
const press = new HomeCounterfeitSystem({ engine, net, hud, interaction, house, player, sfx, settings });
const travel = new FastTravelSystem({ net, hud, modal, player, interaction, engine, phone, house });
// Oyuncu evlerinin dış cephesi: graffiti, neon tabela, balkon (evinin önünde B / 🛠 Dekor)
const exterior = new ExteriorCustomization({
  engine, net, hud, interaction, player, house, device, touch, modal, sfx, settings, getWallet: () => shop.wallet,
});
house.exterior = exterior;
// Yeraltı garajı + AutoGalerie (telefonda 🚗) + arabalar ve drag pisti. Garaj ve pist ayrı gruplardır;
// oradayken otel dünyası çizilmez (partitionWorld: o ana kadar kurulmuş sahne = otel dünyası).
const garage = new UndergroundGarage({
  engine, net, hud, interaction, player, remotes, collision, modal, device, settings, sfx, vehicles, phone, state, input,
  getWallet: () => shop.wallet,
});
const drag = new DragRaceTrack({ engine, net, hud, player, modal, device, settings, sfx, garage, vehicles, remotes, state, input });
// −1. Kat VIP Eğlence Katı (lobideki merdiven kapısı / asansörün "−1" durağı / 🎳 ışınlanma): bilardo, langırt,
// masa tenisi, atari, bowling. Garajın alan yöneticisine 'basement' alanı olarak eklenir (partitionWorld'den önce).
const basement = new EntertainmentBasement({
  engine, net, hud, interaction, player, input, modal, device, settings, sfx, collision, garage, reception, guests, touch,
});
garage.partitionWorld([interaction.marker]);
// Neon / ampul parıltısı gece güçlenir: dünyanın gece seviyesi değişince (tek seferlik geçiş) bildir
const setNightLevel = world.setNightLevel;
world.setNightLevel = (t) => {
  setNightLevel.call(world, t);
  exterior.setNight(t);
  stage.setNight(t);
  garage.setNight(t);
  drag.setNight(t);
};
// Lüks paketler: 8 / 12 katlı bina, lüks iç mekân, lounge barlar, çatı Aqua Park, VIP suitleri (PC → Yükseltmeler)
const arch = new HotelArchitectureUpgrades({
  engine, net, player, state, world, mats, factory, collision, maint, reception, night,
});
// Otel odasında çöp toplarken birinci şahıs toplama animasyonu
const TRASH_ITEMS = ['paper', 'can', 'box', 'bottle'];
interaction.onRoomAction = (room, t) => {
  if (t.kind !== 'trash' || bar.local) return;
  vm.play('pickup', 650, { item: TRASH_ITEMS[t.target] ?? 'paper', after: bar.vmHold(bar.hold) });
};

let started = false; // oyuncu "Oyna"ya bastı
let joined = false; // bu bağlantıda sunucu "welcome" gönderdi
let positioned = false; // ilk doğma konumu alındı

// ---- Kare sistemleri (sıra önemli) ------------------------------------------------

const ctx = { px: 0, pz: 0, guestNear: (x, z, r) => guests.near(x, z, r) };
engine.addSystem((dt) => player.update(dt));
engine.addSystem((dt) => guests.update(dt, net.serverNow(), engine.camera));
engine.addSystem((dt) => remotes.update(dt));
engine.addSystem((dt) => trip.update(dt));
engine.addSystem((dt) => house.update(dt));
engine.addSystem(() => exterior.update());
engine.addSystem((dt) => visits.update(dt));
engine.addSystem((dt) => night.update(dt));
engine.addSystem(() => vehicles.update());
engine.addSystem((dt) => garage.update(dt)); // araba kokpiti: FOV, titreşim, motor sesi, gösterge (yalnızca sürerken)
engine.addSystem((dt) => drag.update(dt)); // ışık ağacı, otomatik sahne, canlı süre (yalnızca pistte)
engine.addSystem(() => bar.update());
engine.addSystem(() => restaurant.update()); // ocak ateşi / fırın / bıçak (yalnızca restorandayken)
engine.addSystem(() => kitchen.update()); // mutfak elleri + ilerleme çubuğu
engine.addSystem((dt) => basement.update(dt)); // Eğlence Katı: top / labut animasyonları, oyun kamerası (yalnızca bodrumda)
engine.addSystem(() => press.update()); // polis lambası (yalnızca polis kapıdayken)
engine.addSystem((dt) => stage.update(dt));
engine.addSystem(() => street.update());
engine.addSystem((dt) => vm.update(dt));
engine.addSystem((dt) => arch.update(dt));
engine.addSystem((dt) => {
  ctx.px = player.pos.x;
  ctx.pz = player.pos.z;
  return world.update(dt, ctx);
});
engine.addSystem(() => {
  interaction.update();
  if (player.moved && joined) {
    net.sendMove(player.pos.x, player.pos.z, player.yaw);
    press.onMoved();
  }
  if (player.moved) garage.onMoved(); // garaj / pist bölgesi, rampa ve tünel geçitleri
  if (player.moved) stage.onMoved(); // sahne müziği: dinleyici konumu + bölge (yalnızca hareket edince)
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
  sfx.unlock(); // tarayıcılar sesi yalnızca kullanıcı hareketiyle açar
  if (!started) {
    started = true;
    settings.name = nameInput.value.trim().slice(0, 16);
    saveSettings(settings);
    if (net.connected) net.join(settings.name, playerKey);
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
  } else if (phone.viewfinder) {
    phone.onEscape(); // vizörde Esc: telefona dön (duraklatma ekranı değil)
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
  if (phone.onEscape()) return;
  if (basement.onEscape()) return; // oyun modundan çık
  if (house.build.active) {
    house.toggleBuild(false);
    return;
  }
  if (exterior.active) {
    exterior.toggle(false);
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
  if (started) net.join(settings.name, playerKey);
});
net.on('disconnect', (reason) => {
  joined = false;
  // Aynı anahtarla başka sekmede açılınca sunucu bu oturumu kapatır; yeniden bağlanılmaz
  if (reason === 'io server disconnect') {
    hud.setConnection('Oyun başka bir sekmede açıldı. Bu sekmede devam etmek için sayfayı yenile.', true);
    return;
  }
  hud.setConnection('Bağlantı koptu, yeniden bağlanılıyor…', true);
  hud.toast('Sunucu bağlantısı koptu, yeniden bağlanılıyor…', 'warn');
});
net.on('connect_error', () => {
  hud.setConnection('Sunucuya ulaşılamıyor, tekrar deneniyor…', true);
});

let serverBuild = null; // ilk bağlantıdaki sunucu sürümü
net.on(EVT.WELCOME, (snap) => {
  // Oyun güncellendi (sayfa açıkken yeni sürüm yayına girdi): eski kodla devam etmek yerine yenile
  if (serverBuild && snap.build && snap.build !== serverBuild) {
    hud.setConnection('🔄 Oyun güncellendi — sayfa yenileniyor…', true);
    setTimeout(() => window.location.reload(), 1200);
    return;
  }
  serverBuild = snap.build ?? serverBuild;
  joined = true;
  state.selfId = snap.selfId;
  state.setClock(snap.clock);
  state.setRooms(snap.rooms);
  state.economy = snap.economy;
  shop.applySelf(snap.self);
  bar.applySelf(snap.self?.bar);
  kitchen.applySelf(snap.self?.kitchen);
  trip.setSelfTrip(snap.self?.trip);
  house.selfId = snap.selfId;
  visits.reset(); // misafir izinleri oturumluk
  visits.applySelf(snap.self);
  house.applySnapshot(snap.house);
  exterior.applySnapshot(snap.exterior);
  visits.setOwners(snap.house?.owners ?? []);
  night.reset(snap.selfId);
  night.onSleepState(snap.sleep);
  friends.reset(snap.selfId);
  friends.applySelf(snap.self?.friends);
  friends.setVisits(snap.visits);
  vehicles.reset(snap.selfId);
  vehicles.applySelf(snap.self?.vehicles);
  vehicles.setVehicles(snap.vehicles);
  maint.onRooms(snap.rooms);
  chat.reset(snap.selfId);
  chat.setHistory(snap.chat);
  casino.reset(snap.selfId);
  casino.applySnapshot(snap.casino);
  world.applyRooms(snap.rooms);
  world.setWeekend(snap.clock.weekend);
  reception.setState(snap.hotel);
  press.reset(snap.selfId);
  press.setState(snap.counterfeit);
  drag.onState(snap.drag);
  stage.onState(snap.stage);
  boostList = snap.boosts ?? [];
  insta.applySnapshot(snap.insta);
  basement.reset(snap.selfId);
  basement.onState(snap.basement);
  hud.setRooms(state.rooms);
  hud.setMoney(snap.economy.money);
  guests.clear();
  for (const g of snap.guests) guests.upsert(g);
  remotes.clear();
  for (const p of snap.players) {
    if (p.id !== snap.selfId) {
      remotes.add(p);
      bar.onRemoteBar(p.id, p.bar);
      kitchen.onRemoteKitchen(p.id, p.kitchen);
    } else if (!positioned) {
      player.setPose(p.x, p.z, p.yaw);
      positioned = true;
    }
  }
  bar.applySnapshot(snap.bar); // müşteriler (guests) yüklendikten sonra: ellerindeki bardaklar
  if (snap.restaurant) restaurant.onState(snap.restaurant, true);
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
  maint.onRooms(rooms);
  world.applyRooms(rooms);
  hud.setRooms(state.rooms);
  reception.refresh();
  interaction.invalidate();
  engine.wake();
});

net.on(EVT.ECONOMY, (e) => {
  state.economy = e;
  hud.setMoney(e.money);
  if (e.delta > 0) hud.toast(`+${formatMoney(e.delta)} · ${e.reason}`, 'money');
  else if (e.delta < 0) hud.toast(`−${formatMoney(-e.delta)} · ${e.reason}`, 'warn');
  reception.refresh();
});
net.on(EVT.HOTEL_STATE, (h) => reception.setState(h));
// Geçici bonuslar (konser kalabalığı, reklam kampanyası): üstte çip, saniyede bir kalan süre
let boostList = [];
const gameTotal = () => (state.clock ? (state.clock.days ?? 0) * 1440 + state.minuteAt(net.serverNow()) : 0);
net.on(EVT.COUNTERFEIT_STATE, (list) => press.setState(list));
net.on(EVT.COUNTERFEIT_RAID, (r) => press.onRaid(r));
net.on(EVT.BOOSTS, (list) => {
  boostList = list;
  hud.setBoosts(boostList, gameTotal());
  insta.setRush(list.find((b) => b.source === 'insta')?.untilTotal ?? null);
});
// InstaHotel: yeni gönderi (fotoğrafıyla) ve sayaçlar (beğeni / takipçi)
net.on(EVT.INSTA_FEED, (f) => insta.onFeed(f));
net.on(EVT.INSTA_STATS, (s) => insta.onStats(s));
net.on(EVT.STAGE_STATE, (s) => stage.onState(s));

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
  bar.onRemoteBar(p.id, p.bar);
  kitchen.onRemoteKitchen(p.id, p.kitchen);
  hud.toast(`${p.name} vardiyaya katıldı.`, 'info');
  engine.requestRender();
});
net.on(EVT.PLAYER_LEAVE, (id) => {
  chat.removeBubble(id);
  bar.removeRemote(id);
  kitchen.removeRemote(id);
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
  visits.applySelf(self);
  friends.applySelf(self.friends);
  vehicles.applySelf(self.vehicles);
  bar.applySelf(self.bar);
  kitchen.applySelf(self.kitchen);
  if (house.build.active) engine.requestRender(); // önizleme rengi (yeterli para var mı) güncellensin
  exterior.onSelf();
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
// Oyuncu evleri
net.on(EVT.HOUSE_OWNERS, (list) => {
  house.setOwners(list);
  visits.setOwners(list);
});
net.on(EVT.HOUSE_RING_REQ, (req) => visits.onRingRequest(req));
// Gece ve bahçe
net.on(EVT.SLEEP_STATE, (s) => night.onSleepState(s));
net.on(EVT.HOUSE_ITEM, (s) => botany.onItemState(s));
net.on(EVT.FRIEND_VISITS, (list) => friends.setVisits(list));
net.on(EVT.VEHICLES, (list) => {
  vehicles.setVehicles(list);
  garage.rerender(); // AutoGalerie'deki "Arabalarım" listesi
});
net.on(EVT.VEHICLE_SEAT, (s) => vehicles.onSeat(s));
net.on(EVT.DRAG_STATE, (s) => drag.onState(s));
net.on(EVT.CHAT, (m) => chat.onMessage(m));
net.on(EVT.HOUSE_ACCESS, (a) => visits.onAccess(a));
net.on(EVT.EXTERIOR_STATE, (s) => exterior.onState(s));
// Yeraltı Kart Kulübü
net.on(EVT.CASINO_STATE, (s) => casino.onState(s));
net.on(EVT.CASINO_PRIVATE, (p) => casino.onPrivate(p));

// Bar De Tulp
net.on(EVT.BAR_STATE, (s) => bar.onState(s));
net.on(EVT.PLAYER_BAR, (b) => {
  if (b.id !== state.selfId) bar.onRemoteBar(b.id, b);
});
// Gurme Restoran & mutfak
net.on(EVT.RESTAURANT_STATE, (s) => restaurant.onState(s));
net.on(EVT.PLAYER_KITCHEN, (k) => {
  if (k.id !== state.selfId) kitchen.onRemoteKitchen(k.id, k);
});
// −1. Kat VIP Eğlence Katı
net.on(EVT.BASEMENT_STATE, (s) => basement.onState(s));
net.on(EVT.BASEMENT_SHOT, (s) => basement.onShot(s));
net.on(EVT.BASEMENT_RT, (s) => basement.onRt(s));

// ---- Saat / FPS göstergesi (saniyede bir, render döngüsünden bağımsız) -------------

function updateClock() {
  if (!state.clock) return;
  const minute = state.minuteAt(net.serverNow());
  hud.setClock(state.clock.day, minute, state.weekend, state.isOpenAt(minute), !!state.clock.night);
  night.onClock(minute);
  hud.setBoosts(boostList, gameTotal());
  botany.onClock();
  stage.onClock();
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
window.__otel = {
  engine, state, player, net, world, interaction, settingsPanel, shop, trip, modal, house, tv, bar, vm, sfx, hud, guests, remotes, visits, night, botany, friends, vehicles, maint, chat, exterior,
  reception, workers, restaurant, kitchen, casino, recipes, mixology, stage, street, phone, insta, press, travel, arch, garage, drag,
  basement,
};
