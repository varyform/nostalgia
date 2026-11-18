// Computer players. A brain plays one tank's turn as a stream of commands (so its barrel
// visibly swings and its power gauge climbs before it fires), and shops between rounds.
//
//   Rookie   guesses: a flat-ground formula, no wind, big wobble
//   Gunner   traces real arcs but ignores wind; walks its shots in from where the last one fell
//   Veteran  traces arcs with the wind; small wobble
//   Ace      searches the arc exactly, wind and hills included; picks its weapon for the job
//
// Personas set what a computer buys and fires: brute (big blasts), pyro (fire), trickster
// (skips, splits, seekers, beams), turtle (shields and repairs), miser (saves its cash).
//
//   const brain = createBrain(sim, { seed, speed });  each aim step: sim.step(brain.step())
//   aiShop(sim, playerIndex, rand)
import { DT, G, VMAX, maxPower } from './sim.js';
import { GOOD, ITEMS, MAX_STOCK, WEAPON } from './weapons.js';

const NOISE = { 1: [7, 0.16], 2: [1.6, 0.035], 3: [0.7, 0.014], 4: [0.12, 0.003] };
const ARC_STEP = { 1: 0, 2: 6, 3: 4, 4: 3 };
const LIKES = {
  brute: { thumper: 3, sunburst: 3, daybreak: 2, mortar: 2, buckler: 1, aegis: 1, glider: 1, excavator: 0.4 },
  pyro: { wildfire: 4, inferno: 3, firecracker: 2, mortar: 1, buckler: 1, glider: 1 },
  trickster: { skipstone: 2, hailstorm: 3, seeker: 3, boulder: 2, lance: 2, auger: 1, blink: 1, ion: 1 },
  turtle: { buckler: 2, aegis: 3, bastion: 2, patch: 3, glider: 2, mortar: 2, thumper: 1 },
  miser: { mortar: 3, buckler: 1, patch: 1, thumper: 0.5 },
};
const SPEND = { brute: 0.85, pyro: 0.85, trickster: 0.85, turtle: 0.8, miser: 0.35 };
const STOCK_CAP = 10;

function gauss(rand) { return (rand() + rand() + rand() + rand() - 2) * 1.22; }

