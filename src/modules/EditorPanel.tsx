import { setParams, setTwistStation, useAppState } from '../store';
import { Slider } from '../components/Slider';

const STATION_LABELS = ['根部', '1/4 展向', '半展向', '3/4 展向', '翼尖'];

export function EditorPanel() {
  const params = useAppState((s) => s.params);

  return (
    <div className="panel-stack">
      <section className="card">
        <h3>翼型拱度（Camber）</h3>
        <Slider
          label="根部最大拱度"
          value={params.rootCamber}
          min={0.01}
          max={0.14}
          step={0.005}
          hint="占弦长比例，越大伞翼越兜风"
          onChange={(v) => setParams({ rootCamber: v })}
        />
        <Slider
          label="翼尖拱度比"
          value={params.tipCamberRatio}
          min={0.2}
          max={1}
          step={0.01}
          hint="翼尖拱度 / 根部拱度"
          onChange={(v) => setParams({ tipCamberRatio: v })}
        />
        <Slider
          label="最大拱度位置"
          value={params.camberPos}
          min={0.2}
          max={0.7}
          step={0.01}
          onChange={(v) => setParams({ camberPos: v })}
        />
        <Slider
          label="翼型相对厚度"
          value={params.thickness}
          min={0.06}
          max={0.22}
          step={0.005}
          onChange={(v) => setParams({ thickness: v })}
        />
      </section>

      <section className="card">
        <h3>展向扭转分布（洗出，度）</h3>
        {params.twistStations.map((val, i) => (
          <Slider
            key={i}
            label={STATION_LABELS[i]}
            value={val}
            min={-4}
            max={22}
            step={0.5}
            unit="°"
            accent="#ffb347"
            onChange={(v) => setTwistStation(i, v)}
          />
        ))}
      </section>

      <section className="card">
        <h3>几何与载荷灵敏度</h3>
        <Slider
          label="展长"
          value={params.span}
          min={6}
          max={20}
          step={0.5}
          unit=" m"
          onChange={(v) => setParams({ span: v })}
        />
        <Slider
          label="根弦长"
          value={params.rootChord}
          min={1.5}
          max={4.5}
          step={0.1}
          unit=" m"
          onChange={(v) => setParams({ rootChord: v })}
        />
        <Slider
          label="尖弦比"
          value={params.tipChordRatio}
          min={0.4}
          max={1}
          step={0.01}
          onChange={(v) => setParams({ tipChordRatio: v })}
        />
        <Slider
          label="基准展向曲率"
          value={params.baseCurvature}
          min={0.08}
          max={0.3}
          step={0.005}
          hint="决定无载荷下的伞翼拱形"
          onChange={(v) => setParams({ baseCurvature: v })}
        />
        <Slider
          label="载荷→拱度增益"
          value={params.camberLoadGain}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => setParams({ camberLoadGain: v })}
        />
        <Slider
          label="载荷→扭转增益"
          value={params.twistLoadGain}
          min={0}
          max={30}
          step={0.5}
          onChange={(v) => setParams({ twistLoadGain: v })}
        />
        <Slider
          label="载荷→拱形收紧"
          value={params.arcLoadGain}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => setParams({ arcLoadGain: v })}
        />
      </section>
    </div>
  );
}
