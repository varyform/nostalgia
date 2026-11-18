// The rules: a 9 × 9 board of glass marbles in seven colours (and, later on, the odd prism that
// counts as any colour). A turn rolls one marble along open cells (up, down, left, right) to
// any cell it can reach. Five or more of a colour in a row — across, down or on a diagonal —
// shatter, score and give a free turn; otherwise the three seeds on the board (their colours
// and cells shown a turn ahead) grow into marbles, and they can complete rows themselves. The
// game ends when the board is full.
//
// Pure and deterministic: its own seeded random numbers, no DOM. A turn plays out in timed
// phases (roll → clear | arrive → clear → idle) on fixed steps, so the renderer can show each
// one by reading the state; `events` lists what happened during the last step.
//
//   const sim = createSim({ seed });
//   sim.newGame();
//   sim.tryMove(from, to);        // false (and a 'blocked' event) when no open path joins them
//   sim.step(DT);                 // advances the phases
//   sim.undo();                   // back to before the last move: once per turn, costs a take-back
//   const st = sim.state();       // a checkpoint between turns; sim.resume(st) restores it exactly
//   sim.settle();                 // finish the current turn at once (tools, tests)
//
// Cells are numbered y * 9 + x; a cell holds EMPTY, a colour 0–6 or PRISM.
export const N = 9, CELLS = N * N, COLOURS = 7, PRISM = 7, EMPTY = -1;
export const DT = 1 / 60;
export const START = 5, PER_TURN = 3, MIN_LINE = 5;
// a row of n is worth LINE_PTS[n]; rows cleared together multiply by their count, and clears on
// consecutive moves by 1.25, 1.5, 1.75, then 2
export const LINE_PTS = [0, 0, 0, 0, 0, 50, 120, 250, 500, 1000];
export const UNDO_START = 2, UNDO_MAX = 3;
export const PRISM_FROM = 30, PRISM_CHANCE = 0.02, PRISM_GAP = 20; // turns between prisms, at least
export const ROLL_STEP = 0.055, ROLL_MAX = 0.8, CLEAR_T = 0.62, ARRIVE_T = 0.5;
export const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
export const STATE_VERSION = 1;

export const xOf = i => i % N, yOf = i => (i / N) | 0;
const at = (x, y) => (x >= 0 && x < N && y >= 0 && y < N ? y * N + x : -1);
// the four neighbours of every cell, precomputed
export const NBR = Array.from({ length: CELLS }, (_, i) =>
  [at(xOf(i) + 1, yOf(i)), at(xOf(i) - 1, yOf(i)), at(xOf(i), yOf(i) + 1), at(xOf(i), yOf(i) - 1)].filter(v => v >= 0));
// every line of five or more cells along each direction: { dir, cells }
export const LINES = [];
for (let d = 0; d < DIRS.length; d++) {
  const [dx, dy] = DIRS[d];
  for (let s = 0; s < CELLS; s++) {
    if (at(xOf(s) - dx, yOf(s) - dy) >= 0) continue; // not the first cell of its line
    const cells = [];
    for (let x = xOf(s), y = yOf(s); at(x, y) >= 0; x += dx, y += dy) cells.push(at(x, y));
    if (cells.length >= MIN_LINE) LINES.push({ dir: d, cells });
  }
}

