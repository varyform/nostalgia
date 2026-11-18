// The crawler: a low tracked hull with sloped plates, a domed turret with a lit visor band in
// the player's colour and a long barrel. Drawn in sim cells (the caller scales), so it lines
// up with the ground and the hit boxes exactly.
import { BARREL, PIVOT, SHIELD_R } from '../sim.js';
import { ITEM } from '../weapons.js';
import { glow } from './field.js';

const TAU = Math.PI * 2;
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
export const shade = (c, k) => {
  const [r, g, b] = hex(c), f = v => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

/** One tank at its cell position; `travel` turns the wheels, `time` breathes the visor. */
export function drawTank(g, t, { col, time, travel = 0, wreck = false }) {
  g.save();
  g.translate(t.x, t.y);
  // contact shadow
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath(); g.ellipse(0, 0.4, 14, 2.2, 0, 0, TAU); g.fill();
  const body = wreck ? '#3a3236' : col;
  // barrel (behind the dome)
  g.save();
  g.translate(0, -PIVOT);
  g.rotate((-t.angle * Math.PI) / 180);
  g.fillStyle = wreck ? '#2a2428' : '#2c2a33';
  g.beginPath(); g.roundRect(0, -1.5, BARREL, 3, 1); g.fill();
  g.fillStyle = wreck ? '#4a4044' : shade(body, 0.25);
  g.fillRect(3, -1.5, 3, 3);
  g.fillStyle = '#1a181f';
  g.beginPath(); g.roundRect(BARREL - 3, -2, 3.6, 4, 1); g.fill();
  g.restore();
  // tracks
  g.fillStyle = '#1b1920';
  g.beginPath(); g.roundRect(-13.5, -5.2, 27, 5.4, 2.7); g.fill();
  g.strokeStyle = '#46424e'; g.lineWidth = 0.6;
  const ph = ((travel % 2.4) + 2.4) % 2.4;
  for (let x = -12 + ph; x < 12.5; x += 2.4) { g.beginPath(); g.moveTo(x, -5.1); g.lineTo(x + 0.6, -4.3); g.stroke(); }
  for (let k = 0; k < 5; k++) {
    const wx = -10 + k * 5;
    g.fillStyle = '#3a3742'; g.beginPath(); g.arc(wx, -2.5, 1.9, 0, TAU); g.fill();
    g.strokeStyle = '#6a6574'; g.lineWidth = 0.5;
    const a = travel / 1.9;
    g.beginPath(); g.moveTo(wx + Math.cos(a) * 1.5, -2.5 + Math.sin(a) * 1.5); g.lineTo(wx - Math.cos(a) * 1.5, -2.5 - Math.sin(a) * 1.5); g.stroke();
  }
  // hull: sloped plates, lit from above
  const hg = g.createLinearGradient(0, -10, 0, -4.5);
  hg.addColorStop(0, shade(body, 0.35)); hg.addColorStop(0.5, body); hg.addColorStop(1, shade(body, -0.45));
  g.fillStyle = hg;
  g.beginPath(); g.moveTo(-12.5, -4.6); g.lineTo(12.5, -4.6); g.lineTo(10.5, -8.4); g.lineTo(7, -9.6); g.lineTo(-7, -9.6); g.lineTo(-10.5, -8.4); g.closePath(); g.fill();
  g.strokeStyle = shade(body, -0.6); g.lineWidth = 0.5; g.stroke();
  g.fillStyle = shade(body, -0.3); g.fillRect(-11, -6.2, 22, 0.8);
  // dome
  const dg = g.createRadialGradient(-1.6, -12.4, 0.5, 0, -10, 6);
  dg.addColorStop(0, shade(body, 0.55)); dg.addColorStop(0.6, shade(body, -0.1)); dg.addColorStop(1, shade(body, -0.55));
  g.fillStyle = dg;
  g.beginPath(); g.arc(0, -9.4, 5.6, Math.PI, 0); g.closePath(); g.fill();
  // visor band
  if (!wreck) {
    const lit = 0.65 + 0.35 * Math.sin(time * 3 + t.i);
    g.strokeStyle = `rgba(255,255,255,${0.5 + lit * 0.4})`; g.lineWidth = 1;
    g.beginPath(); g.arc(0, -9.4, 4, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
    glow(g, '#ffffff', 0, -12, 4.5, 0.18 * lit);
  }
  g.restore();
}

/** The shield bubble, coloured by its kind; `k` is the hp left (0..1). */
export function drawShield(g, t, time) {
  const s = t.shield, col = ITEM[s.id]?.col ?? '#8fd8ff', k = Math.max(0.15, s.hp / s.max);
  const x = t.x, y = t.y - 6, r = SHIELD_R;
  const gr = g.createRadialGradient(x, y, r * 0.55, x, y, r);
  gr.addColorStop(0, col + '00'); gr.addColorStop(0.85, col + '30'); gr.addColorStop(1, col + '90');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.strokeStyle = col; g.globalAlpha = 0.35 + 0.4 * k + 0.12 * Math.sin(time * 5 + t.i); g.lineWidth = 0.9;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
  // a slow shimmer band
  g.globalAlpha = 0.25 * k; g.lineWidth = 2.2;
  const a = time * 1.4 + t.i;
  g.beginPath(); g.arc(x, y, r - 2, a, a + 0.9); g.stroke();
  g.globalAlpha = 1;
}

/** An opened glider over a falling tank. */
export function drawGlider(g, t, time) {
  const x = t.x, y = t.y - 30, sway = Math.sin(time * 4) * 1.2;
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.4;
  g.beginPath(); g.moveTo(x - 9, y + 3); g.lineTo(x - 6, t.y - 10); g.moveTo(x + 9, y + 3); g.lineTo(x + 6, t.y - 10); g.stroke();
  g.fillStyle = '#ffe08a';
  g.beginPath(); g.moveTo(x - 12 + sway, y + 3); g.quadraticCurveTo(x + sway, y - 9, x + 12 + sway, y + 3); g.quadraticCurveTo(x + sway, y - 2, x - 12 + sway, y + 3); g.fill();
  g.fillStyle = '#ff8a5a';
  g.beginPath(); g.moveTo(x - 4 + sway, y - 3); g.quadraticCurveTo(x + sway, y - 7, x + 4 + sway, y - 3); g.quadraticCurveTo(x + sway, y - 4.5, x - 4 + sway, y - 3); g.fill();
}
