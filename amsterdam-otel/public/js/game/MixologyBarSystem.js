import { BAR_RULES, INGREDIENTS } from '/shared/constants.js';
import { BAR } from '/shared/layout.js';

const STATIONS = {
  cooler: { title: '🧊 Soğutucu dolap', sub: 'Meyve suları, şuruplar, nane, buz ve kahve', short: 'Dolap' },
  taps: { title: '🫗 Fıçı kulesi', sub: 'Fıçıdan doğrudan bardağa', short: 'Fıçı' },
};

/**
 * Bar De Tulp'un genişletilmiş içecek istasyonları (30 alkolsüz içecek, 26 malzeme):
 *  - Batı ucundaki camlı soğutucu dolap ve tezgâhtaki fıçı kulesi. Yaklaşıp E → istasyonun
 *    malzemelerinden birini seç → BarSystem'in 'pour' adımı (aynı 1.5 sn dökme animasyonu,
 *    sunucu istasyon mesafesini doğrular). Arka tezgâhtaki 5 musluk eskisi gibi çalışır.
 *  - Hedefler BarSystem.findTarget'e eklenir (aynı bakış konisi / puanlama), böylece yakındaki
 *    bardak rafı ya da musluklar dolabın önüne geçmez.
 * Sipariş, tarif doğrulama, fiyat ve bahşiş (hepsi otel kasasına) sunucuda: server/game/BarService.js.
 * Pil: seçim paneli modal (3B motor durur); karede iş yok.
 */
export class MixologyBarSystem {
  constructor({ bar, hud, modal, recipes }) {
    this.bar = bar;
    this.hud = hud;
    this.modal = modal;
    this.recipes = recipes;
    const $ = (id) => document.getElementById(id);
    this.el = { panel: $('cooler-panel'), title: $('cooler-title'), sub: $('cooler-sub'), grid: $('cooler-grid'), held: $('cooler-held') };
    $('cooler-close').addEventListener('click', () => this.modal.close(this.el.panel));
    bar.extraTargets = (add, h) => this.addTargets(add, h);
    // Sipariş listesinde 📖: o içeceğin tarifini aç
    $('bar-recipes').addEventListener('click', () => this.recipes.open(this.bar.waitingOrder?.() ?? null));
  }

  /** BarSystem.findTarget kancası */
  addTargets(add, h) {
    for (const [station, info] of Object.entries(STATIONS)) {
      const pt = BAR[station];
      if (!h) add(pt, `${info.title} — önce raftan temiz bardak al`, info.short, () => this.hud.toast('Önce raftan temiz bir bardak al.', 'info'));
      else if (h.kind === 'glass') {
        if (h.pours.length >= BAR_RULES.MAX_POURS) add(pt, '🥛 Bardak dolu', info.short, () => this.hud.toast('Bardak dolu — servis et ya da lavaboda dök.', 'info'));
        else add(pt, `${info.title}: malzeme seç`, info.short, () => this.openPicker(station));
      }
    }
  }

  openPicker(station) {
    const info = STATIONS[station];
    const h = this.bar.hold;
    if (h?.kind !== 'glass') return;
    this.el.title.textContent = info.title;
    this.el.sub.textContent = info.sub;
    this.el.held.textContent = h.pours.length ? `Bardakta: ${h.pours.length}/${BAR_RULES.MAX_POURS} malzeme` : 'Bardak boş';
    const grid = this.el.grid;
    grid.replaceChildren();
    for (const ing of INGREDIENTS.filter((i) => i.station === station)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cooler-item';
      const icon = document.createElement('span');
      icon.className = 'ci-icon';
      icon.textContent = ing.icon;
      icon.style.setProperty('--c', ing.color);
      const name = document.createElement('span');
      name.textContent = ing.name;
      b.append(icon, name);
      const done = h.pours.includes(ing.id);
      b.disabled = done;
      if (done) b.title = 'Zaten koydun';
      b.addEventListener('click', () => {
        this.modal.close(this.el.panel);
        this.bar.act('pour', { ing: ing.id });
      });
      grid.append(b);
    }
    this.modal.open(this.el.panel);
  }
}
