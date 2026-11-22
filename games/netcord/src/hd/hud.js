// The match's TV graphics on the 2D canvas, in a 1920 × 1080 frame: the scoreboard (names, sets,
// games, the point, the server's ball, the tiebreak), the umpire's call (FAULT, OUT, LET, ACE…)
// popping in the middle, the serve's speed, MATCH / SET / BREAK POINT under the board, the rally's
// length, and for the human: his aim on the court (projected, with perspective) and the wind-up
// of his shot over his head. events() reads the sim's events; draw() only reads state.
//
//   const hud = createHud();  hud.events(list, match);  hud.draw(g, app, match, view)
//   view: { project([x, y, z]) → { x, y } in 1920 × 1080 or null, headOf(i) → [x, y, z] | null }
export const W = 1920, H = 1080;
export const FONT = "'Barlow Semi Condensed','Arial Narrow',system-ui,sans-serif";
export const COL = {
  green: '#0d3a2b',
  green2: '#14513c',
  purple: '#4a2a7a',
  purple2: '#5f3a96',
  white: '#f6f7f2',
  yellow: '#e6f23a',
  ink: '#0b1712',
  dim: 'rgba(246,247,242,0.62)',
  faint: 'rgba(246,247,242,0.3)',
  red: '#ff6a55',
};
const POINTS = ['0', '15', '30', '40'];

