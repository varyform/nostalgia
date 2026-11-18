// Headless checks on the real rules and autopilot:
//   1. lines    the row finder on hand-made boards: every direction, long rows, crosses that
//               share a marble, prisms (bridging two colours), near misses that must not count;
//               and on random boards against a brute-force finder;
//   2. paths    the path finder against a brute-force flood on random boards: a path exists
//               exactly when the target is reachable, it is shortest, it steps cell to cell
//               through empty cells only;
//   3. soak     the demo's autopilot plays --games boards to the end (taking moves back now and
//               then): no exceptions; after every turn no row is left standing, the marble count
//               adds up (arrivals in, cleared rows out), the seeds sit on distinct empty cells,
//               rows the arrivals finish are cleared, the score adds up from the rows, the game
//               ends exactly when the board is full; a checkpoint resumed in a fresh sim plays on
//               identically; a take-back restores the board, seeds and score exactly;
//   4. scores   what the strong and the demo autopilot score, as a distribution.
//
//   mise exec -- node games/quintet/tools/verify.mjs [--games 2000] [--strong 200] [--seed 1]
import { createPilot } from '../src/pilot.js';
import {
  CELLS, COLOURS, EMPTY, MIN_LINE, N, NBR, PER_TURN, PRISM, START, createSim, findLines, findPath, freeCells, linePoints, validState,
} from '../src/sim.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const GAMES = opt('--games', 2000), STRONG = opt('--strong', 200), SEED = opt('--seed', 1);
let bad = 0;
const fail = (id, msg) => { if (bad++ < 40) console.log(`  ✗ ${id}: ${msg}`); };
let rs = SEED * 7919;
const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;

// ---------- 1. lines ----------
const B = (cells = {}) => { const b = new Int8Array(CELLS).fill(EMPTY); for (const [i, c] of Object.entries(cells)) b[+i] = c; return b; };
const xy = (x, y) => y * N + x;
const rowOf = (c, pts) => Object.fromEntries(pts.map(([x, y]) => [xy(x, y), c]));
const span = (x, y, dx, dy, n) => Array.from({ length: n }, (_, k) => [x + dx * k, y + dy * k]);
const keyOf = lines => lines.map(l => `${l.c}:${[...l.cells].sort((a, b) => a - b).join(',')}`).sort().join(' | ');
function expectLines(id, board, want) {
  const got = findLines(board), w = want.map(([c, pts]) => ({ c, cells: pts.map(([x, y]) => xy(x, y)) }));
  if (keyOf(got) !== keyOf(w)) fail(`lines ${id}`, `got ${keyOf(got) || 'none'}, want ${keyOf(w) || 'none'}`);
}
console.log('lines: hand-made boards');
{
  const r = span(2, 4, 1, 0, 5), v = span(7, 0, 0, 1, 5), d = span(0, 0, 1, 1, 9), a = span(4, 8, 1, -1, 5);
  expectLines('across', B(rowOf(0, r)), [[0, r]]);
  expectLines('down', B(rowOf(3, v)), [[3, v]]);
  expectLines('diagonal of 9', B(rowOf(5, d)), [[5, d]]);
  expectLines('anti-diagonal in a corner', B(rowOf(6, a)), [[6, a]]);
  expectLines('four is not a row', B(rowOf(1, span(0, 0, 1, 0, 4))), []);
  expectLines('broken row', B({ ...rowOf(1, span(0, 0, 1, 0, 6)), [xy(2, 0)]: 2 }), []);
  expectLines('row of six', B(rowOf(2, span(3, 3, 1, 0, 6))), [[2, span(3, 3, 1, 0, 6)]]);
  // a cross sharing its middle marble, and an X of both diagonals
  const h = span(0, 4, 1, 0, 5), vv = span(2, 2, 0, 1, 5);
  expectLines('cross', B({ ...rowOf(4, h), ...rowOf(4, vv) }), [[4, h], [4, vv]]);
  const d1 = span(2, 2, 1, 1, 5), d2 = span(2, 6, 1, -1, 5);
  expectLines('X', B({ ...rowOf(0, d1), ...rowOf(0, d2) }), [[0, d1], [0, d2]]);
  // two colours side by side on one line: neither is a row
  expectLines('two colours', B({ ...rowOf(0, span(0, 1, 1, 0, 4)), ...rowOf(1, span(4, 1, 1, 0, 4)) }), []);
  // a prism finishes a row, and bridges two colours at once
  expectLines('prism end', B({ ...rowOf(3, span(0, 8, 1, 0, 4)), [xy(4, 8)]: PRISM }), [[3, span(0, 8, 1, 0, 5)]]);
  expectLines('prism bridge', B({ ...rowOf(0, span(0, 2, 1, 0, 4)), [xy(4, 2)]: PRISM, ...rowOf(1, span(5, 2, 1, 0, 4)) }), [[0, span(0, 2, 1, 0, 5)], [1, span(4, 2, 1, 0, 5)]]);
  expectLines('prism + 3 is not a row', B({ ...rowOf(2, span(0, 0, 0, 1, 3)), [xy(0, 3)]: PRISM }), []);
  // two separate rows of the same colour on one line can't fit (9 < 11), on different lines can
  expectLines('two rows', B({ ...rowOf(5, span(0, 0, 1, 0, 5)), ...rowOf(5, span(0, 8, 1, 0, 5)) }), [[5, span(0, 0, 1, 0, 5)], [5, span(0, 8, 1, 0, 5)]]);
}
// a brute-force finder: walk from each cell in each direction for each colour
function bruteLines(b) {
  const out = [];
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) for (let s = 0; s < CELLS; s++) for (let c = 0; c < COLOURS; c++) {
    const ok = (x, y) => x >= 0 && x < N && y >= 0 && y < N && (b[xy(x, y)] === c || b[xy(x, y)] === PRISM);
    const x0 = s % N, y0 = (s / N) | 0;
    if (!ok(x0, y0) || ok(x0 - dx, y0 - dy)) continue;
    const cells = [];
    for (let x = x0, y = y0; ok(x, y); x += dx, y += dy) cells.push(xy(x, y));
    if (cells.length >= MIN_LINE && cells.some(i => b[i] === c)) out.push({ c, cells });
  }
  return out;
}
{
  let n = 0, rows = 0;
  for (let k = 0; k < 20000; k++) {
    const b = new Int8Array(CELLS), fill = 0.3 + rnd() * 0.65, cols = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < CELLS; i++) b[i] = rnd() < fill ? (rnd() < 0.03 ? PRISM : Math.floor(rnd() * cols)) : EMPTY;
    const got = findLines(b), want = bruteLines(b);
    if (keyOf(got) !== keyOf(want)) { fail('lines random', `board ${k}: ${keyOf(got)} vs ${keyOf(want)}`); break; }
    n++; rows += got.length;
  }
  console.log(`  ${n === 20000 ? '✓' : '✗'} ${n} random boards agree with the brute-force finder (${rows} rows)`);
}

