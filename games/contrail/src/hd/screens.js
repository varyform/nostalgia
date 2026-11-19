// The screens over the 3D backdrop: title, mission select, high scores, the briefing card with
// its map, pause, the debrief, game over and victory. Each lays its menu out through one
// function so the touch hit test (screenHit) finds the same rectangles.
import { MISSIONS } from '../missions.js';
import { KINDS, WEAPON_NAME } from '../sim.js';
import { THEATRES } from '../theatres.js';
import { HALF, createWorld } from '../world.js';
import { mapImage } from './terrain.js';
import { COL, H, W, fmt } from './ui.js';

const LABEL = { continue: 'CONTINUE', new: 'NEW CAMPAIGN', missions: 'MISSION SELECT', scores: 'HIGH SCORES', exit: 'EXIT' };
const PAUSE = { resume: 'RESUME', end: 'END SORTIE', restart: 'RESTART SORTIE', quit: 'QUIT TO TITLE' };
const GOAL = { destroy: 'STRIKE', intercept: 'INTERCEPT', escort: 'ESCORT', air: 'AIR SUPERIORITY' };

// ---------- layouts (shared with the hit test) ----------
function titleRects(app) {
  return app.titleItems().map((it, i) => ({ it, x: 140, y: 470 + i * 84 + (i > 0 && app.resume ? 26 : 0), w: 560, h: 68 }));
}
function missionRects() {
  return MISSIONS.map((m, i) => ({ x: 110, y: 186 + i * 62 + m.theatre * 34, w: 640, h: 54 }));
}
function pauseRects(app) {
  return app.pauseItems().map((it, i) => ({ it, x: W / 2 - 280, y: 380 + i * 82, w: 560, h: 66 }));
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

// the briefing maps, one per theatre
const maps = new Map();
function mapCanvas(i) {
  if (maps.has(i)) return maps.get(i);
  const n = 256, px = mapImage(createWorld(i), n), c = document.createElement('canvas');
  c.width = n; c.height = n;
  c.getContext('2d').putImageData(new ImageData(px, n, n), 0, 0);
  maps.set(i, c);
  return c;
}

export function drawScreen(ui, app, V, world) {
  const s = app.state;
  if (s === 'play') return;
  const g = ui.g;
  // a dark wash over the backdrop, heavier behind text
  const wash = { title: 0.25, pause: 0.45 }[s] ?? 0.55;
  g.fillStyle = `rgba(4,8,12,${wash})`; g.fillRect(0, 0, W, H);
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
  void V; void world;
}

function logo(ui, x, y, size = 150) {
  const g = ui.g;
  ui.text('CONTRAIL', x, y, size, '#f2f6f8', { wgt: 700, sp: size * 0.16 });
  const w = ui.width('CONTRAIL', size, 700, size * 0.16);
  // a vapour trail under the name
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,0.85)');
  g.fillStyle = gr; g.fillRect(x, y + size * 0.14, w - size * 0.16, size * 0.05);
  g.fillStyle = COL.amber; g.fillRect(x, y + size * 0.24, w * 0.3, size * 0.02);
}

function title(ui, app) {
  logo(ui, 140, 250);
  ui.text('TERN ACCORD STRIKE WING  ·  THE CINDER PACT WAR', 144, 350, 24, COL.dim, { wgt: 600, sp: 4 });
  const rects = titleRects(app);
  rects.forEach((R, i) => {
    const sel = app.menu === i;
    ui.panel(R.x, R.y, R.w, R.h, { fill: sel ? 'rgba(255,192,79,0.18)' : 'rgba(7,13,20,0.6)', edge: sel ? COL.amber : 'rgba(232,239,243,0.18)', r: 4 });
    ui.text(LABEL[R.it], R.x + 30, R.y + 45, 30, sel ? COL.amber : COL.ink, { wgt: 700, sp: 5 });
    if (R.it === 'continue' && app.resume) {
      const ago = app.resumeAgo();
      ui.text(`${app.resume.label}${ago ? '  ·  ' + ago : ''}`, R.x + 30, R.y + R.h + 22, 19, COL.dim, { wgt: 500, sp: 1 });
    }
  });
  ui.legend(app.input, [['menu', 'Choose'], ['start', 'Select'], ...(app.onExit ? [['quit', 'Exit']] : []), ['sound', app.soundOn ? 'Sound on' : 'Sound off'], ['fullscreen', 'Full screen']], 420, 1010, 20);
  ui.text(`AFTER F29 RETALIATOR (1989)`, W - 60, 1030, 16, COL.faint, { align: 'right', wgt: 500, sp: 3 });
}

