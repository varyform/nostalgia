// The page: demo mode with ?demo=on (the launcher's preview), else the game. See packages/game/src/host.ts.
import { host } from '@nostalgia/game/host';
import { boot } from './app.js';

const cv = document.getElementById('c');
host({
  demo: ({ reducedMotion }) => boot(cv, { demo: true, reducedMotion }),
  play: ({ sound, onExit }) => boot(cv, { sound, onExit }),
});
