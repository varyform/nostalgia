// The screens around the race: the title, the paddock hub, the event board, the garage, the
// standings, the pause card over a frozen race, the results, the ending, initials for the hall
// of fame and the hall itself. Industrial road-war: soot-black steel plates with chamfered
// corners and rivets, rust, hazard stripes, the Russo One display face over Barlow Condensed.
// Everything is laid out on a 1920 × 1080 grid (the canvas is always 16:9: fitWide) and
// scaled by ui.u. Whatever can be tapped records its rectangle as it is drawn, so menuAt()
// answers with what the screen showed there: { i, act? } | { tab } | { back } | { go } |
// { letter, d? } | { done }.
//
//   drawScreen(g, app, ui)     ui = { cw, ch, u, dpr }; nothing in 'race' / 'demo'
//   menuAt(app, x, y, ui)      canvas pixels → the hit, or null
import { drawPrompt } from '@nostalgia/input';
import { savedAgo } from '@nostalgia/save';
import * as career from '../career.js';
import { buildTrack } from '../track.js';
import { TRACKS } from '../tracks.js';
import { drawCar } from './cars.js';

export const HEAD = "'Russo One','Arial Black',Impact,sans-serif";
export const BODY = "'Barlow Condensed','Arial Narrow',sans-serif";
export const COL = {
  ink: '#f1e8d8', dim: 'rgba(241,232,216,0.62)', faint: 'rgba(241,232,216,0.3)', hazard: '#f4b41a', rust: '#b8461b',
  heat: '#ff6a1a', red: '#e5432a', steel: '#3a3632', steelL: '#6b645c', black: '#0d0a08', ok: '#9bd66e', gold: '#ffd27a',
};
const W = 1920, H = 1080, TAU = Math.PI * 2;
const THEME = {
  canyon: { name: 'RED CANYON', col: '#e0793a' },
  docks: { name: 'RUST DOCKS', col: '#86aec0' },
  pass: { name: 'FROZEN PASS', col: '#cfe8f5' },
  city: { name: 'NEON CITY', col: '#ea4fe0' },
};
const TIER = {
  easy: { name: 'EASY', col: '#7c8b6a' },
  mid: { name: 'MEDIUM', col: COL.rust },
  hard: { name: 'HARD', col: COL.red },
  final: { name: 'FINAL', col: COL.hazard },
};
const ITEM = { continue: 'CONTINUE', new: 'NEW CAREER', hof: 'HALL OF FAME', exit: 'EXIT', race: 'RACE', garage: 'GARAGE', standings: 'STANDINGS', quit: 'QUIT TO TITLE' };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const fmt = n => Math.round(n ?? 0).toLocaleString('en-US');
const cash = n => `$${fmt(n)}`;
const nth = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH'}`;
const clamp01 = v => Math.max(0, Math.min(1, v || 0));
const ease = q => q * q * (3 - 2 * q);
const alpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const blink = (t, hz = 2) => Math.floor(t * hz) % 2 === 0;
// no points, no rank: a newcomer stands at the foot of the ladder unranked
const ranked = C => (C?.points ?? 0) > 0 && !!C?.rank;

// ---------- the tap map ----------
let rects = [], rectsFor = null;
const hot = (x, y, w, h, hit) => rects.push({ x, y, w, h, hit });
export function menuAt(app, x, y, ui) {
  if (!ui?.u || app?.state !== rectsFor) return null;
  const X = x / ui.u, Y = y / ui.u;
  for (let k = rects.length - 1; k >= 0; k--) {
    const r = rects[k];
    if (X >= r.x && X <= r.x + r.w && Y >= r.y && Y <= r.y + r.h) return r.hit;
  }
  return null;
}

// ---------- type, plates, stripes ----------
function text(g, s, x, y, size, col, { font = BODY, wgt = 600, align = 'left', spacing = 0, shadow = false, max = 0 } = {}) {
  g.font = `${font === HEAD ? 400 : wgt} ${size}px ${font}`;
  g.textAlign = align; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
  if (shadow) { g.fillStyle = 'rgba(0,0,0,0.65)'; if (max) g.fillText(s, x + 3, y + 4, max); else g.fillText(s, x + 3, y + 4); }
  g.fillStyle = col;
  if (max) g.fillText(s, x, y, max); else g.fillText(s, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}
const GST = { font: BODY };
function prompt(g, app, s, x, y, size, col = COL.dim, align = 'center') {
  if (!app.input) return;
  drawPrompt(g, app.input, s, x, y, { font: `600 ${size}px ${BODY}`, size: size * 1.3, color: col, align, letterSpacing: 1, style: GST });
}
/** diagonal hazard stripes filling a box, crawling sideways with t */
function hazard(g, x, y, w, h, t = 0, cols = [COL.hazard, COL.black]) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = cols[1]; g.fillRect(x, y, w, h);
  g.fillStyle = cols[0];
  const sw = Math.max(8, h * 0.9), step = sw * 2, off = (t * 30) % step;
  g.beginPath();
  for (let k = x - h - step + off; k < x + w + h; k += step) {
    g.moveTo(k, y + h); g.lineTo(k + sw, y + h); g.lineTo(k + sw + h, y); g.lineTo(k + h, y); g.closePath();
  }
  g.fill();
  g.restore();
}
function chamfer(g, x, y, w, h, c) {
  g.beginPath();
  g.moveTo(x + c, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h - c); g.lineTo(x + w - c, y + h);
  g.lineTo(x, y + h); g.lineTo(x, y + c); g.closePath();
}
/** a riveted steel plate with two chamfered corners */
function plate(g, x, y, w, h, { a = 0.9, edge = 'rgba(184,70,27,0.5)', cut = 18, rivets = true, lw = 2 } = {}) {
  chamfer(g, x, y, w, h, cut);
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, `rgba(38,31,26,${a})`); gr.addColorStop(1, `rgba(16,13,11,${a})`);
  g.fillStyle = gr; g.fill();
  g.strokeStyle = edge; g.lineWidth = lw; g.stroke();
  if (!rivets) return;
  for (const [rx, ry] of [[x + 14, y + h - 14], [x + w - 14, y + 14], [x + cut + 10, y + 12], [x + w - cut - 10, y + h - 12]]) {
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(rx + 1, ry + 1.5, 4, 0, TAU); g.fill();
    g.fillStyle = '#8a7f74'; g.beginPath(); g.arc(rx, ry, 3.4, 0, TAU); g.fill();
  }
}
/** a slanted slab: a menu entry or a button; lit in hazard yellow when selected */
function slab(g, x, y, w, h, sel, t, { col = COL.hazard } = {}) {
  const k = h * 0.3;
  g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + w, y); g.lineTo(x + w - k, y + h); g.lineTo(x, y + h); g.closePath();
  if (sel) {
    const glow = 0.5 + Math.sin(t * 5) * 0.2;
    g.lineJoin = 'round';
    g.strokeStyle = alpha(col, 0.12 * glow); g.lineWidth = 22; g.stroke();
    g.strokeStyle = alpha(col, 0.25 * glow); g.lineWidth = 10; g.stroke();
    g.fillStyle = col; g.fill();
    g.save(); g.clip(); hazard(g, x, y, h * 1.1, h, t, [COL.black, col]); g.restore();
  } else {
    g.fillStyle = 'rgba(18,14,12,0.86)'; g.fill();
    g.strokeStyle = 'rgba(241,232,216,0.16)'; g.lineWidth = 2; g.stroke();
  }
}
function button(g, x, y, w, h, label, sel, t, hit, { size = 30, col } = {}) {
  slab(g, x, y, w, h, sel, t, { col });
  text(g, label, x + w / 2 + (sel ? h * 0.25 : 0), y + h / 2 + size * 0.36, size, sel ? COL.black : COL.ink, { font: HEAD, align: 'center', spacing: 2, max: w - h });
  if (hit) hot(x, y, w, h, hit);
}
// words broken into lines that fit w at this size
function wrap(g, s, size, w, wgt = 500) {
  g.font = `${wgt} ${size}px ${BODY}`;
  const out = [];
  let line = '';
  for (const word of String(s).split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (line && g.measureText(next).width > w) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}
function bar(g, x, y, w, h, q, col, back = 'rgba(241,232,216,0.1)') {
  g.fillStyle = back; g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x, y, w * clamp01(q), h);
}

