import { DROP_SITES, RAID_RULES as R } from '/shared/illegal.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/**
 * Kaçak yük indirme + polis baskını (istemci). Sunucu yetkilidir (PoliceRaidService); durum IllegalLogistics'in
 * ILLEGAL_STATE'i içinde `unload` alanıyla gelir: { site, start, end, ms, raid: { arriveAt, units } | null }.
 *  - HUD: indirme ilerleme çubuğu (tır yerinde durmalı), baskın gelirse kırmızı geri sayım ("ekipler N sn'de burada")
 *    ve "Kaç!" ipucu; baskın başlayınca siren.
 *  - Baskın ekipleri lojistiğin yapay araç kanalıyla (LOGI_AGENTS) çizilir — LargeWorldMap'in polis araçları.
 */
export class PoliceRaidSystem {
  constructor({ engine, net, hud, illegal, settings }) {
    Object.assign(this, { engine, net, hud, illegal, settings });
    this.u = null;
    this.raidSeen = false;
    this.key = '';
    illegal.raid = this;
    this.buildHud();
  }

  buildHud() {
    const box = el('div', 'panel');
    box.id = 'raid-hud';
    box.hidden = true;
    const title = el('div', 'raid-title');
    const bar = el('div', 'raid-bar');
    const fill = el('i');
    bar.append(fill);
    const line = el('div', 'raid-line');
    box.append(title, bar, line);
    document.body.append(box);
    this.el = { box, title, bar, fill, line };
  }

  /** IllegalLogistics.onState'ten: tam özel durumda `unload` gelir (yalnızca takip güncellemesinde gelmez) */
  onState(s) {
    if (!('unload' in s)) return;
    const u = s.unload;
    if (u?.raid && !this.raidSeen) {
      this.raidSeen = true;
      if (this.settings.sound) this.illegal.siren(1);
      this.el.box.classList.add('raid-on');
    }
    if (!u) {
      this.raidSeen = false;
      this.el.box.classList.remove('raid-on');
    }
    this.u = u;
    this.key = '';
    this.engine.wake();
  }

  /** @returns {boolean} kare gerekli mi (indirme sürüyorsa çubuk akar) */
  update() {
    const u = this.u;
    if (!u) {
      if (!this.el.box.hidden) this.el.box.hidden = true;
      return false;
    }
    if (this.el.box.hidden) this.el.box.hidden = false;
    const now = this.net.serverNow();
    const k = Math.max(0, Math.min(1, (now - u.start) / (u.ms || R.UNLOAD_MS)));
    const site = DROP_SITES[u.site];
    const left = Math.max(0, (u.end - now) / 1000);
    let line;
    if (u.raid) {
      const eta = Math.max(0, (u.raid.arriveAt - now) / 1000);
      line = eta > 0
        ? `🚨 BASKIN! ${u.raid.units} ekip ${eta.toFixed(1).replace('.', ',')} sn'de burada — indirme ${left.toFixed(1).replace('.', ',')} sn. Bitir ya da KAÇ (sür)!`
        : '🚨 Ekipler körfezde!';
    } else {
      line = `Tır yerinde dursun — ${left.toFixed(1).replace('.', ',')} sn (kalkarsan indirme yarıda kalır)`;
    }
    const key = `${Math.round(k * 100)}|${line}`;
    if (key !== this.key) {
      this.key = key;
      this.el.title.textContent = `📦 ${site?.icon ?? ''} ${site?.name ?? ''}: kaçak mallar indiriliyor`;
      this.el.fill.style.transform = `scaleX(${k.toFixed(3)})`;
      this.el.line.textContent = line;
    }
    if (this.u.raid && this.settings.sound && performance.now() - (this.sirenAt ?? 0) > 1350) {
      this.sirenAt = performance.now();
      this.illegal.siren(1);
    }
    return true;
  }

  reset() {
    this.u = null;
    this.raidSeen = false;
    this.el.box.classList.remove('raid-on');
  }
}
