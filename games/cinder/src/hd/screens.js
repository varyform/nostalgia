// The screens: the title (Wren running the sunset path behind the menu, how to play and the
// lantern roll of best scores on a turning page), initials for the roll, pause, game over and
// the ending at dawn. The title and pause menus record their rectangles in `menuRects`, so a
// tap finds what the screen drew (the renderer's menuAt).
import { savedAgo } from '@nostalgia/save';
import { STRIDE } from './poses.js';
import { DIM, EMBER, GOLD, HEAD, INK, RED, banner, brush, label, legend, panel, prompt, shade } from './hud.js';
import { TAU, alpha } from './scenery.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const ITEM = { continue: 'CONTINUE', play: 'NEW GAME', new: 'NEW GAME', scores: 'SCORES', exit: 'EXIT' };
const PAUSE = { resume: 'RESUME', quit: 'QUIT TO TITLE' };
export const menuRects = [];
const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');

// a world for the title: the dusk path, Wren running it, the camera keeping pace
const TITLE_SIM = { scenes: [{ theme: 'dusk' }] };
const titleState = { scene: 0, t: 0, cam: 0, hero: { id: 'title-wren', kind: 'hero', x: 0, face: 1, stance: 'run', move: 'run', moveT: 0, phase: 0, hp: 4, maxHp: 4 }, foes: [], gates: [], darts: [], archer: null, teacher: null };
const pace = 2.6;

