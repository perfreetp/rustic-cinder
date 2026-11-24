import type {
  Crease,
  Keyframe,
  Material,
  OrigamiDoc,
  TimelineSettings,
} from './types';
import { DEFAULT_MATERIAL, DEFAULT_TIMELINE, MAX_CREASES } from './types';

/**
 * Document store with undo/redo.
 *
 * Every mutation goes through `mutate()`, which snapshots the document into
 * the undo stack. The store is deliberately framework-free: Web Components
 * subscribe with `subscribe()` and re-read what they need, and the renderer
 * gets a `change` event it can coalesce against.
 */

export type DocListener = (doc: OrigamiDoc, meta: { reason: string }) => void;

/**
 * Id generation.
 *
 * Ids must be unique across everything that can land in a document, including
 * imported files whose ids we did not mint. A plain counter would hand out
 * `c1` to the second crease in a document that already contains `c1`, and the
 * per-crease keyframe bucket would silently overwrite the real one — so the
 * store checks candidates against the live document instead of trusting a
 * counter. The counter still makes ids readable and stable within a session.
 */
let nextId = 1;
export const newId = (prefix: string): string => `${prefix}${nextId++}`;

export function cloneDoc(doc: OrigamiDoc): OrigamiDoc {
  return {
    ...doc,
    sheet: { ...doc.sheet },
    creases: doc.creases.map((c) => ({ ...c, a: { ...c.a }, b: { ...c.b } })),
    keyframes: Object.fromEntries(
      Object.entries(doc.keyframes).map(([k, list]) => [k, list.map((f) => ({ ...f }))]),
    ),
    material: { ...doc.material },
    timeline: { ...doc.timeline },
  };
}

export function emptyDoc(name = '未命名折序'): OrigamiDoc {
  return {
    version: 1,
    name,
    sheet: { size: 2 },
    creases: [],
    keyframes: {},
    material: { ...DEFAULT_MATERIAL },
    timeline: { ...DEFAULT_TIMELINE },
  };
}

export class DocStore {
  private doc: OrigamiDoc;
  private undoStack: OrigamiDoc[] = [];
  private redoStack: OrigamiDoc[] = [];
  private listeners = new Set<DocListener>();
  private readonly limit = 80;

  constructor(doc: OrigamiDoc = emptyDoc()) {
    this.doc = doc;
  }

