// 伞翼参数化放样模型
// 展向 24 段 × 弦向 12 段，沿展向拱形逐站放置扭转后的翼型截面
// 每帧在 CPU 端重算：顶点位置、三角形累积法线、曲率→张力染色

import * as THREE from 'three';
import { CHORD_SEGMENTS, SPAN_SEGMENTS, type KiteParams, type WindState } from '../types';
import { windowPower } from '../types';
import { contourPoint, interpTwist } from './airfoil';
import { tensionColor, type RGB } from './colorRamp';
import { writeTubeIndices, writeTubePositions, type TubeLayout } from './tube';

const NS = SPAN_SEGMENTS + 1; // 25 个展向站
const NC = CHORD_SEGMENTS + 1; // 13 个弦向轮廓点
const RIB_STATIONS = 7; // 翼肋数量
const RIB_TUBE_RS = 8; // 管架径向分段

interface StationFrame {
  x: number;
  y: number;
  z: number;
  ex: number;
  ey: number;
  ez: number; // 展向切线
  fx: number;
  fy: number;
  fz: number; // 厚度方向（拱形平面法向）
  gx: number;
  gy: number;
  gz: number; // 弦向
  chord: number;
  twistRad: number;
  m: number; // 该站拱度
  t: number; // 该站厚度
  p: number;
}

/** 通用法线重算：遍历三角形累积叉积，再归一化（CPU 端，每帧调用） */
function computeNormals(
  positions: Float32Array,
  indices: Uint32Array,
  out: Float32Array,
  count: number,
  triCount: number,
): void {
  out.fill(0, 0, count * 3);
  for (let k = 0; k < triCount; k++) {
    const ia = indices[k * 3];
    const ib = indices[k * 3 + 1];
    const ic = indices[k * 3 + 2];
    const ax = positions[ia * 3];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];
    const bx = positions[ib * 3] - ax;
    const by = positions[ib * 3 + 1] - ay;
    const bz = positions[ib * 3 + 2] - az;
    const cx = positions[ic * 3] - ax;
    const cy = positions[ic * 3 + 1] - ay;
    const cz = positions[ic * 3 + 2] - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    out[ia * 3] += nx;
    out[ia * 3 + 1] += ny;
    out[ia * 3 + 2] += nz;
    out[ib * 3] += nx;
    out[ib * 3 + 1] += ny;
    out[ib * 3 + 2] += nz;
    out[ic * 3] += nx;
    out[ic * 3 + 1] += ny;
    out[ic * 3 + 2] += nz;
  }
  for (let i = 0; i < count; i++) {
    const x = out[i * 3];
    const y = out[i * 3 + 1];
    const z = out[i * 3 + 2];
    const l = Math.hypot(x, y, z);
    if (l > 1e-8) {
      out[i * 3] = x / l;
      out[i * 3 + 1] = y / l;
      out[i * 3 + 2] = z / l;
    }
  }
}

export class CanopyModel {
  readonly outer: THREE.BufferGeometry;
  readonly inner: THREE.BufferGeometry;
  readonly ribs: THREE.BufferGeometry;
  readonly frame: THREE.BufferGeometry;

  private readonly outerPos: Float32Array;
  private readonly innerPos: Float32Array;
  private readonly outerNor: Float32Array;
  private readonly innerNor: Float32Array;
  private readonly outerCol: Float32Array;
  private readonly innerCol: Float32Array;
  private readonly framePos: Float32Array;
  private readonly frameNor: Float32Array;
  private readonly indices: Uint32Array;
  private readonly innerIndices: Uint32Array;
  private readonly frameIndices: Uint32Array;
  private readonly frames: StationFrame[] = [];
  private readonly lePath: Float32Array;
  private readonly tipPaths: Float32Array[] = [];
  private readonly tubeLayouts: TubeLayout[] = [];
  private tensionMaxSmoothed = 1;

  // 暴露给 HUD 的张力统计
  tensionMean = 0;
  tensionRawMean = 0;
  tensionPeak = 0;
  loadLevel = 0;

