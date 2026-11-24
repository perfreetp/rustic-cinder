import * as THREE from 'three';
import type { StatusTexture } from './StatusTexture';

/**
 * 为每个材质池构建 MeshStandardMaterial,并通过 onBeforeCompile 注入:
 *  1. aPartId 顶点属性 → 状态纹理查询(故障换色 + 选中高亮)
 *  2. 局部裁剪平面(剖切模块,平面常驻;禁用剖切时将 constant 推至无穷远,
 *     避免切换开关触发着色器重编译)
 * 所有材质共享同一张状态纹理与同一个裁剪平面,保证批量更新成本恒定。
 */
const CHUNK = {
  /** 仅顶点着色器可用的 attribute 声明 */
  vertexAttributes: `
attribute float aPartId;
varying float vPartId;
uniform sampler2D uStatusTex;
uniform float uStatusTexWidth;
uniform float uStatusTexHeight;
`,
  /** 片元着色器只能声明 varying 与 uniform(GLSL3 中 attribute 为保留字) */
  fragmentAttributes: `
varying float vPartId;
uniform sampler2D uStatusTex;
uniform float uStatusTexWidth;
uniform float uStatusTexHeight;
`,
  vertex: `
vPartId = aPartId;
`,
  fragmentHeader: `
vec3 statusLookupColor(float partId, out float code) {
  float pid = clamp(partId, 0.0, uStatusTexWidth * uStatusTexHeight - 1.0);
  float u = (mod(pid, uStatusTexWidth) + 0.5) / uStatusTexWidth;
  float v = (floor(pid / uStatusTexWidth) + 0.5) / uStatusTexHeight;
  vec4 tex = texture2D(uStatusTex, vec2(u, v));
  code = tex.a * 255.0 + 0.5;
  return tex.rgb;
}
`,
  fragmentBody: `
{
  float statusCode = 0.0;
  vec3 statusColor = statusLookupColor(vPartId, statusCode);
  if (statusCode > 0.5 && statusCode < 3.5) {
    // 1/2/3 = 故障:漫反射替换为故障色并加发射
    diffuseColor.rgb = statusColor;
    totalEmissiveRadiance += statusColor * 0.35;
  } else if (statusCode > 3.5 && statusCode < 4.5) {
    // 4 = 仅选中:蓝色发射,保留原色
    totalEmissiveRadiance += vec3(0.118, 0.565, 1.0) * 0.45;
  } else if (statusCode > 4.5) {
    // 5 = 故障 + 选中
    diffuseColor.rgb = statusColor;
    totalEmissiveRadiance += vec3(0.118, 0.565, 1.0) * 0.55;
  }
}
`,
};

export class MaterialFactory {
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly status: StatusTexture;

  constructor(status: StatusTexture, sourceMaterials: THREE.Material[]) {
    this.status = status;
    this.uniforms = {
      uStatusTex: { value: status.texture },
      uStatusTexWidth: { value: status.texture.image.width },
      uStatusTexHeight: { value: status.texture.image.height },
    };
    for (const src of sourceMaterials) {
      this.materials.push(this.build(src as THREE.MeshStandardMaterial));
    }
  }

  private build(src: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: src?.color ? src.color.clone() : new THREE.Color(0x9aa7b5),
      map: src?.map ?? null,
      metalness: src?.metalness ?? 0.25,
      roughness: src?.roughness ?? 0.65,
      transparent: false,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${CHUNK.vertexAttributes}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CHUNK.vertex}`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\n${CHUNK.fragmentAttributes}\n${CHUNK.fragmentHeader}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>\n${CHUNK.fragmentBody}`,
        );
    };
    mat.customProgramCacheKey = () => 'line-fault-status-v1';
    return mat;
  }

  get list(): THREE.MeshStandardMaterial[] {
    return this.materials;
  }

  /** 绑定常驻裁剪平面(仅赋值,不触发重编译) */
  bindClippingPlane(plane: THREE.Plane): void {
    for (const m of this.materials) {
      m.clippingPlanes = [plane];
    }
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    void this.status;
  }
}
