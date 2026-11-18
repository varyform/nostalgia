// HD characters and props, drawn as vectors in the 1920 × 1080 reference frame. Each takes a
// base point (feet or glass bottom) and a few pose numbers; squash and stretch come in as `sq`
// (positive squashes, negative stretches). All of it is original art for Brimful.
import { glow, shade } from './art.js';

const TAU = Math.PI * 2;
function eye(g, x, y, r, lookX = 0, lookY = 0, blink = false) {
  if (blink) { g.fillStyle = '#2b1b2e'; g.fillRect(x - r, y - 1.5, r * 2, 3); return; }
  g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(x, y, r, r * 1.15, 0, 0, TAU); g.fill();
  g.fillStyle = '#2b1b2e'; g.beginPath(); g.arc(x + lookX * r * 0.4, y + lookY * r * 0.4, r * 0.55, 0, TAU); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + lookX * r * 0.4 - r * 0.2, y + lookY * r * 0.4 - r * 0.25, r * 0.18, 0, TAU); g.fill();
}

// Pip: paper cap, bow tie, striped apron. pose: 'stand' | 'walk' | 'pour' | 'cheer' | 'catch' | 'down'
export function drawPip(g, x, feet, { pose = 'stand', face = 1, t = 0, sq = 0, run = 0, blink = false } = {}) {
  g.save();
  g.translate(x, feet);
  if (pose === 'down') {
    g.rotate(-Math.PI / 2 * face); g.translate(0, 18);
  }
  g.scale(face * (1 + sq * 0.5), 1 - sq);
  const step = pose === 'walk' ? Math.sin(run * 14) : 0, bob = pose === 'walk' ? Math.abs(Math.sin(run * 14)) * 5 : Math.sin(t * 2.4) * 1.5;
  // legs and shoes
  g.fillStyle = '#2f3e78';
  g.beginPath(); g.roundRect(-16 + step * 6, -40, 13, 36, 5); g.fill();
  g.beginPath(); g.roundRect(4 - step * 6, -40, 13, 36, 5); g.fill();
  g.fillStyle = '#20182a';
  g.beginPath(); g.ellipse(-9 + step * 8, -4, 13, 7, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(12 - step * 8, -4, 13, 7, 0, 0, TAU); g.fill();
  g.translate(0, -bob);
  // body: white shirt, striped apron
  g.fillStyle = '#f7f3ee'; g.beginPath(); g.roundRect(-26, -96, 52, 62, 20); g.fill();
  g.save(); g.beginPath(); g.roundRect(-20, -78, 40, 46, [6, 6, 14, 14]); g.clip();
  g.fillStyle = '#ffffff'; g.fillRect(-20, -78, 40, 46);
  g.fillStyle = '#e84a5f'; for (let k = -20; k < 20; k += 10) g.fillRect(k, -78, 5, 46);
  g.restore();
  g.fillStyle = '#e84a5f'; g.beginPath(); g.moveTo(-9, -94); g.lineTo(0, -89); g.lineTo(-9, -84); g.fill(); g.beginPath(); g.moveTo(9, -94); g.lineTo(0, -89); g.lineTo(9, -84); g.fill();
  // arms
  g.strokeStyle = '#f7f3ee'; g.lineWidth = 12; g.lineCap = 'round';
  const arm = (sx, ex, ey) => { g.beginPath(); g.moveTo(sx, -86); g.quadraticCurveTo((sx + ex) / 2, (ey - 86) / 2 - 4, ex, ey); g.stroke(); g.fillStyle = '#ffd7b5'; g.beginPath(); g.arc(ex, ey, 7, 0, TAU); g.fill(); };
  if (pose === 'pour') { arm(20, 40, -128); arm(-20, -30, -60); }
  else if (pose === 'cheer' || pose === 'catch') { const w = Math.sin(t * 16) * 6; arm(20, 38, -140 + w); arm(-20, -38, -140 - w); }
  else { const s = pose === 'walk' ? step * 10 : 0; arm(20, 30 + s, -50); arm(-20, -30 - s, -50); }
  // head
  g.fillStyle = '#ffd7b5'; g.beginPath(); g.ellipse(0, -122, 30, 28, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,120,120,0.45)'; g.beginPath(); g.arc(-17, -112, 6, 0, TAU); g.arc(19, -112, 6, 0, TAU); g.fill();
  eye(g, -9, -125, 6, 0.6, 0, blink); eye(g, 11, -125, 6, 0.6, 0, blink);
  g.strokeStyle = '#7a3b2e'; g.lineWidth = 3;
  g.beginPath(); if (pose === 'cheer') g.arc(3, -112, 8, 0.1, Math.PI - 0.1); else g.arc(3, -114, 6, 0.3, Math.PI - 0.3); g.stroke();
  // paper cap
  g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(-30, -138); g.lineTo(30, -138); g.lineTo(20, -160); g.lineTo(-22, -160); g.closePath(); g.fill();
  g.fillStyle = '#e84a5f'; g.fillRect(-28, -146, 56, 5);
  g.restore();
}

// a customer: a bean with a venue hat. state: walk | wait | pushed | drink | look | grab
export function drawCustomer(g, x, base, { id = 'pier', kind = 0, state = 'wait', t = 0, bob = 0, catchT = 0, look = 0, drink = 0, A, drinkDraw } = {}) {
  const body = A.shirt[kind % A.shirt.length], skin = ['#ffd7b5', '#e8b48a', '#c68b5e', '#8d5a3b'][(kind * 7) % 4];
  const walking = state === 'walk';
  const ph = walking ? Math.sin(bob * 9) : Math.sin(bob * 2) * 0.3;
  let sq = walking ? Math.abs(ph) * 0.06 : ph * 0.02;
  if (catchT > 0) sq = -0.12 * (catchT / 0.3);
  let lean = state === 'pushed' ? 0.18 : 0;
  if (state === 'grab') lean = -0.25;
  g.save();
  g.translate(x, base - (walking ? Math.abs(ph) * 6 : 0));
  g.rotate(lean);
  g.scale(1 + sq * 0.6, 1 - sq);
  // bean body and head in one
  g.fillStyle = body; g.beginPath(); g.roundRect(-30, -96, 60, 110, [30, 30, 12, 12]); g.fill();
  g.fillStyle = shade(body, -0.15); g.fillRect(-30, -20, 60, 34);
  g.fillStyle = skin; g.beginPath(); g.ellipse(0, -92, 27, 26, 0, 0, TAU); g.fill();
  // face looks toward Pip (left), up at a show, or closes while drinking
  const lx = look > 0.5 ? 0 : -1, ly = look > 0.5 ? -1 : 0;
  if (state === 'drink') { g.strokeStyle = '#2b1b2e'; g.lineWidth = 3; g.beginPath(); g.arc(-10, -96, 5, Math.PI, 0); g.stroke(); g.beginPath(); g.arc(8, -96, 5, Math.PI, 0); g.stroke(); }
  else { const bl = Math.sin(t * 1.3 + kind * 2) > 0.985; eye(g, -10, -96, 6.5, lx, ly, bl); eye(g, 9, -96, 6.5, lx, ly, bl); }
  g.strokeStyle = '#6a2e2a'; g.lineWidth = 3;
  g.beginPath();
  if (state === 'grab') { g.ellipse(-2, -78, 7, 5, 0, 0, TAU); }
  else if (look > 0.5 || state === 'pushed') g.arc(-2, -82, 6, 0.2, Math.PI - 0.2);
  else { g.moveTo(-8, -80); g.lineTo(4, -80); }
  g.stroke();
  drawHat(g, id, kind % 3, t);
  // arms
  g.strokeStyle = shade(body, -0.1); g.lineWidth = 11; g.lineCap = 'round';
  if (state === 'drink') { g.beginPath(); g.moveTo(-20, -50); g.lineTo(-30, -78); g.stroke(); drinkDraw?.(-38, -64, drink); }
  else if (state === 'pushed') { g.beginPath(); g.moveTo(-22, -50); g.lineTo(-44, -40); g.stroke(); drinkDraw?.(-50, -30, 1); }
  else if (state === 'grab') { g.beginPath(); g.moveTo(-22, -54); g.lineTo(-56, -84); g.moveTo(22, -54); g.lineTo(50, -86); g.stroke(); }
  else { g.beginPath(); g.moveTo(-24, -46); g.lineTo(-32, -24 + ph * 4); g.moveTo(24, -46); g.lineTo(32, -24 - ph * 4); g.stroke(); }
  g.restore();
  if (look > 0.5) {
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.font = '700 26px sans-serif';
    g.fillText('♪', x + 16, base - 132 - Math.abs(Math.sin(t * 4 + kind)) * 10);
  }
}
function drawHat(g, id, k, t) {
  if (id === 'pier') {
    if (k === 0) { g.fillStyle = '#ffe28a'; g.beginPath(); g.ellipse(0, -112, 44, 9, 0, 0, TAU); g.fill(); g.beginPath(); g.ellipse(0, -118, 24, 16, 0, Math.PI, 0); g.fill(); g.fillStyle = '#ff6f91'; g.fillRect(-24, -118, 48, 5); }
    else if (k === 1) { g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(-24, -124, 48, 16, 6); g.fill(); g.fillStyle = '#1d3557'; g.fillRect(-26, -110, 52, 5); }
    else { g.fillStyle = '#1b1b2a'; g.beginPath(); g.roundRect(-22, -102, 19, 10, 4); g.roundRect(2, -102, 19, 10, 4); g.fill(); g.fillRect(-4, -99, 7, 3); }
  } else if (id === 'lodge') {
    if (k === 0) { g.fillStyle = '#e63946'; g.beginPath(); g.ellipse(0, -110, 26, 18, 0, Math.PI, 0); g.fill(); g.fillStyle = '#ffffff'; g.fillRect(-27, -112, 54, 8); g.beginPath(); g.arc(0, -130, 8, 0, TAU); g.fill(); }
    else if (k === 1) { g.fillStyle = '#f1faee'; g.beginPath(); g.arc(-26, -94, 9, 0, TAU); g.arc(26, -94, 9, 0, TAU); g.fill(); g.strokeStyle = '#a8dadc'; g.lineWidth = 4; g.beginPath(); g.arc(0, -98, 27, Math.PI, 0); g.stroke(); }
    else { g.fillStyle = '#8d6e63'; g.beginPath(); g.ellipse(0, -112, 28, 16, 0, Math.PI, 0); g.fill(); g.fillStyle = '#d7ccc8'; g.fillRect(-29, -114, 58, 7); }
  } else if (id === 'market') {
    if (k === 0) { g.fillStyle = '#ffd166'; g.fillRect(-27, -112, 54, 7); }
    else if (k === 1) { g.fillStyle = '#e9c46a'; g.beginPath(); g.moveTo(-42, -108); g.lineTo(0, -134); g.lineTo(42, -108); g.closePath(); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 2; g.stroke(); }
    else { g.fillStyle = '#5e548e'; g.beginPath(); g.ellipse(0, -106, 30, 22, 0, Math.PI, 0); g.fill(); g.beginPath(); g.moveTo(-22, -118); g.lineTo(-14, -136); g.lineTo(-6, -124); g.moveTo(22, -118); g.lineTo(14, -136); g.lineTo(6, -124); g.fill(); }
  } else {
    if (k === 0) { g.strokeStyle = 'rgba(200,255,255,0.75)'; g.lineWidth = 3; g.beginPath(); g.arc(0, -94, 38, 0, TAU); g.stroke(); g.fillStyle = 'rgba(160,240,255,0.14)'; g.fill(); g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.ellipse(-16, -112, 8, 4, -0.6, 0, TAU); g.fill(); }
    else if (k === 1) { g.strokeStyle = '#cbd5e1'; g.lineWidth = 3; g.beginPath(); g.moveTo(-12, -116); g.lineTo(-18, -140); g.moveTo(12, -116); g.lineTo(18, -140); g.stroke(); g.fillStyle = Math.sin(t * 6) > 0 ? '#ff6b9d' : '#46f0ff'; g.beginPath(); g.arc(-18, -142, 5, 0, TAU); g.arc(18, -142, 5, 0, TAU); g.fill(); }
    else { g.fillStyle = 'rgba(70,240,255,0.75)'; g.beginPath(); g.roundRect(-25, -104, 50, 14, 7); g.fill(); }
  }
}

// a venue's glass, bottom centre at x, y; fill 0..1. `full` draws the topping too
export function drawGlass(g, id, A, x, y, fill, { full = fill >= 1, tilt = 0, s = 1 } = {}) {
  g.save(); g.translate(x, y); g.rotate(tilt); g.scale(s, s);
  const shape = {
    pier: () => { g.beginPath(); g.moveTo(-17, -58); g.lineTo(17, -58); g.lineTo(11, -4); g.lineTo(-11, -4); g.closePath(); },
    lodge: () => { g.beginPath(); g.roundRect(-18, -46, 36, 44, [4, 4, 10, 10]); },
    market: () => { g.beginPath(); g.moveTo(-16, -56); g.lineTo(16, -56); g.lineTo(13, -2); g.lineTo(-13, -2); g.closePath(); },
    moon: () => { g.beginPath(); g.moveTo(-18, -54); g.quadraticCurveTo(-20, -16, -8, -8); g.lineTo(8, -8); g.quadraticCurveTo(20, -16, 18, -54); g.closePath(); },
  }[id];
  const topY = id === 'lodge' ? -46 : id === 'moon' ? -54 : -57, botY = id === 'moon' ? -8 : -3;
  // contents, clipped to the glass
  if (fill > 0) {
    g.save(); shape(); g.clip();
    const ly = botY - (botY - topY) * Math.min(1, fill);
    const gr = g.createLinearGradient(0, ly, 0, botY); gr.addColorStop(0, A.drink); gr.addColorStop(1, A.drinkDark);
    g.fillStyle = gr; g.fillRect(-24, ly, 48, botY - ly + 4);
    if (id === 'market') { g.fillStyle = '#2b1810'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(-8 + (i % 3) * 8, -10 - Math.floor(i / 3) * 7, 3.4, 0, TAU); g.fill(); } }
    if (id === 'moon') { g.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-6 + i * 4, ly + 8 + ((i * 7) % 20), 2, 0, TAU); g.fill(); } }
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-24, ly, 48, 3);
    g.restore();
  }
  // the glass itself
  shape();
  g.fillStyle = A.glass; g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2.5; g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(-12, topY + 6, 4, (botY - topY) * 0.6);
  if (id === 'lodge') { g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5; g.beginPath(); g.arc(19, -26, 11, -Math.PI / 2, Math.PI / 2); g.stroke(); }
  if (full) {
    if (id === 'pier') { g.fillStyle = A.foam; g.beginPath(); g.arc(-8, topY, 10, 0, TAU); g.arc(8, topY, 10, 0, TAU); g.arc(0, topY - 9, 11, 0, TAU); g.fill(); g.fillStyle = '#e8213f'; g.beginPath(); g.arc(3, topY - 22, 6, 0, TAU); g.fill(); g.strokeStyle = '#2f6b2f'; g.lineWidth = 2; g.beginPath(); g.moveTo(3, topY - 27); g.quadraticCurveTo(6, topY - 36, 11, topY - 37); g.stroke(); }
    else if (id === 'lodge') { g.fillStyle = A.foam; for (let i = 0; i < 3; i++) { g.beginPath(); g.roundRect(-14 + i * 10, topY - 9 - (i % 2) * 4, 11, 11, 3); g.fill(); } }
    else if (id === 'market') { g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.ellipse(0, topY, 18, 5, 0, 0, TAU); g.fill(); g.strokeStyle = '#ff5d8f'; g.lineWidth = 5; g.beginPath(); g.moveTo(5, topY + 6); g.lineTo(10, topY - 30); g.stroke(); }
    else { g.fillStyle = '#fff2f8'; g.beginPath(); g.arc(0, topY - 6, 14, Math.PI, 0); g.fill(); g.fillStyle = '#ff9ccf'; g.beginPath(); g.arc(-4, topY - 12, 4, 0, TAU); g.fill(); }
  }
  g.restore();
}

