// 房间 / 窗户几何换算工具
import * as THREE from 'three';
import type { RoomConfig, WallSide, WindowConfig } from '../types';

export const WALL_THICKNESS = 0.12;

/** 墙体局部坐标系:origin 在墙内表面中心(地面处),u 沿墙向,n 指向室内 */
export interface WallFrame {
  origin: THREE.Vector3;
  u: THREE.Vector3;
  n: THREE.Vector3;
  /** 墙长度(米) */
  length: number;
}

export function wallFrame(side: WallSide, room: RoomConfig): WallFrame {
  const W = room.width;
  const D = room.depth;
  switch (side) {
    case 'south':
      return {
        origin: new THREE.Vector3(0, 0, D / 2),
        u: new THREE.Vector3(1, 0, 0),
        n: new THREE.Vector3(0, 0, -1),
        length: W,
      };
    case 'north':
      return {
        origin: new THREE.Vector3(0, 0, -D / 2),
        u: new THREE.Vector3(-1, 0, 0),
        n: new THREE.Vector3(0, 0, 1),
        length: W,
      };
    case 'east':
      return {
        origin: new THREE.Vector3(W / 2, 0, 0),
        u: new THREE.Vector3(0, 0, 1),
        n: new THREE.Vector3(-1, 0, 0),
        length: D,
      };
    case 'west':
      return {
        origin: new THREE.Vector3(-W / 2, 0, 0),
        u: new THREE.Vector3(0, 0, -1),
        n: new THREE.Vector3(1, 0, 0),
        length: D,
      };
  }
}

/** 窗洞沿墙区间 [u0, u1] 与竖直区间 [y0, y1] */
export function windowOpening(w: WindowConfig): { u0: number; u1: number; y0: number; y1: number } {
  return {
    u0: w.offset - w.width / 2,
    u1: w.offset + w.width / 2,
    y0: w.sill,
    y1: w.sill + w.height,
  };
}

/** 窗洞中心世界坐标与坐标架(用于放置窗框网格) */
export function windowWorldFrame(
  w: WindowConfig,
  room: RoomConfig,
): { center: THREE.Vector3; u: THREE.Vector3; n: THREE.Vector3 } {
  const f = wallFrame(w.wall, room);
  const center = f.origin
    .clone()
    .addScaledVector(f.u, w.offset)
    .add(new THREE.Vector3(0, w.sill + w.height / 2, 0));
  return { center, u: f.u.clone(), n: f.n.clone() };
}

/** 窗口内某点(uv ∈ [0,1])的世界坐标 */
export function windowPointAt(
  w: WindowConfig,
  room: RoomConfig,
  u: number,
  v: number,
  target?: THREE.Vector3,
): THREE.Vector3 {
  const f = wallFrame(w.wall, room);
  const uu = w.offset - w.width / 2 + u * w.width;
  const y = w.sill + v * w.height;
  const out = target ?? new THREE.Vector3();
  return out.copy(f.origin).addScaledVector(f.u, uu).add(new THREE.Vector3(0, y, 0));
}

/** 世界坐标是否在窗洞内(给定墙局部坐标) */
export function pointInOpening(w: WindowConfig, u: number, y: number): boolean {
  const o = windowOpening(w);
  return u >= o.u0 && u <= o.u1 && y >= o.y0 && y <= o.y1;
}

/** 由墙体开窗情况生成墙体分段(返回局部 u/y 盒子) */
export function wallSegments(
  length: number,
  height: number,
  openings: { u0: number; u1: number; y0: number; y1: number }[],
): { u: number; y: number; su: number; sy: number }[] {
  const segs: { u: number; y: number; su: number; sy: number }[] = [];
  const ops = [...openings]
    .map((o) => ({
      u0: Math.max(-length / 2, o.u0),
      u1: Math.min(length / 2, o.u1),
      y0: Math.max(0, o.y0),
      y1: Math.min(height, o.y1),
    }))
    .filter((o) => o.u1 > o.u0 && o.y1 > o.y0)
    .sort((a, b) => a.u0 - b.u0);

  let cursor = -length / 2;
  for (const o of ops) {
    if (o.u0 > cursor) {
      segs.push({ u: (cursor + o.u0) / 2, y: height / 2, su: o.u0 - cursor, sy: height });
    }
    if (o.y0 > 0.001) {
      segs.push({ u: (o.u0 + o.u1) / 2, y: o.y0 / 2, su: o.u1 - o.u0, sy: o.y0 });
    }
    if (height - o.y1 > 0.001) {
      segs.push({
        u: (o.u0 + o.u1) / 2,
        y: (o.y1 + height) / 2,
        su: o.u1 - o.u0,
        sy: height - o.y1,
      });
    }
    cursor = Math.max(cursor, o.u1);
  }
  if (cursor < length / 2) {
    segs.push({
      u: (cursor + length / 2) / 2,
      y: height / 2,
      su: length / 2 - cursor,
      sy: height,
    });
  }
  return segs;
}
