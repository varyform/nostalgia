// HD characters and props, drawn as vectors in the 1920 × 1080 reference frame. Each takes its
// base point (feet, or the middle of a prop) and a few pose numbers; squash and stretch come in
// as `sq` (positive squashes, negative stretches). All of it is original art for Keepsake.
import { TAU, glow } from './art.js';

function eye(g, x, y, r, lx = 0, ly = 0, blink = false, lid = 0) {
  if (blink) { g.fillStyle = '#2a1626'; g.fillRect(x - r, y - 1.5, r * 2, 3); return; }
  g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(x, y, r, r * 1.2, 0, 0, TAU); g.fill();
  g.fillStyle = '#2a1626'; g.beginPath(); g.arc(x + lx * r * 0.4, y + ly * r * 0.4, r * 0.55, 0, TAU); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + lx * r * 0.4 - r * 0.2, y + ly * r * 0.4 - r * 0.28, r * 0.18, 0, TAU); g.fill();
  if (lid) { g.fillStyle = '#2a1626'; g.fillRect(x - r - 1, y - r * 1.3 + lid * r * 0.2, r * 2 + 2, 3 + lid * 2); }
}
const limb = (g, col, w, x0, y0, x1, y1, bend = 0) => {
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2, x1, y1); g.stroke();
};
function stars(g, x, y, t, r = 34) {
  for (let i = 0; i < 4; i++) {
    const a = t * 5 + (i * TAU) / 4, sx = x + Math.cos(a) * r, sy = y + Math.sin(a) * r * 0.35;
    star5(g, sx, sy, 9, '#ffe066');
  }
}
export function star5(g, x, y, r, col, rot = 0) {
  g.fillStyle = col; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = rot - Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}

