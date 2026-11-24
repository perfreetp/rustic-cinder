import { useStudio } from '../state/store';
import { IconTrash } from './icons';

export function HistoryList() {
  const history = useStudio((s) => s.history);
  const historyIndex = useStudio((s) => s.historyIndex);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="history-head">
        造型历史
        <span className="count">{history.length} 笔</span>
      </div>
      <div className="history-list">
        {history.length === 0 && (
          <div className="history-empty">
            还没有笔触。
            <br />
            在视口里按住左键开始堆叠。
          </div>
        )}
        {history.map((entry, i) => {
          const isCurrent = i === historyIndex;
          const isFuture = i > historyIndex;
          return (
            <div
              key={entry.id}
              className={`history-item ${isCurrent ? 'current' : ''} ${isFuture ? 'future' : ''}`}
              onClick={() => useStudio.getState().restoreHistory(i)}
              title={isFuture ? `前进到第 ${i + 1} 笔之后的状态` : `回退到第 ${i + 1} 笔`}
            >
              <div className="rail" />
              <span className="history-num">{String(i + 1).padStart(2, '0')}</span>
              <span
                className={`history-kind ${
                  entry.kind === 'add' ? 'kind-add' : entry.kind === 'erase' ? 'kind-erase' : 'kind-smooth'
                }`}
              >
                {entry.kind === 'add' ? '+' : entry.kind === 'erase' ? '−' : '≈'}
              </span>
              <span className="history-label">{entry.label}</span>
              <button
                className="history-del"
                title="删除这一笔"
                onClick={(e) => {
                  e.stopPropagation();
                  useStudio.getState().removeStroke(entry.id);
                }}
              >
                <IconTrash />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
