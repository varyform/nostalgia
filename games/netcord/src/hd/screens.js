// The screens around the match: the title, creating or picking a player, the tour's hub with
// its calendar, the draw, the rankings and the player's training, the prematch, exhibitions
// and practice, the options, the panels over a frozen match (pause, changeover, result), the
// trophies, the season's review, initials for the records and the records themselves. 90s TV
// tennis graphics (hd/ui.js). Everything is drawn in a 1920 × 1080 space (the renderer scales
// the context) and whatever can be tapped records its rectangle as it is drawn, so screenAt()
// answers with what the screen showed there:
// { i } | { back } | { go } | { act } | { d, row } | { letter, d? } | { done }.
//
//   drawScreen(g, app, t)    nothing for 'match' / 'practice' / 'demo'; a panel over the court
//                            for 'pause' / 'changeover' / 'result'; a full screen otherwise
//   screenAt(app, x, y)      1920 × 1080 coordinates → the hit, or null
import { savedAgo } from '@nostalgia/save';
import { CAMERAS, CREATE_ROWS, DRAW_ITEMS, LETTERS, SETS } from '../app.js';
import { KITS, NATIONS, NATION_CODES, PLAYERS, RATINGS, RATING_LABEL, STYLES, STYLE_LABEL, SURFACE_LABEL, TOUR, VENUES, overall, playerById, venueById } from '../players.js';
import * as tour from '../tour.js';
import { COL, H, LOGO, SURFACE_TINT, TAU, W, alpha, arrows, backdrop, ball, beginHits, blink, button, clamp01, ease, figure, flag, hitAt, hot, measure, panel, pips, prompt, rr, shade, stars, strap, text, wrap } from './ui.js';

const up = s => String(s ?? '').toUpperCase();
const money = n => tour.money(n);
const fmt = n => Math.round(n || 0).toLocaleString('en-US');
const starsOf = p => clamp01((overall(p) - 3) / 5.5) * 5;
const CAMERA_LABEL = { tv: 'TV', behind: 'BEHIND', side: 'SIDE', high: 'OVERHEAD', umpire: 'UMPIRE' };
const SIDE = ['PLAYER 1', 'PLAYER 2', 'WATCH'];
const STYLE_SHORT = { baseline: 'BASELINE', 'serve-volley': 'SERVE-VOLLEY', 'all-round': 'ALL-ROUND', counter: 'COUNTER' };
function safe(fn, dflt = null) { try { return fn() ?? dflt; } catch { return dflt; } }
const T_ = app => app.tour;
const who = (app, id) => (app.tour ? tour.playerOf(app.tour, id) : playerById(id)) ?? { id, short: '???', name: '???', country: 'ALM', kit: {} };
const venueBg = app => {
  const v = app.drawEvent ? venueById(app.drawEvent.id) : app.tour ? tour.current(app.tour) : null;
  return v ? { colours: v.colours, surface: v.surface } : {};
};

// ---------- shared chrome ----------
function header(g, app, title, sub) {
  const gr = g.createLinearGradient(0, 0, 0, 150);
  gr.addColorStop(0, 'rgba(36,16,70,0.97)'); gr.addColorStop(1, 'rgba(59,31,107,0.92)');
  g.fillStyle = gr; g.fillRect(0, 0, W, 150);
  g.fillStyle = COL.ball; g.fillRect(0, 150, W, 4);
  // the title on a slanted white tab, the sub-line under it
  const tw = Math.min(1160, Math.max(360, measure(g, title, 58, 800, 2) + 120));
  g.beginPath(); g.moveTo(0, 26); g.lineTo(tw, 26); g.lineTo(tw - 26, 102); g.lineTo(0, 102); g.closePath();
  g.fillStyle = COL.white; g.fill();
  text(g, title, 70, 85, 58, COL.green, { wgt: 800, spacing: 2, max: tw - 120 });
  if (sub) text(g, sub, 72, 136, 24, COL.dim, { wgt: 700, spacing: 3, max: 1140 });
  const T = T_(app);
  if (!T) return;
  // you on the tour: rank, points, money
  const me = tour.playerOf(T, T.you);
  let x = W - 60;
  const box = (l, v, col) => {
    const w = Math.max(170, measure(g, v, 40, 800) + 50);
    panel(g, x - w, 30, w, 96, { a: 0.9, tab: false });
    text(g, l, x - w / 2, 62, 19, COL.dim, { align: 'center', spacing: 3 });
    text(g, v, x - w / 2, 110, 40, col, { wgt: 800, align: 'center' });
    x -= w + 14;
  };
  box('PRIZE MONEY', money(T.money), COL.ball);
  box('RANKING', `NO. ${tour.rankOf(T)}`, COL.white);
  if (x > 1240) {
    flag(g, me.country, x - 64, 50, 54, 36);
    text(g, up(me.short), x - 84, 84, 38, COL.white, { wgt: 800, align: 'right', max: x - 1240 });
    text(g, `SEASON ${T.season}`, x - 10, 118, 20, COL.dim, { align: 'right', spacing: 3 });
  }
}
function footer(g, app, hints, t, back = true) {
  g.fillStyle = 'rgba(4,24,17,0.9)'; g.fillRect(0, 1010, W, 70);
  g.fillStyle = COL.ball; g.fillRect(0, 1008, W, 3);
  if (back) button(g, 30, 1020, 200, 52, '◀ BACK', false, t, { back: true }, { size: 26 });
  if (hints) prompt(g, app, hints, W / 2 + (back ? 60 : 0), 1056, 25);
}
function msgStrip(g, app, x, y, w) {
  const M = app.msg;
  if (!M?.text || app.t - (app.msgT ?? -9) > 4) return;
  const a = clamp01(4 - (app.t - app.msgT)), col = M.ok ? COL.ok : COL.red;
  g.globalAlpha = a;
  panel(g, x, y, w, 54, { a: 0.95, tab: false, edge: col });
  text(g, M.text, x + w / 2, y + 38, 27, col, { wgt: 800, spacing: 1, align: 'center', max: w - 48 });
  g.globalAlpha = 1;
}
/** a ◀ value ▶ row: label above, the strap with its arrows; taps { i: row } on the middle */
function valueRow(g, t, k, label, sel, x, y, w, h, draw) {
  text(g, label, x, y - 12, 22, sel ? COL.ball : COL.dim, { spacing: 4 });
  strap(g, x, y, w, h, sel, t);
  draw(sel);
  arrows(g, x, y, w, h, k, sel, t);
  hot(x + h * 1.2, y, w - h * 2.4, h, { i: k });
}
/** a court chip: the surface's colour with its lines */
function courtChip(g, v, x, y, w, h) {
  const c = v?.colours?.court ?? SURFACE_TINT[v?.surface] ?? SURFACE_TINT.hard;
  g.fillStyle = shade(c, -0.25); rr(g, x, y, w, h, 4); g.fill();
  g.fillStyle = c; g.fillRect(x + w * 0.14, y + h * 0.1, w * 0.72, h * 0.8);
  g.strokeStyle = v?.colours?.line ?? '#f6f7f2'; g.lineWidth = 1.5;
  g.strokeRect(x + w * 0.14, y + h * 0.1, w * 0.72, h * 0.8);
  g.beginPath(); g.moveTo(x + w * 0.14, y + h / 2); g.lineTo(x + w * 0.86, y + h / 2); g.stroke();
  g.beginPath(); g.moveTo(x + w / 2, y + h * 0.28); g.lineTo(x + w / 2, y + h * 0.72); g.stroke();
}
/** a crown, lit or not */
function crownIcon(g, x, y, s, lit, t = 0) {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.moveTo(-s / 2, s * 0.3); g.lineTo(-s / 2, -s * 0.15); g.lineTo(-s * 0.25, s * 0.08); g.lineTo(0, -s * 0.3);
  g.lineTo(s * 0.25, s * 0.08); g.lineTo(s / 2, -s * 0.15); g.lineTo(s / 2, s * 0.3); g.closePath();
  if (lit) {
    g.shadowColor = alpha(COL.gold, 0.5 + 0.3 * Math.sin(t * 3)); g.shadowBlur = 16;
    const gr = g.createLinearGradient(0, -s * 0.3, 0, s * 0.3);
    gr.addColorStop(0, '#fff2b0'); gr.addColorStop(1, '#c99a12');
    g.fillStyle = gr;
  } else g.fillStyle = 'rgba(246,247,242,0.14)';
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = lit ? COL.ball : 'rgba(246,247,242,0.2)';
  for (const px of [-s / 2, 0, s / 2]) { g.beginPath(); g.arc(px, px ? -s * 0.15 : -s * 0.3, s * 0.07, 0, TAU); g.fill(); }
  g.restore();
}

