# 引力场流线可视化工具

在二维平面上放置最多 12 个质量点，按合成引力场用四阶龙格–库塔（RK4）追踪流线并可视化。
技术栈：**TypeScript + Svelte 5（runes）+ Babylon.js + Web Worker + Vite**。

## 功能

### 三个页面
1. **质量点编辑** — SVG 平面上点击放置、拖动定位、选中后编辑质量与坐标，含单/双/三/六质量环预设。
2. **流线生成** — Babylon 3D 场景中实时生成与调节，可拖动质量点触发 Worker 重算。
3. **结果查看** — 单条流线高亮、积分路径点序列表、JSON / PNG 导出。

### 物理与积分
- 引力加速度（含 Plummer 软化项，奇点处有限）：
  `a(r) = G · Σ mᵢ·(rᵢ−r) / (|rᵢ−r|² + ε²)^(3/2)`
- **场线沿归一化方向 `dr/ds = v/|v|` 积分**（弧长参数化），采用经典四阶 RK4。
- 自适应几何子步：每个子步位移不超过到最近质量点距离的一定比例，
  从根本上消除大步长“跨过”质量点的隧道效应；并辅以线段–捕获圆求交检查。
- 支持**正向 / 反向 / 双向**追踪；遇质量捕获半径、出界、停滞点或最大弧长时终止。

### 可调参数（实时）
- 种子密度（抖动网格，避免规则伪影）
- 积分步长（RK4 名义步长）
- 最大追踪长度（弧长）

### 渲染与交互
- 流线按**场强对数着色**（深蓝→青→绿→黄→红），三角带网格 + 逐顶点颜色。
- **锥体箭头**（thin instances）标示场方向。
- **原始折线 / 平滑曲线**（Catmull–Rom）两种显示模式。
- 点击场中任意位置显示该点**场强、分量、方向角**。
- 点击流线可**单独高亮**并查看其完整积分路径点序列。
- 导出全部流线顶点（位置 + 场分量 + 场强）为 JSON；导出当前画面为 PNG。

### 性能
- 流线计算全部在 **Web Worker 池**（2 个）中进行，主线程保持渲染。
- 流线数量硬上限 **20 000 条**、线系统顶点上限 120 万。
- 拖动时：降采样种子网格 + 收紧点预算 + 更宽松的子步系数，
  单次交互计算约 70–130 ms；新请求会终止并替换过期 Worker 任务，配合 55 ms 节流，
  松手后自动用全分辨率结果替换。目标拖动帧率 ≥ 20 fps。

## 开发

```bash
npm install
npm run dev        # 启动开发服务器
npm run check      # svelte-check 类型检查
npm run build      # 生产构建（Worker 独立成块）
```

## 测试

```bash
npm run test:smoke   # Node 端物理/积分/引擎数值断言（16 项）
npm run test:perf    # 不同密度场景的耗时与预算基准
npm run test:e2e     # 无头浏览器 CDP 端到端（需先以 --remote-debugging-port=9222 启动 Edge/Chrome）
```

## 目录结构

```
src/
  lib/
    types.ts            共享常量与类型（域、软化、上限、消息协议）
    fieldMath.ts        引力场、归一化方向、RK4、捕获/出界判定
    colorRamp.ts        场强对数色带
    streamlineEngine.ts 播种 + 自适应 RK4 积分 + 预算控制（Worker 内运行）
    fieldScene.ts       Babylon 场景：地面/网格/质量点/流线/箭头/探针/拾取
    appState.svelte.ts  模块级响应式状态与动作函数、Worker 调度
    exporters.ts        JSON / PNG 导出
  workers/
    streamline.worker.ts      Worker 入口
    streamlineClient.ts       Worker 池 + 过期任务取消
  components/           FieldCanvas、MassEditor、ParamSlider
  pages/                EditPage、GeneratePage、ResultsPage
scripts/                smoke / perf / e2e 测试
```

## 说明与取舍
- 质量点为纯吸引（正质量）。软化长度 ε=0.12，捕获半径 0.35，域为 ±10 的方形平面。
- 平滑模式仅改变渲染（插值显示），导出与高亮的路径点始终是真实 RK4 积分点。
- 交互模式的降采样只影响拖动过程中的临时画面，松手即恢复全精度。
