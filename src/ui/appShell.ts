import { adoptStyles, adoptTokens, ReactiveElement, q, qa } from './base';
import type { ViewMode } from '../app/studio';

/**
 * App shell: three-pane layout — crease modelling on the left, 3D viewport top
 * right, timeline bottom right, material panel as a right-hand drawer.
 */

const CSS = `
:host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
:host > [data-root] { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.main { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(380px, 35%) minmax(0, 1fr); }
.left { min-height: 0; border-right: 1px solid var(--line-1); display: flex; flex-direction: column; }
.right { display: grid; grid-template-rows: minmax(0, 1fr) minmax(200px, 34%); min-height: 0; position: relative; }
.viewport-wrap { position: relative; min-height: 0; display: flex; }
viewport-3d { flex: 1; }
.timeline-wrap { min-height: 0; border-top: 1px solid var(--line-1); display: flex; }
timeline-editor { flex: 1; }
.drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 286px; background: var(--bg-1); border-left: 1px solid var(--line-2);
  box-shadow: -18px 0 44px rgba(0,0,0,.4); transform: translateX(100%); transition: transform .22s cubic-bezier(.2,.7,.2,1); z-index: 20; display: flex; }
.drawer.open { transform: translateX(0); }
material-panel { flex: 1; }
.tab { position: absolute; right: 0; top: 14px; z-index: 21; writing-mode: vertical-rl; padding: 10px 6px; border-radius: var(--radius-s) 0 0 var(--radius-s);
  background: var(--bg-2); border: 1px solid var(--line-2); border-right: 0; color: var(--ink-2); font-size: 11px; letter-spacing: .12em; }
.tab:hover { color: var(--ink-0); }
.drawer.open ~ .tab { opacity: 0; pointer-events: none; }
.views { position: absolute; left: 12px; top: 46px; display: flex; gap: 2px; padding: 3px; border-radius: var(--radius-s); background: rgba(14,15,19,.72); border: 1px solid var(--line-2); backdrop-filter: blur(8px); z-index: 4; }
.views button { padding: 3px 9px; border-radius: 3px; font-size: 11px; color: var(--ink-2); }
.views button[aria-pressed=true] { background: var(--bg-4); color: var(--ink-0); }

@media (max-width: 1080px) {
  .main { grid-template-columns: minmax(300px, 38%) minmax(0, 1fr); }
  .drawer { width: 260px; }
}
@media (max-width: 760px) {
  .main { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1.05fr) minmax(0, 1fr); }
  .left { border-right: 0; border-bottom: 1px solid var(--line-1); }
  .right { grid-template-rows: minmax(0, 1fr) minmax(158px, 42%); }
  .tab { top: 10px; padding: 8px 5px; font-size: 10px; }
  .views { top: 40px; left: 8px; }
  .drawer { width: min(280px, 78vw); }
}
`;

export class AppShell extends ReactiveElement {
  static readonly tagName = 'app-shell';

  private drawerOpen = false;

  protected setup(): void {
    adoptTokens(this.root);
    adoptStyles(this.root, CSS);
    this.update();
    const unsubs = [
      this.studio.on('mode', () => this.update()),
      window.matchMedia('(max-width: 820px)').matches ? () => {} : () => {},
    ];
    this.onCleanup(() => unsubs.forEach((u) => u()));
  }

  protected view(): string {
    const mode = this.studio.mode;
    return `
      <div class="main">
        <div class="left">
          <crease-editor></crease-editor>
        </div>
        <div class="right">
          <div class="viewport-wrap">
            <viewport-3d></viewport-3d>
            <div class="views" role="group" aria-label="视图模式">
              <button data-mode="flat" aria-pressed="${mode === 'flat'}">平铺</button>
              <button data-mode="solid" aria-pressed="${mode === 'solid'}">立体</button>
            </div>
            <div class="drawer ${this.drawerOpen ? 'open' : ''}" data-drawer>
              <material-panel></material-panel>
            </div>
            <button class="tab" data-act="drawer" aria-expanded="${this.drawerOpen}" title="纸面与光照">纸面光照</button>
          </div>
          <div class="timeline-wrap">
            <timeline-editor></timeline-editor>
          </div>
        </div>
      </div>`;
  }

  protected override afterRender(): void {
    qa<HTMLButtonElement>(this.root, '[data-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        this.studio.setMode((b.dataset.mode as ViewMode) ?? 'solid');
      });
    });
    q<HTMLButtonElement>(this.root, '[data-act="drawer"]')?.addEventListener('click', () => {
      this.drawerOpen = true;
      this.update();
    });
    const drawerEl = q<HTMLElement>(this.root, '[data-drawer]');
    drawerEl?.addEventListener('close-panel', () => {
      this.drawerOpen = false;
      this.update();
    });
    // Click-away closes the drawer, matching the other popovers.
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.drawerOpen) return;
      const path = e.composedPath();
      const inDrawer = path.some((n) => (n as HTMLElement).dataset?.drawer !== undefined);
      const onTab = path.some((n) => (n as HTMLElement).dataset?.act === 'drawer');
      if (!inDrawer && !onTab) {
        this.drawerOpen = false;
        this.update();
      }
    });
  }
}

export function registerAppShell(): void {
  if (!customElements.get(AppShell.tagName)) {
    customElements.define(AppShell.tagName, AppShell);
  }
}
