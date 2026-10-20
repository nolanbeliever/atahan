import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { CAR_BY_ID, formatEuro } from '/shared/cars.js';
import { HWY, trunkAt, inHighwayRegion, HOTEL_DELIVERY } from '/shared/worldmap.js';
import {
  CONTRA_BY_ID, ILLEGAL_RULES as R, CONTACT, SAFE_DROP, SCANNERS, inContactZone, inDropZone, heatStars, DROP_SITES, raidChance, RAID_RULES,
} from '/shared/illegal.js';
import { makeCharacter } from './Characters.js';
import { signMaterial, panel } from '../world/CarWorldKit.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fmtTime = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const SIDE_NAMES = { front: 'ön', rear: 'arka', left: 'sol', right: 'sağ' };
const inRect = (b, x, z, tol = 0) => x > b.minX - tol && x < b.maxX + tol && z > b.minZ - tol && z < b.maxZ + tol;
const pct = (v) => `%${Math.round(v * 100)}`;

/**
 * İllegal sevkiyat + dinamik polis kıskacı (istemci). LargeWorldMap'e (logi) bağlanır:
 *  - Lojistik panosuna "🕶️ Gizli zula bölmesi" (tır başına, cüzdandan) ve "Limandaki tanıdık" teklifi eklenir
 *    (5–10 dk'da bir tek teklif; kazanç 700–800 €). Mallar Eski Kantar Deposu'nda ya da otelin mal kabul alanında
 *    indirilir; indirme + polis baskını HUD'u PoliceRaidSystem'dedir (this.raid).
 *  - Dünya: limanda K-17 konteyneri + tanıdık, FrisDepot'un batı köşesinde Eski Kantar Deposu, otoyolun üstünde
 *    iki gümrük tarayıcı kapısı (logi.world.group'a; yalnızca otoyol bölgesindeyken çizilir).
 *  - HUD: aranma yıldızları + ısı çubuğu + kıskaç / kaçış sayaçları; sunucunun telsiz mesajları NOTIFY ile gelir.
 *  - Polis / sivil araçlar katıdır (Collision kısıtı: araç dairesinin dışına itilir, tır yavaşlar).
 *  - Siren: sentez (iki tonlu kayan üçgen dalga), yakındaki ekip sayısına göre.
 * Sunucu yetkilidir (IllegalLogisticsService): ısı, ekipler, yakalanma, para.
 */
