// The screens over the 3D backdrop: title, mission select, high scores, the briefing with its
// map, pause, the debrief, game over and victory. Each lays its menu out through one function,
// so the touch hit test (screenHit) finds the same rectangles the screen draws.
import { MISSIONS, TYPES } from '../missions.js';
import { KINDS, STORE_NAME } from '../sim.js';
import { THEATRES } from '../theatres.js';
import { HALF, createWorld } from '../world.js';
import { mapCanvas } from './hud.js';
import { COL, H, W, fmt } from './ui.js';

const LABEL = { continue: 'CONTINUE', new: 'NEW CAMPAIGN', missions: 'MISSION SELECT', scores: 'HIGH SCORES', exit: 'EXIT' };
const PAUSE = { resume: 'RESUME', end: 'END MISSION', restart: 'RESTART MISSION', quit: 'QUIT TO TITLE' };
const SEL = 'rgba(255,184,74,0.18)', IDLE = 'rgba(8,14,9,0.62)';

// ---------- layouts (shared with the hit test) ----------
function titleRects(app) {
  return app.titleItems().map((it, i) => ({ it, x: 140, y: 470 + i * 84 + (i > 0 && app.resume ? 26 : 0), w: 560, h: 68 }));
}
function missionRects() {
  return MISSIONS.map((m, i) => ({ x: 110, y: 180 + i * 58 + m.theatre * 30, w: 640, h: 52 }));
}
function pauseRects(app) {
  return app.pauseItems().map((it, i) => ({ it, x: W / 2 - 280, y: 360 + i * 78, w: 560, h: 64 }));
}
const BACK = { x: 40, y: 980, w: 200, h: 64 };

export function screenHit(app, x, y) {
  const inside = R => x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
  if (app.state === 'title') { const i = titleRects(app).findIndex(inside); return i >= 0 ? { act: 'menu', i } : { act: 'none' }; }
  if (app.state === 'pause') { const i = pauseRects(app).findIndex(inside); return i >= 0 ? { act: 'menu', i } : { act: 'none' }; }
  if (app.state === 'missions') {
    if (inside(BACK)) return { act: 'back' };
    const i = missionRects().findIndex(inside);
    if (i < 0) return { act: 'none' };
    return i <= app.unlocked ? { act: 'menu', i } : { act: 'locked' };
  }
  if (app.state === 'brief' && inside(BACK)) return { act: 'back' };
  return { act: 'tap' };
}

export function drawScreen(ui, app) {
  const s = app.state;
  if (s === 'play' || app.demo) return;
  const g = ui.g;
  // a dark wash over the backdrop, heavier behind text
  const wash = { title: 0.22, pause: 0.45 }[s] ?? 0.58;
  g.fillStyle = `rgba(5,8,5,${wash})`; g.fillRect(0, 0, W, H);
  switch (s) {
    case 'title': title(ui, app); break;
    case 'missions': missions(ui, app); break;
    case 'scores': scores(ui, app); break;
    case 'brief': brief(ui, app); break;
    case 'pause': pause(ui, app); break;
    case 'debrief': debrief(ui, app); break;
    case 'over': ending(ui, app, false); break;
    case 'victory': ending(ui, app, true); break;
  }
}

/** the name over a line of treetops */
function logo(ui, x, y, size = 150) {
  const g = ui.g, sp = size * 0.14;
  ui.text('TREELINE', x, y, size, '#f1f3ea', { wgt: 700, sp });
  const w = ui.width('TREELINE', size, 700, sp) - sp;
  // the treeline: cones and round crowns, a rotor's sweep over it
  const base = y + size * 0.3, k = size / 150;
  g.fillStyle = '#5f8f46';
  g.beginPath(); g.moveTo(x, base);
  let px = x;
  for (let i = 0; px < x + w; i++) {
    const tw = (18 + ((i * 37) % 13)) * k, th = (20 + ((i * 53) % 17)) * k;
    if (i % 3 === 1) { g.lineTo(px, base - th * 0.5); g.quadraticCurveTo(px + tw / 2, base - th * 1.25, px + tw, base - th * 0.5); }
    else { g.lineTo(px + tw / 2, base - th); }
    px += tw; g.lineTo(px, base - 4 * k);
  }
  g.lineTo(x + w, base); g.closePath(); g.fill();
  g.fillStyle = COL.amber; g.fillRect(x, base + 6 * k, w * 0.28, 3 * k);
}

