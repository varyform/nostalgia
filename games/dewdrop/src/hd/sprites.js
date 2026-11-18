// HD sprites: Dew, the three burrs, glowberries, fireflies, the moonbloom, toadstools, lily
// pads and bramble knots as vector shapes. The context comes in scaled to 1 unit = 1 tile and
// every sprite is anchored at its feet (bottom centre) unless said otherwise.
import { PAL, TAU, glow, rgba } from './art.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = t => t * t * (3 - 2 * t);

// ---------- Dew ----------
// A drop of water with a leaf on top. Squash and stretch come from her speed and landings.
export function drawDew(g, p, t, { alpha = 1, hurt = 0 } = {}) {
  const cx = p.x + p.w / 2, fy = p.y + p.h;
  let sx = 1, sy = 1, lean = clamp(p.vx / 7, -1, 1) * 0.1, bob = 0;
  if (p.mode === 'air') { const s = clamp(Math.abs(p.vy) / 26, 0, 0.22); sy += s; sx -= s * 0.55; }
  else if (p.mode === 'ground') {
    if (p.landT < 0.14) { const k = 1 - p.landT / 0.14; sy -= 0.24 * k; sx += 0.2 * k; }
    if (Math.abs(p.vx) > 0.5) bob = Math.abs(Math.sin(p.runT * 16)) * 0.06;
  } else if (p.mode === 'climb') { sy = 1.08 + Math.sin(p.runT * 14) * 0.04; sx = 0.92; lean = 0; }
  else if (p.mode === 'rope') { sy = 1.12; sx = 0.9; lean = Math.sin(t * 3) * 0.05 + clamp(p.vx / 4, -1, 1) * 0.1; }
  const breathe = p.mode === 'ground' && Math.abs(p.vx) < 0.5 ? Math.sin(t * 2.6) * 0.025 : 0;
  sy += breathe; sx -= breathe * 0.6;
  g.save();
  g.globalAlpha = alpha;
  // hanging from a vine: the drop's tip clings to it, so she hangs from her top
  if (p.mode === 'rope') { g.translate(cx, p.y); g.rotate(lean); g.scale(sx, sy); g.translate(0, 1.0); }
  else { g.translate(cx, fy - bob); g.rotate(lean); g.scale(sx, sy); }
  // body
  const H = 1.0, R0 = 0.42;
  g.beginPath();
  g.moveTo(0, -H);
  g.bezierCurveTo(0.12, -H + 0.22, R0, -0.62, R0, -0.4);
  g.arc(0, -0.4, R0, 0, Math.PI);
  g.bezierCurveTo(-R0, -0.62, -0.12, -H + 0.22, 0, -H);
  g.closePath();
  const gr = g.createRadialGradient(-0.12, -0.55, 0.05, 0, -0.4, 0.62);
  gr.addColorStop(0, hurt ? '#ffe0e8' : '#e8fbff'); gr.addColorStop(0.45, '#7fd4f6'); gr.addColorStop(1, '#2a78c0');
  g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(210,246,255,0.75)'; g.lineWidth = 0.035; g.stroke();
  // shine
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.beginPath(); g.ellipse(-0.17, -0.6, 0.07, 0.13, -0.5, 0, TAU); g.fill();
  g.beginPath(); g.arc(-0.07, -0.78, 0.035, 0, TAU); g.fill();
  // face: eyes look where she's heading (up on a vine)
  const look = p.mode === 'climb' ? 0 : clamp(p.face, -1, 1) * 0.07, up = p.mode === 'climb' ? -0.05 : p.vy > 6 ? 0.03 : 0;
  const blink = (t % 3.4) < 0.12 || hurt > 0;
  for (const ex of [-0.13, 0.13]) {
    const x = ex + look, y = -0.42 + up;
    if (blink) { g.strokeStyle = '#123a5a'; g.lineWidth = 0.035; g.beginPath(); g.moveTo(x - 0.05, y); g.lineTo(x + 0.05, y); g.stroke(); continue; }
    g.fillStyle = '#10304e'; g.beginPath(); g.ellipse(x, y, 0.055, 0.085, 0, 0, TAU); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 0.02, y - 0.03, 0.022, 0, TAU); g.fill();
  }
  g.fillStyle = 'rgba(255,140,170,0.45)';
  g.beginPath(); g.ellipse(-0.25 + look, -0.3, 0.06, 0.035, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(0.25 + look, -0.3, 0.06, 0.035, 0, 0, TAU); g.fill();
  // a smile (an "o" in the air)
  g.strokeStyle = '#10304e'; g.lineWidth = 0.03;
  g.beginPath();
  if (p.mode === 'air' && p.vy < -4) g.arc(look, -0.27, 0.035, 0, TAU); else g.arc(look, -0.31, 0.06, 0.2, Math.PI - 0.2);
  g.stroke();
  // the leaf on her tip
  g.save(); g.translate(0, -H + 0.04); g.rotate(-0.6 + Math.sin(t * 3) * 0.12);
  g.fillStyle = '#5cc46a'; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(0.1, -0.12, 0.3, -0.06); g.quadraticCurveTo(0.12, 0.04, 0, 0); g.fill();
  g.restore();
  g.restore();
}

