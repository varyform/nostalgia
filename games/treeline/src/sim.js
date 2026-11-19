// The simulation: the player's Gadfly attack helicopter, the Grey Combine's tanks, carriers,
// trucks, AA guns, SAM batteries and radars, its Mantis helicopters and Stiletto jets, friendly
// convoys and survivors, every round, rocket and missile, the flares, and the mission's goal.
// Pure and deterministic: fixed 1/60 s steps, its own seeded random numbers, no DOM. The
// renderer, the sound and the HUD read its state and the `events` each step leaves.
//
//   const sim = createSim({ seed });
//   sim.reseed(n)                    // new random numbers (the app reseeds per mission attempt)
//   sim.load(missionIndex, { carry, airborne })   // spawn the mission: the Gadfly on the home pad,
//                                    //   rotor turning (airborne: 60 m up, 30 m/s, for the demo)
//   sim.step(ctrl)                   // one 1/60 s step
//   sim.status                       // 'fly' | 'down' (crashed or shot down) | 'failed' | 'landed'
//                                    //   (set down at the home pad with the goal done: the end)
//   sim.complete, sim.completeT      // the goal is done (and for how long); fly home or end it
//   sim.objectives() → { done, total, pct? }   // for the HUD and the debrief
//   sim.events                       // this step's events (below); the app clears it each step
//
// ctrl (every field optional):
//   pitch  −1..1   cyclic fore/aft: −1 pushed forward (nose down, speed up), +1 pulled back
//   roll   −1..1   cyclic left/right: +1 right
//   yaw    −1..1   pedals: +1 right
//   coll   −1..1   collective: assisted, a climb (+) or descent (−) command, released = hold height;
//                  unassisted, moves the lever up (+) or down (−) at about 0.5 per second
//   collective 0..1  sets the lever directly (unassisted; the autopilot's and touch's absolute use)
//   gun (held)     the chin cannon; fire, weapon, target, decoy, assist, hover (edges): fire the
//                  selected store, next store, next target, flares + chaff, toggle the flight
//                  assist, set the assisted speed hold to a hover
//   targetId       pick a target directly (the autopilot)
//
// The flight model is a helicopter's, not a jet's: thrust along the rotor disc's normal (the
// body's up, u), so tilting the disc with the cyclic accelerates the helicopter that way; the
// collective sets the thrust; pedals yaw. Thrust grows with translational lift (from ~12 m/s,
// full by ~25 m/s), with ground effect within a rotor's diameter of the ground, falls in thin
// air (the pass), and collapses in settling (vortex ring: sinking faster than ~6 m/s below
// ~10 m/s airspeed). Power needed (hover, induced, profile, parasite and climb) against power
// available sets torque; past it the rotor rpm droops, and with it the thrust. The tail fin
// weathervanes the nose into the airflow at speed. Assisted (the default): the cyclic flies
// commands — fore/aft trims a held forward speed (−8..82 m/s; released, it is kept; `hover`
// zeroes it), sideways banks into a coordinated turn at speed and slides sideways at low speed,
// released it levels and holds the heading; the collective is a climb-rate command, released it
// holds the barometric altitude — and the controller works the same lever, disc and pedals the
// raw model has, so droop and settling still bite. On the skids: set down at < 3.5 m/s down,
// < 6 m/s across, level within ~12°, on open flat ground (world.landable) is safe; harder is
// damage, much harder or into trees, water or a slope is a crash.
//
// ---------- the state the renderer and HUD read ----------
// sim.t, sim.theatre (index), sim.T (theatre data), sim.world (world.js), sim.mission (missions.js),
// sim.mi, sim.score, sim.kills { kind: n }, sim.shots, sim.hits, sim.reason (why failed/down)
// sim.player (P), an actor with:
//   pos, vel [x, y, z]; f (nose), u (rotor disc / body up), r (right) unit vectors
//   hdg (0 north, + clockwise), pitch (+ nose up), roll (+ right side down)   radians
//   speed (|vel|), gs (ground speed, horizontal), vs (vertical speed, + up), agl (radar altitude:
//   height over the ground or water under it), alt (pos[1])                    m, m/s
//   collective 0..1 (the lever), cyclic [x, y] −1..1 (stick: x right, y + pulled back), pedal −1..1
//   rpm (rotor, 1 = 100 %, droops toward 0.7), torque (1 = 100 %, red past 1.05), power 0..1.2
//   load 0..1 (blade loading: heavy collective, hard turns — the audio's 'load'), etl 0..1,
//   ge 0..1, settling 0..1 (vortex ring strength), rotor (blade angle, rad, for the renderer)
//   predictRocket(sim) → { pos, t } | null: where a rocket fired now lands (the HUD cue)
//   assist (bool), hold { speed, alt | null, hdg }: what the assist is holding
//   ground (on the skids), hp 0..100, alive, fuel 0..100 %, lowFuel
//   gun (rounds), gunYaw, gunPitch (the chin turret, body frame, radians; + right, + up),
//   slaved (the turret is following the target)
//   ammo { rkt, atm, aam }, sel (index into STORES), flares (decoy pairs left)
//   target (an actor or null), tgtSeen (line of sight to it now), lock 0..1 (lock progress for
//   the selected guided store), aboard (survivors carried, rescue)
// sim.actors: every unit, the player included (kind 'player'):
//   { id, kind, team 'red' | 'blue', air, pos, f, u (air), vel, speed, hp, alive, dying (a downed
//     aircraft still falling), deadT (s since destroyed), obj (an objective), turret (world yaw
//     of a tank's/AA gun's/SAM's turret), elev (its gun's elevation), sees (has the player in
//     sight now), rotor (blade angle, helicopters), arrived (a convoy at its road's end) }
// sim.bullets   [{ kind 'gun' | 'mg' | 'flak' | 'shell', team, pos, vel, tracer }]
// sim.rockets   [{ team, pos, vel }]
// sim.missiles  [{ kind 'atm' | 'aam' | 'sam' | 'eaam', team, pos, f, speed, t, burn (motor
//                  burns while t < burn), tgt, guided }]
// sim.decoys    [{ kind 'flare' | 'chaff', pos, vel, life }]
// sim.lockState 'off' | 'seek' | 'lock'     (the selected guided store on the target)
// sim.warn      null | 'missile' | 'radar' | 'rpm'   (what the warning panel shows, by priority)
// sim.threat    the nearest missile chasing the player (or null); sim.spikes: radars and SAM
//               trackers that have the player now (actors: their pos gives the RWR bearing)
// sim.seen      how many enemies have eyes on the player now
// sim.lz        { site, need (s on the ground), t (s so far), done } on a rescue, else null
// sim.landing   null | 'safe' | 'hard' (the last touchdown, for the HUD)
// sim.outside   the player is at the map's edge (being turned back)
//
// ---------- events (sim.events, cleared by the app after each step) ----------
//   start {}                       a mission was loaded
//   msg { text }                   a line for the message log
//   cannon { x, y, z }             one round from the chin gun (per round, ~10/s)
//   rocket {}                      a pair of rockets left the pods
//   missile { kind 'atm' | 'aam' } the player launched a guided store
//   launch { kind 'sam' | 'eaam', x, y, z }   a missile was launched at the player
//   efire { kind 'mg' | 'flak' | 'shell' | 'gun' | 'rocket', x, y, z }  an enemy weapon fired
//   flare { x, y, z }              a flare and chaff pair dropped
//   hit { kind, weapon, armor, x, y, z }  the player's round, rocket or missile struck kind
//                                  (armor: it glanced off a tank)
//   spark { x, y, z }              a round struck something
//   dust { x, y, z } / spout { x, y, z }   a round or rocket hit the ground / the water
//   boom { x, y, z, big, air, kind }       an explosion (kind: the unit, or 'rocket', 'missile',
//                                  'shell', 'player')
//   flak { x, y, z }               an AA airburst
//   damage { amount 0..1, src }    the Gadfly was hit
//   kill { id, kind, label, score } the player destroyed something
//   objective { kind } | { all: true }   an objective fell / the goal is done
//   complete {}                    the goal is done
//   fail { reason }                the mission failed
//   crash { x, y, z, wet }         the Gadfly hit the ground (or the water)
//   splash { x, y, z, big }        something fell into the water
//   land { home, lz, hard }        the skids touched down
//   liftoff {}                     off the skids
//   pickup { n, total }            a survivor climbed aboard (rescue)
//   treestrike { x, y, z }         the rotor clipped the treetops
//   settle {}                      vortex-ring onset
//   weapon { name }                the selected store changed (name: STORES key)
//   target { id }                  a new target was picked
//   lost {}                        a guided anti-tank missile lost its line of sight
//   lowfuel {}                     fuel under 20 %
//   pop { x, y, z }                a missile burned out in the air
import { MISSIONS } from './missions.js';
import { THEATRES } from './theatres.js';
import { CELL, HALF, N, createWorld, polyAt, smooth } from './world.js';

export const DT = 1 / 60;
export const G = 9.81;
// the stores FIRE launches (the chin gun has its own trigger)
export const STORES = ['rkt', 'atm', 'aam'];
export const STORE_NAME = { rkt: 'SLEET RKT', atm: 'THORN ATM', aam: 'WREN AAM' };
export const GUN_RANGE = 1600, RKT_RANGE = 2600, ATM_RANGE = 5000, AAM_RANGE = 3800;
export const ATM_CONE = 0.45, AAM_CONE = 0.3;
// the chin turret's limits (body frame)
export const GUN_YAW = 1.9, GUN_UP = 0.3, GUN_DOWN = 1.05;
export const BULLET_V = 900, RKT_V = 520;
// a helicopter's pos is this far above its skids
export const SKID = 1.8;
// below this height over the ground or the treetops, radars lose a helicopter in the clutter
export const CLUTTER = 20;

