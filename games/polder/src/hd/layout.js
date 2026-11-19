// Where things sit, in the reference frame the renderer draws in: 1920 × 1080 on a landscape
// window, 1080 × 1920 on a portrait one (a phone held upright). Upright, the field is turned a
// quarter clockwise so it fills the screen: the sim's x runs down the screen, its y right to
// left. Shared by drawing and by the hit tests, so a button is hit exactly where it is drawn.
import { H, W } from '../sim.js';

export function layout(portrait) {
  if (!portrait) {
    const cell = 24, fx = 192, fy = 100;
    return {
      portrait, W: 1920, H: 1080, cell, fx, fy, fw: W * cell, fh: H * cell,
      pause: { x: 1758, y: 124, w: 132, h: 96 },
    };
  }
  const cell = 25, fx = 40, fy = 214;
  return {
    portrait, W: 1080, H: 1920, cell, fx, fy, fw: H * cell, fh: W * cell,
    pause: { x: 880, y: 1824, w: 160, h: 84 },
  };
}

// a point of the field (in cells, the sim's way up) in the reference frame
export function toScreen(L, x, y) {
  return L.portrait ? { x: L.fx + (H - y) * L.cell, y: L.fy + x * L.cell } : { x: L.fx + x * L.cell, y: L.fy + y * L.cell };
}
// the canvas transform that draws in field cells (u: device pixels per reference unit)
export function fieldMatrix(L, u, ox = 0, oy = 0) {
  const c = L.cell * u;
  return L.portrait ? [0, c, -c, 0, (L.fx + H * L.cell + ox) * u, (L.fy + oy) * u] : [c, 0, 0, c, (L.fx + ox) * u, (L.fy + oy) * u];
}
// a direction of the sim on the screen, as an angle
export function screenAngle(L, dx, dy) {
  return L.portrait ? Math.atan2(dx, -dy) : Math.atan2(dy, dx);
}

export const inside = (R, x, y) => x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;

// the screens' entries, centred on the frame
export function menuRects(L, n) {
  const w = L.portrait ? 700 : 560, h = L.portrait ? 128 : 72, gap = L.portrait ? 22 : 12;
  const y0 = L.portrait ? 960 : 520 - (n - 3) * 24;
  return Array.from({ length: n }, (_, i) => ({ x: L.W / 2 - w / 2, y: y0 + i * (h + gap), w, h }));
}
export function pauseRects(L) {
  const w = L.portrait ? 700 : 540, h = L.portrait ? 136 : 78, y0 = L.H / 2 - (L.portrait ? 40 : 10);
  return [0, 1].map(i => ({ x: L.W / 2 - w / 2, y: y0 + i * (h + 22), w, h }));
}
export function letterRect(L, i) {
  const w = L.portrait ? 180 : 124, h = L.portrait ? 240 : 172, gap = 40, y = L.portrait ? 820 : 430;
  const x0 = L.W / 2 - (3 * w + 2 * gap) / 2 - (L.portrait ? 0 : 110);
  return { x: x0 + i * (w + gap), y, w, h };
}
export function okRect(L) {
  if (L.portrait) return { x: L.W / 2 - 170, y: 1220, w: 340, h: 140 };
  const R = letterRect(L, 2);
  return { x: R.x + R.w + 60, y: R.y + 30, w: 180, h: 112 };
}
