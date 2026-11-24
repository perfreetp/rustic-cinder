/**
 * Paper renderer — PixiJS v8 with the WebGPU backend (WebGL fallback).
 *
 * The folded sheet is drawn into an off-screen render target that owns a depth
 * buffer, so overlapping folds occlude correctly, then that target is presented
 * to the canvas over a procedural studio background. The paper itself is a
 * custom-shaded indexed mesh; its vertex positions and normals are rewritten
 * every frame from the fold solver, which is what makes the lighting track the
 * folded orientation while scrubbing.
 *
 * Depth ordering matters because a folded sheet self-intersects in screen space
 * all the time; without the depth attachment, back faces of a fold would punch
 * through the front ones and the model would flicker as the camera moves.
 */

import {
  Application,
  Buffer,
  BufferUsage,
  Container,
  Geometry,
  GlProgram,
  GpuProgram,
  Mesh,
  RenderTarget,
  Shader,
  Sprite,
  State,
  Texture,
  UniformGroup,
} from 'pixi.js';
import type { MeshBuffers } from '../core/fold';
import type { Material } from '../core/types';
import {
  BG_GLSL_FRAG,
  BG_GLSL_VERT,
  BG_WGSL,
  FLOOR_GLSL_FRAG,
  FLOOR_GLSL_VERT,
  FLOOR_WGSL,
  PAPER_GLSL_FRAG,
  PAPER_GLSL_VERT,
  PAPER_WGSL,
} from './paperShaders';
import { buildCreaseTexture, type CreaseLook, type CreaseTextureResult } from './creaseTexture';
import type { Topology } from '../core/types';
import { DEG2RAD, clamp, mat4Mul, orthographic, perspective } from '../core/math';

export interface OrbitCamera {
  /** Azimuth around +Z, radians. */
  yaw: number;
  /** Elevation above the sheet plane, radians (clamped away from ±90°). */
  elevation: number;
  distance: number;
  target: { x: number; y: number; z: number };
}

export interface RendererStats {
  fps: number;
  frameMs: number;
  triangles: number;
  backend: 'webgpu' | 'webgl';
}

/** Projection style: perspective for the teaching view, ortho for the pattern view. */
export type ProjectionMode = 'perspective' | 'ortho';

export interface PaperRendererOptions {
  canvas: HTMLCanvasElement;
  /** Prefer WebGPU; falls back to WebGL when unavailable. */
  preferWebGPU?: boolean;
  onStats?: (stats: RendererStats) => void;
}

export class PaperRenderer {
  private app: Application;
  private sceneTarget: RenderTarget | null = null;
  private presentSprite: Sprite | null = null;
  private paperMesh: Mesh<Geometry, Shader> | null = null;
  private floorMesh: Mesh<Geometry, Shader> | null = null;
  private bgMesh: Mesh<Geometry, Shader> | null = null;

  private paperGeometry: Geometry | null = null;
  private paperShader: Shader | null = null;
  private creaseTexture: CreaseTextureResult | null = null;
  private creaseLook: CreaseLook = 'seam';
  private lastTopology: import('../core/types').Topology | null = null;
  private cameraUniforms: UniformGroup;
  private bgUniforms: UniformGroup;

  private width = 1;
  private height = 1;
  private renderScale = 1;
  private disposed = false;

  private triangleCount = 0;
  private frameTimes: number[] = [];
  private lastFrame = 0;
  private dirty = true;
  /** True when the scene changed since the last rendered frame. */
  get needsRender(): boolean {
    return this.dirty;
  }

  readonly camera: OrbitCamera = {
    yaw: -62 * DEG2RAD,
    elevation: 40 * DEG2RAD,
    distance: 4.3,
    target: { x: 0, y: 0, z: 0 },
  };

  readonly backend: 'webgpu' | 'webgl';

  /** Projection style; flat mode uses an orthographic top view. */
  projection: ProjectionMode = 'perspective';
  /** Orthographic half-height in world units. */
  orthoHalfHeight = 1.35;

