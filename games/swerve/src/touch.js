// On-screen touch controls for a match: a floating stick under the left thumb (it centres
// where the thumb lands, anywhere in the left part of the screen) and KICK under the right
// (held: a tap passes, a hold shoots, as on the keys; the stick steers the aftertouch), with II
// at the top for the pause. Outside a match a touch (or a mouse click) is a tap at a point:
// the app asks the screens (view.menuAt) what was there; every menu has its own on-screen
// entries, arrows and a BACK button.
//
//   const T = createTouch(cv, { listen });
//   T.update(app); T.read() → { on, x, y, kick }; T.taps (Set: 'start' | 'pause'); T.tapAt
//   T.draw(g)      the controls, in canvas pixels (it sets its own transform), while in a match
import { canvasPoint } from '@nostalgia/game/runtime';

const TAU = Math.PI * 2;
export function layout(cw, ch) {
  const u = Math.min(ch / 1080, cw / 1920);
  return {
    u,
    // where the stick rests when no thumb is on it, and how far the knob travels
    stick: { x: 250 * u, y: ch - 250 * u, r: 140 * u },
    kick: { x: cw - 250 * u, y: ch - 240 * u, r: 128 * u },
    pause: { x: cw / 2, y: 64 * u, r: 42 * u },
    // a thumb anywhere left of this (and below the top strip) takes the stick
    split: cw * 0.45, top: 130 * u,
  };
}

export function createTouch(cv, { listen }) {
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, on: false };
  const T = {
    active: false, playing: false, taps: new Set(), tapAt: null, stick, held: { kick: false },
    update, read, clear, draw, layout: () => layout(cv.width, cv.height),
  };
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const L = layout(cv.width, cv.height);
    if (!T.playing) {
      stick.id = null; stick.on = false; T.held.kick = false;
      if (e.type === 'touchstart') for (const t of e.changedTouches) { T.taps.add('start'); T.tapAt = canvasPoint(cv, t); }
      return;
    }
    // the stick follows its own finger; every other finger right of the split holds KICK
    let kick = false, stickSeen = false;
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
      if (q.x > L.split && Math.hypot(q.x - L.pause.x, q.y - L.pause.y) > L.pause.r * 1.5) kick = true;
    }
    if (!stickSeen) { stick.id = null; stick.on = false; stick.x = stick.y = 0; }
    if (e.type === 'touchstart') for (const t of e.changedTouches) {
      const q = canvasPoint(cv, t);
      if (Math.hypot(q.x - L.pause.x, q.y - L.pause.y) < L.pause.r * 1.5) { T.taps.add('pause'); continue; }
      if (stick.id == null && q.x < L.split && q.y > L.top) { stick.id = t.identifier; stick.on = true; stick.ox = q.x; stick.oy = q.y; stick.x = stick.y = 0; }
    }
    T.held.kick = kick;
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });
  // a mouse click on a menu is a tap too
  listen(cv, 'mousedown', e => {
    if (T.playing || e.button !== 0) return;
    T.taps.add('start'); T.tapAt = canvasPoint(cv, e);
  });

  function update(app) {
    T.playing = app.state === 'match';
    if (!T.playing) { stick.id = null; stick.on = false; stick.x = stick.y = 0; T.held.kick = false; }
  }
  /** the match input from the touch controls: { on (a thumb on the stick), x, y, kick } */
  function read() {
    if (!T.active) return null;
    return { on: stick.on, x: stick.x, y: stick.y, kick: T.held.kick };
  }
  function clear() { T.taps.clear(); T.tapAt = null; }

  // ---------- drawing (the renderer calls this last, over the match) ----------
  function draw(g) {
    if (!T.active || !T.playing) return;
    const L = layout(cv.width, cv.height), u = L.u;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    // the stick: a ring where it sits (or rests), the knob where the thumb is
    const cx = stick.on ? stick.ox : L.stick.x, cy = stick.on ? stick.oy : L.stick.y, r = L.stick.r;
    g.lineWidth = 4 * u;
    g.fillStyle = 'rgba(13,27,42,0.28)';
    g.strokeStyle = stick.on ? 'rgba(255,210,63,0.75)' : 'rgba(244,241,232,0.35)';
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = stick.on ? 'rgba(255,210,63,0.85)' : 'rgba(244,241,232,0.45)';
    g.beginPath(); g.arc(cx + stick.x * r, cy + stick.y * r, r * 0.42, 0, TAU); g.fill();
    // KICK
    const k = L.kick, on = T.held.kick;
    g.fillStyle = on ? 'rgba(255,210,63,0.9)' : 'rgba(13,27,42,0.45)';
    g.strokeStyle = on ? '#fff6cf' : 'rgba(255,210,63,0.7)';
    g.lineWidth = 5 * u;
    g.beginPath(); g.arc(k.x, k.y, k.r, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = on ? '#0d1b2a' : '#ffd23f';
    g.font = `800 ${Math.round(46 * u)}px 'Saira Condensed','Arial Narrow',sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('KICK', k.x, k.y + 2 * u);
    // II
    const p = L.pause;
    g.fillStyle = 'rgba(13,27,42,0.55)';
    g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(244,241,232,0.85)';
    g.fillRect(p.x - p.r * 0.32, p.y - p.r * 0.4, p.r * 0.22, p.r * 0.8);
    g.fillRect(p.x + p.r * 0.1, p.y - p.r * 0.4, p.r * 0.22, p.r * 0.8);
    g.restore();
  }
  return T;
}
