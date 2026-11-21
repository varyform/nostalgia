// Scorch's career: the money, the garage and the ladder between races. Pure and deterministic,
// no DOM, and nothing here mutates a career: every call hands back a new one. All chance (the
// offers, the other rivals' results) comes from seeds derived from the career's seed and race
// count, so a career replays exactly and offers() asked twice gives the same three races.
//
//   let C = newCareer({ seed: 7, name: 'ACE' });
//   const [o] = offers(C);                       // three races to pick from (or the final, at #1)
//   const race = createRace({ track, laps: o.laps, seed, cars: entrants(C, o) });
//   ({ C, report } = settle(C, o, race.result()));
//   ({ C } = buy(C, { supply: 'repair' }));      // the garage: { car } | { part } | { supply }
//
// Money is tight on purpose at first: a race in the Dustpan pays about what a full repair and a
// load of ammo cost, so the first cars are bought by winning, not by turning up. A wreck is
// still paid 4th money and towed back patched to a quarter armour, so a broke driver in a burnt
// car can always race again and earn (no soft lock). tools/career.mjs plays it all out.
import { TRACKS } from './tracks.js';

export const PLAYER = 'you'; // the player's id in entrants() and race.result()
export const CHAMPION = 'marrow';
export const PARTS = ['engine', 'tyres', 'armour'];
export const SUPPLIES = ['repair', 'ammo', 'mines', 'turbo'];

// Each part level scales the model's base stats: engine → top speed, pull and turbo kick;
// tyres → grip and turn-in; armour → hit points, and the weight and ramming that come with it.
export const UPGRADE = {
  engine: { top: 0.035, accel: 0.06, turboPower: 0.05 }, // × base per level
  tyres: { grip: 0.05 /* + per level */, turn: 0.05 },
  armour: { hp: 0.2, mass: 0.03, ram: 0.06 },
};

// The garage. price: what it costs new (null: not for sale). parts: the price of a level-1 part,
// ×level for the higher ones (× PART_COST by part). caps: supplies it carries. fix: $ per hp.
export const MODELS = [
  {
    id: 'dustpan',
    name: 'Dustpan',
    blurb: 'A rust-eaten hatchback with a roof gun welded on. Starts most mornings.',
    price: 3000,
    base: { accel: 9, top: 30, grip: 1.0, turn: 2.6, mass: 900, hp: 100, gun: 2, rate: 6, ram: 1.0, turboPower: 10 },
    max: { engine: 3, tyres: 3, armour: 3 },
    parts: 400,
    caps: { ammo: 150, mines: 2, turbo: 2 },
    fix: 5,
  },
  {
    id: 'mongrel',
    name: 'Mongrel',
    blurb: 'A flatbed ute on farm tyres, plated in road signs. Shrugs off a pile-up.',
    price: 9000,
    base: { accel: 9.5, top: 33, grip: 1.0, turn: 2.45, mass: 1300, hp: 160, gun: 2.5, rate: 7, ram: 1.25, turboPower: 11 },
    max: { engine: 4, tyres: 3, armour: 4 },
    parts: 700,
    caps: { ammo: 200, mines: 4, turbo: 2 },
    fix: 7,
  },
  {
    id: 'kestrel',
    name: 'Kestrel',
    blurb: 'A low wedge of a coupe, twin guns in the nose. Wins on the bends, dies in the bumps.',
    price: 17000,
    base: { accel: 12, top: 36.5, grip: 1.12, turn: 2.9, mass: 950, hp: 130, gun: 2.5, rate: 10, ram: 0.95, turboPower: 13 },
    max: { engine: 4, tyres: 4, armour: 3 },
    parts: 1300,
    caps: { ammo: 260, mines: 3, turbo: 3 },
    fix: 10,
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    blurb: 'Two tonnes of plated muscle with a ram blade. The road gets out of its way.',
    price: 30000,
    base: { accel: 12, top: 39, grip: 1.08, turn: 2.7, mass: 1500, hp: 220, gun: 3.5, rate: 9, ram: 1.4, turboPower: 14 },
    max: { engine: 3, tyres: 3, armour: 4 },
    parts: 2000,
    caps: { ammo: 340, mines: 5, turbo: 4 },
    fix: 12,
  },
  {
    id: 'nightjar',
    name: 'Nightjar',
    blurb: "Ivo Marrow's black interceptor. Nobody has seen it from the front for long.",
    price: null,
    base: { accel: 15, top: 44, grip: 1.3, turn: 3.0, mass: 1400, hp: 400, gun: 4.5, rate: 11, ram: 1.5, turboPower: 18 },
    max: { engine: 0, tyres: 0, armour: 0 },
    parts: 0,
    caps: { ammo: 420, mines: 6, turbo: 5 },
    fix: 20,
  },
];
const PART_COST = { engine: 1.2, tyres: 0.8, armour: 1.0 };
const MODEL = Object.fromEntries(MODELS.map(m => [m.id, m]));

