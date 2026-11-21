// The game session: input → flight controls, the screen flow (title, mission select, high
// scores, briefing, the sortie, pause, debrief, game over, victory), the campaign (mission,
// score, airframes), the autosave checkpoint behind CONTINUE, the attract-mode demo, sound and
// touch. It never draws: the renderer (hd/render.js) reads this `app` object every frame and
// answers touch hit tests.
import { createHdr } from '@nostalgia/game/hdr';
import { fixedLoop, listeners, onAway, storage, toggleFullscreen } from '@nostalgia/game/runtime';
import { createInput } from '@nostalgia/input';
import { createAutosave, savedAgo } from '@nostalgia/save';
import meta from '../game.json';
import { createAudio } from './audio.js';
import { createRenderer } from './hd/render.js';
import { MISSIONS, rankOf } from './missions.js';
import { createPilot } from './pilot.js';
import { DT, createSim, dist } from './sim.js';
import { createTouch } from './touch.js';

const SCORES_KEY = 'contrail-scores', PROGRESS_KEY = 'contrail-progress';
const TABLE = 8, AIRFRAMES = 3;
const fmt = n => Math.max(0, Math.round(n)).toLocaleString('en-US');
export const saveLabel = st => `Mission ${st.mission + 1} · ${fmt(st.score)}`;
const VIEWS = ['cockpit', 'chase', 'target'];
const AUTO_END = 150; // seconds after the objectives fall, the sortie ends by itself

