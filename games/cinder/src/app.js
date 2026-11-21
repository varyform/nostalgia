// The game session: input → Wren's input, the screen flow (title, play, pause, game over, the
// ending, initials for the score table), the attract-mode demo, sound and music, touch, the
// saved scores and the autosave behind the title's CONTINUE. It never draws: the renderer
// (hd/render.js) reads this `app` object every frame and implements
// { draw(app), events(list, sim), menuAt(x, y), destroy() }.
//
//   state      'title' | 'play' | 'pause' | 'entry' | 'over' | 'won'
//              play: the sim runs on the player's input. over: the sim lies at 'over' (still
//              stepped, no input) under the GAME OVER card. won: the sim plays its ending
//              (still stepped, no input) under the ending's text; both go on to the initials
//              (a qualifying score) or the score table.
//   items()    ['continue'?, 'play', 'scores', 'exit'?]   the title menu, at app.menu
//   page       0 the title menu, 1 the score table (SCORES, or ←/→)
//   pauseItems() ['resume', 'sound', 'quit']               at app.pauseMenu
import { createHdr } from '@nostalgia/game/hdr';
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createPilot } from './pilot.js';
import { DT, createSim } from './sim.js';
import { createTouch } from './touch.js';

const SAVE_KEY = 'cinder-scores';
const TABLE = 8;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const DEFAULT_TABLE = [
  ['ORI', 30000, 7], ['KES', 24000, 6], ['TAM', 18000, 5], ['LUM', 13000, 4],
  ['SEV', 9000, 3], ['HOB', 6000, 2], ['PIP', 3500, 1], ['ASH', 1500, 1],
].map(([n, s, c]) => ({ n, s, c }));
const DEMO_RUN = 150; // seconds before the attract run moves to another scene anyway
const fmt = n => n.toLocaleString('en-US');

