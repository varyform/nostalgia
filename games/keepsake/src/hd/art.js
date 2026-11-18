// HD scene art: palettes and the static layers of each scene, painted once per scene and size
// into offscreen canvases, in the 1920 × 1080 reference frame (the caller sets the scale).
//   back:  sky, far scenery, house fronts, the floors and the stairs
//   front: railings, drawn over the characters' feet
// The moving parts (water, clouds, lamps, smoke, stars) are drawn each frame by render.js.
import { BOTTOM, FLOOR_Y, H, SCENES, W } from '../scenes.js';

export const TAU = Math.PI * 2;
export const ART = {
  harbour: {
    sky: ['#2a1b4e', '#5b2d6e', '#b44f78', '#f08a6a', '#ffc98a'], water: ['#3c6e8f', '#1f3f63', '#122640'],
    deck: '#a8683f', deckTop: '#d39561', deckDark: '#5e3420', rail: '#2b1d2e', lamp: '#ffc46b', accent: '#ff7a8a', hud: '#ffe2c4', ink: '#2a1230',
    walls: ['#d9744f', '#e8b04a', '#3f8f8a', '#c95a6e', '#7d6bb0', '#e39a5c'],
  },
  park: {
    sky: ['#3a8fd6', '#6fb6ea', '#a9d8f5', '#d8f0fb', '#f4fbff'], water: ['#5fb0a8', '#3d8a86', '#25605f'],
    deck: '#9a6a3c', deckTop: '#c99559', deckDark: '#5a3a1e', rail: '#f4efe2', lamp: '#fff3b0', accent: '#ff8a3d', hud: '#ffffff', ink: '#173048',
    walls: ['#6cae4f', '#4f9443', '#8cc35a', '#3f7d3c'],
  },
  roofs: {
    sky: ['#070b24', '#0e1640', '#1b275e', '#2c3a78', '#3d4b86'], water: ['#22305e', '#141d40', '#0a1028'],
    deck: '#4a4f6e', deckTop: '#6d7398', deckDark: '#262a40', rail: '#15182a', lamp: '#ffd27a', accent: '#ffe066', hud: '#e8ecff', ink: '#0b0f24',
    walls: ['#5a4a6e', '#4b5a7a', '#6e4f5a', '#3e4d68', '#5d5470'],
  },
};
// the kite the stars draw in the roofs' sky: one point per star to catch
export const KITE = [
  [1720, 112], [1662, 160], [1778, 160], [1606, 212], [1720, 212], [1834, 212],
  [1662, 280], [1778, 280], [1720, 352], [1700, 398], [1742, 426], [1708, 452],
];

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
// a soft round light, white in the middle; tinted copies are made per colour
const glows = new Map();
function glowSprite(col) {
  let c = glows.get(col);
  if (!c) {
    c = canvas(128, 128);
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, col); gr.addColorStop(0.35, col + '88'); gr.addColorStop(1, col + '00');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    glows.set(col, c);
  }
  return c;
}
export function glow(g, col, x, y, r, a = 1) {
  const pa = g.globalAlpha, op = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = pa * a;
  g.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = pa; g.globalCompositeOperation = op;
}
export const vgrad = (g, y0, y1, stops) => {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
};
export const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// lighten (k > 0) or darken a #rrggbb colour
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = c => Math.max(0, Math.min(255, Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k))));
  return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ---------- pieces ----------
