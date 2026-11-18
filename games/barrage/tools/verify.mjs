// Headless checks on the real sim and AI:
//   1. --matches N  AI-vs-AI matches fast-forwarded over every land, wall, wind and player count,
//      with every weapon and item forced into use: no exceptions, no NaN, every turn resolves in
//      bounded time, no tank inside the ground, cash and stock never negative, shop sums add up;
//   2. --aim N      each AI level fires N shots at a still target (fresh field each shot, no memory),
//      and again N shots in strings of five at one target (the memory walks shots in): hit rates.
//
//   mise exec -- node games/barrage/tools/verify.mjs [--matches 200] [--aim 120] [--seed 1]
import { aiShop, createBrain } from '../src/ai.js';
import { DT, H, MAX_FLIGHT, TANK_BOX, TANK_HW, WALLS, WIND_LEVELS, createSim, rng } from '../src/sim.js';
import { LANDS } from '../src/terrain.js';
import { GOOD, GOODS, ITEMS, WEAPONS, unitRefund } from '../src/weapons.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const MATCHES = opt('--matches', 200), AIM = opt('--aim', 120), SEED = opt('--seed', 1);
let bad = 0;
const fail = (id, msg) => { if (bad++ < 40) console.log(`  ✗ ${id}: ${msg}`); };
const finite = v => typeof v === 'number' && Number.isFinite(v);

// ---------- 1. matches ----------
function checkState(sim, id) {
  for (const t of sim.tanks) {
    for (const k of ['x', 'y', 'hp', 'angle', 'power', 'vy']) if (!finite(t[k])) fail(id, `tank ${t.i} ${k} = ${t[k]}`);
    if (t.y > H + 0.01 || t.x < 0 || t.x > 1280) fail(id, `tank ${t.i} out of the field at ${t.x},${t.y}`);
  }
  for (const p of sim.projectiles) if (!finite(p.x) || !finite(p.y) || !finite(p.vx) || !finite(p.vy)) fail(id, `projectile ${p.w} NaN`);
  for (const f of sim.flames) if (!finite(f.x) || !finite(f.y)) fail(id, 'flame NaN');
  for (const p of sim.players) {
    if (!finite(p.cash) || p.cash < 0) fail(id, `${p.name} cash ${p.cash}`);
    for (const [k, v] of Object.entries(p.inv)) if (!Number.isInteger(v) || v < 0) fail(id, `${p.name} ${k} stock ${v}`);
  }
}
function buriedCells(sim, t) {
  let n = 0;
  const x = Math.round(t.x), y = Math.round(t.y);
  for (let c = x - TANK_HW + 3; c <= x + TANK_HW - 3; c++) for (let r = y - TANK_BOX + 2; r < y - 1; r++) if (sim.terrain.solid(c, r)) n++;
  return n;
}
const used = new Set(), stats = { turns: 0, rounds: 0, maxFlight: 0, steps: 0, cap: 0 };
const t0 = Date.now();
const R = rng(SEED);
for (let m = 0; m < MATCHES; m++) {
  const n = 2 + Math.floor(R() * 7);
  const setup = {
    players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i, color: i, ai: 1 + Math.floor(R() * 4) })),
    rounds: 2, wind: m % WIND_LEVELS.length, shifting: R() < 0.5, walls: WALLS[m % WALLS.length],
    land: LANDS[Math.floor(m / 4) % LANDS.length], cash: [0, 20000, 100000][m % 3], interest: m % 2 ? 5 : 0,
  };
  const id = `match ${m} (${n} tanks, ${setup.land}, ${setup.walls}, wind ${setup.wind})`;
  const sim = createSim({ seed: SEED * 1000 + m });
  try {
    sim.newMatch(setup);
    const brain = createBrain(sim, { seed: m + 1, speed: 4 });
    // forced stock: every player carries some of everything, and fires it in turn
    const order = [...WEAPONS.map(w => w.id), ...ITEMS.map(i => i.id)];
    let forced = m % order.length;
    for (;;) {
      if (sim.phase === 'match') break;
      if (sim.phase === 'round') {
        stats.rounds++;
        for (const p of sim.players) {
          const before = p.cash, inv = { ...p.inv };
          aiShop(sim, p.i, R);
          let spent = 0;
          for (const g of GOODS) spent += (((p.inv[g.id] ?? 0) - (inv[g.id] ?? 0)) / g.qty) * g.price;
          if (Math.abs(before - p.cash - spent) > 0.01) fail(id, `shop sums: ${before} - ${p.cash} ≠ ${spent}`);
          // a sell round trip refunds half
          const g = GOOD.mortar, had = p.inv.mortar ?? 0, c0 = p.cash;
          if (sim.buy(p.i, 'mortar')) {
            for (let k = 0; k < g.qty; k++) sim.sell(p.i, 'mortar');
            if (p.inv.mortar !== had || p.cash !== c0 - g.price + g.qty * unitRefund(g)) fail(id, 'buy/sell round trip');
          }
          if (sim.sell(p.i, 'nonsense') || sim.buy(p.i, 'pellet')) fail(id, 'sold or bought something not in the shop');
        }
        brain.newRound();
        sim.nextRound();
        continue;
      }
      // one turn
      const t = sim.tank, k = order[forced++ % order.length];
      const inv = sim.players[t.p].inv;
      inv[k] = Math.max(inv[k] ?? 0, 2);
      let steps = 0, plannedSet = false, tried = false;
      const turns0 = sim.turns, round0 = sim.round;
      while (sim.phase === 'aim' && steps < 60 * 60) {
        let cmd = brain.step();
        const plan = brain.planned;
        if (plan && !plannedSet) {
          plannedSet = true;
          if (GOOD[k]?.kind && ITEMS.some(i => i.id === k)) { if (!['glider', 'fuel'].includes(k)) plan.uses.push(k); }
          else plan.weapon = k;
        }
        // a little driving now and then
        if (plan && !tried && ITEMS.some(i => i.id === k) && k === 'fuel') { tried = true; for (let d = 0; d < 40; d++) sim.step({ drive: m % 2 ? 1 : -1 }); }
        sim.step(cmd);
        steps++;
        if (sim.phase === 'flight') used.add(t.weapon === 'pellet' && k !== 'pellet' ? 'pellet' : k);
      }
      if (sim.phase === 'aim') { fail(id, `turn never fired (tank ${t.i})`); break; }
      let f = 0;
      while (sim.phase === 'flight' && f < 60 * (MAX_FLIGHT + 15)) {
        sim.step({});
        f++;
        if (f % 30 === 0) checkState(sim, id);
        sim.events.length = 0;
      }
      stats.steps += steps + f;
      stats.maxFlight = Math.max(stats.maxFlight, f * DT);
      if (sim.phase === 'flight') { fail(id, `flight never settled (${sim.projectiles.length} rounds, ${sim.flames.length} flames, settling ${sim.terrain.settling()})`); break; }
      if (sim.round === round0 && sim.phase === 'aim' && sim.turns !== turns0 + 1) fail(id, 'turn counter skipped');
      if (sim.flightT > MAX_FLIGHT) stats.cap++;
      for (const o of sim.tanks) if (!o.exploded && !o.falling && buriedCells(sim, o) > 0) fail(id, `tank ${o.i} inside the ground (${buriedCells(sim, o)} cells)`);
      brain.observe(t);
      checkState(sim, id);
      stats.turns++;
      sim.events.length = 0;
    }
    const sum = sim.players.reduce((a, p) => a + p.stats.wins, 0);
    if (sum > setup.rounds) fail(id, `more wins (${sum}) than rounds`);
  } catch (e) {
    fail(id, e.stack.split('\n').slice(0, 3).join(' | '));
  }
}
const missing = [...WEAPONS.map(w => w.id), ...ITEMS.map(i => i.id)].filter(k => !used.has(k) && !['glider', 'fuel', 'buckler', 'aegis', 'bastion', 'patch', 'blink'].includes(k));
if (MATCHES && missing.length) fail('coverage', `never fired: ${missing.join(', ')}`);
console.log(`matches: ${MATCHES}, rounds ${stats.rounds}, turns ${stats.turns}, longest aftermath ${stats.maxFlight.toFixed(1)} s, capped ${stats.cap}, ${((Date.now() - t0) / 1000).toFixed(1)} s wall`);

