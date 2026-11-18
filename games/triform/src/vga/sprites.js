// Sprites drawn from rectangles every frame: the three forms, enemies, bosses and props.
// Coordinates are pixels relative to an anchor (usually the feet), facing right; pen()
// mirrors them for things facing left.
import { C, ZONE_PAL } from './palette.js';

export function pen(g, ox, oy, face = 1) {
  ox = Math.round(ox); oy = Math.round(oy);
  return (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(face > 0 ? ox + x : ox - x - w, oy + y, w, h);
  };
}

// ---------- the three forms ----------
export function drawAndroid(g, x, y, p, t) {
  const R = pen(g, x, y, p.face), S = C.steel, V = C.visor;
  const run = p.ground && Math.abs(p.vx) > 0.5 ? Math.sin(p.walk * 1.6) : 0;
  const air = !p.ground && !p.ladder;
  if (p.ladder) {
    const k = Math.sin(p.walk * 1.4) > 0 ? 1 : 0;
    R(-4, -9 + k, 3, 9 - k, S[1]); R(1, -9 + (1 - k), 3, 9 - (1 - k), S[1]);
    R(-4, -17, 8, 8, S[3]); R(-4, -17, 8, 1, S[4]); R(-1, -16, 2, 6, S[1]);
    R(-6, -21 + k * 2, 2, 8, S[2]); R(4, -21 + (1 - k) * 2, 2, 8, S[2]);
    R(-3, -22, 6, 5, S[3]); R(-3, -22, 6, 1, S[4]); R(-2, -20, 4, 1, S[1]);
    return;
  }
  // legs
  const l1 = air ? -2 : Math.round(run * 2.5), l2 = air ? 2 : -l1;
  R(-3 + l2, -9, 3, 7, S[1]); R(-3 + l2, -2, 4, 2, S[0]);
  R(0 + l1, -9, 3, 7, S[2]); R(0 + l1, -2, 4, 2, S[1]);
  if (air) { R(-3 + l2, -9, 3, 4, S[1]); }
  // back arm
  const arm = air ? -3 : Math.round(-run * 2);
  R(-5, -16 + (arm < 0 ? 0 : 0), 2, 6, S[1]);
  // torso
  R(-4, -17, 8, 8, S[3]); R(-4, -17, 8, 1, S[5]); R(-4, -10, 8, 1, S[1]);
  R(-1, -15, 3, 3, (t * 4) % 2 < 1 ? C.amber[4] : C.amber[3]);
  R(3, -16, 1, 6, S[2]);
  // head
  R(-3, -23, 6, 6, S[3]); R(-3, -23, 6, 1, S[5]); R(-3, -18, 6, 1, S[1]);
  R(0, -21, 4, 2, V[1]); R(2, -21, 2, 1, V[2]);
  R(-2, -25, 1, 2, S[2]); R(-2, -26, 1, 1, C.red[3]);
  // front arm: strike punches forward
  if (p.swing?.src === 'strike') { R(3, -15, 8, 2, S[4]); R(10, -16, 3, 4, S[5]); }
  else if (p.spCd > 0.15) { R(3, -15, 6, 2, S[4]); R(8, -16, 2, 3, C.visor[1]); }
  else R(3 + (air ? 1 : 0), -16 + Math.max(0, Math.round(run * 2)), 2, 6, S[4]);
}

