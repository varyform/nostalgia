// The figures: a 2D skeleton solved from a pose (poses.js) and drawn as tapered, shaded
// limbs with each kind's clothes. Everything here is in metres in the fighter's own frame
// (x forward, y up from the ground, a 1.0-size figure); the renderer sets the canvas
// transform (mirrored by `face`, scaled by size), so none of this knows about pixels.
//
//   const J = solve(pose);          // joints
//   drawFigure(g, J, kind, pal, { light, coat, flash })
//   anchors(J, kind)                // where the sash tail, hair tie or scarf hang from
import { clamp, mix } from './scenery.js';

const RAD = Math.PI / 180;
export const BONE = { torso: 0.52, neck: 0.07, head: 0.11, ua: 0.29, fa: 0.27, th: 0.45, sh: 0.44 };
export const SIZE = { hero: 0.96, footman: 1, brawler: 1.08, adept: 1, regent: 1.08, teacher: 0.94 };
const WIDTH = { hero: 0.95, footman: 1.05, brawler: 1.3, adept: 0.9, regent: 1.05, teacher: 1 };

// ---------- the skeleton ----------
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const dirDown = a => [Math.sin(a), -Math.cos(a)]; // an angle from straight down, + forward
function ik(hip, to, L1, L2) {
  const dx = to[0] - hip[0], dy = to[1] - hip[1], d0 = Math.hypot(dx, dy) || 1e-4;
  const d = clamp(d0, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3), a = Math.atan2(dy, dx);
  const al = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const knee = [hip[0] + L1 * Math.cos(a + al), hip[1] + L1 * Math.sin(a + al)]; // the knee bends forward
  return { knee, ankle: d === d0 ? to : [hip[0] + (dx / d0) * d, hip[1] + (dy / d0) * d] };
}
export function solve(p) {
  const t = p.t * RAD, up = [Math.sin(t), Math.cos(t)], fr = [Math.cos(t), -Math.sin(t)];
  const H = [p.hx, p.hy], S = add(H, up, BONE.torso);
  const ht = (p.t + p.n * 0.5) * RAD, C = add(S, [Math.sin(ht), Math.cos(ht)], BONE.neck + BONE.head);
  const hh = (p.t + p.n) * RAD;
  const arm = (a, e, sh) => {
    const A = (a - p.t) * RAD, E = add(sh, dirDown(A), BONE.ua), B = A + e * RAD;
    return { s: sh, e: E, w: add(E, dirDown(B), BONE.fa), a: A, b: B };
  };
  const leg = (x, y, f, hp) => {
    const { knee, ankle } = ik(hp, [x, y], BONE.th, BONE.sh), F = f * RAD;
    return { h: hp, k: knee, a: ankle, f: [Math.cos(F), -Math.sin(F)] };
  };
  return {
    H, S, C, up, fr, t, hf: [Math.cos(hh), -Math.sin(hh)], hu: [Math.sin(hh), Math.cos(hh)], op: p.op,
    la: arm(p.la, p.le, add(S, fr, -0.02)), ra: arm(p.ra, p.re, add(S, fr, 0.01)),
    ll: leg(p.lx, p.ly, p.lf, add(H, fr, 0.025)), rl: leg(p.rx, p.ry, p.rf, add(H, fr, -0.025)),
  };
}
// a point in the torso's frame (u forward, v up from the hips) or the head's (from its centre)
const tp = (J, u, v) => [J.H[0] + J.fr[0] * u + J.up[0] * v, J.H[1] + J.fr[1] * u + J.up[1] * v];
const hp = (J, u, v) => [J.C[0] + J.hf[0] * u + J.hu[0] * v, J.C[1] + J.hf[1] * u + J.hu[1] * v];
const lerp2 = (a, b, q) => [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q];

/** where the trailing cloth hangs from, in the figure's frame */
export function anchors(J, kind) {
  if (kind === 'hero') return { sash: tp(J, -0.11, 0.1), hair: hp(J, -0.1, 0.07) };
  if (kind === 'adept') return { sash: tp(J, -0.05, BONE.torso + 0.02) };
  if (kind === 'teacher') return { sash: tp(J, -0.13, 0.12) };
  return {};
}

