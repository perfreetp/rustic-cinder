import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RenderModel, MaterialPool, BakedJoint } from './renderTypes';
import type { SectionPlaneConfig, JointConfig, MarqueeRect, PartStatus } from '../types';
import { MaterialFactory } from './MaterialFactory';
import { StatusTexture } from './StatusTexture';
import { angleAt } from '../utils/anim';
import { UPDATE_BUDGET_MS } from '../constants';

interface Pickable {
  mesh: THREE.Mesh | THREE.InstancedMesh;
  poolId: number;
  jointPath: string | null;
}

interface JointRuntime {
  config: JointConfig;
  baked: BakedJoint;
  /** 该关节在各材质池实例化网格中的(poolId → 网格与实例槽位) */
  slots: Array<{ mesh: THREE.InstancedMesh; slot: number }>;
  /** 静止世界包围球中心,用于姿态包围盒估算 */
  pivot: THREE.Vector3;
}

export interface MarqueeHit {
  paths: string[];
}

/**
 * three.js 场景引擎:
 *  - 合并网格 + 关节 InstancedMesh,万件场景保持低 draw call
 *  - 单张状态纹理驱动故障换色/选中高亮
 *  - 单裁剪平面 + 模板缓冲半透明剖切面,遮挡关系由深度测试保证
 *  - 射线拾取 + CPU 投影框选
 */
export class SceneEngine {
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private modelGroup: THREE.Group | null = null;
  /** 模板剖切面:真实世界平面,放在主场景中按相机渲染 */
  private capMesh: THREE.Mesh | null = null;
  private capMaterial: THREE.MeshBasicMaterial | null = null;

  private model: RenderModel | null = null;
  private factory: MaterialFactory | null = null;
  private statusTex: StatusTexture | null = null;
  private pickables: Pickable[] = [];
  private jointRuntimes = new Map<string, JointRuntime>();

  private selectedIds = new Set<number>();
  private partPoolColor = new Map<number, THREE.Color>();

  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
  private sectionConfig: SectionPlaneConfig | null = null;
  /** 当前模型材质的渲染面,剖切双 Pass 时切换 */
  private currentSide: THREE.Side = THREE.DoubleSide;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private tmpMatrix = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpPos = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();
  private axisVec = new THREE.Vector3();

  private rafId = 0;
  private timeT = 0;
  private lastFrameTime = performance.now();
  private fpsEMA = 60;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;

