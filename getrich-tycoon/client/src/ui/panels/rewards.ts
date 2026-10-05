// Rewards: the 7-day login streak (one box a day, the big one on day 7) and today's playtime
// milestones (15 minutes to 3 hours of active play). Collecting one throws confetti and plays the
// coin fanfare; the money and items arrive with the player's next update.

import { DAILY_REWARDS, PLAYTIME_MILESTONES, type MegaChoice, type RewardsView } from '../../../../shared/rewards';
import { h, icon, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { confettiFrom } from '../confetti';
import { mmss } from '../RewardsHud';
import type { UI } from '../UI';

/** A short picture for a day's box. */
function boxIcon(day: number): string {
  const r = DAILY_REWARDS[day - 1]!.reward;
  if (r.legendaryCar) return ICONS.market;
  if (r.items?.some((i) => i.id.startsWith('coupon'))) return ICONS.tag;
  if (r.items?.length) return ICONS.lockpick;
  return ICONS.coins;
}

/** Big "ÖDÜL TOPLANDI" banner in the middle of the screen. */
function banner(title: string, text: string): void {
  const el = h('div', { class: 'reward-banner', 'data-testid': 'reward-banner' }, h('div', { class: 'rb-title' }, title), h('div', { class: 'rb-text' }, text));
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function celebrate(ui: UI, from: Element | null, title: string, text: string): void {
  confettiFrom(from);
  ui.game.audio.play('reward');
  banner(title, text);
}

/** Collect today's box of the login streak. */
export async function claimDaily(ui: UI, from: Element | null): Promise<boolean> {
  try {
    const r = await ui.game.net.rpc('rewards.daily', {});
    ui.game.store.setRewards(r.view);
    celebrate(ui, from, `${r.day}. GÜN ÖDÜLÜ TOPLANDI!`, r.reward);
    return true;
  } catch (err) {
    ui.error(err);
    return false;
  }
}

/** Collect a playtime milestone (the 3-hour one with the extra chosen). */
export async function claimPlaytime(ui: UI, minutes: number, choice: MegaChoice | null, from: Element | null): Promise<boolean> {
  try {
    const r = await ui.game.net.rpc('rewards.playtime', choice ? { minutes, choice } : { minutes });
    ui.game.store.setRewards(r.view);
    celebrate(ui, from, 'ÖDÜL TOPLANDI!', r.reward);
    return true;
  } catch (err) {
    ui.error(err);
    return false;
  }
}

export class RewardsPanel extends Panel {
  readonly name = 'rewards';
  override size = 'wide' as const;
  private timer = 0;
  private clock: HTMLElement | null = null;
  private fill: HTMLElement | null = null;
  private waits = new Map<number, HTMLElement>();

  title() {
    return 'Ödüller · Rewards';
  }
  override subtitle() {
    const v = this.store.rewards;
    if (!v) return 'Loading...';
    return v.daily.claimable ? 'Bugünün giriş ödülü seni bekliyor!' : `Giriş serisi: ${v.daily.day}. gün · yarın tekrar gel`;
  }
  iconSvg() {
    return ICONS.gift;
  }

  override init(): void {
    if (!this.store.rewards) {
      void this.net
        .rpc('rewards.info', {})
        .then((v) => this.store.setRewards(v))
        .catch((err) => this.ui.error(err));
    }
    this.listen(this.store.on('rewards', () => this.refresh()));
    // The playtime clock, the bar and the "x left" counters tick between server updates.
    this.timer = window.setInterval(() => this.tick(), 500);
  }

  private seconds(): number {
    return this.ui.rewardsHud.seconds();
  }

  private tick(): void {
    const v = this.store.rewards;
    if (!v) return;
    const sec = this.seconds();
    if (this.clock) this.clock.textContent = mmss(sec);
    if (this.fill) this.fill.style.width = `${(Math.min(sec, v.playtime.cap) / v.playtime.cap) * 100}%`;
    // A milestone opens when the server says so (a rewards update re-draws the panel).
    for (const [minutes, el] of this.waits) el.textContent = `${mmss(Math.max(0, minutes * 60 - sec))} kaldı`;
  }

  renderBody(): Child {
    const v = this.store.rewards;
    if (!v) return h('div', { class: 'empty' }, 'Loading rewards...');
    return h('div', { class: 'col rewards' }, this.renderDaily(v), this.renderPlaytime(v));
  }

  private renderDaily(v: RewardsView): Child {
    const d = v.daily;
    const boxes = d.boxes.map((b) => {
      const today = b.state === 'today';
      return h(
        'div',
        { class: `rw-box ${b.state}${b.day === 7 ? ' big' : ''}`, 'data-testid': 'rw-box', 'data-day': String(b.day), 'data-state': b.state },
        h('div', { class: 'rw-day' }, `${b.day}. GÜN`),
        h('div', { class: 'rw-icon' }, icon(boxIcon(b.day))),
        h('div', { class: 'rw-title' }, b.title),
        b.state === 'claimed'
          ? h('div', { class: 'rw-state' }, '✓ Alındı')
          : today
            ? h('button', { class: 'btn primary small rw-claim', disabled: this.busy, 'data-testid': 'rw-claim-daily', onclick: (e: MouseEvent) => void this.daily(e.currentTarget as HTMLElement) }, 'ÖDÜLÜ TOPLA')
            : h('div', { class: 'rw-state muted' }, '🔒'),
      );
    });
    const left = v.dayEndsAt - this.store.serverNow();
    return h(
      'section',
      { class: 'rw-section' },
      h('div', { class: 'row between' }, h('h3', null, '7 Günlük Giriş Ödülü'), h('span', { class: 'tiny muted' }, `Yeni gün: ${mmss(left / 1000)}`)),
      d.reset ? h('div', { class: 'pill red', 'data-testid': 'rw-reset' }, 'Bir gün kaçırdın: seri 1. günden yeniden başladı.') : null,
      h('div', { class: 'rw-boxes' }, boxes),
      h('div', { class: 'tiny muted' }, 'Her gün gir ve kutunu aç. Bir gün bile kaçırırsan seri 1. güne döner. 7. gün: Rare Dealer havuzundan ücretsiz efsanevi araç + $50,000 + VIP Coin.'),
    );
  }

  private renderPlaytime(v: RewardsView): Child {
    const p = v.playtime;
    const sec = this.seconds();
    this.waits.clear();
    this.clock = h('span', { class: 'mono', 'data-testid': 'rw-playtime' }, mmss(sec));
    this.fill = h('div', { class: 'rw-fill', style: { width: `${(Math.min(sec, p.cap) / p.cap) * 100}%` } });
    const ticks = p.milestones.map((m) => h('div', { class: `rw-tick${m.claimed ? ' claimed' : ''}`, style: { left: `${((m.minutes * 60) / p.cap) * 100}%` } }, h('span', null, m.minutes >= 60 ? `${m.minutes / 60} sa` : `${m.minutes} dk`)));
    const cards = p.milestones.map((m) => {
      const def = PLAYTIME_MILESTONES.find((x) => x.minutes === m.minutes)!;
      const ready = m.ready;
      let action: Child;
      if (m.claimed) action = h('div', { class: 'rw-state' }, '✓ Alındı');
      else if (ready && def.choice) {
        action = h(
          'div',
          { class: 'rw-choice' },
          (Object.keys(def.choice) as MegaChoice[]).map((c) =>
            h('button', { class: 'btn primary small', disabled: this.busy, 'data-testid': `rw-choice-${c}`, onclick: (e: MouseEvent) => void this.playtime(m.minutes, c, e.currentTarget as HTMLElement) }, def.choice![c].title),
          ),
        );
      } else if (ready) {
        action = h('button', { class: 'btn primary small rw-claim', disabled: this.busy, 'data-testid': 'rw-claim-playtime', 'data-minutes': String(m.minutes), onclick: (e: MouseEvent) => void this.playtime(m.minutes, null, e.currentTarget as HTMLElement) }, 'ÖDÜLÜ TOPLA');
      } else {
        const wait = h('div', { class: 'rw-state muted mono' }, `${mmss(Math.max(0, m.minutes * 60 - sec))} kaldı`);
        this.waits.set(m.minutes, wait);
        action = wait;
      }
      return h(
        'div',
        { class: `rw-mile${m.claimed ? ' claimed' : ''}${ready ? ' today' : ''}${def.choice ? ' big' : ''}`, 'data-testid': 'rw-mile', 'data-minutes': String(m.minutes) },
        h('div', { class: 'rw-day' }, m.minutes >= 60 ? `${m.minutes / 60} SAAT` : `${m.minutes} DK`),
        h('div', { class: 'rw-title' }, m.title),
        def.choice ? h('div', { class: 'tiny muted' }, `Seç: ${def.choice.pawn.title} veya ${def.choice.rims.title}`) : null,
        action,
      );
    });
    return h(
      'section',
      { class: 'rw-section' },
      h('div', { class: 'row between' }, h('h3', null, 'Oynama Süresi Ödülleri'), h('span', { class: 'tiny muted' }, 'Bugün aktif oynadığın süre: ', this.clock)),
      h('div', { class: 'rw-bar' }, this.fill, ticks),
      h('div', { class: 'rw-miles' }, cards),
      h('div', { class: 'tiny muted' }, 'Sadece aktif oynadığın süre sayılır (en fazla 3 saat). Sayaç her gün 03:00\'te (TR saati) sıfırlanır; sayfayı yenilesen de kaldığın yerden devam eder.'),
    );
  }

  private async daily(btn: HTMLElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const rect = btn.getBoundingClientRect();
    await claimDaily(this.ui, { getBoundingClientRect: () => rect } as Element);
    this.busy = false;
    this.refresh();
  }

  private async playtime(minutes: number, choice: MegaChoice | null, btn: HTMLElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const rect = btn.getBoundingClientRect();
    await claimPlaytime(this.ui, minutes, choice, { getBoundingClientRect: () => rect } as Element);
    this.busy = false;
    this.refresh();
  }

  override dispose(): void {
    window.clearInterval(this.timer);
    super.dispose();
  }
}