// ---------- the title ----------
function logo(g, x, y, size) {
  g.save();
  g.translate(x, y);
  g.transform(1, 0, -0.12, 1, 0, 0);
  g.font = `400 ${size}px ${LOGO}`;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = '6px';
  const s = 'NETCORD', w = g.measureText(s).width;
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillText(s, 8, 10);
  g.lineWidth = 14; g.strokeStyle = COL.purple; g.lineJoin = 'round'; g.strokeText(s, 0, 0);
  const gr = g.createLinearGradient(0, -size * 0.8, 0, 0);
  gr.addColorStop(0, '#fbffd0'); gr.addColorStop(0.5, COL.ball); gr.addColorStop(1, '#a3b310');
  g.fillStyle = gr; g.fillText(s, 0, 0);
  // the cord: a white tape across the letters
  g.fillStyle = COL.white; g.fillRect(-10, -size * 0.36, w + 20, size * 0.06);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.restore();
  return w;
}
function title(g, app, t) {
  backdrop(g, t, { dark: 0.55 });
  // the champion of the moment at the right, a ball clipping the tape and dropping over
  figure(g, PLAYERS[Math.floor(t / 12) % 8], 1530, 960, 560, { t });
  const q = (t % 3.2) / 3.2, bx = 1120 + q * 420, by = 760 - Math.sin(Math.min(1, q * 1.4) * Math.PI) * 300 + (q > 0.7 ? (q - 0.7) * 600 : 0);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(bx + 20, 930, 22, 6, 0, 0, TAU); g.fill();
  ball(g, bx, by, 20, t * 12);
  logo(g, 110, 300, 170);
  text(g, `3D TENNIS ON THE ${up(TOUR)}`, 120, 370, 32, COL.white, { wgt: 700, spacing: 6, shadow: true });
  const items = app.items?.() ?? ['tour'];
  const LABEL = { continue: 'CONTINUE', tour: app.saved ? 'NEW TOUR' : 'TOUR', exhibition: 'EXHIBITION', practice: 'PRACTICE', options: 'OPTIONS', records: 'RECORDS', exit: 'EXIT' };
  items.forEach((it, k) => {
    const sel = k === app.menu, y = 420 + k * 80, w = 560, h = 66;
    button(g, 110, y, w, h, LABEL[it] ?? up(it), sel, t, { i: k }, { size: 34 });
    if (it === 'continue' && app.saved) {
      const s = up(`${app.saved.label ?? ''}${app.saved.at ? ' · ' + savedAgo(app.saved.at) : ''}`);
      text(g, s, 110 + w + 24, y + h / 2 + 10, 26, sel ? COL.ball : COL.dim, { wgt: 700, spacing: 1, max: 600 });
    }
  });
  const hdr = app.hdr?.supported ? `   {hdr} HDR ${String(app.hdr.label ?? '').slice(4).toLowerCase()}` : '';
  footer(g, app, `{menu} Choose   {start} Select   {sound} Sound ${app.soundOn ? 'on' : 'off'}   {fullscreen} Full screen${hdr}${app.onExit ? '   {quit} Exit' : ''}`, t, false);
}

// ---------- a player of your own ----------
function createScreen(g, app, t) {
  backdrop(g, t);
  header(g, app, 'NEW TOUR', 'CREATE YOUR PLAYER: A WILDCARD, RANKED LAST, WITH EVERYTHING TO PLAY FOR');
  const C = app.create, style = STYLES[C.style] ?? 'all-round';
  const me = tour.createPlayer({ name: C.name.join('').trim() || 'ROOKIE', hand: C.hand ? 'left' : 'right', style, height: tour.HEIGHTS[C.height], country: NATION_CODES[C.nation], kit: C.kit });
  panel(g, 60, 180, 1040, 815);
  const x = 110, w = 940, h = 72;
  const values = {
    hand: C.hand ? 'LEFT-HANDED' : 'RIGHT-HANDED', style: up(STYLE_LABEL[style]), height: `${tour.HEIGHTS[C.height].toFixed(2)} M`,
    nation: up(NATIONS[NATION_CODES[C.nation]]?.name), kit: `KIT ${C.kit + 1} OF ${KITS.length}`,
  };
  const LABEL = { name: 'NAME', hand: 'HAND', style: 'STYLE', height: 'HEIGHT', nation: 'NATION', kit: 'KIT' };
  CREATE_ROWS.slice(0, 6).forEach((row, k) => {
    const y = 232 + k * 108, sel = C.sel === k;
    if (row === 'name') {
      text(g, 'NAME', x, y - 12, 22, sel ? COL.ball : COL.dim, { spacing: 4 });
      for (let i = 0; i < tour.NAME_MAX; i++) {
        const bx = x + i * 92, cur = C.editing && i === C.pos;
        rr(g, bx, y, 80, h, 6);
        g.fillStyle = cur ? COL.ball : sel ? 'rgba(228,243,58,0.25)' : 'rgba(6,38,28,0.9)'; g.fill();
        g.strokeStyle = cur ? '#fbffd6' : 'rgba(246,247,242,0.2)'; g.lineWidth = 2; g.stroke();
        const ch = C.name[i] ?? ' ';
        text(g, ch === ' ' ? (cur && blink(t, 3) ? '_' : '') : ch, bx + 40, y + 54, 46, cur ? COL.ink : COL.white, { wgt: 800, align: 'center' });
        hot(bx, y, 80, h, { letter: i });
        if (C.editing) { hot(bx, y - 10, 80, h / 2 + 10, { letter: i, d: 1 }); hot(bx, y + h / 2, 80, h / 2 + 10, { letter: i, d: -1 }); }
      }
      if (C.editing) prompt(g, app, '{letters} Letters   {start} Done', x + 760, y + h + 26, 20, COL.ball, 'left');
      else if (sel) prompt(g, app, '{start} Edit', x + 790, y + 48, 22, COL.ball, 'left');
      return;
    }
    valueRow(g, t, k, LABEL[row], sel, x, y, w, h, s => {
      if (row === 'nation') { const tw = measure(g, values[row], 36, 800); flag(g, NATION_CODES[C.nation], x + w / 2 - tw / 2 - 74, y + 18, 54, 36); }
      if (row === 'kit') {
        const k2 = KITS[C.kit];
        [k2.shirt, k2.shorts, k2.band].forEach((c, i) => { g.fillStyle = c; g.fillRect(x + w / 2 + 130 + i * 40, y + 20, 32, 32); g.strokeStyle = 'rgba(0,0,0,0.4)'; g.strokeRect(x + w / 2 + 130 + i * 40, y + 20, 32, 32); });
      }
      text(g, values[row], x + w / 2, y + 50, 36, s ? COL.ink : COL.white, { wgt: 800, align: 'center', max: w - 260 });
    });
  });
  button(g, x, 878, 450, 74, 'START THE TOUR', C.sel === 6, t, { i: 6 }, { size: 32 });
  button(g, x + 490, 878, 450, 74, 'OR TAKE OVER A PLAYER', C.sel === 7, t, { i: 7 }, { size: 28 });
  // the player as he'll step out
  panel(g, 1140, 180, 720, 815, { tint: 'purple' });
  figure(g, me, 1330, 760, 470, { t });
  flag(g, me.country, 1540, 230, 72, 48);
  text(g, up(me.name), 1540, 330, 52, COL.white, { wgt: 800, max: 300 });
  text(g, up(STYLE_LABEL[style]), 1540, 372, 26, COL.ball, { spacing: 2, max: 300 });
  text(g, `${me.hand === 'left' ? 'LEFT' : 'RIGHT'}-HANDED · ${me.height.toFixed(2)} M`, 1540, 408, 21, COL.dim, { spacing: 2, max: 300 });
  RATINGS.forEach((a, k) => {
    const y = 470 + k * 50;
    text(g, RATING_LABEL[a], 1540, y + 18, 19, COL.dim, { spacing: 2 });
    pips(g, me.ratings[a], 1540, y + 26, 290, 12);
  });
  const blurb = { baseline: 'Heavy topspin from the back of the court. At home on clay.', 'serve-volley': 'A big serve and straight to the net. Made for grass and carpet.', 'all-round': 'A little of everything, ready for every surface.', counter: 'Quick feet, everything back, the other man\'s mistakes.' }[style];
  wrap(g, blurb, 23, 640, 500).slice(0, 2).forEach((l, k) => text(g, l, 1180, 860 + k * 30, 23, COL.white, { wgt: 500 }));
  text(g, 'TRAINING POINTS FROM EVERY WIN RAISE THE RATINGS', 1180, 950, 18, COL.faint, { spacing: 2, max: 640 });
  if (app.saved) text(g, 'A NEW TOUR REPLACES THE SAVED ONE ONCE IT BEGINS', 1500, 172, 18, COL.red, { align: 'center', spacing: 2 });
  footer(g, app, C.editing ? '{letters} Letters   {start} Done' : '{menu} Choose   {change} Change   {start} Select   {back} Title', t);
}
function pick(g, app, t) {
  backdrop(g, t);
  header(g, app, 'TAKE OVER A PLAYER', `ANY OF THE ${PLAYERS.length} ON THE ${up(TOUR)}: THE RANKING THEY HOLD, THE RATINGS THEY HAVE`);
  PLAYERS.forEach((p, k) => {
    const col = k % 4, row = Math.floor(k / 4), sel = k === app.pickSel;
    const x = 60 + col * 452, y = 176 + row * 102, w = 436, h = 92;
    rr(g, x, y, w, h, 6);
    g.fillStyle = sel ? 'rgba(228,243,58,0.94)' : 'rgba(6,38,28,0.86)'; g.fill();
    if (sel) { g.strokeStyle = '#fbffd6'; g.lineWidth = 3; g.stroke(); }
    const ink = sel ? COL.ink : COL.white, dim = sel ? 'rgba(11,32,22,0.7)' : COL.dim;
    text(g, String(p.rank), x + 46, y + 58, 36, sel ? COL.purple : COL.ball, { wgt: 800, align: 'right' });
    flag(g, p.country, x + 62, y + 20, 36, 24);
    text(g, up(p.name), x + 110, y + 40, 27, ink, { wgt: 800, max: w - 124 });
    text(g, `${STYLE_SHORT[p.style]} · ${p.hand === 'left' ? 'LEFT' : 'RIGHT'}`, x + 110, y + 72, 18, dim, { spacing: 1, max: 200 });
    stars(g, starsOf(p), x + w - 150, y + 66, 22, sel ? COL.purple : COL.ball);
    g.fillStyle = p.kit.shirt; g.fillRect(x + 62, y + 52, 36, 26);
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.strokeRect(x + 62, y + 52, 36, 26);
    hot(x, y, w, h, { i: k });
  });
  footer(g, app, '{menu} Choose   {start} Take him on   {back} Back', t);
}