  private constructor(app: Application, backend: 'webgpu' | 'webgl') {
    this.app = app;
    this.backend = backend;
    this.cameraUniforms = new UniformGroup({
      uViewProj: { value: new Float32Array(16), type: 'mat4x4<f32>' },
      uEye: { value: new Float32Array([0, 0, 5, 1]), type: 'vec4<f32>' },
      uLightDir: { value: new Float32Array([0, 0, 1, 0]), type: 'vec4<f32>' },
      uLightColor: { value: new Float32Array([1, 0.97, 0.92, 1]), type: 'vec4<f32>' },
      uAmbient: { value: new Float32Array([0.28, 0.30, 0.36, 1]), type: 'vec4<f32>' },
      uPaperColor: { value: new Float32Array([0.96, 0.91, 0.83, 1]), type: 'vec4<f32>' },
      uParams: { value: new Float32Array([1, 0.55, 0, 1]), type: 'vec4<f32>' },
      uFade: { value: new Float32Array([1, 0, 0, 0]), type: 'vec4<f32>' },
    });
    this.bgUniforms = new UniformGroup({
      uRes: { value: new Float32Array([1, 1, 0, 0]), type: 'vec4<f32>' },
      uParams: { value: new Float32Array([1, 0, 0, 0]), type: 'vec4<f32>' },
    });
  }

  static async create(options: PaperRendererOptions): Promise<PaperRenderer> {
    const preferWebGPU = options.preferWebGPU ?? true;
    const app = new Application();
    let backend: 'webgpu' | 'webgl' = 'webgpu';

    const initWith = async (preference: 'webgpu' | 'webgl') => {
      await app.init({
        canvas: options.canvas,
        preference,
        backgroundAlpha: 1,
        backgroundColor: 0x0b0c10,
        antialias: false, // MSAA lives on the render target
        autoStart: false,
        resizeTo: undefined,
        width: 1,
        height: 1,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      });
    };

    if (preferWebGPU) {
      try {
        await initWith('webgpu');
        backend = 'webgpu';
      } catch {
        await initWith('webgl');
        backend = 'webgl';
      }
    } else {
      await initWith('webgl');
      backend = 'webgl';
    }

    const renderer = new PaperRenderer(app, backend);
    await renderer.setup();
    return renderer;
  }

  /** Which renderer Pixi actually picked (it can differ from what we asked for). */
  get actualBackend(): 'webgpu' | 'webgl' {
    // RendererType.WEBGPU === 2, WEBGL === 1
    return (this.app.renderer as unknown as { type: number }).type === 2 ? 'webgpu' : 'webgl';
  }

  private async setup(): Promise<void> {
    const { stage } = this.app;
    stage.removeChildren();

    // Background quad — a single full-screen triangle pair in clip space.
    const bgGeom = new Geometry({
      attributes: {
        aPosition: new Buffer({
          data: new Float32Array([-1, -1, 3, -1, -1, 3]),
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        }),
      },
    });
    const bgShader = this.makeShader(BG_WGSL, BG_GLSL_VERT, BG_GLSL_FRAG, 'bg', { bg: this.bgUniforms });
    const bgState = new State();
    bgState.blend = false;
    bgState.depthTest = false;
    // The background is a full-screen quad behind everything: it must not write
    // depth, or it would occlude the sheet in the depth-buffered scene pass.
    bgState.depthMask = false;
    this.bgMesh = new Mesh({ geometry: bgGeom, shader: bgShader, state: bgState });
    this.bgMesh.cullable = false;

    // Floor: grid that grounds the fold in space.
    const floorGeom = new Geometry({
      attributes: {
        aPosition: new Buffer({
          data: new Float32Array([-1, -1, 3, -1, -1, 3]),
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
        }),
      },
    });
    const floorShader = this.makeShader(FLOOR_WGSL, FLOOR_GLSL_VERT, FLOOR_GLSL_FRAG, 'floor', {
      cam: this.cameraUniforms,
    });
    const floorState = new State();
    floorState.blend = true;
    floorState.blendMode = 'normal';
    floorState.depthTest = true;
    floorState.depthMask = true;
    floorState.culling = false;
    this.floorMesh = new Mesh({ geometry: floorGeom, shader: floorShader, state: floorState });
    this.floorMesh.cullable = false;

    // Paper mesh geometry is created on the first `setGeometry`.
    this.sceneTarget = new RenderTarget({
      width: 64,
      height: 64,
      depth: true,
      antialias: true,
      colorTextures: 1,
    });

    this.presentSprite = new Sprite(new Texture({ source: this.sceneTarget.colorTexture }));
    this.presentSprite.visible = true;
    this.presentSprite.cullable = false;

    const present = new Container();
    present.addChild(this.presentSprite);
    if (this.bgMesh) stage.addChild(this.bgMesh);
    if (this.floorMesh) stage.addChild(this.floorMesh);
    stage.addChild(present);
    this.present = present;

    // Keep the scene target sized to the canvas.
    this.applySize();
  }

