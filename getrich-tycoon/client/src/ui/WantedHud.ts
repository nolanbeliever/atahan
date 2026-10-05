// Wanted level HUD: 1-5 stars (flashing red / blue while police are chasing, amber while a call
// is out and they are on their way), the blue HIDDEN countdown while no police car can see you (and
// a warning while one is about to spot you), the arrest meter, and the full-screen BUSTED / ESCAPED
// banners. The police radio and the response countdown are in ScannerHud.

import { ECONOMY } from '../../../shared/economy.config';
import type { RadarFlash } from '../../../shared/protocol';
import type { BustedEvent, WantedState } from '../../../shared/police';
import type { DealScene } from '../../../shared/telegram';
import { formatMoney } from '../../../shared/util';
import { clear, h } from './dom';

export class WantedHud {
  readonly el: HTMLElement;
  readonly banner: HTMLElement;
  private stars: HTMLElement[] = [];
  private status: HTMLElement;
  private bustFill: HTMLElement;
  private bust: HTMLElement;
  private heli: HTMLElement;
  private hidden: HTMLElement;
  private hiddenText: HTMLElement;
  private hiddenFill: HTMLElement;
  private hiddenSub: HTMLElement;
  private seen: HTMLElement;
  private seenFill: HTMLElement;
  private state: WantedState = { stars: 0, units: 0, escapeLeft: null, bust: 0 };
  private bannerTimer: number | null = null;

  constructor() {
    const row = h('div', { class: 'wanted-stars' });
    for (let i = 0; i < 5; i++) {
      const s = h('span', { class: 'wstar' }, '★');
      this.stars.push(s);
      row.append(s);
    }
    this.status = h('div', { class: 'wanted-status' });
    this.bustFill = h('div');
    this.bust = h('div', { class: 'wanted-bust' }, h('span', null, 'ARREST'), h('div', { class: 'wanted-bust-bar' }, this.bustFill));
    this.heli = h('div', { class: 'wanted-heli', 'data-testid': 'wanted-heli' });
    this.hiddenText = h('div', { class: 'wh-title', 'data-testid': 'wanted-hidden' });
    this.hiddenFill = h('div');
    this.hiddenSub = h('div', { class: 'wh-sub' });
    this.hidden = h('div', { class: 'wanted-hidden' }, this.hiddenText, h('div', { class: 'wh-bar' }, this.hiddenFill), this.hiddenSub);
    this.seenFill = h('div');
    this.seen = h('div', { class: 'wanted-seen', 'data-testid': 'wanted-seen' }, h('span', null, '👁 GÖRÜLÜYORSUN'), h('div', { class: 'wanted-bust-bar' }, this.seenFill));
    this.el = h('div', { class: 'wanted', 'data-testid': 'wanted' }, row, this.status, this.hidden, this.seen, this.heli, this.bust);
    this.banner = h('div', { class: 'big-banner', 'data-testid': 'police-banner' });
  }

  get wanted(): WantedState {
    return this.state;
  }

  set(s: WantedState): void {
    this.state = s;
    this.el.classList.toggle('show', s.stars > 0 || s.bust > 0);
    this.el.classList.toggle('pursuit', !!s.engaged && s.units > 0);
    this.el.classList.toggle('called', !!s.call);
    this.stars.forEach((el, i) => el.classList.toggle('on', i < s.stars));
    const hiding = s.escapeLeft !== null && !!s.engaged;
    if (hiding) this.status.textContent = s.search ? 'POLİS SENİ ARIYOR · SEARCHING' : 'GÖZDEN KAYBOLDUN';
    else if (s.engaged) this.status.textContent = `POLİS TAKİBİ · ${s.units} ekip`;
    else if (s.call) this.status.textContent = s.call.arrived ? 'POLİS OLAY YERİNDE · seni arıyor' : `İHBAR EDİLDİN · ${s.units} ekip yolda · uzaklaş!`;
    else if (s.stars > 0) this.status.textContent = 'ARANIYORSUN';
    else this.status.textContent = '';
    // Out of sight: the blue countdown to the escape (it only starts over if a police car keeps
    // you in sight for 2 s).
    this.hidden.classList.toggle('show', hiding);
    if (hiding) {
      const left = Math.max(0, Math.ceil(s.escapeLeft!));
      this.hiddenText.textContent = `HIDDEN / GİZLENDİN - İZİNİ KAYBETTİRİYORSUN (${mmss(left)})`;
      this.hiddenFill.style.width = `${Math.round((left / ECONOMY.police.sight.hiddenSec) * 100)}%`;
      this.hiddenSub.textContent = s.search ? 'Ekipler son görüldüğün yeri arıyor (sarı tepe lambaları). Görüş alanlarına girme!' : 'Duvarların, binaların arkasında kal: 2 sn görülürsen sayaç baştan başlar.';
    }
    const seen = s.seen ?? 0;
    this.seen.classList.toggle('show', seen > 0 && seen < 1);
    this.seenFill.style.width = `${Math.round(Math.min(1, seen) * 100)}%`;
    this.heli.textContent = s.heli === 'seen' ? '🚁 HELİKOPTER SENİ İZLİYOR' : s.heli === 'lost' ? '🚁 Helikopter seni kaybetti' : '';
    this.heli.classList.toggle('seen', s.heli === 'seen');
    this.heli.style.display = s.heli ? '' : 'none';
    this.bust.classList.toggle('show', s.bust > 0 && s.bust < 1);
    this.bustFill.style.width = `${Math.round(Math.min(1, s.bust) * 100)}%`;
  }