// ---------- the tour's hub ----------
function tourScreen(g, app, t) {
  const T = T_(app);
  backdrop(g, t, venueBg(app));
  if (!T) return;
  const me = tour.playerOf(T, T.you), rank = tour.rankOf(T);
  header(g, app, up(me.name), `${up(TOUR)} · SEASON ${T.season} · ${fmt(tour.points(T, T.you))} POINTS`);
  // the calendar
  panel(g, 60, 180, 1080, 815);
  text(g, `SEASON ${T.season}`, 100, 226, 22, COL.ball, { spacing: 5 });
  text(g, 'DRAW', 860, 226, 18, COL.faint, { align: 'center', spacing: 3 });
  text(g, 'WINNER', 960, 226, 18, COL.faint, { align: 'center', spacing: 3 });
  text(g, 'YOU', 1090, 226, 18, COL.faint, { align: 'right', spacing: 3 });
  VENUES.forEach((v, k) => {
    const y = 246 + k * 92, now = k === T.ev, done = k < T.ev, log = T.log.find(l => l.ev === v.id);
    rr(g, 84, y, 1032, 82, 6);
    g.fillStyle = now ? 'rgba(228,243,58,0.2)' : 'rgba(4,24,17,0.6)'; g.fill();
    if (now) { g.strokeStyle = COL.ball; g.lineWidth = 3; g.stroke(); }
    courtChip(g, v, 100, y + 14, 80, 54);
    text(g, up(v.name), 200, y + 38, 30, done ? COL.dim : COL.white, { wgt: 800, max: 470 });
    text(g, `${up(v.city)} · ${up(SURFACE_LABEL[v.surface])}${v.roof ? ' · ROOF' : v.night ? ' · NIGHT' : ''}`, 200, y + 68, 19, COL.dim, { spacing: 2, max: 470 });
    if (v.tier === 'crown') {
      rr(g, 690, y + 22, 120, 38, 5); g.fillStyle = COL.purple; g.fill();
      crownIcon(g, 712, y + 41, 22, !!T.crowns[v.id], t);
      text(g, 'CROWN', 768, y + 50, 20, COL.white, { wgt: 800, align: 'center', spacing: 2 });
    }
    text(g, String(v.draw), 860, y + 52, 28, COL.white, { wgt: 700, align: 'center' });
    text(g, fmt(v.points[v.points.length - 1]), 960, y + 52, 26, COL.ball, { wgt: 800, align: 'center' });
    let res = '', col = COL.white;
    if (log) { res = log.won ? 'WON' : tour.roundShort(v.draw, Math.min(log.reached, tour.roundsOf(v.draw) - 1)); col = log.won ? COL.ball : COL.white; }
    else if (now && T.event) { res = `IN ${tour.roundShort(T.event.n, T.event.r)}`; col = COL.ball; }
    else if (now) res = 'NEXT';
    text(g, res, 1090, y + 52, 26, col, { wgt: 800, align: 'right' });
    const champ = T.champions[v.id];
    if (done && champ && champ !== T.you) text(g, `WON BY ${up(who(app, champ).short)}`, 1090, y + 74, 15, COL.faint, { align: 'right', spacing: 1 });
  });
  // the menu
  const nm = tour.nextMatch(T), cur = tour.current(T);
  const LABEL = {
    next: T.event ? (nm ? `PLAY THE ${up(nm.name)}` : 'THE DRAW') : cur ? `ENTER: ${up(cur.name)}` : 'SEASON REVIEW',
    rankings: 'RANKINGS', player: 'PLAYER', quit: 'QUIT TO TITLE',
  };
  const SUB = {
    next: T.event ? (nm ? `V ${up(who(app, nm.opp).name)}` : '') : cur ? `${up(cur.tier === 'crown' ? cur.crown : 'Open')} · ${up(SURFACE_LABEL[cur.surface])}` : 'THE YEAR IN REVIEW',
    rankings: `WORLD NO. ${rank} · BEST ${T.best || rank}`,
    player: T.train ? `${T.train} TRAINING POINT${T.train === 1 ? '' : 'S'} TO SPEND` : 'RATINGS AND RECORD',
    quit: 'THE TOUR IS SAVED',
  };
  app.tourItems().forEach((it, k) => button(g, 1180, 180 + k * 112, 680, 96, LABEL[it], k === app.tourMenu, t, { i: k }, { size: 38, sub: SUB[it] }));
  // the crowns
  panel(g, 1180, 640, 680, 355, { tint: 'purple' });
  text(g, up(tour.CROWN_IDS.length ? 'THE FOUR CROWNS' : ''), 1220, 690, 24, COL.ball, { spacing: 5 });
  tour.CROWN_IDS.forEach((id, k) => {
    const v = venueById(id), x = 1265 + k * 165, lit = (T.crowns[id] ?? 0) > 0;
    crownIcon(g, x, 760, 70, lit, t);
    text(g, up(v.crown?.replace(/^The /, '') ?? v.short), x, 830, 18, lit ? COL.ball : COL.dim, { align: 'center', spacing: 1, max: 155 });
    if (T.crowns[id] > 1) text(g, `×${T.crowns[id]}`, x + 40, 742, 22, COL.ball, { wgt: 800 });
  });
  text(g, `TITLES ${T.titles.length} · WON ${T.wl[0]} LOST ${T.wl[1]}${T.no1 ? ` · NO. 1 FOR ${T.weeksNo1} EVENT${T.weeksNo1 === 1 ? '' : 'S'}` : ''}`, 1220, 900, 22, COL.white, { spacing: 2, max: 600 });
  text(g, `SEASON ${T.season} OF ${tour.SEASONS} · REACH NO. 1, WIN ALL FOUR`, 1220, 950, 19, COL.dim, { spacing: 2, max: 600 });
  footer(g, app, '{menu} Choose   {start} Select   {back} Quit', t, false);
}

