// Chroma Customs tuning garage: performance parts (ECU stages, induction, internals, exhaust,
// chassis), paint finishes with a colour picker, body parts, wheels & stance and a dyno. Every
// change previews live (3D, stats, dyno); the server re-prices and validates on Apply.

import { MOD_CATALOG, MOD_SLOT_LABELS, SPECIAL_NEON, findOption, optionLevel } from '../../../../shared/customization';
import { NEON_SPECIAL_ITEM } from '../../../../shared/rewards';
import { ECONOMY } from '../../../../shared/economy.config';
import { PLATE_MAX, defaultPlate, normalizePlate, plateProblem } from '../../../../shared/plates';
import {
  BODY_SLOTS,
  HEX_COLOR,
  PAINT_FINISHES,
  PAINT_FINISH_DEFS,
  PERF_GROUPS,
  RIM_DESIGNS,
  RIM_FINISHES,
  RIM_FINISH_DEFS,
  SLOT_LABELS,
  findPart,
  partsForSlot,
  type BodySlot,
  type PaintFinish,
  type PerfSlot,
  type RimFinish,
  type TuningPart,
} from '../../../../shared/modificationsData';
import {
  calculateVehicleStats,
  dynoCurve,
  isBike,
  paintPrice,
  partBlocked,
  partPrice,
  quoteTuning,
  resaleMultiplier,
  rimPrice,
  stockStats,
  suspensionLimits,
  tuningOf,
  type TuningChange,
  type TuningQuote,
  type VehicleStats,
} from '../../../../shared/tuningSystem';
import type { Vehicle, VehicleMods } from '../../../../shared/types';
import { formatMoney } from '../../../../shared/util';
import { marketValue } from '../../../../shared/valuation';
import { getModel, type VehicleModel } from '../../../../shared/vehicles';
import { SECURITY, SECURITY_DEFS, SECURITY_ITEMS, armorRepairPrice, type SecurityItem } from '../../../../shared/security';
import { getStudio } from '../../render/Studio';
import type { VehicleLook } from '../../render/VehicleMesh';
import { append, clear, h, type Child } from '../dom';
import { DynoChart } from '../DynoChart';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { vehicleTitle } from '../widgets';

type Tab = 'performance' | 'paint' | 'body' | 'wheels' | 'security' | 'dyno';
type LegacySlot = 'tint' | 'headlights' | 'accessory' | 'underglow';
const LEGACY_SLOTS: LegacySlot[] = ['tint', 'headlights', 'accessory', 'underglow'];
const LEVEL_LABEL = ['', 'Street', 'Sport', 'Race', 'Pro'];

const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;

/** Short summary of what a part does. */
export function effectText(p: TuningPart): string {
  const e = p.effects;
  const out: string[] = [];
  if (p.slot === 'ecu' && e.hp) out.push(`${pct(e.hp)} hp`, `${pct(e.topSpeed ?? 0)} top speed`);
  else {
    if (p.induction) out.push({ single: 'big mid-range', twin: 'strong top end', twinscroll: 'quick spool', bigturbo: 'huge top end, lag', supercharger: 'instant torque' }[p.induction]);
    if (e.hp) out.push(`${pct(e.hp)} hp`);
    if (e.accel) out.push(`${pct(e.accel)} accel`);
    if (e.handling) out.push(`${pct(e.handling)} handling`);
    if (e.braking) out.push(`${pct(e.braking)} braking`);
    if (e.grip) out.push(`${pct(e.grip)} grip`);
    if (e.redline) out.push(`+${e.redline} rpm`);
    if (e.topSpeed && p.slot !== 'induction') out.push(`${pct(e.topSpeed)} top speed`);
    if (e.weight && e.weight < 0) out.push(`${e.weight} kg`);
    if (p.pops && p.slot === 'exhaust') out.push(`pops ${Math.round(p.pops * 100)}%`);
  }
  return out.slice(0, 3).join(' · ');
}

export class TuningGaragePanel extends Panel {
  readonly name = 'custom';
  override size = 'xl' as const;
  private selected: string | null = (this.arg.vehicleId as string | undefined) ?? null;
  private tab: Tab = (this.arg.tab as Tab | undefined) ?? 'performance';
  private change: TuningChange = {};
  private legacy: Partial<Pick<VehicleMods, LegacySlot>> = {};
  private forVehicle = '';
  private readonly studio = getStudio();
  private readonly chart = new DynoChart();
  private statsEl: HTMLElement | null = null;
  private dynoReadout: HTMLElement | null = null;
  private dynoRaf = 0;
  private paintFinish: PaintFinish | null = null;

  title() {
    return 'Chroma Customs - Tuning Garage';
  }
  override subtitle() {
    return 'Performance parts, dyno, paint, body kits, wheels and stance';
  }
  iconSvg() {
    return ICONS.brush;
  }

  override init(): void {
    this.listen(this.store.on('self', () => this.refresh()));
  }

  override dispose(): void {
    this.stopDyno();
    this.studio?.setVehicle(null);
    super.dispose();
  }

  // ------------------------------------------------------------ state

  private eligible(): Vehicle[] {
    return this.store.myVehicles().filter((v) => (v.status === 'stored' || v.status === 'world' || v.status === 'displayed') && this.game.driving !== v.id);
  }

  private current(): Vehicle | undefined {
    const list = this.eligible();
    const v = list.find((x) => x.id === this.selected) ?? list[0];
    if (v) this.selected = v.id;
    return v;
  }

