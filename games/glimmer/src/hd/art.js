// HD art that is painted once and reused: the four reaches' palettes, the tile sprites (lit
// bricks, bedrock, ladders, ropes) at the current tile size, the static tile layer of a level,
// the parallax backdrops, glow sprites and level thumbnails.
import { COLS, ROWS } from '../level.js';

export const TAU = Math.PI * 2;
export const PAL = [
  { // The Shallows: sunlit sandstone, coral and brass
    sky: ['#14697a', '#083a49', '#03151d'], ray: '190,245,255', far: '#0e4b5a', mid: '#0a3846', near: '#062530', mote: '200,250,255',
    brick: ['#5c3a20', '#b98450', '#dfb07a', '#f6dcae'], mortar: '#4a2f18', crust: ['#ff8f7a', '#ffc4a8', '#7fd8c0'],
    stone: ['#1f2b33', '#45545f', '#6e808c'], ladder: ['#5e3f16', '#d39d3c', '#ffe7a0'], rope: ['#5a4526', '#c9ac78', '#efdcb2'],
    shard: ['#1fb8e6', '#8ff0ff', '#ffffff'], glow: '110,230,255', eye: '#ff9146', eyeGlow: '255,140,70',
    golem: ['#2c3338', '#59666d', '#8c9a9f'], rune: '255,170,90', accent: '#86ecff', dark: 0.32, cavity: ['#020c10', '#0a2630'],
  },
  { // The Coral Vaults: rose coral and violet water
    sky: ['#2b2a6e', '#14154a', '#05061a'], ray: '210,200,255', far: '#262467', mid: '#1b1a52', near: '#0e0d33', mote: '255,210,240',
    brick: ['#6b2433', '#c95a62', '#ee8a86', '#ffc4b4'], mortar: '#55182a', crust: ['#ffd27a', '#ffe9b0', '#b9a2ff'],
    stone: ['#1f1f3a', '#434568', '#6c6f96'], ladder: ['#5b4317', '#dcb455', '#fff0b0'], rope: ['#52405e', '#c4a6cc', '#ecdcf0'],
    shard: ['#e0a92a', '#ffe08a', '#ffffff'], glow: '255,210,110', eye: '#7af0ff', eyeGlow: '110,230,255',
    golem: ['#2d2a40', '#5b5876', '#8b88a6'], rune: '140,230,255', accent: '#ffb3c0', dark: 0.4, cavity: ['#04030e', '#151236'],
  },
  { // The Amber Catacombs: bone brick under lamplight
    sky: ['#4a2c10', '#24150a', '#0b0603'], ray: '255,210,140', far: '#3e2610', mid: '#2e1c0c', near: '#1b1007', mote: '255,220,160',
    brick: ['#4f4026', '#a8915f', '#d4bd88', '#f3e5bb'], mortar: '#3b2f1b', crust: ['#9bd86a', '#d3f59a', '#e6a24a'],
    stone: ['#231e19', '#4a423a', '#71675b'], ladder: ['#4a2a12', '#b9773a', '#f1bf7a'], rope: ['#4a3420', '#b08a5e', '#dcc29a'],
    shard: ['#5fd23e', '#c3ff8e', '#ffffff'], glow: '170,255,120', eye: '#ff5a3a', eyeGlow: '255,90,60',
    golem: ['#2b2620', '#5c5347', '#8f8574'], rune: '255,120,80', accent: '#ffcf86', dark: 0.5, cavity: ['#070402', '#20140a'],
  },
  { // The Abyssal Spire: basalt, steel and things that glow on their own
    sky: ['#0b2238', '#06111f', '#010409'], ray: '150,190,255', far: '#0b1c30', mid: '#081524', near: '#040b14', mote: '170,255,230',
    brick: ['#173238', '#3d6d73', '#62979b', '#a6d6d2'], mortar: '#10252a', crust: ['#ff7ad9', '#ffb6ee', '#7affd6'],
    stone: ['#121620', '#2c3343', '#4c566a'], ladder: ['#2f3a46', '#8ea4b8', '#d8e8f6'], rope: ['#334250', '#8aa4b2', '#cfe2ea'],
    shard: ['#e23fc6', '#ff9ff0', '#ffffff'], glow: '255,120,230', eye: '#b8ff4a', eyeGlow: '180,255,80',
    golem: ['#1c2128', '#414b57', '#6f7b89'], rune: '180,255,90', accent: '#c3a6ff', dark: 0.58, cavity: ['#010205', '#08101c'],
  },
];

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
// a small seeded generator for art (not the simulation's)
export function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;
}
export const hash2 = (c, r) => ((c * 73856093) ^ (r * 19349663)) >>> 0;

