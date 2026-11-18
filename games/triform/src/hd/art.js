// HD art made in code: parallax backdrops per zone and the static tile layer of a room,
// painted as vectors at the screen's own resolution into offscreen canvases. The colours are
// the VGA ramps, so both versions show the same foundry.
import { COLS, ROWS } from '../world.js';
import { C, ZONE_PAL } from '../vga/palette.js';

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
// a colour with alpha, from a #rrggbb ramp entry
export const rgba = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };
export const mix = (a, b, t) => {
  const x = hex(a), y = hex(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
};
const hash = (x, y, s = 0) => {
  let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177);
  h ^= h >>> 13; h = Math.imul(h, 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

// ---------- backdrops ----------
// Each is one period wide (tiles seamlessly) and as tall as the screen.
export function makeBackdrop(zone, w, h) {
  const P = ZONE_PAL[zone], far = canvas(w, h), mid = canvas(w, h);
  const fg = far.getContext('2d'), mg = mid.getContext('2d'), u = h / 1080;
  const R = rng(4321 + zone * 97);
  // draw fn at x and, if it crosses an edge, again one period over
  const wrap = (x, ww, fn) => { fn(x); if (x + ww > w) fn(x - w); if (x < 0) fn(x + w); };
  const sky = fg.createLinearGradient(0, 0, 0, h);
  P.sky.forEach((c, i) => sky.addColorStop(i / (P.sky.length - 1), c));
  fg.fillStyle = sky; fg.fillRect(0, 0, w, h);
  const blob = (g, x, y, r, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  if (zone === 0) {
    // furnace glow on the horizon, smelter stacks with lit windows, smoke
    const hz = fg.createLinearGradient(0, h * 0.55, 0, h);
    hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(1, rgba(P.glow[0], 0.35));
    fg.fillStyle = hz; fg.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += (60 + R() * 90) * u) {
      const sw = (40 + R() * 70) * u, sh = (220 + R() * 380) * u, top = h - sh;
      wrap(x, sw, X => {
        const gr = fg.createLinearGradient(X, 0, X + sw, 0);
        gr.addColorStop(0, P.far[1]); gr.addColorStop(0.3, P.far[0]); gr.addColorStop(1, mix(P.far[0], '#000000', 0.4));
        fg.fillStyle = gr; fg.fillRect(X, top, sw, sh);
        if (R() < 0.6) { fg.fillStyle = P.far[0]; fg.fillRect(X + sw * 0.35, top - 120 * u, sw * 0.3, 120 * u); blob(fg, X + sw * 0.5, top - 130 * u, 40 * u, rgba(P.glow[0], 0.25)); }
        for (let wy = top + 26 * u; wy < h - 30 * u; wy += 30 * u)
          for (let wx = X + 10 * u; wx < X + sw - 14 * u; wx += 18 * u)
            if (R() < 0.3) { fg.fillStyle = rgba(P.glow[R() < 0.3 ? 1 : 0], 0.55 + R() * 0.4); fg.fillRect(wx, wy, 6 * u, 10 * u); }
      });
    }
    for (let k = 0; k < 14; k++) { const x = R() * w, y = (60 + R() * 320) * u, r = (90 + R() * 160) * u; wrap(x - r, r * 2, X => blob(fg, X + r, y, r, rgba(P.far[1], 0.6))); }
    // mid: a crane girder and hanging chains
    mg.strokeStyle = P.far[2]; mg.lineWidth = 5 * u;
    const gy = 70 * u, gh = 36 * u;
    mg.fillStyle = P.far[2]; mg.fillRect(0, gy, w, 7 * u); mg.fillRect(0, gy + gh, w, 7 * u);
    mg.beginPath();
    for (let x = 0; x < w; x += gh) { mg.moveTo(x, gy + 4 * u); mg.lineTo(x + gh / 2, gy + gh); mg.lineTo(x + gh, gy + 4 * u); }
    mg.stroke();
    for (let x = 60 * u; x < w; x += (160 + R() * 140) * u) {
      const len = (120 + R() * 300) * u;
      wrap(x, 30 * u, X => {
        mg.strokeStyle = P.far[2]; mg.lineWidth = 4 * u; mg.setLineDash([9 * u, 5 * u]);
        mg.beginPath(); mg.moveTo(X, gy + gh); mg.lineTo(X, gy + gh + len); mg.stroke(); mg.setLineDash([]);
        mg.lineWidth = 7 * u; mg.beginPath(); mg.arc(X, gy + gh + len + 14 * u, 14 * u, -0.3, Math.PI + 0.6); mg.stroke();
      });
    }
  } else if (zone === 1) {
    // cold storage tanks shaded as cylinders, frost specks
    for (let x = 0; x < w; x += (220 + R() * 120) * u) {
      const tw = (150 + R() * 80) * u, top = (110 + R() * 160) * u;
      wrap(x, tw, X => {
        const gr = fg.createLinearGradient(X, 0, X + tw, 0);
        gr.addColorStop(0, P.far[0]); gr.addColorStop(0.3, P.far[2]); gr.addColorStop(0.55, P.far[1]); gr.addColorStop(1, mix(P.far[0], '#000000', 0.5));
        fg.fillStyle = gr;
        fg.beginPath(); fg.roundRect(X, top, tw, h - top + 10, [tw / 2, tw / 2, 0, 0]); fg.fill();
        fg.fillStyle = rgba(P.sky[0], 0.8);
        for (let y = top + 70 * u; y < h; y += 80 * u) fg.fillRect(X, y, tw, 6 * u);
        blob(fg, X + tw * 0.25, top + 40 * u, 16 * u, rgba(P.glow[0], 0.9));
      });
    }
    for (let k = 0; k < 220; k++) { fg.fillStyle = rgba(P.glow[2], 0.15 + R() * 0.3); const r = (1 + R() * 2) * u; fg.fillRect(R() * w, R() * h, r, r); }
    // mid: pipe runs with flanges, valve wheels
    for (const [y, ph] of [[120, 22], [210, 14], [h / u - 190, 30]]) {
      const Y = y * u, H2 = ph * u, gr = mg.createLinearGradient(0, Y, 0, Y + H2);
      gr.addColorStop(0, P.far[2]); gr.addColorStop(0.4, P.far[1]); gr.addColorStop(1, P.sky[0]);
      mg.fillStyle = gr; mg.fillRect(0, Y, w, H2);
      mg.fillStyle = P.far[2];
      for (let x = 30 * u; x < w; x += 150 * u) mg.fillRect(x, Y - 5 * u, 12 * u, H2 + 10 * u);
    }
    for (let x = 100 * u; x < w; x += 300 * u) {
      wrap(x - 30 * u, 60 * u, X => {
        mg.fillStyle = P.far[1]; mg.fillRect(X + 26 * u, 230 * u, 8 * u, h - 420 * u);
        mg.strokeStyle = P.far[2]; mg.lineWidth = 6 * u;
        mg.beginPath(); mg.arc(X + 30 * u, 330 * u, 26 * u, 0, Math.PI * 2); mg.moveTo(X + 4 * u, 330 * u); mg.lineTo(X + 56 * u, 330 * u); mg.moveTo(X + 30 * u, 304 * u); mg.lineTo(X + 30 * u, 356 * u); mg.stroke();
      });
    }
  } else if (zone === 2) {
    // deep space through the spire's windows: stars, a nebula and the planet below
    blob(fg, w * 0.3, h * 0.3, h * 0.45, rgba(C.purple[1], 0.55));
    blob(fg, w * 0.75, h * 0.2, h * 0.3, rgba(C.purple[2], 0.25));
    for (let k = 0; k < 420; k++) {
      const b = R(), r = (b > 0.95 ? 3 : b > 0.7 ? 2 : 1.2) * u;
      fg.fillStyle = b > 0.9 ? '#ffffff' : b > 0.6 ? C.steel[4] : C.steel[2];
      fg.globalAlpha = 0.5 + R() * 0.5;
      fg.beginPath(); fg.arc(R() * w, R() * h, r, 0, Math.PI * 2); fg.fill();
    }
    fg.globalAlpha = 1;
    const pcx = w * 0.7, pcy = h + h * 0.55, pr = h * 0.85;
    blob(fg, pcx, pcy, pr * 1.12, rgba(C.cyan[2], 0.35));
    const pg = fg.createRadialGradient(pcx - pr * 0.4, pcy - pr * 0.6, pr * 0.1, pcx, pcy, pr);
    pg.addColorStop(0, C.green[2]); pg.addColorStop(0.45, C.cyan[1]); pg.addColorStop(1, C.cyan[0]);
    fg.fillStyle = pg; fg.beginPath(); fg.arc(pcx, pcy, pr, 0, Math.PI * 2); fg.fill();
    fg.save(); fg.clip();
    fg.strokeStyle = rgba(C.cyan[3], 0.18); fg.lineWidth = 10 * u;
    for (let k = 0; k < 7; k++) { fg.beginPath(); fg.ellipse(pcx, pcy - pr * 0.3 + k * 40 * u, pr * 1.1, 26 * u, -0.08, 0, Math.PI * 2); fg.stroke(); }
    fg.restore();
    // window struts
    for (let x = 0; x < w; x += 360 * u) {
      const gr = fg.createLinearGradient(x, 0, x + 26 * u, 0);
      gr.addColorStop(0, P.far[1]); gr.addColorStop(1, P.far[0]);
      fg.fillStyle = gr; fg.fillRect(x, 0, 26 * u, h);
    }
    fg.fillStyle = P.far[0]; fg.fillRect(0, 190 * u, w, 18 * u);
    // mid: pylons with circuit traces
    for (let x = 40 * u; x < w; x += (240 + R() * 120) * u) {
      const pw = 34 * u, top = (140 + R() * 220) * u;
      wrap(x, pw, X => {
        const gr = mg.createLinearGradient(X, 0, X + pw, 0);
        gr.addColorStop(0, P.far[2]); gr.addColorStop(1, P.far[0]);
        mg.fillStyle = gr; mg.fillRect(X, top, pw, h - top);
        mg.strokeStyle = rgba(P.glow[0], 0.7); mg.lineWidth = 3 * u;
        for (let y = top + 24 * u; y < h; y += 46 * u) { mg.beginPath(); mg.moveTo(X + 8 * u, y); mg.lineTo(X + 22 * u, y); mg.lineTo(X + 22 * u, y + 18 * u); mg.stroke(); }
        blob(mg, X + pw / 2, top, 26 * u, rgba(P.glow[1], 0.8));
      });
    }
  } else {
    // the Foreman's core chamber: rings and spokes around a red heart
    const ccx = w * 0.5, ccy = h * 0.42;
    blob(fg, ccx, ccy, h * 0.35, rgba(P.glow[0], 0.45));
    fg.strokeStyle = P.far[2];
    for (let r = 120 * u, k = 0; r < w; r += (70 + k * 6) * u, k++) { fg.lineWidth = (6 + (k % 3) * 4) * u; fg.globalAlpha = 0.8 - k * 0.05; fg.beginPath(); fg.ellipse(ccx, ccy, r, r * 0.77, 0, 0, Math.PI * 2); fg.stroke(); }
    fg.globalAlpha = 1; fg.strokeStyle = P.far[0]; fg.lineWidth = 10 * u;
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; fg.beginPath(); fg.moveTo(ccx + Math.cos(a) * 140 * u, ccy + Math.sin(a) * 108 * u); fg.lineTo(ccx + Math.cos(a) * w, ccy + Math.sin(a) * w * 0.77); fg.stroke(); }
    // mid: sagging cables
    mg.strokeStyle = P.far[2]; mg.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      const x0 = R() * w, x1 = x0 + (200 + R() * 360) * u, y0 = (30 + R() * 100) * u, sag = (60 + R() * 140) * u;
      mg.lineWidth = (5 + R() * 6) * u;
      wrap(x0, x1 - x0, X => { mg.beginPath(); mg.moveTo(X, y0); mg.quadraticCurveTo(X + (x1 - x0) / 2, y0 + sag * 2, X + x1 - x0, y0); mg.stroke(); });
    }
  }
  return { far, mid };
}

