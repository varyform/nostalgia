// The animated figures, drawn as vectors in tile units: (0, 0) is the top-left of the tile the
// figure stands in, feet at y = 1. Wren the lantern diver, the stone sentinels, the glimmers.
import { TAU, rgba } from './art.js';

const WREN = { suit: '#2fb7a6', suitDark: '#1b7c74', brass: '#e0a646', brassDark: '#8a5a1c', glass: '#ffe7a3', scarf: '#ff6f5e', skin: '#2a1d16' };
const limb = (g, x0, y0, x1, y1, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
const bend = (g, x0, y0, xm, ym, x1, y1, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(xm, ym); g.lineTo(x1, y1); g.stroke(); };

// pose: stand | run | ladder | bar | fall | dig;  ph: animation phase (radians); face: ±1
export function drawWren(g, x, y, { pose, ph = 0, face = 1, t = 0, dig = 0, alpha = 1 }) {
  g.save();
  g.translate(x + 0.5, y);
  if (pose !== 'ladder' && face < 0) g.scale(-1, 1);
  g.globalAlpha = alpha;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const W = WREN, s = Math.sin(ph), c2 = Math.cos(ph);
  if (pose === 'ladder') {
    // seen from behind, hands on the rails in turn
    const up = s * 0.1;
    bend(g, -0.1, 0.68, -0.13, 0.82 - up * 0.6, -0.12, 0.97 - Math.max(0, up), 0.11, W.suitDark);
    bend(g, 0.1, 0.68, 0.13, 0.82 + up * 0.6, 0.12, 0.97 - Math.max(0, -up), 0.11, W.suitDark);
    g.fillStyle = W.suit; g.beginPath(); g.roundRect(-0.17, 0.4, 0.34, 0.33, 0.08); g.fill();
    g.fillStyle = W.brass; g.beginPath(); g.roundRect(-0.1, 0.42, 0.2, 0.24, 0.06); g.fill();
    g.fillStyle = W.brassDark; g.fillRect(-0.1, 0.5, 0.2, 0.025);
    bend(g, -0.15, 0.46, -0.27, 0.35 - up, -0.3, 0.22 - up * 1.4, 0.09, W.suit);
    bend(g, 0.15, 0.46, 0.27, 0.35 + up, 0.3, 0.22 + up * 1.4, 0.09, W.suit);
    helmet(g, 0, 0.27, false, t);
  } else if (pose === 'bar') {
    // hanging from the rope, hand over hand
    const sw = s * 0.12;
    bend(g, -0.06, 0.62, -0.12 + sw * 0.5, 0.78, -0.1 + sw, 0.92, 0.11, W.suitDark);
    bend(g, 0.06, 0.62, 0.12 + sw * 0.5, 0.76, 0.14 + sw * 0.8, 0.9, 0.11, W.suitDark);
    g.fillStyle = W.suit; g.beginPath(); g.roundRect(-0.15, 0.36, 0.3, 0.3, 0.08); g.fill();
    limb(g, -0.1, 0.4, -0.16 - s * 0.08, 0.19 + Math.max(0, s) * 0.05, 0.09, W.suit);
    limb(g, 0.1, 0.4, 0.16 - s * 0.08, 0.19 + Math.max(0, -s) * 0.05, 0.09, W.suit);
    scarf(g, -0.12, 0.38, t, 0.4);
    helmet(g, 0.02, 0.27, true, t);
  } else if (pose === 'fall') {
    bend(g, -0.06, 0.66, -0.2, 0.78, -0.14, 0.95, 0.11, W.suitDark);
    bend(g, 0.06, 0.66, 0.2, 0.74, 0.16, 0.9, 0.11, W.suitDark);
    tank(g);
    g.fillStyle = W.suit; g.beginPath(); g.roundRect(-0.15, 0.4, 0.3, 0.3, 0.08); g.fill();
    limb(g, -0.1, 0.44, -0.26, 0.2 + s * 0.04, 0.09, W.suit);
    limb(g, 0.1, 0.44, 0.26, 0.22 - s * 0.04, 0.09, W.suit);
    scarf(g, -0.12, 0.42, t, -0.6);
    helmet(g, 0.02, 0.28, true, t);
  } else if (pose === 'dig') {
    // crouched, swinging the coral pick down at the brick ahead
    const k = Math.sin(dig * Math.PI * 3) * 0.5 + 0.5;
    bend(g, -0.05, 0.72, -0.2, 0.8, -0.18, 0.98, 0.12, W.suitDark);
    bend(g, 0.06, 0.72, 0.2, 0.84, 0.16, 0.98, 0.12, W.suitDark);
    tank(g, 0.06);
    g.fillStyle = W.suit; g.beginPath(); g.roundRect(-0.15, 0.46, 0.3, 0.28, 0.08); g.fill();
    const ax = 0.22 + k * 0.12, ay = 0.5 - k * 0.12 + (1 - k) * 0.2;
    limb(g, 0.08, 0.52, ax, ay, 0.09, W.suit);
    // the pick: a haft and a pale coral head
    const hx = ax + 0.22, hy = ay + 0.14 - k * 0.2;
    limb(g, ax, ay, hx, hy, 0.045, '#7a5a3a');
    g.fillStyle = '#ffd9c4'; g.beginPath(); g.moveTo(hx - 0.05, hy - 0.08); g.lineTo(hx + 0.08, hy + 0.06); g.lineTo(hx + 0.02, hy + 0.08); g.closePath(); g.fill();
    scarf(g, -0.12, 0.48, t, 0.1);
    helmet(g, 0.05, 0.36, true, t);
  } else {
    // stand / run
    const run = pose === 'run', a = run ? s * 0.55 : 0, bob = run ? Math.abs(c2) * 0.03 : Math.sin(t * 2.2) * 0.008;
    g.translate(0, -bob);
    const leg = (ang, col) => {
      const kx = Math.sin(ang) * 0.16, ky = 0.84 - Math.abs(Math.sin(ang)) * 0.02;
      bend(g, 0, 0.68, kx * 0.9, ky, kx * 1.25 + (ang > 0 ? 0.04 : -0.02), 0.98 + bob, 0.12, col);
    };
    leg(-a, W.suitDark);
    tank(g);
    leg(a, W.suitDark);
    g.fillStyle = W.suit; g.beginPath(); g.roundRect(-0.15, 0.4, 0.3, 0.32, 0.08); g.fill();
    g.fillStyle = W.suitDark; g.fillRect(-0.15, 0.6, 0.3, 0.04);
    limb(g, 0.02, 0.46, 0.02 - Math.sin(a) * 0.2, 0.66, 0.09, W.suit);
    scarf(g, -0.12, 0.42, t, run ? 0.8 : 0.2);
    helmet(g, 0.03, 0.27, true, t);
  }
  g.restore();
}
function tank(g, dy = 0) {
  g.fillStyle = WREN.brass; g.beginPath(); g.roundRect(-0.27, 0.42 + dy, 0.14, 0.26, 0.06); g.fill();
  g.fillStyle = WREN.brassDark; g.fillRect(-0.27, 0.5 + dy, 0.14, 0.025);
}
function scarf(g, x, y, t, wind) {
  g.fillStyle = WREN.scarf;
  g.beginPath(); g.moveTo(x + 0.06, y - 0.04);
  const w1 = Math.sin(t * 7) * 0.04, w2 = Math.sin(t * 7 + 1.4) * 0.05;
  g.quadraticCurveTo(x - 0.12, y - 0.02 + w1 - wind * 0.06, x - 0.28, y + 0.02 + w2 - wind * 0.1);
  g.lineTo(x - 0.24, y + 0.08 + w2 - wind * 0.08);
  g.quadraticCurveTo(x - 0.1, y + 0.06 + w1, x + 0.06, y + 0.04);
  g.fill();
}
// the brass helmet; from the front a glowing visor, from behind a back plate
function helmet(g, x, y, front, t) {
  const W = WREN;
  g.fillStyle = W.brassDark; g.beginPath(); g.arc(x, y + 0.01, 0.17, 0, TAU); g.fill();
  const gr = g.createRadialGradient(x - 0.06, y - 0.07, 0.02, x, y, 0.17);
  gr.addColorStop(0, '#fff0bf'); gr.addColorStop(0.5, W.brass); gr.addColorStop(1, W.brassDark);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, 0.155, 0, TAU); g.fill();
  if (front) {
    g.fillStyle = '#3a2a16'; g.beginPath(); g.arc(x + 0.05, y + 0.01, 0.095, 0, TAU); g.fill();
    const v = g.createRadialGradient(x + 0.07, y - 0.01, 0.01, x + 0.05, y + 0.01, 0.085);
    v.addColorStop(0, '#fffbe6'); v.addColorStop(0.6, W.glass); v.addColorStop(1, '#d58a2a');
    g.fillStyle = v; g.beginPath(); g.arc(x + 0.05, y + 0.01, 0.075, 0, TAU); g.fill();
  } else {
    g.strokeStyle = W.brassDark; g.lineWidth = 0.025;
    g.beginPath(); g.arc(x, y, 0.09, 0, TAU); g.stroke();
  }
  // the lamp on top
  g.fillStyle = W.brassDark; g.fillRect(x - 0.03, y - 0.2, 0.06, 0.06);
  g.fillStyle = `rgba(255,236,170,${0.85 + Math.sin(t * 9) * 0.1})`; g.beginPath(); g.arc(x, y - 0.205, 0.035, 0, TAU); g.fill();
}

