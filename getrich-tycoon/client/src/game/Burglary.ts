// Client side of night burglaries (shared/burglary.ts): what the places are up to (security, alarm,
// open door), the prompts at their doors ("Kilitli Kapı - [E] Maymuncuk Kullan" in green at
// night, "come back after 22:00" by day), and inside: taking the loot, cracking the safe, the way
// out; the HUD, the bell, the knock and sensor sounds, the room drawn around you.

import {
  BURGLARY_TARGETS,
  EXIT_REACH,
  KIND_LABEL,
  LOOT_LABELS,
  LOOT_ITEMS,
  LOOT_REACH,
  findTarget,
  layoutOf,
  roomBoxes,
  roomPoint,
  type BurglaryResult,
  type BurglaryState,
  type BurglaryTargetView,
} from '../../../shared/burglary';
import { ECONOMY } from '../../../shared/economy.config';
import { gameHour } from '../../../shared/environment';
import type { AABB } from '../../../shared/world';
import { formatMoney } from '../../../shared/util';
import { InteriorsView } from '../render/Interiors';
import type { Game, Interaction } from './Game';

const B = ECONOMY.burglary;

const TAKE_LABEL = { jewels: 'Mücevherleri Al', watches: 'Saatleri Al', laptop: 'Laptopu Al', electronics: 'Telefon & Tabletleri Al' } as const;

export class BurglaryClient {
  targets: BurglaryTargetView[] = BURGLARY_TARGETS.map((t) => ({ id: t.id, security: 0, alarm: false, open: false, readyAt: 0 }));
  state: BurglaryState | null = null;
  readonly view: InteriorsView;
  private boxCache = new Map<string, AABB[]>();

  constructor(private readonly game: Game) {
    this.view = new InteriorsView(game.renderer.scene);
    this.view.onKnock = (look) => game.audio.play(look === 'vase' || look === 'bottles' || look === 'lamp' ? 'glass' : 'thud');
    this.view.onSensorArm = () => game.audio.play('beep');
    const net = game.net;
    net.on('burglary.targets', (l) => (this.targets = l));
    net.on('burglary.state', (s) => this.onState(s));
    net.on('burglary.result', (r) => this.onResult(r));
    net.on('burglary.cashed', (d) => {
      game.ui?.toast({ kind: d.ok ? 'success' : 'warning', title: d.ok ? 'Ganimet senin!' : 'Ganimet gitti', text: d.text });
      if (d.ok) game.audio.play('coin');
    });
  }

  /** Inside a place: which. */
  get inside(): string | null {
    return this.state?.targetId ?? null;
  }

  private onState(s: BurglaryState | null): void {
    const was = this.state;
    if (s && was?.targetId === s.targetId) {
      // Loot into the bag.
      if (s.taken.length > was.taken.length) this.game.audio.play('grab');
      if (s.alarm && !was.alarm) this.game.audio.play('error');
    }
    if (!!s !== !!was || s?.targetId !== was?.targetId) {
      this.game.audio.play('door');
      this.game.cam.snap();
    }
    this.state = s;
    this.game.ui?.burglary.set(s);
  }

  private onResult(r: BurglaryResult): void {
    const items = Object.entries(r.items).filter(([, n]) => (n ?? 0) > 0) as [keyof typeof LOOT_LABELS, number][];
    const goods = items.map(([id, n]) => `${n}× ${LOOT_LABELS[id].tr}`).join(', ');
    this.game.ui?.toast({ kind: r.clean ? 'success' : 'warning', title: r.clean ? (r.cash || goods ? `Temiz iş! +${formatMoney(r.cash)}` : 'Dışarıdasın') : '🚨 Ganimet sıcak!', text: `${r.text}${goods ? ` (${goods})` : ''}` });
    if (r.clean && (r.cash > 0 || goods)) this.game.audio.play('coin');
  }

