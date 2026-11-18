// Triform's simulation: rooms, physics, the three forms, enemies, bosses, puzzles.
//
// Everything is in world units: 1 unit = 1 tile, rooms are 40 × 23 tiles, time in seconds.
// No canvas, no DOM, no audio: the page, the demo and the Node playthrough all drive it with
// plain input snapshots, one per fixed step, and read its state to draw it. Things a renderer
// or the sound might want to react to are queued in `sim.events`.
//
//   const sim = createSim();
//   sim.newGame();
//   sim.step({ left, right, up, down, jump, attack, special, prev, next, form1, form2, form3 });
//   sim.p, sim.room, sim.events …
import { COLS, ROWS, ROOMS, roomAt, roomById } from './world.js';

export const DT = 1 / 60;
export const FORMS = ['android', 'raptor', 'tank'];

// sizes in tiles; speeds in tiles/s
export const BODY = {
  android: { w: 1.25, h: 2.75 },
  raptor: { w: 3.25, h: 3.5 },
  tank: { w: 3.25, h: 3.25 },
};
const A = { run: 10.5, accel: 112, air: 75, grav: 122, jump: 38.75, cut: 15, climb: 7.5 };
const R = { walk: 8.75, sprint: 21.25, accel: 75, sprintAccel: 32, grav: 137, jump: 31, leap: 22.5, leapGrav: 62, leapMin: 17.5 };
const K = { speed: 7.5, push: 4.5, accel: 50, grav: 150 };
const MAX_FALL = 50;
// armour per form: share of damage that gets through
const ARMOUR = { android: 1, raptor: 0.8, tank: 0.6 };

const SOLID = '#^~!BI%';
const HAZARD = '^~!';
const isDoor = c => c >= '1' && c <= '4';

export const UPGRADES = { blaster: 'android', flame: 'raptor', probe: 'tank' };
export const BOSS_NAMES = { crucible: 'THE CRUCIBLE', warden: 'CRYO WARDEN', sentinel: 'SENTINEL ARRAY', foreman: 'THE FOREMAN' };

const NO_INPUT = {
  left: false, right: false, up: false, down: false, jump: false, attack: false, special: false,
  prev: false, next: false, form1: false, form2: false, form3: false,
};

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = s => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const cx = o => o.x + o.w / 2;
const cy = o => o.y + o.h / 2;

