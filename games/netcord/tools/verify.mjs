// Proves Netcord's match sim, headless, on the real code (src/sim.js, src/ai.js, src/score.js,
// src/moves.js):
//   1. scoring: deuce and advantage back and forth, tiebreaks 7–5 and 8–6, a set 7–5, best of
//      three ending at two sets, the server's rotation (tiebreak order included), changes of ends;
//   2. physics: a flat 40 m/s serve lands in the box, topspin dips (shorter than flat from the
//      same launch), a slice sits lower after the bounce than a drive to the same spot, clay
//      bounces higher and slower than grass, a ball into the tape sometimes dribbles over and
//      sometimes falls back, nothing NaN;
//   3. a soak of CPU-vs-CPU one-set matches (--matches, default 240) between players of varied
//      ratings, styles and surfaces: no exception, nothing NaN or out of the world, no phase stuck,
//      no ball through the net; then the tennis: rally lengths, aces, double faults, winners and
//      errors a match, first serves in, the better player's share of wins, the surfaces apart;
//   4. the user, scripted through match.step: pressing at the ideal moment returns most balls in;
//      early pulls the ball cross-court and late pushes it down the line; the held direction moves
//      the landing spot; the assist puts the player where the swing meets the ball; without the
//      assist a user standing still misses the wide balls;
//   5. determinism: a seed and a scripted user replay the same match twice;
//   6. speed: milliseconds per simulated match.
//
//   mise exec -- node games/netcord/tools/verify.mjs [--matches 240]
import { COURT, DT, FLAGS, P, SURFACES, advance, aimShot, createMatch, netHeight, newBall } from '../src/sim.js';
import { createScore, pointWon, tiebreakServer } from '../src/score.js';
import { MOVES } from '../src/moves.js';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? +args[i + 1] : d; };
const MATCHES = opt('--matches', 240);
const EVENTS = new Set(['hit', 'bounce', 'net', 'let', 'fault', 'out', 'point', 'game', 'set', 'match', 'change', 'serve', 'swing', 'step', 'whiff']);
const PHASES = new Set(['serve', 'rally', 'point', 'change', 'over']);
let bad = 0;
const fail = msg => { bad++; console.log(`  ✗ ${msg}`); };
const ok = msg => console.log(`  ✓ ${msg}`);
const check = (cond, good, badMsg) => (cond ? ok(good) : fail(badMsg || good));
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, b) => `${b ? Math.round((a / b) * 100) : 0}%`;
const R = COURT.ball;

