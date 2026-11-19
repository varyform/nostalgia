// On-screen touch controls for the flight: a floating stick on the left (drag down to pull up,
// sideways to roll), a throttle slider on the right edge (the top fifth is the afterburner),
// GUN, FIRE, WPN, TGT and DECOY buttons, and VIEW and pause at the top right. Outside the
// flight every new touch is a tap, and the renderer says what's under it (a menu entry…).
//
//   const touch = createTouch(cv, { listen, view });
//   touch.update(app); touch.apply(ctrl); touch.taps → [{ act, … }]; touch.clear();
import { canvasPoint } from '@nostalgia/game/runtime';

export const THROTTLE_MAX = 1.2;
// the pads, in canvas pixels for a canvas of w × h
export function pads(w, h) {
  const u = h / 1080;
  return {
    u,
    gun: { x: w - 330 * u, y: h - 190 * u, r: 96 * u, label: 'GUN' },
    fire: { x: w - 540 * u, y: h - 130 * u, r: 72 * u, label: 'FIRE' },
    weapon: { x: w - 560 * u, y: h - 330 * u, r: 52 * u, label: 'WPN' },
    target: { x: w - 400 * u, y: h - 410 * u, r: 52 * u, label: 'TGT' },
    decoy: { x: w - 236 * u, y: h - 430 * u, r: 52 * u, label: 'DECOY' },
    view: { x: w - 190 * u, y: 200 * u, r: 40 * u, label: 'VIEW' },
    pause: { x: w - 70 * u, y: 200 * u, r: 40 * u, label: 'II' },
    slider: { x: w - 78 * u, y0: h - 130 * u, y1: 300 * u, w: 70 * u },
    stickR: 150 * u,
  };
}
const BUTTONS = ['gun', 'fire', 'weapon', 'target', 'decoy'];

export function createTouch(cv, { listen, view }) {
  const T = { active: false, stick: null, slide: null, throttle: null, held: {}, taps: [], playing: false, update, apply, clear };
  const near = (q, b, k = 1.25) => Math.hypot(q.x - b.x, q.y - b.y) < b.r * k;
  const edges = new Set();
  let app = null;
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const P = pads(cv.width, cv.height), S = P.slider;
    let stickSeen = false, slideSeen = false;
    const held = {};
    for (const t of e.touches) {
      const q = canvasPoint(cv, t);
      if (T.stick && T.stick.id === t.identifier) { stickSeen = true; T.stick.x = q.x; T.stick.y = q.y; continue; }
      const onSlider = Math.abs(q.x - S.x) < S.w && q.y > S.y1 - 40 * P.u && q.y < S.y0 + 40 * P.u;
      if ((T.slide && T.slide === t.identifier) || (T.playing && onSlider && e.type === 'touchstart' && !T.slide)) {
        T.slide = t.identifier; slideSeen = true;
        T.throttle = Math.min(1, Math.max(0, (S.y0 - q.y) / (S.y0 - S.y1))) * THROTTLE_MAX;
        continue;
      }
      if (!T.playing) continue;
      const b = BUTTONS.find(k => near(q, P[k]));
      if (b) { held[b] = true; continue; }
      if (q.x < cv.width * 0.5 && !T.stick && e.type === 'touchstart') {
        T.stick = { id: t.identifier, x0: q.x, y0: q.y, x: q.x, y: q.y };
        stickSeen = true;
      }
    }
    if (!stickSeen) T.stick = null;
    if (!slideSeen) T.slide = null;
    for (const k of BUTTONS) if (held[k] && !T.held[k]) edges.add(k);
    T.held = held;
    if (e.type !== 'touchstart') return;
    for (const t of e.changedTouches) {
      const q = canvasPoint(cv, t);
      if (T.playing) {
        if (near(q, P.pause, 1.5)) T.taps.push({ act: 'pause' });
        else if (near(q, P.view, 1.5)) T.taps.push({ act: 'view' });
      } else T.taps.push(view.hit?.(q.x, q.y, app) ?? { act: 'tap' });
    }
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });

  function update(a) {
    app = a;
    T.playing = a.state === 'play';
    if (!T.playing) { T.stick = null; T.slide = null; T.held = {}; edges.clear(); }
  }
  /** fold the stick, the slider and the buttons into the flight controls */
  function apply(c) {
    if (!T.active) return;
    const s = T.stick, R = pads(cv.width, cv.height).stickR;
    if (s) {
      const dx = (s.x - s.x0) / R, dy = (s.y - s.y0) / R;
      // a little dead zone, then a gentle curve for fine aiming
      const curve = v => { const a = Math.max(0, Math.abs(v) - 0.06) / 0.94; return Math.sign(v) * Math.min(1, a * (0.45 + 0.55 * a)); };
      c.roll = curve(dx); c.pitch = curve(dy);
    }
    if (T.throttle != null) { c.throttle = T.throttle; c.thr = 0; }
    if (T.held.gun) c.gun = true;
    if (edges.has('fire')) c.fire = true;
    if (edges.has('weapon')) c.weapon = true;
    if (edges.has('target')) c.target = true;
    if (edges.has('decoy')) c.decoy = true;
    edges.clear();
  }
  function clear() { T.taps.length = 0; }
  return T;
}