export function drawRaptor(g, x, y, p, t) {
  const R = pen(g, x, y, p.face), A = C.amber;
  const run = p.ground && Math.abs(p.vx) > 0.5 ? Math.sin(p.walk * 1.1) : 0;
  const low = p.sprint > 0.5 ? 2 : 0, air = !p.ground;
  const bob = Math.round(Math.abs(run) * 1) + low;
  // tail: swings up and over during a swipe
  const sw = p.swing?.src === 'swipe' ? 1 - p.swing.t / 0.15 : -1;
  if (sw >= 0) {
    const a = sw * Math.PI;
    for (let k = 0; k < 5; k++) {
      const r = 6 + k * 3, tx = Math.round(-6 - Math.cos(a) * r), ty = Math.round(-14 - Math.sin(a) * r * 0.8);
      R(tx, ty + bob, 4 - (k >> 1), 3 - (k >> 2), k % 2 ? A[3] : A[4]);
    }
  } else {
    const wag = Math.round(Math.sin(t * 5 + p.walk) * 1);
    R(-14, -17 + bob + wag, 6, 3, A[3]); R(-19, -16 + bob + wag * 2, 6, 2, A[2]); R(-23, -15 + bob + wag * 2, 5, 2, A[2]);
    R(-14, -17 + bob + wag, 6, 1, A[4]);
  }
  // legs (digitigrade)
  const k1 = air ? -3 : Math.round(run * 4), k2 = air ? 3 : -k1;
  R(-6 + k2, -12 + bob, 5, 5, A[1]); R(-5 + k2, -7, 3, 5, A[1]); R(-6 + k2, -2, 6, 2, A[0]);
  R(-2 + k1, -12 + bob, 5, 5, A[2]); R(-1 + k1, -7, 3, 5, A[2]); R(-2 + k1, -2, 6, 2, A[1]);
  // body
  R(-9, -21 + bob, 17, 10, A[3]); R(-8, -22 + bob, 14, 1, A[4]); R(-9, -12 + bob, 17, 1, A[1]);
  for (let k = 0; k < 4; k++) R(-7 + k * 4, -23 + bob, 2, 2, A[2]);
  R(-4, -18 + bob, 8, 4, A[2]); R(-3, -17 + bob, 2, 2, C.red[2]);
  // arms
  R(6, -15 + bob, 3, 2, A[2]); R(8, -14 + bob, 1, 2, A[1]);
  // neck and head; the jaw drops for a bite and flames come out of it
  const bite = p.swing?.src === 'bite', open = bite || p.flaming ? 3 : 0;
  R(5, -26 + bob, 5, 8, A[3]);
  R(7, -30 + bob, 11, 6, A[4]); R(7, -30 + bob, 11, 1, A[5]);
  R(14, -29 + bob, 2, 2, C.red[3]); R(15, -29 + bob, 1, 1, C.white);
  R(9, -24 + bob + open, 9, 2, A[2]);
  if (open) { R(10, -24 + bob, 7, open, C.black); for (let k = 0; k < 4; k++) { R(10 + k * 2, -24 + bob, 1, 1, C.white); R(10 + k * 2, -24 + bob + open - 1, 1, 1, C.white); } }
  else for (let k = 0; k < 4; k++) R(10 + k * 2, -24 + bob, 1, 1, C.ink);
}

export function drawTank(g, x, y, p, t) {
  const R = pen(g, x, y, p.face), O = C.olive;
  const roll = Math.floor(p.walk * 3) % 4;
  // treads
  R(-13, -7, 26, 7, C.steel[0]); R(-12, -7, 24, 1, C.steel[2]);
  for (let k = 0; k < 7; k++) R(-12 + ((k * 4 + roll) % 26), -1, 2, 1, C.steel[2]);
  for (let k = 0; k < 4; k++) { R(-10 + k * 6, -6, 4, 4, C.steel[2]); R(-9 + k * 6, -5, 2, 2, C.steel[4]); }
  // hull with a sloped nose
  R(-12, -14, 22, 7, O[3]); R(10, -12, 2, 5, O[3]); R(12, -10, 1, 3, O[2]);
  R(-12, -14, 22, 1, O[5]); R(-12, -8, 24, 1, O[1]);
  for (let i = 0; i < 20; i++) R(-10 + i, -11, 1, 2, (i >> 1) % 2 ? C.yellow[3] : C.black);
  // turret and barrel (recoils after a shot)
  const rec = p.atkCd > 0.45 ? -2 : 0;
  R(-6, -20, 11, 6, O[4]); R(-6, -20, 11, 1, O[5]); R(-6, -15, 11, 1, O[2]);
  R(5 + rec, -19, 10, 2, O[2]); R(5 + rec, -19, 10, 1, O[4]); R(14 + rec, -20, 2, 4, O[1]);
  R(-3, -18, 3, 2, C.visor[1]);
  // antenna with a blinking tip
  R(-5, -26, 1, 6, C.steel[3]); R(-5, -27, 1, 1, (t * 3) % 2 < 1 ? C.red[3] : C.red[1]);
  if (p.probe) R(-1, -22, 4, 2, C.steel[0]);
}