// Wick the lamplighter: stovepipe hat, long green coat, striped scarf.
// pose: stand | walk | punch | fall | fly | catch | daze | cheer
export function drawWick(g, x, y, { pose = 'stand', face = 1, t = 0, run = 0, sq = 0, power = 0, punch = 0, blink = false } = {}) {
  g.save();
  g.translate(x, y);
  if (pose === 'daze') { g.translate(0, 6); g.rotate(-0.12 * face); }
  g.scale(face * (1 + sq * 0.5), 1 - sq);
  const walking = pose === 'walk', ph = walking ? Math.sin(run * 13) : 0, bob = walking ? Math.abs(Math.cos(run * 13)) * 5 : Math.sin(t * 2.2) * 1.2;
  const coat = '#2f6b4f', coatDk = '#214d39', skin = '#ffd2b0', mitt = power ? '#e8333b' : '#f2c640';
  // legs and boots
  if (pose === 'daze') {
    limb(g, '#2d2a45', 11, -8, -40, -36, -8); limb(g, '#2d2a45', 11, 8, -40, 34, -10);
    g.fillStyle = '#5a3320'; g.beginPath(); g.ellipse(-40, -6, 14, 8, -0.3, 0, TAU); g.ellipse(40, -8, 14, 8, 0.3, 0, TAU); g.fill();
    g.translate(0, 30);
  } else {
    const lift = pose === 'fall' || pose === 'fly' ? 8 : 0;
    limb(g, '#2d2a45', 11, -7, -50, -8 + ph * 16, -8 - lift, ph * 4);
    limb(g, '#2d2a45', 11, 7, -50, 8 - ph * 16, -8 - lift + (pose === 'fly' ? -6 : 0), -ph * 4);
    g.fillStyle = '#5a3320';
    g.beginPath(); g.ellipse(-4 + ph * 16, -6 - lift, 14, 8, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(12 - ph * 16, -6 - lift, 14, 8, 0, 0, TAU); g.fill();
  }
  g.translate(0, -bob);
  // the back arm
  const armY = -104;
  if (pose === 'fall' || pose === 'fly' || pose === 'cheer' || pose === 'catch') {
    const w = Math.sin(t * 18) * 8;
    limb(g, coatDk, 12, -10, armY, -30, armY - 48 + w);
    g.fillStyle = mitt; g.beginPath(); g.arc(-30, armY - 52 + w, 8, 0, TAU); g.fill();
  } else if (pose !== 'daze') {
    limb(g, coatDk, 12, -10, armY, -22 - ph * 12, -60, -6);
    g.fillStyle = mitt; g.beginPath(); g.arc(-22 - ph * 12, -58, 7.5, 0, TAU); g.fill();
  }
  // coat: long, with tails that flap as he walks
  const flap = walking ? Math.sin(run * 13 + 1) * 6 : 0;
  g.fillStyle = coat;
  g.beginPath(); g.moveTo(-18, -116); g.lineTo(18, -116); g.lineTo(26, -44); g.lineTo(4, -38 + flap * 0.3); g.lineTo(-30 - flap, -42); g.closePath(); g.fill();
  g.fillStyle = coatDk; g.beginPath(); g.moveTo(2, -112); g.lineTo(26, -44); g.lineTo(10, -40); g.closePath(); g.fill();
  g.fillStyle = '#e7b84a'; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(9, -100 + k * 18, 3, 0, TAU); g.fill(); }
  // scarf: a stripy tail streaming behind
  const tail = walking || pose === 'fall' || pose === 'fly' ? 1 : 0.3;
  g.save();
  g.fillStyle = '#d9393f'; g.beginPath(); g.roundRect(-18, -122, 38, 12, 6); g.fill();
  g.beginPath(); g.moveTo(-12, -118);
  for (let k = 0; k <= 6; k++) g.lineTo(-14 - k * 7 * tail - 4, -114 + k * 5 * (1 - tail * 0.6) + Math.sin(t * 9 + k) * 3 * tail);
  for (let k = 6; k >= 0; k--) g.lineTo(-14 - k * 7 * tail - 4, -104 + k * 5 * (1 - tail * 0.6) + Math.sin(t * 9 + k) * 3 * tail);
  g.fill();
  g.fillStyle = '#ffffff'; g.fillRect(-6, -122, 5, 12); g.fillRect(6, -122, 5, 12);
  g.restore();
  // head
  g.fillStyle = skin; g.beginPath(); g.ellipse(2, -136, 19, 21, 0, 0, TAU); g.fill();
  g.fillStyle = '#c8642e'; g.beginPath(); g.ellipse(-14, -136, 7, 12, 0.2, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,110,110,0.45)'; g.beginPath(); g.arc(11, -128, 5, 0, TAU); g.fill();
  if (pose === 'daze') {
    g.strokeStyle = '#2a1626'; g.lineWidth = 2.5;
    for (const ex of [2, 14]) { g.beginPath(); g.moveTo(ex - 4, -144); g.lineTo(ex + 4, -136); g.moveTo(ex + 4, -144); g.lineTo(ex - 4, -136); g.stroke(); }
  } else { eye(g, 4, -141, 5, 0.6, pose === 'fall' ? -0.6 : 0, blink); eye(g, 15, -141, 5, 0.6, pose === 'fall' ? -0.6 : 0, blink); }
  g.fillStyle = '#f29a86'; g.beginPath(); g.ellipse(20, -132, 8, 7, 0, 0, TAU); g.fill();
  g.strokeStyle = '#7a3324'; g.lineWidth = 2.5; g.beginPath();
  if (pose === 'daze' || pose === 'fall') g.ellipse(10, -121, 4, 3, 0, 0, TAU);
  else g.arc(9, -124, 6, 0.2, Math.PI - 0.4);
  g.stroke();
  // the stovepipe hat, a little brass flame on its band
  g.save();
  if (pose === 'daze') { g.translate(-14, -10); g.rotate(-0.5); }
  if (pose === 'fall' || pose === 'fly') g.translate(0, -8);
  g.fillStyle = '#1d1a2c'; g.beginPath(); g.roundRect(-22, -158, 50, 7, 3); g.fill();
  g.beginPath(); g.moveTo(-14, -156); g.lineTo(18, -156); g.lineTo(16, -198); g.lineTo(-12, -198); g.closePath(); g.fill();
  g.fillStyle = '#7a2a3a'; g.fillRect(-13, -166, 30, 7);
  g.fillStyle = '#f4b942'; g.beginPath(); g.moveTo(2, -164); g.quadraticCurveTo(9, -172, 3, -180); g.quadraticCurveTo(-4, -172, 2, -164); g.fill();
  g.restore();
  // the front arm: the punch (and the Haymaker's glove)
  if (pose === 'punch') {
    const reach = 26 + punch * 92;
    limb(g, coat, 13, 8, armY, reach, armY + 6);
    if (power) {
      glow(g, '#ff5a4a', reach + 10, armY + 6, 70, 0.7);
      g.fillStyle = '#e8333b'; g.beginPath(); g.ellipse(reach + 10, armY + 6, 22, 19, 0, 0, TAU); g.fill();
      g.fillStyle = '#ff8a7a'; g.beginPath(); g.ellipse(reach + 14, armY - 2, 9, 6, 0, 0, TAU); g.fill();
      g.fillStyle = '#ffffff'; g.fillRect(reach - 14, armY - 2, 6, 16);
    } else { g.fillStyle = mitt; g.beginPath(); g.arc(reach + 4, armY + 6, 10, 0, TAU); g.fill(); }
    // a whoosh behind the fist
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(reach - 30 - k * 14, armY - 8 + k * 9); g.lineTo(reach - 8 - k * 10, armY - 8 + k * 9); g.stroke(); }
  } else if (pose === 'fall' || pose === 'fly' || pose === 'cheer' || pose === 'catch') {
    const w = Math.sin(t * 18 + 2) * 8;
    limb(g, coat, 13, 10, armY, 32, armY - 50 + w);
    g.fillStyle = mitt; g.beginPath(); g.arc(32, armY - 54 + w, power ? 14 : 8, 0, TAU); g.fill();
  } else if (pose === 'daze') {
    limb(g, coat, 13, 10, armY, 34, -64); g.fillStyle = mitt; g.beginPath(); g.arc(36, -62, 8, 0, TAU); g.fill();
  } else {
    limb(g, coat, 13, 10, armY, 22 + ph * 12, -60, 6);
    g.fillStyle = mitt; g.beginPath(); g.arc(22 + ph * 12, -58, power ? 15 : 8, 0, TAU); g.fill();
    if (power) { g.fillStyle = '#ffffff'; g.fillRect(14 + ph * 12, -64, 4, 10); }
  }
  g.restore();
  if (pose === 'daze') stars(g, x, y - 170, t);
}

