// The game session: input → the player's car, the screen flow (title, the paddock hub, the
// event board, the garage, the standings, the race and its pause, the results, the ending,
// initials for the hall of fame), the attract-mode demo, sound and music, touch, the hall of
// fame and the autosave behind the title's CONTINUE. It never draws: the renderer
// (hd/render.js) reads this `app` object every frame and implements
// { draw(app), events(list, race), menuAt(x, y), destroy() }; outside the race it hands the
// screen to hd/screens.js.
//
//   state        'title' | 'paddock' | 'events' | 'garage' | 'standings' | 'race' | 'pause'
//                | 'results' | 'won' | 'entry' | 'scores' | 'demo'
//   items()      the title's ['continue'?, 'new', 'hof', 'exit'?] or the paddock's
//                ['race', 'garage', 'standings', 'quit'], at app.menu
//   offers/pick  the event board's offers (career.offers) and the one picked
//   garage       { tab 0…2, tabs, rows (career.shop's list for the tab), sel, msg, ok, msgT }
//   report       career.settle's report; results { shown (lines revealed), move 0…1 (the ladder) }
//   pauseItems() ['resume', 'sound', 'retire'] at app.pauseMenu
//
// A tap asks the screens (view.menuAt) what is under it: { i } an entry or a row (with
// act: 'buy' | 'sell' on a garage row's buttons), { tab }, { back }, { letter, d } / { done }
// on the initials screen. Nothing else changes how a screen is driven.
import { createHdr } from '@nostalgia/game/hdr';
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import * as career from './career.js';
import { createPilot } from './pilot.js';
import { DT, createRace } from './sim.js';
import { TRACKS } from './tracks.js';
import { createTouch } from './touch.js';

