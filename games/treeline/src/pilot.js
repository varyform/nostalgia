// The autopilot: flies the Gadfly through a mission with the controls a player has in assisted
// mode (cyclic, pedals, collective, triggers), for the attract demo and the verify tool. Under a
// go-to-a-point flight director (heading, speed and a height over the treetops ahead) it picks
// what to do: drop flares and duck when a missile comes, fight a gunship that has seen it, take
// off for the landing zone and wait there, shadow the convoy, or attack the nearest objective:
// run in low to a firing spot that sees the target, unmask, fire (the turret-slaved gun at soft
// targets, the Thorn at armour, held in sight until it hits), and drop back. Low on fuel or
// ammunition it goes home to the FARP to rearm; with the goal done it lands there.
//
//   const pilot = createPilot(sim, { sloppy: 0.3, seed });
//   sim.step(pilot());
//
// `sloppy` (0 sharp … 1) adds wobble, slower and missed reactions and riskier heights: the demo
// flies with some, so it sometimes loses.
import { DT, KINDS, SKID, centre, dist, predictRocket, wrap } from './sim.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HARD = new Set(['tank', 'bunker', 'command', 'bridge']);

// ---------- the route: valleys before ridges, on a coarse grid of the world ----------
const G = 64, GC = 200, GH = (G * GC) / 2;
const grids = new Map();
function gridOf(W) {
  if (grids.has(W)) return grids.get(W);
  const h = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    let m = -Infinity;
    for (const [a, b] of [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) m = Math.max(m, W.topAt(-GH + (i + a) * GC, -GH + (j + b) * GC));
    h[j * G + i] = m;
  }
  grids.set(W, h);
  return h;
}
const cellOf = (x, z) => [clamp(Math.floor((x + GH) / GC), 1, G - 2), clamp(Math.floor((z + GH) / GC), 1, G - 2)];
/** a path of [x, z] points from a to b that keeps low: cost grows with the height of the ground climbed to */
export function route(W, ax, az, bx, bz) {
  const h = gridOf(W), [si, sj] = cellOf(ax, az), [ti, tj] = cellOf(bx, bz), s0 = sj * G + si, t0 = tj * G + ti;
  const cost = new Float32Array(G * G).fill(Infinity), from = new Int32Array(G * G).fill(-1), done = new Uint8Array(G * G);
  const base = Math.min(h[s0], h[t0]);
  const heap = [[0, s0]];
  cost[s0] = 0;
  while (heap.length) {
    // a small binary heap
    const [c, n] = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[k], heap[m]] = [heap[m], heap[k]]; k = m; } }
    if (done[n]) continue;
    done[n] = 1;
    if (n === t0) break;
    const i = n % G, j = (n - i) / G;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (ni < 1 || nj < 1 || ni > G - 2 || nj > G - 2) continue;
      const m = nj * G + ni, L = di && dj ? 1.414 : 1;
      const nc = c + L * (1 + Math.max(0, h[m] - base) / 120 + Math.max(0, h[m] - h[n]) / 40);
      if (nc < cost[m]) {
        cost[m] = nc; from[m] = n;
        heap.push([nc, m]);
        for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
      }
    }
  }
  const pts = [[bx, bz]];
  for (let n = from[t0]; n >= 0 && n !== s0; n = from[n]) { const i = n % G, j = (n - i) / G; pts.push([-GH + (i + 0.5) * GC, -GH + (j + 0.5) * GC]); }
  return pts.reverse();
}

