// UI manager: HUD, chat, minimap, toasts, modal panels.

import { ECONOMY } from '../../../shared/economy.config';
import { CHAT_MAX } from '../../../shared/protocol';
import { levelProgress } from '../../../shared/progression';
import { NITRO_ITEM, PLAYTIME_MILESTONES, type RewardsView } from '../../../shared/rewards';
import { AIR_LEVELS, hasAirRide } from '../../../shared/modificationsData';
import type { ChatMessage, CustomerOffer, Notification } from '../../../shared/types';
import { formatMoney } from '../../../shared/util';
import { modelDisplayName } from '../../../shared/vehicles';
import type { Game, Interaction } from '../game/Game';
import { RpcError } from '../net/Network';
import { clear, h, icon } from './dom';
import { ICONS } from './icons';
import { DragHud, NearMissHud } from './HighwayHud';
import { GaugeHud } from './Gauge';
import { MissionsHud } from './MissionsHud';
import { RewardsHud } from './RewardsHud';
import { claimPlaytime } from './panels/rewards';
import { WantedHud } from './WantedHud';
import { PursuitHud } from './PursuitHud';
import { RaceHud } from './RaceHud';
import { Minimap } from './Minimap';
import type { Panel, PanelArg } from './Panel';
import { createPanel, type PanelName } from './panels';
import { TouchControls } from './TouchControls';
import { bar } from './widgets';

export type { PanelName };

const TOAST_ICONS: Record<string, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  error: '×',
  money: '$',
  achievement: '★',
  levelup: '▲',
};

export class ChatBox {
  readonly el: HTMLElement;
  private log: HTMLElement;
  private input: HTMLInputElement;
  private channel: HTMLSelectElement;
  active = false;

  constructor(private readonly ui: UI) {
    this.log = h('div', { class: 'chat-log', 'data-testid': 'chat-log' });
    this.input = h('input', { class: 'input', placeholder: 'Say something...', maxlength: String(CHAT_MAX), 'data-testid': 'chat-input' });
    this.channel = h('select', { class: 'input' }, h('option', { value: 'global' }, 'Global'), h('option', { value: 'nearby' }, 'Nearby'));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.send();
      }
    });
    const send = h('button', { class: 'btn small primary', 'data-testid': 'chat-send', onclick: () => void this.send() }, 'Send');
    const close = h('button', { class: 'btn small ghost', 'aria-label': 'Close chat', onclick: () => this.close() }, '✕');
    this.el = h('div', { class: 'chat' }, this.log, h('div', { class: 'chat-input-row' }, this.channel, this.input, send, close));
  }

  add(m: ChatMessage): void {
    const line = h(
      'div',
      { class: `chat-line ${m.channel}` },
      m.channel === 'system' ? null : h('span', { class: 'ch' }, m.channel === 'nearby' ? '[NEAR]' : '[ALL]'),
      m.channel === 'system' ? null : h('span', { class: 'who' }, `${m.fromName}: `),
      m.text,
    );
    this.log.appendChild(line);
    while (this.log.children.length > 60) this.log.firstChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  toggle(): void {
    if (this.active) this.close();
    else this.open();
  }

  open(): void {
    this.active = true;
    this.el.classList.add('active');
    this.ui.game.input.enabled = false;
    this.ui.game.input.releaseLock();
    this.input.focus();
  }

  close(): void {
    this.active = false;
    this.el.classList.remove('active');
    this.input.blur();
    if (!this.ui.anyOpen()) this.ui.game.input.enabled = true;
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text) {
      this.close();
      return;
    }
    try {
      await this.ui.game.net.rpc('chat.send', { channel: this.channel.value as 'global' | 'nearby', text });
      this.input.value = '';
      this.close();
    } catch (err) {
      this.ui.error(err);
    }
  }
}

