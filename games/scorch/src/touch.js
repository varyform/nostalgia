// On-screen touch controls for the race: ◀ ▶ steering under the left thumb with BRAKE above
// them; GAS big under the right thumb with FIRE beside it (their rims overlap, so one thumb
// on the seam holds both), MINE and TURBO above; II at the top. Buttons are held, not tapped:
// the sim does its own edge detection for mines and turbo. Outside the race a tap is a "start"
// at a point, and the app asks the screens what was there (every menu has its own on-screen
// entries, tabs and a BACK button). Positions are canvas pixels; `layout()` is shared with the
// renderer, which draws the buttons (lit from `held`) while `active`.
import { canvasPoint } from '@nostalgia/game/runtime';

export const BUTTONS = [
  ['left', '◀'],
  ['right', '▶'],
  ['brake', 'BRAKE'],
  ['gas', 'GAS'],
  ['fire', 'FIRE'],
  ['mine', 'MINE'],
  ['turbo', 'TURBO'],
];

export function layout(cw, ch) {
  const u = Math.min(ch / 1080, cw / 1200);
  const L = {
    u,
    left: { x: 150 * u, y: ch - 175 * u, r: 92 * u, label: '◀' },
    right: { x: 370 * u, y: ch - 175 * u, r: 92 * u, label: '▶' },
    brake: { x: 260 * u, y: ch - 390 * u, r: 64 * u, label: 'BRAKE' },
    gas: { x: cw - 180 * u, y: ch - 200 * u, r: 112 * u, label: 'GAS' },
    fire: { x: cw - 375 * u, y: ch - 150 * u, r: 94 * u, label: 'FIRE' },
    mine: { x: cw - 410 * u, y: ch - 365 * u, r: 64 * u, label: 'MINE' },
    turbo: { x: cw - 200 * u, y: ch - 430 * u, r: 70 * u, label: 'TURBO' },
    pause: { x: cw / 2, y: 92 * u, r: 40 * u, label: 'II' },
  };
  // the seven, in drawing order, for the renderer: [{ a, x, y, r, label }]
  L.buttons = BUTTONS.map(([a]) => ({ a, ...L[a] }));
  return L;
}

export function createTouch(cv, { listen }) {
  // held: which buttons a finger is on now (the renderer lights them)
  const held = Object.fromEntries(BUTTONS.map(([a]) => [a, false]));
  const T = { active: false, held, taps: new Set(), tapAt: null, playing: false, update, apply, clear };
  const near = (q, b, k = 1.25) => Math.hypot(q.x - b.x, q.y - b.y) < b.r * k;
  // every button the finger is inside (GAS and FIRE share a seam), else the nearest one by its
  // own size within reach of its rim: a stray touch presses nothing
  function press(q, L) {
    let best = null, bd = 1.5, any = false;
    for (const b of L.buttons) {
      const d = Math.hypot(q.x - b.x, q.y - b.y) / b.r;
      if (d < 1) { held[b.a] = true; any = true; }
      if (d < bd) { bd = d; best = b.a; }
    }
    if (!any && best) held[best] = true;
  }
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const L = layout(cv.width, cv.height);
    for (const a in held) held[a] = false;
    if (T.playing) for (const t of e.touches) {
      const q = canvasPoint(cv, t);
      if (!near(q, L.pause, 1.4)) press(q, L);
    }
    if (e.type !== 'touchstart') return;
    for (const t of e.changedTouches) {
      const q = canvasPoint(cv, t);
      if (T.playing) { if (near(q, L.pause, 1.4)) T.taps.add('pause'); }
      else { T.taps.add('start'); T.tapAt = q; }
    }
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });

  function update(app) {
    T.playing = app.state === 'race';
    if (!T.playing) for (const a in held) held[a] = false;
  }
  // fold the held buttons into the race input
  function apply(out) {
    if (!T.active) return;
    if (held.left) out.left = true;
    if (held.right) out.right = true;
    if (held.gas) out.up = true;
    if (held.brake) out.down = true;
    if (held.fire) out.fire = true;
    if (held.mine) out.mine = true;
    if (held.turbo) out.turbo = true;
  }
  function clear() { T.taps.clear(); T.tapAt = null; }
  return T;
}