  constructor() {
    const vCount = NS * NC;
    this.outerPos = new Float32Array(vCount * 3);
    this.innerPos = new Float32Array(vCount * 3);
    this.outerNor = new Float32Array(vCount * 3);
    this.innerNor = new Float32Array(vCount * 3);
    this.outerCol = new Float32Array(vCount * 3);
    this.innerCol = new Float32Array(vCount * 3);

    const triCount = SPAN_SEGMENTS * CHORD_SEGMENTS * 2;
    this.indices = new Uint32Array(triCount * 3);
    this.innerIndices = new Uint32Array(triCount * 3);
    this.writeMembraneIndices(this.indices);
    this.innerIndices.set(this.indices);

    // 管架：1 条前缘管 + 2 条翼尖轮廓管
    this.lePath = new Float32Array(NS * 3);
    this.tipPaths.push(new Float32Array(NC * 3));
    this.tipPaths.push(new Float32Array(NC * 3));
    const leLayout: TubeLayout = {
      pathPoints: NS,
      radialSegments: RIB_TUBE_RS,
      closed: false,
      vertexOffset: 0,
      indexOffset: 0,
    };
    const tipLayoutA: TubeLayout = {
      pathPoints: NC,
      radialSegments: RIB_TUBE_RS,
      closed: true,
      vertexOffset: NS * RIB_TUBE_RS,
      indexOffset: 0,
    };
    const tipLayoutB: TubeLayout = {
      pathPoints: NC,
      radialSegments: RIB_TUBE_RS,
      closed: true,
      vertexOffset: (NS + NC) * RIB_TUBE_RS,
      indexOffset: 0,
    };
    this.tubeLayouts.push(leLayout, tipLayoutA, tipLayoutB);
    const frameVerts = (NS + NC * 2) * RIB_TUBE_RS;
    const frameTris =
      (NS - 1) * RIB_TUBE_RS * 2 + NC * RIB_TUBE_RS * 2 * 2;
    this.framePos = new Float32Array(frameVerts * 3);
    this.frameNor = new Float32Array(frameVerts * 3);
    this.frameIndices = new Uint32Array(frameTris * 3);
    // 三段管索引写入同一张索引缓冲
    let idxCursor = 0;
    for (const layout of this.tubeLayouts) {
      layout.indexOffset = idxCursor;
      writeTubeIndices(this.frameIndices, layout);
      idxCursor += layout.closed
        ? layout.pathPoints * layout.radialSegments * 6
        : (layout.pathPoints - 1) * layout.radialSegments * 6;
    }

    for (let i = 0; i < NS; i++) {
      this.frames.push({
        x: 0, y: 0, z: 0,
        ex: 0, ey: 0, ez: 1,
        fx: 0, fy: 1, fz: 0,
        gx: 1, gy: 0, gz: 0,
        chord: 1, twistRad: 0, m: 0.05, t: 0.1, p: 0.4,
      });
    }

    // —— 组装 BufferGeometry ——
    this.outer = new THREE.BufferGeometry();
    this.outer.setAttribute('position', new THREE.BufferAttribute(this.outerPos, 3));
    this.outer.setAttribute('normal', new THREE.BufferAttribute(this.outerNor, 3));
    this.outer.setAttribute('color', new THREE.BufferAttribute(this.outerCol, 3));
    this.outer.setIndex(new THREE.BufferAttribute(this.indices, 1));

    this.inner = new THREE.BufferGeometry();
    this.inner.setAttribute('position', new THREE.BufferAttribute(this.innerPos, 3));
    this.inner.setAttribute('normal', new THREE.BufferAttribute(this.innerNor, 3));
    this.inner.setAttribute('color', new THREE.BufferAttribute(this.innerCol, 3));
    this.inner.setIndex(new THREE.BufferAttribute(this.innerIndices, 1));

    this.ribs = this.buildRibGeometry();

    this.frame = new THREE.BufferGeometry();
    this.frame.setAttribute('position', new THREE.BufferAttribute(this.framePos, 3));
    this.frame.setAttribute('normal', new THREE.BufferAttribute(this.frameNor, 3));
    this.frame.setIndex(new THREE.BufferAttribute(this.frameIndices, 1));
  }

  private writeMembraneIndices(out: Uint32Array): void {
    let w = 0;
    for (let i = 0; i < SPAN_SEGMENTS; i++) {
      for (let j = 0; j < CHORD_SEGMENTS; j++) {
        const a = i * NC + j;
        const b = (i + 1) * NC + j;
        const c = (i + 1) * NC + j + 1;
        const d = i * NC + j + 1;
        // 绕序使法线指向膜面外侧（上翼面 +y、下翼面 -y）
        out[w++] = a;
        out[w++] = d;
        out[w++] = b;
        out[w++] = b;
        out[w++] = d;
        out[w++] = c;
      }
    }
  }

