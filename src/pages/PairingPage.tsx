import { Component, createEffect, createSignal, Show } from "solid-js";
import { currentSequence } from "../store";
import { COMPLEMENT, computeLayout, type Base } from "../dna";
import { useHelixScene } from "../scene/useHelixScene";

const PairingPage: Component = () => {
  let canvas!: HTMLCanvasElement;
  const { helix, engineName } = useHelixScene(() => canvas);

  const [pairIndex, setPairIndex] = createSignal(0);
  const [showBackbone, setShowBackbone] = createSignal(true);
  const [showBases, setShowBases] = createSignal(true);
  const [showAllBonds, setShowAllBonds] = createSignal(false);

  const seq = () => currentSequence()?.sequence ?? "";
  const params = () => currentSequence()?.params ?? { pitch: 3.4, basesPerTurn: 10.5 };
  const count = () => seq().length;
  const clampedIndex = () => Math.min(pairIndex(), Math.max(0, count() - 1));

  createEffect(() => {
    const h = helix();
    if (!h) return;
    h.setLayout(computeLayout(seq(), params().pitch, params().basesPerTurn));
  });

  createEffect(() => {
    helix()?.setOptions({
      showBackbone: showBackbone(),
      showBases: showBases(),
      showAllBonds: showAllBonds(),
      highlightPair: clampedIndex(),
    });
  });

  const baseA = () => (seq()[clampedIndex()] ?? "A") as Base;
  const baseB = () => COMPLEMENT[baseA()];
  const bonds = () => (baseA() === "A" || baseA() === "T" ? 2 : 3);

  return (
    <div class="page viewer-page">
      <div class="canvas-wrap">
        <canvas ref={canvas} />
        <div class="engine-badge">渲染引擎:{engineName()}</div>
      </div>
      <aside class="side-panel">
        <h2>配对查看</h2>
        <div class="field">
          <label>
            碱基对序号:{clampedIndex() + 1} / {count()}
          </label>
          <input
            type="range"
            min={1}
            max={Math.max(1, count())}
            step={1}
            value={clampedIndex() + 1}
            onInput={(e) => setPairIndex(Number(e.currentTarget.value) - 1)}
          />
        </div>
        <Show when={count() > 0}>
          <div class="pair-card">
            <span class="base-badge" style={{ background: "#1c2b1f", color: "#4db859" }}>
              {baseA()}
            </span>
            <span class="pair-bonds">{bonds() === 2 ? "=" : "≡"}</span>
            <span class="base-badge" style={{ background: "#2b1c1c", color: "#e54040" }}>
              {baseB()}
            </span>
            <div class="pair-info">
              第 {clampedIndex() + 1} 对:{baseA()} - {baseB()},{bonds()} 条氢键
            </div>
          </div>
        </Show>
        <label class="check">
          <input
            type="checkbox"
            checked={showBackbone()}
            onChange={(e) => setShowBackbone(e.currentTarget.checked)}
          />
          显示磷酸骨架
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={showBases()}
            onChange={(e) => setShowBases(e.currentTarget.checked)}
          />
          显示碱基平面
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={showAllBonds()}
            onChange={(e) => setShowAllBonds(e.currentTarget.checked)}
          />
          显示全部配对连线(氢键)
        </label>
        <p class="hint">
          选中的碱基对会提亮显示,其余变暗;浅色连线表示碱基间的氢键(A-T 两条,G-C 三条)。
        </p>
      </aside>
    </div>
  );
};

export default PairingPage;
