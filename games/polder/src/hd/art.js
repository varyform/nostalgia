// The look of Polder: the four lights the stages are seen in (dawn, a bright noon, dusk, a
// moonlit night), the colour helpers, soft glows, and the actors drawn as lit vectors: the
// jellies and sea nettles, the shore crabs, Maren's skimmer, pearls and conches. Each drawer
// takes a 2D context in the reference frame, a centre, a size in reference units and a time.
export const TAU = Math.PI * 2;

export const LIGHTS = [
  { name: 'dawn', bg0: '#2c1e35', bg1: '#0c0a13', sea0: '#18465a', sea1: '#2e6e74', deep: '#0f3346', glint: '#ffdcbc', grass: ['#6f9b52', '#74a056', '#6a964e'],
    dyke: ['#8b7656', '#84714f'], sand: '#d9c391', built: '#b99d69', foam: '#fff1e2', accent: '#ffb37c', jelly: '#d2b1ff', haze: '#ff9e86', flower: ['#ffd1dc', '#fff3b0'] },
  { name: 'noon', bg0: '#123447', bg1: '#06121b', sea0: '#0e5873', sea1: '#2a919a', deep: '#0a4058', glint: '#f2fdff', grass: ['#73ae4b', '#79b450', '#6ea847'],
    dyke: ['#8f7f5e', '#887859'], sand: '#e8d59e', built: '#c3a872', foam: '#ffffff', accent: '#ffe08a', jelly: '#a3ecff', haze: '#bfefff', flower: ['#ffffff', '#ffe36b'] },
  { name: 'dusk', bg0: '#3b1f3e', bg1: '#110a16', sea0: '#2a2955', sea1: '#594a7c', deep: '#1d1c42', glint: '#ffba88', grass: ['#5f7f45', '#648549', '#5a7942'],
    dyke: ['#7b6550', '#745f4b'], sand: '#cfa978', built: '#ab8c63', foam: '#ffe0cc', accent: '#ff9b6b', jelly: '#ffa3d4', haze: '#ff8a6a', flower: ['#ffb0c8', '#ffd38a'] },
  { name: 'night', bg0: '#0d1931', bg1: '#03060d', sea0: '#0b1d38', sea1: '#183b5e', deep: '#071429', glint: '#d3e5ff', grass: ['#2f503a', '#33553e', '#2c4c37'],
    dyke: ['#5d5c5a', '#575653'], sand: '#a0957d', built: '#7a7362', foam: '#cfe3ff', accent: '#ffd47c', jelly: '#82f4d8', haze: '#7fa8ff', flower: ['#cfe3ff', '#fff3b0'] },
];
export const NETTLE = '#ff6b55', CRAB = '#e8613c', PEARL = '#fff6ea', CONCH = '#ffcf7a';

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
export const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// '#rgb', '#rrggbb', 'rgb(…)' or 'rgba(…)' → [r, g, b, a]; the helpers below take their own output
export function rgbOf(col) {
  if (col[0] === '#') {
    let h = col.slice(1);
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = col.match(/-?[\d.]+/g) ?? ['255', '255', '255'];
  return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]];
}
export const rgba = (col, a = 1) => { const [r, g, b, a0] = rgbOf(col); return `rgba(${r},${g},${b},${+(a * a0).toFixed(3)})`; };
export function mix(c1, c2, k) {
  const a = rgbOf(c1), b = rgbOf(c2), m = i => a[i] + (b[i] - a[i]) * k;
  return `rgba(${Math.round(m(0))},${Math.round(m(1))},${Math.round(m(2))},${+m(3).toFixed(3)})`;
}

// a soft round light; tinted copies cached per colour
const glows = new Map();
export function glow(g, col, x, y, r, a = 1) {
  if (a <= 0.004 || r <= 0) return;
  let s = glows.get(col);
  if (!s) {
    s = canvas(64, 64);
    const x2 = s.getContext('2d'), gr = x2.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.3, rgba(col, 0.42)); gr.addColorStop(1, rgba(col, 0));
    x2.fillStyle = gr; x2.fillRect(0, 0, 64, 64);
    glows.set(col, s);
  }
  const ga = g.globalAlpha;
  g.globalAlpha = ga * Math.min(1, a);
  g.drawImage(s, x - r, y - r, r * 2, r * 2);
  g.globalAlpha = ga;
}

