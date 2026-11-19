// On-screen touch controls: a floating stick on the left half (walk left / right, up for high
// strikes, down for low ones and to duck), four buttons on the right (PUNCH and KICK big and low
// under the thumb, STANCE and BOW above them) and a pause button at the top. Buttons are held,
// not tapped: the sim does its own edge detection. Outside play a tap is a "start" (or picks
// what was tapped, which the app asks the renderer about); on the initials screen a vertical
// flick of the stick turns the letter. Positions are canvas pixels; `layout()` is shared with
// the renderer that draws them.
import { canvasPoint } from '@nostalgia/game/runtime';

export const BUTTONS = [
  ['punch', 'PUNCH'],
  ['kick', 'KICK'],
  ['stance', 'STANCE'],
  ['bow', 'BOW'],
];

export function layout(cw, ch) {
  const u = Math.min(ch / 1080, cw / 1200);
  const L = {
    u,
    punch: { x: cw - 400 * u, y: ch - 165 * u, r: 92 * u, label: 'PUNCH' },
    kick: { x: cw - 175 * u, y: ch - 285 * u, r: 92 * u, label: 'KICK' },
    stance: { x: cw - 430 * u, y: ch - 405 * u, r: 66 * u, label: 'STANCE' },
    bow: { x: cw - 185 * u, y: ch - 520 * u, r: 56 * u, label: 'BOW' },
    pause: { x: cw / 2, y: 150 * u, r: 40 * u },
    stickR: 95 * u,
  };
  // the same four, in drawing order, for the renderer: [{ a, x, y, r, label }]
  L.buttons = BUTTONS.map(([a]) => ({ a, ...L[a] }));
  return L;
}

export function createTouch(cv, { listen }) {
  // held: which buttons a finger is on now (the renderer lights them)
  const held = { punch: false, kick: false, stance: false, bow: false };
  const T = { active: false, stick: null, held, taps: new Set(), tapAt: null, playing: false, entry: false, swipe: 0, update, apply, clear };
  let flicked = false;
  const near = (q, b, k = 1.25) => Math.hypot(q.x - b.x, q.y - b.y) < b.r * k;
  // the nearest button by its own size, within reach of its rim: a stray touch presses nothing
  function buttonAt(q, L) {
    let best = null, bd = 1.6;
    for (const b of L.buttons) {
      const d = Math.hypot(q.x - b.x, q.y - b.y) / b.r;
      if (d < bd) { bd = d; best = b.a; }
    }
    return best;
  }
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const L = layout(cv.width, cv.height);
    let stickSeen = false;
    for (const a in held) held[a] = false;
    for (const t of e.touches) {
      const q = canvasPoint(cv, t);
      if (T.stick && T.stick.id === t.identifier) { stickSeen = true; T.stick.x = q.x; T.stick.y = q.y; continue; }
      if (!T.playing || near(q, L.pause, 1.4)) continue;
      if (q.x > cv.width * 0.5) {
        const a = buttonAt(q, L);
        if (a) held[a] = true;
        continue;
      }
      if (!T.stick && e.type === 'touchstart') { T.stick = { id: t.identifier, x0: q.x, y0: q.y, x: q.x, y: q.y }; flicked = false; stickSeen = true; }
    }
    if (!stickSeen) T.stick = null;
    if (e.type !== 'touchstart') return;
    for (const t of e.changedTouches) {
      const q = canvasPoint(cv, t);
      if (T.playing) {
        if (near(q, L.pause, 1.4) && !T.entry) T.taps.add('pause');
        else if (T.entry && q.x > cv.width * 0.5) T.taps.add('start');
      } else { T.taps.add('start'); T.tapAt = q; }
    }
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });

  function update(app) {
    T.entry = app.state === 'entry';
    T.playing = app.state === 'play' || T.entry;
    if (!T.playing) { T.stick = null; for (const a in held) held[a] = false; }
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
    for (const a in held) if (held[a]) out[a] = true;
  }
  function clear() { T.taps.clear(); T.tapAt = null; }
  return T;
}
