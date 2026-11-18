// Pointer input, mouse and touch alike: every press is a tap the app hit-tests against the
// renderer (a cell, a button, a menu row, a letter); a mouse moving over the canvas is a hover,
// which the board shows as its cursor. Positions are canvas pixels.
//
//   const touch = createTouch(cv, { listen });
//   touch.taps → [{ x, y, touch }];  touch.hover → { x, y } | null;  touch.clear();
import { canvasPoint } from '@nostalgia/game/runtime';

export function createTouch(cv, { listen }) {
  const T = { active: false, taps: [], hover: null, moved: false, clear };
  let last = null;
  listen(cv, 'pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const touch = e.pointerType !== 'mouse';
    if (touch) { T.active = true; T.hover = null; }
    T.taps.push({ ...canvasPoint(cv, e), touch });
  });
  listen(cv, 'pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const q = canvasPoint(cv, e);
    // a mouse that really moves takes the cursor over from the keys
    if (last && Math.hypot(q.x - last.x, q.y - last.y) > 3) T.moved = true;
    last = q;
    T.hover = q;
  });
  listen(cv, 'pointerleave', e => { if (e.pointerType === 'mouse') T.hover = null; });
  listen(cv, 'contextmenu', e => e.preventDefault());
  function clear() { T.taps.length = 0; T.moved = false; }
  return T;
}