function window_(g, x, y, w, h, lit, A, k) {
  g.fillStyle = shade(A.walls[k % A.walls.length], -0.45); g.fillRect(x - 4, y - 4, w + 8, h + 8);
  g.fillStyle = lit ? '#ffd78a' : '#28304a'; g.fillRect(x, y, w, h);
  if (lit) { glow(g, A.lamp, x + w / 2, y + h / 2, w * 1.3, 0.35); g.fillStyle = 'rgba(255,170,90,0.5)'; g.fillRect(x, y + h * 0.55, w, h * 0.45); }
  g.strokeStyle = 'rgba(40,20,30,0.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + w / 2, y); g.lineTo(x + w / 2, y + h); g.moveTo(x, y + h * 0.45); g.lineTo(x + w, y + h * 0.45); g.stroke();
}
function house(g, x, w, top, A, k, opt = {}) {
  const col = A.walls[k % A.walls.length];
  g.fillStyle = vgrad(g, top, FLOOR_Y[BOTTOM], [shade(col, 0.08), col, shade(col, -0.25)]);
  g.fillRect(x, top, w, FLOOR_Y[BOTTOM] - top);
  // roof
  g.fillStyle = opt.roof ?? shade(col, -0.5);
  g.beginPath(); g.moveTo(x - 14, top + 2); g.lineTo(x + w / 2, top - (opt.peak ?? 46)); g.lineTo(x + w + 14, top + 2); g.closePath(); g.fill();
  // chimney
  if (k % 2 === 0) { g.fillStyle = shade(col, -0.35); g.fillRect(x + w * 0.7, top - 70, 26, 50); g.fillStyle = shade(col, -0.55); g.fillRect(x + w * 0.7 - 4, top - 74, 34, 8); }
  // windows between the floors
  const rows = [];
  for (let f = 0; f < BOTTOM; f++) rows.push(FLOOR_Y[f] + 60);
  rows.unshift(top + 30);
  for (const wy of rows) {
    if (wy < top + 10 || wy > FLOOR_Y[BOTTOM] - 120) continue;
    for (let i = 0; i < Math.floor(w / 90); i++) {
      const wx = x + 24 + i * ((w - 48) / Math.max(1, Math.floor(w / 90))), lit = hash(k * 31 + i * 7 + wy) > 0.45;
      window_(g, wx, wy, 44, 70, lit && opt.night !== false, A, k);
    }
  }
}
function floorBand(g, sc, f, A, style) {
  const y = FLOOR_Y[f];
  for (const [a, b] of sc.floors[f].segs) {
    const x0 = a, x1 = b;
    if (style === 'quay') {
      g.fillStyle = vgrad(g, y, y + 60, ['#9a8f86', '#6e655f', '#4a433f']); g.fillRect(x0, y, x1 - x0, 60);
      g.strokeStyle = 'rgba(30,20,20,0.45)'; g.lineWidth = 2;
      for (let x = x0; x < x1; x += 70) { g.strokeRect(x + ((y / 10) % 2) * 35, y + 14, 70, 22); }
      g.fillStyle = '#c4b8ac'; g.fillRect(x0, y - 6, x1 - x0, 10);
      continue;
    }
    if (style === 'path') {
      g.fillStyle = vgrad(g, y - 4, y + 56, ['#e9d7a8', '#c9b07a', '#8e7a4e']); g.fillRect(x0, y - 4, x1 - x0, 60);
      g.fillStyle = 'rgba(120,90,50,0.35)';
      for (let i = 0; i < 160; i++) g.fillRect(x0 + hash(i + f * 9) * (x1 - x0), y + 4 + hash(i * 3) * 46, 4, 3);
      continue;
    }
    if (style === 'street') {
      g.fillStyle = vgrad(g, y - 4, y + 56, ['#5b5f78', '#3d4058', '#22253a']); g.fillRect(x0, y - 4, x1 - x0, 60);
      g.strokeStyle = 'rgba(10,12,30,0.6)'; g.lineWidth = 2;
      for (let r = 0; r < 3; r++) for (let x = x0 + (r % 2) * 22; x < x1; x += 44) { g.beginPath(); g.roundRect(x, y + 4 + r * 16, 40, 14, 6); g.stroke(); }
      continue;
    }
    // a deck: planks on top, a beam under, brackets back to the wall
    const t = style === 'stone' ? 26 : 20;
    g.fillStyle = A.deckDark;
    for (let x = x0 + 30; x < x1 - 10; x += 120) { g.beginPath(); g.moveTo(x, y + t); g.lineTo(x + 26, y + t); g.lineTo(x + 6, y + t + 46); g.lineTo(x, y + t + 46); g.fill(); }
    g.fillStyle = vgrad(g, y - 4, y + t, [A.deckTop, A.deck, A.deckDark]); g.beginPath(); g.roundRect(x0, y - 4, x1 - x0, t + 4, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x0, y - 4, x1 - x0, 3);
    if (style !== 'stone') { g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; for (let x = x0 + 48; x < x1; x += 48) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + t); g.stroke(); } }
  }
}
function railings(g, sc, f, A, style) {
  const y = FLOOR_Y[f];
  // openings where stairs leave this floor and arrive on it
  const gaps = sc.stairs.flatMap(st => (st.f === f ? [st.xt] : st.f === f - 1 ? [st.xb] : [])).sort((p, q) => p - q);
  const spans = [];
  for (const [a, b] of sc.floors[f].segs) {
    let x = a + 4;
    for (const gx of gaps) if (gx > a && gx < b) { if (gx - 44 > x) spans.push([x, gx - 44]); x = gx + 44; }
    if (b - 4 > x) spans.push([x, b - 4]);
  }
  for (const [x0, x1] of spans) {
    if (style === 'hedge') {
      g.fillStyle = '#438f3e'; g.beginPath();
      for (let x = x0; x < x1; x += 34) { g.moveTo(x + 37, y + 2); g.arc(x + 17, y + 2, 20, 0, Math.PI, true); }
      g.fill();
      continue;
    }
    if (style === 'balustrade') {
      g.fillStyle = A.rail; g.fillRect(x0, y - 44, x1 - x0, 9);
      g.beginPath();
      for (let x = x0 + 8; x < x1; x += 26) { g.moveTo(x + 7, y - 18); g.ellipse(x, y - 18, 7, 16, 0, 0, TAU); }
      g.fill();
      continue;
    }
    g.strokeStyle = A.rail; g.lineWidth = 4;
    g.beginPath(); g.moveTo(x0, y - 40); g.lineTo(x1, y - 40); g.stroke();
    g.lineWidth = 3; g.beginPath();
    for (let x = x0; x <= x1; x += 22) { g.moveTo(x, y - 40); g.lineTo(x, y - 2); }
    g.stroke();
  }
}
function stairs(g, sc, A) {
  for (const st of sc.stairs) {
    const xb = st.xb, xt = st.xt, yb = FLOOR_Y[st.f + 1], yt = FLOOR_Y[st.f], dir = Math.sign(xt - xb);
    // stringer
    g.strokeStyle = A.deckDark; g.lineWidth = 16; g.lineCap = 'round';
    g.beginPath(); g.moveTo(xb - dir * 10, yb + 4); g.lineTo(xt + dir * 8, yt + 10); g.stroke();
    // treads
    const n = 10;
    for (let i = 1; i < n; i++) {
      const k = i / n, x = xb + (xt - xb) * k, y = yb + (yt - yb) * k;
      g.fillStyle = A.deckTop; g.fillRect(x - 26, y - 4, 52, 8);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 26, y + 4, 52, 3);
    }
    // handrail
    g.strokeStyle = A.rail; g.lineWidth = 4;
    g.beginPath(); g.moveTo(xb, yb - 52); g.lineTo(xt, yt - 52); g.stroke();
    g.beginPath(); g.moveTo(xb, yb - 52); g.lineTo(xb, yb); g.moveTo(xt, yt - 52); g.lineTo(xt, yt); g.stroke();
    g.lineCap = 'butt';
  }
}

