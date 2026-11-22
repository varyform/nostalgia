// Netcord's tour: a career on the Meridian Tour, season after season. Pure and deterministic,
// no DOM; nothing here mutates a tour: every call hands back a new one. All chance (the draws,
// the other matches, the drift of the other players' form) comes from seeds derived from the
// tour's seed, season, event and round, so a tour replays exactly.
//
//   let T = newTour({ seed: 7, me: createPlayer({ name: 'ASHE', style: 'baseline' }) });   // or { pick: 'danvik' }
//   T = enter(T);                         // the next event's draw is made: T.event
//   const nm = nextMatch(T);              // { round, opp, name, short, best } or null
//   T = report(T, { won, sets });         // your result (sets as [you, opp] games): the round's other matches
//                                         // are played; if you lost, the whole event is
//   if (T.event.done) ({ T, summary } = closeEvent(T));   // points, prize money, titles, milestones
//   if (seasonOver(T)) ({ T, summary } = endSeason(T));
//
// A season is the eight events of VENUES in order: four Crowns (32-player draws, best of five)
// and four Opens (16, best of three), one on each surface of each kind. A player's ranking is the
// points of his last result at each of the eight events (a rolling year). The goal: world No. 1
// and all Four Crowns; a career lasts SEASONS seasons at most. The state is small and plain
// JSON: the players' base data stays in players.js, only what changed is kept here.
import { CROWN_IDS, HAIR, KITS, NATIONS, PLAYERS, RATINGS, SKIN, STYLES, VENUES, playerById, venueById } from './players.js';

export const VERSION = 1;
export const SEASONS = 10;
export const YOU = 'you';
export const NAME_MAX = 8;
export const CALENDAR = VENUES.map(v => v.id);
export const CALENDAR_LEN = CALENDAR.length;

// ---------- chance ----------
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R_OF = (T, ...k) => rng(hashStr(`${T.seed}:${T.season}:${k.join(':')}`));
const clone = o => JSON.parse(JSON.stringify(o));
const clampR = v => Math.max(1, Math.min(9, Math.round(v)));
function shuffle(a, R) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- a player of your own ----------
// every style starts at 28 points over the seven ratings: a wildcard's level
export const START_RATINGS = {
  baseline: { speed: 4, power: 4, accuracy: 4, spin: 5, serve: 3, volley: 3, stamina: 5 },
  'serve-volley': { speed: 4, power: 5, accuracy: 3, spin: 3, serve: 5, volley: 5, stamina: 3 },
  'all-round': { speed: 4, power: 4, accuracy: 4, spin: 4, serve: 4, volley: 4, stamina: 4 },
  counter: { speed: 5, power: 3, accuracy: 5, spin: 4, serve: 3, volley: 3, stamina: 5 },
};
export const HEIGHTS = [1.72, 1.76, 1.8, 1.84, 1.88, 1.92, 1.96];
const titleCase = s => s.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
export function createPlayer({ name = 'NEWCOMER', hand = 'right', style = 'all-round', height = 1.84, country = 'ALM', kit = 0, skin = 1, hair = 0 } = {}) {
  const clean = String(name).toUpperCase().replace(/[^A-Z .-]/g, '').trim().slice(0, NAME_MAX) || 'NEWCOMER';
  const st = STYLES.includes(style) ? style : 'all-round';
  return {
    id: YOU,
    name: titleCase(clean),
    first: '',
    short: clean,
    country: NATIONS[country] ? country : 'ALM',
    hand: hand === 'left' ? 'left' : 'right',
    height: Math.max(1.7, Math.min(1.96, +height || 1.84)),
    ratings: { ...START_RATINGS[st] },
    style: st,
    kit: { ...(KITS[kit] ?? KITS[0]) },
    skin: SKIN[skin] ?? SKIN[1],
    hair: HAIR[hair] ?? HAIR[0],
    rank: 0,
    created: true,
  };
}

