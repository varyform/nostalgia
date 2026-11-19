// The game session: input → actions, the screen flow (title, high scores, play, pause, game over,
// initials), the autosave checkpoint behind CONTINUE (taken after every turn), the attract-mode
// demo with its gliding hand, sound, the pointer and the saved scores and stats. It never draws:
// the renderer (hd/render.js) reads this `app` object every frame and answers hit tests.
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave, savedAgo } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createRenderer } from './hd/render.js';
import { createPilot } from './pilot.js';
import { DT, EMPTY, N, STATE_VERSION, createSim, findPath, validState } from './sim.js';
import { createTouch } from './touch.js';

const SCORES_KEY = 'quintet-scores', STATS_KEY = 'quintet-stats', TABLE = 8;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const DEFAULT_SCORES = [
  ['GLS', 3200, 160], ['VEL', 2500, 140], ['LMP', 1900, 120], ['ORB', 1400, 100],
  ['JAR', 1000, 85], ['DEW', 700, 70], ['FLK', 400, 55], ['TIN', 200, 40],
].map(([name, score, turns]) => ({ name, score, turns }));
const LOW_ROOM = 15; // free cells: the music tightens, the board warns
const fmt = n => Math.max(0, n | 0).toLocaleString('en-US');
export const saveLabel = st => `Turn ${st.turn + 1} · ${fmt(st.score)}`;
const DIRS = [['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]];

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
  const saved = storage(SCORES_KEY, { enabled: !demo }), savedStats = storage(STATS_KEY, { enabled: !demo });
  let scores = DEFAULT_SCORES.map(s => ({ ...s }));
  const got = saved.load(null);
  if (Array.isArray(got) && got.length) scores = got.filter(s => s && typeof s.score === 'number' && typeof s.name === 'string').slice(0, TABLE);
  const stats = { games: 0, best: 0, lines: 0, bestLine: 0, bestCombo: 0, turns: 0 };
  const gotStats = savedStats.load(null);
  if (gotStats && typeof gotStats === 'object') for (const k in stats) if (Number.isFinite(gotStats[k])) stats[k] = gotStats[k];
  const autosave = createAutosave('quintet', { enabled: !demo, version: STATE_VERSION });
  const validSave = r => (r && validState(r.state) ? r : null);
  let resume = validSave(autosave.load());
  const checkpoint = () => { const st = sim.state(); autosave.save(st, saveLabel(st)); };

  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, input, demo, onExit, scores, stats, menu: 0, newRank: -1,
    entry: { letters: [0, 0, 0], pos: 0 },
    touch: null,
    cursor: 4 * N + 4, mode: 'pointer', hover: -1, sel: -1, selT: 0, path: null, bad: -1, shake: null,
    hand: null, low: false, pmenu: 0,
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
    input.on('fullscreen', () => { if (app.state !== 'initials') toggleFullscreen(); }); // from the key event itself
    onAway(listen, () => { if (app.state === 'play') { app.pmenu = 0; setState('pause'); } });
    listen(window, 'keydown', e => {
      if (app.state !== 'initials' || !/^Key[A-Z]$/.test(e.code)) return;
      const E = app.entry;
      E.letters[E.pos] = LETTERS.indexOf(e.code.slice(3));
      if (E.pos < 2) E.pos++;
      typed = true; // the same key may also be bound to a move: ignore that this step
      sfx('tick');
    });
    app.touch = createTouch(cv, { listen });
  }

  // ---------- high scores and stats ----------
  const qualifies = score => score > 0 && (scores.length < TABLE || score > scores[scores.length - 1].score);
  function saveScore(name) {
    const entry = { name, score: sim.score, turns: sim.turn };
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    scores.length = Math.min(scores.length, TABLE);
    app.scores = scores;
    app.newRank = scores.indexOf(entry);
    saved.save(scores);
  }
  function recordStats() {
    const s = sim.stats;
    stats.games++; stats.best = Math.max(stats.best, sim.score); stats.lines += s.lines; stats.turns += sim.turn;
    stats.bestLine = Math.max(stats.bestLine, s.bestLine); stats.bestCombo = Math.max(stats.bestCombo, s.bestCombo);
    savedStats.save(stats);
  }

  // ---------- the board: picking up and setting down ----------
  function actOn(i) {
    if (sim.phase !== 'idle' || i < 0) return;
    const v = sim.board[i];
    if (v !== EMPTY) {
      if (app.sel === i) { app.sel = -1; sfx('deselect'); }
      else { app.sel = i; app.selT = 0; sfx('select', { c: v }); }
    } else if (app.sel >= 0) {
      if (sim.tryMove(app.sel, i)) app.sel = -1;
      else app.shake = { cell: app.sel, to: i, t: 0 };
    }
  }
  function undo() {
    if (!sim.canUndo()) { sfx('tick'); return; }
    sim.undo();
    app.sel = -1;
  }
  // the path the selected marble would take to the cell under the cursor (or why it can't)
  let pathKey = '';
  function updatePath() {
    const target = app.mode === 'touch' && !app.demo ? -1 : app.mode === 'pointer' && !app.demo ? app.hover : app.cursor;
    const key = `${app.sel}:${target}:${sim.turn}:${sim.phase}`;
    if (key === pathKey) return;
    pathKey = key;
    app.path = null; app.bad = -1;
    if (app.sel < 0 || target < 0 || sim.phase !== 'idle' || sim.board[target] !== EMPTY) return;
    app.path = findPath(sim.board, app.sel, target);
    if (!app.path) app.bad = target;
  }
  const rep = { left: 0, right: 0, up: 0, down: 0 };
  function moveCursor() {
    for (const [a, dx, dy] of DIRS) {
      let go = input.pressed(a);
      if (input.held(a)) { rep[a] += DT; if (rep[a] > 0.3) { rep[a] -= 0.075; go = true; } } else rep[a] = 0;
      if (!go) continue;
      if (app.mode !== 'keys') { app.mode = 'keys'; if (app.hover >= 0) app.cursor = app.hover; }
      const x = (app.cursor % N + dx + N) % N, y = (Math.floor(app.cursor / N) + dy + N) % N;
      app.cursor = y * N + x;
      sfx('cursor');
    }
  }

  // ---------- demo: the autopilot's hand on the board ----------
  let pilot = null, D = null;
  const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
  function startDemo() {
    sim.reseed((Math.random() * 2 ** 31) | 0);
    sim.newGame();
    pilot = createPilot({ sloppy: 0.3, seed: (Math.random() * 1e6) | 0 });
    // a few turns in already, so the preview shows a lived-in board
    for (let k = 0, n = 12 + Math.floor(Math.random() * 48); k < n && sim.phase === 'idle'; k++) {
      const m = pilot.choose(sim);
      if (!m) break;
      sim.tryMove(m.from, m.to); sim.settle();
    }
    if (sim.phase !== 'idle') { sim.newGame(); }
    sim.events.length = 0;
    app.sel = -1; app.mode = 'keys'; app.low = sim.free() <= LOW_ROOM;
    D = { phase: 'think', t: 0, wait: 0.8, from: -1, to: -1, x: 4, y: 4, g: null, boardT: 0, hold: 0, ending: 0 };
    app.hand = { x: 4, y: 4, press: 9 };
  }
  function glide(cell) {
    const x1 = cell % N, y1 = Math.floor(cell / N), d = Math.hypot(x1 - D.x, y1 - D.y);
    D.g = { x0: D.x, y0: D.y, x1, y1, t: 0, dur: Math.min(0.8, 0.24 + 0.07 * d) };
  }
  function stepGlide() {
    const G = D.g;
    G.t += DT;
    const k = ease(Math.min(1, G.t / G.dur));
    D.x = G.x0 + (G.x1 - G.x0) * k; D.y = G.y0 + (G.y1 - G.y0) * k;
    app.hand.x = D.x; app.hand.y = D.y;
    app.cursor = Math.round(D.y) * N + Math.round(D.x);
    return G.t >= G.dur;
  }
  function demoStep() {
    D.boardT += DT;
    app.hand.press += DT;
    sim.step(DT);
    for (const e of sim.events) if (e.type === 'turn') app.low = e.free <= LOW_ROOM;
    if (D.ending) {
      app.fade = Math.min(1, app.fade + DT * 1.6);
      if (app.fade >= 1) startDemo();
      return;
    }
    app.fade = Math.max(0, app.fade - DT * 2);
    if (sim.phase === 'over') { if ((D.hold += DT) > 3.2) D.ending = 1; return; }
    if (D.boardT > 150 && sim.phase === 'idle') { D.ending = 1; return; }
    switch (D.phase) {
      case 'think':
        if (sim.phase !== 'idle') break;
        if ((D.t += DT) < D.wait) break;
        { const m = pilot.choose(sim); if (!m) break; D.from = m.from; D.to = m.to; }
        glide(D.from); D.phase = 'toSrc';
        break;
      case 'toSrc':
        if (!stepGlide()) break;
        app.sel = D.from; app.selT = 0; app.hand.press = 0; D.phase = 'pick'; D.t = 0;
        break;
      case 'pick':
        if ((D.t += DT) < 0.4) break;
        glide(D.to); D.phase = 'toDst';
        break;
      case 'toDst':
        if (!stepGlide()) break;
        app.hand.press = 0;
        sim.tryMove(D.from, D.to);
        app.sel = -1; D.phase = 'think'; D.t = 0; D.wait = 0.3 + Math.random() * 0.7;
        break;
    }
    updatePath();
  }

  function newGame(from = null) {
    sim.reseed((Math.random() * 2 ** 31) | 0);
    if (from) sim.resume(from.state);
    else sim.newGame();
    checkpoint();
    resume = null;
    app.sel = -1; app.shake = null; app.low = sim.free() <= LOW_ROOM;
    sfx('start');
    setState('play');
  }
  function gameOver() {
    autosave.clear();
    resume = null;
    recordStats();
    app.sel = -1;
    setState('over');
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT; app.selT += DT;
    if (app.shake && (app.shake.t += DT) > 0.5) app.shake = null;
    if (demo) { demoStep(); return; }
    input.update();
    const T = app.touch;
    const taps = (T?.taps ?? []).map(q => ({ ...view.hit(q.x, q.y, app), touch: q.touch }));
    if (T?.moved && app.mode !== 'pointer') app.mode = 'pointer';
    app.hover = T?.hover ? view.cellAt(T.hover.x, T.hover.y) : -1;
    const tapped = act => taps.some(h => h.act === act);
    const hit = a => input.pressed(a) || tapped(a);
    if (hit('sound') && app.state !== 'initials') audio.setOn(!audio.on);
    switch (app.state) {
      case 'title': {
        const items = app.titleItems();
        app.menu = Math.min(app.menu, items.length - 1);
        if (input.pressed('up')) { app.menu = (app.menu + items.length - 1) % items.length; sfx('tick'); }
        if (input.pressed('down')) { app.menu = (app.menu + 1) % items.length; sfx('tick'); }
        const m = taps.find(h => h.act === 'menu');
        if (m) app.menu = m.i;
        if (input.pressed('start') || m) {
          const it = items[app.menu];
          sfx('menu');
          if (it === 'continue') newGame(resume);
          else if (it === 'play') newGame();
          else if (it === 'scores') { app.newRank = -1; setState('scores'); }
          else if (it === 'exit') onExit?.();
        } else if (onExit && input.pressed('quit')) onExit();
        else if (app.stT > 20) { app.newRank = -1; setState('scores'); }
        break;
      }
      case 'scores':
        if ((app.stT > 0.4 && (input.pressed('start') || input.pressed('back') || input.pressed('quit') || taps.length)) || app.stT > 14) { app.menu = 0; setState('title'); }
        break;
      case 'play': {
        if (input.pressed('pause') || tapped('pause')) { app.pmenu = 0; setState('pause'); break; }
        moveCursor();
        for (const a of taps) {
          if (a.act === 'cell') { app.mode = a.touch ? 'touch' : 'pointer'; app.cursor = a.i; actOn(a.i); }
          else if (a.act === 'undo') undo();
        }
        if (input.pressed('select')) { app.mode = 'keys'; actOn(app.cursor); }
        if (input.pressed('deselect') && app.sel >= 0) { app.sel = -1; sfx('deselect'); }
        if (input.pressed('undo')) undo();
        sim.step(DT);
        if (sim.phase === 'over') gameOver();
        updatePath();
        break;
      }
      case 'pause': {
        if (input.pressed('up') || input.pressed('down')) { app.pmenu = 1 - app.pmenu; sfx('tick'); }
        const m = taps.find(h => h.act === 'pmenu');
        if (m) app.pmenu = m.i;
        if (input.pressed('pause') || input.pressed('back') || ((input.pressed('start') || m) && app.pmenu === 0)) setState('play');
        else if (input.pressed('quit') || ((input.pressed('start') || m) && app.pmenu === 1)) {
          resume = validSave(autosave.load()); app.menu = 0; setState('title');
        }
        break;
      }
      case 'over':
        sim.step(DT);
        if (app.stT > 14 || (app.stT > 1.6 && (input.pressed('start') || input.pressed('select') || taps.length))) {
          if (qualifies(sim.score)) { app.entry = { letters: [0, 0, 0], pos: 0 }; setState('initials'); }
          else { app.newRank = -1; app.menu = 0; setState('scores'); }
        }
        break;
      case 'initials': {
        const E = app.entry, n = LETTERS.length;
        const acts = new Set(taps.map(h => h.act));
        const skip = typed;
        typed = false;
        const press = a => (!skip && input.pressed(a)) || acts.has(a);
        if (press('up')) { E.letters[E.pos] = (E.letters[E.pos] + 1) % n; sfx('tick'); }
        if (press('down')) { E.letters[E.pos] = (E.letters[E.pos] + n - 1) % n; sfx('tick'); }
        if (press('left') || input.pressed('back')) { E.pos = Math.max(0, E.pos - 1); sfx('tick'); }
        if (press('right')) { E.pos = Math.min(2, E.pos + 1); sfx('tick'); }
        const pick = taps.find(h => h.act === 'letter');
        if (pick) E.pos = pick.i;
        if (press('start') || acts.has('ok')) {
          if (E.pos < 2 && !acts.has('ok')) { E.pos++; sfx('tick'); }
          else { saveScore(E.letters.map(i => LETTERS[i]).join('')); sfx('menu'); app.menu = 0; setState('scores'); }
        }
        break;
      }
    }
    T?.clear();
  }

  function events() {
    for (const e of sim.events) {
      if (e.type === 'turn' || e.type === 'undo') {
        if (!demo && app.state === 'play') checkpoint();
        const low = sim.free() <= LOW_ROOM;
        if (low && !app.low) sfx('warn');
        app.low = low;
      }
      sfx(e.type, e);
      if (e.type === 'clear' && e.token) sfx('token');
    }
  }
  function music() {
    if (!audio) return;
    const s = app.state;
    audio.music(s === 'title' || s === 'scores' || s === 'initials' ? 'title' : s === 'play' || s === 'pause' ? (app.low ? 'tight' : 'calm') : null);
  }

  // ---------- loop ----------
  function tick() {
    update();
    events();
    view.events(sim.events, sim);
    music();
    sim.events.length = 0;
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => view.draw(app) });
  if (demo) {
    startDemo();
    app.fade = 0;
    if (reducedMotion) {
      // one still frame: a marble picked up, its path shown
      const m = pilot.choose(sim);
      if (m) { app.sel = m.from; app.cursor = m.to; app.hand = { x: m.to % N, y: Math.floor(m.to / N), press: 9 }; updatePath(); }
    }
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
