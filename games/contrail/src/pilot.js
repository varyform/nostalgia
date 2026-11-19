// The autopilot: flies the player's jet through a mission with the same controls a player
// has (stick, rudder, throttle, triggers), for the attract demo and the verify tool. Above a
// heading-and-climb autopilot (bank toward the heading wanted, pitch to the climb angle
// wanted, with ground avoidance on top) it picks what to do: break and drop decoys when a
// missile closes, dogfight the nearest fighter, run in on the nearest ground objective with
// rockets, bombs or the gun, or shadow the courier, and climbs away to come round again.
//
//   const pilot = createPilot(sim, { sloppy: 0.3, seed });
//   sim.step(pilot());
//
// `sloppy` (0 sharp … 1) adds reaction time, aim wobble and missed decoys: the demo flies
// with some, so it sometimes loses.
import { DT, GUN_RANGE, IR_RANGE, KINDS, WEAPONS, bankOf, cross, dist, dot, headingOf, mul, norm, predictBomb, sub } from './sim.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
// toward (x, z) on the map, climbing at `slope` (rise over run)
const toward = (P, x, z, slope) => { const dx = x - P.pos[0], dz = z - P.pos[2], L = Math.hypot(dx, dz) || 1; return norm([dx / L, slope, dz / L]); };