// a stone sentinel. pose: stand | run | ladder | bar | fall | trap | climb; carry: it holds a glimmer
export function drawSentinel(g, x, y, Z, { pose, ph = 0, face = 1, t = 0, carry = false, shake = 0, alpha = 1, id = 0 }) {
  const [dark, mid, light] = Z.golem;
  g.save();
  g.translate(x + 0.5 + shake, y);
  if (face < 0 && pose !== 'ladder') g.scale(-1, 1);
  g.globalAlpha = alpha;
  g.lineJoin = 'round'; g.lineCap = 'round';
  const s = Math.sin(ph), walk = pose === 'run';
  const block = (x0, y0, w, h, col, r = 0.04) => { g.fillStyle = col; g.beginPath(); g.roundRect(x0, y0, w, h, r); g.fill(); };
  // legs
  if (pose === 'bar' || pose === 'fall' || pose === 'trap' || pose === 'climb') {
    block(-0.2, 0.74, 0.13, 0.22, dark); block(0.07, 0.74, 0.13, 0.22, dark);
  } else {
    const a = walk ? s * 0.09 : 0;
    block(-0.2 + a, 0.76, 0.14, 0.22 - Math.max(0, a), dark);
    block(0.06 - a, 0.76, 0.14, 0.22 - Math.max(0, -a), dark);
  }
  // body: a tapering block, lit from above
  const gr = g.createLinearGradient(0, 0.3, 0, 0.82);
  gr.addColorStop(0, light); gr.addColorStop(0.6, mid); gr.addColorStop(1, dark);
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(-0.3, 0.36); g.lineTo(0.3, 0.36); g.lineTo(0.22, 0.8); g.lineTo(-0.22, 0.8); g.closePath(); g.fill();
  // carved rune, faintly alive
  g.strokeStyle = `rgba(${Z.rune},${0.35 + Math.sin(t * 3 + id) * 0.15})`; g.lineWidth = 0.03;
  g.beginPath(); g.moveTo(-0.08, 0.48); g.lineTo(0, 0.62); g.lineTo(0.08, 0.48); g.moveTo(0, 0.62); g.lineTo(0, 0.72); g.stroke();
  if (carry) {
    drawShard(g, 0, 0.56, Z, t, 0.5);
  }
  // arms
  let la, ra;
  if (pose === 'bar' || pose === 'fall' || pose === 'trap' || pose === 'climb') {
    const k = pose === 'trap' ? Math.sin(t * 14 + id) * 0.06 : pose === 'climb' ? s * 0.08 : pose === 'bar' ? s * 0.06 : 0;
    la = [-0.3, 0.4, -0.26, 0.12 + k]; ra = [0.3, 0.4, 0.26, 0.12 - k];
  } else if (pose === 'ladder') {
    la = [-0.28, 0.42, -0.3, 0.24 + s * 0.1]; ra = [0.28, 0.42, 0.3, 0.24 - s * 0.1];
  } else {
    const a = walk ? s * 0.12 : 0;
    la = [-0.28, 0.42, -0.34 - a, 0.66]; ra = [0.28, 0.42, 0.34 + a, 0.66];
  }
  g.strokeStyle = mid; g.lineWidth = 0.12;
  g.beginPath(); g.moveTo(la[0], la[1]); g.lineTo(la[2], la[3]); g.moveTo(ra[0], ra[1]); g.lineTo(ra[2], ra[3]); g.stroke();
  g.fillStyle = dark;
  g.beginPath(); g.arc(la[2], la[3], 0.07, 0, TAU); g.arc(ra[2], ra[3], 0.07, 0, TAU); g.fill();
  // head: a heavy slab with an eye slit
  block(-0.2, 0.08, 0.4, 0.28, mid, 0.06);
  block(-0.2, 0.08, 0.4, 0.06, light, 0.04);
  if (pose !== 'ladder') {
    const blink = (t * 0.7 + id * 0.37) % 4 < 0.08 ? 0.2 : 1;
    g.fillStyle = Z.eye; g.globalAlpha = alpha * blink;
    g.fillRect(-0.04, 0.19, 0.22, 0.05);
    g.globalAlpha = alpha;
  } else {
    g.strokeStyle = dark; g.lineWidth = 0.025; g.beginPath(); g.moveTo(-0.12, 0.2); g.lineTo(0.12, 0.2); g.stroke();
  }
  g.restore();
}