function title(ui, app) {
  logo(ui, 140, 250);
  ui.text('MARCHLAND GUARD  ·  THE GREY COMBINE WAR', 144, 362, 24, COL.dim, { wgt: 600, sp: 4 });
  titleRects(app).forEach((R, i) => {
    const sel = app.menu === i;
    ui.panel(R.x, R.y, R.w, R.h, { fill: sel ? SEL : IDLE, edge: sel ? COL.amber : 'rgba(238,240,230,0.18)', r: 4 });
    ui.text(LABEL[R.it], R.x + 30, R.y + 45, 30, sel ? COL.amber : COL.ink, { wgt: 700, sp: 5 });
    if (R.it === 'continue' && app.resume) {
      const ago = app.resumeAgo();
      ui.text(`${app.resume.label}${ago ? '  ·  ' + ago : ''}`, R.x + 30, R.y + R.h + 22, 19, COL.dim, { wgt: 500, sp: 1 });
    }
  });
  // the HDR entry adds to the right: the row keeps its left edge
  ui.legend(app.input, [['menu', 'Choose'], ['start', 'Select'], ...(app.onExit ? [['quit', 'Exit']] : []), ['sound', app.soundOn ? 'Sound on' : 'Sound off'], ['fullscreen', 'Full screen'], ...(app.hdr?.supported ? [['hdr', `HDR ${app.hdr.label.slice(4).toLowerCase()}`]] : [])], app.hdr?.supported ? 558 : 480, 1010, 20);
  ui.text('AFTER LHX ATTACK CHOPPER (1990)', W - 60, 1030, 16, COL.faint, { align: 'right', wgt: 500, sp: 3 });
}

function missions(ui, app) {
  ui.text('MISSION SELECT', 110, 104, 46, COL.ink, { wgt: 700, sp: 8 });
  ui.text('A new campaign from any mission you have reached', 112, 142, 20, COL.dim, { wgt: 500 });
  const rects = missionRects();
  let th = -1;
  MISSIONS.forEach((m, i) => {
    const R = rects[i], locked = i > app.unlocked, sel = app.menu === i;
    if (m.theatre !== th) { th = m.theatre; ui.text(THEATRES[th].name.toUpperCase(), R.x, R.y - 9, 16, COL.cyan, { wgt: 700, sp: 3 }); }
    ui.panel(R.x, R.y, R.w, R.h - 6, { fill: sel ? SEL : IDLE, edge: sel ? COL.amber : 'rgba(238,240,230,0.12)', r: 4 });
    const c = locked ? COL.faint : sel ? COL.amber : COL.ink;
    ui.text(String(i + 1).padStart(2, '0'), R.x + 22, R.y + 32, 21, c, { wgt: 700 });
    ui.text(m.name.toUpperCase(), R.x + 78, R.y + 32, 21, c, { wgt: 700, sp: 3 });
    ui.text(locked ? 'LOCKED' : m.type ?? TYPES[m.goal], R.x + R.w - 22, R.y + 32, 15, locked ? COL.faint : COL.dim, { align: 'right', wgt: 600, sp: 2 });
  });
  const mi = Math.min(app.menu, MISSIONS.length - 1);
  briefCard(ui, app, MISSIONS[mi], mi, null, 800, 160, 1060, 780, false);
  backButton(ui, app, 'Title');
  ui.legend(app.input, [['menu', 'Choose'], ['start', 'Fly from here'], ['back', 'Back']], 1330, 1012, 20);
}