// ---------- the draw ----------
function drawScreen_(g, app, t) {
  const E = app.drawEvent, T = T_(app);
  backdrop(g, t, venueBg(app));
  if (!E || !T) return;
  const v = venueById(E.id), n = E.n, rounds = tour.roundsOf(n);
  header(g, app, up(v.name), `${up(v.tier === 'crown' ? v.crown : 'Open')} · ${up(SURFACE_LABEL[v.surface])} · DRAW OF ${n} · ${fmt(v.points[rounds])} POINTS AND ${money(v.prize[rounds])} TO THE WINNER`);
  panel(g, 40, 176, 1420, 826, { tab: false });
  const top = 196, hAvail = 790, x0 = 60, cw = 1380 / (rounds + 1);
  const size = n > 16 ? 16 : 22;
  const yAt = (r, j) => top + (j + 0.5) * (hAvail / (n >> r));
  const mine = id => id === T.you;
  // the champion's slot
  const champ = tour.championOf(E);
  E.rounds.forEach((round, r) => {
    round.forEach((m, j) => {
      const xa = x0 + r * cw;
      [m.a, m.b].forEach((id, s) => {
        const y = yAt(r, 2 * j + s), p = who(app, id), won = m.w === id, lost = m.w && !won, you = mine(id);
        if (you) { g.fillStyle = 'rgba(228,243,58,0.2)'; g.fillRect(xa - 6, y - size * 0.95, cw - 14, size * 1.7); }
        flag(g, p.country, xa, y - size * 0.62, size * 1.3, size * 0.86);
        const seed = E.seedOf?.[id];
        const label = `${up(p.short)}${seed ? ` (${seed})` : ''}${E.wc === id ? ' (WC)' : ''}`;
        text(g, label, xa + size * 1.6, y + size * 0.36, size, you ? COL.ball : lost ? COL.faint : COL.white, { wgt: won || you ? 800 : 500, max: cw - size * 1.6 - (won && m.sc ? 70 : 16) });
        if (won && m.sc) text(g, tour.scoreText(m.sc, s === 1, m.ret), xa + cw - 20, y + size * 0.36, n > 16 ? 12 : 15, COL.dim, { align: 'right', max: 92 });
      });
      // the bracket's lines into the next round
      const ya = yAt(r, 2 * j), yb = yAt(r, 2 * j + 1), xr = xa + cw - 12;
      g.strokeStyle = mine(m.w) ? alpha(COL.ball, 0.8) : 'rgba(246,247,242,0.22)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(xr, ya + 6); g.lineTo(xr + 6, ya + 6); g.lineTo(xr + 6, yb + 6); g.lineTo(xr, yb + 6); g.moveTo(xr + 6, (ya + yb) / 2 + 6); g.lineTo(xr + 12, (ya + yb) / 2 + 6); g.stroke();
    });
    text(g, up(tour.roundShort(n, r)), x0 + r * cw + 10, top - 2, 15, COL.faint, { spacing: 3 });
  });
  // the rounds still to come: empty places
  for (let r = E.rounds.length; r <= rounds; r++) {
    const xa = x0 + r * cw, k = n >> r;
    for (let j = 0; j < k; j++) {
      if (r === rounds && champ) break;
      const y = yAt(r, j);
      g.fillStyle = 'rgba(246,247,242,0.16)'; g.fillRect(xa, y + 6, cw - 40, 2);
    }
    if (r < rounds) text(g, up(tour.roundShort(n, r)), xa + 10, top - 2, 15, COL.faint, { spacing: 3 });
  }
  if (champ) {
    const p = who(app, champ), y = top + hAvail / 2, xa = x0 + rounds * cw;
    crownIcon(g, xa + 40, y - 60, 50, true, t);
    flag(g, p.country, xa, y - 16, 34, 24);
    text(g, up(p.short), xa + 42, y + 4, 26, mine(champ) ? COL.ball : COL.white, { wgt: 800, max: cw - 50 });
    text(g, 'CHAMPION', xa, y + 36, 16, COL.dim, { spacing: 3 });
  }
  // the side panel: your next match, or how the event went
  const x = 1490, w = 380;
  panel(g, x, 176, w, 826, { tint: 'purple' });
  if (E.done) {
    const S = app.summary ?? {};
    text(g, 'THE EVENT IS OVER', x + 30, 226, 22, COL.ball, { spacing: 4 });
    const big = S.won ? 'CHAMPION' : S.entered ? `OUT: ${up(S.round)}` : 'OVER';
    wrap(g, big, 46, w - 60, 800).slice(0, 3).forEach((l, k) => text(g, l, x + 30, 300 + k * 52, 46, S.won ? COL.ball : COL.white, { wgt: 800 }));
    const rows = [['RANKING POINTS', `+${fmt(S.pts)}`], ['PRIZE MONEY', `+${money(S.prize)}`], ['TRAINING', `+${S.train ?? 0}`], ['WORLD RANKING', `NO. ${S.rank ?? tour.rankOf(T)}`]];
    rows.forEach(([l, val], k) => {
      const y = 500 + k * 70;
      text(g, l, x + 30, y, 19, COL.dim, { spacing: 2 });
      text(g, val, x + w - 30, y + 30, 34, COL.white, { wgt: 800, align: 'right' });
    });
    if (champ && !mine(champ)) text(g, `WON BY ${up(who(app, champ).name)}`, x + 30, 820, 22, COL.dim, { spacing: 1, max: w - 60 });
    if (app.stT > 0.4) button(g, x + 30, 900, w - 60, 76, 'CONTINUE', true, t, { go: true }, { size: 32 });
  } else {
    const nm = tour.nextMatch(T);
    text(g, nm ? up(nm.name) : 'NEXT MATCH', x + 30, 226, 24, COL.ball, { spacing: 4 });
    if (nm) {
      const p = who(app, nm.opp);
      figure(g, p, x + w / 2, 620, 230, { t });
      flag(g, p.country, x + 30, 250, 48, 32);
      text(g, up(p.name), x + 30, 330, 34, COL.white, { wgt: 800, max: w - 60 });
      text(g, `NO. ${tour.rankOf(T, p.id)}${E.seedOf?.[p.id] ? ` · SEED ${E.seedOf[p.id]}` : ''} · ${up(STYLE_LABEL[p.style])}`, x + 30, 364, 19, COL.dim, { spacing: 1, max: w - 60 });
    }
    const LABEL = { play: 'PLAY', sim: 'SIMULATE', back: 'HUB' };
    DRAW_ITEMS.forEach((it, k) => button(g, x + 30, 640 + k * 92, w - 60, 76, LABEL[it], app.drawSel === k, t, { act: it }, { size: 32 }));
    text(g, `YOUR MATCHES: BEST OF ${app.opts?.sets ?? 3}`, x + w / 2, 940, 18, COL.faint, { align: 'center', spacing: 2 });
  }
  msgStrip(g, app, 300, 940, 900);
  footer(g, app, E.done ? '{start} Continue' : '{menu} Choose   {start} Select   {back} Hub', t, !E.done);
}

// ---------- the rankings ----------
function rankingsScreen(g, app, t) {
  const T = T_(app);
  backdrop(g, t, venueBg(app));
  if (!T) return;
  header(g, app, 'WORLD RANKINGS', 'EACH EVENT COUNTS ITS LAST EDITION: A ROLLING YEAR OF POINTS');
  const rows = tour.rankings(T), per = Math.ceil(rows.length / 2), rh = 47;
  [0, 1].forEach(c => {
    const x = 60 + c * 910, w = 890;
    panel(g, x, 176, w, 826, { tab: false });
    text(g, 'PLAYER', x + 190, 212, 17, COL.faint, { spacing: 3 });
    text(g, 'POINTS', x + w - 30, 212, 17, COL.faint, { align: 'right', spacing: 3 });
    rows.slice(c * per, c * per + per).forEach((r, j) => {
      const k = c * per + j, y = 226 + j * rh, p = who(app, r.id), you = r.id === T.you, sel = k === app.rankSel;
      rr(g, x + 14, y, w - 28, rh - 6, 4);
      g.fillStyle = you ? 'rgba(228,243,58,0.26)' : sel ? 'rgba(246,247,242,0.12)' : 'rgba(4,24,17,0.55)'; g.fill();
      if (you) { g.strokeStyle = COL.ball; g.lineWidth = 2; g.stroke(); }
      text(g, String(r.rank), x + 74, y + 31, 26, r.rank === 1 ? COL.ball : COL.white, { wgt: 800, align: 'right' });
      const d = r.prev - r.rank;
      if (d) {
        g.fillStyle = d > 0 ? COL.up : COL.down;
        const ax = x + 100, ay = y + 20;
        g.beginPath();
        if (d > 0) { g.moveTo(ax - 8, ay + 5); g.lineTo(ax + 8, ay + 5); g.lineTo(ax, ay - 7); }
        else { g.moveTo(ax - 8, ay - 5); g.lineTo(ax + 8, ay - 5); g.lineTo(ax, ay + 7); }
        g.closePath(); g.fill();
        text(g, String(Math.abs(d)), x + 114, y + 29, 16, d > 0 ? COL.up : COL.down, { wgt: 700 });
      }
      flag(g, p.country, x + 146, y + 10, 34, 22);
      text(g, up(p.name), x + 190, y + 30, 25, you ? COL.ball : COL.white, { wgt: you ? 800 : 700, max: 480 });
      text(g, up(STYLE_LABEL[p.style]), x + 690, y + 29, 15, COL.faint, { align: 'right', spacing: 1, max: 140 });
      text(g, fmt(r.pts), x + w - 30, y + 31, 26, you ? COL.ball : COL.white, { wgt: 800, align: 'right' });
    });
  });
  footer(g, app, '{start} Hub', t);
}