// hp, hit radius (r), half-length (hl, a capsule along f), score, label (the HUD), and what it
// does: armor (rounds glance), mover (drives a road), air (flies), weapons and ranges
export const KINDS = {
  player: { air: true, hp: 100, r: 7, label: 'GADFLY', team: 'blue' },
  tank: { hp: 160, r: 5, hl: 3.5, score: 400, armor: true, mover: true, speed: 9, shell: 2200, label: 'TANK' },
  apc: { hp: 70, r: 4.5, hl: 3, score: 250, mover: true, speed: 11, mg: 1300, label: 'APC' },
  truck: { hp: 30, r: 4, hl: 3, score: 150, mover: true, speed: 12, label: 'TRUCK' },
  fueler: { hp: 30, r: 4, hl: 3.5, score: 200, mover: true, speed: 12, label: 'FUELER' },
  aa: { hp: 50, r: 5, hl: 2.5, score: 350, flak: 2600, label: 'AA GUN' },
  aatrack: { hp: 60, r: 5, hl: 3, score: 400, mover: true, speed: 9, flak: 2400, label: 'AA TRACK' },
  sam: { hp: 50, r: 6, hl: 3, score: 500, sam: 6500, label: 'SAM' },
  radar: { hp: 60, r: 9, score: 450, radar: 9000, label: 'RADAR' },
  depot: { hp: 90, r: 14, score: 300, label: 'DEPOT' },
  bunker: { hp: 220, r: 12, score: 500, mg: 1300, label: 'BUNKER' },
  command: { hp: 260, r: 16, hl: 8, score: 1500, label: 'COMMAND' },
  bridge: { hp: 400, r: 8, hl: 60, score: 1200, label: 'BRIDGE' },
  mantis: { air: true, heli: true, hp: 60, r: 7, score: 600, speed: 55, top: 70, turn: 0.7, gun: 1400, eaam: 2, label: 'MANTIS' },
  stiletto: { air: true, jet: true, hp: 50, r: 8, score: 800, speed: 190, top: 230, turn: 0.45, gun: 1200, rockets: true, label: 'STILETTO' },
  // friends
  ally: { hp: 90, r: 4, hl: 3, mover: true, speed: 10, team: 'blue', label: 'CONVOY' },
  survivor: { hp: 1, r: 2, team: 'blue', label: 'SURVIVORS' },
};

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const headingOf = f => Math.atan2(f[0], -f[2]);
export const dirOf = (hdg, pitch = 0) => [Math.sin(hdg) * Math.cos(pitch), Math.sin(pitch), -Math.cos(hdg) * Math.cos(pitch)];

export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** v rotated by angle a about the unit axis k (Rodrigues) */
export function rot(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), d = dot(k, v) * (1 - c), x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d];
}
/** the nose, up and right vectors of a body at heading, pitch (+ nose up) and roll (+ right down) */
export function basis(hdg, pitch, roll) {
  const f = dirOf(hdg, pitch), r0 = [Math.cos(hdg), 0, Math.sin(hdg)], u0 = cross(r0, f);
  const c = Math.cos(roll), s = Math.sin(roll);
  return { f, u: [u0[0] * c + r0[0] * s, u0[1] * c + r0[1] * s, u0[2] * c + r0[2] * s], r: [r0[0] * c - u0[0] * s, r0[1] * c - u0[1] * s, r0[2] * c - u0[2] * s] };
}

const TMAX = 1.65 * G; // rotor thrust at full collective, nominal rpm, sea level, out of ground effect
const GUN_RATE = 0.1;
const COMPLETE_BONUS = 1500, LAND_BONUS = 1000;
// how sharp the Combine's gunners and pilots are, per theatre
const SKILL = [0.55, 0.75, 0.95];
// eye heights over a ground unit's pos (its sight for line of sight)
const EYE = { tank: 3, apc: 2.5, aa: 3, aatrack: 3, sam: 4, radar: 14, bunker: 3, truck: 2.2, fueler: 2.2, depot: 4, command: 5, bridge: 3, ally: 2.2, survivor: 1.5 };
const ARMED = new Set(['tank', 'apc', 'aa', 'aatrack', 'sam', 'bunker']);

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function segDist(p, a, b) {
  const ab = sub(b, a), t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1), 0, 1);
  return dist(p, add(a, mul(ab, t)));
}
/** the middle of a unit (what is aimed at): ground units stand on pos */
export const centre = a => (a.air ? a.pos : [a.pos[0], a.pos[1] + (a.kind === 'bridge' ? 1 : KINDS[a.kind].r * 0.6), a.pos[2]]);
/** an eye for line of sight */
const eye = a => (a.air ? a.pos : [a.pos[0], a.pos[1] + (EYE[a.kind] ?? 2), a.pos[2]]);
function shapeDist(p, a) {
  const K = KINDS[a.kind], c = centre(a);
  if (!K.hl) return dist(p, c);
  const ax = mul(a.f, K.hl);
  return segDist(p, sub(c, ax), add(c, ax));
}
function stepDist(p0, p1, a) {
  const K = KINDS[a.kind];
  if (!K.hl) return segDist(centre(a), p0, p1);
  let best = Infinity;
  for (let k = 0; k <= 4; k++) best = Math.min(best, shapeDist(add(p0, mul(sub(p1, p0), k / 4)), a));
  return best;
}

