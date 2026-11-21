// The HD renderer: Scorch's race seen from straight above at the window's own resolution, in
// the largest 16:9 box (DPR ≤ 2, ≤ 2560 px). North stays up; the camera follows car 0, eased
// and looking ahead along its velocity, pulls back a little at speed and shakes on hits and
// explosions. The ground comes from world.js (chunks painted once per track and size), the cars
// from cars.js, smoke, sparks, fire and weather from fx.js, the HUD from hud.js. Every screen
// that isn't the race (and the pause menu over it) is screens.js's, which also says what a tap
// lands on. It only reads `app` and `race.s`.
//
//   const view = createRenderer(canvas, app);
//   view.events(race.events, race); view.draw(app); view.menuAt(x, y)
import { fitWide } from '@nostalgia/game/runtime';
import { carSpec, drawBeams, drawCar } from './cars.js';
import { createFx, createWeather, grade } from './fx.js';
import { TAU, alpha, clamp } from './gfx.js';
import { COOL, GOLD, GREEN, HOT, INK, RED, banner, countdown, drawHud, drawTouch, icon, ordinal, tags, text, UI } from './hud.js';
import { drawScreen, menuAt as screenMenuAt } from './screens.js';
import { createWorld } from './world.js';

const VIEW = 70; // metres across the screen at rest
const RACE_STATES = new Set(['race', 'pause', 'demo']);
const QUIET = new Set(['count', 'go', 'last', 'finish', 'lap']); // events that set the HUD's state
const PICK = { cash: GOLD, ammo: '#ffb040', repair: GREEN, turbo: COOL };
const SURF_SKID = { asphalt: 'rgba(14,12,12,A)', oil: 'rgba(4,4,6,A)', ice: 'rgba(240,250,255,A)', dirt: 'rgba(58,32,16,A)', snow: 'rgba(110,132,166,A)', water: null };

