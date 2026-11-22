// The screens around the match: the title, the friendly picker, choosing a club, the manager's
// hub with the squad, tables, fixtures, cup and transfer market, the prematch line-ups, the
// panels over a frozen match (pause, half time, full time), the season's end, the title won,
// initials for the honours table and the table itself. 90s TV football graphics (hd/ui.js).
// Everything is drawn in a 1920 × 1080 space (the renderer scales the context) and whatever
// can be tapped records its rectangle as it is drawn, so screenAt() answers with what the
// screen showed there: { i, act? } | { tab } | { back } | { go } | { d, row } | { letter, d? } | { done }.
//
//   drawScreen(g, app, t)    nothing for 'match' / 'demo'; a panel over the pitch for
//                            'pause' / 'halftime' / 'fulltime'; a full screen otherwise
//   screenAt(app, x, y)      1920 × 1080 coordinates → the hit, or null
import { savedAgo } from '@nostalgia/save';
import * as career from '../career.js';
import { CLUBS, CUP, DIVISIONS, LEAGUE, SQUAD_MAX, clubOf, overall, rating, squadOf } from '../clubs.js';
import { FORMATIONS } from '../tactics.js';
import { COL, H, LOGO, TAU, W, alpha, arrows, backdrop, beginHits, blink, button, clamp01, ease, formation, hitAt, hot, measure, panel, prompt, rr, shirt, stars, strap, text, wrap } from './ui.js';

const money = n => career.money(n);
const up = s => String(s ?? '').toUpperCase();
const nth = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH'}`;
const DIV_SHORT = { 1: 'FIRST DIVISION', 2: 'SECOND DIVISION' };
const ITEM = {
  continue: 'CONTINUE', career: 'CAREER', friendly: 'FRIENDLY', options: 'OPTIONS', honours: 'HONOURS', exit: 'EXIT',
  play: 'PLAY', squad: 'SQUAD', table: 'TABLE', fixtures: 'FIXTURES', cup: 'CUP', transfers: 'TRANSFERS', quit: 'QUIT TO TITLE',
};
const slotsOf = k => FORMATIONS?.[k]?.slots ?? [];
const club = id => clubOf(id) ?? { id, name: id ?? '', short: '???', town: '', kit: { home: { shirt: '#888888', shorts: '#888888', socks: '#888888', trim: '#888888', pattern: 'plain' } } };
const kitOf = id => club(id).kit.home;
// strengths are dear to work out (every shape tried): kept per career object
const memo = new WeakMap(), memoNull = new Map();
function strengthOf(C, id) {
  const m = C ? memo.get(C) ?? (memo.set(C, new Map()), memo.get(C)) : memoNull;
  if (!m.has(id)) m.set(id, career.strength(C, id));
  return m.get(id);
}
const starsOf = s => clamp01((s - 3.2) / 4) * 5;
const pct = v => `${Math.round((v ?? 0) * 100)}%`;
function safe(fn, dflt = null) { try { return fn() ?? dflt; } catch { return dflt; } }

// ---------- shared chrome ----------
function header(g, app, title, sub) {
  const gr = g.createLinearGradient(0, 0, 0, 150);
  gr.addColorStop(0, 'rgba(6,14,24,0.96)'); gr.addColorStop(1, 'rgba(10,24,40,0.9)');
  g.fillStyle = gr; g.fillRect(0, 0, W, 150);
  g.fillStyle = COL.yellow; g.fillRect(0, 150, W, 4);
  // the title on a slanted yellow tab, the sub-line under it
  const tw = Math.max(360, measure(g, title, 60, 800, 2) + 120);
  g.beginPath(); g.moveTo(0, 26); g.lineTo(tw, 26); g.lineTo(tw - 26, 104); g.lineTo(0, 104); g.closePath();
  g.fillStyle = COL.yellow; g.fill();
  text(g, title, 70, 87, 60, COL.ink, { wgt: 800, spacing: 2, max: 1080 });
  if (sub) text(g, sub, 72, 136, 24, COL.dim, { wgt: 700, spacing: 3, max: 1100 });
  const C = app.career;
  if (!C) return;
  // your club, your money, the week
  const c = club(C.club);
  let x = W - 60;
  const box = (l, v, col) => {
    const w = Math.max(170, measure(g, v, 40, 800) + 50);
    panel(g, x - w, 30, w, 96, { a: 0.9, tab: false });
    text(g, l, x - w / 2, 62, 19, COL.dim, { align: 'center', spacing: 3 });
    text(g, v, x - w / 2, 110, 40, col, { wgt: 800, align: 'center' });
    x -= w + 14;
  };
  box('BUDGET', money(C.budget), C.budget < 0 ? COL.red : COL.yellow);
  box(`SEASON ${C.season}`, `WEEK ${Math.min(career.CALENDAR.length, C.week + 1)}`, COL.chalk);
  if (x > 1300) {
    shirt(g, kitOf(C.club), x - 44, 78, 70);
    text(g, up(c.short), x - 100, 92, 40, COL.chalk, { wgt: 800, align: 'right' });
  }
}
function footer(g, app, hints, t, back = true) {
  g.fillStyle = 'rgba(6,14,24,0.88)'; g.fillRect(0, 1010, W, 70);
  g.fillStyle = COL.yellow; g.fillRect(0, 1008, W, 3);
  if (back) button(g, 30, 1020, 200, 52, '◀ BACK', false, t, { back: true }, { size: 26 });
  if (hints) prompt(g, app, hints, W / 2 + (back ? 60 : 0), 1056, 25);
}
function msgStrip(g, M, app, x, y, w) {
  if (!M?.msg || app.t - (M.msgT ?? -9) > 4) return;
  const a = clamp01(4 - (app.t - M.msgT)), col = M.ok ? COL.ok : COL.red;
  g.globalAlpha = a;
  panel(g, x, y, w, 54, { a: 0.95, tab: false, edge: col });
  text(g, M.msg, x + 24, y + 38, 27, col, { wgt: 800, spacing: 1, max: w - 48 });
  g.globalAlpha = 1;
}
/** a club's name strap: shirt, name, and optionally a figure on the right */
function clubLine(g, id, x, y, w, h, { right = null, rightCol = COL.chalk, you = false, size = 28, kit = null } = {}) {
  const c = club(id);
  shirt(g, kit ?? kitOf(id), x + h * 0.45, y + h / 2, h * 0.72);
  text(g, up(c.name), x + h * 0.95, y + h / 2 + size * 0.36, size, you ? COL.yellow : COL.chalk, { wgt: 700, max: w - h - (right ? 120 : 10) });
  if (right != null) text(g, right, x + w - 10, y + h / 2 + size * 0.36, size, rightCol, { wgt: 800, align: 'right' });
}
const resText = r => (r ? `${r.s[0]}–${r.s[1]}${r.p ? ` (${r.p[0]}–${r.p[1]})` : ''}` : '–');

