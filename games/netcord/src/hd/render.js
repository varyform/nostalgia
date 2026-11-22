// The HD renderer. The match is WebGL2 (@nostalgia/gl) on the #gl canvas: the venue (court.js),
// the crowd as instances that bob when it applauds, the two players rebuilt every frame from the
// rig (bodies.js), the ball (felt, a seam, spinning, drawn a little larger far from the camera,
// with a shadow straight under it and a short trail), marks and puffs (fx.js), and every shadow
// on the court. The cameras are camera.js's. The TV graphics are 2D on the transparent canvas
// over it (hud.js); every screen that isn't the match — and the panels over a paused match, a
// changeover or the result — is screens.js's, in 1920 × 1080. It only reads `app` and `match.s`.
//
//   const view = createRenderer({ gl: glCanvas, hud: hudCanvas }, app);
//   view.events(match.events, match);  view.draw(app);  view.menuAt(x, y);  view.destroy();
import { fitWide } from '@nostalgia/game/runtime';
import { box, builder, createGL, frustum, modelOf } from '@nostalgia/gl';
import { createBodies } from './bodies.js';
import { createCamera } from './camera.js';
import { C, buildVenue, crowdMeshes, rgbOf } from './court.js';
import { createFx } from './fx.js';
import { COL, FONT, H, W, createHud } from './hud.js';
import { drawScreen, screenAt } from './screens.js';

const MATCH_STATES = new Set(['match', 'demo', 'practice', 'pause', 'changeover', 'result']);
const FROZEN = new Set(['pause', 'changeover', 'result']);
const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
// shadows land on y = 0: the engine lifts them 6 cm off their plane (and blobs 8 cm)
const SHADOW_PLANE = [0, 1, 0, 0.055];
const HIDE_1 = [false, true];
const SHIRTS = ['#f4f1e8', '#e4463a', '#3b6fd0', '#f2c230', '#2e8b57', '#1d1f26', '#9a5bd0', '#ff8a5c', '#7fd3ff', '#e8e2d0', '#c8102e', '#5a6470'];
const SKINS = ['#f0c6a2', '#dfa983', '#c88c63', '#a86c46', '#80502f', '#5e3a22'];

/** the ball: an icosphere in felt yellow with a pale seam */
function ballMesh(B) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const unit = v => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  V = V.map(unit);
  for (let k = 0; k < 2; k++) {
    const nf = [], cache = new Map();
    const midOf = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!cache.has(key)) {
        V.push(unit([(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2]));
        cache.set(key, V.length - 1);
      }
      return cache.get(key);
    };
    for (const [a, b, c] of F) {
      const ab = midOf(a, b), bc = midOf(b, c), ca = midOf(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    F = nf;
  }
  // the seam: the tennis ball's curve, sampled
  const seam = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2, A = 0.68, Bb = 0.32;
    seam.push(unit([A * Math.cos(a) + Bb * Math.cos(3 * a), A * Math.sin(a) - Bb * Math.sin(3 * a), 2 * Math.sqrt(A * Bb) * Math.sin(2 * a)]));
  }
  const felt = rgbOf('#d6ea3c'), line = rgbOf('#f2f6d8');
  const first = B.n;
  for (const [a, b, c] of F) {
    const m = unit([(V[a][0] + V[b][0] + V[c][0]) / 3, (V[a][1] + V[b][1] + V[c][1]) / 3, (V[a][2] + V[b][2] + V[c][2]) / 3]);
    let d = 9;
    for (const q of seam) d = Math.min(d, Math.hypot(m[0] - q[0], m[1] - q[1], m[2] - q[2]));
    B.tri(V[a], V[b], V[c], d < 0.11 ? line : felt, 255, [0, 0, 0]);
  }
  return [first, B.n - first];
}

/** the practice ball machine (its chute toward −z, the way it faces): a purple body on legs, a hopper of balls */
function machineMesh(B) {
  const first = B.n;
  for (const x of [-0.24, 0.24]) for (const z of [-0.3, 0.3]) box(B, { at: [x, 0.2, z] }, [0.05, 0.4, 0.05], '#2a1650');
  box(B, { at: [0, 0.6, 0] }, [0.62, 0.42, 0.78], '#5a33a0');
  box(B, { at: [0, 0.62, -0.42] }, [0.2, 0.2, 0.12], '#1b1b1b');
  frustum(B, { at: [0, 0.81, 0.05] }, [0.4, 0.34, 0.5], [0.66, 0.74], '#7a55c0');
  for (let k = 0; k < 7; k++) box(B, { at: [-0.2 + (k % 4) * 0.13, 1.17, -0.16 + Math.floor(k / 4) * 0.22 + (k % 2) * 0.04] }, [0.07, 0.07, 0.07], '#d6ea3c');
  return [first, B.n - first];
}

