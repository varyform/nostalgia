// On-screen touch controls for the flight: a floating cyclic stick on the left half (push up to
// fly forward, sideways to turn), a collective slider on the right edge that springs back to the
// middle (up climbs, down sinks, the middle holds the height), GUN, FIRE, WPN, TGT, FLARE and
// HOVER buttons, and VIEW and pause at the top right. Outside the flight every new touch is a
// tap, and the renderer says what's under it (a menu entry…).
//
//   const touch = createTouch(cv, { listen, view });
//   touch.update(app); touch.apply(ctrl); touch.taps → [{ act, … }]; touch.clear();
//   touch.stick { x0, y0, x, y } | null, touch.coll −1..1 | null, touch.held { gun, fire, … }
//   pads(w, h)  the layout in canvas pixels, which the renderer draws
import { canvasPoint } from '@nostalgia/game/runtime';

// the pads, in canvas pixels for a canvas of w × h
export function pads(w, h) {
  const u = h / 1080;
  return {
    u,
    gun: { x: w - 360 * u, y: h - 190 * u, r: 96 * u, label: 'GUN' },
    fire: { x: w - 570 * u, y: h - 130 * u, r: 72 * u, label: 'FIRE' },
    weapon: { x: w - 570 * u, y: h - 320 * u, r: 52 * u, label: 'WPN' },
    target: { x: w - 430 * u, y: h - 410 * u, r: 52 * u, label: 'TGT' },
    decoy: { x: w - 266 * u, y: h - 430 * u, r: 52 * u, label: 'FLARE' },
    // below the radar-altitude tape and its FT label, right of the GUN count
    hover: { x: w - 680 * u, y: h - 380 * u, r: 46 * u, label: 'HOVER' },
    view: { x: w - 190 * u, y: 200 * u, r: 40 * u, label: 'VIEW' },
    pause: { x: w - 70 * u, y: 200 * u, r: 40 * u, label: 'II' },
    // the collective: a vertical slot; y0 bottom, y1 top, the middle holds
    slider: { x: w - 78 * u, y0: h - 130 * u, y1: 300 * u, w: 70 * u },
    stickR: 150 * u,
  };
}
const BUTTONS = ['gun', 'fire', 'weapon', 'target', 'decoy', 'hover'];

export function createTouch(cv, { listen, view }) {
  const T = { active: false, stick: null, slide: null, coll: null, held: {}, taps: [], playing: false, update, apply, clear };
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
        const mid = (S.y0 + S.y1) / 2, v = (mid - q.y) / ((S.y0 - S.y1) / 2);
        T.coll = Math.max(-1, Math.min(1, Math.abs(v) < 0.08 ? 0 : v));
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
    if (!slideSeen) { T.slide = null; T.coll = T.active && T.playing ? 0 : null; }
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
    if (!T.playing) { T.stick = null; T.slide = null; T.coll = null; T.held = {}; edges.clear(); }
  }
  /** fold the stick, the slider and the buttons into the flight controls */
  function apply(c) {
    if (!T.active) return;
    const s = T.stick, R = pads(cv.width, cv.height).stickR;
    if (s) {
      const dx = (s.x - s.x0) / R, dy = (s.y - s.y0) / R;
      // a little dead zone, then a gentle curve for fine control
      const curve = v => { const a = Math.max(0, Math.abs(v) - 0.06) / 0.94; return Math.sign(v) * Math.min(1, a * (0.45 + 0.55 * a)); };
      c.roll = curve(dx); c.pitch = curve(dy);
    }
    if (T.coll) c.coll = T.coll;
    if (T.held.gun) c.gun = true;
    for (const k of ['fire', 'weapon', 'target', 'decoy', 'hover']) if (edges.has(k)) c[k] = true;
    edges.clear();
  }
  function clear() { T.taps.length = 0; }
  return T;
}
