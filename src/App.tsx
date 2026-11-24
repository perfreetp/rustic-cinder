import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  LEVEL_LABELS,
  LEVEL_SCALES,
  LEVEL_COUNT,
  LIMITS,
  VIEW_MODES,
  EMISSIVE_SPECS,
  type LevelState,
  type ViewMode,
} from './core/constants';
import { createDefaultLevels } from './core/levels';
import { clamp, round2 } from './core/params';
import { Viewer, type ViewerSnapshot } from './render/viewer';
import { exportAll, type ExportResult } from './export/exporter';
import { Section, Slider, ToggleRow } from './ui/controls';

export function App() {
  const [threshold, setThreshold] = createSignal(0.5);
  const [knee, setKnee] = createSignal(0.55);
  const [intensity, setIntensity] = createSignal(1.25);
  const [exposure, setExposure] = createSignal(1.0);
  const [levels, setLevels] = createSignal<LevelState[]>(createDefaultLevels());
  const [view, setView] = createSignal<ViewMode>('final');
  const [occlusionEnabled, setOcclusionEnabled] = createSignal(true);
  const [occlusionStrength, setOcclusionStrength] = createSignal(1);
  const [autoRotate, setAutoRotate] = createSignal(true);
  const [objectsEnabled, setObjectsEnabled] = createSignal<boolean[]>(
    EMISSIVE_SPECS.map(() => true),
  );

  const [snapshot, setSnapshot] = createSignal<ViewerSnapshot | null>(null);
  const [ready, setReady] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [exportMsg, setExportMsg] = createSignal<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [bootError, setBootError] = createSignal<string | null>(null);

  let host: HTMLDivElement | undefined;
  let viewer: Viewer | undefined;

  onMount(() => {
    if (!host) return;
    try {
      viewer = new Viewer({
        container: host,
        params: {
          threshold: threshold(),
          knee: knee(),
          intensity: intensity(),
          exposure: exposure(),
          levels: levels(),
          view: view(),
          occlusionEnabled: occlusionEnabled(),
          occlusionStrength: occlusionStrength(),
          autoRotate: autoRotate(),
          objectsEnabled: objectsEnabled(),
        },
        onSnapshot: setSnapshot,
      });
      viewer.start();
      setReady(true);
      // 调试/自动化接口（不参与生产逻辑）
      (window as unknown as { __glow?: unknown }).__glow = viewer;
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err));
      console.error(err);
    }
  });

  onCleanup(() => {
    viewer?.dispose();
    viewer = undefined;
  });

  // 参数同步到渲染器
  createEffect(() => {
    viewer?.setParams({
      threshold: threshold(),
      knee: knee(),
      intensity: intensity(),
      exposure: exposure(),
      levels: levels(),
      view: view(),
      occlusionEnabled: occlusionEnabled(),
      occlusionStrength: occlusionStrength(),
      autoRotate: autoRotate(),
      objectsEnabled: objectsEnabled(),
    });
  });

  const currentViewHint = () => VIEW_MODES.find((m) => m.id === view())?.hint ?? '';

  const updateLevel = (index: number, patch: Partial<LevelState>) => {
    setLevels((prev) =>
      prev.map((level, i) =>
        i === index
          ? {
              radius: patch.radius !== undefined ? clamp(round2(patch.radius), LIMITS.radius.min, LIMITS.radius.max) : level.radius,
              weight: patch.weight !== undefined ? clamp(round2(patch.weight), LIMITS.weight.min, LIMITS.weight.max) : level.weight,
            }
          : level,
      ),
    );
  };

  const toggleObject = (index: number) => {
    setObjectsEnabled((prev) => prev.map((on, i) => (i === index ? !on : on)));
  };

  const dimsFor = (level: number) => {
    const s = snapshot();
    if (!s) return '—';
    const w = Math.max(1, Math.floor(s.width / 2 ** (level + 1)));
    const h = Math.max(1, Math.floor(s.height / 2 ** (level + 1)));
    return `${w}×${h}`;
  };

  const doExport = async () => {
    if (!viewer || exporting()) return;
    setExporting(true);
    setExportMsg(null);
    try {
      const gains = viewer.gains;
      const objects = EMISSIVE_SPECS.map((spec, i) => ({
        id: spec.id,
        name: spec.name,
        enabled: objectsEnabled()[i] ?? true,
        visible: gains[i]?.visible ?? 1,
        gain: gains[i]?.gain ?? 1,
      }));
      const size = viewer.pipeline.drawingBufferSize;
      const result: ExportResult = await exportAll({
        params: {
          threshold: threshold(),
          knee: knee(),
          intensity: intensity(),
          exposure: exposure(),
          occlusionEnabled: occlusionEnabled(),
          occlusionStrength: occlusionStrength(),
          levels: levels(),
          view: view(),
          objectsEnabled: objectsEnabled(),
        },
        width: size.width,
        height: size.height,
        pixelRatio: viewer.renderer.getPixelRatio(),
        objects,
        capturePNG: () => viewer!.capturePNG(),
      });
      setExportMsg({
        text: `已导出 ${result.pngName}（${result.width}×${result.height}，${(result.pngBytes / 1024).toFixed(0)} KB）\n与 ${result.jsonName}`,
        kind: 'ok',
      });
    } catch (err) {
      setExportMsg({
        text: `导出失败：${err instanceof Error ? err.message : String(err)}`,
        kind: 'err',
      });
    } finally {
      setExporting(false);
    }
  };

  const fpsClass = () => {
    const f = snapshot()?.fps ?? 0;
    if (f >= 55) return 'ok';
    if (f >= 30) return 'warn';
    return '';
  };

  return (
    <div class="app">
      <div class="viewport">
        <div class="viewport-host" ref={host} />

        <div class="hud-top">
          <div class="brand">
            <span class="brand-dot" />
            <div>
              <h1>辉光溢出合成器</h1>
              <small>GLOW BLOOM LAB · 5-LEVEL DOWNSAMPLE</small>
            </div>
          </div>
          <div class="hud-stats">
            <div class="hud-stat">
              <span>FPS</span>
              <b class={fpsClass()}>{snapshot() ? Math.round(snapshot()!.fps) : '—'}</b>
            </div>
            <div class="hud-stat">
              <span>PASSES</span>
              <b>{snapshot()?.stats.passes ?? '—'}</b>
            </div>
            <div class="hud-stat">
              <span>BUFFER</span>
              <b>
                {snapshot() ? `${snapshot()!.width}×${snapshot()!.height}` : '—'}
              </b>
            </div>
            <div class="hud-stat">
              <span>CPU</span>
              <b>{snapshot() ? `${snapshot()!.stats.cpuMs.toFixed(1)}ms` : '—'}</b>
            </div>
          </div>
        </div>

        <div class="view-tabs" role="tablist" aria-label="视图模式">
          <For each={VIEW_MODES}>
            {(mode) => (
              <button
                type="button"
                role="tab"
                aria-selected={view() === mode.id}
                data-active={String(view() === mode.id)}
                onClick={() => setView(mode.id)}
              >
                {mode.label}
              </button>
            )}
          </For>
        </div>
        <div class="view-hint">{currentViewHint()}</div>
        <div class="hud-help">
          拖拽环绕 · 滚轮缩放
          <br />
          相机移动时遮挡实时重算
        </div>

        <Show when={!ready()}>
          <div class="boot" data-done={String(!!bootError())}>            <div class="boot-inner">
              <Show when={bootError()} fallback={<><div class="spinner" /><span>正在初始化 WebGL2 与辉光管线…</span></>}>
                <span style={{ color: 'var(--danger)' }}>初始化失败：{bootError()}</span>
                <span style={{ 'max-width': '420px', 'text-align': 'center', 'line-height': '1.6' }}>
                  请确认浏览器支持 WebGL2，并使用支持硬件加速的环境打开。
                </span>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <aside class="panel">
        <div class="panel-scroll">
          <Section index="1" title="场景" note={`${EMISSIVE_SPECS.length} 个自发光体`}>
            <div class="toggle-row">
              <div class="toggle-row-text">
                <b>相机自动环绕</b>
                <small>遮挡关系持续变化，光晕实时跟随</small>
              </div>
              <button
                class="toggle"
                role="switch"
                aria-checked={autoRotate()}
                aria-label="相机自动环绕"
                data-on={String(autoRotate())}
                onClick={() => setAutoRotate(!autoRotate())}
                type="button"
              />
            </div>
            <div class="object-list" style={{ 'margin-top': '10px' }}>
              <For each={EMISSIVE_SPECS}>
                {(spec, i) => (
                  <div
                    class="object-row"
                    data-off={String(!objectsEnabled()[i()])}
                    onClick={() => toggleObject(i())}
                    role="button"
                    tabindex="0"
                    aria-pressed={objectsEnabled()[i()]}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleObject(i());
                      }
                    }}
                  >
                    <span
                      class="swatch"
                      style={{
                        background: `rgb(${spec.color.map((c) => Math.round(Math.min(255, (c / 3.2) * 255))).join(',')})`,
                        color: `rgb(${spec.color.map((c) => Math.round(Math.min(255, (c / 3.2) * 255))).join(',')})`,
                      }}
                    />
                    <span class="object-name">
                      <b>{spec.name}</b>
                      <small>#{i() + 1} · {spec.shape}</small>
                    </span>
                    <span class="vis-meter" title="可见比例">
                      <span class="vis-bar">
                        <i
                          style={{
                            width: `${Math.round((snapshot()?.occlusion[i()]?.visible ?? 1) * 100)}%`,
                          }}
                        />
                      </span>
                      <span
                        class="vis-num"
                        data-low={String((snapshot()?.occlusion[i()]?.visible ?? 1) < 0.5)}
                      >
                        {Math.round((snapshot()?.occlusion[i()]?.visible ?? 1) * 100)}%
                      </span>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Section>

          <Section index="2" title="亮度提取" note="阈值 0 ~ 2">
            <Slider
              label="阈值 threshold"
              value={threshold()}
              min={LIMITS.threshold.min}
              max={LIMITS.threshold.max}
              step={LIMITS.threshold.step}
              onInput={setThreshold}
              hint="亮度高于此值的像素才会成为辉光源"
            />
            <Slider
              label="软阈值宽度 knee"
              value={knee()}
              min={LIMITS.knee.min}
              max={LIMITS.knee.max}
              step={LIMITS.knee.step}
              onInput={setKnee}
              hint="阈值之上的平滑过渡带，0 为标准硬阈值"
            />
          </Section>

          <Section index="3" title="辉光分级" note="五级缓冲 · 1/2 → 1/32">
            <For each={levels()}>
              {(level, i) => (
                <div class="level-row" data-dirty="false">
                  <div class="level-head">
                    <span class="level-badge">{LEVEL_LABELS[i()]}</span>
                    <span class="level-scale">{LEVEL_SCALES[i()]}</span>
                    <span class="level-dims">{dimsFor(i())}</span>
                  </div>
                  <div class="level-grid">
                    <div class="mini-field">
                      <div class="field-head">
                        <label class="field-label" for={`radius-${i()}`}>半径</label>
                        <span class="field-value">{level.radius.toFixed(2)}</span>
                      </div>
                      <input
                        id={`radius-${i()}`}
                        type="range"
                        min={LIMITS.radius.min}
                        max={LIMITS.radius.max}
                        step={LIMITS.radius.step}
                        value={level.radius}
                        style={{ '--fill': `${(level.radius / LIMITS.radius.max) * 100}%` }}
                        onInput={(e) => updateLevel(i(), { radius: Number(e.currentTarget.value) })}
                      />
                    </div>
                    <div class="mini-field">
                      <div class="field-head">
                        <label class="field-label" for={`weight-${i()}`}>权重</label>
                        <span class="field-value">{level.weight.toFixed(2)}</span>
                      </div>
                      <input
                        id={`weight-${i()}`}
                        type="range"
                        min={LIMITS.weight.min}
                        max={LIMITS.weight.max}
                        step={LIMITS.weight.step}
                        value={level.weight}
                        style={{ '--fill': `${(level.weight / LIMITS.weight.max) * 100}%` }}
                        onInput={(e) => updateLevel(i(), { weight: Number(e.currentTarget.value) })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </For>
          </Section>

          <Section index="4" title="遮挡联动" note="按可见比例衰减">
            <ToggleRow
              title="启用遮挡衰减"
              description="被挡住的部分不产生满额辉光"
              checked={occlusionEnabled()}
              onChange={setOcclusionEnabled}
            />
            <Slider
              label="遮挡强度"
              value={occlusionStrength()}
              min={LIMITS.occlusionStrength.min}
              max={LIMITS.occlusionStrength.max}
              step={LIMITS.occlusionStrength.step}
              onInput={setOcclusionStrength}
              hint="1 = 完全按可见比例；0 = 关闭联动"
              disabled={!occlusionEnabled()}
            />
          </Section>

          <Section index="5" title="合成" note="ACES">
            <Slider
              label="辉光强度"
              value={intensity()}
              min={LIMITS.intensity.min}
              max={LIMITS.intensity.max}
              step={LIMITS.intensity.step}
              onInput={setIntensity}
            />
            <Slider
              label="曝光"
              value={exposure()}
              min={LIMITS.exposure.min}
              max={LIMITS.exposure.max}
              step={LIMITS.exposure.step}
              onInput={setExposure}
            />
          </Section>

          <Section index="6" title="导出" note="PNG + JSON">
            <div class="export-actions">
              <button
                type="button"
                class="btn btn-primary"
                onClick={doExport}
                disabled={exporting() || !ready()}
              >
                {exporting() ? '正在导出…' : '导出 PNG 与参数 JSON'}
              </button>
              <div class="btn-row">
                <button
                  type="button"
                  class="btn"
                  onClick={() => {
                    setLevels(createDefaultLevels());
                    setThreshold(0.5);
                    setKnee(0.55);
                    setIntensity(1.25);
                    setExposure(1.0);
                    setOcclusionEnabled(true);
                    setOcclusionStrength(1);
                  }}
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  class="btn"
                  onClick={() => setObjectsEnabled(EMISSIVE_SPECS.map(() => true))}
                >
                  全部开启
                </button>
              </div>
            </div>
            <Show when={exportMsg()}>
              <div class={`export-note ${exportMsg()!.kind === 'ok' ? 'ok' : 'err'}`}>
                {exportMsg()!.text}
              </div>
            </Show>
          </Section>
        </div>

        <div class="panel-foot">
          <span>
            {snapshot()
              ? `${snapshot()!.width}×${snapshot()!.height} · ${snapshot()!.stats.targets} RT · ${snapshot()!.stats.passes} pass`
              : '初始化中'}
          </span>
          <span>{LEVEL_COUNT} 级 · HDR half-float</span>
        </div>
      </aside>
    </div>
  );
}
