// Proves Scorch's races, headless, on the real sim:
//   1. the tracks are well formed: eight, two per setting, 600–1100 m a lap, 12–18 m wide, never
//      touching themselves, corners the walls can follow, the start on a straight, obstacles that
//      leave the road open, pickups on the road;
//   2. the handling: a drift under full lock at speed settles at an angle instead of spinning, a
//      glance off a wall keeps most of the speed while a head-on hit stops the car, a turbo lifts
//      the top speed, a mine arms and then blows under any car (its owner too), a shunt costs both
//      cars armour, a wreck stays on the road as a solid hulk and finishes last;
//   3. laps: the line crossed forward counts only with a whole lap behind; backing over it and
//      driving round backwards never count;
//   4. every track is lapped by AI at skills 0.3, 0.6 and 1 on many seeds (no weapons, so every
//      car runs the whole race): no car stuck or off the road or out of the world, every race
//      reaches 'done', lap times reported per track and skill; and a race replays exactly;
//   5. full races with weapons on every track: they finish, and wrecks happen but not too often;
//   6. with --soak M (default 20), back-to-back demo races for M simulated minutes, failing on
//      any exception, NaN, unknown event, a car stuck or out of the world, a race that never ends.
//
//   mise exec -- node games/scorch/tools/verify.mjs [--seeds 6] [--soak 20] [track ids…]
import { buildTrack } from '../src/track.js';
import { TRACKS } from '../src/tracks.js';
import { racingLine } from '../src/ai.js';
import { createPilot } from '../src/pilot.js';
import { CAR, DT, EMPTY_INPUT, P, createRace } from '../src/sim.js';
import { DRIVERS, MODELS, carStats, entrants, newCareer, offers } from '../src/career.js';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? +args[i + 1] : d; };
const seeds = opt('--seeds', 6), soakMin = opt('--soak', 20);
const only = args.filter((a, i) => !a.startsWith('--') && !['--seeds', '--soak'].includes(args[i - 1]));
const EVENTS = new Set(['count', 'go', 'lap', 'last', 'finish', 'shot', 'hit', 'spark', 'drop', 'boom', 'bump', 'wall', 'pickup', 'turbo', 'wreck', 'low', 'done']);
const THEMES = ['canyon', 'docks', 'pass', 'city'];
const SURFS = new Set(['dirt', 'ice', 'oil', 'water', 'snow']);
let bad = 0;
const fail = msg => { bad++; console.log(`  ✗ ${msg}`); };
const ok = msg => console.log(`  ✓ ${msg}`);
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// the career's cars: the starting junker first … the champion's car last
const STATS = MODELS.map(M => carStats(M));
const entrant = (i, model, ai, kit = { ammo: 60, mines: 3, turbo: 2 }) => ({ id: `car${i}`, name: `Car ${i}`, colour: '#c33', model: MODELS[model].id, stats: STATS[model], ...kit, ai });
const tracks = TRACKS.filter(t => !only.length || only.includes(t.id));

