// On-screen touch controls: a floating stick on the left half (run, climb, let go), a dig-left
// and a dig-right button on the right, a pause button at the top. Outside play a tap is a
// "start" (or picks what was tapped, which the app asks the renderer about).
import { canvasPoint } from '@nostalgia/game/runtime';
import { pads } from './layout.js';

export function createTouch(cv, { listen }) {
  const T = {
    active: false, stick: null, digL: false, digR: false, taps: new Set(), tapAt: null, playing: false,
    update, apply, clear,
  };
  const pos = t => canvasPoint(cv, t);
  const near = (q, b, k = 1.3) => Math.hypot(q.x - b.x, q.y - b.y) < b.r * k;
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const P = pads(cv.width, cv.height);
    let stickSeen = false;
    T.digL = T.digR = false;
    for (const t of e.touches) {
      const q = pos(t);
      if (T.stick && T.stick.id === t.identifier) { stickSeen = true; T.stick.x = q.x; T.stick.y = q.y; continue; }
      if (!T.playing) continue;
      if (near(q, P.digL)) { T.digL = true; continue; }
      if (near(q, P.digR)) { T.digR = true; continue; }
      if (q.x < cv.width * 0.5 && !T.stick && e.type === 'touchstart') {
        T.stick = { id: t.identifier, x0: q.x, y0: q.y, x: q.x, y: q.y };
        stickSeen = true;
      }
    }
    if (!stickSeen) T.stick = null;
    if (e.type !== 'touchstart') return;
    for (const t of e.changedTouches) {
      const q = pos(t);
      if (T.playing) { if (near(q, P.pause, 1.4)) T.taps.add('pause'); }
      else { T.taps.add('start'); T.tapAt = q; }
    }
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });

  function update(app) { T.playing = app.state === 'play'; if (!T.playing) { T.stick = null; T.digL = T.digR = false; } }
  // fold the stick and buttons into the play input (the stick's main axis wins)
  function apply(out) {
    const s = T.stick, d = pads(cv.width, cv.height).stickR * 0.3;
    if (s) {
      const dx = s.x - s.x0, dy = s.y - s.y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > d) {
        if (Math.abs(dy) > Math.abs(dx)) out[dy < 0 ? 'up' : 'down'] = true;
        else out[dx < 0 ? 'left' : 'right'] = true;
      }
    }
    if (T.digL) out.digL = true;
    if (T.digR) out.digR = true;
  }
  function clear() { T.taps.clear(); T.tapAt = null; }
  return T;
}
