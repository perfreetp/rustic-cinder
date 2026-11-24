import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getState } from '../store';
import { CanopyModel } from '../geometry/canopy';

export interface FpsSample {
  fps: number;
  drawMs: number;
  triangles: number;
}

/**
 * 伞翼 3D 场景：
 * - 三层半透明膜面（外膜 / 内膜 / 翼肋），renderOrder 控制前后遮挡排序
 * - 不透明管架骨架先于透明通道绘制
 * - 渲染循环每帧直接读 store 重建几何，绕开 React 渲染链路
 */
export class CanopyScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly model: CanopyModel;
  private readonly group: THREE.Group;
  private readonly yawGroup: THREE.Group;
  private readonly frameMesh: THREE.Mesh;

  private readonly outerMat: THREE.MeshPhongMaterial;
  private readonly innerMat: THREE.MeshPhongMaterial;
  private readonly ribMat: THREE.MeshPhongMaterial;
  private readonly frameMat: THREE.MeshStandardMaterial;

  private raf = 0;
  private disposed = false;
  private readonly resizeObserver: ResizeObserver;
  private frameCount = 0;
  private lastFpsAt = performance.now();
  private onFps?: (s: FpsSample) => void;
  private lastAzimuth = NaN;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1420);
    this.scene.fog = new THREE.Fog(0x0d1420, 28, 60);

    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      200,
    );
    this.camera.position.set(0, 2.5, 17);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.5, 0);
    this.controls.minDistance = 6;
    this.controls.maxDistance = 40;

    // 灯光：半球环境光 + 主方向光 + 反向补光
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x223044, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(6, 10, 8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-8, -2, -6);
    this.scene.add(fill);

    // 参考网格地面
    const grid = new THREE.GridHelper(30, 30, 0x2c4a6b, 0x1b2c40);
    grid.position.y = -4.2;
    this.scene.add(grid);

    // —— 模型与材质 ——
    this.model = new CanopyModel();
    // 外层 group 负责自动环绕，内层 yawGroup 负责风窗偏航，互不覆盖
    this.group = new THREE.Group();
    this.yawGroup = new THREE.Group();
    this.group.add(this.yawGroup);
    this.scene.add(this.group);

    this.outerMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      shininess: 85,
      specular: new THREE.Color(0x99bbdd),
    });
    this.innerMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      shininess: 40,
    });
    this.ribMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      shininess: 30,
    });
    this.frameMat = new THREE.MeshStandardMaterial({
      color: 0x202830,
      roughness: 0.55,
      metalness: 0.15,
    });

    const outerMesh = new THREE.Mesh(this.model.outer, this.outerMat);
    const innerMesh = new THREE.Mesh(this.model.inner, this.innerMat);
    const ribMesh = new THREE.Mesh(this.model.ribs, this.ribMat);
    this.frameMesh = new THREE.Mesh(this.model.frame, this.frameMat);

    // 透明通道渲染顺序：外膜 → 翼肋 → 内膜（远 → 近，保证混合遮挡正确）
    outerMesh.renderOrder = 1;
    ribMesh.renderOrder = 2;
    innerMesh.renderOrder = 3;
    this.frameMesh.renderOrder = 0; // 不透明通道

    this.yawGroup.add(this.frameMesh, outerMesh, ribMesh, innerMesh);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setFpsListener(cb: (s: FpsSample) => void): void {
    this.onFps = cb;
  }

  private handleResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private loop(): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t0 = performance.now();

    const s = getState();
    // 风窗方位变化 → 伞翼整体偏航联动（所有顶点由 model.update 重算）
    if (this.lastAzimuth !== s.wind.azimuth) {
      this.yawGroup.rotation.y = THREE.MathUtils.degToRad(s.wind.azimuth * 0.35);
      this.lastAzimuth = s.wind.azimuth;
    }
    if (s.autoRotate) {
      this.group.rotation.y += 0.004;
    }

    this.model.update(s.params, s.wind, s.showTension);

    // 材质透明度 / 线框 / 骨架显隐
    this.outerMat.opacity = s.params.outerOpacity;
    this.innerMat.opacity = s.params.innerOpacity;
    this.ribMat.opacity = s.params.ribOpacity;
    this.outerMat.wireframe = s.wireframe;
    this.innerMat.wireframe = s.wireframe;
    this.ribMat.wireframe = s.wireframe;
    this.frameMesh.visible = s.params.showFrame;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // FPS 统计
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsAt >= 500) {
      const elapsed = now - this.lastFpsAt;
      this.onFps?.({
        fps: (this.frameCount * 1000) / elapsed,
        drawMs: (performance.now() - t0),
        triangles: this.renderer.info.render.triangles,
      });
      this.frameCount = 0;
      this.lastFpsAt = now;
    }
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.model.dispose();
    this.outerMat.dispose();
    this.innerMat.dispose();
    this.ribMat.dispose();
    this.frameMat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
