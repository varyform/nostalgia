// The ground: a mown pitch with crisp chalk, its run-off, the perimeter boards (abstract and
// invented), a walkway, dugouts and the four stands with the crowd as a texture that shimmers
// when the ground roars; and the two goals, posts and bar and a net that ripples where the ball
// hits it. Seen from above with heights rising up the screen (fx.js's ZK), north up, the pitch
// vertical: x across 0..68, y along 0..105.
//
// Everything is drawn from cached pieces sized to the canvas: a grass grain tile, crowd tiles
// (three frames: still, arms up, bouncing) used as patterns, board sprites, a wear sprite, and
// the markings as one Path2D in metres. Rebuilt only when the size or the teams change.
import { PITCH } from '../sim.js';
import { SUN, TAU, ZK, canvas, clamp, hash, rng, shade } from './fx.js';

const { W, L } = PITCH;
const GX0 = W / 2 - PITCH.goalW / 2, GX1 = W / 2 + PITCH.goalW / 2, GH = PITCH.goalH;
// the surroundings, in metres from the lines
const SB = 3.6, EB = 4.6;           // boards: beside the touchlines, behind the goal lines
const VERGE = 1.6, WALK = 2.4;      // unmown grass, then the concrete walkway
const BH = 0.9, BL = 6.2;           // board height and length
const STRIPE = L / 20;              // mowing bands
// the net: depth at the top and bottom of its back, and the height of the back's top
const ND_TOP = 1.5, ND_BOT = PITCH.goalD, NZ_TOP = 2.2;

const GRASS = ['#2f7d33', '#29702e'], VERGE_COL = '#235a28', WALK_COL = '#4c5258', LINE = 'rgba(246,249,240,0.93)';

/** the stands, as world rects { x0, y0, x1, y1, rot (rows along y), front: which edge faces the pitch } */
const STANDS = [
  { x0: -60, y0: -60, x1: W + 60, y1: -EB - VERGE - WALK - 0.6, rot: false, front: 'y1' },
  { x0: -60, y0: L + EB + VERGE + WALK + 0.6, x1: W + 60, y1: L + 60, rot: false, front: 'y0' },
  { x0: -60, y0: -EB - VERGE - WALK - 0.6, x1: -SB - VERGE - WALK - 0.6, y1: L + EB + VERGE + WALK + 0.6, rot: true, front: 'x1' },
  { x0: W + SB + VERGE + WALK + 0.6, y0: -EB - VERGE - WALK - 0.6, x1: W + 60, y1: L + EB + VERGE + WALK + 0.6, rot: true, front: 'x0' },
];

// the markings, in metres
function markings() {
  const p = new Path2D(), cx = W / 2;
  p.rect(0, 0, W, L);
  p.moveTo(0, L / 2); p.lineTo(W, L / 2);
  p.moveTo(cx + PITCH.circle, L / 2); p.arc(cx, L / 2, PITCH.circle, 0, TAU);
  for (const end of [0, 1]) {
    const y = end ? L : 0, s = end ? -1 : 1;
    p.rect(cx - PITCH.boxW / 2, end ? L - PITCH.boxD : 0, PITCH.boxW, PITCH.boxD);
    p.rect(cx - PITCH.sixW / 2, end ? L - PITCH.sixD : 0, PITCH.sixW, PITCH.sixD);
    // the arc outside the box, centred on the spot
    const sy = y + s * PITCH.spot, a = Math.asin(clamp((PITCH.boxD - PITCH.spot) / PITCH.circle, -1, 1));
    const a0 = end ? Math.PI + a : a, a1 = end ? TAU - a : Math.PI - a;
    p.moveTo(cx + Math.cos(a0) * PITCH.circle, sy + Math.sin(a0) * PITCH.circle);
    p.arc(cx, sy, PITCH.circle, a0, a1);
  }
  // corner arcs
  p.moveTo(1, 0); p.arc(0, 0, 1, 0, Math.PI / 2);
  p.moveTo(W, 1); p.arc(W, 0, 1, Math.PI / 2, Math.PI);
  p.moveTo(0, L - 1); p.arc(0, L, 1, -Math.PI / 2, 0);
  p.moveTo(W - 1, L); p.arc(W, L, 1, Math.PI, Math.PI * 1.5);
  return p;
}
function spots() {
  const p = new Path2D();
  for (const [x, y, r] of [[W / 2, L / 2, 0.2], [W / 2, PITCH.spot, 0.16], [W / 2, L - PITCH.spot, 0.16]]) { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); }
  return p;
}

