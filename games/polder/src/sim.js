// The rules of Polder, pure and deterministic: no DOM, a fixed step, events out.
//
// The field is a W × H grid. A border of old dyke rings the tidal flats (SEA); Maren's skimmer
// runs on the grid in four directions. On land it goes where it's steered and stops when
// let go; out on the water it keeps going, staking a new dyke behind it (TRAIL). Reaching land
// again closes the dyke: every stretch of water with no jellyfish in it drains to meadow (a
// flood fill from the jellies; the rest is claimed). Jellyfish drift diagonally on the water
// and break an unfinished dyke they touch; shore crabs scuttle diagonally on the land; from
// Grey Sound on, the undertow runs along a fresh dyke after the skimmer. The tide clock brings
// another jelly in when it runs out. Claim the stage's share of the flats to clear it.
//
//   const sim = createSim({ seed });
//   sim.newGame();  sim.step({ dir: 'left' | 'right' | 'up' | 'down' | null, press: dir | null });
//   sim.events → [{ type, … }] (the caller empties it);  sim.advance();  sim.clone()
//   sim.state() → a checkpoint (the stage's start);  sim.resume(state)
export const DT = 1 / 60;
export const W = 64, H = 40, B = 2, N = W * H;
export const SEA = 0, LAND = 1, TRAIL = 2;
// what a land cell is, for the renderer: the old dyke, a sandbank, drained meadow, a new dyke
export const MADE = { sea: 0, dyke: 1, sand: 2, meadow: 3, built: 4 };
export const INNER = (W - 2 * B) * (H - 2 * B);
export const P_V = 12; // the skimmer, cells a second
export const READY_T = 1.1, DEAD_T = 1.8, CLEAR_T = 4.4, SAFE_T = 2.2;
export const TIDE_AGAIN = 45, MAX_JELLIES = 9, SLACK_T = 7, SLACK = 0.35;
export const START = { x: 0, y: H >> 1 };
export const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
export const STATE_VERSION = 1;
const OPP = { left: 'right', right: 'left', up: 'down', down: 'up' };
export const LIFE_EVERY = 60000;
const HIT = 0.8; // how close (in cells) a jelly or crab must come to the skimmer to hit it

