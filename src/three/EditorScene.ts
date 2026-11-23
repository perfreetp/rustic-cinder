import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
  ObjectBVH,
} from 'three-mesh-bvh'
import type { Hold, HoldColor, RouteHold } from '@/types'
import type { RouteMetrics } from '@/lib/grade'
import { buildRouteCurve } from '@/lib/routeCurve'
import { wallNormal, wallZ, WALL_HEIGHT } from './demoData'
import type { WallDataset } from '@/types'

// three-mesh-bvh 挂载到原型，岩壁射线检测走 BVH 加速
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree

export interface HoverInfo {
  x: number
  y: number
  id: number
  normal: THREE.Vector3
}

export interface EditorCallbacks {
  onPickHold: (holdId: number, additive: boolean) => void
  onBoxSelect: (holdIds: number[], additive: boolean) => void
  onPickBlank: () => void
  onHover: (info: HoverInfo | null) => void
  /** 拖拽岩点结束/进行中，Hold 对象已就地更新位置与法线 */
  onHoldMoved: (holdId: number, committing: boolean) => void
}

const DRAG_CLICK_MS = 450

/** 岩点共享的低模岩石几何 */
function createRockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 1)
  const p = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const k = 1 + 0.18 * Math.sin(i * 12.9898) * Math.cos(i * 78.233)
    v.multiplyScalar(k)
    v.y *= 0.82
    p.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const spikes = 5
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? 1 : 0.45
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  return new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false })
}

export class EditorScene {
  readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly raycaster = new THREE.Raycaster()
  private readonly clock = new THREE.Clock()
  private readonly rafId = { current: 0 }
  private readonly resizeObs: ResizeObserver

  private readonly dataset: WallDataset
  private readonly holds: Hold[]
  private readonly callbacks: EditorCallbacks

  private readonly wallMesh: THREE.Mesh
  private readonly holdMesh: THREE.InstancedMesh
  /** 岩点实例的对象级 BVH：每个实例一个叶节点，raycast 直接给 instanceId */
  private holdBVH: InstanceType<typeof ObjectBVH> | null = null
  private readonly baseColors: THREE.Color[] = []
  private colorFilter: Set<HoldColor> | null = null

  // 悬停高亮
  private readonly hoverMarker: THREE.Mesh
  private readonly normalArrow: THREE.ArrowHelper
  private hoveredId: number | null = null
  private hoverDirty = false

  // 路线可视化
  private readonly routeGroup = new THREE.Group()
  private curveMesh: THREE.Mesh | null = null
  private readonly ringMesh: THREE.InstancedMesh
  private readonly startMarker: THREE.Mesh
  private readonly bonusMarker: THREE.Mesh
  private readonly topMarker: THREE.Mesh
  private labelSprites = new Map<number, THREE.Sprite>()
  private routeHoldIds = new Set<number>()

  // 指针状态
  private pointerDown = false
  private downPos = { x: 0, y: 0 }
  private downTime = 0
  private marqueeActive = false
  private marqueeEl: HTMLDivElement
  private dragHoldId: number | null = null
  private readonly tmpMatrix = new THREE.Matrix4()
  private readonly tmpQuat = new THREE.Quaternion()
  private readonly tmpScale = new THREE.Vector3()
  private readonly tmpVec = new THREE.Vector3()
  private readonly tmpVec2 = new THREE.Vector3()

  constructor(
    private readonly container: HTMLElement,
    dataset: WallDataset,
    callbacks: EditorCallbacks,
  ) {
    this.dataset = dataset
    this.holds = dataset.holds
    this.callbacks = callbacks

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color('#10141b')
    this.scene.fog = new THREE.Fog('#10141b', 16, 34)

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.05,
      100,
    )
    this.camera.position.set(0.6, WALL_HEIGHT * 0.55, 9.2)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, WALL_HEIGHT * 0.5, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxDistance = 20
    this.controls.minDistance = 1.2

    this.addLights()