// a glimmer: a faceted crystal, slowly turning
export function drawShard(g, x, y, Z, t, scale = 1) {
  const [deep, bright, white] = Z.shard, turn = Math.sin(t * 1.7 + x * 2.1) * 0.5 + 0.5;
  g.save(); g.translate(x, y); g.scale(scale, scale);
  const w = 0.13 + turn * 0.07, h = 0.3;
  g.fillStyle = deep;
  g.beginPath(); g.moveTo(0, -h); g.lineTo(w, -h * 0.35); g.lineTo(w * 0.8, h * 0.5); g.lineTo(0, h * 0.75); g.lineTo(-w * 0.8, h * 0.5); g.lineTo(-w, -h * 0.35); g.closePath(); g.fill();
  g.fillStyle = bright;
  g.beginPath(); g.moveTo(0, -h); g.lineTo(w * (0.2 + turn * 0.6), -h * 0.3); g.lineTo(w * 0.3, h * 0.55); g.lineTo(-w * 0.6, h * 0.45); g.lineTo(-w, -h * 0.35); g.closePath(); g.fill();
  g.fillStyle = white; g.globalAlpha *= 0.85;
  g.beginPath(); g.moveTo(-w * 0.45, -h * 0.4); g.lineTo(-w * 0.1, -h * 0.75); g.lineTo(-w * 0.05, -h * 0.1); g.closePath(); g.fill();
  g.restore();
}
export const shardGlow = Z => Z.glow;
export const rgbaOf = rgba;
