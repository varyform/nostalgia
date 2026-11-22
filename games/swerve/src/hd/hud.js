// The match HUD, in the 1920 × 1080 virtual space (render.js sets the transform): the score
// bug (clock, short names in kit colours, the score, the half), the radar of the whole pitch
// with every player and the ball, the GOAL! banner with the scorer and the minute, toasts for
// cards and penalties, the controlled player's name, the shoot-out panel, half-time and
// full-time captions while the app's own panel isn't up, and a hint for the user's set pieces.
// The aim arrow, the kick charge, the aftertouch hint and cards over heads are drawn in canvas
// pixels over the pitch (they belong to a spot on it).
import { drawPrompt } from '@nostalgia/input';
import { radarPitch } from './pitch.js';
import { PITCH } from '../sim.js';
import { TAU, alpha, clamp, luma, mix } from './fx.js';

export const FONT = "'Saira Condensed', 'Arial Narrow', 'Roboto Condensed', sans-serif";
export const NAVY = '#0d1b2a', PANEL = 'rgba(13,27,42,0.84)', YELLOW = '#ffd23f', INK = '#f4f1e6', DIM = 'rgba(244,241,230,0.62)';
export const RED = '#e5383b', GREEN = '#4fd16a', CYAN = '#56d4ff';
/** the marker colour of each human side */
export const SIDE_COL = [YELLOW, CYAN];

export function text(g, s, x, y, size, col, { wgt = 700, align = 'left', spacing = 0, shadow = true, base = 'alphabetic', max } = {}) {
  g.font = `${wgt} ${Math.round(size)}px ${FONT}`;
  g.textAlign = align; g.textBaseline = base;
  if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
  if (shadow) { g.fillStyle = 'rgba(0,0,0,0.5)'; if (max) g.fillText(s, x + 2, y + 3, max); else g.fillText(s, x + 2, y + 3); }
  g.fillStyle = col;
  if (max) g.fillText(s, x, y, max); else g.fillText(s, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
}
const width = (g, s, size, wgt = 700, spacing = 0) => {
  g.font = `${wgt} ${Math.round(size)}px ${FONT}`;
  if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
  const w = g.measureText(s).width;
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  return w;
};
/** a panel with its right corners cut: the HUD's one shape */
export function slab(g, x, y, w, h, fill = PANEL, cut = 12) {
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w - cut, y + h); g.lineTo(x, y + h); g.closePath();
  g.fillStyle = fill; g.fill();
}
/** a kit's two colours as a small upright chip */
function chip(g, x, y, w, h, kit) {
  g.fillStyle = kit?.shirt ?? '#888888'; g.fillRect(x, y, w, h);
  g.fillStyle = kit?.shorts ?? kit?.trim ?? '#ffffff'; g.fillRect(x, y + h * 0.62, w, h * 0.38);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
}
const shortOf = (team, i) => (team?.short ?? (i ? 'AWY' : 'HOM')).toUpperCase().slice(0, 3);
const HALF = { 1: '1ST HALF', 2: '2ND HALF', 3: 'EXTRA TIME', 4: 'EXTRA TIME', 5: 'PENALTIES' };
const prompt = (g, app, s, x, y, size, col = INK) => {
  if (!app.input) return;
  try { drawPrompt(g, app.input, s, x, y, { font: `700 ${size}px ${FONT}`, size: size * 1.3, color: col, align: 'center', letterSpacing: 1, style: { font: FONT } }); } catch { /* an unknown action: no hint */ }
};

