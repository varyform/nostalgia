// Touch (and mouse) for Polder. In play, a finger down anywhere but the pause button is a
// floating stick: drag a little way and the skimmer steers that way, in one of four
// directions; the ring follows a finger that keeps going, so turning back is a short drag
// the other way; lift it and the skimmer stops once it's on land (out on the water it keeps
// going). Outside play every new touch or click is a tap, and the renderer says what is
// under it (a menu entry, a letter, OK…).
//
//   const touch = createTouch(cv, { listen, view });
//   touch.update(app);  touch.dir → 'left' | … | null;  touch.taps → [{ act, … }];  touch.clear();
import { canvasPoint } from '@nostalgia/game/runtime';

export function createTouch(cv, { listen, view }) {
  const T = { active: false, stick: null, dir: null, radius: 60, taps: [], playing: false, update, clear };
  let app = null;
  function steer() {
    const S = T.stick, R = T.radius;
    let dx = S.x - S.x0, dy = S.y - S.y0;
    const d = Math.hypot(dx, dy);
    if (d > R) { S.x0 = S.x - (dx / d) * R; S.y0 = S.y - (dy / d) * R; dx = S.x - S.x0; dy = S.y - S.y0; }
    if (d < R * 0.22) { if (d < R * 0.12) T.dir = null; return; }
    const ax = Math.abs(dx), ay = Math.abs(dy);
    // a little stickiness near the diagonals, so a wobbly thumb doesn't zig-zag
    const horiz = T.dir === 'left' || T.dir === 'right' ? ax * 1.25 > ay : T.dir ? ax > ay * 1.25 : ax > ay;
    T.dir = horiz ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
  }
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    T.radius = Math.min(cv.width, cv.height) * 0.075;
    let seen = false;
    for (const t of e.touches) {
      if (!T.stick || t.identifier !== T.stick.id) continue;
      seen = true;
      const q = canvasPoint(cv, t);
      T.stick.x = q.x; T.stick.y = q.y;
      steer();
    }
    if (!seen) { T.stick = null; T.dir = null; }
    if (e.type !== 'touchstart') return;
    for (const t of e.changedTouches) {
      const q = canvasPoint(cv, t), h = view.hit?.(q.x, q.y, app) ?? { act: 'tap' };
      if (!T.playing) T.taps.push(h);
      else if (h.act === 'pause') T.taps.push(h);
      else if (!T.stick) T.stick = { id: t.identifier, x0: q.x, y0: q.y, x: q.x, y: q.y };
    }
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });
  // a mouse clicks the menus
  listen(cv, 'mousedown', e => {
    if (e.button !== 0) return;
    const q = canvasPoint(cv, e), h = view.hit?.(q.x, q.y, app) ?? { act: 'tap' };
    if (!T.playing) T.taps.push(h);
  });
  listen(cv, 'contextmenu', e => e.preventDefault());

  function update(a) {
    app = a;
    T.playing = a.state === 'play';
    if (!T.playing) { T.stick = null; T.dir = null; }
  }
  function clear() { T.taps.length = 0; }
  return T;
}