// Rumbold the strongman: a barrel in a striped leotard, a curl and a handlebar moustache.
// pose: walk | stand | wind | swipe | crouch | leap | fall | flung | stun | climb | flex | throw
export function drawRumbold(g, x, y, { pose = 'stand', face = 1, t = 0, run = 0, spin = 0, k = 0, wet = 0 } = {}) {
  g.save();
  g.translate(x, y);
  if (pose === 'flung') { g.translate(0, -100); g.rotate(spin * face); g.translate(0, 100); }
  let sq = 0;
  if (pose === 'crouch') sq = 0.14 + Math.sin(t * 30) * 0.02;
  if (pose === 'leap') sq = -0.12;
  if (pose === 'stun') sq = 0.18;
  const walking = pose === 'walk', ph = walking ? Math.sin(run * 10) : 0;
  const bob = walking ? Math.abs(Math.cos(run * 10)) * 7 : pose === 'flex' ? Math.sin(t * 8) * 3 : Math.sin(t * 2) * 1.5;
  g.scale(face * (1 + sq * 0.6), 1 - sq);
  const skin = '#e3a77c', skinDk = '#c4835a', red = '#c8323c', cream = '#f6e7c8';
  // legs: short, in black tights, big boots
  if (pose === 'stun') {
    limb(g, '#26202e', 20, -20, -40, -52, -8); limb(g, '#26202e', 20, 20, -40, 52, -8);
    g.fillStyle = '#5a2e1c'; g.beginPath(); g.ellipse(-58, -6, 18, 11, 0, 0, TAU); g.ellipse(58, -6, 18, 11, 0, 0, TAU); g.fill();
    g.translate(0, 26);
  } else {
    limb(g, '#26202e', 20, -18, -48, -18 + ph * 14, -10);
    limb(g, '#26202e', 20, 18, -48, 18 - ph * 14, -10);
    g.fillStyle = '#5a2e1c';
    g.beginPath(); g.ellipse(-14 + ph * 14, -8, 21, 11, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(24 - ph * 14, -8, 21, 11, 0, 0, TAU); g.fill();
  }
  g.translate(0, -bob);
  // the arm behind
  const sh = -150;
  const backArm = () => {
    if (pose === 'flex') { limb(g, skinDk, 24, -50, sh + 10, -86, sh - 20); limb(g, skinDk, 22, -86, sh - 20, -66, sh - 64); fist(-62, sh - 70, skinDk); }
    else if (pose === 'fall' || pose === 'flung' || pose === 'leap') { limb(g, skinDk, 24, -50, sh + 10, -76, sh - 60); fist(-78, sh - 66, skinDk); }
    else { limb(g, skinDk, 24, -50, sh + 10, -66 - ph * 14, sh + 84, -10); fist(-68 - ph * 14, sh + 90, skinDk); }
  };
  const fist = (fx, fy, col = skin) => { g.fillStyle = col; g.beginPath(); g.arc(fx, fy, 16, 0, TAU); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; g.beginPath(); g.arc(fx, fy, 16, -0.6, 0.6); g.stroke(); };
  backArm();
  // the barrel: red and cream stripes, a gold belt
  g.save();
  g.beginPath(); g.moveTo(-62, sh - 6); g.quadraticCurveTo(-74, -90, -40, -44); g.lineTo(40, -44); g.quadraticCurveTo(74, -90, 62, sh - 6); g.quadraticCurveTo(0, sh - 30, -62, sh - 6); g.closePath();
  g.clip();
  g.fillStyle = cream; g.fillRect(-80, sh - 40, 160, 130);
  g.fillStyle = red; for (let yy = sh - 30; yy < -40; yy += 22) g.fillRect(-80, yy, 160, 11);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(20, sh - 40, 60, 130);
  g.restore();
  g.fillStyle = '#e8b13a'; g.fillRect(-46, -62, 92, 12); g.fillStyle = '#fff0a8'; g.fillRect(-8, -64, 16, 16);
  // head: small, bald, one curl, eyebrows like hedges, the moustache
  g.fillStyle = skin; g.beginPath(); g.ellipse(6, sh - 28, 25, 27, 0, 0, TAU); g.fill();
  g.strokeStyle = '#3a2216'; g.lineWidth = 3.5; g.beginPath(); g.arc(4, sh - 58, 7, Math.PI * 0.2, Math.PI * 1.7); g.stroke();
  const angry = pose === 'wind' || pose === 'swipe' || pose === 'crouch' || pose === 'walk' || pose === 'throw';
  if (pose === 'stun') {
    g.strokeStyle = '#2a1626'; g.lineWidth = 3;
    for (const ex of [4, 20]) { g.beginPath(); g.arc(ex, sh - 34, 5, 0, TAU * 0.85); g.stroke(); }
  } else {
    eye(g, 6, sh - 34, 5.5, 0.7, 0, false); eye(g, 21, sh - 34, 5.5, 0.7, 0, false);
    g.fillStyle = '#3a2216';
    g.save(); g.translate(13, sh - 44); g.rotate(angry ? 0.18 : -0.05); g.fillRect(-16, -4, 32, 7); g.restore();
  }
  g.fillStyle = '#c26a4a'; g.beginPath(); g.ellipse(26, sh - 24, 8, 7, 0, 0, TAU); g.fill();
  // the moustache, waxed into curls
  g.fillStyle = '#3a2216';
  g.beginPath(); g.moveTo(14, sh - 16); g.quadraticCurveTo(2, sh - 24, -14, sh - 12); g.quadraticCurveTo(-20, sh - 22, -12, sh - 24);
  g.quadraticCurveTo(4, sh - 30, 20, sh - 20); g.quadraticCurveTo(34, sh - 30, 48, sh - 26); g.quadraticCurveTo(56, sh - 22, 50, sh - 14); g.quadraticCurveTo(36, sh - 22, 22, sh - 14); g.closePath(); g.fill();
  if (pose === 'flex' || pose === 'throw' || pose === 'climb') { g.strokeStyle = '#7a2a1e'; g.lineWidth = 2.5; g.beginPath(); g.arc(22, sh - 6, 6, 0.2, Math.PI - 0.2); g.stroke(); }
  // the front arm
  if (pose === 'wind') { limb(g, skin, 26, 46, sh + 6, 6, sh - 58); fist(-6, sh - 70); }
  else if (pose === 'swipe') {
    limb(g, skin, 26, 46, sh + 6, 150, sh + 40 * k, -10); fist(158, sh + 42 * k);
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 5; g.beginPath(); g.arc(46, sh + 6, 120, -0.9, 0.5); g.stroke();
  } else if (pose === 'throw') { limb(g, skin, 26, 46, sh + 6, 40 + k * 80, sh - 40 + k * 40); fist(40 + k * 80, sh - 44 + k * 40); }
  else if (pose === 'flex') { limb(g, skin, 26, 50, sh + 10, 88, sh - 20); limb(g, skin, 24, 88, sh - 20, 66, sh - 66); fist(62, sh - 72); g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(84, sh - 34, 12, 8, -0.5, 0, TAU); g.fill(); }
  else if (pose === 'fall' || pose === 'flung' || pose === 'leap' || pose === 'climb') { limb(g, skin, 26, 50, sh + 10, 78, sh - 64); fist(80, sh - 72); }
  else if (pose === 'crouch') { limb(g, skin, 26, 50, sh + 10, 74, sh + 70, 10); fist(76, sh + 76); }
  else { limb(g, skin, 26, 50, sh + 10, 66 + ph * 14, sh + 84, 10); fist(68 + ph * 14, sh + 90); }
  g.restore();
  if (pose === 'stun') stars(g, x, y - 200, t, 44);
  if (wet > 0) {
    g.fillStyle = `rgba(160,210,255,${0.7 * wet})`;
    for (let i = 0; i < 6; i++) { const dx = ((i * 37) % 120) - 60, dy = ((t * 260 + i * 53) % 160); g.beginPath(); g.ellipse(x + dx, y - 180 + dy, 3, 6, 0, 0, TAU); g.fill(); }
  }
}

// Clementine: a straw hat with a long ribbon, a polka-dot dress and a basket of keepsakes.
// pose: walk | stand | toss | cheer | worry
export function drawClementine(g, x, y, { pose = 'walk', face = 1, t = 0, run = 0, toss = 0, keep = 'heart' } = {}) {
  g.save();
  g.translate(x, y);
  const walking = pose === 'walk', ph = walking ? Math.sin(run * 9) : 0;
  const hop = pose === 'cheer' ? Math.abs(Math.sin(t * 10)) * 14 : walking ? Math.abs(Math.cos(run * 9)) * 3 : 0;
  g.scale(face, 1);
  limb(g, '#ffd2b0', 7, -6, -40, -6 + ph * 10, -6); limb(g, '#ffd2b0', 7, 6, -40, 6 - ph * 10, -6);
  g.fillStyle = '#d9393f'; g.beginPath(); g.ellipse(-4 + ph * 10, -5, 9, 5, 0, 0, TAU); g.ellipse(9 - ph * 10, -5, 9, 5, 0, 0, TAU); g.fill();
  g.translate(0, -hop);
  // dress
  const sway = Math.sin(run * 9) * (walking ? 4 : 1);
  g.fillStyle = '#ffcf4a';
  g.beginPath(); g.moveTo(-14, -98); g.lineTo(14, -98); g.lineTo(36 + sway, -34); g.quadraticCurveTo(0, -24, -36 + sway, -34); g.closePath(); g.fill();
  g.fillStyle = '#ffffff';
  for (const [dx, dy] of [[-16, -50], [2, -64], [18, -44], [-4, -40], [10, -82], [-10, -76], [24, -60]]) { g.beginPath(); g.arc(dx, dy, 3.4, 0, TAU); g.fill(); }
  g.fillStyle = '#2bb3a3'; g.fillRect(-14, -90, 28, 6);
  // arms: the basket on one, the other tossing or waving
  limb(g, '#ffd2b0', 7, -10, -94, -22, -66);
  g.fillStyle = '#b07a3a'; g.beginPath(); g.ellipse(-26, -62, 15, 10, 0, 0, Math.PI); g.fill();
  g.strokeStyle = '#b07a3a'; g.lineWidth = 3; g.beginPath(); g.arc(-26, -64, 13, Math.PI, 0); g.stroke();
  const kc = keep === 'heart' ? '#ff5d7e' : keep === 'note' ? '#5a4fcf' : '#ffe066';
  g.fillStyle = kc; g.beginPath(); g.arc(-30, -68, 5, 0, TAU); g.arc(-22, -70, 5, 0, TAU); g.fill();
  if (pose === 'toss' || pose === 'cheer') {
    const up = pose === 'toss' ? Math.sin(Math.min(1, toss) * Math.PI) : 1;
    limb(g, '#ffd2b0', 7, 10, -94, 26, -100 - up * 34); g.fillStyle = '#ffd2b0'; g.beginPath(); g.arc(26, -102 - up * 34, 5, 0, TAU); g.fill();
  } else if (pose === 'worry') { limb(g, '#ffd2b0', 7, 10, -94, 10, -116); }
  else limb(g, '#ffd2b0', 7, 10, -94, 22 - ph * 6, -64);
  // head, curls, the hat
  g.fillStyle = '#e2672e';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(-14 + (i % 3) * 3 - (i > 2 ? 4 : 0), -110 + i * 4, 7, 0, TAU); g.fill(); }
  g.fillStyle = '#ffd2b0'; g.beginPath(); g.ellipse(2, -116, 15, 16, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,110,130,0.55)'; g.beginPath(); g.arc(10, -110, 4, 0, TAU); g.fill();
  const bl = Math.sin(t * 1.1) > 0.985;
  if (pose === 'cheer') { g.strokeStyle = '#2a1626'; g.lineWidth = 2.5; g.beginPath(); g.arc(5, -118, 3.5, Math.PI, 0); g.arc(14, -118, 3.5, Math.PI, 0); g.stroke(); }
  else { eye(g, 5, -119, 3.8, 0.5, pose === 'worry' ? 0.7 : 0.3, bl); eye(g, 14, -119, 3.8, 0.5, pose === 'worry' ? 0.7 : 0.3, bl); }
  g.strokeStyle = '#a3323a'; g.lineWidth = 2; g.beginPath();
  if (pose === 'worry') g.ellipse(9, -106, 3, 2.5, 0, 0, TAU); else g.arc(8, -108, 4, 0.2, Math.PI - 0.2);
  g.stroke();
  g.fillStyle = '#f3d38a'; g.beginPath(); g.ellipse(0, -130, 34, 8, -0.06, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(0, -136, 17, 12, 0, Math.PI, 0); g.fill();
  g.fillStyle = '#2bb3a3'; g.fillRect(-17, -138, 34, 5);
  g.beginPath(); g.moveTo(-16, -136); g.quadraticCurveTo(-40, -128 + Math.sin(t * 4) * 6, -54, -112 + Math.sin(t * 4 + 1) * 8); g.lineTo(-50, -108); g.quadraticCurveTo(-36, -124, -16, -131); g.fill();
  g.restore();
}

// the pot-thrower at her window (harbour) or the sweep in his dormer (roofs); wind 0..1
export function drawThrower(g, x, y, { kind = 'pinch', dir = -1, wind = 0, t = 0 } = {}) {
  g.save(); g.translate(x, y); g.scale(dir < 0 ? 1 : -1, 1);
  const lean = wind * 8;
  if (kind === 'pinch') {
    g.fillStyle = '#7d4b8c'; g.beginPath(); g.roundRect(-30 - lean, -20, 60, 50, 14); g.fill();
    g.fillStyle = '#ffd9c0'; g.beginPath(); g.ellipse(-lean, -42, 20, 22, 0, 0, TAU); g.fill();
    g.fillStyle = '#c9c6d6'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(-18 + i * 9 - lean, -64, 6, 0, TAU); g.fill(); }
    g.fillStyle = '#ff9db0'; for (let i = 0; i < 3; i++) g.fillRect(-14 + i * 12 - lean, -70, 7, 5);
    eye(g, -8 - lean, -46, 3.5, -0.6, 0, false, 1); eye(g, 5 - lean, -46, 3.5, -0.6, 0, false, 1);
    g.strokeStyle = '#7a2a3a'; g.lineWidth = 2.5; g.beginPath(); g.arc(-2 - lean, -26, 6, Math.PI + 0.4, -0.4); g.stroke();
  } else {
    g.fillStyle = '#26232e'; g.beginPath(); g.roundRect(-28 - lean, -20, 56, 50, 12); g.fill();
    g.fillStyle = '#8a7a72'; g.beginPath(); g.ellipse(-lean, -42, 19, 21, 0, 0, TAU); g.fill();
    g.fillStyle = '#3a3440'; g.beginPath(); g.ellipse(-lean, -60, 24, 8, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(-lean + 2, -64, 18, 9, 0, Math.PI, 0); g.fill();
    eye(g, -8 - lean, -44, 4, -0.6, 0, false); eye(g, 5 - lean, -44, 4, -0.6, 0, false);
    g.strokeStyle = '#2a1626'; g.lineWidth = 2.5; g.beginPath(); g.arc(-2 - lean, -30, 5, 0.3, Math.PI - 0.3); g.stroke();
    g.strokeStyle = '#6b4a2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(24, 20); g.lineTo(34, -70); g.stroke();
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(34, -78, 12, 0, TAU); g.fill();
  }
  // the next thing to throw, raised when winding up
  const hy = -20 - wind * 60, hx = -36 - lean - wind * 6;
  g.strokeStyle = kind === 'pinch' ? '#ffd9c0' : '#8a7a72'; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-20 - lean, -10); g.lineTo(hx, hy + 10); g.stroke();
  if (wind > 0) drawShot(g, hx, hy, kind === 'pinch' ? 'pot' : 'soot', t, 0);
  g.restore();
}

