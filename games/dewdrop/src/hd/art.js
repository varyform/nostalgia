// HD art made in code: the palette of each garden, soft glow sprites, the parallax night
// backdrops and the static layer of a stage (earth, branches, vines, thorns), painted as
// vectors at the screen's own resolution into offscreen canvases.
import { COLS, ROWS, isClimb, isSolid } from '../level.js';

export const TAU = Math.PI * 2;
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
}
const hex = s => { const n = parseInt(s.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export const rgba = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };
export const mix = (a, b, t) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`; };

// ---------- the four gardens ----------
export const PAL = [
  { // Mossy Hollow: teal night, warm gold berries
    sky: ['#070b24', '#132650', '#2d5566'], star: '#dff4ff', moon: '#fff4d6', far: '#14304a', mid: '#0f2436', near: '#0a1a26',
    earth: ['#2a1f1c', '#3d2c25', '#55402f'], moss: ['#3f8a3c', '#6cc055', '#a9e67a'], bark: ['#4a3324', '#6e4c33', '#93694a'],
    leaf: ['#2f7a3a', '#4fae4c', '#86d86a'], vine: ['#2c6e38', '#4c9e48'], water: ['#0d2c44', '#1d5878', '#5cc4e0'],
    berry: ['#ffb43a', '#ffd76a', '#fff2b8'], glow: 'gold', accent: '#9ff0c4', thorn: ['#3a2430', '#6a3a4a'], dark: 0.42,
    fog: '#5fb4a8',
  },
  { // Whisper Reeds: violet dusk, pink berries
    sky: ['#0d0820', '#2c1a52', '#7a4a7e'], star: '#ffe8ff', moon: '#ffe6f2', far: '#2a1d4a', mid: '#21173a', near: '#170f2a',
    earth: ['#251a2c', '#3a2a40', '#54405a'], moss: ['#5f8f5a', '#8fbf6a', '#c8e89a'], bark: ['#4a3448', '#6c4e66', '#927088'],
    leaf: ['#5a8a5a', '#86b46e', '#bfe08e'], vine: ['#4f7f4f', '#7aa868'], water: ['#1a1838', '#3a3a78', '#9a9ae8'],
    berry: ['#ff5c9e', '#ff8fc0', '#ffd0e6'], glow: 'pink', accent: '#ffc0e0', thorn: ['#3a2040', '#6a3a6a'], dark: 0.4,
    fog: '#b48ac8',
  },
  { // Thornwood: ember autumn, icy blue berries
    sky: ['#12060c', '#33121c', '#7a3424'], star: '#ffe2cc', moon: '#ffd2a0', far: '#3a1a1e', mid: '#2a1216', near: '#1c0a0e',
    earth: ['#24140e', '#3a2216', '#563622'], moss: ['#8a5a22', '#c2822e', '#ecb45a'], bark: ['#4a2a1a', '#70402a', '#9a623e'],
    leaf: ['#a8541e', '#d9822b', '#f4b25a'], vine: ['#6a5a24', '#9a8a34'], water: ['#1a1020', '#3a2238', '#8a6a90'],
    berry: ['#3ac8ff', '#7ae8ff', '#d4f8ff'], glow: 'cyan', accent: '#ffd08a', thorn: ['#2a1214', '#5a2422'], dark: 0.46,
    fog: '#c87a5a',
  },
  { // Moon Pond: silver blue, violet berries
    sky: ['#02081a', '#0a2246', '#2a5a80'], star: '#ffffff', moon: '#f4f8ff', far: '#0e2a48', mid: '#0a2038', near: '#06162a',
    earth: ['#1a222c', '#28343e', '#3e4c58'], moss: ['#3e8a80', '#6ab8a8', '#a8e8d8'], bark: ['#33404a', '#4e5e6a', '#72848e'],
    leaf: ['#3a8a6a', '#5ab890', '#9ae8c0'], vine: ['#357a64', '#55a888'], water: ['#06203a', '#14507a', '#7ad0f4'],
    berry: ['#b07aff', '#d0a8ff', '#f0e2ff'], glow: 'violet', accent: '#cfe8ff', thorn: ['#1e2236', '#3e4466'], dark: 0.36,
    fog: '#8ab8e0',
  },
];

// ---------- soft glow sprites, added with 'lighter' ----------
const GLOWS = {
  white: [255, 255, 255], gold: [255, 200, 90], pink: [255, 110, 170], cyan: [100, 220, 255], violet: [190, 140, 255],
  dew: [140, 220, 255], red: [255, 70, 60], green: [140, 255, 170], moon: [220, 235, 255], warm: [255, 170, 110],
};
const glowCache = {};
function glowSprite(key) {
  if (glowCache[key]) return glowCache[key];
  const [r, g, b] = GLOWS[key] ?? GLOWS.white, c = canvas(64, 64), x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.22, `rgba(${r},${g},${b},0.5)`);
  gr.addColorStop(0.55, `rgba(${r},${g},${b},0.14)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return (glowCache[key] = c);
}
export function glow(g, key, x, y, r, a = 1) {
  if (a <= 0.01 || r <= 0) return;
  const op = g.globalCompositeOperation, al = g.globalAlpha;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, a) * al;
  g.drawImage(glowSprite(key), x - r, y - r, r * 2, r * 2);
  g.globalCompositeOperation = op; g.globalAlpha = al;
}