// ---------- tiles ----------
const SOLID_LOOK = '#^~!BI';
const isDoor = c => c >= '1' && c <= '4';
const solidLook = c => c === null || SOLID_LOOK.includes(c) || isDoor(c);

// Paint a room's static tiles at ts px per tile. Doors are left out (the renderer draws them
// live, sliding), except for the ladder some of them uncover.
export function paintRoom(tiles, zone, ts) {
  const P = ZONE_PAL[zone], W = P.wall;
  const cv = canvas(COLS * ts, ROWS * ts), g = cv.getContext('2d');
  g.scale(ts, ts);
  const at = (x, y) => (y < 0 || y >= ROWS || x < 0 || x >= COLS ? null : tiles[y][x]);
  const wallish = (x, y) => { const c = at(x, y); return c === null || c === '#' || c === '^' || c === '!' || isDoor(c); };
  const solid = (x, y) => solidLook(at(x, y));
  const rungs = c => c === 'H' || isDoor(c);

  // soft contact shadows on the open side of every wall face
  const sh = 0.55, dark = 'rgba(0,0,0,0.5)', clear = 'rgba(0,0,0,0)';
  const grads = {
    l: [0, 0, sh, 0], r: [1, 0, 1 - sh, 0], t: [0, 0, 0, sh], b: [0, 1, 0, 1 - sh],
  };
  for (const k in grads) { const [a, b, c, d] = grads[k], gr = g.createLinearGradient(a, b, c, d); gr.addColorStop(0, dark); gr.addColorStop(1, clear); grads[k] = gr; }
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      if (solid(x, y)) continue;
      g.save(); g.translate(x, y);
      if (wallish(x - 1, y)) { g.fillStyle = grads.l; g.fillRect(0, 0, 1, 1); }
      if (wallish(x + 1, y)) { g.fillStyle = grads.r; g.fillRect(0, 0, 1, 1); }
      if (wallish(x, y - 1)) { g.fillStyle = grads.t; g.fillRect(0, 0, 1, 1); }
      if (wallish(x, y + 1)) { g.fillStyle = grads.b; g.fillRect(0, 0, 1, 1); }
      g.restore();
    }

  // the wall mass, run by run
  const e = 0.02; // overlap so neighbouring tiles leave no hairline seams
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; ) {
      if (!wallish(x, y) || at(x, y) === null) { x++; continue; }
      let x1 = x;
      while (x1 < COLS && wallish(x1, y) && !isDoor(at(x1, y))) x1++;
      if (x1 === x) { x++; continue; }
      g.fillStyle = W[1]; g.fillRect(x - e, y - e, x1 - x + 2 * e, 1 + 2 * e);
      x = x1;
    }
  // plates: 2 × 2 tiles each, shaded a little differently, with seams and rivets
  for (let y = 0; y < ROWS; y += 2)
    for (let x = 0; x < COLS; x += 2) {
      const cells = [[0, 0], [1, 0], [0, 1], [1, 1]].filter(([i, j]) => at(x + i, y + j) === '#');
      if (!cells.length) continue;
      const v = hash(x, y, zone);
      g.fillStyle = rgba(W[v < 0.33 ? 0 : 2], 0.35 + v * 0.3);
      for (const [i, j] of cells) g.fillRect(x + i, y + j, 1, 1);
      g.strokeStyle = rgba(W[0], 0.9); g.lineWidth = 0.05;
      g.beginPath();
      for (const [i, j] of cells) {
        if (i === 0) { g.moveTo(x, y + j); g.lineTo(x, y + j + 1); }
        if (j === 0) { g.moveTo(x + i, y); g.lineTo(x + i + 1, y); }
      }
      g.stroke();
      if (cells.length === 4) {
        g.fillStyle = W[3];
        for (const [i, j] of [[0.25, 0.25], [1.75, 0.25], [0.25, 1.75], [1.75, 1.75]]) { g.beginPath(); g.arc(x + i, y + j, 0.06, 0, Math.PI * 2); g.fill(); }
        if (v > 0.8) { g.strokeStyle = rgba(W[3], 0.4); g.lineWidth = 0.08; g.strokeRect(x + 0.5, y + 0.5, 1, 1); }
      }
    }
  // exposed faces: lit top bevel, highlight on the left, shade on the right and below
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const c = at(x, y);
      if (c !== '#' && c !== '^' && c !== '!') continue;
      const top = !solid(x, y - 1) && c === '#', left = !solid(x - 1, y), right = !solid(x + 1, y), bottom = !solid(x, y + 1);
      if (top) {
        const gr = g.createLinearGradient(0, y, 0, y + 0.45);
        gr.addColorStop(0, W[6]); gr.addColorStop(0.25, W[5]); gr.addColorStop(0.6, W[3]); gr.addColorStop(1, rgba(W[2], 0));
        g.fillStyle = gr; g.fillRect(x - e, y, 1 + 2 * e, 0.45);
        g.fillStyle = rgba('#ffffff', 0.25); g.fillRect(x - e, y, 1 + 2 * e, 0.04);
        if (zone === 1 && hash(x, y, 7) < 0.5) {
          // frost and the odd icicle
          g.fillStyle = rgba(C.ice[4], 0.8); g.fillRect(x, y - 0.03, 1, 0.09);
        }
      }
      if (left) { const gr = g.createLinearGradient(x, 0, x + 0.18, 0); gr.addColorStop(0, rgba(W[4], 0.9)); gr.addColorStop(1, rgba(W[4], 0)); g.fillStyle = gr; g.fillRect(x, y, 0.18, 1); }
      if (right) { const gr = g.createLinearGradient(x + 1, 0, x + 0.8, 0); gr.addColorStop(0, rgba(W[0], 0.9)); gr.addColorStop(1, rgba(W[0], 0)); g.fillStyle = gr; g.fillRect(x + 0.8, y, 0.2, 1); }
      if (bottom) {
        const gr = g.createLinearGradient(0, y + 1, 0, y + 0.6); gr.addColorStop(0, W[0]); gr.addColorStop(1, rgba(W[0], 0)); g.fillStyle = gr; g.fillRect(x - e, y + 0.6, 1 + 2 * e, 0.4);
        if (zone === 1 && hash(x, y, 3) < 0.3) {
          const l = 0.3 + hash(x, y, 4) * 0.5, ix = x + 0.2 + hash(x, y, 5) * 0.6;
          const gr2 = g.createLinearGradient(0, y + 1, 0, y + 1 + l); gr2.addColorStop(0, C.ice[3]); gr2.addColorStop(1, rgba(C.ice[4], 0.2));
          g.fillStyle = gr2; g.beginPath(); g.moveTo(ix - 0.1, y + 1); g.lineTo(ix + 0.1, y + 1); g.lineTo(ix, y + 1 + l); g.fill();
        }
      }
      // zone wear on exposed faces
      if ((top || left || right) && c === '#') {
        const v = hash(x, y, 11);
        if (zone === 0 && v < 0.18) {
          // glowing heat cracks
          g.strokeStyle = rgba(P.glow[0], 0.75); g.lineWidth = 0.05; g.lineCap = 'round';
          g.beginPath(); g.moveTo(x + 0.3, y + 0.2); g.lineTo(x + 0.45, y + 0.5); g.lineTo(x + 0.35, y + 0.8); g.moveTo(x + 0.45, y + 0.5); g.lineTo(x + 0.7, y + 0.6); g.stroke();
        } else if (zone === 2 && v < 0.3) {
          g.strokeStyle = rgba(P.glow[0], 0.6); g.lineWidth = 0.05;
          g.beginPath(); g.moveTo(x + 0.15, y + 0.7); g.lineTo(x + 0.55, y + 0.7); g.lineTo(x + 0.55, y + 0.4); g.lineTo(x + 0.85, y + 0.4); g.stroke();
          g.fillStyle = P.glow[1]; g.beginPath(); g.arc(x + 0.85, y + 0.4, 0.06, 0, Math.PI * 2); g.fill();
        } else if (zone === 3 && v < 0.2) {
          g.strokeStyle = rgba(P.glow[0], 0.5); g.lineWidth = 0.06;
          g.beginPath(); g.moveTo(x, y + 0.5 + v); g.bezierCurveTo(x + 0.3, y + 0.2, x + 0.6, y + 0.9, x + 1, y + 0.5); g.stroke();
        }
      }
    }

  // everything that isn't plain wall
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const c = at(x, y);
      if (c === '^') spikes(g, x, y);
      else if (c === '~') liquid(g, x, y, P, at(x, y - 1) !== '~');
      else if (c === '!') rail(g, x, y);
      else if (c === 'B') grate(g, x, y, at);
      else if (c === 'I') ice(g, x, y, at);
      else if (c === '%') mesh(g, x, y);
      else if (c === 'H') ladder(g, x, y, W, at(x - 1, y) !== 'H', at(x + 1, y) !== 'H');
      else if (c === '=') girder(g, x, y, W, at(x - 1, y) !== '=', at(x + 1, y) !== '=');
      else if (isDoor(c) && (at(x, y - 1) === 'H' || at(x, y + 1) === 'H')) ladder(g, x, y, W, !rungs(at(x - 1, y)), !rungs(at(x + 1, y)));
    }
  return cv;
}

