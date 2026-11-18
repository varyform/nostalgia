// The autopilot: plays the attract-mode demo (and the balance harness). Each step it looks for
// the most urgent job: an empty about to fall off Pip's end, or a customer nobody has a glass
// for yet. Then it hops there, fills, and slides at the brim. With slack to spare it walks out
// for tips. `sloppy` (0–1) adds hesitation and the odd careless slide, so the demo can lose.
//
//   const pilot = createPilot(sim, { sloppy: 0.5, seed: 1 });
//   sim.step(pilot());
import { FILL_T, FULL_V, GRAB_X, HOP_T, ROWS, RUN_V } from './sim.js';

export function createPilot(sim, { sloppy = 0, seed = 7 } = {}) {
  let a = seed | 0;
  const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
  let cur = null, wait = 0, lastJob = '', careless = 0, pourHold = 0, bonusT = 0, bonusErr = false, lastIdx = -1;

  const hops = (from, to) => { const d = Math.abs(from - to); return Math.min(d, ROWS - d); };

  // Jobs, each with `at`: the latest time (s from now) Pip can be standing at that counter's
  // dispenser, and `work`: how long he is busy there once he arrives.
  function jobs() {
    const s = sim, P = s.P, sv = s.server, out = [];
    s.rows.forEach((row, r) => {
      for (const g of row.glasses) {
        if (g.full) continue;
        // caught at Pip's spot if he is on that counter in front of it, else at the end
        const spot = r === sv.row && sv.x <= g.x ? sv.x : 0;
        out.push({ kind: 'catch', row: r, at: (g.x - spot) / -g.v - 0.12, arrive: (g.x - spot) / -g.v, x: g.x, v: -g.v });
      }
      const free = row.cust.filter(c => c.state === 'walk' || c.state === 'wait').sort((p, q) => p.x - q.x);
      const flying = row.glasses.filter(g => g.full).length;
      if (free.length > flying) {
        const c = free[flying], fill = r === sv.row ? sv.fill : 0;
        const at = (c.x - GRAB_X) / P.walk - c.x / FULL_V - (1 - fill) * FILL_T - 0.1;
        out.push({ kind: 'serve', row: r, at, work: (1 - fill) * FILL_T + 0.05, need: free.length - flying });
      }
    });
    return out.sort((p, q) => p.at - q.at);
  }
  const travel = (from, to) => (from === to ? 0 : hops(from, to) * HOP_T + 0.04);
  // busy time at a job if started after `t0` seconds; an empty is met halfway, walking out to it
  const work = (j, t0) => (j.kind === 'catch' ? Math.max(0, j.x - j.v * t0) / (RUN_V + j.v) + 0.05 : j.work);

  function choose(list, sv) {
    const first = list[0];
    if (!first) return null;
    const walkBack = sv.x / RUN_V;
    let best = first, bestAt = Infinity;
    for (const j of list) {
      if (j === first) continue;
      const t1 = walkBack + travel(sv.row, j.row), done = t1 + work(j, t1);
      if (t1 > j.at + 0.6 && j.kind === 'catch') continue; // too late for it anyway
      if (done + travel(j.row, first.row) <= first.at && j.at < bestAt) { best = j; bestAt = j.at; }
    }
    return best;
  }

  function counterStep() {
    const s = sim, sv = s.server, inp = {};
    if (s.status !== 'play' && s.status !== 'ready') return inp;
    const list = jobs();
    let job = choose(list, sv);
    // stay with a counter already being hopped to, unless something else is about to be lost
    if (cur && sv.row !== cur.row) {
      const same = list.find(j => j.kind === cur.kind && j.row === cur.row);
      if (same && job !== same && !(job.at < 0.25 && same.at > job.at + 0.3)) job = same;
    }
    // finish a glass already filling unless something else cannot wait for it
    if (sv.fill > 0 && job && job.row !== sv.row) {
      const here = list.find(j => j.kind === 'serve' && j.row === sv.row);
      if (here && job.at > (1 - sv.fill) * FILL_T + travel(sv.row, job.row) + 0.05) job = here;
    }
    // with slack, fetch a tip
    if (!job || job.at > 2.5) {
      let tipJob = null;
      s.rows.forEach((row, r) => {
        for (const tp of row.tips) {
          const cost = travel(sv.row, r) + (tp.x / RUN_V) * 2 + 0.3;
          if ((!job || cost < job.at - 0.6) && tp.t < 8.5 && (!tipJob || cost < tipJob.cost)) tipJob = { kind: 'tip', row: r, x: tp.x, cost };
        }
      });
      if (tipJob) job = tipJob;
    }
    cur = job && job.kind !== 'tip' ? { kind: job.kind, row: job.row } : null;
    const key = job ? job.kind + job.row : '';
    if (key !== lastJob) {
      lastJob = key;
      if (sloppy && rnd() < sloppy * 0.35) wait = 0.08 + rnd() * 0.3 * sloppy;
    }
    if (wait > 0) { wait -= 1 / 60; return inp; }
    if (!job) {
      if (sv.x > 0.1) inp.toX = 0;
      return inp;
    }
    if (job.row !== sv.row) { inp.row = job.row; return inp; }
    if (job.kind === 'tip') { inp.toX = job.x; return inp; }
    const serveHere = list.find(j => j.kind === 'serve' && j.row === sv.row);
    if (job.kind === 'catch' && (!serveHere || serveHere.at > job.arrive + 0.3) && sv.fill === 0) {
      // nothing to pour here: walk out to meet the empty and be free sooner
      const g = sim.rows[sv.row].glasses.filter(q => !q.full && q.x >= sv.x - 0.3).sort((p, q) => p.x - q.x)[0];
      if (g) { inp.toX = g.x; return inp; }
    }
    if (sv.x > 0.1) { inp.toX = 0; return inp; }
    if (job.kind === 'serve' || serveHere) inp.pour = pour(sv);
    else if (sloppy && careless <= 0 && rnd() < sloppy * 0.0008) careless = 1;
    if (careless > 0 && !inp.pour) { inp.pour = pour(sv); if (!inp.pour) careless = 0; }
    return inp;
  }

  // hold until the brim, then let go (a sloppy pilot sometimes lingers past it)
  function pour(sv) {
    if (sv.fill < 1) { pourHold = sloppy ? rnd() * 0.12 * sloppy : 0; return true; }
    pourHold -= 1 / 60;
    return pourHold > 0;
  }

  function bonusStep() {
    const b = sim.bonus, inp = {};
    if (b.phase !== 'input') { bonusT = 0.45; lastIdx = -1; return inp; }
    if (b.idx !== lastIdx) { lastIdx = b.idx; bonusErr = sloppy > 0 && rnd() < sloppy * 0.06; }
    bonusT -= 1 / 60;
    if (bonusT > 0) return inp;
    bonusT = 0.3 + rnd() * 0.25;
    inp.pad = bonusErr ? (b.seq[b.idx] + 1) % 4 : b.seq[b.idx];
    return inp;
  }

  return () => (sim.mode === 'bonus' ? bonusStep() : counterStep());
}
