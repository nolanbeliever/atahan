import { EVT } from '/shared/constants.js';
import { TELEPORTS } from '/shared/layout.js';

const DESC = {
  hotel: 'Lobi, resepsiyon, bar',
  home: 'Achterstraat\'taki evin',
  garage: 'Araçların ve AutoGalerie',
  drag: 'Şehir kenarında hız pisti',
};

/**
 * Hızlı ışınlanma (Teleport UI): otel lobisi, evin, yeraltı garajı, drag pisti.
 *  - Masaüstünde M, telefonda 🗺️ Işınlan uygulaması. Hedef seçilince sunucu konumu doğrular ve
 *    yazar (araçta / uyurken / polis kapındayken olmaz, 4 sn bekleme); kısa bir kararma geçişi.
 * Pil: panel statik DOM; karede iş yok.
 */
export class FastTravelSystem {
  constructor({ net, hud, modal, player, interaction, engine, phone, house }) {
    Object.assign(this, { net, hud, modal, player, interaction, engine, phone, house });
    this.busy = false;
    const $ = (id) => document.getElementById(id);
    this.el = { panel: $('travel-panel'), list: $('travel-list'), msg: $('travel-msg'), fade: $('lift-fade') };
    $('travel-close').addEventListener('click', () => this.modal.close(this.el.panel));
    phone?.registerApp({ id: 'travel', icon: '🗺️', name: 'Işınlan', order: 6, render: (body) => this.renderInto(body, true) });
  }

  /** main.js komut zinciri: M */
  command(cmd) {
    if (cmd !== 'travel') return false;
    this.open();
    return true;
  }

  open() {
    this.el.msg.textContent = '';
    this.renderInto(this.el.list, false);
    this.modal.open(this.el.panel);
  }

  renderInto(box, inPhone) {
    box.replaceChildren();
    const grid = document.createElement('div');
    grid.className = 'travel-grid';
    for (const t of TELEPORTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'travel-btn';
      const ic = document.createElement('span');
      ic.className = 'tv-ic';
      ic.textContent = t.icon;
      const nm = document.createElement('b');
      nm.textContent = t.name;
      const ds = document.createElement('small');
      ds.textContent = DESC[t.id] ?? '';
      b.append(ic, nm, ds);
      if (t.id === 'home' && !this.house.ownedHouseId) b.disabled = true;
      b.addEventListener('click', () => this.go(t.id, inPhone));
      grid.append(b);
    }
    box.append(grid);
  }

  async go(to, inPhone) {
    if (this.busy) return;
    this.busy = true;
    const res = await this.net.request(EVT.TELEPORT, { to });
    this.busy = false;
    if (!res.ok) {
      if (inPhone) this.hud.toast(res.error || 'Işınlanılamadı.', 'warn');
      else this.el.msg.textContent = res.error || 'Işınlanılamadı.';
      return;
    }
    if (inPhone) this.phone.close();
    else this.modal.close(this.el.panel);
    const t = TELEPORTS.find((x) => x.id === to);
    const fade = this.el.fade;
    fade.textContent = `${t.icon} ${t.name}`;
    fade.hidden = false;
    fade.classList.add('on');
    this.player.setPose(res.x, res.z, res.yaw);
    this.net.sendMove(res.x, res.z, res.yaw);
    this.net.flushMove?.();
    this.interaction.invalidate();
    this.engine.wake();
    setTimeout(() => {
      fade.classList.remove('on');
      setTimeout(() => { fade.hidden = true; }, 350);
    }, 500);
  }
}