// pots, bottles and soot bundles in flight
export function drawShot(g, x, y, kind, t, spin) {
  g.save(); g.translate(x, y); g.rotate(spin);
  if (kind === 'pot') {
    g.fillStyle = '#c4622d'; g.beginPath(); g.moveTo(-16, -12); g.lineTo(16, -12); g.lineTo(11, 16); g.lineTo(-11, 16); g.closePath(); g.fill();
    g.fillStyle = '#e07b40'; g.fillRect(-18, -16, 36, 8);
    g.fillStyle = '#3fa34d'; g.beginPath(); g.ellipse(-6, -24, 6, 12, -0.4, 0, TAU); g.ellipse(6, -24, 6, 12, 0.4, 0, TAU); g.fill();
    g.fillStyle = '#ff6f91'; g.beginPath(); g.arc(0, -32, 6, 0, TAU); g.fill();
  } else if (kind === 'bottle') {
    g.fillStyle = 'rgba(70,170,90,0.9)'; g.beginPath(); g.roundRect(-9, -8, 18, 30, 6); g.fill(); g.fillRect(-4, -22, 8, 16);
    g.fillStyle = '#c8a050'; g.fillRect(-5, -26, 10, 6);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-5, -4, 3, 20);
  } else {
    g.fillStyle = '#1b1b22'; g.beginPath(); g.arc(0, 0, 17, 0, TAU); g.fill();
    g.fillStyle = '#3a3a46'; g.beginPath(); g.arc(-5, -5, 6, 0, TAU); g.fill();
    g.fillStyle = 'rgba(60,60,70,0.5)'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-18 - i * 10, Math.sin(t * 9 + i) * 5, 8 - i * 2, 0, TAU); g.fill(); }
  }
  g.restore();
}

