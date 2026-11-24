# FORM · 生成式三维造型工作台

用笔刷逐笔堆叠体积, 生成真正连续、水密的实体表面, 再导出带材质与法线的 GLB。

技术栈: **TypeScript · React 19 · three.js · manifold-3d (WASM)**, 数据保存在浏览器本地。

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # 生产构建 (tsc + vite)
npm run preview  # 预览生产构建
```

## 使用流程

1. **选形体** — 球体 / 立方体 / 圆柱 / 胶囊 / 环面, 作为造型的第一块体积。
2. **堆叠** — 左键在表面上落笔; 拖动会拉出胶囊状笔触。
   - `1` 添加 · `2` 橡皮 · `3` 平滑 · `4` 移动 · `Q` 观察
   - `[` / `]` 调半径 · `X` 切换 X 轴镜像 · 按住空格或 Alt 临时旋转视角
   - 半径 / 硬度 / 融合强度各三档
3. **调整** — 移动工具点中已有笔刷后拖动, 只重算局部网格;
   历史面板可回退 / 前进到任意一笔, 也可删除单笔。
4. **导出** — 先做一次网格清理 (合并顶点、剔除退化面), 再导出 GLB,
   材质 (含 clearcoat/sheen 扩展) 与顶点法线一并保留。

## 关键设计

### 造型 = 一个标量场

整个模型是一个有符号距离场:

```
基础形体 → 第 1 笔 → 第 2 笔 → … → 第 n 笔
```

- **添加笔刷**: 平滑并集 `smin(d, brush, k)`, `k` 由"融合强度"档位决定 ——
  体积之间是焊缝式的融合, 而不是简单叠加。
- **橡皮笔刷**: 平滑差集 `smax(d, -brush, k)`; 负体积挖除后表面由场隐式重新闭合。
- **平滑笔刷**: 以笔刷中心为参考球面做平均曲率流 —— 只压低凸起、填平凹陷,
  球面本身保持不动; 按住时强度按 `1 - exp(-t/1.15)` 递增。
- **对称笔刷**: 镜像副本在编译场时生成, 因此始终与主笔刷同步更新。

单笔的多段体积之间也用较小的平滑并集, 避免拖动时出现"串珠"。

### 增量网格 (marching tetrahedra)

`src/core/surface.ts` 把场采样到固定栅格上 (节点值带缓存), 再逐单元提炼三角网格:

- 每个表面顶点由**一条栅格边**唯一确定, 位置只取决于两端节点的值;
- 每个单元保存自己的三角形 (顶点池 id), 重建时只动脏区覆盖的单元;
- 旧三角形释放引用, 引用归零的顶点回到空闲表; 存活的边界顶点用新节点值重算。

因此**局部重算的结果与全量重建逐顶点一致**, 接缝天然闭合, 不需要任何缝合步骤。
全量重建使用"粗网格 + Lipschitz 判据"先剔除无表面的区域, 求值次数从 O(N³) 降到约 O(N²)。

### 网格清理与导出

导出前把三角剖分交给 manifold-3d: 它枚举重合顶点 (`mergeFrom/mergeTo`)、
剔除零面积面并保证 2-流形; 再用 `calculateNormals` 生成带折痕保护的顶点法线。
GLB 由 three.js `GLTFExporter` 写出, 材质转为 `pbrMetallicRoughness` +
`KHR_materials_clearcoat` / `KHR_materials_sheen`。

### 模块

| 路径 | 职责 |
| --- | --- |
| `src/core/field.ts` | 笔刷场编译 (smin/smax、曲率流、镜像、剪枝) |
| `src/core/surface.ts` | 增量 marching tetrahedra 表面 |
| `src/core/engine.ts` | 重建调度、脏区计算、导出清理 |
| `src/core/mesh.ts` | 顶点焊接与折痕法线 (渲染/兜底) |
| `src/worker/geometry.worker.ts` | 几何 Web Worker (只做路由; 逻辑在 engine) |
| `src/three/viewport.ts` | 相机 / 环境反射 / 材质 / 笔刷光标 |
| `src/three/brushController.ts` | 落笔 / 拖动 / 按住递增 / 镜像同步 |
| `src/state/store.ts` | 造型状态、历史栈、localStorage 持久化 |
