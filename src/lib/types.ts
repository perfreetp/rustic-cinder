/** 轨迹关键点 —— 用户在轨迹页导入/编辑的数据 */
export interface TrajectoryKey {
  /** 关键帧所在帧号(0..N-1,可任意整数) */
  frame: number;
  /** 离地高度(米) */
  height: number;
  /** 水平位移:沿起跳方向的纵向距离(米) */
  distance: number;
  /** 侧向漂移(米,右为正) */
  lateral: number;
  /** 伞翼朝向(弧度,0 = 沿位移方向) */
  kiteHeading: number;
}

/** 姿态关键帧 —— 在时间轴任意帧插入,覆盖自动姿态 */
export interface PoseKey {
  frame: number;
  /** 收腿系数 0..1(1 = 完全收腿团身) */
  tuck: number;
  /** 躯干俯仰(弧度,正 = 前俯) */
  torsoPitch: number;
  /** 躯干滚转(弧度,正 = 向右倾) */
  torsoRoll: number;
  /** 双手展开宽度系数(相对肩宽),控制控制杆位置 */
  armSpread: number;
  /** 手臂前伸量(米,沿躯干前方) */
  armReach: number;
}

export type CameraMode = "follow" | "side" | "ground";

/** 插值后的逐帧采样表:全部用 TypedArray,拖动时 O(1) 查找、零 GC */
export interface FrameTable {
  frameCount: number;
  pos: Float32Array; // xyz * frameCount
  heading: Float32Array; // frameCount
  tuck: Float32Array;
  torsoPitch: Float32Array;
  torsoRoll: Float32Array;
  armSpread: Float32Array;
  armReach: Float32Array;
  hasPose: Uint8Array; // 该帧是否被姿态关键帧(或其插值)覆盖 —— 当前实现全帧覆盖,保留用于自动模式
}

export interface ProjectData {
  format: "kite-air-pose-studio";
  version: 1;
  fps: number;
  trajectoryKeys: TrajectoryKey[];
  poseKeys: PoseKey[];
}

export interface ImportedTrajectory {
  trajectoryKeys: TrajectoryKey[];
  fps?: number;
}

export const DEFAULT_POSE: Omit<PoseKey, "frame"> = {
  tuck: 0,
  torsoPitch: 0,
  torsoRoll: 0,
  armSpread: 1,
  armReach: 0.45,
};
