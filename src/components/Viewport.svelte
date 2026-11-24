<script lang="ts">
  import { onMount } from "svelte";
  import { studio } from "../state/state.svelte";
  import { StudioScene } from "../render/StudioScene";

  declare global {
    interface Window {
      __scene?: StudioScene;
    }
  }

  let canvas: HTMLCanvasElement;
  let scene: StudioScene | null = null;
  let engineKind = $state("初始化中…");
  let ready = $state(false);
  let renderFps = $state(0);

  onMount(() => {
    let raf = 0;
    let disposed = false;
    let last = performance.now();
    let fpsAcc = 0;
    let fpsFrames = 0;
    let lastAppliedFrame = -1;
    let lastBakeVersion: unknown = null;

    const unsubCamera = studio.onCameraMode((mode) => scene?.setCameraMode(mode));

    StudioScene.create(canvas).then((s) => {
      if (disposed) {
        s.dispose();
        return;
      }
      scene = s;
      window.__scene = s;
      engineKind = s.engineKind;
      ready = true;
      s.setTrajectory(studio.bake(), studio.trajectoryKeys);
      s.setCameraMode(studio.cameraMode);
    });

    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (studio.playing) {
        let f = studio.currentFrame + dt * studio.fps;
        if (f >= studio.frameCount) f = 0;
        studio.setCurrentFrame(f);
      }
      if (scene) {
        // 帧定位:仅在播放头变化时下发,拖动是纯下标读取,开销恒定
        if (studio.currentFrame !== lastAppliedFrame) {
          lastAppliedFrame = studio.currentFrame;
          scene.setFrame(studio.currentFrame);
        }
        // 数据编辑后烘焙表引用变化才重建曲线(bake 内部带脏标记)
        const table = studio.bake();
        if (table !== lastBakeVersion) {
          lastBakeVersion = table;
          scene.setTrajectory(table, studio.trajectoryKeys);
        }
      }
      fpsAcc += dt;
      fpsFrames++;
      if (fpsAcc >= 0.5) {
        renderFps = Math.round(fpsFrames / fpsAcc);
        fpsAcc = 0;
        fpsFrames = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      unsubCamera();
      scene?.dispose();
      scene = null;
    };
  });
</script>

<div class="viewport">
  <canvas bind:this={canvas}></canvas>
  {#if !ready}
    <div class="loading">正在启动 {engineKind} 引擎…</div>
  {/if}
  <div class="hud">
    <span class="badge">{engineKind}</span>
    <span class="badge">渲染 {renderFps} FPS</span>
    <span class="badge">{studio.frameCount} 帧</span>
  </div>
</div>

<style>
  .viewport {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  canvas {
    width: 100%;
    height: 100%;
    outline: none;
    touch-action: none;
    display: block;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    background: var(--bg);
    font-size: 14px;
  }
  .hud {
    position: absolute;
    top: 10px;
    left: 10px;
    display: flex;
    gap: 6px;
    pointer-events: none;
  }
  .badge {
    background: rgba(13, 18, 26, 0.78);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 3px 10px;
    font-size: 11px;
    color: var(--text-dim);
  }
</style>
