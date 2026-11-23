// 房间结构(墙体/地板/天花板/家具)与窗框网格
import * as THREE from 'three';
import type { RoomConfig, WallSide, WindowConfig } from '../types';
import { WALL_THICKNESS, wallFrame, wallSegments, windowOpening, windowWorldFrame } from './geometry';

const WALL_SIDES: WallSide[] = ['south', 'north', 'east', 'west'];

export interface RoomBuild {
  group: THREE.Group;
  /** 参与光线投射遮挡计算的网格(地板/墙/天花板/家具) */
  colliders: THREE.Object3D[];
  /** 家具网格(用于标记采样遮挡) */
  furniture: THREE.Object3D[];
}

// 墙体为单面平面(正面朝室内):从室外看近墙被剔除,形成"娃娃屋"剖视;
// 阴影投射不受影响(shadowSide 默认为背面,正对太阳)
const wallMat = new THREE.MeshStandardMaterial({
  color: 0xe8e2d6,
  roughness: 0.95,
  side: THREE.FrontSide,
});
const floorMat = new THREE.MeshStandardMaterial({ color: 0xa9825a, roughness: 0.8 });
const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 1 });
const frameMat = new THREE.MeshStandardMaterial({ color: 0x6b6f76, roughness: 0.5, metalness: 0.3 });
const furnitureMats = [
  new THREE.MeshStandardMaterial({ color: 0x7d9ec4, roughness: 0.9 }),
  new THREE.MeshStandardMaterial({ color: 0x9c7b5a, roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ color: 0x8aa888, roughness: 0.9 }),
  new THREE.MeshStandardMaterial({ color: 0xc4b08a, roughness: 0.9 }),
];

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  cast = true,
  receive = true,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

/** 构建房间(含窗洞墙体、地板、天花板、家具) */
export function buildRoom(room: RoomConfig, windows: WindowConfig[]): RoomBuild {
  const group = new THREE.Group();
  const colliders: THREE.Object3D[] = [];
  const furniture: THREE.Object3D[] = [];
  const W = room.width;
  const D = room.depth;
  const H = room.height;

  // 地板
  const floor = box(W, 0.05, D, floorMat, false, true);
  floor.position.y = -0.025;
  group.add(floor);
  colliders.push(floor);

  // 天花板:主渲染不可见,但仍投射阴影(遮挡高空太阳)
  const ceil = box(W, 0.05, D, ceilMat, true, false);
  ceil.position.y = H + 0.025;
  (ceil.material as THREE.Material).visible = false;
  group.add(ceil);
  colliders.push(ceil);

  // 四面墙(按窗洞分段,单面平面朝室内)
  for (const side of WALL_SIDES) {
    const f = wallFrame(side, room);
    const openings = windows.filter((w) => w.wall === side).map(windowOpening);
    const segs = wallSegments(f.length, H, openings);
    const basis = new THREE.Matrix4().makeBasis(
      f.u,
      new THREE.Vector3(0, 1, 0),
      f.n,
    );
    const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
    for (const s of segs) {
      if (s.su < 0.01 || s.sy < 0.01) continue;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.su, s.sy), wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.quaternion.copy(quat);
      mesh.position.copy(
        f.origin
          .clone()
          .addScaledVector(f.u, s.u)
          .add(new THREE.Vector3(0, s.y, 0)),
      );
      group.add(mesh);
      colliders.push(mesh);
    }
  }

  // 家具(随房间尺寸布局)
  const addFurniture = (
    w: number,
    h: number,
    d: number,
    x: number,
    z: number,
    matIdx: number,
  ) => {
    const m = box(w, h, d, furnitureMats[matIdx % furnitureMats.length]);
    m.position.set(x, h / 2, z);
    group.add(m);
    colliders.push(m);
    furniture.push(m);
  };
  addFurniture(2.0, 0.45, 1.5, -W / 2 + 1.1, -D / 2 + 0.85, 0); // 床
  addFurniture(0.6, 2.0, 1.2, -W / 2 + 0.4, D / 2 - 0.7, 1); // 衣柜
  addFurniture(1.2, 0.75, 0.7, W / 2 - 0.9, -D / 2 + 0.6, 2); // 书桌
  addFurniture(1.8, 0.7, 0.8, W / 2 - 1.2, D / 2 - 0.7, 3); // 沙发

  return { group, colliders, furniture };
}

/** 构建一扇窗的窗框网格(边框 + 横竖梃) */
export function buildWindowFrame(w: WindowConfig, room: RoomConfig): THREE.Group {
  const g = new THREE.Group();
  const fw = w.frameWidth;
  const depth = WALL_THICKNESS * 1.2;

  const add = (su: number, sy: number, x: number, y: number) => {
    const m = box(su, sy, depth, frameMat);
    m.position.set(x, y, 0);
    g.add(m);
  };
  // 边框
  add(w.width, fw, 0, w.height / 2 - fw / 2);
  add(w.width, fw, 0, -w.height / 2 + fw / 2);
  add(fw, w.height, -w.width / 2 + fw / 2, 0);
  add(fw, w.height, w.width / 2 - fw / 2, 0);
  // 竖梃
  for (let i = 1; i <= w.mullionsX; i++) {
    const x = -w.width / 2 + (i * w.width) / (w.mullionsX + 1);
    add(fw * 0.7, w.height - 2 * fw, x, 0);
  }
  // 横梃
  for (let i = 1; i <= w.mullionsY; i++) {
    const y = -w.height / 2 + (i * w.height) / (w.mullionsY + 1);
    add(w.width - 2 * fw, fw * 0.7, 0, y);
  }

  const wf = windowWorldFrame(w, room);
  // 局部 +x 对齐墙 u 方向,局部 +z 对齐室内法线
  const basis = new THREE.Matrix4().makeBasis(wf.u, new THREE.Vector3(0, 1, 0), wf.n);
  g.quaternion.setFromRotationMatrix(basis);
  g.position.copy(wf.center);
  return g;
}