// ---------- the burrs ----------
const FOE = {
  chase: { body: '#b23a86', dark: '#5a1444', spike: '#e070b8', name: 'PRICKLE' },
  patrol: { body: '#7a8f2e', dark: '#34400f', spike: '#b6c85a', name: 'SNAG' },
  hop: { body: '#e0782c', dark: '#7a3410', spike: '#ffb05a', name: 'HOPBURR' },
};
export const FOE_COL = FOE;
export function drawBurr(g, kind, x, fy, { roll = 0, squash = 0, look = 0, t = 0, scale = 1, alpha = 1, mode = 'ground', vy = 0, crouch = 0 } = {}) {
  const C = FOE[kind], r = 0.36;
  let sx = 1, sy = 1;
  if (kind === 'hop' || crouch) {
    if (squash > 0) { const k = squash / 0.35; sy = 1 - 0.3 * k; sx = 1 + 0.25 * k; }
    else if (mode === 'air') { const s = clamp(Math.abs(vy) / 25, 0, 0.2); sy = 1 + s; sx = 1 - s * 0.5; }
  }
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, fy); g.scale(sx * scale, sy * scale);
  const cy = -r - 0.04;
  // feet for the pacing one
  if (kind === 'patrol') {
    const s = Math.sin(roll * 5);
    g.strokeStyle = C.dark; g.lineWidth = 0.07; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-0.14, cy + 0.2); g.lineTo(-0.16 + s * 0.08, -0.01); g.moveTo(0.14, cy + 0.2); g.lineTo(0.16 - s * 0.08, -0.01); g.stroke();
  }
  // spikes, turning as it rolls
  const ang = kind === 'chase' ? roll / r : kind === 'patrol' ? Math.sin(roll * 2.5) * 0.15 : t * 0.5;
  g.fillStyle = C.dark;
  for (let i = 0; i < 14; i++) {
    const a = ang + (i / 14) * TAU, a1 = a - 0.16, a2 = a + 0.16, L = r + (i % 2 ? 0.16 : 0.21);
    g.beginPath(); g.moveTo(Math.cos(a1) * r * 0.85, cy + Math.sin(a1) * r * 0.85); g.lineTo(Math.cos(a) * L, cy + Math.sin(a) * L); g.lineTo(Math.cos(a2) * r * 0.85, cy + Math.sin(a2) * r * 0.85); g.fill();
  }
  g.fillStyle = C.spike;
  for (let i = 0; i < 14; i += 2) {
    const a = ang + (i / 14) * TAU, L = r + 0.17;
    g.beginPath(); g.arc(Math.cos(a) * L, cy + Math.sin(a) * L, 0.025, 0, TAU); g.fill();
  }
  const gr = g.createRadialGradient(-0.1, cy - 0.12, 0.02, 0, cy, r);
  gr.addColorStop(0, C.spike); gr.addColorStop(0.6, C.body); gr.addColorStop(1, C.dark);
  g.fillStyle = gr; g.beginPath(); g.arc(0, cy, r, 0, TAU); g.fill();
  // fuzz
  g.strokeStyle = rgba(C.dark, 0.6); g.lineWidth = 0.02;
  for (let i = 0; i < 8; i++) { const a = ang * 0.5 + i * 0.8; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5); g.lineTo(Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8); g.stroke(); }
  // grumpy face, always upright, eyes on Dew
  const lx = clamp(look, -1, 1) * 0.06;
  for (const ex of [-0.13, 0.13]) {
    g.fillStyle = '#fff8ee'; g.beginPath(); g.ellipse(ex + lx * 0.5, cy - 0.02, 0.085, 0.075, 0, 0, TAU); g.fill();
    g.fillStyle = '#1a0a12'; g.beginPath(); g.arc(ex + lx, cy - 0.01, 0.04, 0, TAU); g.fill();
  }
  g.strokeStyle = '#1a0a12'; g.lineWidth = 0.045; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-0.23, cy - 0.14); g.lineTo(-0.05, cy - 0.08); g.moveTo(0.23, cy - 0.14); g.lineTo(0.05, cy - 0.08); g.stroke();
  g.lineWidth = 0.03;
  g.beginPath(); g.arc(0, cy + 0.17, 0.08, Math.PI + 0.5, TAU - 0.5); g.stroke();
  g.restore();
}