// the walk up uses one theme, the Keep's insides another; the Regent and the dawn have their own
export function trackOf(scene) {
  const id = scene?.id;
  if (id === 'throne') return 'regent';
  if (id === 'garden') return 'dawn';
  return id === 'path' || id === 'gate' ? 'path' : 'keep';
}

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer } = {}) {
  const { listen, offAll } = listeners();

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const sim = createSim();
  const SCENES = sim.scenes;
  const audio = demo ? null : createAudio({ on: sound });

  // ---------- the score table (never touched by the demo) ----------
  const saved = storage(SAVE_KEY, { enabled: !demo });
  let save = { table: DEFAULT_TABLE.map(e => ({ ...e })), last: 'AAA' };
  const got = demo ? null : saved.load(null);
  if (got && Array.isArray(got.table))
    save = {
      table: got.table
        .filter(e => e && typeof e.s === 'number' && typeof e.n === 'string')
        .map(e => ({ n: e.n.slice(0, 3), s: e.s, c: Math.max(0, Math.min(SCENES.length, e.c | 0)) }))
        .slice(0, TABLE),
      last: typeof got.last === 'string' ? got.last : 'AAA',
    };
  const store = () => saved.save(save);
  // the checkpoint: the scene being fought through, as it stood when it began
  const autosave = createAutosave('cinder', { enabled: !demo, version: 1 });
  const qualifies = score => score > 0 && (save.table.length < TABLE || score > save.table[save.table.length - 1].s);

  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, input, demo, onExit, save, menu: 0, saved: autosave.load(), page: 0, pageT: 0, rank: -1,
    entry: { letters: [0, 0, 0], pos: 0 }, touch: null, pauseMenu: 0, scenes: SCENES,
    get soundOn() { return audio ? audio.on : false; },
    get hi() { return Math.max(save.table[0]?.s ?? 0, sim.s?.score ?? 0); },
    items: () => [...(app.saved ? ['continue'] : []), 'play', 'scores', ...(onExit ? ['exit'] : [])],
    pauseItems: () => ['resume', 'sound', 'quit'],
  };
  const view = renderer(cv, app);
  const hdr = createHdr([cv], { enabled: !demo });
  app.hdr = hdr;
  function setState(s) {
    // back on the title: CONTINUE comes and goes with the checkpoint, and a new one is picked first
    if (s === 'title' && app.state !== 'title') {
      const was = app.saved?.at;
      app.saved = autosave.load();
      if (app.saved?.at !== was) app.menu = 0;
    }
    if (s === 'pause') app.pauseMenu = 0;
    app.state = s; app.stT = 0;
  }
  const turnPage = p => { if (app.page !== p) { app.page = p; app.pageT = app.t; } };

  // ---------- page plumbing (not in the demo) ----------
  let typed = false;
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => { if (app.state !== 'entry') toggleFullscreen(); }); // from the key event itself
    input.on('hdr', () => { if (app.state !== 'entry') hdr.cycle(); });
    listen(cv, 'dblclick', () => toggleFullscreen());
    onAway(listen, () => { if (app.state === 'play') { setState('pause'); audio.sfx('pause'); } });
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

  // ---------- input → Wren ----------
  const hit = a => input.pressed(a) || (app.touch?.taps.has(a) ?? false);
  const MOVES = ['left', 'right', 'up', 'down', 'punch', 'kick', 'stance', 'bow'];
  const NONE = Object.fromEntries(MOVES.map(a => [a, false]));
  function controls() {
    const out = {};
    for (const a of MOVES) out[a] = input.held(a);
    app.touch?.apply(out);
    return out;
  }
  // a tap on a menu: the renderer says which entry (an index, or Spindle-style { i })
  function tappedEntry() {
    const tp = app.touch?.tapAt, m = tp ? view.menuAt?.(tp.x, tp.y) : null;
    const i = typeof m === 'number' ? m : m?.i;
    return Number.isInteger(i) ? i : null;
  }
  // up / down through a menu; → the index picked this step, or -1
  function menuStep(key, n) {
    if (hit('up')) { app[key] = (app[key] + n - 1) % n; audio.sfx('move'); }
    if (hit('down')) { app[key] = (app[key] + 1) % n; audio.sfx('move'); }
    const tapped = tappedEntry();
    if (tapped != null && tapped < n) { app[key] = tapped; return tapped; }
    if (input.pressed('start') || input.pressed('punch') || app.touch?.taps.has('start')) return app[key];
    return -1;
  }

  // ---------- the game ----------
  function newGame() {
    sim.newGame({ scene: 0, seed: (Math.random() * 1e9) | 0, score: 0, lives: 3 });
    checkpoint();
  }
  // taken as each scene begins: a new game, the next scene after a clear, and a scene begun
  // again after a lost life (with the lives it begins with, so quitting can't win one back)
  function checkpoint() {
    const c = sim.checkpoint();
    autosave.save(c, `Scene ${c.scene + 1} · ${fmt(c.score)}`);
  }
  function resume(c) {
    const scene = Math.min(SCENES.length - 1, Math.max(0, c?.scene | 0));
    sim.newGame({ scene, seed: c?.seed | 0, score: Math.max(0, c?.score | 0), lives: Math.max(1, c?.lives | 0) });
  }
  const cleared = () => (sim.s.status === 'won' ? SCENES.length : sim.s.scene);
  function gameOver() {
    if (qualifies(sim.s.score)) {
      app.entry = { letters: save.last.padEnd(3, 'A').slice(0, 3).split('').map(ch => Math.max(0, LETTERS.indexOf(ch))), pos: 0 };
      typed = false;
      setState('entry');
    } else toScores(-1);
  }
  function toScores(rank) { turnPage(1); app.rank = rank; setState('title'); }
  function submit() {
    const e = { n: app.entry.letters.map(i => LETTERS[i]).join(''), s: sim.s.score, c: cleared() };
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
    if ((press('left') || hit('back')) && E.pos > 0) { E.pos--; audio.sfx('back'); }
    // Space and pad South are a move as well as start: they step on letter by letter like the
    // other moves; Enter and pad Start sign at once
    const next = press('punch') || press('kick') || press('stance') || app.touch?.taps.has('start');
    if (next) { audio.sfx('pick'); if (E.pos < 2) E.pos++; else submit(); }
    else if (!skip && input.pressed('start')) { audio.sfx('pick'); submit(); }
  }

  // ---------- demo: the autopilot, from a random scene ----------
  let pilot = null, ending = 0, demoT = 0;
  function demoLoad() {
    // any scene with a fight in it (the dawn garden has none)
    const fights = SCENES.map((sc, i) => (sc.foes?.length ? i : -1)).filter(i => i >= 0);
    const scene = fights.length ? fights[Math.floor(Math.random() * fights.length)] : 0;
    sim.newGame({ scene, seed: (Math.random() * 1e9) | 0, score: 0, lives: 3 });
    pilot = createPilot(sim, { skill: 0.75 });
    ending = 0; demoT = 0;
  }
  function demoStep() {
    if (ending) {
      app.fade = Math.min(1, app.fade + DT * 1.5);
      if (app.fade >= 1) demoLoad();
    } else app.fade = Math.max(0, app.fade - DT * 2);
    if (hitStop()) return;
    sim.step(pilot());
    demoT += DT;
    const s = sim.s;
    if (!ending && ((s.status === 'over' && s.statusT > 2.5) || (s.status === 'won' && s.statusT > 8) || demoT > DEMO_RUN)) ending = 1;
  }

  // a special landing holds the fight still for a beat (the effects play on), so it lands hard
  const HIT_STOP = 0.08;
  let stopT = 0;
  const hitStop = () => (stopT > 0 ? ((stopT -= DT), true) : false);

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    app.touch?.update(app);
    if (hit('sound') && app.state !== 'entry') audio.setOn(!audio.on);
    const ev = k => sim.events.some(e => e.k === k);
    switch (app.state) {
      case 'title': {
        const items = app.items();
        app.menu = Math.min(app.menu, items.length - 1);
        if (app.page === 1) {
          // the score table: any confirm, back or ←/→ goes back to the menu
          if (hit('back') || hit('left') || hit('right') || input.pressed('start') || input.pressed('punch') || app.touch?.taps.has('start')) {
            turnPage(0); audio.sfx('back');
          } else if (hit('up') || hit('down')) turnPage(0);
          break;
        }
        if (hit('left') || hit('right')) { turnPage(1); audio.sfx('move'); break; }
        const i = menuStep('menu', items.length);
        if (i >= 0) {
          const cur = items[i];
          audio.sfx('pick');
          if (cur === 'continue') { resume(app.saved.state); setState('play'); }
          else if (cur === 'play') { newGame(); setState('play'); }
          else if (cur === 'scores') { app.rank = -1; turnPage(1); }
          else if (cur === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        break;
      }
      case 'play':
        if (hit('pause') || app.touch?.taps.has('pause')) { setState('pause'); audio.sfx('pause'); break; }
        if (hitStop()) break;
        sim.step(controls());
        // a scene begins (the sim loads the next one by itself after a clear): its checkpoint
        if (ev('intro')) checkpoint();
        if (ev('over') || ev('win')) autosave.clear(); // the last life, or the Keep beaten: the run is over
        if (sim.s.status === 'won') setState('won');
        else if (sim.s.status === 'over' && sim.s.statusT > 2) setState('over');
        break;
      case 'pause': {
        const items = app.pauseItems();
        app.pauseMenu = Math.min(app.pauseMenu, items.length - 1);
        if (hit('pause') || hit('back')) { audio.sfx('back'); setState('play'); break; }
        // the run isn't over: its checkpoint stays for CONTINUE, so the score goes to the table
        // when the run ends, not here as well (a quit then continued run would be entered twice)
        if (hit('quit')) { audio.sfx('back'); turnPage(0); setState('title'); break; }
        const i = menuStep('pauseMenu', items.length);
        if (i < 0) break;
        const it = items[i];
        audio.sfx('pick');
        if (it === 'resume') setState('play');
        else if (it === 'sound') audio.setOn(!audio.on);
        else if (it === 'quit') { turnPage(0); setState('title'); }
        break;
      }
      case 'over':
      case 'won': {
        // the sim carries on by itself: the fallen lie still, the ending plays
        sim.step(NONE);
        const wait = app.state === 'won' ? 2 : 1.2, auto = app.state === 'won' ? 30 : 8; // the renderer's prompt shows from `wait`
        const go = input.pressed('start') || input.pressed('punch') || app.touch?.taps.has('start');
        if ((app.stT > wait && go) || app.stT > auto) gameOver();
        break;
      }
      case 'entry':
        entryStep();
        break;
    }
    app.touch?.clear();
  }

  // ---------- sound: events → effects (the jingles are the clear / die / over / win effects) ----------
  let duel = false;
  function sound() {
    if (!audio) return;
    const cam = sim.s?.cam ?? 0;
    for (const e of sim.events) {
      // a sound with a place is panned by where it is on screen (~12 m wide)
      audio.sfx(e.k, typeof e.x === 'number' ? { ...e, pan: Math.max(-1, Math.min(1, (e.x - cam) / 6)) } : e);
      if (e.k === 'foe') duel = true;
      else if (e.k === 'ko' && e.who !== 'hero') duel = false;
      else if (e.k === 'intro' || e.k === 'die' || e.k === 'life' || e.k === 'clear') duel = false;
    }
    const s = app.state, ss = sim.s, st = ss?.status;
    let track = null;
    if (s === 'title' || s === 'entry') track = 'title';
    else if (s === 'won') track = 'dawn';
    else if (s === 'play' && st !== 'over') {
      const scene = SCENES[ss.scene], base = trackOf(scene), foe = ss.engaged;
      // the duel drums while a foe is squared up to (the Regent keeps his own theme)
      const fighting = duel || (foe && foe.active && !foe.down);
      track = st === 'won' ? 'dawn' : fighting && st === 'play' && base !== 'regent' && base !== 'dawn' ? 'duel' : base;
    }
    audio.music(track);
  }

  // ---------- loop ----------
  function tick() {
    update();
    if (sim.events.some(e => e.k === 'hit' && e.fx)) stopT = HIT_STOP;
    view.events(sim.events, sim);
    sound();
    sim.events.length = 0;
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => { view.draw(app); hdr.present(); } });
  if (demo) {
    demoLoad();
    // a still demo shows a fight a little way in
    const n = reducedMotion ? 60 * 8 : 1;
    for (let i = 0; i < n; i++) { demoStep(); sim.events.length = 0; }
    app.fade = 0;
  } else {
    sim.newGame({ scene: 0, seed: 1, score: 0, lives: 3 }); // a backdrop for the title
    sim.events.length = 0; // its scene title isn't announced over the title screen
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
  return { stop };
}
