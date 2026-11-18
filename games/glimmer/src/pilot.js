// Recorded routes: the inputs that clear a level, found offline by tools/solve.mjs on this same
// deterministic simulation and stored in routes.js. The demo replays them, and tools/verify.mjs
// replays every one to prove each level can be cleared with the sentinels on.
//
// A route is a run of macros, one action held for a macro, one letter per macro (A still,
// B left, C right, D up, E down, F dig left, G dig right) with an optional repeat count: "C12F".
// A move lasts one tile's worth of steps, a dig as long as digging takes.
import { U } from './level.js';
import { T, fromAction } from './sim.js';

export const macroLen = a => (a === 5 || a === 6 ? T.dig : U);
const ABC = 'ABCDEFG';

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
  for (const [, ch, n] of str.matchAll(/([A-G])(\d*)/g)) for (let k = +(n || 1); k > 0; k--) macros.push(ABC.indexOf(ch));
  return macros;
}

// a pilot hands out one input per step, then nothing once the route runs out
export function createPilot(str) {
  const steps = [];
  for (const a of decodeRoute(str)) for (let k = macroLen(a); k > 0; k--) steps.push(a);
  let i = 0;
  const next = () => fromAction(i < steps.length ? steps[i++] : 0);
  next.done = () => i >= steps.length;
  return next;
}
