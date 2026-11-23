/// <reference lib="webworker" />
import type { ComputeRequest, ComputeResult } from '../lib/types';
import { computeStreamlines } from '../lib/streamlineEngine';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<ComputeRequest>) => {
  const req = ev.data;
  // Abort checks matter when several requests queue up on one worker:
  // the pool normally terminates stale workers, this is the belt-and-braces path.
  const result: ComputeResult = computeStreamlines(req, () => false);
  ctx.postMessage(
    result,
    [
      result.positions.buffer,
      result.magnitudes.buffer,
      result.directions.buffer,
      result.lineStarts.buffer,
      result.lineCounts.buffer
    ]
  );
};