  get current(): OrigamiDoc {
    return this.doc;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  subscribe(fn: DocListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(reason: string): void {
    for (const fn of this.listeners) fn(this.doc, { reason });
  }

  /** Replace the document wholesale (load, reset), clearing history. */
  replace(doc: OrigamiDoc, reason = 'replace'): void {
    this.doc = cloneDoc(doc);
    this.undoStack = [];
    this.redoStack = [];
    this.emit(reason);
  }

  /**
   * Apply a mutation. Set `history: false` for continuous gestures (drags,
   * sliders) that the caller has already bracketed with `beginGesture()`.
   */
  mutate(reason: string, fn: (doc: OrigamiDoc) => void, history = true): void {
    if (history) {
      this.undoStack.push(cloneDoc(this.doc));
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
    }
    fn(this.doc);
    this.emit(reason);
  }

  /**
   * Coalesce a gesture: snapshot once at the start, then mutate with
   * `history: false` until `endGesture()`. If nothing actually changed, the
   * snapshot is dropped so undo doesn't get a no-op entry.
   */
  private gestureSnapshot: OrigamiDoc | null = null;

  beginGesture(): void {
    this.gestureSnapshot = cloneDoc(this.doc);
  }

  endGesture(reason = 'gesture'): void {
    if (!this.gestureSnapshot) return;
    const before = JSON.stringify(this.gestureSnapshot);
    const after = JSON.stringify(this.doc);
    if (before !== after) {
      this.undoStack.push(this.gestureSnapshot);
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
      this.emit(reason);
    }
    this.gestureSnapshot = null;
  }

  cancelGesture(): void {
    if (!this.gestureSnapshot) return;
    this.doc = this.gestureSnapshot;
    this.gestureSnapshot = null;
    this.emit('cancel-gesture');
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(cloneDoc(this.doc));
    this.doc = prev;
    this.emit('undo');
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(cloneDoc(this.doc));
    this.doc = next;
    this.emit('redo');
    return true;
  }

  // -- domain helpers -------------------------------------------------------

  /** Mint an id that collides with nothing already in the document. */
  private freshId(prefix: string): string {
    const taken = new Set<string>([
      ...this.doc.creases.map((c) => c.id),
      ...Object.keys(this.doc.keyframes),
      ...Object.values(this.doc.keyframes).flatMap((list) => list.map((k) => k.id)),
    ]);
    let id = newId(prefix);
    while (taken.has(id)) id = newId(prefix);
    return id;
  }

  addCrease(crease: Omit<Crease, 'id' | 'slot'>): Crease | null {
    if (this.doc.creases.length >= MAX_CREASES) return null;
    const slot = this.nextSlot();
    const full: Crease = { ...crease, id: this.freshId('c'), slot };
    this.mutate('add-crease', (doc) => {
      doc.creases.push(full);
      doc.keyframes[full.id] = [];
    });
    return full;
  }

  private nextSlot(): number {
    const used = new Set(this.doc.creases.map((c) => c.slot));
    for (let i = 0; i < MAX_CREASES; i++) if (!used.has(i)) return i;
    return this.doc.creases.length % MAX_CREASES;
  }

  removeCrease(id: string): void {
    this.mutate('remove-crease', (doc) => {
      doc.creases = doc.creases.filter((c) => c.id !== id);
      delete doc.keyframes[id];
    });
  }

  updateCrease(id: string, patch: Partial<Omit<Crease, 'id'>>, history = true): void {
    this.mutate(
      'update-crease',
      (doc) => {
        const c = doc.creases.find((x) => x.id === id);
        if (c) Object.assign(c, patch);
      },
      history,
    );
  }

  clearCreases(): void {
    this.mutate('clear-creases', (doc) => {
      doc.creases = [];
      doc.keyframes = {};
    });
  }

  addKeyframe(creaseId: string, time: number, angle: number): void {
    this.mutate('add-keyframe', (doc) => {
      const list = doc.keyframes[creaseId] ?? (doc.keyframes[creaseId] = []);
      const existing = list.find((k) => Math.abs(k.time - time) < 0.02);
      if (existing) {
        existing.angle = angle;
      } else {
        list.push({ id: this.freshId('k'), time, angle });
        list.sort((a, b) => a.time - b.time);
      }
    });
  }

  moveKeyframe(creaseId: string, keyId: string, time: number, angle?: number, history = true): void {
    this.mutate(
      'move-keyframe',
      (doc) => {
        const list = doc.keyframes[creaseId];
        if (!list) return;
        const k = list.find((x) => x.id === keyId);
        if (!k) return;
        k.time = Math.max(0, Math.min(doc.timeline.duration, time));
        if (angle !== undefined) k.angle = angle;
        list.sort((a, b) => a.time - b.time);
      },
      history,
    );
  }

  removeKeyframe(creaseId: string, keyId: string): void {
    this.mutate('remove-keyframe', (doc) => {
      const list = doc.keyframes[creaseId];
      if (!list) return;
      doc.keyframes[creaseId] = list.filter((k) => k.id !== keyId);
    });
  }

  setMaterial(patch: Partial<Material>, history = true): void {
    this.mutate('material', (doc) => Object.assign(doc.material, patch), history);
  }

  setTimeline(patch: Partial<TimelineSettings>, history = true): void {
    this.mutate('timeline', (doc) => Object.assign(doc.timeline, patch), history);
  }

  setName(name: string): void {
    this.mutate('name', (doc) => {
      doc.name = name;
    });
  }

  keyframesOf(id: string): Keyframe[] {
    return this.doc.keyframes[id] ?? [];
  }
}
