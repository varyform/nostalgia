// The game session: input → actions, the screen flow (title, level select, level card, play,
// pause, level clear, game over and continue, ending, editor), the attract-mode demo, sound,
// touch controls, the saved progress and the autosave behind the title's CONTINUE. It never draws: the renderer (hd/render.js) reads
// this `app` object every frame.
import { createHdr } from '@nostalgia/game/hdr';
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createEditor } from './editor.js';
import { createRenderer } from './hd/render.js';
import { LEVELS, WORLDS } from './levels.js';
import { createPilot } from './pilot.js';
import { ROUTES } from './routes.js';
import { DT, T, createSim } from './sim.js';
import { createTouch } from './touch.js';

const SAVE_KEY = 'glimmer-save';
const LIVES = 5, MAX_LIVES = 9;
const PLAY_KEYS = ['left', 'right', 'up', 'down', 'digL', 'digR'];

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
  const loaded = saved.load({});
  const save = {
    reached: Number.isInteger(loaded.reached) ? Math.max(0, Math.min(LEVELS.length - 1, loaded.reached)) : 0,
    best: loaded.best && typeof loaded.best === 'object' ? loaded.best : {},
    custom: Array.isArray(loaded.custom) ? loaded.custom.filter(c => c && Array.isArray(c.map)) : [],
    won: !!loaded.won,
  };
  const store = () => saved.save(save);
  // the checkpoint: the level the run stands at, with the score and lives it began it with
  const autosave = createAutosave('glimmer', { enabled: !demo, version: 1 });

  const freshRun = () => ({ score: 0, lives: LIVES, startScore: 0 });
  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, input, demo, onExit, save,
    level: 0, sel: 0, custom: null, // custom: the editor's level being test-played
    run: freshRun(), newBest: false, worldIntro: false, lifeUp: false,
    touch: null, editor: null, menu: 0, saved: autosave.load(),
    get soundOn() { return audio ? audio.on : false; },
    get def() { return app.custom ?? LEVELS[app.level]; },
    sfx: name => audio?.sfx(name),
  };
  const view = (renderer ?? createRenderer)(cv, app);
  const hdr = createHdr([cv], { enabled: !demo });
  app.hdr = hdr;
  function setState(s) {
    // back on the title: CONTINUE comes and goes with the checkpoint, and a new one is picked first
    if (s === 'title' && app.state !== 'title') {
      const was = app.saved?.at;
      app.saved = autosave.load();
      if (app.saved?.at !== was) app.menu = 0;
    }
    app.state = s; app.stT = 0;
  }

  // ---------- page plumbing (not in the demo) ----------
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', toggleFullscreen); // from the key event itself, as browsers require
    input.on('hdr', () => hdr.cycle());
    listen(cv, 'dblclick', () => { if (app.state !== 'editor') toggleFullscreen(); });
    onAway(listen, () => { if (app.state === 'play') setState('pause'); });
    app.touch = createTouch(cv, { listen });
    app.editor = createEditor(app, { listen, cv, save: () => store() });
  }

  // ---------- levels ----------
  function loadLevel(i, { fresh = false } = {}) {
    app.custom = null;
    app.level = i;
    if (fresh) app.run = freshRun();
    app.run.startScore = app.run.score;
    sim.load(LEVELS[i], { seed: (Math.random() * 1e9) | 0, score: app.run.score });
    app.worldIntro = LEVELS[i].index === 0;
    app.newBest = false; app.lifeUp = false;
    view.level?.(sim);
  }
  // a level of the campaign begins (or begins again after a lost life): its checkpoint
  function playLevel(i, opts) {
    loadLevel(i, opts);
    checkpoint(i);
    setState('ready');
  }
  function checkpoint(level) {
    const { score, lives } = app.run;
    autosave.save({ level, score, lives }, `Level ${LEVELS[level].id} · ${score.toLocaleString('en-US')}`);
  }
  function resume({ level, score, lives }) {
    app.run = { score: Math.max(0, score | 0), lives: Math.min(MAX_LIVES, Math.max(1, lives | 0)), startScore: 0 };
    loadLevel(Math.min(LEVELS.length - 1, Math.max(0, level | 0)));
    setState('ready');
  }
  function loadCustom(def) {
    app.custom = def;
    app.run = freshRun();
    sim.load(def, { seed: (Math.random() * 1e9) | 0 });
    app.worldIntro = false;
    view.level?.(sim);
  }
  function reload() {
    app.run.score = app.run.startScore;
    if (app.custom) { sim.load(app.custom, { seed: (Math.random() * 1e9) | 0, score: app.run.score }); view.level?.(sim); setState('ready'); }
    else playLevel(app.level);
  }
  function levelCleared() {
    const s = sim.s;
    app.run.score = s.score;
    if (app.run.lives < MAX_LIVES) { app.run.lives++; app.lifeUp = true; }
    if (app.custom || demo) return;
    const id = LEVELS[app.level].id, prev = save.best[id] ?? 0;
    if (s.levelScore > prev) { save.best[id] = s.levelScore; app.newBest = true; }
    save.reached = Math.max(save.reached, Math.min(LEVELS.length - 1, app.level + 1));
    if (app.level === LEVELS.length - 1) save.won = true;
    store();
    // the next level is where a run that stops on the clear screen picks up; the last one ends it
    if (app.level === LEVELS.length - 1) autosave.clear();
    else checkpoint(app.level + 1);
  }
  function lostLife() {
    app.run.lives--;
    if (app.run.lives <= 0) { audio?.sfx('gameover'); setState('over'); return; }
    reload();
  }

  // ---------- input → actions ----------
  const hit = a => input.pressed(a) || (app.touch?.taps.has(a) ?? false);
  function actions() {
    const out = {};
    for (const a of PLAY_KEYS) out[a] = input.held(a) || input.pressed(a);
    if (app.touch?.active) app.touch.apply(out);
    return out;
  }

  // ---------- demo: replay the recorded routes, level after level ----------
  let demoIdx = start ?? Math.floor(Math.random() * LEVELS.length), pilot = null, demoEnd = 0;
  function demoLoad() {
    const def = LEVELS[demoIdx], r = ROUTES[def.id];
    sim.load(def, { seed: r?.seed ?? 1 });
    pilot = createPilot(r?.route ?? '');
    demoEnd = 0;
    app.stT = 0;
    view.level?.(sim);
  }
  function demoStep() {
    const st = sim.s.status;
    if (!demoEnd && (st === 'clear' || st === 'dead' || (pilot.done() && st === 'play' && app.stT > 1))) demoEnd = st === 'clear' ? 1.6 : 1;
    if (demoEnd) {
      demoEnd -= DT;
      if (demoEnd < 0.6) app.fade = Math.min(1, app.fade + DT * 2.2);
      if (demoEnd <= 0 && app.fade >= 1) { demoIdx = (demoIdx + 1) % LEVELS.length; demoLoad(); }
    } else app.fade = Math.max(0, app.fade - DT * 2);
    sim.step(st === 'play' ? pilot() : undefined);
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
        if (hit('start')) {
          const it = items[app.menu];
          audio.sfx('select');
          if (it === 'continue') resume(app.saved.state);
          else if (it === 'play') { app.sel = save.reached; setState('select'); }
          else if (it === 'editor') { app.editor.open(); setState('editor'); }
          else if (it === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        break;
      }
      case 'select': {
        const cols = 8, n = LEVELS.length, move = d => { const next = app.sel + d; if (next >= 0 && next < n) { app.sel = next; audio.sfx('move'); } };
        if (hit('left')) move(-1);
        if (hit('right')) move(1);
        if (hit('up')) move(-cols);
        if (hit('down')) move(cols);
        const tp = app.touch?.tapAt, picked = tp ? view.tileAt?.(tp.x, tp.y) : null;
        if (tp && picked == null) { setState('title'); break; }
        if (picked != null) app.sel = picked;
        if (hit('start')) {
          if (app.sel <= save.reached) { audio.sfx('select'); playLevel(app.sel, { fresh: true }); }
          else audio.sfx('deny');
        } else if (hit('back') || hit('quit')) setState('title');
        break;
      }
      case 'ready':
        if (app.stT > (app.worldIntro ? 3 : 1.6) || (app.stT > 0.35 && (hit('start') || PLAY_KEYS.some(a => input.pressed(a))))) setState('play');
        break;
      case 'play': {
        if (hit('pause')) { setState('pause'); break; }
        if (hit('restart')) sim.die('gave up');
        sim.step(actions());
        const st = sim.s.status;
        if (st === 'clear' && sim.s.statusT === 1) levelCleared();
        if (st === 'clear' && sim.s.statusT > T.clear) setState('clear');
        if (st === 'dead') lostLife();
        break;
      }
      case 'pause':
        if (hit('pause') || hit('back') || hit('start')) setState('play');
        else if (hit('restart')) { setState('play'); sim.die('gave up'); }
        else if (hit('quit')) { if (app.custom) { app.editor.open(); setState('editor'); } else { app.sel = app.level; setState('select'); } }
        break;
      case 'clear':
        if (app.stT > 1.2 && hit('start')) {
          if (app.custom) { app.editor.open(); setState('editor'); }
          else if (app.level === LEVELS.length - 1) setState('ending');
          else playLevel(app.level + 1);
        } else if (app.stT > 1.2 && (hit('back') || hit('quit')) && !app.custom) { app.sel = Math.min(save.reached, app.level + 1); setState('select'); }
        break;
      case 'over':
        // declining the continue (or letting it run out) ends the run, and its checkpoint
        if (app.stT > 10) { if (!app.custom) autosave.clear(); setState('title'); break; }
        if (app.stT > 1 && hit('start')) {
          // continue: the same level, fresh lives, the score starts over
          if (app.custom) { loadCustom(app.custom); setState('ready'); } else playLevel(app.level, { fresh: true });
        } else if (app.stT > 1 && (hit('back') || hit('quit'))) { if (app.custom) { app.editor.open(); setState('editor'); } else { autosave.clear(); setState('title'); } }
        break;
      case 'ending':
        if (app.stT > 3 && hit('start')) setState('title');
        break;
      case 'editor': {
        const r = app.editor.update();
        if (r === 'play') { loadCustom(app.editor.def()); setState('ready'); }
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
    else if (s === 'play' || s === 'ready') track = 'w' + (app.def?.world ?? 0);
    audio.music(s === 'pause' || s === 'over' || s === 'clear' || (s === 'play' && sim.s.status !== 'play') ? null : track);
    if (s === 'clear' && app.stT === DT && app.lifeUp) audio.sfx('life');
  }

  // ---------- loop ----------
  function tick() {
    update();
    view.events(sim.events, sim);
    sound();
    sim.events.length = 0;
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => { view.draw(app); hdr.present(); } });
  if (demo) {
    demoLoad();
    // a still demo shows the level a few seconds in
    const n = reducedMotion ? 60 * 5 : 1;
    for (let i = 0; i < n; i++) { demoStep(); sim.events.length = 0; }
    app.fade = 0;
  } else {
    loadLevel(Math.min(save.reached, LEVELS.length - 1), { fresh: true }); // a backdrop for the title
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
    hdr.destroy();
    audio?.destroy();
  }
  app.worlds = WORLDS;
  return { stop };
}
