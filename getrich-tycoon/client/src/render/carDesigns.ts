// Visual design of every vehicle model: the side profile, plan shape, greenhouse and details
// that the procedural body builder (carBody.ts) turns into a car. Each design follows a familiar
// real-world body type (city hatch, family sedan, off-roader, pickup, panel van, rear-engine sports
// coupe, mid-engine supercar, luxury saloon, grand tourer, 60s cruiser, 50s roadster) with its own
// proportions and details. The Rare Dealer exclusives at the end follow specific real cars.
// No logos or badges are drawn.
//
// Conventions: `u` is a position along the car from -0.5 (rear tip) to +0.5 (front tip).
// Heights (`...Y`) are metres above the ground. Widths are fractions of the half width.

import type { BodyStyle, VehicleShape } from '../../../shared/vehicles';
import { getModel } from '../../../shared/vehicles';

export type LampStyle = 'round' | 'twin' | 'slim' | 'square' | 'bar' | 'vertical' | 'oval';
export type GrilleStyle = 'none' | 'wide' | 'tall' | 'mesh' | 'chrome' | 'oval' | 'kidney' | 'panamericana' | 'singleframe' | 'star';
export type RimStyle = 'five' | 'multi' | 'aero' | 'hubcap' | 'wire' | 'steel' | 'mesh' | 'sixspoke' | 'turbofan' | 'deepdish';

export interface Lamp {
  style: LampStyle;
  /** Centre of the lamp across the car, as a fraction of the half width. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CarDesign {
  // Plan view
  /** Fraction of the length over which the nose / tail narrows. */
  noseRound: number;
  tailRound: number;
  /** Half width at the very tips, as a fraction of the half width. */
  noseWidth: number;
  tailWidth: number;
  /** Extra half width over the wheels (fender bulge), metres. */
  hips: number;
  /** Superellipse exponent of the body cross-section: ~3.5 round, ~8 boxy. */
  section: number;

  // Side profile of the lower body
  sillY: number;
  bumperY: number;
  noseY: number;
  hoodY: number;
  beltY: number;
  deckY: number;
  tailY: number;
  /** How quickly the hood drops towards the nose (higher = flatter hood, rounder nose). */
  hoodCurve: number;

  // Greenhouse
  cowl: number;
  roofFront: number;
  roofBack: number;
  cBase: number;
  roofY: number;
  roofArc: number;
  /** Roof half width relative to the window-line half width. */
  tumble: number;
  /** 'fast' gives a curved fastback rear window. */
  rear: 'straight' | 'fast';
  pillars: 'body' | 'black';
  roof: 'body' | 'black' | 'contrast';
  /** Van: everything behind this u is a windowless cargo box. */
  cargoFrom?: number;
  /** Open bed (pickup) or cockpit (roadster) between two u positions. */
  open?: { from: number; to: number; floorY: number; kind: 'bed' | 'cockpit' };

  // Running gear
  frontAxle: number;
  rearAxle: number;
  wheelR: number;
  wheelW: number;
  archGap: number;
  rim: RimStyle;
  rimScale: number;
  whitewalls?: boolean;

  // Details
  head: Lamp;
  /** Second pair of head lamps (split headlights). */
  head2?: Lamp;
  tail: Lamp;
  grille: { style: GrilleStyle; y: number; w: number; h: number };
  /** Lower air intake in the bumper. */
  intake?: { y: number; w: number; h: number };
  bumpers: 'body' | 'black' | 'chrome';
  cladding?: boolean;
  doors: 2 | 4 | 'van';
  chromeTrim?: boolean;
  fins?: boolean;
  spare?: boolean;
  roofRails?: boolean;
  sideIntake?: boolean;
  exhaust: 'none' | 'single' | 'dual' | 'quad' | 'center';
}

const d = (x: CarDesign): CarDesign => x;

