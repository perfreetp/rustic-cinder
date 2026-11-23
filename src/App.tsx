import { useState } from 'react'
import { Viewport } from './components/Viewport'
import { LoadPage } from './pages/LoadPage'
import { PlayPage, TransportBar } from './pages/PlayPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { ExportPage } from './pages/ExportPage'

type TabId = 'load' | 'play' | 'analysis' | 'export'

const TABS: Array<{ id: TabId; icon: string; label: string }> = [
  { id: 'load', icon: '📂', label: '轨迹载入' },
  { id: 'play', icon: '🎬', label: '播放控制' },
  { id: 'analysis', icon: '📈', label: '位移分析' },
  { id: 'export', icon: '💾', label: '导出' },
]

export function App(): JSX.Element {
  const [tab, setTab] = useState<TabId>('load')

  return (
    <div className="app">
      <header className="app-header">
        <h1>🧬 分子轨迹回放工具</h1>
        <span className="subtitle">React + three.js + troika-three-text · Worker 并行插值 · IndexedDB 本地存储</span>
      </header>

      <nav className="sidebar">
        {TABS.map((t) => (
          <button key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Viewport />
          {tab === 'load' && <LoadPage />}
          {tab === 'play' && <PlayPage />}
          {tab === 'analysis' && <AnalysisPage />}
          {tab === 'export' && <ExportPage />}
        </div>
        <TransportBar />
      </main>
    </div>
  )
}