export function drawForm(g, form, x, y, p, t) {
  if (form === 'android') drawAndroid(g, x, y, p, t);
  else if (form === 'raptor') drawRaptor(g, x, y, p, t);
  else drawTank(g, x, y, p, t);
}

export function drawProbe(g, x, y, t) {
  const R = pen(g, x, y);
  R(-3, -3, 6, 5, C.steel[3]); R(-3, -3, 6, 1, C.steel[5]); R(-2, -1, 4, 2, C.steel[1]);
  R(-1, -1, 2, 1, (t * 8) % 2 < 1 ? C.green[3] : C.green[1]);
  const w = (t * 30) % 2 < 1 ? 5 : 3;
  R(-w, -5, w * 2, 1, C.steel[4]); R(0, -4, 1, 1, C.steel[2]);
}

// ---------- enemies ----------
export function drawEnemy(g, e, x, y, t, zone) {
  const f = e.flash > 0, R = pen(g, x, y, e.dir > 0 ? 1 : -1), P = ZONE_PAL[zone];
  const col = (c, i) => (f ? C.white : c[i]);
  switch (e.kind) {
    case 'crawler': {
      const legs = Math.floor(e.t * 10) % 2;
      for (let k = 0; k < 3; k++) R(-6 + k * 4 + legs, -3, 1, 3, col(C.steel, 1));
      R(-7, -10, 14, 7, col(C.red, 1)); R(-6, -11, 12, 1, col(C.red, 2)); R(-7, -4, 14, 1, col(C.red, 0));
      for (let k = 0; k < 3; k++) R(-6 + k * 4, -9, 3, 1, col(C.red, 2));
      R(4, -8, 3, 2, col(P.glow, 1)); R(6, -8, 1, 1, C.white);
      break;
    }
    case 'drone': {
      const w = Math.floor(e.t * 20) % 2 ? 7 : 4;
      R(-w, -11, w * 2, 1, col(C.steel, 4));
      R(0, -10, 1, 2, col(C.steel, 2));
      R(-5, -8, 10, 6, col(C.steel, 2)); R(-5, -8, 10, 1, col(C.steel, 4)); R(-4, -2, 8, 1, col(C.steel, 0));
      R(1, -6, 3, 2, col(C.red, 3)); R(-3, -6, 2, 2, col(C.steel, 1));
      break;
    }
    case 'turret': {
      // riveted housing: armour that only the cannon can crack
      R(-6, -16, 12, 16, col(C.steel, 1)); R(-6, -16, 12, 1, col(C.steel, 3)); R(-6, -16, 1, 16, col(C.steel, 2));
      for (const [a, b] of [[-5, -15], [4, -15], [-5, -2], [4, -2]]) R(a, b, 1, 1, col(C.steel, 4));
      R(-3, -12, 7, 6, col(C.red, 1)); R(-2, -11, 3, 3, col(C.red, e.cd < 0.4 ? 4 : 2));
      R(4, -10, 6, 2, col(C.steel, 3)); R(9, -11, 2, 4, col(C.steel, 2));
      break;
    }
    case 'hopper': {
      const sq = e.ground ? (e.cd < 0.25 ? 2 : 0) : -1;
      R(-5, -12 + sq, 10, 8 - sq, col(C.green, 1)); R(-5, -12 + sq, 10, 1, col(C.green, 3));
      R(1, -10 + sq, 3, 2, col(C.yellow, 4)); R(-3, -10 + sq, 2, 2, col(C.yellow, 2));
      R(-4, -4, 2, 4 - (sq > 0 ? 2 : 0), col(C.steel, 2)); R(2, -4, 2, 4 - (sq > 0 ? 2 : 0), col(C.steel, 2));
      R(-1, -15 + sq, 1, 3, col(C.steel, 3));
      break;
    }
    case 'swooper': {
      const flap = e.state === 'dive' ? 0 : Math.floor(e.t * 8) % 2;
      R(-7, -8 - flap * 2, 5, 2, col(C.purple, 2)); R(2, -8 - flap * 2, 5, 2, col(C.purple, 2));
      R(-3, -9, 6, 6, col(C.purple, 1)); R(-3, -9, 6, 1, col(C.purple, 3));
      R(0, -7, 2, 2, col(P.glow, 1));
      R(-1, -3, 1, 2, col(C.steel, 2)); R(1, -3, 1, 2, col(C.steel, 2));
      break;
    }
  }
}