  /** 翼肋：7 个展向站位上的翼型剖面膜，三角形扇形填充 */
  private buildRibGeometry(): THREE.BufferGeometry {
    const vertsPerRib = NC * 3; // 12 个三角扇形：中心 + 12 轮廓点（复用首点）
    const positions = new Float32Array(RIB_STATIONS * vertsPerRib * 3);
    const normals = new Float32Array(RIB_STATIONS * vertsPerRib * 3);
    const colors = new Float32Array(RIB_STATIONS * vertsPerRib * 3);
    const ribIndex = new Uint32Array(RIB_STATIONS * CHORD_SEGMENTS * 3);
    let w = 0;
    for (let r = 0; r < RIB_STATIONS; r++) {
      const base = r * vertsPerRib;
      for (let j = 0; j < CHORD_SEGMENTS; j++) {
        ribIndex[w++] = base;
        ribIndex[w++] = base + 1 + j;
        ribIndex[w++] = base + 1 + ((j + 1) % CHORD_SEGMENTS);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(ribIndex, 1));
    return geo;
  }

  /** 每帧更新：风窗/参数变化 → 全部顶点与法线重算 */
  update(params: KiteParams, wind: WindState, showTension: boolean): void {
    const power = windowPower(wind);
    // 归一化载荷：风速平方（动压）× 风窗功率
    const load = Math.min(1.4, (wind.windSpeed * wind.windSpeed) / 900) * power;
    this.loadLevel = load;

    // —— 逐展向站：拱形路径 + 局部坐标架 ——
    const curvature = Math.max(
      0.02,
      params.baseCurvature * (1 + params.arcLoadGain * load),
    );
    const radius = 1 / curvature;
    const halfArc = params.span * 0.5 * curvature;
    const twistGain = params.twistLoadGain * load;

    for (let i = 0; i < NS; i++) {
      const u = (i / SPAN_SEGMENTS) * 2 - 1; // -1 … 1（左翼尖 → 中轴 → 右翼尖）
      // 展向参数按到中轴的距离对称：中心为根(v=0)，两端同为翼尖(v=1)
      const v = Math.abs(u);
      const phi = u * halfArc;
      const fr = this.frames[i];

      // 拱形圆柱上的位置（圆心在 y 负方向）
      fr.x = radius * Math.sin(phi);
      fr.y = radius * (Math.cos(phi) - 1);
      fr.z = 0;

      // 展向切线 e = d/dφ 归一化
      fr.ex = Math.cos(phi);
      fr.ey = -Math.sin(phi);
      fr.ez = 0;
      // 拱形平面法向 f（指向圆心外/上）
      fr.fx = Math.sin(phi);
      fr.fy = Math.cos(phi);
      fr.fz = 0;
      // 弦向 g（右手系 e×f）
      fr.gx = fr.ey * fr.fz - fr.ez * fr.fy;
      fr.gy = fr.ez * fr.fx - fr.ex * fr.fz;
      fr.gz = fr.ex * fr.fy - fr.ey * fr.fx;

      fr.chord =
        params.rootChord *
        (1 - (1 - params.tipChordRatio) * Math.pow(v, 1.3));
      const camber = Math.max(
        0.005,
        params.rootCamber *
          (1 - (1 - params.tipCamberRatio) * v) *
          (1 + params.camberLoadGain * load),
      );
      fr.m = camber;
      fr.p = params.camberPos;
      fr.t = params.thickness;
      const baseTwist = interpTwist(params.twistStations, v);
      fr.twistRad = (-baseTwist - twistGain * v * v) * (Math.PI / 180);
    }

    this.writeMembrane(params, 1, this.outerPos);
    this.writeMembrane(params, 0.9, this.innerPos);
    this.updateRibs();
    this.updateFrame();

    // —— 曲率估算 → 张力 ——
    this.computeTension(params, showTension);

    // —— CPU 法线 ——
    const triCount = SPAN_SEGMENTS * CHORD_SEGMENTS * 2;
    computeNormals(this.outerPos, this.indices, this.outerNor, NS * NC, triCount);
    computeNormals(this.innerPos, this.innerIndices, this.innerNor, NS * NC, triCount);
    computeNormals(
      this.framePos,
      this.frameIndices,
      this.frameNor,
      this.framePos.length / 3,
      this.frameIndices.length / 3,
    );

    // 翼肋法线：展向切线方向
    const ribPos = this.ribs.attributes.position.array as Float32Array;
    const ribNor = this.ribs.attributes.normal.array as Float32Array;
    for (let r = 0; r < RIB_STATIONS; r++) {
      const stationIdx = Math.round((r / (RIB_STATIONS - 1)) * SPAN_SEGMENTS);
      const fr = this.frames[stationIdx];
      const base = r * NC * 3;
      for (let k = 0; k < NC * 3; k += 3) {
        ribNor[base + k] = fr.ex;
        ribNor[base + k + 1] = fr.ey;
        ribNor[base + k + 2] = fr.ez;
      }
    }

    // 标记缓冲已更新
    for (const geo of [this.outer, this.inner, this.ribs, this.frame]) {
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
      if (geo.attributes.color) {
        (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      }
    }
    void ribPos;
  }

  /** 写一层膜面顶点；scale 控制内膜相对外膜的收缩 */
  private writeMembrane(params: KiteParams, scale: number, target: Float32Array): void {
    for (let i = 0; i < NS; i++) {
      const fr = this.frames[i];
      const cosT = Math.cos(fr.twistRad);
      const sinT = Math.sin(fr.twistRad);
      for (let j = 0; j < NC; j++) {
        const s = j / CHORD_SEGMENTS;
        const sp = contourPoint(s, fr.m, fr.p, fr.t);
        // 局部坐标（弦向 x、厚度 y），内膜向拱弧中点收缩
        const lx = (sp.x - 0.5) * fr.chord * scale;
        const ly = sp.y * fr.chord * scale;
        // 扭转（绕展向轴 e）：x' = x cosθ - y sinθ, y' = x sinθ + y cosθ
        const rx = lx * cosT - ly * sinT;
        const ry = lx * sinT + ly * cosT;
        const vi = i * NC + j;
        target[vi * 3] = fr.x + fr.gx * rx + fr.fx * ry;
        target[vi * 3 + 1] = fr.y + fr.gy * rx + fr.fy * ry;
        target[vi * 3 + 2] = fr.z + fr.gz * rx + fr.fz * ry;
      }
    }
    void params;
  }

  /** 翼肋顶点：取对应展向站的外膜位置，中心为轮廓质心 */
  private updateRibs(): void {
    const pos = this.ribs.attributes.position.array as Float32Array;
    for (let r = 0; r < RIB_STATIONS; r++) {
      const stationIdx = Math.round((r / (RIB_STATIONS - 1)) * SPAN_SEGMENTS);
      const base = r * NC * 3;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let j = 0; j < CHORD_SEGMENTS; j++) {
        const src = (stationIdx * NC + j) * 3;
        const dst = base + (1 + j) * 3;
        pos[dst] = this.outerPos[src];
        pos[dst + 1] = this.outerPos[src + 1];
        pos[dst + 2] = this.outerPos[src + 2];
        cx += pos[dst];
        cy += pos[dst + 1];
        cz += pos[dst + 2];
      }
      pos[base] = cx / CHORD_SEGMENTS;
      pos[base + 1] = cy / CHORD_SEGMENTS;
      pos[base + 2] = cz / CHORD_SEGMENTS;
    }
  }

  /** 管架路径：前缘管沿各站 s=0.5 轮廓点；翼尖管取两端站完整轮廓 */
  private updateFrame(): void {
    for (let i = 0; i < NS; i++) {
      const src = (i * NC + Math.floor(CHORD_SEGMENTS / 2)) * 3;
      this.lePath[i * 3] = this.outerPos[src];
      this.lePath[i * 3 + 1] = this.outerPos[src + 1];
      this.lePath[i * 3 + 2] = this.outerPos[src + 2];
    }
    for (let tip = 0; tip < 2; tip++) {
      const station = tip === 0 ? 0 : SPAN_SEGMENTS;
      const path = this.tipPaths[tip];
      for (let j = 0; j < NC; j++) {
        const src = (station * NC + j) * 3;
        path[j * 3] = this.outerPos[src];
        path[j * 3 + 1] = this.outerPos[src + 1];
        path[j * 3 + 2] = this.outerPos[src + 2];
      }
    }
    const chord0 = this.frames[0].chord;
    writeTubePositions(this.framePos, this.tubeLayouts[0], this.lePath, chord0 * 0.045, 0, 0, 1);
    writeTubePositions(this.framePos, this.tubeLayouts[1], this.tipPaths[0], chord0 * 0.028, 1, 0, 0);
    writeTubePositions(this.framePos, this.tubeLayouts[2], this.tipPaths[1], chord0 * 0.028, 1, 0, 0);
  }

  /**
   * 曲率估算张力：
   * 展向曲率来自拱形（载荷收紧时升高），弦向曲率来自翼型拱度
   */
  private computeTension(params: KiteParams, showTension: boolean): void {
    const raw = new Float32Array(NS * NC);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < NS; i++) {
      const i0 = Math.max(i - 1, 0);
      const i2 = Math.min(i + 1, SPAN_SEGMENTS);
      for (let j = 0; j < NC; j++) {
        const a = (i0 * NC + j) * 3;
        const b = (i * NC + j) * 3;
        const c = (i2 * NC + j) * 3;
        // 展向二阶差分 / 弦长平方量纲
        const dsSpan = params.span / SPAN_SEGMENTS;
        const kSpan =
          (Math.hypot(
            this.outerPos[a] - 2 * this.outerPos[b] + this.outerPos[c],
            this.outerPos[a + 1] - 2 * this.outerPos[b + 1] + this.outerPos[c + 1],
            this.outerPos[a + 2] - 2 * this.outerPos[b + 2] + this.outerPos[c + 2],
          ) /
            (dsSpan * dsSpan)) *
          4;

        // 弦向曲率：用拱弧线二阶导量级近似 m / chord
        const fr = this.frames[i];
        const kChord = (fr.m * 2.2) / Math.max(fr.chord, 0.1);

        const t = (kSpan + kChord) * params.tensionGain;
        raw[i * NC + j] = t;
        sum += t;
        if (t > peak) peak = t;
      }
    }
    // 平滑峰值，避免染色闪烁
    this.tensionMaxSmoothed = this.tensionMaxSmoothed * 0.92 + peak * 0.08;
    const denom = Math.max(this.tensionMaxSmoothed, 1e-4);
    this.tensionMean = sum / raw.length / denom;
    this.tensionRawMean = sum / raw.length;
    this.tensionPeak = peak / denom;

    const rgb: RGB = [0, 0, 0];
    for (let i = 0; i < NS * NC; i++) {
      const tn = Math.min(1, raw[i] / denom);
      if (showTension) {
        tensionColor(tn, rgb);
      } else {
        // 关闭染色：统一膜面暖白
        rgb[0] = 0.92;
        rgb[1] = 0.9;
        rgb[2] = 0.85;
      }
      this.outerCol[i * 3] = rgb[0];
      this.outerCol[i * 3 + 1] = rgb[1];
      this.outerCol[i * 3 + 2] = rgb[2];
      // 内膜色调更暗、更冷
      this.innerCol[i * 3] = rgb[0] * 0.6;
      this.innerCol[i * 3 + 1] = rgb[1] * 0.65;
      this.innerCol[i * 3 + 2] = rgb[2] * 0.8;
    }

    // 翼肋染色：跟随所在展向站的平均张力
    const ribColorAttr = this.ribs.attributes.color.array as Float32Array;
    for (let r = 0; r < RIB_STATIONS; r++) {
      const stationIdx = Math.round((r / (RIB_STATIONS - 1)) * SPAN_SEGMENTS);
      let acc = 0;
      for (let j = 0; j < NC; j++) acc += raw[stationIdx * NC + j];
      const tn = Math.min(1, acc / NC / denom);
      if (showTension) tensionColor(tn, rgb);
      else {
        rgb[0] = 0.85;
        rgb[1] = 0.86;
        rgb[2] = 0.9;
      }
      const base = r * NC * 3 * 3;
      for (let k = 0; k < NC * 3; k += 3) {
        ribColorAttr[base + k] = rgb[0] * 0.85;
        ribColorAttr[base + k + 1] = rgb[1] * 0.85;
        ribColorAttr[base + k + 2] = rgb[2] * 0.9;
      }
    }
  }

  dispose(): void {
    this.outer.dispose();
    this.inner.dispose();
    this.ribs.dispose();
    this.frame.dispose();
  }
}
