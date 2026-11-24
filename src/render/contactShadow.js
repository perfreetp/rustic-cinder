/**
 * 接触阴影：从纸面上方的正交相机渲染场景深度，
 * 纸面着色器按世界坐标投影采样深度，得到软接触阴影。
 * 低精度播放时跳过重渲染，复用最近一帧深度图。
 */
import * as THREE from 'three'

export class ContactShadow {
  constructor(size = 1024) {
    this.size = size
    this.target = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.DepthFormat,
      type: THREE.UnsignedShortType,
      depthBuffer: true,
      stencilBuffer: false
    })
    // three 会为 DepthFormat 自动创建 DepthTexture；显式取出确保采样
    if (!this.target.depthTexture) {
      this.target.depthTexture = new THREE.DepthTexture(size, size)
      this.target.depthTexture.type = THREE.UnsignedShortType
    }
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40)
    this.camera.position.set(0, 0, 12)
    this.camera.lookAt(0, 0, 0)
    this._frustum = 8
    this._shadowMatrix = new THREE.Matrix4()
    this._biasMat = new THREE.Matrix4().set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1
    )
    this.depthMaterial = new THREE.MeshDepthMaterial({
      side: THREE.DoubleSide,
      depthPacking: THREE.BasicDepthPacking
    })
  }

  /** 按模型包围盒调整正交范围 */
  fit(bounds) {
    const f = Math.max(bounds.width, bounds.height) * 0.72
    this._frustum = f
    this.camera.left = -f
    this.camera.right = f
    this.camera.top = f
    this.camera.bottom = -f
    this.camera.updateProjectionMatrix()
  }

  get uniforms() {
    return {
      shadowMap: { value: this.target.depthTexture },
      shadowMatrix: { value: this._shadowMatrix },
      shadowTexel: { value: new THREE.Vector2(1 / this.size, 1 / this.size) }
    }
  }

  /**
   * 渲染深度并更新阴影矩阵。
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene 只包含纸面网格的场景（折痕线不投影）
   */
  render(renderer, scene) {
    const prevTarget = renderer.getRenderTarget()
    const prevOverride = scene.overrideMaterial
    scene.overrideMaterial = this.depthMaterial
    renderer.setRenderTarget(this.target)
    renderer.clear(true, true, true)
    renderer.render(scene, this.camera)
    renderer.setRenderTarget(prevTarget)
    scene.overrideMaterial = prevOverride
    this._shadowMatrix
      .multiplyMatrices(this._biasMat, this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse)
  }

  dispose() {
    this.target.dispose()
    this.depthMaterial.dispose()
  }
}
