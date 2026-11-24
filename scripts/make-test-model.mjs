/**
 * 程序化产线测试模型生成器(仅 Node 侧使用,不打入应用包)。
 * 生成含「关节」命名节点的装配层级 GLB:
 *   产线测试模型/
 *     传送带组件/
 *       驱动轴组/
 *         驱动关节_shaftY (关节,含多个轴件子零件)
 *         ...
 *     机械臂组件/
 *       回转关节_jointZ/...
 *     机架/...
 * 用法: node scripts/make-test-model.mjs <stationCount> [out.glb]
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Node 环境缺少浏览器 FileReader,为 GLTFExporter 提供最小 polyfill
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}`;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
  };
}

const stationCount = Number(process.argv[2] ?? 6);
const outPath = process.argv[3] ?? 'public/samples/line-test.glb';

const root = new THREE.Group();
root.name = '产线测试模型';

const palette = [0x8fa3b8, 0x6b7d92, 0xc8d2dc, 0x5d6d7e, 0xaab7c4];
const matCache = palette.map((c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.55 }));

let partSeq = 0;
function boxMesh(name, size, pos, matIdx = 0) {
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mesh = new THREE.Mesh(geo, matCache[matIdx % matCache.length]);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  partSeq++;
  return mesh;
}

function cylMesh(name, radius, height, pos, matIdx = 1) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 12);
  const mesh = new THREE.Mesh(geo, matCache[matIdx % matCache.length]);
  mesh.name = name;
  mesh.position.set(pos[0], pos[1], pos[2]);
  partSeq++;
  return mesh;
}

// 传送带组件
const conveyor = new THREE.Group();
conveyor.name = '传送带组件';
root.add(conveyor);

const railL = boxMesh('左导轨', [stationCount * 12 + 4, 0.6, 0.8], [0, 6, 3]);
const railR = boxMesh('右导轨', [stationCount * 12 + 4, 0.6, 0.8], [0, 6, -3]);
conveyor.add(railL, railR);

const stations = new THREE.Group();
stations.name = '工位组';
conveyor.add(stations);

for (let i = 0; i < stationCount; i++) {
  const x = (i - (stationCount - 1) / 2) * 12;

  const station = new THREE.Group();
  station.name = `工位_${i + 1}`;
  stations.add(station);

  station.add(boxMesh(`台架_${i + 1}`, [8, 1, 6], [x, 1, 0], 2));
  station.add(boxMesh(`料盘_${i + 1}`, [5, 0.5, 4], [x, 2, 0], 4));

  // 驱动轴组(关节节点)
  const shaftGroup = new THREE.Group();
  shaftGroup.name = `驱动关节_shaftY_${i + 1}`;
  shaftGroup.position.set(x, 4, 0);
  station.add(shaftGroup);

  shaftGroup.add(cylMesh(`转轴_${i + 1}`, 0.6, 5, [0, 0, 0]));
  shaftGroup.add(boxMesh(`摇臂_${i + 1}`, [4, 0.5, 1.2], [2, 0.5, 0], 3));
  shaftGroup.add(cylMesh(`铰销_${i + 1}`, 0.3, 1.4, [4, 0.5, 0], 2));

  // 气缸滑块(第二个关节)
  const cylGroup = new THREE.Group();
  cylGroup.name = `推料关节_actuator_${i + 1}`;
  cylGroup.position.set(x, 3, 4);
  station.add(cylGroup);
  cylGroup.add(boxMesh(`缸体_${i + 1}`, [1.4, 1.4, 4], [0, 0, 0], 1));
  cylGroup.add(boxMesh(`滑块_${i + 1}`, [1, 1, 1.2], [0, 0, -2.2], 4));
}

// 机械臂组件(回转关节)
const arm = new THREE.Group();
arm.name = '机械臂组件';
arm.position.set(-(stationCount * 12) / 2 - 8, 0, 0);
root.add(arm);

const pivot = new THREE.Group();
pivot.name = '回转关节_jointZ_主臂';
pivot.position.set(0, 6, 0);
arm.add(pivot);
pivot.add(boxMesh('主臂杆', [1.2, 10, 1.2], [0, 5, 0], 3));

const elbow = new THREE.Group();
elbow.name = '肘关节_hingeX_末端';
elbow.position.set(0, 10, 0);
pivot.add(elbow);
elbow.add(boxMesh('前臂杆', [1, 7, 1], [0, 3.5, 0], 2));
elbow.add(boxMesh('夹爪座', [2.2, 1, 2.2], [0, 7.2, 0], 4));

// 机架(静态)
const frame = new THREE.Group();
frame.name = '机架';
root.add(frame);
for (let i = 0; i <= stationCount; i++) {
  const x = (i - stationCount / 2) * 12;
  frame.add(boxMesh(`支腿_${i + 1}L`, [0.6, 4, 0.6], [x, -1, 3], 1));
  frame.add(boxMesh(`支腿_${i + 1}R`, [0.6, 4, 0.6], [x, -1, -3], 1));
}

const exporter = new GLTFExporter();
exporter.parse(
  root,
  (gltf) => {
    if (!(gltf instanceof ArrayBuffer)) throw new Error('期望二进制 GLB 输出');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.from(gltf));
    console.log(`已生成 ${outPath}:${partSeq} 个网格零件,${stationCount} 工位`);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
  { binary: true },
);
