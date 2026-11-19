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
  block: { dur: 0 }, // held: guards high+mid
  blockLow: { dur: 0 }, // held: guards low
  duck: { dur: 0 }, // held: high attacks and high darts pass over (Wren can duck in either stance)
  hit: { dur: 0.35 }, // staggered
  ko: { dur: 1.1 }, // falls; then lies still (fighter.down = true)
  bow: { dur: 1.2 },
  cheer: { dur: 1.5 }, // Wren after a KO / at the end
};

export const ATTACKS = Object.keys(MOVES).filter(k => MOVES[k].reach);
export const isAttack = move => !!MOVES[move].reach;
/** the attack for a button (punch/kick) and a height */
export const attackOf = (kind, h) => kind + h[0].toUpperCase() + h.slice(1);
