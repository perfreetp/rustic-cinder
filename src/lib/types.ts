/** Shared domain constants and tunable limits for the gravity-field visualizer. */

/** Half extent of the square simulation domain: points live in [-HALF, HALF]^2. */
export const FIELD_HALF = 10;

/** Plummer softening length — keeps the field finite at r -> 0. */
export const SOFTENING = 0.12;

/** Radius at which a streamline is considered captured by a mass point. */
export const CAPTURE_RADIUS = 0.35;

/** Gravitational constant in simulation units. */
export const G = 1.0;

export const MAX_MASSES = 12;
export const MAX_STREAMLINES = 20000;

/** Hard cap on line-system vertices (each rendered segment = 2 vertices). */
export const MAX_LINE_VERTICES = 1_200_000;

/** Hard cap on rendered cone arrows. */
export const MAX_ARROWS = 25_000;

export interface MassPoint {
  id: number;
  x: number;
  z: number;
  mass: number;
}

export type TraceDirection = 'forward' | 'backward' | 'bidirectional';

export interface StreamParams {
  /** Seed points per unit length, 0.025 – 50. */
  seedDensity: number;
  /** RK4 integration step length in world units, 0.02 – 1. */
  stepSize: number;
  /** Maximum integrated arc length per direction, 5 – 200. */
  maxLength: number;
  direction: TraceDirection;
}

export interface ComputeRequest {
  msgId: number;
  masses: MassPoint[];
  params: StreamParams;
  /** When true the worker is allowed to trade accuracy for latency (dragging). */
  interactive: boolean;
}

export interface ComputeResult {
  msgId: number;
  /** Flat x/z positions, length = pointCount * 2. */
  positions: Float32Array;
  /** Field magnitude per point, length = pointCount. */
  magnitudes: Float32Array;
  /** Flat field direction (ax/az, unnormalized) per point, length = pointCount * 2. */
  directions: Float32Array;
  /** Start offset (into point arrays) of each line, length = lineCount. */
  lineStarts: Uint32Array;
  /** Point count of each line, length = lineCount. */
  lineCounts: Uint32Array;
  lineCount: number;
  pointCount: number;
  interactive: boolean;
  /** True when the hard vertex budget was hit. */
  truncated: boolean;
  /** True when a newer request cancelled this computation. */
  aborted: boolean;
  elapsedMs: number;
}