function missions(ui, app) {
  ui.text('MISSION SELECT', 110, 110, 46, COL.ink, { wgt: 700, sp: 8 });
  ui.text('A new campaign from any mission you have reached', 112, 150, 20, COL.dim, { wgt: 500 });
  const rects = missionRects();
  let th = -1;
  MISSIONS.forEach((m, i) => {
    const R = rects[i], locked = i > app.unlocked, sel = app.menu === i;
    if (m.theatre !== th) { th = m.theatre; ui.text(THEATRES[th].name.toUpperCase(), R.x, R.y - 10, 17, COL.cyan, { wgt: 700, sp: 3 }); }
    ui.panel(R.x, R.y, R.w, R.h - 6, { fill: sel ? 'rgba(255,192,79,0.18)' : 'rgba(7,13,20,0.6)', edge: sel ? COL.amber : 'rgba(232,239,243,0.12)', r: 4 });
    const c = locked ? COL.faint : sel ? COL.amber : COL.ink;
    ui.text(String(i + 1).padStart(2, '0'), R.x + 22, R.y + 34, 22, c, { wgt: 700 });
    ui.text(m.name.toUpperCase(), R.x + 80, R.y + 34, 22, c, { wgt: 700, sp: 3 });
    ui.text(locked ? 'LOCKED' : GOAL[m.goal], R.x + R.w - 22, R.y + 34, 16, locked ? COL.faint : COL.dim, { align: 'right', wgt: 600, sp: 2 });
  });
  const m = MISSIONS[Math.min(app.menu, MISSIONS.length - 1)];
  briefCard(ui, app, m, app.menu, 820, 170, 1040, 760, false);
  backButton(ui, app, 'Title');
  ui.legend(app.input, [['menu', 'Choose'], ['start', 'Fly from here'], ['back', 'Back']], 1340, 1012, 20);
}

function scores(ui, app) {
  ui.text('HIGH SCORES', W / 2, 150, 52, COL.ink, { align: 'center', wgt: 700, sp: 10 });
  ui.panel(W / 2 - 520, 200, 1040, 640, {});
  const list = app.scores;
  if (!list.length) ui.text('No campaigns flown yet', W / 2, 520, 28, COL.dim, { align: 'center', wgt: 500 });
  list.forEach((e, i) => {
    const y = 270 + i * 72, hi = i === app.newRank, c = hi ? COL.amber : COL.ink;
    if (hi) ui.panel(W / 2 - 500, y - 46, 1000, 64, { fill: 'rgba(255,192,79,0.14)', edge: COL.amber, r: 4 });
    ui.text(`${i + 1}`, W / 2 - 460, y, 28, c, { wgt: 700 });
    ui.text(fmt(e.score), W / 2 - 150, y, 30, c, { align: 'right', wgt: 700, sp: 1 });
    ui.text(e.rank.toUpperCase(), W / 2 - 100, y, 22, c, { wgt: 600, sp: 2 });
    ui.text(e.mission >= MISSIONS.length ? 'CAMPAIGN WON' : `MISSION ${e.mission + 1}`, W / 2 + 480, y, 20, hi ? COL.amber : COL.dim, { align: 'right', wgt: 600, sp: 2 });
  });
  ui.prompt(app.input, 'PRESS {start} TO GO BACK', W / 2, 920, 24, COL.dim, 'center');
}