// ---------- the score bug ----------
function scoreBug(g, s, teams, t, H) {
  const x = 40, y = 34, h = 54;
  // the clock
  const min = clamp(s.minute | 0, 0, 999), clock = s.half === 5 ? 'PENS' : `${min}'`;
  g.fillStyle = YELLOW; g.fillRect(x, y, 96, h);
  text(g, clock, x + 48, y + 40, 36, NAVY, { wgt: 800, align: 'center', shadow: false });
  let X = x + 96;
  const pop = clamp(1 - (H.scoreT ?? 9) / 0.6, 0, 1);
  for (let i = 0; i < 2; i++) {
    const tm = teams?.[i];
    if (i === 1) { // the score between the names
      const sc = `${s.score?.[0] ?? 0}–${s.score?.[1] ?? 0}`;
      g.fillStyle = pop > 0 ? mix('#f4f1e6', YELLOW, pop) : INK; g.fillRect(X, y, 104, h);
      text(g, sc, X + 52, y + 41, 40, NAVY, { wgt: 800, align: 'center', shadow: false });
      X += 104;
    }
    g.fillStyle = PANEL; g.fillRect(X, y, 96, h);
    chip(g, i ? X + 82 : X + 6, y + 8, 8, h - 16, tm?.kit);
    text(g, shortOf(tm, i), X + 48, y + 40, 34, INK, { wgt: 700, align: 'center', spacing: 2, shadow: false });
    X += 96;
  }
  g.beginPath(); g.moveTo(X, y); g.lineTo(X + 14, y); g.lineTo(X, y + h); g.closePath(); g.fillStyle = PANEL; g.fill();
  // the half under it
  const label = HALF[s.half] ?? '';
  if (label) { slab(g, x, y + h, 200, 28, 'rgba(13,27,42,0.7)', 10); text(g, label, x + 12, y + h + 21, 19, DIM, { wgt: 700, spacing: 2, shadow: false }); }
  if (s.pens) text(g, `PENS ${s.pens[0]}–${s.pens[1]}`, x + 212, y + h + 21, 19, YELLOW, { wgt: 700, spacing: 2 });
  void t;
}

// ---------- the radar ----------
const RW = 132, RH = 204;
function radar(ui, g, s, teams, view, t, H) {
  const x = 1920 - 40 - RW, y = 34, kx = RW / PITCH.W, ky = RH / PITCH.L;
  g.fillStyle = 'rgba(13,27,42,0.7)'; g.fillRect(x - 8, y - 8, RW + 16, RH + 16);
  const px = Math.round(RW * ui.su), py = Math.round(RH * ui.su);
  if (!H.radar || H.radar.width !== px) H.radar = radarPitch(px, py);
  g.drawImage(H.radar, x, y, RW, RH);
  // the camera's band
  if (view) {
    const y0 = clamp(view.y0, -2, PITCH.L + 2), y1 = clamp(view.y1, -2, PITCH.L + 2);
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1.5; g.strokeRect(x - 3, y + y0 * ky, RW + 6, (y1 - y0) * ky);
  }
  const ps = s.players ?? [];
  for (let pass = 0; pass < 2; pass++) for (const p of ps) {
    if (p.off || !!p.human !== (pass === 1)) continue;
    const kit = teams?.[p.team]?.kit, gk = p.slot === 0, col = gk ? teams?.[p.team]?.gk?.shirt ?? kit?.shirt : kit?.shirt;
    const X = x + clamp(p.x, -1, PITCH.W + 1) * kx, Y = y + clamp(p.y, -1, PITCH.L + 1) * ky, r = p.human ? 5.5 : 4.2;
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.beginPath(); g.arc(X, Y, r + 1.6, 0, TAU); g.fill();
    g.fillStyle = col ?? INK; g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill();
    if (p.human) { g.strokeStyle = SIDE_COL[p.team] ?? INK; g.lineWidth = 2; g.beginPath(); g.arc(X, Y, r + 3.5 + Math.sin(t * 6), 0, TAU); g.stroke(); }
  }
  const b = s.ball;
  if (b) {
    const X = x + clamp(b.x, -1, PITCH.W + 1) * kx, Y = y + clamp(b.y, -2, PITCH.L + 2) * ky;
    g.fillStyle = '#000000'; g.beginPath(); g.arc(X, Y, 4.6, 0, TAU); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(X, Y, 3, 0, TAU); g.fill();
  }
}