  private present: Container | null = null;

  private makeShader(wgsl: string, glVert: string, glFrag: string, name: string, resources: Record<string, unknown>): Shader {
    const gpuProgram = GpuProgram.from({
      vertex: { source: wgsl, entryPoint: 'mainVS' },
      fragment: { source: wgsl, entryPoint: 'mainFS' },
    });
    const glProgram = GlProgram.from({ vertex: glVert, fragment: glFrag, name: `${name}-paper` });
    return new Shader({ gpuProgram, glProgram, resources });
  }

  /**
   * Rebuild GPU geometry. Called whenever the crease topology changes (the
   * shader reuses the same draw call, only the buffers are replaced).
   */
  setGeometry(buffers: MeshBuffers, topology?: Topology): void {
    const { positions, normals, uvs, indices } = buffers;

    const geometry = new Geometry({
      attributes: {
        // Copies: the solver's scratch arrays are rewritten every frame, and
        // the buffer legs must not alias them or updates would be skipped.
        aPosition: new Buffer({
          data: positions.slice(),
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
          label: 'paper-pos',
        }),
        aNormal: new Buffer({
          data: normals.slice(),
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
          label: 'paper-nrm',
        }),
        aUv: new Buffer({
          data: uvs,
          usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
          label: 'paper-uv',
        }),
      },
      indexBuffer: new Buffer({
        data: indices,
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
        label: 'paper-idx',
      }),
    });

    // Crease seams are baked into a sheet-space texture. It is rebuilt only
    // when the topology changes, never per frame.
    if (topology) {
      this.lastTopology = topology;
      this.creaseTexture?.destroy();
      this.creaseTexture = buildCreaseTexture(topology, this.creaseLook);
    }
    if (this.creaseTexture && this.paperShader) {
      this.paperShader.resources.uCreaseTex = this.creaseTexture.texture.source;
      this.paperShader.resources.uCreaseSampler = this.creaseTexture.texture.source.style;
    }

    if (!this.paperShader) {
      this.paperShader = this.makeShader(PAPER_WGSL, PAPER_GLSL_VERT, PAPER_GLSL_FRAG, 'paper', {
        cam: this.cameraUniforms,
        uCreaseTex: this.creaseTexture?.texture.source ?? Texture.WHITE.source,
        uCreaseSampler: this.creaseTexture?.texture.source.style ?? Texture.WHITE.source.style,
      });
    }

    if (this.paperMesh) {
      const old = this.paperMesh;
      this.app.stage.removeChild(old);
      old.destroy({ children: true });
    }

    const state = new State();
    state.blend = false;
    state.depthTest = true;
    state.depthMask = true;
    state.culling = false;

    const mesh = new Mesh({ geometry, shader: this.paperShader, state });
    mesh.cullable = false;
    this.paperMesh = mesh;
    this.paperGeometry = geometry;
    this.app.stage.addChild(mesh);

    this.triangleCount = indices.length / 3;
    this.dirty = true;
  }

  /**
   * Per-frame vertex update.
   *
   * The solver writes into its own scratch arrays every frame, so the GPU
   * buffers are copied from them and flagged dirty explicitly. Assigning
   * `buffer.data` would not work here: the buffer holds the same array object,
   * so the setter sees "same data" and skips the upload.
   */
  updateGeometry(positions: Float32Array, normals: Float32Array): void {
    const geom = this.paperGeometry;
    if (!geom) return;
    const pos = geom.getBuffer('aPosition');
    const nrm = geom.getBuffer('aNormal');
    if (!pos || !nrm) return;
    const posData = pos.data as Float32Array;
    const nrmData = nrm.data as Float32Array;
    if (posData.length === positions.length && posData !== positions) {
      posData.set(positions);
      nrmData.set(normals);
      pos.update();
      nrm.update();
    }
  }

  /** Switch the crease texture between soft seams and the pattern diagram. */
  setCreaseLook(look: CreaseLook): void {
    if (look === this.creaseLook) return;
    this.creaseLook = look;
    if (!this.lastTopology) return;
    this.creaseTexture?.destroy();
    this.creaseTexture = buildCreaseTexture(this.lastTopology, look);
    if (this.paperShader) {
      this.paperShader.resources.uCreaseTex = this.creaseTexture.texture.source;
      this.paperShader.resources.uCreaseSampler = this.creaseTexture.texture.source.style;
    }
    this.dirty = true;
  }

