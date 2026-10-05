// Client side of gang territories (shared/gangs.ts): who holds the zones (for the maps), the turf war
// I'm in, the gang cars, my zones and protection money, the attack alerts; the prompt at a hangout's
// door ("Mekanı Bas"), the banner sounds.

import { ECONOMY } from '../../../shared/economy.config';
import { GANG_ZONES, findZone, type GangCarView, type GangMine, type GangZoneId, type GangZoneView, type TurfWarView } from '../../../shared/gangs';
import { formatMoney } from '../../../shared/util';
import { GangView } from '../render/GangView';
import type { Game, Interaction } from './Game';

const G = ECONOMY.gangs;

export class GangClient {
  zones: GangZoneView[] = GANG_ZONES.map((z) => ({ id: z.id, owner: null, ownerName: null, dominance: 0, war: false, attackUntil: null }));
  war: TurfWarView | null = null;
  mine: GangMine = { zones: [], cash: 0, mode: 'bank', nextIncomeAt: null };
  alert: { zone: GangZoneId; until: number; text: string } | null = null;
  readonly view: GangView;
  /** The gang cars out right now. */
  cars: GangCarView[] = [];

  constructor(private readonly game: Game) {
    this.view = new GangView(game.renderer.scene);
    const net = game.net;
    net.on('gang.zones', (l) => {
      this.zones = l;
      this.view.setZones(l);
    });
    net.on('gang.cars', (l) => {
      this.cars = l;
      this.view.setCars(l);
    });
    net.on('gang.war', (w) => {
      this.war = w;
      game.ui?.gang.setWar(w);
    });
    net.on('gang.mine', (m) => {
      this.mine = m;
      game.ui?.refreshPanel();
    });
    net.on('gang.alert', (a) => {
      this.alert = a;
      game.ui?.gang.setAttack(a);
      if (a) game.audio.play('error');
    });
    net.on('gang.banner', (b) => {
      game.ui?.gang.showBanner(b.text, b.color);
      game.audio.play(b.kind === 'win' ? 'levelup' : b.kind === 'lost' ? 'wasted' : b.kind === 'wave' ? 'notify' : 'error');
    });
  }

  /** The gang cars (aiming and solid on the client). */
  obstacles() {
    return this.view.obstacles();
  }

  /** E at a hangout's door: raid it. */
  interactions(x: number, z: number, consider: (d: number, it: Interaction) => void): void {
    const me = this.game.store.playerId;
    for (const zone of GANG_ZONES) {
      const d = Math.hypot(zone.venue.door.x - x, zone.venue.door.z - z);
      if (d > G.raidReach) continue;
      const v = this.zones.find((q) => q.id === zone.id);
      if (v?.owner === me) consider(d, { id: `gang-${zone.id}`, label: `${zone.venue.name} · senin mekanın`, sub: `${zone.name} haracı: her 10 dk ${formatMoney(zone.income)}`, action: () => undefined, tone: 'green' });
      else if (v?.war) consider(d, { id: `gang-${zone.id}`, label: 'Bölge savaşı sürüyor!', sub: zone.gang, action: () => undefined, tone: 'red' });
      else consider(d, { id: `gang-${zone.id}`, label: `Mekanı Bas: ${zone.venue.name}`, sub: `${zone.gang} · ${zone.waves} dalga · bölge senin olursa her 10 dk ${formatMoney(zone.income)}`, action: () => void this.raid(zone.id), tone: 'red' });
    }
  }

  private async raid(zoneId: GangZoneId): Promise<void> {
    try {
      const w = await this.game.net.rpc('gang.raid', { zoneId });
      this.war = w;
      this.game.ui?.gang.setWar(w);
    } catch (err) {
      this.game.ui.error(err);
    }
  }

  async setMode(mode: 'bank' | 'cash'): Promise<void> {
    this.mine = await this.game.net.rpc('gang.mode', { mode });
  }

  async collect(): Promise<number> {
    const r = await this.game.net.rpc('gang.collect', {});
    this.mine = r;
    return r.amount;
  }

  zoneName(id: GangZoneId): string {
    return findZone(id)?.name ?? id;
  }

  update(dt: number): void {
    this.view.update(dt, this.game.night);
    this.game.ui?.gang.render(this.game.store.serverNow());
  }
}
