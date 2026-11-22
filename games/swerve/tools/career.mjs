// Plays Swerve's career (src/career.js over src/clubs.js) out many times, with the club's own
// matches simulated like everyone else's (tilted by how well the manager plays) in place of
// the match sim, and a manager who buys, sells, swaps and changes shape now and then. Checks
// every rule the game leans on and prints PASS or FAIL with the numbers:
//
//   tables add up (games, points, goals); fixtures complete; one cup winner; two up, two down;
//   budgets never NaN; squads stay within limits with two keepers; team objects fit
//   createMatch (11 starters, slot 0 a keeper, a known formation, hex kits); kits don't clash;
//   a career survives JSON and replays exactly; nothing mutates a career.
//
//   node games/swerve/tools/career.mjs [careers, default 40] [seasons, default 6]
//
// Until src/tactics.js exists (the match sim's), a stand-in with the same exports is used.
import { existsSync } from 'node:fs';
import { register } from 'node:module';

const here = new URL('../src/', import.meta.url);
if (!existsSync(new URL('tactics.js', here))) {
  const lines = (d, m, f) => [[0.5, 0.03, 'GK'], ...[[d, 0.22, 'DF'], [m, 0.47, 'MF'], [f, 0.72, 'FW']].flatMap(([n, y, role]) => Array.from({ length: n }, (_, k) => [(k + 1) / (n + 1), y, role]))].map(([x, y, role]) => ({ role, x, y }));
  const keys = ['4-4-2', '4-3-3', '4-5-1', '5-3-2', '3-5-2', '4-2-4'];
  const F = Object.fromEntries(keys.map(k => [k, { slots: lines(...k.split('-').map(Number)) }]));
  const src = `export const FORMATIONS = ${JSON.stringify(F)}; export const FORMATION_KEYS = ${JSON.stringify(keys)};`;
  const hooks = `export async function resolve(s, c, next) { if (s.endsWith('/tactics.js') || s === './tactics.js') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(src)}), shortCircuit: true }; return next(s, c); }`;
  register('data:text/javascript,' + encodeURIComponent(hooks));
  console.log('(src/tactics.js not there yet: using a stand-in)');
}
const K = await import('../src/career.js');
const Clubs = await import('../src/clubs.js');
const { FORMATIONS } = await import('../src/tactics.js');

const CAREERS = Number(process.argv[2]) || 40, SEASONS = Number(process.argv[3]) || 6;
let failures = 0;
const fail = msg => { if (failures++ < 30) console.log('FAIL', msg); };
const HEX = /^#[0-9a-f]{6}$/i;
const ATTR = ['pace', 'shooting', 'passing', 'tackling', 'keeping'];

function freeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); }
  return o;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- the checks ----------