export const DESIGNS: Record<string, CarDesign> = {
  // Retro two-door city hatch: short round nose, big round lamps, contrasting roof.
  norda_pixi: d({
    noseRound: 0.15, tailRound: 0.1, noseWidth: 0.8, tailWidth: 0.86, hips: 0.03, section: 4.2,
    sillY: 0.25, bumperY: 0.3, noseY: 0.72, hoodY: 0.88, beltY: 0.93, deckY: 0.9, tailY: 0.84, hoodCurve: 1.8,
    cowl: 0.29, roofFront: 0.12, roofBack: -0.39, cBase: -0.46, roofY: 1.46, roofArc: 0.03, tumble: 0.82, rear: 'straight',
    pillars: 'black', roof: 'contrast',
    frontAxle: 0.33, rearAxle: -0.34, wheelR: 0.29, wheelW: 0.19, archGap: 0.05, rim: 'five', rimScale: 0.62,
    head: { style: 'round', x: 0.6, y: 0.66, w: 0.19, h: 0.19 },
    tail: { style: 'vertical', x: 0.8, y: 0.7, w: 0.09, h: 0.2 },
    grille: { style: 'oval', y: 0.5, w: 0.5, h: 0.12 },
    bumpers: 'body', doors: 2, exhaust: 'single',
  }),
  // Modern electric hatch: closed nose, full-width light bars, black floating roof, aero wheels.
  voltara_luma: d({
    noseRound: 0.14, tailRound: 0.08, noseWidth: 0.82, tailWidth: 0.88, hips: 0.02, section: 4.6,
    sillY: 0.24, bumperY: 0.28, noseY: 0.64, hoodY: 0.84, beltY: 0.92, deckY: 0.94, tailY: 0.88, hoodCurve: 1.8,
    cowl: 0.24, roofFront: 0.05, roofBack: -0.39, cBase: -0.47, roofY: 1.5, roofArc: 0.02, tumble: 0.8, rear: 'straight',
    pillars: 'black', roof: 'black',
    frontAxle: 0.31, rearAxle: -0.32, wheelR: 0.31, wheelW: 0.2, archGap: 0.05, rim: 'aero', rimScale: 0.7,
    head: { style: 'bar', x: 0, y: 0.7, w: 0.9, h: 0.045 },
    tail: { style: 'bar', x: 0, y: 0.8, w: 0.9, h: 0.05 },
    grille: { style: 'none', y: 0.46, w: 0.45, h: 0.08 },
    bumpers: 'body', doors: 4, exhaust: 'none',
  }),
  // Everyday compact saloon: three-box shape, slim swept lamps, wide grille.
  norda_arlo: d({
    noseRound: 0.12, tailRound: 0.09, noseWidth: 0.84, tailWidth: 0.88, hips: 0.02, section: 4.8,
    sillY: 0.24, bumperY: 0.29, noseY: 0.66, hoodY: 0.86, beltY: 0.95, deckY: 0.94, tailY: 0.9, hoodCurve: 2,
    cowl: 0.19, roofFront: 0.03, roofBack: -0.19, cBase: -0.32, roofY: 1.44, roofArc: 0.03, tumble: 0.8, rear: 'fast',
    pillars: 'body', roof: 'body',
    frontAxle: 0.3, rearAxle: -0.28, wheelR: 0.31, wheelW: 0.21, archGap: 0.05, rim: 'five', rimScale: 0.64,
    head: { style: 'slim', x: 0.64, y: 0.64, w: 0.34, h: 0.08 },
    tail: { style: 'slim', x: 0.66, y: 0.76, w: 0.34, h: 0.08 },
    grille: { style: 'wide', y: 0.56, w: 0.5, h: 0.12 },
    intake: { y: 0.38, w: 0.55, h: 0.08 },
    bumpers: 'body', doors: 4, exhaust: 'single',
  }),
  // Sporty executive saloon: long hood, short deck, chrome window line, twin exhausts.
  velora_serene: d({
    noseRound: 0.12, tailRound: 0.08, noseWidth: 0.84, tailWidth: 0.88, hips: 0.03, section: 5,
    sillY: 0.23, bumperY: 0.26, noseY: 0.64, hoodY: 0.84, beltY: 0.94, deckY: 0.95, tailY: 0.92, hoodCurve: 2.2,
    cowl: 0.13, roofFront: -0.03, roofBack: -0.22, cBase: -0.34, roofY: 1.42, roofArc: 0.03, tumble: 0.78, rear: 'fast',
    pillars: 'body', roof: 'body', chromeTrim: true,
    frontAxle: 0.33, rearAxle: -0.28, wheelR: 0.33, wheelW: 0.23, archGap: 0.05, rim: 'multi', rimScale: 0.68,
    head: { style: 'slim', x: 0.66, y: 0.62, w: 0.36, h: 0.07 },
    tail: { style: 'slim', x: 0.66, y: 0.8, w: 0.38, h: 0.07 },
    grille: { style: 'tall', y: 0.56, w: 0.34, h: 0.14 },
    intake: { y: 0.36, w: 0.7, h: 0.08 },
    bumpers: 'body', doors: 4, exhaust: 'dual',
  }),
  // Rugged off-roader: upright and boxy, black cladding, roof rails, spare wheel on the tailgate.
  granforge_ridgeback: d({
    noseRound: 0.07, tailRound: 0.04, noseWidth: 0.9, tailWidth: 0.94, hips: 0.03, section: 7,
    sillY: 0.44, bumperY: 0.48, noseY: 0.98, hoodY: 1.08, beltY: 1.14, deckY: 1.14, tailY: 1.12, hoodCurve: 3,
    cowl: 0.22, roofFront: 0.08, roofBack: -0.45, cBase: -0.48, roofY: 1.8, roofArc: 0.015, tumble: 0.88, rear: 'straight',
    pillars: 'black', roof: 'body', roofRails: true, spare: true,
    frontAxle: 0.31, rearAxle: -0.3, wheelR: 0.39, wheelW: 0.26, archGap: 0.06, rim: 'steel', rimScale: 0.58,
    head: { style: 'square', x: 0.66, y: 0.88, w: 0.26, h: 0.13 },
    tail: { style: 'vertical', x: 0.84, y: 0.92, w: 0.1, h: 0.3 },
    grille: { style: 'wide', y: 0.86, w: 0.62, h: 0.18 },
    bumpers: 'black', cladding: true, doors: 4, exhaust: 'single',
  }),
  // Luxury SUV: tall flat sides, clamshell hood, floating black roof, slim lamps.
  solenne_marquee: d({
    noseRound: 0.07, tailRound: 0.05, noseWidth: 0.9, tailWidth: 0.92, hips: 0.01, section: 7.5,
    sillY: 0.42, bumperY: 0.46, noseY: 1.0, hoodY: 1.1, beltY: 1.17, deckY: 1.17, tailY: 1.14, hoodCurve: 3.2,
    cowl: 0.2, roofFront: 0.06, roofBack: -0.44, cBase: -0.48, roofY: 1.84, roofArc: 0.01, tumble: 0.9, rear: 'straight',
    pillars: 'black', roof: 'black', chromeTrim: true,
    frontAxle: 0.32, rearAxle: -0.3, wheelR: 0.41, wheelW: 0.27, archGap: 0.05, rim: 'multi', rimScale: 0.7,
    head: { style: 'slim', x: 0.68, y: 0.92, w: 0.34, h: 0.07 },
    tail: { style: 'slim', x: 0.7, y: 1.02, w: 0.32, h: 0.07 },
    grille: { style: 'mesh', y: 0.9, w: 0.46, h: 0.14 },
    intake: { y: 0.64, w: 0.6, h: 0.1 },
    bumpers: 'body', doors: 4, exhaust: 'dual',
  }),
  // Full-size crew-cab pickup: tall square nose, big chrome grille, long bed.
  granforge_hauler: d({
    noseRound: 0.05, tailRound: 0.02, noseWidth: 0.92, tailWidth: 0.97, hips: 0.02, section: 7.5,
    sillY: 0.52, bumperY: 0.54, noseY: 1.14, hoodY: 1.28, beltY: 1.34, deckY: 1.3, tailY: 1.3, hoodCurve: 3,
    cowl: 0.2, roofFront: 0.1, roofBack: -0.19, cBase: -0.2, roofY: 1.95, roofArc: 0.01, tumble: 0.88, rear: 'straight',
    pillars: 'body', roof: 'body', open: { from: -0.5, to: -0.2, floorY: 0.98, kind: 'bed' },
    frontAxle: 0.33, rearAxle: -0.28, wheelR: 0.43, wheelW: 0.29, archGap: 0.07, rim: 'five', rimScale: 0.62,
    head: { style: 'square', x: 0.7, y: 1.0, w: 0.3, h: 0.16 },
    tail: { style: 'vertical', x: 0.9, y: 1.08, w: 0.1, h: 0.3 },
    grille: { style: 'chrome', y: 0.94, w: 0.66, h: 0.3 },
    bumpers: 'chrome', cladding: true, doors: 4, exhaust: 'single',
  }),
  // Compact single-cab work pickup.
  granforge_packmule: d({
    noseRound: 0.07, tailRound: 0.02, noseWidth: 0.9, tailWidth: 0.97, hips: 0.02, section: 6.5,
    sillY: 0.4, bumperY: 0.44, noseY: 0.9, hoodY: 1.02, beltY: 1.08, deckY: 1.05, tailY: 1.05, hoodCurve: 2.6,
    cowl: 0.2, roofFront: 0.08, roofBack: -0.07, cBase: -0.08, roofY: 1.68, roofArc: 0.015, tumble: 0.87, rear: 'straight',
    pillars: 'body', roof: 'body', open: { from: -0.5, to: -0.08, floorY: 0.78, kind: 'bed' },
    frontAxle: 0.32, rearAxle: -0.27, wheelR: 0.34, wheelW: 0.22, archGap: 0.06, rim: 'steel', rimScale: 0.6,
    head: { style: 'square', x: 0.68, y: 0.8, w: 0.26, h: 0.12 },
    tail: { style: 'vertical', x: 0.9, y: 0.86, w: 0.09, h: 0.24 },
    grille: { style: 'wide', y: 0.78, w: 0.56, h: 0.16 },
    bumpers: 'black', doors: 2, exhaust: 'single',
  }),
  // Panel van: short sloping nose, huge windscreen, windowless cargo box, sliding side door.
  norda_workmate: d({
    noseRound: 0.06, tailRound: 0.02, noseWidth: 0.88, tailWidth: 0.97, hips: 0.01, section: 8,
    sillY: 0.38, bumperY: 0.4, noseY: 0.86, hoodY: 1.02, beltY: 1.12, deckY: 1.12, tailY: 1.12, hoodCurve: 2,
    cowl: 0.34, roofFront: 0.21, roofBack: -0.495, cBase: -0.5, roofY: 2.2, roofArc: 0.02, tumble: 0.92, rear: 'straight',
    pillars: 'black', roof: 'body', cargoFrom: 0.12,
    frontAxle: 0.33, rearAxle: -0.32, wheelR: 0.34, wheelW: 0.23, archGap: 0.05, rim: 'steel', rimScale: 0.6,
    head: { style: 'square', x: 0.7, y: 0.76, w: 0.24, h: 0.14 },
    tail: { style: 'vertical', x: 0.9, y: 0.8, w: 0.1, h: 0.34 },
    grille: { style: 'wide', y: 0.7, w: 0.5, h: 0.14 },
    bumpers: 'black', doors: 'van', exhaust: 'single',
  }),
  // Rear-engined sports coupe: round upright lamps on the fenders, wide hips, sloping fastback.
  apexon_strix: d({
    noseRound: 0.17, tailRound: 0.12, noseWidth: 0.72, tailWidth: 0.82, hips: 0.07, section: 4,
    sillY: 0.17, bumperY: 0.2, noseY: 0.56, hoodY: 0.84, beltY: 0.87, deckY: 0.86, tailY: 0.8, hoodCurve: 1.8,
    cowl: 0.15, roofFront: 0.05, roofBack: -0.17, cBase: -0.45, roofY: 1.28, roofArc: 0.03, tumble: 0.74, rear: 'fast',
    pillars: 'body', roof: 'body',
    frontAxle: 0.27, rearAxle: -0.3, wheelR: 0.34, wheelW: 0.27, archGap: 0.04, rim: 'five', rimScale: 0.74,
    head: { style: 'oval', x: 0.68, y: 0.66, w: 0.2, h: 0.16 },
    tail: { style: 'bar', x: 0, y: 0.72, w: 0.86, h: 0.045 },
    grille: { style: 'none', y: 0.4, w: 0.3, h: 0.06 },
    intake: { y: 0.34, w: 0.8, h: 0.09 },
    bumpers: 'body', doors: 2, exhaust: 'center',
  }),
  // Mid-engined supercar: wedge nose, cab-forward canopy, side air intakes, quad exhausts.
  apexon_vanta: d({
    noseRound: 0.2, tailRound: 0.08, noseWidth: 0.66, tailWidth: 0.9, hips: 0.06, section: 3.8,
    sillY: 0.14, bumperY: 0.15, noseY: 0.42, hoodY: 0.8, beltY: 0.84, deckY: 0.9, tailY: 0.88, hoodCurve: 1.6,
    cowl: 0.2, roofFront: 0.04, roofBack: -0.1, cBase: -0.37, roofY: 1.16, roofArc: 0.02, tumble: 0.66, rear: 'fast',
    pillars: 'black', roof: 'body', sideIntake: true,
    frontAxle: 0.28, rearAxle: -0.28, wheelR: 0.35, wheelW: 0.3, archGap: 0.03, rim: 'multi', rimScale: 0.76,
    head: { style: 'slim', x: 0.66, y: 0.5, w: 0.34, h: 0.06 },
    tail: { style: 'slim', x: 0.64, y: 0.76, w: 0.36, h: 0.05 },
    grille: { style: 'mesh', y: 0.28, w: 0.7, h: 0.1 },
    bumpers: 'body', doors: 2, exhaust: 'quad',
  }),
  // Flagship luxury saloon: long and elegant, upright chrome grille, chrome window line.
  velora_aurelian: d({
    noseRound: 0.11, tailRound: 0.08, noseWidth: 0.85, tailWidth: 0.88, hips: 0.02, section: 5,
    sillY: 0.25, bumperY: 0.27, noseY: 0.7, hoodY: 0.9, beltY: 0.99, deckY: 1.0, tailY: 0.96, hoodCurve: 2.4,
    cowl: 0.14, roofFront: -0.01, roofBack: -0.22, cBase: -0.35, roofY: 1.48, roofArc: 0.03, tumble: 0.8, rear: 'fast',
    pillars: 'body', roof: 'body', chromeTrim: true,
    frontAxle: 0.32, rearAxle: -0.28, wheelR: 0.35, wheelW: 0.25, archGap: 0.05, rim: 'multi', rimScale: 0.7,
    head: { style: 'slim', x: 0.66, y: 0.68, w: 0.36, h: 0.08 },
    tail: { style: 'slim', x: 0.68, y: 0.84, w: 0.36, h: 0.07 },
    grille: { style: 'tall', y: 0.6, w: 0.34, h: 0.2 },
    intake: { y: 0.4, w: 0.6, h: 0.06 },
    bumpers: 'body', doors: 4, exhaust: 'dual',
  }),
  // Hand-built grand tourer: very long hood, quad round lamps, big chrome mesh grille, fastback.
  solenne_monarch: d({
    noseRound: 0.12, tailRound: 0.1, noseWidth: 0.8, tailWidth: 0.84, hips: 0.05, section: 4.5,
    sillY: 0.21, bumperY: 0.23, noseY: 0.68, hoodY: 0.9, beltY: 0.94, deckY: 0.94, tailY: 0.9, hoodCurve: 2.6,
    cowl: 0.07, roofFront: -0.08, roofBack: -0.18, cBase: -0.4, roofY: 1.38, roofArc: 0.03, tumble: 0.74, rear: 'fast',
    pillars: 'body', roof: 'body', chromeTrim: true,
    frontAxle: 0.32, rearAxle: -0.28, wheelR: 0.37, wheelW: 0.28, archGap: 0.04, rim: 'multi', rimScale: 0.74,
    head: { style: 'twin', x: 0.66, y: 0.62, w: 0.14, h: 0.14 },
    tail: { style: 'oval', x: 0.7, y: 0.78, w: 0.2, h: 0.1 },
    grille: { style: 'chrome', y: 0.5, w: 0.4, h: 0.24 },
    bumpers: 'body', doors: 2, exhaust: 'dual',
  }),
  // Early-60s American cruiser: long flat deck, tail fins, quad lamps, chrome everywhere, whitewalls.
  harlan_bellwether: d({
    noseRound: 0.04, tailRound: 0.04, noseWidth: 0.93, tailWidth: 0.93, hips: 0, section: 6,
    sillY: 0.29, bumperY: 0.32, noseY: 0.8, hoodY: 0.88, beltY: 0.92, deckY: 0.9, tailY: 0.88, hoodCurve: 3,
    cowl: 0.18, roofFront: 0.08, roofBack: -0.14, cBase: -0.22, roofY: 1.4, roofArc: 0.02, tumble: 0.86, rear: 'straight',
    pillars: 'body', roof: 'contrast', chromeTrim: true, fins: true,
    frontAxle: 0.31, rearAxle: -0.24, wheelR: 0.35, wheelW: 0.22, archGap: 0.05, rim: 'hubcap', rimScale: 0.62, whitewalls: true,
    head: { style: 'twin', x: 0.66, y: 0.66, w: 0.13, h: 0.13 },
    tail: { style: 'round', x: 0.6, y: 0.66, w: 0.1, h: 0.1 },
    grille: { style: 'chrome', y: 0.6, w: 0.9, h: 0.16 },
    bumpers: 'chrome', doors: 2, exhaust: 'dual',
  }),
  // Late-50s roadster: endless rounded hood, covered round lamps, open cockpit, wire wheels.
  harlan_duchess: d({
    noseRound: 0.22, tailRound: 0.14, noseWidth: 0.6, tailWidth: 0.76, hips: 0.06, section: 3.6,
    sillY: 0.22, bumperY: 0.26, noseY: 0.56, hoodY: 0.86, beltY: 0.86, deckY: 0.86, tailY: 0.74, hoodCurve: 1.3,
    cowl: 0.06, roofFront: 0.06, roofBack: -0.2, cBase: -0.2, roofY: 0.84, roofArc: 0, tumble: 0.8, rear: 'straight',
    pillars: 'body', roof: 'body', chromeTrim: true, open: { from: -0.2, to: 0.05, floorY: 0.5, kind: 'cockpit' },
    frontAxle: 0.24, rearAxle: -0.33, wheelR: 0.36, wheelW: 0.2, archGap: 0.04, rim: 'wire', rimScale: 0.7,
    head: { style: 'round', x: 0.62, y: 0.62, w: 0.17, h: 0.17 },
    tail: { style: 'round', x: 0.66, y: 0.64, w: 0.08, h: 0.08 },
    grille: { style: 'oval', y: 0.42, w: 0.36, h: 0.12 },
    bumpers: 'chrome', doors: 2, exhaust: 'dual',
  }),

  // ---------------------------------------------------------------- Rare Dealer exclusives
  // Modelled after the real cars (proportions, grille and lamp graphics), without badges.

  // BMW i7 (G70): long flagship saloon, split headlights, huge kidney grille, flush electric tail.
  bmw_i7_g70: d({
    noseRound: 0.1, tailRound: 0.08, noseWidth: 0.87, tailWidth: 0.88, hips: 0.02, section: 5.2,
    sillY: 0.26, bumperY: 0.28, noseY: 0.78, hoodY: 0.96, beltY: 1.03, deckY: 1.03, tailY: 0.99, hoodCurve: 2.9,
    cowl: 0.15, roofFront: 0.0, roofBack: -0.25, cBase: -0.36, roofY: 1.55, roofArc: 0.03, tumble: 0.82, rear: 'fast',
    pillars: 'body', roof: 'body', chromeTrim: true,
    frontAxle: 0.34, rearAxle: -0.27, wheelR: 0.37, wheelW: 0.26, archGap: 0.05, rim: 'multi', rimScale: 0.72,
    head: { style: 'slim', x: 0.72, y: 0.84, w: 0.28, h: 0.04 },
    head2: { style: 'square', x: 0.72, y: 0.66, w: 0.16, h: 0.06 },
    tail: { style: 'slim', x: 0.7, y: 0.9, w: 0.34, h: 0.06 },
    grille: { style: 'kidney', y: 0.66, w: 0.34, h: 0.26 },
    intake: { y: 0.42, w: 0.66, h: 0.06 },
    bumpers: 'body', doors: 4, exhaust: 'none',
  }),
  // BMW M3 Competition (G80): tall vertical kidneys, wide arches, carbon roof, quad pipes.
  bmw_m3_g80: d({
    noseRound: 0.12, tailRound: 0.08, noseWidth: 0.84, tailWidth: 0.88, hips: 0.06, section: 4.8,
    sillY: 0.21, bumperY: 0.23, noseY: 0.62, hoodY: 0.84, beltY: 0.93, deckY: 0.94, tailY: 0.9, hoodCurve: 2.2,
    cowl: 0.15, roofFront: -0.02, roofBack: -0.22, cBase: -0.34, roofY: 1.4, roofArc: 0.03, tumble: 0.78, rear: 'fast',
    pillars: 'black', roof: 'black',
    frontAxle: 0.32, rearAxle: -0.29, wheelR: 0.35, wheelW: 0.29, archGap: 0.04, rim: 'five', rimScale: 0.76,
    head: { style: 'slim', x: 0.68, y: 0.68, w: 0.3, h: 0.07 },
    tail: { style: 'slim', x: 0.66, y: 0.82, w: 0.36, h: 0.07 },
    grille: { style: 'kidney', y: 0.5, w: 0.24, h: 0.34 },
    intake: { y: 0.33, w: 0.84, h: 0.1 },
    bumpers: 'body', doors: 4, exhaust: 'quad',
  }),
  // BMW X7 M60i: big upright SUV, split lamps, giant kidneys, roof rails.
  bmw_x7_facelift: d({
    noseRound: 0.07, tailRound: 0.05, noseWidth: 0.9, tailWidth: 0.93, hips: 0.02, section: 7.2,
    sillY: 0.42, bumperY: 0.46, noseY: 1.0, hoodY: 1.12, beltY: 1.2, deckY: 1.2, tailY: 1.16, hoodCurve: 3,
    cowl: 0.2, roofFront: 0.05, roofBack: -0.45, cBase: -0.48, roofY: 1.84, roofArc: 0.012, tumble: 0.9, rear: 'straight',
    pillars: 'black', roof: 'body', chromeTrim: true, roofRails: true,
    frontAxle: 0.32, rearAxle: -0.3, wheelR: 0.42, wheelW: 0.29, archGap: 0.05, rim: 'multi', rimScale: 0.72,
    head: { style: 'slim', x: 0.72, y: 0.98, w: 0.28, h: 0.045 },
    head2: { style: 'square', x: 0.72, y: 0.78, w: 0.18, h: 0.07 },
    tail: { style: 'slim', x: 0.72, y: 1.04, w: 0.3, h: 0.06 },
    grille: { style: 'kidney', y: 0.86, w: 0.36, h: 0.28 },
    intake: { y: 0.6, w: 0.66, h: 0.1 },
    bumpers: 'body', doors: 4, exhaust: 'quad',
  }),
  // BMW 5 Series (G60): clean executive saloon, wide low kidneys, slim lamps.
  bmw_5_g60: d({
    noseRound: 0.11, tailRound: 0.08, noseWidth: 0.85, tailWidth: 0.88, hips: 0.03, section: 5,
    sillY: 0.24, bumperY: 0.27, noseY: 0.68, hoodY: 0.88, beltY: 0.97, deckY: 0.98, tailY: 0.94, hoodCurve: 2.4,
    cowl: 0.14, roofFront: -0.01, roofBack: -0.22, cBase: -0.34, roofY: 1.48, roofArc: 0.03, tumble: 0.8, rear: 'fast',
    pillars: 'body', roof: 'body', chromeTrim: true,
    frontAxle: 0.33, rearAxle: -0.28, wheelR: 0.36, wheelW: 0.25, archGap: 0.05, rim: 'multi', rimScale: 0.7,
    head: { style: 'slim', x: 0.68, y: 0.7, w: 0.32, h: 0.06 },
    tail: { style: 'slim', x: 0.68, y: 0.86, w: 0.38, h: 0.06 },
    grille: { style: 'kidney', y: 0.6, w: 0.32, h: 0.17 },
    intake: { y: 0.4, w: 0.64, h: 0.07 },
    bumpers: 'body', doors: 4, exhaust: 'dual',
  }),
  // BMW M8 Competition: long, low grand tourer coupe with wide kidneys and a carbon roof.
  bmw_m8_comp: d({
    noseRound: 0.14, tailRound: 0.1, noseWidth: 0.8, tailWidth: 0.86, hips: 0.06, section: 4.4,
    sillY: 0.2, bumperY: 0.22, noseY: 0.6, hoodY: 0.84, beltY: 0.9, deckY: 0.92, tailY: 0.88, hoodCurve: 2.4,
    cowl: 0.1, roofFront: -0.06, roofBack: -0.2, cBase: -0.4, roofY: 1.34, roofArc: 0.03, tumble: 0.74, rear: 'fast',
    pillars: 'black', roof: 'black',
    frontAxle: 0.32, rearAxle: -0.29, wheelR: 0.36, wheelW: 0.29, archGap: 0.04, rim: 'multi', rimScale: 0.76,
    head: { style: 'slim', x: 0.66, y: 0.64, w: 0.34, h: 0.06 },
    tail: { style: 'slim', x: 0.66, y: 0.8, w: 0.38, h: 0.06 },
    grille: { style: 'kidney', y: 0.5, w: 0.36, h: 0.15 },
    intake: { y: 0.31, w: 0.84, h: 0.1 },
    bumpers: 'body', doors: 2, exhaust: 'quad',
  }),
  // Mercedes-AMG GT: endless hood, cab set far back, vertical-slat grille, quad pipes.
  mercedes_amg_gt: d({
    noseRound: 0.15, tailRound: 0.1, noseWidth: 0.78, tailWidth: 0.86, hips: 0.07, section: 4.2,
    sillY: 0.2, bumperY: 0.22, noseY: 0.58, hoodY: 0.86, beltY: 0.9, deckY: 0.92, tailY: 0.86, hoodCurve: 2.6,
    cowl: 0.04, roofFront: -0.11, roofBack: -0.23, cBase: -0.42, roofY: 1.34, roofArc: 0.03, tumble: 0.72, rear: 'fast',
    pillars: 'black', roof: 'body',
    frontAxle: 0.31, rearAxle: -0.29, wheelR: 0.36, wheelW: 0.3, archGap: 0.04, rim: 'five', rimScale: 0.76,
    head: { style: 'slim', x: 0.68, y: 0.64, w: 0.3, h: 0.07 },
    tail: { style: 'slim', x: 0.66, y: 0.78, w: 0.3, h: 0.06 },
    grille: { style: 'panamericana', y: 0.47, w: 0.34, h: 0.2 },
    intake: { y: 0.3, w: 0.84, h: 0.1 },
    bumpers: 'body', doors: 2, exhaust: 'quad',
  }),
  // Mercedes-Benz E-Class (W214): elegant saloon, wide gloss-black star grille, chrome line.
  mercedes_e_w214: d({
    noseRound: 0.11, tailRound: 0.08, noseWidth: 0.85, tailWidth: 0.88, hips: 0.02, section: 5,
    sillY: 0.24, bumperY: 0.27, noseY: 0.68, hoodY: 0.88, beltY: 0.96, deckY: 0.97, tailY: 0.93, hoodCurve: 2.4,
    cowl: 0.14, roofFront: -0.02, roofBack: -0.22, cBase: -0.34, roofY: 1.46, roofArc: 0.03, tumble: 0.8, rear: 'fast',
    pillars: 'body', roof: 'body', chromeTrim: true,
    frontAxle: 0.33, rearAxle: -0.28, wheelR: 0.35, wheelW: 0.24, archGap: 0.05, rim: 'multi', rimScale: 0.7,
    head: { style: 'slim', x: 0.7, y: 0.68, w: 0.3, h: 0.07 },
    tail: { style: 'slim', x: 0.66, y: 0.85, w: 0.38, h: 0.07 },
    grille: { style: 'star', y: 0.6, w: 0.44, h: 0.16 },
    intake: { y: 0.4, w: 0.6, h: 0.07 },
    bumpers: 'body', doors: 4, exhaust: 'dual',
  }),
  // Mercedes-AMG G 63: a brick with round headlights, vertical slats and a spare wheel on the door.
  mercedes_g_class: d({
    noseRound: 0.03, tailRound: 0.02, noseWidth: 0.95, tailWidth: 0.97, hips: 0.03, section: 9,
    sillY: 0.46, bumperY: 0.5, noseY: 1.08, hoodY: 1.16, beltY: 1.2, deckY: 1.2, tailY: 1.2, hoodCurve: 4,
    cowl: 0.2, roofFront: 0.1, roofBack: -0.47, cBase: -0.49, roofY: 1.96, roofArc: 0.005, tumble: 0.93, rear: 'straight',
    pillars: 'body', roof: 'body', spare: true, cladding: true,
    frontAxle: 0.3, rearAxle: -0.3, wheelR: 0.43, wheelW: 0.3, archGap: 0.06, rim: 'five', rimScale: 0.66,
    head: { style: 'round', x: 0.74, y: 0.92, w: 0.2, h: 0.2 },
    tail: { style: 'vertical', x: 0.88, y: 0.96, w: 0.1, h: 0.26 },
    grille: { style: 'panamericana', y: 0.88, w: 0.42, h: 0.2 },
    bumpers: 'black', doors: 4, exhaust: 'dual',
  }),
  // Audi RS5 Coupe: fastback coupe, big honeycomb single-frame grille, wide quattro hips.
  audi_rs5_coupe: d({
    noseRound: 0.13, tailRound: 0.09, noseWidth: 0.83, tailWidth: 0.87, hips: 0.06, section: 4.6,
    sillY: 0.21, bumperY: 0.23, noseY: 0.6, hoodY: 0.84, beltY: 0.91, deckY: 0.93, tailY: 0.88, hoodCurve: 2.2,
    cowl: 0.12, roofFront: -0.04, roofBack: -0.2, cBase: -0.42, roofY: 1.36, roofArc: 0.03, tumble: 0.76, rear: 'fast',
    pillars: 'black', roof: 'body',
    frontAxle: 0.33, rearAxle: -0.28, wheelR: 0.35, wheelW: 0.28, archGap: 0.04, rim: 'multi', rimScale: 0.74,
    head: { style: 'slim', x: 0.68, y: 0.64, w: 0.32, h: 0.06 },
    tail: { style: 'slim', x: 0.66, y: 0.8, w: 0.36, h: 0.06 },
    grille: { style: 'singleframe', y: 0.45, w: 0.42, h: 0.24 },
    bumpers: 'body', doors: 2, exhaust: 'dual',
  }),
};

/** A reasonable design derived from the physical shape, for models without a dedicated design. */
function fallback(shape: VehicleShape): CarDesign {
  const base: Record<BodyStyle, string> = {
    hatch: 'norda_pixi',
    sedan: 'norda_arlo',
    coupe: 'apexon_strix',
    suv: 'granforge_ridgeback',
    pickup: 'granforge_packmule',
    van: 'norda_workmate',
    classic: 'harlan_bellwether',
    wagon: 'norda_arlo',
    bike: 'norda_pixi',
  };
  return DESIGNS[base[shape.style]]!;
}

export function designFor(modelId: string): CarDesign {
  return DESIGNS[modelId] ?? fallback(getModel(modelId).shape);
}