// ---------- the backdrop: scorched steel, tyre tracks, rising embers (painted once per size) ----------
let bg = null, bgKey = '';
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function paintBackdrop(cw, ch) {
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const g = c.getContext('2d'), u = ch / H, R = rng(1996);
  g.scale(u, u);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#1e1612'); gr.addColorStop(0.55, '#120d0a'); gr.addColorStop(1, '#0a0706');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // rust blooms and brushed steel
  for (let i = 0; i < 46; i++) {
    const x = R() * W, y = R() * H, r = 60 + R() * 260, rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(150,56,20,${0.05 + R() * 0.09})`); rg.addColorStop(1, 'rgba(150,56,20,0)');
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.lineWidth = 1;
  for (let i = 0; i < 900; i++) {
    const x = R() * W, y = R() * H, l = 20 + R() * 120;
    g.strokeStyle = `rgba(${R() < 0.5 ? '255,240,220' : '0,0,0'},${0.012 + R() * 0.03})`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + l * 0.04); g.stroke();
  }
  // two sets of tyre tracks swept across the floor
  g.setLineDash([12, 9]);
  for (const [x0, y0, x1, y1, cx, cy] of [[-100, 860, 2020, 300, 900, 1000], [-100, 180, 1500, 1180, 700, 200]]) {
    for (const o of [-38, 38]) {
      g.strokeStyle = 'rgba(0,0,0,0.32)'; g.lineWidth = 30;
      g.beginPath(); g.moveTo(x0, y0 + o); g.quadraticCurveTo(cx, cy + o, x1, y1 + o); g.stroke();
    }
  }
  g.setLineDash([]);
  // the heat from below, and a vignette
  const hg = g.createRadialGradient(W / 2, H + 220, 0, W / 2, H + 220, 1000);
  hg.addColorStop(0, 'rgba(255,96,24,0.2)'); hg.addColorStop(1, 'rgba(255,96,24,0)');
  g.fillStyle = hg; g.fillRect(0, 0, W, H);
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return c;
}
function embers(g, t, n = 46) {
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const s1 = ((i * 7919) % 1000) / 1000, s2 = ((i * 104729) % 1000) / 1000, s3 = ((i * 1299709) % 1000) / 1000;
    const rise = 30 + s2 * 70, y = H + 40 - ((t * rise + s3 * 1200) % 1200);
    const x = s1 * W + Math.sin(t * (0.6 + s2) + i) * 30, r = 1.4 + s3 * 2.8, a = clamp01(y / H) * (0.4 + 0.4 * Math.sin(t * 6 + i));
    g.fillStyle = `rgba(255,${120 + (s2 * 90) | 0},40,${a})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  g.restore();
}
function backdrop(g, ui, t) {
  const key = ui.cw + 'x' + ui.ch;
  if (key !== bgKey) { bg = paintBackdrop(ui.cw, ui.ch); bgKey = key; }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(bg, 0, 0);
  g.setTransform(ui.u, 0, 0, ui.u, 0, 0);
  embers(g, t);
}

// ---------- shared chrome ----------
function header(g, app, title, sub, t) {
  hazard(g, 0, 0, W, 16, t);
  g.fillStyle = 'rgba(8,6,5,0.7)'; g.fillRect(0, 16, W, 138);
  g.fillStyle = COL.rust; g.fillRect(0, 154, W, 3);
  text(g, title, 90, 108, 66, COL.ink, { font: HEAD, spacing: 3, shadow: true });
  if (sub) text(g, sub, 94, 140, 25, COL.dim, { wgt: 600, spacing: 4 });
  const C = app.career;
  if (!C) return;
  let x = W - 80;
  for (const [l, v, col] of [['CASH', cash(C.cash), COL.gold], ['RANK', ranked(C) ? `#${C.rank}` : '—', COL.ink], ['POINTS', fmt(C.points), COL.ink]]) {
    g.font = `400 40px ${HEAD}`;
    const w = Math.max(130, g.measureText(v).width + 44);
    plate(g, x - w, 40, w, 92, { a: 0.85, cut: 12, rivets: false, edge: 'rgba(241,232,216,0.14)' });
    text(g, l, x - w / 2, 68, 19, COL.dim, { align: 'center', spacing: 4, wgt: 700 });
    text(g, v, x - w / 2, 114, 38, col, { font: HEAD, align: 'center' });
    x -= w + 16;
  }
}
function footer(g, app, hints, t, back = true) {
  g.fillStyle = 'rgba(8,6,5,0.78)'; g.fillRect(0, 1012, W, 68);
  hazard(g, 0, 1008, W, 5, t);
  if (back) {
    button(g, 34, 1020, 210, 52, '◀ BACK', false, t, { back: true }, { size: 24 });
  }
  if (hints) prompt(g, app, hints, W / 2, 1056, 26);
}
const modelOf = id => career.MODELS?.find(m => m.id === id) ?? career.MODELS?.[0] ?? null;
const driverOf = id => career.DRIVERS?.find(d => d.id === id) ?? null;
function car(g, model, colour, x, y, a, scale, opts = {}) {
  g.save();
  try { drawCar(g, model, colour, x, y, a, scale, opts); } finally { g.restore(); }
}
// a turntable: a floor disc ringed with hazard paint under a car preview
function turntable(g, x, y, r, t) {
  g.save();
  const fl = g.createRadialGradient(x, y, r * 0.1, x, y, r);
  fl.addColorStop(0, 'rgba(70,62,55,0.55)'); fl.addColorStop(1, 'rgba(20,16,13,0.2)');
  g.fillStyle = fl; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  // the rim painted in hazard dashes, turning slowly
  g.lineWidth = 16;
  const n = 28;
  for (let k = 0; k < n; k++) {
    g.strokeStyle = k % 2 ? 'rgba(244,180,26,0.75)' : 'rgba(13,10,8,0.8)';
    g.beginPath(); g.arc(x, y, r - 8, (k / n) * TAU + t * 0.25, ((k + 1) / n) * TAU + t * 0.25); g.stroke();
  }
  g.restore();
  const lg = g.createRadialGradient(x, y - r * 0.2, 0, x, y, r * 1.2);
  lg.addColorStop(0, 'rgba(255,220,170,0.1)'); lg.addColorStop(1, 'rgba(255,220,170,0)');
  g.fillStyle = lg; g.fillRect(x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
}

// ---------- stats for the bars ----------
const STATS = [
  ['accel', 'ACCELERATION', s => s.accel],
  ['top', 'TOP SPEED', s => s.top],
  ['grip', 'GRIP', s => s.grip],
  ['turn', 'STEERING', s => s.turn],
  ['hp', 'ARMOUR', s => s.hp],
  ['gun', 'FIREPOWER', s => (s.gun ?? 0) * (s.rate ?? 1)],
];
const ZERO = { engine: 0, tyres: 0, armour: 0 };
function statsOf(model, up) {
  try { return career.carStats(model, up ?? ZERO) ?? null; } catch { return null; }
}
// the bars run up to the champion's interceptor: the best there is
let ranges = null;
function statRanges() {
  if (ranges) return ranges;
  ranges = {};
  const top = statsOf(career.driverOf?.(career.CHAMPION)?.model ?? 'nightjar', ZERO);
  if (top) for (const [k, , f] of STATS) ranges[k] = f(top) || 1;
  return ranges;
}
// one bar per stat: what you have, and what the thing on show would make of it
function statBars(g, x, y, w, have, show) {
  const R = statRanges();
  STATS.forEach(([k, name, f], i) => {
    const yy = y + i * 50, max = R[k] || 1, a = have ? clamp01(f(have) / max) : 0, b = show ? clamp01(f(show) / max) : a;
    text(g, name, x, yy + 22, 22, COL.dim, { wgt: 700, spacing: 3 });
    const bx = x + 190, bw = w - 190;
    g.fillStyle = 'rgba(241,232,216,0.08)'; g.fillRect(bx, yy + 4, bw, 22);
    // notches every tenth
    g.fillStyle = COL.ink; g.fillRect(bx, yy + 4, bw * Math.min(a, b), 22);
    if (b > a + 0.002) { g.fillStyle = COL.ok; g.fillRect(bx + bw * a, yy + 4, bw * (b - a), 22); }
    else if (a > b + 0.002) { g.fillStyle = alpha(COL.red, 0.85); g.fillRect(bx + bw * b, yy + 4, bw * (a - b), 22); }
    g.fillStyle = 'rgba(13,10,8,0.85)';
    for (let n = 1; n < 10; n++) g.fillRect(bx + (bw * n) / 10 - 1.5, yy + 4, 3, 22);
  });
}

// ---------- track outlines for the event board (built once per track) ----------
const outlines = new Map();
function outline(id) {
  if (outlines.has(id)) return outlines.get(id);
  let o = null;
  try {
    const def = TRACKS.find(t => t.id === id);
    const geo = def && buildTrack(def);
    if (geo) {
      const n = 160, pts = [];
      for (let k = 0; k < n; k++) { const p = geo.at((k / n) * geo.len); pts.push([p.x, p.y]); }
      const b = geo.bounds ?? pts.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x), y1: Math.max(b.y1, y) }), { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 });
      const s0 = geo.at(0);
      o = { pts, b, start: [s0.x, s0.y, Math.atan2(s0.ty, s0.tx)], len: geo.len };
    }
  } catch { o = null; }
  outlines.set(id, o);
  return o;
}
function drawOutline(g, id, x, y, w, h, col, t) {
  const o = outline(id);
  if (!o) return;
  const { b } = o, s = Math.min((w - 40) / (b.x1 - b.x0 || 1), (h - 40) / (b.y1 - b.y0 || 1));
  const ox = x + w / 2 - ((b.x0 + b.x1) / 2) * s, oy = y + h / 2 - ((b.y0 + b.y1) / 2) * s;
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  o.pts.forEach(([px, py], k) => (k ? g.lineTo(ox + px * s, oy + py * s) : g.moveTo(ox + px * s, oy + py * s)));
  g.closePath();
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 13; g.stroke();
  g.strokeStyle = alpha(col, 0.9); g.lineWidth = 7; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.stroke();
  // the start line, and a blip running the lap
  const [sx, sy, sa] = o.start;
  g.translate(ox + sx * s, oy + sy * s); g.rotate(sa);
  g.fillStyle = COL.ink; g.fillRect(-2.5, -11, 5, 22);
  g.restore();
  const p = o.pts[Math.floor(((t * 0.12) % 1) * o.pts.length)];
  g.fillStyle = COL.hazard; g.beginPath(); g.arc(ox + p[0] * s, oy + p[1] * s, 6, 0, TAU); g.fill();
}

