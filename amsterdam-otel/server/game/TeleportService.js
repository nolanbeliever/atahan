import { HOUSE_BY_ID, TELEPORTS } from '../../shared/layout.js';
import { TELEPORT_RULES } from '../../shared/counterfeit.js';

const BY_ID = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(TELEPORTS.map((t) => [t.id, t]))));

/**
 * Hızlı ışınlanma (Teleport UI): otel lobisi, kendi evin, yeraltı garajı, drag pisti.
 * Konum sunucuda yazılır (istemci yalnızca hedefi seçer). Araçtayken, yatakta uyurken,
 * gizli bölmede saklanırken ya da kendi evinde polis baskını sürerken ışınlanılmaz; 4 sn bekleme.
 */
export class TeleportService {
  constructor(sim) {
    this.sim = sim;
  }

  go(p, data, now) {
    const t = typeof data?.to === 'string' ? BY_ID[data.to] : undefined;
    if (!t) return { ok: false, error: 'Böyle bir hedef yok.' };
    if (p.vehicle) return { ok: false, error: 'Önce araçtan in.' };
    if (p.sleeping) return { ok: false, error: 'Uyurken ışınlanamazsın.' };
    if (p.hiding) return { ok: false, error: 'Gizli bölmedesin — önce çık.' };
    const own = this.sim.house.houseIdOf(p);
    if (own && this.sim.counterfeit.presses.get(own)?.raid) return { ok: false, error: 'Polis kapında — şimdi kaçamazsın!' };
    if (p.lastTeleport && now - p.lastTeleport < TELEPORT_RULES.COOLDOWN_MS) return { ok: false, error: 'Biraz bekle.' };
    let point = t.point;
    if (t.id === 'home') {
      if (!own) return { ok: false, error: 'Achterstraat\'ta bir evin yok.' };
      point = HOUSE_BY_ID[own].entry;
    }
    p.lastTeleport = now;
    p.x = point[0];
    p.z = point[1];
    p.yaw = t.yaw;
    this.sim.dirtyPlayers.add(p.id);
    return { ok: true, x: p.x, z: p.z, yaw: p.yaw, to: t.id };
  }
}
