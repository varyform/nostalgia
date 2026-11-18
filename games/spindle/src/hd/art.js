// The HD look: one theme per tower (sky, sea, stone, ledges, weather) and the characters,
// drawn as vectors around a foot point at a scale `z` (pixels per row of the tower):
// Clink the brass diving bell, the urchin, the jellyfish, the door crab, the squall cloud,
// the drip, the kite and the sea-glass of the Kite Run.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- colour ----------
const cache = new Map();
export function rgb(hex) {
  let c = cache.get(hex);
  if (!c) { const n = parseInt(hex.slice(1), 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; cache.set(hex, c); }
  return c;
}
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const mix = (h1, h2, t, a = 1) => css(mixc(rgb(h1), rgb(h2), clamp(t, 0, 1)), a);

// ---------- themes ----------
// stone: lit, mid, dark; ledge: top, front; accent: blinking ledges, the crown door's glow
export const THEMES = {
  harbour: { sky: ['#4f9be6', '#9fd0f5', '#ffe6bd'], sea: ['#3d8cc2', '#0c3f68'], stone: ['#f1d4a0', '#c99a63', '#5e3c22'], mortar: '#7a5534', ledge: ['#fbeccc', '#b48352'], accent: '#7fe8ff', sun: { x: 0.22, y: 0.16, c: '#fff4cf', r: 0.06 }, isle: '#6a8fb0', weather: 'gulls', cloud: '#ffffff' },
  kelp: { sky: ['#5f8a86', '#9dbbb0', '#dce6d2'], sea: ['#3b7a6a', '#0f302b'], stone: ['#a9c48a', '#6a8a52', '#22331d'], mortar: '#3f5432', ledge: ['#cfe3a6', '#6f8f4a'], accent: '#c6ff7a', sun: null, isle: '#58786c', weather: 'mist', cloud: '#e7efe6' },
  coral: { sky: ['#2fa8ef', '#7fd3f7', '#fff0d0'], sea: ['#1cb7c6', '#06566c'], stone: ['#ffb7a6', '#e07466', '#6f2c36'], mortar: '#a64b4e', ledge: ['#fff0e2', '#e08a76'], accent: '#ff9df0', sun: { x: 0.78, y: 0.14, c: '#fffbe0', r: 0.07 }, isle: '#3fa38f', weather: 'gulls', cloud: '#ffffff' },
  rime: { sky: ['#8fb3d8', '#c8dcf0', '#f2f8ff'], sea: ['#6a9cc0', '#1d3d5c'], stone: ['#f2f8ff', '#a8c6e2', '#41607f'], mortar: '#7d9cbc', ledge: ['#ffffff', '#9ec0dd'], accent: '#9ffcff', sun: { x: 0.7, y: 0.22, c: '#f6fbff', r: 0.05 }, isle: '#9cb6cf', weather: 'snow', cloud: '#f4f8fc' },
  ember: { sky: ['#2c1640', '#a0405a', '#ff9a52'], sea: ['#6a3240', '#1a0c18'], stone: ['#f08a54', '#a8482a', '#401812'], mortar: '#6a2a1a', ledge: ['#ffc28a', '#a4502c'], accent: '#ffd25a', sun: { x: 0.18, y: 0.5, c: '#ffcf7a', r: 0.09 }, isle: '#4a2034', weather: 'embers', cloud: '#ffb08a' },
  glass: { sky: ['#071a33', '#17456a', '#3f86a6'], sea: ['#12505e', '#03141c'], stone: ['#8ff0e6', '#3aa6a6', '#0e3c44'], mortar: '#1e6a70', ledge: ['#d6fffa', '#3aa0a0'], accent: '#7affc8', sun: null, moon: { x: 0.8, y: 0.18, r: 0.035 }, isle: '#0f3046', weather: 'motes', cloud: '#5f9fbf', stars: 0.5 },
  storm: { sky: ['#1e242c', '#3d4652', '#6f7a86'], sea: ['#34414c', '#0a0f14'], stone: ['#c4cad2', '#7c8490', '#2c3038'], mortar: '#50565f', ledge: ['#e3e7ec', '#7e8692'], accent: '#a8d8ff', sun: null, isle: '#2c343e', weather: 'rain', cloud: '#59636f' },
  moon: { sky: ['#06051a', '#1c1446', '#4a3584'], sea: ['#221c52', '#04030e'], stone: ['#cbb8f2', '#7f66c0', '#251a52'], mortar: '#4f3f8a', ledge: ['#efe6ff', '#8670c8'], accent: '#ff9bf0', sun: null, moon: { x: 0.24, y: 0.17, r: 0.06 }, isle: '#170f3a', weather: 'motes', cloud: '#5a4a9a', stars: 1 },
};

/** an offscreen canvas */
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ---------- Clink, the brass diving bell ----------
// foot point (x, y), facing f (±1), z px per row; pose: { walk, air, squash, shoot, hurt, blink, t }
export function drawClink(g, x, y, f, z, pose) {
  const { walk = 0, air = 0, squash = 0, shoot = 0, hurt = 0, t = 0, alpha = 1 } = pose;
  const sx = 1 + squash * 0.22, sy = 1 - squash * 0.2;
  g.save();
  g.globalAlpha = alpha;
  g.translate(x, y);
  g.scale(sx * z / 100, sy * z / 100);
  // legs: two stubby boots that swing when walking, tuck when airborne
  const sw = Math.sin(walk * TAU) * 9;
  g.fillStyle = '#2b2a33';
  for (const k of [-1, 1]) {
    const lx = k * 14 + (k === 1 ? sw : -sw) * (air ? 0.2 : 1), ly = air ? -12 : -4 - Math.max(0, Math.cos(walk * TAU + (k > 0 ? 0 : Math.PI))) * 4;
    g.beginPath(); g.ellipse(lx + f * 3, ly + 2, 11, 6, 0, 0, TAU); g.fill();
    g.fillRect(lx - 3, ly - 14, 6, 14);
  }
  // the bell: a rounded dome on a flared rim
  const bob = air ? 0 : Math.abs(Math.sin(walk * TAU)) * -3;
  g.translate(0, bob);
  const body = g.createLinearGradient(-38, 0, 38, 0);
  body.addColorStop(0, '#7a4a17'); body.addColorStop(0.3, '#f6c45a'); body.addColorStop(0.45, '#fff0b8'); body.addColorStop(0.7, '#d08f2c'); body.addColorStop(1, '#5c3510');
  g.fillStyle = hurt > 0 && Math.floor(t * 20) % 2 ? '#ffffff' : body;
  g.beginPath();
  g.moveTo(-40, -18);
  g.quadraticCurveTo(-42, -30, -34, -40);
  g.bezierCurveTo(-30, -92, 30, -92, 34, -40);
  g.quadraticCurveTo(42, -30, 40, -18);
  g.closePath(); g.fill();
  // rim band with rivets
  g.fillStyle = '#8a5418';
  g.beginPath(); g.roundRect(-43, -26, 86, 12, 6); g.fill();
  g.fillStyle = '#ffd98a';
  for (let k = -3; k <= 3; k++) { g.beginPath(); g.arc(k * 12, -20, 2.4, 0, TAU); g.fill(); }
  // the valve on top, spinning in the air
  g.fillStyle = '#6b3f12'; g.fillRect(-4, -92, 8, 10);
  g.save(); g.translate(0, -94); g.scale(Math.cos(t * (air ? 24 : 3)), 1);
  g.fillStyle = '#c24a3a'; g.beginPath(); g.roundRect(-14, -4, 28, 8, 4); g.fill();
  g.restore();
  // porthole on the side he faces: glass, two eyes, a glint
  const px = f * 12;
  g.fillStyle = '#5c3510'; g.beginPath(); g.arc(px, -52, 22, 0, TAU); g.fill();
  g.fillStyle = '#ffd98a'; g.beginPath(); g.arc(px, -52, 19, 0, TAU); g.fill();
  const glass = g.createRadialGradient(px - 6, -60, 2, px, -52, 17);
  glass.addColorStop(0, '#d8fbff'); glass.addColorStop(0.5, '#59c7e8'); glass.addColorStop(1, '#1a5a7a');
  g.fillStyle = glass; g.beginPath(); g.arc(px, -52, 15.5, 0, TAU); g.fill();
  const blink = (t % 3.7) > 3.55 ? 0.15 : 1;
  g.fillStyle = '#10202c';
  for (const k of [-1, 1]) { g.beginPath(); g.ellipse(px + f * 4 + k * 5.5, -52, 2.6, 4.2 * blink * (hurt > 0 ? 0.4 : 1), 0, 0, TAU); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(px - 7, -60, 4, 2.5, -0.6, 0, TAU); g.fill();
  // a little nozzle on the front, puffing when he shoots
  g.fillStyle = '#8a5418';
  g.beginPath(); g.roundRect(f > 0 ? 30 : -42, -40 - shoot * 2, 12, 9, 3); g.fill();
  g.restore();
}

// ---------- the enemies ----------
export function drawUrchin(g, x, y, z, t, roll, alpha = 1) {
  const r = z * 0.32;
  g.save(); g.globalAlpha = alpha; g.translate(x, y - r);
  g.rotate(roll);
  g.strokeStyle = '#3b1450'; g.lineWidth = z * 0.05; g.lineCap = 'round';
  g.beginPath();
  for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; g.moveTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7); g.lineTo(Math.cos(a) * r * 1.45, Math.sin(a) * r * 1.45); }
  g.stroke();
  const b = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  b.addColorStop(0, '#e28cff'); b.addColorStop(1, '#6a1f8a');
  g.fillStyle = b; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  g.rotate(-roll);
  g.fillStyle = '#fff';
  for (const k of [-1, 1]) { g.beginPath(); g.arc(k * r * 0.35, -r * 0.1, r * 0.24, 0, TAU); g.fill(); }
  g.fillStyle = '#200830';
  for (const k of [-1, 1]) { g.beginPath(); g.arc(k * r * 0.35 + r * 0.05, -r * 0.05, r * 0.11, 0, TAU); g.fill(); }
  g.restore();
}
export function drawJelly(g, x, y, z, t, stun, alpha = 1) {
  const r = z * 0.36, pulse = Math.sin(t * 6) * 0.08;
  g.save(); g.globalAlpha = alpha * (stun ? 0.55 : 0.92); g.translate(x, y - z * 0.3);
  // tentacles
  g.strokeStyle = stun ? '#c9a4c4' : '#ff8fd0'; g.lineWidth = z * 0.035; g.lineCap = 'round';
  for (let k = -2; k <= 2; k++) {
    g.beginPath(); g.moveTo(k * r * 0.35, 0);
    for (let j = 1; j <= 4; j++) g.lineTo(k * r * 0.35 + Math.sin(t * 5 + j + k) * r * 0.14, j * r * 0.28);
    g.stroke();
  }
  const b = g.createRadialGradient(0, -r * 0.4, r * 0.1, 0, -r * 0.1, r * 1.1);
  b.addColorStop(0, stun ? '#f4e6f0' : '#ffe1f4'); b.addColorStop(0.6, stun ? '#b49ab0' : '#ff6fc0'); b.addColorStop(1, stun ? 'rgba(150,120,150,0.4)' : 'rgba(200,40,140,0.5)');
  g.fillStyle = b;
  g.beginPath(); g.ellipse(0, 0, r * (1 + pulse), r * (0.85 - pulse), 0, Math.PI, TAU); g.quadraticCurveTo(0, r * 0.25, -r * (1 + pulse), 0); g.fill();
  g.fillStyle = '#4a0c34';
  for (const k of [-1, 1]) { g.beginPath(); g.ellipse(k * r * 0.3, -r * 0.3, r * 0.08, stun ? r * 0.02 : r * 0.12, 0, 0, TAU); g.fill(); }
  if (stun) {
    g.fillStyle = '#fff6a0';
    for (let k = 0; k < 3; k++) { const a = t * 4 + (k * TAU) / 3; g.beginPath(); g.arc(Math.cos(a) * r * 0.8, -r * 1.05 + Math.sin(a) * r * 0.2, z * 0.04, 0, TAU); g.fill(); }
  }
  g.restore();
}
export function drawCrab(g, x, y, z, t, f, spin, alpha = 1) {
  const w = z * 0.42;
  g.save(); g.globalAlpha = alpha; g.translate(x, y);
  if (spin) g.rotate(spin);
  // legs
  g.strokeStyle = '#8a1e10'; g.lineWidth = z * 0.045; g.lineCap = 'round';
  for (const k of [-1, 1]) for (let j = 0; j < 3; j++) {
    const a = Math.sin(t * 14 + j * 1.3) * 0.2;
    g.beginPath(); g.moveTo(k * w * 0.4, -z * 0.18); g.lineTo(k * w * (0.85 + j * 0.12), -z * (0.08 - a * 0.2)); g.lineTo(k * w * (1 + j * 0.1), 0); g.stroke();
  }
  // claws held up
  for (const k of [-1, 1]) {
    const lift = Math.sin(t * 3 + k) * z * 0.04;
    g.beginPath(); g.moveTo(k * w * 0.6, -z * 0.3); g.lineTo(k * w * 0.95, -z * 0.55 + lift); g.stroke();
    g.fillStyle = '#ff5a3a'; g.beginPath(); g.ellipse(k * w * 1.02, -z * 0.66 + lift, z * 0.13, z * 0.1, k * 0.6, 0, TAU); g.fill();
    g.fillStyle = '#7a1408'; g.beginPath(); g.moveTo(k * w * 1.02, -z * 0.66 + lift); g.lineTo(k * w * 1.2, -z * 0.74 + lift); g.lineTo(k * w * 1.12, -z * 0.6 + lift); g.fill();
  }
  const b = g.createLinearGradient(0, -z * 0.5, 0, -z * 0.1);
  b.addColorStop(0, '#ff8a5a'); b.addColorStop(1, '#c2301c');
  g.fillStyle = b; g.beginPath(); g.ellipse(0, -z * 0.27, w * 0.75, z * 0.2, 0, 0, TAU); g.fill();
  // eye stalks
  for (const k of [-1, 1]) {
    g.strokeStyle = '#c2301c'; g.beginPath(); g.moveTo(k * w * 0.2, -z * 0.4); g.lineTo(k * w * 0.25 + f * z * 0.03, -z * 0.56); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(k * w * 0.25 + f * z * 0.03, -z * 0.58, z * 0.06, 0, TAU); g.fill();
    g.fillStyle = '#1a0604'; g.beginPath(); g.arc(k * w * 0.25 + f * z * 0.05, -z * 0.58, z * 0.03, 0, TAU); g.fill();
  }
  g.restore();
}
export function drawSquall(g, x, y, z, t, dir) {
  const r = z * 0.42;
  g.save(); g.translate(x, y);
  // wind streaks behind it
  g.strokeStyle = 'rgba(235,245,255,0.55)'; g.lineWidth = z * 0.035; g.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const yy = (k - 1.5) * r * 0.45, ph = (t * 3 + k * 0.37) % 1;
    g.beginPath(); g.moveTo(-dir * (r * 1.1 + ph * r * 1.6), yy); g.lineTo(-dir * (r * 1.6 + ph * r * 2.2), yy); g.stroke();
  }
  g.fillStyle = '#d6e0ea';
  for (const [dx, dy, rr] of [[-0.5, 0.1, 0.62], [0.05, -0.25, 0.75], [0.55, 0.05, 0.6], [0, 0.25, 0.6]]) {
    g.beginPath(); g.arc(dx * r * (1 + Math.sin(t * 7 + dx * 5) * 0.04), dy * r, rr * r, 0, TAU); g.fill();
  }
  g.fillStyle = '#9aa8b8'; g.beginPath(); g.ellipse(0, r * 0.45, r * 1.05, r * 0.22, 0, 0, TAU); g.fill();
  // grumpy face, cheeks puffed towards where it blows
  g.fillStyle = '#26303c';
  g.beginPath(); g.ellipse(dir * r * 0.15 - r * 0.22, -r * 0.05, r * 0.08, r * 0.12, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(dir * r * 0.15 + r * 0.22, -r * 0.05, r * 0.08, r * 0.12, 0, 0, TAU); g.fill();
  g.lineWidth = z * 0.035; g.strokeStyle = '#26303c';
  g.beginPath(); g.moveTo(dir * r * 0.15 - r * 0.36, -r * 0.3); g.lineTo(dir * r * 0.15 - r * 0.1, -r * 0.2); g.moveTo(dir * r * 0.15 + r * 0.36, -r * 0.3); g.lineTo(dir * r * 0.15 + r * 0.1, -r * 0.2); g.stroke();
  g.beginPath(); g.arc(dir * r * 0.45, r * 0.18, r * 0.1, 0, TAU); g.fill();
  g.restore();
}
export function drawDrip(g, x, y, z) {
  const r = z * 0.1;
  g.save(); g.translate(x, y);
  const b = g.createRadialGradient(-r * 0.3, 0, r * 0.1, 0, 0, r * 1.2);
  b.addColorStop(0, '#d8f4ff'); b.addColorStop(1, '#2a6a9a');
  g.fillStyle = b;
  g.beginPath(); g.moveTo(0, -r * 2.2); g.quadraticCurveTo(r * 1.1, -r * 0.2, 0, r); g.quadraticCurveTo(-r * 1.1, -r * 0.2, 0, -r * 2.2); g.fill();
  g.restore();
}