// ---------- 1: the tracks ----------
{
  if (TRACKS.length !== 8) fail(`${TRACKS.length} tracks, want 8`);
  for (const th of THEMES) if (TRACKS.filter(t => t.theme === th).length !== 2) fail(`theme ${th}: want two tracks`);
  if (new Set(TRACKS.map(t => t.id)).size !== TRACKS.length) fail('duplicate track ids');
  for (const T of TRACKS) {
    const g = buildTrack(T), name = `${T.id}`;
    if (g.len < 600 || g.len > 1100) fail(`${name}: lap ${g.len.toFixed(0)} m`);
    if (T.pts.some(p => p[2] < 12 - 1e-6 || p[2] > 18 + 1e-6)) fail(`${name}: a width outside 12–18 m`);
    if (!(T.laps >= 2 && T.laps <= 6)) fail(`${name}: ${T.laps} laps`);
    // the inner wall of every bend has room to turn (it never folds back on itself)
    let tight = Infinity;
    for (let i = 0; i < g.n; i++) tight = Math.min(tight, 1 / Math.max(1e-9, Math.abs(g.ks[i])) - g.ws[i] / 2);
    if (tight < 3) fail(`${name}: an inner wall bends at ${tight.toFixed(1)} m radius`);
    // parts of the road far apart along it stay apart on the ground: room for two walls
    let gap = Infinity;
    for (let i = 0; i < g.n; i += 2) for (let j = i + 2; j < g.n; j += 2) {
      if (Math.min(j - i, g.n - j + i) * g.step < 60) continue;
      gap = Math.min(gap, Math.hypot(g.xs[i] - g.xs[j], g.ys[i] - g.ys[j]) - (g.ws[i] + g.ws[j]) / 2);
    }
    if (gap < 5) fail(`${name}: two parts of the road come within ${gap.toFixed(1)} m`);
    for (let d = -20; d <= 10; d += 2) if (Math.abs(g.at(d).curv) > 0.004) { fail(`${name}: the start is not on a straight (${d} m)`); break; }
    for (const sf of T.surfaces) if (!SURFS.has(sf.kind) || !(sf.to > sf.from)) fail(`${name}: surface ${JSON.stringify(sf)}`);
    for (const [x, y] of T.pickups) { const q = g.nearest(x, y); if (Math.abs(q.off) > g.ws[q.i] / 2 - 1.5) fail(`${name}: pickup at ${x},${y} off the road`); }
    if (T.pickups.length < 3) fail(`${name}: ${T.pickups.length} pickup spots`);
    let onRoad = 0;
    for (const p of T.props) {
      const q = g.nearest(p.x, p.y), half = g.ws[q.i] / 2;
      if (Math.abs(q.off) >= half + p.r) continue;
      if (!p.solid) continue;
      onRoad++;
      // the widest way past it
      const free = Math.max(half + (q.off - p.r), half - (q.off + p.r));
      if (free < 7) fail(`${name}: a ${p.kind} leaves only ${free.toFixed(1)} m of road`);
    }
    const S = new Set(T.surfaces.map(s => s.kind));
    ok(`${name.padEnd(10)} ${T.name.padEnd(17)} ${T.theme.padEnd(6)} ${g.len.toFixed(0)} m × ${T.laps} laps, tightest inner wall ${tight.toFixed(1)} m, nearest other road ${gap.toFixed(0)} m, ${onRoad} obstacles on the road, ${T.pickups.length} pickups, ${T.props.length} props${S.size ? `, ${[...S].join('/')}` : ''}`);
  }
}

// a test race: car 0 driven by `drive(race, step)`, the rest parked AI or none
function testRace(track, n = 1, { model = 0, kit } = {}) {
  const cars = Array.from({ length: n }, (_, i) => entrant(i, model, i ? { skill: 0.5, aggression: 0 } : null, kit));
  const race = createRace({ track, seed: 3, cars });
  while (race.s.status === 'grid') race.step([EMPTY_INPUT]);
  return race;
}
const run = (race, inp, secs) => { for (let k = 0; k < secs * 60; k++) race.step([typeof inp === 'function' ? inp(race) : inp]); };
const straight = TRACKS.find(t => t.id === 'gantry') || TRACKS[0];

