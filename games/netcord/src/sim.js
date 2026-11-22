// Netcord's match: two players, one ball, a net, pure and deterministic, a fixed step at a time.
// The page, the attract demo and tools/verify.mjs drive it with held-input snapshots
// { x, y, a, b } for each human (the sim finds the presses) and read `match.s` to draw it; CPU
// players are played by ai.js from inside. All randomness comes from integers in the state
// (mulberry32: `s.rng` for the sim, the AI's own for its choices), so a seed and the same inputs
// replay a match exactly.
//
// Metres and seconds; origin at the centre of the net on the ground, x across (+x right seen from
// the near end), y up, z along the court (the near baseline at +11.885). A player's yaw 0 faces
// −z; forward = (−sin yaw, −cos yaw), right = (cos yaw, −sin yaw) — moves.js's body space.
//
// The ball is a sphere in air: gravity, drag ∝ v², and Magnus lift from its spin with the lift
// coefficient 1 / (2 + v / rω), so topspin dips and backspin floats; spin decays slowly. Four
// substeps a step. A bounce gives back `e` of the vertical speed (the surface's) and rubs the
// contact patch with friction μ until it rolls (a hollow sphere, I = 2/3 m r²): the friction
// takes pace and turns it into topspin, so clay (high μ, high e) bounces slow and high and grass
// (low μ, low e) skids fast and low; backspin also skids a little lower (P.skid). The net is a
// plate with a round tape on top (0.914 m at the centre, 1.07 at the posts): a ball crossing below
// the tape goes into the mesh and drops back; one that clips the tape bounces off it along the
// contact normal (so a ball high on the tape dribbles over, one low on it falls back); the posts
// are cylinders. In or out is the ball's centre within its radius of the line.
//
// Players accelerate toward where they want to be (speed rating sets top speed and acceleration)
// and play moves from moves.js. A shot is planned on the ball's predicted path (the same physics
// run ahead): every sample on the player's side is tried with the stroke its height and side call
// for (forehand or backhand by the side relative to the racket hand; volleys before the bounce,
// low volleys under the net's height, a smash for a high ball, a lunge when nothing else reaches)
// and the stand point puts the move's sweet spot (MOVES[move].at, scaled to the player's height)
// on the ball at that moment. The swing starts so that MOVES[move].contact falls on that step; a
// swing started early or late is played slower or quicker to meet the ball, and the error is the
// shot's timing: early pulls it (cross-court), late pushes it (down the line, wide), far off is a
// frame shot, further still the racket misses. The user's press starts the swing (the sim picks
// the stroke and the ideal moment from where the player will be), the held direction aims (depth
// and width, screen terms of the TV camera: x → +x, y → +z), `a` drives (topspin), `b` slices, b
// with forward lobs and with back drops; holding the button from the press to the contact adds
// power (p.charge). With `assist` the sim runs the user's player to the ball as it does a CPU's.
// A serve: the server bounces the ball, a press tosses it, a second press hits it (the same
// timing, early is long and late is in the net); CPU serves come from ai.js.
//
// Contacts may sit off `at.u` (P.bendLow below, P.reachUp above) and off the sweet spot by up to
// reach (at least P.reachMin): p.contact holds the ball where the swing means to meet it, for the
// figure to reach the racket there. A serve's root travel (MOVES.serve.travel) is carried here.
// Practice: 'machine' makes player 1 a ball machine feeding player 0; 'partner' plays rallies;
// neither keeps score nor ends.
//
//   const match = createMatch({ players: [p0, p1], surface: 'hard', sets: 3, cpu: [false, true], seed: 1, assist: true,
//                               difficulty: 1 /* CPU errors ÷ */, server: -1 /* coin toss */, practice: null });
//   match.step([in0, null]);   // every DT; match.events lists what happened (the caller clears it)
//   match.skip();              // cut a point's pause or a change of ends short
//   match.result();            // { winner, sets: [[g0, g1]…], tiebreaks: [loser's points | null…], stats: [p0, p1] }
import { FIGURE, MOVES, travelAt } from './moves.js';
import { createScore, court as courtOf, pointWon, pressure, setScores } from './score.js';
import { createAI } from './ai.js';

export const DT = 1 / 60;
export const COURT = {
  halfL: 11.885, halfW: 4.115, alleyW: 5.485, service: 6.4, netH: 0.914, postH: 1.07, postX: 6.4, ball: 0.0335,
  // additive: the run-off (fences) and the post's radius
  backX: 9.6, backZ: 18.3, postR: 0.04,
};
const R = COURT.ball;
/** the top of the net's tape at x (sagging from the posts to the centre strap) */
export function netHeight(x) {
  const u = Math.min(1, Math.abs(x) / COURT.postX);
  return COURT.netH + (COURT.postH - COURT.netH) * u * u;
}
// e: the vertical speed a bounce gives back, mu: the court's friction on the ball
export const SURFACES = {
  hard: { e: 0.77, mu: 0.56 },
  clay: { e: 0.85, mu: 0.85 },
  grass: { e: 0.64, mu: 0.32 },
  indoor: { e: 0.72, mu: 0.46 },
};

export const P = {
  // the ball (a 57.7 g, 6.7 cm felt ball)
  g: 9.81, rho: 1.21, mass: 0.0577, cd: 0.55, spinDecay: 0.12, // m/s², kg/m³, kg, drag coefficient, spin lost /s
  alpha: 2 / 3, rollVy: 0.35, rollDecel: 0.8, wallE: 0.3, // I/(m r²), m/s under which a bounce rolls, m/s² rolling, fences
  skid: 0.12, kick: 0.05, // backspin's lower bounce and topspin's higher one (× e at full spin)
  cordE: 0.25, cordKeep: 0.72, cordJig: 0.8, tape: 0.05, meshE: 0.08, postE: 0.55, // the net
  // players
  top0: 4.4, topK: 0.33, acc0: 7.5, accK: 0.9, decK: 1.5, // top speed and acceleration m/s, m/s² (+ per speed point)
  react0: 0.22, reactK: 0.014, reactHuman: 0.1, // s before a player moves for the ball
  setT: 0.06, swingMove: 0.6, afterMove: 0.25, // s set before contact, the share of pace while swinging (before, after)
  over: 0.25, // m on his own side the ball must be to be struck (no reaching over)
  bendLow: 0.38, reachUp: 0.55, reachMin: 0.28, // m of height the figure gives below and above the sweet spot's slack, the least reach
  squeeze: 0.38,
  pref: { baseline: 1.4, counter: 2.6, 'all-round': 0.9, 'serve-volley': 0.4 }, // m behind the baseline a player likes to stand
  // timing
  early: 0.3, late: 0.2, rateMin: 0.5, rateMax: 2.3, frameQ: 0.22, pull: 2.6, // s windows, swing pace limits, frame below, m pulled
  serveLead: 0.3, serveDepth: 4, catchY: 1.2, // s from the hit press to contact, m long per s early, a toss let fall under (m)
  tap: 0.45, chargeT: 0.4, // a tap's power, s of hold to full
  // shots (m/s, rad/s)
  driveV: [15, 21], sliceV: [13, 12], volleyV: [12, 15], smashV: [24, 14], dropV: [7.5, 4], lobVy: [9.5, 3],
  topspin: [40, 22], slice: [50, 8], dropSpin: 90, clear: [0.25, 0.1], // spin base + per spin point; net clearance safe/risky
  // flow (s)
  pointT: 2.6, callT: 1.2, faultT: 1.3, changeT: 3, settle: 0.5, serveMax: 9, feedT: 0.6, feedPause: 1.2,
};

export const EMPTY_INPUT = { x: 0, y: 0, a: false, b: false };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const NS = 4, H = DT / NS;
const KA = (0.5 * P.rho * Math.PI * R * R) / P.mass; // ρA/2m
const SPIN_KEEP = Math.exp(-P.spinDecay * H);
const F_BOUNCE = 1, F_NET = 2, F_CORD = 4, F_POST = 8, F_WALL = 16;
export const FLAGS = { BOUNCE: F_BOUNCE, NET: F_NET, CORD: F_CORD, POST: F_POST, WALL: F_WALL };

// mulberry32 on an integer kept in the state
function rand(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randn = s => (rand(s) + rand(s) + rand(s) - 1.5) * 2;

// ---------- the ball ----------
export const newBall = () => ({ x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, spin: [0, 0, 0], roll: false });
function copyBall(a, b) {
  b.x = a.x; b.y = a.y; b.z = a.z; b.vx = a.vx; b.vy = a.vy; b.vz = a.vz;
  b.spin[0] = a.spin[0]; b.spin[1] = a.spin[1]; b.spin[2] = a.spin[2]; b.roll = a.roll;
  return b;
}
const acc = [0, 0, 0];
/** gravity, drag and Magnus on a flying ball → acc */
function forces(b) {
  const vx = b.vx, vy = b.vy, vz = b.vz, w = b.spin;
  const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
  acc[0] = 0; acc[1] = -P.g; acc[2] = 0;
  if (v < 0.01) return;
  const kd = KA * P.cd * v;
  acc[0] -= kd * vx; acc[1] -= kd * vy; acc[2] -= kd * vz;
  const wm = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]);
  if (wm < 0.5) return;
  const k = (KA * v) / ((2 + v / (R * wm)) * wm); // K·CL·v² / (|ω||v|)
  acc[0] += k * (w[1] * vz - w[2] * vy);
  acc[1] += k * (w[2] * vx - w[0] * vz);
  acc[2] += k * (w[0] * vy - w[1] * vx);
}

