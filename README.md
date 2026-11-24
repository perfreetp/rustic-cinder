# 折序 · Origami Sequence Studio

折纸教学用的**折展序列**工具：在平面上标注折痕，给折痕角度打关键帧，把从平铺到成型的过程做成可回放、可导出的序列。

原生 TypeScript + Web Components 构建界面，PixiJS v8 的 **WebGPU** 渲染器负责纸面（自动回退到 WebGL）。

---

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview
npm test           # 折纸几何 / 关键帧插值 / 导出等单元测试（44 项）
npm run tokens     # 修改 src/ui/tokens.css 后重新生成 tokenCss.ts
```

浏览器需支持 WebGPU（Chrome / Edge 113+）或 WebGL2。页面右上角的芯片会显示实际使用的后端。

---

## 四个模块

### 1. 折痕建模

左侧纸面俯视图里直接拖拽绘制折痕，`V` 谷折 / `M` 山折 切换类型。

- **最多 32 条折痕**，折痕列表显示编号、类型、静态角度；空格不足时按钮置灰并提示。
- 绘制时自动吸附到 45° 整数倍（3° 以内），符合折纸习惯；端点可拖动微调，整条可平移。
- **悬空折痕自动延伸**：折痕若没落边，会沿自身方向延伸到纸边或另一条折痕，模拟真实折叠中折痕贯通纸张的行为。被延伸的折痕在列表里标记「已延伸」，画布上用虚线显示延伸段。
- **构型诊断**：实时给出面数、铰链数、循环折、Maekawa 顶点不闭合等提示。

几何核心（`src/core/arrangement.ts`）把折痕 + 纸边当作平面直线图，用半边遍历求内面，每个面是刚性纸片；再用 BFS 生成铰链树。循环折（如十字折的四条辐边）会被检测并报告——刚性树无法满足闭环，程序取生成树、把闭环边标出来。

### 2. 关键帧

底部时间轴按折痕分行，每条折痕一条轨道。

- **双击轨道插入关键帧**，拖动关键帧改时间与角度；在同一时刻再插会覆盖角度。
- 右侧检查器列出所选折痕的全部关键帧，可逐条删除或在当前时间插入。
- 相邻关键帧之间做 **单调三次 Hermite 插值**（Fritsch–Carlson 切线）：
  - **C¹ 连续**，跨过关键帧时角度不跳变；
  - **段内单调**，不会过冲（过冲会让谷折瞬间变成山折）；
  - 局部极值处切线为零，呈现自然的「停顿」。

轨道上淡淡的曲线就是插值结果，用的是渲染器同一套采样代码——所见即所得。

### 3. 序列播放

播放时逐帧求折面位姿。空格键播放/暂停，方向键逐帧步进（Shift 大步），可循环、可调倍速（0.25×–3×）。

折叠求解（`src/core/fold.ts`）把铰链树展开成一趟深度优先的变换合成：

```
childTransform = parentTransform · R(hingeLine, sign · θ)
```

每个面的世界变换只依赖祖先，整张纸 O(面数) 求解；顶点与法线每帧写入 GPU buffer，光照按折面实际朝向逐像素计算。

### 4. 纸面渲染与导出

**渲染**（`src/render/`）：自定义 WGSL（WebGL 回退用等价的 GLSL）着色器。

- **纸纤维漫反射**：两尺度噪声作为纸张高度场，调制漫反射亮度。
- **三档透光度**：不透明 / 半透 / 透光。后两档加入背光透射项，透光档额外加内部散射与暖色辉光。
- **主光方位可调**：方位角 + 高度角滑块，拨盘实时显示光向。
- **播放/拖动时明暗随折面朝向实时变化**：法线来自折面变换，不是近似。
- 平铺视图用正交投影 + 折痕图样（山折点划线、谷折实线）；立体视图用透视深度缓冲，折面互相正确遮挡。

**导出**：一键下载 JSON 序列文件，包含

```jsonc
{
  "schema": "zhexu.sequence", "version": 1,
  "units": { "length": "sheet-normalised", "angle": "degree", "time": "second" },
  "sheet": { "size": 2 },
  "timeline": { "duration": 4, "loop": true, "speed": 1 },
  "creases": [{ "id", "slot", "type", "a", "b", "staticAngle", "keyframes": [{ "time", "angle" }] }],
  "material": { "tint", "translucency", "azimuth", "elevation", "fiber", "ambient" },
  "build": { "faces", "hinges", "cycleEdges", "diagnostics": { … } },
  "samples": { "hz": 60, "frames": [{ "time", "angles": { … } }] }   // 可选：逐帧角度采样
}
```

完整序列（折痕 + 关键帧 + 材质 + 时间轴）与可选逐帧采样都能导出；导出的文件可再导入（`导入` 按钮）。

---

## 稳定性与性能

- **播放 60 fps**：headless 冒烟测试实测中位帧间隔 16.7 ms、p95 17.1 ms（1440×900，WebGPU）。
- 渲染按需：无变化时不重绘；播放时稳定循环。
- 拓扑与曲线分级缓存——拖动时间轴只重解变换与重写顶点，不重建排布、不上传几何。

`npm run build` 后可用无头 Chrome 跑端到端冒烟测试（会截图并断言交互）：

```bash
# 需要 Chrome；Windows 示例
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node tools/smoke.mjs
```

冒烟覆盖：启动、播放帧率、载入示例、绘制折痕、拖动时间轴、材质档位、抽屉开关、平铺/立体切换、导出下载并解析、撤销、移动端无横向溢出。

---

## 代码结构

```
src/
  core/            纯逻辑，无 DOM 依赖，全部有单元测试
    math.ts        2D/3D 数学（列主序矩阵）
    types.ts       文档与几何类型
    creases.ts     折痕裁剪、延伸、求交
    arrangement.ts 平面直线图 → 面 + 铰链树 + 半边遍历 + 多边形三角化
    fold.ts        铰链树变换求解、世界网格装配
    timeline.ts    关键帧归一化、单调 Hermite 采样、时间推进
    doc.ts         文档 + 撤销/重做 + 手势合并
    exporter.ts    导出载荷、下载、导入解析与校验
    samples.ts     四个教学示例
  render/
    paperShaders.ts  WGSL + GLSL 纸面/背景/地面着色器
    paperRenderer.ts PixiJS WebGPU 场景、深度渲染目标、呈现、轨道相机
    creaseTexture.ts 折痕场纹理（seam / pattern 两种样式）
  app/
    studio.ts      状态中枢：文档、缓存、播放头、事件
  ui/              Web Components（shadow DOM）
    base.ts        响应式元素基类 + 焦点/滚动保持的 patch
    creaseEditor.ts 折痕建模
    timelineEditor.ts 时间轴 + 关键帧
    viewport3d.ts  3D 视口与渲染循环
    materialPanel.ts 纸面与光照
    topBar.ts      文件、撤销、播放、示例、导出
    appShell.ts    三栏布局
  main.ts          启动、全局快捷键
tests/             vitest 单元测试
tools/smoke.mjs    无头端到端冒烟
```

---

## 已知边界

- 折痕建模面向**铰链树可表示的折叠**；闭环折（如水炸弹的闭合顶点）会被检测并报告，但按生成树近似，不做完整的刚性闭环求解。
- 折面按平面的多边形面片渲染，不做弯曲（弯折）建模。
- 平铺视图把全部折痕角归零，显示折痕图样；如需查看叠层关系请切回立体视图。
