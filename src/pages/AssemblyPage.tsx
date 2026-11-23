import { Component, createEffect, createSignal } from "solid-js";
import { currentSequence, PITCH_MAX, PITCH_MIN, updateParams } from "../store";
import { computeLayout } from "../dna";
import { useHelixScene } from "../scene/useHelixScene";

const AssemblyPage: Component = () => {
  let canvas!: HTMLCanvasElement;
  const { helix, engineName } = useHelixScene(() => canvas);
  const [autoRotate, setAutoRotate] = createSignal(true);

  const seq = () => currentSequence()?.sequence ?? "";
  const params = () => currentSequence()?.params ?? { pitch: 3.4, basesPerTurn: 10.5 };

  // 序列或任一参数变化 → 重算布局并重建场景(骨架与碱基对联动)
  createEffect(() => {
    const h = helix();
    if (!h) return;
    h.setLayout(computeLayout(seq(), params().pitch, params().basesPerTurn));
  });

  createEffect(() => {
    helix()?.setAutoRotate(autoRotate());
  });

  const rise = () => (params().pitch / params().basesPerTurn).toFixed(3);
  const turns = () => (seq().length / params().basesPerTurn).toFixed(1);

  return (
    <div class="page viewer-page">
      <div class="canvas-wrap">
        <canvas ref={canvas} />
        <div class="legend">
          <span><i style="background:#4db859" />A 腺嘌呤</span>
          <span><i style="background:#e54040" />T 胸腺嘧啶</span>
          <span><i style="background:#fabf1a" />G 鸟嘌呤</span>
          <span><i style="background:#338ceb" />C 胞嘧啶</span>
        </div>
        <div class="engine-badge">渲染引擎:{engineName()}</div>
      </div>
      <aside class="side-panel">
        <h2>螺旋装配</h2>
        <div class="field">
          <label>
            螺距:{params().pitch.toFixed(2)} nm(范围 {PITCH_MIN.toFixed(1)} -{" "}
            {PITCH_MAX.toFixed(1)})
          </label>
          <input
            type="range"
            min={PITCH_MIN}
            max={PITCH_MAX}
            step={0.02}
            value={params().pitch}
            onInput={(e) =>
              updateParams(currentSequence().id, {
                pitch: Number(e.currentTarget.value),
              })
            }
          />
        </div>
        <div class="field">
          <label>每圈碱基数:{params().basesPerTurn.toFixed(1)}</label>
          <input
            type="range"
            min={8}
            max={14}
            step={0.1}
            value={params().basesPerTurn}
            onInput={(e) =>
              updateParams(currentSequence().id, {
                basesPerTurn: Number(e.currentTarget.value),
              })
            }
          />
        </div>
        <label class="check">
          <input
            type="checkbox"
            checked={autoRotate()}
            onChange={(e) => setAutoRotate(e.currentTarget.checked)}
          />
          自动旋转(可拖拽旋转、滚轮缩放)
        </label>
        <div class="info-grid">
          <div>碱基对数</div>
          <div>{seq().length}</div>
          <div>每碱基上升</div>
          <div>{rise()} nm</div>
          <div>螺旋总高</div>
          <div>{(seq().length * Number(rise())).toFixed(1)} nm</div>
          <div>总圈数</div>
          <div>{turns()}</div>
        </div>
        <p class="hint">
          修改螺距或每圈碱基数时,整条链的骨架与碱基对位置会立即联动重算。
        </p>
      </aside>
    </div>
  );
};

export default AssemblyPage;
