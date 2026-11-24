import { useState, type ReactNode } from 'react';
import { getState, replaceAll, resetAll, type AppState } from '../store';
import { DEFAULT_KITE_PARAMS, DEFAULT_WIND } from '../types';

interface ExportDoc {
  format: 'kite-canopy-params';
  version: 1;
  exportedAt: string;
  params: AppState['params'];
  wind: AppState['wind'];
}

function buildDoc(): ExportDoc {
  const s = getState();
  return {
    format: 'kite-canopy-params',
    version: 1,
    exportedAt: new Date().toISOString(),
    params: structuredClone(s.params),
    wind: { ...s.wind },
  };
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportPanel(): ReactNode {
  const [status, setStatus] = useState<string>('');

  const handleExportJson = () => {
    const doc = buildDoc();
    download(
      `kite-canopy-${Date.now()}.json`,
      JSON.stringify(doc, null, 2),
      'application/json',
    );
    setStatus('已导出 JSON 参数文件');
  };

  const handleExportCsv = () => {
    const p = getState().params;
    const rows: Array<[string, string]> = [
      ['span', String(p.span)],
      ['rootChord', String(p.rootChord)],
      ['tipChordRatio', String(p.tipChordRatio)],
      ['baseCurvature', String(p.baseCurvature)],
      ['rootCamber', String(p.rootCamber)],
      ['tipCamberRatio', String(p.tipCamberRatio)],
      ['camberPos', String(p.camberPos)],
      ['thickness', String(p.thickness)],
    ];
    p.twistStations.forEach((v, i) => rows.push([`twistStation${i}`, String(v)]));
    rows.push(
      ['camberLoadGain', String(p.camberLoadGain)],
      ['twistLoadGain', String(p.twistLoadGain)],
      ['arcLoadGain', String(p.arcLoadGain)],
      ['tensionGain', String(p.tensionGain)],
      ['outerOpacity', String(p.outerOpacity)],
      ['innerOpacity', String(p.innerOpacity)],
      ['ribOpacity', String(p.ribOpacity)],
    );
    const csv = ['parameter,value', ...rows.map(([k, v]) => `${k},${v}`)].join('\n');
    download(`kite-canopy-${Date.now()}.csv`, csv, 'text/csv');
    setStatus('已导出 CSV 参数表');
  };

  const handleCopy = async () => {
    const doc = buildDoc();
    try {
      await navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
      setStatus('参数 JSON 已复制到剪贴板');
    } catch {
      setStatus('剪贴板不可用，请改用文件下载');
    }
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = JSON.parse(String(reader.result)) as Partial<ExportDoc>;
        if (doc.format !== 'kite-canopy-params' || !doc.params) {
          throw new Error('bad format');
        }
        const current = getState();
        replaceAll({
          ...current,
          params: { ...DEFAULT_KITE_PARAMS, ...doc.params,
            twistStations: (doc.params.twistStations ?? DEFAULT_KITE_PARAMS.twistStations)
              .slice(0, 5) as AppState['params']['twistStations'] },
          wind: { ...DEFAULT_WIND, ...doc.wind },
        });
        setStatus(`已导入：${file.name}`);
      } catch {
        setStatus('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="panel-stack">
      <section className="card">
        <h3>导出当前翼型参数</h3>
        <p className="card-desc">
          包含全部翼型拱度、扭转分布、载荷灵敏度与蒙皮不透明度，以及当前风窗状态。
        </p>
        <div className="btn-row">
          <button className="action-btn primary" onClick={handleExportJson}>
            下载 JSON
          </button>
          <button className="action-btn" onClick={handleExportCsv}>
            下载 CSV
          </button>
          <button className="action-btn" onClick={handleCopy}>
            复制 JSON
          </button>
        </div>
      </section>

      <section className="card">
        <h3>导入参数文件</h3>
        <label className="drop-zone">
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImport(f);
              e.target.value = '';
            }}
          />
          <span>点击选择或拖入 kite-canopy JSON 文件</span>
        </label>
      </section>

      <section className="card">
        <h3>预设</h3>
        <div className="btn-row">
          <button
            className="action-btn"
            onClick={() => {
              resetAll();
              setStatus('已恢复默认参数');
            }}
          >
            恢复出厂默认
          </button>
        </div>
      </section>

      {status && <div className="status-toast">{status}</div>}
    </div>
  );
}
