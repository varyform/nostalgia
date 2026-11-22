// The game session: input → the user's footballer, the screen flow, the attract-mode demo,
// sound and music, touch, the honours table and the autosave behind the title's CONTINUE. It
// never draws: the renderer (hd/render.js) reads this `app` object every frame and implements
// { draw(app), events(list, match), menuAt(x, y), destroy() }; outside a match (and over a
// frozen one in 'pause', 'halftime' and 'fulltime') it hands the screen to hd/screens.js.
//
//   state      'title' | 'friendly' | 'clubs' | 'hub' | 'squad' | 'table' | 'fixtures' | 'cup'
//              | 'transfers' | 'prematch' | 'match' | 'pause' | 'halftime' | 'fulltime'
//              | 'season' | 'won' | 'entry' | 'honours' | 'options' | 'demo'
//   items()    the title's or the hub's entries, at app.menu; pauseItems() at app.pauseMenu
//   kind       'career' | 'friendly' | 'demo': what the match on screen is
//   label      the match's competition line ('Second Division · Matchday 3', 'Friendly')
//   career     the career (career.js) while one is open; fx its match this week; report the
//              last week's (playWeek); summary the season's end (endSeason)
//
// A tap asks the screens (view.menuAt) what is under it: { i } an entry or a row, { tab },
// { back }, { go }, { d: ±1, row } a ◀ ▶ arrow, { letter, d } / { done } on the initials.
import { createHdr } from '@nostalgia/game/hdr';
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import * as career from './career.js';
import { CLUBS, clubOf } from './clubs.js';
import { DT, createMatch } from './sim.js';
import { createTouch } from './touch.js';

