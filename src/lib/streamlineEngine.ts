import { CAPTURE_RADIUS, FIELD_HALF, MAX_LINE_VERTICES, MAX_STREAMLINES, SOFTENING } from './types';
import type { ComputeRequest, ComputeResult, MassPoint, StreamParams } from './types';
import { isOutsideDomain, isStagnant, makeRng } from './fieldMath';

const POINT_BUDGET = MAX_LINE_VERTICES / 2;
/** During dragging, cap per-direction nominal steps so each frame stays cheap. */
const INTERACTIVE_STEP_CAP = 220;
/**
 * During dragging the visual is replaced every frame, so a much smaller point
 * budget keeps the worker + GPU upload inside the 20 fps (50 ms) budget. A
 * full-resolution run replaces it when the drag ends.
 */
const INTERACTIVE_POINT_BUDGET = 75_000;

interface TraceBuffers {
  px: number[];
  pz: number[];
  mx: number[];
  mz: number[];
  mag: number[];
}

function newTrace(): TraceBuffers {
  return { px: [], pz: [], mx: [], mz: [], mag: [] };
}

/** Pre-flattened mass data so the hot loop avoids object property access. */
interface FlatMasses {
  n: number;
  mx: number[];
  mz: number[];
  mm: number[];
  eps2: number;
}

function flattenMasses(masses: MassPoint[]): FlatMasses {
  return {
    n: masses.length,
    mx: masses.map((m) => m.x),
    mz: masses.map((m) => m.z),
    mm: masses.map((m) => m.mass),
    eps2: SOFTENING * SOFTENING
  };
}

/** Inline field evaluation on flattened masses; returns magnitude via out params. */
function fieldFlat(
  x: number,
  z: number,
  f: FlatMasses,
  out: [number, number]
): number {
  let ax = 0;
  let az = 0;
  for (let i = 0; i < f.n; i++) {
    const dx = f.mx[i] - x;
    const dz = f.mz[i] - z;
    const r2 = dx * dx + dz * dz + f.eps2;
    const inv = f.mm[i] / (r2 * Math.sqrt(r2));
    ax += dx * inv;
    az += dz * inv;
  }
  out[0] = ax;
  out[1] = az;
  return Math.hypot(ax, az);
}

/** Unit direction on flattened masses. */
function directionFlat(
  x: number,
  z: number,
  f: FlatMasses,
  sign: 1 | -1,
  field: [number, number]
): [number, number] {
  const mag = fieldFlat(x, z, f, field);
  if (mag < 1e-12) {
    field[0] = 0;
    field[1] = 0;
    return field;
  }
  field[0] = (sign * field[0]) / mag;
  field[1] = (sign * field[1]) / mag;
  return field;
}

/** RK4 on the normalized direction field, all on flattened masses. */
function rk4Flat(
  x: number,
  z: number,
  h: number,
  f: FlatMasses,
  sign: 1 | -1,
  out: [number, number],
  fa: [number, number],
  fb: [number, number],
  fc: [number, number],
  fd: [number, number]
): void {
  directionFlat(x, z, f, sign, fa);
  directionFlat(x + 0.5 * h * fa[0], z + 0.5 * h * fa[1], f, sign, fb);
  directionFlat(x + 0.5 * h * fb[0], z + 0.5 * h * fb[1], f, sign, fc);
  directionFlat(x + h * fc[0], z + h * fc[1], f, sign, fd);
  out[0] = x + (h / 6) * (fa[0] + 2 * fb[0] + 2 * fc[0] + fd[0]);
  out[1] = z + (h / 6) * (fa[1] + 2 * fb[1] + 2 * fc[1] + fd[1]);
}

function nearestDistanceFlat(x: number, z: number, f: FlatMasses): number {
  let best = Infinity;
  for (let i = 0; i < f.n; i++) {
    const dx = f.mx[i] - x;
    const dz = f.mz[i] - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }
  return best;
}

