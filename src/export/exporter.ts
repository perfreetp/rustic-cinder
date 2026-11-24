/**
 * 导出模块：当前分辨率 PNG + 参数 JSON。
 */

import { LEVEL_SCALES } from '../core/constants';
import { buildExportPayload, timestampForFilename, type BloomParams } from '../core/params';

export interface ExportInput {
  params: BloomParams;
  width: number;
  height: number;
  pixelRatio: number;
  objects: { id: string; name: string; enabled: boolean; visible: number; gain: number }[];
  capturePNG: () => Promise<{ blob: Blob; width: number; height: number }>;
}

export interface ExportResult {
  pngName: string;
  jsonName: string;
  pngBytes: number;
  jsonBytes: number;
  width: number;
  height: number;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 稍后回收，避免部分浏览器下载中断
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportAll(input: ExportInput): Promise<ExportResult> {
  const now = new Date();
  const stamp = timestampForFilename(now);

  const payload = buildExportPayload({
    now,
    width: input.width,
    height: input.height,
    pixelRatio: input.pixelRatio,
    params: input.params,
    scales: LEVEL_SCALES,
    objects: input.objects,
  });

  const jsonText = JSON.stringify(payload, null, 2);
  const jsonBlob = new Blob([jsonText], { type: 'application/json' });

  // 先截 PNG，再触发下载，避免合成目标被后续帧覆盖
  const png = await input.capturePNG();

  const pngName = `glow-${stamp}-${png.width}x${png.height}.png`;
  const jsonName = `glow-${stamp}-params.json`;

  download(png.blob, pngName);
  download(jsonBlob, jsonName);

  return {
    pngName,
    jsonName,
    pngBytes: png.blob.size,
    jsonBytes: jsonBlob.size,
    width: png.width,
    height: png.height,
  };
}