// ---------- cached pieces ----------
/** fine grain for the grass: light and dark specks with a slow mottle, tiling */
function grain(n = 256) {
  const c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data;
  const cell = 32, lat = n / cell, val = (i, j) => hash(((i % lat) + lat) % lat, ((j % lat) + lat) % lat + 77);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = x / cell, fy = y / cell, xi = Math.floor(fx), yi = Math.floor(fy), u = fx - xi, w = fy - yi;
    const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w);
    const a = val(xi, yi), b = val(xi + 1, yi), cc = val(xi, yi + 1), dd = val(xi + 1, yi + 1);
    const low = a + (b - a) * su + (cc - a) * sw + (a - b - cc + dd) * su * sw;
    // blades: short vertical streaks read as grass from above
    const fine = hash(x, Math.floor(y / 3) + x * 7) - 0.5;
    const v = fine * 0.16 + (low - 0.5) * 0.12, i = (y * n + x) * 4;
    if (v > 0) { d[i] = 236; d[i + 1] = 255; d[i + 2] = 200; d[i + 3] = Math.min(255, v * 255); }
    else { d[i] = 0; d[i + 1] = 24; d[i + 2] = 0; d[i + 3] = Math.min(255, -v * 255); }
  }
  g.putImageData(img, 0, 0);
  return c;
}
/** a worn, sandy patch: a soft blotch, drawn stretched where the keepers and the kick-off wear the grass */
function wearSprite() {
  const n = 128, c = canvas(n, n), g = c.getContext('2d'), r = rng(9);
  for (let i = 0; i < 70; i++) {
    const a = r() * TAU, d = Math.pow(r(), 0.7) * n * 0.36, x = n / 2 + Math.cos(a) * d, y = n / 2 + Math.sin(a) * d, s = 6 + r() * 16;
    const gr = g.createRadialGradient(x, y, 0, x, y, s);
    gr.addColorStop(0, 'rgba(150,128,72,0.16)'); gr.addColorStop(1, 'rgba(150,128,72,0)');
    g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2);
  }
  return c;
}

const FANS = ['#f4f4f0', '#20242c', '#7d8794', '#1d2f4f', '#a33a2e', '#3a5a40'];
const SKINS = ['#f0c8a4', '#d9a37c', '#b97f56', '#8a5a3c', '#5e3c28'];
/** a tile of the crowd: rows of seats with fans in the teams' colours; frame 0 still, 1 arms up, 2 bouncing */
function crowdTile(P, teams, frame) {
  const cols = 16, rows = 8, sx = 0.5, sy = 0.85, w = Math.round(cols * sx * P), h = Math.round(rows * sy * P);
  const c = canvas(w, h), g = c.getContext('2d'), kx = w / (cols * sx), ky = h / (rows * sy);
  const home = teams?.[0]?.kit ?? { shirt: '#c8102e', trim: '#ffffff' }, away = teams?.[1]?.kit ?? { shirt: '#1a4fa0', trim: '#ffffff' };
  g.fillStyle = '#18222e'; g.fillRect(0, 0, w, h);
  g.scale(kx, ky);
  const r = rng(4242);
  for (let j = 0; j < rows; j++) {
    const y = j * sy;
    // the step's edge and the seat row
    g.fillStyle = '#2a3646'; g.fillRect(0, y + sy - 0.1, cols * sx, 0.1);
    g.fillStyle = '#22324a'; g.fillRect(0, y + sy * 0.55, cols * sx, 0.16);
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * sx + (r() - 0.5) * 0.08, k = r(), here = r() < 0.9;
      const shirt = k < 0.42 ? home.shirt : k < 0.56 ? home.trim : k < 0.7 ? away.shirt : FANS[(r() * FANS.length) | 0];
      const skin = SKINS[(r() * SKINS.length) | 0], arms = r(), bounce = r(), scarf = r() < 0.18;
      if (!here) { g.fillStyle = '#2c4466'; g.fillRect(x - 0.17, y + sy * 0.38, 0.34, 0.3); continue; }
      const up = frame === 2 && bounce < 0.55 ? -0.09 : 0;
      const raise = frame === 1 ? arms < 0.6 : frame === 2 ? arms < 0.25 : arms < 0.04;
      g.fillStyle = shirt;
      g.beginPath(); g.ellipse(x, y + sy * 0.5 + up, 0.2, 0.17, 0, 0, TAU); g.fill();
      if (raise) {
        g.strokeStyle = shirt; g.lineWidth = 0.08; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - 0.15, y + sy * 0.42 + up); g.lineTo(x - 0.22, y + sy * 0.05 + up); g.moveTo(x + 0.15, y + sy * 0.42 + up); g.lineTo(x + 0.22, y + sy * 0.05 + up); g.stroke();
        g.fillStyle = skin; g.beginPath(); g.arc(x - 0.22, y + sy * 0.04 + up, 0.045, 0, TAU); g.arc(x + 0.22, y + sy * 0.04 + up, 0.045, 0, TAU); g.fill();
      }
      if (scarf && frame !== 0) { g.fillStyle = home.shirt; g.fillRect(x - 0.3, y + sy * 0.08 + up, 0.6, 0.07); g.fillStyle = home.trim; g.fillRect(x - 0.1, y + sy * 0.08 + up, 0.2, 0.07); }
      g.fillStyle = skin; g.beginPath(); g.arc(x, y + sy * 0.28 + up, 0.11, 0, TAU); g.fill();
      g.fillStyle = r() < 0.6 ? '#2a1d14' : '#6b4a2a'; g.beginPath(); g.arc(x, y + sy * 0.25 + up, 0.09, Math.PI, TAU); g.fill();
    }
  }
  return c;
}

