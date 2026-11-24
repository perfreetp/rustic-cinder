import type { FaultType, PartStatus, SpeedGear } from './types';

/** 时间轴逻辑帧总数 */
export const FRAME_COUNT = 600;

/** 关节行程限制 */
export const MIN_TRAVEL = 0;
export const MAX_TRAVEL = 90;

/** 速度档位 → 动画曲线锐度(指数越大动作越集中,视觉上越快) */
export const GEAR_SHARPNESS: Record<SpeedGear, number> = {
  slow: 0.55,
  normal: 1,
  fast: 1.9,
};

export const GEAR_LABEL: Record<SpeedGear, string> = {
  slow: '慢速',
  normal: '常速',
  fast: '快速',
};

/** 故障元信息 */
export interface FaultMeta {
  type: FaultType;
  label: string;
  /** 状态色(线性空间十六进制) */
  color: number;
  cssColor: string;
  desc: string;
}

export const FAULT_META: Record<FaultType, FaultMeta> = {
  jam: {
    type: 'jam',
    label: '卡料',
    color: 0xff8a00,
    cssColor: '#ff8a00',
    desc: '物料卡死,关节锁止并橙色告警',
  },
  overheat: {
    type: 'overheat',
    label: '过热',
    color: 0xff2d2d,
    cssColor: '#ff2d2d',
    desc: '温度超限,零件红色高温告警',
  },
  shaftBreak: {
    type: 'shaftBreak',
    label: '断轴',
    color: 0x8d4bff,
    cssColor: '#8d4bff',
    desc: '轴件断裂,紫色标记并产生错位',
  },
};

export const STATUS_LABEL: Record<PartStatus, string> = {
  normal: '正常',
  jam: '卡料',
  overheat: '过热',
  shaftBreak: '断轴',
};

/** 性能目标 */
export const PERF_TARGET_FPS = 50;
/** 换色/剖切重算时限 */
export const UPDATE_BUDGET_MS = 300;

/** IndexedDB 库名 */
export const IDB_NAME = 'line-fault-studio';
export const IDB_VERSION = 1;
export const IDB_STORE_PROJECTS = 'projects';
export const IDB_STORE_MODELS = 'models';