// ---------- the title ----------
function logo(g, x, y, size) {
  g.save();
  g.translate(x, y);
  g.transform(1, 0, -0.14, 1, 0, 0);
  g.font = `400 ${size}px ${LOGO}`;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = '4px';
  const s = 'SWERVE', w = g.measureText(s).width;
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(s, 8, 10);
  g.lineWidth = 14; g.strokeStyle = COL.navy; g.lineJoin = 'round'; g.strokeText(s, 0, 0);
  const gr = g.createLinearGradient(0, -size * 0.8, 0, 0);
  gr.addColorStop(0, '#fff6c9'); gr.addColorStop(0.45, COL.yellow); gr.addColorStop(1, '#e09a00');
  g.fillStyle = gr; g.fillText(s, 0, 0);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.restore();
  return w;
}
// the ball bending around a wall into the top corner, again and again
function bendingShot(g, t) {
  const T = 3.2, q = (t % T) / T, x0 = 1180, y0 = 900, x1 = 1640, y1 = 330, cx = 1880, cy = 760;
  const at = u => [(1 - u) ** 2 * x0 + 2 * (1 - u) * u * cx + u * u * x1, (1 - u) ** 2 * y0 + 2 * (1 - u) * u * cy + u * u * y1];
  // the goal, from behind the net
  g.save();
  g.strokeStyle = 'rgba(244,241,232,0.85)'; g.lineWidth = 10;
  g.beginPath(); g.moveTo(1440, 380); g.lineTo(1440, 290); g.lineTo(1800, 290); g.lineTo(1800, 380); g.stroke();
  g.strokeStyle = 'rgba(244,241,232,0.18)'; g.lineWidth = 2;
  for (let k = 0; k <= 12; k++) { g.beginPath(); g.moveTo(1440 + k * 30, 290); g.lineTo(1460 + k * 28, 240); g.stroke(); }
  g.beginPath(); g.moveTo(1440, 290); g.lineTo(1460, 240); g.lineTo(1782, 240); g.lineTo(1800, 290); g.stroke();
  // the wall: four little defenders
  for (let k = 0; k < 4; k++) {
    const wx = 1440 + k * 34, wy = 690;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(wx + 4, wy + 30, 16, 6, 0, 0, TAU); g.fill();
    g.fillStyle = '#c8102e'; g.fillRect(wx - 12, wy - 6, 24, 30);
    g.fillStyle = '#f0c8a0'; g.beginPath(); g.arc(wx, wy - 16, 10, 0, TAU); g.fill();
  }
  // the trail and the ball
  const head = Math.min(1, q * 1.25);
  g.setLineDash([16, 14]); g.lineDashOffset = -t * 60;
  g.strokeStyle = alpha(COL.yellow, 0.75); g.lineWidth = 5;
  g.beginPath();
  for (let k = 0; k <= 40; k++) { const [px, py] = at((k / 40) * head); if (k) g.lineTo(px, py); else g.moveTo(px, py); }
  g.stroke(); g.setLineDash([]);
  const [bx, by] = at(head), lift = Math.sin(head * Math.PI) * 60;
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(bx + lift * 0.4, by + lift * 0.6, 16, 7, 0, 0, TAU); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(bx, by, 15, 0, TAU); g.fill();
  g.fillStyle = '#1b1b1b';
  for (let k = 0; k < 5; k++) { const a = t * 9 + (k * TAU) / 5; g.beginPath(); g.arc(bx + Math.cos(a) * 8, by + Math.sin(a) * 8, 3.4, 0, TAU); g.fill(); }
  if (q > 0.8) text(g, 'GOAL!', 1620, 200, 72, alpha(COL.yellow, clamp01((q - 0.8) * 8)), { wgt: 800, align: 'center', italic: true, shadow: true });
  g.restore();
}
function title(g, app, t) {
  backdrop(g, t, { dark: 0.5 });
  bendingShot(g, t);
  logo(g, 110, 330, 210);
  text(g, `TOP-DOWN FOOTBALL IN THE ${up(LEAGUE)}`, 118, 400, 32, COL.chalk, { wgt: 700, spacing: 5, shadow: true });
  const items = app.items?.() ?? ['career'];
  items.forEach((it, k) => {
    const sel = k === app.menu, y = 450 + k * 88, w = 560, h = 70;
    const label = it === 'career' && app.saved ? 'NEW CAREER' : ITEM[it] ?? up(it);
    button(g, 110, y, w, h, label, sel, t, { i: k }, { size: 36 });
    if (it === 'continue' && app.saved) {
      const s = up(`${app.saved.label ?? ''}${app.saved.at ? ' · ' + savedAgo(app.saved.at) : ''}`);
      text(g, s, 110 + w + 24, y + h / 2 + 10, 26, sel ? COL.yellow : COL.dim, { wgt: 700, spacing: 1, max: 560 });
    }
  });
  const hdr = app.hdr?.supported ? `   {hdr} HDR ${String(app.hdr.label ?? '').slice(4).toLowerCase()}` : '';
  footer(g, app, `{menu} Choose   {start} Select   {sound} Sound ${app.soundOn ? 'on' : 'off'}   {fullscreen} Full screen${hdr}${app.onExit ? '   {quit} Exit' : ''}`, t, false);
}

// ---------- options ----------
function options(g, app, t) {
  backdrop(g, t);
  header(g, app, 'OPTIONS', 'SAVED IN THE BROWSER');
  const rows = [
    ['MATCH LENGTH', `${app.opts?.half ?? 5} MINUTE HALVES`, 'REAL TIME A HALF; THE CLOCK SHOWS 45 MINUTES'],
    ['SOUND', app.soundOn ? 'ON' : 'OFF', 'MUSIC, CROWD AND EFFECTS ({sound} ANY TIME)'],
  ];
  panel(g, 460, 250, 1000, 560);
  rows.forEach(([l, v, note], k) => {
    const y = 300 + k * 170, sel = app.optSel === k;
    text(g, l, 520, y + 26, 26, sel ? COL.yellow : COL.dim, { spacing: 4 });
    strap(g, 520, y + 44, 880, 80, sel, t);
    text(g, v, 960, y + 99, 40, sel ? COL.ink : COL.chalk, { wgt: 800, align: 'center' });
    arrows(g, 520, y + 44, 880, 80, k, sel, t);
    hot(620, y + 44, 680, 80, { i: k });
    prompt(g, app, note, 960, y + 152, 20, COL.faint);
  });
  button(g, 760, 680, 400, 76, 'DONE', app.optSel === 2, t, { i: 2 }, { size: 34 });
  footer(g, app, '{menu} Choose   {change} Change   {back} Title', t);
}

// ---------- the friendly ----------
const SIDE = ['HOME', 'AWAY', 'WATCH'];
function friendly(g, app, t) {
  backdrop(g, t);
  header(g, app, 'FRIENDLY', 'ANY TWO CLUBS OF THE LEAGUE: YOU PLAY ONE, OR WATCH');
  const F = app.friendly ?? { home: 0, away: 1, side: 0, sel: 0 };
  const ids = CLUBS.map(c => c.id), home = ids[F.home], away = ids[F.away];
  panel(g, 70, 190, 900, 790);
  const row = (k, label, draw) => {
    const y = 230 + k * 170, sel = F.sel === k;
    text(g, label, 120, y + 24, 24, sel ? COL.yellow : COL.dim, { spacing: 4 });
    strap(g, 120, y + 40, 800, 96, sel, t);
    draw(y + 40, sel);
    arrows(g, 120, y + 40, 800, 96, k, sel, t);
    hot(220, y + 40, 600, 96, { i: k });
  };
  for (const [k, id] of [[0, home], [1, away]]) row(k, k ? 'AWAY' : 'HOME', (y, sel) => {
    shirt(g, kitOf(id), 280, y + 48, 70);
    text(g, up(club(id).name), 340, y + 62, 38, sel ? COL.ink : COL.chalk, { wgt: 800, max: 500 });
  });
  row(2, 'YOU PLAY', (y, sel) => {
    const s = F.side === 2 ? 'NEITHER: WATCH' : `${SIDE[F.side]}: ${up(club(F.side ? away : home).short)}`;
    text(g, s, 520, y + 62, 38, sel ? COL.ink : COL.chalk, { wgt: 800, align: 'center' });
  });
  button(g, 270, 790, 500, 86, 'KICK OFF', F.sel === 3, t, { go: true }, { size: 40 });
  hot(270, 790, 500, 86, { i: 3 });
  // the two sides, side by side
  panel(g, 1010, 190, 840, 790);
  const [kits] = [career.kitsFor(club(home), club(away))];
  [[home, kits.home, 0], [away, kits.away, 1]].forEach(([id, kit, k]) => {
    const x = 1220 + k * 420, c = club(id), s = strengthOf(null, id);
    shirt(g, kit, x, 380, 170, { shorts: true });
    text(g, up(c.name), x, 610, 36, COL.chalk, { wgt: 800, align: 'center', max: 380 });
    text(g, up(c.nick ?? ''), x, 648, 24, COL.dim, { align: 'center', spacing: 2, max: 380 });
    stars(g, starsOf(s), x - 146, 700, 46);
    text(g, DIV_SHORT[c.div], x, 770, 22, COL.dim, { align: 'center', spacing: 3 });
    if (F.side === k) text(g, 'YOU', x, 830, 40, COL.yellow, { wgt: 800, align: 'center', spacing: 6 });
  });
  text(g, 'V', 1430, 400, 70, COL.yellow, { wgt: 800, align: 'center', italic: true });
  if (kits.change) text(g, `${up(club(away).short)} WEAR THEIR CHANGE KIT`, 1430, 920, 22, COL.dim, { align: 'center', spacing: 3 });
  footer(g, app, '{menu} Choose   {change} Change   {start} Kick off   {back} Title', t);
}

// ---------- choosing a club ----------
function clubs(g, app, t) {
  backdrop(g, t);
  header(g, app, 'CHOOSE YOUR CLUB', 'THE SECOND DIVISION: THE BOARD WANTS PROMOTION, THE FANS WANT THE TITLE');
  const list = app.clubList ?? [];
  list.forEach((id, k) => {
    const c = club(id), sel = k === app.clubSel, col = k % 4, row = Math.floor(k / 4);
    const x = 70 + col * 452, y = 186 + row * 384, w = 428, h = 364;
    if (sel) { g.save(); g.shadowColor = alpha(COL.yellow, 0.5); g.shadowBlur = 30; panel(g, x, y, w, h, { edge: COL.yellow, lw: 4 }); g.restore(); }
    else panel(g, x, y, w, h, { a: 0.8 });
    hot(x, y, w, h, { i: k });
    shirt(g, c.kit.home, x + 100, y + 120, 120, { shorts: true });
    shirt(g, c.kit.away, x + 222, y + 110, 64);
    text(g, 'AWAY', x + 222, y + 166, 16, COL.faint, { align: 'center', spacing: 2 });
    text(g, up(c.name), x + 24, y + 270, 34, sel ? COL.yellow : COL.chalk, { wgt: 800, max: w - 48 });
    text(g, up(c.nick), x + 24, y + 300, 20, COL.dim, { spacing: 2, max: w - 48 });
    stars(g, starsOf(strengthOf(null, id)), x + 24, y + 334, 26);
    text(g, money(career.startBudget(id)), x + w - 24, y + 344, 30, COL.yellow, { wgt: 800, align: 'right' });
    // the squad's best man
    const best = squadOf(id).slice().sort((a, b) => overall(b) - overall(a))[0];
    if (best) {
      text(g, 'STAR', x + w - 24, y + 60, 17, COL.faint, { align: 'right', spacing: 3 });
      text(g, up(best.name), x + w - 24, y + 90, 26, COL.chalk, { align: 'right', max: 150 });
      text(g, best.pos, x + w - 24, y + 116, 20, COL.dim, { align: 'right' });
    }
  });
  if (app.saved) text(g, 'A NEW CAREER REPLACES THE SAVED ONE ONCE IT BEGINS', W / 2, 980, 22, COL.red, { align: 'center', spacing: 3 });
  footer(g, app, '{menu} Choose   {start} Take the job   {back} Title', t);
}