// the magpie (park) or the owl (roofs), wings flapping
export function drawBird(g, x, y, { kind = 'magpie', dir = 1, t = 0, hit = false } = {}) {
  g.save(); g.translate(x, y); g.scale(dir, 1);
  if (hit) g.rotate(Math.sin(t * 20) * 0.6);
  const flap = Math.sin(t * 18);
  if (kind === 'magpie') {
    g.fillStyle = '#141420'; g.beginPath(); g.moveTo(-20, 2); g.lineTo(-62, -4); g.lineTo(-62, 8); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(0, 0, 26, 15, 0, 0, TAU); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(2, 6, 16, 8, 0, 0, TAU); g.fill();
    g.fillStyle = '#141420'; g.beginPath(); g.arc(24, -6, 11, 0, TAU); g.fill();
    g.fillStyle = '#f2c640'; g.beginPath(); g.moveTo(33, -8); g.lineTo(46, -4); g.lineTo(33, -1); g.fill();
    eye(g, 26, -9, 3.2, 1, 0, false);
    g.fillStyle = '#2c3f8a'; g.beginPath(); g.moveTo(-8, -4); g.quadraticCurveTo(-4, -40 * flap, 22, -36 * flap); g.lineTo(10, -2); g.fill();
  } else {
    g.fillStyle = '#7a5a3a'; g.beginPath(); g.ellipse(0, 0, 24, 22, 0, 0, TAU); g.fill();
    g.fillStyle = '#c9a77a'; g.beginPath(); g.ellipse(4, 6, 14, 14, 0, 0, TAU); g.fill();
    g.fillStyle = '#5a3f26'; g.beginPath(); g.moveTo(-6, -4); g.quadraticCurveTo(-30, -44 * flap, -50, -20 * flap); g.lineTo(-10, 8); g.fill();
    g.beginPath(); g.moveTo(6, -4); g.quadraticCurveTo(30, -44 * flap, 50, -20 * flap); g.lineTo(10, 8); g.fill();
    g.fillStyle = '#ffd04a'; g.beginPath(); g.arc(-6, -8, 7, 0, TAU); g.arc(10, -8, 7, 0, TAU); g.fill();
    g.fillStyle = '#1a1010'; g.beginPath(); g.arc(-4, -8, 3.5, 0, TAU); g.arc(12, -8, 3.5, 0, TAU); g.fill();
    g.fillStyle = '#e0a030'; g.beginPath(); g.moveTo(2, -2); g.lineTo(6, 6); g.lineTo(9, -2); g.fill();
  }
  g.restore();
}

