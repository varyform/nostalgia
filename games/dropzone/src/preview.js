// The launcher's attract mode: the real game loop on the host's canvas, flown by the autopilot.
import { boot } from './game.js';
import { createPilot } from './autopilot.js';

// each mount shows the next operation: dusk, night, arid…
let mounts = 0;

/** @type {import('@nostalgia/game').Preview} */
export default function preview(canvas, { reducedMotion }) {
  return boot(canvas, { preview: true, reducedMotion, op: mounts++, pilot: createPilot });
}