export function createRenderer(cv, app0) {
  const g = cv.getContext('2d', { alpha: false });
  const ui = { g, cw: 1, ch: 1, u: 1, dpr: 1 };
  let destroyed = false, lastApp = app0 ?? null, size = 0;
  // ---------- the race being shown, its world and the effects ----------
  const worlds = new Map();
  let R = null, W = null, weather = null, graded = null, drawnAt = -1;
  const demo = () => !!lastApp?.demo;
  const fx = createFx({ max: app0?.demo ? 700 : 1800 });
  const cam = { x: 0, y: 0, z: 1, shake: 0, flash: 0, red: 0 };
  const mem = []; // per car: wheel positions last frame, emitter clocks
  const pops = []; // floating "+$250" over pickups
  const H = { mini: null, raceT: 0, goT: -9, countT: -9, last: false, placePop: 0, prevPlace: 0, count: 0, ban: null, flash: { ammo: 0, mines: 0, turbo: 0, cash: 0 } };

  const unfit = fitWide(cv, {
    onFit(w, h) {
      ui.cw = w; ui.ch = h; ui.u = h / 1080; ui.dpr = w / (parseFloat(cv.style.width) || w);
      size++; worlds.clear(); W = null; graded = null; H.mini = null;
    },
  });
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });

  function worldFor(geo) {
    const P0 = ui.cw / VIEW, key = (geo.def.id ?? geo.def.name) + '|' + ui.cw + 'x' + ui.ch + '|' + size;
    let w = worlds.get(key);
    if (!w) {
      w = createWorld(geo, P0, { quality: demo() ? 0 : 1 });
      worlds.set(key, w);
      while (worlds.size > 2) worlds.delete(worlds.keys().next().value);
    } else w.reset();
    return w;
  }
  function setRace(race) {
    R = race; W = null; drawnAt = race ? race.s.t : -1;
    if (!race) return;
    W = worldFor(race.geo);
    fx.clear(); fx.setDust(W.th.dust);
    mem.length = 0; pops.length = 0;
    weather = W.theme === 'docks' ? createWeather('rain', { n: demo() ? 120 : 300 }) : W.theme === 'pass' ? createWeather('snow', { n: demo() ? 120 : 320 }) : null;
    graded = null; H.mini = null;
    Object.assign(H, { raceT: 0, goT: -9, countT: -9, last: false, placePop: 0, prevPlace: 0, count: 0, ban: null });
    const me = race.s.cars[0];
    if (me) Object.assign(cam, { x: me.x, y: me.y, z: 1, shake: 0, flash: 0, red: 0 });
  }
  const ensure = race => { if (race !== R || (race && !W)) setRace(race); };

  // ---------- events → effects ----------
  const near0 = (x, y, r) => { const me = R?.s.cars[0]; return me ? clamp(1 - Math.hypot(x - me.x, y - me.y) / r, 0, 1) : 0; };
  function gunTip(c, k) {
    const sp = carSpec(c.model), gun = sp.gun[k % sp.gun.length], ca = Math.cos(c.a), sa = Math.sin(c.a);
    return [c.x + gun[0] * ca - gun[1] * sa, c.y + gun[0] * sa + gun[1] * ca];
  }
  function events(list, race) {
    ensure(race);
    if (!race) return;
    const s = race.s;
    // events from a fast-forward (nothing drawn for a while: a still demo) leave no particles
    const live = s.t - drawnAt < 0.5;
    for (const e of list) {
      const c = e.car != null ? s.cars[e.car] : null;
      if (!live && !QUIET.has(e.k)) continue;
      switch (e.k) {
        case 'count': H.count = e.n; H.countT = s.t; break;
        case 'go': H.goT = s.t; break;
        case 'shot': {
          if (!c) break;
          const m = mem[e.car] ?? (mem[e.car] = newMem()), [x, y] = gunTip(c, m.gun++);
          fx.muzzle(x, y, c.a);
          if (e.car === 0) cam.shake = Math.max(cam.shake, 0.03);
          break;
        }
        case 'hit': {
          fx.sparks(e.x, e.y, 6 + Math.min(8, e.dmg | 0), null, 10);
          if ((e.dmg ?? 0) > 3) fx.debris(e.x, e.y, 2, 5);
          if (e.car === 0) { cam.shake = Math.max(cam.shake, 0.12 + Math.min(0.3, (e.dmg ?? 0) * 0.02)); cam.red = Math.min(1, cam.red + 0.35); }
          break;
        }
        case 'spark': fx.sparks(e.x, e.y, 5, null, 8); break;
        case 'drop': fx.dust(e.x, e.y, 0, 0, 0.6); break;
        case 'boom': {
          fx.boom(e.x, e.y, 1); W?.scorch(e.x, e.y, 3.2);
          const k = near0(e.x, e.y, 60);
          cam.shake = Math.max(cam.shake, 0.2 + k * 0.7); cam.flash = Math.max(cam.flash, k * 0.45);
          break;
        }
        case 'wreck': {
          fx.boom(e.x ?? c?.x, e.y ?? c?.y, 1.4); W?.scorch(e.x ?? c?.x, e.y ?? c?.y, 4.2);
          const k = near0(e.x ?? c?.x, e.y ?? c?.y, 70);
          cam.shake = Math.max(cam.shake, 0.3 + k * 0.8); cam.flash = Math.max(cam.flash, k * 0.5);
          if (e.car === 0) H.ban = { title: 'WRECKED', sub: 'OUT OF THE RACE', col: RED, t: 0, dur: 4 };
          break;
        }
        case 'bump': {
          fx.sparks(e.x, e.y, 4 + Math.min(14, (e.force ?? 5) | 0), null, 9);
          if ((e.force ?? 0) > 8) fx.debris(e.x, e.y, 3, 6, '#3a3634');
          if (e.a === 0 || e.b === 0) cam.shake = Math.max(cam.shake, Math.min(0.5, 0.06 + (e.force ?? 5) * 0.015));
          break;
        }
        case 'wall': {
          fx.sparks(e.x, e.y, 3 + Math.min(10, (e.force ?? 4) | 0), null, 8);
          fx.dust(e.x, e.y, 0, 0, 0.5);
          if (e.car === 0) cam.shake = Math.max(cam.shake, Math.min(0.4, 0.04 + (e.force ?? 4) * 0.012));
          break;
        }
        case 'pickup': {
          fx.glint(e.x, e.y, PICK[e.kind] ?? INK);
          if (e.car === 0) {
            const f = { cash: 'cash', ammo: 'ammo', turbo: 'turbo', repair: null }[e.kind];
            if (f) H.flash[f] = 1;
            pops.push({ x: e.x, y: e.y, t: 0, s: e.kind === 'cash' ? `+$${e.amount ?? ''}` : e.kind === 'repair' ? `+${e.amount ?? ''} ARMOUR` : e.kind === 'ammo' ? `+${e.amount ?? ''} AMMO` : '+TURBO', col: PICK[e.kind] ?? INK });
          }
          break;
        }
        case 'turbo': if (c) { for (let i = 0; i < 6; i++) fx.fire(c.x - Math.cos(c.a) * 2.4, c.y - Math.sin(c.a) * 2.4, 0.8); if (e.car === 0) H.flash.turbo = 1; } break;
        case 'lap': if (e.car === 0 && (e.lap ?? 0) > 0) H.placePop = Math.max(H.placePop, 0.4); break;
        case 'last': if (e.car === 0) { H.last = true; H.ban = { title: 'FINAL LAP', sub: null, col: HOT, t: 0, dur: 2.4 }; } break;
        case 'finish': if (e.car === 0) H.ban = { title: 'FINISHED', sub: `${ordinal(e.place ?? c?.place ?? 0)} PLACE`, col: (e.place ?? 9) === 1 ? GOLD : INK, t: 0, dur: 5 }; break;
        case 'low': if (e.car === 0) cam.red = 1; break;
      }
    }
  }
  const newMem = () => ({ w: null, smoke: 0, fire: 0, dust: 0, gun: 0 });

  // ---------- per-frame emitters: skids, tyre smoke, dust and spray, damage smoke and fire ----------
  function emit(s, dt, theme) {
    const cars = s.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i], m = mem[i] ?? (mem[i] = newMem()), sp = carSpec(c.model);
      const ca = Math.cos(c.a), sa = Math.sin(c.a), speed = Math.hypot(c.vx ?? 0, c.vy ?? 0);
      const wheels = sp.wheels.map(([x, y]) => [c.x + x * ca - y * sa, c.y + x * sa + y * ca]);
      const prev = m.w;
      m.w = wheels;
      if (c.dead) { // the hulk burns, then smoulders
        const burn = (c.deadT ?? 99) < 9;
        m.fire += dt * (burn ? 26 : 0); m.smoke += dt * (burn ? 10 : 4);
        while (m.fire > 1) { m.fire--; fx.fire(c.x + (Math.random() - 0.5) * 2, c.y + (Math.random() - 0.5) * 1.2, 1.2); }
        while (m.smoke > 1) { m.smoke--; fx.soot(c.x, c.y, burn ? 1 : 0.6); }
        continue;
      }
      if (!prev || Math.hypot(prev[0][0] - wheels[0][0], prev[0][1] - wheels[0][1]) > 4) continue;
      const surf = c.surface ?? 'asphalt', slip = clamp(c.slip ?? 0, 0, 1), braking = (c.brake ?? 0) > 0.5 && speed > 9;
      const offCol = theme === 'canyon' ? 'rgba(90,40,20,A)' : theme === 'pass' ? SURF_SKID.snow : null;
      const col = surf === 'off' ? offCol : SURF_SKID[surf];
      // marks: rubber when sliding or braking hard; ruts in dirt and snow whenever moving
      const soft = surf === 'dirt' || surf === 'snow' || (surf === 'off' && offCol);
      const mark = col && speed > 2 && (soft || slip > 0.22 || braking);
      if (mark) {
        const a = soft ? 0.16 + slip * 0.2 : clamp(0.1 + slip * 0.45 + (braking ? 0.15 : 0), 0, 0.5);
        const cs = col.replace('A', a.toFixed(2));
        for (let k = 0; k < 4; k++) {
          if (k < 2 && !soft && slip < 0.5) continue; // the rear pair marks first
          W.skid(prev[k][0], prev[k][1], wheels[k][0], wheels[k][1], sp.tyre * (soft ? 1.1 : 0.9), cs);
        }
      }
      // tyre smoke on tarmac, dust or spray off it
      const rear = [(wheels[2][0] + wheels[3][0]) / 2, (wheels[2][1] + wheels[3][1]) / 2];
      if ((surf === 'asphalt' || surf === 'oil') && (slip > 0.35 || (braking && slip > 0.15))) {
        m.smoke += dt * 40 * slip;
        while (m.smoke > 1) { m.smoke--; const w = wheels[2 + ((Math.random() * 2) | 0)]; fx.smoke(w[0], w[1], c.vx, c.vy, 0.5 + slip * 0.6); }
      }
      if (speed > 5) {
        const k = clamp(speed / 30, 0, 1);
        let rate = 0, kind = null;
        if (surf === 'dirt' || (surf === 'off' && theme === 'canyon')) { rate = 26 * k + slip * 20; kind = 'dust'; }
        else if (surf === 'snow' || (surf === 'off' && theme === 'pass')) { rate = 28 * k + slip * 16; kind = 'snow'; }
        else if (surf === 'water') { rate = 50 * k; kind = 'water'; }
        else if (surf === 'ice' && slip > 0.2) { rate = 14 * slip; kind = 'ice'; }
        else if (surf === 'off') { rate = 10 * k; kind = 'dust'; }
        else if (W.th.wet && speed > 14) { rate = 10 * k; kind = 'mist'; }
        m.dust += dt * rate * (demo() ? 0.5 : 1);
        while (m.dust > 1) {
          m.dust--;
          const w = wheels[2 + ((Math.random() * 2) | 0)];
          if (kind === 'dust') fx.dust(w[0], w[1], c.vx, c.vy, 0.6 + slip * 0.4);
          else if (kind === 'snow') { fx.spray(w[0], w[1], c.vx, c.vy, 1, '#ffffff'); if (Math.random() < 0.4) fx.dust(w[0], w[1], c.vx, c.vy, 0.6, '#eef4fa'); }
          else if (kind === 'water') fx.spray(w[0], w[1], c.vx, c.vy, 1, '#cfdceb');
          else if (kind === 'ice') fx.spray(w[0], w[1], c.vx, c.vy, 0.7, '#f4fbff');
          else if (kind === 'mist') fx.add('steam', rear[0], rear[1], -c.vx * 0.1, -c.vy * 0.1, 0.5, 0.5, { grow: 2, a: 0.12, drag: 2 });
        }
      }
      // damage: grey smoke below half armour, black with fire under a fifth
      const q = clamp((c.hp ?? 1) / (c.maxHp || 1), 0, 1), front = [c.x + ca * sp.L * 0.3, c.y + sa * sp.L * 0.3];
      if (q < 0.5) {
        m.smoke += dt * (q < 0.2 ? 22 : 6 + (0.5 - q) * 30);
        while (m.smoke > 1) { m.smoke--; if (q < 0.25) fx.soot(front[0], front[1], 0.8); else fx.smoke(front[0], front[1], c.vx, c.vy, 0.7); }
      }
      if (q < 0.2) { m.fire += dt * 16; while (m.fire > 1) { m.fire--; fx.fire(front[0], front[1], 0.6); } }
      if ((c.boost ?? 0) > 0) { m.fire += dt * 30; while (m.fire > 1) { m.fire--; const p = sp.pipe[(Math.random() * sp.pipe.length) | 0]; fx.fire(c.x + p[0] * ca - p[1] * sa - ca * 0.3, c.y + p[0] * sa + p[1] * ca - sa * 0.3, 0.45); } }
    }
  }

  // ---------- the race view ----------
  let lastT = performance.now();
  function view(s, frozen, dt) {
    const me = s.cars[0], { cw, ch, u } = ui, P0 = cw / VIEW;
    if (me && Math.hypot(me.x - cam.x, me.y - cam.y) > 60) { cam.x = me.x; cam.y = me.y; } // after a jump (a fast-forward)
    if (me && !frozen) {
      const vx = me.vx ?? 0, vy = me.vy ?? 0, sp = Math.hypot(vx, vy), lead = Math.min(1, 16 / Math.max(1, sp * 0.55));
      const tx = me.x + vx * 0.55 * lead, ty = me.y + vy * 0.55 * lead, e = 1 - Math.exp(-dt * 3.6);
      cam.x += (tx - cam.x) * e; cam.y += (ty - cam.y) * e;
      const z = 1 + 0.22 * clamp((sp - 10) / 32, 0, 1);
      cam.z += (z - cam.z) * (1 - Math.exp(-dt * 1.2));
    }
    const k = cam.shake * cam.shake * 2.2 + cam.shake * 0.4;
    const sx = frozen ? 0 : (Math.random() - 0.5) * k * 60 * u, sy = frozen ? 0 : (Math.random() - 0.5) * k * 60 * u;
    return { x: cam.x, y: cam.y, P: P0 / cam.z, cw, ch, sx, sy, u, vx: me?.vx ?? 0, vy: me?.vy ?? 0 };
  }

  function drawPickup(p, X, Y, P, t) {
    const col = PICK[p.kind] ?? INK, bob = Math.sin(t * 3 + X * 0.01) * 0.12 * P, r = 0.75 * P;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(X + 0.3 * P, Y + 0.45 * P, r, r * 0.8, 0, 0, TAU); g.fill();
    // a pulse ring on the road
    const q = (t * 1.2 + X * 0.003) % 1;
    g.strokeStyle = alpha(col, 0.6 * (1 - q)); g.lineWidth = 0.12 * P; g.beginPath(); g.arc(X, Y, r * (1 + q * 1.6), 0, TAU); g.stroke();
    g.globalCompositeOperation = 'lighter'; g.fillStyle = alpha(col, 0.22); g.beginPath(); g.arc(X, Y - bob, r * 1.6, 0, TAU); g.fill(); g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#141110'; g.beginPath(); g.roundRect(X - r, Y - r - bob, r * 2, r * 2, r * 0.35); g.fill();
    g.strokeStyle = col; g.lineWidth = 0.12 * P; g.stroke();
    const s = r * 1.1, ix = X - s * 0.4, iy = Y - bob;
    if (p.kind === 'repair') { g.fillStyle = col; g.fillRect(X - r * 0.55, iy - r * 0.16, r * 1.1, r * 0.32); g.fillRect(X - r * 0.16, iy - r * 0.55, r * 0.32, r * 1.1); }
    else if (p.kind === 'ammo') icon(ui, 'ammo', X - s * 0.42, iy + s * 0.05, s, col);
    else if (p.kind === 'turbo') icon(ui, 'turbo', X - s * 0.38, iy, s, col);
    else { g.font = `700 ${Math.round(r * 1.5)}px ${UI}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText('$', X, iy + r * 0.05); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; }
    void ix;
  }
  function drawMine(m, X, Y, P, t) {
    const r = 0.42 * P;
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.arc(X + 0.12 * P, Y + 0.16 * P, r * 1.1, 0, TAU); g.fill();
    g.fillStyle = '#2c2e30'; g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill();
    g.fillStyle = '#4a4e52'; g.beginPath(); g.arc(X - r * 0.2, Y - r * 0.2, r * 0.55, 0, TAU); g.fill();
    g.fillStyle = '#1a1b1c'; for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; g.beginPath(); g.arc(X + Math.cos(a) * r * 0.8, Y + Math.sin(a) * r * 0.8, r * 0.14, 0, TAU); g.fill(); }
    const on = m.armed ? Math.sin(t * 22 + X) > 0 : Math.sin(t * 6 + X) > 0.6;
    if (on) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = m.armed ? 'rgba(255,40,30,0.35)' : 'rgba(255,150,40,0.25)'; g.beginPath(); g.arc(X, Y, r * 2.2, 0, TAU); g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    g.fillStyle = on ? (m.armed ? '#ff4a30' : '#ffb040') : '#5a1a14'; g.beginPath(); g.arc(X, Y, r * 0.22, 0, TAU); g.fill();
  }

  function drawRace(app, race, dt, frozen) {
    ensure(race);
    const s = race.s, t = s.t ?? app.t ?? 0, { cw, ch, u } = ui;
    if (!W) return;
    drawnAt = s.t;
    if (!frozen) {
      emit(s, dt, W.theme);
      fx.step(dt);
      cam.shake = Math.max(0, cam.shake - dt * 1.8); cam.flash = Math.max(0, cam.flash - dt * 2.5); cam.red = Math.max(0, cam.red - dt * 1.6);
      H.placePop = Math.max(0, H.placePop - dt * 2.5);
      for (const k in H.flash) H.flash[k] = Math.max(0, H.flash[k] - dt * 2.2);
      if (H.ban) { H.ban.t += dt; if (H.ban.t > H.ban.dur) H.ban = null; }
      for (const p of pops) p.t += dt;
      while (pops.length && pops[0].t > 1.4) pops.shift();
    }
    const me = s.cars[0];
    if (me && me.place !== H.prevPlace) { if (H.prevPlace && me.place < H.prevPlace) H.placePop = 1; H.prevPlace = me.place; }
    // the race clock: the sim's, else counted here from the start
    if (s.status === 'grid') H.raceT = 0;
    else if (me && !me.done && !me.dead && !frozen) H.raceT = s.raceT ?? H.raceT + dt;
    const v = view(s, frozen, dt), P = v.P;
    const X = x => (x - v.x) * P + cw / 2 + v.sx, Y = y => (y - v.y) * P + ch / 2 + v.sy;
    g.setTransform(1, 0, 0, 1, 0, 0);
    W.draw(g, v, demo() ? 3 : 5);
    const hw = cw / P / 2 + 6, hh = ch / P / 2 + 6, inView = (x, y) => Math.abs(x - v.x) < hw && Math.abs(y - v.y) < hh;
    for (const p of s.pickups ?? []) if (p.on !== false && inView(p.x, p.y)) drawPickup(p, X(p.x), Y(p.y), P, t);
    for (const m of s.mines ?? []) if (inView(m.x, m.y)) drawMine(m, X(m.x), Y(m.y), P, t);
    fx.draw(g, v, 0);
    // the cars: hulks first, the player on top
    const night = W.th.light > 0;
    const order = s.cars.map((c, i) => i).sort((a, b) => (s.cars[b].dead ? 1 : 0) - (s.cars[a].dead ? 1 : 0) || (a === 0 ? 1 : b === 0 ? -1 : 0));
    for (const i of order) {
      const c = s.cars[i];
      if (!inView(c.x, c.y)) continue;
      drawCar(g, c.model, c.colour ?? '#888888', X(c.x), Y(c.y), c.a ?? 0, P, {
        damage: 1 - clamp((c.hp ?? 1) / (c.maxHp || 1), 0, 1), wreck: !!c.dead, steer: c.steer ?? 0,
        brake: !c.dead && (c.brake ?? 0) > 0.1, boost: !c.dead && (c.boost ?? 0) > 0, lights: night,
        flash: c.hitT != null && c.hitT < 0.12 ? 1 - c.hitT / 0.12 : 0, t, shadowAlpha: night ? 0.35 : 0.5,
      });
    }
    // tracers: a hot streak behind each bullet
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (const b of s.shots ?? []) {
      if (!inView(b.x, b.y)) continue;
      const x1 = X(b.x), y1 = Y(b.y), x0 = X(b.x - (b.vx ?? 0) * 0.03), y0 = Y(b.y - (b.vy ?? 0) * 0.03);
      g.strokeStyle = 'rgba(255,140,40,0.35)'; g.lineWidth = 0.22 * P; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      g.strokeStyle = 'rgba(255,240,190,0.95)'; g.lineWidth = 0.07 * P; g.beginPath(); g.moveTo((x0 + x1 * 2) / 3, (y0 + y1 * 2) / 3); g.lineTo(x1, y1); g.stroke();
    }
    g.globalCompositeOperation = 'source-over'; g.lineCap = 'butt';
    fx.draw(g, v, 1);
    if (night) for (const c of s.cars) if (!c.dead && inView(c.x, c.y)) drawBeams(g, c.model, X(c.x), Y(c.y), c.a ?? 0, P, 1);
    W.tops(g, v, t);
    g.setTransform(1, 0, 0, 1, 0, 0);
    weather?.draw(g, v, frozen ? 0 : dt, t);
    if (!graded || graded.width !== cw) graded = grade(W.theme, cw, ch);
    g.drawImage(graded, 0, 0);
    // hurt: red at the edges, pulsing while the armour is low
    const low = me && !me.dead && (me.hp ?? 1) / (me.maxHp || 1) < 0.25 ? 0.35 + 0.25 * Math.sin(t * 7) : 0;
    const red = Math.max(cam.red * 0.6, low);
    if (red > 0.02 && !app.demo) {
      const gr = g.createRadialGradient(cw / 2, ch / 2, ch * 0.55, cw / 2, ch / 2, cw * 0.6);
      gr.addColorStop(0, 'rgba(200,20,10,0)'); gr.addColorStop(1, `rgba(200,20,10,${red * 0.45})`);
      g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
    }
    if (cam.flash > 0) { g.fillStyle = `rgba(255,236,200,${cam.flash * 0.5})`; g.fillRect(0, 0, cw, ch); }

    // ---------- the HUD ----------
    if (!app.demo) tags(ui, race, (x, y) => [X(x), Y(y)]);
    for (const p of pops) { const a = clamp(1.4 - p.t, 0, 1); g.globalAlpha = a; text(ui, p.s, X(p.x), Y(p.y) - 60 * u - p.t * 70 * u, 30, p.col, { font: UI, wgt: 700, align: 'center' }); g.globalAlpha = 1; }
    if (!H.mini && W) H.mini = W.miniMap(Math.round(300 * u));
    drawHud(ui, app, race, H, t);
    if (s.status === 'grid' && H.count > 0) countdown(ui, String(H.count), s.t - H.countT, H.count === 1 ? GOLD : H.count === 2 ? HOT : RED);
    else if (s.t - H.goT < 1) countdown(ui, 'GO!', s.t - H.goT, GREEN);
    if (!app.demo) {
      if (H.ban) banner(ui, H.ban.title, H.ban.sub, Math.min(H.ban.t * 4, (H.ban.dur - H.ban.t) * 2.5, 1), H.ban.col);
      else if (me?.dead && s.status !== 'done') banner(ui, 'WRECKED', 'OUT OF THE RACE', 0.85, RED);
    }
    drawTouch(ui, app);
  }

  // ---------- frame ----------
  function draw(app) {
    lastApp = app;
    const now = performance.now(), dt = Math.min(1 / 20, (now - lastT) / 1000);
    lastT = now;
    const st = app.state, race = app.race;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (race && (RACE_STATES.has(st) || (app.demo && st !== 'title'))) {
      drawRace(app, race, dt, st === 'pause');
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (st === 'pause') drawScreen(g, app, ui);
    } else {
      if (R && !race) setRace(null);
      drawScreen(g, app, ui);
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    if (app.fade > 0) { g.fillStyle = `rgba(8,6,6,${app.fade})`; g.fillRect(0, 0, ui.cw, ui.ch); }
  }
  /** what a tap at (x, y) in canvas pixels lands on: the screens' business */
  const menuAt = (x, y) => screenMenuAt(lastApp, x, y, ui);
  function destroy() { destroyed = true; unfit(); worlds.clear(); fx.clear(); }
  return { draw, events, menuAt, destroy, get stats() { return { chunks: W?.chunkCount ?? 0, fx: fx.count }; } };
}
