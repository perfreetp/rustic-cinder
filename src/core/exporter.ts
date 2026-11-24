/**
 * Export (module 4: 导出).
 *
 * The export is a single self-describing JSON file: the crease list, keyframes,
 * timeline settings, material parameters and sheet settings, plus a small header
 * with schema version, units and the resolved build summary. That is everything
 * a future importer — or another tool — needs to reproduce the sequence exactly.
 *
 * An optional "baked samples" section samples every crease's interpolated angle
 * at a fixed step, so a consumer that does not implement the Hermite solver can
 * still replay the motion faithfully.
 */

import {
  buildCurve,
  bakeSamples,
} from './timeline';
import type { OrigamiDoc, Topology } from './types';

export interface ExportOptions {
  /** Sample every crease's angle at `sampleHz` and embed the table. */
  includeSamples: boolean;
  sampleHz: number;
}

export interface ExportPayload {
  schema: 'zhexu.sequence';
  version: 1;
  generator: string;
  createdAt: string;
  name: string;
  units: { length: 'sheet-normalised'; angle: 'degree'; time: 'second' };
  sheet: { size: number };
  timeline: { duration: number; loop: boolean; speed: number };
  creases: {
    id: string;
    slot: number;
    type: string;
    a: { x: number; y: number };
    b: { x: number; y: number };
    staticAngle: number;
    keyframes: { time: number; angle: number }[];
  }[];
  material: Record<string, unknown>;
  build: {
    faces: number;
    hinges: number;
    cycleEdges: number;
    diagnostics: Record<string, unknown>;
  };
  samples?: { hz: number; step: number; frames: { time: number; angles: Record<string, number> }[] };
}

export function buildExportPayload(
  doc: OrigamiDoc,
  topology: Topology,
  options: ExportOptions,
): ExportPayload {
  const payload: ExportPayload = {
    schema: 'zhexu.sequence',
    version: 1,
    generator: '折序 Origami Sequence Studio',
    createdAt: new Date().toISOString(),
    name: doc.name,
    units: { length: 'sheet-normalised', angle: 'degree', time: 'second' },
    sheet: { size: doc.sheet.size },
    timeline: {
      duration: doc.timeline.duration,
      loop: doc.timeline.loop,
      speed: doc.timeline.speed,
    },
    creases: doc.creases.map((c) => ({
      id: c.id,
      slot: c.slot,
      type: c.type,
      a: { x: round(c.a.x), y: round(c.a.y) },
      b: { x: round(c.b.x), y: round(c.b.y) },
      staticAngle: c.angle,
      keyframes: (doc.keyframes[c.id] ?? [])
        .slice()
        .sort((a, b) => a.time - b.time)
        .map((k) => ({ time: round(k.time), angle: round(k.angle) })),
    })),
    material: { ...doc.material },
    build: {
      faces: topology.faces.length,
      hinges: topology.hingeEdges.length,
      cycleEdges: topology.diagnostics.cycleEdges,
      diagnostics: {
        maekawaViolations: topology.diagnostics.maekawaViolations,
        interiorVertices: topology.diagnostics.interiorVertices,
        adjustedCreases: topology.creases.filter((c) => c.adjusted).map((c) => c.id),
      },
    },
  };

  if (options.includeSamples) {
    const curve = buildCurve(doc.creases, doc.keyframes, doc.timeline);
    const step = 1 / Math.max(1, options.sampleHz);
    const frames = bakeSamples(curve, doc.timeline.duration, step).map((f) => ({
      time: round(f.time, 4),
      angles: Object.fromEntries(Object.entries(f.angles).map(([id, v]) => [id, round(v)])),
    }));
    payload.samples = { hz: options.sampleHz, step: round(step, 5), frames };
  }

  return payload;
}

export function exportFilename(doc: OrigamiDoc, ext = 'json'): string {
  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
  const base = (doc.name || '折序').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 48);
  return `${base}_${date}.${ext}`;
}

/** Trigger a browser download of a text payload. */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Parse and validate an imported document; throws on a bad file. */
export function parseImportedDoc(text: string): OrigamiDoc {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== 'object') throw new Error('文件不是有效的 JSON 对象');
  const obj = raw as Record<string, unknown>;

  if (obj.schema === 'zhexu.sequence') {
    return normalizeImported(obj);
  }
  if (obj.version === 1 && Array.isArray(obj.creases)) {
    return normalizeImported(obj as Record<string, unknown>);
  }
  throw new Error('无法识别的文件格式（需要折序导出的序列文件）');
}

function normalizeImported(obj: Record<string, unknown>): OrigamiDoc {
  const material = (obj.material ?? {}) as Record<string, unknown>;
  const timeline = (obj.timeline ?? {}) as Record<string, unknown>;
  const sheet = (obj.sheet ?? {}) as Record<string, unknown>;
  const creases = (obj.creases ?? []) as Array<Record<string, unknown>>;

  const keyframes: OrigamiDoc['keyframes'] = {};
  for (const c of creases) {
    const id = String(c.id);
    const list = Array.isArray(c.keyframes) ? (c.keyframes as Array<Record<string, unknown>>) : [];
    keyframes[id] = list.map((k, i) => ({
      id: `k${i}`,
      time: Number(k.time) || 0,
      angle: Number(k.angle) || 0,
    }));
  }

  return {
    version: 1,
    name: String(obj.name ?? '导入的折序'),
    sheet: { size: Number(sheet.size) || 2 },
    creases: creases.map((c, i) => ({
      id: String(c.id ?? `c${i}`),
      a: (c.a as { x: number; y: number }) ?? { x: 0, y: 0 },
      b: (c.b as { x: number; y: number }) ?? { x: 1, y: 0 },
      type: c.type === 'mountain' ? 'mountain' : 'valley',
      angle: Number(c.staticAngle ?? c.angle) || 0,
      slot: Number(c.slot ?? i) % 32,
    })),
    keyframes,
    material: {
      tint: String(material.tint ?? '#f3e7d3'),
      translucency: clampGrade(Number(material.translucency ?? 1)),
      azimuth: Number(material.azimuth ?? 38),
      elevation: Number(material.elevation ?? 52),
      fiber: Number(material.fiber ?? 0.55),
      ambient: Number(material.ambient ?? 0.6),
    },
    timeline: {
      duration: Math.max(0.2, Number(timeline.duration) || 4),
      loop: timeline.loop !== false,
      speed: Number(timeline.speed) || 1,
    },
  };
}

function clampGrade(v: number): number {
  return Math.max(0, Math.min(2, Math.round(v)));
}

function round(v: number, digits = 4): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}