function logo(ui, x, y, size, t) {
  const { g, u } = ui;
  g.font = `400 ${Math.round(size * u)}px ${HEAD}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = 14 * u + 'px';
  // a glow that breathes like coals
  g.save(); g.shadowColor = alpha('#ff7a2a', 0.55 + Math.sin(t * 1.7) * 0.15); g.shadowBlur = 40 * u;
  g.fillStyle = 'rgba(20,6,2,0.65)'; g.fillText('CINDER', x + 5 * u, y + 7 * u);
  g.restore();
  const gr = g.createLinearGradient(0, y - size * u * 0.75, 0, y);
  gr.addColorStop(0, '#fff0c8'); gr.addColorStop(0.45, '#ffb050'); gr.addColorStop(0.75, '#e8541c'); gr.addColorStop(1, '#7a1c0a');
  g.fillStyle = gr; g.fillText('CINDER', x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.textAlign = 'left';
}
function menu(ctx, app, x, y, t) {
  const { ui } = ctx, { g, u } = ui, items = app.items?.() ?? ['play'];
  items.forEach((it, k) => {
    const sel = k === app.menu, yy = y + k * 80 * u, w = 440 * u, h = 60 * u;
    menuRects.push({ x: x - w / 2, y: yy - h / 2, w, h, i: k });
    if (sel) {
      brush(ui, x, yy, w, h * 0.95, 'rgba(120,30,10,0.55)', k + 3);
      g.strokeStyle = alpha(EMBER, 0.55 + Math.sin(t * 5) * 0.25); g.lineWidth = 2 * u;
      g.beginPath(); g.moveTo(x - w * 0.42, yy + h * 0.42); g.lineTo(x + w * 0.42, yy + h * 0.42); g.stroke();
    }
    label(ui, ITEM[it] ?? String(it).toUpperCase(), x, yy + 12 * u, 36, sel ? GOLD : DIM, { font: HEAD, align: 'center', spacing: 4 });
    if (it === 'continue' && app.saved) label(ui, `${app.saved.label ?? ''}${app.saved.at ? ' · ' + savedAgo(app.saved.at) : ''}`.toUpperCase(), x, yy + 44 * u, 17, DIM, { align: 'center', spacing: 2 });
  });
}
function howTo(ui, app, x0, y0, w) {
  const u = ui.u;
  label(ui, 'THE WAY UP', x0 + w / 2, y0 + 64 * u, 34, GOLD, { font: HEAD, align: 'center', spacing: 4 });
  const rows = [
    ['{stance}', 'Run ⇄ guard. Quick, but one blow fells you'],
    ['{walk}', 'Step. Hold back to block, with down: low'],
    ['{punch} {kick}', 'Strike mid · with up high · with down low'],
    ['{punch} {kick}', 'Three blows in a row end in a finisher'],
    ['{kick}', 'Toward: flying kick · away: spinning kick · and down: sweep'],
    ['{punch}', 'Toward: uppercut, which knocks a foe down'],
    ['{down}', 'Duck under high blows and darts'],
    ['{walk}', 'Back twice: backflip away · up twice: sway'],
    ['{bow}', 'Bow, standing in run stance'],
  ];
  rows.forEach(([keys, text], k) => {
    const y = y0 + 128 * u + k * 44 * u;
    prompt(ui, app.input, keys, x0 + 150 * u, y, 22, INK, 'right');
    label(ui, text, x0 + 176 * u, y + 8 * u, 20, DIM, { wgt: 700 });
  });
  label(ui, 'Rest in run stance, far from any foe: your flames rekindle', x0 + w / 2, y0 + 556 * u, 19, EMBER, { align: 'center', wgt: 700 });
}
function scores(ui, app, x0, y0, w, t) {
  const u = ui.u;
  label(ui, 'THE LANTERN ROLL', x0 + w / 2, y0 + 64 * u, 34, GOLD, { font: HEAD, align: 'center', spacing: 4 });
  (app.save?.table ?? []).slice(0, 8).forEach((e, k) => {
    const y = y0 + 130 * u + k * 50 * u, hl = k === app.rank, col = hl ? (Math.floor(t * 4) % 2 ? GOLD : INK) : INK;
    label(ui, `${k + 1}`, x0 + w * 0.16, y, 22, DIM, { align: 'right' });
    label(ui, e.n, x0 + w * 0.23, y, 28, col, { font: HEAD, spacing: 5 });
    label(ui, pad6(e.s), x0 + w * 0.66, y, 26, col, { align: 'right', spacing: 2 });
    label(ui, `SCENE ${Math.min(7, (e.c ?? 0) + 1)}`, x0 + w * 0.88, y, 19, DIM, { align: 'right', spacing: 2 });
  });
}
function title(ctx, app, t, dt) {
  const { ui } = ctx, { cw, u } = ui;
  const h = titleState.hero;
  h.x = t * pace; h.phase = (h.x / STRIDE.run) % 1; h.moveT = t;
  titleState.cam = h.x + 0.45; titleState.t = t;
  ctx.drawWorld(TITLE_SIM, titleState, t, dt);
  ui.g.setTransform(1, 0, 0, 1, 0, 0);
  shade(ui, 0.18);
  const lx = cw * 0.24;
  logo(ui, lx, 270 * u, 170, t);
  label(ui, 'THE CLIMB TO THE KEEP', lx, 330 * u, 22, INK, { align: 'center', spacing: 9, shadow: true });
  menu(ctx, app, lx, 560 * u, t);
  const px = cw * 0.56, pw = cw * 0.39, py = 120 * u, ph = 600 * u;
  panel(ui, px, py, pw, ph);
  if ((app.page ?? 0) === 0) howTo(ui, app, px, py, pw); else scores(ui, app, px, py, pw, t);
  legend(ui, app.input, [[['sound', app.soundOn ? 'Sound on' : 'Sound off'], ['fullscreen', 'Full screen'], ...(app.onExit ? [['quit', 'Exit']] : [])]], px + pw / 2, 780 * u, 20);
  prompt(ui, app.input, '{start} Begin', px + pw / 2, 860 * u, 26, Math.floor(t * 2) % 2 ? GOLD : INK);
}
function entry(ctx, app, t, dt) {
  const { ui } = ctx, { g, cw, u } = ui, s = app.sim?.s;
  if (s) ctx.drawWorld(app.sim, s, s.t ?? t, dt); else title(ctx, app, t, dt);
  g.setTransform(1, 0, 0, 1, 0, 0);
  shade(ui, 0.6);
  logo(ui, cw / 2, 200 * u, 110, t);
  const pw = 860 * u, px = cw / 2 - pw / 2;
  panel(ui, px, 270 * u, pw, 600 * u, 0.75);
  label(ui, 'A NAME FOR THE LANTERN ROLL', cw / 2, 350 * u, 36, GOLD, { font: HEAD, align: 'center', spacing: 3 });
  label(ui, `SCORE ${pad6(s?.score ?? 0)}`, cw / 2, 410 * u, 26, INK, { align: 'center', spacing: 3 });
  label(ui, 'YOUR INITIALS', cw / 2, 480 * u, 22, DIM, { align: 'center', spacing: 4 });
  const E = app.entry ?? { letters: [0, 0, 0], pos: 0 };
  for (let k = 0; k < 3; k++) {
    const x = cw / 2 + (k - 1) * 150 * u, sel = k === E.pos;
    g.fillStyle = sel ? 'rgba(255,154,68,0.16)' : 'rgba(255,240,220,0.05)';
    g.beginPath(); g.roundRect(x - 58 * u, 520 * u, 116 * u, 150 * u, 10 * u); g.fill();
    if (sel) { g.strokeStyle = alpha(EMBER, 0.6 + Math.sin(t * 6) * 0.3); g.lineWidth = 3 * u; g.stroke(); }
    label(ui, LETTERS[E.letters[k]] ?? 'A', x, 630 * u, 92, sel ? GOLD : INK, { font: HEAD, align: 'center' });
  }
  prompt(ui, app.input, '{letters} Letters    {punch} Next    {start} Done', cw / 2, 790 * u, 24, DIM);
}
function pause(ctx, app, t) {
  const { ui } = ctx, { g, cw, ch, u } = ui;
  shade(ui, 0.55);
  brush(ui, cw / 2, ch * 0.3, 760 * u, 150 * u, 'rgba(10,4,2,0.7)', 5);
  label(ui, 'PAUSED', cw / 2, ch * 0.3 + 30 * u, 84, INK, { font: HEAD, align: 'center', spacing: 10 });
  const items = app.pauseItems?.() ?? ['resume', 'quit'];
  items.forEach((it, k) => {
    const sel = k === (app.pauseMenu ?? 0), yy = ch * 0.48 + k * 78 * u, w = 480 * u, h = 60 * u, x = cw / 2;
    menuRects.push({ x: x - w / 2, y: yy - h / 2, w, h, i: k });
    if (sel) brush(ui, x, yy, w, h * 0.95, 'rgba(120,30,10,0.55)', k + 7);
    const text = it === 'sound' ? `SOUND ${app.soundOn ? 'ON' : 'OFF'}` : PAUSE[it] ?? String(it).toUpperCase();
    label(ui, text, x, yy + 12 * u, 34, sel ? GOLD : DIM, { font: HEAD, align: 'center', spacing: 4 });
  });
  void g; void t;
}
function over(ctx, app, s, t) {
  const { ui } = ctx, k = s.statusT ?? 0;
  shade(ui, Math.min(0.5, k * 0.4));
  banner(ui, 'GAME OVER', `The last lantern goes out  ·  ${pad6(s.score)}`, Math.min(k * 1.5, 1), RED);
  if (app.state === 'over' && (app.stT ?? 9) > 1.2) prompt(ui, app.input, '{start} Continue', ui.cw / 2, ui.ch * 0.88, 24, Math.floor(t * 2) % 2 ? GOLD : INK);
}
function won(ctx, app, s, t) {
  const { ui } = ctx, { g, cw, ch, u } = ui, k = s.statusT ?? 0, a = Math.min(1, Math.max(0, (k - 1.2) * 0.8));
  if (a <= 0) return;
  // the dawn's warmth over everything, then the words
  const gr = g.createLinearGradient(0, 0, 0, ch);
  gr.addColorStop(0, `rgba(255,210,160,${0.18 * a})`); gr.addColorStop(0.6, 'rgba(255,210,160,0)');
  g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
  g.globalAlpha = a;
  brush(ui, cw / 2, ch * 0.26, 1200 * u, 230 * u, 'rgba(14,6,4,0.62)', 9);
  label(ui, 'DAWN', cw / 2, ch * 0.26 + 10 * u, 110, '#fff0d0', { font: HEAD, align: 'center', spacing: 24, shadow: true });
  label(ui, 'The Ash Regent has fallen. Master Oriel walks free.', cw / 2, ch * 0.26 + 72 * u, 26, INK, { align: 'center', spacing: 1, shadow: true });
  label(ui, `SCORE  ${pad6(s.score)}`, cw / 2, ch * 0.26 + 118 * u, 26, GOLD, { align: 'center', spacing: 4, shadow: true });
  g.globalAlpha = 1;
  if (app.state === 'won' && (app.stT ?? 9) > 2) prompt(ui, app.input, '{start} Continue', cw / 2, ch * 0.88, 24, Math.floor(t * 2) % 2 ? GOLD : INK);
}

/** whatever screen goes over (or instead of) the world for app.state */
export function drawScreens(ctx, app, t, dt) {
  menuRects.length = 0;
  const st = app.state, s = app.sim?.s;
  if (st === 'title') return title(ctx, app, t, dt);
  if (st === 'entry') return entry(ctx, app, t, dt);
  if (!s) return;
  if (st === 'over' || s.status === 'over') over(ctx, app, s, t);
  else if (st === 'won' || s.status === 'won') won(ctx, app, s, t);
  if (st === 'pause') pause(ctx, app, t);
  void TAU;
}
