/**
 * 几何 worker: 只做消息路由 + WASM 加载。真正的重建逻辑在 core/engine.ts,
 * 因此同一套代码可以在 node 里离线跑一致性测试。
 */

import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { SculptEngine } from '../core/engine';
import type { BaseShapeId, PrecisionId, Stroke } from '../core/types';

let engine: SculptEngine | null = null;

const ready: Promise<void> = (async () => {
  const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
  const mod = await (Module as any)({ wasmBinary });
  mod.setup();
  engine = new SculptEngine({ Manifold: mod.Manifold });
})();

interface BuildMsg {
  id: number;
  kind: 'build';
  base: BaseShapeId;
  strokes: Stroke[];
  precision: PrecisionId;
}
interface ExportMsg {
  id: number;
  kind: 'export';
}
type Msg = BuildMsg | ExportMsg;

function post(msg: any, transfer: Transferable[] = []) {
  (self as any).postMessage(msg, transfer);
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const req = e.data;
  try {
    await ready;
    if (req.kind === 'build') {
      const res = engine!.rebuild(req.base, req.strokes, req.precision);
      const r = res.render;
      post({ id: req.id, ok: true, render: r, stats: res.stats, changed: res.changed }, [
        r.positions.buffer,
        r.normals.buffer,
        r.indices.buffer,
      ]);
    } else if (req.kind === 'export') {
      // 清理走引擎 (manifold 合并顶点 + 折痕法线), 保证导出网格是 2-流形
      const cleaned = engine!.cleanForExport();
      if (!cleaned) throw new Error('没有可导出的网格');
      post({ id: req.id, ok: true, render: cleaned }, [
        cleaned.positions.buffer,
        cleaned.normals.buffer,
        cleaned.indices.buffer,
      ]);
    }
  } catch (err: any) {
    post({ id: (req as any)?.id, ok: false, error: String(err?.message ?? err) });
  }
};
