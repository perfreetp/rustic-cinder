import { appStore, useAppState } from '../core/store';
import type { LightingConfig } from '../core/types';
import { Section, Slider, Toggle } from './controls';

export function LightingPage() {
  const lighting = useAppState((s) => s.config.lighting);
  const patch = (p: Partial<LightingConfig>) => appStore.updateConfig({ lighting: { ...lighting, ...p } }, false);

  return (
    <div className="page">
      <Section title="光照模式">
        <div className="mode-switch">
          <button
            type="button"
            className={`mode-btn ${lighting.mode === 'side' ? 'mode-btn-active' : ''}`}
            onClick={() => patch({ mode: 'side' })}
          >
            <span className="mode-icon">◐</span>
            <strong>侧光</strong>
            <em>外部方向光，观察篾片油亮高光与编织浮雕</em>
          </button>
          <button
            type="button"
            className={`mode-btn ${lighting.mode === 'back' ? 'mode-btn-active' : ''}`}
            onClick={() => patch({ mode: 'back' })}
          >
            <span className="mode-icon">◑</span>
            <strong>背光</strong>
            <em>内部点光源，观察篾条背面透光与缝隙光</em>
          </button>
        </div>
      </Section>

      <Section title={lighting.mode === 'side' ? '侧光参数' : '背光参数'}>
        {lighting.mode === 'side' ? (
          <>
            <Slider
              label="侧光方位角"
              unit="°"
              value={lighting.sideAngle}
              min={0}
              max={360}
              step={1}
              onChange={(v) => patch({ sideAngle: v })}
            />
            <Slider
              label="侧光强度"
              value={lighting.sideIntensity}
              min={0}
              max={4}
              step={0.05}
              onChange={(v) => patch({ sideIntensity: v })}
            />
          </>
        ) : (
          <Slider
            label="内部背光强度"
            value={lighting.backIntensity}
            min={0}
            max={6}
            step={0.05}
            onChange={(v) => patch({ backIntensity: v })}
            hint="光源位于灯罩中心，模拟灯泡"
          />
        )}
        <Slider
          label="环境光"
          value={lighting.ambient}
          min={0}
          max={1.5}
          step={0.02}
          onChange={(v) => patch({ ambient: v })}
        />
      </Section>

      <Section title="竹篾材质">
        <label className="field">
          <span className="field-label">篾条基色</span>
          <span className="field-row">
            <input
              type="color"
              className="color-input"
              value={lighting.color}
              onChange={(e) => patch({ color: e.target.value })}
            />
            <span className="field-value">{lighting.color}</span>
          </span>
        </label>
        <Slider
          label="油亮程度（clearcoat）"
          value={lighting.gloss}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => patch({ gloss: v })}
          hint="竹篾上油后的清漆高光"
        />
        <Slider
          label="不透明度"
          value={lighting.opacity}
          min={0.35}
          max={1}
          step={0.01}
          onChange={(v) => patch({ opacity: v })}
          hint="调低可观察内外层半透明叠加顺序"
        />
      </Section>

      <Section title="辅助显示">
        <Toggle
          label="显示参考回转曲面"
          checked={lighting.showSurface}
          onChange={(v) => patch({ showSurface: v })}
        />
        <Toggle
          label="显示母线"
          checked={lighting.showProfile}
          onChange={(v) => patch({ showProfile: v })}
        />
        <p className="panel-note">
          渲染顺序固定为「内层篾条 → 外层篾条」，外层开启深度写入承担正确遮挡；
          内层关闭深度写入并按 renderOrder 先绘制，半透明叠加在背光下可清楚看到背面篾纹。
        </p>
      </Section>
    </div>
  );
}
