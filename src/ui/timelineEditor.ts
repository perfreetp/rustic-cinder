import { adoptStyles, adoptTokens, ReactiveElement, q, qa } from './base';
import { normalizeKeys, sampleTrack } from '../core/timeline';
import { clamp } from '../core/math';
import type { Crease, Keyframe } from '../core/types';

/**
 * Timeline & keyframes (module 2: 关键帧, module 3: 序列播放).
 *
 * The ruler and the per-crease tracks share one time→pixel mapping, so the
 * playhead is a single vertical line across the whole editor. Dragging a key
 * snaps to a 1/20 s grid unless Alt is held; the angle is editable in the
 * inspector on the right, and double-clicking a track inserts a key there.
 *
 * Interpolation preview: the faint curve under each track is the sampled
 * Hermite spline, drawn from the exact same code the renderer uses, so what the
 * user sees on the track is what the paper does.
 */

const CSS = `
:host { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--bg-1); }
:host > [data-root] { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.head { display: flex; align-items: center; gap: var(--sp-2); padding: 9px 14px; border-bottom: 1px solid var(--line-1); }
.head h2 { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--ink-0); }
.head .spacer { flex: 1; }
.time { font-family: var(--font-num); font-size: 12px; color: var(--ink-0); font-variant-numeric: tabular-nums; min-width: 96px; }
.time small { color: var(--ink-3); }
.transport { display: flex; align-items: center; gap: 4px; }
.playbtn { width: 34px; height: 30px; border-radius: var(--radius-s); background: var(--accent); color: #1a0f08; display: grid; place-items: center; }
.playbtn:hover { background: var(--accent-hi); }
.body { flex: 1; display: grid; grid-template-columns: minmax(0,1fr) 230px; min-height: 0; }
.stage { position: relative; display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.canvas-slot { flex: 1 1 auto; min-height: 0; position: relative; }
canvas.tl { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: default; }
.foot { display: flex; align-items: center; gap: var(--sp-3); padding: 6px 14px 9px; border-top: 1px solid var(--line-1); flex-wrap: wrap; }
.foot .field { min-height: 22px; gap: 6px; }
.foot .field > label { min-width: auto; }
.side { border-left: 1px solid var(--line-1); display: flex; flex-direction: column; min-height: 0; }
.side .box { padding: 10px 12px; border-bottom: 1px solid var(--line-1); }
.side .title { font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-2); margin-bottom: 8px; }
.kv { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 0; font-size: 11.5px; }
.kv .k { color: var(--ink-2); }
.kv .v { font-family: var(--font-num); color: var(--ink-0); }
.side .none { font-size: 11.5px; color: var(--ink-3); line-height: 1.8; }
.keylist { flex: 1; overflow-y: auto; padding: 6px 12px 12px; }
.keyrow { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; font-size: 11px; }
.keyrow:hover { background: var(--bg-2); }
.keyrow .t { font-family: var(--font-num); color: var(--ink-1); min-width: 46px; }
.keyrow .a { font-family: var(--font-num); color: var(--ink-0); flex: 1; }
.keyrow button { color: var(--ink-3); font-size: 11px; padding: 0 4px; }
.keyrow button:hover { color: var(--danger); }

@media (max-width: 760px) {
  .head { padding: 7px 10px; gap: 6px; }
  .head h2 { font-size: 11.5px; }
  .time { min-width: 0; font-size: 11px; }
  .body { grid-template-columns: minmax(0,1fr) 150px; }
  .foot { padding: 5px 10px 7px; gap: 8px; }
  .foot .field > label { font-size: 11px; }
  .foot .spacer + span { display: none; }
  .side .box { padding: 8px 9px; }
}
@media (max-width: 560px) {
  .body { grid-template-columns: 1fr; }
  .side { display: none; }
}
`;

interface TrackRow {
  crease: Crease;
  y: number;
  h: number;
}

export class TimelineEditor extends ReactiveElement {
  static readonly tagName = 'timeline-editor';

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private drag: { kind: 'none' } | { kind: 'scrub' } | { kind: 'key'; creaseId: string; keyId: string } | { kind: 'keyangle'; creaseId: string; keyId: string } = { kind: 'none' };
  private rows: TrackRow[] = [];
  private dpr = 1;
  private w = 1;
  private h = 1;
  private padTop = 26;
  private padBottom = 8;
  private labelW = 62;
  private rightPad = 14;
  private rafDirty = true;
  private rafId = 0;
  private ro: ResizeObserver | null = null;
  private selectedKey: { creaseId: string; keyId: string } | null = null;

