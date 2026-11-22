// The game session: input → the drill's input, the screen flow (title, play, pause, game over,
// initials for the score table), the attract-mode demo, sound, touch, the saved scores and
// the autosave (a checkpoint as each level begins, resumed from the title's CONTINUE).
// It never draws: a renderer (cga/render.js or hd/render.js) reads this `app` object every
// frame and implements { draw(app), events(list, sim), destroy() }.
import { createHdr } from '@nostalgia/game/hdr';
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave, savedAgo } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { LEVELS } from './levels.js';
import { createPilot } from './pilot.js';
import { DOWN, DT, LEFT, RIGHT, UP, createSim } from './sim.js';
import { createTouch } from './touch.js';

const SAVE_KEY = 'quarry-scores';
const TABLE = 10;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DEFAULT_TABLE = [
  ['ORE', 12000, 6], ['GEM', 10000, 5], ['PIT', 8000, 4], ['COG', 6500, 4], ['MUD', 5000, 3],
  ['TIN', 4000, 3], ['SOD', 3000, 2], ['ASH', 2000, 2], ['FLK', 1500, 1], ['CLY', 1000, 1],
].map(([n, s, l]) => ({ n, s, l }));
const DIRS = [['right', RIGHT], ['down', DOWN], ['left', LEFT], ['up', UP]];

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer, speaker = false, start = null } = {}) {
  const { listen, offAll } = listeners();

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const sim = createSim();
  const audio = demo ? null : createAudio({ on: sound, speaker });

  // ---------- the score table (never touched by the demo) ----------
  const saved = storage(SAVE_KEY, { enabled: !demo });
  let save = { table: DEFAULT_TABLE.map(e => ({ ...e })), last: 'AAA' };
  const got = saved.load(null);
  if (got && Array.isArray(got.table)) save = { table: got.table.slice(0, TABLE), last: typeof got.last === 'string' ? got.last : 'AAA' };
  const store = () => saved.save(save);
  // the autosave: where the current level began, kept apart from the score table
  const autosave = createAutosave('quarry', { enabled: !demo, version: 1 });
  const qualifies = score => score > 0 && (save.table.length < TABLE || score > save.table[save.table.length - 1].s);

  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: 0,
    sim, input, demo, onExit, save, menu: 0, page: 0, rank: -1,
    entry: { letters: 'AAA', pos: 0 }, touch: null, levels: LEVELS,
    get soundOn() { return audio ? audio.on : false; },
    get hi() { return Math.max(save.table[0]?.s ?? 0, sim.s?.score ?? 0); },
    saved: autosave.load(), savedAgo: () => (app.saved ? savedAgo(app.saved.at) : ''),
    items: () => [...(app.saved ? ['continue'] : []), 'play', ...(onExit ? ['exit'] : [])],
  };
  const view = renderer(cv, app);
  const hdr = createHdr([cv], { enabled: !demo });
  app.hdr = hdr;
  function setState(s) {
    app.state = s; app.stT = 0;
    if (s === 'title') { app.saved = autosave.load(); app.menu = 0; }
  }

  // ---------- page plumbing (not in the demo) ----------
  let typed = [];
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', toggleFullscreen); // from the key event itself, as browsers require
    input.on('hdr', () => { if (app.state !== 'entry') hdr.cycle(); });
    listen(cv, 'dblclick', toggleFullscreen);
    onAway(listen, () => { if (app.state === 'play') setState('pause'); });
    // initials can be typed straight in
    listen(window, 'keydown', e => { if (app.state === 'entry' && /^Key[A-Z]$/.test(e.code)) typed.push(e.code[3]); });
    app.touch = createTouch(cv, { listen });
  }

  // ---------- input → the drill ----------
  const hit = a => input.pressed(a) || (app.touch?.taps.has(a) ?? false);
  const order = []; // held directions, the newest last: it wins
  function controls() {
    for (const [a, d] of DIRS) {
      const held = input.held(a) || input.pressed(a), at = order.indexOf(d);
      if (input.pressed(a) && at >= 0) order.splice(at, 1);
      if (held && order.indexOf(d) < 0) order.push(d);
      if (!held && at >= 0) order.splice(order.indexOf(d), 1);
    }
    const out = { dir: order.length ? order[order.length - 1] : -1, fire: input.held('fire') || input.pressed('fire') };
    if (app.touch?.active) app.touch.apply(out);
    return out;
  }

  function newGame({ level = 0, seed = (Math.random() * 1e9) | 0, lives = 2, score = 0 } = {}) {
    sim.newGame({ level, seed, lives, score });
    view.level?.(sim);
    checkpoint();
  }
  // a checkpoint as each level begins: the level, the score and lives it begins on, and the
  // seed it begins from, so it starts again as it did
  function checkpoint() {
    const { level, score, lives, seed } = sim.s;
    autosave.save({ level, score, lives, seed }, `Level ${level + 1} · ${score.toLocaleString('en-US')}`);
  }
  function gameOver() {
    if (qualifies(sim.s.score)) {
      app.entry = { letters: save.last.padEnd(3, 'A').slice(0, 3), pos: 0 };
      typed = [];
      setState('entry');
    } else { app.page = 1; app.rank = -1; setState('title'); }
  }
  function submit() {
    const e = { n: app.entry.letters, s: sim.s.score, l: sim.s.level + 1 };
    save.table.push(e);
    save.table.sort((a, b) => b.s - a.s);
    save.table = save.table.slice(0, TABLE);
    save.last = e.n;
    app.rank = save.table.indexOf(e);
    store();
    app.page = 1;
    setState('title');
  }
  function entryStep() {
    const E = app.entry, L = E.letters.split('');
    const set = ch => { L[E.pos] = ch; E.letters = L.join(''); };
    const shift = k => { set(LETTERS[(LETTERS.indexOf(L[E.pos]) + k + LETTERS.length) % LETTERS.length]); audio?.sfx('tick'); };
    if (hit('up')) shift(1);
    if (hit('down')) shift(-1);
    if (app.touch?.swipe) shift(app.touch.swipe);
    if (hit('right') && E.pos < 2) { E.pos++; audio?.sfx('tick'); }
    if ((hit('left') || hit('back')) && E.pos > 0) { E.pos--; audio?.sfx('tick'); }
    while (typed.length) { set(typed.shift()); if (E.pos < 2) E.pos++; audio?.sfx('tick'); }
    if (input.pressed('start') && !input.pressed('fire')) { audio?.sfx('select'); submit(); return; }
    if (hit('fire') || app.touch?.taps.has('start')) {
      audio?.sfx('select');
      if (E.pos < 2) E.pos++; else submit();
    }
  }

  // ---------- demo: the autopilot, level after level ----------
  let demoLevel = start ?? Math.floor(Math.random() * LEVELS.length), pilot = null, demoSeed = (Math.random() * 1e6) | 0, demoEnd = 0;
  function demoLoad() {
    sim.newGame({ level: demoLevel, seed: demoSeed++, lives: 2 });
    pilot = createPilot(sim, { seed: demoSeed++ });
    view.level?.(sim);
    demoEnd = 0;
  }
  function demoStep() {
    const st = sim.s.status;
    if (st === 'over' && !demoEnd) demoEnd = 2.5;
    if (demoEnd) {
      demoEnd -= DT;
      if (demoEnd < 0.6) app.fade = Math.min(1, app.fade + DT * 2.2);
      if (demoEnd <= 0 && app.fade >= 1) { demoLevel = (sim.s.level + 1) % LEVELS.length; demoLoad(); }
    } else app.fade = Math.max(0, app.fade - DT * 2);
    sim.step(pilot());
  }

  // ---------- one fixed step ----------
  let lastLoad = -1;
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    app.touch?.update(app);
    if (hit('sound')) audio.setOn(!audio.on);
    switch (app.state) {
      case 'title': {
        const items = app.items();
        if (hit('up')) { app.menu = (app.menu + items.length - 1) % items.length; audio.sfx('tick'); }
        if (hit('down')) { app.menu = (app.menu + 1) % items.length; audio.sfx('tick'); }
        if (hit('left') || hit('right')) { app.page ^= 1; app.pageT = app.t; audio.sfx('tick'); }
        app.menu = Math.min(app.menu, items.length - 1);
        const tp = app.touch?.tapAt, tapped = tp ? view.menuAt?.(tp.x, tp.y) : null;
        if (tapped != null) app.menu = tapped;
        if (hit('start') || hit('fire')) {
          const it = items[app.menu];
          audio.sfx('select');
          if (it === 'continue') { newGame(app.saved.state); setState('play'); }
          else if (it === 'play') { newGame(); setState('play'); }
          else if (it === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        // the right-hand page turns by itself: how to play ⇄ the best diggers
        if (app.t - (app.pageT ?? 0) > 9) { app.page ^= 1; app.pageT = app.t; }
        break;
      }
      case 'play':
        if (hit('pause')) { setState('pause'); break; }
        sim.step(controls());
        if (sim.s.status === 'over' && sim.s.statusT > 3) { autosave.clear(); gameOver(); }
        break;
      case 'pause':
        if (hit('pause') || hit('back') || hit('start') || hit('fire')) setState('play');
        // the run isn't over: its checkpoint stays for CONTINUE, so the score goes to the table
        // when the run ends, not here as well (a quit then continued run would be entered twice)
        else if (hit('quit')) { app.page = 1; app.rank = -1; setState('title'); }
        break;
      case 'entry':
        entryStep();
        break;
    }
    app.touch?.clear();
  }

  function soundStep() {
    if (!audio) return;
    for (const e of sim.events) audio.sfx(e.type, e);
    const s = app.state, st = sim.s?.status;
    let track = null;
    if (s === 'title' || s === 'entry') track = 'title';
    else if (s === 'play' && (st === 'play' || st === 'ready')) track = sim.s.frenzy > 0 ? 'lamp' : sim.s.level % 2 ? 'dig2' : 'dig';
    audio.music(track);
  }

  // ---------- loop ----------
  function tick() {
    update();
    if (sim.s && sim.s.loadId !== lastLoad) {
      lastLoad = sim.s.loadId;
      view.level?.(sim);
      if (app.state === 'play') checkpoint(); // the next level, after a clear
    }
    view.events(sim.events, sim);
    soundStep();
    sim.events.length = 0;
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => { view.draw(app); hdr.present(); } });
  if (demo) {
    demoLoad();
    // a still demo shows the level a few seconds in
    const n = reducedMotion ? 60 * 7 : 1;
    for (let i = 0; i < n; i++) { demoStep(); sim.events.length = 0; }
    app.fade = 0;
  } else {
    sim.newGame({ level: 0, seed: 1, lives: 2 }); // a backdrop for the title
  }
  lastLoad = sim.s.loadId;
  view.level?.(sim);
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
  return { stop };
}