// ---------- 2: handling ----------
{
  // full lock at speed: the tail steps out to an angle and holds there; no spin
  const race = testRace(straight), c = race.s.cars[0];
  run(race, { ...EMPTY_INPUT, up: true }, 4);
  const v0 = c.speed;
  let maxB = 0, turned = 0;
  for (let k = 0; k < 60; k++) {
    race.step([{ ...EMPTY_INPUT, up: true, right: true }]);
    const b = Math.abs(Math.atan2(-c.vx * Math.sin(c.a) + c.vy * Math.cos(c.a), c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a)));
    maxB = Math.max(maxB, b); turned += c.w * DT;
  }
  if (maxB < 0.12 || maxB > 0.9) fail(`a full-lock drift at ${v0.toFixed(0)} m/s peaks at ${(maxB * 57.3).toFixed(0)}° of slip`);
  else ok(`handling: full lock at ${v0.toFixed(0)} m/s slides out to ${(maxB * 57.3).toFixed(0)}° of slip and holds (turned ${(turned * 57.3).toFixed(0)}° in 1 s)`);
}
{
  // walls: aim at one at a shallow angle and head-on
  const hitWall = angle => {
    const race = testRace(straight), c = race.s.cars[0], g = race.geo;
    const p = g.at(120);
    c.x = p.x; c.y = p.y; c.d = 120; c.prog = 120;
    c.a = Math.atan2(p.ty, p.tx) + angle;
    c.vx = Math.cos(c.a) * 25; c.vy = Math.sin(c.a) * 25;
    let hit = null;
    for (let k = 0; k < 120 && !hit; k++) { race.step([{ ...EMPTY_INPUT, up: true }]); hit = race.events.find(e => e.k === 'wall'); }
    for (let k = 0; k < 6; k++) race.step([{ ...EMPTY_INPUT, up: true }]);
    return { hit, speed: c.speed, hp: c.hp, max: c.maxHp };
  };
  const glance = hitWall(0.2), head = hitWall(1.45);
  if (!glance.hit || glance.speed < 18) fail(`a 11° glance off a wall at 25 m/s leaves ${glance.speed.toFixed(1)} m/s`);
  if (!head.hit || head.speed > 12) fail(`a head-on hit at 25 m/s leaves ${head.speed.toFixed(1)} m/s`);
  if (head.hp >= head.max) fail('a head-on wall hit costs no armour');
  if (glance.hp < glance.max - 3) fail(`a glance costs ${(glance.max - glance.hp).toFixed(1)} armour`);
  ok(`walls: an 11° glance at 25 m/s keeps ${glance.speed.toFixed(0)} m/s; head-on drops to ${head.speed.toFixed(0)} m/s and costs ${(head.max - head.hp).toFixed(0)} armour`);
}
{
  // turbo: a press spends a charge and runs past the normal top speed
  const race = testRace(straight, 1, { kit: { ammo: 0, mines: 0, turbo: 1 } }), c = race.s.cars[0];
  run(race, { ...EMPTY_INPUT, up: true }, 5);
  const v0 = c.speed;
  race.step([{ ...EMPTY_INPUT, up: true, turbo: true }]);
  const ev = race.events.some(e => e.k === 'turbo');
  let vmax = 0;
  for (let k = 0; k < 90; k++) { race.step([{ ...EMPTY_INPUT, up: true }]); vmax = Math.max(vmax, c.speed); }
  if (!ev || c.turbo !== 0 || vmax < v0 + 3) fail(`turbo: event ${ev}, charges left ${c.turbo}, ${v0.toFixed(1)} → ${vmax.toFixed(1)} m/s`);
  else ok(`turbo: ${v0.toFixed(1)} → ${vmax.toFixed(1)} m/s for ${P.turbo} s`);
}
{
  // a mine: dropped behind, harmless until armed, then it blows under its own owner backing over it
  const race = testRace(straight, 1, { kit: { ammo: 0, mines: 1, turbo: 0 } }), c = race.s.cars[0];
  race.step([{ ...EMPTY_INPUT, mine: true }]);
  const dropped = race.events.some(e => e.k === 'drop') && race.s.mines.length === 1 && c.mines === 0;
  const hp0 = c.hp;
  let boom = null, t = 0;
  for (; t < 4 * 60 && !boom; t++) { race.step([{ ...EMPTY_INPUT, down: true }]); boom = race.events.find(e => e.k === 'boom'); }
  if (!dropped || !boom || boom.car !== 0 || (t + 1) * DT < P.mineArm - 1e-9 || c.hp > hp0 - P.mineDmg + 0.01 || !(c.spin > 0)) fail(`mine: dropped ${dropped}, boom ${JSON.stringify(boom)} after ${(t * DT).toFixed(2)} s, hp ${hp0} → ${c.hp}`);
  else ok(`mines: armed after ${P.mineArm} s, it blew under its owner backing over it (${P.mineDmg} armour, a spin)`);
}
{
  // a shunt: two cars side by side, one steered into the other, both lose armour
  const race = testRace(straight, 2), [a, b] = race.s.cars, g = race.geo, p = g.at(100);
  b.ai = null;
  const t = Math.atan2(p.ty, p.tx);
  Object.assign(a, { x: p.x - p.ty * -3, y: p.y + p.tx * -3, a: t + 0.6, vx: Math.cos(t + 0.6) * 22, vy: Math.sin(t + 0.6) * 22, d: 100, prog: 100 });
  Object.assign(b, { x: p.x - p.ty * 2.5, y: p.y + p.tx * 2.5, a: t, vx: Math.cos(t) * 10, vy: Math.sin(t) * 10, d: 100, prog: 100 });
  let bump = null;
  for (let k = 0; k < 60 && !bump; k++) { race.step([EMPTY_INPUT, EMPTY_INPUT]); bump = race.events.find(e => e.k === 'bump'); }
  if (!bump || a.hp >= a.maxHp || b.hp >= b.maxHp) fail(`shunt: ${JSON.stringify(bump)}, hp ${a.hp.toFixed(1)} / ${b.hp.toFixed(1)}`);
  else ok(`shunts: a ${bump.force.toFixed(0)} m/s hit costs the rammer ${(a.maxHp - a.hp).toFixed(0)} and the rammed ${(b.maxHp - b.hp).toFixed(0)} armour`);
}
{
  // a wreck: armour gone, it burns where it stops, others bounce off it, it finishes last
  const race = testRace(straight, 2), [a, b] = race.s.cars;
  b.hp = 0;
  Object.assign(b, { ai: null });
  const g = race.geo, p = g.at(60);
  Object.assign(b, { x: p.x, y: p.y, a: Math.atan2(p.ty, p.tx), vx: 0, vy: 0, d: 60, prog: 60 });
  Object.assign(a, { x: p.x - p.tx * 25, y: p.y - p.ty * 25, a: Math.atan2(p.ty, p.tx), vx: p.tx * 20, vy: p.ty * 20, d: 35, prog: 35 });
  let wreck = null, bump = null;
  for (let k = 0; k < 120; k++) {
    race.step([{ ...EMPTY_INPUT, up: !bump }, EMPTY_INPUT]);
    wreck ??= race.events.find(e => e.k === 'wreck');
    bump ??= race.events.find(e => e.k === 'bump');
  }
  const moved = Math.hypot(b.x - p.x, b.y - p.y);
  if (!wreck || !b.dead || !bump || moved > 6) fail(`wreck: ${JSON.stringify(wreck)}, dead ${b.dead}, bumped ${!!bump}, hulk moved ${moved.toFixed(1)} m`);
  else {
    // see it out: car 0 finishes (pilot), the hulk is last
    const pilot = createPilot(race, 0, { skill: 1 });
    for (let k = 0; k < 60 * 400 && race.s.status !== 'done'; k++) race.step([pilot(), EMPTY_INPUT]);
    const r = race.result();
    if (race.s.status !== 'done' || r[r.length - 1].id !== b.id || !r[r.length - 1].wrecked) fail(`wreck: result ${JSON.stringify(r)}`);
    else ok(`wrecks: the hulk stays put (moved ${moved.toFixed(1)} m when hit at 20 m/s) and is placed last`);
  }
}

