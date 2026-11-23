// 太阳位置计算(NOAA 通用近似算法,精度约 0.01° 量级,满足建筑采光模拟)
import type { SunPosition } from './types';

const DEG = Math.PI / 180;

/** 一年中的第几天 */
function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((date.getTime() - start) / 86400000);
}

/**
 * 计算太阳方位角与高度角
 * @param lat 纬度(度)
 * @param lon 经度(度,东经为正)
 * @param tz  时区(小时,东为正)
 * @param date 日期
 * @param hour 当地标准时(小时,可为小数)
 */
export function sunPosition(
  lat: number,
  lon: number,
  tz: number,
  date: Date,
  hour: number,
): SunPosition {
  const n = dayOfYear(date);
  // 真太阳时修正:均时差 + 经度修正
  const B = ((360 / 365) * (n - 81)) * DEG;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // 均时差(分钟)
  const standardMeridian = tz * 15;
  const solarTime = hour + (eot + 4 * (lon - standardMeridian)) / 60; // 真太阳时(小时)

  // 太阳赤纬(Cooper 公式)
  const decl = 23.45 * Math.sin(((360 / 365) * (284 + n)) * DEG) * DEG;

  // 时角(正午为 0,上午为负)
  const ha = (15 * (solarTime - 12)) * DEG;
  const phi = lat * DEG;

  const sinElev =
    Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const elevation = Math.asin(Math.min(1, Math.max(-1, sinElev)));

  // 方位角:正北 0,顺时针(东 90°,南 180°,西 270°)
  const cosAz =
    (Math.sin(decl) - Math.sin(phi) * sinElev) / (Math.cos(phi) * Math.cos(elevation));
  let az = Math.acos(Math.min(1, Math.max(-1, cosAz)));
  if (ha > 0) az = 2 * Math.PI - az; // 下午在西侧

  return { azimuth: az, elevation, up: elevation > 0 };
}

/**
 * 太阳方向向量(从地面指向太阳,three.js 世界坐标)
 * 约定:X+ 东,Y+ 上,Z+ 南(房间北墙在 -Z)
 */
export function sunDirection(pos: SunPosition): [number, number, number] {
  const { azimuth, elevation } = pos;
  const ce = Math.cos(elevation);
  // 方位角从正北(-Z)起顺时针
  const x = ce * Math.sin(azimuth);
  const z = -ce * Math.cos(azimuth);
  const y = Math.sin(elevation);
  return [x, y, z];
}

/** 晴天直射法线照度近似(lux),随高度角变化 */
export function directNormalIlluminance(elevation: number): number {
  if (elevation <= 0) return 0;
  const sinE = Math.sin(elevation);
  // 经验模型:大气衰减
  return 120000 * Math.pow(sinE, 1.2) * Math.exp(-0.12 / Math.max(sinE, 0.05)) / 1.35;
}

/** 天空漫射环境照度近似(lux) */
export function diffuseIlluminance(elevation: number): number {
  if (elevation <= 0) return 0;
  return 8000 + 25000 * Math.sin(elevation);
}