// ---------- soft light: a radial sprite, falloff f(d) for d 0 (centre) … 1 (rim) ----------
// Pixel by pixel rather than a gradient: f fades out with zero slope at the rim, so no ring shows
// where it ends, and a little dither breaks the 8-bit steps a dark falloff would band into.
export function softSprite(size, rgb, f) {
  const s = canvas(size, size), x = s.getContext('2d'), img = x.createImageData(size, size), d = img.data;
  const [r, gg, b] = rgb.split(',').map(Number), h = size / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const q = Math.hypot(i + 0.5 - h, j + 0.5 - h) / h, k = (j * size + i) * 4;
      const n = ((hash2(i, j) & 255) / 255 - 0.5) / 255; // ±half a step
      d[k] = r; d[k + 1] = gg; d[k + 2] = b;
      d[k + 3] = q >= 1 ? 0 : Math.max(0, Math.min(255, Math.round((f(q) + n) * 255)));
    }
  }
  x.putImageData(img, 0, 0);
  return s;
}
// a bright core in a wide halo, both bells that flatten out to nothing
export const glowFalloff = q => 0.5 * Math.max(0, 1 - (q / 0.3) ** 2) ** 2 + 0.5 * (1 - q * q) ** 2;

// ---------- glows: additive radial sprites, one per colour ----------
const glows = new Map();
export function glow(g, rgb, x, y, r, a) {
  if (a <= 0.003 || r <= 0) return;
  let s = glows.get(rgb);
  if (!s) {
    s = softSprite(128, rgb, glowFalloff);
    glows.set(rgb, s);
  }
  const op = g.globalCompositeOperation, ga = g.globalAlpha;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, a);
  g.drawImage(s, x - r, y - r, r * 2, r * 2);
  g.globalCompositeOperation = op; g.globalAlpha = ga;
}

