// On-screen touch controls: a floating stick on the left half (walk, take the stairs, bounce),
// a PUNCH button low on the right and a pause button at the top. Outside play every new touch
// is a tap, and the renderer says what is under it (a menu entry, a letter, OK…).
//
//   const touch = createTouch(cv, { listen, view });
//   touch.update(app); touch.apply(out); touch.taps → [{ act, … }]; touch.clear();
import { canvasPoint } from '@nostalgia/game/runtime';

// the pads, in canvas pixels for a canvas of w × h
export function pads(w, h) {
  const u = h / 1080;
  return { punch: { x: w - 200 * u, y: h - 190 * u, r: 110 * u }, pause: { x: w - 64 * u, y: 150 * u, r: 40 * u }, stickR: 120 * u };
}

export function createTouch(cv, { listen, view }) {
  const T = { active: false, stick: null, punch: false, taps: [], playing: false, update, apply, clear };
  const near = (q, b, k = 1.3) => Math.hypot(q.x - b.x, q.y - b.y) < b.r * k;
  let app = null;
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const P = pads(cv.width, cv.height);
    let stickSeen = false;
    T.punch = false;
    for (const t of e.touches) {
      const q = canvasPoint(cv, t);
      if (T.stick && T.stick.id === t.identifier) { stickSeen = true; T.stick.x = q.x; T.stick.y = q.y; continue; }
      if (!T.playing) continue;
      if (near(q, P.punch)) { T.punch = true; continue; }
      if (q.x < cv.width * 0.55 && !T.stick && e.type === 'touchstart') {
        T.stick = { id: t.identifier, x0: q.x, y0: q.y, x: q.x, y: q.y };
        stickSeen = true;
      }
    }
    if (!stickSeen) T.stick = null;
    if (e.type !== 'touchstart') return;
    for (const t of e.changedTouches) {
      const q = canvasPoint(cv, t);
      if (T.playing) { if (near(q, P.pause, 1.5)) T.taps.push({ act: 'pause' }); }
      else T.taps.push(view.hit?.(q.x, q.y, app) ?? { act: 'tap' });
    }
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });

  function update(a) {
    app = a;
    T.playing = a.state === 'play';
    if (!T.playing) { T.stick = null; T.punch = false; }
  }
  // fold the stick and the button into the play input (up and down need a firm push)
  function apply(out) {
    if (!T.active) return;
    const s = T.stick, d = pads(cv.width, cv.height).stickR * 0.28;
    if (s) {
      const dx = s.x - s.x0, dy = s.y - s.y0;
      if (Math.abs(dx) > d) out[dx < 0 ? 'left' : 'right'] = true;
      if (Math.abs(dy) > d * 1.4 && Math.abs(dy) > Math.abs(dx) * 0.6) out[dy < 0 ? 'up' : 'down'] = true;
    }
    if (T.punch) out.punch = true;
  }
  function clear() { T.taps.length = 0; }
  return T;
}
