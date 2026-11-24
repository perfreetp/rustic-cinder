# 风筝冲浪伞翼形变渲染器

基于 **TypeScript + React 18 + three.js** 的参数化伞翼实时形变渲染器。

## 运行

```bash
npm install
npm run dev        # 开发服务器（默认 http://localhost:5173）
npm run build      # 类型检查 + 生产构建
npm run test:smoke # Node 端几何冒烟测试（数值/法线/性能）
```

## 四个功能模块

| 模块 | 内容 |
| --- | --- |
| 伞翼编辑器 | 翼型拱度（根部拱度、翼尖比、拱度位置、厚度）与 5 站展向扭转分布，几何与载荷灵敏度 |
| 风窗视图 | 极坐标盘拖拽风筝位置（方位角 / 仰角），背景按风窗功率染色；风速 + 风窗角度两个滑杆 |
| 蒙皮材质 | 外膜 / 翼肋 / 内膜三层半透明膜面不透明度、骨架显隐、线框、张力色带 |
| 导出 | 当前翼型参数导出 JSON / CSV、剪贴板复制、JSON 回导、恢复默认 |

## 几何管线

```
参数化翼型截面 (airfoil.ts)          风窗状态 (types.ts)
  NACA 风格拱弧线 + 厚度分布            风速²(动压) × 风窗功率
            │                                  │
            └──────────► 展向放样 (canopy.ts) ◄┘
              25 站 × 13 轮廓点 = 325 顶点
              展向 24 段 × 弦向 12 段
              拱形圆柱路径 + 逐站坐标架 + 翼尖扭转
                          │
              ┌───────────┼───────────────┐
        位置重算      CPU 法线累积     曲率→张力→色带
        (外/内膜、     (三角形叉积      (展向二阶差分 +
         翼肋、管架)    面积加权归一化)   弦向拱度曲率)
                          │
                  BufferGeometry 原地写回
```

- **形变驱动**：载荷 = 风速²/900 × 风窗功率（边缘低、动力区高），驱动拱度放大、翼尖洗出扭转、拱形收紧
- **对称建模**：展向参数按到中轴的距离 `|u|` 计算，中心为根、两端同为翼尖
- **三层透明排序**：`depthWrite=false` + renderOrder 外膜(1)→翼肋(2)→内膜(3)，不透明管架走 renderOrder 0
- **60fps 保障**：动画循环每帧直接读 vanilla store 重建几何，绕开 React 渲染链路；拖拽只写可变对象不产生新引用。实测几何全量重算约 **0.3ms/帧**

## 目录结构

```
src/
  types.ts              参数/风窗类型、默认值、网格常量、风窗功率函数
  store.ts              vanilla store + useSyncExternalStore
  geometry/
    airfoil.ts          参数化翼型截面与扭转插值
    canopy.ts           放样模型（每帧顶点/法线/张力重算）
    tube.ts             前缘管/翼尖管扫掠生成
    colorRamp.ts        张力五段色带
  three/CanopyScene.ts  场景、材质、透明排序、渲染循环与 FPS 统计
  components/           Viewport / Slider / ModuleNav
  modules/              四个模块面板
```