export class UI {
  readonly chat: ChatBox;
  readonly minimap = new Minimap();
  readonly touch: TouchControls;
  private hud!: {
    name: HTMLElement;
    level: HTMLElement;
    xpFill: HTMLElement;
    xpText: HTMLElement;
    rep: HTMLElement;
    cash: HTMLElement;
    bank: HTMLElement;
    zone: HTMLElement;
    prompt: HTMLElement;
    drive: HTMLElement;
    gauge: HTMLElement;
    missionsBtn: HTMLElement;
    reconnect: HTMLElement;
    offers: HTMLElement;
    dealerBtn: HTMLElement;
    marketBtn: HTMLElement;
    hint: HTMLElement;
  };
  private toasts: HTMLElement;
  private driveExtras!: { nosBtn: HTMLElement; nosFill: HTMLElement; nosText: HTMLElement; airBtn: HTMLElement };
  readonly nearMiss = new NearMissHud();
  readonly dragHud = new DragHud();
  readonly cluster = new GaugeHud();
  readonly wanted = new WantedHud();
  readonly pursuit = new PursuitHud();
  readonly race = new RaceHud();
  readonly missions = new MissionsHud();
  readonly rewardsHud = new RewardsHud();
  private overlay: HTMLElement | null = null;
  private panel: Panel | null = null;
  private lastPromptKey = '';
  private offerTimer: number | null = null;

  constructor(
    readonly root: HTMLElement,
    readonly game: Game,
  ) {
    this.chat = new ChatBox(this);
    this.toasts = h('div', { class: 'toasts' });
    this.build();
    this.touch = new TouchControls(this);
    this.root.insertBefore(this.touch.el, this.hud.offers);
    game.store.on('offers', () => this.renderOffers());
    game.store.on('rewards', (v) => this.onRewards(v));
    this.rewardsHud.onClick = () => void this.giftClicked();
    this.race.onCountdown = (n) => this.game.audio.play(n === 0 ? 'levelup' : 'click');
    game.store.on('dealerships', () => this.updateHud());
    // A dot on the Marketplace button while the Rare Dealer has an unsold legendary.
    game.store.on('rare', (r) => this.hud.marketBtn.classList.toggle('alert', r.offers.some((o) => o.tier === 'legendary' && !o.soldTo)));
  }