export function drawCoin(g, x, y, t) {
  const w = Math.abs(Math.cos(t * 4)) * 14 + 3;
  g.fillStyle = '#b7791f'; g.beginPath(); g.ellipse(x, y, w, 15, 0, 0, TAU); g.fill();
  g.fillStyle = '#ffd34d'; g.beginPath(); g.ellipse(x, y - 1, w * 0.82, 12, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x - w * 0.3, y - 8, Math.max(1, w * 0.2), 10);
  glow(g, '#ffd34d', x, y, 40, 0.5);
}

// the tip's street show: performers parade across the top. p 0..1 through the show
export function drawShow(g, kind, p, t) {
  const x = -260 + p * 2500, base = 200;
  g.save();
  if (kind === 'band') {
    performer(g, x, base, '#ffd166', t, 0, () => { // tuba
      g.fillStyle = '#f2b134'; g.beginPath(); g.arc(20, -60, 24, 0, TAU); g.fill(); g.fillStyle = '#ffe08a'; g.beginPath(); g.arc(20, -60, 14, 0, TAU); g.fill();
      g.strokeStyle = '#f2b134'; g.lineWidth = 8; g.beginPath(); g.arc(-4, -70, 20, Math.PI * 0.5, Math.PI * 1.6); g.stroke();
    });
    performer(g, x - 130, base, '#ef476f', t + 0.3, 1, () => { // drum
      g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(-30, -64, 60, 40, 8); g.fill(); g.fillStyle = '#e63946'; g.fillRect(-30, -64, 60, 8); g.fillRect(-30, -32, 60, 8);
      const hit = Math.sin(t * 16) * 12; g.strokeStyle = '#6b4226'; g.lineWidth = 5; g.beginPath(); g.moveTo(-20, -92 + hit); g.lineTo(-6, -66); g.moveTo(20, -92 - hit); g.lineTo(6, -66); g.stroke();
    });
    for (let i = 0; i < 4; i++) note(g, x + 60 + i * 34, base - 150 - Math.abs(Math.sin(t * 5 + i)) * 26, i);
  } else if (kind === 'juggler') {
    // a snowman juggler in a scarf
    const bx = x, by = base;
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(bx, by - 40, 40, 0, TAU); g.arc(bx, by - 104, 30, 0, TAU); g.fill();
    g.fillStyle = '#e63946'; g.fillRect(bx - 30, by - 84, 60, 10); g.fillRect(bx + 10, by - 80, 10, 34);
    g.fillStyle = '#2b1b2e'; g.beginPath(); g.arc(bx - 10, by - 110, 4, 0, TAU); g.arc(bx + 10, by - 110, 4, 0, TAU); g.fill();
    g.fillStyle = '#ff8c42'; g.beginPath(); g.moveTo(bx, by - 102); g.lineTo(bx + 26, by - 98); g.lineTo(bx, by - 94); g.fill();
    g.fillStyle = '#2b1b2e'; g.fillRect(bx - 24, by - 140, 48, 8); g.fillRect(bx - 16, by - 168, 32, 30);
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + (i * TAU) / 3;
      g.fillStyle = '#e8f6ff'; g.beginPath(); g.arc(bx + Math.cos(a) * 60, by - 190 + Math.sin(a) * 40 - Math.abs(Math.sin(a)) * 20, 12, 0, TAU); g.fill();
    }
  } else if (kind === 'dragon') {
    // a paper dragon on poles, its body rippling behind the head
    for (let i = 7; i >= 0; i--) {
      const sx = x - i * 64, sy = base - 90 + Math.sin(t * 6 - i * 0.8) * 22;
      g.strokeStyle = '#6b4226'; g.lineWidth = 5; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, base); g.stroke();
      if (i === 0) continue;
      g.fillStyle = i % 2 ? '#e8493f' : '#ffcf5a'; g.beginPath(); g.ellipse(sx, sy, 40, 30, 0, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(sx, sy - 12, 26, 8, 0, 0, TAU); g.fill();
    }
    const hy = base - 100 + Math.sin(t * 6) * 22;
    g.fillStyle = '#e8493f'; g.beginPath(); g.roundRect(x - 36, hy - 40, 86, 70, 22); g.fill();
    g.fillStyle = '#ffcf5a'; g.beginPath(); g.moveTo(x - 30, hy - 40); g.lineTo(x - 44, hy - 76); g.lineTo(x - 10, hy - 44); g.fill(); g.beginPath(); g.moveTo(x + 10, hy - 40); g.lineTo(x + 4, hy - 80); g.lineTo(x + 30, hy - 42); g.fill();
    eye(g, x + 22, hy - 14, 10, 1, 0);
    g.fillStyle = '#ffffff'; g.fillRect(x + 20, hy + 14, 34, 8);
    glow(g, '#ff8a3c', x, hy, 180, 0.35);
  } else {
    // a little rover dancing on its wheels
    const hop = Math.abs(Math.sin(t * 7)) * 20, tilt = Math.sin(t * 7) * 0.25;
    g.translate(x, base - hop); g.rotate(tilt);
    g.fillStyle = '#cbd5e1'; g.beginPath(); g.roundRect(-50, -80, 100, 54, 14); g.fill();
    g.fillStyle = '#0d1020'; g.beginPath(); g.roundRect(-36, -70, 72, 30, 10); g.fill();
    g.fillStyle = '#46f0ff'; g.beginPath(); g.arc(-14, -55, 8, 0, TAU); g.arc(14, -55, 8, 0, TAU); g.fill();
    g.strokeStyle = '#cbd5e1'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, -80); g.lineTo(0, -112); g.stroke();
    g.fillStyle = Math.sin(t * 9) > 0 ? '#ff6b9d' : '#ffd166'; g.beginPath(); g.arc(0, -116, 8, 0, TAU); g.fill();
    g.fillStyle = '#334155'; for (const wx of [-36, 0, 36]) { g.beginPath(); g.arc(wx, -18, 16, 0, TAU); g.fill(); }
    g.strokeStyle = '#cbd5e1'; g.lineWidth = 7; g.lineCap = 'round'; const w = Math.sin(t * 14) * 30;
    g.beginPath(); g.moveTo(-48, -60); g.lineTo(-82, -90 - w); g.moveTo(48, -60); g.lineTo(82, -90 + w); g.stroke();
    glow(g, '#46f0ff', 0, -55, 120, 0.4);
  }
  g.restore();
}
function performer(g, x, base, col, t, k, prop) {
  const step = Math.sin(t * 9), hop = Math.abs(step) * 10;
  g.save(); g.translate(x, base - hop);
  g.fillStyle = '#2f3e78'; g.fillRect(-16 + step * 6, -24, 12, 24); g.fillRect(4 - step * 6, -24, 12, 24);
  g.fillStyle = col; g.beginPath(); g.roundRect(-28, -110, 56, 92, [28, 28, 10, 10]); g.fill();
  g.fillStyle = '#ffd7b5'; g.beginPath(); g.ellipse(0, -110, 24, 23, 0, 0, TAU); g.fill();
  eye(g, -8, -114, 5, 0.6, -0.2); eye(g, 9, -114, 5, 0.6, -0.2);
  g.fillStyle = k ? '#1d3557' : '#e63946'; g.beginPath(); g.roundRect(-22, -150, 44, 30, 6); g.fill(); g.fillStyle = '#ffd166'; g.fillRect(-24, -124, 48, 6);
  prop();
  g.restore();
}
function note(g, x, y, i) {
  g.fillStyle = ['#ffffff', '#ffd166', '#ff8fab', '#a0e7e5'][i % 4];
  g.beginPath(); g.ellipse(x, y, 9, 7, -0.4, 0, TAU); g.fill();
  g.fillRect(x + 6, y - 30, 3, 30);
  g.fillRect(x + 6, y - 30, 12, 4);
}
