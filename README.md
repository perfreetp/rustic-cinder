# 产线故障工况可视化工作台 (Line Fault Studio)

面向机械产线监控场景的三维故障工况可视化工具。基于 **Vue 3 + TypeScript + three.js + Pinia + Vite**。

## 功能清单

| 模块 | 能力 |
| --- | --- |
| 模型导入 | 支持 `.glb` / `.gltf` / `.obj` / `.stl`,自动构建零件树 |
| 关节识别 | 按节点名关键词(关节/铰链/回转/joint/hinge/pivot/actuator 等)自动识别可动关节,生成默认装配动画 |
| 动画时间轴 | 600 逻辑帧,拖动/播放拆卸与合拢过程;每关节独立 0–90° 行程、慢/常/快三档、旋转轴与方向 |
| 故障注入 | 卡料(橙)/ 过热(红)/ 断轴(紫)三类;注入即换色+高亮,时间轴自动跳转故障发生帧 |
| 剖切 | 可拖动裁剪平面(X/Y/Z),双 Pass 模板缓冲生成半透明剖切面,深度测试保证内部遮挡正确 |
| 框选联动 | Shift+左键框选、Ctrl 点选;选中集与装配层级联动,父节点状态被子节点继承且可单独覆盖 |
| 持久化 | 模型 Blob 与工况配置存 IndexedDB;可导出/载入 `.lfsproj.json` 工况文件分享 |
| 性能 | 合并网格 + 单池 InstancedMesh,万件场景 draw call 恒定在个位数量级;换色/剖切预算 300ms |

## 快速开始

```bash
npm install
npm run dev        # 开发服务器 http://127.0.0.1:5180
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览生产构建
```

### 生成测试模型

```bash
# 小模型(61 件,14 关节)
node scripts/make-test-model.mjs 6 public/samples/line-test.glb
# 万件模型(12607 件,用于性能验证)
node scripts/make-test-model.mjs 1400 public/samples/line-large.glb
```

### 端到端冒烟测试(31 项断言)

需要先 `npm run dev`,然后:

```bash
node scripts/e2e-smoke.mjs
```

覆盖:导入烘焙、关节识别、故障换色、时间轴播放、行程/档位编辑、剖切像素级验证、
框选批量状态、工况导出/再载入闭环、IndexedDB 本地保存、万件模型 draw call 与 300ms 预算。

## 架构

```
src/
├── types.ts                 # 全部领域类型(以零件树 path 为稳定标识)
├── constants.ts             # 故障色/档位曲线/性能预算
├── stores/
│   ├── model.ts             # 零件树、关节配置、选中集、状态继承与覆盖
│   └── session.ts           # 时间轴、故障注入、剖切、工程持久化
├── three/
│   ├── ModelImporter.ts     # 模型加载→零件树→关节识别→按材质池烘焙
│   ├── renderTypes.ts       # 烘焙后的渲染数据结构
│   ├── MaterialFactory.ts   # onBeforeCompile 注入状态纹理查询 + 裁剪平面
│   ├── StatusTexture.ts     # 零件状态→GPU DataTexture(换色/高亮的唯一数据源)
│   └── SceneEngine.ts       # 渲染循环、实例化动画、拾取、框选、模板剖切
├── utils/                   # 树路径、状态继承解析、动画曲线、IndexedDB
└── components/              # Vue 面板(树/视图/时间轴/故障/关节/剖切/批量)
```

### 关键设计

**1. 万件场景的 draw call 控制**

- 静态零件按源材质分池,池内 `mergeGeometries` 合并为单个网格;
- 关节零件烘焙到关节局部空间,每个材质池只建**一个** `InstancedMesh`,
  关节通过 `instanceSlot` 映射到实例下标。draw call ≈ 材质池数 × 2,与零件总数解耦;
- 每顶点携带 `aPartId`,所有渲染物体共享一张状态 `DataTexture`,
  故障换色只更新纹素(实测万件批量换色约 10ms,远低于 300ms 预算)。

**2. 状态继承与覆盖**

零件节点 `ownStatus = null` 表示继承,有效状态沿父链向上解析;
写入具体值即单独覆盖。故障注入作用于子树全部叶子零件,
"恢复继承"清除覆盖值。工况文件只持久化非 null 的覆盖项。

**3. 剖切的正确遮挡**

- 模型材质常驻一个 `THREE.Plane`(禁用时 constant 推到无穷远,避免着色器重编译);
- 启用时双 Pass 写模板:背面深度失败 INCR、正面深度失败 DECR,
  闭合实体内部模板值非零;
- 半透明 cap 平面仅在模板 `NOTEQUAL 0` 且通过深度测试处显色,
  因此内部零件不会被错误穿透。

**4. 性能预算的可观测性**

三维视图 HUD 实时显示 FPS(目标 ≥ 50)、换色耗时、剖切耗时,
超预算时控制台告警;`SceneEngine.getDebugInfo()` 暴露 draw call / 三角面 / 实例数。

## 已知边界

- 自动关节识别基于命名约定,未命中的节点可在后续版本中支持手动标记;
- 自动关节上限 500(超出按关键词评分截断),防止极端模型实例膨胀;
- headless 软件渲染(SwiftShader)FPS 仅作回归基准,50+ FPS 目标针对真实 GPU;
- 工况文件不内嵌模型本体,仅保存模型指纹;分享时对方需先导入同一模型。