export function createSim({ seed = 1 } = {}) {
  let rnd = mulberry32(seed);
  const rr = (a, b) => a + (b - a) * rnd();
  let uid = 1;
  const S = {
    events: [], t: 0, mi: 0, mission: null, theatre: 0, T: null, world: null, skill: 0.5,
    player: null, actors: [], bullets: [], rockets: [], missiles: [], decoys: [],
    status: 'fly', statusT: 0, complete: false, completeT: 0, reason: '', score: 0, bonus: 0,
    kills: {}, shots: 0, hits: 0, wave: 0, waveT: -1, killsTotal: 0,
    lockState: 'off', warn: null, threat: null, spikes: [], seen: 0, lz: null, landing: null, outside: false,
    load, step, reseed, objectives, setAssist, actorById: id => S.actors.find(a => a.id === id) ?? null,
  };
  const emit = (type, e = {}) => S.events.push({ type, ...e });
  const msg = text => emit('msg', { text });
  const every = (period, phase = 0) => Math.floor((S.t + phase) / period) !== Math.floor((S.t + phase - DT) / period);
  function reseed(s) { rnd = mulberry32(s); }

  // ---------- spawning ----------
  function makeActor(kind, pos, f, extra = {}) {
    const K = KINDS[kind];
    const a = {
      id: uid++, kind, team: K.team ?? 'red', air: !!K.air, pos, f, u: [0, 1, 0], vel: [0, 0, 0], speed: 0,
      hp: K.hp, alive: true, dying: false, deadT: 0, obj: false, wave: 0, turret: headingOf(f), elev: 0, sees: false, rotor: 0, arrived: false, ...extra,
    };
    S.actors.push(a);
    return a;
  }
  function spawn(spec) {
    const W = S.world, K = KINDS[spec.kind], n = spec.n ?? 1, gap = spec.gap ?? 40;
    for (let k = 0; k < n; k++) {
      let x, z, f, road = null, s = 0;
      const dir = spec.dir ?? 1;
      if (spec.road) {
        road = W.road(spec.road).pts;
        s = (spec.s ?? 0) - k * gap * dir;
        const p = polyAt(road, s), fw = [p.dx * dir, 0, p.dz * dir], right = [-fw[2], 0, fw[0]];
        const o = spec.off ?? [0, 0];
        x = p.x + right[0] * o[0] + fw[0] * o[1]; z = p.z + right[2] * o[0] + fw[2] * o[1];
        f = spec.hdg != null ? dirOf((spec.hdg * Math.PI) / 180) : fw;
      } else {
        const at = typeof spec.at === 'string' ? W.site(spec.at) : { x: spec.at[0], z: spec.at[1] };
        f = dirOf(((spec.hdg ?? 0) * Math.PI) / 180);
        const right = [-f[2], 0, f[0]];
        x = at.x + (spec.off?.[0] ?? 0) + right[0] * k * gap - f[0] * k * gap * 0.4;
        z = at.z + (spec.off?.[1] ?? 0) + right[2] * k * gap - f[2] * k * gap * 0.4;
      }
      // a little variety: where exactly each one stands, or where an aircraft starts
      if (spec.kind !== 'bridge' && !(spec.road && spec.to != null)) {
        const j = K.air ? 150 : spec.obj ? 12 : 30;
        x += rr(-j, j); z += rr(-j, j);
      }
      const moving = !!spec.road && spec.to != null;
      let y = moving ? W.deckAt(x, z) : W.heightAt(x, z);
      if (K.air) y = W.heightAt(x, z) + (K.jet ? Math.max(300, spec.alt ?? 600) : (spec.alt ?? 70)) + (K.heli ? SKID : 0);
      const a = makeActor(spec.kind, [x, y, z], f, {
        obj: !!spec.obj, wave: spec.wave ?? 0, ai: spec.ai ?? 'patrol', road: moving ? road : null, s, dir, to: spec.to, anchor: [x, y, z], alt: spec.alt ?? 70,
        orbit: rnd() < 0.5 ? 1 : -1, lookT: rr(0, 0.25), gunCd: rr(1, 3), burst: 0, msl: K.eaam ?? 0, mslCd: rr(5, 9), lockT: 0, samCd: rr(3, 6), samAmmo: 3,
        flakCd: rr(0.5, 2), flakShots: 0, foe: null, pitch: 0, roll: 0, hdg: headingOf(f), jink: 0, jinkDir: 1, extend: 0, flares: 4, halted: false,
      });
      if (spec.kind === 'bridge') {
        const B = W.bridges.reduce((b, c) => (Math.hypot(c.x - x, c.z - z) < Math.hypot(b.x - x, b.z - z) ? c : b));
        a.pos = [B.x, B.y, B.z]; a.f = [B.dx, 0, B.dz];
      }
      if (K.air) { a.vel = mul([f[0], 0, f[2]], K.speed * (K.jet ? 1 : 0.5)); a.speed = len(a.vel); a.u = basis(a.hdg, 0, 0).u; }
    }
  }

  function load(mi, { carry = null, airborne = false, assist = true } = {}) {
    const M = MISSIONS[mi];
    S.mi = mi; S.mission = M; S.theatre = M.theatre; S.T = THEATRES[M.theatre]; S.world = createWorld(M.theatre);
    S.skill = SKILL[M.theatre];
    const W = S.world;
    S.t = 0; S.actors = []; S.bullets = []; S.rockets = []; S.missiles = []; S.decoys = [];
    S.status = 'fly'; S.statusT = 0; S.complete = false; S.completeT = 0; S.reason = ''; S.score = 0; S.bonus = 0;
    S.kills = {}; S.shots = 0; S.hits = 0; S.wave = 0; S.waveT = -1; S.killsTotal = 0;
    S.events.length = 0; S.lockState = 'off'; S.warn = null; S.threat = null; S.spikes = []; S.seen = 0; S.landing = null; S.outside = false;
    uid = 1;
    const st = M.start ?? S.T.start;
    let x = st.x, z = st.z, hdg = (st.heading * Math.PI) / 180;
    if (airborne) {
      // the demo starts on the way in: part way from home toward the objectives
      const objs = M.units.filter(u => u.obj || u.kind === 'ally');
      const at = u => (u.road ? polyAt(W.road(u.road).pts, u.s ?? 0) : typeof u.at === 'string' ? W.site(u.at) : { x: u.at[0], z: u.at[1] });
      const tgt = M.lz ? W.site(M.lz) : objs.length ? at(objs[0]) : { x: 0, z: 0 };
      x = st.x + (tgt.x - st.x) * 0.45; z = st.z + (tgt.z - st.z) * 0.45; hdg = Math.atan2(tgt.x - st.x, -(tgt.z - st.z));
    }
    const P = makeActor('player', [x, W.heightAt(x, z) + SKID + (airborne ? 45 : 0), z], dirOf(hdg), {
      team: 'blue', hdg, pitch: 0, roll: 0, q: 0, p: 0, r: [Math.cos(hdg), 0, Math.sin(hdg)],
      speed: 0, gs: 0, vs: 0, agl: 0, alt: 0, collective: airborne ? 0.6 : 0, cyclic: [0, 0], pedal: 0,
      rpm: 1, torque: 0.2, power: 0.2, load: 0, etl: 0, ge: 0, settling: 0, settled: false,
      assist, hold: { speed: airborne ? 30 : 0, alt: null, hdg: null }, ground: !airborne, fuel: 100, lowFuel: false,
      gun: M.load.gun, gunYaw: 0, gunPitch: -0.03, slaved: false, gunCd: 0,
      ammo: { rkt: M.load.rkt, atm: M.load.atm, aam: M.load.aam }, sel: 0, flares: M.load.flares, rocketSide: 1,
      target: null, tgtSeen: false, lock: 0, aboard: 0, treeT: 0, serviced: false, carry,
    });
    if (airborne) P.vel = mul(dirOf(hdg), 30);
    P.u = [0, 1, 0];
    S.player = P;
    P.sel = Math.max(0, STORES.findIndex(w => P.ammo[w] > 0));
    for (const spec of M.units) if ((spec.wave ?? 0) === 0) spawn(spec);
    S.lz = null;
    if (M.goal === 'rescue') {
      const site = W.site(M.lz);
      S.lz = { site, need: M.wait, t: 0, n: M.survivors, aboard: 0, done: false, on: false };
      for (let k = 0; k < M.survivors; k++) {
        const a = (k / M.survivors) * Math.PI * 2, sx = site.x + Math.cos(a) * (site.r + 12), sz = site.z + Math.sin(a) * (site.r + 12);
        makeActor('survivor', [sx, W.heightAt(sx, sz), sz], [0, 0, -1]);
      }
    }
    emit('start');
    msg(M.text);
  }
  function setAssist(on) {
    const P = S.player;
    P.assist = !!on;
    const fwd = [Math.sin(P.hdg), 0, -Math.cos(P.hdg)];
    P.hold = { speed: clamp(dot(P.vel, fwd), -8, 82), alt: null, hdg: null };
    msg(on ? 'Flight assist on' : 'Flight assist off');
  }

  // ---------- damage ----------
  function hurt(a, dmg, byPlayer, kind = '', armor = false, at = null) {
    if (!a.alive || dmg <= 0) return;
    a.hp -= dmg;
    if (a === S.player) {
      emit('damage', { amount: Math.min(1, dmg / 40), src: kind });
      if (a.hp <= 0) down('Shot down', true);
      return;
    }
    if (byPlayer) { S.hits++; const c = at ?? centre(a); emit('hit', { kind: a.kind, weapon: kind, armor, x: c[0], y: c[1], z: c[2] }); }
    if (a.hp > 0) return;
    a.alive = false; a.deadT = 0; a.dying = a.air;
    const K = KINDS[a.kind], c = centre(a);
    emit('boom', { x: c[0], y: c[1], z: c[2], big: !a.air || a.kind === 'stiletto', air: a.air, kind: a.kind });
    if (a.team === 'red') {
      if (byPlayer) {
        S.score += K.score; S.kills[a.kind] = (S.kills[a.kind] ?? 0) + 1; S.killsTotal++;
        emit('kill', { id: a.id, kind: a.kind, label: K.label, score: K.score });
      }
      if (a.obj) { emit('objective', { kind: a.kind }); const o = objectives(); if (o.done < o.total) msg(`${K.label} destroyed · ${o.done}/${o.total}`); }
    } else if (a.kind === 'ally') msg('A convoy truck is burning');
  }
  function down(reason, shot = false) {
    if (S.status !== 'fly' && S.status !== 'landed') return;
    const P = S.player;
    P.alive = false; P.hp = Math.min(P.hp, 0);
    S.status = 'down'; S.statusT = 0; S.reason = reason;
    if (shot) emit('boom', { x: P.pos[0], y: P.pos[1], z: P.pos[2], big: true, air: true, kind: 'player' });
  }
  function crash(reason) {
    const P = S.player, W = S.world, wet = W.wet(P.pos[0], P.pos[2]), gy = W.heightAt(P.pos[0], P.pos[2]);
    emit('crash', { x: P.pos[0], y: gy, z: P.pos[2], wet });
    emit('boom', { x: P.pos[0], y: gy + 2, z: P.pos[2], big: true, air: false, kind: 'player' });
    if (wet) emit('splash', { x: P.pos[0], y: W.water, z: P.pos[2], big: true });
    down(wet ? 'Ditched in the water' : reason);
  }
  function fail(reason) {
    if (S.status !== 'fly' || S.complete) return;
    S.status = 'failed'; S.statusT = 0; S.reason = reason;
    emit('fail', { reason });
    msg(reason);
  }
  function splash(p, R, dmg, byPlayer, team, kind) {
    for (const a of S.actors) {
      if (!a.alive || a.team === team || a.kind === 'survivor') continue;
      const d = shapeDist(p, a) - KINDS[a.kind].r;
      if (d < R) hurt(a, dmg * (1 - 0.7 * Math.max(0, d) / R), byPlayer, kind);
    }
  }

  // ---------- the Gadfly ----------
  const near = (a, s, r) => Math.hypot(a.pos[0] - s.x, a.pos[2] - s.z) < r;
  function flyPlayer(c) {
    const P = S.player, W = S.world, dt = DT;
    if (c.assist) setAssist(!P.assist);
    if (c.hover && P.assist) { P.hold.speed = 0; msg('Hover hold'); }
    const vh = [P.vel[0], 0, P.vel[2]], V = Math.hypot(vh[0], vh[2]);
    const sfc = W.heightAt(P.pos[0], P.pos[2]);
    P.agl = P.pos[1] - SKID - sfc;
    const sigma = Math.max(0.6, 1 - P.pos[1] / 18000);
    // translational lift, ground effect, settling
    P.etl = smooth(10, 24, V);
    P.ge = smooth(14, 0, P.agl) * (1 - smooth(8, 22, V));
    const st = P.ground ? 0 : smooth(5.5, 9, -P.vel[1]) * smooth(11, 4, V);
    P.settling += (st - P.settling) * Math.min(1, dt * (st > P.settling ? 1.5 : 3));
    if (P.settling > 0.3 && !P.settled) { P.settled = true; emit('settle'); msg('Settling: push forward or lower the collective'); }
    else if (P.settling < 0.08) P.settled = false;
    const lift = TMAX * sigma * (1 + 0.14 * P.etl) * (1 + 0.13 * P.ge) * (1 - 0.45 * P.settling);
    const fwd = [Math.sin(P.hdg), 0, -Math.cos(P.hdg)], right = [Math.cos(P.hdg), 0, Math.sin(P.hdg)];
    const vf = dot(vh, fwd), vr = dot(vh, right);
    // the tail fin turns the nose into the airflow
    const wv = vf > 2 ? clamp(Math.atan2(vr, vf), -1, 1) * 1.6 * smooth(6, 30, V) : 0;
    const pedGain = 1.1 * (1 - 0.5 * smooth(10, 40, V));
    const pitchIn = clamp(c.pitch ?? 0, -1, 1), rollIn = clamp(c.roll ?? 0, -1, 1), yawIn = clamp(c.yaw ?? 0, -1, 1), collIn = clamp(c.coll ?? 0, -1, 1);
    let qc, pc, ped;
    if (P.assist) {
      const H = P.hold;
      if (Math.abs(pitchIn) > 0.05) H.speed = clamp(H.speed - pitchIn * 16 * dt, -8, 82);
      const low = Math.abs(H.speed) < 12 && V < 16;
      let hr = 0, vlat = 0;
      if (low) { hr = rollIn * 0.9; vlat = yawIn * 8; }
      else hr = (G * Math.tan(rollIn * 0.6)) / Math.max(V, 15) + yawIn * 0.25;
      const turning = Math.abs(rollIn) > 0.04 || (!low && Math.abs(yawIn) > 0.04);
      if (turning || P.ground) H.hdg = null;
      else {
        if (H.hdg == null) H.hdg = P.hdg + (P.hdgRate ?? 0) * 0.25;
        hr = clamp(wrap(H.hdg - P.hdg) * 1.5, -0.6, 0.6);
      }
      // the velocity wanted, in the heading frame; tilt the disc toward the acceleration it needs
      const vw = add(mul(fwd, H.speed), mul(right, vlat));
      let a = mul(sub(vw, vh), 0.9);
      const al = Math.hypot(a[0], a[2]);
      if (al > 6.5) a = mul(a, 6.5 / al);
      a = add(a, mul(vh, 9e-4 * V));
      const af = dot(a, fwd), ar = dot(a, right) + vf * hr;
      // on the skids the disc stays near level until the Gadfly is light and clear
      const lim = P.ground ? 0.06 : 1;
      const thW = clamp(-Math.atan2(af, G), -0.6 * lim, 0.45 * lim), phW = clamp(Math.atan2(ar, G), -0.75 * lim, 0.75 * lim);
      qc = clamp((thW - P.pitch) * 3, -1.2, 1.2);
      pc = clamp((phW - P.roll) * 3.5, -1.8, 1.8);
      ped = clamp((hr - wv) / pedGain, -1, 1);
      // the collective: a climb-rate command; released, it holds the height
      let vsW;
      if (Math.abs(collIn) > 0.05) { H.alt = null; vsW = collIn > 0 ? collIn * 8 : collIn * (V < 12 ? 5 : 9); }
      else {
        if (H.alt == null) H.alt = P.pos[1] + P.vel[1] * 0.5;
        vsW = clamp((H.alt - P.pos[1]) * 0.9, -4, 4);
      }
      let coll;
      if (P.ground && collIn <= 0.05) { coll = 0; H.alt = null; }
      else {
        const need = (G + (vsW - P.vel[1]) * 2.2 + 0.25 * P.vel[1]) / Math.max(0.5, P.u[1]);
        coll = need / (lift * P.rpm * P.rpm);
        if (P.torque > 1.02) coll = Math.min(coll, P.collective - (P.torque - 1.02) * 0.6);
      }
      P.collective = clamp(P.collective + clamp(coll - P.collective, -1.5 * dt, 1.5 * dt), 0, 1);
      P.cyclic = [clamp(pc / 1.5, -1, 1), clamp(qc / 1.1, -1, 1)];
    } else {
      if (c.collective != null) P.collective = clamp(c.collective, 0, 1);
      else P.collective = clamp(P.collective + collIn * 0.5 * dt, 0, 1);
      qc = pitchIn * 1.0 - P.pitch * 0.3;
      pc = rollIn * 1.5 - P.roll * 0.3;
      ped = yawIn;
      P.cyclic = [rollIn, pitchIn];
    }
    P.pedal = ped;
    // attitude: the rates follow the stick, a little behind
    if (P.ground && P.collective < 0.5) {
      P.q = 0; P.p = 0;
      P.pitch *= 1 - Math.min(1, 6 * dt); P.roll *= 1 - Math.min(1, 6 * dt);
    } else {
      P.q += (qc - P.q) * Math.min(1, dt * 8);
      P.p += (pc - P.p) * Math.min(1, dt * 8);
      P.pitch = clamp(P.pitch + P.q * dt, -0.75, 0.6);
      P.roll = clamp(P.roll + P.p * dt, -1, 1);
    }
    P.hdgRate = P.ground ? (P.collective > 0.35 ? ped * 0.6 : 0) : ped * pedGain + wv;
    P.hdg = wrap(P.hdg + P.hdgRate * dt);
    const B = basis(P.hdg, P.pitch, P.roll);
    P.f = B.f; P.u = B.u; P.r = B.r;
    // thrust, power, torque and the rotor's rpm
    const T = lift * P.collective * P.rpm * P.rpm, tf = T / G;
    const ind = (0.62 * Math.pow(Math.max(0, tf), 1.5)) / Math.sqrt(sigma) / Math.sqrt(1 + (V / 14) ** 2) * (1 - 0.35 * P.ge);
    P.power = ind + 0.16 * P.rpm * P.rpm + 0.42 * (V / 80) ** 3 + Math.max(0, P.vel[1]) * 0.03;
    const avail = (P.fuel > 0 ? 1 : 0) * Math.pow(sigma, 0.7) * (P.hp < 40 ? 0.78 + 0.0055 * P.hp : 1);
    if (P.power > avail) P.rpm = Math.max(0.6, P.rpm - (P.power - avail) * 0.9 * dt);
    else P.rpm += (1 - P.rpm) * Math.min(1, 1.2 * dt);
    P.torque = P.power / Math.max(0.5, P.rpm);
    P.load = clamp(0.5 * (tf - 0.6) / 0.8 + 0.5 * (P.torque - 0.4) / 0.7, 0, 1);
    P.rotor += P.rpm * 31 * dt;
    // forces: thrust along the disc, gravity, drag; the settling rotor buffets
    const acc = [P.u[0] * T, P.u[1] * T - G, P.u[2] * T];
    acc[0] -= vh[0] * 9e-4 * V; acc[2] -= vh[2] * 9e-4 * V;
    acc[1] -= 0.25 * P.vel[1] + 0.004 * P.vel[1] * Math.abs(P.vel[1]);
    if (P.settling > 0.05) { acc[0] += rr(-1, 1) * P.settling * 2; acc[1] += rr(-1, 1) * P.settling * 2; acc[2] += rr(-1, 1) * P.settling * 2; }
    // the map's edge turns you back
    const out = Math.max(Math.abs(P.pos[0]), Math.abs(P.pos[2])) > HALF - 500;
    if (out) {
      const L = Math.hypot(P.pos[0], P.pos[2]) || 1;
      acc[0] -= (P.pos[0] / L) * 5; acc[2] -= (P.pos[2] / L) * 5;
      if (!S.outside) msg('The edge of the area: turn back');
    }
    S.outside = out;
    P.vel = add(P.vel, mul(acc, dt));
    if (P.ground) { P.vel[0] *= 1 - Math.min(1, 6 * dt); P.vel[2] *= 1 - Math.min(1, 6 * dt); }
    P.pos = add(P.pos, mul(P.vel, dt));
    P.speed = len(P.vel); P.gs = Math.hypot(P.vel[0], P.vel[2]); P.vs = P.vel[1]; P.alt = P.pos[1];
    // fuel, %/s
    if (P.fuel > 0) P.fuel = Math.max(0, P.fuel - (0.04 + 0.08 * P.power) * dt);
    if (!P.lowFuel && P.fuel < 20) { P.lowFuel = true; emit('lowfuel'); msg('Fuel low: return to the FARP'); }
    // the trees and the ground
    const sfcN = W.heightAt(P.pos[0], P.pos[2]), skid = P.pos[1] - SKID;
    P.agl = skid - sfcN;
    const i = Math.floor((P.pos[0] + HALF) / CELL), j = Math.floor((P.pos[2] + HALF) / CELL);
    const canopy = i >= 0 && j >= 0 && i < N && j < N ? W.canopy[j * N + i] : 0;
    P.treeT -= dt;
    if (!P.ground && canopy > 0 && skid < canopy) {
      if (canopy - skid > 4.5 || P.gs > 45) return crash('Flew into the trees');
      hurt(P, 14 * dt * (1 + P.gs / 10), false, 'trees');
      P.vel = mul(P.vel, 1 - 1.5 * dt);
      if (P.treeT <= 0) { P.treeT = 0.4; emit('treestrike', { x: P.pos[0], y: skid, z: P.pos[2] }); }
      if (!P.alive) return;
    }
    if (skid <= sfcN) {
      if (P.ground) {
        P.pos[1] = sfcN + SKID; P.vel[1] = Math.max(0, P.vel[1]);
        // tipped over on the skids, or dragged along the ground: a rollover
        if (Math.abs(P.pitch) > 0.35 || Math.abs(P.roll) > 0.35 || P.gs > 9) return crash('Rolled over');
      } else touchdown(sfcN, (sfcN - sfc) / dt);
    } else if (P.ground && skid > sfcN + 0.3) { P.ground = false; S.landing = null; P.serviced = false; emit('liftoff'); }
  }
  function touchdown(sfc, rise) {
    // the sink rate that counts is against the ground, which may be rising into the skids
    const P = S.player, W = S.world, vy = P.vel[1] - Math.max(0, rise), vhh = P.gs;
    const where = W.landable(P.pos[0], P.pos[2]), level = Math.abs(P.pitch) < 0.22 && Math.abs(P.roll) < 0.2;
    if (where === 'water') return crash('Ditched in the water');
    let hard = false;
    if (vy >= -3.5 && vhh < 6 && level && where === true) S.landing = 'safe';
    else if (vy >= -7.5 && vhh < 14 && Math.abs(P.pitch) < 0.35 && Math.abs(P.roll) < 0.35 && where !== 'trees') {
      hard = true; S.landing = 'hard';
      hurt(P, Math.max(0, -vy - 3.5) * 7 + Math.max(0, vhh - 6) * 2 + (where === true ? 0 : 12) + (level ? 0 : 10), false, 'landing');
      if (!P.alive) return crash('Crashed on landing');
      msg('Hard landing');
    } else return crash(where === 'trees' ? 'Crashed into the trees' : 'Crashed');
    P.ground = true; P.pos[1] = sfc + SKID; P.vel = [P.vel[0] * 0.3, 0, P.vel[2] * 0.3];
    P.q = 0; P.p = 0;
    const home = near(P, W.site('home'), W.site('home').r + 25), lz = !!S.lz && near(P, S.lz.site, S.lz.site.r + 40);
    emit('land', { home, lz, hard });
  }
  // the FARP rearms, refuels and patches the Gadfly while it sits on the pad
  function service(dt) {
    const P = S.player, W = S.world, M = S.mission, home = W.site('home');
    if (!P.ground || !near(P, home, home.r + 25) || P.collective > 0.5) return;
    if (!P.serviced) { P.serviced = true; msg('FARP: refuel and rearm'); }
    P.fuel = Math.min(100, P.fuel + 8 * dt);
    P.hp = Math.min(100, P.hp + 4 * dt);
    if (every(0.5)) {
      P.gun = Math.min(M.load.gun, P.gun + 50);
      for (const k of STORES) P.ammo[k] = Math.min(M.load[k], P.ammo[k] + (k === 'rkt' ? 4 : 1));
      P.flares = Math.min(M.load.flares, P.flares + 1);
    }
    if (P.fuel > 20) P.lowFuel = false;
  }

  // ---------- targeting ----------
  const losTo = (a, b) => S.world.clear(...eye(a), ...eye(b));
  function angleTo(from, f, p) {
    const d = sub(p, from), L = len(d);
    return { L, ang: Math.acos(clamp(dot(f, mul(d, 1 / (L || 1))), -1, 1)) };
  }
  function rankTarget(a, seen) {
    const P = S.player, { L, ang } = angleTo(P.pos, P.f, centre(a));
    return L * (0.6 + ang) * (a.obj ? 0.7 : 1) * (a.air && L < 4000 ? 0.5 : 1) * (seen ? 1 : 3) * (ARMED.has(a.kind) || a.air ? 0.8 : 1);
  }
  function candidates() {
    const P = S.player;
    return S.actors.filter(a => a.alive && a.team === 'red' && dist(a.pos, P.pos) < 7000)
      .map(a => ({ a, s: rankTarget(a, losTo(P, a)) })).sort((x, y) => x.s - y.s).map(x => x.a);
  }
  function pickTarget(next) {
    const P = S.player, list = candidates();
    if (!list.length) { P.target = null; return; }
    if (!next || !P.target) P.target = list[0];
    else P.target = list[(list.indexOf(P.target) + 1) % list.length];
    P.lock = 0;
    P.tgtSeen = losTo(P, P.target);
    emit('target', { id: P.target.id });
  }
  function sensors() {
    const P = S.player;
    if (P.target && !P.target.alive) { P.target = null; P.lock = 0; }
    if (!P.target && every(0.5)) {
      const c = candidates()[0];
      if (c && losTo(P, c) && dist(c.pos, P.pos) < 6000) { P.target = c; P.tgtSeen = true; emit('target', { id: c.id }); }
    }
    if (P.target) { if (every(0.1)) P.tgtSeen = losTo(P, P.target); } else P.tgtSeen = false;
    const w = STORES[P.sel], T = P.target;
    let can = false;
    const fits = T && P.ammo[w] > 0 && ((w === 'atm' && !T.air) || (w === 'aam' && T.air));
    if (fits && P.tgtSeen) {
      const { L, ang } = angleTo(P.pos, P.f, centre(T));
      can = w === 'atm' ? L < ATM_RANGE && ang < ATM_CONE : L < AAM_RANGE && L > 150 && ang < AAM_CONE;
    }
    P.lock = can ? Math.min(1, P.lock + DT / (w === 'atm' ? 1.0 : 0.6)) : 0;
    S.lockState = fits ? (P.lock >= 1 ? 'lock' : can ? 'seek' : 'off') : 'off';
  }

  // ---------- the chin gun and the stores ----------
  function slew(cur, want, rate) { return cur + clamp(want - cur, -rate * DT, rate * DT); }
  function aimGun() {
    const P = S.player, T = P.target;
    let wy = 0, wp = -0.03;
    P.slaved = false;
    if (T && T.alive && P.tgtSeen) {
      const c = centre(T), D = dist(c, P.pos), tof = D / BULLET_V;
      const aim = add(c, mul(sub(T.vel ?? [0, 0, 0], P.vel), tof));
      aim[1] += 0.5 * G * tof * tof;
      const d = norm(sub(aim, P.pos)), lx = dot(d, P.r), ly = dot(d, P.u), lz = dot(d, P.f);
      const yaw = Math.atan2(lx, lz), pitch = Math.atan2(ly, Math.hypot(lx, lz));
      if (D < GUN_RANGE * 1.4 && Math.abs(yaw) < GUN_YAW && pitch < GUN_UP && pitch > -GUN_DOWN) { wy = yaw; wp = pitch; P.slaved = true; }
    }
    P.gunYaw = slew(P.gunYaw, wy, 2.4); P.gunPitch = slew(P.gunPitch, wp, 2.4);
  }
  function gunDir(P) {
    const cy = Math.cos(P.gunYaw), sy = Math.sin(P.gunYaw), cp = Math.cos(P.gunPitch), sp = Math.sin(P.gunPitch);
    return norm(add(add(mul(P.f, cp * cy), mul(P.r, cp * sy)), mul(P.u, sp)));
  }
  function shoot(owner, from, dir, spread, kind, dmg, v = BULLET_V, life = 2.2, extra = {}) {
    const d = norm(add(dir, [rr(-spread, spread), rr(-spread, spread), rr(-spread, spread)]));
    S.bullets.push({ kind, team: owner.team, owner, pos: from, vel: add(mul(d, v), owner.vel ?? [0, 0, 0]), life, dmg, tracer: rnd() < 0.4, ...extra });
  }
  function launch(kind, owner, tgt, from, f) {
    const spec = {
      atm: { max: 300, turn: 3, life: 20, burn: 2.5 }, aam: { max: 600, turn: 1.4, life: 8, burn: 2.5 },
      sam: { max: 520, turn: 0.8, life: 18, burn: 4 }, eaam: { max: 450, turn: 0.75, life: 7, burn: 2 },
    }[kind];
    const m = { kind, team: owner.team, owner, tgt, pos: from, f, speed: Math.max(60, len(owner.vel ?? [0, 0, 0])), ...spec, t: 0, guided: !!tgt, lostT: 0, seen: new Set() };
    S.missiles.push(m);
    if (tgt === S.player) emit('launch', { kind, x: from[0], y: from[1], z: from[2] });
    return m;
  }
  function fireStores(c) {
    const P = S.player, w = STORES[P.sel];
    if (c.weapon) {
      for (let k = 1; k <= STORES.length; k++) {
        const n = (P.sel + k) % STORES.length;
        if (P.ammo[STORES[n]] > 0) { if (n !== P.sel) { P.sel = n; P.lock = 0; } break; }
      }
      emit('weapon', { name: STORES[P.sel] });
    }
    if (c.targetId != null) { const t = S.actors.find(a => a.id === c.targetId && a.alive); if (t && t !== P.target) { P.target = t; P.lock = 0; P.tgtSeen = losTo(P, t); } }
    if (c.target) pickTarget(true);
    if (c.decoy && P.flares > 0) {
      P.flares--;
      for (const kind of ['flare', 'chaff']) {
        const d = { kind, team: 'blue', owner: P, pos: [...P.pos], vel: add(mul(P.vel, 0.5), [rr(-8, 8), -4, rr(-8, 8)]), life: kind === 'flare' ? 3 : 4 };
        S.decoys.push(d);
        decoyCheck(P, d);
      }
      emit('flare', { x: P.pos[0], y: P.pos[1], z: P.pos[2] });
    }
    if (!c.fire || P.ammo[w] <= 0) return;
    const from = add(P.pos, mul(P.u, -0.8));
    if (w === 'rkt') {
      const n = Math.min(2, P.ammo.rkt);
      for (let k = 0; k < n; k++) {
        P.rocketSide = -P.rocketSide;
        const dir = norm(add(P.f, mul(P.u, -0.012)));
        S.rockets.push({ team: 'blue', pos: add(from, mul(P.r, 1.6 * P.rocketSide)), vel: add(add(mul(dir, RKT_V), P.vel), mul(P.r, rr(-2.5, 2.5))), life: 6 });
      }
      P.ammo.rkt -= n; S.shots += n;
      emit('rocket');
    } else if (w === 'atm' || w === 'aam') {
      if (P.lock < 1) { msg(P.target ? (w === 'atm' && P.target.air ? 'Thorns are for ground targets' : w === 'aam' && !P.target.air ? 'Wrens are for aircraft' : 'No lock') : 'No target'); return; }
      P.ammo[w]--; S.shots++;
      const m = launch(w, P, P.target, add(from, mul(P.r, w === 'atm' ? 1.8 : -1.8)), norm(add(P.f, [0, 0.03, 0])));
      m.speed = P.speed + 40;
      emit('missile', { kind: w });
      if (w === 'aam' || P.ammo[w] === 0) P.lock = 0;
    }
  }
  // each missile chasing the decoy's owner rolls once per decoy: fooled, or not
  function decoyCheck(owner, d) {
    for (const m of S.missiles) {
      if (m.tgt !== owner || m.seen.has(d)) continue;
      m.seen.add(d);
      const ir = m.kind === 'aam' || m.kind === 'eaam';
      if (ir !== (d.kind === 'flare')) continue;
      const D = dist(m.pos, owner.pos), chance = (D < 2500 ? 0.7 : 0.45) * (owner === S.player ? 1 : 0.7);
      if (rnd() < chance) m.tgt = d;
    }
  }

  // ---------- the Combine: who it can see ----------
  function blues() {
    const out = [];
    for (const a of S.actors) if (a.alive && a.team === 'blue' && a.kind !== 'survivor') out.push(a);
    return out;
  }
  // radar and SAM trackers can't see a helicopter low in the ground clutter (near the treetops)
  const cluttered = P => P.ground || P.pos[1] - SKID - S.world.topAt(P.pos[0], P.pos[2]) < CLUTTER;
  function look(a, range, radar) {
    const P = S.player;
    let foe = null, best = Infinity;
    for (const b of blues()) {
      const D = dist(a.pos, b.pos);
      if (D > range || (radar && (b !== P || cluttered(P)))) continue;
      const score = D * (b === P ? 0.6 : 1);
      if (score < best && losTo(a, b)) { best = score; foe = b; }
    }
    return foe;
  }

  // ---------- ground units ----------
  function convoyHalt(a) {
    // the convoy stops for trouble ahead: an armed Combine unit near it, or a stopped truck in front
    for (const b of S.actors) {
      if (!b.alive || b.team !== 'red' || !ARMED.has(b.kind) || b.air) continue;
      if (Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]) < 480) return true;
    }
    for (const b of S.actors) if (b !== a && b.alive && b.kind === 'ally' && !b.arrived && b.road === a.road && (b.s - a.s) * a.dir > 0 && (b.s - a.s) * a.dir < 38) return true;
    return false;
  }
  function groundUnit(a, dt) {
    const K = KINDS[a.kind], P = S.player, W = S.world;
    if (a.road && !a.arrived) {
      a.halted = a.kind === 'ally' ? convoyHalt(a) : false;
      if (!a.halted) {
        a.s += K.speed * a.dir * dt;
        if ((a.s - a.to) * a.dir >= 0) {
          a.s = a.to; a.arrived = true;
          if (a.kind === 'ally') msg('A convoy truck is through');
        }
        const p = polyAt(a.road, a.s);
        a.pos = [p.x, W.deckAt(p.x, p.z), p.z]; a.f = [p.dx * a.dir, 0, p.dz * a.dir]; a.vel = mul(a.f, K.speed);
      }
      if (a.halted || a.arrived) a.vel = [0, 0, 0];
    }
    if (a.kind === 'survivor') return walk(a, dt);
    if (a.team !== 'red' || (!ARMED.has(a.kind) && a.kind !== 'radar')) return;
    const sk = S.skill;
    // look about, four times a second
    a.lookT -= dt;
    if (a.lookT <= 0) {
      a.lookT = 0.25;
      const range = K.radar ?? K.sam ?? (K.flak ? K.flak * 1.15 : 0) ?? 0;
      if (K.radar || K.sam) a.foe = P.alive && !cluttered(P) && dist(a.pos, P.pos) < range && losTo(a, P) ? P : null;
      else a.foe = look(a, Math.max(K.shell ?? 0, K.mg ?? 0, K.flak ?? 0) * 1.15, false);
      if (K.flak && a.foe && a.foe !== P) a.foe = null; // AA guns shoot at aircraft
      a.sees = a.foe === P;
    }
    const T = a.foe?.alive ? a.foe : null;
    if (T) a.turret += clamp(wrap(Math.atan2(T.pos[0] - a.pos[0], -(T.pos[2] - a.pos[2])) - a.turret), -1.1 * dt, 1.1 * dt);
    a.gunCd -= dt; a.flakCd -= dt; a.samCd -= dt;
    if (!T) { a.lockT = Math.max(0, a.lockT - dt * 2); return; }
    const c = centre(T), D = dist(eye(a), c), want = Math.atan2(c[0] - a.pos[0], -(c[2] - a.pos[2]));
    const aligned = Math.abs(wrap(want - a.turret)) < 0.12;
    const from = eye(a);
    // a tank gun can hit a helicopter that hovers or comes close; one moving fast is a lucky shot
    if (K.shell && D < K.shell && aligned && a.gunCd <= 0 && (!T.air || T.gs < 22 || D < 1200)) {
      const tof = D / 750, aim = add(c, mul(T.vel ?? [0, 0, 0], tof * (0.4 + 0.6 * sk)));
      aim[1] += 0.5 * G * tof * tof;
      shoot(a, from, norm(sub(aim, from)), 0.012 + (1 - sk) * 0.012, 'shell', 15, 750, 4, { splash: 6 });
      a.gunCd = rr(6, 9) / sk;
      emit('efire', { kind: 'shell', x: from[0], y: from[1], z: from[2] });
    }
    if (K.mg && D < K.mg && aligned && a.gunCd <= 0) {
      if (a.burst <= 0) a.burst = 6;
      const tof = D / 800, aim = add(c, mul(T.vel ?? [0, 0, 0], tof * sk));
      aim[1] += 0.5 * G * tof * tof;
      shoot(a, from, norm(sub(aim, from)), 0.026 + (1 - sk) * 0.02, 'mg', 3, 800, 2);
      a.burst--; a.gunCd = a.burst > 0 ? 0.12 : rr(2, 3.5) / sk;
      if (a.burst === 5) emit('efire', { kind: 'mg', x: from[0], y: from[1], z: from[2] });
    }
    if (K.flak && D < K.flak && T.air && T.agl > 6 && a.flakCd <= 0) {
      const tof = D / 800, aim = add(c, mul(T.vel, tof * rr(0.7, 1.1))), err = (14 + D * 0.014) * (1.5 - 0.6 * sk);
      const p = add(aim, [rr(-err, err), rr(-err, err), rr(-err, err)]);
      shoot(a, from, norm(sub(p, from)), 0, 'flak', 0, 800, tof, { fuse: tof });
      if (++a.flakShots >= 4) { a.flakShots = 0; a.flakCd = rr(2.5, 3.5) / (0.6 + 0.4 * sk); } else a.flakCd = 0.18;
      if (a.flakShots === 1) emit('efire', { kind: 'flak', x: from[0], y: from[1], z: from[2] });
    }
    if (K.radar || K.sam) S.spikes.push(a);
    if (K.sam) {
      // a search radar nearby that sees the Gadfly too cuts the time to a launch
      const helped = S.actors.some(b => b.alive && b.kind === 'radar' && b.sees && dist(b.pos, a.pos) < 4000);
      a.lockT += dt * (helped ? 1.6 : 1);
      if (a.lockT > 3 && a.samCd <= 0 && a.samAmmo > 0 && D < K.sam) {
        a.samAmmo--; a.samCd = rr(9, 12) / (0.7 + 0.3 * sk); a.lockT = 1.5;
        launch('sam', a, T, add(from, [0, 2, 0]), norm(add(norm(sub(c, from)), [0, 0.45, 0])));
        msg('SAM launch!');
      }
    }
  }
  // survivors walk to the Gadfly once it is down at the landing zone
  function walk(a, dt) {
    const P = S.player, L = S.lz;
    if (!L || !L.on || !P.ground) return;
    const dx = P.pos[0] - a.pos[0], dz = P.pos[2] - a.pos[2], D = Math.hypot(dx, dz);
    if (D > 4) { a.pos[0] += (dx / D) * 2.2 * dt; a.pos[2] += (dz / D) * 2.2 * dt; a.pos[1] = S.world.heightAt(a.pos[0], a.pos[2]); a.f = [dx / D, 0, dz / D]; }
  }

  // ---------- Combine aircraft ----------
  function pickAirFoe(a) {
    const P = S.player;
    if (a.ai === 'strike') {
      // the convoy's lead, or the landing zone (the Gadfly there), else the Gadfly
      const lead = S.actors.filter(b => b.alive && b.kind === 'ally' && !b.arrived).sort((x, y) => (y.s - x.s) * y.dir)[0];
      if (lead && !(P.alive && dist(P.pos, a.pos) < 1500)) return lead;
    }
    return P.alive ? P : null;
  }
  function flyHeli(a, dt) {
    const K = KINDS[a.kind], W = S.world, P = S.player, sk = S.skill;
    a.lookT -= dt;
    if (a.lookT <= 0) {
      a.lookT = 0.3;
      const f = pickAirFoe(a);
      a.foe = f;
      a.sees = !!f && dist(a.pos, f.pos) < 4500 && losTo(a, f) && !(f === P && P.ground && dist(a.pos, P.pos) > 2500);
    }
    const T = a.foe?.alive ? a.foe : null;
    const knows = T && (a.sees || a.ai === 'hunt' || a.ai === 'strike' || (a.hp < KINDS[a.kind].hp && T === P));
    let vw, face = null, agl = a.alt;
    if (knows) {
      const d = sub(T.pos, a.pos), D = Math.hypot(d[0], d[2]), dh = [d[0] / (D || 1), 0, d[2] / (D || 1)];
      if (D > 1250 || !a.sees) vw = mul(dh, K.top);
      else {
        // stand off and fire, sliding sideways now and then
        a.jink -= dt;
        if (a.jink <= 0) { a.jink = rr(2, 4); a.jinkDir = rnd() < 0.5 ? -1 : 1; }
        vw = add(mul(dh, (D - 1000) * 0.05), mul([-dh[2], 0, dh[0]], 9 * a.jinkDir));
        face = Math.atan2(d[0], -d[2]);
      }
      if (!a.sees) agl = Math.min(agl, 45);
    } else {
      // patrol: an orbit round the anchor
      const rx = a.pos[0] - a.anchor[0], rz = a.pos[2] - a.anchor[2], R = Math.hypot(rx, rz) || 1;
      const tan = [(-rz / R) * a.orbit, 0, (rx / R) * a.orbit], radial = (900 - R) / 900;
      vw = mul(norm([tan[0] + (rx / R) * radial, 0, tan[2] + (rz / R) * radial]), K.speed * 0.6);
    }
    // keep off the map's edge
    if (Math.max(Math.abs(a.pos[0]), Math.abs(a.pos[2])) > HALF - 600) vw = mul(norm([-a.pos[0], 0, -a.pos[2]]), K.speed);
    // the ground ahead sets the height wanted
    let gy = W.topAt(a.pos[0], a.pos[2]);
    for (const k of [1, 2, 3.5]) gy = Math.max(gy, W.topAt(a.pos[0] + a.vel[0] * k, a.pos[2] + a.vel[2] * k));
    const yW = gy + agl + SKID;
    const acc = [(vw[0] - a.vel[0]) * 0.8, clamp((yW - a.pos[1]) * 0.6, -6, 8) - a.vel[1], (vw[2] - a.vel[2]) * 0.8];
    const al = Math.hypot(acc[0], acc[2]);
    if (al > 5) { acc[0] *= 5 / al; acc[2] *= 5 / al; }
    a.vel = add(a.vel, mul(acc, dt));
    a.pos = add(a.pos, mul(a.vel, dt));
    a.pos[1] = Math.max(a.pos[1], W.topAt(a.pos[0], a.pos[2]) + SKID + 4);
    a.speed = len(a.vel);
    const hs = Math.hypot(a.vel[0], a.vel[2]);
    const wantH = face ?? (hs > 5 ? Math.atan2(a.vel[0], -a.vel[2]) : a.hdg);
    a.hdg = wrap(a.hdg + clamp(wrap(wantH - a.hdg), -K.turn * dt, K.turn * dt));
    const fw = [Math.sin(a.hdg), 0, -Math.cos(a.hdg)], rt = [Math.cos(a.hdg), 0, Math.sin(a.hdg)];
    a.pitch += (clamp(-dot(acc, fw) / G - (hs / K.top) * 0.18, -0.5, 0.4) - a.pitch) * Math.min(1, dt * 3);
    a.roll += (clamp(dot(acc, rt) / G, -0.6, 0.6) - a.roll) * Math.min(1, dt * 3);
    const B = basis(a.hdg, a.pitch, a.roll);
    a.f = B.f; a.u = B.u; a.rotor += 31 * dt;
    a.agl = a.pos[1] - SKID - W.heightAt(a.pos[0], a.pos[2]);
    // weapons
    a.gunCd -= dt; a.mslCd -= dt;
    if (!T || !a.sees) return;
    const c = centre(T), D = dist(c, a.pos), ang = Math.acos(clamp(dot(norm([c[0] - a.pos[0], 0, c[2] - a.pos[2]]), fw), -1, 1));
    if (D < K.gun && ang < 0.12 && a.gunCd <= 0) {
      if (a.burst <= 0) a.burst = 8;
      const tof = D / BULLET_V, aim = add(c, mul(T.vel ?? [0, 0, 0], tof * sk));
      aim[1] += 0.5 * G * tof * tof;
      const from = add(a.pos, mul(B.u, -1));
      shoot(a, from, norm(sub(aim, from)), 0.018 + (1 - sk) * 0.014, 'gun', 4, BULLET_V, 2.2);
      a.burst--; a.gunCd = a.burst > 0 ? 0.1 : rr(1.5, 2.5) / sk;
      if (a.burst === 7) emit('efire', { kind: 'gun', x: from[0], y: from[1], z: from[2] });
    }
    if (T === P && a.msl > 0 && a.mslCd <= 0 && D > 700 && D < 3000 && ang < 0.25 && !P.ground) {
      a.msl--; a.mslCd = rr(10, 15) / sk;
      launch('eaam', a, T, add(a.pos, mul(B.u, -1.5)), norm(sub(c, a.pos)));
    }
  }
  function flyJet(a, dt) {
    const K = KINDS[a.kind], W = S.world, P = S.player, sk = S.skill;
    a.lookT -= dt;
    if (a.lookT <= 0) {
      a.lookT = 0.3;
      const D = P.alive ? dist(a.pos, P.pos) : Infinity;
      a.sees = D < 6000 && ((P.agl > 40 && a.ai === 'hunt') || losTo(a, P));
      a.foe = P.alive ? P : null;
    }
    let d = a.f, speed = K.speed, attack = false;
    const T = a.foe?.alive ? a.foe : null;
    if (a.extend > 0) { a.extend -= dt; d = norm([a.f[0], 0.15, a.f[2]]); speed = K.top; }
    else if (T && a.sees) {
      const D = dist(T.pos, a.pos), lead = D / (BULLET_V + a.speed);
      d = norm(sub(add(T.pos, mul(T.vel, lead * sk)), a.pos));
      speed = D > 2500 ? K.top : K.speed;
      attack = true;
      if (D < 350) a.extend = rr(4, 6);
    } else {
      const rx = a.pos[0] - a.anchor[0], rz = a.pos[2] - a.anchor[2], R = Math.hypot(rx, rz) || 1;
      const tan = [(-rz / R) * a.orbit, 0, (rx / R) * a.orbit], radial = (2200 - R) / 2200;
      d = norm([tan[0] + (rx / R) * radial, (a.anchor[1] - a.pos[1]) / 1200, tan[2] + (rz / R) * radial]);
    }
    if (Math.max(Math.abs(a.pos[0]), Math.abs(a.pos[2])) > HALF - 900) d = norm([-a.pos[0], 0.05, -a.pos[2]]);
    // terrain: stay 120 m clear of the ground ahead
    let need = 0;
    for (const k of [1, 2, 3.5]) {
      const p = add(a.pos, mul([a.f[0], 0, a.f[2]], a.speed * k));
      need = Math.max(need, W.heightAt(p[0], p[2]) + 140 - (a.pos[1] + d[1] * a.speed * k * 0.5));
    }
    if (a.pos[1] - W.heightAt(a.pos[0], a.pos[2]) < 110) need = Math.max(need, 300);
    if (need > 0) d = norm([d[0], Math.max(d[1], Math.min(0.8, need / 500)), d[2]]);
    const f0 = a.f, ca = clamp(dot(a.f, d), -1, 1), ang = Math.acos(ca);
    if (ang > 1e-4) {
      let ax = cross(a.f, d);
      if (len(ax) < 1e-6) ax = [0, 1, 0];
      a.f = norm(rot(a.f, norm(ax), Math.min(ang, K.turn * (0.8 + 0.2 * sk) * dt)));
    }
    a.speed += (speed - a.speed) * Math.min(1, dt * 0.5);
    const yawRate = Math.atan2(cross(f0, a.f)[1], dot(f0, a.f)) / dt;
    a.roll += (clamp(Math.atan((-yawRate * a.speed) / G), -1.3, 1.3) - a.roll) * Math.min(1, dt * 3);
    a.hdg = headingOf(a.f); a.pitch = Math.asin(clamp(a.f[1], -1, 1));
    a.u = basis(a.hdg, a.pitch, a.roll).u;
    a.vel = mul(a.f, a.speed);
    a.pos = add(a.pos, mul(a.vel, dt));
    a.agl = a.pos[1] - W.heightAt(a.pos[0], a.pos[2]);
    if (a.agl < 2) { a.hp = 0; a.alive = false; emit('boom', { x: a.pos[0], y: a.pos[1], z: a.pos[2], big: true, air: false, kind: a.kind }); return; }
    a.gunCd -= dt; a.mslCd -= dt;
    if (!attack) return;
    const c = centre(T), D = dist(c, a.pos), ag = Math.acos(clamp(dot(a.f, norm(sub(c, a.pos))), -1, 1));
    if (D < K.gun && ag < 0.05 && a.gunCd <= 0) {
      if (a.burst <= 0) a.burst = 10;
      shoot(a, add(a.pos, mul(a.f, 6)), a.f, 0.02 + (1 - sk) * 0.015, 'gun', 4, BULLET_V, 2);
      a.burst--; a.gunCd = a.burst > 0 ? 0.07 : rr(1, 2) / sk;
      if (a.burst === 9) emit('efire', { kind: 'gun', x: a.pos[0], y: a.pos[1], z: a.pos[2] });
    }
    if (D < 1500 && D > 700 && ag < 0.04 && a.mslCd <= 0) {
      a.mslCd = rr(6, 9);
      for (let k = 0; k < 4; k++) S.rockets.push({ team: 'red', owner: a, pos: add(a.pos, mul(a.u, -1.5)), vel: add(mul(norm(add(a.f, [rr(-0.012, 0.012), rr(-0.012, 0.012), rr(-0.012, 0.012)])), RKT_V), a.vel), life: 5 });
      emit('efire', { kind: 'rocket', x: a.pos[0], y: a.pos[1], z: a.pos[2] });
    }
  }

  // ---------- projectiles ----------
  function struck(p0, p1, team, pad = 0) {
    for (const a of S.actors) {
      if (!a.alive || a.team === team || a.kind === 'survivor') continue;
      const c = a.air ? a.pos : a.pos;
      if (Math.abs(c[0] - p1[0]) > 300 || Math.abs(c[2] - p1[2]) > 300) continue;
      if (stepDist(p0, p1, a) < KINDS[a.kind].r + pad) return a;
    }
    return null;
  }
  function stepBullets(dt) {
    const W = S.world, P = S.player;
    S.bullets = S.bullets.filter(b => {
      b.vel[1] -= G * dt;
      const p1 = add(b.pos, mul(b.vel, dt));
      b.life -= dt;
      if (b.kind === 'flak') {
        b.pos = p1;
        if (b.life > 0) return true;
        emit('flak', { x: p1[0], y: p1[1], z: p1[2] });
        for (const a of S.actors) if (a.alive && a.team !== b.team && a.air) { const d = dist(a.pos, p1); if (d < 16) hurt(a, 7 * (1 - d / 16) + 2, false, 'flak'); }
        return false;
      }
      const a = struck(b.pos, p1, b.team, b.kind === 'shell' ? 1 : 0);
      if (a) {
        emit('spark', { x: p1[0], y: p1[1], z: p1[2] });
        if (b.owner === P) {
          const K = KINDS[a.kind], armor = !!K.armor, dmg = armor ? 2 : a.air ? 9 : K.hl > 10 || a.kind === 'command' || a.kind === 'bunker' ? 3 : 7;
          hurt(a, dmg, true, 'gun', armor, p1);
        } else if (b.splash) {
          emit('boom', { x: p1[0], y: p1[1], z: p1[2], big: false, air: false, kind: 'shell' });
          hurt(a, b.dmg, false, b.kind);
        } else hurt(a, b.dmg, false, b.kind);
        return false;
      }
      if (p1[1] < W.heightAt(p1[0], p1[2])) {
        const gy = W.heightAt(p1[0], p1[2]);
        if (b.splash) { emit('boom', { x: p1[0], y: gy + 1, z: p1[2], big: false, air: false, kind: 'shell' }); splash([p1[0], gy + 1, p1[2]], b.splash, b.dmg * 0.6, false, b.team, b.kind); }
        else if (b.owner === P || rnd() < 0.15) emit(W.wet(p1[0], p1[2]) ? 'spout' : 'dust', { x: p1[0], y: gy, z: p1[2] });
        return false;
      }
      b.pos = p1;
      return b.life > 0;
    });
    S.rockets = S.rockets.filter(o => {
      o.life -= dt;
      o.vel[1] -= G * dt * 0.3;
      const p0 = o.pos, p1 = add(o.pos, mul(o.vel, dt));
      o.pos = p1;
      const by = o.team === 'blue';
      const a = struck(p0, p1, o.team, 0.5);
      if (a) {
        const c = add(p0, mul(sub(p1, p0), 0.5));
        emit('boom', { x: c[0], y: c[1], z: c[2], big: false, air: a.air, kind: 'rocket' });
        hurt(a, by ? 55 : 22, by, 'rocket', false, c);
        splash(c, 12, by ? 18 : 8, by, o.team, 'rocket');
        return false;
      }
      const gy = W.heightAt(p1[0], p1[2]);
      if (p1[1] < gy) {
        const wet = W.wet(p1[0], p1[2]);
        emit(wet ? 'splash' : 'boom', { x: p1[0], y: gy + 1, z: p1[2], big: false, air: false, kind: 'rocket' });
        splash([p1[0], gy + 2, p1[2]], 12, 30, by, o.team, 'rocket');
        return false;
      }
      return o.life > 0;
    });
  }
  function stepMissiles(dt) {
    const W = S.world, P = S.player;
    S.missiles = S.missiles.filter(m => {
      m.t += dt; m.life -= dt;
      if (m.t < m.burn) m.speed = Math.min(m.max, m.speed + (m.kind === 'atm' ? 160 : 300) * dt);
      else m.speed = Math.max(120, m.speed - (12 + m.speed * 0.05) * dt);
      const T = m.tgt;
      if (T && (T.alive === false || (T.life !== undefined && T.life <= 0))) m.tgt = null;
      // command guidance: the Thorn needs the Gadfly's sight on the target, a SAM its launcher's
      if (m.tgt && (m.kind === 'atm' || m.kind === 'sam') && every(0.1, m.t)) {
        const ok = m.tgt.kind === 'flare' || m.tgt.kind === 'chaff' || (m.kind === 'atm' ? P.alive && losTo(P, m.tgt) : m.owner.alive && losTo(m.owner, m.tgt) && !(m.tgt === P && cluttered(P)));
        m.lostT = ok ? 0 : m.lostT + 0.1;
        if (m.lostT > (m.kind === 'atm' ? 0.4 : 0.7)) {
          if (m.kind === 'atm') { emit('lost'); msg('Thorn lost: keep the target in sight'); }
          m.tgt = null;
        }
      }
      if (m.tgt && m.t > 0.2) {
        const tp = m.tgt.alive !== undefined ? centre(m.tgt) : m.tgt.pos, tv = m.tgt.vel ?? [0, 0, 0], D = dist(tp, m.pos);
        const close = Math.max(80, m.speed - dot(tv, norm(sub(tp, m.pos))));
        const aim = add(tp, mul(tv, clamp(D / close, 0, 4)));
        if (m.kind === 'atm' && D > 400) aim[1] += Math.min(30, D * 0.02); // a shallow loft
        const dd = norm(sub(aim, m.pos)), ang = Math.acos(clamp(dot(dd, m.f), -1, 1));
        if (ang > 1.3) m.tgt = null;
        else {
          const ax = cross(m.f, dd);
          if (len(ax) > 1e-6) m.f = norm(rot(m.f, norm(ax), Math.min(ang, m.turn * Math.min(1, m.speed / m.max + 0.3) * dt)));
        }
      } else if (!m.tgt) m.f = norm(add(m.f, [0, -0.08 * dt, 0]));
      const p0 = m.pos, p1 = add(m.pos, mul(m.f, m.speed * dt));
      m.pos = p1;
      for (const a of S.actors) {
        if (!a.alive || a.team === m.team || a.kind === 'survivor') continue;
        if (m.kind === 'atm' ? a.air : !a.air) continue;
        if (m.guided && m.tgt && m.tgt !== a) continue;
        if (Math.abs(a.pos[0] - p1[0]) > 200 || Math.abs(a.pos[2] - p1[2]) > 200) continue;
        const fuse = m.kind === 'atm' ? KINDS[a.kind].r + 1.5 : 9 + KINDS[a.kind].r * 0.5;
        if (stepDist(p0, p1, a) < fuse) {
          const dmg = { atm: 220, aam: 100, sam: 55, eaam: 45 }[m.kind];
          emit('boom', { x: p1[0], y: p1[1], z: p1[2], big: m.kind === 'atm', air: a.air, kind: 'missile' });
          hurt(a, dmg, m.owner === P, 'missile', false, p1);
          if (m.kind === 'atm') splash(p1, 10, 30, m.owner === P, m.team, 'missile');
          return false;
        }
      }
      const gy = W.heightAt(p1[0], p1[2]);
      if (p1[1] < gy) {
        emit('boom', { x: p1[0], y: gy + 1, z: p1[2], big: false, air: false, kind: 'missile' });
        if (W.wet(p1[0], p1[2])) emit('splash', { x: p1[0], y: W.water, z: p1[2] });
        splash([p1[0], gy + 2, p1[2]], 10, 40, m.owner === P, m.team, 'missile');
        return false;
      }
      if (m.life <= 0) { emit('pop', { x: p1[0], y: p1[1], z: p1[2] }); return false; }
      return true;
    });
    let th = null, bd = Infinity;
    for (const m of S.missiles) if (m.tgt === P) { const d = dist(m.pos, P.pos); if (d < bd) { bd = d; th = m; } }
    S.threat = th;
    S.decoys = S.decoys.filter(d => {
      d.life -= dt;
      d.vel[1] -= (d.kind === 'flare' ? 5 : 1.5) * dt;
      d.vel = mul(d.vel, 1 - 0.8 * dt);
      d.pos = add(d.pos, mul(d.vel, dt));
      return d.life > 0;
    });
  }

  // ---------- waves, the landing zone and the goal ----------
  function lead() {
    let best = null;
    for (const a of S.actors) if (a.kind === 'ally' && a.alive && (!best || (a.s - best.s) * a.dir > 0)) best = a;
    return best;
  }
  function stepWaves(dt) {
    const M = S.mission, next = M.waves?.[S.wave];
    if (!next) return;
    let ready = false;
    if (next.after === 'time') ready = S.t >= next.t;
    else if (next.after === 'kill') ready = S.killsTotal >= next.n;
    else if (next.after === 'clear') ready = !S.actors.some(a => a.alive && a.air && a.team === 'red');
    else if (next.after === 'lz') ready = !!S.lz?.on;
    else if (next.after === 'pass') { const l = lead(); ready = !!l && l.s * l.dir >= next.s * l.dir; }
    if (ready && S.waveT < 0) S.waveT = next.delay ?? 0;
    if (S.waveT >= 0) {
      S.waveT -= dt;
      if (S.waveT <= 0) {
        S.wave++; S.waveT = -1;
        const specs = M.units.filter(u => u.wave === S.wave);
        for (const spec of specs) spawn(spec);
        msg(specs.some(u => KINDS[u.kind].air) ? 'Combine aircraft inbound' : 'More Combine units moving');
      }
    }
  }
  function stepLz(dt) {
    const L = S.lz, P = S.player;
    if (!L) return;
    L.on = P.ground && near(P, L.site, L.site.r + 40);
    if (L.done || !L.on) return;
    if (L.t === 0) msg('Holding at the landing zone: the survivors are coming');
    L.t += dt;
    const due = Math.min(L.n, Math.floor((L.t / L.need) * L.n + 1e-6));
    while (L.aboard < due) {
      const s = S.actors.find(a => a.kind === 'survivor' && a.alive);
      if (s) { s.alive = false; s.boarded = true; }
      L.aboard++; P.aboard = L.aboard;
      emit('pickup', { n: L.aboard, total: L.n });
    }
    if (L.aboard >= L.n) { L.done = true; msg('All aboard: fly them home'); emit('objective', { kind: 'survivor' }); }
  }
  function objectives() {
    const M = S.mission;
    if (M.goal === 'escort') return { done: S.actors.filter(a => a.kind === 'ally' && a.alive && a.arrived).length, total: M.need };
    if (M.goal === 'rescue') return { done: S.lz ? S.lz.aboard : 0, total: M.survivors };
    const list = S.actors.filter(a => a.obj);
    const total = M.units.filter(u => u.obj).reduce((s, u) => s + (u.n ?? 1), 0);
    return { done: list.filter(a => !a.alive).length, total };
  }
  function stepGoal() {
    const M = S.mission, P = S.player, W = S.world;
    if (S.status === 'fly' && !S.complete) {
      if (M.goal === 'escort') {
        const allies = S.actors.filter(a => a.kind === 'ally'), alive = allies.filter(a => a.alive);
        if (alive.length < M.need) fail('Too many trucks lost');
        else if (alive.every(a => a.arrived)) win('The convoy is through');
      } else if (M.goal === 'ambush') {
        if (S.actors.some(a => a.obj && a.alive && a.arrived)) fail(M.fail ?? 'The convoy got through');
        else { const o = objectives(); if (o.done >= o.total) win('The convoy is stopped'); }
      } else if (M.goal === 'rescue') {
        if (S.lz.done && P.ground && near(P, W.site('home'), W.site('home').r + 25)) { win('The survivors are home'); land(); }
      } else {
        const o = objectives();
        if (o.done >= o.total) win('Objectives complete: return to the FARP');
      }
    }
    if (S.complete && S.status === 'fly' && P.alive && P.ground && near(P, W.site('home'), W.site('home').r + 25)) land();
  }
  function win(text) {
    S.complete = true; S.completeT = 0;
    S.score += COMPLETE_BONUS + 500 * S.theatre;
    emit('objective', { all: true });
    emit('complete');
    msg(text);
  }
  function land() {
    if (S.status !== 'fly') return;
    S.status = 'landed'; S.statusT = 0;
    S.score += LAND_BONUS; S.bonus += LAND_BONUS;
    msg('Down at ' + S.world.site('home').label);
  }

  // ---------- one step ----------
  function step(c = {}) {
    const dt = DT, P = S.player;
    S.t += dt; S.statusT += dt;
    if (S.complete) S.completeT += dt;
    S.spikes = [];
    if ((S.status === 'fly' || S.status === 'landed') && P.alive) {
      flyPlayer(S.status === 'landed' ? { coll: -1 } : c);
      if (P.alive && S.status === 'fly') {
        service(dt);
        sensors();
        aimGun();
        fireStores(c);
        P.gunCd -= dt;
        if (c.gun && P.gun > 0 && P.gunCd <= 0) {
          P.gunCd += GUN_RATE; if (P.gunCd < 0) P.gunCd = 0;
          P.gun--; S.shots++;
          const from = add(add(P.pos, mul(P.f, 2.6)), mul(P.u, -1));
          shoot(P, from, gunDir(P), 0.004, 'gun', 9);
          emit('cannon', { x: from[0], y: from[1], z: from[2] });
        }
        if (P.gunCd < -GUN_RATE) P.gunCd = 0;
      }
    } else if (!P.alive) {
      // the wreck falls
      P.vel[1] -= G * dt;
      P.pos = add(P.pos, mul(P.vel, dt));
      const gy = S.world.heightAt(P.pos[0], P.pos[2]) + SKID;
      if (P.pos[1] < gy) { P.pos[1] = gy; P.vel = [0, 0, 0]; }
      P.rotor += P.rpm * 10 * dt; P.rpm = Math.max(0, P.rpm - dt * 0.4);
    }
    for (const a of S.actors) {
      if (a === P) continue;
      if (a.alive) { if (a.air) (KINDS[a.kind].jet ? flyJet : flyHeli)(a, dt); else groundUnit(a, dt); }
      else if (a.dying) {
        // a downed aircraft trails smoke to the ground
        a.deadT += dt;
        a.vel[1] -= G * dt; a.vel = mul(a.vel, 1 - 0.3 * dt);
        a.pos = add(a.pos, mul(a.vel, dt));
        a.roll += dt * 2.5; a.hdg += dt * (KINDS[a.kind].heli ? 4 : 0.5);
        const B = basis(a.hdg, a.pitch, a.roll); a.f = B.f; a.u = B.u;
        const gy = S.world.heightAt(a.pos[0], a.pos[2]);
        if (a.pos[1] < gy + 2 || a.deadT > 20) {
          a.dying = false; a.pos[1] = gy + (KINDS[a.kind].heli ? SKID : 1);
          const wet = S.world.wet(a.pos[0], a.pos[2]);
          emit(wet ? 'splash' : 'boom', { x: a.pos[0], y: gy + 2, z: a.pos[2], big: true, air: false, kind: a.kind });
        }
      } else a.deadT += dt;
    }
    if (P.alive && S.status === 'fly') {
      S.seen = S.actors.reduce((n, a) => n + (a.alive && a.team === 'red' && a.sees ? 1 : 0), 0);
      // the rest of the step can't hurt a landed, finished Gadfly
    }
    stepBullets(dt);
    stepMissiles(dt);
    stepLz(dt);
    stepWaves(dt);
    stepGoal();
    S.warn = !P.alive || S.status !== 'fly' ? null
      : S.threat && dist(S.threat.pos, P.pos) < 5000 ? 'missile'
        : S.spikes.length ? 'radar'
          : P.rpm < 0.93 || P.torque > 1.06 ? 'rpm' : null;
    if (P.alive && S.status === 'fly' && P.fuel <= 0 && P.ground && !near(P, S.world.site('home'), S.world.site('home').r + 25)) down('Out of fuel');
  }

  return S;
}