function brief(ui, app) {
  const mi = app.camp.mission, m = MISSIONS[mi];
  ui.text(`MISSION ${mi + 1} OF ${MISSIONS.length}`, 110, 100, 22, COL.amber, { wgt: 700, sp: 6 });
  briefCard(ui, app, m, mi, 100, 130, 1720, 820, true);
  backButton(ui, app, 'Title');
  ui.prompt(app.input, 'PRESS {start} TO TAKE OFF', W - 110, 1024, 28, COL.amber, 'right', 700);
}

/** a mission's card: the map on the left, the words on the right */
function briefCard(ui, app, m, mi, x, y, w, h, full) {
  const g = ui.g, T = THEATRES[m.theatre], world = createWorld(m.theatre);
  ui.panel(x, y, w, h, {});
  const ms = h - 60, mx = x + 30, my = y + 30;
  g.imageSmoothingEnabled = true;
  g.drawImage(mapCanvas(m.theatre), mx, my, ms, ms);
  g.strokeStyle = 'rgba(232,239,243,0.3)'; g.lineWidth = 2; g.strokeRect(mx, my, ms, ms);
  // grid
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(mx + (ms * k) / 6, my); g.lineTo(mx + (ms * k) / 6, my + ms); g.moveTo(mx, my + (ms * k) / 6); g.lineTo(mx + ms, my + (ms * k) / 6); g.stroke(); }
  const P = (wx, wz) => [mx + ((wx + HALF) / (2 * HALF)) * ms, my + ((wz + HALF) / (2 * HALF)) * ms];
  // lanes the mission uses
  const lanes = new Set(m.units.map(u => u.lane).filter(Boolean));
  for (const ln of lanes) {
    const pts = ln === 'road' ? T.road : ln === 'river' ? T.river : T.lanes[ln];
    if (!pts) continue;
    g.strokeStyle = 'rgba(255,90,74,0.75)'; g.lineWidth = 3; g.setLineDash([10, 8]);
    g.beginPath(); pts.forEach(([a, b], k) => { const [px, py] = P(a, b); if (k) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); g.setLineDash([]);
    const [ex, ey] = P(...pts[pts.length - 1]);
    g.fillStyle = COL.red; g.beginPath(); g.arc(ex, ey, 6, 0, Math.PI * 2); g.fill();
  }
  // sites
  for (const s of Object.values(world.sites)) {
    const [px, py] = P(s.x, s.z), home = s.name === 'home';
    g.fillStyle = home ? COL.cyan : 'rgba(232,239,243,0.85)';
    if (s.runway) { g.save(); g.translate(px, py); g.rotate(s.runway.dir); g.fillRect(-3, -(s.runway.len / (2 * HALF)) * ms / 2, 6, (s.runway.len / (2 * HALF)) * ms); g.restore(); }
    else { g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fill(); }
    if (s.label) ui.text(s.label.toUpperCase(), px + 10, py - 8, 15, home ? COL.cyan : COL.ink, { wgt: 700, sp: 1 });
  }
  // objectives
  for (const u of m.units) {
    if (!u.obj || u.lane) continue;
    const at = typeof u.at === 'string' ? world.site(u.at) : { x: u.at[0], z: u.at[1] };
    const [px, py] = P(at.x + (u.off?.[0] ?? 0), at.z + (u.off?.[1] ?? 0));
    g.strokeStyle = COL.amber; g.lineWidth = 3;
    g.beginPath(); g.moveTo(px, py - 12); g.lineTo(px + 12, py); g.lineTo(px, py + 12); g.lineTo(px - 12, py); g.closePath(); g.stroke();
  }
  // the start
  const st = m.start ?? T.start, [sx, sy] = P(st.x, st.z), a = (st.heading * Math.PI) / 180;
  g.save(); g.translate(sx, sy); g.rotate(a);
  g.fillStyle = COL.cyan; g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 9); g.lineTo(0, 4); g.lineTo(-9, 9); g.closePath(); g.fill(); g.restore();
  ui.text('N', mx + ms - 24, my + 34, 20, COL.ink, { wgt: 700 });

  // the words
  const tx = mx + ms + 40, tw = x + w - tx - 30;
  ui.text(T.name.toUpperCase(), tx, y + 62, 18, COL.cyan, { wgt: 700, sp: 4 });
  ui.text(m.name.toUpperCase(), tx, y + 118, full ? 56 : 44, COL.ink, { wgt: 700, sp: 6 });
  ui.text(`${GOAL[m.goal]}  ·  ${m.text.toUpperCase()}`, tx, y + 160, 19, COL.amber, { wgt: 700, sp: 1 });
  let ty = y + 210;
  for (const line of ui.wrap(m.brief, tw, full ? 25 : 22)) { ui.text(line, tx, ty, full ? 25 : 22, COL.ink, { wgt: 500 }); ty += full ? 36 : 31; }
  ty += 24;
  ui.text('LOADOUT', tx, ty, 17, COL.dim, { wgt: 700, sp: 4 });
  ty += 34;
  const load = Object.entries(m.load).filter(([, n]) => n > 0).map(([k, n]) => `${WEAPON_NAME[k]} ${n}`);
  ui.text(['CANNON 600', ...load].join('   ·   '), tx, ty, 20, COL.green, { wgt: 700, sp: 1 });
  ty += 46;
  // the opposition
  const opp = {};
  for (const u of m.units) if (KINDS[u.kind].team !== 'blue') opp[KINDS[u.kind].label] = (opp[KINDS[u.kind].label] ?? 0) + (u.n ?? 1);
  ui.text('EXPECT', tx, ty, 17, COL.dim, { wgt: 700, sp: 4 });
  ty += 34;
  const lines = ui.wrap(Object.entries(opp).map(([k, n]) => `${n} ${k}`).join('   ·   '), tw, 19, 700);
  for (const l of lines) { ui.text(l, tx, ty, 19, COL.red, { wgt: 700, sp: 1 }); ty += 30; }
  if (full) {
    ui.text(`${app.rank().toUpperCase()}   ·   SCORE ${fmt(app.camp.score)}   ·   AIRFRAMES ${app.camp.airframes}`, tx, y + h - 40, 20, COL.dim, { wgt: 600, sp: 2 });
  }
  void mi;
}

