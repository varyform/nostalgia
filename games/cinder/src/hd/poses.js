// Every move in moves.js as keyframed poses, and the sampler that eases between them from a
// fighter's `move`, `moveT`, `phase` and `stance`. A pose is a flat set of numbers (so two
// poses blend by lerping each one), in metres and degrees, for a 1.0-size figure facing right
// (x forward, y up from the ground):
//
//   hx, hy   the hips, forward of the fighter's x and above the ground
//   t, n     the torso's lean from upright (+ forward) and the head's nod on it (+ chin down)
//   la, le   the lead (far) arm: shoulder angle from the torso's own "down" (+ forward, 180 is
//            straight up) and the elbow's bend (+ the forearm folds forward / up)
//   ra, re   the rear (near) arm, the one that punches
//   lx, ly   where the lead (far) ankle is, on the ground at ly 0.08; the knee is solved (IK)
//   rx, ry   the rear (near) ankle, the leg that kicks
//   lf, rf   the feet's tilt (+ toes down), op how open the hands are (0 fists … 1 palms)
//
// Attacks have three beats keyed to the move's hit window: the windup eases into an
// anticipation pose and holds it, snaps to the strike at `on`, holds through the window and
// follows through before settling to guard by `dur`.
import { MOVES } from '../moves.js';

export const KEYS = ['hx', 'hy', 't', 'n', 'la', 'le', 'ra', 're', 'lx', 'ly', 'rx', 'ry', 'lf', 'rf', 'op'];
const Z = { hx: 0, hy: 0.85, t: 0, n: 0, la: 0, le: 0, ra: 0, re: 0, lx: 0.1, ly: 0.08, rx: -0.1, ry: 0.08, lf: 0, rf: 0, op: 0 };
const P = o => ({ ...Z, ...o });
const with_ = (p, o) => ({ ...p, ...o });

// the gaits' strides (metres per full cycle of fighter.phase), for the feet to stay put
export const STRIDE = { walk: 0.7, run: 2.1 }; // = the sim's P.strideWalk / P.strideRun

// ---------- the stances ----------
const GUARD = P({ hy: 0.85, t: 10, n: 4, la: 62, le: 78, ra: 22, re: 118, lx: 0.3, rx: -0.3, rf: 8 });
// Wren's: a wide, low straddle, side-on and upright, the lead fist out at the shoulder and the
// rear one drawn in at the chest
const WIDE = P({ hy: 0.76, t: -2, n: 2, la: 44, le: 74, ra: 14, re: 130, lx: 0.44, rx: -0.46, lf: -4, rf: -4 });
const READY = P({ hy: 0.95, t: 3, n: 2, la: 4, le: 20, ra: -6, re: 25, lx: 0.07, rx: -0.07 });
// each kind holds its guard its own way
const GUARDS = {
  hero: WIDE,
  footman: with_(GUARD, { t: 12, la: 58, le: 74 }),
  brawler: with_(GUARD, { hy: 0.8, t: 18, n: 8, lx: 0.36, rx: -0.36, la: 48, le: 88, ra: 16, re: 112 }),
  adept: with_(GUARD, { hy: 0.86, t: 4, la: 80, le: 30, op: 0.8, lx: 0.4, rx: -0.3, ra: 30, re: 100 }),
  regent: with_(GUARD, { hy: 0.9, t: 0, n: -4, la: 20, le: 40, ra: -8, re: 50, lx: 0.22, rx: -0.24, op: 0.6 }),
  teacher: READY,
};

