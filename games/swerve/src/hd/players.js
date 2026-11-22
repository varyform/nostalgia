// The players and the ball. A player is a little jointed figure posed in metres (a across his
// body to the right, f forward, z up), turned to one of 16 facings and projected the way the
// pitch is (a height rises up the screen by ZK). Each pose × frame × facing × kit × skin tone is
// drawn once, with a dark rim to read on the grass, into a small sprite; the head (skin, hair
// colour and style from a hash of the player) and the shadow are drawn per frame from numbers
// stored with the sprite. Kits: plain, stripes, hoops, halves or sash, with the trim colour;
// keepers in their own kit, long sleeves and gloves.
//
//   const figs = createPlayers();
//   figs.reset(P);                                   // on resize: P is pixels per metre
//   const f = figs.frame(p, kit, gk, look, phase, mem) // → { e (sprite), lift, d, pose, side }
//   figs.shadow(g, v, p, f); figs.draw(g, v, p, f, look); figs.ball(g, v, ball, mem)
import { SUN, TAU, ZK, canvas, clamp, lerp, shade, strHash } from './fx.js';

/** the figure's size against the pitch: players stand bigger than life, as they always did */
export const FIG = 1.45;
const DIRS = 16;
const SYMMETRIC = new Set(['plain', 'stripes', 'hoops', undefined]);
const SKIN = ['#f3d0b0', '#e2b18c', '#c98e64', '#a46d48', '#7a4e33', '#563525'];
// arms and legs come in three tones (a sprite each), the face in all six
const BODY = ['#ebc39f', '#b67d55', '#694330'];
const HAIR = ['#17110d', '#2e1f15', '#4f3320', '#7a5230', '#b58a4c', '#d9bb78', '#a8461f', '#cfcac2'];
const STYLES = ['crop', 'short', 'short', 'long', 'bald', 'curly', 'tied', 'crop'];
const BOOTS = ['#141414', '#141414', '#f2f2f2', '#1b3a8c', '#c81e1e', '#141414'];
const GLOVE = '#f2efe2';

/** how a player looks, from his id or name: skin tone, hair colour and style, boots */
export function lookOf(key) {
  const h = strHash(key), h2 = strHash(key + '#');
  const skin = h % SKIN.length, style = STYLES[(h >>> 8) % STYLES.length];
  let hair = (h >>> 16) % HAIR.length;
  if (skin >= 3 && hair > 4) hair = (h >>> 20) % 3; // darker skin, darker hair mostly
  return { skin, hair: HAIR[hair], style, boot: BOOTS[h2 % BOOTS.length], cel: h2 % 3 };
}

// ---------- poses ----------
// joints: [a, f, z] metres; pel pelvis, chest the middle of the shoulders, sh/el/ha the arms,
// hip/knee/foot the legs, head its centre
const J0 = {
  pel: [0, 0, 0.95], hipL: [-0.1, 0, 0.92], hipR: [0.1, 0, 0.92], kneeL: [-0.11, 0.03, 0.5], kneeR: [0.11, 0.03, 0.5], footL: [-0.12, 0, 0.06], footR: [0.12, 0, 0.06],
  chest: [0, 0.01, 1.42], shL: [-0.2, 0.01, 1.42], shR: [0.2, 0.01, 1.42], elL: [-0.26, 0, 1.15], elR: [0.26, 0, 1.15], haL: [-0.27, 0.04, 0.9], haR: [0.27, 0.04, 0.9], head: [0, 0.02, 1.66],
};
const NAMES = Object.keys(J0);
const copy = J => Object.fromEntries(NAMES.map(n => [n, [...J[n]]]));
const blend = (A, B, t) => Object.fromEntries(NAMES.map(n => [n, A[n].map((v, i) => lerp(v, B[n][i], t))]));
function move(J, names, da = 0, df = 0, dz = 0) { for (const n of names) { J[n][0] += da; J[n][1] += df; J[n][2] += dz; } return J; }
const UPPER = ['chest', 'shL', 'shR', 'elL', 'elR', 'haL', 'haR', 'head'];
/** roll the whole figure about the forward axis (a dive), around height zc */
function roll(J, ang, zc) {
  const c = Math.cos(ang), s = Math.sin(ang);
  for (const n of NAMES) { const [a, f, z] = J[n], dz = z - zc; J[n] = [a * c - dz * s, f, a * s + dz * c + zc]; }
  return J;
}
/** tip the whole figure forward about the feet (falling flat) */
function tip(J, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  for (const n of NAMES) { const [a, f, z] = J[n]; J[n] = [a, f * c + z * s, z * c - f * s]; }
  return J;
}