// ---------- drawing primitives ----------
let g = null, LV = [0, 1], OP = 0;
function cap(a, b, r1, r2) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-5, nx = -dy / L, ny = dx / L, ux = dx / L, uy = dy / L;
  g.beginPath();
  g.moveTo(a[0] + nx * r1, a[1] + ny * r1);
  g.lineTo(b[0] + nx * r2, b[1] + ny * r2);
  g.quadraticCurveTo(b[0] + (nx + ux * 1.3) * r2, b[1] + (ny + uy * 1.3) * r2, b[0] + ux * r2, b[1] + uy * r2);
  g.quadraticCurveTo(b[0] + (-nx + ux * 1.3) * r2, b[1] + (-ny + uy * 1.3) * r2, b[0] - nx * r2, b[1] - ny * r2);
  g.lineTo(a[0] - nx * r1, a[1] - ny * r1);
  g.quadraticCurveTo(a[0] + (-nx - ux * 1.3) * r1, a[1] + (-ny - uy * 1.3) * r1, a[0] - ux * r1, a[1] - uy * r1);
  g.quadraticCurveTo(a[0] + (nx - ux * 1.3) * r1, a[1] + (ny - uy * 1.3) * r1, a[0] + nx * r1, a[1] + ny * r1);
  g.closePath();
}
// a limb: the base colour, then a lit band on the side the light comes from
function limb(a, b, r1, r2, c, far) {
  cap(a, b, r1, r2); g.fillStyle = far ? c.d : c.b; g.fill();
  if (far) return;
  const o = (r1 + r2) * 0.22;
  cap([a[0] + LV[0] * o, a[1] + LV[1] * o], [b[0] + LV[0] * o, b[1] + LV[1] * o], r1 * 0.5, r2 * 0.5);
  g.fillStyle = c.h; g.fill();
}
function poly(pts, fill) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); }
}
function dot(p, r, fill) { g.beginPath(); g.arc(p[0], p[1], r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); }
function foot(L, c, far, len = 0.19) {
  const a = L.a, f = L.f, n = [-f[1], f[0]];
  const pts = [add(a, n, 0.035), add(add(a, f, -0.06), n, -0.02), add(add(a, f, -0.055), n, -0.075), add(add(a, f, len), n, -0.075), add(add(a, f, len - 0.02), n, -0.035), add(add(a, f, 0.06), n, 0.0)];
  poly(pts, far ? c.d : c.b);
}
function hand(A, r, c, far, open = OP) {
  if (open > 0.5) {
    const d = dirDown(A.b), q = add(A.w, d, 0.06);
    cap(A.w, q, r * 0.85, r * 0.7); g.fillStyle = far ? c.d : c.b; g.fill();
  } else dot(add(A.w, dirDown(A.b), 0.02), r, far ? c.d : c.b);
}

// ---------- the figures ----------
// pal: { role: { b, h, d } } (base, lit, far side), from palette() in render.js
export function drawFigure(ctx, J, kind, pal, { light = [0.6, 0.8], coat = 0, t = 0 } = {}) {
  g = ctx; LV = light; OP = J.op ?? 0;
  const w = WIDTH[kind] ?? 1;
  const dress = DRESS[kind] ?? DRESS.footman;
  dress.back?.(J, pal, w, coat, t);
  dress.arm(J.la, pal, w, true);
  dress.leg(J.ll, pal, w, true);
  dress.leg(J.rl, pal, w, false);
  dress.body(J, pal, w, coat, t);
  dress.head(J, pal, w, t);
  dress.arm(J.ra, pal, w, false);
  dress.front?.(J, pal, w, coat, t);
}

