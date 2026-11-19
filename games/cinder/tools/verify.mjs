// Proves Cinder can be played through, headless, on the real sim:
//   1. the scenes are well formed: ids and themes, a foe stays off screen until it sets out, no
//      drop gate between a foe and where it meets Wren, 10–12 foes rising in skill, the garden last;
//   2. the strong pilot (skill 1) clears every scene from its start on every seed, and is never
//      crushed by a gate nor darted down; a run from a checkpoint replays exactly (determinism);
//   3. the hazards bite: a careless runner who ignores the gates' shake and the archer's draw is
//      crushed and darted, so the strong pilot's clean runs are its timing, not luck;
//   4. the demo pilot (skill 0.75) plays whole games: it must sometimes lose and often progress;
//      the strong pilot's whole game is timed (a fair human takes about 1.5–2× as long);
//   5. with --soak M, the attract demo's loop runs for M simulated minutes, failing on any
//      exception, NaN, unknown event, a status that never ends, a foe frozen or a hero wedged.
//
//   mise exec -- node games/cinder/tools/verify.mjs [--seeds 20] [--soak 30] [scenes…, 1-based]
import { MOVES } from '../src/moves.js';
import { createPilot } from '../src/pilot.js';
import { SCENES } from '../src/scenes.js';
import { DT, EMPTY_INPUT, KINDS, createSim } from '../src/sim.js';

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? +args[i + 1] : d; };
const seeds = opt('--seeds', 20), soak = opt('--soak', 0);
const only = args.filter((a, i) => !a.startsWith('--') && !['--seeds', '--soak'].includes(args[i - 1])).map(n => +n - 1);
const EVENTS = new Set(['intro', 'stance', 'step', 'swing', 'hit', 'block', 'ko', 'bow', 'foe', 'regen', 'gateShake', 'gateSlam', 'crush', 'draw', 'dart', 'dartHit', 'dartBlock', 'clear', 'die', 'life', 'win', 'over']);
const THEMES = ['dusk', 'gate', 'court', 'hall', 'stair', 'throne', 'garden'];
const TIER = { footman: 1, brawler: 2, adept: 3, regent: 4 };
let bad = 0;
const fail = msg => { bad++; console.log(`  ✗ ${msg}`); };
const seedOf = (k, i) => 1000 + k * 7919 + i * 31;
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// ---------- 1: the scenes ----------
{
  const foes = SCENES.flatMap(S => S.foes);
  SCENES.forEach((S, i) => {
    if (S.theme !== THEMES[i]) fail(`${S.id}: theme ${S.theme}, expected ${THEMES[i]}`);
    for (const f of S.foes) {
      if (!KINDS[f.kind]) fail(`${S.id}: unknown foe ${f.kind}`);
      if (f.x - f.at < 8.5) fail(`${S.id}: a ${f.kind} at ${f.x} would show before it sets out at ${f.at}`);
      // it walks from x to meet Wren a little past `at`; knock-backs push fights a metre or two
      const g = S.gates.find(g => g > f.at - 3 && g < f.x + 1);
      if (g !== undefined) fail(`${S.id}: gate ${g} lies between the ${f.kind} and where it meets Wren`);
      if (f.x > S.w) fail(`${S.id}: a ${f.kind} beyond the scene's end`);
    }
    S.foes.forEach((f, j) => { if (j && f.at < S.foes[j - 1].x + 2) fail(`${S.id}: foe ${j + 1} is met before foe ${j} is beaten`); });
    if (S.archer && S.foes.some(f => f.at > S.archer.x - 26)) fail(`${S.id}: a foe in the archer's reach`);
  });
  for (const k in MOVES) { const m = MOVES[k]; if (m.reach && !(m.on < m.off && m.off < m.dur)) fail(`move ${k}: window outside its duration`); }
  if (foes.length < 10 || foes.length > 12) fail(`${foes.length} foes, want 10–12`);
  const tiers = foes.map(f => TIER[f.kind]);
  if (tiers.some((t, i) => i && t < tiers[i - 1] - 2)) fail('foes do not rise in skill');
  const last = SCENES[SCENES.length - 1];
  if (!last.teacher || last.foes.length) fail('the last scene must be the garden with Master Oriel and no foes');
  console.log(`  ✓ scenes: ${SCENES.length} scenes, ${foes.length} foes (${Object.keys(TIER).map(k => `${foes.filter(f => f.kind === k).length} ${k}`).join(', ')})`);
}