// ---------- the hub ----------
function fixtureCard(g, app, x, y, w, h) {
  const C = app.career, fx = app.fx;
  panel(g, x, y, w, h);
  if (!fx) { text(g, 'THE SEASON IS OVER', x + w / 2, y + h / 2, 40, COL.chalk, { wgt: 800, align: 'center' }); return; }
  text(g, 'NEXT MATCH', x + 34, y + 46, 22, COL.yellow, { spacing: 5 });
  text(g, up(fx.label), x + w - 30, y + 46, 22, COL.dim, { align: 'right', spacing: 2, max: w - 260 });
  const K = career.kitsFor(club(fx.home), club(fx.away));
  [[fx.home, K.home, 0], [fx.away, K.away, 1]].forEach(([id, kit, k]) => {
    const cx = x + w / 2 + (k ? 1 : -1) * w * 0.27, c = club(id), you = id === C.club;
    shirt(g, kit, cx, y + 140, 104);
    text(g, up(c.name), cx, y + 238, 32, you ? COL.yellow : COL.chalk, { wgt: 800, align: 'center', max: w * 0.44 });
    const pos = fx.kind === 'league' ? career.position(C, id) : 0;
    const info = fx.kind === 'league' ? `${nth(pos)} · ${career.table(C, fx.div).find(r => r.id === id)?.pts ?? 0} PTS` : DIV_SHORT[C.div[id]];
    text(g, info, cx, y + 272, 22, COL.dim, { align: 'center', spacing: 2 });
  });
  text(g, 'V', x + w / 2, y + 160, 58, COL.yellow, { wgt: 800, align: 'center', italic: true });
  text(g, fx.home === C.club ? `AT ${up(club(fx.home).town)} · HOME` : `AT ${up(club(fx.home).town)} · AWAY`, x + w / 2, y + h - 22, 22, COL.faint, { align: 'center', spacing: 3 });
}
function latest(g, app, x, y, w, h) {
  const C = app.career, R = app.report;
  panel(g, x, y, w, h);
  if (!R) {
    text(g, `SEASON ${C.season}`, x + 34, y + 46, 22, COL.yellow, { spacing: 5 });
    const c = club(C.club), d = C.div[C.club];
    const goal = d === 2 ? 'The board want promotion: a top-two finish in the Second Division.' : C.titles.length ? 'Champions. Do it again.' : `The ${DIVISIONS[1]} title: nothing less.`;
    wrap(g, goal, 32, w - 70, 700).slice(0, 3).forEach((l, k) => text(g, l, x + 34, y + 100 + k * 40, 32, COL.chalk, { wgt: 700 }));
    text(g, `${up(c.name)} · SQUAD ${career.squad(C, C.club).length}/${SQUAD_MAX} · WAGES ${money(career.wagesOf(C))} A WEEK`, x + 34, y + h - 30, 21, COL.dim, { spacing: 2, max: w - 68 });
    return;
  }
  const mine = R.mine;
  text(g, 'LAST TIME OUT', x + 34, y + 46, 22, COL.yellow, { spacing: 5 });
  if (mine) {
    const me = mine.home === C.club ? 0 : 1, gf = mine.s[me], ga = mine.s[1 - me];
    const won = mine.w === me, lost = mine.w === 1 - me;
    const word = won ? 'WON' : lost ? 'LOST' : 'DREW';
    text(g, `${word} ${gf}–${ga}${mine.p ? ` (${mine.p[me]}–${mine.p[1 - me]} PENS)` : ''} ${mine.home === C.club ? 'V' : 'AT'} ${up(club(mine.home === C.club ? mine.away : mine.home).name)}`, x + 34, y + 96, 34, won ? COL.ok : lost ? COL.down : COL.chalk, { wgt: 800, max: w - 68 });
  }
  // the week's other scores: your division first, then the other (or the cup round)
  const d = C.div[C.club], others = R.results.filter(r => !(mine && r.home === mine.home && r.away === mine.away));
  const groups = R.results[0]?.kind === 'cup'
    ? [[up(career.ROUNDS[R.results[0].round] ?? CUP), others]]
    : [[DIV_SHORT[d], others.filter(r => r.div === d)], [DIV_SHORT[3 - d], others.filter(r => r.div !== d)]];
  let yy = y + 136;
  for (const [head, list] of groups) {
    if (yy > y + h - 90) break;
    text(g, head, x + 34, yy + 4, 17, COL.faint, { spacing: 3 });
    yy += 30;
    for (const r of list) {
      if (yy > y + h - 60) break;
      text(g, up(club(r.home).name), x + w / 2 - 70, yy, 23, COL.chalk, { wgt: 500, align: 'right', max: w / 2 - 110 });
      text(g, resText(r), x + w / 2, yy, 23, COL.yellow, { wgt: 800, align: 'center' });
      text(g, up(club(r.away).name), x + w / 2 + 70, yy, 23, COL.chalk, { wgt: 500, max: w / 2 - 110 });
      yy += 30;
    }
    yy += 8;
  }
  const news = [...(app.news ?? []), R.gate ? `Gate money ${money(R.gate)}` : null, `Wages ${money(R.wages)}`].filter(Boolean);
  text(g, up(news.join('  ·  ')), x + 34, y + h - 30, 21, COL.dim, { spacing: 1, max: w - 68 });
}
function hub(g, app, t) {
  backdrop(g, t);
  const C = app.career;
  if (!C) return;
  const c = club(C.club), d = C.div[C.club];
  header(g, app, up(c.name), `${DIV_SHORT[d]} · ${nth(career.position(C))} · ${C.titles.length ? `${C.titles.length}× CHAMPIONS` : up(c.nick)}`);
  fixtureCard(g, app, 70, 184, 940, 330);
  latest(g, app, 70, 534, 940, 450);
  const fx = app.fx, stage = career.cupStage(C, C.club);
  const sub = {
    play: fx ? `${fx.home === C.club ? 'V' : 'AT'} ${up(club(fx.home === C.club ? fx.away : fx.home).name)}` : '',
    squad: `${C.formation} · ${career.squad(C, C.club).length} PLAYERS`,
    table: `${nth(career.position(C))} IN THE ${DIV_SHORT[d]}`,
    fixtures: `WEEK ${Math.min(18, C.week + 1)} OF ${career.CALENDAR.length}`,
    cup: stage >= 0 ? up(career.stageName(stage)) : up(career.ROUNDS[nextRound(C)] ?? ''),
    transfers: `BUDGET ${money(C.budget)}`,
    quit: 'THE CAREER IS SAVED',
  };
  app.items().forEach((it, k) => {
    const sel = k === app.menu, y = 184 + k * 114, h = 98;
    button(g, 1070, y, 790, h, ITEM[it], sel, t, { i: k }, { size: 40, sub: sub[it] });
  });
  footer(g, app, '{menu} Choose   {start} Select   {back} Quit', t, false);
}
const nextRound = C => career.CALENDAR.slice(C.week).find(e => e.kind === 'cup')?.round ?? 3;

