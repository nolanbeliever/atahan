import {
  DRINKS, DRINK_BY_ID, DRINK_CATEGORIES, INGREDIENT_BY_ID, drinkDifficulty,
} from '/shared/constants.js';
import { BAR, isInsideBar } from '/shared/layout.js';

const STATION = {
  dispenser: { icon: '🚰', name: 'musluk' },
  cooler: { icon: '🧊', name: 'dolap' },
  taps: { icon: '🫗', name: 'fıçı' },
};
const GLASS = {
  shot: 'şat bardağı', pint: 'fıçı bardağı', flute: 'flüt kadeh', wine: 'kadeh', highball: 'uzun bardak', coupe: 'kokteyl kadehi', mug: 'kupa',
};

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/**
 * Tarif Kitabı: Bar De Tulp'un 30 alkolsüz içeceği kategori kategori — malzemeler (hangi
 * istasyondan alındığıyla), yöntem (çalkala / bardakta karıştır / doldur), fiyat ve zorluk.
 *  - Barın doğu duvarındaki kürsüde E, barın içindeyken K, ya da sipariş listesindeki 📖 düğmesi.
 *  - open(drinkId) o içeceğin kartını vurgulayıp gösterir (bekleyen sipariş için).
 * Pil: kitap statik bir DOM paneli; yalnızca açılınca çizilir (modal → 3B motor durur).
 */
export class RecipeBook {
  constructor({ interaction, modal, player }) {
    this.modal = modal;
    this.player = player;
    this.cat = DRINK_CATEGORIES[0].id;
    const $ = (id) => document.getElementById(id);
    this.el = { panel: $('recipe-panel'), tabs: $('recipe-tabs'), list: $('recipe-list') };
    $('recipe-close').addEventListener('click', () => this.modal.close(this.el.panel));
    for (const c of DRINK_CATEGORIES) {
      const b = el('button', null, `${c.icon} ${c.name}`);
      b.type = 'button';
      b.dataset.cat = c.id;
      b.addEventListener('click', () => {
        this.cat = c.id;
        this.focus = null;
        this.render();
      });
      this.el.tabs.append(b);
    }
    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  /** main.js komut zinciri: K → kitap (yalnızca barda) */
  command(cmd) {
    if (cmd !== 'recipes' || !isInsideBar(this.player.pos.x, this.player.pos.z)) return false;
    this.open();
    return true;
  }

  findTarget(px, pz, f) {
    const [x, z] = BAR.recipeBook;
    const dx = x - px;
    const dz = z - pz;
    const d = Math.hypot(dx, dz);
    if (d > 1.6 || (d > 0.5 && (dx * f.x + dz * f.z) / d < 0.4)) return null;
    return { x, z, short: 'Tarif', label: `📖 Tarif kitabı (${DRINKS.length} içecek)`, marker: false, use: () => this.open() };
  }

  open(drinkId = null) {
    const d = drinkId ? DRINK_BY_ID[drinkId] : null;
    this.focus = d ? d.id : null;
    if (d) this.cat = d.cat;
    this.render();
    this.modal.open(this.el.panel);
    if (d) this.el.list.querySelector(`[data-id="${d.id}"]`)?.scrollIntoView({ block: 'center' });
  }

  render() {
    for (const b of this.el.tabs.children) b.classList.toggle('on', b.dataset.cat === this.cat);
    const list = this.el.list;
    list.replaceChildren();
    const cat = DRINK_CATEGORIES.find((c) => c.id === this.cat);
    list.append(el('p', 'recipe-desc', cat.desc));
    for (const d of DRINKS.filter((x) => x.cat === this.cat)) list.append(this.card(d));
  }

  card(d) {
    const card = el('div', 'recipe-card');
    card.dataset.id = d.id;
    if (d.id === this.focus) card.classList.add('focus');
    const head = el('div', 'recipe-head');
    const sw = el('span', 'recipe-swatch', d.icon);
    sw.style.setProperty('--c', d.color);
    const title = el('div', 'recipe-title');
    title.append(el('b', null, d.name));
    if (d.like) title.append(el('small', null, `${d.like}'in alkolsüz hâli`));
    const stars = '●'.repeat(Math.min(5, Math.max(1, drinkDifficulty(d) - 1))).padEnd(5, '○');
    head.append(sw, title, el('span', 'recipe-price', `€${d.price}`));
    const steps = el('ol', 'recipe-steps');
    steps.append(el('li', null, `🥛 Raftan temiz bardak al (${GLASS[d.glass] ?? 'bardak'})`));
    for (const id of d.ingredients) {
      const ing = INGREDIENT_BY_ID[id];
      const st = STATION[ing.station];
      steps.append(el('li', null, `${ing.icon} ${ing.name} — ${st.icon} ${st.name}`));
    }
    steps.append(el('li', null, d.shake ? '🍸 Çalkalayıcıda çalkala' : d.ingredients.length === 1 ? '✋ Çalkalama — doğrudan servis' : '🥄 Bardakta karıştır (çalkalama!)'));
    const foot = el('div', 'recipe-foot', `Zorluk ${stars} · bahşiş fiyatın %10–35'i (hızlı servis = çok bahşiş)`);
    card.append(head, steps, foot);
    return card;
  }
}
