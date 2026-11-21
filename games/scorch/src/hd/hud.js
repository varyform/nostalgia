// The race HUD over the view: place and lap with the race clock (top left), the mini-map with
// every car on it (top right), armour, ammo, mines, turbo charges and cash picked up (bottom
// left, or under the place while the touch buttons need that corner), the countdown, the FINAL
// LAP / WRECKED / FINISHED banners, rivals' name tags, and the touch buttons from app.touch.
// `ui` is the renderer's { g, cw, ch, u (px per 1080p px), dpr }.
import { layout as touchLayout } from '../touch.js';
import { TAU, alpha, clamp, mix } from './gfx.js';

export const DISPLAY = "'Russo One','Arial Black',Impact,sans-serif";
export const UI = "'Barlow Condensed','Arial Narrow','Roboto Condensed',sans-serif";
export const INK = '#f6f1e8', DIM = 'rgba(246,241,232,0.62)', HOT = '#ff6a1f', GOLD = '#ffc93a', RED = '#ff3b2f', GREEN = '#62d66e', COOL = '#56d4ff';
const PANEL = 'rgba(14,11,10,0.66)';
export const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH');
export const clock = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };
const fmt = n => Math.round(n).toLocaleString('en-US');

export function text(ui, s, x, y, size, col, { font = UI, wgt = 700, align = 'left', spacing = 0, shadow = true, base = 'alphabetic' } = {}) {
  const { g, u } = ui;
  g.font = `${font === DISPLAY ? 400 : wgt} ${Math.round(size * u)}px ${font}`;
  g.textAlign = align; g.textBaseline = base;
  if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
  if (shadow) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText(s, x + 2 * u, y + 3 * u); }
  g.fillStyle = col; g.fillText(s, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}
/** a slanted dark panel (the corners cut at `sl` px), the HUD's one shape */
export function slab(ui, x, y, w, h, { fill = PANEL, edge = null, sl = 14 } = {}) {
  const { g, u } = ui, s = sl * u;
  g.beginPath(); g.moveTo(x + s, y); g.lineTo(x + w, y); g.lineTo(x + w - s, y + h); g.lineTo(x, y + h); g.closePath();
  g.fillStyle = fill; g.fill();
  if (edge) { g.strokeStyle = edge; g.lineWidth = 2 * u; g.stroke(); }
}