// ---------- 2. aim ----------
function aimTrial(level, shots, string) {
  let hits = 0, near = 0, total = 0;
  for (let k = 0; k < shots / string; k++) {
    const sim = createSim({ seed: 7000 + k * 13 + level });
    sim.newMatch({
      players: [{ name: 'A', color: 0, ai: level, persona: 'miser' }, { name: 'T', color: 1, ai: 0 }],
      rounds: 99, wind: 1 + (k % 3), shifting: false, walls: 'open', land: LANDS[k % LANDS.length], cash: 0, interest: 0,
    });
    const brain = createBrain(sim, { seed: k + 1, speed: 8 });
    const tgt = sim.tanks[1];
    for (let s = 0; s < string; s++) {
      tgt.hp = 100000;
      sim.current = 0; sim.phase = 'aim'; sim.turns++;
      sim.tanks[0].weapon = 'pellet';
      let n = 0;
      while (sim.phase === 'aim' && n++ < 3600) sim.step(brain.step());
      while (sim.phase === 'flight') { sim.step({}); sim.events.length = 0; }
      brain.observe(sim.tanks[0]);
      const imp = sim.tanks[0].lastShot?.impact;
      total++;
      if (tgt.hp < 100000) hits++;
      if (imp && Math.hypot(imp.x - tgt.x, imp.y - tgt.y) < 40) near++;
      if (!tgt.alive || sim.phase !== 'aim') break;
    }
  }
  return { hits, near, total };
}
if (AIM > 0) {
  for (const [lvl, name] of [[1, 'Rookie'], [2, 'Gunner'], [3, 'Veteran'], [4, 'Ace']]) {
    const a = aimTrial(lvl, AIM, 1), b = aimTrial(lvl, AIM, 5);
    console.log(`${name.padEnd(8)} first shot ${((100 * a.hits) / a.total).toFixed(0).padStart(3)}% hit  |  five at one target ${((100 * b.hits) / b.total).toFixed(0).padStart(3)}% hit`);
  }
}
console.log(bad ? `${bad} problem(s)` : 'all good');
process.exit(bad ? 1 : 0);
