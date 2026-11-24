import { adoptStyles, adoptTokens, ReactiveElement, q, qa, escapeHtml } from './base';
import {
  buildExportPayload,
  downloadText,
  exportFilename,
  parseImportedDoc,
} from '../core/exporter';
import { SAMPLES } from '../core/samples';

/**
 * Top bar: document identity, undo/redo, playback and export.
 *
 * The transport here mirrors the timeline panel's transport, so the user can
 * play from either place; both write to the same studio state.
 */

const CSS = `
:host { display: block; background: var(--bg-1); border-bottom: 1px solid var(--line-1); }
.bar { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 14px; }
.brand { display: flex; align-items: center; gap: 9px; padding-right: 6px; }
.logo { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; background: linear-gradient(150deg,#f2e6d2, #d9c4a4); color: #6d3a1e; font-weight: 700; font-size: 13px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
.name { font-size: 13px; color: var(--ink-0); font-weight: 600; letter-spacing: .01em; white-space: nowrap; }
.name small { display: block; font-size: 9.5px; font-weight: 400; color: var(--ink-3); letter-spacing: .08em; text-transform: uppercase; }
.div { width: 1px; height: 22px; background: var(--line-1); }
.spacer { flex: 1; }
.title { background: transparent; border: 1px solid transparent; border-radius: var(--radius-s); padding: 3px 6px; font: inherit; font-size: 12.5px; color: var(--ink-0); max-width: 220px; }
.title:hover { border-color: var(--line-2); }
.title:focus { outline: none; border-color: var(--accent); background: var(--bg-0); }
.transport { display: flex; align-items: center; gap: 3px; }
.play { width: 32px; height: 30px; border-radius: var(--radius-s); background: var(--accent); color: #1a0f08; display: grid; place-items: center; font-size: 12px; }
.play:hover { background: var(--accent-hi); }
.tc { font-family: var(--font-num); font-size: 11.5px; color: var(--ink-1); padding: 0 8px; font-variant-numeric: tabular-nums; min-width: 92px; text-align: center; }
.side { display: flex; align-items: center; gap: 6px; }
.menu { position: relative; }
.pop { position: absolute; right: 0; top: calc(100% + 6px); min-width: 220px; padding: 7px; border-radius: var(--radius-m); background: var(--bg-2); border: 1px solid var(--line-2); box-shadow: var(--shadow-3); z-index: 40; display: flex; flex-direction: column; gap: 2px; }
.pop button { display: flex; align-items: center; justify-content: space-between; gap: 10px; text-align: left; padding: 7px 9px; border-radius: 4px; font-size: 12px; color: var(--ink-1); }
.pop button:hover { background: var(--bg-3); color: var(--ink-0); }
.pop .hr { height: 1px; background: var(--line-1); margin: 5px 2px; }
.pop .lbl { font-size: 10px; color: var(--ink-3); padding: 4px 9px 2px; text-transform: uppercase; letter-spacing: .05em; }
.toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); background: var(--bg-4); color: var(--ink-0); border: 1px solid var(--line-3); border-radius: 999px; padding: 8px 18px; font-size: 12px; box-shadow: var(--shadow-3); z-index: 90; }
.hidden { display: none; }

@media (max-width: 760px) {
  .bar { gap: 8px; height: 44px; padding: 0 10px; }
  .name small { display: none; }
  .name { font-size: 12px; white-space: nowrap; }
  .brand { gap: 7px; }
  .div { display: none; }
  .title { max-width: 120px; font-size: 12px; }
  .tc { min-width: 0; padding: 0 4px; font-size: 10.5px; }
  .side .btn { padding: 0 8px; }
}
@media (max-width: 520px) {
  .title { display: none; }
  .tc { display: none; }
}
`;

export class TopBar extends ReactiveElement {
  static readonly tagName = 'top-bar';

  private menuOpen = false;
  private samplesOpen = false;
  private toast: string | null = null;
  private toastTimer = 0;

