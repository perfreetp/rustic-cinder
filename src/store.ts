import { create } from 'zustand'
import type { ColorMode, InterpMode, Trajectory, TrajectorySummary } from './types'
import { deleteTrajectory, listTrajectories, loadTrajectory, saveTrajectory } from './lib/idb'
import { InterpClient } from './worker/InterpClient'
import { parseTrajectoryFile } from './lib/parsers'
import { generateDemoTrajectory } from './lib/demo'

export const SPEEDS = [0.5, 1, 1.5, 2, 3, 4] as const
export type Speed = (typeof SPEEDS)[number]

interface AppState {
  // 数据
  summaries: TrajectorySummary[]
  trajectory: Trajectory | null
  loading: boolean
  loadError: string | null
  // 分析
  cumulative: Float32Array | null
  maxDisplacement: number
  // 播放
  playing: boolean
  speed: Speed
  /** 连续时间(帧单位,可为小数),范围 [0, frameCount-1] */
  time: number
  interpMode: InterpMode
  // 视图
  colorMode: ColorMode
  trailEnabled: boolean
  trailLength: number
  labelsVisible: boolean
  // 内部
  worker: InterpClient | null

  refreshList: () => Promise<void>
  loadFile: (file: File) => Promise<void>
  loadDemo: () => Promise<void>
  selectTrajectory: (id: string) => Promise<void>
  removeTrajectory: (id: string) => Promise<void>
  setTime: (t: number) => void
  setPlaying: (p: boolean) => void
  setSpeed: (s: Speed) => void
  setInterpMode: (m: InterpMode) => void
  setColorMode: (m: ColorMode) => void
  setTrailEnabled: (v: boolean) => void
  setTrailLength: (n: number) => void
  setLabelsVisible: (v: boolean) => void
}

export const useStore = create<AppState>((set, get) => ({
  summaries: [],
  trajectory: null,
  loading: false,
  loadError: null,
  cumulative: null,
  maxDisplacement: 0,
  playing: false,
  speed: 1,
  time: 0,
  interpMode: 'linear',
  colorMode: 'displacement',
  trailEnabled: true,
  trailLength: 24,
  labelsVisible: true,
  worker: null,

  refreshList: async () => {
    set({ summaries: await listTrajectories() })
  },

  loadFile: async (file) => {
    set({ loading: true, loadError: null })
    try {
      const traj = await parseTrajectoryFile(file)
      await saveTrajectory(traj)
      await get().refreshList()
      await activateTrajectory(traj, set, get)
    } catch (e) {
      set({ loadError: (e as Error).message, loading: false })
    }
  },

  loadDemo: async () => {
    set({ loading: true, loadError: null })
    try {
      const traj = generateDemoTrajectory()
      await saveTrajectory(traj)
      await get().refreshList()
      await activateTrajectory(traj, set, get)
    } catch (e) {
      set({ loadError: (e as Error).message, loading: false })
    }
  },

  selectTrajectory: async (id) => {
    set({ loading: true, loadError: null })
    try {
      const traj = await loadTrajectory(id)
      if (!traj) throw new Error('本地未找到该轨迹,可能已被删除')
      await activateTrajectory(traj, set, get)
    } catch (e) {
      set({ loadError: (e as Error).message, loading: false })
    }
  },

  removeTrajectory: async (id) => {
    await deleteTrajectory(id)
    const state = get()
    if (state.trajectory?.id === id) {
      state.worker?.dispose()
      set({ trajectory: null, worker: null, cumulative: null, maxDisplacement: 0, time: 0, playing: false })
    }
    await get().refreshList()
  },

  setTime: (t) => {
    const fc = get().trajectory?.frameCount ?? 1
    set({ time: Math.min(fc - 1, Math.max(0, t)) })
  },
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (s) => set({ speed: s }),
  setInterpMode: (m) => set({ interpMode: m }),
  setColorMode: (m) => set({ colorMode: m }),
  setTrailEnabled: (v) => set({ trailEnabled: v }),
  setTrailLength: (n) => set({ trailLength: Math.min(120, Math.max(4, Math.round(n))) }),
  setLabelsVisible: (v) => set({ labelsVisible: v }),
}))

async function activateTrajectory(
  traj: Trajectory,
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
): Promise<void> {
  get().worker?.dispose()
  const worker = new InterpClient()
  const cumulative = await worker.init(traj)
  let maxDisplacement = 0
  for (let i = 0; i < cumulative.length; i++) maxDisplacement = Math.max(maxDisplacement, cumulative[i])
  set({
    trajectory: traj,
    worker,
    cumulative,
    maxDisplacement: maxDisplacement || 1,
    time: 0,
    playing: false,
    loading: false,
    loadError: null,
  })
}
