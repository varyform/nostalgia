// Plays Scorch's career (src/career.js) out many times over, with plausible race results in
// place of the race sim: a car's pace comes from its stats and its driver's skill (the player's
// skill on the AI's own 0…1 scale), with luck on top; the damage taken grows with the rivals'
// guns and temper; kills come from the ammo the player brings. The player takes the offer worth
// most to them and shops by one of three habits. Reports races to #1 and to beating Marrow,
// cash and bills over time, what got bought when, how long each car is kept, soft-locks, and
// any break of the career's rules (mutation, bad offers, a race that pays nothing, save/load).
//
//   node games/scorch/tools/career.mjs [careers per player, default 300]
import * as K from '../src/career.js';

const N = Number(process.argv[2]) || 300;
const LIMIT = 150; // races before a career counts as unfinished
const SKILLS = { weak: 0.6, decent: 0.78, strong: 0.9 }; // the top rival drives at 0.82, Marrow 0.84
const HABITS = ['balanced', 'saver', 'upgrader'];
const RESERVE = 700; // cash the player keeps back for repairs

let failures = 0;
const fail = msg => {
  if (failures++ < 20) console.log('FAIL', msg);
};

function rngOf(seed) {
  let s = seed | 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = rnd => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const U = (rnd, a, b) => a + (b - a) * rnd();
function freeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) freeze(v);
  }
  return o;
}
const order = id => K.MODELS.findIndex(m => m.id === id);
const score = s => 0.45 * (s.top / 30) + 0.2 * (s.accel / 9) + 0.2 * s.grip + 0.15 * Math.sqrt(s.hp / 100);

// one race, as race.result() would report it
function race(cars, o, skill, rnd) {
  const lapsF = o.laps / 3;
  const rows = cars.map(c => ({ c, id: c.id, hp: c.hp, pace: score(c.stats) * (0.6 + 0.5 * (c.ai ? c.ai.skill : skill)) * (1 + 0.08 * gauss(rnd)), kills: 0, wrecked: false }));
  const [me, ...rivals] = rows, you = cars[0];
  // the player's fire: what's in the boot, aimed about as well as they drive
  const fired = Math.min(you.ammo, Math.round(you.stats.rate * U(rnd, 12, 30) * lapsF));
  const mines = Math.min(you.mines, Math.floor(U(rnd, 0, 2.99)));
  const turbo = Math.min(you.turbo, Math.floor(U(rnd, 0, 3.99)));
  me.pace *= 1 + 0.012 * turbo;
  const dealt = fired * you.stats.gun * (0.2 + 0.3 * skill) + mines * (rnd() < 0.5 ? 50 : 0);
  const w = rivals.map(() => rnd() ** 2), wsum = w.reduce((a, b) => a + b, 0) || 1;
  rivals.forEach((r, k) => {
    if (dealt * (w[k] / wsum) >= r.hp) [r.wrecked, me.kills] = [true, me.kills + 1];
    else if (rnd() < 0.06) r.wrecked = true; // the others, or a mine, finish one off now and then
  });
  // what comes back at you: the rivals' guns, by rate and temper, less from the ones you stopped
  let incoming = 0;
  for (const r of rivals) incoming += r.c.stats.gun * r.c.stats.rate * (0.4 + 0.6 * r.c.ai.aggression) * (r.wrecked ? 0.4 : 1);
  const dmg = Math.round((incoming * 1.4 * U(rnd, 0.3, 1.5) * (1.3 - 0.7 * skill) + 12 * rnd()) * lapsF);
  if (dmg >= you.hp) me.wrecked = true;
  return [...rows]
    .sort((a, b) => a.wrecked - b.wrecked || b.pace - a.pace)
    .map((r, k) => ({
      id: r.id, place: k + 1, finished: !r.wrecked, wrecked: r.wrecked, time: 0, kills: r.kills,
      cash: r === me ? Math.round(rnd() * 70 * o.laps * (0.4 + skill)) : 0,
      hp: r === me ? Math.max(0, you.hp - dmg) : r.wrecked ? 0 : r.hp,
      ammo: r === me ? you.ammo - fired : r.c.ammo, mines: r === me ? you.mines - mines : r.c.mines, turbo: r === me ? you.turbo - turbo : r.c.turbo,
    }));
}

