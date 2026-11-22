// The game session: input → the user's player, the screen flow, the tour, exhibitions and
// practice, the attract-mode demo, sound and music, touch, the records and the autosave behind
// the title's CONTINUE. It never draws: the renderer (hd/render.js) reads this `app` object every
// frame and implements { draw(app), events(list, match), menuAt(x, y), destroy() }; outside a
// match (and over a frozen one in 'pause', 'changeover' and 'result') it hands the screen to
// hd/screens.js.
//
//   state      'title' | 'create' | 'pick' | 'tour' | 'draw' | 'rankings' | 'player' | 'prematch'
//              | 'match' | 'practice' | 'pause' | 'changeover' | 'result' | 'trophy' | 'season'
//              | 'entry' | 'records' | 'options' | 'exhibition' | 'drill' | 'demo'
//   kind       'tour' | 'exhibition' | 'practice' | 'demo': what the match on screen is
//   label      the match's line ('Kestrel Open · Quarter-final', 'Exhibition', 'Practice')
//   tour       the tour (tour.js) while one is open; drawEvent the event the draw screen shows
//              (the live one, or the one just finished); summary what closeEvent() said;
//              season what endSeason() said; trophy { kind: 'event' | 'no1' | 'crowns' | 'retired' }
//
// A tap asks the screens (view.menuAt) what is under it: { i } an entry or a row, { back },
// { go }, { act }, { d: ±1, row } a ◀ ▶ arrow, { letter, d } / { done } on the initials.
import { createHdr } from '@nostalgia/game/hdr';
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { KITS, NATION_CODES, PLAYERS, STYLES, VENUES, venueById, venueLook } from './players.js';
import { createMatch } from './sim.js';
import { createTouch } from './touch.js';
import * as tour from './tour.js';

const DT = 1 / 60; // the sim's fixed step
const OPT_KEY = 'netcord-options';
const REC_KEY = 'netcord-records';
const TABLE = 8;
const DEFAULT_NAME = 'ROOKIE';
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
export const NAME_LETTERS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ-.';
export const SETS = [1, 3, 5];
export const DIFFICULTY = ['easy', 'normal', 'hard'];
const DIFF_DELTA = { easy: -1, normal: 0, hard: 1 }; // the computer's ratings, and the sim's own scale
const DIFF_SIM = { easy: 0.75, normal: 1, hard: 1.25 };
export const CAMERAS = ['tv', 'behind', 'side', 'high', 'umpire'];
export const CREATE_ROWS = ['name', 'hand', 'style', 'height', 'nation', 'kit', 'start', 'pick'];
export const OPTION_ROWS = ['sets', 'difficulty', 'assist', 'camera', 'sound', 'done'];
export const EXHIBITION_ROWS = ['p0', 'p1', 'venue', 'sets', 'side', 'start'];
export const DRILL_ROWS = ['player', 'partner', 'venue', 'start'];
export const DRAW_ITEMS = ['play', 'sim', 'back'];
// the records: careers on the tour, the Four Crowns first (fewest seasons), then the most Crowns
const DEFAULT_RECORDS = [
  ['VSK', 1, 4, 11, 1, 5], ['ORN', 1, 4, 9, 1, 7], ['TAL', 0, 3, 12, 1, 10], ['BEQ', 0, 2, 8, 1, 10],
  ['MUR', 0, 2, 6, 2, 10], ['HDL', 0, 1, 5, 3, 10], ['KAI', 0, 1, 3, 4, 10], ['PEN', 0, 0, 2, 7, 10],
].map(([n, crowned, majors, titles, best, seasons]) => ({ n, crowned: !!crowned, majors, titles, best, seasons }));
const better = (a, b) => b.crowned - a.crowned || (a.crowned ? a.seasons - b.seasons : 0) || b.majors - a.majors || b.titles - a.titles || a.best - b.best || a.seasons - b.seasons;
const OVER_DELAY = 2.6; // seconds of the sim's own celebration before the result panel
const CHANGE_SHOW = 6; // seconds the changeover panel stays up by itself
const DEMO_SETS = 1;
const rand = n => Math.floor(Math.random() * n);

