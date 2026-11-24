export type Vec3 = [number, number, number];

export type BaseShapeId = 'sphere' | 'cube' | 'cylinder' | 'capsule' | 'torus';

export type BrushKind = 'add' | 'erase' | 'smooth';
export type BrushShape = 'sphere' | 'capsule';
export type SymAxis = 'x' | 'y' | 'z';
export type PrecisionId = 'draft' | 'standard' | 'fine';
export type ToolId = 'add' | 'erase' | 'smooth' | 'move' | 'orbit';

/**
 * 一笔 (= 历史栈里的一个条目)。
 * points 是笔刷中心轨迹: 1 个点 = 球状体积, ≥2 个点 = 串起来的胶囊体积。
 * 整笔共享半径 / 硬度 / 融合强度与镜像设置。
 */
export interface Stroke {
  id: string;
  kind: BrushKind;
  shape: BrushShape;
  points: Vec3[];
  /** 每个点处的落笔法线 (决定笔刷剖面的朝向) */
  normals: Vec3[];
  radius: number;
  /** 0..1 */
  hardness: number;
  /** 0..1 */
  blend: number;
  /** 0..1, 仅平滑笔刷: 按住时递增 */
  strength: number;
  mirrorAxis: SymAxis | null;
  createdAt: number;
  /** 该笔触发的局部重建次数, 用于统计 */
  dwellTicks?: number;
}

export type MaterialPresetId = 'clay' | 'porcelain' | 'resin' | 'graphite';

export interface MaterialSettings {
  preset: MaterialPresetId;
  color: string;
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  envIntensity: number;
}

export interface BrushSettings {
  shape: BrushShape;
  radiusLevel: 0 | 1 | 2;
  hardnessLevel: 0 | 1 | 2;
  blendLevel: 0 | 1 | 2;
}
