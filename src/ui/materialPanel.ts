import { adoptStyles, adoptTokens, ReactiveElement, q, qa } from './base';
import type { Material } from '../core/types';

/**
 * Paper & light panel (module 4: 纸面渲染).
 *
 * Exposes the material parameters the shader consumes: tint, the three
 * translucency grades, key-light azimuth/elevation, fibre strength and ambient
 * bounce. Every control writes through the store, so changes land in the undo
 * history and in the exported file.
 */

const TINTS: { hex: string; name: string }[] = [
  { hex: '#f3e7d3', name: '和纸米' },
  { hex: '#ffffff', name: '纯白' },
  { hex: '#f6d7b0', name: '牛皮' },
  { hex: '#d9e4e8', name: '雾蓝' },
  { hex: '#e9d2d2', name: '樱' },
  { hex: '#cddcc4', name: '青竹' },
];

const GRADES = [
  { v: 0, label: '不透明', hint: '标准复印纸，背面几乎不透光' },
  { v: 1, label: '半透', hint: '薄和纸，背光可见纤维' },
  { v: 2, label: '透光', hint: '羊皮纸质感，强透射与内部散射' },
];

const CSS = `
:host { display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--bg-1); }
:host > [data-root] { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.head { display: flex; align-items: center; gap: var(--sp-3); padding: 10px 14px; border-bottom: 1px solid var(--line-1); }
.head h2 { margin: 0; font-size: 12.5px; font-weight: 600; color: var(--ink-0); }
.body { flex: 1; overflow-y: auto; padding: 6px 14px 16px; }
.sec { padding: 12px 0 10px; border-bottom: 1px solid var(--line-1); }
.sec:last-child { border-bottom: 0; }
.sec h3 { margin: 0 0 10px; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--ink-2); font-weight: 600; }
.tints { display: flex; gap: 7px; flex-wrap: wrap; }
.tint { width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent; position: relative; box-shadow: inset 0 0 0 1px rgba(0,0,0,.25); transition: transform .12s ease; }
.tint:hover { transform: scale(1.08); }
.tint[aria-pressed=true] { border-color: var(--accent); }
.grades { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.grade { padding: 9px 8px; border-radius: var(--radius-s); border: 1px solid var(--line-2); background: var(--bg-0); text-align: left; transition: border-color .13s ease, background .13s ease; }
.grade:hover { border-color: var(--line-3); }
.grade[aria-pressed=true] { border-color: var(--accent); background: rgba(224,116,63,.08); }
.grade .t { font-size: 12px; color: var(--ink-0); margin-bottom: 3px; font-weight: 500; }
.grade .h { font-size: 10px; color: var(--ink-3); line-height: 1.5; }
.grade .sw { height: 16px; border-radius: 3px; margin-bottom: 7px; border: 1px solid rgba(0,0,0,.2); }
.az { display: flex; align-items: center; gap: 10px; }
.dial { position: relative; width: 46px; height: 46px; flex: 0 0 auto; border-radius: 50%; border: 1px solid var(--line-2); background: var(--bg-0); }
.dial .beam { position: absolute; left: 50%; top: 50%; width: 18px; height: 2px; background: var(--warn); border-radius: 1px; transform-origin: 0 50%; }
.dial .core { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: var(--warn); }
.note { font-size: 10.5px; color: var(--ink-3); line-height: 1.7; margin-top: 4px; }
`;

export class MaterialPanel extends ReactiveElement {
  static readonly tagName = 'material-panel';

  protected setup(): void {
    adoptTokens(this.root);
    adoptStyles(this.root, CSS);
    this.update();
    const un = this.studio.on('doc', () => this.update());
    this.onCleanup(un);
  }

