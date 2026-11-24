import { useCallback, useEffect, useRef } from 'react';
import { setWind, useAppState } from '../store';
import { windowPower } from '../types';
import { Slider } from '../components/Slider';

/**
 * 风窗极坐标盘：
 * 水平方向 = 方位角 az(-90…+90)，竖直方向 = 仰角 el(10…85)
 * 背景按风窗功率函数染色（动力区最亮），手柄可直接拖拽
 */
export function WindWindowPanel() {
  const wind = useAppState((s) => s.wind);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const size = canvas.clientWidth;
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = size;
    const H = size;
    const cx = W / 2;
    const cy = H * 0.94;
    const R = W * 0.46;

    // 坐标映射
    const toXY = (az: number, el: number): [number, number] => {
      const r = ((90 - el) / 80) * R;
      const theta = (az * Math.PI) / 180;
      return [cx + r * Math.sin(theta), cy - r * Math.cos(theta)];
    };

    ctx.clearRect(0, 0, W, H);

    // —— 背景功率热区（扇形网格逐格着色）——
    const azSteps = 36;
    const elSteps = 16;
    for (let ai = 0; ai < azSteps; ai++) {
      for (let ei = 0; ei < elSteps; ei++) {
        const az0 = -90 + (ai / azSteps) * 180;
        const az1 = -90 + ((ai + 1) / azSteps) * 180;
        const el0 = 10 + (ei / elSteps) * 75;
        const el1 = 10 + ((ei + 1) / elSteps) * 75;
        const midAz = (az0 + az1) / 2;
        const midEl = (el0 + el1) / 2;
        const p = windowPower({ windSpeed: 12, azimuth: midAz, elevation: midEl });
        const [x0, y0] = toXY(az0, el0);
        const [x1, y1] = toXY(az1, el0);
        const [x2, y2] = toXY(az1, el1);
        const [x3, y3] = toXY(az0, el1);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x3, y3);
        ctx.closePath();
        ctx.fillStyle = `rgba(255, ${Math.round(90 + 120 * (1 - p))}, 60, ${0.05 + p * 0.5})`;
        ctx.fill();
      }
    }

    // —— 扇形边界与等仰角环线 ——
    ctx.strokeStyle = 'rgba(160,200,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, Math.PI * 2);
    ctx.stroke();
    [25, 45, 65, 85].forEach((el) => {
      ctx.beginPath();
      ctx.arc(cx, cy, ((90 - el) / 80) * R, Math.PI, Math.PI * 2);
      ctx.stroke();
    });
    // 方位射线
    [-90, -45, 0, 45, 90].forEach((az) => {
      const [x, y] = toXY(az, 10);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
    });

    // 标注
    ctx.fillStyle = 'rgba(200,220,255,0.7)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const labels: Array<[number, number, string]> = [
      [-82, 20, '左边缘'],
      [82, 20, '右边缘'],
      [0, 86, '天顶'],
      [0, 16, '动力区'],
    ];
    for (const [az, el, text] of labels) {
      const [lx, ly] = toXY(az, el);
      ctx.fillText(text, lx, ly);
    }

    // —— 风筝手柄 ——
    const [kx, ky] = toXY(wind.azimuth, wind.elevation);
    ctx.beginPath();
    ctx.arc(kx, ky, 12, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(77,163,255,0.25)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(kx, ky, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#66b3ff';
    ctx.fill();
    ctx.strokeStyle = '#d6e8ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 牵引线
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(kx, ky);
    ctx.strokeStyle = 'rgba(102,179,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [wind.azimuth, wind.elevation]);

  useEffect(() => {
    draw();
  }, [draw]);

  const pointerToWind = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const W = rect.width;
    const cx = W / 2;
    const cy = W * 0.94;
    const R = W * 0.46;
    const dx = px - cx;
    const dy = py - cy;
    const r = Math.min(Math.hypot(dx, dy), R);
    const az = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
    const el = Math.round(90 - (r / R) * 80);
    setWind({
      azimuth: Math.max(-90, Math.min(90, az)),
      elevation: Math.max(10, Math.min(85, el)),
    });
  };

  const power = windowPower(wind);

  return (
    <div className="panel-stack">
      <section className="card">
        <h3>风窗（拖拽手柄改变飞行位置）</h3>
        <canvas
          ref={canvasRef}
          className="wind-canvas"
          onPointerDown={(e) => {
            draggingRef.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            pointerToWind(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) pointerToWind(e.clientX, e.clientY);
          }}
          onPointerUp={(e) => {
            draggingRef.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        />
        <div className="wind-readout">
          <div>
            方位角 <b>{wind.azimuth > 0 ? '+' : ''}{wind.azimuth}°</b>
          </div>
          <div>
            仰角 <b>{wind.elevation}°</b>
          </div>
          <div>
            风窗功率 <b className={power > 0.6 ? 'hot' : ''}>{(power * 100).toFixed(0)}%</b>
          </div>
        </div>
      </section>

      <section className="card">
        <h3>风况滑杆</h3>
        <Slider
          label="风速"
          value={wind.windSpeed}
          min={2}
          max={30}
          step={0.5}
          unit=" m/s"
          accent="#ff7a59"
          onChange={(v) => setWind({ windSpeed: v })}
        />
        <Slider
          label="风窗方位角"
          value={wind.azimuth}
          min={-90}
          max={90}
          step={1}
          unit="°"
          onChange={(v) => setWind({ azimuth: v })}
        />
        <Slider
          label="风窗仰角"
          value={wind.elevation}
          min={10}
          max={85}
          step={1}
          unit="°"
          hint="低仰角为动力区，伞翼弯曲最明显"
          onChange={(v) => setWind({ elevation: v })}
        />
      </section>

      <section className="card info-card">
        <p>
          动压按风速平方增长，乘以风窗功率后驱动拱度放大与翼尖洗出。
          手柄拖到左/右边缘时伞翼偏航联动，所有顶点与法线在同一帧内重算。
        </p>
      </section>
    </div>
  );
}