export function createBrain(sim, { seed = 1, speed = 1 } = {}) {
  let s = seed >>> 0;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  let plan = null, thinker = null, turnKey = '', waitT = 0;
  const memory = new Map(); // tank → { target, offset }

  function step() {
    const t = sim.tank, key = sim.round + ':' + sim.turns + ':' + sim.current;
    if (key !== turnKey) { turnKey = key; plan = null; thinker = think(t); waitT = 0; }
    if (!plan) {
      const r = thinker.next();
      if (r.done) plan = r.value;
      return {};
    }
    if (plan.uses.length) return { use: plan.uses.shift() };
    if (t.weapon !== plan.weapon) return { weapon: plan.weapon };
    const out = {};
    const da = plan.angle - t.angle, dp = plan.power - t.power;
    const ra = 110 * speed * DT, rp = 900 * speed * DT;
    if (Math.abs(da) > 0.01) out.angle = t.angle + Math.max(-ra, Math.min(ra, da));
    if (Math.abs(dp) > 0.5) out.power = t.power + Math.max(-rp, Math.min(rp, dp));
    if (out.angle == null && out.power == null) {
      waitT += DT * speed;
      if (waitT > 0.3) out.fire = true;
    }
    return out;
  }

  function* think(t) {
    const P = sim.players[t.p], lvl = P.ai || 2, inv = P.inv;
    const enemies = sim.tanks.filter(o => o.alive && o.hp > 0 && o !== t);
    const uses = [];
    // gear first
    const shields = ITEMS.filter(i => i.kind === 'shield' && inv[i.id] > 0).sort((a, b) => b.hp - a.hp);
    if (shields.length && (!t.shield || t.shield.hp < shields[0].hp * 0.4) && (P.persona === 'turtle' || lvl >= 3 || rand() < 0.45)) uses.push(shields[0].id);
    if (inv.patch > 0 && t.hp <= 55) uses.push('patch');
    if (!enemies.length) return { uses, weapon: 'pellet', angle: t.angle, power: t.power };
    // a target
    let target;
    const mem = memory.get(t.i);
    if (lvl === 1) target = enemies[Math.floor(rand() * enemies.length)];
    else if (P.persona === 'brute') target = enemies.reduce((a, b) => (b.hp < a.hp ? b : a));
    else if (mem && enemies.includes(sim.tanks[mem.target]) && rand() < 0.8) target = sim.tanks[mem.target];
    else target = enemies.reduce((a, b) => (Math.abs(b.x - t.x) < Math.abs(a.x - t.x) ? b : a));
    const dist = Math.hypot(target.x - t.x, target.y - t.y);
    const weapon = chooseWeapon(t, P, lvl, dist, target);
    const w = WEAPON[weapon];
    const maxP = maxPower({ hp: Math.min(100, t.hp + (uses.includes('patch') ? 35 : 0)) });
    let angle, power;
    if (w.kind === 'beam') {
      angle = (Math.atan2(-(target.y - 6 - (t.y - 10)), target.x - t.x) * 180) / Math.PI;
      if (angle < 0) angle = target.x > t.x ? 0 : 180;
      power = Math.min(maxP, Math.max(80, (dist - 220) / 1.4 + 80));
    } else if (lvl === 1) {
      const right = target.x >= t.x, a = 35 + rand() * 35, rad = (a * Math.PI) / 180;
      const range = Math.max(30, Math.abs(target.x - t.x));
      const v = Math.sqrt((G * range) / Math.sin(2 * rad));
      angle = right ? a : 180 - a;
      power = Math.min(maxP, (v / VMAX) * 1000);
    } else {
      // walk the aim point by the remembered miss (the Gunner learns the wind this way)
      let off = 0;
      if (mem && mem.target === target.i && lvl <= 3) off = mem.offset;
      const tx = target.x - off * (lvl === 2 ? 0.85 : 0.5), ty = target.y - 6;
      const best = yield* search(t, target, tx, ty, lvl, maxP, w);
      angle = best.angle; power = best.power;
    }
    const [sa, sp] = NOISE[lvl] ?? NOISE[2];
    angle = Math.max(0, Math.min(180, angle + gauss(rand) * sa));
    power = Math.max(40, Math.min(maxP, power * (1 + gauss(rand) * sp)));
    memory.set(t.i, { target: target.i, offset: mem?.target === target.i ? mem.offset : 0, pending: true });
    return { uses, weapon, angle, power };
  }

  /** Try arcs on the real ballistics (wind only for Veteran and Ace); best by miss distance. */
  function* search(t, target, tx, ty, lvl, maxP, w) {
    const right = tx >= t.x, step = ARC_STEP[lvl], wind = lvl >= 3;
    const angles = [];
    for (let a = 14; a <= 86; a += step) angles.push(right ? a : 180 - a);
    // straight up and over, for a target close by or a tank in a pit
    angles.push(right ? 88 : 92);
    let best = { angle: right ? 55 : 125, power: maxP * 0.6, err: Infinity };
    const score = (a, pw) => {
      const r = sim.predict(t.i, a, pw, { wind });
      let err = Math.hypot(r.x - tx, r.y - ty);
      if (r.type === 'tank' && r.tank === target.i) err = Math.min(err, 2);
      if (r.type === 'gone' || r.type === 'timeout') err += 2000;
      const self = Math.hypot(r.x - t.x, r.y - (t.y - 6));
      if ((r.type === 'tank' || r.type === 'shield') && r.tank === t.i) err += 5000;
      else if (self < (w.r ?? 15) + 18) err += 3000;
      return { r, err };
    };
    const tryAngle = a => {
      let lo = 40, hi = maxP, top = null;
      for (let k = 0; k < 13; k++) {
        const pw = (lo + hi) / 2, { r, err } = score(a, pw);
        if (!top || err < top.err) top = { angle: a, power: pw, err };
        const ahead = right ? r.x - tx : tx - r.x;
        if (r.type === 'gone' || r.type === 'timeout') hi = pw;
        else if (ahead < 0) lo = pw;
        else hi = pw;
      }
      return top;
    };
    const found = [];
    for (const a of angles) {
      const r = tryAngle(a);
      found.push(r);
      if (r.err < best.err) best = r;
      yield;
    }
    if (lvl >= 4 && best.err > 3) {
      for (const d of [-2, -1.25, -0.6, 0.6, 1.25, 2]) {
        const r = tryAngle(Math.max(1, Math.min(179, best.angle + d)));
        found.push(r);
        if (r.err < best.err) best = r;
        yield;
      }
    }
    // of the arcs that land close, the one a small wobble spoils least (not one grazing a ridge)
    if (lvl >= 2) {
      const close = found.filter(r => r.err < best.err + 25).sort((a, b) => a.err - b.err).slice(0, 7);
      let top = null;
      for (const c of close) {
        let sum = c.err;
        for (const [da, dp] of [[0.7, 0], [-0.7, 0], [0, 0.012], [0, -0.012]]) sum += score(c.angle + da, Math.min(maxP, c.power * (1 + dp))).err;
        if (!top || sum < top.sum) top = { ...c, sum };
      }
      yield;
      if (top) best = top;
    }
    return best;
  }

  function chooseWeapon(t, P, lvl, dist, tgt) {
    const inv = P.inv, likes = LIKES[P.persona] ?? {};
    // a beam cannot point below the horizon: only for a target level with the barrel or above it
    const safe = w => (w.kind === 'beam' ? tgt.y - 6 <= t.y - 10 + 4 : w.kind === 'seek' || dist > (w.r ?? 15) + 34 + (w.big ? 30 : 0));
    const owned = Object.keys(inv).filter(id => inv[id] > 0 && WEAPON[id] && WEAPON[id].kind !== 'dirt' && id !== 'excavator').map(id => WEAPON[id]).filter(safe);
    if (!owned.length) return 'pellet';
    if (lvl >= 4) return owned.reduce((a, b) => (b.dmg * (1 + b.r / 60) > a.dmg * (1 + a.r / 60) ? b : a)).id;
    if (P.persona === 'miser' && rand() < 0.6) return 'pellet';
    let sum = 0;
    const weights = owned.map(w => { const k = (likes[w.id] ?? 0.5) + 0.2; sum += k; return k; });
    let r = rand() * (sum + 0.8); // some chance of saving it all for later
    for (let i = 0; i < owned.length; i++) if ((r -= weights[i]) < 0) return owned[i].id;
    return 'pellet';
  }

  /** After a shot: remember how far it fell from the mark (by the shooter's own aim point). */
  function observe(t) {
    const m = memory.get(t.i), imp = t.lastShot?.impact;
    if (!m?.pending || !imp) return;
    m.pending = false;
    const tgt = sim.tanks[m.target];
    if (!tgt?.alive) { memory.delete(t.i); return; }
    if (imp.tank === tgt.i) { m.offset *= 0.5; return; }
    m.offset += imp.x - tgt.x;
    m.offset = Math.max(-400, Math.min(400, m.offset));
  }
  function newRound() { memory.clear(); turnKey = ''; }

  return { step, observe, newRound, get planned() { return plan; } };
}

/** Buy for a computer player: what its persona likes, within its budget. */
export function aiShop(sim, pi, rand) {
  const P = sim.players[pi], likes = LIKES[P.persona] ?? LIKES.brute;
  const budget = P.cash * (SPEND[P.persona] ?? 0.8);
  const floor = P.cash - budget;
  const want = { ...likes };
  if (!(P.inv.glider > 0)) want.glider = (want.glider ?? 0) + 1.5;
  for (let k = 0; k < 30; k++) {
    const ok = Object.keys(want).filter(id => {
      const g = GOOD[id];
      return g && P.cash - g.price >= floor && (P.inv[id] ?? 0) < STOCK_CAP && (P.inv[id] ?? 0) + g.qty <= MAX_STOCK;
    });
    if (!ok.length) break;
    let sum = 0;
    for (const id of ok) sum += want[id];
    let r = rand() * sum, id = ok[0];
    for (const o of ok) if ((r -= want[o]) < 0) { id = o; break; }
    sim.buy(pi, id);
  }
}

