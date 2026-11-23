import { CAPTURE_RADIUS, FIELD_HALF, G, SOFTENING } from './types';
import type { MassPoint } from './types';

/** Deterministic, allocation-free PRNG (mulberry32) so seed jitter is stable. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gravitational acceleration at (x, z) in the plane.
 * a = G * sum_i  m_i * (r_i - r) / (|r_i - r|^2 + eps^2)^(3/2)
 * Returns [ax, az].
 */
export function fieldAt(x: number, z: number, masses: MassPoint[]): [number, number] {
  let ax = 0;
  let az = 0;
  for (let i = 0; i < masses.length; i++) {
    const m = masses[i];
    const dx = m.x - x;
    const dz = m.z - z;
    const r2 = dx * dx + dz * dz + SOFTENING * SOFTENING;
    const inv = (G * m.mass) / (r2 * Math.sqrt(r2));
    ax += dx * inv;
    az += dz * inv;
  }
  return [ax, az];
}

/**
 * Unit direction of the field at (x, z): v/|v|. Streamlines are field lines
 * parameterized by arc length, so their tangent is this unit vector.
 * Returns [0, 0] at stagnation points. `sign` = -1 yields the reversed
 * direction (backward tracing).
 */
export function fieldDirection(
  x: number,
  z: number,
  masses: MassPoint[],
  sign: 1 | -1 = 1
): [number, number] {
  const [ax, az] = fieldAt(x, z, masses);
  const mag = Math.hypot(ax, az);
  if (mag < 1e-12) return [0, 0];
  return [(sign * ax) / mag, (sign * az) / mag];
}

/**
 * One classical 4th-order Runge–Kutta step on the NORMALIZED direction field
 * (arc-length parameterization). `h` is therefore a geometric step length.
 */
export function rk4DirectionStep(
  x: number,
  z: number,
  h: number,
  masses: MassPoint[],
  sign: 1 | -1,
  out: [number, number]
): [number, number] {
  const [k1x, k1z] = fieldDirection(x, z, masses, sign);
  const [k2x, k2z] = fieldDirection(x + 0.5 * h * k1x, z + 0.5 * h * k1z, masses, sign);
  const [k3x, k3z] = fieldDirection(x + 0.5 * h * k2x, z + 0.5 * h * k2z, masses, sign);
  const [k4x, k4z] = fieldDirection(x + h * k3x, z + h * k3z, masses, sign);

  out[0] = x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
  out[1] = z + (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
  return out;
}

/**
 * One classical 4th-order Runge–Kutta step along the vector field.
 * `k1` may be supplied when the field at (x, z) was already evaluated
 * (e.g. for coloring); otherwise it is evaluated here.
 */
export function rk4Step(
  x: number,
  z: number,
  h: number,
  masses: MassPoint[],
  out: [number, number],
  k1?: [number, number]
): [number, number] {
  let k1x: number;
  let k1z: number;
  if (k1) {
    k1x = k1[0];
    k1z = k1[1];
  } else {
    [k1x, k1z] = fieldAt(x, z, masses);
  }

  const [k2x, k2z] = fieldAt(x + 0.5 * h * k1x, z + 0.5 * h * k1z, masses);
  const [k3x, k3z] = fieldAt(x + 0.5 * h * k2x, z + 0.5 * h * k2z, masses);
  const [k4x, k4z] = fieldAt(x + h * k3x, z + h * k3z, masses);

  out[0] = x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
  out[1] = z + (h / 6) * (k1z + 2 * k2z + 2 * k3z + k4z);
  return out;
}

/** True when the point is inside the capture radius of any mass point. */
export function isCaptured(x: number, z: number, masses: MassPoint[]): boolean {
  const r2 = CAPTURE_RADIUS * CAPTURE_RADIUS;
  for (let i = 0; i < masses.length; i++) {
    const dx = masses[i].x - x;
    const dz = masses[i].z - z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

/**
 * True when the segment (x0,z0)->(x1,z1) enters the capture circle of any
 * mass. Catches the case where one RK4 step leaps straight over a mass,
 * which endpoint checks alone would miss.
 */
export function segmentHitsMass(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  masses: MassPoint[]
): boolean {
  const r = CAPTURE_RADIUS;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const seg2 = dx * dx + dz * dz;
  for (let i = 0; i < masses.length; i++) {
    const m = masses[i];
    const mx = m.x - x0;
    const mz = m.z - z0;
    let t = seg2 > 0 ? (mx * dx + mz * dz) / seg2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = x0 + t * dx;
    const cz = z0 + t * dz;
    const ex = m.x - cx;
    const ez = m.z - cz;
    if (ex * ex + ez * ez < r * r) return true;
  }
  return false;
}

/** Margin beyond FIELD_HALF before a streamline is terminated. */
const OUT_MARGIN = 0.6;

export function isOutsideDomain(x: number, z: number): boolean {
  return Math.abs(x) > FIELD_HALF + OUT_MARGIN || Math.abs(z) > FIELD_HALF + OUT_MARGIN;
}

/** Field magnitude treated as "effectively zero" (equilibrium region). */
export function isStagnant(mag: number): boolean {
  return mag < 1e-7;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
