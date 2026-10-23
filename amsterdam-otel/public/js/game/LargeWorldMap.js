import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { TRUCK_MODELS, CAR_BY_ID, CAR_XFER_BY_ID, TRUCK_RULES, isTruck, formatEuro } from '/shared/cars.js';
import {
  HWY, SERVICE_YARD, HOTEL_DELIVERY, SITES, SITE_BY_ID, ROADS, YARDS, PLAZAS, SIGNALS, NIEUW_ZUID, isDrivable, yardAt, routeTo,
  routeTimeSec, constrainToRoads, roadLimitKmh, roadProject, signalState, inHighwayRegion,
} from '/shared/worldmap.js';
import { CARGO_BY_ID, LOGI_RULES, deliveryPay, HAUL_GOOD_BY_ID, HAUL_RULES, onTimeFee, BAY_TOL } from '/shared/logistics.js';
import { signMaterial, panel } from '../world/CarWorldKit.js';
import { buildExpandedWorld } from './ExpandedWorldMap.js';
import { TrafficSystemAI } from './TrafficSystemAI.js';
import { setTrailer, articulate, turnTractor } from '../world/TruckModels.js';

const NO = { cast: false, receive: false };
const KMH = 3.6;
const BODY_ART = { 'zeeland-lx': 'LX', 'brabant-titan': 'XF', 'noordkaap-v8': 'V8' };
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);
const fmtTime = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// =====================================================================================================
// Dünya geometrisi
// =====================================================================================================

/** Şehir tarafı: otelin önündeki sokağın doğu ucunda tünel ağzı + tabela (otel dünyasının parçası) */
function buildCityPortal(scene) {
  const t = CAR_XFER_BY_ID.toHighway.zone;
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x15181c });
  const conc = new THREE.MeshLambertMaterial({ color: 0x8d8f91 });
  const x = 17.98;
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(t.maxZ - t.minZ + 0.6, 3.1), dark);
  mouth.position.set(x, 1.55, (t.minZ + t.maxZ) / 2);
  mouth.rotation.y = -Math.PI / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, t.maxZ - t.minZ + 1.4), conc);
  top.position.set(x - 0.1, 3.3, (t.minZ + t.maxZ) / 2);
  g.add(mouth, top);
  for (const z of [t.minZ - 0.45, t.maxZ + 0.45]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.3, 0.35), conc);
    p.position.set(x - 0.1, 1.65, z);
    g.add(p);
  }
  g.add(panel(signMaterial(['🛣️ A10 Ring ⇢', 'Lojistik avlusu · tır parkı'], { bg: '#1f5d43', w: 512, h: 150 }), 3.4, 1.0, x - 0.27, 4.0, (t.minZ + t.maxZ) / 2, 'x-'));
  g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  scene.add(g);
  return g;
}

// =====================================================================================================
// Ana sınıf
// =====================================================================================================

/**
 * Devasa açık dünya + FPV lojistik tırı (istemci).
 *
 *  - Harita: şehir dışı otoyol bölgesi (shared/worldmap.js) ayrı bir grup olarak garajın alan yöneticisine
 *    'highway' alanı olarak eklenir (oradayken otel dünyası çizilmez; uzak düzlem 900 m, sis). Şehre
 *    otelin önündeki sokağın doğu ucundaki tünelden gelinir (CAR_XFERS toHighway / toCity).
 *  - Sürüş kısıtı: Collision.constraints'e yol şeridi + avlu dikdörtgenleri eklenir (yoldan çıkılmaz).
 *  - Navi: sürerken (ya da aktif işin varken) bölgedeyken köşede mini harita (5 Hz yeniden çizim): yol ağı,
 *    rota çizgisi, hedef, mesafe / tahmini süre, sıradaki çıkış; 🗺️ ile tam harita.
 *  - Lojistik: Resepsiyon PC "🚛 Lojistik" sekmesi ve telefonda 🚛 uygulaması: sözleşme panosu, aktif iş,
 *    TruckCenter (tır satın al, cüzdandan). Avludaki TruckCenter binasında da E ile açılır.
 *  - Tırla yükleme körfezinde / mal kabul körfezinde durunca E: yükle / teslim et (park yerine geçer).
 *  - Yüklü dorseyle çarpma (ani hız kaybı ya da trafik aracına çarpma) → sunucuya hasar bildirimi.
 *  - Trafik: TrafficSystemAI (şerit takibi, sinyal, ışıklar, takip mesafesi; InstancedMesh); sunucunun yapay araçları
 *    (LOGI_AGENTS: ileride polis) ayrı çizilir, polislerin tepe lambası yanıp söner.
 * Pil: bölge dışındayken hiçbir iş yapılmaz; trafik yalnızca bölgedeyken ve kare çizilirken güncellenir.
 */