  setMaterial(material: Material): void {
    const u = this.cameraUniforms.uniforms;
    const [r, g, b] = hexToLinear(material.tint);
    (u.uPaperColor as Float32Array).set([r, g, b, 1]);

    const az = material.azimuth * DEG2RAD;
    const el = material.elevation * DEG2RAD;
    // Key light direction in world space, pushed slightly toward the camera so
    // it always rakes across the visible side of the sheet.
    const lx = Math.cos(el) * Math.cos(az);
    const ly = Math.cos(el) * Math.sin(az);
    const lz = Math.sin(el);
    (u.uLightDir as Float32Array).set([lx, ly, lz, 0]);

    const grade = clamp(material.translucency, 0, 2);
    (u.uParams as Float32Array).set([grade, clamp(material.fiber, 0, 1), 0.9, 1]);

    const amb = clamp(material.ambient, 0, 1);
    (u.uAmbient as Float32Array).set([0.16 + amb * 0.22, 0.17 + amb * 0.23, 0.21 + amb * 0.26, 1]);
    (u.uFade as Float32Array).set([1, 0, 0, 0]);
    this.cameraUniforms.update();
    this.dirty = true;
  }

  resize(width: number, height: number, dpr = 1): void {
    if (this.disposed) return;
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const scale = clamp(dpr, 1, 2);
    if (w === this.width && h === this.height && scale === this.renderScale) return;
    this.width = w;
    this.height = h;
    this.renderScale = scale;
    this.app.renderer.resize(w, h);
    this.applySize();
    this.dirty = true;
  }

  private applySize(): void {
    const rt = this.sceneTarget;
    if (!rt) return;
    const pw = Math.max(1, Math.round(this.width * this.renderScale));
    const ph = Math.max(1, Math.round(this.height * this.renderScale));
    rt.resize(pw, ph, 1);
    if (this.presentSprite) {
      this.presentSprite.width = this.width;
      this.presentSprite.height = this.height;
    }
    (this.bgUniforms.uniforms.uRes as Float32Array).set([this.width, this.height, 0, 0]);
    this.bgUniforms.update();
  }

  orbit(dxPx: number, dyPx: number): void {
    this.camera.yaw -= dxPx * 0.0075;
    this.camera.elevation = clamp(this.camera.elevation + dyPx * 0.006, 6 * DEG2RAD, 87 * DEG2RAD);
    this.dirty = true;
  }

  pan(dxPx: number, dyPx: number): void {
    const scale = this.camera.distance * 0.0016;
    const c = Math.cos(this.camera.yaw);
    const s = Math.sin(this.camera.yaw);
    // Screen-right and screen-up in world space, ignoring elevation for a
    // predictable pan.
    this.camera.target.x -= (dxPx * s + dyPx * c) * scale * -1;
    this.camera.target.y -= (-dxPx * c + dyPx * s) * scale * -1;
    this.dirty = true;
  }

  zoom(deltaY: number): void {
    this.camera.distance = clamp(this.camera.distance * Math.pow(1.0016, deltaY), 1.6, 12);
    this.dirty = true;
  }

  resetCamera(): void {
    this.camera.yaw = -62 * DEG2RAD;
    this.camera.elevation = 40 * DEG2RAD;
    this.camera.distance = 4.3;
    this.camera.target = { x: 0, y: 0, z: 0 };
    this.dirty = true;
  }

  get eye(): { x: number; y: number; z: number } {
    const { yaw, elevation, distance, target } = this.camera;
    const ce = Math.cos(elevation);
    return {
      x: target.x + distance * ce * Math.cos(yaw),
      y: target.y + distance * ce * Math.sin(yaw),
      z: target.z + distance * Math.sin(elevation),
    };
  }

  /** Current view-projection matrix (column-major), for overlay projection. */
  get viewProj(): Float32Array {
    return this.cameraUniforms.uniforms.uViewProj as Float32Array;
  }

