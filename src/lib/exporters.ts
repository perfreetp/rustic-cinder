import type { ComputeResult, MassPoint, StreamParams } from './types';
import type { PathPoint } from './fieldScene';

export interface ExportPayload {
  schema: 'gravity-streamlines/1';
  exportedAt: string;
  domain: { halfExtent: number };
  massPoints: MassPoint[];
  params: StreamParams;
  summary: {
    lineCount: number;
    pointCount: number;
    truncated: boolean;
  };
  streamlines: {
    lineIndex: number;
    pointCount: number;
    points: {
      x: number;
      z: number;
      ax: number;
      az: number;
      magnitude: number;
    }[];
  }[];
}

/** Build the full JSON payload (all line vertices + field samples). */
export function buildExportPayload(
  result: ComputeResult,
  masses: MassPoint[],
  params: StreamParams
): ExportPayload {
  const lines: ExportPayload['streamlines'] = new Array(result.lineCount);
  for (let i = 0; i < result.lineCount; i++) {
    const start = result.lineStarts[i];
    const count = result.lineCounts[i];
    const points = new Array(count);
    for (let j = 0; j < count; j++) {
      const idx = start + j;
      points[j] = {
        x: result.positions[idx * 2],
        z: result.positions[idx * 2 + 1],
        ax: result.directions[idx * 2],
        az: result.directions[idx * 2 + 1],
        magnitude: result.magnitudes[idx]
      };
    }
    lines[i] = { lineIndex: i, pointCount: count, points };
  }
  return {
    schema: 'gravity-streamlines/1',
    exportedAt: new Date().toISOString(),
    domain: { halfExtent: 10 },
    massPoints: masses.map((m) => ({ ...m })),
    params: { ...params },
    summary: {
      lineCount: result.lineCount,
      pointCount: result.pointCount,
      truncated: result.truncated
    },
    streamlines: lines
  };
}

/** Payload for a single highlighted line's integration path sequence. */
export function buildPathPayload(lineIndex: number, path: PathPoint[], masses: MassPoint[]) {
  return {
    schema: 'gravity-streamline-path/1',
    exportedAt: new Date().toISOString(),
    lineIndex,
    massPoints: masses.map((m) => ({ ...m })),
    pointCount: path.length,
    points: path
  };
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  triggerDownload(URL.createObjectURL(blob), filename);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  triggerDownload(dataUrl, filename);
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (href.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Rough JSON byte size without serializing twice in hot paths. */
export function estimatePayloadBytes(result: ComputeResult): number {
  // ~55 bytes per point (5 compact numbers with key names), plus fixed overhead.
  return result.pointCount * 55 + 4096;
}