// ---------- banners ----------
/** GOAL! across the screen in the scorers' colour, the scorer and the minute under it */
function goalBanner(g, G, teams) {
  const age = G.t, dur = 3.6;
  if (age > dur) return;
  const kit = teams?.[G.team]?.kit, col = kit?.shirt ?? YELLOW, ink = luma(col) > 0.62 ? NAVY : INK;
  const a = clamp(Math.min(age * 5, (dur - age) * 3), 0, 1), slide = (1 - clamp(age * 4, 0, 1)) * 500;
  const y = 300, h = 190;
  g.save(); g.globalAlpha = a;
  g.translate(slide, 0);
  // the band, skewed
  g.beginPath(); g.moveTo(180, y - h / 2); g.lineTo(1920, y - h / 2); g.lineTo(1740, y + h / 2); g.lineTo(0, y + h / 2); g.closePath();
  g.fillStyle = alpha(col, 0.92); g.fill();
  g.fillStyle = YELLOW; g.fillRect(0, y - h / 2 - 8, 1920, 8); g.fillRect(0, y + h / 2, 1920, 8);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y + h / 2 - 46, 1920, 46);
  // the word, punched in
  const k = age < 0.18 ? 1.5 - (age / 0.18) * 0.5 : 1 + Math.sin(Math.min(1, (age - 0.18) * 3) * Math.PI) * 0.04;
  g.save(); g.translate(960, y + 18); g.scale(k, k); g.transform(1, 0, -0.18, 1, 0, 0);
  text(g, G.own ? 'OWN GOAL!' : 'GOAL!', 0, 0, 150, ink, { wgt: 800, align: 'center', spacing: 10 });
  g.restore();
  const sub = `${(G.name ?? '').toUpperCase()}${G.minute != null ? `  ${G.minute}'` : ''}${G.pen ? '  (PEN)' : ''}`;
  text(g, sub, 960, y + h / 2 - 12, 38, ink === NAVY ? NAVY : INK, { wgt: 700, align: 'center', spacing: 4, shadow: ink !== NAVY });
  g.restore();
}
/** a short note low in the middle: a card, a penalty */
function toast(g, T) {
  if (T.t > T.dur) return;
  const a = clamp(Math.min(T.t * 6, (T.dur - T.t) * 4), 0, 1), w = Math.max(360, width(g, T.text, 34, 700, 3) + 120), x = 960 - w / 2, y = 860;
  g.save(); g.globalAlpha = a;
  slab(g, x, y, w, 64, PANEL, 16);
  if (T.card) { g.fillStyle = T.card; g.save(); g.translate(x + 40, y + 32); g.rotate(-0.12); g.fillRect(-13, -20, 26, 38); g.restore(); }
  else { g.fillStyle = T.col ?? YELLOW; g.fillRect(x, y, 8, 64); }
  text(g, T.text, 960 + (T.card ? 20 : 0), y + 44, 34, T.col ?? INK, { wgt: 700, align: 'center', spacing: 3 });
  g.restore();
}
/** a caption over the pitch: HALF TIME, FULL TIME, with the score */
export function caption(g, title, sub, a = 1) {
  if (a <= 0) return;
  g.save(); g.globalAlpha = clamp(a, 0, 1);
  const y = 420;
  g.beginPath(); g.moveTo(560, y - 70); g.lineTo(1400, y - 70); g.lineTo(1360, y + 70); g.lineTo(520, y + 70); g.closePath();
  g.fillStyle = 'rgba(13,27,42,0.86)'; g.fill();
  g.fillStyle = YELLOW; g.fillRect(540, y - 76, 860, 6);
  text(g, title, 960, y + 4, 76, YELLOW, { wgt: 800, align: 'center', spacing: 8 });
  if (sub) text(g, sub, 960, y + 52, 32, INK, { wgt: 700, align: 'center', spacing: 4 });
  g.restore();
}

// ---------- the shoot-out ----------
function shootout(g, so, s, teams, t) {
  const kicks = so.kicks ?? [[], []], n = Math.max(5, kicks[0].length, kicks[1].length), shown = Math.min(n, 10);
  const r = shown > 7 ? 13 : 16, gap = r * 2 + 10, w = 180 + shown * gap + 110, x = 960 - w / 2, y = 120;
  g.fillStyle = 'rgba(13,27,42,0.86)'; g.fillRect(x, y, w, 120);
  g.fillStyle = YELLOW; g.fillRect(x, y, w, 5);
  for (let i = 0; i < 2; i++) {
    const row = kicks[i] ?? [], Y = y + 38 + i * 50, tm = teams?.[i], from = Math.max(0, n - shown);
    chip(g, x + 22, Y - 15, 8, 30, tm?.kit);
    text(g, shortOf(tm, i), x + 40, Y + 12, 32, INK, { wgt: 700, spacing: 2, shadow: false });
    if (so.next === i && !(s.phase === 'over')) { const k = 0.6 + 0.4 * Math.sin(t * 8); g.fillStyle = alpha(YELLOW, k); g.beginPath(); g.moveTo(x + 6, Y - 9); g.lineTo(x + 16, Y); g.lineTo(x + 6, Y + 9); g.fill(); }
    for (let j = 0; j < shown; j++) {
      const v = row[from + j], X = x + 130 + j * gap + r;
      g.lineWidth = 3;
      if (v === true) { g.fillStyle = GREEN; g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill(); g.strokeStyle = NAVY; g.beginPath(); g.moveTo(X - r * 0.45, Y); g.lineTo(X - r * 0.1, Y + r * 0.38); g.lineTo(X + r * 0.5, Y - r * 0.38); g.stroke(); }
      else if (v === false) { g.fillStyle = RED; g.beginPath(); g.arc(X, Y, r, 0, TAU); g.fill(); g.strokeStyle = INK; g.beginPath(); g.moveTo(X - r * 0.4, Y - r * 0.4); g.lineTo(X + r * 0.4, Y + r * 0.4); g.moveTo(X + r * 0.4, Y - r * 0.4); g.lineTo(X - r * 0.4, Y + r * 0.4); g.stroke(); }
      else { g.strokeStyle = 'rgba(244,241,230,0.35)'; g.beginPath(); g.arc(X, Y, r - 1.5, 0, TAU); g.stroke(); }
    }
    const goals = row.filter(Boolean).length;
    text(g, String(goals), x + w - 50, Y + 14, 40, YELLOW, { wgt: 800, align: 'center', shadow: false });
  }
}

