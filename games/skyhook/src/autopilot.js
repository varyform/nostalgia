'use strict';
// SKYHOOK attract-mode autopilot, shared by both versions (same world units and physics).
// Each fixed step it reads the live world and returns the inputs a player would hold:
// follow the terrain, shoot what is in line, bomb what a bomb would hit, break through
// brick walls, land by waiting agents and on unvisited pads. Simple over clever: the
// game's own lives and the preview's watchdog cover whatever it gets wrong.
//
// `w` is a live view of the game: { W, FL(x), CE(x), lv, p, camX, fuel, bombs, ebul } (getters).

const GROUND = { gun: 1, tank: 1, rocket: 1, fuel: 1, radar: 1, hut: 1 };
const CRUISE = 95; // px/s, under the 125 top speed so there is room to slow down
const MARGIN = 4; // px kept from terrain
const NONE = { left: false, right: false, up: false, down: false, fire: false, bomb: false };
const ov = (ax, ay, aw, ah, bx, by, bw, bh) => ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// agents a stray bullet or blast would kill
const loose = s => s.state === 'wait' || s.state === 'run';

export function createPilot(w) {
  let t = 0, me = null, tried = new WeakSet(), ignored = new WeakSet();
  let goal = null, goalT = 0, landing = false, foe = null, foeT = 0, bombed = null, bombT = -9;

  // a flat, clear 23 px strip to set down on (p.x = x), near an agent
  function spotOk(x) {
    const { FL, CE, lv } = w, g0 = FL(x + 11);
    if (x + 24 >= lv.L) return false;
    for (let i = x - 1; i <= x + 21; i++) {
      const f = FL(i);
      if (f < g0 || f > g0 + 1 || CE(i) > g0 - 22) return false;
    }
    for (const e of lv.enemies) if (!e.dead && ov(x - 2, g0 - 12, 24, 12, e.x, e.y, e.w, e.h)) return false;
    for (const k of lv.bricks) if (!k.dead && ov(x - 2, g0 - 12, 24, 12, k.x, k.y, 8, 8)) return false;
    return true;
  }
  function spotNear(s) {
    const x0 = Math.round(s.x) - 4;
    for (let d = 0; d <= 50; d++)
      for (const x of [x0 + d, x0 - d]) if (x > w.camX + 4 && spotOk(x)) return x;
    return null;
  }
  // nearest of: unvisited pad, waiting agent (while there is room aboard)
  function pickGoal() {
    const { lv, p, camX, FL } = w;
    let best = null;
    const consider = (x, y, ref) => {
      if (x > camX + 4 && x < p.x + 450 && (!best || x < best.x)) best = { x, y, ref };
    };
    for (const pd of lv.pads) if (!pd.visited && !tried.has(pd)) consider(pd.x + pd.w / 2 - 11, pd.y, pd);
    if (p.aboard.length < 4)
      for (const s of lv.spies) {
        if (s.state !== 'wait' || tried.has(s) || s.x < camX || s.x > p.x + 450) continue;
        const x = spotNear(s);
        if (x === null) tried.add(s);
        else consider(x, FL(x + 11), s);
      }
    return best;
  }
  const goalValid = gl =>
    gl.x > w.camX + 3 && ('visited' in gl.ref ? !gl.ref.visited : gl.ref.state === 'wait' && w.p.aboard.length < 4);

  function liftOff() {
    const { lv, p } = w, pd = p.pad, running = lv.spies.some(s => s.state === 'run');
    if (pd && pd.t === 'hq') return p.landT > 12; // the mission clears by itself
    if (pd) return p.landT > 9 || (p.landT > 0.8 && !p.aboard.length && !running && w.fuel >= 97);
    return p.landT > 7 || (p.landT > 0.9 && !running);
  }

  // where a bomb dropped now would burst, and what it would hit
  function dropPoint(enemies) {
    const { p, FL, CE } = w;
    let x = p.x + 9, y = p.y + 9, vx = p.vx * 0.85, vy = 15 + Math.max(0, p.vy) * 0.5;
    const near = enemies.filter(e => e.x + e.w > x - 10 && e.x < x + 220);
    for (let i = 0; i < 180; i++) {
      vy += 170 / 60; x += vx / 60; y += vy / 60;
      if (y + 2 >= FL(x) || y < CE(x)) return { x, y, e: null };
      for (const e of near) if (ov(x - 1, y - 2, 3, 4, e.x, e.y, e.w, e.h)) return { x, y, e };
    }
    return null;
  }

  // Would these inputs, held for `hold` steps and then let go, fly us into an enemy bullet, a jet,
  // a balloon or the terrain (the ground not, when `touchdown`) within 0.75 s? Same steering model as
  // updatePlayer(); bullets fly straight and stop at terrain, jets keep their course.
  function hits(I, hold, enemies, touchdown) {
    const { p, FL, CE, ebul, lv } = w;
    const bs = ebul.map(b => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, dead: false }));
    const jets = enemies.filter(e => e.t === 'jet' && e.x > p.x - 30 && e.x < p.x + 260);
    const balloons = enemies.filter(e => e.t === 'balloon' && e.x > p.x - 20 && e.x < p.x + 120);
    if (!bs.length && !jets.length && !balloons.length) return false;
    let x = p.x, y = p.y, vx = p.vx, vy = p.vy;
    const dt = 1 / 60;
    for (let k = 0; k < 45; k++) {
      const on = k < hold, tx = on && I.right ? 125 : on && I.left ? -60 : 0;
      const flare = Math.min(FL(x + 6), FL(x + 11), FL(x + 16)) - (y + 8) < 18;
      const ty = on && I.down ? (flare ? 40 : 78) : on && I.up ? -78 : 0;
      vx = vx < tx ? Math.min(tx, vx + 150 * dt) : Math.max(tx, vx - 150 * dt);
      vy = vy < ty ? Math.min(ty, vy + 200 * dt) : Math.max(ty, vy - 200 * dt);
      x += vx * dt; y = Math.max(1, y + vy * dt);
      for (const i of [1, 6, 11, 16, 18]) if (CE(x + i) > y - 1 || (!touchdown && FL(x + i) < y + 9)) return true;
      for (const b of bs) {
        if (b.dead) continue;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y >= FL(b.x) || b.y < CE(b.x) || b.x < 0 || b.x >= lv.L) { b.dead = true; continue; }
        if (ov(b.x - 2.5, b.y - 2.5, 5, 5, x + 2, y + 1, 16, 7)) return true;
      }
      const s = (k + 1) * dt;
      for (const e of jets) if (ov(e.x - 100 * s - 1, e.by + Math.sin(e.ph + 2.4 * s) * e.amp - 2, 14, 9, x + 2, y + 1, 16, 7)) return true;
      for (const e of balloons)
        if (ov(e.x - 1, e.y - 4, 14, 12, x + 2, y + 1, 16, 7) || ov(e.x + 5, e.y + 5, 3, 300, x + 2, y + 1, 16, 7)) return true;
    }
    return false;
  }
  // keep the planned inputs if they are safe, else the nearest safe alternative
  function dodge(I, enemies, landing) {
    if (!hits(I, 12, enemies, landing)) return;
    const hs = [[I.left, I.right], [false, false], [false, true], [true, false]];
    const vs = [[I.up, I.down], [true, false], [false, false], [false, true]];
    for (const hold of [12, 24, 6])
      for (const [left, right] of hs)
        for (const [up, down] of vs) {
          const J = { ...I, left, right, up, down };
          if (!hits(J, hold, enemies, false)) { Object.assign(I, J); return; }
        }
  }

  return function step(dt) {
    const { lv, p, FL, CE, W, camX } = w;
    t += dt;
    if (!p || !p.alive) return NONE;
    if (p !== me) { me = p; tried = new WeakSet(); goal = null; foe = null; landing = false; } // a fresh chopper
    const I = { ...NONE };
    if (p.landed) {
      if (goal && Math.abs(goal.x - p.x) < 6) tried.add(goal.ref);
      goal = null; landing = false;
      I.up = liftOff();
      return I;
    }
    const nose = p.x + 19;
    const enemies = lv.enemies.filter(e => !e.dead && e.x + e.w > camX - 10 && e.x < camX + W + 40);

    // ---- goal
    goalT -= dt;
    if (goal && !goalValid(goal)) { goal = null; landing = false; }
    if (!goal || (goalT <= 0 && Math.abs(goal.x - p.x) > 150)) { goal = pickGoal(); goalT = 0.5; }

    // ---- terrain corridor: ground, ceiling, standing enemies, balloon cables, mines we gave up on
    const obst = [];
    for (const e of enemies) {
      if (GROUND[e.t] && !e.fly) obst.push({ x0: e.x - 2, x1: e.x + e.w + 2, fl: e.y, ce: -1e9 });
      else if (e.t === 'balloon') obst.push({ x0: e.x - 3, x1: e.x + 15, fl: e.y - 4, ce: -1e9 });
      else if (e.t === 'mine' && ignored.has(e)) {
        const top = e.by - e.amp, bot = e.by + e.amp + 7;
        if (top - CE(e.x) > FL(e.x) - bot) obst.push({ x0: e.x - 4, x1: e.x + 11, fl: top - 2, ce: -1e9 });
        else obst.push({ x0: e.x - 4, x1: e.x + 11, fl: 1e9, ce: bot + 2 });
      }
    }
    const floorAt = x => { let f = FL(x); for (const o of obst) if (x >= o.x0 && x <= o.x1 && o.fl < f) f = o.fl; return f; };
    const ceilAt = x => { let c = CE(x); for (const o of obst) if (x >= o.x0 && x <= o.x1 && o.ce > c) c = o.ce; return c; };
    let end = p.x + 62 + Math.max(0, p.vx) * 0.9;
    if (goal) end = Math.min(end, Math.max(p.x + 22, goal.x + 22));
    let hiL = 1e9, loL = -1e9, hi = 1e9, lo = -1e9, cap = CRUISE;
    for (let x = Math.floor(p.x) - 1; x <= end; x++) {
      const f = floorAt(x) - 8 - MARGIN, c = ceilAt(x) + MARGIN;
      if (x <= p.x + 21) { hiL = Math.min(hiL, f); loL = Math.max(loL, c); }
      hi = Math.min(hi, f); lo = Math.max(lo, c);
      const d = x - nose, need = Math.max(p.y - f, c - p.y);
      // slow down so the climb (or dive) is done before we get there
      if (d > 0 && need > 0) cap = Math.min(cap, Math.max(10, d / (need / 55 + 0.15)));
    }
    let yT = lv.hasCeil ? (lo + hi) / 2 : Math.max(14, hi - 14), vxD = cap, aim = false;

    // ---- landing approach
    if (goal) {
      const dx = goal.x - p.x;
      vxD = Math.min(vxD, Math.abs(dx) < 1 ? 0 : Math.sign(dx) * clamp(Math.abs(dx) * 1.6, 8, dx < 0 ? 45 : CRUISE));
      if (landing ? Math.abs(dx) > 5 || Math.abs(p.vx) > 30 : Math.abs(dx) < 2.5 && Math.abs(p.vx) < 12) landing = !landing;
    } else landing = false;

    // ---- brick wall ahead: fly through a hole, or hold off and shoot one
    const wall = lv.bricks.filter(k => !k.dead && k.x + 8 > p.x && k.x < nose + 160);
    const wx = wall.length ? Math.min(...wall.map(k => k.x)) : 0;
    if (wall.length && (!goal || wx < goal.x)) {
      landing = false;
      const alive = new Set(wall.filter(k => k.x < wx + 16).map(k => k.y));
      const bot = FL(wx + 8), top = CE(wx + 4), rows = [];
      for (let by = bot - 8; by + 8 > top; by -= 8) rows.push(by); // bottom up
      let pass = null;
      for (let i = 0; i < rows.length; i++) {
        if (alive.has(rows[i])) continue;
        let j = i;
        while (j + 1 < rows.length && !alive.has(rows[j + 1])) j++;
        const yMin = Math.max(rows[j] - 1, top + 2), yMax = Math.min(rows[i], bot - 10);
        if (yMax - yMin >= 4 && (!pass || yMax - yMin > pass.yMax - pass.yMin)) pass = { yMin, yMax };
        i = j;
      }
      if (pass) {
        yT = (pass.yMin + pass.yMax) / 2;
        vxD = Math.min(vxD, wx - nose > 30 || Math.abs(p.y - yT) < 2.5 ? 45 : 0);
      } else {
        // break the two rows nearest the middle of the passage
        const mid = (top + bot) / 2;
        let i = 0;
        for (let k = 0; k + 1 < rows.length; k++) if (Math.abs(rows[k] - mid) < Math.abs(rows[i] - mid)) i = k;
        const row = alive.has(rows[i]) ? rows[i] : rows[Math.min(i + 1, rows.length - 1)];
        yT = row - 1;
        aim = Math.abs(p.y + 5 - (row + 4)) < 3;
        vxD = Math.min(cap, clamp((wx - nose - 28) * 2, -40, 50));
      }
    } else if (!landing) {
      // ---- mines, balloons and jets ahead: line up and shoot
      let f = null, fd = 1e9;
      for (const e of enemies) {
        if (ignored.has(e)) continue;
        const dx = e.x - nose;
        if ((e.t === 'mine' || e.t === 'balloon') && dx > -6 && dx < 120 && dx < fd) { f = e; fd = dx; }
        else if (e.t === 'jet' && dx > 12 && dx < 220 && dx < fd) { f = e; fd = dx; }
      }
      if (f !== foe) { foe = f; foeT = 0; }
      if (foe) {
        foeT += dt;
        if (foeT > 3.5) ignored.add(foe); // give up: fly around it (balloons, mines) or ignore it
        yT = foe.y + foe.h / 2 - 5;
        if (foe.t !== 'jet') vxD = Math.min(vxD, fd > 70 ? 55 : fd > 40 ? 0 : -25);
      }
    }
    // a launched rocket ahead: let it go by
    for (const e of enemies) {
      if (e.t !== 'rocket') continue;
      if (e.fly && e.x > p.x + 14 && e.x < nose + 60 && e.y + 10 > p.y - 6) vxD = Math.min(vxD, -10);
      else if (!e.fly && e.x > nose && e.x < nose + 130) vxD = Math.min(vxD, 70);
    }

    // ---- fly
    if (landing) yT = goal.y - 5; // into the ground: the skids stop us
    else yT = loL > hiL ? (loL + hiL) / 2 : clamp(yT, loL, hiL);
    let vyD = clamp((yT - p.y) * 3, -70, 70);
    if (landing) vyD = clamp((goal.y - 8 - p.y) * 2, 12, 60); // touchdown under 52, the auto-flare helps
    I.up = vyD < p.vy - 5; I.down = vyD > p.vy + 5;
    const db = Math.abs(vxD) < 15 ? 2 : 6;
    I.right = vxD > p.vx + db; I.left = vxD < p.vx - db;
    dodge(I, enemies, landing);

    // ---- guns: whatever is in line, in bursts otherwise; never with an agent in the way
    const by = p.y + 5, inLine = (y0, h) => by > y0 - 2 && by < y0 + h + 1; // a bullet hits from y0 - 1
    const spyInLine = lv.spies.some(s => loose(s) && s.x + 6 > nose - 4 && s.x < nose + W + 60 && inLine(s.y, 8));
    const target = aim || enemies.some(e => e.t !== 'hut' && e.x + e.w > nose && e.x < nose + 240 && inLine(e.y, e.h));
    I.fire = !spyInLine && (target || t % 2.4 < 0.8);

    // ---- bombs: when the burst would destroy a ground target and spare every agent (a hut's
    // captive too: the blast that opens the hut would get them as well), one bomb per target
    if (!landing && p.bombCd <= 0 && w.bombs.length < 2) {
      const hit = dropPoint(enemies);
      if (hit) {
        const y = Math.min(hit.y, FL(hit.x) - 1);
        const box = e => Math.hypot(Math.max(e.x - hit.x, 0, hit.x - (e.x + e.w)), Math.max(e.y - y, 0, y - (e.y + e.h)));
        const target = enemies.find(e => GROUND[e.t] && !e.fly && box(e) < 14 && !(e === bombed && t - bombT < 1.6));
        const safe = !lv.spies.some(s => (loose(s) || s.state === 'caged') && Math.hypot(s.x + 3 - hit.x, s.y + 4 - y) < 12.5);
        if (target && safe) { I.bomb = true; bombed = target; bombT = t; }
      }
    }
    return I;
  };
}
