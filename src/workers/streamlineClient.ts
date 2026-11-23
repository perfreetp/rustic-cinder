import type { ComputeRequest, ComputeResult } from '../lib/types';
import StreamlineWorker from './streamline.worker?worker';

interface Pending {
  msgId: number;
  resolve: (r: ComputeResult) => void;
  reject: (e: Error) => void;
}

/**
 * Small worker pool (2 workers). A newer request supersedes any in-flight
 * computation: stale workers are terminated and respawned, so while the user
 * drags a mass point every frame can kick off a fresh recompute without
 * queueing behind old work.
 */
export class StreamlineClient {
  private workers: Worker[] = [];
  private busy = [false, false];
  private current: Pending | null = null;
  private nextId = 1;

  constructor(poolSize = 2) {
    for (let i = 0; i < poolSize; i++) this.workers.push(this.spawn(i));
  }

  private spawn(index: number): Worker {
    const w = new StreamlineWorker();
    w.onmessage = (ev: MessageEvent<ComputeResult>) => {
      this.busy[index] = false;
      const pending = this.current;
      this.current = null;
      if (pending && ev.data.msgId === pending.msgId) {
        pending.resolve(ev.data);
      }
      this.pump();
    };
    w.onerror = (ev) => {
      this.busy[index] = false;
      const pending = this.current;
      this.current = null;
      if (pending) pending.reject(new Error(ev.message || 'worker error'));
    };
    return w;
  }

  /** Cancel whatever is in flight (used when a newer request supersedes it). */
  cancel(): void {
    if (!this.current) return;
    const pending = this.current;
    this.current = null;
    for (let i = 0; i < this.workers.length; i++) {
      if (this.busy[i]) {
        this.workers[i].terminate();
        this.busy[i] = false;
        this.workers[i] = this.spawn(i);
      }
    }
    pending.reject(new CancelledError());
  }

  /**
   * Submit a compute request. Rejects with CancelledError if a later request
   * supersedes this one before it completes.
   */
  submit(req: Omit<ComputeRequest, 'msgId'>): Promise<ComputeResult> {
    if (this.current) this.cancel();
    const msgId = this.nextId++;
    return new Promise<ComputeResult>((resolve, reject) => {
      this.current = { msgId, resolve, reject };
      this.pendingRequest = { ...req, msgId };
      this.pump();
    });
  }

  private pendingRequest: ComputeRequest | null = null;

  private pump(): void {
    if (!this.current || !this.pendingRequest) return;
    const idx = this.busy.findIndex((b) => !b);
    if (idx < 0) return;
    const req = this.pendingRequest;
    this.pendingRequest = null;
    this.busy[idx] = true;
    this.workers[idx].postMessage(req);
  }

  dispose(): void {
    this.current = null;
    this.pendingRequest = null;
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}

export class CancelledError extends Error {
  constructor() {
    super('superseded');
    this.name = 'CancelledError';
  }
}
