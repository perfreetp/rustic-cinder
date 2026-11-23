// 全局数据类型定义

/** 窗户所在墙体 */
export type WallSide = 'north' | 'south' | 'east' | 'west';

/** 窗户配置 */
export interface WindowConfig {
  id: string;
  /** 所在墙 */
  wall: WallSide;
  /** 沿墙方向的中心偏移(米,以墙中心为 0) */
  offset: number;
  /** 窗宽(米) */
  width: number;
  /** 窗高(米) */
  height: number;
  /** 窗台高度(米) */
  sill: number;
  /** 窗框竖向梃数量 */
  mullionsX: number;
  /** 窗框横向梃数量 */
  mullionsY: number;
  /** 边框宽度(米) */
  frameWidth: number;
  /** 光斑边缘柔和度 0~1(随窗框结构变化) */
  softness: number;
}

/** 房间配置 */
export interface RoomConfig {
  /** 东西向宽度 X(米) */
  width: number;
  /** 南北向进深 Z(米) */
  depth: number;
  /** 层高(米) */
  height: number;
  /** 点云地址(potree cloud.js),空则使用程序化房间 */
  pointCloudUrl: string;
}

/** 采光标记区域(地面矩形,世界坐标) */
export interface DaylightMark {
  id: string;
  name: string;
  /** 矩形中心 */
  cx: number;
  cz: number;
  /** 矩形尺寸 */
  w: number;
  d: number;
  /** 采样平均照度(lux) */
  lux: number;
  /** 记录时的模拟时刻(小时, 6~18) */
  time: number;
  /** 记录日期 */
  date: string;
  /** 城市 */
  city: string;
  /** 是否采光不足 */
  deficient: boolean;
}

/** 城市 */
export interface City {
  name: string;
  lat: number;
  lon: number;
  /** 时区(小时,东为正) */
  tz: number;
}

/** 太阳位置 */
export interface SunPosition {
  /** 方位角(弧度,正北为 0,顺时针) */
  azimuth: number;
  /** 高度角(弧度) */
  elevation: number;
  /** 是否在地平线上 */
  up: boolean;
}

/** 导出文件格式 */
export interface ExportFile {
  app: 'daylight-sim';
  version: 1;
  exportedAt: string;
  room: RoomConfig;
  windows: WindowConfig[];
  city: City;
  date: string;
  threshold: number;
  marks: DaylightMark[];
}
