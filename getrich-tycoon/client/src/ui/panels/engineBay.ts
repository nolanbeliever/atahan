// The engine bay of a stolen car up on a Sanayi lift: a drawing of the bay with a hotspot on every
// engine part (engine block, gearbox, turbo, ECU, radiator, alternator, battery). Click a part to
// take it off; the work takes a few seconds (timed by the server) and the part goes into the
// inventory as a stripped part for the Pawn Shop.

import { partLabelTr, partsFor, pawnPrice, removedParts, STRIP_PARTS, valueTier, type StripPart } from '../../../../shared/theft';
import { formatMoney } from '../../../../shared/util';
import { getModel, modelDisplayName } from '../../../../shared/vehicles';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';

/** Hotspot positions on the drawing (%; the front of the car is at the top). */
const SPOTS: Partial<Record<StripPart, { x: number; y: number }>> = {
  radiator: { x: 50, y: 11 },
  alternator: { x: 31, y: 31 },
  battery: { x: 13, y: 44 },
  turbo: { x: 70, y: 33 },
  ecu: { x: 87, y: 44 },
  engine: { x: 50, y: 52 },
  gearbox: { x: 50, y: 80 },
};

const BAY_SVG = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="eb-floor" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#1d2026"/><stop offset="1" stop-color="#0d0f13"/></linearGradient>
  </defs>
  <rect x="0" y="0" width="100" height="100" fill="url(#eb-floor)"/>
  <path d="M6 4 Q50 -2 94 4 L97 96 L3 96 Z" fill="none" stroke="#3a3f48" stroke-width="1.2"/>
  <rect x="22" y="6" width="56" height="9" rx="1.5" fill="#2a2d31" stroke="#454a52" stroke-width="0.5"/>
  <path d="M26 7 v7 M30 7 v7 M34 7 v7 M38 7 v7 M42 7 v7 M46 7 v7 M50 7 v7 M54 7 v7 M58 7 v7 M62 7 v7 M66 7 v7 M70 7 v7 M74 7 v7" stroke="#3b3f45" stroke-width="0.5"/>
  <rect x="34" y="38" width="32" height="28" rx="3" fill="#3b3f45" stroke="#5a6068" stroke-width="0.6"/>
  <rect x="37" y="40" width="26" height="6" rx="1.5" fill="#b7bdc4"/>
  <path d="M40 66 L44 92 L56 92 L60 66 Z" fill="#8e959d" stroke="#5a6068" stroke-width="0.6"/>
  <circle cx="70" cy="33" r="6" fill="#3b3f45" stroke="#6e5d4c" stroke-width="1.2"/>
  <path d="M70 39 Q72 60 66 96" fill="none" stroke="#6e5d4c" stroke-width="2.2"/>
  <circle cx="31" cy="31" r="4" fill="#b7bdc4"/>
  <rect x="6" y="38" width="14" height="12" rx="1.5" fill="#141518" stroke="#3a3f48" stroke-width="0.6"/>
  <rect x="81" y="40" width="12" height="8" rx="1" fill="#b7bdc4"/>
  <path d="M20 44 Q28 46 34 48 M81 44 Q74 46 66 48" fill="none" stroke="#c0392b" stroke-width="0.6"/>