  busted(e: BustedEvent): void {
    this.set({ stars: 0, units: 0, escapeLeft: null, bust: 0 });
    this.show(
      'busted',
      [
        h('div', { class: 'bb-title' }, 'BUSTED!'),
        h('div', { class: 'bb-text' }, `POLİSE YAKALANDIN! - ${formatMoney(e.fine)} Ceza Ödendi`),
        h('div', { class: 'bb-sub' }, `Your car was impounded and a ${formatMoney(e.fine)} fine was deducted.`),
      ],
      e.cutsceneMs,
    );
  }

  escaped(reward: number, xp: number, cars = 1): void {
    this.set({ stars: 0, units: 0, escapeLeft: null, bust: 0 });
    const sub = `${cars} polis aracını atlattın · aranma seviyen tamamen silindi · +${xp} XP`;
    this.show('escaped', [h('div', { class: 'bb-kicker' }, 'KAÇTIN! · İZİ KAYBETTİRDİN'), h('div', { class: 'bb-title', 'data-testid': 'escaped-banner' }, `ESCAPED! +${formatMoney(reward)}`), h('div', { class: 'bb-sub' }, sub)], 3800);
  }

  /** A mission completed: a short banner. */
  mission(title: string, reward: string): void {
    this.show('mission', [h('div', { class: 'bb-kicker' }, 'MISSION COMPLETE · GÖREV TAMAMLANDI'), h('div', { class: 'bb-title' }, title), h('div', { class: 'bb-text' }, reward)], 3200);
  }

  /** A bridge speed radar caught you: the speed, your best, the server record. */
  radar(f: RadarFlash): void {
    const rec = f.record ? `Rekor: ${f.record.kmh} km/s · ${f.record.name}` : '';
    this.show('radar', [h('div', { class: 'bb-kicker' }, `📸 KÖPRÜ RADARI · ${f.bridge.split(' · ')[0]!.toUpperCase()}`), h('div', { class: 'bb-title', 'data-testid': 'radar-kmh' }, `${f.kmh} km/s`), h('div', { class: 'bb-text' }, f.newBest ? '🏆 Kişisel rekor!' : `En iyin: ${f.best} km/s`), h('div', { class: 'bb-sub' }, rec)], 2600);
  }

  /** A police checkpoint is waiting at the bridge's far end. */
  checkpoint(name: string): void {
    this.show('checkpoint', [h('div', { class: 'bb-kicker' }, `🚨 ${name.toUpperCase()}`), h('div', { class: 'bb-title', 'data-testid': 'checkpoint-banner' }, 'POLİS KONTROL NOKTASI'), h('div', { class: 'bb-text' }, 'BARİKATI YAR VEYA KAÇ!'), h('div', { class: 'bb-sub' }, 'Ortadaki şeritte çivili şerit var: kenardaki araçlara çarparak geç.')], 4200);
  }

  /** Through a checkpoint. */
  breakthrough(reward: number): void {
    this.show('escaped', [h('div', { class: 'bb-kicker' }, 'KONTROL NOKTASI'), h('div', { class: 'bb-title' }, 'BARİKAT YARILDI!'), h('div', { class: 'bb-text' }, reward > 0 ? `+${formatMoney(reward)}` : 'Geçtiniz!')], 3200);
  }