function bounce(b, surf, info) {
  const vin = -b.vy, w = b.spin;
  b.y = R;
  const vh = Math.hypot(b.vx, b.vz);
  // the contact patch's slip (ω × (0, −r, 0) added to the centre's pace)
  const cx = b.vx + R * w[2], cz = b.vz - R * w[0];
  const c = Math.hypot(cx, cz);
  let e = surf.e;
  if (vh > 1) {
    const along = (cx * b.vx + cz * b.vz) / vh, top = (vh - along) / R; // rad/s of topspin (− backspin)
    if (top < 0) e *= 1 - P.skid * Math.min(1, -top / 300);
    else e *= 1 + P.kick * Math.min(1, top / 400);
  }
  b.vy = vin * e;
  if (c > 1e-6) {
    const j = Math.min(surf.mu * (1 + e) * vin, (c * P.alpha) / (1 + P.alpha)), ux = cx / c, uz = cz / c;
    b.vx -= j * ux; b.vz -= j * uz;
    w[0] += (j * uz) / (P.alpha * R);
    w[2] -= (j * ux) / (P.alpha * R);
  }
  w[1] *= 0.7;
  if (b.vy < P.rollVy) { b.vy = 0; b.roll = true; }
  if (info) { info.bx = b.x; info.bz = b.z; info.vin = vin; }
}

/** the ball crossed z = 0 at (xc, yc) coming from the side `sg` (+1 near): the net, its tape or a post */
function netContact(b, xc, yc, sg, jig) {
  const ax = Math.abs(xc), pr = COURT.postX, rr = R + COURT.postR;
  if (ax > pr + rr) return 0;
  if (ax > pr - rr && yc < COURT.postH + R) {
    // the post: a cylinder, the contact normal in the x–z plane
    const dx = clamp(ax - pr, -rr * 0.999, rr * 0.999), nz = (sg * Math.sqrt(rr * rr - dx * dx)) / rr, nx = (Math.sign(xc) * dx) / rr;
    const vn = b.vx * nx + b.vz * nz;
    if (vn < 0) { b.vx -= (1 + P.postE) * vn * nx; b.vz -= (1 + P.postE) * vn * nz; }
    b.z = nz * rr * 1.01; b.x = Math.sign(xc) * pr + nx * rr * 1.01;
    return F_POST;
  }
  if (ax > pr) return 0;
  const h = netHeight(xc), d = yc - h;
  if (d >= R) return 0;
  if (d >= -0.004) {
    // the tape's top edge
    const dd = Math.min(d, R * 0.999), ny = dd / R, nz = (sg * Math.sqrt(R * R - dd * dd)) / R;
    const vn = b.vy * ny + b.vz * nz;
    if (vn < 0) {
      const ty = b.vy - vn * ny, tz = b.vz - vn * nz;
      b.vy = ty * P.cordKeep - P.cordE * vn * ny;
      b.vz = tz * P.cordKeep - P.cordE * vn * nz;
      b.vx *= P.cordKeep;
      b.vy += (jig - 0.5) * P.cordJig;
      b.spin[0] *= 0.3; b.spin[1] *= 0.3; b.spin[2] *= 0.3;
    }
    b.y = h + dd * 1.001;
    b.z = nz * R * 1.001;
    return F_CORD;
  }
  // the band or the mesh: it drops back
  const tapeHit = d > -P.tape - R;
  b.z = sg * (R + 0.002);
  b.vz = -b.vz * (tapeHit ? P.cordE : P.meshE);
  b.vx *= 0.4; b.vy *= tapeHit ? 0.7 : 0.3;
  b.spin[0] *= 0.2; b.spin[1] *= 0.2; b.spin[2] *= 0.2;
  return F_NET;
}

/**
 * One step (DT) of a ball, four substeps; `jig` 0..1 is the tape's give (0.5: none). Returns the
 * FLAGS of what it met; `info.bx, bz, vin` hold the first bounce's spot and incoming pace.
 */
export function advance(b, surf, jig = 0.5, info = null) {
  let f = 0;
  for (let n = 0; n < NS; n++) {
    const x0 = b.x, y0 = b.y, z0 = b.z;
    if (b.roll) {
      const vh = Math.hypot(b.vx, b.vz);
      const k = vh > 1e-6 ? Math.max(0, 1 - (P.rollDecel * H) / vh) : 0;
      b.vx *= k; b.vz *= k; b.vy = 0; b.y = R;
      b.spin[0] = b.vz / R; b.spin[2] = -b.vx / R; b.spin[1] *= SPIN_KEEP;
    } else {
      forces(b);
      b.vx += acc[0] * H; b.vy += acc[1] * H; b.vz += acc[2] * H;
      b.spin[0] *= SPIN_KEEP; b.spin[1] *= SPIN_KEEP; b.spin[2] *= SPIN_KEEP;
    }
    b.x += b.vx * H; b.y += b.vy * H; b.z += b.vz * H;
    if (z0 !== 0 && z0 > 0 !== b.z > 0) {
      const u = z0 / (z0 - b.z), xc = x0 + (b.x - x0) * u, yc = y0 + (b.y - y0) * u;
      if (yc < COURT.postH + R + 0.01) f |= netContact(b, xc, yc, z0 > 0 ? 1 : -1, jig);
    }
    if (!b.roll && b.y < R && b.vy < 0) {
      if (!(f & F_BOUNCE)) { f |= F_BOUNCE; bounce(b, surf, info); }
      else bounce(b, surf, null);
    }
    if (Math.abs(b.x) > COURT.backX) { b.x = Math.sign(b.x) * COURT.backX; b.vx = -b.vx * P.wallE; f |= F_WALL; }
    if (Math.abs(b.z) > COURT.backZ) { b.z = Math.sign(b.z) * COURT.backZ; b.vz = -b.vz * P.wallE; f |= F_WALL; }
  }
  return f;
}

// ---------- the shot solver ----------
const probe = newBall();
const fly = { land: 0, side: 0, cross: 0, crossX: 0, t: 0 };
/** fly the probe (no net) until it lands: distance along (ux, uz) and across, the height over the tape */
function flyProbe(ux, uz) {
  const b = probe, x0 = b.x, z0 = b.z, h = 1 / 120;
  fly.cross = 99; fly.crossX = 0;
  let t = 0;
  while (t < 6) {
    const px = b.x, py = b.y, pz = b.z;
    forces(b);
    b.vx += acc[0] * h; b.vy += acc[1] * h; b.vz += acc[2] * h;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
    t += h;
    if (pz !== 0 && pz > 0 !== b.z > 0) {
      const u = pz / (pz - b.z), xc = px + (b.x - px) * u, yc = py + (b.y - py) * u;
      fly.cross = yc - netHeight(xc) - R; fly.crossX = xc;
    }
    if (b.y < R && b.vy < 0) break;
  }
  const dx = b.x - x0, dz = b.z - z0;
  fly.land = dx * ux + dz * uz; fly.side = -dx * uz + dz * ux; fly.t = t;
  return fly;
}
function setProbe(c, ux, uz, vh, vy, top, side) {
  probe.x = c.x; probe.y = c.y; probe.z = c.z;
  probe.vx = ux * vh; probe.vy = vy; probe.vz = uz * vh;
  // topspin's axis is up × the way it flies; sidespin about y
  probe.spin[0] = top * uz; probe.spin[1] = side; probe.spin[2] = -top * ux;
  probe.roll = false;
}
/**
 * The launch from c = {x, y, z} that lands at (tx, tz): `vh` horizontal pace (or, with `vyFix`, a
 * fixed upward pace and vh solved), `top` rad/s of topspin (− backspin), `side` rad/s about y;
 * lowers the pace until the ball clears the tape by `clear` m. → out { vx, vy, vz, spin, cross, t }.
 */
export function aimShot(c, tx, tz, vh, top, side, clear, out, vyFix = 0) {
  let dx = tx - c.x, dz = tz - c.z;
  const D = Math.hypot(dx, dz) || 1;
  let ux = dx / D, uz = dz / D, vy = 0, crossed = 99;
  const crosses = c.z !== 0 && c.z > 0 !== tz > 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let tries = 0; tries < 10; tries++) {
      if (vyFix) {
        vy = vyFix;
        let lo = 2, hi = 45;
        for (let k = 0; k < 14; k++) {
          const mid = (lo + hi) / 2;
          setProbe(c, ux, uz, mid, vy, top, side);
          if (flyProbe(ux, uz).land < D) lo = mid; else hi = mid;
        }
        vh = (lo + hi) / 2;
      } else {
        let lo = -vh * 0.6, hi = vh * 0.8;
        setProbe(c, ux, uz, vh, hi, top, side);
        if (flyProbe(ux, uz).land < D) vy = hi;
        else {
          for (let k = 0; k < 16; k++) {
            const mid = (lo + hi) / 2;
            setProbe(c, ux, uz, vh, mid, top, side);
            if (flyProbe(ux, uz).land < D) lo = mid; else hi = mid;
          }
          vy = (lo + hi) / 2;
        }
      }
      setProbe(c, ux, uz, vh, vy, top, side);
      flyProbe(ux, uz);
      crossed = fly.cross;
      if (!crosses || fly.cross >= clear || vyFix) break;
      vh *= 0.9;
      if (vh < 4) break;
    }
    // sidespin bends it: turn the aim against the miss and solve again
    if (Math.abs(side) < 1 || pass === 1) break;
    const miss = fly.side, a = -Math.atan2(miss, D);
    const nx = ux * Math.cos(a) - uz * Math.sin(a), nz = ux * Math.sin(a) + uz * Math.cos(a);
    ux = nx; uz = nz;
  }
  out.vx = ux * vh; out.vy = vy; out.vz = uz * vh;
  out.spin[0] = top * uz; out.spin[1] = side; out.spin[2] = -top * ux;
  out.cross = crossed; out.t = fly.t;
  return out;
}