// ---------- the parts ----------
function place(ui, x, y, me, n, t, pop) {
  const { u } = ui;
  slab(ui, x, y, 230 * u, 128 * u);
  text(ui, 'POS', x + 30 * u, y + 34 * u, 20, DIM, { spacing: 3, wgt: 600 });
  const k = 1 + Math.max(0, pop) * 0.35;
  const col = me.place === 1 ? GOLD : INK;
  ui.g.save(); ui.g.translate(x + 30 * u, y + 112 * u); ui.g.scale(k, k);
  text(ui, String(me.place || '–'), 0, 0, 86, col, { font: DISPLAY });
  ui.g.restore();
  text(ui, '/' + n, x + 30 * u + (me.place >= 10 ? 104 : 60) * u, y + 108 * u, 36, DIM, { font: DISPLAY });
  void t;
}
function lap(ui, x, y, me, s, raceT, last) {
  const { u } = ui, laps = s.laps ?? 3, cur = clamp((me.lap ?? 0) + 1, 1, laps);
  slab(ui, x, y, 230 * u, 128 * u);
  text(ui, 'LAP', x + 30 * u, y + 34 * u, 20, DIM, { spacing: 3, wgt: 600 });
  text(ui, `${me.done ? laps : cur}`, x + 30 * u, y + 96 * u, 58, last ? HOT : INK, { font: DISPLAY });
  text(ui, `/${laps}`, x + (cur >= 10 ? 100 : 70) * u, y + 96 * u, 30, DIM, { font: DISPLAY });
  text(ui, clock(raceT), x + 200 * u, y + 34 * u, 22, INK, { align: 'right', wgt: 600 });
}
// armour: a bar of slanted cells, green through amber to red, pulsing when low
function armour(ui, x, y, me, t) {
  const { g, u } = ui, q = clamp(me.hp / (me.maxHp || 1), 0, 1), cells = 20, w = 400 * u, h = 26 * u, cw = w / cells;
  text(ui, 'ARMOUR', x, y - 10 * u, 20, DIM, { spacing: 3, wgt: 600 });
  text(ui, `${Math.ceil(me.hp)}`, x + w, y - 10 * u, 22, q < 0.25 ? RED : INK, { align: 'right', wgt: 700 });
  const col = q > 0.5 ? mix(GOLD, GREEN, (q - 0.5) * 2) : mix(RED, GOLD, q * 2);
  const blink = q < 0.25 ? 0.55 + 0.45 * Math.sin(t * 12) : 1;
  for (let i = 0; i < cells; i++) {
    const on = (i + 1) / cells <= q + 1e-6, part = !on && i / cells < q, X = x + i * cw;
    g.beginPath(); g.moveTo(X + 6 * u, y); g.lineTo(X + cw - 2 * u, y); g.lineTo(X + cw - 8 * u, y + h); g.lineTo(X, y + h); g.closePath();
    g.fillStyle = on ? alpha(col, blink) : part ? alpha(col, 0.5 * blink) : 'rgba(255,255,255,0.1)'; g.fill();
  }
}
export function icon(ui, kind, x, y, s, col) {
  const { g } = ui;
  g.fillStyle = col; g.strokeStyle = col;
  if (kind === 'ammo') { // three rounds
    for (let k = 0; k < 3; k++) { const X = x + k * s * 0.36; g.fillRect(X, y - s * 0.2, s * 0.24, s * 0.62); g.beginPath(); g.moveTo(X, y - s * 0.2); g.quadraticCurveTo(X + s * 0.12, y - s * 0.62, X + s * 0.24, y - s * 0.2); g.fill(); }
  } else if (kind === 'mine') {
    g.beginPath(); g.arc(x + s * 0.4, y, s * 0.36, 0, TAU); g.fill();
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; g.fillRect(x + s * 0.4 + Math.cos(a) * s * 0.42 - s * 0.06, y + Math.sin(a) * s * 0.42 - s * 0.06, s * 0.12, s * 0.12); }
    g.fillStyle = RED; g.beginPath(); g.arc(x + s * 0.4, y, s * 0.11, 0, TAU); g.fill();
  } else if (kind === 'turbo') { // a bolt
    g.beginPath(); g.moveTo(x + s * 0.5, y - s * 0.5); g.lineTo(x + s * 0.1, y + s * 0.08); g.lineTo(x + s * 0.38, y + s * 0.08); g.lineTo(x + s * 0.24, y + s * 0.5); g.lineTo(x + s * 0.68, y - s * 0.1); g.lineTo(x + s * 0.4, y - s * 0.1); g.closePath(); g.fill();
  } else if (kind === 'cash') {
    g.font = `700 ${Math.round(s)}px ${UI}`; g.textBaseline = 'middle'; g.fillText('$', x + s * 0.12, y + s * 0.04); g.textBaseline = 'alphabetic';
  }
}
function supplies(ui, x, y, me, t, flash) {
  const { u } = ui, s = 30 * u, boost = (me.boost ?? 0) > 0;
  const items = [
    ['ammo', String(me.ammo ?? 0), (me.ammo ?? 0) <= 0 ? RED : INK, 'ammo'],
    ['mine', String(me.mines ?? 0), (me.mines ?? 0) <= 0 ? DIM : INK, 'mines'],
    ['turbo', String(me.turbo ?? 0), boost ? COOL : (me.turbo ?? 0) <= 0 ? DIM : INK, 'turbo'],
    ['cash', fmt(me.cash ?? 0), GOLD, 'cash'],
  ];
  let X = x;
  for (const [k, v, col, f] of items) {
    const fl = flash[f] > 0 ? flash[f] : 0, w = (k === 'cash' ? 150 : 108) * u;
    slab(ui, X, y - 26 * u, w - 8 * u, 52 * u, { fill: fl ? alpha(mix('#0e0b0a', col === DIM ? INK : col, fl * 0.6), 0.75) : PANEL, sl: 10 });
    icon(ui, k, X + 18 * u, y, s, col === INK ? GOLD : col);
    text(ui, v, X + 58 * u, y + 11 * u, 32, col, { wgt: 700 });
    X += w;
  }
  if (boost) { // the turbo burn left, as a thin bar under its box
    const q = clamp((me.boost ?? 0) / 1.5, 0, 1);
    ui.g.fillStyle = COOL; ui.g.fillRect(x + 216 * u, y + 30 * u, 90 * u * q, 4 * u);
  }
  void t;
}
function mini(ui, x, y, size, race, M, t) {
  const { g, u } = ui, s = race.s;
  slab(ui, x - 12 * u, y - 12 * u, size + 24 * u, size + 24 * u, { sl: 18 });
  g.drawImage(M.cv, x, y, size, size);
  const k = size / M.cv.width;
  // rivals first, the player on top with a pulse
  for (let pass = 0; pass < 2; pass++) for (const c of s.cars) {
    if ((c.i === 0 || c === s.cars[0]) !== (pass === 1)) continue;
    const [mx, my] = M.map(c.x, c.y), X = x + mx * k, Y = y + my * k, me = pass === 1;
    if (c.dead) { g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2.5 * u; const r = 6 * u; g.beginPath(); g.moveTo(X - r, Y - r); g.lineTo(X + r, Y + r); g.moveTo(X + r, Y - r); g.lineTo(X - r, Y + r); g.stroke(); continue; }
    if (me) { g.fillStyle = alpha(INK, 0.25 + 0.2 * Math.sin(t * 6)); g.beginPath(); g.arc(X, Y, 16 * u, 0, TAU); g.fill(); }
    g.fillStyle = '#0c0a0a'; g.beginPath(); g.arc(X, Y, (me ? 10 : 8) * u, 0, TAU); g.fill();
    g.fillStyle = c.colour ?? INK; g.beginPath(); g.arc(X, Y, (me ? 7.5 : 6) * u, 0, TAU); g.fill();
    if (me) { g.strokeStyle = INK; g.lineWidth = 2 * u; g.beginPath(); g.arc(X, Y, 10 * u, 0, TAU); g.stroke(); }
  }
  // mines as tiny red specks
  g.fillStyle = 'rgba(255,70,50,0.8)';
  for (const m of s.mines ?? []) { const [mx, my] = M.map(m.x, m.y); g.fillRect(x + mx * k - 1.5 * u, y + my * k - 1.5 * u, 3 * u, 3 * u); }
}

