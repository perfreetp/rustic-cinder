import type { DaylightMark, ExportFile, RoomConfig, WindowConfig } from './types';
import type { City } from './types';

/** 导出采光记录文件(JSON),供分享 */
export function exportDaylightFile(data: {
  room: RoomConfig;
  windows: WindowConfig[];
  city: City;
  date: string;
  threshold: number;
  marks: DaylightMark[];
}): void {
  const file: ExportFile = {
    app: 'daylight-sim',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data,
  };
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = data.date.replace(/-/g, '');
  a.href = url;
  a.download = `采光记录_${data.city.name}_${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 解析导入的采光记录文件 */
export function parseDaylightFile(text: string): ExportFile {
  const obj = JSON.parse(text);
  if (obj?.app !== 'daylight-sim' || !Array.isArray(obj.marks)) {
    throw new Error('不是有效的采光记录文件');
  }
  return obj as ExportFile;
}
