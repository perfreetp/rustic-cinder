import { useState, type ReactNode } from 'react';
import { ModuleNav, type ModuleKey } from './components/ModuleNav';
import { Viewport } from './components/Viewport';
import { EditorPanel } from './modules/EditorPanel';
import { WindWindowPanel } from './modules/WindWindowPanel';
import { SkinPanel } from './modules/SkinPanel';
import { ExportPanel } from './modules/ExportPanel';
import { setFlags, useAppState } from './store';

export default function App(): ReactNode {
  const [active, setActive] = useState<ModuleKey>('editor');
  const showTension = useAppState((s) => s.showTension);
  const autoRotate = useAppState((s) => s.autoRotate);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">🪁</span>
          <div>
            <h1>风筝冲浪伞翼形变渲染器</h1>
            <p>参数化翼型放样 · 风窗驱动弯曲 · 曲率张力染色</p>
          </div>
        </div>
        <div className="header-tools">
          <label className="mini-check">
            <input
              type="checkbox"
              checked={showTension}
              onChange={(e) => setFlags({ showTension: e.target.checked })}
            />
            张力染色
          </label>
          <label className="mini-check">
            <input
              type="checkbox"
              checked={autoRotate}
              onChange={(e) => setFlags({ autoRotate: e.target.checked })}
            />
            自动环绕
          </label>
        </div>
      </header>

      <div className="app-body">
        <aside className="side-pane">
          <ModuleNav active={active} onSelect={setActive} />
          <div className="panel-scroll">
            {active === 'editor' && <EditorPanel />}
            {active === 'window' && <WindWindowPanel />}
            {active === 'skin' && <SkinPanel />}
            {active === 'export' && <ExportPanel />}
          </div>
        </aside>
        <main className="main-pane">
          <Viewport />
        </main>
      </div>
    </div>
  );
}
