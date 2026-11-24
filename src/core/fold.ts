/**
 * Fold solver.
 *
 * The hinge tree from `arrangement.ts` gives every face a parent hinge. A fold
 * is then a single depth-first pass: start with the root face lying in the
 * plane z = 0, and for each child compose
 *
 *     childTransform = parentTransform · R(hinge, sign · θ)
 *
 * where R is a rotation about the hinge line and θ comes from the keyframe
 * curve. Because the transform of a face depends only on its ancestors, the
 * whole sheet is solved in O(faces) per frame and the motion is continuous in
 * θ: adjacent frames differ only by the change in the animated angles.
 *
 * World-space vertices then come from applying the transforms to the sheet
 * coordinates, and normals from the rotation part, so lighting follows the
 * folded orientation exactly rather than being approximated.
 */

import {
  type Mat4,
  type Vec3,
  DEG2RAD,
  mat3Rotation,
  mat4Identity,
  mat4Mul,
  normalize3,
  sub3,
  cross3,
  dot3,
} from './math';
import { triangulate } from './arrangement';
import type { Topology } from './types';

export interface FoldTransforms {
  /** World matrix per face, indexed by face.index. */
  matrices: Mat4[];
  /** World normal per face. */
  normals: Vec3[];
}

/** Immutable per-face vertex data computed once per topology (sheet space). */
export interface FaceMeshTemplate {
  faceIndex: number;
  /** Local (sheet-space) rest positions z = 0, flattened. */
  positions: Float32Array;
  /** Triples into the local vertex list. */
  indices: Uint32Array;
  vertexCount: number;
  /** Offset of this face's first vertex in the merged buffers. */
  vertexOffset: number;
}

export interface MeshTemplate {
  faces: FaceMeshTemplate[];
  totalVertexCount: number;
  totalIndexCount: number;
  /** uvs equal sheet-space uv, so the shader can locate creases and fibres. */
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Rotation about an arbitrary line through point `p` with unit direction `axis`. */
function rotationAboutLine(axis: Vec3, point: Vec3, angle: number): Mat4 {
  const r = mat3Rotation(axis, angle);
  // T(p) · R · T(-p)
  const m = mat4Identity();
  m[0] = r[0];
  m[1] = r[1];
  m[2] = r[2];
  m[4] = r[3];
  m[5] = r[4];
  m[6] = r[5];
  m[8] = r[6];
  m[9] = r[7];
  m[10] = r[8];

  const px = point.x;
  const py = point.y;
  const pz = point.z;
  // translation = point - R*point
  m[12] = px - (r[0] * px + r[3] * py + r[6] * pz);
  m[13] = py - (r[1] * px + r[4] * py + r[7] * pz);
  m[14] = pz - (r[2] * px + r[5] * py + r[8] * pz);
  return m;
}

/**
 * Solve every face's world transform for the given crease angles (degrees).
 * `half` is the sheet half-extent in world units; `lift` raises the sheet so it
 * sits centred on the origin.
 */
export function solveFold(
  topology: Topology,
  angles: Map<string, number>,
  options: { centered?: boolean } = {},
): FoldTransforms {
  const centered = options.centered ?? true;
  const faces = topology.faces;
  const matrices: Mat4[] = new Array(faces.length);
  const normals: Vec3[] = new Array(faces.length);

  // Faces are stored parents-before-children? Not guaranteed — sort by depth.
  const order = faces
    .map((f) => f.index)
    .sort((a, b) => faces[a].depth - faces[b].depth);

  const rootMatrix = mat4Identity();
  if (centered) {
    // Keep the root polygon's centroid at the origin.
    rootMatrix[12] = 0;
    rootMatrix[13] = 0;
  }

  for (const i of order) {
    const face = faces[i];
    if (face.parent < 0 || !face.hinge) {
      matrices[i] = rootMatrix.slice();
      continue;
    }
    const hinge = face.hinge;
    const deg = angles.get(hinge.creaseId) ?? 0;
    const theta = deg * DEG2RAD * hinge.foldSign;

    const a: Vec3 = { x: hinge.a.x, y: hinge.a.y, z: 0 };
    const b: Vec3 = { x: hinge.b.x, y: hinge.b.y, z: 0 };
    const axis = normalize3(sub3(b, a));

    // Restrict the rotation to the hinge line.
    const local = rotationAboutLine(axis, a, theta);
    matrices[i] = mat4Mul(matrices[face.parent], local);
  }

  for (let i = 0; i < faces.length; i++) {
    const m = matrices[i];
    const ex = { x: m[0], y: m[1], z: m[2] };
    const ey = { x: m[4], y: m[5], z: m[6] };
    normals[i] = normalize3(cross3(ex, ey));
  }

  return { matrices, normals };
}

function buildFaceTemplate(
  topology: Topology,
  faceIndex: number,
  vertexOffset: number,
): FaceMeshTemplate {
  const poly = topology.faces[faceIndex].polygon;
  const positions = new Float32Array(poly.length * 2);
  for (let i = 0; i < poly.length; i++) {
    positions[i * 2] = poly[i].x;
    positions[i * 2 + 1] = poly[i].y;
  }
  const tris = triangulate(poly);
  return {
    faceIndex,
    positions,
    indices: new Uint32Array(tris),
    vertexCount: poly.length,
    vertexOffset,
  };
}

/** Build the immutable merged mesh template for a topology. */
export function buildMeshTemplate(topology: Topology): MeshTemplate {
  const faces: FaceMeshTemplate[] = [];
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const face of topology.faces) {
    const t = buildFaceTemplate(topology, face.index, vertexOffset);
    faces.push(t);
    vertexOffset += t.vertexCount;
    indexOffset += t.indices.length;
  }

