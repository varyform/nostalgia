// Plays Netcord's tour (src/tour.js over src/players.js) out many times, your own matches
// simulated from the ratings like everyone else's (tilted by how well you play: `edge` rating
// levels), training points spent as they come. Checks every rule the game leans on and prints
// PASS or FAIL with the numbers:
//
//   draws complete (the right size, everyone once, you in it, seeds 1 and 2 in opposite halves);
//   every round played, real tennis scores, one champion per event; ranking points consistent
//   (each event's column adds up to what its draw pays, totals match the table); money and
//   training never NaN or negative; players fit createMatch (and, once src/sim.js exists, a real
//   match takes them and runs); the autosave state survives JSON; a tour replays exactly;
//   nothing mutates a tour.
//
//   node games/netcord/tools/tour.mjs [tours, default 24] [edge, default 1]
import { existsSync } from 'node:fs';

const K = await import('../src/tour.js');
const P = await import('../src/players.js');
const TOURS = Number(process.argv[2]) || 24, EDGE = Number(process.argv[3] ?? 1);
let failures = 0, checks = 0;
const fail = msg => { if (failures++ < 30) console.log('FAIL', msg); };
const ok = (c, msg) => { checks++; if (!c) fail(msg); };
const HEX = /^#[0-9a-f]{6}$/i;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function freeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); }
  return o;
}

// ---------- the data ----------
ok(P.PLAYERS.length === 32, `${P.PLAYERS.length} players`);
ok(new Set(P.PLAYERS.map(p => p.id)).size === 32, 'player ids not unique');
ok(new Set(P.PLAYERS.map(p => p.short)).size === 32, 'short names not unique');
ok(P.VENUES.length === 8, `${P.VENUES.length} venues`);
ok(P.CROWN_IDS.length === 4 && new Set(P.VENUES.filter(v => v.tier === 'crown').map(v => v.surface)).size === 4, 'a Crown on each surface');
for (const v of P.VENUES) {
  const rounds = K.roundsOf(v.draw);
  ok(v.points.length === rounds + 1 && v.prize.length === rounds + 1, `${v.id}: ladders for ${rounds} rounds`);
  ok(v.points.every((x, k) => !k || x > v.points[k - 1]) && v.prize.every((x, k) => !k || x > v.prize[k - 1]), `${v.id}: ladders rise`);
  for (const [k, c] of Object.entries(v.colours)) ok(HEX.test(c), `${v.id}: colour ${k} ${c}`);
  ok(P.SURFACES.includes(v.surface), `${v.id}: surface ${v.surface}`);
}
let sim = null;
if (existsSync(new URL('../src/sim.js', import.meta.url))) {
  try { sim = await import('../src/sim.js'); } catch (e) { console.log(`(src/sim.js didn't load: ${e.message})`); }
} else console.log('(src/sim.js not there yet: players checked by shape only)');
function checkPlayer(p, where) {
  ok(p && typeof p.id === 'string' && typeof p.name === 'string' && /^[A-Z .-]{2,12}$/.test(p.short), `${where}: names ${p?.short}`);
  ok(P.NATIONS[p.country], `${where}: country ${p.country}`);
  ok(p.hand === 'right' || p.hand === 'left', `${where}: hand ${p.hand}`);
  ok(p.height >= 1.7 && p.height <= 1.96, `${where}: height ${p.height}`);
  ok(P.STYLES.includes(p.style), `${where}: style ${p.style}`);
  for (const a of P.RATINGS) ok(Number.isInteger(p.ratings[a]) && p.ratings[a] >= 1 && p.ratings[a] <= 9, `${where}: ${a} ${p.ratings[a]}`);
  for (const k of ['shirt', 'shorts', 'band']) ok(HEX.test(p.kit[k]), `${where}: kit.${k} ${p.kit[k]}`);
  ok(HEX.test(p.skin) && HEX.test(p.hair), `${where}: skin/hair`);
}
let simRuns = 0;
function tryMatch(a, b, surface) {
  if (!sim?.createMatch || simRuns >= 12) return;
  simRuns++;
  try {
    const m = sim.createMatch({ players: [a, b], surface, sets: 1, cpu: [true, true], seed: simRuns, assist: true });
    for (let k = 0; k < 60 * 40 && !m.done; k++) { m.step([null, null]); if (Array.isArray(m.events)) m.events.length = 0; }
    ok(m.s && Number.isFinite(m.s.ball?.x), `createMatch ${a.id} v ${b.id}: ball state`);
  } catch (e) {
    fail(`createMatch ${a.id} v ${b.id} on ${surface}: ${e.message}`);
  }
}