// ---------- attacks: [windup, strike, follow-through] ----------
const A = (g, wind, strike, follow = {}) => {
  const s = with_(g, strike);
  return [with_(g, wind), s, with_(s, follow)];
};
const ATTACKS = {
  punchHigh: g => A(g, { hx: -0.04, t: 5, ra: -18, re: 128 }, { hx: 0.1, t: 12, n: 0, ra: 100, re: 4, la: -12, le: 120, lx: 0.53, rx: -0.42, rf: 20 }, { ra: 96, re: 12 }),
  punchMid: g => A(g, { hx: -0.04, t: 6, ra: -16, re: 124 }, { hx: 0.11, t: 14, n: 2, ra: 88, re: 2, la: -12, le: 120, lx: 0.54, rx: -0.42, rf: 20 }, { ra: 84, re: 10 }),
  punchLow: g => A(g, { hy: 0.8, t: 20, ra: -10, re: 120 }, { hx: 0.12, hy: 0.72, t: 30, n: -8, ra: 58, re: 2, la: -8, le: 116, lx: 0.55, rx: -0.42, rf: 18 }, { ra: 54, re: 10 }),
  kickHigh: g => A(g, { hy: 0.9, t: -4, lx: 0.02, rx: 0.12, ry: 0.62, rf: 30, la: 70, le: 80, ra: 10, re: 110 }, { hx: -0.04, hy: 0.92, t: -28, n: 12, lx: -0.02, rx: 0.7, ry: 1.38, rf: 5, la: 80, le: 70, ra: -40, re: 50 }, { rx: 0.62, ry: 1.3 }),
  kickMid: g => A(g, { hy: 0.88, t: -2, lx: 0.02, rx: 0.14, ry: 0.5, rf: 30, la: 70, le: 80, ra: 10, re: 110 }, { hx: -0.04, hy: 0.9, t: -16, n: 8, lx: -0.02, rx: 0.8, ry: 0.88, rf: 10, la: 78, le: 74, ra: -34, re: 56 }, { rx: 0.72, ry: 0.84 }),
  kickLow: g => A(g, { hy: 0.84, t: 4, lx: 0.04, rx: 0.08, ry: 0.3, rf: 20, la: 66, le: 84, ra: 14, re: 112 }, { hy: 0.76, t: 8, n: 4, lx: 0.0, rx: 0.62, ry: 0.18, rf: -5, la: 70, le: 70, ra: -24, re: 70 }, { rx: 0.56 }),
  // the palm's tell: both arms raised high and drawn back, the weight sinking onto the rear leg
  palm: g => A(g, { hx: -0.14, hy: 0.8, t: -16, n: -8, ra: 168, re: 30, la: 140, le: 40, op: 1, lx: 0.3, rx: -0.38 }, { hx: 0.22, hy: 0.76, t: 24, n: -6, ra: 84, re: 8, la: 76, le: 14, op: 1, lx: 0.62, rx: -0.32, rf: 30 }, { ra: 80, la: 70, le: 22 }),
};
// the kinds that kick or punch with their own flavour
const ATTACK_KIND = {
  brawler: { t: 6, hy: -0.03 }, // lower and heavier
  adept: { op: 0.9 },
};

// ---------- held and timed moves ----------
const HELD = {
  block: g => with_(g, { hx: -0.04, t: 2, n: 6, la: 78, le: 96, ra: 38, re: 120, op: 0 }),
  blockLow: g => with_(g, { hy: 0.78, t: 20, n: 6, la: 28, le: 22, ra: 30, re: 115, lx: 0.34, rx: -0.32, op: 0 }),
  duck: g => with_(g, { hy: 0.52, t: 34, n: 12, la: 44, le: 108, ra: 20, re: 130, lx: 0.3, rx: -0.3, rf: 30, op: 0 }),
};
const RECOIL = {
  high: g => with_(g, { hx: -0.12, t: -18, n: -24, la: 116, le: 25, ra: -36, re: 45, lx: 0.2, ly: 0.13, rx: -0.4 }),
  mid: g => with_(g, { hx: -0.1, hy: 0.8, t: 22, n: 14, la: 30, le: 70, ra: -20, re: 80, lx: 0.22, ly: 0.12, rx: -0.38 }),
  low: g => with_(g, { hx: -0.06, hy: 0.74, t: 30, n: 22, la: 20, le: 60, ra: -10, re: 70, lx: 0.16, ly: 0.16, rx: -0.36 }),
};
// keys as [fraction of the move, pose, easing into it]
const KO = g => [
  [0, RECOIL.high(g)],
  [0.22, P({ hx: -0.3, hy: 0.78, t: -28, n: -18, la: 130, le: 30, ra: -60, re: 40, lx: 0.1, rx: -0.5 }), 'out'],
  [0.5, P({ hx: -0.62, hy: 0.42, t: -62, n: -10, la: 160, le: 20, ra: 150, re: 30, lx: 0.05, ly: 0.3, rx: -0.2, ry: 0.16, lf: 30, rf: 20 }), 'in'],
  [0.72, P({ hx: -0.85, hy: 0.12, t: -88, n: 6, la: 175, le: 10, ra: 120, re: 30, lx: -0.25, ly: 0.2, rx: -0.05, ry: 0.07, lf: 60, rf: 40 }), 'in'],
  [0.82, P({ hx: -0.86, hy: 0.17, t: -82, n: 0, la: 170, le: 16, ra: 110, re: 34, lx: -0.28, ly: 0.24, rx: -0.03, ry: 0.09, lf: 55, rf: 50 }), 'out'],
  [1, P({ hx: -0.86, hy: 0.11, t: -90, n: 8, la: 178, le: 5, ra: 100, re: 20, lx: -0.3, ly: 0.18, rx: -0.02, ry: 0.07, lf: 50, rf: 70 }), 'io'],
];
const BOW = r => { const b = with_(r, { hx: -0.05, t: 42, n: 18, la: 48, le: 5, ra: 44, re: 8, op: 1 }); return [[0, r], [0.3, b, 'io'], [0.72, b], [1, r, 'io']]; };
const CHEER = r => {
  const up = { ra: 168, re: 15, la: -10, le: 95, n: -6, op: 0 };
  return [
    [0, r],
    [0.14, with_(r, { hy: 0.82, t: 12, ra: -20, re: 60, la: -10, le: 60, lx: 0.1, rx: -0.1 }), 'io'],
    [0.3, with_(r, { hy: 1.12, t: -4, n: -8, ra: 172, re: 10, la: -15, le: 95, lx: 0.1, ly: 0.24, rx: -0.08, ry: 0.3, lf: 30, rf: 30 }), 'out'],
    [0.48, with_(r, { hy: 0.84, t: 10, ra: 165, re: 20, la: -10, le: 90 }), 'in'],
    [0.62, with_(r, up), 'out'],
    [0.85, with_(r, up)],
    [1, r, 'io'],
  ];
};
// Master Oriel, kneeling while he is held
export const KNEEL = P({ hx: 0, hy: 0.46, t: 6, n: 16, la: 30, le: 70, ra: 26, re: 74, lx: -0.28, ly: 0.07, rx: -0.3, ry: 0.07, lf: -70, rf: -70, op: 1 });

