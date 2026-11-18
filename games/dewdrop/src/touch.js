// On-screen touch controls: a floating stick on the left half (left / right, and up / down for
// vines and dropping), a jump button on the right, a pause button at the top. Outside play a
// tap is a "start" (or picks what was tapped, which the app asks the renderer about).
// Positions are canvas pixels; `layout()` is shared with the renderer that draws them.
import { canvasPoint } from '@nostalgia/game/runtime';

export function layout(cw, ch) {
  const u = ch / 1080;
  return {
    u,
    jump: { x: cw - 190 * u, y: ch - 190 * u, r: 115 * u },
    pause: { x: cw - 70 * u, y: 120 * u, r: 44 * u },
    stickR: 95 * u,
  };
}

export function createTouch(cv, { listen }) {
  const T = {
    active: false, stick: null, jump: false, taps: new Set(), tapAt: null, playing: false,
    update, apply, clear,
  };
  const pos = t => canvasPoint(cv, t);
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const L = layout(cv.width, cv.height);
    let stickSeen = false;
    T.jump = false;
    for (const t of e.touches) {
      const q = pos(t);
      if (T.stick && T.stick.id === t.identifier) { stickSeen = true; T.stick.x = q.x; T.stick.y = q.y; continue; }
      if (!T.playing) continue;
      if (q.x > cv.width * 0.5 && Math.hypot(q.x - L.pause.x, q.y - L.pause.y) > L.pause.r * 1.4) { T.jump = true; continue; }
      if (q.x < cv.width * 0.5 && !T.stick && e.type === 'touchstart') {
        T.stick = { id: t.identifier, x0: q.x, y0: q.y, x: q.x, y: q.y };
        stickSeen = true;
      }
    }
    if (!stickSeen) T.stick = null;
    if (e.type !== 'touchstart') return;
    for (const t of e.changedTouches) {
      const q = pos(t);
      if (T.playing) { if (Math.hypot(q.x - L.pause.x, q.y - L.pause.y) < L.pause.r * 1.4) T.taps.add('pause'); }
      else { T.taps.add('start'); T.tapAt = q; }
    }
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });

  function update(app) { T.playing = app.state === 'play'; if (!T.playing) { T.stick = null; T.jump = false; } }
  // fold the stick and button into the play input
  function apply(out) {
    const s = T.stick, d = layout(cv.width, cv.height).stickR * 0.3;
    if (s) {
      const dx = s.x - s.x0, dy = s.y - s.y0;
      if (dx < -d) out.left = true;
      if (dx > d) out.right = true;
      if (dy < -d * 1.4) out.up = true;
      if (dy > d * 1.4) out.down = true;
    }
    if (T.jump) out.jump = true;
  }
  function clear() { T.taps.clear(); T.tapAt = null; }
  return T;
}
