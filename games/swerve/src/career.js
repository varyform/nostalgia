// Swerve's career: one club in the Halvane League, season after season. Pure and deterministic,
// no DOM; nothing here mutates a career: every call hands back a new one. All chance (the
// fixtures, the cup draw, the other matches' scores, who buys a player you sell) comes from
// seeds derived from the career's seed, season and week, so a career replays exactly.
//
//   let C = newCareer({ seed: 7, club: 'kettleford' });
//   const fx = fixture(C);                        // this week's match for the club, or null
//   const [home, away] = teamsFor(C, fx);         // the two `team` objects for createMatch
//   ({ C, report } = playWeek(C, match.result())); // the week's other matches, money, news
//   if (seasonOver(C)) ({ C, summary } = endSeason(C));
//   ({ C } = buy(C, 'ostervale-4'));               // the market: buy / sell, by player id
//
// A season is 18 weeks: 14 league matchdays (two divisions of eight, a double round robin) with
// the Lantern Cup's four rounds (all sixteen clubs, one match a tie, extra time and penalties)
// in between. Two go up and two go down. Money comes from the gate at home, prize money at the
// season's end and sales; wages go out every week. Squads are the generated ones (clubs.js)
// with the moves made since: the state stays small and survives JSON.
import { CLUBS, DIVISIONS, CUP, GK_COLOURS, PLAYERS, SQUAD_MAX, SQUAD_MIN, clubOf, deltaE, hashStr, playerOf, rating, overall, rng, shirtLook } from './clubs.js';
import { FORMATIONS, FORMATION_KEYS } from './tactics.js';

export const VERSION = 1;
export const ROUNDS = ['Round of 16', 'Quarter-final', 'Semi-final', 'Final'];
export const ROUND_SHORT = ['R16', 'QF', 'SF', 'F'];
// the season's weeks: league matchdays with the cup's rounds between them
export const CALENDAR = (() => {
  const cupAt = new Set([2, 6, 11, 15]), out = [];
  let md = 0, round = 0;
  for (let w = 0; w < 18; w++) out.push(cupAt.has(w) ? { kind: 'cup', round: round++ } : { kind: 'league', md: md++ });
  return out;
})();
export const PRIZE = {
  1: [1600000, 1200000, 900000, 700000, 550000, 450000, 350000, 300000],
  2: [700000, 550000, 400000, 300000, 250000, 200000, 160000, 120000],
};
// what the club earns from the cup, by the stage it went out at (4 = won it)
export const CUP_PRIZE = [30000, 70000, 140000, 250000, 500000];
export const WAGES = 0.004; // of the squad's value, every week
export const BUY_MARKUP = 1.15, SELL_SHARE = 0.85;
export const CLASH = 30; // ΔE under which two shirts are too alike
const TOP_UP = 2, DOWN = 2; // promoted, relegated

const clone = o => JSON.parse(JSON.stringify(o));
const R_OF = (C, ...k) => rng(hashStr(`${C.seed}:${C.season}:${k.join(':')}`));
const isFormation = k => !!FORMATIONS?.[k]?.slots?.length;
const defaultFormation = () => (isFormation('4-4-2') ? '4-4-2' : FORMATION_KEYS?.[0] ?? Object.keys(FORMATIONS ?? {})[0]);
export const formations = () => (FORMATION_KEYS?.length ? FORMATION_KEYS : Object.keys(FORMATIONS ?? {})).filter(isFormation);
export const rolesOf = k => (FORMATIONS[k] ?? FORMATIONS[defaultFormation()]).slots.map(s => s.role);

// ---------- squads ----------
export const clubAt = (C, pid) => (C?.moves?.[pid] ?? playerOf(pid)?.club ?? null);
/** a club's players now, with their shirt numbers at that club */
export function squad(C, clubId) {
  const out = [];
  for (const p of PLAYERS) if (clubAt(C, p.id) === clubId) out.push(C?.nums?.[p.id] != null ? { ...p, num: C.nums[p.id] } : p);
  return out;
}
const countPos = (list, pos) => list.filter(p => p.pos === pos).length;