// runs one scene (or on through the game) with a pilot; returns what happened
function play({ scene = 0, seed, skill = 1, lives = 3, through = false, cap = 60 * 60 * 30, wrap = null, sim = createSim(), pilotSeed = seed }) {
  sim.newGame({ scene, seed, lives });
  const pilot = createPilot(sim, { skill, seed: pilotSeed });
  const r = { cnt: {}, steps: 0, cleared: 0, log: [], lost: 0, status: '', honour: 0, palm: 0, palmHit: 0 };
  while (r.steps < cap) {
    let inp = pilot();
    if (wrap) inp = wrap(sim.s, inp);
    sim.step(inp); r.steps++;
    for (const e of sim.events) {
      r.cnt[e.k] = (r.cnt[e.k] || 0) + 1;
      if (e.k !== 'step') r.log.push(e.k + (e.who ? ':' + e.who : ''));
      if (!EVENTS.has(e.k)) fail(`unknown event '${e.k}'`);
      if (e.k === 'clear') r.cleared++;
      if (e.k === 'life') r.lost++;
      if (e.k === 'bow' && e.honour) r.honour++;
      if (e.k === 'swing' && e.move === 'palm') r.palm++;
      if (e.k === 'hit' && e.move === 'palm') r.palmHit++;
    }
    const s = sim.s;
    if (s.status === 'won' || s.status === 'over') break;
    if (!through && (s.scene !== scene || (r.lost && s.status === 'intro'))) break;
  }
  r.status = sim.s.status; r.scene = sim.s.scene; r.score = sim.s.score; r.secs = r.steps * DT;
  return r;
}

// ---------- the run-stance rule, both ways ----------
{
  // Wren walks into a footman's guard in run stance: its first hit KOs her from full pips
  const sim = createSim();
  sim.newGame({ scene: 0, seed: 11 });
  let first = null;
  for (let i = 0; i < 60 * 40 && !first; i++) {
    sim.step({ ...EMPTY_INPUT, right: true });
    first = sim.events.find(e => e.k === 'hit' && e.who === 'hero');
  }
  if (!first || first.dmg !== KINDS.hero.hp || sim.s.status !== 'dead') fail(`a hit in run stance should KO Wren from full pips (${JSON.stringify(first)}, '${sim.s.status}')`);
  // she backs off, the footman runs after her, and a kick timed to meet it KOs it in one
  sim.newGame({ scene: 0, seed: 12 });
  const pilot = createPilot(sim, { skill: 1, seed: 1 });
  let phase = 0, ko = null, n = 0, prev = { ...EMPTY_INPUT };
  for (; n < 60 * 60 && !ko; n++) {
    const s = sim.s, h = s.hero, f = s.engaged;
    let inp = pilot();
    if (phase === 0 && f && f.ai === 'fight' && f.hp === f.maxHp && h.move === 'idle' && f.move === 'idle') phase = 1;
    if (phase === 1) inp = { ...EMPTY_INPUT, stance: h.stance === 'guard' && !prev.stance, left: h.stance === 'run' };
    if (phase === 1 && f.x - h.x > 7.5) phase = 2;
    if (phase === 2) inp = { ...EMPTY_INPUT, stance: h.stance === 'run' && h.move !== 'stance' && !prev.stance, kick: f.stance === 'run' && f.x - h.x < 2.3 && !prev.kick };
    sim.step(inp); prev = inp;
    ko = sim.events.find(e => e.k === 'ko' && e.who !== 'hero') && sim.events.find(e => e.k === 'hit');
  }
  if (!ko || ko.dmg !== KINDS.footman.hp) fail(`a kick on a footman running in should KO it in one (${JSON.stringify(ko)}, phase ${phase})`);
  else console.log(`  ✓ run stance: one hit KOs Wren from ${KINDS.hero.hp} pips, and one kick KOs a footman running in after her`);
}