/** the big centred countdown: 3, 2, 1 popping in, GO! flying out */
export function countdown(ui, label, age, col) {
  const { g, cw, ch, u } = ui;
  if (age < 0 || age > 1) return;
  const k = age < 0.15 ? 1.6 - (age / 0.15) * 0.6 : 1 + (age - 0.15) * 0.15, a = age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3;
  g.save(); g.globalAlpha = clamp(a, 0, 1); g.translate(cw / 2, ch * 0.3); g.scale(k, k);
  g.fillStyle = 'rgba(10,8,8,0.45)'; g.beginPath(); g.arc(0, -60 * u, 128 * u, 0, TAU); g.fill();
  g.strokeStyle = alpha(col, 0.35); g.lineWidth = 7 * u; g.beginPath(); g.arc(0, -60 * u, 128 * u, 0, TAU); g.stroke();
  g.strokeStyle = col; g.lineWidth = 7 * u; g.beginPath(); g.arc(0, -60 * u, 128 * u, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(1 - age, 0, 1)); g.stroke();
  text(ui, label, 0, (label.length > 1 ? 0 : 14) * u, label.length > 1 ? 110 : 180, col, { font: DISPLAY, align: 'center' });
  g.restore();
}
/** a slanted band across the screen with a word on it */
export function banner(ui, title, sub, a, col = INK, y0 = 0.3) {
  if (a <= 0) return;
  const { g, cw, ch, u } = ui, y = ch * y0, h = (sub ? 170 : 130) * u, slide = (1 - clamp(a * 1.4, 0, 1)) * cw * 0.25;
  g.save(); g.globalAlpha = clamp(a, 0, 1);
  g.beginPath(); g.moveTo(slide + 40 * u, y - h / 2); g.lineTo(cw + slide, y - h / 2); g.lineTo(cw + slide - 40 * u, y + h / 2); g.lineTo(slide, y + h / 2); g.closePath();
  g.fillStyle = 'rgba(12,9,8,0.72)'; g.fill();
  g.fillStyle = col; g.fillRect(slide, y - h / 2 - 6 * u, cw, 6 * u); g.fillRect(slide, y + h / 2, cw, 6 * u);
  text(ui, title, cw / 2 - slide * 0.5, y + (sub ? 6 : 30) * u, 92, col, { font: DISPLAY, align: 'center', spacing: 6 });
  if (sub) text(ui, sub, cw / 2 - slide * 0.5, y + 62 * u, 34, INK, { align: 'center', spacing: 4, wgt: 600 });
  g.restore();
}
/** rivals' names over their cars, with a sliver of armour */
export function tags(ui, race, toScreen) {
  const { g, u } = ui;
  for (const c of race.s.cars) {
    if (c.i === 0 || c === race.s.cars[0] || c.dead || c.done) continue;
    const [X, Y] = toScreen(c.x, c.y);
    if (X < -100 || Y < -100 || X > ui.cw + 100 || Y > ui.ch + 100) continue;
    const y = Y - 64 * u, name = (c.name ?? '').toUpperCase();
    g.font = `600 ${Math.round(20 * u)}px ${UI}`;
    const w = Math.max(70 * u, g.measureText(name).width + name.length * u + 40 * u);
    g.fillStyle = 'rgba(10,8,8,0.6)'; g.fillRect(X - w / 2, y - 18 * u, w, 30 * u);
    g.fillStyle = c.colour ?? INK; g.fillRect(X - w / 2, y - 18 * u, 5 * u, 30 * u);
    text(ui, `${c.place ?? ''}`, X - w / 2 + 17 * u, y + 4 * u, 20, GOLD, { align: 'center', shadow: false });
    text(ui, name, X - w / 2 + 30 * u, y + 4 * u, 20, INK, { wgt: 600, shadow: false, spacing: 1 });
    const q = clamp(c.hp / (c.maxHp || 1), 0, 1);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(X - w / 2, y + 12 * u, w, 4 * u);
    g.fillStyle = q > 0.5 ? GREEN : q > 0.25 ? GOLD : RED; g.fillRect(X - w / 2, y + 12 * u, w * q, 4 * u);
  }
}

