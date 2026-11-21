// The session: input → commands, the screen flow (title, setup, field manual, records, round
// card, play, gear tray, pause, round summary, shop, final standings), the computer players,
// the attract run behind the title and the demo, sound, pointer, the saved setup and records,
// and the autosave behind the title's CONTINUE.
// It never draws: the renderer reads this `app` object every frame and answers hit tests.
import { createHdr } from '@nostalgia/game/hdr';
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave } from '@nostalgia/save';
import meta from '../game.json';
import { aiShop, createBrain } from './ai.js';
import { createAudio } from './audio.js';
import { AI_LEVELS, DEFAULT_SETUP, DT, PIVOT, WALLS, createSim, maxPower, rng } from './sim.js';
import { LANDS } from './terrain.js';
import { createTouch } from './touch.js';
import { GOODS, ITEM, ITEMS, WEAPON, WEAPONS } from './weapons.js';

const SETUP_KEY = 'barrage-setup', RECORDS_KEY = 'barrage-records';
export const COLORS = ['#ff5a5f', '#4cb4ff', '#ffd23f', '#5ef08c', '#ff8ae2', '#ff9a3c', '#b490ff', '#46eedd'];
export const COLOR_NAMES = ['Red', 'Blue', 'Gold', 'Green', 'Pink', 'Orange', 'Violet', 'Teal'];
export const CALLSIGNS = ['Marlow', 'Juno', 'Bramble', 'Cinder', 'Quill', 'Tamsin', 'Vesper', 'Pike', 'Halloran', 'Wren', 'Kestrel', 'Dagny', 'Fennick', 'Brisk', 'Ottoline', 'Sable', 'Corwin', 'Inez', 'Thistle', 'Moss'];
export const CHOICES = {
  rounds: [1, 3, 5, 8, 10, 15, 20],
  wind: [0, 1, 2, 3],
  shifting: [false, true],
  walls: ['random', ...WALLS],
  land: ['mixed', ...LANDS],
  cash: [0, 5000, 15000, 40000, 100000],
  interest: [0, 5, 10],
};
export const SETTINGS = ['rounds', 'wind', 'shifting', 'walls', 'land', 'cash', 'interest'];
const USABLE = ITEMS.filter(i => ['shield', 'patch', 'blink', 'fuel'].includes(i.kind));

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null, renderer } = {}) {
  const { listen, offAll } = listeners();
  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'PageUp', 'PageDown', 'Backspace'],
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const seed0 = (Math.random() * 1e9) | 0;
  const R = rng(seed0 ^ 0x5bd1e995);
  const sim = createSim({ seed: seed0 });
  const audio = demo ? null : createAudio({ on: sound });
  const savedSetup = storage(SETUP_KEY, { enabled: !demo });
  const savedRecords = storage(RECORDS_KEY, { enabled: !demo });
  // the checkpoint: a match between rounds (see checkpoint() below)
  const autosave = createAutosave('barrage', { enabled: !demo, version: 1 });

  const app = {
    state: demo ? 'intro' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, input, demo, onExit, menu: 0, attract: !demo, saved: loadCheckpoint(),
    setup: loadSetup(), setupRow: 0, manualPage: 0,
    records: loadRecords(), standings: null, finalMenu: 0, pauseMenu: 0,
    shop: null, tray: { open: false, sel: 0 }, driving: false, banner: null, touch: null, dragId: null,
    colors: COLORS, colorNames: COLOR_NAMES, choices: CHOICES,
    get soundOn() { return audio ? audio.on : false; },
    titleItems: () => [...(app.saved ? ['continue'] : []), 'play', 'manual', 'records', ...(onExit ? ['exit'] : [])],
    setupRows: () => ['count', ...app.setup.players.map((_, i) => 'p' + i), ...SETTINGS, 'start'],
    trayItems: () => trayItems(),
    owned: t => WEAPONS.filter(w => sim.has(t, w.id)),
  };
  const view = renderer(cv, app);
  const hdr = createHdr([cv], { enabled: !demo });
  app.hdr = hdr;
  function setState(s) {
    // back on the title: CONTINUE comes and goes with the checkpoint, and a new one is picked first
    if (s === 'title' && app.state !== 'title') {
      const was = app.saved?.at;
      app.saved = loadCheckpoint();
      if (app.saved?.at !== was) app.menu = 0;
    }
    app.state = s; app.stT = 0;
  }

  // ---------- saved data ----------
  function loadSetup() {
    const s = savedSetup.load(null), d = DEFAULT_SETUP;
    const ok = s && Array.isArray(s.players) && s.players.length >= 2 && s.players.length <= 8;
    const players = (ok ? s.players : d.players).map((p, i) => ({
      name: typeof p?.name === 'string' && p.name.trim() ? p.name.slice(0, 12) : CALLSIGNS[i],
      color: Number.isInteger(p?.color) && p.color >= 0 && p.color < 8 ? p.color : i,
      ai: Number.isInteger(p?.ai) && p.ai >= 0 && p.ai < AI_LEVELS.length ? p.ai : i ? 2 : 0,
    }));
    const pickOf = (k, v, fb) => (CHOICES[k].includes(v) ? v : fb);
    return {
      players,
      rounds: pickOf('rounds', s?.rounds, d.rounds), wind: pickOf('wind', s?.wind, d.wind), shifting: pickOf('shifting', s?.shifting, d.shifting),
      walls: pickOf('walls', s?.walls, d.walls), land: pickOf('land', s?.land, d.land), cash: pickOf('cash', s?.cash, d.cash), interest: pickOf('interest', s?.interest, d.interest),
    };
  }
  function loadRecords() {
    const r = savedRecords.load(null);
    const out = { matches: 0, players: {} };
    if (r && typeof r === 'object') {
      out.matches = Number.isFinite(r.matches) ? r.matches : 0;
      if (r.players && typeof r.players === 'object')
        for (const [k, v] of Object.entries(r.players)) if (v && Number.isFinite(v.wins)) out.players[k.slice(0, 12)] = { matches: v.matches | 0, wins: v.wins | 0, rounds: v.rounds | 0, kills: v.kills | 0, dmg: v.dmg | 0, ai: v.ai | 0 };
    }
    return out;
  }
  function saveRecords() {
    const rec = app.records;
    rec.matches++;
    const winner = app.standings[0];
    for (const p of sim.players) {
      const r = (rec.players[p.name] ??= { matches: 0, wins: 0, rounds: 0, kills: 0, dmg: 0, ai: p.ai });
      r.matches++; r.rounds += p.stats.wins; r.kills += p.stats.kills; r.dmg += p.stats.dmg; r.ai = p.ai;
      if (p === winner) r.wins++;
    }
    // keep the table small
    const names = Object.keys(rec.players).sort((a, b) => rec.players[b].wins - rec.players[a].wins || rec.players[b].kills - rec.players[a].kills);
    for (const n of names.slice(40)) delete rec.players[n];
    savedRecords.save(rec);
  }

  // ---------- matches ----------
  const brainSpeed = () => (demo || app.attract ? 2.4 : 1.3);
  let brain = null;
  function beginMatch(setup) {
    sim.reseed((R() * 1e9) | 0);
    sim.newMatch(setup);
    brain = createBrain(sim, { seed: (R() * 1e9) | 0, speed: brainSpeed() });
    app.tray = { open: false, sel: 0 }; app.driving = false; app.dragId = null; app.standings = null;
  }
  function attractSetup() {
    const n = 3 + Math.floor(R() * 3), cols = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => R() - 0.5);
    const names = CALLSIGNS.slice().sort(() => R() - 0.5);
    return {
      players: Array.from({ length: n }, (_, i) => ({ name: names[i], color: cols[i], ai: 2 + Math.floor(R() * 3) })),
      rounds: 3, wind: 1 + Math.floor(R() * 3), shifting: true, walls: 'random', land: 'mixed', cash: 40000, interest: 5,
    };
  }
  // A checkpoint is the whole match between rounds: the setup (rounds, wind, walls, land, cash,
  // interest), every player (name, colour, computer level and persona, cash, stock, scores),
  // how many rounds are done, and the seed the next round's field is drawn from. The match picks
  // up at that round's shop (or its start, with nothing to buy) exactly as it would have.
  let shopSeed = 0; // the computers' shopping after a checkpoint comes from its seed too
  function checkpoint(round) {
    const c = {
      setup: sim.setup, round, seed: (shopSeed = (R() * 1e9) | 0),
      players: sim.players.map(({ name, color, ai, persona, cash, inv, stats }) => ({ name, color, ai, persona, cash, inv, stats })),
    };
    autosave.save(c, `Round ${round + 1} of ${c.setup.rounds}`);
    return c;
  }
  function loadCheckpoint() {
    const s = autosave.load(), c = s?.state;
    const ok = c && c.setup && Array.isArray(c.setup.players) && Array.isArray(c.players) && c.players.length >= 2 && c.players.length === c.setup.players.length;
    return ok ? s : null;
  }
  // the round after a checkpoint, set up as CONTINUE sets it up
  function startFrom(c) {
    shopSeed = c.seed | 0;
    sim.reseed(c.seed | 0);
    sim.resumeMatch(c);
    brain = createBrain(sim, { seed: (R() * 1e9) | 0, speed: brainSpeed() });
    app.tray = { open: false, sel: 0 }; app.driving = false; app.dragId = null; app.standings = null;
  }
  function continueMatch(c) {
    app.attract = false;
    startFrom(c);
    // between rounds there is always a shop; before the first, only with cash to spend
    if (c.round > 0 || c.setup.cash > 0) openShop(true);
    else { setState('intro'); audio?.sfx('round'); }
  }
  function startAttract() { app.attract = true; beginMatch(attractSetup()); for (const p of sim.players) aiShop(sim, p.i, R); }
  function startMatch() {
    savedSetup.save(app.setup);
    beginMatch(app.setup);
    // round 1 starts from the match's first checkpoint, so CONTINUE would start it the same;
    // with cash to spend, everyone shops before it too
    continueMatch(checkpoint(0));
  }
  function autoShop(rand = R) { for (const p of sim.players) if (p.ai) aiShop(sim, p.i, rand); }
  function nextRound() {
    brain.newRound();
    sim.nextRound();
    app.tray.open = false; app.driving = false;
    setState('intro');
    audio?.sfx('round');
  }
  function standings() {
    return sim.players.slice().sort((a, b) => b.stats.wins * 3 + b.stats.kills - (a.stats.wins * 3 + a.stats.kills) || b.stats.dmg - a.stats.dmg || b.cash - a.cash);
  }

  // the computers (and nothing else) at the controls: the attract run and the demo
  let hold = 0, flightAcc = 0;
  function aiStep(speedUp = 1) {
    if (sim.phase === 'aim') { sim.step(brain.step()); return; }
    flightAcc += speedUp;
    while (flightAcc >= 1) { flightAcc--; sim.step({}); if (sim.phase === 'aim') break; }
  }
  function attractStep() {
    if (sim.phase === 'round' || sim.phase === 'match') {
      sim.step({});
      if ((hold += DT) > 2.4) {
        hold = 0;
        if (sim.phase === 'match') startAttract();
        else { autoShop(); brain.newRound(); sim.nextRound(); }
      }
      return;
    }
    aiStep(1.3);
  }
  function demoStep() {
    switch (app.state) {
      case 'intro':
        app.fade = Math.max(0, app.fade - DT * 2);
        if (app.stT > 1.8) setState('play');
        break;
      case 'play':
        aiStep(1.5);
        if (sim.phase === 'round' || sim.phase === 'match') { if ((hold += DT) > 1.6) { hold = 0; setState('roundEnd'); app.standings = standings(); } }
        break;
      case 'roundEnd':
        sim.step({});
        if (app.stT > 3) {
          if (sim.phase === 'match') { setState('final'); app.standings = standings(); }
          else { autoShop(); nextRound(); }
        }
        break;
      case 'final':
        if (app.stT > 3.4) app.fade = Math.min(1, app.fade + DT * 2);
        if (app.stT > 4) { beginMatch(attractSetup()); autoShop(); setState('intro'); }
        break;
    }
  }

  // ---------- page plumbing (not in the demo) ----------
  let typed = false;
  const editingName = () => app.state === 'setup' && /^p\d$/.test(app.setupRows()[app.setupRow] ?? '');
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => { if (!editingName()) toggleFullscreen(); });
    input.on('hdr', () => { if (!editingName()) hdr.cycle(); });
    onAway(listen, () => { if (app.state === 'play') { app.pauseMenu = 0; setState('pause'); } });
    // typed names on the setup screen
    listen(window, 'keydown', e => {
      if (!editingName() || e.ctrlKey || e.metaKey || e.altKey) return;
      const p = app.setup.players[+app.setupRows()[app.setupRow].slice(1)];
      if (e.code === 'Backspace') { p.name = p.name.slice(0, -1); typed = true; audio.sfx('tick'); e.preventDefault(); }
      else if (e.key.length === 1 && /[A-Za-z0-9\-.'!]/.test(e.key) && e.code !== 'Space') {
        if (p.edited !== true) { p.name = ''; p.edited = true; }
        if (p.name.length < 12) p.name += e.key;
        typed = true; audio.sfx('tick');
      }
    });
    app.touch = createTouch(cv, { listen });
  }

  // ---------- input helpers ----------
  const hit = a => !typed && input.pressed(a);
  const held = a => input.held(a);
  const taps = () => (app.touch ? app.touch.taps.map(p => ({ ...p, h: view.hit?.(p.x, p.y, app) })) : []);
  let tapList = [];
  const tapped = act => tapList.some(t => t.h?.act === act);
  const tapOf = act => tapList.find(t => t.h?.act === act)?.h;
  const holdT = {};
  /** 1 on the press, then (after a beat) `rate` per second while held. */
  function repeat(name, on, rate) {
    if (!on) { holdT[name] = 0; return 0; }
    const h = holdT[name] ?? 0;
    holdT[name] = h + DT;
    if (h === 0) return 1;
    return h < 0.3 ? 0 : rate(h - 0.3) * DT;
  }
  /** Touch buttons held down right now (adjust buttons repeat). */
  function heldButtons() {
    const out = new Set();
    if (!app.touch) return out;
    for (const p of app.touch.ptrs.values()) { const h = view.hit?.(p.x, p.y, app); if (h) out.add(h.act); }
    return out;
  }
  function menuMove(n, cur) {
    let m = cur;
    if (hit('up')) { m = (m + n - 1) % n; audio?.sfx('move'); }
    if (hit('down')) { m = (m + 1) % n; audio?.sfx('move'); }
    return m;
  }
  function trayItems() {
    const t = sim.tank;
    if (!t) return [];
    const inv = sim.players[t.p].inv;
    return USABLE.filter(i => inv[i.id] > 0 || (i.kind === 'fuel' && t.fuel > 0)).map(i => ({ ...i, n: inv[i.id] ?? 0 }));
  }

  // ---------- a person's turn ----------
  function humanCmd(t) {
    const cmd = {}, buttons = heldButtons();
    // gear tray
    if (app.tray.open) {
      const items = trayItems();
      const T = app.tray;
      if (!items.length) { T.open = false; return cmd; }
      T.sel = Math.min(T.sel, items.length - 1);
      if (hit('left')) { T.sel = (T.sel + items.length - 1) % items.length; audio?.sfx('move'); }
      if (hit('right')) { T.sel = (T.sel + 1) % items.length; audio?.sfx('move'); }
      const tp = tapOf('trayItem');
      if (tp) T.sel = tp.i;
      if (hit('fire') || hit('start') || tp) {
        const it = items[T.sel];
        T.open = false;
        if (it.kind === 'fuel') { app.driving = true; audio?.sfx('select'); }
        else cmd.use = it.id;
      } else if (hit('items') || hit('back') || tapped('gear') || tapped('trayClose')) { T.open = false; audio?.sfx('back'); }
      return cmd;
    }
    // driving
    if (app.driving) {
      const d = (held('right') || buttons.has('driveR') ? 1 : 0) - (held('left') || buttons.has('driveL') ? 1 : 0) + (held('driveRight') ? 1 : 0) - (held('driveLeft') ? 1 : 0);
      if (d) cmd.drive = d;
      if (hit('fire') || hit('start') || hit('back') || hit('items') || tapped('driveDone')) { app.driving = false; audio?.sfx('back'); }
      return cmd;
    }
    if (hit('items') || tapped('gear')) {
      if (trayItems().length) { app.tray.open = true; audio?.sfx('select'); } else audio?.sfx('denied');
      return cmd;
    }
    // weapon
    const owned = app.owned(t);
    const wi = Math.max(0, owned.findIndex(w => w.id === t.weapon));
    const coarse = held('coarse');
    if (hit('next') || tapped('next')) { cmd.weapon = (coarse && !tapped('next') ? owned[(wi + owned.length - 1) % owned.length] : owned[(wi + 1) % owned.length]).id; audio?.sfx('move'); }
    if (hit('prev') || tapped('prev')) { cmd.weapon = owned[(wi + owned.length - 1) % owned.length].id; audio?.sfx('move'); }
    // keyboard driving, or the pad's drive button with left / right
    const padDrive = held('drive') && input.device.kind === 'gamepad';
    const kd = (held('driveRight') ? 1 : 0) - (held('driveLeft') ? 1 : 0);
    if (padDrive) { const d = (held('right') ? 1 : 0) - (held('left') ? 1 : 0); if (d) cmd.drive = d; }
    else if (kd) cmd.drive = kd;
    // barrel and charge
    if (!padDrive) {
      const aRate = h => (coarse ? 90 : 16 + 50 * Math.min(1, h));
      const al = repeat('left', held('left') || buttons.has('angleL'), aRate), ar = repeat('right', held('right') || buttons.has('angleR'), aRate);
      const pRate = h => (coarse ? 700 : 50 + 380 * Math.min(1, h / 1.2));
      const pu = repeat('up', held('up') || buttons.has('powerUp'), pRate), pd = repeat('down', held('down') || buttons.has('powerDown'), pRate);
      const pgu = repeat('pgup', held('powerUp'), () => 500), pgd = repeat('pgdn', held('powerDown'), () => 500);
      const da = (al === 1 ? (coarse ? 5 : 1) : al) - (ar === 1 ? (coarse ? 5 : 1) : ar);
      const dp = (pu === 1 ? (coarse ? 25 : 1) : pu) - (pd === 1 ? (coarse ? 25 : 1) : pd) + (pgu === 1 ? 50 : pgu) - (pgd === 1 ? 50 : pgd) - (app.touch?.wheel ?? 0) * (coarse ? 50 : 10);
      if (da) { const base = al === 1 || ar === 1 ? Math.round(t.angle) : t.angle; cmd.angle = Math.max(0, Math.min(180, base + da)); }
      if (dp) cmd.power = Math.max(0, Math.min(maxPower(t), t.power + dp));
      if (da || dp) audio?.sfx('tick');
    }
    // pointer aiming: press on open ground, drag
    for (const tp of tapList) if (!tp.h && app.state === 'play') app.dragId = tp.id;
    const drag = app.dragId != null && app.touch?.ptrs.get(app.dragId);
    if (drag) {
      const c = view.toCell(drag.x, drag.y), dx = c.x - t.x, dy = t.y - PIVOT - c.y;
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (a < 0) a = dx >= 0 ? 0 : 180;
      cmd.angle = Math.round(a * 2) / 2;
      cmd.power = Math.min(maxPower(t), Math.round(Math.hypot(dx, dy) * 4));
    } else app.dragId = null;
    if (hit('fire') || tapped('fire')) { cmd.fire = true; app.dragId = null; }
    return cmd;
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    tapList = taps();
    if (hit('sound') && !editingName()) audio.setOn(!audio.on);
    if (app.attract) attractStep();
    switch (app.state) {
      case 'title': {
        const items = app.titleItems();
        app.menu = menuMove(items.length, app.menu);
        const m = tapOf('menu');
        if (m) app.menu = m.i;
        if (hit('start') || hit('fire') || m) {
          const it = items[app.menu];
          audio.sfx('select');
          if (it === 'continue') continueMatch(app.saved.state);
          else if (it === 'play') { app.setupRow = 0; setState('setup'); }
          else if (it === 'manual') { app.manualPage = 0; setState('manual'); }
          else if (it === 'records') setState('records');
          else if (it === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        break;
      }
      case 'manual':
        if (hit('left') || hit('right') || tapped('page')) { app.manualPage = 1 - app.manualPage; audio.sfx('move'); }
        else if (hit('back') || hit('quit') || hit('start') || tapped('back')) { setState('title'); audio.sfx('back'); }
        break;
      case 'records':
        if (app.stT > 0.3 && (hit('back') || hit('quit') || hit('start') || tapList.length)) { setState('title'); audio.sfx('back'); }
        break;
      case 'setup': setupStep(); break;
      case 'intro':
        if (app.stT > 2.6 || (app.stT > 0.4 && (hit('start') || hit('fire') || tapList.length))) setState('play');
        break;
      case 'play': playStep(); break;
      case 'pause': {
        app.pauseMenu = menuMove(2, app.pauseMenu);
        const m = tapOf('pauseItem');
        if (m) app.pauseMenu = m.i;
        if (hit('pause') || hit('back')) setState('play');
        else if (hit('start') || hit('fire') || m) {
          audio.sfx('select');
          if (app.pauseMenu === 0) setState('play');
          else { startAttract(); setState('title'); }
        }
        break;
      }
      case 'roundEnd':
        sim.step({});
        if (app.stT > 0.8 && (hit('start') || hit('fire') || tapList.length)) {
          audio.sfx('select');
          if (sim.phase === 'match') { app.standings = standings(); saveRecords(); autosave.clear(); app.finalMenu = 0; setState('final'); audio.sfx('match'); }
          else openShop();
        }
        break;
      case 'shop': shopStep(); break;
      case 'final': {
        app.finalMenu = menuMove(2, app.finalMenu);
        const m = tapOf('finalItem');
        if (m) app.finalMenu = m.i;
        if (app.stT > 0.8 && (hit('start') || hit('fire') || m)) {
          audio.sfx('select');
          if (app.finalMenu === 0) startMatch();
          else { startAttract(); setState('title'); }
        } else if (hit('back') || hit('quit')) { startAttract(); setState('title'); }
        break;
      }
    }
    typed = false;
    app.touch?.clear();
  }

  function playStep() {
    if (hit('pause') && !app.tray.open && !app.driving) { app.pauseMenu = 0; setState('pause'); return; }
    if (tapped('pause')) { app.pauseMenu = 0; setState('pause'); return; }
    const t = sim.tank, P = t && sim.players[t.p];
    if (sim.phase === 'aim' && P?.ai) sim.step(brain.step());
    else if (sim.phase === 'aim') sim.step(humanCmd(t));
    else { app.tray.open = false; app.driving = false; app.dragId = null; sim.step({}); }
    if (sim.phase === 'round' || sim.phase === 'match') {
      if ((hold += DT) > 1.8) {
        hold = 0; app.standings = standings(); setState('roundEnd');
        // between rounds: the checkpoint, and the next round's field from its seed, as on CONTINUE
        if (sim.phase === 'round') sim.reseed(checkpoint(sim.round).seed);
      }
    }
  }

  function setupStep() {
    const S = app.setup, rows = app.setupRows();
    app.setupRow = Math.min(app.setupRow, rows.length - 1);
    if (!typed) app.setupRow = menuMove(rows.length, app.setupRow);
    const tp = tapList.find(t => t.h?.act === 'setupRow');
    if (tp) { app.setupRow = tp.h.row; }
    const row = rows[app.setupRow];
    const dir = (hit('right') || tp?.h.dir === 1 ? 1 : 0) - (hit('left') || tp?.h.dir === -1 ? 1 : 0);
    const enter = hit('start') || (tp && tp.h.dir === 0);
    if (hit('back') || hit('quit') && !editingName() || tapped('back')) { setState('title'); audio.sfx('back'); return; }
    if (tapped('startMatch')) { startMatch(); return; }
    if (!dir && !enter) return;
    const cycle = (k, d) => { const c = CHOICES[k], i = c.indexOf(S[k]); S[k] = c[(i + d + c.length) % c.length]; };
    if (row === 'count') {
      const n = S.players.length + (dir || 1);
      if (n > 8 || n < 2) { audio.sfx('denied'); return; }
      if (n > S.players.length) {
        const used = new Set(S.players.map(p => p.color)), names = new Set(S.players.map(p => p.name));
        S.players.push({ name: CALLSIGNS.find(c => !names.has(c)) ?? 'Tank', color: [0, 1, 2, 3, 4, 5, 6, 7].find(c => !used.has(c)) ?? 0, ai: 2 });
      } else S.players.pop();
    } else if (row.startsWith('p')) {
      const p = S.players[+row.slice(1)];
      if (dir) {
        const was = p.ai;
        p.ai = (p.ai + dir + AI_LEVELS.length) % AI_LEVELS.length;
        // a fresh computer gets a callsign, a fresh person a plain name
        if (!p.edited && !was !== !p.ai) p.name = p.ai ? CALLSIGNS.find(c => !S.players.some(o => o.name === c)) ?? p.name : `Player ${+row.slice(1) + 1}`;
      } else {
        const used = new Set(S.players.filter(o => o !== p).map(o => o.color));
        let c = p.color;
        for (let k = 0; k < 8; k++) { c = (c + 1) % 8; if (!used.has(c)) break; }
        p.color = c;
      }
    } else if (row === 'start') { if (enter || dir > 0) { startMatch(); return; } }
    else cycle(row, dir || 1);
    audio.sfx('move');
  }

  function openShop(pre = false) {
    autoShop(rng(shopSeed ^ 0x2545f491));
    const queue = sim.players.filter(p => !p.ai).map(p => p.i);
    const go = () => {
      if (!pre) { nextRound(); return; }
      // the round is already laid out: what it pays is counted from after the shopping
      for (const p of sim.players) p.roundStart = p.cash;
      setState('intro'); audio?.sfx('round');
    };
    if (!queue.length) { go(); return; }
    app.shop = { queue, pi: queue.shift(), sel: 0, col: 0, flash: null, flashT: 0, pre, go };
    setState('shop');
  }
  function shopStep() {
    const S = app.shop, weapons = GOODS.filter(g => WEAPON[g.id]), gear = GOODS.filter(g => ITEM[g.id]);
    const cols = [weapons, gear];
    let list = cols[S.col];
    if (hit('left') || hit('right')) { S.col = 1 - S.col; list = cols[S.col]; S.sel = Math.min(S.sel, list.length - 1); audio.sfx('move'); }
    S.sel = Math.min(menuMove(list.length, S.sel), list.length - 1);
    const tp = tapOf('good');
    if (tp) {
      if (tp.col === S.col && tp.i === S.sel) S.buyTap = true;
      S.col = tp.col; S.sel = tp.i; list = cols[S.col];
    }
    const g = list[S.sel];
    S.flashT = Math.max(0, S.flashT - DT);
    const say = (msg, good) => { S.flash = { msg, good }; S.flashT = 1.2; };
    if (hit('start') || hit('fire') || tapped('buy') || S.buyTap) {
      S.buyTap = false;
      if (sim.buy(S.pi, g.id)) { audio.sfx('buy'); say(`Bought ${g.qty} × ${g.name}`, true); }
      else { audio.sfx('denied'); say(sim.players[S.pi].cash < g.price ? 'Not enough cash' : 'The rack is full', false); }
    } else if (hit('sell') || tapped('sell')) {
      if (sim.sell(S.pi, g.id)) { audio.sfx('sell'); say(`Sold one ${g.name}`, true); }
      else { audio.sfx('denied'); say('None to sell', false); }
    } else if (hit('back') || hit('pause') || tapped('done')) {
      audio.sfx('select');
      if (S.queue.length) { S.pi = S.queue.shift(); S.sel = 0; S.col = 0; S.flash = null; app.stT = 0; }
      else S.go();
    }
  }

  // ---------- sound ----------
  function sound() {
    if (!audio) return;
    const live = !app.attract && (app.state === 'play' || app.state === 'roundEnd' || app.state === 'pause');
    if (live) {
      for (const e of sim.events) {
        if (e.type === 'roundOver') audio.sfx(e.last ? 'match' : e.winner >= 0 ? 'win' : 'draw');
        else if (e.type === 'turn') { if (!sim.players[sim.tanks[e.tank].p].ai) audio.sfx('turn'); }
        else audio.sfx(e.type, e.type === 'boom' ? { ...e, big: e.r >= 70 } : e);
      }
    }
    const s = app.state;
    let track = null;
    if (s === 'title' || s === 'setup' || s === 'manual' || s === 'records' || s === 'final') track = 'title';
    else if (s === 'shop' || s === 'roundEnd') track = 'shop';
    else if (s === 'intro' || s === 'play' || s === 'pause') track = sim.round % 2 ? 'battle' : 'battle2';
    audio.music(track);
  }

  // ---------- loop ----------
  function tick() {
    const before = sim.events.length;
    update();
    for (let k = before; k < sim.events.length; k++) if (sim.events[k].type === 'turn') for (const t of sim.tanks) brain?.observe(t);
    // a person's turn gets a banner
    for (const e of sim.events) if (e.type === 'turn' && !app.attract) {
      const p = sim.players[sim.tanks[e.tank].p];
      app.banner = { text: p.name, col: COLORS[p.color], human: !p.ai, t: 0 };
    }
    if (app.banner) { app.banner.t += DT; if (app.banner.t > 1.6) app.banner = null; }
    view.events(sim.events, sim);
    sound();
    sim.events.length = 0;
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => { view.draw(app); hdr.present(); } });
  if (demo) {
    beginMatch(attractSetup());
    autoShop();
    if (reducedMotion) {
      // a still frame: a few shots in, a round in the air
      setState('play');
      for (let i = 0; i < 60 * 40 && !(sim.phase === 'flight' && sim.projectiles.length && sim.turns >= 2 && sim.projectiles[0].t > 0.6); i++) { aiStep(1); sim.events.length = 0; }
      app.fade = 0;
    }
  } else startAttract();
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