// ---------- each scene's back layer ----------
function skyHarbour(g, A) {
  g.fillStyle = vgrad(g, 0, 940, A.sky); g.fillRect(0, 0, W, H);
  // the sun going down behind the far headland
  glow(g, '#ffd59a', 1520, 640, 520, 0.7);
  g.fillStyle = '#fff1cf'; g.beginPath(); g.arc(1520, 640, 80, 0, TAU); g.fill();
  g.fillStyle = '#6b3a63';
  g.beginPath(); g.moveTo(0, 760); for (let x = 0; x <= W; x += 60) g.lineTo(x, 700 - Math.sin(x / 260) * 40 - hash(x) * 20); g.lineTo(W, 940); g.lineTo(0, 940); g.fill();
}
function paintHarbour(g, sc, A) {
  // house fronts, the galleries run along them
  const xs = [0, 250, 520, 760, 1040, 1300, 1560, 1760];
  xs.forEach((x, k) => house(g, x, (xs[k + 1] ?? W + 40) - x + 2, 120 + hash(k + 2) * 60, A, k));
  // the right-hand house's open window, where Mrs Pinch leans out
  const T = sc.thrower;
  g.fillStyle = '#20141e'; g.fillRect(T.x - 56, T.y - 86, 112, 116);
  g.fillStyle = '#ffcf8a'; g.fillRect(T.x - 48, T.y - 78, 96, 100);
  glow(g, A.lamp, T.x, T.y - 30, 120, 0.5);
  g.fillStyle = '#3f8f8a'; g.fillRect(T.x - 86, T.y - 86, 30, 116); g.fillRect(T.x + 56, T.y - 86, 30, 116);
  // the crane over the first floor, for the crate
  const gm = sc.gimmick;
  g.strokeStyle = '#3a2418'; g.lineWidth = 16; g.lineCap = 'round';
  g.beginPath(); g.moveTo(60, FLOOR_Y[1] - 10); g.lineTo(60, 150); g.lineTo(gm.x + 20, 150); g.stroke();
  g.lineWidth = 8; g.beginPath(); g.moveTo(60, 300); g.lineTo(220, 150); g.stroke();
  g.lineCap = 'butt';
  for (let f = 0; f < BOTTOM; f++) floorBand(g, sc, f, A, 'deck');
  floorBand(g, sc, BOTTOM, A, 'quay');
  // bollards and lamp posts on the quay
  for (let x = 140; x < W; x += 420) { g.fillStyle = '#2a2026'; g.beginPath(); g.roundRect(x - 14, FLOOR_Y[BOTTOM] - 30, 28, 32, 8); g.fill(); }
  stairs(g, sc, A);
}
function skyPark(g, A) {
  g.fillStyle = vgrad(g, 0, 900, A.sky); g.fillRect(0, 0, W, H);
  glow(g, '#fffbe0', 300, 140, 260, 0.6);
  g.fillStyle = '#fffbea'; g.beginPath(); g.arc(300, 140, 54, 0, TAU); g.fill();
  // far hills and trees
  g.fillStyle = '#9fd18a'; g.beginPath(); g.moveTo(0, 600); for (let x = 0; x <= W; x += 40) g.lineTo(x, 520 - Math.sin(x / 300 + 1) * 60); g.lineTo(W, 1080); g.lineTo(0, 1080); g.fill();
  g.fillStyle = '#7dbb6c'; g.beginPath(); g.moveTo(0, 700); for (let x = 0; x <= W; x += 40) g.lineTo(x, 640 - Math.sin(x / 210) * 40); g.lineTo(W, 1080); g.lineTo(0, 1080); g.fill();
  for (let i = 0; i < 16; i++) {
    const x = hash(i) * W, y = 560 + hash(i + 4) * 160, r = 40 + hash(i + 9) * 50;
    g.fillStyle = '#5a3a22'; g.fillRect(x - 8, y, 16, r * 1.4);
    g.fillStyle = A.walls[i % A.walls.length]; g.beginPath(); g.arc(x, y, r, 0, TAU); g.arc(x - r * 0.6, y + r * 0.3, r * 0.7, 0, TAU); g.arc(x + r * 0.6, y + r * 0.3, r * 0.7, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, TAU); g.fill();
  }
}
function paintPark(g, sc, A) {
  // the bandstand: a striped canopy over the top gallery, columns down to the promenade
  const bx0 = 200, bx1 = 1720;
  g.fillStyle = '#f4efe2';
  for (let x = bx0 + 40; x < bx1; x += 180) g.fillRect(x - 8, FLOOR_Y[0], 16, FLOOR_Y[2] - FLOOR_Y[0]);
  g.save(); g.beginPath(); g.moveTo(bx0 - 30, 150); g.quadraticCurveTo(960, 30, bx1 + 30, 150); g.lineTo(bx1 + 30, 170); g.lineTo(bx0 - 30, 170); g.closePath(); g.clip();
  for (let x = bx0 - 30, k = 0; x < bx1 + 30; x += 60, k++) { g.fillStyle = k % 2 ? '#ffffff' : '#e84a5f'; g.fillRect(x, 20, 60, 160); }
  g.restore();
  for (let x = bx0 - 30, k = 0; x < bx1 + 30; x += 60, k++) { g.fillStyle = k % 2 ? '#ffffff' : '#e84a5f'; g.beginPath(); g.moveTo(x, 168); g.lineTo(x + 60, 168); g.lineTo(x + 30, 196); g.fill(); }
  floorBand(g, sc, 0, A, 'deck');
  floorBand(g, sc, 1, A, 'deck');
  floorBand(g, sc, 2, A, 'stone');
  floorBand(g, sc, BOTTOM, A, 'path');
  // flower beds along the path's back edge
  for (let i = 0; i < 60; i++) { const x = hash(i * 5) * W, y = FLOOR_Y[BOTTOM] - 8 - hash(i) * 10; g.fillStyle = ['#ff6f91', '#ffd166', '#ffffff', '#c77dff'][i % 4]; g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); }
  stairs(g, sc, A);
}
function skyRoofs(g, A) {
  g.fillStyle = vgrad(g, 0, 900, A.sky); g.fillRect(0, 0, W, H);
  // the moon and the far city
  glow(g, '#cfd8ff', 260, 210, 260, 0.55);
  g.fillStyle = '#f2f0dc'; g.beginPath(); g.arc(260, 210, 64, 0, TAU); g.fill();
  g.fillStyle = 'rgba(180,170,140,0.35)'; g.beginPath(); g.arc(240, 196, 14, 0, TAU); g.arc(282, 232, 10, 0, TAU); g.fill();
  g.fillStyle = '#121a3e';
  for (let x = 0; x < W; x += 70) { const h = 120 + hash(x) * 200; g.fillRect(x, 900 - h, 64, h); }
  g.fillStyle = 'rgba(255,214,120,0.5)';
  for (let i = 0; i < 120; i++) g.fillRect(hash(i * 3) * W, 620 + hash(i * 7) * 260, 5, 7);
}
function paintRoofs(g, sc, A) {
  // roofs: slopes under the ridge, the catwalk, three flat roofs
  const tile = (x0, x1, y0, y1, col) => {
    g.fillStyle = vgrad(g, y0, y1, [shade(col, 0.1), col, shade(col, -0.35)]); g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    for (let y = y0 + 18; y < y1; y += 18) { g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
  };
  g.fillStyle = '#6e4f5a'; g.beginPath(); g.moveTo(340, FLOOR_Y[1]); g.lineTo(400, FLOOR_Y[0]); g.lineTo(1520, FLOOR_Y[0]); g.lineTo(1580, FLOOR_Y[1]); g.fill();
  tile(400, 1520, FLOOR_Y[0] + 10, FLOOR_Y[1], '#7a4a52');
  for (const [a, b] of sc.floors[2].segs) { g.fillStyle = vgrad(g, FLOOR_Y[2], FLOOR_Y[BOTTOM], ['#4b5a7a', '#3e4d68', '#2a3550']); g.fillRect(a, FLOOR_Y[2], b - a, FLOOR_Y[BOTTOM] - FLOOR_Y[2]); }
  for (const [a, b] of sc.floors[2].segs)
    for (let x = a + 30; x < b - 60; x += 110) window_(g, x, FLOOR_Y[2] + 70, 40, 60, hash(x) > 0.4, A, 1);
  for (const [a, b] of [[0, 1920]]) tile(a, b, FLOOR_Y[1] + 20, FLOOR_Y[1] + 60, '#5d5470');
  // chimneys with pots
  for (const x of [520, 980, 1260]) { g.fillStyle = '#8a4b3c'; g.fillRect(x, FLOOR_Y[0] - 70, 40, 70); g.fillStyle = '#5e2e24'; g.fillRect(x - 5, FLOOR_Y[0] - 76, 50, 10); g.fillStyle = '#b5654a'; g.fillRect(x + 8, FLOOR_Y[0] - 92, 24, 18); }
  // the hoist for the sandbag, on the left chimney stack
  const gm = sc.gimmick;
  g.fillStyle = '#7a4335'; g.fillRect(gm.px - 230, gm.py - 10, 60, FLOOR_Y[1] - gm.py + 10);
  g.strokeStyle = '#2a1c18'; g.lineWidth = 10; g.lineCap = 'round';
  g.beginPath(); g.moveTo(gm.px - 200, gm.py); g.lineTo(gm.px + 20, gm.py); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.moveTo(gm.px - 200, gm.py + 110); g.lineTo(gm.px - 80, gm.py); g.stroke();
  g.lineCap = 'butt';
  // the sweep's dormer at the left
  const T = sc.thrower;
  g.fillStyle = '#3e4d68'; g.beginPath(); g.moveTo(T.x - 62, T.y + 40); g.lineTo(T.x - 62, T.y - 70); g.lineTo(T.x, T.y - 120); g.lineTo(T.x + 62, T.y - 70); g.lineTo(T.x + 62, T.y + 40); g.fill();
  g.fillStyle = '#ffcf8a'; g.fillRect(T.x - 42, T.y - 70, 84, 104);
  glow(g, A.lamp, T.x, T.y - 20, 110, 0.4);
  floorBand(g, sc, 0, A, 'deck');
  floorBand(g, sc, 1, A, 'deck');
  floorBand(g, sc, 2, A, 'stone');
  floorBand(g, sc, BOTTOM, A, 'street');
  stairs(g, sc, A);
}
export function paintSky(g, id) {
  const A = ART[id];
  if (id === 'harbour') skyHarbour(g, A);
  else if (id === 'park') skyPark(g, A);
  else skyRoofs(g, A);
}
export function paintBack(g, id) {
  const sc = SCENES.find(s => s.id === id), A = ART[id];
  if (id === 'harbour') paintHarbour(g, sc, A);
  else if (id === 'park') paintPark(g, sc, A);
  else paintRoofs(g, sc, A);
}
export function paintFront(g, id) {
  const sc = SCENES.find(s => s.id === id), A = ART[id];
  const styles = { harbour: ['iron', 'iron', 'iron'], park: ['balustrade', 'hedge', 'balustrade'], roofs: ['iron', 'iron', 'iron'] }[id];
  for (let f = 0; f < BOTTOM; f++) railings(g, sc, f, A, styles[f]);
}
