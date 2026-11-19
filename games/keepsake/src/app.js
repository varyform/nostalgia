// The game session: input → actions, the screen flow (title, high scores, scene card, play,
// pause, game over, initials), the autosave checkpoint behind CONTINUE, the attract-mode demo,
// sound, touch and the saved high-score table. It never draws: the renderer (hd/render.js)
// reads this `app` object every frame and answers touch hit tests.
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave, savedAgo } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createRenderer } from './hd/render.js';
import { createPilot } from './pilot.js';
import { SCENES } from './scenes.js';
import { CLEAR_T, DT, createSim } from './sim.js';
import { createTouch } from './touch.js';

const SCORES_KEY = 'keepsake-scores';
const TABLE = 8;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const DEFAULT_SCORES = [
  ['WCK', 60000, 2, 1], ['CLM', 45000, 1, 1], ['RMB', 30000, 0, 1], ['GUS', 22000, 2, 0],
  ['MAB', 15000, 1, 0], ['OTT', 10000, 1, 0], ['PIA', 6000, 0, 0], ['ROO', 3000, 0, 0],
].map(([name, score, scene, loop]) => ({ name, score, scene, loop }));
const PLAY_KEYS = ['left', 'right', 'up', 'down', 'punch'];
const fmt = n => Math.max(0, n | 0).toLocaleString('en-US');
// a checkpoint's line on the title
export const saveLabel = st => `Scene ${st.stage + 1} · ${fmt(st.score)}`;

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null } = {}) {
  const { listen, offAll } = listeners();

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const sim = createSim({ seed: (Math.random() * 1e9) | 0 });
  sim.newGame(); // so there is always a scene to draw
  const audio = demo ? null : createAudio({ on: sound });

  // ---------- saved data (never touched by the demo) ----------
  const saved = storage(SCORES_KEY, { enabled: !demo });
  let scores = DEFAULT_SCORES.map(s => ({ ...s }));
  const got = saved.load(null);
  if (Array.isArray(got) && got.length) scores = got.filter(s => s && typeof s.score === 'number' && typeof s.name === 'string').slice(0, TABLE);
  const autosave = createAutosave('keepsake', { enabled: !demo, version: 1 });
  let resume = autosave.load();
  const validSave = r => {
    const st = r?.state;
    return st && Number.isInteger(st.scene) && st.scene >= 0 && st.scene < SCENES.length && Number.isInteger(st.loop) && st.loop >= 0
      && Number.isFinite(st.score) && Number.isInteger(st.lives) && st.lives > 0 ? r : null;
  };
  resume = validSave(resume);
  function checkpoint() {
    const st = { scene: sim.scene, loop: sim.loop, stage: sim.stage, score: sim.score, lives: sim.lives, nextLife: sim.nextLife };
    autosave.save(st, saveLabel(st));
  }

  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, input, demo, onExit, scores, menu: 0, newRank: -1,
    entry: { letters: [0, 0, 0], pos: 0 },
    touch: null, scenes: SCENES,
    get soundOn() { return audio ? audio.on : false; },
    get resume() { return resume; },
    resumeAgo: () => (resume ? savedAgo(resume.at) : ''),
    titleItems: () => [...(resume ? ['continue'] : []), 'play', 'scores', ...(onExit ? ['exit'] : [])],
  };
  const view = createRenderer(cv, app);
  function setState(s) { app.state = s; app.stT = 0; }

  // ---------- page plumbing (not in the demo) ----------
  let typed = false;
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => { if (app.state !== 'initials') toggleFullscreen(); }); // from the key event itself, as browsers require
    listen(cv, 'dblclick', () => toggleFullscreen());
    onAway(listen, () => { if (app.state === 'play') setState('pause'); });
    // typed initials
    listen(window, 'keydown', e => {
      if (app.state !== 'initials' || !/^Key[A-Z]$/.test(e.code)) return;
      const E = app.entry;
      E.letters[E.pos] = LETTERS.indexOf(e.code.slice(3));
      if (E.pos < 2) E.pos++;
      typed = true; // the same key may also be bound to a move: ignore that this step
      audio.sfx('tick');
    });
    app.touch = createTouch(cv, { listen, view });
  }

  // ---------- high scores ----------
  const qualifies = score => score > 0 && (scores.length < TABLE || score > scores[scores.length - 1].score);
  function saveScore(name) {
    const entry = { name, score: sim.score, scene: sim.scene, loop: sim.loop };
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    scores.length = Math.min(scores.length, TABLE);
    app.scores = scores;
    app.newRank = scores.indexOf(entry);
    saved.save(scores);
  }

  // ---------- input → actions ----------
  const taps = () => app.touch?.taps ?? [];
  const tapped = act => taps().some(h => h.act === act);
  const hit = a => input.pressed(a) || tapped(a);
  function actions() {
    const out = {};
    for (const a of PLAY_KEYS) out[a] = input.held(a) || input.pressed(a);
    app.touch?.apply(out);
    return out;
  }

  // ---------- demo: the autopilot plays a scene, then the next ----------
  let demoScene = Math.floor(Math.random() * SCENES.length), pilot = null, demoT = 0, ending = 0;
  function startDemo() {
    sim.reseed((Math.random() * 1e9) | 0);
    sim.newGame();
    sim.loadScene(demoScene, Math.random() < 0.3 ? 1 : 0);
    pilot = createPilot(sim, { sloppy: 0.35, seed: (Math.random() * 1e6) | 0 });
    demoT = 0; ending = 0;
  }
  function demoStep() {
    demoT += DT;
    const done = (sim.status === 'clear' && sim.statusT > 2.6) || (sim.status === 'over' && sim.statusT > 1.5) || demoT > 90;
    if (done && !ending) ending = 1;
    if (ending) {
      app.fade = Math.min(1, app.fade + DT * 1.6);
      if (app.fade >= 1) { demoScene = (demoScene + 1) % SCENES.length; startDemo(); return; }
    } else app.fade = Math.max(0, app.fade - DT * 2);
    sim.step(pilot());
  }

  function newGame(from = null) {
    sim.reseed((Math.random() * 1e9) | 0);
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
    switch (app.state) {
      case 'title': {
        const items = app.titleItems();
        app.menu = Math.min(app.menu, items.length - 1);
        if (hit('up')) { app.menu = (app.menu + items.length - 1) % items.length; audio.sfx('tick'); }
        if (hit('down')) { app.menu = (app.menu + 1) % items.length; audio.sfx('tick'); }
        const m = taps().find(h => h.act === 'menu');
        if (m) app.menu = m.i;
        if (hit('start') || m) {
          const it = items[app.menu];
          audio.sfx('select');
          if (it === 'continue') newGame(resume);
          else if (it === 'play') newGame();
          else if (it === 'scores') { app.newRank = -1; setState('scores'); }
          else if (it === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        else if (app.stT > 16) { app.newRank = -1; setState('scores'); }
        break;
      }
      case 'scores':
        if ((app.stT > 0.4 && (hit('start') || hit('back') || hit('quit') || tap)) || app.stT > 10) setState('title');
        break;
      case 'card':
        if (app.stT > 2.6 || (app.stT > 0.5 && (hit('start') || tap))) setState('play');
        break;
      case 'play':
        if (hit('pause')) { setState('pause'); break; }
        sim.step(actions());
        if (sim.status === 'clear' && sim.statusT > CLEAR_T) { sim.advance(); checkpoint(); setState('card'); }
        else if (sim.status === 'over') { autosave.clear(); setState('over'); }
        break;
      case 'pause':
        if (hit('pause') || hit('back') || hit('start') || tap) setState('play');
        else if (hit('quit')) { resume = validSave(autosave.load()); app.menu = 0; setState('title'); }
        break;
      case 'over':
        if (app.stT > 3.4 || (app.stT > 1.4 && (hit('start') || tap))) {
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
        if (press('up')) { E.letters[E.pos] = (E.letters[E.pos] + 1) % n; audio.sfx('tick'); }
        if (press('down')) { E.letters[E.pos] = (E.letters[E.pos] + n - 1) % n; audio.sfx('tick'); }
        if (press('left') || input.pressed('back')) { E.pos = Math.max(0, E.pos - 1); audio.sfx('tick'); }
        if (press('right')) { E.pos = Math.min(2, E.pos + 1); audio.sfx('tick'); }
        if (press('start') || acts.has('ok')) {
          if (E.pos < 2 && !acts.has('ok')) { E.pos++; audio.sfx('tick'); }
          else { saveScore(E.letters.map(i => LETTERS[i]).join('')); audio.sfx('select'); app.menu = 0; setState('scores'); }
        }
        break;
      }
    }
    app.touch?.clear();
  }

  function sound() {
    if (!audio) return;
    for (const e of sim.events) audio.sfx(e.type, e);
    const s = app.state;
    let track = null;
    if (s === 'title' || s === 'scores' || s === 'initials') track = 'title';
    else if (s === 'card') track = null;
    else if (s === 'play') track = sim.status === 'play' || sim.status === 'ready' ? (sim.hero.power > 0 ? 'power' : sim.sc.id) : null;
    audio.music(track);
    if (s === 'card' && app.stT === DT) audio.sfx('card');
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
    startDemo();
    // a still demo shows the scene a few seconds in
    const n = reducedMotion ? 60 * 12 : 1;
    for (let i = 0; i < n; i++) { demoStep(); sim.events.length = 0; }
    app.fade = 0;
  } else sim.newGame(); // a backdrop for the title
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