// ---------- the squad ----------
const ATTR = [['pace', 'PAC'], ['shooting', 'SHO'], ['passing', 'PAS'], ['tackling', 'TCK'], ['keeping', 'KEE']];
function squadScreen(g, app, t) {
  backdrop(g, t);
  const C = app.career;
  if (!C) return;
  const Q = app.squad ?? { sel: 2 }, L = career.lineupOf(C, C.club), rows = app.squadRows?.() ?? [], roles = career.rolesOf(L.formation);
  header(g, app, 'SQUAD', Q.mark ? 'NOW PICK THE PLAYER TO SWAP WITH' : 'PICK A PLAYER, THEN ANOTHER, TO SWAP THEM');
  // the shape on a pitch, the eleven's names on it
  const markSlot = L.xi.indexOf(Q.mark), selSlot = Q.sel >= 2 && Q.sel - 2 < 11 ? Q.sel - 2 : -1;
  panel(g, 60, 180, 640, 816, { tab: false });
  formation(g, slotsOf(L.formation), 80, 200, 600, 776, {
    kit: kitOf(C.club), gk: club(C.club).gk, labels: rows.slice(0, 11).map(p => up(p?.name)), nums: rows.slice(0, 11).map(p => p?.num),
    sel: selSlot, mark: markSlot, tap: { slotTap: true }, t,
  });
  // the list: the shape, best eleven, then the players
  const x = 740, w = 1120;
  const fsel = Q.sel === 0;
  strap(g, x, 180, 560, 72, fsel, t);
  text(g, `FORMATION  ${L.formation}`, x + 280, 228, 34, fsel ? COL.ink : COL.chalk, { wgt: 800, align: 'center' });
  arrows(g, x, 180, 560, 72, 0, fsel, t);
  hot(x + 80, 180, 400, 72, { i: 0 });
  button(g, x + 580, 180, 540, 72, 'PICK THE BEST ELEVEN', Q.sel === 1, t, { i: 1 }, { size: 30 });
  // column heads
  const y0 = 300, rh = 39;
  const cols = { num: x + 50, name: x + 80, pos: x + 410, role: x + 480, attr: x + 600, ov: x + 900, val: x + w - 16 };
  text(g, 'NO', cols.num, y0 - 14, 18, COL.faint, { align: 'right', spacing: 2 });
  text(g, 'NAME', cols.name, y0 - 14, 18, COL.faint, { spacing: 2 });
  text(g, 'POS', cols.pos, y0 - 14, 18, COL.faint, { spacing: 2 });
  text(g, 'PLAYS', cols.role, y0 - 14, 18, COL.faint, { spacing: 2 });
  ATTR.forEach(([, l], k) => text(g, l, cols.attr + k * 62, y0 - 14, 18, COL.faint, { align: 'center', spacing: 1 }));
  text(g, 'RATING', cols.ov, y0 - 14, 18, COL.faint, { spacing: 2 });
  text(g, 'VALUE', cols.val, y0 - 14, 18, COL.faint, { align: 'right', spacing: 2 });
  // as many rows as fit, scrolled to keep the pick in view; the bench under a rule
  const fit = 16, n = rows.length, selRow = Math.max(0, Q.sel - 2);
  const first = Math.max(0, Math.min(selRow - fit + 3, n - fit));
  for (let j = 0; j < Math.min(fit, n); j++) {
    const k = first + j, p = rows[k];
    if (!p) continue;
    const y = y0 + j * rh + (k >= 11 ? 14 : 0), sel = Q.sel === k + 2, marked = Q.mark === p.id;
    if (k === 11) { g.fillStyle = COL.yellow; g.fillRect(x, y - 9, w - 110, 2); text(g, 'BENCH', x + w - 6, y - 2, 17, COL.yellow, { align: 'right', spacing: 3 }); }
    rr(g, x, y, w, rh - 4, 4);
    g.fillStyle = marked ? alpha(COL.yellow, 0.35) : sel ? 'rgba(255,210,63,0.9)' : k < 11 ? 'rgba(13,27,42,0.82)' : 'rgba(13,27,42,0.6)';
    g.fill();
    if (marked) { g.strokeStyle = COL.yellow; g.lineWidth = 3; g.stroke(); }
    const ink = sel ? COL.ink : COL.chalk, dim = sel ? 'rgba(13,27,42,0.7)' : COL.dim;
    const role = k < 11 ? roles[k] : '';
    text(g, String(p.num), cols.num, y + 27, 24, ink, { wgt: 800, align: 'right' });
    text(g, up(p.name) + (p.star ? ' ★' : ''), cols.name, y + 27, 25, ink, { wgt: 700, max: 320 });
    text(g, p.pos, cols.pos, y + 27, 23, dim, { wgt: 700 });
    if (role) text(g, role, cols.role, y + 27, 23, role === p.pos ? (sel ? COL.ink : COL.ok) : sel ? '#8a1020' : COL.down, { wgt: 800 });
    ATTR.forEach(([a], i) => text(g, String(p[a]), cols.attr + i * 62, y + 27, 24, p[a] >= 8 ? (sel ? '#7a4b00' : COL.yellow) : ink, { wgt: p[a] >= 8 ? 800 : 500, align: 'center' }));
    stars(g, (role ? rating(p, role) : overall(p)) / 1.8, cols.ov, y + 18, 20, sel ? COL.ink : COL.yellow);
    text(g, money(p.value), cols.val, y + 27, 22, dim, { wgt: 700, align: 'right' });
    hot(x, y, w, rh - 4, { i: k + 2 });
  }
  if (n > fit) {
    const sh = fit * rh, q = first / (n - fit);
    g.fillStyle = COL.ghost; g.fillRect(x + w + 10, y0, 6, sh);
    g.fillStyle = COL.yellow; g.fillRect(x + w + 10, y0 + q * sh * (1 - fit / n), 6, (sh * fit) / n);
  }
  text(g, `TEAM ${L.s.toFixed(1)}`, x + w, 990, 22, COL.dim, { align: 'right', spacing: 2 });
  msgStrip(g, Q, app, x, 948, 820);
  footer(g, app, `{menu} Choose   {start} ${Q.mark ? 'Swap' : 'Pick'}   {change} Formation   {back} ${Q.mark ? 'Cancel' : 'Office'}`, t);
}

// ---------- the table ----------
function leagueTable(g, C, d, x, y, w, { rh = 76, you = C?.club } = {}) {
  const t1 = career.table(C, d), size = rh > 60 ? 30 : 24;
  const cols = [['P', 'p'], ['W', 'w'], ['D', 'd'], ['L', 'l'], ['F', 'gf'], ['A', 'ga'], ['GD', 'gd'], ['PTS', 'pts']];
  const cw = rh > 60 ? 74 : 60, cx0 = x + w - cols.length * cw - (rh > 60 ? 190 : 20);
  cols.forEach(([l], k) => text(g, l, cx0 + k * cw + cw / 2, y - 14, 19, COL.faint, { align: 'center', spacing: 2 }));
  if (rh > 60) text(g, 'FORM', x + w - 100, y - 14, 19, COL.faint, { align: 'center', spacing: 2 });
  t1.forEach((r, k) => {
    const yy = y + k * rh, me = r.id === you;
    const zone = d === 1 ? (k === 0 ? COL.yellow : k >= 6 ? COL.down : null) : k < 2 ? COL.up : null;
    rr(g, x, yy, w, rh - 8, 5);
    g.fillStyle = me ? 'rgba(255,210,63,0.22)' : 'rgba(13,27,42,0.78)'; g.fill();
    if (me) { g.strokeStyle = COL.yellow; g.lineWidth = 3; g.stroke(); }
    if (zone) { g.fillStyle = zone; g.fillRect(x, yy, 8, rh - 8); }
    text(g, String(k + 1), x + 52, yy + rh / 2 + size * 0.3, size, zone ?? COL.dim, { wgt: 800, align: 'right' });
    clubLine(g, r.id, x + 66, yy, cx0 - x - 76, rh - 8, { you: me, size });
    cols.forEach(([, f], i) => text(g, f === 'gd' && r.gd > 0 ? `+${r.gd}` : String(r[f]), cx0 + i * cw + cw / 2, yy + rh / 2 + size * 0.3, size, f === 'pts' ? COL.yellow : COL.chalk, { wgt: f === 'pts' ? 800 : 500, align: 'center' }));
    if (rh > 60) r.form.forEach((f, i) => {
      const fx = x + w - 160 + i * 25, col = f === 'W' ? COL.ok : f === 'L' ? COL.down : COL.dim;
      g.fillStyle = col; rr(g, fx, yy + rh / 2 - 15, 21, 26, 3); g.fill();
      text(g, f, fx + 10.5, yy + rh / 2 + 5, 18, COL.ink, { wgt: 800, align: 'center' });
    });
  });
  return t1;
}
function tableScreen(g, app, t) {
  backdrop(g, t);
  const C = app.career;
  if (!C) return;
  const d = app.tableDiv ?? 1;
  header(g, app, 'LEAGUE TABLE', `${up(LEAGUE)} · AFTER ${C.results[d].filter(Boolean).length} OF 14 MATCHDAYS`);
  [1, 2].forEach((k, i) => button(g, 520 + i * 450, 178, 420, 64, DIV_SHORT[k], d === k, t, { tab: k }, { size: 28 }));
  panel(g, 200, 262, 1520, 730, { tab: false });
  leagueTable(g, C, d, 230, 320, 1460, { rh: 80 });
  const key = d === 1 ? [[COL.yellow, 'CHAMPIONS'], [COL.down, 'RELEGATED']] : [[COL.up, 'PROMOTED']];
  key.forEach(([col, l], k) => { g.fillStyle = col; g.fillRect(240 + k * 260, 966, 24, 14); text(g, l, 274 + k * 260, 981, 19, COL.dim, { spacing: 3 }); });
  footer(g, app, '{tabs} Division   {start} Office', t);
}

