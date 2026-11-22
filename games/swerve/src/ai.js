// Swerve's team AI: it plays the CPU sides and the user's ten teammates (the keepers are the sim's).
// Off the ball every player has a home in the formation (tactics.js), and the whole shape slides
// with the ball: up the pitch and wide when the side has it, back and narrow when it hasn't.
// Without the ball, the one who can reach it first goes for it and a second covers between the
// ball and goal; defenders and midfielders near an opponent stand goal-side of him. With it,
// forwards make runs and everybody drifts out of an opponent's shadow to be passed to.
//
// The carrier thinks a few times a second (quicker the better a passer he is): a shot when the
// goal opens up within his range, a pass when a teammate is free and the lane is clear (more
// often under pressure or once he's held it a while), a through ball into a forward's run, a
// cross from by the byline, a hoof clear from his own third when he's hounded, and otherwise a
// dribble the way with most room. Ratings set the range, the errors and the choices, so a better
// side makes more chances and takes more of them, and a weaker one still nicks a game now and then.
//
// The AI keeps its own random numbers (its own mulberry32), never the sim's.
//
//   const ai = createAI(ctx);   // ctx from sim.js: { s, M, P, PITCH, attackY, ownY, fwd, inBox, ballAt, intercept, passSpeed, loft, seed }
//   ai.shape(team)       // fills M[i].tx, ty, run for the team's outfield players
//   ai.carrier(i)        // → a plan: { kind: 'dribble', dx, dy } | { kind, tx, ty, speed, vz, spin, to }
//   ai.aerial(i), ai.slide(i), ai.distribute(k), ai.setpiece(), ai.setShape(), ai.kickoffSpot(i, team, out)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));

