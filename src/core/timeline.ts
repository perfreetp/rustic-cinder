import { clamp } from './math';
import type { Crease, Keyframe, TimelineSettings } from './types';

/**
 * Keyframe sampling.
 *
 * Each crease carries its own list of keyframes (time → fold angle). Between
 * two neighbouring keys the angle follows a monotone cubic Hermite curve with
 * Fritsch–Carlson tangents:
 *
 *  - C¹ continuous everywhere, so the folded surface never jumps or kinks
 *    when the playhead crosses a key,
 *  - monotone between keys, so the paper never overshoots past a keyed angle
 *    (an overshoot would make valley folds briefly become mountain folds),
 *  - flat at local extrema, which reads as a natural "settle" on each key.
 *
 * Outside the key range the curve holds the nearest key's value, and a crease
 * with no keys at all uses its static `angle` field. That keeps the mapping
 * from time to angles total and continuous over the whole timeline.
 */

export interface CreaseTrack {
  creaseId: string;
  /** Sorted, deduplicated. */
  keys: Keyframe[];
  /** Precomputed tangents aligned with `keys`. */
  tangents: number[];
  /** Fallback when `keys` is empty. */
  fallbackAngle: number;
}

export interface KeyframeCurve {
  tracks: Map<string, CreaseTrack>;
  duration: number;
}

/** Build monotone tangents (Fritsch–Carlson) for a sorted key list. */
export function monotoneTangents(times: number[], values: number[]): number[] {
  const n = times.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const dts: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dt = times[i + 1] - times[i];
    dts.push(dt);
    slopes.push(dt > 1e-9 ? (values[i + 1] - values[i]) / dt : 0);
  }

  const m: number[] = new Array(n).fill(0);
  m[0] = slopes[0];
  m[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const s0 = slopes[i - 1];
    const s1 = slopes[i];
    if (s0 * s1 <= 0) {
      m[i] = 0; // local extremum: settle
    } else {
      // Weighted harmonic mean ≈ standard FC tangent, but stay inside the
      // interval slope bounds so no segment overshoots.
      const dt0 = dts[i - 1];
      const dt1 = dts[i];
      const w1 = 2 * dt1 + dt0;
      const w2 = dt1 + 2 * dt0;
      m[i] = (w1 + w2) / (w1 / s0 + w2 / s1);
    }
  }

  // Clamp tangents so each segment remains monotone (FC condition 2).
  for (let i = 0; i < n - 1; i++) {
    const s = slopes[i];
    if (Math.abs(s) < 1e-9) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / s;
    const b = m[i + 1] / s;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * s;
      m[i + 1] = t * b * s;
    }
  }
  return m;
}

/** Normalise a crease's keyframes: sort by time and collapse near-duplicates. */
export function normalizeKeys(keys: Keyframe[]): Keyframe[] {
  const sorted = [...keys].sort((a, b) => a.time - b.time);
  const out: Keyframe[] = [];
  for (const k of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.time - k.time) < 1e-4) {
      // Later key wins at (numerically) the same time.
      out[out.length - 1] = { ...k, time: prev.time };
    } else {
      out.push({ ...k });
    }
  }
  return out;
}

export function buildCurve(
  creases: Crease[],
  keyframes: Record<string, Keyframe[]>,
  settings: TimelineSettings,
): KeyframeCurve {
  const tracks = new Map<string, CreaseTrack>();
  for (const c of creases) {
    const keys = normalizeKeys(keyframes[c.id] ?? []);
    const times = keys.map((k) => k.time);
    const values = keys.map((k) => k.angle);
    tracks.set(c.id, {
      creaseId: c.id,
      keys,
      tangents: monotoneTangents(times, values),
      fallbackAngle: c.angle,
    });
  }
  return { tracks, duration: Math.max(0.05, settings.duration) };
}

/**
 * Evaluate one track at time `t`. Total and continuous for every `t` in
 * (-inf, +inf): constant before the first key and after the last one.
 */
export function sampleTrack(track: CreaseTrack, t: number): number {
  const keys = track.keys;
  if (keys.length === 0) return track.fallbackAngle;
  if (keys.length === 1) return keys[0].angle;
  if (t <= keys[0].time) return keys[0].angle;
  const last = keys[keys.length - 1];
  if (t >= last.time) return last.angle;

  // Binary search for the segment.
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].time <= t) lo = mid;
    else hi = mid;
  }

  const t0 = keys[lo].time;
  const t1 = keys[hi].time;
  const dt = t1 - t0;
  if (dt <= 1e-9) return keys[hi].angle;

  const h = clamp((t - t0) / dt, 0, 1);
  const h2 = h * h;
  const h3 = h2 * h;
  // Hermite basis.
  const h00 = 2 * h3 - 3 * h2 + 1;
  const h10 = h3 - 2 * h2 + h;
  const h01 = -2 * h3 + 3 * h2;
  const h11 = h3 - h2;

  return (
    h00 * keys[lo].angle +
    h10 * dt * track.tangents[lo] +
    h01 * keys[hi].angle +
    h11 * dt * track.tangents[hi]
  );
}

/** All crease angles (degrees) at time `t`, keyed by crease id. */
export function sampleAngles(curve: KeyframeCurve, t: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, track] of curve.tracks) out.set(id, sampleTrack(track, t));
  return out;
}

/** Step `t` forward by `dt` under the timeline's loop/rate settings. */
export function advanceTime(
  t: number,
  dt: number,
  settings: TimelineSettings,
): number {
  const duration = Math.max(0.05, settings.duration);
  let next = t + dt * settings.speed;
  if (settings.loop) {
    if (next >= duration) next = ((next % duration) + duration) % duration;
  } else {
    next = clamp(next, 0, duration);
  }
  return next;
}

/**
 * Sample every `step` seconds across the whole timeline. Used by the export
 * module to bake a deterministic preview of the motion.
 */
export function bakeSamples(
  curve: KeyframeCurve,
  duration: number,
  step: number,
): { time: number; angles: Record<string, number> }[] {
  const out: { time: number; angles: Record<string, number> }[] = [];
  const n = Math.max(1, Math.floor(duration / step));
  for (let i = 0; i <= n; i++) {
    const time = Math.min(duration, i * step);
    const angles: Record<string, number> = {};
    for (const [id, track] of curve.tracks) angles[id] = sampleTrack(track, time);
    out.push({ time, angles });
  }
  return out;
}
