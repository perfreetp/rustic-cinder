import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type {
  BakedJoint,
  BakedPart,
  MaterialPool,
  RenderModel,
} from './renderTypes';
import type { PartNode } from '../types';
import { joinPath, uniqueName } from '../utils/path';

export interface ImportResult {
  model: RenderModel;
  /** 保留的原始网格引用,供运行时重新标记关节后重烘焙 */
  sourceRefs: SourceMeshRef[];
  rootObject: THREE.Object3D;
  /** 按材质池顺序收集的源材质,供 MaterialFactory 取色 */
  sourceMaterials: THREE.Material[];
  warnings: string[];
}

export interface SourceMeshRef {
  partPath: string;
  /** 加载时的世界矩阵 */
  matrixWorld: THREE.Matrix4;
  geometry: THREE.BufferGeometry;
  materialKey: string;
}

/** 自动识别关节的名称关键词(中英文);仅命中"机构/节点"类名词,避免普通零件误伤 */
const JOINT_KEYWORDS = [
  '关节', '铰链', '铰接', '回转机构', '摆臂机构',
  'joint', 'hinge', 'pivot', 'rotor', 'swivel', 'actuator', 'servo',
];

const AXIS_HINT: Array<[RegExp, 'x' | 'y' | 'z']> = [
  [/[_-]?x[ _-]?轴|轴?x$/i, 'x'],
  [/[_-]?y[ _-]?轴|轴?y$/i, 'y'],
  [/[_-]?z[ _-]?轴|轴?z$/i, 'z'],
];

/** 自动关节数量上限,防止极端模型产生过多实例化物体 */
const MAX_AUTO_JOINTS = 500;

function guessAxis(name: string): 'x' | 'y' | 'z' {
  const lower = name.toLowerCase();
  for (const [re, axis] of AXIS_HINT) {
    if (re.test(lower)) return axis;
  }
  return 'y';
}

function isJointName(name: string): boolean {
  const lower = name.toLowerCase();
  return JOINT_KEYWORDS.some((k) => lower.includes(k));
}

/** 规范化几何属性,保证同一材质池内属性布局一致 */
function normalizeGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) {
    const count = g.getAttribute('position').count;
    const uv = new Float32Array(count * 2);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return g;
}

function appendPartId(geo: THREE.BufferGeometry, partId: number): void {
  const count = geo.getAttribute('position').count;
  const arr = new Float32Array(count);
  arr.fill(partId);
  geo.setAttribute('aPartId', new THREE.BufferAttribute(arr, 1));
}

interface RawNode {
  object: THREE.Object3D;
  path: string;
  parentPath: string | null;
  isJoint: boolean;
}