// ---------- the title ----------
function road(g, t) {
  // a strip of road at a slant, scrolling under the champion's interceptor
  g.save();
  g.translate(1440, 560); g.rotate(-0.17);
  const w = 360, L = 1500;
  g.fillStyle = '#1b1a1a'; g.fillRect(-w / 2, -L / 2, w, L);
  const sh = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.04)'); sh.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = sh; g.fillRect(-w / 2, -L / 2, w, L);
  const off = (t * 900) % 120;
  for (let y = -L / 2 - 120 + off; y < L / 2; y += 120) {
    g.fillStyle = 'rgba(244,180,26,0.8)'; g.fillRect(-5, y, 10, 60);
    for (const sx of [-w / 2 - 22, w / 2]) { g.fillStyle = Math.round((y - off) / 120) % 2 ? '#d8d0c4' : '#b8331b'; g.fillRect(sx, y, 22, 60); g.fillStyle = Math.round((y - off) / 120) % 2 ? '#b8331b' : '#d8d0c4'; g.fillRect(sx, y + 60, 22, 60); }
  }
  // skid marks streaming past
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 16;
  for (const sx of [-48, 48]) { g.beginPath(); g.moveTo(sx, 90); g.lineTo(sx + Math.sin(t * 2) * 10, L / 2); g.stroke(); }
  g.restore();
}
// the logo is painted once per size (its glow is a blur, too dear to redo each frame) and
// again once the display face has loaded
let logoC = null, logoKey = '';
function logoImage(u, size) {
  const key = `${u}:${size}:${document.fonts?.check?.(`400 ${size}px 'Russo One'`) ?? true}`;
  if (key === logoKey) return logoC;
  const c = document.createElement('canvas'), pad = 90, g = c.getContext('2d');
  g.font = `400 ${size}px ${HEAD}`;
  if ('letterSpacing' in g) g.letterSpacing = '6px';
  const w = g.measureText('SCORCH').width;
  c.width = Math.ceil((w + size * 0.3 + pad * 2) * u); c.height = Math.ceil((size + pad * 2) * u);
  g.scale(u, u); g.translate(pad + size * 0.2, pad + size * 0.8); g.transform(1, 0, -0.2, 1, 0, 0);
  g.font = `400 ${size}px ${HEAD}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = '6px';
  g.shadowColor = 'rgba(255,96,24,0.55)'; g.shadowBlur = 50;
  g.fillStyle = 'rgba(30,8,2,0.8)'; g.fillText('SCORCH', 8, 10);
  g.shadowBlur = 0;
  const gr = g.createLinearGradient(0, -size * 0.75, 0, 0);
  gr.addColorStop(0, '#fff4c8'); gr.addColorStop(0.35, '#ffc14a'); gr.addColorStop(0.7, '#ff5a1a'); gr.addColorStop(1, '#8a1c08');
  g.fillStyle = gr; g.fillText('SCORCH', 0, 0);
  g.lineWidth = 2; g.strokeStyle = 'rgba(40,10,2,0.8)'; g.strokeText('SCORCH', 0, 0);
  logoC = { c, w, pad: pad + size * 0.2, top: pad + size * 0.8 };
  logoKey = key;
  return logoC;
}
function logo(g, ui, x, y, size, t) {
  const L = logoImage(ui.u, size);
  // the heat behind it breathes
  const hg = g.createRadialGradient(x + L.w / 2, y - size * 0.35, 0, x + L.w / 2, y - size * 0.35, L.w * 0.6);
  hg.addColorStop(0, `rgba(255,96,24,${0.12 + Math.sin(t * 2.3) * 0.05})`); hg.addColorStop(1, 'rgba(255,96,24,0)');
  g.fillStyle = hg; g.fillRect(x - 100, y - size - 60, L.w + 200, size + 160);
  g.drawImage(L.c, x - L.pad, y - L.top, L.c.width / ui.u, L.c.height / ui.u);
  // heat streaks raking off the letters
  for (let k = 0; k < 5; k++) {
    const yy = y + 26 + k * 13, len = L.w * (0.92 - k * 0.15), sway = Math.sin(t * 3 + k) * 14;
    g.fillStyle = alpha(k % 2 ? COL.hazard : COL.heat, 0.85 - k * 0.15);
    g.beginPath(); g.moveTo(x - 30 + sway, yy); g.lineTo(x - 30 + len + sway, yy); g.lineTo(x - 40 + len + sway, yy + 6); g.lineTo(x - 40 + sway, yy + 6); g.fill();
  }
}
function title(g, ui, app, t) {
  backdrop(g, ui, t);
  road(g, t);
  const champ = career.MODELS?.[career.MODELS.length - 1];
  if (champ) {
    const sway = Math.sin(t * 1.3) * 18, a = -Math.PI / 2 - 0.17 + Math.sin(t * 1.3 + 0.6) * 0.05;
    car(g, champ.id, driverOf('marrow')?.colour ?? '#18181c', 1440 + sway, 540, a, 62, { lights: true, boost: t % 5 < 1.2 });
  }
  hazard(g, 0, 0, W, 16, t);
  logo(g, ui, 110, 300, 200, t);
  text(g, 'OUTLAW ROAD WARS ON A DYING FRONTIER', 116, 400, 30, COL.ink, { wgt: 700, spacing: 6, shadow: true });
  const items = app.items?.() ?? ['new'];
  items.forEach((it, k) => {
    const sel = k === app.menu, y = 470 + k * 100, w = 600, h = 76;
    button(g, 110, y, w, h, ITEM[it] ?? it.toUpperCase(), sel, t, { i: k }, { size: 36 });
    if (it === 'continue' && app.saved) {
      const s = `${app.saved.label ?? ''}${app.saved.at ? ' · ' + savedAgo(app.saved.at) : ''}`.toUpperCase();
      text(g, s, 110 + w + 24, y + h / 2 + 9, 24, sel ? COL.gold : COL.dim, { wgt: 700, spacing: 2 });
    }
  });
  text(g, 'TWELVE RANKED DRIVERS STAND BETWEEN YOU AND THE CHAMPION, IVO MARROW.', 116, 950, 23, COL.faint, { wgt: 600, spacing: 2 });
  footer(g, app, `{menu} Choose   {start} Select   {sound} Sound ${app.soundOn ? 'on' : 'off'}   {fullscreen} Full screen${app.hdr?.supported ? `   {hdr} HDR ${app.hdr.label.slice(4).toLowerCase()}` : ''}${app.onExit ? '   {quit} Exit' : ''}`, t, false);
}

// ---------- the paddock ----------
function loadout(g, C, x, y) {
  const rows = [['AMMO', C.ammo], ['MINES', C.mines], ['TURBO', C.turbo]];
  rows.forEach(([l, v], k) => {
    const xx = x + k * 200;
    text(g, l, xx, y, 21, COL.dim, { wgt: 700, spacing: 3 });
    text(g, fmt(v ?? 0), xx, y + 46, 42, v ? COL.ink : COL.red, { font: HEAD });
  });
}
function armour(g, C, x, y, w) {
  const q = C.maxHp ? clamp01(C.hp / C.maxHp) : 1, col = q > 0.6 ? COL.ok : q > 0.3 ? COL.hazard : COL.red;
  text(g, 'ARMOUR', x, y, 21, COL.dim, { wgt: 700, spacing: 3 });
  text(g, `${Math.round(q * 100)}%`, x + w, y, 24, col, { font: HEAD, align: 'right' });
  bar(g, x, y + 12, w, 18, q, col);
}
function paddock(g, ui, app, t) {
  backdrop(g, ui, t);
  const C = app.career ?? {};
  header(g, app, 'THE PADDOCK', `RACE ${(C.races ?? 0) + 1}  ·  ${C.wins ?? 0} WON  ·  ${ranked(C) ? `RANKED #${C.rank}` : 'UNRANKED'}`, t);
  const m = modelOf(C.model);
  plate(g, 70, 190, 880, 790);
  text(g, (m?.name ?? 'YOUR CAR').toUpperCase(), 110, 252, 40, COL.ink, { font: HEAD, spacing: 2 });
  if (m?.blurb) text(g, m.blurb, 112, 288, 23, COL.dim, { wgt: 500, max: 800 });
  turntable(g, 510, 560, 230, t);
  if (m) car(g, m.id, C.colour ?? COL.rust, 510, 560, t * 0.35, 66, { damage: C.maxHp ? 1 - C.hp / C.maxHp : 0, lights: true });
  armour(g, C, 110, 840, 800);
  loadout(g, C, 110, 900);
  const items = app.items?.() ?? [];
  const final = C.rank === 1;
  const sub = {
    race: final ? 'IVO MARROW TAKES YOUR CHALLENGE' : 'THREE EVENTS ON THE BOARD',
    garage: 'CARS · PARTS · AMMO, MINES, TURBO, REPAIRS',
    standings: `THE LADDER  ·  ${C.points ?? 0} POINTS`,
    quit: 'THE CAREER IS SAVED',
  };
  items.forEach((it, k) => {
    const sel = k === app.menu, y = 220 + k * 140, w = 820, h = 92;
    button(g, 1010, y, w, h, ITEM[it] ?? it.toUpperCase(), sel, t, { i: k }, { size: 42 });
    text(g, sub[it] ?? '', 1040, y + h + 30, 22, sel ? COL.gold : COL.faint, { wgt: 700, spacing: 3 });
  });
  // what wants doing before the next race
  const warn = [];
  if (C.maxHp && C.hp < C.maxHp * 0.6) warn.push(['ARMOUR LOW: REPAIR IN THE GARAGE', COL.red]);
  if (!C.ammo) warn.push(['NO AMMO: THE GUN IS DRY', COL.hazard]);
  if (final) warn.push(['RANKED #1: THE FINAL IS ON', COL.gold]);
  warn.forEach(([s, col], k) => {
    const y = 800 + k * 52;
    hazard(g, 1010, y, 14, 38, t, [col, COL.black]);
    text(g, s, 1040, y + 30, 26, col, { wgt: 700, spacing: 3 });
  });
  footer(g, app, '{menu} Choose   {start} Select', t, false);
}

// ---------- the event board ----------
function events(g, ui, app, t) {
  backdrop(g, ui, t);
  const offers = app.offers ?? [], final = offers[0]?.tier === 'final';
  header(g, app, 'EVENT BOARD', final ? "THE CHAMPION'S CHALLENGE: ONE RACE, NO SECOND PLACE" : 'PICK YOUR NEXT RACE', t);
  const n = Math.max(1, offers.length), cw = n === 1 ? 760 : 560, gap = 36, x0 = (W - (n * cw + (n - 1) * gap)) / 2;
  const ranks = new Map((app.standings ?? []).map(r => [r.id, r.rank]));
  offers.forEach((o, k) => {
    const sel = k === app.pick, x = x0 + k * (cw + gap), y = 186 - (sel ? 8 : 0), h = 716;
    const tier = TIER[o.tier] ?? TIER.easy, def = TRACKS.find(tr => tr.id === o.track), th = THEME[def?.theme] ?? THEME.canyon;
    if (sel) {
      chamfer(g, x, y, cw, h, 18); g.strokeStyle = alpha(COL.hazard, 0.12); g.lineWidth = 26; g.stroke();
      plate(g, x, y, cw, h, { edge: COL.hazard, lw: 4 });
    }
    else plate(g, x, y, cw, h, { a: 0.8 });
    hot(x, y, cw, h, { i: k });
    // the tier band
    if (o.tier === 'final') hazard(g, x + 18, y + 18, cw - 36, 44, t);
    else { g.fillStyle = tier.col; g.fillRect(x + 18, y + 18, cw - 36, 44); }
    text(g, tier.name, x + 36, y + 51, 30, o.tier === 'final' ? COL.ink : COL.black, { font: HEAD, spacing: 4, shadow: o.tier === 'final' });
    text(g, `${o.laps} LAPS`, x + cw - 36, y + 51, 28, o.tier === 'final' ? COL.ink : COL.black, { font: HEAD, align: 'right', shadow: o.tier === 'final' });
    text(g, (def?.name ?? o.track ?? '').toUpperCase(), x + 30, y + 112, 38, COL.ink, { font: HEAD, max: cw - 60 });
    text(g, th.name, x + 32, y + 142, 22, th.col, { wgt: 700, spacing: 4 });
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x + 26, y + 160, cw - 52, 220);
    drawOutline(g, o.track, x + 26, y + 160, cw - 52, 220, th.col, t + k * 2.7);
    text(g, 'RIVALS', x + 30, y + 418, 20, COL.dim, { wgt: 700, spacing: 4 });
    (o.rivals ?? []).forEach((id, j) => {
      const d = driverOf(id), yy = y + 452 + j * 38;
      g.fillStyle = d?.colour ?? COL.steelL; g.fillRect(x + 30, yy - 20, 22, 22);
      text(g, (d?.name ?? id).toUpperCase(), x + 64, yy, 27, COL.ink, { wgt: 600, max: cw - 180 });
      const r = ranks.get(id);
      if (r) text(g, id === 'marrow' ? 'CHAMPION' : `#${r}`, x + cw - 32, yy, 25, id === 'marrow' ? COL.gold : COL.dim, { font: HEAD, align: 'right' });
    });
    text(g, 'PRIZES', x + 30, y + 584, 20, COL.dim, { wgt: 700, spacing: 4 });
    const pw = (cw - 60) / 4;
    (o.prizes ?? []).slice(0, 4).forEach((p, j) => {
      const xx = x + 30 + j * pw;
      text(g, nth(j + 1), xx, y + 616, 20, j ? COL.dim : COL.gold, { wgt: 700, spacing: 2 });
      text(g, cash(p), xx, y + 650, j ? 27 : 31, j ? COL.ink : COL.gold, { font: HEAD, max: pw - 8 });
    });
    const bits = [o.points && `POINTS ${o.points.slice(0, 4).join(' · ')}`, o.kill && `${cash(o.kill)} A WRECK`].filter(Boolean);
    text(g, bits.join('   ·   '), x + 30, y + 690, 21, COL.faint, { wgt: 700, spacing: 2, max: cw - 60 });
  });
  const o = offers[app.pick];
  if (o) button(g, W / 2 - 260, 924, 520, 66, final ? 'TAKE THE CHALLENGE' : 'RACE  ▸', true, t, { go: true }, { size: 32 });
  footer(g, app, '{tabs} Pick   {start} Race   {back} Paddock', t);
}

