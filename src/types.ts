/**
 * 全局类型定义
 * 所有持久化数据均以零件树路径(path)作为稳定标识,不依赖运行时对象 id。
 */

/** 故障类型:卡料 / 过热 / 断轴 */
export type FaultType = 'jam' | 'overheat' | 'shaftBreak';

/** 零件工况状态(可由用户批量设置或故障注入产生) */
export type PartStatus = 'normal' | FaultType;

/** 关节运动速度档位 */
export type SpeedGear = 'slow' | 'normal' | 'fast';

/** 关节动画关键帧段 */
export interface Keyframe {
  /** 归一化时间轴位置 0..1,表示该姿态在此刻达到 */
  t: number;
  /** 关节角度(度),范围 0..90 */
  angle: number;
}

/** 可动关节配置(挂载在零件树节点上) */
export interface JointConfig {
  /** 关节所属零件节点路径 */
  partPath: string;
  /** 是否启用(禁用后该零件在动画中保持初始姿态) */
  enabled: boolean;
  /** 旋转轴,本地坐标系 */
  axis: 'x' | 'y' | 'z';
  /** 行程上限(度),0..90 */
  travel: number;
  /** 快慢档位 */
  gear: SpeedGear;
  /** 拆卸方向: 1 = 正向拆卸, -1 = 反向(装配合拢) */
  direction: 1 | -1;
  /** 关键帧(按 t 升序),默认两段:合拢态 0° → 拆卸态 travel° */
  keyframes: Keyframe[];
}

/** 零件树节点(同时是装配层级节点) */
export interface PartNode {
  /** 稳定唯一标识:从根到本节点的路径,如 /传送带组件/驱动轴组/轴#12 */
  path: string;
  /** 显示名 */
  name: string;
  /** 父节点路径,根为 null */
  parentPath: string | null;
  /** 子节点路径 */
  children: string[];
  /** 是否为可动关节挂载点 */
  isJoint: boolean;
  /** 网格数量(叶子零件实际承载的渲染网格数) */
  meshCount: number;
  /** 三角面总数(用于统计) */
  triangleCount: number;
  /**
   * 本节点自身状态。null 表示"继承父节点"(有效状态沿树向上解析)。
   * 单独覆盖即写入具体值。
   */
  ownStatus: PartStatus | null;
}

/** 故障注入记录 */
export interface FaultInjection {
  id: string;
  type: FaultType;
  /** 故障挂载的零件路径(通常是关节零件) */
  partPath: string;
  /** 注入时时间轴应跳转的归一化帧 0..1 */
  frame: number;
  /** 注入时间戳(毫秒) */
  createdAt: number;
  note?: string;
}

/** 剖切平面配置 */
export interface SectionPlaneConfig {
  enabled: boolean;
  /** 平面法线方向(世界轴) */
  axis: 'x' | 'y' | 'z';
  /** 平面位置(沿法线的有符号距离,世界坐标) */
  offset: number;
  /** 半透明剖切面不透明度 */
  capOpacity: number;
}

/** 框选矩形(屏幕像素,相对画布) */
export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 工况工程文件(导出/导入用) */
export interface ProjectFile {
  /** 文件格式标识与版本 */
  format: 'line-fault-studio';
  version: 1;
  /** 工程名 */
  name: string;
  exportedAt: number;
  /** 模型信息(模型本体不内嵌,仅记录指纹用于匹配本地缓存) */
  model: {
    fileName: string;
    /** 文件名+大小+三角面总量生成的指纹 */
    fingerprint: string;
    partCount: number;
    triangleCount: number;
  };
  /** 关节配置,key = partPath */
  joints: Record<string, JointConfig>;
  /** 零件自身状态覆盖,仅保存 ownStatus !== null 的节点 */
  statuses: Record<string, PartStatus>;
  faults: FaultInjection[];
  section: SectionPlaneConfig;
  /** 时间轴总帧数(逻辑帧) */
  frameCount: number;
}

/** IndexedDB 中保存的工程记录 */
export interface SavedProject {
  id: string;
  name: string;
  updatedAt: number;
  modelFileName: string;
  modelFingerprint: string;
  data: ProjectFile;
}
