// The autopilot: a scripted run through every room, written as one generator per room.
// Each `yield` is the input for one fixed step. The simulation is deterministic, so the same
// script plays out the same way every time; the demo plays a zone of it and the Node
// playthrough test plays all of it, start to victory.
//
//   const pilot = createPilot(sim);
//   sim.step(pilot());            // every fixed step
import { FORMS } from './sim.js';

const NONE = Object.freeze({});
const BRAKE = { android: 112, raptor: 75, tank: 50 };
const cx = o => o.x + o.w / 2;

// ---------- building blocks ----------
function* hold(input, secs) {
  for (let i = Math.round(secs * 60); i > 0; i--) yield input;
}
const wait = secs => hold(NONE, secs);

function* tap(button) {
  yield { [button]: true };
  yield NONE;
}

// walk until the body's centre is at x (tiles); `extra` rides along (e.g. attack)
function* go(s, x, extra = {}, timeout = 20) {
  for (let i = 0; i < timeout * 60; i++) {
    const d = x - cx(s.p), v = s.p.vx;
    if (Math.abs(d) < 0.15) break;
    // let go early enough to coast to a stop on the spot
    if (Math.sign(v) === Math.sign(d) && Math.abs(d) < (v * v) / (2 * BRAKE[s.p.form]) + 0.05) { yield extra; continue; }
    yield { ...extra, right: d > 0, left: d < 0 };
  }
  yield* wait(0.1);
}

function* face(s, dir) {
  if (s.p.face !== dir) yield { [dir > 0 ? 'right' : 'left']: true };
  yield NONE;
}

function* morph(s, form) {
  yield* waitUntil(s, () => s.p.morphCd <= 0, 2);
  yield { ['form' + (FORMS.indexOf(form) + 1)]: true };
  yield* waitUntil(s, () => s.p.morphT <= 0, 1);
  yield NONE;
}

function* waitUntil(s, cond, timeout = 10, input = () => NONE) {
  for (let i = 0; i < timeout * 60 && !cond(); i++) yield input();
}

// jump in a direction and keep holding until landed
function* jump(s, dir, timeout = 3) {
  const key = dir > 0 ? 'right' : dir < 0 ? 'left' : 'none';
  yield { jump: true, [key]: true };
  for (let i = 0; i < timeout * 60; i++) {
    yield { jump: true, [key]: true };
    if (s.p.ground && i > 3) break;
  }
  yield NONE;
}

// raptor: sprint at the edge and leap from it
function* leap(s, dir, edge) {
  const key = dir > 0 ? 'right' : 'left';
  for (let i = 0; i < 600; i++) {
    const front = dir > 0 ? s.p.x + s.p.w : s.p.x;
    if ((dir > 0 ? front >= edge - 0.2 : front <= edge + 0.2) && s.p.ground) break;
    yield { [key]: true };
  }
  yield { [key]: true, jump: true };
  for (let i = 0; i < 180; i++) {
    yield { [key]: true };
    if (s.p.ground && i > 3) break;
  }
  yield NONE;
}

function* climb(s, dir, timeout = 8) {
  const key = dir < 0 ? 'up' : 'down';
  yield { [key]: true };
  for (let i = 0; i < timeout * 60 && s.p.ladder; i++) yield { [key]: true };
  yield NONE;
}

// fire `button` facing dir until cond() holds
function* shootUntil(s, dir, button, cond, timeout = 15) {
  yield* face(s, dir);
  for (let i = 0; i < timeout * 60 && !cond(); i++) yield i % 8 < 4 ? { [button]: true } : NONE;
}

function* flameUntil(s, dir, cond, timeout = 6) {
  yield* face(s, dir);
  for (let i = 0; i < timeout * 60 && !cond(); i++) yield { attack: true };
  yield NONE;
}