  protected setup(): void {
    adoptTokens(this.root);
    adoptStyles(this.root, CSS);
    this.update();

    const unsubs = [
      this.studio.on('doc', () => this.update()),
      this.studio.on('play', () => this.update()),
      this.studio.on('time', () => this.paintTime()),
    ];
    this.onCleanup(() => unsubs.forEach((u) => u()));
    this.onCleanup(() => window.clearTimeout(this.toastTimer));

    document.addEventListener('click', this.onDocClick);
    this.onCleanup(() => document.removeEventListener('click', this.onDocClick));
  }

  private onDocClick = (e: MouseEvent): void => {
    if (!this.menuOpen && !this.samplesOpen) return;
    const path = e.composedPath();
    if (!path.some((n) => (n as HTMLElement).dataset?.menuRoot !== undefined)) {
      this.menuOpen = false;
      this.samplesOpen = false;
      this.update();
    }
  };

  protected view(): string {
    const doc = this.studio.doc;
    const playing = this.studio.playing;
    const canUndo = this.studio.store.canUndo;
    const canRedo = this.studio.store.canRedo;
    return `
      <div class="bar">
        <div class="brand">
          <div class="logo">折</div>
          <div class="name">折序 <small>origami sequence studio</small></div>
        </div>
        <div class="div"></div>
        <input class="title" value="${escapeHtml(doc.name)}" data-act="name" aria-label="序列名称" data-focus="name" />
        <div class="div"></div>
        <button class="btn icon ghost" data-act="undo" ${canUndo ? '' : 'disabled'} title="撤销 (Ctrl+Z)" aria-label="撤销">↶</button>
        <button class="btn icon ghost" data-act="redo" ${canRedo ? '' : 'disabled'} title="重做 (Ctrl+Shift+Z)" aria-label="重做">↷</button>
        <div class="spacer"></div>
        <div class="transport">
          <button class="btn icon ghost" data-act="start" title="起点" aria-label="回到起点">⏮</button>
          <button class="play" data-act="play" title="${playing ? '暂停' : '播放'}（空格）" aria-label="${playing ? '暂停' : '播放'}">${playing ? '❚❚' : '▶'}</button>
        </div>
        <span class="tc" data-tc>0.00 / 0.00s</span>
        <div class="spacer"></div>
        <div class="side">
          <div class="menu" data-menu-root>
            <button class="btn ghost" data-act="samples" aria-haspopup="menu" aria-expanded="${this.samplesOpen}" title="示例序列">示例 ▾</button>
            <div class="pop ${this.samplesOpen ? '' : 'hidden'}" style="min-width:250px">
              <div class="lbl">教学示例</div>
              ${SAMPLES.map((sm) => `<button data-act="load-sample" data-sample="${sm.id}">${escapeHtml(sm.name)}<span style="font-size:10.5px;color:var(--ink-3)">${escapeHtml(sm.blurb)}</span></button>`).join('')}
            </div>
          </div>
          <button class="btn ghost" data-act="import" title="导入序列文件">导入</button>
          <div class="menu" data-menu-root>
            <button class="btn primary" data-act="export" aria-haspopup="menu" aria-expanded="${this.menuOpen}">导出 ⤓</button>
            <div class="pop ${this.menuOpen ? '' : 'hidden'}">
              <div class="lbl">序列文件</div>
              <button data-act="export-json">导出完整序列（JSON）<span class="kbd">⌘E</span></button>
              <button data-act="export-baked">导出含采样帧（JSON，含逐帧角度）</button>
              <div class="hr"></div>
              <div class="lbl">说明</div>
              <button data-act="export-help">导出内容与格式…</button>
            </div>
          </div>
        </div>
      </div>
      <div class="toast ${this.toast ? '' : 'hidden'}" role="status">${this.toast ?? ''}</div>`;
  }