// The stages: jellies (drifters, plus the faster nettles), crabs, the share to claim, the
// jellies' speed, the tide clock, pearls and conches in the water, the undertow (its head
// start in seconds and its speed against the skimmer's), and the sandbanks and groynes the
// stage starts with (ellipses [cx, cy, rx, ry], rects [x, y, w, h], in cells).
export const STAGES = [
  { id: 'saltmarsh', name: 'Saltmarsh', light: 0, jellies: 2, nettles: 0, crabs: 0, target: 0.75, jv: 7.5, tide: 120, pearls: 0, conch: 0 },
  { id: 'reedbay', name: 'Reed Bay', light: 0, jellies: 3, nettles: 0, crabs: 0, target: 0.75, jv: 7.5, tide: 120, pearls: 2, conch: 0 },
  { id: 'heron', name: 'Heron Flats', light: 0, jellies: 3, nettles: 0, crabs: 1, target: 0.75, jv: 8, tide: 115, pearls: 2, conch: 1,
    banks: [['e', 20, 12, 4, 2], ['e', 44, 28, 5, 2]] },
  { id: 'oyster', name: 'Oyster Banks', light: 1, jellies: 4, nettles: 0, crabs: 1, target: 0.75, jv: 8, tide: 110, pearls: 3, conch: 1,
    banks: [['e', 16, 28, 3, 2], ['e', 32, 11, 3, 2], ['e', 48, 26, 3, 2]] },
  { id: 'greysound', name: 'Grey Sound', light: 1, jellies: 4, nettles: 0, crabs: 1, target: 0.76, jv: 8.5, tide: 110, pearls: 2, conch: 1,
    tow: [1.7, 1.25] },
  { id: 'gullrock', name: 'Gull Rock', light: 1, jellies: 5, nettles: 0, crabs: 2, target: 0.77, jv: 8.5, tide: 105, pearls: 3, conch: 1,
    banks: [['e', 34, 20, 5, 4]] },
  { id: 'mistwater', name: 'Mistwater', light: 2, jellies: 4, nettles: 1, crabs: 2, target: 0.77, jv: 9, tide: 105, pearls: 3, conch: 1 },
  { id: 'kelp', name: 'Kelp Narrows', light: 2, jellies: 4, nettles: 1, crabs: 2, target: 0.78, jv: 9, tide: 100, pearls: 2, conch: 1,
    tow: [1.5, 1.25], banks: [['r', 21, 2, 2, 12], ['r', 42, 26, 2, 12]] },
  { id: 'storm', name: 'Storm Reach', light: 2, jellies: 5, nettles: 1, crabs: 2, target: 0.78, jv: 9.5, tide: 100, pearls: 3, conch: 1,
    tow: [1.4, 1.3], banks: [['r', 31, 2, 3, 7], ['r', 31, 31, 3, 7]] },
  { id: 'lantern', name: 'Lantern Cove', light: 3, jellies: 5, nettles: 2, crabs: 2, target: 0.79, jv: 9.5, tide: 95, pearls: 3, conch: 1,
    banks: [['r', 2, 30, 13, 2], ['e', 46, 12, 4, 3]] },
  { id: 'skerries', name: 'Seal Skerries', light: 3, jellies: 5, nettles: 2, crabs: 3, target: 0.8, jv: 10, tide: 95, pearls: 4, conch: 1,
    tow: [1.3, 1.3], banks: [['e', 14, 10, 1.6, 1.4], ['e', 26, 30, 2, 1.5], ['e', 38, 9, 1.6, 1.4], ['e', 50, 24, 2, 2], ['e', 22, 19, 1.5, 1.4], ['e', 44, 32, 1.6, 1.2]] },
  { id: 'hightide', name: 'High Water', light: 3, jellies: 6, nettles: 2, crabs: 3, target: 0.8, jv: 10, tide: 90, pearls: 3, conch: 1,
    tow: [1.1, 1.3] },
];
// the in-play tune, four stages each
export const trackOf = stage => ['flats', 'sound', 'storm'][Math.min(2, Math.floor(stage / 4))];

const at = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && x < W && y >= 0 && y < H;
const hash = (...v) => { let h = 2166136261; for (const n of v) { h ^= n | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; } return h >>> 0; };

// scratch for the fills (single-threaded, never re-entered)
const MARK = new Int32Array(N), QUEUE = new Int32Array(N);
let markGen = 1, SERIAL = 0; // stage loads, numbered across every sim (the renderer keys its layers on it)

// the fields that make up a sim's state: clone() copies exactly these
const DATA = ['seed', 'rng', 'stage', 'loop', 'score', 'lives', 'nextLife', 'status', 'statusT', 't', 'tide', 'slack', 'grid', 'made', 'p', 'trail',
  'from', 'tow', 'jellies', 'crabs', 'items', 'claimed', 'landRev', 'stats', 'serial', 'clearInfo'];