function segmentHitsFlat(x0: number, z0: number, x1: number, z1: number, f: FlatMasses): boolean {
  const r = CAPTURE_RADIUS;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const seg2 = dx * dx + dz * dz;
  for (let i = 0; i < f.n; i++) {
    const ox = f.mx[i] - x0;
    const oz = f.mz[i] - z0;
    let t = seg2 > 0 ? (ox * dx + oz * dz) / seg2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = f.mx[i] - (x0 + t * dx);
    const ez = f.mz[i] - (z0 + t * dz);
    if (ex * ex + ez * ez < r * r) return true;
  }
  return false;
}

function capturedFlat(x: number, z: number, f: FlatMasses): boolean {
  const r2 = CAPTURE_RADIUS * CAPTURE_RADIUS;
  for (let i = 0; i < f.n; i++) {
    const dx = f.mx[i] - x;
    const dz = f.mz[i] - z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

/**
 * Integrate one direction from a seed along the NORMALIZED field direction
 * (field lines parameterized by arc length), using classical RK4.
 *
 * sign = +1 follows the field toward the masses; -1 traces against it.
 *
 * Near a mass the direction turns sharply, so each user-facing step is split
 * into adaptive geometric substeps no longer than a fraction of the distance
 * to the nearest mass. Every substep endpoint is recorded, keeping the
 * polyline faithful to the integrated curve without tunneling.
 */
function traceDirection(
  sx: number,
  sz: number,
  sign: 1 | -1,
  f: FlatMasses,
  params: StreamParams,
  interactive: boolean,
  out: TraceBuffers
): void {
  const nominalSteps = Math.ceil(params.maxLength / params.stepSize);
  const stepCap = interactive
    ? Math.min(nominalSteps, INTERACTIVE_STEP_CAP)
    : nominalSteps;

  let x = sx;
  let z = sz;
  let arc = 0;
  const tmp: [number, number] = [0, 0];
  const fa: [number, number] = [0, 0];
  const fb: [number, number] = [0, 0];
  const fc: [number, number] = [0, 0];
  const fd: [number, number] = [0, 0];
  const field: [number, number] = [0, 0];

  const pushPoint = (px: number, pz: number): boolean => {
    const mag = fieldFlat(px, pz, f, field);
    if (out.px.length > 0 && isStagnant(mag)) return false;
    out.px.push(px);
    out.pz.push(pz);
    out.mag.push(mag);
    out.mx.push(field[0]);
    out.mz.push(field[1]);
    return true;
  };

  if (!pushPoint(x, z)) return;

  const clearanceFraction = interactive ? 0.6 : 0.35;

  for (let step = 0; step < stepCap; step++) {
    let subX = x;
    let subZ = z;
    let remaining = params.stepSize;
    let guard = 0;
    let hit = false;

    while (remaining > 1e-9 && guard++ < 4096) {
      const d = nearestDistanceFlat(subX, subZ, f);
      if (d <= CAPTURE_RADIUS) {
        hit = true;
        break;
      }
      const h = Math.min(remaining, clearanceFraction * Math.max(d, 0.02));
      rk4Flat(subX, subZ, h, f, sign, tmp, fa, fb, fc, fd);
      const nx = tmp[0];
      const nz = tmp[1];
      const moved = Math.hypot(nx - subX, nz - subZ);
      if (segmentHitsFlat(subX, subZ, nx, nz, f) || capturedFlat(nx, nz, f)) {
        hit = true;
        break;
      }
      subX = nx;
      subZ = nz;
      remaining -= h;
      arc += moved;
      if (isOutsideDomain(subX, subZ)) {
        hit = true;
        break;
      }
      if (!pushPoint(subX, subZ)) {
        hit = true;
        break;
      }
    }
    if (guard >= 4096 && !hit) hit = true;

    x = subX;
    z = subZ;
    if (hit) break;
    if (arc >= params.maxLength) break;
    if (isOutsideDomain(x, z)) break;
  }
}

/**
 * Compute the full streamline set. Runs on the worker thread.
 * `shouldAbort` is polled between seed lines so a newer request can cancel
 * a stale computation quickly (important during mass-point dragging).
 */
export function computeStreamlines(
  req: ComputeRequest,
  shouldAbort: () => boolean
): ComputeResult {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { masses, params, interactive, msgId } = req;
  const flat = flattenMasses(masses);
  const pointBudget = interactive ? INTERACTIVE_POINT_BUDGET : POINT_BUDGET;

  const positions = new Float32Array(pointBudget * 2);
  const magnitudes = new Float32Array(pointBudget);
  const directions = new Float32Array(pointBudget * 2);
  const lineStarts = new Uint32Array(MAX_STREAMLINES);
  const lineCounts = new Uint32Array(MAX_STREAMLINES);

  let cursor = 0;
  let lineCount = 0;
  let truncated = false;
  let aborted = false;

  const fwd = newTrace();
  const bwd = newTrace();

  if (masses.length > 0) {
    // Jittered regular grid over the square domain.
    // During a drag, thin the seed grid so the per-frame recompute fits the
    // 20 fps budget; the full grid is restored on pointer-up.
    const effectiveDensity = interactive ? params.seedDensity * 0.35 : params.seedDensity;
    const nPerSide = Math.max(
      1,
      Math.round(2 * FIELD_HALF * Math.sqrt(effectiveDensity))
    );
    const cell = (2 * FIELD_HALF) / nPerSide;
    const rng = makeRng(0x9e3779b9 ^ (nPerSide * 73856093));
    const bidir = params.direction === 'bidirectional';

    seedLoop: for (let iy = 0; iy < nPerSide; iy++) {
      for (let ix = 0; ix < nPerSide; ix++) {
        if ((ix * 7 + iy * 13) % 64 === 0 && shouldAbort()) {
          aborted = true;
          break seedLoop;
        }
        if (lineCount >= MAX_STREAMLINES) {
          truncated = true;
          break seedLoop;
        }
        const jx = (rng() - 0.5) * cell;
        const jz = (rng() - 0.5) * cell;
        const sx = -FIELD_HALF + (ix + 0.5) * cell + jx;
        const sz = -FIELD_HALF + (iy + 0.5) * cell + jz;
        if (capturedFlat(sx, sz, flat)) continue;

        fwd.px.length = 0; fwd.pz.length = 0; fwd.mag.length = 0;
        fwd.mx.length = 0; fwd.mz.length = 0;
        bwd.px.length = 0; bwd.pz.length = 0; bwd.mag.length = 0;
        bwd.mx.length = 0; bwd.mz.length = 0;

        if (params.direction !== 'backward') {
          traceDirection(sx, sz, 1, flat, params, interactive, fwd);
        } else {
          traceDirection(sx, sz, -1, flat, params, interactive, fwd);
        }
        if (bidir) {
          traceDirection(sx, sz, -1, flat, params, interactive, bwd);
        }

        const total = fwd.px.length + (bidir ? bwd.px.length - 1 : 0);
        if (total < 2 || cursor + total > pointBudget) {
          if (cursor + total > pointBudget) truncated = true;
          continue;
        }

        lineStarts[lineCount] = cursor;
        lineCounts[lineCount] = total;

        if (bidir) {
          // Backward trace, seed-first order: walk bwd backwards, skip its seed
          // (duplicate of fwd's first point).
          for (let i = bwd.px.length - 1; i >= 1; i--) {
            positions[cursor * 2] = bwd.px[i];
            positions[cursor * 2 + 1] = bwd.pz[i];
            magnitudes[cursor] = bwd.mag[i];
            directions[cursor * 2] = bwd.mx[i];
            directions[cursor * 2 + 1] = bwd.mz[i];
            cursor++;
          }
        }
        for (let i = 0; i < fwd.px.length; i++) {
          positions[cursor * 2] = fwd.px[i];
          positions[cursor * 2 + 1] = fwd.pz[i];
          magnitudes[cursor] = fwd.mag[i];
          directions[cursor * 2] = fwd.mx[i];
          directions[cursor * 2 + 1] = fwd.mz[i];
          cursor++;
        }
        lineCount++;
      }
    }
  }

  const result: ComputeResult = {
    msgId,
    positions: positions.slice(0, cursor * 2),
    magnitudes: magnitudes.slice(0, cursor),
    directions: directions.slice(0, cursor * 2),
    lineStarts: lineStarts.slice(0, lineCount),
    lineCounts: lineCounts.slice(0, lineCount),
    lineCount,
    pointCount: cursor,
    interactive,
    truncated: truncated || aborted,
    aborted,
    elapsedMs:
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
  };
  return result;
}