  /** Render one frame. Returns false when the frame was skipped (idle). */
  render(): boolean {
    if (!this.sceneTarget || !this.presentSprite) return false;

    const eye = this.eye;
    const vp = composeViewProj(
      this.camera,
      eye,
      this.width / this.height,
      this.projection,
      this.orthoHalfHeight,
    );
    (this.cameraUniforms.uniforms.uViewProj as Float32Array).set(vp);
    (this.cameraUniforms.uniforms.uEye as Float32Array).set([eye.x, eye.y, eye.z, 1]);
    this.cameraUniforms.update();

    // Scene pass → offscreen target with depth. The present sprite must be
    // hidden here: it samples the very texture this pass writes to.
    if (this.present) this.present.visible = false;
    this.setSceneVisible(true);
    this.app.renderer.render({
      container: this.app.stage,
      target: this.sceneTarget,
      clear: true,
      clearColor: [0.035, 0.04, 0.055, 1],
    });

    // Present pass → canvas. Only the sprite showing the finished scene.
    this.setSceneVisible(false);
    if (this.present) this.present.visible = true;
    this.app.renderer.render({
      container: this.app.stage,
      clear: true,
      clearColor: [0, 0, 0, 1],
    });
    this.setSceneVisible(true);
    if (this.present) this.present.visible = false;

    this.dirty = false;
    return true;
  }

  /** Debug: render the scene straight to the canvas, no offscreen target. */
  renderDirect(): void {
    const eye = this.eye;
    const vp = composeViewProj(
      this.camera,
      eye,
      this.width / this.height,
      this.projection,
      this.orthoHalfHeight,
    );
    (this.cameraUniforms.uniforms.uViewProj as Float32Array).set(vp);
    (this.cameraUniforms.uniforms.uEye as Float32Array).set([eye.x, eye.y, eye.z, 1]);
    this.cameraUniforms.update();
    if (this.present) this.present.visible = false;
    this.setSceneVisible(true);
    this.app.renderer.render({ container: this.app.stage, clear: true, clearColor: [0.035, 0.04, 0.055, 1] });
    if (this.present) this.present.visible = true;
  }

  private setSceneVisible(visible: boolean): void {
    if (this.bgMesh) this.bgMesh.visible = visible;
    if (this.floorMesh) this.floorMesh.visible = visible;
    if (this.paperMesh) this.paperMesh.visible = visible;
  }

  /** Frame timing bookkeeping; the app calls this once per rendered frame. */
  markFrame(nowMs: number): RendererStats {
    if (this.lastFrame > 0) {
      const dt = nowMs - this.lastFrame;
      this.frameTimes.push(dt);
      if (this.frameTimes.length > 90) this.frameTimes.shift();
    }
    this.lastFrame = nowMs;
    const avg = this.frameTimes.length
      ? this.frameTimes.reduce((s, v) => s + v, 0) / this.frameTimes.length
      : 16.7;
    return {
      fps: 1000 / Math.max(avg, 0.001),
      frameMs: avg,
      triangles: this.triangleCount,
      backend: this.actualBackend,
    };
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.paperMesh?.destroy({ children: true });
    this.sceneTarget?.destroy();
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }
}

function hexToLinear(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.96, 0.91, 0.83];
  const n = parseInt(m[1], 16);
  const srgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  return srgb.map((c) => c) as [number, number, number];
}

/** Compose view-projection for the orbit camera (+Z up, looking at target). */
export function composeViewProj(
  camera: OrbitCamera,
  eye: { x: number; y: number; z: number },
  aspect: number,
  projection: ProjectionMode = 'perspective',
  orthoHalfHeight = 1.35,
): Float32Array {
  const proj =
    projection === 'ortho'
      ? orthographic(orthoHalfHeight, aspect, 0.05, 80)
      : perspective(36 * DEG2RAD, aspect, 0.05, 60);
  const view = lookAtZUp(eye, camera.target);
  const vp = mat4Mul(proj, view);
  return Float32Array.from(vp);
}

/** lookAt with the world +Z axis as "up", matching the sheet's XY plane. */
function lookAtZUp(eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): number[] {
  let zx = eye.x - target.x;
  let zy = eye.y - target.y;
  let zz = eye.z - target.z;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;

  let xx = -zy;
  let xy = zx;
  let xz = 0;
  let xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-6) {
    // Looking straight down +Z: any horizontal axis works.
    xx = 1;
    xy = 0;
    xz = 0;
    xl = 1;
  }
  xx /= xl;
  xy /= xl;
  xz /= xl;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return [
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye.x + xy * eye.y + xz * eye.z),
    -(yx * eye.x + yy * eye.y + yz * eye.z),
    -(zx * eye.x + zy * eye.y + zz * eye.z),
    1,
  ];
}
