/**
 * 参数模型：应用状态、校验、以及导出 JSON 的结构（纯逻辑，可单测）。
 */

import { LEVEL_COUNT, type LevelState, type ViewMode } from './constants';

export interface BloomParams {
  threshold: number;
  knee: number;
  intensity: number;
  exposure: number;
  occlusionEnabled: boolean;
  occlusionStrength: number;
  levels: LevelState[];
  view: ViewMode;
  objectsEnabled: boolean[];
}

export interface ParamLevels {
  radius: number;
  weight: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ExportPayload {
  format: 'glow-bloom-lab/v1';
  exportedAt: string;
  render: {
    width: number;
    height: number;
    pixelRatio: number;
  };
  bloom: {
    threshold: number;
    /** 软阈值过渡宽度 */
    knee: number;
    intensity: number;
    exposure: number;
    /** 五级缓冲，由细到粗 */
    levels: { level: number; scale: string; radius: number; weight: number }[];
  };
  occlusion: {
    enabled: boolean;
    strength: number;
    /** 每个自发光物体在导出瞬间的可见比例 */
    objects: { id: string; name: string; enabled: boolean; visible: number; gain: number }[];
  };
  view: ViewMode;
}

export function buildExportPayload(input: {
  now: Date;
  width: number;
  height: number;
  pixelRatio: number;
  params: BloomParams;
  scales: readonly string[];
  objects: readonly { id: string; name: string; enabled: boolean; visible: number; gain: number }[];
}): ExportPayload {
  const { params } = input;
  return {
    format: 'glow-bloom-lab/v1',
    exportedAt: input.now.toISOString(),
    render: {
      width: input.width,
      height: input.height,
      pixelRatio: input.pixelRatio,
    },
    bloom: {
      threshold: round2(params.threshold),
      knee: round2(params.knee),
      intensity: round2(params.intensity),
      exposure: round2(params.exposure),
      levels: params.levels.slice(0, LEVEL_COUNT).map((level, i) => ({
        level: i,
        scale: input.scales[i] ?? '',
        radius: round2(level.radius),
        weight: round2(level.weight),
      })),
    },
    occlusion: {
      enabled: params.occlusionEnabled,
      strength: round2(params.occlusionStrength),
      objects: input.objects.map((o) => ({
        id: o.id,
        name: o.name,
        enabled: o.enabled,
        visible: round2(o.visible * 100) / 100,
        gain: round2(o.gain * 100) / 100,
      })),
    },
    view: params.view,
  };
}

/** 文件名安全的时间戳：2026-11-24T07-36-12 */
export function timestampForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}