const HOF_KEY = 'scorch-hof';
const TABLE = 8;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
// fewest races to the crown first, then the most cash
const DEFAULT_HOF = [
  ['KAZ', 16, 64000], ['RHO', 18, 55500], ['ODE', 21, 48000], ['LUX', 23, 41500],
  ['VEG', 26, 36000], ['NIX', 29, 30500], ['BRU', 32, 26000], ['MOT', 36, 21000],
].map(([n, r, c]) => ({ n, r, c }));
const better = (a, b) => a.r - b.r || b.c - a.c;
export const TABS = ['cars', 'parts', 'supplies'];
export const MUSIC = { easy: 'race1', mid: 'race2', hard: 'race3', final: 'final' };
const RESULT_LINES = 6; // place, prize, cash picked up, bonus, damage, points: then the ladder
const DEMO_RUN = 240; // seconds before the attract run moves to another track anyway
const HEAR = 90; // metres: further than this a rival's gun or engine isn't heard
const fmt = n => Math.round(n).toLocaleString('en-US');
const clamp01 = v => Math.max(0, Math.min(1, v || 0));
// "Rank 7 · $12,400", or "Unranked · $1,500" before the first point
export const saveLabel = C => (career.label ? career.label(C) : `${C?.points > 0 ? `Rank ${C.rank}` : 'Unranked'} · $${fmt(C?.cash ?? 0)}`);

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer } = {}) {
  const { listen, offAll } = listeners();

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'ShiftLeft', 'ShiftRight'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const audio = demo ? null : createAudio({ on: sound });
  const sfx = (name, opts) => audio?.sfx(name, opts);

  // ---------- the hall of fame (never touched by the demo) ----------
  const saved = storage(HOF_KEY, { enabled: !demo });
  let hof = { table: DEFAULT_HOF.map(e => ({ ...e })), last: 'AAA' };
  const got = demo ? null : saved.load(null);
  if (got && Array.isArray(got.table))
    hof = {
      table: got.table
        .filter(e => e && typeof e.n === 'string' && typeof e.r === 'number' && typeof e.c === 'number')
        .map(e => ({ n: e.n.slice(0, 3), r: Math.max(1, e.r | 0), c: Math.max(0, e.c | 0) }))
        .sort(better)
        .slice(0, TABLE),
      last: typeof got.last === 'string' ? got.last : 'AAA',
    };
  const qualifies = e => hof.table.length < TABLE || better(e, hof.table[hof.table.length - 1]) < 0;
  // the checkpoint: the career as it stands in the paddock, between races
  const autosave = createAutosave('scorch', { enabled: !demo, version: 1 });

  const app = {
    state: demo ? 'demo' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    demo, onExit, input, touch: null, menu: 0, saved: autosave.load(),
    career: null, offers: [], pick: 0, offer: null, standings: [],
    garage: { tab: 0, tabs: TABS, rows: [], sel: 0, msg: null, ok: true, msgT: 0 }, shop: null,
    race: null, entrants: null, report: null, results: { shown: 0, move: 0 }, pauseMenu: 0,
    entry: { letters: [0, 0, 0], pos: 0 }, hof: hof.table, hofRank: -1, tracks: TRACKS,
    get paused() { return app.state === 'pause'; },
    get soundOn() { return audio ? audio.on : false; },
    items: () =>
      app.state === 'paddock'
        ? ['race', 'garage', 'standings', 'quit']
        : [...(app.saved ? ['continue'] : []), 'new', 'hof', ...(onExit ? ['exit'] : [])],
    pauseItems: () => ['resume', 'sound', 'retire'],
  };
  const view = renderer(cv, app);
  const hdr = createHdr([cv], { enabled: !demo });
  app.hdr = hdr;
  function go(s) {
    // back on the title: CONTINUE comes and goes with the checkpoint, and is picked first
    if (s === 'title') { app.saved = autosave.load(); app.menu = 0; }
    if (s === 'pause') app.pauseMenu = 0;
    app.state = s; app.stT = 0;
  }

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
    onAway(listen, () => { if (app.state === 'race') { go('pause'); sfx('pause'); } });
    // initials can be typed straight in
    listen(window, 'keydown', e => {
      if (app.state !== 'entry' || !/^Key[A-Z]$/.test(e.code)) return;
      const E = app.entry;
      E.letters[E.pos] = LETTERS.indexOf(e.code.slice(3));
      if (E.pos < 2) E.pos++;
      typed = true; // the same key may also be bound to an action: ignore that this step
      sfx('move');
    });
    app.touch = createTouch(cv, { listen });
  }

  // ---------- input ----------
  const taps = () => app.touch?.taps ?? new Set();
  const hit = a => input.pressed(a) || taps().has(a);
  const confirm = () => input.pressed('start') || input.pressed('fire');
  function controls() {
    const out = {
      up: input.held('gas') || input.held('up'), down: input.held('brake') || input.held('down'),
      left: input.held('left'), right: input.held('right'),
      fire: input.held('fire'), mine: input.held('mine'), turbo: input.held('turbo'),
    };
    app.touch?.apply(out);
    return out;
  }
  // what the screens drew under this step's tap: { i } | { tab } | { back } | … or null
  function tapped() {
    const tp = app.touch?.tapAt, m = tp ? view.menuAt?.(tp.x, tp.y) : null;
    return typeof m === 'number' ? { i: m } : m ?? null;
  }
  // up / down (and ← → where `h`) through a list; → the index picked this step, or -1
  function menuStep(key, n, h = false, tap = tapped()) {
    if (n <= 0) return -1;
    const prev = hit('up') || (h && hit('left')), next = hit('down') || (h && hit('right'));
    if (prev) { app[key] = (app[key] + n - 1) % n; sfx('move'); }
    if (next) { app[key] = (app[key] + 1) % n; sfx('move'); }
    if (Number.isInteger(tap?.i) && tap.i < n) { app[key] = tap.i; return tap.i; }
    return confirm() ? app[key] : -1;
  }

  // ---------- the career ----------
  function checkpoint() { autosave.save(career.save(app.career), saveLabel(app.career)); }
  // back from a screen of the hub, its entry stays picked; after a race it's RACE again
  function toPaddock(from = 'race') {
    app.standings = career.standings(app.career);
    app.race = null;
    app.menu = Math.max(0, ['race', 'garage', 'standings', 'quit'].indexOf(from));
    go('paddock');
  }
  function newCareer() {
    app.career = career.newCareer({ seed: (Math.random() * 1e9) | 0 });
    checkpoint();
    toPaddock();
  }
  function resume() {
    const C = career.load(app.saved?.state);
    if (!C) return newCareer(); // unreadable: begin again rather than strand the title
    app.career = C;
    toPaddock();
  }
  function openEvents() {
    app.offers = career.offers(app.career);
    app.pick = 0;
    if (app.offers.length) go('events');
    else sfx('deny'); // nothing left to race: the champion's crown is taken
  }

  // ---------- the garage ----------
  function shopRows() {
    app.shop = career.shop(app.career);
    const G = app.garage;
    G.rows = app.shop?.[TABS[G.tab]] ?? [];
    G.sel = Math.max(0, Math.min(G.sel, G.rows.length - 1));
  }
  let garageDirty = false;
  function openGarage() {
    app.garage = { tab: 0, tabs: TABS, rows: [], sel: 0, msg: null, ok: true, msgT: 0 };
    garageDirty = false;
    shopRows();
    // the car you drive is where the list starts
    const own = app.garage.rows.findIndex(r => r.owned);
    if (own >= 0) app.garage.sel = own;
    go('garage');
  }
  const rowName = (tab, r) => (tab === 'cars' ? r.name : tab === 'parts' ? r.part : r.kind)?.toUpperCase?.() ?? '';
  const whatOf = (tab, r) => (tab === 'cars' ? { car: r.id } : tab === 'parts' ? { part: r.part } : { supply: r.kind });
  function trade(kind) {
    const G = app.garage, tab = TABS[G.tab], r = G.rows[G.sel];
    if (!r) return;
    const fn = kind === 'buy' ? career.buy : career.sell;
    const res = fn ? fn(app.career, whatOf(tab, r)) : { ok: false, why: 'Not here' };
    G.msgT = app.t;
    if (res?.ok) {
      const before = app.career.cash;
      app.career = res.C;
      const d = app.career.cash - before;
      G.ok = true;
      G.msg = `${kind === 'buy' ? 'BOUGHT' : 'SOLD'} ${rowName(tab, r)}  ${d < 0 ? '−' : '+'}$${fmt(Math.abs(d))}`;
      garageDirty = true;
      sfx(kind === 'buy' ? 'buy' : 'cash');
    } else {
      G.ok = false;
      G.msg = String(res?.why ?? (kind === 'buy' ? "Can't buy that" : "Can't sell that")).toUpperCase();
      sfx('deny');
    }
    shopRows();
  }
  function leaveGarage() {
    // purchases are part of the paddock's state: the checkpoint keeps them
    if (garageDirty) checkpoint();
    toPaddock('garage');
  }

  // ---------- the race ----------
  let doneT = 0, fast = false;
  const evs = []; // this tick's race events, from every step taken
  function startRace(offer) {
    const track = TRACKS.find(t => t.id === offer.track) ?? TRACKS[0];
    app.offer = offer;
    app.entrants = career.entrants(app.career, offer);
    app.race = createRace({ track, laps: offer.laps, seed: (Math.random() * 1e9) | 0, cars: app.entrants });
    doneT = 0; fast = false; app.fade = 1;
    go('race');
  }
  function step(inputs) {
    app.race.step(inputs);
    for (const e of app.race.events) evs.push(e);
  }
  // retiring hands the race over as a wreck in last place; the others keep the order they run in
  function forfeit() {
    const s = app.race.s, cars = s.cars;
    const order = (s.order?.length ? s.order : cars.map((_, i) => i)).filter(i => i !== 0);
    const rank = i => (cars[i].done && !cars[i].dead ? 0 : cars[i].dead ? 2 : 1);
    order.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? (cars[a].place ?? 9) - (cars[b].place ?? 9) : 0));
    return [...order, 0].map((i, k) => {
      const c = cars[i], me = i === 0;
      return {
        id: c.id, place: k + 1, finished: !me && !c.dead, wrecked: me || !!c.dead, time: c.finishT ?? s.t,
        kills: c.kills | 0, cash: c.cash | 0, hp: me ? 0 : c.hp, ammo: c.ammo, mines: c.mines, turbo: c.turbo,
      };
    });
  }
  function retire() {
    const me = app.race.s.cars[0];
    if (me.done && !me.dead) {
      // already over the line: let the rest resolve, as it would have
      for (let k = 0; k < 60 * 30 && app.race.s.status !== 'done'; k++) app.race.step([{}]);
      settle(app.race.result());
    } else settle(forfeit());
  }
  function settle(result) {
    const { C, report } = career.settle(app.career, app.offer, result);
    app.career = C;
    app.report = report;
    app.results = { shown: 0, move: 0 };
    if (report?.won) autosave.clear(); // the champion beaten: the career is done
    else checkpoint();
    app.race = null;
    go('results');
  }
  function raceStep() {
    const r = app.race, s = r.s, me = s.cars[0];
    if (hit('pause')) { go('pause'); sfx('pause'); return; }
    const out = me.done || me.dead;
    // over the line or wrecked: the rest resolves by itself; start hurries it along
    if (out && confirm()) fast = true;
    const n = out && fast ? 8 : 1;
    for (let k = 0; k < n && s.status !== 'done'; k++) step([controls()]);
    if (s.status === 'done') {
      doneT += DT;
      if (doneT > (fast ? 0.6 : 2.5)) settle(r.result());
    }
  }

  // ---------- the results: the report line by line, then the ladder ----------
  const LINE = 0.45, LINE0 = 0.6, MOVE = 1.3;
  const resultsEnd = () => LINE0 + RESULT_LINES * LINE + 0.3 + MOVE;
  function resultsStep() {
    const R = app.results, rep = app.report ?? {};
    const shown = Math.min(RESULT_LINES, Math.max(0, Math.floor((app.stT - LINE0) / LINE) + 1));
    for (let k = R.shown; k < shown; k++) {
      // the prize counts in to a till's ring; the other lines tick
      if (k === 1 && rep.prize > 0) sfx('cash'); else sfx('move');
    }
    R.shown = shown;
    R.move = clamp01((app.stT - (LINE0 + RESULT_LINES * LINE + 0.3)) / MOVE);
    const go_ = confirm() || taps().has('start');
    if (!go_) return;
    if (app.stT < resultsEnd()) { app.stT = resultsEnd(); R.shown = RESULT_LINES; R.move = 1; return; }
    sfx('pick');
    if (rep.won) go('won'); else toPaddock();
  }

  // ---------- the ending and the hall of fame ----------
  // the hall of fame: races taken to the crown, and all the money earned on the way
  const crown = () => ({ n: '', r: Math.max(1, app.career?.races | 0), c: Math.max(0, app.career?.earned ?? app.career?.cash ?? 0) | 0 });
  function afterEnding() {
    if (qualifies(crown())) {
      app.entry = { letters: hof.last.padEnd(3, 'A').slice(0, 3).split('').map(ch => Math.max(0, LETTERS.indexOf(ch))), pos: 0 };
      typed = false;
      go('entry');
    } else toScores(-1);
  }
  function toScores(rank) { app.hofRank = rank; go('scores'); }
  function submit() {
    const e = { ...crown(), n: app.entry.letters.map(i => LETTERS[i]).join('') };
    hof.table.push(e);
    hof.table.sort(better);
    hof.table = hof.table.slice(0, TABLE);
    hof.last = e.n;
    app.hof = hof.table;
    saved.save(hof);
    toScores(hof.table.indexOf(e));
  }
  function entryStep() {
    const E = app.entry, n = LETTERS.length;
    const skip = typed;
    typed = false;
    const press = a => !skip && hit(a);
    const turn = d => { E.letters[E.pos] = (E.letters[E.pos] + n + d) % n; sfx('move'); };
    const tap = tapped();
    if (tap && Number.isInteger(tap.letter)) { E.pos = tap.letter; if (tap.d) turn(tap.d); return; }
    if (tap?.done) { sfx('pick'); submit(); return; }
    if (press('up')) turn(1);
    if (press('down')) turn(-1);
    if (press('right') && E.pos < 2) { E.pos++; sfx('move'); }
    if ((press('left') || hit('back')) && E.pos > 0) { E.pos--; sfx('back'); }
    // Space and pad South step on letter by letter; Enter and pad Start sign at once
    if (press('fire')) { sfx('pick'); if (E.pos < 2) E.pos++; else submit(); }
    else if (!skip && input.pressed('start')) { sfx('pick'); submit(); }
  }

  // ---------- demo: back-to-back races, car 0 on the autopilot ----------
  let pilot = null, ending = 0, demoT = 0;
  const pickOf = list => list[Math.floor(Math.random() * list.length)];
  function demoLoad() {
    const track = pickOf(TRACKS);
    const C0 = career.newCareer({ seed: (Math.random() * 1e9) | 0 });
    const pool = career.DRIVERS.filter(d => d.id !== 'marrow').sort(() => Math.random() - 0.5);
    const offer = {
      id: 'demo', tier: pickOf(['easy', 'mid', 'hard']), track: track.id, laps: Math.min(3, track.laps ?? 3),
      rivals: pool.slice(0, 3).map(d => d.id), prizes: [0, 0, 0, 0], points: [0, 0, 0, 0],
    };
    const cars = career.entrants(C0, offer);
    // car 0 is one of the circuit's own drivers in their own car, not a starter's junker
    const d = pool[3], m = d && career.MODELS.find(x => x.id === d.model);
    if (d && m) {
      const top = { engine: m.max?.engine ?? 0, tyres: m.max?.tyres ?? 0, armour: m.max?.armour ?? 0 };
      const up = Object.fromEntries(Object.entries(top).map(([k, v]) => [k, Math.floor(Math.random() * (v + 1))]));
      const stats = career.carStats(m.id, up), caps = m.caps ?? {};
      cars[0] = { ...cars[0], name: d.name, colour: d.colour, model: m.id, stats, hp: stats.hp ?? cars[0].hp, ammo: caps.ammo ?? cars[0].ammo, mines: caps.mines ?? cars[0].mines, turbo: caps.turbo ?? cars[0].turbo };
    }
    app.offer = offer;
    app.entrants = cars;
    app.race = createRace({ track, laps: offer.laps, seed: (Math.random() * 1e9) | 0, cars });
    pilot = createPilot(app.race, 0, { skill: 0.55 + Math.random() * 0.4 });
    ending = 0; demoT = 0; doneT = 0;
  }
  function demoStep() {
    if (ending) {
      app.fade = Math.min(1, app.fade + DT * 1.5);
      if (app.fade >= 1) demoLoad();
    } else app.fade = Math.max(0, app.fade - DT * 2);
    if (app.race.s.status !== 'done') step([pilot()]);
    else doneT += DT;
    demoT += DT;
    if (!ending && (doneT > 3 || demoT > DEMO_RUN)) ending = 1;
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    app.fade = Math.max(0, app.fade - DT * 2.5);
    input.update();
    app.touch?.update(app);
    if (hit('sound') && app.state !== 'entry') audio.setOn(!audio.on);
    switch (app.state) {
      case 'title': {
        const items = app.items();
        app.menu = Math.min(app.menu, items.length - 1);
        const i = menuStep('menu', items.length);
        if (i >= 0) {
          const it = items[i];
          sfx('pick');
          if (it === 'continue') resume();
          else if (it === 'new') newCareer();
          else if (it === 'hof') toScores(-1);
          else if (it === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        break;
      }
      case 'paddock': {
        const items = app.items();
        if (hit('back') && app.menu !== items.length - 1) { app.menu = items.length - 1; sfx('back'); break; }
        const i = menuStep('menu', items.length);
        if (i < 0) break;
        sfx('pick');
        const it = items[i];
        if (it === 'race') openEvents();
        else if (it === 'garage') openGarage();
        else if (it === 'standings') go('standings');
        else if (it === 'quit') go('title'); // the checkpoint stays for CONTINUE
        break;
      }
      case 'events': {
        const tap = tapped();
        if (hit('back') || tap?.back) { sfx('back'); toPaddock(); break; }
        if (tap?.go) { sfx('pick'); startRace(app.offers[app.pick]); break; }
        // a tap picks a card, a second tap on it races
        if (Number.isInteger(tap?.i) && tap.i !== app.pick) { app.pick = tap.i; sfx('move'); break; }
        const i = menuStep('pick', app.offers.length, true, tap);
        if (i >= 0 && app.offers[i]) { sfx('pick'); startRace(app.offers[i]); }
        break;
      }
      case 'garage': {
        const G = app.garage, tap = tapped();
        if (hit('back') || tap?.back) { sfx('back'); leaveGarage(); break; }
        const tab = Number.isInteger(tap?.tab) ? tap.tab : hit('left') ? G.tab + TABS.length - 1 : hit('right') ? G.tab + 1 : null;
        if (tab != null) {
          G.tab = tab % TABS.length; G.sel = 0; G.msg = null;
          shopRows();
          if (G.tab === 0) { const own = G.rows.findIndex(r => r.owned); if (own >= 0) G.sel = own; }
          sfx('move');
          break;
        }
        const n = G.rows.length;
        if (n && hit('up')) { G.sel = (G.sel + n - 1) % n; sfx('move'); }
        if (n && hit('down')) { G.sel = (G.sel + 1) % n; sfx('move'); }
        if (Number.isInteger(tap?.i) && tap.i < n) {
          // a row's own BUY / SELL buttons act at once; the row itself is picked first
          const was = G.sel;
          G.sel = tap.i;
          if (tap.act) trade(tap.act);
          else if (was === tap.i) trade('buy');
          else sfx('move');
          break;
        }
        if (confirm()) trade('buy');
        else if (input.pressed('sell')) trade('sell');
        break;
      }
      case 'standings': {
        const tap = tapped();
        if (hit('back') || tap?.back || confirm() || (taps().has('start') && !tap)) { sfx('back'); toPaddock('standings'); }
        break;
      }
      case 'race':
        raceStep();
        break;
      case 'pause': {
        const items = app.pauseItems();
        app.pauseMenu = Math.min(app.pauseMenu, items.length - 1);
        if (hit('pause') || hit('back')) { sfx('back'); go('race'); break; }
        const i = menuStep('pauseMenu', items.length);
        if (i < 0) break;
        const it = items[i];
        sfx('pick');
        if (it === 'resume') go('race');
        else if (it === 'sound') audio.setOn(!audio.on);
        else if (it === 'retire') retire();
        break;
      }
      case 'results':
        resultsStep();
        break;
      case 'won': {
        const go_ = confirm() || taps().has('start');
        if ((app.stT > 2.5 && go_) || app.stT > 45) afterEnding();
        break;
      }
      case 'entry':
        entryStep();
        break;
      case 'scores': {
        const tap = tapped();
        if (hit('back') || tap?.back || confirm() || taps().has('start') || (onExit && hit('quit'))) { sfx('back'); go('title'); }
        break;
      }
    }
    app.touch?.clear();
  }

  // ---------- sound: race events → effects, music by screen, the engines ----------
  // events that only matter for the player's own car
  const MINE = new Set(['lap', 'last', 'finish', 'low', 'pickup']);
  let revving = false;
  function soundStep() {
    if (!audio) return;
    const st = app.state, s = app.race?.s, me = s?.cars?.[0];
    if (st === 'race' && me) {
      for (const e of evs) {
        if (e.k === 'done') continue;
        if (MINE.has(e.k)) { if (e.car === 0) sfx(e.k, e); continue; }
        if (e.k === 'count' || e.k === 'go') { sfx(e.k, e); continue; }
        // a sound with a place is panned by where it is from the player (the camera follows car 0)
        const src = typeof e.x === 'number' ? e : s.cars[e.car ?? e.a ?? -1];
        const mine = e.car === 0 || e.a === 0 || e.b === 0 || e.by === 0;
        if (!src) { sfx(e.k, e); continue; }
        const dx = src.x - me.x, dy = src.y - me.y, dist = Math.hypot(dx, dy);
        if (!mine && dist > HEAR) continue;
        sfx(e.k, { ...e, pan: Math.max(-1, Math.min(1, dx / 35)), gain: mine ? 1 : clamp01(1 - dist / HEAR), near: mine });
      }
    }
    let track = null;
    if (st === 'title' || st === 'scores') track = 'title';
    else if (st === 'won' || st === 'entry') track = 'win';
    else if (st === 'paddock' || st === 'events' || st === 'garage' || st === 'standings' || st === 'results') track = 'paddock';
    else if (st === 'race' && s) {
      // quiet on the grid for the countdown, and once you're over the line or burning
      const out = me.done || me.dead;
      if (s.status === 'race' && !out) track = MUSIC[app.offer?.tier] ?? 'race1';
    }
    audio.music(track);
    if (st === 'race' && s) { engines(s, me); revving = true; }
    else if (revving) { audio.engines(null); audio.skid?.(0); revving = false; }
  }
  // the player's engine and the nearest rivals', as rpm (speed against top speed), load
  // (throttle), turbo, pan and loudness; tyre squeal from how sideways the cars are
  function engines(s, me) {
    const near = s.cars
      .map((c, i) => ({ c, i, d: Math.hypot(c.x - me.x, c.y - me.y) }))
      .filter(o => o.i === 0 || (!o.c.dead && o.d < HEAR))
      .sort((a, b) => (a.i === 0 ? -1 : b.i === 0 ? 1 : a.d - b.d))
      .slice(0, 4);
    let skid = 0;
    const list = near.map(({ c, i, d }) => {
      const top = app.entrants?.[i]?.stats?.top || c.stats?.top || 60;
      const gain = c.dead ? 0 : i === 0 ? 1 : 0.75 * clamp01(1 - d / HEAR);
      const rpm = clamp01(Math.abs(c.speed ?? 0) / top), slip = clamp01(c.slip) * Math.min(1, Math.abs(c.speed ?? 0) / 6);
      skid = Math.max(skid, slip * gain);
      return { id: c.id, rpm, load: clamp01(c.throttle), boost: (c.boost ?? 0) > 0, pan: Math.max(-1, Math.min(1, (c.x - me.x) / 35)), gain, slip };
    });
    audio.engines(list);
    audio.skid?.(skid);
  }

  // ---------- loop ----------
  function tick() {
    update();
    if (app.race) view.events(evs, app.race);
    soundStep();
    evs.length = 0;
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => { view.draw(app); hdr.present(); } });
  if (demo) {
    demoLoad();
    // a still demo shows a race a little way in
    const n = reducedMotion ? 60 * 12 : 1;
    for (let i = 0; i < n; i++) { demoStep(); if (app.race) view.events(evs, app.race); evs.length = 0; }
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
    hdr.destroy();
    audio?.destroy();
  }
  return { stop };
}