// ---------- the players as they stand ----------
export const pool = T => [...PLAYERS.map(p => p.id), ...(T.me ? [YOU] : [])];
function baseOf(T, id) {
  return id === YOU ? T.me : playerById(id);
}
/** a player now, as createMatch wants him: { id, name, short, country, hand, height, ratings, style, kit, skin, hair } */
export function playerOf(T, id) {
  const b = baseOf(T, id);
  if (!b) return null;
  return {
    id: b.id, name: b.name, short: b.short, country: b.country, hand: b.hand, height: b.height,
    ratings: { ...(T?.rat?.[id] ?? b.ratings) }, style: b.style, kit: { ...b.kit }, skin: b.skin, hair: b.hair,
  };
}
/** a copy of a player a little weaker or stronger (the difficulty setting), ratings kept in 1..9 */
export function levelled(p, delta) {
  if (!p || !delta) return p;
  return { ...p, ratings: Object.fromEntries(RATINGS.map(a => [a, clampR(p.ratings[a] + delta)])) };
}
export const points = (T, id) => (T.pts[id] ?? []).reduce((s, v) => s + (v || 0), 0);
const level = (T, id) => RATINGS.reduce((s, a) => s + (playerOf(T, id)?.ratings[a] ?? 1), 0);
/** the ranking: [{ id, pts, rank, prev }], best first */
export function rankings(T) {
  const rows = pool(T).map(id => ({ id, pts: points(T, id), lv: level(T, id) }));
  rows.sort((a, b) => b.pts - a.pts || b.lv - a.lv || (a.id < b.id ? -1 : 1));
  return rows.map((r, k) => ({ id: r.id, pts: r.pts, rank: k + 1, prev: T.prev?.[r.id] ?? k + 1 }));
}
export const rankOf = (T, id = T.you) => rankings(T).find(r => r.id === id)?.rank ?? 0;
const snapshot = T => Object.fromEntries(rankings(T).map(r => [r.id, r.rank]));

// ---------- a match nobody watches ----------
const SURF = {
  hard: { base: 0.63, net: 0.25 },
  clay: { base: 0.58, net: 0.12 },
  grass: { base: 0.67, net: 0.4 },
  indoor: { base: 0.65, net: 0.32 },
};
const STYLE_BONUS = {
  baseline: { clay: 0.35, hard: 0.1 },
  'serve-volley': { grass: 0.45, indoor: 0.3 },
  'all-round': { hard: 0.2, indoor: 0.1 },
  counter: { clay: 0.3, hard: 0.1 },
};
function strengths(p, surface) {
  const r = p.ratings, S = SURF[surface] ?? SURF.hard;
  const serve = r.serve * 0.55 + r.power * 0.25 + r.accuracy * 0.2;
  const ground = r.accuracy * 0.25 + r.spin * (surface === 'clay' ? 0.28 : 0.18) + r.power * 0.2 + r.speed * 0.22 + r.stamina * 0.15;
  const net = r.volley * 0.6 + r.speed * 0.2 + r.power * 0.2;
  const rally = (ground * (1 - S.net) + net * S.net) / (surface === 'clay' ? 1.03 : 1) + (STYLE_BONUS[p.style]?.[surface] ?? 0);
  return { serve, rally, stamina: r.stamina };
}
/** a match from the ratings, point by point: { w: 0 | 1, sc: [[games a, games b], …] } */
export function simMatch(a, b, surface, best, R) {
  const A = strengths(a, surface), B = strengths(b, surface), base = (SURF[surface] ?? SURF.hard).base;
  const need = Math.ceil(best / 2), sets = [], won = [0, 0];
  let server = R() < 0.5 ? 0 : 1;
  const pServe = (s, setNo) => {
    const [X, Y] = s === 0 ? [A, B] : [B, A];
    const tired = setNo >= 2 ? 0.008 * (X.stamina - Y.stamina) * (setNo - 1) : 0;
    return Math.max(0.4, Math.min(0.86, base + 0.024 * (X.serve - 5.5) + 0.032 * (X.rally - Y.rally) + tired));
  };
  while (won[0] < need && won[1] < need) {
    const g = [0, 0], setNo = sets.length;
    for (;;) {
      if (g[0] === 6 && g[1] === 6) {
        // the tiebreak: first to seven by two, the serve changing every two points
        const t = [0, 0];
        let k = 0;
        while (!((t[0] >= 7 || t[1] >= 7) && Math.abs(t[0] - t[1]) >= 2)) {
          const s = ((k + 1) >> 1) % 2 === 0 ? server : 1 - server;
          t[R() < pServe(s, setNo) ? s : 1 - s]++;
          k++;
        }
        g[t[0] > t[1] ? 0 : 1]++;
        server = 1 - server;
        break;
      }
      const p = pServe(server, setNo), pt = [0, 0];
      while (!((pt[0] >= 4 || pt[1] >= 4) && Math.abs(pt[0] - pt[1]) >= 2)) pt[R() < p ? server : 1 - server]++;
      g[pt[0] > pt[1] ? 0 : 1]++;
      server = 1 - server;
      if ((g[0] >= 6 || g[1] >= 6) && Math.abs(g[0] - g[1]) >= 2) break;
      if (g[0] === 7 || g[1] === 7) break;
    }
    sets.push(g);
    won[g[0] > g[1] ? 0 : 1]++;
  }
  return { w: won[0] > won[1] ? 0 : 1, sc: sets };
}
export const scoreText = (sc, flip = false, ret = false) =>
  (sc ?? []).map(([x, y]) => (flip ? `${y}–${x}` : `${x}–${y}`)).join('  ') + (ret ? '  RET' : '');

