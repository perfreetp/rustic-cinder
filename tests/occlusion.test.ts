import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createVisibilityRaycaster,
  sampleVisibility,
  smoothVisibility,
  visibilityToGain,
} from '../src/core/occlusion';

/** 构造一个最小的遮挡场景：一个自发光小球 + 一块挡板。 */
function makeScene() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const target = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial());
  target.position.set(0, 0, 0);
  target.updateMatrixWorld(true);

  const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 0.2), new THREE.MeshBasicMaterial());
  wall.position.set(0, 0, 5);
  wall.updateMatrixWorld(true);

  return { camera, target, wall };
}

describe('遮挡可见比例', () => {
  it('没有遮挡体时完全可见', () => {
    const { camera, target } = makeScene();
    const ray = createVisibilityRaycaster();
    const r = sampleVisibility(target, camera, [], ray, 12);
    expect(r.visible).toBe(1);
  });

  it('完全被挡住时为 0', () => {
    const { camera, target, wall } = makeScene();
    const ray = createVisibilityRaycaster();
    const r = sampleVisibility(target, camera, [wall], ray, 12);
    expect(r.visible).toBe(0);
    expect(r.blocked).toBe(r.samples);
  });

  it('挡板移到旁边后恢复可见', () => {
    const { camera, target, wall } = makeScene();
    wall.position.set(50, 0, 5);
    wall.updateMatrixWorld(true);
    const ray = createVisibilityRaycaster();
    const r = sampleVisibility(target, camera, [wall], ray, 12);
    expect(r.visible).toBe(1);
  });

  it('挡板只遮住半边时比例在 0 与 1 之间', () => {
    const { camera, target, wall } = makeScene();
    // 挡板移到 x = +3 时覆盖目标投影的右半
    wall.position.set(3, 0, 5);
    wall.updateMatrixWorld(true);
    const ray = createVisibilityRaycaster();
    const r = sampleVisibility(target, camera, [wall], ray, 24);
    expect(r.visible).toBeGreaterThan(0);
    expect(r.visible).toBeLessThan(1);
  });

  it('目标物体自身不会被当作遮挡体', () => {
    const { camera, target } = makeScene();
    const ray = createVisibilityRaycaster();
    const r = sampleVisibility(target, camera, [target], ray, 12);
    expect(r.visible).toBe(1);
  });

  it('隐藏的遮挡体不参与计算', () => {
    const { camera, target, wall } = makeScene();
    wall.visible = false;
    const ray = createVisibilityRaycaster();
    const r = sampleVisibility(target, camera, [wall], ray, 12);
    expect(r.visible).toBe(1);
  });

  it('相机绕到另一侧后可见比例变大（联动随相机变化）', () => {
    const { camera, target, wall } = makeScene();
    const ray = createVisibilityRaycaster();

    // 相机在挡板前 → 完全被挡
    const blocked = sampleVisibility(target, camera, [wall], ray, 12);
    expect(blocked.visible).toBe(0);

    // 相机移到挡板另一侧（从后面看）→ 可见
    camera.position.set(0, 0, -10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const clear = sampleVisibility(target, camera, [wall], ray, 12);
    expect(clear.visible).toBe(1);

    expect(clear.visible).toBeGreaterThan(blocked.visible);
  });

  it('网格世界缩放影响包围球半径', () => {
    const { camera, wall } = makeScene();
    const target = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial());
    target.position.set(0, 0, 0);
    target.scale.setScalar(2);
    target.updateMatrixWorld(true);
    const ray = createVisibilityRaycaster();
    // 缩放后的球被挡板整块遮住
    const r = sampleVisibility(target, camera, [wall], ray, 16);
    expect(r.samples).toBeGreaterThan(0);
    expect(r.visible).toBeLessThanOrEqual(1);
  });
});

describe('平滑与增益', () => {
  it('平滑值收敛到目标', () => {
    let v = 1;
    for (let i = 0; i < 240; i++) v = smoothVisibility(v, 0, 1 / 60, 0.05);
    expect(v).toBeLessThan(1e-6);
  });

  it('被完全遮挡时不存在「残留满额辉光」', () => {
    let v = 1;
    for (let i = 0; i < 120; i++) v = smoothVisibility(v, 0, 1 / 60, 0.07);
    // 2 秒后增益必须接近 0
    expect(visibilityToGain(v, 1)).toBeLessThan(0.02);
  });

  it('平滑是单调的，不会过冲', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) {
      v = smoothVisibility(v, 0.6, 1 / 60, 0.08);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });

  it('增益与可见比例映射正确', () => {
    expect(visibilityToGain(1, 1)).toBe(1);
    expect(visibilityToGain(0, 1)).toBe(0);
    expect(visibilityToGain(0.5, 1)).toBe(0.5);
    // strength = 0 时关闭联动
    expect(visibilityToGain(0, 0)).toBe(1);
    expect(visibilityToGain(0.25, 0.5)).toBeCloseTo(0.625, 6);
  });

  it('增益对越界输入做钳制', () => {
    expect(visibilityToGain(-5, 1)).toBe(0);
    expect(visibilityToGain(5, 1)).toBe(1);
    expect(visibilityToGain(0.5, 5)).toBe(0.5);
    expect(visibilityToGain(0.5, -5)).toBe(1);
  });

  it('dt 非法时保持不变', () => {
    expect(smoothVisibility(0.4, 1, 0, 0.1)).toBe(0.4);
    expect(smoothVisibility(0.4, 1, Number.NaN, 0.1)).toBe(0.4);
  });
});