// ---------- one event ----------
function validSet([x, y], last) {
  const hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6)) || (last === false && false);
}
function checkScore(sc, best, w, where, ret) {
  if (ret) return;
  ok(Array.isArray(sc) && sc.length >= Math.ceil(best / 2) && sc.length <= best, `${where}: ${sc?.length} sets of ${best}`);
  for (const s of sc ?? []) ok(validSet(s), `${where}: set ${s}`);
  const won = [0, 0];
  for (const [x, y] of sc ?? []) won[x > y ? 0 : 1]++;
  ok(won[w] === Math.ceil(best / 2) && won[1 - w] < won[w], `${where}: sets ${won.join('–')} winner ${w}`);
}
function checkEvent(T, where) {
  const E = T.event, v = P.venueById(E.id), n = v.draw, rounds = K.roundsOf(n);
  ok(E.draw.length === n && new Set(E.draw).size === n, `${where}: draw of ${E.draw.length}`);
  ok(E.draw.every(id => K.pool(T).includes(id)), `${where}: a stranger in the draw`);
  ok(E.draw.includes(T.you), `${where}: you're not in the draw`);
  const seed1 = E.draw.findIndex(id => E.seedOf[id] === 1), seed2 = E.draw.findIndex(id => E.seedOf[id] === 2);
  ok(seed1 >= 0 && seed2 >= 0 && seed1 < n / 2 !== seed2 < n / 2, `${where}: seeds 1 and 2 in one half`);
  ok(E.done && E.rounds.length === rounds, `${where}: ${E.rounds.length} of ${rounds} rounds`);
  E.rounds.forEach((round, r) => {
    ok(round.length === n >> (r + 1), `${where}: round ${r} has ${round.length}`);
    round.forEach((m, k) => {
      ok(m.w === m.a || m.w === m.b, `${where}: r${r} m${k} winner ${m.w}`);
      if (r) ok(m.a === E.rounds[r - 1][2 * k].w && m.b === E.rounds[r - 1][2 * k + 1].w, `${where}: r${r} m${k} not the winners`);
      const mine = m.a === T.you || m.b === T.you;
      if (!mine) checkScore(m.sc, v.sets, m.w === m.a ? 0 : 1, `${where} r${r} m${k}`, m.ret);
    });
  });
  ok(K.championOf(E) != null, `${where}: no champion`);
}
const columnSum = v => {
  const rounds = K.roundsOf(v.draw);
  let s = v.points[rounds];
  for (let r = 0; r < rounds; r++) s += (v.draw >> (r + 1)) * v.points[r];
  return s;
};

// ---------- a tour ----------
const stats = { no1: [], crowns: [], crownSeasons: [], ranks: [], money: [], titles: [], picked: [] };
function playTour(seed, { pick = null, edge = EDGE, seasons = K.SEASONS, check = true } = {}) {
  const me = pick ? null : K.createPlayer({ name: 'TESTER', style: P.STYLES[seed % 4], hand: seed % 3 ? 'right' : 'left', height: 1.84, country: P.NATION_CODES[seed % P.NATION_CODES.length], kit: seed % 8 });
  let T = K.newTour({ seed, me, pick });
  const trail = [];
  const fz = o => (check ? freeze(clone(o)) : o);
  const clone = o => JSON.parse(JSON.stringify(o));
  if (check) {
    ok(K.rankings(T).length === (me ? 33 : 32), `tour ${seed}: ${K.rankings(T).length} ranked`);
    if (me) ok(K.rankOf(T) === 33, `tour ${seed}: a new player starts ${K.rankOf(T)}`);
    for (const id of K.pool(T)) checkPlayer(K.playerOf(T, id), `tour ${seed} ${id}`);
  }
  for (let s = 0; s < seasons && !T.over; s++) {
    for (let e = 0; e < K.CALENDAR_LEN && !T.over; e++) {
      const money0 = T.money;
      T = K.enter(fz(T));
      trail.push(K.label(T));
      if (check) {
        const back = K.load(JSON.parse(JSON.stringify(K.save(T))));
        ok(back && same(back, T), `tour ${seed}: the checkpoint at ${K.label(T)} doesn't round-trip`);
        ok(typeof K.label(T) === 'string' && /^Season \d+ · .+ · (R\d|QF|SF|F)$/.test(K.label(T)), `label ${K.label(T)}`);
      }
      let guard = 0;
      while (!T.event.done && guard++ < 10) {
        const nm = K.nextMatch(T);
        if (!nm) { fail(`tour ${seed}: no match for you in ${T.event.id} r${T.event.r}`); break; }
        if (check && simRuns < 12) tryMatch(K.playerOf(T, T.you), K.playerOf(T, nm.opp), nm.venue.surface);
        // your match: from the ratings, as though you were `edge` levels better
        const R = K.rng(K.hashStr(`${seed}:${T.season}:${T.ev}:${T.event.r}:me`));
        const res = K.simMatch(K.levelled(K.playerOf(T, T.you), edge), K.playerOf(T, nm.opp), nm.venue.surface, nm.venue.sets, R);
        T = K.report(fz(T), { won: res.w === 0, sets: res.sc });
        if (check && !T.event.done) ok(same(K.load(K.save(T)), T), `tour ${seed}: mid-event round-trip`);
      }
      if (check) checkEvent(T, `tour ${seed} s${T.season} ${T.event.id}`);
      const v = P.venueById(T.event.id);
      const r = K.closeEvent(fz(T));
      T = r.T;
      if (check) {
        ok(r.summary?.entered && r.summary.champion, `tour ${seed}: summary`);
        const col = K.pool(T).reduce((sum, id) => sum + T.pts[id][T.ev - 1], 0);
        ok(col === columnSum(v), `tour ${seed} ${v.id}: points column ${col} ≠ ${columnSum(v)}`);
        const table = K.rankings(T);
        ok(table.every((row, k) => row.pts === K.points(T, row.id) && (!k || row.pts <= table[k - 1].pts)), `tour ${seed}: table out of order`);
        ok(Number.isFinite(T.money) && T.money >= money0 && T.money - money0 === r.summary.prize, `tour ${seed}: money ${T.money}`);
        ok(Number.isInteger(T.train) && T.train >= 0, `tour ${seed}: training ${T.train}`);
      }
      if (r.summary.newNo1 && check && !pick && !stats.no1[seed]) stats.no1[seed] = T.season + (T.ev - 1) / 8;
      // spend the training points, the cheapest rating first
      for (let g = 0; g < 40; g++) {
        const a = P.RATINGS.slice().sort((x, y) => K.trainCost(T, x) - K.trainCost(T, y))[0];
        if (K.trainCost(T, a) > T.train) break;
        const t = K.train(fz(T), a);
        if (!t.ok) break;
        T = t.T;
      }
    }
    if (K.seasonOver(T)) {
      const e = K.endSeason(fz(T));
      if (check) ok(e.summary.season === T.season && e.T.season === T.season + 1 && e.T.ev === 0, `tour ${seed}: season end`);
      T = e.T;
      if (check) ok(same(K.load(K.save(T)), T), `tour ${seed}: new season round-trip`);
    }
  }
  return { T, trail };
}

