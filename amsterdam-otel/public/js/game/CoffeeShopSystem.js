import {
  EVT, PRODUCTS, PRODUCT_BY_ID, SLOT, TRIP, formatMoney,
} from '/shared/constants.js';
import { COFFEESHOP, isInsideShop } from '/shared/layout.js';

const AGE_KEY = 'amsterdam-otel:age18:v1';

function ageConfirmed() {
  try { return localStorage.getItem(AGE_KEY) === '1'; } catch { return false; }
}
function confirmAge() {
  try { localStorage.setItem(AGE_KEY, '1'); } catch { /* yalnızca bu oturum */ }
}

/**
 * Coffee shop sistemi (istemci):
 *  - Dükkân içinde tezgâh ve slot makinesini Etkileşim sistemine hedef olarak ekler (E / Aksiyon)
 *  - Ürün satın alma ve slot arayüzleri (DOM paneller; açıkken 3D render tamamen durur)
 *  - Kişisel cüzdan + envanter göstergesi; F (mobilde Aksiyon) ile seçili ürünü tüketme
 * Yetki sunucudadır: satın alma, tüketim zarı ve slot sonucu sunucuda belirlenir.
 */
export class CoffeeShopSystem {
  constructor({ net, hud, interaction, input, modal, device }) {
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.modal = modal;
    this.device = device;
    this.wallet = 0;
    this.inventory = {};
    this.selected = null;
    this.trip = null;
    this.spinning = false;

    const $ = (id) => document.getElementById(id);
    this.el = {
      inv: $('inventory'),
      invSlots: $('inv-slots'),
      age: $('age-gate'),
      shop: $('shop-panel'),
      shopList: $('shop-list'),
      shopWallet: $('shop-wallet'),
      shopMsg: $('shop-msg'),
      slot: $('slot-panel'),
      slotLuck: $('slot-luck'),
      reels: [...$('slot-reels').children],
      slotResult: $('slot-result'),
      slotWallet: $('slot-wallet'),
      spinBtn: $('slot-spin'),
    };
    this.el.spinBtn.textContent = `Çevir (€${SLOT.BET})`;
    this.pendingPanel = null;

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
    interaction.idleHint = () => this.idleHint();
    interaction.onIdleAction = () => this.consumeSelected();
    input.onCommand((cmd) => this.onCommand(cmd));

    $('shop-close').addEventListener('click', () => modal.close(this.el.shop));
    $('slot-close').addEventListener('click', () => modal.close(this.el.slot));
    this.el.spinBtn.addEventListener('click', () => this.spin());
    $('age-yes').addEventListener('click', () => {
      confirmAge();
      const kind = this.pendingPanel;
      this.pendingPanel = null;
      if (kind) this.openPanel(kind); // önce paneli aç, sonra onayı kapat (oyun arada devam etmesin)
      modal.close(this.el.age);
    });
    $('age-no').addEventListener('click', () => {
      this.pendingPanel = null;
      modal.close(this.el.age);
    });
    this.el.invSlots.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-id]');
      if (!btn) return;
      this.selected = btn.dataset.id;
      this.renderInventory();
      interaction.invalidate();
    });
  }

  // ---- Sunucu durumu ---------------------------------------------------------

  /** Kişisel durum (cüzdan, envanter, trip) — EVT.SELF ve welcome ile gelir */
  applySelf(self) {
    if (!self) return;
    this.wallet = self.wallet;
    this.inventory = self.inventory || {};
    this.trip = self.trip;
    if (!this.inventory[this.selected]) this.selected = Object.keys(this.inventory)[0] ?? null;
    this.hud.setWallet(this.wallet);
    this.renderInventory();
    this.el.shopWallet.textContent = formatMoney(this.wallet);
    this.el.slotWallet.textContent = formatMoney(this.wallet);
    if (!this.el.shop.hidden) this.renderShop();
    this.renderLuck();
    this.interaction.invalidate();
  }

  setTrip(trip) {
    this.trip = trip;
    this.renderLuck();
    this.interaction.invalidate();
  }

  // ---- Etkileşim hedefleri -----------------------------------------------------

  findTarget(px, pz, f) {
    if (!isInsideShop(px, pz)) return null;
    const S = COFFEESHOP;
    const targets = [
      { x: S.counterPoint[0], z: S.counterPoint[1], label: 'Tezgâh — ürün satın al', kind: 'shop' },
      { x: S.slot.point[0], z: S.slot.point[1], label: `Slot makinesi — €${SLOT.BET}`, kind: 'slot' },
    ];
    let best = null;
    let bestD = Infinity;
    for (const t of targets) {
      const dx = t.x - px;
      const dz = t.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > S.range) continue;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 1.0 && dot < 0.2) continue;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, label: best.label, marker: false, use: () => this.open(best.kind) };
  }

  idleHint() {
    if (this.trip) return null;
    const p = PRODUCT_BY_ID[this.selected];
    return p ? `${p.icon} ${p.name} tüket` : null;
  }

  // ---- Paneller -------------------------------------------------------------

  open(kind) {
    if (!ageConfirmed()) {
      this.pendingPanel = kind;
      this.modal.open(this.el.age);
      return;
    }
    this.openPanel(kind);
  }

  openPanel(kind) {
    if (kind === 'shop') {
      this.el.shopMsg.textContent = '';
      this.renderShop();
      this.modal.open(this.el.shop);
    } else {
      this.el.slotResult.textContent = ' ';
      this.el.slotResult.className = '';
      this.renderLuck();
      this.modal.open(this.el.slot);
    }
  }

  renderShop() {
    const list = this.el.shopList;
    list.replaceChildren();
    for (const p of PRODUCTS) {
      const row = document.createElement('div');
      row.className = 'product';
      const icon = document.createElement('div');
      icon.className = 'icon';
      icon.textContent = p.icon;
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = p.name;
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = p.desc;
      info.append(name, desc);
      const owned = this.inventory[p.id] || 0;
      if (owned) {
        const o = document.createElement('div');
        o.className = 'owned';
        o.textContent = `Envanterde: ${owned}`;
        info.append(o);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Satın al · €${p.price}`;
      btn.disabled = this.wallet < p.price;
      btn.addEventListener('click', () => this.buy(p.id, btn));
      row.append(icon, info, btn);
      list.append(row);
    }
    this.el.shopWallet.textContent = formatMoney(this.wallet);
  }

  async buy(id, btn) {
    btn.disabled = true;
    const res = await this.net.request(EVT.SHOP_BUY, { product: id });
    const p = PRODUCT_BY_ID[id];
    this.el.shopMsg.textContent = res.ok
      ? `${p.icon} ${p.name} envantere eklendi. ${this.device.touch ? 'Aksiyon butonu' : 'F tuşu'} ile tüketebilirsin.`
      : (res.error || 'Satın alınamadı.');
    if (res.ok && !this.selected) this.selected = id;
    this.renderShop(); // SELF olayı cüzdanı zaten güncelledi
  }

  renderLuck() {
    const lucky = this.trip?.type === TRIP.GOOD;
    this.el.slotLuck.textContent = lucky
      ? `🍀 Şans bonusu aktif: kazanma ihtimali +%${Math.round((TRIP.SLOT_LUCK - 1) * 100)}`
      : 'Üç aynı sembol = kazanç';
  }

  async spin() {
    if (this.spinning) return;
    if (this.wallet < SLOT.BET) {
      this.el.slotResult.textContent = 'Cüzdanında yeterli para yok.';
      this.el.slotResult.className = 'lose';
      return;
    }
    this.spinning = true;
    this.el.spinBtn.disabled = true;
    this.el.slotResult.textContent = ' ';
    // Kısa süreli makara animasyonu (yalnızca DOM metni; 3D render duraklatılmış durumda)
    const sym = SLOT.SYMBOLS;
    const timer = setInterval(() => {
      for (const r of this.el.reels) r.textContent = sym[Math.floor(Math.random() * sym.length)];
    }, 70);
    const [res] = await Promise.all([
      this.net.request(EVT.SLOT_SPIN, {}),
      new Promise((r) => setTimeout(r, 750)),
    ]);
    clearInterval(timer);
    this.spinning = false;
    this.el.spinBtn.disabled = false;
    if (!res.ok) {
      this.el.slotResult.textContent = res.error || 'Çevrilemedi.';
      this.el.slotResult.className = 'lose';
      return;
    }
    res.reels.forEach((s, i) => { this.el.reels[i].textContent = sym[s]; });
    if (res.payout > 0) {
      this.el.slotResult.textContent = `Kazandın! +€${res.payout}${res.lucky ? ' 🍀' : ''}`;
      this.el.slotResult.className = 'win';
    } else {
      this.el.slotResult.textContent = 'Bu sefer olmadı…';
      this.el.slotResult.className = 'lose';
    }
  }

  // ---- Envanter / tüketim --------------------------------------------------------

  onCommand(cmd) {
    if (cmd === 'consume') this.consumeSelected();
    else if (cmd === 'cycle') this.cycle();
    else if (cmd.startsWith('select:')) {
      const id = Object.keys(this.inventory)[Number(cmd.slice(7))];
      if (id) {
        this.selected = id;
        this.renderInventory();
        this.interaction.invalidate();
      }
    }
  }

  cycle() {
    const ids = Object.keys(this.inventory);
    if (ids.length < 2) return;
    this.selected = ids[(ids.indexOf(this.selected) + 1) % ids.length];
    this.renderInventory();
    this.interaction.invalidate();
  }

  async consumeSelected() {
    const p = PRODUCT_BY_ID[this.selected];
    if (!p) {
      this.hud.toast('Envanterin boş — sokaktaki coffee shop\'tan ürün alabilirsin.', 'info');
      return;
    }
    if (this.trip) {
      this.hud.toast('Zaten etkisi altındasın, önce geçmesini bekle.', 'warn');
      return;
    }
    const res = await this.net.request(EVT.CONSUME, { product: p.id });
    if (!res.ok) this.hud.toast(res.error || 'Tüketilemedi.', 'warn');
    // Başarılıysa trip PLAYER_TRIP olayıyla başlar (TripEffects)
  }

  renderInventory() {
    const ids = Object.keys(this.inventory);
    this.el.inv.hidden = ids.length === 0;
    const slots = this.el.invSlots;
    slots.replaceChildren();
    for (const id of ids) {
      const p = PRODUCT_BY_ID[id];
      if (!p) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `inv-slot${id === this.selected ? ' sel' : ''}`;
      b.dataset.id = id;
      b.title = p.name;
      b.textContent = p.icon;
      const n = document.createElement('b');
      n.textContent = String(this.inventory[id]);
      b.append(n);
      slots.append(b);
    }
  }
}
