<script lang="ts">
  import { appState, compute, setDirection } from '../lib/appState.svelte';
  import FieldCanvas from '../components/FieldCanvas.svelte';
  import ParamSlider from '../components/ParamSlider.svelte';
  import type { FieldScene, ProbeResult } from '../lib/fieldScene';
  import { MAX_STREAMLINES } from '../lib/types';
  import type { TraceDirection } from '../lib/types';

  let scene: FieldScene | null = $state(null);
  let probe = $state<ProbeResult | null>(null);
  let fps = $state(0);
  let paramTimer: ReturnType<typeof setTimeout> | null = null;

  const directions: { id: TraceDirection; label: string }[] = [
    { id: 'forward', label: '正向' },
    { id: 'backward', label: '反向' },
    { id: 'bidirectional', label: '双向' }
  ];

  const scheduleParamCompute = () => {
    if (paramTimer) clearTimeout(paramTimer);
    paramTimer = setTimeout(() => {
      void compute(false);
    }, 180);
  };

  const setParam = (key: 'seedDensity' | 'stepSize' | 'maxLength', v: number) => {
    appState.params[key] = v;
    scheduleParamCompute();
  };

  const changeDirection = (d: TraceDirection) => {
    setDirection(d);
    scheduleParamCompute();
  };

  const generate = async () => {
    probe = null;
    scene?.hideProbe();
    await compute(false);
  };

  const fpsClass = $derived(fps >= 30 ? 'fps-good' : fps >= 20 ? 'fps-warn' : 'fps-bad');
</script>

<div class="page">
  <aside class="sidebar">
    <div class="card">
      <h3>追踪参数（实时）</h3>
      <ParamSlider
        label="种子密度"
        value={appState.params.seedDensity}
        min={0.25}
        max={40}
        step={0.25}
        decimals={2}
        unit=" /单位²"
        onInput={(v) => setParam('seedDensity', v)}
      />
      <ParamSlider
        label="积分步长 (RK4 h)"
        value={appState.params.stepSize}
        min={0.02}
        max={1}
        step={0.01}
        decimals={2}
        onInput={(v) => setParam('stepSize', v)}
      />
      <ParamSlider
        label="最大追踪长度"
        value={appState.params.maxLength}
        min={5}
        max={200}
        step={1}
        decimals={0}
        unit=" 单位"
        onInput={(v) => setParam('maxLength', v)}
      />
    </div>

    <div class="card">
      <h3>追踪方向</h3>
      <div class="seg-group">
        {#each directions as d (d.id)}
          <button
            class={appState.params.direction === d.id ? 'active' : ''}
            onclick={() => changeDirection(d.id)}
          >
            {d.label}
          </button>
        {/each}
      </div>
      <p class="hint" style="margin-top: 8px">
        正向沿引力加速度方向追踪（指向质量点），反向背离质量点，双向同时追踪。
      </p>
    </div>

    <div class="card">
      <h3>显示模式</h3>
      <div class="seg-group">
        <button class={!appState.smoothMode ? 'active' : ''} onclick={() => (appState.smoothMode = false)}>
          原始折线
        </button>
        <button class={appState.smoothMode ? 'active' : ''} onclick={() => (appState.smoothMode = true)}>
          平滑曲线
        </button>
      </div>
    </div>

    <button class="primary" onclick={generate} disabled={appState.stats.computing}>
      {appState.stats.computing ? '计算中…' : '生成流线'}
    </button>

    <div class="card">
      <h3>操作</h3>
      <p class="hint">
        拖动橙色质量点，流线在 Web Worker 中重算并回传。点击场中任意位置读取该点场强与方向；点击流线可在结果页高亮。
      </p>
      <div class="row">
        <button class="ghost" onclick={() => (appState.page = 'edit')}>← 返回编辑</button>
        <button class="ghost" onclick={() => (appState.page = 'results')}>结果查看 →</button>
      </div>
    </div>
  </aside>

  <main class="stage">
    <FieldCanvas
      enableProbe={true}
      onReady={(s) => (scene = s)}
      onFps={(v) => (fps = v)}
      onProbe={(p) => (probe = p)}
      onLinePick={(r) => (appState.highlightedLine = r.lineIndex)}
    />

    <div class="legend">
      场强 |a|（对数着色）
      <div class="legend-bar"></div>
      <div class="legend-labels">
        <span>弱 10⁻³</span>
        <span>强 10⁴</span>
      </div>
    </div>

    {#if probe}
      <div class="overlay probe">
        <h3 style="margin: 0 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase">
          场点数值
        </h3>
        <div>位置：x = <b>{probe.x.toFixed(3)}</b>，z = <b>{probe.z.toFixed(3)}</b></div>
        <div>场强 |a| = <b class="value-pill">{probe.magnitude.toExponential(3)}</b></div>
        <div>
          分量 aₓ = <b>{probe.ax.toExponential(3)}</b>，a_z = <b>{probe.az.toExponential(3)}</b>
        </div>
        <div>方向角 θ = <b>{(probe.angle * 180 / Math.PI).toFixed(2)}°</b>（相对 +X 轴）</div>
        <div>单位向量：({Math.cos(probe.angle).toFixed(3)}, {Math.sin(probe.angle).toFixed(3)})</div>
      </div>
    {/if}

    <div class="overlay status">
      <span>流线 <b>{appState.stats.lineCount}</b> / {MAX_STREAMLINES}</span>
      <span>顶点 <b>{appState.stats.pointCount.toLocaleString()}</b></span>
      <span>Worker 耗时 <b>{appState.stats.elapsedMs.toFixed(1)} ms</b></span>
      <span class={fpsClass}>FPS <b>{fps}</b></span>
      {#if appState.stats.truncated}
        <span style="color: var(--danger)"><b>已达预算上限</b></span>
      {/if}
    </div>
  </main>
</div>
