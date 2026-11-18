// On-screen touch controls: a floating stick on the left half (walk, and up / down for doors
// and lifts), a jump button and a bubble button on the right, a pause button at the top.
// Outside play a tap is a "start" (or picks what was tapped, which the app asks the renderer
// about); on the initials screen a vertical flick of the stick turns the letter. Positions are
// canvas pixels; `layout()` is shared with the renderer that draws them.
import { canvasPoint } from '@nostalgia/game/runtime';

export function layout(cw, ch) {
  const u = Math.min(ch / 1080, cw / 1200);
  return {
    u,
    jump: { x: cw - 170 * u, y: ch - 200 * u, r: 105 * u },
    fire: { x: cw - 400 * u, y: ch - 150 * u, r: 80 * u },
    pause: { x: cw / 2, y: 150 * u, r: 40 * u },
    stickR: 95 * u,
  };
}

export function createTouch(cv, { listen }) {
  const T = { active: false, stick: null, jump: false, fire: false, taps: new Set(), tapAt: null, playing: false, swipe: 0, update, apply, clear };
  let flicked = false;
  const near = (q, b, k = 1.25) => Math.hypot(q.x - b.x, q.y - b.y) < b.r * k;
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const L = layout(cv.width, cv.height);
    let stickSeen = false;
    T.jump = T.fire = false;
    for (const t of e.touches) {
      const q = canvasPoint(cv, t);
      if (T.stick && T.stick.id === t.identifier) { stickSeen = true; T.stick.x = q.x; T.stick.y = q.y; continue; }
      if (!T.playing || near(q, L.pause, 1.4)) continue;
      if (q.x > cv.width * 0.5) {
        // the nearer button; anywhere else on the right half jumps
        if (Math.hypot(q.x - L.fire.x, q.y - L.fire.y) / L.fire.r < Math.hypot(q.x - L.jump.x, q.y - L.jump.y) / L.jump.r) T.fire = true;
        else T.jump = true;
        continue;
      }
      if (!T.stick && e.type === 'touchstart') { T.stick = { id: t.identifier, x0: q.x, y0: q.y, x: q.x, y: q.y }; flicked = false; stickSeen = true; }
    }
    if (!stickSeen) T.stick = null;
    if (e.type !== 'touchstart') return;
    for (const t of e.changedTouches) {
      const q = canvasPoint(cv, t);
      if (T.playing) {
        if (near(q, L.pause, 1.4)) T.taps.add('pause');
        else if (T.entry && q.x > cv.width * 0.5) T.taps.add('start');
      } else { T.taps.add('start'); T.tapAt = q; }
    }
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });

  function update(app) {
    T.entry = app.state === 'entry';
    T.playing = app.state === 'play' || T.entry;
    if (!T.playing) { T.stick = null; T.jump = T.fire = false; }
    T.swipe = 0;
    if (T.entry && T.stick) {
      const dy = T.stick.y - T.stick.y0, d = layout(cv.width, cv.height).stickR * 0.4;
      if (!flicked && Math.abs(dy) > d) { T.swipe = dy < 0 ? 1 : -1; flicked = true; }
      if (Math.abs(dy) < d * 0.5) flicked = false;
    }
  }
  // fold the stick and buttons into the play input
  function apply(out) {
    if (!T.active || T.entry) return;
    const s = T.stick, d = layout(cv.width, cv.height).stickR * 0.3;
    if (s) {
      const dx = s.x - s.x0, dy = s.y - s.y0;
      if (dx < -d) out.left = true;
      if (dx > d) out.right = true;
      if (dy < -d * 1.4) out.up = true;
      if (dy > d * 1.4) out.down = true;
    }
    if (T.jump) out.jump = true;
    if (T.fire) out.fire = true;
  }
  function clear() { T.taps.clear(); T.tapAt = null; }
  return T;
}