// the offer a sensible player takes: the best money after the bills, with points worth $300
function choose(C, list, skill, rnd) {
  if (list.length === 1) return list[0];
  let best = null, bestV = -Infinity;
  for (const o of list) {
    let v = 0;
    for (let i = 0; i < 24; i++) {
      const cars = K.entrants(C, o);
      const r = race(cars, o, skill, rnd).find(x => x.id === K.PLAYER);
      const bills = K.repairCost(C, C.hp - r.hp) + (cars[0].ammo - r.ammo) * K.PRICE.ammo.each;
      v += o.prizes[r.place - 1] + r.cash + r.kills * o.kill - bills + 300 * o.points[r.place - 1];
    }
    if (v > bestV) [best, bestV] = [o, v];
  }
  return best;
}

// The garage, by habit: repair, the next car once it's affordable, ammo to three quarters, then
// parts: 'upgrader' buys any it can, 'saver' only cheap ones while a better car is ahead,
// 'balanced' parts while that car is far off. A turbo charge and mines when flush.
function shopAround(C, habit, out, avg) {
  const act = what => {
    const before = JSON.stringify(C);
    const r = K.buy(freeze(C), what);
    if (JSON.stringify(C) !== before) fail('buy mutated C');
    if (!r.ok) return false;
    const kind = what.supply ?? (what.car ? 'cars' : 'parts');
    out.bills[C.races - 1][kind] = (out.bills[C.races - 1][kind] ?? 0) + C.cash - r.C.cash;
    if (!what.supply) out.buys.push({ race: C.races, what: what.car ?? `${C.model} ${what.part} ${r.C.up[what.part]}` });
    C = r.C;
    return true;
  };
  while (act({ supply: 'repair' }));
  const nextCar = () => K.shop(C).cars.find(c => !c.owned && order(c.id) > order(C.model));
  let next = nextCar();
  if (next && C.cash - next.net >= RESERVE) act({ car: next.id });
  const belt = K.PRICE.ammo.step * K.PRICE.ammo.each;
  while (C.ammo < K.modelOf(C.model).caps.ammo * 0.75 && C.cash >= belt + 300 && act({ supply: 'ammo' }));
  next = nextCar();
  const gap = next ? next.net - C.cash : 0;
  for (;;) {
    const p = K.shop(C).parts.filter(p => p.can && C.cash - p.price >= RESERVE).sort((a, b) => a.price - b.price)[0];
    const wanted = p && (habit === 'upgrader' || !next || (habit === 'balanced' ? gap > 6 * avg || p.price < 0.12 * next.net : p.price < 0.05 * next.net));
    if (!wanted || !act({ part: p.part })) break;
  }
  if (C.cash > 2500 && C.turbo < 1) act({ supply: 'turbo' });
  if (C.cash > 3500 && C.mines < 2) act({ supply: 'mines' });
  return C;
}

function checkOffers(C, list) {
  const at1 = K.standings(C).find(s => s.you).rank === 1;
  if (at1 !== (C.rank === 1)) fail('C.rank out of step with standings()');
  if (at1 ? list.length !== 1 || list[0].tier !== 'final' : list.length !== 3) fail(`offers: ${list.length} at rank ${C.rank}`);
  if (JSON.stringify(list) !== JSON.stringify(K.offers(C))) fail('offers not deterministic');
  for (const o of list) {
    if (new Set(o.rivals).size !== 3 || o.rivals.some(id => !K.driverOf(id))) fail(`offer rivals ${o.rivals}`);
    if (o.tier !== 'final' && o.rivals.includes(K.CHAMPION)) fail('Marrow in a regular race');
    if (o.prizes.length !== 4 || o.points.length !== 4 || !(o.laps > 0)) fail('offer shape');
    for (const c of K.entrants(C, o)) for (const [k, v] of Object.entries(c.stats)) if (!Number.isFinite(v) || v <= 0) fail(`stat ${k}=${v}`);
  }
}