function checkTeam(t, where) {
  if (!t || t.players?.length !== 11) return fail(`${where}: ${t?.players?.length} starters`);
  if (t.players[0].pos !== 'GK') fail(`${where}: slot 0 is a ${t.players[0].pos}`);
  if (t.players.slice(1).some(p => p.pos === 'GK')) fail(`${where}: a keeper in the outfield`);
  if (!FORMATIONS[t.formation]) fail(`${where}: formation ${t.formation}`);
  if (new Set(t.players.map(p => p.id)).size !== 11) fail(`${where}: a player twice`);
  if (new Set(t.players.map(p => p.num)).size !== 11) fail(`${where}: a shirt number twice`);
  if (!/^[A-Z]{3}$/.test(t.short)) fail(`${where}: short ${t.short}`);
  for (const k of ['shirt', 'shorts', 'socks', 'trim']) if (!HEX.test(t.kit[k])) fail(`${where}: kit.${k} ${t.kit[k]}`);
  for (const k of ['shirt', 'shorts', 'socks']) if (!HEX.test(t.gk[k])) fail(`${where}: gk.${k} ${t.gk[k]}`);
  if (!['plain', 'stripes', 'hoops', 'halves', 'sash'].includes(t.kit.pattern)) fail(`${where}: pattern ${t.kit.pattern}`);
  for (const p of t.players) for (const a of ATTR) if (!Number.isInteger(p[a]) || p[a] < 1 || p[a] > 9) fail(`${where}: ${p.name}.${a} = ${p[a]}`);
}
let clashLeft = 0, gkClash = 0;
function checkKits(home, away, where) {
  const d = (a, b) => Math.min(Clubs.deltaE(a.shirt, b.shirt), Clubs.deltaE(Clubs.shirtLook(a), Clubs.shirtLook(b)));
  if (d(home.kit, away.kit) < K.CLASH) clashLeft++;
  const shirts = [home.kit, away.kit].flatMap(k => [k.shirt, Clubs.shirtLook(k)]);
  for (const g of [home.gk, away.gk]) if (Math.min(...shirts.map(s => Clubs.deltaE(g.shirt, s))) < K.CLASH * 0.6) { gkClash++; if (gkClash < 4) fail(`${where}: keeper ${g.shirt} close to an outfield shirt`); }
  if (Clubs.deltaE(home.gk.shirt, away.gk.shirt) < 10) fail(`${where}: both keepers in ${home.gk.shirt}`);
}
function checkTables(C, where) {
  for (const d of [1, 2]) {
    const t = K.table(C, d), played = C.results[d].filter(Boolean).length;
    if (t.length !== 8) fail(`${where}: division ${d} has ${t.length}`);
    if (t.some(r => r.p !== played)) fail(`${where}: division ${d} played counts ${t.map(r => r.p).join(',')} ≠ ${played}`);
    const games = (played * 8) / 2, draws = t.reduce((s, r) => s + r.d, 0) / 2;
    if (t.reduce((s, r) => s + r.pts, 0) !== 3 * (games - draws) + 2 * draws) fail(`${where}: division ${d} points don't add up`);
    if (t.reduce((s, r) => s + r.gf, 0) !== t.reduce((s, r) => s + r.ga, 0)) fail(`${where}: goals for ≠ against`);
    if (t.some(r => r.w + r.d + r.l !== r.p || r.pts !== 3 * r.w + r.d)) fail(`${where}: a row doesn't add up`);
  }
}
function checkSquads(C, where) {
  for (const c of Clubs.CLUBS) {
    const s = K.squad(C, c.id), gk = s.filter(p => p.pos === 'GK').length;
    if (s.length < Clubs.SQUAD_MIN || s.length > Clubs.SQUAD_MAX) fail(`${where}: ${c.short} has ${s.length} players`);
    if (gk < 2) fail(`${where}: ${c.short} has ${gk} keepers`);
    if (new Set(s.map(p => p.num)).size !== s.length) fail(`${where}: ${c.short} shares a shirt number`);
  }
  if (!Number.isFinite(C.budget)) fail(`${where}: budget ${C.budget}`);
  const L = K.lineupOf(C, C.club);
  if (L.xi.length !== 11 || new Set(L.xi).size !== 11 || L.xi.some(id => K.clubAt(C, id) !== C.club)) fail(`${where}: your eleven ${L.xi}`);
}

// ---------- the manager ----------
function rngOf(seed) { const R = Clubs.rng(seed); return R; }
const result = m => ({ score: m.s, pens: m.p, winner: m.w });
function manage(C, R, log) {
  // now and then: a shape, a swap, a sale, a buy
  if (R() < 0.08) {
    const keys = K.formations(), k = keys[Math.floor(R() * keys.length)];
    C = K.setFormation(C, k);
  }
  if (R() < 0.15) {
    const xi = K.lineupOf(C, C.club).xi, bench = K.benchOf(C);
    const a = xi[1 + Math.floor(R() * 10)], b = bench[Math.floor(R() * bench.length)]?.id;
    if (b) { const why = K.swapWhy(C, a, b), C2 = K.swap(C, a, b); if (!why !== (C2 !== C)) fail('swapWhy disagrees with swap'); C = C2; }
    const gk = K.benchOf(C).find(p => p.pos === 'GK');
    if (gk && !K.swapWhy(C, xi[3], gk.id)) fail('a keeper allowed into the outfield');
  }
  if (R() < 0.12) {
    const list = K.sellList(C).filter(r => r.can && !r.xi);
    const r = list[Math.floor(R() * list.length)];
    if (r) { const res = K.sell(C, r.p.id); if (res.ok) { C = res.C; log.sold++; } else fail(`sell refused a sellable player: ${res.why}`); }
  }
  if (R() < 0.2) {
    const pos = Clubs.POSITIONS[Math.floor(R() * 4)];
    const r = K.market(C, pos).find(x => x.can && Clubs.overall(x.p) > K.strength(C, C.club) - 0.3);
    if (r) {
      const res = K.buy(C, r.p.id);
      if (res.ok) { C = res.C; log.bought++; if (R() < 0.7) C = K.autoPick(C); } else fail(`buy refused a buyable player: ${res.why}`);
    }
    const no = K.market(C).find(x => !x.can);
    if (no && K.buy(C, no.p.id).ok) fail(`bought a player the market refused (${no.why})`);
  }
  return C;
}