// ---------- the draw ----------
/** the classic bracket order: the seed in each slot, so 1 and 2 can meet only in the final */
export function bracketOrder(n) {
  let a = [1];
  while (a.length < n) {
    const m = a.length * 2 + 1;
    a = a.flatMap(s => [s, m - s]);
  }
  return a;
}
export const roundsOf = n => Math.round(Math.log2(n));
/** a round's name: 'Final', 'Semi-final', 'Quarter-final', 'Round of 16', 'Round of 32' */
export function roundName(n, r) {
  const left = n >> r;
  return left === 2 ? 'Final' : left === 4 ? 'Semi-final' : left === 8 ? 'Quarter-final' : `Round of ${left}`;
}
export function roundShort(n, r) {
  const left = n >> r;
  return left === 2 ? 'F' : left === 4 ? 'SF' : left === 8 ? 'QF' : `R${r + 1}`;
}
/** who plays an event: the best-ranked, and you by a wildcard if you aren't among them */
export function entrants(T, v) {
  const ranked = rankings(T).map(r => r.id).filter(id => T.you || id !== YOU);
  const ids = ranked.slice(0, v.draw);
  let wc = null;
  if (T.you && !ids.includes(T.you)) { ids[ids.length - 1] = T.you; wc = T.you; }
  return { ids, wc };
}
function makeDraw(ids, R) {
  const n = ids.length, order = bracketOrder(n), seeds = n / 4;
  const slotOf = s => order.indexOf(s);
  const draw = Array.from({ length: n }, () => null);
  draw[slotOf(1)] = ids[0];
  draw[slotOf(2)] = ids[1];
  // seeds 3–4 drawn between their two places, 5–8 between their four
  for (let lo = 3; lo <= seeds; lo *= 2) {
    const hi = Math.min(seeds, lo * 2 - 1), group = [];
    for (let s = lo; s <= hi; s++) group.push(s);
    const places = shuffle(group.map(slotOf), R);
    group.forEach((s, k) => { draw[places[k]] = ids[s - 1]; });
  }
  const rest = shuffle(ids.slice(seeds), R);
  for (let k = 0; k < n; k++) if (draw[k] == null) draw[k] = rest.pop();
  const seedOf = Object.fromEntries(ids.slice(0, seeds).map((id, k) => [id, k + 1]));
  return { draw, seedOf };
}
const pairUp = list => Array.from({ length: list.length / 2 }, (_, k) => ({ a: list[2 * k], b: list[2 * k + 1], w: null, sc: null, ret: false }));