function run(ph, J = copy(J0)) {
  const th = ph * TAU, s = Math.sin(th), c = Math.cos(th), bob = 0.035 * Math.cos(2 * th);
  const legs = [['L', -0.11, s, c], ['R', 0.11, -s, -c]];
  for (const [k, a, sf, cf] of legs) {
    const lift = Math.max(0, cf), foot = [a, 0.38 * sf, 0.06 + 0.22 * lift];
    J['foot' + k] = foot;
    J['knee' + k] = [a, foot[1] * 0.5 + 0.1 + 0.1 * lift, (0.92 + foot[2]) / 2 + 0.05];
  }
  move(J, UPPER, 0, 0.1, 0); J.head[1] += 0.03;
  for (const [k, a, sf] of [['L', -1, -s], ['R', 1, s]]) {
    const hf = 0.3 * sf;
    J['el' + k] = [a * 0.25, 0.08 + hf * 0.4 - 0.06, 1.17];
    J['ha' + k] = [a * 0.23, 0.1 + hf, 1.02 + 0.1 * Math.abs(sf)];
  }
  move(J, NAMES.filter(n => !n.startsWith('foot') && !n.startsWith('knee')), 0, 0, bob);
  return J;
}
function ready() {
  const J = copy(J0);
  move(J, ['pel', 'hipL', 'hipR', ...UPPER], 0, 0.04, -0.12);
  J.kneeL = [-0.16, 0.16, 0.45]; J.kneeR = [0.16, 0.16, 0.45]; J.footL = [-0.18, 0, 0.06]; J.footR = [0.18, 0, 0.06];
  J.elL = [-0.34, 0.12, 1.05]; J.elR = [0.34, 0.12, 1.05]; J.haL = [-0.4, 0.22, 0.92]; J.haR = [0.4, 0.22, 0.92];
  return J;
}
function kick(k) {
  const J = copy(J0);
  J.footL = [-0.14, 0.12, 0.06]; J.kneeL = [-0.13, 0.2, 0.5];
  J.elL = [-0.38, 0.05, 1.25]; J.haL = [-0.52, 0.12, 1.12]; J.elR = [0.36, -0.05, 1.22]; J.haR = [0.5, -0.12, 1.1];
  if (k === 0) { J.footR = [0.12, -0.45, 0.45]; J.kneeR = [0.12, -0.05, 0.55]; move(J, UPPER, 0, -0.05, 0); }
  else if (k === 1) { J.footR = [0.08, 0.34, 0.14]; J.kneeR = [0.1, 0.24, 0.52]; move(J, UPPER, 0, 0.08, 0); }
  else { J.footR = [0.05, 0.6, 0.58]; J.kneeR = [0.08, 0.38, 0.76]; move(J, UPPER, 0, -0.02, 0); }
  return J;
}
function slide(k) {
  const F = {
    pel: [0, -0.05, 0.24], hipL: [-0.1, -0.05, 0.24], hipR: [0.1, -0.05, 0.24],
    kneeR: [0.1, 0.36, 0.24], footR: [0.1, 0.8, 0.12], kneeL: [-0.14, 0.26, 0.42], footL: [-0.15, -0.08, 0.07],
    chest: [0, -0.42, 0.56], shL: [-0.2, -0.42, 0.56], shR: [0.2, -0.42, 0.56],
    elL: [-0.32, -0.5, 0.34], haL: [-0.36, -0.55, 0.07], elR: [0.36, -0.3, 0.76], haR: [0.46, -0.1, 0.9], head: [0, -0.56, 0.78],
  };
  return k === 0 ? blend(J0, F, 0.55) : F;
}
function header(k) {
  const J = copy(J0);
  J.footL = [-0.12, -0.16, 0.22]; J.footR = [0.12, -0.04, 0.3]; J.kneeL = [-0.12, 0.12, 0.56]; J.kneeR = [0.12, 0.16, 0.58];
  J.elL = [-0.32, -0.08, 1.32]; J.elR = [0.32, -0.08, 1.32]; J.haL = [-0.44, -0.18, 1.22]; J.haR = [0.44, -0.18, 1.22];
  move(J, ['chest', 'shL', 'shR'], 0, k ? 0.12 : -0.08, 0);
  J.head = [0, k ? 0.26 : -0.12, k ? 1.6 : 1.66];
  return J;
}
function dive(k, side) {
  const J = copy(J0);
  // arms stretched over the head, legs long
  J.elL = [-0.16, 0.06, 1.8]; J.elR = [0.16, 0.06, 1.8]; J.haL = [-0.14, 0.12, 2.08]; J.haR = [0.14, 0.12, 2.08];
  J.kneeL = [-0.12, 0.02, 0.5]; J.kneeR = [0.13, 0.04, 0.5]; J.footL = [-0.14, -0.04, 0.04]; J.footR = [0.16, 0.02, 0.06];
  const ang = -side * (k === 0 ? 0.7 : k === 1 ? 1.38 : 1.5);
  roll(J, ang, 0.95);
  const drop = k === 0 ? -0.1 : k === 1 ? -0.35 : -0.72;
  return move(J, NAMES, -side * (k === 0 ? 0.15 : 0.45), 0, drop);
}
function catcher() {
  const J = ready();
  J.elL = [-0.2, 0.2, 1.2]; J.elR = [0.2, 0.2, 1.2]; J.haL = [-0.1, 0.32, 1.18]; J.haR = [0.1, 0.32, 1.18];
  return J;
}
function down(k) {
  const J = copy(J0);
  J.elL = [-0.28, 0.1, 1.75]; J.elR = [0.28, 0.1, 1.75]; J.haL = [-0.34, 0.16, 2.0]; J.haR = [0.34, 0.16, 2.0];
  tip(J, k === 0 ? 0.7 : 1.45);
  return move(J, NAMES, 0, k === 0 ? -0.3 : -0.85, k === 0 ? 0 : 0.12);
}
function celebrate(style, k) {
  if (style === 1) { // the aeroplane, running
    const J = run(k / 8);
    J.elL = [-0.5, -0.05, 1.4]; J.elR = [0.5, -0.05, 1.4]; J.haL = [-0.8, -0.1, 1.38]; J.haR = [0.8, -0.1, 1.38];
    return roll(J, (k % 2 ? 1 : -1) * 0.12, 0.95);
  }
  const J = copy(J0);
  if (style === 0) { // both arms up
    J.elL = [-0.3, 0.02, 1.76]; J.elR = [0.3, 0.02, 1.76]; J.haL = [-0.3, 0.06, 2.06]; J.haR = [0.3, 0.06, 2.06];
    if (k % 2) { J.footL = [-0.12, -0.12, 0.24]; J.footR = [0.12, -0.08, 0.26]; J.kneeL = [-0.12, 0.12, 0.54]; J.kneeR = [0.12, 0.14, 0.56]; }
  } else { // a fist pumped, the other arm low
    J.elR = [0.3, 0.1, 1.7 - (k % 2) * 0.2]; J.haR = [0.26, 0.12, 2.0 - (k % 2) * 0.35]; J.elL = [-0.3, 0.05, 1.2]; J.haL = [-0.34, 0.15, 1.0];
    J.footL = [-0.13, 0.15, 0.06]; J.kneeL = [-0.13, 0.25, 0.48];
  }
  return J;
}
function thrower(k) {
  const J = copy(J0);
  J.footL = [-0.12, 0.25, 0.06]; J.kneeL = [-0.12, 0.25, 0.5]; J.footR = [0.12, -0.22, 0.06]; J.kneeR = [0.12, -0.08, 0.5];
  if (k === 0) { J.elL = [-0.2, -0.05, 1.8]; J.elR = [0.2, -0.05, 1.8]; J.haL = [-0.12, -0.22, 1.96]; J.haR = [0.12, -0.22, 1.96]; move(J, ['chest', 'shL', 'shR', 'head'], 0, -0.1, 0); }
  else { J.elL = [-0.2, 0.2, 1.74]; J.elR = [0.2, 0.2, 1.74]; J.haL = [-0.12, 0.38, 1.74]; J.haR = [0.12, 0.38, 1.74]; move(J, ['chest', 'shL', 'shR', 'head'], 0, 0.12, 0); }
  return J;
}
function poseOf(name, k, side) {
  switch (name) {
    case 'run': return run(k / 8);
    case 'ready': return ready();
    case 'kick': return kick(k);
    case 'slide': return slide(k);
    case 'header': return header(k);
    case 'dive': return dive(k, side);
    case 'catch': return catcher();
    case 'down': return down(k);
    case 'cel0': case 'cel1': case 'cel2': return celebrate(+name[3], k);
    case 'throw': return thrower(k);
    default: return copy(J0);
  }
}

