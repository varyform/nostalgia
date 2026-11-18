// HD moving things, drawn as vectors each frame in cell units (1 = one cell, origin at the
// thing's centre; the caller sets the transform): the drill, the two grubs and their scared
// look, the miner's lamp.
import { TAU } from './art.js';

const ANG = [0, Math.PI / 2, Math.PI, -Math.PI / 2]; // RIGHT, DOWN, LEFT, UP

// the drill: a squat yellow rig on a track with a porthole cab and a spinning bit.
// spin: bit phase; squash: >1 stretched along its way; glow: lamp on (0..1)
export function drawDrill(g, face, spin, squash = 1, lampOn = 0, t = 0) {
  g.save();
  // left keeps the cab upright by mirroring; up / down turn the whole rig
  if (face === 2) g.scale(-1, 1);
  else if (face !== 0) g.rotate(ANG[face]);
  g.scale(squash, 1 / squash);
  // track
  g.fillStyle = '#2a2c34'; g.beginPath(); g.roundRect(-0.42, 0.14, 0.7, 0.24, 0.12); g.fill();
  g.fillStyle = '#5a5e6c';
  for (let k = 0; k < 5; k++) { const x = -0.34 + ((k * 0.14 + spin * 0.05) % 0.7); g.beginPath(); g.arc(x, 0.26, 0.045, 0, TAU); g.fill(); }
  g.strokeStyle = '#121318'; g.lineWidth = 0.03; g.beginPath(); g.roundRect(-0.42, 0.14, 0.7, 0.24, 0.12); g.stroke();
  // body
  const body = g.createLinearGradient(0, -0.3, 0, 0.18);
  body.addColorStop(0, '#ffd45a'); body.addColorStop(0.6, '#f0a020'); body.addColorStop(1, '#b06a10');
  g.fillStyle = body; g.beginPath(); g.roundRect(-0.4, -0.18, 0.62, 0.36, 0.08); g.fill();
  // cab dome and porthole
  g.beginPath(); g.moveTo(-0.36, -0.16); g.quadraticCurveTo(-0.34, -0.42, -0.1, -0.42); g.quadraticCurveTo(0.08, -0.42, 0.1, -0.16); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(80,40,0,0.6)'; g.lineWidth = 0.025; g.stroke();
  const glass = g.createRadialGradient(-0.16, -0.3, 0.01, -0.13, -0.26, 0.12);
  glass.addColorStop(0, '#e8ffff'); glass.addColorStop(0.5, '#5ad0f0'); glass.addColorStop(1, '#1a5a80');
  g.fillStyle = glass; g.beginPath(); g.arc(-0.13, -0.26, 0.1, 0, TAU); g.fill();
  g.strokeStyle = '#7a5a20'; g.lineWidth = 0.03; g.stroke();
  // a bright eye behind the glass, looking ahead
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-0.1, -0.27, 0.035, 0, TAU); g.fill();
  g.fillStyle = '#10202a'; g.beginPath(); g.arc(-0.085, -0.27, 0.018, 0, TAU); g.fill();
  // headlamp
  g.fillStyle = lampOn > 0 ? '#ffffff' : '#fff2b0'; g.beginPath(); g.arc(0.14, -0.2, 0.05, 0, TAU); g.fill();
  // stripes and a rivet line on the body
  g.fillStyle = 'rgba(40,20,0,0.85)';
  for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(-0.36 + k * 0.12, 0.17); g.lineTo(-0.3 + k * 0.12, 0.17); g.lineTo(-0.22 + k * 0.12, 0.02); g.lineTo(-0.28 + k * 0.12, 0.02); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-0.36, -0.15, 0.54, 0.035);
  // the bit: a cone with a running spiral
  g.save();
  g.beginPath(); g.moveTo(0.2, -0.17); g.lineTo(0.5, 0); g.lineTo(0.2, 0.17); g.closePath();
  const steel = g.createLinearGradient(0, -0.17, 0, 0.17);
  steel.addColorStop(0, '#e8ecf4'); steel.addColorStop(0.5, '#9aa2b4'); steel.addColorStop(1, '#4a5060');
  g.fillStyle = steel; g.fill();
  g.clip();
  g.strokeStyle = 'rgba(30,34,46,0.75)'; g.lineWidth = 0.035;
  for (let k = -1; k < 5; k++) { const x = 0.2 + ((k * 0.08 + spin * 0.08) % 0.4); g.beginPath(); g.moveTo(x, -0.2); g.lineTo(x + 0.07, 0.2); g.stroke(); }
  g.restore();
  g.fillStyle = '#5a6070'; g.fillRect(0.17, -0.19, 0.05, 0.38);
  g.restore();
  void t;
}

