import {
  ArcRotateCamera,
  Color3,
  Color4,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Plane,
  PointerEventTypes,
  Quaternion,
  Scalar,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData
} from '@babylonjs/core';
import { FIELD_HALF, MAX_ARROWS } from './types';
import type { ComputeResult, MassPoint } from './types';
import { ColorRamp } from './colorRamp';
import { fieldAt } from './fieldMath';

/** A picked point on the plane plus its field sample. */
export interface ProbeResult {
  x: number;
  z: number;
  ax: number;
  az: number;
  magnitude: number;
  /** Field direction angle in radians, measured from +X toward +Z. */
  angle: number;
}

export interface LinePickResult {
  lineIndex: number;
  distancePx: number;
}

export interface PathPoint {
  x: number;
  z: number;
  ax: number;
  az: number;
  magnitude: number;
}

interface StreamGeometry {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

const LINE_WIDTH = 0.055;
const Y_LINES = 0.03;
const Y_HIGHLIGHT = 0.08;
const ARROWS_PER_UNIT = 0.09;
const ARROW_SIZE = 0.2;
const PICK_PX = 10;
const MAX_LINE_VERTS = 1_200_000;
const MAX_HIGHLIGHT_VERTS = 200_000;

/**
 * Owns the Babylon scene: ground, grid, mass points, streamlines (custom
 * triangle-strip mesh with per-vertex colors), directional cone arrows,
 * highlight overlay, probe marker and picking.
 */
export class FieldScene {
  readonly canvas: HTMLCanvasElement;
  readonly engine: Engine;
  readonly ramp = new ColorRamp();
  readonly camera: ArcRotateCamera;

  private scene: Scene;
  private massMeshes = new Map<number, Mesh>();
  private lineMesh: Mesh;
  private highlightMesh: Mesh;
  private arrowMesh: Mesh;
  private arrowMatrices: Float32Array;
  private arrowColors: Float32Array;
  private probeMarker: Mesh;
  private probeStem: Mesh;
  private pickRing: Mesh;
  private gridTexture: DynamicTexture;

  private current: ComputeResult | null = null;
  private currentPoints: Vector3[][] = [];
  private currentMagnitudes: number[][] = [];
  private smooth = false;
  private highlighted = -1;
  private masses: MassPoint[] = [];