// The ladder, best first as the season opens, then the champion. `up` is the rival's part levels.
export const DRIVERS = [
  { id: 'quint', name: 'Sable Quint', tag: 'The Undertaker', colour: '#d23a2e', skill: 0.82, aggression: 0.75, model: 'bulwark', up: { engine: 1, tyres: 1, armour: 1 } },
  { id: 'harrow', name: 'Dace Harrow', tag: 'Twice Buried', colour: '#2f7fe0', skill: 0.79, aggression: 0.6, model: 'bulwark', up: { engine: 0, tyres: 1, armour: 0 } },
  { id: 'vex', name: 'Juno Vex', tag: 'The Needle', colour: '#e8e2d0', skill: 0.76, aggression: 0.45, model: 'kestrel', up: { engine: 3, tyres: 3, armour: 1 } },
  { id: 'calloway', name: 'Rook Calloway', tag: 'Gravedigger', colour: '#7a4bd0', skill: 0.73, aggression: 0.85, model: 'kestrel', up: { engine: 1, tyres: 1, armour: 2 } },
  { id: 'grue', name: 'Tamsin Grue', tag: 'Cold Feet', colour: '#3fc6c0', skill: 0.7, aggression: 0.4, model: 'kestrel', up: { engine: 0, tyres: 1, armour: 0 } },
  { id: 'okafor', name: 'Bram Okafor', tag: 'The Anvil', colour: '#e07b25', skill: 0.66, aggression: 0.7, model: 'mongrel', up: { engine: 3, tyres: 2, armour: 3 } },
  { id: 'dunmore', name: 'Lark Dunmore', tag: 'Sunday Driver', colour: '#e65aa0', skill: 0.62, aggression: 0.3, model: 'mongrel', up: { engine: 1, tyres: 1, armour: 1 } },
  { id: 'rask', name: 'Esko Rask', tag: 'Ice Pick', colour: '#9fd8ff', skill: 0.58, aggression: 0.55, model: 'mongrel', up: { engine: 0, tyres: 0, armour: 1 } },
  { id: 'varga', name: 'Pell Varga', tag: 'Loose Change', colour: '#c9b23a', skill: 0.54, aggression: 0.65, model: 'dustpan', up: { engine: 3, tyres: 2, armour: 2 } },
  { id: 'wicks', name: 'Nan Wicks', tag: 'Match Head', colour: '#ff4f3a', skill: 0.49, aggression: 0.8, model: 'dustpan', up: { engine: 2, tyres: 1, armour: 2 } },
  { id: 'sallow', name: 'Clem Sallow', tag: 'The Scarecrow', colour: '#8fbf4a', skill: 0.44, aggression: 0.5, model: 'dustpan', up: { engine: 1, tyres: 1, armour: 0 } },
  { id: 'pocket', name: 'Gus Pocket', tag: 'Small Fry', colour: '#b98a5e', skill: 0.38, aggression: 0.35, model: 'dustpan', up: { engine: 0, tyres: 0, armour: 0 } },
  { id: CHAMPION, name: 'Ivo Marrow', tag: 'The Champion', colour: '#121216', skill: 0.84, aggression: 0.7, model: 'nightjar', up: { engine: 0, tyres: 0, armour: 0 } },
];
const DRIVER = Object.fromEntries(DRIVERS.map(d => [d.id, d]));
const RIVALS = DRIVERS.filter(d => d.id !== CHAMPION);
const START_POINTS = [24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2]; // by the ladder above