  private quote(v: Vehicle): TuningQuote {
    return quoteTuning(getModel(v.modelId), tuningOf(v.mods), this.change);
  }

  private legacyCost(v: Vehicle): number {
    let cost = 0;
    for (const s of LEGACY_SLOTS) if (this.legacy[s] && this.legacy[s] !== (v.mods[s] ?? 'ug_none')) cost += findOption(this.legacy[s])?.price ?? 0;
    return cost;
  }

  /** The vehicle as it will look after Apply. */
  private previewMods(v: Vehicle, q: TuningQuote): VehicleMods {
    const bodyTouched = !!this.change.body && Object.values(this.change.body).some((id) => id !== null);
    return {
      ...v.mods,
      ...this.legacy,
      tuning: q.next,
      paint: this.change.paint ? null : v.mods.paint,
      wheels: this.change.rim ? MOD_CATALOG.wheels[0]!.id : v.mods.wheels,
      bodyKit: bodyTouched ? MOD_CATALOG.bodyKit[0]!.id : v.mods.bodyKit,
    };
  }

  private look(v: Vehicle, q: TuningQuote): VehicleLook {
    const mods = this.previewMods(v, q);
    // The plate being typed shows on the preview.
    if (this.plateDraft !== null) {
      const text = normalizePlate(this.plateDraft);
      if (!text) delete mods.plate;
      else if (!plateProblem(text)) mods.plate = text;
    }
    return { id: v.id, modelId: v.modelId, color: v.color, condition: v.condition, mods };
  }

  /** Custom plate text being typed (null: not touched). */
  private plateDraft: string | null = null;