// ---------- glowberry: a little cluster with a leaf ----------
export function drawBerry(g, P, x, y, t, s = 1) {
  const b = Math.sin(t * 2.4 + x * 1.3) * 0.06;
  g.save(); g.translate(x, y + b); g.scale(s, s);
  g.strokeStyle = P.vine[1]; g.lineWidth = 0.04;
  g.beginPath(); g.moveTo(0, -0.3); g.quadraticCurveTo(0.02, -0.15, -0.1, 0); g.moveTo(0, -0.3); g.quadraticCurveTo(0.05, -0.15, 0.12, 0.02); g.stroke();
  for (const [bx, by, r] of [[-0.12, 0.06, 0.15], [0.13, 0.08, 0.14], [0.01, 0.18, 0.15]]) {
    g.fillStyle = P.berry[0]; g.beginPath(); g.arc(bx, by, r, 0, TAU); g.fill();
    g.fillStyle = P.berry[1]; g.beginPath(); g.arc(bx - r * 0.2, by - r * 0.2, r * 0.6, 0, TAU); g.fill();
    g.fillStyle = P.berry[2]; g.beginPath(); g.arc(bx - r * 0.35, by - r * 0.35, r * 0.22, 0, TAU); g.fill();
  }
  g.fillStyle = P.leaf[1];
  g.beginPath(); g.moveTo(0, -0.3); g.quadraticCurveTo(0.2, -0.42, 0.34, -0.3); g.quadraticCurveTo(0.18, -0.24, 0, -0.3); g.fill();
  g.restore();
}

export function fireflyPos(f, t, i) {
  return { x: f.x + Math.sin(t * 1.3 + i * 2.1) * 0.28, y: f.y + Math.sin(t * 2.1 + i) * 0.2 };
}
export function drawFirefly(g, x, y, t, i) {
  const pulse = 0.6 + Math.sin(t * 5 + i * 3) * 0.4;
  g.fillStyle = '#3a3020';
  g.beginPath(); g.ellipse(x, y, 0.09, 0.06, 0, 0, TAU); g.fill();
  g.fillStyle = `rgba(230,255,160,${0.6 + pulse * 0.4})`;
  g.beginPath(); g.arc(x - 0.08, y + 0.02, 0.07, 0, TAU); g.fill();
  g.fillStyle = 'rgba(220,240,255,0.5)';
  const w = Math.abs(Math.sin(t * 40 + i)) * 0.04;
  g.beginPath(); g.ellipse(x + 0.02, y - 0.07, 0.07, 0.03 + w, -0.4, 0, TAU); g.fill();
  return pulse;
}

