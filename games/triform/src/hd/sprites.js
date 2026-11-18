// HD sprites: the forms, enemies, bosses and props as vector shapes. The context comes in
// already scaled to 1 unit = 1 tile, so every coordinate here is in tiles, anchored at the
// thing's feet (or top-left for bosses and blocks) and facing right.
import { C, ZONE_PAL } from '../vga/palette.js';
import { canvas, rgba } from './art.js';

const TAU = Math.PI * 2;

// ---------- soft glow sprites, added with 'lighter' ----------
const GLOWS = {
  white: [255, 255, 255], cyan: [90, 230, 255], amber: [255, 170, 50], red: [255, 60, 40], green: [80, 255, 150],
  purple: [200, 110, 255], ice: [170, 230, 255], orange: [255, 110, 30], yellow: [255, 230, 120], pink: [255, 70, 130],
};
const glowCache = {};
function glowSprite(key) {
  if (glowCache[key]) return glowCache[key];
  const [r, gg, b] = GLOWS[key] ?? GLOWS.white, size = 64, c = canvas(size, size), x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${r},${gg},${b},1)`); gr.addColorStop(0.2, `rgba(${r},${gg},${b},0.55)`);
  gr.addColorStop(0.55, `rgba(${r},${gg},${b},0.15)`); gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, size, size);
  return (glowCache[key] = c);
}
export function glow(g, key, x, y, r, a = 1) {
  if (a <= 0.01 || r <= 0) return;
  const op = g.globalCompositeOperation, al = g.globalAlpha;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(1, a) * al;
  g.drawImage(glowSprite(key), x - r, y - r, r * 2, r * 2);
  g.globalCompositeOperation = op; g.globalAlpha = al;
}

// ---------- drawing helpers ----------
function lin(g, x0, y0, x1, y1, cols) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), c));
  return gr;
}
function rrect(g, x, y, w, h, r, fill, stroke, lw = 0.04) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function circle(g, x, y, r, fill) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = fill; g.fill(); }
function bone(g, x0, y0, x1, y1, w, col) {
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
function poly(g, pts, fill, stroke, lw = 0.04) {
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
const at = (g, x, y, face, fn) => { g.save(); g.translate(x, y); if (face < 0) g.scale(-1, 1); fn(); g.restore(); };
const S = C.steel;

// ---------- the three forms ----------
export function drawAndroid(g, x, y, p, t) {
  at(g, x, y, p.face, () => {
    const moving = p.ground && Math.abs(p.vx) > 0.5, run = moving ? Math.sin(p.walk * 1.6) : 0;
    const air = !p.ground && !p.ladder;
    if (p.ladder) {
      // seen from behind, hands and feet alternating on the rungs
      const k = Math.sin(p.walk * 1.4) * 0.18;
      bone(g, -0.2, -1.1, -0.22, -0.15 + k, 0.28, S[1]); bone(g, 0.2, -1.1, 0.22, -0.15 - k, 0.28, S[1]);
      bone(g, -0.38, -1.9, -0.55, -2.75 - k, 0.22, S[2]); bone(g, 0.38, -1.9, 0.55, -2.75 + k, 0.22, S[2]);
      rrect(g, -0.45, -2.05, 0.9, 0.95, 0.2, lin(g, 0, -2.05, 0, -1.1, [S[4], S[2]]), S[0]);
      rrect(g, -0.2, -1.9, 0.4, 0.55, 0.08, S[1]);
      circle(g, 0, -1.62, 0.08, C.amber[4]); glow(g, 'amber', 0, -1.62, 0.4, 0.7);
      rrect(g, -0.36, -2.72, 0.72, 0.62, 0.22, lin(g, 0, -2.72, 0, -2.1, [S[4], S[2]]), S[0]);
      return;
    }
    const legs = (ph, col, foot) => {
      const a = air ? (ph ? 0.5 : -0.35) : run * 0.65 * (ph ? -1 : 1);
      const hx = ph ? -0.12 : 0.1, hy = -1.12;
      const kx = hx + Math.sin(a) * 0.5, ky = hy + Math.cos(a) * 0.5;
      const bend = air ? 0.9 : Math.max(0, -Math.cos(p.walk * 1.6 + (ph ? Math.PI : 0))) * 0.7;
      const fx = kx + Math.sin(a - bend) * 0.55, fy = Math.min(-0.08, ky + Math.cos(a - bend) * 0.55);
      bone(g, hx, hy, kx, ky, 0.3, col); bone(g, kx, ky, fx, fy, 0.26, col);
      rrect(g, fx - 0.16, fy - 0.06, 0.42, 0.14, 0.05, foot);
    };
    legs(1, S[1], S[0]);
    // back arm
    const sw = air ? -0.9 : -run * 0.7;
    bone(g, -0.1, -1.88, -0.1 + Math.sin(sw) * 0.62, -1.88 + Math.cos(sw) * 0.62, 0.2, S[1]);
    legs(0, S[2], S[1]);
    rrect(g, -0.34, -1.22, 0.68, 0.22, 0.08, S[1]);
    // torso with its amber core
    rrect(g, -0.45, -2.05, 0.9, 0.95, 0.2, lin(g, 0, -2.05, 0, -1.1, [S[5], S[3], S[1]]), S[0]);
    rrect(g, 0.25, -1.95, 0.08, 0.75, 0.03, rgba(S[0], 0.6));
    const pulse = 0.75 + Math.sin(t * 5) * 0.25;
    circle(g, 0.06, -1.62, 0.13, C.amber[4]); circle(g, 0.06, -1.62, 0.06, C.yellow[4]);
    glow(g, 'amber', 0.06, -1.62, 0.55, pulse * 0.8);
    // head, visor and antenna
    rrect(g, -0.37, -2.76, 0.74, 0.64, 0.24, lin(g, 0, -2.76, 0, -2.12, [S[5], S[3], S[2]]), S[0]);
    rrect(g, -0.02, -2.6, 0.44, 0.2, 0.09, lin(g, 0, -2.6, 0.44, -2.4, [C.visor[1], C.visor[2]]));
    glow(g, 'cyan', 0.22, -2.5, 0.6, 0.8);
    bone(g, -0.2, -2.7, -0.27, -3.05, 0.05, S[3]);
    circle(g, -0.27, -3.07, 0.06, C.red[3]); glow(g, 'red', -0.27, -3.07, 0.3, 0.5 + 0.5 * Math.sin(t * 4));
    // front arm: punches forward on a strike, levels the blaster on a shot
    if (p.swing?.src === 'strike') {
      const k = 1 - p.swing.t / 0.12;
      bone(g, 0.1, -1.86, 0.95 + k * 0.2, -1.72, 0.22, S[4]);
      circle(g, 1.05 + k * 0.2, -1.72, 0.18, S[5]);
      glow(g, 'white', 1.15 + k * 0.3, -1.72, 0.7, 1 - k * 0.5);
    } else if (p.spCd > 0.15) {
      bone(g, 0.1, -1.86, 0.85, -1.78, 0.22, S[4]);
      rrect(g, 0.7, -1.9, 0.4, 0.24, 0.06, S[2]);
      glow(g, 'cyan', 1.12, -1.78, 0.6, 1);
    } else {
      const a = air ? 0.9 : run * 0.7;
      bone(g, 0.12, -1.88, 0.12 + Math.sin(a) * 0.6, -1.88 + Math.cos(a) * 0.6, 0.22, S[4]);
    }
  });
}

export function drawRaptor(g, x, y, p, t) {
  at(g, x, y, p.face, () => {
    const A = C.amber, moving = p.ground && Math.abs(p.vx) > 0.5;
    const run = moving ? Math.sin(p.walk * 1.1) : 0, air = !p.ground;
    const bob = -(Math.abs(run) * 0.1) + (p.sprint > 0.5 ? 0.22 : 0);
    // tail: wags; a swipe swings it up and over
    const sw = p.swing?.src === 'swipe' ? 1 - p.swing.t / 0.15 : -1;
    g.save();
    g.translate(-0.95, -2.3 + bob);
    if (sw >= 0) {
      g.rotate(-Math.sin(sw * Math.PI) * 1.4);
      g.strokeStyle = rgba(A[5], 0.5 * (1 - sw)); g.lineWidth = 0.35;
      g.beginPath(); g.arc(0.9, 0.2, 2.4, Math.PI * 0.55, Math.PI * 1.35); g.stroke();
    } else g.rotate(Math.sin(t * 5 + p.walk) * 0.08 + (air ? -0.2 : 0));
    poly(g, [0.2, -0.32, -1.1, -0.12, -2.05, 0.28, -1.0, 0.25, 0.2, 0.32], lin(g, 0, -0.3, 0, 0.3, [A[4], A[2]]), A[0]);
    for (let k = 0; k < 3; k++) poly(g, [-0.3 - k * 0.5, -0.24 + k * 0.08, -0.5 - k * 0.5, -0.42 + k * 0.1, -0.65 - k * 0.5, -0.2 + k * 0.1], A[1]);
    g.restore();
    // digitigrade legs
    const leg = (ph, col) => {
      const a = air ? (ph ? 0.6 : -0.5) : run * 0.6 * (ph ? -1 : 1);
      const hx = ph ? -0.35 : 0.1, hy = -1.55 + bob;
      const kx = hx + 0.25 + Math.sin(a) * 0.4, ky = hy + 0.5;
      const lift = air ? 0.25 : Math.max(0, Math.sin(p.walk * 1.1 + (ph ? Math.PI : 0))) * 0.3 * (moving ? 1 : 0);
      const ax = kx - 0.3 + Math.sin(a) * 0.35, ay = -0.35 - lift;
      bone(g, hx, hy, kx, ky, 0.42, col); bone(g, kx, ky, ax, ay, 0.24, col);
      bone(g, ax, ay, ax + 0.4, ay + 0.3, 0.16, col);
      poly(g, [ax + 0.45, ay + 0.2, ax + 0.6, ay + 0.35, ax + 0.4, ay + 0.38], C.ink);
    };
    leg(1, A[1]);
    // body with back plates and a chest vent
    g.beginPath(); g.ellipse(0, -2.05 + bob, 1.1, 0.66, -0.06, 0, TAU);
    g.fillStyle = lin(g, 0, -2.7 + bob, 0, -1.4 + bob, [A[5], A[3], A[1]]); g.fill();
    g.strokeStyle = A[0]; g.lineWidth = 0.04; g.stroke();
    for (let k = 0; k < 4; k++) poly(g, [-0.75 + k * 0.42, -2.6 + bob + Math.abs(k - 1.5) * 0.05, -0.55 + k * 0.42, -2.95 + bob, -0.38 + k * 0.42, -2.62 + bob], A[2], A[0], 0.03);
    rrect(g, -0.45, -2.15 + bob, 0.9, 0.42, 0.12, A[2]);
    const vent = 0.6 + Math.sin(t * 6) * 0.3;
    rrect(g, -0.3, -2.05 + bob, 0.36, 0.2, 0.06, C.red[2]); glow(g, 'red', -0.12, -1.95 + bob, 0.5, vent * 0.6);
    leg(0, A[2]);
    // arm with a claw
    bone(g, 0.7, -1.95 + bob, 1.0, -1.62 + bob, 0.14, A[2]);
    poly(g, [1.0, -1.7 + bob, 1.2, -1.55 + bob, 0.98, -1.5 + bob], C.ink);
    // neck and head; the jaw drops for a bite and the flame comes out of it
    bone(g, 0.6, -2.35 + bob, 1.0, -3.0 + bob, 0.48, A[3]);
    const open = p.swing?.src === 'bite' ? 0.5 : p.flaming ? 0.4 + Math.sin(t * 30) * 0.05 : 0;
    g.save(); g.translate(1.05, -3.05 + bob); g.rotate(open);
    poly(g, [0, 0, 1.1, -0.05, 1.0, 0.18, 0, 0.22], lin(g, 0, 0, 0, 0.22, [A[3], A[1]]), A[0]);
    if (open) for (let k = 0; k < 4; k++) poly(g, [0.3 + k * 0.2, -0.02, 0.37 + k * 0.2, -0.14, 0.44 + k * 0.2, -0.02], C.white);
    g.restore();
    poly(g, [0.8, -3.6 + bob, 1.45, -3.8 + bob, 2.25, -3.42 + bob, 2.3, -3.14 + bob, 1.15, -3.05 + bob, 0.82, -3.1 + bob], lin(g, 0, -3.8 + bob, 0, -3.05 + bob, [A[5], A[4], A[2]]), A[0]);
    if (open) for (let k = 0; k < 4; k++) poly(g, [1.35 + k * 0.22, -3.12 + bob, 1.42 + k * 0.22, -3.0 + bob, 1.49 + k * 0.22, -3.12 + bob], C.white);
    rrect(g, 1.2, -3.66 + bob, 0.7, 0.1, 0.04, A[2]);
    circle(g, 1.62, -3.45 + bob, 0.09, C.red[3]); circle(g, 1.65, -3.47 + bob, 0.03, C.white);
    glow(g, 'red', 1.62, -3.45 + bob, 0.45, 0.8);
  });
}

export function drawTank(g, x, y, p, t) {
  at(g, x, y, p.face, () => {
    const O = C.olive, roll = p.walk * 0.6;
    // treads, wheels turning
    rrect(g, -1.62, -0.92, 3.24, 0.92, 0.46, lin(g, 0, -0.92, 0, 0, [S[2], S[0]]), C.black);
    g.save(); g.beginPath(); g.roundRect(-1.62, -0.92, 3.24, 0.92, 0.46); g.clip();
    g.strokeStyle = S[3]; g.lineWidth = 0.08; g.setLineDash([0.12, 0.16]); g.lineDashOffset = -roll;
    g.beginPath(); g.roundRect(-1.56, -0.86, 3.12, 0.8, 0.4); g.stroke(); g.setLineDash([]);
    g.restore();
    for (let k = 0; k < 4; k++) {
      const wx = -1.12 + k * 0.75;
      circle(g, wx, -0.46, 0.3, S[1]); circle(g, wx, -0.46, 0.2, S[3]);
      g.strokeStyle = S[1]; g.lineWidth = 0.05; g.beginPath();
      for (let s = 0; s < 3; s++) { const a = roll * 2 + (s * TAU) / 3; g.moveTo(wx, -0.46); g.lineTo(wx + Math.cos(a) * 0.2, -0.46 + Math.sin(a) * 0.2); }
      g.stroke();
      circle(g, wx, -0.46, 0.06, S[5]);
    }
    // hull with a sloped nose and a hazard band
    poly(g, [-1.5, -0.88, -1.5, -1.78, 1.0, -1.78, 1.52, -1.3, 1.56, -0.88], lin(g, 0, -1.78, 0, -0.88, [O[5], O[3], O[1]]), O[0]);
    g.save(); g.beginPath(); g.rect(-1.35, -1.38, 2.4, 0.2); g.clip();
    g.fillStyle = C.black; g.fillRect(-1.35, -1.38, 2.4, 0.2);
    g.fillStyle = C.yellow[3];
    for (let k = 0; k < 12; k++) poly(g, [-1.35 + k * 0.24, -1.18, -1.23 + k * 0.24, -1.38, -1.11 + k * 0.24, -1.38, -1.23 + k * 0.24, -1.18]);
    g.restore();
    g.fillStyle = rgba('#ffffff', 0.25); g.fillRect(-1.45, -1.76, 2.4, 0.05);
    // turret and barrel (kicks back after a shot)
    const rec = p.atkCd > 0.45 ? -0.28 * ((p.atkCd - 0.45) / 0.25) : 0;
    rrect(g, 0.55 + rec, -2.36, 1.3, 0.24, 0.06, lin(g, 0, -2.36, 0, -2.12, [O[4], O[1]]), O[0]);
    rrect(g, 1.75 + rec, -2.44, 0.22, 0.4, 0.05, O[1]);
    if (rec < -0.1) glow(g, 'amber', 2.1, -2.24, 0.9, -rec * 3);
    rrect(g, -0.78, -2.52, 1.45, 0.78, [0.38, 0.38, 0.06, 0.06], lin(g, 0, -2.52, 0, -1.74, [O[5], O[3], O[2]]), O[0]);
    rrect(g, -0.4, -2.3, 0.45, 0.13, 0.05, C.visor[1]); glow(g, 'cyan', -0.18, -2.24, 0.45, 0.7);
    // antenna with a blinking tip; the probe hatch stands open while the probe is out
    bone(g, -0.62, -2.42, -0.62, -3.22, 0.05, S[3]);
    const blink = (t * 3) % 2 < 1;
    circle(g, -0.62, -3.24, 0.07, blink ? C.red[3] : C.red[1]); if (blink) glow(g, 'red', -0.62, -3.24, 0.35, 0.7);
    if (p.probe) rrect(g, -0.15, -2.75, 0.5, 0.12, 0.04, S[1]);
  });
}

export function drawForm(g, form, x, y, p, t) {
  if (form === 'android') drawAndroid(g, x, y, p, t);
  else if (form === 'raptor') drawRaptor(g, x, y, p, t);
  else drawTank(g, x, y, p, t);
}

// the probe drone, by its centre
export function drawProbe(g, x, y, t) {
  const w = Math.abs(Math.sin(t * 40)) * 0.45 + 0.1;
  rrect(g, x - 0.38, y - 0.2, 0.76, 0.45, 0.14, lin(g, 0, y - 0.2, 0, y + 0.25, [S[5], S[2]]), S[0]);
  bone(g, x, y - 0.2, x, y - 0.38, 0.05, S[3]);
  g.fillStyle = rgba(S[4], 0.7); g.beginPath(); g.ellipse(x, y - 0.4, w, 0.05, 0, 0, TAU); g.fill();
  circle(g, x + 0.12, y + 0.02, 0.07, C.green[3]); glow(g, 'green', x + 0.12, y + 0.02, 0.6, 0.8 + Math.sin(t * 10) * 0.2);
}

// ---------- enemies, by their bottom centre ----------
export function drawEnemy(g, e, x, y, t, zone) {
  const f = e.flash > 0, P = ZONE_PAL[zone];
  const c = col => (f ? '#ffffff' : col);
  at(g, x, y, e.dir > 0 ? 1 : -1, () => {
    switch (e.kind) {
      case 'crawler': {
        for (let k = 0; k < 3; k++) {
          const ph = Math.sin(e.t * 14 + k * 2) * 0.12, lx = -0.55 + k * 0.5;
          g.strokeStyle = c(S[1]); g.lineWidth = 0.08; g.lineCap = 'round';
          g.beginPath(); g.moveTo(lx, -0.45); g.lineTo(lx + 0.15 + ph, -0.25); g.lineTo(lx + ph, 0); g.stroke();
        }
        g.beginPath(); g.ellipse(0, -0.5, 0.88, 0.62, 0, Math.PI, 0); g.closePath();
        g.fillStyle = f ? '#ffffff' : lin(g, 0, -1.12, 0, -0.45, [C.red[3], C.red[1]]); g.fill();
        g.strokeStyle = c(C.red[0]); g.lineWidth = 0.04; g.stroke();
        g.strokeStyle = c(C.red[2]); g.lineWidth = 0.05;
        g.beginPath(); for (let k = -1; k <= 1; k++) { g.moveTo(k * 0.35, -1.1 + Math.abs(k) * 0.08); g.lineTo(k * 0.45, -0.5); } g.stroke();
        rrect(g, -0.88, -0.56, 1.76, 0.14, 0.05, c(S[1]));
        circle(g, 0.62, -0.72, 0.12, P.glow[1]); glow(g, 'orange', 0.62, -0.72, 0.5, 0.8);
        break;
      }
      case 'drone': {
        const w = 0.25 + Math.abs(Math.sin(e.t * 30)) * 0.55;
        g.fillStyle = rgba(S[4], 0.7); g.beginPath(); g.ellipse(0, -1.35, w, 0.06, 0, 0, TAU); g.fill();
        bone(g, 0, -1.35, 0, -1.05, 0.08, c(S[2]));
        rrect(g, -0.66, -1.08, 1.32, 0.78, 0.36, f ? '#fff' : lin(g, 0, -1.08, 0, -0.3, [S[4], S[2], S[0]]), S[0]);
        rrect(g, 0.05, -0.85, 0.42, 0.26, 0.1, C.black);
        circle(g, 0.3, -0.72, 0.09, C.red[3]); glow(g, 'red', 0.3, -0.72, 0.55, 0.9);
        glow(g, 'red', 0, -0.15, 0.5, 0.25);
        break;
      }
      case 'turret': {
        rrect(g, -0.75, -2, 1.5, 2, 0.12, f ? '#fff' : lin(g, -0.75, 0, 0.75, 0, [S[3], S[1], S[0]]), C.black);
        g.fillStyle = c(S[4]);
        for (const [a, b] of [[-0.58, -1.82], [0.58, -1.82], [-0.58, -0.18], [0.58, -0.18], [-0.58, -1], [0.58, -1]]) { g.beginPath(); g.arc(a, b, 0.06, 0, TAU); g.fill(); }
        rrect(g, 0.4, -1.42, 0.8, 0.26, 0.05, c(S[3]), S[0]);
        rrect(g, 1.1, -1.5, 0.18, 0.42, 0.05, c(S[2]));
        const ch = e.cd < 0.4 ? 1 : 0.35;
        circle(g, 0, -1.3, 0.34, C.black); circle(g, 0, -1.3, 0.22, ch > 0.5 ? C.red[4] : C.red[2]);
        glow(g, 'red', 0, -1.3, 0.6 + ch * 0.6, ch);
        break;
      }
      case 'hopper': {
        const sq = e.ground ? (e.cd < 0.25 ? 0.2 : 0) : -0.12;
        g.strokeStyle = c(S[2]); g.lineWidth = 0.1; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-0.4, -0.5 + sq); g.lineTo(-0.55, -0.25); g.lineTo(-0.4, 0); g.moveTo(0.4, -0.5 + sq); g.lineTo(0.55, -0.25); g.lineTo(0.4, 0); g.stroke();
        g.beginPath(); g.ellipse(0, -0.95 + sq * 0.6, 0.68, 0.55 - sq * 0.5, 0, 0, TAU);
        g.fillStyle = f ? '#fff' : lin(g, 0, -1.5, 0, -0.4, [C.green[3], C.green[1]]); g.fill();
        g.strokeStyle = c(C.green[0]); g.lineWidth = 0.04; g.stroke();
        bone(g, -0.1, -1.45 + sq, -0.2, -1.8 + sq, 0.05, S[3]); circle(g, -0.2, -1.82 + sq, 0.06, C.yellow[4]);
        circle(g, 0.3, -1.05 + sq * 0.6, 0.14, C.yellow[4]); circle(g, -0.05, -1.05 + sq * 0.6, 0.1, C.yellow[2]);
        glow(g, 'yellow', 0.3, -1.05, 0.45, 0.7);
        break;
      }
      case 'swooper': {
        const flap = e.state === 'dive' ? -0.1 : Math.sin(e.t * 14) * 0.35;
        const wing = s => poly(g, [s * 0.25, -0.75, s * 0.95, -0.95 - flap, s * 0.85, -0.55 - flap * 0.5, s * 0.55, -0.62, s * 0.3, -0.45], f ? '#fff' : lin(g, 0, -1, 0, -0.4, [C.purple[3], C.purple[1]]), C.purple[0]);
        wing(-1); wing(1);
        g.beginPath(); g.ellipse(0, -0.65, 0.34, 0.4, 0, 0, TAU); g.fillStyle = f ? '#fff' : lin(g, 0, -1, 0, -0.25, [C.purple[3], C.purple[1]]); g.fill();
        circle(g, 0.12, -0.72, 0.1, P.glow[1]); glow(g, 'pink', 0.12, -0.72, 0.5, 0.8);
        bone(g, -0.1, -0.3, -0.12, -0.05, 0.06, S[2]); bone(g, 0.1, -0.3, 0.12, -0.05, 0.06, S[2]);
        break;
      }
    }
  });
}

// ---------- props, by their left edge and bottom ----------
export function drawSwitch(g, e, x, y, t) {
  if (e.armored) {
    rrect(g, x, y - 1.25, 1, 1.25, 0.08, lin(g, x, 0, x + 1, 0, [S[3], S[1], S[0]]), C.black);
    g.fillStyle = S[4];
    for (const [a, b] of [[0.14, -1.1], [0.86, -1.1], [0.14, -0.14], [0.86, -0.14]]) { g.beginPath(); g.arc(x + a, y + b, 0.05, 0, TAU); g.fill(); }
    const col = e.on ? C.green[3] : C.red[3];
    g.strokeStyle = col; g.lineWidth = 0.07;
    g.beginPath(); g.arc(x + 0.5, y - 0.62, 0.3, 0, TAU); g.stroke();
    circle(g, x + 0.5, y - 0.62, 0.13, col); glow(g, e.on ? 'green' : 'red', x + 0.5, y - 0.62, 0.7, 0.7);
  } else {
    rrect(g, x + 0.12, y - 1.25, 0.76, 1.25, 0.1, lin(g, x, 0, x + 1, 0, [S[4], S[2], S[1]]), S[0]);
    const on = e.on, blink = (t * 2) % 2 < 1;
    rrect(g, x + 0.25, y - 1.05, 0.5, 0.5, 0.1, on ? C.green[3] : blink ? C.red[3] : C.red[1]);
    glow(g, on ? 'green' : 'red', x + 0.5, y - 0.8, 0.8, on || blink ? 0.9 : 0.3);
    rrect(g, x + 0.38, y - 0.4, 0.24, 0.24, 0.05, S[1]);
  }
}
export function drawGen(g, e, x, y, t) {
  rrect(g, x, y - 1.25, 1.25, 1.25, 0.1, lin(g, x, 0, x + 1.25, 0, [S[3], S[1], S[0]]), C.black);
  for (let k = 0; k < 4; k++) {
    const on = !e.down && (Math.floor(t * 12) + k) % 3;
    rrect(g, x + 0.22, y - 1.05 + k * 0.24, 0.81, 0.12, 0.05, e.down ? S[0] : on ? C.cyan[2] : C.cyan[3]);
  }
  if (!e.down) glow(g, 'cyan', x + 0.62, y - 0.65, 1.2, 0.6 + Math.sin(t * 9) * 0.2);
}
export function drawCore(g, e, x, y, t) {
  const f = e.flash > 0, pulse = 0.65 + Math.sin(t * 5) * 0.35;
  if (e.need === 'shell') {
    rrect(g, x, y - 2.5, 1.5, 2.5, 0.12, f ? '#fff' : lin(g, x, 0, x + 1.5, 0, [S[3], S[1], S[0]]), C.black);
    g.fillStyle = S[4];
    for (let k = 0; k < 4; k++) for (const a of [0.14, 1.36]) { g.beginPath(); g.arc(x + a, y - 2.3 + k * 0.6, 0.05, 0, TAU); g.fill(); }
    rrect(g, x + 0.38, y - 1.8, 0.74, 1.0, 0.2, C.red[2]); rrect(g, x + 0.55, y - 1.6, 0.4, 0.6, 0.15, C.red[4]);
    glow(g, 'red', x + 0.75, y - 1.3, 1.1, pulse);
  } else if (e.need === 'probe') {
    rrect(g, x + 0.1, y - 1.8, 1.3, 1.55, 0.2, f ? '#fff' : C.green[1], C.green[0]);
    rrect(g, x + 0.35, y - 1.55, 0.8, 1.05, 0.15, C.green[2]); circle(g, x + 0.75, y - 1.02, 0.22, C.green[4]);
    glow(g, 'green', x + 0.75, y - 1.02, 1.1, pulse);
  } else {
    rrect(g, x + 0.1, y - 2.25, 1.3, 1.8, 0.2, f ? '#fff' : lin(g, x, 0, x + 1.5, 0, [S[4], S[2], S[1]]), S[0]);
    rrect(g, x + 0.35, y - 1.9, 0.8, 1.05, 0.25, C.cyan[2]); circle(g, x + 0.75, y - 1.38, 0.2, C.white);
    rrect(g, x + 0.5, y - 0.5, 0.5, 0.5, 0.05, S[1]);
    glow(g, 'cyan', x + 0.75, y - 1.38, 1.1, pulse);
  }
}
export function drawPod(g, e, x, y, t, active) {
  rrect(g, x, y - 2.25, 1.5, 2.25, [0.6, 0.6, 0.08, 0.08], lin(g, x, 0, x + 1.5, 0, [S[3], S[1], S[0]]), C.black);
  rrect(g, x + 0.22, y - 1.95, 1.06, 1.45, [0.45, 0.45, 0.06, 0.06], active ? rgba(C.green[1], 0.9) : rgba(S[0], 0.9));
  if (active) {
    g.save(); g.beginPath(); g.roundRect(x + 0.22, y - 1.95, 1.06, 1.45, [0.45, 0.45, 0.06, 0.06]); g.clip();
    for (let k = 0; k < 3; k++) { const sy = y - 1.95 + (((t * 1.2 + k / 3) % 1) * 1.45); g.fillStyle = rgba(C.green[3], 0.7); g.fillRect(x + 0.22, sy, 1.06, 0.06); }
    g.restore();
    glow(g, 'green', x + 0.75, y - 1.2, 1.6, 0.7);
  }
  g.fillStyle = rgba('#ffffff', 0.18); g.beginPath(); g.ellipse(x + 0.5, y - 1.6, 0.12, 0.3, 0.2, 0, TAU); g.fill();
  rrect(g, x, y - 0.25, 1.5, 0.25, 0.05, S[2]);
  circle(g, x + 0.75, y - 2.35, 0.12, active ? C.green[3] : C.red[2]);
  glow(g, active ? 'green' : 'red', x + 0.75, y - 2.35, 0.5, 0.8);
}
export function drawEnergy(g, e, x, y, t) {
  const yy = y + Math.sin(t * 4 + x) * 0.12;
  rrect(g, x + 0.18, yy - 0.88, 0.64, 0.82, 0.14, lin(g, 0, yy - 0.88, 0, yy, [C.green[3], C.green[1]]), C.green[0]);
  rrect(g, x + 0.38, yy - 0.98, 0.24, 0.12, 0.03, S[3]);
  g.fillStyle = C.white; g.fillRect(x + 0.44, yy - 0.72, 0.12, 0.42); g.fillRect(x + 0.29, yy - 0.57, 0.42, 0.12);
  glow(g, 'green', x + 0.5, yy - 0.45, 0.9, 0.6 + Math.sin(t * 8) * 0.2);
}
export function drawUpgrade(g, e, x, y, t) {
  const cx = x + 0.75, cy = y - 0.85 + Math.sin(t * 3) * 0.15, s = Math.cos(t * 2);
  glow(g, 'white', cx, cy, 1.8, 0.45 + Math.sin(t * 6) * 0.15);
  g.save(); g.translate(cx, cy); g.scale(0.6 + Math.abs(s) * 0.4, 1);
  rrect(g, -0.72, -0.72, 1.44, 1.44, 0.2, rgba(C.hud[1], 0.85), C.white, 0.06);
  if (e.up === 'blaster') { rrect(g, -0.45, -0.2, 0.8, 0.28, 0.06, S[4]); rrect(g, -0.35, 0.05, 0.22, 0.3, 0.05, S[3]); circle(g, 0.4, -0.06, 0.1, C.visor[2]); }
  if (e.up === 'flame') { poly(g, [0, -0.5, 0.3, 0.05, 0.15, 0.4, -0.15, 0.4, -0.3, 0.05], C.red[3]); poly(g, [0, -0.2, 0.15, 0.15, 0, 0.35, -0.15, 0.15], C.yellow[4]); }
  if (e.up === 'probe') { rrect(g, -0.35, -0.15, 0.7, 0.4, 0.12, S[3]); circle(g, 0, 0.05, 0.08, C.green[3]); bone(g, -0.4, -0.35, 0.4, -0.35, 0.06, S[4]); }
  g.restore();
}
export function drawPlate(g, e, x, y) {
  const dn = e.pressed ? 0.12 : 0;
  rrect(g, x, y - 0.25 + dn, 2, 0.25 - dn, 0.04, C.yellow[3], C.yellow[1]);
  g.fillStyle = C.black;
  for (let i = 0; i < 4; i++) g.fillRect(x + 0.15 + i * 0.5, y - 0.2 + dn, 0.22, 0.06);
  if (e.pressed) glow(g, 'yellow', x + 1, y - 0.1, 1, 0.5);
}
export function drawBlock(g, b, x, y) {
  rrect(g, x, y, 2, 2, 0.1, lin(g, x, y, x + 2, y + 2, [S[4], S[2], S[0]]), C.black);
  g.strokeStyle = S[1]; g.lineWidth = 0.14;
  g.beginPath(); g.moveTo(x + 0.25, y + 0.25); g.lineTo(x + 1.75, y + 1.75); g.moveTo(x + 1.75, y + 0.25); g.lineTo(x + 0.25, y + 1.75); g.stroke();
  g.strokeStyle = S[3]; g.lineWidth = 0.08; g.strokeRect(x + 0.2, y + 0.2, 1.6, 1.6);
  rrect(g, x + 0.7, y + 0.85, 0.6, 0.3, 0.05, C.yellow[3]);
  g.fillStyle = S[5];
  for (const [a, c] of [[0.12, 0.12], [1.88, 0.12], [0.12, 1.88], [1.88, 1.88]]) { g.beginPath(); g.arc(x + a, y + c, 0.06, 0, TAU); g.fill(); }
}

// ---------- bosses, by their top-left corner ----------
export function drawBoss(g, b, x, y, t, sim) {
  const f = b.flash > 0, c = col => (f ? '#ffffff' : col);
  g.save(); g.translate(x, y);
  if (b.kind === 'crucible') {
    // a rolling furnace on treads with a ladle that lifts to pour
    const pour = b.state === 'pour' ? Math.min(1, b.st * 3) : 0;
    rrect(g, 0, 3.5, 6, 1, 0.5, lin(g, 0, 3.5, 0, 4.5, [S[2], S[0]]), C.black);
    for (let k = 0; k < 5; k++) { const wx = 0.6 + k * 1.2; circle(g, wx, 4, 0.36, S[1]); circle(g, wx, 4, 0.12, S[4]); }
    rrect(g, 0.25, 0.75, 5.5, 2.8, 0.25, f ? '#fff' : lin(g, 0, 0.75, 0, 3.55, [S[4], S[2], S[0]]), C.black);
    g.fillStyle = S[4];
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(0.55 + k * 0.98, 1.0, 0.06, 0, TAU); g.arc(0.55 + k * 0.98, 3.3, 0.06, 0, TAU); g.fill(); }
    const heat = 0.6 + Math.sin(t * 6) * 0.4;
    rrect(g, 1, 1.5, 4, 1.3, 0.15, C.black);
    rrect(g, 1.2, 1.7, 3.6, 0.9, 0.1, lin(g, 0, 1.7, 0, 2.6, [C.yellow[4], C.amber[5], C.red[3]]));
    g.fillStyle = S[0]; for (let k = 0; k < 8; k++) g.fillRect(1.35 + k * 0.45, 1.6, 0.12, 1.1);
    glow(g, 'orange', 3, 2.15, 3.2, heat * 0.8);
    g.save(); g.translate(0, -pour * 0.6);
    rrect(g, 1.5, 0, 3, 0.8, [0.1, 0.1, 0.4, 0.4], c(S[2]), S[0]);
    rrect(g, 1.75, 0.08, 2.5, 0.26, 0.1, pour ? C.yellow[4] : C.amber[4]);
    glow(g, 'amber', 3, 0.2, 1.6, 0.5 + pour * 0.5);
    g.restore();
    rrect(g, 0.75, 0.25 - pour * 0.3, 0.45, 0.8, 0.08, S[2]); rrect(g, 4.8, 0.25 - pour * 0.3, 0.45, 0.8, 0.08, S[2]);
  } else if (b.kind === 'warden') {
    // a cryo drone; docked it grows an ice shell, exposed its core burns red
    const fan = Math.sin(t * 40);
    for (const sx of [-0.45, 4.45]) {
      rrect(g, sx - 0.25, 0.75, 0.5, 1.1, 0.12, S[2], S[0]);
      g.fillStyle = rgba(S[5], 0.55); g.beginPath(); g.ellipse(sx, 0.7, 0.2 + Math.abs(fan) * 0.75, 0.07, 0, 0, TAU); g.fill();
    }
    g.beginPath(); g.ellipse(2, 1.45, 2.05, 0.95, 0, 0, TAU);
    g.fillStyle = f ? '#fff' : lin(g, 0, 0.5, 0, 2.4, [C.cyan[2], C.cyan[1], C.cyan[0]]); g.fill();
    g.strokeStyle = C.cyan[3]; g.lineWidth = 0.05; g.stroke();
    rrect(g, 0.6, 2.2, 2.8, 0.4, 0.15, S[1]);
    const exposed = b.state === 'exposed';
    const pulse = 0.6 + Math.sin(t * 14) * 0.4;
    circle(g, 2, 1.4, 0.62, C.black);
    circle(g, 2, 1.4, 0.46, exposed ? C.red[3] : C.ice[2]); circle(g, 2, 1.4, 0.2, exposed ? C.yellow[4] : C.white);
    glow(g, exposed ? 'red' : 'ice', 2, 1.4, exposed ? 2.2 : 1.4, exposed ? pulse : 0.6);
    if (b.state === 'docked') {
      const melt = Math.min(1, b.melt);
      g.globalAlpha = 1 - melt * 0.85;
      poly(g, [-0.7, 3, -0.5, 0.4, 0.6, -0.4, 2, -0.6, 3.4, -0.4, 4.5, 0.4, 4.7, 3, 2, 3.25], lin(g, 0, -0.6, 0, 3.2, [rgba(C.ice[4], 0.85), rgba(C.ice[2], 0.7), rgba(C.ice[1], 0.8)]), C.ice[4], 0.06);
      g.strokeStyle = rgba('#ffffff', 0.7); g.lineWidth = 0.05;
      g.beginPath(); g.moveTo(0.2, 0.3); g.lineTo(1.2, 1.4); g.lineTo(0.9, 2.6); g.moveTo(3.6, 0.2); g.lineTo(3.0, 1.5); g.lineTo(3.8, 2.7); g.stroke();
      g.globalAlpha = 1;
    }
    if (b.state === 'hover' || b.state === 'ascend' || b.state === 'descend') {
      g.strokeStyle = rgba(C.cyan[3], 0.55); g.lineWidth = 0.07; g.setLineDash([0.3, 0.2]); g.lineDashOffset = -t * 2;
      g.beginPath(); g.ellipse(2, 1.4, 2.9, 1.8, 0, 0, TAU); g.stroke(); g.setLineDash([]);
      glow(g, 'cyan', 2, 1.4, 3.4, 0.18);
    }
  } else if (b.kind === 'sentinel') {
    // an eye in a wall housing (rows 8 to 20 of its room); the lids open while its field is down
    const open = sim.room.fieldT > 0, top = 8 - b.y;
    rrect(g, -0.3, top, 5.6, 12, 0.2, lin(g, -0.3, 0, 5.3, 0, [S[2], S[0], C.black]), C.black);
    g.fillStyle = S[1]; for (let j = top + 0.5; j < top + 12; j += 1) g.fillRect(-0.3, j, 5.6, 0.06);
    rrect(g, 0, 0, 4.5, 3.5, 0.4, f ? '#fff' : lin(g, 0, 0, 0, 3.5, [S[4], S[2], S[0]]), C.black);
    rrect(g, 0.45, 0.45, 3.6, 2.6, 1.2, C.black);
    const lid = open ? 0.15 : 0.62, iris = open ? C.red[4] : C.red[2];
    const lx = sim.p ? Math.max(-0.4, Math.min(0.4, (sim.p.x - (b.x + 2.25)) * 0.03)) : 0;
    g.save(); g.beginPath(); g.ellipse(2.25, 1.75, 1.75, 1.25 * (1 - lid), 0, 0, TAU); g.clip();
    g.fillStyle = lin(g, 0, 0.5, 0, 3, [C.red[1], C.red[0]]); g.fillRect(0.4, 0.4, 3.7, 2.7);
    circle(g, 2.25 + lx, 1.75, 0.8, iris); circle(g, 2.25 + lx, 1.75, 0.36, C.black); circle(g, 2.05 + lx, 1.55, 0.1, C.white);
    g.restore();
    glow(g, 'red', 2.25 + lx, 1.75, open ? 3 : 1.6, open ? 0.9 : 0.4);
    rrect(g, -0.75, 1.2, 0.75, 1, 0.1, S[2], S[0]);
  } else if (b.kind === 'foreman') {
    // the station's mind: a head with one eye, shielded until its cores are broken
    const ph2 = b.phase === 2, R = ph2 ? C.red : C.purple;
    for (let k = 0; k < 4; k++) {
      const sx = 0.6 + k * 0.95, sway = Math.sin(t * 2 + k) * 0.15;
      g.strokeStyle = S[1]; g.lineWidth = 0.14; g.lineCap = 'round';
      g.beginPath(); g.moveTo(sx, 2.8); g.quadraticCurveTo(sx + sway, 3.4, sx + sway * 2, 3.9 + (k % 2) * 0.3); g.stroke();
    }
    poly(g, [0.2, 0.3, 3.8, 0.3, 4.1, 1.4, 3.6, 2.9, 0.4, 2.9, -0.1, 1.4], f ? '#fff' : lin(g, 0, 0, 0, 3, [R[2], R[1], R[0]]), R[3], 0.06);
    rrect(g, 0.75, 0.75, 2.5, 1.5, 0.6, C.black);
    const look = Math.sin(t * 1.3) * 0.45;
    circle(g, 2 + look, 1.5, 0.55, ph2 ? C.red[4] : C.purple[3]); circle(g, 2 + look, 1.5, 0.22, C.white);
    glow(g, ph2 ? 'red' : 'purple', 2 + look, 1.5, 2.2, 0.85);
    rrect(g, -0.75, 1, 0.75, 0.38, 0.08, S[2]); rrect(g, 4, 1, 0.75, 0.38, 0.08, S[2]);
    if (!ph2) {
      g.strokeStyle = rgba(C.purple[4], 0.7); g.lineWidth = 0.08; g.setLineDash([0.25, 0.25]); g.lineDashOffset = t * 3;
      g.beginPath(); g.ellipse(2, 1.5, 2.9, 2.2, 0, 0, TAU); g.stroke(); g.setLineDash([]);
      glow(g, 'purple', 2, 1.5, 3.6, 0.25);
    }
  }
  g.restore();
}