  private onProbe?: (p: ProbeResult) => void;
  private onLinePick?: (r: LinePickResult) => void;
  private onMassPick?: (id: number) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true
    });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.045, 0.055, 0.08, 1);

    this.camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2, 26, Vector3.Zero(), this.scene);
    this.camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
    const extent = FIELD_HALF * 1.05;
    this.camera.orthoLeft = -extent;
    this.camera.orthoRight = extent;
    this.camera.orthoTop = extent;
    this.camera.orthoBottom = -extent;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 200;
    this.camera.inputs.removeByType('keyboard');
    this.camera.attachControl(canvas, true);
    // Strictly top-down: disable rotation, keep zoom and pan.
    this.camera.lowerBetaLimit = Math.PI / 2;
    this.camera.upperBetaLimit = Math.PI / 2;
    this.camera.lowerRadiusLimit = 0.01;
    this.camera.upperRadiusLimit = 500;

    const hemi = new HemisphericLight('light', new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.9;

    this.gridTexture = this.makeGridTexture();
    this.buildGround();

    this.lineMesh = this.makeLineMesh('streamlines', MAX_LINE_VERTS, 0.95, Y_LINES);
    this.highlightMesh = this.makeLineMesh('highlight', MAX_HIGHLIGHT_VERTS, 1, Y_HIGHLIGHT);
    this.highlightMesh.setEnabled(false);

    // Direction arrows: thin instances of one cone, preallocated buffers.
    const cone = MeshBuilder.CreateCylinder(
      'arrowCone',
      { height: ARROW_SIZE, diameterTop: 0, diameterBottom: ARROW_SIZE * 0.55, tessellation: 8 },
      this.scene
    );
    const arrowMat = new StandardMaterial('arrowMat', this.scene);
    arrowMat.emissiveColor = new Color3(1, 1, 1);
    arrowMat.disableLighting = true;
    cone.material = arrowMat;
    cone.isPickable = false;
    this.arrowMesh = cone;
    this.arrowMatrices = new Float32Array(MAX_ARROWS * 16);
    this.arrowColors = new Float32Array(MAX_ARROWS * 4);
    cone.thinInstanceSetBuffer('matrix', this.arrowMatrices, 16, false);
    cone.thinInstanceSetBuffer('color', this.arrowColors, 4, false);
    cone.thinInstanceCount = 0;
    new TransformNode('arrowRoot', this.scene);

    // Probe marker + direction stem.
    const probeMat = new StandardMaterial('probeMat', this.scene);
    probeMat.emissiveColor = new Color3(1, 0.9, 0.25);
    probeMat.disableLighting = true;
    this.probeMarker = MeshBuilder.CreateSphere('probe', { diameter: 0.24, segments: 12 }, this.scene);
    this.probeMarker.material = probeMat;
    this.probeMarker.position.y = 0.12;
    this.probeMarker.isPickable = false;
    this.probeMarker.setEnabled(false);

    this.probeStem = MeshBuilder.CreateCylinder(
      'probeStem',
      { height: 1, diameter: 0.05, tessellation: 6 },
      this.scene
    );
    this.probeStem.material = probeMat;
    this.probeStem.isPickable = false;
    this.probeStem.setEnabled(false);

    const ringMat = new StandardMaterial('ringMat', this.scene);
    ringMat.emissiveColor = new Color3(0.4, 0.9, 1);
    ringMat.disableLighting = true;
    this.pickRing = MeshBuilder.CreateTorus('pickRing', { diameter: 0.36, thickness: 0.035 }, this.scene);
    this.pickRing.material = ringMat;
    this.pickRing.position.y = 0.1;
    this.pickRing.isPickable = false;
    this.pickRing.setEnabled(false);

    this.scene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERTAP) this.handleTap();
    });
  }

  // --------------------------------------------------------------- scene setup

  private buildGround(): void {
    const ground = MeshBuilder.CreateGround(
      'ground',
      { width: FIELD_HALF * 2, height: FIELD_HALF * 2 },
      this.scene
    );
    const mat = new StandardMaterial('groundMat', this.scene);
    mat.emissiveTexture = this.gridTexture;
    mat.diffuseColor = new Color3(0.08, 0.1, 0.14);
    mat.specularColor = new Color3(0, 0, 0);
    ground.material = mat;
  }

  private makeGridTexture(): DynamicTexture {
    const size = 1024;
    const tex = new DynamicTexture('grid', { width: size, height: size }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = '#0d131d';
    ctx.fillRect(0, 0, size, size);
    const cells = 20;
    const step = size / cells;
    ctx.strokeStyle = 'rgba(120,160,220,0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= cells; i++) {
      const p = i * step;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(150,190,255,0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
    tex.update();
    return tex;
  }

  private makeLineMesh(name: string, maxVerts: number, alpha: number, y: number): Mesh {
    const mesh = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = new Float32Array(maxVerts * 3);
    vd.colors = new Float32Array(maxVerts * 4);
    vd.indices = new Uint32Array(maxVerts * 3);
    vd.applyToMesh(mesh, true);
    const mat = new StandardMaterial(name + 'Mat', this.scene);
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.disableLighting = true;
    mat.alpha = alpha;
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.position.y = y;
    mesh.setEnabled(false);
    return mesh;
  }

  // --------------------------------------------------------------- mass points

  syncMassPoints(masses: MassPoint[]): void {
    this.masses = masses;
    const seen = new Set<number>();
    for (const m of masses) {
      seen.add(m.id);
      let mesh = this.massMeshes.get(m.id);
      if (!mesh) {
        mesh = this.createMassMesh(m.id);
        this.massMeshes.set(m.id, mesh);
      }
      mesh.position.x = m.x;
      mesh.position.z = m.z;
      mesh.scaling.setAll(0.22 + 0.16 * Math.cbrt(m.mass));
    }
    for (const [id, mesh] of this.massMeshes) {
      if (!seen.has(id)) {
        mesh.dispose();
        this.massMeshes.delete(id);
      }
    }
  }

  private createMassMesh(id: number): Mesh {
    const mesh = MeshBuilder.CreateSphere(`mass-${id}`, { diameter: 1, segments: 20 }, this.scene);
    const mat = new StandardMaterial(`massMat-${id}`, this.scene);
    mat.emissiveColor = new Color3(1, 0.45, 0.2);
    mat.diffuseColor = new Color3(0.9, 0.3, 0.1);
    mat.specularColor = new Color3(0.3, 0.3, 0.3);
    mesh.material = mat;
    mesh.position.y = 0.25;
    mesh.metadata = { massId: id };
    return mesh;
  }

  /** Mass id under the pointer, or null. */
  pickMass(): number | null {
    const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) =>
      this.massMeshes.has(m.metadata?.massId ?? -1)
    );
    return pick?.hit && pick.pickedMesh ? (pick.pickedMesh.metadata.massId as number) : null;
  }

  /** World X/Z under the pointer on the ground plane, or null. */
  pointerToPlane(): { x: number; z: number } | null {
    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      Matrix.Identity(),
      this.camera
    );
    const distance = ray.intersectsPlane(new Plane(0, 1, 0, 0));
    if (distance === null) return null;
    const p = ray.origin.add(ray.direction.scale(distance));
    return {
      x: Scalar.Clamp(p.x, -FIELD_HALF, FIELD_HALF),
      z: Scalar.Clamp(p.z, -FIELD_HALF, FIELD_HALF)
    };
  }

  setMassPickHandler(h: (id: number) => void): void {
    this.onMassPick = h;
  }

  setProbeHandler(h: (p: ProbeResult) => void): void {
    this.onProbe = h;
  }

  setLinePickHandler(h: (r: LinePickResult) => void): void {
    this.onLinePick = h;
  }

  // --------------------------------------------------------------- streamlines

  setSmoothMode(smooth: boolean): void {
    this.smooth = smooth;
    if (this.current) this.updateStreamMesh(this.current);
  }

  setStreamlines(result: ComputeResult): void {
    this.current = result;
    this.highlighted = -1;
    this.highlightMesh.setEnabled(false);
    this.updateStreamMesh(result);
  }

  private updateStreamMesh(result: ComputeResult): void {
    const { lines, magnitudes } = this.extractLines(result);
    this.currentPoints = lines;
    this.currentMagnitudes = magnitudes;
    const geo = this.buildGeometry(lines, magnitudes, this.smooth, MAX_LINE_VERTS);
    this.uploadGeometry(this.lineMesh, geo);
    this.lineMesh.setEnabled(geo.vertexCount > 0);
    this.updateArrows(lines, magnitudes);
  }

  private extractLines(result: ComputeResult): { lines: Vector3[][]; magnitudes: number[][] } {
    const lines: Vector3[][] = new Array(result.lineCount);
    const magnitudes: number[][] = new Array(result.lineCount);
    for (let i = 0; i < result.lineCount; i++) {
      const start = result.lineStarts[i];
      const count = result.lineCounts[i];
      const pts = new Array<Vector3>(count);
      const mags = new Array<number>(count);
      for (let j = 0; j < count; j++) {
        const idx = start + j;
        pts[j] = new Vector3(result.positions[idx * 2], 0, result.positions[idx * 2 + 1]);
        mags[j] = result.magnitudes[idx];
      }
      lines[i] = pts;
      magnitudes[i] = mags;
    }
    return { lines, magnitudes };
  }

  /** Triangle strips (two verts per point) with per-vertex field colors. */
  private buildGeometry(
    lines: Vector3[][],
    magnitudes: number[][],
    smooth: boolean,
    maxVerts: number
  ): StreamGeometry {
    const positions = new Float32Array(maxVerts * 3);
    const colors = new Float32Array(maxVerts * 4);
    const indices = new Uint32Array(maxVerts * 3);
    let v = 0;
    let ii = 0;
    const rgb: [number, number, number] = [0, 0, 0];
    let truncated = false;

    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      const rawMags = magnitudes[li];
      if (raw.length < 2) continue;
      const pts = smooth ? catmullRomChain(raw) : raw;
      if (v + pts.length * 2 > maxVerts) {
        truncated = true;
        break;
      }
      const base = v;
      for (let j = 0; j < pts.length; j++) {
        const prev = pts[Math.max(0, j - 1)];
        const next = pts[Math.min(pts.length - 1, j + 1)];
        let dx = next.x - prev.x;
        let dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const nx = -dz * LINE_WIDTH * 0.5;
        const nz = dx * LINE_WIDTH * 0.5;

        let mag: number;
        if (smooth) {
          const t = (j / (pts.length - 1)) * (raw.length - 1);
          const i0 = Math.min(raw.length - 1, Math.floor(t));
          const i1 = Math.min(raw.length - 1, i0 + 1);
          mag = lerp(rawMags[i0], rawMags[i1], t - i0);
        } else {
          mag = rawMags[j];
        }
        this.ramp.rgbForMagnitude(mag, rgb);

        positions[v * 3] = pts[j].x + nx;
        positions[v * 3 + 1] = 0;
        positions[v * 3 + 2] = pts[j].z + nz;
        colors[v * 4] = rgb[0];
        colors[v * 4 + 1] = rgb[1];
        colors[v * 4 + 2] = rgb[2];
        colors[v * 4 + 3] = 1;
        v++;
        positions[v * 3] = pts[j].x - nx;
        positions[v * 3 + 1] = 0;
        positions[v * 3 + 2] = pts[j].z - nz;
        colors[v * 4] = rgb[0];
        colors[v * 4 + 1] = rgb[1];
        colors[v * 4 + 2] = rgb[2];
        colors[v * 4 + 3] = 1;
        v++;
      }
      for (let j = 0; j < pts.length - 1; j++) {
        const a = base + j * 2;
        indices[ii++] = a;
        indices[ii++] = a + 1;
        indices[ii++] = a + 2;
        indices[ii++] = a + 1;
        indices[ii++] = a + 3;
        indices[ii++] = a + 2;
      }
    }
    if (truncated) {
      // Keep only the filled prefix when uploading; callers slice anyway.
    }
    return { positions, colors, indices, vertexCount: v, indexCount: ii };
  }

  private uploadGeometry(mesh: Mesh, geo: StreamGeometry): void {
    mesh.updateVerticesData(VertexBuffer.PositionKind, geo.positions.subarray(0, geo.vertexCount * 3));
    mesh.updateVerticesData(VertexBuffer.ColorKind, geo.colors.subarray(0, geo.vertexCount * 4));
    mesh.setIndices(Array.from(geo.indices.subarray(0, geo.indexCount)));
  }

  // ------------------------------------------------------------------- arrows

  private updateArrows(lines: Vector3[][], magnitudes: number[][]): void {
    let count = 0;
    const m = this.arrowMatrices;
    const c = this.arrowColors;
    const rgb: [number, number, number] = [0, 0, 0];

    outer: for (let li = 0; li < lines.length; li++) {
      const pts = lines[li];
      const mags = magnitudes[li];
      if (pts.length < 3) continue;
      let arc = 0;
      for (let i = 1; i < pts.length; i++) {
        arc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      }
      const wanted = Math.max(1, Math.round(arc * ARROWS_PER_UNIT));
      const stride = Math.max(1, Math.floor((pts.length - 1) / wanted));
      for (let j = stride; j < pts.length - 1; j += stride) {
        if (count >= MAX_ARROWS) break outer;
        const p = pts[j];
        const q = pts[j + 1];
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const angle = Math.atan2(dz, dx);
        const mat = Matrix.Compose(
          new Vector3(ARROW_SIZE, ARROW_SIZE, ARROW_SIZE),
          Quaternion.RotationYawPitchRoll(-angle, 0, 0),
          new Vector3(p.x, 0.09, p.z)
        );
        mat.copyToArray(m, count * 16);
        this.ramp.rgbForMagnitude(mags[j], rgb);
        c[count * 4] = rgb[0];
        c[count * 4 + 1] = rgb[1];
        c[count * 4 + 2] = rgb[2];
        c[count * 4 + 3] = 1;
        count++;
      }
    }
    this.arrowMesh.thinInstanceCount = count;
    this.arrowMesh.thinInstanceBufferUpdated('matrix');
    this.arrowMesh.thinInstanceBufferUpdated('color');
  }

  // ---------------------------------------------------------------- highlight

  highlightLine(lineIndex: number): void {
    if (!this.current || lineIndex < 0 || lineIndex >= this.currentPoints.length) {
      this.clearHighlight();
      return;
    }
    this.highlighted = lineIndex;
    const geo = this.buildGeometry(
      [this.currentPoints[lineIndex]],
      [this.currentMagnitudes[lineIndex]],
      this.smooth,
      MAX_HIGHLIGHT_VERTS
    );
    for (let i = 0; i < geo.vertexCount; i++) {
      geo.colors[i * 4] = 1;
      geo.colors[i * 4 + 1] = 0.92;
      geo.colors[i * 4 + 2] = 0.25;
      geo.colors[i * 4 + 3] = 1;
    }
    this.uploadGeometry(this.highlightMesh, geo);
    this.highlightMesh.setEnabled(true);
  }

  clearHighlight(): void {
    this.highlighted = -1;
    this.highlightMesh.setEnabled(false);
  }

  get highlightedIndex(): number {
    return this.highlighted;
  }

  /** Integration path point sequence of one line. */
  getLinePath(lineIndex: number): PathPoint[] {
    const result = this.current;
    if (!result || lineIndex < 0 || lineIndex >= result.lineCount) return [];
    const start = result.lineStarts[lineIndex];
    const count = result.lineCounts[lineIndex];
    const out: PathPoint[] = new Array(count);
    for (let j = 0; j < count; j++) {
      const idx = start + j;
      out[j] = {
        x: result.positions[idx * 2],
        z: result.positions[idx * 2 + 1],
        ax: result.directions[idx * 2],
        az: result.directions[idx * 2 + 1],
        magnitude: result.magnitudes[idx]
      };
    }
    return out;
  }

  get lineCount(): number {
    return this.current?.lineCount ?? 0;
  }

  get pointCount(): number {
    return this.current?.pointCount ?? 0;
  }

  get lastResult(): ComputeResult | null {
    return this.current;
  }

  // -------------------------------------------------------------------- probe

  private handleTap(): void {
    const massId = this.pickMass();
    if (massId !== null) {
      this.onMassPick?.(massId);
      return;
    }
    const plane = this.pointerToPlane();
    if (!plane) return;
    const probe = this.probeAt(plane.x, plane.z);
    this.showProbeMarker(probe);
    this.onProbe?.(probe);
    const hit = this.pickNearestLine();
    if (hit) this.onLinePick?.(hit);
  }

  private pickNearestLine(): LinePickResult | null {
    if (this.currentPoints.length === 0) return null;
    const px = this.scene.pointerX;
    const py = this.scene.pointerY;
    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    let best: LinePickResult | null = null;
    let bestDist = PICK_PX;
    const tmp = Vector3.Zero();
    for (let i = 0; i < this.currentPoints.length; i++) {
      const pts = this.currentPoints[i];
      for (let j = 0; j < pts.length; j += 2) {
        tmp.copyFrom(pts[j]);
        const s = Vector3.Project(tmp, Matrix.Identity(), this.scene.getTransformMatrix(), this.camera.viewport);
        const cx = s.x * width;
        const cy = (1 - s.y) * height;
        const d = Math.hypot(cx - px, cy - py);
        if (d < bestDist) {
          bestDist = d;
          best = { lineIndex: i, distancePx: d };
        }
      }
    }
    return best;
  }

  private showProbeMarker(p: ProbeResult): void {
    this.probeMarker.position.x = p.x;
    this.probeMarker.position.z = p.z;
    this.probeMarker.setEnabled(true);
    this.pickRing.position.x = p.x;
    this.pickRing.position.z = p.z;
    this.pickRing.setEnabled(true);

    const len = Scalar.Clamp(0.4 + Math.log10(1 + p.magnitude) * 0.5, 0.4, 2.4);
    this.probeStem.setEnabled(true);
    this.probeStem.rotationQuaternion = Quaternion.RotationYawPitchRoll(-p.angle, 0, 0);
    this.probeStem.position.set(
      p.x + Math.cos(p.angle) * len * 0.5,
      0.09,
      p.z + Math.sin(p.angle) * len * 0.5
    );
    this.probeStem.scaling.set(0.6, len, 0.6);
  }

  hideProbe(): void {
    this.probeMarker.setEnabled(false);
    this.probeStem.setEnabled(false);
    this.pickRing.setEnabled(false);
  }

  probeAt(x: number, z: number): ProbeResult {
    const [ax, az] = fieldAt(x, z, this.masses);
    return { x, z, ax, az, magnitude: Math.hypot(ax, az), angle: Math.atan2(az, ax) };
  }

  // ------------------------------------------------------------------- export

  screenshot(): Promise<string> {
    return new Promise((resolve) => {
      this.engine.onEndFrameObservable.addOnce(() => {
        resolve(this.canvas.toDataURL('image/png'));
      });
      this.scene.render();
    });
  }

  // ------------------------------------------------------------------ runtime

  runRenderLoop(): void {
    this.engine.runRenderLoop(() => this.scene.render());
  }

  resize(): void {
    this.engine.resize();
  }

  dispose(): void {
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}

/** Centripetal-ish Catmull–Rom chain, one midpoint inserted per segment. */
function catmullRomChain(pts: Vector3[]): Vector3[] {
  if (pts.length < 3) return pts;
  const out: Vector3[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 1; s <= 2; s++) {
      const t = s / 2;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const z =
        0.5 *
        (2 * p1.z +
          (-p0.z + p2.z) * t +
          (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
          (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
      out.push(new Vector3(x, 0, z));
    }
  }
  return out;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