// ---------- the player: ratings and training ----------
function playerScreen(g, app, t) {
  const T = T_(app);
  backdrop(g, t, venueBg(app));
  if (!T) return;
  const me = tour.playerOf(T, T.you);
  header(g, app, up(me.name), `${up(STYLE_LABEL[me.style])} · ${me.hand === 'left' ? 'LEFT' : 'RIGHT'}-HANDED · ${me.height.toFixed(2)} M · ${up(NATIONS[me.country]?.name)}`);
  panel(g, 60, 176, 560, 826, { tint: 'purple' });
  figure(g, me, 340, 760, 500, { t });
  const facts = [['WON–LOST', `${T.wl[0]}–${T.wl[1]}`], ['TITLES', String(T.titles.length)], ['BEST RANKING', T.best ? `NO. ${T.best}` : '–'], ['PRIZE MONEY', money(T.money)]];
  facts.forEach(([l, v], k) => {
    const x = 100 + (k % 2) * 260, y = 820 + Math.floor(k / 2) * 84;
    text(g, l, x, y, 18, COL.dim, { spacing: 2 });
    text(g, v, x, y + 40, 34, COL.white, { wgt: 800 });
  });
  // the ratings: pick one, pay its cost in training points
  panel(g, 660, 176, 1200, 826);
  text(g, 'TRAINING', 700, 226, 24, COL.ball, { spacing: 5 });
  text(g, `${T.train} POINT${T.train === 1 ? '' : 'S'} TO SPEND`, 1820, 230, 34, T.train ? COL.ball : COL.dim, { wgt: 800, align: 'right' });
  RATINGS.forEach((a, k) => {
    const y = 262 + k * 92, sel = k === app.playerSel, r = me.ratings[a], cost = tour.trainCost(T, a), can = cost <= T.train;
    rr(g, 690, y, 1140, 78, 6);
    g.fillStyle = sel ? 'rgba(228,243,58,0.92)' : 'rgba(4,24,17,0.7)'; g.fill();
    const ink = sel ? COL.ink : COL.white;
    text(g, RATING_LABEL[a], 720, y + 50, 32, ink, { wgt: 800, max: 220 });
    pips(g, r, 960, y + 28, 480, 22, sel ? COL.purple : COL.ball, sel && can ? 1 : 0);
    text(g, String(r), 1480, y + 54, 40, ink, { wgt: 800, align: 'center' });
    text(g, cost === Infinity ? 'TOP' : `+1 FOR ${cost}`, 1800, y + 50, 26, sel ? COL.ink : can ? COL.ball : COL.faint, { wgt: 800, align: 'right' });
    hot(690, y, 1140, 78, { i: k });
  });
  text(g, 'WINS EARN TRAINING POINTS: ONE AN EVENT, ONE A WIN, MORE FOR A TITLE', 1260, 935, 20, COL.dim, { align: 'center', spacing: 2, max: 1120 });
  msgStrip(g, app, 860, 950, 800);
  footer(g, app, '{menu} Choose   {start} Train   {back} Hub', t);
}

// ---------- before the match ----------
function playerCard(g, app, p, x, y, w, h, { you = false, rank = 0, seed = 0, t = 0, mirror = false } = {}) {
  panel(g, x, y, w, h, { tab: false, edge: you ? COL.ball : null, lw: 3 });
  figure(g, p, mirror ? x + w - 170 : x + 170, y + h - 60, 400, { t, mirror });
  const tx = mirror ? x + 40 : x + 320;
  flag(g, p.country, tx, y + 40, 60, 40);
  if (you) text(g, 'YOU', tx + 80, y + 72, 30, COL.ball, { wgt: 800, spacing: 4 });
  text(g, up(p.name), tx, y + 140, 42, you ? COL.ball : COL.white, { wgt: 800, max: w - 360 });
  const line = [rank ? `NO. ${rank}` : '', seed ? `SEED ${seed}` : '', up(STYLE_LABEL[p.style])].filter(Boolean).join(' · ');
  text(g, line, tx, y + 176, 21, COL.dim, { spacing: 2, max: w - 360 });
  text(g, `${up(NATIONS[p.country]?.name)} · ${p.hand === 'left' ? 'LEFT' : 'RIGHT'}-HANDED · ${p.height?.toFixed?.(2) ?? ''} M`, tx, y + 206, 18, COL.faint, { spacing: 1, max: w - 360 });
  RATINGS.forEach((a, k) => {
    const yy = y + 250 + k * 56;
    text(g, RATING_LABEL[a], tx, yy + 16, 18, COL.dim, { spacing: 2 });
    pips(g, p.ratings?.[a] ?? 1, tx, yy + 24, w - 380, 14);
  });
}
function prematch(g, app, t) {
  const P = app.pre;
  backdrop(g, t, P ? { colours: P.venue.colours, surface: P.venue.surface } : {});
  if (!P) return;
  const v = P.venue;
  header(g, app, up(P.label.split(' · ').slice(-1)[0]), `${up(v.name)} · ${up(SURFACE_LABEL[v.surface])}${v.roof ? ' · UNDER THE ROOF' : v.night ? ' · UNDER LIGHTS' : ''} · BEST OF ${P.best} SET${P.best === 1 ? '' : 'S'}`);
  playerCard(g, app, P.players[0], 60, 180, 880, 810, { you: P.human === 0, rank: P.ranks?.[0], seed: P.seeds?.[0], t });
  playerCard(g, app, P.players[1], 980, 180, 880, 810, { you: P.human === 1, rank: P.ranks?.[1], seed: P.seeds?.[1], t, mirror: true });
  text(g, 'V', W / 2, 600, 70, COL.ball, { wgt: 800, align: 'center', italic: true, shadow: true });
  button(g, W / 2 - 230, 1016, 460, 58, 'PLAY', true, t, { go: true }, { size: 30 });
  prompt(g, app, '{start} Play', W / 2 + 380, 1056, 24);
  button(g, 30, 1020, 200, 52, '◀ BACK', false, t, { back: true }, { size: 26 });
}

