import { adoptStyles, adoptTokens, ReactiveElement, q, qa, attrs } from './base';
import { MAX_CREASES, type Crease, type FoldType } from '../core/types';
import { clamp, dist2 } from '../core/math';

/**
 * Crease editor (module 1: 折痕建模).
 *
 * A flat top-down view of the sheet where creases are drawn directly:
 *  - drag on empty paper to lay a crease, release to commit it;
 *  - click a crease to select it, drag either endpoint to adjust;
 *  - mountain / valley is a mode, and the crease list on the right has per-
 *    crease type, angle and delete controls.
 *
 * The canvas draws the resolved fold overlay too: where a crease was extended
 * to reach the paper edge or another crease, the extension is shown as a dashed
 * "support" hint, so the user sees what the hinge tree actually built.
 */

const PAPER_MARGIN = 0.14;

const CSS = `
:host { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--bg-1); }
:host > [data-root] { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.head { display: flex; align-items: center; gap: var(--sp-3); padding: 10px 14px; border-bottom: 1px solid var(--line-1); }
.head h2 { margin: 0; font-size: 12.5px; font-weight: 600; letter-spacing: .02em; color: var(--ink-0); }
.head .count { font-family: var(--font-num); font-size: 11px; color: var(--ink-2); padding: 1px 6px; border-radius: 3px; background: var(--bg-3); }
.head .count.full { color: var(--warn); background: rgba(224,179,82,.12); }
.spacer { flex: 1; }
.body { flex: 1; display: grid; grid-template-rows: minmax(0, 1fr) minmax(0, 44%); min-height: 0; }
.canvas-slot { position: absolute; inset: 0; }
.stage { position: relative; min-width: 0; background: radial-gradient(120% 90% at 55% 35%, #1e222a 0%, #14161b 70%); }
canvas.flat { position: absolute; inset: 0; width: 100%; height: 100%; min-width: 0; display: block; cursor: crosshair; touch-action: none; }
.hint { position: absolute; left: 14px; bottom: 12px; font-size: 11px; color: var(--ink-3); pointer-events: none; line-height: 1.7; }
.hint kbd { margin-right: 3px; }
.toolbar { position: absolute; left: 14px; top: 12px; display: flex; align-items: center; gap: 8px; padding: 5px; border-radius: var(--radius-m); background: rgba(14,15,19,.78); border: 1px solid var(--line-2); backdrop-filter: blur(9px); }
.toolbar .dot { width: 8px; height: 8px; border-radius: 50%; }
.toolbar .dot.valley { background: var(--valley); }
.toolbar .dot.mountain { background: var(--mountain); }

.list { border-top: 1px solid var(--line-1); display: grid; grid-template-columns: minmax(0,1fr) 208px; grid-template-rows: auto minmax(0, 1fr); min-height: 0; overflow: hidden; background: var(--bg-1); }
.list .lhead { grid-column: 1; display: flex; align-items: center; gap: 8px; padding: 9px 12px 7px; font-size: 11px; color: var(--ink-2); letter-spacing: .04em; text-transform: uppercase; }
.list .items { overflow-y: auto; padding: 0 8px 10px; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.row { display: grid; grid-template-columns: 16px 1fr auto; align-items: center; gap: 8px; padding: 6px 7px; border-radius: var(--radius-s); cursor: pointer; border: 1px solid transparent; }
.row:hover { background: var(--bg-2); }
.row.sel { background: var(--bg-3); border-color: var(--line-3); }
.row .swatch { width: 12px; height: 12px; border-radius: 3px; display: grid; place-items: center; font-size: 9px; font-weight: 700; color: #10131a; }
.row .swatch.valley { background: var(--valley); }
.row .swatch.mountain { background: var(--mountain); }
.row .meta { min-width: 0; }
.row .id { font-family: var(--font-num); font-size: 11px; color: var(--ink-0); }
.row .sub { font-size: 10.5px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .tag { font-size: 9.5px; padding: 0 4px; border-radius: 3px; background: rgba(224,179,82,.14); color: var(--warn); margin-left: 4px; }
.row .angle { font-family: var(--font-num); font-size: 11px; color: var(--ink-2); }
.empty { padding: 26px 16px; text-align: center; color: var(--ink-3); font-size: 11.5px; line-height: 1.9; }
.empty .big { display: block; font-size: 22px; margin-bottom: 8px; opacity: .35; }

.inspector { grid-column: 2; grid-row: 1 / span 2; border-left: 1px solid var(--line-1); padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 7px; overflow-y: auto; min-height: 0; }
.list .items { grid-column: 1; grid-row: 2; min-height: 0; }
.inspector .title { font-size: 11px; color: var(--ink-2); letter-spacing: .04em; text-transform: uppercase; margin-bottom: 1px; }
.inspector .none { font-size: 11.5px; color: var(--ink-3); padding: 6px 0; }
.diag { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font-size: 10.5px; padding: 2px 7px; border-radius: 999px; background: var(--bg-3); color: var(--ink-2); font-family: var(--font-num); border: 1px solid var(--line-1); }
.chip.warn { color: var(--warn); border-color: rgba(224,179,82,.3); background: rgba(224,179,82,.10); }
.chip.ok { color: var(--ok); border-color: rgba(95,191,138,.28); background: rgba(95,191,138,.09); }
.chip.bad { color: var(--danger); border-color: rgba(224,106,106,.3); background: rgba(224,106,106,.10); }

@media (max-width: 760px) {
  .head { padding: 8px 10px; gap: 8px; }
  .head h2 { font-size: 12px; }
  .body { grid-template-rows: minmax(0, 1fr) minmax(0, 42%); }
  .list { grid-template-columns: minmax(0,1fr) 164px; }
  .hint { display: none; }
  .toolbar { left: 8px; top: 8px; }
}
`;