  private build(): void {
    const name = h('div', { class: 'player-name', 'data-testid': 'hud-name' });
    const level = h('div', { class: 'level-badge', 'data-testid': 'hud-level' });
    const xpFill = h('div');
    const xpText = h('div', { class: 'xp-text' });
    const rep = h('div', { class: 'rep' });
    const cash = h('div', { class: 'cash', 'data-testid': 'hud-money' });
    const bank = h('div', { class: 'bank', 'data-testid': 'hud-bank' });
    const zone = h('div', { class: 'zone-label' });
    // Tapping or clicking the prompt does the same as E (or F on its secondary part).
    const prompt = h('div', {
      class: 'prompt',
      'data-testid': 'prompt',
      onclick: (e: MouseEvent) => ((e.target as HTMLElement).closest('.alt') ? this.game.interactSecondary() : this.game.interact()),
    });
    const gauge = h('div', { class: 'gauge' });
    const camBtn = h('button', { class: 'cam-btn', 'data-testid': 'camera-toggle', title: 'Cockpit / chase camera (C)', onclick: () => this.game.toggleCockpit() }, '◉ CAM', h('span', { class: 'hk' }, 'C'));
    // Nitro (N) and air ride (K) buttons, shown when the car has them.
    const nosFill = h('span', { class: 'nos-fill' });
    const nosText = h('span', { class: 'nos-text' }, 'NOS');
    const nosBtn = h('button', { class: 'cam-btn nos-btn', 'data-testid': 'nos-btn', title: 'Special Nitro (N)', onclick: () => void this.game.useNitro() }, nosFill, nosText, h('span', { class: 'hk' }, 'N'));
    const airBtn = h('button', { class: 'cam-btn air-btn', 'data-testid': 'air-btn', title: 'Air ride (K)', onclick: () => void this.game.airRide() }, 'AIR', h('span', { class: 'hk' }, 'K'));
    const drive = h('div', { class: 'drive-hud' }, h('div', { class: 'drive-side' }, gauge, camBtn, nosBtn, airBtn), this.cluster.el);
    this.driveExtras = { nosBtn, nosFill, nosText, airBtn };
    const reconnect = h('div', { class: 'reconnect' }, 'Connection lost - reconnecting...');
    const offers = h('div', { class: 'passthrough' });

    const dockBtn = (label: string, svg: string, hk: string, panel: PanelName, testid: string) =>
      h('button', { title: label, 'data-testid': testid, onclick: () => this.open(panel) }, icon(svg), h('span', { class: 'hk' }, hk), h('span', { class: 'tip' }, `${label} (${hk})`), h('span', { class: 'dot' }));
    const dealerBtn = dockBtn('Dealership', ICONS.store, 'J', 'dealership', 'dock-dealership');
    // Missions open a drawer beside the dock (the game keeps running).
    const missionsBtn = h(
      'button',
      { title: 'Missions', 'data-testid': 'dock-missions', onclick: () => this.missions.toggle() },
      icon(ICONS.flag),
      h('span', { class: 'hk' }, 'L'),
      h('span', { class: 'tip' }, 'Missions · Görevler (L)'),
      h('span', { class: 'dot' }),
    );
    this.missions.onStart = (id) =>
      void this.game.net
        .rpc('missions.start', { id })
        .then((r) => this.missions.set(r.missions))
        .catch((err) => this.error(err));
    const marketBtn = dockBtn('Marketplace', ICONS.market, 'B', 'market', 'dock-market');
    const dock = h(
      'div',
      { class: 'dock' },
      marketBtn,
      dockBtn('Garage / Inventory', ICONS.garage, 'I', 'inventory', 'dock-inventory'),
      dealerBtn,
      dockBtn('Auctions', ICONS.gavel, 'K', 'auctions', 'dock-auctions'),
      dockBtn('Map', ICONS.map, 'M', 'map', 'dock-map'),
      missionsBtn,
      dockBtn('Profile', ICONS.user, 'O', 'profile', 'dock-profile'),
      h('button', { title: 'Chat', 'data-testid': 'dock-chat', onclick: () => this.chat.toggle() }, icon(ICONS.chat), h('span', { class: 'hk' }, 'T'), h('span', { class: 'tip' }, 'Chat (T)'), h('span', { class: 'dot' })),
      dockBtn('Menu', ICONS.menu, 'Esc', 'menu', 'dock-menu'),
    );

    const top = h(
      'div',
      { class: 'hud-top-left' },
      h('div', { class: 'player-card' }, level, h('div', null, name, h('div', { class: 'xp-bar' }, xpFill), xpText, rep)),
      this.wanted.el,
      this.race.el,
    );
    const right = h(
      'div',
      { class: 'hud-top-right' },
      h('div', { class: 'wallet-row' }, this.rewardsHud.el, h('div', { class: 'wallet' }, cash, bank)),
      h('div', { class: 'minimap' }, this.minimap.canvas, zone),
    );
    const hint = h(
      'div',
      { class: 'help-hint' },
      h('span', null, h('span', { class: 'kbd' }, 'WASD'), 'Move'),
      h('span', null, h('span', { class: 'kbd' }, 'Shift'), 'Sprint'),
      h('span', null, h('span', { class: 'kbd' }, 'E'), 'Interact'),
      h('span', null, h('span', { class: 'kbd' }, 'F'), 'Get in / out'),
      h('span', null, h('span', { class: 'kbd' }, 'C'), 'Cockpit view'),
      h('span', null, h('span', { class: 'kbd' }, 'L'), 'Missions'),
      h('span', null, h('span', { class: 'kbd' }, 'H'), 'Horn'),
      h('span', null, h('span', { class: 'kbd' }, 'Click'), 'Mouse look'),
      h('span', null, h('span', { class: 'kbd' }, 'Enter'), 'Chat'),
      h('span', null, h('span', { class: 'kbd' }, 'Esc'), 'Menu'),
    );
    this.root.append(top, right, dock, this.missions.el, prompt, drive, this.nearMiss.el, this.dragHud.el, this.game.theft.hud, this.chat.el, hint, offers, this.toasts, this.pursuit.el, this.race.count, this.wanted.banner, reconnect);
    this.hud = { name, level, xpFill, xpText, rep, cash, bank, zone, prompt, drive, gauge, missionsBtn, reconnect, offers, dealerBtn, marketBtn, hint };
  }

