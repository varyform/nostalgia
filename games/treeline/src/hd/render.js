// The HD renderer. The world is WebGL2 (@nostalgia/gl) on the page's #gl canvas: the theatre's
// ground, forest canopy, houses and roads (terrain.js), its trees as instances, every helicopter,
// jet, vehicle, site and store from shared meshes (meshes.js) with turning rotors, turrets and
// dishes, the Gadfly's ground shadow, and the fire, smoke, dust, spray, tracers and flares as
// soft points. The HUD, the cockpit's instruments, the gunner's sight and every screen are 2D
// vectors on the transparent #c canvas over it (hud.js, screens.js). It only reads state;
// events() turns the sim's events into particles and camera shake each step.
//
//   const view = createRenderer(canvas, app);
//   view.events(sim.events, sim);  view.draw(app);  view.hit(x, y, app) → touch target
import { fitWide } from '@nostalgia/game/runtime';
import { createGL, modelOf } from '@nostalgia/gl';
import { createWorld } from '../world.js';
import { KINDS, SKID, add, cross, dirOf, dist, dot, len, mul, norm, sub } from '../sim.js';
import { drawHud } from './hud.js';
import { GLASS, MOUNT, buildMeshes } from './meshes.js';
import { drawScreen, screenHit } from './screens.js';
import { buildTerrain } from './terrain.js';
import { COL, H, W, createUI } from './ui.js';

const UP = [0, 1, 0];
const CHAR = [0.3, 0.27, 0.25];
const NEAR_TREES = 950, FAR_TREES = 3600; // m from a chunk: full trees, then far shapes, then the canopy alone
// cover → downwash colour (COVER order in world.js: grass, field, forest, town, road, water, rock, snow, mud, pad)
const WASH = [[0.62, 0.58, 0.42], [0.7, 0.6, 0.42], [0.3, 0.38, 0.22], [0.62, 0.58, 0.52], [0.66, 0.6, 0.5], [0.92, 0.95, 0.97], [0.62, 0.6, 0.58], [0.96, 0.97, 1], [0.5, 0.42, 0.3], [0.66, 0.62, 0.55]];

