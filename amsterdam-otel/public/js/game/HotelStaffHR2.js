import { EVT, formatMoney } from '/shared/constants.js';
import { WORKER_RULES } from '/shared/hotel.js';
import { KITCHEN_STAFF } from '/shared/restaurant.js';
import { NEW_STAFF, HR_ROLES, HR_RULES, OUTFITS } from '/shared/staffhr.js';
import { mat } from './Characters.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const stars = (n) => `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;

/** Pozisyonun işe alma fiyatı ve kadro sınırı */
function roleInfo(role, pc) {
  if (role === 'worker') return { price: WORKER_RULES.HIRE_PRICE, max: pc.hotel.arch?.maxWorkers ?? WORKER_RULES.MAX };
  if (KITCHEN_STAFF[role]) return { price: KITCHEN_STAFF[role].price, max: KITCHEN_STAFF[role].max };
  return { price: NEW_STAFF[role].price, max: NEW_STAFF[role].max };
}

const WHAT = {
  worker: 'Kirli odaları temizler; bahşişler kasaya.',
  chef: 'Restoran siparişlerini pişirip garson tezgâhına koyar, büfeyi tazeler.',
  waiter: 'Tabakları masalara taşır, kirli masaları toplar.',
  barman: 'Bar De Tulp\'ta siparişleri hazırlayıp servis eder, kirli bardakları yıkar.',
  bouncer: 'Eğlence Katı kapısında kıyafet kuralına / kara listeye bakar (sen kapıda değilken).',
};

/**
 * Personel Yönetimi 2.0 — istemci.
 *  - Resepsiyon PC'ye "👥 Personel 2.0" sekmesi: bütün çalışanlar (temizlikçi, aşçı, garson, barmen, bouncer)
 *    rol rol; işe al / çıkar, üniforma seçimi, moral, bugünkü performans (iş, hata, müşteri puanı → 0–100, ★),
 *    dünkü puan ve günlük prim (€25 / €50 / €100, otel kasasından).
 *  - NPC'lerin wire'ındaki `outfit: { c, a }` gövde / önlük rengine uygulanır (herkes aynı üniformayı görür).
 * Pil: sekme yalnızca açıkken çizilir; üniforma yalnızca değişince uygulanır.
 */
export class HotelStaffHR2 {
  constructor({ net, hud, guests, reception, state }) {
    Object.assign(this, { net, hud, guests, reception, state });
    this.data = { day: 0, staff: [] };
    this.busy = false;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/staffhr.css';
    document.head.append(link);

    const upsert = guests.upsert.bind(guests);
    guests.upsert = (data) => {
      upsert(data);
      if (data.outfit) this.applyOutfit(guests.items.get(data.id), data.outfit);
    };

    if (reception) {
      const b = el('button', null, '👥 Personel 2.0');
      b.type = 'button';
      b.dataset.tab = 'hr';
      reception.el.tabs.append(b);
      reception.tabs.hr = (body, pc) => this.renderTab(body, pc);
    }
  }

  /** Üniforma: gövde (c) ve varsa önlük (a) rengi */
  applyOutfit(it, o) {
    if (!it || !o) return;
    const u = it.obj.userData;
    const key = `${o.c}|${o.a}`;
    if (u.outfitKey === key) return;
    u.outfitKey = key;
    if (u.body && typeof o.c === 'string') u.body.material = mat(o.c);
    if (u.apron && typeof o.a === 'string') u.apron.material = mat(o.a);
  }

  onState(s) {
    if (!s) return;
    this.data = s;
    if (this.reception && !this.reception.el.panel.hidden && this.reception.tab === 'hr') this.reception.render();
  }

  async act(pc, data, okText) {
    if (this.busy) return null;
    this.busy = true;
    const res = await this.net.request(EVT.STAFF_ACT, data);
    this.busy = false;
    if (!res.ok) pc.say(res.error || 'Olmadı.');
    else if (okText) pc.say(okText, true);
    return res;
  }