export function createRenderer({ gl: glc, hud: cv }, app0) {
  const demo = !!app0?.demo;
  const g = cv.getContext('2d');
  let R = null, err = '';
  try {
    R = createGL(glc, { antialias: !demo, stencil: true });
  } catch (e) {
    err = String(e?.message ?? e);
    R = null;
  }

  // ---------- size: both canvases the largest 16:9 box; the demo at 1×, smaller ----------
  let cw = 1, ch = 1;
  const unfit = fitWide(cv, { maxDpr: demo ? 1 : 2, maxWidth: demo ? 1280 : 2560, onFit: (w, h) => ((cw = w), (ch = h)) });
  const unfitGL = fitWide(glc, { maxDpr: demo ? 1 : 2, maxWidth: demo ? 960 : 2560 });

  // ---------- what lives as long as the renderer ----------
  let objBuf = null, ballRange = null, crowdBody = null, crowdHead = null, machineRange = null;
  if (R) {
    const B = builder(4096);
    ballRange = ballMesh(B);
    machineRange = machineMesh(B);
    const cm = crowdMeshes(B);
    crowdBody = cm.body;
    crowdHead = cm.head;
    objBuf = R.buffer(B.data());
  }
  const bodies = R ? createBodies(R) : null;
  const fx = R ? createFx(R, { demo }) : null;
  const camera = createCamera();
  const hud = createHud();

  // ---------- the venue, rebuilt when it changes ----------
  let venue = { key: null };
  function venueFor(v) {
    const key = JSON.stringify([v?.name, v?.short, v?.surface, v?.roof, v?.night, v?.colours]);
    if (venue.key === key) return venue;
    venue.buf?.destroy();
    venue.crowdB?.destroy();
    venue.crowdH?.destroy();
    const V = buildVenue(v ?? {});
    const n = V.seats.length;
    let seed = 77;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const base = new Float32Array(n * 9), heads = new Float32Array(n * 9), phase = new Float32Array(n), y0 = new Float32Array(n);
    V.seats.forEach((p, k) => {
      const o = k * 9, sc = 0.94 + rnd() * 0.12, shirt = rgbOf(SHIRTS[Math.floor(rnd() * SHIRTS.length)]), skin = rgbOf(SKINS[Math.floor(rnd() * SKINS.length)]);
      const dim = V.look.night || V.look.roof ? 0.92 : 1;
      base.set([p.x, p.y, p.z, p.yaw + (rnd() - 0.5) * 0.3, sc, sc, (shirt[0] / 255) * dim, (shirt[1] / 255) * dim, (shirt[2] / 255) * dim], o);
      heads.set([p.x, p.y, p.z, base[o + 3], sc, sc, skin[0] / 255, skin[1] / 255, skin[2] / 255], o);
      phase[k] = rnd() * Math.PI * 2;
      y0[k] = p.y;
    });
    venue = {
      key,
      ...V,
      buf: R.buffer(V.data),
      crowdB: R.instances(base),
      crowdH: R.instances(heads),
      base,
      heads,
      phase,
      y0,
      n,
    };
    fx.venue(V.look, V.colourAt);
    fx.reset();
    return venue;
  }

  // ---------- the crowd's mood: still in the point, up on its feet after it ----------
  let cheer = 0, crowdClock = 0, crowdAt = -1;
  function crowdEvents(list, s) {
    crowdClock += 1 / 60;
    cheer = Math.max(0, cheer - (1 / 60) * 0.45);
    for (const e of list ?? []) {
      if (e.type === 'point') cheer = Math.max(cheer, 0.55 + Math.min(0.45, (s?.stats?.[0]?.rally ?? 0) * 0.04));
      else if (e.type === 'game') cheer = Math.max(cheer, 0.7);
      else if (e.type === 'set' || e.type === 'match') cheer = 1;
    }
  }
  function crowdMove() {
    const v = venue;
    if (!v.n) return;
    // cheering, 20 times a second (5 in the demo); in the hush of a point, a shuffle now and then
    const calm = cheer < 0.01, every = calm ? (demo ? 0.6 : 0.25) : demo ? 0.2 : 1 / 20;
    if (crowdClock - crowdAt < every && crowdAt >= 0) return;
    crowdAt = crowdClock;
    const B = v.base, Hh = v.heads, t = crowdClock;
    for (let k = 0; k < v.n; k++) {
      const ph = v.phase[k], idle = Math.max(0, Math.sin(t * 0.7 + ph * 3)) ** 8 * 0.04;
      const jump = cheer > 0.01 ? Math.max(0, Math.sin(t * (7 + (ph % 1.3)) + ph)) * cheer * (0.08 + (ph % 1) * 0.16) : 0;
      const y = v.y0[k] + idle + jump;
      B[k * 9 + 1] = y;
      Hh[k * 9 + 1] = y;
    }
    v.crowdB.update(B);
    v.crowdH.update(Hh);
  }

  // ---------- the ball: its turning, and how large it's drawn ----------
  const bf = [0, 0, -1], bu = [0, 1, 0], ballM = new Float32Array(16);
  function spinBall(b, dt) {
    const w = b?.spin;
    if (!w) return;
    const wl = Math.hypot(w[0], w[1], w[2]), a = Math.min(wl * dt, 0.9);
    if (!(a > 1e-4)) return;
    const k = [w[0] / wl, w[1] / wl, w[2] / wl], c = Math.cos(a), s = Math.sin(a);
    const rot = v => {
      const d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
      const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
      for (let i = 0; i < 3; i++) v[i] = v[i] * c + x[i] * s + k[i] * d * (1 - c);
    };
    rot(bf);
    rot(bu);
    // keep them square
    const d = bf[0] * bu[0] + bf[1] * bu[1] + bf[2] * bu[2];
    for (let i = 0; i < 3; i++) bu[i] -= bf[i] * d;
    const lf = Math.hypot(...bf), lu = Math.hypot(...bu);
    for (let i = 0; i < 3; i++) {
      bf[i] /= lf;
      bu[i] /= lu;
    }
  }

  // ---------- the match being shown ----------
  let M = null;
  function setMatch(match) {
    M = match;
    fx?.reset();
    hud.reset();
    camera.reset();
    cheer = 0;
  }

  /** world point → 1920 × 1080, or null behind the eye */
  function project(p) {
    const m = R?.state.vp;
    if (!m) return null;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w < 0.05) return null;
    return { x: ((x / w) * 0.5 + 0.5) * W, y: (0.5 - (y / w) * 0.5) * H, w };
  }
  const view = { project, headOf: i => bodies?.headOf(i) ?? null };

  // ---------- the scene ----------
  let ballScale = 1, ballAt = [0, 0, 0];
  const machineM = new Float32Array(16);
  function scene(app, match, dt) {
    const s = match.s, v = venueFor(app.venue), S = v.sky;
    const cam = camera.update(app, s, dt, v.umpire);
    R.frame(cam, S);
    R.drawStatic(v.buf, ...v.ranges.ground);
    fx.drawMarks();
    R.drawStatic(v.buf, ...v.ranges.solid);
    R.drawStatic(v.buf, ...v.ranges.outside);
    if (camera.view !== 'high') R.drawStatic(v.buf, ...v.ranges.roof);
    R.drawStatic(v.buf, ...v.ranges.net);
    R.drawStatic(v.buf, ...v.ranges.props);
    crowdMove();
    R.drawInstanced(objBuf, crowdBody, v.crowdB, 0, v.n, { far: 160 });
    R.drawInstanced(objBuf, crowdHead, v.crowdH, 0, v.n, { far: 160 });
    // the players; in practice with the machine, player 1 is the machine
    const machine = s.practice === 'machine' && s.players?.[1];
    bodies.update(match, app, machine ? HIDE_1 : null);
    bodies.draw();
    if (machine) {
      const m = s.players[1], y = m.yaw ?? Math.PI;
      modelOf([m.x, 0, m.z], [-Math.sin(y), 0, -Math.cos(y)], [0, 1, 0], 1, machineM);
      R.drawMesh(objBuf, machineRange, machineM);
    }
    // the ball, larger with distance so it stays a few pixels across
    const b = s.ball;
    const showBall = b && Number.isFinite(b.x) && b.y > -0.5 && s.phase !== 'change' && s.phase !== 'over';
    if (showBall) {
      const e = cam.eye, d = Math.hypot(b.x - e[0], b.y - e[1], b.z - e[2]);
      const px = (C.ballR * 2 * R.state.focal) / Math.max(d, 0.1);
      ballScale = Math.max(1, Math.min(2.4, ((5.5 * glc.height) / 1080) / Math.max(px, 0.5)));
      if (!FROZEN.has(app.state)) spinBall(b, dt);
      // a ball in the server's hand sits where his posed hand holds it
      const sv = s.server ?? 0, held = b.inHand && bodies.ranges[sv] ? bodies.outs[sv]?.ball : null;
      ballAt = held && Number.isFinite(held[0]) && held[1] > 0.2 ? held : [b.x, b.y, b.z];
      R.drawMesh(objBuf, ballRange, modelOf(ballAt, bf, bu, C.ballR * ballScale, ballM));
    }
    // shadows: the net's and the props', each player's, the ball's straight below it
    const sa = S.shadow ?? 0.4;
    R.drawShadow(v.buf, v.ranges.net, I4, SHADOW_PLANE, sa * 0.55);
    R.drawShadow(v.buf, v.ranges.props, I4, SHADOW_PLANE, sa * 0.8);
    bodies.shadows(sa, null);
    if (machine) R.drawShadow(objBuf, machineRange, machineM, SHADOW_PLANE, sa);
    if (showBall && ballAt[1] < 12) {
      const h = Math.max(0, ballAt[1]);
      R.drawBlob([ballAt[0], -0.075, ballAt[2]], C.ballR * ballScale * (1.2 + h * 0.08), [0, 1, 0], 0.6 * Math.max(0.25, 1 - h / 9));
    }
    // see-through: the net's panel, the strings
    R.drawMesh(v.buf, v.ranges.glass, I4, null, false, 0.42);
    bodies.glass();
    fx.drawPoints(showBall ? b : null, ballScale);
  }

  // ---------- events: every sim step ----------
  function events(list, match) {
    if (!match) return;
    if (match !== M) setMatch(match);
    fx?.events(list, match);
    hud.events(list, match);
    crowdEvents(list, match.s);
    if (fx && bodies) for (const e of list ?? []) if (e.type === 'hit') {
      const rk = bodies.outs[e.player]?.racket;
      if (rk?.head) fx.hit(rk.head, e.power ?? 0.5);
    }
  }

  // ---------- frame ----------
  let lastApp = app0, last = performance.now(), cleared = false, destroyed = false;
  function draw(app) {
    lastApp = app;
    if (destroyed) return;
    const now = performance.now(), dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const st = app.state, match = app.match, inMatch = !!match && MATCH_STATES.has(st);
    if (inMatch && match !== M) setMatch(match);
    if (R && !R.lost()) {
      if (inMatch) {
        scene(app, match, dt);
        cleared = false;
      } else if (!cleared) {
        // the screens cover the page: leave the GL canvas a plain ground under them
        const gl = R.gl;
        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0.043, 0.165, 0.11, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        cleared = true;
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, cw, ch);
    g.setTransform(cw / W, 0, 0, ch / H, 0, 0);
    if (!R) {
      g.fillStyle = COL.green;
      g.fillRect(0, 0, W, H);
      const t = (s, y, size, col, wgt) => {
        g.font = `${wgt} ${size}px ${FONT}`;
        g.fillStyle = col;
        g.textAlign = 'center';
        g.fillText(s, W / 2, y);
      };
      t('NETCORD NEEDS WEBGL 2', H / 2 - 20, 54, COL.yellow, 800);
      t('This browser or device has no WebGL 2 graphics. Try a current Chrome, Edge, Firefox or Safari.', H / 2 + 40, 26, COL.dim, 500);
      if (err) t(err.slice(0, 120), H / 2 + 90, 18, COL.faint, 500);
      g.textAlign = 'left';
    }
    if (inMatch) {
      if (R) hud.draw(g, app, match, view);
      if (FROZEN.has(st)) {
        g.setTransform(cw / W, 0, 0, ch / H, 0, 0);
        drawScreen(g, app, app.t ?? 0);
      }
    } else drawScreen(g, app, app.t ?? 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    if (app.fade > 0) {
      g.fillStyle = `rgba(6,26,18,${Math.min(1, app.fade)})`;
      g.fillRect(0, 0, cw, ch);
    }
    if (st === 'match' || st === 'practice') app.touch?.draw?.(g);
  }

  /** what a tap at (x, y) in canvas pixels lands on: the screens' business, in 1920 × 1080 */
  const menuAt = (x, y) => screenAt(lastApp, (x * W) / cw, (y * H) / ch);

  function destroy() {
    destroyed = true;
    unfit();
    unfitGL();
    // free what this renderer made, but keep the context: the launcher turns the demo into the
    // game on the same canvas, and the next createGL() must get a working context back
    venue.buf?.destroy();
    venue.crowdB?.destroy();
    venue.crowdH?.destroy();
    bodies?.destroy();
    fx?.destroy();
    objBuf?.destroy();
    R?.destroy();
  }
  return {
    draw,
    events,
    menuAt,
    destroy,
    /** for test harnesses: the camera, projection and counts */
    get stats() {
      return { view: camera.view, eye: [...camera.cam.eye], fov: camera.cam.fov, crowd: venue.n ?? 0, marks: fx?.marks ?? 0, particles: fx?.particles ?? 0, ballScale, project, poses: bodies?.outs, sun: venue.sky?.sunN };
    },
  };
}
