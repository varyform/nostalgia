// The game session: input → actions, the screen flow (title, stage select, stage card, play,
// pause, stage clear, game over and continue, ending, editor), the attract-mode demo, sound,
// touch controls, the saved progress and the autosave (a checkpoint as each stage of a run
// begins, resumed from the title's CONTINUE). It never draws: the renderer (hd/render.js)
// reads this `app` object every frame.
import { fixedLoop, listeners, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave, savedAgo } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createEditor } from './editor.js';
import { createRenderer } from './hd/render.js';
import { createPilot } from './pilot.js';
import { ROUTES } from './routes.js';
import { DT, createSim } from './sim.js';
import { STAGES, WORLDS } from './stages.js';
import { createTouch } from './touch.js';

const SAVE_KEY = 'dewdrop-save';
const LIVES = 3;
const PLAY_KEYS = ['left', 'right', 'up', 'down', 'jump'];

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer = null, start = null } = {}) {
  const { listen, offAll } = listeners();

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const sim = createSim();
  const audio = demo ? null : createAudio({ on: sound });

  // ---------- saved progress (never touched by the demo) ----------
  const saved = storage(SAVE_KEY, { enabled: !demo });
  const save = { unlocked: 0, best: {}, custom: [], ...saved.load({}) };
  const store = () => saved.save(save);
  // the autosave: where the run's current stage began, kept apart from the progress above
  const autosave = createAutosave('dewdrop', { enabled: !demo, version: 1 });

  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, input, demo, onExit, save,
    stage: 0, sel: 0, custom: null, // custom: the editor's stage being test-played
    run: { score: 0, lives: LIVES, startScore: 0, startLives: LIVES, nextLife: 0 },
    over: { t: 0 }, newBest: false, worldIntro: false,
    touch: null, editor: null, menu: 0,
    saved: autosave.load(), savedAgo: () => (app.saved ? savedAgo(app.saved.at) : ''),
    get soundOn() { return audio ? audio.on : false; },
    get def() { return app.custom ?? STAGES[app.stage]; },
  };
  const view = (renderer ?? createRenderer)(cv, app);
  function setState(s) {
    app.state = s; app.stT = 0;
    if (s === 'title') { app.saved = autosave.load(); app.menu = 0; }
  }

  // ---------- page plumbing (not in the demo) ----------
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', toggleFullscreen); // from the key event itself, as browsers require
    listen(cv, 'dblclick', toggleFullscreen);
    listen(window, 'blur', () => { if (app.state === 'play') setState('pause'); });
    app.touch = createTouch(cv, { listen });
    app.editor = createEditor(app, { listen, cv, save: () => store() });
  }

  // ---------- stages ----------
  function loadStage(i, { fresh = false } = {}) {
    app.custom = null;
    app.stage = i;
    if (fresh) app.run = { score: 0, lives: LIVES, startScore: 0, startLives: LIVES, nextLife: 0 };
    const r = app.run;
    r.startScore = r.score; r.startLives = r.lives;
    const def = STAGES[i];
    sim.load(def, { world: def.world, seed: (Math.random() * 1e9) | 0, lives: r.lives, score: r.score, nextLife: r.nextLife });
    app.worldIntro = def.index === 0;
    app.newBest = false;
    view.stage?.(sim);
  }
  function loadCustom(def) {
    app.custom = def;
    app.run = { score: 0, lives: LIVES, startScore: 0, startLives: LIVES, nextLife: 0 };
    sim.load(def, { world: def.world ?? 0, seed: (Math.random() * 1e9) | 0 });
    app.worldIntro = false;
    view.stage?.(sim);
  }
  function retry() {
    const r = app.run;
    r.score = r.startScore; r.lives = r.startLives;
    if (app.custom) loadCustom(app.custom); else loadStage(app.stage);
  }
  function stageCleared() {
    const s = sim.s;
    app.run.score = s.score; app.run.lives = s.lives; app.run.nextLife = s.nextLife;
    if (app.custom || demo) return;
    const id = STAGES[app.stage].id, prev = save.best[id] ?? 0;
    if (s.tally.stage > prev) { save.best[id] = s.tally.stage; app.newBest = true; }
    save.unlocked = Math.max(save.unlocked, Math.min(STAGES.length - 1, app.stage + 1));
    if (app.stage === STAGES.length - 1) save.won = true;
    store();
    if (app.stage === STAGES.length - 1) autosave.clear(); // home: the run is over
    else checkpoint(app.stage + 1);
  }
  // a checkpoint: the stage the run is about to begin, with the score and lives it begins on
  function checkpoint(i) {
    const r = app.run;
    autosave.save({ stage: i, score: r.score, lives: r.lives, nextLife: r.nextLife }, `Stage ${STAGES[i].id} · ${r.score.toLocaleString('en-US')}`);
  }
  function resume({ stage, score, lives, nextLife }) {
    app.run = { score, lives, startScore: score, startLives: lives, nextLife };
    loadStage(Math.max(0, Math.min(STAGES.length - 1, stage)));
  }

  // ---------- input → actions ----------
  const hit = a => input.pressed(a) || (app.touch?.taps.has(a) ?? false);
  function actions() {
    const out = {};
    for (const a of PLAY_KEYS) out[a] = input.held(a) || input.pressed(a);
    if (app.touch?.active) app.touch.apply(out);
    return out;
  }

  // ---------- demo: replay the recorded routes, stage after stage ----------
  let demoIdx = start ?? Math.floor(Math.random() * STAGES.length), pilot = null, demoEnd = 0;
  function demoLoad() {
    const def = STAGES[demoIdx], r = ROUTES[def.id];
    sim.load(def, { world: def.world, seed: r?.seed ?? 1 });
    pilot = createPilot(r?.route ?? '');
    demoEnd = 0;
    view.stage?.(sim);
  }
  function demoStep() {
    const st = sim.s.status;
    if (!demoEnd && (st === 'clear' || st === 'over' || st === 'dying' || (pilot.done() && st === 'play' && app.stT > 1))) demoEnd = st === 'clear' ? 2.2 : 1;
    if (demoEnd) {
      demoEnd -= DT;
      if (demoEnd < 0.6) app.fade = Math.min(1, app.fade + DT * 2.2);
      if (demoEnd <= 0 && app.fade >= 1) { demoIdx = (demoIdx + 1) % STAGES.length; demoLoad(); app.stT = 0; }
    } else app.fade = Math.max(0, app.fade - DT * 2);
    sim.step(st === 'play' ? pilot() : {});
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    app.touch?.update(app);
    if (hit('sound')) audio.setOn(!audio.on);
    switch (app.state) {
      case 'title': {
        const items = titleItems();
        if (hit('up')) { app.menu = (app.menu + items.length - 1) % items.length; audio.sfx('move'); }
        if (hit('down')) { app.menu = (app.menu + 1) % items.length; audio.sfx('move'); }
        app.menu = Math.min(app.menu, items.length - 1);
        const tp = app.touch?.tapAt, tapped = tp ? view.menuAt?.(tp.x, tp.y) : null;
        if (tapped != null) app.menu = tapped;
        // ArrowUp is a jump key too: moving up the menu must not also pick
        if (hit('start') || (hit('jump') && !input.pressed('up'))) {
          const it = items[app.menu];
          audio.sfx('select');
          if (it === 'continue') { resume(app.saved.state); setState('ready'); }
          else if (it === 'play') { app.sel = save.unlocked; setState('select'); }
          else if (it === 'editor') { app.editor.open(); setState('editor'); }
          else if (it === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        break;
      }
      case 'select': {
        const cols = 6, n = STAGES.length, move = (d) => { const next = app.sel + d; if (next >= 0 && next < n) { app.sel = next; audio.sfx('move'); } };
        if (hit('left')) move(-1);
        if (hit('right')) move(1);
        if (hit('up')) move(-cols);
        if (hit('down')) move(cols);
        const tp = app.touch?.tapAt, picked = tp ? view.tileAt?.(tp.x, tp.y) : null;
        if (tp && picked == null) { setState('title'); break; }
        if (picked != null) app.sel = picked;
        if (hit('start') || hit('jump')) {
          if (app.sel <= save.unlocked) { audio.sfx('select'); loadStage(app.sel, { fresh: true }); checkpoint(app.sel); setState('ready'); }
          else audio.sfx('deny');
        } else if (hit('back') || hit('quit')) setState('title');
        break;
      }
      case 'ready':
        if (app.stT > (app.worldIntro ? 3.2 : 1.8) || (app.stT > 0.4 && (hit('start') || hit('jump')))) setState('play');
        break;
      case 'play': {
        if (hit('pause')) { setState('pause'); break; }
        sim.step(actions());
        const st = sim.s.status;
        if (st === 'clear' && sim.s.statusT >= DT && sim.s.statusT < DT * 1.5) stageCleared();
        if (st === 'clear' && sim.s.statusT > 1.4) setState('clear');
        if (st === 'over' && sim.s.statusT > 0.6) setState('over');
        break;
      }
      case 'pause':
        if (hit('pause') || hit('back') || hit('start')) setState('play');
        else if (hit('restart')) { retry(); setState('ready'); }
        else if (hit('quit')) { if (app.custom) { app.editor.open(); setState('editor'); } else { app.sel = app.stage; setState('select'); } }
        break;
      case 'clear':
        sim.step({});
        if (app.stT > 1.2 && (hit('start') || hit('jump'))) {
          if (app.custom) { app.editor.open(); setState('editor'); }
          else if (app.stage === STAGES.length - 1) setState('ending');
          else { loadStage(app.stage + 1); setState('ready'); }
        } else if (app.stT > 1.2 && (hit('back') || hit('quit')) && !app.custom) { app.sel = Math.min(save.unlocked, app.stage + 1); setState('select'); }
        break;
      case 'over':
        sim.step({});
        // the continue offer runs out or is turned down: the run is over, and so is its autosave
        if (app.stT > 10) { if (!app.custom) autosave.clear(); setState('title'); break; }
        if (app.stT > 0.8 && (hit('start') || hit('jump'))) {
          // continue: same stage, fresh lives, the score starts over
          app.run = { score: 0, lives: LIVES, startScore: 0, startLives: LIVES, nextLife: 0 };
          if (app.custom) loadCustom(app.custom); else { loadStage(app.stage); checkpoint(app.stage); }
          setState('ready');
        } else if (app.stT > 0.8 && (hit('back') || hit('quit'))) {
          if (!app.custom) autosave.clear();
          setState(app.custom ? 'editor' : 'title');
        }
        break;
      case 'ending':
        if (app.stT > 3 && (hit('start') || hit('jump'))) setState('title');
        break;
      case 'editor': {
        const r = app.editor.update();
        if (r === 'play') { loadCustom(app.editor.stage()); setState('ready'); }
        else if (r === 'exit') setState('title');
        break;
      }
    }
    app.touch?.clear();
  }
  const titleItems = () => [...(app.saved ? ['continue'] : []), 'play', 'editor', ...(onExit ? ['exit'] : [])];
  app.titleItems = titleItems;

  function sound() {
    if (!audio) return;
    for (const e of sim.events) audio.sfx(e.type, e);
    const s = app.state;
    let track = null;
    if (s === 'title' || s === 'select' || s === 'editor') track = 'title';
    else if (s === 'ending') track = 'ending';
    else if (s === 'play' || s === 'ready' || s === 'pause') track = sim.s?.hurry ? 'hurry' : 'w' + (app.def?.world ?? 0);
    audio.music(s === 'pause' || s === 'over' || s === 'clear' ? null : track);
    if (s === 'select' && app.stT === DT) audio.sfx('select');
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
    demoLoad();
    // a still demo shows the stage a few seconds in
    const n = reducedMotion ? 60 * 4 : 1;
    for (let i = 0; i < n; i++) { demoStep(); sim.events.length = 0; }
    app.fade = 0;
  } else {
    loadStage(Math.min(save.unlocked, STAGES.length - 1), { fresh: true }); // a backdrop for the title
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
  app.worlds = WORLDS;
  return { stop };
}
