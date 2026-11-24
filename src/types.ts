// 全局状态类型定义

/** 伞翼参数：翼型拱度 / 扭转分布 / 几何 / 蒙皮 */
export interface KiteParams {
  // —— 几何 ——
  /** 展长（米） */
  span: number;
  /** 根弦长（米） */
  rootChord: number;
  /** 尖弦比 tipChord / rootChord，0.4 ~ 1 */
  tipChordRatio: number;
  /** 无载荷下的展向曲率（1/米），决定伞翼拱形 R = 1/curve */
  baseCurvature: number;

  // —— 翼型拱度（camber line，NACA 四位数风格）——
  /** 根部最大拱度（弦长比例，0.01 ~ 0.14） */
  rootCamber: number;
  /** 翼尖拱度 / 根部拱度 */
  tipCamberRatio: number;
  /** 最大拱度所在弦向位置（0.2 ~ 0.7） */
  camberPos: number;
  /** 翼型相对厚度（弦长比例） */
  thickness: number;

  // —— 展向扭转分布（5 个控制点，单位：度，从根部到翼尖）——
  twistStations: [number, number, number, number, number];

  // —— 风致形变灵敏度 ——
  /** 风速对拱度的放大系数 */
  camberLoadGain: number;
  /** 载荷对翼尖扭转（洗出）的放大系数 */
  twistLoadGain: number;
  /** 载荷对展向拱形收紧的系数 */
  arcLoadGain: number;

  // —— 张力染色 ——
  /** 曲率→张力的增益 */
  tensionGain: number;

  // —— 三层蒙皮（不透明度）——
  /** 外膜（上翼面） */
  outerOpacity: number;
  /** 内膜（下翼面 / 气囊层） */
  innerOpacity: number;
  /** 肋膜（中间翼肋层） */
  ribOpacity: number;
  /** 显示前缘管 / 翼肋管骨架 */
  showFrame: boolean;
}

/** 风窗内的飞行状态 */
export interface WindState {
  /** 风速 m/s，2 ~ 30 */
  windSpeed: number;
  /** 风窗方位角（度）：-90 左边缘 … 0 正前 … +90 右边缘 */
  azimuth: number;
  /** 风窗仰角（度）：10 接近地面（动力区）… 85 天顶 */
  elevation: number;
}

/** 风窗功率系数 0 ~ 1（边缘低、动力区高），驱动形变量级 */
export function windowPower(w: WindState): number {
  const az = Math.cos((w.azimuth * Math.PI) / 180); // 边缘 → 0
  const el = Math.sin((w.elevation * Math.PI) / 180); // 天顶 → 1
  // 低仰角（动力区）功率最高
  return Math.max(0, az * (1.15 - el));
}

export const DEFAULT_KITE_PARAMS: KiteParams = {
  span: 12,
  rootChord: 2.6,
  tipChordRatio: 0.55,
  baseCurvature: 0.16,

  rootCamber: 0.07,
  tipCamberRatio: 0.45,
  camberPos: 0.4,
  thickness: 0.13,

  twistStations: [0, 1.5, 4, 8, 13],

  camberLoadGain: 0.9,
  twistLoadGain: 14,
  arcLoadGain: 0.35,

  tensionGain: 1.0,

  outerOpacity: 0.55,
  innerOpacity: 0.28,
  ribOpacity: 0.38,
  showFrame: true,
};

export const DEFAULT_WIND: WindState = {
  windSpeed: 12,
  azimuth: 0,
  elevation: 55,
};

/** 网格分辨率（规格固定：展向 24 段，弦向 12 段） */
export const SPAN_SEGMENTS = 24;
export const CHORD_SEGMENTS = 12;