export function createPilot(sim, { sloppy = 0, seed = 1 } = {}) {
  let s = seed | 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  let job = null, spot = null, spotT = 0, riseT = 0, wob = 0, wobT = 0, rearm = false, lastJob = '';
  const decoyed = new Map();

  // the next point along a low route to (x, z), replanned when the goal moves or now and then
  let path = null, pathGoal = null, pathT = 0, lastTop = 0;
  function via(P, W, x, z) {
    const D = Math.hypot(x - P.pos[0], z - P.pos[2]);
    if (D < 700) return [x, z];
    pathT -= DT;
    if (!path || pathT <= 0 || Math.hypot(pathGoal[0] - x, pathGoal[1] - z) > 250) { path = route(W, P.pos[0], P.pos[2], x, z); pathGoal = [x, z]; pathT = 6; }
    // drop the points behind; aim at the first one 350 m on
    while (path.length > 1 && Math.hypot(path[0][0] - P.pos[0], path[0][1] - P.pos[2]) < 350) path.shift();
    return path[0];
  }
  function go(P, W, out, o) {
    const [x, z] = via(P, W, o.x, o.z);
    return fly(P, W, out, { ...o, x, z, speed: x === o.x && z === o.z ? o.speed : Math.max(o.speed ?? 55, 45) });
  }

  // ---------- the flight director: to (x, z) at a speed, a height over the treetops ahead ----------
  function fly(P, W, out, { x, z, speed = 55, clr = 16, face = null, stop = false, y = null }) {
    const dx = x - P.pos[0], dz = z - P.pos[2], D = Math.hypot(dx, dz);
    let hdgW = D > 20 ? Math.atan2(dx, -dz) : P.hdg;
    if (face != null && (D < 120 || stop)) hdgW = face;
    const err = wrap(hdgW - P.hdg);
    let Vw = stop ? clamp(D * 0.08, 0, 8) * Math.cos(err) : Math.min(speed, Math.sqrt(2 * 2.2 * Math.max(0, D - 30)));
    Vw *= clamp(1.25 - Math.abs(err) / 1.1, 0.15, 1);
    // the treetops ahead: how high to be, and how fast the climb must be
    // sampled along the way it is going (and the way it wants to go), out to six seconds or 150 m
    let top = W.topAt(P.pos[0], P.pos[2]), rate = 0, wall = false;
    const v = Math.max(P.gs, 5), hx = P.gs > 3 ? P.vel[0] / P.gs : Math.sin(hdgW), hz = P.gs > 3 ? P.vel[2] / P.gs : -Math.cos(hdgW);
    const reach = Math.max(150, v * 6), yNow = P.pos[1] - SKID;
    for (let d = 20; d <= reach; d += 25) {
      for (const o of [-18, 0, 18]) {
        const t = W.topAt(P.pos[0] + hx * d - hz * o, P.pos[2] + hz * d + hx * o);
        top = Math.max(top, t);
        const dh = t + clr - yNow;
        rate = Math.max(rate, dh / (d / v));
        // the climb it can make: about 6 m/s, so no faster forward than that allows
        if (dh > 0) Vw = Math.min(Vw, Math.max(10, (d * 6) / dh));
        if (d < 45 && t > yNow - 3) wall = true;
      }
    }
    if (wall) Vw = Math.min(Vw, -2);
    lastTop = top;
    let yW = y ?? top + clr;
    yW = Math.max(yW, top + Math.min(clr, 6 + P.gs * 0.15)) + wob;
    // speed: the speed hold follows the stick; heading: turn on the spot when slow, bank when fast
    out.pitch = clamp((P.hold.speed - Vw) * 0.3, -1, 1);
    if (Math.abs(P.hold.speed) < 12 && P.gs < 16) out.roll = clamp(err * 1.8, -1, 1);
    else out.roll = clamp(Math.atan((clamp(err * 0.9, -0.6, 0.6) * Math.max(P.gs, 15)) / 9.81) / 0.6, -1, 1);
    if (Math.abs(out.roll) < 0.05) out.roll = 0;
    const yErr = yW - (P.pos[1] - SKID);
    out.coll = clamp(yErr * 0.22 - P.vs * 0.12, -1, 1);
    if (Math.abs(out.coll) < 0.06) out.coll = 0;
    return D;
  }

  // a spot r metres from the target, on our side, that sees it from just over the treetops
  function findSpot(P, W, T, r, turn = 0) {
    const c = centre(T), base = Math.atan2(P.pos[0] - c[0], P.pos[2] - c[2]) + turn;
    let best = null, bs = Infinity;
    for (let k = 0; k < 14; k++) {
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.32, rr = r * (k > 9 ? 0.7 : 1);
      const x = c[0] + Math.sin(a) * rr, z = c[2] + Math.cos(a) * rr;
      if (Math.abs(x) > 5800 || Math.abs(z) > 5800) continue;
      // not up on a mountainside far above the target
      if (W.topAt(x, z) > c[1] + 250) continue;
      for (const h of [10, 22, 40]) {
        const y = W.topAt(x, z) + h;
        if (W.clear(x, y + SKID, z, c[0], c[1] + 1.5, c[2])) {
          const sc = Math.hypot(x - P.pos[0], z - P.pos[2]) + h * 40 + Math.abs(k) * 60;
          if (sc < bs) { bs = sc; best = { x, z, h }; }
          break;
        }
      }
    }
    return best ?? { x: c[0] + Math.sin(base) * r * 0.6, z: c[2] + Math.cos(base) * r * 0.6, h: 30 };
  }

  function weaponFor(P, T) {
    if (T.air) return P.ammo.aam > 0 && T.kind === 'stiletto' ? 'aam' : 'gun';
    if (HARD.has(T.kind) && P.ammo.atm > 0) return 'atm';
    // a soft target inside a defended site: from missile range, not gun range
    const guarded = sim.actors.filter(a => a !== T && a.alive && a.team === 'red' && !a.air && (KINDS[a.kind].shell || KINDS[a.kind].mg || KINDS[a.kind].flak) && dist(a.pos, T.pos) < 700).length >= 2;
    if (guarded && P.ammo.atm > 3) return 'atm';
    if (P.gun > 40) return 'gun';
    if (P.ammo.atm > 0) return 'atm';
    return P.ammo.rkt > 0 ? 'rkt' : 'gun';
  }
  const enemies = () => sim.actors.filter(a => a.alive && a.team === 'red');
  function choose(P) {
    const M = sim.mission, red = enemies();
    // a gunship or jet that has us in sight comes first
    const air = red.filter(a => a.air && a.sees && dist(a.pos, P.pos) < 3000).sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos));
    // a gun battery firing on us close by comes before a gunship still some way off
    const flak = red.filter(a => !a.air && a.sees && KINDS[a.kind].flak && dist(a.pos, P.pos) < 1300).sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos));
    if (flak.length && !(air.length && dist(air[0].pos, P.pos) < 900)) return { kind: 'attack', T: flak[0] };
    if (air.length) return { kind: 'attack', T: air[0] };
    if (sim.complete) return { kind: 'home' };
    // an armed unit shooting at us from close by
    const near = red.filter(a => !a.air && a.sees && KINDS[a.kind].sam == null && dist(a.pos, P.pos) < (KINDS[a.kind].flak ? 2700 : KINDS[a.kind].shell ? 2300 : 1500)).sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos));
    if (near.length && !(job?.kind === 'attack' && job.T.alive && job.T.obj && dist(job.T.pos, P.pos) < 1400)) return { kind: 'attack', T: near[0] };
    if (M.goal === 'rescue') {
      if (sim.lz.done) return { kind: 'home' };
      // clear the guns round the landing zone first
      const L = sim.lz.site, guard = red.filter(a => !a.air && (KINDS[a.kind].mg || KINDS[a.kind].flak || KINDS[a.kind].shell) && Math.hypot(a.pos[0] - L.x, a.pos[2] - L.z) < 1600);
      if (job?.kind === 'attack' && job.T.alive && guard.includes(job.T)) return job;
      if (guard.length) return { kind: 'attack', T: guard.sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos))[0] };
      return { kind: 'lz' };
    }
    if (M.goal === 'escort') {
      const lead = sim.actors.filter(a => a.kind === 'ally' && a.alive && !a.arrived).sort((a, b) => (b.s - a.s) * b.dir)[0];
      if (!lead) return { kind: 'home' };
      const air2 = red.filter(a => a.air && dist(a.pos, lead.pos) < 3000);
      if (air2.length) return { kind: 'attack', T: air2[0] };
      const block = red.filter(a => !a.air && (KINDS[a.kind].mg || KINDS[a.kind].shell || KINDS[a.kind].flak || KINDS[a.kind].sam) && dist(a.pos, lead.pos) < 1700)
        .sort((a, b) => dist(a.pos, lead.pos) - dist(b.pos, lead.pos));
      if (job?.kind === 'attack' && job.T.alive && block.includes(job.T)) return job;
      if (block.length) return { kind: 'attack', T: block[0] };
      return { kind: 'escort', T: lead };
    }
    // stay on the target being worked on
    if (job?.kind === 'attack' && job.T.alive && !job.T.air) return job;
    // SAM sites that have us, before the rest (the nearest)
    const sam = red.filter(a => KINDS[a.kind].sam && a.lockT > 0 && dist(a.pos, P.pos) < 6000).sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos))[0];
    if (sam) return { kind: 'attack', T: sam };
    const objs = red.filter(a => a.obj).sort((a, b) => dist(a.pos, P.pos) - dist(b.pos, P.pos));
    if (objs.length) {
      // the radar first in a SAM hunt
      const radar = objs.find(a => a.kind === 'radar' && dist(a.pos, P.pos) < dist(objs[0].pos, P.pos) + 1500);
      return { kind: 'attack', T: radar ?? objs[0] };
    }
    return { kind: 'home' };
  }

  function step() {
    const out = decide(), P = sim.player, m = sim.threat;
    // a SAM needs its launcher to see us: duck into the clutter until it goes stupid
    if (m && m.kind === 'sam' && P.alive && !P.ground && dist(m.pos, P.pos) < 6000 && rnd() > sloppy * 0.4) {
      const yW = lastTop + 7 - (P.pos[1] - SKID);
      out.coll = clamp(yW * 0.3 - P.vs * 0.12, -1, 1);
      out.fire = false;
    }
    return out;
  }
  function decide() {
    const P = sim.player, W = sim.world, out = { pitch: 0, roll: 0, yaw: 0, coll: 0, gun: false, fire: false, weapon: false, decoy: false, target: false };
    if (!P.alive || sim.status !== 'fly') return out;
    if (!P.assist) out.assist = true;
    wobT -= DT;
    if (wobT <= 0) { wobT = 1 + rnd() * 2; wob = (rnd() - 0.5) * sloppy * 10; }
    // 1. a missile closing: flares, duck into the clutter, turn across it
    const m = sim.threat;
    if (m) {
      const D = dist(m.pos, P.pos), seen = decoyed.get(m) ?? 0;
      if (((seen === 0 && D < 2400) || (seen === 1 && D < 1000)) && rnd() > sloppy * 0.5) { decoyed.set(m, seen + 1); out.decoy = true; }
      else if (seen < 2 && ((seen === 0 && D < 2400) || (seen === 1 && D < 1000))) decoyed.set(m, seen + 1);
    }
    // 2. rearm and refuel at the FARP when short
    const objLeft = enemies().some(a => a.obj) || (sim.mission.goal === 'escort' && !sim.complete) || (sim.lz && !sim.lz.done);
    const short = P.fuel < 30 || P.hp < (sim.mission.goal === "ambush" ? 25 : 45) || (P.gun < 60 && P.ammo.atm === 0 && P.ammo.rkt < 6);
    if (short && objLeft && !sim.complete) rearm = true;
    if (rearm && P.ground && P.fuel > 97 && P.gun >= sim.mission.load.gun && P.ammo.atm >= sim.mission.load.atm && P.hp > 95) rearm = false;
    // going home hurt: still turn on a gunship or jet that is on us
    const chaser = rearm && P.gun > 0 ? enemies().find(a => a.air && a.alive && a.sees && dist(a.pos, P.pos) < 1400) : null;
    job = chaser ? { kind: 'attack', T: chaser } : rearm ? { kind: 'home' } : choose(P);
    lastJob = job.kind;
    const home = W.site('home');
    if (job.kind === 'home') {
      const D = Math.hypot(home.x - P.pos[0], home.z - P.pos[2]);
      if (D > 60) go(P, W, out, { x: home.x, z: home.z, speed: 60, clr: m ? 8 : 18 });
      else {
        // over the pad: stop, then sink onto it
        fly(P, W, out, { x: home.x, z: home.z, stop: true, y: home.y + (P.gs < 2.5 ? -5 : 8) });
        if (P.gs < 2.5 && P.agl < 12) out.coll = P.agl > 3 ? -0.45 : -0.25;
      }
      if (P.ground && D < home.r + 20) out.coll = rearm ? 0 : -1;
      return out;
    }
    if (job.kind === 'lz') {
      const L = sim.lz.site, D = Math.hypot(L.x - P.pos[0], L.z - P.pos[2]);
      if (P.ground && D < L.r + 40) { out.coll = -1; return out; }
      if (D > 70) go(P, W, out, { x: L.x, z: L.z, speed: 55, clr: 14 });
      else {
        fly(P, W, out, { x: L.x, z: L.z, stop: true, y: L.y + (P.gs < 2.5 ? -5 : 8) });
        if (P.gs < 2.5 && P.agl < 12) out.coll = P.agl > 3 ? -0.45 : -0.25;
      }
      if (m) out.coll = Math.min(out.coll, -0.5);
      return out;
    }
    if (job.kind === 'escort') {
      const L = job.T, ahead = [L.pos[0] + L.f[0] * 350, L.pos[2] + L.f[2] * 350];
      fly(P, W, out, { x: ahead[0], z: ahead[1], speed: 40, clr: 18, stop: Math.hypot(ahead[0] - P.pos[0], ahead[1] - P.pos[2]) < 200, face: Math.atan2(L.f[0], -L.f[2]) });
      return out;
    }
    // ---------- attack ----------
    const T = job.T, c = centre(T), D = dist(c, P.pos), w = weaponFor(P, T);
    if (P.target !== T) out.targetId = T.id;
    const want = w === 'gun' ? 'rkt' : w;
    if (w !== 'gun' && P.ammo[want] > 0 && ['rkt', 'atm', 'aam'][P.sel] !== want) out.weapon = true;
    const face = Math.atan2(c[0] - P.pos[0], -(c[2] - P.pos[2]));
    if (T.air) {
      // a gunship: face it and hose it with the turret; a jet: the Wren if it locks
      // a gunship comes to us: hold here, low, and turn to meet it; a jet passes: the same
      const far = T.kind === 'mantis' && D > 2600;
      fly(P, W, out, { x: far ? c[0] : P.pos[0], z: far ? c[2] : P.pos[2], stop: !far, speed: 40, clr: 12, face });
      if (P.slaved && D < 1500 && P.tgtSeen) out.gun = rnd() > sloppy * 0.3;
      if (w === 'aam' && sim.lockState === 'lock') out.fire = true;
      return out;
    }
    const range = w === 'atm' ? 3000 : w === 'rkt' ? 1000 : 950;
    if (!spot || spot.T !== T || spot.w !== w) { spot = { T, w, age: 0, tries: 0, ...findSpot(P, W, T, range) }; spotT = 0; riseT = 0; }
    spot.age += DT;
    const toSpot = Math.hypot(spot.x - P.pos[0], spot.z - P.pos[2]);
    const mine = sim.missiles.some(x => x.owner === P && x.kind === 'atm' && x.tgt === T);
    const exposed = toSpot < 160 || (D < range * 1.15 && P.tgtSeen);
    if (!exposed) {
      go(P, W, out, { x: spot.x, z: spot.z, speed: 55, clr: m ? 7 : 12 - sloppy * 3 });
      riseT = 0;
      // can't get there: try another side, a little closer
      if (spot.age > 50 + Math.hypot(spot.x - P.pos[0], spot.z - P.pos[2]) / 40) {
        const tries = spot.tries + 1;
        spot = { T, w, age: 0, tries, ...findSpot(P, W, T, range * Math.max(0.45, 1 - tries * 0.15), tries * 1.1) };
      }
    } else {
      spotT += DT;
      // unmask: rise until the target is in sight, then hold there
      if (!P.tgtSeen) riseT += DT;
      const hover = W.topAt(P.pos[0], P.pos[2]) + clamp(spot.h + (P.tgtSeen ? 0 : riseT * 6), 8, 70);
      fly(P, W, out, { x: spot.x, z: spot.z, stop: true, face, y: m && !mine ? W.topAt(P.pos[0], P.pos[2]) + 7 : hover });
      if (riseT > 9 || spotT > 45) { const tries = spot.tries + 1; spot = { T, w, age: 0, tries, ...findSpot(P, W, T, range * Math.max(0.45, 1 - tries * 0.15), tries * 1.1) }; spotT = 0; riseT = 0; }
      const aligned = Math.abs(wrap(face - P.hdg)) < 0.25;
      if (w === 'gun' && P.slaved && D < 1350) out.gun = rnd() > sloppy * 0.2;
      if (w === 'atm' && sim.lockState === 'lock' && aligned && !mine && P.gs < 15) out.fire = true;
      // armour closing on the spot: back off to a new one
      if (w === 'atm' && !mine && D < 1500 && T.road && spotT > 3) { spot = { T, w, age: 0, tries: 0, ...findSpot(P, W, T, range) }; spotT = 0; riseT = 0; }
      if (w === 'rkt' && P.tgtSeen) {
        const hit = predictRocket(sim);
        if (hit && Math.hypot(hit.pos[0] - c[0], hit.pos[2] - c[2]) < KINDS[T.kind].r + 10 && rnd() < 0.2) out.fire = true;
        if (P.slaved && D < 1350) out.gun = true;
      }
    }
    return out;
  }
  // what it is up to, for the tools
  step.info = () => ({ job: lastJob, target: job?.T?.kind, spot: !!spot, rearm });
  return step;
}
