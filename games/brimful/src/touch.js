// Touch: every new touch is a tap (the app asks the renderer what is under it: a counter spot,
// a menu entry, a bonus pad, the pause button…), and a finger held on the renderer's pour
// button pours. Positions are canvas pixels.
import { canvasPoint } from '@nostalgia/game/runtime';

export function createTouch(cv, { listen }) {
  const T = { active: false, pour: false, taps: [], pourIds: new Set(), app: null, update, clear };
  const pos = t => canvasPoint(cv, t);
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    if (e.type === 'touchstart')
      for (const t of e.changedTouches) {
        const q = pos(t), h = T.app && T.view?.hit?.(q.x, q.y, T.app);
        if (h?.act === 'pour') T.pourIds.add(t.identifier);
        else T.taps.push(q);
      }
    else for (const t of e.changedTouches) if (e.type !== 'touchmove') T.pourIds.delete(t.identifier);
    T.pour = T.pourIds.size > 0;
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });
  function update(app) {
    T.app = app;
    if (app.state !== 'play') { T.pourIds.clear(); T.pour = false; }
  }
  function clear() { T.taps.length = 0; }
  return T;
}