function scores(ui, app) {
  ui.text('HIGH SCORES', W / 2, 150, 52, COL.ink, { align: 'center', wgt: 700, sp: 10 });
  ui.panel(W / 2 - 520, 200, 1040, 640, {});
  const list = app.scores;
  if (!list.length) ui.text('No campaigns flown yet', W / 2, 520, 28, COL.dim, { align: 'center', wgt: 500 });
  list.forEach((e, i) => {
    const y = 270 + i * 72, hi = i === app.newRank, c = hi ? COL.amber : COL.ink;
    if (hi) ui.panel(W / 2 - 500, y - 46, 1000, 64, { fill: 'rgba(255,184,74,0.14)', edge: COL.amber, r: 4 });
    ui.text(`${i + 1}`, W / 2 - 460, y, 28, c, { wgt: 700 });
    ui.text(fmt(e.score), W / 2 - 150, y, 30, c, { align: 'right', wgt: 700, sp: 1 });
    ui.text(String(e.rank ?? '').toUpperCase(), W / 2 - 100, y, 22, c, { wgt: 600, sp: 2 });
    ui.text(e.mission >= MISSIONS.length ? 'CAMPAIGN WON' : `MISSION ${e.mission + 1}`, W / 2 + 480, y, 20, hi ? COL.amber : COL.dim, { align: 'right', wgt: 600, sp: 2 });
  });
  if (app.newRank >= 0) ui.text(`A NEW ENTRY  ·  #${app.newRank + 1}`, W / 2, 880, 24, COL.cyan, { align: 'center', wgt: 700, sp: 4 });
  ui.prompt(app.input, 'PRESS {start} TO GO BACK', W / 2, 940, 24, COL.dim, 'center');
}

function brief(ui, app) {
  // plan.mission is the mission itself (sim.planOf); the campaign holds its index
  const pm = app.plan?.mission, mi = typeof pm === 'number' ? pm : pm ? MISSIONS.indexOf(pm) : app.camp.mission, m = MISSIONS[mi];
  ui.text(`MISSION ${mi + 1} OF ${MISSIONS.length}`, 110, 100, 22, COL.amber, { wgt: 700, sp: 6 });
  briefCard(ui, app, m, mi, app.plan, 100, 126, 1720, 830, true);
  backButton(ui, app, 'Title');
  ui.prompt(app.input, 'PRESS {start} TO LIFT OFF', W - 110, 1024, 28, COL.amber, 'right', 700);
}

/** the marks a mission puts on its map: from app.plan when there is one, else from its units */
function marksOf(m, world) {
  const out = [];
  for (const u of m.units) {
    if (u.road) {
      const R = world.road(u.road);
      if (!R) continue;
      out.push({ kind: u.kind, obj: u.obj, team: KINDS[u.kind]?.team ?? 'red', lane: R.pts, x: R.pts[0][0], z: R.pts[0][1] });
      continue;
    }
    const at = typeof u.at === 'string' ? world.site(u.at) : u.at ? { x: u.at[0], z: u.at[1] } : null;
    if (!at) continue;
    out.push({ kind: u.kind, obj: u.obj, team: KINDS[u.kind]?.team ?? 'red', x: at.x + (u.off?.[0] ?? 0), z: at.z + (u.off?.[1] ?? 0) });
  }
  return out;
}