// ---------- the garage ----------
const TAB = { cars: 'CARS', parts: 'PARTS', supplies: 'SUPPLIES' };
const PART = { engine: ['ENGINE', 'MORE PULL AND TOP SPEED'], tyres: ['TYRES', 'GRIP AND STEERING'], armour: ['ARMOUR', 'PLATING: TAKES MORE PUNISHMENT'] };
const SUPPLY = { ammo: ['AMMO', 'ROUNDS FOR THE GUN'], mines: ['MINES', 'DROPPED BEHIND, ARMED IN A BLINK'], turbo: ['TURBO', 'CHARGES OF NITRO THRUST'], repair: ['REPAIR', 'BEAT THE DENTS OUT OF THE ARMOUR'] };
function pips(g, x, y, n, max, col) {
  for (let k = 0; k < max; k++) {
    g.fillStyle = k < n ? col : 'rgba(241,232,216,0.12)';
    g.beginPath(); g.moveTo(x + k * 30 + 6, y); g.lineTo(x + k * 30 + 26, y); g.lineTo(x + k * 30 + 20, y + 18); g.lineTo(x + k * 30, y + 18); g.fill();
  }
}
function garageRow(g, app, tab, r, k, x, y, w, h, sel, t) {
  plate(g, x, y, w, h, { a: sel ? 0.95 : 0.75, cut: 12, rivets: false, edge: sel ? COL.hazard : 'rgba(241,232,216,0.12)', lw: sel ? 3 : 2 });
  hot(x, y, w, h, { i: k });
  let name = '', sub = '', right = '', note = '', sell = false;
  if (tab === 'cars') {
    const m = modelOf(r.id);
    name = (r.name ?? m?.name ?? r.id).toUpperCase(); sub = m?.blurb ?? '';
    if (r.owned) { right = 'YOURS'; note = 'IN THE GARAGE'; }
    else { right = cash(r.price); if (r.net != null && r.net !== r.price) note = `${cash(Math.max(0, r.net))} WITH TRADE-IN`; }
  } else if (tab === 'parts') {
    const [n, s] = PART[r.part] ?? [String(r.part).toUpperCase(), ''];
    name = n; sub = s;
    right = r.level >= r.max ? 'MAXED' : cash(r.price);
    pips(g, x + w - 470, y + 54, r.level ?? 0, r.max ?? 0, COL.hazard);
    sell = (r.level ?? 0) > 0;
  } else {
    const [n, s] = SUPPLY[r.kind] ?? [String(r.kind).toUpperCase(), ''];
    name = n; sub = s;
    const full = r.have >= r.max;
    right = full ? 'FULL' : `${cash(r.price)}${r.step > 1 ? ` / ${r.step}` : ''}`;
    const q = r.max ? r.have / r.max : 0;
    bar(g, x + w - 470, y + 58, 140, 14, q, r.kind === 'repair' ? (q > 0.6 ? COL.ok : q > 0.3 ? COL.hazard : COL.red) : COL.ink);
    note = r.kind === 'repair' ? `ARMOUR ${Math.round(q * 100)}%` : `${fmt(r.have)} OF ${fmt(r.max)}`;
    sell = r.kind !== 'repair' && r.have > 0;
  }
  text(g, name, x + 28, y + 44, 32, sel ? COL.ink : 'rgba(241,232,216,0.85)', { font: HEAD, spacing: 1, max: 330 });
  if (tab === 'cars') wrap(g, sub, 19, 400).slice(0, 2).forEach((l, j) => text(g, l, x + 30, y + 70 + j * 21, 19, COL.dim, { wgt: 500 }));
  else text(g, sub, x + 30, y + 76, 21, COL.dim, { wgt: 500, max: 380 });
  if (note) text(g, note, x + w - 236, y + 82, 19, r.owned ? COL.ok : COL.dim, { wgt: 700, spacing: 1, align: 'right' });
  const can = r.can !== false && !/YOURS|MAXED|FULL/.test(right);
  text(g, right, x + w - 236, y + 48, 30, can ? COL.gold : /YOURS|MAXED|FULL/.test(right) ? COL.ok : alpha(COL.red, 0.9), { font: HEAD, align: 'right' });
  // the row's own buttons, for a tap
  const bx = x + w - 214;
  if (!/YOURS|MAXED|FULL/.test(right)) button(g, bx, y + 14, 190, sell ? 34 : h - 28, 'BUY', sel && can, t, { i: k, act: 'buy' }, { size: 22, col: can ? COL.hazard : COL.steelL });
  if (sell) button(g, bx, y + h - 46, 190, 34, 'SELL', false, t, { i: k, act: 'sell' }, { size: 20 });
}
function garage(g, ui, app, t) {
  backdrop(g, ui, t);
  const C = app.career ?? {}, G = app.garage ?? { tab: 0, rows: [], sel: 0 }, tabs = G.tabs ?? ['cars', 'parts', 'supplies'];
  const tab = tabs[G.tab] ?? 'cars', row = G.rows?.[G.sel];
  const mine = modelOf(C.model);
  header(g, app, 'GARAGE', `${(mine?.name ?? '').toUpperCase()}  ·  ${C.races ?? 0} RACES ON THE CLOCK`, t);
  // the preview: the car on offer in CARS, else your own as the part or supply would leave it
  plate(g, 60, 186, 860, 800);
  const have = statsOf(C.model, C.up);
  let showModel = C.model, show = have, cap = 'YOUR CAR';
  if (tab === 'cars' && row) { showModel = row.id; show = row.stats ?? statsOf(row.id, ZERO); cap = row.owned ? 'YOUR CAR' : 'ON THE LOT'; }
  else if (tab === 'parts' && row && row.level < row.max) { show = row.stats ?? statsOf(C.model, { ...(C.up ?? ZERO), [row.part]: (C.up?.[row.part] ?? 0) + 1 }); cap = 'WITH THE UPGRADE'; }
  const sm = modelOf(showModel);
  text(g, cap, 100, 240, 21, COL.dim, { wgt: 700, spacing: 4 });
  text(g, (sm?.name ?? '').toUpperCase(), 100, 286, 44, COL.ink, { font: HEAD, spacing: 2, max: 780 });
  turntable(g, 490, 500, 170, t);
  if (sm) car(g, sm.id, tab === 'cars' && showModel !== C.model ? '#8d8a86' : C.colour ?? COL.rust, 490, 500, -Math.PI / 2 + Math.sin(t * 0.8) * 0.5, 54, { lights: true, damage: showModel === C.model && C.maxHp ? 1 - C.hp / C.maxHp : 0 });
  statBars(g, 100, 690, 780, have, show);
  // the tabs and the rows
  const lx = 960, lw = 900;
  tabs.forEach((tb, k) => {
    const sel = k === G.tab, x = lx + k * 300;
    button(g, x, 186, 284, 62, TAB[tb] ?? tb.toUpperCase(), sel, t, { tab: k }, { size: 28 });
  });
  const rows = G.rows ?? [], rh = 104, y0 = 270, fit = Math.floor((930 - y0) / (rh + 10));
  const first = Math.max(0, Math.min((G.sel ?? 0) - fit + 1, rows.length - fit));
  rows.slice(first, first + fit).forEach((r, j) => garageRow(g, app, tab, r, first + j, lx, y0 + j * (rh + 10), lw, rh, first + j === G.sel, t));
  if (!rows.length) text(g, 'NOTHING HERE', lx + lw / 2, 420, 30, COL.dim, { font: HEAD, align: 'center' });
  // the till's word on the last trade
  if (G.msg && app.t - (G.msgT ?? 0) < 4) {
    const a = clamp01(4 - (app.t - G.msgT)), col = G.ok ? COL.ok : COL.red;
    g.globalAlpha = a;
    plate(g, lx, 934, lw, 58, { a: 0.92, cut: 10, rivets: false, edge: col });
    if (!G.ok) hazard(g, lx + 14, 946, 26, 34, t, [COL.red, COL.black]);
    text(g, G.msg, lx + (G.ok ? 24 : 56), 974, 28, col, { font: HEAD, spacing: 1, max: lw - 80 });
    g.globalAlpha = 1;
  }
  footer(g, app, `{tabs} Tab   {menu} Choose   {start} Buy${tab !== 'cars' ? '   {sell} Sell' : ''}   {back} Paddock`, t);
}

