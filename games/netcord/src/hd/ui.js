// Drawing kit for Netcord's screens, in the look of 90s TV tennis graphics: deep green caption
// panels with a white hairline and a ball-yellow tab, purple title bars with a white slanted
// tab, slanted straps for entries, a floodlit court behind it all, "Barlow Semi Condensed" for
// every word ("Righteous" for the logo only). Everything works in the 1920 × 1080 space the
// renderer scales the context to. Whatever can be tapped records its rectangle as it is drawn
// (hot), so hitAt() answers with what the screen showed there.
import { drawPrompt } from '@nostalgia/input';
import { NATIONS } from '../players.js';

export const W = 1920, H = 1080, TAU = Math.PI * 2;
export const FONT = "'Barlow Semi Condensed','Arial Narrow',sans-serif";
export const LOGO = "'Righteous','Arial Black',Impact,sans-serif";
export const COL = {
  green: '#0b3d2e', green2: '#11563f', green3: '#1b6b50', deep: '#06261c',
  purple: '#3b1f6b', purple2: '#5a33a0', lilac: '#b79cff',
  white: '#f6f7f2', dim: 'rgba(246,247,242,0.66)', faint: 'rgba(246,247,242,0.34)', ghost: 'rgba(246,247,242,0.1)',
  ball: '#e4f33a', ballD: '#b5c41c', red: '#ff6b6b', ok: '#7ee08f', up: '#7ee08f', down: '#ff6b6b', ink: '#0b2016', gold: '#f2c230',
};
export const SURFACE_TINT = { hard: '#2c5f9e', clay: '#c0623a', grass: '#4f8f3a', indoor: '#5b3a7a' };
export const clamp01 = v => Math.max(0, Math.min(1, v || 0));
export const ease = q => q * q * (3 - 2 * q);
export const blink = (t, hz = 2) => Math.floor(t * hz) % 2 === 0;
/** a colour with an alpha: #hex and rgb()/rgba() both taken (anything else comes back as it is) */
export function alpha(c, a) {
  if (typeof c !== 'string') return c;
  if (c[0] === '#') {
    const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1, 7), n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = /^rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(c.replace(/\s/g, ''));
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${a})` : c;
}
/** green ink or white, whichever reads on a colour */
export function inkOn(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#') return COL.white;
  const h = hex.slice(1), n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16);
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return l > 150 ? COL.ink : COL.white;
}
/** a hex colour lighter (k > 0) or darker (k < 0) */
export function shade(hex, k) {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex;
  const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1, 7), n = parseInt(h, 16);
  const f = v => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ---------- the tap map ----------
let rects = [], rectsFor = null;
export function beginHits(state) { rects = []; rectsFor = state; }
export const hot = (x, y, w, h, hit) => rects.push({ x, y, w, h, hit });
export function hitAt(state, x, y) {
  if (state !== rectsFor) return null;
  for (let k = rects.length - 1; k >= 0; k--) {
    const r = rects[k];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.hit;
  }
  return null;
}
/** for test harnesses: every text squeezed to fit, { s, w, max }, and the tap rectangles */
export const debug = { squeezed: [], hits: () => rects.slice() };

// ---------- type ----------
export function font(g, size, wgt = 700) { g.font = `${wgt} ${size}px ${FONT}`; }
export function measure(g, s, size, wgt = 700, spacing = 0) {
  font(g, size, wgt);
  if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
  const w = g.measureText(String(s)).width;
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  return w;
}
/** a line of text; `max` squeezes it to fit (and notes the squeeze for the test harness) */
export function text(g, s, x, y, size, col, { wgt = 700, align = 'left', spacing = 0, shadow = false, max = 0, face = FONT, italic = false } = {}) {
  s = String(s ?? '');
  g.font = `${italic ? 'italic ' : ''}${face === LOGO ? 400 : wgt} ${size}px ${face}`;
  g.textAlign = align; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
  if (max) {
    const w = g.measureText(s).width;
    if (w > max) debug.squeezed.push({ s, w: Math.round(w), max: Math.round(max) });
  }
  const fill = (dx, dy) => {
    if (max) g.fillText(s, x + dx, y + dy, max);
    else g.fillText(s, x + dx, y + dy);
  };
  if (shadow) { g.fillStyle = 'rgba(0,0,0,0.5)'; fill(2, 3); }
  g.fillStyle = col;
  fill(0, 0);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}
/** words broken into lines that fit w at this size */
export function wrap(g, s, size, w, wgt = 500) {
  font(g, size, wgt);
  const out = [];
  let line = '';
  for (const word of String(s).split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (line && g.measureText(next).width > w) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}
const PST = { font: FONT };
export function prompt(g, app, s, x, y, size, col = COL.dim, align = 'center') {
  if (!app.input) return;
  drawPrompt(g, app.input, s, x, y, { font: `700 ${size}px ${FONT}`, size: size * 1.25, color: col, align, letterSpacing: 1, style: PST });
}

// ---------- shapes ----------
export function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
/** a deep green caption panel: a glassy gradient, a white hairline on top, a yellow tab on the left */
export function panel(g, x, y, w, h, { a = 0.9, tab = true, edge = null, lw = 2, tint = null } = {}) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  if (tint === 'purple') { gr.addColorStop(0, `rgba(78,44,138,${a})`); gr.addColorStop(0.14, `rgba(55,30,102,${a})`); gr.addColorStop(1, `rgba(30,15,60,${a})`); }
  else { gr.addColorStop(0, `rgba(22,94,70,${a})`); gr.addColorStop(0.14, `rgba(12,64,47,${a})`); gr.addColorStop(1, `rgba(5,34,25,${a})`); }
  rr(g, x, y, w, h, 6);
  g.fillStyle = gr; g.fill();
  if (edge) { g.strokeStyle = edge; g.lineWidth = lw; g.stroke(); }
  g.fillStyle = 'rgba(246,247,242,0.4)'; g.fillRect(x + 6, y + 1, w - 12, 2);
  if (tab) { g.fillStyle = COL.ball; g.fillRect(x, y + 10, 6, Math.min(48, h - 20)); }
}
/** a slanted strap: a menu entry, a button; ball-yellow when picked */
export function strap(g, x, y, w, h, sel, t = 0, { col = COL.ball } = {}) {
  const k = h * 0.32;
  g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + w, y); g.lineTo(x + w - k, y + h); g.lineTo(x, y + h); g.closePath();
  if (sel) {
    const glow = 0.6 + Math.sin(t * 5) * 0.25;
    g.save();
    g.shadowColor = alpha(col, 0.5 * glow); g.shadowBlur = 24;
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#fbffc2'); gr.addColorStop(0.45, col); gr.addColorStop(1, COL.ballD);
    g.fillStyle = col === COL.ball ? gr : col; g.fill();
    g.restore();
    // a sheen running along it
    g.save(); g.clip();
    const sx = x - 200 + ((t * 420) % (w + 400));
    const sg = g.createLinearGradient(sx, 0, sx + 160, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.4)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg; g.fillRect(x, y, w, h);
    g.restore();
  } else {
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, 'rgba(27,107,80,0.94)'); gr.addColorStop(1, 'rgba(6,38,28,0.94)');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(246,247,242,0.2)'; g.lineWidth = 2; g.stroke();
  }
}
export function button(g, x, y, w, h, label, sel, t, hit, { size = 32, col, sub = null } = {}) {
  strap(g, x, y, w, h, sel, t, { col });
  const k = h * 0.32;
  text(g, label, x + w / 2, y + h / 2 + size * 0.36 - (sub ? 9 : 0), size, sel ? COL.ink : COL.white, { wgt: 800, align: 'center', spacing: 2, max: w - k * 2 - 16 });
  if (sub) text(g, sub, x + w / 2, y + h / 2 + 25, 21, sel ? 'rgba(11,32,22,0.72)' : COL.dim, { wgt: 700, align: 'center', spacing: 1, max: w - k * 2 - 16 });
  if (hit) hot(x, y, w, h, hit);
}
/** ◀ ▶ either side of a row, each a tap target ({ d: -1 | 1, row }) */
export function arrows(g, x, y, w, h, row, sel, t) {
  const s = h * 0.3, cy = y + h / 2, wob = sel ? Math.sin(t * 6) * 3 : 0;
  g.fillStyle = sel ? COL.ink : COL.faint;
  g.beginPath(); g.moveTo(x + 16 - wob, cy); g.lineTo(x + 16 + s * 1.1 - wob, cy - s); g.lineTo(x + 16 + s * 1.1 - wob, cy + s); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(x + w - 16 + wob, cy); g.lineTo(x + w - 16 - s * 1.1 + wob, cy - s); g.lineTo(x + w - 16 - s * 1.1 + wob, cy + s); g.closePath(); g.fill();
  hot(x, y, h * 1.2, h, { d: -1, row });
  hot(x + w - h * 1.2, y, h * 1.2, h, { d: 1, row });
}
export function bar(g, x, y, w, h, q, col, back = 'rgba(246,247,242,0.1)') {
  g.fillStyle = back; g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x, y, w * clamp01(q), h);
}
/** a rating 1..9 as nine pips */
export function pips(g, v, x, y, w, h, col = COL.ball, extra = 0) {
  const n = 9, gap = 4, pw = (w - gap * (n - 1)) / n;
  for (let k = 0; k < n; k++) {
    g.fillStyle = k < v ? col : k < v + extra ? alpha(col, 0.4) : 'rgba(246,247,242,0.12)';
    g.fillRect(x + k * (pw + gap), y, pw, h);
  }
}
/** n of 5 stars, half ones too */
export function stars(g, n, x, y, size, col = COL.ball) {
  for (let k = 0; k < 5; k++) {
    const cx = x + k * size * 1.15 + size / 2, cy = y, f = clamp01(n - k);
    const path = () => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? size * 0.22 : size * 0.5, a = -Math.PI / 2 + (i * Math.PI) / 5;
        if (i) g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
    };
    path(); g.fillStyle = 'rgba(246,247,242,0.14)'; g.fill();
    if (f > 0) {
      g.save(); g.beginPath(); g.rect(cx - size / 2, cy - size / 2, size * f, size); g.clip();
      path(); g.fillStyle = col; g.fill(); g.restore();
    }
  }
}
/** a nation's flag: three bars, a triangle at the hoist, a thin dark edge */
export function flag(g, code, x, y, w, h) {
  const N = NATIONS[code], f = N?.flag ?? ['#888888', '#cccccc', '#888888'];
  f.forEach((c, k) => { g.fillStyle = c; g.fillRect(x, y + (k * h) / 3, w, h / 3 + 0.5); });
  if (N?.mark) { g.fillStyle = N.mark; g.beginPath(); g.moveTo(x, y); g.lineTo(x + w * 0.38, y + h / 2); g.lineTo(x, y + h); g.closePath(); g.fill(); }
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
}
/** a felt ball with its seam */
export function ball(g, x, y, r, spin = 0) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, '#fbffc8'); gr.addColorStop(0.55, COL.ball); gr.addColorStop(1, '#9fae12');
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.save();
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1.5, r * 0.12);
  g.beginPath(); g.arc(x - r * 1.05 + Math.sin(spin) * r * 0.2, y, r * 0.75, -1.1, 1.1); g.stroke();
  g.beginPath(); g.arc(x + r * 1.05 + Math.sin(spin) * r * 0.2, y, r * 0.75, Math.PI - 1.1, Math.PI + 1.1); g.stroke();
  g.restore();
}

// ---------- a court behind every screen ----------
/** a court in perspective under floodlights, the camera slowly drifting; colours from a venue */
export function backdrop(g, t, { colours = null, surface = 'hard', dark = 0.5 } = {}) {
  const court = colours?.court ?? SURFACE_TINT[surface] ?? SURFACE_TINT.hard, sur = colours?.surround ?? '#2f6b46', line = colours?.line ?? '#f6f7f2';
  // the surround, darker toward the top: the far stands in shadow
  const sg = g.createLinearGradient(0, 0, 0, H);
  sg.addColorStop(0, shade(sur, -0.75)); sg.addColorStop(0.32, shade(sur, -0.45)); sg.addColorStop(1, shade(sur, -0.1));
  g.fillStyle = sg; g.fillRect(0, 0, W, H);
  // a crowd of tiny heads up there
  g.save();
  for (let row = 0; row < 7; row++) {
    const y = 40 + row * 26, n = 64;
    for (let k = 0; k < n; k++) {
      const s = ((k * 7919 + row * 104729) % 1000) / 1000;
      g.fillStyle = `rgba(${150 + s * 80},${120 + s * 70},${110 + s * 90},${0.1 + row * 0.02})`;
      g.fillRect(k * 30 + (row % 2) * 15 + s * 8, y + Math.sin(t * 2 + k + row) * 1.5, 14, 14);
    }
  }
  g.restore();
  // the court, seen by a camera high behind the near baseline, drifting slowly from side to side
  const f = 1157, camZ = 26, camH = 11.26, horizon = 76, camX = Math.sin(t * 0.06) * 2.2;
  const P = (x, z, y = 0) => { const d = camZ - z; return [W / 2 + (f * (x - camX)) / d, horizon + (f * (camH - y)) / d]; };
  const quad = (pts, fill) => { g.beginPath(); pts.forEach(([x, z], k) => { const [px, py] = P(x, z); if (k) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); g.fillStyle = fill; g.fill(); };
  quad([[-9.5, -17], [9.5, -17], [9.5, 17], [-9.5, 17]], shade(court, -0.22));
  quad([[-5.485, -11.885], [5.485, -11.885], [5.485, 11.885], [-5.485, 11.885]], court);
  g.strokeStyle = line; g.lineWidth = 3;
  const seg = (a, b) => { const [x1, y1] = P(...a), [x2, y2] = P(...b); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  for (const x of [-5.485, -4.115, 4.115, 5.485]) seg([x, -11.885], [x, 11.885]);
  for (const z of [-11.885, 11.885]) seg([-5.485, z], [5.485, z]);
  for (const z of [-6.4, 6.4]) seg([-4.115, z], [4.115, z]);
  seg([0, -6.4], [0, 6.4]);
  // the net: mesh, tape, posts, a shadow on the court
  const [nl, nb] = P(-6.4, 0), [nr] = P(6.4, 0), [, nt] = P(0, 0, 0.98), [, pt] = P(6.4, 0, 1.07);
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(nl, nb, nr - nl, 12);
  g.fillStyle = 'rgba(16,16,16,0.6)'; g.fillRect(nl, nt, nr - nl, nb - nt);
  g.fillStyle = line; g.fillRect(nl, nt - 5, nr - nl, 6);
  g.fillStyle = '#dcdcdc'; g.fillRect(nl - 5, pt - 4, 9, nb - pt + 4); g.fillRect(nr - 4, pt - 4, 9, nb - pt + 4);
  // floodlight pools and the night at the edges
  const lg = g.createRadialGradient(W / 2, H * 0.55, H * 0.1, W / 2, H * 0.55, H * 0.95);
  lg.addColorStop(0, 'rgba(255,255,240,0.06)'); lg.addColorStop(0.6, `rgba(2,16,10,${dark * 0.35})`); lg.addColorStop(1, `rgba(1,8,5,${Math.min(0.95, dark + 0.35)})`);
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  g.fillStyle = `rgba(3,18,12,${dark * 0.55})`; g.fillRect(0, 0, W, H);
}

// ---------- a player, flat-shaded ----------
/** a tennis player in his kit, in the flat-shaded look of the match; centred on x, feet at y, s tall */
export function figure(g, p, x, y, s, { t = 0, pose = 'ready', mirror = false } = {}) {
  if (!p) return;
  const kit = p.kit ?? { shirt: '#f6f7f2', shorts: '#f6f7f2', band: COL.ball };
  const skin = p.skin ?? '#e0ac85', hair = p.hair ?? '#3a2618';
  const hand = (p.hand === 'left') !== mirror ? -1 : 1;
  const u = s / 100, bob = pose === 'ready' ? Math.sin(t * 4) * 1.2 : 0;
  g.save();
  g.translate(x, y);
  g.scale(hand * u, u);
  const poly = (pts, c) => { g.beginPath(); pts.forEach(([px, py], k) => (k ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fillStyle = c; g.fill(); };
  // shadow
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(0, 0, 26, 5, 0, 0, TAU); g.fill();
  // legs (light and shade faces), shoes
  const knee = pose === 'ready' ? 4 : 0;
  poly([[-14, -46 + bob], [-4, -46 + bob], [-6 - knee, -24], [-8, -4], [-16, -4], [-15 - knee, -24]], skin);
  poly([[4, -46 + bob], [14, -46 + bob], [15 + knee, -24], [16, -4], [8, -4], [6 + knee, -24]], shade(skin, -0.18));
  poly([[-19, -6], [-6, -6], [-5, 0], [-20, 0]], '#f2f2f2');
  poly([[6, -6], [19, -6], [20, 0], [5, 0]], '#d8d8d8');
  // shorts
  poly([[-16, -58 + bob], [16, -58 + bob], [18, -42 + bob], [2, -40 + bob], [0, -46 + bob], [-2, -40 + bob], [-18, -42 + bob]], kit.shorts);
  poly([[0, -58 + bob], [16, -58 + bob], [18, -42 + bob], [2, -40 + bob]], shade(kit.shorts, -0.15));
  // torso: two faces of the shirt
  poly([[-17, -88 + bob], [0, -90 + bob], [0, -57 + bob], [-15, -57 + bob]], kit.shirt);
  poly([[0, -90 + bob], [17, -88 + bob], [15, -57 + bob], [0, -57 + bob]], shade(kit.shirt, -0.16));
  // arms: the free one across, the racket arm out
  poly([[-17, -88 + bob], [-24, -70 + bob], [-14, -60 + bob], [-10, -64 + bob], [-17, -72 + bob]], skin);
  poly([[17, -88 + bob], [28, -74 + bob], [34, -62 + bob], [30, -59 + bob], [22, -70 + bob], [14, -80 + bob]], shade(skin, -0.1));
  // the racket: grip, throat, a hooped head with strings
  g.save();
  g.translate(32, -60 + bob);
  g.rotate(pose === 'swing' ? -0.4 + Math.sin(t * 6) * 0.3 : -0.9);
  g.fillStyle = '#1b1b1b'; g.fillRect(-2, -2, 4, 14);
  g.strokeStyle = '#2b2b2b'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, -2); g.lineTo(-5, -12); g.moveTo(0, -2); g.lineTo(5, -12); g.stroke();
  g.beginPath(); g.ellipse(0, -26, 10, 15, 0, 0, TAU);
  g.fillStyle = 'rgba(246,247,242,0.25)'; g.fill();
  g.strokeStyle = kit.band ?? COL.ball; g.lineWidth = 3.5; g.stroke();
  g.strokeStyle = 'rgba(246,247,242,0.55)'; g.lineWidth = 0.8;
  for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(k * 3.6, -39); g.lineTo(k * 3.6, -13); g.stroke(); }
  for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(-9, -26 + k * 3.8); g.lineTo(9, -26 + k * 3.8); g.stroke(); }
  g.restore();
  // head: neck, face in two tones, hair, the band
  poly([[-4, -92 + bob], [4, -92 + bob], [4, -86 + bob], [-4, -86 + bob]], shade(skin, -0.12));
  poly([[-9, -108 + bob], [0, -111 + bob], [0, -91 + bob], [-7, -93 + bob]], skin);
  poly([[0, -111 + bob], [9, -108 + bob], [7, -93 + bob], [0, -91 + bob]], shade(skin, -0.14));
  poly([[-10, -108 + bob], [0, -116 + bob], [10, -108 + bob], [9, -104 + bob], [-9, -104 + bob]], hair);
  poly([[-10, -106 + bob], [10, -106 + bob], [10, -102 + bob], [-10, -102 + bob]], kit.band ?? COL.ball);
  g.restore();
}
