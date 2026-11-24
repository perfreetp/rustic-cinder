import { buildTopology, type BuildOptions } from '../core/arrangement';
import { DocStore } from '../core/doc';
import type { DiagnosticsInfo, OrigamiDoc, Topology } from '../core/types';
import {
  buildCurve,
  sampleAngles,
  advanceTime,
  type KeyframeCurve,
} from '../core/timeline';
import {
  assembleMesh,
  buildMeshTemplate,
  createMeshBuffers,
  solveFold,
  type FoldTransforms,
  type MeshBuffers,
  type MeshTemplate,
} from '../core/fold';

/**
 * Studio controller.
 *
 * Owns the document, the derived caches (topology, keyframe curve, mesh
 * template) and the playhead. Everything below the Web Components sits here so
 * that the render loop can read consistent state and the panels never talk to
 * each other directly.
 *
 * Caching policy: the topology is only rebuilt when the crease set changes,
 * the curve only when keyframes/creases change, and the mesh template only when
 * the topology changes. Scrubbing and playback therefore never re-run the
 * arrangement or re-upload geometry — they only re-solve transforms and rewrite
 * the vertex stream.
 */

export type PlayState = 'stopped' | 'playing';

export interface StudioEvents {
  doc: { reason: string };
  topology: { diagnostics: DiagnosticsInfo };
  time: { time: number; playing: boolean };
  play: { playing: boolean };
  selection: { creaseId: string | null };
  mode: { mode: ViewMode };
  /** Fired whenever the 3D scene needs a redraw. */
  invalidate: void;
}

export type ViewMode = 'flat' | 'solid';

type Listener<K extends keyof StudioEvents> = (payload: StudioEvents[K]) => void;

export class Studio {
  readonly store: DocStore;
  readonly topologyCache = new Map<string, Topology>();

  private listeners: { [K in keyof StudioEvents]?: Set<Listener<K>> } = {};

  private _topology: Topology | null = null;
  private _topologyKey = '';
  private _curve: KeyframeCurve | null = null;
  private _curveKey = '';
  private _template: MeshTemplate | null = null;
  private _buffers: MeshBuffers | null = null;
  private _transforms: FoldTransforms | null = null;

  private _time = 0;
  private _playing: PlayState = 'stopped';
  private _selected: string | null = null;
  private _mode: ViewMode = 'solid';

  private rafId = 0;
  private lastTs = 0;
  /** Last measured frame interval, for the stats readout. */
  frameMs = 16.7;
  private frameSamples: number[] = [];

  /** Anchor face for the hinge tree: bottom-left quadrant by default. */
  private anchor = { x: -0.5, y: -0.5 };

  constructor(doc?: OrigamiDoc) {
    this.store = new DocStore(doc);
    this.store.subscribe((_, meta) => {
      this.invalidateDerived();
      this.emit('doc', { reason: meta.reason });
      this.emit('invalidate', undefined);
    });
    this.refreshDerived();
  }

  // -- events ---------------------------------------------------------------

