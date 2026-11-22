// Proves Swerve's match sim, headless, on the real code (src/sim.js, src/ai.js, src/tactics.js):
//   1. the formations: every one has eleven slots, a keeper first, and sane coordinates;
//   2. a soak of CPU-vs-CPU league matches (--matches, default 200) between sides of varied
//      strength: no exception, nothing NaN or out of the world, no phase stuck (a dead ball taken
//      within 6 s, no ball in play untouched for 20 s), every match reaching 'over'; then the
//      football: goals (mean, histogram), the stronger side's results, shots, saves, corners,
//      fouls and cards a match;
//   3. knockout matches between equal sides: a draw goes to extra time, a draw after that to a
//      shoot-out that ends with a winner, five each and then sudden death;
//   4. determinism: a seed and a scripted user replay the same match twice;
//   5. the user's controls through match.step: a tap pass reaches the teammate it was aimed at,
//      a held kick goes harder and further than a tap, aftertouch across the flight curls the ball
//      and back lifts it, a slide wins the ball from a dribbler sometimes and fouls him sometimes,
//      and a scripted user dribbles upfield and scores against a weak side;
//   6. speed: milliseconds per simulated match.
//
//   mise exec -- node games/swerve/tools/verify.mjs [--matches 200] [--ko 40]
import { DT, P, PITCH, createMatch } from '../src/sim.js';
import { FORMATIONS, FORMATION_KEYS } from '../src/tactics.js';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? +args[i + 1] : d; };
const MATCHES = opt('--matches', 200), KO = opt('--ko', 40);
const EVENTS = new Set(['kick', 'bounce', 'post', 'bar', 'net', 'save', 'tackle', 'foul', 'card', 'whistle', 'out', 'goal', 'chance', 'kickoff', 'halftime', 'fulltime', 'penalty', 'pen', 'end']);
const PHASES = new Set(['kickoff', 'play', 'setpiece', 'goal', 'halftime', 'fulltime', 'pens', 'over']);
const ANIMS = new Set(['stand', 'run', 'kick', 'slide', 'header', 'dive', 'catch', 'down', 'celebrate', 'throw']);
let bad = 0;
const fail = msg => { bad++; console.log(`  ✗ ${msg}`); };
const ok = msg => console.log(`  ✓ ${msg}`);
const check = (cond, good, badMsg) => (cond ? ok(good) : fail(badMsg || good));
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const { W, L } = PITCH, CX = W / 2;

// ---------- test sides (clubs.js is the app's; these are the verifier's own) ----------
let seedR = 12345;
const rnd = () => ((seedR = (Math.imul(seedR, 1103515245) + 12345) | 0) >>> 0) / 4294967296;
const SURNAMES = ['Arlow', 'Brenn', 'Caddick', 'Dunmore', 'Ettle', 'Fairweather', 'Gorran', 'Hask', 'Ivell', 'Jessop', 'Kember', 'Lusk', 'Mallow', 'Nettleton', 'Orrin', 'Pruett', 'Quill', 'Rudd', 'Sallis', 'Tumber', 'Ulley', 'Varrow'];
function makeTeam(id, base, formation = '4-4-2', spread = 1) {
  const slots = FORMATIONS[formation].slots;
  const r = (v, k = 0) => Math.max(1, Math.min(9, Math.round(v + (rnd() - 0.5) * 2 * spread + k)));
  return {
    id, name: `${id} Town`, short: id.slice(0, 3).toUpperCase(), formation,
    kit: { shirt: '#c8102e', shorts: '#ffffff', socks: '#c8102e', trim: '#ffffff', pattern: 'plain' },
    gk: { shirt: '#2a9d3f', shorts: '#111111', socks: '#2a9d3f' },
    players: slots.map((sl, k) => {
      const role = sl.role;
      return {
        id: `${id}${k}`, name: SURNAMES[(k * 7 + id.length * 3) % SURNAMES.length], num: k + 1, pos: role,
        pace: r(base, role === 'FW' ? 0.5 : 0), shooting: r(base, role === 'FW' ? 1 : role === 'DF' ? -1 : 0), passing: r(base, role === 'MF' ? 0.5 : 0),
        tackling: r(base, role === 'DF' ? 1 : role === 'FW' ? -1 : 0), keeping: role === 'GK' ? r(base, 0.5) : 1,
      };
    }),
  };
}
const strength = t => avg(t.players.slice(1).map(p => (p.pace + p.shooting + p.passing + p.tackling) / 4)) * 0.85 + t.players[0].keeping * 0.15;

