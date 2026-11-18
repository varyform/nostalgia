// The autopilot: picks a move for the board as it stands. It prices every marble it could roll
// to every cell it can reach: a finished row first (the longer and the more rows, the better),
// otherwise the rows the marble would grow towards at its new cell, less what it leaves behind
// at the old one, and for the best few how the move splits the open space. `sloppy` (0–1)
// makes it settle for a lesser move now and then, as a person would, so the demo loses too.
//
//   const pilot = createPilot({ sloppy: 0.3, seed });
//   const m = pilot.choose(sim);   // { from, to } or null (a full board)
import { CELLS, COLOURS, DIRS, EMPTY, N, NBR, PRISM, linePoints, xOf, yOf } from './sim.js';

// what a window of five holding k of a colour (and nothing else in the way) is worth
const WIN = [0, 0.4, 2, 7, 26, 0];

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// the rows a marble of colour c would make standing at cell i: the potential of every five-cell
// window through i, and the longest straight run of c it would join
export function cellValue(board, i, c, seeds = null) {
  const x0 = xOf(i), y0 = yOf(i);
  let pot = 0, longest = 1;
  const runs = [];
  for (const [dx, dy] of DIRS) {
    // the run through i along this direction
    let run = 1;
    for (const s of [1, -1]) for (let k = 1; k < N; k++) {
      const x = x0 + dx * k * s, y = y0 + dy * k * s;
      if (x < 0 || x >= N || y < 0 || y >= N) break;
      const v = board[y * N + x];
      if (v !== c && v !== PRISM) break;
      run++;
    }
    longest = Math.max(longest, run);
    if (run >= 5) runs.push(run);
    for (let off = -4; off <= 0; off++) {
      let k = 0, ok = true, seed = 0;
      for (let j = 0; j < 5; j++) {
        const x = x0 + dx * (off + j), y = y0 + dy * (off + j);
        if (x < 0 || x >= N || y < 0 || y >= N) { ok = false; break; }
        const cell = y * N + x;
        if (cell === i) { k++; continue; }
        const v = board[cell];
        if (v === EMPTY) { if (seeds && seeds[cell] >= 0) { if (seeds[cell] === c) seed += 0.5; else seed -= 0.4; } continue; }
        if (v === c || v === PRISM) k++;
        else { ok = false; break; }
      }
      if (ok) pot += WIN[Math.min(5, k)] * (1 + 0.15 * seed);
    }
  }
  return { pot, longest, runs };
}

// empty regions: a label per empty cell (−1 for a marble) and each region's size
function regions(board) {
  const lab = new Int16Array(CELLS).fill(-1), size = [];
  for (let s = 0; s < CELLS; s++) {
    if (board[s] !== EMPTY || lab[s] >= 0) continue;
    const id = size.length, q = [s];
    lab[s] = id;
    for (let h = 0; h < q.length; h++) for (const v of NBR[q[h]]) if (board[v] === EMPTY && lab[v] < 0) { lab[v] = id; q.push(v); }
    size.push(q.length);
  }
  return { lab, size };
}
// how badly a board's open space is cut up: lone cells and pockets cost
function fragmentation(board) {
  const { size } = regions(board);
  let p = (size.length - 1) * 1.5;
  for (const s of size) if (s === 1) p += 2.5; else if (s === 2) p += 1;
  return p;
}

export function createPilot({ sloppy = 0, seed = 1, tune = null } = {}) {
  const rnd = mulberry32(seed);
  const T = { here: 0.95, frag: 2, top: 16, ...tune }; // weights (tools tune them)
  function choose(sim) {
    const b = Int8Array.from(sim.board), R = regions(b);
    const seeds = new Int8Array(CELLS).fill(-1);
    for (const p of sim.preview) if (p.at >= 0) seeds[p.at] = p.c;
    const cands = [];
    for (let p = 0; p < CELLS; p++) {
      const c = b[p];
      if (c === EMPTY) continue;
      // the regions this marble touches are where it can go
      const reach = new Set();
      for (const v of NBR[p]) if (b[v] === EMPTY) reach.add(R.lab[v]);
      if (!reach.size) continue;
      const colours = c === PRISM ? [...Array(COLOURS).keys()] : [c];
      const here = Math.max(...colours.map(k => cellValue(b, p, k, seeds).pot));
      b[p] = EMPTY;
      for (let t = 0; t < CELLS; t++) {
        if (b[t] !== EMPTY || !reach.has(R.lab[t])) continue;
        let best = -Infinity;
        for (const k of colours) {
          b[t] = c;
          const v = cellValue(b, t, k, seeds);
          b[t] = EMPTY;
          let val;
          if (v.runs.length) {
            const lines = v.runs.map(n => ({ cells: { length: Math.min(9, n) } }));
            val = 1000 + linePoints(lines).pts;
          } else {
            val = v.pot - here * T.here;
            if (seeds[t] >= 0) val -= 0.6; // the seed would have to grow somewhere random
          }
          best = Math.max(best, val);
        }
        cands.push({ from: p, to: t, val: best + rnd() * 0.3 });
      }
      b[p] = c;
    }
    if (!cands.length) return null;
    cands.sort((a, z) => z.val - a.val);
    // the best few non-clearing moves: weigh how they cut up the open space
    const top = cands.slice(0, T.top);
    for (const m of top) {
      if (m.val >= 1000) continue;
      const c = b[m.from];
      b[m.from] = EMPTY; b[m.to] = c;
      m.val -= fragmentation(b) * T.frag;
      b[m.to] = EMPTY; b[m.from] = c;
    }
    top.sort((a, z) => z.val - a.val);
    if (sloppy > 0) {
      const r = rnd();
      if (r < sloppy * 0.06) return pick(cands[Math.floor(rnd() * cands.length)]);
      if (r < sloppy * 0.45 && top.length > 1 && top[0].val < 1000) return pick(top[1 + Math.floor(rnd() * Math.min(4, top.length - 1))]);
    }
    return pick(top[0]);
  }
  const pick = m => ({ from: m.from, to: m.to });
  return { choose };
}