// steer the probe through waypoints (tile coordinates of its centre)
function* probe(s, points, done = () => false) {
  yield { special: true };
  yield NONE;
  for (const [x, y] of points) {
    for (let i = 0; i < 300 && s.p.probe && !done(); i++) {
      const pr = s.p.probe, dx = x - (pr.x + pr.w / 2), dy = y - (pr.y + pr.h / 2);
      if (Math.abs(dx) < 0.15 && Math.abs(dy) < 0.15) break;
      yield { left: dx < -0.1, right: dx > 0.1, up: dy < -0.1, down: dy > 0.1 };
    }
  }
  if (s.p.probe) yield* tap('special');
}

// walk toward x, knocking down whatever gets in front of the active form
function* goFight(s, x, timeout = 25) {
  for (let i = 0; i < timeout * 60; i++) {
    const d = x - cx(s.p);
    if (Math.abs(d) < 0.15) break;
    const dir = Math.sign(d), p = s.p;
    const reach = p.form === 'tank' || (p.form === 'android' && s.upgrades.blaster) ? 12 : 3;
    const foe = s.room.enemies.find(e => Math.sign(cx(e) - cx(p)) === dir && Math.abs(cx(e) - cx(p)) < reach &&
      e.y < p.y + p.h && e.y + e.h > p.y - 0.5 && (!e.armored || p.form === 'tank'));
    const btn = p.form === 'android' && s.upgrades.blaster && Math.abs(cx(foe ?? p) - cx(p)) > 2 ? 'special' : 'attack';
    yield { right: d > 0, left: d < 0, [btn]: !!foe && i % 10 < 5 };
  }
  yield* wait(0.1);
}

const alive = (s, kind) => s.room.enemies.some(e => !kind || e.kind === kind);
const blockAt = (s, i = 0) => s.room.blocks[i];
const tile = (s, x, y) => s.room.tiles[y][x];
const switchOn = s => s.room.ents.filter(e => e.kind === 'switch').every(e => e.on);