/** a mission's card: the map on the left, the words on the right */
function briefCard(ui, app, m, mi, plan, x, y, w, h, full) {
  const g = ui.g, T = THEATRES[m.theatre], world = createWorld(m.theatre);
  ui.panel(x, y, w, h, {});
  const ms = full ? h - 60 : Math.min(h - 60, Math.round(w * 0.5)), mx = x + 30, my = y + 30 + Math.round((h - 60 - ms) / 2);
  g.imageSmoothingEnabled = true;
  g.drawImage(mapCanvas(world, 512), mx, my, ms, ms);
  g.strokeStyle = 'rgba(238,240,230,0.3)'; g.lineWidth = 2; g.strokeRect(mx, my, ms, ms);
  // everything on the map stays inside it
  g.save(); g.beginPath(); g.rect(mx, my, ms, ms); g.clip();
  // a 1 km grid
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  for (let k = 1; k < 13; k++) { const o = (ms * k) / 12.8; g.beginPath(); g.moveTo(mx + o, my); g.lineTo(mx + o, my + ms); g.moveTo(mx, my + o); g.lineTo(mx + ms, my + o); g.stroke(); }
  const P = (wx, wz) => [mx + ((wx + HALF) / (2 * HALF)) * ms, my + ((wz + HALF) / (2 * HALF)) * ms];
  // roads, then the towns and sites
  g.strokeStyle = 'rgba(240,228,200,0.55)'; g.lineWidth = 2;
  for (const R of world.roads) { g.beginPath(); R.pts.forEach(([a, b], k) => { const [px, py] = P(a, b); if (k) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); }
  for (const t of world.towns) { const [px, py] = P(t.x, t.z); g.fillStyle = 'rgba(238,240,230,0.7)'; g.fillRect(px - 3, py - 3, 6, 6); ui.text(t.label.toUpperCase(), px + 9, py + 5, 13, COL.dim, { wgt: 600, sp: 1 }); }
  const home = world.site('home'), lz = plan?.lz ?? (m.lz ? world.site(m.lz) : null);
  // the mission's units and lanes
  const marks = plan?.marks ?? marksOf(m, world);
  const lanes = new Set();
  for (const k of marks) {
    if (!k.lane || lanes.has(k.lane)) continue;
    lanes.add(k.lane);
    g.strokeStyle = k.team === 'blue' ? 'rgba(127,216,240,0.85)' : 'rgba(255,86,70,0.8)'; g.lineWidth = 3; g.setLineDash([10, 8]);
    g.beginPath(); k.lane.forEach(([a, b], q) => { const [px, py] = P(a, b); if (q) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); g.setLineDash([]);
  }
  if (plan?.road) { g.strokeStyle = 'rgba(255,184,74,0.85)'; g.lineWidth = 3; g.beginPath(); plan.road.forEach(([a, b], q) => { const [px, py] = P(a, b); if (q) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); }
  for (const k of marks) {
    if (k.lane && !plan) continue;
    const [px, py] = P(k.x, k.z), air = KINDS[k.kind]?.air;
    if (k.team === 'blue') { g.fillStyle = COL.cyan; g.beginPath(); g.arc(px, py, 6, 0, Math.PI * 2); g.fill(); continue; }
    if (k.obj) {
      g.strokeStyle = COL.amber; g.lineWidth = 3;
      g.beginPath(); g.moveTo(px, py - 11); g.lineTo(px + 11, py); g.lineTo(px, py + 11); g.lineTo(px - 11, py); g.closePath(); g.stroke();
    } else if (air) { g.fillStyle = COL.red; g.beginPath(); g.moveTo(px, py - 8); g.lineTo(px + 7, py + 6); g.lineTo(px - 7, py + 6); g.closePath(); g.fill(); }
    else { g.fillStyle = 'rgba(255,86,70,0.85)'; g.fillRect(px - 4, py - 4, 8, 8); }
    // threat rings round the air defences
    const K = KINDS[k.kind], r = K?.sam ?? K?.flak ?? K?.radar ?? 0;
    if (r && full) { g.strokeStyle = 'rgba(255,86,70,0.28)'; g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, (r / (2 * HALF)) * ms, 0, Math.PI * 2); g.stroke(); }
  }
  if (lz) { const [px, py] = P(lz.x, lz.z); g.strokeStyle = COL.cyan; g.lineWidth = 3; g.strokeRect(px - 9, py - 9, 18, 18); ui.text('LZ', px + 14, py + 6, 15, COL.cyan, { wgt: 700, sp: 2 }); }
  // home
  const [hx, hy] = P(home.x, home.z);
  g.fillStyle = COL.cyan; g.beginPath(); g.arc(hx, hy, 9, 0, Math.PI * 2); g.fill();
  ui.text('H', hx, hy + 6, 14, '#062030', { align: 'center', wgt: 700 });
  // under the pad: the town it serves is usually just above it
  ui.text(String(home.label).toUpperCase(), hx, hy + 30, 14, COL.cyan, { align: 'center', wgt: 700, sp: 1 });
  ui.text('N', mx + ms - 24, my + 34, 20, COL.ink, { wgt: 700 });
  ui.text('1 KM GRID', mx + 12, my + ms - 12, 13, COL.dim, { wgt: 600, sp: 2 });
  g.restore();

  // the words
  const tx = mx + ms + 40, tw = x + w - tx - 30;
  ui.fit(`${T.name.toUpperCase()}  ·  ${String(T.sky.time ?? '').toUpperCase()}`, tx, y + 62, 18, tw, COL.cyan, { wgt: 700, sp: 4 });
  ui.fit(m.name.toUpperCase(), tx, y + 118, full ? 56 : 44, tw, COL.ink, { wgt: 700, sp: 6 });
  ui.fit(`${m.type ?? TYPES[m.goal]}  ·  ${String(m.text).toUpperCase()}`, tx, y + 160, 19, tw, COL.amber, { wgt: 700, sp: 1 });
  let ty = y + 210;
  const bs = full ? 25 : 21;
  for (const line of ui.wrap(m.brief, tw, bs)) { ui.text(line, tx, ty, bs, COL.ink, { wgt: 500 }); ty += full ? 36 : 30; }
  ty += 22;
  ui.text('LOADOUT', tx, ty, 17, COL.dim, { wgt: 700, sp: 4 });
  ty += 32;
  const L = m.load ?? {};
  const load = [`GUN ${L.gun ?? 0}`, ...['rkt', 'atm', 'aam'].filter(k => L[k] > 0).map(k => `${STORE_NAME[k]} ${L[k]}`), `FLARES ${L.flares ?? 0}`];
  // an item never breaks across lines
  const nb = list => list.map(t => t.replace(/ /g, '\u00a0')).join('   ·   ');
  for (const l of ui.wrap(nb(load), tw, 19, 700)) { ui.text(l, tx, ty, 19, COL.hud, { wgt: 700, sp: 1 }); ty += 30; }
  ty += 16;
  // the opposition
  const opp = {};
  for (const u of m.units) if (KINDS[u.kind] && KINDS[u.kind].team !== 'blue') opp[KINDS[u.kind].label] = (opp[KINDS[u.kind].label] ?? 0) + (u.n ?? 1);
  ui.text('EXPECT', tx, ty, 17, COL.dim, { wgt: 700, sp: 4 });
  ty += 32;
  for (const l of ui.wrap(nb(Object.entries(opp).map(([k, n]) => `${n} ${k}`)), tw, 19, 700)) { ui.text(l, tx, ty, 19, COL.red, { wgt: 700, sp: 1 }); ty += 30; }
  if (full) ui.text(`${app.rank().toUpperCase()}   ·   SCORE ${fmt(app.camp.score)}   ·   AIRFRAMES ${app.camp.airframes}`, tx, y + h - 40, 20, COL.dim, { wgt: 600, sp: 2 });
  void mi;
}

function backButton(ui, app, label) {
  const R = BACK;
  if (app.input.device?.kind !== 'touch') return;
  ui.panel(R.x, R.y, R.w, R.h, { fill: 'rgba(8,14,9,0.75)', r: 4 });
  ui.text(`‹ ${label.toUpperCase()}`, R.x + R.w / 2, R.y + 42, 24, COL.ink, { align: 'center', wgt: 700, sp: 2 });
}

function pause(ui, app) {
  ui.text('PAUSED', W / 2, 290, 64, COL.ink, { align: 'center', wgt: 700, sp: 14 });
  pauseRects(app).forEach((R, i) => {
    const sel = app.menu === i;
    ui.panel(R.x, R.y, R.w, R.h, { fill: sel ? SEL : 'rgba(8,14,9,0.72)', edge: sel ? COL.amber : 'rgba(238,240,230,0.18)', r: 4 });
    const label = R.it === 'assist' ? (app.assist ? 'ASSIST ON' : 'ASSIST OFF') : PAUSE[R.it];
    ui.text(label, W / 2, R.y + 43, 27, sel ? COL.amber : COL.ink, { align: 'center', wgt: 700, sp: 5 });
  });
  const rows = [
    [['cyclic', 'Cyclic'], ['collective', 'Collective'], ['pedals', 'Pedals'], ['hover', 'Hover'], ['assist', 'Assist']],
    [['gun', 'Gun'], ['fire', 'Fire'], ['weapon', 'Store'], ['target', 'Target'], ['decoy', 'Flares'], ['view', 'View']],
    [['pause', 'Resume'], ['sound', app.soundOn ? 'Sound on' : 'Sound off'], ['fullscreen', 'Full screen']],
  ];
  rows.forEach((r, i) => ui.legend(app.input, r, W / 2, 830 + i * 56, 21));
}

function debrief(ui, app) {
  const r = app.result, m = MISSIONS[r.mission];
  const head = r.won ? 'MISSION COMPLETE' : r.kind === 'down' ? (/shot/i.test(r.reason ?? '') ? 'SHOT DOWN' : 'AIRFRAME LOST') : 'MISSION FAILED';
  const col = r.won ? COL.hud : r.kind === 'down' ? COL.red : COL.amber;
  ui.panel(W / 2 - 600, 100, 1200, 880, {});
  ui.text(`DEBRIEF  ·  MISSION ${r.mission + 1}  ${m.name.toUpperCase()}`, W / 2, 170, 22, COL.dim, { align: 'center', wgt: 700, sp: 4 });
  ui.text(head, W / 2, 250, 64, col, { align: 'center', wgt: 700, sp: 10 });
  ui.fit(r.won ? (r.kind === 'landed' ? 'Goal done and the Gadfly is home.' : 'Goal done.') : r.reason || '', W / 2, 300, 24, 1100, COL.ink, { align: 'center', wgt: 500 });
  let y = 375;
  const row = (a, b, c = COL.ink) => { ui.text(a, W / 2 - 480, y, 23, COL.dim, { wgt: 600, sp: 2 }); ui.fit(b, W / 2 + 480, y, 25, 700, c, { align: 'right', wgt: 700, sp: 1 }); y += 42; };
  const kills = Object.entries(r.kills ?? {});
  row('DESTROYED', kills.length ? kills.map(([k, n]) => `${n} ${KINDS[k]?.label ?? k}`).join(', ') : 'nothing');
  row('OBJECTIVES', r.objectives?.pct ? `${r.objectives.done}%` : `${r.objectives?.done ?? 0} of ${r.objectives?.total ?? 0}`);
  row('HITS / SHOTS', `${r.hits} / ${r.shots}`);
  const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
  row('FLIGHT TIME', `${mm}:${String(ss).padStart(2, '0')}`);
  if (r.bonus) row('LANDING AND TIME', `+ ${fmt(r.bonus)}`, COL.hud);
  row('MISSION SCORE', r.won ? fmt(r.score) : `${fmt(r.earned)} (not banked)`, r.won ? COL.hud : COL.amber);
  y += 14;
  row('CAMPAIGN SCORE', fmt(r.total), COL.ink);
  row('RANK', String(r.rank).toUpperCase(), COL.amber);
  row('AIRFRAMES', String(r.airframes), r.airframes <= 1 ? COL.red : COL.ink);
  const next = r.next === 'victory' ? 'THE CAMPAIGN IS WON' : r.next === 'over' ? 'NO AIRFRAMES LEFT' : r.won ? 'NEXT: ' + (MISSIONS[app.camp.mission]?.name ?? '').toUpperCase() : 'FLY IT AGAIN';
  ui.text(next, W / 2, 890, 24, r.next === 'over' ? COL.red : COL.cyan, { align: 'center', wgt: 700, sp: 4 });
  if (app.stT > 1) ui.prompt(app.input, 'PRESS {start} TO CONTINUE', W / 2, 945, 24, COL.dim, 'center');
}

function ending(ui, app, won) {
  logo(ui, W / 2 - (ui.width('TREELINE', 110, 700, 110 * 0.14) - 110 * 0.14) / 2, 250, 110);
  ui.text(won ? 'CAMPAIGN COMPLETE' : 'GAME OVER', W / 2, 430, 64, won ? COL.hud : COL.red, { align: 'center', wgt: 700, sp: 12 });
  ui.text(won ? 'The Combine falls back over the pass. The Marchland is yours again.' : 'The Combine holds the river country. The Guard will need a new crew.', W / 2, 490, 26, COL.ink, { align: 'center', wgt: 500 });
  ui.text(fmt(app.camp.score), W / 2, 620, 80, COL.ink, { align: 'center', wgt: 700, sp: 4 });
  ui.text(app.rank().toUpperCase(), W / 2, 680, 28, COL.amber, { align: 'center', wgt: 700, sp: 6 });
  if (app.newRank >= 0) ui.text(`NEW HIGH SCORE  ·  #${app.newRank + 1}`, W / 2, 740, 24, COL.cyan, { align: 'center', wgt: 700, sp: 4 });
  if (app.stT > 2) ui.prompt(app.input, 'PRESS {start} FOR THE SCORES', W / 2, 860, 26, COL.dim, 'center');
}