export function createPilot(sim, { sloppy = 0, seed = 1 } = {}) {
  let s = seed | 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  let modeT = 0, lastDecoy = -9, run = null, wob = [0, 0], wobT = 0, lastTarget = null;
  const decoyed = new WeakMap();

  // stick, rudder and pitch to fly toward a direction (and how hard)
  function fly(P, d, { maxBank = 1.25, maxClimb = 0.55, fine = true, pursuit = false } = {}) {
    const f = P.f, bank = bankOf(f, P.u), hdg = headingOf(f), want = headingOf(d);
    if (pursuit && Math.acos(clamp(dot(f, d), -1, 1)) > 0.1) {
      // roll the target into the lift line, then pull it onto the nose
      const r = cross(f, P.u), lx = dot(d, r), ly = dot(d, P.u), lz = dot(d, f);
      let re = Math.atan2(lx, ly);
      if (Math.abs(bank + re) > 1.9) re = clamp(re, -0.3, 0.3); // don't roll past the vertical
      const pull = Math.atan2(Math.hypot(lx, ly) * Math.sign(ly + 0.2), lz);
      return { roll: clamp(re * 3, -1, 1), pitch: clamp(pull * 3 * clamp(Math.cos(re) * 1.6, 0, 1), -0.3, 1), yaw: clamp(lx * 4, -1, 1) };
    }
    const eh = wrap(want - hdg);
    const gamma = Math.asin(clamp(f[1], -1, 1)), gd = clamp(Math.asin(clamp(d[1], -1, 1)), -maxClimb, maxClimb);
    const ang = Math.acos(clamp(dot(f, d), -1, 1));
    let bankD = clamp(eh * 2.4, -maxBank, maxBank);
    if (ang < 0.12 && fine) bankD *= 0.5;
    const roll = clamp((bankD - bank) * 2.8, -1, 1);
    let pitch = ((gd - gamma) * 3.2) / Math.max(0.35, Math.cos(bank));
    pitch += Math.min(1, Math.abs(eh) * 1.2) * Math.abs(Math.sin(bank)) * 0.9; // pull through the turn
    let yaw = 0;
    if (ang < 0.12 && fine) {
      // the last degrees: rudder and stick straight onto it
      const r = cross(f, P.u), lx = dot(d, r), ly = dot(d, P.u);
      yaw = clamp(lx * 25, -1, 1);
      pitch = clamp(ly * 25, -1, 1);
    }
    return { pitch: clamp(pitch, -1, 1), roll, yaw };
  }

  // the ground ahead, and the climb it needs
  function terrain(P, W, clearance, horizon = 4.5) {
    let need = -1;
    const fh = norm([P.f[0], 0, P.f[2]]);
    for (const k of [0.6, 1.2, 1.8, 3, 4.5]) {
      if (k > horizon) break;
      const x = P.pos[0] + fh[0] * P.speed * k, z = P.pos[2] + fh[2] * P.speed * k;
      const y = P.pos[1] + P.f[1] * P.speed * k;
      need = Math.max(need, W.heightAt(x, z) + clearance - y);
    }
    return need;
  }

  function threatMissile(P) {
    let best = null, bd = 3200;
    for (const m of sim.missiles) if (m.tgt === P) { const d = dist(m.pos, P.pos); if (d < bd) { bd = d; best = m; } }
    return best;
  }

  function choose(P) {
    const M = sim.mission, alive = sim.actors.filter(a => a.alive && a.team === 'red');
    const air = alive.filter(a => a.air);
    // fighters near us come first
    const near = air.filter(a => a.kind !== 'bomber' && dist(a.pos, P.pos) < 4500).sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos));
    if (M.goal === 'escort') {
      const c = sim.actors.find(a => a.kind === 'courier');
      const raiders = air.filter(a => c && dist(a.pos, c.pos) < 7000).sort((a, b) => dist(a.pos, c.pos) - dist(b.pos, c.pos));
      if (raiders.length) return { kind: 'air', T: raiders[0] };
      if (near.length) return { kind: 'air', T: near[0] };
      return { kind: 'escort', T: c };
    }
    const close = M.goal === 'intercept' ? near.filter(a => dist(a.pos, P.pos) < 1600) : near;
    if (close.length && close[0].kind !== 'bomber') return { kind: 'air', T: close[0] };
    // a SAM battery that has us on its radar, close: take it out first
    if (P.stores.rockets > 0 || P.stores.bombs > 0) {
      const sam = alive.filter(a => a.kind === 'sam' && (a.lockT > 0 || dist(a.pos, P.pos) < 5000) && dist(a.pos, P.pos) < 8500).sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos))[0];
      if (sam && M.goal !== 'intercept') return { kind: 'ground', T: sam };
    }
    // stay on the ground target being worked on
    if (run?.T?.alive && !run.T.air && (run.T.obj || run.T.kind === 'sam')) return { kind: 'ground', T: run.T };
    const objs = alive.filter(a => a.obj).sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos));
    if (objs.length) return { kind: objs[0].air ? 'air' : 'ground', T: objs[0] };
    if (air.length) return { kind: 'air', T: air.sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos))[0] };
    // done: home to the runway (the demo ends first)
    return { kind: 'home' };
  }

  function weaponFor(P, kind, T) {
    const st = P.stores;
    if (kind === 'air') {
      const D = dist(T.pos, P.pos);
      if (st.radar > 0 && D > 2600) return 'radar';
      if (st.ir > 0 && D > 500) return 'ir';
      return st.radar > 0 && D > 1200 ? 'radar' : 'gun';
    }
    const hard = KINDS[T.kind].hp >= 300;
    if (hard && st.bombs > 0) return 'bombs';
    if (st.rockets > 0) return 'rockets';
    if (st.bombs > 0) return 'bombs';
    return 'gun';
  }

  let lastJob = null, fight = { T: null, close: 0, extend: 0 };
  function step() {
    const P = sim.player, W = sim.world, out = { pitch: 0, roll: 0, yaw: 0, throttle: 0.92, gun: false, fire: false, weapon: false, decoy: false };
    if (!P.alive || sim.status !== 'fly') return out;
    modeT += DT;
    wobT -= DT;
    if (wobT <= 0) { wobT = 0.4 + rnd() * 0.6; wob = [(rnd() - 0.5) * sloppy * 0.06, (rnd() - 0.5) * sloppy * 0.06]; }
    const agl = P.pos[1] - W.heightAt(P.pos[0], P.pos[2]);
    let d = P.f, opts = {}, clearance = 320;

    // 1. a missile closing: decoys, burner, break across it
    const m = threatMissile(P);
    const job = choose(P);
    lastJob = job;
    if (m) {
      const D = dist(m.pos, P.pos);
      const seen = decoyed.get(m) ?? 0;
      if (((seen === 0 && D < 2600) || (seen === 1 && D < 1100)) && sim.t - lastDecoy > 0.6) {
        decoyed.set(m, seen + 1);
        if (rnd() > sloppy * 0.6) { out.decoy = true; lastDecoy = sim.t; }
      }
      if (D < 2600 && rnd() > sloppy * 0.25) {
        // a hard turn across its line of sight, kept up as the line swings
        const los = norm(sub(m.pos, P.pos)), side = norm(cross(los, [0, 1, 0]));
        const pick = dot(side, P.f) > 0 ? side : mul(side, -1);
        d = norm([pick[0] + los[0] * 0.3, agl > 1500 ? -0.2 : 0.05, pick[2] + los[2] * 0.3]);
        out.throttle = 1.2;
        opts = { pursuit: true };
        return finish(P, W, d, opts, 200, out, agl);
      }
    }

    if (job.kind === 'air') {
      const T = job.T, D = dist(T.pos, P.pos);
      // a turning fight going nowhere: extend away, then come back for a missile shot
      if (T === fight.T && D < 900) fight.close += DT; else if (T !== fight.T) fight = { T, close: 0, extend: 0 };
      if (fight.close > 12) { fight.close = 0; fight.extend = 6; }
      if (fight.extend > 0) {
        fight.extend -= DT;
        out.throttle = 1.2;
        return finish(P, W, norm([P.f[0], Math.max(0.05, Math.min(0.2, P.f[1])), P.f[2]]), { maxBank: 0.3 }, 300, out, agl);
      }
      if (T !== lastTarget) { lastTarget = T; out.targetId = T.id; }
      if (P.target !== T) out.targetId = T.id;
      const lead = clamp(D / 1300, 0, 1.4);
      const tv = T.vel ?? mul(T.f, T.speed), aim = [T.pos[0] + tv[0] * lead, T.pos[1] + tv[1] * lead, T.pos[2] + tv[2] * lead];
      d = norm(sub(aim, P.pos));
      d = norm([d[0] + wob[0], d[1] + wob[1], d[2]]);
      out.throttle = D > 3000 ? 1.2 : D < 700 && dot(P.f, T.f) > 0.5 ? 0.55 : 1;
      opts = { maxBank: 1.3, maxClimb: 0.7, pursuit: true };
      const w = weaponFor(P, 'air', T), ang = Math.acos(clamp(dot(P.f, norm(sub(aim, P.pos))), -1, 1));
      select(P, w, out);
      if (WEAPONS[P.sel] === 'ir' && P.irLock && D < IR_RANGE - 300 && D > 350) out.fire = modeT > 0.8 && rnd() > sloppy * 0.5;
      if (WEAPONS[P.sel] === 'radar' && P.radarLock === T && D > 1500) out.fire = modeT > 1.2;
      if (out.fire) modeT = 0;
      if (D < GUN_RANGE * 0.85 && ang < 0.05 + sloppy * 0.02) out.gun = true;
      clearance = 260;
    } else if (job.kind === 'ground') {
      const T = job.T;
      if (P.target !== T) out.targetId = T.id;
      const w = weaponFor(P, 'ground', T);
      select(P, w, out);
      const flat = Math.hypot(T.pos[0] - P.pos[0], T.pos[2] - P.pos[2]), D = dist(T.pos, P.pos);
      const tv = T.vel ?? [0, 0, 0], tof = D / (P.speed + 450);
      const tgtUp = [T.pos[0] + tv[0] * tof, T.pos[1] + 4 + tof * tof * 1.7, T.pos[2] + tv[2] * tof];
      if (!run || run.T !== T) run = { T, phase: 'approach', pairs: 0, leg: 'in' };
      if (run.phase === 'approach') {
        // come in at about 900 m over the target's ground
        const alt = T.pos[1] + (w === 'bombs' ? 750 : 1100), slope = clamp((alt - P.pos[1]) / 1800, -0.5, 0.5);
        const near = w === 'bombs' ? 4600 : 1900, far = w === 'bombs' ? 6500 : 2800;
        // too close to line up: run out first, then turn in
        if (run.leg === 'out') {
          d = toward(P, 2 * P.pos[0] - T.pos[0], 2 * P.pos[2] - T.pos[2], slope);
          if (flat > far * 0.95) run.leg = 'in';
        } else {
          d = toward(P, T.pos[0], T.pos[2], slope);
          const aligned = Math.abs(wrap(headingOf(d) - headingOf(P.f))) < 0.2;
          if (flat < near * 0.8 && !aligned) run.leg = 'out';
          else if (flat < far && aligned) run.phase = 'dive';
        }
        opts = { maxClimb: 0.45 };
        out.throttle = 0.95;
      } else if (run.phase === 'dive') {
        out.throttle = 0.7;
        if (w === 'bombs') {
          // a level run about 650 m over it; release as the impact point walks onto the target
          const hit = predictBomb(sim), ft = hit?.t ?? 11;
          const ax = T.pos[0] + tv[0] * ft, az = T.pos[2] + tv[2] * ft;
          d = toward(P, ax, az, clamp((T.pos[1] + 650 - P.pos[1]) / 1500, -0.25, 0.25));
          if (hit) {
            const fh = norm([P.f[0], 0, P.f[2]]), ex = hit.pos[0] - ax, ez = hit.pos[2] - az;
            const along = ex * fh[0] + ez * fh[2], side = Math.abs(ex * fh[2] - ez * fh[0]), R = KINDS[T.kind].r + (KINDS[T.kind].hl ?? 0) * 0.5;
            const want = Math.ceil(T.hp / 230);
            if (along > -R - 10 && side < R + 25 && modeT > 0.25 && (run.bombs ?? 0) < want) { out.fire = true; modeT = 0; run.bombs = (run.bombs ?? 0) + 1; }
            if (along > 260 || (run.bombs ?? 0) >= want) { run.phase = 'out'; run.bombs = 0; modeT = 0; }
          }
          if (agl < 160) { run.phase = 'out'; run.bombs = 0; modeT = 0; }
          opts = { maxClimb: 0.3, horizon: 3 };
          clearance = 120;
        } else {
          d = norm(sub(tgtUp, P.pos));
          d = norm([d[0] + wob[0], d[1] + wob[1], d[2]]);
          const ang = Math.acos(clamp(dot(P.f, norm(sub(tgtUp, P.pos))), -1, 1));
          const pairs = Math.ceil(T.hp / 100) + 1;
          const tol = (KINDS[T.kind].r * 0.8 + 12) / D;
          if (w === 'rockets' && ang < tol && D < 2000 && D > 600 && modeT > 0.3 && run.pairs < pairs) { out.fire = true; modeT = 0; run.pairs++; }
          if (ang < tol * 1.5 && D < 1300) out.gun = true;
          if (D < 600 || agl < 140) { run.phase = 'out'; modeT = 0; }
          opts = { maxClimb: 0.9, horizon: 1.8 };
          clearance = 70;
        }
      } else {
        // climb away, then turn back for another pass
        d = norm([P.f[0], 0.35, P.f[2]]);
        out.throttle = 1.1;
        if (modeT > 2) { run.phase = 'approach'; run.pairs = 0; run.leg = 'out'; }
        opts = { maxBank: 0.5 };
      }
    } else if (job.kind === 'escort') {
      const c = job.T;
      const p = [c.pos[0] - c.f[0] * 600, c.pos[1] + 300, c.pos[2] - c.f[2] * 600];
      d = norm(sub(p, P.pos));
      const D = dist(p, P.pos);
      out.throttle = D > 1500 ? 1.1 : 0.6;
      if (D < 800) d = norm([c.f[0], (p[1] - P.pos[1]) / 1500, c.f[2]]);
    } else {
      const h = W.site('home');
      d = toward(P, h.x, h.z, clamp((h.y + 1200 - P.pos[1]) / 2000, -0.4, 0.4));
      out.throttle = 0.8;
    }
    return finish(P, W, d, opts, clearance, out, agl);
  }
  // what it is up to, for the tools
  step.info = () => ({ job: lastJob?.kind, target: lastJob?.T?.kind, phase: run?.phase });
  return step;

  function select(P, w, out) {
    if (w === 'gun') return;
    if (WEAPONS[P.sel] !== w && P.stores[w] > 0 && !out.decoy) out.weapon = true;
  }
  function finish(P, W, d, opts, clearance, out, agl) {
    const need = terrain(P, W, clearance, opts.horizon);
    if (need > 0 || agl < clearance * 0.6) {
      d = norm([d[0] * 0.4, Math.max(0.5, d[1]), d[2] * 0.4]);
      opts = { ...opts, maxBank: 0.35, maxClimb: 0.8, fine: false };
      out.throttle = Math.max(out.throttle, 1.05);
      out.fire = false;
    }
    if (P.speed < 120) out.throttle = 1.2;
    if (P.fuel < 8) out.throttle = Math.min(out.throttle, 0.9);
    Object.assign(out, fly(P, d, opts));
    return out;
  }
}