  const uvs = new Float32Array(vertexOffset * 2);
  const indices = new Uint32Array(indexOffset);

  let vOff = 0;
  let iOff = 0;
  const half = topology.half;
  for (const f of faces) {
    for (let i = 0; i < f.vertexCount; i++) {
      uvs[(vOff + i) * 2] = (f.positions[i * 2] + half) / (2 * half);
      uvs[(vOff + i) * 2 + 1] = (f.positions[i * 2 + 1] + half) / (2 * half);
    }
    for (let i = 0; i < f.indices.length; i++) indices[iOff + i] = f.indices[i] + vOff;
    vOff += f.vertexCount;
    iOff += f.indices.length;
  }

  return {
    faces,
    totalVertexCount: vertexOffset,
    totalIndexCount: indexOffset,
    uvs,
    indices,
  };
}

export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Allocate the scratch buffers used to assemble folded geometry each frame. */
export function createMeshBuffers(template: MeshTemplate): MeshBuffers {
  return {
    positions: new Float32Array(template.totalVertexCount * 3),
    normals: new Float32Array(template.totalVertexCount * 3),
    uvs: template.uvs.slice(),
    indices: template.indices.slice(),
  };
}

/**
 * Assemble world-space geometry for a solved frame. Writes into `buffers`
 * in place — no allocation on the steady-state path.
 */
export function assembleMesh(
  template: MeshTemplate,
  transforms: FoldTransforms,
  buffers: MeshBuffers,
): void {
  const { positions, normals } = buffers;

  for (const f of template.faces) {
    const m = transforms.matrices[f.faceIndex];
    const n = transforms.normals[f.faceIndex];
    let v = f.vertexOffset;
    const local = f.positions;
    for (let i = 0; i < f.vertexCount; i++) {
      const x = local[i * 2];
      const y = local[i * 2 + 1];
      positions[v * 3] = m[0] * x + m[4] * y + m[12];
      positions[v * 3 + 1] = m[1] * x + m[5] * y + m[13];
      positions[v * 3 + 2] = m[2] * x + m[6] * y + m[14];
      normals[v * 3] = n.x;
      normals[v * 3 + 1] = n.y;
      normals[v * 3 + 2] = n.z;
      v++;
    }
  }
}

/** World-space centre of each face, for overlays. */
export function faceCentres(
  topology: Topology,
  transforms: FoldTransforms,
): Vec3[] {
  return topology.faces.map((face) => {
    const m = transforms.matrices[face.index];
    let sx = 0;
    let sy = 0;
    for (const p of face.polygon) {
      sx += p.x;
      sy += p.y;
    }
    const n = face.polygon.length;
    const x = sx / n;
    const y = sy / n;
    return {
      x: m[0] * x + m[4] * y + m[12],
      y: m[1] * x + m[5] * y + m[13],
      z: m[2] * x + m[6] * y + m[14],
    };
  });
}

/** Largest per-face normal change between two solved frames, in degrees. */
export function maxNormalDelta(a: FoldTransforms, b: FoldTransforms): number {
  let worst = 0;
  for (let i = 0; i < a.normals.length; i++) {
    const d = dot3(a.normals[i], b.normals[i]);
    const deg = Math.acos(Math.max(-1, Math.min(1, d))) * (180 / Math.PI);
    if (deg > worst) worst = deg;
  }
  return worst;
}
