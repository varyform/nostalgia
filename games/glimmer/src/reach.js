// The static level as a graph of the tiles Wren can be in and how he gets between them: walk,
// climb, rope, drop, fall, and dig-then-drop (a coral brick he can dig becomes a tile he can
// fall into). Sentinels and timing are left out, so it over-promises a little; the solver uses
// it as its distance estimate, the simulation to know where a sentinel may drop a glimmer, and
// verify.mjs to check that every glimmer and the way out can be reached at all.
import { COLS, ROWS, tileAt } from './level.js';

export function buildGraph(L, { stair = false } = {}) {
  const N = COLS * ROWS, ch = (c, r) => tileAt(L, c, r);
  const brick = (c, r) => ch(c, r) === '#';
  const solid = (c, r) => r < 0 || r >= ROWS || c < 0 || c >= COLS || brick(c, r) || ch(c, r) === '=';
  const ladder = (c, r) => r >= 0 && r < ROWS && (ch(c, r) === 'H' || (stair && ch(c, r) === '^'));
  const bar = (c, r) => ch(c, r) === '-';
  const floor = (c, r) => r >= ROWS || brick(c, r) || ch(c, r) === '=' || ladder(c, r);
  const rest = (c, r) => ladder(c, r) || bar(c, r) || floor(c, r + 1);
  const out = Array.from({ length: N }, () => []);
  const add = (i, c, r, cost) => out[i].push(r * COLS + c, cost);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (ch(c, r) === '=') continue;
      const i = r * COLS + c, inBrick = brick(c, r); // a brick tile is a hole he dug and fell into
      if (!rest(c, r)) { if (r + 1 < ROWS) add(i, c, r + 1, 1); continue; }
      for (const dx of [-1, 1]) if (!solid(c + dx, r)) add(i, c + dx, r, 1);
      if (ladder(c, r) && !solid(c, r - 1)) add(i, c, r - 1, 1);
      if (!solid(c, r + 1) && (ladder(c, r) || bar(c, r) || ladder(c, r + 1))) add(i, c, r + 1, 1);
      // dig the brick down beside him and drop into it (from inside a hole, the brick next to him
      // has to be dug out first: two holes side by side)
      for (const dx of [-1, 1]) {
        const tc = c + dx;
        if (!brick(tc, r + 1) || ladder(tc, r)) continue;
        if (!solid(tc, r)) add(i, tc, r + 1, 3);
        else if (inBrick && brick(tc, r)) add(i, tc, r + 1, 6);
      }
    }
  // reverse edges, for distances to a goal
  const back = Array.from({ length: N }, () => []);
  out.forEach((e, i) => { for (let k = 0; k < e.length; k += 2) back[e[k]].push(i, e[k + 1]); });
  const fields = new Map();
  return {
    out, back, ladder,
    // every tile reachable from (c, r)
    reach(c, r) {
      const seen = new Uint8Array(N), q = [r * COLS + c];
      seen[q[0]] = 1;
      while (q.length) { const i = q.pop(), e = out[i]; for (let k = 0; k < e.length; k += 2) if (!seen[e[k]]) { seen[e[k]] = 1; q.push(e[k]); } }
      return seen;
    },
    // cost to the nearest of the goal tiles from every tile (Infinity where none can be reached)
    field(goals) {
      const key = goals.join(',');
      let d = fields.get(key);
      if (d) return d;
      d = new Float64Array(N).fill(Infinity);
      const q = [];
      for (const g of goals) { d[g] = 0; q.push(g); }
      // costs are small integers: a bucket queue
      const buckets = [q];
      for (let b = 0; b < buckets.length; b++) {
        const list = buckets[b];
        if (!list) continue;
        for (let h = 0; h < list.length; h++) {
          const i = list[h];
          if (d[i] < b) continue;
          const e = back[i];
          for (let k = 0; k < e.length; k += 2) {
            const j = e[k], nd = b + e[k + 1];
            if (nd < d[j]) { d[j] = nd; (buckets[nd] ??= []).push(j); }
          }
        }
      }
      if (fields.size > 256) fields.clear();
      fields.set(key, d);
      return d;
    },
  };
}
