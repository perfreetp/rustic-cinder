/**
 * 场景载入模块。
 *
 * 构成：
 *  - 6 个自发光物体，HDR 线性自发光（分量 > 1，才能被阈值提取成辉光源）
 *  - 中央石柱 + 外圈立柱 + 悬空板 + 地面，作为遮挡几何体
 *  - 轨道相机：可环绕、可缩放；环绕时遮挡关系持续变化
 *  - 每个自发光物体可单独开关
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EMISSIVE_SPECS, type EmissiveSpec, type ShapeKind } from '../core/constants';

export interface EmissiveObject {
  readonly spec: EmissiveSpec;
  /** 同时是遮挡掩码中使用的物体 ID（1..N） */
  readonly index: number;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  enabled: boolean;
}

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  emissives: EmissiveObject[];
  /** 参与遮挡计算的网格（不含自发光物体） */
  occluders: THREE.Object3D[];
  /** 场景是静态的，画面不会自行变化（唯一的动态来源是环绕相机）。 */
  update(): boolean;
  dispose(): void;
}

export type SceneBundleWithUpdate = SceneBundle;

function createEmissiveGeometry(shape: ShapeKind): THREE.BufferGeometry {
  switch (shape) {
    case 'icosa':
      return new THREE.IcosahedronGeometry(1, 2);
    case 'knot':
      return new THREE.TorusKnotGeometry(0.68, 0.22, 128, 20);
    case 'octa':
      return new THREE.OctahedronGeometry(1, 0);
    case 'capsule':
      return new THREE.CapsuleGeometry(0.55, 0.9, 8, 20);
    case 'box':
      return new THREE.BoxGeometry(1.15, 1.15, 1.15);
    case 'sphere':
    default:
      return new THREE.SphereGeometry(1, 48, 32);
  }
}

export interface CreateSceneOptions {
  renderer: THREE.WebGLRenderer;
  /** OrbitControls 的事件接收元素 */
  domElement: HTMLElement;
  width: number;
  height: number;
}

