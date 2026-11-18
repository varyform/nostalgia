// The match, deterministic and screen-free: players with cash and stock, rounds on a fresh
// battlefield, tanks taking turns, and everything a shot sets off (blasts, falling earth,
// burning gel, rollers, drills, beams, falling tanks, chain explosions). One step() is DT of
// game time; what happened comes out as `events` for the renderer and the sound.
//
//   const sim = createSim({ seed });
//   sim.newMatch(setup);              // also starts round 1
//   sim.step({ angle, power, weapon, use, drive, fire });   // commands for the tank whose turn it is
//   sim.phase: 'aim' | 'flight' | 'round' (round over) | 'match' (match over)
//   sim.nextRound();  sim.buy(p, id);  sim.sell(p, id);  sim.predict(tank, angle, power, { wind })
import { H, LANDS, W, createTerrain, generate } from './terrain.js';
import { GOOD, ITEM, MAX_STOCK, WEAPON, unitRefund } from './weapons.js';

export { W, H };
export const DT = 1 / 60;
export const G = 380;            // gravity, cells / s²
export const VMAX = 900;         // muzzle speed at power 1000, cells / s
export const WIND_ACC = 2.6;     // cells / s² per point of wind
export const TANK_HW = 13, TANK_BOX = 13, BARREL = 15, PIVOT = 10, SHIELD_R = 26, HIT_R = 10;
export const THEMES = ['dusk', 'night', 'desert', 'arctic', 'meadow', 'xeno', 'ash'];
export const WALLS = ['open', 'wrap', 'rubber', 'concrete'];
export const WIND_LEVELS = [0, 10, 25, 50];
export const AI_LEVELS = ['Human', 'Rookie', 'Gunner', 'Veteran', 'Ace'];
export const PERSONAS = ['brute', 'pyro', 'trickster', 'turtle', 'miser'];
export const MAX_TURNS = 60;      // per round: then the healthiest tank takes it
export const MAX_FLIGHT = 30;     // seconds a shot's aftermath may last before it is called
const PAY = { dmg: 20, kill: 2500, selfKill: 1500, win: 4000, round: 1000, interestCap: 5000 };
export const PAYS = PAY;