// a keepsake: a folded paper heart, a music note or a falling star
export function drawKeep(g, x, y, kind, t, { a = 1, s = 1 } = {}) {
  g.save(); g.translate(x, y); g.scale(s, s); g.globalAlpha *= a;
  if (kind === 'heart') {
    const sx = Math.cos(t * 3.2);
    glow(g, '#ff5d7e', 0, 0, 44, 0.45);
    g.scale(Math.max(0.15, Math.abs(sx)), 1);
    g.fillStyle = sx > 0 ? '#ff5d7e' : '#ff8fa6';
    g.beginPath(); g.moveTo(0, 18); g.bezierCurveTo(-34, -4, -18, -28, 0, -12); g.bezierCurveTo(18, -28, 34, -4, 0, 18); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(0, 18); g.lineTo(0, -12); g.bezierCurveTo(18, -28, 34, -4, 0, 18); g.fill();
  } else if (kind === 'note') {
    const hue = ['#7b5cff', '#ff7a3d', '#13b3a5'][Math.floor(t * 0.8) % 3];
    glow(g, hue, 0, -6, 46, 0.5);
    g.rotate(Math.sin(t * 4) * 0.25);
    g.fillStyle = hue; g.beginPath(); g.ellipse(-6, 10, 11, 8, -0.4, 0, TAU); g.fill();
    g.fillRect(3, -22, 5, 32);
    g.beginPath(); g.moveTo(8, -22); g.quadraticCurveTo(24, -14, 20, 2); g.quadraticCurveTo(18, -10, 8, -12); g.fill();
  } else {
    glow(g, '#ffe066', 0, 0, 56, 0.7);
    star5(g, 0, 0, 18, '#fff3a6', t * 2);
    star5(g, 0, 0, 10, '#ffffff', t * 2);
  }
  g.restore();
}