// the boards: abstract designs and a few invented words; one sprite each, its face as seen (height × ZK)
function boardSprites(P, teams) {
  const w = Math.round(BL * P), h = Math.max(4, Math.round(BH * ZK * P));
  const home = teams?.[0], hk = home?.kit ?? { shirt: '#c8102e', trim: '#ffffff' };
  const word = (g, s, col, size = 0.72, wgt = 800) => {
    g.font = `${wgt} ${Math.round(h * size)}px 'Saira Condensed', 'Arial Narrow', sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = Math.round(h * 0.06) + 'px';
    g.fillStyle = col; g.fillText(s, w / 2, h * 0.54, w * 0.92);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  };
  const designs = [
    g => { g.fillStyle = '#0d1b2a'; g.fillRect(0, 0, w, h); word(g, 'SWERVE', '#ffd23f'); },
    g => { g.fillStyle = hk.shirt; g.fillRect(0, 0, w, h); word(g, (home?.name ?? 'HOME').toUpperCase(), shade(hk.trim, 0), 0.58); },
    g => { // chevrons
      g.fillStyle = '#e6402f'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff';
      for (let x = -h; x < w + h; x += h * 1.1) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h * 0.45, 0); g.lineTo(x + h * 0.9, h / 2); g.lineTo(x + h * 0.45, h); g.lineTo(x, h); g.lineTo(x + h * 0.45, h / 2); g.closePath(); g.fill(); }
    },
    g => { // waves
      g.fillStyle = '#f2f4f0'; g.fillRect(0, 0, w, h); g.strokeStyle = '#13a3a0'; g.lineWidth = h * 0.13;
      for (let k = 0; k < 2; k++) { g.beginPath(); for (let x = 0; x <= w; x += 4) g.lineTo(x, h * (0.35 + k * 0.32) + Math.sin(x / h * 2.4 + k) * h * 0.12); g.stroke(); }
    },
    g => { g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, h); word(g, 'FAIR PLAY', '#0d1b2a'); },
    g => { // dots
      g.fillStyle = '#1b3f8f'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff';
      for (let x = h * 0.4; x < w; x += h * 0.55) for (let y = h * 0.28; y < h; y += h * 0.44) { g.beginPath(); g.arc(x + ((y / h) > 0.5 ? h * 0.27 : 0), y, h * 0.1, 0, TAU); g.fill(); }
    },
    g => { // a bold slash in the home colours
      g.fillStyle = '#0d1b2a'; g.fillRect(0, 0, w, h);
      g.fillStyle = hk.shirt; g.beginPath(); g.moveTo(w * 0.2, h); g.lineTo(w * 0.42, 0); g.lineTo(w * 0.62, 0); g.lineTo(w * 0.4, h); g.fill();
      g.fillStyle = hk.trim; g.beginPath(); g.moveTo(w * 0.44, h); g.lineTo(w * 0.66, 0); g.lineTo(w * 0.72, 0); g.lineTo(w * 0.5, h); g.fill();
    },
    g => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); word(g, 'SEASON TICKETS', '#c8102e', 0.6, 700); },
    g => { // checker strip
      g.fillStyle = '#101010'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd23f';
      const s = h / 3; for (let x = 0, i = 0; x < w; x += s, i++) for (let j = 0; j < 3; j++) if ((i + j) % 2) g.fillRect(x, j * s, s, s);
    },
    g => { g.fillStyle = '#2b8a3e'; g.fillRect(0, 0, w, h); word(g, 'KICK IT ON', '#ffffff', 0.66); },
  ];
  return designs.map(fn => {
    const c = canvas(w, h), g = c.getContext('2d');
    fn(g);
    // a sheen across the top and a dark foot
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.35, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, h - Math.max(1, h * 0.06), w, Math.max(1, h * 0.06));
    return c;
  });
}

// the baked ground covers the pitch, run-off, walkway and the stands' front walls
const BX0 = -SB - VERGE - WALK - 0.8, BX1 = W + SB + VERGE + WALK + 0.8, BY0 = -EB - VERGE - WALK - 0.8, BY1 = L + EB + VERGE + WALK + 0.8;

/** budget: the most pixels the baked ground may take (it is drawn smaller than the screen beyond that) */
export function createPitch({ budget = 4.5e6 } = {}) {
  const LINES = markings(), SPOTS = spots();
  let built = '', P = 0, noise = null, wear = null, boards = null, ground = null, sc = 1;
  const pats = new Map(); // `${frame}|${rot}` → CanvasPattern

  function ensure(g, v, teams) {
    const key = v.P.toFixed(3) + '|' + (teams?.[0]?.id ?? '') + '|' + (teams?.[1]?.id ?? '') + '|' + (teams?.[0]?.kit?.shirt ?? '') + '|' + (teams?.[1]?.kit?.shirt ?? '');
    if (key === built) return;
    built = key; P = v.P;
    noise ??= grain();
    wear ??= wearSprite();
    pats.clear();
    for (const f of [0, 1, 2]) {
      const tile = crowdTile(P, teams, f);
      for (const rot of [false, true]) pats.set(f + '|' + rot, g.createPattern(tile, 'repeat'));
    }
    boards = boardSprites(P, teams);
    ground = bake(teams);
  }

  // ---------- the baked ground, in metres ----------
  function bake(teams) {
    const w = BX1 - BX0, h = BY1 - BY0;
    sc = P * Math.min(1, Math.sqrt(budget / (w * h * P * P)));
    const cv = canvas(w * sc, h * sc), c = cv.getContext('2d', { alpha: false });
    const world = () => c.setTransform(sc, 0, 0, sc, -BX0 * sc, -BY0 * sc);
    world();
    // the walkway, in slabs
    c.fillStyle = WALK_COL; c.fillRect(BX0, BY0, w, h);
    c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 0.04;
    c.beginPath();
    for (let x = Math.ceil(BX0 / 2) * 2; x < BX1; x += 2) { c.moveTo(x, BY0); c.lineTo(x, BY1); }
    for (let y = Math.ceil(BY0 / 2) * 2; y < BY1; y += 2) { c.moveTo(BX0, y); c.lineTo(BX1, y); }
    c.stroke();
    // the stands' front walls: navy with a yellow line
    const fw = 0.75;
    c.fillStyle = '#13233a';
    c.fillRect(BX0, BY0, w, fw); c.fillRect(BX0, BY1 - fw, w, fw); c.fillRect(BX0, BY0, fw, h); c.fillRect(BX1 - fw, BY0, fw, h);
    c.fillStyle = 'rgba(255,210,63,0.85)';
    c.fillRect(BX0, BY0 + fw * 0.55, w, 0.08); c.fillRect(BX0, BY1 - fw * 0.55 - 0.08, w, 0.08); c.fillRect(BX0 + fw * 0.55, BY0, 0.08, h); c.fillRect(BX1 - fw * 0.55 - 0.08, BY0, 0.08, h);
    // the walkway's yellow edge, then the verge and the mown stripes out to the boards
    const ox = SB + VERGE, oy = EB + VERGE;
    c.fillStyle = 'rgba(255,210,63,0.7)'; c.fillRect(-ox - 0.25, -oy - 0.25, W + 2 * ox + 0.5, L + 2 * oy + 0.5);
    c.fillStyle = VERGE_COL; c.fillRect(-ox, -oy, W + 2 * ox, L + 2 * oy);
    for (let i = Math.floor(-EB / STRIPE); i * STRIPE < L + EB; i++) {
      const y0 = Math.max(-EB, i * STRIPE), y1 = Math.min(L + EB, (i + 1) * STRIPE);
      c.fillStyle = GRASS[((i % 2) + 2) % 2]; c.fillRect(-SB, y0, W + 2 * SB, y1 - y0);
    }
    // the grain, at the canvas's own pixels
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = c.createPattern(noise, 'repeat');
    c.fillRect((-ox - BX0) * sc, (-oy - BY0) * sc, (W + 2 * ox) * sc, (L + 2 * oy) * sc);
    world();
    // wear: the goalmouths, the spots, the centre
    for (const [x, y, ww, hh, a] of [[W / 2, 2.4, 11, 5, 1], [W / 2, L - 2.4, 11, 5, 1], [W / 2, PITCH.spot, 3, 2.4, 0.7], [W / 2, L - PITCH.spot, 3, 2.4, 0.7], [W / 2, L / 2, 4, 3, 0.6]]) {
      c.globalAlpha = a; c.drawImage(wear, x - ww / 2, y - hh / 2, ww, hh);
    }
    c.globalAlpha = 1;
    dugouts(c, teams);
    goalShadow(c, 0); goalShadow(c, 1);
    // the corner flags' shadows
    c.strokeStyle = 'rgba(0,16,0,0.28)'; c.lineWidth = 0.06; c.beginPath();
    for (const [x, y] of [[0, 0], [W, 0], [0, L], [W, L]]) { c.moveTo(x, y); c.lineTo(x + SUN[0] * 1.5, y + SUN[1] * 1.5); }
    c.stroke();
    boardsSides(c);
    boardsTop(c);
    return cv;
  }
  function boardsTop(c) {
    // along the far end: faces rising up the screen, a shadow behind
    const y = -EB, h = BH * ZK;
    for (let i = 0, x = -SB; x < W + SB - 0.5; i++, x += BL + 0.1) {
      const len = Math.min(BL, W + SB - x), spr = boards[Math.floor(hash(i, 3) * boards.length)];
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x + 0.15, y - 0.1, len, 0.35);
      c.drawImage(spr, 0, 0, (len / BL) * spr.width, spr.height, x, y - h, len, h);
    }
  }
  function boardsSides(c) {
    // beside the touchlines: laid back toward the stands, read from the pitch
    const d = BH * 0.7;
    for (const side of [0, 1]) {
      const x = side ? W + SB : -SB;
      for (let i = 0, y = -EB; y < L + EB - 0.5; i++, y += BL + 0.1) {
        const len = Math.min(BL, L + EB - y), spr = boards[Math.floor(hash(i, side + 9) * boards.length)];
        c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(side ? x + d : x - d - 0.25, y + 0.15, 0.25, len);
        c.save();
        if (side) { c.translate(x, y); c.rotate(Math.PI / 2); c.drawImage(spr, 0, 0, (len / BL) * spr.width, spr.height, 0, -d, len, d); }
        else { c.translate(x, y + len); c.rotate(-Math.PI / 2); c.drawImage(spr, 0, 0, (len / BL) * spr.width, spr.height, 0, -d, len, d); }
        c.restore();
        c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(side ? x : x - 0.06, y, 0.06, len);
      }
    }
  }
  function dugouts(c, teams) {
    const x0 = -SB - VERGE - 0.1, x1 = x0 - WALK + 0.3;
    for (const [k, y0] of [[0, 41], [1, 56]]) {
      const kit = teams?.[k]?.kit;
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x1 + 0.3, y0 + 0.3, x0 - x1, 8);
      c.fillStyle = '#13233a'; c.fillRect(x1, y0, x0 - x1, 8);
      for (let i = 0; i < 6; i++) {
        const X = x1 + 0.9, Y = y0 + 0.8 + i * 1.25;
        c.fillStyle = kit?.shirt ?? '#888888'; c.beginPath(); c.arc(X, Y + 0.12, 0.24, 0, TAU); c.fill();
        c.fillStyle = '#d9a37c'; c.beginPath(); c.arc(X, Y - 0.06, 0.13, 0, TAU); c.fill();
      }
      c.fillStyle = 'rgba(190,220,255,0.22)'; c.fillRect(x1, y0, x0 - x1, 8);
      c.strokeStyle = 'rgba(220,240,255,0.6)'; c.lineWidth = 0.06; c.strokeRect(x1, y0, x0 - x1, 8);
    }
  }
  function goalShadow(c, end) {
    const y = end ? L : 0, out = end ? 1 : -1, sh = (x, yy, z) => [x + SUN[0] * z, yy + SUN[1] * z];
    const pts = [sh(GX0, y, 0), sh(GX0, y, GH), sh(GX0, y + out * ND_TOP, NZ_TOP), sh(GX0, y + out * ND_BOT, 0), sh(GX1, y + out * ND_BOT, 0), sh(GX1, y + out * ND_TOP, NZ_TOP), sh(GX1, y, GH), sh(GX1, y, 0)];
    c.fillStyle = 'rgba(0,20,0,0.12)'; c.beginPath(); pts.forEach(([X, Y], i) => (i ? c.lineTo(X, Y) : c.moveTo(X, Y))); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,16,0,0.3)'; c.lineWidth = 0.12; c.lineJoin = 'round';
    const a = sh(GX0, y, 0), b = sh(GX0, y, GH), cc = sh(GX1, y, GH), d = sh(GX1, y, 0);
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(cc[0], cc[1]); c.lineTo(d[0], d[1]); c.stroke();
    c.lineJoin = 'miter';
  }

  // ---------- per frame ----------
  /** world rect → whole-pixel screen rect clipped to the view; null when off screen */
  function rect(v, x0, y0, x1, y1) {
    const X0 = Math.max(0, Math.floor(v.X(x0))), X1 = Math.min(v.cw, Math.ceil(v.X(x1))), Y0 = Math.max(0, Math.floor(v.Y(y0, 0))), Y1 = Math.min(v.ch, Math.ceil(v.Y(y1, 0)));
    return X1 > X0 && Y1 > Y0 ? [X0, Y0, X1 - X0, Y1 - Y0] : null;
  }
  const at = (v, rot) => {
    const m = new DOMMatrix().translateSelf(v.X(0), v.Y(0, 0));
    return rot ? m.rotateSelf(90) : m;
  };
  function stands(g, v, t, roar) {
    let any = false;
    for (let si = 0; si < STANDS.length; si++) {
      const S = STANDS[si], whole = rect(v, S.x0, S.y0, S.x1, S.y1);
      if (!whole) continue;
      any = true;
      // sections along the stand, each with its own frame: calm most of the time, a sea of arms on a goal
      const along = S.rot ? [S.y0, S.y1] : [S.x0, S.x1], sec = 8;
      for (let a = Math.floor(along[0] / sec) * sec; a < along[1]; a += sec) {
        const b = Math.min(along[1], a + sec), r = S.rot ? rect(v, S.x0, Math.max(a, S.y0), S.x1, b) : rect(v, Math.max(a, S.x0), S.y0, b, S.y1);
        if (!r) continue;
        const id = si * 100 + Math.round(a / sec);
        let f = 0;
        if (roar > 0.05) { const rate = 3 + roar * 9; f = hash(id, Math.floor(t * rate + id * 0.3)) < 0.25 + roar * 0.75 ? 1 + (hash(id + 7, Math.floor(t * rate)) < 0.5 ? 1 : 0) : 0; }
        else f = hash(id, Math.floor(t * 0.7 + id * 0.37)) < 0.12 ? 2 : 0;
        const pat = pats.get(f + '|' + S.rot);
        pat.setTransform(at(v, S.rot));
        g.fillStyle = pat; g.fillRect(r[0], r[1], r[2], r[3]);
      }
      // darker towards the back, under the roof
      const f0 = S[S.front], dir = S.front.endsWith('1') ? -1 : 1, axis = S.front[0];
      const p0 = axis === 'y' ? [0, v.Y(f0, 0)] : [v.X(f0), 0], p1 = axis === 'y' ? [0, v.Y(f0 + dir * 14, 0)] : [v.X(f0 + dir * 14), 0];
      const gr = g.createLinearGradient(p0[0], p0[1], p1[0], p1[1]);
      gr.addColorStop(0, 'rgba(6,12,22,0)'); gr.addColorStop(1, 'rgba(6,12,22,0.6)');
      g.fillStyle = gr; g.fillRect(whole[0], whole[1], whole[2], whole[3]);
    }
    // camera flashes in the stands on a goal
    if (any && roar > 0.3) {
      const n = Math.floor(roar * 26);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const S = STANDS[(Math.random() * 2) | 0], x = v.x0 + Math.random() * (v.x1 - v.x0), y = S.y0 + Math.random() * (S.y1 - S.y0);
        const X = v.X(x), Y = v.Y(y, 0);
        if (Y < 0 || Y > v.ch) continue;
        const s = (0.12 + Math.random() * 0.2) * P;
        g.fillStyle = 'rgba(255,255,240,0.35)'; g.beginPath(); g.arc(X, Y, s * 2.4, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(X, Y, s * 0.6, 0, TAU); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }
  }
  function flags(g, v, t) {
    const h = 1.5;
    for (const [x, y] of [[0, 0], [W, 0], [0, L], [W, L]]) {
      const X = v.X(x), Y = v.Y(y, 0), T = v.Y(y, h);
      if (X < -40 || X > v.cw + 40 || Y < -60 || T > v.ch + 10) continue;
      g.strokeStyle = '#f2f2ee'; g.lineWidth = Math.max(1.5, 0.06 * P);
      g.beginPath(); g.moveTo(X, Y); g.lineTo(X, T); g.stroke();
      const f = Math.sin(t * 7 + x) * 0.12;
      g.fillStyle = '#ffd23f';
      g.beginPath(); g.moveTo(X, T); g.quadraticCurveTo(X + 0.3 * P, T + (0.1 + f) * P, X + 0.62 * P, T + (0.18 + f * 1.5) * P); g.lineTo(X, T + 0.42 * P); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(160,110,0,0.6)'; g.lineWidth = 1; g.stroke();
    }
  }

  /** everything under the players: the stands, the baked ground, crisp chalk, the corner flags */
  function draw(g, v, t, roar, teams) {
    ensure(g, v, teams);
    // the baked ground covers the middle; the stands show only past it
    const wx0 = v.x - v.ox / P, wy0 = v.y - v.oy / P, wx1 = wx0 + v.cw / P, wy1 = wy0 + v.ch / P;
    if (wx0 < BX0 || wy0 < BY0 || wx1 > BX1 || wy1 > BY1) stands(g, v, t, roar);
    const ix0 = Math.max(BX0, wx0), iy0 = Math.max(BY0, wy0), ix1 = Math.min(BX1, wx1), iy1 = Math.min(BY1, wy1);
    if (ix1 > ix0 && iy1 > iy0) g.drawImage(ground, (ix0 - BX0) * sc, (iy0 - BY0) * sc, (ix1 - ix0) * sc, (iy1 - iy0) * sc, v.X(ix0), v.Y(iy0, 0), (ix1 - ix0) * P, (iy1 - iy0) * P);
    g.save();
    g.setTransform(P, 0, 0, P, v.X(0), v.Y(0, 0));
    g.strokeStyle = LINE; g.lineWidth = 0.12; g.stroke(LINES);
    g.fillStyle = LINE; g.fill(SPOTS);
    g.restore();
    flags(g, v, t);
  }
  /** what stands in front of the players at the near end: its boards, their faces rising up the screen */
  function over(g, v) {
    const y = L + EB, h = BH * ZK * P, Y = v.Y(y, 0);
    if (Y - h > v.ch || Y < 0) return;
    for (let i = 0, x = -SB; x < W + SB - 0.5; i++, x += BL + 0.1) {
      const X = v.X(x), len = Math.min(BL, W + SB - x), w = len * P, spr = boards[Math.floor(hash(i, 4) * boards.length)];
      if (X > v.cw || X + w < 0) continue;
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(X + 0.15 * P, Y - 0.1 * P, w, 0.35 * P);
      g.drawImage(spr, 0, 0, (len / BL) * spr.width, spr.height, X, Y - h, w, h);
    }
  }

  // ---------- the goals ----------
  const NU = 14, NW = 6;
  /** a goal's net (part 'back': roof, back and sides) or its frame (part 'front': posts and bar) */
  function goal(g, v, end, part, fx) {
    const y = end ? L : 0, out = end ? 1 : -1;
    if (v.Y(y + out * 2.2, 0) < -3 * P && v.Y(y, GH) < -3 * P) return;
    if (v.Y(y - out * 0.5, GH + 0.5) > v.ch + 3 * P && v.Y(y + out * 2.2, NZ_TOP) > v.ch + 3 * P) return;
    if (part === 'front') return frame(g, v, y);
    const live = fx?.netLive(end), bulge = live ? (u, w) => fx.netAt(end, u, w) : () => 0;
    // back panel point (u across, w up), roof point (u, s from the bar back), side point (side, s, w)
    const back = (u, w) => { const d = bulge(u, w); return [v.X(GX0 + (GX1 - GX0) * u), v.Y(y + out * (ND_BOT + (ND_TOP - ND_BOT) * w + d), NZ_TOP * w)]; };
    const roof = (u, s) => { const d = bulge(u, 1) * s; return [v.X(GX0 + (GX1 - GX0) * u), v.Y(y + out * (ND_TOP * s + d * 0.6), GH + (NZ_TOP - GH) * s + d * 0.2)]; };
    const side = (k, s, w) => { const d = bulge(k, w) * s * 0.5, x = k ? GX1 + d : GX0 - d; return [v.X(x), v.Y(y + out * s * (ND_BOT + (ND_TOP - ND_BOT) * w), w * (GH + (NZ_TOP - GH) * s))]; };
    const poly = (n, f) => { for (let i = 0; i <= n; i++) { const [X, Y] = f(i / n); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); } };
    const steps = live ? 10 : 1;
    // a faint body to the net
    g.fillStyle = 'rgba(235,240,245,0.07)';
    g.beginPath(); poly(steps, u => back(u, 0)); poly(steps, w => back(1, w)); poly(steps, u => back(1 - u, 1)); poly(steps, w => back(0, 1 - w)); g.fill();
    g.beginPath(); poly(steps, u => roof(u, 0)); poly(1, s => roof(1, s)); poly(steps, u => roof(1 - u, 1)); poly(1, s => roof(0, 1 - s)); g.fill();
    // stanchions from the bar's ends to the back
    g.strokeStyle = 'rgba(200,205,210,0.9)'; g.lineWidth = Math.max(1, 0.05 * P);
    g.beginPath();
    for (const k of [0, 1]) { const a = side(k, 0, 1), b = side(k, 1, 1), c = side(k, 1, 0); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }
    g.stroke();
    // the mesh
    g.strokeStyle = 'rgba(244,246,250,0.55)'; g.lineWidth = Math.max(1, 0.028 * P);
    g.beginPath();
    for (let i = 0; i <= NU; i++) { const u = i / NU; poly(live ? NW : 1, w => back(u, w)); poly(live ? 3 : 1, s => roof(u, 1 - s)); }
    for (let j = 0; j <= NW; j++) { const w = j / NW; poly(live ? NU : 1, u => back(u, w)); }
    for (let j = 1; j <= 3; j++) { const s = j / 4; poly(live ? NU : 1, u => roof(u, s)); }
    for (const k of [0, 1]) {
      for (let j = 1; j < 4; j++) { const s = j / 4; poly(live ? 4 : 1, w => side(k, s, w)); }
      for (let j = 1; j < NW; j++) { const w = j / NW; poly(2, s => side(k, s, w)); }
    }
    g.stroke();
  }
  function frame(g, v, y) {
    const a = [v.X(GX0), v.Y(y, 0)], b = [v.X(GX0), v.Y(y, GH)], c = [v.X(GX1), v.Y(y, GH)], d = [v.X(GX1), v.Y(y, 0)];
    const path = () => { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); };
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(10,20,10,0.45)'; g.lineWidth = 0.16 * P + 2; path(); g.stroke();
    g.strokeStyle = '#f4f6f2'; g.lineWidth = 0.14 * P; path(); g.stroke();
    // a little shade on the right of each post and under the bar
    g.strokeStyle = 'rgba(120,130,140,0.55)'; g.lineWidth = 0.04 * P;
    g.beginPath(); g.moveTo(a[0] + 0.04 * P, a[1]); g.lineTo(b[0] + 0.04 * P, b[1] + 0.05 * P); g.lineTo(c[0] - 0.04 * P, c[1] + 0.05 * P); g.moveTo(d[0] + 0.04 * P, d[1]); g.lineTo(c[0] + 0.04 * P, c[1] + 0.05 * P); g.stroke();
    g.lineJoin = 'miter'; g.lineCap = 'butt';
  }

  return { draw, over, goal, reset() { built = ''; ground = null; }, get groundSize() { return ground ? [ground.width, ground.height] : null; } };
}

/** a little picture of the whole pitch for the radar, w × h pixels, the pitch filling it */
export function radarPitch(w, h) {
  const c = canvas(w, h), g = c.getContext('2d'), k = Math.min(w / W, h / L);
  g.fillStyle = 'rgba(30,92,40,0.88)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 10; i++) { g.fillStyle = i % 2 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'; g.fillRect(0, i * h / 10, w, h / 10); }
  g.save(); g.translate((w - W * k) / 2, (h - L * k) / 2); g.scale(k, k);
  g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = 1.4 / k;
  g.stroke(markings());
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(GX0, -0.9, GX1 - GX0, 0.9); g.fillRect(GX0, L, GX1 - GX0, 0.9);
  g.restore();
  return c;
}