// ---------- props ----------
export function drawSwitch(g, e, x, y, t) {
  const R = pen(g, x, y);
  if (e.armored) {
    // riveted bullseye: only cannon shells register
    R(0, -10, 8, 10, C.steel[1]); R(0, -10, 8, 1, C.steel[3]);
    for (const [a, b] of [[1, -9], [6, -9], [1, -2], [6, -2]]) R(a, b, 1, 1, C.steel[4]);
    R(2, -8, 4, 6, e.on ? C.green[3] : C.red[2]); R(3, -6, 2, 2, e.on ? C.green[4] : C.red[4]);
  } else {
    R(1, -10, 6, 10, C.steel[2]); R(1, -10, 6, 1, C.steel[4]);
    R(2, -8, 4, 4, e.on ? C.green[3] : (t * 2) % 2 < 1 ? C.red[3] : C.red[2]);
    R(3, -3, 2, 2, C.steel[1]);
  }
}
export function drawGen(g, e, x, y, t) {
  const R = pen(g, x, y);
  R(0, -10, 10, 10, C.steel[1]); R(0, -10, 10, 1, C.steel[3]);
  for (let k = 0; k < 4; k++) R(2, -8 + k * 2, 6, 1, e.down ? C.steel[0] : (Math.floor(t * 12) + k) % 3 ? C.cyan[2] : C.cyan[3]);
}
export function drawCore(g, e, x, y, t) {
  const R = pen(g, x, y), pulse = (t * 3) % 2 < 1;
  const f = e.flash > 0;
  if (e.need === 'shell') {
    R(0, -20, 12, 20, f ? C.white : C.steel[1]); R(0, -20, 12, 1, C.steel[3]);
    for (let k = 0; k < 4; k++) { R(1, -18 + k * 5, 1, 1, C.steel[4]); R(10, -18 + k * 5, 1, 1, C.steel[4]); }
    R(3, -14, 6, 8, pulse ? C.red[3] : C.red[2]); R(5, -12, 2, 4, C.red[4]);
  } else if (e.need === 'probe') {
    R(1, -14, 10, 12, f ? C.white : C.green[1]); R(3, -12, 6, 8, pulse ? C.green[3] : C.green[2]); R(5, -10, 2, 4, C.green[4]);
  } else {
    R(1, -18, 10, 14, f ? C.white : C.steel[2]); R(1, -18, 10, 1, C.steel[4]);
    R(3, -15, 6, 8, pulse ? C.cyan[3] : C.cyan[2]); R(5, -13, 2, 4, C.white);
    R(4, -4, 4, 4, C.steel[1]);
  }
}
export function drawPod(g, e, x, y, t, active) {
  const R = pen(g, x, y);
  R(0, -18, 12, 18, C.steel[1]); R(1, -17, 10, 1, C.steel[3]);
  R(2, -15, 8, 11, active ? C.green[1] : C.steel[0]);
  if (active) for (let k = 0; k < 3; k++) R(3, -14 + ((Math.floor(t * 10) + k * 3) % 10), 6, 1, C.green[3]);
  R(0, -2, 12, 2, C.steel[2]); R(4, -20, 4, 2, active ? C.green[3] : C.red[2]);
}
export function drawEnergy(g, e, x, y, t) {
  const R = pen(g, x, y + Math.round(Math.sin(t * 4 + x) * 1));
  R(1, -7, 6, 7, C.green[1]); R(2, -6, 4, 5, (t * 4) % 2 < 1 ? C.green[3] : C.green[2]); R(3, -8, 2, 1, C.steel[3]);
}
export function drawUpgrade(g, e, x, y, t) {
  const yy = y + Math.round(Math.sin(t * 3) * 2), R = pen(g, x, yy);
  R(-1, -13, 14, 14, C.hud[1]); R(-1, -13, 14, 1, C.white); R(-1, 0, 14, 1, C.hud[3]);
  R(-1, -13, 1, 14, C.white); R(12, -13, 1, 14, C.hud[3]);
  if (e.up === 'blaster') { R(2, -8, 8, 3, C.steel[4]); R(3, -5, 2, 3, C.steel[3]); R(9, -8, 2, 2, C.visor[2]); }
  if (e.up === 'flame') { R(4, -10, 4, 8, C.red[3]); R(5, -8, 2, 5, C.yellow[4]); R(3, -6, 1, 3, C.red[2]); R(8, -7, 1, 3, C.red[2]); }
  if (e.up === 'probe') { R(3, -8, 6, 4, C.steel[3]); R(5, -7, 2, 2, C.green[3]); R(2, -10, 8, 1, C.steel[4]); }
  if ((t * 6) % 3 < 1) R(10, -12, 1, 1, C.white);
}
export function drawPlate(g, e, x, y) {
  const R = pen(g, x, y), dn = e.pressed ? 1 : 0;
  R(0, -2 + dn, 16, 2 - dn, C.yellow[3]);
  for (let i = 0; i < 16; i += 4) R(i, -2 + dn, 2, 1, C.black);
  R(0, 0, 16, 1, C.steel[1]);
}
export function drawBlock(g, b, x, y) {
  const R = pen(g, x, y);
  R(0, 0, 16, 16, C.steel[2]); R(0, 0, 16, 1, C.steel[4]); R(0, 0, 1, 16, C.steel[3]);
  R(15, 0, 1, 16, C.steel[0]); R(0, 15, 16, 1, C.steel[0]);
  R(3, 3, 10, 10, C.steel[1]); R(4, 4, 8, 1, C.steel[3]);
  for (const [a, b2] of [[2, 2], [13, 2], [2, 13], [13, 13]]) R(a, b2, 1, 1, C.steel[5]);
  R(6, 7, 4, 2, C.yellow[3]);
}