// one career: the club's matches lean by `edge` (the manager's skill at the controls)
function career(seed, club, edge, seasons, trace = null) {
  const R = rngOf(seed * 7 + 1), log = { bought: 0, sold: 0, titleAt: 0, upAt: 0, budgets: [], seasons: [] };
  let C = K.newCareer({ seed, club });
  for (let s = 0; s < seasons; s++) {
    let guard = 0;
    while (!K.seasonOver(C)) {
      if (guard++ > 40) { fail('a season that never ends'); return { C, log }; }
      C = manage(C, R, log);
      const fx = K.fixture(C);
      if (!fx) { fail(`no fixture in week ${C.week} though the season is on`); break; }
      const where = `seed ${seed} S${C.season} W${C.week + 1}`;
      const [home, away] = K.teamsFor(C, fx);
      checkTeam(home, where + ' home'); checkTeam(away, where + ' away'); checkKits(home, away, where);
      if (![home.id, away.id].includes(C.club)) fail(`${where}: the fixture doesn't involve your club`);
      // the match, with the manager's edge on your side
      const me = fx.home === C.club ? 0 : 1, m = K.simMatch(C, fx.home, fx.away, Clubs.rng(seed * 1000 + C.season * 50 + C.week), fx.knockout);
      if (R() < edge) {
        if (m.s[me] <= m.s[1 - me]) { m.s[me] = m.s[1 - me] + 1; m.w = me; m.p = null; }
      }
      const res = R() < 0.01 ? K.forfeit(fx, C) : result(m);
      const frozen = freeze(C);
      const json = JSON.stringify(frozen);
      const out = K.playWeek(frozen, res);
      if (JSON.stringify(frozen) !== json) fail(`${where}: playWeek changed the career it was given`);
      C = out.C;
      trace?.push(out.report.mine && `${out.report.mine.s.join('-')}`);
      if (!out.report.mine) fail(`${where}: no report of your match`);
      else if (fx.knockout && out.report.mine.w < 0) fail(`${where}: a cup tie without a winner`);
      checkTables(C, where);
      checkSquads(C, where);
      // the checkpoint: through JSON and back, and the label
      const back = K.load(JSON.parse(JSON.stringify(K.save(C))));
      if (!back || !same(K.table(back, 1), K.table(C, 1)) || !same(K.fixture(back), K.fixture(C)) || back.budget !== C.budget) fail(`${where}: the save doesn't round-trip`);
      if (!/^Season \d+ · Week \d+ · \w+/.test(K.label(C))) fail(`label ${K.label(C)}`);
    }
    // the season's end
    const where = `seed ${seed} season ${C.season}`;
    for (const d of [1, 2]) if (C.results[d].filter(Boolean).length !== 14) fail(`${where}: division ${d} played ${C.results[d].length} matchdays`);
    const winner = K.cupWinner(C);
    if (!winner) fail(`${where}: no cup winner`);
    const stages = Clubs.CLUBS.map(c => K.cupStage(C, c.id));
    if (stages.filter(x => x === 4).length !== 1 || stages.filter(x => x === 3).length !== 1 || stages.filter(x => x === 2).length !== 2 || stages.filter(x => x === 1).length !== 4 || stages.filter(x => x === 0).length !== 8) fail(`${where}: cup stages ${stages.join(',')}`);
    const before = { ...C.div };
    const { C: next, summary } = K.endSeason(freeze(C));
    if (summary.promoted.length !== 2 || summary.relegated.length !== 2) fail(`${where}: ${summary.promoted.length} up, ${summary.relegated.length} down`);
    if (summary.promoted.some(id => before[id] !== 2 || next.div[id] !== 1) || summary.relegated.some(id => before[id] !== 1 || next.div[id] !== 2)) fail(`${where}: promotion/relegation went wrong`);
    if (K.clubsIn(next, 1).length !== 8 || K.clubsIn(next, 2).length !== 8) fail(`${where}: divisions of ${K.clubsIn(next, 1).length} and ${K.clubsIn(next, 2).length}`);
    if (next.week !== 0 || next.season !== C.season + 1) fail(`${where}: the next season starts at week ${next.week}`);
    if (!Number.isFinite(next.budget)) fail(`${where}: budget NaN after the season`);
    log.seasons.push({ div: summary.div, pos: summary.pos, cup: summary.cupStage, budget: next.budget });
    if (summary.up && !log.upAt) log.upAt = s + 1;
    if (summary.title && !log.titleAt) log.titleAt = s + 1;
    if (summary.firstTitle !== (summary.title && log.titleAt === s + 1)) fail(`${where}: firstTitle wrong`);
    C = next;
    log.budgets.push(C.budget);
  }
  return { C, log };
}

