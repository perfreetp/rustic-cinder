/**
 * Field-strength color ramp. Log-scaled magnitude maps onto a
 * dark-blue -> cyan -> green -> yellow -> red perceptually ordered band.
 */

export interface RampStop {
  t: number;
  r: number;
  g: number;
  b: number;
}

const STOPS: RampStop[] = [
  { t: 0.0, r: 0.05, g: 0.05, b: 0.28 },
  { t: 0.25, r: 0.0, g: 0.45, b: 0.85 },
  { t: 0.5, r: 0.1, g: 0.85, b: 0.55 },
  { t: 0.75, r: 1.0, g: 0.82, b: 0.15 },
  { t: 1.0, r: 0.95, g: 0.12, b: 0.08 }
];

/** Precomputed 1024-entry lookup table, plus log-domain bounds. */
export class ColorRamp {
  readonly table: Float32Array;
  readonly logMin: number;
  readonly logMax: number;
  private static readonly SIZE = 1024;

  constructor(logMin = -3, logMax = 4) {
    this.logMin = logMin;
    this.logMax = logMax;
    this.table = new Float32Array(ColorRamp.SIZE * 3);
    for (let i = 0; i < ColorRamp.SIZE; i++) {
      const t = i / (ColorRamp.SIZE - 1);
      let s = 0;
      while (s < STOPS.length - 2 && t > STOPS[s + 1].t) s++;
      const a = STOPS[s];
      const b = STOPS[s + 1];
      const u = (t - a.t) / (b.t - a.t);
      this.table[i * 3] = a.r + (b.r - a.r) * u;
      this.table[i * 3 + 1] = a.g + (b.g - a.g) * u;
      this.table[i * 3 + 2] = a.b + (b.b - a.b) * u;
    }
  }

  /** Normalized [0,1] ramp coordinate for a field magnitude. */
  tForMagnitude(mag: number): number {
    if (!isFinite(mag) || mag <= 0) return 0;
    const t = (Math.log10(mag) - this.logMin) / (this.logMax - this.logMin);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /** RGB in 0..1 for a field magnitude. */
  rgbForMagnitude(mag: number, out: [number, number, number]): [number, number, number] {
    const t = this.tForMagnitude(mag);
    const idx = Math.min(ColorRamp.SIZE - 1, (t * (ColorRamp.SIZE - 1)) | 0) * 3;
    out[0] = this.table[idx];
    out[1] = this.table[idx + 1];
    out[2] = this.table[idx + 2];
    return out;
  }
}
