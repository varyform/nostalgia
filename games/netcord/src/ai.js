// Netcord's CPU players: where to stand, what to hit and how well, from the ratings and the style.
// The sim does the running and the swinging (it plans the contact on the ball's predicted path,
// which is the anticipation); this decides the rest:
//   - position: between shots a player goes back to the middle of the angles the opponent has
//     (shaded toward where the ball is going), at his style's depth: a counter-puncher well back,
//     a baseliner behind the line, an all-rounder on it, at the net once he has come in;
//   - the serve: wide, body or T, flat, slice or kick, its pace from the serve rating; a second
//     serve slower, safer and heavy with spin; a serve-volleyer follows it in;
//   - the shot: a rally ball cross-court with margin (now and then down the line, at the
//     backhand), the short ball attacked into the open court (and followed in by those who like
//     the net), passing shots and lobs against a net-rusher, a drop shot when the opponent is
//     far back, volleys angled away, smashes put away; defensive, high and safe when stretched;
//   - the errors: the timing and the shot's spread grow with a lower accuracy (volley for
//     volleys, serve for serves), a stretch, a fast or low ball, a hard hit, a big point, and
//     shrink with `difficulty`.
// The AI keeps its own random numbers (its own mulberry32), never the sim's.
//
//   const ai = createAI(ctx);   // ctx from sim.js: { s, P, COURT, M, players, seed, difficulty, surface, landing }
import { pressure } from './score.js';