// ---------- backdrops: sky, moon, far hills, mid trees, near reeds (three parallax layers) ----------
// Each layer is a bit wider than the screen so it can slide with Dew.
export function makeBackdrop(world, cw, ch) {
  const P = PAL[world], R = rng(world * 977 + 13), u = ch / 1080, W = Math.ceil(cw * 1.12);
  const sky = canvas(cw, ch), s = sky.getContext('2d');
  const gr = s.createLinearGradient(0, 0, 0, ch);
  gr.addColorStop(0, P.sky[0]); gr.addColorStop(0.6, P.sky[1]); gr.addColorStop(1, P.sky[2]);
  s.fillStyle = gr; s.fillRect(0, 0, cw, ch);
  // a soft band of mist at the horizon
  const hz = s.createLinearGradient(0, ch * 0.55, 0, ch);
  hz.addColorStop(0, rgba(P.fog, 0)); hz.addColorStop(1, rgba(P.fog, 0.22));
  s.fillStyle = hz; s.fillRect(0, ch * 0.55, cw, ch * 0.45);
  // the moon
  const mx = cw * [0.78, 0.2, 0.7, 0.5][world], my = ch * [0.2, 0.18, 0.24, 0.17][world], mr = [70, 54, 80, 110][world] * u;
  const halo = s.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 4);
  halo.addColorStop(0, rgba(P.moon, 0.28)); halo.addColorStop(1, rgba(P.moon, 0));
  s.fillStyle = halo; s.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
  s.fillStyle = P.moon; s.beginPath(); s.arc(mx, my, mr, 0, TAU); s.fill();
  s.fillStyle = rgba(P.sky[1], 0.16);
  for (let i = 0; i < 6; i++) { s.beginPath(); s.arc(mx + (R() - 0.5) * mr * 1.2, my + (R() - 0.5) * mr * 1.2, mr * (0.1 + R() * 0.2), 0, TAU); s.fill(); }
  if (world === 1) { s.fillStyle = P.sky[1]; s.beginPath(); s.arc(mx + mr * 0.45, my - mr * 0.2, mr * 0.9, 0, TAU); s.fill(); } // a crescent

  const layer = (col, fn) => { const c = canvas(W, ch), x = c.getContext('2d'); x.fillStyle = col; fn(x); return c; };
  const hills = (x, base, amp, n, col) => {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, ch);
    for (let i = 0; i <= n; i++) { const X = (i / n) * W; x.lineTo(X, base - amp * (0.5 + 0.5 * Math.sin(i * 1.7 + world) * Math.cos(i * 0.6)) - R() * amp * 0.3); }
    x.lineTo(W, ch); x.closePath(); x.fill();
  };
  const far = layer(P.far, x => hills(x, ch * 0.72, ch * 0.16, 14, P.far));
  const mid = layer(P.mid, x => {
    hills(x, ch * 0.84, ch * 0.08, 20, P.mid);
    // tree crowns or reeds against the sky
    for (let i = 0; i < 26; i++) {
      const X = R() * W, base = ch * (0.8 + R() * 0.06);
      if (world === 1) { // reed stalks with seed heads
        const h = ch * (0.15 + R() * 0.18);
        x.strokeStyle = P.mid; x.lineWidth = 6 * u; x.beginPath(); x.moveTo(X, base); x.quadraticCurveTo(X + 20 * u, base - h / 2, X + 10 * u, base - h); x.stroke();
        x.beginPath(); x.ellipse(X + 10 * u, base - h, 9 * u, 30 * u, 0.2, 0, TAU); x.fill();
      } else if (world === 2) { // bare thorn trees
        const h = ch * (0.18 + R() * 0.15);
        x.strokeStyle = P.mid; x.lineWidth = 10 * u; x.lineCap = 'round';
        x.beginPath(); x.moveTo(X, base); x.lineTo(X, base - h); x.stroke();
        x.lineWidth = 5 * u;
        for (let k = 0; k < 5; k++) { const y = base - h * (0.4 + k * 0.13), d = (k % 2 ? 1 : -1) * (30 + R() * 40) * u; x.beginPath(); x.moveTo(X, y); x.lineTo(X + d, y - 30 * u); x.stroke(); }
      } else { // round crowns
        const r = (40 + R() * 70) * u;
        x.beginPath(); x.arc(X, base - r * 0.6, r, 0, TAU); x.fill();
        x.fillRect(X - 8 * u, base - r * 0.4, 16 * u, r);
      }
    }
  });
  const near = layer(P.near, x => {
    for (let i = 0; i < 60; i++) {
      const X = R() * W, h = (60 + R() * 160) * u;
      x.strokeStyle = P.near; x.lineWidth = (4 + R() * 6) * u; x.lineCap = 'round';
      x.beginPath(); x.moveTo(X, ch); x.quadraticCurveTo(X + (R() - 0.5) * 60 * u, ch - h * 0.6, X + (R() - 0.5) * 80 * u, ch - h); x.stroke();
    }
  });
  const stars = [];
  for (let i = 0; i < 90; i++) stars.push({ x: R() * cw, y: R() * ch * 0.6, r: (0.8 + R() * 1.8) * u, p: R() * TAU, s: 0.5 + R() * 2 });
  return { sky, far, mid, near, stars, W };
}

