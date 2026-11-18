// The HD page: demo mode with ?demo=on (the launcher's preview), else the game. See packages/game/src/host.ts.
import { host } from '@nostalgia/game/host';
import { boot } from './app.js';
import { createHdAudio } from './hd/audio.js';
import { createHdRenderer } from './hd/render.js';

const cv = document.getElementById('c');
host({
  // each load starts the attract run in a random zone
  demo: ({ reducedMotion }) => boot(cv, { demo: true, reducedMotion, renderer: createHdRenderer }),
  play: ({ sound, onExit }) => boot(cv, { sound, onExit, renderer: createHdRenderer, score: createHdAudio }),
});