function backButton(ui, app, label) {
  const R = BACK;
  if (app.input.device?.kind !== 'touch') return;
  ui.panel(R.x, R.y, R.w, R.h, { fill: 'rgba(7,13,20,0.7)', r: 4 });
  ui.text(`‹ ${label.toUpperCase()}`, R.x + R.w / 2, R.y + 42, 24, COL.ink, { align: 'center', wgt: 700, sp: 2 });
}

function pause(ui, app) {
  ui.text('PAUSED', W / 2, 300, 64, COL.ink, { align: 'center', wgt: 700, sp: 14 });
  pauseRects(app).forEach((R, i) => {
    const sel = app.menu === i;
    ui.panel(R.x, R.y, R.w, R.h, { fill: sel ? 'rgba(255,192,79,0.18)' : 'rgba(7,13,20,0.7)', edge: sel ? COL.amber : 'rgba(232,239,243,0.18)', r: 4 });
    ui.text(PAUSE[R.it], W / 2, R.y + 44, 28, sel ? COL.amber : COL.ink, { align: 'center', wgt: 700, sp: 5 });
  });
  const rows = [
    [['fly', 'Pitch and roll'], ['throttle', 'Throttle'], ['rudder', 'Rudder'], ['gun', 'Cannon']],
    [['fire', 'Fire'], ['weapon', 'Weapon'], ['target', 'Target'], ['decoy', 'Decoys'], ['view', 'View']],
    [['pause', 'Resume'], ['sound', app.soundOn ? 'Sound on' : 'Sound off'], ['fullscreen', 'Full screen']],
  ];
  rows.forEach((r, i) => ui.legend(app.input, r, W / 2, 800 + i * 58, 21));
}

