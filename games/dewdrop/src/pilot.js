// Recorded routes: the inputs that clear a stage, found offline by tools/solve.mjs on this
// same deterministic simulation and stored in routes.js. The demo replays them, and
// tools/verify.mjs replays every one of them to prove each stage can be cleared.
//
// A route is a run of macros, each one input held for MACRO steps, written one letter per
// macro (the input bits, A = nothing) with an optional repeat count: "C12R3A".
import { fromBits } from './sim.js';

export const MACRO = 6;
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';

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
  for (const [, ch, n] of str.matchAll(/([A-Za-f])(\d*)/g)) for (let k = +(n || 1); k > 0; k--) macros.push(ABC.indexOf(ch));
  return macros;
}

// a pilot hands out one input per step, then nothing once the route runs out
export function createPilot(str) {
  const macros = decodeRoute(str), inputs = macros.map(fromBits), idle = fromBits(0);
  let i = 0;
  const next = () => (i < macros.length * MACRO ? inputs[Math.floor(i++ / MACRO)] : idle);
  next.done = () => i >= macros.length * MACRO;
  return next;
}
