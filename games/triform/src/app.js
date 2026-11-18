// The game session: input → actions, the screen flow (title, intro, play, pause, map, game
// over, victory), the attract-mode demo, sound and the saved best. It never draws: a
// renderer (vga/render.js today) reads this `app` object every frame.
import { fixedLoop, listeners, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createPilot } from './route.js';
import { DT, createSim } from './sim.js';

const BEST_KEY = 'triform-best';
// demo segments: start room, upgrades carried in, and where the segment ends
const DEMO = [
  { start: '1-1', ups: {}, until: '2-1' },
  { start: '2-1', ups: { blaster: true }, until: '3-1' },
  { start: '3-1', ups: { blaster: true, flame: true }, until: null },
];
const MUSIC = ['zone0', 'zone1', 'zone2', 'final'];

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer, segment } = {}) {
  const { listen, offAll } = listeners();

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const sim = createSim();
  const audio = demo ? null : createAudio({ on: sound });
  const view = renderer(cv);

  const saved = storage(BEST_KEY, { enabled: !demo });
  let best = { score: 0, time: 0, ...saved.load({}) };
  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: 0,
    sim, input, demo, onExit, best,
    get soundOn() { return audio ? audio.on : false; },
  };
  function setState(s) { app.state = s; app.stT = 0; }
  function saveBest() {
    if (demo) return;
    const won = sim.status === 'victory';
    const next = { score: Math.max(best.score, sim.score), time: won && (!best.time || sim.t < best.time) ? Math.round(sim.t) : best.time };
    best = app.best = next;
    saved.save(next);
  }

  // ---------- page plumbing (not in the demo) ----------
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    input.on('fullscreen', toggleFullscreen); // from the key event itself, as browsers require
    listen(cv, 'dblclick', toggleFullscreen);
    listen(window, 'blur', () => { if (app.state === 'play') setState('pause'); });
  }

  // ---------- input → actions ----------
  const ACTS = ['left', 'right', 'up', 'down', 'jump', 'attack', 'special', 'prev', 'next', 'form1', 'form2', 'form3'];
  const hit = a => input.pressed(a);
  function actions() {
    const out = {};
    for (const a of ACTS) out[a] = input.held(a) || input.pressed(a);
    return out;
  }

  // ---------- demo ----------
  let seg = segment ?? Math.floor(Math.random() * DEMO.length), pilot = null, demoT = 0, ending = 0;
  function startSegment() {
    const d = DEMO[seg % DEMO.length];
    sim.startAt(d.start, d.ups);
    pilot = createPilot(sim);
    demoT = 0; ending = 0; app.fade = 1;
  }
  function demoStep() {
    demoT += DT;
    const d = DEMO[seg % DEMO.length];
    const done = (d.until && sim.room.id === d.until) || sim.status === 'victory' || sim.status === 'gameover' || demoT > 240;
    if (done && !ending) ending = 1;
    if (ending) {
      app.fade = Math.min(1, app.fade + DT * 1.5);
      if (app.fade >= 1) { seg = (seg + 1) % DEMO.length; startSegment(); return; }
    } else app.fade = Math.max(0, app.fade - DT * 2);
    sim.step(pilot());
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    if (hit('sound')) audio.setOn(!audio.on);
    switch (app.state) {
      case 'title':
        if (hit('start')) { audio.sfx('select'); setState('intro'); }
        else if (onExit && (hit('quit') || hit('back'))) onExit();
        break;
      case 'intro':
        if (hit('start') && app.stT > 0.3) { sim.newGame(); setState('play'); }
        break;
      case 'play':
        if (hit('pause')) { setState('pause'); break; }
        if (hit('map')) { setState('map'); break; }
        sim.step(actions());
        if (sim.status === 'gameover') { saveBest(); setState('over'); }
        if (sim.status === 'victory') { saveBest(); setState('victory'); }
        break;
      case 'pause':
        if (hit('pause') || hit('back')) setState('play');
        else if (hit('restart')) { sim.retryRoom(); setState('play'); }
        else if (hit('quit')) { saveBest(); setState('title'); }
        break;
      case 'map':
        if (hit('map') || hit('pause') || hit('back')) setState('play');
        break;
      case 'over':
        sim.step({});
        if (app.stT > 1.2 && hit('start')) setState('title');
        break;
      case 'victory':
        if (app.stT > 2 && hit('start')) setState('title');
        break;
    }
  }

  function sound() {
    if (!audio) return;
    for (const e of sim.events) audio.sfx(e.type, e);
    const s = app.state;
    let track = null;
    if (s === 'title' || s === 'intro') track = 'title';
    else if (s === 'victory') track = 'victory';
    else if (s === 'play' || s === 'map' || s === 'pause') {
      const b = sim.boss;
      track = b && !b.dead ? (b.kind === 'foreman' ? 'final' : 'boss') : MUSIC[sim.room?.zone ?? 0];
    }
    audio.music(s === 'pause' || s === 'over' ? null : track);
    audio.flame(s === 'play' && !!sim.p?.flaming);
  }

  // ---------- loop ----------
  function tick() {
    update();
    view.events(sim.events, sim);
    sound();
    sim.events.length = 0;
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => view.draw(app) });
  if (demo) {
    startSegment();
    app.fade = 0;
    // a still demo shows the segment a few seconds in
    for (let i = 0, n = reducedMotion ? 60 * 9 : 1; i < n; i++) { demoStep(); sim.events.length = 0; }
    app.fade = 0;
  }
  if (demo && reducedMotion) loop.still();
  else loop.start();

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    loop.stop();
    offAll();
    input.destroy();
    view.destroy();
    audio?.destroy();
  }
  return { stop };
}
