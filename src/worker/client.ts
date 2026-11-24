import type { BaseShapeId, PrecisionId, Stroke } from '../core/types';
import type { EngineStats } from '../core/engine';
import type { RenderMesh } from '../core/mesh';

export interface BuildResponse {
  id: number;
  ok: boolean;
  render?: RenderMesh;
  stats?: EngineStats;
  changed?: { min: [number, number, number]; max: [number, number, number] } | null;
  error?: string;
}

type Pending = {
  resolve: (r: BuildResponse) => void;
  reject: (e: Error) => void;
};

/**
 * 单实例几何 worker。请求串行执行 (worker 本身是单线程), 只保留最新排队的
 * 请求 —— 快速拖动时旧请求被丢弃, 保证交互跟手。
 */
export class GeometryClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private queued: { msg: any; resolve: (r: BuildResponse) => void; reject: (e: Error) => void } | null = null;
  private inFlight = 0;

  private ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL('../worker/geometry.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<BuildResponse>) => {
      const p = this.pending.get(e.data.id);
      if (p) {
        this.pending.delete(e.data.id);
        this.inFlight--;
        if (e.data.ok) p.resolve(e.data);
        else p.reject(new Error(e.data.error ?? '重建失败'));
      }
      this.drain();
    };
    this.worker.onerror = (ev) => {
      const err = new Error(`几何 worker 出错: ${ev.message}`);
      for (const [, p] of this.pending) p.reject(err);
      this.pending.clear();
      this.inFlight = 0;
    };
  }

  private drain() {
    if (this.inFlight > 0) return;
    const q = this.queued;
    if (!q) return;
    this.queued = null;
    this.inFlight++;
    this.pending.set(q.msg.id, { resolve: q.resolve, reject: q.reject });
    this.worker!.postMessage(q.msg);
  }

  private send(create: (id: number) => any, transfer: Transferable[] = []): Promise<BuildResponse> {
    this.ensure();
    const id = ++this.seq;
    const msg = create(id);
    return new Promise<BuildResponse>((resolve, reject) => {
      if (this.inFlight > 0) {
        // 已有请求在跑: 丢弃此前排队的那一个 (它已经过期)
        this.queued?.reject(new Error('superseded'));
        this.queued = { msg, resolve, reject };
      } else {
        this.inFlight++;
        this.pending.set(id, { resolve, reject });
        this.worker!.postMessage(msg, transfer);
      }
    });
  }

  build(base: BaseShapeId, strokes: Stroke[], precision: PrecisionId) {
    return this.send((id) => ({ id, kind: 'build', base, strokes, precision }));
  }

  clean() {
    return this.send((id) => ({ id, kind: 'export' }));
  }

  /** 等待当前所有工作结束 (导出前用于确保几何最新) */
  async idle() {
    while (this.inFlight > 0 || this.queued) {
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}