// ---------- kits: every pairing ----------
let changes = 0, pairs = 0;
for (const h of Clubs.CLUBS) for (const a of Clubs.CLUBS) {
  if (h === a) continue;
  const [home, away] = K.matchTeams(null, h.id, a.id);
  checkTeam(home, `friendly ${h.short}-${a.short}`); checkTeam(away, `friendly ${h.short}-${a.short}`);
  checkKits(home, away, `${h.short} v ${a.short}`);
  pairs++;
  if (away.kit.shirt !== a.kit.home.shirt) changes++;
}
{
  const [, away] = K.matchTeams(null, 'kettleford', 'ostervale');
  if (away.kit.shirt === Clubs.clubOf('ostervale').kit.home.shirt) fail('Ostervale kept red at red Kettleford');
}

// ---------- the careers ----------
const t0 = Date.now();
const div2 = Clubs.CLUBS.filter(c => c.div === 2).map(c => c.id);
const stats = { title: [], up: [], never: 0, budgets: [], bought: 0, sold: 0, goals: 0, games: 0, home: 0, draws: 0 };
for (let i = 0; i < CAREERS; i++) {
  const edge = [0.15, 0.35, 0.55][i % 3];
  const { log } = career(1000 + i, div2[i % div2.length], edge, SEASONS);
  if (log.titleAt) stats.title.push([edge, log.titleAt]); else stats.never++;
  if (log.upAt) stats.up.push([edge, log.upAt]);
  stats.budgets.push(...log.budgets);
  stats.bought += log.bought; stats.sold += log.sold;
}
// replays exactly
{
  const a = [], b = [];
  const A = career(77, 'kettleford', 0.3, 2, a).C, B = career(77, 'kettleford', 0.3, 2, b).C;
  if (!same(A, B) || !same(a, b)) fail('the same career played twice came out differently');
}
// the simulated matches: goals, home wins, draws
{
  const C = K.newCareer({ seed: 5, club: 'kettleford' });
  for (let i = 0; i < 4000; i++) {
    const c = Clubs.CLUBS, h = c[i % 16].id, a = c[(i * 7 + 3) % 16].id;
    if (h === a) continue;
    const m = K.simMatch(C, h, a, Clubs.rng(i + 9));
    stats.goals += m.s[0] + m.s[1]; stats.games++;
    if (m.s[0] > m.s[1]) stats.home++; else if (m.s[0] === m.s[1]) stats.draws++;
  }
}
// a bad save
if (K.load({ v: 99 }) !== null || K.load(null) !== null || K.load('junk') !== null) fail('load() accepted a broken save');

const avg = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const byEdge = (list, e) => list.filter(x => x[0] === e).map(x => x[1]);
console.log(`kits: ${pairs} pairings, ${changes} away changes, ${clashLeft} still alike (no better kit), ${gkClash} keeper near-clashes`);
console.log(`careers: ${CAREERS} × ${SEASONS} seasons in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const e of [0.15, 0.35, 0.55]) {
  const t = byEdge(stats.title, e), u = byEdge(stats.up, e), n = Math.ceil(CAREERS / 3);
  console.log(`  edge ${e}: promoted ${u.length}/${n} (avg season ${avg(u).toFixed(1)}), title ${t.length}/${n} (avg season ${avg(t).toFixed(1)})`);
}
const b = stats.budgets.slice().sort((x, y) => x - y);
console.log(`budgets at season ends: min ${K.money(b[0])}, median ${K.money(b[b.length >> 1])}, max ${K.money(b[b.length - 1])}; ${stats.bought} bought, ${stats.sold} sold`);
console.log(`simulated matches: ${(stats.goals / stats.games).toFixed(2)} goals a game, home wins ${((stats.home / stats.games) * 100).toFixed(0)}%, draws ${((stats.draws / stats.games) * 100).toFixed(0)}%`);
console.log(failures ? `FAIL (${failures})` : 'PASS');
process.exit(failures ? 1 : 0);