// the torso as a rounded wedge round the spine: hips, the chest, the shoulders
function torso(J, c, w, { hipB = 0.1, hipF = 0.09, chest = 0.13, shB = 0.085, shF = 0.07, top = 0 } = {}) {
  const L = BONE.torso + top;
  g.beginPath();
  const p0 = tp(J, -hipB * w, -0.02), p1 = tp(J, hipF * w, -0.02), p2 = tp(J, chest * w, L * 0.68), p3 = tp(J, shF * w, L), p4 = tp(J, -shB * w, L), p5 = tp(J, -(hipB + 0.02) * w, L * 0.45);
  g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]);
  const q1 = tp(J, (chest + 0.01) * w, L * 0.3); g.quadraticCurveTo(q1[0], q1[1], p2[0], p2[1]);
  const q2 = tp(J, (chest - 0.005) * w, L * 0.95); g.quadraticCurveTo(q2[0], q2[1], p3[0], p3[1]);
  g.lineTo(p4[0], p4[1]);
  g.quadraticCurveTo(p5[0], p5[1], p0[0], p0[1]);
  g.closePath(); g.fillStyle = c.b; g.fill();
  // the lit side of the chest or back
  const side = LV[0] >= 0 ? 1 : -1;
  g.beginPath();
  const a = tp(J, side * hipF * w * 0.7, 0.05), b = tp(J, side * chest * w * 0.85, L * 0.66), d = tp(J, side * shF * w * 0.8, L * 0.95), e = tp(J, side * 0.02, L * 0.9), f = tp(J, side * 0.02, 0.06);
  g.moveTo(a[0], a[1]); g.quadraticCurveTo(b[0], b[1], d[0], d[1]); g.lineTo(e[0], e[1]); g.lineTo(f[0], f[1]); g.closePath();
  g.fillStyle = c.h; g.fill();
}
// a skirt from the waist down both thighs (frac of the thigh; past 1 it runs on down the shins)
function skirtPts(J, frac, flare, lag = 0) {
  const at = L => (frac <= 1 ? lerp2(L.h, L.k, frac) : lerp2(L.k, L.a, Math.min(1, frac - 1)));
  const a = at(J.ll), b = at(J.rl), front = a[0] > b[0] ? a : b, back = a[0] > b[0] ? b : a;
  const low = Math.min(a[1], b[1]);
  return [tp(J, -0.11, 0.1), tp(J, 0.1, 0.1), [front[0] + flare, low + (front[1] - low) * 0.5 - 0.01], [(front[0] + back[0]) / 2 - lag * 0.5, low - 0.03], [back[0] - flare - lag, low + (back[1] - low) * 0.5 - 0.01]];
}
function skirt(J, frac, flare, c, lag = 0) {
  const P = skirtPts(J, frac, flare, lag);
  g.beginPath(); g.moveTo(P[0][0], P[0][1]); g.lineTo(P[1][0], P[1][1]);
  g.lineTo(P[2][0], P[2][1]); g.quadraticCurveTo(P[3][0] + (P[2][0] - P[4][0]) * 0.15, P[3][1] - 0.01, P[3][0], P[3][1]);
  g.quadraticCurveTo(P[3][0] - (P[2][0] - P[4][0]) * 0.15, P[3][1] - 0.01, P[4][0], P[4][1]);
  g.closePath(); g.fillStyle = c.b; g.fill();
  return P;
}
function neck(J, c, r = 0.045) { cap(J.S, J.C, r, r * 0.9); g.fillStyle = c.b; g.fill(); }
// a face in profile: the skull, a jaw, the nose, an eye and a brow
function face(J, skin, eye = '#140c0a', { brow = '#1a100c' } = {}) {
  const R = BONE.head;
  dot(J.C, R, skin.b);
  poly([hp(J, 0.03, -0.04), hp(J, 0.105, -0.025), hp(J, 0.118, 0.01), hp(J, 0.1, 0.02), hp(J, 0.1, -0.07), hp(J, 0.06, -0.115), hp(J, -0.02, -0.1)], skin.b);
  poly([hp(J, 0.02, 0.0), hp(J, 0.09, 0.04), hp(J, 0.1, -0.03), hp(J, 0.04, -0.08)], skin.h);
  dot(hp(J, 0.065, 0.02), 0.012, eye);
  g.lineWidth = 0.012; g.strokeStyle = brow; g.beginPath(); const b0 = hp(J, 0.04, 0.045), b1 = hp(J, 0.095, 0.04); g.moveTo(b0[0], b0[1]); g.lineTo(b1[0], b1[1]); g.stroke();
}
function mask(J, c, eye, { snarl = false, half = false } = {}) {
  const pts = half
    ? [hp(J, 0.02, 0.005), hp(J, 0.12, 0.0), hp(J, 0.118, -0.05), hp(J, 0.08, -0.115), hp(J, 0.0, -0.1)]
    : [hp(J, 0.0, 0.08), hp(J, 0.1, 0.07), hp(J, 0.125, 0.01), hp(J, 0.115, -0.06), hp(J, 0.07, -0.12), hp(J, -0.01, -0.1)];
  poly(pts, c.b);
  poly([hp(J, 0.05, 0.06), hp(J, 0.115, 0.03), hp(J, 0.11, -0.04), hp(J, 0.06, 0.0)], c.h);
  if (!half) { // the eye slit and a mouth line
    g.lineWidth = 0.016; g.strokeStyle = eye; g.beginPath(); const e0 = hp(J, 0.05, 0.022), e1 = hp(J, 0.115, 0.018); g.moveTo(e0[0], e0[1]); g.lineTo(e1[0], e1[1]); g.stroke();
    g.lineWidth = 0.008; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); const m0 = hp(J, 0.07, snarl ? -0.06 : -0.07), m1 = hp(J, 0.115, -0.05); g.moveTo(m0[0], m0[1]); g.lineTo(m1[0], m1[1]); if (snarl) { const m2 = hp(J, 0.09, -0.085); g.lineTo(m2[0], m2[1]); } g.stroke();
  }
}
// lacquer bands across a plate: thin darker lines in the torso's frame
function bands(J, c, v0, v1, n, w) {
  g.strokeStyle = c; g.lineWidth = 0.012;
  g.beginPath();
  for (let i = 1; i <= n; i++) { const v = v0 + ((v1 - v0) * i) / (n + 1), a = tp(J, -0.1 * w, v), b = tp(J, 0.12 * w, v + 0.015); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); }
  g.stroke();
}
// a plate hanging along a bone: from a fraction f0 to f1 of a→b, half-width r
function plate(a, b, f0, f1, r, c, far) {
  const p = lerp2(a, b, f0), q = lerp2(a, b, f1), dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1e-5, nx = -dy / L * r, ny = dx / L * r;
  poly([[p[0] + nx, p[1] + ny], [q[0] + nx * 0.9, q[1] + ny * 0.9], [q[0] - nx * 0.9, q[1] - ny * 0.9], [p[0] - nx, p[1] - ny]], far ? c.d : c.b);
  if (!far) { poly([[p[0] + nx * 0.8, p[1] + ny * 0.8], [q[0] + nx * 0.75, q[1] + ny * 0.75], [q[0] + nx * 0.2, q[1] + ny * 0.2], [p[0] + nx * 0.2, p[1] + ny * 0.2]], c.h); }
}