// ---------- fixtures ----------
function fixtures(g, app, t) {
  backdrop(g, t);
  const C = app.career;
  if (!C) return;
  const S = career.schedule(C), sel = Math.max(0, Math.min(S.length - 1, app.fixSel ?? 0));
  header(g, app, 'FIXTURES', `SEASON ${C.season} · ${DIV_SHORT[C.div[C.club]]} AND THE ${up(CUP)}`);
  panel(g, 60, 178, 900, 816, { tab: false });
  const rh = 44;
  S.forEach((e, k) => {
    const y = 192 + k * rh, s = k === sel, now = k === C.week;
    rr(g, 76, y, 868, rh - 5, 4);
    g.fillStyle = s ? 'rgba(255,210,63,0.92)' : now ? 'rgba(33,70,108,0.9)' : 'rgba(13,27,42,0.6)'; g.fill();
    const ink = s ? COL.ink : e.out ? COL.faint : COL.chalk;
    text(g, `${k + 1}`, 112, y + 29, 22, s ? COL.ink : COL.dim, { wgt: 800, align: 'right' });
    text(g, e.label, 130, y + 29, 21, s ? COL.ink : e.kind === 'cup' ? COL.yellow : COL.dim, { wgt: 800 });
    if (e.out) text(g, `${up(CUP)}: OUT`, 220, y + 29, 22, ink, { wgt: 500 });
    else if (!e.opp) text(g, 'TO BE DECIDED', 220, y + 29, 22, ink, { wgt: 500 });
    else {
      text(g, e.home ? 'H' : 'A', 222, y + 29, 22, s ? COL.ink : COL.dim, { wgt: 800 });
      shirt(g, kitOf(e.opp), 266, y + 19, 28);
      text(g, up(club(e.opp).name), 292, y + 29, 24, ink, { wgt: 700, max: 470 });
    }
    if (e.res) {
      const me = e.home ? 0 : 1, w = e.res.w === me ? 'W' : e.res.w === 1 - me ? 'L' : 'D';
      text(g, `${e.res.s[me]}–${e.res.s[1 - me]}${e.res.p ? ' P' : ''}`, 880, y + 29, 24, ink, { wgt: 800, align: 'right' });
      g.fillStyle = w === 'W' ? COL.ok : w === 'L' ? COL.down : COL.dim; rr(g, 896, y + 7, 34, 26, 4); g.fill();
      text(g, w, 913, y + 28, 20, COL.ink, { wgt: 800, align: 'center' });
    } else if (now) text(g, 'NEXT', 930, y + 29, 20, s ? COL.ink : COL.yellow, { wgt: 800, align: 'right', spacing: 2 });
    hot(76, y, 868, rh - 5, { i: k });
  });
  // the picked week across the division (or the cup round)
  const e = S[sel];
  panel(g, 1000, 178, 860, 816);
  if (e.kind === 'league') {
    const d = C.div[C.club];
    text(g, `MATCHDAY ${e.md + 1}`, 1040, 236, 36, COL.chalk, { wgt: 800 });
    text(g, DIV_SHORT[d], 1830, 236, 22, COL.dim, { align: 'right', spacing: 3 });
    career.matchday(C, d, e.md).forEach((m, k) => tie(g, C, m.home, m.away, m.res, 1040, 280 + k * 120, 780, 100));
  } else {
    text(g, up(career.ROUNDS[e.round]), 1040, 236, 36, COL.chalk, { wgt: 800 });
    text(g, up(CUP), 1830, 236, 22, COL.yellow, { align: 'right', spacing: 3 });
    const ties = career.cupTies(C, e.round), n = ties.length, rh2 = Math.min(100, 700 / n);
    ties.forEach(([h, a], k) => tie(g, C, h, a, C.cup.res[e.round][k], 1040, 280 + k * rh2, 780, rh2 - 10));
  }
  footer(g, app, '{menu} Week   {back} Office', t);
}
function tie(g, C, h, a, res, x, y, w, rh) {
  const me = h === C.club || a === C.club;
  rr(g, x, y, w, rh, 5);
  g.fillStyle = me ? 'rgba(255,210,63,0.18)' : 'rgba(13,27,42,0.7)'; g.fill();
  const size = Math.min(28, rh * 0.38);
  const name = (id, xx, align) => {
    if (!id) { text(g, 'TO BE DECIDED', xx, y + rh / 2 + size * 0.35, size * 0.85, COL.faint, { align }); return; }
    text(g, up(club(id).name), xx, y + rh / 2 + size * 0.35, size, id === C.club ? COL.yellow : COL.chalk, { wgt: 700, align, max: w / 2 - 130 });
  };
  if (h) shirt(g, kitOf(h), x + 30, y + rh / 2, rh * 0.5);
  if (a) shirt(g, kitOf(a), x + w - 30, y + rh / 2, rh * 0.5);
  name(h, x + w / 2 - 70, 'right');
  name(a, x + w / 2 + 70, 'left');
  text(g, res ? `${res.s[0]}–${res.s[1]}` : 'V', x + w / 2, y + rh / 2 + size * 0.35, size, res ? COL.yellow : COL.faint, { wgt: 800, align: 'center' });
  if (res?.p) text(g, `${res.p[0]}–${res.p[1]} PENS`, x + w / 2, y + rh - 6, 15, COL.dim, { align: 'center', spacing: 1 });
}

// ---------- the cup ----------
function cup(g, app, t) {
  backdrop(g, t);
  const C = app.career;
  if (!C) return;
  const stage = career.cupStage(C, C.club), winner = career.cupWinner(C);
  header(g, app, up(CUP), `ALL SIXTEEN CLUBS · ONE MATCH A TIE · ${stage >= 0 ? up(career.stageName(stage)) : 'STILL IN IT'}`);
  const colX = [60, 500, 900, 1260], bw = [400, 360, 320, 300], top = 186, span = 800;
  const at = (r, k) => top + ((k + 0.5) * span) / (8 >> r);
  for (let r = 0; r < 4; r++) {
    const ties = career.cupTies(C, r);
    text(g, up(career.ROUNDS[r]), colX[r] + bw[r] / 2, top - 4, 20, COL.dim, { align: 'center', spacing: 3 });
    ties.forEach(([h, a], k) => {
      const cy = at(r, k), bh = 78, x = colX[r], y = cy - bh / 2, w = bw[r], res = C.cup.res[r][k];
      // the lines on to the next round
      if (r < 3) {
        const nx = colX[r + 1], ny = at(r + 1, k >> 1);
        g.strokeStyle = 'rgba(244,241,232,0.3)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x + w, cy); g.lineTo(x + w + (nx - x - w) / 2, cy); g.lineTo(x + w + (nx - x - w) / 2, ny); g.lineTo(nx, ny); g.stroke();
      }
      const mine = h === C.club || a === C.club;
      panel(g, x, y, w, bh, { tab: false, a: 0.9, edge: mine ? COL.yellow : null, lw: 3 });
      [[h, 0], [a, 1]].forEach(([id, s]) => {
        const yy = y + 10 + s * 32, won = res && res.w === s, lost = res && res.w !== s;
        if (id) shirt(g, kitOf(id), x + 24, yy + 14, 24);
        text(g, id ? up(club(id).name) : '—', x + 44, yy + 24, 23, id === C.club ? COL.yellow : lost ? COL.faint : COL.chalk, { wgt: won ? 800 : 500, max: w - 110 });
        if (res) text(g, `${res.s[s]}${res.p ? ` (${res.p[s]})` : ''}`, x + w - 14, yy + 24, 23, won ? COL.yellow : COL.dim, { wgt: 800, align: 'right' });
      });
    });
  }
  // the trophy, and whoever holds it
  const tx = 1700, ty = 520;
  trophy(g, tx, ty, 1.15, t);
  text(g, winner ? up(club(winner).name) : 'THE LANTERN', tx, ty + 210, 32, winner ? COL.yellow : COL.dim, { wgt: 800, align: 'center', max: 320 });
  text(g, winner ? 'WINNERS' : 'TO BE WON', tx, ty + 244, 20, COL.dim, { align: 'center', spacing: 4 });
  footer(g, app, '{start} Office', t);
}
/** the Lantern Cup: a lantern-topped silver pot on a plinth */
function trophy(g, x, y, s, t) {
  g.save();
  g.translate(x, y); g.scale(s, s);
  const glow = g.createRadialGradient(0, -110, 0, 0, -110, 90);
  glow.addColorStop(0, `rgba(255,210,63,${0.35 + Math.sin(t * 3) * 0.1})`); glow.addColorStop(1, 'rgba(255,210,63,0)');
  g.fillStyle = glow; g.fillRect(-100, -210, 200, 200);
  const silver = g.createLinearGradient(-70, 0, 70, 0);
  silver.addColorStop(0, '#7d8790'); silver.addColorStop(0.35, '#f3f6f8'); silver.addColorStop(0.6, '#b7c0c8'); silver.addColorStop(1, '#5e6870');
  // plinth
  g.fillStyle = '#3b2a1a'; g.fillRect(-60, 110, 120, 50);
  g.fillStyle = COL.yellow; g.fillRect(-46, 124, 92, 8);
  // stem and bowl
  g.fillStyle = silver;
  g.beginPath(); g.moveTo(-40, 110); g.lineTo(40, 110); g.lineTo(14, 60); g.lineTo(-14, 60); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-70, -40); g.quadraticCurveTo(-70, 60, 0, 66); g.quadraticCurveTo(70, 60, 70, -40); g.closePath(); g.fill();
  // handles
  g.strokeStyle = silver; g.lineWidth = 10;
  g.beginPath(); g.arc(-74, 0, 26, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
  g.beginPath(); g.arc(74, 0, 26, -Math.PI * 0.5, Math.PI * 0.5); g.stroke();
  // the lantern on the lid
  g.fillStyle = silver; g.fillRect(-36, -52, 72, 12);
  g.fillStyle = 'rgba(255,214,90,0.95)'; g.fillRect(-20, -110, 40, 58);
  g.strokeStyle = '#d7dee4'; g.lineWidth = 4; g.strokeRect(-20, -110, 40, 58);
  g.beginPath(); g.moveTo(0, -110); g.lineTo(0, -52); g.stroke();
  g.fillStyle = silver; g.beginPath(); g.moveTo(-28, -110); g.lineTo(28, -110); g.lineTo(0, -138); g.closePath(); g.fill();
  g.restore();
}

