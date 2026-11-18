// The page: demo mode with ?demo=on (the launcher's preview), else the game. See packages/game/src/host.ts.
import { host } from '@nostalgia/game/host';
import { boot } from './hd.js';

const cv = document.getElementById('c');
host({
  // each load flies a random mission
  demo: ({ reducedMotion }) => boot(cv, { demo: true, reducedMotion, mission: Math.floor(Math.random() * 5) }),
  play: ({ sound, onExit }) => boot(cv, { sound, onExit }),
});