export class ModelImporter {
  async import(file: File, onProgress?: (pct: number, msg: string) => void): Promise<ImportResult> {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    onProgress?.(5, '读取模型文件…');
    const root = await this.loadByExtension(file, ext, onProgress);
    root.updateMatrixWorld(true);

    onProgress?.(35, '构建零件树与关节识别…');
    const { rawNodes, nodes } = this.buildTree(root, file.name);

    // 每个网格找到最近的关节祖先
    const meshEntries: Array<{ mesh: THREE.Mesh; partPath: string; jointPath: string | null }> = [];
    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const partPath = this.partPathOf(mesh, rawNodes);
      if (!partPath) return;
      meshEntries.push({ mesh, partPath, jointPath: this.nearestJoint(partPath, nodes) });
    });

    if (meshEntries.length === 0) {
      throw new Error('模型中未找到任何网格(Mesh),请检查文件格式');
    }

    onProgress?.(50, `烘焙 ${meshEntries.length} 个网格…`);
    const warnings: string[] = [];
    const jointCount = [...nodes.values()].filter((n) => n.isJoint).length;
    if (jointCount > MAX_AUTO_JOINTS) {
      warnings.push(`自动识别关节数超过 ${MAX_AUTO_JOINTS},仅保留优先级最高的 ${MAX_AUTO_JOINTS} 个,可在零件树中手动调整`);
    }

    const pathObject = new Map<string, THREE.Object3D>();
    for (const [obj, rn] of rawNodes) pathObject.set(rn.path, obj);

    const materialByUuid = new Map<string, THREE.Material>();
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) if (m) materialByUuid.set(m.uuid, m);
    });

    const result = this.bake(nodes, meshEntries, pathObject, materialByUuid, onProgress);
    const sourceMaterials = result.model.pools.map(
      (p) => p.sourceMaterial ?? new THREE.MeshStandardMaterial(),
    );
    return { ...result, rootObject: root, sourceMaterials, warnings };
  }

  // ---------- 文件加载 ----------

  private async loadByExtension(
    file: File,
    ext: string,
    onProgress?: (pct: number, msg: string) => void,
  ): Promise<THREE.Object3D> {
    const url = URL.createObjectURL(file);
    try {
      if (ext === 'glb' || ext === 'gltf') {
        const loader = new GLTFLoader();
        const draco = new DRACOLoader();
        // 优先使用本地随包解码器,失败回退公共 CDN
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
        loader.setDRACOLoader(draco);
        const gltf = await loader.loadAsync(url, (e) => {
          if (e.total > 0) onProgress?.(5 + (e.loaded / e.total) * 25, '解析 glTF…');
        });
        draco.dispose();
        return gltf.scene;
      }
      if (ext === 'obj') {
        const loader = new OBJLoader();
        // 同名 mtl 若存在于同目录无法通过浏览器 File 获得,忽略材质时使用默认材质
        const text = await file.text();
        return loader.parse(text);
      }
      if (ext === 'stl') {
        const buf = await file.arrayBuffer();
        const geo = new STLLoader().parse(buf);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0x9aa7b5, metalness: 0.3, roughness: 0.6 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = file.name.replace(/\.stl$/i, '');
        const group = new THREE.Group();
        group.name = file.name;
        group.add(mesh);
        return group;
      }
      throw new Error(`不支持的模型格式: .${ext}(支持 .glb/.gltf/.obj/.stl)`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- 零件树 ----------

  private buildTree(root: THREE.Object3D, fileName: string) {
    const rawNodes = new Map<THREE.Object3D, RawNode>();
    const nodes = new Map<string, PartNode>();

    const rootName = fileName.replace(/\.[^.]+$/, '') || '产线模型';
    const rootPath = '';
    rawNodes.set(root, { object: root, path: rootPath, parentPath: null, isJoint: false });
    nodes.set(rootPath, {
      path: rootPath,
      name: rootName,
      parentPath: null,
      children: [],
      isJoint: false,
      meshCount: 0,
      triangleCount: 0,
      ownStatus: null,
    });

    // 先做关节候选评分,超限时按分数截断
    const candidates: Array<{ path: string; score: number }> = [];
    const walk = (obj: THREE.Object3D, parentPath: string) => {
      const siblingNames = new Set(
        obj.parent ? obj.parent.children.map((c) => c.name) : [],
      );
      const base = obj.name && obj.name.trim() ? obj.name.trim() : `${obj.type}_${obj.id}`;
      const name = uniqueName(base, siblingNames);
      const path = joinPath(parentPath, name);
      const jointHit = isJointName(name);
      const node: RawNode = { object: obj, path, parentPath, isJoint: jointHit };
      rawNodes.set(obj, node);

      const partNode: PartNode = {
        path,
        name,
        parentPath,
        children: [],
        isJoint: jointHit,
        meshCount: 0,
        triangleCount: 0,
        ownStatus: null,
      };
      nodes.set(path, partNode);
      nodes.get(parentPath)!.children.push(path);
      if (jointHit) candidates.push({ path, score: this.keywordScore(name) });

      for (const child of obj.children) walk(child, path);
    };
    for (const child of root.children) walk(child, rootPath);

    if (candidates.length > MAX_AUTO_JOINTS) {
      candidates.sort((a, b) => b.score - a.score);
      const kept = new Set(candidates.slice(0, MAX_AUTO_JOINTS).map((c) => c.path));
      for (const node of nodes.values()) {
        if (node.isJoint && !kept.has(node.path)) node.isJoint = false;
      }
      for (const rn of rawNodes.values()) {
        if (rn.isJoint && !kept.has(rn.path)) rn.isJoint = false;
      }
    }
    return { rawNodes, nodes };
  }

  private keywordScore(name: string): number {
    const lower = name.toLowerCase();
    let score = 0;
    for (const k of JOINT_KEYWORDS) if (lower.includes(k)) score += k.length;
    return score;
  }

  private partPathOf(mesh: THREE.Mesh, rawNodes: Map<THREE.Object3D, RawNode>): string | null {
    let obj: THREE.Object3D | null = mesh;
    while (obj) {
      const rn = rawNodes.get(obj);
      if (rn) return rn.path;
      obj = obj.parent;
    }
    return null;
  }

  private nearestJoint(partPath: string, nodes: Map<string, PartNode>): string | null {
    let cur: string | null = partPath;
    while (cur !== null) {
      const node = nodes.get(cur);
      if (node?.isJoint) return cur;
      cur = node?.parentPath ?? null;
    }
    return null;
  }

  // ---------- 烘焙 ----------

  private bake(
    nodes: Map<string, PartNode>,
    meshEntries: Array<{ mesh: THREE.Mesh; partPath: string; jointPath: string | null }>,
    pathObject: Map<string, THREE.Object3D>,
    materialByUuid: Map<string, THREE.Material>,
    onProgress?: (pct: number, msg: string) => void,
  ): Omit<ImportResult, 'rootObject' | 'warnings' | 'sourceMaterials'> {
    const parts = new Map<string, BakedPart>();
    const partIdToPath: string[] = [];
    const joints = new Map<string, BakedJoint>();
    const sourceRefs: SourceMeshRef[] = [];
    const poolMap = new Map<string, MaterialPool>();
    const pools: MaterialPool[] = [];
    const overallBounds = new THREE.Box3();
    let totalTriangles = 0;

    const jointWorldInv = new Map<string, THREE.Matrix4>();
    for (const node of nodes.values()) {
      if (!node.isJoint) continue;
      const obj = pathObject.get(node.path);
      const rest = obj ? obj.matrixWorld.clone() : new THREE.Matrix4();
      jointWorldInv.set(node.path, rest.clone().invert());
      joints.set(node.path, {
        path: node.path,
        restMatrix: rest,
        axis: guessAxis(node.name),
        instanceSlot: new Map(),
        partIds: [],
      });
    }

    /** 材质池按源材质 uuid 分组,保证纹理/颜色一致的网格合并 */
    const getPool = (materialKey: string): MaterialPool => {
      let pool = poolMap.get(materialKey);
      if (!pool) {
        pool = {
          id: pools.length,
          sourceMaterial: materialByUuid.get(materialKey) ?? null,
          staticGeometry: null,
          jointGeometry: null,
          jointInstanceCount: 0,
        };
        poolMap.set(materialKey, pool);
        pools.push(pool);
      }
      return pool;
    };

    const staticBuckets = new Map<number, THREE.BufferGeometry[]>();
    /** 关节桶:poolId → (jointPath → 该关节在该池下的几何片段) */
    const jointBuckets = new Map<number, Map<string, THREE.BufferGeometry[]>>();
    const pushBucket = (
      buckets: Map<number, THREE.BufferGeometry[]>,
      poolId: number,
      geo: THREE.BufferGeometry,
    ) => {
      let arr = buckets.get(poolId);
      if (!arr) {
        arr = [];
        buckets.set(poolId, arr);
      }
      arr.push(geo);
    };

    let processed = 0;

    /** 将网格按材质 group 拆成独立几何(已应用世界矩阵) */    const splitByMaterial = (mesh: THREE.Mesh): Array<{ geo: THREE.BufferGeometry; materialKey: string }> => {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const base = normalizeGeometry(mesh.geometry);
      base.applyMatrix4(mesh.matrixWorld);
      const groups = mesh.geometry.groups;
      if (!Array.isArray(mesh.material) || !groups || groups.length === 0) {
        return [{ geo: base, materialKey: mats[0]?.uuid ?? `default_${mesh.id}` }];
      }
      const out: Array<{ geo: THREE.BufferGeometry; materialKey: string }> = [];
      // base 已去索引,group 的 start/count 按顶点语义对应
      const pos = base.getAttribute('position');
      const nor = base.getAttribute('normal');
      const uv = base.getAttribute('uv');
      groups.forEach((group, gi) => {
        const start = group.start;
        const count = group.count;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute((pos.array as Float32Array).slice(start * 3, (start + count) * 3), 3));
        g.setAttribute('normal', new THREE.BufferAttribute((nor.array as Float32Array).slice(start * 3, (start + count) * 3), 3));
        if (uv) g.setAttribute('uv', new THREE.BufferAttribute((uv.array as Float32Array).slice(start * 2, (start + count) * 2), 2));
        const mat = mats[group.materialIndex ?? gi] ?? mats[0];
        out.push({ geo: g, materialKey: mat?.uuid ?? `default_${mesh.id}` });
      });
      base.dispose();
      return out;
    };

    for (const entry of meshEntries) {
      const { mesh, partPath, jointPath } = entry;
      const pieces = splitByMaterial(mesh);
      let meshTris = 0;

      for (const piece of pieces) {
        const pool = getPool(piece.materialKey);
        const geo = piece.geo;
        const partId = partIdToPath.length;
        partIdToPath.push(partPath);

        const bbox = new THREE.Box3().setFromBufferAttribute(
          geo.getAttribute('position') as THREE.BufferAttribute,
        );
        overallBounds.union(bbox);

        if (jointPath) {
          // 烘焙到关节局部空间
          geo.applyMatrix4(jointWorldInv.get(jointPath)!);
          let perPool = jointBuckets.get(pool.id);
          if (!perPool) {
            perPool = new Map();
            jointBuckets.set(pool.id, perPool);
          }
          let perJoint = perPool.get(jointPath);
          if (!perJoint) {
            perJoint = [];
            perPool.set(jointPath, perJoint);
            // 该关节首次在此材质池出现 → 分配一个实例槽位
            joints.get(jointPath)!.instanceSlot.set(pool.id, pool.jointInstanceCount++);
          }
          appendPartId(geo, partId);
          perJoint.push(geo);
          joints.get(jointPath)!.partIds.push(partId);
        } else {
          appendPartId(geo, partId);
          pushBucket(staticBuckets, pool.id, geo);
        }

        const triCount = geo.getAttribute('position').count / 3;
        totalTriangles += Math.round(triCount);
        meshTris += Math.round(triCount);

        const prior = parts.get(partPath);
        if (prior) prior.bbox.union(bbox);
        else {
          parts.set(partPath, {
            path: partPath,
            partId,
            jointPath,
            bbox: bbox.clone(),
          });
        }

        sourceRefs.push({
          partPath,
          matrixWorld: mesh.matrixWorld.clone(),
          geometry: mesh.geometry,
          materialKey: piece.materialKey,
        });
      }

      const node = nodes.get(partPath);
      if (node) {
        node.meshCount += 1;
        node.triangleCount += meshTris;
      }
      processed++;
      if (processed % 200 === 0) {
        onProgress?.(50 + (processed / meshEntries.length) * 35, `烘焙网格 ${processed}/${meshEntries.length}`);
      }
    }

    onProgress?.(90, '合并几何批次…');
    for (const pool of pools) {
      const statics = staticBuckets.get(pool.id);
      if (statics && statics.length) {
        pool.staticGeometry = mergeGeometries(statics, false);
        statics.forEach((g) => g.dispose());
      }
      // 该池所有关节的几何片段按实例槽位顺序合并为单个几何
      const perPool = jointBuckets.get(pool.id);
      if (perPool && perPool.size) {
        const ordered: THREE.BufferGeometry[] = [];
        const slotJoint = new Map<number, string>();
        for (const [jointPath, arr] of perPool) {
          const slot = joints.get(jointPath)!.instanceSlot.get(pool.id)!;
          slotJoint.set(slot, jointPath);
          ordered[slot] = mergeGeometries(arr, false)!;
          arr.forEach((g) => g.dispose());
        }
        const compact = ordered.filter(Boolean);
        pool.jointGeometry = mergeGeometries(compact, false);
        compact.forEach((g) => g.dispose());
      }
    }

    // 汇总父节点的网格/面数统计
    for (const node of nodes.values()) {
      if (node.meshCount > 0) {
        let cur = node.parentPath;
        while (cur !== null) {
          const parent = nodes.get(cur);
          if (parent) {
            parent.meshCount += node.meshCount;
            parent.triangleCount += node.triangleCount;
          }
          cur = parent?.parentPath ?? null;
        }
      }
    }

    const model: RenderModel = {
      nodes,
      joints,
      parts,
      partIdToPath,
      pools,
      bounds: overallBounds,
      totalTriangles,
      totalMeshes: meshEntries.length,
    };
    return { model, sourceRefs };
  }
}
