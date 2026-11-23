import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function LoadPage(): JSX.Element {
  const summaries = useStore((s) => s.summaries)
  const trajectory = useStore((s) => s.trajectory)
  const loading = useStore((s) => s.loading)
  const loadError = useStore((s) => s.loadError)
  const refreshList = useStore((s) => s.refreshList)
  const loadFile = useStore((s) => s.loadFile)
  const loadDemo = useStore((s) => s.loadDemo)
  const selectTrajectory = useStore((s) => s.selectTrajectory)
  const removeTrajectory = useStore((s) => s.removeTrajectory)

  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const handleFiles = (files: FileList | null): void => {
    const file = files?.[0]
    if (file) void loadFile(file)
  }

  return (
    <div className="page">
      <div className="card">
        <h2>载入轨迹</h2>
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            handleFiles(e.dataTransfer.files)
          }}
        >
          <div className="big">点击选择或拖拽轨迹文件到此处</div>
          <div>支持多帧 XYZ(.xyz,每帧含原子数头)与自定义 JSON(.json,可携带残基信息)</div>
          <input
            ref={inputRef}
            type="file"
            accept=".xyz,.json,text/plain,application/json"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn primary" disabled={loading} onClick={() => void loadDemo()}>
            {loading ? <span className="spinner" /> : null}
            生成 1200 帧演示轨迹
          </button>
          <button className="btn" onClick={() => void refreshList()}>
            刷新本地列表
          </button>
        </div>
        {loadError && <div className="error-box" style={{ marginTop: 14 }}>载入失败:{loadError}</div>}
        {loading && <div className="progress-hint">正在解析坐标并写入 IndexedDB,大文件请稍候…</div>}
      </div>

      <div className="card">
        <h2>本地轨迹库(IndexedDB)</h2>
        {summaries.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🗂️</div>
            本地还没有轨迹,先载入文件或生成演示轨迹
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>帧数</th>
                <th>原子数</th>
                <th>体积</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name} {trajectory?.id === t.id && <span className="tag active">当前</span>}
                  </td>
                  <td>{t.frameCount.toLocaleString()}</td>
                  <td>{t.atomCount.toLocaleString()}</td>
                  <td>{formatSize(t.sizeBytes)}</td>
                  <td>{new Date(t.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="row">
                      <button className="btn small primary" disabled={loading} onClick={() => void selectTrajectory(t.id)}>
                        切换
                      </button>
                      <button
                        className="btn small danger"
                        onClick={() => {
                          if (window.confirm(`确认删除轨迹「${t.name}」?`)) void removeTrajectory(t.id)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
