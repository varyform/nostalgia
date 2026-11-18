// Text, panels and key prompts in the reference frame, shared by the HUD and the screens.
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';

export const F = "'Chakra Petch','Trebuchet MS',system-ui,sans-serif";
export const TAU = Math.PI * 2;
export const money = n => '$' + Math.round(n).toLocaleString('en-US');

export function createUi(g) {
  const font = (size, wgt = 600) => { g.font = `${wgt} ${size}px ${F}`; };
  const spacing = px => { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; };
  function label(s, x, y, size, col, wgt = 600, align = 'left', sp = 0) {
    font(size, wgt); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic';
    spacing(sp); g.fillText(s, x, y); spacing(0);
    g.textAlign = 'left';
  }
  function outlined(s, x, y, size, col, line = '#0a0612', lw = 8, align = 'center', sp = 0) {
    font(size, 700); g.textAlign = align; g.lineJoin = 'round'; spacing(sp);
    g.strokeStyle = line; g.lineWidth = lw; g.strokeText(s, x, y);
    g.fillStyle = col; g.fillText(s, x, y);
    spacing(0); g.textAlign = 'left';
  }
  function width(s, size, wgt = 600, sp = 0) {
    font(size, wgt); spacing(sp);
    const w = g.measureText(s).width;
    spacing(0);
    return w;
  }
  /** Shrink text to fit a width. */
  function fit(s, x, y, size, col, maxW, wgt = 600, align = 'left', sp = 0) {
    let sz = size;
    while (sz > 10 && width(s, sz, wgt, sp) > maxW) sz -= 1;
    label(s, x, y, sz, col, wgt, align, sp);
  }
  function wrap(s, x, y, size, col, maxW, lh, wgt = 500, maxLines = 4) {
    font(size, wgt);
    const words = s.split(' ');
    let line = '', n = 0;
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { label(line, x, y + n * lh, size, col, wgt); line = w; if (++n >= maxLines) return; }
      else line = t;
    }
    if (line) label(line, x, y + n * lh, size, col, wgt);
  }
  function panel(x, y, w, h, r = 22, a = 0.72, edge = 'rgba(255,255,255,0.16)') {
    g.fillStyle = `rgba(8,6,16,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    g.strokeStyle = edge; g.lineWidth = 2; g.stroke();
  }
  function chip(x, y, w, h, on, col = '#ffd27a', r = 14) {
    g.fillStyle = on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    g.strokeStyle = on ? col : 'rgba(255,255,255,0.14)'; g.lineWidth = on ? 3 : 1.5; g.stroke();
  }
  const GST = { font: F };
  const prompt = (input, s, x, y, size, col, align = 'left', wgt = 600) =>
    drawPrompt(g, input, s, x, y, { font: `${wgt} ${size}px ${F}`, size: size * 1.25, color: col, align, letterSpacing: 1, style: GST });
  /** Rows of [action, label] pairs, centred at cx. */
  function legend(input, rows, cx, y, pitch = 44, size = 22) {
    const gs = size * 1.25, gap = 6, gw = [], lw = [];
    for (const r of rows) r.forEach(([a, l], k) => { gw[k] = Math.max(gw[k] || 0, measureGlyphs(g, glyphs(input, a), gs, GST, gap)); lw[k] = Math.max(lw[k] || 0, width(l, size, 600, 1)); });
    const colGap = 36, inner = 10;
    const total = gw.reduce((w, x, k) => w + (k ? colGap : 0) + x + inner + lw[k], 0);
    rows.forEach((r, i) => {
      let x = cx - total / 2;
      const yc = y + i * pitch;
      r.forEach(([a, l], k) => {
        const list = glyphs(input, a);
        drawGlyphs(g, list, x + gw[k] - measureGlyphs(g, list, gs, GST, gap), yc, gs, GST, gap);
        label(l, x + gw[k] + inner, yc + size * 0.36, size, 'rgba(255,255,255,0.85)', 600, 'left', 1);
        x += gw[k] + inner + lw[k] + colGap;
      });
    });
  }
  const shade = a => { g.fillStyle = `rgba(4,2,10,${a})`; g.fillRect(0, 0, 1920, 1080); };
  return { font, label, outlined, width, fit, wrap, panel, chip, prompt, legend, shade };
}