/** the best eleven of `players` for a formation, as player ids in its slot order */
export function bestXI(players, fkey, keep = null) {
  const roles = rolesOf(fkey), pool = keep ? players.filter(p => keep.includes(p.id)) : players;
  const pairs = [];
  // keepers in goal and only there
  roles.forEach((role, s) => pool.forEach(p => { if ((role === 'GK') === (p.pos === 'GK')) pairs.push([rating(p, role) + (p.pos === role ? 0.01 : 0), s, p.id]); }));
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1));
  const xi = Array.from({ length: roles.length }, () => null), used = new Set();
  for (const [, s, id] of pairs) if (xi[s] == null && !used.has(id)) { xi[s] = id; used.add(id); }
  // a slot left empty (a pool short of keepers or of eleven) takes the best of the rest
  for (let s = 0; s < xi.length; s++) if (xi[s] == null) xi[s] = bestFor(players, roles[s], used);
  return xi;
}
/** how strong an eleven is, about 1…9: the keeper counts for a sixth */
export function strengthOf(players, xi, fkey) {
  const roles = rolesOf(fkey), by = new Map(players.map(p => [p.id, p]));
  let gk = 0, out = 0, n = 0;
  xi.forEach((id, s) => {
    const p = by.get(id), r = p ? rating(p, roles[s]) : 1;
    if (roles[s] === 'GK') gk = r; else { out += r; n++; }
  });
  return gk / 6 + (out / Math.max(1, n)) * (5 / 6);
}
// the shape a computer-run club plays: whichever suits its squad best (ties to the first)
function aiShape(players) {
  let best = null;
  for (const k of formations()) {
    const xi = bestXI(players, k), s = strengthOf(players, xi, k);
    if (!best || s > best.s + 1e-9) best = { k, xi, s };
  }
  return best;
}
/** the eleven a club fields: the manager's pick for your club, the best one for the rest */
export function lineupOf(C, clubId) {
  const players = squad(C, clubId);
  if (C && clubId === C.club) {
    const k = isFormation(C.formation) ? C.formation : defaultFormation();
    const have = new Set(players.map(p => p.id)), xi = (C.lineup ?? []).slice(0, 11);
    const ok = xi.length === 11 && new Set(xi).size === 11 && xi.every(id => have.has(id));
    const ids = ok ? xi : fillXI(players, k, xi.filter(id => have.has(id)));
    return { formation: k, xi: ids, players, s: strengthOf(players, ids, k) };
  }
  const b = aiShape(players);
  return { formation: b.k, xi: b.xi, players, s: b.s };
}
// keep who's still there in their slots, fill the holes with the best of the rest
function fillXI(players, k, partial) {
  const roles = rolesOf(k), xi = Array.from({ length: 11 }, () => null), used = new Set();
  partial.forEach((id, s) => { if (s < 11 && id && !used.has(id)) { xi[s] = id; used.add(id); } });
  for (let s = 0; s < 11; s++) if (xi[s] == null) xi[s] = bestFor(players, roles[s], used);
  return xi;
}
// the best player left for a role (a keeper for goal, an outfielder elsewhere, when there is one)
function bestFor(players, role, used) {
  const left = players.filter(q => !used.has(q.id)), fit = left.filter(q => (role === 'GK') === (q.pos === 'GK'));
  const p = (fit.length ? fit : left).sort((a, b) => rating(b, role) - rating(a, role) || (a.id < b.id ? -1 : 1))[0];
  if (!p) return null;
  used.add(p.id);
  return p.id;
}
export const strength = (C, clubId) => lineupOf(C, clubId).s;
/** your bench: the squad outside the eleven, keepers first, then by position and quality */
export function benchOf(C) {
  const { xi, players } = lineupOf(C, C.club), inXI = new Set(xi), order = { GK: 0, DF: 1, MF: 2, FW: 3 };
  return players.filter(p => !inXI.has(p.id)).sort((a, b) => order[a.pos] - order[b.pos] || overall(b) - overall(a));
}
export const squadValue = (C, clubId) => squad(C, clubId).reduce((s, p) => s + p.value, 0);
export const wagesOf = (C, clubId = C.club) => Math.round((squadValue(C, clubId) * WAGES) / 1000) * 1000;

