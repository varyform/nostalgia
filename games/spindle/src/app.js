// The game session: input → Clink's input, the screen flow (title with tower select, play,
// pause, game over, initials for the score table), the attract-mode demo, sound, touch and
// the saved scores. It never draws: the renderer (hd/render.js) reads this `app` object every
// frame and implements { draw(app), events(list, sim), destroy() }, plus menuAt() for taps.
import { fixedLoop, listeners, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createRoutePilot } from './pilot.js';
import { ROUTES } from './routes.js';
import { DT, createSim } from './sim.js';
import { TOWERS } from './towers.js';
import { createTouch } from './touch.js';

const SAVE_KEY = 'spindle-scores';
const TABLE = 8;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const DEFAULT_TABLE = [
  ['BEL', 24000, 8], ['GUL', 18000, 7], ['KEL', 14000, 6], ['REE', 10000, 5],
  ['TID', 7500, 4], ['SAL', 5000, 3], ['FOG', 3000, 2], ['WAV', 1500, 1],
].map(([n, s, t]) => ({ n, s, t }));
// the climbing themes take turns: towers 1, 4, 7 · 2, 5, 8 · 3, 6
export const trackOf = i => ['climb1', 'climb2', 'climb3'][i % 3];

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer } = {}) {
  const { listen, offAll } = listeners();

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const sim = createSim();
  const audio = demo ? null : createAudio({ on: sound });

  // ---------- the score table (never touched by the demo) ----------
  const saved = storage(SAVE_KEY, { enabled: !demo });
  let save = { table: DEFAULT_TABLE.map(e => ({ ...e })), last: 'AAA', reached: 0 };
  const got = saved.load(null);
  if (got && Array.isArray(got.table))
    save = {
      table: got.table.filter(e => e && typeof e.s === 'number' && typeof e.n === 'string').slice(0, TABLE),
      last: typeof got.last === 'string' ? got.last : 'AAA',
      reached: Math.max(0, Math.min(TOWERS.length - 1, got.reached | 0)),
    };
  const store = () => saved.save(save);
  const qualifies = score => score > 0 && (save.table.length < TABLE || score > save.table[save.table.length - 1].s);

  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, input, demo, onExit, save, menu: 0, page: 0, pageT: 0, rank: -1, pick: 0,
    entry: { letters: [0, 0, 0], pos: 0 }, touch: null, towers: TOWERS,
    get soundOn() { return audio ? audio.on : false; },
    get hi() { return Math.max(save.table[0]?.s ?? 0, sim.s?.score ?? 0); },
    items: () => ['play', ...(save.reached > 0 ? ['tower'] : []), ...(onExit ? ['exit'] : [])],
  };
  const view = renderer(cv, app);
  function setState(s) { app.state = s; app.stT = 0; }

  // ---------- page plumbing (not in the demo) ----------
  let typed = false;
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => { if (app.state !== 'entry') toggleFullscreen(); }); // from the key event itself
    listen(cv, 'dblclick', () => toggleFullscreen());
    listen(window, 'blur', () => { if (app.state === 'play') setState('pause'); });
    // initials can be typed straight in
    listen(window, 'keydown', e => {
      if (app.state !== 'entry' || !/^Key[A-Z]$/.test(e.code)) return;
      const E = app.entry;
      E.letters[E.pos] = LETTERS.indexOf(e.code.slice(3));
      if (E.pos < 2) E.pos++;
      typed = true; // the same key may also be bound to a move: ignore that this step
      audio.sfx('move');
    });
    app.touch = createTouch(cv, { listen });
  }

  // ---------- input → Clink ----------
  const hit = a => input.pressed(a) || (app.touch?.taps.has(a) ?? false);
  function controls() {
    const out = {};
    for (const a of ['left', 'right', 'up', 'down', 'jump', 'fire']) out[a] = input.held(a);
    app.touch?.apply(out);
    return out;
  }

  // ---------- the game ----------
  function newGame(tower) {
    sim.newGame({ tower, seed: (Math.random() * 1e9) | 0, lives: 3 });
  }
  function gameOver() {
    if (qualifies(sim.s.score)) {
      app.entry = { letters: save.last.padEnd(3, 'A').slice(0, 3).split('').map(ch => Math.max(0, LETTERS.indexOf(ch))), pos: 0 };
      typed = false;
      setState('entry');
    } else toScores(-1);
  }
  function toScores(rank) { app.page = 1; app.pageT = app.t; app.rank = rank; setState('title'); }
  function submit() {
    const e = { n: app.entry.letters.map(i => LETTERS[i]).join(''), s: sim.s.score, t: sim.s.reached + 1 };
    save.table.push(e);
    save.table.sort((a, b) => b.s - a.s);
    save.table = save.table.slice(0, TABLE);
    save.last = e.n;
    store();
    toScores(save.table.indexOf(e));
  }
  function entryStep() {
    const E = app.entry, n = LETTERS.length;
    const skip = typed;
    typed = false;
    const press = a => !skip && hit(a);
    if (press('up')) { E.letters[E.pos] = (E.letters[E.pos] + 1) % n; audio.sfx('move'); }
    if (press('down')) { E.letters[E.pos] = (E.letters[E.pos] + n - 1) % n; audio.sfx('move'); }
    if (app.touch?.swipe) { E.letters[E.pos] = (E.letters[E.pos] + n + app.touch.swipe) % n; audio.sfx('move'); }
    if (press('right') && E.pos < 2) { E.pos++; audio.sfx('move'); }
    if ((press('left') || hit('back')) && E.pos > 0) { E.pos--; audio.sfx('move'); }
    if (input.pressed('start') && !input.pressed('jump') && !skip) { audio.sfx('select'); submit(); return; }
    if (press('jump') || press('fire') || app.touch?.taps.has('start')) {
      audio.sfx('select');
      if (E.pos < 2) E.pos++; else submit();
    }
  }
  // keep what was reached, for the tower select (never in the demo)
  function noteReached() {
    const r = Math.min(TOWERS.length - 1, Math.max(save.reached, sim.s.loop ? TOWERS.length - 1 : sim.s.tower));
    if (r > save.reached) { save.reached = r; store(); }
  }

  // ---------- demo: the recorded routes, tower after tower ----------
  let demoTower = Math.floor(Math.random() * TOWERS.length), pilot = null, ending = 0;
  function demoLoad() {
    const r = ROUTES[demoTower];
    sim.newGame({ tower: demoTower, seed: r?.seed ?? 1, lives: 3 });
    pilot = createRoutePilot(sim, r?.route ?? '');
    ending = 0;
  }
  function demoStep() {
    if (ending) {
      app.fade = Math.min(1, app.fade + DT * 2);
      if (app.fade >= 1) { demoTower = (demoTower + 1) % TOWERS.length; demoLoad(); }
    } else app.fade = Math.max(0, app.fade - DT * 2);
    sim.step(pilot());
    // the sim moves on to the next tower by itself after the Kite Run: reload it with its route
    const s = sim.s, next = sim.events.some(e => e.type === 'tower');
    if (!ending && (next || s.status === 'over' || (s.status === 'play' && pilot.done()))) ending = 1;
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    app.touch?.update(app);
    if (hit('sound') && app.state !== 'entry') audio.setOn(!audio.on);
    switch (app.state) {
      case 'title': {
        const items = app.items(), max = save.reached;
        app.menu = Math.min(app.menu, items.length - 1);
        app.pick = Math.min(app.pick, max);
        if (hit('up')) { app.menu = (app.menu + items.length - 1) % items.length; audio.sfx('move'); }
        if (hit('down')) { app.menu = (app.menu + 1) % items.length; audio.sfx('move'); }
        const it = items[app.menu];
        if (it === 'tower' && (hit('left') || hit('right'))) { app.pick = (app.pick + (hit('right') ? 1 : max)) % (max + 1); audio.sfx('move'); }
        else if (hit('left') || hit('right')) { app.page ^= 1; app.pageT = app.t; audio.sfx('move'); }
        const tp = app.touch?.tapAt, tapped = tp ? view.menuAt?.(tp.x, tp.y) : null;
        if (tapped?.i != null) { app.menu = tapped.i; if (tapped.d) app.pick = (app.pick + tapped.d + max + 1) % (max + 1); }
        const go = input.pressed('start') || input.pressed('jump') || (tapped ? !tapped.d : !!app.touch?.taps.has('start'));
        if (go) {
          const cur = items[app.menu];
          audio.sfx('select');
          if (cur === 'play' || cur === 'tower') { newGame(cur === 'tower' ? app.pick : 0); setState('play'); }
          else if (cur === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        // the right-hand page turns by itself: how to play ⇄ the best climbers
        if (app.t - app.pageT > 9) { app.page ^= 1; app.pageT = app.t; }
        break;
      }
      case 'play':
        if (hit('pause') || app.touch?.taps.has('pause')) { setState('pause'); break; }
        sim.step(controls());
        if (sim.events.some(e => e.type === 'tower' || e.type === 'go')) noteReached();
        if (sim.s.status === 'over' && sim.s.statusT > 3) gameOver();
        break;
      case 'pause':
        if (hit('pause') || hit('back') || hit('start') || app.touch?.taps.has('start')) setState('play');
        else if (hit('quit')) { if (qualifies(sim.s.score)) gameOver(); else toScores(-1); }
        break;
      case 'entry':
        entryStep();
        break;
    }
    app.touch?.clear();
  }

  function sound() {
    if (!audio) return;
    for (const e of sim.events) audio.sfx(e.type, e);
    const s = app.state, st = sim.s?.status;
    let track = null;
    if (s === 'title' || s === 'entry') track = 'title';
    else if (s === 'play') track = st === 'bonus' ? 'bonus' : st === 'ready' || st === 'play' || st === 'splash' || st === 'timeup' ? trackOf(sim.s.tower) : null;
    audio.music(track);
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
    // a still demo shows the climb a few seconds in
    const n = reducedMotion ? 60 * 9 : 1;
    for (let i = 0; i < n; i++) { demoStep(); sim.events.length = 0; }
    app.fade = 0;
  } else sim.newGame({ tower: 0, seed: 1, lives: 3 }); // a backdrop for the title
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
