// On-screen touch controls: a floating stick on the left half (the four ways to dig), a fire
// button on the right (any touch there fires), a pause button at the top. Outside play a tap
// is a "start" (or picks what was tapped, which the app asks the renderer about); on the
// initials screen a vertical flick of the stick turns the letter. Positions are canvas pixels; `layout()` is shared with
// the renderers that draw them.
export function layout(cw, ch) {
  const u = Math.min(ch / 1080, cw / 1200);
  return {
    u,
    fire: { x: cw - 180 * u, y: ch - 190 * u, r: 110 * u },
    pause: { x: cw / 2, y: 44 * u, r: 36 * u }, // top centre: clear of both HUDs
    stickR: 95 * u,
  };
}

export function createTouch(cv, { listen }) {
  const T = {
    active: false, stick: null, fire: false, taps: new Set(), tapAt: null, playing: false, swipe: 0,
    update, apply, clear,
  };
  let flicked = false;
  const pos = t => {
    const r = cv.getBoundingClientRect();
    return { x: ((t.clientX - r.left) / r.width) * cv.width, y: ((t.clientY - r.top) / r.height) * cv.height };
  };
  function onTouch(e) {
    e.preventDefault();
    T.active = true;
    const L = layout(cv.width, cv.height);
    let stickSeen = false;
    T.fire = false;
    for (const t of e.touches) {
      const q = pos(t);
      if (T.stick && T.stick.id === t.identifier) { stickSeen = true; T.stick.x = q.x; T.stick.y = q.y; continue; }
      if (!T.playing || Math.hypot(q.x - L.pause.x, q.y - L.pause.y) < L.pause.r * 1.4) continue;
      if (q.x > cv.width * 0.5) { T.fire = true; continue; }
      if (q.x < cv.width * 0.5 && !T.stick && e.type === 'touchstart') {
        T.stick = { id: t.identifier, x0: q.x, y0: q.y, x: q.x, y: q.y };
        flicked = false;
        stickSeen = true;
      }
    }
    if (!stickSeen) T.stick = null;
    if (e.type !== 'touchstart') return;
    for (const t of e.changedTouches) {
      const q = pos(t);
      if (T.playing) {
        if (Math.hypot(q.x - L.pause.x, q.y - L.pause.y) < L.pause.r * 1.4) T.taps.add('pause');
        else if (T.entry && q.x > cv.width * 0.5) T.taps.add('start');
      } else { T.taps.add('start'); T.tapAt = q; }
    }
  }
  for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) listen(cv, n, onTouch, { passive: false });

  function update(app) {
    T.entry = app.state === 'entry';
    T.playing = app.state === 'play' || T.entry;
    if (!T.playing) { T.stick = null; T.fire = false; }
    // on the initials screen the stick flicks letters, once per push
    T.swipe = 0;
    if (T.entry && T.stick) {
      const dy = T.stick.y - T.stick.y0, d = layout(cv.width, cv.height).stickR * 0.4;
      if (!flicked && Math.abs(dy) > d) { T.swipe = dy < 0 ? 1 : -1; flicked = true; }
      if (Math.abs(dy) < d * 0.5) flicked = false;
    }
  }
  // fold the stick and button into the play input: the stronger axis wins
  function apply(out) {
    const s = T.stick, d = layout(cv.width, cv.height).stickR * 0.25;
    if (s && !T.entry) {
      const dx = s.x - s.x0, dy = s.y - s.y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > d) out.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
    }
    if (T.fire && !T.entry) out.fire = true;
  }
  function clear() { T.taps.clear(); T.tapAt = null; }
  return T;
}