// ---------- moves ----------
const SIDE = {
  forehand: 1, forehandSlice: 1, forehandLob: 1, dropForehand: 1, volleyForehand: 1, volleyLowF: 1,
  backhand: -1, backhandSlice: -1, backhandLob: -1, dropBackhand: -1, volleyBackhand: -1, volleyLowB: -1, lungeBackhand: -1,
};
const STROKES = {
  ground: { drive: ['forehand', 'backhand'], slice: ['forehandSlice', 'backhandSlice'], lob: ['forehandLob', 'backhandLob'], drop: ['dropForehand', 'dropBackhand'] },
  volley: ['volleyForehand', 'volleyBackhand'], low: ['volleyLowF', 'volleyLowB'],
};
const NEEDED = ['ready', 'split', 'run', 'shuffle', 'backpedal', 'walk', 'forehand', 'backhand', 'forehandSlice', 'backhandSlice', 'forehandLob', 'backhandLob', 'dropForehand', 'dropBackhand', 'volleyForehand', 'volleyBackhand', 'volleyLowF', 'volleyLowB', 'smash', 'serve', 'bounceBall', 'lunge', 'celebrate', 'dejected', 'bow'];
/** the move for a stroke class ('ground' | 'volley' | 'low' | 'smash' | 'lunge'), shot kind and side (+1 the racket side) */
export function strokeMove(cls, kind, side) {
  if (cls === 'smash') return cls;
  if (cls === 'lunge') return side < 0 && MOVES.lungeBackhand ? 'lungeBackhand' : 'lunge';
  const k = side > 0 ? 0 : 1;
  if (cls === 'ground') return (STROKES.ground[kind] || STROKES.ground.drive)[k];
  return STROKES[cls][k];
}
const vec = (v, k) => (Array.isArray(v) ? v[k] : v[['f', 'u', 's'][k]]);
/** a move's sweet spot for a player `height` tall, body space [f, u, s], s signed for the stroke's side */
function sweet(name, height, side, out) {
  const m = MOVES[name], k = height / FIGURE.height;
  for (let n = 0; n < 3; n++) {
    const a = vec(m.at, n);
    out[n] = m.hand ? vec(m.hand, n) * k + (a - vec(m.hand, n)) : a * k;
  }
  const sg = SIDE[name];
  if (sg) out[2] = sg * Math.abs(out[2]);
  else if (name === 'lunge') out[2] = side * Math.abs(out[2]);
  return out;
}
const SW = [0, 0, 0];
/** a move's reach, with the game's forgiveness (the figure bends the arm the last bit) */
const reachOf = mv => Math.max(mv.reach, P.reachMin);