// ---------- sprites ----------
export function createPlayers() {
  let P = 1, k = 1, o = 1, px = 0;
  const cache = new Map();
  const scratch = [canvas(8, 8), canvas(8, 8)];

  function reset(ppm) { P = ppm; k = P * FIG; o = Math.max(1, Math.round(k * 0.024)); cache.clear(); px = 0; }

  /** build one sprite: the pose drawn facing d, its rim, and where its head and shadow go */
  function build(kit, gk, skin, pose, fr, d, side) {
    const J = poseOf(pose, fr, side), th = (d / DIRS) * TAU, fw = [Math.cos(th), Math.sin(th)], rt = [-Math.sin(th), Math.cos(th)];
    const W3 = n => { const [a, f, z] = J[n]; return [a * rt[0] + f * fw[0], a * rt[1] + f * fw[1], z]; };
    const S = {}, D = {};
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of NAMES) {
      const w = W3(n), sx = w[0] * k, sy = (w[1] - w[2] * ZK) * k;
      S[n] = [sx, sy]; D[n] = w[1] * ZK + w[2];
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const m = 0.32 * k + o + 1, ax = Math.ceil(m - x0), ay = Math.ceil(m - y0);
    const w = Math.ceil(x1 - x0 + 2 * m), h = Math.ceil(y1 - y0 + 2 * m);
    const [F, Sil] = scratch;
    F.width = w; F.height = h; Sil.width = w; Sil.height = h;
    const g = F.getContext('2d');
    g.translate(ax, ay); g.lineCap = 'round'; g.lineJoin = 'round';
    const skinC = BODY[skin], shirt = gk ? kit.shirt : kit.shirt, sleeve = shirt, fore = gk ? shade(shirt, -0.08) : skinC, hand = gk ? GLOVE : skinC;
    const seg = (a, b, wd, col, t0 = 0, t1 = 1) => {
      const A = S[a], B = S[b];
      g.strokeStyle = col; g.lineWidth = wd * k;
      g.beginPath(); g.moveTo(lerp(A[0], B[0], t0), lerp(A[1], B[1], t0)); g.lineTo(lerp(A[0], B[0], t1), lerp(A[1], B[1], t1)); g.stroke();
    };
    const dot = (n, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(S[n][0], S[n][1], r * k, 0, TAU); g.fill(); };
    const leg = s => () => {
      seg('hip' + s, 'knee' + s, 0.13, skinC);
      seg('knee' + s, 'foot' + s, 0.11, skinC, 0, 0.3);
      seg('knee' + s, 'foot' + s, 0.12, kit.socks, 0.22, 1);
      seg('hip' + s, 'knee' + s, 0.175, kit.shorts, 0, 0.55);
      // the boot, pointing forward
      const F2 = S['foot' + s], bx = fw[0] * 0.07 * k, by = fw[1] * 0.07 * k;
      g.strokeStyle = '#0e0e0e'; g.lineWidth = 0.1 * k; g.beginPath(); g.moveTo(F2[0] - bx * 0.6, F2[1] - by * 0.6); g.lineTo(F2[0] + bx, F2[1] + by); g.stroke();
    };
    const arm = s => () => {
      seg('sh' + s, 'el' + s, 0.105, sleeve);
      seg('el' + s, 'ha' + s, 0.085, fore);
      if (!gk) seg('sh' + s, 'el' + s, 0.105, sleeve, 0, 0.75);
      dot('ha' + s, gk ? 0.065 : 0.05, hand);
    };
    const torso = () => {
      // the spine on screen, and the body's width across it from its cross-section
      const pc = S.pel, cc = S.chest, sx = cc[0] - pc[0], sy = cc[1] - pc[1], sl = Math.hypot(sx, sy) || 1;
      const n = sl > 0.5 ? [-sy / sl, sx / sl] : [1, 0], dn = [-sx / sl, -sy / sl];
      const p3 = W3('pel'), c3 = W3('chest');
      let sp = [c3[0] - p3[0], c3[1] - p3[1], c3[2] - p3[2]];
      const spl = Math.hypot(...sp) || 1; sp = sp.map(v => v / spl);
      const lat = [rt[0], rt[1], 0], dl = lat[0] * sp[0] + lat[1] * sp[1];
      let A = [lat[0] - dl * sp[0], lat[1] - dl * sp[1], -dl * sp[2]], al = Math.hypot(...A);
      if (al < 0.25) { const fv = [fw[0], fw[1], 0], df = fv[0] * sp[0] + fv[1] * sp[1]; A = [fv[0] - df * sp[0], fv[1] - df * sp[1], -df * sp[2]]; al = Math.hypot(...A) || 1; }
      A = A.map(v => v / al);
      const B = [A[1] * sp[2] - A[2] * sp[1], A[2] * sp[0] - A[0] * sp[2], A[0] * sp[1] - A[1] * sp[0]];
      const scr = V => [V[0], V[1] - V[2] * ZK], An = scr(A)[0] * n[0] + scr(A)[1] * n[1], Bn = scr(B)[0] * n[0] + scr(B)[1] * n[1];
      const hwC = Math.max(0.09, Math.hypot(0.21 * An, 0.13 * Bn)) * k, hwW = Math.max(0.08, Math.hypot(0.16 * An, 0.11 * Bn)) * k, cap = 0.09 * k;
      const path = () => {
        g.beginPath();
        g.moveTo(cc[0] + n[0] * hwC, cc[1] + n[1] * hwC);
        g.lineTo(pc[0] + n[0] * hwW - dn[0] * 0.02 * k, pc[1] + n[1] * hwW - dn[1] * 0.02 * k);
        g.lineTo(pc[0] - n[0] * hwW - dn[0] * 0.02 * k, pc[1] - n[1] * hwW - dn[1] * 0.02 * k);
        g.lineTo(cc[0] - n[0] * hwC, cc[1] - n[1] * hwC);
        g.bezierCurveTo(cc[0] - n[0] * hwC - dn[0] * cap, cc[1] - n[1] * hwC - dn[1] * cap, cc[0] + n[0] * hwC - dn[0] * cap, cc[1] + n[1] * hwC - dn[1] * cap, cc[0] + n[0] * hwC, cc[1] + n[1] * hwC);
        g.closePath();
      };
      // the shorts at the waist
      g.fillStyle = kit.shorts; g.beginPath(); g.ellipse(pc[0], pc[1], hwW * 1.05, hwW * 0.75, Math.atan2(n[1], n[0]), 0, TAU); g.fill();
      path(); g.fillStyle = shirt; g.fill();
      g.save(); path(); g.clip();
      g.transform(n[0], n[1], dn[0], dn[1], cc[0], cc[1]); // local: x across the body, y down it
      const len = sl, hw = Math.max(hwC, hwW) * 1.4, trim = kit.trim ?? '#ffffff';
      g.fillStyle = trim;
      const pat = gk ? 'plain' : kit.pattern;
      if (pat === 'stripes') { const st = 0.075 * k; for (let x = -st * 0.5; x < hw; x += st * 2) { g.fillRect(x, -cap * 2, st, len + cap * 3); g.fillRect(-x - st, -cap * 2, st, len + cap * 3); } }
      else if (pat === 'hoops') { const st = (len + cap) / 5; for (let i = 0; i < 6; i += 2) g.fillRect(-hw, -cap + st * (i + 0.5), hw * 2, st); }
      else if (pat === 'halves') {
        const al2 = 0.21 * An * k, split = ((B[1] * ZK + B[2]) >= 0 ? 1 : -1) * 0.13 * Bn * k;
        if (al2 >= split) g.fillRect(-hw * 2, -cap * 2, hw * 2 + split, len + cap * 3); else g.fillRect(split, -cap * 2, hw * 2, len + cap * 3);
      } else if (pat === 'sash') {
        g.strokeStyle = trim; g.lineWidth = 0.09 * k; g.lineCap = 'butt';
        g.beginPath(); g.moveTo(0.2 * An * k, -cap); g.lineTo(-0.16 * An * k, len + cap); g.stroke(); g.lineCap = 'round';
      }
      g.setTransform(1, 0, 0, 1, ax, ay);
      // light from the top left
      const gr = g.createLinearGradient(cc[0] - hwC, cc[1] - hwC, cc[0] + hwC, pc[1] + hwW);
      gr.addColorStop(0, 'rgba(255,255,255,0.2)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.22)');
      g.fillStyle = gr; g.fillRect(cc[0] - hwC * 2, Math.min(cc[1], pc[1]) - hwC * 2, hwC * 4, Math.abs(pc[1] - cc[1]) + hwC * 4);
      g.restore();
      // the collar
      g.strokeStyle = gk ? shade(shirt, -0.3) : trim; g.lineWidth = 0.035 * k;
      g.beginPath(); g.moveTo(cc[0] - n[0] * 0.07 * k, cc[1] - n[1] * 0.07 * k); g.lineTo(cc[0] + n[0] * 0.07 * k, cc[1] + n[1] * 0.07 * k); g.stroke();
    };
    const mean = ns => ns.reduce((s, n) => s + D[n], 0) / ns.length;
    const parts = [
      [mean(['hipL', 'kneeL', 'footL']) - 0.3, leg('L')], [mean(['hipR', 'kneeR', 'footR']) - 0.3, leg('R')],
      [mean(['shL', 'elL', 'haL']), arm('L')], [mean(['shR', 'elR', 'haR']), arm('R')],
      [(D.pel + D.chest) / 2 + 0.02, torso],
    ].sort((a, b) => a[0] - b[0]);
    for (const [, fn] of parts) fn();
    // the rim: the figure's silhouette in a dark green-black, a pixel or two around it
    const sg = Sil.getContext('2d');
    sg.drawImage(F, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = 'rgba(6,18,8,0.8)'; sg.fillRect(0, 0, w, h);
    const out = canvas(w, h), og = out.getContext('2d');
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o]]) og.drawImage(Sil, dx, dy);
    og.drawImage(F, 0, 0);
    // the shadow: where the sun throws the figure, from its feet toward its head's shadow
    const gs = n => { const w3 = W3(n); return [w3[0] + SUN[0] * w3[2] * 0.6, w3[1] + SUN[1] * w3[2] * 0.6]; };
    const fa = gs('footL'), fb = gs('footR'), hd = gs('head'), ft = [(fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2];
    const sl = Math.hypot(hd[0] - ft[0], hd[1] - ft[1]);
    const shadow = { x: (ft[0] + hd[0]) / 2, y: (ft[1] + hd[1]) / 2, rx: sl / 2 + 0.2, ry: 0.2, rot: Math.atan2(hd[1] - ft[1], hd[0] - ft[0]) };
    return { cv: out, ax, ay, hx: S.head[0], hy: S.head[1], hd: D.head, top: y0, shadow, fw };
  }

  function sprite(kit, gk, skin, pose, fr, d, side) {
    const key = `${kit.shirt}|${kit.shorts}|${kit.socks}|${kit.trim}|${kit.pattern}|${gk ? 1 : 0}|${skin}|${pose}|${fr}|${d}|${side}`;
    let e = cache.get(key);
    if (!e) {
      if (cache.size > 1600) { cache.clear(); px = 0; }
      e = build(kit, gk, skin, pose, fr, d, side);
      px += e.cv.width * e.cv.height;
      cache.set(key, e);
    }
    return e;
  }

  /** which sprite a player shows now, and how high he is off the grass */
  function frame(p, kit, gk, look, phase, m = {}) {
    const dir = Number.isFinite(p.dir) ? p.dir : Math.atan2(p.vy || 0, p.vx || 1);
    let d = ((Math.round((dir / TAU) * DIRS) % DIRS) + DIRS) % DIRS;
    // kits that look the same in a mirror share the facings either side of north-south
    const flip = (gk || SYMMETRIC.has(kit.pattern)) && (d > 12 || d < 4);
    if (flip) d = (DIRS / 2 - d + DIRS) % DIRS;
    const sp = Math.hypot(p.vx || 0, p.vy || 0), t = p.animT || 0;
    let pose = 'stand', fr = 0, side = 0, lift = 0;
    switch (p.anim) {
      case 'run': if (sp > 0.4) { pose = 'run'; fr = Math.floor(phase * 8) % 8; } else pose = gk ? 'ready' : 'stand'; break;
      case 'kick': pose = 'kick'; fr = t < 0.07 ? 0 : t < 0.17 ? 1 : 2; break;
      case 'slide': pose = 'slide'; fr = t < 0.12 ? 0 : 1; break;
      case 'header': pose = 'header'; fr = t < 0.16 ? 0 : 1; lift = Math.max(0, Math.sin(Math.min(1, t / 0.5) * Math.PI)) * 0.55; break;
      case 'dive': {
        const cr = Math.cos(dir) * (p.vy || 0) - Math.sin(dir) * (p.vx || 0);
        side = sp < 0.3 && m.side ? m.side : cr >= 0 ? 1 : -1;
        m.side = side;
        if (flip) side = -side;
        pose = 'dive'; fr = t < 0.07 ? 0 : t < 0.55 ? 1 : 2;
        lift = fr === 1 ? Math.sin(clamp((t - 0.07) / 0.48, 0, 1) * Math.PI) * 0.45 : 0;
        break;
      }
      case 'catch': pose = 'catch'; break;
      case 'down': pose = 'down'; fr = t < 0.2 ? 0 : 1; break;
      case 'celebrate': {
        const st = look.cel;
        pose = 'cel' + st;
        if (st === 1) fr = Math.floor(phase * 8) % 8;
        else { fr = Math.floor(t * 4) % 4; lift = st === 0 ? Math.abs(Math.sin(t * Math.PI * 2)) * 0.35 : 0; }
        break;
      }
      case 'throw': pose = 'throw'; fr = t < 0.35 ? 0 : 1; break;
      default: pose = gk ? 'ready' : 'stand';
    }
    return { e: sprite(kit, gk, look.skin >> 1, pose, fr, d, side), lift, d, pose, side, flip };
  }

  /** the shadow under one player (before any player is drawn) */
  function shadow(g, v, p, f) {
    const s = f.e.shadow, m = f.flip ? -1 : 1, X = v.X(p.x + s.x * FIG * m), Y = v.Y(p.y + s.y * FIG, 0), q = 1 - clamp(f.lift, 0, 1) * 0.4;
    g.fillStyle = `rgba(0,18,0,${(0.3 * q).toFixed(3)})`;
    g.beginPath(); g.ellipse(X, Y, s.rx * FIG * v.P * q, s.ry * FIG * v.P * q, f.flip ? Math.PI - s.rot : s.rot, 0, TAU); g.fill();
  }

  /** the figure and its head; returns the screen point above the head (for markers) */
  function draw(g, v, p, f, look) {
    const e = f.e, X = Math.round(v.X(p.x)), Y = Math.round(v.Y(p.y, f.lift));
    if (f.flip) { g.save(); g.translate(X, Y); g.scale(-1, 1); g.drawImage(e.cv, -e.ax, -e.ay); g.restore(); }
    else g.drawImage(e.cv, X - e.ax, Y - e.ay);
    head(g, X + (f.flip ? -e.hx : e.hx), Y + e.hy, f.flip ? [-e.fw[0], e.fw[1]] : e.fw, look);
    return [X, Y + Math.min(e.top, e.hy - 0.16 * k)];
  }
  function head(g, x, y, fw, look) {
    const r = 0.14 * k;
    g.fillStyle = 'rgba(6,18,8,0.8)'; g.beginPath(); g.arc(x, y, r + o, 0, TAU); g.fill();
    g.fillStyle = SKIN[look.skin]; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    if (look.style === 'bald') { g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.35, 0, TAU); g.fill(); return; }
    // the hair covers the back and the crown: more of the head as he turns away
    const away = Math.max(0, -fw[1]), hx = -fw[0] * 0.6, hy = -fw[1] * 0.6 - 0.8, hl = Math.hypot(hx, hy) || 1;
    const ang = Math.atan2(hy / hl, hx / hl), cover = Math.acos(clamp(-(0.12 + away * 0.6 + (look.style === 'crop' ? -0.1 : 0)), -1, 1));
    const R = look.style === 'curly' ? r * 1.14 : r * 1.02;
    g.fillStyle = look.hair;
    g.beginPath(); g.arc(x, y, R, ang - cover, ang + cover); g.closePath(); g.fill();
    if (look.style === 'long') { g.beginPath(); g.ellipse(x - fw[0] * r * 0.6, y - fw[1] * r * 0.5 + r * 0.5, r * 0.7, r * 0.55, 0, 0, TAU); g.fill(); }
    else if (look.style === 'tied') { g.beginPath(); g.arc(x - fw[0] * r * 1.05, y - fw[1] * r * 0.8 - r * 0.25, r * 0.38, 0, TAU); g.fill(); }
    else if (look.style === 'curly') { for (let i = -2; i <= 2; i++) { const a = ang + i * cover * 0.38; g.beginPath(); g.arc(x + Math.cos(a) * R * 0.92, y + Math.sin(a) * R * 0.92, r * 0.3, 0, TAU); g.fill(); } }
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.45, r * 0.4, 0, TAU); g.fill();
  }

  // ---------- the ball ----------
  // six panels on the sphere, turned by the roll and the spin; seen along the camera's line
  const PANELS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const CAM = (() => { const l = Math.hypot(ZK, 1); return [0, ZK / l, 1 / l]; })();
  const E2 = (() => { const l = Math.hypot(1, ZK); return [0, 1 / l, -ZK / l]; })(); // down the screen
  /** mem: { roll, yaw } kept by the renderer; the ball's shadow first, then the ball */
  function ballShadow(g, v, b) {
    const z = Math.max(0, b.z || 0), X = v.X(b.x + SUN[0] * z * 0.3), Y = v.Y(b.y + SUN[1] * z * 0.3, 0), q = 1 / (1 + z * 0.12);
    g.fillStyle = `rgba(0,16,0,${(0.42 * q).toFixed(3)})`;
    g.beginPath(); g.ellipse(X + 0.06 * v.P, Y + 0.05 * v.P, 0.26 * v.P * (1 + z * 0.05), 0.19 * v.P * (1 + z * 0.05), 0.4, 0, TAU); g.fill();
  }
  function ball(g, v, b, mem) {
    const z = Math.max(0, b.z || 0), X = v.X(b.x), Y = v.Y(b.y, z), R = 0.27 * v.P * (1 + z * 0.025);
    g.fillStyle = 'rgba(8,18,8,0.75)'; g.beginPath(); g.arc(X, Y, R + Math.max(1, o * 0.8), 0, TAU); g.fill();
    g.fillStyle = '#f7f7f2'; g.beginPath(); g.arc(X, Y, R, 0, TAU); g.fill();
    // the panels: roll about the axis across the travel, yaw about the vertical
    const sp = Math.hypot(b.vx || 0, b.vy || 0), ax = sp > 0.01 ? [-(b.vy || 0) / sp, (b.vx || 0) / sp, 0] : [1, 0, 0];
    const cr = Math.cos(mem.roll), sr = Math.sin(mem.roll), cy = Math.cos(mem.yaw), sy = Math.sin(mem.yaw);
    g.fillStyle = '#20262c';
    for (const p0 of PANELS) {
      let p = [p0[0] * cy - p0[1] * sy, p0[0] * sy + p0[1] * cy, p0[2]];
      // Rodrigues about ax
      const d = ax[0] * p[0] + ax[1] * p[1] + ax[2] * p[2], cx = [ax[1] * p[2] - ax[2] * p[1], ax[2] * p[0] - ax[0] * p[2], ax[0] * p[1] - ax[1] * p[0]];
      p = [p[0] * cr + cx[0] * sr + ax[0] * d * (1 - cr), p[1] * cr + cx[1] * sr + ax[1] * d * (1 - cr), p[2] * cr + cx[2] * sr + ax[2] * d * (1 - cr)];
      const facing = p[0] * CAM[0] + p[1] * CAM[1] + p[2] * CAM[2];
      if (facing < -0.1) continue;
      const px = p[0], py = p[1] * E2[1] + p[2] * E2[2], s = R * 0.36 * (0.45 + 0.55 * Math.max(0, facing));
      g.beginPath(); g.arc(X + px * R * 0.78, Y + py * R * 0.78, s, 0, TAU); g.fill();
    }
    // shading and a highlight
    const gr = g.createRadialGradient(X - R * 0.35, Y - R * 0.4, R * 0.1, X, Y, R * 1.05);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,10,20,0.4)');
    g.fillStyle = gr; g.beginPath(); g.arc(X, Y, R, 0, TAU); g.fill();
    return [X, Y, R];
  }

  /** the controlled player's mark: his number on a tag with a point, over his head */
  function marker(g, x, y, num, col, t, small = false) {
    const s = (small ? 0.75 : 1) * Math.max(0.55, k / 50), bob = Math.sin(t * 6) * 2 * s, Y = y - 10 * s + bob;
    const label = String(num ?? ''), w = (label.length > 1 ? 30 : 22) * s, h = 22 * s;
    g.fillStyle = 'rgba(6,14,24,0.82)';
    g.beginPath(); g.roundRect(x - w / 2, Y - h - 7 * s, w, h, 5 * s); g.fill();
    g.beginPath(); g.moveTo(x - 6 * s, Y - 7.5 * s); g.lineTo(x + 6 * s, Y - 7.5 * s); g.lineTo(x, Y); g.closePath(); g.fillStyle = col; g.fill();
    g.strokeStyle = col; g.lineWidth = 2 * s; g.beginPath(); g.roundRect(x - w / 2, Y - h - 7 * s, w, h, 5 * s); g.stroke();
    g.font = `800 ${Math.round(17 * s)}px 'Saira Condensed', 'Arial Narrow', sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.fillText(label, x, Y - 7 * s - h / 2 + 1 * s);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    return Y - h - 7 * s;
  }

  return { reset, frame, shadow, draw, ballShadow, ball, marker, get size() { return cache.size; }, get pixels() { return px; }, get k() { return k; } };
}
