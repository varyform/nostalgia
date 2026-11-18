// VGA art made in code: parallax backdrops per zone and the static tile layer of a room,
// each painted once into an offscreen canvas.
import { BAYER, C, ZONE_PAL, dither, rgbOf } from './palette.js';

export const T = 8; // pixels per tile
const SOLIDISH = '#^~!BI';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function rng(seed) {
  let a = seed;
  return () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
}

// vertical dithered gradient through a ramp of colours, painted into ImageData
function gradient(img, w, h, stops, y0 = 0, y1 = h) {
  const d = img.data, cols = stops.map(rgbOf);
  for (let y = y0; y < y1; y++) {
    const f = ((y - y0) / Math.max(1, y1 - y0 - 1)) * (cols.length - 1);
    const i = Math.min(cols.length - 2, Math.floor(f)), frac = f - i;
    for (let x = 0; x < w; x++) {
      const c = dither(x, y, frac) ? cols[i + 1] : cols[i], o = (y * w + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
}
// ---------- backdrops: [far, mid] canvases, wider than the view for parallax ----------
export function makeBackdrop(zone, H = 184) {
  const P = ZONE_PAL[zone], far = canvas(360, H), mid = canvas(400, H);
  const fg = far.getContext('2d'), mg = mid.getContext('2d');
  const img = fg.createImageData(360, H);
  gradient(img, 360, H, P.sky);
  fg.putImageData(img, 0, 0);
  const R = rng(1234 + zone * 77);
  if (zone === 0) {
    // furnace glow on the horizon
    for (let y = H - 60; y < H; y++) {
      const f = (y - (H - 60)) / 60;
      for (let x = 0; x < 360; x++) if (dither(x, y, f * 0.55)) { fg.fillStyle = P.sky[5]; fg.fillRect(x, y, 1, 1); }
    }
    // distant smelter stacks with lit windows
    for (let x = -10; x < 360; x += 26 + Math.floor(R() * 30)) {
      const w = 14 + Math.floor(R() * 22), h = 50 + Math.floor(R() * 80);
      fg.fillStyle = P.far[0]; fg.fillRect(x, H - h, w, h);
      fg.fillStyle = P.far[1]; fg.fillRect(x, H - h, 2, h);
      if (R() < 0.6) { fg.fillStyle = P.far[0]; fg.fillRect(x + w / 2 - 3, H - h - 30, 6, 30); }
      for (let wy = H - h + 8; wy < H - 10; wy += 9)
        for (let wx = x + 3; wx < x + w - 4; wx += 6)
          if (R() < 0.35) { fg.fillStyle = P.glow[R() < 0.3 ? 1 : 0]; fg.fillRect(wx, wy, 2, 3); }
    }
    // smoke
    for (let k = 0; k < 9; k++) {
      const sx = R() * 360, sy = 20 + R() * 60;
      for (let j = 0; j < 30; j++) for (let i = 0; i < 40; i++) {
        const dx = (i - 20) / 20, dy = (j - 15) / 15;
        if (dx * dx + dy * dy < 1 && dither(sx + i, sy + j, 0.3)) { fg.fillStyle = P.far[1]; fg.fillRect(sx + i, sy + j, 1, 1); }
      }
    }
    // mid: crane girders and hanging chains
    mg.fillStyle = P.far[2];
    for (let x = 0; x < 400; x += 4) { mg.fillRect(x, 18, 3, 1); mg.fillRect(x + (x % 8 ? 0 : 1), 19 + (x % 8 ? 2 : 0), 1, 3); }
    mg.fillRect(0, 16, 400, 2); mg.fillRect(0, 23, 400, 2);
    for (let x = 20; x < 400; x += 55 + Math.floor(R() * 40)) {
      const len = 30 + Math.floor(R() * 70);
      for (let y = 25; y < 25 + len; y += 3) { mg.fillStyle = P.far[2]; mg.fillRect(x, y, 2, 2); }
      mg.fillStyle = P.far[1]; mg.fillRect(x - 4, 25 + len, 10, 3); mg.fillRect(x - 4, 28 + len, 2, 4); mg.fillRect(x + 4, 28 + len, 2, 4);
    }
  } else if (zone === 1) {
    // cold storage tanks, shaded as cylinders
    for (let x = -20; x < 360; x += 70 + Math.floor(R() * 30)) {
      const w = 44 + Math.floor(R() * 20), top = 30 + Math.floor(R() * 40);
      for (let i = 0; i < w; i++) {
        const sh = Math.cos(((i / w) - 0.35) * Math.PI);
        const c = sh > 0.85 ? P.far[2] : sh > 0.4 ? P.far[1] : P.far[0];
        for (let y = top; y < H; y++) { fg.fillStyle = dither(x + i, y, sh > 0.6 ? 0.25 : 0) ? P.sky[5] : c; fg.fillRect(x + i, y, 1, 1); }
      }
      fg.fillStyle = P.sky[0];
      for (let y = top + 14; y < H; y += 22) fg.fillRect(x, y, w, 2);
      fg.fillStyle = P.glow[0]; fg.fillRect(x + 6, top + 6, 3, 2);
    }
    // frost specks
    for (let k = 0; k < 160; k++) { fg.fillStyle = P.far[2]; fg.fillRect(Math.floor(R() * 360), Math.floor(R() * H), 1, 1); }
    // mid: pipe runs with flanges and valve wheels
    for (const [y, h] of [[34, 6], [58, 4], [H - 52, 8]]) {
      mg.fillStyle = P.far[1]; mg.fillRect(0, y, 400, h);
      mg.fillStyle = P.far[2]; mg.fillRect(0, y, 400, 1);
      mg.fillStyle = P.sky[1]; mg.fillRect(0, y + h - 1, 400, 1);
      for (let x = 10; x < 400; x += 46) { mg.fillStyle = P.far[2]; mg.fillRect(x, y - 1, 3, h + 2); }
    }
    for (let x = 30; x < 400; x += 90) {
      mg.fillStyle = P.far[1]; mg.fillRect(x + 3, 62, 2, H - 120);
      mg.fillStyle = P.far[2];
      for (let a = 0; a < 16; a++) mg.fillRect(Math.round(x + 4 + Math.cos(a / 2.5) * 6), Math.round(90 + Math.sin(a / 2.5) * 6), 1, 1);
    }
  } else if (zone === 2) {
    // deep space through the spire's windows: stars, a nebula and the planet below
    for (let k = 0; k < 220; k++) {
      const b = R();
      fg.fillStyle = b > 0.9 ? C.white : b > 0.6 ? C.steel[4] : C.steel[2];
      fg.fillRect(Math.floor(R() * 360), Math.floor(R() * H), 1, 1);
    }
    for (let j = 0; j < 70; j++) for (let i = 0; i < 160; i++) {
      const dx = (i - 80) / 80, dy = (j - 35) / 35, f = 1 - (dx * dx + dy * dy);
      if (f > 0 && dither(i + 40, j + 20, f * 0.5)) { fg.fillStyle = C.purple[f > 0.6 ? 1 : 0]; fg.fillRect(i + 40, j + 20, 1, 1); }
    }
    const pcx = 250, pcy = H + 90, pr = 150;
    for (let y = H - 70; y < H; y++)
      for (let x = 60; x < 360; x++) {
        const dx = x - pcx, dy = y - pcy, d = Math.sqrt(dx * dx + dy * dy);
        if (d < pr) {
          const lit = Math.max(0, (-dx - dy * 0.4) / pr + 0.5), band = Math.sin(y * 0.35 + dx * 0.02) > 0.6;
          const ramp = [C.cyan[0], C.cyan[1], C.cyan[2], C.green[2]];
          const f = lit * 3, i = Math.min(2, Math.floor(f));
          fg.fillStyle = dither(x, y, f - i) ? ramp[i + 1] : band ? ramp[Math.max(0, i - 1)] : ramp[i];
          fg.fillRect(x, y, 1, 1);
        } else if (d < pr + 4 && dither(x, y, (pr + 4 - d) / 4)) { fg.fillStyle = C.cyan[3]; fg.fillRect(x, y, 1, 1); }
      }
    // window struts
    fg.fillStyle = P.far[0];
    for (let x = 0; x < 360; x += 90) { fg.fillRect(x, 0, 8, H); fg.fillStyle = P.far[1]; fg.fillRect(x + 1, 0, 1, H); fg.fillStyle = P.far[0]; }
    fg.fillRect(0, 50, 360, 5);
    // mid: pylons with circuit traces
    for (let x = 15; x < 400; x += 70 + Math.floor(R() * 30)) {
      const w = 10, top = 40 + Math.floor(R() * 60);
      mg.fillStyle = P.far[1]; mg.fillRect(x, top, w, H - top);
      mg.fillStyle = P.far[2]; mg.fillRect(x, top, 1, H - top);
      for (let y = top + 6; y < H; y += 12) { mg.fillStyle = P.glow[0]; mg.fillRect(x + 3, y, 4, 1); mg.fillRect(x + 6, y, 1, 5); }
      mg.fillStyle = P.glow[1]; mg.fillRect(x + 3, top - 2, 4, 2);
    }
  } else {
    // the Foreman's core chamber: concentric rings around a red heart
    const ccx = 180, ccy = 80;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < 360; x++) {
        const d = Math.hypot(x - ccx, (y - ccy) * 1.3);
        if (Math.sin(d * 0.22) > 0.82 && d < 170) { fg.fillStyle = dither(x, y, 0.5) ? P.far[2] : P.far[1]; fg.fillRect(x, y, 1, 1); }
        else if (d < 40 && dither(x, y, (40 - d) / 40)) { fg.fillStyle = P.sky[5]; fg.fillRect(x, y, 1, 1); }
      }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      fg.fillStyle = P.far[0];
      for (let r = 45; r < 200; r += 1) fg.fillRect(Math.round(ccx + Math.cos(a) * r), Math.round(ccy + Math.sin(a) * r * 0.77), 2, 2);
    }
    // mid: sagging cables
    for (let k = 0; k < 7; k++) {
      const x0 = R() * 400, x1 = x0 + 60 + R() * 120, y0 = 10 + R() * 30, sag = 20 + R() * 40;
      mg.fillStyle = P.far[2];
      for (let i = 0; i <= 1; i += 0.005) mg.fillRect(Math.round(x0 + (x1 - x0) * i), Math.round(y0 + Math.sin(i * Math.PI) * sag), 2, 2);
    }
  }
  return { far, mid };
}

// ---------- tiles ----------
const isSolidish = c => c !== null && SOLIDISH.includes(c);

// paint the static layer of a room (doors are drawn live) into a canvas of 40 × 23 tiles
export function paintRoom(room, zone, cv) {
  const P = ZONE_PAL[zone], W = P.wall, rows = room.tiles;
  cv = cv ?? canvas(40 * T, 23 * T);
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const at = (x, y) => (y < 0 || y >= 23 || x < 0 || x >= 40 ? '#' : rows[y][x]);
  const solidAt = (x, y) => { const c = at(x, y); return isSolidish(c) || (c >= '1' && c <= '4'); };
  for (let y = 0; y < 23; y++)
    for (let x = 0; x < 40; x++) {
      const c = rows[y][x], px = x * T, py = y * T;
      if (c === '#') wallTile(g, px, py, x, y, W, P, zone, !solidAt(x, y - 1), !solidAt(x - 1, y), !solidAt(x + 1, y), !solidAt(x, y + 1));
      else if (c === '^') { wallTile(g, px, py, x, y, W, P, zone, false, !solidAt(x - 1, y), !solidAt(x + 1, y), !solidAt(x, y + 1)); spikes(g, px, py); }
      else if (c === '~') liquidTile(g, px, py, P);
      else if (c === '!') railTile(g, px, py, W);
      else if (c === 'B') grateTile(g, px, py, x, y, at);
      else if (c === 'I') iceTile(g, px, py, x, y, at);
      else if (c === '%') meshTile(g, px, py);
      else if (c === 'H') ladderTile(g, px, py, at(x - 1, y) !== 'H', at(x + 1, y) !== 'H', W);
      else if (c === '=') girderTile(g, px, py, W, at(x - 1, y) !== '=', at(x + 1, y) !== '=');
    }
  return cv;
}

function wallTile(g, px, py, x, y, W, P, zone, top, left, right, bottom) {
  const inner = !top && !left && !right && !bottom;
  g.fillStyle = inner ? W[1] : W[2];
  g.fillRect(px, py, T, T);
  // big plates of 2 × 2 tiles with seams and rivets
  if (inner) {
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) if (dither(px + i, py + j, 0.18)) { g.fillStyle = W[2]; g.fillRect(px + i, py + j, 1, 1); }
    g.fillStyle = W[0];
    if (x % 2 === 0) g.fillRect(px, py, 1, T);
    if (y % 2 === 0) g.fillRect(px, py, T, 1);
    if (x % 2 === 0 && y % 2 === 0) { g.fillStyle = W[3]; g.fillRect(px + 2, py + 2, 1, 1); }
  } else {
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) if (dither(px + i, py + j, 0.3)) { g.fillStyle = W[3]; g.fillRect(px + i, py + j, 1, 1); }
    if (zone === 0 && (x * 7 + y * 3) % 5 === 0) { g.fillStyle = W[1]; g.fillRect(px + 3, py + 1, 1, 6); g.fillRect(px + 4, py + 4, 1, 3); }
    if (zone === 2 && (x + y) % 3 === 0) { g.fillStyle = P.glow[0]; g.fillRect(px + 1, py + 5, 5, 1); g.fillRect(px + 5, py + 3, 1, 2); }
  }
  if (top) {
    g.fillStyle = W[6]; g.fillRect(px, py, T, 1);
    g.fillStyle = W[5]; g.fillRect(px, py + 1, T, 1);
    g.fillStyle = W[4]; g.fillRect(px, py + 2, T, 1);
    g.fillStyle = W[1]; g.fillRect(px, py + 3, T, 1);
    if (zone === 1 && x % 3 === 0) { g.fillStyle = C.ice[4]; g.fillRect(px + 2, py, 3, 1); }
  }
  if (left) { g.fillStyle = W[4]; g.fillRect(px, py, 1, T); }
  if (right) { g.fillStyle = W[1]; g.fillRect(px + T - 1, py, 1, T); }
  if (bottom) { g.fillStyle = W[0]; g.fillRect(px, py + T - 1, T, 1); g.fillStyle = W[1]; g.fillRect(px, py + T - 2, T, 1); }
}
function spikes(g, px, py) {
  g.fillStyle = C.steel[0]; g.fillRect(px, py, T, 3);
  for (let k = 0; k < 2; k++) {
    const sx = px + k * 4;
    g.fillStyle = C.steel[2]; g.fillRect(sx + 1, py - 4, 2, 7);
    g.fillStyle = C.steel[4]; g.fillRect(sx + 1, py - 5, 1, 3);
    g.fillStyle = C.steel[1]; g.fillRect(sx, py - 1, 4, 3);
  }
  g.fillStyle = C.red[2]; g.fillRect(px, py + 2, T, 1);
}
function liquidTile(g, px, py, P) {
  for (let j = 0; j < T; j++)
    for (let i = 0; i < T; i++) {
      const f = j / T;
      g.fillStyle = dither(px + i, py + j, 1 - f) ? P.liquid[2] : P.liquid[1];
      g.fillRect(px + i, py + j, 1, 1);
    }
}
function railTile(g, px, py, W) {
  g.fillStyle = W[1]; g.fillRect(px, py, T, T);
  g.fillStyle = C.steel[1]; g.fillRect(px, py, T, 3);
  g.fillStyle = C.steel[3]; g.fillRect(px, py, T, 1);
  // hazard chevrons on the side
  for (let i = 0; i < T; i++) { g.fillStyle = ((px + i) >> 1) % 2 ? C.yellow[3] : C.black; g.fillRect(px + i, py + 4, 1, 2); }
  g.fillStyle = W[0]; g.fillRect(px, py + 7, T, 1);
}
function grateTile(g, px, py, x, y, at) {
  const G = C.grate;
  g.fillStyle = G[2]; g.fillRect(px, py, T, T);
  // bars
  g.fillStyle = G[1];
  g.fillRect(px + 3, py, 2, T);
  g.fillRect(px, py + 3, T, 2);
  g.fillStyle = G[4]; g.fillRect(px, py, T, 1); g.fillRect(px, py, 1, T);
  // cracks: jagged dark lines that tell a bite will break it
  g.fillStyle = G[0];
  const h = (x * 31 + y * 17) % 4;
  g.fillRect(px + 1 + h, py + 1, 1, 2); g.fillRect(px + 2 + h, py + 3, 1, 2); g.fillRect(px + 1 + h, py + 5, 1, 2);
  if (h % 2) { g.fillRect(px + 5, py + 6, 2, 1); g.fillRect(px + 4, py + 7, 1, 1); }
  // rust bloom
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) if (dither(px + i + 1, py + j, 0.12)) { g.fillStyle = C.amber[2]; g.fillRect(px + i, py + j, 1, 1); }
  if (at(x, y - 1) !== 'B') { g.fillStyle = C.red[2]; g.fillRect(px, py, T, 1); }
}
function iceTile(g, px, py, x, y, at) {
  const I = C.ice;
  for (let j = 0; j < T; j++)
    for (let i = 0; i < T; i++) {
      const d = ((px + i) + (py + j) * 2) % 12;
      g.fillStyle = d < 2 ? I[3] : dither(px + i, py + j, 0.4) ? I[2] : I[1];
      g.fillRect(px + i, py + j, 1, 1);
    }
  if (at(x, y - 1) !== 'I') { g.fillStyle = I[4]; g.fillRect(px, py, T, 1); }
  if (at(x - 1, y) !== 'I') { g.fillStyle = I[3]; g.fillRect(px, py, 1, T); }
  if (at(x + 1, y) !== 'I') { g.fillStyle = I[0]; g.fillRect(px + T - 1, py, 1, T); }
  if ((x * 13 + y * 7) % 5 === 0) { g.fillStyle = C.white; g.fillRect(px + 2, py + 2, 1, 1); }
}
function meshTile(g, px, py) {
  const M = C.mesh;
  for (let j = 0; j < T; j++)
    for (let i = 0; i < T; i++) {
      if ((i % 3 === 0) || (j % 3 === 0)) { g.fillStyle = (i + j) % 2 ? M[3] : M[2]; g.fillRect(px + i, py + j, 1, 1); }
    }
  g.fillStyle = C.green[2]; g.fillRect(px + 3, py + 3, 1, 1);
}
function ladderTile(g, px, py, leftEdge, rightEdge, W) {
  g.fillStyle = W[5];
  if (leftEdge) { g.fillRect(px + 1, py, 2, T); g.fillStyle = W[3]; g.fillRect(px + 2, py, 1, T); }
  g.fillStyle = W[5];
  if (rightEdge) { g.fillRect(px + 5, py, 2, T); g.fillStyle = W[3]; g.fillRect(px + 6, py, 1, T); }
  g.fillStyle = W[4];
  g.fillRect(px + (leftEdge ? 3 : 0), py + 2, T - (leftEdge ? 3 : 0) - (rightEdge ? 3 : 0), 1);
  g.fillRect(px + (leftEdge ? 3 : 0), py + 6, T - (leftEdge ? 3 : 0) - (rightEdge ? 3 : 0), 1);
}
function girderTile(g, px, py, leftEnd, rightEnd, W) {
  g.fillStyle = W[5]; g.fillRect(px, py, T, 1);
  g.fillStyle = W[4]; g.fillRect(px, py + 1, T, 1);
  g.fillStyle = W[2]; g.fillRect(px, py + 4, T, 1);
  g.fillStyle = W[3];
  for (let i = 0; i < T; i++) g.fillRect(px + i, py + 2 + (Math.abs(((px + i) % 4) - 2) >> 1), 1, 1);
  if (leftEnd) { g.fillStyle = W[3]; g.fillRect(px, py, 1, 5); }
  if (rightEnd) { g.fillStyle = W[1]; g.fillRect(px + T - 1, py, 1, 5); }
}

// the bayer matrix is handy for fades elsewhere too
export { BAYER };
