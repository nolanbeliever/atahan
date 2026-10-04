// Time of day and weather, the same for every player (derived from the server clock, nothing is
// sent over the network). A full day lasts 10 real minutes; rain comes and goes in random spells.

/** A full day lasts 10 real minutes (25 seconds per game hour). */
export const DAY_LENGTH_MS = 10 * 60_000;

export function gameHour(serverTime: number): number {
  return ((serverTime % DAY_LENGTH_MS) / DAY_LENGTH_MS) * 24;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 0 in full daylight, 1 at night, smooth at dusk (18-20) and dawn (5-7). */
export function nightFactor(hour: number): number {
  return Math.max(smooth(18, 20, hour), 1 - smooth(5, 7, hour));
}

/** Golden-hour warmth: peaks around sunset (17-19) and sunrise (6-7). 0-1. */
export function sunsetFactor(hour: number): number {
  const dusk = smooth(16, 18, hour) * (1 - smooth(18.6, 19.8, hour));
  const dawn = smooth(5.2, 6.1, hour) * (1 - smooth(6.6, 7.6, hour));
  return Math.max(dusk, dawn * 0.8);
}

/** Weather is decided per slot of this length. */
export const WEATHER_SLOT_MS = 150_000;
/** Chance that a slot is rainy. */
export const RAIN_CHANCE = 0.3;
const FADE_MS = 25_000;

function slotHash(slot: number): number {
  let x = (slot * 2654435761) ^ 0x5bd1e995;
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

/** Rain strength of a slot (0 = dry). */
function slotRain(slot: number): number {
  const h = slotHash(slot);
  return h < RAIN_CHANCE ? 0.55 + (h / RAIN_CHANCE) * 0.45 : 0;
}

/** How hard it is raining now, 0-1 (fades in and out at the edges of a spell). */
export function rainAt(serverTime: number): number {
  const slot = Math.floor(serverTime / WEATHER_SLOT_MS);
  const into = serverTime - slot * WEATHER_SLOT_MS;
  const cur = slotRain(slot);
  if (into < FADE_MS) {
    const prev = slotRain(slot - 1);
    return prev + (cur - prev) * smooth(0, FADE_MS, into);
  }
  return cur;
}

/** How wet the roads are, 0-1: they get wet quickly and take a minute or so to dry. */
export function wetnessAt(serverTime: number): number {
  return Math.max(rainAt(serverTime), rainAt(serverTime - 30_000) * 0.8, rainAt(serverTime - 60_000) * 0.5, rainAt(serverTime - 90_000) * 0.25);
}

/** Tyre grip on the road surface: 1 dry, down to 0.8 (-20%) on a soaked road. */
export function surfaceGrip(serverTime: number): number {
  return 1 - 0.2 * Math.min(1, wetnessAt(serverTime) / 0.7);
}