// ---------- the match ----------
export function createMatch({ players: roster, surface = 'hard', sets = 3, cpu = [false, true], seed = 1, assist = true, difficulty = 1, server = -1, practice = null }) {
  const missing = NEEDED.filter(n => !MOVES[n]);
  if (missing.length) throw new Error(`netcord: moves.js has no ${missing.join(', ')}`);
  const surf = SURFACES[surface] || SURFACES.hard;
  const rng0 = seed | 0 || 1;
  const s = {
    t: 0, phase: 'serve', phaseT: 0, server: 0, end: [1, -1],
    ball: { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, spin: [0, 0, 0], live: false, bounces: 0, last: -1, inHand: true,
      // additive: the flight's number (a new one at every hit, toss and touch of the net), a serve not yet bounced, rolling
      gen: 0, serve: false, roll: false },
    players: [],
    score: null, call: null, bounce: null,
    stats: [0, 1].map(() => ({ aces: 0, doubleFaults: 0, winners: 0, errors: 0, firstServe: [0, 0], netPoints: 0, rally: 0,
      // additive: points won, second serves [in, total], points won on serve [won, played], the fastest serve km/h
      points: 0, secondServe: [0, 0], servePoints: [0, 0], fastest: 0 })),
    // additive: the surface, shots this point, the last serve's speed (km/h), the court served from, the random state
    // practice: null, 'machine' (player 1 is a ball machine feeding player 0) or 'partner' (rallies, no score)
    surface, rally: 0, serveSpeed: 0, court: 'deuce', rng: rng0, practice: practice === 'machine' || practice === 'partner' ? practice : null,
  };
  const match = { s, events: [], done: false, step, result, skip, tune: { P, COURT, SURFACES } };
  const emit = e => {
    const ev = match.events;
    if (ev.length > 2000) ev.splice(0, 1000);
    ev.push(e);
  };
  const b = s.ball, players = s.players;
  const names = roster.map(r => (r.short || r.name || 'PLAYER').toUpperCase());
  const first = server === 0 || server === 1 ? server : rand(s) < 0.5 ? 0 : 1;
  s.score = createScore({ sets, server: first, names });
  if (s.practice) s.score.label = 'PRACTICE';
  s.server = first;

  // ---------- the players ----------
  const M = [];
  for (let i = 0; i < 2; i++) {
    const d = roster[i] || {}, rt = d.ratings || {};
    // ratings 1..9, squeezed toward the middle: tennis compounds a small edge a point into a big
    // one a set, so a better player wins most matches without winning every one (P.squeeze)
    const r = k => 5 + (clamp(+rt[k] || 5, 1, 9) - 5) * P.squeeze;
    const ratings = { speed: r('speed'), power: r('power'), accuracy: r('accuracy'), spin: r('spin'), serve: r('serve'), volley: r('volley'), stamina: r('stamina') };
    const hand = d.hand === 'left' ? -1 : 1, height = clamp(+d.height || 1.85, 1.6, 2.1), e = s.end[i];
    players.push({
      x: 0, z: e * 12, vx: 0, vz: 0, yaw: e > 0 ? 0 : Math.PI, hand, height, move: 'ready', moveT: 0, phase: 0, speed: 0,
      human: !cpu[i], charge: 0, aim: null,
      // additive: the stroke's side (+1 the racket side), the ball where the swing means to meet it
      side: 1, contact: null,
    });
    M.push({
      r: ratings, style: d.style || 'all-round', cpu: !!cpu[i],
      top: P.top0 + P.topK * ratings.speed, acc: P.acc0 + P.accK * ratings.speed,
      reactS: cpu[i] ? P.react0 - P.reactK * ratings.speed : P.reactHuman,
      plan: { ok: false, gen: -1, at: -1, leave: false, step: 0, move: 'forehand', cls: 'ground', side: 1, sx: 0, sz: 0, bx: 0, by: 0, bz: 0, slack: 0, bounced: true },
      planT: 0, seen: -1, reactT: 0, swing: null, react: null, wantX: 0, wantZ: 0, urgent: 0, net: false, run: 0,
      toss: 'wait', tossT: 0, waitT: 0, prevA: false, prevB: false, idle: 0, splitT: 0,
    });
  }
  const ai = createAI({ s, P, COURT, M, players, seed: rng0, difficulty, surface, netHeight, landing });

  // ---------- the path ahead ----------
  const NP = 330;
  const PX = new Float64Array(NP), PY = new Float64Array(NP), PZ = new Float64Array(NP), PB = new Int8Array(NP);
  const path = { gen: -1, step: 0, n: 0, land: -1, landX: 0, landZ: 0, landIn: true };
  const pball = newBall();
  let stepNo = 0;
  function ensurePath() {
    if (path.gen === b.gen && path.n > 0) return;
    copyBall(b, pball);
    path.gen = b.gen; path.step = stepNo; path.land = -1;
    let bc = b.bounces, n = 0;
    const info = { bx: 0, bz: 0, vin: 0 };
    for (; n < NP; n++) {
      PX[n] = pball.x; PY[n] = pball.y; PZ[n] = pball.z; PB[n] = bc;
      if (bc >= 2 || pball.roll) { n++; break; }
      const f = advance(pball, surf, 0.5, info);
      if (f & F_BOUNCE) {
        bc++;
        if (path.land < 0) { path.land = n + 1; path.landX = info.bx; path.landZ = info.bz; path.landIn = landsIn(info.bx, info.bz); }
      }
    }
    path.n = n;
  }
  /** the predicted first bounce of the ball in flight: { x, z, in, t } or null */
  function landing() {
    if (!b.live || b.inHand) return null;
    ensurePath();
    if (path.land < 0) return null;
    return { x: path.landX, z: path.landZ, in: path.landIn, t: (path.land - (stepNo - path.step)) * DT };
  }

  // ---------- the court's areas ----------
  const recv = () => 1 - s.server;
  function inBox(x, z) {
    const e = s.end[s.server], sg = (s.court === 'deuce' ? -1 : 1) * e, zz = -z * e;
    const sx = x * sg;
    return sx >= -R && sx <= COURT.halfW + R && zz >= 0 && zz <= COURT.service + R;
  }
  function inCourt(i, x, z) {
    const zz = z * s.end[i];
    return Math.abs(x) <= COURT.halfW + R && zz >= 0 && zz <= COURT.halfL + R;
  }
  /** is a first bounce at (x, z) good, for the ball in flight? */
  function landsIn(x, z) {
    if (b.serve) return inBox(x, z);
    const o = 1 - b.last;
    return b.last >= 0 && inCourt(o, x, z);
  }

  // ---------- body space ----------
  /** player i's sweet spot for `move` with him at (x, z) facing the net → SW [x, y, z] */
  function spotAt(i, move, side, x, z) {
    const p = players[i], e = s.end[i];
    sweet(move, p.height, side, SW);
    const f = SW[0], u = SW[1], sd = SW[2];
    SW[0] = x + e * sd * p.hand; SW[1] = u; SW[2] = z - e * f;
    return SW;
  }
  const facing = i => (s.end[i] > 0 ? 0 : Math.PI);
  function travel(i, d) {
    const m = M[i], v = m.top * fatigue(i), a = m.acc;
    return d < (v * v) / a ? 2 * Math.sqrt(d / a) : d / v + v / a;
  }
  function fatigue(i) {
    const m = M[i];
    return 1 - clamp((m.run - (18 + m.r.stamina * 5)) / 120, 0, 0.12);
  }

  // ---------- planning ----------
  /**
   * Where and how player i meets the ball in flight: every sample on his side, with the stroke it
   * calls for, scored by whether he gets there, the height, how far back it takes him. `kind`
   * picks the ground stroke's variant.
   */
  function planFor(i, kind = 'drive') {
    const p = players[i], m = M[i], pl = m.plan, e = s.end[i], st = m.style;
    ensurePath();
    pl.ok = false; pl.leave = false; pl.gen = b.gen; pl.at = stepNo; pl.slack = -99;
    const j0 = stepNo - path.step;
    if (j0 >= path.n) return pl;
    // a ball going out is left alone (the CPU now and then plays it anyway)
    if (path.land >= 0 && !path.landIn && path.land > j0 && b.bounces === 0) {
      if (m.outGen !== b.gen) { m.outGen = b.gen; m.outPlay = ai.playOut(i); }
      if (!p.human && !m.outPlay) { pl.leave = true; return pl; }
      if (p.human) pl.leave = true;
    }
    const reactLeft = Math.max(0, m.reactT);
    const pref = COURT.halfL + (P.pref[st] ?? 1) + (p.human ? 0.4 : 0);
    let best = -1e9, chase = -1e9;
    const cand = { move: '', cls: '', side: 1, sx: 0, sz: 0, j: 0, slack: 0 };
    const keep = (sc, sl) => {
      pl.ok = sl >= 0; pl.move = cand.move; pl.cls = cand.cls; pl.side = cand.side; pl.sx = cand.sx; pl.sz = cand.sz;
      pl.step = path.step + cand.j; pl.bx = PX[cand.j]; pl.by = PY[cand.j]; pl.bz = PZ[cand.j]; pl.slack = sl;
      pl.bounced = PB[cand.j] > 0;
    };
    const atNet = Math.abs(p.z) < 7.5 || m.net;
    for (let j = j0 + 1; j < path.n; j++) {
      const bc = PB[j];
      if (bc >= 2) break;
      if (b.serve && bc === 0) continue;
      if (pl.leave && bc === 0) continue;
      const bx = PX[j], by = PY[j], bz = PZ[j];
      if (bz * e < P.over) continue;
      if (bc === 1 && path.land >= 0 && !path.landIn) break;
      const tAv = (j - j0) * DT;
      const lat = (bx - p.x) * e * p.hand;
      const side = lat > -0.15 ? 1 : -1;
      for (let c = 0; c < 4; c++) {
        let cls;
        if (c === 0) cls = bc === 0 ? (by < 0.62 ? 'low' : 'volley') : 'ground';
        else if (c === 1) { if (by < 1.7) continue; cls = 'smash'; }
        else if (c === 2) { cls = 'lunge'; }
        else { if (bc !== 0 || by >= 0.62) continue; cls = 'volley'; }
        const move = strokeMove(cls, kind, side), mv = MOVES[move];
        if (tAv < mv.contact / P.rateMax) continue;
        spotAt(i, move, side, 0, 0);
        const dy = by - SW[1], reach = reachOf(mv);
        if (dy < -(reach + P.bendLow) || dy > reach + P.reachUp) continue;
        const sx = bx - SW[0], sz = bz - SW[2];
        if (sz * e < 0.3) continue;
        const d = Math.hypot(sx - p.x, sz - p.z);
        const vtoward = Math.max(0, (p.vx * (sx - p.x) + p.vz * (sz - p.z)) / (d || 1));
        const sl = tAv - reactLeft - P.setT - mv.contact * (1 - P.swingMove) * 0.5 - Math.max(0, travel(i, d) - vtoward / (2 * m.acc));
        let sc = sl >= 0 ? 4 + Math.min(sl, 0.6) * 2 : sl * 8;
        sc -= Math.abs(dy) * 2.5;
        sc -= Math.max(0, Math.abs(sz) - pref) * 1.3;
        sc -= tAv * 0.25;
        if (cls === 'lunge') sc -= 3;
        if (cls === 'smash') sc += by > 2.2 ? 1 : -0.5;
        if (bc === 0) sc += atNet ? 1.2 : Math.abs(sz) > 8 ? -2.5 : -0.6;
        if (cls === 'low') sc -= 0.6;
        if (cls === 'ground' && bc === 1 && PY[j] < PY[j - 1] && st !== 'all-round') sc += 0.3; // on the drop
        const tot = sl >= 0 ? sc : sc - 100;
        if (tot > Math.max(best, chase)) {
          cand.move = move; cand.cls = cls; cand.side = side; cand.sx = sx; cand.sz = sz; cand.j = j; cand.slack = sl;
          if (sl >= 0) best = tot; else chase = tot;
          keep(tot, sl);
        }
      }
    }
    return pl;
  }

  /** the best stroke for a press now, with player i at (x, z): { move, cls, side, step, d } by the closest the sweet spot comes to the ball */
  const pick = { move: 'forehand', cls: 'ground', side: 1, step: 0, d: 99, dt: 0 };
  function closest(i, kind, x, z) {
    const p = players[i], e = s.end[i];
    ensurePath();
    const j0 = stepNo - path.step;
    pick.d = 99; pick.step = -1;
    for (let j = j0 + 1; j < path.n; j++) {
      const bc = PB[j];
      if (bc >= 2) break;
      if (b.serve && bc === 0) continue;
      const bx = PX[j], by = PY[j], bz = PZ[j];
      if (bz * e < P.over) continue;
      const tAv = (j - j0) * DT;
      const side = (bx - x) * e * p.hand > -0.15 ? 1 : -1;
      for (let c = 0; c < 3; c++) {
        let cls;
        if (c === 0) cls = bc === 0 ? (by < 0.62 ? 'low' : 'volley') : 'ground';
        else if (c === 1) { if (by < 1.7) continue; cls = 'smash'; }
        else cls = 'lunge';
        const move = strokeMove(cls, kind, side), mv = MOVES[move];
        if (tAv < mv.contact / P.rateMax || tAv > mv.contact / P.rateMin) continue;
        spotAt(i, move, side, x, z);
        const dy = by - SW[1];
        const dv = dy < 0 ? Math.max(0, -dy - P.bendLow) : Math.max(0, dy - P.reachUp);
        let d = Math.hypot(bx - SW[0], dv, bz - SW[2]);
        const dd = d / reachOf(mv) + (cls === 'lunge' ? 0.5 : 0) + Math.abs(tAv - mv.contact) * 0.3;
        if (dd < pick.d) {
          pick.d = dd; pick.move = move; pick.cls = cls; pick.side = side; pick.step = path.step + j;
          pick.dt = mv.contact - tAv;
        }
      }
    }
    return pick;
  }

  // ---------- swings ----------
  /** start player i's swing of `move` meant to meet the ball at step `target` (−1: none) with timing error dt (s, − early) */
  function beginSwing(i, move, cls, side, target, dt, kind, shot = null) {
    const p = players[i], m = M[i], mv = MOVES[move];
    const win = dt < 0 ? P.early : P.late;
    let q = 0, contact, rate = 1;
    const steps = target - stepNo;
    if (target >= 0 && Math.abs(dt) <= win && steps > 0) {
      rate = clamp(mv.contact / (steps * DT), P.rateMin, P.rateMax);
      contact = stepNo + Math.max(1, Math.round(mv.contact / rate / DT));
      q = 1 - Math.pow(Math.abs(dt) / win, 1.5);
    } else contact = stepNo + Math.max(1, Math.round(mv.contact / DT));
    m.swing = { move, cls, side, kind, contact, rate, dt, q, held: 0, hold: true, shot, serve: false, start: stepNo, done: false };
    m.react = null;
    p.move = move; p.moveT = 0; p.side = side; p.charge = 0;
    if (target >= 0 && path.gen === b.gen) {
      const j = target - path.step;
      if (j >= 0 && j < path.n) p.contact = { x: PX[j], y: PY[j], z: PZ[j] };
    }
    emit({ type: 'swing', player: i, move });
  }

  /** the contact: does the racket meet the ball, and where does it send it */
  const launchOut = { vx: 0, vy: 0, vz: 0, spin: [0, 0, 0], cross: 0, t: 0 };
  function strike(i) {
    const p = players[i], m = M[i], sw = m.swing, mv = MOVES[sw.move], e = s.end[i];
    sw.done = true;
    p.contact = null;
    if (!b.live || b.inHand || b.last === i || b.bounces >= 2 || b.serve || b.z * e < -0.05) {
      emit({ type: 'whiff', player: i, d: -1 });
      return false;
    }
    spotAt(i, sw.move, sw.side, p.x, p.z);
    const dy = b.y - SW[1];
    const dv = dy < 0 ? Math.max(0, -dy - P.bendLow) : Math.max(0, dy - P.reachUp);
    const d = Math.hypot(b.x - SW[0], dv, b.z - SW[2]);
    if (d > reachOf(mv)) {
      emit({ type: 'whiff', player: i, d, dx: b.x - SW[0], dy, dz: b.z - SW[2], sx: M[i].plan.sx - p.x, sz: M[i].plan.sz - p.z });
      return false;
    }
    let q = sw.q * (1 - 0.5 * (d / reachOf(mv)) ** 2);
    const o = 1 - i, eo = s.end[o];
    let kind = sw.kind, tx, tz, pace, top, side = 0, clear = P.clear[0], sig;
    const r = m.r, pw = 0.8 + 0.03 * r.power;
    const incoming = Math.hypot(b.vx, b.vy, b.vz);
    if (sw.shot) {
      ({ tx, tz, pace } = sw.shot);
      kind = sw.shot.kind;
      clear = sw.shot.clear ?? clear;
      sig = ai.sigma(i, sw, incoming, q);
    } else {
      const inp = m.input, fwd = clamp(-inp.y * e, -1, 1);
      ({ tx, tz } = aimFor(i, kind, inp.x, fwd));
      const charge = clamp(sw.held / P.chargeT, 0, 1);
      pace = P.tap + (1 - P.tap) * charge;
      p.charge = charge;
      const acc = r.accuracy;
      sig = { a: 0.008 + 0.04 * (1 - q) + (9 - acc) * 0.002, v: 0.01 + 0.03 * (1 - q), y: 0.1 + 0.4 * (1 - q), net: 0.01 + 0.15 * (1 - q) };
    }
    // timing: early pulls across the body, late pushes the ball the other way
    const win = sw.dt < 0 ? P.early : P.late, tq = clamp(-sw.dt / win, -1, 1);
    const stroke = SIDE[sw.move] || (sw.move === 'lunge' ? sw.side : 1);
    tx += tq * P.pull * -(stroke * p.hand * e) * (sw.cls === 'ground' ? 1 : 0.6);
    if (sw.cls === 'lunge') { pace *= 0.55; q *= 0.8; }
    const frame = q < P.frameQ;
    if (frame) {
      tx = b.x * 0.3 + randn(s) * 3.5; tz = eo * (5 + rand(s) * 9); pace = 0.25 + rand(s) * 0.25;
      kind = rand(s) < 0.5 ? 'lob' : 'drive';
    }
    pace = clamp(pace * (0.7 + 0.3 * q), 0.05, 1.05);
    tx = clamp(tx, -6, 6);
    const spinR = r.spin;
    let vh, vyFix = 0;
    const cls = sw.cls;
    let evKind = kind;
    if (cls === 'smash') {
      vh = (P.smashV[0] + P.smashV[1] * pace) * pw; top = 20; evKind = 'smash';
    } else if (cls === 'volley' || cls === 'low') {
      if (kind === 'lob') { vyFix = P.lobVy[0] * 0.8; top = 30; } else if (kind === 'drop') { vh = P.dropV[0] * 0.85; top = -P.dropSpin; clear = 0.1; } else {
        vh = (P.volleyV[0] + P.volleyV[1] * pace) * pw + incoming * 0.12; top = -30; evKind = 'volley';
        if (cls === 'low') vh *= 0.75;
      }
      clear = Math.min(clear, 0.2);
    } else if (kind === 'slice') {
      vh = (P.sliceV[0] + P.sliceV[1] * pace) * pw; top = -(P.slice[0] + P.slice[1] * spinR);
    } else if (kind === 'lob') {
      vyFix = P.lobVy[0] + P.lobVy[1] * pace; top = sw.shot?.top ?? -30;
    } else if (kind === 'drop') {
      vh = P.dropV[0] + P.dropV[1] * pace; top = -(P.dropSpin + 8 * spinR); clear = 0.12;
    } else {
      evKind = 'drive';
      vh = (P.driveV[0] + P.driveV[1] * pace) * pw;
      top = (P.topspin[0] + P.topspin[1] * spinR) * (0.6 + 0.4 * pace);
    }
    if (sw.shot?.top != null && kind !== 'lob') top = sw.shot.top;
    aimShot(b, tx, tz, vh || 20, top, side, clear, launchOut, vyFix);
    // the error: a turn of the aim, a share of the pace, a change of launch angle
    const a = randn(s) * sig.a, ca = Math.cos(a), sa = Math.sin(a);
    const kv = 1 + randn(s) * sig.v;
    b.vx = (launchOut.vx * ca - launchOut.vz * sa) * kv;
    b.vz = (launchOut.vx * sa + launchOut.vz * ca) * kv;
    b.vy = launchOut.vy + randn(s) * sig.y;
    // now and then the face closes: the ball is pulled down into the tape or the net
    if (sig.net && rand(s) < sig.net && launchOut.cross < 50) {
      const tNet = Math.abs(b.z) / Math.max(4, Math.abs(b.vz));
      b.vy -= (launchOut.cross + R + 0.02 + rand(s) * 0.35) / tNet;
    }
    b.spin[0] = launchOut.spin[0]; b.spin[1] = launchOut.spin[1]; b.spin[2] = launchOut.spin[2];
    b.roll = false;
    hitBy(i);
    emit({ type: 'hit', player: i, kind: evKind, power: clamp(pace, 0, 1), quality: clamp(q, 0, 1), frame });
    if (sw.shot?.rush) m.net = true;
    return true;
  }
  function hitBy(i) {
    b.last = i; b.bounces = 0; b.gen++; b.live = true; b.serve = false;
    netTouched = false;
    s.rally++;
    s.stats[0].rally = s.stats[1].rally = s.rally;
    lastTouch = s.t;
  }

  /** the target of the user's shot from the held direction: x across, fwd toward the opponent (+ deep) */
  function aimFor(i, kind, ix, fwd) {
    const eo = s.end[1 - i];
    let depth;
    if (kind === 'drop') depth = 2.6 + fwd * 0.6;
    else if (kind === 'lob') depth = 10.2 + fwd * 0.9;
    else depth = 9.2 + fwd * 1.9;
    return { tx: clamp(ix, -1, 1) * 3.3, tz: eo * depth };
  }

  // ---------- the serve ----------
  function setupServe() {
    s.phase = 'serve'; s.phaseT = 0;
    s.server = nextServer();
    s.court = nextCourt();
    if (s.practice) s.score.serveNo = 1;
    b.live = false; b.inHand = true; b.serve = false; b.bounces = 0; b.last = -1; b.roll = false; b.gen++;
    b.vx = b.vy = b.vz = 0; b.spin[0] = b.spin[1] = b.spin[2] = 0;
    s.rally = 0; s.stats[0].rally = s.stats[1].rally = 0;
    for (let i = 0; i < 2; i++) {
      const p = players[i], m = M[i];
      servePos(i, tmpP);
      if (Math.hypot(p.x - tmpP.x, p.z - tmpP.z) > 0.6) { p.x = tmpP.x; p.z = tmpP.z; p.vx = p.vz = 0; }
      m.swing = null; m.react = null; m.net = false; m.run = Math.max(0, m.run - 30);
      m.toss = 'wait'; m.waitT = i === s.server && !p.human ? ai.serveWait(i) : 0;
      m.plan.ok = false; m.plan.gen = -1; m.seen = -1; p.contact = null; p.charge = 0; p.aim = null;
      p.yaw = facing(i);
    }
    placeInHand();
  }
  const tmpP = { x: 0, z: 0 };
  /** where player i stands for the next serve (as server or receiver) */
  function nextServer() {
    if (s.practice === 'machine') return 1;
    if (s.practice) return (practiced >> 2) % 2 === 0 ? first : 1 - first;
    return s.score.server;
  }
  const nextCourt = () => (s.practice ? (s.practice === 'machine' || practiced % 2 === 0 ? 'deuce' : 'ad') : courtOf(s.score));
  function servePos(i, out) {
    const e = s.end[i], deuce = nextCourt() === 'deuce';
    if (s.practice === 'machine') {
      out.x = 0; out.z = e * (i === 1 ? COURT.halfL + 0.4 : COURT.halfL + 0.8);
      return out;
    }
    if (i === nextServer()) {
      out.x = e * (deuce ? 1 : -1) * 0.7; out.z = e * (COURT.halfL + 0.25);
    } else {
      const back = ai.receiveDepth(i);
      out.x = e * (deuce ? 1 : -1) * 2.7; out.z = e * (COURT.halfL + back);
    }
    return out;
  }
  function placeInHand() {
    const i = s.server, mv = MOVES.bounceBall, rel = mv.release?.at || [0.4, 0.95, -0.15];
    bodyPoint(i, rel, b);
    b.vx = b.vy = b.vz = 0;
  }
  /** a body-space point [f, u, s] (s to the racket side) of player i, facing the net, into o {x, y, z} */
  function bodyPoint(i, at, o) {
    const p = players[i], e = s.end[i], k = p.height / FIGURE.height;
    const f = vec(at, 0) * k, u = vec(at, 1) * k, sd = vec(at, 2) * k;
    o.x = p.x + e * sd * p.hand; o.y = u; o.z = p.z - e * f;
    return o;
  }

  function serveStep() {
    const i = s.server, p = players[i], m = M[i], o = recv();
    if (s.practice === 'machine') { feedStep(); return; }
    // the receiver waits on his mark (the user may shuffle without the assist)
    if (players[o].human && !assist) wantInput(o);
    else { servePos(o, tmpP); want(o, tmpP.x, tmpP.z, 1); }
    if (players[o].human) players[o].aim = null;
    if (p.human) {
      const a = serveAim(i, m.input.x, clamp(-m.input.y * s.end[i], -1, 1));
      p.aim = p.aim || { x: 0, z: 0 };
      p.aim.x = a.tx; p.aim.z = a.tz;
    }
    if (m.toss === 'fault') {
      if (s.phaseT >= P.faultT) {
        m.toss = 'wait'; m.waitT = p.human ? 0 : ai.serveWait(i) * 0.7;
        s.phaseT = 0; b.live = false; b.inHand = true; b.serve = false; b.gen++; b.roll = false;
        p.move = 'ready'; p.moveT = 0;
        M[o].swing = null; players[o].contact = null;
        servePos(i, tmpP); p.x = tmpP.x; p.z = tmpP.z; p.vx = p.vz = 0;
        servePos(o, tmpP);
        if (Math.hypot(players[o].x - tmpP.x, players[o].z - tmpP.z) > 1.5) { players[o].x = tmpP.x; players[o].z = tmpP.z; }
        placeInHand();
      }
      return;
    }
    if (m.toss === 'wait') {
      placeInHand();
      if (s.phaseT >= P.settle) { m.toss = 'bounce'; m.tossT = 0; p.move = 'bounceBall'; p.moveT = 0; }
      return;
    }
    if (m.toss === 'bounce') {
      m.tossT += DT;
      dribble(i);
      const mv = MOVES.bounceBall;
      const tossNow = p.human ? m.pressA || m.pressB : m.tossT >= m.waitT && p.moveT % mv.dur < DT * 1.5 && m.tossT > mv.dur * 0.9;
      if (p.human && (m.pressA || m.pressB)) m.serveKind = m.pressA ? 'flat' : 'kick';
      if (tossNow) {
        m.toss = 'toss'; m.tossT = 0;
        p.move = 'serve'; p.moveT = 0;
        b.inHand = true;
        m.swing = { move: 'serve', cls: 'serve', side: 1, kind: 'serve', contact: -1, rate: 1, dt: 0, q: 1, held: 0, hold: false, shot: null, serve: true, start: stepNo, done: false };
        if (!p.human) {
          const sv = MOVES.serve;
          m.swing.contact = stepNo + Math.round(sv.contact / DT);
          m.swing.dt = ai.serveTiming(i);
          m.swing.q = 1 - Math.pow(Math.min(1, Math.abs(m.swing.dt) / P.early), 1.5);
        }
        emit({ type: 'serve', player: i });
        emit({ type: 'swing', player: i, move: 'serve' });
      }
      return;
    }
    if (m.toss === 'toss') {
      const sv = MOVES.serve, rel = sv.release || { t: sv.contact * 0.35, at: [0.35, 1.6, -0.2] };
      if (b.inHand) {
        bodyPoint(i, rel.at, b);
        if (p.moveT >= rel.t) {
          // the toss: up from the hand to meet the sweet spot at contact (a CPU's timing error moves it)
          b.inHand = false; b.gen++;
          spotAt(i, 'serve', 1, p.x, p.z);
          const tc = Math.max(0.2, sv.contact - rel.t);
          b.vx = (SW[0] - b.x) / tc; b.vz = (SW[2] - b.z) / tc;
          b.vy = (SW[1] - b.y + 0.5 * P.g * tc * tc) / tc;
          b.vy *= 1 + KA * P.cd * b.vy * 0.25; // the toss's little drag
          b.spin[0] = b.spin[1] = b.spin[2] = 0;
        }
      } else if (p.human && m.swing && m.swing.contact < 0 && (m.pressA || m.pressB)) {
        // the hit press: contact P.serveLead later, the move sped or slowed to meet it
        const lead = P.serveLead, dt = p.moveT - (sv.contact - lead);
        m.swing.contact = stepNo + Math.round(lead / DT);
        m.swing.rate = clamp((sv.contact - p.moveT) / lead, 0.3, 3);
        m.swing.dt = dt;
        const win = dt < 0 ? P.early : P.late;
        m.swing.q = 1 - Math.pow(Math.min(1, Math.abs(dt) / win), 1.5);
        m.swing.hold = true; m.swing.held = 0; m.swing.btn = m.pressA ? 'a' : 'b';
        m.serveKind = m.pressA ? 'flat' : 'kick';
      } else if (m.swing && m.swing.contact < 0 && b.vy < 0 && b.y < P.catchY) {
        // let it drop: catch it and bounce again
        m.toss = 'bounce'; m.tossT = 0; m.swing = null; p.move = 'bounceBall'; p.moveT = 0; b.inHand = true; b.gen++;
      }
      if (b.inHand) return;
    }
  }
  /** practice with the machine: a ball fed from its spot to a new place on the user's side every time */
  function feedStep() {
    const o = 0, e0 = s.end[0];
    if (players[o].human && !assist) wantInput(o);
    else { servePos(o, tmpP); want(o, tmpP.x, tmpP.z, 1); }
    const mp = players[1];
    b.inHand = true; b.x = mp.x; b.y = 0.9; b.z = mp.z - s.end[1] * 0.3;
    if (s.phaseT < P.feedT) return;
    const k = practiced, side = k % 2 === 0 ? 1 : -1;
    const tx = side * (1.2 + rand(s) * 2.2), tz = e0 * (8 + rand(s) * 3);
    aimShot(b, tx, tz, 17 + rand(s) * 6, 120, 0, 0.6, launchOut);
    b.vx = launchOut.vx; b.vy = launchOut.vy; b.vz = launchOut.vz;
    b.spin[0] = launchOut.spin[0]; b.spin[1] = launchOut.spin[1]; b.spin[2] = launchOut.spin[2];
    b.inHand = false; b.roll = false;
    hitBy(1);
    s.rally = 1;
    s.phase = 'rally'; s.phaseT = 0;
    emit({ type: 'hit', player: 1, kind: 'drive', power: 0.5, quality: 1, feed: true });
  }
  /** the ball bounced in front of the server, in time with the bounceBall move */
  function dribble(i) {
    const p = players[i], mv = MOVES.bounceBall, rel = mv.release || { t: 0.15, at: [0.4, 0.95, -0.15] }, cat = mv.catch || { t: mv.dur * 0.6, at: rel.at };
    const t = p.moveT % mv.dur;
    bodyPoint(i, rel.at, b);
    if (t > rel.t && t < cat.t) {
      const u = (t - rel.t) / (cat.t - rel.t), y0 = b.y;
      b.y = R + (y0 - R) * (2 * u - 1) * (2 * u - 1);
      const u0 = (t - DT - rel.t) / (cat.t - rel.t);
      if (u0 < 0.5 && u >= 0.5) emit({ type: 'bounce', x: b.x, z: b.z, in: true, surface, dribble: true });
    }
  }

  function serveStrike(i) {
    const p = players[i], m = M[i], sw = m.swing, e = s.end[i], sv = MOVES.serve;
    sw.done = true;
    spotAt(i, 'serve', 1, p.x, p.z);
    const dy = b.y - SW[1];
    const dv = dy < 0 ? Math.max(0, -dy - 0.15) : Math.max(0, dy - 0.15);
    const d = Math.hypot(b.x - SW[0], dv, b.z - SW[2]);
    const serveNo = s.score.serveNo;
    s.stats[i][serveNo === 1 ? 'firstServe' : 'secondServe'][1]++;
    if (b.inHand || d > reachOf(sv)) {
      // a swing and a miss: a fault
      b.inHand = false;
      fault(i, 'FAULT');
      return;
    }
    let q = sw.q * (1 - 0.4 * (d / reachOf(sv)) ** 2);
    const r = m.r, eo = s.end[recv()];
    const deuce = s.court === 'deuce', sg = (deuce ? -1 : 1) * e;
    let tx, tz, speed, kind, sig;
    if (p.human) {
      const inp = m.input, fwd = clamp(-inp.y * e, -1, 1);
      ({ tx, tz } = serveAim(i, inp.x, fwd));
      kind = m.serveKind || 'flat';
      const charge = clamp(sw.held / (P.serveLead * 0.8), 0, 1);
      p.charge = charge;
      speed = (36 + 2.6 * r.serve) * (0.82 + 0.18 * charge) * (kind === 'flat' ? 1 : 0.76);
      sig = { a: 0.01 + 0.03 * (1 - q) + (9 - r.serve) * 0.002, v: 0.01 + 0.03 * (1 - q), y: 0.05 + 0.25 * (1 - q) };
    } else {
      const c = ai.serve(i, serveNo, sg, eo);
      ({ tx, tz, speed, kind } = c);
      sig = c.sigma;
    }
    // timing: early meets it high (long), late low (into the net)
    tz += -eo * -sw.dt * P.serveDepth;
    let top = 30, side = 0;
    if (kind === 'slice') { top = 20; side = p.hand * 160; speed *= 0.9; }
    else if (kind === 'kick') { top = 260 + r.spin * 8; side = -p.hand * 50; }
    aimShot(b, tx, tz, speed, top, side, kind === 'kick' ? 0.3 : 0.05, launchOut);
    const a = randn(s) * sig.a, ca = Math.cos(a), sa = Math.sin(a), kv = 1 + randn(s) * sig.v;
    b.vx = (launchOut.vx * ca - launchOut.vz * sa) * kv;
    b.vz = (launchOut.vx * sa + launchOut.vz * ca) * kv;
    b.vy = launchOut.vy + randn(s) * sig.y;
    b.spin[0] = launchOut.spin[0]; b.spin[1] = launchOut.spin[1]; b.spin[2] = launchOut.spin[2];
    b.inHand = false; b.roll = false;
    hitBy(i);
    s.rally = 1; s.stats[0].rally = s.stats[1].rally = 1;
    b.serve = true;
    s.serveSpeed = Math.round(Math.hypot(b.vx, b.vy, b.vz) * 3.6);
    s.stats[i].fastest = Math.max(s.stats[i].fastest, s.serveSpeed);
    s.phase = 'rally'; s.phaseT = 0;
    emit({ type: 'hit', player: i, kind: 'serve', power: clamp(speed / 62, 0, 1), quality: clamp(q, 0, 1), speed: s.serveSpeed });
    if (!p.human && ai.rushAfterServe(i, serveNo)) m.net = true;
  }
  /** the user's serve target from the held direction: x across the box, fwd deeper */
  function serveAim(i, ix, fwd) {
    const e = s.end[i], eo = -e, deuce = s.court === 'deuce', sg = (deuce ? -1 : 1) * e;
    const cx = sg * COURT.halfW * 0.5;
    return { tx: clamp(cx + clamp(ix, -1, 1) * 1.6, sg > 0 ? 0.25 : -3.85, sg > 0 ? 3.85 : -0.25), tz: eo * (5.35 + fwd * 0.6) };
  }

  function fault(i, text) {
    const serveNo = s.score.serveNo;
    b.live = false; b.serve = false;
    if (serveNo === 1) {
      s.score.serveNo = 2;
      M[i].toss = 'fault'; s.phase = 'serve'; s.phaseT = 0;
      s.call = { text, t: s.t };
      emit({ type: 'fault', serveNo: 1 });
    } else {
      s.stats[i].doubleFaults++;
      emit({ type: 'fault', serveNo: 2 });
      endPoint(1 - i, 'double', 'DOUBLE FAULT');
    }
  }
  function letServe() {
    b.live = false; b.serve = false;
    M[s.server].toss = 'fault'; s.phase = 'serve'; s.phaseT = 0;
    s.call = { text: 'LET', t: s.t };
    emit({ type: 'let' });
  }

  // ---------- the ball's rules ----------
  let lastTouch = 0, netTouched = false;
  const binfo = { bx: 0, bz: 0, vin: 0 };
  function ballStep() {
    if (b.inHand) return;
    const f = advance(b, surf, rand(s), binfo);
    if (f & (F_NET | F_CORD | F_POST)) {
      b.gen++;
      if (b.live) netTouched = true;
      emit({ type: 'net', cord: !!(f & F_CORD), post: !!(f & F_POST) });
    }
    if (!(f & F_BOUNCE)) return;
    const x = binfo.bx, z = binfo.bz;
    if (!b.live) { emit({ type: 'bounce', x, z, in: inCourt(0, x, z) || inCourt(1, x, z), surface }); return; }
    b.bounces++;
    const h = b.last, o = 1 - h;
    if (b.serve) {
      const good = inBox(x, z);
      s.bounce = { x, z, in: good, t: s.t };
      emit({ type: 'bounce', x, z, in: good, surface });
      if (good && netTouched) { letServe(); return; }
      if (!good) {
        emit({ type: 'out', x, z });
        fault(h, 'FAULT');
        return;
      }
      b.serve = false;
      s.stats[h][s.score.serveNo === 1 ? 'firstServe' : 'secondServe'][0]++;
      netTouched = false;
      return;
    }
    const mine = z * s.end[h] > 0; // on the hitter's own side
    if (b.bounces === 1) {
      const good = !mine && inCourt(o, x, z);
      s.bounce = { x, z, in: good, t: s.t };
      emit({ type: 'bounce', x, z, in: good, surface });
      if (mine) { endPoint(o, netTouched ? 'net' : 'error', netTouched ? 'NET' : null); return; }
      if (!good) { emit({ type: 'out', x, z }); endPoint(o, 'out', 'OUT'); return; }
      netTouched = false;
      return;
    }
    emit({ type: 'bounce', x, z, in: inCourt(0, x, z) || inCourt(1, x, z), surface });
    // the second bounce: the hitter's point (an ace when it was the serve and untouched)
    const ace = s.rally === 1;
    endPoint(h, ace ? 'ace' : 'winner', ace ? 'ACE' : null);
  }

  function endPoint(w, how, text) {
    const l = 1 - w;
    b.live = false; b.serve = false; netTouched = false;
    if (s.practice) {
      // practice: the call, a short pause and the next ball; no score
      practiced++;
      emit({ type: 'point', winner: w, how, practice: true });
      s.call = text && how !== 'ace' ? { text, t: s.t } : null;
      pending = null; changeDue = false;
      s.phase = 'point'; s.phaseT = P.pointT - (s.practice === 'machine' ? P.feedPause : P.pointT * 0.6);
      for (let i = 0; i < 2; i++) { M[i].plan.ok = false; M[i].net = false; players[i].contact = null; players[i].aim = null; }
      return;
    }
    const st = s.stats;
    st[w].points++;
    const srv = s.server;
    st[srv].servePoints[1]++;
    if (w === srv) st[srv].servePoints[0]++;
    if (how === 'ace') st[w].aces++;
    if (how === 'ace' || how === 'winner') st[w].winners++;
    if (how === 'out' || how === 'net' || how === 'error') st[l].errors++;
    if (Math.abs(players[w].z) < COURT.service + 0.5) st[w].netPoints++;
    emit({ type: 'point', winner: w, how });
    const r = pointWon(s.score, w);
    if (r.game >= 0) emit({ type: 'game', winner: r.game });
    if (r.set >= 0) emit({ type: 'set', winner: r.set });
    if (r.match >= 0) emit({ type: 'match', winner: r.match });
    s.call = text ? { text, t: s.t } : null;
    pending = r.match >= 0 ? 'MATCH' : r.set >= 0 ? 'SET' : r.game >= 0 ? 'GAME' : null;
    if (!text && pending) { s.call = { text: pending, t: s.t }; pending = null; }
    changeDue = r.change;
    s.phase = 'point'; s.phaseT = 0;
    for (let i = 0; i < 2; i++) { M[i].plan.ok = false; M[i].net = false; players[i].contact = null; players[i].aim = null; }
    if (r.set >= 0 || r.match >= 0) {
      react(w, 'celebrate');
      if (r.match >= 0) react(l, 'dejected');
    }
  }
  let pending = null, changeDue = false, practiced = 0;

  function react(i, move) {
    const p = players[i], m = M[i];
    if (!MOVES[move]) return;
    m.swing = null; m.react = move;
    p.move = move; p.moveT = 0;
  }

  // ---------- the flow ----------
  setupServe();

  function step(inputs = []) {
    stepNo++;
    s.t += DT;
    s.phaseT += DT;
    for (let i = 0; i < 2; i++) readInput(i, inputs[i]);
    if (s.call && s.t - s.call.t > 2.5 && s.phase !== 'over') s.call = null;
    const ph = s.phase;
    if (ph === 'serve') serveStep();
    else if (ph === 'rally') rallyStep();
    else if (ph === 'point') pauseStep();
    else if (ph === 'change') changeStep();
    else if (ph === 'over') overStep();
    // swings meet the ball before it moves this step
    for (let i = 0; i < 2; i++) {
      const sw = M[i].swing;
      if (sw && !sw.done && sw.contact === stepNo) {
        if (sw.serve) serveStrike(i);
        else if (s.phase === 'rally') strike(i);
        else sw.done = true;
      }
    }
    ballStep();
    if (s.phase === 'rally' && b.live && s.t - lastTouch > P.serveMax) endPoint(1 - Math.max(0, b.last), 'error', null); // never: a ball stuck in the tape
    for (let i = 0; i < 2; i++) movePlayer(i);
  }

  function readInput(i, inp) {
    const m = M[i], p = players[i];
    if (!p.human) { m.input = EMPTY_INPUT; m.pressA = m.pressB = false; return; }
    inp = inp || EMPTY_INPUT;
    m.input = inp;
    m.pressA = !!inp.a && !m.prevA;
    m.pressB = !!inp.b && !m.prevB && !m.pressA;
    m.prevA = !!inp.a; m.prevB = !!inp.b;
    const sw = m.swing;
    if (sw && !sw.done && sw.hold && sw.btn) {
      if (sw.btn === 'a' ? inp.a : inp.b) sw.held += DT;
      else sw.hold = false;
      p.charge = clamp(sw.held / (sw.serve ? P.serveLead * 0.8 : P.chargeT), 0, 1);
    }
  }

  // ---------- the rally ----------
  function rallyStep() {
    for (let i = 0; i < 2; i++) {
      const p = players[i], m = M[i];
      if (s.practice === 'machine' && i === 1) { want(1, p.x, p.z, 1); continue; }
      const coming = b.live && !b.inHand && b.last === 1 - i;
      if (coming && m.seen !== b.gen) {
        // a new flight: a moment to react (the swing already under way stays)
        if (m.seen < 0 || b.last !== m.seenLast) m.reactT = m.reactS;
        m.seen = b.gen; m.seenLast = b.last; m.planT = 0;
      }
      if (m.reactT > 0) m.reactT -= DT;
      const auto = !p.human || assist;
      if (coming) {
        if (auto && !m.swing && (m.planT -= DT) <= 0 && m.reactT <= 0) {
          planFor(i, p.human ? humanKind(i) : 'drive');
          m.planT = 0.2;
          if (!p.human && !m.plan.leave && m.plan.slack > -2) {
            if (m.shotGen !== b.gen) { m.shot = ai.shot(i, m.plan); m.err = ai.timing(i, m.plan); m.shotGen = b.gen; }
            const kind = m.shot.kind;
            if (m.plan.cls === 'ground' && kind !== 'drive') {
              const mv2 = strokeMove('ground', kind, m.plan.side);
              spotAt(i, mv2, m.plan.side, 0, 0);
              m.plan.move = mv2; m.plan.sx = m.plan.bx - SW[0]; m.plan.sz = m.plan.bz - SW[2];
            }
          }
        }
        const pl = m.plan;
        if (p.human) {
          p.aim = aimTarget(i);
          if (!m.swing && (m.pressA || m.pressB)) humanSwing(i);
          if (auto) {
            if (pl.gen === b.gen && !pl.leave && (pl.ok || pl.slack > -1.5)) want(i, pl.sx, pl.sz, 0);
            else want(i, p.x, p.z, 1);
          } else wantInput(i);
        } else if (!m.swing) {
          if (pl.gen === b.gen && !pl.leave && (pl.ok || pl.slack > -2)) {
            want(i, pl.sx, pl.sz, 0);
            const mv = MOVES[pl.move];
            const start = pl.step - Math.round(mv.contact / DT) + Math.round((m.err || 0) / DT);
            if (stepNo >= start && m.reactT <= 0) {
              const dt = (stepNo + mv.contact / DT - pl.step) * DT;
              beginSwing(i, pl.move, pl.cls, pl.side, pl.step, dt, m.shot.kind, m.shot);
            }
          } else if (pl.leave && pl.gen === b.gen) want(i, p.x, p.z, 1);
          else if (pl.gen === b.gen) want(i, pl.sx, pl.sz, 0);
        }
      } else {
        // the ball is going the other way (or dead): get back into position, split as the other strikes
        if (p.human) {
          p.aim = null;
          if (assist) {
            const f = -m.input.y * s.end[i];
            if (f > 0.6) m.net = true;
            else if (f < -0.6) m.net = false;
            ai.recover(i, tmpP);
            want(i, tmpP.x, tmpP.z, 0.8);
          } else wantInput(i);
        } else {
          ai.recover(i, tmpP);
          want(i, tmpP.x, tmpP.z, 0.8);
        }
        const os = M[1 - i].swing;
        if (os && !os.done && !m.swing && !m.react && os.contact - stepNo === 6 && s.t - m.splitT > 0.8) {
          m.splitT = s.t; react(i, 'split');
        }
      }
    }
  }
  const humanKind = i => {
    const m = M[i], inp = m.input;
    if (!(inp.b || m.pressB)) return 'drive';
    const f = -inp.y * s.end[i];
    return f > 0.5 ? 'lob' : f < -0.5 ? 'drop' : 'slice';
  };
  /** the user's press: the stroke and the moment from where he will be, the timing from the press */
  function humanSwing(i) {
    const p = players[i], m = M[i], pl = m.plan;
    const coming = b.live && !b.inHand && b.last === 1 - i;
    if (!coming) return;
    const kind = humanKind(i);
    let x = p.x + p.vx * 0.15, z = p.z + p.vz * 0.15;
    if (assist && pl.gen === b.gen && (pl.ok || pl.slack > -0.4)) { x = pl.sx; z = pl.sz; }
    const c = closest(i, kind, x, z);
    const btn = m.pressA ? 'a' : 'b';
    if (c.step < 0 || c.d > 1.6) {
      // nothing to meet: a swing at the air, on the side the ball is
      const side = (b.x - p.x) * s.end[i] * p.hand > 0 ? 1 : -1;
      beginSwing(i, strokeMove('ground', kind, side), 'ground', side, -1, 1, kind);
    } else {
      beginSwing(i, c.move, c.cls, c.side, c.step, c.dt, kind);
      if (assist && (c.move !== pl.move || c.step !== pl.step)) {
        // the assist follows the stroke the user chose
        const j = c.step - path.step;
        spotAt(i, c.move, c.side, 0, 0);
        pl.sx = PX[j] - SW[0]; pl.sz = PZ[j] - SW[2]; pl.step = c.step; pl.move = c.move; pl.ok = true;
      }
    }
    m.swing.btn = btn;
  }
  /** the user's aim marker: where the shot would land */
  function aimTarget(i) {
    const m = M[i], inp = m.input, e = s.end[i];
    const t = aimFor(i, m.swing ? m.swing.kind : humanKind(i), inp.x, clamp(-inp.y * e, -1, 1));
    const a = players[i].aim || { x: 0, z: 0 };
    a.x = t.tx; a.z = t.tz;
    return a;
  }

  // ---------- between points ----------
  function pauseStep() {
    if (pending && s.phaseT >= P.callT) { s.call = { text: pending, t: s.t }; pending = null; }
    const over = s.score.done;
    for (let i = 0; i < 2; i++) {
      if (s.phaseT < 0.9 || over) want(i, players[i].x, players[i].z, 1);
      else if (changeDue) want(i, 5.5, s.end[i] * 2.5, 2.5, true);
      else { servePos(i, tmpP); want(i, tmpP.x, tmpP.z, 2.5, true); }
    }
    if (s.phaseT >= P.pointT) {
      if (over) {
        s.phase = 'over'; s.phaseT = 0; match.done = true;
        const w = s.score.winner;
        react(w, 'celebrate'); react(1 - w, 'dejected');
        s.call = { text: 'MATCH', t: s.t };
      } else if (changeDue) {
        s.phase = 'change'; s.phaseT = 0;
        emit({ type: 'change' });
      } else setupServe();
    }
  }
  function changeStep() {
    for (let i = 0; i < 2; i++) want(i, 6.0, s.end[i] * 1.6, 3, true);
    if (s.phaseT >= P.changeT) swapEnds();
  }
  function swapEnds() {
    s.end[0] = -s.end[0]; s.end[1] = -s.end[1];
    changeDue = false;
    for (let i = 0; i < 2; i++) { players[i].z = -players[i].z; players[i].x = -players[i].x; players[i].yaw = facing(i); }
    setupServe();
  }
  function overStep() {
    for (let i = 0; i < 2; i++) {
      want(i, players[i].x, players[i].z, 1);
      if (!M[i].react && s.phaseT > 2 && players[i].move !== 'bow') react(i, 'bow');
    }
  }
  /** end a pause now (a changeover the page skips, a point's wait cut short) */
  function skip() {
    if (s.phase === 'point') s.phaseT = Math.max(s.phaseT, P.pointT - DT);
    else if (s.phase === 'change') s.phaseT = Math.max(s.phaseT, P.changeT - DT);
  }

  // ---------- moving ----------
  /** player i wants to be at (x, z) in about `tLeft` s (`walk`: no hurry) */
  function want(i, x, z, tLeft, walk = false) {
    const m = M[i];
    m.wantX = x; m.wantZ = z; m.tLeft = tLeft; m.walk = walk; m.free = false;
  }
  function wantInput(i) {
    const m = M[i], inp = m.input;
    m.free = true;
    const mag = Math.hypot(inp.x, inp.y);
    m.ix = mag > 1 ? inp.x / mag : inp.x; m.iz = mag > 1 ? inp.y / mag : inp.y;
  }
  function movePlayer(i) {
    const p = players[i], m = M[i], e = s.end[i];
    const top = m.top * fatigue(i);
    let dvx = 0, dvz = 0;
    if (s.phase === 'serve' && i === s.server) { m.free = false; m.wantX = p.x; m.wantZ = p.z; m.tLeft = 1; }
    if (m.free) {
      dvx = m.ix * top; dvz = m.iz * top;
    } else {
      const dx = m.wantX - p.x, dz = m.wantZ - p.z, d = Math.hypot(dx, dz);
      if (d > 0.03) {
        const vmax = m.walk ? Math.min(top * 0.5, 2.2) : top;
        const tl = m.tLeft ?? 1;
        let v = tl <= 0 ? vmax : Math.min(vmax, Math.max((d / Math.max(0.12, tl - P.setT)) * 1.3, Math.min(vmax * 0.5, d * 2.5)));
        v = Math.min(v, Math.sqrt(2 * m.acc * P.decK * d));
        dvx = (dx / d) * v; dvz = (dz / d) * v;
      }
    }
    const sw = m.swing;
    if (sw && !sw.done) { dvx *= P.swingMove; dvz *= P.swingMove; }
    else if (sw) { dvx *= P.afterMove; dvz *= P.afterMove; }
    if (m.react === 'celebrate' || m.react === 'dejected' || m.react === 'bow') { dvx = dvz = 0; }
    const ex = dvx - p.vx, ez = dvz - p.vz, ed = Math.hypot(ex, ez);
    const braking = dvx * p.vx + dvz * p.vz < p.vx * p.vx + p.vz * p.vz;
    const amax = (braking ? m.acc * P.decK : m.acc) * DT;
    if (ed > amax) { p.vx += (ex / ed) * amax; p.vz += (ez / ed) * amax; } else { p.vx = dvx; p.vz = dvz; }
    p.x += p.vx * DT; p.z += p.vz * DT;
    // the court and its run-off, and no further than the net
    if (Math.abs(p.x) > COURT.backX - 0.4) { p.x = Math.sign(p.x) * (COURT.backX - 0.4); p.vx = 0; }
    if (Math.abs(p.z) > COURT.backZ - 0.4) { p.z = Math.sign(p.z) * (COURT.backZ - 0.4); p.vz = 0; }
    if (p.z * e < 0.35) { p.z = e * 0.35; p.vz = 0; }
    p.speed = Math.hypot(p.vx, p.vz);
    if (s.phase === 'rally') m.run += p.speed * DT;
    animate(i);
  }

  const LOOPS = { run: 2.6, shuffle: 1.3, backpedal: 1.2, walk: 1.4 };
  function animate(i) {
    const p = players[i], m = M[i], e = s.end[i];
    const sw = m.swing;
    let target = facing(i);
    if (sw) {
      const t0 = p.moveT;
      p.moveT += (sw.done ? 1 : sw.rate) * DT;
      // a move whose root travels (the serve's step into the court): the sim carries the player
      const tr = MOVES[sw.move].travel;
      if (tr) {
        const d = (travelAt(sw.move, p.moveT) - travelAt(sw.move, t0)) * (p.height / FIGURE.height);
        if (d) {
          const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), f = tr.f * d, sd = tr.s * d * p.hand;
          p.x += -sy * f + cy * sd; p.z += -cy * f - sy * sd;
        }
      }
      if (sw.done && p.moveT >= MOVES[sw.move].dur) { m.swing = null; p.contact = null; if (!M[i].react) p.charge = 0; }
    } else if (m.react) {
      p.moveT += DT;
      if (p.moveT >= MOVES[m.react].dur) {
        if (m.react === 'bow' || ((m.react === 'celebrate' || m.react === 'dejected') && s.phase === 'over' && s.phaseT < 2)) p.moveT = MOVES[m.react].dur - DT * 0.5;
        else m.react = null;
      }
    }
    if (!m.swing && !m.react && !(s.phase === 'serve' && i === s.server && M[i].toss !== 'wait' && M[i].toss !== 'fault')) {
      // locomotion: shuffle sideways and backpedal facing the net, turn and run when it's far
      const sp = p.speed, fwd = -p.vz * e, lat = p.vx * e;
      let mv = 'ready';
      const relaxed = s.phase === 'point' || s.phase === 'change' || s.phase === 'over' || (s.phase === 'serve' && M[i].toss === 'wait');
      if (sp > 0.35) {
        if (relaxed && sp < 2.6) mv = 'walk';
        else if (sp > 3.6 && Math.abs(lat) < sp * 0.92) mv = 'run';
        else if (fwd < -0.5 * sp && sp < 4) mv = 'backpedal';
        else if (Math.abs(lat) > Math.abs(fwd)) mv = sp > 4.2 ? 'run' : 'shuffle';
        else mv = 'run';
      }
      if (mv !== p.move) { p.move = mv; p.moveT = 0; }
      else p.moveT += DT;
      if (mv === 'run' || mv === 'walk') target = Math.atan2(-p.vx, -p.vz);
      const stride = MOVES[mv]?.stride || LOOPS[mv];
      if (stride) {
        const ph0 = p.phase;
        p.phase = (p.phase + (sp * DT) / stride) % 1;
        if ((ph0 < 0.5 && p.phase >= 0.5) || p.phase < ph0) emit({ type: 'step', player: i });
      }
    } else if (s.phase === 'serve' && i === s.server && p.move === 'bounceBall') p.moveT += DT;
    // turn
    let da = target - p.yaw;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const turn = (sw ? 16 : 10) * DT;
    p.yaw += clamp(da, -turn, turn);
    p.yaw = Math.atan2(Math.sin(p.yaw), Math.cos(p.yaw));
  }

  // ---------- the result ----------
  function result() {
    const sc = s.score;
    const setsOut = setScores(sc);
    return { winner: sc.done ? sc.winner : -1, sets: setsOut, tiebreaks: sc.tbs.slice(), stats: s.stats.map(x => ({ ...x, firstServe: x.firstServe.slice(), secondServe: x.secondServe.slice(), servePoints: x.servePoints.slice() })) };
  }

  // for tools: the internals
  match.debug = { M, ai, path, planFor, closest, stepNo: () => stepNo, ensurePath, spotAt: (i, mv, side, x, z) => spotAt(i, mv, side, x, z).slice(), PX, PY, PZ, PB, pressure: () => pressure(s.score) };
  return match;
}
