/**
 * 3D 视口：纸面双精度网格、折痕线、后处理（Outline/SSAO/Bloom/Vignette）、
 * 轨道相机、姿态应用与低/高精度两级渲染调度。
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  EffectComposer,
  RenderPass,
  OutlineEffect,
  EffectPass,
  VignetteEffect,
  BloomEffect,
  NormalPass,
  SSAOEffect,
  CopyPass
} from 'postprocessing'
import { createPaperMaterial, LIGHT_RIGS } from './paperShader.js'
import { ContactShadow } from './contactShadow.js'

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(new THREE.Color('#1b1e24'), 1)

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
    this.camera.position.set(7, -9, 8)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08

    this.shadow = new ContactShadow(1024)
    this.paperMaterial = createPaperMaterial(this.shadow.uniforms)
    this.lowMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#e6dcc8'),
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide
    })

    this.group = new THREE.Group()
    this.scene.add(this.group)

    // 低精度网格使用 MeshStandardMaterial，需要场景光源（高精度纸面
    // 着色器自带漫反射/轮廓光，不依赖这些光）
    this.scene.add(new THREE.HemisphereLight(0xf5eddb, 0x2a2d34, 0.85))
    const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.6)
    keyLight.position.set(4, 5, 7)
    this.scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xbfd0ff, 0.5)
    fillLight.position.set(-5, -2, 4)
    this.scene.add(fillLight)
    this.paperMesh = null
    this.lowMesh = null
    this.creaseLines = null
    this.selectionHelper = null
    this._selectedCreaseId = null

    this._buildComposer()
    this._shadowDirty = true
    this._rafPending = false
    this._boundLoop = this._loop.bind(this)
    this._loop()
  }

  _buildComposer() {
    const composer = new EffectComposer(this.renderer)
    composer.addPass(new RenderPass(this.scene, this.camera))

    const normalPass = new NormalPass(this.scene, this.camera)
    const ssao = new SSAOEffect(this.camera, normalPass.texture, {
      samples: 9,
      radius: 0.12,
      intensity: 22,
      luminanceInfluence: 0.6,
      color: new THREE.Color('#000000')
    })
    const outline = new OutlineEffect(this.scene, this.camera, {
      edgeStrength: 3.2,
      edgeGlow: 0.4,
      pulseSpeed: 1.4,
      visibleEdgeColor: new THREE.Color('#ff9d2e'),
      hiddenEdgeColor: new THREE.Color('#7a4a16'),
      blur: true,
      xRay: true
    })
    const bloom = new BloomEffect({
      intensity: 0.22,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.2,
      mipmapBlur: true
    })
    const vignette = new VignetteEffect({ darkness: 0.32, offset: 0.28 })

    this.outlineEffect = outline
    this.effectPass = new EffectPass(
      this.camera,
      ssao,
      outline,
      bloom,
      vignette
    )
    composer.addPass(normalPass)
    composer.addPass(this.effectPass)
    composer.addPass(new CopyPass())
    this.composer = composer
  }

  /** 用新模型的两套网格替换场景内容 */
  setModel(model, meshes, onPickCrease) {
    this._disposeModel()
    this.model = model
    this.meshes = meshes
    this.onPickCrease = onPickCrease
    this._selectedCreaseId = null

    const hi = meshes.high
    const hiGeo = new THREE.BufferGeometry()
    hiGeo.setAttribute('position', new THREE.BufferAttribute(hi.positions.slice(), 3))
    hiGeo.setAttribute('uv', new THREE.BufferAttribute(hi.uvs, 2))
    hiGeo.setIndex(new THREE.BufferAttribute(hi.indices, 1))
    hiGeo.computeVertexNormals()
    this.paperMesh = new THREE.Mesh(hiGeo, this.paperMaterial)
    this.group.add(this.paperMesh)

    const lo = meshes.low
    const loGeo = new THREE.BufferGeometry()
    loGeo.setAttribute('position', new THREE.BufferAttribute(lo.positions.slice(), 3))
    loGeo.setAttribute('uv', new THREE.BufferAttribute(lo.uvs, 2))
    loGeo.setIndex(new THREE.BufferAttribute(lo.indices, 1))
    loGeo.computeVertexNormals()
    this.lowMesh = new THREE.Mesh(loGeo, this.lowMaterial)
    this.lowMesh.visible = false
    this.group.add(this.lowMesh)

    this._buildCreaseLines(model)
    this.shadow.fit(model.bounds)
    this.frameCamera(model.bounds)
    this._setOutlineSelection([])
    this.invalidateShadow()
  }

  _buildCreaseLines(model) {
    const group = new THREE.Group()
    this.creaseLineMap = new Map()
    const valleyMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#2f7de1'),
      transparent: true,
      opacity: 0.95
    })
    const mountainMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#e14b3c'),
      transparent: true,
      opacity: 0.95
    })
    const borderMat = new THREE.LineBasicMaterial({
      color: new THREE.Color('#3a3a3a'),
      transparent: true,
      opacity: 0.8
    })

    for (const edge of this.meshes.high.creaseEdges) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(edge.a[0], edge.a[1], 0.012),
        new THREE.Vector3(edge.b[0], edge.b[1], 0.012)
      ])
      const line = new THREE.Line(
        geo,
        edge.type === 'valley' ? valleyMat : mountainMat
      )
      line.userData.creaseId = edge.creaseId
      group.add(line)
      if (!this.creaseLineMap.has(edge.creaseId)) {
        this.creaseLineMap.set(edge.creaseId, [])
      }
      this.creaseLineMap.get(edge.creaseId).push(line)
    }
    const borderPts = model.border.map(
      (p) => new THREE.Vector3(p[0], p[1], 0.012)
    )
    borderPts.push(borderPts[0].clone())
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts)
    group.add(new THREE.Line(borderGeo, borderMat))
    this.group.add(group)
    this.creaseLines = group
  }

  frameCamera(bounds) {
    const f = Math.max(bounds.width, bounds.height)
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2
    this.controls.target.set(cx, cy, 0)
    const d = f * 1.35
    this.camera.position.set(cx + d * 0.55, cy - d * 0.7, d * 0.85)
    this.controls.update()
  }

  /** 高精度：写入细分网格位置并重算法线 */
  applyHighPositions(positions) {
    const attr = this.paperMesh.geometry.getAttribute('position')
    attr.array.set(positions)
    attr.needsUpdate = true
    this.paperMesh.geometry.computeVertexNormals()
    this._updateCreaseLinesFromMesh()
    this.invalidateShadow()
  }

  /** 低精度：播放/拖动时先更新粗网格，保证交互帧率 */
  applyLowPositions(positions) {
    const attr = this.lowMesh.geometry.getAttribute('position')
    attr.array.set(positions)
    attr.needsUpdate = true
    this.lowMesh.geometry.computeVertexNormals()
    this._updateCreaseLinesFromMesh()
  }

  setQualityMode(high) {
    this.lowMesh.visible = !high
    this.paperMesh.visible = high
    this.paperMaterial.uniforms.uHighQuality.value = high ? 1 : 0
    this.invalidateShadow()
  }

  _updateCreaseLinesFromMesh() {
    if (!this.creaseLineMap || !this.paperMesh) return
    const pos = this.paperMesh.geometry.getAttribute('position')
    // 折痕线端点从高网格最近顶点取 z，x/y 用自身矩阵变换
    for (const [, lines] of this.creaseLineMap) {
      for (const line of lines) {
        const attr = line.geometry.getAttribute('position')
        for (let i = 0; i < attr.count; i++) {
          const x = attr.getX(i)
          const y = attr.getY(i)
          const z = this._sampleMeshZ(pos, x, y)
          attr.setZ(i, z + 0.014)
        }
        attr.needsUpdate = true
      }
    }
  }

  _sampleMeshZ(posAttr, x, y) {
    let best = 1e9
    let z = 0
    for (let i = 0; i < posAttr.count; i++) {
      const dx = posAttr.getX(i) - x
      const dy = posAttr.getY(i) - y
      const d2 = dx * dx + dy * dy
      if (d2 < best) {
        best = d2
        z = posAttr.getZ(i)
      }
    }
    return z
  }

  setLightRig(index) {
    this.paperMaterial.uniforms.uLightRig.value = index
    this.currentRig = index
  }

  get lightRigName() {
    return LIGHT_RIGS[this.currentRig ?? 0].name
  }

  selectCrease(creaseId) {
    this._selectedCreaseId = creaseId
    const selected = []
    if (creaseId && this.creaseLineMap?.has(creaseId)) {
      selected.push(...this.creaseLineMap.get(creaseId))
    }
    this._setOutlineSelection(selected)
  }

  _setOutlineSelection(objects) {
    this.outlineEffect.selection.set(objects)
  }

  /** 射线拾取折痕 */
  pickCrease(ndcX, ndcY) {
    if (!this.creaseLineMap) return null
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const targets = []
    for (const lines of this.creaseLineMap.values()) targets.push(...lines)
    const hits = ray.intersectObjects(targets, false)
    if (!hits.length) return null
    return hits[0].object.userData.creaseId ?? null
  }

  invalidateShadow() {
    this._shadowDirty = true
  }

  setSize(w, h) {
    if (w <= 0 || h <= 0) return
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  _loop() {
    requestAnimationFrame(this._boundLoop)
    this.controls.update()
    if (this._shadowDirty && this.paperMesh && this.paperMesh.visible) {
      // 仅把纸面网格放进阴影场景
      const tmpScene = new THREE.Scene()
      tmpScene.add(this.paperMesh)
      this.shadow.render(this.renderer, tmpScene)
      this._shadowDirty = false
    }
    this.composer.render()
  }

  /** 导出当前帧 PNG（保留绘制缓冲后截屏） */
  capturePNG() {
    this.composer.render()
    return this.renderer.domElement.toDataURL('image/png')
  }

  _disposeModel() {
    if (this.paperMesh) {
      this.paperMesh.geometry.dispose()
      this.group.remove(this.paperMesh)
      this.paperMesh = null
    }
    if (this.lowMesh) {
      this.lowMesh.geometry.dispose()
      this.group.remove(this.lowMesh)
      this.lowMesh = null
    }
    if (this.creaseLines) {
      this.creaseLines.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) o.material.dispose()
      })
      this.group.remove(this.creaseLines)
      this.creaseLines = null
    }
    this.creaseLineMap = null
  }

  dispose() {
    this._disposeModel()
    this.paperMaterial.dispose()
    this.lowMaterial.dispose()
    this.shadow.dispose()
    this.composer.dispose()
    this.controls.dispose()
    this.renderer.dispose()
  }
}
