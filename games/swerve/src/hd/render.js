// The HD renderer: Swerve's match seen from above with heights rising up the screen, in the
// largest 16:9 box (DPR ≤ 2, ≤ 2560 px; the demo at 1×, ≤ 1280 px). The whole width of the pitch
// (and a little) fills the screen, so a band of ~43 m of its length shows; the camera follows
// the ball, looking ahead the way the side on it attacks, eased by a spring and clamped to the
// pitch with the stands behind the goals; set pieces frame the taker and his aim. The ground
// and the goals are pitch.js's, the players and the ball players.js's, the effects fx.js's, the
// HUD hud.js's. Every screen that isn't the match (and the panels over a paused, half-time or
// full-time match) is screens.js's, drawn in 1920 × 1080, which also says what a tap lands on.
// It only reads `app` and `match.s`.
//
//   const view = createRenderer(canvas, app);
//   view.events(match.events, match); view.draw(app); view.menuAt(x, y); view.destroy()
import { fitWide } from '@nostalgia/game/runtime';
import { PITCH } from '../sim.js';
import { drawScreen, screenAt } from './screens.js';
import { ZK, clamp, createFx, shade } from './fx.js';
import { NAVY, RED, SIDE_COL, YELLOW, aimArrow, afterHint, cardPop, chargeBar, drawHud } from './hud.js';
import { createPitch } from './pitch.js';
import { createPlayers, lookOf } from './players.js';

const VIEW_W = 76; // metres across the screen: the pitch's 68 and a few beside each touchline
const END_MARGIN = 14; // how far past a goal line the camera may show (into the stands)
const MATCH_STATES = new Set(['match', 'demo', 'pause', 'halftime', 'fulltime']);
const FROZEN = new Set(['pause', 'halftime', 'fulltime']);
const GX0 = PITCH.W / 2 - PITCH.goalW / 2;
const ND = PITCH.goalD + 0.05; // where the nets' backs sort among the players
const FALLBACK = [
  { kit: { shirt: '#c8102e', shorts: '#ffffff', socks: '#c8102e', trim: '#ffffff', pattern: 'plain' }, gk: { shirt: '#2a9d3f', shorts: '#111111', socks: '#2a9d3f' } },
  { kit: { shirt: '#1d4fa8', shorts: '#1d4fa8', socks: '#ffffff', trim: '#ffffff', pattern: 'plain' }, gk: { shirt: '#f0c419', shorts: '#111111', socks: '#f0c419' } },
];