  /** A hitman contract paid out. */
  contract(title: string, reward: string): void {
    this.show('contract', [h('div', { class: 'bb-kicker' }, 'İŞ TAMAM · CONTRACT COMPLETE'), h('div', { class: 'bb-title' }, title), h('div', { class: 'bb-text' }, reward)], 3600);
  }

  /** A Telegram handover in the car: done, or the customer was a cop. */
  deal(sc: DealScene): void {
    if (sc.cop) {
      this.show('heist-lost', [h('div', { class: 'bb-kicker' }, '🚨 ROZET · GİZLİ POLİS'), h('div', { class: 'bb-title', 'data-testid': 'deal-banner' }, 'POLİS! KAÇ!'), h('div', { class: 'bb-text' }, `${sc.grams} gr el konuldu · 3 yıldızla aranıyorsun`)], 3600);
      return;
    }
    const text = sc.kind === 'buy' ? `Siyah poşette ${sc.grams} gr · -${formatMoney(sc.money)}` : `+${formatMoney(sc.money)} kara para · ${sc.grams} gr teslim`;
    this.show('heist', [h('div', { class: 'bb-kicker' }, 'ANLAŞMA TAMAMLANDI'), h('div', { class: 'bb-title', 'data-testid': 'deal-banner' }, 'DEAL COMPLETED'), h('div', { class: 'bb-text' }, text)], 3200);
  }

  /** The job is done: the loot is in the bag. */
  heistDone(title: string, loot: number): void {
    this.show('heist', [h('div', { class: 'bb-kicker' }, `${title} · SOYGUN BAŞARILI`), h('div', { class: 'bb-title', 'data-testid': 'heist-banner' }, `ÇANTADA ${formatMoney(loot)}`), h('div', { class: 'bb-text' }, 'ŞİMDİ POLİSİ ATLAT!'), h('div', { class: 'bb-sub' }, 'Kaçarsan para senin (kara para). Yakalanırsan polis el koyar.')], 4200);
  }

  /** Got away with it: dirty money. */
  heistCashed(amount: number, xp: number): void {
    this.show('heist', [h('div', { class: 'bb-kicker' }, 'İZİ KAYBETTİRDİN · TEMİZ KAÇIŞ'), h('div', { class: 'bb-title' }, `KARA PARA +${formatMoney(amount)}`), h('div', { class: 'bb-text' }, `+${xp} XP`), h('div', { class: 'bb-sub' }, 'Kara para harcanamaz: Emlakçıdan işletme alıp akla.')], 4200);
  }

  /** The job fell through, or the police took the bag. */
  heistLost(title: string, text: string): void {
    this.show('heist-lost', [h('div', { class: 'bb-kicker' }, 'SOYGUN'), h('div', { class: 'bb-title' }, title), h('div', { class: 'bb-text' }, text)], 3600);
  }

  /** A customer's car repaired at the Sanayi: paid on the spot. */
  mechPaid(amount: number, owner: string, model: string): void {
    this.show('mech', [h('div', { class: 'bb-kicker' }, `${owner} · ${model}`.toUpperCase()), h('div', { class: 'bb-title', 'data-testid': 'mech-banner' }, 'TAMİR TAMAM'), h('div', { class: 'bb-text' }, `+${formatMoney(amount)}`), h('div', { class: 'bb-sub' }, 'Müşteri nakit ödedi. Sıradaki araç geliyor.')], 3000);
  }

  /** The stolen car is the player's for good. */
  stolenOk(model: string): void {
    this.show('stolen-ok', [h('div', { class: 'bb-kicker' }, model.toUpperCase()), h('div', { class: 'bb-title' }, 'CAR STOLEN SUCCESSFULLY!'), h('div', { class: 'bb-text' }, '(Araç Tamamen Senindir)'), h('div', { class: 'bb-sub' }, 'Keep it, store it or sell it on the Marketplace.')], 4200);
  }

  private show(kind: string, children: HTMLElement[], ms: number): void {
    clear(this.banner);
    this.banner.append(h('div', { class: 'bb-card' }, ...children));
    this.banner.className = `big-banner ${kind}`;
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), ms);
  }
}

/** 45 -> "00:45". */
function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}
