import type { ReactNode } from 'react';

export type ModuleKey = 'editor' | 'window' | 'skin' | 'export';

const TABS: ReadonlyArray<{ key: ModuleKey; label: string; icon: string }> = [
  { key: 'editor', label: '伞翼编辑器', icon: '✣' },
  { key: 'window', label: '风窗视图', icon: '◔' },
  { key: 'skin', label: '蒙皮材质', icon: '▦' },
  { key: 'export', label: '导出', icon: '⇩' },
];

interface Props {
  active: ModuleKey;
  onSelect: (k: ModuleKey) => void;
}

export function ModuleNav({ active, onSelect }: Props): ReactNode {
  return (
    <nav className="module-nav">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`nav-btn ${active === t.key ? 'active' : ''}`}
          onClick={() => onSelect(t.key)}
        >
          <span className="nav-icon">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