export const current = T => (T.ev < CALENDAR_LEN ? venueById(CALENDAR[T.ev]) : null);
export const eventVenue = T => (T.event ? venueById(T.event.id) : null);

/** the next event's draw is made */
export function enter(T0) {
  const T = clone(T0), v = current(T);
  if (!v || T.event) return T;
  const { ids, wc } = entrants(T, v);
  const { draw, seedOf } = makeDraw(ids, R_OF(T, 'draw', T.ev));
  T.prev = snapshot(T);
  T.event = { id: v.id, ev: T.ev, n: draw.length, draw, seedOf, wc, r: 0, rounds: [pairUp(draw)], out: false, done: false };
  return T;
}
const yourMatch = T => (T.event && T.you ? T.event.rounds[T.event.r]?.find(m => m.a === T.you || m.b === T.you) ?? null : null);
/** your next match: { round, name, short, opp, best, venue } or null */
export function nextMatch(T) {
  const E = T.event;
  if (!E || E.out || E.done) return null;
  const m = yourMatch(T);
  if (!m || m.w) return null;
  const v = venueById(E.id);
  return { round: E.r, name: roundName(E.n, E.r), short: roundShort(E.n, E.r), opp: m.a === T.you ? m.b : m.a, best: v.sets, venue: v };
}
function playRound(T, E, v, skip) {
  const R = R_OF(T, 'ev', E.ev, 'r', E.r);
  for (const m of E.rounds[E.r]) {
    if (m.w || m === skip) continue;
    const res = simMatch(playerOf(T, m.a), playerOf(T, m.b), v.surface, v.sets, R);
    m.w = res.w ? m.b : m.a;
    m.sc = res.sc;
  }
}
function nextRound(E) {
  const winners = E.rounds[E.r].map(m => m.w);
  if (winners.length < 2) { E.done = true; return; }
  E.rounds.push(pairUp(winners));
  E.r++;
}
/** your result: { won, sets: [[your games, theirs], …], retired? } → the round (and, if you're out, the event) played out */
export function report(T0, res) {
  const T = clone(T0), E = T.event;
  if (!E || E.done) return T;
  const v = venueById(E.id), m = yourMatch(T);
  if (m && !m.w) {
    const mine = m.a === T.you, opp = mine ? m.b : m.a;
    m.w = res.won ? T.you : opp;
    m.sc = (res.sets ?? []).map(([y, o]) => (mine ? [y, o] : [o, y]));
    m.ret = !!res.retired;
    T.wl[res.won ? 0 : 1]++;
    T.swl[res.won ? 0 : 1]++;
    if (!res.won) E.out = true;
  }
  playRound(T, E, v, m);
  nextRound(E);
  while (E.out && !E.done) { playRound(T, E, v, null); nextRound(E); }
  return T;
}
/** a result for your match without playing it (SIMULATE): as report() takes it */
export function quick(T) {
  const nm = nextMatch(T);
  if (!nm) return null;
  const res = simMatch(playerOf(T, T.you), playerOf(T, nm.opp), nm.venue.surface, nm.venue.sets, R_OF(T, 'quick', T.ev, T.event.r));
  return { won: res.w === 0, sets: res.sc };
}
/** how far each entrant got: matches won (the number of rounds = the title) */
function reachedOf(E) {
  const out = Object.fromEntries(E.draw.map(id => [id, 0]));
  for (const round of E.rounds) for (const m of round) if (m.w) out[m.w]++;
  return out;
}
export const championOf = E => (E?.done ? E.rounds[E.rounds.length - 1][0]?.w ?? null : null);
/** the event is over: points and prize money, titles and milestones */
export function closeEvent(T0) {
  const T = clone(T0), E = T.event;
  if (!E?.done) return { T, summary: null };
  const v = venueById(E.id), reached = reachedOf(E), champ = championOf(E), rounds = roundsOf(E.n), ev = E.ev;
  const rank0 = T.you ? rankOf(T) : 0;
  for (const id of pool(T)) {
    if (!T.pts[id]) T.pts[id] = Array.from({ length: CALENDAR_LEN }, () => 0);
    T.pts[id][ev] = id in reached ? v.points[Math.min(rounds, reached[id])] : 0;
  }
  T.champions[E.id] = champ;
  let summary = { ev: E.id, champion: champ, entered: false };
  if (T.you && T.you in reached) {
    const r = reached[T.you], won = champ === T.you, prize = v.prize[Math.min(rounds, r)] ?? 0;
    T.money += prize;
    T.smoney += prize;
    const earned = 1 + r + (won ? (v.tier === 'crown' ? 4 : 2) : 0);
    T.train += earned;
    if (won) {
      T.titles.push({ season: T.season, ev: E.id });
      if (v.tier === 'crown') T.crowns[E.id] = (T.crowns[E.id] ?? 0) + 1;
    }
    const rank = rankOf(T);
    const newNo1 = rank === 1 && !T.no1;
    if (newNo1) T.no1 = { season: T.season, ev: E.id };
    if (rank === 1) T.weeksNo1++;
    T.best = T.best ? Math.min(T.best, rank) : rank;
    const crownsDone = won && v.tier === 'crown' && CROWN_IDS.every(id => T.crowns[id] > 0) && !T.over;
    if (crownsDone) T.over = 'crowns';
    T.log.push({ ev: E.id, reached: r, won, pts: v.points[Math.min(rounds, r)], prize });
    summary = {
      ev: E.id, champion: champ, entered: true, reached: r, rounds, won, pts: v.points[Math.min(rounds, r)], prize, train: earned,
      round: won ? 'Champion' : roundName(E.n, Math.min(r, rounds - 1)), rank, rank0, newNo1, crownsDone,
    };
  }
  T.event = null;
  T.ev++;
  return { T, summary };
}
export const seasonOver = T => T.ev >= CALENDAR_LEN && !T.event;

