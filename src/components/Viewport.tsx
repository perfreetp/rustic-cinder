import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { MoleculeScene } from '../lib/MoleculeScene'

/** 供外部按钮调用的场景句柄(重置视角等) */
let sceneHandle: MoleculeScene | null = null
export function getScene(): MoleculeScene | null {
  return sceneHandle
}

export function Viewport(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<MoleculeScene | null>(null)
  const [fps, setFps] = useState(0)

  const trajectory = useStore((s) => s.trajectory)
  const cumulative = useStore((s) => s.cumulative)
  const maxDisplacement = useStore((s) => s.maxDisplacement)
  const colorMode = useStore((s) => s.colorMode)
  const trailEnabled = useStore((s) => s.trailEnabled)
  const trailLength = useStore((s) => s.trailLength)
  const labelsVisible = useStore((s) => s.labelsVisible)
  const interpMode = useStore((s) => s.interpMode)
  // 订阅 time 以驱动重渲染(实际帧请求在下方 rAF 泵中按最新 state 发出)
  useStore((s) => s.time)

  // 场景生命周期
  useEffect(() => {
    if (!containerRef.current) return
    const scene = new MoleculeScene(containerRef.current, (v) => setFps(v))
    sceneRef.current = scene
    sceneHandle = scene
    return () => {
      scene.dispose()
      sceneRef.current = null
      sceneHandle = null
    }
  }, [])

  // 轨迹切换:重建场景对象与 Top10 troika 标注
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !trajectory || !cumulative) return
    scene.initTrajectory(trajectory, cumulative, maxDisplacement)
    scene.setColorMode(colorMode)
    scene.setTrailEnabled(trailEnabled)
    scene.setTrailLength(trailLength)
    scene.setLabelsVisible(labelsVisible)

    const top = topTen(cumulative)
    scene.setTopLabels(
      top.map((id) => {
        const a = trajectory.atoms[id]
        return { atomId: id, text: `${a.residue ?? a.element}${a.residueId ?? ''}` }
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trajectory?.id])

  // 视图选项同步
  useEffect(() => sceneRef.current?.setColorMode(colorMode), [colorMode])
  useEffect(() => sceneRef.current?.setTrailEnabled(trailEnabled), [trailEnabled])
  useEffect(() => sceneRef.current?.setTrailLength(trailLength), [trailLength])
  useEffect(() => sceneRef.current?.setLabelsVisible(labelsVisible), [labelsVisible])

  // 播放时钟 + Worker 调度。请求序号防止旧轨迹/旧时刻的回包覆盖新帧。
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !trajectory) return
    let cancelled = false
    let requestSeq = 0
    let raf = 0
    let lastTick = performance.now()

    const pump = (now: number): void => {
      if (cancelled) return
      const state = useStore.getState()
      if (!state.trajectory || state.trajectory.id !== trajectory.id) return
      const dt = (now - lastTick) / 1000
      lastTick = now

      if (state.playing) {
        const next = state.time + dt * state.speed
        if (next >= trajectory.frameCount - 1) {
          state.setTime(trajectory.frameCount - 1)
          state.setPlaying(false)
        } else {
          state.setTime(next)
        }
      }

      const seq = ++requestSeq
      state.worker
        ?.request(useStore.getState().time, state.interpMode)
        .then((res) => {
          if (cancelled || seq !== requestSeq) return
          sceneRef.current?.updateFrame(res.positions)
        })
        .catch(() => undefined)
      raf = requestAnimationFrame(pump)
    }
    raf = requestAnimationFrame(pump)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [trajectory?.id, interpMode])

  return (
    <div className="viewport">
      <div ref={containerRef} className="viewport-canvas" />
      <div className="viewport-hud">
        <span className={`fps-badge ${fps >= 30 ? 'ok' : 'low'}`}>{fps} FPS</span>
        {trajectory && <span className="hud-name">{trajectory.name}</span>}
      </div>
    </div>
  )
}

function topTen(cumulative: Float32Array): number[] {
  return Array.from({ length: cumulative.length }, (_, i) => i)
    .sort((a, b) => cumulative[b] - cumulative[a])
    .slice(0, 10)
}