// ---------- the controlled player ----------
function names(g, s, teams, touch) {
  const ctl = s.control ?? [];
  let slot = 0;
  for (let i = 0; i < 2; i++) {
    const p = s.players?.[ctl[i]];
    if (!p?.human) continue;
    const tm = teams?.[i], label = `${p.num ?? ''}  ${(p.name ?? '').toUpperCase()}`, w = Math.max(220, width(g, label, 32, 700, 2) + 70);
    const right = slot === 1, X = right ? 1880 - w : 40, Y = touch ? (right ? 262 : 130) : 1000;
    slab(g, X, Y, w, 50, PANEL, 12);
    g.fillStyle = SIDE_COL[i]; g.fillRect(X, Y, 8, 50);
    chip(g, X + 18, Y + 10, 8, 30, tm?.kit);
    text(g, label, X + 38, Y + 37, 32, INK, { wgt: 700, spacing: 2, shadow: false });
    slot++;
  }
}

/** the whole HUD over the match; H: the renderer's HUD memory ({ goal, toast, scoreT, radar }) */
export function drawHud(ui, app, match, H, t, view) {
  const { g } = ui, s = match.s, teams = app.teams ?? match.teams, demo = !!app.demo, touch = !!app.touch?.active;
  scoreBug(g, s, teams, t, H);
  radar(ui, g, s, teams, view, t, H);
  if (s.shootout) shootout(g, s.shootout, s, teams, t);
  if (H.goal) goalBanner(g, H.goal, teams);
  if (H.toast) toast(g, H.toast);
  // H/T and F/T on the pitch until the app puts its own panel up
  if (app.state === 'match' || app.state === 'demo') {
    const sc = `${shortOf(teams?.[0], 0)}  ${s.score?.[0] ?? 0} – ${s.score?.[1] ?? 0}  ${shortOf(teams?.[1], 1)}`;
    if (s.phase === 'halftime') caption(g, 'HALF TIME', sc, Math.min(1, (s.phaseT ?? 1) * 3));
    else if (s.phase === 'fulltime' || (s.phase === 'over' && !s.shootout)) caption(g, 'FULL TIME', sc, Math.min(1, (s.phaseT ?? 1) * 3));
    else if (s.phase === 'over' && s.shootout) caption(g, 'SHOOT-OUT OVER', sc + (s.pens ? `  (${s.pens[0]}–${s.pens[1]} PENS)` : ''), Math.min(1, (s.phaseT ?? 1) * 3));
  }
  if (demo) {
    if (Math.floor(t * 1.5) % 2) text(g, 'DEMO', 960, 1040, 34, YELLOW, { wgt: 800, align: 'center', spacing: 10 });
    return;
  }
  names(g, s, teams, touch);
  // the user's set piece: how to take it
  const sp = s.setpiece, tk = sp ? s.players?.[sp.taker] : null;
  if (sp && tk?.human && !touch) {
    const what = { throw: 'THROW-IN', corner: 'CORNER', goalkick: 'GOAL KICK', freekick: 'FREE KICK', penalty: 'PENALTY', kickoff: 'KICK-OFF' }[sp.kind] ?? '';
    prompt(g, app, `${what}:  AIM, THEN {kick}  TAP SHORT · HOLD LONG`, 960, 1012, 26, INK);
  }
}

