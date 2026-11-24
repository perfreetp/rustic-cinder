import * as THREE from 'three';
import { FAULT_META } from '../constants';
import type { PartStatus } from '../types';

/**
 * 零件状态 → GPU 纹理。
 * 每个叶子零件占一行,RGBA:
 *   RGB = 故障换色覆盖(未故障时写入基色占位,由 alpha=0 判定不覆盖)
 *   A   = 状态码: 0 正常 / 1 卡料 / 2 过热 / 3 断轴 / 4 选中 / 5 故障+选中
 * 批量换色只需更新若干纹素并置 needsUpdate,万件规模也远低于 300ms 预算。
 */
const TEX_WIDTH = 256;
const MAX_PARTS = TEX_WIDTH * 64; // 16384

const STATUS_ALPHA: Record<PartStatus, number> = {
  normal: 0,
  jam: 1,
  overheat: 2,
  shaftBreak: 3,
};

export class StatusTexture {
  readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly rows: number;
  private readonly faultColor = new THREE.Color();

  constructor(partCount: number) {
    const rows = Math.max(1, Math.ceil(partCount / TEX_WIDTH));
    if (partCount > MAX_PARTS) {
      console.warn(`零件数 ${partCount} 超出状态纹理容量 ${MAX_PARTS},超出部分状态不显示`);
    }
    this.rows = rows;
    this.data = new Uint8Array(TEX_WIDTH * rows * 4);
    this.texture = new THREE.DataTexture(this.data, TEX_WIDTH, rows, THREE.RGBAFormat);
    this.texture.needsUpdate = true;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
  }

  /**
   * 写入一行零件状态。
   * @param baseColor 零件原始基色(无故障时作为占位,保证 RGB 始终有效)
   */
  setRow(partId: number, status: PartStatus, selected: boolean, baseColor: THREE.Color): void {
    if (partId < 0 || partId >= TEX_WIDTH * this.rows) return;
    const offset = partId * 4;
    let code = STATUS_ALPHA[status];
    if (selected) code = code === 0 ? 4 : 5;

    if (status === 'normal') this.faultColor.copy(baseColor);
    else this.faultColor.setHex(FAULT_META[status].color);

    this.data[offset] = Math.round(this.faultColor.r * 255);
    this.data[offset + 1] = Math.round(this.faultColor.g * 255);
    this.data[offset + 2] = Math.round(this.faultColor.b * 255);
    this.data[offset + 3] = code;
    this.texture.needsUpdate = true;
  }

  /** 批量写入(框选批量场景,一次 needsUpdate) */
  setRows(
    rows: Array<{ partId: number; status: PartStatus; selected: boolean; baseColor: THREE.Color }>,
  ): void {
    for (const r of rows) {
      if (r.partId < 0 || r.partId >= TEX_WIDTH * this.rows) continue;
      const offset = r.partId * 4;
      let code = STATUS_ALPHA[r.status];
      if (r.selected) code = code === 0 ? 4 : 5;
      if (r.status === 'normal') {
        this.faultColor.copy(r.baseColor);
      } else {
        this.faultColor.setHex(FAULT_META[r.status].color);
      }
      this.data[offset] = Math.round(this.faultColor.r * 255);
      this.data[offset + 1] = Math.round(this.faultColor.g * 255);
      this.data[offset + 2] = Math.round(this.faultColor.b * 255);
      this.data[offset + 3] = code;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
