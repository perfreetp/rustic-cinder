# 风筝冲浪腾空姿态工作室

基于 **TypeScript + Svelte 5 + Babylon.js(WebGPU 优先,自动回退 WebGL2)** 的腾空动作空中姿态渲染工具。
导入一串腾空关键点(高度 / 水平位移 / 侧向漂移 / 伞翼朝向),系统插值出逐帧空间轨迹、
驱动骨骼人体与伞翼/伞绳,并支持时间轴逐帧查看、任意帧插关键帧、多机位与工程文件往返。

## 启动

```bash
npm install
npm run dev        # http://127.0.0.1:5173(被占用时自动换端口)
npm run build      # 生产构建
npm run check      # 类型检查
```

## 测试

```bash
npm run test:logic       # 纯逻辑层:插值、重插值、导入导出往返、千帧性能(12 项)
npm run test:browser     # 需先 npm run dev;CDP 驱动真实页面的交互链路
npm run test:occlusion   # 需先 npm run dev;伞翼后方视角的遮挡正确性像素验证
```

## 四个页面

| 页面 | 能力 |
| --- | --- |
| 轨迹 | 导入工程/裸 JSON/CSV、关键点表格编辑、高度 8 段色带着色、1200 帧压测入口 |
| 姿态 | 当前帧姿态读数、任意帧插入姿态关键帧、收腿/俯仰/滚转/展臂/前伸滑块、约束说明 |
| 时间轴 | 可拖拽播放头、播放/单帧/跳转、任意帧插入轨迹或姿态关键点并重新插值、逐帧数据 |
| 机位 | 跟随(距离随高度)/ 侧拍 / 地面仰视三视角,阻尼切换,遮挡渲染说明 |

## 架构

```
src/
  lib/
    types.ts          数据模型:轨迹关键点、姿态关键帧、逐帧 TypedArray 表
    math.ts           向心 Catmull-Rom、最短弧角度插值、smoothstep
    interpolation.ts  关键点 -> 逐帧烘焙(一次 O(N),之后单帧 O(1))
    io.ts             工程文件导出/导入、裸 JSON 与 CSV 解析
    sample.ts         内置示例与千帧压测数据
  render/
    StudioScene.ts    WebGPU 初始化+回退、场景装配、小数帧混合驱动
    RiggedFigure.ts   过程化骨骼人体:手臂/腿部两轴 IK、躯干跟随伞翼朝向
    ik.ts             两骨解析逆运动学(余弦定理 + 极向量)
    KiteRig.ts        弧面半透明伞翼 + 只写深度预通道 + 四根可拉伸伞绳
    TrajectoryLine.ts 高度分段着色曲线(thin instances,单次 draw call)
    CameraRig.ts      三机位、阻尼过渡、跟随距离随高度
  state/state.svelte.ts  Svelte 5 runes 全局状态 + 显式订阅
  components/             四个侧页面板、底部时间轴、3D 视口
```

### 关键设计

- **千帧流畅**:关键点一次烘焙进 `Float32Array` 帧表,拖动播放头是纯下标读取(实测 10 万次随机定位 ~8ms);
  轨迹曲线用 thin instances 单次绘制调用提交,关键点标记过多时自动抽样。
- **插值不过冲**:位置走向心 Catmull-Rom(经过全部控制点),朝向走最短弧避免 ±π 跳变,姿态参数 smoothstep。
- **姿态关键帧局部覆盖**:关键帧之间完全受控,首尾之外按 14 帧淡出回自动姿态(顶点团身、两端伸展)。
- **遮挡正确性**:半透明伞翼额外挂一个同形网格,用自定义 `ShaderMaterial` 只写深度不写颜色,
  在不透明阶段先写深度,透明伞翼后渲染时人体/伞绳通过深度测试显示在前。
- **手部约束**:两轴 IK 把双手约束到控制杆端点,伞绳从手部连到伞翼两角并按实际距离逐帧拉伸。
- **工程文件**:单个 JSON 同时保存轨迹关键点、姿态关键帧与 fps,重新导入后可继续编辑同一段动作。

## 导入数据格式

裸 JSON 数组或 `{ "trajectoryKeys": [...] }`,CSV 表头需含 `height`、`distance`(可选 `frame/lateral/kiteHeading`),
伞翼朝向在 UI 中以度展示、内部以弧度存储。