// ---------- kits ----------
const kitClash = (a, b) => Math.min(deltaE(a.shirt, b.shirt), deltaE(shirtLook(a), shirtLook(b))) < CLASH;
const kitDist = (a, b) => Math.min(deltaE(a.shirt, b.shirt), deltaE(shirtLook(a), shirtLook(b)));
/** the kits for a match: the home side in its own; the visitors change when the shirts clash.
 *  Keepers wear whatever stands out from both sides' shirts and each other. */
export function kitsFor(home, away) {
  const hk = home.kit.home;
  let ak = away.kit.home, change = false;
  if (kitClash(hk, ak)) {
    const alt = away.kit.away;
    if (kitDist(hk, alt) > kitDist(hk, ak)) { ak = alt; change = true; }
  }
  const shirts = [hk.shirt, shirtLook(hk), ak.shirt, shirtLook(ak)];
  const keeper = (club, other) => {
    const ok = c => Math.min(...shirts.map(s => deltaE(c, s)), other ? deltaE(c, other) : 99) >= CLASH;
    if (ok(club.gk.shirt)) return club.gk;
    let best = club.gk.shirt, bd = -1;
    for (const c of GK_COLOURS) {
      const d = Math.min(...shirts.map(s => deltaE(c, s)), other ? deltaE(c, other) : 99);
      if (d > bd) { bd = d; best = c; }
    }
    return { ...club.gk, shirt: best, socks: best, shorts: deltaE(best, '#111111') > 40 ? '#111111' : '#f4f4f4' };
  };
  const hg = keeper(home, null), ag = keeper(away, hg.shirt);
  return { home: { ...hk }, away: { ...ak }, homeGk: { ...hg }, awayGk: { ...ag }, change };
}
export { kitClash };

// ---------- the two teams for createMatch ----------
function teamObject(C, clubId, kit, gk) {
  const c = clubOf(clubId), L = lineupOf(C, clubId), by = new Map(L.players.map(p => [p.id, p]));
  return {
    id: c.id, name: c.name, short: c.short, kit, gk, formation: L.formation,
    players: L.xi.map(id => {
      const p = by.get(id);
      return { id: p.id, name: p.name, num: p.num, pos: p.pos, pace: p.pace, shooting: p.shooting, passing: p.passing, tackling: p.tackling, keeping: p.keeping };
    }),
  };
}
/** [home, away] for a match between two clubs, clash-free; C null: the clubs as generated */
export function matchTeams(C, homeId, awayId) {
  const K = kitsFor(clubOf(homeId), clubOf(awayId));
  return [teamObject(C, homeId, K.home, K.homeGk), teamObject(C, awayId, K.away, K.awayGk)];
}
export const teamsFor = (C, fx) => matchTeams(C, fx.home, fx.away);