// ---------- 2. paths ----------
console.log('paths: random boards against a flood fill');
{
  let n = 0, found = 0;
  for (let k = 0; k < 20000 && !bad; k++) {
    const b = new Int8Array(CELLS);
    const fill = rnd() * 0.75;
    for (let i = 0; i < CELLS; i++) b[i] = rnd() < fill ? Math.floor(rnd() * COLOURS) : EMPTY;
    const from = Math.floor(rnd() * CELLS), to = Math.floor(rnd() * CELLS);
    b[from] = 0;
    if (from === to) continue;
    // distances by flood from `from` through empty cells
    const dist = new Int16Array(CELLS).fill(-1); dist[from] = 0;
    const q = [from];
    for (let h = 0; h < q.length; h++) for (const v of NBR[q[h]]) if (dist[v] < 0 && b[v] === EMPTY) { dist[v] = dist[q[h]] + 1; q.push(v); }
    const p = findPath(b, from, to), can = b[to] === EMPTY && dist[to] > 0;
    n++;
    if (!!p !== can) { fail('path', `board ${k}: path ${!!p}, reachable ${can}`); break; }
    if (!p) continue;
    found++;
    if (p[0] !== from || p.at(-1) !== to || p.length - 1 !== dist[to]) fail('path', `board ${k}: not a shortest path (${p.length - 1} vs ${dist[to]})`);
    for (let j = 1; j < p.length; j++) if (!NBR[p[j - 1]].includes(p[j]) || b[p[j]] !== EMPTY) { fail('path', `board ${k}: illegal step ${p[j - 1]}→${p[j]}`); break; }
  }
  console.log(`  ${bad ? '✗' : '✓'} ${n} queries, ${found} paths, all shortest and legal`);
}