// a grub: three wobbling segments, a pale belly, big eyes on the hero; the borer gets a red
// shell, a ridge of spines and a spinning jaw. look: unit vector towards the drill
export function drawGrub(g, kind, dir, t, look, scared = 0, blink = false) {
  g.save();
  const ang = dir >= 0 ? ANG[dir] : 0, flip = dir === 2;
  const borer = kind === 'burrower';
  const col = scared ? (blink ? ['#ffffff', '#d8e8ff'] : ['#7ab8ff', '#3a6ad0']) : borer ? ['#ff7a4a', '#a8281a'] : ['#c088ff', '#5a2a9a'];
  const wig = Math.sin(t * (scared ? 22 : 11));
  if (flip) g.scale(-1, 1); else if (dir === 1 || dir === 3) g.rotate(ang);
  // segments back to front
  const segs = [[-0.26, 0.04, 0.2], [-0.06, 0, 0.25], [0.16, -0.02, 0.27]];
  segs.forEach(([x, y, r], k) => {
    const yy = y + Math.sin(t * 9 + k * 1.7) * 0.03, rr = r * (1 + (k === 1 ? wig * 0.05 : 0));
    const gr = g.createRadialGradient(x - rr * 0.3, yy - rr * 0.4, rr * 0.1, x, yy, rr);
    gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, yy, rr, rr * 0.9, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.025; g.stroke();
  });
  // little legs
  g.strokeStyle = col[1]; g.lineWidth = 0.04; g.lineCap = 'round';
  for (let k = 0; k < 4; k++) { const x = -0.3 + k * 0.17, ph = Math.sin(t * 16 + k * 1.3) * 0.05; g.beginPath(); g.moveTo(x, 0.16); g.lineTo(x + ph, 0.3); g.stroke(); }
  if (borer && !scared) {
    g.fillStyle = '#ffd0a0';
    for (let k = 0; k < 4; k++) { const x = -0.3 + k * 0.15; g.beginPath(); g.moveTo(x - 0.05, -0.16); g.lineTo(x, -0.34 - (k % 2) * 0.05); g.lineTo(x + 0.05, -0.16); g.fill(); }
    // the jaw: a toothed wheel
    g.save(); g.translate(0.38, 0.04); g.rotate(t * 14);
    g.fillStyle = '#d8dce8';
    g.beginPath();
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU, r = k % 2 ? 0.1 : 0.15; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = '#6a6e7a'; g.beginPath(); g.arc(0, 0, 0.04, 0, TAU); g.fill();
    g.restore();
  } else if (!scared) {
    // mandibles
    g.strokeStyle = '#2a1040'; g.lineWidth = 0.035;
    g.beginPath(); g.moveTo(0.36, -0.06); g.quadraticCurveTo(0.46, -0.02, 0.42, 0.06); g.moveTo(0.36, 0.1); g.quadraticCurveTo(0.46, 0.08, 0.4, 0.0); g.stroke();
  }
  // eyes (kept upright and looking at the drill, whatever way the body faces)
  g.restore();
  g.save();
  const ex = dir === 2 ? -0.16 : dir === 0 ? 0.16 : 0, ey = dir === 1 ? 0.16 : dir === 3 ? -0.16 : -0.1;
  for (const side of [-1, 1]) {
    const cx = ex + side * 0.1, cy = ey - 0.04;
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(cx, cy, 0.075, scared ? 0.1 : 0.085, 0, 0, TAU); g.fill();
    g.fillStyle = scared ? '#1a2a60' : borer ? '#400a00' : '#14002a';
    g.beginPath(); g.arc(cx + look[0] * 0.03, cy + look[1] * 0.035, scared ? 0.025 : 0.035, 0, TAU); g.fill();
    if (!scared) { // brows
      g.strokeStyle = borer ? '#5a0a00' : '#2a0a4a'; g.lineWidth = 0.03;
      g.beginPath(); g.moveTo(cx - side * 0.07, cy - 0.12 + (borer ? -0.02 : 0)); g.lineTo(cx + side * 0.06, cy - 0.08 + (borer ? 0.03 : 0)); g.stroke();
    }
  }
  if (scared) { // a wobbly frown
    g.strokeStyle = blink ? '#3a6ad0' : '#ffffff'; g.lineWidth = 0.03;
    g.beginPath();
    for (let k = 0; k <= 6; k++) { const x = ex - 0.12 + k * 0.04, y = ey + 0.12 + (k % 2 ? -0.025 : 0.025); if (k) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
  g.restore();
}

// the miner's lamp: brass cage, glass, a flame that breathes
export function drawLamp(g, t) {
  const f = 0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 31) * 0.05;
  g.strokeStyle = '#d8a440'; g.lineWidth = 0.04;
  g.beginPath(); g.arc(0, -0.34, 0.1, Math.PI, 0); g.stroke();
  g.fillStyle = '#b07a20'; g.beginPath(); g.roundRect(-0.17, -0.28, 0.34, 0.07, 0.03); g.fill();
  g.fillStyle = 'rgba(255,230,160,0.3)'; g.beginPath(); g.roundRect(-0.14, -0.22, 0.28, 0.36, 0.06); g.fill();
  const fl = g.createRadialGradient(0, 0.02, 0, 0, -0.02, 0.14 * f);
  fl.addColorStop(0, '#ffffff'); fl.addColorStop(0.4, '#ffe070'); fl.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = fl; g.beginPath(); g.ellipse(0, -0.02, 0.08 * f, 0.14 * f, 0, 0, TAU); g.fill();
  g.strokeStyle = '#d8a440'; g.lineWidth = 0.03;
  for (const x of [-0.14, 0, 0.14]) { g.beginPath(); g.moveTo(x, -0.22); g.lineTo(x, 0.14); g.stroke(); }
  g.fillStyle = '#b07a20'; g.beginPath(); g.roundRect(-0.19, 0.13, 0.38, 0.09, 0.03); g.fill();
}