// The purses. Prizes are scaled up by how high the rivals in the race stand (purse()); points
// are not. The final's points are what losing to Marrow costs you: often your place at #1, so
// you race your way back to him. Rivals score nothing in the final.
export const TIERS = {
  easy: { prizes: [1000, 600, 300, 120], points: [2, 1, 0, 0], kill: 150, laps: 0 },
  mid: { prizes: [1500, 900, 450, 180], points: [3, 2, 1, 0], kill: 300, laps: 0 },
  hard: { prizes: [2000, 1200, 600, 240], points: [6, 3, 1, 0], kill: 500, laps: 1 },
  final: { prizes: [40000, 5000, 3000, 1500], points: [0, -3, -4, -5], kill: 2000, laps: 2 },
};
export const PRICE = {
  ammo: { step: 25, each: 2 }, // $ per round, sold in belts of 25
  mines: { step: 1, each: 250 },
  turbo: { step: 1, each: 200 },
  sellBack: 0.5, // supplies, parts and a traded-in car fetch half what they cost
  patch: 0.25, // a car comes back from a race with at least this share of its armour
};
const START = { cash: 1500, ammo: 100, mines: 0, turbo: 1 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r2 = v => Math.round(v * 100) / 100;
const money = v => Math.round(v / 50) * 50;

// a seeded mulberry32 stream from a few integers (career seed, race count, purpose)
function rngOf(...keys) {
  let h = 0x811c9dc5;
  for (const k of keys) h = Math.imul(h ^ (k | 0), 0x01000193) ^ (h >>> 13);
  let s = h | 0;
  return () => {
    let t = (s = (s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickN(rnd, list, n) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export function modelOf(id) {
  return MODEL[id] ?? MODELS[0];
}
export function driverOf(id) {
  return DRIVER[id] ?? null;
}

export function carStats(model, up = {}) {
  const M = typeof model === 'string' ? modelOf(model) : model;
  const b = M.base;
  const e = clamp(up.engine | 0, 0, M.max.engine), t = clamp(up.tyres | 0, 0, M.max.tyres), a = clamp(up.armour | 0, 0, M.max.armour);
  const U = UPGRADE;
  return {
    accel: r2(b.accel * (1 + U.engine.accel * e)),
    top: r2(b.top * (1 + U.engine.top * e)),
    grip: r2(b.grip + U.tyres.grip * t),
    turn: r2(b.turn * (1 + U.tyres.turn * t)),
    mass: Math.round(b.mass * (1 + U.armour.mass * a)),
    hp: Math.round(b.hp * (1 + U.armour.hp * a)),
    gun: b.gun,
    rate: b.rate,
    ram: r2(b.ram * (1 + U.armour.ram * a)),
    turboPower: r2(b.turboPower * (1 + U.engine.turboPower * e)),
  };
}

export function newCareer({ seed = 1, name = 'YOU', colour = '#f2c230' } = {}) {
  const M = MODELS[0];
  const hp = carStats(M, {}).hp;
  const C = {
    v: 1, seed: seed | 0, name: String(name).slice(0, 12), colour,
    cash: START.cash, model: M.id, up: { engine: 0, tyres: 0, armour: 0 }, paid: 0 /* on this car's parts */,
    hp, maxHp: hp, ammo: START.ammo, mines: START.mines, turbo: START.turbo,
    races: 0, wins: 0, kills: 0, earned: 0, finals: 0, champion: false, last: null /* track raced last */,
    points: 0, rank: 0, rivals: Object.fromEntries(RIVALS.map((d, i) => [d.id, START_POINTS[i]])),
  };
  return { ...C, rank: rankOf(C) };
}

// the ladder: rivals keep their place on equal points (you have to pass them, not draw level)
function ladder(C) {
  const rows = RIVALS.map((d, i) => ({ id: d.id, points: C.rivals[d.id] ?? 0, order: i }));
  rows.push({ id: PLAYER, points: C.points, order: 99 });
  return rows.sort((a, b) => b.points - a.points || a.order - b.order);
}
function rankOf(C) {
  return ladder(C).findIndex(r => r.id === PLAYER) + 1;
}
export function standings(C) {
  return ladder(C).map((r, i) => {
    const d = DRIVER[r.id];
    return {
      id: r.id, rank: i + 1, points: r.points, you: r.id === PLAYER,
      name: d ? d.name : C.name, colour: d ? d.colour : C.colour, tag: d ? d.tag : '', model: d ? d.model : C.model,
    };
  });
}

// Prize money grows with the standing of the field (pos: a rival's place on the ladder, 0 =
// the top): a race among the top four pays about six times one among the bottom four.
function purse(tier, rivals, pos) {
  const T = TIERS[tier];
  const mean = rivals.reduce((s, id) => s + (pos[id] ?? 11), 0) / rivals.length;
  const f = 1.25 ** (10 - mean);
  return T.prizes.map(p => money(p * f));
}
// the final runs at night in the city, on the last city track (raced in the season too)
function finalTrack() {
  return TRACKS.findLast(t => t.theme === 'city') ?? TRACKS[TRACKS.length - 1];
}
function trackFor(rnd, used) {
  const free = TRACKS.filter(t => !used.includes(t.id));
  return (free.length ? free : TRACKS)[Math.floor(rnd() * (free.length || TRACKS.length))];
}
function offer(C, tier, track, rivals, pos) {
  const T = TIERS[tier];
  return {
    id: `r${C.races + 1}-${tier}`, tier, track: track.id, laps: (track.laps ?? 3) + T.laps,
    rivals, prizes: tier === 'final' ? [...T.prizes] : purse(tier, rivals, pos), points: [...T.points], kill: T.kill,
  };
}

// Three races a round, by the rivals' standing around yours: easy among those below you (or the
// bottom of the ladder), mid around you, hard above you, always with the driver just ahead of
// you. At #1 only the final is on: Marrow and the two drivers behind you.
export function offers(C) {
  if (C.champion) return [];
  const rows = ladder(C);
  const me = rows.findIndex(r => r.id === PLAYER);
  const above = rows.slice(0, me).map(r => r.id);
  const rivals = rows.filter(r => r.id !== PLAYER).map(r => r.id);
  const pos = Object.fromEntries(rivals.map((id, i) => [id, i]));
  const rnd = rngOf(C.seed, C.races, 1);
  const last = finalTrack();
  if (me === 0) return [offer(C, 'final', last, [CHAMPION, rivals[0], rivals[1]])];
  const window = start => rivals.slice(start, start + 4);
  const pools = { easy: window(clamp(me, 0, 8)), mid: window(clamp(me - 2, 0, 7)), hard: window(clamp(me - 4, 0, 5)) };
  const used = [C.last];
  return ['easy', 'mid', 'hard'].map(tier => {
    let field = pickN(rnd, pools[tier], 3);
    const next = above[above.length - 1];
    if (tier === 'hard' && pools.hard.includes(next) && !field.includes(next)) field = [next, ...pickN(rnd, pools[tier].filter(id => id !== next), 2)];
    const track = trackFor(rnd, used);
    used.push(track.id);
    return offer(C, tier, track, field, pos);
  });
}

function rivalCar(d) {
  const M = modelOf(d.model);
  const stats = carStats(M, d.up);
  return {
    id: d.id, name: d.name, colour: d.colour, model: d.model, stats, hp: stats.hp,
    ammo: M.caps.ammo, mines: Math.round(M.caps.mines * (0.3 + 0.7 * d.aggression)), turbo: M.caps.turbo,
    ai: { skill: d.skill, aggression: d.aggression },
  };
}
export function entrants(C, o) {
  const you = {
    id: PLAYER, name: C.name, colour: C.colour, model: C.model, stats: carStats(C.model, C.up),
    hp: C.hp, ammo: C.ammo, mines: C.mines, turbo: C.turbo, ai: null,
  };
  return [you, ...o.rivals.map(id => rivalCar(DRIVER[id]))];
}

export function repairCost(C, hp = C.maxHp - C.hp) {
  return Math.ceil(Math.max(0, hp) * modelOf(C.model).fix);
}

// The rest of the ladder races too, out of sight: the rivals not in your race, in threes by
// standing, each three in a race of its own about one round in three (the top three for mid
// points, the rest for easy ones), placed by skill, car and luck. It keeps the ladder moving
// under you without running away from you.
function elsewhere(C, busy, rnd) {
  const out = {};
  const idle = ladder(C).filter(r => r.id !== PLAYER && !busy.includes(r.id)).map(r => r.id);
  const tiers = ['mid', 'easy', 'easy', 'easy'];
  for (let g = 0; g * 3 < idle.length; g++) {
    if (rnd() > 0.3) continue;
    const pts = TIERS[tiers[Math.min(g, 3)]].points;
    const field = idle.slice(g * 3, g * 3 + 3).map(id => ({ id, perf: power(DRIVER[id]) * (1 + 0.15 * gauss(rnd)) }));
    field.push({ id: null, perf: field.reduce((s, f) => s + f.perf, 0) / field.length });
    field.sort((a, b) => b.perf - a.perf).forEach((f, place) => f.id && (out[f.id] = pts[place]));
  }
  return out;
}
function power(d) {
  const s = carStats(d.model, d.up);
  return (0.45 * s.top / 30 + 0.2 * s.accel / 9 + 0.2 * s.grip + 0.15 * Math.sqrt(s.hp / 100)) * (0.6 + 0.5 * d.skill);
}
function gauss(rnd) {
  return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
}

export function settle(C, o, result) {
  const me = result.find(r => r.id === PLAYER) ?? result[0];
  const place = clamp(me.place | 0 || result.length, 1, 4);
  const tier = TIERS[o.tier] ?? TIERS.easy;
  const prize = o.prizes[place - 1] ?? 0;
  const picked = Math.max(0, Math.round(me.cash ?? 0));
  const kills = Math.max(0, me.kills | 0);
  const bonus = kills * (o.kill ?? tier.kill);
  const won = o.tier === 'final' && place === 1 && !me.wrecked;
  const M = modelOf(C.model);
  const floor = Math.ceil(C.maxHp * PRICE.patch);
  const left = clamp(Math.round(me.hp ?? 0), 0, C.maxHp);
  const hp = Math.max(left, floor);

  const rivals = { ...C.rivals };
  if (o.tier !== 'final') for (const r of result) if (r.id in rivals) rivals[r.id] += o.points[r.place - 1] ?? 0;
  const away = elsewhere(C, o.rivals, rngOf(C.seed, C.races, 2));
  for (const id in away) rivals[id] += away[id];
  const points = Math.max(0, C.points + (o.points[place - 1] ?? 0));
  const gain = prize + picked + bonus;

  const before = standings(C);
  const next = {
    ...C, rivals, points,
    cash: C.cash + gain, earned: C.earned + gain,
    hp, ammo: clamp(me.ammo | 0, 0, M.caps.ammo), mines: clamp(me.mines | 0, 0, M.caps.mines), turbo: clamp(me.turbo | 0, 0, M.caps.turbo),
    last: o.track, races: C.races + 1, wins: C.wins + (place === 1 ? 1 : 0), kills: C.kills + kills,
    finals: C.finals + (o.tier === 'final' ? 1 : 0), champion: C.champion || won,
  };
  next.rank = rankOf(next);
  const report = {
    place, prize, picked, wrecked: !!me.wrecked, kills, bonus, gain,
    pointsBefore: C.points, pointsAfter: points, rankBefore: C.rank, rankAfter: next.rank,
    repair: repairCost(next), patched: left < floor, won, tier: o.tier, track: o.track,
    before, after: standings(next),
  };
  return { C: next, report };
}

// the car's worth as a trade-in: half its price and half what went into its parts, less half
// the cost of fixing it (so a wreck isn't swapped for a new car at full value)
export function tradeIn(C) {
  return Math.max(0, money(((modelOf(C.model).price ?? 0) + C.paid - repairCost(C)) * PRICE.sellBack));
}
export function partPrice(model, part, level) {
  const M = typeof model === 'string' ? modelOf(model) : model;
  return money(M.parts * PART_COST[part] * (0.5 + 0.5 * level));
}
function supplyRow(C, kind) {
  const M = modelOf(C.model);
  if (kind === 'repair') {
    const missing = C.maxHp - C.hp;
    return { kind, have: C.hp, max: C.maxHp, price: repairCost(C), step: missing, can: missing > 0 && C.cash >= M.fix };
  }
  const max = M.caps[kind], step = Math.min(PRICE[kind].step, max - C[kind]);
  const price = step * PRICE[kind].each;
  return { kind, have: C[kind], max, price, step, can: step > 0 && C.cash >= price };
}
export function shop(C) {
  const M = modelOf(C.model);
  const worth = tradeIn(C);
  return {
    cars: MODELS.filter(m => m.price != null).map(m => {
      const owned = m.id === C.model;
      return { id: m.id, name: m.name, blurb: m.blurb, price: m.price, net: m.price - worth, owned, can: !owned && C.cash + worth >= m.price, stats: carStats(m, {}) };
    }),
    tradeIn: worth,
    parts: PARTS.map(part => {
      const level = C.up[part], max = M.max[part];
      const price = level < max ? partPrice(M, part, level + 1) : null;
      return { part, level, max, price, can: price != null && C.cash >= price, stats: carStats(M, { ...C.up, [part]: Math.min(max, level + 1) }) };
    }),
    supplies: SUPPLIES.map(kind => supplyRow(C, kind)),
  };
}

const no = (C, why) => ({ ok: false, C, why });
export function buy(C, what) {
  const M = modelOf(C.model);
  if (what.car) {
    const N = MODEL[what.car];
    if (!N || N.price == null) return no(C, 'Not for sale');
    if (N.id === C.model) return no(C, 'Already yours');
    const cash = C.cash + tradeIn(C) - N.price;
    if (cash < 0) return no(C, 'Not enough cash');
    const hp = carStats(N, {}).hp;
    // supplies move over to the new car, up to what it carries; it comes off the lot unhurt
    return {
      ok: true, why: null,
      C: { ...C, cash, model: N.id, up: { engine: 0, tyres: 0, armour: 0 }, paid: 0, hp, maxHp: hp, ammo: Math.min(C.ammo, N.caps.ammo), mines: Math.min(C.mines, N.caps.mines), turbo: Math.min(C.turbo, N.caps.turbo) },
    };
  }
  if (what.part) {
    const part = what.part, level = C.up[part];
    if (!PARTS.includes(part)) return no(C, 'No such part');
    if (level >= M.max[part]) return no(C, 'Fully upgraded');
    const price = partPrice(M, part, level + 1);
    if (C.cash < price) return no(C, 'Not enough cash');
    const up = { ...C.up, [part]: level + 1 };
    const maxHp = carStats(M, up).hp;
    // new plating goes on whole: the armour gained is armour you have
    return { ok: true, why: null, C: { ...C, cash: C.cash - price, paid: C.paid + price, up, maxHp, hp: C.hp + maxHp - C.maxHp } };
  }
  if (what.supply) {
    const kind = what.supply;
    if (!SUPPLIES.includes(kind)) return no(C, 'No such thing');
    if (kind === 'repair') {
      // as much as the cash runs to, so a broke driver can still patch a little
      const hp = Math.min(C.maxHp - C.hp, Math.floor(C.cash / M.fix));
      if (C.hp >= C.maxHp) return no(C, 'No damage');
      if (hp <= 0) return no(C, 'Not enough cash');
      return { ok: true, why: null, C: { ...C, hp: C.hp + hp, cash: C.cash - repairCost(C, hp) } };
    }
    const row = supplyRow(C, kind);
    if (row.step <= 0) return no(C, 'Full');
    if (C.cash < row.price) return no(C, 'Not enough cash');
    return { ok: true, why: null, C: { ...C, cash: C.cash - row.price, [kind]: C[kind] + row.step } };
  }
  return no(C, 'Nothing to buy');
}

// Sell back a belt of ammo, a mine or a turbo charge, or take off a part's top level, at half price.
// The car itself only goes as a trade-in (buy({ car })): you always have one to race.
export function sell(C, what) {
  const M = modelOf(C.model);
  if (what.supply && what.supply !== 'repair') {
    const kind = what.supply;
    if (!(kind in PRICE) || !SUPPLIES.includes(kind)) return no(C, 'No such thing');
    const n = Math.min(C[kind], PRICE[kind].step);
    if (n <= 0) return no(C, 'Nothing to sell');
    return { ok: true, why: null, C: { ...C, [kind]: C[kind] - n, cash: C.cash + Math.floor(n * PRICE[kind].each * PRICE.sellBack) } };
  }
  if (what.part) {
    const part = what.part, level = C.up[part];
    if (!PARTS.includes(part) || !(level > 0)) return no(C, 'Nothing to sell');
    const price = partPrice(M, part, level);
    const up = { ...C.up, [part]: level - 1 };
    const maxHp = carStats(M, up).hp;
    const back = money(price * PRICE.sellBack);
    return { ok: true, why: null, C: { ...C, cash: C.cash + back, paid: Math.max(0, C.paid - price), up, maxHp, hp: Math.min(C.hp, maxHp) } };
  }
  if (what.car) return no(C, 'Trade it in for another');
  return no(C, 'Nothing to sell');
}

// the autosave's label: "Rank 7 · $12,400" ("Unranked" before the first point)
export function label(C) {
  return `${C.points > 0 ? `Rank ${C.rank}` : 'Unranked'} · $${C.cash.toLocaleString('en-US')}`;
}

export function save(C) {
  return JSON.parse(JSON.stringify(C));
}
export function load(json) {
  try {
    const j = typeof json === 'string' ? JSON.parse(json) : json;
    if (!j || j.v !== 1 || !MODEL[j.model] || MODEL[j.model].price == null) return null;
    const num = k => (Number.isFinite(j[k]) ? j[k] : 0);
    const M = MODEL[j.model];
    const up = Object.fromEntries(PARTS.map(p => [p, clamp(j.up?.[p] | 0, 0, M.max[p])]));
    const maxHp = carStats(M, up).hp;
    const C = {
      v: 1, seed: j.seed | 0, name: String(j.name ?? 'YOU').slice(0, 12), colour: typeof j.colour === 'string' ? j.colour : '#f2c230',
      cash: Math.max(0, Math.round(num('cash'))), model: M.id, up, paid: Math.max(0, num('paid')),
      hp: clamp(Math.round(num('hp')), 1, maxHp), maxHp,
      ammo: clamp(num('ammo') | 0, 0, M.caps.ammo), mines: clamp(num('mines') | 0, 0, M.caps.mines), turbo: clamp(num('turbo') | 0, 0, M.caps.turbo),
      races: num('races') | 0, wins: num('wins') | 0, kills: num('kills') | 0, earned: num('earned'), finals: num('finals') | 0,
      champion: !!j.champion, last: typeof j.last === 'string' ? j.last : null, points: Math.max(0, num('points')), rank: 0,
      rivals: Object.fromEntries(RIVALS.map((d, i) => [d.id, Number.isFinite(j.rivals?.[d.id]) ? j.rivals[d.id] : START_POINTS[i]])),
    };
    return { ...C, rank: rankOf(C) };
  } catch {
    return null;
  }
}