export function createRenderer(cv, app0) {
  const g = cv.getContext('2d', { alpha: false });
  const demo0 = !!app0?.demo;
  const ui = { g, cw: 1, ch: 1, su: 1 };
  let lastApp = app0 ?? null;
  const pitch = createPitch({ budget: demo0 ? 2e6 : 4.5e6 }), figs = createPlayers(), fx = createFx({ max: demo0 ? 300 : 900 });
  const cam = { x: PITCH.W / 2, y: PITCH.L / 2, vx: 0, vy: 0, bx: null, by: null };
  const H = { goal: null, toast: null, scoreT: 9, radar: null, cards: [] };
  const ballMem = { roll: 0, yaw: 0, trail: [] };
  let M = null, mem = [], kits = null, vignette = null, clock = 0, drawnAt = -1, lastT = performance.now();
  const frames = []; // per player, this frame's sprite choice

  const unfit = fitWide(cv, {
    maxDpr: demo0 ? 1 : 2, maxWidth: demo0 ? 1280 : 2560,
    onFit(w, h) { ui.cw = w; ui.ch = h; ui.su = h / 1080; figs.reset(w / VIEW_W); pitch.reset(); H.radar = null; vignette = null; },
  });
  let destroyed = false;
  void document.fonts?.ready.then(() => { if (!destroyed) { pitch.reset(); if (lastApp) draw(lastApp); } });

  // ---------- the match being shown ----------
  function teamsOf(app, match) { return app?.teams ?? match?.teams ?? null; }
  function setMatch(match, app) {
    M = match; mem = []; fx.clear(); ballMem.trail.length = 0;
    Object.assign(H, { goal: null, toast: null, scoreT: 9, cards: [] });
    drawnAt = -1; kits = null;
    if (!match) return;
    buildKits(app, match);
    const b = match.s.ball;
    cam.x = PITCH.W / 2; cam.y = b?.y ?? PITCH.L / 2; cam.vx = cam.vy = 0; cam.bx = cam.by = null;
  }
  function buildKits(app, match) {
    const teams = teamsOf(app, match);
    kits = [0, 1].map(i => {
      const t = teams?.[i] ?? FALLBACK[i], k = { ...FALLBACK[i].kit, ...t.kit }, gk = { ...FALLBACK[i].gk, ...t.gk };
      return { out: k, gk: { shirt: gk.shirt, shorts: gk.shorts, socks: gk.socks, trim: shade(gk.shirt, -0.35), pattern: 'plain' } };
    });
  }
  const ensure = (match, app) => { if (match !== M) setMatch(match, app); };
  function memOf(i, p) {
    let m = mem[i];
    if (!m || m.name !== p.name) {
      const team = teamsOf(lastApp, M)?.[p.team], id = p.id ?? team?.players?.[p.slot]?.id ?? `${p.team}:${p.name}:${p.num}`;
      m = mem[i] = { name: p.name, look: lookOf(id), phase: (i * 0.137) % 1, mx: p.x, my: p.y, spray: 0 };
    }
    return m;
  }

  // ---------- events → effects ----------
  function events(list, match) {
    ensure(match, lastApp);
    if (!match || !list?.length) return;
    const s = match.s, b = s.ball, live = drawnAt < 0 || s.t - drawnAt < 0.5, ps = s.players ?? [];
    for (const e of list) {
      const p = e.player != null ? ps[e.player] : null;
      switch (e.type) {
        case 'kick': {
          if (!live || !p) break;
          const pw = clamp(e.power ?? 0.5, 0, 1), d = Number.isFinite(p.dir) ? p.dir : 0, fx0 = p.x + Math.cos(d) * 0.4, fy0 = p.y + Math.sin(d) * 0.4;
          if (e.kind === 'header') break;
          fx.dust(fx0, fy0, 0.5 + pw, 2 + Math.round(pw * 3));
          if (pw > 0.7 && (e.kind === 'shot' || e.kind === 'clear' || e.kind === 'volley')) fx.spray(fx0, fy0, -Math.cos(d), -Math.sin(d), 0.5);
          break;
        }
        case 'bounce': if (live && (e.speed ?? 0) > 4 && (b?.z ?? 0) < 0.4) fx.dust(b.x, b.y, 0.4, 2); break;
        case 'post': case 'bar':
          fx.hit(e.type === 'bar' ? 0.55 : 0.45);
          if (live && b) fx.flecks(b.x, b.y, b.z ?? 1);
          if (live && b && e.type === 'bar') fx.ripple(b.y < PITCH.L / 2 ? 0 : 1, (b.x - GX0) / PITCH.goalW, 1, 0.25);
          fx.roar = Math.max(fx.roar, 0.45);
          break;
        case 'net': {
          if (!b) break;
          const sp = Math.hypot(b.vx ?? 0, b.vy ?? 0, b.vz ?? 0);
          fx.ripple(b.y < PITCH.L / 2 ? 0 : 1, (b.x - GX0) / PITCH.goalW, (b.z ?? 0) / PITCH.goalH, clamp(sp / 22, 0.3, 0.85));
          break;
        }
        case 'save': if (live && p && e.kind !== 'catch') fx.spray(p.x, p.y, -(p.vx ?? 0), -(p.vy ?? 0), 0.7); fx.roar = Math.max(fx.roar, 0.3); break;
        case 'tackle': if (live && p) fx.spray(p.x, p.y, -(p.vx ?? 0), -(p.vy ?? 0), 0.8); break;
        case 'card': {
          if (!p) break;
          H.cards.push({ player: e.player, colour: e.colour, t: 0 });
          H.toast = { text: `${(p.name ?? '').toUpperCase()} ${e.colour === 'red' ? 'SENT OFF' : 'BOOKED'}`, card: e.colour === 'red' ? RED : YELLOW, t: 0, dur: 2.8 };
          break;
        }
        case 'penalty': H.toast = { text: 'PENALTY!', col: YELLOW, t: 0, dur: 2.4 }; fx.roar = Math.max(fx.roar, 0.5); break;
        case 'pen': {
          if (e.scored) { fx.roar = Math.max(fx.roar, 0.75); fx.flashOn(0.25); }
          H.toast = { text: e.scored ? 'SCORED' : 'MISSED', col: e.scored ? YELLOW : '#f4f1e6', t: 0, dur: 1.8 };
          break;
        }
        case 'chance': fx.roar = Math.max(fx.roar, 0.35); break;
        case 'goal': {
          const sc = typeof e.scorer === 'number' ? ps[e.scorer]?.name : e.scorer;
          H.goal = { t: 0, team: e.team, name: sc ?? '', minute: e.minute ?? s.minute, own: !!e.own, pen: !!e.pen };
          H.scoreT = 0;
          fx.roar = 1;
          if (live) {
            const k = kits?.[e.team]?.out;
            fx.flashOn(0.55);
            fx.confetti(k ? [k.shirt, k.trim, k.shorts] : undefined, match === M && lastApp?.demo ? 60 : 150);
          }
          break;
        }
      }
    }
  }

  // ---------- per frame: run cycles, slide marks and spray, the ball's spin ----------
  function emit(s, dt) {
    const ps = s.players ?? [];
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.off) continue;
      const m = memOf(i, p), sp = Math.hypot(p.vx ?? 0, p.vy ?? 0);
      m.phase = (m.phase + (sp * dt) / 2.5) % 1;
      if (p.anim === 'slide' && sp > 1.5) {
        if (Math.hypot(p.x - m.mx, p.y - m.my) > 0.3) { fx.mark(m.mx, m.my, p.x, p.y); m.mx = p.x; m.my = p.y; }
        m.spray += dt * 16 * clamp(sp / 6, 0, 1);
        while (m.spray > 1) { m.spray--; fx.spray(p.x + (p.vx / sp) * 0.5, p.y + (p.vy / sp) * 0.5, -(p.vx ?? 0), -(p.vy ?? 0), 0.35); }
      } else { m.mx = p.x; m.my = p.y; }
    }
    const b = s.ball;
    if (b) {
      const sp = Math.hypot(b.vx ?? 0, b.vy ?? 0);
      ballMem.roll += sp * dt * 1.7; ballMem.yaw += (b.spin ?? 0) * dt * 4;
      ballMem.trail.push([b.x, b.y, b.z ?? 0]);
      if (ballMem.trail.length > 7) ballMem.trail.shift();
    }
  }

  // ---------- the camera ----------
  function target(s) {
    const b = s.ball ?? { x: PITCH.W / 2, y: PITCH.L / 2, z: 0 }, sp = s.setpiece, ps = s.players ?? [];
    let tx = b.x, ty = b.y - (b.z ?? 0) * ZK * 0.5;
    if (sp) {
      const tk = ps[sp.taker], a = sp.aim ?? 0, lead = sp.kind === 'kickoff' ? 0 : sp.kind === 'penalty' ? 5 : sp.kind === 'throw' ? 6 : 9;
      tx = (tk?.x ?? sp.x) + Math.cos(a) * lead * 0.5; ty = (tk?.y ?? sp.y) + Math.sin(a) * lead;
    } else if (s.phase === 'play' || s.phase === 'kickoff') {
      const owner = b.owner >= 0 ? ps[b.owner] : null, team = owner ? owner.team : -1;
      const dir = team < 0 ? 0 : team === s.up ? -1 : 1;
      ty += dir * 7 + clamp((b.vy ?? 0) * 0.35, -7, 7);
    }
    return [PITCH.W / 2 + clamp((tx - PITCH.W / 2) * 0.15, -3, 3), ty];
  }
  function moveCam(s, dt, P) {
    const [tx, ty] = target(s), half = ui.ch / 2 / P, y0 = -END_MARGIN + half, y1 = PITCH.L + END_MARGIN - half, b = s.ball;
    // the ball put somewhere new (a kick-off, a restart): cut, as television does
    const jump = b && cam.bx != null && Math.hypot(b.x - cam.bx, b.y - cam.by) > 6;
    if (b) { cam.bx = b.x; cam.by = b.y; }
    if (jump || Math.abs(ty - cam.y) > 60) { cam.y = clamp(ty, y0, y1); cam.vy = 0; ballMem.trail.length = 0; }
    const k1 = 7, k2 = 2 * Math.sqrt(k1);
    cam.vy += ((ty - cam.y) * k1 - cam.vy * k2) * dt; cam.y += cam.vy * dt;
    cam.vx += ((tx - cam.x) * 4 - cam.vx * 4) * dt; cam.x += cam.vx * dt;
    if (cam.y < y0) { cam.y = y0; cam.vy = Math.max(0, cam.vy); }
    if (cam.y > y1) { cam.y = y1; cam.vy = Math.min(0, cam.vy); }
  }
  function view(frozen) {
    const { cw, ch } = ui, P = cw / VIEW_W, k = fx.shake * fx.shake * 1.6 + fx.shake * 0.3;
    const sx = frozen ? 0 : (Math.random() - 0.5) * k * P, sy = frozen ? 0 : (Math.random() - 0.5) * k * P;
    const v = {
      x: cam.x, y: cam.y, P, cw, ch, ox: cw / 2 + sx, oy: ch / 2 + sy,
      x0: cam.x - cw / 2 / P - 1, x1: cam.x + cw / 2 / P + 1, y0: cam.y - ch / 2 / P - 1, y1: cam.y + ch / 2 / P + 3,
      X: x => (x - v.x) * P + v.ox, Y: (y, z = 0) => (y - v.y - z * ZK) * P + v.oy,
    };
    return v;
  }

  // ---------- the match view ----------
  const items = [];
  function drawMatch(app, match, dt, frozen) {
    ensure(match, app);
    const s = match.s, ps = s.players ?? [], b = s.ball, { cw, ch } = ui;
    if (!kits) buildKits(app, match);
    if (!frozen) {
      clock += dt;
      emit(s, dt);
      fx.step(dt);
      moveCam(s, dt, cw / VIEW_W);
      if (H.goal && (H.goal.t += dt) > 4) H.goal = null;
      if (H.toast && (H.toast.t += dt) > H.toast.dur) H.toast = null;
      H.scoreT += dt;
      for (const c of H.cards) c.t += dt;
      while (H.cards.length && H.cards[0].t > 2.4) H.cards.shift();
    }
    drawnAt = s.t;
    const v = view(frozen), t = clock, teams = teamsOf(app, match);
    g.setTransform(1, 0, 0, 1, 0, 0);
    pitch.draw(g, v, t, fx.roar, teams);
    fx.drawMarks(g, v);
    // shadows first, all of them, so no one stands in another's
    const inView = (x, y) => x > v.x0 - 3 && x < v.x1 + 3 && y > v.y0 - 1 && y < v.y1 + 3;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      frames[i] = null;
      if (p.off || !inView(p.x, p.y)) continue;
      const m = memOf(i, p), gk = p.slot === 0, kit = gk ? kits[p.team]?.gk : kits[p.team]?.out;
      frames[i] = figs.frame(p, kit ?? FALLBACK[0].kit, gk, m.look, m.phase, m);
      figs.shadow(g, v, p, frames[i]);
    }
    if (b) figs.ballShadow(g, v, b);
    fx.draw(g, v, 0);
    const sp = s.setpiece, taker = sp ? ps[sp.taker] : null;
    if (sp && taker?.human && !app.demo) aimArrow(g, v, b?.x ?? sp.x, b?.y ?? sp.y, sp.aim ?? 0, t, SIDE_COL[taker.team] ?? YELLOW, sp.kind === 'throw' ? 5 : 7);
    // everything that stands up, far to near
    items.length = 0;
    for (let i = 0; i < ps.length; i++) if (frames[i]) items.push([ps[i].y, i]);
    if (b) items.push([b.y + 0.02, -1]);
    items.push([-ND, -2], [0, -3], [PITCH.L, -4], [PITCH.L + ND, -5]);
    items.sort((a, c) => a[0] - c[0]);
    let ballAt = null;
    const heads = [];
    for (const [, i] of items) {
      if (i >= 0) heads.push([i, figs.draw(g, v, ps[i], frames[i], mem[i].look)]);
      else if (i === -1) { trail(v, b); ballAt = figs.ball(g, v, b, ballMem); }
      else if (i === -2) pitch.goal(g, v, 0, 'back', fx);
      else if (i === -3) pitch.goal(g, v, 0, 'front', fx);
      else if (i === -4) pitch.goal(g, v, 1, 'front', fx);
      else pitch.goal(g, v, 1, 'back', fx);
    }
    pitch.over(g, v);
    fx.draw(g, v, 1);
    // over the players: the controlled ones' marks, the kick's charge, cards held up, aftertouch
    const s2 = Math.max(0.55, figs.k / 50);
    for (const [i, top] of heads) {
      const p = ps[i];
      let y = top[1];
      if (p.human && !app.demo) {
        y = figs.marker(g, top[0], y, p.num, SIDE_COL[p.team] ?? YELLOW, t);
        if (s.kick && s.control?.[p.team] === i) chargeBar(g, top[0], y, s.kick.charge ?? 0, s2);
      }
      for (const c of H.cards) if (c.player === i) cardPop(g, top[0], y, c.colour, c.t, s2);
    }
    if (s.after && ballAt && !app.demo) {
      const kicker = ps[b.last];
      if (!kicker || kicker.human) afterHint(g, ballAt[0], ballAt[1], ballAt[2], Math.atan2(b.vy ?? 0, b.vx ?? 1), clamp((s.after.t ?? 0) / 0.12, 0, 1), t);
    }
    // the lens: a little darker at the sides
    if (!vignette) {
      const ew = Math.round(cw * 0.06);
      vignette = [g.createLinearGradient(0, 0, ew, 0), g.createLinearGradient(cw, 0, cw - ew, 0), ew];
      for (const gr of vignette.slice(0, 2)) { gr.addColorStop(0, 'rgba(0,8,16,0.3)'); gr.addColorStop(1, 'rgba(0,8,16,0)'); }
    }
    g.fillStyle = vignette[0]; g.fillRect(0, 0, vignette[2], ch);
    g.fillStyle = vignette[1]; g.fillRect(cw - vignette[2], 0, vignette[2], ch);
    fx.drawScreen(g, cw, ch);
    // the HUD
    g.setTransform(cw / 1920, 0, 0, ch / 1080, 0, 0);
    drawHud(ui, app, match, H, t, v);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  /** a fading streak behind a fast ball */
  function trail(v, b) {
    const T = ballMem.trail, sp = Math.hypot(b.vx ?? 0, b.vy ?? 0, b.vz ?? 0);
    if (sp < 14 || T.length < 3) return;
    const a = clamp((sp - 14) / 16, 0, 1) * 0.45;
    g.lineCap = 'round';
    for (let i = 1; i < T.length; i++) {
      const q = i / T.length;
      g.strokeStyle = `rgba(255,255,255,${(a * q).toFixed(3)})`; g.lineWidth = 0.42 * v.P * q;
      g.beginPath(); g.moveTo(v.X(T[i - 1][0]), v.Y(T[i - 1][1], T[i - 1][2])); g.lineTo(v.X(T[i][0]), v.Y(T[i][1], T[i][2])); g.stroke();
    }
    g.lineCap = 'butt';
  }

  // ---------- frame ----------
  function draw(app) {
    lastApp = app;
    const now = performance.now(), dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    const st = app.state, match = app.match, { cw, ch } = ui;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    if (match && MATCH_STATES.has(st)) {
      drawMatch(app, match, dt, FROZEN.has(st));
      if (FROZEN.has(st)) { g.setTransform(cw / 1920, 0, 0, ch / 1080, 0, 0); drawScreen(g, app, app.t ?? 0); }
    } else {
      if (M && !match) setMatch(null, app);
      g.fillStyle = NAVY; g.fillRect(0, 0, cw, ch);
      g.setTransform(cw / 1920, 0, 0, ch / 1080, 0, 0);
      drawScreen(g, app, app.t ?? 0);
    }
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    if (app.fade > 0) { g.fillStyle = `rgba(6,12,20,${Math.min(1, app.fade)})`; g.fillRect(0, 0, cw, ch); }
    if (st === 'match') app.touch?.draw?.(g, ui.su);
  }
  /** what a tap at (x, y) in canvas pixels lands on: the screens' business, in 1920 × 1080 */
  const menuAt = (x, y) => screenAt(lastApp, (x * 1920) / ui.cw, (y * 1080) / ui.ch);
  function destroy() { destroyed = true; unfit(); fx.clear(); figs.reset(1); }
  return { draw, events, menuAt, destroy, get stats() { return { sprites: figs.size, spritePx: figs.pixels, ground: pitch.groundSize, fx: fx.count, cam: { x: cam.x, y: cam.y }, P: ui.cw / VIEW_W }; } };
}
