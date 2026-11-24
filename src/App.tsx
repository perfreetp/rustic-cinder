import { useEffect } from 'react';
import { appStore, useAppState } from './core/store';
import type { PageId } from './core/types';
import { Viewport } from './components/Viewport';
import { ProfileEditor } from './components/ProfileEditor';
import { WeavePage } from './components/WeavePage';
import { LightingPage } from './components/LightingPage';
import { ExportPage } from './components/ExportPage';

const TABS: Array<{ id: PageId; label: string; icon: string; desc: string }> = [
  { id: 'profile', label: '母线编辑', icon: '〰', desc: '导入或手绘灯罩母线' },
  { id: 'weave', label: '编织参数', icon: '⌗', desc: '篾条规格与排布' },
  { id: 'lighting', label: '光照预览', icon: '☀', desc: '侧光 / 背光切换' },
  { id: 'export', label: '导出', icon: '⬇', desc: '配置保存与载入' },
];

export default function App() {
  const page = useAppState((s) => s.page);
  const errorMessage = useAppState((s) => s.errorMessage);

  // 首次挂载触发一次全量构建
  useEffect(() => {
    appStore.flushFullQuality();
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">竹</span>
          <div>
            <h1>竹编灯罩编织预览工具</h1>
            <p>回转曲面 · 双层平纹编织 · 法向贴合 · 实时联动</p>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab ${page === t.id ? 'tab-active' : ''}`}
              onClick={() => appStore.setPage(t.id)}
              title={t.desc}
            >
              <span className="tab-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <aside className="side-panel">
          {page === 'profile' ? <ProfileEditor /> : null}
          {page === 'weave' ? <WeavePage /> : null}
          {page === 'lighting' ? <LightingPage /> : null}
          {page === 'export' ? <ExportPage /> : null}
        </aside>
        <section className="viewport-panel">
          <Viewport />
          {errorMessage ? (
            <div className="error-toast" onClick={() => appStore.updateConfig({}, false)}>
              ⚠ {errorMessage}（点击重试）
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