const HOF_KEY = 'swerve-hof';
const OPT_KEY = 'swerve-options';
const TABLE = 8;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
export const HALVES = [3, 5, 7]; // minutes a half
export const TRANSFER_TABS = ['GK', 'DF', 'MF', 'FW', 'SELL'];
export const HUB = ['play', 'squad', 'table', 'fixtures', 'cup', 'transfers', 'quit'];
// the honours table: the managers who won the First Division, fewest seasons first
const DEFAULT_HOF = [
  ['ORM', 3, 'DUN', 38], ['TJV', 4, 'OST', 36], ['ELK', 4, 'SAL', 33], ['BRY', 5, 'COP', 35],
  ['NAS', 6, 'IRO', 32], ['QDE', 7, 'HIG', 31], ['MUL', 8, 'PEL', 30], ['FOX', 10, 'MAR', 29],
].map(([n, s, c, pts]) => ({ n, s, c, pts }));
const better = (a, b) => a.s - b.s || b.pts - a.pts;
const DEMO_HALF = 75; // seconds a half in the attract match
const PANEL_DELAY = 0.8; // seconds into the sim's halftime / fulltime before the panel comes up

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer } = {}) {
  const { listen, offAll } = listeners();

  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'],
    // the demo hears nothing and stays out of the launcher's <input-glyph> elements
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const audio = demo ? null : createAudio({ sound, on: sound });
  const ui = name => audio?.ui?.(name);

  // ---------- what's kept (never touched by the demo) ----------
  const optStore = storage(OPT_KEY, { enabled: !demo });
  const opts = { half: 5, ...(demo ? {} : optStore.load({})) };
  if (!HALVES.includes(opts.half)) opts.half = 5;
  const hofStore = storage(HOF_KEY, { enabled: !demo });
  let hof = { table: DEFAULT_HOF.map(e => ({ ...e })), last: 'AAA' };
  const got = demo ? null : hofStore.load(null);
  if (got && Array.isArray(got.table))
    hof = {
      table: got.table
        .filter(e => e && typeof e.n === 'string' && Number.isFinite(e.s))
        .map(e => ({ n: e.n.slice(0, 3), s: Math.max(1, e.s | 0), c: String(e.c ?? '').slice(0, 3), pts: e.pts | 0 }))
        .sort(better)
        .slice(0, TABLE),
      last: typeof got.last === 'string' ? got.last : 'AAA',
    };
  const qualifies = e => hof.table.length < TABLE || better(e, hof.table[hof.table.length - 1]) < 0;
  // the checkpoint: the career as it stands at the start of a matchday
  const autosave = createAutosave('swerve', { enabled: !demo, version: career.VERSION });

  const div2 = CLUBS.filter(c => c.div === 2).map(c => c.id);
  const app = {
    state: demo ? 'demo' : 'title', stT: 0, t: 0, demo, onExit, input, touch: null, hdr: null,
    match: null, teams: null, human: -1, kind: demo ? 'demo' : null, label: '',
    menu: 0, pauseMenu: 0, saved: autosave.load(), opts, optSel: 0,
    friendly: { home: 0, away: 1, side: 0, sel: 0 }, clubSel: 0, clubList: div2,
    career: null, fx: null, report: null, summary: null, news: [],
    squad: { sel: 2, mark: null, msg: null, ok: true, msgT: -9 },
    tableDiv: 1, fixSel: 0,
    transfers: { tab: 0, sel: 0, rows: [], msg: null, ok: true, msgT: -9 },
    result: null, panel: null,
    entry: { letters: [0, 0, 0], pos: 0 }, hof: hof.table, hofRank: -1, hofBack: 'title',
    get soundOn() { return audio ? audio.on : false; },
    items: () =>
      app.state === 'hub' ? HUB : [...(app.saved ? ['continue'] : []), 'career', 'friendly', 'options', 'honours', ...(onExit ? ['exit'] : [])],
    pauseItems: () => ['resume', 'sound', app.kind === 'career' ? 'forfeit' : 'quit'],
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
    const unlock = () => audio.unlock?.();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => { if (app.state !== 'entry') toggleFullscreen(); }); // from the key event itself
    input.on('hdr', () => { if (app.state !== 'entry') hdr.cycle(); });
    listen(cv, 'dblclick', () => toggleFullscreen());
    onAway(listen, () => { if (app.state === 'match') { go('pause'); ui('back'); } });
    // initials can be typed straight in
    listen(window, 'keydown', e => {
      if (app.state !== 'entry' || !/^Key[A-Z]$/.test(e.code)) return;
      const E = app.entry;
      E.letters[E.pos] = LETTERS.indexOf(e.code.slice(3));
      if (E.pos < 2) E.pos++;
      typed = true; // the same key may also be bound to an action: ignore that this step
      ui('move');
    });
    app.touch = createTouch(cv, { listen });
  }

  // ---------- input ----------
  const taps = () => app.touch?.taps ?? new Set();
  const hit = a => input.pressed(a) || taps().has(a);
  const confirm = () => input.pressed('start') || input.pressed('kick');
  // the held direction (keys give −1/0/1, a stick its own reading, the touch stick its own) and kick
  let kickLock = false; // a kick held over from a menu's confirm doesn't count until let go
  function controls() {
    let x = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
    let y = (input.held('down') ? 1 : 0) - (input.held('up') ? 1 : 0);
    const st = input.stick?.('left');
    if (st && Math.hypot(st.x, st.y) > 0.3) { x = st.x; y = st.y; }
    let kick = input.held('kick');
    const T = app.touch?.read?.();
    if (T?.on) { x = T.x; y = T.y; }
    if (T?.kick) kick = true;
    if (kickLock) { if (kick) kick = false; else kickLock = false; }
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), kick };
  }
  // what the screens drew under this step's tap: { i } | { tab } | { back } | … or null
  function tapped() {
    const tp = app.touch?.tapAt, m = tp ? view.menuAt?.(tp.x, tp.y) : null;
    return typeof m === 'number' ? { i: m } : m ?? null;
  }
  // up / down (and ← → where `h`) through a list; → the index picked this step, or -1
  function menuStep(key, n, { h = false, obj = app, tap = tapped() } = {}) {
    if (n <= 0) return -1;
    const prev = hit('up') || (h && hit('left')), next = hit('down') || (h && hit('right'));
    if (prev) { obj[key] = (obj[key] + n - 1) % n; ui('move'); }
    if (next) { obj[key] = (obj[key] + 1) % n; ui('move'); }
    if (Number.isInteger(tap?.i) && tap.i < n) { obj[key] = tap.i; return tap.i; }
    return confirm() ? obj[key] : -1;
  }
  const backed = tap => hit('back') || !!tap?.back;

  // ---------- the career ----------
  function checkpoint() { if (app.career) autosave.save(career.save(app.career), career.label(app.career)); }
  function toHub(from = 'play') {
    app.fx = career.fixture(app.career);
    app.match = null; app.teams = null;
    app.menu = Math.max(0, HUB.indexOf(from));
    go('hub');
  }
  function newCareer(club) {
    app.career = career.newCareer({ seed: (Math.random() * 1e9) >>> 0, club });
    app.report = null; app.news = [];
    checkpoint();
    toHub();
  }
  function resume() {
    const C = career.load(app.saved?.state);
    if (!C) { go('clubs'); return; } // unreadable: begin again rather than strand the title
    app.career = C; app.report = null; app.news = C.news ?? [];
    if (career.seasonOver(C)) { seasonEnd(); return; }
    toHub();
  }
  function seasonEnd() {
    const { C, summary } = career.endSeason(app.career);
    app.career = C;
    app.summary = summary;
    if (summary.title || summary.up || summary.cupStage === 4) ui('cheer');
    checkpoint(); // the next season's first matchday
    go('season');
  }

  // ---------- squad ----------
  let squadDirty = false;
  const squadRows = () => {
    const L = career.lineupOf(app.career, app.career.club);
    const by = new Map(L.players.map(p => [p.id, p]));
    return [...L.xi.map(id => by.get(id)), ...career.benchOf(app.career)];
  };
  app.squadRows = () => (app.career ? squadRows() : []);
  function squadMsg(s, ok) { Object.assign(app.squad, { msg: s, ok, msgT: app.t }); ui(ok ? 'select' : 'error'); }
  function squadStep() {
    const Q = app.squad, tap = tapped(), rows = squadRows(), n = rows.length + 2;
    if (backed(tap)) {
      if (Q.mark) { Q.mark = null; ui('back'); return; }
      ui('back');
      if (squadDirty) checkpoint();
      toHub('squad');
      return;
    }
    // row 0 the shape (◀ ▶), row 1 PICK BEST XI, then the players: XI first, then the bench
    const keys = career.formations();
    const turn = d => {
      const k = keys[(keys.indexOf(app.career.formation) + keys.length + d) % keys.length];
      app.career = career.setFormation(app.career, k);
      squadDirty = true; ui('move');
    };
    if (tap?.d && tap.row === 0) { Q.sel = 0; turn(tap.d); return; }
    if (Q.sel === 0 && (hit('left') || hit('right'))) { turn(hit('left') ? -1 : 1); return; }
    const i = menuStep('sel', n, { obj: Q, tap });
    if (i < 0) return;
    if (i === 0) { turn(1); return; }
    if (i === 1) { app.career = career.autoPick(app.career); Q.mark = null; squadDirty = true; squadMsg('BEST ELEVEN PICKED', true); return; }
    const p = rows[i - 2];
    if (!p) return;
    if (!Q.mark) { Q.mark = p.id; ui('select'); return; }
    if (Q.mark === p.id) { Q.mark = null; ui('back'); return; }
    const why = career.swapWhy(app.career, Q.mark, p.id);
    if (why) { squadMsg(why.toUpperCase(), false); Q.mark = null; return; }
    app.career = career.swap(app.career, Q.mark, p.id);
    Q.mark = null; squadDirty = true; ui('select');
  }

  // ---------- transfers ----------
  let tradeDirty = false;
  function transferRows() {
    const T = app.transfers, tab = TRANSFER_TABS[T.tab];
    T.rows = tab === 'SELL' ? career.sellList(app.career) : career.market(app.career, tab);
    T.sel = Math.max(0, Math.min(T.sel, T.rows.length - 1));
  }
  function openTransfers() {
    app.transfers = { tab: 0, sel: 0, rows: [], msg: null, ok: true, msgT: -9 };
    tradeDirty = false;
    transferRows();
    go('transfers');
  }
  function trade() {
    const T = app.transfers, r = T.rows[T.sel], selling = TRANSFER_TABS[T.tab] === 'SELL';
    if (!r) return;
    const res = selling ? career.sell(app.career, r.p.id) : career.buy(app.career, r.p.id);
    T.msgT = app.t;
    if (res.ok) {
      app.career = res.C;
      T.ok = true;
      T.msg = (res.C.news?.[0] ?? '').toUpperCase();
      tradeDirty = true;
      ui('coin');
    } else {
      T.ok = false;
      T.msg = String(res.why ?? "Can't do that").toUpperCase();
      ui('error');
    }
    transferRows();
  }
  function transfersStep() {
    const T = app.transfers, tap = tapped();
    if (backed(tap)) { ui('back'); if (tradeDirty) checkpoint(); toHub('transfers'); return; }
    const tab = Number.isInteger(tap?.tab) ? tap.tab : hit('left') ? T.tab + TRANSFER_TABS.length - 1 : hit('right') ? T.tab + 1 : null;
    if (tab != null) { T.tab = tab % TRANSFER_TABS.length; T.sel = 0; T.msg = null; transferRows(); ui('move'); return; }
    const n = T.rows.length;
    if (Number.isInteger(tap?.i) && tap.i < n) {
      // a tap picks a row; a second tap (or its own button) trades
      if (tap.act || T.sel === tap.i) { T.sel = tap.i; trade(); } else { T.sel = tap.i; ui('move'); }
      return;
    }
    if (n && hit('up')) { T.sel = (T.sel + n - 1) % n; ui('move'); }
    if (n && hit('down')) { T.sel = (T.sel + 1) % n; ui('move'); }
    if (confirm()) trade();
  }

  // ---------- the match ----------
  let shown = new Set();
  function startMatch({ teams, human, kind, label, knockout = false, halfSeconds }) {
    app.teams = teams;
    app.human = human;
    app.kind = kind;
    app.label = label;
    app.match = createMatch({
      teams, seed: (Math.random() * 1e9) >>> 0, halfSeconds,
      cpu: [human !== 0, human !== 1], knockout,
    });
    app.result = null; app.panel = null;
    shown = new Set();
    kickLock = true;
  }
  function prematchCareer() {
    const fx = app.fx;
    if (!fx) return;
    app.pre = { teams: career.teamsFor(app.career, fx), human: fx.home === app.career.club ? 0 : 1, label: fx.label, knockout: fx.knockout, kind: 'career' };
    go('prematch');
  }
  function prematchFriendly() {
    const F = app.friendly, ids = CLUBS.map(c => c.id);
    const home = ids[F.home], away = ids[F.away];
    app.pre = { teams: career.matchTeams(null, home, away), human: F.side === 2 ? -1 : F.side, label: 'Friendly', knockout: false, kind: 'friendly' };
    go('prematch');
  }
  function kickOff() {
    const P = app.pre;
    startMatch({ ...P, halfSeconds: opts.half * 60 });
    go('match');
  }
  function stepMatch() {
    const m = app.match, h = app.human;
    const ins = [null, null];
    if (h >= 0) ins[h] = controls();
    m.step(ins);
    const ev = m.events ?? [];
    view.events(ev, m);
    audio?.match?.(ev, m.s);
    if (Array.isArray(m.events)) m.events.length = 0;
  }
  // the sim plays its own breaks; the app puts a panel over them, once each
  function panelDue() {
    const m = app.match, s = m.s;
    if (m.done && !shown.has('done')) return 'done';
    if (s.phase === 'halftime' && s.phaseT >= PANEL_DELAY && !shown.has('half' + s.half)) return 'half' + s.half;
    if (s.phase === 'fulltime' && s.phaseT >= PANEL_DELAY && !shown.has('full' + s.half)) return 'full' + s.half;
    return null;
  }
  function matchStep() {
    if (hit('pause')) { go('pause'); ui('back'); return; }
    stepMatch();
    const due = panelDue();
    if (!due) return;
    shown.add(due);
    if (due === 'done') shown.add('full' + app.match.s.half);
    app.result = app.match.done ? app.match.result() : null;
    app.panel = due.startsWith('half') ? 'halftime' : 'fulltime';
    go(app.panel);
  }
  // the match is over: a friendly goes back to its picker, a career match into the week
  function finish(result) {
    const kind = app.kind;
    app.match = null; app.teams = null;
    if (kind === 'friendly') { go('friendly'); return; }
    const { C, report } = career.playWeek(app.career, result);
    app.career = C;
    app.report = report;
    app.news = report.news ?? [];
    if (career.seasonOver(C)) { seasonEnd(); return; }
    checkpoint();
    toHub('play');
  }
  function panelStep() {
    const tap = tapped();
    const go_ = app.stT > 0.5 && (confirm() || tap?.go || (taps().has('start') && !tap));
    if (!go_) return;
    ui('select');
    const m = app.match;
    if (app.state === 'halftime') { kickLock = true; go('match'); return; }
    if (m.done) { finish(m.result()); return; }
    // full time but not the end: extra time (a level cup tie) plays on; otherwise the sim's
    // last seconds run out unseen
    const s = m.s, level = s.score[0] === s.score[1] && !s.pens;
    if ((m.knockout ?? app.pre?.knockout) && level) { kickLock = true; go('match'); return; }
    for (let k = 0; k < 60 * 120 && !m.done; k++) { m.step([null, null]); if (Array.isArray(m.events)) m.events.length = 0; }
    finish(m.result());
  }
  function forfeitMatch() {
    if (app.kind === 'career') finish(career.forfeit(app.fx, app.career));
    else { app.match = null; app.teams = null; go('friendly'); }
  }

  // ---------- the title won, the honours ----------
  const crown = () => ({ n: '', s: app.career?.champion ?? app.summary?.season ?? 1, c: clubOf(app.career?.club)?.short ?? '', pts: app.summary?.played?.pts ?? 0 });
  function afterTitle() {
    if (qualifies(crown())) {
      app.entry = { letters: hof.last.padEnd(3, 'A').slice(0, 3).split('').map(ch => Math.max(0, LETTERS.indexOf(ch))), pos: 0 };
      typed = false;
      go('entry');
    } else toHonours(-1, 'hub');
  }
  function toHonours(rank, back = 'title') { app.hofRank = rank; app.hofBack = back; go('honours'); }
  function submit() {
    const e = { ...crown(), n: app.entry.letters.map(i => LETTERS[i]).join('') };
    hof.table.push(e);
    hof.table.sort(better);
    hof.table = hof.table.slice(0, TABLE);
    hof.last = e.n;
    app.hof = hof.table;
    hofStore.save(hof);
    toHonours(hof.table.indexOf(e), 'hub');
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
    if (press('kick')) { ui('select'); if (E.pos < 2) E.pos++; else submit(); }
    else if (!skip && input.pressed('start')) { ui('select'); submit(); }
  }

  // ---------- demo: back-to-back matches between two clubs, both on the computer ----------
  let demoEnd = 0;
  function demoLoad() {
    const ids = CLUBS.map(c => c.id), a = Math.floor(Math.random() * ids.length);
    let b = Math.floor(Math.random() * (ids.length - 1));
    if (b >= a) b++;
    startMatch({ teams: career.matchTeams(null, ids[a], ids[b]), human: -1, kind: 'demo', label: 'Friendly', halfSeconds: DEMO_HALF });
    demoEnd = 0;
  }
  function demoStep() {
    const m = app.match;
    if (!m.done) stepMatch();
    else if ((demoEnd += DT) > 3) demoLoad();
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    app.touch?.update(app);
    if (hit('sound') && app.state !== 'entry') audio?.setOn?.(!audio.on);
    const st = app.state;
    switch (st) {
      case 'title': {
        const items = app.items();
        app.menu = Math.min(app.menu, items.length - 1);
        const i = menuStep('menu', items.length);
        if (i >= 0) {
          const it = items[i];
          ui('select');
          if (it === 'continue') resume();
          else if (it === 'career') { app.clubSel = 0; go('clubs'); }
          else if (it === 'friendly') go('friendly');
          else if (it === 'options') { app.optSel = 0; go('options'); }
          else if (it === 'honours') toHonours(-1, 'title');
          else if (it === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        break;
      }
      case 'clubs': {
        const tap = tapped();
        if (backed(tap)) { ui('back'); go('title'); break; }
        const n = app.clubList.length;
        // a 4 × 2 grid: ← → along, ↑ ↓ between the rows
        if (hit('left')) { app.clubSel = (app.clubSel + n - 1) % n; ui('move'); }
        if (hit('right')) { app.clubSel = (app.clubSel + 1) % n; ui('move'); }
        if (hit('up') || hit('down')) { app.clubSel = (app.clubSel + 4) % n; ui('move'); }
        if (Number.isInteger(tap?.i) && tap.i < n) {
          if (tap.i !== app.clubSel) { app.clubSel = tap.i; ui('move'); break; }
          ui('select'); newCareer(app.clubList[tap.i]); break;
        }
        if (tap?.go || confirm()) { ui('select'); newCareer(app.clubList[app.clubSel]); }
        break;
      }
      case 'friendly': {
        // rows: HOME, AWAY, YOU PLAY (◀ ▶ on each), KICK OFF
        const F = app.friendly, tap = tapped(), n = CLUBS.length;
        const change = d => {
          if (F.sel === 0) do F.home = (F.home + n + d) % n; while (F.home === F.away);
          else if (F.sel === 1) do F.away = (F.away + n + d) % n; while (F.away === F.home);
          else if (F.sel === 2) F.side = (F.side + 3 + d) % 3;
          ui('move');
        };
        if (backed(tap)) { ui('back'); go('title'); break; }
        if (tap?.go) { ui('select'); prematchFriendly(); break; }
        if (tap?.d && tap.row != null) { F.sel = tap.row; change(tap.d); break; }
        if (F.sel < 3 && (hit('left') || hit('right'))) { change(hit('left') ? -1 : 1); break; }
        const i = menuStep('sel', 4, { obj: F, tap });
        if (i === 3) { ui('select'); prematchFriendly(); }
        else if (i >= 0 && !tap) change(1);
        break;
      }
      case 'options': {
        // rows: MATCH LENGTH, SOUND (◀ ▶ on each), BACK
        const tap = tapped();
        const change = d => {
          if (app.optSel === 0) { opts.half = HALVES[(HALVES.indexOf(opts.half) + HALVES.length + d) % HALVES.length]; optStore.save({ half: opts.half }); }
          else if (app.optSel === 1) audio?.setOn?.(!audio.on);
          ui('move');
        };
        if (backed(tap)) { ui('back'); go('title'); break; }
        if (tap?.d && tap.row != null) { app.optSel = tap.row; change(tap.d); break; }
        if (app.optSel < 2 && (hit('left') || hit('right'))) { change(hit('left') ? -1 : 1); break; }
        const i = menuStep('optSel', 3, { tap });
        if (i === 2) { ui('back'); go('title'); }
        else if (i >= 0 && !tap) change(1);
        break;
      }
      case 'hub': {
        const items = HUB;
        if (hit('back') && app.menu !== items.length - 1) { app.menu = items.length - 1; ui('back'); break; }
        const i = menuStep('menu', items.length);
        if (i < 0) break;
        ui('select');
        const it = items[i];
        if (it === 'play') prematchCareer();
        else if (it === 'squad') { app.squad = { sel: 2, mark: null, msg: null, ok: true, msgT: -9 }; squadDirty = false; go('squad'); }
        else if (it === 'table') { app.tableDiv = app.career.div[app.career.club]; go('table'); }
        else if (it === 'fixtures') { app.fixSel = Math.min(app.career.week, career.CALENDAR.length - 1); go('fixtures'); }
        else if (it === 'cup') go('cup');
        else if (it === 'transfers') openTransfers();
        else if (it === 'quit') go('title'); // the checkpoint stays for CONTINUE
        break;
      }
      case 'squad':
        squadStep();
        break;
      case 'table': {
        const tap = tapped();
        if (backed(tap) || confirm() || (taps().has('start') && !tap)) { ui('back'); toHub('table'); break; }
        if (Number.isInteger(tap?.tab)) { app.tableDiv = tap.tab; ui('move'); break; }
        if (hit('left') || hit('right') || hit('up') || hit('down')) { app.tableDiv = 3 - app.tableDiv; ui('move'); }
        break;
      }
      case 'fixtures': {
        const tap = tapped();
        if (backed(tap)) { ui('back'); toHub('fixtures'); break; }
        const i = menuStep('fixSel', career.CALENDAR.length, { tap });
        if (i >= 0 && !tap) { ui('back'); toHub('fixtures'); }
        break;
      }
      case 'cup': {
        const tap = tapped();
        if (backed(tap) || confirm() || (taps().has('start') && !tap)) { ui('back'); toHub('cup'); }
        break;
      }
      case 'transfers':
        transfersStep();
        break;
      case 'prematch': {
        const tap = tapped();
        if (backed(tap)) { ui('back'); if (app.pre?.kind === 'friendly') go('friendly'); else toHub('play'); break; }
        if (tap?.go || confirm() || (taps().has('start') && !tap)) { ui('select'); kickOff(); }
        break;
      }
      case 'match':
        matchStep();
        break;
      case 'pause': {
        const items = app.pauseItems();
        app.pauseMenu = Math.min(app.pauseMenu, items.length - 1);
        const tap = tapped();
        if (hit('pause') || hit('back')) { ui('back'); kickLock = true; go('match'); break; }
        const i = menuStep('pauseMenu', items.length, { tap });
        if (i < 0) break;
        const it = items[i];
        ui('select');
        if (it === 'resume') { kickLock = true; go('match'); }
        else if (it === 'sound') audio?.setOn?.(!audio.on);
        else forfeitMatch();
        break;
      }
      case 'halftime':
      case 'fulltime':
        panelStep();
        break;
      case 'season': {
        const tap = tapped();
        if (app.stT > 0.8 && (confirm() || tap?.go || (taps().has('start') && !tap))) {
          ui('select');
          if (app.summary?.firstTitle) go('won');
          else toHub('play');
        }
        break;
      }
      case 'won': {
        const tap = tapped();
        if ((app.stT > 2.5 && (confirm() || tap?.go || taps().has('start'))) || app.stT > 60) afterTitle();
        break;
      }
      case 'entry':
        entryStep();
        break;
      case 'honours': {
        const tap = tapped();
        if (backed(tap) || confirm() || (taps().has('start') && !tap) || (onExit && app.hofBack === 'title' && hit('quit'))) {
          ui('back');
          if (app.hofBack === 'hub' && app.career) toHub('play');
          else go('title');
        }
        break;
      }
    }
    app.touch?.clear();
  }

  // ---------- music and the crowd, by screen ----------
  const MATCH = new Set(['match', 'pause', 'halftime', 'fulltime']);
  function soundStep() {
    if (!audio) return;
    const st = app.state;
    let track = null;
    if (st === 'title' || st === 'honours' || st === 'options') track = 'title';
    else if (st === 'won' || st === 'entry') track = 'win';
    else if (!MATCH.has(st)) track = 'menu';
    audio.music?.(track);
    let crowd = 0;
    if (MATCH.has(st) && app.match) {
      const big = app.kind === 'career' ? (app.pre?.knockout && app.fx?.round === 3 ? 1 : app.fx?.div === 1 || (app.career && app.career.div[app.career.club] === 1) ? 0.85 : 0.65) : 0.5;
      crowd = st === 'match' ? big : st === 'pause' ? 0 : big * 0.45;
    }
    audio.crowd?.(crowd);
  }

  // ---------- loop ----------
  function tick() {
    update();
    soundStep();
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => { view.draw(app); hdr.present(); } });
  if (demo) {
    demoLoad();
    // a still demo shows a match a little way in
    const n = reducedMotion ? 60 * 25 : 1;
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
  return { stop };
}