// ---------- a jellyfish: a glassy bell that pulses, trailing four tentacles ----------
export function drawJelly(g, x, y, r, t, col, phase = 0, nettle = false) {
  const p = Math.sin(t * (nettle ? 9 : 6) + phase), sq = 1 + 0.1 * p;
  glow(g, col, x, y, r * 2.6, nettle ? 0.5 : 0.42);
  // tentacles, swaying, under the bell
  g.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const ox = (k - 1.5) * r * 0.36, len = r * (1.05 + 0.18 * Math.sin(t * 3 + k + phase));
    g.strokeStyle = rgba(col, 0.55); g.lineWidth = r * 0.13;
    g.beginPath(); g.moveTo(x + ox, y + r * 0.15);
    g.quadraticCurveTo(x + ox + Math.sin(t * 4 + k * 1.7 + phase) * r * 0.35, y + r * 0.15 + len * 0.55, x + ox + Math.sin(t * 4 + k + 1 + phase) * r * 0.25, y + r * 0.15 + len);
    g.stroke();
  }
  // the bell
  const bw = r * (1 / sq), bh = r * 0.95 * sq;
  const gr = g.createRadialGradient(x - bw * 0.3, y - bh * 0.55, r * 0.05, x, y - bh * 0.2, r * 1.2);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.35, rgba(col, 0.85)); gr.addColorStop(1, rgba(col, 0.35));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(x - bw, y + bh * 0.18);
  g.bezierCurveTo(x - bw, y - bh * 1.15, x + bw, y - bh * 1.15, x + bw, y + bh * 0.18);
  // the scalloped rim
  for (let k = 4; k > 0; k--) { const a = x - bw + (k / 4) * bw * 2, b = a - bw * 0.5; g.quadraticCurveTo((a + b) / 2, y + bh * 0.42, b, y + bh * 0.18); }
  g.fill();
  if (nettle) {
    // a nettle's stinging spots
    g.fillStyle = 'rgba(255,240,200,0.8)';
    for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x + (k - 1) * bw * 0.45, y - bh * 0.3 + Math.abs(k - 1) * bh * 0.18, r * 0.09, 0, TAU); g.fill(); }
  }
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.ellipse(x - bw * 0.35, y - bh * 0.55, bw * 0.22, bh * 0.14, -0.5, 0, TAU); g.fill();
}

// ---------- a shore crab, scuttling ----------
export function drawCrab(g, x, y, r, t, moving = true) {
  const s = moving ? Math.sin(t * 22) : 0;
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(r * 0.1, r * 0.25, r * 0.95, r * 0.55, 0, 0, TAU); g.fill();
  // legs, three a side, stepping
  g.strokeStyle = '#a83a22'; g.lineWidth = r * 0.12; g.lineCap = 'round';
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
    const ph = s * (k % 2 ? 1 : -1) * 0.18, ay = -r * 0.15 + k * r * 0.22;
    g.beginPath(); g.moveTo(side * r * 0.5, ay);
    g.lineTo(side * r * 0.95, ay - r * 0.12 + ph * r);
    g.lineTo(side * r * 1.15, ay + r * 0.25 + ph * r);
    g.stroke();
  }
  // claws
  for (const side of [-1, 1]) {
    const cx = side * r * 0.62, cy = -r * 0.72 + (moving ? Math.sin(t * 11 + side) * r * 0.05 : 0);
    g.strokeStyle = '#b8432a'; g.lineWidth = r * 0.14;
    g.beginPath(); g.moveTo(side * r * 0.35, -r * 0.3); g.lineTo(cx, cy + r * 0.15); g.stroke();
    g.fillStyle = '#f07a4e';
    g.beginPath(); g.ellipse(cx, cy, r * 0.24, r * 0.2, side * 0.4, 0, TAU); g.fill();
    g.fillStyle = '#7a2414'; g.beginPath(); g.moveTo(cx, cy - r * 0.02); g.lineTo(cx + side * r * 0.08, cy - r * 0.26); g.lineTo(cx + side * r * 0.2, cy - r * 0.05); g.fill();
  }
  // the shell
  const gr = g.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.05, 0, 0, r * 0.85);
  gr.addColorStop(0, '#ffb08a'); gr.addColorStop(0.5, CRAB); gr.addColorStop(1, '#8e2c16');
  g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, r * 0.68, r * 0.5, 0, 0, TAU); g.fill();
  // eyes on stalks
  for (const side of [-1, 1]) {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(side * r * 0.2, -r * 0.5, r * 0.12, 0, TAU); g.fill();
    g.fillStyle = '#1a0a08'; g.beginPath(); g.arc(side * r * 0.2, -r * 0.53, r * 0.06, 0, TAU); g.fill();
  }
  g.restore();
}

