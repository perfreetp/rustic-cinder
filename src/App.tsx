import { Component, createEffect, createSignal, For, Show } from "solid-js";
import { currentSequence, saveState, setState, state } from "./store";
import SequencePage from "./pages/SequencePage";
import AssemblyPage from "./pages/AssemblyPage";
import PairingPage from "./pages/PairingPage";
import ExportPage from "./pages/ExportPage";

type PageId = "sequence" | "assembly" | "pairing" | "export";

const TABS: { id: PageId; label: string }[] = [
  { id: "sequence", label: "序列输入" },
  { id: "assembly", label: "螺旋装配" },
  { id: "pairing", label: "配对查看" },
  { id: "export", label: "导出" },
];

const App: Component = () => {
  const [page, setPage] = createSignal<PageId>("sequence");

  // 任何状态变化都自动保存到浏览器本地
  createEffect(() => saveState());

  const pairCount = () => currentSequence()?.sequence.length ?? 0;

  return (
    <div class="app">
      <header>
        <h1>DNA 双螺旋装配工具</h1>
        <nav>
          <For each={TABS}>
            {(t) => (
              <button
                class={page() === t.id ? "active" : ""}
                onClick={() => setPage(t.id)}
              >
                {t.label}
              </button>
            )}
          </For>
        </nav>
        <div class="seq-switch">
          <label for="seq-select">当前序列</label>
          <select
            id="seq-select"
            value={state.currentId}
            onChange={(e) => setState("currentId", e.currentTarget.value)}
          >
            <For each={state.sequences}>
              {(s) => (
                <option value={s.id}>
                  {s.name}({s.sequence.length} bp)
                </option>
              )}
            </For>
          </select>
          <span class="pair-count">碱基对总数:{pairCount()}</span>
        </div>
      </header>
      <main>
        <Show when={page() === "sequence"}>
          <SequencePage />
        </Show>
        <Show when={page() === "assembly"}>
          <AssemblyPage />
        </Show>
        <Show when={page() === "pairing"}>
          <PairingPage />
        </Show>
        <Show when={page() === "export"}>
          <ExportPage />
        </Show>
      </main>
    </div>
  );
};

export default App;