export function createScene(options: CreateSceneOptions): SceneBundle {
  const { renderer, domElement, width, height } = options;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090d);
  scene.fog = new THREE.FogExp2(0x07090d, 0.022);

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
  // 初始机位：azimuth≈3.6、polar≈0.42π、距离≈8.1
  // 这个角度可同时看到 5 个自发光体，且中央石柱造成清晰的部分遮挡，
  // 便于一眼看出「被挡住的光晕变暗」。
  camera.position.set(-3.3, 4.35, -6.6);

  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 1.05, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3.0;
  controls.maxDistance = 16;
  controls.minPolarAngle = 0.16;
  controls.maxPolarAngle = Math.PI * 0.497;
  controls.autoRotateSpeed = 1.6;
  controls.enablePan = false;
  controls.update();

  // ── 灯光 ───────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0x8ea3c4, 0x0c0e12, 0.2));

  const key = new THREE.DirectionalLight(0xcfdcf2, 0.42);
  key.position.set(5.5, 8.5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0015;
  key.shadow.normalBias = 0.035;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x4f6fff, 0.3);
  rim.position.set(-6, 3.5, -5.5);
  scene.add(rim);

  // ── 环境贴图 ───────────────────────────────────────────
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomScene = new RoomEnvironment();
  const envRT = pmrem.fromScene(roomScene, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.16;
  roomScene.dispose();
  pmrem.dispose();

  // ── 遮挡几何体 ─────────────────────────────────────────
  const occluders: THREE.Object3D[] = [];
  const stage = new THREE.Group();
  stage.name = 'stage';
  scene.add(stage);

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x2b3138,
    roughness: 0.85,
    metalness: 0.05,
    envMapIntensity: 0.32,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0x171b21,
    roughness: 0.34,
    metalness: 0.78,
    envMapIntensity: 0.55,
  });

  const addOccluder = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: readonly [number, number, number],
    name: string,
    rotation: readonly [number, number, number] = [0, 0, 0],
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    stage.add(mesh);
    occluders.push(mesh);
    return mesh;
  };

  // 中央石柱：挡在相机与「背侧」自发光物体之间，制造整块遮挡
  addOccluder(new THREE.BoxGeometry(1.5, 2.9, 1.5), stoneMat, [0, 1.45, 0], 'core-pillar', [0, 0.35, 0]);
  // 柱顶压顶石
  addOccluder(new THREE.BoxGeometry(2.0, 0.22, 2.0), metalMat, [0, 2.98, 0], 'core-cap', [0, 0.35, 0]);

  // 外圈立柱：环绕相机时轮流从不同自发光物体前掠过
  const pillarGeo = new THREE.CylinderGeometry(0.17, 0.22, 2.7, 18);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    addOccluder(
      pillarGeo,
      i % 2 === 0 ? stoneMat : metalMat,
      [Math.cos(a) * 3.85, 1.35, Math.sin(a) * 3.85],
      `pillar-${i}`,
      [0, a, 0],
    );
  }

  // 悬空板：制造「半遮挡」——物体的上半截被切掉
  addOccluder(new THREE.BoxGeometry(2.3, 0.26, 1.15), metalMat, [0, 2.1, 2.38], 'float-slab', [0.06, 0.28, 0.04]);
  addOccluder(new THREE.BoxGeometry(1.1, 0.26, 2.2), metalMat, [-2.35, 1.95, 0], 'side-slab', [-0.05, 0, 0.07]);

  // 地面
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(6.8, 6.8, 0.4, 64),
    new THREE.MeshStandardMaterial({ color: 0x14171b, roughness: 0.96, metalness: 0.02 }),
  );
  floor.position.y = -0.2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  stage.add(floor);
  occluders.push(floor);

  // ── 自发光物体 ─────────────────────────────────────────
  const emissives: EmissiveObject[] = [];
  const emissiveGroup = new THREE.Group();
  emissiveGroup.name = 'emissives';
  scene.add(emissiveGroup);

  for (let i = 0; i < EMISSIVE_SPECS.length; i++) {
    const spec = EMISSIVE_SPECS[i]!;
    const geometry = createEmissiveGeometry(spec.shape);
    const color = new THREE.Color().setRGB(spec.color[0], spec.color[1], spec.color[2], THREE.LinearSRGBColorSpace);

    const material = new THREE.MeshStandardMaterial({
      color: 0x0d0f13,
      roughness: 0.28,
      metalness: 0.2,
      emissive: color,
      // 自发光强度与 HDR 颜色叠加，保证亮度远超阈值 1.0
      // 亮度刚好越过阈值（便于提取辉光），又不会把物体自身压成白盘
      emissiveIntensity: 0.78,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(spec.position[0], spec.position[1], spec.position[2]);
    mesh.scale.setScalar(spec.scale);
    // 固定朝向（略带倾斜，让形体更有辨识度）——场景保持静态，
    // 这样参数拖动时辉光链可以真正做增量重算。
    mesh.rotation.set(0.35 + i * 0.21, 0.6 + i * 0.37, 0.15 + i * 0.11);
    mesh.name = `emissive-${spec.id}`;
    mesh.userData.emissiveIndex = i;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    emissiveGroup.add(mesh);

    emissives.push({ spec, index: i, mesh, material, enabled: true });
  }

  // 环境光斑：极暗的补充光源，保证遮挡体有可见轮廓但不干扰阈值提取
  const fill = new THREE.PointLight(0x8ea6d8, 0.8, 18, 2.0);
  fill.position.set(0, 4.6, 0);
  scene.add(fill);

  // 场景是静态的：唯一的动态来源是环绕相机。
  // 这让「只改半径」时辉光链可以做真正的增量重算。
  return {
    scene,
    camera,
    controls,
    emissives,
    occluders,
    /** 静态场景，画面不会自行变化。 */
    update(): boolean {
      return false;
    },
    dispose() {
      controls.dispose();
      envRT.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.disposeBoundsTree?.();
          obj.geometry.dispose();
          const m = obj.material;
          if (Array.isArray(m)) for (const x of m) x.dispose();
          else m.dispose();
        }
      });
      scene.clear();
    },
  };
}