// ---------- Maren's skimmer: a pointed punt, Maren at the stern, a lantern on the bow ----------
export function drawSkimmer(g, x, y, r, angle, t, L) {
  g.save(); g.translate(x, y);
  glow(g, L.accent, 0, 0, r * 3.2, 0.45 + 0.08 * Math.sin(t * 5));
  g.rotate(angle);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(r * 0.08, r * 0.14, r * 1.05, r * 0.5, 0, 0, TAU); g.fill();
  // the hull
  const hull = new Path2D();
  hull.moveTo(r * 1.15, 0);
  hull.bezierCurveTo(r * 0.7, -r * 0.55, -r * 0.6, -r * 0.55, -r * 0.95, -r * 0.42);
  hull.lineTo(-r * 0.95, r * 0.42);
  hull.bezierCurveTo(-r * 0.6, r * 0.55, r * 0.7, r * 0.55, r * 1.15, 0);
  const gr = g.createLinearGradient(0, -r * 0.5, 0, r * 0.5);
  gr.addColorStop(0, '#d9a66a'); gr.addColorStop(0.5, '#a8713f'); gr.addColorStop(1, '#6e4524');
  g.fillStyle = gr; g.fill(hull);
  g.strokeStyle = '#4a2c16'; g.lineWidth = r * 0.08; g.stroke(hull);
  // deck planks
  g.strokeStyle = 'rgba(70,40,20,0.5)'; g.lineWidth = r * 0.04;
  for (const k of [-0.18, 0.18]) { g.beginPath(); g.moveTo(-r * 0.85, k * r); g.lineTo(r * 0.75, k * r * 0.6); g.stroke(); }
  // Maren: a round hat seen from above
  g.fillStyle = '#2e4a5c'; g.beginPath(); g.arc(-r * 0.35, 0, r * 0.36, 0, TAU); g.fill();
  g.fillStyle = '#e8c26a'; g.beginPath(); g.arc(-r * 0.35, 0, r * 0.3, 0, TAU); g.fill();
  g.fillStyle = '#c99b46'; g.beginPath(); g.arc(-r * 0.35, 0, r * 0.13, 0, TAU); g.fill();
  // the lantern
  g.fillStyle = '#fff4cc'; g.beginPath(); g.arc(r * 0.62, 0, r * 0.15, 0, TAU); g.fill();
  g.restore();
  glow(g, '#fff0c0', x + Math.cos(angle) * r * 0.62, y + Math.sin(angle) * r * 0.62, r * 0.9, 0.8);
}

// ---------- a pearl in its open shell ----------
export function drawPearl(g, x, y, r, t) {
  const b = Math.sin(t * 2.2 + x) * r * 0.08;
  glow(g, PEARL, x, y + b, r * 2.4, 0.4 + 0.15 * Math.sin(t * 3 + y));
  g.fillStyle = '#c9b49a';
  g.beginPath(); g.ellipse(x, y + r * 0.35 + b, r * 0.95, r * 0.45, 0, 0, Math.PI); g.fill();
  const gr = g.createRadialGradient(x - r * 0.2, y - r * 0.25 + b, r * 0.05, x, y + b, r * 0.55);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#f2e6f2'); gr.addColorStop(1, '#b9a7c4');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y + b, r * 0.5, 0, TAU); g.fill();
}
// ---------- a conch: a spiral shell, glowing gold ----------
export function drawConch(g, x, y, r, t) {
  const b = Math.sin(t * 2 + y) * r * 0.08;
  glow(g, CONCH, x, y + b, r * 2.6, 0.45 + 0.15 * Math.sin(t * 2.6 + x));
  g.save(); g.translate(x, y + b); g.rotate(-0.5);
  const gr = g.createLinearGradient(-r, 0, r, 0);
  gr.addColorStop(0, '#ffe2b0'); gr.addColorStop(1, '#e08a5a');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(r * 1.0, 0); g.quadraticCurveTo(r * 0.2, -r * 0.8, -r * 0.7, -r * 0.2); g.quadraticCurveTo(-r * 0.5, r * 0.6, r * 1.0, 0); g.fill();
  g.strokeStyle = '#9c4f2c'; g.lineWidth = r * 0.08;
  g.beginPath(); for (let k = 0; k < 24; k++) { const a = k * 0.45, rr = r * 0.05 + k * r * 0.018; g.lineTo(-r * 0.25 + Math.cos(a) * rr, -r * 0.15 + Math.sin(a) * rr); } g.stroke();
  g.restore();
}

// a little skimmer for the lives row
export function drawLife(g, x, y, s, col = '#d9a66a') {
  g.fillStyle = col;
  g.beginPath(); g.moveTo(x + s, y); g.quadraticCurveTo(x, y - s * 0.55, x - s * 0.8, y - s * 0.38); g.lineTo(x - s * 0.8, y + s * 0.38); g.quadraticCurveTo(x, y + s * 0.55, x + s, y); g.fill();
  g.fillStyle = '#e8c26a'; g.beginPath(); g.arc(x - s * 0.3, y, s * 0.24, 0, TAU); g.fill();
}
