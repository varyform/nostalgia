// Recorded routes: the inputs that climb a tower, found offline by tools/solve.mjs on this
// same deterministic simulation and stored in routes.js. The demo replays them, and
// tools/verify.mjs replays every one to prove each tower can be climbed in time.
//
// A route is a run of macros, each one input held for MACRO steps, written one letter per
// macro (the input bits, A = nothing) with an optional repeat count: "C12R3A". It starts when
// the tower's 'ready' pause ends and only advances while the tower is being played.
import { BONUS, fromBits } from './sim.js';

export const MACRO = 6;
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function encodeRoute(macros) {
  let out = '';
  for (let i = 0; i < macros.length; ) {
    let n = 1;
    while (macros[i + n] === macros[i]) n++;
    out += ABC[macros[i]] + (n > 1 ? n : '');
    i += n;
  }
  return out;
}
export function decodeRoute(str) {
  const macros = [];
  for (const [, ch, n] of str.matchAll(/([A-Za-z])(\d*)/g)) for (let k = +(n || 1); k > 0; k--) macros.push(ABC.indexOf(ch));
  return macros;
}

const IDLE = fromBits(0);
/** one input per step from a recorded route; idle outside play and once it runs out */
export function createRoutePilot(sim, str) {
  const inputs = decodeRoute(str).map(fromBits);
  let i = 0;
  const next = () => {
    const st = sim.s.status;
    if (st === 'bonus') return kitePilot(sim);
    if (st !== 'play' || i >= inputs.length * MACRO) return IDLE;
    return inputs[Math.floor(i++ / MACRO)];
  };
  next.done = () => i >= inputs.length * MACRO;
  return next;
}

// Kite Run: steer for the next sea-glass still in the air
export function kitePilot(sim) {
  const b = sim.s.bonus;
  if (!b || b.done) return IDLE;
  const kx = b.x + BONUS.kx;
  const g = b.gems.find(g => !g.got && g.x > kx - 0.3);
  if (!g) return IDLE;
  // where the kite will be when it gets there, falling gently on its own
  const lead = Math.max(0, (g.x - kx) / BONUS.speed);
  const ahead = b.ky + b.vy * Math.min(lead, 0.25);
  const want = g.y - ahead;
  return fromBits(want > 0.15 ? 4 : want < -0.25 ? 8 : 0);
}