type DragMode =
  | { kind: 'none' }
  | { kind: 'draw'; from: { x: number; y: number }; to: { x: number; y: number }; type: FoldType }
  | { kind: 'handle'; creaseId: string; end: 'a' | 'b' }
  | { kind: 'move'; creaseId: string; grab: { x: number; y: number }; orig: { a: { x: number; y: number }; b: { x: number; y: number } } };

export class CreaseEditor extends ReactiveElement {
  static readonly tagName = 'crease-editor';

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private drag: DragMode = { kind: 'none' };
  private drawType: FoldType = 'valley';
  private hoverId: string | null = null;
  private sizeW = 1;
  private sizeH = 1;
  private dpr = 1;
  private ro: ResizeObserver | null = null;
  private rafDirty = true;
  private rafId = 0;

  protected setup(): void {
    adoptTokens(this.root);
    adoptStyles(this.root, CSS);
    this.update();

    const unsubs = [
      this.studio.on('doc', () => {
        this.rafDirty = true;
        this.update();
      }),
      this.studio.on('selection', () => {
        this.rafDirty = true;
        this.update();
      }),
      this.studio.on('topology', () => {
        this.rafDirty = true;
      }),
    ];
    this.onCleanup(() => unsubs.forEach((u) => u()));
    this.onCleanup(() => {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.ro?.disconnect();
    });

    const loop = () => {
      // ResizeObserver inside a shadow root can miss the initial layout, so
      // the canvas also verifies its own box each frame (a cheap rect read).
      this.checkSize();
      if (this.rafDirty && this.ctx && this.canvas) {
        this.rafDirty = false;
        this.paint();
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  protected view(): string {
    const doc = this.studio.doc;
    const topo = this.studio.topology;
    const n = doc.creases.length;
    const sel = this.studio.selectedCreaseId;
    const diag = this.studio.diagnostics;

    const rows = doc.creases
      .map((c) => {
        const resolved = topo.creases.find((r) => r.id === c.id);
        const adjusted = resolved?.adjusted ? '<span class="tag">已延伸</span>' : '';
        return `
          <div class="row ${c.id === sel ? 'sel' : ''}" data-crease="${attrs({ 'data-crease': c.id })}" data-act="select">
            <span class="swatch ${c.type}">${c.type === 'mountain' ? 'M' : 'V'}</span>
            <span class="meta">
              <span class="id">#${String(c.slot + 1).padStart(2, '0')}</span>${adjusted}
              <span class="sub">${c.type === 'mountain' ? '山折' : '谷折'} · ${fmtDegree(c.angle)}</span>
            </span>
            <span class="angle">${Math.round(c.angle)}°</span>
          </div>`;
      })
      .join('');

    const selected = doc.creases.find((c) => c.id === sel) ?? null;
    const inspector = selected
      ? this.inspectorHtml(selected)
      : `<div class="none">未选中折痕 — 点击画面或列表中的折痕进行编辑</div>`;

    const chips: string[] = [
      `<span class="chip">${diag.faces} 面</span>`,
      `<span class="chip">${diag.hinges} 铰链</span>`,
    ];
    if (diag.cycles > 0) chips.push(`<span class="chip warn">${diag.cycles} 循环折</span>`);
    if (diag.maekawa > 0) chips.push(`<span class="chip bad">${diag.maekawa} 顶点不闭合</span>`);
    if (diag.cycles === 0 && diag.maekawa === 0 && diag.faces > 1) {
      chips.push(`<span class="chip ok">可折叠</span>`);
    }

    return `
      <div class="head">
        <h2>折痕建模</h2>
        <span class="count ${n >= MAX_CREASES ? 'full' : ''}">${n} / ${MAX_CREASES}</span>
        <div class="spacer"></div>
        <div class="seg" role="group" aria-label="折痕类型">
          <button data-act="type" data-type="valley" aria-pressed="${this.drawType === 'valley'}">谷折 V</button>
          <button data-act="type" data-type="mountain" aria-pressed="${this.drawType === 'mountain'}">山折 M</button>
        </div>
        <button class="btn ghost" data-act="clear" ${n === 0 ? 'disabled' : ''}>清空</button>
      </div>
      <div class="body">
        <div class="stage">
          <div class="canvas-slot" data-slot="canvas"></div>
          <div class="toolbar">
            <span class="dot ${this.drawType}"></span>
            <span style="font-size:11px;color:var(--ink-2)">${this.drawType === 'valley' ? '绘制谷折' : '绘制山折'}</span>
          </div>
          <div class="hint">
            拖拽绘制折痕 · 端点可微调 · 未落边的折痕会自动延伸至支撑<br/>
            <kbd class="kbd">V</kbd>谷折 <kbd class="kbd">M</kbd>山折 <kbd class="kbd">Del</kbd>删除所选
          </div>
        </div>
        <div class="list">
          <div class="lhead">折叠列表</div>
          <div class="items" data-scroll="list">
            ${n === 0 ? `<div class="empty"><span class="big">◹</span>尚无线痕<br/>在左侧纸面上拖拽绘制</div>` : rows}
          </div>
          <div class="inspector">
            <div class="title">折痕参数</div>
            ${inspector}
            <div class="title" style="margin-top:6px">构型诊断</div>
            <div class="diag">${chips.join('')}</div>
            ${diag.cycleCreases.length ? `<div style="font-size:10.5px;color:var(--ink-3);margin-top:4px">循环折参与：${diag.cycleCreases.map((id) => `#${slotOf(doc.creases, id)}`).join(' ')}</div>` : ''}
          </div>
        </div>
      </div>`;
  }

  private inspectorHtml(c: Crease): string {
    return `
      <div class="field">
        <label>类型</label>
        <div class="seg grow">
          <button data-act="set-type" data-type="valley" aria-pressed="${c.type === 'valley'}">谷折</button>
          <button data-act="set-type" data-type="mountain" aria-pressed="${c.type === 'mountain'}">山折</button>
        </div>
        <button class="btn icon ghost danger" data-act="delete" title="删除折痕" aria-label="删除折痕">✕</button>
      </div>
      <div class="field">
        <label>静态角度</label>
        <input class="grow" type="range" min="0" max="180" step="1" value="${Math.round(c.angle)}"
          data-act="angle" data-focus="angle-${c.id}" />
        <span class="value">${Math.round(c.angle)}°</span>
      </div>`;
  }

  protected override afterRender(): void {
    // The canvas is created once and moved between renders; replacing it would
    // drop the 2D context and any pending paint.
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'flat';
      this.canvas.tabIndex = 0;
      this.ctx = this.canvas.getContext('2d')!;
      this.bindCanvas();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.canvas);
      this.resize();
      for (const delay of [0, 60, 200]) {
        window.setTimeout(() => this.resize(), delay);
      }
    }
    const slot = q<HTMLElement>(this.root, '[data-slot="canvas"]');
    if (slot && this.canvas.parentElement !== slot) slot.append(this.canvas);
    this.bindUi();
  }

  private bindUi(): void {
    const root = this.root;

    qa<HTMLButtonElement>(root, '[data-act="type"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.drawType = btn.dataset.type === 'mountain' ? 'mountain' : 'valley';
        this.update();
      });
    });

    qa<HTMLElement>(root, '[data-act="select"]').forEach((row) => {
      row.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const id = row.dataset.crease!;
        this.studio.select(id);
      });
    });

    qa<HTMLButtonElement>(root, '[data-act="set-type"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = this.studio.selectedCreaseId;
        if (!id) return;
        this.studio.store.updateCrease(id, { type: btn.dataset.type === 'mountain' ? 'mountain' : 'valley' });
      });
    });

    const del = q<HTMLButtonElement>(root, '[data-act="delete"]');
    del?.addEventListener('click', () => this.deleteSelected());

    const clear = q<HTMLButtonElement>(root, '[data-act="clear"]');
    clear?.addEventListener('click', () => {
      if (this.studio.doc.creases.length === 0) return;
      this.studio.store.clearCreases();
      this.studio.select(null);
    });

    const angle = q<HTMLInputElement>(root, '[data-act="angle"]');
    angle?.addEventListener('input', () => {
      const id = this.studio.selectedCreaseId;
      if (!id) return;
      this.studio.store.updateCrease(id, { angle: Number(angle.value) }, false);
      this.rafDirty = true;
    });
    angle?.addEventListener('change', () => {
      const id = this.studio.selectedCreaseId;
      if (!id) return;
      this.studio.store.updateCrease(id, { angle: Number(angle.value) }, true);
    });
  }

  private deleteSelected(): void {
    const id = this.studio.selectedCreaseId;
    if (!id) return;
    this.studio.store.removeCrease(id);
    this.studio.select(null);
  }

  // -- canvas --------------------------------------------------------------

  private checkSize(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    if (Math.abs(rect.width - this.sizeW) > 0.5 || Math.abs(rect.height - this.sizeH) > 0.5) {
      this.resize();
      this.rafDirty = true;
    }
  }

  private resize(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.sizeW = Math.max(1, rect.width);
    this.sizeH = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.sizeW * this.dpr);
    this.canvas.height = Math.round(this.sizeH * this.dpr);
    this.rafDirty = true;
  }

  /** Sheet-space → canvas pixel transform. */
  private transform(): { ox: number; oy: number; s: number } {
    const half = this.studio.topology.half;
    const pad = PAPER_MARGIN;
    const usable = Math.min(this.sizeW * (1 - pad * 2), this.sizeH * (1 - pad * 2));
    const s = usable / (2 * half);
    return {
      ox: this.sizeW / 2,
      oy: this.sizeH / 2,
      s,
    };
  }

  private toSheet(px: number, py: number): { x: number; y: number } {
    const { ox, oy, s } = this.transform();
    const half = this.studio.topology.half;
    return {
      x: clamp((px - ox) / s, -half, half),
      y: clamp(-(py - oy) / s, -half, half),
    };
  }

  private toPixel(p: { x: number; y: number }): { x: number; y: number } {
    const { ox, oy, s } = this.transform();
    return { x: ox + p.x * s, y: oy - p.y * s };
  }

  private bindCanvas(): void {
    const c = this.canvas;
    c.tabIndex = 0;
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.onCleanup(() => {
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
    });

    c.addEventListener('pointermove', (e) => {
      if (this.drag.kind !== 'none') return;
      const p = this.toSheet(e.offsetX, e.offsetY);
      const hit = this.hitTest(p);
      if (hit !== this.hoverId) {
        this.hoverId = hit;
        this.rafDirty = true;
        c.style.cursor = hit ? 'pointer' : 'crosshair';
      }
    });

    c.addEventListener('dblclick', (e) => {
      const p = this.toSheet(e.offsetX, e.offsetY);
      const hit = this.hitTest(p);
      if (hit) this.studio.select(hit);
    });

    c.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.deleteSelected();
      }
    });
    c.tabIndex = 0;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const p = this.toSheet(px, py);

    // Handle grab first (endpoints of the selected crease).
    const sel = this.studio.doc.creases.find((c) => c.id === this.studio.selectedCreaseId);
    if (sel) {
      const a = this.toPixel(sel.a);
      const b = this.toPixel(sel.b);
      const ra = Math.hypot(a.x - px, a.y - py);
      const rb = Math.hypot(b.x - px, b.y - py);
      if (ra < 11 || rb < 11) {
        this.drag = { kind: 'handle', creaseId: sel.id, end: ra < rb ? 'a' : 'b' };
        this.studio.store.beginGesture();
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
    }

    const hit = this.hitTest(p);
    if (hit) {
      this.studio.select(hit);
      const c = this.studio.doc.creases.find((x) => x.id === hit)!;
      this.drag = { kind: 'move', creaseId: hit, grab: p, orig: { a: { ...c.a }, b: { ...c.b } } };
      this.studio.store.beginGesture();
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (this.studio.doc.creases.length >= MAX_CREASES) return;
    this.drag = { kind: 'draw', from: p, to: p, type: this.drawType };
    this.canvas.setPointerCapture(e.pointerId);
    this.rafDirty = true;
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.drag.kind === 'none') return;
    const rect = this.canvas.getBoundingClientRect();
    const p = this.toSheet(e.clientX - rect.left, e.clientY - rect.top);

    if (this.drag.kind === 'draw') {
      this.drag.to = p;
      this.rafDirty = true;
    } else if (this.drag.kind === 'handle') {
      const id = this.drag.creaseId;
      this.studio.store.updateCrease(id, { [this.drag.end]: p } as Partial<Crease>, false);
      this.rafDirty = true;
    } else if (this.drag.kind === 'move') {
      const dx = p.x - this.drag.grab.x;
      const dy = p.y - this.drag.grab.y;
      const half = this.studio.topology.half;
      const na = { x: clamp(this.drag.orig.a.x + dx, -half, half), y: clamp(this.drag.orig.a.y + dy, -half, half) };
      const nb = { x: clamp(this.drag.orig.b.x + dx, -half, half), y: clamp(this.drag.orig.b.y + dy, -half, half) };
      this.studio.store.updateCrease(this.drag.creaseId, { a: na, b: nb }, false);
      this.rafDirty = true;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (d.kind === 'none') return;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    this.drag = { kind: 'none' };

    if (d.kind === 'draw') {
      const len = dist2(d.from, d.to);
      if (len < 0.04) {
        this.rafDirty = true;
        return;
      }
      // Snap axis-aligned or 45° when close, which is what most origami creases are.
      const snapped = snapCrease(d.from, d.to);
      // New creases start flat: the fold is authored on the timeline, and a
      // freshly drawn crease should not yank the sheet before a key exists.
      const created = this.studio.store.addCrease({
        a: snapped.a,
        b: snapped.b,
        type: d.type,
        angle: 0,
      });
      if (created) this.studio.select(created.id);
      this.rafDirty = true;
    } else {
      this.studio.store.endGesture('crease-drag');
      this.rafDirty = true;
      this.update();
    }
  };

  private hitTest(p: { x: number; y: number }): string | null {
    const { s } = this.transform();
    const tol = 9 / s;
    let best: string | null = null;
    let bestD = tol;
    for (const c of this.studio.doc.creases) {
      const d = pointSegmentDistance(p, c.a, c.b);
      if (d < bestD) {
        bestD = d;
        best = c.id;
      }
    }
    return best;
  }

  // -- painting ------------------------------------------------------------

  private paint(): void {
    const ctx = this.ctx;
    const { ox, oy, s } = this.transform();
    const half = this.studio.topology.half;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.sizeW, this.sizeH);

    // Sheet with a paper-ish surface and a subtle drop shadow.
    const pw = 2 * half * s;
    const x0 = ox - half * s;
    const y0 = oy - half * s;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = '#efe3cd';
    ctx.fillRect(x0, y0, pw, pw);
    ctx.restore();

    // Paper texture: faint grain lines.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, pw, pw);
    ctx.clip();
    ctx.strokeStyle = 'rgba(120,95,60,0.045)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const yy = y0 + ((i * 37) % 100) / 100 * pw;
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x0 + pw, yy + Math.sin(i) * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Border.
    ctx.strokeStyle = 'rgba(90,70,45,0.32)';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, pw - 1, pw - 1);

    // Grid guides at quarter spacing.
    ctx.save();
    ctx.strokeStyle = 'rgba(90,70,45,0.10)';
    ctx.setLineDash([2, 4]);
    for (const f of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(ox + f * pw, y0);
      ctx.lineTo(ox + f * pw, y0 + pw);
      ctx.moveTo(x0, oy - f * pw);
      ctx.lineTo(x0 + pw, oy - f * pw);
      ctx.stroke();
    }
    ctx.restore();

    // Resolved crease overlay: extension hints dashed, actual creases solid.
    const topo = this.studio.topology;
    for (const rc of topo.creases) {
      const crease = this.studio.doc.creases.find((c) => c.id === rc.id);
      if (!crease) continue;
      const isSel = crease.id === this.studio.selectedCreaseId;
      const isHover = crease.id === this.hoverId;
      const color = crease.type === 'valley' ? '#2f7fb5' : '#b5603a';

      // Extension hint: from the drawn segment out to the resolved endpoints.
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(90,70,45,0.30)';
      ctx.lineWidth = 1;
      drawExtendedHint(ctx, crease, rc, (p) => this.toPixel(p));
      ctx.restore();

      // Main drawn crease.
      const a = this.toPixel(crease.a);
      const b = this.toPixel(crease.b);
      ctx.save();
      ctx.lineCap = 'round';
      if (crease.type === 'mountain') {
        // Mountain: dash–dot to read like a hand-drawn mountain crease.
        ctx.setLineDash([9, 4, 2, 4]);
        ctx.lineDashOffset = 0;
      }
      ctx.strokeStyle = isSel ? '#1b1b1b' : color;
      ctx.globalAlpha = isSel ? 0.95 : isHover ? 0.9 : 0.78;
      ctx.lineWidth = isSel ? 2.6 : 1.9;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();

      // Endpoints of the selected crease.
      if (isSel) {
        for (const p of [a, b]) {
          ctx.save();
          ctx.fillStyle = '#f6f1e6';
          ctx.strokeStyle = '#1b1b1b';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      }

      // Slot number near the midpoint.
      const mid = this.toPixel({ x: (crease.a.x + crease.b.x) / 2, y: (crease.a.y + crease.b.y) / 2 });
      const nx = -(b.y - a.y);
      const ny = b.x - a.x;
      const nl = Math.hypot(nx, ny) || 1;
      const labelX = mid.x + (nx / nl) * 11;
      const labelY = mid.y + (ny / nl) * 11;
      ctx.save();
      ctx.font = '600 9.5px ui-monospace, monospace';
      const label = `#${String(crease.slot + 1).padStart(2, '0')}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.beginPath();
      ctx.roundRect(labelX - tw / 2 - 3, labelY - 7, tw + 6, 14, 3);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, labelX, labelY + 0.5);
      ctx.restore();
    }

    // Draw-in-progress preview.
    if (this.drag.kind === 'draw') {
      const a = this.toPixel(this.drag.from);
      const b = this.toPixel(this.drag.to);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = this.drag.type === 'valley' ? '#2f7fb5' : '#b5603a';
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2.2;
      if (this.drag.type === 'mountain') ctx.setLineDash([9, 4, 2, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

  }
}

// -- helpers ---------------------------------------------------------------

function fmtDegree(v: number): string {
  return `${Math.round(v)}°`;
}

function slotOf(creases: Crease[], id: string): string {
  const c = creases.find((x) => x.id === id);
  return c ? String(c.slot + 1).padStart(2, '0') : '?';
}

function pointSegmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Snap a drawn crease to the nearest 45° when it is within a few degrees. */
function snapCrease(a: { x: number; y: number }, b: { x: number; y: number }): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  const diff = Math.abs(normalizeAngle(ang - snapped));
  if (diff > 0.055) return { a, b }; // ~3°: leave it freehand

  const len = Math.hypot(dx, dy);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const ux = Math.cos(snapped) * (len / 2);
  const uy = Math.sin(snapped) * (len / 2);
  return {
    a: { x: mid.x - ux, y: mid.y - uy },
    b: { x: mid.x + ux, y: mid.y + uy },
  };
}

function normalizeAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function drawExtendedHint(
  ctx: CanvasRenderingContext2D,
  crease: Crease,
  resolved: { a: { x: number; y: number }; b: { x: number; y: number }; adjusted: boolean },
  toPixel: (p: { x: number; y: number }) => { x: number; y: number },
): void {
  if (!resolved.adjusted) return;
  const pts: { x: number; y: number }[] = [];
  // Whichever resolved endpoint lies beyond the drawn segment.
  const drawnLen = Math.hypot(crease.b.x - crease.a.x, crease.b.y - crease.a.y);
  if (drawnLen < 1e-6) return;
  const dirA = { x: (crease.b.x - crease.a.x) / drawnLen, y: (crease.b.y - crease.a.y) / drawnLen };
  const projResolvedA = (resolved.a.x - crease.a.x) * dirA.x + (resolved.a.y - crease.a.y) * dirA.y;
  const projResolvedB = (resolved.b.x - crease.a.x) * dirA.x + (resolved.b.y - crease.a.y) * dirA.y;
  if (projResolvedA < -0.01) pts.push(resolved.a, crease.a);
  else if (projResolvedB > drawnLen + 0.01) pts.push(crease.b, resolved.b);

  if (pts.length) {
    const p0 = toPixel(pts[0]);
    const p1 = toPixel(pts[1]);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
}

/** Register the module. */
export function registerCreaseEditor(): void {
  if (!customElements.get(CreaseEditor.tagName)) {
    customElements.define(CreaseEditor.tagName, CreaseEditor);
  }
}
