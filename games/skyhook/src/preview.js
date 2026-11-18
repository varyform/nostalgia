// Launcher preview (attract mode): the real game, flown by its autopilot. See packages/game/src/meta.ts.
import { boot as cga } from './cga.js';
import { boot as hd } from './hd.js';

const MISSIONS = 5;
// each mount flies the next mission, starting from a random one
let next = Math.floor(Math.random() * MISSIONS);

/** @type {import('@nostalgia/game').Preview} */
export default function preview(canvas, { version, reducedMotion }) {
  const boot = version === 'cga' ? cga : hd;
  return boot(canvas, { preview: true, reducedMotion, mission: next++ % MISSIONS });
}
