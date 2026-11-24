/**
 * 全局常量与默认参数（纯数据，不依赖 three.js，便于单元测试）。
 */

export const LEVEL_COUNT = 5;

export const LEVEL_LABELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
/** 每级缓冲相对全分辨率的分母 */
export const LEVEL_SCALES = ['1/2', '1/4', '1/8', '1/16', '1/32'] as const;

export interface LevelDefaults {
  radius: number;
  weight: number;
}

/**
 * 五级降采样缓冲的默认半径与权重。
 * 半径为「该级像素」上的高斯模糊尺度；由于每级分辨率减半，
 * 同样数值在屏幕空间的有效扩散半径逐级翻倍。
 */
export const LEVEL_DEFAULTS: readonly LevelDefaults[] = [
  { radius: 0.9, weight: 1.0 },
  { radius: 1.3, weight: 0.9 },
  { radius: 1.8, weight: 0.78 },
  { radius: 2.4, weight: 0.64 },
  { radius: 3.2, weight: 0.52 },
];

export const LIMITS = {
  threshold: { min: 0, max: 2, step: 0.01 },
  knee: { min: 0, max: 2, step: 0.01 },
  intensity: { min: 0, max: 4, step: 0.01 },
  exposure: { min: 0.1, max: 3, step: 0.01 },
  radius: { min: 0, max: 4, step: 0.01 },
  weight: { min: 0, max: 2, step: 0.01 },
  occlusionStrength: { min: 0, max: 1, step: 0.01 },
} as const;

export type ViewMode = 'final' | 'bloom' | 'source' | 'occlusion';

export const VIEW_MODES: readonly { id: ViewMode; label: string; hint: string }[] = [
  { id: 'final', label: '合成', hint: '场景画面与辉光相加，再做 ACES 显示变换' },
  { id: 'bloom', label: '仅辉光', hint: '只显示五级辉光缓冲由细到粗的叠加结果' },
  { id: 'source', label: '亮度源', hint: '阈值提取后的辉光源（已乘遮挡增益）' },
  { id: 'occlusion', label: '遮挡掩码', hint: '自发光物体 ID 着色 × 可见比例' },
];

export type ShapeKind = 'icosa' | 'knot' | 'octa' | 'capsule' | 'box' | 'sphere';

/** 自发光物体规格。color 为线性 HDR 值（分量可大于 1）。 */
export interface EmissiveSpec {
  id: string;
  name: string;
  shape: ShapeKind;
  color: [number, number, number];
  scale: number;
  position: [number, number, number];
}

/**
 * 六个自发光物体均匀分布在半径约 2.55 的圆环上。
 * 中央石柱负责「完全遮挡」，外圈立柱负责「部分遮挡」，
 * 环绕相机时两者的可见比例都会连续变化。
 */
export const EMISSIVE_SPECS: readonly EmissiveSpec[] = [
  {
    id: 'spire',
    name: '棱晶塔',
    shape: 'icosa',
    color: [0.16, 0.78, 1.15],
    scale: 0.34,
    position: [2.21, 1.22, 1.27],
  },
  {
    id: 'orb',
    name: '熔核球',
    shape: 'sphere',
    color: [1.25, 0.42, 0.1],
    scale: 0.36,
    position: [0, 1.05, 2.55],
  },
  {
    id: 'knot',
    name: '环结',
    shape: 'knot',
    color: [0.95, 0.16, 1.18],
    scale: 0.3,
    position: [-2.21, 1.68, 1.27],
  },
  {
    id: 'crystal',
    name: '八面晶',
    shape: 'octa',
    color: [0.14, 1.15, 0.34],
    scale: 0.32,
    position: [-2.21, 0.86, -1.27],
  },
  {
    id: 'pill',
    name: '胶囊灯',
    shape: 'capsule',
    color: [1.18, 0.92, 0.1],
    scale: 0.28,
    position: [0, 1.0, -2.55],
  },
  {
    id: 'slab',
    name: '光方块',
    shape: 'box',
    color: [0.6, 0.22, 1.22],
    scale: 0.28,
    position: [2.21, 0.88, -1.27],
  },
];

export interface LevelState {
  radius: number;
  weight: number;
}