// ---------- pure helpers, shared with the autopilot and the tools ----------
// the shortest open path from `from` to the empty cell `to` (both ends included), or null
export function findPath(board, from, to) {
  if (from === to || board[to] !== EMPTY || board[from] === EMPTY) return null;
  const prev = new Int16Array(CELLS).fill(-1);
  prev[from] = from;
  const q = [from];
  for (let h = 0; h < q.length && prev[to] < 0; h++) {
    const u = q[h];
    for (const v of NBR[u]) if (prev[v] < 0 && board[v] === EMPTY) { prev[v] = u; q.push(v); }
  }
  if (prev[to] < 0) return null;
  const path = [];
  for (let v = to; v !== from; v = prev[v]) path.push(v);
  path.push(from);
  return path.reverse();
}
// the empty cells a marble at `from` can roll to: a 0/1 mask
export function reachable(board, from) {
  const seen = new Uint8Array(CELLS), q = [from];
  seen[from] = 1;
  for (let h = 0; h < q.length; h++) for (const v of NBR[q[h]]) if (!seen[v] && board[v] === EMPTY) { seen[v] = 1; q.push(v); }
  seen[from] = 0;
  return seen;
}
// every row of MIN_LINE or more: [{ c, dir, cells }]. A prism joins a row of any colour, so one
// prism can finish two rows of different colours along the same line.
export function findLines(board) {
  const out = [];
  for (const L of LINES) {
    const cs = L.cells, n = cs.length;
    for (let c = 0; c < COLOURS; c++) {
      let run = 0, real = 0;
      for (let k = 0; k <= n; k++) {
        const v = k < n ? board[cs[k]] : EMPTY;
        if (v === c || v === PRISM) { run++; if (v === c) real++; continue; }
        if (run >= MIN_LINE && real > 0) out.push({ c, dir: L.dir, cells: cs.slice(k - run, k) });
        run = 0; real = 0;
      }
    }
  }
  return out;
}
// what a set of rows cleared together is worth on the given streak (1 = the first clear in a row)
export function linePoints(lines, streak = 1) {
  const base = lines.reduce((s, l) => s + LINE_PTS[Math.min(9, l.cells.length)], 0);
  const combo = lines.length, chain = 1 + 0.25 * Math.min(4, Math.max(0, streak - 1));
  return { base, combo, chain, pts: Math.round((base * combo * chain) / 10) * 10 };
}
export const freeCells = board => { let n = 0; for (let i = 0; i < CELLS; i++) if (board[i] === EMPTY) n++; return n; };

// a checkpoint read back from storage: is it one this sim can resume?
export function validState(st, nested = false) {
  if (!st || typeof st !== 'object') return false;
  const { board, preview } = st;
  if (!Array.isArray(board) || board.length !== CELLS || !board.every(v => Number.isInteger(v) && v >= EMPTY && v <= PRISM)) return false;
  if (!Array.isArray(preview) || preview.length > PER_TURN) return false;
  const seen = new Set();
  for (const p of preview) {
    if (!p || !Number.isInteger(p.c) || p.c < 0 || p.c > PRISM || !Number.isInteger(p.at) || p.at < -1 || p.at >= CELLS) return false;
    if (p.at >= 0 && (board[p.at] !== EMPTY || seen.has(p.at))) return false;
    seen.add(p.at);
  }
  for (const k of ['score', 'turn', 'streak', 'undos', 'prismT', 'rs']) if (!Number.isFinite(st[k])) return false;
  if (!st.stats || typeof st.stats !== 'object') return false;
  if (findLines(board).length || freeCells(board) === 0) return false;
  if (st.undoSnap != null && (nested || !validState(st.undoSnap, true))) return false;
  return true;
}

const freshStats = () => ({ lines: 0, cleared: 0, bestLine: 0, bestCombo: 0, bestStreak: 0, arrivals: 0, undos: 0, prisms: 0, best: 0 });