    // ---- 岩壁：半透明、FrontSide、深度写入，保证与弧线交叠排序正确 ----
    const wallMat = new THREE.MeshStandardMaterial({
      color: '#b9c0cc',
      roughness: 0.92,
      metalness: 0,
      transparent: true,
      opacity: 0.42,
      depthWrite: true,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    })
    const wallGeo = dataset.wallGeometry
    wallGeo.computeBoundsTree()
    this.wallMesh = new THREE.Mesh(wallGeo, wallMat)
    this.wallMesh.raycast = acceleratedRaycast
    this.wallMesh.renderOrder = 0
    this.scene.add(this.wallMesh)

    // 岩壁边框，强化半透明轮廓
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(wallGeo, 30),
      new THREE.LineBasicMaterial({
        color: '#7d8595',
        transparent: true,
        opacity: 0.35,
      }),
    )
    this.scene.add(edges)

    // ---- 1200 岩点实例 ----
    const rockGeo = createRockGeometry()
    const holdMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.55,
      metalness: 0.05,
    })
    this.holdMesh = new THREE.InstancedMesh(rockGeo, holdMat, this.holds.length)
    this.holdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.holdMesh.frustumCulled = false
    this.holdMesh.renderOrder = 1
    this.writeHoldInstances()
    // 岩点拾取走 three-mesh-bvh：以 InstancedMesh 为根构建对象级 BVH，
    // 每个实例作为独立叶节点，raycast 命中直接返回 instanceId
    this.holdBVH = new ObjectBVH(this.holdMesh)
    this.scene.add(this.holdMesh)

    // ---- 选中环 ----
    this.ringMesh = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1, 0.12, 8, 28),
      new THREE.MeshBasicMaterial({
        color: '#37e0ff',
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
      this.holds.length,
    )
    this.ringMesh.frustumCulled = false
    this.ringMesh.count = 0
    this.ringMesh.renderOrder = 3
    this.scene.add(this.ringMesh)

    // ---- 三种端点标记 ----
    this.startMarker = new THREE.Mesh(
      new THREE.ConeGeometry(0.11, 0.24, 16),
      new THREE.MeshStandardMaterial({
        color: '#2ecc71',
        emissive: '#145a32',
        emissiveIntensity: 0.6,
        roughness: 0.4,
      }),
    )
    this.bonusMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.12),
      new THREE.MeshStandardMaterial({
        color: '#ffd34d',
        emissive: '#7a5b00',
        emissiveIntensity: 0.6,
        roughness: 0.3,
      }),
    )
    this.topMarker = new THREE.Mesh(
      starGeometry(),
      new THREE.MeshStandardMaterial({
        color: '#b06bff',
        emissive: '#4a1f7a',
        emissiveIntensity: 0.7,
        roughness: 0.35,
      }),
    )
    for (const m of [this.startMarker, this.bonusMarker, this.topMarker]) {
      m.visible = false
      m.renderOrder = 4
      this.routeGroup.add(m)
    }

    // ---- 悬停高亮壳 + 法线箭头 ----
    this.hoverMarker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        wireframe: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    )
    this.hoverMarker.visible = false
    this.hoverMarker.renderOrder = 5
    this.scene.add(this.hoverMarker)

    this.normalArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      0.35,
      0x37e0ff,
      0.09,
      0.05,
    )
    this.normalArrow.visible = false
    this.normalArrow.renderOrder = 5
    this.scene.add(this.normalArrow)

    this.scene.add(this.routeGroup)

    // ---- 框选矩形 ----
    this.marqueeEl = document.createElement('div')
    this.marqueeEl.className = 'marquee-rect'
    this.marqueeEl.style.display = 'none'
    container.appendChild(this.marqueeEl)

    this.bindPointerEvents()

    this.resizeObs = new ResizeObserver(() => this.handleResize())
    this.resizeObs.observe(container)

    this.animate()
  }

  private addLights(): void {
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.55))
    const key = new THREE.DirectionalLight('#fff4e0', 1.5)
    key.position.set(4, 8, 9)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight('#9fc4ff', 0.7)
    fill.position.set(-6, 3, 6)
    this.scene.add(fill)
    const rim = new THREE.PointLight('#ffd9a0', 0.6, 20)
    rim.position.set(0, WALL_HEIGHT + 1, 3)
    this.scene.add(rim)
  }

  // ---------------------------------------------------------------- 实例写入

  private writeHoldInstances(): void {
    const color = new THREE.Color()
    this.holds.forEach((h, i) => {
      this.tmpVec.set(...h.position)
      this.tmpQuat.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        this.tmpVec2.set(...h.normal).normalize(),
      )
      this.tmpScale.setScalar(h.scale)
      this.tmpMatrix.compose(this.tmpVec, this.tmpQuat, this.tmpScale)
      this.holdMesh.setMatrixAt(i, this.tmpMatrix)
      color.set(h.color)
      this.holdMesh.setColorAt(i, color)
      this.baseColors[i] = color.clone()
    })
    this.holdMesh.instanceMatrix.needsUpdate = true
    if (this.holdMesh.instanceColor) this.holdMesh.instanceColor.needsUpdate = true
  }

  private updateHoldInstance(holdId: number): void {
    const idx = this.holds.findIndex((h) => h.id === holdId)
    if (idx < 0) return
    const h = this.holds[idx]
    this.tmpVec.set(...h.position)
    this.tmpQuat.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      this.tmpVec2.set(...h.normal).normalize(),
    )
    this.tmpScale.setScalar(h.scale)
    this.tmpMatrix.compose(this.tmpVec, this.tmpQuat, this.tmpScale)
    this.holdMesh.setMatrixAt(idx, this.tmpMatrix)
    this.holdMesh.instanceMatrix.needsUpdate = true
  }

  /** 拖拽改变实例矩阵后重建对象级 BVH（1200 实例构建约毫秒级） */
  private rebuildHoldBVH(): void {
    this.holdMesh.updateMatrixWorld(true)
    this.holdBVH = new ObjectBVH(this.holdMesh)
  }

  // ---------------------------------------------------------------- 颜色筛选

  setColorFilter(colors: Set<HoldColor> | null): void {
    this.colorFilter = colors
    const gray = new THREE.Color('#39404a')
    const color = new THREE.Color()
    this.holds.forEach((h, i) => {
      if (colors && !colors.has(h.color)) color.copy(gray)
      else color.copy(this.baseColors[i])
      this.holdMesh.setColorAt(i, color)
    })
    if (this.holdMesh.instanceColor) this.holdMesh.instanceColor.needsUpdate = true
  }

  private isPickable(h: Hold): boolean {
    return !this.colorFilter || this.colorFilter.has(h.color)
  }

  // ---------------------------------------------------------------- 射线拾取

  /**
   * three-mesh-bvh 加速的岩点拾取：对实例对象级 BVH 做射线检测，
   * 命中结果带 instanceId；再按颜色筛选取最近的可拾取实例。
   */
  private pickHold(clientX: number, clientY: number): Hold | null {
    if (!this.holdBVH) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    this.raycaster.firstHitOnly = true

    const hits: THREE.Intersection[] = []
    this.holdBVH.raycast(this.raycaster, hits)
    // firstHitOnly 已按距离排序；找到第一个通过颜色筛选的实例
    for (const hit of hits) {
      const idx = hit.instanceId
      if (idx === undefined) continue
      const h = this.holds[idx]
      if (h && this.isPickable(h)) return h
    }
    return null
  }

  /** 屏幕坐标拾取岩点（供自动化测试与外部调用） */
  pickAtScreen(clientX: number, clientY: number): Hold | null {
    return this.pickHold(clientX, clientY)
  }

  /** 岩点世界坐标投影到 NDC（供自动化测试定位拖拽起点） */
  projectHoldToScreen(holdId: number): { x: number; y: number; z: number } {
    const hold = this.holds.find((h) => h.id === holdId)
    const v = new THREE.Vector3(...(hold?.position ?? [0, 0, 0]))
    v.project(this.camera)
    return { x: v.x, y: v.y, z: v.z }
  }

  /** 射线投到岩壁 BVH，返回墙面交点（拖拽用） */
  private projectToWall(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    this.raycaster.firstHitOnly = true
    const hits: THREE.Intersection[] = []
    this.wallMesh.raycast(this.raycaster, hits)
    return hits.length ? hits[0].point : null
  }

  // ---------------------------------------------------------------- 指针交互

  private bindPointerEvents(): void {
    const el = this.renderer.domElement
    // capture 阶段先于 OrbitControls 处理；决定交互意图后再决定是否放行
    el.addEventListener('pointerdown', this.onPointerDown, true)
    el.addEventListener('pointermove', this.onPointerMove, true)
    el.addEventListener('pointerup', this.onPointerUp, true)
    el.addEventListener('pointercancel', this.onPointerUp, true)
    el.addEventListener('pointerleave', this.onPointerLeave)
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    this.pointerDown = true
    this.downPos = { x: e.clientX, y: e.clientY }
    this.downTime = performance.now()

    const hit = this.pickHold(e.clientX, e.clientY)
    if (hit) {
      if (this.routeHoldIds.has(hit.id)) {
        // 拖拽路线内岩点：拦截事件，轨道控制器不参与
        this.dragHoldId = hit.id
        this.controls.enabled = false
        this.setHover(null)
      }
      // 命中任意岩点都拦截，避免点选变成旋转相机
      e.stopPropagation()
      e.preventDefault()
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    // 拖拽岩点：投影到岩壁 BVH，实时移动并重算弧线
    if (this.dragHoldId !== null) {
      e.stopPropagation()
      const point = this.projectToWall(e.clientX, e.clientY)
      if (point) {
        const hold = this.holds.find((h) => h.id === this.dragHoldId)!
        const n = wallNormal(point.x, point.y)
        hold.position = [point.x, point.y, wallZ(point.x, point.y) + 0.035]
        hold.normal = [n.x, n.y, n.z]
        this.updateHoldInstance(hold.id)
        this.callbacks.onHoldMoved(hold.id, false)
      }
      return
    }

    if (this.pointerDown) {
      const dx = e.clientX - this.downPos.x
      const dy = e.clientY - this.downPos.y
      if (!this.marqueeActive && Math.hypot(dx, dy) > 5) {
        this.marqueeActive = true
        this.controls.enabled = false
        this.marqueeEl.style.display = 'block'
      }
      if (this.marqueeActive) {
        // 框选期间持续拦截，相机保持不动
        e.stopPropagation()
        this.updateMarquee(e.clientX, e.clientY)
      }
      return
    }

    // 悬停检测（rAF 合并，避免鼠标移动事件风暴）
    this.hoverDirty = true
    this.pendingHover = { x: e.clientX, y: e.clientY }
  }

  private pendingHover: { x: number; y: number } | null = null

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointerDown && this.dragHoldId === null) return
    const wasDragging = this.dragHoldId !== null
    const wasMarquee = this.marqueeActive
    const elapsed = performance.now() - this.downTime

    if (wasDragging || wasMarquee) e.stopPropagation()

    if (wasDragging) {
      this.callbacks.onHoldMoved(this.dragHoldId!, true)
      // 拖拽改变了实例矩阵，重建对象级 BVH 使后续拾取命中新位置
      this.rebuildHoldBVH()
      this.dragHoldId = null
      this.controls.enabled = true
    } else if (wasMarquee) {
      const ids = this.collectMarqueeHolds()
      this.callbacks.onBoxSelect(ids, e.shiftKey)
      this.marqueeActive = false
      this.controls.enabled = true
      this.marqueeEl.style.display = 'none'
    } else if (elapsed < DRAG_CLICK_MS && this.pointerDown) {
      const hit = this.pickHold(e.clientX, e.clientY)
      if (hit) this.callbacks.onPickHold(hit.id, e.shiftKey)
      else this.callbacks.onPickBlank()
    }

    this.pointerDown = false
  }

  private onPointerLeave = (): void => {
    this.setHover(null)
    this.hoverDirty = false
    this.pendingHover = null
  }

  private updateMarquee(clientX: number, clientY: number): void {
    const rect = this.container.getBoundingClientRect()
    const x0 = this.downPos.x - rect.left
    const y0 = this.downPos.y - rect.top
    const x1 = clientX - rect.left
    const y1 = clientY - rect.top
    const left = Math.min(x0, x1)
    const top = Math.min(y0, y1)
    this.marqueeEl.style.left = `${left}px`
    this.marqueeEl.style.top = `${top}px`
    this.marqueeEl.style.width = `${Math.abs(x1 - x0)}px`
    this.marqueeEl.style.height = `${Math.abs(y1 - y0)}px`
  }

  /** 框选：屏幕矩形反投影 NDC，候选岩点投影测试，自动应用颜色筛选 */
  private collectMarqueeHolds(): number[] {
    const rect = this.container.getBoundingClientRect()
    const x0 = ((this.downPos.x - rect.left) / rect.width) * 2 - 1
    const x1px = this.downPos.x + parseFloat(this.marqueeEl.style.width)
    const y1px = this.downPos.y + parseFloat(this.marqueeEl.style.height)
    const x1 = ((x1px - rect.left) / rect.width) * 2 - 1
    const y0Ndc = -((this.downPos.y - rect.top) / rect.height) * 2 + 1
    const y1Ndc = -((y1px - rect.top) / rect.height) * 2 + 1
    const minX = Math.min(x0, x1)
    const maxX = Math.max(x0, x1)
    const minY = Math.min(y0Ndc, y1Ndc)
    const maxY = Math.max(y0Ndc, y1Ndc)

    const projected = new THREE.Vector3()
    const ids: number[] = []
    for (const h of this.holds) {
      if (!this.isPickable(h)) continue
      projected.set(...h.position).project(this.camera)
      if (projected.z > 1) continue
      if (
        projected.x >= minX &&
        projected.x <= maxX &&
        projected.y >= minY &&
        projected.y <= maxY
      ) {
        ids.push(h.id)
      }
    }
    return ids
  }

  // ---------------------------------------------------------------- 悬停

  private setHover(hold: Hold | null, client?: { x: number; y: number }): void {
    if (!hold) {
      if (this.hoveredId !== null) {
        this.hoveredId = null
        this.hoverMarker.visible = false
        this.normalArrow.visible = false
        this.callbacks.onHover(null)
      }
      return
    }
    this.hoveredId = hold.id
    const p = new THREE.Vector3(...hold.position)
    const n = new THREE.Vector3(...hold.normal)
    this.hoverMarker.position.copy(p)
    this.hoverMarker.scale.setScalar(hold.scale * 1.5)
    this.hoverMarker.visible = true
    this.normalArrow.position.copy(p)
    this.normalArrow.setDirection(n)
    this.normalArrow.visible = true
    this.callbacks.onHover({
      x: client?.x ?? 0,
      y: client?.y ?? 0,
      id: hold.id,
      normal: n,
    })
  }

  // ---------------------------------------------------------------- 路线渲染

  /**
   * 重建整条路线可视化：平滑弧 + 选中环 + 端点标记 + 序号标签。
   * 任意中间岩点拖动后调用，样条切线整体重算。
   */
  setRouteView(
    orderedHolds: Hold[],
    entries: RouteHold[],
    metrics: RouteMetrics | null,
  ): void {
    this.routeHoldIds = new Set(orderedHolds.map((h) => h.id))

    // 旧弧线与标签释放
    if (this.curveMesh) {
      this.routeGroup.remove(this.curveMesh)
      this.curveMesh.geometry.dispose()
      ;(this.curveMesh.material as THREE.Material).dispose()
      this.curveMesh = null
    }
    this.labelSprites.forEach((s) => {
      this.routeGroup.remove(s)
      s.material.map?.dispose()
      s.material.dispose()
    })
    this.labelSprites.clear()

    const built = buildRouteCurve(orderedHolds, metrics)
    if (built) {
      // 弧线透明且不写深度：在半透明岩壁之后绘制，交叠处不闪烁
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.32,
        metalness: 0.08,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
      })
      this.curveMesh = new THREE.Mesh(built.geometry, mat)
      this.curveMesh.renderOrder = 2
      this.routeGroup.add(this.curveMesh)
    }

    // 端点标记定位
    const placeMarker = (
      marker: THREE.Mesh,
      kind: 'start' | 'bonus' | 'top',
    ): void => {
      const entry = entries.find((en) => en.endpoint === kind)
      const hold = entry
        ? orderedHolds.find((h) => h.id === entry.holdId)
        : undefined
      if (!hold) {
        marker.visible = false
        return
      }
      const n = new THREE.Vector3(...hold.normal)
      marker.position
        .set(...hold.position)
        .addScaledVector(n, hold.scale + 0.16)
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
      marker.visible = true
    }
    placeMarker(this.startMarker, 'start')
    placeMarker(this.bonusMarker, 'bonus')
    placeMarker(this.topMarker, 'top')

    // 序号标签
    orderedHolds.forEach((h, i) => {
      const sprite = this.makeLabelSprite(String(i + 1))
      sprite.position
        .set(...h.position)
        .addScaledVector(new THREE.Vector3(...h.normal), h.scale + 0.1)
      this.labelSprites.set(h.id, sprite)
      this.routeGroup.add(sprite)
    })
  }

  /** 选中环：框选/点选的岩点集合 */
  setSelection(holdIds: Set<number>): void {
    let count = 0
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const zAxis = new THREE.Vector3(0, 0, 1)
    const scale = new THREE.Vector3()
    this.holds.forEach((h) => {
      if (!holdIds.has(h.id)) return
      pos.set(...h.position)
      quat.setFromUnitVectors(zAxis, new THREE.Vector3(...h.normal))
      const s = h.scale * 1.45
      scale.set(s, s, s)
      this.tmpMatrix.compose(pos, quat, scale)
      this.ringMesh.setMatrixAt(count++, this.tmpMatrix)
    })
    this.ringMesh.count = count
    this.ringMesh.instanceMatrix.needsUpdate = true
  }

  private makeLabelSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.beginPath()
    ctx.arc(64, 64, 52, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(15,22,34,0.85)'
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#37e0ff'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 64px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 64, 68)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.scale.setScalar(0.26)
    sprite.renderOrder = 4
    return sprite
  }

  // ---------------------------------------------------------------- 相机同步

  getCameraState(): { pos: [number, number, number]; target: [number, number, number] } {
    return {
      pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [
        this.controls.target.x,
        this.controls.target.y,
        this.controls.target.z,
      ],
    }
  }

  setCameraState(pos: [number, number, number], target: [number, number, number]): void {
    this.camera.position.set(...pos)
    this.controls.target.set(...target)
  }

  // ---------------------------------------------------------------- 主循环

  private animate = (): void => {
    this.rafId.current = requestAnimationFrame(this.animate)
    const t = this.clock.getElapsedTime()

    if (this.hoverDirty) {
      this.hoverDirty = false
      const p = this.pendingHover
      this.pendingHover = null
      if (p) {
        const hit = this.pickHold(p.x, p.y)
        this.setHover(hit, p)
      }
    }

    if (this.hoverMarker.visible) {
      const pulse = 1 + 0.12 * Math.sin(t * 6)
      const h = this.holds.find((x) => x.id === this.hoveredId)
      if (h) this.hoverMarker.scale.setScalar(h.scale * 1.5 * pulse)
      this.hoverMarker.rotation.y = t * 1.5
    }

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  private handleResize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId.current)
    this.resizeObs.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onPointerDown, true)
    el.removeEventListener('pointermove', this.onPointerMove, true)
    el.removeEventListener('pointerup', this.onPointerUp, true)
    el.removeEventListener('pointercancel', this.onPointerUp, true)
    el.removeEventListener('pointerleave', this.onPointerLeave)
    this.controls.dispose()
    this.dataset.wallGeometry.disposeBoundsTree?.()
    this.renderer.dispose()
    this.marqueeEl.remove()
    el.remove()
  }
}
