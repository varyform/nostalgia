// The page: demo mode with ?demo=on (the launcher's preview), else the game. See packages/game/src/host.ts.
import { host } from '@nostalgia/game/host';
import { boot } from './app.js';
import { createRenderer } from './hd/render.js';

const cv = document.getElementById('c');
host({
  // each load starts the attract run on a random tower
  demo: ({ reducedMotion }) => boot(cv, { demo: true, reducedMotion, renderer: createRenderer }),
  play: ({ sound, onExit }) => boot(cv, { sound, onExit, renderer: createRenderer }),
});