// ---------- what each kind wears ----------
const DRESS = {
  // Wren: a short belted tunic over dark trousers, wrapped shins, a long sash, a hair tie
  hero: {
    arm(A, P, w, far) {
      limb(A.s, A.e, 0.056 * w, 0.046 * w, P.tunic, far);
      limb(A.e, A.w, 0.044 * w, 0.034 * w, P.skin, far);
      plate(A.e, A.w, 0.55, 0.95, 0.04 * w, P.wrap, far);
      hand(A, 0.043, P.skin, far);
    },
    leg(L, P, w, far) {
      limb(L.h, L.k, 0.085 * w, 0.06 * w, P.trousers, far);
      limb(L.k, L.a, 0.058 * w, 0.042 * w, P.trousers, far);
      plate(L.k, L.a, 0.3, 0.95, 0.05 * w, P.wrap, far);
      foot(L, P.foot, far);
    },
    body(J, P, w) {
      skirt(J, 0.48, 0.035, P.tunic);
      torso(J, P.tunic, w);
      // the collar's crossed edge and the sash round the waist
      g.strokeStyle = P.trim.b; g.lineWidth = 0.018; g.beginPath(); const c0 = tp(J, 0.06, BONE.torso - 0.01), c1 = tp(J, 0.12, BONE.torso * 0.55), c2 = tp(J, 0.02, BONE.torso * 0.4); g.moveTo(c0[0], c0[1]); g.lineTo(c1[0], c1[1]); g.lineTo(c2[0], c2[1]); g.stroke();
      poly([tp(J, -0.115 * w, 0.06), tp(J, 0.105 * w, 0.06), tp(J, 0.115 * w, 0.15), tp(J, -0.125 * w, 0.15)], P.sash.b);
      poly([tp(J, -0.1 * w, 0.12), tp(J, 0.1 * w, 0.12), tp(J, 0.112 * w, 0.15), tp(J, -0.11 * w, 0.15)], P.sash.h);
      dot(tp(J, -0.12, 0.1), 0.035, P.sash.b);
      neck(J, P.skin, 0.042);
    },
    head(J, P) {
      face(J, P.skin);
      // the hair: over the crown and down the back, and the knot it's tied in
      poly([hp(J, 0.07, 0.08), hp(J, 0.02, 0.115), hp(J, -0.06, 0.1), hp(J, -0.115, 0.03), hp(J, -0.1, -0.05), hp(J, -0.05, -0.06), hp(J, -0.02, 0.02), hp(J, 0.04, 0.05), hp(J, 0.1, 0.045)], P.hair.b);
      poly([hp(J, 0.04, 0.095), hp(J, -0.04, 0.105), hp(J, -0.02, 0.08)], P.hair.h);
      dot(hp(J, -0.1, 0.075), 0.042, P.hair.b);
      dot(hp(J, -0.1, 0.07), 0.018, P.sash.b);
    },
  },
  // the Keep's footmen: ash-grey lacquered plates, an ivory mask, a bowl helmet
  footman: {
    arm(A, P, w, far) {
      limb(A.s, A.e, 0.055 * w, 0.045 * w, P.under, far);
      limb(A.e, A.w, 0.045 * w, 0.036 * w, P.under, far);
      plate(A.e, A.w, 0.15, 0.85, 0.05 * w, P.plate, far);
      plate(A.s, A.e, -0.15, 0.5, 0.075 * w, P.plate, far); // the shoulder guard
      hand(A, 0.045, P.glove, far);
    },
    leg(L, P, w, far) {
      limb(L.h, L.k, 0.085 * w, 0.062 * w, P.under, far);
      limb(L.k, L.a, 0.06 * w, 0.044 * w, P.under, far);
      plate(L.k, L.a, 0.05, 0.85, 0.06 * w, P.plate, far);
      foot(L, P.foot, far);
    },
    body(J, P, w) {
      torso(J, P.under, w);
      // the tassets: plates hanging over each thigh
      for (const L of [J.ll, J.rl]) plate(L.h, L.k, -0.1, 0.55, 0.1 * w, P.plate, false);
      torso(J, P.plate, w, { hipB: 0.105, hipF: 0.1, chest: 0.14, top: -0.04 });
      bands(J, P.plate2.b, 0.08, BONE.torso * 0.8, 3, w);
      dot(tp(J, 0.12 * w, BONE.torso * 0.6), 0.02, P.cord.b);
      neck(J, P.under);
    },
    head(J, P) {
      dot(J.C, BONE.head, P.under.b);
      mask(J, P.mask, P.plate2.b);
      // the helmet: a bowl, its brim and the neck guard behind
      poly([hp(J, 0.13, 0.04), hp(J, 0.09, 0.115), hp(J, 0.0, 0.14), hp(J, -0.1, 0.11), hp(J, -0.13, 0.05)], P.plate.b);
      poly([hp(J, 0.03, 0.12), hp(J, -0.06, 0.12), hp(J, -0.02, 0.135)], P.plate.h);
      poly([hp(J, -0.06, 0.06), hp(J, -0.2, -0.02), hp(J, -0.18, -0.09), hp(J, -0.08, -0.04)], P.plate.d);
      g.lineWidth = 0.014; g.strokeStyle = P.plate2.b; g.beginPath(); const a = hp(J, 0.14, 0.045), b = hp(J, -0.13, 0.05); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    },
  },
  // brawlers: bigger, bare-armed with wrapped fists, heavy shoulders, an iron mask
  brawler: {
    arm(A, P, w, far) {
      limb(A.s, A.e, 0.06 * w, 0.05 * w, P.skin, far);
      limb(A.e, A.w, 0.05 * w, 0.04 * w, P.skin, far);
      plate(A.e, A.w, 0.3, 1.0, 0.047 * w, P.wrap, far);
      plate(A.s, A.e, -0.25, 0.45, 0.085 * w, P.plate, far);
      hand(A, 0.052, P.wrap, far, 0);
    },
    leg(L, P, w, far) {
      limb(L.h, L.k, 0.085 * w, 0.064 * w, P.under, far);
      limb(L.k, L.a, 0.062 * w, 0.046 * w, P.under, far);
      plate(L.k, L.a, 0.0, 0.7, 0.062 * w, P.plate, far);
      foot(L, P.foot, far, 0.2);
    },
    body(J, P, w) {
      skirt(J, 0.62, 0.04, P.under);
      torso(J, P.skin, w, { chest: 0.15 });
      torso(J, P.plate, w, { hipB: 0.11, hipF: 0.1, chest: 0.155, top: -0.12 });
      bands(J, P.plate2.b, 0.05, BONE.torso * 0.6, 2, w);
      poly([tp(J, -0.12 * w, 0.03), tp(J, 0.11 * w, 0.03), tp(J, 0.115 * w, 0.11), tp(J, -0.13 * w, 0.11)], P.cord.b);
      neck(J, P.skin, 0.055);
    },
    head(J, P) {
      dot(J.C, BONE.head * 1.02, P.skin.b);
      mask(J, P.mask, '#000', { snarl: true });
      dot(hp(J, 0.09, 0.02), 0.012, P.eye.b);
      // a shaved head with a topknot
      poly([hp(J, 0.06, 0.1), hp(J, -0.02, 0.12), hp(J, -0.1, 0.08), hp(J, -0.11, 0.0), hp(J, -0.05, 0.05)], P.hair.b);
      dot(hp(J, -0.06, 0.135), 0.035, P.hair.b);
    },
  },
  // adepts: slim, a hood and a half mask, an indigo scarf that trails
  adept: {
    arm(A, P, w, far) {
      limb(A.s, A.e, 0.052 * w, 0.044 * w, P.under, far);
      limb(A.e, A.w, 0.042 * w, 0.034 * w, P.under, far);
      plate(A.e, A.w, 0.2, 0.8, 0.042 * w, P.plate, far);
      hand(A, 0.04, P.glove, far);
    },
    leg(L, P, w, far) {
      limb(L.h, L.k, 0.08 * w, 0.058 * w, P.under, far);
      limb(L.k, L.a, 0.056 * w, 0.04 * w, P.under, far);
      plate(L.k, L.a, 0.1, 0.6, 0.05 * w, P.plate, far);
      foot(L, P.foot, far);
    },
    body(J, P, w) {
      skirt(J, 0.75, 0.05, P.under);
      torso(J, P.under, w);
      torso(J, P.plate, w, { hipB: 0.08, hipF: 0.09, chest: 0.13, top: -0.18 });
      bands(J, P.plate2.b, 0.2, BONE.torso * 0.7, 2, w);
      poly([tp(J, -0.1 * w, 0.06), tp(J, 0.1 * w, 0.06), tp(J, 0.105 * w, 0.12), tp(J, -0.11 * w, 0.12)], P.cord.b);
      neck(J, P.hood);
    },
    head(J, P) {
      dot(J.C, BONE.head, P.skin.b);
      face(J, P.skin);
      mask(J, P.mask, '#000', { half: true });
      // the hood over the head and shoulders
      poly([hp(J, 0.1, 0.06), hp(J, 0.06, 0.125), hp(J, -0.04, 0.14), hp(J, -0.13, 0.07), hp(J, -0.15, -0.06), hp(J, -0.12, -0.16), hp(J, -0.02, -0.14), hp(J, -0.03, -0.04), hp(J, 0.03, 0.04)], P.hood.b);
      poly([hp(J, 0.03, 0.11), hp(J, -0.06, 0.12), hp(J, -0.03, 0.095)], P.hood.h);
    },
  },
  // the Ash Regent: a long ember-red coat that swings, a black mask, a crown of embers
  regent: {
    back(J, P, w, coat) {
      // the coat's back panel, behind the legs
      const S = skirtPts(J, 1.75, 0.08, coat);
      poly([tp(J, -0.12 * w, BONE.torso * 0.6), tp(J, -0.12 * w, 0.1), S[4], S[3], [S[3][0] + 0.1, S[3][1] + 0.02]], P.coat2.b);
    },
    arm(A, P, w, far) {
      limb(A.s, A.e, 0.06 * w, 0.05 * w, P.coat, far);
      limb(A.e, A.w, 0.05 * w, 0.045 * w, P.coat, far);
      plate(A.e, A.w, 0.72, 0.92, 0.058 * w, P.trim, far); // the cuff
      hand(A, 0.044, P.skin, far);
    },
    leg(L, P, w, far) {
      limb(L.h, L.k, 0.08 * w, 0.06 * w, P.under, far);
      limb(L.k, L.a, 0.058 * w, 0.044 * w, P.under, far);
      foot(L, P.foot, far, 0.21);
    },
    body(J, P, w, coat) {
      const S = skirtPts(J, 1.7, 0.07, coat);
      // the coat's skirts: two panels open at the front, a gold edge
      g.beginPath(); g.moveTo(S[0][0], S[0][1]); g.lineTo(S[1][0], S[1][1]); g.lineTo(S[2][0], S[2][1]);
      g.quadraticCurveTo(S[3][0] + 0.05, S[3][1] - 0.04, S[3][0], S[3][1]); g.quadraticCurveTo(S[3][0] - 0.1, S[3][1], S[4][0], S[4][1]); g.closePath();
      g.fillStyle = P.coat.b; g.fill();
      g.strokeStyle = P.trim.b; g.lineWidth = 0.02; g.beginPath(); g.moveTo(S[1][0], S[1][1]); g.lineTo(S[2][0], S[2][1]); g.quadraticCurveTo(S[3][0] + 0.05, S[3][1] - 0.04, S[3][0], S[3][1]); g.stroke();
      torso(J, P.coat, w, { chest: 0.14 });
      poly([tp(J, 0.02, 0.12), tp(J, 0.12 * w, 0.14), tp(J, 0.13 * w, BONE.torso * 0.75), tp(J, 0.05, BONE.torso)], P.under.b);
      g.strokeStyle = P.trim.b; g.lineWidth = 0.018; g.beginPath(); const a = tp(J, 0.05, BONE.torso), b = tp(J, 0.13 * w, BONE.torso * 0.72), c = tp(J, 0.02, 0.12); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.stroke();
      poly([tp(J, -0.12 * w, 0.08), tp(J, 0.11 * w, 0.08), tp(J, 0.12 * w, 0.15), tp(J, -0.13 * w, 0.15)], P.under.b);
      // the tall collar
      poly([tp(J, -0.1, BONE.torso - 0.05), tp(J, 0.04, BONE.torso - 0.02), tp(J, 0.02, BONE.torso + 0.12), tp(J, -0.12, BONE.torso + 0.1)], P.coat2.b);
      neck(J, P.skin, 0.042);
    },
    head(J, P, w, t) {
      dot(J.C, BONE.head, P.skin.b);
      face(J, P.skin);
      mask(J, P.mask, P.ember.b);
      // long hair behind and a crown of ember-tipped spikes
      poly([hp(J, -0.02, 0.1), hp(J, -0.12, 0.05), hp(J, -0.16, -0.14), hp(J, -0.06, -0.08)], P.hair.b);
      poly([hp(J, 0.11, 0.05), hp(J, 0.1, 0.13), hp(J, -0.11, 0.13), hp(J, -0.12, 0.05)], P.crown.b);
      for (const [u, hgt] of [[0.08, 0.09], [0.0, 0.14], [-0.08, 0.09]]) {
        poly([hp(J, u - 0.03, 0.125), hp(J, u, 0.125 + hgt), hp(J, u + 0.03, 0.125)], P.crown.b);
        dot(hp(J, u, 0.125 + hgt), 0.016 + Math.sin(t * 9 + u * 40) * 0.004, P.ember.b);
      }
      g.strokeStyle = P.trim.b; g.lineWidth = 0.012; g.beginPath(); const a = hp(J, 0.11, 0.06), b = hp(J, -0.12, 0.06); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    },
  },
  // Master Oriel: undyed robes to the ankles, wide sleeves, white hair and beard
  teacher: {
    arm(A, P, w, far) {
      limb(A.s, A.e, 0.06 * w, 0.055 * w, P.robe, far);
      limb(A.e, A.w, 0.055 * w, 0.06 * w, P.robe, far);
      // the wide sleeve hangs from the forearm
      const m = lerp2(A.e, A.w, 0.85);
      poly([A.e, m, [m[0] - 0.02, m[1] - 0.16], [A.e[0] - 0.04, A.e[1] - 0.1]], far ? P.robe.d : P.robe2.b);
      hand(A, 0.04, P.skin, far, 1);
    },
    leg(L, P, w, far) {
      limb(L.h, L.k, 0.08 * w, 0.06 * w, P.robe2, far);
      limb(L.k, L.a, 0.058 * w, 0.044 * w, P.robe2, far);
      foot(L, P.foot, far);
    },
    body(J, P, w) {
      skirt(J, 1.88, 0.09, P.robe);
      torso(J, P.robe, w, { chest: 0.13 });
      g.strokeStyle = P.robe2.b; g.lineWidth = 0.02; g.beginPath(); const c0 = tp(J, 0.05, BONE.torso), c1 = tp(J, 0.12, BONE.torso * 0.5), c2 = tp(J, 0.06, 0.1); g.moveTo(c0[0], c0[1]); g.lineTo(c1[0], c1[1]); g.lineTo(c2[0], c2[1]); g.stroke();
      poly([tp(J, -0.12 * w, 0.08), tp(J, 0.11 * w, 0.08), tp(J, 0.12 * w, 0.16), tp(J, -0.13 * w, 0.16)], P.sash.b);
      neck(J, P.skin, 0.04);
    },
    head(J, P) {
      face(J, P.skin);
      poly([hp(J, 0.09, -0.05), hp(J, 0.06, -0.2), hp(J, 0.02, -0.17), hp(J, -0.02, -0.08)], P.hair.b); // beard
      poly([hp(J, 0.07, 0.07), hp(J, 0.0, 0.115), hp(J, -0.08, 0.09), hp(J, -0.115, 0.0), hp(J, -0.07, -0.05), hp(J, -0.03, 0.04)], P.hair.b);
      dot(hp(J, -0.03, 0.13), 0.04, P.hair.b);
      g.strokeStyle = P.hair.b; g.lineWidth = 0.014; g.beginPath(); const b0 = hp(J, 0.04, 0.05), b1 = hp(J, 0.1, 0.035); g.moveTo(b0[0], b0[1]); g.lineTo(b1[0], b1[1]); g.stroke();
    },
  },
};