// ---------- tiles, in tile units on a ts × ts canvas ----------
function sprite(ts, draw) {
  const c = canvas(ts, ts), x = c.getContext('2d');
  x.scale(c.width, c.height);
  draw(x);
  return c;
}
function brickFace(x, Z, rnd, crack) {
  const [edge, face, light, hi] = Z.brick;
  x.fillStyle = Z.mortar; x.fillRect(0, 0, 1, 1);
  // two courses, running bond: lit from the upper left
  const course = (y0, h, splits) => {
    let x0 = 0;
    for (const sx of [...splits, 1]) {
      const w = sx - x0, inset = 0.035;
      const bx = x0 + inset, by = y0 + inset, bw = w - inset * 2, bh = h - inset * 2;
      if (bw > 0.02) {
        const gr = x.createLinearGradient(bx, by, bx + bw * 0.3, by + bh);
        gr.addColorStop(0, light); gr.addColorStop(0.55, face); gr.addColorStop(1, edge);
        x.fillStyle = gr;
        x.beginPath(); x.roundRect(bx, by, bw, bh, 0.05); x.fill();
        x.fillStyle = hi; x.globalAlpha = 0.5; x.fillRect(bx + 0.03, by + 0.015, bw - 0.06, 0.035); x.globalAlpha = 1;
        // pits in the stone
        x.fillStyle = edge; x.globalAlpha = 0.35;
        for (let k = 0; k < 3; k++) { x.beginPath(); x.arc(bx + rnd() * bw, by + 0.08 + rnd() * (bh - 0.12), 0.012 + rnd() * 0.02, 0, TAU); x.fill(); }
        x.globalAlpha = 1;
      }
      x0 = sx;
    }
  };
  const off = rnd() * 0.2;
  course(0, 0.5, [0.42 + off]);
  course(0.5, 0.5, [0.16 + off * 0.5, 0.7 + off * 0.5]);
  // a crust of living coral on some
  if (rnd() < 0.45) {
    const n = 2 + Math.floor(rnd() * 3), cx = 0.15 + rnd() * 0.7;
    for (let k = 0; k < n; k++) {
      x.fillStyle = Z.crust[Math.floor(rnd() * 3)];
      x.beginPath(); x.arc(cx + (rnd() - 0.5) * 0.25, 0.04 + rnd() * 0.06, 0.03 + rnd() * 0.035, 0, TAU); x.fill();
    }
  }
  if (crack) {
    // a false brick: a hairline crack, there if you look for it
    x.strokeStyle = rgba(Z.mortar, 0.55); x.lineWidth = 0.018;
    x.beginPath(); x.moveTo(0.3, 0.06); x.lineTo(0.42, 0.3); x.lineTo(0.36, 0.52); x.lineTo(0.5, 0.78); x.stroke();
  }
}
export function makeTiles(Z, ts, world) {
  const rnd = prng(world * 977 + 13);
  const bricks = [0, 1, 2, 3].map(() => sprite(ts, x => brickFace(x, Z, rnd, false)));
  const traps = [0, 1].map(() => sprite(ts, x => brickFace(x, Z, rnd, true)));
  const stone = [0, 1].map(k => sprite(ts, x => {
    const [d, m, l] = Z.stone;
    x.fillStyle = d; x.fillRect(0, 0, 1, 1);
    const gr = x.createLinearGradient(0, 0, 1, 1);
    gr.addColorStop(0, l); gr.addColorStop(0.5, m); gr.addColorStop(1, d);
    x.fillStyle = gr; x.beginPath(); x.roundRect(0.04, 0.04, 0.92, 0.92, 0.08); x.fill();
    x.fillStyle = m; x.beginPath(); x.roundRect(0.14, 0.14, 0.72, 0.72, 0.05); x.fill();
    x.strokeStyle = rgba(l, 0.6); x.lineWidth = 0.025;
    x.beginPath(); x.moveTo(0.14, 0.86); x.lineTo(0.14, 0.14); x.lineTo(0.86, 0.14); x.stroke();
    x.strokeStyle = rgba(d, 0.8);
    x.beginPath(); x.moveTo(0.86, 0.14); x.lineTo(0.86, 0.86); x.lineTo(0.14, 0.86); x.stroke();
    if (k) { // a carved glyph
      x.strokeStyle = rgba(d, 0.9); x.lineWidth = 0.04; x.lineCap = 'round';
      x.beginPath(); x.moveTo(0.5, 0.28); x.lineTo(0.5, 0.72); x.moveTo(0.32, 0.4); x.lineTo(0.5, 0.52); x.lineTo(0.68, 0.4); x.stroke();
    }
  }));
  const ladder = sprite(ts, x => {
    const [d, m, l] = Z.ladder;
    for (const rx of [0.2, 0.8]) {
      const gr = x.createLinearGradient(rx - 0.05, 0, rx + 0.05, 0);
      gr.addColorStop(0, d); gr.addColorStop(0.4, l); gr.addColorStop(1, m);
      x.fillStyle = gr; x.fillRect(rx - 0.045, 0, 0.09, 1);
    }
    for (const ry of [0.22, 0.72]) {
      x.fillStyle = d; x.fillRect(0.2, ry + 0.03, 0.6, 0.05);
      x.fillStyle = m; x.fillRect(0.2, ry, 0.6, 0.055);
      x.fillStyle = l; x.fillRect(0.2, ry, 0.6, 0.018);
    }
  });
  const rope = sprite(ts, x => {
    const [d, m, l] = Z.rope;
    x.lineCap = 'round';
    x.strokeStyle = d; x.lineWidth = 0.085;
    x.beginPath(); x.moveTo(0, 0.2); x.quadraticCurveTo(0.5, 0.25, 1, 0.2); x.stroke();
    x.strokeStyle = m; x.lineWidth = 0.06;
    x.beginPath(); x.moveTo(0, 0.19); x.quadraticCurveTo(0.5, 0.24, 1, 0.19); x.stroke();
    x.strokeStyle = l; x.lineWidth = 0.018;
    for (let k = 0; k < 6; k++) { const px = k / 6 + 0.04; x.beginPath(); x.moveTo(px, 0.17); x.lineTo(px + 0.07, 0.215); x.stroke(); }
  });
  return { bricks, traps, stone, ladder, rope };
}