// the briefing map: where everything in a mission starts (wave 0), the home pad, the LZ, the road
let planner = null;
export function planOf(mi) {
  planner ??= createSim({ seed: 1 });
  planner.load(mi);
  const M = MISSIONS[mi], W = planner.world;
  const marks = planner.actors.filter(a => a.kind !== 'player').map(a => ({ x: a.pos[0], z: a.pos[2], kind: a.kind, label: KINDS[a.kind].label, obj: a.obj, team: a.team }));
  const roadUnit = M.units.find(u => u.road && u.to != null);
  let road = null;
  if (roadUnit) {
    const pts = W.road(roadUnit.road).pts, d = roadUnit.dir ?? 1, out = [];
    for (let s = roadUnit.s; (roadUnit.to - s) * d > 0; s += 100 * d) { const p = polyAt(pts, s); out.push([p.x, p.z]); }
    const e = polyAt(pts, roadUnit.to);
    out.push([e.x, e.z]);
    road = out;
  }
  return { mission: M, theatre: M.theatre, home: W.site('home'), marks, lz: M.lz ? W.site(M.lz) : null, road };
}

/** where a rocket fired now would come down (the HUD's rocket cue, the autopilot's trigger) */
export function predictRocket(sim) {
  const P = sim.player, W = sim.world;
  const dir = norm(add(P.f, mul(P.u, -0.012)));
  let p = add(P.pos, mul(P.u, -0.8)), v = add(mul(dir, RKT_V), P.vel);
  const h = 0.05;
  for (let t = 0; t < 6; t += h) {
    v[1] -= G * 0.3 * h;
    const p1 = add(p, mul(v, h));
    if (p1[1] < W.heightAt(p1[0], p1[2])) return { pos: p1, t };
    p = p1;
  }
  return null;
}
