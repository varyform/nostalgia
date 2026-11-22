// The page: demo mode with ?demo=on (the launcher's preview), else the game. See packages/game/src/host.ts.
import { host } from '@nostalgia/game/host';
import { boot } from './app.js';
import { createRenderer } from './hd/render.js';

const canvases = { gl: document.getElementById('gl'), hud: document.getElementById('c') };
host({
  // each load starts the attract match: two tour players, a random venue
  demo: ({ reducedMotion }) => boot(canvases, { demo: true, reducedMotion, renderer: createRenderer }),
  play: ({ sound, onExit }) => boot(canvases, { sound, onExit, renderer: createRenderer }),
});