export function createSim({ seed = 1 } = {}) {
  const sim = {
    events: [],
    seed: seed >>> 0, rng: 1, stage: 0, loop: 0, score: 0, lives: 3, nextLife: LIFE_EVERY,
    status: 'ready', statusT: 0, t: 0, tide: 0, slack: 0,
    grid: new Uint8Array(N), made: new Uint8Array(N),
    p: null, trail: [], from: -1, tow: null, jellies: [], crabs: [], items: [],
    claimed: 0, landRev: 0, serial: 0, clearInfo: null,
    stats: { cuts: 0, biggest: 0, pearls: 0, stages: 0 },
    get sc() { return STAGES[sim.stage]; },
    get pct() { return sim.claimed / INNER; },
    reseed, newGame, resume, advance, state, step, clone, posOf,
  };
  const ev = e => sim.events.push(e);
  function rand() {
    // mulberry32
    let a = (sim.rng = (sim.rng + 0x6d2b79f5) | 0);
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  }
  const ri = n => Math.floor(rand() * n);

  function reseed(s) { sim.seed = s >>> 0; }

  // ---------- a stage as it begins ----------
  function loadStage() {
    const sc = STAGES[sim.stage], G = sim.grid, M = sim.made;
    sim.rng = hash(sim.seed, sim.stage + 1, sim.loop + 1) | 0;
    sim.serial = ++SERIAL;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const edge = x < B || y < B || x >= W - B || y >= H - B;
      G[at(x, y)] = edge ? LAND : SEA;
      M[at(x, y)] = edge ? MADE.dyke : MADE.sea;
    }
    for (const [k, a, b, c, d] of sc.banks ?? []) {
      for (let y = B; y < H - B; y++) for (let x = B; x < W - B; x++) {
        const hit = k === 'e' ? ((x + 0.5 - a) / c) ** 2 + ((y + 0.5 - b) / d) ** 2 <= 1 : x >= a && x < a + c && y >= b && y < b + d;
        if (hit) { G[at(x, y)] = LAND; M[at(x, y)] = MADE.sand; }
      }
    }
    sim.claimed = countInner();
    sim.landRev++;
    sim.p = { x: START.x, y: START.y, px: START.x, py: START.y, k: 1, moving: false, dir: 'right', buf: null, safe: 0 };
    sim.trail = []; sim.from = -1; sim.tow = null; sim.slack = 0; sim.t = 0; sim.clearInfo = null;
    sim.tide = sc.tide;
    const speed = sc.jv * (1 + 0.1 * Math.min(4, sim.loop));
    sim.jellies = [];
    for (let k = 0; k < sc.jellies + sc.nettles; k++) addJelly(k >= sc.jellies ? 'nettle' : 'drifter', speed);
    sim.crabs = [];
    for (let k = 0; k < sc.crabs; k++) {
      // along the far side's dyke, away from the skimmer
      let x = 0, y = 0;
      for (let n = 0; n < 200; n++) { x = W - 1 - ri(2); y = 2 + ri(H - 4); if (G[at(x, y)] === LAND) break; }
      sim.crabs.push(actor(x, y, rand() < 0.5 ? 1 : -1, rand() < 0.5 ? 1 : -1, 5.2 + 0.4 * Math.min(4, sim.loop) + 0.3 * k));
    }
    sim.items = [];
    const place = kind => {
      for (let n = 0; n < 400; n++) {
        const x = B + 4 + ri(W - 2 * B - 8), y = B + 4 + ri(H - 2 * B - 8), i = at(x, y);
        if (G[i] === SEA && !sim.items.some(o => Math.abs((o.i % W) - x) + Math.abs(Math.floor(o.i / W) - y) < 8)) { sim.items.push({ i, kind }); return; }
      }
    };
    for (let k = 0; k < sc.pearls; k++) place('pearl');
    for (let k = 0; k < sc.conch; k++) place('conch');
    sim.status = 'ready'; sim.statusT = 0;
    ev({ type: 'stage', stage: sim.stage, loop: sim.loop });
  }
  function actor(x, y, dx, dy, speed, kind) { return { x, y, px: x, py: y, k: rand(), dx, dy, speed, kind }; }
  // a jelly in open water, clear of the skimmer
  function addJelly(kind, speed, near = null) {
    const G = sim.grid, open = (x, y) => { for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) if (G[at(x + u, y + v)] !== SEA) return false; return true; };
    const p = sim.p;
    for (let n = 0; n < 600; n++) {
      const x = B + 1 + ri(W - 2 * B - 2), y = B + 1 + ri(H - 2 * B - 2);
      if (!open(x, y) || Math.abs(x - p.x) + Math.abs(y - p.y) < 14) continue;
      if (near && !near(at(x, y))) continue;
      const j = actor(x, y, rand() < 0.5 ? 1 : -1, rand() < 0.5 ? 1 : -1, speed * (kind === 'nettle' ? 1.4 : 1), kind);
      sim.jellies.push(j);
      return j;
    }
    return null;
  }
  function countInner() {
    let n = 0;
    for (let y = B; y < H - B; y++) for (let x = B; x < W - B; x++) if (sim.grid[at(x, y)] === LAND) n++;
    return n;
  }

  function newGame() {
    sim.stage = 0; sim.loop = 0; sim.score = 0; sim.lives = 3; sim.nextLife = LIFE_EVERY;
    sim.stats = { cuts: 0, biggest: 0, pearls: 0, stages: 0 };
    loadStage();
    ev({ type: 'newgame' });
  }
  function state() {
    return { stage: sim.stage, loop: sim.loop, score: sim.score, lives: sim.lives, nextLife: sim.nextLife, seed: sim.seed };
  }
  function resume(st) {
    sim.stage = st.stage; sim.loop = st.loop; sim.score = st.score; sim.lives = st.lives; sim.nextLife = st.nextLife; sim.seed = st.seed >>> 0;
    sim.stats = { cuts: 0, biggest: 0, pearls: 0, stages: 0 };
    loadStage();
    ev({ type: 'resume' });
  }
  function advance() {
    sim.stage++;
    if (sim.stage >= STAGES.length) { sim.stage = 0; sim.loop++; }
    loadStage();
  }

  // where an actor is drawn (and hit): between the cell it left and the one it's making for
  function posOf(a) {
    const k = Math.min(1, a.k);
    return { x: a.px + (a.x - a.px) * k, y: a.py + (a.y - a.py) * k };
  }

  // ---------- one fixed step ----------
  function step(input = {}) {
    sim.statusT += DT;
    if (sim.status === 'ready') {
      if (input.press) sim.p.buf = input.press;
      if (sim.statusT >= READY_T) { sim.status = 'play'; sim.statusT = 0; ev({ type: 'go' }); }
      return;
    }
    if (sim.status === 'dead') {
      if (sim.statusT >= DEAD_T) respawn();
      return;
    }
    if (sim.status !== 'play') return;
    sim.t += DT;
    sim.tide -= DT;
    if (sim.tide <= 0) {
      sim.tide = TIDE_AGAIN;
      if (sim.jellies.length < MAX_JELLIES) {
        const j = addJelly(sim.jellies.length % 3 === 2 ? 'nettle' : 'drifter', sim.sc.jv * (1 + 0.1 * Math.min(4, sim.loop)), seaWithJelly());
        ev({ type: 'tide', x: j?.x ?? -1, y: j?.y ?? -1 });
      } else ev({ type: 'tide', x: -1, y: -1 });
    }
    if (sim.slack > 0 && (sim.slack -= DT) <= 0) { sim.slack = 0; ev({ type: 'slackend' }); }
    const p = sim.p;
    if (p.safe > 0) p.safe = Math.max(0, p.safe - DT);
    if (input.press) p.buf = input.press;
    movePlayer(input.dir ?? null);
    if (sim.status !== 'play') return;
    const slow = sim.slack > 0 ? SLACK : 1;
    for (const j of sim.jellies) {
      j.k += j.speed * slow * DT;
      while (j.k >= 1 && sim.status === 'play') { j.k -= 1; turn(j, SEA); }
      if (sim.status !== 'play') return;
    }
    for (const c of sim.crabs) {
      c.k += c.speed * DT;
      while (c.k >= 1) { c.k -= 1; turn(c, LAND); }
    }
    undertow(slow);
    if (sim.status !== 'play') return;
    hits();
  }

  // ---------- the skimmer ----------
  function movePlayer(held) {
    const p = sim.p, G = sim.grid;
    if (!p.moving) {
      const want = p.buf || held;
      p.buf = null;
      if (want) {
        const [dx, dy] = DIRS[want];
        if (inside(p.x + dx, p.y + dy)) { p.dir = want; p.px = p.x; p.py = p.y; p.x += dx; p.y += dy; p.k = 0; p.moving = true; }
      }
      if (!p.moving) return;
    }
    p.k += P_V * DT;
    if (p.k < 1) return;
    // arrived
    p.k -= 1;
    const i = at(p.x, p.y), c = G[i];
    if (c === TRAIL) { die('tangle', p.x, p.y); return; }
    if (c === SEA) {
      if (!sim.trail.length) {
        sim.from = at(p.px, p.py);
        ev({ type: 'launch', x: p.x, y: p.y });
        const tw = sim.sc.tow;
        if (tw) sim.tow = { pos: -tw[0] * P_V * tw[1], speed: P_V * tw[1], on: false };
      }
      G[i] = TRAIL;
      sim.trail.push(i);
      ev({ type: 'wake', n: sim.trail.length, x: p.x, y: p.y });
    } else if (sim.trail.length) {
      close();
      if (sim.status !== 'play') { p.moving = false; p.k = 1; p.px = p.x; p.py = p.y; return; }
    }
    // the next cell: on the water the skimmer keeps going (and can't turn back on its dyke)
    const onSea = G[i] === TRAIL;
    let want = p.buf || held;
    p.buf = null;
    if (onSea) {
      if (want === OPP[p.dir] && sim.trail.length > 1) want = null;
      if (want) p.dir = want;
      const [dx, dy] = DIRS[p.dir];
      p.px = p.x; p.py = p.y; p.x += dx; p.y += dy;
    } else if (want && inside(p.x + DIRS[want][0], p.y + DIRS[want][1])) {
      p.dir = want;
      const [dx, dy] = DIRS[want];
      p.px = p.x; p.py = p.y; p.x += dx; p.y += dy;
    } else {
      p.moving = false; p.k = 1; p.px = p.x; p.py = p.y;
    }
  }

  // ---------- jellies and crabs: diagonal, bouncing off whatever isn't theirs ----------
  function turn(a, home) {
    const G = sim.grid;
    a.px = a.x; a.py = a.y;
    const x = a.x, y = a.y;
    // a dyke staked across the cell a jelly was making for: it lands on it
    if (home === SEA && G[at(x, y)] === TRAIL) { die('jelly', x, y, a); return; }
    const open = (u, v) => inside(u, v) && (G[at(u, v)] === home || (home === SEA && G[at(u, v)] === TRAIL));
    let dx = a.dx, dy = a.dy;
    if (!open(x + dx, y)) dx = -dx;
    if (!open(x, y + dy)) dy = -dy;
    if (dx === a.dx && dy === a.dy && !open(x + dx, y + dy)) { dx = -dx; dy = -dy; }
    const bounced = dx !== a.dx || dy !== a.dy;
    a.dx = dx; a.dy = dy;
    let tx = x, ty = y, touch = [];
    if (open(x + dx, y) && open(x, y + dy) && open(x + dx, y + dy)) { tx = x + dx; ty = y + dy; touch = [at(tx, y), at(x, ty), at(tx, ty)]; }
    else if (open(x + dx, y)) { tx = x + dx; touch = [at(tx, y)]; } // a one-wide channel: straight along it
    else if (open(x, y + dy)) { ty = y + dy; touch = [at(x, ty)]; }
    if (home === SEA) {
      // a jelly that swims into a dyke still being staked breaks it
      const hit = touch.find(i => G[i] === TRAIL);
      if (hit !== undefined) { die('jelly', hit % W, Math.floor(hit / W), a); return; }
    }
    a.x = tx; a.y = ty;
    if (bounced) ev({ type: 'bounce', x, y, who: home === SEA ? a.kind : 'crab' });
  }

  // ---------- the undertow runs up the fresh dyke behind the skimmer ----------
  function undertow(slow) {
    const w = sim.tow;
    if (!w || !sim.trail.length) return;
    w.pos += w.speed * slow * DT;
    if (!w.on && w.pos >= 0) { w.on = true; ev({ type: 'undertow' }); }
    const p = sim.p, head = sim.trail.length - 1 + Math.min(1, p.k);
    if (w.pos >= head - 0.3) { const i = sim.trail[sim.trail.length - 1]; die('undertow', i % W, Math.floor(i / W)); }
  }

  function hits() {
    const p = sim.p, q = posOf(p);
    const near = a => { const r = posOf(a); return Math.max(Math.abs(r.x - q.x), Math.abs(r.y - q.y)) < HIT; };
    for (const j of sim.jellies) if (near(j)) { die('jelly', p.x, p.y, j); return; }
    if (p.safe <= 0) for (const c of sim.crabs) if (near(c)) { die('crab', p.x, p.y, c); return; }
  }

  function die(cause, x, y, who = null) {
    if (sim.status !== 'play') return;
    const p = sim.p, q = posOf(p);
    ev({ type: 'death', cause, x, y, px: q.x, py: q.y, trail: sim.trail.slice(), who: who?.kind ?? (cause === 'crab' ? 'crab' : null) });
    for (const i of sim.trail) sim.grid[i] = SEA;
    sim.trail = []; sim.tow = null;
    sim.lives--;
    sim.status = 'dead'; sim.statusT = 0;
    p.moving = false; p.buf = null;
  }
  function respawn() {
    const p = sim.p, G = sim.grid;
    if (sim.lives <= 0) { sim.status = 'over'; sim.statusT = 0; ev({ type: 'over' }); return; }
    // back where the broken dyke began, or where the crab caught it
    let i = at(p.x, p.y);
    if (G[i] !== LAND) i = sim.from >= 0 && G[sim.from] === LAND ? sim.from : at(START.x, START.y);
    p.x = p.px = i % W; p.y = p.py = Math.floor(i / W); p.k = 1; p.moving = false; p.safe = SAFE_T;
    sim.from = -1;
    sim.status = 'ready'; sim.statusT = 0;
    ev({ type: 'respawn', x: p.x, y: p.y });
  }

  // ---------- closing a dyke: the water with no jelly in it drains ----------
  function close() {
    const G = sim.grid, M = sim.made, trail = sim.trail;
    for (const i of trail) { G[i] = LAND; M[i] = MADE.built; }
    // every jelly's water
    const gen = ++markGen;
    let qh = 0, qt = 0;
    const seed = i => { if (G[i] === SEA && MARK[i] !== gen) { MARK[i] = gen; QUEUE[qt++] = i; } };
    for (const j of sim.jellies) {
      seed(at(j.x, j.y)); seed(at(j.px, j.py));
      if (G[at(j.x, j.y)] !== SEA) for (const [u, v] of Object.values(DIRS)) if (inside(j.x + u, j.y + v)) seed(at(j.x + u, j.y + v));
    }
    while (qh < qt) {
      const i = QUEUE[qh++], x = i % W, y = (i / W) | 0;
      if (x > 0) seed(i - 1);
      if (x < W - 1) seed(i + 1);
      if (y > 0) seed(i - W);
      if (y < H - 1) seed(i + W);
    }
    // the rest of the water drains: in order of distance from the new dyke, for the sweep
    const cells = trail.slice(), dist = trail.map(() => 0);
    const g2 = ++markGen;
    qh = 0; qt = 0;
    for (const i of trail) { MARK[i] = g2; QUEUE[qt++] = i; }
    const D = new Map();
    while (qh < qt) {
      const i = QUEUE[qh++], x = i % W, y = (i / W) | 0, d = D.get(i) ?? 0;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (n < 0 || MARK[n] === gen || MARK[n] === g2 || G[n] !== SEA) continue;
        MARK[n] = g2; QUEUE[qt++] = n; D.set(n, d + 1);
        cells.push(n); dist.push(d + 1);
      }
    }
    // water no jelly is in but out of reach of the dyke's sweep (cut off earlier): drains too
    for (let i = 0; i < N; i++) if (G[i] === SEA && MARK[i] !== gen && MARK[i] !== g2) { cells.push(i); dist.push(1); }
    for (let k = trail.length; k < cells.length; k++) { G[cells[k]] = LAND; M[cells[k]] = MADE.meadow; }
    const n = cells.length;
    const mult = Math.min(2.5, 1 + Math.floor(n / 150) * 0.25); // big cuts pay more a cell
    const pts = Math.round(n * 10 * mult * (1 + 0.25 * Math.min(4, sim.loop)));
    sim.claimed = countInner();
    sim.landRev++;
    sim.stats.cuts++;
    sim.stats.biggest = Math.max(sim.stats.biggest, n);
    ev({ type: 'claim', cells, dist, trail: trail.length, n, pts, mult, pct: sim.pct, x: sim.p.x, y: sim.p.y });
    addScore(pts);
    // what was out on the drained flats
    const got = sim.items.filter(o => G[o.i] === LAND);
    sim.items = sim.items.filter(o => G[o.i] !== LAND);
    for (const o of got) {
      if (o.kind === 'pearl') {
        const v = 500 * (sim.stage + 1);
        sim.stats.pearls++;
        ev({ type: 'pearl', x: o.i % W, y: Math.floor(o.i / W), pts: v });
        addScore(v);
      } else {
        sim.slack = SLACK_T;
        ev({ type: 'slack', x: o.i % W, y: Math.floor(o.i / W) });
      }
    }
    // a jelly left on dry land (it was on the dyke's last cell) is set back in its water
    for (const j of sim.jellies) if (G[at(j.x, j.y)] !== SEA) rehome(j);
    sim.trail = []; sim.tow = null; sim.from = -1;
    if (sim.pct >= sim.sc.target) stageClear();
  }
  function rehome(j) {
    const G = sim.grid, gen = ++markGen;
    let qh = 0, qt = 0;
    QUEUE[qt++] = at(j.x, j.y); MARK[QUEUE[0]] = gen;
    while (qh < qt) {
      const i = QUEUE[qh++];
      if (G[i] === SEA) { j.x = j.px = i % W; j.y = j.py = Math.floor(i / W); j.k = 0; return; }
      const x = i % W, y = (i / W) | 0;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (n >= 0 && MARK[n] !== gen) { MARK[n] = gen; QUEUE[qt++] = n; }
    }
  }
  // the water some jelly is in (for a new one the tide brings)
  function seaWithJelly() {
    const G = sim.grid, gen = ++markGen;
    let qh = 0, qt = 0;
    for (const j of sim.jellies) { const i = at(j.x, j.y); if (G[i] === SEA && MARK[i] !== gen) { MARK[i] = gen; QUEUE[qt++] = i; } }
    while (qh < qt) {
      const i = QUEUE[qh++], x = i % W, y = (i / W) | 0;
      for (const n of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (n >= 0 && MARK[n] !== gen && G[n] === SEA) { MARK[n] = gen; QUEUE[qt++] = n; }
    }
    return qt ? i => MARK[i] === gen : null;
  }

  function addScore(v) {
    sim.score += v;
    while (sim.score >= sim.nextLife) { sim.nextLife += LIFE_EVERY; sim.lives++; ev({ type: 'life' }); }
  }
  function stageClear() {
    const sc = sim.sc, over = Math.max(0, Math.floor((sim.pct - sc.target) * 100));
    const info = { pct: sim.pct, tide: Math.ceil(sim.tide) * 25, over: over * 500, stage: 1000 * (sim.stage + 1) };
    info.total = info.tide + info.over + info.stage;
    sim.clearInfo = info;
    sim.stats.stages++;
    sim.status = 'clear'; sim.statusT = 0;
    ev({ type: 'clear', ...info });
    addScore(info.total);
  }

  function clone() {
    const c = createSim({ seed: sim.seed });
    for (const k of DATA) c[k] = typeof sim[k] === 'object' && sim[k] !== null ? structuredClone(sim[k]) : sim[k];
    return c;
  }
  return sim;
}

// a checkpoint as it came out of storage: is it one this sim can resume?
export function validState(st) {
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  return !!st && int(st.stage, 0, STAGES.length - 1) && int(st.loop, 0, 99) && int(st.score, 0, 1e9) && int(st.lives, 1, 99)
    && int(st.nextLife, 1, 2e9) && int(st.seed, 0, 2 ** 32 - 1);
}