// the level's tiles that never change, with their shadows, painted once (live holes, the
// stair and everything that moves are drawn over it every frame)
export function paintLevel(L, Z, T, F) {
  const c = canvas(F.w + F.ts * 0.4, F.h + F.ts * 0.4), x = c.getContext('2d'), ts = F.ts;
  const solid = ch => ch === '#' || ch === '=' || ch === '~';
  // a soft drop shadow under the solid tiles
  x.fillStyle = 'rgba(0,0,0,0.38)';
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) if (solid(L.t[r][cc])) x.fillRect(cc * ts + ts * 0.12, r * ts + ts * 0.16, ts, ts);
  for (let r = 0; r < ROWS; r++)
    for (let cc = 0; cc < COLS; cc++) {
      const ch = L.t[r][cc], h = hash2(cc, r), px = cc * ts, py = r * ts;
      if (ch === '#') x.drawImage(T.bricks[h % 4], px, py, ts, ts);
      else if (ch === '~') x.drawImage(T.traps[h % 2], px, py, ts, ts);
      else if (ch === '=') x.drawImage(T.stone[h % 7 === 0 ? 1 : 0], px, py, ts, ts);
      else if (ch === 'H') x.drawImage(T.ladder, px, py, ts, ts);
      else if (ch === '-') x.drawImage(T.rope, px, py, ts, ts);
    }
  // a lit top edge where a solid tile has open water above it
  x.fillStyle = rgba(Z.brick[3], 0.22);
  for (let r = 0; r < ROWS; r++) for (let cc = 0; cc < COLS; cc++) if (solid(L.t[r][cc]) && (r === 0 || !solid(L.t[r - 1][cc]))) x.fillRect(cc * ts, r * ts, ts, ts * 0.05);
  return c;
}

