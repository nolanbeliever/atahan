import { EVT } from '/shared/constants.js';
import { PLAYER_HOUSES, HOUSE_BY_ID, isInsideHouseDef } from '/shared/layout.js';
import { HOUSE_RULES } from '/shared/house.js';

const DOOR_NEAR = 2.3; // kapı bu mesafede (erişimi olana) açılır
const TELEPORT_MAX = 9; // içeri alındığında bu kadar yakınsan içeri ışınlanırsın

/**
 * Achterstraat'taki oyuncu evleri: kapılar, kapı zili ve misafir erişimi.
 *  - Kapı yalnızca ev sahibine ve zili çalıp içeri alınan misafirlere açılır
 *    (istemcide kapı çarpışma kutusu; eşya / TV yetkisini sunucu ayrıca doğrular).
 *  - Başkasının kapısında E / Aksiyon → zil → ev sahibine "X kapıda, içeri alınsın mı?"
 *    istemi (masaüstünde Y / N, dokunmatikte butonlar). Kabul → misafir içeri ışınlanır.
 *  - İsim levhaları sunucudaki ev sahipliği listesinden (EVT.HOUSE_OWNERS) güncellenir.
 */
export class HouseVisitingSystem {
  constructor({ engine, net, hud, interaction, player, house, world, device, sfx, settings }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.house = house;
    this.world = world; // world.playerHouses (kapılar, isim levhaları)
    this.device = device;
    this.sfx = sfx;
    this.settings = settings;

    this.ownedHouseId = null;
    this.owners = new Map(); // houseId → { name, online, playerId } | null
    this.access = new Set(); // bu oturumda içeri alındığın evler
    this.pendingRing = null; // { houseId, until } — çaldığın zil
    this.requests = []; // ev sahibine gelen zil istekleri (sırayla gösterilir)
    this.announced = false;

    const $ = (id) => document.getElementById(id);
    this.el = {
      prompt: $('ring-prompt'),
      text: $('ring-text'),
      yes: $('ring-yes'),
      no: $('ring-no'),
      timer: $('ring-timer').firstElementChild,
    };
    this.el.yes.addEventListener('click', () => this.answer(true));
    this.el.no.addEventListener('click', () => this.answer(false));
    if (device.touch) {
      this.el.yes.querySelector('kbd')?.remove();
      this.el.no.querySelector('kbd')?.remove();
    }

    house.accessCheck = (id) => this.canEnter(id);
    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  canEnter(houseId) {
    return houseId === this.ownedHouseId || this.access.has(houseId);
  }

  // ---- Sunucu durumu ------------------------------------------------------------------

  /** Yeni bağlantı (WELCOME): sunucudaki misafir izinleri oturumluk, sıfırlanır */
  reset() {
    this.access.clear();
    this.pendingRing = null;
    this.requests = [];
    this.renderPrompt();
    this.syncColliders();
  }

  applySelf(self) {
    if (!self || !('houseId' in self)) return;
    const id = self.houseId ?? null;
    const changed = id !== this.ownedHouseId;
    this.ownedHouseId = id;
    this.house.ownedHouseId = id;
    if (changed) this.syncColliders();
    if (id && !this.announced) {
      this.announced = true;
      const h = HOUSE_BY_ID[id];
      this.hud.toast(`🏡 Sana ${h.name} verildi! Otelin koridorunun sonundaki arka kapıdan Achterstraat'a çık.`, 'info');
    }
  }

  /** EVT.HOUSE_OWNERS ya da snapshot.house.owners */
  setOwners(list) {
    for (const o of list) {
      this.owners.set(o.houseId, o.owner ?? null);
      this.world?.setNameplate(o.houseId, o.owner ?? null);
    }
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  // ---- Kapı önü etkileşimi ----------------------------------------------------------------

  findTarget(px, pz, f) {
    if (pz > 33.2 || pz < 30) return null; // yalnızca Achterstraat'ta, cephelerin önünde
    let best = null;
    let bestD = Infinity;
    for (const h of PLAYER_HOUSES) {
      const [x, z] = h.doorPoint;
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > HOUSE_RULES.DOOR_RANGE) continue;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 0.8 && dot < 0.3) continue;
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (!best) return null;
    const h = best;
    const owner = this.owners.get(h.id) ?? null;
    const at = { x: h.doorPoint[0], z: h.doorPoint[1], marker: false };
    if (h.id === this.ownedHouseId) {
      return { ...at, short: 'Evim', label: `🔑 ${h.name} — senin evin (kapı açık)`, use: () => this.hud.toast('Kapı sana açık — içeri yürü.', 'info') };
    }
    if (!owner) {
      return { ...at, short: 'Boş', label: `🏚 ${h.name} · boş ev`, use: () => this.hud.toast('Bu ev boş — yeni gelen bir oyuncuya verilecek.', 'info') };
    }
    if (this.access.has(h.id)) {
      return { ...at, short: 'Gir', label: `🚪 ${h.name} · ${owner.name} — kapı sana açık`, use: () => this.hud.toast('Kapı açık — içeri yürü.', 'info') };
    }
    const offline = owner.online ? '' : ' (çevrimdışı)';
    return { ...at, short: 'Zil', label: `🔔 Zili çal — ${h.name} · ${owner.name}${offline}`, use: () => this.ring(h) };
  }

  async ring(h) {
    if (this.pendingRing && this.pendingRing.houseId === h.id && performance.now() < this.pendingRing.until) {
      this.hud.toast('Zil çalındı, yanıt bekleniyor…', 'info');
      return;
    }
    this.playBell();
    const res = await this.net.request(EVT.HOUSE_RING, { houseId: h.id });
    if (!res.ok) {
      this.hud.toast(res.error || 'Zil çalınamadı.', 'warn');
      return;
    }
    if (res.owner) {
      this.hud.toast('Burası senin evin — kapı sana açık.', 'info');
    } else if (res.granted) {
      this.grant(h.id);
    } else if (res.pending) {
      this.pendingRing = { houseId: h.id, until: performance.now() + HOUSE_RULES.RING_TIMEOUT_MS };
      const owner = this.owners.get(h.id);
      this.hud.toast(`🔔 Zil çalındı — ${owner ? owner.name : 'ev sahibi'} yanıt veriyor…`, 'info');
    }
  }

  /** EVT.HOUSE_ACCESS (ziyaretçiye): zil yanıtı */
  onAccess({ houseId, granted, by, reason }) {
    const h = HOUSE_BY_ID[houseId];
    if (!h) return;
    if (this.pendingRing?.houseId === houseId) this.pendingRing = null;
    if (!granted) {
      if (reason === 'timeout') this.hud.toast(`🚪 ${h.name}: kapıyı açan olmadı.`, 'warn');
      else if (reason === 'owner-left') this.hud.toast(`🚪 ${h.name}: ev sahibi oyundan çıktı.`, 'warn');
      else this.hud.toast(`🚪 ${by || 'Ev sahibi'} seni içeri almadı.`, 'warn');
      return;
    }
    this.hud.toast(`🚪 ${by || 'Ev sahibi'} seni içeri aldı — hoş geldin!`, 'clean');
    this.grant(houseId);
  }

  /** Erişim verildi: kapı açılır; kapının yakınındaysan içeri ışınlanırsın */
  grant(houseId) {
    this.access.add(houseId);
    this.syncColliders();
    const h = HOUSE_BY_ID[houseId];
    const p = this.player.pos;
    if (!isInsideHouseDef(h, p.x, p.z) && Math.hypot(p.x - h.doorPoint[0], p.z - h.doorPoint[1]) < TELEPORT_MAX) {
      this.player.setPose(h.entry[0], h.entry[1], Math.PI); // içeri, odaya bakarak
      this.net.sendMove(this.player.pos.x, this.player.pos.z, this.player.yaw);
      this.net.flushMove();
    }
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  // ---- Ev sahibine gelen zil istekleri --------------------------------------------------------

  /** EVT.HOUSE_RING_REQ */
  onRingRequest(req) {
    if (!HOUSE_BY_ID[req.houseId]) return;
    this.requests = this.requests.filter((r) => r.visitorId !== req.visitorId || r.houseId !== req.houseId);
    this.requests.push(req);
    if (this.requests.length === 1) {
      this.playBell();
      this.renderPrompt();
    }
  }

  async answer(accept) {
    const req = this.requests[0];
    if (!req) return;
    this.requests.shift();
    this.renderPrompt();
    const res = await this.net.request(EVT.HOUSE_RING_ANSWER, { ringId: req.ringId, accept });
    if (!res.ok) this.hud.toast(res.error || 'Yanıt gönderilemedi.', 'warn');
    else if (accept) this.hud.toast(`🚪 ${req.visitorName} içeri alındı.`, 'clean');
    if (this.requests.length) this.playBell();
  }

  /** main.js komut zinciri: Y / N (masaüstünde fare kilitliyken butonlar tıklanamaz) */
  command(cmd) {
    if (!this.requests.length) return false;
    if (cmd === 'ringYes') this.answer(true);
    else if (cmd === 'ringNo') this.answer(false);
    else return false;
    return true;
  }

  renderPrompt() {
    const req = this.requests[0];
    this.el.prompt.hidden = !req;
    clearTimeout(this.expireTimer);
    if (!req) return;
    const h = HOUSE_BY_ID[req.houseId];
    this.el.text.textContent = `🔔 ${req.visitorName} kapıda (${h.name}) — içeri alınsın mı?`;
    // Süre çubuğu: tek CSS geçişi (motor uyurken de akar)
    const left = Math.max(0, req.expiresAt - this.net.serverNow());
    const i = this.el.timer;
    i.style.transition = 'none';
    i.style.transform = 'scaleX(1)';
    void i.offsetWidth;
    i.style.transition = `transform ${left}ms linear`;
    i.style.transform = 'scaleX(0)';
    this.expireTimer = setTimeout(() => {
      if (this.requests[0] !== req) return;
      this.requests.shift();
      this.renderPrompt();
    }, left);
  }

  playBell() {
    if (!this.settings?.sound || !this.sfx?.clink) return;
    this.sfx.clink();
    setTimeout(() => this.sfx.clink(), 260);
  }

  // ---- Kapılar ---------------------------------------------------------------------------

  /** Erişimi olan evin kapısı geçilebilir; diğerleri kapalı (istemci tarafı engel) */
  syncColliders() {
    const doors = this.world?.doors;
    if (!doors) return;
    for (const h of PLAYER_HOUSES) {
      const d = doors.get(h.id);
      if (d?.collider) d.collider.enabled = !this.canEnter(h.id);
    }
  }

  /** @returns {boolean} kapı animasyonu sürüyor mu */
  update(dt) {
    const ph = this.world;
    if (!ph?.doors) return false;
    const { x, z } = this.player.pos;
    if (z < 28) return this.closeAll(dt); // Achterstraat'tan uzaktaysan hepsi kapalı
    let active = false;
    for (const h of PLAYER_HOUSES) {
      const near = Math.hypot(x - h.doorPoint[0], z - (h.doorPoint[1] + 0.45)) < DOOR_NEAR;
      const target = near && this.canEnter(h.id) ? 1 : 0;
      if (ph.animateDoor(h.id, target, dt)) active = true;
    }
    return active;
  }

  closeAll(dt) {
    let active = false;
    for (const h of PLAYER_HOUSES) {
      const d = this.world.doors.get(h.id);
      if (d && d.t > 0 && this.world.animateDoor(h.id, 0, dt)) active = true;
    }
    return active;
  }
}