/** the season's end: the review, the next season begun, the other players' form drifting a little */
export function endSeason(T0) {
  const T = clone(T0), R = R_OF(T, 'drift');
  const top = rankings(T).slice(0, 8).map(r => ({ id: r.id, pts: r.pts }));
  const rank = T.you ? rankOf(T) : 0;
  const titles = T.titles.filter(t => t.season === T.season).map(t => t.ev);
  const summary = { season: T.season, rank, titles, money: T.smoney, wl: [...T.swl], log: T.log.slice(), top, last: T.season >= SEASONS };
  T.history.push({ season: T.season, rank, titles, money: T.smoney, wl: [...T.swl] });
  for (const p of PLAYERS) {
    if (p.id === T.you || R() > 0.3) continue;
    const r = { ...(T.rat[p.id] ?? p.ratings) }, a = RATINGS[Math.floor(R() * RATINGS.length)];
    // drift back toward who they were, never far from it
    const d = R() < 0.5 ? -1 : 1, v = clampR(r[a] + d);
    if (Math.abs(v - p.ratings[a]) <= 1) r[a] = v;
    T.rat[p.id] = r;
  }
  T.season++;
  T.ev = 0;
  T.log = [];
  T.smoney = 0;
  T.swl = [0, 0];
  if (summary.last && !T.over) T.over = 'retired';
  return { T, summary };
}

// ---------- training ----------
export const ratingsOf = T => playerOf(T, T.you)?.ratings ?? {};
export function trainCost(T, a) {
  const r = ratingsOf(T)[a];
  return r == null || r >= 9 ? Infinity : Math.ceil(r / 2);
}
export function train(T0, a) {
  if (!RATINGS.includes(a)) return { T: T0, ok: false, why: 'No such rating' };
  const cost = trainCost(T0, a);
  if (cost === Infinity) return { T: T0, ok: false, why: 'Already at the top' };
  if (T0.train < cost) return { T: T0, ok: false, why: `Needs ${cost} training points` };
  const T = clone(T0);
  T.rat[T.you] = { ...ratingsOf(T0), [a]: ratingsOf(T0)[a] + 1 };
  T.train -= cost;
  T.trained++;
  return { T, ok: true, why: null };
}

