// The game session: input → steering, the screen flow (title, high scores, stage card, play,
// pause, game over, initials), the autosave checkpoint behind CONTINUE, the attract-mode demo
// (and the living flats behind the title), sound, touch and the saved high-score table. It
// never draws: the renderer (hd/render.js) reads this `app` object every frame and answers
// hit tests. On an upright phone the field is drawn turned a quarter, so the arrows (and the
// stick) are turned with it before they reach the sim.
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave, savedAgo } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createRenderer } from './hd/render.js';
import { createPilot } from './pilot.js';
import { CLEAR_T, DT, LIFE_EVERY, STAGES, STATE_VERSION, createSim, trackOf, validState } from './sim.js';
import { createTouch } from './touch.js';

const SCORES_KEY = 'polder-scores', TABLE = 8;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const DEFAULT_SCORES = [
  ['MRN', 240000, 9], ['HRN', 180000, 7], ['OYS', 130000, 5], ['GUL', 90000, 4],
  ['KLP', 60000, 3], ['SLT', 36000, 2], ['RED', 18000, 1], ['EEL', 8000, 0],
].map(([name, score, stage]) => ({ name, score, stage, loop: 0 }));
const DIRS = ['left', 'right', 'up', 'down'];
// the arrows on a field turned a quarter clockwise
const TURN = { left: 'down', right: 'up', up: 'left', down: 'right' };
const fmt = n => Math.max(0, n | 0).toLocaleString('en-US');
export const saveLabel = st => `Stage ${st.stage + 1} · ${fmt(st.score)}`;

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null } = {}) {
  const { listen, offAll } = listeners();
  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const sim = createSim({ seed: (Math.random() * 2 ** 31) | 0 });
  sim.newGame();
  const audio = demo ? null : createAudio({ on: sound });

  // ---------- saved data (never touched by the demo) ----------
  const saved = storage(SCORES_KEY, { enabled: !demo });
  let scores = DEFAULT_SCORES.map(s => ({ ...s }));
  const got = saved.load(null);
  if (Array.isArray(got) && got.length)
    scores = got.filter(s => s && typeof s.score === 'number' && typeof s.name === 'string').map(s => ({ ...s, stage: Number.isInteger(s.stage) ? s.stage : 0, loop: Number.isInteger(s.loop) ? s.loop : 0 })).slice(0, TABLE);
  const autosave = createAutosave('polder', { enabled: !demo, version: STATE_VERSION });
  const validSave = r => (r && validState(r.state) ? r : null);
  let resume = validSave(autosave.load());
  const checkpoint = () => { const st = sim.state(); autosave.save(st, saveLabel(st)); };

  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, back: null, input, demo, onExit, scores, menu: 0, pmenu: 0, newRank: -1,
    entry: { letters: [0, 0, 0], pos: 0 },
    touch: null,
    get soundOn() { return audio ? audio.on : false; },
    get resume() { return resume; },
    resumeAgo: () => (resume ? savedAgo(resume.at) : ''),
    titleItems: () => [...(resume ? ['continue'] : []), 'play', 'scores', ...(onExit ? ['exit'] : [])],
  };
  const view = createRenderer(cv, app);
  function setState(s) { app.state = s; app.stT = 0; }
  const sfx = (name, e) => audio?.sfx(name, e);

  // ---------- page plumbing (not in the demo) ----------
  let typed = false;
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => { if (app.state !== 'initials') toggleFullscreen(); }); // from the key event itself
    listen(cv, 'dblclick', () => toggleFullscreen());
    onAway(listen, () => { if (app.state === 'play') { app.pmenu = 0; setState('pause'); } });
    listen(window, 'keydown', e => {
      if (app.state !== 'initials' || !/^Key[A-Z]$/.test(e.code)) return;
      const E = app.entry;
      E.letters[E.pos] = LETTERS.indexOf(e.code.slice(3));
      if (E.pos < 2) E.pos++;
      typed = true; // the same key may also be bound to a move: ignore that this step
      sfx('tick');
    });
    app.touch = createTouch(cv, { listen, view });
  }

  // ---------- high scores ----------
  const qualifies = score => score > 0 && (scores.length < TABLE || score > scores[scores.length - 1].score);
  function saveScore(name) {
    const entry = { name, score: sim.score, stage: sim.stage, loop: sim.loop };
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    scores.length = Math.min(scores.length, TABLE);
    app.scores = scores;
    app.newRank = scores.indexOf(entry);
    saved.save(scores);
  }

  // ---------- input → steering ----------
  const taps = () => app.touch?.taps ?? [];
  const tapped = act => taps().some(h => h.act === act);
  const hit = a => input.pressed(a) || tapped(a);
  let recent = null, lastTouch = null;
  function steering() {
    let press = null;
    for (const a of DIRS) if (input.pressed(a)) { press = a; recent = a; }
    let dir = recent && input.held(recent) ? recent : (DIRS.find(a => input.held(a)) ?? null);
    const td = app.touch?.dir ?? null;
    if (td) { dir = td; if (td !== lastTouch) press = td; }
    lastTouch = td;
    if (view.rotated) { dir = dir && TURN[dir]; press = press && TURN[press]; }
    return { dir, press };
  }

  // ---------- the flats behind the title: the autopilot keeps working them ----------
  let backPilot = null;
  function backdrop() {
    const b = createSim({ seed: (Math.random() * 2 ** 31) | 0 });
    b.resume({ stage: Math.floor(Math.random() * STAGES.length), loop: 0, score: 0, lives: 3, nextLife: LIFE_EVERY, seed: (Math.random() * 2 ** 31) >>> 0 });
    b.lives = 99;
    backPilot = createPilot(b, { sloppy: 0.3, seed: (Math.random() * 1e6) | 0, budget: 30 });
    b.events.length = 0;
    app.back = b;
  }
  function stepBack() {
    const b = app.back;
    if (!b) return;
    b.step(backPilot());
    if ((b.status === 'clear' && b.statusT > 2.5) || b.status === 'over' || b.t > 150) backdrop();
  }

  // ---------- demo: the autopilot works one stage after another ----------
  let pilot = null, demoT = 0, ending = 0;
  function startDemo(stage = Math.floor(Math.random() * STAGES.length)) {
    sim.reseed((Math.random() * 2 ** 31) | 0);
    sim.resume({ stage, loop: 0, score: 0, lives: 3, nextLife: LIFE_EVERY, seed: (Math.random() * 2 ** 31) >>> 0 });
    pilot = createPilot(sim, { sloppy: 0.35, seed: (Math.random() * 1e6) | 0, budget: 32 });
    demoT = 0; ending = 0;
  }
  function demoStep() {
    demoT += DT;
    const next = sim.status === 'clear' && sim.statusT > 3;
    const done = next || (sim.status === 'over' && sim.statusT > 1.2) || demoT > 140;
    if (done && !ending) ending = next ? 2 : 1;
    if (ending) {
      app.fade = Math.min(1, app.fade + DT * 1.6);
      if (app.fade >= 1) {
        if (ending === 2) { sim.advance(); pilot = createPilot(sim, { sloppy: 0.35, seed: (Math.random() * 1e6) | 0, budget: 32 }); demoT = 0; ending = 0; }
        else startDemo();
      }
      return;
    }
    app.fade = Math.max(0, app.fade - DT * 2);
    sim.step(pilot());
  }

  function newGame(from = null) {
    sim.reseed((Math.random() * 2 ** 31) | 0);
    if (from) sim.resume(from.state);
    else sim.newGame();
    checkpoint();
    resume = null;
    setState('card');
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    app.touch?.update(app);
    if (hit('sound') && app.state !== 'initials') audio.setOn(!audio.on);
    const tap = taps().length > 0;
    if (app.state === 'title' || app.state === 'scores' || app.state === 'initials') { if (!app.back) backdrop(); stepBack(); }
    switch (app.state) {
      case 'title': {
        const items = app.titleItems();
        app.menu = Math.min(app.menu, items.length - 1);
        if (input.pressed('up')) { app.menu = (app.menu + items.length - 1) % items.length; sfx('tick'); }
        if (input.pressed('down')) { app.menu = (app.menu + 1) % items.length; sfx('tick'); }
        const m = taps().find(h => h.act === 'menu');
        if (m) app.menu = m.i;
        if (input.pressed('start') || m) {
          const it = items[app.menu];
          sfx('select');
          if (it === 'continue') newGame(resume);
          else if (it === 'play') newGame();
          else if (it === 'scores') { app.newRank = -1; setState('scores'); }
          else if (it === 'exit') onExit?.();
        } else if (onExit && input.pressed('quit')) onExit();
        else if (app.stT > 20) { app.newRank = -1; setState('scores'); }
        break;
      }
      case 'scores':
        if ((app.stT > 0.4 && (input.pressed('start') || input.pressed('back') || input.pressed('quit') || tap)) || app.stT > 12) { app.menu = 0; setState('title'); }
        break;
      case 'card':
        if (app.stT > 3.2 || (app.stT > 0.5 && (input.pressed('start') || tap))) setState('play');
        break;
      case 'play': {
        if (input.pressed('pause') || tapped('pause')) { app.pmenu = 0; setState('pause'); break; }
        sim.step(steering());
        if (sim.status === 'clear' && sim.statusT > CLEAR_T) { sim.advance(); checkpoint(); setState('card'); }
        else if (sim.status === 'over' && sim.statusT > 0.6) { autosave.clear(); resume = null; setState('over'); }
        break;
      }
      case 'pause': {
        if (input.pressed('up') || input.pressed('down')) { app.pmenu = 1 - app.pmenu; sfx('tick'); }
        const m = taps().find(h => h.act === 'pmenu');
        if (m) app.pmenu = m.i;
        if (input.pressed('pause') || input.pressed('back') || ((input.pressed('start') || m) && app.pmenu === 0)) setState('play');
        else if (input.pressed('quit') || ((input.pressed('start') || m) && app.pmenu === 1)) {
          resume = validSave(autosave.load()); app.menu = 0; setState('title');
        }
        break;
      }
      case 'over':
        if (app.stT > 8 || (app.stT > 1.4 && (input.pressed('start') || tap))) {
          if (qualifies(sim.score)) { app.entry = { letters: [0, 0, 0], pos: 0 }; setState('initials'); }
          else { app.newRank = -1; app.menu = 0; setState('scores'); }
        }
        break;
      case 'initials': {
        const E = app.entry, n = LETTERS.length;
        const acts = new Set(taps().map(h => h.act));
        const skip = typed;
        typed = false;
        const press = a => (!skip && input.pressed(a)) || acts.has(a);
        if (press('up')) { E.letters[E.pos] = (E.letters[E.pos] + 1) % n; sfx('tick'); }
        if (press('down')) { E.letters[E.pos] = (E.letters[E.pos] + n - 1) % n; sfx('tick'); }
        if (press('left') || input.pressed('back')) { E.pos = Math.max(0, E.pos - 1); sfx('tick'); }
        if (press('right')) { E.pos = Math.min(2, E.pos + 1); sfx('tick'); }
        const pick = taps().find(h => h.act === 'letter');
        if (pick) E.pos = pick.i;
        if (press('start') || acts.has('ok')) {
          if (E.pos < 2 && !acts.has('ok')) { E.pos++; sfx('tick'); }
          else { saveScore(E.letters.map(i => LETTERS[i]).join('')); sfx('select'); app.menu = 0; setState('scores'); }
        }
        break;
      }
    }
    app.touch?.clear();
  }

  // ---------- sound ----------
  let lastBounce = 0;
  function sound() {
    if (!audio) return;
    if (app.state === 'play' || app.state === 'card') {
      for (const e of sim.events) {
        if (e.type === 'bounce') {
          // sparse: one now and then, never a clatter
          if (e.who === 'crab' || app.t - lastBounce < 0.45 || Math.random() < 0.5) continue;
          lastBounce = app.t;
        }
        if (e.type === 'wake' && e.n % 2) continue;
        audio.sfx(e.type, e);
      }
    }
    const s = app.state;
    let track = null;
    if (s === 'title' || s === 'scores' || s === 'initials') track = 'title';
    else if (s === 'play' || s === 'pause') track = sim.status === 'over' || sim.status === 'clear' ? null : trackOf(sim.stage);
    audio.music(track);
    if (s === 'card' && app.stT === DT) sfx('card');
  }

  // ---------- loop ----------
  function tick() {
    update();
    if (app.back && (app.state === 'title' || app.state === 'scores' || app.state === 'initials')) view.events(app.back.events, app.back);
    if (app.back) app.back.events.length = 0;
    view.events(sim.events, sim);
    sound();
    sim.events.length = 0;
    if (app.state === 'play' && app.back) app.back = null; // the title's flats are made afresh next time
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => view.draw(app) });
  if (demo) {
    startDemo();
    // a few seconds in already, so the preview shows some meadow (a still demo: well in)
    const n = reducedMotion ? 60 * 20 : Math.floor(Math.random() * 60 * 12);
    for (let i = 0; i < n && sim.status !== 'over'; i++) { sim.step(pilot()); sim.events.length = 0; }
    if (sim.status === 'over' || sim.status === 'clear') startDemo();
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
