import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CanopyScene, type FpsSample } from '../three/CanopyScene';
import { useAppState } from '../store';
import { windowPower } from '../types';

export function Viewport(): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fps, setFps] = useState<FpsSample>({ fps: 0, drawMs: 0, triangles: 0 });
  const wind = useAppState((s) => s.wind);
  const autoRotate = useAppState((s) => s.autoRotate);

  useEffect(() => {
    if (!hostRef.current) return;
    const scene = new CanopyScene(hostRef.current);
    scene.setFpsListener(setFps);
    return () => scene.dispose();
  }, []);

  const power = windowPower(wind);
  const fpsColor = fps.fps >= 55 ? '#5be08a' : fps.fps >= 30 ? '#ffd166' : '#ff6b6b';

  return (
    <div className="viewport-wrap">
      <div ref={hostRef} className="viewport-host" />
      <div className="hud">
        <div className="hud-item">
          <span className="hud-label">FPS</span>
          <span className="hud-value" style={{ color: fpsColor }}>
            {fps.fps.toFixed(0)}
          </span>
        </div>
        <div className="hud-item">
          <span className="hud-label">帧耗时</span>
          <span className="hud-value">{fps.drawMs.toFixed(2)} ms</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">三角面</span>
          <span className="hud-value">{fps.triangles}</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">风速</span>
          <span className="hud-value">{wind.windSpeed.toFixed(1)} m/s</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">风窗功率</span>
          <span className="hud-value">{(power * 100).toFixed(0)}%</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">网格</span>
          <span className="hud-value">24×12 段 / 325 顶点</span>
        </div>
        <div className="hud-item">
          <span className="hud-label">自动环绕</span>
          <span className="hud-value">{autoRotate ? '开' : '关'}</span>
        </div>
      </div>
      <div className="viewport-hint">鼠标拖拽旋转视角 · 滚轮缩放 · 右键平移</div>
    </div>
  );
}