// ---------- over the pitch, in canvas pixels ----------
/** the set-piece aim: chevrons along the ground from the ball */
export function aimArrow(g, v, x, y, aim, t, col = YELLOW, len = 7) {
  const P = v.P, ca = Math.cos(aim), sa = Math.sin(aim), n = 5;
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < n; i++) {
    const q = ((i + (t * 2.2) % 1) / n), d = 0.9 + q * len, X = v.X(x + ca * d), Y = v.Y(y + sa * d, 0), s = 0.55 * P * (1 - q * 0.35);
    const a = clamp(Math.sin(q * Math.PI) * 1.3, 0, 1);
    const px = -sa, py = ca;
    g.strokeStyle = `rgba(0,0,0,${(0.35 * a).toFixed(3)})`; g.lineWidth = 0.26 * P;
    const draw = (ox, oy) => { g.beginPath(); g.moveTo(X + (px * s - ca * s * 0.7) + ox, Y + (py * s - sa * s * 0.7) + oy); g.lineTo(X + ox, Y + oy); g.lineTo(X + (-px * s - ca * s * 0.7) + ox, Y + (-py * s - sa * s * 0.7) + oy); g.stroke(); };
    draw(0.08 * P, 0.1 * P);
    g.strokeStyle = alpha(col, a); g.lineWidth = 0.18 * P; draw(0, 0);
  }
  g.restore();
}
/** the kick's charge: a small bar over the kicker, green through gold to red */
export function chargeBar(g, x, y, q, s) {
  const w = 54 * s, h = 9 * s, X = x - w / 2, Y = y - h - 4 * s;
  g.fillStyle = 'rgba(6,14,24,0.82)'; g.beginPath(); g.roundRect(X - 2 * s, Y - 2 * s, w + 4 * s, h + 4 * s, 3 * s); g.fill();
  const c = q < 0.6 ? mix(GREEN, YELLOW, q / 0.6) : mix(YELLOW, RED, (q - 0.6) / 0.4);
  g.fillStyle = c; g.fillRect(X, Y, w * clamp(q, 0, 1), h);
  g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(X, Y, w * clamp(q, 0, 1), h * 0.4);
  return Y - 2 * s;
}
/** aftertouch: two bending arrows either side of the ball while the window is open */
export function afterHint(g, X, Y, R, ang, a, t) {
  if (a <= 0) return;
  g.save(); g.globalAlpha = clamp(a, 0, 1); g.lineCap = 'round';
  const r = R * 3.2 + Math.sin(t * 14) * R * 0.2;
  for (const side of [-1, 1]) {
    const c = ang + side * Math.PI / 2, a0 = c - 0.55, a1 = c + 0.55;
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = R * 0.7; g.beginPath(); g.arc(X, Y, r, a0, a1); g.stroke();
    g.strokeStyle = YELLOW; g.lineWidth = R * 0.42; g.beginPath(); g.arc(X, Y, r, a0, a1); g.stroke();
    const e = side > 0 ? a1 : a0, ex = X + Math.cos(e) * r, ey = Y + Math.sin(e) * r, td = e + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.fillStyle = YELLOW; g.beginPath();
    g.moveTo(ex + Math.cos(td) * R * 1.1, ey + Math.sin(td) * R * 1.1);
    g.lineTo(ex + Math.cos(td + 2.4) * R * 0.9, ey + Math.sin(td + 2.4) * R * 0.9);
    g.lineTo(ex + Math.cos(td - 2.4) * R * 0.9, ey + Math.sin(td - 2.4) * R * 0.9);
    g.closePath(); g.fill();
  }
  g.restore();
}
/** a card held up over a player */
export function cardPop(g, x, y, colour, age, s) {
  const a = clamp(Math.min(age * 6, (2.4 - age) * 3), 0, 1);
  if (a <= 0) return;
  g.save(); g.globalAlpha = a; g.translate(x, y - 8 * s - Math.min(1, age * 4) * 6 * s); g.rotate(-0.15);
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(-7 * s + 2, -20 * s + 2, 14 * s, 20 * s);
  g.fillStyle = colour === 'red' ? RED : YELLOW; g.fillRect(-7 * s, -20 * s, 14 * s, 20 * s);
  g.restore();
}