// ---------- over the frozen match ----------
function dim(g, a = 0.5) { g.fillStyle = `rgba(2,14,9,${a})`; g.fillRect(0, 0, W, H); }
const scoreOf = app => {
  const s = app.match?.s?.score;
  const sets = (app.result?.sets ?? s?.sets ?? []).map(x => [x[0], x[1]]);
  if (!app.result && s?.games && (s.games[0] || s.games[1] || !sets.length)) sets.push([s.games[0], s.games[1]]);
  return sets;
};
/** the TV scoreboard: a row a player, his sets' games, the point (live) */
function scoreboard(g, app, x, y, { live = true } = {}) {
  const ps = app.players ?? [], s = app.match?.s, sets = scoreOf(app), rows = 2, rh = 64;
  const w = 420 + sets.length * 70 + (live ? 140 : 0);
  panel(g, x - w / 2, y, w, rows * rh + 20, { tab: false });
  [0, 1].forEach(k => {
    const p = ps[k], yy = y + 10 + k * rh;
    if (!p) return;
    flag(g, p.country, x - w / 2 + 24, yy + 16, 40, 28);
    text(g, up(p.short), x - w / 2 + 80, yy + 44, 34, app.human === k ? COL.ball : COL.white, { wgt: 800, max: 230 });
    if (live && s?.server === k && s.phase !== 'over') { g.fillStyle = COL.ball; g.beginPath(); g.arc(x - w / 2 + 330, yy + 32, 9, 0, TAU); g.fill(); }
    sets.forEach((st, j) => {
      const mine = st[k], won = st[k] > st[1 - k];
      text(g, String(mine), x - w / 2 + 390 + j * 70, yy + 46, 38, won ? COL.white : COL.dim, { wgt: won ? 800 : 500, align: 'center' });
    });
    if (live && s?.score?.points) {
      const pts = s.score.tiebreak ? String(s.score.points[k] ?? 0) : ['0', '15', '30', '40'][s.score.points[k]] ?? (s.score.points[k] > s.score.points[1 - k] ? 'AD' : '40');
      g.fillStyle = COL.ball; g.fillRect(x + w / 2 - 120, yy + 6, 100, rh - 8);
      text(g, pts, x + w / 2 - 70, yy + 46, 36, COL.ink, { wgt: 800, align: 'center' });
    }
  });
}
function pause(g, app, t) {
  dim(g, 0.55);
  scoreboard(g, app, W / 2, 110);
  panel(g, 610, 300, 700, 600);
  text(g, 'PAUSED', W / 2, 390, 76, COL.white, { wgt: 800, align: 'center', spacing: 8, shadow: true });
  const items = app.pauseItems?.() ?? ['resume'];
  const label = { resume: 'RESUME', camera: `CAMERA: ${CAMERA_LABEL[app.camera] ?? up(app.camera)}`, sound: `SOUND ${app.soundOn ? 'ON' : 'OFF'}`, retire: 'RETIRE', quit: app.kind === 'practice' ? 'END PRACTICE' : 'QUIT THE MATCH' };
  items.forEach((it, k) => {
    const sel = k === (app.pauseMenu ?? 0), y = 440 + k * 96;
    button(g, 710, y, 500, 76, label[it] ?? up(it), sel, t, { i: k }, { size: 32 });
    if (it === 'camera') arrows(g, 710, y, 500, 76, k, sel, t);
  });
  const it = items[app.pauseMenu ?? 0];
  if (it === 'retire') text(g, 'RETIRING HANDS THE MATCH TO YOUR OPPONENT', W / 2, 860, 22, COL.red, { align: 'center', spacing: 2 });
  prompt(g, app, '{menu} Choose   {start} Select   {camera} Camera   {pause} Resume', W / 2, 960, 26, COL.white);
}
function statRows(g, app, x, y, w) {
  const st = app.match?.s?.stats ?? app.result?.stats;
  if (!st) return;
  const get = (k, i) => {
    const v = Array.isArray(st) ? st[i]?.[k] : st[k]?.[i];
    return v;
  };
  const rows = [
    ['ACES', 'aces', v => String(v ?? 0)],
    ['DOUBLE FAULTS', 'doubleFaults', v => String(v ?? 0)],
    ['FIRST SERVES IN', 'firstServe', v => (Array.isArray(v) && v[1] ? `${Math.round((v[0] / v[1]) * 100)}%` : '–')],
    ['WINNERS', 'winners', v => String(v ?? 0)],
    ['ERRORS', 'errors', v => String(v ?? 0)],
    ['NET POINTS', 'netPoints', v => (Array.isArray(v) ? `${v[0]}/${v[1]}` : String(v ?? 0))],
  ];
  rows.forEach(([l, k, f], j) => {
    const yy = y + j * 50;
    text(g, f(get(k, 0)), x, yy, 30, COL.white, { wgt: 800 });
    text(g, f(get(k, 1)), x + w, yy, 30, COL.white, { wgt: 800, align: 'right' });
    text(g, l, x + w / 2, yy - 2, 19, COL.dim, { align: 'center', spacing: 3 });
    g.fillStyle = 'rgba(246,247,242,0.12)'; g.fillRect(x + 120, yy + 10, w - 240, 2);
  });
}
function caption(g, s, y, col = COL.ball, ink = COL.ink) {
  const tw = measure(g, s, 50, 800, 6) + 120;
  g.beginPath(); g.moveTo(W / 2 - tw / 2 + 20, y); g.lineTo(W / 2 + tw / 2 + 20, y); g.lineTo(W / 2 + tw / 2 - 20, y + 66); g.lineTo(W / 2 - tw / 2 - 20, y + 66); g.closePath();
  g.fillStyle = col; g.fill();
  text(g, s, W / 2, y + 51, 50, ink, { wgt: 800, align: 'center', spacing: 6 });
}
function changeover(g, app, t) {
  // a lower third: the board, the stats, the time to the next game
  const a = ease(clamp01(app.stT * 3));
  g.save();
  g.globalAlpha = a;
  g.translate(0, (1 - a) * 40);
  g.fillStyle = 'rgba(2,14,9,0.35)'; g.fillRect(0, 0, W, H);
  caption(g, 'CHANGE OF ENDS', 90, COL.purple, COL.white);
  scoreboard(g, app, W / 2, 190);
  panel(g, 560, 370, 800, 390, { tab: false });
  const ps = app.players ?? [];
  if (ps[0]) text(g, up(ps[0].short), 600, 420, 24, COL.ball, { wgt: 800, spacing: 2 });
  if (ps[1]) text(g, up(ps[1].short), 1320, 420, 24, COL.ball, { wgt: 800, spacing: 2, align: 'right' });
  statRows(g, app, 600, 470, 720);
  g.restore();
  const q = clamp01(app.stT / 6);
  g.fillStyle = 'rgba(246,247,242,0.15)'; g.fillRect(760, 780, 400, 8);
  g.fillStyle = COL.ball; g.fillRect(760, 780, 400 * (1 - q), 8);
  button(g, W / 2 - 160, 800, 320, 62, 'PLAY ON', true, t, { go: true }, { size: 28 });
  prompt(g, app, '{start} Play on   {camera} Camera', W / 2, 910, 24, COL.white);
}
function result(g, app, t) {
  dim(g, 0.55);
  const r = app.result ?? {}, ps = app.players ?? [], wk = r.winner ?? 0, wp = ps[wk];
  const a = ease(clamp01(app.stT * 2.5));
  g.save(); g.globalAlpha = a;
  caption(g, 'GAME, SET AND MATCH', 70);
  if (wp) {
    flag(g, wp.country, W / 2 - 50, 170, 100, 66);
    text(g, up(wp.name), W / 2, 300, 72, app.human === wk ? COL.ball : COL.white, { wgt: 800, align: 'center', shadow: true, max: 1500 });
  }
  scoreboard(g, app, W / 2, 340, { live: false });
  panel(g, 560, 520, 800, 340, { tab: false });
  statRows(g, app, 600, 580, 720);
  if (app.label) text(g, up(app.label), W / 2, 900, 22, COL.dim, { align: 'center', spacing: 3 });
  if (r.won != null) text(g, r.won ? 'VICTORY' : 'DEFEAT', W / 2, 970, 54, r.won ? COL.ok : COL.down, { wgt: 800, align: 'center', spacing: 10, shadow: true });
  g.restore();
  if (app.stT > 0.8) {
    button(g, W / 2 + 280, 1000, 360, 62, 'CONTINUE', true, t, { go: true }, { size: 28 });
    hot(0, 0, W, H, { go: true });
  }
}

// ---------- trophies ----------
function confetti(g, t, cols) {
  for (let i = 0; i < 150; i++) {
    const s1 = ((i * 7919) % 1000) / 1000, s2 = ((i * 104729) % 1000) / 1000, s3 = ((i * 1299709) % 1000) / 1000;
    const fall = 60 + s2 * 120, y = ((t * fall + s3 * 1300) % 1300) - 100, x = s1 * W + Math.sin(t * (1 + s2) + i) * 40;
    g.save(); g.translate(x, y); g.rotate(t * (2 + s3 * 4) + i);
    g.fillStyle = cols[i % cols.length]; g.fillRect(-8, -4, 16, 8);
    g.restore();
  }
}
function cup(g, x, y, s, t, crown = false) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  const metal = crown ? ['#fff2b0', '#e0b63a', '#9c7410'] : ['#ffffff', '#c9d2da', '#7d8a96'];
  const gr = g.createLinearGradient(-80, 0, 80, 0);
  gr.addColorStop(0, metal[2]); gr.addColorStop(0.35, metal[0]); gr.addColorStop(0.6, metal[1]); gr.addColorStop(1, metal[2]);
  g.fillStyle = '#3b1f6b'; g.fillRect(-70, 110, 140, 52);
  g.fillStyle = COL.ball; g.fillRect(-56, 126, 112, 8);
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(-44, 110); g.lineTo(44, 110); g.lineTo(14, 56); g.lineTo(-14, 56); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-78, -50); g.quadraticCurveTo(-78, 60, 0, 64); g.quadraticCurveTo(78, 60, 78, -50); g.closePath(); g.fill();
  g.strokeStyle = gr; g.lineWidth = 10;
  g.beginPath(); g.arc(-82, -4, 28, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
  g.beginPath(); g.arc(82, -4, 28, -Math.PI * 0.5, Math.PI * 0.5); g.stroke();
  // a ball on the lid, or a crown
  if (crown) {
    g.restore(); crownIcon(g, x, y - 92 * s, 100 * s, true, t); return;
  }
  g.restore();
  ball(g, x, y - 82 * s, 26 * s, t * 2);
}
function trophyScreen(g, app, t) {
  const K = app.trophy ?? { kind: 'event' }, T = T_(app), k = app.stT ?? 9;
  const v = K.venue ?? (app.drawEvent ? venueById(app.drawEvent.id) : null);
  backdrop(g, t, v ? { colours: v.colours, surface: v.surface, dark: 0.65 } : { dark: 0.65 });
  const me = T ? tour.playerOf(T, T.you) : null;
  confetti(g, t, [COL.ball, COL.white, COL.purple2, me?.kit?.shirt ?? COL.gold]);
  const fade = q => clamp01((k - q) * 1.2);
  let big = 'CHAMPION', line = '', note = '';
  if (K.kind === 'event' && v) { big = 'CHAMPION'; line = `${up(me?.name)} WINS THE ${up(v.name)}`; note = v.crown ? up(v.crown) : ''; }
  else if (K.kind === 'no1') { big = 'WORLD NO. 1'; line = `${up(me?.name)} TOPS THE ${up(TOUR)} RANKINGS`; note = `SEASON ${T?.season ?? 1}`; }
  else if (K.kind === 'crowns') { big = 'THE FOUR CROWNS'; line = `${up(me?.name)} HAS WON ALL FOUR CROWNS`; note = 'A CAREER COMPLETE'; }
  else if (K.kind === 'retired') { big = 'CAREER OVER'; line = `${tour.SEASONS} SEASONS ON THE ${up(TOUR)}`; note = `BEST RANKING NO. ${T?.best || '–'} · ${tour.majorsWon(T ?? { crowns: {} })} OF 4 CROWNS`; }
  if (K.kind === 'crowns' || K.kind === 'retired') {
    tour.CROWN_IDS.forEach((id, j) => crownIcon(g, W / 2 + (j - 1.5) * 210, 560, 150, !!T?.crowns?.[id], t + j));
  } else if (K.kind === 'no1') {
    g.save(); g.globalAlpha = fade(0.3);
    text(g, '1', W / 2, 720, 420, COL.ball, { wgt: 800, align: 'center', shadow: true });
    g.restore();
  } else cup(g, W / 2, 560, 1.6, t, v?.tier === 'crown');
  g.globalAlpha = fade(0.2);
  text(g, big, W / 2, 240, 150, COL.ball, { wgt: 800, align: 'center', italic: true, spacing: 8, shadow: true, max: 1800 });
  text(g, line, W / 2, 310, 38, COL.white, { wgt: 800, align: 'center', spacing: 3, shadow: true, max: 1700 });
  if (note) text(g, note, W / 2, 352, 26, COL.dim, { align: 'center', spacing: 4, max: 1500 });
  g.globalAlpha = fade(1.1);
  if (K.kind === 'event' && app.summary) {
    const S = app.summary;
    panel(g, 560, 850, 800, 120, { tab: false });
    [['POINTS', `+${fmt(S.pts)}`], ['PRIZE', money(S.prize)], ['RANKING', `NO. ${S.rank}`]].forEach(([l, val], j) => {
      const x = 690 + j * 270;
      text(g, l, x, 890, 21, COL.dim, { align: 'center', spacing: 4 });
      text(g, val, x, 944, 44, COL.white, { wgt: 800, align: 'center' });
    });
  }
  g.globalAlpha = 1;
  if (me && K.kind !== 'no1') { figure(g, me, 330, 980, 520, { t, pose: 'swing' }); }
  if (k > 2) { prompt(g, app, '{start} Continue', W / 2, 1050, 28, blink(t) ? COL.ball : COL.white); hot(0, 0, W, H, { go: true }); }
}