function career(seed, skill, habit) {
  const rnd = rngOf(seed * 7919 + 13);
  let C = K.newCareer({ seed, name: 'SIM' });
  const out = { to1: null, champ: null, finals: 0, wrecks: 0, kills: 0, cash: [], ranks: [], places: [], tiers: {}, bills: [], buys: [], cars: { [C.model]: 1 }, stall: 0 };
  let avg = 800, best = 13, since = 0;
  while (!C.champion && C.races < LIMIT) {
    freeze(C);
    const list = K.offers(C);
    checkOffers(C, list);
    const o = choose(C, list, skill, rnd);
    const res = race(K.entrants(C, o), o, skill, rnd);
    const { C: next, report } = K.settle(C, o, res);
    if (report.gain <= 0) fail(`a race paid nothing (place ${report.place})`);
    if (next.hp < Math.ceil(next.maxHp * K.PRICE.patch)) fail('car left unpatched');
    if (JSON.stringify(K.load(JSON.parse(JSON.stringify(K.save(next))))) !== JSON.stringify(next)) fail('save/load drift');
    out.wrecks += report.wrecked;
    out.kills += report.kills;
    out.finals += o.tier === 'final';
    out.tiers[o.tier] = (out.tiers[o.tier] ?? 0) + 1;
    out.ranks.push(next.rank);
    out.places.push(report.place);
    out.bills.push({ earned: report.gain });
    if (next.rank === 1 && out.to1 == null) out.to1 = next.races;
    if (report.won) out.champ = next.races;
    avg = avg * 0.7 + report.gain * 0.3;
    const bought = out.buys.length;
    C = shopAround(next, habit, out, avg);
    out.cars[C.model] = (out.cars[C.model] ?? 0) + 1;
    out.cash.push(C.cash);
    // a stall: races in a row with no new car or part and no new best rank
    since = out.buys.length > bought || C.rank < best ? 0 : since + 1;
    best = Math.min(best, C.rank);
    out.stall = Math.max(out.stall, since);
  }
  return out;
}

const pct = (a, p) => {
  const s = a.filter(v => v != null).sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};
const spread = (a, f = v => String(v)) => (pct(a, 0.5) == null ? '-' : `${f(pct(a, 0.5))} (${f(pct(a, 0.1))}–${f(pct(a, 0.9))})`);
const $ = n => `$${Math.round(n).toLocaleString('en-US')}`;
const share = runs => {
  const t = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.tiers)) t[k] = (t[k] ?? 0) + v;
  const sum = (t.easy ?? 0) + (t.mid ?? 0) + (t.hard ?? 0);
  return ['easy', 'mid', 'hard'].map(k => Math.round((100 * (t[k] ?? 0)) / sum)).join('/');
};
const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);

console.log(`Scorch career: ${N} careers per player · median (10th–90th percentile)\n`);
console.log(`${'player'.padEnd(18)}${'#1 at'.padEnd(14)}${'champion at'.padEnd(14)}finals  wrecks  kills  easy/mid/hard  longest stall  no title in ${LIMIT}`);
const results = {};
for (const [sk, skill] of Object.entries(SKILLS)) {
  for (const habit of HABITS) {
    const runs = Array.from({ length: N }, (_, i) => career(1000 + i, skill, habit));
    results[`${sk} ${habit}`] = runs;
    const races = runs.reduce((s, r) => s + r.ranks.length, 0);
    const wr = runs.reduce((s, r) => s + r.wrecks, 0) / races, kr = runs.reduce((s, r) => s + r.kills, 0) / races;
    console.log(
      `${`${sk} ${habit}`.padEnd(18)}${spread(runs.map(r => r.to1)).padEnd(14)}${spread(runs.map(r => r.champ)).padEnd(14)}${String(pct(runs.map(r => r.finals), 0.5)).padStart(6)}  ${`${Math.round(wr * 100)}%`.padStart(6)}  ${kr.toFixed(2).padStart(5)}  ${share(runs).padStart(13)}  ${String(Math.max(...runs.map(r => r.stall))).padStart(13)}  ${runs.filter(r => r.champ == null).length}`,
    );
  }
}

const ref = results['decent balanced'];
console.log('\ndecent balanced, by race: rank, place, cash in hand after the garage, and the bills');
for (const [a, b] of [[1, 1], [2, 3], [4, 6], [7, 10], [11, 15], [16, 20], [21, 25]]) {
  const idx = [];
  for (let i = a - 1; i < b; i++) idx.push(i);
  const live = ref.filter(r => r.ranks.length >= a);
  if (live.length < N / 4) break;
  const got = k => mean(live.flatMap(r => idx.filter(i => i < r.bills.length).map(i => r.bills[i][k] ?? 0)));
  console.log(
    `  races ${`${a}–${b}`.padEnd(6)} rank ${spread(live.map(r => r.ranks[b - 1] ?? r.ranks.at(-1))).padEnd(12)} place ${mean(live.flatMap(r => idx.map(i => r.places[i]).filter(Boolean))).toFixed(2)}  cash ${spread(live.map(r => r.cash[b - 1] ?? r.cash.at(-1)), $).padEnd(26)} earns ${$(got('earned'))}/race: repair ${$(got('repair'))}, ammo ${$(got('ammo'))}, mines+turbo ${$(got('mines') + got('turbo'))}, parts ${$(got('parts'))}, cars ${$(got('cars'))}`,
  );
}