// ---------- 2, 3: every scene, strong pilot; hazards ----------
const careless = (s, inp) => {
  // runs straight through the archer's darts, and dashes for a gate from a metre and a half back
  // when it starts to shake (the moment to stay put)
  const f = s.engaged, h = s.hero;
  if (f && Math.abs(f.x - h.x) < 6) return inp;
  if (!s.gates.length && !s.archer) return inp;
  const out = { ...EMPTY_INPUT, right: true, stance: h.stance !== 'run' && !s.prev?.stance };
  const g = s.gates.find(g => g.x + 0.5 > h.x);
  if (g && h.x < g.x - 0.5 && g.x - h.x < 1.6 && !(g.st === 'shake' || g.st === 'slam')) out.right = false;
  return out;
};
for (let i = 0; i < SCENES.length; i++) {
  if (only.length && !only.includes(i)) continue;
  const S = SCENES[i], times = [], hurts = [];
  let clean = 0, crush = 0, darted = 0, losses = 0;
  for (let k = 0; k < seeds; k++) {
    const r = play({ scene: i, seed: seedOf(k, i), skill: 1 });
    const done = i === SCENES.length - 1 ? r.status === 'won' : r.scene === i + 1;
    if (!done) { losses++; fail(`${i + 1} ${S.name}: strong pilot, seed ${seedOf(k, i)}: ended '${r.status}' in scene ${r.scene + 1}`); continue; }
    if (!r.lost) clean++;
    crush += r.cnt.crush || 0;
    darted += r.cnt.dartHit || 0;
    times.push(r.secs);
    hurts.push(r.log.filter(e => e === 'hit:hero').length);
  }
  if (crush) fail(`${i + 1} ${S.name}: the strong pilot was crushed ${crush}×`);
  if (darted) fail(`${i + 1} ${S.name}: the strong pilot was darted ${darted}×`);
  if (clean < seeds * 0.9) fail(`${i + 1} ${S.name}: the strong pilot lost a life on ${seeds - clean} of ${seeds} seeds`);
  if (!losses) console.log(`  ✓ ${i + 1} ${S.name}: strong pilot clears ${seeds}/${seeds} seeds, ${clean} without a life lost, in ${avg(times).toFixed(1)}s (Wren hit ${avg(hurts).toFixed(1)}× a run)`);
  // determinism: a checkpoint replays the same scene, step for step
  {
    const sim = createSim();
    play({ scene: i, seed: seedOf(1, i), skill: 0.75, sim, cap: 60 * 4 });
    const cp = sim.checkpoint();
    if (cp.scene !== i || typeof cp.seed !== 'number' || typeof cp.score !== 'number' || typeof cp.lives !== 'number') fail(`${i + 1}: checkpoint() ${JSON.stringify(cp)}`);
    const a = play({ ...cp, skill: 0.75, pilotSeed: 3 }), b = play({ ...cp, skill: 0.75, pilotSeed: 3 });
    if (a.log.join() !== b.log.join() || a.score !== b.score) fail(`${i + 1} ${S.name}: a checkpoint does not replay the same`);
  }
  // the hazards must bite someone who ignores them
  if (S.gates.length || S.archer) {
    let hurt = 0;
    for (let k = 0; k < seeds; k++) { const r = play({ scene: i, seed: seedOf(k, i), skill: 1, wrap: careless, lives: 1 }); hurt += (r.cnt.crush || 0) + (r.cnt.dartHit || 0); }
    if (!hurt) fail(`${i + 1} ${S.name}: a careless runner is never caught by the hazards`);
    else console.log(`    hazards: a careless runner is ${S.gates.length ? 'crushed' : 'darted'} ${hurt}× in ${seeds} runs; the strong pilot 0×`);
  }
}

// ---------- 4: whole games ----------
if (!only.length) {
  const games = Math.max(seeds, 10);
  const reach = [], strongT = [], tally = { honour: 0, palm: 0, palmHit: 0, regen: 0, lost: 0 };
  let won = 0, over = 0, scores = [];
  for (let k = 0; k < games; k++) {
    const r = play({ seed: seedOf(k, 99), skill: 0.75, through: true });
    for (const t of ['honour', 'palm', 'palmHit', 'lost']) tally[t] += r[t];
    tally.regen += r.cnt.regen || 0;
    if (r.status === 'won') won++; else if (r.status === 'over') over++;
    else fail(`demo game ${k + 1} ended '${r.status}' after ${(r.secs / 60).toFixed(1)} min`);
    reach.push(r.status === 'won' ? SCENES.length : r.scene);
    scores.push(r.score);
  }
  for (let k = 0; k < Math.min(seeds, 10); k++) {
    const r = play({ seed: seedOf(k, 77), skill: 1, through: true });
    if (r.status !== 'won') fail(`strong game ${k + 1}: ended '${r.status}' in scene ${r.scene + 1}`);
    else strongT.push(r.secs);
  }
  const hist = SCENES.map((S, i) => reach.filter(x => x === i).length);
  const median = [...reach].sort((a, b) => a - b)[Math.floor(reach.length / 2)];
  console.log(`  demo pilot, ${games} games: ${won} won, ${over} lost; lost in scene ${hist.map((n, i) => `${i + 1}:${n}`).join(' ')}; median reach ${median >= SCENES.length ? 'the end' : `scene ${median + 1}`}; score ${Math.round(avg(scores))}`);
  console.log(`    per game: ${(tally.lost / games).toFixed(1)} lives lost, ${(tally.honour / games).toFixed(1)} bows answered, ${(tally.regen / games).toFixed(1)} pips regained, ${tally.palm - tally.palmHit} of ${tally.palm} palm strikes ducked`);
  console.log(`  strong pilot, whole game: ${(avg(strongT) / 60).toFixed(1)} min (${(Math.min(...strongT) / 60).toFixed(1)}–${(Math.max(...strongT) / 60).toFixed(1)})`);
  if (!over) fail('the demo pilot never loses');
  if (median < 2) fail('the demo pilot rarely gets past the second scene');
  if (won === 0) fail('the demo pilot never wins');
}