// ---------- 3: laps ----------
{
  // walk car 0 along the centreline by hand (the physics runs; we place it each step)
  const T = straight, race = testRace(T), c = race.s.cars[0], g = race.geo, len = g.len;
  let laps = 0;
  const walk = (from, to, by) => {
    for (let d = from; by > 0 ? d <= to : d >= to; d += by) {
      const p = g.at(d);
      Object.assign(c, { x: p.x, y: p.y, vx: 0, vy: 0, w: 0, a: Math.atan2(p.ty, p.tx) });
      race.step([EMPTY_INPUT]);
      laps += race.events.filter(e => e.car === 0 && (e.k === 'lap' || e.k === 'finish')).length;
    }
  };
  const d0 = c.prog;
  walk(d0, 20, 0.5); // over the line from the grid: no lap
  const a = c.lap;
  walk(20, -30, -0.5); walk(-30, 20, 0.5); walk(20, -30, -0.5); // back over it, forward, back
  const b = c.lap;
  walk(-30, -30 - len, -0.5); // a whole lap backwards
  const back = c.lap;
  walk(-30 - len, 20, 0.5); // forward again to where we started: still nothing
  const fwd = c.lap;
  walk(20, len + 5, 0.5); // one real lap
  const real = c.lap;
  if (a || b || back || fwd || real !== 1 || laps !== 1) fail(`laps: from the grid ${a}, rocking over the line ${b}, a lap backwards ${back}, back to the line ${fwd}, a real lap ${real} (${laps} events)`);
  else ok('laps: crossing from the grid, rocking back and forth over the line, and a whole lap backwards count nothing; one real lap counts one');
}