// each kind's colours (before the scene's light tints them)
export const COLOURS = {
  hero: { skin: '#d8a27c', hair: '#221612', tunic: '#3a6a8c', trim: '#d8c49a', trousers: '#272c37', wrap: '#d9cdb0', sash: '#ee6a28', foot: '#3d2a1e' },
  footman: { plate: '#8c9096', plate2: '#4a4e55', under: '#26282d', mask: '#ddd6c8', cord: '#9a2c22', glove: '#3a3c42', foot: '#1c1d20' },
  brawler: { plate: '#62666c', plate2: '#2e3136', under: '#2c2622', skin: '#b07a58', wrap: '#3c3632', mask: '#2c2e33', eye: '#ff9a3a', hair: '#141210', cord: '#7a2a20', foot: '#1a1714' },
  adept: { plate: '#a9acb0', plate2: '#5c6066', under: '#262b48', hood: '#2f3558', mask: '#ebe5da', cord: '#b8302a', glove: '#d8c0a8', skin: '#cfa080', foot: '#191a24' },
  regent: { coat: '#a8281c', coat2: '#4e100b', trim: '#d6a043', under: '#191313', mask: '#141214', crown: '#1d1a1a', ember: '#ffa040', skin: '#d8c2b0', hair: '#2a2626', foot: '#120f0f' },
  teacher: { robe: '#d6cdb6', robe2: '#8a7d66', sash: '#4a3b2e', skin: '#c4936c', hair: '#eeeae2', foot: '#3a3028' },
};
// the trailing cloth's colour per kind
export const TRAIL = { hero: ['sash', 'sash'], adept: ['hood'], teacher: ['sash'] };

/** the colours lit for a scene: base, lit and far side, tinted toward its ambient light */
export function palette(kind, th, flash = 0) {
  const out = {}, C = COLOURS[kind] ?? COLOURS.footman;
  for (const [k, c] of Object.entries(C)) {
    let b = mix(c, th.amb, th.ambK);
    if (flash) b = mix(b, '#fff4e0', flash);
    out[k] = { b, h: mix(b, th.key, 0.38), d: mix(b, th.shade, 0.3) };
  }
  return out;
}
/** a trailing ribbon through world points (metres), tapering from r0 to r1 */
export function ribbon(ctx, pts, r0, r1, fill) {
  const n = pts.length, L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1e-5;
    const r = r0 + (r1 - r0) * (i / (n - 1)), nx = (-dy / d) * r, ny = (dx / d) * r;
    L.push([pts[i][0] + nx, pts[i][1] + ny]); R.push([pts[i][0] - nx, pts[i][1] - ny]);
  }
  ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