  protected setup(): void {
    adoptTokens(this.root);
    adoptStyles(this.root, CSS);
    this.update();

    const unsubs = [
      this.studio.on('time', () => {
        this.rafDirty = true;
        this.paintTimeReadout();
      }),
      this.studio.on('play', () => this.update()),
      this.studio.on('doc', () => {
        this.rafDirty = true;
        this.update();
      }),
      this.studio.on('selection', () => {
        this.rafDirty = true;
        this.update();
      }),
    ];
    this.onCleanup(() => unsubs.forEach((u) => u()));
    this.onCleanup(() => {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.ro?.disconnect();
    });

    const loop = () => {
      this.checkSize();
      if (this.rafDirty && this.ctx) {
        this.rafDirty = false;
        this.paint();
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  protected view(): string {
    const doc = this.studio.doc;
    const tl = doc.timeline;
    const playing = this.studio.playing;
    const sel = this.studio.selectedCreaseId;
    const selCrease = doc.creases.find((c) => c.id === sel) ?? null;
    const keys = selCrease ? normalizeKeys(doc.keyframes[selCrease.id] ?? []) : [];

    return `
      <div class="head">
        <h2>时间轴 · 关键帧</h2>
        <div class="spacer"></div>
        <div class="transport">
          <button class="btn icon ghost" data-act="start" title="回到起点" aria-label="回到起点">⏮</button>
          <button class="playbtn" data-act="play" title="${playing ? '暂停' : '播放'}（空格）" aria-label="${playing ? '暂停' : '播放'}">
            ${playing ? '❚❚' : '▶'}
          </button>
          <button class="btn icon ghost" data-act="end" title="到结尾" aria-label="到结尾">⏭</button>
        </div>
        <span class="time" data-time>0.00<small>s</small> <small>/ ${tl.duration.toFixed(2)}s</small></span>
      </div>
      <div class="body">
        <div class="stage">
          <div class="canvas-slot" data-slot="canvas"></div>
          <div class="foot">
            <div class="field">
              <label>时长</label>
              <input type="number" min="0.2" max="60" step="0.1" value="${tl.duration.toFixed(2)}" data-act="duration" data-focus="dur" />
            </div>
            <div class="field">
              <label>倍速</label>
              <input type="range" min="0.25" max="3" step="0.05" value="${tl.speed}" data-act="speed" style="width:80px" />
              <span class="value" data-speed-val>${tl.speed.toFixed(2)}×</span>
            </div>
            <label class="field" style="cursor:pointer">
              <input type="checkbox" data-act="loop" ${tl.loop ? 'checked' : ''} />
              <span style="color:var(--ink-2);font-size:12px">循环</span>
            </label>
            <div class="spacer" style="flex:1"></div>
            <span style="font-size:10.5px;color:var(--ink-3)">双击轨道插入关键帧 · 拖动关键帧改时间</span>
          </div>
        </div>
        <div class="side">
          <div class="box">
            <div class="title">所选折痕</div>
            ${selCrease ? `
              <div class="kv"><span class="k">编号</span><span class="v">#${String(selCrease.slot + 1).padStart(2, '0')}</span></div>
              <div class="kv"><span class="k">类型</span><span class="v">${selCrease.type === 'valley' ? '谷折' : '山折'}</span></div>
              <div class="kv"><span class="k">当前角度</span><span class="v">${Math.round(this.studio.anglesAt().get(selCrease.id) ?? 0)}°</span></div>
              <div class="kv"><span class="k">关键帧</span><span class="v">${keys.length}</span></div>
              <button class="btn" style="width:100%;margin-top:8px" data-act="add-key">
                ＋ 在当前时间加关键帧
              </button>
            ` : `<div class="none">在左侧折痕列表或 3D 视图中选择一条折痕，即可为它打关键帧。</div>`}
          </div>
          <div class="title" style="padding:10px 12px 0;margin:0">关键帧</div>
          <div class="keylist" data-scroll="keys">
            ${keys.length === 0 ? `<div class="none" style="padding:6px 0">${selCrease ? '暂无关键帧，折痕保持静态角度。' : '—'}</div>` : keys.map((k) => `
              <div class="keyrow" data-crease="${selCrease!.id}" data-key="${k.id}">
                <span class="t">${k.time.toFixed(2)}s</span>
                <span class="a">${Math.round(k.angle)}°</span>
                <button data-act="del-key" data-crease="${selCrease!.id}" data-key="${k.id}" title="删除关键帧" aria-label="删除关键帧">✕</button>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
  }

  protected override afterRender(): void {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'tl';
      this.ctx = this.canvas.getContext('2d')!;
      this.bindCanvas();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.canvas);
      this.resize();
      for (const delay of [0, 60, 200]) window.setTimeout(() => this.resize(), delay);
    }
    const slot = q<HTMLElement>(this.root, '[data-slot="canvas"]');
    if (slot && this.canvas.parentElement !== slot) slot.append(this.canvas);
    this.bindUi();
    this.paintTimeReadout();
  }

  private bindUi(): void {
    const root = this.root;
    qa<HTMLButtonElement>(root, '[data-act="play"]').forEach((b) => b.addEventListener('click', () => this.studio.togglePlay()));
    q<HTMLButtonElement>(root, '[data-act="start"]')?.addEventListener('click', () => {
      this.studio.pause();
      this.studio.seek(0);
    });
    q<HTMLButtonElement>(root, '[data-act="end"]')?.addEventListener('click', () => {
      this.studio.pause();
      this.studio.seek(this.studio.doc.timeline.duration);
    });

    const dur = q<HTMLInputElement>(root, '[data-act="duration"]');
    dur?.addEventListener('change', () => {
      const v = clamp(Number(dur.value) || 1, 0.2, 60);
      this.studio.store.setTimeline({ duration: v });
      this.studio.seek(Math.min(this.studio.time, v));
    });

    const speed = q<HTMLInputElement>(root, '[data-act="speed"]');
    speed?.addEventListener('input', () => {
      this.studio.store.setTimeline({ speed: Number(speed.value) }, false);
      const lbl = q(root, '[data-speed-val]');
      if (lbl) lbl.textContent = `${Number(speed.value).toFixed(2)}×`;
    });
    speed?.addEventListener('change', () => this.studio.store.setTimeline({ speed: Number(speed.value) }, true));

    const loop = q<HTMLInputElement>(root, '[data-act="loop"]');
    loop?.addEventListener('change', () => this.studio.store.setTimeline({ loop: loop.checked }));

    q<HTMLButtonElement>(root, '[data-act="add-key"]')?.addEventListener('click', () => {
      const sel = this.studio.selectedCreaseId;
      if (!sel) return;
      const angle = this.studio.anglesAt().get(sel) ?? 0;
      this.studio.store.addKeyframe(sel, this.studio.time, angle);
    });

    qa<HTMLButtonElement>(root, '[data-act="del-key"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const { crease, key } = btn.dataset as { crease: string; key: string };
        this.studio.store.removeKeyframe(crease, key);
        this.selectedKey = null;
      });
    });

    qa<HTMLElement>(root, '.keyrow').forEach((row) => {
      row.addEventListener('click', () => {
        const { crease, key } = row.dataset as { crease: string; key: string };
        this.selectedKey = { creaseId: crease, keyId: key };
        const list = this.studio.doc.keyframes[crease] ?? [];
        const k = list.find((x) => x.id === key);
        if (k) this.studio.seek(k.time);
        this.studio.select(crease);
        this.rafDirty = true;
      });
    });
  }

  private paintTimeReadout(): void {
    const el = q<HTMLElement>(this.root, '[data-time]');
    if (!el) return;
    const t = this.studio.time;
    const d = this.studio.doc.timeline.duration;
    el.innerHTML = `${t.toFixed(2)}<small>s</small> <small>/ ${d.toFixed(2)}s</small>`;
  }

  // -- canvas --------------------------------------------------------------

  private checkSize(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    if (Math.abs(rect.width - this.w) > 0.5 || Math.abs(rect.height - this.h) > 0.5) {
      this.resize();
      this.rafDirty = true;
    }
  }

  private resize(): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.rafDirty = true;
  }

  private timeToX(t: number): number {
    const d = this.studio.doc.timeline.duration;
    const span = Math.max(1, this.w - this.labelW - this.rightPad);
    return this.labelW + (t / d) * span;
  }

  private xToTime(x: number): number {
    const d = this.studio.doc.timeline.duration;
    const span = Math.max(1, this.w - this.labelW - this.rightPad);
    return clamp(((x - this.labelW) / span) * d, 0, d);
  }

  private layoutRows(): void {
    const doc = this.studio.doc;
    const usable = this.h - this.padTop - this.padBottom;
    const n = Math.max(1, doc.creases.length);
    const rowH = clamp(usable / n, 22, 40);
    this.rows = doc.creases.map((crease, i) => ({
      crease,
      y: this.padTop + i * rowH,
      h: rowH,
    }));
  }

  private paint(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.layoutRows();

    const doc = this.studio.doc;
    const d = doc.timeline.duration;

    // Ruler.
    const rulerY = 0;
    const rulerH = this.padTop;
    ctx.fillStyle = '#121419';
    ctx.fillRect(0, rulerY, this.w, rulerH);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.moveTo(0, rulerH - 0.5);
    ctx.lineTo(this.w, rulerH - 0.5);
    ctx.stroke();

    // Tick spacing: pick from a ladder so labels never crowd.
    const span = this.w - this.labelW - this.rightPad;
    const pxPerSec = span / d;
    const ladder = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60];
    let tick = ladder[ladder.length - 1];
    for (const c of ladder) {
      if (c * pxPerSec >= 54) {
        tick = c;
        break;
      }
    }
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const nTicks = Math.ceil(d / tick);
    for (let i = 0; i <= nTicks + 1; i++) {
      const t = i * tick;
      if (t > d + 1e-6) break;
      const x = this.timeToX(t);
      const major = Math.abs(t - Math.round(t)) < 1e-6;
      ctx.strokeStyle = major ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, rulerH - (major ? 8 : 5));
      ctx.lineTo(Math.round(x) + 0.5, rulerH);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(205,201,192,0.55)';
        ctx.fillText(`${t}s`, x, 10);
        // Grid line down the tracks.
        ctx.strokeStyle = 'rgba(255,255,255,0.035)';
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, rulerH);
        ctx.lineTo(Math.round(x) + 0.5, this.h);
        ctx.stroke();
      }
    }

    // Rows.
    doc.creases.forEach((crease, i) => {
      const row = this.rows[i];
      if (!row) return;
      const sel = crease.id === this.studio.selectedCreaseId;
      if (sel) {
        ctx.fillStyle = 'rgba(224,116,63,0.06)';
        ctx.fillRect(0, row.y, this.w, row.h);
      }
      if (i > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.moveTo(0, Math.round(row.y) + 0.5);
        ctx.lineTo(this.w, Math.round(row.y) + 0.5);
        ctx.stroke();
      }

      // Track label.
      const color = crease.type === 'valley' ? '#5aa9e6' : '#e0885a';
      ctx.fillStyle = sel ? color : 'rgba(150,147,140,0.9)';
      ctx.font = `${sel ? '600 ' : ''}10px ui-monospace, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(`#${String(crease.slot + 1).padStart(2, '0')}`, 10, row.y + row.h / 2);

      // Interpolation curve, normalised 0..180° across the row height.
      this.paintCurve(crease, row, color, sel);

      // Keyframe diamonds.
      const keys = normalizeKeys(doc.keyframes[crease.id] ?? []);
      for (const k of keys) {
        const x = this.timeToX(k.time);
        const y = this.keyY(row, k);
        const active = this.selectedKey?.keyId === k.id;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        const s = active ? 5.2 : 4.2;
        ctx.fillStyle = active ? '#ffffff' : sel ? color : 'rgba(205,201,192,0.85)';
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.strokeRect(-s, -s, s * 2, s * 2);
        ctx.restore();
      }

      if (keys.length === 0) {
        // Static-angle hint line.
        const y = row.y + row.h - 5 - (clamp(crease.angle, 0, 180) / 180) * (row.h - 10);
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(150,147,140,0.28)';
        ctx.beginPath();
        ctx.moveTo(this.labelW, y);
        ctx.lineTo(this.w - this.rightPad, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    if (doc.creases.length === 0) {
      ctx.fillStyle = 'rgba(150,147,140,0.5)';
      ctx.font = '11.5px var(--font-ui)';
      ctx.textAlign = 'center';
      ctx.fillText('先在上方「折痕建模」中绘制折痕，再回到这里打关键帧。', this.w / 2, this.h / 2);
    }

    // Playhead.
    const px = this.timeToX(this.studio.time);
    ctx.strokeStyle = 'rgba(224,116,63,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, this.h);
    ctx.stroke();
    ctx.fillStyle = '#e0743f';
    ctx.beginPath();
    ctx.moveTo(px - 6, 0);
    ctx.lineTo(px + 6, 0);
    ctx.lineTo(px, 9);
    ctx.closePath();
    ctx.fill();
  }

  private keyY(row: TrackRow, k: Keyframe): number {
    const t = clamp(k.angle, 0, 180) / 180;
    return row.y + row.h - 5 - t * (row.h - 10);
  }

  private paintCurve(crease: Crease, row: TrackRow, color: string, sel: boolean): void {
    const keys = normalizeKeys(this.studio.doc.keyframes[crease.id] ?? []);
    if (keys.length < 2) return;
    const track = this.studio.curve.tracks.get(crease.id);
    if (!track) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let px = this.labelW; px <= this.w - this.rightPad; px += 2) {
      const t = this.xToTime(px);
      const angle = sampleTrack(track, t);
      const y = row.y + row.h - 5 - (clamp(angle, 0, 180) / 180) * (row.h - 10);
      if (!started) {
        ctx.moveTo(px, y);
        started = true;
      } else {
        ctx.lineTo(px, y);
      }
    }
    ctx.strokeStyle = sel ? hexA(color, 0.55) : 'rgba(150,147,140,0.18)';
    ctx.lineWidth = sel ? 1.6 : 1.2;
    ctx.stroke();
    ctx.restore();
  }

  // -- input ---------------------------------------------------------------

  private bindCanvas(): void {
    const c = this.canvas;

    const local = (e: PointerEvent | MouseEvent) => {
      const rect = c.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    c.addEventListener('pointerdown', (e) => {
      const { x, y } = local(e);
      if (x < this.labelW) return;
      this.layoutRows();

      // Hit-test keys first.
      for (const row of this.rows) {
        if (y < row.y || y > row.y + row.h) continue;
        const list = normalizeKeys(this.studio.doc.keyframes[row.crease.id] ?? []);
        for (const k of list) {
          const kx = this.timeToX(k.time);
          const ky = this.keyY(row, k);
          if (Math.hypot(kx - x, ky - y) < 9) {
            this.selectedKey = { creaseId: row.crease.id, keyId: k.id };
            this.studio.select(row.crease.id);
            this.studio.store.beginGesture();
            this.drag = { kind: 'key', creaseId: row.crease.id, keyId: k.id };
            c.setPointerCapture(e.pointerId);
            this.rafDirty = true;
            this.update();
            return;
          }
        }
      }

      // Otherwise scrub.
      this.drag = { kind: 'scrub' };
      this.studio.pause();
      this.studio.seek(this.xToTime(x));
      c.setPointerCapture(e.pointerId);
      this.rafDirty = true;
    });

    c.addEventListener('pointermove', (e) => {
      const { x, y } = local(e);
      if (this.drag.kind === 'scrub') {
        this.studio.seek(this.xToTime(x));
        this.rafDirty = true;
      } else if (this.drag.kind === 'key') {
        const drag = this.drag;
        let t = this.xToTime(x);
        if (!e.altKey) t = Math.round(t * 20) / 20;
        // Angle straight from the vertical position inside the row.
        const rowFor = this.rows.find((r) => r.crease.id === drag.creaseId);
        let angle: number | undefined;
        if (rowFor) {
          const frac = clamp((rowFor.y + rowFor.h - 5 - y) / Math.max(1, rowFor.h - 10), 0, 1);
          angle = Math.round((frac * 180) / 2) * 2;
        }
        this.studio.store.moveKeyframe(drag.creaseId, drag.keyId, t, angle, false);
        this.rafDirty = true;
      }
    });

    const end = (e: PointerEvent) => {
      if (this.drag.kind === 'key') this.studio.store.endGesture('key-drag');
      this.drag = { kind: 'none' };
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      this.rafDirty = true;
      this.update();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('dblclick', (e) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (const row of this.rows) {
        if (y < row.y || y > row.y + row.h) continue;
        const t = this.xToTime(x);
        const sel = this.studio.selectedCreaseId;
        // Prefer the selected crease's row, else the row under the cursor.
        const target = sel && this.rows.some((r) => r.crease.id === sel) ? (this.rows.find((r) => r.crease.id === sel) ?? row) : row;
        const current = this.studio.anglesAt(t).get(target.crease.id) ?? target.crease.angle;
        this.studio.store.addKeyframe(target.crease.id, t, current);
        this.studio.select(target.crease.id);
        this.rafDirty = true;
        return;
      }
    });
  }
}

function hexA(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function registerTimeline(): void {
  if (!customElements.get(TimelineEditor.tagName)) {
    customElements.define(TimelineEditor.tagName, TimelineEditor);
  }
}