let seedR = 4242;
const rnd = () => ((seedR = (Math.imul(seedR, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
const STYLES = ['baseline', 'serve-volley', 'all-round', 'counter'];
const SURF = ['hard', 'clay', 'grass', 'indoor'];
function makePlayer(id, base, style = STYLES[Math.floor(rnd() * 4)], spread = 1) {
  const r = (k = 0) => Math.max(1, Math.min(9, Math.round(base + (rnd() - 0.5) * 2 * spread + k)));
  const sv = style === 'serve-volley';
  return {
    id, name: `Player ${id}`, short: id.toUpperCase(), country: 'ALM', hand: rnd() < 0.2 ? 'left' : 'right', height: 1.75 + rnd() * 0.2, style,
    ratings: { speed: r(style === 'counter' ? 1 : 0), power: r(sv ? 1 : 0), accuracy: r(), spin: r(style === 'baseline' ? 1 : 0), serve: r(sv ? 1 : 0), volley: r(sv ? 1.5 : style === 'baseline' ? -1 : 0), stamina: r() },
    kit: { shirt: '#ffffff', shorts: '#ffffff', band: '#c8102e' },
  };
}
const strength = p => { const r = p.ratings; return (r.speed + r.power + r.accuracy + r.spin + r.serve + r.volley * 0.5 + r.stamina * 0.25) / 5.75; };

// ---------- 1: scoring ----------
console.log('scoring');
{
  const sc = createScore({ sets: 3, server: 0, names: ['ANN', 'BEA'] });
  const seq = [];
  for (const w of [0, 0, 1, 1, 0, 1]) { pointWon(sc, w); seq.push(sc.label); }
  check(seq.join(',') === '15–0,30–0,30–15,30–30,40–30,DEUCE', `points: ${seq.join(', ')}`);
  pointWon(sc, 1); const a1 = sc.label; pointWon(sc, 1 - 1); const d1 = sc.label; pointWon(sc, 0); const a2 = sc.label; pointWon(sc, 1); const d2 = sc.label;
  check(a1 === 'ADV BEA' && d1 === 'DEUCE' && a2 === 'ADV ANN' && d2 === 'DEUCE', `deuce cycles: ${a1} → ${d1} → ${a2} → ${d2}`);
  pointWon(sc, 1); const r = pointWon(sc, 1);
  check(r.game === 1 && sc.games[1] === 1 && sc.server === 1 && sc.label === '0–0' && r.change, `the game to BEA from advantage, the serve passes, ends change after game 1`);
  // a set 7–5
  const s2 = createScore({ sets: 3, server: 0 });
  const game = (s, w) => { let r0; for (let k = 0; k < 4; k++) r0 = pointWon(s, w); return r0; };
  const changes = [];
  for (let g = 0; g < 10; g++) { const rr = game(s2, g % 2); changes.push(rr.change ? 1 : 0); }
  game(s2, 0); const r75 = game(s2, 0);
  check(s2.sets.length === 1 && s2.sets[0][0] === 7 && s2.sets[0][1] === 5 && r75.set === 0, `a set 7–5: ${JSON.stringify(s2.sets)}`);
  check(changes.join('') === '1010101010', `ends change after the odd games: ${changes.join('')}`);
  // a tiebreak 7–5 and its serving order
  const s3 = createScore({ sets: 3, server: 1 });
  for (let g = 0; g < 12; g++) game(s3, g % 2);
  check(s3.tiebreak && s3.label === 'TIEBREAK 0–0', `6–6 goes to a tiebreak (${s3.label})`);
  const tbFirst = s3.server, order = [s3.server], tbChanges = [];
  const pts = [0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 0];
  for (let k = 0; k < pts.length; k++) {
    const rr = pointWon(s3, pts[k]);
    if (rr.set < 0) { order.push(s3.server); tbChanges.push(rr.change ? k + 1 : 0); }
    else check(rr.set === 0 && s3.sets[0][0] === 7 && s3.sets[0][1] === 6 && s3.tbs[0] === 4 && rr.change, `tiebreak 7–4 wins the set 7–6 (${JSON.stringify(s3.sets)}, tb loser ${String(s3.tbs[0])})`);
  }
  const want = order.map((_, n) => tiebreakServer(tbFirst, n));
  check(order.join('') === want.join('') && order.slice(0, 5).join('') === [tbFirst, 1 - tbFirst, 1 - tbFirst, tbFirst, tbFirst].join(''), `tiebreak serving order ABBAABBA…: ${order.join('')}`);
  check(tbChanges.filter(Boolean).join(',') === '6', `tiebreak ends change after 6 points (${tbChanges.filter(Boolean).join(',')})`);
  check(s3.server === 1 - tbFirst && s3.games[0] === 0, `the next set opens with the other player serving`);
  // 8–6 tiebreak
  const s4 = createScore({ sets: 1, server: 0 });
  for (let g = 0; g < 12; g++) game(s4, g % 2);
  for (const w of [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]) pointWon(s4, w);
  check(s4.label === 'TIEBREAK 6–6' || s4.label === 'TIEBREAK 6–6'.replace('6–6', '6–6'), `tiebreak at 6–6 goes on (${s4.label})`);
  pointWon(s4, 1); const before = s4.done; const rr8 = pointWon(s4, 1);
  check(!before && rr8.match === 1 && s4.done && s4.winner === 1 && s4.sets[0][1] === 7 && s4.tbs[0] === 6, `tiebreak 8–6 ends a best-of-one (${JSON.stringify(s4.sets)}, tb 8–${String(s4.tbs[0])})`);
  // best of 3
  const s5 = createScore({ sets: 3, server: 0 });
  for (let g = 0; g < 6; g++) game(s5, 0);
  for (let g = 0; g < 6; g++) game(s5, 1);
  check(!s5.done && s5.won[0] === 1 && s5.won[1] === 1, 'one set all: on to a third');
  let rm; for (let g = 0; g < 6; g++) rm = game(s5, 0);
  check(s5.done && rm.match === 0 && s5.winner === 0 && s5.sets.length === 3 && s5.label === 'MATCH', `best of three ends at two sets: ${JSON.stringify(s5.sets)}`);
  // server rotation over a set
  const s6 = createScore({ sets: 3, server: 1 }), servers = [];
  for (let g = 0; g < 6; g++) { servers.push(s6.server); game(s6, 0); }
  check(servers.join('') === '101010' && s6.server === 1 && s6.games[0] === 0, `the server alternates game by game, and on into the next set: ${servers.join('')} → ${s6.server}`);
}

// ---------- 2: physics ----------
console.log('\nphysics');
const fly = (b, surf, maxT = 6, onBounce = null) => {
  const surface = SURFACES[surf] || SURFACES.hard, info = { bx: 0, bz: 0, vin: 0 };
  let flags = 0, land = null, n = 0, apex2 = 0, after = null;
  for (let t = 0; t < maxT; t += DT) {
    const f = advance(b, surface, 0.5, info);
    flags |= f;
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) if (!Number.isFinite(b[k])) return { nan: true };
    if (f & FLAGS.BOUNCE) {
      n++;
      if (n === 1) { land = { x: info.bx, z: info.bz, t, vin: info.vin }; after = { vx: b.vx, vy: b.vy, vz: b.vz }; onBounce?.(b); }
      if (n === 2) break;
    }
    if (n === 1) apex2 = Math.max(apex2, b.y);
  }
  return { flags, land, apex2, after };
};
const launch = (x, y, z, vx, vy, vz, spin = [0, 0, 0]) => Object.assign(newBall(), { x, y, z, vx, vy, vz, spin: spin.slice() });
{
  // a flat serve at 40 m/s from 2.75 m, aimed by the solver into the deuce box, flown by the sim
  const out = { vx: 0, vy: 0, vz: 0, spin: [0, 0, 0], cross: 0, t: 0 };
  const c = { x: 0.7, y: 2.75, z: 12.1 };
  aimShot(c, -2.3, -5.6, 40, 30, 0, 0.05, out);
  const r = fly(launch(c.x, c.y, c.z, out.vx, out.vy, out.vz, out.spin), 'hard');
  const inBox = r.land && r.land.x <= R && r.land.x >= -COURT.halfW - R && r.land.z <= 0 && r.land.z >= -COURT.service - R;
  check(inBox && !(r.flags & (FLAGS.NET | FLAGS.CORD)), `a flat 40 m/s serve lands in the box at (${r.land?.x.toFixed(2)}, ${r.land?.z.toFixed(2)}), clearing the tape by ${out.cross.toFixed(2)} m`);
  // a fixed launch too: 40 m/s, 6.2° down from 2.8 m at the T
  const a = (-6.2 * Math.PI) / 180, r2 = fly(launch(0.3, 2.8, 12.1, 0, 40 * Math.sin(a), -40 * Math.cos(a)), 'hard');
  check(r2.land && Math.abs(r2.land.z) <= COURT.service && r2.land.z < 0 && !(r2.flags & FLAGS.NET), `a fixed 40 m/s flat serve, 6.2° down, lands at z ${r2.land?.z.toFixed(2)} (the box ends at −6.40)`);

  // topspin dips: the same launch with and without topspin
  const v = 28, ang = (8 * Math.PI) / 180;
  const flat = fly(launch(0, 1, 11.5, 0, v * Math.sin(ang), -v * Math.cos(ang)), 'hard');
  const tops = fly(launch(0, 1, 11.5, 0, v * Math.sin(ang), -v * Math.cos(ang), [-250, 0, 0]), 'hard');
  check(tops.land && flat.land && tops.land.z > flat.land.z + 1, `topspin dips: from the same launch it lands at z ${tops.land?.z.toFixed(2)}, flat at ${flat.land?.z.toFixed(2)}`);
  // the same landing spot from a drive and a slice: the slice stays lower after it
  const target = [0, -9.5];
  aimShot({ x: 0, y: 1, z: 11.5 }, target[0], target[1], 27, 220, 0, 0.4, out);
  const dr = fly(launch(0, 1, 11.5, out.vx, out.vy, out.vz, out.spin), 'hard');
  aimShot({ x: 0, y: 1, z: 11.5 }, target[0], target[1], 22, -120, 0, 0.4, out);
  const sl = fly(launch(0, 1, 11.5, out.vx, out.vy, out.vz, out.spin), 'hard');
  check(sl.apex2 < dr.apex2 - 0.15, `a slice skids low: after the bounce it rises to ${sl.apex2.toFixed(2)} m, a drive to the same spot to ${dr.apex2.toFixed(2)} m`);
  // clay vs grass: the same ball
  const mk = () => launch(0, 1.0, -2, 0, -3.5, -30, [-60, 0, 0]); // a flat drive, low and fast
  const cl = fly(mk(), 'clay'), gr = fly(mk(), 'grass'), hd = fly(mk(), 'hard');
  const hv = r0 => Math.hypot(r0.after.vx, r0.after.vz);
  check(cl.apex2 > hd.apex2 && hd.apex2 > gr.apex2 && hv(cl) < hv(hd) && hv(hd) < hv(gr), `surfaces: the same ball bounces to ${cl.apex2.toFixed(2)} m at ${hv(cl).toFixed(1)} m/s on clay, ${hd.apex2.toFixed(2)} m at ${hv(hd).toFixed(1)} on hard, ${gr.apex2.toFixed(2)} m at ${hv(gr).toFixed(1)} on grass`);
  // the tape: balls into the top of the net at heights around it
  let over = 0, back = 0, mesh = 0;
  for (let k = 0; k < 60; k++) {
    const yAt = netHeight(0.5) - 0.04 + (k / 59) * 0.12;
    // a 14 m/s ball (a little topspin) that would cross the net at yAt: 0.5 m before it, level
    const b = launch(0.5, yAt + 0.006, 0.5, 0, 0, -14, [-40, 0, 0]);
    let netted = false, f = 0, side = 0;
    for (let t = 0; t < 4; t += DT) {
      f = advance(b, SURFACES.hard, 0.5);
      if (f & (FLAGS.CORD | FLAGS.NET)) netted = true;
      if (f & FLAGS.BOUNCE) { side = b.z; break; }
    }
    if (!netted) continue;
    if (side < 0) over++;
    else if (f & FLAGS.NET) mesh++;
    else back++;
  }
  check(over > 0 && back + mesh > 0, `the tape: of the balls that touched it ${over} dribbled over and ${back + mesh} fell back`);
  // nothing NaN from wild launches
  let nan = 0;
  for (let k = 0; k < 300; k++) {
    const r0 = fly(launch((rnd() - 0.5) * 8, 0.2 + rnd() * 3, (rnd() - 0.5) * 24, (rnd() - 0.5) * 40, (rnd() - 0.3) * 30, (rnd() - 0.5) * 70, [(rnd() - 0.5) * 600, (rnd() - 0.5) * 300, (rnd() - 0.5) * 600]), SURF[k % 4], 8);
    if (r0.nan) nan++;
  }
  check(nan === 0, '300 wild launches on every surface: nothing NaN', `${nan} launches went NaN`);
}

// ---------- 3: the soak ----------
function sane(s, where) {
  const b = s.ball;
  for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) if (!Number.isFinite(b[k])) return `${where}: ball.${k} = ${b[k]}`;
  if (b.spin.some(w => !Number.isFinite(w))) return `${where}: ball spin`;
  if (Math.abs(b.x) > COURT.backX + 0.1 || Math.abs(b.z) > COURT.backZ + 0.1 || b.y < 0 || b.y > 40) return `${where}: ball out of the world at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`;
  for (let i = 0; i < 2; i++) {
    const p = s.players[i];
    for (const k of ['x', 'z', 'vx', 'vz', 'yaw', 'moveT', 'phase', 'speed', 'charge']) if (!Number.isFinite(p[k])) return `${where}: player ${i}.${k} = ${p[k]}`;
    if (!MOVES[p.move]) return `${where}: player ${i} move ${p.move}`;
    if (p.z * s.end[i] < 0.3) return `${where}: player ${i} over the net at ${p.z.toFixed(2)}`;
    if (p.speed > 9) return `${where}: player ${i} at ${p.speed.toFixed(1)} m/s`;
  }
  if (!PHASES.has(s.phase)) return `${where}: phase ${s.phase}`;
  return null;
}
/** a match to the end, watched: returns the counts, problems, and per-point records */
function play(players, surface, seed, { user = null, cpu = [true, true], assist = true, watch = true, sets = 1 } = {}) {
  const m = createMatch({ players, surface, sets, cpu, seed, assist });
  const s = m.s, cnt = {}, problems = [], rallies = [];
  let steps = 0, hash = 0;
  const phaseMax = {};
  const cap = Math.ceil(3 * 3600 / DT);
  let px = s.ball.x, py = s.ball.y, pz = s.ball.z, idle = 0, idleMax = 0;
  while (!m.done && steps < cap) {
    m.step([user ? user(m, 0) : null, null]);
    steps++;
    let netEv = false;
    for (const e of m.events) {
      cnt[e.type] = (cnt[e.type] || 0) + 1;
      if (!EVENTS.has(e.type)) problems.push(`unknown event ${e.type}`);
      if (e.type === 'hit') cnt[`hit:${e.kind}`] = (cnt[`hit:${e.kind}`] || 0) + 1;
      if (e.type === 'point') { cnt[`point:${e.how}`] = (cnt[`point:${e.how}`] || 0) + 1; rallies.push(s.rally); }
      if (e.type === 'net') netEv = true;
      if (e.type === 'hit') idle = 0;
      hash = (Math.imul(hash ^ (e.type.length * 131 + (e.player ?? e.winner ?? 0)), 16777619) + steps) | 0;
    }
    m.events.length = 0;
    const b = s.ball;
    if (watch) {
      phaseMax[s.phase] = Math.max(phaseMax[s.phase] || 0, s.phaseT);
      if (s.phase === 'rally' && b.live) idleMax = Math.max(idleMax, (idle += DT));
      // through the net: a crossing under the tape with no touch of it
      if (!b.inHand && pz !== 0 && pz > 0 !== b.z > 0 && !netEv) {
        const u = pz / (pz - b.z), xc = px + (b.x - px) * u, yc = py + (b.y - py) * u;
        if (Math.abs(xc) < COURT.postX - 0.1 && yc < netHeight(xc) - 0.02) problems.push(`the ball went through the net at x ${xc.toFixed(2)} y ${yc.toFixed(2)} (t ${s.t.toFixed(1)})`);
      }
      if (steps % 5 === 0) {
        const e = sane(s, `seed ${seed} t ${s.t.toFixed(2)} ${s.phase}`);
        if (e) { problems.push(e); break; }
      }
    }
    px = b.x; py = b.y; pz = b.z;
  }
  if (!m.done) problems.push(`never finished (phase ${s.phase}, ${s.score.label}, t ${s.t.toFixed(0)})`);
  if (watch) {
    if (!user && (phaseMax.serve || 0) > 8) problems.push(`a serve waited ${phaseMax.serve.toFixed(1)} s`);
    if (idleMax > 12) problems.push(`a ball in play went ${idleMax.toFixed(1)} s untouched`);
    if ((phaseMax.point || 0) > P.pointT + 0.1) problems.push(`a point's pause ran ${phaseMax.point.toFixed(1)} s`);
    if ((phaseMax.change || 0) > P.changeT + 0.1) problems.push(`a change of ends ran ${phaseMax.change.toFixed(1)} s`);
  }
  hash = (hash ^ Math.round(s.ball.x * 1e6) ^ Math.round(s.players[0].x * 1e6)) | 0;
  return { m, s, cnt, problems, rallies, steps, hash, res: m.result() };
}

console.log(`\nsoak: ${MATCHES} CPU-vs-CPU one-set matches`);
const T0 = performance.now();
let simSecs = 0, exceptions = 0, better = 0, decisive = 0;
const per = { rally: [], aces: [], df: [], winners: [], errors: [], first: [], points: [], whiff: [], net: [], out: [] };
const bySurf = Object.fromEntries(SURF.map(k => [k, { rally: [], aces: [], n: 0 }]));
const allRallies = [], tally = {};
for (let n = 0; n < MATCHES; n++) {
  const gap = rnd() * 2.2, lo = 3.5 + rnd() * (5 - gap);
  const strongFirst = rnd() < 0.5;
  const A = makePlayer(`a${n}`, strongFirst ? lo + gap : lo), B = makePlayer(`b${n}`, strongFirst ? lo : lo + gap);
  const surface = SURF[n % 4];
  let r;
  try { r = play([A, B], surface, 1000 + n * 7919); } catch (e) { exceptions++; fail(`match ${n}: ${e.stack}`); continue; }
  for (const p of r.problems.slice(0, 3)) fail(`match ${n} (${surface}): ${p}`);
  simSecs += r.s.t;
  const st = r.res.stats, sum = k => st[0][k] + st[1][k];
  per.rally.push(avg(r.rallies)); per.aces.push(sum('aces')); per.df.push(sum('doubleFaults')); per.winners.push(sum('winners')); per.errors.push(sum('errors'));
  per.first.push((st[0].firstServe[0] + st[1].firstServe[0]) / Math.max(1, st[0].firstServe[1] + st[1].firstServe[1]));
  per.points.push(r.rallies.length); per.whiff.push(r.cnt.whiff || 0); per.net.push(r.cnt['point:net'] || 0); per.out.push(r.cnt['point:out'] || 0);
  allRallies.push(...r.rallies);
  for (const k in r.cnt) tally[k] = (tally[k] || 0) + r.cnt[k];
  bySurf[surface].rally.push(avg(r.rallies)); bySurf[surface].aces.push(sum('aces')); bySurf[surface].n++;
  const sA = strength(A), sB = strength(B);
  if (Math.abs(sA - sB) >= 0.8) { decisive++; if (r.res.winner === (sA > sB ? 0 : 1)) better++; }
  const sets = r.res.sets;
  if (r.res.winner < 0 || sets.length !== 1 || Math.max(...sets[0]) < 6) fail(`match ${n}: result ${JSON.stringify(r.res.sets)} winner ${r.res.winner}`);
}
const msPer = (performance.now() - T0) / MATCHES;
{
  const N = per.rally.length;
  check(exceptions === 0, `${N} matches, no exception, nothing stuck, NaN or through the net`, `${exceptions} matches threw`);
  const rm = avg(allRallies);
  const hist = [1, 2, 3, 4, 5, 6, 8, 10, 15, 99].map((top, k, a) => { const lo = k ? a[k - 1] + 1 : 1; return `${lo === top ? top : top === 99 ? `${lo}+` : `${lo}–${top}`}:${pct(allRallies.filter(x => x >= lo && x <= top).length, allRallies.length)}`; });
  check(rm >= 4 && rm <= 8, `shots a point: mean ${rm.toFixed(2)} (${hist.join(' ')})`, `shots a point: mean ${rm.toFixed(2)} (want 4–8): ${hist.join(' ')}`);
  const a = k => avg(per[k]);
  const line = `a set: ${a('points').toFixed(0)} points, ${a('aces').toFixed(1)} aces, ${a('df').toFixed(2)} double faults, ${a('winners').toFixed(1)} winners (aces in), ${a('errors').toFixed(1)} errors (${a('out').toFixed(1)} out, ${a('net').toFixed(1)} net), first serves in ${(a('first') * 100).toFixed(0)}%, ${a('whiff').toFixed(1)} swings missed`;
  const plaus = a('aces') >= 0.5 && a('aces') <= 6 && a('df') >= 0.2 && a('df') <= 3 && a('first') >= 0.5 && a('first') <= 0.75 && a('errors') > a('winners') * 0.6 && a('net') >= a('out') * 0.2;
  check(plaus, line, `implausible: ${line}`);
  const T = k => ((tally[k] || 0) / N).toFixed(1);
  console.log(`    a set's shots: ${T('hit:serve')} serves, ${T('hit:drive')} drives, ${T('hit:slice')} slices, ${T('hit:volley')} volleys, ${T('hit:smash')} smashes, ${T('hit:lob')} lobs, ${T('hit:drop')} drops; ${T('net')} net touches, ${T('let')} lets`);
  const wr = better / Math.max(1, decisive);
  check(wr >= 0.65 && wr <= 0.85, `the better player (by ≥ 0.8 rating) wins ${(wr * 100).toFixed(0)}% of ${decisive}`, `the better player wins ${(wr * 100).toFixed(0)}% of ${decisive} (want 65–85%)`);
  const S = k => `${k} ${avg(bySurf[k].rally).toFixed(2)} shots, ${avg(bySurf[k].aces).toFixed(1)} aces`;
  check(avg(bySurf.grass.aces) > avg(bySurf.clay.aces) && avg(bySurf.grass.rally) < avg(bySurf.clay.rally), `surfaces: ${SURF.map(S).join('; ')}`, `surfaces don't differ as they should: ${SURF.map(S).join('; ')}`);
}

// ---------- 4: the user ----------
// presses for a human player 0 against a CPU: at the ideal moment (the assist's plan) shifted by
// `offset` s, holding `x, y` and the button through to the contact; serves tossed and hit on time
const swingOf = m => m.debug.M[0].plan;
function scripted({ offset = 0, x = 0, fwd = 0, button = 'a', serveOffset = 0 } = {}) {
  let holdUntil = -1, btn = button, lastGen = -1;
  return m => {
    const s = m.s, p = s.players[0], b = s.ball, M0 = m.debug.M[0], step = m.debug.stepNo() + 1;
    let a = false, bb = false;
    const y = -fwd * s.end[0]; // the stick toward the opponent, on screen
    if (step <= holdUntil) { if (btn === 'a') a = true; else bb = true; }
    else if (s.phase === 'serve' && s.server === 0) {
      if (M0.toss === 'bounce' && s.phaseT > 1) { btn = 'a'; holdUntil = step + 6; a = true; }
      else if (p.move === 'serve' && !b.inHand && M0.swing && M0.swing.contact < 0) {
        const ideal = MOVES.serve.contact - P.serveLead + serveOffset;
        if (p.moveT >= ideal) { btn = 'a'; holdUntil = step + 20; a = true; }
      }
    } else if (b.live && b.last === 1 && !M0.swing && b.gen !== lastGen) {
      const pl = swingOf(m);
      if (pl.gen === b.gen && pl.ok && !pl.leave) {
        const press = pl.step - Math.round(MOVES[pl.move].contact / DT) + Math.round(offset / DT);
        if (step >= press) { btn = button; holdUntil = step + 30; lastGen = b.gen; if (btn === 'a') a = true; else bb = true; }
      }
    }
    return { x, y, a, b: bb };
  };
}
/** the user's shots in a few matches: each { landed in?, x, z, side, kind } */
function userShots(opts, { matches = 3, surface = 'hard', assist = true, opp = 5 } = {}) {
  const shots = [], misses = { whiff: 0, coming: 0 };
  let standErr = [];
  for (let k = 0; k < matches; k++) {
    seedR = 777 + k;
    const A = makePlayer('you', 6, 'all-round', 0), B = makePlayer('cpu', opp, 'baseline', 0);
    A.hand = 'right';
    const m = createMatch({ players: [A, B], surface, sets: 1, cpu: [false, true], seed: 50 + k, assist });
    const user = scripted(opts);
    let cur = null, steps = 0;
    while (!m.done && steps < 60 * 60 * 40) {
      m.step([user(m), null]);
      steps++;
      for (const e of m.events) {
        if (e.type === 'swing' && e.player === 0) cur = { move: e.move };
        if (e.type === 'hit' && e.player === 0 && e.kind !== 'serve') {
          const pl = m.debug.M[0].plan;
          standErr.push(Math.hypot(m.s.players[0].x - pl.sx, m.s.players[0].z - pl.sz));
          cur = { move: cur?.move, x0: m.s.ball.x, e: m.s.end[0], hand: m.s.players[0].hand, landed: null };
          shots.push(cur);
        }
        if (e.type === 'whiff' && e.player === 0) misses.whiff++;
        if (e.type === 'bounce' && cur && cur.landed === null && m.s.ball.last === 0 && !e.dribble) { cur.landed = e.in; cur.x = e.x; cur.z = e.z; }
        if (e.type === 'point' && cur && cur.landed === null) cur.landed = false;
      }
      m.events.length = 0;
    }
  }
  return { shots, misses, standErr };
}
console.log('\nthe user');
{
  const on = userShots({});
  const inn = on.shots.filter(s0 => s0.landed).length;
  check(on.shots.length > 30 && inn / on.shots.length >= 0.75, `pressing at the ideal moment: ${inn} of ${on.shots.length} returns in (${pct(inn, on.shots.length)}), ${on.misses.whiff} swings missed`, `pressing on time: only ${inn} of ${on.shots.length} in, ${on.misses.whiff} missed`);
  const se = on.standErr.length ? Math.max(...on.standErr) : 99;
  check(avg(on.standErr) < 0.12 && se < 0.6, `the assist puts the player on the stroke's stand point: off by ${avg(on.standErr).toFixed(2)} m on average (${se.toFixed(2)} at most)`);
  // early and late: how far across the ball goes from where it was struck, toward the pulled side
  const pull = r => {
    const v = r.shots.filter(s0 => s0.landed !== null && s0.x !== undefined && /hand/.test(s0.move || ''));
    return avg(v.map(s0 => { const side = /^backhand|Backhand|B$/.test(s0.move) ? -1 : 1; return (s0.x * -(side * s0.hand * s0.e)); }));
  };
  const early = userShots({ offset: -0.16 }), late = userShots({ offset: 0.1 });
  const pe = pull(early), pn = pull(on), pl0 = pull(late);
  check(pe > pn + 0.7 && pl0 < pn - 0.7, `early pulls cross-court, late pushes down the line: the landing ${pe.toFixed(2)} m toward the pull side early, ${pn.toFixed(2)} on time, ${pl0.toFixed(2)} late`);
  const inE = early.shots.filter(s0 => s0.landed).length / Math.max(1, early.shots.length), inL = late.shots.filter(s0 => s0.landed).length / Math.max(1, late.shots.length);
  console.log(`    in: early ${pct(inE, 1)}, late ${pct(inL, 1)}`);
  // the held direction
  const left = userShots({ x: -1 }, { matches: 2 }), right = userShots({ x: 1 }, { matches: 2 });
  const deep = userShots({ fwd: 1 }, { matches: 2 }), shortr = userShots({ fwd: -1 }, { matches: 2 });
  const mx = r => avg(r.shots.filter(s0 => s0.x !== undefined).map(s0 => s0.x));
  const mz = r => avg(r.shots.filter(s0 => s0.z !== undefined).map(s0 => Math.abs(s0.z)));
  check(mx(right) - mx(left) > 3.5 && mz(deep) - mz(shortr) > 1.5, `the held direction aims: left lands at x ${mx(left).toFixed(2)}, right at ${mx(right).toFixed(2)}; up (deep) ${mz(deep).toFixed(2)} m from the net, down (short) ${mz(shortr).toFixed(2)}`);
  // b: slices, lobs (b + up) and drops (b + down)
  const kinds = {};
  for (const [nm, o] of [['slice', { button: 'b' }], ['lob', { button: 'b', fwd: 1 }], ['drop', { button: 'b', fwd: -1 }]]) {
    seedR = 99;
    const A = makePlayer('you', 6, 'all-round', 0), B = makePlayer('cpu', 5, 'baseline', 0);
    const m = createMatch({ players: [A, B], surface: 'hard', sets: 1, cpu: [false, true], seed: 9, assist: true });
    const user = scripted(o);
    const c = {};
    for (let k = 0; k < 60 * 240 && !m.done; k++) {
      m.step([user(m), null]);
      for (const e of m.events) if (e.type === 'hit' && e.player === 0 && e.kind !== 'serve') c[e.kind] = (c[e.kind] || 0) + 1;
      m.events.length = 0;
    }
    kinds[nm] = c;
  }
  const top = c => Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
  check(top(kinds.slice) === 'slice' && top(kinds.lob) === 'lob' && top(kinds.drop) === 'drop', `b slices, b + up lobs, b + down drops: ${JSON.stringify(kinds)}`);
  // no assist: standing still in the middle of the baseline, pressing when the ball is ~0.45 s off
  {
    let near = 0, nearHit = 0, wide = 0, wideHit = 0;
    for (let k = 0; k < 3; k++) {
      seedR = 300 + k;
      const A = makePlayer('you', 6, 'all-round', 0), B = makePlayer('cpu', 6, 'baseline', 0);
      const m = createMatch({ players: [A, B], surface: 'hard', sets: 1, cpu: [false, true], seed: 70 + k, assist: false });
      let steps = 0, gen = -1, landX = null, reach = false;
      while (!m.done && steps < 60 * 60 * 20) {
        const s = m.s, b = s.ball, p = s.players[0];
        let a = false;
        if (s.phase === 'serve' && s.server === 0) a = (m.debug.M[0].toss === 'bounce' && s.phaseT > 1) || (p.move === 'serve' && !b.inHand && p.moveT >= MOVES.serve.contact - P.serveLead && m.debug.M[0].swing?.contact < 0);
        else if (b.live && b.last === 1 && b.gen !== gen && !b.serve) {
          // the moment the sim would call ideal for a player standing where he is
          const c = m.debug.closest(0, 'drive', p.x, p.z);
          if (c.step >= 0 && m.debug.stepNo() + 1 >= c.step - Math.round(MOVES[c.move].contact / DT)) {
            a = true; gen = b.gen;
            landX = m.debug.PX[c.step - m.debug.path.step];
            reach = c.d <= 1;
          }
        }
        m.step([{ x: 0, y: 0, a, b: false }, null]);
        steps++;
        for (const e of m.events) {
          if (e.type === 'hit' && e.player === 0 && e.kind !== 'serve' && landX !== null) {
            if (Math.abs(landX - p.x) > 2) wideHit++; else if (reach) nearHit++;
          }
          if ((e.type === 'whiff' && e.player === 0 && landX !== null) || (e.type === 'hit' && e.player === 0 && e.kind !== 'serve' && landX !== null)) {
            if (Math.abs(landX - p.x) > 2) wide++; else if (reach) near++;
            landX = null;
          }
        }
        m.events.length = 0;
      }
    }
    check(wide > 5 && wideHit / wide < 0.25 && nearHit / Math.max(1, near) > 0.7, `no assist, standing still: ${nearHit} of ${near} balls within his reach returned, ${wideHit} of ${wide} wide ones (over 2 m off)`);
  }
}

// practice: the machine feeds, the partner rallies, no score moves and it never ends
{
  const res = [];
  for (const pr of ['machine', 'partner']) {
    seedR = 5;
    const m = createMatch({ players: [makePlayer('me', 6, 'all-round', 0), makePlayer('pt', 5, 'baseline', 0)], surface: 'hard', sets: 1, cpu: [false, true], seed: 5, practice: pr });
    const user = scripted({});
    let hits = 0, feeds = 0;
    for (let k = 0; k < 60 * 120; k++) {
      m.step([user(m), null]);
      for (const e of m.events) { if (e.type === 'hit' && e.player === 0 && e.kind !== 'serve') hits++; if (e.type === 'hit' && e.player === 1) feeds++; }
      m.events.length = 0;
    }
    const sc = m.s.score;
    res.push({ pr, hits, feeds, still: sc.games[0] + sc.games[1] + sc.points[0] + sc.points[1] === 0 && !m.done && sc.label === 'PRACTICE' });
  }
  check(res.every(r => r.hits > 12 && r.feeds > 12 && r.still), `practice: ${res.map(r => `${r.pr} ${r.feeds} balls from the other end, ${r.hits} returned`).join('; ')}, no score kept`);
}

// ---------- 5: determinism ----------
console.log('\ndeterminism');
{
  const run = () => {
    seedR = 31337;
    const A = makePlayer('d1', 6), B = makePlayer('d2', 6);
    return play([A, B], 'clay', 4242, { user: scripted({ offset: 0.03, x: 0.4 }), cpu: [false, true], watch: false });
  };
  const r1 = run(), r2 = run();
  check(r1.hash === r2.hash && r1.steps === r2.steps && JSON.stringify(r1.res) === JSON.stringify(r2.res), `a seed and a scripted user replay the same match: ${r1.steps} steps, ${JSON.stringify(r1.res.sets)}, hash ${r1.hash}`);
}

// ---------- 6: speed ----------
console.log('\nspeed');
check(msPer < 300, `${msPer.toFixed(0)} ms per simulated one-set match (${(simSecs / MATCHES / (msPer / 1000)).toFixed(0)}× real time)`, `${msPer.toFixed(0)} ms per match`);

console.log(bad ? `\nFAIL: ${bad} check${bad > 1 ? 's' : ''} failed` : '\nPASS');
process.exit(bad ? 1 : 0);