// ---------- the standings ----------
function ladder(g, list, x, y, w, rh, t, { rowY = null, n = list.length } = {}) {
  list.slice(0, n).forEach((r, k) => {
    const yy = rowY ? rowY(r, k) : y + k * rh, you = !!r.you, champ = r.id === 'marrow';
    if (yy == null) return;
    if (you) { chamfer(g, x, yy, w, rh - 8, 10); g.strokeStyle = alpha(COL.hazard, 0.18); g.lineWidth = 16; g.stroke(); }
    plate(g, x, yy, w, rh - 8, { a: you ? 0.96 : 0.78, cut: 10, rivets: false, edge: you ? COL.hazard : champ ? COL.gold : 'rgba(241,232,216,0.1)', lw: you ? 3 : 2 });
    if (you) hazard(g, x + 10, yy + 8, 12, rh - 24, t);
    text(g, champ ? '★' : r.rank && (r.points > 0 || !r.you) ? `${r.rank}` : '—', x + 76, yy + rh * 0.62, 30, champ ? COL.gold : you ? COL.hazard : COL.dim, { font: HEAD, align: 'right' });
    g.fillStyle = r.colour ?? COL.steelL; g.fillRect(x + 96, yy + rh * 0.24, 24, rh * 0.4);
    text(g, (you ? `${r.name ?? 'YOU'} (YOU)` : r.name ?? r.id ?? '').toUpperCase(), x + 136, yy + rh * 0.6, 28, you ? COL.ink : 'rgba(241,232,216,0.86)', { wgt: 700, spacing: 1, max: w - 330 });
    text(g, champ ? 'CHAMPION' : `${fmt(r.points)} PTS`, x + w - 26, yy + rh * 0.6, 26, champ ? COL.gold : you ? COL.hazard : COL.ink, { font: HEAD, align: 'right' });
  });
}
function standings(g, ui, app, t) {
  backdrop(g, ui, t);
  header(g, app, 'STANDINGS', 'THE SCORCH CIRCUIT LADDER: ONLY #1 MAY CHALLENGE THE CHAMPION', t);
  // the champion stands above the ladder, out of reach of points
  const d = driverOf(career.CHAMPION ?? 'marrow'), champ = d && { id: d.id, name: d.name, colour: d.colour, points: 0 };
  const list = [...(champ ? [champ] : []), ...(app.standings ?? [])], n = list.length, rh = Math.min(62, Math.floor(820 / Math.max(1, n)));
  ladder(g, list, 360, 180, 1200, rh, t);
  footer(g, app, '{start} Paddock', t);
}

