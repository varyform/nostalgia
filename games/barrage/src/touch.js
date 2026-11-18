// Pointer input, mouse and touch alike. Every press is a tap the app hit-tests against the
// renderer (a button, a menu row, a shop entry); a press on open ground during your aim
// becomes an aiming drag, followed until it lifts. The wheel nudges the charge.
// Positions are canvas pixels.
import { canvasPoint } from '@nostalgia/game/runtime';

export function createTouch(cv, { listen }) {
  const T = {
    active: false, // a finger has been seen: on-screen controls show
    taps: [], ptrs: new Map(), wheel: 0, hover: null,
    update, clear,
  };
  const pos = e => canvasPoint(cv, e);
  listen(cv, 'pointerdown', e => {
    e.preventDefault();
    if (e.pointerType === 'touch') T.active = true;
    else if (e.pointerType === 'mouse' && e.button !== 0) return;
    const q = pos(e);
    T.taps.push({ ...q, id: e.pointerId });
    T.ptrs.set(e.pointerId, { ...q, id: e.pointerId, x0: q.x, y0: q.y });
    try { cv.setPointerCapture(e.pointerId); } catch { /* already gone */ }
  });
  listen(cv, 'pointermove', e => {
    const q = pos(e), p = T.ptrs.get(e.pointerId);
    if (e.pointerType === 'mouse') T.hover = q;
    if (p) { p.x = q.x; p.y = q.y; }
  });
  const up = e => { T.ptrs.delete(e.pointerId); };
  listen(cv, 'pointerup', up);
  listen(cv, 'pointercancel', up);
  listen(cv, 'lostpointercapture', up);
  listen(cv, 'wheel', e => { e.preventDefault(); T.wheel += Math.sign(e.deltaY); }, { passive: false });
  listen(cv, 'contextmenu', e => e.preventDefault());
  function update() {}
  function clear() { T.taps.length = 0; T.wheel = 0; }
  return T;
}
