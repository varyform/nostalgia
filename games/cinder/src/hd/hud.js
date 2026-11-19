// Text, panels and the play HUD: Wren's flames at the bottom left, the engaged foe's at the
// bottom right, the score and lives, the scene's name card as it begins, the touch buttons.
// `ui` is the renderer's shared state: { g, cw, ch, u } (u = ch / 1080).
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';
import { layout as touchLayout } from '../touch.js';
import { TAU, alpha, clamp, mix } from './scenery.js';

export const HEAD = "'Marcellus SC','Cinzel',Georgia,serif";
export const BODY = "'Nunito','Trebuchet MS',system-ui,sans-serif";
export const INK = '#fbf3e4', DIM = 'rgba(244,232,214,0.68)', EMBER = '#ff9a44', GOLD = '#f2c46a', RED = '#ff5a3c';
export const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const KIND_NAME = { footman: 'KEEP FOOTMAN', brawler: 'KEEP BRAWLER', adept: 'KEEP ADEPT', regent: 'THE ASH REGENT' };

export function label(ui, s, x, y, size, col, { font = BODY, wgt = 800, align = 'left', spacing = 0, shadow = false } = {}) {
  const { g, u } = ui;
  g.font = `${font === HEAD ? 400 : wgt} ${Math.round(size * u)}px ${font}`;
  g.textAlign = align; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
  if (shadow) { g.fillStyle = 'rgba(10,4,2,0.6)'; g.fillText(s, x + 2 * u, y + 3 * u); }
  g.fillStyle = col; g.fillText(s, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.textAlign = 'left';
}
const GST = { font: BODY };
export const prompt = (ui, input, s, x, y, size, col, align = 'center') =>
  drawPrompt(ui.g, input, s, x, y, { font: `700 ${Math.round(size * ui.u)}px ${BODY}`, size: size * 1.35 * ui.u, color: col, align, letterSpacing: 1 * ui.u, style: GST });
/** rows of [action, words] pairs, centred on x0 */
export function legend(ui, input, rows, x0, y, size = 21) {
  const { g, u } = ui, gs = size * 1.3 * u, gap = 6 * u;
  rows.forEach((r, i) => {
    let w = 0;
    const parts = r.map(([a, l]) => { const list = glyphs(input, a); g.font = `700 ${Math.round(size * u)}px ${BODY}`; const lw = g.measureText(l).width, gw = measureGlyphs(g, list, gs, GST, gap); w += gw + 10 * u + lw; return { list, l, lw, gw }; });
    w += (parts.length - 1) * 30 * u;
    let x = x0 - w / 2;
    const yc = y + i * 44 * u;
    for (const p of parts) {
      drawGlyphs(g, p.list, x, yc, gs, GST, gap);
      label(ui, p.l, x + p.gw + 10 * u, yc + size * 0.36 * u, size, DIM, { wgt: 700 });
      x += p.gw + 10 * u + p.lw + 30 * u;
    }
  });
}
/** a lacquered panel: dark, a thin gold rule inside the edge */
export function panel(ui, x, y, w, h, a = 0.62) {
  const { g, u } = ui;
  g.fillStyle = `rgba(14,6,4,${a})`; g.beginPath(); g.roundRect(x, y, w, h, 10 * u); g.fill();
  g.strokeStyle = 'rgba(242,196,106,0.28)'; g.lineWidth = 2 * u; g.beginPath(); g.roundRect(x + 8 * u, y + 8 * u, w - 16 * u, h - 16 * u, 6 * u); g.stroke();
}
export const shade = (ui, a, col = '8,3,2') => { ui.g.fillStyle = `rgba(${col},${a})`; ui.g.fillRect(0, 0, ui.cw, ui.ch); };
/** a brush stroke of ink behind a title: a wide band with ragged, tapering ends */
export function brush(ui, x, y, w, h, col = 'rgba(10,4,2,0.72)', seed = 1) {
  const { g } = ui;
  g.fillStyle = col;
  g.beginPath();
  const n = 24;
  for (let i = 0; i <= n; i++) { const q = i / n, taper = Math.sin(q * Math.PI) ** 0.35, j = Math.sin(q * 37 + seed) * 0.08 + Math.sin(q * 91 + seed * 3) * 0.05; g.lineTo(x - w / 2 + q * w, y - h / 2 * taper * (1 + j)); }
  for (let i = n; i >= 0; i--) { const q = i / n, taper = Math.sin(q * Math.PI) ** 0.5, j = Math.sin(q * 53 + seed * 2) * 0.1; g.lineTo(x - w / 2 + q * w + h * 0.1, y + h / 2 * taper * (1 + j)); }
  g.closePath(); g.fill();
}

// ---------- the pips: little flames ----------
// a flame standing on (x, y), h tall; lit flickers, spent is a dim ember
export function flame(ui, x, y, h, lit, t, k, cols = ['#fff2b0', '#ffb040', '#e8441c']) {
  const { g } = ui;
  if (!lit) {
    g.fillStyle = 'rgba(120,100,90,0.45)'; g.beginPath(); g.ellipse(x, y - h * 0.18, h * 0.16, h * 0.13, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,120,60,0.25)'; g.beginPath(); g.arc(x, y - h * 0.18, h * 0.06, 0, TAU); g.fill();
    return;
  }
  const f = 1 + Math.sin(t * 11 + k * 1.7) * 0.06 + Math.sin(t * 23 + k) * 0.04, sw = Math.sin(t * 7 + k * 2.3) * h * 0.06, H = h * f;
  const gl = g.createRadialGradient(x, y - H * 0.35, 0, x, y - H * 0.35, H * 0.8);
  gl.addColorStop(0, alpha(cols[1], 0.35)); gl.addColorStop(1, alpha(cols[1], 0));
  g.fillStyle = gl; g.fillRect(x - H, y - H * 1.2, H * 2, H * 1.6);
  const tear = (s, c) => {
    g.fillStyle = c; g.beginPath();
    g.moveTo(x + sw * s, y - H * s);
    g.bezierCurveTo(x + H * 0.32 * s, y - H * 0.55 * s, x + H * 0.3 * s, y - H * 0.08, x, y - H * 0.02);
    g.bezierCurveTo(x - H * 0.3 * s, y - H * 0.08, x - H * 0.32 * s, y - H * 0.55 * s, x + sw * s, y - H * s);
    g.fill();
  };
  tear(1, cols[2]); tear(0.72, cols[1]); tear(0.42, cols[0]);
}
const FOE_FLAME = { regent: ['#ffe0a0', '#ff6a2a', '#a8180c'], other: ['#ffffff', '#b8d2ea', '#5a6e8a'] };
function pips(ui, x, y, n, of, dir, t, cols, glow = 0) {
  const { u } = ui, k0 = of > 12 ? 0.7 : 1, h = 40 * u * k0, gap = 34 * u * k0; // the Regent's long row, smaller
  for (let k = 0; k < of; k++) flame(ui, x + dir * k * gap, y, h * (k < n && glow > 0 ? 1 + glow * 0.4 * Math.max(0, Math.sin(t * 10 - k)) : 1), k < n, t, k, cols);
}

export function drawHud(ui, app, s, t, fx) {
  const { g, cw, ch, u } = ui;
  // a soft floor of shade under the pips, so they read on any floor
  const sg = g.createLinearGradient(0, ch - 150 * u, 0, ch);
  sg.addColorStop(0, 'rgba(6,2,1,0)'); sg.addColorStop(1, 'rgba(6,2,1,0.55)');
  g.fillStyle = sg; g.fillRect(0, ch - 150 * u, cw, 150 * u);
  const h = s.hero;
  label(ui, 'WREN', 48 * u, ch - 92 * u, 20, DIM, { font: HEAD, spacing: 4 });
  pips(ui, 62 * u, ch - 34 * u, h.hp, h.maxHp, 1, t, undefined, fx.regen);
  const e = s.engaged;
  if (e && e.active) {
    // bottom right, or under the lives while the touch buttons fill that corner
    const y = app.touch?.active ? 190 * u : ch - 34 * u;
    label(ui, KIND_NAME[e.kind] ?? 'KEEP GUARD', cw - 48 * u, y - 58 * u, 20, DIM, { font: HEAD, spacing: 4, align: 'right' });
    pips(ui, cw - 62 * u, y, Math.max(0, e.hp), e.maxHp, -1, t, e.kind === 'regent' ? FOE_FLAME.regent : FOE_FLAME.other);
  }
  // the score, and the lanterns that are Wren's lives
  label(ui, 'SCORE', 48 * u, 50 * u, 16, DIM, { spacing: 4 });
  label(ui, pad6(s.score), 48 * u, 92 * u, 36, INK, { spacing: 3, shadow: true });
  label(ui, 'HI ' + pad6(app.hi ?? 0), cw - 48 * u, 50 * u, 16, DIM, { spacing: 3, align: 'right' });
  for (let k = 0; k < Math.min(6, s.lives); k++) lantern(ui, cw - 62 * u - k * 46 * u, 82 * u, 13 * u, t, k);
}
// a small paper lantern (a life)
export function lantern(ui, x, y, r, t, k) {
  const { g } = ui, f = 0.85 + Math.sin(t * 8 + k * 2) * 0.1;
  g.fillStyle = `rgba(255,150,60,${0.22 * f})`; g.beginPath(); g.arc(x, y, r * 2.1, 0, TAU); g.fill();
  g.fillStyle = '#2a120a'; g.fillRect(x - r * 0.5, y - r * 1.45, r, r * 0.3); g.fillRect(x - r * 0.5, y + r * 1.15, r, r * 0.3);
  g.fillStyle = mix('#ff8a30', '#ffe0a0', f - 0.75); g.beginPath(); g.ellipse(x, y, r * 0.95, r * 1.2, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(120,40,10,0.5)'; g.lineWidth = Math.max(1, r * 0.1); g.beginPath(); g.moveTo(x - r * 0.9, y); g.lineTo(x + r * 0.9, y); g.stroke();
}
/** the scene's name as it begins: a numeral, the name over a stroke of ink */
export function nameCard(ui, n, name, a) {
  if (a <= 0) return;
  const { g, cw, ch, u } = ui;
  g.globalAlpha = clamp(a, 0, 1);
  brush(ui, cw / 2, ch * 0.3, 1000 * u, 150 * u, 'rgba(10,4,2,0.7)', n);
  label(ui, `SCENE ${ROMAN[n] ?? n + 1}`, cw / 2, ch * 0.3 - 34 * u, 22, EMBER, { font: HEAD, align: 'center', spacing: 8 });
  label(ui, name, cw / 2, ch * 0.3 + 34 * u, 64, INK, { font: HEAD, align: 'center', spacing: 3, shadow: true });
  g.fillStyle = EMBER; g.fillRect(cw / 2 - 140 * u * a, ch * 0.3 + 52 * u, 280 * u * a, 3 * u);
  g.globalAlpha = 1;
}
export function banner(ui, title, sub, a, col = INK) {
  if (a <= 0) return;
  const { g, cw, ch, u } = ui;
  g.globalAlpha = clamp(a, 0, 1);
  brush(ui, cw / 2, ch * 0.36, 1100 * u, 190 * u, 'rgba(10,4,2,0.72)', title.length);
  label(ui, title, cw / 2, ch * 0.36 + 24 * u, 80, col, { font: HEAD, align: 'center', spacing: 6, shadow: true });
  if (sub) label(ui, sub, cw / 2, ch * 0.36 + 100 * u, 28, INK, { align: 'center', spacing: 2, shadow: true });
  g.globalAlpha = 1;
}

// ---------- touch ----------
export function drawTouch(ui, app) {
  const T = app.touch, { g, cw, ch } = ui;
  if (!T?.active || app.state !== 'play') return;
  const L = touchLayout(cw, ch), lu = L.u ?? ui.u;
  g.lineWidth = 3 * lu;
  if (T.stick) {
    g.fillStyle = 'rgba(255,240,220,0.08)'; g.strokeStyle = 'rgba(255,240,220,0.3)';
    g.beginPath(); g.arc(T.stick.x0, T.stick.y0, L.stickR, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,240,220,0.4)'; g.beginPath(); g.arc(T.stick.x, T.stick.y, L.stickR * 0.4, 0, TAU); g.fill();
  }
  // the four buttons, lit while a finger holds them
  for (const b of L.buttons ?? []) {
    const on = !!(T.held?.[b.a] ?? T[b.a]);
    g.fillStyle = on ? 'rgba(255,154,68,0.38)' : 'rgba(255,240,220,0.1)'; g.strokeStyle = 'rgba(255,240,220,0.35)';
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill(); g.stroke();
    g.font = `400 ${Math.round(Math.min(26 * lu, b.r * 0.3))}px ${HEAD}`; g.textAlign = 'center'; g.fillStyle = INK;
    g.fillText(b.label ?? b.a.toUpperCase(), b.x, b.y + Math.min(26 * lu, b.r * 0.3) * 0.35); g.textAlign = 'left';
  }
  if (L.pause) {
    g.fillStyle = 'rgba(255,240,220,0.1)'; g.beginPath(); g.arc(L.pause.x, L.pause.y, L.pause.r, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = INK; g.fillRect(L.pause.x - 12 * lu, L.pause.y - 15 * lu, 8 * lu, 30 * lu); g.fillRect(L.pause.x + 4 * lu, L.pause.y - 15 * lu, 8 * lu, 30 * lu);
  }
}
