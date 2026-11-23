import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Text } from 'troika-three-text'
import type { ColorMode, Trajectory } from '../types'
import { displacementColor, elementColor, elementRadius } from './elements'
import { boundingSphere, inferBonds } from './geometry'

interface LabelItem {
  atomId: number
  text: string
}

const TRAIL_ALPHA_NEW = 0.6
const TRAIL_ALPHA_OLD = 0.04

/**
 * three.js 场景封装。React 只通过方法驱动它,不参与每帧渲染。
 * 原子使用 InstancedMesh:每帧成本只与原子数 N 有关,与轨迹总帧数无关,
 * 这是 1000+ 帧轨迹拖轴仍能保持高帧率的关键之一。
 */
export class MoleculeScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private mesh: THREE.InstancedMesh | null = null
  private bonds: THREE.LineSegments | null = null
  private bondPairs: Uint32Array = new Uint32Array(0)
  private labels = new Map<number, Text>()
  private labelGroup = new THREE.Group()
  private grid: THREE.GridHelper | null = null

  private trail: THREE.LineSegments | null = null
  private history: Float32Array | null = null
  private historyHead = 0
  private historyCount = 0
  private historyCapacity = 0

  private traj: Trajectory | null = null
  private cumulative: Float32Array | null = null
  private maxDisplacement = 1
  private colorMode: ColorMode = 'displacement'
  private trailEnabled = true
  private trailLength = 24

  private atomCount = 0
  private dummy = new THREE.Object3D()
  private tmpColor = new THREE.Color()
  private rafId = 0
  private resizeObserver: ResizeObserver
  private framesInLastSecond = 0
  private lastFpsTime = performance.now()
  private fps = 0
  private onStats?: (fps: number) => void

  constructor(container: HTMLElement, onStats?: (fps: number) => void) {
    this.container = container
    this.onStats = onStats
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.domElement.style.display = 'block'
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x0b1020)
    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 2000)
    this.camera.position.set(12, 10, 16)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08

    const ambient = new THREE.AmbientLight(0xffffff, 0.55)
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(8, 14, 10)
    const rim = new THREE.DirectionalLight(0x88aaff, 0.45)
    rim.position.set(-10, -6, -8)
    this.scene.add(ambient, key, rim, this.labelGroup)

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)
    this.loop()
  }

  initTrajectory(traj: Trajectory, cumulative: Float32Array, maxDisplacement: number): void {
    this.disposeTrajectoryObjects()
    this.traj = traj
    this.cumulative = cumulative
    this.maxDisplacement = maxDisplacement || 1
    this.atomCount = traj.atomCount

    const sphere = boundingSphere(traj.positions, traj.atomCount)
    this.camera.position.set(
      sphere.center[0] + sphere.radius * 1.8,
      sphere.center[1] + sphere.radius * 1.3,
      sphere.center[2] + sphere.radius * 2.2,
    )
    this.controls.target.set(...sphere.center)
    this.controls.update()

    // 原子 InstancedMesh
    const geo = new THREE.SphereGeometry(1, 16, 12)
    const mat = new THREE.MeshPhongMaterial({ shininess: 70 })
    this.mesh = new THREE.InstancedMesh(geo, mat, traj.atomCount)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    const colors = new Float32Array(traj.atomCount * 3)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.mesh)

    // 化学键(由首帧距离推断,整段轨迹拓扑不变)
    this.bondPairs = inferBonds(traj.positions, traj.atomCount)
    const bondGeo = new THREE.BufferGeometry()
    bondGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.bondPairs.length * 3), 3))
    const bondMat = new THREE.LineBasicMaterial({ color: 0x8a93a5, transparent: true, opacity: 0.55 })
    this.bonds = new THREE.LineSegments(bondGeo, bondMat)
    this.scene.add(this.bonds)

    // 地面网格
    const gridSize = Math.max(10, sphere.radius * 3)
    this.grid = new THREE.GridHelper(gridSize, 20, 0x2a3556, 0x1a2340)
    this.grid.position.set(sphere.center[0], sphere.center[1] - sphere.radius - 1.5, sphere.center[2])
    this.scene.add(this.grid)

    // 拖尾缓冲
    this.allocateTrail()
    this.historyHead = 0
    this.historyCount = 0
  }

  setColorMode(mode: ColorMode): void {
    this.colorMode = mode
  }

  setTrailEnabled(enabled: boolean): void {
    this.trailEnabled = enabled
    if (this.trail) this.trail.visible = enabled
  }

  setTrailLength(length: number): void {
    if (length === this.trailLength) return
    this.trailLength = length
    this.allocateTrail()
    this.historyHead = 0
    this.historyCount = 0
  }

  setTopLabels(items: LabelItem[]): void {
    for (const text of this.labels.values()) {
      this.labelGroup.remove(text)
      text.dispose()
    }
    this.labels.clear()
    for (const item of items) {
      const text = new Text()
      text.text = item.text
      text.fontSize = 0.42
      text.color = 0xffffff
      text.outlineWidth = 0.04
      text.outlineColor = 0x0b1020
      text.anchorX = 'center'
      text.anchorY = 'bottom'
      text.sync()
      this.labels.set(item.atomId, text)
      this.labelGroup.add(text)
    }
  }

  setLabelsVisible(visible: boolean): void {
    this.labelGroup.visible = visible
  }

  /** 每帧调用:positions 为 Worker 算出的插值坐标 */
  updateFrame(positions: Float32Array): void {
    if (!this.mesh || !this.traj) return
    const n = this.atomCount

    for (let i = 0; i < n; i++) {
      const x = positions[i * 3]
      const y = positions[i * 3 + 1]
      const z = positions[i * 3 + 2]
      const r = elementRadius(this.traj.atoms[i].element)
      this.dummy.position.set(x, y, z)
      this.dummy.scale.setScalar(r)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)

      const color = this.atomColor(i)
      this.mesh.setColorAt(i, color)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true

    this.updateBonds(positions)
    this.updateTrail(positions)
    this.updateLabelPositions(positions)
  }

  getFps(): number {
    return this.fps
  }

  resetView(): void {
    if (!this.traj) return
    const sphere = boundingSphere(this.traj.positions, this.traj.atomCount)
    this.camera.position.set(
      sphere.center[0] + sphere.radius * 1.8,
      sphere.center[1] + sphere.radius * 1.3,
      sphere.center[2] + sphere.radius * 2.2,
    )
    this.controls.target.set(...sphere.center)
    this.controls.update()
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    this.disposeTrajectoryObjects()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ---------------- 内部实现 ----------------

  private atomColor(i: number): THREE.Color {
    if (this.colorMode === 'element' || !this.cumulative) {
      return elementColor(this.traj!.atoms[i].element)
    }
    return displacementColor(this.cumulative[i] / this.maxDisplacement, this.tmpColor).clone()
  }

  private updateBonds(positions: Float32Array): void {
    if (!this.bonds) return
    const attr = this.bonds.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let k = 0; k < this.bondPairs.length; k += 2) {
      const a = this.bondPairs[k]
      const b = this.bondPairs[k + 1]
      arr[k * 3] = positions[a * 3]
      arr[k * 3 + 1] = positions[a * 3 + 1]
      arr[k * 3 + 2] = positions[a * 3 + 2]
      arr[k * 3 + 3] = positions[b * 3]
      arr[k * 3 + 4] = positions[b * 3 + 1]
      arr[k * 3 + 5] = positions[b * 3 + 2]
    }
    attr.needsUpdate = true
  }

  private allocateTrail(): void {
    if (this.trail) {
      this.scene.remove(this.trail)
      this.trail.geometry.dispose()
      ;(this.trail.material as THREE.Material).dispose()
      this.trail = null
    }
    if (!this.atomCount) return
    this.historyCapacity = this.trailLength
    this.history = new Float32Array(this.trailLength * this.atomCount * 3)
    const maxVerts = (this.trailLength - 1) * 2 * this.atomCount
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxVerts * 4), 4))
    geo.setDrawRange(0, 0)
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
    this.trail = new THREE.LineSegments(geo, mat)
    this.trail.visible = this.trailEnabled
    this.scene.add(this.trail)
  }

  private updateTrail(positions: Float32Array): void {
    if (!this.trail || !this.history) return
    const n = this.atomCount
    const stride = n * 3
    this.history.set(positions, this.historyHead * stride)
    this.historyHead = (this.historyHead + 1) % this.historyCapacity
    this.historyCount = Math.min(this.historyCount + 1, this.historyCapacity)
    if (this.historyCount < 2) return

    const posAttr = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute
    const colAttr = this.trail.geometry.getAttribute('color') as THREE.BufferAttribute
    const posArr = posAttr.array as Float32Array
    const colArr = colAttr.array as Float32Array
    let vertex = 0

    const sampleIndex = (age: number): number => {
      // age=0 最旧,age=historyCount-1 最新
      const start = (this.historyHead - this.historyCount + this.historyCapacity) % this.historyCapacity
      return (start + age) % this.historyCapacity
    }

    for (let age = 0; age < this.historyCount - 1; age++) {
      const older = sampleIndex(age)
      const newer = sampleIndex(age + 1)
      const fade = age / (this.historyCount - 1)
      const alpha = TRAIL_ALPHA_OLD + (TRAIL_ALPHA_NEW - TRAIL_ALPHA_OLD) * fade
      for (let i = 0; i < n; i++) {
        const o = older * stride + i * 3
        const nw = newer * stride + i * 3
        posArr[vertex * 3] = this.history[o]
        posArr[vertex * 3 + 1] = this.history[o + 1]
        posArr[vertex * 3 + 2] = this.history[o + 2]
        posArr[vertex * 3 + 3] = this.history[nw]
        posArr[vertex * 3 + 4] = this.history[nw + 1]
        posArr[vertex * 3 + 5] = this.history[nw + 2]

        const c = this.atomColor(i)
        for (let v = 0; v < 2; v++) {
          colArr[(vertex + v) * 4] = c.r
          colArr[(vertex + v) * 4 + 1] = c.g
          colArr[(vertex + v) * 4 + 2] = c.b
          colArr[(vertex + v) * 4 + 3] = alpha
        }
        vertex += 2
      }
    }
    this.trail.geometry.setDrawRange(0, vertex)
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
  }

  private updateLabelPositions(positions: Float32Array): void {
    if (this.labels.size === 0) return
    for (const [atomId, text] of this.labels) {
      const x = positions[atomId * 3]
      const y = positions[atomId * 3 + 1]
      const z = positions[atomId * 3 + 2]
      const r = elementRadius(this.traj!.atoms[atomId].element)
      text.position.set(x, y + r + 0.45, z)
    }
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop)
    this.controls.update()
    // troika 文字始终面向相机
    for (const text of this.labels.values()) text.quaternion.copy(this.camera.quaternion)
    this.renderer.render(this.scene, this.camera)

    this.framesInLastSecond++
    const now = performance.now()
    if (now - this.lastFpsTime >= 1000) {
      this.fps = Math.round((this.framesInLastSecond * 1000) / (now - this.lastFpsTime))
      this.framesInLastSecond = 0
      this.lastFpsTime = now
      this.onStats?.(this.fps)
    }
  }

  private handleResize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private disposeTrajectoryObjects(): void {
    for (const text of this.labels.values()) text.dispose()
    this.labels.clear()
    if (this.mesh) {
      this.scene.remove(this.mesh)
      this.mesh.geometry.dispose()
      ;(this.mesh.material as THREE.Material).dispose()
      this.mesh = null
    }
    if (this.bonds) {
      this.scene.remove(this.bonds)
      this.bonds.geometry.dispose()
      ;(this.bonds.material as THREE.Material).dispose()
      this.bonds = null
    }
    if (this.trail) {
      this.scene.remove(this.trail)
      this.trail.geometry.dispose()
      ;(this.trail.material as THREE.Material).dispose()
      this.trail = null
    }
    if (this.grid) {
      this.scene.remove(this.grid)
      this.grid.geometry.dispose()
      ;(this.grid.material as THREE.Material).dispose()
      this.grid = null
    }
    this.history = null
  }
}
