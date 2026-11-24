import type * as THREE from 'three';
import type { PartNode } from '../types';

/**
 * 烘焙后的渲染模型。
 * 静态零件按材质合并为少量 BufferGeometry;
 * 关节子树烘焙到关节局部空间,运行时以 InstancedMesh 驱动姿态。
 */

export interface BakedPart {
  /** 零件树路径(叶子零件) */
  path: string;
  /** 状态纹理行 id(仅叶子零件分配) */
  partId: number;
  /** 所属关节路径,静态零件为 null */
  jointPath: string | null;
  /** 包围盒:静态零件为世界空间,关节零件为关节局部空间 */
  bbox: THREE.Box3;
}

export interface BakedJoint {
  path: string;
  /** 静止姿态世界矩阵(实例矩阵 = rest × 旋转) */
  restMatrix: THREE.Matrix4;
  axis: 'x' | 'y' | 'z';
  /** 该关节在各材质池 InstancedMesh 中的实例下标,key = poolId */
  instanceSlot: Map<number, number>;
  /** 该关节承载的全部 partId(跨材质池,拾取用) */
  partIds: number[];
}

export interface MaterialPool {
  /** 池 id,同时作为 three.js 物体命名后缀 */
  id: number;
  /** 该池对应的源材质引用(取色/贴图用) */
  sourceMaterial: THREE.Material | null;
  /** 静态合并几何(无静态网格时为 null) */
  staticGeometry: THREE.BufferGeometry | null;
  /** 关节合并几何(每池一个,内含所有关节的几何,实例下标由关节表记录) */
  jointGeometry: THREE.BufferGeometry | null;
  /** 该池关节实例数量 */
  jointInstanceCount: number;
}

export interface RenderModel {
  /** 零件树(与 Pinia 中的节点同构) */
  nodes: Map<string, PartNode>;
  joints: Map<string, BakedJoint>;
  /** 叶子零件渲染信息,key = path */
  parts: Map<string, BakedPart>;
  /** partId → path 反查表(拾取用) */
  partIdToPath: string[];
  pools: MaterialPool[];
  bounds: THREE.Box3;
  totalTriangles: number;
  totalMeshes: number;
}
