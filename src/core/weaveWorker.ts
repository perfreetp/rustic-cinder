/// <reference lib="webworker" />
import type {
  ProfileSampleRequest,
  ProfileSampleResponse,
  WeaveRequest,
  WeaveResponse,
  WorkerRequest,
  WorkerResponse,
} from './types.ts';
import { sampleProfileCurve } from './spline.ts';
import { buildWeave } from './weave.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function transferListOf(resp: WorkerResponse): Transferable[] {
  if ('familyA' in resp) {
    const lists: Transferable[] = [];
    for (const fam of [resp.familyA, resp.familyB]) {
      lists.push(
        fam.positions.buffer,
        fam.normals.buffer,
        fam.uvs.buffer,
        fam.outerIndices.buffer,
        fam.innerIndices.buffer,
      );
    }
    return lists;
  }
  return [];
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if ('weave' in req) {
      const w = req as WeaveRequest;
      const built = buildWeave(w.profile, w.weave, w.segments);
      const resp: WeaveResponse = {
        requestId: w.requestId,
        familyA: built.familyA,
        familyB: built.familyB,
        stats: built.stats,
      };
      ctx.postMessage(resp, transferListOf(resp));
    } else {
      const p = req as ProfileSampleRequest;
      const samples = sampleProfileCurve(p.profile.points, p.profile.samples).map((q) => ({ r: q.r, z: q.z }));
      const resp: ProfileSampleResponse = { requestId: p.requestId, samples };
      ctx.postMessage(resp);
    }
  } catch (err) {
    ctx.postMessage({ requestId: req.requestId, error: err instanceof Error ? err.message : String(err) });
  }
};