  on<K extends keyof StudioEvents>(key: K, fn: Listener<K>): () => void {
    let set = this.listeners[key] as Set<Listener<K>> | undefined;
    if (!set) {
      set = new Set();
      this.listeners[key] = set as never;
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  private emit<K extends keyof StudioEvents>(key: K, payload: StudioEvents[K]): void {
    const set = this.listeners[key] as Set<Listener<K>> | undefined;
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  // -- derived state --------------------------------------------------------

  get doc(): OrigamiDoc {
    return this.store.current;
  }

  get topology(): Topology {
    return this._topology!;
  }

  get curve(): KeyframeCurve {
    return this._curve!;
  }

  get template(): MeshTemplate {
    return this._template!;
  }

  get buffers(): MeshBuffers {
    return this._buffers!;
  }

  get transforms(): FoldTransforms {
    return this._transforms!;
  }

  get time(): number {
    return this._time;
  }

  get playing(): boolean {
    return this._playing === 'playing';
  }

  get selectedCreaseId(): string | null {
    return this._selected;
  }

  get mode(): ViewMode {
    return this._mode;
  }

  setMode(mode: ViewMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    this.emit('mode', { mode });
    this.emit('invalidate', undefined);
  }

  select(creaseId: string | null): void {
    if (this._selected === creaseId) return;
    this._selected = creaseId;
    this.emit('selection', { creaseId });
    this.emit('invalidate', undefined);
  }

  get diagnostics(): DiagnosticsInfo {
    const d = this.topology.diagnostics;
    return {
      faces: d.faceCount,
      hinges: d.hingeCount,
      cycles: d.cycleEdges,
      cycleCreases: d.cycleCreases,
      maekawa: d.maekawaViolations,
      isolated: d.isolatedCreases,
    };
  }

  /**
   * Rebuild caches as needed after any document change.
   *
   * `refreshDerived` compares content keys, so it is already a no-op when the
   * change did not touch crease geometry or keyframes — no reason string needs
   * to tell it which. A material tweak, for instance, leaves both keys intact
   * and costs one string compare.
   */
  private invalidateDerived(): void {
    this.refreshDerived();
  }

  /** Rebuild whichever caches are stale. Cheap when nothing changed. */
  refreshDerived(): void {
    const doc = this.doc;
    const topologyKey = JSON.stringify({
      c: doc.creases.map((c) => [c.id, c.a.x, c.a.y, c.b.x, c.b.y, c.type]),
      s: doc.sheet.size,
      a: this.anchor,
    });
    if (topologyKey !== this._topologyKey) {
      this._topologyKey = topologyKey;
      const opts: BuildOptions = { anchor: this.anchor };
      this._topology = buildTopology(
        doc.creases.map((c) => ({ ...c })),
        doc.sheet.size / 2,
        opts,
      );
      this._template = buildMeshTemplate(this._topology);
      this._buffers = createMeshBuffers(this._template);
      this._curveKey = '';
      this.emit('topology', { diagnostics: this.diagnostics });
    }

    const curveKey = JSON.stringify({
      c: doc.creases.map((c) => [c.id, c.angle]),
      k: doc.keyframes,
      d: doc.timeline.duration,
    });
    if (curveKey !== this._curveKey) {
      this._curveKey = curveKey;
      this._curve = buildCurve(doc.creases, doc.keyframes, doc.timeline);
    }
  }

  // -- playback -------------------------------------------------------------

  seek(time: number, notify = true): void {
    const d = this.doc.timeline.duration;
    const t = Math.max(0, Math.min(d, time));
    if (Math.abs(t - this._time) < 1e-9 && notify) return;
    this._time = t;
    this.solveAt(t);
    if (notify) this.emit('time', { time: t, playing: this.playing });
    this.emit('invalidate', undefined);
  }

  play(): void {
    if (this._playing === 'playing') return;
    if (!this.doc.timeline.loop && this._time >= this.doc.timeline.duration - 1e-4) {
      this._time = 0;
    }
    this._playing = 'playing';
    this.lastTs = 0;
    this.emit('play', { playing: true });
    this.emit('time', { time: this._time, playing: true });
    this.startLoop();
  }

  pause(): void {
    if (this._playing === 'stopped') return;
    this._playing = 'stopped';
    this.stopLoop();
    this.emit('play', { playing: false });
    this.emit('time', { time: this._time, playing: false });
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private startLoop(): void {
    this.stopLoop();
    const tick = (ts: number) => {
      if (this._playing !== 'playing') return;
      if (this.lastTs === 0) this.lastTs = ts;
      const dt = Math.min((ts - this.lastTs) / 1000, 0.1);
      this.lastTs = ts;

      const settings = this.doc.timeline;
      const next = advanceTime(this._time, dt, settings);
      const atEnd = !settings.loop && this._time >= settings.duration - 1e-4;
      this._time = next;
      this.solveAt(next);
      this.emit('time', { time: next, playing: true });
      this.emit('invalidate', undefined);

      if (atEnd) {
        this.pause();
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  // -- solving --------------------------------------------------------------

  private solveAt(t: number): void {
    if (!this._curve || !this._topology || !this._template || !this._buffers) return;
    const angles = sampleAngles(this._curve, t);
    const tf = solveFold(this._topology, angles);
    assembleMesh(this._template, tf, this._buffers);
    this._transforms = tf;
  }

  /** Current crease angles in degrees. */
  anglesAt(t = this._time): Map<string, number> {
    return sampleAngles(this.curve, t);
  }

  /** Called by the render loop with the frame time for the stats readout. */
  noteFrame(dtMs: number): void {
    this.frameSamples.push(dtMs);
    if (this.frameSamples.length > 60) this.frameSamples.shift();
    this.frameMs =
      this.frameSamples.reduce((s, v) => s + v, 0) / this.frameSamples.length;
  }

  get fps(): number {
    return 1000 / Math.max(0.5, this.frameMs);
  }
}