export function createAI(ctx) {
  const { s, M, P, PITCH, attackY, ownY, fwd, inBox, intercept, passSpeed, loft } = ctx;
  const { W, L } = PITCH, CX = W / 2, HG = PITCH.goalW / 2;
  const players = s.players, b = s.ball;
  let rng = (ctx.seed ^ 0x5bd1e995) | 0 || 7;
  const rand = () => {
    let t = (rng = (rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randn = () => (rand() + rand() + rand() - 1.5) * 2;
  const tmp = { x: 0, y: 0 }, tmp2 = { x: 0, y: 0 };
  const time = new Float64Array(22);

  /** a slot-space point (x across, y from the team's own goal) on the pitch */
  function toWorld(t, fx, fy, out) {
    const f = fwd(t);
    out.y = ownY(t) + f * fy * L;
    out.x = f < 0 ? fx * W : (1 - fx) * W;
    return out;
  }
  /** the nearest opponent of team t to (x, y), keepers left out unless `keepers` */
  function space(t, x, y, keepers = false) {
    let d = 1e9;
    for (let j = (1 - t) * 11; j < (1 - t) * 11 + 11; j++) {
      const q = players[j];
      if (q.off || (!keepers && M[j].gk)) continue;
      const e = Math.hypot(q.x - x, q.y - y);
      if (e < d) d = e;
    }
    return d;
  }
  /** how likely a ball along (x0,y0)→(x1,y1) at about v m/s is cut out, 0..1: a race at points
   *  along it between the ball and each opponent (a lofted one only where it comes down) */
  function laneRisk(t, x0, y0, x1, y1, v, lofted = false) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
    let risk = 0;
    for (let k = lofted ? 4 : 0; k <= 5; k++) {
      const u = k ? k / 5 : 0.07, px = x0 + dx * u, py = y0 + dy * u, tb = (u * d) / v;
      for (let j = (1 - t) * 11; j < (1 - t) * 11 + 11; j++) {
        const q = players[j];
        if (q.off) continue;
        const e = Math.abs(q.x - px) + Math.abs(q.y - py);
        if (e > 30) continue;
        const e2 = Math.hypot(q.x - px, q.y - py);
        const to = Math.max(0, e2 - (lofted ? 1.2 : 0.7)) / M[j].top + 0.2 * Math.min(1, e2 / 3);
        const r = clamp((tb - to) / 0.6 + 0.5, 0, 1);
        if (r > risk) risk = r;
      }
    }
    return risk;
  }
  const distGoal = (t, x, y) => Math.hypot(CX - x, attackY(t) - y);

  // ---------- off the ball ----------
  function shape(t, bx = b.x, by = b.y, dead = false, haveOverride = null) {
    const own = ownY(t), f = fwd(t), o = b.owner;
    const have = haveOverride ?? (o >= 0 ? players[o].team === t : false);
    const bf = clamp(((by - own) * f) / L, 0, 1), bxT = f < 0 ? bx / W : 1 - bx / W;
    const c = clamp(bf, 0.1, 0.9);
    // who goes for the ball
    let c1 = -1, c2 = -1, t1 = 1e9, t2 = 1e9, recv = false;
    if (!dead && !have) {
      for (let i = t * 11 + 1; i < t * 11 + 11; i++) {
        if (players[i].off || M[i].downT > 0) { time[i] = 1e9; continue; }
        if (M[i].receive > 0) recv = true;
        const tt = intercept(i, tmp);
        time[i] = tt;
        if (tt < t1) { t2 = t1; c2 = c1; t1 = tt; c1 = i; } else if (tt < t2) { t2 = tt; c2 = i; }
      }
      if (recv && o < 0) c1 = c2 = -1;
      if (c1 >= 0 && players[c1].human) c1 = -1;
      // a second man only when they have it near our goal, or a CPU side presses harder
      const press2 = o >= 0 && (bf < 0.5 || (ctx.cpu[t] && bf < 0.7));
      if (!press2 || (c2 >= 0 && players[c2].human)) c2 = -1;
    }
    const carrier = o >= 0 && have ? players[o] : null;
    for (let i = t * 11 + 1; i < t * 11 + 11; i++) {
      const p = players[i], m = M[i];
      if (p.off) continue;
      if (m.receive > 0 && !dead) {
        // meet it: where he gets to the ball first, never further than the aimed point
        if (o < 0) { intercept(i, tmp); m.tx = tmp.x; m.ty = tmp.y; } else { m.tx = m.rx; m.ty = m.ry; }
        m.run = 1;
        continue;
      }
      if (i === c1) {
        intercept(i, tmp);
        m.tx = tmp.x; m.ty = tmp.y; m.run = 1;
        // goal-side of a carrier
        if (o >= 0) m.ty -= f * 0.4;
        continue;
      }
      if (i === c2) {
        const gx = CX - bx, gy = own - by, d = Math.hypot(gx, gy) || 1;
        m.tx = bx + (gx / d) * 4; m.ty = by + (gy / d) * 4; m.run = 0.95;
        continue;
      }
      let fy = have ? m.fy * 0.62 + c * 0.45 - 0.04 : m.fy * 0.52 + c * 0.4 - 0.06;
      if (have && m.role === 'FW' && bf > 0.45) fy += 0.05;
      fy = clamp(fy, 0.04, have ? 0.93 : 0.86);
      const fx = clamp(0.5 + (m.fx - 0.5) * (have ? 1.05 : 0.8) + (bxT - 0.5) * 0.3, 0.04, 0.96);
      toWorld(t, fx, fy, tmp);
      let tx = tmp.x, ty = tmp.y;
      if (have) {
        // out of the carrier's way and out of an opponent's shadow
        if (carrier) {
          const dx = tx - carrier.x, dy = ty - carrier.y, d = Math.hypot(dx, dy);
          if (d < 7 && d > 1e-3) { tx = carrier.x + (dx / d) * 7; ty = carrier.y + (dy / d) * 7; }
        }
        let nd = 1e9, nx = 0, ny = 0;
        for (let j = (1 - t) * 11 + 1; j < (1 - t) * 11 + 11; j++) {
          const q = players[j];
          if (q.off) continue;
          const d = Math.hypot(q.x - tx, q.y - ty);
          if (d < nd) { nd = d; nx = q.x; ny = q.y; }
        }
        if (nd < 3) {
          const dx = tx - nx, dy = ty - ny, d = nd || 1;
          tx += (dx / d) * (3 - nd); ty += (dy / d) * (3 - nd);
        }
      } else if (m.role !== 'FW') {
        // goal-side of the nearest man in the zone
        let nd = 9, q = null;
        for (let j = (1 - t) * 11 + 1; j < (1 - t) * 11 + 11; j++) {
          const r = players[j];
          if (r.off) continue;
          const d = Math.hypot(r.x - tx, r.y - ty);
          if (d < nd) { nd = d; q = r; }
        }
        if (q) {
          const gx = CX - q.x, gy = own - q.y, d = Math.hypot(gx, gy) || 1, k = m.role === 'DF' ? 0.65 : 0.4;
          tx += (q.x + (gx / d) * 1.6 - tx) * k; ty += (q.y + (gy / d) * 1.6 - ty) * k;
        }
      }
      m.tx = clamp(tx, 1, W - 1); m.ty = clamp(ty, 1, L - 1);
      const d = Math.hypot(m.tx - p.x, m.ty - p.y);
      m.run = d > 6 ? 0.95 : d > 2 ? 0.7 : 0.4;
    }
  }

  // ---------- on the ball ----------
  function shotPlan(i, pressure, fromSet = false) {
    const p = players[i], m = M[i], t = p.team, g = attackY(t);
    const dg = distGoal(t, b.x, b.y);
    const k = players[(1 - t) * 11];
    let side = k.x < CX ? 1 : -1;
    if (rand() < 0.25) side = -side;
    const tx0 = CX + side * (HG - 0.5 - rand() * 0.9);
    const err = randn() * (0.02 + (9 - m.shooting) * 0.012 + (pressure < 2 ? 0.025 : 0));
    let a = Math.atan2(g - b.y, tx0 - b.x) + err;
    const speed = 20 + m.shooting * 1.1 + rand() * 3;
    const T = dg / (speed * 0.82), h = fromSet ? 1.7 + rand() * 0.5 : 0.25 + rand() * 1.6;
    const vz = clamp((h + 0.5 * P.g * T * T) / T, 0.5, 8);
    let spin = 0;
    if (dg > 17 && rand() < (fromSet ? 0.8 : 0.3)) {
      spin = (rand() < 0.5 ? -1 : 1) * (0.45 + rand() * 0.4);
      const D = 0.5 * P.magnus * spin * speed * T * T * 0.7;
      a -= D / dg;
    }
    return { kind: 'shot', tx: b.x + Math.cos(a) * dg, ty: b.y + Math.sin(a) * dg, speed, vz, spin, to: -1 };
  }
  function shotChance(i, pressure) {
    const p = players[i], m = M[i], t = p.team, g = attackY(t);
    const dg = distGoal(t, b.x, b.y), range = 23 + m.shooting * 1.2;
    if (dg > range) return 0;
    const open = Math.abs(wrapA(Math.atan2(g - b.y, CX - HG - b.x) - Math.atan2(g - b.y, CX + HG - b.x)));
    if (open < 0.12) return 0;
    let blockers = 0;
    const ux = (CX - b.x) / dg, uy = (g - b.y) / dg;
    for (let j = (1 - t) * 11 + 1; j < (1 - t) * 11 + 11; j++) {
      const q = players[j];
      if (q.off) continue;
      const proj = (q.x - b.x) * ux + (q.y - b.y) * uy;
      if (proj < 0.5 || proj > dg) continue;
      if (Math.abs((q.x - b.x) * uy - (q.y - b.y) * ux) < 0.8 + proj * 0.12) blockers++;
    }
    let q = (open - 0.05) * 2.8 * (1.3 - dg / range) - blockers * 0.15 + (pressure < 2.5 ? 0.12 : 0) + m.held * 0.08;
    if (dg > 22) q *= 0.6; // from distance only now and then: carry it closer
    if (dg < 11 && open > 0.3) q = Math.max(q, 0.75);
    return q;
  }
  function passPlan(i, pressure, minScore = -1e9) {
    const p = players[i], m = M[i], t = p.team, g = attackY(t), f = fwd(t);
    const dHere = distGoal(t, b.x, b.y);
    let best = null, bs = minScore;
    const noise = 0.6 * (1.25 - m.passing / 9);
    const wide = Math.abs(g - b.y) < 24 && Math.abs(b.x - CX) > 13;
    for (let j = t * 11 + 1; j < t * 11 + 11; j++) {
      if (j === i) continue;
      const q = players[j];
      if (q.off || M[j].downT > 0) continue;
      for (let kind = 0; kind < 3; kind++) {
        // 0: to feet, 1: into his run, 2: a cross into the box
        let tx = q.x + q.vx * 0.4, ty = q.y + q.vy * 0.4, bonus = 0, lofted = false;
        if (kind === 1) {
          if (M[j].role === 'DF' || (q.y - b.y) * f < 2) continue;
          tx += (CX - tx) * 0.2; ty += f * (5 + rand() * 5); bonus = 0.5;
          if ((g - ty) * f < 4) continue;
        } else if (kind === 2) {
          if (!wide || !inBox(1 - t, q.x, q.y)) continue;
          lofted = true; bonus = 0.55;
          tx = q.x + q.vx * 0.8; ty = q.y + q.vy * 0.8;
        }
        if (tx < 1 || tx > W - 1 || ty < 1 || ty > L - 1) continue;
        const d = Math.hypot(tx - b.x, ty - b.y);
        if (d < 6 || d > (lofted ? 45 : 38)) continue;
        const v = lofted ? 14 : Math.max(8, passSpeed(d) * 0.7);
        let risk = laneRisk(t, b.x, b.y, tx, ty, v, lofted);
        if (!lofted && risk > 0.5 && d > 18) { const r2 = laneRisk(t, b.x, b.y, tx, ty, 14, true); if (r2 + 0.45 < risk) { risk = r2 + 0.45; lofted = true; } }
        const room = space(t, tx, ty);
        const prog = dHere - distGoal(t, tx, ty);
        const sc = prog * 0.075 + Math.min(room, 8) * 0.05 - risk * 1.9 - (d > 28 ? (d - 28) * 0.03 : 0) + bonus - (lofted ? 0.35 : 0) + (rand() - 0.5) * noise * 2;
        if (sc > bs) {
          bs = sc;
          best = { kind: lofted ? 'lob' : 'pass', tx, ty, speed: 0, vz: 0, spin: 0, to: j, score: sc, d };
        }
      }
    }
    if (!best) return null;
    // the strike, with the passer's error
    const err = randn() * (0.02 + (9 - m.passing) * 0.01);
    const a = Math.atan2(best.ty - b.y, best.tx - b.x) + err, d = best.d * (1 + randn() * (0.02 + (9 - m.passing) * 0.01));
    if (best.kind === 'lob') {
      const l = loft(d, wide ? 0.2 : 0.45);
      best.speed = l.speed; best.vz = l.vz;
    } else best.speed = passSpeed(d);
    best.tx = b.x + Math.cos(a) * d; best.ty = b.y + Math.sin(a) * d;
    return best;
  }
  let dribbleRoom = 8; // the clearance along the latest dribble choice
  function dribbleDir(i) {
    const p = players[i], t = p.team, g = attackY(t), f = fwd(t);
    const base = Math.atan2(g - p.y, (CX - p.x) * (Math.abs(g - p.y) < 30 ? 1 : 0.4));
    let best = base, bs = -1e9;
    for (let k = -3; k <= 3; k++) {
      const a = base + k * 0.45, ca = Math.cos(a), sa = Math.sin(a);
      const qx = p.x + ca * 4, qy = p.y + sa * 4;
      let clear = 8;
      for (let j = (1 - t) * 11; j < (1 - t) * 11 + 11; j++) {
        const q = players[j];
        if (q.off) continue;
        const d = Math.hypot(q.x - qx, q.y - qy);
        if (d < clear) clear = d;
      }
      let sc = Math.min(clear, 7) + Math.cos(k * 0.45) * (Math.abs(g - p.y) < 35 ? 3.2 : 2.2);
      if (qx < 2 || qx > W - 2) sc -= 6;
      if ((qy - g) * -f < 0.5 && Math.abs(qx - CX) > HG) sc -= 6;
      if (sc > bs) { bs = sc; best = a; dribbleRoom = clear; }
    }
    return best;
  }
  function carrier(i) {
    const pl = decide(i);
    pl.at = s.t;
    return pl;
  }
  function decide(i) {
    const p = players[i], m = M[i], t = p.team, own = ownY(t), f = fwd(t);
    const pressure = space(t, b.x, b.y);
    if (rand() < shotChance(i, pressure)) return shotPlan(i, pressure);
    const a = dribbleDir(i);
    // room to run into: a dribble is the default, a pass needs a reason
    const pass = passPlan(i, pressure);
    const desire = 0.06 + (pressure < 2.5 ? 0.45 : pressure < 5 ? 0.15 : 0) + Math.max(0, m.held - 1) * 0.15 + (dribbleRoom < 4 ? 0.25 : 0);
    if (pass && (pass.score > 1.1 || (pass.score > 0.3 && rand() < desire))) return pass;
    const bf = ((b.y - own) * f) / L;
    if (bf < 0.3 && pressure < 2.5 && rand() < 0.45) {
      const tx = clamp((b.x < CX ? 4 : W - 4) + randn() * 7, -4, W + 4), ty = own + f * (40 + rand() * 20);
      const d = Math.hypot(tx - b.x, ty - b.y), l = loft(d, 0.7);
      return { kind: 'clear', tx, ty, speed: l.speed, vz: l.vz, spin: 0, to: -1 };
    }
    return { kind: 'dribble', dx: Math.cos(a), dy: Math.sin(a) };
  }

  // a ball at knee or head height in reach: head or volley it somewhere useful
  function aerial(i) {
    const p = players[i], m = M[i], t = p.team, g = attackY(t), own = ownY(t), f = fwd(t);
    if (rand() < 0.35) return null; // not every time: sometimes he lets it drop
    const head = b.z > 1.1, dg = distGoal(t, b.x, b.y);
    if (dg < 20 && (g - b.y) * f > 0) {
      const tx = CX + (rand() - 0.5) * PITCH.goalW * 0.9 + randn() * (0.6 + (9 - m.shooting) * 0.15);
      const speed = head ? P.header + m.shooting * 0.7 : P.volley + m.shooting * 1.1;
      return { kind: head ? 'header' : 'volley', tx, ty: g, speed, vz: head ? 0.8 - b.z * 0.35 : 1.4, spin: 0, to: -1 };
    }
    if (inBox(t, b.x, b.y) && rand() < 0.3) {
      // under the bar and under pressure: head it behind, wide of the post
      const tx = b.x < CX ? -6 : W + 6, ty = own - f * 2;
      return { kind: head ? 'header' : 'volley', tx, ty, speed: head ? 12 : 16, vz: 4, spin: 0, to: -1 };
    }
    if (Math.abs(b.y - own) < 32) {
      const tx = clamp(b.x + (b.x < CX ? -12 : 12) + randn() * 5, 3, W - 3), ty = b.y + f * 24;
      return { kind: head ? 'header' : 'volley', tx, ty, speed: head ? 14 : 20, vz: 5, spin: 0, to: -1 };
    }
    const tx = clamp(b.x + randn() * 8, 3, W - 3), ty = b.y + f * 14;
    return { kind: head ? 'header' : 'volley', tx, ty, speed: head ? 11 : 16, vz: 3, spin: 0, to: -1 };
  }

  // the chaser's slide: an angle to go in at, or null
  function slide(i) {
    const p = players[i], m = M[i], t = p.team;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d > 2.5 || d < 0.7 || b.z > 0.5) return null;
    const a = Math.atan2(b.y - p.y, b.x - p.x);
    if (Math.cos(wrapA(a - p.dir)) < 0.6) return null;
    const rate = (0.3 + m.tackling * 0.06) * (inBox(t, p.x, p.y) ? 0.35 : 1);
    if (rand() > rate * P.think * 0.12) return null;
    ctx.ballAt(0.12, tmp2);
    return Math.atan2(tmp2.y - p.y, tmp2.x - p.x);
  }

  // the keeper with it in his hands: throw it to a free man, or kick it long
  function distribute(k) {
    const p = players[k], t = p.team, own = ownY(t), f = fwd(t);
    let best = -1, bs = -1e9;
    for (let j = t * 11 + 1; j < t * 11 + 11; j++) {
      const q = players[j];
      if (q.off) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < 8 || d > 32) continue;
      const room = space(t, q.x, q.y), risk = laneRisk(t, p.x, p.y, q.x, q.y, 12);
      const sc = Math.min(room, 12) - d * 0.1 - risk * 8;
      if (sc > bs) { bs = sc; best = j; }
    }
    if (best >= 0 && bs > 5 && rand() < 0.65) {
      const q = players[best], d = Math.hypot(q.x - p.x, q.y - p.y);
      return { kind: 'throw', tx: q.x, ty: q.y, speed: Math.min(passSpeed(d * 0.8), 18), vz: 1.2, spin: 0, to: best };
    }
    const tx = clamp(CX + randn() * 14, 8, W - 8), ty = own + f * (55 + rand() * 12);
    const l = loft(Math.hypot(tx - p.x, ty - p.y), 0.8);
    return { kind: 'clear', tx, ty, speed: l.speed, vz: l.vz, spin: 0, to: -1 };
  }

  // ---------- set pieces ----------
  function setpiece() {
    const sp = s.setpiece, i = sp.taker, m = M[i], t = sp.team, g = attackY(t), f = fwd(t), own = ownY(t);
    const inward = g === 0 ? 1 : -1; // from the goal line it attacks into the pitch
    if (sp.kind === 'penalty') {
      const side = rand() < 0.5 ? -1 : 1, tx0 = CX + side * (1.2 + rand() * 2.1);
      const a = Math.atan2(g - b.y, tx0 - b.x) + randn() * (0.015 + (9 - m.shooting) * 0.008);
      const d = Math.abs(g - b.y), speed = 18 + m.shooting * 0.9 + rand() * 3, T = d / (speed * 0.9);
      const h = 0.2 + rand() * 1.5, vz = (h + 0.5 * P.g * T * T) / T;
      return { kind: 'shot', tx: b.x + Math.cos(a) * d, ty: b.y + Math.sin(a) * d, speed, vz, spin: 0, to: -1 };
    }
    if (sp.kind === 'kickoff') {
      let best = -1, bd = 1e9;
      for (let j = t * 11 + 1; j < t * 11 + 11; j++) {
        if (j === i || players[j].off) continue;
        const q = players[j], d = Math.hypot(q.x - b.x, q.y - b.y);
        if (d > 4 && d < bd) { bd = d; best = j; }
      }
      const q = players[best];
      return { kind: 'pass', tx: q.x, ty: q.y, speed: passSpeed(bd), vz: 0, spin: 0, to: best };
    }
    if (sp.kind === 'throw') {
      let best = -1, bs = -1e9;
      for (let j = t * 11 + 1; j < t * 11 + 11; j++) {
        if (j === i || players[j].off) continue;
        const q = players[j], d = Math.hypot(q.x - b.x, q.y - b.y);
        if (d < 4 || d > 22) continue;
        const sc = Math.min(space(t, q.x, q.y), 8) - laneRisk(t, b.x, b.y, q.x, q.y, 11) * 4 + ((q.y - b.y) * f > 0 ? 1 : 0) + rand();
        if (sc > bs) { bs = sc; best = j; }
      }
      const tx = best >= 0 ? players[best].x : clamp(b.x + (b.x < CX ? 8 : -8), 2, W - 2);
      const ty = best >= 0 ? players[best].y : b.y + f * 14;
      const d = Math.hypot(tx - b.x, ty - b.y), l = loft(d * 0.85, 0.05);
      return { kind: 'throw', tx, ty, speed: Math.min(l.speed, 15), vz: Math.min(l.vz, 5), spin: 0, to: best };
    }
    if (sp.kind === 'corner') {
      if (rand() < 0.2) {
        const pass = passPlan(i, 10);
        if (pass && pass.d < 20) return pass;
      }
      const tx = CX + (rand() - 0.5) * 12, ty = g + inward * (5 + rand() * 8);
      const d = Math.hypot(tx - b.x, ty - b.y), l = loft(d, 0.25);
      const spin = (b.x < CX ? 1 : -1) * (rand() - 0.3) * 0.5 * inward;
      return { kind: 'lob', tx, ty, speed: l.speed, vz: l.vz, spin, to: -1 };
    }
    if (sp.kind === 'goalkick') {
      if (rand() < 0.3) {
        const pass = passPlan(i, 10, 0.2);
        if (pass && pass.d < 25) return pass;
      }
      const tx = clamp(CX + randn() * 16, 6, W - 6), ty = own + f * (48 + rand() * 14);
      const l = loft(Math.hypot(tx - b.x, ty - b.y), 0.7);
      return { kind: 'clear', tx, ty, speed: l.speed, vz: l.vz, spin: 0, to: -1 };
    }
    // a free kick: a shot from close enough and central, else a pass or a long ball
    const dg = distGoal(t, b.x, b.y);
    if (dg < 29 && Math.abs(b.x - CX) < 18 && rand() < 0.75) return shotPlan(i, 10, true);
    const pass = passPlan(i, 10);
    if (pass && pass.score > -0.2) return pass;
    const tx = clamp(CX + randn() * 12, 6, W - 6), ty = clamp(b.y + f * 35, 8, L - 8);
    const l = loft(Math.hypot(tx - b.x, ty - b.y), 0.5);
    return { kind: 'lob', tx, ty, speed: l.speed, vz: l.vz, spin: 0, to: -1 };
  }

  // where everyone goes for a dead ball
  function setShape() {
    const sp = s.setpiece, kind = sp.kind, at = sp.team;
    for (let t = 0; t < 2; t++) {
      if (kind === 'kickoff') {
        for (let i = t * 11 + 1; i < t * 11 + 11; i++) { kickoffSpot(i, at, tmp); M[i].tx = tmp.x; M[i].ty = tmp.y; M[i].run = 0.8; }
      } else shape(t, sp.x, sp.y, true, t === at);
      // the keeper: on his line, a step out
      const k = t * 11, gy = ownY(t), inn = gy === 0 ? 1 : -1;
      if (!(kind === 'goalkick' && at === t)) {
        M[k].tx = CX + clamp((sp.x - CX) * 0.05, -2, 2);
        M[k].ty = gy + inn * (kind === 'penalty' ? 0.3 : 1);
      }
    }
    const g = attackY(at), inward = g === 0 ? 1 : -1, d = 1 - at;
    if (kind === 'corner') {
      const side = sp.x < CX ? -1 : 1;
      const spots = [[side * 2.5, 5], [-side * 3, 7], [0, 11], [side * 6, 15]];
      const att = [];
      for (let i = at * 11 + 1; i < at * 11 + 11; i++) if (i !== sp.taker && !players[i].off) att.push(i);
      att.sort((a, c) => M[c].fy - M[a].fy || a - c);
      for (let k = 0; k < 4 && k < att.length; k++) {
        const m = M[att[k]];
        m.tx = CX + spots[k][0] + (m.fx - 0.5); m.ty = g + inward * spots[k][1]; m.run = 0.9;
      }
      // defenders: goal-side of each of the four, the rest in the six-yard box, the forwards up
      const def = [];
      for (let i = d * 11 + 1; i < d * 11 + 11; i++) if (!players[i].off && M[i].role !== 'FW') def.push(i);
      def.sort((a, c) => M[a].fy - M[c].fy || a - c);
      for (let k = 0; k < def.length; k++) {
        const m = M[def[k]];
        if (k < 4) { m.tx = CX + spots[k][0] + 0.6; m.ty = g + inward * (spots[k][1] - 1.2); }
        else { m.tx = CX + ((k % 3) - 1) * 5; m.ty = g + inward * (3 + (k % 2) * 13); }
        m.run = 0.9;
      }
    } else if (kind === 'freekick' || kind === 'penalty' || kind === 'throw' || kind === 'goalkick') {
      const dg = distGoal(at, sp.x, sp.y);
      let wall = kind === 'freekick' && dg < 32 ? 3 : 0;
      const gx = CX - sp.x, gy = g - sp.y, gl = Math.hypot(gx, gy) || 1, ux = gx / gl, uy = gy / gl;
      for (let i = 0; i < 22; i++) {
        const p = players[i], m = M[i];
        if (p.off || m.gk || i === sp.taker) continue;
        const opp = p.team !== at;
        if (kind === 'freekick' && opp) {
          if (wall > 0 && M[i].role !== 'FW') {
            const k = 3 - wall--;
            m.tx = sp.x + ux * 9.3 + -uy * (k - 1) * 0.75; m.ty = sp.y + uy * 9.3 + ux * (k - 1) * 0.75; m.run = 1;
            continue;
          }
          pushOut(m, sp.x, sp.y, 9.6);
        } else if (kind === 'penalty') {
          if (inBox(d, m.tx, m.ty) || Math.hypot(m.tx - sp.x, m.ty - sp.y) < 10) {
            m.ty = g + inward * (PITCH.boxD + 1.5 + (i % 2) * 2.5);
            m.tx = clamp(m.tx, CX - 18, CX + 18);
          }
        } else if (kind === 'throw' && opp) pushOut(m, sp.x, sp.y, 3);
        else if (kind === 'goalkick' && opp && inBox(at, m.tx, m.ty)) m.ty = ownY(at) + (ownY(at) === 0 ? 1 : -1) * (PITCH.boxD + 1.5);
      }
    }
  }
  function pushOut(m, x, y, r) {
    const dx = m.tx - x, dy = m.ty - y, d = Math.hypot(dx, dy);
    if (d >= r) return;
    if (d < 1e-3) { m.ty = y + r; return; }
    m.tx = x + (dx / d) * r; m.ty = y + (dy / d) * r;
  }

  // the kick-off line-up: each side in its own half, the other side out of the circle
  function kickoffSpot(i, kicking, out) {
    const p = players[i], m = M[i], t = p.team;
    if (m.gk) return toWorld(t, 0.5, 0.01, out);
    toWorld(t, 0.5 + (m.fx - 0.5) * 0.9, Math.min(m.fy * 0.5, 0.46), out);
    if (t !== kicking) {
      const dx = out.x - CX, dy = out.y - L / 2, d = Math.hypot(dx, dy);
      if (d < PITCH.circle + 0.8) {
        if (d < 1e-3) { out.y = L / 2 - fwd(t) * (PITCH.circle + 0.8); }
        else { out.x = CX + (dx / d) * (PITCH.circle + 0.8); out.y = L / 2 + (dy / d) * (PITCH.circle + 0.8); }
      }
    }
    return out;
  }

  return { shape, carrier, aerial, slide, distribute, setpiece, setShape, kickoffSpot };
}