// ---------- the moonbloom: a bud that opens when every berry is gathered ----------
// fill: share of berries taken (the petals light up); open: 0..1 how far it has bloomed.
export function drawBloom(g, P, x, fy, t, fill, open, closing = 0) {
  g.save(); g.translate(x, fy);
  // stem and leaves
  g.strokeStyle = P.vine[0]; g.lineWidth = 0.1; g.lineCap = 'round';
  g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(0.12, -0.5, 0, -0.95); g.stroke();
  g.fillStyle = P.leaf[0];
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0.03, -0.25); g.quadraticCurveTo(s * 0.45, -0.45, s * 0.6, -0.15); g.quadraticCurveTo(s * 0.3, -0.15, 0.03, -0.25); g.fill(); }
  const cy = -1.25, o = ease(clamp(open - closing, 0, 1)), sway = Math.sin(t * 1.4) * 0.05 * (1 - o);
  g.translate(0, cy); g.rotate(sway);
  const petals = 7, lit = fill;
  for (let k = 0; k < 2; k++) // back row then front row
    for (let i = 0; i < petals; i++) {
      const base = (i / (petals - 1) - 0.5) * (0.5 + o * 2.2), a = base + (k ? 0.12 : -0.12) - Math.PI / 2;
      const len = 0.62 + o * 0.08 - k * 0.06, wid = 0.2 + o * 0.06;
      const on = i / petals < lit;
      g.save(); g.rotate(a + Math.PI / 2);
      g.beginPath(); g.moveTo(0, 0.12);
      g.bezierCurveTo(-wid, -len * 0.3, -wid * 0.6, -len, 0, -len);
      g.bezierCurveTo(wid * 0.6, -len, wid, -len * 0.3, 0, 0.12);
      g.fillStyle = on ? (k ? '#f2e6ff' : '#d8c8f4') : k ? '#8a7aa8' : '#6a5a88';
      g.fill();
      g.strokeStyle = on ? 'rgba(255,255,255,0.7)' : 'rgba(40,30,60,0.6)'; g.lineWidth = 0.025; g.stroke();
      g.restore();
    }
  if (o > 0.05) {
    g.fillStyle = `rgba(255,248,210,${o})`; g.beginPath(); g.arc(0, -0.05, 0.16, 0, TAU); g.fill();
    glow(g, 'moon', 0, -0.1, 0.9 + o * 0.6 + Math.sin(t * 3) * 0.1, 0.5 * o);
  }
  g.restore();
}

