// The HD renderer. The world is WebGL2 (@nostalgia/gl) on the page's #gl canvas: the theatre's terrain
// and props (terrain.js), every aircraft, ground unit and store from shared meshes (meshes.js),
// and the fire, smoke, tracers, flares and vapour as soft points. The HUD, the cockpit's
// displays and every screen are 2D vectors on the transparent #c canvas over it (hud.js,
// screens.js). It only reads state; events() moves the camera and the particles each step.
//
//   const view = createRenderer(canvas, app);
//   view.events(sim.events, sim);  view.draw(app);  view.hit(x, y, app) → touch target
import { fitWide } from '@nostalgia/game/runtime';
import { createWorld } from '../world.js';
import { KINDS, add, cross, dist, dot, len, mul, norm, sub } from '../sim.js';
import { createGL, modelOf } from '@nostalgia/gl';
import { COL, H, W, createUI } from '@nostalgia/gl/ui';
import { drawHud } from './hud.js';
import { buildMeshes } from './meshes.js';
import { drawScreen, screenHit } from './screens.js';
import { buildTerrain } from './terrain.js';

const UP = [0, 1, 0];
const MAX_P = 3000;
const CHAR = [0.3, 0.27, 0.25];

export function createRenderer(cv, app0) {
  const demo = !!app0.demo;
  const g = cv.getContext('2d');
  const ui = createUI(g);
  let glc = document.getElementById('gl');
  if (!glc) { glc = document.createElement('canvas'); glc.id = 'gl'; cv.parentNode.insertBefore(glc, cv); }
  let R = null, err = '';
  try { R = createGL(glc, { antialias: !demo }); } catch (e) { err = String(e?.message ?? e); R = null; }
  let meshBuf = null, ranges = null;
  if (R) { const M = buildMeshes(); meshBuf = R.buffer(M.data); ranges = M.ranges; }

  // ---------- the theatre's static geometry, built when the theatre changes ----------
  let scene = { index: -1 };
  function theatre(index) {
    if (scene.index === index || !R) return scene;
    scene.terrain?.destroy(); scene.decal?.destroy();
    const W0 = createWorld(index), T = buildTerrain(W0);
    const S = W0.T.sky;
    scene = {
      index, world: W0, chunks: T.chunks, terrain: R.buffer(T.data), decal: R.buffer(T.decals.data), decals: T.decals.count,
      sky: { ...S, sunN: norm(S.sun) },
    };
    return scene;
  }

  // ---------- size ----------
  let cw = 1, ch = 1, dirty = true;
  const unfit = fitWide(cv, { maxDpr: demo ? 1 : 2, onFit: (w, h) => { cw = w; ch = h; ui.scale(h / H); dirty = true; } });
  const unfitGL = fitWide(glc, { maxDpr: demo ? 1 : 2, maxWidth: demo ? 960 : 2560, onFit: () => { dirty = true; } });

  // ---------- camera ----------
  const cam = { eye: [0, 1000, 0], f: [0, 0, -1], u: [0, 1, 0], fov: 0.95, near: 1.5, far: 26000 };
  let chase = null, lastView = '', orbit = 0;
  function playCamera(app, sim) {
    const P = sim.player;
    if (!P) return;
    const v = app.view;
    if (sim.status === 'down' || (!P.alive)) {
      // circle the wreck
      orbit += 0.004;
      const c = P.pos, r = 140;
      cam.eye = [c[0] + Math.cos(orbit) * r, Math.max(c[1] + 45, sim.world.heightAt(c[0] + Math.cos(orbit) * r, c[2] + Math.sin(orbit) * r) + 30), c[2] + Math.sin(orbit) * r];
      cam.f = norm(sub(c, cam.eye)); cam.u = upright(cam.f); cam.fov = 0.95; cam.near = 2;
      return;
    }
    if (v === 'cockpit') {
      cam.eye = add(add(P.pos, mul(P.u, 1.05)), mul(P.f, 4.5));
      cam.f = P.f; cam.u = P.u; cam.fov = 0.92; cam.near = 1.2;
      chase = null;
    } else if (v === 'target' && P.target) {
      const d = norm(sub(P.target.pos, P.pos));
      const eye = add(add(P.pos, mul(d, -46)), mul(UP, 11));
      cam.eye = eye; cam.f = norm(sub(add(P.target.pos, mul(P.f, 0)), eye)); cam.u = upright(cam.f); cam.fov = 0.85; cam.near = 2;
      chase = null;
    } else {
      // a sprung chase camera that leans with the jet
      const want = add(add(P.pos, mul(P.f, -34)), add(mul(P.u, 7), mul(UP, 3)));
      if (!chase || lastView !== v) chase = { eye: want, up: P.u };
      chase.eye = add(chase.eye, mul(sub(want, chase.eye), 0.16));
      chase.up = norm(add(chase.up, mul(sub(norm(add(P.u, mul(UP, 0.6))), chase.up), 0.1)));
      const gy = sim.world.heightAt(chase.eye[0], chase.eye[2]) + 4;
      if (chase.eye[1] < gy) chase.eye[1] = gy;
      cam.eye = chase.eye;
      cam.f = norm(sub(add(P.pos, mul(P.f, 22)), cam.eye));
      const r = norm(cross(cam.f, chase.up));
      cam.u = cross(r, cam.f); cam.fov = 0.95; cam.near = 2;
    }
    lastView = v;
  }
  function upright(f) { const r = cross(f, UP), L = len(r); return L < 1e-4 ? [0, 0, -1] : cross(mul(r, 1 / L), f); }
  // the screens' backdrop: a jet circling over the theatre's home field
  const show = { a: 0, pos: [0, 0, 0], f: [0, 0, -1], u: UP };
  function showCamera(app) {
    const s = theatre(app.backdrop ?? 0);
    if (!s.world) return;
    const home = s.world.site('home');
    show.a += 0.0032;
    const c = [home.x + 900, home.y + 700, home.z - 1400], r = 900, a = show.a;
    show.pos = [c[0] + Math.cos(a) * r, c[1] + Math.sin(a * 2) * 40, c[2] + Math.sin(a) * r];
    show.f = norm([-Math.sin(a), Math.cos(a * 2) * 0.05, Math.cos(a)]);
    const inward = norm([c[0] - show.pos[0], 0, c[2] - show.pos[2]]);
    show.u = norm(add(UP, mul(inward, 0.7)));
    show.u = norm(sub(show.u, mul(show.f, dot(show.u, show.f))));
    const b = a - 0.16;
    cam.eye = [c[0] + Math.cos(b) * (r + 70), c[1] + 18, c[2] + Math.sin(b) * (r + 70)];
    cam.f = norm(sub(add(show.pos, mul(show.f, 30)), cam.eye)); cam.u = upright(cam.f); cam.fov = 0.8; cam.near = 2;
  }

  // ---------- particles ----------
  const parts = [];
  const pdata = new Float32Array(MAX_P * 8 + 4000 * 8);
  function puff(p, o) {
    if (parts.length >= MAX_P) parts.shift();
    parts.push({ p: [...p], v: o.v ? [...o.v] : [0, 0, 0], t: 0, life: o.life ?? 2, s0: o.s0 ?? 5, s1: o.s1 ?? o.s0 ?? 5, c: o.c ?? [1, 1, 1], a: o.a ?? 0.6, add: !!o.add, drag: o.drag ?? 1, rise: o.rise ?? 0, c1: o.c1 ?? null });
  }
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const jit = k => [(rnd() - 0.5) * k, (rnd() - 0.5) * k, (rnd() - 0.5) * k];
  const FIRE = [1, 0.62, 0.25], SMOKE = [0.2, 0.19, 0.18], WHITE = [0.95, 0.96, 0.97];
  function explode(e, near) {
    const p = [e.x, e.y, e.z], big = e.big, k = big ? 1 : 0.55;
    puff(p, { s0: 30 * k, s1: 90 * k, life: 0.7, c: [1, 0.85, 0.5], add: true, a: 1 });
    for (let i = 0; i < (big ? 10 : 5); i++) puff(add(p, jit(24 * k)), { v: jit(40 * k), s0: 20 * k, s1: 55 * k, life: 0.6 + rnd() * 0.6, c: FIRE, add: true, drag: 2.5 });
    for (let i = 0; i < (big ? 10 : 5); i++) puff(add(p, jit(20 * k)), { v: add(jit(16 * k), [0, 6, 0]), s0: 26 * k, s1: 90 * k, life: 3 + rnd() * 3, c: SMOKE, a: 0.55, drag: 1.4, rise: 4 });
    if (near) for (let i = 0; i < 8; i++) puff(p, { v: add(jit(140 * k), [0, 40, 0]), s0: 3, s1: 1, life: 1.2, c: [1, 0.8, 0.4], add: true, drag: 0.3, rise: -9 });
  }
  // the last places each trail was laid, so the smoke comes out as an even ribbon
  const trails = new WeakMap();
  function trail(obj, p, every, make) {
    const last = trails.get(obj);
    if (!last) { trails.set(obj, [...p]); return; }
    const d = dist(last, p);
    if (d < every) return;
    const n = Math.min(12, Math.floor(d / every));
    for (let i = 1; i <= n; i++) make(add(last, mul(sub(p, last), i / n)));
    trails.set(obj, [...p]);
  }
  const msgs = [];
  let flash = 0, flashCol = '#fff', shake = 0, stepN = 0;
  function events(list, sim) {
    stepN++;
    const app = lastApp;
    if (!app) return;
    const playing = app.state === 'play' || app.state === 'pause';
    if (!playing) { if (app.state !== 'pause') showCamera(app); }
    else { theatre(sim.theatre); if (app.state === 'play') playCamera(app, sim); }
    for (const m of msgs) m.t += 1 / 60;
    while (msgs.length && msgs[0].t > 6) msgs.shift();
    if (!playing || app.state === 'pause') return;
    const P = sim.player, near = e => !P || dist([e.x, e.y, e.z], P.pos) < 3000;
    for (const e of list) {
      switch (e.type) {
        case 'msg': msgs.push({ text: e.text, t: 0 }); if (msgs.length > 3) msgs.shift(); break;
        case 'boom': explode(e, near(e)); if (e.kind === 'player') { flash = 0.8; flashCol = '#ffb070'; } break;
        case 'flak':
          puff([e.x, e.y, e.z], { s0: 8, s1: 26, life: 0.25, c: [1, 0.7, 0.3], add: true });
          for (let i = 0; i < 3; i++) puff(add([e.x, e.y, e.z], jit(10)), { v: jit(6), s0: 14, s1: 36, life: 2.6, c: [0.12, 0.11, 0.1], a: 0.7, drag: 1 });
          break;
        case 'spark': puff([e.x, e.y, e.z], { s0: 6, s1: 2, life: 0.15, c: [1, 0.9, 0.6], add: true }); break;
        case 'dust': puff([e.x, e.y + 1, e.z], { v: [0, 4, 0], s0: 5, s1: 14, life: 1.2, c: [0.55, 0.45, 0.35], a: 0.5 }); break;
        case 'spout': puff([e.x, e.y + 1, e.z], { v: [0, 9, 0], s0: 4, s1: 10, life: 0.9, c: WHITE, a: 0.6, rise: -6 }); break;
        case 'splash':
          for (let i = 0; i < (e.big ? 12 : 6); i++) puff([e.x, e.y + 2, e.z], { v: add(jit(e.big ? 30 : 16), [0, (e.big ? 40 : 22) * (0.6 + rnd()), 0]), s0: e.big ? 16 : 9, s1: e.big ? 40 : 22, life: 1.8, c: WHITE, a: 0.75, rise: -14, drag: 0.6 });
          break;
        case 'pop': puff([e.x, e.y, e.z], { s0: 12, s1: 30, life: 1.6, c: [0.5, 0.5, 0.5], a: 0.5 }); break;
        case 'damage': flash = Math.max(flash, 0.25 + e.amount * 0.5); flashCol = '#ff3020'; shake = Math.max(shake, 0.4 + e.amount); break;
        case 'start': parts.length = 0; msgs.length = 0; chase = null; break;
      }
    }
    flash = Math.max(0, flash - 1 / 60 * 1.6); shake = Math.max(0, shake - 1 / 60 * 2);
    // trails: missiles, decoys, burning aircraft, the jet's vapour
    for (const m of sim.missiles) trail(m, m.pos, 7, p => puff(p, { s0: 3, s1: 14, life: m.team === 'blue' ? 2.6 : 3.4, c: [0.86, 0.86, 0.85], a: 0.5, drag: 0.3 }));
    for (const d of sim.decoys) if (d.kind === 'flare') trail(d, d.pos, 5, p => puff(p, { s0: 3, s1: 10, life: 1.6, c: WHITE, a: 0.35 }));
    for (const a of sim.actors) {
      if (a.dying) trail(a, a.pos, 9, p => { puff(p, { s0: 6, s1: 26, life: 3, c: SMOKE, a: 0.6, rise: 2 }); if (rnd() < 0.5) puff(p, { s0: 5, s1: 2, life: 0.3, c: FIRE, add: true }); });
      else if (!a.alive && !a.air && a.deadT < 80 && P && stepN % 5 === 0 && Math.abs(a.pos[0] - P.pos[0]) < 9000 && Math.abs(a.pos[2] - P.pos[2]) < 9000) {
        const big = KINDS[a.kind].r > 18, base = add(a.pos, [0, a.kind === 'bridge' ? -50 : 3, 0]);
        puff(add(base, jit(big ? 20 : 8)), { v: [2, 7, 1], s0: big ? 22 : 12, s1: big ? 80 : 46, life: 7, c: SMOKE, a: 0.5, rise: 2 });
        if (a.deadT < 25) puff(add(base, jit(big ? 14 : 5)), { s0: big ? 16 : 8, s1: 4, life: 0.6, c: FIRE, add: true });
      }
    }
    if (P?.alive && sim.status === 'fly' && !P.ground) {
      const r = cross(P.f, P.u), turn = Math.abs(dot(P.u, r)) + Math.abs(P.u[1] - 1);
      const g = P.prevF ? len(sub(P.f, P.prevF)) * 60 : 0;
      P.prevF = P.f;
      if (P.speed > 140 && g > 0.18) {
        for (const s of [-1, 1]) puff(add(add(P.pos, mul(r, 5.1 * s)), mul(P.f, 4)), { s0: 0.8, s1: 2.4, life: 0.7 + g, c: WHITE, a: 0.3, drag: 0.2 });
      }
      if (P.pos[1] > 3400) trail(P, P.pos, 10, p => puff(add(p, mul(P.f, 10)), { s0: 3, s1: 16, life: 8, c: WHITE, a: 0.45, drag: 0.05 }));
      void turn;
    }
    for (const q of parts) {
      q.t += 1 / 60;
      const k = Math.exp(-q.drag / 60);
      q.v[0] *= k; q.v[1] = q.v[1] * k + q.rise / 60; q.v[2] *= k;
      q.p[0] += q.v[0] / 60; q.p[1] += q.v[1] / 60; q.p[2] += q.v[2] / 60;
    }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].t >= parts[i].life) parts.splice(i, 1);
  }

  // ---------- drawing the world ----------
  const M = new Float32Array(16);
  function drawActor(name, pos, f, u, s = 1, tint = null) {
    const rg = ranges[name];
    if (!rg) return;
    R.drawMesh(meshBuf, rg, modelOf(pos, f, u, s, M), tint);
  }
  function visScale(D, max = 3) { return Math.min(max, 1 + Math.max(0, D - 1200) / 2600); }
  function world(app, sim) {
    const s = scene, S = s.sky;
    R.frame(cam, S);
    const gl = R.gl, eye = cam.eye, far2 = cam.far * cam.far;
    for (const c of s.chunks) {
      const dx = c.c[0] - eye[0], dz = c.c[2] - eye[2];
      if (!c.always && dx * dx + dz * dz > far2 + c.r * c.r * 2) continue;
      if (!c.always && !R.visible(c.c, c.r)) continue;
      R.drawStatic(s.terrain, c.first, c.count);
    }
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -6);
    R.drawStatic(s.decal, 0, s.decals);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    const pts = [];
    const glow = (p, size, c, k = 1) => pts.push(p[0], p[1], p[2], size, c[0] * k, c[1] * k, c[2] * k, 0);
    if (sim) {
      const P = sim.player, t = sim.t;
      for (const a of sim.actors) {
        if (!a.alive && !a.dying && a.air) continue;
        const D = dist(a.pos, eye);
        if (D > cam.far) continue;
        if (a === P && app.view === 'cockpit' && P.alive && app.state !== 'title') continue;
        const K = KINDS[a.kind];
        if (!R.visible(a.pos, (K.hl ?? 0) + K.r * 3)) continue;
        if (a.air) {
          const vs = a === P ? 1 : visScale(D);
          drawActor(a.kind, a.pos, a.f, a.u, vs, a.alive ? null : CHAR);
          if (a.alive && (a.kind === 'fighter' || a.kind === 'ace' || a === P)) {
            const tail = add(a.pos, mul(a.f, -8.2 * vs));
            if (a === P) { if (P.burner) { glow(tail, 4.2, [1, 0.6, 0.3], 1); glow(add(tail, mul(a.f, -4)), 3, [1, 0.45, 0.25], 0.8); } else glow(tail, 1.8, [1, 0.5, 0.25], 0.5 + P.throttle * 0.4); }
            else glow(tail, 2.2 * vs, [1, 0.55, 0.3], 0.7);
          }
          continue;
        }
        const vs = visScale(D, 2), fh = norm([a.f[0], 0, a.f[2]]);
        if (a.alive) {
          drawActor(a.kind, a.pos, fh, UP, vs);
          if (a.kind === 'radar') {
            const ang = t * 1.3 + a.id, fd = [Math.sin(ang), 0, -Math.cos(ang)];
            drawActor('dish', add(a.pos, [0, 17 * vs, 0]), fd, UP, vs);
          }
        } else if (K.ship) {
          if (a.deadT < 30) drawActor(a.kind, add(a.pos, [0, -a.deadT * 0.6, 0]), fh, rotUp(fh, Math.min(0.4, a.deadT * 0.03)), 1, CHAR);
        } else if (a.kind === 'bridge') {
          drawActor('bridge', add(a.pos, [0, -70, 0]), fh, rotUp(fh, 0.08), 1, CHAR);
        } else drawActor('wreck', a.pos, fh, UP, vs * Math.max(1, K.r / 14), null);
      }
      // stores in flight
      for (const m of sim.missiles) {
        const D = dist(m.pos, eye);
        if (D < 2500) drawActor('missile', m.pos, m.f, upright(m.f), visScale(D, 2.5));
        glow(add(m.pos, mul(m.f, -2.4)), m.t < m.burn ? 4.5 : 1.5, [1, 0.75, 0.4], 1);
      }
      for (const o of sim.ordnance) {
        const f = norm(o.vel);
        if (o.kind === 'bomb') { if (dist(o.pos, eye) < 2500) drawActor('bomb', o.pos, f, upright(f), 1.5); }
        else { glow(o.pos, 2.4, [1, 0.8, 0.5], 1); pts.push(...add(o.pos, mul(f, -6)), 1.8, 0.6, 0.45, 0.3, 0); }
      }
      for (const b of sim.bullets) {
        const c = b.team === 'blue' ? [1, 0.88, 0.45] : [1, 0.45, 0.3];
        const v = mul(b.vel, 1 / 1000);
        glow(b.pos, 1.3, c, 1); glow(sub(b.pos, mul(v, 10)), 1.1, c, 0.7); glow(sub(b.pos, mul(v, 20)), 0.9, c, 0.45);
      }
      for (const d of sim.decoys) {
        if (d.kind === 'flare') glow(d.pos, 6 * (0.6 + d.life / 6), [1, 0.85, 0.6], 1);
        else pts.push(d.pos[0], d.pos[1], d.pos[2], 7, 0.5 * 0.3, 0.52 * 0.3, 0.55 * 0.3, 0.3);
      }
    }
    if (!sim) {
      // the screens' jet
      drawActor('player', show.pos, show.f, show.u, 1);
      glow(add(show.pos, mul(show.f, -8.2)), 2, [1, 0.5, 0.25], 0.8);
    }
    for (const q of parts) {
      const k = q.t / q.life, s = q.s0 + (q.s1 - q.s0) * k;
      if (q.add) { const i = (1 - k) * (1 - k); pts.push(q.p[0], q.p[1], q.p[2], s, q.c[0] * i, q.c[1] * i, q.c[2] * i, 0); }
      else { const a = q.a * (1 - k) * Math.min(1, q.t * 8); pts.push(q.p[0], q.p[1], q.p[2], s, q.c[0] * a, q.c[1] * a, q.c[2] * a, a); }
    }
    const n = Math.min(pts.length / 8, pdata.length / 8);
    pdata.set(pts.length > pdata.length ? pts.slice(0, pdata.length) : pts);
    R.drawPoints(pdata, n);
  }
  function rotUp(f, a) { const r = norm(cross(f, UP)); return norm(add(mul(UP, Math.cos(a)), mul(r, Math.sin(a)))); }

  /** world point → reference-frame screen point (1920 × 1080), or null behind the eye */
  function project(p) {
    const m = R?.state.vp;
    if (!m) return null;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w < 0.5) return null;
    return { x: (x / w * 0.5 + 0.5) * W, y: (0.5 - y / w * 0.5) * H, w };
  }
  const viewer = { project, cam, msgs, get focal() { return (H / 2) / Math.tan(cam.fov / 2); } };

  // ---------- frame ----------
  let lastApp = app0, lastStep = -1, destroyed = false;
  function draw(app) {
    lastApp = app;
    if (destroyed) return;
    if (stepN === lastStep && !dirty) return; // nothing moved since the last frame
    lastStep = stepN; dirty = false;
    const sim = app.sim, playing = app.state === 'play' || app.state === 'pause';
    if (R && !R.lost()) {
      theatre(playing ? sim.theatre : app.backdrop ?? 0);
      if (!playing && stepN === 0) showCamera(app);
      if (playing && stepN === 0) playCamera(app, sim);
      if (shake > 0 && app.view === 'cockpit') {
        const j = shake * 0.004;
        cam.f = norm(add(cam.f, [(rnd() - 0.5) * j, (rnd() - 0.5) * j, (rnd() - 0.5) * j]));
      }
      world(app, playing ? sim : null);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    ui.ref();
    if (!R) {
      g.fillStyle = '#0b1118'; g.fillRect(0, 0, W, H);
      ui.text('CONTRAIL NEEDS WEBGL 2', W / 2, H / 2 - 20, 54, COL.amber, { align: 'center', wgt: 700, sp: 6 });
      ui.text('This browser or device has no WebGL 2 graphics. Try a current Chrome, Edge, Firefox or Safari.', W / 2, H / 2 + 40, 26, COL.dim, { align: 'center', wgt: 500 });
      if (err) ui.text(err.slice(0, 120), W / 2, H / 2 + 90, 18, COL.faint, { align: 'center', wgt: 400 });
      return;
    }
    if (playing) drawHud(ui, app, viewer);
    drawScreen(ui, app, viewer, scene.world);
    ui.ref();
    if (flash > 0 && playing) { g.globalAlpha = Math.min(0.4, flash); g.fillStyle = flashCol; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    if (app.demo) ui.text('DEMO', W - 36, H - 30, 26, `rgba(255,255,255,${0.35 + 0.25 * Math.sin(app.t * 3)})`, { align: 'right', wgt: 700, sp: 6 });
    if (app.fade > 0) { g.globalAlpha = Math.min(1, app.fade); g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  // fonts arriving late: draw the 2D layer again
  void document.fonts?.ready.then(() => { dirty = true; if (!destroyed && lastApp) draw(lastApp); });

  function hit(px, py, app) { return screenHit(app, px / ui.u, py / ui.u); }
  function destroy() {
    destroyed = true;
    unfit(); unfitGL();
    // free what this renderer made, but keep the context: the next boot on this canvas (the
    // launcher turns the demo into the game) gets the same one back, and a lost one draws nothing
    scene.terrain?.destroy(); scene.decal?.destroy(); meshBuf?.destroy(); R?.destroy();
  }
  return { draw, events, hit, destroy };
}