// ---------- the static layer of a stage ----------
// Everything that never moves: earth, branches, vines through them, hanging vines, thorns.
// Ponds, brooks, toadstools, dry leaves and lily pads are animated in render.js.
export function paintStage(L, world, ts) {
  const P = PAL[world], cv2 = canvas(COLS * ts, ROWS * ts), g = cv2.getContext('2d'), R = rng(7 + world * 31 + L.t.length);
  g.scale(ts, ts);
  const at = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? (r >= ROWS ? '~' : '#') : L.t[r][c]);
  const earth = c => c === '#';

  // earth: each tile a soft rounded block, joined to its neighbours, moss where open sky is above
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!earth(at(c, r))) continue;
      const up = earth(at(c, r - 1)), dn = earth(at(c, r + 1)), lf = earth(at(c - 1, r)), rt = earth(at(c + 1, r));
      const rad = [!up && !lf ? 0.35 : 0, !up && !rt ? 0.35 : 0, !dn && !rt ? 0.3 : 0, !dn && !lf ? 0.3 : 0];
      const gr = g.createLinearGradient(0, r, 0, r + 1);
      gr.addColorStop(0, up ? P.earth[1] : P.earth[2]); gr.addColorStop(1, dn ? P.earth[1] : P.earth[0]);
      g.fillStyle = gr; g.beginPath(); g.roundRect(c - 0.01, r - 0.01, 1.02, 1.02, rad); g.fill();
      // pebbles
      if (R() < 0.6) { g.fillStyle = rgba(P.earth[0], 0.7); g.beginPath(); g.ellipse(c + 0.2 + R() * 0.6, r + 0.4 + R() * 0.5, 0.06 + R() * 0.08, 0.04 + R() * 0.05, 0, 0, TAU); g.fill(); }
      if (R() < 0.3) { g.fillStyle = rgba(P.earth[2], 0.5); g.beginPath(); g.arc(c + R(), r + 0.3 + R() * 0.6, 0.05, 0, TAU); g.fill(); }
    }
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!earth(at(c, r)) || earth(at(c, r - 1)) || isSolid(at(c, r - 1))) continue;
      const lf = earth(at(c - 1, r)) && !earth(at(c - 1, r - 1)), rt = earth(at(c + 1, r)) && !earth(at(c + 1, r - 1));
      g.fillStyle = P.moss[0];
      g.beginPath(); g.roundRect(c - (lf ? 0.02 : 0.04), r - 0.06, 1 + (lf ? 0.02 : 0.04) + (rt ? 0.02 : 0.04), 0.3, [lf ? 0 : 0.15, rt ? 0 : 0.15, 0.12, 0.12]); g.fill();
      g.fillStyle = P.moss[1];
      g.beginPath(); g.roundRect(c - (lf ? 0.02 : 0.02), r - 0.08, 1 + (lf ? 0.02 : 0.02) + (rt ? 0.02 : 0.02), 0.16, 0.08); g.fill();
      // grass tufts and the odd flower
      for (let k = 0; k < 3; k++) {
        const x = c + 0.15 + R() * 0.7, h = 0.12 + R() * 0.16;
        g.strokeStyle = P.moss[2]; g.lineWidth = 0.035; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x, r - 0.04); g.quadraticCurveTo(x + 0.04, r - h * 0.6, x + (R() - 0.5) * 0.12, r - h); g.stroke();
      }
      if (R() < 0.18) { g.fillStyle = rgba(P.accent, 0.85); g.beginPath(); g.arc(c + 0.3 + R() * 0.4, r - 0.17, 0.05, 0, TAU); g.fill(); }
    }

  // branches: a bark beam per run, with leaves sprouting along it
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      if (at(c, r) !== '=' && at(c, r) !== '+') { c++; continue; }
      const c0 = c;
      while (c < COLS && (at(c, r) === '=' || at(c, r) === '+')) c++;
      branch(g, P, R, c0, c, r);
    }
  }
  // climbing vines: a wavy stem down each run of vine tiles
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      if (!isClimb(at(c, r))) { r++; continue; }
      const r0 = r;
      while (r < ROWS && isClimb(at(c, r))) r++;
      vine(g, P, R, c + 0.5, r0 - (at(c, r0) === '+' ? 0.1 : 0.15), r + 0.05);
    }
  }
  // hanging vines: a sagging rope with leaves between its ends
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      if (at(c, r) !== '-') { c++; continue; }
      const c0 = c;
      while (c < COLS && at(c, r) === '-') c++;
      rope(g, P, R, c0, c, r + 0.16);
    }
  }
  // thorns: a bramble of dark spikes on the ground
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (at(c, r) !== '^') continue;
      g.fillStyle = P.thorn[0];
      g.beginPath(); g.ellipse(c + 0.5, r + 0.95, 0.6, 0.35, 0, Math.PI, TAU); g.fill();
      for (let k = 0; k < 6; k++) {
        const x = c + 0.08 + k * 0.17 + R() * 0.05, h = 0.35 + R() * 0.25, lean = (R() - 0.5) * 0.25;
        g.fillStyle = k % 2 ? P.thorn[1] : P.thorn[0];
        g.beginPath(); g.moveTo(x - 0.09, r + 1); g.lineTo(x + lean, r + 1 - h); g.lineTo(x + 0.09, r + 1); g.fill();
      }
      g.strokeStyle = P.thorn[1]; g.lineWidth = 0.05;
      g.beginPath(); g.moveTo(c, r + 0.8); g.bezierCurveTo(c + 0.3, r + 0.5, c + 0.7, r + 0.9, c + 1, r + 0.6); g.stroke();
      g.fillStyle = '#e8e0d8';
      for (let k = 0; k < 3; k++) { const x = c + 0.15 + R() * 0.7, y = r + 0.55 + R() * 0.35; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.07, y - 0.14); g.lineTo(x + 0.12, y + 0.02); g.fill(); }
    }
  return cv2;
}
function branch(g, P, R, c0, c1, r) {
  const y = r + 0.12, h = 0.24, gr = g.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  gr.addColorStop(0, P.bark[2]); gr.addColorStop(0.5, P.bark[1]); gr.addColorStop(1, P.bark[0]);
  g.fillStyle = gr; g.beginPath(); g.roundRect(c0 + 0.02, y - h / 2, c1 - c0 - 0.04, h, h / 2); g.fill();
  g.strokeStyle = rgba(P.bark[0], 0.8); g.lineWidth = 0.025;
  for (let x = c0 + 0.4; x < c1 - 0.3; x += 0.6 + R() * 0.5) { g.beginPath(); g.moveTo(x, y - 0.04); g.lineTo(x + 0.25, y + 0.02); g.stroke(); }
  for (let x = c0 + 0.25; x < c1; x += 0.45 + R() * 0.4) leafAt(g, P, R, x, y - 0.06, (R() - 0.5) * 1.6 - Math.PI / 2, 0.16 + R() * 0.08);
  // the knobbly ends
  g.fillStyle = P.bark[1];
  g.beginPath(); g.arc(c0 + 0.12, y, h * 0.55, 0, TAU); g.fill();
  g.beginPath(); g.arc(c1 - 0.12, y, h * 0.55, 0, TAU); g.fill();
}
export function leafAt(g, P, R, x, y, a, s) {
  g.save(); g.translate(x, y); g.rotate(a);
  g.fillStyle = R() < 0.5 ? P.leaf[1] : P.leaf[0];
  g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(s * 0.6, -s * 0.45, s * 1.6, 0); g.quadraticCurveTo(s * 0.6, s * 0.45, 0, 0); g.fill();
  g.strokeStyle = rgba(P.leaf[2], 0.6); g.lineWidth = 0.015; g.beginPath(); g.moveTo(0, 0); g.lineTo(s * 1.3, 0); g.stroke();
  g.restore();
}
function vine(g, P, R, x, y0, y1) {
  g.strokeStyle = P.vine[0]; g.lineWidth = 0.13; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y0);
  for (let y = y0; y <= y1; y += 0.25) g.lineTo(x + Math.sin(y * 2.4) * 0.1, y);
  g.stroke();
  g.strokeStyle = P.vine[1]; g.lineWidth = 0.05;
  g.beginPath(); g.moveTo(x + 0.03, y0);
  for (let y = y0; y <= y1; y += 0.25) g.lineTo(x + 0.03 + Math.sin(y * 2.4) * 0.1, y);
  g.stroke();
  for (let y = y0 + 0.2; y < y1; y += 0.32 + R() * 0.15) {
    const side = Math.sin(y * 7) > 0 ? 1 : -1;
    leafAt(g, P, R, x + Math.sin(y * 2.4) * 0.1, y, side > 0 ? -0.5 : Math.PI + 0.5, 0.17);
  }
}
function rope(g, P, R, c0, c1, y) {
  const sag = Math.min(0.35, (c1 - c0) * 0.03);
  const pt = t => [c0 + (c1 - c0) * t, y + Math.sin(t * Math.PI) * sag];
  g.strokeStyle = P.vine[0]; g.lineWidth = 0.11; g.lineCap = 'round';
  g.beginPath(); g.moveTo(...pt(0));
  for (let t = 0; t <= 1.001; t += 0.02) g.lineTo(...pt(t));
  g.stroke();
  g.strokeStyle = P.vine[1]; g.lineWidth = 0.04;
  g.beginPath(); g.moveTo(...pt(0));
  for (let t = 0; t <= 1.001; t += 0.02) { const [x, yy] = pt(t); g.lineTo(x, yy - 0.025); }
  g.stroke();
  for (let t = 0.03; t < 1; t += 0.4 / (c1 - c0) + R() * 0.02) {
    const [x, yy] = pt(t);
    leafAt(g, P, R, x, yy, Math.PI / 2 + (R() - 0.5) * 1.2, 0.14);
  }
  // knots tying it at the ends
  g.fillStyle = P.vine[0];
  for (const t of [0, 1]) { const [x, yy] = pt(t); g.beginPath(); g.arc(x, yy, 0.12, 0, TAU); g.fill(); }
}