export function createRenderer(cv, app0) {
  const demo = !!app0.demo;
  const g = cv.getContext('2d');
  const ui = createUI(g);
  let glc = document.getElementById('gl');
  if (!glc) { glc = document.createElement('canvas'); glc.id = 'gl'; cv.parentNode.insertBefore(glc, cv); }
  let R = null, err = '';
  try { R = createGL(glc, { antialias: !demo, stencil: true }); } catch (e) { err = String(e?.message ?? e); R = null; }
  const has = R?.features ?? {};
  let meshBuf = null, ranges = null;
  if (R) { const M = buildMeshes(); meshBuf = R.buffer(M.data); ranges = M.ranges; }
  const MAX_P = demo ? 1200 : 3000;

  // ---------- the theatre's static geometry, built when the theatre changes ----------
  let scene = { index: -1 };
  function theatre(index) {
    if (scene.index === index || !R) return scene;
    freeScene();
    const W0 = createWorld(index), T = buildTerrain(W0), S = W0.T.sky;
    scene = {
      index, world: W0, T,
      chunks: T.chunks, extras: T.extras, terrain: R.buffer(T.data), decal: R.buffer(T.decals.data), decals: T.decals.count,
      props: R.buffer(T.props.data), pr: T.props.ranges, groups: T.groups,
      inst: has.instancing ? R.instances(T.inst) : null,
      sky: { ...S, sunN: norm(S.sun), ...(S.mist ? { mist: { top: S.mist, density: 1 / 900 } } : {}) },
    };
    return scene;
  }
  function freeScene() { for (const k of ['terrain', 'decal', 'props', 'inst']) scene[k]?.destroy(); }

  // ---------- size ----------
  let cw = 1, ch = 1, dirty = true;
  const unfit = fitWide(cv, { maxDpr: demo ? 1 : 2, onFit: (w, h) => { cw = w; ch = h; ui.scale(h / H); dirty = true; } });
  const unfitGL = fitWide(glc, { maxDpr: demo ? 1 : 2, maxWidth: demo ? 960 : 2560, onFit: () => { dirty = true; } });

  // ---------- camera ----------
  const cam = { eye: [0, 100, 0], f: [0, 0, -1], u: [0, 1, 0], fov: 1.0, near: 0.6, far: 9000 };
  let chase = null, lastView = '', orbit = 0, sightFov = 0.2;
  const toWorld = (A, o) => add(add(add(A.pos, mul(cross(A.f, A.u), o[0])), mul(A.u, o[1])), mul(A.f, -o[2]));
  // a helicopter's mesh frame: its pos is SKID metres above the wheels, where the meshes stand
  const airframe = A => ({ pos: sub(A.pos, mul(A.u, SKID)), f: A.f, u: A.u });
  const onHeli = (A, o) => toWorld(airframe(A), o);
  function upright(f) { const r = cross(f, UP), L = len(r); return L < 1e-4 ? [0, 0, -1] : cross(mul(r, 1 / L), f); }
  const flat = f => { const h = norm([f[0], 0, f[2]]); return h[0] || h[2] ? h : [0, 0, -1]; };
  function playCamera(app, sim) {
    const P = sim.player;
    if (!P) return;
    const v = app.view, W0 = sim.world;
    cam.far = farOf(scene.sky);
    if (sim.status === 'down' || !P.alive) {
      // circle the wreck
      orbit += 0.005;
      const c = P.pos, r = 60, x = c[0] + Math.cos(orbit) * r, z = c[2] + Math.sin(orbit) * r;
      cam.eye = [x, Math.max(c[1] + 22, W0.topAt(x, z) + 8), z];
      cam.f = norm(sub(c, cam.eye)); cam.u = upright(cam.f); cam.fov = 0.95; cam.near = 1;
      chase = null;
      return;
    }
    if (v === 'cockpit') {
      cam.eye = onHeli(P, MOUNT.player.eye);
      cam.f = P.f; cam.u = P.u; cam.fov = 1.05; cam.near = 0.4;
      chase = null;
    } else if (v === 'sight' && P.target) {
      // the nose sensor, slewed onto the target and zoomed to frame it
      const eye = onHeli(P, MOUNT.player.nose), tp = add(P.target.pos, [0, 1.2, 0]), D = dist(tp, eye);
      const want = Math.max(0.035, Math.min(0.32, 2 * Math.atan((KINDS[P.target.kind].r * 6 + 14) / D)));
      sightFov += (want - sightFov) * 0.15;
      cam.eye = eye; cam.f = norm(sub(tp, eye)); cam.u = upright(cam.f); cam.fov = sightFov; cam.near = 2;
      chase = null;
    } else {
      // a sprung chase camera behind and above, following the heading, not the pitch
      const fh = flat(P.f), back = 24 + Math.min(14, P.gs * 0.18);
      const want = add(add(P.pos, mul(fh, -back)), [0, 7.5 + Math.max(0, -P.vs) * 0.3, 0]);
      if (!chase || lastView !== v) chase = { eye: want };
      chase.eye = add(chase.eye, mul(sub(want, chase.eye), 0.1));
      const gy = W0.topAt(chase.eye[0], chase.eye[2]) + 3;
      if (chase.eye[1] < gy) chase.eye[1] = gy;
      cam.eye = chase.eye;
      cam.f = norm(sub(add(P.pos, add(mul(fh, 16), [0, 1.5, 0])), cam.eye));
      cam.u = upright(cam.f); cam.fov = 1.0; cam.near = 0.8;
    }
    lastView = v;
  }
  /** how far the fog lets anything be seen */
  const farOf = S => Math.min(9000, 2.4 / (S?.fog ?? 1 / 3000));
  // the screens' backdrop: the Gadfly sweeping low along the home pad's tree line
  const show = { a: 0, pos: [0, 0, 0], f: [0, 0, -1], u: UP, rotor: 0 };
  function showCamera(app) {
    const s = theatre(app.backdrop ?? 0);
    if (!s.world) return;
    const W0 = s.world, home = W0.site('home');
    show.a += 0.0016; show.rotor += 0.55;
    const c = [home.x + 260, 0, home.z - 320], r = 340, a = show.a;
    const x = c[0] + Math.cos(a) * r, z = c[2] + Math.sin(a) * r;
    const y = Math.max(W0.topAt(x, z), W0.heightAt(x, z)) + 26 + Math.sin(a * 3) * 4;
    show.pos = [x, y, z];
    const f = norm([-Math.sin(a), 0, Math.cos(a)]), inward = norm([c[0] - x, 0, c[2] - z]);
    // nose a little down for speed, banked into the turn
    show.f = norm(add(f, [0, -0.08, 0]));
    show.u = norm(add(add(UP, mul(inward, 0.28)), mul(f, 0.12)));
    show.u = norm(sub(show.u, mul(show.f, dot(show.u, show.f))));
    const b = a - 0.075, er = r + 30;
    const ex = c[0] + Math.cos(b) * er, ez = c[2] + Math.sin(b) * er;
    cam.eye = [ex, Math.max(y - 4, W0.topAt(ex, ez) + 6), ez];
    cam.f = norm(sub(add(show.pos, mul(f, 6)), cam.eye)); cam.u = upright(cam.f); cam.fov = 0.9; cam.near = 1; cam.far = farOf(s.sky);
  }

  // ---------- particles ----------
  const parts = [];
  const pdata = new Float32Array((MAX_P + 3000) * 8);
  function puff(p, o) {
    if (parts.length >= MAX_P) parts.shift();
    parts.push({ p: [...p], v: o.v ? [...o.v] : [0, 0, 0], t: 0, life: o.life ?? 2, s0: o.s0 ?? 3, s1: o.s1 ?? o.s0 ?? 3, c: o.c ?? [1, 1, 1], a: o.a ?? 0.6, add: !!o.add, drag: o.drag ?? 1, rise: o.rise ?? 0 });
  }
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const jit = k => [(rnd() - 0.5) * k, (rnd() - 0.5) * k, (rnd() - 0.5) * k];
  const FIRE = [1, 0.6, 0.24], SMOKE = [0.2, 0.19, 0.18], WHITE = [0.94, 0.95, 0.96], DIRT = [0.42, 0.34, 0.24], LEAF = [0.22, 0.32, 0.14];
  function explode(e, near) {
    const p = [e.x, e.y, e.z], big = e.big, k = big ? 1 : 0.5;
    puff(p, { s0: 14 * k, s1: 40 * k, life: 0.6, c: [1, 0.85, 0.5], add: true, a: 1 });
    for (let i = 0; i < (big ? 10 : 5); i++) puff(add(p, jit(10 * k)), { v: add(jit(24 * k), [0, 8 * k, 0]), s0: 9 * k, s1: 26 * k, life: 0.5 + rnd() * 0.6, c: FIRE, add: true, drag: 2.5 });
    for (let i = 0; i < (big ? 9 : 4); i++) puff(add(p, jit(8 * k)), { v: add(jit(8 * k), [0, 5, 0]), s0: 12 * k, s1: 42 * k, life: 3 + rnd() * 3, c: SMOKE, a: 0.6, drag: 1.2, rise: 3 });
    if (near && !e.air) for (let i = 0; i < 6; i++) puff(p, { v: add(jit(40 * k), [0, 22 * k, 0]), s0: 1.4, s1: 1, life: 1.3, c: DIRT, a: 0.9, drag: 0.4, rise: -14 });
    if (near) for (let i = 0; i < 6; i++) puff(p, { v: add(jit(70 * k), [0, 25, 0]), s0: 1.5, s1: 0.6, life: 1.1, c: [1, 0.8, 0.4], add: true, drag: 0.4, rise: -9 });
  }
  // the last places each trail was laid, so smoke comes out as an even ribbon
  const trails = new WeakMap();
  function trail(obj, p, every, make) {
    const last = trails.get(obj);
    if (!last) { trails.set(obj, [...p]); return; }
    const d = dist(last, p);
    if (d < every) return;
    const n = Math.min(10, Math.floor(d / every));
    for (let i = 1; i <= n; i++) make(add(last, mul(sub(p, last), i / n)));
    trails.set(obj, [...p]);
  }
  const msgs = [];
  let flash = 0, flashCol = '#fff', shake = 0, stepN = 0, muzzle = 0;
  function events(list, sim) {
    stepN++;
    const app = lastApp;
    if (!app) return;
    const playing = app.state === 'play' || app.state === 'pause';
    if (!playing) showCamera(app);
    else { theatre(sim.theatre); if (app.state === 'play') playCamera(app, sim); }
    for (const m of msgs) m.t += 1 / 60;
    while (msgs.length && msgs[0].t > 6) msgs.shift();
    if (!playing || app.state === 'pause') return;
    const P = sim.player, near = e => !P || Math.abs(e.x - P.pos[0]) + Math.abs(e.z - P.pos[2]) < 2500;
    const at = e => [e.x, e.y, e.z];
    for (const e of list) {
      switch (e.type) {
        case 'msg': msgs.push({ text: e.text, t: 0 }); if (msgs.length > 3) msgs.shift(); break;
        case 'boom': explode(e, near(e)); if (e.kind === 'player') { flash = 0.8; flashCol = '#ffb070'; } break;
        case 'crash': explode({ ...e, big: true }, true); shake = 1.5; break;
        case 'flak':
          puff(at(e), { s0: 6, s1: 18, life: 0.25, c: [1, 0.7, 0.3], add: true });
          for (let i = 0; i < 3; i++) puff(add(at(e), jit(6)), { v: jit(4), s0: 8, s1: 22, life: 2.4, c: [0.13, 0.12, 0.11], a: 0.7 });
          break;
        case 'spark': case 'hit':
          puff(at(e), { s0: 2.5, s1: 1, life: 0.15, c: [1, 0.9, 0.6], add: true });
          if (e.armor) for (let i = 0; i < 3; i++) puff(at(e), { v: add(jit(30), [0, 10, 0]), s0: 0.6, s1: 0.3, life: 0.4, c: [1, 0.85, 0.5], add: true, rise: -10 });
          break;
        case 'dust':
          puff([e.x, e.y + 0.5, e.z], { v: [0, 3, 0], s0: 2, s1: 6, life: 1.0, c: DIRT, a: 0.6 });
          puff([e.x, e.y + 0.5, e.z], { v: add(jit(6), [0, 7, 0]), s0: 0.8, s1: 0.5, life: 0.6, c: DIRT, a: 0.9, rise: -12 });
          break;
        case 'spout': puff([e.x, e.y + 0.5, e.z], { v: [0, 8, 0], s0: 1.5, s1: 4, life: 0.8, c: WHITE, a: 0.7, rise: -9 }); break;
        case 'splash':
          for (let i = 0; i < (e.big ? 12 : 6); i++) puff([e.x, e.y + 1, e.z], { v: add(jit(e.big ? 18 : 9), [0, (e.big ? 24 : 12) * (0.6 + rnd()), 0]), s0: e.big ? 7 : 4, s1: e.big ? 18 : 9, life: 1.6, c: WHITE, a: 0.75, rise: -12, drag: 0.6 });
          break;
        case 'pop': puff(at(e), { s0: 5, s1: 14, life: 1.5, c: [0.55, 0.55, 0.55], a: 0.5 }); break;
        case 'launch': for (let i = 0; i < 6; i++) puff(add(at(e), jit(3)), { v: add(jit(6), [0, 4, 0]), s0: 4, s1: 14, life: 2.5, c: [0.8, 0.78, 0.74], a: 0.55, drag: 1.5 }); break;
        case 'efire': puff(at(e), { s0: e.kind === 'shell' ? 7 : 3, s1: 1, life: e.kind === 'shell' ? 0.2 : 0.08, c: [1, 0.75, 0.4], add: true }); if (e.kind === 'shell') puff(at(e), { s0: 4, s1: 12, life: 1.5, c: [0.6, 0.58, 0.54], a: 0.4 }); break;
        case 'cannon': muzzle = 3; if (app.view === 'cockpit') shake = Math.max(shake, 0.08); break;
        case 'rocket': case 'missile':
          if (P) for (const o of [[-2.2, 1.25, -1.4], [2.2, 1.25, -1.4]]) puff(onHeli(P, o), { v: mul(P.f, -6), s0: 1.5, s1: 6, life: 0.9, c: [0.85, 0.84, 0.8], a: 0.5 });
          break;
        case 'treestrike':
          for (let i = 0; i < 14; i++) puff(add(at(e), jit(4)), { v: add(jit(14), [0, 6, 0]), s0: 0.8, s1: 0.5, life: 1.4, c: rnd() < 0.5 ? LEAF : [0.36, 0.28, 0.16], a: 0.95, drag: 1.2, rise: -6 });
          shake = Math.max(shake, 0.5);
          break;
        case 'land': if (e.hard) shake = Math.max(shake, 0.6); break;
        case 'damage': flash = Math.max(flash, 0.25 + e.amount * 0.5); flashCol = '#ff3020'; shake = Math.max(shake, 0.4 + e.amount); break;
        case 'start': parts.length = 0; msgs.length = 0; chase = null; break;
      }
    }
    flash = Math.max(0, flash - (1 / 60) * 1.6); shake = Math.max(0, shake - (1 / 60) * 2); muzzle = Math.max(0, muzzle - 1);
    const W0 = sim.world;
    // missiles, rockets, flares, burning wrecks, falling aircraft
    for (const m of sim.missiles) trail(m, m.pos, m.kind === 'sam' ? 5 : 3.5, p => puff(p, { s0: m.kind === 'sam' ? 1.6 : 0.8, s1: m.kind === 'sam' ? 9 : 4.5, life: m.kind === 'sam' ? 3.2 : 2.2, c: [0.86, 0.86, 0.85], a: 0.5, drag: 0.3 }));
    for (const k of sim.rockets) trail(k, k.pos, 4, p => puff(p, { s0: 0.6, s1: 2.6, life: 0.8, c: [0.75, 0.74, 0.7], a: 0.45, drag: 0.6 }));
    for (const d of sim.decoys) if (d.kind === 'flare') trail(d, d.pos, 2.5, p => puff(p, { s0: 1.2, s1: 4, life: 1.4, c: WHITE, a: 0.35 }));
    for (const a of sim.actors) {
      if (a.dying) trail(a, a.pos, 4, p => { puff(p, { s0: 3, s1: 12, life: 2.6, c: SMOKE, a: 0.6, rise: 2 }); if (rnd() < 0.5) puff(p, { s0: 2.5, s1: 1, life: 0.3, c: FIRE, add: true }); });
      else if (!a.alive && a.deadT < 70 && stepN % 4 === 0 && P && Math.abs(a.pos[0] - P.pos[0]) < 4000 && Math.abs(a.pos[2] - P.pos[2]) < 4000 && a.kind !== 'survivor') {
        const big = KINDS[a.kind].r > 9, base = add(a.pos, [0, 1.5, 0]);
        puff(add(base, jit(big ? 8 : 3)), { v: [1.5, 5, 0.8], s0: big ? 9 : 5, s1: big ? 36 : 22, life: 7, c: SMOKE, a: 0.5, rise: 1.5 });
        if (a.deadT < 30) puff(add(base, jit(big ? 6 : 2)), { s0: big ? 7 : 4, s1: 1.5, life: 0.6, c: FIRE, add: true, rise: 3 });
      }
      // the survivors' orange smoke
      if (a.kind === 'survivor' && a.alive && stepN % 6 === 0) puff(add(a.pos, [1.5, 0.5, 1]), { v: [1.2, 3.2, 0.4], s0: 1.5, s1: 9, life: 5, c: [1, 0.48, 0.15], a: 0.55, rise: 0.6 });
    }
    // rotor downwash: dust, spray, snow or leaves blown out from under the Gadfly
    if (P?.alive && (P.rpm ?? 1) > 0.5) {
      const gy = W0.heightAt(P.pos[0], P.pos[2]), top = W0.topAt(P.pos[0], P.pos[2]), h = P.pos[1] - top;
      const span = MOUNT.player.r * 2.6;
      if (h < span) {
        const k = (1 - h / span) * (P.rpm ?? 1), canopy = top > gy + 1;
        const cover = canopy ? 2 : W0.coverAt(P.pos[0], P.pos[2]), col = WASH[cover] ?? WASH[0], wet = cover === 5;
        const n = demo ? 1 : rnd() < k ? 3 : 1;
        for (let i = 0; i < n && rnd() < k * 1.4; i++) {
          const a = rnd() * Math.PI * 2, r0 = 2 + rnd() * 4, dx = Math.cos(a), dz = Math.sin(a);
          const x = P.pos[0] + dx * r0, z = P.pos[2] + dz * r0, y = (canopy ? W0.topAt(x, z) : W0.heightAt(x, z)) + 0.6;
          puff([x, y, z], { v: [dx * (10 + rnd() * 10), 1.5 + rnd() * 2, dz * (10 + rnd() * 10)], s0: wet ? 1.5 : 2, s1: wet ? 6 : 9, life: 1.1 + rnd() * 0.6, c: col, a: wet ? 0.5 : canopy ? 0.8 : 0.4, drag: 1.6, rise: wet ? -1 : 0.5 });
        }
      }
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
  const stats = { draws: 0, tris: 0, trees: 0 };
  function mesh(name, pos, f, u, s = 1, tint = null, alpha = 1, buf = meshBuf, rg = ranges) {
    const r = rg[name];
    if (!r) return;
    stats.draws++; stats.tris += r[1] / 3;
    if (alpha < 1) R.drawMesh(buf, r, modelOf(pos, f, u, s, M), tint, false, alpha);
    else R.drawMesh(buf, r, modelOf(pos, f, u, s, M), tint);
  }
  const glassQ = [];
  /** a helicopter: body, main rotor (blades slow, a translucent disc fast), tail rotor */
  function heli(A0, kind, body, tint, rpm, angle, P) {
    const A = airframe(A0), Mo = MOUNT[kind], r = cross(A.f, A.u);
    mesh(body, A.pos, A.f, A.u, 1, tint);
    const hub = toWorld(A, Mo.hub), spin = rpm > 0.55 && has.glass;
    const rotorAt = (y, ang, blades) => {
      const c = Math.cos(ang), s = Math.sin(ang), bf = add(mul(A.f, c), mul(r, s));
      if (!spin || rpm < 0.75) mesh(blades, add(hub, mul(A.u, y)), bf, A.u, 1, tint);
      if (spin) glassQ.push(['disc', add(hub, mul(A.u, y)), A.f, A.u, Mo.r, Math.min(0.16, (rpm - 0.55) * 0.7)], ['ring', add(hub, mul(A.u, y + 0.01)), A.f, A.u, Mo.r, Math.min(0.26, (rpm - 0.55) * 1.0)]);
    };
    if (Mo.coax) { rotorAt(0, angle, 'blades3'); rotorAt(Mo.coax, -angle * 1.03, 'blades3'); }
    else rotorAt(0, angle, Mo.blades === 3 ? 'blades3' : 'blades4');
    if (Mo.tail) {
      const tp = toWorld(A, Mo.tail), b = angle * 4.7, c = Math.cos(b), s = Math.sin(b);
      const tf = add(mul(A.f, c), mul(A.u, s)), tu = sub(mul(A.u, c), mul(A.f, s));
      if (!spin) mesh('tail4', tp, tf, tu, Mo.tr, tint);
      else glassQ.push(['tailDisc', tp, A.f, A.u, Mo.tr, Math.min(0.3, (rpm - 0.55) * 1.0)]);
    }
    if (P && has.shadow) shadowOf(A, kind, body, rpm);
  }
  /** the Gadfly's shadow on the ground or the canopy under it: body and rotor disc */
  function shadowOf(A, kind, body, rpm) {
    const W0 = scene.world, x = A.pos[0], z = A.pos[2];
    const gy = W0.heightAt(x, z), top = W0.topAt(x, z);
    if (A.pos[1] - top > 120) return;
    const n = top > gy + 0.5 ? UP : W0.normalAt(x, z), y = top;
    const plane = [n[0], n[1], n[2], -(n[0] * x + n[1] * y + n[2] * z) - 0.15];
    const dir = norm(add(scene.sky.sunN, [0, 2.2, 0]));
    const fade = Math.max(0.12, 0.5 * (1 - (A.pos[1] - top) / 120));
    R.drawShadow(meshBuf, ranges[body], modelOf(A.pos, A.f, A.u, 1, M), plane, fade, dir);
    if (rpm > 0.55) R.drawShadow(meshBuf, ranges.disc, modelOf(toWorld(A, MOUNT[kind].hub), A.f, A.u, MOUNT[kind].r, M), plane, fade * 0.45, dir);
  }
  function groundUp(W0, a) { return W0.normalAt(a.pos[0], a.pos[2]); }
  function onGround(f, u) { const h = norm(sub(f, mul(u, dot(f, u)))); return h[0] || h[2] ? h : [0, 0, -1]; }

  function world(app, sim, thermalView) {
    const s = scene, S = s.sky, W0 = s.world;
    stats.draws = 0; stats.tris = 0; stats.trees = 0;
    R.frame(cam, S, thermalView ? { thermal: true } : undefined);
    const gl = R.gl, eye = cam.eye, far = cam.far, far2 = far * far;
    const vis = [];
    for (let q = 0; q < s.chunks.length; q++) {
      const c = s.chunks[q], dx = c.c[0] - eye[0], dz = c.c[2] - eye[2], d2 = dx * dx + dz * dz;
      if (d2 > far2 + c.r * c.r * 2.2) continue;
      if (!R.visible(c.c, c.r)) continue;
      vis.push(q);
      R.drawStatic(s.terrain, c.first, c.count); stats.draws++; stats.tris += c.count / 3;
    }
    for (const e of s.extras) if (R.visible(e.c, e.r)) { R.drawStatic(s.terrain, e.first, e.count); stats.draws++; }
    // trees: the instances of the chunks in view, full shapes near, far shapes further out
    if (s.inst) {
      for (const q of vis) {
        const c = s.chunks[q], d = Math.max(0, Math.hypot(c.c[0] - eye[0], c.c[2] - eye[2]) - 570);
        if (d > FAR_TREES) continue;
        // full trees near, far shapes beyond, cross-faded per tree across a band
        for (const G of s.groups[q]) {
          if (d < NEAR_TREES + 60) {
            const r = s.pr['tree' + G.kind];
            R.drawInstanced(s.props, r, s.inst, G.first, G.count, { far: NEAR_TREES, fade: 120 });
            stats.draws++; stats.tris += (r[1] / 3) * G.count; stats.trees += G.count;
          }
          if (d + 1140 > NEAR_TREES - 60) {
            const r = s.pr['far' + G.kind];
            R.drawInstanced(s.props, r, s.inst, G.first, G.count, { near: NEAR_TREES, far: FAR_TREES, fade: 120 });
            stats.draws++; stats.tris += (r[1] / 3) * G.count;
          }
        }
      }
    }
    // bridges (targets on some missions: broken once destroyed)
    (W0.bridges ?? []).forEach((b, k) => {
      const p = [b.x, b.y, b.z];
      if (!R.visible(p, b.len)) return;
      const dead = sim?.actors.find(a => a.kind === 'bridge' && !a.alive && Math.hypot(a.pos[0] - b.x, a.pos[2] - b.z) < b.len);
      const f = norm([b.dx, 0, b.dz]);
      if (dead) mesh(`bridge${k}`, add(p, [0, -4, 0]), f, norm([0.12, 1, 0]), 1, CHAR, 1, s.props, s.pr);
      else mesh(`bridge${k}`, p, f, UP, 1, null, 1, s.props, s.pr);
    });
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -6);
    R.drawStatic(s.decal, 0, s.decals); stats.draws++;
    gl.disable(gl.POLYGON_OFFSET_FILL);

    const pts = [];
    const glow = (p, size, c, k = 1) => pts.push(p[0], p[1], p[2], size, c[0] * k, c[1] * k, c[2] * k, 0);
    glassQ.length = 0;
    // in the thermal sight, engines and hulls glow against the cool woods
    if (thermalView) R.heat(0.85);
    if (sim) {
      const P = sim.player, t = sim.t;
      for (const a of sim.actors) {
        const K = KINDS[a.kind];
        const D = dist(a.pos, eye);
        if (D > far) continue;
        if (!R.visible(a.pos, (K.hl ?? 0) + K.r * 2 + 10)) continue;
        if (a === P) {
          if (app.view === 'cockpit' && P.alive) continue;
          if (!P.alive && !P.dying) { mesh('heliWreck', sub(a.pos, [0, SKID, 0]), flat(a.f), UP, 1); continue; }
          heli(a, 'player', 'player', P.alive ? null : CHAR, P.rpm ?? 1, P.rotor ?? 0, true);
          if (muzzle > 0) glow(onHeli(P, [0, 0.58, -6.6]), 1.6, [1, 0.8, 0.45], 1);
          continue;
        }
        if (a.air) {
          if (!a.alive && !a.dying) { if (K.heli) mesh('heliWreck', sub(a.pos, [0, SKID, 0]), flat(a.f), UP, 1); continue; }
          const tint = a.alive ? null : CHAR;
          if (K.heli) heli(a, 'mantis', 'mantis', tint, a.alive ? 1 : 0.8, a.rotor ?? t * 30, false);
          else {
            mesh('stiletto', a.pos, a.f, a.u ?? upright(a.f), D > 1800 ? 1 + (D - 1800) / 2400 : 1, tint);
            if (a.alive) glow(toWorld(a, [0, 1.0, 6.2]), 1.6, [1, 0.55, 0.3], 0.7);
          }
          continue;
        }
        const u = groundUp(W0, a), f = onGround(a.f, u);
        if (a.kind === 'bridge') continue; // drawn with the theatre's bridges
        if (!a.alive) {
          if (a.kind === 'survivor') continue;
          mesh(K.r > 9 ? 'wreckBig' : 'wreck', a.pos, f, u, Math.max(0.8, K.r / 5));
          continue;
        }
        mesh(a.kind, a.pos, f, u);
        const turret = (name, o) => mesh(name, toWorld({ pos: a.pos, f, u }, o), onGround(dirOf(a.turret ?? 0), u), u);
        if (a.kind === 'tank') turret('tankTurret', [0, 1.7, 0.3]);
        else if (a.kind === 'aatrack') turret('aaTurret', [0, 1.2, 0]);
        else if (a.kind === 'aa') turret('aaGun', [0, 0.5, 0]);
        else if (a.kind === 'sam') turret('samRack', [0, 1.85, 1.6]);
        else if (a.kind === 'radar') mesh('radarDish', toWorld({ pos: a.pos, f, u }, [0, 4.9, 0.8]), dirOf(t * 1.3 + a.id), UP);
        if (a.kind === 'survivor' && Math.floor(t * 2) % 2 === 0) glow(add(a.pos, [0, 2.6, 0]), 1.2, [1, 0.35, 0.2], 1);
      }
      // stores in flight
      for (const m of sim.missiles) {
        const D = dist(m.pos, eye);
        if (D < 1400) mesh(m.kind === 'sam' ? 'samMissile' : 'atgm', m.pos, m.f, upright(m.f), 1);
        glow(add(m.pos, mul(m.f, -1.2)), m.t < m.burn ? (m.kind === 'sam' ? 3 : 1.8) : 0.6, [1, 0.75, 0.4], 1);
      }
      for (const k of sim.rockets) {
        const f = norm(k.vel);
        if (dist(k.pos, eye) < 900) mesh('rocket', k.pos, f, upright(f), 1);
        glow(add(k.pos, mul(f, -0.8)), 1.2, [1, 0.8, 0.5], 1);
      }
      for (const b of sim.bullets) {
        if (!b.tracer && b.kind !== 'flak') continue;
        const c = b.team === 'blue' ? [1, 0.86, 0.45] : b.kind === 'flak' ? [1, 0.6, 0.3] : [1, 0.4, 0.3];
        const v = mul(b.vel, 1 / 1000), sz = b.kind === 'shell' ? 1.1 : 0.6;
        glow(b.pos, sz, c, 1); glow(sub(b.pos, mul(v, 8)), sz * 0.85, c, 0.7); glow(sub(b.pos, mul(v, 16)), sz * 0.7, c, 0.45);
      }
      for (const d of sim.decoys) {
        if (d.kind === 'flare') glow(d.pos, 3 * (0.6 + Math.min(1, d.life / 4)), [1, 0.85, 0.6], 1);
        else pts.push(d.pos[0], d.pos[1], d.pos[2], 4, 0.5 * 0.3, 0.52 * 0.3, 0.55 * 0.3, 0.3);
      }
    } else {
      // the screens' Gadfly
      heli({ pos: show.pos, f: show.f, u: show.u }, 'player', 'player', null, 1, show.rotor, true);
    }
    // the translucent pass: rotor discs, after everything solid
    for (const [name, p, f, u, sc, al] of glassQ) mesh(name, p, f, u, sc, null, al);
    for (const q of parts) {
      const k = q.t / q.life, sz = q.s0 + (q.s1 - q.s0) * k;
      if (q.add) { const i = (1 - k) * (1 - k); pts.push(q.p[0], q.p[1], q.p[2], sz, q.c[0] * i, q.c[1] * i, q.c[2] * i, 0); }
      else { const a = q.a * (1 - k) * Math.min(1, q.t * 8); pts.push(q.p[0], q.p[1], q.p[2], sz, q.c[0] * a, q.c[1] * a, q.c[2] * a, a); }
    }
    const n = Math.min(pts.length / 8, pdata.length / 8);
    pdata.set(pts.length > pdata.length ? pts.slice(0, pdata.length) : pts);
    R.drawPoints(pdata, n);
  }
  void GLASS;

  /** world point → reference-frame screen point (1920 × 1080), or null behind the eye */
  function project(p) {
    const m = R?.state.vp;
    if (!m) return null;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w < 0.3) return null;
    return { x: (x / w * 0.5 + 0.5) * W, y: (0.5 - y / w * 0.5) * H, w };
  }
  const viewer = { project, cam, msgs, stats, get focal() { return H / 2 / Math.tan(cam.fov / 2); }, get world() { return scene.world; } };

  // ---------- frame ----------
  let lastApp = app0, lastStep = -1, destroyed = false, thermal = false;
  function draw(app) {
    lastApp = app;
    if (destroyed) return;
    if (stepN === lastStep && !dirty) return; // nothing moved since the last frame
    lastStep = stepN; dirty = false;
    const sim = app.sim, playing = app.state === 'play' || app.state === 'pause';
    const sight = playing && app.view === 'sight' && sim.player?.alive && sim.player.target;
    if (R && !R.lost()) {
      theatre(playing ? sim.theatre : app.backdrop ?? 0);
      if (!playing && stepN === 0) showCamera(app);
      if (playing && stepN === 0) playCamera(app, sim);
      if (shake > 0 && app.view !== 'sight') {
        const j = shake * 0.006;
        cam.f = norm(add(cam.f, [(rnd() - 0.5) * j, (rnd() - 0.5) * j, (rnd() - 0.5) * j]));
      }
      // the gunner's sight is a thermal camera: the engine's when it has one, a CSS filter if not
      if (!!sight !== thermal) { thermal = !!sight; if (!has.thermal) glc.style.filter = thermal ? 'grayscale(1) contrast(1.5) brightness(1.05)' : ''; }
      world(app, playing ? sim : null, thermal && has.thermal);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    ui.ref();
    if (!R) {
      g.fillStyle = '#0c120e'; g.fillRect(0, 0, W, H);
      ui.text('TREELINE NEEDS WEBGL 2', W / 2, H / 2 - 20, 54, COL.amber, { align: 'center', wgt: 700, sp: 6 });
      ui.text('This browser or device has no WebGL 2 graphics. Try a current Chrome, Edge, Firefox or Safari.', W / 2, H / 2 + 40, 26, COL.dim, { align: 'center', wgt: 500 });
      if (err) ui.text(err.slice(0, 120), W / 2, H / 2 + 90, 18, COL.faint, { align: 'center', wgt: 400 });
      return;
    }
    if (playing) drawHud(ui, app, viewer);
    drawScreen(ui, app, viewer);
    ui.ref();
    if (flash > 0 && playing) { g.globalAlpha = Math.min(0.4, flash); g.fillStyle = flashCol; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    if (app.demo) ui.text('DEMO', W - 40, 124, 26, `rgba(255,255,255,${(0.35 + 0.25 * Math.sin(app.t * 3)).toFixed(3)})`, { align: 'right', wgt: 700, sp: 6 });
    if (app.fade > 0) { g.globalAlpha = Math.min(1, app.fade); g.fillStyle = '#070a08'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  // fonts arriving late: draw the 2D layer again
  void document.fonts?.ready.then(() => { dirty = true; if (!destroyed && lastApp) draw(lastApp); });

  function hit(px, py, app) { return screenHit(app, px / ui.u, py / ui.u); }
  function destroy() {
    destroyed = true;
    unfit(); unfitGL();
    glc.style.filter = '';
    // free what this renderer made, but keep the context: the next boot on this canvas (the
    // launcher turns the demo into the game) gets the same one back
    freeScene(); meshBuf?.destroy(); R?.destroy();
  }
  return { draw, events, hit, destroy, stats };
}
