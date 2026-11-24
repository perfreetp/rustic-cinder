import { LIMITS } from '../core/defaults';
import { appStore, useAppState } from '../core/store';
import type { WeaveConfig } from '../core/types';
import { ActionButton, NumberInput, Section, Slider, Toggle } from './controls';

export function WeavePage() {
  const weave = useAppState((s) => s.config.weave);
  const quality = useAppState((s) => s.config.quality);
  const stats = useAppState((s) => s.stats);

  const patch = (p: Partial<WeaveConfig>, lowQuality = true) =>
    appStore.updateConfig({ weave: { ...weave, ...p } }, lowQuality);

  const totalStrips = weave.familyCount * 2;
  const overBudget = totalStrips > 2000;

  return (
    <div className="page">
      <Section title="篾条截面规格">
        <Slider
          label="篾条宽度"
          unit="mm"
          value={weave.stripWidth}
          min={LIMITS.stripWidth.min}
          max={LIMITS.stripWidth.max}
          step={LIMITS.stripWidth.step}
          onChange={(v) => patch({ stripWidth: v })}
          onCommit={() => appStore.flushFullQuality()}
          hint="规范范围 2–8 mm"
        />
        <Slider
          label="篾条厚度"
          unit="mm"
          value={weave.stripThickness}
          min={LIMITS.stripThickness.min}
          max={LIMITS.stripThickness.max}
          step={LIMITS.stripThickness.step}
          onChange={(v) => patch({ stripThickness: v })}
          onCommit={() => appStore.flushFullQuality()}
          hint="规范范围 1–3 mm"
        />
        <Slider
          label="交叉安全间隙"
          unit="mm"
          value={weave.clearance}
          min={LIMITS.clearance.min}
          max={LIMITS.clearance.max}
          step={LIMITS.clearance.step}
          onChange={(v) => patch({ clearance: v })}
          onCommit={() => appStore.flushFullQuality()}
          hint="浮沉交叉处的法向净距，0 即厚度恰好贴合"
        />
      </Section>

      <Section title="编织排布">
        <Slider
          label="每族篾条根数"
          value={weave.familyCount}
          min={LIMITS.familyCount.min}
          max={LIMITS.familyCount.max}
          step={LIMITS.familyCount.step}
          onChange={(v) => patch({ familyCount: Math.round(v) })}
          onCommit={() => appStore.flushFullQuality()}
          hint={`两族共 ${totalStrips} 根`}
        />
        {overBudget ? (
          <div className="warn-banner">当前总数 {totalStrips} 根，超过 2000 根设计目标，可能影响流畅度。</div>
        ) : stats && stats.coverage > 100 ? (
          <div className="warn-banner">
            篾条已相互重叠（覆盖率 {stats.coverage.toFixed(0)}%）。要保持可见编织缝隙，请减少每族根数或减小篾宽。
          </div>
        ) : (
          <div className="info-banner">
            当前总数 {totalStrips} 根（设计上限 2000）· 等效 {stats?.effectiveTurns.toFixed(2) ?? '—'} 圈缠绕
            {stats ? ` · 实际螺旋角 ${stats.effectiveHelixAngle.toFixed(1)}°` : ''}
          </div>
        )}
        {stats ? (
          <div className="coverage-row">
            <div className="coverage-item">
              <span className="coverage-num">{stats.coverage.toFixed(0)}%</span>
              <span className="coverage-label">单族覆盖率{stats.coverage > 100 ? '（重叠）' : ''}</span>
            </div>
            <div className="coverage-item">
              <span className="coverage-num">{stats.stripSpacing.toFixed(2)} mm</span>
              <span className="coverage-label">相邻篾条间距</span>
            </div>
            <div className="coverage-item">
              <span className={`coverage-num ${stats.coverage > 100 ? 'num-warn' : ''}`}>
                {Math.max(0, stats.stripSpacing - weave.stripWidth).toFixed(2)} mm
              </span>
              <span className="coverage-label">{stats.coverage > 100 ? '已无缝/重叠' : '透光缝隙'}</span>
            </div>
          </div>
        ) : null}
        <Slider
          label="螺旋角 β"
          unit="°"
          value={weave.helixAngle}
          min={LIMITS.helixAngle.min}
          max={LIMITS.helixAngle.max}
          step={LIMITS.helixAngle.step}
          onChange={(v) => patch({ helixAngle: v })}
          onCommit={() => appStore.flushFullQuality()}
          hint="篾条与水平圆周方向的夹角"
        />
        <Slider
          label="覆盖间隙系数"
          value={weave.spacingFactor}
          min={LIMITS.spacingFactor.min}
          max={LIMITS.spacingFactor.max}
          step={LIMITS.spacingFactor.step}
          disabled={weave.turns > 0}
          onChange={(v) => patch({ spacingFactor: v })}
          onCommit={() => appStore.flushFullQuality()}
          hint="1 = 按螺旋角紧密排布，>1 加大螺距留缝（固定圈数时失效）"
        />
        <NumberInput
          label="固定缠绕圈数（0 = 自动）"
          value={weave.turns}
          min={0}
          max={12}
          step={0.25}
          onChange={(v) => patch({ turns: Math.max(0, v) }, false)}
        />
      </Section>

      <Section title="渲染精度">
        <Slider
          label="每根篾条采样段数"
          value={quality.segments}
          min={LIMITS.segments.min}
          max={LIMITS.segments.max}
          step={LIMITS.segments.step}
          onChange={(v) => appStore.updateConfig({ quality: { segments: Math.round(v) } }, true)}
          onCommit={() => appStore.flushFullQuality()}
          hint="拖拽时自动降为 45% LOD 保证联动流畅"
        />
        <Toggle
          label="平纹编织（一上一下棋盘浮沉）"
          checked={weave.pattern === 'plain'}
          onChange={() => patch({ pattern: 'plain' }, false)}
        />
        <div className="btn-row">
          <ActionButton variant="primary" onClick={() => appStore.flushFullQuality()}>
            立即全量重建
          </ActionButton>
        </div>
      </Section>
    </div>
  );
}