// ---------- 4: AI laps every track, every skill ----------
const SKILLS = [0.3, 0.6, 1];
const watch = () => ({ last: [], stuck: 0, out: 0, worst: 0 });
// a car is stuck when it gains under 8 m along the track in any 8 s of racing (sampled every
// half second; a mine's spin in the window excuses it)
function check(race, w, tag) {
  const s = race.s, g = race.geo, b = g.bounds;
  for (const c of s.cars) {
    if (!Number.isFinite(c.x + c.y + c.vx + c.vy + c.a + c.w + c.hp + c.prog)) { fail(`${tag}: car ${c.i} NaN`); return false; }
    if (c.x < b.x0 || c.x > b.x1 || c.y < b.y0 || c.y > b.y1) { w.out++; if (w.out < 3) fail(`${tag}: car ${c.i} out of the world at ${c.x.toFixed(1)},${c.y.toFixed(1)}`); }
    const q = g.nearest(c.x, c.y, c.d);
    if (Math.abs(q.off) > g.ws[q.i] / 2 + 0.3) { w.out++; if (w.out < 3) fail(`${tag}: car ${c.i} off the road (${q.off.toFixed(1)} of ${(g.ws[q.i] / 2).toFixed(1)})`); }
  }
  if (s.status !== 'race') return true;
  const k = Math.round(s.raceT * 60);
  if (k % 30) return true;
  // a mine's spin in the window excuses it: being blown round is not being stuck
  w.last.push(s.cars.map(c => (c.dead || c.done ? null : c.prog)));
  w.spun = (w.spun || []).concat([s.cars.map(c => c.spin > 0)]).slice(-17);
  if (w.last.length > 17) w.last.shift();
  if (w.last.length === 17) {
    s.cars.forEach((c, i) => {
      const a = w.last[0][i], z = w.last[16][i];
      if (a == null || z == null || w.spun.some(x => x[i])) return;
      if (z - a < 8) { w.stuck++; if (w.stuck < 4) fail(`${tag}: car ${i} stuck near ${c.d.toFixed(0)} m (gained ${(z - a).toFixed(1)} m in 8 s, ${s.raceT.toFixed(1)} s in)`); }
    });
  }
  return true;
}
function race1(T, seed, { skill, model, weapons, laps, cars }) {
  const kit = weapons ? { ammo: 50, mines: 3, turbo: 2 } : { ammo: 0, mines: 0, turbo: 0 };
  cars ??= [0, 1, 2, 3].map(i => entrant(i, typeof model === 'number' ? model : model[i], i ? { skill: typeof skill === 'number' ? skill : skill[i], aggression: weapons ? 0.2 + 0.25 * i : 0 } : null, kit));
  const race = createRace({ track: T, laps, seed, cars });
  const pilot = createPilot(race, 0, { skill: typeof skill === 'number' ? skill : skill[0], seed: seed * 7 + 1 });
  const w = watch(), laps0 = cars.map(() => []), last = cars.map(() => 0), cnt = {};
  const tag = `${T.id} seed ${seed}`, dmg = { gun: 0, mine: 0, crash: 0 };
  let hp = race.s.cars.map(c => c.hp);
  while (race.s.status !== 'done' && race.s.raceT < P.cap + 1) {
    race.step([pilot()]);
    // armour lost, by cause: bullets and mines say so in their hits; the rest is shunts and walls
    const now = race.s.cars.map(c => c.hp), booms = new Set(race.events.filter(e => e.k === 'boom').map(e => e.car));
    let hits = 0;
    for (const e of race.events) if (e.k === 'hit') { if (booms.has(e.car) && e.dmg === P.mineDmg) dmg.mine += e.dmg; else dmg.gun += e.dmg; hits += e.dmg; }
    dmg.crash += Math.max(0, hp.reduce((t, h, i) => t + Math.max(0, h - Math.max(0, now[i])), 0) - hits);
    hp = now;
    for (const e of race.events) {
      cnt[e.k] = (cnt[e.k] || 0) + 1;
      if (!EVENTS.has(e.k)) fail(`${tag}: unknown event ${e.k}`);
      if (e.k === 'lap' || e.k === 'finish') { laps0[e.car].push(race.s.raceT - last[e.car]); last[e.car] = race.s.raceT; }
    }
    if (!check(race, w, tag)) break;
  }
  return { race, laps: laps0, w, cnt, dmg, log: JSON.stringify(race.result()) };
}

