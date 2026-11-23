import { MAX_MASSES } from './types';
import type { MassPoint, StreamParams, TraceDirection, ComputeResult } from './types';
import { StreamlineClient, CancelledError } from '../workers/streamlineClient';

export type PageId = 'edit' | 'generate' | 'results';

export interface ComputeStats {
  lineCount: number;
  pointCount: number;
  truncated: boolean;
  elapsedMs: number;
  fps: number;
  computing: boolean;
}

/**
 * Global reactive state. In Svelte 5, `$state` at module scope in a
 * `.svelte.ts` file is the reliable reactivity source across components and
 * dynamic imports; class-instance `$state` fields do not survive a module
 * singleton boundary.
 */
export const appState = $state({
  page: 'edit' as PageId,
  masses: [] as MassPoint[],
  params: {
    seedDensity: 2,
    stepSize: 0.12,
    maxLength: 60,
    direction: 'bidirectional' as TraceDirection
  } as StreamParams,
  smoothMode: false,
  result: null as ComputeResult | null,
  stats: {
    lineCount: 0,
    pointCount: 0,
    truncated: false,
    elapsedMs: 0,
    fps: 0,
    computing: false
  } as ComputeStats,
  highlightedLine: -1,
  resultVersion: 0,
  editDirty: false
});

// ---- non-reactive internals (module-level, never rendered) ----
let nextMassId = 1;
const client = new StreamlineClient(2);
let dragTimer: ReturnType<typeof setTimeout> | null = null;
let lastSubmit = 0;

// ------------------------------------------------------------ mass editing

export function addMass(x: number, z: number, mass = 50): number | null {
  if (appState.masses.length >= MAX_MASSES) return null;
  const id = nextMassId++;
  appState.masses.push({ id, x, z, mass });
  appState.editDirty = true;
  return id;
}

export function removeMass(id: number): void {
  appState.masses = appState.masses.filter((m) => m.id !== id);
  appState.editDirty = true;
}

export function updateMass(id: number, patch: Partial<MassPoint>): void {
  const m = appState.masses.find((mm) => mm.id === id);
  if (!m) return;
  Object.assign(m, patch);
  appState.editDirty = true;
}

export function clearMasses(): void {
  appState.masses = [];
  appState.editDirty = true;
}

export function loadPreset(kind: 'binary' | 'triple' | 'ring' | 'single'): void {
  const masses: MassPoint[] = [];
  let id = 1;
  const add = (x: number, z: number, mass: number) => {
    masses.push({ id: id++, x, z, mass });
  };
  switch (kind) {
    case 'single':
      add(0, 0, 120);
      break;
    case 'binary':
      add(-3.2, 0, 80);
      add(3.2, 0, 80);
      break;
    case 'triple':
      add(-4, -2.5, 60);
      add(4, -2.5, 60);
      add(0, 4, 90);
      break;
    case 'ring':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(Math.cos(a) * 5.5, Math.sin(a) * 5.5, 45);
      }
      break;
  }
  appState.masses = masses;
  nextMassId = id;
  appState.editDirty = true;
}

export function setDirection(direction: TraceDirection): void {
  appState.params.direction = direction;
}

// ------------------------------------------------------------- computation

/**
 * Recompute while a mass is being dragged. Coalesces bursts into one
 * submission every ~55 ms so the worker pool is never flooded and the
 * render thread keeps its frame budget (>= 20 fps target).
 */
export function scheduleInteractiveCompute(): void {
  if (appState.masses.length === 0) return;
  if (dragTimer !== null) return;
  const wait = Math.max(0, 55 - (performance.now() - lastSubmit));
  dragTimer = setTimeout(() => {
    dragTimer = null;
    void compute(true);
  }, wait);
}

export function endInteraction(): void {
  if (dragTimer !== null) {
    clearTimeout(dragTimer);
    dragTimer = null;
  }
  void compute(false);
}

export async function compute(interactive: boolean): Promise<void> {
  if (appState.masses.length === 0) {
    appState.result = null;
    appState.resultVersion++;
    appState.stats.lineCount = 0;
    appState.stats.pointCount = 0;
    return;
  }
  lastSubmit = performance.now();
  appState.stats.computing = true;
  try {
    const result = await client.submit({
      masses: appState.masses.map((m) => ({ ...m })),
      params: { ...appState.params },
      interactive
    });
    appState.result = result;
    appState.resultVersion++;
    appState.stats.lineCount = result.lineCount;
    appState.stats.pointCount = result.pointCount;
    appState.stats.truncated = result.truncated;
    appState.stats.elapsedMs = result.elapsedMs;
    appState.highlightedLine = -1;
    appState.editDirty = false;
  } catch (err) {
    if (!(err instanceof CancelledError)) throw err;
  } finally {
    appState.stats.computing = false;
  }
}

export function disposeApp(): void {
  client.dispose();
}
