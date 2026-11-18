// The CGA page: demo mode with ?demo=on (the launcher's preview), else the game. See packages/game/src/host.ts.
import { host } from '@nostalgia/game/host';
import { boot } from './app.js';
import { createCgaRenderer } from './cga/render.js';

const cv = document.getElementById('c');
host({
  // each load starts the attract run in a random venue
  demo: ({ reducedMotion }) => boot(cv, { demo: true, reducedMotion, renderer: createCgaRenderer, style: 'speaker' }),
  play: ({ sound, onExit }) => boot(cv, { sound, onExit, renderer: createCgaRenderer, style: 'speaker' }),
});
