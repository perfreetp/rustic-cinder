<script lang="ts">
  import { appState, addMass, updateMass } from '../lib/appState.svelte';
  import { FIELD_HALF, MAX_MASSES } from '../lib/types';

  interface Props {
    selectedId: number | null;
    onSelect: (id: number | null) => void;
  }

  let { selectedId, onSelect }: Props = $props();

  let svg: SVGSVGElement;
  let dragging = false;
  let dragId: number | null = null;

  // viewBox is a fixed square; coordinate conversion is just a scale.
  const VB = 600;
  const toWorld = (clientX: number, clientY: number) => {
    const rect = svg.getBoundingClientRect();
    const u = ((clientX - rect.left) / rect.width) * (2 * FIELD_HALF) - FIELD_HALF;
    const v = FIELD_HALF - ((clientY - rect.top) / rect.height) * (2 * FIELD_HALF);
    const clamp = (x: number) => Math.max(-FIELD_HALF, Math.min(FIELD_HALF, x));
    return { x: clamp(u), z: clamp(v) };
  };

  const toSvgX = (x: number) => ((x + FIELD_HALF) / (2 * FIELD_HALF)) * VB;
  const toSvgY = (z: number) => ((FIELD_HALF - z) / (2 * FIELD_HALF)) * VB;
  const radiusFor = (mass: number) => 8 + 9 * Math.cbrt(mass / 120);

  const onSvgClick = (ev: MouseEvent) => {
    if (dragging) return;
    const target = ev.target as Element;
    if (target.closest('.mass')) return; // handled by the circle's own handlers
    if (appState.masses.length >= MAX_MASSES) return;
    const { x, z } = toWorld(ev.clientX, ev.clientY);
    const id = addMass(x, z);
    if (id !== null) onSelect(id);
  };

  const onPointerDown = (ev: PointerEvent, id: number) => {
    ev.stopPropagation();
    onSelect(id);
    dragId = id;
    dragging = false;
    svg.setPointerCapture(ev.pointerId);
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (dragId === null) return;
    dragging = true;
    const { x, z } = toWorld(ev.clientX, ev.clientY);
    updateMass(dragId, { x, z });
  };

  const onPointerUp = (ev: PointerEvent) => {
    if (dragId === null) return;
    try {
      svg.releasePointerCapture(ev.pointerId);
    } catch {
      /* noop */
    }
    dragId = null;
    // click vs drag settles on the next tick so onSvgClick can ignore drags
    setTimeout(() => (dragging = false), 0);
  };

  const gridLines = $derived(
    Array.from({ length: 21 }, (_, i) => {
      const p = (i / 20) * VB;
      return { p, major: i % 5 === 0 };
    })
  );
</script>

<div class="svg-host">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svg}
    viewBox={`0 0 ${VB} ${VB}`}
    class="editor"
    role="application"
    aria-label="质量点编辑平面：点击空白放置质量点，拖动圆点调整位置"
    tabindex="-1"
    onclick={onSvgClick}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onkeydown={() => {}}
  >
    <rect width={VB} height={VB} fill="#0d131d" />
    {#each gridLines as g (g.p)}
      <line
        x1={g.p} y1="0" x2={g.p} y2={VB}
        stroke={g.major ? 'rgba(150,190,255,0.4)' : 'rgba(120,160,220,0.15)'}
        stroke-width="1"
      />
      <line
        x1="0" y1={g.p} x2={VB} y2={g.p}
        stroke={g.major ? 'rgba(150,190,255,0.4)' : 'rgba(120,160,220,0.15)'}
        stroke-width="1"
      />
    {/each}

    {#each appState.masses as m (m.id)}
      {@const r = radiusFor(m.mass)}
      <g class="mass" class:selected={m.id === selectedId}>
        <circle
          cx={toSvgX(m.x)}
          cy={toSvgY(m.z)}
          r={r + 4}
          fill="rgba(255,122,47,0.18)"
          class="halo"
        />
        <circle
          cx={toSvgX(m.x)}
          cy={toSvgY(m.z)}
          r={r}
          fill="url(#massGrad)"
          stroke={m.id === selectedId ? '#ffe08a' : '#ff9a5c'}
          stroke-width={m.id === selectedId ? 2.5 : 1.2}
          role="button"
          tabindex="0"
          aria-label={`质量点 ${m.id}`}
          onpointerdown={(ev) => onPointerDown(ev, m.id)}
        />
        <text
          x={toSvgX(m.x)}
          y={toSvgY(m.z) + 3.5}
          class="mass-label"
          pointer-events="none"
        >{m.id}</text>
      </g>
    {/each}

    <defs>
      <radialGradient id="massGrad" cx="35%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#ffd0a8" />
        <stop offset="100%" stop-color="#ff7a2f" />
      </radialGradient>
    </defs>
  </svg>

  <div class="editor-hint">
    点击空白处放置质量点（{appState.masses.length}/{MAX_MASSES}），拖动圆点调整位置，点击选中后在左侧编辑质量。
  </div>
</div>

<style>
  .svg-host {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .editor {
    width: min(100%, calc(100vh - 140px));
    height: min(100%, calc(100vh - 140px));
    border: 1px solid var(--border);
    border-radius: 12px;
    touch-action: none;
    user-select: none;
  }

  .mass {
    cursor: grab;
  }

  .mass:active {
    cursor: grabbing;
  }

  .mass-label {
    fill: #2a1404;
    font-size: 11px;
    font-weight: 700;
    text-anchor: middle;
  }

  .editor-hint {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(10, 16, 26, 0.88);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 16px;
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
</style>