// a small map of a stage, for the stage select
export function thumbnail(L, world, w, h) {
  const P = PAL[world], c = canvas(w, h), x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, P.sky[0]); gr.addColorStop(1, P.sky[2]);
  x.fillStyle = gr; x.fillRect(0, 0, w, h);
  x.scale(w / COLS, h / ROWS);
  for (let r = 0; r < ROWS; r++)
    for (let cc = 0; cc < COLS; cc++) {
      const t = L.t[r][cc];
      if (t === '.') continue;
      x.fillStyle = t === '#' ? P.earth[2] : t === '~' ? P.water[1] : '<>'.includes(t) ? P.water[2] : t === '^' ? P.thorn[1] : t === 'T' ? '#e05a5a' : isClimb(t) || t === '-' ? P.vine[1] : t === 'x' ? P.leaf[2] : P.bark[2];
      if (t === '=' || t === 'x') x.fillRect(cc, r, 1.02, 0.4);
      else if (t === '-') x.fillRect(cc, r + 0.1, 1.02, 0.25);
      else if (isClimb(t)) x.fillRect(cc + 0.3, r, 0.4, 1.02);
      else x.fillRect(cc - 0.01, r - 0.01, 1.03, 1.03);
    }
  x.fillStyle = P.berry[1];
  for (const b of L.berries) { x.beginPath(); x.arc(b.x, b.y, 0.38, 0, TAU); x.fill(); }
  for (const m of L.movers) { x.fillStyle = P.leaf[1]; x.fillRect(m.x, m.y, m.w, 0.35); }
  if (L.door) { x.fillStyle = '#f4e8ff'; x.beginPath(); x.ellipse(L.door.x, L.door.y - 0.8, 0.5, 0.8, 0, 0, TAU); x.fill(); }
  if (L.start) { x.fillStyle = '#9fe4ff'; x.beginPath(); x.arc(L.start.x, L.start.y - 0.45, 0.45, 0, TAU); x.fill(); }
  return c;
}
