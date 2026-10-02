// The contact at the end of the dark alley: hands out hitman contracts ($1,000 a job).

import { ECONOMY } from '../../../../shared/economy.config';
import { formatMoney } from '../../../../shared/util';
import { h, icon, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';

const H = ECONOMY.hitman;

export class HitmanPanel extends Panel {
  readonly name = 'hitman';
  override size = 'medium' as const;

  title() {
    return '??? · Bağlantı';
  }
  override subtitle() {
    return 'Karanlık sokağın sonundaki adam · The contact';
  }
  iconSvg() {
    return ICONS.mask;
  }

  override init(): void {
    this.listen(this.store.on('contract', () => this.refresh()));
    void this.net
      .rpc('hitman.info', {})
      .then((r) => this.store.setContract(r.contract))
      .catch(() => undefined);
  }

  renderBody(): Child {
    const c = this.store.contract;
    const brief = h(
      'div',
      { class: 'hitman-brief' },
      h('p', null, '"Sessiz ol. Burada kimse kimseyi görmedi."'),
      h('p', null, `İki tür iş var, ikisi de ${formatMoney(H.reward)} + ${H.xp} XP:`),
      h(
        'ul',
        null,
        h('li', null, h('b', null, 'Drive-by: '), `bir mekânın duvarlarına hareket eden bir araçtan (en az ${H.drivebyMinKmh} km/s) ${H.drivebyHits} isabet. Arka koltuktaki arkadaşın camdan, motorun arkasındaki yolcu ya da motor sürerken tabancayla.`),
        h('li', null, h('b', null, 'Hedef: '), 'bir VIP ya da rakip çete üyesi haritada işaretli alanda yürüyor. Kıyafetinden tanı, bul ve indir.'),
      ),
      h('p', { class: 'muted tiny' }, 'Aynı araçtaki herkes işe ortak sayılır. Silah sesi polisi çağırır: yıldızlar gelir.'),
    );
    if (!c) {
      return h(
        'div',
        { class: 'col' },
        brief,
        h('button', { class: 'btn primary', disabled: this.busy, 'data-testid': 'hitman-take', onclick: () => void this.take() }, icon(ICONS.mask), 'Görev Al · Take a contract'),
      );
    }
    const left = Math.max(0, Math.round((c.expiresAt - this.store.serverNow()) / 1000));
    return h(
      'div',
      { class: 'col' },
      h(
        'div',
        { class: 'hitman-job', 'data-testid': 'hitman-job' },
        h('div', { class: 'hm-kicker' }, c.kind === 'driveby' ? 'DRIVE-BY' : 'HEDEF'),
        h('div', { class: 'hm-title' }, c.title),
        h('div', null, c.text),
        c.need ? h('div', { class: 'tiny' }, `İsabet: ${c.hits ?? 0}/${c.need}`) : null,
        h('div', { class: 'tiny muted' }, `Kalan süre ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · Ödül ${formatMoney(c.reward)} · Hedef alanı haritada kırmızı daire.`),
      ),
      h('button', { class: 'btn danger', disabled: this.busy, 'data-testid': 'hitman-drop', onclick: () => void this.act(() => this.net.rpc('hitman.drop', {}), () => this.store.setContract(null)) }, 'İşi bırak · Drop it'),
    );
  }

  private async take(): Promise<void> {
    await this.act(
      () => this.net.rpc('hitman.take', {}),
      (r) => {
        this.store.setContract(r.contract);
        this.game.audio.play('notify');
        this.ui.closeAll();
      },
    );
  }
}
