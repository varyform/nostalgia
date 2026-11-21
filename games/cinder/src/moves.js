// Every timed move a fighter can be in. The sim times them, the renderer animates them from
// moveT / dur and the audio keys off the events they raise. Seconds at tempo 1: a fighter's
// `tempo` scales how fast its ATTACKS run (moveT advances by DT·tempo), so a slow footman's
// punch has the same shape as Wren's, only longer, and moveT / dur stays the right fraction.
//
// An attack lands at most once, on the first step of its window [on, off) that finds its
// target within `reach` metres (centre to centre). The windup (0 … on) is the tell.
export const HEIGHTS = ['high', 'mid', 'low'];

export const MOVES = {
  idle: { dur: 0 }, // loops (render uses s.t)
  walk: { dur: 0 }, // guard-stance shuffle step, phase from fighter.phase
  run: { dur: 0 }, // run-stance walk/run cycle, phase from fighter.phase
  stance: { dur: 0.25 }, // switching run <-> guard (fighter.stance is the stance it ENDS in)
  punchHigh: { dur: 0.5, on: 0.24, off: 0.32, reach: 1.2, height: 'high', dmg: 1 },
  punchMid: { dur: 0.48, on: 0.23, off: 0.31, reach: 1.2, height: 'mid', dmg: 1 },
  punchLow: { dur: 0.52, on: 0.25, off: 0.33, reach: 1.15, height: 'low', dmg: 1 },
  kickHigh: { dur: 0.74, on: 0.36, off: 0.46, reach: 1.6, height: 'high', dmg: 2 },
  kickMid: { dur: 0.7, on: 0.34, off: 0.44, reach: 1.65, height: 'mid', dmg: 2 },
  kickLow: { dur: 0.72, on: 0.35, off: 0.45, reach: 1.65, height: 'low', dmg: 2 },
  // the Regent's open-palm strike: a long, plain windup, can't be blocked, passes over a duck
  palm: { dur: 1.5, on: 0.9, off: 1.04, reach: 1.7, height: 'high', dmg: 3, unblockable: true },
  // Specials. `fx` is what a clean hit does: 'fall' knocks the target down (it lies, then gets
  // up), 'spin' spins it round, reeling. `travel` [metres, from, to] carries the fighter along as
  // the move plays (+ forward, a smoothstep over that fraction of `dur`); its rig move stays put
  // under the root, so the two add up (tools/rig-specials.mjs takes it out of the motion).
  uppercut: { dur: 0.62, on: 0.28, off: 0.36, reach: 1.15, height: 'high', dmg: 2, fx: 'fall' },
  roundhouse: { dur: 0.9, on: 0.44, off: 0.54, reach: 1.75, height: 'high', dmg: 3, fx: 'spin' },
  spinKick: { dur: 1.0, on: 0.56, off: 0.66, reach: 1.8, height: 'high', dmg: 3, fx: 'spin' },
  sideKick: { dur: 0.85, on: 0.42, off: 0.54, reach: 1.6, height: 'mid', dmg: 2, fx: 'fall', travel: [0.9, 0.08, 0.5] },
  backKick: { dur: 0.8, on: 0.42, off: 0.52, reach: 1.65, height: 'mid', dmg: 3, fx: 'fall' },
  sweep: { dur: 0.8, on: 0.4, off: 0.52, reach: 1.55, height: 'low', dmg: 1, fx: 'fall' },
  // evasions: `evade` [from, to, heights] — what passes harmlessly by in that span (s)
  backflip: { dur: 0.8, travel: [-1.5, 0.1, 0.85], evade: [0.06, 0.62, 'high mid low'] },
  sway: { dur: 0.55, evade: [0.04, 0.46, 'high mid'] },
  cartwheel: { dur: 0.9, travel: [-1.8, 0.08, 0.9], evade: [0.08, 0.75, 'high mid low'] },
  block: { dur: 0 }, // held: guards high+mid
  blockLow: { dur: 0 }, // held: guards low
  duck: { dur: 0 }, // held: high attacks and high darts pass over (Wren can duck in either stance)
  hit: { dur: 0.35 }, // staggered
  ko: { dur: 1.1 }, // falls; then lies still (fighter.down = true)
  fall: { dur: 1.1 }, // knocked down (the KO's fall), then lies a while: nothing lands on it
  getup: { dur: 0.8, travel: [-0.86, 0, 1] }, // up from where the fall left the body
  spun: { dur: 0.9 }, // spun round by a big kick: reeling, wide open
  bow: { dur: 1.2 },
  cheer: { dur: 1.5 }, // Wren after a KO / at the end
};

export const ATTACKS = Object.keys(MOVES).filter(k => MOVES[k].reach);
/** whether an attack is a kick (sounds and blows; everything else is a punch) */
export const isKick = move => /^kick|Kick$|roundhouse|sweep/.test(move);
/** the travel's fraction done at move time t (smoothstep over its span), 0 without one */
export function travelAt(move, t) {
  const M = MOVES[move], tr = M?.travel;
  if (!tr) return 0;
  const q = Math.min(1, Math.max(0, (t / M.dur - tr[1]) / (tr[2] - tr[1])));
  return tr[0] * q * q * (3 - 2 * q);
}
export const isAttack = move => !!MOVES[move].reach;
/** the attack for a button (punch/kick) and a height */
export const attackOf = (kind, h) => kind + h[0].toUpperCase() + h.slice(1);
