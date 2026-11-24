<script lang="ts">
  import { studio } from "../state/state.svelte";
  import type { CameraMode } from "../lib/types";

  const modes: Array<{ id: CameraMode; name: string; desc: string }> = [
    { id: "follow", name: "跟随视角", desc: "镜头锁定人体并环绕跟随,距离随高度自动拉远,高空能看到完整伞翼与伞绳。" },
    { id: "side", name: "侧拍视角", desc: "固定在轨迹侧面,观察起跳、收腿、伸展的完整侧面姿态轮廓。" },
    { id: "ground", name: "地面仰视", desc: "相机贴近水面低角度上仰,模拟从地面看腾空,伞翼在头顶展开。" },
  ];
</script>

<div class="panel">
  <h3>机位切换</h3>
  <div class="modes">
    {#each modes as m (m.id)}
      <button
        class="mode"
        class:on={studio.cameraMode === m.id}
        onclick={() => (studio.cameraMode = m.id)}
      >
        {m.name}
      </button>
    {/each}
  </div>
  <p class="muted" style="font-size: 11px; margin: 10px 0 0; line-height: 1.7">
    {modes.find((m) => m.id === studio.cameraMode)?.desc}
  </p>
</div>

<div class="panel" style="margin-top: 12px">
  <h3>遮挡渲染</h3>
  <p class="muted" style="font-size: 11px; margin: 0; line-height: 1.7">
    半透明伞翼带独立深度预通道:先写深度再做透明混合,因此切换到任意机位时,
    位于伞翼前方的人体、控制杆与伞绳都不会被伞翼错误盖住;伞绳与人体走不透明深度测试,前后遮挡正确。
  </p>
</div>

<div class="panel" style="margin-top: 12px">
  <h3>视角操作</h3>
  <ul class="muted" style="font-size: 11px; margin: 0; padding-left: 16px; line-height: 1.9">
    <li>左键拖拽:环绕旋转</li>
    <li>滚轮:缩放(跟随模式仍受高度距离约束)</li>
    <li>右键拖拽 / 中键:平移</li>
    <li>切换机位有阻尼过渡,不会跳变</li>
  </ul>
</div>

<style>
  .modes {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .mode {
    text-align: left;
    padding: 10px 12px;
    font-size: 13px;
  }
  .mode.on {
    border-color: var(--accent);
    background: rgba(56, 160, 232, 0.16);
    color: #9fd4ff;
  }
</style>