/** the whole race HUD; H is the renderer's HUD memory (mini-map, pops, flashes, clocks) */
export function drawHud(ui, app, race, H, t) {
  const { cw, ch, u } = ui, s = race.s, me = s.cars[0], touch = !!app.touch?.active;
  const size = Math.round(250 * u);
  if (H.mini) mini(ui, cw - 36 * u - size, 40 * u, size, race, H.mini, t);
  if (app.demo) { // the launcher's preview: places and the map are enough
    if (Math.floor(t * 1.5) % 2) text(ui, 'DEMO', cw / 2, ch - 40 * u, 30, GOLD, { font: DISPLAY, align: 'center', spacing: 8 });
    return;
  }
  place(ui, 36 * u, 40 * u, me, s.cars.length, t, H.placePop);
  lap(ui, 276 * u, 40 * u, me, s, H.raceT, H.last);
  const by = touch ? 250 * u : ch - 120 * u;
  armour(ui, 48 * u, by, me, t);
  supplies(ui, 44 * u, by + 66 * u, me, t, H.flash);
}

// ---------- touch ----------
export function drawTouch(ui, app) {
  const T = app.touch, { g, cw, ch } = ui;
  if (!T?.active || app.state !== 'race') return;
  const L = touchLayout(cw, ch), lu = L.u ?? ui.u;
  g.lineWidth = 3 * lu;
  for (const b of [...(L.buttons ?? []), ...(L.pause ? [{ a: 'pause', ...L.pause }] : [])]) {
    const on = !!T.held?.[b.a];
    g.fillStyle = on ? alpha(HOT, 0.42) : 'rgba(246,241,232,0.1)'; g.strokeStyle = on ? alpha(HOT, 0.9) : 'rgba(246,241,232,0.38)';
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill(); g.stroke();
    const fs = Math.min(30 * lu, b.r * (b.label?.length > 2 ? 0.34 : 0.55));
    g.font = `700 ${Math.round(fs)}px ${UI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    if ('letterSpacing' in g) g.letterSpacing = 2 * lu + 'px';
    g.fillStyle = INK; g.fillText(b.label ?? b.a.toUpperCase(), b.x, b.y + fs * 0.04);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }
}
