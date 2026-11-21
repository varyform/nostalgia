// The game session: input → actions, the screen flow (title, high scores, venue card, play,
// pause, screen clear, Order Up! bonus, game over, initials), the attract-mode demo, sound,
// touch, the saved high-score table and the autosave behind the title's CONTINUE. It never draws: a renderer (cga/ or hd/) reads this
// `app` object every frame and answers touch hit tests.
import { createHdr } from '@nostalgia/game/hdr';
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createPilot } from './pilot.js';
import { DT, ROWS, createSim } from './sim.js';
import { createTouch } from './touch.js';
import { VENUES } from './venues.js';

const SCORES_KEY = 'brimful-scores';
const TABLE = 8;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const DEFAULT_SCORES = [
  ['PIP', 30000, 3], ['FIZ', 25000, 3], ['DOT', 20000, 2], ['MEL', 15000, 2],
  ['ROY', 10000, 1], ['SUE', 7500, 1], ['KIT', 5000, 0], ['OLA', 2500, 0],
].map(([name, score, venue]) => ({ name, score, venue, loop: 0 }));
// demo segments: a screen of each venue, the bonus round every third
const DEMO = [{ v: 0 }, { v: 1 }, { bonus: true }, { v: 2 }, { v: 3 }, { bonus: true }];

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer, style = 'rich' } = {}) {
  const { listen, offAll } = listeners();

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const sim = createSim({ seed: (Math.random() * 1e9) | 0 });
  const audio = demo ? null : createAudio({ on: sound, style });

  const saved = storage(SCORES_KEY, { enabled: !demo });
  let scores = DEFAULT_SCORES.map(s => ({ ...s }));
  const got = saved.load(null);
  if (Array.isArray(got) && got.length) scores = got.filter(s => s && typeof s.score === 'number').slice(0, TABLE);
  // the checkpoint: where the current screen or Order Up! round began
  const autosave = createAutosave('brimful', { enabled: !demo, version: 1 });
  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, input, demo, onExit, scores, menu: 0, newRank: -1,
    entry: { letters: [0, 0, 0], pos: 0 },
    touch: null, venues: VENUES, saved: autosave.load(),
    get soundOn() { return audio ? audio.on : false; },
    titleItems: () => [...(app.saved ? ['continue'] : []), 'play', 'scores', ...(onExit ? ['exit'] : [])],
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
    app.state = s; app.stT = 0;
  }

  // ---------- page plumbing (not in the demo) ----------
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => { if (app.state !== 'initials') toggleFullscreen(); }); // from the key event itself, as browsers require
    input.on('hdr', () => { if (app.state !== 'initials') hdr.cycle(); });
    listen(cv, 'dblclick', toggleFullscreen);
    onAway(listen, () => { if (app.state === 'play' || app.state === 'bonus') setState('pause'); });
    // typed initials
    listen(window, 'keydown', e => {
      if (app.state !== 'initials' || !/^Key[A-Z]$/.test(e.code)) return;
      const E = app.entry;
      E.letters[E.pos] = LETTERS.indexOf(e.code.slice(3));
      if (E.pos < 2) E.pos++;
      typed = true; // the same key may also be bound to a move: ignore that this step
      audio.sfx('move');
    });
    app.touch = createTouch(cv, { listen });
    app.touch.view = view;
  }

  let typed = false;

  // ---------- high scores ----------
  const qualifies = score => score > 0 && (scores.length < TABLE || score > scores[scores.length - 1].score);
  function saveScore(name) {
    const entry = { name, score: sim.score, venue: sim.venue, loop: sim.loop };
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    scores.length = Math.min(scores.length, TABLE);
    app.scores = scores;
    app.newRank = scores.indexOf(entry);
    saved.save(scores);
  }

  // ---------- autosave ----------
  // A checkpoint is taken on the venue card before every screen and Order Up! round: enough to
  // begin that stage again as it began, never the live counters.
  function checkpoint() {
    const { venue, screen, loop, stage, mode, lives, score, nextLife, stats } = sim;
    const where = mode === 'bonus' ? 'Order Up!' : `${VENUES[venue].name} ${screen + 1}`;
    autosave.save({ venue, screen, loop, stage, mode, lives, score, nextLife, stats }, `${loop ? `Tour ${loop + 1} · ` : ''}${where} · ${score.toLocaleString('en-US')}`);
  }
  function resume(c) {
    sim.newGame();
    const v = Math.min(VENUES.length - 1, Math.max(0, c.venue | 0));
    const score = Math.max(0, c.score | 0);
    Object.assign(sim, { lives: Math.max(1, c.lives | 0), score, nextLife: Math.max(score + 1, c.nextLife | 0), stage: c.stage | 0, stats: { ...sim.stats, ...c.stats } });
    if (c.mode === 'bonus') { Object.assign(sim, { venue: v, V: VENUES[v], loop: c.loop | 0 }); sim.startBonus(); }
    else sim.loadScreen(v, Math.min(VENUES[v].screens - 1, Math.max(0, c.screen | 0)), c.loop | 0);
  }
  function toCard() { checkpoint(); setState('card'); }

  // ---------- input → actions ----------
  const touchHits = () => {
    const T = app.touch;
    if (!T) return [];
    return T.taps.map(p => view.hit?.(p.x, p.y, app)).filter(Boolean);
  };
  const tapped = act => touchHits().some(h => h.act === act);
  const hit = a => input.pressed(a);
  let target = null; // a counter spot tapped on screen: { row, x }
  function actions() {
    const out = {};
    for (const a of ['up', 'down', 'left', 'right', 'pour']) out[a] = input.held(a);
    if (out.up || out.down || out.left || out.right) target = null;
    for (const h of touchHits()) if (h.act === 'row') target = { row: h.row, x: h.x };
    if (target) {
      const sv = sim.server;
      out.row = target.row;
      if (sv.row === target.row) {
        out.toX = target.x;
        if (Math.abs(sv.x - target.x) < 0.2 || sim.status !== 'play') target = null;
      }
    }
    if (app.touch?.pour) out.pour = true;
    return out;
  }
  function bonusActions() {
    const out = {};
    for (const a of ['up', 'down', 'left', 'right']) out[a] = input.held(a);
    for (const h of touchHits()) if (h.act === 'pad') out.pad = h.pad;
    return out;
  }

  // ---------- demo ----------
  let seg = Math.floor(Math.random() * DEMO.length), pilot = null, demoT = 0, ending = 0;
  function startSegment() {
    const d = DEMO[seg % DEMO.length];
    sim.reseed((Math.random() * 1e9) | 0);
    sim.newGame();
    if (d.bonus) sim.startBonus();
    else sim.loadScreen(d.v, Math.floor(Math.random() * 3), 0);
    pilot = createPilot(sim, { sloppy: 0.55, seed: (Math.random() * 1e6) | 0 });
    demoT = 0; ending = 0;
  }
  function demoStep() {
    demoT += DT;
    const b = sim.bonus;
    const done = sim.mode === 'bonus' ? b.phase === 'done'
      : (sim.status === 'clear' && sim.statusT > 2.4) || (sim.status === 'over' && sim.statusT > 2) || demoT > 80;
    if (done && !ending) ending = 1;
    if (ending) {
      app.fade = Math.min(1, app.fade + DT * 1.6);
      if (app.fade >= 1) { seg = (seg + 1) % DEMO.length; startSegment(); return; }
    } else app.fade = Math.max(0, app.fade - DT * 2);
    sim.step(pilot());
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    app.touch?.update(app);
    if (hit('sound') && app.state !== 'initials') audio.setOn(!audio.on);
    const tap = (app.touch?.taps.length ?? 0) > 0;
    switch (app.state) {
      case 'title': {
        const items = app.titleItems();
        if (hit('up')) { app.menu = (app.menu + items.length - 1) % items.length; audio.sfx('move'); }
        if (hit('down')) { app.menu = (app.menu + 1) % items.length; audio.sfx('move'); }
        const m = touchHits().find(h => h.act === 'menu');
        if (m) app.menu = m.i;
        if (hit('start') || hit('pour') || m) {
          const it = items[app.menu];
          audio.sfx('select');
          if (it === 'continue') { resume(app.saved.state); target = null; setState('card'); }
          else if (it === 'play') { sim.newGame(); target = null; toCard(); }
          else if (it === 'scores') { app.newRank = -1; setState('scores'); }
          else if (it === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        else if (app.stT > 14) { app.newRank = -1; setState('scores'); }
        break;
      }
      case 'scores':
        if ((app.stT > 0.4 && (hit('start') || hit('pour') || hit('back') || hit('quit') || tap)) || app.stT > 9) setState('title');
        break;
      case 'card':
        if (app.stT > 2.2 || (app.stT > 0.5 && (hit('start') || tap))) setState(sim.mode === 'bonus' ? 'bonus' : 'play');
        break;
      case 'play':
        if (hit('pause') || tapped('pause')) { setState('pause'); break; }
        sim.step(actions());
        if (sim.status === 'clear' && sim.statusT > 1.0) setState('clear');
        else if (sim.status === 'over') { autosave.clear(); setState('over'); }
        break;
      case 'bonus':
        if (hit('pause') || tapped('pause')) { setState('pause'); break; }
        sim.step(bonusActions());
        if (sim.bonus.phase === 'done') { sim.advance(); toCard(); }
        break;
      case 'pause':
        if (hit('pause') || hit('back') || hit('start') || tap) setState(sim.mode === 'bonus' ? 'bonus' : 'play');
        else if (hit('quit')) setState('title');
        break;
      case 'clear':
        sim.step({});
        if (app.stT > 3.4 || (app.stT > 1.2 && (hit('start') || hit('pour') || tap))) {
          sim.advance();
          toCard();
        }
        break;
      case 'over':
        sim.step({});
        if (app.stT > 3 || (app.stT > 1.2 && (hit('start') || tap))) {
          if (qualifies(sim.score)) { app.entry = { letters: [0, 0, 0], pos: 0 }; setState('initials'); }
          else { app.newRank = -1; setState('scores'); }
        }
        break;
      case 'initials': {
        const E = app.entry, n = LETTERS.length;
        const acts = new Set(touchHits().map(h => h.act));
        const skip = typed;
        typed = false;
        const press = a => (!skip && hit(a)) || acts.has(a);
        if (press('up')) { E.letters[E.pos] = (E.letters[E.pos] + 1) % n; audio.sfx('move'); }
        if (press('down')) { E.letters[E.pos] = (E.letters[E.pos] + n - 1) % n; audio.sfx('move'); }
        if (press('left') || hit('back')) { E.pos = Math.max(0, E.pos - 1); audio.sfx('move'); }
        if (press('right')) { E.pos = Math.min(2, E.pos + 1); audio.sfx('move'); }
        if (press('start') || press('pour') || acts.has('ok')) {
          if (E.pos < 2 && !acts.has('ok')) { E.pos++; audio.sfx('move'); }
          else { saveScore(E.letters.map(i => LETTERS[i]).join('')); audio.sfx('select'); setState('scores'); }
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
    if (s === 'title' || s === 'scores') track = 'title';
    else if (s === 'card' || s === 'play') track = sim.mode === 'bonus' ? 'bonus' : sim.show ? 'show' : sim.status === 'play' || s === 'card' ? 'v' + sim.venue : null;
    else if (s === 'bonus') track = 'bonus';
    else if (s === 'initials') track = 'title';
    audio.music(track);
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
    startSegment();
    // a still demo shows the segment a few seconds in
    const n = reducedMotion ? 60 * 9 : 1;
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
    hdr.destroy();
    audio?.destroy();
  }
  app.rows = ROWS;
  return { stop };
}