// ---------- transfers ----------
const TAB_LABEL = { GK: 'BUY KEEPERS', DF: 'BUY DEFENDERS', MF: 'BUY MIDFIELD', FW: 'BUY FORWARDS', SELL: 'SELL' };
function transfers(g, app, t) {
  backdrop(g, t);
  const C = app.career;
  if (!C) return;
  const T = app.transfers ?? { tab: 0, rows: [], sel: 0 }, tabs = ['GK', 'DF', 'MF', 'FW', 'SELL'], tab = tabs[T.tab] ?? 'GK', selling = tab === 'SELL';
  header(g, app, 'TRANSFERS', `SQUAD ${career.squad(C, C.club).length} OF ${SQUAD_MAX} · WAGES ${money(career.wagesOf(C))} A WEEK`);
  tabs.forEach((k, i) => button(g, 60 + i * 362, 176, 346, 62, TAB_LABEL[k], i === T.tab, t, { tab: i }, { size: 27 }));
  const x = 60, w = 1800, y0 = 290, rh = 66, fit = 9, rows = T.rows ?? [], n = rows.length;
  const first = Math.max(0, Math.min((T.sel ?? 0) - fit + 2, n - fit));
  text(g, 'PLAYER', x + 110, y0 - 12, 18, COL.faint, { spacing: 2 });
  text(g, selling ? '' : 'CLUB', x + 560, y0 - 12, 18, COL.faint, { spacing: 2 });
  ATTR.forEach(([, l], k) => text(g, l, x + 830 + k * 72, y0 - 12, 18, COL.faint, { align: 'center', spacing: 1 }));
  text(g, 'RATING', x + 1200, y0 - 12, 18, COL.faint, { spacing: 2 });
  text(g, selling ? 'OFFER' : 'PRICE', x + 1570, y0 - 12, 18, COL.faint, { align: 'right', spacing: 2 });
  for (let j = 0; j < Math.min(fit, n); j++) {
    const k = first + j, r = rows[k], p = r.p, y = y0 + j * (rh + 6), sel = k === T.sel;
    rr(g, x, y, w, rh, 6);
    g.fillStyle = sel ? 'rgba(255,210,63,0.92)' : 'rgba(13,27,42,0.8)'; g.fill();
    hot(x, y, w - 230, rh, { i: k });
    const ink = sel ? COL.ink : COL.chalk, dim = sel ? 'rgba(13,27,42,0.7)' : COL.dim;
    const kit = selling ? kitOf(C.club) : kitOf(r.club);
    shirt(g, kit, x + 50, y + rh / 2, 46, { num: p.num });
    text(g, up(p.name) + (p.star ? ' ★' : ''), x + 110, y + 31, 29, ink, { wgt: 800, max: 330 });
    text(g, `${p.pos}${selling && r.xi ? ' · IN THE ELEVEN' : ''}`, x + 110, y + 56, 19, dim, { spacing: 2 });
    if (!selling) {
      text(g, up(club(r.club).name), x + 560, y + 31, 24, ink, { wgt: 700, max: 230 });
      text(g, DIV_SHORT[C.div[r.club]], x + 560, y + 56, 17, dim, { spacing: 2 });
    }
    ATTR.forEach(([a], i) => text(g, String(p[a]), x + 830 + i * 72, y + 43, 28, p[a] >= 8 ? (sel ? '#7a4b00' : COL.yellow) : ink, { wgt: p[a] >= 8 ? 800 : 500, align: 'center' }));
    stars(g, overall(p) / 1.8, x + 1200, y + rh / 2, 26, sel ? COL.ink : COL.yellow);
    text(g, money(r.price), x + 1570, y + 40, 32, r.can ? (sel ? COL.ink : COL.yellow) : sel ? '#8a1020' : COL.down, { wgt: 800, align: 'right' });
    button(g, x + w - 210, y + 9, 196, rh - 18, selling ? 'SELL' : 'BUY', sel && r.can, t, { i: k, act: true }, { size: 26, col: r.can ? COL.yellow : '#6b7280' });
    if (sel && !r.can && r.why) text(g, up(r.why), x + 1570, y + 62, 15, '#8a1020', { wgt: 800, align: 'right', spacing: 1, max: 300 });
  }
  if (!n) text(g, 'NOBODY HERE', W / 2, 500, 40, COL.dim, { wgt: 800, align: 'center' });
  if (n > fit) {
    const sh = fit * (rh + 6), q = first / (n - fit);
    g.fillStyle = COL.ghost; g.fillRect(x + w + 12, y0, 6, sh);
    g.fillStyle = COL.yellow; g.fillRect(x + w + 12, y0 + q * sh * (1 - fit / n), 6, (sh * fit) / n);
  }
  msgStrip(g, T, app, 280, 945, 1360);
  footer(g, app, `{tabs} ${selling ? 'Buy' : 'Position'}   {menu} Choose   {start} ${selling ? 'Sell' : 'Buy'}   {back} Office`, t);
}

// ---------- the line-ups before kick-off ----------
function lineupPanel(g, team, x, y, w, h, you, t) {
  panel(g, x, y, w, h, { tab: false, edge: you ? COL.yellow : null, lw: 3 });
  shirt(g, team.kit, x + 90, y + 100, 110, { shorts: true });
  text(g, up(team.name), x + 170, y + 82, 40, you ? COL.yellow : COL.chalk, { wgt: 800, max: w - 200 });
  text(g, `${team.formation}${you ? ' · YOU' : ''}`, x + 172, y + 120, 24, COL.dim, { spacing: 3 });
  const ps = team.players ?? [];
  const avg = ps.length ? ps.reduce((s, p) => s + overall(p), 0) / ps.length : 0;
  stars(g, starsOf(avg + 0.6), x + 172, y + 152, 26);
  formation(g, slotsOf(team.formation), x + 30, y + 210, w - 60, h - 240, { kit: team.kit, gk: team.gk, labels: ps.map(p => up(p.name)), nums: ps.map(p => p.num), size: 0.9, t });
}
function prematch(g, app, t) {
  backdrop(g, t);
  const P = app.pre;
  if (!P) return;
  const [home, away] = P.teams;
  header(g, app, up(P.label?.split(' · ').slice(-1)[0] ?? 'KICK OFF'), up(P.label?.includes(' · ') ? P.label.split(' · ')[0] : P.label) + (P.knockout ? ' · EXTRA TIME AND PENALTIES IF LEVEL' : ''));
  lineupPanel(g, home, 60, 180, 860, 810, P.human === 0, t);
  lineupPanel(g, away, 1000, 180, 860, 810, P.human === 1, t);
  text(g, 'V', W / 2, 560, 64, COL.yellow, { wgt: 800, align: 'center', italic: true, shadow: true });
  button(g, W / 2 - 230, 1016, 460, 58, 'KICK OFF', true, t, { go: true }, { size: 30 });
  prompt(g, app, '{start} Kick off', W / 2 + 380, 1056, 24);
  button(g, 30, 1020, 200, 52, '◀ BACK', false, t, { back: true }, { size: 26 });
}