console.log('\ncars: bought at race · races kept · parts fitted to it');
for (const key of ['weak balanced', 'decent balanced', 'decent saver', 'decent upgrader', 'strong balanced']) {
  const runs = results[key];
  const cols = K.MODELS.filter(m => m.price != null).map(m => {
    const at = m.id === K.MODELS[0].id ? runs.map(() => 0) : runs.map(r => r.buys.find(b => b.what === m.id)?.race);
    const kept = runs.map(r => r.cars[m.id]).filter(Boolean);
    const parts = runs.filter(r => r.cars[m.id]).map(r => r.buys.filter(b => b.what.startsWith(`${m.id} `)).length);
    return `${m.name} ${m.id === K.MODELS[0].id ? 'start' : `@${pct(at, 0.5) ?? '-'}`} ·${pct(kept, 0.5) ?? 0} ·${pct(parts, 0.5) ?? 0}p`;
  });
  console.log(`  ${key.padEnd(16)} ${cols.join('   ')}`);
}

// the garage's other moves on a frozen career: selling back, a downgrade for cash, refusals
{
  let C = freeze({ ...K.newCareer({ seed: 7 }), cash: 50000 });
  const step = (r, ok, msg) => {
    if (r.ok !== ok) fail(`${msg}: ${r.why}`);
    return freeze(r.C);
  };
  C = step(K.buy(C, { car: 'bulwark' }), true, 'buy the Bulwark');
  C = step(K.buy(C, { part: 'armour' }), true, 'buy armour');
  if (C.hp !== C.maxHp) fail('new armour not fitted whole');
  C = step(K.sell(C, { part: 'armour' }), true, 'sell armour');
  C = step(K.sell(C, { supply: 'ammo' }), true, 'sell ammo');
  step(K.sell(C, { car: 'bulwark' }), false, 'sell the only car');
  step(K.buy(C, { car: 'nightjar' }), false, "buy Marrow's car");
  step(K.buy(C, { car: 'bulwark' }), false, 'buy the car you have');
  const down = step(K.buy({ ...C, cash: 0 }, { car: 'dustpan' }), true, 'trade down for cash');
  if (!(down.cash > 0)) fail('a downgrade paid nothing');
  step(K.buy({ ...down, cash: 0 }, { part: 'engine' }), false, 'part with no cash');
  if (K.load('{nope') !== null || K.load({ v: 1, model: 'nightjar' }) !== null) fail('load took junk');
}

// the no-soft-lock case: broke, wrecked and out of everything, last in every race
{
  let C = { ...K.newCareer({ seed: 99 }), cash: 0, hp: 0, ammo: 0, mines: 0, turbo: 0 };
  const rnd = rngOf(5);
  const start = C.cash;
  for (let i = 0; i < 10; i++) {
    const o = K.offers(C)[0];
    const res = race(K.entrants(C, o), o, 0.4, rnd).map(r => (r.id === K.PLAYER ? { ...r, place: 4, wrecked: true, finished: false, hp: 0, cash: 0, kills: 0 } : r));
    res.sort((a, b) => a.place - b.place).forEach((r, k) => (r.id === K.PLAYER ? null : (r.place = k + 1)));
    const s = K.settle(C, o, res);
    if (s.C.hp <= 0) fail('wrecked car not patched');
    C = s.C;
  }
  const S = K.shop(C);
  console.log(`\nbroke + wrecked + empty, last in 10 easy races: ${$(C.cash - start)} earned, car patched to ${C.hp}/${C.maxHp} hp, can buy ammo ${S.supplies.find(s => s.kind === 'ammo').can}, repair ${S.supplies.find(s => s.kind === 'repair').can}`);
}

const all = Object.values(results).flat();
console.log(`\n${all.filter(r => r.champ == null).length} of ${all.length} careers without the title in ${LIMIT} races (still racing and earning: not locked); ${failures} rule failures`);
process.exit(failures ? 1 : 0);
