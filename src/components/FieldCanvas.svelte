<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Observer } from '@babylonjs/core';
  import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
  import { FieldScene, type LinePickResult, type ProbeResult } from '../lib/fieldScene';
  import {
    appState,
    addMass,
    endInteraction,
    scheduleInteractiveCompute,
    updateMass
  } from '../lib/appState.svelte';

  interface Props {
    /** When true, double-clicking empty space adds a mass point. */
    allowAdd?: boolean;
    /** When false, tap probes are suppressed. */
    enableProbe?: boolean;
    onProbe?: (p: ProbeResult) => void;
    onLinePick?: (r: LinePickResult) => void;
    onFps?: (fps: number) => void;
    onReady?: (scene: FieldScene) => void;
  }

  let {
    allowAdd = false,
    enableProbe = true,
    onProbe,
    onLinePick,
    onFps,
    onReady
  }: Props = $props();

  let canvas: HTMLCanvasElement;
  let scene: FieldScene | null = null;
  let dragId: number | null = null;
  let dragMoved = false;
  let lastResultVersion = -1;
  let frameCount = 0;
  let fpsTimer: ReturnType<typeof setInterval> | null = null;
  let renderObserver: Observer<AbstractEngine> | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const cleanups: (() => void)[] = [];

  onMount(() => {
    scene = new FieldScene(canvas);
    scene.setProbeHandler((p) => {
      if (!enableProbe) {
        scene?.hideProbe();
        return;
      }
      onProbe?.(p);
    });
    scene.setLinePickHandler((r) => {
      if (enableProbe) onLinePick?.(r);
    });
    scene.syncMassPoints(appState.masses);
    scene.runRenderLoop();
    onReady?.(scene);

    resizeObserver = new ResizeObserver(() => scene?.resize());
    resizeObserver.observe(canvas.parentElement!);

    fpsTimer = setInterval(() => {
      onFps?.(frameCount * 2);
      frameCount = 0;
    }, 500);
    renderObserver = scene.engine.onEndFrameObservable.add(() => frameCount++);

    // ---- mass-point dragging with camera-control arbitration ----
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0 || !scene) return;
      const id = scene.pickMass();
      if (id === null) return;
      dragId = id;
      dragMoved = false;
      scene.camera.detachControl();
      canvas.setPointerCapture(ev.pointerId);
    };
    const move = () => {
      if (dragId === null || !scene) return;
      const plane = scene.pointerToPlane();
      if (!plane) return;
      dragMoved = true;
      updateMass(dragId, { x: plane.x, z: plane.z });
      scene.syncMassPoints(appState.masses);
      scheduleInteractiveCompute();
    };
    const up = (ev: PointerEvent) => {
      if (dragId === null || !scene) return;
      dragId = null;
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* pointer already released */
      }
      scene.camera.attachControl(canvas, true);
      if (dragMoved) endInteraction();
    };
    const doubleClick = (ev: MouseEvent) => {
      if (!allowAdd || !scene) return;
      ev.preventDefault();
      const plane = scene.pointerToPlane();
      if (!plane) return;
      addMass(plane.x, plane.z);
      scene.syncMassPoints(appState.masses);
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('dblclick', doubleClick);
    cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('dblclick', doubleClick);
    });
  });

  onDestroy(() => {
    if (fpsTimer) clearInterval(fpsTimer);
    if (renderObserver && scene) scene.engine.onEndFrameObservable.remove(renderObserver);
    resizeObserver?.disconnect();
    cleanups.forEach((fn) => fn());
    scene?.dispose();
    scene = null;
  });

  // External mass edits (sliders, lists, presets) -> scene sync.
  $effect(() => {
    const masses = appState.masses;
    scene?.syncMassPoints(masses);
  });

  // Worker results -> mesh update.
  $effect(() => {
    const version = appState.resultVersion;
    const result = appState.result;
    if (scene && version !== lastResultVersion) {
      lastResultVersion = version;
      if (result) scene.setStreamlines(result);
      else scene.clearHighlight();
    }
  });

  $effect(() => {
    scene?.setSmoothMode(appState.smoothMode);
  });

  $effect(() => {
    const idx = appState.highlightedLine;
    if (!scene) return;
    if (idx >= 0) scene.highlightLine(idx);
    else scene.clearHighlight();
  });
</script>

<div class="canvas-host">
  <canvas bind:this={canvas}></canvas>
</div>