// ---------- the Kite Run ----------
export function drawKite(g, x, y, z, t, tilt) {
  g.save(); g.translate(x, y); g.rotate(tilt);
  const w = z * 0.9, h = z * 1.2;
  // tail
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = z * 0.025;
  g.beginPath(); g.moveTo(0, h * 0.6);
  for (let k = 1; k <= 6; k++) g.lineTo(Math.sin(t * 6 + k) * z * 0.12 - k * z * 0.12, h * 0.6 + k * z * 0.22);
  g.stroke();
  for (let k = 1; k <= 3; k++) { g.fillStyle = k % 2 ? '#ffd24a' : '#ff5a7a'; g.beginPath(); g.ellipse(Math.sin(t * 6 + k * 2) * z * 0.12 - k * 2 * z * 0.12, h * 0.6 + k * 2 * z * 0.22, z * 0.08, z * 0.05, 0.5, 0, TAU); g.fill(); }
  // the sail, four panels
  const pts = [[0, -h * 0.5], [w * 0.5, -h * 0.05], [0, h * 0.6], [-w * 0.5, -h * 0.05]];
  const cols = ['#ff5a7a', '#ffd24a', '#5ad1ff', '#ffffff'];
  for (let k = 0; k < 4; k++) {
    const a = pts[k], b = pts[(k + 1) % 4];
    g.fillStyle = cols[k]; g.beginPath(); g.moveTo(0, 0); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.fill();
  }
  g.strokeStyle = '#5a3a20'; g.lineWidth = z * 0.03;
  g.beginPath(); g.moveTo(0, -h * 0.5); g.lineTo(0, h * 0.6); g.moveTo(-w * 0.5, -h * 0.05); g.lineTo(w * 0.5, -h * 0.05); g.stroke();
  g.restore();
}
export function drawGem(g, x, y, z, t, hue) {
  const r = z * 0.2, s = 0.75 + Math.sin(t * 5 + x * 0.01) * 0.12;
  g.save(); g.translate(x, y); g.rotate(Math.sin(t * 2 + x * 0.02) * 0.3);
  const c = ['#7affd0', '#7ac8ff', '#ffa8e8', '#fff07a'][hue % 4];
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(0, 0, r * 1.8, 0, TAU); g.fill();
  g.fillStyle = c;
  g.beginPath(); g.moveTo(0, -r * 1.2 * s); g.lineTo(r * 0.8, -r * 0.2); g.lineTo(r * 0.4, r); g.lineTo(-r * 0.5, r * 0.9); g.lineTo(-r * 0.85, -r * 0.1); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.moveTo(-r * 0.2, -r * 0.8 * s); g.lineTo(r * 0.3, -r * 0.2); g.lineTo(-r * 0.4, -r * 0.1); g.fill();
  g.restore();
}