// ---------- fixtures ----------
function shuffle(a, R) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// a double round robin by the circle method: every club home and away to every other
function roundRobin(ids) {
  const n = ids.length, rounds = [], rot = ids.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const ring = [ids[0], ...rot], pairs = [];
    for (let k = 0; k < n / 2; k++) {
      const a = ring[k], b = ring[n - 1 - k];
      pairs.push((r + k) % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    rot.unshift(rot.pop());
  }
  return [...rounds, ...rounds.map(r => r.map(([a, b]) => [b, a]))];
}
export const clubsIn = (C, d) => CLUBS.filter(c => C.div[c.id] === d).map(c => c.id);
function startSeason(C) {
  const R = R_OF(C, 'draw');
  C.week = 0;
  C.fixtures = {};
  C.results = {};
  for (const d of [1, 2]) {
    C.fixtures[d] = roundRobin(shuffle(clubsIn(C, d), R));
    C.results[d] = [];
  }
  C.cup = { draw: shuffle(CLUBS.map(c => c.id), R), res: [[], [], [], []] };
  C.money = { gate: 0, wages: 0, prize: 0, bought: 0, sold: 0, start: C.budget };
  C.news = [];
  return C;
}
/** the ties of a cup round ([home, away] pairs), as far as the draw and the results tell */
export function cupTies(C, r) {
  if (r === 0) {
    const d = C.cup.draw, out = [];
    for (let k = 0; k < d.length; k += 2) out.push([d[k], d[k + 1]]);
    return out;
  }
  const prev = cupTies(C, r - 1), res = C.cup.res[r - 1], out = [];
  for (let k = 0; k < prev.length; k += 2) {
    const w = i => (res[i] ? prev[i][res[i].w] : null);
    out.push([w(k), w(k + 1)]);
  }
  return out;
}
/** the cup's winner, or null while it is on */
export function cupWinner(C) {
  const r = C.cup.res[3]?.[0];
  return r ? cupTies(C, 3)[0][r.w] : null;
}
/** how far a club got: 0 out in the round of 16 … 3 runner-up, 4 winner; -1 still in it */
export function cupStage(C, id) {
  for (let r = 0; r < 4; r++) {
    const ties = cupTies(C, r), k = ties.findIndex(t => t.includes(id));
    if (k < 0) return r - 1; // not in this round: went out in the last
    const res = C.cup.res[r][k];
    if (!res) return -1;
    if (ties[k][res.w] !== id) return r;
  }
  return 4;
}
export const divOf = (C, id = C.club) => C.div[id];
const fxLabel = e => (e.kind === 'cup' ? `${CUP} · ${ROUNDS[e.round]}` : null);

/** the club's match this week: { week, kind, md | round, home, away, knockout, label }, or null */
export function fixture(C, week = C.week) {
  const e = CALENDAR[week];
  if (!e) return null;
  if (e.kind === 'league') {
    const d = divOf(C), pair = C.fixtures[d][e.md].find(p => p.includes(C.club));
    return pair && { week, kind: 'league', md: e.md, div: d, home: pair[0], away: pair[1], knockout: false, label: `${DIVISIONS[d]} · Matchday ${e.md + 1}` };
  }
  const ties = cupTies(C, e.round), k = ties.findIndex(t => t.includes(C.club));
  if (k < 0 || ties[k].includes(null)) return null;
  return { week, kind: 'cup', round: e.round, tie: k, home: ties[k][0], away: ties[k][1], knockout: true, label: fxLabel(e) };
}
export const seasonOver = C => C.week >= CALENDAR.length;

// ---------- simulated matches ----------
function poisson(l, R) {
  const L = Math.exp(-l);
  let k = 0, p = 1;
  do { k++; p *= R(); } while (p > L && k < 12);
  return k - 1;
}
/** a match between two clubs, from their elevens' strength: { s: [h, a], p, w } */
export function simMatch(C, home, away, R, knockout = false) {
  const sh = strength(C, home), sa = strength(C, away), d = sh - sa;
  const lh = 1.38 * Math.exp(d * 0.42), la = 1.08 * Math.exp(-d * 0.42);
  const s = [poisson(lh, R), poisson(la, R)];
  let p = null, w = s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1;
  if (knockout && w < 0) {
    // extra time: a third of a match more
    s[0] += poisson(lh / 3, R); s[1] += poisson(la / 3, R);
    w = s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1;
    if (w < 0) {
      // penalties: five each, then sudden death
      const q = [0.74 + d * 0.01, 0.74 - d * 0.01];
      p = [0, 0];
      for (let k = 0; k < 5; k++) for (const t of [0, 1]) if (R() < q[t]) p[t]++;
      while (p[0] === p[1]) { const a = R() < q[0], b = R() < q[1]; p[0] += a; p[1] += b; }
      w = p[0] > p[1] ? 0 : 1;
    }
  }
  return { s, p, w };
}
// a played match's result into the career's shape: { s, p, w }; a cup tie always has a winner
function fromResult(res, knockout, R) {
  const s = [res?.score?.[0] | 0, res?.score?.[1] | 0];
  const p = Array.isArray(res?.pens) ? [res.pens[0] | 0, res.pens[1] | 0] : null;
  let w = res?.winner === 0 || res?.winner === 1 ? res.winner : s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : p && p[0] !== p[1] ? (p[0] > p[1] ? 0 : 1) : -1;
  if (knockout && w < 0) w = R() < 0.5 ? 0 : 1; // never left hanging
  return { s, p, w: knockout ? w : s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1 };
}
/** the result a forfeit leaves: 3–0 to the other side */
export function forfeit(fx, C) {
  const me = fx.home === C.club ? 0 : 1;
  const score = me === 0 ? [0, 3] : [3, 0];
  return { score, pens: null, winner: 1 - me, scorers: [], forfeit: true };
}

/** the week: your result in, every other match of it played, money in and out, the week on
 *  (past any cup week you're no longer in). → { C, report } */
export function playWeek(C0, result) {
  const C = clone(C0);
  const report = { week: C.week, season: C.season, mine: null, results: [], gate: 0, wages: 0, news: [] };
  const step = (withMine) => {
    const e = CALENDAR[C.week], fx = withMine ? fixture(C) : null, R = R_OF(C, 'week', C.week);
    if (e.kind === 'league') {
      for (const d of [1, 2]) {
        const pairs = C.fixtures[d][e.md];
        C.results[d][e.md] = pairs.map(([h, a], i) => {
          const r = fx && fx.home === h && fx.away === a ? fromResult(result, false, R) : simMatch(C, h, a, R_OF(C, 'm', C.week, d, i));
          report.results.push({ kind: 'league', div: d, home: h, away: a, ...r });
          return r;
        });
      }
    } else {
      const ties = cupTies(C, e.round);
      C.cup.res[e.round] = ties.map(([h, a], i) => {
        const r = fx && fx.home === h && fx.away === a ? fromResult(result, true, R) : simMatch(C, h, a, R_OF(C, 'c', C.week, i), true);
        report.results.push({ kind: 'cup', round: e.round, home: h, away: a, ...r });
        return r;
      });
      if (e.round === 3) report.news.push(`${clubOf(cupWinner(C)).name} win the ${CUP}`);
    }
    if (fx) {
      const r = report.results.find(x => x.home === fx.home && x.away === fx.away);
      report.mine = { ...fx, ...r };
      if (fx.home === C.club) {
        const c = clubOf(C.club), gate = Math.round(((fx.kind === 'cup' ? 90000 : C.div[C.club] === 1 ? 150000 : 65000) * (1 + (5 - c.tier) * 0.08)) / 1000) * 1000;
        C.budget += gate; C.money.gate += gate; report.gate += gate;
      }
    }
    const wages = wagesOf(C);
    C.budget -= wages; C.money.wages += wages; report.wages += wages;
    C.week++;
  };
  if (!seasonOver(C)) step(!!fixture(C));
  // the cup weeks you're out of pass by themselves
  while (!seasonOver(C) && !fixture(C)) step(false);
  C.news = report.news;
  return { C, report };
}

// ---------- tables ----------
/** a division's table, sorted: [{ id, p, w, d, l, gf, ga, gd, pts }] */
export function table(C, d) {
  const rows = new Map(clubsIn(C, d).map(id => [id, { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] }]));
  (C.results[d] ?? []).forEach((md, i) => md?.forEach((r, k) => {
    const [h, a] = C.fixtures[d][i][k], H = rows.get(h), A = rows.get(a);
    if (!H || !A) return;
    H.p++; A.p++;
    H.gf += r.s[0]; H.ga += r.s[1]; A.gf += r.s[1]; A.ga += r.s[0];
    if (r.s[0] > r.s[1]) { H.w++; A.l++; H.pts += 3; H.form.push('W'); A.form.push('L'); }
    else if (r.s[0] < r.s[1]) { A.w++; H.l++; A.pts += 3; H.form.push('L'); A.form.push('W'); }
    else { H.d++; A.d++; H.pts++; A.pts++; H.form.push('D'); A.form.push('D'); }
  }));
  const name = id => clubOf(id).name;
  return [...rows.values()]
    .map(r => ({ ...r, gd: r.gf - r.ga, form: r.form.slice(-5) }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || (name(a.id) < name(b.id) ? -1 : 1));
}
export const position = (C, id = C.club) => table(C, C.div[id]).findIndex(r => r.id === id) + 1;

/** your club's season, week by week: [{ week, kind, label, opp, home, res, out }] */
export function schedule(C) {
  return CALENDAR.map((e, week) => {
    if (e.kind === 'league') {
      const d = divOf(C), pairs = C.fixtures[d][e.md], k = pairs.findIndex(p => p.includes(C.club)), [h, a] = pairs[k];
      return { week, kind: 'league', md: e.md, label: `MD ${e.md + 1}`, home: h === C.club, opp: h === C.club ? a : h, res: C.results[d][e.md]?.[k] ?? null };
    }
    const ties = cupTies(C, e.round), k = ties.findIndex(t => t.includes(C.club));
    const stage = cupStage(C, C.club), out = stage >= 0 && stage < e.round;
    // out of it, or still waiting to hear who's next
    if (k < 0 || out) return { week, kind: 'cup', round: e.round, label: ROUND_SHORT[e.round], out, opp: null, home: false, res: null };
    const [h, a] = ties[k];
    return { week, kind: 'cup', round: e.round, label: ROUND_SHORT[e.round], home: h === C.club, opp: h === C.club ? a : h, res: C.cup.res[e.round][k] ?? null };
  });
}
/** a league matchday's ties and results in a division */
export const matchday = (C, d, md) => C.fixtures[d][md].map(([h, a], k) => ({ home: h, away: a, res: C.results[d][md]?.[k] ?? null }));

// ---------- the season's end ----------
/** promotion and relegation, prize money, honours; the next season drawn. → { C, summary } */
export function endSeason(C0) {
  const C = clone(C0);
  const t1 = table(C, 1), t2 = table(C, 2), myDiv = C.div[C.club];
  const pos = (myDiv === 1 ? t1 : t2).findIndex(r => r.id === C.club) + 1;
  const down = t1.slice(-DOWN).map(r => r.id), up = t2.slice(0, TOP_UP).map(r => r.id);
  const stage = cupStage(C, C.club), cupWon = cupWinner(C);
  const prize = PRIZE[myDiv][pos - 1] ?? 0, cupPrize = CUP_PRIZE[Math.max(0, stage)] ?? 0;
  C.budget += prize + cupPrize; C.money.prize += prize + cupPrize;
  const title = myDiv === 1 && pos === 1;
  const firstTitle = title && !C.champion;
  const honours = [];
  if (title) honours.push('League champions');
  else if (myDiv === 2 && pos === 1) honours.push('Second Division champions');
  if (myDiv === 2 && up.includes(C.club)) honours.push('Promoted');
  if (myDiv === 1 && down.includes(C.club)) honours.push('Relegated');
  if (cupWon === C.club) honours.push(`${CUP} winners`);
  const summary = {
    season: C.season, div: myDiv, pos, played: (myDiv === 1 ? t1 : t2)[pos - 1], tables: { 1: t1, 2: t2 },
    champion: t1[0].id, second: t2[0].id, promoted: up, relegated: down, cup: cupWon, cupStage: stage,
    prize, cupPrize, money: { ...C.money, end: C.budget }, title, firstTitle, honours,
    up: up.includes(C.club), down: down.includes(C.club),
  };
  C.history.push({ season: C.season, div: myDiv, pos, cup: stage, pts: summary.played.pts, honours });
  if (title) C.titles.push(C.season);
  if (cupWon === C.club) C.cups.push(C.season);
  if (firstTitle) C.champion = C.season;
  for (const id of down) C.div[id] = 2;
  for (const id of up) C.div[id] = 1;
  C.season++;
  startSeason(C);
  return { C, summary };
}

// ---------- the market ----------
const priceOf = p => Math.round((p.value * BUY_MARKUP) / 5000) * 5000;
const offerFor = p => Math.round((p.value * SELL_SHARE) / 5000) * 5000;
/** the players you could buy (all of them, or one position): [{ p, club, price, can, why }] */
export function market(C, pos = null) {
  const mine = squad(C, C.club), out = [], sizes = new Map(), gks = new Map();
  for (const c of CLUBS) if (c.id !== C.club) { const s = squad(C, c.id); sizes.set(c.id, s.length); gks.set(c.id, countPos(s, 'GK')); }
  for (const p0 of PLAYERS) {
    const club = clubAt(C, p0.id);
    if (club === C.club || !sizes.has(club) || (pos && p0.pos !== pos)) continue;
    const p = C.nums?.[p0.id] != null ? { ...p0, num: C.nums[p0.id] } : p0, price = priceOf(p);
    let why = null;
    if (mine.length >= SQUAD_MAX) why = `Squad full (${SQUAD_MAX})`;
    else if (sizes.get(club) <= SQUAD_MIN + 1) why = `${clubOf(club).short} won't sell`;
    else if (p.pos === 'GK' && gks.get(club) <= 2) why = `${clubOf(club).short} need their keepers`;
    else if (C.budget < price) why = 'Not enough money';
    out.push({ p, club, price, can: !why, why });
  }
  return out.sort((a, b) => overall(b.p) - overall(a.p) || b.price - a.price);
}
/** your players as the market sees them: [{ p, price, can, why }] */
export function sellList(C) {
  const mine = squad(C, C.club), gk = countPos(mine, 'GK');
  const xi = new Set(lineupOf(C, C.club).xi), order = { GK: 0, DF: 1, MF: 2, FW: 3 };
  return mine
    .map(p => {
      let why = null;
      if (mine.length <= SQUAD_MIN) why = `Squad at the minimum (${SQUAD_MIN})`;
      else if (p.pos === 'GK' && gk <= 2) why = 'You need two keepers';
      return { p, price: offerFor(p), can: !why, why, xi: xi.has(p.id) };
    })
    .sort((a, b) => order[a.p.pos] - order[b.p.pos] || overall(b.p) - overall(a.p));
}
function freeNumber(C, clubId, want) {
  const taken = new Set(squad(C, clubId).map(p => p.num));
  if (want && !taken.has(want)) return want;
  let n = 12;
  while (taken.has(n)) n++;
  return n;
}
/** buy a player by id → { ok, C, price } | { ok: false, why } */
export function buy(C0, pid) {
  const row = market(C0).find(r => r.p.id === pid);
  if (!row) return { ok: false, why: 'Not on the market' };
  if (!row.can) return { ok: false, why: row.why };
  const C = clone(C0);
  C.nums ??= {};
  C.nums[pid] = freeNumber(C, C.club, row.p.num);
  C.moves[pid] = C.club;
  C.budget -= row.price; C.money.bought += row.price;
  C.news = [`${row.p.name} joins from ${clubOf(row.club).name} for ${money(row.price)}`];
  return { ok: true, C, price: row.price, from: row.club };
}
/** sell one of yours: the club that bids is drawn from those with room, else he goes abroad */
export function sell(C0, pid) {
  const row = sellList(C0).find(r => r.p.id === pid);
  if (!row) return { ok: false, why: 'Not your player' };
  if (!row.can) return { ok: false, why: row.why };
  const C = clone(C0), R = R_OF(C, 'sell', C.week, pid);
  const room = CLUBS.filter(c => c.id !== C.club && squad(C, c.id).length < SQUAD_MAX).map(c => c.id);
  const to = room.length ? room[Math.floor(R() * room.length)] : 'abroad';
  C.moves[pid] = to;
  C.nums ??= {};
  if (to === 'abroad') delete C.nums[pid];
  else C.nums[pid] = freeNumber(C, to, row.p.num);
  C.budget += row.price; C.money.sold += row.price;
  // his place in the eleven goes to the best of the rest
  const players = squad(C, C.club);
  C.lineup = fillXI(players, C.formation, C.lineup.map(id => (id === pid ? null : id)));
  C.news = [`${row.p.name} sold to ${to === 'abroad' ? 'a club abroad' : clubOf(to).name} for ${money(row.price)}`];
  return { ok: true, C, price: row.price, to };
}

// ---------- the line-up ----------
/** a new shape: the same eleven, each to the slot that suits him best */
export function setFormation(C0, k) {
  if (!isFormation(k)) return C0;
  const C = clone(C0), players = squad(C, C.club), cur = lineupOf(C0, C.club).xi;
  C.formation = k;
  C.lineup = bestXI(players, k, cur);
  return C;
}
/** the best eleven of the squad for the shape */
export function autoPick(C0) {
  const C = clone(C0);
  C.lineup = bestXI(squad(C, C.club), C.formation);
  return C;
}
/** why two players (by id) can't trade places, or null: two of the eleven trade slots, one
 *  from the bench takes the other's; only a keeper goes in goal, and keepers stay there */
export function swapWhy(C, a, b) {
  const xi = lineupOf(C, C.club).xi, by = new Map(squad(C, C.club).map(p => [p.id, p]));
  if (a === b || !by.has(a) || !by.has(b)) return 'Pick two of your players';
  const i = xi.indexOf(a), j = xi.indexOf(b);
  if (i < 0 && j < 0) return 'Both are on the bench';
  const after = xi.slice();
  if (i >= 0) after[i] = b;
  if (j >= 0) after[j] = a;
  if (by.get(after[0]).pos !== 'GK') return 'Only a keeper can go in goal';
  if (after.some((id, s) => s > 0 && by.get(id).pos === 'GK')) return 'A keeper plays in goal';
  return null;
}
/** swap two players by id (unchanged when swapWhy has an objection) */
export function swap(C0, a, b) {
  if (swapWhy(C0, a, b)) return C0;
  const C = clone(C0), xi = lineupOf(C0, C.club).xi.slice(), i = xi.indexOf(a), j = xi.indexOf(b);
  if (i >= 0) xi[i] = b;
  if (j >= 0) xi[j] = a;
  C.lineup = xi;
  return C;
}

// ---------- a new career, saving and loading ----------
export const startBudget = id => 350000 + (5 - (clubOf(id)?.tier ?? 5)) * 60000;
export function newCareer({ seed = 1, club = 'kettleford' } = {}) {
  const c = clubOf(club) ?? CLUBS.find(x => x.div === 2);
  const C = {
    v: VERSION, seed: seed >>> 0, season: 1, week: 0, club: c.id,
    div: Object.fromEntries(CLUBS.map(x => [x.id, x.div])),
    moves: {}, nums: {}, formation: defaultFormation(), lineup: [],
    budget: startBudget(c.id), history: [], titles: [], cups: [], champion: 0,
  };
  C.lineup = bestXI(squad(C, C.club), C.formation);
  return startSeason(C);
}
export const save = C => clone(C);
/** a saved career, checked, or null when it can't be trusted */
export function load(state) {
  try {
    const C = clone(state);
    if (!C || C.v !== VERSION || !clubOf(C.club) || !Number.isFinite(C.budget) || !Number.isInteger(C.season) || C.season < 1) return null;
    if (!Number.isInteger(C.week) || C.week < 0 || C.week > CALENDAR.length) return null;
    if (CLUBS.some(c => C.div?.[c.id] !== 1 && C.div?.[c.id] !== 2) || clubsIn(C, 1).length !== 8) return null;
    for (const d of [1, 2]) if (!Array.isArray(C.fixtures?.[d]) || C.fixtures[d].length !== 14 || !Array.isArray(C.results?.[d])) return null;
    if (!Array.isArray(C.cup?.draw) || C.cup.draw.length !== 16 || !Array.isArray(C.cup.res)) return null;
    C.moves ??= {}; C.nums ??= {}; C.history ??= []; C.titles ??= []; C.cups ??= []; C.news ??= [];
    C.money ??= { gate: 0, wages: 0, prize: 0, bought: 0, sold: 0, start: C.budget };
    if (!isFormation(C.formation)) C.formation = defaultFormation();
    C.lineup = lineupOf(C, C.club).xi;
    return C;
  } catch {
    return null;
  }
}

// ---------- words ----------
export function money(n) {
  const v = Math.round(n ?? 0), a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3)}K`;
  return `${s}$${a}`;
}
/** "Season 2 · Week 5 · Kettleford", for the title's CONTINUE */
export const label = C => `Season ${C.season} · Week ${Math.min(CALENDAR.length, C.week + 1)} · ${clubOf(C.club)?.town ?? ''}`;
export const stageName = s => (s >= 4 ? 'Winners' : s === 3 ? 'Runners-up' : s >= 0 ? `Out in the ${ROUNDS[s].toLowerCase()}` : 'Still in it');