// ---------- the pause card over the frozen race ----------
function pause(g, ui, app, t) {
  g.fillStyle = 'rgba(6,4,3,0.6)'; g.fillRect(0, 0, W, H);
  plate(g, 660, 250, 600, 560);
  hazard(g, 678, 268, 564, 22, t);
  text(g, 'PAUSED', W / 2, 380, 84, COL.ink, { font: HEAD, align: 'center', spacing: 8, shadow: true });
  const items = app.pauseItems?.() ?? ['resume'];
  const label = { resume: 'RESUME', sound: `SOUND ${app.soundOn ? 'ON' : 'OFF'}`, retire: 'RETIRE' };
  items.forEach((it, k) => {
    const sel = k === (app.pauseMenu ?? 0), y = 440 + k * 100;
    button(g, 740, y, 440, 72, label[it] ?? it.toUpperCase(), sel, t, { i: k }, { size: 34 });
  });
  if (items[app.pauseMenu] === 'retire') text(g, 'FORFEIT THE RACE AS A WRECK', W / 2, 770, 22, COL.red, { align: 'center', wgt: 700, spacing: 3 });
  prompt(g, app, '{menu} Choose   {start} Select   {pause} Resume', W / 2, 870, 26, COL.ink);
}

// ---------- the results ----------
const resultsLadder = new WeakMap();
function results(g, ui, app, t) {
  backdrop(g, ui, t);
  const rep = app.report ?? {}, R = app.results ?? { shown: 99, move: 1 }, C = app.career ?? {};
  const def = TRACKS.find(tr => tr.id === app.offer?.track);
  header(g, app, 'RACE RESULTS', `${(def?.name ?? '').toUpperCase()}  ·  ${(TIER[app.offer?.tier]?.name ?? '')}`, t);
  plate(g, 70, 186, 860, 800);
  // the place, big
  const big = rep.wrecked ? 'WRECKED' : rep.place ? nth(rep.place) : '—';
  g.save();
  g.translate(120, 380); g.transform(1, 0, -0.16, 1, 0, 0);
  const sz = rep.wrecked ? 120 : 190;
  g.font = `400 ${sz}px ${HEAD}`;
  const gr = g.createLinearGradient(0, -sz * 0.75, 0, 0);
  if (rep.wrecked) { gr.addColorStop(0, '#ffb0a0'); gr.addColorStop(1, '#8a1408'); }
  else if (rep.place === 1) { gr.addColorStop(0, '#fff4c8'); gr.addColorStop(0.5, '#ffc14a'); gr.addColorStop(1, '#b8461b'); }
  else { gr.addColorStop(0, '#f1e8d8'); gr.addColorStop(1, '#6b645c'); }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(big, 5, 8);
  g.fillStyle = gr; g.fillText(big, 0, 0);
  g.restore();
  const lines = [
    [rep.wrecked ? 'CAR WRECKED' : 'FINISHED', rep.wrecked ? 'LAST' : rep.place ? `${nth(rep.place)} OF 4` : '', COL.ink],
    ['PRIZE MONEY', `+${cash(rep.prize)}`, rep.prize ? COL.gold : COL.dim],
    ['CASH PICKED UP', `+${cash(rep.picked)}`, rep.picked ? COL.gold : COL.dim],
    [`BONUS  ·  ${rep.kills ?? 0} WRECKED BY YOU`, `+${cash(rep.bonus)}`, rep.bonus ? COL.gold : COL.dim],
    ['DAMAGE TO REPAIR', rep.repair ? cash(rep.repair) : 'NONE', rep.repair ? COL.red : COL.ok],
    ['RANKING POINTS', `${fmt(rep.pointsBefore)} ▸ ${fmt(rep.pointsAfter)}`, COL.ink],
  ];
  lines.slice(0, R.shown).forEach(([l, v, col], k) => {
    const y = 470 + k * 68, a = clamp01((app.stT - 0.6 - k * 0.45) * 4 + (R.shown >= 6 && app.stT > 4 ? 1 : 0));
    g.globalAlpha = Math.max(a, R.shown > k + 1 ? 1 : a);
    g.fillStyle = 'rgba(241,232,216,0.06)'; g.fillRect(110, y - 40, 780, 56);
    text(g, l, 130, y, 26, COL.dim, { wgt: 700, spacing: 2 });
    text(g, v, 870, y, 32, col, { font: HEAD, align: 'right' });
    g.globalAlpha = 1;
  });
  if (R.shown >= 6) text(g, `CASH  ${cash(C.cash)}`, 870, 940, 34, COL.gold, { font: HEAD, align: 'right' });
  // the ladder: every row slides from where it stood before the race to where it stands now
  let list = rep.after;
  if (!list) { list = resultsLadder.get(rep) ?? (app.career ? career.standings(app.career) : []); resultsLadder.set(rep, list); }
  const was = new Map((rep.before ?? []).map((r, k) => [r.id, k]));
  plate(g, 970, 186, 890, 800);
  const n = list.length, rh = Math.min(56, Math.floor(676 / Math.max(1, n))), y0 = 266;
  const e = ease(clamp01(R.move));
  const at = (r, k) => y0 + ((was.get(r.id) ?? k) + (k - (was.get(r.id) ?? k)) * e) * rh;
  const before = rep.rankBefore, after = rep.rankAfter;
  const up = before && after ? before - after : 0;
  const head = !after || !(rep.pointsAfter > 0) ? 'UNRANKED' : up > 0 ? `UP TO #${after}` : up < 0 ? `DOWN TO #${after}` : `HOLDING #${after}`;
  text(g, head, 1010, 240, 40, up > 0 ? COL.ok : up < 0 ? COL.red : COL.ink, { font: HEAD, spacing: 2 });
  g.save(); g.beginPath(); g.rect(970, y0 - 6, 890, n * rh + 12); g.clip();
  // the others first, so your row passes over them
  const order = list.map((r, k) => [r, k]).sort((a, b) => (a[0].you ? 1 : 0) - (b[0].you ? 1 : 0));
  for (const [r, k] of order) ladder(g, [{ ...r, points: R.move < 1 ? (rep.before?.[was.get(r.id)]?.points ?? r.points) : r.points }], 1000, 0, 830, rh, t, { rowY: () => at(r, k) });
  g.restore();
  if (R.move >= 1) prompt(g, app, rep.won ? '{start} Continue' : '{start} Paddock', 1415, 968, 28, blink(t) ? COL.gold : COL.ink);
  else prompt(g, app, '{start} Skip', 1415, 968, 24, COL.dim);
}