// ---------- a new tour ----------
export function newTour({ seed = 1, me = null, pick = null } = {}) {
  let T = {
    v: VERSION, seed: seed >>> 0, season: 0, ev: 0, you: null, me: null, rat: {},
    pts: Object.fromEntries(PLAYERS.map(p => [p.id, Array.from({ length: CALENDAR_LEN }, () => 0)])), prev: {},
    event: null, log: [], champions: {}, history: [], titles: [], crowns: {}, money: 0, smoney: 0,
    train: 0, trained: 0, wl: [0, 0], swl: [0, 0], best: 0, no1: null, weeksNo1: 0, over: null,
  };
  // last season, played out without you, makes the ranking you join
  for (let k = 0; k < CALENDAR_LEN; k++) {
    T = enter(T);
    while (!T.event.done) { playRound(T, T.event, venueById(T.event.id), null); nextRound(T.event); }
    T = closeEvent(T).T;
  }
  T.season = 1;
  T.ev = 0;
  T.champions = {};
  if (me) {
    T.me = { ...me, id: YOU };
    T.you = YOU;
    T.pts[YOU] = Array.from({ length: CALENDAR_LEN }, () => 0);
  } else T.you = playerById(pick)?.id ?? PLAYERS[PLAYERS.length - 1].id;
  T.prev = snapshot(T);
  T.best = rankOf(T);
  return T;
}

// ---------- kept in the browser ----------
export const save = T => clone(T);
const isRatings = r => r && RATINGS.every(a => Number.isInteger(r[a]) && r[a] >= 1 && r[a] <= 9);
/** a saved tour back, or null when it doesn't hold together */
export function load(state) {
  try {
    const T = clone(state);
    if (!T || T.v !== VERSION || !Number.isInteger(T.season) || T.season < 1) return null;
    if (!Number.isInteger(T.ev) || T.ev < 0 || T.ev > CALENDAR_LEN) return null;
    if (T.me && (T.me.id !== YOU || !isRatings(T.me.ratings) || !STYLES.includes(T.me.style))) return null;
    if (!(T.you === YOU ? T.me : playerById(T.you))) return null;
    for (const id of pool(T)) {
      const a = T.pts?.[id];
      if (!Array.isArray(a) || a.length !== CALENDAR_LEN || !a.every(Number.isFinite)) return null;
    }
    for (const [id, r] of Object.entries(T.rat ?? {})) if (!baseOf(T, id) || !isRatings(r)) return null;
    if (!Number.isFinite(T.money) || !Number.isFinite(T.train)) return null;
    if (T.event) {
      const E = T.event, ids = new Set(pool(T));
      if (!venueById(E.id) || E.id !== CALENDAR[E.ev] || !Array.isArray(E.draw) || !E.draw.every(id => ids.has(id))) return null;
      if (!Array.isArray(E.rounds) || E.rounds.length !== E.r + 1) return null;
    }
    return T;
  } catch {
    return null;
  }
}
/** the CONTINUE line: 'Season 1 · Kestrel Open · R2' */
export function label(T) {
  if (T.event) {
    const v = venueById(T.event.id);
    return `Season ${T.season} · ${v.name} · ${T.event.done ? 'Done' : roundShort(T.event.n, T.event.r)}`;
  }
  const v = current(T);
  return v ? `Season ${T.season} · ${v.name}` : `Season ${T.season} · Review`;
}
export function money(n) {
  const v = Math.max(0, Math.round(n || 0));
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${v}`;
}
export const majorsWon = T => CROWN_IDS.filter(id => T.crowns[id] > 0).length;
export const isCrown = id => CROWN_IDS.includes(id);
export { CROWN_IDS };