function text(g, s, x, y, size, col, { align = 'left', wgt = 700, sp = 0, base = 'middle' } = {}) {
  g.font = `${wgt} ${size}px ${FONT}`;
  g.fillStyle = col;
  g.textAlign = align;
  g.textBaseline = base;
  if ('letterSpacing' in g) g.letterSpacing = `${sp}px`;
  g.fillText(s, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}
function rect(g, x, y, w, h, col, r = 0) {
  g.fillStyle = col;
  if (r) {
    g.beginPath();
    g.roundRect(x, y, w, h, r);
    g.fill();
  } else g.fillRect(x, y, w, h);
}

/** the points as the board shows them: 15 / 30 / 40 / AD, or the tiebreak's count */
export function pointLabels(sc) {
  const [a, b] = sc?.points ?? [0, 0];
  if (sc?.tiebreak) return [String(a), String(b)];
  if (a >= 3 && b >= 3) {
    if (a === b) return ['40', '40'];
    return a > b ? ['AD', '40'] : ['40', 'AD'];
  }
  return [POINTS[Math.min(a, 3)], POINTS[Math.min(b, 3)]];
}

const winsGame = (sc, i) => {
  const a = sc.points[i] + 1, b = sc.points[1 - i];
  return sc.tiebreak ? a >= 7 && a - b >= 2 : a >= 4 && a - b >= 2;
};
const winsSet = (sc, i) => {
  if (!winsGame(sc, i)) return false;
  if (sc.tiebreak) return true;
  const g = sc.games[i] + 1, h = sc.games[1 - i];
  return g >= 6 && g - h >= 2;
};
const setsWon = (sc, i) => (sc.sets ?? []).filter(s => s[i] > s[1 - i]).length;

/** what the next point is for: 'MATCH POINT', 'SET POINT', 'BREAK POINT' (and whose), or null */
export function bigPoint(s, best = 3) {
  const sc = s?.score;
  if (!sc?.points || !sc.games) return null;
  const need = Math.ceil(best / 2);
  for (const kind of ['MATCH POINT', 'SET POINT', 'BREAK POINT'])
    for (const i of [0, 1]) {
      if (kind === 'MATCH POINT' && winsSet(sc, i) && setsWon(sc, i) + 1 >= need) return { kind, who: i };
      if (kind === 'SET POINT' && winsSet(sc, i)) return { kind, who: i };
      if (kind === 'BREAK POINT' && !sc.tiebreak && i !== s.server && winsGame(sc, i)) return { kind, who: i };
    }
  return null;
}

const nameOf = (app, i) => String(app?.players?.[i]?.short ?? app?.players?.[i]?.name ?? `PLAYER ${i + 1}`).toUpperCase();

export function createHud() {
  let call = null, callKey = '', speed = null, clock = 0;

  function events(list, match) {
    const s = match?.s;
    clock = s?.t ?? clock + 1 / 60;
    for (const e of list ?? []) {
      if (e.type === 'hit' && e.kind === 'serve' && s?.ball) {
        const b = s.ball, v = Math.hypot(b.vx, b.vy, b.vz), kmh = s.serveSpeed > 0 ? s.serveSpeed : v * 3.6;
        if (kmh > 20) speed = { kmh: Math.round(kmh), t: clock, who: e.player };
      }
    }
    const c = s?.call;
    const key = c ? `${c.text}|${c.t}` : '';
    if (c && key !== callKey) call = { text: String(c.text), t: clock };
    callKey = key;
  }

  /** practice keeps no score: the venue, who's practising, and with what */
  function practiceBoard(g, app, s) {
    const x = 44, y = 40, w = 420;
    rect(g, x, y, w, 30, COL.purple, 4);
    text(g, `PRACTICE · ${String(app.venue?.name ?? '').toUpperCase()}`, x + 14, y + 16, 19, COL.white, { wgt: 700, sp: 2 });
    rect(g, x, y + 34, w, 50, COL.green, 4);
    const h = app.human >= 0 ? app.human : 0;
    text(g, nameOf(app, h), x + 34, y + 60, 30, COL.white, { wgt: 700, sp: 1 });
    text(g, s.practice === 'machine' ? 'BALL MACHINE' : `WITH ${nameOf(app, 1 - h)}`, x + w - 14, y + 60, 20, COL.yellow, { align: 'right', wgt: 700, sp: 2 });
  }

  function board(g, app, s) {
    if (s.practice) return practiceBoard(g, app, s);
    const sc = s.score ?? {}, sets = sc.sets ?? [], over = s.phase === 'over';
    const cols = sets.map(x => [x[0], x[1]]);
    if (!over && sc.games) cols.push([sc.games[0], sc.games[1]]);
    const pts = pointLabels(sc);
    const x = 44, y = 40, rowH = 50, nameW = 290, cellW = 46, ptW = 80;
    const w = 30 + nameW + cols.length * cellW + (over ? 0 : ptW);
    // the tab: the event, the tiebreak
    const tab = String(app.venue?.name ?? '').toUpperCase();
    const tabW = Math.min(w, 34 + tab.length * 13 + (sc.tiebreak ? 150 : 0));
    rect(g, x, y, tabW, 30, COL.purple, 4);
    text(g, tab, x + 14, y + 16, 19, COL.white, { wgt: 700, sp: 2 });
    if (sc.tiebreak) text(g, 'TIEBREAK', x + tabW - 12, y + 16, 19, COL.yellow, { align: 'right', wgt: 800, sp: 2 });
    const top = y + 34;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 14;
    g.shadowOffsetY = 4;
    rect(g, x, top, w, rowH * 2, COL.green, 4);
    g.restore();
    rect(g, x, top + rowH - 1, w, 2, 'rgba(255,255,255,0.12)');
    for (let i = 0; i < 2; i++) {
      const ry = top + i * rowH, cy = ry + rowH / 2;
      if (s.server === i && !over) {
        g.fillStyle = COL.yellow;
        g.beginPath();
        g.arc(x + 17, cy, 8, 0, Math.PI * 2);
        g.fill();
      }
      const won = over && s.score && setsWon(s.score, i) > setsWon(s.score, 1 - i);
      text(g, nameOf(app, i), x + 34, cy + 1, 30, won ? COL.yellow : COL.white, { wgt: 700, sp: 1 });
      const ctry = app?.players?.[i]?.country;
      if (typeof ctry === 'string' && ctry.length <= 3) text(g, ctry.toUpperCase(), x + nameW - 8, cy + 1, 20, COL.dim, { align: 'right', wgt: 500, sp: 1 });
      cols.forEach((c, k) => {
        const cur = k === cols.length - 1 && !over;
        const cx = x + 30 + nameW + k * cellW + cellW / 2;
        if (cur) rect(g, cx - cellW / 2, ry + 3, cellW, rowH - 6, COL.green2);
        const mine = c[i] > c[1 - i];
        text(g, String(c[i]), cx, cy + 1, 30, cur ? COL.white : mine ? COL.white : COL.dim, { align: 'center', wgt: cur ? 800 : 700 });
      });
      if (!over) {
        const px = x + w - ptW;
        rect(g, px, ry + 4, ptW - 4, rowH - 8, COL.white, 3);
        text(g, pts[i], px + (ptW - 4) / 2, cy + 1, 30, COL.ink, { align: 'center', wgt: 800 });
      }
    }
    const second = s.phase === 'serve' && sc.serveNo === 2;
    let below = top + rowH * 2 + 8;
    if (second) {
      rect(g, x, below, 150, 30, COL.white, 3);
      text(g, '2ND SERVE', x + 75, below + 16, 19, COL.purple, { align: 'center', wgt: 800, sp: 2 });
      below += 38;
    }
    const big = s.phase === 'serve' || s.phase === 'rally' ? bigPoint(s, sc.best ?? app.best ?? 3) : null;
    if (big) {
      const label = `${big.kind}  ·  ${nameOf(app, big.who)}`;
      g.font = `800 22px ${FONT}`;
      const bw = Math.max(260, (g.measureText(label).width || label.length * 12) + 56);
      rect(g, x, below, bw, 36, big.kind === 'MATCH POINT' ? COL.yellow : COL.purple2, 3);
      text(g, label, x + 18, below + 19, 22, big.kind === 'MATCH POINT' ? COL.ink : COL.white, { wgt: 800, sp: 3 });
    }
  }

  function bigCall(g, s) {
    if (!call) return;
    const age = clock - call.t;
    if (age < 0 || age > 1.9) return;
    const t = call.text.toUpperCase();
    const good = t === 'ACE' || t === 'GAME' || t === 'SET' || t === 'MATCH';
    const k = Math.min(1, age / 0.12), out = age > 1.55 ? 1 - (age - 1.55) / 0.35 : 1;
    g.save();
    g.globalAlpha = Math.max(0, out);
    g.translate(W / 2, 150);
    g.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k);
    const size = t.length > 8 ? 70 : 88;
    g.font = `800 ${size}px ${FONT}`;
    if ('letterSpacing' in g) g.letterSpacing = '8px';
    const tw = g.measureText(t).width || t.length * size * 0.6;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    rect(g, -tw / 2 - 46, -size * 0.62, tw + 92, size * 1.24, good ? COL.green : COL.purple, 6);
    rect(g, -tw / 2 - 46, size * 0.62 - 6, tw + 92, 6, COL.yellow);
    text(g, t, 0, 4, size, good ? COL.yellow : COL.white, { align: 'center', wgt: 800, sp: 8 });
    g.restore();
    void s;
  }

  function serveSpeed(g, app) {
    if (!speed) return;
    const age = clock - speed.t;
    if (age < 0 || age > 3.4) return;
    const a = Math.min(1, age * 6, (3.4 - age) * 3);
    g.save();
    g.globalAlpha = a;
    const x = 44, y = 950;
    rect(g, x, y, 300, 82, COL.green, 4);
    rect(g, x, y, 6, 82, COL.yellow);
    text(g, `SERVE · ${nameOf(app, speed.who)}`, x + 22, y + 22, 18, COL.dim, { wgt: 700, sp: 2 });
    text(g, String(speed.kmh), x + 22, y + 56, 40, COL.white, { wgt: 800 });
    g.font = `800 40px ${FONT}`;
    const nw = g.measureText(String(speed.kmh)).width || 60;
    text(g, 'KM/H', x + 30 + nw, y + 60, 20, COL.yellow, { wgt: 800, sp: 2 });
    g.restore();
  }

  /** the human's target on the court: a ring in perspective, and the shot's wind-up over him */
  function aimAndCharge(g, app, s, view) {
    const h = app.human;
    if (!(h >= 0) || app.state === 'demo') return;
    const p = s.players?.[h];
    if (!p) return;
    if (p.aim && Number.isFinite(p.aim.x) && (s.phase === 'rally' || s.phase === 'serve')) {
      const pulse = 0.5 + 0.5 * Math.sin(clock * 7);
      const ring = r => {
        g.beginPath();
        let ok = false;
        for (let k = 0; k <= 24; k++) {
          const a = (k / 24) * Math.PI * 2, q = view.project([p.aim.x + Math.cos(a) * r, 0.02, p.aim.z + Math.sin(a) * r]);
          if (!q) return false;
          if (k === 0) g.moveTo(q.x, q.y);
          else g.lineTo(q.x, q.y);
          ok = true;
        }
        return ok;
      };
      g.lineWidth = 4;
      if (ring(0.55)) {
        g.strokeStyle = 'rgba(10,20,14,0.45)';
        g.lineWidth = 8;
        g.stroke();
        g.strokeStyle = `rgba(230,242,58,${0.75 + 0.25 * pulse})`;
        g.lineWidth = 4;
        g.stroke();
      }
      if (ring(0.12 + 0.06 * pulse)) {
        g.fillStyle = 'rgba(230,242,58,0.85)';
        g.fill();
      }
    }
    const ch = p.charge ?? 0;
    if (ch > 0.01) {
      const hd = view.headOf?.(h), q = view.project([p.x, (hd ? hd[1] : (p.height ?? 1.8) - 0.1) + 0.42, p.z]);
      if (q) {
        const bw = 120, bh = 14, x = q.x - bw / 2, y = q.y - bh;
        rect(g, x - 3, y - 3, bw + 6, bh + 6, 'rgba(8,20,14,0.75)', 4);
        rect(g, x, y, bw * Math.min(1, ch), bh, ch > 0.85 ? '#ffb43a' : COL.yellow, 2);
      }
    }
  }

  function rally(g, s) {
    const n = s.stats?.[0]?.rally ?? s.stats?.rally ?? 0;
    if (!(n >= 4) || (s.phase !== 'rally' && s.phase !== 'point')) return;
    const x = W - 44 - 170, y = 40;
    rect(g, x, y, 170, 44, 'rgba(13,58,43,0.86)', 4);
    text(g, 'RALLY', x + 18, y + 23, 20, COL.dim, { wgt: 700, sp: 3 });
    text(g, String(n), x + 152, y + 23, 30, COL.yellow, { align: 'right', wgt: 800 });
  }

  function draw(g, app, match, view) {
    const s = match?.s;
    if (!s) return;
    board(g, app, s);
    bigCall(g, s);
    serveSpeed(g, app);
    rally(g, s);
    aimAndCharge(g, app, s, view);
    if (app.demo || app.state === 'demo') {
      const a = 0.45 + 0.25 * Math.sin((app.t ?? clock) * 3);
      text(g, 'DEMO', W - 44, H - 44, 30, `rgba(246,247,242,${a})`, { align: 'right', wgt: 800, sp: 8 });
    }
  }

  return {
    events,
    draw,
    reset() {
      call = null;
      callKey = '';
      speed = null;
    },
  };
}
