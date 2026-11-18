// The page: demo mode with ?demo=on (the launcher's preview), else the game. See packages/game/src/host.ts.
import { host } from '@nostalgia/game/host';
import { createPilot } from './autopilot.js';
import { boot } from './game.js';

const cv = document.getElementById('game');
host({
  // each load shows a random operation: dusk, night, arid
  demo: ({ reducedMotion }) => boot(cv, { demo: true, reducedMotion, op: Math.floor(Math.random() * 3), pilot: createPilot }),
  play: ({ sound, onExit }) => boot(cv, { sound, onExit }),
});