export class LargeWorldMap {
  constructor({ engine, net, hud, interaction, player, collision, modal, device, settings, sfx, garage, vehicles, phone, reception, state, getWallet }) {
    Object.assign(this, { engine, net, hud, interaction, player, collision, modal, device, settings, sfx, garage, vehicles, phone, reception, state, getWallet });
    this.st = { offers: [], hauls: [], jobs: [], agents: [], stats: {} };
    this.selfId = null;
    this.inRegion = false;
    this.pending = false;
    this.selColor = Object.create(null);
    this.msg = '';
    this.prevVel = 0;
    this.hitAt = 0;
    this.bumpAt = 0;
    this.naviAt = 0;
    this.route = null;
    this.routeAt = 0;
    this.agentMeshes = new Map();
    this.boardAsked = false;

    const world = buildExpandedWorld({ collision });
    this.world = world;
    engine.scene.add(world.group);
    garage.addArea('highway', world.group, HWY.far);
    this.portal = buildCityPortal(engine.scene);
    this.traffic = new TrafficSystemAI(world.group, device.touch ? 14 : 30);
    this.ego = { active: false, x: 0, z: 0, yaw: 0, vel: 0, truck: false };
    this.fog = new THREE.Fog(0xa9c7de, 220, HWY.far - 40);
    // Sis sahnede hep durur (şehirde etkisiz uzaklıkta): sis aç / kapa bütün shader'ları yeniden derletir
    this.fogNear = this.fog.near;
    this.fogFar = this.fog.far;
    this.fog.near = 1e5;
    this.fog.far = 1e5 + 1;
    engine.scene.fog = this.fog;

    // Yol kısıtı: sürerken ve yürürken (yalnızca bölgede; başka yerde hemen döner)
    collision.constraints.push((pos, r) => {
      if (pos.x < HWY.bounds.minX - 6) return;
      constrainToRoads(pos, Math.min(r, 1.6));
    });

    const prev = garage.onArea;
    garage.onArea = (id, from) => {
      prev?.(id, from);
      this.onArea(id);
    };

    // Araç eklentisine (UndergroundGarage.carHooks) dorse görünürlüğü + kıvrılma eklenir
    const hooks = vehicles.cars;
    const prevList = hooks.onList;
    hooks.onList = (list, meshes) => {
      prevList(list, meshes);
      this.onVehicles();
    };
    const prevMesh = hooks.updateMesh;
    hooks.updateMesh = (m, v, own, x, z, ry) => {
      if (m.obj.userData.truck) this.articulate(m, x, z, ry);
      prevMesh(m, v, own, x, z, ry);
    };

    this.buildUi();
    interaction.providers.unshift({ find: (px, pz, f) => this.findTarget(px, pz, f) });
    phone?.registerApp({ id: 'logistics', icon: '🚛', name: 'Lojistik', order: 5, render: (body) => this.renderBoard(body, 'phone') });
    if (reception) {
      reception.tabs.logistics = (body) => this.renderBoard(body, 'pc');
      const tabs = document.getElementById('pc-tabs');
      if (tabs && !tabs.querySelector('[data-tab="logistics"]')) {
        const btn = el('button', null, '🚛 Lojistik');
        btn.type = 'button';
        btn.dataset.tab = 'logistics';
        tabs.append(btn);
      }
    }
  }

  // ---- Durum ------------------------------------------------------------------------------------------

  reset(selfId) {
    this.selfId = selfId;
  }

  onState(s) {
    if (!s) return;
    this.st = s;
    this.syncAgents(s.agents ?? []);
    this.route = null;
    this.rerender();
    this.interaction.invalidate();
  }

  onAgents(list) {
    this.st.agents = list;
    this.syncAgents(list);
  }

  get myJob() {
    return this.st.jobs.find((j) => j.ownerId === this.selfId) ?? null;
  }

  myTrucks() {
    return this.vehicles.list.filter((v) => v.type === 'car' && v.ownerId === this.vehicles.selfId && isTruck(v.model));
  }

  /** Kendi tırını sürüyor mu → araç kaydı */
  drivingTruck() {
    const seat = this.vehicles.seat;
    if (seat?.seat !== 'driver') return null;
    const v = this.vehicles.byId.get(seat.id);
    return v && isTruck(v.model) ? v : null;
  }

  /** Sürülen tırın dorsesi: çekicinin dönüşü + gidilen yol (CityVehicleSystem.update'ten, araç başına) */
  articulate(m, x, z, ry) {
    const obj = m.obj;
    const ly = m.lry ?? ry;
    m.lry = ry;
    turnTractor(obj, Math.atan2(Math.sin(ry - ly), Math.cos(ry - ly)));
    // İleri yön (model: önü +Z) = (sin ry, cos ry)
    articulate(obj, (x - m.lx) * Math.sin(ry) + (z - m.lz) * Math.cos(ry));
  }

  /** VEHICLES listesi geldi: tırlarda dorse görünürlüğü */
  onVehicles() {
    for (const v of this.vehicles.list) {
      if (v.type !== 'car' || !isTruck(v.model)) continue;
      const m = this.vehicles.meshes.get(v.id);
      if (m) setTrailer(m.obj, v.trailer ? (v.trailer.cargo ?? 'haul') : null); // kiralık şoförlük dorsesi: firma yükü
    }
    this.rerender();
  }

  onArea(id) {
    this.inRegion = id === 'highway';
    const scene = this.engine.scene;
    if (scene.fog !== this.fog) scene.fog = this.fog;
    if (this.inRegion) {
      this.fog.near = this.fogNear;
      this.fog.far = this.fogFar;
      this.fog.color.copy(scene.background?.isColor ? scene.background : this.fog.color);
      if (!this.boardAsked) this.requestBoard();
      this.world.setView(this.player.pos.x, this.player.pos.z, true);
    } else {
      this.fog.near = 1e5; // şehirde etkisiz
      this.fog.far = 1e5 + 1;
      this.traffic.reset();
    }
    this.el.navi.hidden = true;
    this.naviAt = 0;
    for (const m of this.agentMeshes.values()) m.visible = this.inRegion;
    this.engine.requestRender();
  }

  async requestBoard() {
    this.boardAsked = true;
    const res = await this.net.request(EVT.LOGI_ACT, { act: 'board' });
    if (res?.ok && res.state) this.onState(res.state);
  }