// ---------- 3. soak ----------
const count = b => CELLS - freeCells(b);
function playTurn(sim, m, id) {
  const before = Int8Array.from(sim.board), pre = sim.preview.map(p => ({ ...p })), score0 = sim.score, n0 = count(before);
  const path = findPath(sim.board, m.from, m.to);
  if (!sim.tryMove(m.from, m.to)) { fail(id, `legal move refused ${m.from}→${m.to}`); return false; }
  // the roll follows a legal path
  const roll = sim.roll;
  if (!roll || roll.path.length !== path.length) { fail(id, 'roll path differs from findPath'); return false; }
  for (let j = 1; j < roll.path.length; j++) if (!NBR[roll.path[j - 1]].includes(roll.path[j]) || before[roll.path[j]] !== EMPTY) { fail(id, 'roll steps through a marble'); return false; }
  // watch the phases one step at a time
  let arrived = 0, cleared = 0, pts = 0, clears = 0;
  for (let k = 0; k < 600 && sim.phase !== 'idle' && sim.phase !== 'over'; k++) {
    sim.step(1 / 60);
    for (const e of sim.events) {
      if (e.type === 'arrive') {
        arrived += e.list.length;
        const want = Math.min(pre.length, freeCells(before));
        if (e.list.length !== want) fail(id, `${e.list.length} arrivals with ${freeCells(before)} free cells`);
        for (const a of e.list) {
          const p = pre.find(q => q.c === a.c && (q.at === a.at || q.at === a.from));
          if (!p) fail(id, `an arrival that was not a seed: ${JSON.stringify(a)}`);
          if (a.from >= 0 && a.from !== m.to) fail(id, `a seed moved though its cell was free: ${JSON.stringify(a)}`);
        }
      }
      if (e.type === 'land') {
        const after = Int8Array.from(before); after[m.to] = after[m.from]; after[m.from] = EMPTY;
        if (bruteLines(after).length && !(sim.clearing?.by === 'move')) fail(id, 'a row made by the move was not cleared');
        if (!bruteLines(after).length && sim.clearing?.by === 'move') fail(id, 'a move cleared without a row');
      }
      if (e.type === 'clear') {
        // the cleared cells are exactly the rows standing on the board
        const want = bruteLines(sim.board), cells = new Set(want.flatMap(l => l.cells));
        if (cells.size !== e.cells.length || e.cells.some(i => !cells.has(i))) fail(id, `cleared ${e.cells.length} cells, rows cover ${cells.size}`);
        if (e.lines.length !== want.length) fail(id, `${e.lines.length} rows reported, ${want.length} standing`);
        if (e.pts !== linePoints(e.lines, e.by === 'move' ? e.streak : 1).pts) fail(id, 'points do not add up');
        cleared += e.cells.length; pts += e.pts; clears++;
      }
    }
    sim.events.length = 0;
  }
  if (sim.phase !== 'idle' && sim.phase !== 'over') { fail(id, `stuck in ${sim.phase}`); return false; }
  const n1 = count(sim.board);
  if (n1 !== n0 + arrived - cleared) fail(id, `marbles ${n0} + ${arrived} − ${cleared} ≠ ${n1}`);
  if (sim.score !== score0 + pts) fail(id, `score ${score0} + ${pts} ≠ ${sim.score}`);
  if (findLines(sim.board).length) fail(id, 'a row is left standing after the turn');
  if (clears && !arrived && sim.preview.some((p, k) => p.c !== pre[k].c)) fail(id, 'a clearing move changed the seeds');
  if (!clears && arrived === 0 && sim.phase !== 'over') fail(id, 'no clear and no arrivals');
  const full = freeCells(sim.board) === 0;
  if (full !== (sim.phase === 'over')) fail(id, `full ${full} but phase ${sim.phase}`);
  if (sim.phase === 'idle') {
    const at = sim.preview.map(p => p.at).filter(a => a >= 0);
    if (new Set(at).size !== at.length || at.some(a => sim.board[a] !== EMPTY)) fail(id, 'seeds overlap or sit on marbles');
    if (sim.preview.length !== PER_TURN) fail(id, `${sim.preview.length} seeds`);
    if (at.length !== Math.min(PER_TURN, freeCells(sim.board))) fail(id, `${at.length} seeds placed with ${freeCells(sim.board)} free`);
  }
  return true;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log(`soak: the demo's autopilot plays ${GAMES} boards to the end`);
{
  const t0 = Date.now(), scores = [], turns = [];
  let undos = 0, resumes = 0, prisms = 0, arrivals = 0, crosses = 0, longest = 0;
  for (let g = 0; g < GAMES && bad < 40; g++) {
    const id = `game ${g}`, sim = createSim({ seed: SEED * 100000 + g });
    sim.newGame();
    if (count(sim.board) !== START || findLines(sim.board).length) fail(id, 'a bad first board');
    sim.events.length = 0;
    const pilot = createPilot({ sloppy: 0.35, seed: g + 1 });
    try {
      for (let t = 0; t < 5000 && sim.phase === 'idle'; t++) {
        // now and then: the checkpoint resumed in a fresh sim must play on exactly the same
        let twin = null;
        if (rnd() < 0.02) {
          const st = JSON.parse(JSON.stringify(sim.state()));
          if (!validState(st)) fail(id, 'its own checkpoint is not valid');
          twin = createSim({ seed: 999 }); twin.resume(st); twin.events.length = 0; resumes++;
        }
        const m = pilot.choose(sim);
        if (!m) { fail(id, 'no move on a board with room'); break; }
        const snap = JSON.stringify(sim.state());
        if (!playTurn(sim, m, `${id} turn ${t}`)) break;
        if (twin) {
          twin.tryMove(m.from, m.to); twin.settle(); twin.events.length = 0;
          if (!same(twin.state(), sim.state()) || twin.phase !== sim.phase) fail(`${id} turn ${t}`, 'a resumed checkpoint played differently');
        }
        // now and then, take it back and check the board is as it was (then play on)
        if (sim.phase === 'idle' && sim.canUndo() && rnd() < 0.05) {
          const before = JSON.parse(snap);
          sim.undo(); sim.events.length = 0; undos++;
          const now = sim.state();
          if (!same(now.board, before.board) || !same(now.preview, before.preview) || now.score !== before.score || now.rs !== before.rs || now.undos !== before.undos - 1)
            fail(`${id} turn ${t}`, `take-back did not restore the board ${["board","preview","score","rs","undos"].filter(k => !same(now[k], k === "undos" ? before.undos - 1 : before[k])).join(",")}`);
          if (sim.canUndo()) fail(`${id} turn ${t}`, 'two take-backs in one turn');
        }
      }
    } catch (err) { fail(id, err.stack.split('\n').slice(0, 3).join(' ')); }
    if (sim.phase !== 'over') fail(id, `did not end (${sim.turn} turns, phase ${sim.phase})`);
    scores.push(sim.score); turns.push(sim.turn);
    prisms += sim.stats.prisms; arrivals += sim.stats.arrivals; crosses += sim.stats.bestCombo > 1 ? 1 : 0; longest = Math.max(longest, sim.stats.bestLine);
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
  console.log(`  ${bad ? '✗' : '✓'} ${scores.length} games in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${undos} take-backs and ${resumes} resumed checkpoints checked`);
  console.log(`    demo score   min ${q(scores, 0)}  p10 ${q(scores, 0.1)}  median ${q(scores, 0.5)}  p90 ${q(scores, 0.9)}  max ${q(scores, 1)}`);
  console.log(`    demo turns   min ${q(turns, 0)}  median ${q(turns, 0.5)}  max ${q(turns, 1)};  rows of the arrivals ${arrivals}, prism rows ${prisms}, games with a cross ${crosses}, longest row ${longest}`);
}

// ---------- 4. the strong autopilot ----------
console.log(`scores: the strong autopilot plays ${STRONG} boards`);
{
  const scores = [], turns = [];
  for (let g = 0; g < STRONG; g++) {
    const sim = createSim({ seed: SEED * 7777 + g }), pilot = createPilot({ seed: g + 5 });
    sim.newGame();
    for (let t = 0; t < 20000 && sim.phase === 'idle'; t++) { const m = pilot.choose(sim); if (!m || !sim.tryMove(m.from, m.to)) break; sim.settle(); sim.events.length = 0; }
    if (sim.phase !== 'over') fail(`strong ${g}`, `did not end in 20000 turns`);
    scores.push(sim.score); turns.push(sim.turn);
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
  console.log(`    strong score min ${q(scores, 0)}  p10 ${q(scores, 0.1)}  median ${q(scores, 0.5)}  p90 ${q(scores, 0.9)}  max ${q(scores, 1)};  turns median ${q(turns, 0.5)}`);
}

console.log(bad ? `✗ ${bad} problem(s)` : '✓ all checks passed');
process.exit(bad ? 1 : 0);