// every number in the state finite, everyone in the world
function sane(s, where) {
  const b = s.ball;
  for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'spin']) if (!Number.isFinite(b[k])) return `${where}: ball.${k} = ${b[k]}`;
  if (b.x < -6 || b.x > W + 6 || b.y < -7 || b.y > L + 7 || b.z < 0 || b.z > 60) return `${where}: ball out of the world at ${b.x.toFixed(1)},${b.y.toFixed(1)},${b.z.toFixed(1)}`;
  if (!Number.isInteger(b.owner) || b.owner < -1 || b.owner > 21 || !Number.isInteger(b.last) || b.last < -1 || b.last > 21) return `${where}: ball owner ${b.owner} last ${b.last}`;
  for (let i = 0; i < 22; i++) {
    const p = s.players[i];
    for (const k of ['x', 'y', 'vx', 'vy', 'dir', 'animT']) if (!Number.isFinite(p[k])) return `${where}: player ${i}.${k} = ${p[k]}`;
    if (p.x < -6 || p.x > W + 6 || p.y < -6 || p.y > L + 6) return `${where}: player ${i} at ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    if (Math.hypot(p.vx, p.vy) > 14) return `${where}: player ${i} at ${Math.hypot(p.vx, p.vy).toFixed(1)} m/s`;
    if (!ANIMS.has(p.anim)) return `${where}: player ${i} anim ${p.anim}`;
    if (p.team !== (i < 11 ? 0 : 1)) return `${where}: player ${i} team ${p.team}`;
  }
  for (const k of ['t', 'phaseT', 'minute', 'clock']) if (!Number.isFinite(s[k])) return `${where}: s.${k} = ${s[k]}`;
  if (!PHASES.has(s.phase)) return `${where}: phase ${s.phase}`;
  for (const k in s.stats) for (const v of s.stats[k]) if (!Number.isFinite(v)) return `${where}: stats.${k}`;
  if (s.kick && !Number.isFinite(s.kick.charge)) return `${where}: kick.charge`;
  if (s.setpiece && (!Number.isFinite(s.setpiece.aim) || !(s.setpiece.taker >= 0))) return `${where}: setpiece ${JSON.stringify(s.setpiece)}`;
  return null;
}

/** play a match to the end with CPU sides (and `user` for side 0 when given), watching it */
function play(teams, seed, { knockout = false, user = null, halfSeconds = 180, watch = true } = {}) {
  const m = createMatch({ teams, seed, halfSeconds, cpu: [!user, true], knockout });
  const s = m.s, cnt = {}, problems = [];
  let untouched = 0, lastOwner = -1, lastLast = -1, maxHalf = 1, steps = 0, log = 0, phaseMax = {};
  const cap = Math.ceil(((halfSeconds * 4.6) / DT) + 30 / DT);
  while (!m.done && steps < cap) {
    const inp = user ? user(m) : null;
    m.step([inp, null]);
    steps++;
    for (const e of m.events) {
      cnt[e.type] = (cnt[e.type] || 0) + 1;
      if (!EVENTS.has(e.type)) problems.push(`unknown event ${e.type}`);
      if (e.type === 'kick') cnt[`kick:${e.kind}`] = (cnt[`kick:${e.kind}`] || 0) + 1;
      if (e.type === 'out') cnt[`out:${e.kind}`] = (cnt[`out:${e.kind}`] || 0) + 1;
      if (e.type === 'card') cnt[`card:${e.colour}`] = (cnt[`card:${e.colour}`] || 0) + 1;
      if (e.type === 'save') cnt[`save:${e.kind}`] = (cnt[`save:${e.kind}`] || 0) + 1;
      if (e.type === 'tackle') cnt[e.won ? 'tackle:won' : 'tackle:missed'] = (cnt[e.won ? 'tackle:won' : 'tackle:missed'] || 0) + 1;
      log = (Math.imul(log ^ (e.type.length * 131 + (e.player ?? 0)), 16777619) + steps) | 0;
    }
    m.events.length = 0;
    if (!watch) continue;
    maxHalf = Math.max(maxHalf, s.half);
    const ph = s.phase;
    phaseMax[ph] = Math.max(phaseMax[ph] || 0, s.phaseT);
    const b = s.ball;
    if (ph === 'play') {
      if (b.owner >= 0 || b.owner !== lastOwner || b.last !== lastLast) untouched = 0;
      else untouched += DT;
      if (untouched > 20) { problems.push(`ball untouched in play for 20 s at ${b.x.toFixed(1)},${b.y.toFixed(1)} (t ${s.t.toFixed(0)})`); untouched = -1e9; }
    } else untouched = 0;
    lastOwner = b.owner; lastLast = b.last;
    if (steps % 4 === 0) {
      const e = sane(s, `seed ${seed} t ${s.t.toFixed(2)} ${ph}`);
      if (e) { problems.push(e); break; }
    }
  }
  if (!m.done) problems.push(`never finished (phase ${s.phase}, half ${s.half}, t ${s.t.toFixed(0)})`);
  if (watch) {
    if (!user && (phaseMax.setpiece || 0) > 6) problems.push(`a dead ball waited ${phaseMax.setpiece.toFixed(1)} s`);
    if ((phaseMax.kickoff || 0) > (user ? 1e9 : 3)) problems.push(`a kick-off waited ${phaseMax.kickoff.toFixed(1)} s`);
    if ((phaseMax.goal || 0) > P.goalT + 0.5) problems.push(`a goal celebration ran ${phaseMax.goal.toFixed(1)} s`);
    if ((phaseMax.halftime || 0) > P.breakT + 0.5) problems.push(`a break ran ${phaseMax.halftime.toFixed(1)} s`);
    if ((phaseMax.pens || 0) > 200) problems.push(`a shoot-out ran ${phaseMax.pens.toFixed(0)} s`);
  }
  return { m, s, cnt, problems, maxHalf, steps, log, res: m.result() };
}

// ---------- 1: formations ----------
console.log('formations');
{
  let n = 0;
  for (const k of FORMATION_KEYS) {
    const f = FORMATIONS[k];
    if (!f || f.slots.length !== 11) { fail(`${k}: ${f ? f.slots.length : 0} slots`); continue; }
    if (f.slots[0].role !== 'GK' || f.slots.slice(1).some(s => s.role === 'GK')) fail(`${k}: the keeper must be slot 0 alone`);
    if (f.slots.some(s => !(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1))) fail(`${k}: a slot outside 0..1`);
    const [d, mf, fw] = ['DF', 'MF', 'FW'].map(r => f.slots.filter(s => s.role === r).length);
    if (k !== `${d}-${mf}-${fw}`) fail(`${k}: slots make ${d}-${mf}-${fw}`);
    n++;
  }
  for (const k of ['4-4-2', '4-3-3', '4-5-1', '5-3-2', '3-5-2', '4-2-4']) if (!FORMATIONS[k]) fail(`missing formation ${k}`);
  if (Object.keys(FORMATIONS).length !== FORMATION_KEYS.length) fail('FORMATION_KEYS does not list every formation');
  ok(`${n} formations, each 11 slots with the keeper first: ${FORMATION_KEYS.join(' ')}`);
}

// ---------- 2: the soak ----------
console.log(`\nsoak: ${MATCHES} CPU-vs-CPU matches, 2 × 180 s`);
const T0 = performance.now();
const goals = [], hist = {}, tally = {};
let strongW = 0, strongD = 0, strongL = 0, even = 0, simSecs = 0, exceptions = 0;
const per = { shots: [], onTarget: [], saves: [], corners: [], fouls: [], yellow: [], red: [], possTop: [] };
for (let n = 0; n < MATCHES; n++) {
  // strengths from 3 to 8, a gap of 0.5 to 3 points; formations at random
  const gap = 0.5 + rnd() * 2.5, lo = 3 + rnd() * (5 - gap);
  const strongHome = rnd() < 0.5;
  const fa = FORMATION_KEYS[Math.floor(rnd() * FORMATION_KEYS.length)], fb = FORMATION_KEYS[Math.floor(rnd() * FORMATION_KEYS.length)];
  const A = makeTeam(`H${n}`, strongHome ? lo + gap : lo, fa), B = makeTeam(`A${n}`, strongHome ? lo : lo + gap, fb);
  let r;
  try { r = play([A, B], 1000 + n * 7919); } catch (e) { exceptions++; fail(`match ${n}: ${e.stack}`); continue; }
  for (const p of r.problems.slice(0, 3)) fail(`match ${n}: ${p}`);
  const sc = r.res.score, tot = sc[0] + sc[1];
  goals.push(tot); hist[tot] = (hist[tot] || 0) + 1;
  simSecs += r.s.t;
  for (const k in r.cnt) tally[k] = (tally[k] || 0) + r.cnt[k];
  const st = r.res.stats;
  for (const k of ['shots', 'onTarget', 'saves', 'corners', 'fouls', 'yellow', 'red']) per[k].push(st[k][0] + st[k][1]);
  per.possTop.push(Math.max(...st.possession));
  if (r.res.scorers.length !== tot) fail(`match ${n}: ${r.res.scorers.length} scorers for ${tot} goals`);
  if (r.res.winner !== (sc[0] > sc[1] ? 0 : sc[1] > sc[0] ? 1 : -1)) fail(`match ${n}: winner ${r.res.winner} for ${sc.join('-')}`);
  const strong = strongHome ? 0 : 1;
  if (Math.abs(strength(A) - strength(B)) < 0.5) even++;
  if (sc[strong] > sc[1 - strong]) strongW++;
  else if (sc[0] === sc[1]) strongD++;
  else strongL++;
}
const msPer = (performance.now() - T0) / MATCHES;
{
  const mean = avg(goals), N = goals.length;
  check(exceptions === 0, `${N} matches, no exception`, `${exceptions} matches threw`);
  check(mean >= 2.2 && mean <= 4, `goals a match: mean ${mean.toFixed(2)}`, `goals a match: mean ${mean.toFixed(2)} (want 2.2–4)`);
  console.log(`    histogram: ${Object.keys(hist).sort((a, b) => a - b).map(k => `${k}:${hist[k]}`).join('  ')}`);
  const wr = strongW / N;
  check(wr > 0.5 && wr < 0.85, `the stronger side: won ${strongW}, drew ${strongD}, lost ${strongL} (${(wr * 100).toFixed(0)}% wins)`, `the stronger side wins ${(wr * 100).toFixed(0)}% (want 50–85%): W${strongW} D${strongD} L${strongL}`);
  check(strongL > 0, `upsets happen: ${strongL}`, 'the weaker side never won');
  const a = k => avg(per[k]);
  const line = `shots ${a('shots').toFixed(1)}, on target ${a('onTarget').toFixed(1)}, saves ${a('saves').toFixed(1)}, corners ${a('corners').toFixed(1)}, fouls ${a('fouls').toFixed(1)}, yellow ${a('yellow').toFixed(2)}, red ${a('red').toFixed(2)} a match; the bigger possession share ${(a('possTop') * 100).toFixed(0)}%`;
  const plaus = a('shots') >= 8 && a('shots') <= 40 && a('onTarget') <= a('shots') && a('onTarget') >= mean && a('saves') >= 1 && a('corners') >= 1 && a('fouls') >= 1 && a('fouls') <= 25 && a('yellow') <= 5 && a('red') <= 0.6;
  check(plaus, line, `implausible: ${line}`);
  const T = k => ((tally[k] || 0) / N).toFixed(1);
  console.log(`    a match: ${T('kick:pass')} passes, ${T('kick:lob')} lobs, ${T('kick:shot')} shots, ${T('kick:header')} headers, ${T('kick:volley')} volleys, ${T('kick:clear')} clears, ${T('kick:throw')} throws; ${T('tackle:won')} tackles won, ${T('tackle:missed')} slides missed; ${T('out:throw')} throw-ins, ${T('out:corner')} corners, ${T('out:goalkick')} goal kicks; ${T('save:catch')}/${T('save:parry')}/${T('save:dive')} catches/parries/diving saves; ${T('post')} posts, ${T('bar')} bars, ${T('chance')} near misses, ${T('penalty')} penalties`);
  check(msPer < 400, `speed: ${msPer.toFixed(0)} ms per simulated match (${((simSecs / MATCHES) / (msPer / 1000)).toFixed(0)}× real time)`, `speed: ${msPer.toFixed(0)} ms per match`);
}

// ---------- 3: knockouts ----------
console.log(`\nknockout: ${KO} matches between equal sides`);
{
  let et = 0, so = 0, decided = 0, sd = 0;
  for (let n = 0; n < KO; n++) {
    const base = 4 + rnd() * 3;
    const r = play([makeTeam(`K${n}`, base), makeTeam(`Q${n}`, base)], 5000 + n * 31, { knockout: true });
    for (const p of r.problems.slice(0, 3)) fail(`knockout ${n}: ${p}`);
    const { score, pens, winner } = r.res;
    if (winner !== 0 && winner !== 1) fail(`knockout ${n}: no winner (${score.join('-')}${pens ? ` pens ${pens.join('-')}` : ''})`);
    else decided++;
    if (r.maxHalf >= 3) et++;
    if (r.maxHalf >= 3 && !(r.s.half >= 3)) fail(`knockout ${n}: extra time lost its half`);
    if (pens) {
      so++;
      const k = r.s.shootout.kicks, a = k[0].length, c = k[1].length;
      const sum = x => x.filter(Boolean).length;
      if (sum(k[0]) !== pens[0] || sum(k[1]) !== pens[1]) fail(`knockout ${n}: pens ${pens.join('-')} but kicks ${JSON.stringify(k)}`);
      if (pens[0] === pens[1]) fail(`knockout ${n}: a shoot-out ended level`);
      if (a > 5 || c > 5) { sd++; if (a !== c) fail(`knockout ${n}: sudden death ended on uneven kicks ${a}/${c}`); }
      if (Math.abs(a - c) > 1) fail(`knockout ${n}: kicks ${a}/${c}`);
      if (score[0] !== score[1]) fail(`knockout ${n}: a shoot-out after ${score.join('-')}`);
    } else if (score[0] === score[1]) fail(`knockout ${n}: level ${score.join('-')} and no shoot-out`);
  }
  check(decided === KO, `${KO} knockouts, every one decided: ${et} went to extra time, ${so} to penalties (${sd} to sudden death)`);
  check(et > 0 && so > 0, 'extra time and shoot-outs both happened', `extra time ${et}, shoot-outs ${so}: neither path exercised`);
}

// ---------- the scripted user ----------
// a held-input user for side 0: runs at the ball, dribbles at goal with it, shoots from 23 m, slides
// in on a carrier, takes set pieces with a tap
function scriptedUser() {
  let kickT = 0, cool = 0, mode = null;
  return m => {
    const s = m.s, c = s.control[0], b = s.ball;
    if (c < 0) return { x: 0, y: 0, kick: false };
    const p = s.players[c], gy = s.up === 0 ? 0 : L;
    let x = 0, y = 0, kick = false;
    cool -= DT;
    if (kickT > -1) { kick = kickT > 0; kickT -= DT; }
    if ((s.phase === 'kickoff' || s.phase === 'setpiece') && s.setpiece && s.setpiece.team === 0) {
      if (kickT <= 0 && cool <= 0 && s.phaseT > 1.5) { kickT = 2 * DT; cool = 0.5; }
      return { x: 0, y: 0, kick: kickT > 0 };
    }
    if (mode === 'shot' && kickT > -0.15) {
      // the shot: the stick at the far side of the goal, held there through the release
      const dx = CX + (p.x < CX ? 2 : -2) - p.x, dy = gy - p.y, d = Math.hypot(dx, dy);
      return { x: dx / d, y: dy / d, kick: kickT > 0 };
    }
    if (b.owner === c) {
      const dx = CX - p.x, dy = gy - p.y, d = Math.hypot(dx, dy);
      x = dx / d; y = dy / d;
      // sidestep the nearest man in front
      let near = null, nd = 5;
      for (let j = 12; j < 22; j++) {
        const q = s.players[j], ex = q.x - p.x, ey = q.y - p.y, e = Math.hypot(ex, ey);
        if (e < nd && ex * x + ey * y > 0) { nd = e; near = q; }
      }
      if (near) {
        const side = (near.x - p.x) * -y + (near.y - p.y) * x > 0 ? -1 : 1;
        const px = -y * side, py = x * side;
        x += px * 1.2; y += py * 1.2;
        const l = Math.hypot(x, y); x /= l; y /= l;
      }
      if (d < 23 && cool <= 0 && kickT <= 0) { kickT = 0.24; cool = 1; mode = 'shot'; x = (CX - p.x) / d; y = (gy - p.y) / d; }
    } else {
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1;
      x = dx / d; y = dy / d;
      if (b.owner >= 11 && d < 2 && cool <= 0 && kickT <= 0) { kickT = 2 * DT; cool = 1.2; mode = 'slide'; }
    }
    return { x, y, kick };
  };
}

// ---------- 4: determinism ----------
console.log('\ndeterminism');
{
  const A = makeTeam('Det', 6), B = makeTeam('Mir', 6, '4-3-3');
  const a = play([A, B], 77, { user: scriptedUser(), halfSeconds: 60 }), c = play([A, B], 77, { user: scriptedUser(), halfSeconds: 60 });
  const ja = JSON.stringify(a.s), jc = JSON.stringify(c.s);
  check(ja === jc && a.log === c.log && JSON.stringify(a.res) === JSON.stringify(c.res), `seed 77 with a scripted user replays exactly (${a.res.score.join('-')}, ${a.steps} steps)`, 'the same seed and inputs gave a different match');
  const d = play([A, B], 78, { user: scriptedUser(), halfSeconds: 60 });
  check(JSON.stringify(d.s) !== ja, 'another seed plays another match', 'seeds 77 and 78 played the same match');
}

// ---------- 5: the user's controls ----------
console.log("\nthe user's controls");
// a match on the user's side 0, past the kick-off, then a scene staged on the pitch
function stage(seed = 1, opts = {}) {
  const m = createMatch({ teams: [makeTeam('Usr', opts.us ?? 7), makeTeam('Cpu', opts.them ?? 5)], seed, halfSeconds: 600, cpu: [false, true] });
  let k = 0;
  while (m.s.phase !== 'play' && k++ < 600) m.step([{ x: 0, y: 0, kick: k % 20 < 2 }, null]);
  // let go of the button, whatever it began
  for (k = 0; k < 40; k++) m.step([{ x: 0, y: 0, kick: false }, null]);
  m.events.length = 0;
  return m;
}
function park(m, keep) {
  // everyone not in the scene goes far away: the home side's to the wings, the CPU's behind its goal line
  const s = m.s;
  for (let i = 0; i < 22; i++) {
    if (keep.includes(i)) continue;
    const p = s.players[i];
    if (i === 0 || i === 11) continue;
    p.x = i < 11 ? (i % 2 ? 2 : W - 2) : 4 + (i - 11) * 6; p.y = i < 11 ? 100 - i * 2 : (s.up === 0 ? 1 : L - 1);
    p.vx = p.vy = 0;
  }
}
function give(m, i, x, y, dir) {
  const s = m.s, p = s.players[i];
  p.x = x; p.y = y; p.vx = p.vy = 0; p.dir = dir;
  Object.assign(s.ball, { x: x + Math.cos(dir) * 0.35, y: y + Math.sin(dir) * 0.35, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: i, last: i });
  s.control[p.team] = i;
  for (let j = 0; j < 22; j++) s.players[j].human = j === s.control[0];
}
const press = (m, input, n) => { for (let k = 0; k < n; k++) m.step([input, null]); };
// a kick by player i in `scene`, the button held `hold` seconds; then `after(t)` steers; returns the flight
// after(t) steers the stick: x across the screen, y along the ball's travel (+) or against it (-)
function kickScene({ hold, after = () => ({ x: 0, y: 0 }), mate = null, secs = 2 }) {
  const m = stage(3);
  const s = m.s, up = s.up === 0 ? -1 : 1, me = 6;
  // the human side attacks along `up`; the kicker in his own half, facing up the pitch
  const y0 = up < 0 ? 75 : 30;
  park(m, mate != null ? [me, mate] : [me]);
  give(m, me, CX, y0, up < 0 ? -Math.PI / 2 : Math.PI / 2);
  if (mate != null) { const q = s.players[mate]; q.x = CX + 1.3; q.y = y0 + up * 16; q.vx = q.vy = 0; }
  const fwd = { x: 0, y: up, kick: false };
  press(m, fwd, 2);
  const n = Math.max(1, Math.round(hold / DT));
  let kicked = null, k = 0;
  m.events.length = 0;
  for (; k < n + 40 && !kicked; k++) {
    m.step([{ ...fwd, kick: k < n }, null]);
    kicked = m.events.find(e => e.type === 'kick' && e.player === me);
    m.events.length = 0;
  }
  if (!kicked) return null;
  const b = s.ball, x0 = b.x, y0b = b.y, v0 = Math.hypot(b.vx, b.vy, b.vz);
  let maxZ = 0, owner = -1, t = 0, dist = 0;
  while (t < secs) {
    const a = after(t);
    m.step([{ x: a.x, y: a.y * up, kick: false }, null]);
    m.events.length = 0;
    t += DT;
    maxZ = Math.max(maxZ, b.z);
    if (b.owner >= 0 && b.owner !== me && owner < 0) owner = b.owner;
    if (owner < 0) dist = Math.hypot(b.x - x0, b.y - y0b);
    if (t > 1.2 && dist === 0) break;
  }
  return { kind: kicked.kind, v0, maxZ, owner, dist, lateral: b.x - x0, m };
}
{
  // a tap at a teammate a few degrees off the facing, 16 m away: it reaches him
  let hits = 0;
  const N = 6;
  for (let k = 0; k < N; k++) {
    const r = kickScene({ hold: 2 * DT, mate: 9, after: () => ({ x: 0, y: 0 }) });
    if (r && r.kind === 'pass' && r.owner === 9) hits++;
  }
  check(hits === N, `a tap pass 5° off the facing reaches the teammate it was aimed at (${hits}/${N})`, `a tap pass reached its teammate ${hits}/${N} times`);
}
{
  const tap = kickScene({ hold: 2 * DT, after: () => ({ x: 0, y: 0 }), secs: 2.5 });
  const hold = kickScene({ hold: 0.3, after: () => ({ x: 0, y: 0 }), secs: 2.5 });
  check(tap && hold && hold.kind !== 'pass' && hold.v0 > tap.v0 * 1.3 && hold.dist > tap.dist,
    `a held kick goes harder and further than a tap: ${hold?.v0.toFixed(1)} vs ${tap?.v0.toFixed(1)} m/s, ${hold?.dist.toFixed(0)} vs ${tap?.dist.toFixed(0)} m in 2.5 s (${hold?.kind}, ${tap?.kind})`,
    `held vs tap: ${JSON.stringify({ hold: hold && { v0: hold.v0, dist: hold.dist, kind: hold.kind }, tap: tap && { v0: tap.v0, dist: tap.dist, kind: tap.kind } })}`);
}
{
  // aftertouch: the same held kick, then nothing / right / back on the stick
  const none = kickScene({ hold: 0.22, after: () => ({ x: 0, y: 0 }), secs: 1.1 });
  const right = kickScene({ hold: 0.22, after: t => (t < 0.4 ? { x: 1, y: 0 } : { x: 0, y: 0 }), secs: 1.1 });
  const back = kickScene({ hold: 0.22, after: t => (t < 0.4 ? { x: 0, y: -1 } : { x: 0, y: 0 }), secs: 1.1 });
  const fwd = kickScene({ hold: 0.22, after: t => (t < 0.4 ? { x: 0, y: 1 } : { x: 0, y: 0 }), secs: 1.1 });
  const dev = right.lateral - none.lateral;
  check(dev > 1.2, `aftertouch across the flight curls it: ${dev.toFixed(1)} m sideways after 1.1 s (none ${none.lateral.toFixed(2)} m)`, `aftertouch across: only ${dev.toFixed(2)} m of curl`);
  check(back.maxZ > none.maxZ + 0.5 && fwd.maxZ < none.maxZ, `aftertouch back lifts it (top ${back.maxZ.toFixed(1)} m), forward keeps it low (${fwd.maxZ.toFixed(1)} m) against ${none.maxZ.toFixed(1)} m untouched`, `aftertouch height: back ${back.maxZ.toFixed(2)}, none ${none.maxZ.toFixed(2)}, forward ${fwd.maxZ.toFixed(2)}`);
}
{
  // slides at a CPU dribbler from the front, the side and behind
  let won = 0, fouls = 0, missed = 0, n = 0;
  for (let k = 0; k < 48; k++) {
    const m = stage(100 + k);
    const s = m.s, me = 5, them = 18, up = s.up === 0 ? -1 : 1;
    park(m, [me, them]);
    // the CPU carrier runs at the user's goal (along -up)
    const cx = 20 + (k % 6) * 5, cy = up < 0 ? 55 : 50;
    give(m, them, cx, cy, Math.atan2(-up, 0));
    s.control[0] = me;
    const ang = (k % 8) * (Math.PI / 4), dist = 1.4 + (k % 3) * 0.3;
    const p = s.players[me];
    p.x = cx + Math.cos(ang) * dist; p.y = cy - up * 1 + Math.sin(ang) * dist; p.vx = p.vy = 0;
    // a few steps of the dribble, then slide at the ball
    press(m, { x: 0, y: 0, kick: false }, 3);
    const b = s.ball, dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy) || 1;
    const aim = { x: dx / d, y: dy / d };
    press(m, { ...aim, kick: false }, 2);
    m.events.length = 0;
    let res = null;
    for (let j = 0; j < 70 && !res; j++) {
      m.step([{ ...aim, kick: j < 2 }, null]);
      for (const e of m.events) {
        if (e.type === 'foul' && e.player === me) res = 'foul';
        else if (e.type === 'tackle' && e.player === me) res = e.won ? 'won' : 'missed';
      }
      m.events.length = 0;
    }
    n++;
    if (res === 'won') won++;
    else if (res === 'foul') fouls++;
    else missed++;
  }
  check(won > 0 && fouls > 0, `slide tackles at a dribbler from all round: ${won} won the ball, ${fouls} fouls, ${missed} missed of ${n}`, `slides: ${won} won, ${fouls} fouls, ${missed} missed of ${n} (want some of each)`);
}
{
  // a user who never touches the keys: his side's kick-off is taken for him after a few seconds
  let seed = 1, m;
  do m = createMatch({ teams: [makeTeam('Idle', 5), makeTeam('Cpu', 5)], seed: seed++, halfSeconds: 120, cpu: [false, true] });
  while (m.s.setpiece.team !== 0 && seed < 50);
  let t = 0;
  while (m.s.phase === 'kickoff' && t < 10) { m.step([{ x: 0, y: 0, kick: false }, null]); t += DT; }
  const first = m.s.setpiece?.team;
  let dead = 0, worst = 0;
  for (let k = 0; k < 120 / DT && !m.done; k++) {
    m.step([{ x: 0, y: 0, kick: false }, null]);
    m.events.length = 0;
    dead = m.s.phase === 'setpiece' || m.s.phase === 'kickoff' ? dead + DT : 0;
    worst = Math.max(worst, dead);
  }
  check(first !== 0 && t > P.idleTake - 0.5 && t < P.idleTake + 1 && worst < P.snapT + P.idleTake + 0.5, `an idle user's kick-off is taken for him after ${t.toFixed(1)} s; no dead ball waits longer than ${worst.toFixed(1)} s in two idle minutes`, `idle user: kick-off after ${t.toFixed(1)} s, a dead ball waited ${worst.toFixed(1)} s`);
}
{
  // a scripted user against a weak side scores in good time
  const times = [];
  for (let k = 0; k < 6; k++) {
    const m = createMatch({ teams: [makeTeam('Usr', 7), makeTeam('Weak', 2)], seed: 900 + k, halfSeconds: 300, cpu: [false, true] });
    const user = scriptedUser();
    let t = null;
    for (let j = 0; j < 300 / DT && t === null && !m.done; j++) {
      m.step([user(m), null]);
      for (const e of m.events) if (e.type === 'goal' && e.team === 0 && !e.own) {
        const sc = m.s.players[e.scorer];
        if (sc.team === 0) t = m.s.t;
      }
      m.events.length = 0;
    }
    times.push(t);
  }
  const scored = times.filter(t => t !== null);
  check(scored.length >= 5, `a scripted user dribbles up and scores against a weak side: ${scored.length}/6 matches, first goal after ${scored.map(t => t.toFixed(0)).join(', ')} s`, `the scripted user scored in only ${scored.length}/6 (${times.join(', ')})`);
}

console.log(bad ? `\nFAIL: ${bad} problem(s)` : '\nPASS: all good');
process.exit(bad ? 1 : 0);
