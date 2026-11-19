// 2D drawing helpers for the HUD and the screens, in a 1920 × 1080 reference frame scaled to
// the canvas: Saira text, panels, prompts with the active device's glyphs, word wrap.
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';

export const W = 1920, H = 1080;
export const F = "'Saira','Bahnschrift','DIN Alternate','Arial Narrow',system-ui,sans-serif";
export const COL = {
  green: '#8af7a4', greenDim: 'rgba(138,247,164,0.45)', amber: '#ffc04f', red: '#ff5a4a', ink: '#e8eff3', dim: 'rgba(232,239,243,0.6)',
  faint: 'rgba(232,239,243,0.3)', cyan: '#86d9ff', panel: 'rgba(7,13,20,0.8)', edge: 'rgba(134,217,255,0.35)', blue: '#5aa8ff',
};

export function createUI(g) {
  let u = 1;
  const ui = {
    g,
    get u() { return u; },
    scale(s) { u = s; ui.ref(); },
    ref() { g.setTransform(u, 0, 0, u, 0, 0); },
    font(size, wgt = 600) { g.font = `${wgt} ${size}px ${F}`; },
    spacing(s) { if ('letterSpacing' in g) g.letterSpacing = s + 'px'; },
    text(s, x, y, size, col, { align = 'left', wgt = 600, sp = 0, base = 'alphabetic' } = {}) {
      ui.font(size, wgt); g.fillStyle = col; g.textAlign = align; g.textBaseline = base; ui.spacing(sp);
      g.fillText(s, x, y); ui.spacing(0); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    },
    width(s, size, wgt = 600, sp = 0) { ui.font(size, wgt); ui.spacing(sp); const w = g.measureText(s).width; ui.spacing(0); return w; },
    wrap(s, maxW, size, wgt = 500) {
      ui.font(size, wgt);
      const out = [];
      for (const para of String(s).split('\n')) {
        let line = '';
        for (const word of para.split(' ')) {
          const t = line ? line + ' ' + word : word;
          if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
        }
        out.push(line);
      }
      return out;
    },
    panel(x, y, w, h, { fill = COL.panel, edge = COL.edge, r = 6, lw = 2 } = {}) {
      g.beginPath(); g.roundRect(x, y, w, h, r);
      g.fillStyle = fill; g.fill();
      if (edge) { g.strokeStyle = edge; g.lineWidth = lw; g.stroke(); }
    },
    line(pts, col, lw = 2, dash = null) {
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.strokeStyle = col; g.lineWidth = lw;
      if (dash) g.setLineDash(dash);
      g.stroke();
      if (dash) g.setLineDash([]);
    },
    prompt(input, s, x, y, size, col, align = 'left', wgt = 600) {
      return drawPrompt(g, input, s, x, y, { font: `${wgt} ${size}px ${F}`, size: size * 1.25, color: col, align, letterSpacing: 1.5, style: { font: F } });
    },
    /** a row of [action, label] pairs centred on cx */
    legend(input, row, cx, y, size = 22) {
      const gs = size * 1.25, gap = 5, colGap = 34, inner = 9, st = { font: F };
      const parts = row.map(([a, l]) => ({ list: glyphs(input, a), l }));
      for (const p of parts) { p.gw = measureGlyphs(g, p.list, gs, st, gap); p.lw = ui.width(p.l, size, 500, 1); }
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
export const fmt = n => Math.max(0, Math.round(n)).toLocaleString('en-US');
