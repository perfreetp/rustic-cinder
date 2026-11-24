import type { Vec2 } from './math';

/** Mountain folds point away from the viewer, valley folds toward them. */
export type FoldType = 'mountain' | 'valley';

/** A crease as drawn by the user, in sheet space [-1,1]². */
export interface Crease {
  id: string;
  /** Start point, sheet space. */
  a: Vec2;
  /** End point, sheet space. */
  b: Vec2;
  type: FoldType;
  /**
   * Static fold angle in degrees, used when this crease has no keyframes.
   * 0 = flat, 180 = fully folded over.
   */
  angle: number;
  /** Rendering hue slot, stable per crease for the editor. */
  slot: number;
}

/** A single keyframe: the fold angle of one crease at one time. */
export interface Keyframe {
  id: string;
  time: number;
  angle: number;
}

/** Material knobs exposed by the paper-render module. */
export interface Material {
  /** Paper base colour, #rrggbb. */
  tint: string;
  /** 0 = opaque, 1 = translucent, 2 = vellum. */
  translucency: number;
  /** Key light azimuth in degrees; 0 = +X, 90 = +Y. */
  azimuth: number;
  /** Key light elevation in degrees above the sheet plane. */
  elevation: number;
  /** Fibre grain strength 0..1. */
  fiber: number;
  /** Strength of the warm bounce/ambient term 0..1. */
  ambient: number;
}

/** Timeline settings. */
export interface TimelineSettings {
  /** Seconds. */
  duration: number;
  loop: boolean;
  /** Playback rate multiplier, 0.25..3. */
  speed: number;
}

export interface SheetSettings {
  /** Sheet side length in world units; the sheet always spans [-size/2, size/2]²... stored as full side. */
  size: number;
}

export interface OrigamiDoc {
  version: 1;
  name: string;
  sheet: SheetSettings;
  creases: Crease[];
  /** Keyframes grouped by crease id. */
  keyframes: Record<string, Keyframe[]>;
  material: Material;
  timeline: TimelineSettings;
}

export const MAX_CREASES = 32;

/** A resolved crease after extension/splitting at junctions. */
export interface ResolvedCrease {
  id: string;
  type: FoldType;
  /** Full chord in sheet space after resolution. */
  a: Vec2;
  b: Vec2;
  /** Set when the drawn crease was extended or clipped. */
  adjusted: boolean;
  /** Split points along a→b, ascending parameter, includes both ends. */
  points: Vec2[];
}

/** A planar face of the crease arrangement. */
export interface Face {
  index: number;
  /** CCW polygon in sheet space, no repeated/collinear points. */
  polygon: Vec2[];
  area: number;
  /** Parent face in the hinge tree, -1 for the root. */
  parent: number;
  /** Hinge to the parent, if any. */
  hinge: Hinge | null;
  depth: number;
}

export interface Hinge {
  /** Hinge endpoints in sheet space (the shared crease segment). */
  a: Vec2;
  b: Vec2;
  creaseId: string;
  foldType: FoldType;
  /**
   * Sign applied to the animated angle so that a positive angle always folds
   * the child the way its mountain/valley type says, whatever side of the
   * hinge the child's centroid happens to lie on.
   */
  foldSign: number;
}

/** An interior edge of the arrangement (one crease segment between two faces). */
export interface HingeEdge {
  creaseId: string;
  a: Vec2;
  b: Vec2;
  faceL: number;
  faceR: number;
  /** Index into the face tree, or -1 when the edge closes a cycle. */
  treeChild: number;
}

export interface Diagnostics {
  faceCount: number;
  hingeCount: number;
  cycleEdges: number;
  cycleCreases: string[];
  /** Vertices where an odd number of creases meet (Maekawa's theorem check). */
  maekawaViolations: number;
  /** Number of interior vertices in the arrangement. */
  interiorVertices: number;
  /** Creases that touch no other crease at either end (isolated chords). */
  isolatedCreases: string[];
}

/** Everything derived from the crease list; rebuilt only when creases change. */
export interface Topology {
  faces: Face[];
  creases: ResolvedCrease[];
  hingeEdges: HingeEdge[];
  diagnostics: Diagnostics;
  rootFace: number;
  /** Sheet half extent (world units). */
  half: number;
}

/** Diagnostics surfaced to the user, pre-flattened. */
export interface DiagnosticsInfo {
  faces: number;
  hinges: number;
  cycles: number;
  cycleCreases: string[];
  maekawa: number;
  isolated: string[];
}

export const DEFAULT_MATERIAL: Material = {
  tint: '#f3e7d3',
  translucency: 1,
  azimuth: 38,
  elevation: 52,
  fiber: 0.55,
  ambient: 0.6,
};

export const DEFAULT_TIMELINE: TimelineSettings = {
  duration: 4,
  loop: true,
  speed: 1,
};
