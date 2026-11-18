// Where things sit on screen, in the 1920 × 1080 reference frame: shared by drawing and by the
// pointer hit tests, so a button is hit exactly where it is drawn.
export const REF_W = 1920, REF_H = 1080;
export const HUD = { x: 20, y: 14, w: 1880, h: 88 };
export const WEAPON_CHIP = { x: 1190, y: 22, w: 410, h: 72 };
export const BTN = {
  pause: { x: 20, y: 112, w: 58, h: 50 },
  gear: { x: 1662, y: 112, w: 112, h: 50 },
  fire: { x: 1786, y: 112, w: 114, h: 50 },
};
export const PAD = {
  angleL: { x: 104, y: 920, r: 64 }, angleR: { x: 312, y: 920, r: 64 },
  powerUp: { x: 208, y: 818, r: 64 }, powerDown: { x: 208, y: 1022, r: 64 },
  fire: { x: 1776, y: 924, r: 104 }, gear: { x: 1570, y: 1004, r: 60 },
};
export const DRIVE = { driveL: { x: 740, y: 990, r: 70 }, driveR: { x: 1180, y: 990, r: 70 }, driveDone: { x: 880, y: 950, w: 160, h: 80 } };
export function trayRect(i, n) {
  const w = 230, gap = 16, x0 = 960 - (n * w + (n - 1) * gap) / 2;
  return { x: x0 + i * (w + gap), y: 176, w, h: 100 };
}
export const TRAY_CLOSE = { x: 1700, y: 196, w: 60, h: 60 };
export const menuRect = i => ({ x: 960 - 240, y: 560 + i * 78, w: 480, h: 64 });
export const pauseRect = i => ({ x: 960 - 230, y: 520 + i * 82, w: 460, h: 66 });
export const finalRect = i => ({ x: 960 - 470 + i * 500, y: 930, w: 440, h: 70 });
export const BACK = { x: 1680, y: 64, w: 150, h: 56 };
export const PAGE = { x: 1510, y: 64, w: 150, h: 56 };
export function setupRect(app, i) {
  const rows = app.setupRows(), n = app.setup.players.length;
  if (i <= n) return { x: 110, y: 176 + i * 78, w: 830, h: 66 };
  if (rows[i] === 'start') return { x: 1000, y: 176 + 7 * 82 + 26, w: 810, h: 100 };
  return { x: 1000, y: 176 + (i - n - 1) * 82, w: 810, h: 68 };
}
export function goodRect(col, i) {
  return col === 0 ? { x: 110, y: 232 + i * 43, w: 840, h: 39 } : { x: 1000, y: 232 + i * 43, w: 810, h: 39 };
}
export const DETAIL = { x: 1000, y: 560, w: 810, h: 280 };
export const SHOP_BTN = {
  buy: { x: 1000, y: 870, w: 250, h: 80 },
  sell: { x: 1280, y: 870, w: 250, h: 80 },
  done: { x: 1560, y: 870, w: 250, h: 80 },
};
export const inside = (R, x, y) => x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
export const near = (C, x, y, k = 1) => Math.hypot(x - C.x, y - C.y) < C.r * k;