export function boot(cv, { demo = false, reducedMotion = false, sound = true, onExit = null } = {}) {
  const { listen, offAll } = listeners();
  const input = createInput({
    ...meta.input,
    preventDefault: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'Enter'],
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
  const autosave = createAutosave('contrail', { enabled: !demo, version: 1 });
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
    sim, input, demo, onExit, camp, menu: 0, pick: 0, view: demo ? 'chase' : 'cockpit',
    scores, newRank: -1, result: null, backdrop: resume ? MISSIONS[resume.state.mission].theatre : 0,
    touch: null, missions: MISSIONS,
    get unlocked() { return unlocked; },
    get soundOn() { return audio ? audio.on : false; },
    get resume() { return resume; },
    resumeAgo: () => (resume ? savedAgo(resume.at) : ''),
    titleItems: () => [...(resume ? ['continue'] : []), 'new', 'missions', 'scores', ...(onExit ? ['exit'] : [])],
    pauseItems: () => ['resume', ...(sim.complete && sim.status === 'fly' ? ['end'] : []), 'restart', 'quit'],
    rank: () => rankOf(camp.score),
  };
  const view = createRenderer(cv, app);
  const hdr = createHdr([document.getElementById('gl'), cv], { enabled: !demo });
  app.hdr = hdr;
  function setState(s) { app.state = s; app.stT = 0; app.menu = 0; }

  // ---------- page plumbing (not in the demo) ----------
  if (!demo) {
    const unlock = () => audio.unlock();
    listen(window, 'keydown', unlock);
    listen(window, 'pointerdown', unlock);
    listen(window, 'touchstart', unlock);
    input.on('fullscreen', () => toggleFullscreen());
    input.on('hdr', () => hdr.cycle());
    listen(cv, 'dblclick', () => toggleFullscreen());
    onAway(listen, () => { if (app.state === 'play') setState('pause'); });
    app.touch = createTouch(cv, { listen, view });
  }

  // ---------- input → actions ----------
  const taps = () => app.touch?.taps ?? [];
  const tapped = act => taps().some(h => h.act === act);
  const hit = a => input.pressed(a) || tapped(a);
  function controls() {
    const c = {
      pitch: input.axis('pitchDown', 'pitchUp'), roll: input.axis('rollLeft', 'rollRight'), yaw: input.axis('yawLeft', 'yawRight'),
      thr: input.axis('thrDown', 'thrUp'), gun: input.held('gun'),
      fire: input.pressed('fire'), weapon: input.pressed('weapon'), target: input.pressed('target'), decoy: input.pressed('decoy'),
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
    checkpoint();
    setState('brief');
  }
  function fly() {
    sim.reseed((camp.seed + camp.mission * 7919) | 0);
    sim.load(camp.mission, { carry: { score: camp.score, airframes: camp.airframes } });
    app.view = 'cockpit';
    setState('play');
  }
  function endSortie(kind) {
    const won = kind === 'landed' || kind === 'complete';
    const o = sim.objectives();
    app.result = {
      kind, won, mission: camp.mission, score: won ? sim.score : 0, earned: sim.score, kills: { ...sim.kills }, shots: sim.shots, hits: sim.hits,
      time: sim.t, landed: kind === 'landed', reason: sim.reason, objectives: o, before: camp.score, next: null,
    };
    if (won) {
      camp.score += sim.score;
      camp.mission++;
      if (camp.mission > unlocked) { unlocked = Math.min(MISSIONS.length - 1, camp.mission); prog.save({ unlocked }); }
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

  // ---------- demo: the autopilot flies a sortie, then another ----------
  let pilot = null, demoT = 0, ending = 0, viewT = 0;
  function startDemo() {
    const mi = Math.floor(Math.random() * MISSIONS.length);
    sim.reseed((Math.random() * 1e9) | 0);
    sim.load(mi);
    pilot = createPilot(sim, { sloppy: 0.25 + Math.random() * 0.25, seed: (Math.random() * 1e6) | 0 });
    demoT = 0; ending = 0; viewT = 0;
    app.view = Math.random() < 0.5 ? 'chase' : 'cockpit';
  }
  function demoStep() {
    demoT += DT; viewT += DT;
    const done = (sim.complete && sim.completeT > 6) || (sim.status !== 'fly' && sim.statusT > 4) || demoT > 180;
    if (done && !ending) ending = 1;
    if (ending) {
      app.fade = Math.min(1, app.fade + DT * 1.6);
      if (app.fade >= 1) { startDemo(); return; }
    } else app.fade = Math.max(0, app.fade - DT * 2);
    if (viewT > 14) { viewT = 0; app.view = app.view === 'chase' ? 'cockpit' : sim.player.target && Math.random() < 0.4 ? 'target' : 'chase'; }
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
        else if (app.stT > 30) { app.backdrop = (app.backdrop + 1) % 3; app.stT = 0; }
        break;
      }
      case 'missions': {
        const i = menu(unlocked + 1, false);
        const m = taps().find(h => h.act === 'locked');
        if (m) audio.sfx('back');
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
          do k = (k + 1) % VIEWS.length; while (VIEWS[k] === 'target' && !sim.player.target);
          app.view = VIEWS[k];
        }
        if (app.view === 'target' && !sim.player.target) app.view = 'chase';
        sim.step(controls());
        if (sim.status === 'landed' && sim.statusT > 3) endSortie('landed');
        else if (sim.complete && sim.status === 'fly' && sim.completeT > AUTO_END) endSortie('complete');
        else if (sim.status === 'down' && sim.statusT > 4.5) endSortie('down');
        else if (sim.status === 'failed' && sim.statusT > 4) endSortie('failed');
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
        else if (it === 'end') endSortie(sim.complete ? 'complete' : 'failed');
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
  let lastMusic;
  function sound() {
    if (!audio) return;
    const s = app.state, P = sim.player, flying = s === 'play' && sim.status === 'fly' && P?.alive;
    if (s === 'play') {
      for (const e of sim.events) {
        switch (e.type) {
          case 'cannon': case 'missile': case 'rocket': case 'bomb': case 'flare': case 'chaff': case 'hit': case 'damage': case 'launch':
          case 'weapon': case 'target': case 'stall': case 'lowfuel': case 'objective': case 'fail': case 'start': case 'land':
            audio.sfx(e.type, e); break;
          case 'boom': case 'flak': case 'splash': {
            const d = P ? Math.min(1, dist([e.x, e.y, e.z], P.pos) / 7000) : 0.5;
            if (e.type === 'splash') audio.sfx('splash', { ...e, dist: d });
            else audio.sfx('boom', { big: e.type === 'boom' && !!e.big, dist: e.kind === 'player' ? 0 : d });
            break;
          }
          case 'crash': audio.sfx('crash', e); break;
        }
      }
    }
    let track = null;
    if (s === 'title' || s === 'missions' || s === 'scores') track = 'title';
    else if (s === 'brief') track = 'briefing';
    else if (s === 'debrief') track = app.result?.won ? 'debrief' : 'over';
    else if (s === 'victory') track = 'victory';
    else if (s === 'over') track = 'over';
    else if (s === 'play' || s === 'pause') track = sim.status === 'fly' ? 'flight' + sim.theatre : null;
    if (track !== lastMusic) { audio.music(track); lastMusic = track; }
    audio.engine(!!flying);
    if (flying) audio.throttle(Math.min(1, P.throttle), !!P.burner, Math.min(1, P.speed / 400));
    audio.warn(!!(flying && sim.threat));
    audio.lock(flying ? sim.lockState : 'off');
  }

  // ---------- loop ----------
  function tick() {
    update();
    view.events(sim.events, sim);
    sound();
    sim.events.length = 0;
  }
  const loop = fixedLoop({ dt: DT, step: tick, draw: () => { if (view.draw(app) !== false) hdr.present(); } }); // a skipped frame leaves the WebGL buffer stale: keep the last HDR one
  if (demo) {
    startDemo();
    // a still demo shows a sortie well under way
    const n = reducedMotion ? 60 * 40 : 1;
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
    hdr.destroy();
    audio?.destroy();
  }
  return { stop, app };
}
