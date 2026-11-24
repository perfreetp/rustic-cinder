/**
 * Tiny Web Components base.
 *
 * Native custom elements with shadow DOM, plus a minimal reactive base class
 * so panels re-render from studio state without a framework. Rendering is a
 * full innerHTML swap guarded by a dirty flag, which is fine at this size and
 * keeps focus handling predictable through the `data-focus` restore below.
 */

import type { Studio } from '../app/studio';
import { TOKEN_CSS } from './tokenCss';

/**
 * The application is single-instance, and components are created by the shell's
 * markup, so the studio is published here once at boot rather than threaded
 * through every constructor.
 */
let currentStudio: Studio | null = null;

export function setStudioContext(studio: Studio): void {
  currentStudio = studio;
}

export function getStudioContext(): Studio {
  if (!currentStudio) throw new Error('Studio context has not been initialised');
  return currentStudio;
}

const sheets = new Map<string, CSSStyleSheet>();

/** Share one adopted stylesheet per element name, injected once. */
export function adoptStyles(root: ShadowRoot, css: string): void {
  let sheet = sheets.get(css);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    sheets.set(css, sheet);
  }
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
}

/** Global token stylesheet shared by every shadow root. */
let tokens: CSSStyleSheet | null = null;

/** Inject the shared token sheet into a shadow root (idempotent). */
export function adoptTokens(root: ShadowRoot): void {
  if (!tokens) {
    tokens = new CSSStyleSheet();
    tokens.replaceSync(TOKEN_CSS);
  }
  if (!root.adoptedStyleSheets.includes(tokens)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, tokens];
  }
}

export type AttrMap = Record<string, string | number | boolean | null | undefined>;

export function attrs(map: AttrMap): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (v === false || v === null || v === undefined) continue;
    if (v === true) out.push(k);
    else out.push(`${k}="${escapeAttr(String(v))}"`);
  }
  return out.join(' ');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** `el.innerHTML = html` with focus / scroll preservation inside the root. */
export function patch(root: ShadowRoot, html: string, focusKey = 'data-focus'): void {
  const active = root.activeElement as HTMLElement | null;
  let focusId: string | null = null;
  let selStart: number | null = null;
  let selEnd: number | null = null;
  if (active && root.contains(active)) {
    focusId = active.getAttribute(focusKey);
    if (active instanceof HTMLInputElement && active.type !== 'range' && active.type !== 'checkbox') {
      try {
        selStart = active.selectionStart;
        selEnd = active.selectionEnd;
      } catch {
        selStart = null;
      }
    }
  }

  const scrollTops = new Map<string, number>();
  root.querySelectorAll<HTMLElement>('[data-scroll]').forEach((el) => {
    scrollTops.set(el.getAttribute('data-scroll')!, el.scrollTop);
  });

  const holder = root.querySelector('[data-root]') as HTMLElement;
  holder.innerHTML = html;

  root.querySelectorAll<HTMLElement>('[data-scroll]').forEach((el) => {
    const top = scrollTops.get(el.getAttribute('data-scroll')!);
    if (top !== undefined) el.scrollTop = top;
  });

  if (focusId) {
    const next = root.querySelector<HTMLElement>(`[${focusKey}="${CSS.escape(focusId)}"]`);
    if (next) {
      next.focus({ preventScroll: true });
      if (selStart !== null && next instanceof HTMLInputElement) {
        try {
          next.setSelectionRange(selStart, selEnd ?? selStart);
        } catch {
          /* type mismatch */
        }
      }
    }
  }
}

/**
 * Reactive element base. Subclasses implement `view()` returning HTML and
 * subscribe to studio events; `update()` schedules a single rAF render.
 */
export abstract class ReactiveElement extends HTMLElement {
  protected studio!: Studio;
  protected root: ShadowRoot;
  private scheduled = false;
  private cleanups: (() => void)[] = [];
  protected mounted = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  /** Called once after the element is connected and the studio is attached. */
  protected abstract setup(): void;
  /** HTML for the shadow root's `[data-root]` element. */
  protected abstract view(): string;

  /** Attach a studio explicitly; defaults to the published app context. */
  attach(studio: Studio): this {
    this.studio = studio;
    return this;
  }

  connectedCallback(): void {
    if (this.mounted) return;
    this.mounted = true;
    if (!this.studio) this.studio = getStudioContext();
    this.setup();
    this.render();
  }

  disconnectedCallback(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.mounted = false;
  }

  /** Register a teardown callback (event listeners on window, intervals…). */
  protected onCleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  /** Schedule a render on the next frame. */
  update(): void {
    if (!this.mounted || this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      if (this.mounted) this.render();
    });
  }

  protected render(): void {
    if (!this.root.querySelector('[data-root]')) {
      const holder = document.createElement('div');
      holder.setAttribute('data-root', '');
      this.root.append(holder);
    }
    patch(this.root, this.view());
    this.afterRender();
  }

  protected afterRender(): void {}
}

/** Local event helper: `q` scoped to the shadow root. */
export function q<E extends Element = HTMLElement>(root: ParentNode, sel: string): E | null {
  return root.querySelector<E>(sel);
}

export function qa<E extends Element = HTMLElement>(root: ParentNode, sel: string): E[] {
  return Array.from(root.querySelectorAll<E>(sel));
}