  renderTab(body, pc) {
    const money = pc.state.economy?.money ?? 0;
    const list = this.data.staff;
    const avg = list.length ? Math.round(list.reduce((a, s) => a + s.morale, 0) / list.length) : 0;
    const best = [...list].sort((a, b) => b.score - a.score)[0];
    body.append(el('p', 'pc-small', `Kadro: ${list.length} kişi · ortalama moral ${list.length ? avg : '—'}${best ? ` · bugünün yıldızı: ${best.name} (${best.score})` : ''}. Prim otelin kasasından ödenir; moral iş hızını etkiler, prim bugün ve yarın %10 hızlandırır. Son iki günde prim almayanın morali her gün biraz düşer.`));

    for (const r of HR_ROLES) {
      const members = list.filter((s) => s.role === r.role);
      const info = roleInfo(r.role, pc);
      const sec = el('section', 'hr-sec');
      const head = el('div', 'hr-head');
      const t = el('div');
      t.append(el('div', 'name', `${r.icon} ${r.title} · ${members.length}/${info.max}`), el('div', 'desc', WHAT[r.role]));
      const hire = el('button', null, `İşe al · ${formatMoney(info.price)}`);
      hire.type = 'button';
      hire.disabled = members.length >= info.max || money < info.price;
      hire.addEventListener('click', async () => {
        hire.disabled = true;
        const res = await this.act(pc, { act: 'hire', role: r.role }, `${r.icon} Yeni ${r.title.toLocaleLowerCase('tr')} işe başladı!`);
        if (!res?.ok) hire.disabled = false;
      });
      head.append(t, hire);
      sec.append(head);
      for (const s of members) sec.append(this.card(s, r, pc, money));
      body.append(sec);
    }
  }

  card(s, r, pc, money) {
    const c = el('div', 'hr-card');
    const top = el('div', 'hr-top');
    const title = el('div', 'hr-name', `${r.icon} ${s.name} · Sv.${s.level}`);
    const perf = el('div', 'hr-perf', `${stars(s.stars)} ${s.score}/100`);
    perf.title = 'Bugünkü performans: iş (40) + müşteri puanı (35) + hatasızlık (25)';
    top.append(title, perf);
    const t = s.today;
    const rating = t.rating != null ? `⭐ ${t.rating.toFixed(1)} (${t.ratings} puan)` : 'henüz puan yok';
    const lines = el('div', 'hr-desc', `Bugün: ${t.tasks}/${HR_RULES.TARGET[s.role]} iş · ${t.mistakes} hata · ${rating}${s.lastScore != null ? ` · dün ${s.lastScore}` : ''}`);
    const doing = el('div', 'hr-desc', s.doing ? `Şu an: ${s.doing}` : 'Boşta');
    const morale = el('div', 'hr-morale');
    const bar = el('div', 'hr-bar');
    const fill = el('i');
    fill.style.width = `${s.morale}%`;
    fill.className = s.morale >= 70 ? 'ok' : s.morale >= 40 ? 'mid' : 'low';
    bar.append(fill);
    morale.append(el('span', null, `Moral ${s.morale}`), bar, el('span', 'hr-boost', s.boosted ? '⚡ prim takviyesi' : ''));

    // Üniforma
    const outfits = el('div', 'hr-outfits');
    OUTFITS[s.role].forEach((o, k) => {
      const b = el('button', `hr-sw${k === s.outfit ? ' on' : ''}`);
      b.type = 'button';
      b.title = o.name;
      b.style.background = o.a ? `linear-gradient(135deg, ${o.c} 62%, ${o.a} 62%)` : o.c;
      b.setAttribute('aria-label', `Üniforma: ${o.name}`);
      b.addEventListener('click', () => {
        if (k === s.outfit) return;
        this.act(pc, { act: 'outfit', role: s.role, name: s.name, outfit: k }, `👔 ${s.name}: ${o.name}`);
      });
      outfits.append(b);
    });
    const outfitRow = el('div', 'hr-row');
    outfitRow.append(el('span', 'hr-lbl', 'Üniforma'), outfits);

    // Prim + çıkar
    const actions = el('div', 'hr-actions');
    if (s.bonusToday) actions.append(el('span', 'owned', '✓ Bugün prim verildi'));
    else {
      for (const b of HR_RULES.BONUSES) {
        const btn = el('button', 'hr-bonus', `💶 €${b.amount}`);
        btn.type = 'button';
        btn.title = `Moral +${b.morale}, bugün ve yarın %10 daha hızlı`;
        btn.disabled = money < b.amount;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = await this.act(pc, { act: 'bonus', role: s.role, name: s.name, amount: b.amount }, `💶 ${s.name}'e €${b.amount} prim verildi.`);
          if (!res?.ok) btn.disabled = false;
        });
        actions.append(btn);
      }
    }
    const fire = el('button', 'danger', 'Çıkar');
    fire.type = 'button';
    fire.addEventListener('click', async () => {
      if (fire.dataset.sure !== '1') {
        fire.dataset.sure = '1';
        fire.textContent = 'Emin misin?';
        return;
      }
      fire.disabled = true;
      await this.act(pc, { act: 'fire', role: s.role, id: s.id }, `${s.name} işten ayrıldı.`);
    });
    actions.append(fire);

    c.append(top, lines, doing, morale, outfitRow, actions);
    return c;
  }
}