// ---------- the season's review ----------
function season(g, app, t) {
  backdrop(g, t);
  const S = app.season, T = T_(app);
  if (!S) return;
  header(g, app, `SEASON ${S.season} REVIEW`, `YEAR-END NO. ${S.rank} · WON ${S.wl[0]} LOST ${S.wl[1]} · ${S.titles.length} TITLE${S.titles.length === 1 ? '' : 'S'} · ${money(S.money)}`);
  panel(g, 60, 176, 1080, 826);
  text(g, 'YOUR SEASON', 100, 226, 22, COL.ball, { spacing: 5 });
  VENUES.forEach((v, k) => {
    const y = 250 + k * 90, log = S.log.find(l => l.ev === v.id);
    rr(g, 84, y, 1032, 78, 6); g.fillStyle = log?.won ? 'rgba(228,243,58,0.2)' : 'rgba(4,24,17,0.6)'; g.fill();
    courtChip(g, v, 100, y + 12, 80, 54);
    text(g, up(v.name), 200, y + 48, 30, COL.white, { wgt: 800, max: 520 });
    const res = !log ? '–' : log.won ? 'CHAMPION' : up(tour.roundName(v.draw, Math.min(log.reached, tour.roundsOf(v.draw) - 1)));
    text(g, res, 870, y + 48, 24, log?.won ? COL.ball : COL.white, { wgt: 800, align: 'right', max: 240 });
    text(g, log ? `+${fmt(log.pts)}` : '', 1090, y + 48, 24, COL.dim, { wgt: 700, align: 'right' });
  });
  panel(g, 1180, 176, 680, 826, { tint: 'purple' });
  text(g, 'YEAR-END TOP 8', 1220, 226, 22, COL.ball, { spacing: 5 });
  S.top.forEach((r, k) => {
    const y = 260 + k * 76, p = who(app, r.id), you = T && r.id === T.you;
    text(g, String(k + 1), 1250, y + 44, 34, k ? COL.white : COL.ball, { wgt: 800, align: 'right' });
    flag(g, p.country, 1272, y + 18, 40, 27);
    text(g, up(p.name), 1326, y + 44, 28, you ? COL.ball : COL.white, { wgt: 800, max: 340 });
    text(g, fmt(r.pts), 1830, y + 44, 26, COL.dim, { wgt: 700, align: 'right' });
  });
  footer(g, app, app.stT > 0.8 ? '{start} Continue' : '', t, false);
  if (app.stT > 0.8) button(g, 1360, 1016, 460, 58, S.last ? 'THE END OF A CAREER' : `ON TO SEASON ${S.season + 1}`, true, t, { go: true }, { size: 28 });
}

// ---------- initials and records ----------
function entry(g, app, t) {
  backdrop(g, t);
  const E = app.entry ?? { letters: [0, 0, 0], pos: 0 }, T = T_(app);
  panel(g, 510, 140, 900, 800, { tint: 'purple' });
  text(g, 'RECORDS', W / 2, 250, 76, COL.ball, { wgt: 800, align: 'center', spacing: 8, shadow: true });
  const line = T ? `${tour.majorsWon(T)} OF 4 CROWNS · ${T.titles.length} TITLES · BEST NO. ${T.best || '–'}` : '';
  text(g, line, W / 2, 310, 28, COL.white, { align: 'center', spacing: 2, max: 820 });
  text(g, 'YOUR INITIALS', W / 2, 390, 24, COL.dim, { align: 'center', spacing: 5 });
  for (let k = 0; k < 3; k++) {
    const x = W / 2 + (k - 1) * 190, sel = k === E.pos;
    panel(g, x - 75, 440, 150, 200, { tab: false, edge: sel ? COL.ball : 'rgba(246,247,242,0.15)', lw: sel ? 4 : 2 });
    text(g, LETTERS[E.letters[k]] ?? 'A', x, 590, 130, sel ? COL.ball : COL.white, { wgt: 800, align: 'center' });
    hot(x - 75, 440, 150, 200, { letter: k });
    for (const d of [1, -1]) {
      const cy = d > 0 ? 418 : 666;
      g.fillStyle = sel ? COL.ball : COL.faint;
      g.beginPath(); g.moveTo(x - 26, cy + d * 12); g.lineTo(x + 26, cy + d * 12); g.lineTo(x, cy - d * 16); g.closePath(); g.fill();
      hot(x - 75, d > 0 ? 380 : 645, 150, 58, { letter: k, d });
    }
  }
  button(g, W / 2 - 200, 750, 400, 76, 'SIGN', true, t, { done: true }, { size: 36 });
  prompt(g, app, '{letters} Letters   {hit} Next   {start} Done', W / 2, 890, 26, COL.dim);
}
function records(g, app, t) {
  backdrop(g, t);
  const gr = g.createLinearGradient(0, 0, 0, 150);
  gr.addColorStop(0, 'rgba(36,16,70,0.97)'); gr.addColorStop(1, 'rgba(59,31,107,0.92)');
  g.fillStyle = gr; g.fillRect(0, 0, W, 150); g.fillStyle = COL.ball; g.fillRect(0, 150, W, 4);
  text(g, 'RECORDS', 70, 92, 64, COL.ball, { wgt: 800, spacing: 4 });
  text(g, `CAREERS ON THE ${up(TOUR)}: THE FOUR CROWNS IN THE FEWEST SEASONS FIRST`, 72, 132, 24, COL.dim, { spacing: 3 });
  const x = 360, w = 1200;
  panel(g, x, 190, w, 800, { tab: false });
  const head = [['PLAYER', x + 150, 'left'], ['CROWNS', x + 600, 'center'], ['TITLES', x + 790, 'right'], ['BEST', x + 950, 'right'], ['SEASONS', x + 1140, 'right']];
  head.forEach(([l, hx, al]) => text(g, l, hx, 250, 22, COL.dim, { spacing: 4, align: al }));
  (app.records ?? []).slice(0, 8).forEach((e, k) => {
    const y = 330 + k * 82, hl = k === app.recRank, col = hl ? (blink(t, 4) ? COL.ball : COL.white) : COL.white;
    if (hl) { g.fillStyle = COL.ball; g.fillRect(x + 20, y - 50, 10, 64); }
    text(g, `${k + 1}`, x + 100, y, 42, k === 0 ? COL.ball : COL.dim, { wgt: 800, align: 'right' });
    text(g, e.n, x + 150, y, 52, col, { wgt: 800, spacing: 8 });
    for (let j = 0; j < 4; j++) crownIcon(g, x + 510 + j * 60, y - 16, 40, j < e.majors, t);
    text(g, String(e.titles), x + 790, y, 42, col, { wgt: 800, align: 'right' });
    text(g, `NO. ${e.best}`, x + 950, y, 34, e.best === 1 ? COL.ball : COL.dim, { wgt: 700, align: 'right' });
    text(g, String(e.seasons), x + 1140, y, 42, col, { wgt: 800, align: 'right' });
  });
  footer(g, app, '{start} Title', t);
}