// ---------- backdrops: gradient water with far ruins, then mid and near ruins (parallax) ----------
export function makeBackdrop(world, cw, ch) {
  const Z = PAL[world], rnd = prng(world * 7919 + 3), W = Math.ceil(cw * 1.12), u = ch / 1080;
  const sky = canvas(cw, ch), s = sky.getContext('2d');
  const gr = s.createLinearGradient(0, 0, 0, ch);
  gr.addColorStop(0, Z.sky[0]); gr.addColorStop(0.45, Z.sky[1]); gr.addColorStop(1, Z.sky[2]);
  s.fillStyle = gr; s.fillRect(0, 0, cw, ch);
  // a bright surface far above
  const top = s.createRadialGradient(cw * 0.5, -ch * 0.25, 0, cw * 0.5, -ch * 0.25, ch * 0.9);
  top.addColorStop(0, `rgba(${Z.ray},0.35)`); top.addColorStop(1, `rgba(${Z.ray},0)`);
  s.fillStyle = top; s.fillRect(0, 0, cw, ch);
  const layer = (col, base, hMin, hMax, kind, alpha) => {
    const c = canvas(W, ch), x = c.getContext('2d');
    x.fillStyle = col; x.globalAlpha = alpha;
    let px = -rnd() * 80 * u;
    while (px < W) {
      const w = (60 + rnd() * 140) * u, h = (hMin + rnd() * (hMax - hMin)) * ch, y = ch * base - h;
      if (kind === 'columns') {
        x.fillRect(px + w * 0.3, y, w * 0.4, ch - y);
        x.fillRect(px + w * 0.18, y, w * 0.64, 14 * u);
        x.fillRect(px + w * 0.22, y + 14 * u, w * 0.56, 8 * u);
        if (rnd() < 0.5) { // a broken lintel
          x.beginPath(); x.moveTo(px + w * 0.2, y - 10 * u); x.lineTo(px + w * 1.6, y - 30 * u); x.lineTo(px + w * 1.6, y - 6 * u); x.lineTo(px + w * 0.2, y + 6 * u); x.fill();
        }
      } else if (kind === 'arches') {
        x.beginPath(); x.moveTo(px, ch); x.lineTo(px, y + w * 0.5); x.arc(px + w * 0.5, y + w * 0.5, w * 0.5, Math.PI, 0); x.lineTo(px + w, ch);
        x.lineTo(px + w * 0.82, ch); x.lineTo(px + w * 0.82, y + w * 0.55); x.arc(px + w * 0.5, y + w * 0.55, w * 0.32, 0, Math.PI, true); x.lineTo(px + w * 0.18, ch); x.fill();
      } else { // kelp and rubble
        x.fillRect(px, ch * base, w, ch);
        for (let k = 0; k < 3; k++) {
          const kx = px + rnd() * w, kh = h * (0.6 + rnd() * 0.6);
          x.beginPath(); x.moveTo(kx - 5 * u, ch * base);
          for (let yy = 0; yy <= kh; yy += 20 * u) x.lineTo(kx + Math.sin(yy * 0.02 / u + k) * 14 * u, ch * base - yy);
          for (let yy = kh; yy >= 0; yy -= 20 * u) x.lineTo(kx + 7 * u + Math.sin(yy * 0.02 / u + k) * 14 * u, ch * base - yy);
          x.fill();
        }
      }
      px += w + (20 + rnd() * 90) * u;
    }
    return c;
  };
  // the farthest ruins are baked into the water: too far off to move with the camera
  s.drawImage(layer(Z.far, 0.95, 0.35, 0.75, 'arches', 0.75), (cw - W) / 2, 0);
  const mid = layer(Z.mid, 1.0, 0.25, 0.6, 'columns', 0.85);
  const near = layer(Z.near, 0.94, 0.1, 0.3, 'kelp', 1);
  return { sky, mid, near, W };
}

// ---------- level thumbnails for the select screen ----------
export function thumbnail(L, w, h) {
  const Z = PAL[L.world ?? 0], c = canvas(w, h), x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, Z.sky[0]); gr.addColorStop(1, Z.sky[2]);
  x.fillStyle = gr; x.fillRect(0, 0, w, h);
  const sx = w / COLS, sy = h / ROWS;
  for (let r = 0; r < ROWS; r++)
    for (let cc = 0; cc < COLS; cc++) {
      const ch = L.t[r][cc];
      if (ch === '#' || ch === '~') { x.fillStyle = Z.brick[1]; x.fillRect(cc * sx, r * sy, sx + 0.5, sy + 0.5); }
      else if (ch === '=') { x.fillStyle = Z.stone[2]; x.fillRect(cc * sx, r * sy, sx + 0.5, sy + 0.5); }
      else if (ch === 'H') { x.fillStyle = Z.ladder[1]; x.fillRect(cc * sx + sx * 0.25, r * sy, sx * 0.5, sy + 0.5); }
      else if (ch === '-') { x.fillStyle = Z.rope[1]; x.fillRect(cc * sx, r * sy + sy * 0.1, sx + 0.5, sy * 0.25); }
    }
  x.fillStyle = Z.shard[1];
  for (const k of L.shards) { x.beginPath(); x.arc((k.c + 0.5) * sx, (k.r + 0.5) * sy, Math.max(1.5, sx * 0.32), 0, TAU); x.fill(); }
  x.fillStyle = Z.eye;
  for (const k of L.guards) x.fillRect(k.c * sx + sx * 0.2, k.r * sy + sy * 0.15, sx * 0.6, sy * 0.85);
  if (L.start) { x.fillStyle = '#ffffff'; x.fillRect(L.start.c * sx + sx * 0.25, L.start.r * sy + sy * 0.1, sx * 0.5, sy * 0.9); }
  return c;
}