  /** Number plate: type your own text and press it ($2,500), or put the car's registration back. */
  private plateSection(v: Vehicle): Child {
    const current = v.mods.plate ?? null;
    const draft = this.plateDraft ?? current ?? '';
    const input = h('input', { class: 'input mono plate-input', maxlength: String(PLATE_MAX + 3), placeholder: defaultPlate(v.id), value: draft, 'data-testid': 'plate-input' });
    const note = h('div', { class: 'tiny muted' });
    const btn = h('button', { class: 'btn primary small', 'data-testid': 'plate-apply', onclick: () => void this.applyPlate(v, input.value) }, `Plakayı bas (${formatMoney(ECONOMY.plates.price)})`);
    const check = () => {
      const text = normalizePlate(input.value);
      const problem = text ? plateProblem(text) : null;
      note.textContent = problem ?? (text ? `Plaka: ${text}` : `Kendi plakası: ${defaultPlate(v.id)}`);
      note.classList.toggle('red', !!problem);
      (btn as HTMLButtonElement).disabled = this.busy || !text || !!problem || text === current;
    };
    input.addEventListener('input', () => {
      this.plateDraft = input.value;
      check();
      this.live();
    });
    check();
    return h(
      'div',
      { class: 'gslot' },
      h('div', { class: 'gslot-head' }, 'Plaka · Number plate'),
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, input, btn, current ? h('button', { class: 'btn small ghost', 'data-testid': 'plate-reset', onclick: () => void this.applyPlate(v, '') }, 'Orijinal plaka') : null),
      note,
    );
  }

  private async applyPlate(v: Vehicle, text: string): Promise<void> {
    await this.act(
      () => this.net.rpc('vehicle.plate', { vehicleId: v.id, text }),
      (r) => {
        this.plateDraft = null;
        this.game.audio.play('purchase');
        this.ui.toast({ kind: 'success', title: r.plate ? `Yeni plaka: ${r.plate}` : 'Orijinal plaka takıldı', text: 'Plaka arabanın önünde ve arkasında.' });
      },
    );
  }

  private changes(v: Vehicle, q: TuningQuote): number {
    return q.lines.length + LEGACY_SLOTS.filter((s) => this.legacy[s] && this.legacy[s] !== (v.mods[s] ?? 'ug_none')).length;
  }

  private reset(): void {
    this.change = {};
    this.legacy = {};
    this.paintFinish = null;
    this.plateDraft = null;
  }

  private setPerf(model: VehicleModel, v: Vehicle, slot: PerfSlot, id: string | null): void {
    const installed = tuningOf(v.mods).perf[slot] ?? null;
    const perf = { ...(this.change.perf ?? {}) };
    if (id === installed) delete perf[slot];
    else perf[slot] = id;
    // Selecting a part pulls in its missing prerequisites (the first option of each).
    const part = findPart(id);
    const added: string[] = [];
    for (const req of part?.requires ?? []) {
      const have = slot === req.slot ? id : perf[req.slot] !== undefined ? perf[req.slot] : tuningOf(v.mods).perf[req.slot];
      if (have && req.any.includes(have)) continue;
      const pick = req.any.map((x) => findPart(x)).find((p) => p && !partBlocked(model, p));
      if (pick) {
        perf[req.slot] = pick.id;
        added.push(pick.name);
      }
    }
    this.change = { ...this.change, perf };
    if (added.length) this.ui.toast({ kind: 'info', title: 'Required parts added', text: added.join(', ') });
  }

  private setBody(v: Vehicle, slot: BodySlot, id: string | null): void {
    const installed = tuningOf(v.mods).body[slot] ?? null;
    const body = { ...(this.change.body ?? {}) };
    if (id === installed) delete body[slot];
    else body[slot] = id;
    this.change = { ...this.change, body };
  }

  /** Update preview, stats and foot without rebuilding the body (keeps slider/picker focus). */
  private live(): void {
    const v = this.current();
    if (!v) return;
    const q = this.quote(v);
    this.studio?.setVehicle(this.look(v, q));
    if (this.statsEl) {
      clear(this.statsEl);
      append(this.statsEl, [this.statsCard(v, q)]);
    }
    this.refreshFoot();
  }

  private refreshFoot(): void {
    clear(this.footEl);
    append(this.footEl, [this.renderFoot()]);
  }

  // ------------------------------------------------------------ render

  renderBody(): Child {
    const v = this.current();
    if (!v) {
      this.studio?.setVehicle(null);
      return h('div', { class: 'empty' }, 'No vehicles available for tuning. Vehicles on sale, at auction or being driven cannot be worked on.');
    }
    if (this.forVehicle !== v.id) {
      this.forVehicle = v.id;
      this.reset();
      if (this.studio) this.studio.autoRotate = true;
    }
    const model = getModel(v.modelId);
    const q = this.quote(v);
    this.studio?.setVehicle(this.look(v, q));
    const here = this.game.nearKind('custom');
    const inService = v.serviceUntil > Date.now();

    const picker = h(
      'select',
      {
        class: 'input',
        'data-testid': 'garage-vehicle',
        onchange: (e: Event) => {
          const el = e.target as HTMLSelectElement;
          this.selected = el.value;
          el.blur();
          this.refresh();
        },
      },
      this.eligible().map((x) => h('option', { value: x.id, selected: x.id === v.id }, `${vehicleTitle(x).name}${x.mods.tuning && Object.keys(x.mods.tuning.perf).length ? ' (tuned)' : ''}`)),
    );
    const view = h('div', { class: 'garage-view' }, this.studio ? this.studio.canvas : h('div', { class: 'empty' }, '3D preview unavailable'), h('div', { class: 'garage-hint tiny' }, 'Drag to rotate'));
    this.studio?.start();
    const tabs = h(
      'div',
      { class: 'subtabs garage-tabs' },
      (
        [
          ['performance', 'Performance'],
          ['paint', 'Paint'],
          ['body', 'Body Kit'],
          ['wheels', 'Wheels & Stance'],
          ['security', '🛡️ Güvenlik'],
          ['dyno', 'Dyno'],
        ] as const
      ).map(([id, label]) =>
        h('button', { class: this.tab === id ? 'active' : '', 'data-testid': `garage-tab-${id}`, onclick: () => ((this.tab = id), this.stopDyno(), this.refresh()) }, label),
      ),
    );
    let content: Child;
    switch (this.tab) {
      case 'performance':
        content = this.performanceTab(model, v);
        break;
      case 'paint':
        content = this.paintTab(model, v);
        break;
      case 'body':
        content = this.bodyTab(model, v);
        break;
      case 'wheels':
        content = this.wheelsTab(model, v, q);
        break;
      case 'security':
        content = this.securityTab(model, v);
        break;
      case 'dyno':
        content = this.dynoTab(model, q);
        break;
    }
    // The x-ray of the security gear on its tab.
    this.studio?.vehicle?.setXray(this.tab === 'security');
    this.statsEl = h('div', { class: 'garage-stats', 'data-testid': 'garage-stats' }, this.statsCard(v, q));
    return [
      here ? null : h('div', { class: 'pill gold', style: { alignSelf: 'flex-start', marginBottom: '10px' } }, 'Browsing remotely: drive or walk to Chroma Customs to install parts.'),
      inService ? h('div', { class: 'pill gold', style: { marginBottom: '10px' } }, 'This vehicle is in the workshop right now.') : null,
      h('div', { class: 'row garage-top' }, h('div', { class: 'grow' }, picker), h('div', { class: 'tiny muted' }, `${model.specs.hp} hp stock · ${model.specs.aspiration.replace('_', ' ')} · ${model.specs.drive.toUpperCase()}`)),
      h('div', { class: 'garage' }, h('div', { class: 'garage-main' }, view, tabs, h('div', { class: 'garage-content' }, content)), this.statsEl),
    ];
  }

  private stat(label: string, now: number, next: number, unit: string, better: 'up' | 'down', max: number, digits = 0, testid?: string): HTMLElement {
    const fmt = (x: number) => (digits ? x.toFixed(digits) : Math.round(x).toLocaleString('en-US'));
    const diff = next - now;
    const good = better === 'up' ? diff > 0 : diff < 0;
    const width = Math.max(3, Math.min(100, ((better === 'up' ? next : max - next) / max) * 100));
    return h(
      'div',
      { class: 'gstat', 'data-testid': testid },
      h('div', { class: 'row between' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, `${fmt(next)} ${unit}`, Math.abs(diff) > (digits ? 0.05 : 0.5) ? h('span', { class: good ? 'up' : 'down' }, ` ${diff > 0 ? '+' : ''}${fmt(diff)}`) : null)),
      h('div', { class: 'gbar' }, h('div', { style: { width: `${width}%` } })),
    );
  }

  private statsCard(v: Vehicle, q: TuningQuote): Child {
    const model = getModel(v.modelId);
    const now = calculateVehicleStats(model, tuningOf(v.mods));
    const next = calculateVehicleStats(model, q.next);
    const valueNow = marketValue(v, this.store.trends);
    const valueNext = marketValue({ ...v, mods: this.previewMods(v, q) }, this.store.trends);
    const mult = resaleMultiplier(model, q.next);
    const stock = stockStats(model);
    return [
      h('div', { class: 'section-title', style: { marginTop: '0' } }, 'Performance'),
      this.stat('Power', now.hp, next.hp, 'hp', 'up', Math.max(1200, stock.hp * 2.1), 0, 'stat-hp'),
      this.stat('Torque', now.torque, next.torque, 'Nm', 'up', Math.max(1500, stock.torque * 2.2), 0, 'stat-torque'),
      this.stat('0-100 km/h', now.accel, next.accel, 's', 'down', 14, 1, 'stat-accel'),
      this.stat('Top speed', now.topSpeed, next.topSpeed, 'km/h', 'up', 480, 0, 'stat-top'),
      this.stat('Handling', now.handling, next.handling, '/100', 'up', 100),
      this.stat('Braking 100-0', now.braking, next.braking, 'm', 'down', 50, 1),
      this.stat('Launch grip', now.grip, next.grip, '%', 'up', 100),
      h(
        'div',
        { class: 'tiny muted', style: { marginTop: '6px', lineHeight: '1.5' } },
        `${next.weight} kg · ${next.powerToWeight} hp/t · redline ${next.redline.toLocaleString('en-US')} rpm`,
        h('br'),
        `Heat soak: ${Math.round(next.heatSoak * 100)}% power after 3 pulls`,
        next.stress > 1.25 ? h('div', { class: 'pill red', style: { marginTop: '6px', whiteSpace: 'normal', display: 'block', lineHeight: '1.35' } }, `Engine stress x${next.stress.toFixed(2)}: wears faster (fit forged internals)`) : null,
      ),
      h('div', { class: 'section-title' }, 'Resale value'),
      h(
        'div',
        { class: 'gvalue', 'data-testid': 'garage-value' },
        h('div', { class: 'money' }, formatMoney(valueNext)),
        valueNext !== valueNow ? h('div', { class: 'tiny muted' }, `now ${formatMoney(valueNow)}`) : null,
        h('div', { class: 'tiny' }, `Tuning multiplier x${mult.toFixed(2)} (max x2.00)`),
      ),
    ];
  }

  private sameStats(a: VehicleStats, b: VehicleStats): boolean {
    return a.hp === b.hp && a.torque === b.torque && a.redline === b.redline;
  }

  // ------------------------------------------------------------ tabs

  private optionButton(opts: { active: boolean; installed: boolean; disabled?: string | null; title: string; sub?: string; price: number | null; level?: number; testid: string; onclick: () => void; swatch?: string }): HTMLElement {
    return h(
      'button',
      {
        class: `gopt${opts.active ? ' active' : ''}${opts.installed ? ' current' : ''}`,
        'data-testid': opts.testid,
        disabled: !!opts.disabled,
        title: opts.disabled ?? opts.sub ?? '',
        onclick: opts.onclick,
      },
      opts.swatch ? h('span', { class: 'sw', style: { background: opts.swatch } }) : null,
      h(
        'div',
        { class: 'gopt-main' },
        h('div', { class: 'gopt-title' }, opts.level ? h('span', { class: `lvl l${opts.level}` }, LEVEL_LABEL[opts.level]) : null, opts.title),
        opts.disabled ? h('div', { class: 'gopt-sub warn' }, opts.disabled) : opts.sub ? h('div', { class: 'gopt-sub' }, opts.sub) : null,
      ),
      h('div', { class: 'gopt-price' }, opts.installed ? 'Installed' : opts.price === null ? '' : opts.price === 0 ? 'Free' : formatMoney(opts.price)),
    );
  }

  private performanceTab(model: VehicleModel, v: Vehicle): Child {
    const installed = tuningOf(v.mods);
    const chosen = (slot: PerfSlot) => (this.change.perf && slot in this.change.perf ? this.change.perf[slot] ?? null : installed.perf[slot] ?? null);
    return PERF_GROUPS.map((g) =>
      h(
        'div',
        { class: 'gslot-group' },
        h('div', { class: 'section-title' }, g.title),
        g.slots.map((slot) => {
          const parts = partsForSlot(slot);
          const blockedAll = parts.every((p) => partBlocked(model, p));
          const pick = chosen(slot);
          return h(
            'div',
            { class: 'gslot' },
            h('div', { class: 'gslot-head' }, SLOT_LABELS[slot], blockedAll ? h('span', { class: 'tiny muted' }, ` - ${partBlocked(model, parts[0]!)}`) : null),
            blockedAll
              ? null
              : h(
                  'div',
                  { class: 'gopt-grid' },
                  this.optionButton({
                    active: pick === null,
                    installed: !installed.perf[slot],
                    title: 'Stock',
                    sub: slot === 'ecu' ? 'Factory software' : 'Factory part',
                    price: 0,
                    testid: `part-${slot}-stock`,
                    onclick: () => (this.setPerf(model, v, slot, null), this.refresh()),
                  }),
                  parts.map((p) =>
                    this.optionButton({
                      active: pick === p.id,
                      installed: installed.perf[slot] === p.id,
                      disabled: partBlocked(model, p),
                      title: p.name,
                      sub: `${effectText(p)}${p.requires ? ` · needs ${p.requires.map((r) => r.label).join(', ')}` : ''}`,
                      price: partPrice(model, p),
                      level: p.level,
                      testid: `part-${p.id}`,
                      onclick: () => (this.setPerf(model, v, slot, p.id), this.refresh()),
                    }),
                  ),
                ),
          );
        }),
      ),
    );
  }

  private paintTab(model: VehicleModel, v: Vehicle): Child {
    const installed = tuningOf(v.mods).paint;
    const pending = this.change.paint;
    const shown = pending !== undefined ? pending : installed;
    const finish = this.paintFinish ?? shown?.finish ?? 'gloss';
    const def = PAINT_FINISH_DEFS[finish];
    const setPaint = (color: string, color2?: string) => {
      const p = { finish, color, ...(finish === 'chameleon' ? { color2: color2 ?? shown?.color2 ?? color } : {}) };
      const same = installed && installed.finish === p.finish && installed.color === p.color && (installed.color2 ?? '') === (p.color2 ?? '');
      if (same) {
        const { paint: _drop, ...rest } = this.change;
        this.change = rest;
      } else this.change = { ...this.change, paint: p };
    };
    const current = shown?.color ?? (v.mods.paint ? findOption(v.mods.paint)?.value : null) ?? v.color;
    const hexIn = h('input', { class: 'input mono', value: current, maxlength: '7', 'data-testid': 'paint-hex', style: { width: '110px' } });
    const colorIn = h('input', { type: 'color', value: current, class: 'color-pick', 'data-testid': 'paint-picker' });
    const onColor = (hex: string, source: 'hex' | 'picker') => {
      if (!HEX_COLOR.test(hex)) {
        hexIn.classList.add('bad');
        return;
      }
      hexIn.classList.remove('bad');
      if (source === 'picker') hexIn.value = hex;
      else colorIn.value = hex;
      setPaint(hex.toLowerCase());
      this.live();
    };
    colorIn.addEventListener('input', () => onColor(colorIn.value, 'picker'));
    hexIn.addEventListener('input', () => onColor(hexIn.value.trim().startsWith('#') ? hexIn.value.trim() : `#${hexIn.value.trim()}`, 'hex'));
    let flip: Child = null;
    if (finish === 'chameleon') {
      const c2 = shown?.color2 ?? '#1f9e89';
      const colorIn2 = h('input', { type: 'color', value: c2, class: 'color-pick', 'data-testid': 'paint-picker2' });
      colorIn2.addEventListener('input', () => {
        setPaint(this.change.paint?.color ?? current, colorIn2.value.toLowerCase());
        this.live();
      });
      flip = h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, h('span', { class: 'small muted' }, 'Flip colour'), colorIn2);
    }
    return [
      h('div', { class: 'section-title' }, 'Finish'),
      h(
        'div',
        { class: 'gopt-grid' },
        this.optionButton({
          active: shown === null && (this.change.paint === null || !installed),
          installed: !installed,
          title: 'Factory colour',
          sub: 'Original paint',
          price: installed ? paintPrice(model, 'gloss') : 0,
          testid: 'paint-factory',
          swatch: v.color,
          onclick: () => {
            this.paintFinish = null;
            if (installed) this.change = { ...this.change, paint: null };
            else {
              const { paint: _drop, ...rest } = this.change;
              this.change = rest;
            }
            this.refresh();
          },
        }),
        PAINT_FINISHES.map((f) =>
          this.optionButton({
            active: finish === f && shown !== null,
            installed: installed?.finish === f,
            title: PAINT_FINISH_DEFS[f].name,
            sub: PAINT_FINISH_DEFS[f].description,
            price: paintPrice(model, f),
            testid: `paint-finish-${f}`,
            onclick: () => {
              this.paintFinish = f;
              const sw = PAINT_FINISH_DEFS[f].palette[0]!;
              setPaint(shown && shown.finish === f ? shown.color : sw.color, sw.color2);
              this.refresh();
            },
          }),
        ),
      ),
      h('div', { class: 'section-title' }, `${def.name} colours`),
      h(
        'div',
        { class: 'swatches' },
        def.palette.map((p) =>
          h('button', {
            class: `swatch-btn${shown?.color === p.color ? ' active' : ''}`,
            title: p.name,
            'data-testid': `paint-swatch-${p.color}`,
            style: { background: p.color2 ? `linear-gradient(135deg, ${p.color} 45%, ${p.color2} 55%)` : p.color },
            onclick: () => {
              this.paintFinish = finish;
              setPaint(p.color, p.color2);
              this.refresh();
            },
          }),
        ),
      ),
      h('div', { class: 'section-title' }, 'Custom colour (HEX)'),
      h('div', { class: 'row wrap', style: { gap: '10px', alignItems: 'center' } }, colorIn, hexIn, flip),
      h('div', { class: 'tiny muted', style: { marginTop: '8px' } }, `Paint jobs add ${Math.round(def.value * 100)}% to resale value.`),
    ];
  }

  private bodyTab(model: VehicleModel, v: Vehicle): Child {
    const installed = tuningOf(v.mods);
    const chosen = (slot: BodySlot) => (this.change.body && slot in this.change.body ? this.change.body[slot] ?? null : installed.body[slot] ?? null);
    const bike = isBike(model);
    return [
      bike
        ? h('div', { class: 'empty' }, 'Motorcycles have no body kit options.')
        : BODY_SLOTS.map((slot) =>
            h(
              'div',
              { class: 'gslot' },
              h('div', { class: 'gslot-head' }, SLOT_LABELS[slot]),
              h(
                'div',
                { class: 'gopt-grid' },
                this.optionButton({ active: chosen(slot) === null, installed: !installed.body[slot], title: 'Stock', price: 0, testid: `body-${slot}-stock`, onclick: () => (this.setBody(v, slot, null), this.refresh()) }),
                partsForSlot(slot).map((p) =>
                  this.optionButton({
                    active: chosen(slot) === p.id,
                    installed: installed.body[slot] === p.id,
                    disabled: partBlocked(model, p),
                    title: p.name,
                    sub: effectText(p) || p.description,
                    price: partPrice(model, p),
                    level: p.level,
                    testid: `part-${p.id}`,
                    onclick: () => (this.setBody(v, slot, p.id), this.refresh()),
                  }),
                ),
              ),
            ),
          ),
      h('div', { class: 'section-title' }, 'Glass, lights & neon'),
      LEGACY_SLOTS.map((slot) =>
        h(
          'div',
          { class: 'gslot' },
          h('div', { class: 'gslot-head' }, MOD_SLOT_LABELS[slot]),
          h(
            'div',
            { class: 'gopt-grid' },
            MOD_CATALOG[slot].map((o) => {
              const current = v.mods[slot] ?? 'ug_none';
              const need = optionLevel(o.id);
              const locked = need > (this.ui.game.store.me?.level ?? 1);
              // Plazma Neon is the 2-hour playtime reward: open once the player has earned it.
              const reward = o.id === SPECIAL_NEON && (this.ui.game.store.me?.inventory[NEON_SPECIAL_ITEM] ?? 0) < 1 && current !== o.id;
              return this.optionButton({
                active: (this.legacy[slot] ?? current) === o.id,
                installed: current === o.id,
                disabled: locked ? `🔒 Unlocks at level ${need}` : reward ? '🎁 2 saatlik oynama ödülü' : null,
                title: o.label,
                price: o.price,
                testid: `mod-${slot}-${o.id}`,
                swatch:
                  slot === 'headlights' || (slot === 'underglow' && o.value.startsWith('#'))
                    ? o.value
                    : slot === 'underglow' && o.value === 'rainbow'
                      ? 'linear-gradient(90deg,#ff2a2a,#ffd23f,#39ff88,#2b7bff,#ff2bd6)'
                      : slot === 'underglow' && o.value === 'plasma'
                        ? 'linear-gradient(90deg,#7a3cff,#22e1ff,#7a3cff)'
                        : undefined,
                onclick: () => {
                  if (o.id === current) delete this.legacy[slot];
                  else this.legacy[slot] = o.id;
                  this.refresh();
                },
              });
            }),
          ),
        ),
      ),
      this.plateSection(v),
    ];
  }

  private wheelsTab(model: VehicleModel, v: Vehicle, q: TuningQuote): Child {
    if (isBike(model)) return h('div', { class: 'empty' }, 'Motorcycles keep their spoked wheels and have no stance settings.');
    const installed = tuningOf(v.mods);
    const rim = this.change.rim !== undefined ? this.change.rim : installed.rim;
    const finish: RimFinish = rim?.finish ?? 'silver';
    const lim = suspensionLimits(q.next);
    const slider = (label: string, key: 'camber' | 'drop', max: number, fmt: (x: number) => string) => {
      const value = q.next[key];
      const out = h('span', { class: 'mono' }, fmt(value));
      const input = h('input', { type: 'range', min: '0', max: String(max), step: '0.5', value: String(value), disabled: max <= 0, 'data-testid': `stance-${key}` });
      input.addEventListener('input', () => {
        const n = Number(input.value);
        this.change = { ...this.change, [key]: n };
        if (n === installed[key] && (key === 'camber' ? this.change.drop ?? installed.drop : this.change.camber ?? installed.camber) === installed[key === 'camber' ? 'drop' : 'camber']) {
          const { camber: _c, drop: _d, ...rest } = this.change;
          this.change = rest;
        }
        out.textContent = fmt(n);
        this.live();
      });
      input.addEventListener('change', () => input.blur());
      return h('div', { class: 'gslider' }, h('div', { class: 'row between' }, h('span', null, label), out), input, h('div', { class: 'tiny muted' }, max > 0 ? `0 - ${fmt(max)} with your suspension` : 'Install sport springs or coilovers to adjust'));
    };
    return [
      h('div', { class: 'section-title' }, 'Wheels'),
      h(
        'div',
        { class: 'gopt-grid' },
        this.optionButton({
          active: !rim,
          installed: !installed.rim,
          title: 'Factory wheels',
          price: 0,
          testid: 'rim-stock',
          onclick: () => {
            if (installed.rim) this.change = { ...this.change, rim: null };
            else {
              const { rim: _r, ...rest } = this.change;
              this.change = rest;
            }
            this.refresh();
          },
        }),
        RIM_DESIGNS.map((r) =>
          this.optionButton({
            active: rim?.design === r.id,
            installed: installed.rim?.design === r.id,
            title: r.name,
            price: rimPrice(model, r.id),
            testid: `rim-${r.id}`,
            onclick: () => {
              const next = { design: r.id, finish };
              if (installed.rim && installed.rim.design === next.design && installed.rim.finish === next.finish) {
                const { rim: _r, ...rest } = this.change;
                this.change = rest;
              } else this.change = { ...this.change, rim: next };
              this.refresh();
            },
          }),
        ),
      ),
      h('div', { class: 'section-title' }, 'Wheel finish'),
      h(
        'div',
        { class: 'swatches' },
        RIM_FINISHES.map((f) =>
          h(
            'button',
            {
              class: `swatch-btn labeled${rim?.finish === f ? ' active' : ''}`,
              disabled: !rim,
              title: RIM_FINISH_DEFS[f].name,
              'data-testid': `rim-finish-${f}`,
              style: { background: RIM_FINISH_DEFS[f].color },
              onclick: () => {
                if (!rim) return;
                this.change = { ...this.change, rim: { design: rim.design, finish: f } };
                if (installed.rim && installed.rim.design === rim.design && installed.rim.finish === f) {
                  const { rim: _r, ...rest } = this.change;
                  this.change = rest;
                }
                this.refresh();
              },
            },
          ),
        ),
      ),
      h('div', { class: 'section-title' }, 'Stance'),
      slider('Camber', 'camber', lim.maxCamber, (x) => `-${x.toFixed(1)}°`),
      slider('Suspension drop', 'drop', lim.maxDrop, (x) => `${x.toFixed(1)} cm`),
      h('div', { class: 'tiny muted', style: { marginTop: '6px' } }, 'A little camber and drop sharpen handling; extreme stance costs grip and braking.'),
    ];
  }

  /** Security gear: the hidden compartment, run-flat tyres, level-3 armour (bought on the spot). */
  private securityTab(model: VehicleModel, v: Vehicle): Child {
    const here = this.game.nearKind('custom');
    const money = this.store.me?.money ?? 0;
    const bike = model.specs.kind === 'bike';
    const armor = v.mods.armor ? this.game.combat.carArmor.get(v.id) ?? 100 : null;
    const card = (item: SecurityItem): HTMLElement => {
      const def = SECURITY_DEFS[item];
      const fitted = !!v.mods[item];
      const repair = item === 'armor' && fitted && armor !== null && armor < 100 ? armorRepairPrice(armor) : 0;
      const price = fitted ? repair : def.price;
      const blocked = !here ? 'Chroma Customs\'ta' : def.carsOnly && bike ? 'Motosiklete olmaz' : money < price ? 'Para yetmiyor' : null;
      let status: string;
      if (item === 'stash' && fitted) status = `Takılı ✓ · zulada ${v.mods.stashGrams ?? 0} / ${SECURITY.stashCapacity} gr · araçta Z`;
      else if (item === 'armor' && fitted) status = `Takılı ✓ · zırh %${Math.ceil(armor ?? 100)}`;
      else status = fitted ? 'Takılı ✓' : 'Takılı değil';
      const buy = () =>
        void this.act(
          () => this.net.rpc('security.buy', { vehicleId: v.id, item }),
          () => {
            this.ui.toast({ kind: 'success', title: repair ? '🛡️ Zırh onarıldı' : `${def.icon} ${def.name} takıldı`, text: item === 'stash' ? 'Araçtayken Z: üzerindeki malı zulaya sakla.' : item === 'armor' ? 'Kurşun geçirmez: sürerken sağ altta ZIRH %.' : 'Çivili şerit ve kurşunlar artık lastikleri patlatamaz.' });
            this.studio?.pop(0.6);
          },
        );
      const btn =
        fitted && !repair
          ? h('button', { class: 'btn small', disabled: true }, 'Takılı')
          : h('button', { class: 'btn small primary', 'data-testid': `security-${item}`, disabled: this.busy || !!blocked, title: blocked ?? '', onclick: buy }, repair ? `Zırhı Onar · ${formatMoney(repair)}` : `Tak · ${formatMoney(def.price)}`);
      return h(
        'div',
        { class: `sec-card ${fitted ? 'fitted' : ''}`, 'data-testid': `sec-card-${item}` },
        h('div', { class: 'sec-icon' }, def.icon),
        h('div', { class: 'sec-body' }, h('div', { class: 'sec-name' }, def.name), h('div', { class: 'tiny muted' }, def.text), h('div', { class: `tiny sec-status ${fitted ? 'on' : ''}` }, status)),
        h('div', { class: 'sec-buy' }, btn, blocked && !(fitted && !repair) ? h('div', { class: 'tiny muted' }, blocked) : null),
      );
    };
    return h(
      'div',
      { class: 'sec-tab' },
      h('div', { class: 'tiny muted', style: { marginBottom: '8px' } }, 'Önizlemede röntgen: mavi zırh (cam ve kapılar), turuncu gizli zula (bagaj tabanı), sarı patlamaz lastik halkaları. Hemen takılır; Apply gerekmez.'),
      SECURITY_ITEMS.map(card),
    );
  }

  private dynoTab(model: VehicleModel, q: TuningQuote): Child {
    const stock = stockStats(model);
    const next = calculateVehicleStats(model, q.next);
    this.chart.stock = dynoCurve(stock);
    this.chart.build = this.sameStats(stock, next) ? null : dynoCurve(next);
    const main = this.chart.build ?? this.chart.stock;
    this.dynoReadout = h('div', { class: 'dyno-live mono', 'data-testid': 'dyno-readout' }, '0 rpm · 0 hp · 0 Nm');
    const wrap = h('div', { class: 'dyno-wrap' }, this.chart.el);
    requestAnimationFrame(() => this.chart.draw());
    const soak = [1, (1 + next.heatSoak) / 2, next.heatSoak].map((x) => `${Math.round(x * 100)}%`).join(' → ');
    return [
      h(
        'div',
        { class: 'row wrap dyno-peaks' },
        h('div', { class: 'dpeak hp' }, h('div', { class: 'tiny' }, 'Peak power'), h('div', { class: 'big', 'data-testid': 'dyno-peak-hp' }, `${main.peakHp} hp`), h('div', { class: 'tiny muted' }, `@ ${main.peakHpRpm.toLocaleString('en-US')} rpm`)),
        h('div', { class: 'dpeak nm' }, h('div', { class: 'tiny' }, 'Peak torque'), h('div', { class: 'big' }, `${main.peakTorque} Nm`), h('div', { class: 'tiny muted' }, `@ ${main.peakTorqueRpm.toLocaleString('en-US')} rpm`)),
        h('div', { class: 'dpeak' }, h('div', { class: 'tiny' }, 'Stock'), h('div', { class: 'big muted' }, `${stock.hp} hp`), h('div', { class: 'tiny muted' }, `${stock.torque} Nm`)),
      ),
      wrap,
      h(
        'div',
        { class: 'row between wrap', style: { gap: '10px', marginTop: '10px' } },
        this.dynoReadout,
        h('button', { class: 'btn primary', 'data-testid': 'dyno-run', onclick: () => this.runDyno(model, next) }, this.dynoRaf ? 'Running...' : 'Run dyno pull'),
      ),
      h('div', { class: 'tiny muted', style: { marginTop: '8px' } }, `Back-to-back pulls: ${soak}. Launch wheelspin ${next.wheelspin}%. ${this.chart.build ? 'Dashed lines: stock.' : 'Pick parts to see the gains.'}`),
    ];
  }

  private runDyno(model: VehicleModel, stats: VehicleStats): void {
    if (this.dynoRaf) return;
    const curve = this.chart.build ?? this.chart.stock!;
    const audio = this.game.audio;
    audio.unlock();
    const prevPop = audio.onPop;
    audio.onPop = (s) => this.studio?.pop(s);
    if (this.studio) {
      this.studio.autoRotate = false;
      this.studio.yaw = 1.2;
      this.studio.setDynoRollers(true, -model.shape.length * 0.29);
    }
    const start = performance.now();
    const pull = 4.2;
    const tick = (t: number) => {
      // The first frame's timestamp can be a hair before `start`.
      const s = Math.max(0, (t - start) / 1000);
      let rpm: number;
      let throttle = true;
      if (s < pull) rpm = curve.idle + (curve.redline - curve.idle) * Math.pow(s / pull, 1.4);
      else {
        throttle = false;
        rpm = curve.redline - (curve.redline - curve.idle) * Math.min(1, (s - pull) / 1.4);
      }
      this.chart.cursor = rpm;
      this.chart.draw();
      const v = this.chart.sample(rpm);
      if (this.dynoReadout) this.dynoReadout.textContent = `${Math.round(rpm).toLocaleString('en-US')} rpm · ${Math.round(throttle ? v.hp : 0)} hp · ${Math.round(throttle ? v.torque : 0)} Nm`;
      audio.setDyno({ rpm, throttle, profile: stats.sound, redline: curve.redline });
      audio.engine({ driving: false, speed: 0, topSpeed: 1, throttle, profile: stats.sound, redline: curve.redline, dt: 1 / 60 });
      if (this.studio) this.studio.dynoSpeed = (rpm / curve.redline) * 45;
      if (s < pull + 1.6 && this.el()) this.dynoRaf = requestAnimationFrame(tick);
      else {
        this.stopDyno();
        audio.onPop = prevPop;
      }
    };
    this.dynoRaf = requestAnimationFrame(tick);
    this.refreshFoot();
  }

  private el(): boolean {
    return this.chart.el.isConnected;
  }

  private stopDyno(): void {
    if (this.dynoRaf) cancelAnimationFrame(this.dynoRaf);
    this.dynoRaf = 0;
    this.game.audio.setDyno(null);
    this.chart.cursor = null;
    if (this.studio) {
      this.studio.dynoSpeed = 0;
      this.studio.setDynoRollers(false);
    }
  }

  override renderFoot(): Child {
    const v = this.current();
    if (!v) return null;
    const q = this.quote(v);
    const n = this.changes(v, q);
    const total = q.total + this.legacyCost(v);
    const here = this.game.nearKind('custom');
    const issue = q.issues[0];
    return [
      h(
        'div',
        { class: 'grow small' },
        issue
          ? h('span', { class: 'warn-text', 'data-testid': 'garage-issue' }, issue)
          : n
            ? h('span', { class: 'muted' }, `${n} change(s) · workshop time ${Math.ceil(Math.max(q.seconds, 3))}s`)
            : h('span', { class: 'muted' }, 'Pick parts, paint or wheels to build your car'),
      ),
      h('button', { class: 'btn ghost', disabled: n === 0, onclick: () => (this.reset(), this.refresh()) }, 'Reset'),
      h(
        'button',
        {
          class: 'btn primary',
          'data-testid': 'garage-apply',
          disabled: this.busy || n === 0 || !!issue || !here,
          title: here ? '' : 'Visit Chroma Customs to install',
          onclick: () =>
            void this.act(
              () => this.net.rpc('tuning.apply', { vehicleId: v.id, change: this.change, legacy: this.legacy }),
              (r) => {
                this.reset();
                this.ui.success('Build started', `Paid ${formatMoney(r.cost)}. Ready in ${Math.ceil(r.seconds)}s.`);
              },
            ),
        },
        `Install - ${formatMoney(total)}`,
      ),
    ];
  }
}