</svg>`;

/** The static drawing (our own markup, no player text). */
function bayDrawing(): HTMLElement {
  const el = h('div', { class: 'eb-bg' });
  el.innerHTML = BAY_SVG;
  return el;
}

export class EngineBayPanel extends Panel {
  readonly name = 'engineBay';
  override size = 'medium' as const;
  private readonly vehicleId = String(this.arg.vehicleId ?? '');
  private timer = 0;
  private fills = new Map<StripPart, HTMLElement>();
  private lastJob: string | null = null;

  title() {
    return 'Motor Bölmesi · Engine bay';
  }
  override subtitle() {
    const v = this.store.myVehicle(this.vehicleId);
    return v ? `${modelDisplayName(v.modelId)} - click a part to take it out` : 'The car is gone';
  }
  iconSvg() {
    return ICONS.wrench;
  }

  override init(): void {
    this.game.theft.onStripped = () => this.refresh();
    this.game.working = true;
    // Progress of the part being taken out.
    this.timer = window.setInterval(() => {
      const job = this.game.theft.job;
      if ((job?.part ?? null) !== this.lastJob) {
        this.lastJob = job?.part ?? null;
        this.refresh();
      }
      for (const [part, fill] of this.fills) {
        const k = job && job.part === part ? Math.min(1, (this.store.serverNow() - job.startAt) / Math.max(1, job.readyAt - job.startAt)) : 0;
        fill.style.setProperty('--k', String(k));
      }
    }, 60);
  }

  renderBody(): Child {
    const v = this.store.myVehicle(this.vehicleId);
    if (!v || !v.mods.strip) return h('div', { class: 'empty' }, 'This car is not on a lift any more.');
    const model = getModel(v.modelId);
    const has = new Set(partsFor(model));
    const off = new Set(removedParts(v.mods));
    const job = this.game.theft.job;
    const tier = valueTier(model);
    this.fills.clear();
    const engineParts = STRIP_PARTS.filter((p) => p.group === 'engine' && has.has(p.id));
    const spots = engineParts.map((p) => {
      const at = SPOTS[p.id]!;
      const done = off.has(p.id);
      const working = job?.part === p.id;
      const fill = h('span', { class: 'eb-ring' });
      this.fills.set(p.id, fill);
      return h(
        'button',
        {
          class: `eb-spot${done ? ' done' : ''}${working ? ' working' : ''}`,
          style: { left: `${at.x}%`, top: `${at.y}%` },
          disabled: done || !!job || this.busy,
          title: `${p.label} - ${p.seconds}s`,
          'data-testid': 'eb-spot',
          'data-part': p.id,
          onclick: () => void this.take(p.id),
        },
        fill,
        h('span', { class: 'eb-dot' }, done ? '✓' : ''),
        h('span', { class: 'eb-name' }, partLabelTr(p.id, model)),
      );
    });
    const left = engineParts.filter((p) => !off.has(p.id));
    return h(
      'div',
      { class: 'col' },
      h('div', { class: 'eb-diagram', 'data-testid': 'engine-bay' }, bayDrawing(), spots),
      h(
        'table',
        { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Motor parçası'), h('th', null, 'Work'), h('th', null, 'Pawn Shop'), h('th', null, ''))),
        h(
          'tbody',
          null,
          engineParts.map((p) =>
            h(
              'tr',
              null,
              h('td', null, h('div', { style: { fontWeight: '700' } }, partLabelTr(p.id, model)), h('div', { class: 'tiny muted' }, p.label)),
              h('td', { class: 'mono' }, `${p.seconds}s`),
              h('td', { class: 'mono' }, `${formatMoney(pawnPrice(p.id, tier, 0))}-${formatMoney(pawnPrice(p.id, tier, 1))}`),
              h(
                'td',
                null,
                off.has(p.id)
                  ? h('span', { class: 'pill green' }, 'Söküldü')
                  : h('button', { class: 'btn small primary', disabled: !!job || this.busy, 'data-testid': 'eb-take', 'data-part': p.id, onclick: () => void this.take(p.id) }, job?.part === p.id ? 'Sökülüyor...' : 'Sök'),
              ),
            ),
          ),
        ),
      ),
      left.length === 0 ? h('div', { class: 'pill green', style: { alignSelf: 'flex-start' } }, 'The engine bay is empty.') : null,
    );
  }

  override renderFoot(): Child {
    return h('button', { class: 'btn ghost', onclick: () => this.ui.closeAll() }, 'Close');
  }

  /** Every change of the player's state re-draws the bay (a part came off). */
  override onStoreChange(): void {
    if (!this.game.theft.job) this.refresh();
  }

  private async take(part: StripPart): Promise<void> {
    if (this.game.theft.job) return;
    const ok = await this.game.theft.startStrip(this.vehicleId, part);
    this.refresh();
    if (!ok) return;
    this.game.audio.play('ratchet');
  }

  override dispose(): void {
    window.clearInterval(this.timer);
    if (this.game.theft.onStripped) this.game.theft.onStripped = null;
    this.game.working = false;
    super.dispose();
  }
}
