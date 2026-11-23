import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh'
import type { Hold } from '@/types'
import { buildRouteCurve } from '@/lib/routeCurve'
import type { WallDataset } from '@/types'

THREE.BufferGeometry.prototype.computeBoundsTree =
  THREE.BufferGeometry.prototype.computeBoundsTree || computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree =
  THREE.BufferGeometry.prototype.disposeBoundsTree || disposeBoundsTree

export interface CompareRoute {
  name: string
  /** 该路线包含的岩点编号，按路线顺序 */
  holdIds: number[]
  color: string
}

/**
 * 只读路线对比视图：
 * - 并排水印岩点；在本路线中的岩点按路线色高亮
 * - 两条路线各自的平滑弧
 * - 差异统计由外部组件根据 holdIds 集合计算
 */
export class RouteViewer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private raf = 0
  private readonly resizeObs: ResizeObserver
  private readonly group = new THREE.Group()
  private readonly holdMesh: THREE.InstancedMesh
  private readonly holds: Hold[]

  constructor(
    private readonly container: HTMLElement,
    dataset: WallDataset,
  ) {
    this.holds = dataset.holds
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#10141b')
    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.05,
      100,
    )
    this.camera.position.set(0.6, 2.75, 9.2)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 2.5, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1

    this.scene.add(new THREE.AmbientLight('#ffffff', 0.6))
    const key = new THREE.DirectionalLight('#fff4e0', 1.4)
    key.position.set(4, 8, 9)
    this.scene.add(key)

    const wallMat = new THREE.MeshStandardMaterial({
      color: '#b9c0cc',
      roughness: 0.92,
      transparent: true,
      opacity: 0.28,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    })
    const wall = new THREE.Mesh(dataset.wallGeometry, wallMat)
    wall.renderOrder = 0
    this.scene.add(wall)

    // 全部岩点实例：未在路线中的压暗
    const geo = new THREE.IcosahedronGeometry(1, 1)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.6 })
    this.holdMesh = new THREE.InstancedMesh(geo, mat, this.holds.length)
    this.holdMesh.frustumCulled = false
    this.holdMesh.renderOrder = 1
    this.scene.add(this.holdMesh)

    this.scene.add(this.group)
    this.resizeObs = new ResizeObserver(() => this.onResize())
    this.resizeObs.observe(container)
    this.animate()
  }

  /** 渲染一条路线：弧 + 路线内岩点高亮 */
  showRoute(route: CompareRoute | null): void {
    this.clearGroup()
    const ids = new Set(route?.holdIds ?? [])
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const z = new THREE.Vector3(0, 0, 1)
    const n = new THREE.Vector3()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const dim = new THREE.Color('#333a45')
    const hi = new THREE.Color(route?.color ?? '#3aa0ff')
    const c = new THREE.Color()

    const ordered: Hold[] = []
    this.holds.forEach((h, i) => {
      p.set(...h.position)
      n.set(...h.normal)
      q.setFromUnitVectors(z, n)
      s.setScalar(h.scale)
      m.compose(p, q, s)
      this.holdMesh.setMatrixAt(i, m)
      const inRoute = ids.has(h.id)
      if (inRoute) {
        c.copy(hi)
        ordered.push(h)
      } else {
        c.copy(dim)
      }
      this.holdMesh.setColorAt(i, c)
    })
    this.holdMesh.instanceMatrix.needsUpdate = true
    if (this.holdMesh.instanceColor) this.holdMesh.instanceColor.needsUpdate = true

    if (route && ordered.length >= 2) {
      const built = buildRouteCurve(ordered, null, 0.18, 0.02, route.color)
      if (built) {
        const tube = new THREE.Mesh(
          built.geometry,
          new THREE.MeshStandardMaterial({
            color: route.color,
            roughness: 0.35,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          }),
        )
        tube.renderOrder = 2
        this.group.add(tube)
      }
    }
  }

  private clearGroup(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        ;(child.material as THREE.Material).dispose()
      }
    }
  }

  getCameraState() {
    return {
      pos: [
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
      ] as [number, number, number],
      target: [
        this.controls.target.x,
        this.controls.target.y,
        this.controls.target.z,
      ] as [number, number, number],
    }
  }

  setCameraState(pos: [number, number, number], target: [number, number, number]) {
    this.camera.position.set(...pos)
    this.controls.target.set(...target)
  }

  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  private onResize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (!w || !h) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    this.controls.dispose()
    this.clearGroup()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