  // ------------------------------------------------------------ HUD

  private greeted = false;

  onWelcome(): void {
    this.updateHud();
    this.renderOffers();
    this.panel?.refresh();
    const me = this.game.store.me;
    if (me && !this.greeted) {
      this.greeted = true;
      if (me.stats.vehiclesBought === 0) {
        this.toast({ kind: 'info', title: 'Welcome to GetRich City!', text: 'Press B to browse the Marketplace, or walk north-east to the Used Vehicle Market to inspect cars in person.' });
        setTimeout(() => this.toast({ kind: 'info', title: 'Tip', text: 'Fix up cheap cars at Wrench Bros (south-east), then sell them from your own dealership on Dealership Row (north).' }), 6000);
      } else {
        this.toast({ kind: 'success', title: `Welcome back, ${me.name}!`, text: 'Your business is exactly where you left it.' });
      }
      if (this.touch.enabled) this.showTouchHint();
    }
  }

  private touchHinted = false;

  /** Called when on-screen touch controls switch on. */
  onTouchEnabled(): void {
    this.lastPromptKey = '';
    if (this.game.store.me) this.showTouchHint();
  }

  private showTouchHint(): void {
    if (this.touchHinted) return;
    this.touchHinted = true;
    this.toast({
      kind: 'info',
      title: 'Touch controls',
      text: 'Left stick: move (push it all the way to run). Drag the screen to look around. Tap E or the prompt to interact.',
    });
  }

  onAuctions(): void {
    if (this.panel?.name === 'auctions') this.panel.refresh();
  }

  updateHud(): void {
    const p = this.game.store.me;
    if (!p) return;
    const prog = levelProgress(p.xp);
    this.hud.name.textContent = p.name;
    clear(this.hud.level);
    this.hud.level.append(h('div', null, h('small', null, 'LVL'), String(p.level)));
    this.hud.xpFill.style.width = `${Math.round(prog.fraction * 100)}%`;
    this.hud.xpText.textContent = p.level >= ECONOMY.levels.maxLevel ? 'MAX LEVEL' : `${prog.into.toLocaleString()} / ${prog.needed.toLocaleString()} XP`;
    const stars = Math.round(p.reputation / 20);
    this.hud.rep.textContent = `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} Reputation ${p.reputation}`;
    this.hud.cash.textContent = formatMoney(p.money);
    this.hud.bank.textContent = `Bank ${formatMoney(p.bank)}`;
    this.hud.dealerBtn.classList.toggle('alert', !p.dealershipPlotId && p.money >= 12_000);
    this.missions.setLevel(p.level);
    if (this.panel) this.panel.onStoreChange();
  }

  bumpMoney(): void {
    this.hud.cash.classList.add('bump');
    setTimeout(() => this.hud.cash.classList.remove('bump'), 180);
  }

  setZone(name: string): void {
    if (this.hud.zone.textContent !== name) this.hud.zone.textContent = name;
  }

  setPrompt(i: Interaction | null, secondary: Interaction | null): void {
    const key = `${i?.id}|${i?.label}|${i?.sub}|${secondary?.id}|${this.anyOpen()}`;
    if (key === this.lastPromptKey) return;
    this.lastPromptKey = key;
    const el = this.hud.prompt;
    clear(el);
    if (!i || this.anyOpen()) {
      el.classList.remove('show');
      this.touch.setActions(null, null);
      return;
    }
    el.append(h('span', { class: 'kbd' }, i.vehicle ? 'F' : 'E'), h('div', null, h('div', null, i.label), i.sub ? h('div', { class: 'sub' }, i.sub) : null));
    if (secondary) el.append(h('div', { class: 'alt' }, h('span', { class: 'kbd', style: { background: '#ffc53d' } }, 'G'), h('div', null, secondary.label)));
    el.classList.add('show');
    this.touch.setActions(i, secondary);
  }

  // ------------------------------------------------------------ rewards

  private rewardsGreeted = false;