// ---------- props ----------
export function drawToadstool(g, c, r, squash, t) {
  const x = c + 0.5, fy = r + 1, k = squash > 0 ? Math.sin((squash / 0.3) * Math.PI) : 0;
  g.save(); g.translate(x, fy); g.scale(1 + k * 0.18, 1 - k * 0.28);
  g.fillStyle = '#efe4d0'; g.beginPath(); g.roundRect(-0.16, -0.55, 0.32, 0.55, 0.08); g.fill();
  const gr = g.createLinearGradient(0, -1.0, 0, -0.5);
  gr.addColorStop(0, '#ff7a6a'); gr.addColorStop(1, '#c0283a');
  g.fillStyle = gr; g.beginPath(); g.ellipse(0, -0.55, 0.55, 0.42, 0, Math.PI, TAU); g.fill();
  g.fillStyle = '#8a1a2a'; g.fillRect(-0.55, -0.57, 1.1, 0.06);
  g.fillStyle = '#fff6e6';
  for (const [sx, sy, sr] of [[-0.28, -0.72, 0.08], [0.05, -0.86, 0.09], [0.32, -0.7, 0.07], [-0.05, -0.65, 0.05]]) { g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fill(); }
  g.restore();
  glow(g, 'warm', x, fy - 0.7, 0.8, 0.08 + Math.sin(t * 2 + c) * 0.03);
}
export function drawPad(g, P, x, y, w, t) {
  const cx = x + w / 2, ry = 0.2, rx = w / 2 + 0.1, b = Math.sin(t * 2 + x) * 0.02;
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(cx, y + 0.22 + b, rx, ry, 0, 0, TAU); g.fill();
  g.fillStyle = P.leaf[0]; g.beginPath(); g.ellipse(cx, y + 0.12 + b, rx, ry, 0, 0.25, TAU - 0.25); g.lineTo(cx, y + 0.12 + b); g.closePath(); g.fill();
  g.fillStyle = P.leaf[1]; g.beginPath(); g.ellipse(cx, y + 0.08 + b, rx * 0.92, ry * 0.8, 0, 0.3, TAU - 0.3); g.lineTo(cx, y + 0.08 + b); g.closePath(); g.fill();
  g.strokeStyle = rgba(P.leaf[2], 0.6); g.lineWidth = 0.02;
  for (let i = 0; i < 5; i++) { const a = 0.6 + i * 1.1; g.beginPath(); g.moveTo(cx, y + 0.08 + b); g.lineTo(cx + Math.cos(a) * rx * 0.85, y + 0.08 + b + Math.sin(a) * ry * 0.7); g.stroke(); }
  g.fillStyle = '#ffd6ee'; g.beginPath(); g.arc(cx - rx * 0.45, y + 0.02 + b, 0.08, 0, TAU); g.fill();
}
export function drawLeafPlatform(g, P, c, r, st, t, shake) {
  if (st === 2) { // fallen: a faint outline where it grows back
    g.strokeStyle = rgba(P.leaf[2], 0.18); g.lineWidth = 0.03; g.setLineDash([0.08, 0.08]);
    g.beginPath(); g.ellipse(c + 0.5, r + 0.12, 0.5, 0.12, 0, 0, TAU); g.stroke(); g.setLineDash([]);
    return;
  }
  const dx = st === 1 ? Math.sin(t * 60 + c) * 0.05 * shake : 0, dy = st === 1 ? 0.04 * shake : 0;
  g.save(); g.translate(c + 0.5 + dx, r + 0.12 + dy); g.rotate(st === 1 ? Math.sin(t * 45 + c) * 0.05 : 0);
  g.fillStyle = st === 1 ? '#b8823a' : P.leaf[0];
  g.beginPath(); g.moveTo(-0.55, 0); g.quadraticCurveTo(0, -0.22, 0.55, 0); g.quadraticCurveTo(0, 0.2, -0.55, 0); g.fill();
  g.fillStyle = st === 1 ? '#d8a04a' : P.leaf[1];
  g.beginPath(); g.moveTo(-0.5, -0.02); g.quadraticCurveTo(0, -0.18, 0.5, -0.02); g.quadraticCurveTo(0, 0.06, -0.5, -0.02); g.fill();
  g.strokeStyle = rgba(P.leaf[2], 0.7); g.lineWidth = 0.02;
  g.beginPath(); g.moveTo(-0.45, -0.02); g.lineTo(0.45, -0.02); g.stroke();
  g.restore();
}
export function drawKnot(g, P, x, fy, t, warn) {
  const sh = warn ? Math.sin(t * 50) * 0.04 * warn : 0;
  g.save(); g.translate(x + sh, fy);
  g.strokeStyle = P.thorn[0]; g.lineWidth = 0.09; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    g.beginPath(); g.ellipse(0, -0.18, 0.42 - i * 0.08, 0.16 + i * 0.03, i * 0.7, 0, TAU); g.stroke();
  }
  g.fillStyle = P.thorn[1];
  for (let i = 0; i < 7; i++) { const a = i * 0.9, px = Math.cos(a) * 0.4, py = -0.18 + Math.sin(a) * 0.17; g.beginPath(); g.moveTo(px - 0.04, py); g.lineTo(px + Math.cos(a) * 0.14, py + Math.sin(a) * 0.14 - 0.04); g.lineTo(px + 0.04, py); g.fill(); }
  g.restore();
  if (warn) {
    glow(g, 'red', x, fy - 0.3, 1.1 + Math.sin(t * 12) * 0.15, 0.55 * warn);
    // "!" bubble
    const y = fy - 1.25 - Math.abs(Math.sin(t * 6)) * 0.12;
    g.fillStyle = `rgba(255,236,230,${0.9 * warn})`; g.beginPath(); g.arc(x, y, 0.24, 0, TAU); g.fill();
    g.fillStyle = `rgba(200,40,50,${warn})`; g.fillRect(x - 0.035, y - 0.15, 0.07, 0.17); g.beginPath(); g.arc(x, y + 0.11, 0.04, 0, TAU); g.fill();
  }
}
export { PAL };
