// Where things sit, in the reference frame the renderer draws in: 1920 × 1080 on a landscape
// window, 1080 × 1920 on a portrait one (a phone held upright). Shared by drawing and by the
// pointer hit tests, so a cell or a button is hit exactly where it is drawn.
import { N } from '../sim.js';

export function layout(portrait) {
  if (!portrait) {
    const cell = 104, size = cell * N, bx = (1920 - size) / 2, by = (1080 - size) / 2;
    return {
      portrait, W: 1920, H: 1080, cell, bx, by, size,
      score: { x: 110, y: 300 }, best: { x: 110, y: 410 }, turn: { x: 110, y: 480 }, pad: 36,
      logo: { x: 250, y: 150, size: 92 },
      tokens: { x: 110, y: 610 },
      undo: { x: 90, y: 650, w: 320, h: 100 },
      pause: { x: 90, y: 780, w: 320, h: 84 },
      next: { x: 1520, y: 200, w: 320, h: 176, gap: 100, r: 40 },
      room: { x: 1520, y: 440, w: 320 },
      legend: { x: 1640, y: 660 },
    };
  }
  const cell = 114, size = cell * N, bx = (1080 - size) / 2, by = 420;
  return {
    portrait, W: 1080, H: 1920, cell, bx, by, size, pad: 22,
    score: { x: 60, y: 170 }, best: { x: 1020, y: 170, right: true }, turn: { x: 540, y: 96, center: true },
    logo: null,
    tokens: { x: 285, y: 1612, center: true },
    undo: { x: 60, y: 1650, w: 450, h: 150 },
    pause: { x: 570, y: 1650, w: 450, h: 150 },
    next: { x: 300, y: 200, w: 480, h: 160, gap: 116, r: 42 },
    room: { x: 60, y: 1530, w: 960 },
    legend: null,
  };
}

export const inside = (R, x, y) => x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
// the board cell under a point, or −1
export function cellAt(L, x, y) {
  const cx = Math.floor((x - L.bx) / L.cell), cy = Math.floor((y - L.by) / L.cell);
  return cx >= 0 && cx < N && cy >= 0 && cy < N ? cy * N + cx : -1;
}
// a cell's centre
export const cellX = (L, i) => L.bx + ((i % N) + 0.5) * L.cell;
export const cellY = (L, i) => L.by + (Math.floor(i / N) + 0.5) * L.cell;

// the screens' entries, centred on the frame
export function menuRects(L, n) {
  const w = L.portrait ? 680 : 540, h = L.portrait ? 132 : 70, gap = L.portrait ? 24 : 12;
  const y0 = L.portrait ? 900 : 470 - (n - 3) * 22;
  return Array.from({ length: n }, (_, i) => ({ x: L.W / 2 - w / 2, y: y0 + i * (h + gap), w, h }));
}
export function pauseRects(L) {
  const w = L.portrait ? 680 : 520, h = L.portrait ? 140 : 76, y0 = L.H / 2 - (L.portrait ? 40 : 10);
  return [0, 1].map(i => ({ x: L.W / 2 - w / 2, y: y0 + i * (h + 22), w, h }));
}
export function letterRect(L, i) {
  const w = L.portrait ? 170 : 120, h = L.portrait ? 230 : 170, gap = L.portrait ? 40 : 40, y = L.portrait ? 800 : 420;
  const x0 = L.W / 2 - (3 * w + 2 * gap) / 2 - (L.portrait ? 0 : 110);
  return { x: x0 + i * (w + gap), y, w, h };
}
export function okRect(L) {
  if (L.portrait) return { x: L.W / 2 - 160, y: 1180, w: 320, h: 140 };
  const R = letterRect(L, 2);
  return { x: R.x + R.w + 60, y: R.y + 30, w: 170, h: 110 };
}