export class IllegalLogistics {
  constructor({ engine, net, hud, interaction, player, collision, modal, device, settings, sfx, logi, vehicles, getWallet }) {
    Object.assign(this, { engine, net, hud, interaction, player, collision, modal, device, settings, sfx, logi, vehicles, getWallet });
    this.st = { price: R.COMPARTMENT_PRICE, night: false, trucks: [], offers: [], chase: null, stats: {} };
    this.pending = false;
    this.asked = false;
    this.bumped = 0;
    this.sirenAt = 0;
    this.flashUntil = 0;
    logi.illegal = this;

    this.buildWorld();
    this.buildHud();

    // Polis / sivil araçlar katı: oyuncu (yaya ya da sürücü) araç dairesinin dışına itilir
    collision.constraints.push((pos, r) => {
      if (!this.logi.inRegion || !this.logi.agentMeshes.size) return;
      const rad = R.AGENT_RADIUS + Math.min(r, 1.4);
      for (const m of this.logi.agentMeshes.values()) {
        const dx = pos.x - m.position.x;
        const dz = pos.z - m.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rad * rad) continue;
        const d = Math.sqrt(d2) || 1e-6;
        pos.x = m.position.x + (dx / d) * rad;
        pos.z = m.position.z + (dz / d) * rad;
        this.bumped = performance.now();
      }
    });
  }

  // ---- Durum ---------------------------------------------------------------------------------------

  reset() {
    this.asked = false;
    this.st.chase = null;
    this.renderHud();
  }

  onState(s) {
    if (!s) return;
    if (s.caught) this.onCaught(s.caught);
    const hadChase = !!this.st.chase;
    this.st = { ...this.st, ...s };
    this.raid?.onState(s);
    if (!s.chase && 'chase' in s && hadChase) this.engine.requestRender();
    this.renderHud();
    if (!('chase' in s && Object.keys(s).length === 1)) this.logi.rerender();
    this.interaction.invalidate();
  }

  async refresh(act = 'state') {
    this.asked = true;
    const res = await this.net.request(EVT.ILLEGAL_ACT, { act });
    if (res?.ok && res.state) this.onState(res.state);
  }

  onCaught(c) {
    this.flashUntil = performance.now() + 2600;
    this.el.flash.hidden = false;
    this.el.flash.classList.add('on');
    setTimeout(() => {
      this.el.flash.classList.remove('on');
      this.el.flash.hidden = true;
    }, 2600);
    if (this.settings.sound) this.sfx?.clink?.();
    void c;
  }

  /** Kendi kaçak işim: herkese açık iş kaydı + yalnızca bana gelen ayrıntı (mallar, peşin bedel, kazanç) */
  get job() {
    const j = this.logi.myJob;
    if (j?.legal !== false) return null;
    const d = this.st.job?.id === j.id ? this.st.job : null;
    return { ...j, hidden: d?.hidden ?? [], cost: d?.cost ?? 0, pay: d?.pay ?? 0 };
  }

  // ---- Dünya ---------------------------------------------------------------------------------------

  buildWorld() {
    const g = new THREE.Group();
    const mat = (color, basic = false) => (basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color }));
    const box = (m, x0, x1, y0, y1, z0, z1) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      g.add(mesh);
      return mesh;
    };
    const yellow = mat(0xf2c230, true);
    const frame = (b) => {
      for (const [x0, x1, z0, z1] of [[b.minX, b.maxX, b.minZ, b.minZ + 0.3], [b.minX, b.maxX, b.maxZ - 0.3, b.maxZ], [b.minX, b.minX + 0.3, b.minZ, b.maxZ], [b.maxX - 0.3, b.maxX, b.minZ, b.maxZ]]) box(yellow, x0, x1, 0.04, 0.07, z0, z1);
    };
    // K-17 konteyneri (açık kapılı, içi karanlık) + tanıdık
    const C = CONTACT.container;
    box(mat(0x2f6b3a), C.x - 1.22, C.x + 1.22, 0, 2.59, C.z - 6.1, C.z + 6.1);
    box(mat(0x0d0f12), C.x - 1.25, C.x - 1.2, 0.15, 2.45, C.z - 5.9, C.z + 5.9);
    this.collision.add(C.x - 1.3, C.x + 1.3, C.z - 6.2, C.z + 6.2);
    frame(CONTACT.zone);
    const npc = makeCharacter({ hair: 3, skin: 2 }, { color: '#22252b' });
    npc.position.set(CONTACT.npc.x, 0, CONTACT.npc.z);
    npc.rotation.y = -Math.PI / 2;
    g.add(npc);
    g.add(panel(signMaterial(['K-17', 'Haven Zuid · transit'], { w: 256, h: 128, bg: '#2f6b3a' }), 2.2, 1.1, C.x - 1.26, 2.0, C.z, 'x-'));
    // Eski Kantar Deposu (FrisDepot avlusunun batı köşesi)
    const S = SAFE_DROP.shed;
    box(mat(0x6b5a4a), S.minX, S.maxX, 0, 4.6, S.minZ, S.maxZ);
    box(mat(0x3a3f45), S.minX - 0.3, S.maxX + 0.3, 4.6, 4.9, S.minZ - 0.3, S.maxZ + 0.4);
    box(mat(0x8a8f96), S.minX + 3, S.maxX - 3, 0.1, 3.9, S.maxZ, S.maxZ + 0.06); // kepenk
    this.collision.add(S.minX, S.maxX, S.minZ, S.maxZ);
    g.add(panel(signMaterial(['🏚️ KANTAR', 'Kiralık depo'], { w: 256, h: 128, bg: '#3a2f25' }), 3.4, 1.6, (S.minX + S.maxX) / 2, 4.2, S.maxZ + 0.08, 'z+'));
    frame(SAFE_DROP.zone);
    // Gümrük tarayıcı kapıları (otoyolun üstünde köprü + mavi ışık şeridi)
    const post = mat(0x9aa3ad);
    const glow = mat(0x2b6dff, true);
    for (const sc of SCANNERS) {
      const t = trunkAt(sc.s);
      const gate = new THREE.Group();
      gate.position.set(t.x, 0, t.z);
      gate.rotation.y = Math.atan2(-t.ux, -t.uz);
      const w = HWY.trunkHalf + 1.4;
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.4, 0.7), post);
        p.position.set(sx * w, 3.2, 0);
        gate.add(p);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 0.7, 0.9, 0.9), post);
      beam.position.set(0, 6.4, 0);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 2, 0.12, 0.95), glow);
      strip.position.set(0, 5.92, 0);
      gate.add(beam, strip);
      gate.add(panel(signMaterial(['📡 GÜMRÜK TARAMA', 'Douane · X-ray'], { w: 512, h: 128, bg: '#1d2a36' }), 6, 1.5, 0, 7.6, 0.5, 'z+'));
      g.add(gate);
      // Direkler yol dışında: çarpışma kutuları
      for (const sx of [-1, 1]) {
        const px = t.x + Math.cos(gate.rotation.y) * sx * w;
        const pz = t.z - Math.sin(gate.rotation.y) * sx * w;
        this.collision.add(px - 0.4, px + 0.4, pz - 0.4, pz + 0.4);
      }
    }
    g.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    this.logi.world.group.add(g);
    this.npc = npc;
  }

  // ---- Hedefler (E) ----------------------------------------------------------------------------------

  /** truck: sürülen tır (yoksa yaya) */
  findTarget(px, pz, f, truck) {
    const job = this.job;
    if (truck) {
      if (!job) return null;
      const at = { x: px, z: pz, marker: false };
      if (job.state === 'accepted' && inContactZone(px, pz, 1)) {
        return { ...at, short: 'Yükle', label: `🕶️ K-17: malları gizli bölmeye al (peşin ${formatEuro(job.cost)}, cüzdandan)`, use: () => this.act('load') };
      }
      if (job.state !== 'loaded' || !truck.trailer || this.st.unload) return null; // indirme sürerken istem yok
      const heat = this.st.chase?.heat ?? 0;
      if (inDropZone(px, pz, 1)) {
        return { ...at, short: 'İndir', label: `🏚️ Eski Kantar Deposu: malları indir (~${R.UNLOAD_SEC} sn · baskın riski ${pct(raidChance('depot', heat, this.st.night))})`, use: () => this.act('drop', { site: 'depot' }) };
      }
      if (inRect(HOTEL_DELIVERY.zone, px, pz, 1)) {
        return { ...at, short: 'İndir', label: `🏨 Mal kabul alanı: kaçak malları alıcıya indir (~${R.UNLOAD_SEC} sn · baskın riski ${pct(raidChance('hotel', heat, this.st.night))}!)`, use: () => this.act('drop', { site: 'hotel' }) };
      }
      return null;
    }
    // Yaya: limandaki tanıdıkla konuş → lojistik panosu
    const dx = CONTACT.npc.x - px;
    const dz = CONTACT.npc.z - pz;
    const d = Math.hypot(dx, dz);
    if (d < 2.4 && (d < 0.8 || (dx * f.x + dz * f.z) / d > 0.3)) {
      return {
        x: CONTACT.npc.x, z: CONTACT.npc.z, marker: false, short: 'Konuş',
        label: this.st.trucks.some((t) => t.hidden) ? '🕶️ Tanıdık: "İş var, ilgilenir misin?"' : '🕶️ Tanıdık: "Dorsende gizli bölme olsa konuşurduk…"',
        use: () => {
          this.refresh('board');
          this.logi.openDealer();
        },
      };
    }
    return null;
  }

  async act(act, extra = {}) {
    if (this.pending) return null;
    this.pending = true;
    const res = await this.net.request(EVT.ILLEGAL_ACT, { act, ...extra });
    this.pending = false;
    if (!res?.ok) {
      this.hud.toast(res?.error || 'Olmadı.', 'warn');
      return res;
    }
    if (res.text) this.hud.toast(res.text, 'info');
    if ((act === 'load' || act === 'drop') && this.settings.sound) this.sfx?.clink?.();
    this.logi.route = null;
    this.logi.rerender();
    return res;
  }

  // ---- Navi / harita -----------------------------------------------------------------------------------

  turnHint(here, destSite) {
    const job = this.job;
    if (!job || here !== destSite) return '';
    return job.state === 'accepted' ? '🕶️ K-17 konteynerinin önündeki sarı çerçevede dur → E' : '🏚️ Kantar deposunun önündeki sarı çerçevede dur → E (ya da otelin 🏨 mal kabul alanı)';
  }

  drawMap(ctx, X, Z, view) {
    const job = this.job;
    for (const sc of SCANNERS) {
      const t = trunkAt(sc.s);
      ctx.fillStyle = '#2b6dff';
      ctx.fillRect(X(t.x) - 2, Z(t.z) - 6, 4, 12);
    }
    if (!job) return;
    const k = Math.abs(X(1) - X(0));
    const zones = job.state === 'accepted'
      ? [[CONTACT.zone, '🕶️ K-17', '#f2c230']]
      : [[SAFE_DROP.zone, '🏚️ Kantar', '#f2c230'], [HOTEL_DELIVERY.zone, '🏨 Mal kabul (riskli)', '#ff6b6b']];
    ctx.lineWidth = 2;
    for (const [b, name, color] of zones) {
      ctx.strokeStyle = color;
      ctx.strokeRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * k, (b.maxZ - b.minZ) * k);
      if (!view) {
        ctx.fillStyle = color === '#f2c230' ? '#ffe28a' : '#ffb3b3';
        ctx.fillText(name, X(b.maxX) + 30, Z(b.minZ) - 4);
      }
    }
  }

  // ---- Pano --------------------------------------------------------------------------------------------

  jobCard(pub) {
    if (this.st.job?.id !== pub.id && this.askedJob !== pub.id) { // ayrıntı henüz gelmediyse bir kez iste
      this.askedJob = pub.id;
      this.refresh();
    }
    const job = this.job ?? pub;
    const h = job.hidden?.[0];
    const g = h ? CONTRA_BY_ID[h.good] : null;
    const card = el('div', 'logi-job ill-job');
    card.append(el('b', null, `🕶️ Kaçak iş: ${h?.qty ?? ''} ${g?.unit ?? ''} ${g?.name ?? ''}`));
    if (job.state === 'accepted') {
      card.append(el('div', null, `1/2 · ⚓ Limandaki K-17 konteynerine bölmeli tırınla git, dur, E: yükle (peşin ${formatEuro(job.cost)}, cüzdandan)`));
    } else {
      const left = (job.deadline - this.net.serverNow()) / 1000;
      card.append(el('div', null, `2/2 · İndir (~${R.UNLOAD_SEC} sn, tır yerinde durmalı): 🏚️ FrisDepot'un batı köşesindeki Eski Kantar Deposu (baskın ${pct(DROP_SITES.depot.raid)}) ya da otelin lojistik avlusundaki 🏨 mal kabul alanı (yakın ama baskın ${pct(DROP_SITES.hotel.raid)}; yakalanırsan otelin itibarı da düşer)`));
      card.append(el('small', null, `${left > 0 ? `⏱ ${fmtTime(left)} kaldı` : '⏱ Gecikti (kazanç ×0,7)'} · hasar %${Math.round(job.damage * 100)} · kazanç: ~${formatEuro(Math.round(job.pay * (1 - job.damage)))}`));
    }
    card.append(el('small', 'ill-warn', `⚠️ Yük tırdayken polis ısısı artar (otoyolda kalmak, çarpma, tarayıcı kapıları; hız aşımı sayılmaz) — ısı baskın olasılığını da artırır. Baskın gelirse ekipler ~${Math.round(RAID_RULES.ETA_MS / 1000)} sn'de körfeze varır: indirmeyi bitir ya da kaç. Yakalanırsan mallara el konur, ceza ~${formatEuro(R.FINE_BASE + Math.round(job.pay * R.FINE_SHARE))}.`));
    const row = el('div', 'logi-job-btns');
    const map = el('button', null, '🗺️ Harita');
    map.type = 'button';
    map.addEventListener('click', () => this.logi.openMap());
    const cancel = el('button', 'danger', job.state === 'loaded' ? 'Malları boşalt (takip sürer)' : 'Vazgeç');
    cancel.type = 'button';
    cancel.addEventListener('click', () => this.logi.cancel());
    row.append(map, cancel);
    card.append(row);
    return card;
  }

  renderBoard(root, where) {
    if (!this.asked) this.refresh('board');
    const st = this.st;
    const sec = el('div', 'ill-sec');
    sec.append(el('div', 'logi-sub', `🕶️ Gizli zula bölmesi — ${formatEuro(st.price)} / tır (cüzdandan)`));
    const wallet = this.getWallet();
    if (!st.trucks.length) sec.append(el('p', 'logi-hint', 'Önce bir tır al. Bölme dorsenin tabanına takılır; üstü normal yükle örtülür.'));
    for (const t of st.trucks) {
      const row = el('div', 'logi-mine ill-truck');
      row.append(el('span', null, `${CAR_BY_ID[t.model]?.name ?? t.model} — ${t.hidden ? '✅ gizli bölme var' : 'bölme yok'}`));
      if (!t.hidden) {
        const b = el('button', 'lo-take', `Taktır · ${formatEuro(st.price)}`);
        b.type = 'button';
        b.disabled = this.pending || wallet < st.price;
        b.addEventListener('click', async () => {
          await this.act('buy', { vehicle: t.id });
          this.refresh('board');
        });
        row.append(b);
      }
      sec.append(row);
    }
    if (st.trucks.some((t) => t.hidden)) {
      sec.append(el('div', 'logi-sub', `🕶️ Limandaki tanıdık — 5–10 dk'da bir tek iş${st.night ? ' · 🌙 gece: daha az dikkat, baskın riski düşük' : ''}`));
      const job = this.logi.myJob;
      const now = this.net.serverNow();
      const list = el('div', 'logi-offers');
      for (const o of st.offers) {
        const g = CONTRA_BY_ID[o.good];
        const row = el('div', 'logi-offer ill-offer');
        row.append(el('div', 'lo-icon', g.icon));
        const info = el('div', 'lo-info');
        info.append(el('b', null, `${o.qty} ${g.unit} ${g.name}`), el('small', null, `⚓ K-17 → 🏚️ Kantar deposu ya da 🏨 otelin mal kabul alanı · süre ${fmtTime(o.timeSec)} · ${fmtTime((o.expires - now) / 1000)} sonra kalkar`));
        info.append(el('small', null, `Kazanç ${formatEuro(o.pay)} (cüzdana) · peşin mal bedeli ${formatEuro(o.cost)} (cüzdandan) · risk: polis kıskacı + baskın`));
        const btn = el('button', 'lo-take', 'Al');
        btn.type = 'button';
        btn.disabled = !!job || this.pending;
        btn.addEventListener('click', () => this.act('accept', { offer: o.id }).then(() => this.refresh('board')));
        row.append(info, btn);
        list.append(row);
      }
      if (!st.offers.length) {
        const next = st.nextOfferIn != null ? ` Sonraki iş ~${Math.max(1, Math.ceil(st.nextOfferIn / 60_000))} dk içinde.` : '';
        list.append(el('p', 'logi-hint', `Tanıdık şu an sessiz…${next}`));
      }
      sec.append(list);
    }
    sec.append(el('p', 'logi-hint ill-note', 'Kaçak yük yalnızca gümrüksüz lüks mallardır (saat, parfüm, elektronik, çanta). Polisle şiddet yok: yakalanırsan mallara el konur ve ceza kesilir.'));
    root.append(sec);
    void where;
  }

  // ---- HUD ----------------------------------------------------------------------------------------------

  buildHud() {
    const box = el('div', 'panel');
    box.id = 'wanted';
    box.hidden = true;
    const stars = el('div', 'wanted-stars');
    const bar = el('div', 'wanted-bar');
    const fill = el('i');
    bar.append(fill);
    const line = el('div', 'wanted-line');
    box.append(stars, bar, line);
    document.body.append(box);
    const flash = el('div', 'police-flash');
    flash.id = 'police-flash';
    flash.hidden = true;
    flash.append(el('b', null, '🚔 YAKALANDIN'));
    document.body.append(flash);
    this.el = { box, stars, fill, line, flash };
    this.hudKey = '';
  }

  renderHud() {
    const c = this.st.chase;
    const job = this.job;
    const show = !!c && (c.heat > 0 || c.loaded || c.police > 0 || c.civil);
    if (this.el.box.hidden === show) this.el.box.hidden = !show;
    if (!show) return;
    const n = heatStars(c.heat);
    let line;
    if (c.catchIn != null) line = `🚓 Kıskaç: ${c.sides.map((s) => SIDE_NAMES[s]).join(' + ')} kapalı — ${c.catchIn.toFixed(1).replace('.', ',')} sn içinde hızlan, yoksa yakalanırsın!`;
    else if (c.pullIn != null) line = `🛑 Polis yanında, durdun — ${c.pullIn.toFixed(1).replace('.', ',')} sn`;
    else if (c.boxed) line = `🚓 Sıkıştırıldın: ${c.sides.map((s) => SIDE_NAMES[s]).join(' + ')}`;
    else if (c.escapeIn != null) line = `🏁 Gözden kayboldun — ${Math.ceil(c.escapeIn)} sn daha uzak dur`;
    else if (c.police) line = `🚓 ${c.police} ekip peşinde${c.sides.length ? ` · ${c.sides.map((s) => SIDE_NAMES[s]).join(', ')} tarafta` : ''}`;
    else if (c.civil) line = '🕵️ İşaretsiz bir araç seni izliyor';
    else if (this.st.unload) line = this.st.unload.raid ? '🚨 Baskın — indirmeyi bitir ya da kaç!' : '📦 Mallar indiriliyor — tır yerinde dursun';
    else if (c.loaded) line = job?.state === 'loaded' ? '🤫 Mallar bölmede — 🏚️ Kantar deposuna ya da 🏨 mal kabul alanına (riskli)' : '🤫 Sakin ol';
    else line = '🌡️ Polis seni hâlâ arıyor — sakin sür';
    const key = JSON.stringify([n, Math.round(c.heat), line]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.el.stars.textContent = `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;
    this.el.stars.className = `wanted-stars s${n}`;
    this.el.fill.style.transform = `scaleX(${Math.min(1, c.heat / 100).toFixed(3)})`;
    this.el.line.textContent = line;
  }

  // ---- Siren ----------------------------------------------------------------------------------------------

  siren(level) {
    const ctx = this.sfx?.begin?.(1400);
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.03 + 0.05 * level, t + 0.08);
    out.gain.setValueAtTime(0.03 + 0.05 * level, t + 1.1);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    out.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(640, t);
    osc.frequency.linearRampToValueAtTime(960, t + 0.6);
    osc.frequency.linearRampToValueAtTime(640, t + 1.2);
    osc.connect(out);
    osc.start(t);
    osc.stop(t + 1.32);
  }

  // ---- Kare ---------------------------------------------------------------------------------------------------

  /** @returns {boolean} kare gerekli mi */
  update() {
    const now = performance.now();
    if (!this.asked && this.logi.inRegion) this.refresh();
    // Polis aracına sürtünen tır yavaşlar (katı araç)
    if (this.bumped && now - this.bumped < 60 && this.vehicles.seat?.seat === 'driver') {
      this.player.vel *= 0.82;
    }
    const c = this.st.chase;
    if (!this.logi.inRegion || !c || !inHighwayRegion(this.player.pos.x, this.player.pos.z, 4)) return now < this.flashUntil;
    // Siren: yakındaki resmi ekiplere göre
    let near = 0;
    for (const m of this.logi.agentMeshes.values()) {
      if (m.userData.kind !== 'police') continue;
      const d = Math.hypot(m.position.x - this.player.pos.x, m.position.z - this.player.pos.z);
      if (d < 160) near = Math.max(near, 1 - d / 160);
    }
    if (near > 0 && this.settings.sound && now - this.sirenAt > 1350) {
      this.sirenAt = now;
      this.siren(near);
    }
    return near > 0 || now < this.flashUntil;
  }
}