// ---------- bosses ----------
export function drawBoss(g, b, x, y, t, sim) {
  const f = b.flash > 0, R = pen(g, x, y);
  const S = (ramp, i) => (f ? C.white : ramp[i]);
  if (b.kind === 'crucible') {
    // 48 × 36 rolling furnace on rails
    const pour = b.state === 'pour' ? 1 : 0, roll = Math.floor(b.x * 4) % 4;
    R(0, 28, 48, 8, C.steel[0]);
    for (let k = 0; k < 5; k++) { R(3 + k * 9, 29, 6, 6, C.steel[2]); R(5 + k * 9 + (roll % 2), 31, 2, 2, C.steel[4]); }
    R(2, 6, 44, 22, S(C.steel, 1)); R(2, 6, 44, 1, S(C.steel, 3)); R(2, 27, 44, 1, C.steel[0]);
    for (let k = 0; k < 6; k++) { R(4 + k * 8, 8, 1, 1, C.steel[4]); R(4 + k * 8, 25, 1, 1, C.steel[4]); }
    R(8, 12, 32, 10, C.black);
    const heat = 0.5 + Math.sin(t * 6) * 0.5;
    R(10, 14, 28, 6, heat > 0.5 ? C.amber[5] : C.amber[4]);
    for (let k = 0; k < 7; k++) R(11 + k * 4, 13, 1, 8, C.steel[0]);
    // the ladle lifts to pour
    R(12, 0 - pour * 4, 24, 6, S(C.steel, 2)); R(14, 1 - pour * 4, 20, 2, pour ? C.yellow[4] : C.amber[3]);
    R(6, 2 - pour * 2, 4, 6, C.steel[2]); R(38, 2 - pour * 2, 4, 6, C.steel[2]);
  } else if (b.kind === 'warden') {
    // 32 × 24 cryo drone; docked it grows an ice shell
    const fan = Math.floor(t * 20) % 2;
    R(0, 4, 32, 14, S(C.cyan, 0)); R(2, 2, 28, 2, S(C.cyan, 1)); R(0, 4, 32, 1, S(C.cyan, 2));
    R(4, 18, 24, 3, C.steel[1]);
    R(-4, 6, 4, 8, C.steel[2]); R(32, 6, 4, 8, C.steel[2]);
    R(-6 + fan, 5, 8, 1, C.steel[4]); R(30 - fan, 5, 8, 1, C.steel[4]);
    const exposed = b.state === 'exposed';
    R(11, 7, 10, 9, exposed ? ((t * 8) % 2 < 1 ? C.red[3] : C.red[4]) : C.ice[2]);
    R(14, 9, 4, 4, exposed ? C.yellow[4] : C.white);
    if (b.state === 'docked') {
      const melt = Math.min(1, b.melt);
      for (let j = 0; j < 24; j++) for (let i = -4; i < 36; i++) {
        if (((i * 7 + j * 3) % 11) / 11 < melt) continue;
        if (((i + j) & 3) === 0 || j === 0) { g.fillStyle = (i + j) % 5 ? C.ice[3] : C.white; g.fillRect(Math.round(x) + i, Math.round(y) + j, 1, 1); }
      }
      R(-4, 0, 40, 1, C.ice[4]);
    }
    if (b.state === 'hover' || b.state === 'ascend' || b.state === 'descend') {
      // shimmering shield while it flies
      const k = Math.floor(t * 10) % 4;
      for (let i = -6 + k; i < 38; i += 4) { R(i, -2, 2, 1, C.cyan[3]); R(i + 2, 25, 2, 1, C.cyan[3]); }
    }
  } else if (b.kind === 'sentinel') {
    // 36 × 28 eye in the wall
    const open = sim.room.fieldT > 0;
    // the housing is fixed to the wall (rows 8–20) while the eye bobs inside it
    const top = 64 - Math.round(y);
    R(-2, top, 44, 96, C.steel[0]);
    for (let j = top + 4; j < top + 96; j += 8) { R(-2, j, 44, 1, C.steel[1]); R(40, j + 2, 2, 2, C.steel[2]); }
    R(0, 0, 36, 28, S(C.steel, 1)); R(0, 0, 36, 1, S(C.steel, 3)); R(0, 27, 36, 1, C.black);
    R(4, 4, 28, 20, C.black);
    const pupil = open ? C.red[4] : C.red[2];
    R(8, 6, 20, 16, open ? C.red[2] : C.red[1]); R(12, 8, 12, 12, pupil); R(15, 11, 6, 6, C.black); R(15, 11, 2, 2, C.white);
    R(-6, 10, 6, 8, C.steel[2]);
  } else if (b.kind === 'foreman') {
    // 32 × 24 head of the station's mind
    const ph2 = b.phase === 2;
    R(0, 2, 32, 20, S(ph2 ? C.red : C.purple, 1)); R(2, 0, 28, 2, S(ph2 ? C.red : C.purple, 2)); R(0, 21, 32, 3, C.steel[0]);
    R(6, 6, 20, 12, C.black);
    const look = Math.round(Math.sin(t * 1.3) * 4);
    R(11 + look, 8, 10, 8, ph2 ? C.red[4] : C.purple[3]); R(14 + look, 10, 4, 4, C.white);
    R(-6, 8, 6, 3, C.steel[2]); R(32, 8, 6, 3, C.steel[2]);
    for (let k = 0; k < 4; k++) R(4 + k * 8, 24, 2, 4 + ((k + Math.floor(t * 4)) % 3), C.steel[1]);
    if (!ph2) {
      const k = Math.floor(t * 8) % 4;
      for (let i = -4 + k; i < 36; i += 4) { R(i, -3, 2, 1, C.purple[4]); R(i + 2, 27, 2, 1, C.purple[4]); }
      for (let j = -3 + k; j < 28; j += 4) { R(-5, j, 1, 2, C.purple[4]); R(37, j + 2, 1, 2, C.purple[4]); }
    }
  }
}
