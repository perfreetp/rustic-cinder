import './global.css';
import { setStudioContext } from './ui/base';
import { Studio } from './app/studio';
import { registerCreaseEditor } from './ui/creaseEditor';
import { registerTimeline } from './ui/timelineEditor';
import { registerMaterialPanel } from './ui/materialPanel';
import { registerViewport } from './ui/viewport3d';
import { registerTopBar } from './ui/topBar';
import { registerAppShell } from './ui/appShell';
import { SAMPLES } from './core/samples';

/**
 * Application entry.
 *
 * Boots the studio with a sample sequence, registers the custom elements and
 * mounts the shell. Keyboard shortcuts live here at the top level so they work
 * whatever element has focus (except while typing in a field).
 */

const studio = new Studio(SAMPLES[0].make());
setStudioContext(studio);

registerCreaseEditor();
registerTimeline();
registerMaterialPanel();
registerViewport();
registerTopBar();
registerAppShell();

const app = document.getElementById('app')!;
const col = document.createElement('div');
col.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0';
const shell = document.createElement('top-bar');
shell.style.flex = '0 0 auto';
const body = document.createElement('app-shell');
body.style.flex = '1 1 auto';
body.style.minHeight = '0';
body.style.display = 'flex';
body.style.flexDirection = 'column';
col.appendChild(shell);
col.appendChild(body);
app.replaceChildren(col);

// Expose for the headless smoke tests and for console tinkering.
(window as unknown as { __studio: Studio }).__studio = studio;

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key.toLowerCase() === 'z') {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    if (e.shiftKey) studio.store.redo();
    else studio.store.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    studio.store.redo();
    return;
  }

  if (isTypingTarget(e.target)) return;

  if (e.key === ' ') {
    e.preventDefault();
    studio.togglePlay();
    return;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    studio.pause();
    studio.seek(studio.time - (e.shiftKey ? 1 : 1 / 30));
    return;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    studio.pause();
    studio.seek(studio.time + (e.shiftKey ? 1 : 1 / 30));
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const id = studio.selectedCreaseId;
    if (id) {
      e.preventDefault();
      studio.store.removeCrease(id);
      studio.select(null);
    }
  }
});

// Pause playback when the tab is hidden so the clock doesn't jump on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) studio.pause();
});

// A first-run hint about the sample library, shown in the shell header area.
(window as unknown as { __ready?: boolean }).__ready = true;