// ---------- the run, room by room ----------
export const ROUTE = {
  *'1-1'(s) {
    yield* goFight(s, 8.3);
    yield* jump(s, 1);
    yield* goFight(s, 21);
    yield* climb(s, -1);
    yield* go(s, 27);
    yield* go(s, 41);
  },
  *'1-2'(s) {
    yield* go(s, 7.8);
    yield* morph(s, 'raptor');
    yield* face(s, 1);
    yield* tap('special');
    yield* wait(0.3);
    yield* goFight(s, 12);
    yield* waitUntil(s, () => !alive(s, 'crawler') || Math.abs(cx(s.room.enemies[0]) - cx(s.p)) < 3, 4);
    yield* goFight(s, 12);
    yield* go(s, 8.5);
    yield* leap(s, 1, 22);
    yield* go(s, 41);
  },
  *'1-3'(s) {
    yield* go(s, 2.5);
    yield* morph(s, 'tank');
    yield* go(s, 20);
    yield* shootUntil(s, 1, 'attack', () => !alive(s, 'turret'));
    yield* go(s, 41);
  },
  *'1-4'(s) {
    yield* go(s, 13, {}, 20);
    yield* waitUntil(s, () => blockAt(s).y > 19.5, 2);
    yield* goFight(s, 41);
  },
  *'1-5'(s) {
    yield* go(s, 3);
    yield* morph(s, 'android');
    yield* go(s, 5);
    yield* climb(s, -1);
    yield* go(s, 10.8);
    yield* go(s, 12.2);
    yield* shootUntil(s, 1, 'special', () => switchOn(s));
    yield* goFight(s, 41);
  },
  *'1-6'(s) {
    yield* go(s, 3.5);
    yield* morph(s, 'tank');
    yield* go(s, 3.6);
    yield* shootUntil(s, 1, 'attack', () => !s.boss || s.boss.dead, 60);
    yield* go(s, 36.5);
    yield* morph(s, 'android');
    yield* go(s, 37);
    yield* climb(s, -1, 15);
  },
  *'2-1'(s) {
    yield* climb(s, -1);
    yield* go(s, 34);
    yield* morph(s, 'tank');
    yield* goFight(s, -1);
  },
  *'2-2'(s) {
    yield* go(s, 37);
    yield* morph(s, 'raptor');
    yield* go(s, 38);
    yield* leap(s, -1, 26);
    yield* goFight(s, 10);
    yield* morph(s, 'android');
    yield* goFight(s, -1);
  },
  *'2-3'(s) {
    yield* goFight(s, 20.8);
    yield* goFight(s, 12);
    yield* morph(s, 'raptor');
    yield* go(s, 10.4);
    yield* flameUntil(s, -1, () => tile(s, 6, 19) !== 'I');
    yield* go(s, -1);
  },
  *'2-4'(s) {
    yield* go(s, 37.5);
    yield* morph(s, 'tank');
    yield* go(s, 9, {}, 30);
    yield* waitUntil(s, () => blockAt(s).y > 19.5, 2);
    yield* go(s, -1);
  },
  *'2-5'(s) {
    yield* go(s, 37);
    yield* goFight(s, 15);
    yield* shootUntil(s, -1, 'attack', () => switchOn(s));
    yield* morph(s, 'raptor');
    yield* go(s, 12.9);
    yield* flameUntil(s, -1, () => tile(s, 7, 19) !== 'I');
    yield* morph(s, 'android');
    yield* go(s, 12);
    yield* jump(s, -1);
    yield* go(s, 3);
    yield* climb(s, -1);
    yield* go(s, -1);
  },
  *'2-6'(s) {
    yield* go(s, 26);
    yield* morph(s, 'raptor');
    yield* go(s, 10);
    while (s.boss && !s.boss.dead && !s.boss.dying) {
      const b = s.boss;
      if (b.state === 'docked') {
        yield* go(s, 12.2);
        yield* flameUntil(s, 1, () => s.boss.state !== 'docked', 3);
      } else if (b.state === 'exposed') {
        yield* go(s, 12.4);
        yield* face(s, 1);
        yield* tap('special');
        yield* wait(0.35);
      } else {
        // dodge icicles: keep out from under the warden
        const x = cx(b) > 16 ? 7 : 25;
        if (Math.abs(cx(s.p) - x) > 1) yield* go(s, x, {}, 1.5);
        else yield NONE;
      }
    }
    yield* waitUntil(s, () => !s.boss || s.boss.dead, 4);
    yield* morph(s, 'android');
    yield* go(s, 3);
    yield* climb(s, -1, 15);
  },
  *'3-1'(s) {
    yield* climb(s, -1);
    yield* goFight(s, 10.8);
    yield* morph(s, 'tank');
    yield* go(s, 23);
    yield* face(s, 1);
    yield* probe(s, [[23.5, 12.5]], () => switchOn(s));
    yield* goFight(s, 41);
  },
  *'3-2'(s) {
    yield* goFight(s, 22.8);
    yield* morph(s, 'raptor');
    yield* face(s, 1);
    yield* tap('special');
    yield* wait(0.3);
    yield* go(s, 29);
    yield* morph(s, 'tank');
    yield* shootUntil(s, 1, 'attack', () => !alive(s, 'turret'));
    yield* goFight(s, 41);
  },
  *'3-3'(s) {
    yield* go(s, 2.5);
    yield* morph(s, 'raptor');
    yield* go(s, 2);
    yield* leap(s, 1, 12);
    yield* goFight(s, 25.5);
    yield* flameUntil(s, 1, () => tile(s, 30, 19) !== 'I');
    yield* goFight(s, 41);
  },
  *'3-4'(s) {
    yield* go(s, 3);
    yield* morph(s, 'tank');
    yield* goFight(s, 11);
    yield* probe(s, [[11, 4.6], [6, 4.6], [4.5, 6.2]], () => switchOn(s));
    yield* goFight(s, 22.7);
    yield* go(s, 30, {}, 20);
    yield* waitUntil(s, () => blockAt(s).y > 19.5, 2);
    yield* goFight(s, 41);
  },
  *'3-5'(s) {
    yield* go(s, 4);
    yield* morph(s, 'android');
    yield* goFight(s, 24);
    yield* waitUntil(s, () => !alive(s, 'hopper'), 4, () => ({ attack: s.p.atkCd <= 0 }));
    yield* goFight(s, 30);
    yield* morph(s, 'raptor');
    yield* go(s, 31.9);
    yield* face(s, 1);
    yield* tap('special');
    yield* wait(0.3);
    yield* morph(s, 'tank');
    yield* shootUntil(s, 1, 'attack', () => !alive(s, 'turret'));
    yield* go(s, 41);
  },
  *'3-6'(s) {
    yield* go(s, 4);
    yield* morph(s, 'tank');
    yield* go(s, 10);
    while (s.boss && !s.boss.dead && !s.boss.dying) {
      if (s.room.fieldT <= 0) {
        yield* go(s, 10, {}, 3);
        yield* probe(s, [[10.4, 7.5], [4.4, 7.5], [4.4, 4.4], [4.4, 7.5], [18.4, 7.5], [18.4, 4.4]],
          () => s.room.ents.filter(e => e.kind === 'gen').every(g => g.down));
        yield* waitUntil(s, () => s.room.fieldT > 0, 1);
      } else {
        yield* go(s, 26, {}, 3);
        yield* shootUntil(s, 1, 'attack', () => s.room.fieldT <= 0 || !s.boss || s.boss.dying, 10);
      }
    }
    yield* waitUntil(s, () => !s.boss || s.boss.dead, 4);
    yield* go(s, 28.6);
    yield* morph(s, 'android');
    yield* go(s, 29);
    yield* climb(s, -1, 15);
  },
  *F(s) {
    const core = need => s.room.ents.find(e => e.kind === 'core' && e.need === need);
    const coreB = () => s.room.ents.find(e => e.kind === 'core' && e.need === 'any' && !e.encased);
    const coreC = () => s.room.ents.find(e => e.kind === 'core' && e.encased);
    yield* climb(s, -1);
    yield* go(s, 21);
    yield* morph(s, 'tank');
    yield* go(s, 16.4);
    yield* probe(s, [[16.4, 6], [16.4, 3.2]], () => core('probe').broken);
    yield* shootUntil(s, -1, 'attack', () => core('shell').broken, 10);
    yield* go(s, 28);
    yield* morph(s, 'raptor');
    yield* go(s, 29.4);
    yield* flameUntil(s, 1, () => tile(s, 32, 19) !== 'I');
    yield* go(s, 32.2);
    yield* waitUntil(s, () => coreC().broken, 4, () => ({ special: s.p.spCd <= 0 && s.p.swing === null }));
    yield* go(s, 29);
    yield* morph(s, 'android');
    yield* go(s, 31.5);
    yield* go(s, 25);
    yield* climb(s, -1);
    yield* go(s, 25.5);
    yield* jump(s, 0);
    yield* go(s, 27.2);
    yield* shootUntil(s, 1, 'special', () => coreB().broken, 10);
    // the eye comes down: shell it from the floor, topping up at the pod
    yield* go(s, 29);
    yield* waitUntil(s, () => s.p.ground, 3);
    yield* go(s, 31.8);
    yield* morph(s, 'tank');
    while (s.boss && !s.boss.dead && !s.boss.dying && s.status === 'play') {
      yield* shootUntil(s, -1, 'attack', () => !s.boss || s.boss.dying || s.p.energy < 40, 30);
      if (s.p.energy < 40) { yield* go(s, 36); yield* go(s, 31.8); }
    }
    yield* wait(5);
  },
};

// one pilot per run; restarts the room's script on every room change or respawn
export function createPilot(s, route = ROUTE) {
  let gen = null, room = null, body = null;
  return function next() {
    if (s.status !== 'play') { gen = null; return NONE; }
    if (s.room !== room || s.p !== body) {
      room = s.room; body = s.p;
      gen = route[room.id]?.(s) ?? null;
    }
    if (!gen) return NONE;
    const r = gen.next();
    if (r.done) { gen = null; return NONE; }
    return r.value;
  };
}
