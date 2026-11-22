// On-screen touch controls for a match: a floating stick under the left thumb (it centres where
// the thumb lands, anywhere in the left part of the screen: run, and aim as you swing), HIT and
// SLICE under the right (held, as the keys are: the sim times the press and the hold), and two
// small buttons at the top: II (pause) and CAM (the camera). Outside a match a touch (or a mouse
// click) is a tap at a point: the app asks the screens (view.menuAt) what was there; every menu
// has its own on-screen entries, arrows and a BACK button.
//
//   const T = createTouch(cv, { listen });
//   T.update(app); T.read() → { on, x, y, a, b } | null; T.taps (Set: 'start' | 'pause' | 'camera'); T.tapAt
//   T.draw(g)      the controls, in canvas pixels (it sets its own transform), while in a match
import { canvasPoint } from '@nostalgia/game/runtime';

const TAU = Math.PI * 2;
const FONT = "'Barlow Semi Condensed','Arial Narrow',sans-serif";
const PLAYING = new Set(['match', 'practice']);

export function layout(cw, ch) {
  const u = Math.min(ch / 1080, cw / 1920);
  return {
    u,
    // where the stick rests when no thumb is on it, and how far the knob travels
    stick: { x: 250 * u, y: ch - 250 * u, r: 140 * u },
    hit: { x: cw - 230 * u, y: ch - 220 * u, r: 120 * u },
    slice: { x: cw - 470 * u, y: ch - 150 * u, r: 92 * u },
    pause: { x: cw / 2, y: 64 * u, r: 42 * u },
    camera: { x: cw - 90 * u, y: 64 * u, r: 42 * u },
    // a thumb anywhere left of this (and below the top strip) takes the stick
    split: cw * 0.45, top: 130 * u,
  };
}

export function createTouch(cv, { listen }) {
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, on: false };
  const T = {
    active: false, playing: false, taps: new Set(), tapAt: null, stick, held: { a: false, b: false },
    update, read, clear, draw, layout: () => layout(cv.width, cv.height),
  };
  const near = (q, c, k = 1.3) => Math.hypot(q.x - c.x, q.y - c.y) < c.r * k;
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const L = layout(cv.width, cv.height);
    if (!T.playing) {
      stick.id = null; stick.on = false; T.held.a = T.held.b = false;
      if (e.type === 'touchstart') for (const t of e.changedTouches) { T.taps.add('start'); T.tapAt = canvasPoint(cv, t); }
      return;
    }
    // the stick follows its own finger; a finger on HIT or SLICE holds it (the nearer one
    // wins a finger between them)
    let a = false, b = false, stickSeen = false;
    for (const t of e.touches) {
      const q = canvasPoint(cv, t);
      if (t.identifier === stick.id) {
        stickSeen = true;
        const dx = q.x - stick.ox, dy = q.y - stick.oy, d = Math.hypot(dx, dy), k = d > L.stick.r ? L.stick.r / d : 1;
        stick.x = (dx * k) / L.stick.r; stick.y = (dy * k) / L.stick.r;
        // a thumb that strays far drags the stick's centre along
        if (d > L.stick.r * 1.6) { stick.ox = q.x - dx * k; stick.oy = q.y - dy * k; }
        continue;
      }
      if (q.x <= L.split || near(q, L.pause, 1.5) || near(q, L.camera, 1.5)) continue;
      const dh = Math.hypot(q.x - L.hit.x, q.y - L.hit.y) / L.hit.r, ds = Math.hypot(q.x - L.slice.x, q.y - L.slice.y) / L.slice.r;
      if (ds < dh && ds < 1.6) b = true;
      else a = true; // anywhere else on the right: HIT
    }
    if (!stickSeen) { stick.id = null; stick.on = false; stick.x = stick.y = 0; }
    if (e.type === 'touchstart') for (const t of e.changedTouches) {
      const q = canvasPoint(cv, t);
      if (near(q, L.pause, 1.5)) { T.taps.add('pause'); continue; }
      if (near(q, L.camera, 1.5)) { T.taps.add('camera'); continue; }
      if (stick.id == null && q.x < L.split && q.y > L.top) { stick.id = t.identifier; stick.on = true; stick.ox = q.x; stick.oy = q.y; stick.x = stick.y = 0; }
    }
    T.held.a = a; T.held.b = b;
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });
  // a mouse click on a menu is a tap too
  listen(cv, 'mousedown', e => {
    if (T.playing || e.button !== 0) return;
    T.taps.add('start'); T.tapAt = canvasPoint(cv, e);
  });

  function update(app) {
    T.playing = PLAYING.has(app.state);
    if (!T.playing) { stick.id = null; stick.on = false; stick.x = stick.y = 0; T.held.a = T.held.b = false; }
  }
  /** the match input from the touch controls: { on (a thumb on the stick), x, y, a, b } */
  function read() {
    if (!T.active) return null;
    return { on: stick.on, x: stick.x, y: stick.y, a: T.held.a, b: T.held.b };
  }
  function clear() { T.taps.clear(); T.tapAt = null; }

  // ---------- drawing (the renderer calls this last, over the match) ----------
  function button(g, c, label, on, u, { size = 44, ring = '#e4f33a' } = {}) {
    g.fillStyle = on ? 'rgba(228,243,58,0.9)' : 'rgba(9,42,30,0.45)';
    g.strokeStyle = on ? '#fbffd6' : ring;
    g.lineWidth = 5 * u;
    g.beginPath(); g.arc(c.x, c.y, c.r, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = on ? '#0b2a1c' : '#f6f7f2';
    g.font = `800 ${Math.round(size * u)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, c.x, c.y + 2 * u);
  }
  function draw(g) {
    if (!T.active || !T.playing) return;
    const L = layout(cv.width, cv.height), u = L.u;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // the stick: a ring where it sits (or rests), the knob where the thumb is
    const cx = stick.on ? stick.ox : L.stick.x, cy = stick.on ? stick.oy : L.stick.y, r = L.stick.r;
    g.lineWidth = 4 * u;
    g.fillStyle = 'rgba(9,42,30,0.28)';
    g.strokeStyle = stick.on ? 'rgba(228,243,58,0.75)' : 'rgba(246,247,242,0.35)';
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = stick.on ? 'rgba(228,243,58,0.85)' : 'rgba(246,247,242,0.45)';
    g.beginPath(); g.arc(cx + stick.x * r, cy + stick.y * r, r * 0.42, 0, TAU); g.fill();
    button(g, L.hit, 'HIT', T.held.a, u, { size: 48 });
    button(g, L.slice, 'SLICE', T.held.b, u, { size: 34, ring: '#b79cff' });
    // II and CAM
    const p = L.pause;
    g.fillStyle = 'rgba(9,42,30,0.55)';
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(246,247,242,0.85)';
    g.fillRect(p.x - p.r * 0.32, p.y - p.r * 0.4, p.r * 0.22, p.r * 0.8);
    g.fillRect(p.x + p.r * 0.1, p.y - p.r * 0.4, p.r * 0.22, p.r * 0.8);
    const c = L.camera;
    g.fillStyle = 'rgba(9,42,30,0.55)';
    g.beginPath(); g.arc(c.x, c.y, c.r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(246,247,242,0.85)';
    g.font = `800 ${Math.round(24 * u)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('CAM', c.x, c.y + 1 * u);
    g.restore();
  }
  return T;
}
