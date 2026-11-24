import { useEffect, useRef } from 'react';
import { SceneManager } from '../three/SceneManager';
import { appStore, useAppState } from '../core/store';

/**
 * 常驻 3D 视口：持有 SceneManager，响应 Worker 缓冲与光照配置变更。
 * 场景实例只创建一次；几何缓冲随 Worker 响应热替换。
 */
export function Viewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const lastHeightRef = useRef(0);
  const response = useAppState((s) => s.lastResponse);
  const lighting = useAppState((s) => s.config.lighting);
  const profile = useAppState((s) => s.config.profile);
  const status = useAppState((s) => s.status);
  const lowQuality = useAppState((s) => s.lowQuality);
  const stats = useAppState((s) => s.stats);

  useEffect(() => {
    if (!hostRef.current || sceneRef.current) return;
    sceneRef.current = new SceneManager(hostRef.current);
    sceneRef.current.applyLighting(appStore.getState().config.lighting);
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !response) return;
    scene.setWeaveBuffers(response.familyA, response.familyB);
    if (response.stats.heightMm !== lastHeightRef.current) {
      lastHeightRef.current = response.stats.heightMm;
      scene.setModelHeight(response.stats.heightMm, response.stats.maxRadiusMm);
    }
  }, [response]);

  useEffect(() => {
    sceneRef.current?.applyLighting(lighting);
  }, [lighting]);

  useEffect(() => {
    sceneRef.current?.setReferenceProfile(
      profile.points,
      lighting.showSurface,
      lighting.showProfile,
    );
  }, [profile, lighting.showSurface, lighting.showProfile]);

  return (
    <div className="viewport">
      <div ref={hostRef} className="viewport-canvas" />
      <div className="viewport-hud">
        <span className={`hud-badge hud-${status}`}>
          {status === 'building' ? (lowQuality ? '联动预览重建中…' : '全量重建中…') : status === 'ready' ? '就绪' : status === 'error' ? '错误' : '空闲'}
        </span>
        {stats ? (
          <span className="hud-text">
            篾条 {stats.totalStrips} 根 · 顶点 {stats.totalVertices.toLocaleString()} · 三角面{' '}
            {stats.totalTriangles.toLocaleString()} · 计算 {stats.buildMs.toFixed(1)} ms · 等效{' '}
            {stats.effectiveTurns.toFixed(2)} 圈
          </span>
        ) : null}
      </div>
    </div>
  );
}