  private onRewards(v: RewardsView): void {
    this.rewardsHud.set(v);
    if (this.rewardsGreeted) return;
    this.rewardsGreeted = true;
    // First visit of the day: show the streak so today's box gets opened (automated tests turn it off).
    let auto = true;
    try {
      auto = localStorage.getItem('getrich.autoRewards') !== '0';
    } catch {
      // Storage blocked: keep the default.
    }
    if (!auto || !v.daily.claimable) return;
    setTimeout(() => {
      if (!this.anyOpen() && !this.game.driving) this.open('rewards');
    }, 1200);
  }

  /** The gift box: collect a ready playtime reward on the spot, otherwise open the rewards panel
   *  (the daily streak, the 3-hour reward's choice). */
  private giftClicked(): void {
    const ready = this.rewardsHud.ready();
    const m = ready.milestone !== null ? PLAYTIME_MILESTONES.find((x) => x.minutes === ready.milestone) : undefined;
    if (m && !m.choice) void claimPlaytime(this, m.minutes, null, this.rewardsHud.el);
    else this.open('rewards');
  }

  /** Dot on the missions button while some are still open. */
  setMissionsPending(n: number): void {
    this.hud.missionsBtn.classList.toggle('alert', n > 0);
  }

  updateDriving(): void {
    const id = this.game.driving;
    const v = id ? this.game.store.myVehicle(id) : undefined;
    this.touch.update();
    this.hud.drive.classList.toggle('show', !!v && !this.game.inCutscene);
    this.missions.el.classList.toggle('compact', !!v);
    this.hud.hint.style.display = v ? 'none' : '';
    if (!v) return;
    // Nitro: shots left, and how much of the burning one is left.
    const x = this.driveExtras;
    const shots = this.game.store.me?.inventory[NITRO_ITEM] ?? 0;
    const burn = Math.max(0, this.game.nitroLeft()) / ECONOMY.nitro.seconds;
    x.nosBtn.style.display = shots > 0 || burn > 0 ? '' : 'none';
    x.nosBtn.classList.toggle('burning', burn > 0);
    x.nosFill.style.width = `${Math.round(burn * 100)}%`;
    x.nosText.textContent = burn > 0 ? 'NOS!' : `NOS ×${shots}`;
    const air = hasAirRide(v.mods.tuning);
    x.airBtn.style.display = air ? '' : 'none';
    if (air) x.airBtn.firstChild!.textContent = `AIR: ${AIR_LEVELS[v.mods.air ?? 0]}`;
    clear(this.hud.gauge);
    this.hud.gauge.append(
      h('div', { class: 'name' }, modelDisplayName(v.modelId)),
      h('div', { class: 'meter' }, 'FUEL', bar(v.fuel, v.fuel < 15 ? '#ff5c7a' : '#4f8cff'), `${Math.round(v.fuel)}%`),
      h('div', { class: 'meter' }, 'ENGINE', bar(v.condition.engine), `${v.condition.engine}%`),
      h('div', { class: 'meter' }, 'BODY', bar(v.condition.body), `${v.condition.body}%`),
      h('div', { class: 'meter' }, 'ODO', h('span'), `${Math.round(v.mileage / 1000)}k`),
    );
  }

  setReconnecting(on: boolean): void {
    this.hud.reconnect.classList.toggle('show', on);
  }