export function boot(canvases, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer } = {}) {
  const { listen, offAll } = listeners();
  const cv = canvases.hud;

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'Enter', 'ShiftLeft'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const audio = demo ? null : createAudio({ sound, on: sound });
  const ui = name => audio?.ui?.(name);

  // ---------- what's kept (never touched by the demo) ----------
  const optStore = storage(OPT_KEY, { enabled: !demo });
  const opts = { sets: 3, difficulty: 'normal', assist: true, camera: 'tv', ...(demo ? {} : optStore.load({})) };
  if (!SETS.includes(opts.sets)) opts.sets = 3;
  if (!DIFFICULTY.includes(opts.difficulty)) opts.difficulty = 'normal';
  if (!CAMERAS.includes(opts.camera)) opts.camera = 'tv';
  opts.assist = opts.assist !== false;
  const saveOpts = () => optStore.save({ sets: opts.sets, difficulty: opts.difficulty, assist: opts.assist, camera: opts.camera });
  const recStore = storage(REC_KEY, { enabled: !demo });
  let rec = { table: DEFAULT_RECORDS.map(e => ({ ...e })), last: 'AAA' };
  const got = demo ? null : recStore.load(null);
  if (got && Array.isArray(got.table))
    rec = {
      table: got.table
        .filter(e => e && typeof e.n === 'string' && Number.isFinite(e.seasons))
        .map(e => ({ n: e.n.slice(0, 3), crowned: !!e.crowned, majors: e.majors | 0, titles: e.titles | 0, best: Math.max(1, e.best | 0), seasons: Math.max(1, e.seasons | 0) }))
        .sort(better)
        .slice(0, TABLE),
      last: typeof got.last === 'string' ? got.last : 'AAA',
    };
  const qualifies = e => rec.table.length < TABLE || better(e, rec.table[rec.table.length - 1]) < 0;
  // the checkpoint: the tour as it stands at an event's start, each round, and between events
  const autosave = createAutosave('netcord', { enabled: !demo, version: tour.VERSION });
  const loadSaved = () => {
    const r = autosave.load();
    return r && tour.load(r.state) && !r.state.over ? r : null;
  };

  const app = {
    state: demo ? 'demo' : 'title', stT: 0, t: 0, demo, onExit, input, touch: null, hdr: null,
    match: null, venue: venueLook(VENUES[0]), players: null, human: -1, camera: demo ? 'tv' : opts.camera,
    kind: demo ? 'demo' : null, label: '', best: 3, playState: 'match',
    menu: 0, pauseMenu: 0, saved: demo ? null : loadSaved(), opts, optSel: 0,
    tour: null, tourMenu: 0, drawEvent: null, drawSel: 0, summary: null, season: null, trophy: null, msg: null, msgT: -9,
    create: { sel: 0, name: DEFAULT_NAME.padEnd(tour.NAME_MAX, ' ').split(''), pos: 0, editing: false, hand: 0, style: 2, height: 3, nation: 0, kit: 1 },
    pickSel: 0, rankSel: 0, playerSel: 0,
    exhibition: { p: [0, 1], venue: 0, sets: 1, side: 0, sel: 0 },
    drill: { sel: 0, player: 0, partner: 0, venue: 0 },
    pre: null, result: null, change: null,
    entry: { letters: [0, 0, 0], pos: 0 }, records: rec.table, recRank: -1,
    get soundOn() { return audio ? audio.on : false; },
    items: () => [...(app.saved ? ['continue'] : []), 'tour', 'exhibition', 'practice', 'options', 'records', ...(onExit ? ['exit'] : [])],
    tourItems: () => ['next', 'rankings', 'player', 'quit'],
    pauseItems: () => ['resume', 'camera', 'sound', app.kind === 'tour' ? 'retire' : 'quit'],
    nextMatch: () => (app.tour ? tour.nextMatch(app.tour) : null),
  };
  const view = renderer(canvases, app);
  const hdr = createHdr([canvases.gl, cv], { enabled: !demo });
  app.hdr = hdr;
  function go(s) {
    // back on the title: CONTINUE comes and goes with the checkpoint, and is picked first
    if (s === 'title') { app.saved = loadSaved(); app.menu = 0; }
    if (s === 'pause') app.pauseMenu = 0;
    app.state = s; app.stT = 0;
  }
  const say = (msg, ok = true) => { app.msg = { text: msg, ok }; app.msgT = app.t; };

  // ---------- page plumbing (not in the demo) ----------
  let typed = false;
  const typing = () => app.state === 'entry' || (app.state === 'create' && app.create.editing);
  if (!demo) {
    const unlock = () => audio.unlock?.();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => { if (!typing()) toggleFullscreen(); }); // from the key event itself
    input.on('hdr', () => { if (!typing()) hdr.cycle(); });
    listen(cv, 'dblclick', () => toggleFullscreen());
    onAway(listen, () => {
      if (app.state === 'match' || app.state === 'practice') { app.playState = app.state; go('pause'); ui('back'); }
    });
    // initials and names can be typed straight in
    listen(window, 'keydown', e => {
      if (app.state === 'entry' && /^Key[A-Z]$/.test(e.code)) {
        const E = app.entry;
        E.letters[E.pos] = LETTERS.indexOf(e.code.slice(3));
        if (E.pos < 2) E.pos++;
        typed = true; // the same key may also be bound to an action: ignore that this step
        ui('move');
        return;
      }
      if (app.state !== 'create' || !app.create.editing) return;
      const C = app.create;
      if (/^Key[A-Z]$/.test(e.code) || e.code === 'Minus' || e.code === 'Period') {
        C.name[C.pos] = e.code === 'Minus' ? '-' : e.code === 'Period' ? '.' : e.code.slice(3);
        if (C.pos < tour.NAME_MAX - 1) C.pos++;
        typed = true;
        ui('move');
      } else if (e.code === 'Backspace' && C.editing) {
        if (C.name[C.pos] === ' ' && C.pos > 0) C.pos--;
        C.name.splice(C.pos, 1);
        C.name.push(' ');
        typed = true;
        ui('back');
      }
    });
    app.touch = createTouch(cv, { listen });
  }

  // ---------- input ----------
  const taps = () => app.touch?.taps ?? new Set();
  const hit = a => input.pressed(a) || taps().has(a);
  const confirm = () => input.pressed('start') || input.pressed('hit');
  // a swing held over from a menu's confirm doesn't count until let go
  let swingLock = false;
  function controls() {
    let x = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    let y = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
    const st = input.stick?.('left');
    if (st && Math.hypot(st.x, st.y) > 0.3) { x = st.x; y = st.y; }
    let a = input.held('hit'), b = input.held('slice');
    const T = app.touch?.read?.();
    if (T?.on) { x = T.x; y = T.y; }
    if (T?.a) a = true;
    if (T?.b) b = true;
    if (swingLock) { if (a || b) a = b = false; else swingLock = false; }
    [x, y] = toCourt(x, y);
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), a, b };
  }
  // The stick is in screen terms; the sim wants the 'tv' camera's (x → court +x, y → court +z).
  // Turn it by the view, so right on screen is right on court from every camera (hd/camera.js).
  function toCourt(x, y) {
    const end = app.match?.s.end?.[app.human] ?? 1;
    switch (app.camera) {
      case 'behind': return end < 0 ? [-x, -y] : [x, y]; // from the far end: looking up the court
      case 'side': return [y, -x]; // from beside the court, looking across it towards -x
      case 'umpire': return [-y, x]; // from the chair, looking across it towards +x
      default: return [x, y];
    }
  }
  // what the screens drew under this step's tap: { i } | { back } | { go } | … or null
  function tapped() {
    const tp = app.touch?.tapAt, m = tp ? view.menuAt?.(tp.x, tp.y) : null;
    return typeof m === 'number' ? { i: m } : m ?? null;
  }
  // up / down through a list; → the index picked this step, or -1
  function menuStep(key, n, { obj = app, tap = tapped() } = {}) {
    if (n <= 0) return -1;
    if (hit('up')) { obj[key] = (obj[key] + n - 1) % n; ui('move'); }
    if (hit('down')) { obj[key] = (obj[key] + 1) % n; ui('move'); }
    if (Number.isInteger(tap?.i) && tap.i < n) { obj[key] = tap.i; return tap.i; }
    return confirm() ? obj[key] : -1;
  }
  const backed = tap => hit('back') || !!tap?.back;
  const onward = tap => confirm() || !!tap?.go || (taps().has('start') && !tap);
  // ---------- the tour ----------
  function checkpoint() { if (app.tour && !app.tour.over) autosave.save(tour.save(app.tour), tour.label(app.tour)); }
  function toTour(sel = 'next') {
    app.match = null; app.players = null;
    app.tourMenu = Math.max(0, app.tourItems().indexOf(sel));
    go('tour');
  }
  function startTour(T) {
    app.tour = T;
    app.summary = null; app.season = null; app.drawEvent = null;
    checkpoint();
    toTour();
  }
  function newTourCreated() {
    const C = app.create;
    const me = tour.createPlayer({
      name: C.name.join('').trim() || DEFAULT_NAME, hand: C.hand ? 'left' : 'right', style: STYLES[C.style],
      height: tour.HEIGHTS[C.height], country: NATION_CODES[C.nation], kit: C.kit,
    });
    startTour(tour.newTour({ seed: (Math.random() * 1e9) >>> 0, me }));
  }
  function resume() {
    const T = tour.load(app.saved?.state);
    if (!T) { go('create'); return; } // unreadable: begin again rather than strand the title
    app.tour = T; app.summary = null; app.season = null;
    if (T.event) { app.drawEvent = T.event; app.drawSel = 0; go('draw'); return; }
    if (tour.seasonOver(T)) { seasonEnd(); return; }
    toTour();
  }
  function enterNext() {
    const T = app.tour;
    if (T.event) { app.drawEvent = T.event; app.drawSel = 0; go('draw'); return; }
    if (tour.seasonOver(T)) { seasonEnd(); return; }
    app.tour = tour.enter(T);
    app.drawEvent = app.tour.event;
    app.drawSel = 0;
    app.msg = null;
    checkpoint();
    go('draw');
  }
  function prematchTour() {
    const T = app.tour, nm = tour.nextMatch(T);
    if (!nm) return;
    const v = nm.venue;
    app.pre = {
      kind: 'tour', players: [tour.playerOf(T, T.you), tour.playerOf(T, nm.opp)], human: 0, venue: v, best: opts.sets,
      label: `${v.name} · ${nm.name}`, ranks: [tour.rankOf(T, T.you), tour.rankOf(T, nm.opp)], seeds: [T.event.seedOf[T.you] ?? 0, T.event.seedOf[nm.opp] ?? 0],
    };
    go('prematch');
  }
  // a result from the match or SIMULATE: { won, sets: [[yours, theirs]…], retired? }
  function tourResult(res) {
    let T = tour.report(app.tour, res);
    const E = T.event;
    app.match = null; app.players = null;
    if (!E.done) {
      app.tour = T;
      app.drawEvent = E;
      app.drawSel = 0;
      checkpoint();
      const nm = tour.nextMatch(T);
      say(res.won ? `THROUGH TO THE ${nm ? nm.name.toUpperCase() : 'NEXT ROUND'}` : 'OUT', res.won);
      go('draw');
      return;
    }
    const closed = tour.closeEvent(T);
    T = closed.T;
    app.tour = T;
    app.summary = closed.summary;
    app.drawEvent = E;
    app.drawSel = 0;
    app.msg = null;
    if (T.over === 'crowns') autosave.clear();
    else checkpoint();
    if (closed.summary?.won) { app.trophy = { kind: 'event', venue: venueById(E.id) }; ui('cheer'); go('trophy'); }
    else go('draw');
  }
  // after the event's screens: the milestones, then the hub or the season's end
  function afterEvent() {
    const S = app.summary, T = app.tour;
    if (T.over === 'crowns' && app.trophy?.kind !== 'crowns') { app.trophy = { kind: 'crowns' }; ui('cheer'); go('trophy'); return; }
    if (S?.newNo1 && app.trophy?.kind !== 'no1' && app.trophy?.kind !== 'crowns') { app.trophy = { kind: 'no1' }; ui('cheer'); go('trophy'); return; }
    if (T.over) { careerOver(); return; }
    app.trophy = null;
    if (tour.seasonOver(T)) { seasonEnd(); return; }
    toTour();
  }
  function seasonEnd() {
    const { T, summary } = tour.endSeason(app.tour);
    app.tour = T;
    app.season = summary;
    app.drawEvent = null;
    if (T.over) autosave.clear();
    else checkpoint(); // the next season's first event
    go('season');
  }
  // the career is over (the Four Crowns, or the last season played): the records
  function careerOver() {
    autosave.clear();
    app.saved = null;
    const e = careerEntry();
    if (qualifies(e)) {
      app.entry = { letters: rec.last.padEnd(3, 'A').slice(0, 3).split('').map(ch => Math.max(0, LETTERS.indexOf(ch))), pos: 0 };
      typed = false;
      go('entry');
    } else toRecords(-1);
  }
  const careerEntry = () => {
    const T = app.tour;
    return { n: '', crowned: T?.over === 'crowns', majors: T ? tour.majorsWon(T) : 0, titles: T?.titles.length ?? 0, best: Math.max(1, T?.best || 99), seasons: T ? Math.min(tour.SEASONS, T.season - (T.ev === 0 && T.over !== 'crowns' ? 1 : 0)) : 1 };
  };
  function toRecords(rank) { app.recRank = rank; app.records = rec.table; go('records'); }
  function submit() {
    const e = { ...careerEntry(), n: app.entry.letters.map(i => LETTERS[i]).join('') };
    rec.table.push(e);
    rec.table.sort(better);
    rec.table = rec.table.slice(0, TABLE);
    rec.last = e.n;
    recStore.save(rec);
    app.tour = null;
    toRecords(rec.table.indexOf(e));
  }

  // ---------- the match ----------
  let overT = 0, demoEnd = 0;
  function startMatch({ players, human, venue, best, kind, label, practice = null }) {
    const d = human >= 0 ? DIFF_DELTA[opts.difficulty] ?? 0 : 0;
    const ps = players.map((p, k) => (k !== human && human >= 0 ? tour.levelled(p, d) : p));
    app.players = ps;
    app.human = human;
    app.kind = kind;
    app.label = label;
    app.best = best;
    app.venue = venueLook(venue);
    app.match = createMatch({
      players: ps, surface: venue.surface, sets: best, cpu: [human !== 0, human !== 1],
      seed: (Math.random() * 1e9) >>> 0, assist: opts.assist, difficulty: human >= 0 ? DIFF_SIM[opts.difficulty] ?? 1 : 1, ...(practice && { practice }),
    });
    app.result = null; app.change = null;
    overT = 0;
    swingLock = true;
  }
  function kickOff() {
    const P = app.pre;
    startMatch({ ...P, kind: P.kind });
    if (app.kind !== 'demo') app.camera = opts.camera;
    app.playState = 'match';
    go('match');
  }
  function stepMatch({ audible = true } = {}) {
    const m = app.match, h = app.human;
    const ins = [null, null];
    if (h >= 0 && (app.state === 'match' || app.state === 'practice')) ins[h] = controls();
    m.step(ins);
    const ev = m.events ?? [];
    view.events(ev, m);
    if (audible) audio?.match?.(ev, m.s);
    const change = ev.some(e => e?.type === 'change');
    if (Array.isArray(m.events)) m.events.length = 0;
    return { change };
  }
  const over = m => !!m && (m.done || m.s?.phase === 'over');
  function matchStep() {
    if (hit('pause')) { app.playState = app.state; go('pause'); ui('back'); return; }
    if (hit('camera')) cycleCamera(1);
    const m = app.match;
    const { change } = stepMatch();
    if (app.state === 'practice') {
      // practice keeps no score: a finished "match" just starts again
      if (over(m) && (overT += DT) > 1.5) startMatch({ ...app.pre, kind: 'practice', practice: app.pre.practice });
      return;
    }
    if (change && !m.s?.score?.tiebreak && !over(m) && !(app.change && app.t - app.change.at < 10)) {
      app.change = { at: app.t };
      go('changeover');
      return;
    }
    if (over(m) && (overT += DT) > OVER_DELAY) {
      const r = safe(() => m.result()) ?? { winner: 0, sets: [] };
      app.result = { ...r, won: app.human >= 0 ? r.winner === app.human : null, retired: false };
      ui(app.result.won === false ? 'back' : 'cheer');
      go('result');
    }
  }
  function cycleCamera(d) {
    app.camera = CAMERAS[(CAMERAS.indexOf(app.camera) + CAMERAS.length + d) % CAMERAS.length];
    ui('move');
  }
  // the changeover is over: the sim's walk to the other end runs out unseen and unheard
  function endChangeover() {
    const m = app.match;
    m?.skip?.();
    for (let k = 0; k < 60 * 30 && m && m.s?.phase === 'change'; k++) stepMatch({ audible: false });
    swingLock = true;
    go('match');
  }
  const setsSoFar = m => {
    const sc = m?.s?.score;
    const sets = (sc?.sets ?? []).map(s => [s[0], s[1]]);
    if (sc?.games && (sc.games[0] || sc.games[1])) sets.push([sc.games[0], sc.games[1]]);
    return sets;
  };
  function leaveMatch() {
    const kind = app.kind, m = app.match;
    if (kind === 'tour') {
      // retiring hands the match to the opponent, with the score as it stood
      const h = app.human, sets = setsSoFar(m).map(s => (h === 1 ? [s[1], s[0]] : s));
      tourResult({ won: false, sets, retired: true });
      return;
    }
    app.match = null; app.players = null;
    go(kind === 'practice' ? 'drill' : 'exhibition');
  }
  function resultDone() {
    const kind = app.kind, r = app.result;
    if (kind === 'tour') {
      const h = app.human, sets = (r?.sets ?? []).map(s => (h === 1 ? [s[1], s[0]] : [s[0], s[1]]));
      tourResult({ won: !!r?.won, sets });
      return;
    }
    app.match = null; app.players = null;
    go('exhibition');
  }

  // ---------- exhibition and practice ----------
  function prematchExhibition() {
    const X = app.exhibition, v = VENUES[X.venue];
    app.pre = {
      kind: 'exhibition', players: [PLAYERS[X.p[0]], PLAYERS[X.p[1]]].map(p => tour.playerOf(null, p.id)), human: X.side === 2 ? -1 : X.side,
      venue: v, best: SETS[X.sets], label: `Exhibition · ${v.name}`, ranks: [PLAYERS[X.p[0]].rank, PLAYERS[X.p[1]].rank], seeds: [0, 0],
    };
    go('prematch');
  }
  // the ball machine: a stand-in player the sim feeds balls with (practice: 'machine')
  const MACHINE = {
    id: 'machine', name: 'Ball Machine', short: 'MACHINE', country: 'ALM', hand: 'right', height: 1.2,
    ratings: { speed: 1, power: 5, accuracy: 7, spin: 4, serve: 5, volley: 1, stamina: 9 }, style: 'baseline',
    kit: { shirt: '#3b1f6b', shorts: '#3b1f6b', band: '#e4f33a' }, skin: '#9aa3ad', hair: '#3b1f6b',
  };
  function startPractice() {
    const D = app.drill, v = VENUES[D.venue], me = tour.playerOf(null, PLAYERS[D.player].id);
    const partner = D.partner === 0 ? MACHINE : tour.playerOf(null, PLAYERS[(D.partner - 1) % PLAYERS.length].id);
    app.pre = { kind: 'practice', players: [me, partner], human: 0, venue: v, best: 1, label: 'Practice', practice: D.partner === 0 ? 'machine' : 'partner' };
    startMatch({ ...app.pre });
    app.camera = opts.camera;
    app.playState = 'practice';
    go('practice');
  }

  // ---------- demo: back-to-back exhibitions between two tour players, both on the computer ----------
  function demoLoad() {
    const a = rand(16);
    let b = rand(PLAYERS.length - 1);
    if (b >= a) b++;
    const v = VENUES[rand(VENUES.length)];
    app.pre = { players: [PLAYERS[a], PLAYERS[b]].map(p => tour.playerOf(null, p.id)), human: -1, venue: v, best: DEMO_SETS, label: v.name };
    startMatch({ ...app.pre, kind: 'demo' });
    app.camera = 'tv';
    demoEnd = 0;
  }
  let demoT = 0;
  function demoStep() {
    const m = app.match;
    demoT += DT;
    if (!over(m) && demoT < 60 * 8) {
      const { change } = stepMatch({ audible: false });
      // now and then another camera at a change of ends
      if (change) app.camera = Math.random() < 0.6 ? 'tv' : CAMERAS[1 + rand(3)];
    } else if ((demoEnd += DT) > 3) { demoT = 0; demoLoad(); }
  }

  // ---------- the screens' steps ----------
  const wrapI = (v, d, n) => (v + n + d) % n;
  function titleStep() {
    const items = app.items();
    app.menu = Math.min(app.menu, items.length - 1);
    const i = menuStep('menu', items.length);
    if (i >= 0) {
      const it = items[i];
      ui('select');
      if (it === 'continue') resume();
      else if (it === 'tour') { app.create.sel = 0; app.create.editing = false; go('create'); }
      else if (it === 'exhibition') { app.exhibition.sel = 0; go('exhibition'); }
      else if (it === 'practice') { app.drill.sel = 0; go('drill'); }
      else if (it === 'options') { app.optSel = 0; go('options'); }
      else if (it === 'records') toRecords(-1);
      else if (it === 'exit') onExit?.();
    } else if (onExit && hit('quit')) onExit();
  }
  function createStep() {
    const C = app.create, skip = typed;
    typed = false;
    const tap = tapped();
    if (C.editing) {
      // the name: ↑ ↓ the letter, ← → the place, confirm or back to finish
      if (tap && Number.isInteger(tap.letter)) { C.pos = tap.letter; if (tap.d) turnLetter(C, tap.d); return; }
      if (tap?.done || (tap && !Number.isInteger(tap.letter))) { C.editing = false; ui('select'); return; }
      if (skip) return;
      if (hit('up')) turnLetter(C, 1);
      if (hit('down')) turnLetter(C, -1);
      if (hit('right') && C.pos < tour.NAME_MAX - 1) { C.pos++; ui('move'); }
      if (hit('left') && C.pos > 0) { C.pos--; ui('move'); }
      if (confirm() || hit('back')) { C.editing = false; ui('select'); }
      return;
    }
    if (skip) return;
    if (backed(tap)) { ui('back'); go('title'); return; }
    if (tap && Number.isInteger(tap.letter)) { C.sel = 0; startEditing(C, tap.letter); ui('select'); return; }
    const change = (row, d) => {
      if (row === 'hand') C.hand = 1 - C.hand;
      else if (row === 'style') C.style = wrapI(C.style, d, STYLES.length);
      else if (row === 'height') C.height = wrapI(C.height, d, tour.HEIGHTS.length);
      else if (row === 'nation') C.nation = wrapI(C.nation, d, NATION_CODES.length);
      else if (row === 'kit') C.kit = wrapI(C.kit, d, KITS.length);
      else return false;
      ui('move');
      return true;
    };
    rowsStepWith(C, CREATE_ROWS, change, row => {
      if (row === 'name') { startEditing(C); ui('select'); return true; }
      if (row === 'start') { ui('select'); newTourCreated(); return true; }
      if (row === 'pick') { ui('select'); app.pickSel = 0; go('pick'); return true; }
      return false;
    }, tap);
  }
  // the name: the untouched default clears for a fresh one; a name of your own is edited at its end
  function startEditing(C, at = -1) {
    const name = C.name.join('').trim();
    if (name === DEFAULT_NAME) C.name = Array.from({ length: tour.NAME_MAX }, () => ' ');
    C.editing = true;
    C.pos = at >= 0 ? at : Math.max(0, Math.min(tour.NAME_MAX - 1, C.name.join('').trimEnd().length));
  }
  function turnLetter(C, d) {
    const n = NAME_LETTERS.length, k = Math.max(0, NAME_LETTERS.indexOf(C.name[C.pos]));
    C.name[C.pos] = NAME_LETTERS[(k + n + d) % n];
    ui('move');
  }
  function pickStep() {
    const tap = tapped(), n = PLAYERS.length;
    if (backed(tap)) { ui('back'); go('create'); return; }
    // a 4 × 8 grid: ← → along, ↑ ↓ between the rows
    if (hit('left')) { app.pickSel = wrapI(app.pickSel, -1, n); ui('move'); }
    if (hit('right')) { app.pickSel = wrapI(app.pickSel, 1, n); ui('move'); }
    if (hit('up')) { app.pickSel = wrapI(app.pickSel, -4, n); ui('move'); }
    if (hit('down')) { app.pickSel = wrapI(app.pickSel, 4, n); ui('move'); }
    if (Number.isInteger(tap?.i) && tap.i < n) {
      if (tap.i !== app.pickSel) { app.pickSel = tap.i; ui('move'); return; }
    } else if (!(tap?.go || confirm())) return;
    ui('select');
    startTour(tour.newTour({ seed: (Math.random() * 1e9) >>> 0, pick: PLAYERS[app.pickSel].id }));
  }
  function tourStep() {
    const items = app.tourItems(), tap = tapped();
    if (hit('back') && app.tourMenu !== items.length - 1) { app.tourMenu = items.length - 1; ui('back'); return; }
    const i = menuStep('tourMenu', items.length, { tap });
    if (i < 0) return;
    ui('select');
    const it = items[i];
    if (it === 'next') enterNext();
    else if (it === 'rankings') { app.rankSel = 0; go('rankings'); }
    else if (it === 'player') { app.playerSel = 0; trainedHere = false; app.msg = null; go('player'); }
    else if (it === 'quit') { app.tour = null; go('title'); } // the checkpoint stays for CONTINUE
  }
  function drawStep() {
    const E = app.drawEvent, tap = tapped();
    if (!E) { toTour(); return; }
    if (E.done) {
      // the event is over: on to what comes after it
      if ((app.stT > 0.4 && onward(tap)) || backed(tap)) { ui('select'); afterEvent(); }
      return;
    }
    if (backed(tap)) { ui('back'); toTour(); return; }
    const i = menuStep('drawSel', DRAW_ITEMS.length, { tap: tap?.act ? { i: DRAW_ITEMS.indexOf(tap.act) } : tap });
    if (i < 0) return;
    const it = DRAW_ITEMS[i];
    if (it === 'play') { ui('select'); prematchTour(); }
    else if (it === 'sim') { ui('select'); const r = tour.quick(app.tour); if (r) tourResult(r); }
    else { ui('back'); toTour(); }
  }
  let trainedHere = false;
  function playerStep() {
    const tap = tapped(), rows = 7;
    if (backed(tap)) { ui('back'); if (trainedHere) checkpoint(); toTour('player'); return; }
    const i = menuStep('playerSel', rows, { tap });
    if (i < 0) return;
    const a = ['speed', 'power', 'accuracy', 'spin', 'serve', 'volley', 'stamina'][i];
    const r = tour.train(app.tour, a);
    if (r.ok) { app.tour = r.T; trainedHere = true; say(`${a.toUpperCase()} UP TO ${tour.ratingsOf(r.T)[a]}`, true); ui('coin'); }
    else { say(String(r.why).toUpperCase(), false); ui('error'); }
  }
  function optionsStep() {
    const tap = tapped();
    if (backed(tap)) { ui('back'); go('title'); return; }
    const O = { sel: app.optSel };
    const change = (row, d) => {
      if (row === 'sets') opts.sets = SETS[wrapI(SETS.indexOf(opts.sets), d, SETS.length)];
      else if (row === 'difficulty') opts.difficulty = DIFFICULTY[wrapI(DIFFICULTY.indexOf(opts.difficulty), d, DIFFICULTY.length)];
      else if (row === 'assist') opts.assist = !opts.assist;
      else if (row === 'camera') opts.camera = CAMERAS[wrapI(CAMERAS.indexOf(opts.camera), d, CAMERAS.length)];
      else if (row === 'sound') audio?.setOn?.(!audio.on);
      else return false;
      saveOpts();
      ui('move');
      return true;
    };
    rowsStepWith(O, OPTION_ROWS, change, row => {
      if (row === 'done') { ui('back'); go('title'); return true; }
      return false;
    }, tap);
    app.optSel = O.sel;
  }
  // rows with ◀ ▶ values and an action row or two, the selection at obj.sel: `change(row, d)`
  // (false when the row has no value), `act(row, tapped)` (false when it has no action)
  function rowsStepWith(obj, rows, change, act, tap) {
    if (tap?.d && tap.row != null) { obj.sel = tap.row; change(rows[tap.row], tap.d); return; }
    if ((hit('left') || hit('right')) && change(rows[obj.sel], hit('left') ? -1 : 1) !== false) return;
    const i = menuStep('sel', rows.length, { obj, tap });
    if (i >= 0 && act(rows[i], !!tap) === false && !tap) change(rows[i], 1);
  }
  function exhibitionStep() {
    const X = app.exhibition, tap = tapped(), n = PLAYERS.length;
    if (backed(tap)) { ui('back'); go('title'); return; }
    if (tap?.go) { ui('select'); prematchExhibition(); return; }
    const change = (row, d) => {
      if (row === 'p0' || row === 'p1') {
        const k = row === 'p0' ? 0 : 1;
        do X.p[k] = wrapI(X.p[k], d, n); while (X.p[k] === X.p[1 - k]);
      } else if (row === 'venue') X.venue = wrapI(X.venue, d, VENUES.length);
      else if (row === 'sets') X.sets = wrapI(X.sets, d, SETS.length);
      else if (row === 'side') X.side = wrapI(X.side, d, 3);
      else return false;
      ui('move');
      return true;
    };
    rowsStepWith(X, EXHIBITION_ROWS, change, row => {
      if (row === 'start') { ui('select'); prematchExhibition(); return true; }
      return false;
    }, tap);
  }
  function drillStep() {
    const D = app.drill, tap = tapped(), n = PLAYERS.length;
    if (backed(tap)) { ui('back'); go('title'); return; }
    if (tap?.go) { ui('select'); startPractice(); return; }
    const change = (row, d) => {
      if (row === 'player') D.player = wrapI(D.player, d, n);
      else if (row === 'partner') D.partner = wrapI(D.partner, d, n + 1);
      else if (row === 'venue') D.venue = wrapI(D.venue, d, VENUES.length);
      else return false;
      ui('move');
      return true;
    };
    rowsStepWith(D, DRILL_ROWS, change, row => {
      if (row === 'start') { ui('select'); startPractice(); return true; }
      return false;
    }, tap);
  }
  function pauseStep() {
    const items = app.pauseItems();
    app.pauseMenu = Math.min(app.pauseMenu, items.length - 1);
    const tap = tapped();
    const back = () => { swingLock = true; go(app.playState); };
    if (hit('pause') || hit('back')) { ui('back'); back(); return; }
    if (tap?.d && tap.row != null) { app.pauseMenu = tap.row; if (items[tap.row] === 'camera') cycleCamera(tap.d); return; }
    if (items[app.pauseMenu] === 'camera' && (hit('left') || hit('right'))) { cycleCamera(hit('left') ? -1 : 1); return; }
    if (hit('camera')) cycleCamera(1);
    const i = menuStep('pauseMenu', items.length, { tap });
    if (i < 0) return;
    const it = items[i];
    ui('select');
    if (it === 'resume') back();
    else if (it === 'camera') { if (!tap) cycleCamera(1); }
    else if (it === 'sound') audio?.setOn?.(!audio.on);
    else leaveMatch();
  }
  function entryStep() {
    const E = app.entry, n = LETTERS.length;
    const skip = typed;
    typed = false;
    const press = a => !skip && hit(a);
    const turn = d => { E.letters[E.pos] = (E.letters[E.pos] + n + d) % n; ui('move'); };
    const tap = tapped();
    if (tap && Number.isInteger(tap.letter)) { E.pos = tap.letter; if (tap.d) turn(tap.d); return; }
    if (tap?.done) { ui('select'); submit(); return; }
    if (press('up')) turn(1);
    if (press('down')) turn(-1);
    if (press('right') && E.pos < 2) { E.pos++; ui('move'); }
    if ((press('left') || hit('back')) && E.pos > 0) { E.pos--; ui('back'); }
    // Space and pad South step on letter by letter; Enter and pad Start sign at once
    if (press('hit')) { ui('select'); if (E.pos < 2) E.pos++; else submit(); }
    else if (!skip && input.pressed('start')) { ui('select'); submit(); }
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    app.touch?.update(app);
    if (hit('sound') && !typing()) audio?.setOn?.(!audio.on);
    switch (app.state) {
      case 'title': titleStep(); break;
      case 'create': createStep(); break;
      case 'pick': pickStep(); break;
      case 'tour': tourStep(); break;
      case 'draw': drawStep(); break;
      case 'rankings': {
        const tap = tapped(), n = app.tour ? tour.pool(app.tour).length : 0;
        if (backed(tap) || onward(tap)) { ui('back'); toTour('rankings'); break; }
        if (hit('up')) app.rankSel = wrapI(app.rankSel, -1, n);
        if (hit('down')) app.rankSel = wrapI(app.rankSel, 1, n);
        break;
      }
      case 'player': playerStep(); break;
      case 'prematch': {
        const tap = tapped();
        if (backed(tap)) { ui('back'); if (app.pre?.kind === 'tour') go('draw'); else go('exhibition'); break; }
        if (app.stT > 0.3 && onward(tap)) { ui('select'); kickOff(); }
        break;
      }
      case 'match':
      case 'practice':
        matchStep();
        break;
      case 'pause': pauseStep(); break;
      case 'changeover': {
        const tap = tapped();
        if (hit('camera')) cycleCamera(1);
        if ((app.stT > 0.4 && (onward(tap) || hit('pause'))) || app.stT > CHANGE_SHOW) { ui('select'); endChangeover(); }
        break;
      }
      case 'result': {
        const tap = tapped();
        if (app.stT > 0.8 && onward(tap)) { ui('select'); resultDone(); }
        break;
      }
      case 'trophy': {
        const tap = tapped();
        if ((app.stT > 2 && onward(tap)) || app.stT > 90) {
          ui('select');
          if (app.trophy?.kind === 'crowns' || app.trophy?.kind === 'retired') careerOver();
          else afterEvent();
        }
        break;
      }
      case 'season': {
        const tap = tapped();
        if (app.stT > 0.8 && onward(tap)) {
          ui('select');
          if (app.tour?.over) { app.trophy = { kind: app.tour.over === 'crowns' ? 'crowns' : 'retired' }; go('trophy'); }
          else toTour();
        }
        break;
      }
      case 'entry': entryStep(); break;
      case 'records': {
        const tap = tapped();
        if (app.stT > 0.3 && (backed(tap) || onward(tap) || (onExit && hit('quit')))) { ui('back'); go('title'); }
        break;
      }
      case 'options': optionsStep(); break;
      case 'exhibition': exhibitionStep(); break;
      case 'drill': drillStep(); break;
    }
    app.touch?.clear();
  }

  // ---------- music and the crowd, by screen ----------
  const MATCH = new Set(['match', 'practice', 'pause', 'changeover', 'result']);
  let lastTrack;
  function soundStep() {
    if (!audio) return;
    const st = app.state;
    let track = null;
    if (st === 'title' || st === 'records' || st === 'options') track = 'title';
    else if (st === 'trophy' || st === 'entry') track = 'win';
    else if (!MATCH.has(st)) track = 'menu';
    if (track !== lastTrack) { audio.music?.(track); lastTrack = track; }
    let crowd = 0;
    if (MATCH.has(st) && app.match) {
      const v = app.kind === 'tour' ? venueById(app.tour?.event?.id ?? app.drawEvent?.id) : null;
      const big = app.kind === 'tour' ? (v?.tier === 'crown' ? 1 : 0.75) : app.kind === 'practice' ? 0.08 : 0.5;
      crowd = st === 'match' || st === 'practice' ? big : st === 'pause' ? 0 : big * 0.5;
    }
    audio.crowd?.(crowd);
  }

  // ---------- loop ----------
  function tick() {
    update();
    soundStep();
  }
  // a skipped frame leaves the WebGL buffer stale: keep the last HDR one
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => { if (view.draw(app) !== false) hdr.present(); } });
  if (demo) {
    demoLoad();
    // a still demo shows a rally a little way into a match
    const n = reducedMotion ? 60 * 20 : 1;
    for (let i = 0; i < n; i++) demoStep();
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
    audio?.destroy?.();
  }
  return { stop, app };
}
function safe(fn) {
  try { return fn(); } catch { return null; }
}