  /** Room walls for the camera (inside), or null. */
  roomBoxes(): readonly AABB[] | null {
    const id = this.inside;
    if (!id) return null;
    let b = this.boxCache.get(id);
    if (!b) {
      b = roomBoxes(findTarget(id)!);
      this.boxCache.set(id, b);
    }
    return b;
  }

  /** The ceiling height inside (camera), or null. */
  ceiling(): number | null {
    const id = this.inside;
    return id ? layoutOf(findTarget(id)!).h - 0.35 : null;
  }

  /** Where I am on the map: the place's front door while inside. */
  mapPosition(x: number, z: number): { x: number; z: number } {
    const t = this.inside ? findTarget(this.inside) : undefined;
    return t ? { x: t.door.x, z: t.door.z } : { x, z };
  }

  /** The prompts: at the doors outside, at the loot / safe / way out inside. */
  interactions(x: number, z: number, consider: (d: number, it: Interaction) => void): void {
    const now = this.game.store.serverNow();
    const st = this.state;
    if (st) {
      const t = findTarget(st.targetId)!;
      const l = layoutOf(t);
      if (st.work) {
        const p = Math.max(0, Math.min(1, 1 - (st.work.until - now) / (st.work.sec * 1000)));
        consider(0, { id: `bg-work-${st.work.lootId}`, label: `Alınıyor · %${Math.round(p * 100)}`, sub: 'Kıpırdama', action: () => undefined, tone: 'green' });
        return;
      }
      for (const spot of l.loot) {
        if (st.taken.includes(spot.id)) continue;
        const sp = roomPoint(t, spot.stand.x, spot.stand.z);
        const at = roomPoint(t, spot.x, spot.z);
        const d = Math.min(Math.hypot(sp.x - x, sp.z - z), Math.hypot(at.x - x, at.z - z) - 0.2);
        if (d > LOOT_REACH) continue;
        if (spot.kind === 'safe') {
          if (st.safe.open) continue;
          consider(d, st.alarm ? { id: 'bg-safe', label: 'Kasa kilitlendi', sub: 'Alarm çalıyor: çık!', action: () => this.game.audio.play('error'), tone: 'red' } : { id: 'bg-safe', label: 'Kasayı Kır', sub: `${st.safe.tries} hak · ${formatMoney(t.cash[0])}-${formatMoney(t.cash[1])} · yanlış çevirme gürültü yapar`, action: () => void this.crackSafe(), tone: 'green' });
          continue;
        }
        const kind = spot.kind as keyof typeof LOOT_ITEMS;
        consider(d, { id: `bg-take-${spot.id}`, label: TAKE_LABEL[kind], sub: `${LOOT_LABELS[LOOT_ITEMS[kind]].icon} ${B.takeSec[kind]} sn · Pawn Shop alır`, action: () => void this.take(spot.id), tone: 'green' });
      }
      const door = roomPoint(t, 0, 0);
      const dd = Math.hypot(door.x - x, door.z - z);
      if (dd <= EXIT_REACH) {
        const items = Object.values(st.bag.items).reduce((a, n) => a + (n ?? 0), 0);
        consider(dd + 0.3, { id: 'bg-exit', label: st.alarm ? 'Çık ve Kaç!' : 'Sessizce Çık', sub: `Çanta: ${formatMoney(st.bag.cash)}${items ? ` + ${items} parça mal` : ''}${st.alarm ? ' · sıcak ganimet' : ' · temiz para'}`, action: () => void this.leave(), tone: st.alarm ? 'red' : 'green' });
      }
      return;
    }
    // Outside: the doors.
    for (const t of BURGLARY_TARGETS) {
      const d = Math.hypot(t.stand.x - x, t.stand.z - z);
      if (d > B.pickReach + 0.4) continue;
      const v = this.targets.find((x) => x.id === t.id);
      const kind = KIND_LABEL[t.kind];
      if (v?.alarm) {
        consider(d, { id: `bg-${t.id}`, label: 'Alarm çalıyor!', sub: `${t.name} · polis yolda`, action: () => this.game.audio.play('error'), tone: 'red' });
        continue;
      }
      if (!this.night(now)) {
        consider(d, { id: `bg-${t.id}`, label: 'Kilitli Kapı', sub: `${t.name} · Bu mekan gündüz açık/korumalı, gece 22:00'den sonra tekrar gel`, action: () => this.dayMessage(t.name) });
        continue;
      }
      if (v?.open) {
        consider(d, { id: `bg-${t.id}`, label: 'Kapı açık · İçeri gir', sub: `${t.name} · ekibin içeride`, action: () => void this.enter(t.id), tone: 'green' });
        continue;
      }
      if (v && v.readyAt > now) {
        consider(d, { id: `bg-${t.id}`, label: 'Kapı mühürlü', sub: `${t.name} daha yeni soyuldu · ${Math.ceil((v.readyAt - now) / 60_000)} dk`, action: () => this.game.audio.play('error') });
        continue;
      }
      const picks = this.game.store.lockpicks();
      const sec = v && v.security > 0 ? ` · güvenlik %${Math.round(v.security)}` : '';
      if (picks <= 0) consider(d, { id: `bg-${t.id}`, label: 'Kilitli Kapı - [E] Maymuncuk Kullan', sub: `${t.name} · maymuncuğun yok: Black Market`, action: () => this.game.ui.open('market', { tab: 'black' }), tone: 'green' });
      else consider(d, { id: `bg-${t.id}`, label: 'Kilitli Kapı - [E] Maymuncuk Kullan', sub: `${t.name} · ${kind} · ${picks} maymuncuk${sec}`, action: () => void this.pick(t.id), tone: 'green' });
    }
  }

