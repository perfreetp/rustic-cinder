import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { SHAPE_LABELS, ShapeGlyph } from './icons';
import { BASE_SHAPE_IDS } from '../core/field';
import { loadSavedProject, useStudio } from '../state/store';
import type { BaseShapeId } from '../core/types';

/** 开场页右侧的形体预览: 每个基形用解析 SDF 直接生成小网格 */
function ShapePreview({ shape }: { shape: BaseShapeId }) {
  const host = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; mesh: THREE.Mesh; raf: number } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const w = host.current.clientWidth || 360;
    const h = host.current.clientHeight || 360;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 50);
    camera.position.set(1.6, 1.15, 2.3);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x2a3240, 1.1));
    const key = new THREE.DirectionalLight(0xfff0dc, 3.0);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9dc4ff, 1.6);
    rim.position.set(-4, 1.5, -3);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1, -2, 2);
    scene.add(fill);
    // 让预览也有环境反射: 用一个简单的渐变环境贴图
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envTop = new THREE.Mesh(
      new THREE.SphereGeometry(8, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x2b3442, side: THREE.BackSide }),
    );
    envScene.add(envTop);
    const panel = (color: number, intensity: number, pos: [number, number, number], size: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
      );
      m.position.set(...pos);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    panel(0xfff6ec, 5, [4, 5, 4], 5);
    panel(0xbcd4ff, 2.4, [-5, 2, 2], 4);
    panel(0xffffff, 1.2, [0, -4, 0], 7);
    const envTex = pmrem.fromScene(envScene, 0.03).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 1.0;
    pmrem.dispose();

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xd98d62,
      roughness: 0.42,
      metalness: 0.0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    scene.add(mesh);

    stateRef.current = { renderer, scene, camera, mesh, raf: 0 };
    return () => {
      cancelAnimationFrame(stateRef.current?.raf ?? 0);
      renderer.dispose();
      mesh.geometry.dispose();
      mat.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
  }, []);

  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    const geo = buildShapeGeometry(shape);
    st.mesh.geometry.dispose();
    st.mesh.geometry = geo;
    // 让相机把形体框满
    const sphere = geo.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 1);
    const dist = (sphere.radius * 1.9) / Math.sin((st.camera.fov * Math.PI) / 360);
    const dir = new THREE.Vector3(0.6, 0.42, 0.82).normalize();
    st.camera.position.copy(dir.multiplyScalar(dist));
    st.camera.lookAt(0, 0, 0);
  }, [shape]);

  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    const start = performance.now();
    const loop = () => {
      const s = stateRef.current;
      if (!s) return;
      s.raf = requestAnimationFrame(loop);
      const t = (performance.now() - start) / 1000;
      s.mesh.rotation.y = t * 0.42;
      s.mesh.rotation.x = -0.12;
      s.renderer.render(s.scene, s.camera);
    };
    loop();
    return () => cancelAnimationFrame(st.raf);
  }, []);

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />;
}

/** 开场预览用的形体: 直接用 three 的内置几何 (解析曲面, 比栅格采样更干净) */
function buildShapeGeometry(shape: BaseShapeId): THREE.BufferGeometry {
  switch (shape) {
    case 'sphere':
      return new THREE.SphereGeometry(0.92, 96, 64);
    case 'cube':
      return new THREE.BoxGeometry(1.5, 1.5, 1.5, 12, 12, 12);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.72, 0.72, 1.55, 96, 8);
    case 'capsule': {
      const g = new THREE.CapsuleGeometry(0.56, 1.16, 24, 64);
      return g;
    }
    case 'torus': {
      const g = new THREE.TorusGeometry(0.86, 0.315, 48, 120);
      g.rotateX(Math.PI / 2);
      return g;
    }
    default:
      return new THREE.SphereGeometry(0.92, 96, 64);
  }
}

export function StartScreen() {
  const saved = loadSavedProject();
  const [picked, setPicked] = useState<BaseShapeId>(saved?.baseShape ?? 'sphere');

  const begin = (withSaved: boolean) => {
    useStudio.getState().beginProject(picked, withSaved && saved ? saved : undefined);
  };

  return (
    <div className="start">
      <div className="start-left">
        <div className="start-kicker">FORM STUDIO</div>
        <h1 className="start-title">
          <span>用笔刷堆叠出</span>
          <span>可导出的三维雕塑</span>
        </h1>
        <p className="start-lede">
          选一个基础形体作为起点, 然后逐笔添加球状或胶囊状的体积。
          每一笔都按平滑并集融合进整体 —— 生成的是真正连续、水密的实体表面,
          而不是简单叠在一起的网格。
        </p>
        <div className="start-steps">
          <div className="start-step">
            <span className="n">1</span>
            <span>
              <b>选形体</b>　球体、立方体、圆柱、胶囊或环面, 作为造型的第一块体积
            </span>
          </div>
          <div className="start-step">
            <span className="n">2</span>
            <span>
              <b>堆叠</b>　添加 / 橡皮 / 平滑笔刷, 半径、硬度、融合强度各三档, 可开对称镜像
            </span>
          </div>
          <div className="start-step">
            <span className="n">3</span>
            <span>
              <b>调整</b>　拖动已有笔重新定位, 只重算局部网格; 历史栈可回退到任意一笔
            </span>
          </div>
          <div className="start-step">
            <span className="n">4</span>
            <span>
              <b>导出</b>　清理网格后导出 GLB, 材质与法线一并保留
            </span>
          </div>
        </div>
      </div>

      <div className="start-right">
        <div className="preview-card">
          <ShapePreview shape={picked} />
          <div className="preview-label">{SHAPE_LABELS[picked]}</div>
        </div>

        <div className="pick-title">选择基础形体</div>
        <div className="shape-grid">
          {BASE_SHAPE_IDS.map((id) => (
            <button
              key={id}
              className={`shape-card ${picked === id ? 'active' : ''}`}
              onClick={() => setPicked(id)}
              title={SHAPE_LABELS[id]}
            >
              <ShapeGlyph id={id} />
              <span className="name">{SHAPE_LABELS[id]}</span>
            </button>
          ))}
        </div>

        <div className="start-actions">
          <button className="btn primary" onClick={() => begin(false)} style={{ height: 38, padding: '0 22px', fontSize: 13.5 }}>
            开始造型
          </button>
          {saved && (
            <button className="btn" onClick={() => begin(true)} style={{ height: 38 }}>
              继续上次 ({saved.strokes.length} 笔)
            </button>
          )}
        </div>
        <div className="start-note">
          数据保存在本浏览器本地 · 造型通过 GLB 文件分享
          {saved && ` · 上次编辑: ${saved.name}`}
        </div>
      </div>
    </div>
  );
}
