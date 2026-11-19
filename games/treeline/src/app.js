// The game session: input → flight controls, the screen flow (title, mission select, high
// scores, briefing, the mission, pause, debrief, game over, victory), the campaign (mission,
// score, airframes), the autosave checkpoint behind CONTINUE, the attract-mode demo, sound and
// touch. It never draws: the renderer (hd/render.js) reads this `app` object every frame and
// answers touch hit tests.
//
// ---------- the `app` object the renderer reads ----------
//   state        'title' | 'missions' | 'scores' | 'brief' | 'play' | 'pause' | 'debrief' | 'over' | 'victory'
//                (the demo is always 'play', with app.demo set)
//   stT, t       seconds in this state, seconds since boot
//   fade         0..1: black over everything (the demo's cut between missions)
//   demo         true in the launcher's preview: no title, no HUD menus, no sound, no storage
//   onExit       set when the launcher can take the player back (the title shows EXIT)
//   sim, input   the simulation (sim.js) and @nostalgia/input (for prompts and glyphs)
//   view         'cockpit' | 'chase' | 'sight' (the sight: a zoomed camera from the nose on
//                sim.player.target; only while there is a target)
//   menu         the selected entry of the current menu
//   titleItems() → ['continue'?, 'new', 'missions', 'scores', 'exit'?]   (continue only with a save)
//   pauseItems() → ['resume', 'assist', 'end'? (goal done, still flying), 'restart', 'quit']
//   resume       the autosave ({ state, label, at }) or null; resumeAgo() → '5 min ago'
//   missions     MISSIONS (missions.js); unlocked: the highest mission index that may be picked
//                ('missions' state: menu = the mission index under the cursor)
//   theatres     THEATRES (theatres.js); backdrop: the theatre index the title/brief shows
//   camp         { mission, score, airframes, seed }: the campaign in progress; AIRFRAMES max
//   rank()       the campaign's rank name now (missions.js rankOf)
//   plan         in 'brief': { mission, theatre, home: site, marks: [{ x, z, kind, label, obj, team,
//                lane? }], lz: site | null, road: [[x, z]…] | null } — what the briefing map shows
//   result       in 'debrief' (and after): { kind 'complete' | 'landed' | 'down' | 'failed', won,
//                mission, earned (the mission's points), bonus (landing + time), score (what counts:
//                0 when lost), kills { kind: n }, shots, hits, time, reason, objectives { done, total },
//                before (campaign score before), total (after), rank, airframes, next 'brief' |
//                'over' | 'victory' }
//   scores       the table [{ score, rank, mission, at }] (best first); newRank: the row just
//                entered (−1 none)
//   soundOn      sound on (M toggles)
//   touch        touch.js state (null until a touch is seen in a non-demo page): the renderer
//                draws touch.stick / touch.coll / touch.held with pads(w, h) from touch.js
//
// The renderer's hit(x, y, app) answers taps outside the flight: { act: 'menu', i } (an entry of
// the current menu), { act: 'back' }, { act: 'locked' } (a locked mission), or { act: 'tap' }.
import { fixedLoop, listeners, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave, savedAgo } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createRenderer } from './hd/render.js';
import { MISSIONS, rankOf } from './missions.js';
import { createPilot } from './pilot.js';
import { DT, createSim, dist, planOf } from './sim.js';
import { THEATRES } from './theatres.js';
import { createTouch } from './touch.js';