  protected view(): string {
    const m = this.studio.doc.material;
    return `
      <div class="head">
        <h2>纸面与光照</h2>
        <div style="flex:1"></div>
        <button class="btn icon ghost" data-act="close" title="收起面板" aria-label="收起面板">✕</button>
      </div>
      <div class="body" data-scroll="mat">
        <div class="sec">
          <h3>纸色</h3>
          <div class="tints">
            ${TINTS.map((t) => `<button class="tint" style="background:${t.hex}" data-act="tint" data-hex="${t.hex}" aria-pressed="${m.tint.toLowerCase() === t.hex}" title="${t.name}" aria-label="${t.name}"></button>`).join('')}
            <label class="tint" style="background:${m.tint};display:grid;place-items:center;cursor:pointer" title="自定义颜色">
              <input type="color" value="${m.tint}" data-act="tint-custom" style="opacity:0;position:absolute;inset:0;width:100%;height:100%;border:0;cursor:pointer" aria-label="自定义纸张颜色" />
              <span style="font-size:14px;color:rgba(0,0,0,.5)">＋</span>
            </label>
          </div>
        </div>

        <div class="sec">
          <h3>透光度</h3>
          <div class="grades">
            ${GRADES.map((g) => `
              <button class="grade" data-act="grade" data-grade="${g.v}" aria-pressed="${m.translucency === g.v}">
                <div class="sw" style="background:${swatch(m.tint, g.v)}"></div>
                <div class="t">${g.label}</div>
                <div class="h">${g.hint}</div>
              </button>`).join('')}
          </div>
        </div>

        <div class="sec">
          <h3>主光方位</h3>
          <div class="az">
            <div class="dial" aria-hidden="true">
              <div class="beam" style="transform:rotate(${-m.azimuth}deg) translateX(3px)"></div>
              <div class="core"></div>
            </div>
            <div class="grow" style="flex:1">
              <div class="field">
                <input type="range" min="0" max="360" step="1" value="${m.azimuth}" data-act="azimuth" data-focus="az" />
                <span class="value">${Math.round(m.azimuth)}°</span>
              </div>
              <div class="field">
                <label style="min-width:32px">高度</label>
                <input class="grow" type="range" min="5" max="88" step="1" value="${m.elevation}" data-act="elevation" data-focus="el" />
                <span class="value">${Math.round(m.elevation)}°</span>
              </div>
            </div>
          </div>
        </div>

        <div class="sec">
          <h3>纤维与环境</h3>
          <div class="field">
            <label>纤维强度</label>
            <input class="grow" type="range" min="0" max="1" step="0.01" value="${m.fiber}" data-act="fiber" data-focus="fib" />
            <span class="value">${m.fiber.toFixed(2)}</span>
          </div>
          <div class="field">
            <label>环境光</label>
            <input class="grow" type="range" min="0" max="1" step="0.01" value="${m.ambient}" data-act="ambient" data-focus="amb" />
            <span class="value">${m.ambient.toFixed(2)}</span>
          </div>
          <div class="note">光照逐像素按折面法线计算；播放与拖动时间轴时纸面明暗随折面朝向实时变化。</div>
        </div>
      </div>`;
  }

  protected override afterRender(): void {
    const root = this.root;
    q<HTMLButtonElement>(root, '[data-act="close"]')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('close-panel', { bubbles: true, composed: true }));
    });
    qa<HTMLButtonElement>(root, '[data-act="tint"]').forEach((b) => {
      b.addEventListener('click', () => this.set({ tint: b.dataset.hex! }));
    });
    const custom = q<HTMLInputElement>(root, '[data-act="tint-custom"]');
    custom?.addEventListener('input', () => this.set({ tint: custom.value }, false));
    custom?.addEventListener('change', () => this.set({ tint: custom.value }, true));

    qa<HTMLButtonElement>(root, '[data-act="grade"]').forEach((b) => {
      b.addEventListener('click', () => this.set({ translucency: Number(b.dataset.grade) }));
    });

    bindRange(root, 'azimuth', (v) => this.set({ azimuth: v }, false), (v) => this.set({ azimuth: v }, true));
    bindRange(root, 'elevation', (v) => this.set({ elevation: v }, false), (v) => this.set({ elevation: v }, true));
    bindRange(root, 'fiber', (v) => this.set({ fiber: v }, false), (v) => this.set({ fiber: v }, true));
    bindRange(root, 'ambient', (v) => this.set({ ambient: v }, false), (v) => this.set({ ambient: v }, true));
  }

  private set(patch: Partial<Material>, history = true): void {
    this.studio.store.setMaterial(patch, history);
  }
}

function bindRange(root: ShadowRoot, act: string, onInput: (v: number) => void, onChange: (v: number) => void): void {
  const el = q<HTMLInputElement>(root, `[data-act="${act}"]`);
  if (!el) return;
  el.addEventListener('input', () => {
    onInput(Number(el.value));
    const val = el.parentElement?.querySelector('.value');
    if (val) val.textContent = act === 'fiber' || act === 'ambient' ? Number(el.value).toFixed(2) : `${Math.round(Number(el.value))}°`;
    // Repaint the dial beam live.
    if (act === 'azimuth') {
      const beam = root.querySelector<HTMLElement>('.dial .beam');
      if (beam) beam.style.transform = `rotate(${-Number(el.value)}deg) translateX(3px)`;
    }
  });
  el.addEventListener('change', () => onChange(Number(el.value)));
}

function swatch(hex: string, grade: number): string {
  const alpha = grade === 0 ? 1 : grade === 1 ? 0.82 : 0.62;
  return `linear-gradient(135deg, ${hex} 0%, ${hexAlpha(hex, alpha)} 100%)`;
}

function hexAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(243,231,211,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function registerMaterialPanel(): void {
  if (!customElements.get(MaterialPanel.tagName)) {
    customElements.define(MaterialPanel.tagName, MaterialPanel);
  }
}