// ---------- over the frozen match: pause, half time, full time ----------
function dim(g, a = 0.5) { g.fillStyle = `rgba(4,12,8,${a})`; g.fillRect(0, 0, W, H); }
function scoreStrap(g, app, y) {
  const m = app.match, s = m?.s, teams = app.teams ?? [];
  const sc = s?.score ?? [0, 0], pens = s?.pens ?? app.result?.pens ?? null;
  const cx = W / 2, w = 900, h = 96, x = cx - w / 2;
  panel(g, x, y, w, h, { tab: false });
  [0, 1].forEach(k => {
    const tm = teams[k], dir = k ? 1 : -1;
    if (!tm) return;
    shirt(g, tm.kit, cx + dir * 390, y + h / 2, 64);
    text(g, up(tm.short), cx + dir * 300, y + 66, 46, app.human === k ? COL.yellow : COL.chalk, { wgt: 800, align: 'center' });
  });
  g.fillStyle = COL.yellow; rr(g, cx - 130, y + 8, 260, h - 16, 6); g.fill();
  text(g, `${sc[0]} – ${sc[1]}`, cx, y + 70, 62, COL.ink, { wgt: 800, align: 'center' });
  if (pens) text(g, `${pens[0]} – ${pens[1]} ON PENALTIES`, cx, y + h + 34, 24, COL.yellow, { wgt: 800, align: 'center', spacing: 3 });
  // the names under the strap
  [0, 1].forEach(k => teams[k] && text(g, up(teams[k].name), cx + (k ? 1 : -1) * 250, y - 14, 22, COL.dim, { align: 'center', spacing: 2, max: 380 }));
}
function scorers(g, app, x, y, w) {
  const r = app.result ?? safe(() => app.match?.result?.());
  const list = r?.scorers ?? [];
  [0, 1].forEach(k => {
    // one line a scorer, his minutes after his name
    const by = new Map();
    for (const sc of list.filter(q => q.team === k)) {
      const key = `${sc.name}${sc.own ? ' (OG)' : ''}`;
      by.set(key, [...(by.get(key) ?? []), `${sc.minute}'${sc.pen ? ' P' : ''}`]);
    }
    [...by].slice(0, 5).forEach(([name, mins], j) => {
      text(g, `${up(name)} ${mins.join(' ')}`, x + w / 2 + (k ? 60 : -60), y + j * 34, 24, COL.chalk, { wgt: 500, align: k ? 'left' : 'right', max: w / 2 - 80 });
    });
  });
  if (list.length) { g.fillStyle = COL.yellow; g.beginPath(); g.arc(x + w / 2, y - 8, 7, 0, TAU); g.fill(); }
}
function statsBlock(g, app, x, y, w) {
  const st = app.match?.s?.stats;
  if (!st) return;
  const rows = [
    ['POSSESSION', st.possession, v => pct(v)],
    ['SHOTS', st.shots, v => String(v ?? 0)],
    ['ON TARGET', st.onTarget, v => String(v ?? 0)],
    ['CORNERS', st.corners, v => String(v ?? 0)],
    ['FOULS', st.fouls, v => String(v ?? 0)],
  ];
  rows.forEach(([l, v, f], k) => {
    if (!v) return;
    const yy = y + k * 46, a = +v[0] || 0, b = +v[1] || 0, q = a + b > 0 ? a / (a + b) : 0.5;
    text(g, f(v[0]), x, yy + 8, 26, COL.chalk, { wgt: 800 });
    text(g, f(v[1]), x + w, yy + 8, 26, COL.chalk, { wgt: 800, align: 'right' });
    text(g, l, x + w / 2, yy - 6, 17, COL.dim, { align: 'center', spacing: 3 });
    const bx = x + 90, bw = w - 180;
    g.fillStyle = app.teams?.[0]?.kit?.shirt ?? COL.chalk; g.fillRect(bx, yy, bw * q, 10);
    g.fillStyle = app.teams?.[1]?.kit?.shirt ?? COL.dim; g.fillRect(bx + bw * q, yy, bw * (1 - q), 10);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(bx, yy, bw, 10);
  });
}
function pause(g, app, t) {
  dim(g, 0.55);
  scoreStrap(g, app, 150);
  panel(g, 610, 320, 700, 560);
  text(g, 'PAUSED', W / 2, 420, 80, COL.chalk, { wgt: 800, align: 'center', spacing: 8, shadow: true });
  const items = app.pauseItems?.() ?? ['resume'];
  const label = { resume: 'RESUME', sound: `SOUND ${app.soundOn ? 'ON' : 'OFF'}`, quit: 'QUIT THE MATCH', forfeit: 'FORFEIT' };
  items.forEach((it, k) => button(g, 710, 480 + k * 100, 500, 76, label[it] ?? up(it), k === (app.pauseMenu ?? 0), t, { i: k }, { size: 34 }));
  const it = items[app.pauseMenu ?? 0];
  if (it === 'forfeit') text(g, 'FORFEIT: THE MATCH GOES DOWN AS A 3–0 DEFEAT', W / 2, 850, 22, COL.red, { align: 'center', spacing: 2 });
  if (it === 'quit') text(g, 'BACK TO THE FRIENDLY PICKER', W / 2, 850, 22, COL.dim, { align: 'center', spacing: 2 });
  prompt(g, app, '{menu} Choose   {start} Select   {pause} Resume', W / 2, 960, 26, COL.chalk);
}
function breakPanel(g, app, t) {
  const m = app.match, s = m?.s ?? {}, full = app.state === 'fulltime', done = !!m?.done;
  dim(g, 0.5);
  const a = ease(clamp01(app.stT * 3));
  g.save();
  g.globalAlpha = a;
  g.translate(0, (1 - a) * 30);
  const level = s.score && s.score[0] === s.score[1];
  const head = !full ? (s.half === 2 ? 'FULL TIME: EXTRA TIME NEXT' : s.half >= 3 ? 'EXTRA TIME: HALF TIME' : 'HALF TIME') : done ? (s.pens || app.result?.pens ? 'AFTER PENALTIES' : s.half >= 3 ? 'AFTER EXTRA TIME' : 'FULL TIME') : level ? 'FULL TIME: EXTRA TIME NEXT' : 'FULL TIME';
  // the caption tab
  const tw = measure(g, head, 50, 800, 6) + 120;
  g.beginPath(); g.moveTo(W / 2 - tw / 2 + 20, 120); g.lineTo(W / 2 + tw / 2 + 20, 120); g.lineTo(W / 2 + tw / 2 - 20, 186); g.lineTo(W / 2 - tw / 2 - 20, 186); g.closePath();
  g.fillStyle = COL.yellow; g.fill();
  text(g, head, W / 2, 171, 50, COL.ink, { wgt: 800, align: 'center', spacing: 6 });
  scoreStrap(g, app, 236);
  panel(g, 460, 380, 1000, 520, { tab: false });
  scorers(g, app, 480, 440, 960);
  statsBlock(g, app, 560, 650, 800);
  if (app.label) text(g, up(app.label), W / 2, 880, 20, COL.dim, { align: 'center', spacing: 3 });
  // the verdict for the side you play
  if (full && app.human >= 0) {
    const r = app.result ?? safe(() => m.result());
    const w = r?.winner, me = app.human;
    const word = w === me ? 'VICTORY' : w === 1 - me ? 'DEFEAT' : 'A DRAW';
    text(g, word, W / 2, 960, 52, w === me ? COL.ok : w === 1 - me ? COL.down : COL.chalk, { wgt: 800, align: 'center', spacing: 8, shadow: true });
  }
  g.restore();
  const next = !full ? (s.half === 2 ? 'Extra time' : 'Second half') : 'Continue';
  button(g, W / 2 - 200, 1000, 400, 64, up(next), true, t, { go: true }, { size: 30 });
  if (app.stT > 0.5) prompt(g, app, `{start} ${next}`, W / 2 + 420, 1042, 24, blink(t, 1.5) ? COL.yellow : COL.chalk, 'left');
}

// ---------- the season's end ----------
function season(g, app, t) {
  backdrop(g, t);
  const S = app.summary, C = app.career;
  if (!S || !C) return;
  const you = C.club;
  header(g, app, `SEASON ${S.season}: FINAL TABLE`, `${DIV_SHORT[S.div]} · ${nth(S.pos)} WITH ${S.played?.pts ?? 0} POINTS`);
  panel(g, 60, 180, 1080, 820, { tab: false });
  // the final table as it stood (from the summary: the new season has begun)
  const rows = S.tables[S.div], rh = 84, x = 90, w = 1020, y0 = 240;
  const cols = [['P', 'p'], ['W', 'w'], ['D', 'd'], ['L', 'l'], ['GD', 'gd'], ['PTS', 'pts']], cw = 76, cx0 = x + w - cols.length * cw;
  cols.forEach(([l], k) => text(g, l, cx0 + k * cw + cw / 2, y0 - 14, 19, COL.faint, { align: 'center', spacing: 2 }));
  rows.forEach((r, k) => {
    const y = y0 + k * rh, me = r.id === you;
    const zone = S.div === 1 ? (k === 0 ? COL.yellow : S.relegated.includes(r.id) ? COL.down : null) : S.promoted.includes(r.id) ? COL.up : null;
    rr(g, x, y, w, rh - 10, 5);
    g.fillStyle = me ? 'rgba(255,210,63,0.22)' : 'rgba(13,27,42,0.78)'; g.fill();
    if (me) { g.strokeStyle = COL.yellow; g.lineWidth = 3; g.stroke(); }
    if (zone) { g.fillStyle = zone; g.fillRect(x, y, 8, rh - 10); }
    text(g, String(k + 1), x + 50, y + 48, 30, zone ?? COL.dim, { wgt: 800, align: 'right' });
    clubLine(g, r.id, x + 64, y, cx0 - x - 70, rh - 10, { you: me });
    cols.forEach(([, f], i) => text(g, f === 'gd' && r.gd > 0 ? `+${r.gd}` : String(r[f]), cx0 + i * cw + cw / 2, y + 48, 30, f === 'pts' ? COL.yellow : COL.chalk, { wgt: f === 'pts' ? 800 : 500, align: 'center' }));
  });
  // the verdict
  panel(g, 1180, 180, 680, 820);
  const big = S.title ? 'CHAMPIONS!' : S.up ? 'PROMOTED!' : S.down ? 'RELEGATED' : `${nth(S.pos)} PLACE`;
  const col = S.title ? COL.yellow : S.up ? COL.up : S.down ? COL.down : COL.chalk;
  const a = ease(clamp01(app.stT * 2));
  text(g, big, 1520, 290, 84 + (1 - a) * 30, col, { wgt: 800, align: 'center', italic: true, shadow: true, max: 620 });
  const lines = [
    ...S.honours.filter(h => !/^(Promoted|Relegated|League champions)$|Cup/.test(h)).map(h => [up(h), COL.yellow]),
    [`${up(CUP)}: ${up(career.stageName(S.cupStage))}`, S.cupStage === 4 ? COL.yellow : COL.chalk],
    [`LEAGUE CHAMPIONS: ${up(club(S.champion).name)}`, COL.dim],
    [`UP: ${S.promoted.map(id => up(club(id).short)).join(', ')} · DOWN: ${S.relegated.map(id => up(club(id).short)).join(', ')}`, COL.dim],
    [`CUP WINNERS: ${up(club(S.cup).name)}`, COL.dim],
  ];
  lines.slice(0, 5).forEach(([s, c], k) => text(g, s, 1220, 376 + k * 44, 26, c, { wgt: 700, max: 600 }));
  // the money
  const M = S.money ?? {};
  const cash = [
    ['PRIZE MONEY', `+${money(S.prize)}`], ['CUP MONEY', `+${money(S.cupPrize)}`], ['GATE RECEIPTS', `+${money(M.gate)}`],
    ['WAGES', `−${money(M.wages)}`], ['TRANSFERS', `${(M.sold ?? 0) - (M.bought ?? 0) >= 0 ? '+' : ''}${money((M.sold ?? 0) - (M.bought ?? 0))}`],
  ];
  cash.forEach(([l, v], k) => {
    const y = 640 + k * 42;
    text(g, l, 1220, y, 24, COL.dim, { spacing: 2 });
    text(g, v, 1820, y, 28, v.startsWith('−') ? COL.down : COL.chalk, { wgt: 800, align: 'right' });
  });
  g.fillStyle = COL.faint; g.fillRect(1220, 868, 600, 2);
  text(g, 'BUDGET', 1220, 912, 28, COL.yellow, { spacing: 3 });
  text(g, money(M.end), 1820, 914, 40, COL.yellow, { wgt: 800, align: 'right' });
  footer(g, app, app.stT > 0.8 ? '{start} Continue' : '', t, false);
  if (app.stT > 0.8) button(g, 1400, 1016, 380, 58, `ON TO SEASON ${S.season + 1}`, true, t, { go: true }, { size: 28 });
}