const table = [];
for (const T of tracks) {
  const row = { id: T.id, laps: T.laps };
  for (const skill of SKILLS) {
    const lapT = [], raceT = [];
    let unfinished = 0, notDone = 0, stuck = 0;
    for (let k = 0; k < seeds; k++) {
      const seed = 100 + k * 17;
      // every car the mid car, so the times compare across skills
      const r = race1(T, seed, { skill, model: 1, weapons: false });
      if (r.race.s.status !== 'done') notDone++;
      stuck += r.w.stuck + r.w.out;
      for (const c of r.race.s.cars) if (!c.done) unfinished++;
      // the first lap starts from the grid; the flying laps are what we compare
      for (const l of r.laps) lapT.push(...l.slice(1));
      raceT.push(...r.race.s.cars.filter(c => c.done).map(c => c.finishT));
    }
    if (notDone) fail(`${T.id} skill ${skill}: ${notDone} races never reached 'done'`);
    // the 10 s run-on after car 0 finishes can cut a slow car short; nobody should be far behind
    if (unfinished > seeds * 0.5 && skill >= 0.6) fail(`${T.id} skill ${skill}: ${unfinished} cars unfinished in ${seeds} races`);
    row[skill] = { lap: avg(lapT), best: Math.min(...lapT), race: avg(raceT), unfinished };
    void stuck;
  }
  table.push(row);
  ok(`${T.id.padEnd(10)} AI (${MODELS[1].id}) flying laps — ${SKILLS.map(s => `skill ${s}: ${row[s].lap.toFixed(1)} s (best ${row[s].best.toFixed(1)})`).join(' · ')} · race at skill 0.6: ${fmt(row[0.6].race)}`);
}
// the starting junker and the champion, skill 0.6 and 1, for the career's balance
for (const T of tracks) {
  const out = [];
  for (const model of [0, MODELS.length - 1]) {
    const r = race1(T, 7, { skill: 1, model, weapons: false });
    const l = r.laps.flatMap(x => x.slice(1));
    out.push(`${MODELS[model].id}: ${avg(l).toFixed(1)} s/lap, race ${fmt(avg(r.race.s.cars.filter(c => c.done).map(c => c.finishT)))}`);
  }
  ok(`${T.id.padEnd(10)} skill 1 — ${out.join(' · ')}`);
}
{
  // determinism: the same seed replays the same race
  const T = tracks[0], a = race1(T, 42, { skill: 0.6, model: [0, 1, 2, 3], weapons: true }), b = race1(T, 42, { skill: 0.6, model: [0, 1, 2, 3], weapons: true });
  if (a.log !== b.log) fail('a seed does not replay the same race');
  else ok('a seed replays the same race, weapons and all');
}