function spikes(g, x, y) {
  const gr = g.createLinearGradient(0, y - 0.7, 0, y + 0.4);
  gr.addColorStop(0, C.steel[5]); gr.addColorStop(0.5, C.steel[3]); gr.addColorStop(1, C.steel[1]);
  g.fillStyle = gr;
  g.beginPath();
  for (let k = 0; k < 3; k++) { const sx = x + k / 3; g.moveTo(sx, y + 0.35); g.lineTo(sx + 1 / 6, y - 0.65); g.lineTo(sx + 1 / 3, y + 0.35); }
  g.fill();
  g.fillStyle = C.steel[0]; g.fillRect(x, y + 0.3, 1, 0.3);
  g.fillStyle = C.red[2]; g.fillRect(x, y + 0.55, 1, 0.08);
}
function liquid(g, x, y, P, surface) {
  const gr = g.createLinearGradient(0, y, 0, y + 1);
  gr.addColorStop(0, surface ? P.liquid[3] : P.liquid[2]); gr.addColorStop(1, P.liquid[1]);
  g.fillStyle = gr; g.fillRect(x - 0.02, y, 1.04, 1.02);
}
function rail(g, x, y) {
  const gr = g.createLinearGradient(0, y, 0, y + 0.35);
  gr.addColorStop(0, C.steel[4]); gr.addColorStop(1, C.steel[1]);
  g.fillStyle = gr; g.fillRect(x - 0.02, y, 1.04, 0.35);
  g.fillStyle = C.black; g.fillRect(x - 0.02, y + 0.45, 1.04, 0.3);
  g.fillStyle = C.yellow[3];
  g.beginPath();
  for (let k = -1; k < 3; k++) { const sx = x + k * 0.5; g.moveTo(sx, y + 0.75); g.lineTo(sx + 0.25, y + 0.45); g.lineTo(sx + 0.5, y + 0.45); g.lineTo(sx + 0.25, y + 0.75); }
  g.save(); g.beginPath(); g.rect(x, y + 0.45, 1, 0.3); g.clip();
  g.fillStyle = C.yellow[3];
  for (let k = -1; k < 3; k++) { const sx = x + k * 0.5; g.beginPath(); g.moveTo(sx, y + 0.75); g.lineTo(sx + 0.25, y + 0.45); g.lineTo(sx + 0.5, y + 0.45); g.lineTo(sx + 0.25, y + 0.75); g.fill(); }
  g.restore();
}
function grate(g, x, y, at) {
  const G = C.grate;
  g.fillStyle = rgba(G[0], 0.85); g.fillRect(x, y, 1, 1);
  const gr = g.createLinearGradient(x, y, x + 1, y + 1);
  gr.addColorStop(0, G[4]); gr.addColorStop(1, G[2]);
  g.strokeStyle = gr; g.lineWidth = 0.14;
  g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + 1); g.moveTo(x, y + 0.5); g.lineTo(x + 1, y + 0.5); g.stroke();
  g.lineWidth = 0.1; g.strokeRect(x + 0.05, y + 0.05, 0.9, 0.9);
  // cracks that say a bite will break it
  const h = hash(x, y, 2);
  g.strokeStyle = G[0]; g.lineWidth = 0.05;
  g.beginPath(); g.moveTo(x + 0.2 + h * 0.5, y + 0.05); g.lineTo(x + 0.35 + h * 0.4, y + 0.4); g.lineTo(x + 0.2 + h * 0.5, y + 0.7); g.lineTo(x + 0.3 + h * 0.4, y + 0.95); g.stroke();
  g.fillStyle = rgba(C.amber[2], 0.35); g.beginPath(); g.arc(x + 0.7, y + 0.75 - h * 0.4, 0.18, 0, Math.PI * 2); g.fill();
  if (at(x, y - 1) !== 'B') { g.fillStyle = C.red[2]; g.fillRect(x, y, 1, 0.07); }
}
function ice(g, x, y, at) {
  const I = C.ice;
  const gr = g.createLinearGradient(x, y, x + 1, y + 1);
  gr.addColorStop(0, rgba(I[3], 0.95)); gr.addColorStop(0.5, rgba(I[2], 0.9)); gr.addColorStop(1, rgba(I[1], 0.95));
  g.fillStyle = gr; g.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
  // facets
  const h = hash(x, y, 9);
  g.strokeStyle = rgba(I[4], 0.55); g.lineWidth = 0.04;
  g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + 0.6, y + 0.3 + h * 0.3); g.lineTo(x + 1, y + 0.8 - h * 0.5); g.moveTo(x + 0.6, y + 0.3 + h * 0.3); g.lineTo(x + 0.4, y + 1); g.stroke();
  if (at(x, y - 1) !== 'I') { g.fillStyle = I[4]; g.fillRect(x, y, 1, 0.08); }
  if (at(x - 1, y) !== 'I') { g.fillStyle = rgba(I[4], 0.7); g.fillRect(x, y, 0.06, 1); }
  if (h < 0.25) { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + 0.3, y + 0.3, 0.05, 0, Math.PI * 2); g.fill(); }
}
function mesh(g, x, y) {
  const M = C.mesh;
  g.fillStyle = rgba(M[0], 0.7); g.fillRect(x, y, 1, 1);
  g.strokeStyle = M[3]; g.lineWidth = 0.05;
  g.beginPath();
  for (let k = 0; k <= 3; k++) { g.moveTo(x + k / 3, y); g.lineTo(x + k / 3, y + 1); g.moveTo(x, y + k / 3); g.lineTo(x + 1, y + k / 3); }
  g.stroke();
  g.fillStyle = C.green[2]; g.beginPath(); g.arc(x + 0.5, y + 0.5, 0.05, 0, Math.PI * 2); g.fill();
}
function ladder(g, x, y, W, leftEdge, rightEdge) {
  g.lineCap = 'butt';
  const rail = (rx) => {
    const gr = g.createLinearGradient(rx - 0.1, 0, rx + 0.1, 0);
    gr.addColorStop(0, W[6]); gr.addColorStop(1, W[3]);
    g.fillStyle = gr; g.fillRect(rx - 0.1, y - 0.01, 0.2, 1.02);
  };
  g.strokeStyle = W[4]; g.lineWidth = 0.1;
  g.beginPath();
  for (const ry of [0.25, 0.75]) { g.moveTo(x + (leftEdge ? 0.25 : 0), y + ry); g.lineTo(x + 1 - (rightEdge ? 0.25 : 0), y + ry); }
  g.stroke();
  if (leftEdge) rail(x + 0.25);
  if (rightEdge) rail(x + 0.75);
}
function girder(g, x, y, W, leftEnd, rightEnd) {
  const gr = g.createLinearGradient(0, y, 0, y + 0.6);
  gr.addColorStop(0, W[6]); gr.addColorStop(0.3, W[4]); gr.addColorStop(1, W[2]);
  g.fillStyle = gr; g.fillRect(x - 0.01, y, 1.02, 0.16);
  g.fillStyle = W[2]; g.fillRect(x - 0.01, y + 0.5, 1.02, 0.1);
  g.strokeStyle = W[3]; g.lineWidth = 0.07;
  g.beginPath(); g.moveTo(x, y + 0.16); g.lineTo(x + 0.5, y + 0.5); g.lineTo(x + 1, y + 0.16); g.stroke();
  if (leftEnd) { g.fillStyle = W[4]; g.fillRect(x, y, 0.08, 0.6); }
  if (rightEnd) { g.fillStyle = W[1]; g.fillRect(x + 0.92, y, 0.08, 0.6); }
}
// a shutter door: a slab len tiles tall that slides up into its frame (k 0 shut, 1 open)
export function drawDoor(g, x, y, k, len = 1) {
  const h = len * (1 - k);
  if (h <= 0.01) return;
  const gr = g.createLinearGradient(x, 0, x + 1, 0);
  gr.addColorStop(0, C.steel[3]); gr.addColorStop(0.5, C.steel[2]); gr.addColorStop(1, C.steel[0]);
  g.fillStyle = gr; g.fillRect(x, y, 1, h);
  g.save(); g.beginPath(); g.rect(x + 0.22, y, 0.56, h); g.clip();
  g.fillStyle = C.black; g.fillRect(x + 0.22, y, 0.56, h);
  g.fillStyle = C.yellow[3];
  const off = (len * k) % 0.5;
  for (let s = -1; s < len * 2 + 1; s++) { const sy = y + s * 0.5 - off; g.beginPath(); g.moveTo(x + 0.22, sy + 0.25); g.lineTo(x + 0.78, sy - 0.05); g.lineTo(x + 0.78, sy + 0.2); g.lineTo(x + 0.22, sy + 0.5); g.fill(); }
  g.restore();
  g.fillStyle = C.steel[5]; g.fillRect(x, y + h - 0.07, 1, 0.07);
  g.fillStyle = C.steel[4]; g.fillRect(x, y, 0.05, h);
}
