import * as THREE from 'three';
import { formatMoney } from '/shared/constants.js';
import { WORKER_RULES, workerTaskMs } from '/shared/hotel.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/**
 * Otel çalışanları (temizlikçi NPC'ler) — istemci tarafı.
 *  - Sunucu her temizlikçiyi misafirlerle aynı biçimde yayınlar (GUEST_UPSERT, kind: 'worker');
 *    GuestView rotayı oynatır, isim etiketini ("🧹 Fatma · Sv.2") çizer.
 *  - Bu sistem temizlikçilerin eline kova + paspas takar ve Resepsiyon PC'nin "Çalışanlar"
 *    sekmesini çizer: işe al (€200, kasadan), seviye / iş sayısı / şu anki iş, işten çıkar.
 *  - İş süresi yıldızla kısalır (1★ 10 sn → 5★ 2 sn), seviye arttıkça biraz daha; bahşişler kasaya.
 * Pil: kova / paspas statik mesh (çalışırken ayrı animasyon yok); sekme yalnızca açıkken çizilir.
 */
export class HotelWorkerSystem {
  constructor({ guests, hud }) {
    this.guests = guests;
    this.hud = hud;
    this.list = [];
    this.stars = 1;
    this.geo = null;
    // GuestView'a temizlikçi aksesuarı kancası
    const orig = guests.upsert.bind(guests);
    guests.upsert = (data) => {
      orig(data);
      if (data.kind === 'worker') this.decorate(guests.items.get(data.id));
    };
  }

  /** Kova + paspas (bir kez, karakterin içine) */
  decorate(it) {
    if (!it || it.obj.userData.mop) return;
    if (!this.geo) {
      this.geo = {
        bucket: new THREE.CylinderGeometry(0.13, 0.1, 0.24, 10, 1, true).translate(0.34, 0.12, 0.12),
        stick: new THREE.CylinderGeometry(0.014, 0.014, 1.25, 5).rotateZ(0.28).translate(-0.4, 0.62, 0.18),
        head: new THREE.BoxGeometry(0.28, 0.05, 0.1).translate(-0.57, 0.03, 0.18),
        mats: {
          bucket: new THREE.MeshLambertMaterial({ color: '#2f7fd1', side: THREE.DoubleSide }),
          stick: new THREE.MeshLambertMaterial({ color: '#c9a063' }),
          head: new THREE.MeshLambertMaterial({ color: '#e8e2d0' }),
        },
      };
    }
    const g = this.geo;
    const group = new THREE.Group();
    group.add(new THREE.Mesh(g.bucket, g.mats.bucket), new THREE.Mesh(g.stick, g.mats.stick), new THREE.Mesh(g.head, g.mats.head));
    it.obj.add(group);
    it.obj.userData.mop = group;
  }

  /** HOTEL_STATE */
  setState(h) {
    this.list = h.workers ?? [];
    this.stars = h.growth?.stars ?? 1;
  }

  /** Resepsiyon PC → Çalışanlar sekmesi */
  renderTab(body, pc) {
    const money = pc.state.economy?.money ?? 0;
    const sec = (lv) => (workerTaskMs(this.stars, lv) / 1000).toFixed(1).replace('.0', '');
    body.append(el('p', 'pc-small', `Temizlikçi kirli odaları kendisi temizler (üst katlara asansörle çıkar). Bir iş şu an ${sec(1)} sn sürüyor; otelin yıldızı arttıkça (5★'de 2 sn) ve temizlikçi seviye atladıkça hızlanır. Bulduğu bahşişler otelin kasasına gider.`));

    const hire = el('div', 'product');
    const info = el('div');
    info.append(el('div', 'name', '🧹 Temizlikçi işe al'), el('div', 'desc', `${formatMoney(WORKER_RULES.HIRE_PRICE)} (kasadan, bir kerelik) · ${this.list.length}/${WORKER_RULES.MAX}`));
    const btn = el('button', null, 'İşe al');
    btn.type = 'button';
    btn.disabled = this.list.length >= WORKER_RULES.MAX || money < WORKER_RULES.HIRE_PRICE;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const res = await pc.act({ act: 'hire' }, '🧹 Yeni temizlikçi işe başladı!');
      if (!res?.ok) btn.disabled = false;
    });
    hire.append(el('div', 'icon', '🧑‍🔧'), info, btn);
    const list = el('div', 'pc-list');
    list.append(hire);

    if (!this.list.length) list.append(el('p', 'pc-small muted', 'Henüz çalışanın yok. 1 yıldızda bile işe alabilirsin.'));
    for (const w of this.list) {
      const row = el('div', 'product');
      const d = el('div');
      const left = WORKER_RULES.TASKS_PER_LEVEL - (w.tasks % WORKER_RULES.TASKS_PER_LEVEL);
      const lvText = w.level >= WORKER_RULES.MAX_LEVEL ? 'en yüksek seviye' : `sonraki seviyeye ${left} iş`;
      d.append(
        el('div', 'name', `${w.name} · Seviye ${w.level}`),
        el('div', 'desc', `${w.tasks} iş · iş başına ${sec(w.level)} sn · ${lvText}`),
        el('div', w.busy ? 'owned' : 'desc', w.busy && w.roomId ? `Şu an: Oda ${w.roomId}` : 'Lobide bekliyor'),
      );
      const fire = el('button', 'danger', 'Çıkar');
      fire.type = 'button';
      fire.addEventListener('click', async () => {
        if (fire.dataset.sure !== '1') {
          fire.dataset.sure = '1';
          fire.textContent = 'Emin misin?';
          return;
        }
        fire.disabled = true;
        await pc.act({ act: 'fire', id: w.id }, `${w.name} işten ayrıldı.`);
      });
      row.append(el('div', 'icon', '🧹'), d, fire);
      list.append(row);
    }
    body.append(list);
  }
}