  protected override afterRender(): void {
    const root = this.root;
    this.paintTime();

    q<HTMLInputElement>(root, '[data-act="name"]')?.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value.trim() || '未命名折序';
      this.studio.store.setName(v);
    });

    q<HTMLButtonElement>(root, '[data-act="undo"]')?.addEventListener('click', () => this.studio.store.undo());
    q<HTMLButtonElement>(root, '[data-act="redo"]')?.addEventListener('click', () => this.studio.store.redo());
    q<HTMLButtonElement>(root, '[data-act="play"]')?.addEventListener('click', () => this.studio.togglePlay());
    q<HTMLButtonElement>(root, '[data-act="start"]')?.addEventListener('click', () => {
      this.studio.pause();
      this.studio.seek(0);
    });

    q<HTMLButtonElement>(root, '[data-act="export"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.menuOpen = !this.menuOpen;
      this.samplesOpen = false;
      this.update();
    });

    qa<HTMLButtonElement>(root, '[data-act="export-json"]').forEach((b) =>
      b.addEventListener('click', () => {
        this.menuOpen = false;
        this.update();
        this.doExport(false);
      }),
    );
    qa<HTMLButtonElement>(root, '[data-act="export-baked"]').forEach((b) =>
      b.addEventListener('click', () => {
        this.menuOpen = false;
        this.update();
        this.doExport(true);
      }),
    );
    qa<HTMLButtonElement>(root, '[data-act="export-help"]').forEach((b) =>
      b.addEventListener('click', () => {
        this.menuOpen = false;
        this.update();
        this.showToast('导出包含折痕、关键帧、时间轴、材质与构建信息（JSON）');
      }),
    );

    q<HTMLButtonElement>(root, '[data-act="import"]')?.addEventListener('click', () => this.doImport());

    q<HTMLButtonElement>(root, '[data-act="samples"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.samplesOpen = !this.samplesOpen;
      this.menuOpen = false;
      this.update();
    });
    qa<HTMLButtonElement>(root, '[data-act="load-sample"]').forEach((b) => {
      b.addEventListener('click', () => {
        const sample = SAMPLES.find((s) => s.id === b.dataset.sample);
        this.samplesOpen = false;
        this.update();
        if (!sample) return;
        this.studio.pause();
        this.studio.store.replace(sample.make(), 'replace');
        this.studio.select(null);
        this.studio.seek(0);
        this.showToast(`已载入示例「${sample.name}」`);
      });
    });
  }

  private paintTime(): void {
    const el = q<HTMLElement>(this.root, '[data-tc]');
    if (!el) return;
    const t = this.studio.time;
    const d = this.studio.doc.timeline.duration;
    el.textContent = `${t.toFixed(2)} / ${d.toFixed(2)}s`;
  }

  private doExport(baked: boolean): void {
    try {
      const payload = buildExportPayload(this.studio.doc, this.studio.topology, {
        includeSamples: baked,
        sampleHz: 60,
      });
      const text = JSON.stringify(payload, null, 2);
      downloadText(exportFilename(this.studio.doc), text);
      this.showToast(baked ? '已导出完整序列（含逐帧采样）' : '已导出序列文件');
    } catch (err) {
      this.showToast('导出失败：' + String(err));
    }
  }

  private doImport(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const doc = parseImportedDoc(text);
        this.studio.pause();
        this.studio.store.replace(doc, 'replace');
        this.studio.select(null);
        this.studio.seek(0);
        this.showToast(`已导入「${doc.name}」`);
      } catch (err) {
        this.showToast('导入失败：' + (err instanceof Error ? err.message : String(err)));
      }
    };
    input.click();
  }

  private showToast(msg: string): void {
    this.toast = msg;
    window.clearTimeout(this.toastTimer);
    this.update();
    this.toastTimer = window.setTimeout(() => {
      this.toast = null;
      this.update();
    }, 2600);
  }
}

export function registerTopBar(): void {
  if (!customElements.get(TopBar.tagName)) {
    customElements.define(TopBar.tagName, TopBar);
  }
}