const SCORES_KEY = 'treeline-scores', PROGRESS_KEY = 'treeline-progress';
const TABLE = 8;
export const AIRFRAMES = 3;
const fmt = n => Math.max(0, Math.round(n)).toLocaleString('en-US');
export const saveLabel = st => `Mission ${st.mission + 1} · ${fmt(st.score)}`;
const VIEWS = ['cockpit', 'chase', 'sight'];
const AUTO_END = 150; // seconds after the goal is done, the mission ends by itself

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null } = {}) {
  const { listen, offAll } = listeners();
  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'Enter', 'Tab'],
    ...(demo && { target: new EventTarget(), getGamepads: () => [], register: false }),
  });
  const sim = createSim({ seed: (Math.random() * 1e9) | 0 });
  const audio = demo ? null : createAudio({ on: sound });

  // ---------- saved data (never touched by the demo) ----------
  const saved = storage(SCORES_KEY, { enabled: !demo });
  const prog = storage(PROGRESS_KEY, { enabled: !demo });
  let scores = [];
  const got = saved.load(null);
  if (Array.isArray(got)) scores = got.filter(s => s && Number.isFinite(s.score) && Number.isInteger(s.mission)).slice(0, TABLE);
  const p0 = prog.load(null);
  let unlocked = Number.isInteger(p0?.unlocked) ? Math.max(0, Math.min(MISSIONS.length - 1, p0.unlocked)) : 0;
  let assist = p0?.assist !== false;
  const autosave = createAutosave('treeline', { enabled: !demo, version: 1 });
  const validSave = r => {
    const st = r?.state;
    return st && Number.isInteger(st.mission) && st.mission >= 0 && st.mission < MISSIONS.length && Number.isFinite(st.score) && st.score >= 0
      && Number.isInteger(st.airframes) && st.airframes > 0 && st.airframes <= AIRFRAMES && Number.isInteger(st.seed) ? r : null;
  };
  let resume = validSave(autosave.load());

  const camp = { mission: 0, score: 0, airframes: AIRFRAMES, seed: 1 };
  function checkpoint() {
    const st = { mission: camp.mission, score: camp.score, airframes: camp.airframes, seed: camp.seed };
    autosave.save(st, saveLabel(st));
  }

  const app = {
    state: demo ? 'play' : 'title', stT: 0, t: 0, fade: demo ? 1 : 0,
    sim, input, demo, onExit, camp, menu: 0, view: demo ? 'chase' : 'cockpit',
    scores, newRank: -1, result: null, plan: null, backdrop: resume ? MISSIONS[resume.state.mission].theatre : 0,
    touch: null, missions: MISSIONS, theatres: THEATRES,
    get unlocked() { return unlocked; },
    get soundOn() { return audio ? audio.on : false; },
    get assist() { return assist; },
    get resume() { return resume; },
    resumeAgo: () => (resume ? savedAgo(resume.at) : ''),
    titleItems: () => [...(resume ? ['continue'] : []), 'new', 'missions', 'scores', ...(onExit ? ['exit'] : [])],
    pauseItems: () => ['resume', 'assist', ...(sim.complete && sim.status === 'fly' ? ['end'] : []), 'restart', 'quit'],
    rank: () => rankOf(camp.score),
  };
  const view = createRenderer(cv, app);
  function setState(s) { app.state = s; app.stT = 0; app.menu = 0; }

  // ---------- page plumbing (not in the demo) ----------
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => toggleFullscreen());
    listen(cv, 'dblclick', () => toggleFullscreen());
    listen(window, 'blur', () => { if (app.state === 'play') setState('pause'); });
    app.touch = createTouch(cv, { listen, view });
  }

  // ---------- input → actions ----------
  const taps = () => app.touch?.taps ?? [];
  const tapped = act => taps().some(h => h.act === act);
  const hit = a => input.pressed(a) || tapped(a);
  function controls() {
    const c = {
      pitch: input.axis('pitchDown', 'pitchUp'), roll: input.axis('rollLeft', 'rollRight'), yaw: input.axis('yawLeft', 'yawRight'),
      coll: input.axis('collDown', 'collUp'), gun: input.held('gun'),
      fire: input.pressed('fire'), weapon: input.pressed('weapon'), target: input.pressed('target'), decoy: input.pressed('decoy'),
      hover: input.pressed('hover'), assist: input.pressed('assist'),
    };
    app.touch?.apply(c);
    return c;
  }
  /** up/down through a menu of n entries; a tap on an entry picks it; returns the index chosen or -1 */
  function menu(n, wrap = true) {
    if (hit('up')) { app.menu = wrap ? (app.menu + n - 1) % n : Math.max(0, app.menu - 1); audio?.sfx('move'); }
    if (hit('down')) { app.menu = wrap ? (app.menu + 1) % n : Math.min(n - 1, app.menu + 1); audio?.sfx('move'); }
    const m = taps().find(h => h.act === 'menu');
    if (m) app.menu = Math.min(n - 1, m.i);
    if (hit('start') || m) { audio?.sfx('select'); return app.menu; }
    return -1;
  }

  // ---------- the campaign ----------
  function newCampaign(from) {
    camp.mission = from; camp.score = 0; camp.airframes = AIRFRAMES; camp.seed = (Math.random() * 1e9) | 0;
    resume = null;
    brief();
  }
  function brief() {
    app.backdrop = MISSIONS[camp.mission].theatre;
    app.plan = planOf(camp.mission);
    checkpoint();
    setState('brief');
  }
  function fly() {
    sim.reseed((camp.seed + camp.mission * 7919) | 0);
    sim.load(camp.mission, { carry: { score: camp.score, airframes: camp.airframes }, assist });
    app.view = 'cockpit';
    setState('play');
  }
  function endMission(kind) {
    const won = kind === 'landed' || kind === 'complete';
    app.result = {
      kind, won, mission: camp.mission, earned: sim.score - sim.bonus, bonus: sim.bonus, score: won ? sim.score : 0, kills: { ...sim.kills },
      shots: sim.shots, hits: sim.hits, time: sim.t, landed: kind === 'landed', reason: sim.reason, objectives: sim.objectives(),
      before: camp.score, next: null,
    };
    if (won) {
      camp.score += sim.score;
      camp.mission++;
      if (camp.mission > unlocked) { unlocked = Math.min(MISSIONS.length - 1, camp.mission); saveProgress(); }
      app.result.next = camp.mission >= MISSIONS.length ? 'victory' : 'brief';
    } else if (kind === 'down') {
      camp.airframes--;
      app.result.next = camp.airframes <= 0 ? 'over' : 'brief';
    } else app.result.next = 'brief';
    if (app.result.next === 'victory' || app.result.next === 'over') { autosave.clear(); resume = null; record(); }
    app.result.rank = rankOf(camp.score);
    app.result.total = camp.score;
    app.result.airframes = camp.airframes;
    setState('debrief');
  }
  const saveProgress = () => prog.save({ unlocked, assist });
  const qualifies = score => score > 0 && (scores.length < TABLE || score > scores[scores.length - 1].score);
  function record() {
    app.newRank = -1;
    if (!qualifies(camp.score)) return;
    const entry = { score: camp.score, rank: rankOf(camp.score), mission: Math.min(camp.mission, MISSIONS.length), at: Date.now() };
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    scores.length = Math.min(scores.length, TABLE);
    app.scores = scores;
    app.newRank = scores.indexOf(entry);
    saved.save(scores);
  }

  // ---------- demo: the autopilot flies a mission, then another ----------
  let pilot = null, demoT = 0, ending = 0, viewT = 0;
  function startDemo() {
    const mi = Math.floor(Math.random() * MISSIONS.length);
    sim.reseed((Math.random() * 1e9) | 0);
    sim.load(mi, { airborne: true });
    pilot = createPilot(sim, { sloppy: 0.25 + Math.random() * 0.3, seed: (Math.random() * 1e6) | 0 });
    demoT = 0; ending = 0; viewT = 0;
    app.view = Math.random() < 0.6 ? 'chase' : 'cockpit';
  }
  function demoStep() {
    demoT += DT; viewT += DT;
    const done = (sim.complete && sim.completeT > 8) || (sim.status !== 'fly' && sim.statusT > 4) || demoT > 200;
    if (done && !ending) ending = 1;
    if (ending) {
      app.fade = Math.min(1, app.fade + DT * 1.6);
      if (app.fade >= 1) { startDemo(); return; }
    } else app.fade = Math.max(0, app.fade - DT * 2);
    if (viewT > 14) {
      viewT = 0;
      app.view = app.view === 'chase' ? 'cockpit' : sim.player.target && sim.player.tgtSeen && Math.random() < 0.4 ? 'sight' : 'chase';
    }
    if (app.view === 'sight' && !sim.player.target) app.view = 'chase';
    sim.step(pilot());
  }

  // ---------- one fixed step ----------
  function update() {
    app.t += DT; app.stT += DT;
    if (demo) { demoStep(); return; }
    input.update();
    app.touch?.update(app);
    if (hit('sound')) audio.setOn(!audio.on);
    const tap = taps().some(h => h.act === 'tap');
    switch (app.state) {
      case 'title': {
        const items = app.titleItems();
        app.menu = Math.min(app.menu, items.length - 1);
        const i = menu(items.length);
        if (i >= 0) {
          const it = items[i];
          if (it === 'continue') {
            const st = resume.state;
            Object.assign(camp, { mission: st.mission, score: st.score, airframes: st.airframes, seed: st.seed });
            resume = null;
            brief();
          } else if (it === 'new') newCampaign(0);
          else if (it === 'missions') { setState('missions'); app.menu = Math.min(unlocked, resume?.state.mission ?? unlocked); }
          else if (it === 'scores') { app.newRank = -1; setState('scores'); }
          else if (it === 'exit') onExit?.();
        } else if (onExit && hit('quit')) onExit();
        else if (app.stT > 30) { app.backdrop = (app.backdrop + 1) % THEATRES.length; app.stT = 0; }
        break;
      }
      case 'missions': {
        const i = menu(unlocked + 1, false);
        if (tapped('locked')) audio.sfx('back');
        app.backdrop = MISSIONS[app.menu].theatre;
        if (i >= 0) newCampaign(i);
        else if (hit('back') || tapped('back')) { audio.sfx('back'); setState('title'); }
        break;
      }
      case 'scores':
        if ((app.stT > 0.4 && (hit('start') || hit('back') || tap)) || app.stT > 15) { audio.sfx('back'); setState('title'); }
        break;
      case 'brief':
        if (app.stT > 0.5 && (hit('start') || tap)) { audio.sfx('select'); fly(); }
        else if (hit('back') || tapped('back')) { audio.sfx('back'); resume = validSave(autosave.load()); setState('title'); }
        break;
      case 'play': {
        if (hit('pause')) { audio.sfx('back'); setState('pause'); break; }
        if (hit('view')) {
          let k = VIEWS.indexOf(app.view);
          do k = (k + 1) % VIEWS.length; while (VIEWS[k] === 'sight' && !sim.player.target);
          app.view = VIEWS[k];
        }
        if (app.view === 'sight' && !sim.player.target) app.view = 'chase';
        const c = controls();
        sim.step(c);
        if (c.assist) { assist = sim.player.assist; saveProgress(); }
        if (sim.status === 'landed' && sim.statusT > 3) endMission('landed');
        else if (sim.complete && sim.status === 'fly' && sim.completeT > AUTO_END) endMission('complete');
        else if (sim.status === 'down' && sim.statusT > 4.5) endMission('down');
        else if (sim.status === 'failed' && sim.statusT > 4) endMission('failed');
        break;
      }
      case 'pause': {
        const items = app.pauseItems();
        app.menu = Math.min(app.menu, items.length - 1);
        if (hit('pause') || hit('back')) { audio.sfx('back'); setState('play'); break; }
        const i = menu(items.length);
        if (i < 0) break;
        const it = items[i];
        if (it === 'resume') setState('play');
        else if (it === 'assist') { assist = !assist; sim.player.assist = assist; sim.setAssist?.(assist); saveProgress(); }
        else if (it === 'end') endMission(sim.complete ? 'complete' : 'failed');
        else if (it === 'restart') fly();
        else if (it === 'quit') { resume = validSave(autosave.load()); setState('title'); }
        break;
      }
      case 'debrief':
        if (app.stT > 1 && (hit('start') || tap)) {
          audio.sfx('select');
          const next = app.result.next;
          if (next === 'brief') brief();
          else setState(next);
        }
        break;
      case 'over':
      case 'victory':
        if (app.stT > 2 && (hit('start') || tap)) { audio.sfx('select'); setState('scores'); }
        break;
    }
    app.touch?.clear();
  }

  // ---------- sound ----------
  let lastMusic, rotorOn = false;
  const SFX = new Set(['cannon', 'rocket', 'flare', 'damage', 'weapon', 'target', 'lowfuel', 'objective', 'fail', 'start', 'land', 'liftoff', 'pickup', 'crash']);
  function sound() {
    if (!audio) return;
    const s = app.state, P = sim.player, live = s === 'play' && sim.status !== 'down' && P?.alive;
    if (s === 'play') {
      for (const e of sim.events) {
        if (SFX.has(e.type)) { audio.sfx(e.type, e); continue; }
        switch (e.type) {
          case 'missile': audio.sfx(e.kind === 'aam' ? 'aam' : 'missile', e); break;
          case 'hit': audio.sfx('hit', { ...e, kind: e.armor ? 'armor' : KINDS_AIR.has(e.kind) ? 'air' : 'ground' }); break;
          case 'treestrike': audio.sfx('treestrike', e); break;
          case 'settle': audio.sfx('settle', e); break;
          case 'efire': case 'launch': {
            // heard only within earshot: gunfire to 3 km, a missile's launch to 7 km
            const far = e.type === 'efire' ? 3000 : 7000, d = P ? dist([e.x, e.y, e.z], P.pos) / far : 1;
            if (d < 1) audio.sfx(e.type, { kind: e.kind, dist: d });
            break;
          }
          case 'boom': case 'flak': case 'splash': {
            const d = P ? Math.min(1, dist([e.x, e.y, e.z], P.pos) / 4000) : 0.5;
            if (e.type === 'splash') audio.sfx('splash', { ...e, dist: d });
            else audio.sfx('boom', { big: e.type === 'boom' && !!e.big, dist: e.kind === 'player' ? 0 : d });
            break;
          }
        }
      }
    }
    let track = null;
    if (s === 'title' || s === 'missions' || s === 'scores') track = 'title';
    else if (s === 'brief') track = 'briefing';
    else if (s === 'debrief') track = app.result?.won ? 'debrief' : 'over';
    else if (s === 'victory') track = 'victory';
    else if (s === 'over') track = 'over';
    else if (s === 'play' || s === 'pause') track = sim.status === 'fly' || sim.status === 'landed' ? 'flight' + sim.theatre : null;
    if (track !== lastMusic) { audio.music(track); lastMusic = track; }
    const rotor = !!live && s === 'play';
    if (rotor !== rotorOn) { audio.rotor(rotor); rotorOn = rotor; }
    if (rotor) audio.flight(P.collective, P.rpm, Math.min(1, P.speed / 80), P.load);
    audio.warn(rotor && sim.status === 'fly' ? sim.warn : null);
    audio.lock(rotor && sim.status === 'fly' ? sim.lockState : 'off');
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
    // a still demo shows a mission well under way
    const n = reducedMotion ? 60 * 45 : 1;
    for (let i = 0; i < n; i++) { demoStep(); view.events(sim.events, sim); sim.events.length = 0; }
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
  return { stop, app };
}
const KINDS_AIR = new Set(['mantis', 'stiletto']);