export const maxPower = t => Math.round(300 + 7 * Math.max(0, t.hp));
export const DEFAULT_SETUP = {
  players: [
    { name: 'Player 1', color: 0, ai: 0 },
    { name: 'Marlow', color: 1, ai: 2 },
  ],
  rounds: 5, wind: 2, shifting: true, walls: 'random', land: 'mixed', cash: 15000, interest: 5,
};

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSim({ seed = 1 } = {}) {
  let rand = rng(seed);
  const terrain = createTerrain();
  const events = [];
  const S = {
    terrain, events, players: [], tanks: [], setup: null,
    round: 0, phase: 'aim', phaseT: 0, t: 0, turns: 0, order: [], turnPos: 0, current: 0,
    wind: 0, walls: 'open', land: 'hills', theme: 0, sea: 0,
    projectiles: [], blasts: [], flames: [], beams: [],
    flightT: 0, quietT: 0, winner: -1, roundLog: null, nextId: 1,
    newMatch, nextRound, step, buy, sell, predict, has, reseed, busy, shotFrom,
    get tank() { return S.tanks[S.current]; },
  };
  function reseed(s) { rand = rng(s); }
  const ev = e => { events.push(e); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = a => a[Math.floor(rand() * a.length)];

  // ---------- match & rounds ----------
  function newMatch(setup) {
    S.setup = { ...setup, players: setup.players.map(p => ({ ...p })) };
    S.players = S.setup.players.map((p, i) => ({
      i, name: p.name, color: p.color, ai: p.ai | 0,
      persona: p.persona ?? (p.ai ? pick(PERSONAS) : null),
      cash: Math.max(0, setup.cash | 0), inv: {},
      stats: { wins: 0, kills: 0, deaths: 0, dmg: 0, shots: 0, hits: 0, earned: 0 },
      roundStart: 0,
    }));
    S.round = 0;
    startRound();
  }
  function nextRound() {
    if (S.round >= S.setup.rounds) { S.phase = 'match'; return; }
    startRound();
  }
  function startRound() {
    S.round++;
    const n = S.players.length;
    S.theme = Math.floor(rand() * THEMES.length);
    S.land = S.setup.land === 'mixed' || !LANDS.includes(S.setup.land) ? pick(LANDS) : S.setup.land;
    S.walls = WALLS.includes(S.setup.walls) ? S.setup.walls : pick(WALLS);
    const wmax = WIND_LEVELS[S.setup.wind] ?? 0;
    S.wind = Math.round((rand() * 2 - 1) * wmax);
    // tank slots spread across the field, players shuffled into them
    const span = (W - 120) / n, slots = [];
    for (let k = 0; k < n; k++) slots.push(Math.round(60 + span * (k + 0.5) + (rand() - 0.5) * span * 0.4));
    const heights = generate(rand, S.land, slots);
    terrain.shape(heights);
    S.sea = S.land === 'islands' ? 600 : 0;
    const seats = S.players.map((_, i) => i);
    for (let k = n - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [seats[k], seats[j]] = [seats[j], seats[k]]; }
    S.tanks = S.players.map((p, i) => {
      const x = slots[seats.indexOf(i)];
      let y = H;
      for (let c = x - TANK_HW + 2; c <= x + TANK_HW - 2; c++) y = Math.min(y, terrain.top(c));
      return {
        i, p: i, x, y, angle: x < W / 2 ? 60 : 120, power: 480, hp: 100, alive: true, exploded: false,
        shield: null, falling: false, gliding: false, vy: 0, fallFrom: 0, fuel: 0, weapon: 'pellet',
        lastHit: -1, blinked: false, burn: 0, shots: 0, lastShot: null,
      };
    });
    for (const p of S.players) p.roundStart = p.cash;
    S.order = seats.slice();
    for (let k = n - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [S.order[k], S.order[j]] = [S.order[j], S.order[k]]; }
    S.projectiles = []; S.blasts = []; S.flames = []; S.beams = [];
    S.turns = 0; S.turnPos = 0; S.current = S.order[0]; S.winner = -1; S.roundLog = null;
    S.phase = 'aim'; S.phaseT = 0;
    ev({ type: 'round', round: S.round });
    ev({ type: 'turn', tank: S.current });
  }
  function nextTurn() {
    const n = S.order.length;
    for (let k = 1; k <= n; k++) {
      const i = S.order[(S.turnPos + k) % n];
      if (S.tanks[i].alive) { S.turnPos = (S.turnPos + k) % n; S.current = i; break; }
    }
    if (S.setup.shifting) {
      const wmax = WIND_LEVELS[S.setup.wind] ?? 0, d = Math.round((rand() * 2 - 1) * wmax * 0.25);
      S.wind = clamp(S.wind + d, -wmax, wmax);
    }
    const t = S.tank;
    t.blinked = false;
    t.power = Math.min(t.power, maxPower(t));
    if (!has(t, t.weapon)) t.weapon = 'pellet';
    S.turns++;
    S.phase = 'aim'; S.phaseT = 0;
    ev({ type: 'turn', tank: S.current });
  }
  function finishRound() {
    const alive = S.tanks.filter(t => t.alive);
    let win = alive.length === 1 ? alive[0] : null;
    if (!win && alive.length > 1) win = alive.reduce((a, b) => (b.hp > a.hp ? b : a));
    S.winner = win ? win.i : -1;
    if (win) { const p = S.players[win.p]; p.stats.wins++; earn(p, PAY.win, win); }
    for (const p of S.players) {
      earn(p, PAY.round);
      if (S.setup.interest > 0) p.cash += Math.min(PAY.interestCap, Math.floor((p.cash * S.setup.interest) / 100));
    }
    S.roundLog = S.players.map(p => ({ earned: p.cash - p.roundStart }));
    S.phase = S.round >= S.setup.rounds ? 'match' : 'round';
    S.phaseT = 0;
    ev({ type: 'roundOver', winner: S.winner, last: S.phase === 'match' });
  }
  function earn(p, amount, tank) {
    if (!amount) return;
    p.cash = Math.max(0, p.cash + amount);
    if (amount > 0) p.stats.earned += amount;
    if (tank) ev({ type: 'cash', player: p.i, amount, x: tank.x, y: tank.y - 30 });
  }

  // ---------- shop ----------
  function has(t, id) { return id === 'pellet' || (S.players[t.p].inv[id] ?? 0) > 0; }
  function buy(pi, id) {
    const p = S.players[pi], g = GOOD[id];
    if (!g || p.cash < g.price || (p.inv[id] ?? 0) + g.qty > MAX_STOCK) return false;
    p.cash -= g.price;
    p.inv[id] = (p.inv[id] ?? 0) + g.qty;
    return true;
  }
  function sell(pi, id) {
    const p = S.players[pi], g = GOOD[id];
    if (!g || !(p.inv[id] > 0)) return false;
    p.inv[id]--;
    p.cash += unitRefund(g);
    return true;
  }

  // ---------- one step ----------
  function step(cmd = {}) {
    S.t += DT; S.phaseT += DT;
    if (S.phase === 'round' || S.phase === 'match') return;
    if (terrain.step()) for (const t of S.tanks) if (!t.exploded && !t.falling) clearBox(t);
    stepTanks();
    if (S.phase === 'aim') {
      const t = S.tank;
      if (t?.alive && !t.falling) command(t, cmd);
      return;
    }
    // flight: everything the shot set off, until all is still
    S.flightT += DT;
    stepProjectiles();
    stepBlasts();
    stepFlames();
    for (const b of S.beams) b.t += DT;
    S.beams = S.beams.filter(b => b.t < b.life);
    if (S.flightT > MAX_FLIGHT) { S.projectiles = []; S.flames = []; }
    if (busy()) { S.quietT = 0; return; }
    S.quietT += DT;
    if (S.quietT < 0.35) return;
    const doomed = S.tanks.find(t => t.hp <= 0 && !t.exploded);
    if (doomed) { explodeTank(doomed); S.quietT = 0; return; }
    const alive = S.tanks.filter(t => t.alive).length;
    if (alive <= 1 || S.turns >= MAX_TURNS) finishRound();
    else nextTurn();
  }
  function busy() {
    return S.projectiles.length > 0 || S.blasts.length > 0 || S.flames.length > 0 || S.beams.length > 0
      || terrain.settling() || S.tanks.some(t => !t.exploded && t.falling);
  }

  function command(t, c) {
    if (c.angle != null && Number.isFinite(c.angle)) t.angle = clamp(c.angle, 0, 180);
    if (c.power != null && Number.isFinite(c.power)) t.power = clamp(Math.round(c.power), 0, maxPower(t));
    if (c.weapon && WEAPON[c.weapon] && has(t, c.weapon)) t.weapon = c.weapon;
    if (c.use) useItem(t, c.use);
    if (c.drive) drive(t, Math.sign(c.drive));
    if (c.fire) fire(t);
  }

  // ---------- gear ----------
  function useItem(t, id) {
    const p = S.players[t.p], it = ITEM[id];
    if (!it || !(p.inv[id] > 0)) return false;
    const deny = () => { ev({ type: 'denied', tank: t.i }); return false; };
    switch (it.kind) {
      case 'shield':
        if (t.shield && t.shield.hp >= it.hp) return deny();
        t.shield = { id, hp: it.hp, max: it.hp };
        ev({ type: 'shieldUp', tank: t.i, id });
        break;
      case 'patch':
        if (t.hp >= 100) return deny();
        t.hp = Math.min(100, t.hp + it.hp);
        ev({ type: 'patch', tank: t.i });
        break;
      case 'blink': {
        if (t.blinked) return deny();
        let x = t.x;
        for (let k = 0; k < 24; k++) {
          const c = Math.round(40 + rand() * (W - 80));
          if (S.tanks.every(o => o === t || o.exploded || Math.abs(o.x - c) > 44)) { x = c; break; }
        }
        const from = { x: t.x, y: t.y };
        t.x = x;
        t.y = H;
        for (let c = x - TANK_HW + 2; c <= x + TANK_HW - 2; c++) t.y = Math.min(t.y, terrain.top(c));
        t.blinked = true;
        clearBox(t);
        ev({ type: 'blink', tank: t.i, from, to: { x: t.x, y: t.y } });
        break;
      }
      default: return false; // gliders and fuel are used by themselves
    }
    p.inv[id]--;
    return true;
  }
  function drive(t, dir) {
    if (!dir || t.falling) return;
    const p = S.players[t.p];
    if (t.fuel <= 0) {
      if (!(p.inv.fuel > 0)) { if (S.phaseT > 0.1) ev({ type: 'nofuel', tank: t.i }); return; }
      p.inv.fuel--; t.fuel += ITEM.fuel.fuel;
      ev({ type: 'refuel', tank: t.i });
    }
    const nx = clamp(t.x + dir * 0.6, TANK_HW, W - 1 - TANK_HW);
    if (nx === t.x) return;
    let s = H;
    for (let c = Math.round(nx) - TANK_HW + 2; c <= Math.round(nx) + TANK_HW - 2; c++) s = Math.min(s, terrain.groundAt(c, t.y - 5));
    if (s < t.y - 3) { ev({ type: 'blocked', tank: t.i }); return; }
    const climb = Math.max(0, t.y - s);
    t.x = nx;
    if (s < t.y) t.y = s;
    t.fuel = Math.max(0, t.fuel - (0.6 + climb * 1.5));
    clearBox(t);
    ev({ type: 'drive', tank: t.i });
  }

  // ---------- tanks: boxes, falls, damage ----------
  // a tank's body keeps its space: earth that settles into it is pushed out (gone)
  function clearBox(t) {
    const x = Math.round(t.x), y = Math.round(t.y);
    for (let c = x - TANK_HW; c <= x + TANK_HW; c++) terrain.cut(c, y - TANK_BOX, y);
  }
  function support(t) {
    const x = Math.round(t.x);
    let s = H;
    for (let c = x - TANK_HW + 2; c <= x + TANK_HW - 2; c++) s = Math.min(s, terrain.groundAt(c, Math.round(t.y)));
    return s;
  }
  function stepTanks() {
    for (const t of S.tanks) {
      if (t.exploded) continue;
      const s = support(t);
      if (!t.falling) {
        if (s > t.y + 0.5) {
          t.falling = true; t.vy = 0; t.fallFrom = t.y;
          const p = S.players[t.p];
          if (s - t.y > 16 && p.inv.glider > 0) { p.inv.glider--; t.gliding = true; ev({ type: 'glider', tank: t.i }); }
        } else { t.y = s; continue; }
      }
      t.vy += G * DT;
      if (t.gliding) t.vy = Math.min(t.vy, 46);
      t.y = Math.min(s, t.y + t.vy * DT);
      if (t.y >= s) {
        const dist = t.y - t.fallFrom;
        t.falling = false; t.vy = 0;
        const dmg = t.gliding ? 0 : Math.max(0, Math.round((dist - 14) * 0.45));
        t.gliding = false;
        clearBox(t);
        ev({ type: 'land', tank: t.i, dist, dmg, x: t.x, y: t.y });
        if (dmg > 0 && t.hp > 0) hurt(t, dmg, t.lastHit, 'fall', true);
      }
    }
  }
  /** Damage after the shield; credits and charges the shooter's player. */
  function hurt(t, dmg, owner, cause, bare = false) {
    if (t.hp <= 0 || dmg <= 0) return 0;
    let d = Math.round(dmg);
    if (t.shield && !bare) {
      const a = Math.min(t.shield.hp, d);
      t.shield.hp -= a; d -= a;
      const down = t.shield.hp <= 0;
      if (down) t.shield = null;
      ev({ type: 'shield', tank: t.i, absorbed: a, down, cause, x: t.x, y: t.y - 6 });
    }
    if (d <= 0) return 0;
    const before = t.hp;
    t.hp = Math.max(0, t.hp - d);
    const dealt = before - t.hp;
    t.power = Math.min(t.power, maxPower(t));
    if (owner >= 0) t.lastHit = owner;
    ev({ type: 'hit', tank: t.i, dmg: dealt, x: t.x, y: t.y - 16, cause });
    const shooter = owner >= 0 ? S.tanks[owner] : null, sp = shooter ? S.players[shooter.p] : null;
    if (sp && shooter !== t) { sp.stats.dmg += dealt; earn(sp, dealt * PAY.dmg, shooter); }
    if (t.hp <= 0) {
      S.players[t.p].stats.deaths++;
      ev({ type: 'kill', tank: t.i, by: owner });
      if (sp && shooter !== t) { sp.stats.kills++; earn(sp, PAY.kill, shooter); }
      else if (sp) earn(sp, -PAY.selfKill, shooter);
    }
    return dealt;
  }
  function explodeTank(t) {
    t.exploded = true; t.alive = false; t.shield = null;
    ev({ type: 'death', tank: t.i, x: t.x, y: t.y - 6 });
    blast(t.x, t.y - 6, 40, 45, t.lastHit, 'death');
  }

  // ---------- firing ----------
  function shotFrom(t, angle, power) {
    const a = (angle * Math.PI) / 180, v = (power / 1000) * VMAX;
    return {
      x: t.x + Math.cos(a) * BARREL, y: t.y - PIVOT - Math.sin(a) * BARREL,
      vx: Math.cos(a) * v, vy: -Math.sin(a) * v, ax: 0, owner: t.i, out: false,
    };
  }
  function fire(t) {
    let w = WEAPON[t.weapon];
    if (!w || !has(t, w.id)) w = WEAPON.pellet;
    const p = S.players[t.p];
    if (w.id !== 'pellet') p.inv[w.id]--;
    p.stats.shots++; t.shots++;
    const s = shotFrom(t, t.angle, t.power);
    ev({ type: 'fire', tank: t.i, w: w.id, kind: w.kind, x: s.x, y: s.y, angle: t.angle, power: t.power });
    t.lastShot = { angle: t.angle, power: t.power, w: w.id, impact: null };
    if (w.kind === 'beam') beam(t, w);
    else S.projectiles.push({ ...s, id: S.nextId++, w: w.id, kind: w.kind, t: 0, gen: 0, hops: w.hops ?? 0, mode: 'fly', apex: false, sp: 0, dir: 1, left: 0 });
    if (!has(t, t.weapon)) t.weapon = 'pellet';
    S.phase = 'flight'; S.phaseT = 0; S.flightT = 0; S.quietT = 0;
  }

  /**
   * Move a round one step: gravity, wind, steering; walls; then the first thing it touches
   * along the way (in sub-steps of at most 1.5 cells). The AI's predict() runs the same code.
   */
  function advance(p, windAcc, live) {
    const nvx = p.vx + (windAcc + p.ax) * DT, nvy = p.vy + G * DT;
    let dx = ((p.vx + nvx) / 2) * DT;
    const dy = ((p.vy + nvy) / 2) * DT;
    p.vx = nvx; p.vy = nvy;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 1.5));
    for (let k = 0; k < n; k++) {
      let x = p.x + dx / n;
      const y = p.y + dy / n;
      if (x < 0 || x >= W) {
        if (S.walls === 'wrap') { x = (x + W) % W; if (live) ev({ type: 'wrap', x, y }); }
        else if (S.walls === 'rubber') {
          x = x < 0 ? -x : 2 * (W - 1) - x;
          dx = -dx; p.vx = -p.vx;
          if (live) ev({ type: 'bounce', x, y });
        } else if (S.walls === 'concrete') { p.x = clamp(x, 0, W - 1); p.y = y; return { type: 'wall' }; }
        else if (x < -700 || x > W + 700) { p.x = x; p.y = y; return { type: 'gone' }; }
      }
      p.x = x; p.y = y;
      if (y >= H) { p.y = H - 1; return { type: 'ground' }; }
      if (x < 0 || x >= W) continue;
      for (const t of S.tanks) {
        if (!t.alive) continue;
        const ddx = x - t.x, ddy = y - (t.y - 6), d2 = ddx * ddx + ddy * ddy;
        if (t.shield && (t.i !== p.owner || p.out) && d2 < SHIELD_R * SHIELD_R) return { type: 'shield', tank: t.i };
        if (d2 < HIT_R * HIT_R) return { type: 'tank', tank: t.i };
        if (t.i === p.owner && !p.out && d2 > (SHIELD_R + 3) * (SHIELD_R + 3)) p.out = true;
      }
      if (terrain.solid(x | 0, y | 0)) return { type: 'ground' };
    }
    return null;
  }
  /** Where a plain round fired now would land: { type, x, y, t, tank }. Never changes the match. */
  function predict(ti, angle, power, { wind = true, maxT = 14 } = {}) {
    const p = shotFrom(S.tanks[ti], angle, power), wa = wind ? S.wind * WIND_ACC : 0;
    for (let t = 0; t < maxT; t += DT) {
      const h = advance(p, wa, false);
      if (h) return { ...h, x: p.x, y: p.y, t };
    }
    return { type: 'timeout', x: p.x, y: p.y, t: maxT };
  }

  function stepProjectiles() {
    const wa = S.wind * WIND_ACC, list = S.projectiles, keep = [];
    S.projectiles = []; // splits and sparks born this step land here
    for (const p of list) {
      p.t += DT;
      let done = false;
      if (p.mode === 'roll') done = stepRoller(p);
      else if (p.mode === 'drill') done = stepDrill(p);
      else {
        if (p.kind === 'seek' && p.vy > 0) {
          const tgt = nearestEnemy(p.owner, p.x);
          p.ax = tgt ? clamp((tgt.x - p.x) * 3.2 - p.vx * 1.6, -420, 420) : 0;
        }
        const h = advance(p, wa, true);
        if (!p.apex && p.vy >= 0) {
          p.apex = true;
          if (p.kind === 'split' && p.gen === 0 && !h) { split(p); done = true; }
          else ev({ type: 'apex', id: p.id, x: p.x, y: p.y, w: p.w });
        }
        if (!done && h) done = impact(p, h);
        if (!done && p.t > 16) { done = true; blastFor(p, p.x, p.y); }
      }
      if (!done) keep.push(p);
    }
    S.projectiles = keep.concat(S.projectiles);
  }
  function nearestEnemy(owner, x) {
    let best = null, bd = Infinity;
    for (const t of S.tanks) {
      if (!t.alive || t.hp <= 0 || t.i === owner) continue;
      const d = Math.abs(t.x - x);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  const spawn = (from, o) => S.projectiles.push({ id: S.nextId++, w: from.w, kind: 'shell', t: 0, gen: from.gen + 1, hops: 0, mode: 'fly', ax: 0, owner: from.owner, out: true, apex: false, sp: 0, dir: 1, left: 0, ...o });
  function split(p) {
    const w = WEAPON[p.w];
    for (let k = 0; k < w.n; k++) spawn(p, { x: p.x, y: p.y, vx: p.vx + (k - (w.n - 1) / 2) * 46, vy: p.vy + 10, r: w.r, dmg: w.dmg });
    ev({ type: 'split', x: p.x, y: p.y, w: p.w });
  }
  function blastFor(p, x, y) {
    const w = WEAPON[p.w];
    if (p.r) { blast(x, y, p.r, p.dmg, p.owner, 'blast', p.w); return; }
    if (w.kind === 'ion') blast(x, y, w.r, w.dmg, p.owner, 'ion', w.id);
    else if (w.kind === 'dirt') heap(x, y, w.r, p.w);
    else blast(x, y, w.r, w.dmg, p.owner, 'blast', w.id);
  }
  /** What a round does when it touches something; true when it is spent. */
  function impact(p, h) {
    const w = WEAPON[p.w];
    if (h.type === 'gone') { ev({ type: 'lost', x: p.x, y: p.y }); return true; }
    const solidHit = h.type === 'ground';
    if (p.gen === 0) {
      const sh = S.tanks[p.owner]?.lastShot;
      if (sh && !sh.impact) sh.impact = { x: p.x, y: p.y, tank: h.tank ?? -1 };
    }
    if (h.tank != null && h.tank !== p.owner) S.players[S.tanks[p.owner].p].stats.hits++;
    if (p.gen > 0) { blastFor(p, p.x, p.y); return true; }
    switch (w.kind) {
      case 'skip':
        blast(p.x, p.y, w.r, w.dmg, p.owner, 'blast', w.id);
        if (solidHit && p.hops > 1) {
          p.hops--;
          let y = Math.round(p.y);
          while (y > 0 && terrain.solid(p.x | 0, y)) y--;
          p.y = y - 3;
          p.vy = -Math.max(150, Math.abs(p.vy) * 0.55); p.vx *= 0.8; p.apex = false;
          ev({ type: 'skip', x: p.x, y: p.y });
          return false;
        }
        return true;
      case 'burst':
        blast(p.x, p.y, w.r, w.dmg, p.owner, 'blast', w.id);
        for (let k = 0; k < w.n; k++) {
          const a = ((25 + rand() * 130) * Math.PI) / 180, v = 130 + rand() * 170;
          spawn(p, { x: p.x, y: p.y - 6, vx: Math.cos(a) * v, vy: -Math.sin(a) * v, r: w.sub.r, dmg: w.sub.dmg });
        }
        return true;
      case 'fire': {
        blast(p.x, p.y, w.r, w.dmg, p.owner, 'blast', w.id);
        for (let k = 0; k < w.n; k++)
          S.flames.push({ x: clamp(p.x + (rand() - 0.5) * 10, 1, W - 2), y: p.y - 6 - rand() * 6, vx: (rand() - 0.5) * 170 + p.vx * 0.15, vy: -rand() * 140, t: 0, life: 2.2 + rand() * 1.6, owner: p.owner });
        ev({ type: 'spill', x: p.x, y: p.y, n: w.n });
        return true;
      }
      case 'roll':
        if (solidHit) {
          p.mode = 'roll';
          const l = terrain.groundAt((p.x | 0) - 3, p.y - 12), r = terrain.groundAt((p.x | 0) + 3, p.y - 12);
          p.dir = Math.abs(p.vx) > 40 ? Math.sign(p.vx) : r > l ? 1 : -1;
          p.sp = clamp(Math.abs(p.vx) * 0.5, 50, 220);
          p.y = terrain.groundAt(p.x | 0, p.y - 12) - 1;
          p.rollT = 0;
          ev({ type: 'roll', x: p.x, y: p.y });
          return false;
        }
        blast(p.x, p.y, w.r, w.dmg, p.owner, 'blast', w.id);
        return true;
      case 'drill':
        if (solidHit && p.y < H - 2) {
          p.mode = 'drill';
          const v = Math.hypot(p.vx, p.vy) || 1;
          p.dx = p.vx / v; p.dy = p.vy / v; p.left = w.len;
          ev({ type: 'drill', x: p.x, y: p.y });
          return false;
        }
        blast(p.x, p.y, w.r, w.dmg, p.owner, 'blast', w.id);
        return true;
      default:
        blastFor(p, p.x, p.y);
        return true;
    }
  }
  function stepRoller(p) {
    const w = WEAPON[p.w];
    p.rollT += DT;
    const x = p.x | 0, here = terrain.groundAt(x, p.y - 10), ahead = terrain.groundAt(x + p.dir * 3, p.y - 10);
    const boom = () => { blast(p.x, p.y - 4, w.r, w.dmg, p.owner, 'blast', w.id); return true; };
    if (ahead < p.y - 9) return boom();
    p.sp += ((ahead - here) / 3) * 420 * DT - 36 * DT;
    p.sp = Math.min(p.sp, 300);
    if (p.sp <= 0 || p.rollT > 7) return boom();
    let nx = p.x + p.dir * p.sp * DT;
    if (nx < 0 || nx >= W) {
      if (S.walls === 'wrap') nx = (nx + W) % W;
      else if (S.walls === 'rubber') { p.dir = -p.dir; nx = clamp(nx, 0, W - 1); ev({ type: 'bounce', x: nx, y: p.y }); }
      else { p.x = clamp(nx, 0, W - 1); return boom(); }
    }
    const g = terrain.groundAt(nx | 0, p.y - 10);
    p.x = nx;
    if (g - p.y > 14) { // over a cliff edge: it flies again
      p.mode = 'fly'; p.vx = p.dir * p.sp; p.vy = 0; p.apex = true;
      return false;
    }
    p.y = g - 1;
    for (const t of S.tanks) if (t.alive && t.i !== p.owner && Math.abs(t.x - p.x) < TANK_HW + 3 && Math.abs(t.y - 6 - p.y) < 16) return boom();
    if (p.rollT > 0.6) for (const t of S.tanks) if (t.alive && t.i === p.owner && Math.abs(t.x - p.x) < TANK_HW + 3 && Math.abs(t.y - 6 - p.y) < 16) return boom();
    return false;
  }
  function stepDrill(p) {
    const w = WEAPON[p.w], v = 170 * DT;
    const boom = () => { blast(p.x, p.y, w.r, w.dmg, p.owner, 'blast', w.id); return true; };
    const n = Math.ceil(v / 2);
    for (let k = 0; k < n; k++) {
      p.x += (p.dx * v) / n; p.y += (p.dy * v) / n; p.left -= v / n;
      if (p.x < 0 || p.x >= W) {
        if (S.walls === 'wrap') p.x = (p.x + W) % W;
        else if (S.walls === 'rubber') { p.dx = -p.dx; p.x = clamp(p.x, 0, W - 1); }
        else { p.x = clamp(p.x, 0, W - 1); return boom(); }
      }
      if (p.y >= H - 1 || p.y < -50 || p.left <= 0) return boom();
      for (const t of S.tanks) if (t.alive && Math.hypot(t.x - p.x, t.y - 6 - p.y) < HIT_R + 2 && (t.i !== p.owner || p.t > 0.5)) return boom();
      terrain.carveCircle(p.x, p.y, 5);
    }
    return false;
  }
  function beam(t, w) {
    const a = (t.angle * Math.PI) / 180;
    let dx = Math.cos(a), dy = -Math.sin(a);
    let x = t.x + dx * BARREL, y = t.y - PIVOT + dy * BARREL;
    const pts = [{ x, y }], hit = new Set();
    let len = 220 + t.power * 1.4;
    while (len > 0) {
      x += dx * 2; y += dy * 2; len -= 2;
      if (x < 0 || x >= W) {
        if (S.walls === 'wrap') { pts.push({ x: clamp(x, 0, W - 1), y, cut: true }); x = (x + W) % W; pts.push({ x, y }); }
        else if (S.walls === 'rubber') { x = clamp(x, 0, W - 1); dx = -dx; pts.push({ x, y }); }
        else break;
      }
      if (y < -60 || y >= H) break;
      if (terrain.solid(x | 0, y | 0)) terrain.carveCircle(x, y, w.r);
      for (const o of S.tanks) {
        if (!o.alive || o === t || hit.has(o.i)) continue;
        const r = o.shield ? SHIELD_R : HIT_R + 2;
        if (Math.hypot(o.x - x, o.y - 6 - y) < r) { hit.add(o.i); S.players[t.p].stats.hits++; hurt(o, w.dmg, t.i, 'beam'); }
      }
    }
    pts.push({ x: clamp(x, -60, W + 60), y });
    t.lastShot = { angle: t.angle, power: t.power, w: w.id, impact: { x, y, tank: hit.size ? [...hit][0] : -1 } };
    S.beams.push({ pts, t: 0, life: 0.7, owner: t.i });
    ev({ type: 'beam', pts, tank: t.i });
  }

  // ---------- blasts ----------
  function blast(x, y, r, dmg, owner, kind = 'blast', w = '') {
    S.blasts.push({ x, y, r, dmg, owner, kind, t: 0, at: 0.03 + r / 900, done: false });
    ev({ type: 'boom', x, y, r, kind, w });
  }
  function heap(x, y, r, w) {
    const n = terrain.addCircle(x, y, r);
    for (const t of S.tanks) if (!t.exploded) clearBox(t);
    ev({ type: 'heap', x, y, r, n, w });
  }
  function stepBlasts() {
    for (const b of S.blasts) {
      b.t += DT;
      if (b.done || b.t < b.at) continue;
      b.done = true;
      const carve = b.kind === 'ion' ? 9 : b.r;
      const n = terrain.carveCircle(b.x, b.y, carve);
      if (n) ev({ type: 'dirt', x: b.x, y: b.y, r: carve, n });
      for (const t of S.tanks) {
        if (t.exploded) continue;
        const d = Math.hypot(t.x - b.x, t.y - 6 - b.y), reach = b.r + 8;
        if (d < reach + 24 && b.owner >= 0) t.lastHit = b.owner;
        if (d >= reach || !t.alive) continue;
        const k = 1 - Math.max(0, d - 5) / reach;
        hurt(t, Math.max(1, b.dmg * Math.pow(k, 0.9)), b.owner, b.kind);
      }
    }
    S.blasts = S.blasts.filter(b => !b.done || b.t < b.at + 0.12);
  }

  // ---------- burning gel ----------
  let burnTick = 0;
  function stepFlames() {
    if (!S.flames.length) return;
    const keep = [];
    for (const f of S.flames) {
      f.t += DT;
      if (f.t > f.life) continue;
      const gx = clamp(f.x | 0, 0, W - 1);
      if (terrain.solid(gx, (f.y | 0) - 1) && terrain.solid(gx, (f.y | 0) - 4)) continue; // buried: out
      const g = terrain.groundAt(gx, f.y | 0);
      if (f.y < g - 1.5) {
        f.vy += G * DT;
        f.y = Math.min(g - 1, f.y + f.vy * DT);
        f.x += f.vx * DT;
      } else {
        f.y = g - 1; f.vy = 0;
        const l = terrain.groundAt(gx - 2, f.y - 6), r = terrain.groundAt(gx + 2, f.y - 6);
        f.vx += ((r - l) / 4) * 260 * DT + (rand() - 0.5) * 24;
        f.vx *= 0.93;
        if ((f.vx > 0 && r < f.y - 5) || (f.vx < 0 && l < f.y - 5)) f.vx = 0;
        f.x += f.vx * DT;
      }
      if (f.x < 0 || f.x >= W) {
        if (S.walls === 'wrap') f.x = (f.x + W) % W;
        else { f.x = clamp(f.x, 0, W - 1); f.vx = 0; }
      }
      keep.push(f);
    }
    S.flames = keep;
    for (const t of S.tanks) {
      if (!t.alive) continue;
      let n = 0, owner = -1;
      for (const f of S.flames) if (Math.abs(f.x - t.x) < TANK_HW + 4 && f.y > t.y - 20 && f.y < t.y + 6) { n++; owner = f.owner; }
      if (!n) continue;
      t.burn += Math.min(n, 8) * 0.05;
      if (t.burn >= 1) { const d = Math.floor(t.burn); t.burn -= d; hurt(t, d, owner, 'fire'); }
    }
    if ((burnTick = (burnTick + 1) % 9) === 0) ev({ type: 'burn', n: S.flames.length });
  }

  return S;
}