// the Haymaker glove waiting on its little stand
export function drawGlove(g, x, y, t) {
  const bob = Math.sin(t * 3) * 6;
  glow(g, '#ff5a4a', x, y - 52 + bob, 70, 0.6 + 0.2 * Math.sin(t * 6));
  g.fillStyle = '#6b4226'; g.fillRect(x - 18, y - 22, 36, 22); g.fillStyle = '#8a5a34'; g.fillRect(x - 22, y - 26, 44, 6);
  g.save(); g.translate(x, y - 54 + bob); g.rotate(Math.sin(t * 2) * 0.15);
  g.fillStyle = '#e8333b'; g.beginPath(); g.ellipse(0, 0, 22, 19, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(-16, 6, 9, 8, 0, 0, TAU); g.fill();
  g.fillStyle = '#ff8a7a'; g.beginPath(); g.ellipse(4, -8, 9, 5, 0, 0, TAU); g.fill();
  g.fillStyle = '#ffffff'; g.fillRect(-6, 14, 18, 8);
  g.restore();
  for (let i = 0; i < 3; i++) { const a = t * 2 + (i * TAU) / 3; star5(g, x + Math.cos(a) * 40, y - 54 + Math.sin(a) * 22, 5, '#ffe066'); }
}

// the crate on the crane's hook (or falling), rope up to the jib at y = 150
export function drawCrate(g, x, y, { hanging = true, spin = 0 } = {}) {
  if (hanging) {
    g.strokeStyle = '#3a2418'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, 150); g.lineTo(x, y - 30); g.stroke();
    g.strokeStyle = '#8a8a90'; g.lineWidth = 4; g.beginPath(); g.arc(x, y - 36, 8, 0.2, Math.PI * 1.6); g.stroke();
  }
  g.save(); g.translate(x, y); g.rotate(spin);
  g.fillStyle = '#b8803f'; g.fillRect(-30, -30, 60, 60);
  g.strokeStyle = '#6e4420'; g.lineWidth = 5; g.strokeRect(-28, -28, 56, 56);
  g.beginPath(); g.moveTo(-28, -28); g.lineTo(28, 28); g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(4, -28, 24, 56);
  g.restore();
}
// the bouncy awning: a striped canvas between two posts; squash 0..1 after a bounce
export function drawSpring(g, x, y, squash, t) {
  const dip = 10 + squash * 26 * Math.cos(t * 30) * squash;
  g.fillStyle = '#5a3a22'; g.fillRect(x - 62, y - 50, 8, 50); g.fillRect(x + 54, y - 50, 8, 50);
  g.save(); g.beginPath(); g.moveTo(x - 66, y - 52); g.quadraticCurveTo(x, y - 52 + dip * 2, x + 66, y - 52); g.lineTo(x + 66, y - 40); g.quadraticCurveTo(x, y - 40 + dip * 2, x - 66, y - 40); g.closePath(); g.clip();
  for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#ffffff' : '#ff8a3d'; g.fillRect(x - 66 + k * 17, y - 80, 17, 80); }
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.8)'; g.font = '700 22px sans-serif'; g.textAlign = 'center';
  g.fillText('▲', x, y - 70 - Math.abs(Math.sin(t * 3)) * 8); g.textAlign = 'left';
}
// the sandbag on its rope from the hoist
export function drawSandbag(g, px, py, bx, by, th) {
  g.strokeStyle = '#d8c89a'; g.lineWidth = 3; g.beginPath(); g.moveTo(px, py); g.lineTo(bx, by); g.stroke();
  g.save(); g.translate(bx, by); g.rotate(-th);
  g.fillStyle = '#a88a5a'; g.beginPath(); g.moveTo(-8, -10); g.quadraticCurveTo(-34, 10, -26, 40); g.quadraticCurveTo(0, 52, 26, 40); g.quadraticCurveTo(34, 10, 8, -10); g.closePath(); g.fill();
  g.fillStyle = '#7a5f36'; g.fillRect(-10, -12, 20, 8);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.font = '800 18px sans-serif'; g.textAlign = 'center'; g.fillText('50', 0, 30); g.textAlign = 'left';
  g.restore();
}
// a lamplighter's top hat: the lives on the HUD
export function drawHat(g, x, y, s = 1) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = '#1d1a2c'; g.beginPath(); g.roundRect(-20, 0, 40, 6, 3); g.fill();
  g.beginPath(); g.moveTo(-12, 2); g.lineTo(12, 2); g.lineTo(10, -30); g.lineTo(-10, -30); g.closePath(); g.fill();
  g.fillStyle = '#7a2a3a'; g.fillRect(-11, -8, 22, 6);
  g.fillStyle = '#f4b942'; g.beginPath(); g.arc(0, -5, 3, 0, TAU); g.fill();
  g.restore();
}