export function createSim({ seed = 1 } = {}) {
  let rs = seed | 0;
  // mulberry32, with its state in `rs` so a checkpoint can carry it
  function rnd() {
    rs = (rs + 0x6d2b79f5) | 0;
    let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const ri = n => Math.floor(rnd() * n);

  const S = {
    events: [],
    board: new Int8Array(CELLS).fill(EMPTY),
    preview: [], // [{ c, at }]: the next marbles and the cells they will grow in (at −1: none free)
    score: 0, turn: 0, streak: 0, undos: UNDO_START, undoSnap: null, prismT: 0,
    stats: freshStats(),
    phase: 'idle', phaseT: 0, // idle | roll | clear | arrive | over
    roll: null, // { from, to, path, c, dur }
    clearing: null, // { cells, lines, pts, by: 'move' | 'arrive', combo, chain }
    arriving: null, // [{ at, c, from }] while they grow in (from: the seed's cell when it had to move)
    lastClear: null,
    newGame, state, resume, tryMove, undo, canUndo, step, settle, reseed, free: () => freeCells(S.board),
  };
  const emit = (type, e = {}) => S.events.push({ type, ...e });

  function reseed(s) { rs = s | 0; }
  function emptyCells(skip = null) {
    const out = [];
    for (let i = 0; i < CELLS; i++) if (S.board[i] === EMPTY && !skip?.has(i)) out.push(i);
    return out;
  }
  const hasPrism = () => S.board.includes(PRISM) || S.preview.some(p => p.c === PRISM);
  function newPreview() {
    const cells = emptyCells(), out = [];
    let prism = hasPrism();
    for (let k = 0; k < PER_TURN; k++) {
      let c = ri(COLOURS);
      if (!prism && S.turn >= PRISM_FROM && S.turn - S.prismT >= PRISM_GAP && rnd() < PRISM_CHANCE) { c = PRISM; prism = true; S.prismT = S.turn; }
      const j = cells.length ? ri(cells.length) : -1;
      out.push({ c, at: j < 0 ? -1 : cells.splice(j, 1)[0] });
    }
    S.preview = out;
  }

  function newGame() {
    S.score = 0; S.turn = 0; S.streak = 0; S.undos = UNDO_START; S.undoSnap = null; S.prismT = 0;
    S.stats = freshStats();
    do {
      S.board.fill(EMPTY);
      const cells = emptyCells();
      for (let k = 0; k < START; k++) S.board[cells.splice(ri(cells.length), 1)[0]] = ri(COLOURS);
    } while (findLines(S.board).length);
    S.preview = [];
    newPreview();
    toIdle();
    emit('newgame');
  }

  // ---------- checkpoints ----------
  function snap() {
    return {
      board: Array.from(S.board), preview: S.preview.map(p => ({ c: p.c, at: p.at })),
      score: S.score, turn: S.turn, streak: S.streak, undos: S.undos, prismT: S.prismT, rs, stats: { ...S.stats },
    };
  }
  function state() { return { ...snap(), undoSnap: S.undoSnap }; }
  function load(st) {
    S.board.set(st.board);
    S.preview = st.preview.map(p => ({ c: p.c, at: p.at }));
    S.score = st.score; S.turn = st.turn; S.streak = st.streak; S.undos = st.undos; S.prismT = st.prismT; rs = st.rs | 0;
    S.stats = { ...freshStats(), ...st.stats };
  }
  function resume(st) {
    load(st);
    S.undoSnap = st.undoSnap ? { ...st.undoSnap } : null;
    toIdle();
    emit('resume');
  }
  function toIdle() {
    S.phase = 'idle'; S.phaseT = 0; S.roll = null; S.clearing = null; S.arriving = null;
  }

  // ---------- a turn ----------
  function tryMove(from, to) {
    if (S.phase !== 'idle' || S.board[from] === EMPTY) return false;
    const path = findPath(S.board, from, to);
    if (!path) { emit('blocked', { from, to }); return false; }
    S.undoSnap = snap();
    const c = S.board[from];
    S.board[from] = EMPTY;
    S.roll = { from, to, path, c, dur: Math.min(ROLL_MAX, Math.max(0.14, ROLL_STEP * (path.length - 1))) };
    S.turn++;
    S.phase = 'roll'; S.phaseT = 0;
    emit('roll', { from, to, steps: path.length - 1, c, dur: S.roll.dur });
    return true;
  }
  function land() {
    const { to, c } = S.roll;
    S.board[to] = c;
    S.roll = null;
    emit('land', { at: to, c });
    const lines = findLines(S.board);
    if (lines.length) startClear(lines, 'move');
    else { S.streak = 0; startArrive(); }
  }
  function startClear(lines, by) {
    if (by === 'move') S.streak++;
    const cells = [...new Set(lines.flatMap(l => l.cells))];
    const P = linePoints(lines, by === 'move' ? S.streak : 1);
    S.score += P.pts;
    const st = S.stats, longest = Math.max(...lines.map(l => l.cells.length));
    st.lines += lines.length; st.cleared += cells.length;
    st.bestLine = Math.max(st.bestLine, longest); st.bestCombo = Math.max(st.bestCombo, lines.length);
    st.bestStreak = Math.max(st.bestStreak, S.streak); st.best = Math.max(st.best, P.pts);
    if (by === 'arrive') st.arrivals++;
    if (cells.some(i => S.board[i] === PRISM)) st.prisms++;
    // a long row or a cross earns a take-back
    let token = false;
    if ((longest >= 6 || lines.length >= 2) && S.undos < UNDO_MAX) { S.undos++; token = true; }
    S.clearing = { cells, lines, by, ...P, streak: by === 'move' ? S.streak : 0, colours: cells.map(i => S.board[i]) };
    S.lastClear = S.clearing;
    S.phase = 'clear'; S.phaseT = 0;
    emit('clear', { cells, lines, by, pts: P.pts, base: P.base, combo: P.combo, chain: P.chain, streak: S.clearing.streak, longest, token });
  }
  function finishClear() {
    const { cells, by } = S.clearing;
    for (const i of cells) S.board[i] = EMPTY;
    S.clearing = null;
    if (by === 'move') { seedHomes(); endTurn(); }
    else afterArrivals();
  }
  // seeds that found no free cell when they were sown take one the clear just opened
  function seedHomes() {
    const taken = new Set(S.preview.map(p => p.at));
    for (const p of S.preview) {
      if (p.at >= 0) continue;
      const cells = emptyCells(taken);
      if (!cells.length) return;
      p.at = cells[ri(cells.length)];
      taken.add(p.at);
    }
  }
  function startArrive() {
    const list = [], pending = S.preview.slice();
    for (let k = 0; k < pending.length; k++) {
      const p = pending[k];
      let cell = p.at;
      if (cell < 0 || S.board[cell] !== EMPTY) {
        // its cell was taken (the marble just rolled onto it): it grows somewhere else
        const later = new Set(pending.slice(k + 1).map(q => q.at)), cells = emptyCells(later);
        const any = cells.length ? cells : emptyCells();
        if (!any.length) break;
        cell = any[ri(any.length)];
      }
      S.board[cell] = p.c;
      list.push({ at: cell, c: p.c, from: cell !== p.at ? p.at : -1 });
    }
    S.preview = [];
    S.arriving = list;
    S.phase = 'arrive'; S.phaseT = 0;
    emit('arrive', { list });
  }
  function finishArrive() {
    S.arriving = null;
    const lines = findLines(S.board);
    if (lines.length) startClear(lines, 'arrive');
    else afterArrivals();
  }
  function afterArrivals() {
    if (freeCells(S.board) === 0) {
      S.phase = 'over'; S.phaseT = 0; S.undoSnap = null;
      emit('over', { score: S.score, turn: S.turn });
      return;
    }
    newPreview();
    endTurn();
  }
  function endTurn() {
    toIdle();
    emit('turn', { turn: S.turn, free: freeCells(S.board) });
  }

  // back to the board as it was before the last move (its seeds and random draws too); once per
  // turn, and only with a take-back in hand
  // (it spends one of the take-backs held before that move: one the move itself earned goes too)
  function canUndo() { return S.phase === 'idle' && !!S.undoSnap && S.undoSnap.undos > 0; }
  function undo() {
    if (!canUndo()) return false;
    const left = S.undoSnap.undos - 1, undos = S.stats.undos + 1;
    load(S.undoSnap);
    S.undos = left; S.stats.undos = undos; S.undoSnap = null;
    toIdle();
    emit('undo', { undos: left });
    return true;
  }

  function step(dt = DT) {
    if (S.phase === 'idle' || S.phase === 'over') return;
    S.phaseT += dt;
    if (S.phase === 'roll' && S.phaseT >= S.roll.dur) land();
    else if (S.phase === 'clear' && S.phaseT >= CLEAR_T) finishClear();
    else if (S.phase === 'arrive' && S.phaseT >= ARRIVE_T) finishArrive();
  }
  function settle() {
    for (let k = 0; k < 20 && S.phase !== 'idle' && S.phase !== 'over'; k++) step(10);
  }
  return S;
}