// the AI's knobs
export const A = {
  margin: [0.3, 0.09], // m inside the lines a CPU aims: base + per accuracy point short of 9
  spread: { a: [0.005, 0.0015], v: [0.008, 0.0018], y: [0.2, 0.03], net: [0.012, 0.004] }, // + the chance the face closes into the net // rad, × pace, m/s: base + per point short of 9
  timing: [0.016, 0.0045], // s of timing error, the same
  serveSpread: { a: [0.016, 0.003], v: [0.016, 0.003], y: [0.3, 0.04] },
  serveSpeed: [29, 3.3], second: 0.74, // m/s base + per serve point; the second serve's share
  rush: { 'serve-volley': [0.9, 0.55, 0.85], 'all-round': [0.12, 0.03, 0.55], baseline: [0.02, 0, 0.12], counter: [0.01, 0, 0.06] }, // after a first serve, a second, an attacking ball
  drop: { 'serve-volley': 0.06, 'all-round': 0.12, baseline: 0.05, counter: 0.1 },
  lob: { 'serve-volley': 0.12, 'all-round': 0.2, baseline: 0.18, counter: 0.35 },
  pace: { 'serve-volley': 0.7, 'all-round': 0.72, baseline: 0.74, counter: 0.6 },
  steady: { 'serve-volley': 1, 'all-round': 0.93, baseline: 1, counter: 0.9 }, // × the spread of ground strokes
  depth: { 'serve-volley': 0.6, 'all-round': 1.0, baseline: 1.4, counter: 2.2 }, // m behind the baseline to receive
  surface: { clay: { rush: 0.5, back: 0.6 }, grass: { rush: 1.5, back: -0.5 }, hard: { rush: 1, back: 0 }, indoor: { rush: 1.2, back: -0.2 } },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createAI(ctx) {
  const { s, COURT, M, players, landing } = ctx;
  const diff = clamp(ctx.difficulty ?? 1, 0.4, 2);
  const surf = A.surface[ctx.surface] || A.surface.hard;
  let rng = (ctx.seed ^ 0x2c1b3c6d) | 0 || 7;
  const rand = () => {
    let t = (rng = (rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randn = () => (rand() + rand() + rand() - 1.5) * 2;
  const sgn = (v, d = 1) => (v > 0 ? 1 : v < 0 ? -1 : d);
  const short = k => 9 - k;
  /** how hard the moment is on player i: the score, a stretch, the ball */
  function strain(i, plan) {
    let k = 1 + 0.25 * pressure(s.score);
    if (plan) {
      if (plan.cls === 'lunge') k += 0.6;
      k += 0.9 * clamp((0.3 - plan.slack) / 0.6, 0, 1);
      if (plan.by < 0.6 && plan.cls !== 'smash') k += 0.4;
    }
    return k;
  }

  // ---------- serving ----------
  const serveWait = () => 0.9 + rand() * 0.9;
  const serveTiming = i => (randn() * (A.timing[0] + short(M[i].r.serve) * A.timing[1] * 0.6)) / diff;
  function serve(i, serveNo, sg, eo) {
    const r = M[i].r, st = M[i].style, first = serveNo === 1;
    const u = rand();
    const lat = first ? (u < 0.42 ? 3.25 : u < 0.8 ? 0.5 : 1.9) : u < 0.35 ? 2.7 : u < 0.75 ? 0.9 : 1.8;
    const tx = sg * lat, tz = eo * (first ? 5.25 + rand() * 0.6 : 4.8 + rand() * 0.6);
    let kind;
    if (first) kind = rand() < (st === 'serve-volley' ? 0.4 : 0.25) ? 'slice' : rand() < 0.1 ? 'kick' : 'flat';
    else kind = rand() < 0.75 ? 'kick' : 'slice';
    const speed = (A.serveSpeed[0] + A.serveSpeed[1] * r.serve) * (0.94 + rand() * 0.08) * (first ? 1 : A.second);
    const k = (strain(i, null) * (first ? 1 : 0.8)) / diff, sp = A.serveSpread, n = short(r.serve);
    return { tx, tz, speed, kind, sigma: { a: (sp.a[0] + sp.a[1] * n) * k, v: (sp.v[0] + sp.v[1] * n) * k, y: (sp.y[0] + sp.y[1] * n) * k } };
  }
  const rushAfterServe = (i, serveNo) => rand() < Math.min(0.97, (A.rush[M[i].style] || A.rush['all-round'])[serveNo === 1 ? 0 : 1] * surf.rush);
  function receiveDepth(i) {
    const o = 1 - i, d = A.depth[M[i].style] ?? 1;
    return clamp(d + (M[o].r.serve - 5) * 0.15 + surf.back, 0, 3.6);
  }

  // ---------- the rally ----------
  const playOut = () => rand() < 0.05;
  const timing = (i, plan) => {
    const r = M[i].r, acc = plan.cls === 'volley' || plan.cls === 'low' || plan.cls === 'smash' ? (r.accuracy + r.volley) / 2 : r.accuracy;
    return (randn() * (A.timing[0] + short(acc) * A.timing[1]) * strain(i, plan)) / diff;
  };
  /** the spread of a CPU's shot: { a: rad, v: share of pace, y: m/s } */
  function sigma(i, sw, incoming, q) {
    const m = M[i], r = m.r, plan = m.plan;
    const vol = sw.cls === 'volley' || sw.cls === 'low' || sw.cls === 'smash';
    const acc = vol ? (r.accuracy + r.volley) / 2 : r.accuracy, n = short(acc);
    const pace = sw.shot?.pace ?? 0.6;
    let k = strain(i, plan) * (0.65 + 0.6 * pace) * (1 + (1 - q) * 1.5) * (1 + clamp((incoming - 24) / 40, 0, 0.5));
    if (sw.shot?.kind === 'drop') k *= 1.3;
    if (!vol) k *= A.steady[m.style] ?? 1;
    k /= diff;
    const sp = A.spread;
    return { a: (sp.a[0] + sp.a[1] * n) * k, v: (sp.v[0] + sp.v[1] * n) * k, y: (sp.y[0] + sp.y[1] * n) * k, net: (sp.net[0] + sp.net[1] * n) * k };
  }

  /** what player i does with the ball he'll meet per `plan` → { kind, tx, tz, pace, clear, top?, rush } */
  function shot(i, plan) {
    const m = M[i], r = m.r, st = m.style, o = 1 - i, op = players[o], e = s.end[i], eo = -e;
    const margin = A.margin[0] + A.margin[1] * short(r.accuracy);
    const maxX = COURT.halfW - margin, maxD = COURT.halfL - margin * 1.2;
    const cz = Math.abs(plan.bz), ox = op.x, oz = Math.abs(op.z);
    const away = -sgn(ox, rand() < 0.5 ? 1 : -1); // the side of the court the opponent isn't on
    const stretched = plan.cls === 'lunge' || plan.slack < 0.12;
    let kind = 'drive', x, d, pace = A.pace[st] ?? 0.68, clear = 0.25, top = null, rush = false;
    pace += (r.power - 5) * 0.025;
    const cls = plan.cls, backhand = plan.side < 0;
    if (cls === 'smash') {
      x = away * maxX * 0.8; d = 8 + rand() * 2; pace = 0.95; clear = 0.15;
    } else if (cls === 'volley' || cls === 'low') {
      const low = cls === 'low' || plan.by < 0.85;
      if (!low && oz > 10 && rand() < 0.1 + r.volley * 0.015) { kind = 'drop'; x = away * 2.6; d = 2.4 + rand(); }
      else if (low) { x = away * maxX * 0.5; d = maxD - 0.6; pace = 0.45; }
      else if (oz < 7) { x = ox * 0.4; d = 5.5 + rand(); pace = 0.6; }
      else { x = away * maxX * (0.75 + rand() * 0.2); d = rand() < 0.5 ? 6.2 + rand() * 1.5 : maxD - 0.4; pace = 0.75; }
    } else {
      const attack = cz < 10.3 && plan.by > 0.7 && !stretched;
      const opNet = oz < 7.2;
      if (opNet) {
        if ((oz < 5 && rand() < (A.lob[st] ?? 0.2)) || (stretched && rand() < 0.35)) {
          kind = 'lob'; x = -sgn(ox) * 2; d = maxD - 0.8; pace = 0.55; top = r.spin >= 6 && !stretched ? 150 : -30;
        } else {
          // the pass: into the open side, or at his feet
          if (rand() < 0.3) { x = ox * 0.4; d = 6.8 + rand(); } else { x = away * maxX * (0.85 + rand() * 0.15); d = 7.4 + rand() * 2; }
          pace = 0.78 + (r.power - 5) * 0.02; clear = 0.14;
        }
      } else if (stretched) {
        if (rand() < 0.25 && plan.slack < -0.05) { kind = 'lob'; x = (rand() - 0.5) * 2; d = maxD - 0.5; pace = 0.5; }
        else {
          kind = backhand && rand() < 0.55 ? 'slice' : rand() < 0.2 ? 'slice' : 'drive';
          x = (rand() - 0.5) * 2.5; d = maxD - 0.3 - rand() * 0.8; pace = 0.45; clear = 0.6;
        }
      } else if (oz > 12.4 && cz < 10.8 && rand() < (A.drop[st] ?? 0.08)) {
        kind = 'drop'; x = away * (1 + rand() * 2); d = 2.5 + rand() * 1.2; pace = 0.4;
      } else if (attack) {
        x = away * maxX * (0.85 + rand() * 0.15); d = maxD - 0.4 - rand(); pace = Math.min(1, pace + 0.25); clear = 0.22;
        rush = rand() < (A.rush[st] || A.rush['all-round'])[2] * surf.rush;
        if (rush && backhand && rand() < 0.5) kind = 'slice';
      } else {
        // the rally ball: cross-court, now and then down the line or at the backhand
        const cx = plan.bx * e; // across, from where he stands
        const u = rand();
        const sideX = u < 0.62 ? -sgn(plan.bx, away) : u < 0.85 ? sgn(plan.bx, away) : -players[o].hand * eo;
        x = sideX * (1.8 + rand() * (maxX - 1.8));
        d = 9 + rand() * (maxD - 9);
        if (Math.abs(cx) > 3.5 && u < 0.62) d -= 0.7; // the angle from out wide
        if (backhand && rand() < (st === 'counter' ? 0.15 : st === 'baseline' ? 0.08 : 0.3)) kind = 'slice';
      }
    }
    x = clamp(x, -maxX, maxX);
    d = clamp(d, 1.8, maxD);
    return { kind, tx: x, tz: eo * d, pace: clamp(pace, 0.2, 1), clear, top, rush };
  }

  /** where player i goes between his shot and the next ball: the middle of the opponent's angles */
  function recover(i, out) {
    const m = M[i], e = s.end[i], st = m.style;
    const land = s.ball.live && s.ball.last === i ? landing() : null;
    const lx = land ? clamp(land.x, -5, 5) : players[1 - i].x * 0.6;
    if (m.net) {
      out.z = e * (st === 'serve-volley' ? 2.6 : 3.2);
      out.x = lx * 0.5;
    } else {
      out.z = e * (COURT.halfL + (A.depth[st] ?? 1) * 0.7 + surf.back * 0.5);
      out.x = lx * 0.33;
    }
    return out;
  }

  return { serveWait, serveTiming, serve, rushAfterServe, receiveDepth, playOut, timing, sigma, shot, recover };
}