// ---------- the ending ----------
function flames(g, x, y, w, t, n = 22) {
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < n; k++) {
    const q = ((t * 0.9 + k * 0.137) % 1), xx = x + ((k * 0.618) % 1 - 0.5) * w + Math.sin(t * 3 + k) * 8, yy = y - q * 120, r = (1 - q) * 28 + 6;
    const rg = g.createRadialGradient(xx, yy, 0, xx, yy, r);
    rg.addColorStop(0, `rgba(255,220,120,${0.5 * (1 - q)})`); rg.addColorStop(0.5, `rgba(255,100,20,${0.35 * (1 - q)})`); rg.addColorStop(1, 'rgba(120,20,0,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(xx, yy, r, 0, TAU); g.fill();
  }
  g.restore();
}
function won(g, ui, app, t) {
  backdrop(g, ui, t);
  const C = app.career ?? {}, k = app.stT ?? 9, a = clamp01((k - 0.3) * 0.9);
  const champ = career.MODELS?.[career.MODELS.length - 1], mine = modelOf(C.model);
  if (champ) { car(g, champ.id, driverOf('marrow')?.colour ?? '#18181c', 1380, 690, 2.5, 46, { wreck: true, damage: 1 }); flames(g, 1380, 700, 160, t); }
  if (mine) car(g, mine.id, C.colour ?? COL.rust, 620, 700, -Math.PI / 2 - 0.4 + Math.sin(t) * 0.04, 50, { lights: true });
  hazard(g, 0, 0, W, 16, t);
  g.globalAlpha = a;
  text(g, 'CHAMPION', W / 2, 260, 170, COL.gold, { font: HEAD, align: 'center', spacing: 12, shadow: true });
  text(g, "IVO MARROW'S INTERCEPTOR BURNS ON THE LINE. THE SCORCH CIRCUIT IS YOURS.", W / 2, 330, 32, COL.ink, { align: 'center', wgt: 700, spacing: 3, shadow: true });
  g.globalAlpha = clamp01((k - 1.2) * 1.2);
  plate(g, 560, 860, 800, 110, { a: 0.85 });
  [['RACES', fmt(C.races)], ['WINS', fmt(C.wins)], ['EARNED', cash(C.earned ?? C.cash)]].forEach(([l, v], j) => {
    const x = 690 + j * 270;
    text(g, l, x, 900, 21, COL.dim, { align: 'center', wgt: 700, spacing: 4 });
    text(g, v, x, 948, 40, COL.ink, { font: HEAD, align: 'center' });
  });
  g.globalAlpha = 1;
  if (k > 2.5) prompt(g, app, '{start} Continue', W / 2, 1040, 28, blink(t) ? COL.gold : COL.ink);
}

