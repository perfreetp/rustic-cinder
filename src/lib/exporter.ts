import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { InterpMode, Trajectory } from '../types'
import { elementColor, elementRadius } from './elements'

export interface ExportOptions {
  startFrame: number
  endFrame: number
  /** 导出采样间隔(帧),1 表示每帧都导出 */
  step: number
  mode: InterpMode
}

/** Catmull-Rom 与 Worker 中保持一致的插值 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    (-0.5 * t3 + t2 - 0.5 * t) * p0 +
    (1.5 * t3 - 2.5 * t2 + 1) * p1 +
    (-1.5 * t3 + 2 * t2 + 0.5 * t) * p2 +
    (0.5 * t3 - 0.5 * t2) * p3
  )
}

function sampleAt(src: Float32Array, traj: Trajectory, time: number, mode: InterpMode, out: Float32Array): void {
  const { frameCount: frames, atomCount: atoms } = traj
  const stride = atoms * 3
  const clamped = Math.min(frames - 1, Math.max(0, time))
  const i0 = Math.min(frames - 2, Math.max(0, Math.floor(clamped)))
  const t = clamped - i0
  if (mode === 'linear' || frames < 2) {
    const a = i0 * stride
    const b = (i0 + 1) * stride
    for (let k = 0; k < stride; k++) out[k] = src[a + k] + (src[b + k] - src[a + k]) * t
    return
  }
  const iPrev = Math.max(0, i0 - 1)
  const iNext = Math.min(frames - 1, i0 + 2)
  const p0 = iPrev * stride
  const p1 = i0 * stride
  const p2 = (i0 + 1) * stride
  const p3 = iNext * stride
  for (let k = 0; k < stride; k++) out[k] = catmullRom(src[p0 + k], src[p1 + k], src[p2 + k], src[p3 + k], t)
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/**
 * 将选定帧区间导出为单个 GLB:
 * 每个原子一个节点(小球网格),位置写入 AnimationClip 的 VectorKeyframeTrack,
 * 可在任何支持 glTF 动画的查看器中回放。
 */
export async function exportTrajectoryGlb(traj: Trajectory, opts: ExportOptions): Promise<void> {
  const start = Math.max(0, Math.min(opts.startFrame, opts.endFrame))
  const end = Math.min(traj.frameCount - 1, Math.max(opts.startFrame, opts.endFrame))
  const step = Math.max(1, Math.floor(opts.step))
  const sampleTimes: number[] = []
  for (let f = start; f <= end; f += step) sampleTimes.push(f)
  if (sampleTimes[sampleTimes.length - 1] !== end) sampleTimes.push(end)

  const group = new THREE.Group()
  group.name = traj.name.replace(/[^\w一-龥-]+/g, '_')

  // 同元素共享几何体与材质,控制 GLB 体积
  const geoCache = new Map<string, THREE.SphereGeometry>()
  const matCache = new Map<string, THREE.MeshPhongMaterial>()
  const nodes: THREE.Mesh[] = []
  for (let i = 0; i < traj.atomCount; i++) {
    const el = traj.atoms[i].element
    let geo = geoCache.get(el)
    if (!geo) {
      geo = new THREE.SphereGeometry(elementRadius(el), 16, 12)
      geoCache.set(el, geo)
    }
    let mat = matCache.get(el)
    if (!mat) {
      mat = new THREE.MeshPhongMaterial({ color: elementColor(el) })
      matCache.set(el, mat)
    }
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = `${traj.atoms[i].residue ?? el}_${traj.atoms[i].atomName ?? i + 1}_${i}`
    group.add(mesh)
    nodes.push(mesh)
  }

  const tracks: THREE.VectorKeyframeTrack[] = nodes.map((node, i) => {
    const values = new Float32Array(sampleTimes.length * 3)
    const frame = new Float32Array(traj.atomCount * 3)
    sampleTimes.forEach((f, si) => {
      sampleAt(traj.positions, traj, f, opts.mode, frame)
      values[si * 3] = frame[i * 3]
      values[si * 3 + 1] = frame[i * 3 + 1]
      values[si * 3 + 2] = frame[i * 3 + 2]
    })
    const times = Float32Array.from(sampleTimes, (f) => (f - start) * traj.frameDelta)
    return new THREE.VectorKeyframeTrack(`${node.name}.position`, times as unknown as number[], values as unknown as number[])
  })

  const clip = new THREE.AnimationClip('trajectory', (end - start) * traj.frameDelta, tracks)

  const exporter = new GLTFExporter()
  const glb = await exporter.parseAsync(group, {
    binary: true,
    animations: [clip],
    onlyVisible: true,
  })
  const blob = new Blob([glb as ArrayBuffer], { type: 'model/gltf-binary' })
  const safeName = traj.name.replace(/[^\w一-龥-]+/g, '_')
  downloadBlob(blob, `${safeName}_frames-${start}-${end}.glb`)
}