// ---------- the title won ----------
function confetti(g, t, cols) {
  for (let i = 0; i < 160; i++) {
    const s1 = ((i * 7919) % 1000) / 1000, s2 = ((i * 104729) % 1000) / 1000, s3 = ((i * 1299709) % 1000) / 1000;
    const fall = 60 + s2 * 120, y = ((t * fall + s3 * 1300) % 1300) - 100, x = s1 * W + Math.sin(t * (1 + s2) + i) * 40;
    g.save(); g.translate(x, y); g.rotate(t * (2 + s3 * 4) + i);
    g.fillStyle = cols[i % cols.length]; g.fillRect(-8, -4, 16, 8);
    g.restore();
  }
}
function won(g, app, t) {
  backdrop(g, t, { dark: 0.6 });
  const C = app.career, S = app.summary;
  if (!C) return;
  const c = club(C.club), k = app.stT ?? 9, a = clamp01((k - 0.3) * 0.9);
  confetti(g, t, [c.kit.home.shirt, c.kit.home.trim, COL.yellow, COL.chalk]);
  trophy(g, W / 2, 560, 1.6, t);
  g.globalAlpha = a;
  text(g, 'CHAMPIONS', W / 2, 240, 170, COL.yellow, { wgt: 800, align: 'center', italic: true, spacing: 10, shadow: true });
  text(g, `${up(c.name)} ARE THE ${up(LEAGUE)} CHAMPIONS`, W / 2, 310, 38, COL.chalk, { wgt: 800, align: 'center', spacing: 3, shadow: true, max: 1700 });
  g.globalAlpha = clamp01((k - 1.2) * 1.2);
  panel(g, 560, 860, 800, 120, { tab: false });
  [['SEASONS', String(C.champion || S?.season || 1)], ['POINTS', String(S?.played?.pts ?? 0)], ['BUDGET', money(C.budget)]].forEach(([l, v], j) => {
    const x = 690 + j * 270;
    text(g, l, x, 900, 21, COL.dim, { align: 'center', spacing: 4 });
    text(g, v, x, 952, 44, COL.chalk, { wgt: 800, align: 'center' });
  });
  g.globalAlpha = 1;
  shirt(g, c.kit.home, 380, 640, 200, { shorts: true });
  shirt(g, c.kit.home, 1540, 640, 200, { shorts: true });
  if (k > 2.5) { prompt(g, app, '{start} Continue', W / 2, 1050, 28, blink(t) ? COL.yellow : COL.chalk); hot(0, 0, W, H, { go: true }); }
}

// ---------- the initials, and the honours ----------
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
function entry(g, app, t) {
  backdrop(g, t);
  const C = app.career, E = app.entry ?? { letters: [0, 0, 0], pos: 0 };
  panel(g, 510, 140, 900, 800);
  text(g, 'HONOURS', W / 2, 250, 76, COL.yellow, { wgt: 800, align: 'center', spacing: 8, shadow: true });
  text(g, `CHAMPIONS IN ${C?.champion ?? 1} SEASON${(C?.champion ?? 1) === 1 ? '' : 'S'} WITH ${up(club(C?.club).name)}`, W / 2, 310, 28, COL.chalk, { align: 'center', spacing: 2, max: 820 });
  text(g, 'YOUR INITIALS', W / 2, 390, 24, COL.dim, { align: 'center', spacing: 5 });
  for (let k = 0; k < 3; k++) {
    const x = W / 2 + (k - 1) * 190, sel = k === E.pos;
    panel(g, x - 75, 440, 150, 200, { tab: false, edge: sel ? COL.yellow : 'rgba(244,241,232,0.15)', lw: sel ? 4 : 2 });
    text(g, LETTERS[E.letters[k]] ?? 'A', x, 590, 130, sel ? COL.yellow : COL.chalk, { wgt: 800, align: 'center' });
    hot(x - 75, 440, 150, 200, { letter: k });
    for (const d of [1, -1]) {
      const cy = d > 0 ? 418 : 666;
      g.fillStyle = sel ? COL.yellow : COL.faint;
      g.beginPath(); g.moveTo(x - 26, cy + d * 12); g.lineTo(x + 26, cy + d * 12); g.lineTo(x, cy - d * 16); g.closePath(); g.fill();
      hot(x - 75, d > 0 ? 380 : 645, 150, 58, { letter: k, d });
    }
  }
  button(g, W / 2 - 200, 750, 400, 76, 'SIGN', true, t, { done: true }, { size: 36 });
  prompt(g, app, '{letters} Letters   {kick} Next   {start} Done', W / 2, 890, 26, COL.dim);
}
function honours(g, app, t) {
  backdrop(g, t);
  // a header of its own: the honours aren't one career's
  const gr = g.createLinearGradient(0, 0, 0, 150);
  gr.addColorStop(0, 'rgba(6,14,24,0.96)'); gr.addColorStop(1, 'rgba(10,24,40,0.9)');
  g.fillStyle = gr; g.fillRect(0, 0, W, 150); g.fillStyle = COL.yellow; g.fillRect(0, 150, W, 4);
  text(g, 'HONOURS', 70, 92, 64, COL.yellow, { wgt: 800, spacing: 4 });
  text(g, `THE MANAGERS WHO WON THE ${up(DIVISIONS[1])}: FEWEST SEASONS FIRST`, 72, 132, 24, COL.dim, { spacing: 3 });
  const C = app.career, wide = !C?.history?.length;
  const x = wide ? 460 : 70, w = 1000;
  panel(g, x, 190, w, 800, { tab: false });
  const head = [['MANAGER', x + 150, 'left'], ['CLUB', x + 420, 'left'], ['SEASONS', x + 760, 'right'], ['PTS', x + 930, 'right']];
  head.forEach(([l, hx, al]) => text(g, l, hx, 250, 22, COL.dim, { spacing: 4, align: al }));
  (app.hof ?? []).slice(0, 8).forEach((e, k) => {
    const y = 330 + k * 82, hl = k === app.hofRank, col = hl ? (blink(t, 4) ? COL.yellow : COL.chalk) : COL.chalk;
    if (hl) { g.fillStyle = COL.yellow; g.fillRect(x + 20, y - 50, 10, 64); }
    text(g, `${k + 1}`, x + 100, y, 42, k === 0 ? COL.yellow : COL.dim, { wgt: 800, align: 'right' });
    text(g, e.n, x + 150, y, 52, col, { wgt: 800, spacing: 8 });
    const cl = CLUBS.find(c => c.short === e.c);
    if (cl) shirt(g, cl.kit.home, x + 445, y - 16, 44);
    text(g, e.c ?? '', x + 480, y, 38, col, { wgt: 700 });
    text(g, String(e.s), x + 760, y, 44, col, { wgt: 800, align: 'right' });
    text(g, String(e.pts ?? ''), x + 930, y, 36, k === 0 ? COL.yellow : COL.dim, { wgt: 700, align: 'right' });
  });
  // the open career's record, season by season
  if (!wide) {
    panel(g, 1110, 190, 750, 800);
    text(g, up(club(C.club).name), 1150, 250, 34, COL.yellow, { wgt: 800, max: 670 });
    const list = C.history.slice(-10);
    list.forEach((h, k) => {
      const y = 306 + k * 68;
      text(g, `S${h.season}`, 1150, y, 26, COL.dim, { wgt: 800 });
      text(g, `${DIV_SHORT[h.div]} · ${nth(h.pos)}`, 1220, y, 26, h.div === 1 && h.pos === 1 ? COL.yellow : COL.chalk, { wgt: 700, max: 380 });
      text(g, `CUP: ${up(career.stageName(h.cup))}`, 1830, y, 20, h.cup === 4 ? COL.yellow : COL.dim, { align: 'right', max: 230 });
      const note = (h.honours ?? []).filter(x => !/Cup/.test(x)).join(' · ');
      if (note) text(g, up(note), 1220, y + 28, 19, COL.yellow, { spacing: 1, max: 610 });
    });
  }
  footer(g, app, `{start} ${app.hofBack === 'hub' ? 'Office' : 'Title'}`, t);
}

const SCREENS = {
  title, options, friendly, clubs, hub, squad: squadScreen, table: tableScreen, fixtures, cup, transfers, prematch,
  pause, halftime: breakPanel, fulltime: breakPanel, season, won, entry, honours,
};

/** the screen for app.state, in 1920 × 1080 space (nothing over a live match or the demo) */
export function drawScreen(g, app, t = app?.t ?? 0) {
  beginHits(app?.state);
  const fn = SCREENS[app?.state];
  if (!fn) return;
  g.save();
  try { fn(g, app, t); } finally { g.restore(); }
}
/** 1920 × 1080 coordinates → what the screen drew there for a tap */
export function screenAt(app, x, y) {
  const h = hitAt(app?.state, x, y);
  // a slot on the squad's pitch is its row in the list
  if (h?.slotTap) return { i: h.slot + 2 };
  return h;
}