// ---------- 5: full races with weapons, the career's own fields ----------
// a player (the pilot, skill 0.6) at three points of a career: the junker with the starting kit
// against the bottom of the ladder, a mid car against the middle, the best car against the top
const STAGES = [
  { name: 'start', model: 'dustpan', up: {}, kit: { ammo: 100, mines: 0, turbo: 1 }, rivals: ['pocket', 'sallow', 'wicks', 'varga'] },
  { name: 'middle', model: 'kestrel', up: { engine: 1, tyres: 1 }, kit: { ammo: 150, mines: 2, turbo: 2 }, rivals: ['rask', 'dunmore', 'okafor', 'grue'] },
  { name: 'top', model: 'bulwark', up: { engine: 2, tyres: 2, armour: 2 }, kit: { ammo: 250, mines: 4, turbo: 3 }, rivals: ['calloway', 'vex', 'harrow', 'quint'] },
  { name: 'final', model: 'bulwark', up: { engine: 3, tyres: 3, armour: 3 }, kit: { ammo: 300, mines: 5, turbo: 4 }, rivals: ['marrow', 'quint', 'harrow'] },
];
void DRIVERS; void offers;
for (const G of STAGES) {
  let wrecks = 0, meWrecked = 0, races = 0, secs = 0, kills = 0, picks = 0, booms = 0, shots = 0, wins = 0, armour = 0;
  const D = { gun: 0, mine: 0, crash: 0 };
  for (const T of tracks) for (let k = 0; k < seeds; k++) {
    const C = { ...newCareer({ seed: k + 1 }), model: G.model, up: G.up, ...G.kit };
    C.hp = C.maxHp = carStats(G.model, G.up).hp;
    const field = [...G.rivals];
    // three rivals from the stage's four, by seed
    if (field.length > 3) field.splice(k % field.length, 1);
    const cars = entrants(C, { rivals: field });
    const r = race1(T, 500 + k * 13, { skill: [0.6], cars });
    races++; secs += r.race.s.raceT;
    if (r.race.s.status !== 'done') fail(`${G.name} ${T.id}: a race with weapons never reached 'done'`);
    const res = r.race.result();
    wrecks += res.filter(x => x.wrecked).length; kills += res.reduce((a, x) => a + x.kills, 0);
    meWrecked += res.find(x => x.id === 'you').wrecked ? 1 : 0;
    wins += res[0].id === 'you' ? 1 : 0;
    picks += r.cnt.pickup || 0; booms += r.cnt.boom || 0; shots += r.cnt.shot || 0;
    for (const k in D) D[k] += r.dmg[k];
    armour += r.race.s.cars.reduce((t, c) => t + c.maxHp, 0) / 4;
    if (res.map(x => x.place).join() !== '1,2,3,4') fail(`${T.id}: places ${res.map(x => x.place).join()}`);
  }
  const share = k => `${((D[k] / races / armour) * races * 25).toFixed(0)}%`;
  if (wrecks / races > 1.5) fail(`${G.name}: ${(wrecks / races).toFixed(2)} wrecks a race`);
  ok(`weapons, ${G.name.padEnd(6)} (${G.model} vs ${G.rivals.join(', ')}): ${races} races, ${fmt(secs / races)} each, ${(wrecks / races).toFixed(2)} wrecks a race (the pilot in ${meWrecked}), ${(kills / races).toFixed(2)} kills, ${(shots / races).toFixed(0)} shots, ${(booms / races).toFixed(1)} booms, ${(picks / races).toFixed(1)} pickups; the pilot won ${wins}; armour lost per car per race: gun ${share('gun')}, mines ${share('mine')}, crashes ${share('crash')} of a full car`);
}

// ---------- 6: the demo soak ----------
if (soakMin > 0) {
  let t = 0, n = 0, rs = 1;
  const rnd = () => ((rs = (Math.imul(rs, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
  const per = {};
  try {
    while (t < soakMin * 60) {
      const T = TRACKS[Math.floor(rnd() * TRACKS.length)];
      const r = race1(T, 1000 + n, { skill: [0.75, 0.3 + rnd() * 0.7, 0.3 + rnd() * 0.7, 0.3 + rnd() * 0.7], model: [0, 1, 2, 3].map(() => Math.floor(rnd() * MODELS.length)), weapons: true });
      if (r.race.s.status !== 'done') fail(`soak: race ${n} on ${T.id} never ended`);
      t += r.race.s.t; n++;
      per[T.id] = (per[T.id] || 0) + 1;
    }
    ok(`soak: ${n} demo races back to back, ${(t / 60).toFixed(1)} simulated minutes, no exception (${Object.entries(per).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  } catch (e) {
    fail(`soak: ${e.stack}`);
  }
}

void CAR; void racingLine; void table;
console.log(bad ? `\n${bad} problem(s)` : '\nall good');
process.exit(bad ? 1 : 0);
