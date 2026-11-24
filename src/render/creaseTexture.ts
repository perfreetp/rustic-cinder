import { CanvasSource, Texture } from 'pixi.js';
import type { Topology } from '../core/types';

/**
 * Builds the sheet-space crease texture.
 *
 * The texture is a single-channel bitmap on the same [-half, half]² square as
 * the sheet, sampled with the paper's own UV. Two looks share the channel:
 *
 *  - "seam" — soft grey bands, used in the solid view so folds read as creases
 *    in a physical sheet rather than a wireframe;
 *  - "pattern" — crisp black lines with mountain (dash-dot) and valley (solid)
 *    conventions, used in the orthographic crease-pattern view.
 *
 * Whichever look is active, the shader only needs one sample per pixel, so the
 * cost is constant and no geometry is added.
 */

const RES = 1024;

export type CreaseLook = 'seam' | 'pattern';

export interface CreaseTextureResult {
  texture: Texture;
  destroy: () => void;
}

export function buildCreaseTexture(topology: Topology, look: CreaseLook = 'seam'): CreaseTextureResult {
  const canvas = document.createElement('canvas');
  canvas.width = RES;
  canvas.height = RES;
  const ctx = canvas.getContext('2d')!;

  // 1.0 = clean paper (the shader reads `1 - r` as seam strength).
  ctx.fillStyle = 'rgb(255,255,255)';
  ctx.fillRect(0, 0, RES, RES);

  const half = topology.half;
  const toPx = (v: number) => ((v + half) / (2 * half)) * RES;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const pattern = look === 'pattern';

  for (const rc of topology.creases) {
    if (rc.points.length < 2) continue;
    const mountain = rc.type === 'mountain';

    for (let i = 0; i + 1 < rc.points.length; i++) {
      const p = rc.points[i];
      const q = rc.points[i + 1];
      const x0 = toPx(p.x);
      const y0 = toPx(p.y);
      const x1 = toPx(q.x);
      const y1 = toPx(q.y);

      if (pattern) {
        // Hand-drawn crease conventions: solid valleys, dash-dot mountains.
        ctx.save();
        ctx.strokeStyle = mountain ? 'rgb(20,20,20)' : 'rgb(30,30,30)';
        ctx.lineWidth = Math.max(2, 0.006 * RES);
        if (mountain) {
          ctx.setLineDash([16, 7, 3, 7]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.restore();
      } else {
        // Two soft bands make a plausible crease indentation.
        ctx.strokeStyle = 'rgba(150,150,150,0.42)';
        ctx.lineWidth = 0.010 * RES;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(96,96,96,0.46)';
        ctx.lineWidth = 0.004 * RES;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
  }

  // Paper edge: a hairline in pattern mode so the sheet boundary reads.
  ctx.save();
  if (pattern) {
    ctx.strokeStyle = 'rgba(30,30,30,0.85)';
    ctx.lineWidth = Math.max(2, 0.005 * RES);
  } else {
    ctx.strokeStyle = 'rgba(205,205,205,0.55)';
    ctx.lineWidth = 0.003 * RES;
  }
  ctx.setLineDash([]);
  ctx.strokeRect(1, 1, RES - 2, RES - 2);
  ctx.restore();


  const source = new CanvasSource({
    resource: canvas,
    scaleMode: 'linear',
    addressMode: 'clamp-to-edge',
    autoDensity: false,
    resolution: 1,
    label: 'crease-field',
  });
  const texture = new Texture({ source });

  return {
    texture,
    destroy: () => {
      texture.destroy(true);
    },
  };
}
