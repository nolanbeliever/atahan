// Snapshot buffer for smooth interpolation of remote entities.

import { lerp, lerpAngle } from '../../../shared/util';

export interface Sample {
  t: number;
  x: number;
  z: number;
  r: number;
  a: number;
  b: number;
  /** Driven vehicles: engine rpm, gear and flags (VF). */
  rpm?: number;
  gear?: number;
  f?: number;
}

export const INTERP_DELAY_MS = 110;

export class InterpBuffer {
  private samples: Sample[] = [];

  push(s: Sample): void {
    this.samples.push(s);
    if (this.samples.length > 30) this.samples.shift();
  }

  get latest(): Sample | undefined {
    return this.samples[this.samples.length - 1];
  }

  sample(renderT: number): Sample | undefined {
    const n = this.samples.length;
    if (n === 0) return undefined;
    if (renderT <= this.samples[0]!.t) return this.samples[0];
    for (let i = n - 1; i > 0; i--) {
      const a = this.samples[i - 1]!;
      const b = this.samples[i]!;
      if (renderT >= a.t && renderT <= b.t) {
        const k = b.t === a.t ? 1 : (renderT - a.t) / (b.t - a.t);
        return { t: renderT, x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k), r: lerpAngle(a.r, b.r, k), a: k < 0.5 ? a.a : b.a, b: lerp(a.b, b.b, k), rpm: b.rpm, gear: b.gear, f: b.f };
      }
    }
    // Past the newest sample: hold (short extrapolation is avoided on purpose).
    return this.samples[n - 1];
  }
}