  // ---- Hedefler (E) ----------------------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (!this.inRegion && !inHighwayRegion(px, pz, 4)) return null;
    const truck = this.drivingTruck();
    const job = this.myJob;
    if (truck && job?.legal === false && this.illegal) return this.illegal.findTarget(px, pz, f, truck); // kaçak iş (IllegalLogistics)
    if (truck && job?.kind === 'haul') {
      // Kiralık şoförlük: firmanın tırıyla bir depodan / limandan diğerine
      const at = { x: px, z: pz, marker: false };
      const g = HAUL_GOOD_BY_ID[job.goods];
      if (truck.id !== job.vehicleId) return null;
      if (job.state === 'accepted' && pointIn(SITE_BY_ID[job.site].load, px, pz, BAY_TOL)) {
        return { ...at, short: 'Yükle', label: `📦 ${job.company}: ${job.pallets} palet ${g.name} yükle`, use: () => this.act('load') };
      }
      if (job.state === 'loaded' && truck.trailer && pointIn(SITE_BY_ID[job.to].load, px, pz, BAY_TOL)) {
        return { ...at, short: 'Teslim', label: `📦 ${SITE_BY_ID[job.to].short}: ${job.company} yükünü boşalt`, use: () => this.act('deliver') };
      }
      return bayHint(job.state === 'accepted' ? SITE_BY_ID[job.site].load : SITE_BY_ID[job.to].load, px, pz, job.state === 'accepted' ? 'yükleme' : 'boşaltma', this.hud);
    }
    if (truck) {
      const at = { x: px, z: pz, marker: false };
      if (job?.state === 'accepted') {
        const s = SITE_BY_ID[job.site];
        if (pointIn(s.load, px, pz, BAY_TOL)) return { ...at, short: 'Yükle', label: `📦 ${s.short}: ${job.pallets} palet ${CARGO_BY_ID[job.cargo].name} yükle (${formatEuro(job.wholesale)} — kasadan, kasa yetmezse cüzdandan)`, use: () => this.act('load') };
      }
      if (job?.state === 'loaded' && truck.trailer && pointIn(HOTEL_DELIVERY.zone, px, pz, BAY_TOL)) {
        return { ...at, short: 'Teslim', label: '🏨 Mal kabul: yükü teslim et', use: () => this.act('deliver') };
      }
      if (job?.state === 'accepted') return bayHint(SITE_BY_ID[job.site].load, px, pz, 'yükleme', this.hud);
      if (job?.state === 'loaded' && truck.trailer) return bayHint(HOTEL_DELIVERY.zone, px, pz, 'mal kabul', this.hud);
      return null;
    }
    if (this.vehicles.seat) return null;
    const extra = this.illegal?.findTarget(px, pz, f, null); // limandaki tanıdık (yaya)
    if (extra) return extra;
    const K = SERVICE_YARD.dealer;
    const dx = K.point[0] - px;
    const dz = K.point[1] - pz;
    const d = Math.hypot(dx, dz);
    if (d < K.range && (d < 0.8 || (dx * f.x + dz * f.z) / d > 0.3)) {
      return { x: K.x, z: K.z + 0.5, marker: false, short: 'Tır', label: '🚛 TruckCenter — tır satın al / Lojistik panosu', use: () => this.openDealer() };
    }
    return null;
  }

  async act(act) {
    if (this.pending) return;
    this.pending = true;
    const res = await this.net.request(EVT.LOGI_ACT, { act });
    this.pending = false;
    if (!res?.ok) {
      this.hud.toast(res?.error || 'Olmadı.', 'warn');
      return;
    }
    if (act === 'load') {
      const job = this.myJob;
      this.hud.toast(job?.kind === 'haul'
        ? `📦 Yüklendi! ${SITE_BY_ID[job.to].icon} ${SITE_BY_ID[job.to].name} boşaltma körfezine götür.`
        : '📦 Yüklendi! Dorse takıldı — otelin lojistik avlusundaki 🏨 mal kabul körfezine götür.', 'info');
      if (this.settings.sound) this.sfx?.clink?.();
    } else if (act === 'deliver' && this.settings.sound) this.sfx?.coin?.();
    this.route = null;
  }

  // ---- Arayüz (DOM) ------------------------------------------------------------------------------------

  buildUi() {
    const navi = el('div', 'navi');
    navi.id = 'navi';
    navi.hidden = true;
    const canvas = el('canvas');
    const size = this.device.touch ? 150 : 210;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const info = el('div', 'navi-info');
    const big = el('button', 'navi-map', '🗺️');
    big.type = 'button';
    big.title = 'Tam harita';
    big.addEventListener('click', () => this.openMap());
    navi.append(canvas, info, big);
    document.body.append(navi);

    const mapPanel = el('div', 'overlay');
    mapPanel.id = 'world-map-panel';
    mapPanel.hidden = true;
    const card = el('div', 'card world-map-card');
    const title = el('h2', null, '🗺️ A10 Ring — Lojistik haritası');
    const mapCanvas = el('canvas', 'world-map-canvas');
    mapCanvas.width = 1020;
    mapCanvas.height = 770;
    const legend = el('p', 'sub world-map-legend');
    const close = el('button', 'primary', 'Kapat');
    close.type = 'button';
    close.addEventListener('click', () => this.modal.close(mapPanel));
    card.append(title, mapCanvas, legend, close);
    mapPanel.append(card);
    document.body.append(mapPanel);

    const dealer = el('div', 'overlay');
    dealer.id = 'logi-panel';
    dealer.hidden = true;
    const dcard = el('div', 'card logi-card');
    const dbody = el('div', 'logi-body');
    const dclose = el('button', 'secondary', 'Kapat');
    dclose.type = 'button';
    dclose.addEventListener('click', () => this.modal.close(dealer));
    dcard.append(dbody, dclose);
    dealer.append(dcard);
    document.body.append(dealer);

    this.el = { navi, canvas, info, ctx: canvas.getContext('2d'), size, dpr, mapPanel, mapCanvas, legend, dealer, dbody };
  }

  openDealer() {
    this.msg = '';
    this.renderBoard(this.el.dbody, 'kiosk');
    this.modal.open(this.el.dealer);
    if (!this.st.offers.length) this.requestBoard();
  }

  openMap() {
    this.drawMap(this.el.mapCanvas.getContext('2d'), 1020, 770, null);
    const job = this.myJob;
    const goal = job?.kind === 'haul' && job.state !== 'accepted'
      ? `${SITE_BY_ID[job.to].icon} ${SITE_BY_ID[job.to].name} (boşalt)`
      : job?.state === 'accepted' ? `${SITE_BY_ID[job.site].icon} ${SITE_BY_ID[job.site].name} (yükle)` : '🏨 Otelin mal kabul körfezi (teslim)';
    this.el.legend.textContent = job
      ? `Hedef: ${goal} · mor çizgi: rota`
      : '🏨 Lojistik avlusu (otel) · 🥩 VersMarkt · 🧃 FrisDepot · 🎳 ArcadeWorks · ⚓ Liman';
    this.modal.open(this.el.mapPanel);
  }

  rerender() {
    if (!this.el.dealer.hidden) this.renderBoard(this.el.dbody, 'kiosk');
    if (this.phone?.isOpen && this.phone.current?.id === 'logistics') this.phone.rerender();
    if (this.reception?.tab === 'logistics' && !this.reception.el.panel.hidden) this.reception.render();
  }

  /** Lojistik panosu: aktif iş, teklifler, tırlarım, TruckCenter kataloğu */
  renderBoard(box, where) {
    box.replaceChildren();
    if (!this.boardAsked && !this.st.offers.length) this.requestBoard();
    const root = el('div', `logi${where === 'phone' ? ' in-phone' : ''}`);
    const wallet = this.getWallet();
    const kasa = this.state.economy?.money ?? 0;
    const trucks = this.myTrucks();
    const st = this.st.stats ?? {};
    root.append(el('div', 'logi-head', `🎒 ${formatEuro(wallet)} · 🏨 Kasa ${formatEuro(kasa)} · 📦 ${st.deliveries ?? 0} teslimat · ${(st.km ?? 0).toFixed(1).replace('.', ',')} km`));
    if (this.msg) root.append(el('p', 'logi-msg', this.msg));
    const job = this.myJob;
    if (job) root.append(job.legal === false && this.illegal ? this.illegal.jobCard(job) : job.kind === 'haul' ? this.haulCard(job) : this.jobCard(job));
    else if (!trucks.length) root.append(el('p', 'logi-hint', '🚛 Tırın yoksa aşağıdaki 🚚 Kiralık şoförlük ilanlarıyla firmaların tırını sürebilirsin. Otel sevkiyatı için kendi tırını al (aşağıda TruckCenter). Tır, şehir dışındaki lojistik avlusunun tır parkına teslim edilir — otelin önündeki sokağın doğu ucundaki 🛣️ tünelden ya da 🗺️ Işınlan → 🚛 Lojistik avlusu ile gidilir.'));
    // Teklifler
    root.append(el('div', 'logi-sub', '📋 Sözleşme panosu'));
    const list = el('div', 'logi-offers');
    const now = this.net.serverNow();
    for (const o of this.st.offers) {
      const c = CARGO_BY_ID[o.cargo];
      const s = SITE_BY_ID[o.site];
      const row = el('div', 'logi-offer');
      row.append(el('div', 'lo-icon', c.icon));
      const info = el('div', 'lo-info');
      info.append(el('b', null, `${o.pallets} palet ${c.name}`), el('small', null, `${s.icon} ${s.name} → 🏨 otel · ${fmtKm(o.dist * 2)} · süre ${fmtTime(o.timeSec)}`));
      info.append(el('small', null, `Toptan ${formatEuro(o.wholesale)} (kasadan) → değer ${formatEuro(o.value)} · şoför ücreti ${formatEuro(onTimeFee(o.fee))} (zamanında; geç: ${formatEuro(Math.round(o.fee * LOGI_RULES.LATE_MUL))}) · ${fmtTime((o.expires - now) / 1000)} sonra kalkar`));
      const btn = el('button', 'lo-take', 'Al');
      btn.type = 'button';
      btn.disabled = !!job || !trucks.length || this.pending;
      btn.addEventListener('click', () => this.accept(o.id));
      row.append(info, btn);
      list.append(row);
    }
    if (!this.st.offers.length) list.append(el('p', 'logi-hint', 'Pano yükleniyor…'));
    root.append(list);
    // Kiralık şoförlük: başkalarının tırı, başkalarının malı
    root.append(el('div', 'logi-sub', '🚚 Kiralık şoförlük — firmanın tırı, firmanın malı (tır gerekmez, ücret düşük)'));
    const hl = el('div', 'logi-offers');
    for (const o of this.st.hauls ?? []) {
      const g = HAUL_GOOD_BY_ID[o.goods];
      const a = SITE_BY_ID[o.site];
      const b = SITE_BY_ID[o.to];
      const row = el('div', 'logi-offer');
      row.append(el('div', 'lo-icon', g.icon));
      const info = el('div', 'lo-info');
      info.append(el('b', null, `${o.company}: ${o.pallets} palet ${g.name}`), el('small', null, `${a.icon} ${a.name} → ${b.icon} ${b.name} · ${fmtKm(o.dist)} · süre ${fmtTime(o.timeSec)}`));
      info.append(el('small', null, `Tır firmadan (avludaki tır parkına gelir) · kasaya dokunulmaz · şoför ücreti ${formatEuro(onTimeFee(o.fee))} (zamanında) · ${fmtTime((o.expires - now) / 1000)} sonra kalkar`));
      const btn = el('button', 'lo-take', 'Al');
      btn.type = 'button';
      btn.disabled = !!job || this.pending;
      btn.addEventListener('click', () => this.accept(o.id));
      row.append(info, btn);
      hl.append(row);
    }
    if (!(this.st.hauls ?? []).length) hl.append(el('p', 'logi-hint', 'İlan yükleniyor…'));
    root.append(hl);
    // Tırlarım
    if (trucks.length) {
      root.append(el('div', 'logi-sub', '🅿️ Tırlarım'));
      for (const v of trucks) {
        const m = CAR_BY_ID[v.model];
        const where = yardAt(v.x, v.z);
        const place = where === 'yard' ? 'lojistik avlusunda' : where ? `${SITE_BY_ID[where]?.short ?? ''}'da` : 'yolda';
        const row = el('div', 'logi-mine');
        const dot = el('i');
        dot.style.background = m.colors[v.color]?.hex ?? '#888';
        const load = v.trailer ? ` · 📦 ${CARGO_BY_ID[v.trailer.cargo]?.name ?? HAUL_GOOD_BY_ID[v.trailer.goods]?.name ?? ''}` : '';
        row.append(dot, el('span', null, `${m.name}${v.haul ? ` (${v.ownerName} — firmanın tırı)` : ''} — ${place}${load}${v.driver != null ? ' (sürülüyor)' : ''}`));
        root.append(row);
      }
    }
    // TruckCenter
    root.append(el('div', 'logi-sub', '🚛 TruckCenter — tır satın al (cüzdandan)'));
    const cat = el('div', 'logi-trucks');
    const full = trucks.length >= TRUCK_RULES.MAX_PER_PLAYER;
    for (const m of TRUCK_MODELS) {
      const sel = this.selColor[m.id] ?? 0;
      const card = el('div', 'truck-card');
      const art = el('div', 'truck-art', BODY_ART[m.id] ?? '🚛');
      art.style.setProperty('--paint', m.colors[sel].hex);
      const info = el('div', 'truck-info');
      info.append(el('b', null, m.name), el('div', 'truck-price', formatEuro(m.price)));
      info.append(el('small', null, `🐎 ${m.hp} bg · ${m.gears} vites · 0–60 ${m.t60} sn · en yüksek hız ${m.topKmh} km/s`));
      info.append(el('div', 'truck-desc', m.desc));
      const colors = el('div', 'car-colors');
      m.colors.forEach((c, i) => {
        const b = el('button', i === sel ? 'on' : '');
        b.type = 'button';
        b.title = c.name;
        b.setAttribute('aria-label', c.name);
        b.style.background = c.hex;
        b.addEventListener('click', () => {
          this.selColor[m.id] = i;
          this.rerender();
          if (where === 'pc') this.reception.render();
        });
        colors.append(b);
      });
      info.append(colors);
      const buy = el('button', 'truck-buy', full ? `En fazla ${TRUCK_RULES.MAX_PER_PLAYER} tır` : `Satın al · ${formatEuro(m.price)}`);
      buy.type = 'button';
      buy.disabled = full || wallet < m.price;
      buy.addEventListener('click', () => this.buy(m, sel));
      card.append(art, info, buy);
      cat.append(card);
    }
    root.append(cat);
    this.illegal?.renderBoard(root, where); // 🕶️ gizli bölme + limandaki tanıdık (IllegalLogistics)
    box.append(root);
  }

  jobCard(job) {
    const s = SITE_BY_ID[job.site];
    const c = CARGO_BY_ID[job.cargo];
    const card = el('div', 'logi-job');
    const left = (job.deadline - this.net.serverNow()) / 1000;
    card.append(el('b', null, `${c.icon} Aktif sevkiyat: ${job.pallets} palet ${c.name}`));
    const step = job.state === 'accepted'
      ? `1/2 · ${s.icon} ${s.name} yükleme körfezine git, dur, E: yükle (${formatEuro(job.wholesale)} — kasadan, kasa yetmezse cüzdandan)`
      : '2/2 · 🏨 Otelin lojistik avlusundaki mal kabul körfezine götür, dur, E: teslim';
    card.append(el('div', null, step));
    const pay = deliveryPay(job, this.net.serverNow());
    card.append(el('small', null, `${left > 0 ? `⏱ ${fmtTime(left)} kaldı` : '⏱ Gecikti!'} · hasar %${Math.round(job.damage * 100)} · beklenen: kasaya ${formatEuro(job.state === 'loaded' ? pay.value : job.value)}, sana ${formatEuro(job.state === 'loaded' ? pay.fee : onTimeFee(job.fee))}`));
    const row = el('div', 'logi-job-btns');
    const map = el('button', null, '🗺️ Harita');
    map.type = 'button';
    map.addEventListener('click', () => this.openMap());
    const cancel = el('button', 'danger', job.state === 'loaded' ? 'İptal (yükün yarısı iade)' : 'İptal');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.cancel());
    row.append(map, cancel);
    card.append(row);
    return card;
  }

  /** Kiralık şoförlük işi kartı */
  haulCard(job) {
    const a = SITE_BY_ID[job.site];
    const b = SITE_BY_ID[job.to];
    const g = HAUL_GOOD_BY_ID[job.goods];
    const card = el('div', 'logi-job');
    const left = (job.deadline - this.net.serverNow()) / 1000;
    card.append(el('b', null, `${g.icon} ${job.company}: ${job.pallets} palet ${g.name}`));
    const step = job.state === 'accepted'
      ? `1/2 · Avludaki tır parkından firmanın tırına bin → ${a.icon} ${a.name} yükleme körfezi, dur, E: yükle`
      : `2/2 · ${b.icon} ${b.name} boşaltma körfezine götür, dur, E: boşalt (tır sonra firmaya döner)`;
    card.append(el('div', null, step));
    const pay = deliveryPay(job, this.net.serverNow());
    card.append(el('small', null, `${left > 0 ? `⏱ ${fmtTime(left)} kaldı` : '⏱ Gecikti!'} · hasar %${Math.round(job.damage * 100)} · sana ${formatEuro(job.state === 'loaded' ? pay.fee : onTimeFee(job.fee))} (firma tırı: €${HAUL_RULES.FEE_MIN}–${HAUL_RULES.FEE_MAX}; kendi tırınla €${LOGI_RULES.FEE_MIN}–${LOGI_RULES.FEE_MAX})`));
    const row = el('div', 'logi-job-btns');
    const map = el('button', null, '🗺️ Harita');
    map.type = 'button';
    map.addEventListener('click', () => this.openMap());
    const cancel = el('button', 'danger', 'İptal (tır firmaya döner)');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.cancel());
    row.append(map, cancel);
    card.append(row);
    return card;
  }

  async accept(offer) {
    if (this.pending) return;
    this.pending = true;
    const res = await this.net.request(EVT.LOGI_ACT, { act: 'accept', offer });
    this.pending = false;
    this.msg = res?.ok ? `✓ ${res.text}` : res?.error || 'Alınamadı.';
    this.hud.toast(this.msg, res?.ok ? 'info' : 'warn');
    this.route = null;
    this.rerender();
  }

  async cancel() {
    const res = await this.net.request(EVT.LOGI_ACT, { act: 'cancel' });
    this.msg = res?.ok ? `Sevkiyat iptal edildi${res.refund ? ` — kasaya ${formatEuro(res.refund)} iade` : ''}.` : res?.error || '';
    this.rerender();
  }

  async buy(m, color) {
    const res = await this.net.request(EVT.CAR_ACT, { act: 'buy', model: m.id, color, source: 'wallet' });
    this.msg = res?.ok ? `✓ ${m.name} senin! Lojistik avlusunda ${res.bay ?? 'tır parkına'} park edildi.` : res?.error || 'Satın alınamadı.';
    this.hud.toast(`🚛 ${this.msg}`, res?.ok ? 'money' : 'warn');
    setTimeout(() => this.rerender(), 250);
  }

  // ---- Navi ---------------------------------------------------------------------------------------------

  /** Aktif hedef: iş adımına göre depo / otel */
  destination() {
    const job = this.myJob;
    if (!job) return null;
    if (job.legal === false) return job.state === 'accepted' ? 'port' : 'drinks'; // K-17 (liman) → Eski Kantar Deposu (FrisDepot)
    if (job.kind === 'haul') return job.state === 'accepted' ? job.site : job.to; // kiralık şoförlük: depo → depo
    return job.state === 'accepted' ? job.site : 'hotel';
  }

  updateNavi(now) {
    const show = this.inRegion && (this.vehicles.seat?.seat === 'driver' || !!this.myJob);
    if (this.el.navi.hidden === show) this.el.navi.hidden = !show;
    if (!show || now - this.naviAt < 200) return;
    this.naviAt = now;
    const { x, z } = this.player.pos;
    const dest = this.destination();
    if (dest && (!this.route || now - this.routeAt > 1000)) {
      this.route = routeTo(x, z, dest);
      this.routeAt = now;
    } else if (!dest) this.route = null;
    const { ctx, size, dpr } = this.el;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawMap(ctx, size, size, { x, z, zoom: 0.5 });
    // Metin
    let text = '';
    if (this.route) {
      const turn = this.nextTurn(x, z, dest);
      text = `${fmtKm(this.route.length)} · ~${fmtTime(routeTimeSec(this.route) * 1.15)} · ⛔ ${roadLimitKmh(x, z)} km/s${turn ? `\n${turn}` : ''}`;
    } else {
      const p = roadProject(x, z);
      const name = p && p.d <= p.half + 2 ? ROADS.find((r) => r.id === p.road)?.name : null;
      text = `${name ?? 'Şehir dışı'} · ⛔ ${roadLimitKmh(x, z)} km/s`;
    }
    if (this.el.info.textContent !== text) this.el.info.textContent = text;
  }

  /** Sıradaki manevra: rota adımlarından (kavşak dönüşü / çıkış / avluya giriş) */
  nextTurn(x, z, dest) {
    const destSite = dest === 'hotel' ? 'yard' : dest;
    const here = yardAt(x, z, 1);
    const hint = this.illegal?.turnHint(here, destSite);
    if (hint) return hint;
    if (here === destSite) return dest === 'hotel' ? '🏨 Sarı çerçeveli mal kabul körfezinde dur → E' : '📦 Sarı çerçeveli yükleme körfezinde dur → E';
    const r = this.route;
    if (!r) return '';
    const step = r.steps?.find((st) => st.dist > 8) ?? r.steps?.[r.steps.length - 1];
    if (!step) return '';
    const ARROW = { left: '↰', right: '↱', straight: '⬆', uturn: '↶', arrive: '🏁' };
    const d = fmtKm(step.dist);
    if (here && step.dist < 60) return `${ARROW[step.turn] ?? '⬆'} Avludan çık: ${step.name}`;
    if (step.turn === 'arrive') return `🏁 ${d} sonra ${step.name}`;
    const exit = step.from === 'trunk' && step.kind !== 'trunk'; // otoyoldan çıkış
    const join = step.kind === 'trunk' && step.from !== 'trunk';
    const what = exit ? (/çıkış/.test(step.name) ? step.name : `${step.name} çıkışı`) : join ? `${step.name} — otoyola katıl` : step.turn === 'left' ? `sola: ${step.name}` : step.turn === 'right' ? `sağa: ${step.name}` : step.turn === 'uturn' ? 'geri dön' : `düz devam: ${step.name}`;
    return `${ARROW[step.turn] ?? '⬆'} ${d} sonra ${what}`;
  }

  /**
   * Haritayı çiz. view null → bütün bölge (tam harita); yoksa oyuncu merkezli mini harita (kuzey yukarı:
   * dünyanın −z yönü yukarı değil — kuşbakışı: x sağa, z aşağı).
   */
  drawMap(ctx, w, h, view) {
    const B = HWY.bounds;
    let k;
    let ox;
    let oz;
    if (view) {
      k = view.zoom; // px / m
      ox = view.x - w / 2 / k;
      oz = view.z - h / 2 / k;
    } else {
      k = Math.min(w / (B.maxX - B.minX), h / (B.maxZ - B.minZ));
      ox = B.minX;
      oz = B.minZ;
    }
    const X = (x) => (x - ox) * k;
    const Z = (z) => (z - oz) * k;
    ctx.fillStyle = '#2f4a2a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a4f6b';
    ctx.fillRect(X(B.maxX), 0, w, h);
    const vx0 = ox;
    const vz0 = oz;
    const vx1 = ox + w / k;
    const vz1 = oz + h / k;
    const vis = (b, pad = 0) => b.maxX + pad > vx0 && b.minX - pad < vx1 && b.maxZ + pad > vz0 && b.minZ - pad < vz1;
    // Nieuw-Zuid (şehir dokusu)
    const NZ = NIEUW_ZUID.bounds;
    if (vis(NZ)) {
      ctx.fillStyle = '#4a4f55';
      ctx.fillRect(X(NZ.minX), Z(NZ.minZ), (NZ.maxX - NZ.minX) * k, (NZ.maxZ - NZ.minZ) * k);
    }
    // Avlular
    for (const y of YARDS) {
      if (!vis(y.bounds, 20)) continue;
      const b = y.bounds;
      ctx.fillStyle = y.id === 'yard' ? '#1f5d43' : '#59606a';
      ctx.fillRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
    }
    // Yollar
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.roadBox ??= new Map(ROADS.map((r) => {
      const xs = r.pts.map((p) => p[0]);
      const zs = r.pts.map((p) => p[1]);
      return [r.id, { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }];
    }));
    const order = { urban: 0, spur: 1, trunk: 2 };
    for (const r of [...ROADS].sort((a, b) => order[a.kind] - order[b.kind])) {
      if (!vis(this.roadBox.get(r.id), 20)) continue;
      ctx.strokeStyle = r.kind === 'trunk' ? '#f0c45a' : r.kind === 'spur' ? '#d8d3c4' : '#b9b4a6';
      ctx.lineWidth = Math.max(view ? (r.kind === 'urban' ? 2.5 : 3.5) : r.kind === 'urban' ? 1.5 : 2.5, r.half * 2 * k);
      ctx.beginPath();
      r.pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
    }
    // Kavşak meydanları + trafik ışıkları (mini haritada)
    ctx.fillStyle = '#b9b4a6';
    for (const p of PLAZAS) if (vis({ minX: p.x, maxX: p.x, minZ: p.z, maxZ: p.z }, p.half)) ctx.fillRect(X(p.x - p.half), Z(p.z - p.half), p.half * 2 * k, p.half * 2 * k);
    if (view) {
      const t = this.net.serverNow() / 1000;
      for (const sg of SIGNALS) {
        if (!vis({ minX: sg.x, maxX: sg.x, minZ: sg.z, maxZ: sg.z }, 20)) continue;
        const st = signalState(sg, 'ns', t);
        ctx.fillStyle = st === 'g' ? '#33d17a' : st === 'y' ? '#f6d32d' : '#e01b24';
        ctx.beginPath();
        ctx.arc(X(sg.x), Z(sg.z), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Rota
    const route = view ? this.route : (this.destination() ? routeTo(this.player.pos.x, this.player.pos.z, this.destination()) : null);
    if (route) {
      ctx.strokeStyle = '#b05cff';
      ctx.lineWidth = view ? 4 : 3;
      ctx.beginPath();
      route.pts.forEach(([x, z], i) => (i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z))));
      ctx.stroke();
      const g = route.pts[route.pts.length - 1];
      ctx.fillStyle = '#ff2bd6';
      ctx.beginPath();
      ctx.arc(X(g[0]), Z(g[1]), view ? 5 : 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // Etiketler (tam harita)
    ctx.font = `${view ? 11 : 15}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    if (!view) {
      ctx.textAlign = 'left';
      ctx.fillText('🏨 Lojistik avlusu', Math.max(4, X(250)), Z(-50));
      ctx.textAlign = 'center';
      ctx.fillText('🏙️ Nieuw-Zuid', X((NZ.minX + NZ.maxX) / 2), Z(NZ.minZ) - 6);
      ctx.fillText('🏭 Industrieweg', X(4500), Z(-2030));
      ctx.fillText('A10 Ring', X(2400), Z(330));
      ctx.fillText('A4', X(3560), Z(-900));
      // Depo etiketleri: yan yana olanlar (VersMarkt / ArcadeWorks) dışa hizalanır, avlunun altına
      for (const s of SITES) {
        const cx = (s.bounds.minX + s.bounds.maxX) / 2;
        const twin = SITES.find((o) => o !== s && Math.abs((o.bounds.minZ + o.bounds.maxZ) / 2 - (s.bounds.minZ + s.bounds.maxZ) / 2) < 200 && Math.abs((o.bounds.minX + o.bounds.maxX) / 2 - cx) < 1200);
        const left = twin && (twin.bounds.minX + twin.bounds.maxX) / 2 > cx;
        ctx.textAlign = twin ? (left ? 'right' : 'left') : X(cx) + 50 > w ? 'right' : 'center';
        const below = s.bounds.minZ > NZ.minZ && s.bounds.minZ < NZ.maxZ + 200;
        ctx.fillText(`${s.icon} ${s.short}`, X(twin ? (left ? s.bounds.maxX : s.bounds.minX) : cx), below ? Z(s.bounds.maxZ) + 16 : Z(s.bounds.minZ) - 6);
      }
      ctx.textAlign = 'center';
    }
    this.illegal?.drawMap(ctx, X, Z, view); // kaçak iş hedefleri, tarayıcı kapıları
    // Yapay araçlar (polis)
    for (const a of this.st.agents ?? []) {
      ctx.fillStyle = a.kind === 'police' ? '#3b82ff' : '#cccccc';
      ctx.fillRect(X(a.x) - 3, Z(a.z) - 3, 6, 6);
    }
    // Oyuncu oku
    const px = this.player.pos.x;
    const pz = this.player.pos.z;
    if (inHighwayRegion(px, pz, 4)) {
      const yaw = this.player.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const cx = X(px);
      const cz = Z(pz);
      const s = view ? 9 : 10;
      ctx.fillStyle = '#ffd23f';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + fx * s, cz + fz * s);
      ctx.lineTo(cx - fx * s * 0.6 - fz * s * 0.55, cz - fz * s * 0.6 + fx * s * 0.55);
      ctx.lineTo(cx - fx * s * 0.3, cz - fz * s * 0.3);
      ctx.lineTo(cx - fx * s * 0.6 + fz * s * 0.55, cz - fz * s * 0.6 - fx * s * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // ---- Yapay araçlar (sunucu) ------------------------------------------------------------------------------

  syncAgents(list) {
    const seen = new Set();
    for (const a of list) {
      seen.add(a.id);
      let m = this.agentMeshes.get(a.id);
      if (!m) {
        m = new THREE.Group();
        const police = a.kind === 'police';
        const civil = a.kind === 'civil';
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.85, 4.6).translate(0, 0.72, 0), new THREE.MeshLambertMaterial({ color: police ? 0xf4f4f4 : civil ? 0x2b2f35 : 0x8a8f96 }));
        const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.3).translate(0, 1.4, -0.2), new THREE.MeshLambertMaterial({ color: 0x1d2a36 }));
        m.add(body, cab);
        if (police) {
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.87, 0.18, 4.62).translate(0, 0.78, 0), new THREE.MeshLambertMaterial({ color: 0x1747c9 }));
          const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.16, 0.35).translate(0, 1.76, -0.2), new THREE.MeshBasicMaterial({ color: 0x2b6dff }));
          m.add(stripe, bar);
          m.userData.bar = bar;
        }
        if (civil) {
          const flash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.1).translate(0, 1.1, 2.0), new THREE.MeshBasicMaterial({ color: 0x2b6dff }));
          m.add(flash);
          m.userData.bar = flash;
        }
        m.userData.kind = a.kind;
        m.visible = this.inRegion;
        this.world.group.add(m);
        this.agentMeshes.set(a.id, m);
      }
      m.userData.tx = a.x;
      m.userData.tz = a.z;
      m.userData.tyaw = a.yaw + Math.PI;
      if (m.userData.x === undefined) {
        m.position.set(a.x, 0, a.z);
        m.rotation.y = a.yaw + Math.PI;
        m.userData.x = a.x;
      }
    }
    for (const [id, m] of this.agentMeshes) {
      if (seen.has(id)) continue;
      this.world.group.remove(m);
      this.agentMeshes.delete(id);
    }
  }

  updateAgents(dt, t) {
    const k = Math.min(1, dt * 6);
    for (const m of this.agentMeshes.values()) {
      const u = m.userData;
      m.position.x += (u.tx - m.position.x) * k;
      m.position.z += (u.tz - m.position.z) * k;
      m.rotation.y += Math.atan2(Math.sin(u.tyaw - m.rotation.y), Math.cos(u.tyaw - m.rotation.y)) * k;
      if (u.bar) u.bar.material.color.setHex(Math.floor(t * 4) % 2 ? 0xff2a2a : 0x2b6dff);
    }
  }

  // ---- Çarpma / trafik --------------------------------------------------------------------------------------

  checkHits(now) {
    const truck = this.drivingTruck();
    const job = this.myJob;
    const v = Math.abs(this.player.vel);
    if (truck && this.inRegion) {
      // Trafik aracına çarpma: tır burnu (ön 3 m) bir arabaya değerse
      const yaw = this.player.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const hit = this.traffic.near(this.player.pos.x + fx * 3, this.player.pos.z + fz * 3, 2.6);
      if (hit && v > 2 && now - this.bumpAt > 1000) {
        this.bumpAt = now;
        this.player.vel *= 0.3;
        if (this.settings.sound) this.sfx?.clink?.();
      }
    }
    if (!truck || job?.state !== 'loaded' || !truck.trailer) {
      this.prevVel = 0;
      return;
    }
    const prev = this.prevVel;
    this.prevVel = Math.abs(this.player.vel);
    if (prev > 2 && this.prevVel < prev * 0.55 && now - this.hitAt > LOGI_RULES.HIT_MIN_MS) {
      this.hitAt = now;
      this.net.request(EVT.LOGI_ACT, { act: 'hit', kmh: Math.round(prev * KMH * 10) / 10 }).then((res) => {
        if (res?.ok && res.damage > 0) this.hud.toast(`💥 Yük hasar gördü! (%${Math.round(res.damage * 100)})`, 'warn');
      });
    }
  }

  // ---- Kare ---------------------------------------------------------------------------------------------------

  /** @returns {boolean} kare gerekli mi */
  update(dt) {
    if (!this.inRegion) {
      if (!this.el.navi.hidden) this.el.navi.hidden = true;
      return false;
    }
    const now = performance.now();
    const t = this.net.serverNow() / 1000;
    const { x, z } = this.player.pos;
    this.world.setView(x, z);
    this.world.updateSignals(t);
    const e = this.ego;
    e.active = true;
    e.x = x;
    e.z = z;
    e.yaw = this.player.yaw;
    e.vel = this.vehicles.seat ? this.player.vel : 0;
    e.truck = !!this.drivingTruck();
    this.traffic.update(dt, t, e);
    this.updateAgents(dt, t);
    this.checkHits(now);
    this.updateNavi(now);
    // Kare yalnızca sürerken ya da yakında (150 m) trafik varken gerekir (avluda dururken pil)
    return !!this.vehicles.seat || this.traffic.near100 || this.agentMeshes.size > 0;
  }
}

/**
 * Hedef körfeze yaklaşırken (35 m) yönlendirme istemi: E'ye basınca tırdan inmek yerine "körfeze gir" uyarısı
 * gelir (yanlışlıkla inip park etme olmaz).
 */
function bayHint(b, x, z, what, hud) {
  const cx = Math.min(Math.max(x, b.minX), b.maxX);
  const cz = Math.min(Math.max(z, b.minZ), b.maxZ);
  const d = Math.hypot(x - cx, z - cz) - BAY_TOL;
  if (d > 35 || d <= 0) return null;
  const txt = `🟨 ${what} körfezine gir (${Math.ceil(d)} m) — sarı çerçevenin içinde dur, sonra E`;
  return { x, z, marker: false, short: 'Körfez', label: txt, use: () => hud.toast(txt, 'info') };
}

function pointIn(b, x, z, tol = 0) {
  return x > b.minX - tol && x < b.maxX + tol && z > b.minZ - tol && z < b.maxZ + tol;
}