// ---------- 5: the attract loop ----------
if (soak) {
  const sim = createSim();
  let steps = 0, games = 0, won = 0, scenes = 0, endT = 0, pilot, g = 0;
  const start = () => { sim.newGame({ scene: g % 6, seed: seedOf(g, 5) }); pilot = createPilot(sim, { skill: 0.75, seed: g + 1 }); g++; };
  start();
  let since = { status: '', t: 0 }, best = { x: -9, t: 0, scene: -1 }, foeSig = new Map(), stuck = 0;
  const tooLong = { intro: 4, dead: 4, clear: 3, play: 6 * 60 };
  try {
    for (; steps < soak * 60 * 60; steps++) {
      sim.step(pilot());
      const s = sim.s, h = s.hero, now = steps * DT;
      for (const e of sim.events) {
        if (!EVENTS.has(e.k)) throw new Error(`unknown event ${e.k}`);
        if (e.k === 'clear') scenes++;
      }
      if (![h.x, s.cam, h.hp, ...s.foes.map(f => f.x)].every(Number.isFinite)) throw new Error(`NaN in scene ${s.scene + 1}`);
      if (!MOVES[h.move] || s.foes.some(f => !MOVES[f.move])) throw new Error('a fighter in an unknown move');
      // a status that never ends
      if (s.status !== since.status) since = { status: s.status, t: now };
      if (tooLong[s.status] && now - since.t > tooLong[s.status]) throw new Error(`'${s.status}' for ${(now - since.t).toFixed(0)}s in scene ${s.scene + 1}`);
      // a wedged hero: neither getting further nor fighting for a minute
      if (s.scene !== best.scene || h.x > best.x + 0.5 || (s.engaged && s.engaged.ai === 'fight') || s.status !== 'play') best = { x: h.x, t: now, scene: s.scene };
      if (now - best.t > 60) { stuck++; console.log(`  ✗ soak: hero wedged at x ${h.x.toFixed(1)} in scene ${s.scene + 1} (${h.move}/${h.stance})`); best.t = now; }
      // a frozen foe: out and fighting, yet nothing about it changes for 20 s
      if (s.status === 'play') for (const f of s.foes) {
        if (f.ai === 'wait' || f.ai === 'down') { foeSig.delete(f.id); continue; }
        const sig = `${f.ai}|${f.move}|${f.x.toFixed(2)}|${f.hp}`, o = foeSig.get(f.id);
        if (!o || o.sig !== sig || o.moveT > f.moveT) foeSig.set(f.id, { sig, t: now, moveT: f.moveT });
        else if (now - o.t > 20) { stuck++; console.log(`  ✗ soak: ${f.id} frozen in '${f.ai}/${f.move}' in scene ${s.scene + 1}`); o.t = now; }
        else o.moveT = f.moveT;
      }
      if (s.status === 'won' || s.status === 'over') {
        if (!endT) { endT = now; games++; if (s.status === 'won') won++; }
        if (now - endT > 5) { endT = 0; start(); foeSig.clear(); }
      }
    }
    if (stuck) bad += stuck;
    else console.log(`  ✓ soak: ${soak} simulated minutes, ${games} demo games (${won} won), ${scenes} scenes cleared, no exceptions, nothing stuck`);
  } catch (e) { bad++; console.log(`  ✗ soak threw after ${(steps * DT).toFixed(1)}s: ${e.stack}`); }
}
console.log(bad ? `${bad} problem(s)` : 'all verified');
process.exit(bad ? 1 : 0);
