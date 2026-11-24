/**
 * 全局共享类型：应用状态、母线/曲面/编织参数、Worker 通信协议。
 * 所有长度单位统一为毫米(mm)，角度为度(deg)。
 */

export type Vec2 = { r: number; z: number };

/** 母线控制点（r = 半径，z = 轴向高度，z 必须严格单调递增） */
export interface ProfilePoint {
  r: number;
  z: number;
}

export type WeavePattern = 'plain';

/** 母线 + 回转曲面设置 */
export interface ProfileConfig {
  /** 控制点，z 升序 */
  points: ProfilePoint[];
  /** 弧长方向采样段数（母线离散精度） */
  samples: number;
}

/** 编织参数 */
export interface WeaveConfig {
  /** 篾条宽度 mm，2~8 */
  stripWidth: number;
  /** 篾条厚度 mm，1~3 */
  stripThickness: number;
  /** 每族篾条根数（两族相同），总数 = 2 × familyCount，最大 1000/族 */
  familyCount: number;
  /** 螺旋角（篾条与水平圆周方向的夹角，度） */
  helixAngle: number;
  /** 闭合前的缠绕圈数，0 表示自动（按覆盖关系推算） */
  turns: number;
  /** 自动推算圈数时篾条之间的目标间隙系数（1 = 紧密排布） */
  spacingFactor: number;
  /** 编织花样（当前支持平纹） */
  pattern: WeavePattern;
  /** 交叉点额外法向间隙 mm（防穿插安全余量，相对厚度） */
  clearance: number;
}

export type LightingMode = 'side' | 'back';

/** 光照/材质设置 */
export interface LightingConfig {
  mode: LightingMode;
  /** 侧光方向角（度，绕 Y 轴） */
  sideAngle: number;
  /** 侧光强度 */
  sideIntensity: number;
  /** 内部背光（透射）强度 */
  backIntensity: number;
  /** 环境光强度 */
  ambient: number;
  /** 竹面油亮程度（clearcoat 0~1） */
  gloss: number;
  /** 篾条整体不透明度（观察叠加效果时可调低） */
  opacity: number;
  /** 篾条基色 */
  color: string;
  /** 显示参考回转曲面（半透明） */
  showSurface: boolean;
  /** 显示母线 */
  showProfile: boolean;
}

/** 渲染精度（LOD） */
export interface QualityConfig {
  /** 每根篾条沿长度方向的采样段数（全量） */
  segments: number;
}

export type PageId = 'profile' | 'weave' | 'lighting' | 'export';

export interface AppConfig {
  version: 1;
  profile: ProfileConfig;
  weave: WeaveConfig;
  lighting: LightingConfig;
  quality: QualityConfig;
}

/** Worker 输入：一次完整的编织重算请求 */
export interface WeaveRequest {
  requestId: number;
  profile: ProfileConfig;
  weave: WeaveConfig;
  /** 本次使用的每根篾条段数（交互时降低 LOD） */
  segments: number;
}

export interface WeaveStats {
  totalStrips: number;
  totalVertices: number;
  totalTriangles: number;
  buildMs: number;
  heightMm: number;
  maxRadiusMm: number;
  effectiveTurns: number;
  /** 实际螺旋角（度，固定圈数模式下由几何反算） */
  effectiveHelixAngle: number;
  /** 中点处相邻篾条垂直间距（mm） */
  stripSpacing: number;
  /** 篾宽 / 间距 的覆盖率（百分比，单族） */
  coverage: number;
}

/**
 * Worker 输出：两族各自一组共享顶点缓冲（位置/法线/uv），
 * 以及「外层/内层」两套索引，主线程直接映射为 4 个网格。
 * 所有 TypedArray 以 Transferable 方式移交。
 */
export interface WeaveBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  outerIndices: Uint32Array;
  innerIndices: Uint32Array;
  vertexCount: number;
}

export interface WeaveResponse {
  requestId: number;
  familyA: WeaveBuffers;
  familyB: WeaveBuffers;
  stats: WeaveStats;
}

/** 母线预览采样请求（仅重算曲线，用于编辑器联动，不走几何重建） */
export interface ProfileSampleRequest {
  requestId: number;
  profile: ProfileConfig;
}

export interface ProfileSampleResponse {
  requestId: number;
  samples: ProfilePoint[];
}

export type WorkerRequest = WeaveRequest | ProfileSampleRequest;
export type WorkerResponse = WeaveResponse | ProfileSampleResponse;

export function isWeaveResponse(v: WorkerResponse): v is WeaveResponse {
  return (v as WeaveResponse).familyA !== undefined;
}