// ---------- the initials, and the hall of fame ----------
function entry(g, ui, app, t) {
  backdrop(g, ui, t);
  const C = app.career ?? {}, E = app.entry ?? { letters: [0, 0, 0], pos: 0 };
  hazard(g, 0, 0, W, 16, t);
  plate(g, 510, 150, 900, 780);
  text(g, 'HALL OF FAME', W / 2, 260, 70, COL.gold, { font: HEAD, align: 'center', spacing: 6, shadow: true });
  text(g, `CHAMPION IN ${fmt(C.races)} RACES  ·  ${cash(C.earned ?? C.cash)} EARNED`, W / 2, 320, 28, COL.ink, { align: 'center', wgt: 700, spacing: 3 });
  text(g, 'YOUR INITIALS', W / 2, 400, 24, COL.dim, { align: 'center', wgt: 700, spacing: 5 });
  for (let k = 0; k < 3; k++) {
    const x = W / 2 + (k - 1) * 190, sel = k === E.pos;
    plate(g, x - 75, 440, 150, 200, { a: sel ? 0.95 : 0.7, cut: 14, rivets: false, edge: sel ? COL.hazard : 'rgba(241,232,216,0.15)', lw: sel ? 4 : 2 });
    text(g, LETTERS[E.letters[k]] ?? 'A', x, 590, 120, sel ? COL.hazard : COL.ink, { font: HEAD, align: 'center' });
    hot(x - 75, 440, 150, 200, { letter: k });
    // ▲ ▼ for a thumb
    for (const d of [1, -1]) {
      const cy = d > 0 ? 425 : 680;
      g.fillStyle = sel ? COL.hazard : COL.faint;
      g.beginPath(); g.moveTo(x - 26, cy + d * 12); g.lineTo(x + 26, cy + d * 12); g.lineTo(x, cy - d * 16); g.closePath(); g.fill();
      hot(x - 75, d > 0 ? 385 : 650, 150, 55, { letter: k, d });
    }
  }
  button(g, W / 2 - 200, 760, 400, 70, 'SIGN', true, t, { done: true }, { size: 34 });
  prompt(g, app, '{letters} Letters   {fire} Next   {start} Done', W / 2, 890, 26, COL.dim);
}
function scores(g, ui, app, t) {
  backdrop(g, ui, t);
  header(g, { ...app, career: null }, 'HALL OF FAME', 'THE DRIVERS WHO BURNED THE CHAMPION: FEWEST RACES FIRST', t);
  plate(g, 460, 190, 1000, 790);
  text(g, 'DRIVER', 620, 250, 22, COL.dim, { wgt: 700, spacing: 4 });
  text(g, 'RACES', 1050, 250, 22, COL.dim, { wgt: 700, spacing: 4, align: 'right' });
  text(g, 'EARNED', 1380, 250, 22, COL.dim, { wgt: 700, spacing: 4, align: 'right' });
  (app.hof ?? []).slice(0, 8).forEach((e, k) => {
    const y = 330 + k * 80, hl = k === app.hofRank, col = hl ? (blink(t, 4) ? COL.hazard : COL.ink) : COL.ink;
    if (hl) hazard(g, 490, y - 46, 14, 60, t);
    text(g, `${k + 1}`, 560, y, 40, k === 0 ? COL.gold : COL.dim, { font: HEAD, align: 'right' });
    text(g, e.n, 620, y, 50, col, { font: HEAD, spacing: 8 });
    text(g, fmt(e.r), 1050, y, 40, col, { font: HEAD, align: 'right' });
    text(g, cash(e.c), 1380, y, 40, k === 0 ? COL.gold : col, { font: HEAD, align: 'right' });
  });
  footer(g, app, '{start} Title', t);
}

const SCREENS = { title, paddock, events, garage, standings, pause, results, won, entry, scores };

/** the screen for app.state (none over the race itself or the demo) */
export function drawScreen(g, app, ui) {
  rects = []; rectsFor = app.state;
  const fn = SCREENS[app.state];
  if (!fn || !ui?.u) return;
  const t = app.t ?? 0;
  g.save();
  g.setTransform(ui.u, 0, 0, ui.u, 0, 0);
  try { fn(g, ui, app, t); } finally { g.restore(); }
}