  fatal(message: string, relogin = false): void {
    this.closeAll();
    const card = h(
      'div',
      { class: 'overlay' },
      h(
        'div',
        { class: 'modal narrow' },
        h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, 'Disconnected')),
        h('div', { class: 'modal-body' }, h('p', null, message)),
        h(
          'div',
          { class: 'modal-foot' },
          h('button', { class: 'btn primary', onclick: () => (relogin ? this.logout() : location.reload()) }, relogin ? 'Log in' : 'Reconnect'),
        ),
      ),
    );
    this.root.appendChild(card);
  }

  logout(): void {
    try {
      localStorage.removeItem('getrich.token');
    } catch {
      /* ignore */
    }
    location.reload();
  }

  // ------------------------------------------------------------ toasts & errors

  toast(n: Notification): void {
    const t = h(
      'div',
      { class: `toast ${n.kind}`, 'data-testid': 'toast' },
      h('div', { class: 'ti' }, TOAST_ICONS[n.kind] ?? 'i'),
      h('div', null, h('div', { class: 'tt' }, n.title), n.text ? h('div', { class: 'tx' }, n.text) : null),
    );
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 5) this.toasts.firstChild?.remove();
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 320);
    }, n.kind === 'error' ? 5200 : 4200);
  }

  error(err: unknown): void {
    const msg = err instanceof RpcError || err instanceof Error ? err.message : 'Something went wrong.';
    this.toast({ kind: 'error', title: 'Action failed', text: msg });
    this.game.audio.play('error');
  }

  success(title: string, text = ''): void {
    this.toast({ kind: 'success', title, text });
  }

  // ------------------------------------------------------------ customer offers

  private renderOffers(): void {
    clear(this.hud.offers);
    if (this.offerTimer) window.clearInterval(this.offerTimer);
    const offers = [...this.game.store.offers.values()].filter((o) => o.expiresAt > Date.now());
    const o = offers[0];
    if (!o) return;
    const timerFill = h('div', { style: { width: '100%' } });
    const card = h(
      'div',
      { class: 'offer-card', 'data-testid': 'offer-card' },
      h('div', { class: 'row' }, h('span', { class: 'pill gold' }, 'Customer offer'), offers.length > 1 ? h('span', { class: 'pill' }, `+${offers.length - 1} more`) : null),
      h('div', { style: { marginTop: '10px', fontSize: '14px', lineHeight: '1.45' } }, o.message),
      h('div', { class: 'row between', style: { marginTop: '10px' } }, h('div', null, h('div', { class: 'tiny muted' }, 'Offer'), h('div', { class: 'money', style: { fontSize: '22px' } }, formatMoney(o.amount))), h('div', { style: { textAlign: 'right' } }, h('div', { class: 'tiny muted' }, 'Your price'), h('div', { class: 'mono' }, formatMoney(o.askingPrice)))),
      h('div', { class: 'timer' }, timerFill),
      h('div', { class: 'row' }, h('button', { class: 'btn primary grow', onclick: () => void this.respond(o, true) }, 'Accept'), h('button', { class: 'btn danger grow', onclick: () => void this.respond(o, false) }, 'Decline')),
    );
    this.hud.offers.appendChild(card);
    const total = o.expiresAt - Date.now();
    this.offerTimer = window.setInterval(() => {
      const left = o.expiresAt - Date.now();
      timerFill.style.width = `${Math.max(0, (left / total) * 100)}%`;
      if (left <= 0) {
        this.game.store.offers.delete(o.id);
        this.renderOffers();
      }
    }, 200);
  }

  private async respond(o: CustomerOffer, accept: boolean): Promise<void> {
    this.game.store.offers.delete(o.id);
    this.renderOffers();
    try {
      const r = await this.game.net.rpc('offer.respond', { offerId: o.id, accept });
      if (accept && !r.sold) this.toast({ kind: 'warning', title: 'Sale fell through', text: 'The vehicle is no longer available.' });
    } catch (err) {
      this.error(err);
    }
  }

  // ------------------------------------------------------------ panels

  anyOpen(): boolean {
    return this.panel !== null;
  }

  open(name: PanelName, arg: PanelArg = {}): void {
    this.closeAll();
    const panel = createPanel(name, this, arg);
    this.panel = panel;
    this.overlay = h('div', { class: 'overlay', 'data-testid': `panel-${name}` });
    this.overlay.addEventListener('mousedown', (e) => {
      if (e.target === this.overlay && panel.closeOnBackdrop) this.closeAll();
    });
    this.overlay.appendChild(panel.mount());
    this.root.appendChild(this.overlay);
    this.game.input.enabled = false;
    this.game.input.releaseLock();
    this.game.audio.play('click');
    this.lastPromptKey = '';
  }

  closeAll(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
    this.overlay?.remove();
    this.overlay = null;
    if (!this.chat.active) this.game.input.enabled = true;
    this.lastPromptKey = '';
  }

  get current(): Panel | null {
    return this.panel;
  }
}
