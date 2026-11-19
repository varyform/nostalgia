// 2D drawing helpers for a 3D game's HUD and screens (`@nostalgia/gl/ui`), on the transparent
// canvas over the GL one, in a 1920 × 1080 reference frame scaled to the canvas: Saira text,
// panels, polylines, prompts with the active device's glyphs, word wrap.
//
//   const ui = createUI(ctx);  ui.scale(canvasHeight / H);  ui.ref();
//   ui.text('ALT 120', 80, 60, 28, COL.green, { align: 'left', wgt: 700, sp: 2 });
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs, type Input } from '@nostalgia/input';

/** the reference frame */
export const W = 1920,
  H = 1080;
/** the HUD font stack */
export const F = "'Saira','Bahnschrift','DIN Alternate','Arial Narrow',system-ui,sans-serif";
/** a HUD palette */
export const COL = {
  green: '#8af7a4',
  greenDim: 'rgba(138,247,164,0.45)',
  amber: '#ffc04f',
  red: '#ff5a4a',
  ink: '#e8eff3',
  dim: 'rgba(232,239,243,0.6)',
  faint: 'rgba(232,239,243,0.3)',
  cyan: '#86d9ff',
  panel: 'rgba(7,13,20,0.8)',
  edge: 'rgba(134,217,255,0.35)',
  blue: '#5aa8ff',
};

export interface TextOptions {
  align?: CanvasTextAlign;
  wgt?: number;
  sp?: number;
  base?: CanvasTextBaseline;
}
export interface PanelOptions {
  fill?: string;
  edge?: string | null;
  r?: number;
  lw?: number;
}

export interface UI {
  g: CanvasRenderingContext2D;
  /** reference units → canvas pixels */
  readonly u: number;
  /** set the scale (canvas height / H) and apply it */
  scale(s: number): void;
  /** (re)apply the reference transform */
  ref(): void;
  font(size: number, wgt?: number): void;
  spacing(s: number): void;
  text(s: string, x: number, y: number, size: number, col: string, o?: TextOptions): void;
  width(s: string, size: number, wgt?: number, sp?: number): number;
  /** lines of s (with \n paragraphs) no wider than maxW */
  wrap(s: string, maxW: number, size: number, wgt?: number): string[];
  panel(x: number, y: number, w: number, h: number, o?: PanelOptions): void;
  /** a polyline [x0, y0, x1, y1, …] */
  line(pts: number[], col: string, lw?: number, dash?: number[] | null): void;
  /** a prompt with {action} glyphs; returns its width */
  prompt(
    input: Input,
    s: string,
    x: number,
    y: number,
    size: number,
    col: string,
    align?: 'left' | 'center' | 'right',
    wgt?: number,
  ): number;
  /** a row of [action, label] pairs centred on cx */
  legend(input: Input, row: [string, string][], cx: number, y: number, size?: number): void;
}

/** a UI on a 2D context; `font` is the font stack for text, prompts and legends (F) */
export function createUI(g: CanvasRenderingContext2D, { font = F }: { font?: string } = {}): UI {
  let u = 1;
  const ui: UI = {
    g,
    get u() {
      return u;
    },
    scale(s) {
      u = s;
      ui.ref();
    },
    ref() {
      g.setTransform(u, 0, 0, u, 0, 0);
    },
    font(size, wgt = 600) {
      g.font = `${wgt} ${size}px ${font}`;
    },
    spacing(s) {
      if ('letterSpacing' in g) g.letterSpacing = `${s}px`;
    },
    text(s, x, y, size, col, { align = 'left', wgt = 600, sp = 0, base = 'alphabetic' } = {}) {
      ui.font(size, wgt);
      g.fillStyle = col;
      g.textAlign = align;
      g.textBaseline = base;
      ui.spacing(sp);
      g.fillText(s, x, y);
      ui.spacing(0);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
    },
    width(s, size, wgt = 600, sp = 0) {
      ui.font(size, wgt);
      ui.spacing(sp);
      const w = g.measureText(s).width;
      ui.spacing(0);
      return w;
    },
    wrap(s, maxW, size, wgt = 500) {
      ui.font(size, wgt);
      const out: string[] = [];
      for (const para of String(s).split('\n')) {
        let line = '';
        for (const word of para.split(' ')) {
          const t = line ? line + ' ' + word : word;
          if (g.measureText(t).width > maxW && line) {
            out.push(line);
            line = word;
          } else line = t;
        }
        out.push(line);
      }
      return out;
    },
    panel(x, y, w, h, { fill = COL.panel, edge = COL.edge, r = 6, lw = 2 } = {}) {
      g.beginPath();
      g.roundRect(x, y, w, h, r);
      g.fillStyle = fill;
      g.fill();
      if (edge) {
        g.strokeStyle = edge;
        g.lineWidth = lw;
        g.stroke();
      }
    },
    line(pts, col, lw = 2, dash = null) {
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.strokeStyle = col;
      g.lineWidth = lw;
      if (dash) g.setLineDash(dash);
      g.stroke();
      if (dash) g.setLineDash([]);
    },
    prompt(input, s, x, y, size, col, align = 'left', wgt = 600) {
      return drawPrompt(g, input, s, x, y, {
        font: `${wgt} ${size}px ${font}`,
        size: size * 1.25,
        color: col,
        align,
        letterSpacing: 1.5,
        style: { font },
      });
    },
    legend(input, row, cx, y, size = 22) {
      const gs = size * 1.25,
        gap = 5,
        colGap = 34,
        inner = 9,
        st = { font };
      const parts = row.map(([a, l]) => ({ list: glyphs(input, a), l, gw: 0, lw: 0 }));
      for (const p of parts) {
        p.gw = measureGlyphs(g, p.list, gs, st, gap);
        p.lw = ui.width(p.l, size, 500, 1);
      }
      let x = cx - (parts.reduce((w, p) => w + p.gw + inner + p.lw, 0) + colGap * (parts.length - 1)) / 2;
      for (const p of parts) {
        drawGlyphs(g, p.list, x, y, gs, st, gap);
        ui.text(p.l, x + p.gw + inner, y + size * 0.36, size, COL.dim, { wgt: 500, sp: 1 });
        x += p.gw + inner + p.lw + colGap;
      }
    },
  };
  return ui;
}
/** a whole number with thousands separators, never negative: 12,400 */
export const fmt = (n: number): string => Math.max(0, Math.round(n)).toLocaleString('en-US');
