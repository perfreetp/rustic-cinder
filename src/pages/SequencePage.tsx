import { Component, createEffect, createSignal, on, Show } from "solid-js";
import {
  addSequence,
  currentSequence,
  state,
  updateSequence,
} from "../store";
import { gcContent, validateSequence } from "../dna";

const LONG_DEMO =
  "ATGCGTACGTTAGCCGGATCGATCGTACGATCGTAGCTAGCATCGATGCTAGCTAGCGGCTA" +
  "GCATGATCGATGCTAGCGGCTAGCATCGATCGTACGATCGTAGCATCGGATCGATCGTACGA" +
  "TCGTAGCTAGCATCGATGCTAGCTAGCGGCTAGCATGATCGATGCTAGCGGCTAGCATCGAT" +
  "CGTACGATCGTAGCATCGGATCGATCGTACGATCGTAGCTAGCATCGATGCTAGCTAGCGGC";

const SequencePage: Component = () => {
  const [text, setText] = createSignal(currentSequence()?.sequence ?? "");
  const [name, setName] = createSignal(currentSequence()?.name ?? "");
  const [message, setMessage] = createSignal("");

  // 切换序列时同步编辑框
  createEffect(
    on(
      () => state.currentId,
      () => {
        const cur = currentSequence();
        setText(cur?.sequence ?? "");
        setName(cur?.name ?? "");
        setMessage("");
      },
    ),
  );

  const result = () => validateSequence(text());
  const gc = () => gcContent(result().validPart);

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(""), 2500);
  };

  const applyToCurrent = () => {
    if (!result().valid) return;
    updateSequence(state.currentId, {
      name: name().trim() || "未命名序列",
      sequence: result().cleaned,
    });
    flash("已应用到当前序列");
  };

  const saveAsNew = () => {
    if (!result().valid) return;
    addSequence(name().trim() || "新序列", result().cleaned);
    flash("已保存为新序列并切换");
  };

  const randomSeq = () => {
    const len = 60 + Math.floor(Math.random() * 60);
    const bases = "ATGC";
    let s = "";
    for (let i = 0; i < len; i++) s += bases[Math.floor(Math.random() * 4)];
    setText(s);
  };

  return (
    <div class="page panel-page">
      <h2>序列输入</h2>
      <div class="field">
        <label>序列名称</label>
        <input
          type="text"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="给这条序列起个名字"
        />
      </div>
      <div class="field">
        <label>碱基序列(仅 A / T / G / C,支持换行与空格)</label>
        <textarea
          rows={8}
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          placeholder="例如:ATGCGTACGTTAGC..."
          spellcheck={false}
        />
      </div>

      <div class="stats-row">
        <div class="stat">
          <span class="stat-value">{result().validPart.length}</span>
          <span class="stat-label">序列长度 (bp)</span>
        </div>
        <div class="stat">
          <span class="stat-value">{gc().toFixed(1)}%</span>
          <span class="stat-label">GC 含量</span>
        </div>
        <div class="stat">
          <span class="stat-value">{result().invalidChars.length}</span>
          <span class="stat-label">非法字符种类</span>
        </div>
      </div>

      <Show when={result().invalidChars.length > 0}>
        <p class="error">
          包含非法字符:{result().invalidChars.join("、")}
          (仅允许 A、T、G、C)
        </p>
      </Show>
      <Show when={result().cleaned.length === 0}>
        <p class="hint">请输入至少一个碱基。</p>
      </Show>
      <Show when={message()}>
        <p class="ok">{message()}</p>
      </Show>

      <div class="btn-row">
        <button class="primary" disabled={!result().valid} onClick={applyToCurrent}>
          应用到当前序列
        </button>
        <button disabled={!result().valid} onClick={saveAsNew}>
          保存为新序列
        </button>
        <button onClick={randomSeq}>生成随机序列</button>
        <button onClick={() => setText(LONG_DEMO)}>
          载入 240bp 长链示例
        </button>
      </div>
      <p class="hint">
        提示:长链示例用于验证 200+ 碱基时的渲染流畅度;序列与参数会自动保存到浏览器本地。
      </p>
    </div>
  );
};

export default SequencePage;