  onFps?: (fps: number) => void;
  onPick?: (path: string | null) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.initRenderer();
    this.initScene();
    this.initCapPass();
    this.bindEvents();
    this.loop();
  }

  // ---------------- 初始化 ----------------

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      stencil: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.localClippingEnabled = true;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  private initScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14181f);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.container.clientWidth / Math.max(1, this.container.clientHeight),
      0.1,
      5000,
    );
    this.camera.position.set(120, 90, 140);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 2000;

    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x3a4250, 1.1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(120, 180, 90);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.6);
    fill.position.set(-100, 60, -80);
    this.scene.add(fill);

    const grid = new THREE.GridHelper(800, 40, 0x3a4658, 0x25303d);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(grid);
  }

  /**
   * 模板剖切面:一块足够大的真实世界平面。
   * 渲染时通过双 Pass 模板(背面 INCR / 正面 DECR)限定只在模型实体内部显色,
   * 深度测试保证内部零件遮挡关系正确。
   */
  private initCapPass(): void {
    const geo = new THREE.PlaneGeometry(4000, 4000);
    this.capMaterial = new THREE.MeshBasicMaterial({
      color: 0x7fd8ff,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      clippingPlanes: [],
    });
    this.capMesh = new THREE.Mesh(geo, this.capMaterial);
    this.capMesh.visible = false;
    this.capMesh.renderOrder = 10;
    this.capMesh.frustumCulled = false;
    this.scene.add(this.capMesh);
  }

  // ---------------- 模型装载 ----------------

  loadModel(model: RenderModel, sourceMaterials: THREE.Material[]): void {
    this.clearModel();
    this.model = model;

    this.statusTex = new StatusTexture(model.partIdToPath.length);
    this.factory = new MaterialFactory(this.statusTex, sourceMaterials);
    // 裁剪平面常驻材质;禁用剖切时把 constant 推到无穷远,避免重编译
    this.factory.bindClippingPlane(this.clipPlane);

    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    const poolInstanced = new Map<number, THREE.InstancedMesh>();

    model.pools.forEach((pool: MaterialPool) => {
      const material = this.factory!.list[pool.id];
      if (pool.staticGeometry) {
        const mesh = new THREE.Mesh(pool.staticGeometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.poolId = pool.id;
        this.modelGroup!.add(mesh);
        this.pickables.push({ mesh, poolId: pool.id, jointPath: null });
      }
      // 每个材质池仅一个 InstancedMesh,承载该池全部关节实例
      if (pool.jointGeometry && pool.jointInstanceCount > 0) {
        const inst = new THREE.InstancedMesh(pool.jointGeometry, material, pool.jointInstanceCount);
        inst.castShadow = true;
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // 初始化所有实例为单位矩阵,随后按关节 rest 矩阵写入
        for (let i = 0; i < pool.jointInstanceCount; i++) {
          inst.setMatrixAt(i, this.identityMatrix());
        }
        inst.userData.poolId = pool.id;
        this.modelGroup!.add(inst);
        poolInstanced.set(pool.id, inst);
        this.pickables.push({ mesh: inst, poolId: pool.id, jointPath: '*' });
      }
    });

    // 关节运行时表:记录每个关节在各池网格中的实例槽位并写入 rest 矩阵
    for (const baked of model.joints.values()) {
      const slots: JointRuntime['slots'] = [];
      for (const [poolId, slot] of baked.instanceSlot) {
        const inst = poolInstanced.get(poolId);
        if (!inst) continue;
        inst.setMatrixAt(slot, baked.restMatrix);
        inst.instanceMatrix.needsUpdate = true;
        slots.push({ mesh: inst, slot });
      }
      const pivot = new THREE.Vector3();
      baked.restMatrix.decompose(this.tmpPos, this.tmpQuat, this.tmpScale);
      pivot.copy(this.tmpPos);
      this.jointRuntimes.set(baked.path, {
        config: this.fallbackJoint(baked),
        baked,
        slots,
        pivot,
      });
    }

    this.frameCameraToModel();
    this.writeAllStatusRows();
  }

  private fallbackJoint(baked: BakedJoint): JointConfig {
    return {
      partPath: baked.path,
      enabled: true,
      axis: baked.axis,
      travel: 45,
      gear: 'normal',
      direction: 1,
      keyframes: [
        { t: 0, angle: 0 },
        { t: 1, angle: 45 },
      ],
    };
  }

  private identityMatrix(): THREE.Matrix4 {
    return new THREE.Matrix4();
  }

  clearModel(): void {
    if (this.modelGroup) {
      this.scene.remove(this.modelGroup);
    }
    this.modelGroup = null;
    this.pickables = [];
    this.jointRuntimes.clear();
    this.selectedIds.clear();
    this.factory?.dispose();
    this.factory = null;
    this.statusTex?.dispose();
    this.statusTex = null;
    this.model = null;
  }

  private frameCameraToModel(): void {
    if (!this.model) return;
    const box = this.model.bounds;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.6, 10);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(radius * 0.9, radius * 0.7, radius * 1.1));
    this.camera.near = Math.max(0.05, radius / 500);
    this.camera.far = radius * 30;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  // ---------------- 关节动画 ----------------

  /** 同步关节配置(来自 Pinia) */
  syncJoints(configs: Map<string, JointConfig>): void {
    for (const [path, cfg] of configs) {
      const rt = this.jointRuntimes.get(path);
      if (rt) rt.config = cfg;
    }
  }

  /** 设置时间轴归一化位置 0..1,重算所有关节实例矩阵 */
  setTime(t: number): void {
    this.timeT = Math.min(1, Math.max(0, t));
    for (const rt of this.jointRuntimes.values()) {
      const angle = angleAt(rt.config, this.timeT);
      this.axisVec.set(
        rt.config.axis === 'x' ? 1 : 0,
        rt.config.axis === 'y' ? 1 : 0,
        rt.config.axis === 'z' ? 1 : 0,
      );
      const rotQuat = new THREE.Quaternion().setFromAxisAngle(
        this.axisVec,
        THREE.MathUtils.degToRad(angle),
      );
      // 实例矩阵 = rest 平移 × (rest 旋转 × 关节旋转) × rest 缩放
      const baked = rt.baked;
      baked.restMatrix.decompose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.tmpQuat.multiply(rotQuat);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      for (const slot of rt.slots) {
        slot.mesh.setMatrixAt(slot.slot, this.tmpMatrix);
        slot.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // ---------------- 状态 / 高亮 ----------------

  /**
   * 批量更新零件状态与选中集(故障注入/框选入口)。
   * 返回实际耗时,调用方可校验 300ms 预算。
   */
  updatePartStates(
    statusByPath: Map<string, PartStatus>,
    selectedPaths: Set<string>,
  ): number {
    if (!this.model || !this.statusTex) return 0;
    const start = performance.now();
    this.selectedIds.clear();
    const rows: Array<{ partId: number; status: PartStatus; selected: boolean; baseColor: THREE.Color }> = [];

    // 同一零件的多材质片段会占用多个 partId(partIdToPath 含重复路径),
    // 必须遍历全部 partId,否则未列入 parts 表的片段不会换色。
    for (let partId = 0; partId < this.model.partIdToPath.length; partId++) {
      const path = this.model.partIdToPath[partId];
      const status = statusByPath.get(path) ?? 'normal';
      const selected = selectedPaths.has(path);
      if (selected) this.selectedIds.add(partId);
      rows.push({ partId, status, selected, baseColor: this.baseColorOf(partId) });
    }
    this.statusTex.setRows(rows);
    const cost = performance.now() - start;
    if (cost > UPDATE_BUDGET_MS) {
      console.warn(`状态纹理更新耗时 ${cost.toFixed(1)}ms 超过 ${UPDATE_BUDGET_MS}ms 预算`);
    }
    return cost;
  }

  private baseColorOf(partId: number): THREE.Color {
    return this.partPoolColor.get(partId) ?? new THREE.Color(0x9aa7b5);
  }

  private writeAllStatusRows(): void {
    if (!this.model || !this.statusTex) return;
    // 记录 partId → 池基色:遍历每个池的静态几何与关节几何,扫描 aPartId
    this.partPoolColor.clear();
    for (const pool of this.model.pools) {
      const color = this.factory!.list[pool.id].color;
      const scan = (geo: THREE.BufferGeometry | null) => {
        if (!geo) return;
        const attr = geo.getAttribute('aPartId') as THREE.BufferAttribute | undefined;
        if (!attr) return;
        const seen = new Set<number>();
        for (let i = 0; i < attr.count; i++) {
          const id = attr.getX(i);
          if (!seen.has(id)) {
            seen.add(id);
            this.partPoolColor.set(id, color);
          }
        }
      };
      scan(pool.staticGeometry);
      scan(pool.jointGeometry);
    }
    const rows = this.model.partIdToPath.map((_path, partId) => ({
      partId,
      status: 'normal' as PartStatus,
      selected: false,
      baseColor: this.partPoolColor.get(partId) ?? new THREE.Color(0x9aa7b5),
    }));
    this.statusTex.setRows(rows);
  }

  // ---------------- 剖切 ----------------

  setSection(config: SectionPlaneConfig): number {
    const start = performance.now();
    this.sectionConfig = config;
    if (!config.enabled) {
      // 无穷远 constant 等效关闭,不触发着色器重编译
      this.clipPlane.constant = 1e9;
      if (this.capMesh) this.capMesh.visible = false;
      return performance.now() - start;
    }
    const normal = new THREE.Vector3(
      config.axis === 'x' ? 1 : 0,
      config.axis === 'y' ? 1 : 0,
      config.axis === 'z' ? 1 : 0,
    );
    this.clipPlane.normal.copy(normal);
    this.clipPlane.constant = -config.offset;

    if (this.capMesh && this.capMaterial) {
      this.capMesh.visible = true;
      this.capMaterial.opacity = config.capOpacity;
      // 平面法线对齐裁剪平面法线,位置取 normal * offset
      this.capMesh.position.copy(normal).multiplyScalar(config.offset);
      this.capMesh.lookAt(
        this.capMesh.position.clone().add(normal),
      );
      // cap 不参与裁剪(它本身就是切面),否则会被自身裁掉
      this.capMaterial.clippingPlanes = [];
    }
    const cost = performance.now() - start;
    if (cost > UPDATE_BUDGET_MS) {
      console.warn(`剖切重算耗时 ${cost.toFixed(1)}ms 超过 ${UPDATE_BUDGET_MS}ms 预算`);
    }
    return cost;
  }

  getSectionPlane(): THREE.Plane {
    return this.clipPlane;
  }

  // ---------------- 拾取与框选 ----------------

  /** 屏幕像素坐标(相对容器) → 零件路径 */
  pick(clientX: number, clientY: number): string | null {
    if (!this.model) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const meshes = this.pickables.map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const pick = this.pickables.find((p) => p.mesh === hit.object);
    if (!pick) return null;

    if ((hit.object as THREE.InstancedMesh).isInstancedMesh) {
      // 实例化网格:instanceId 定位关节槽位,再用面内 aPartId 精确定位零件
      const poolId = pick.poolId;
      const joint = this.findJointBySlot(poolId, hit.instanceId ?? 0);
      if (!joint) return null;
      const partId = this.partIdFromGeometry(
        (hit.object as THREE.InstancedMesh).geometry,
        hit.faceIndex ?? 0,
      );
      // 面归属的 partId 必须属于该关节,否则退回关节节点路径
      const path = this.model.partIdToPath[partId];
      if (path && joint.partIds.includes(partId)) return path;
      return joint.path;
    }
    const partId = this.partIdFromGeometry((hit.object as THREE.Mesh).geometry, hit.faceIndex ?? 0);
    return this.model.partIdToPath[partId] ?? null;
  }

  private findJointBySlot(poolId: number, slot: number): BakedJoint | null {
    if (!this.model) return null;
    for (const joint of this.model.joints.values()) {
      if (joint.instanceSlot.get(poolId) === slot) return joint;
    }
    return null;
  }

  private partIdFromGeometry(geo: THREE.BufferGeometry, faceIndex: number): number {
    const attr = geo.getAttribute('aPartId') as THREE.BufferAttribute | undefined;
    if (!attr) return 0;
    // 非索引几何:面顶点连续
    return Math.round(attr.getX(faceIndex * 3));
  }

  /**
   * 框选:将零件包围盒投影到屏幕,中心落在矩形内即命中。
   * 关节零件用当前姿态矩阵变换包围盒角点。
   */
  marqueeSelect(rect: MarqueeRect): MarqueeHit {
    if (!this.model) return { paths: [] };
    const domRect = this.renderer.domElement.getBoundingClientRect();
    const minX = Math.min(rect.x0, rect.x1);
    const maxX = Math.max(rect.x0, rect.x1);
    const minY = Math.min(rect.y0, rect.y1);
    const maxY = Math.max(rect.y0, rect.y1);

    const projected = new THREE.Vector3();
    const hits: string[] = [];
    const currentMatrices = new Map<string, THREE.Matrix4>();
    for (const rt of this.jointRuntimes.values()) {
      const first = rt.slots[0];
      if (first) {
        first.mesh.getMatrixAt(first.slot, this.tmpMatrix);
        currentMatrices.set(rt.baked.path, this.tmpMatrix.clone());
      }
    }

    for (const [path, baked] of this.model.parts) {
      const center = baked.bbox.getCenter(new THREE.Vector3());
      if (baked.jointPath) {
        const m = currentMatrices.get(baked.jointPath);
        if (m) center.applyMatrix4(m);
      }
      // 用包围球半径做粗粒度屏幕尺寸估算,避免每零件 8 角点投影
      const radius = baked.bbox.getSize(new THREE.Vector3()).length() * 0.5;
      projected.copy(center).project(this.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const sx = (projected.x * 0.5 + 0.5) * domRect.width;
      const sy = (-projected.y * 0.5 + 0.5) * domRect.height;
      const sr = this.worldRadiusToPixels(center, radius);
      const overlaps =
        sx + sr >= minX && sx - sr <= maxX && sy + sr >= minY && sy - sr <= maxY;
      if (overlaps) hits.push(path);
    }
    return { paths: hits };
  }

  private worldRadiusToPixels(worldCenter: THREE.Vector3, radius: number): number {
    const dist = this.camera.position.distanceTo(worldCenter);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const pixelHeight = this.renderer.domElement.clientHeight;
    const sizeAtDist = 2 * dist * Math.tan(fov / 2);
    return (radius / sizeAtDist) * pixelHeight;
  }

  // ---------------- 渲染循环 ----------------

  private bindEvents(): void {
    let down = new THREE.Vector2();
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      down.set(e.clientX, e.clientY);
    });
    el.addEventListener('pointerup', (e) => {
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 4) this.onPick?.(this.pick(e.clientX, e.clientY));
    });
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = Math.max(1, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;
    if (dt > 0) this.fpsEMA = this.fpsEMA * 0.92 + (1000 / dt) * 0.08;
    this.onFps?.(Math.round(this.fpsEMA));

    this.controls.update();

    const gl = this.renderer.getContext();
    this.renderer.clear(true, true, true);

    if (this.sectionConfig?.enabled && this.capMesh?.visible) {
      // —— 双 Pass 模板:标记相机视线穿透模型实体的区域 ——
      // cap 网格不参与前两个模板 Pass
      this.capMesh.visible = false;

      // Pass 1:仅背面,深度失败时模板递增(进入实体)
      gl.stencilMask(0xff);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.INCR, gl.KEEP);
      this.setModelMaterialSide(THREE.BackSide);
      this.renderer.render(this.scene, this.camera);

      // Pass 2:仅正面,深度失败时模板递减(穿出实体);闭合实体最终内部区域模板值为 1
      gl.stencilOp(gl.KEEP, gl.DECR, gl.KEEP);
      this.setModelMaterialSide(THREE.FrontSide);
      this.renderer.render(this.scene, this.camera);

      // 恢复双面并绘制 cap:仅模板值 ≠ 0(实体内部)处显色,深度测试保证遮挡正确
      this.setModelMaterialSide(THREE.DoubleSide);
      this.capMesh.visible = true;
      gl.stencilMask(0x00);
      gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      this.renderer.render(this.scene, this.camera);

      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    } else {
      gl.stencilMask(0x00);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      this.setModelMaterialSide(THREE.DoubleSide);
      this.renderer.render(this.scene, this.camera);
    }
  };

  /** 统一切换模型材质的渲染面(cap 材质独立,不受影响) */
  private setModelMaterialSide(side: THREE.Side): void {
    if (this.currentSide === side) return;
    this.currentSide = side;
    if (!this.factory) return;
    for (const mat of this.factory.list) mat.side = side;
  }

  getFps(): number {
    return Math.round(this.fpsEMA);
  }

  /** 只读调试信息(自动化测试/性能面板用) */
  getDebugInfo(): {
    drawCalls: number;
    triangles: number;
    jointCount: number;
    pickableCount: number;
    sectionEnabled: boolean;
  } {
    return {
      drawCalls: this.renderer.info.render.calls,
      // 实例化网格的 renderer.info 按实例重复计数且不含被裁剪几何,
      // 统一以烘焙阶段的源三角面总量为准
      triangles: this.model?.totalTriangles ?? this.renderer.info.render.triangles,
      jointCount: this.jointRuntimes.size,
      pickableCount: this.pickables.length,
      sectionEnabled: this.sectionConfig?.enabled ?? false,
    };
  }

  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
