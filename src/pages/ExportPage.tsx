import { Component, createEffect, createSignal, For } from "solid-js";
import {
  currentSequence,
  removeSequence,
  setState,
  state,
} from "../store";
import { computeLayout, gcContent } from "../dna";
import { useHelixScene } from "../scene/useHelixScene";

const ExportPage: Component = () => {
  let canvas!: HTMLCanvasElement;
  const { helix, engineName } = useHelixScene(() => canvas);

  const [axial, setAxial] = createSignal(false);
  const [cut, setCut] = createSignal(100);
  const [exporting, setExporting] = createSignal(false);
  const [message, setMessage] = createSignal("");

  const seq = () => currentSequence()?.sequence ?? "";
  const params = () => currentSequence()?.params ?? { pitch: 3.4, basesPerTurn: 10.5 };

  createEffect(() => {
    const h = helix();
    if (!h) return;
    h.setLayout(computeLayout(seq(), params().pitch, params().basesPerTurn));
  });

  createEffect(() => {
    helix()?.setAxialView(axial(), cut() / 100);
  });

  const exportGLB = async () => {
    const h = helix();
    if (!h || exporting()) return;
    setExporting(true);
    setMessage("");
    try {
      const { GLTF2Export } = await import("@babylonjs/serializers/glTF/2.0");
      const name = (currentSequence()?.name || "dna-helix").replace(
        /[\\/:*?"<>|]/g,
        "_",
      );
      const glb = await GLTF2Export.GLBAsync(h.scene, name);
      glb.downloadFiles();
      setMessage("GLB 文件已开始下载");
    } catch (err) {
      console.error(err);
      setMessage("导出失败:" + String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div class="page viewer-page">
      <div class="canvas-wrap">
        <canvas ref={canvas} />
        <div class="engine-badge">渲染引擎:{engineName()}</div>
      </div>
      <aside class="side-panel">
        <h2>导出</h2>
        <div class="info-grid">
          <div>当前碱基对总数</div>
          <div>{seq().length}</div>
          <div>GC 含量</div>
          <div>{gcContent(seq()).toFixed(1)}%</div>
          <div>螺距</div>
          <div>{params().pitch.toFixed(2)} nm</div>
          <div>每圈碱基数</div>
          <div>{params().basesPerTurn.toFixed(1)}</div>
          <div>螺旋总高</div>
          <div>{((seq().length * params().pitch) / params().basesPerTurn).toFixed(1)} nm</div>
        </div>

        <button class="primary" disabled={exporting()} onClick={exportGLB}>
          {exporting() ? "正在导出…" : "导出为 GLB 文件"}
        </button>
        {message() && <p class="ok">{message()}</p>}

        <h3>轴向剖面(查看碱基堆叠)</h3>
        <label class="check">
          <input
            type="checkbox"
            checked={axial()}
            onChange={(e) => setAxial(e.currentTarget.checked)}
          />
          开启轴向剖面视图
        </label>
        <div class="field">
          <label>剖面位置:{cut()}%</label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={cut()}
            disabled={!axial()}
            onInput={(e) => setCut(Number(e.currentTarget.value))}
          />
        </div>

        <h3>本地序列库(自动保存在浏览器)</h3>
        <ul class="seq-list">
          <For each={state.sequences}>
            {(s) => (
              <li class={s.id === state.currentId ? "current" : ""}>
                <button
                  class="link"
                  onClick={() => setState("currentId", s.id)}
                  title="切换到该序列"
                >
                  {s.name}
                </button>
                <span class="seq-meta">{s.sequence.length} bp</span>
                <button
                  class="danger"
                  disabled={state.sequences.length <= 1}
                  onClick={() => removeSequence(s.id)}
                >
                  删除
                </button>
              </li>
            )}
          </For>
        </ul>
        <p class="hint">在“序列输入”页可以添加新序列;所有数据仅保存在本机浏览器。</p>
      </aside>
    </div>
  );
};

export default ExportPage;