// ---------- options ----------
function options(g, app, t) {
  backdrop(g, t);
  header(g, app, 'OPTIONS', 'SAVED IN THE BROWSER');
  const o = app.opts ?? {};
  const rows = [
    ['MATCH LENGTH', `BEST OF ${o.sets ?? 3} SET${o.sets === 1 ? '' : 'S'}`, 'YOUR MATCHES ON THE TOUR AND IN PRACTICE'],
    ['DIFFICULTY', up(o.difficulty ?? 'normal'), 'HOW SHARP THE COMPUTER\'S PLAYERS ARE'],
    ['ASSIST', o.assist === false ? 'OFF: YOU RUN' : 'ON: YOU TIME AND AIM', 'WITH ASSIST YOUR PLAYER RUNS TO THE BALL BY HIMSELF'],
    ['CAMERA', CAMERA_LABEL[o.camera] ?? 'TV', 'WHERE MATCHES START ({camera} CHANGES IT ANY TIME)'],
    ['SOUND', app.soundOn ? 'ON' : 'OFF', 'MUSIC, CROWD AND EFFECTS ({sound} ANY TIME)'],
  ];
  panel(g, 410, 180, 1100, 820);
  rows.forEach(([l, v, note], k) => {
    const y = 236 + k * 136, sel = app.optSel === k;
    valueRow(g, t, k, l, sel, 470, y, 980, 72, s => text(g, v, 960, y + 50, 36, s ? COL.ink : COL.white, { wgt: 800, align: 'center' }));
    prompt(g, app, note, 960, y + 104, 19, COL.faint);
  });
  button(g, 760, 916, 400, 70, 'DONE', app.optSel === 5, t, { i: 5 }, { size: 32 });
  footer(g, app, '{menu} Choose   {change} Change   {back} Title', t);
}

// ---------- exhibition ----------
function exhibition(g, app, t) {
  const X = app.exhibition ?? { p: [0, 1], venue: 0, sets: 1, side: 0, sel: 0 }, v = VENUES[X.venue];
  backdrop(g, t, { colours: v.colours, surface: v.surface });
  header(g, app, 'EXHIBITION', 'ANY TWO PLAYERS, ANY COURT: YOU PLAY ONE, OR WATCH');
  const p0 = PLAYERS[X.p[0]], p1 = PLAYERS[X.p[1]];
  panel(g, 60, 180, 980, 815);
  const rows = [
    ['PLAYER 1', s => text(g, up(p0.name), 550, 0, 34, s ? COL.ink : COL.white, { wgt: 800, align: 'center', max: 600 })],
    ['PLAYER 2', s => text(g, up(p1.name), 550, 0, 34, s ? COL.ink : COL.white, { wgt: 800, align: 'center', max: 600 })],
    ['COURT', s => text(g, `${up(v.name)} · ${up(SURFACE_LABEL[v.surface])}`, 550, 0, 32, s ? COL.ink : COL.white, { wgt: 800, align: 'center', max: 600 })],
    ['MATCH', s => text(g, `BEST OF ${SETS[X.sets]} SET${SETS[X.sets] === 1 ? '' : 'S'}`, 550, 0, 34, s ? COL.ink : COL.white, { wgt: 800, align: 'center' })],
    ['YOU PLAY', s => text(g, X.side === 2 ? 'NEITHER: WATCH' : `${SIDE[X.side]}: ${up((X.side ? p1 : p0).short)}`, 550, 0, 34, s ? COL.ink : COL.white, { wgt: 800, align: 'center' })],
  ];
  rows.forEach(([l, draw], k) => {
    const y = 232 + k * 128, sel = X.sel === k;
    valueRow(g, t, k, l, sel, 110, y, 880, 72, s => { g.save(); g.translate(0, y + 50); draw(s); g.restore(); });
  });
  button(g, 300, 890, 500, 80, 'PLAY', X.sel === 5, t, { i: 5 }, { size: 36 });
  // the two, side by side
  panel(g, 1080, 180, 780, 815, { tint: 'purple' });
  [[p0, 0], [p1, 1]].forEach(([p, k]) => {
    const x = 1275 + k * 390;
    figure(g, p, x, 700, 400, { t: t + k, mirror: k === 1 });
    flag(g, p.country, x - 30, 760, 60, 40);
    text(g, up(p.name), x, 850, 30, X.side === k ? COL.ball : COL.white, { wgt: 800, align: 'center', max: 360 });
    text(g, `NO. ${p.rank} · ${up(STYLE_LABEL[p.style])}`, x, 886, 19, COL.dim, { align: 'center', spacing: 1, max: 360 });
    stars(g, starsOf(p), x - 92, 930, 32);
    if (X.side === k) text(g, 'YOU', x, 240, 34, COL.ball, { wgt: 800, align: 'center', spacing: 6 });
  });
  text(g, 'V', 1470, 500, 64, COL.ball, { wgt: 800, align: 'center', italic: true, shadow: true });
  footer(g, app, '{menu} Choose   {change} Change   {start} Play   {back} Title', t);
}

// ---------- practice ----------
function drill(g, app, t) {
  const D = app.drill ?? { sel: 0, player: 0, partner: 0, venue: 0 }, v = VENUES[D.venue];
  backdrop(g, t, { colours: v.colours, surface: v.surface });
  header(g, app, 'PRACTICE', 'NO SCORE, NO CROWD: GROOVE THE SWINGS');
  const me = PLAYERS[D.player], partner = D.partner ? PLAYERS[(D.partner - 1) % PLAYERS.length] : null;
  panel(g, 60, 180, 980, 815);
  const rows = [
    ['YOU', up(me.name)],
    ['ACROSS THE NET', partner ? `HITTING PARTNER: ${up(partner.short)}` : 'THE BALL MACHINE'],
    ['COURT', `${up(v.name)} · ${up(SURFACE_LABEL[v.surface])}`],
  ];
  rows.forEach(([l, val], k) => {
    const y = 240 + k * 150, sel = D.sel === k;
    valueRow(g, t, k, l, sel, 110, y, 880, 80, s => text(g, val, 550, y + 54, 34, s ? COL.ink : COL.white, { wgt: 800, align: 'center', max: 620 }));
  });
  button(g, 300, 760, 500, 84, 'START', D.sel === 3, t, { i: 3 }, { size: 38 });
  panel(g, 1080, 180, 780, 815, { tint: 'purple' });
  figure(g, me, 1290, 720, 440, { t, pose: 'swing' });
  const tips = [
    ['{hit}', 'Drive: tap it as the ball arrives'],
    ['{slice}', 'Slice; with up a lob, down a drop shot'],
    ['{aim}', 'Hold a direction as you swing to aim'],
    ['', 'Early pulls it cross-court, late down the line'],
  ];
  tips.forEach(([k, s], j) => prompt(g, app, `${k} ${s}`.trim(), 1120, 800 + j * 46, 24, COL.white, 'left'));
  if (!partner) {
    // the machine itself
    g.fillStyle = '#5a33a0'; rr(g, 1560, 470, 200, 150, 14); g.fill();
    g.fillStyle = '#2a1650'; g.fillRect(1590, 620, 20, 70); g.fillRect(1710, 620, 20, 70);
    g.fillStyle = '#1b1b1b'; g.beginPath(); g.arc(1660, 520, 34, 0, TAU); g.fill();
    for (let k = 0; k < 6; k++) ball(g, 1590 + k * 28, 460 - (k % 2) * 16, 14);
  } else figure(g, partner, 1660, 700, 330, { t: t + 1, mirror: true });
  footer(g, app, '{menu} Choose   {change} Change   {start} Start   {back} Title', t);
}

const SCREENS = {
  title, create: createScreen, pick, tour: tourScreen, draw: drawScreen_, rankings: rankingsScreen, player: playerScreen,
  prematch, pause, changeover, result, trophy: trophyScreen, season, entry, records, options, exhibition, drill,
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
  return hitAt(app?.state, x, y);
}
export { safe as _safe, CAMERAS };
