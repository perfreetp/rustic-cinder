import { adoptStyles, adoptTokens, ReactiveElement, q } from './base';
import { PaperRenderer } from '../render/paperRenderer';
import { sampleAngles } from '../core/timeline';
import { assembleMesh, solveFold } from '../core/fold';

/**
 * 3D viewport.
 *
 * Owns the PixiJS/WebGPU renderer and the render loop. The loop is demand
 * driven: a frame is drawn when something marked the scene dirty (playback,
 * scrubbing, camera move, material change), so an idle editor costs nothing.
 *
 * Per frame the solver re-runs for the current playhead time and the vertex
 * buffers are rewritten in place; normals come straight from the face
 * transforms, which is what keeps the shading correct while dragging.
 */

const CSS = `
:host { display: block; position: relative; min-width: 0; min-height: 0; background: #0b0c10; overflow: hidden; }
.canvas-slot { position: absolute; inset: 0; }
canvas { width: 100%; height: 100%; display: block; touch-action: none; }
.hud { position: absolute; left: 14px; top: 12px; display: flex; gap: 6px; pointer-events: none; }
.chip { font-family: var(--font-num); font-size: 10.5px; padding: 3px 8px; border-radius: 999px;
  background: rgba(14,15,19,.72); border: 1px solid var(--line-2); color: var(--ink-2); backdrop-filter: blur(8px);
  font-variant-numeric: tabular-nums; }
.chip b { color: var(--ink-0); font-weight: 600; }
.chip.gpu { color: var(--ok); border-color: rgba(95,191,138,.32); }
.chip.gpu.gl { color: var(--warn); border-color: rgba(224,179,82,.32); }
.corner { position: absolute; right: 12px; top: 11px; display: flex; gap: 6px; }
.corner .btn { height: 26px; background: rgba(14,15,19,.72); backdrop-filter: blur(8px); }
.gizmo { position: absolute; left: 16px; bottom: 16px; width: 52px; height: 52px; pointer-events: none; opacity: .8; }
.loading { position: absolute; inset: 0; display: grid; place-items: center; color: var(--ink-2); font-size: 12px; gap: 10px; text-align: center; }
.loading .spin { width: 22px; height: 22px; margin: 0 auto 10px; border-radius: 50%; border: 2px solid var(--line-2); border-top-color: var(--accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.err { position: absolute; inset: 0; display: grid; place-items: center; padding: 32px; text-align: center; color: var(--danger); font-size: 12.5px; line-height: 1.8; }
`;

export class Viewport3D extends ReactiveElement {
  static readonly tagName = 'viewport-3d';

  private renderer: PaperRenderer | null = null;
  private canvas!: HTMLCanvasElement;
  private rafId = 0;
  private lastTopologyKey = '';
  private lastMaterialKey = '';
  private status: 'loading' | 'ready' | 'error' = 'loading';
  private errorText = '';
  private backendLabel = '';
  private pointer = { active: false, id: -1, x: 0, y: 0, mode: 'orbit' as 'orbit' | 'pan' };
  private resizing = false;
  private disposed = false;

  protected setup(): void {
    adoptTokens(this.root);
    adoptStyles(this.root, CSS);
    this.update();

    const unsubs = [
      this.studio.on('invalidate', () => this.scheduleRender()),
      this.studio.on('doc', () => this.syncDoc()),
      this.studio.on('mode', ({ mode }) => {
        this.applyMode(mode);
        this.scheduleRender();
      }),
      this.studio.on('play', () => {
        this.paintStats();
        this.scheduleRender();
      }),
    ];
    this.onCleanup(() => unsubs.forEach((u) => u()));
    this.onCleanup(() => {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this.renderer?.destroy();
      this.renderer = null;
      this.disposed = true;
    });

    void this.boot();
  }