  /** 22:00-06:00 (the game's own clock, or the hour a test / screenshot pinned). */
  night(now = this.game.store.serverNow()): boolean {
    const h = this.game.forcedHour ?? gameHour(now);
    return h >= B.fromHour || h < B.toHour;
  }

  private dayMessage(name: string): void {
    this.game.audio.play('error');
    this.game.ui?.toast({ kind: 'info', title: name, text: "Bu mekan gündüz açık/korumalı, gece 22:00'den sonra tekrar gel." });
  }

  private async pick(targetId: string): Promise<void> {
    try {
      const r = await this.game.net.rpc('burglary.pick', { targetId });
      this.game.ui.open('lockpick', { ...r });
    } catch (err) {
      this.game.ui.error(err);
    }
  }

  private async enter(targetId: string): Promise<void> {
    try {
      const st = await this.game.net.rpc('burglary.enter', { targetId });
      this.onState(st);
    } catch (err) {
      this.game.ui.error(err);
    }
  }

  private async crackSafe(): Promise<void> {
    try {
      const r = await this.game.net.rpc('burglary.safe', {});
      this.game.ui.open('lockpick', { ...r });
    } catch (err) {
      this.game.ui.error(err);
    }
  }

  private async take(lootId: string): Promise<void> {
    try {
      const st = await this.game.net.rpc('burglary.take', { lootId });
      this.onState(st);
      this.game.audio.play('pick');
    } catch (err) {
      this.game.ui.error(err);
    }
  }

  private async leave(): Promise<void> {
    try {
      await this.game.net.rpc('burglary.leave', {});
    } catch (err) {
      this.game.ui.error(err);
    }
  }

  update(dt: number, x: number, z: number, night: number): void {
    const now = this.game.store.serverNow();
    this.view.update(dt, now, this.inside, this.state, this.targets, night);
    this.game.ui?.burglary.render(Date.now(), now - Date.now());
    // The bell: deafening inside a ringing place, by distance outside.
    const inAlarm = !!this.state?.alarm;
    const dist = this.inside ? Infinity : this.view.nearestAlarm(x, z, this.targets);
    this.game.audio.bell(inAlarm ? 1 : Number.isFinite(dist) ? Math.max(0, 1 - dist / 140) * 0.8 : 0);
  }
}