export function createSim() {
  const s = {
    status: 'idle', // idle | play | dead | gameover | ending | victory
    t: 0, // game clock (play time)
    events: [],
    p: null,
    room: null,
    mem: {}, // per room: tiles, opened doors, taken pickups, boss beaten, visited
    upgrades: { blaster: false, flame: false, probe: false },
    check: null, // { room, x, y } feet position of the last checkpoint
    lives: 3, score: 0, deaths: 0, kills: 0,
    message: null, // { text, t }  upgrade / hint banners
    boss: null,
    newGame, startAt, resume, step, retryRoom, roomMem, tileAt,
  };
  const ev = (type, x = 0, y = 0, extra) => s.events.push({ type, x, y, ...extra });
  let prevIn = NO_INPUT;

  // ---------- rooms ----------
  function roomMem(id) {
    if (!s.mem[id]) {
      const def = roomById(id);
      s.mem[id] = { tiles: def.map.map(r => r.split('')), perm: new Set(), taken: new Set(), bossDead: false, visited: false, hinted: false, visits: 0 };
    }
    return s.mem[id];
  }

  function loadRoom(def) {
    const m = roomMem(def.id);
    m.visits++;
    const fresh = !m.visited;
    m.visited = true;
    const r = {
      def, id: def.id, zone: def.zone, col: def.col, row: def.row, name: def.name,
      tiles: m.tiles, mem: m, under: new Map(),
      doors: { 1: door(), 2: door(), 3: door(), 4: door() },
      ents: [], enemies: [], blocks: [], shots: [], eshots: [],
      rng: mulberry32(hash(def.id) + m.visits * 101),
      meltT: 0, t: 0, fieldT: 0, bossDyingT: 0,
      version: 0, // bumps when tiles change (renderers cache the static layer)
    };
    // doors on a ladder leave a ladder behind when they open
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (isDoor(r.tiles[y][x])) {
          const up = r.tiles[y - 1]?.[x], dn = r.tiles[y + 1]?.[x];
          r.under.set(y * COLS + x, up === 'H' || dn === 'H' ? 'H' : '.');
        }
    for (const g of m.perm) r.doors[g].open = r.doors[g].anim = 1;
    s.room = r;
    s.boss = null;
    def.ents.forEach((e, i) => spawn(r, e, i));
    if (fresh && def.hint) s.message = { text: def.hint, t: 6 };
    ev('room', 0, 0, { id: def.id });
    return r;
  }
  function door() { return { open: 0, hold: false, anim: 0 }; }

  function spawn(r, [kind, tx, ty, o = {}], i) {
    const m = r.mem, foot = ty + 1;
    const ent = (w, h, extra) => ({ kind, i, x: tx, y: foot - h, w, h, flash: 0, ...extra });
    switch (kind) {
      case 'start': return;
      case 'check': r.ents.push(ent(1.5, 2.25, {})); return;
      case 'energy': if (!m.taken.has(i)) r.ents.push(ent(1, 1, { amount: 30, persist: true })); return;
      case 'upgrade': if (!s.upgrades[o.kind]) r.ents.push(ent(1.5, 1.5, { up: o.kind })); return;
      case 'switch': r.ents.push(ent(1, 1.25, { door: o.door, armored: !!o.armored, on: m.perm.has(o.door) })); return;
      case 'plate': r.ents.push(ent(2, 0.25, { door: o.door, pressed: false })); return;
      case 'gen': r.ents.push(ent(1.25, 1.25, { down: false })); return;
      case 'core': r.ents.push(ent(1.5, 2.5, { need: o.need, encased: !!o.encased, hp: o.need === 'probe' ? 1 : o.need === 'shell' ? 4 : 3, broken: false })); return;
      case 'block': r.blocks.push({ kind, x: tx, y: foot - 2, w: 2, h: 2, vy: 0, ground: true }); return;
      case 'boss': if (!m.bossDead) s.boss = makeBoss(o.kind, tx, foot, o); return;
      default: r.enemies.push(makeEnemy(kind, tx, foot, o));
    }
  }

  // effective tile: doors read as wall when shut and as what's under them when open
  function tileAt(x, y) {
    const r = s.room;
    if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return null;
    const c = r.tiles[y][x];
    if (isDoor(c)) return r.doors[c].open ? r.under.get(y * COLS + x) : 'D';
    return c;
  }
  const isLadder = (x, y) => tileAt(x, y) === 'H';
  // who: 'body' (player, enemies, blocks), 'probe', 'shot', 'eshot'
  function solid(x, y, who) {
    const c = tileAt(x, y);
    if (c === null) {
      // outside: walls, except where the map continues (player only) or below (falls out)
      if (who !== 'player') return y >= 0 && y < ROWS ? true : y < 0;
      return false;
    }
    if (c === 'D') {
      if (who === 'eshot' && s.room.tiles[y][x] === '4') return false; // a boss shoots through its own field
      return true;
    }
    if (c === '%') return who !== 'probe';
    return SOLID.includes(c);
  }
  function rectFree(x, y, w, h, who, self, oneWayFrom) {
    const x0 = Math.floor(x), x1 = Math.floor(x + w - 1e-6), y0 = Math.floor(y), y1 = Math.floor(y + h - 1e-6);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        if (solid(tx, ty, who)) return false;
        if (oneWayFrom !== undefined && ty >= oneWayFrom - 1e-4 && ty === y1 && oneWay(tx, ty)) return false;
      }
    if (who === 'player' || who === 'block' || who === 'body') {
      for (const b of s.room.blocks) if (b !== self && x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return false;
    }
    return true;
  }
  function oneWay(tx, ty) {
    const c = tileAt(tx, ty);
    if (c === '=') return true;
    return c === 'H' && tileAt(tx, ty - 1) !== 'H';
  }

  // ---------- movement ----------
  // move along one axis in small steps; returns true when something stopped it
  function moveAxis(o, axis, d, who, opts = {}) {
    if (!d) return false;
    const n = Math.ceil(Math.abs(d) / 0.125), step = d / n;
    const bottom0 = o.y + o.h;
    for (let i = 0; i < n; i++) {
      const nx = axis === 'x' ? o.x + step : o.x, ny = axis === 'y' ? o.y + step : o.y;
      const ow = axis === 'y' && step > 0 && opts.oneWay ? bottom0 : undefined;
      if (rectFree(nx, ny, o.w, o.h, who, o, ow)) { o.x = nx; o.y = ny; continue; }
      if (axis === 'x' && opts.stepUp && o.ground) {
        let up = 0;
        while (up < 1 && !rectFree(nx, o.y - up - 0.125, o.w, o.h, who, o)) up += 0.125;
        if (up < 1 && rectFree(nx, o.y - up - 0.125, o.w, o.h, who, o) && rectFree(o.x, o.y - up - 0.125, o.w, o.h, who, o)) {
          o.y -= up + 0.125; o.x = nx; continue;
        }
      }
      if (axis === 'x' && opts.push && pushBlock(o, step)) { o.x = nx; continue; }
      // close the last gap
      let lo = 0, hi = 1;
      for (let k = 0; k < 6; k++) {
        const m = (lo + hi) / 2;
        const tx = axis === 'x' ? o.x + step * m : o.x, ty = axis === 'y' ? o.y + step * m : o.y;
        if (rectFree(tx, ty, o.w, o.h, who, o, ow)) lo = m; else hi = m;
      }
      if (axis === 'x') o.x += step * lo; else o.y += step * lo;
      return true;
    }
    return false;
  }

  // the tank shoves blocks; returns true when the block moved out of the way
  function pushBlock(o, step) {
    const box = { x: o.x + step, y: o.y, w: o.w, h: o.h };
    const b = s.room.blocks.find(b => overlap(box, b) && b.ground && b.y + b.h > o.y + o.h - 0.6 && b.y + b.h <= o.y + o.h + 0.01);
    if (!b) return false;
    if (!rectFree(b.x + step, b.y, b.w, b.h, 'block', b)) return false;
    b.x += step;
    s.p.pushing = 0.1;
    return true;
  }

  function updateBlocks() {
    for (const b of s.room.blocks) {
      if (b.ground) {
        // drop into a pit as wide as the block when it's centred over it
        const under = Math.floor(b.y + b.h + 0.01), mid = Math.floor(b.x + b.w / 2);
        if (!solid(mid, under, 'block')) {
          const sx = Math.round(b.x);
          if (rectFree(sx, b.y + 0.5, b.w, b.h, 'block', b) && !overlap({ x: sx, y: b.y + 0.5, w: b.w, h: b.h }, s.p)) { b.x = sx; b.ground = false; }
        }
        if (rectFree(b.x, b.y + 0.05, b.w, b.h, 'block', b) && !overlap({ x: b.x, y: b.y + 0.05, w: b.w, h: b.h }, s.p)) b.ground = false;
      }
      if (!b.ground) {
        b.vy = Math.min(b.vy + K.grav * DT, MAX_FALL);
        if (moveAxis(b, 'y', b.vy * DT, 'block')) { if (b.vy > 5) ev('thud', cx(b), b.y + b.h); b.vy = 0; b.ground = true; }
        if (b.y > ROWS + 2) b.dead = true;
      }
    }
    s.room.blocks = s.room.blocks.filter(b => !b.dead);
  }

  // ---------- player ----------
  function makePlayer(form, footX, footY) {
    const { w, h } = BODY[form];
    return {
      form, x: footX - w / 2, y: footY - h, w, h, vx: 0, vy: 0, face: 1, ground: true, ladder: false,
      coyote: 0, jumpBuf: 0, jumpHeld: false, leap: false, ctrl: 0, inv: 0, energy: 100,
      morphT: 0, morphCd: 0, morphFrom: form, atkCd: 0, spCd: 0, swing: null, flameHold: 0, flaming: false,
      flameTick: 0, probe: null, safe: { x: footX, y: footY }, dropT: 0, walk: 0, pushing: 0, onPod: false,
      hurtT: 0, sprint: 0,
    };
  }

  function tryMorph(form) {
    const p = s.p;
    if (p.morphCd > 0 || p.probe || form === p.form) return;
    const { w, h } = BODY[form], fx = cx(p), fy = p.y + p.h;
    for (const off of [0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75, -1, 1, -1.25, 1.25, -1.5, 1.5]) {
      const x = fx - w / 2 + off, y = fy - h;
      if (rectFree(x, y, w, h, 'player', p)) {
        p.morphFrom = p.form; p.form = form; p.x = x; p.y = y; p.w = w; p.h = h;
        p.morphT = 0.3; p.morphCd = 0.7; p.leap = false; p.ladder = false; p.flaming = false; p.swing = null;
        p.vx = 0;
        ev('morph', cx(p), cy(p), { form });
        return;
      }
    }
    ev('deny', cx(p), p.y);
    s.message = { text: 'NO ROOM TO MORPH HERE', t: 1.5 };
  }

  function ladderCenter(px, row) {
    const t = Math.floor(px);
    if (!isLadder(t, row)) return null;
    return isLadder(t - 1, row) ? t : t + 1;
  }

  function hurt(dmg, fromX) {
    const p = s.p;
    if (p.inv > 0 || s.status !== 'play') return;
    p.energy -= Math.round(dmg * ARMOUR[p.form]);
    p.inv = 1; p.hurtT = 0.3;
    // the tank is too heavy to be knocked about
    if (!p.ladder && !p.leap && p.form !== 'tank') {
      p.vx = (cx(p) >= fromX ? 1 : -1) * 12;
      p.vy = -16;
      p.ctrl = 0.25;
    }
    ev('hurt', cx(p), cy(p));
    if (p.energy <= 0) die();
  }
  function die() {
    const p = s.p;
    p.energy = 0; p.probe = null; p.flaming = false;
    s.status = 'dead'; s.deadT = 1.8; s.lives--; s.deaths++;
    ev('die', cx(p), cy(p));
  }
  // hazards and pits send you back to the last safe footing
  function zap(dmg, kind) {
    const p = s.p;
    ev(kind, cx(p), p.y + p.h);
    if (p.inv <= 0) p.energy -= Math.round(dmg * ARMOUR[p.form]);
    if (p.energy <= 0) { die(); return; }
    const { x, y } = p.safe;
    let nx = x - p.w / 2, ny = y - p.h;
    if (!rectFree(nx, ny, p.w, p.h, 'player', p)) { nx = s.entry.x - p.w / 2; ny = s.entry.y - p.h; }
    p.x = nx; p.y = ny; p.vx = p.vy = 0; p.leap = false; p.ladder = false; p.inv = 1; p.ground = true; p.ctrl = 0.5;
    ev('warp', cx(p), cy(p));
  }

  function updatePlayer(I, E) {
    const p = s.p;
    for (const k of ['coyote', 'jumpBuf', 'ctrl', 'inv', 'morphCd', 'atkCd', 'spCd', 'dropT', 'pushing', 'hurtT']) p[k] = Math.max(0, p[k] - DT);
    if (p.swing) { p.swing.t -= DT; if (p.swing.t <= 0) p.swing = null; }

    let want = null;
    if (E.form1) want = 'android';
    if (E.form2) want = 'raptor';
    if (E.form3) want = 'tank';
    const fi = FORMS.indexOf(p.form);
    if (E.prev) want = FORMS[(fi + 2) % 3];
    if (E.next) want = FORMS[(fi + 1) % 3];
    if (want) tryMorph(want);

    if (p.probe) { updateProbe(I, E); fall(); return; }
    if (p.morphT > 0) { p.morphT -= DT; p.vx = approach(p.vx, 0, 60 * DT); fall(); return; }

    let dir = (I.right ? 1 : 0) - (I.left ? 1 : 0);
    if (p.ctrl > 0) dir = 0;
    if (dir && !p.ladder) p.face = dir;
    if (E.jump) p.jumpBuf = 0.12;

    // ---- ladders (android) ----
    let grabbed = false;
    if (p.form === 'android' && !p.ladder && p.morphT <= 0) {
      const feetRow = Math.floor(p.y + p.h - 0.01), midRow = Math.floor(p.y + p.h / 2);
      let c = null;
      if (I.up) c = ladderCenter(cx(p), feetRow) ?? ladderCenter(cx(p), midRow);
      if (c === null && I.down && p.ground) c = ladderCenter(cx(p), Math.floor(p.y + p.h + 0.01));
      if (c !== null && rectFree(c - p.w / 2, p.y, p.w, p.h, 'player', p)) {
        p.ladder = true; grabbed = true; p.x = c - p.w / 2; p.vx = 0; p.vy = 0; p.leap = false;
        if (I.up) p.jumpBuf = 0;
      }
    }
    if (p.ladder) {
      const v = ((I.down ? 1 : 0) - (I.up ? 1 : 0)) * A.climb;
      p.vy = v; p.vx = 0;
      if (v) p.walk += DT * 8;
      const blocked = moveAxis(p, 'y', v * DT, 'player');
      const feetRow = Math.floor(p.y + p.h - 0.01), col = Math.floor(cx(p));
      if (!isLadder(col, feetRow) && !isLadder(col, Math.floor(p.y + p.h / 2))) {
        if (isLadder(col, feetRow + 1)) { p.y = feetRow + 1 - p.h; p.ground = true; }
        p.ladder = false; p.vy = 0;
      } else if (blocked && v > 0) p.ladder = false;
      if (p.ladder && E.jump && !I.up && !grabbed) { p.ladder = false; p.vy = -A.jump * 0.75; p.vx = dir * A.run; p.jumpBuf = 0; ev('jump', cx(p), p.y + p.h); }
      else if (p.ladder && dir && !I.up && !I.down) { p.ladder = false; p.face = dir; }
      if (p.ladder) { actions(I, E); transitions(); return; }
    }

    // ---- run ----
    const onOneWay = p.ground && standingOnOneWay();
    if (p.form === 'android') {
      const acc = p.ground ? A.accel : A.air;
      p.vx = approach(p.vx, dir * A.run, acc * DT);
    } else if (p.form === 'raptor') {
      if (p.ground) {
        if (dir && Math.sign(p.vx) !== -dir && Math.abs(p.vx) >= R.walk - 0.01) p.vx = approach(p.vx, dir * R.sprint, R.sprintAccel * DT);
        else p.vx = approach(p.vx, dir * R.walk, R.accel * DT);
      } else if (!p.leap) p.vx = approach(p.vx, dir ? dir * Math.max(R.walk, Math.abs(p.vx)) : p.vx, 40 * DT);
      p.sprint = p.ground && Math.abs(p.vx) > R.walk + 2 ? Math.min(1, p.sprint + DT * 3) : Math.max(0, p.sprint - DT * 4);
    } else {
      const speed = p.pushing > 0 ? K.push : K.speed;
      if (p.ground) p.vx = approach(p.vx, dir * speed, K.accel * DT);
    }
    if (p.ground && Math.abs(p.vx) > 0.5) p.walk += DT * Math.abs(p.vx) * 0.9;

    // ---- jump / drop ----
    const canJump = p.ground || p.coyote > 0;
    if (p.jumpBuf > 0 && I.down && onOneWay && (p.form !== 'android' || tileUnderFeet() === '=')) {
      p.dropT = 0.25; p.ground = false; p.y += 0.05; p.jumpBuf = 0;
    } else if (p.jumpBuf > 0 && canJump && p.form !== 'tank') {
      p.jumpBuf = 0; p.coyote = 0; p.ground = false; p.jumpHeld = true;
      if (p.form === 'android') p.vy = -A.jump;
      else if (Math.abs(p.vx) >= R.leapMin) { p.vy = -R.leap; p.leap = true; ev('leap', cx(p), p.y + p.h); }
      else p.vy = -R.jump;
      ev('jump', cx(p), p.y + p.h, { form: p.form });
    }
    if (p.jumpHeld && !I.jump && p.vy < -A.cut && p.form === 'android') p.vy = -A.cut;
    if (!I.jump || p.vy >= 0) p.jumpHeld = false;

    // ---- move ----
    const wasGround = p.ground;
    const blockedX = moveAxis(p, 'x', p.vx * DT, 'player', { stepUp: true, push: p.form === 'tank' && p.ground });
    if (blockedX) { if (p.leap) p.vx *= 0.3; else p.vx = 0; }
    fall();
    if (!p.ground && wasGround && p.vy >= 0) p.coyote = 0.08;

    // hazards: everything but the tank gets zapped back to safe footing
    if (p.ground) {
      const under = tilesUnderFeet();
      if (under.some(c => HAZARD.includes(c))) {
        if (p.form !== 'tank') { zap(15, 'zap'); return; }
      } else if (!onBlock() && '#BID=H'.includes(tileUnderFeet() ?? '.')) {
        p.safe = { x: cx(p), y: p.y + p.h };
      }
    }
    actions(I, E);
    transitions();
  }

  function fall() {
    const p = s.p;
    if (p.ladder) return;
    const g = p.form === 'android' ? A.grav : p.form === 'raptor' ? (p.leap ? R.leapGrav : R.grav) : K.grav;
    p.vy = Math.min(p.vy + g * DT, MAX_FALL);
    const vy0 = p.vy;
    const hit = moveAxis(p, 'y', p.vy * DT, 'player', { oneWay: p.dropT <= 0 });
    if (hit) {
      if (vy0 > 0) {
        if (!p.ground && vy0 > 20) ev('land', cx(p), p.y + p.h, { form: p.form, hard: vy0 > 35 });
        p.ground = true; p.leap = false;
      }
      p.vy = 0;
    } else {
      // still on the ground if something is right under the feet
      p.ground = !rectFree(p.x, p.y + 0.02, p.w, p.h, 'player', p, p.dropT <= 0 ? p.y + p.h : undefined);
      if (p.ground && vy0 >= 0) { p.vy = 0; p.leap = false; }
    }
  }
  function tilesUnderFeet() {
    const p = s.p, row = Math.floor(p.y + p.h + 0.02), out = [];
    for (let x = Math.floor(p.x + 0.05); x <= Math.floor(p.x + p.w - 0.05); x++) out.push(tileAt(x, row));
    return out;
  }
  const tileUnderFeet = () => tileAt(Math.floor(cx(s.p)), Math.floor(s.p.y + s.p.h + 0.02));
  function standingOnOneWay() {
    const p = s.p, row = Math.floor(p.y + p.h + 0.02);
    let any = false;
    for (let x = Math.floor(p.x + 0.05); x <= Math.floor(p.x + p.w - 0.05); x++) {
      if (solid(x, row, 'player')) return false;
      if (oneWay(x, row)) any = true;
    }
    return any && !onBlock();
  }
  function onBlock() {
    const p = s.p;
    return s.room.blocks.some(b => Math.abs(b.y - (p.y + p.h)) < 0.05 && p.x < b.x + b.w && p.x + p.w > b.x);
  }

  // ---- attacks ----
  function swingBox(p) {
    const sw = p.swing, f = p.face;
    if (sw.src === 'strike') return { x: f > 0 ? p.x + p.w : p.x - 1.75, y: p.y + 0.5, w: 1.75, h: 1.25 };
    if (sw.src === 'swipe') return { x: p.x - 1.5, y: p.y + 1.5, w: p.w + 3, h: 1.75 };
    /* bite */ return { x: f > 0 ? p.x + p.w - 0.5 : p.x - 1.75, y: p.y, w: 2.25, h: 2 };
  }
  function flameBox(p) {
    return { x: p.face > 0 ? p.x + p.w : p.x - 5.5, y: p.y + 0.4, w: 5.5, h: 1.6 };
  }
  function actions(I, E) {
    const p = s.p, f = p.face;
    if (p.form === 'android') {
      if (E.attack && p.atkCd <= 0) { p.swing = { src: 'strike', dmg: 1, t: 0.12, hit: new Set() }; p.atkCd = 0.28; ev('strike', cx(p), cy(p)); }
      if (E.special) {
        if (!s.upgrades.blaster) { ev('deny', cx(p), p.y); s.message = { text: 'NO BLASTER FITTED YET', t: 1.5 }; }
        else if (p.spCd <= 0 && s.room.shots.filter(o => o.src === 'bolt').length < 3) {
          s.room.shots.push({ src: 'bolt', dmg: 1, x: cx(p) + f * 0.8 - 0.375, y: p.y + 1.0, w: 0.75, h: 0.4, vx: f * 32 });
          p.spCd = 0.3; ev('bolt', cx(p) + f, p.y + 1.2);
        }
      }
    } else if (p.form === 'raptor') {
      if (E.attack && p.atkCd <= 0) { p.swing = { src: 'swipe', dmg: 2, t: 0.15, hit: new Set() }; p.atkCd = 0.45; ev('swipe', cx(p), cy(p)); }
      p.flameHold = I.attack ? p.flameHold + DT : 0;
      const was = p.flaming;
      p.flaming = s.upgrades.flame && p.flameHold > 0.25;
      if (p.flaming && !was) ev('flame', cx(p), p.y);
      if (p.flaming) flame(p);
      else s.room.meltT = 0;
      if (E.special && p.spCd <= 0) {
        p.swing = { src: 'bite', dmg: 3, t: 0.12, hit: new Set() }; p.spCd = 0.45; ev('bite', cx(p) + f * 2, p.y + 1);
        const b = swingBox(p);
        const t = findTile({ x: b.x - 0.25, y: b.y, w: b.w + 0.5, h: b.h }, 'B');
        if (t) { breakGroup(t, 'B'); ev('crunch', t.x + 0.5, t.y + 0.5); s.score += 50; }
      }
    } else {
      if (E.attack && p.atkCd <= 0 && s.room.shots.filter(o => o.src === 'shell').length < 2) {
        s.room.shots.push({ src: 'shell', dmg: 2, x: cx(p) + f * 1.9 - 0.375, y: p.y + 1.5, w: 0.75, h: 0.5, vx: f * 30 });
        p.atkCd = 0.6; ev('cannon', cx(p) + f * 2, p.y + 1.7);
        if (p.ground) p.vx -= f * 3;
      }
      if (E.special) {
        if (!s.upgrades.probe) { ev('deny', cx(p), p.y); s.message = { text: 'NO PROBE FITTED YET', t: 1.5 }; }
        else if (p.spCd <= 0) {
          const pr = { x: cx(p) - 0.375 + f * 0.5, y: p.y - 0.9, w: 0.75, h: 0.75, t: 12 };
          if (rectFree(pr.x, pr.y, pr.w, pr.h, 'probe')) { p.probe = pr; p.vx = 0; ev('probe', cx(pr), cy(pr)); }
          else ev('deny', cx(p), p.y);
          p.spCd = 0.3;
        }
      }
    }
    if (p.swing) melee(p);
  }

  function melee(p) {
    const box = swingBox(p), sw = p.swing;
    for (const t of targets()) {
      if (sw.hit.has(t) || !overlap(box, t)) continue;
      sw.hit.add(t);
      hit(t, sw.src, sw.dmg, cx(p));
    }
  }
  function flame(p) {
    const box = flameBox(p), r = s.room;
    const t = findTile(box, 'I');
    if (t) {
      r.meltT += DT;
      if (r.meltT >= 0.6) { breakGroup(t, 'I'); ev('melt', t.x + 0.5, t.y + 0.5); r.meltT = 0; }
    } else r.meltT = 0;
    p.flameTick -= DT;
    const tick = p.flameTick <= 0;
    if (tick) p.flameTick = 0.2;
    for (const e of targets()) if (overlap(box, e)) hit(e, 'flame', tick ? 1 : 0, cx(p));
  }
  function findTile(box, ch) {
    for (let y = Math.floor(box.y); y <= Math.floor(box.y + box.h - 1e-6); y++)
      for (let x = Math.floor(box.x); x <= Math.floor(box.x + box.w - 1e-6); x++)
        if (tileAt(x, y) === ch) return { x, y };
    return null;
  }
  function breakGroup({ x, y }, ch) {
    const r = s.room, stack = [[x, y]];
    while (stack.length) {
      const [a, b] = stack.pop();
      if (r.tiles[b]?.[a] !== ch) continue;
      r.tiles[b][a] = '.';
      ev(ch === 'B' ? 'debris' : 'steam', a + 0.5, b + 0.5);
      stack.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
    }
    r.version++;
  }

  // everything player attacks can land on
  function targets() {
    const r = s.room, out = [];
    for (const e of r.enemies) if (!e.dead) out.push(e);
    for (const e of r.ents) if (e.kind === 'switch' || e.kind === 'gen' || (e.kind === 'core' && !e.broken)) out.push(e);
    if (s.boss && !s.boss.dead) out.push(...s.boss.parts());
    return out;
  }

  // one hit of `src` on target t; returns true when it stops a projectile
  function hit(t, src, dmg, fromX) {
    if (t.kind === 'switch') {
      if (src === 'flame') return false;
      if (t.armored && src !== 'shell') { ev('tink', cx(t), cy(t)); return true; }
      if (!t.on) { t.on = true; openDoor(t.door); ev('switch', cx(t), cy(t)); s.score += 100; }
      return true;
    }
    if (t.kind === 'gen') {
      if (src !== 'probe') return true;
      if (!t.down) { t.down = true; ev('switch', cx(t), cy(t)); }
      return true;
    }
    if (t.kind === 'core') {
      if (t.need === 'probe' ? src !== 'probe' : t.need === 'shell' ? src !== 'shell' : src === 'probe') { if (dmg) ev('tink', cx(t), cy(t)); return true; }
      if (t.encased && iceAround(t)) { if (dmg) ev('tink', cx(t), cy(t)); return true; }
      if (!dmg) return false;
      t.hp -= dmg; t.flash = 0.15; ev('hit', cx(t), cy(t));
      if (t.hp <= 0) { t.broken = true; ev('boom', cx(t), cy(t), { big: true }); s.score += 1000; }
      return true;
    }
    if (t.boss) return t.boss.hit(t, src, dmg, fromX);
    // enemies
    if (src === 'probe') return false;
    if (t.armored && src !== 'shell') { if (dmg) ev('tink', cx(t), cy(t)); return true; }
    if (!dmg) return false;
    t.hp -= dmg; t.flash = 0.15;
    if (t.kind !== 'turret' && t.kind !== 'drone') t.vx = (cx(t) >= fromX ? 1 : -1) * 6;
    ev('hit', cx(t), cy(t));
    if (t.hp <= 0) killEnemy(t);
    return true;
  }
  function killEnemy(e) {
    e.dead = true; s.kills++;
    s.score += e.kind === 'hopper' || e.kind === 'turret' ? 150 : 100;
    ev('boom', cx(e), cy(e));
    if (s.room.rng() < 0.3) s.room.ents.push({ kind: 'energy', x: cx(e) - 0.5, y: e.y + e.h - 1, w: 1, h: 1, amount: 15, flash: 0, small: true, vy: 0 });
  }
  function iceAround(t) {
    for (let y = Math.floor(t.y) - 2; y <= Math.floor(t.y + t.h) + 1; y++)
      for (let x = Math.floor(t.x) - 2; x <= Math.floor(t.x + t.w) + 1; x++) if (tileAt(x, y) === 'I') return true;
    return false;
  }
  function openDoor(g) {
    const r = s.room;
    r.mem.perm.add(g);
    r.doors[g].open = 1;
    ev('door', 0, 0, { g });
  }

  // ---- probe ----
  function updateProbe(I, E) {
    const p = s.p, pr = p.probe;
    pr.t -= DT;
    const dx = (I.right ? 1 : 0) - (I.left ? 1 : 0), dy = (I.down ? 1 : 0) - (I.up ? 1 : 0);
    const k = dx && dy ? 0.7071 : 1;
    moveAxis(pr, 'x', dx * 11 * k * DT, 'probe');
    moveAxis(pr, 'y', dy * 11 * k * DT, 'probe');
    pr.x = clamp(pr.x, 0, COLS - pr.w); pr.y = clamp(pr.y, 0, ROWS - pr.h);
    for (const t of targets()) if (overlap(pr, t)) hit(t, 'probe', 1, cx(pr));
    if (E.special || pr.t <= 0) { p.probe = null; p.spCd = 0.3; ev('recall', cx(pr), cy(pr)); }
  }

  // ---- room edges ----
  function transitions() {
    const p = s.p, r = s.room;
    const mx = cx(p), my = cy(p);
    let dc = 0, dr = 0;
    if (mx < 0) dc = -1; else if (mx > COLS) dc = 1;
    else if (my < 0) dr = -1; else if (my > ROWS) dr = 1;
    if (!dc && !dr) {
      if (p.y > ROWS) zap(20, 'pit');
      return;
    }
    const next = roomAt(r.col + dc, r.row + dr);
    const nx = p.x - dc * COLS, ny = p.y - dr * ROWS;
    if (!next) {
      if (dr > 0) { zap(20, 'pit'); return; }
      p.x = clamp(p.x, -p.w / 2 + 0.01, COLS - p.w / 2 - 0.01); p.y = Math.max(p.y, -p.h / 2 + 0.01);
      return;
    }
    if (dr > 0 && !fitsMap(next, nx, ny, p.w, p.h)) { zap(20, 'pit'); return; } // a solid ceiling below is a pit
    p.x = nx; p.y = ny;
    loadRoom(next);
    if (!rectFree(p.x, p.y, p.w, p.h, 'player', p)) {
      // shouldn't happen with matching edges; nudge inside
      for (let k = 0; k < 40 && !rectFree(p.x, p.y, p.w, p.h, 'player', p); k++) p.y -= 0.125;
    }
    s.entry = { x: cx(p), y: p.y + p.h, form: p.form };
    p.safe = { x: cx(p), y: p.y + p.h };
    p.probe = null;
  }

  function fitsMap(def, x, y, w, h) {
    for (let ty = Math.max(0, Math.floor(y)); ty <= Math.floor(y + h - 1e-6); ty++)
      for (let tx = Math.floor(x); tx <= Math.floor(x + w - 1e-6); tx++) if (SOLID.includes(def.map[ty]?.[tx] ?? '#')) return false;
    return true;
  }

  // ---------- enemies ----------
  function makeEnemy(kind, tx, foot, o) {
    const size = { crawler: [1.75, 1.25, 2], drone: [1.5, 1.25, 1], turret: [1.5, 2, 3], hopper: [1.5, 1.5, 3], swooper: [1.75, 1.25, 2] }[kind];
    const [w, h, hp] = size;
    const e = { kind, x: tx, y: foot - h, w, h, hp, vx: 0, vy: 0, dir: o.dir ?? -1, t: 0, cd: 1, flash: 0, ground: false, dead: false };
    if (kind === 'drone') { e.x0 = tx; e.x1 = o.to ?? tx + 6; e.y0 = foot - h; e.dir = 1; }
    if (kind === 'turret') e.armored = true;
    if (kind === 'swooper') { e.hx = tx; e.hy = foot - h; e.state = 'idle'; }
    if (kind === 'hopper') e.cd = 1.2;
    return e;
  }

  function updateEnemies() {
    const r = s.room, p = s.p;
    for (const e of r.enemies) {
      if (e.dead) continue;
      e.t += DT; e.flash = Math.max(0, e.flash - DT); e.cd -= DT;
      switch (e.kind) {
        case 'crawler': {
          e.vx = approach(e.vx, e.dir * 3.75, 30 * DT);
          e.vy = Math.min(e.vy + 120 * DT, MAX_FALL);
          if (moveAxis(e, 'x', e.vx * DT, 'body')) e.dir = -e.dir;
          e.ground = moveAxis(e, 'y', e.vy * DT, 'body') && e.vy > 0;
          if (e.ground) e.vy = 0;
          const ahead = Math.floor(e.dir > 0 ? e.x + e.w + 0.1 : e.x - 0.1);
          if (e.ground && !solid(ahead, Math.floor(e.y + e.h + 0.1), 'body')) e.dir = -e.dir;
          break;
        }
        case 'drone': {
          e.x += e.dir * 5 * DT;
          if (e.x > e.x1) { e.x = e.x1; e.dir = -1; }
          if (e.x < e.x0) { e.x = e.x0; e.dir = 1; }
          e.y = e.y0 + Math.sin(e.t * 2.2) * 0.75;
          break;
        }
        case 'turret': {
          const front = Math.sign(cx(p) - cx(e)) === e.dir;
          if (front && Math.abs(cy(p) - (e.y + 0.7)) < 3 && e.cd <= 0 && s.status === 'play') {
            r.eshots.push({ x: cx(e) + e.dir * 0.8 - 0.3, y: e.y + 0.5, w: 0.6, h: 0.4, vx: e.dir * 15, vy: 0, g: 0, dmg: 10, kind: 'bolt' });
            e.cd = 1.8; ev('eshot', cx(e), e.y + 0.6);
          }
          break;
        }
        case 'hopper': {
          e.vy = Math.min(e.vy + 110 * DT, MAX_FALL);
          if (moveAxis(e, 'x', e.vx * DT, 'body')) e.vx = -e.vx * 0.5;
          const landed = moveAxis(e, 'y', e.vy * DT, 'body') && e.vy > 0;
          if (landed) { e.vy = 0; e.vx = 0; e.ground = true; } else if (Math.abs(e.vy) > 0.1) e.ground = false;
          if (e.ground && e.cd <= 0) { e.vy = -28; e.vx = Math.sign(cx(p) - cx(e)) * 7; e.cd = 1.4; e.ground = false; ev('hop', cx(e), e.y + e.h); }
          break;
        }
        case 'swooper': {
          if (e.state === 'idle') {
            e.x = approach(e.x, e.hx, 6 * DT); e.y = e.hy + Math.sin(e.t * 3) * 0.4;
            if (e.cd <= 0 && Math.abs(cx(p) - cx(e)) < 8 && cy(p) > cy(e) + 2 && s.status === 'play') {
              const dx = cx(p) - cx(e), dy = cy(p) - cy(e), d = Math.hypot(dx, dy) || 1;
              e.vx = (dx / d) * 17; e.vy = (dy / d) * 17; e.state = 'dive'; e.t = 0;
            }
          } else if (e.state === 'dive') {
            const hx = moveAxis(e, 'x', e.vx * DT, 'body'), hy = moveAxis(e, 'y', e.vy * DT, 'body');
            if (hx || hy || e.t > 0.9) { e.state = 'back'; }
          } else {
            const dx = e.hx - e.x, dy = e.hy - e.y, d = Math.hypot(dx, dy);
            if (d < 0.2) { e.state = 'idle'; e.cd = 1.6; e.t = 0; } else { e.x += (dx / d) * Math.min(d, 8 * DT); e.y += (dy / d) * Math.min(d, 8 * DT); }
          }
          break;
        }
      }
      if (e.y > ROWS + 2) e.dead = true;
      if (s.status === 'play' && overlap(e, p)) hurt(10, cx(e));
    }
    r.enemies = r.enemies.filter(e => !e.dead);
  }

  function updateShots() {
    const r = s.room, p = s.p;
    for (const o of r.shots) {
      o.x += o.vx * DT;
      if (o.x < -2 || o.x > COLS + 2) { o.dead = true; continue; }
      if (!rectFree(o.x, o.y, o.w, o.h, 'shot')) { o.dead = true; ev('spark', o.vx > 0 ? o.x + o.w : o.x, cy(o), { src: o.src }); continue; }
      for (const t of targets()) if (overlap(o, t) && hit(t, o.src, o.dmg, o.x - o.vx)) { o.dead = true; ev('spark', cx(o), cy(o), { src: o.src }); break; }
    }
    r.shots = r.shots.filter(o => !o.dead);
    for (const o of r.eshots) {
      o.vy += (o.g || 0) * DT;
      o.x += o.vx * DT; o.y += o.vy * DT;
      if (o.x < -2 || o.x > COLS + 2 || o.y > ROWS + 1 || o.y < -3) { o.dead = true; continue; }
      if (!rectFree(o.x, o.y, o.w, o.h, 'eshot')) { o.dead = true; ev('splash', cx(o), cy(o), { kind: o.kind }); continue; }
      if (s.status === 'play' && overlap(o, p)) { o.dead = true; hurt(o.dmg, o.x - o.vx); }
    }
    r.eshots = r.eshots.filter(o => !o.dead);
  }

  // ---------- pickups, pods, plates, doors ----------
  function updateThings() {
    const r = s.room, p = s.p;
    let onPod = false;
    for (const e of r.ents) {
      e.flash = Math.max(0, e.flash - DT);
      if (e.kind === 'energy' && e.small) {
        e.vy = Math.min((e.vy || 0) + 60 * DT, 20);
        if (moveAxis(e, 'y', e.vy * DT, 'body')) e.vy = 0;
      }
      if (s.status !== 'play' || !overlap(e, p)) continue;
      if (e.kind === 'energy') {
        p.energy = Math.min(100, p.energy + e.amount); e.dead = true; s.score += 50;
        if (e.persist) r.mem.taken.add(e.i);
        ev('pickup', cx(e), cy(e));
      } else if (e.kind === 'upgrade') {
        s.upgrades[e.up] = true; e.dead = true; s.score += 1000;
        s.message = { text: UPGRADE_TEXT[e.up], t: 8, big: true };
        ev('upgrade', cx(e), cy(e), { up: e.up });
      } else if (e.kind === 'check') {
        onPod = true;
        if (!p.onPod) {
          const fresh = !s.check || s.check.room !== r.id || s.check.i !== e.i;
          s.check = { room: r.id, i: e.i, x: cx(e), y: e.y + e.h };
          if (fresh || p.energy < 100) { p.energy = 100; ev('check', cx(e), cy(e), { fresh }); }
          if (fresh) s.message = { text: 'CHECKPOINT', t: 2 };
        }
      }
    }
    p.onPod = onPod;
    r.ents = r.ents.filter(e => !e.dead);

    // weight plates hold their doors open while something heavy sits on them
    const hold = { 1: false, 2: false, 3: false, 4: false };
    for (const e of r.ents) {
      if (e.kind !== 'plate') continue;
      const box = { x: e.x, y: e.y - 0.2, w: e.w, h: e.h + 0.2 };
      const was = e.pressed;
      e.pressed = r.blocks.some(b => overlap(box, b)) || (p.form === 'tank' && overlap(box, p));
      if (e.pressed !== was) ev(e.pressed ? 'plate' : 'unplate', cx(e), e.y);
      if (e.pressed) hold[e.door] = true;
    }
    if (r.fieldT > 0) hold[4] = true;
    for (const g of [1, 2, 3, 4]) {
      const d = r.doors[g];
      let open = r.mem.perm.has(g) || hold[g];
      if (!open && d.open && touchesDoor(g)) open = true; // never shut on someone
      if (open !== !!d.open) { d.open = open ? 1 : 0; if (g !== 4) ev(open ? 'door' : 'doorshut', 0, 0, { g }); }
      d.anim = approach(d.anim, d.open, DT * 3);
    }
  }
  function touchesDoor(g) {
    const r = s.room, ch = String(g);
    const boxes = [s.p, ...r.blocks, ...r.enemies];
    for (const o of boxes)
      for (let y = Math.floor(o.y); y <= Math.floor(o.y + o.h - 1e-6); y++)
        for (let x = Math.floor(o.x); x <= Math.floor(o.x + o.w - 1e-6); x++) if (r.tiles[y]?.[x] === ch) return true;
    return false;
  }

  // ---------- bosses ----------
  function makeBoss(kind, tx, foot, o) {
    const b = { kind, name: BOSS_NAMES[kind], door: o.door, field: o.field, t: 0, flash: 0, dead: false, dying: 0, state: 'idle', st: 0 };
    const part = (w, h, extra) => ({ boss: b, kind: 'boss', w, h, x: 0, y: 0, flash: 0, ...extra });
    if (kind === 'crucible') Object.assign(b, { hp: 20, x: tx - 3, y: foot - 4.5, w: 6, h: 4.5, dir: 1, state: 'roll' });
    if (kind === 'warden') Object.assign(b, { hp: 24, x: 14, y: 3, w: 4, h: 3, state: 'hover', melt: 0 });
    if (kind === 'sentinel') Object.assign(b, { hp: 16, x: 33.5, y: 13, w: 4.5, h: 3.5, fire: 2, spawn: 5 });
    if (kind === 'foreman') Object.assign(b, { hp: 20, x: 10, y: 9, w: 4, h: 3, phase: 1, fire: 2, spawn: 6, hx: tx });
    b.maxHp = b.hp;
    b.body = part(b.w, b.h);
    b.parts = () => { Object.assign(b.body, { x: b.x, y: b.y, w: b.w, h: b.h }); return [b.body]; };
    b.hit = (t, src, dmg, fromX) => bossHit(b, src, dmg, fromX);
    return b;
  }
  function bossVulnerable(b, src) {
    if (src === 'probe') return false;
    if (b.kind === 'crucible') return src === 'shell';
    if (b.kind === 'warden') return b.state === 'exposed';
    if (b.kind === 'sentinel') return s.room.fieldT > 0;
    return b.phase === 2;
  }
  function bossHit(b, src, dmg) {
    if (b.dying) return true;
    if (b.kind === 'warden' && src === 'flame' && b.state === 'docked') { b.melt += DT; return false; }
    if (!bossVulnerable(b, src)) { if (dmg && src !== 'probe') ev('tink', cx(b), cy(b)); return src !== 'flame' && src !== 'probe'; }
    if (!dmg) return false;
    b.hp -= dmg; b.flash = 0.12; ev('hit', cx(b), cy(b), { boss: true });
    if (b.hp <= 0) { b.hp = 0; b.dying = 2.2; ev('bossdown', cx(b), cy(b)); }
    return true;
  }

  function updateBoss() {
    const b = s.boss, r = s.room, p = s.p;
    if (!b || b.dead) return;
    b.t += DT; b.st += DT; b.flash = Math.max(0, b.flash - DT);
    if (b.dying) {
      b.dying -= DT;
      if (Math.floor(b.dying * 10) !== Math.floor((b.dying + DT) * 10)) ev('boom', b.x + r.rng() * b.w, b.y + r.rng() * b.h, { big: r.rng() < 0.3 });
      if (b.dying <= 0) {
        b.dead = true; r.mem.bossDead = true; s.score += 5000;
        if (b.door) openDoor(b.door);
        r.fieldT = 0;
        r.enemies.forEach(e => { e.dead = true; ev('boom', cx(e), cy(e)); });
        r.eshots.length = 0;
        ev('bossdead', cx(b), cy(b), { kind: b.kind });
        if (b.kind === 'foreman') { s.status = 'ending'; s.endT = 3.5; }
        else { s.lives++; s.message = { text: b.name + ' DESTROYED · EXTRA LIFE', t: 4 }; }
      }
      return;
    }
    const aim = (x, y, speed, dmg = 10, kind = 'bolt') => {
      const dx = cx(p) - x, dy = cy(p) - y, d = Math.hypot(dx, dy) || 1;
      r.eshots.push({ x: x - 0.3, y: y - 0.3, w: 0.6, h: 0.6, vx: (dx / d) * speed, vy: (dy / d) * speed, g: 0, dmg, kind });
    };
    if (b.kind === 'crucible') {
      if (b.state === 'roll') {
        b.x += b.dir * 3 * DT;
        if (b.x < 6) { b.x = 6; b.dir = 1; }
        if (b.x + b.w > 34) { b.x = 34 - b.w; b.dir = -1; }
        if (b.st > 4) { b.state = 'pour'; b.st = 0; }
      } else if (b.state === 'pour') {
        if (b.st > 0.5 && !b.poured) {
          b.poured = true;
          for (let k = -1; k <= 1; k++) {
            const vx = clamp((cx(p) - cx(b)) / 1.1 + k * 3.5, -13, 13);
            r.eshots.push({ x: cx(b) - 0.4, y: b.y - 0.5, w: 0.8, h: 0.8, vx, vy: -30, g: 55, dmg: 12, kind: 'blob' });
          }
          ev('pour', cx(b), b.y);
        }
        if (b.st > 1.3) { b.state = 'roll'; b.st = 0; b.poured = false; }
      }
    } else if (b.kind === 'warden') {
      if (b.state === 'hover') {
        b.x = 14 + Math.sin(b.t * 0.8) * 11; b.y = 3 + Math.sin(b.t * 1.7);
        b.fireT = (b.fireT ?? 1) - DT;
        if (b.fireT <= 0) { b.fireT = 1.3; r.eshots.push({ x: cx(b) - 0.25, y: b.y + b.h, w: 0.5, h: 1, vx: 0, vy: 2, g: 45, dmg: 12, kind: 'icicle' }); ev('icicle', cx(b), b.y + b.h); }
        if (b.st > 8) { b.state = 'descend'; b.st = 0; }
      } else if (b.state === 'descend' || b.state === 'ascend') {
        const tx = b.state === 'descend' ? 14 : 14 + Math.sin(b.t * 0.8) * 11, ty = b.state === 'descend' ? 17 : 3 + Math.sin(b.t * 1.7);
        const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
        if (d < 0.2) {
          b.x = tx; b.y = ty; b.st = 0;
          if (b.state === 'descend') { b.state = 'docked'; b.melt = 0; ev('freeze', cx(b), cy(b)); } else b.state = 'hover';
        } else { b.x += (dx / d) * Math.min(d, 9 * DT); b.y += (dy / d) * Math.min(d, 9 * DT); }
      } else if (b.state === 'docked') {
        if (b.melt >= 1) { b.state = 'exposed'; b.st = 0; ev('shatter', cx(b), cy(b)); }
        else if (b.st > 6) { b.state = 'ascend'; b.st = 0; }
      } else if (b.state === 'exposed') {
        if (b.st > 3.2) { b.state = 'ascend'; b.st = 0; }
      }
      // docked or cracked open it's dormant; only the flying warden hurts to touch
      if (overlap(b, p) && b.state !== 'docked' && b.state !== 'exposed') hurt(15, cx(b));
    } else if (b.kind === 'sentinel') {
      b.y = 12 + (Math.sin(b.t * 0.9) + 1) * 2.2;
      const gens = r.ents.filter(e => e.kind === 'gen');
      if (r.fieldT > 0) {
        r.fieldT -= DT;
        if (r.fieldT <= 0) { gens.forEach(g => (g.down = false)); ev('field', cx(b), cy(b), { up: true }); }
      } else if (gens.length && gens.every(g => g.down)) { r.fieldT = 9; ev('field', cx(b), cy(b), { up: false }); }
      b.fire -= DT;
      if (b.fire <= 0 && s.status === 'play') { b.fire = 2.4; aim(b.x + 0.5, cy(b), 11); ev('eshot', b.x, cy(b)); }
      b.spawn -= DT;
      if (b.spawn <= 0) {
        b.spawn = 7;
        if (r.enemies.filter(e => e.kind === 'drone').length < 2) { const d = makeEnemy('drone', 12, 11, { to: 27 }); r.enemies.push(d); ev('spawn', cx(d), cy(d)); }
      }
    } else if (b.kind === 'foreman') {
      const cores = r.ents.filter(e => e.kind === 'core');
      if (b.phase === 1 && cores.every(c => c.broken)) { b.phase = 2; b.st = 0; ev('phase', cx(b), cy(b)); s.message = { text: 'THE FOREMAN IS EXPOSED', t: 3 }; }
      if (b.phase === 1) { b.x = 11 + Math.sin(b.t * 0.6) * 7; b.y = 10 + Math.sin(b.t * 1.3) * 1.5; }
      else { b.x = 15 + Math.sin(b.t * 0.9) * 11; b.y = 13.5 + Math.sin(b.t * 1.6) * 3; }
      b.fire -= DT;
      if (b.fire <= 0 && s.status === 'play') {
        b.fire = b.phase === 1 ? 2.4 : 1.6;
        if (b.phase === 1) aim(cx(b), cy(b), 13);
        else for (const k of [-0.25, 0, 0.25]) {
          const dx = cx(p) - cx(b), dy = cy(p) - cy(b), a = Math.atan2(dy, dx) + k;
          r.eshots.push({ x: cx(b) - 0.3, y: cy(b) - 0.3, w: 0.6, h: 0.6, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14, g: 0, dmg: 10, kind: 'bolt' });
        }
        ev('eshot', cx(b), cy(b));
      }
      b.spawn -= DT;
      if (b.spawn <= 0) {
        b.spawn = 10;
        if (r.enemies.length < 2) { const d = makeEnemy('drone', 4, 8, { to: 20 }); r.enemies.push(d); ev('spawn', cx(d), cy(d)); }
      }
      if (overlap(b, p)) hurt(15, cx(b));
    }
  }

  // ---------- flow ----------
  function newGame() {
    s.mem = {}; s.upgrades = { blaster: false, flame: false, probe: false };
    s.lives = 3; s.score = 0; s.deaths = 0; s.kills = 0; s.t = 0; s.message = null;
    const first = ROOMS[0], st = first.ents.find(e => e[0] === 'start');
    s.check = null;
    enter(first.id, st[1] + 0.5, st[2] + 1, 'android');
    s.status = 'play';
  }
  // start at any room with the given upgrades (demo, tests)
  function startAt(id, ups = {}, foot) {
    s.mem = {}; s.upgrades = { blaster: false, flame: false, probe: false, ...ups };
    s.lives = 3; s.score = 0; s.deaths = 0; s.kills = 0; s.t = 0; s.message = null; s.check = null;
    const def = roomById(id);
    const c = def.ents.find(e => e[0] === 'check' || e[0] === 'start');
    const [x, y] = foot ?? [c[1] + 0.75, c[2] + 1];
    enter(id, x, y, 'android');
    if (c?.[0] === 'check') s.check = { room: id, i: def.ents.indexOf(c), x: c[1] + 0.75, y: c[2] + 1 };
    s.status = 'play';
  }
  // continue from an autosave checkpoint: the zone's first room as a fresh arrival, with the
  // run so far carried in; the zones below count as cleared (bosses down, their doors open)
  function resume({ room, ups, score, lives, t = 0, deaths = 0, kills = 0 }) {
    startAt(room, ups);
    Object.assign(s, { score, lives, t, deaths, kills });
    const zone = roomById(room).zone;
    for (const def of ROOMS) {
      if (def.zone >= zone) continue;
      const m = roomMem(def.id), boss = def.ents.find(e => e[0] === 'boss');
      m.visited = m.hinted = true;
      if (boss) { m.bossDead = true; if (boss[3]?.door) m.perm.add(boss[3].door); }
    }
  }
  function enter(id, footX, footY, form) {
    s.p = makePlayer(form, footX, footY);
    loadRoom(roomById(id));
    s.entry = { x: footX, y: footY, form };
    prevIn = NO_INPUT;
  }
  function respawn() {
    const c = s.check ?? { room: ROOMS[0].id, x: 5.5, y: 20 };
    enter(c.room, c.x, c.y, 'android');
    s.p.inv = 1.5;
    s.status = 'play';
    ev('respawn', s.p.x, s.p.y);
  }
  // pause menu: put the room back the way it was when you came in
  function retryRoom() {
    if (s.status !== 'play') return;
    const r = s.room, e = s.entry, keep = s.p.energy;
    s.p = makePlayer(e.form, e.x, e.y);
    s.p.energy = Math.max(1, keep - 10);
    loadRoom(r.def);
    s.entry = e;
  }

  function step(input = NO_INPUT) {
    const I = input, E = {};
    for (const k in NO_INPUT) E[k] = !!I[k] && !prevIn[k];
    prevIn = { ...I };
    if (s.message) { s.message.t -= DT; if (s.message.t <= 0) s.message = null; }
    const r = s.room;
    if (!r) return;
    r.t += DT;
    if (s.status === 'play' || s.status === 'dead' || s.status === 'ending') s.t += s.status === 'play' ? DT : 0;
    if (s.status === 'dead') {
      s.deadT -= DT;
      if (s.deadT <= 0) { if (s.lives <= 0) { s.status = 'gameover'; ev('gameover'); } else respawn(); }
      updateEnemies(); updateShots(); updateBoss();
      return;
    }
    if (s.status === 'ending') {
      s.endT -= DT;
      if (Math.floor(s.endT * 6) !== Math.floor((s.endT + DT) * 6)) ev('boom', r.rng() * COLS, r.rng() * 18, { big: true });
      if (s.endT <= 0) { s.status = 'victory'; s.score += Math.max(0, 30000 - Math.floor(s.t) * 10); ev('victory'); }
      return;
    }
    if (s.status !== 'play') return;
    updatePlayer(I, E);
    if (s.status !== 'play') return;
    updateBlocks();
    updateThings();
    updateEnemies();
    updateShots();
    updateBoss();
  }

  return s;
}

export const UPGRADE_TEXT = {
  blaster: 'BLASTER FITTED · ANDROID {special} FIRES',
  flame: 'FLAME FITTED · RAPTOR HOLDS {attack} TO BREATHE FIRE',
  probe: 'PROBE FITTED · TANK {special} LAUNCHES, {move} STEERS',
};