// ---------- easing ----------
const EASE = {
  lin: q => q,
  io: q => q * q * (3 - 2 * q),
  in: q => q * q * q, // the snap of a strike
  out: q => 1 - (1 - q) ** 3,
};
const cl = q => (q < 0 ? 0 : q > 1 ? 1 : q);
export function lerpPose(a, b, q, out = {}) {
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * q;
  return out;
}
function keyed(keys, f) {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [f1, p1, e = 'io'] = keys[i];
    if (f <= f1) { const [f0, p0] = keys[i - 1]; return lerpPose(p0, p1, EASE[e](cl((f - f0) / (f1 - f0 || 1)))); }
  }
  return keys[keys.length - 1][1];
}

// ---------- gaits ----------
// the guard shuffle: the lead foot steps, then the rear foot follows; phase 0…1 is one of each
function walk(g0, p) {
  const g = with_(g0, { lx: g0.lx - 0.03, rx: g0.rx + 0.03 });
  const half = p < 0.5, q = (half ? p : p - 0.5) * 2, s = STRIDE.walk / 4, lift = Math.sin(q * Math.PI) * 0.07;
  const o = { ...g };
  if (half) { o.lx = g.lx - s + 2 * s * EASE.io(q); o.ly = 0.08 + lift; o.rx = g.rx + s - 2 * s * q; o.lf = -lift * 120; }
  else { o.lx = g.lx + s - 2 * s * q; o.rx = g.rx - s + 2 * s * EASE.io(q); o.ry = 0.08 + lift * 0.8; o.rf = g.rf + lift * 200; }
  o.hy = g.hy - Math.sin(q * Math.PI) * 0.015;
  o.hx = g.hx + Math.sin(p * Math.PI * 2) * 0.025;
  o.t = g.t + Math.sin(p * Math.PI * 4) * 1.5;
  return o;
}
// the run: each leg is planted for 55% of its cycle, the other leg half a cycle behind
const STANCE_F = 0.42, RUN_C = (STRIDE.run * STANCE_F) / 2;
function runLeg(u) {
  u -= Math.floor(u);
  if (u < STANCE_F) { const q = u / STANCE_F; return [RUN_C - 2 * RUN_C * q, 0.08, q > 0.7 ? (q - 0.7) * 120 : 0]; }
  const q = (u - STANCE_F) / (1 - STANCE_F), e = EASE.io(q);
  return [-RUN_C + 2 * RUN_C * e - Math.sin(q * Math.PI) * 0.1, 0.08 + Math.sin(q * Math.PI) ** 1.2 * 0.3 + (1 - q) * 0.06, 36 - q * 36];
}
function run(p) {
  const [lx, ly, lf] = runLeg(p), [rx, ry, rf] = runLeg(p + 0.5), c = u => Math.cos(u * Math.PI * 2);
  return P({
    hy: 0.88 - 0.02 * Math.cos(Math.PI * 2 * (2 * p - STANCE_F)), hx: 0.04, t: 11 + 2 * Math.cos(Math.PI * 4 * p), n: -3,
    lx, ly, lf, rx, ry, rf,
    la: 8 - 36 * c(p), le: 96 + 16 * Math.sin(Math.PI * 2 * p), ra: 8 + 36 * c(p), re: 96 - 16 * Math.sin(Math.PI * 2 * p),
  });
}

