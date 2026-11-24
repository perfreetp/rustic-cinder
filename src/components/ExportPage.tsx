import { useRef } from 'react';
import { appStore, useAppState } from '../core/store';
import type { AppConfig } from '../core/types';
import { defaultConfig } from '../core/defaults';
import { ActionButton, Section } from './controls';

/**
 * 导出页：
 * - 配置 JSON（母线控制点 + 全部编织/光照/精度参数），可再次载入完整复现
 * - 母线 CSV
 * - 当前几何 STL（二进制，供 CAD/打印复核）
 */
export function ExportPage() {
  const config = useAppState((s) => s.config);
  const stats = useAppState((s) => s.stats);
  const lastResponse = useAppState((s) => s.lastResponse);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const download = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const exportConfig = () => {
    const payload = {
      ...config,
      meta: {
        tool: 'bamboo-lampshade-weaver',
        exportedAt: new Date().toISOString(),
        stats: stats ?? null,
      },
    };
    download('lampshade-config.json', new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  };

  const exportProfileCsv = () => {
    const rows = ['# r(mm), z(mm)', ...config.profile.points.map((p) => `${p.r},${p.z}`)];
    download('profile.csv', new Blob([rows.join('\n')], { type: 'text/csv' }));
  };

  const exportStl = () => {
    if (!lastResponse) {
      alert('几何尚未生成，请先等待重建完成。');
      return;
    }
    const blob = buildBinaryStl(lastResponse);
    download('lampshade-weave.stl', blob);
  };

  const onImportConfig = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as AppConfig;
        const validated = validateConfig(parsed);
        appStore.loadConfig(validated);
      } catch (err) {
        alert(`配置载入失败：${err instanceof Error ? err.message : err}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="page">
      <Section title="配置文件（可再次载入）">
        <p className="panel-note">
          配置包含母线全部控制点、样条采样数、篾条宽度/厚度/根数/螺旋角/间隙等编织参数，
          以及光照与精度设置。载入后自动触发全量重建，完整复现当前方案。
        </p>
        <div className="btn-row">
          <ActionButton variant="primary" onClick={exportConfig}>
            ⬇ 导出配置 JSON
          </ActionButton>
          <ActionButton onClick={() => fileInputRef.current?.click()}>⬆ 载入配置 JSON</ActionButton>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportConfig(f);
              e.target.value = '';
            }}
          />
        </div>
      </Section>

      <Section title="母线数据">
        <div className="btn-row">
          <ActionButton onClick={exportProfileCsv}>⬇ 导出母线 CSV（r, z）</ActionButton>
        </div>
        <div className="points-table-wrap">
          <table className="points-table">
            <thead>
              <tr><th>#</th><th>r (mm)</th><th>z (mm)</th></tr>
            </thead>
            <tbody>
              {config.profile.points.map((p, i) => (
                <tr key={i}>
                  <td>P{i + 1}</td>
                  <td>{p.r.toFixed(2)}</td>
                  <td>{p.z.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="几何导出">
        <div className="btn-row">
          <ActionButton onClick={exportStl} disabled={!lastResponse}>
            ⬇ 导出编织几何 STL（二进制）
          </ActionButton>
        </div>
        {stats ? (
          <p className="panel-note">
            当前几何：{stats.totalStrips} 根篾条 · {stats.totalVertices.toLocaleString()} 顶点 ·{' '}
            {stats.totalTriangles.toLocaleString()} 三角面 · 灯罩高 {stats.heightMm.toFixed(1)} mm · 最大半径{' '}
            {stats.maxRadiusMm.toFixed(1)} mm。
          </p>
        ) : null}
      </Section>
    </div>
  );
}

/** 合并两族外/内层索引，输出二进制 STL */
function buildBinaryStl(resp: { familyA: import('../core/types').WeaveBuffers; familyB: import('../core/types').WeaveBuffers }): Blob {
  const families = [resp.familyA, resp.familyB];
  let triCount = 0;
  for (const f of families) triCount += (f.outerIndices.length + f.innerIndices.length) / 3;

  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  // 80 字节头
  const header = 'bamboo-lampshade-weaver binary STL';
  for (let i = 0; i < header.length && i < 80; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, triCount, true);

  let offset = 84;
  const writeTri = (pos: Float32Array, ia: number, ib: number, ic: number) => {
    const ax = pos[ia * 3], ay = pos[ia * 3 + 1], az = pos[ia * 3 + 2];
    const bx = pos[ib * 3], by = pos[ib * 3 + 1], bz = pos[ib * 3 + 2];
    const cx = pos[ic * 3], cy = pos[ic * 3 + 1], cz = pos[ic * 3 + 2];
    // 法向 = (b-a)×(c-a)
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nl = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(offset, nx / nl, true);
    view.setFloat32(offset + 4, ny / nl, true);
    view.setFloat32(offset + 8, nz / nl, true);
    view.setFloat32(offset + 12, ax, true);
    view.setFloat32(offset + 16, ay, true);
    view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true);
    view.setFloat32(offset + 28, by, true);
    view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true);
    view.setFloat32(offset + 40, cy, true);
    view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  };

  for (const f of families) {
    for (const idx of [f.outerIndices, f.innerIndices]) {
      for (let i = 0; i < idx.length; i += 3) {
        writeTri(f.positions, idx[i], idx[i + 1], idx[i + 2]);
      }
    }
  }
  return new Blob([buffer], { type: 'application/octet-stream' });
}

/** 载入配置的字段校验与兜底 */
function validateConfig(input: unknown): AppConfig {
  const d = defaultConfig();
  if (typeof input !== 'object' || input === null) throw new Error('文件不是有效 JSON 对象');
  const o = input as Partial<AppConfig>;
  const points = Array.isArray(o.profile?.points)
    ? o.profile!.points
        .filter((p) => Number.isFinite(p.r) && Number.isFinite(p.z) && p.r > 0)
        .map((p) => ({ r: Number(p.r), z: Number(p.z) }))
        .sort((a, b) => a.z - b.z)
    : [];
  if (points.length < 2) throw new Error('配置中母线控制点不足 2 个');

  return {
    version: 1,
    profile: {
      points,
      samples: clampNum(o.profile?.samples, d.profile.samples, 60, 600),
    },
    weave: {
      ...d.weave,
      ...(o.weave ?? {}),
      stripWidth: clampNum(o.weave?.stripWidth, d.weave.stripWidth, 2, 8),
      stripThickness: clampNum(o.weave?.stripThickness, d.weave.stripThickness, 1, 3),
      familyCount: Math.round(clampNum(o.weave?.familyCount, d.weave.familyCount, 8, 1000)),
    },
    lighting: { ...d.lighting, ...(o.lighting ?? {}) },
    quality: {
      segments: Math.round(clampNum(o.quality?.segments, d.quality.segments, 24, 200)),
    },
  };
}

function clampNum(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