function debrief(ui, app) {
  const r = app.result, m = MISSIONS[r.mission];
  const head = r.won ? 'MISSION COMPLETE' : r.kind === 'down' ? (r.reason === 'Shot down' ? 'SHOT DOWN' : 'AIRFRAME LOST') : 'MISSION FAILED';
  const col = r.won ? COL.green : r.kind === 'down' ? COL.red : COL.amber;
  ui.panel(W / 2 - 600, 110, 1200, 860, {});
  ui.text(`DEBRIEF  ·  MISSION ${r.mission + 1}  ${m.name.toUpperCase()}`, W / 2, 180, 22, COL.dim, { align: 'center', wgt: 700, sp: 4 });
  ui.text(head, W / 2, 260, 64, col, { align: 'center', wgt: 700, sp: 10 });
  ui.text(r.won ? (r.landed ? 'Objectives met and the Seraph is home.' : 'Objectives met.') : r.reason || '', W / 2, 310, 24, COL.ink, { align: 'center', wgt: 500 });
  let y = 390;
  const row = (a, b, c = COL.ink) => { ui.text(a, W / 2 - 480, y, 24, COL.dim, { wgt: 600, sp: 2 }); ui.text(b, W / 2 + 480, y, 26, c, { align: 'right', wgt: 700, sp: 1 }); y += 44; };
  const kills = Object.entries(r.kills);
  row('DESTROYED', kills.length ? kills.map(([k, n]) => `${n} ${KINDS[k].label}`).join(', ') : 'nothing');
  row('OBJECTIVES', r.objectives.pct ? `${r.objectives.done}%` : `${r.objectives.done} of ${r.objectives.total}`);
  row('HITS / SHOTS', `${r.hits} / ${r.shots}`);
  const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
  row('FLIGHT TIME', `${mm}:${String(ss).padStart(2, '0')}`);
  row('SORTIE SCORE', r.won ? fmt(r.score) : `${fmt(r.earned)} (not banked)`, r.won ? COL.green : COL.amber);
  y += 16;
  row('CAMPAIGN SCORE', fmt(r.total), COL.ink);
  row('RANK', r.rank.toUpperCase(), COL.amber);
  row('AIRFRAMES', String(r.airframes), r.airframes <= 1 ? COL.red : COL.ink);
  const next = r.next === 'victory' ? 'THE CAMPAIGN IS WON' : r.next === 'over' ? 'NO AIRFRAMES LEFT' : r.won ? 'NEXT: ' + MISSIONS[app.camp.mission].name.toUpperCase() : 'FLY IT AGAIN';
  ui.text(next, W / 2, 880, 24, r.next === 'over' ? COL.red : COL.cyan, { align: 'center', wgt: 700, sp: 4 });
  if (app.stT > 1) ui.prompt(app.input, 'PRESS {start} TO CONTINUE', W / 2, 935, 24, COL.dim, 'center');
}

function ending(ui, app, won) {
  logo(ui, W / 2 - ui.width('CONTRAIL', 110, 700, 110 * 0.16) / 2, 260, 110);
  ui.text(won ? 'CAMPAIGN COMPLETE' : 'GAME OVER', W / 2, 430, 64, won ? COL.green : COL.red, { align: 'center', wgt: 700, sp: 12 });
  ui.text(won ? 'The Iron Crown has fallen and the Pact sues for peace.' : 'The Pact holds the line. The wing will need a new pilot.', W / 2, 490, 26, COL.ink, { align: 'center', wgt: 500 });
  ui.text(fmt(app.camp.score), W / 2, 620, 80, COL.ink, { align: 'center', wgt: 700, sp: 4 });
  ui.text(app.rank().toUpperCase(), W / 2, 680, 28, COL.amber, { align: 'center', wgt: 700, sp: 6 });
  if (app.newRank >= 0) ui.text(`NEW HIGH SCORE  ·  #${app.newRank + 1}`, W / 2, 740, 24, COL.cyan, { align: 'center', wgt: 700, sp: 4 });
  if (app.stT > 2) ui.prompt(app.input, 'PRESS {start}', W / 2, 860, 26, COL.dim, 'center');
}
