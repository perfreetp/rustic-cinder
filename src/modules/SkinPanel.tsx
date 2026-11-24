import { setFlags, setParams, useAppState } from '../store';
import { RAMP_STOPS } from '../geometry/colorRamp';
import { Slider } from '../components/Slider';

export function SkinPanel() {
  const params = useAppState((s) => s.params);
  const showTension = useAppState((s) => s.showTension);
  const wireframe = useAppState((s) => s.wireframe);

  const gradient = RAMP_STOPS.map((s) => `${s.css} ${s.at * 100}%`).join(', ');

  return (
    <div className="panel-stack">
      <section className="card">
        <h3>三层半透明膜面</h3>
        <p className="card-desc">
          外膜、翼肋、内膜按 renderOrder 由远及近混合，深度写入关闭以保证前后遮挡正确。
        </p>
        <Slider
          label="外膜不透明度（上翼面）"
          value={params.outerOpacity}
          min={0.05}
          max={1}
          step={0.01}
          accent="#66d0ff"
          onChange={(v) => setParams({ outerOpacity: v })}
        />
        <Slider
          label="内膜不透明度（气囊层）"
          value={params.innerOpacity}
          min={0.05}
          max={1}
          step={0.01}
          accent="#7f9cf5"
          onChange={(v) => setParams({ innerOpacity: v })}
        />
        <Slider
          label="翼肋膜不透明度"
          value={params.ribOpacity}
          min={0.05}
          max={1}
          step={0.01}
          accent="#a78bfa"
          onChange={(v) => setParams({ ribOpacity: v })}
        />
      </section>

      <section className="card">
        <h3>骨架与显示模式</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={params.showFrame}
            onChange={(e) => setParams({ showFrame: e.target.checked })}
          />
          显示前缘管 / 翼尖管骨架
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={wireframe}
            onChange={(e) => setFlags({ wireframe: e.target.checked })}
          />
          线框模式（查看 24×12 网格）
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={showTension}
            onChange={(e) => setFlags({ showTension: e.target.checked })}
          />
          张力染色叠加
        </label>
      </section>

      <section className="card">
        <h3>张力染色色带</h3>
        <p className="card-desc">
          张力由顶点邻域的展向 / 弦向曲率估算，峰值平滑归一化后映射到五段色带。
        </p>
        <div className="ramp" style={{ background: `linear-gradient(90deg, ${gradient})` }} />
        <div className="ramp-labels">
          <span>低张力</span>
          <span>高张力</span>
        </div>
        <Slider
          label="张力增益"
          value={params.tensionGain}
          min={0.3}
          max={2.5}
          step={0.05}
          accent="#ff8f5c"
          onChange={(v) => setParams({ tensionGain: v })}
        />
      </section>
    </div>
  );
}