// ---------- the sampler ----------
const dur = (name, d) => MOVES?.[name]?.dur || d;
/**
 * The pose a fighter's move calls for right now. ctx: { t (scene seconds), hitH (the height
 * the last blow landed: 'high' | 'mid' | 'low') }. The renderer cross-fades from the last pose
 * it drew whenever the move changes, so moves join up.
 */
export function poseFor(f, kind, ctx) {
  const g = GUARDS[kind] ?? GUARD, base = f.stance === 'run' ? READY : g;
  const m = f.move, T = f.moveT ?? 0;
  if (ATTACKS[m]) {
    const M = MOVES?.[m] ?? {}, D = M.dur || 0.45, on = M.on ?? D * 0.4, off = M.off ?? on + D * 0.2;
    let [w, s, fo] = ATTACKS[m](g);
    // the lead arm's turn (fighter.arm 1): it strikes, and the rear fist goes back to the hip
    if (f.arm === 1 && m.startsWith('punch')) {
      const back = { ra: -12, re: 120 };
      w = with_(w, { la: 34, le: 124, ra: g.ra, re: g.re });
      s = with_(s, { la: s.ra - 4, le: s.re, ...back, lx: s.lx + 0.04 });
      fo = with_(fo, { la: fo.ra - 4, le: fo.re, ...back, lx: s.lx });
    }
    const kk = ATTACK_KIND[kind];
    if (kk) { w = with_(w, { t: w.t + (kk.t ?? 0), hy: w.hy + (kk.hy ?? 0) }); s = with_(s, { t: s.t + (kk.t ?? 0), hy: s.hy + (kk.hy ?? 0), op: kk.op ?? s.op }); fo = with_(fo, { op: kk.op ?? fo.op }); }
    const hold = on * 0.72;
    // a chained kick starts from the raised knee, not the guard
    if (T < hold) return f.chain && m.startsWith('kick') ? w : lerpPose(g, w, EASE.io(cl(T / hold)));
    if (T < on) return lerpPose(w, s, EASE.in(cl((T - hold) / (on - hold))));
    if (T < off) return lerpPose(s, fo, cl((T - on) / Math.max(0.01, off - on)) * 0.5);
    const q = cl((T - off) / Math.max(0.01, D - off));
    return q < 0.35 ? lerpPose(lerpPose(s, fo, 0.5), fo, EASE.out(q / 0.35)) : lerpPose(fo, g, EASE.io((q - 0.35) / 0.65));
  }
  // a duck in run stance (a dart coming while she runs): low, arms wrapped over the head
  if (m === 'duck' && f.stance === 'run') return with_(READY, { hy: 0.5, t: 40, n: 20, la: 150, le: 70, ra: 130, re: 80, lx: 0.22, rx: -0.26, rf: 30 });
  if (HELD[m]) return HELD[m](g);
  const breathe = s => { const b = Math.sin((ctx.t ?? 0) * 2.1 + (f.x ?? 0)); return with_(s, { hy: s.hy + b * 0.006, t: s.t + b * 0.8, la: s.la + b * 1.5, ra: s.ra - b * 1.5 }); };
  switch (m) {
    case 'walk': return walk(g, f.phase ?? 0);
    case 'run': return run(f.phase ?? 0);
    case 'stance': {
      const q = cl(T / dur('stance', 0.25));
      return q < 0.5 ? with_(base, { hy: base.hy - 0.04 * EASE.io(q * 2) }) : with_(base, { hy: base.hy - 0.04 * EASE.io((1 - q) * 2) });
    }
    case 'hit': {
      const r = (RECOIL[ctx.hitH] ?? RECOIL.high)(g), q = cl(T / dur('hit', 0.35));
      return keyed([[0, r], [0.55, with_(g, { hx: -0.05, t: g.t - 4 + (ctx.hitH === 'high' ? 0 : 10), n: 6 }), 'out'], [1, g, 'io']], q);
    }
    case 'ko': return keyed(KO(g), cl(T / dur('ko', 1.1)));
    case 'bow': return keyed(BOW(READY), cl(T / dur('bow', 1.2)));
    case 'cheer': return keyed(CHEER(READY), cl(T / dur('cheer', 1.5)));
    default: return breathe(base); // idle
  }
}
/** how long the cross-fade into a move takes: strikes and blows snap, the rest settle */
export function blendFor(m, f) {
  // a chained strike draws back from the last one's reach: a beat longer than a fresh snap
  if (ATTACKS[m]) return f?.chain ? (m.startsWith('kick') ? 0.14 : 0.1) : 0.05;
  if (m === 'hit' || m === 'ko') return 0.05;
  if (m === 'walk' || m === 'run') return 0.16;
  if (m === 'stance') return 0.12;
  return 0.1;
}
export { GUARD, READY };