  private async boot(): Promise<void> {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      const slot = q<HTMLElement>(this.root, '[data-slot="canvas"]');
      if (slot) slot.append(this.canvas);
    }
    try {
      const renderer = await PaperRenderer.create({ canvas: this.canvas, preferWebGPU: true });
      this.renderer = renderer;
      this.backendLabel = renderer.actualBackend;
      this.startLoop();
      this.setupCameraInput();
      this.resize();
      for (const delay of [0, 60, 200, 500]) {
        window.setTimeout(() => this.resize(), delay);
      }
      this.status = 'ready';
      this.lastTopologyKey = '';
      this.applyMode(this.studio.mode);
      this.syncDoc();
      this.update();
      this.scheduleRender();

      // Drag-to-scrub feedback loop: while playing, the studio emits time
      // events, which land in scheduleRender via 'invalidate'.
    } catch (err) {
      this.status = 'error';
      this.errorText =
        '无法初始化 GPU 渲染器。请确认浏览器已启用 WebGPU / WebGL2。\n' + String(err);
      this.update();
    }
  }

  protected view(): string {
    if (this.status === 'loading') {
      return `<div class="canvas-slot" data-slot="canvas"></div><div class="loading"><div><div class="spin"></div>正在初始化 WebGPU 渲染器…</div></div>`;
    }
    if (this.status === 'error') {
      return `<canvas data-canvas></canvas><div class="err">${this.errorText.replace(/\n/g, '<br/>')}</div>`;
    }
    const gpuClass = this.backendLabel === 'webgpu' ? 'gpu' : 'gpu gl';
    return `
      <div class="canvas-slot" data-slot="canvas"></div>
      <div class="hud">
        <span class="chip"><b data-stat-fps>—</b> fps</span>
        <span class="chip"><b data-stat-tri>0</b> tri</span>
        <span class="chip ${gpuClass}">${this.backendLabel === 'webgpu' ? 'WebGPU' : 'WebGL'}</span>
      </div>
      <div class="corner">
        <button class="btn icon" data-act="reset" title="重置视角" aria-label="重置视角">⟲</button>
      </div>
      <svg class="gizmo" viewBox="-26 -26 52 52" aria-hidden="true" data-gizmo></svg>`;
  }

  protected override afterRender(): void {
    if (this.canvas) {
      const slot = q<HTMLElement>(this.root, '[data-slot="canvas"]');
      if (slot && this.canvas.parentElement !== slot) slot.append(this.canvas);
    }
    const reset = q<HTMLButtonElement>(this.root, '[data-act="reset"]');
    if (reset && !reset.dataset.bound) {
      reset.dataset.bound = '1';
      reset.addEventListener('click', () => {
        this.renderer?.resetCamera();
        this.syncCameraHud();
        this.scheduleRender();
      });
    }
    this.syncCameraHud();
  }

  /**
   * Flat mode looks straight down at the sheet — the crease pattern view used
   * while modelling. Solid mode returns to the three-quarter teaching view.
   */
  private applyMode(mode: 'flat' | 'solid'): void {
    const r = this.renderer;
    if (!r) return;
    if (mode === 'flat') {
      // Straight down, orthographic: a crease-pattern diagram of the current
      // fold state, with no perspective divergence between panels.
      r.projection = 'ortho';
      r.orthoHalfHeight = 1.32;
      r.setCreaseLook('pattern');
      r.camera.yaw = -Math.PI / 2;
      r.camera.elevation = 89.9 * (Math.PI / 180);
      r.camera.distance = 5;
      r.camera.target = { x: 0, y: 0, z: 0 };
    } else {
      r.projection = 'perspective';
      r.setCreaseLook('seam');
      r.resetCamera();
    }
    this.syncCameraHud();
  }

  private syncCameraHud(): void {
    const g = q<SVGSVGElement>(this.root, '[data-gizmo]');
    const r = this.renderer;
    if (!g || !r) return;
    const yaw = r.camera.yaw;
    const el = r.camera.elevation;
    // Project the three world axes onto the screen plane for a compact gizmo.
    const axes: [string, number, number, number, string][] = [
      ['X', 1, 0, 0, '#e0705a'],
      ['Y', 0, 1, 0, '#6fc3a0'],
      ['Z', 0, 0, 1, '#5aa9e6'],
    ];
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const ce = Math.cos(el);
    const se = Math.sin(el);
    // Camera basis: forward = target - eye.
    const rightX = sy;
    const rightY = -cy;
    const upX = -se * cy;
    const upY = -se * sy;
    const upZ = ce;
    let svg = '';
    for (const [name, ax, ay, az, color] of axes) {
      const sx = ax * rightX + ay * rightY + az * 0;
      const syy = ax * upX + ay * upY + az * upZ;
      const len = 18;
      svg += `<line x1="0" y1="0" x2="${(sx * len).toFixed(1)}" y2="${(-syy * len).toFixed(1)}" stroke="${color}" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/>`;
      svg += `<circle cx="${(sx * len).toFixed(1)}" cy="${(-syy * len).toFixed(1)}" r="1.6" fill="${color}"/>`;
      svg += `<text x="${(sx * len * 1.32).toFixed(1)}" y="${(-syy * len * 1.32 + 3).toFixed(1)}" fill="${color}" font-size="7" text-anchor="middle" font-family="monospace">${name}</text>`;
    }
    g.innerHTML = svg;
  }

  private syncDoc(): void {
    if (!this.renderer) return;
    const topo = this.studio.topology;
    const tpl = this.studio.template;
    // The geometry buffers depend on the *vertex layout*, not just the face
    // count: moving a crease can split an edge or weld it without changing the
    // number of faces. Tie the key to the counts and the crease signature.
    const key = [
      topo.faces.length,
      topo.hingeEdges.length,
      tpl.totalVertexCount,
      tpl.totalIndexCount,
      topo.half,
      topo.creases.map((c) => `${c.id}/${c.type}/${c.adjusted ? 1 : 0}/${c.points.length}`).join(','),
    ].join(':');
    if (key !== this.lastTopologyKey) {
      this.lastTopologyKey = key;
      this.renderer.setGeometry(this.studio.buffers, topo);
    }
    const m = this.studio.doc.material;
    const mk = `${m.tint}:${m.translucency}:${m.azimuth}:${m.elevation}:${m.fiber}:${m.ambient}`;
    if (mk !== this.lastMaterialKey) {
      this.lastMaterialKey = mk;
      this.renderer.setMaterial(m);
    }
    this.scheduleRender();
  }

  /**
   * The viewport keeps a steady animation loop while mounted. It only re-solves
   * and re-submits when something is dirty, so an idle editor costs a cleared
   * rAF callback, while the loop keeps the frame-time readout meaningful and
   * makes playback and scrubbing need no scheduling bookkeeping.
   */
  private scheduleRender(): void {
    if (this.disposed) return;
    this.dirty = true;
  }

  private startLoop(): void {
    if (this.rafId) return;
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      const r = this.renderer;
      if (!r) return;
      if (this.dirty || this.studio.playing) {
        this.dirty = false;
        this.frame();
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private dirty = true;

  private lastPresent = 0;

  private frame(): void {
    const r = this.renderer;
    if (this.disposed || !r || !this.studio.topology) return;

    const t0 = performance.now();
    // Real frame interval: time since the previous presented frame, which is
    // what the user actually experiences. Gaps longer than a fifth of a second
    // are idle periods (the loop is demand-driven), not slow frames, so they
    // are not counted against the rate.
    const interval = t0 - this.lastPresent;
    if (this.lastPresent > 0 && interval < 200) this.studio.noteFrame(interval);
    this.lastPresent = t0;

    // Re-solve for the current time; playback and scrubbing both arrive here.
    // In flat mode every crease is forced to 0°, giving the orthographic
    // crease-pattern view that matches the modelling canvas.
    const angles =
      this.studio.mode === 'flat'
        ? new Map(this.studio.topology.creases.map((c) => [c.id, 0]))
        : sampleAngles(this.studio.curve, this.studio.time);
    const tf = solveFold(this.studio.topology, angles);
    assembleMesh(this.studio.template, tf, this.studio.buffers);
    r.updateGeometry(this.studio.buffers.positions, this.studio.buffers.normals);
    r.render();

    this.paintStats();
  }

  private paintStats(): void {
    const fps = q<HTMLElement>(this.root, '[data-stat-fps]');
    const tri = q<HTMLElement>(this.root, '[data-stat-tri]');
    // Only the active playback rate is meaningful: the viewport is on-demand,
    // so an idle frame rate says nothing about rendering performance.
    if (fps) fps.textContent = this.studio.playing ? Math.round(this.studio.fps).toString() : '—';
    if (tri) tri.textContent = Math.round(this.studio.template.totalIndexCount / 3).toString();
  }

  private cssW = 0;
  private cssH = 0;

  private resize(): void {
    if (this.disposed || !this.renderer || this.resizing) return;
    this.resizing = true;
    const rect = this.getBoundingClientRect();
    this.cssW = rect.width;
    this.cssH = rect.height;
    this.renderer.resize(Math.max(1, rect.width), Math.max(1, rect.height), window.devicePixelRatio || 1);
    this.resizing = false;
    this.scheduleRender();
  }

  private setupCameraInput(): void {
    const c = this.canvas;
    if (!c) return;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this);
    this.onCleanup(() => ro.disconnect());
    // Same reasoning as the 2D canvases: don't rely on the observer alone.
    const poll = () => {
      if (this.disposed || !this.renderer) return;
      const rect = this.getBoundingClientRect();
      if (Math.abs(rect.width - this.cssW) > 0.5 || Math.abs(rect.height - this.cssH) > 0.5) {
        this.resize();
      }
    };
    const pollId = window.setInterval(poll, 400);
    this.onCleanup(() => window.clearInterval(pollId));
    const onWinResize = () => this.resize();
    window.addEventListener('resize', onWinResize);
    this.onCleanup(() => window.removeEventListener('resize', onWinResize));

    c.addEventListener('pointerdown', (e) => {
      if (!this.renderer) return;
      this.pointer.active = true;
      this.pointer.id = e.pointerId;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.mode = e.button === 1 || e.shiftKey || e.ctrlKey ? 'pan' : 'orbit';
      c.setPointerCapture(e.pointerId);
      c.style.cursor = 'grabbing';
    });

    c.addEventListener('pointermove', (e) => {
      if (!this.pointer.active || e.pointerId !== this.pointer.id || !this.renderer) return;
      const dx = e.clientX - this.pointer.x;
      const dy = e.clientY - this.pointer.y;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (this.pointer.mode === 'orbit') this.renderer.orbit(dx, dy);
      else this.renderer.pan(dx, dy);
      this.syncCameraHud();
      this.scheduleRender();
    });

    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointer.id) return;
      this.pointer.active = false;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      c.style.cursor = '';
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.renderer?.zoom(e.deltaY);
        this.scheduleRender();
      },
      { passive: false },
    );

    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

export function registerViewport(): void {
  if (!customElements.get(Viewport3D.tagName)) {
    customElements.define(Viewport3D.tagName, Viewport3D);
  }
}
