# 分子轨迹回放工具

基于 **TypeScript + React 18 + three.js + troika-three-text** 的多帧分子构象轨迹回放与分析应用,全部数据保存在浏览器本地(IndexedDB),无需后端。

## 功能模块

| 模块 | 能力 |
| --- | --- |
| 轨迹载入 | 多帧 XYZ / 自定义 JSON 解析,显示帧数与原子数;一键生成 1200 帧演示轨迹;本地轨迹库切换/删除 |
| 播放控制 | 播放/暂停、0.5 / 1 / 1.5 / 2 / 3 / 4 倍速、可拖动时间轴(亚帧精度)、按累计位移或元素 CPK 着色、轨迹拖尾、重置视角 |
| 位移分析 | 累计位移 Top10 原子表格 + 3D 视口 troika 文字残基标注;线性 / Catmull-Rom 平滑插值切换;最大/平均/中位位移统计 |
| 导出 | 选定帧区间 + 采样间隔导出为带动画轨道的 GLB(每原子一个节点,glTF VectorKeyframeTrack) |

视口左上角实时显示 FPS,底部播放条始终显示 `当前帧 / 总帧数`。

## 性能设计(千帧轨迹拖轴 ≥ 30 FPS)

- **Web Worker 并行插值**:线性与 Catmull-Rom 插值、累计位移计算全部在 `src/worker/` 中执行,坐标通过 Transferable ArrayBuffer 零拷贝传递。
- **请求合并 + 过期丢弃**:同一时刻只允许一个插值请求在飞,拖轴产生的新请求只保留最新一个,Worker 消息队列不会堆积;回包带单调序号,过期结果直接丢弃。
- **InstancedMesh 渲染**:每帧上传成本只与原子数 N 相关,与轨迹总帧数无关。
- **IndexedDB 裸二进制存储**:坐标以 Float32 字节存储,不经 JSON 字符串序列化。

实测(headless Chromium,1600×1000):1200 帧 × 144 原子拖动约 40 FPS;2000 帧 × 180 原子高速来回拖动 31–35 FPS。

## 快速开始

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # 类型检查 + 生产构建
```

进入应用后:
1. 「轨迹载入」→ 点击 **生成 1200 帧演示轨迹**(或上传 `examples/` 中的示例文件)
2. 「播放控制」→ 播放、拖动时间轴、切换着色与拖尾
3. 「位移分析」→ 查看 Top10、切换插值方式
4. 「导出」→ 选择帧区间下载 GLB

## 测试

```bash
npm run test:unit     # 解析/几何/插值纯逻辑数值测试(23 项)
npm run test:e2e      # Playwright 端到端(需先 npm run dev,28 项)
npm run test:stress   # 2000 帧上传 + 拖动帧率压力测试(需先 npm run dev)
```

## 输入文件格式

### 多帧 XYZ(.xyz)

每帧以原子数行开头,第二行为注释,随后 N 行 `元素 x y z`(坐标单位 Å),帧结构重复:

```
3
frame 1
N  0.00  0.00  0.00
CA 1.45  0.00  0.00
C  2.90  0.00  0.00
3
frame 2
...
```

### 自定义 JSON(.json,支持残基标注)

```json
{
  "name": "my-trajectory",
  "frameDelta": 0.5,
  "atoms": [
    { "element": "N", "residue": "ALA", "residueId": 1, "atomName": "N" }
  ],
  "frames": [[0, 0, 0, 1.45, 0, 0]]
}
```

`frames` 中每帧为 `atomCount * 3` 个数字的扁平数组。XYZ 无残基信息时,Top10 标注回退显示元素符号。

## 目录结构

```
src/
├── components/Viewport.tsx   # 视口 React 封装、播放时钟与 Worker 调度
├── lib/
│   ├── MoleculeScene.ts      # three.js 场景:InstancedMesh/键/拖尾/troika 标注
│   ├── idb.ts                # IndexedDB 持久化
│   ├── parsers.ts            # XYZ / JSON 解析
│   ├── geometry.ts           # 成键推断、包围球
│   ├── elements.ts           # CPK 配色、位移色带
│   ├── exporter.ts           # GLB 动画导出
│   └── demo.ts               # 合成轨迹生成器
├── worker/                   # 插值 Worker、协议、请求合并客户端
├── pages/                    # 四个功能模块页面
└── store.ts                  # zustand 全局状态
```