const t0 = Date.now();
for (let k = 1; k <= TOURS; k++) {
  const pick = k % 4 === 0 ? P.PLAYERS[(k * 5) % 32].id : null;
  const { T } = playTour(k, { pick });
  if (pick) { stats.picked.push(K.rankOf(T)); continue; }
  stats.ranks.push(T.history.map(h => h.rank));
  stats.crowns.push(K.majorsWon(T));
  if (T.over === 'crowns') stats.crownSeasons.push(T.season - (T.ev === 0 ? 1 : 0));
  stats.money.push(T.money);
  stats.titles.push(T.titles.length);
}
// determinism
ok(same(playTour(99, { check: false }).trail, playTour(99, { check: false }).trail), 'a tour does not replay exactly');
ok(same(K.newTour({ seed: 5, pick: 'danvik' }), K.newTour({ seed: 5, pick: 'danvik' })), 'newTour not deterministic');
// what the loader refuses
ok(K.load(null) === null && K.load({ v: 0 }) === null && K.load({ ...K.newTour({ seed: 3 }), you: 'nobody' }) === null, 'load accepts junk');
// the initial ranking follows the ratings, roughly
const T0 = K.newTour({ seed: 11, pick: 'danvik' }), top8 = K.rankings(T0).slice(0, 8).map(r => r.id);
ok(top8.filter(id => P.playerById(id).rank <= 12).length >= 5, `initial top 8 ${top8.join(' ')}`);

const avg = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const bySeason = s => (stats.ranks.some(r => r.length > s) ? avg(stats.ranks.filter(r => r.length > s).map(r => r[s])).toFixed(1) : '–');
console.log(`${TOURS} tours (edge ${EDGE}), ${checks} checks, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`created player, year-end rank by season: ${Array.from({ length: K.SEASONS }, (_, s) => bySeason(s)).join(' ')}`);
console.log(`world No. 1 reached in ${stats.no1.filter(Boolean).length}/${stats.ranks.length} (season ${avg(stats.no1.filter(Boolean)).toFixed(1)} on average)`);
console.log(`crowns won ${avg(stats.crowns).toFixed(1)}/4 on average; all four in ${stats.crownSeasons.length} (after ${avg(stats.crownSeasons).toFixed(1)} seasons)`);
console.log(`titles ${avg(stats.titles).toFixed(1)}, career money ${K.money(avg(stats.money))}; picked players' final ranks ${stats.picked.join(' ')}`);
console.log(failures ? `FAIL (${failures})` : 'PASS');
process.exit(failures ? 1 : 0);
