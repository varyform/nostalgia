// Swerve's match: two elevens and one ball, pure and deterministic, a fixed step at a time. The
// page, the attract demo and tools/verify.mjs drive it with held-input snapshots
// { x, y, kick } for each human side (the sim finds the presses and releases) and read `match.s`
// to draw it; CPU sides, the user's teammates and both keepers are played by ai.js from inside.
// All randomness comes from integers in the state (mulberry32: `s.rng` for the sim, the AI's own
// for its choices), so a seed and the same inputs replay a match exactly.
//
// Metres and seconds; the pitch is vertical, x across 0..68, y along 0..105 (DOWN), z up. `s.up`
// says which team attacks the top goal (y = 0) this half.
//
// The ball is a point with a radius in 3D: gravity, air drag ∝ v², rolling friction on the grass
// (a constant part and one ∝ speed, so passes are fast and still die), bounces that lose height
// and some pace, and spin: a sideways turn of the velocity ∝ spin (the curl), decaying, weaker
// once it rolls. Posts and the bar are thin cylinders the ball bounces off; past the line under
// the bar it's in the net, which swallows it. No offside.
//
// Players accelerate toward what they want (their pace sets the top speed) and face where they
// run. Possession is loose, never glued: a carrier knocks the ball ahead along where he wants to
// go whenever it's at his feet, then runs onto it, so a sharp turn means chasing it round and an
// opponent who reaches it first takes it; a standing tackle is a contest of ratings while both are
// on it. One kick button: a tap is a ground pass along the facing, its strength from the distance
// to the teammate nearest that line, nudged onto a teammate within ~12°; a hold is a shot or long
// ball whose pace and height grow with the hold. For ~0.35 s after a human's kick the stick bends
// the ball (aftertouch): across the flight adds spin, against it lifts it, along it keeps it down.
// Kick near a ball at knee or head height volleys or heads it; kick without the ball slides in,
// and a slide that meets a man before the ball is a foul (a penalty in the box, a card by how bad).
//
// Keepers are always the sim's: they hold the line between ball and goal, come for loose balls in
// the box, and dive at shots, catching, parrying or being beaten by the shot's pace and their
// keeping; then they throw or kick it out. Set pieces, half time, extra time and the shoot-out all
// run inside: the user's taker aims with the stick and kicks, CPU takers go after about a second.
//
//   const match = createMatch({ teams: [home, away], seed, halfSeconds: 180, cpu: [false, true] });
//   match.step([{ x, y, kick }, null]);   // every DT; match.events lists what happened (the caller clears it)
import { FORMATIONS } from './tactics.js';
import { createAI } from './ai.js';

export const DT = 1 / 60;
export const PITCH = { W: 68, L: 105, goalW: 7.32, goalH: 2.44, goalD: 2, boxW: 40.32, boxD: 16.5, sixW: 18.32, sixD: 5.5, spot: 11, circle: 9.15, ball: 0.11 };
const { W, L } = PITCH, CX = W / 2, R = PITCH.ball, HG = PITCH.goalW / 2, POST = 0.06;

export const P = {
  // the ball
  g: 9.81, drag: 0.0085, // m/s², air drag per (m/s)² per m/s
  roll: 0.42, rollC: 1.0, // rolling friction: ∝ speed (1/s) + constant (m/s²)
  bounce: 0.5, bounceKeep: 0.8, bounceMin: 1.4, // height kept, pace kept, the slowest drop that bounces (m/s)
  magnus: 0.36, spinDecay: 0.75, rollSpin: 0.3, // turn rate per unit spin (rad/s), decay /s, × once rolling
  postE: 0.55, // posts and bar give this much back
  // players
  top: 6.2, topPace: 0.18, acc: 30, carry: 0.9, // m/s + per pace point, m/s², top speed × with the ball
  reach: 0.62, ownReach: 0.78, kickR: 0.9, keepR: 2.2, // feet reach (the dribbler's own a little longer), kick reach, how far the ball may run before it's loose (m)
  touchCd: 0.22, lead: 1.8, // a dribble touch: the least time between, the pace it gets over the runner's
  trap: 10, trapPass: 1.4, // relative m/s a first touch tames, + per passing point
  steal: 1.5, poach: 9, // /s: a standing tackle on an even contest, taking a knocked-on ball off a dribbler
  noTouch: 0.28, block: 0.1, // s a kicker can't touch his own kick; the chance a man on the ball blocks it (+ per tackling point)
  // kicks
  tap: 0.12, full: 0.35, auto: 0.55, // s: tap/hold split, full charge, fires by itself
  assist: 0.21, arrive: 9.5, // rad of pass assist, the pace a pass arrives with (m/s)
  shot0: 15, shotK: 15, shotSk: 0.45, lift0: 0.8, shotLift: 5.6, // hold kicks: m/s + × charge + per shooting point; vz + × charge²
  after: 0.35, atSpin: 3.6, atLift: 14, atDip: 7, spinMax: 1.1, // aftertouch window (s), spin /s, lift and dip (m/s²)
  header: 11, volley: 18, // m/s base
  // tackles and fouls
  slideV: 8.5, slideT: 0.55, slideR: 0.72, slideAssist: 0.5, downT: 0.5, foulDown: 1.1, // m/s, s, m, rad (a user slide near the ball line leads it), s, s
  // keepers
  gkTop: 5.6, gkReach: 0.62, gkDiveV: 4.2, gkDiveSk: 0.45, gkReact: 0.16, // m/s, m, m/s + per keeping, s
  gkBase: 0.8, gkSkill: 0.025, gkStretch: 0.45, gkPace: 0.02, gkDivePen: 0.08, gkCatchV: 15, gkHold: 1.3, penGuess: 0.55,
  squeeze: 0.6, // how much of a pace/passing/tackling gap counts
  userGuard: 0.6, // × the CPU's chance to take the ball off the user's dribbler
  // flow
  goalT: 3.6, breakT: 3, overT: 3, cpuTake: 1, idleTake: 4, snapT: 3.5, switchHyst: 2.5, think: 0.2,
};

export const EMPTY_INPUT = { x: 0, y: 0, kick: false };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const SPIN_KEEP = Math.exp(-P.spinDecay * DT);

// mulberry32 on an integer kept in the state
function rand(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** the distance a ball rolling at v0 covers in t seconds (until it stops) */
export function rollDist(v0, t) {
  const k = P.roll, c = P.rollC / k, a = v0 + c, ts = Math.log(a / c) / k, tt = Math.min(t, ts);
  return (a * (1 - Math.exp(-k * tt))) / k - c * tt;
}
/** the pace a ground pass needs to reach d metres arriving at `arrive` m/s */
export function passSpeed(d, arrive = P.arrive) {
  const k = P.roll, c = P.rollC;
  let v = arrive + d * 0.7;
  for (let n = 0; n < 8; n++) {
    const x = (v - arrive) / k - (c / (k * k)) * Math.log((c + k * v) / (c + k * arrive));
    v -= (x - d) / (v / (c + k * v));
    if (v < arrive) v = arrive;
  }
  return clamp(v, arrive, 34);
}
/** a lofted kick that comes down d metres away: { speed (horizontal), vz } */
export function loft(d, high = 0.5) {
  const vz = clamp(2.5 + d * (0.12 + high * 0.1), 3.5, 15), T = (2 * vz) / P.g, vh = d / T;
  return { speed: clamp(vh * (1 + P.drag * vh * T * 0.6), 4, 32), vz };
}

export function createMatch({ teams, seed = 1, halfSeconds = 180, cpu = [true, true], knockout = false }) {
  const s = {
    t: 0, minute: 0, half: 1, phase: 'kickoff', phaseT: 0, up: 0, score: [0, 0], pens: null,
    ball: { x: CX, y: L / 2, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: -1, last: -1 },
    players: [], control: [-1, -1], setpiece: null, kick: null, after: null, shootout: null,
    stats: { shots: [0, 0], onTarget: [0, 0], possession: [0.5, 0.5], corners: [0, 0], fouls: [0, 0], saves: [0, 0], yellow: [0, 0], red: [0, 0] },
    // additive: seconds into this half, and the sim's random state
    clock: 0, rng: seed | 0 || 1,
  };
  const match = { s, events: [], done: false, step, result, teams, tune: { P, PITCH } };
  const emit = e => {
    const ev = match.events;
    if (ev.length > 2000) ev.splice(0, 1000);
    ev.push(e);
  };
  const b = s.ball, players = s.players;
  const cpuSide = [!!cpu[0], !!cpu[1]];

  // ---------- the players ----------
  const M = [];
  for (let t = 0; t < 2; t++) {
    const team = teams[t], form = FORMATIONS[team.formation] || FORMATIONS['4-4-2'];
    for (let k = 0; k < 11; k++) {
      const d = team.players[k] || team.players[team.players.length - 1], slot = form.slots[k];
      // ratings 1..9; the ones every duel turns on are squeezed toward the middle, so an edge
      // tells over a match without deciding every 50-50 (P.squeeze)
      const r = n => clamp(+n || 5, 1, 9), q = n => 5 + (r(n) - 5) * P.squeeze;
      players.push({
        team: t, slot: k, id: d.id, name: d.name, num: d.num, pos: d.pos, x: CX, y: L / 2, vx: 0, vy: 0, dir: 0,
        anim: 'stand', animT: 0, human: false, card: 0, off: false,
      });
      const pace = q(d.pace), keeping = r(d.keeping);
      M.push({
        pace, shooting: r(d.shooting), passing: q(d.passing), tackling: q(d.tackling), keeping,
        gk: k === 0, role: slot.role, fx: slot.x, fy: slot.y,
        top: k === 0 ? P.gkTop + keeping * 0.1 : P.top + pace * P.topPace, acc: P.acc * (0.92 + pace * 0.015),
        tx: CX, ty: L / 2, run: 0, // the AI's target and pace (0..1)
        wx: 0, wy: 0, wmag: 0, // what a carrier wants: a direction and how much
        plan: null, thinkT: 0, held: 0, receive: 0, rx: 0, ry: 0,
        noTouch: 0, touchCd: 0, lock: 0, slideT: 0, slideWon: false, slideHit: false, downT: 0,
        gkState: 'set', gkT: 0, dvx: 0, dvy: 0, saveCd: 0, seen: 0, diveDur: 0, guess: 0,
      });
    }
  }
  const GK = [0, 11];
  // per human side: the kick button's history, a charge, a kick waiting for the ball
  const H = [0, 1].map(() => ({ prev: false, charging: false, holdT: 0, pend: false, pendTtl: 0, pendHold: false, pendCharge: 0, switchT: 0, ix: 0, iy: 0, im: 0, fireCharge: 0, idle: 0 }));
  let afterSide = -1, afterBy = -1; // whose aftertouch window is open
  let passTo = -1, passT = 0; // the teammate a pass was aimed at, and for how long
  const lastKick = [-1, -1], lastKickT = [-99, -99]; // each team's latest deliberate kick
  let lastDeliberate = false; // was the ball's last touch a kick (not a block, a parry, a deflection)?
  let penKick = false; // the ball's last touch was a penalty kick, untouched since
  let shotT = -99, shotTeam = -1, shotCounted = false; // the latest shot, for saves, on target and near misses
  let netSide = -1, netHit = false; // the goal the ball is in (its line's y), whether it has hit the net yet
  let firstKick = rand(s) < 0.5 ? 0 : 1, etKick = 0;
  const tPos = [0, 0];
  const scorers = [];
  let spReady = false, spReadyT = 0, spPlaced = false;
  const pk = { stage: 'set', t: 0, n: [0, 0], order: [[], []], scored: false, team: 0 };
  const tmp = { x: 0, y: 0 };
  let goalTeam = 0, goalScorer = -1;
  let steps = 0, fresh = true;
  let freeT = 0; // s the ball just struck is clear of everyone's feet // fresh: the ball changed hands, so the shape is stale
  const halfEndMinute = () => [0, 45, 90, 105, 120, 120][s.half];

  // ---------- frames ----------
  const attackY = t => (t === s.up ? 0 : L); // the goal line team t shoots at
  const ownY = t => (t === s.up ? L : 0);
  const fwd = t => (t === s.up ? -1 : 1); // the y direction team t attacks
  const inBox = (t, x, y) => Math.abs(x - CX) < PITCH.boxW / 2 && (ownY(t) === 0 ? y < PITCH.boxD : y > L - PITCH.boxD);
  const hdist = (i, x, y) => Math.hypot(players[i].x - x, players[i].y - y);
  const live = i => !players[i].off;
  const halfLen = () => (s.half <= 2 ? halfSeconds : halfSeconds / 3);
  function setAnim(p, a) {
    if (p.anim !== a) { p.anim = a; p.animT = 0; }
  }
  function lockAnim(i, a, t) {
    setAnim(players[i], a);
    M[i].lock = t;
  }

  /** where the ball will be in tau seconds (no spin, no drag; a landing loses a quarter of its pace) */
  function ballAt(tau, out) {
    let x = b.x, y = b.y, vx = b.vx, vy = b.vy, t = tau;
    if (b.owner >= 0) {
      const p = players[b.owner];
      out.x = b.x + p.vx * tau; out.y = b.y + p.vy * tau;
      return out;
    }
    if (b.z > 0.05 || b.vz > 0.5) {
      const tl = (b.vz + Math.sqrt(b.vz * b.vz + 2 * P.g * Math.max(0, b.z))) / P.g, tf = Math.min(t, tl);
      x += vx * tf; y += vy * tf; t -= tf;
      if (t <= 0) { out.x = x; out.y = y; return out; }
      vx *= 0.75; vy *= 0.75;
    }
    const sp = Math.hypot(vx, vy);
    if (sp > 0.01) {
      const d = rollDist(sp, t);
      x += (vx / sp) * d; y += (vy / sp) * d;
    }
    out.x = x; out.y = y;
    return out;
  }
  /** seconds for player i to reach the ball (and where), a few rounds of guess-and-correct */
  function intercept(i, out) {
    const p = players[i], top = M[i].top;
    let tau = Math.hypot(b.x - p.x, b.y - p.y) / top;
    for (let n = 0; n < 3; n++) {
      ballAt(tau, out);
      tau = Math.hypot(out.x - p.x, out.y - p.y) / top + 0.1;
    }
    ballAt(Math.max(0, tau - 0.1), out);
    return tau;
  }

  const ctx = { s, M, P, PITCH, attackY, ownY, fwd, inBox, ballAt, intercept, passSpeed, loft, cpu: cpuSide, seed };
  const ai = createAI(ctx);

  // ---------- the flow ----------
  startHalf(1);

  function step(inputs = []) {
    if (match.done) return;
    s.t += DT;
    s.phaseT += DT;
    for (let i = 0; i < 22; i++) {
      const p = players[i], m = M[i];
      p.animT += DT;
      if (m.lock > 0) m.lock -= DT;
      if (m.noTouch > 0) m.noTouch -= DT;
      if (m.touchCd > 0) m.touchCd -= DT;
      if (m.saveCd > 0) m.saveCd -= DT;
      if (m.receive > 0) m.receive -= DT;
    }
    if (passT > 0 && (passT -= DT) <= 0) { passT = 0; passTo = -1; }
    const ph = s.phase;
    if (ph === 'play') playStep(inputs);
    else if (ph === 'setpiece' || ph === 'kickoff') setStep(inputs);
    else if (ph === 'goal') goalStep();
    else if (ph === 'halftime') breakStep();
    else if (ph === 'fulltime') fullStep();
    else if (ph === 'pens') pensStep(inputs);
    for (let i = 0; i < 22; i++) { const p = players[i]; p.human = !cpuSide[p.team] && s.control[p.team] === i && !p.off; }
    if (s.phase === 'play' || s.phase === 'setpiece' || s.phase === 'goal') {
      if (s.half <= 4) s.clock += DT;
    }
    if (s.half <= 4) {
      const base = [0, 0, 45, 90, 105][s.half], span = s.half <= 2 ? 45 : 15;
      s.minute = base + Math.min(span, Math.floor((s.clock / halfLen()) * span));
    } else s.minute = 120;
  }

  function startHalf(h) {
    s.half = h;
    s.clock = 0;
    s.up = h % 2 === 1 ? 0 : 1;
    if (h === 3) etKick = rand(s) < 0.5 ? 0 : 1;
    const kicks = h === 1 ? firstKick : h === 2 ? 1 - firstKick : h === 3 ? etKick : 1 - etKick;
    kickoff(kicks);
  }

  function resetBall(x, y) {
    b.x = x; b.y = y; b.z = 0; b.vx = b.vy = b.vz = 0; b.spin = 0; b.owner = -1;
    netSide = -1; netHit = false;
  }
  function clearActions() {
    s.kick = null; s.after = null; afterSide = -1; passTo = -1; passT = 0;
    fresh = true;
    for (const h of H) { h.charging = false; h.pend = false; h.holdT = 0; h.idle = 0; }
    for (const m of M) { m.plan = null; m.receive = 0; m.held = 0; }
  }

  function kickoff(team) {
    s.phase = 'kickoff'; s.phaseT = 0;
    clearActions();
    resetBall(CX, L / 2);
    b.last = -1;
    for (let i = 0; i < 22; i++) {
      const p = players[i], m = M[i];
      m.slideT = 0; m.downT = 0; m.gkState = 'set'; m.lock = 0;
      if (p.off) continue;
      ai.kickoffSpot(i, team, tmp);
      p.x = tmp.x; p.y = tmp.y; p.vx = p.vy = 0;
      p.dir = fwd(p.team) < 0 ? -Math.PI / 2 : Math.PI / 2;
      setAnim(p, 'stand');
    }
    // the kicker stands over the ball: the most advanced of the side
    let taker = -1, best = -1;
    for (let i = team * 11 + 1; i < team * 11 + 11; i++) if (live(i) && M[i].fy > best) { best = M[i].fy; taker = i; }
    const p = players[taker], f = fwd(team);
    p.x = CX + 0.5; p.y = L / 2 - f * 0.4;
    const aim = Math.atan2(-f * 0.6, -1);
    p.dir = aim;
    s.setpiece = { kind: 'kickoff', team, x: CX, y: L / 2, taker, aim };
    spReady = true; spReadyT = 0; spPlaced = true;
    for (let t = 0; t < 2; t++) s.control[t] = t === team ? taker : nearestTo(t, CX, L / 2, -1);
    emit({ type: 'kickoff' });
    emit({ type: 'whistle', kind: 'start' });
  }

  function endHalf() {
    clearActions();
    s.setpiece = null;
    const draw = s.score[0] === s.score[1];
    if (s.half === 1 || s.half === 3 || (s.half === 2 && knockout && draw)) {
      s.phase = 'halftime'; s.phaseT = 0;
      emit({ type: 'whistle', kind: s.half === 2 ? 'full' : 'half' });
      emit({ type: 'halftime' });
    } else if (s.half === 4 && draw) {
      emit({ type: 'whistle', kind: 'full' });
      startShootout();
    } else {
      s.phase = 'fulltime'; s.phaseT = 0;
      emit({ type: 'whistle', kind: 'full' });
      emit({ type: 'fulltime' });
    }
  }
  function breakStep() {
    standAll();
    if (s.phaseT >= P.breakT) startHalf(s.half + 1);
  }
  function fullStep() {
    standAll();
    if (s.phaseT >= P.overT) {
      s.phase = 'over'; s.phaseT = 0;
      match.done = true;
      emit({ type: 'end' });
    }
  }
  function standAll() {
    for (let i = 0; i < 22; i++) {
      const p = players[i];
      p.vx *= 0.9; p.vy *= 0.9;
      p.x += p.vx * DT; p.y += p.vy * DT;
      if (M[i].downT > 0) M[i].downT -= DT;
      else if (p.anim !== 'celebrate') setAnim(p, Math.hypot(p.vx, p.vy) > 0.6 ? 'run' : 'stand');
    }
    ballPhysics();
  }

  // ---------- open play ----------
  function playStep(inputs) {
    for (let t = 0; t < 2; t++) if (!cpuSide[t]) humanSide(t, inputs[t] || EMPTY_INPUT);
    if (s.phase !== 'play') return; // a kick can't change the phase, but stay safe
    // the shape at 20 Hz, the two sides on different steps; a new kick refreshes both
    const k = steps++ % 3;
    if (k === 0 || fresh) ai.shape(0);
    if (k === 1 || fresh) ai.shape(1);
    fresh = false;
    aiActions();
    for (let i = 0; i < 22; i++) movePlayer(i);
    aftertouch(inputs);
    const x0 = b.x, y0 = b.y, z0 = b.z;
    ballPhysics();
    keepers();
    if (s.phase !== 'play') return;
    touches();
    if (lines(x0, y0, z0)) return;
    separate();
    for (let t = 0; t < 2; t++) if (!cpuSide[t]) switchControl(t);
    else s.control[t] = b.owner >= 0 && players[b.owner].team === t ? b.owner : -1;
    // possession: whoever has it, or touched it last
    const pt = b.owner >= 0 ? players[b.owner].team : b.last >= 0 ? players[b.last].team : -1;
    if (pt >= 0) tPos[pt] += DT;
    const tot = tPos[0] + tPos[1];
    if (tot > 0) { s.stats.possession[0] = tPos[0] / tot; s.stats.possession[1] = tPos[1] / tot; }
    if (s.clock >= halfLen()) endHalf();
  }

  // the AI's kicks, headers and slides
  function aiActions() {
    // the carrier
    const o = b.owner;
    if (o >= 0 && !players[o].human && !M[o].gk) {
      const m = M[o];
      m.held += DT;
      if ((m.thinkT -= DT) <= 0) {
        m.plan = ai.carrier(o);
        m.thinkT = P.think * (0.7 + rand(s) * 0.6);
      }
      const pl = m.plan || { kind: 'dribble', dx: m.wx || 0, dy: m.wy || fwd(players[o].team) };
      if (pl.kind === 'dribble') { m.wx = pl.dx; m.wy = pl.dy; m.wmag = 1; }
      else {
        // carry on toward the target until the ball is at the feet, then strike
        const dx = pl.tx - b.x, dy = pl.ty - b.y, d = Math.hypot(dx, dy) || 1;
        m.wx = dx / d; m.wy = dy / d; m.wmag = 0.6;
        if (hdist(o, b.x, b.y) < P.kickR && b.z < 0.8) {
          // a plan made a while ago is looked at again before it's struck
          if (s.t - pl.at > 0.2) m.plan = ai.carrier(o);
          if (m.plan.kind !== 'dribble') runPlan(o, m.plan);
        }
      }
    }
    // heads and volleys for whoever the AI plays, the nearest of all to a ball in the air
    if (b.owner < 0 && b.z > 0.45 && b.z < 2.7) {
      let best = -1, bd = 1.15;
      for (let i = 0; i < 22; i++) {
        const p = players[i], m = M[i];
        if (p.off || p.human || m.gk || m.noTouch > 0 || m.downT > 0 || m.slideT > 0 || m.lock > 0) continue;
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) {
        const pl = ai.aerial(best);
        if (pl) runPlan(best, pl);
      }
    }
    // slides: the chasers decide
    for (let i = 0; i < 22; i++) {
      const p = players[i], m = M[i];
      if (p.off || p.human || m.gk || m.slideT > 0 || m.downT > 0 || m.lock > 0) continue;
      if (m.run < 1 || b.owner < 0 || players[b.owner].team === p.team) continue;
      const a = ai.slide(i);
      if (a !== null) startSlide(i, Math.cos(a), Math.sin(a));
    }
  }

  // carry out a kick plan { kind, tx, ty, speed, vz, spin, to }
  function runPlan(i, pl) {
    const dx = pl.tx - b.x, dy = pl.ty - b.y;
    const power = clamp(Math.hypot(pl.speed, pl.vz) / 32, 0, 1);
    kick(i, dx, dy, pl.speed, pl.vz, pl.spin || 0, pl.kind, power);
    if (pl.to >= 0) aimPass(pl.to, pl.tx, pl.ty, Math.hypot(dx, dy) / Math.max(4, pl.speed * 0.7) + 1);
  }
  function aimPass(to, x, y, t) {
    passTo = to; passT = t;
    M[to].receive = t; M[to].rx = x; M[to].ry = y;
  }

  // ---------- moving ----------
  function steer(i, wx, wy) {
    const p = players[i], m = M[i];
    let ax = wx - p.vx, ay = wy - p.vy;
    const a = Math.hypot(ax, ay), lim = m.acc * DT;
    if (a > lim) { ax *= lim / a; ay *= lim / a; }
    p.vx += ax; p.vy += ay;
  }
  function toward(i, tx, ty, frac) {
    const p = players[i], m = M[i], dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    const want = d < 0.12 ? 0 : Math.min(m.top * frac, d * 4);
    steer(i, d > 1e-6 ? (dx / d) * want : 0, d > 1e-6 ? (dy / d) * want : 0);
  }
  function face(p, a, rate) {
    const d = wrapA(a - p.dir), k = rate * DT;
    p.dir = wrapA(p.dir + clamp(d, -k, k));
  }
  function integrate(i) {
    const p = players[i], m = M[i];
    p.x += p.vx * DT; p.y += p.vy * DT;
    p.x = clamp(p.x, -4, W + 4); p.y = clamp(p.y, -3, L + 3);
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0.5 && m.slideT <= 0 && m.downT <= 0 && m.gkState !== 'dive') face(p, Math.atan2(p.vy, p.vx), 14);
    if (m.lock <= 0 && m.slideT <= 0 && m.downT <= 0 && !(m.gk && m.gkState !== 'set')) setAnim(p, sp > 0.6 ? 'run' : 'stand');
  }

  function movePlayer(i) {
    const p = players[i], m = M[i];
    if (p.off) { walkOff(i); return; }
    if (m.gk) return; // keepers() moves them
    if (m.slideT > 0) { slideStep(i); integrate(i); return; }
    if (m.downT > 0) {
      m.downT -= DT;
      p.vx *= 0.85; p.vy *= 0.85;
      setAnim(p, m.slideHit || m.downT > 0 ? 'down' : 'stand');
      integrate(i);
      return;
    }
    if (b.owner === i) {
      if (p.human) { const h = H[p.team]; m.wx = h.ix; m.wy = h.iy; m.wmag = h.im; }
      carrierMove(i);
    } else if (p.human && (H[p.team].im > 0.2 || m.receive <= 0)) {
      const h = H[p.team];
      steer(i, h.ix * m.top * h.im, h.iy * m.top * h.im);
      if (h.im > 0.2) face(p, Math.atan2(h.iy, h.ix), 16);
    } else toward(i, m.tx, m.ty, m.run);
    integrate(i);
  }

  // the carrier: runs where he wants when the ball is ahead of him, else goes round to it
  function carrierMove(i) {
    const p = players[i], m = M[i];
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
    const top = m.top * P.carry;
    if (m.wmag < 0.2) {
      toward(i, b.x - Math.cos(p.dir) * 0.3, b.y - Math.sin(p.dir) * 0.3, 0.5);
      return;
    }
    const ahead = d < 0.3 || dx * m.wx + dy * m.wy > d * 0.4;
    if (ahead && d < 1.7) {
      // along the wish, edging onto the ball's line so the next touch comes
      const side = dx * -m.wy + dy * m.wx;
      const sp = top * Math.min(1, m.wmag);
      steer(i, m.wx * sp - m.wy * side * 2, m.wy * sp + m.wx * side * 2);
    } else {
      // back onto it, where it will be, at pace: the next touch turns it the new way
      const tx = b.x + b.vx * 0.1 - p.x, ty = b.y + b.vy * 0.1 - p.y, td = Math.hypot(tx, ty) || 1;
      steer(i, (tx / td) * top, (ty / td) * top);
    }
    if (m.wmag > 0.2) face(p, Math.atan2(m.wy, m.wx), 10);
  }

  function walkOff(i) {
    const p = players[i], tx = p.x < CX ? -2 : W + 2;
    if (Math.abs(p.x - tx) > 0.2) {
      const v = Math.sign(tx - p.x) * 2.5;
      p.vx = v; p.vy = 0;
      p.x += v * DT;
      p.dir = v < 0 ? Math.PI : 0;
      setAnim(p, 'run');
    } else { p.vx = p.vy = 0; setAnim(p, 'stand'); }
  }

  // players don't stand inside each other
  function separate() {
    for (let i = 0; i < 22; i++) {
      const A = players[i];
      if (A.off) continue;
      for (let j = i + 1; j < 22; j++) {
        const B = players[j];
        if (B.off) continue;
        const dx = A.x - B.x, dy = A.y - B.y;
        if (dx > 0.7 || dx < -0.7 || dy > 0.7 || dy < -0.7) continue;
        const d = Math.hypot(dx, dy);
        if (d >= 0.7) continue;
        const push = (0.7 - d) / 2, nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
        A.x += nx * push; A.y += ny * push; B.x -= nx * push; B.y -= ny * push;
      }
    }
  }

  // ---------- the ball ----------
  function ballPhysics() {
    if (b.owner >= 0 && M[b.owner].gk && M[b.owner].gkState === 'hold') {
      const p = players[b.owner];
      b.x = p.x + Math.cos(p.dir) * 0.3; b.y = p.y + Math.sin(p.dir) * 0.3; b.z = 1;
      b.vx = p.vx; b.vy = p.vy; b.vz = 0; b.spin = 0;
      return;
    }
    const air = b.z > 0.001 || b.vz > 0.01;
    const sp = Math.hypot(b.vx, b.vy);
    // spin turns the velocity: the curl
    if (b.spin !== 0) {
      if (sp > 0.5) {
        const th = P.magnus * b.spin * (air ? 1 : P.rollSpin) * DT, c = Math.cos(th), sn = Math.sin(th);
        const vx = b.vx;
        b.vx = vx * c - b.vy * sn; b.vy = vx * sn + b.vy * c;
      }
      b.spin *= SPIN_KEEP;
      if (Math.abs(b.spin) < 0.01) b.spin = 0;
    }
    if (air) {
      const v3 = Math.hypot(b.vx, b.vy, b.vz), k = 1 - P.drag * v3 * DT;
      b.vx *= k; b.vy *= k; b.vz *= k;
      b.vz -= P.g * DT;
    } else if (sp > 0) {
      const nv = Math.max(0, sp - (P.rollC + P.roll * sp) * DT);
      b.vx *= nv / sp; b.vy *= nv / sp;
    }
    b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
    if (b.z < 0) {
      b.z = 0;
      if (b.vz < -P.bounceMin) {
        emit({ type: 'bounce', speed: -b.vz });
        b.vz = -b.vz * P.bounce;
        b.vx *= P.bounceKeep; b.vy *= P.bounceKeep;
      } else b.vz = 0;
    }
    frame();
    // the hoardings round the ground: nothing leaves the world
    if (b.x < -5 || b.x > W + 5) { b.x = clamp(b.x, -5, W + 5); b.vx *= -0.3; }
    if (b.y < -6 || b.y > L + 6) { b.y = clamp(b.y, -6, L + 6); b.vy *= -0.3; }
  }

  // posts, bar, net
  function frame() {
    for (let g = 0; g < 2; g++) {
      const gy = g ? L : 0;
      if (Math.abs(b.y - gy) > 3) continue;
      if (b.z < PITCH.goalH + R) {
        for (let k = -1; k <= 1; k += 2) {
          const px = CX + k * (HG + POST);
          const dx = b.x - px, dy = b.y - gy, d = Math.hypot(dx, dy);
          if (d < R + POST && d > 1e-6) {
            const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
            b.x = px + nx * (R + POST); b.y = gy + ny * (R + POST);
            if (vn < 0) {
              b.vx -= (1 + P.postE) * vn * nx; b.vy -= (1 + P.postE) * vn * ny;
              b.spin *= 0.3;
              if (-vn > 2) { emit({ type: 'post' }); nearMiss(); }
            }
          }
        }
      }
      if (Math.abs(b.x - CX) < HG + POST) {
        const dy = b.y - gy, dz = b.z - (PITCH.goalH + POST), d = Math.hypot(dy, dz);
        if (d < R + POST && d > 1e-6) {
          const ny = dy / d, nz = dz / d, vn = b.vy * ny + b.vz * nz;
          b.y = gy + ny * (R + POST); b.z = PITCH.goalH + POST + nz * (R + POST);
          if (vn < 0) {
            b.vy -= (1 + P.postE) * vn * ny; b.vz -= (1 + P.postE) * vn * nz;
            if (-vn > 2) { emit({ type: 'bar' }); nearMiss(); }
          }
        }
      }
    }
    // in the net: it swallows the ball
    if (netSide >= 0) {
      const back = netSide === 0 ? -PITCH.goalD + R : L + PITCH.goalD - R;
      let hit = false;
      if (netSide === 0 ? b.y < back : b.y > back) { b.y = back; b.vy *= -0.1; hit = true; }
      if (Math.abs(b.x - CX) > HG - R) { b.x = CX + Math.sign(b.x - CX) * (HG - R); b.vx *= -0.1; hit = true; }
      if (b.z > PITCH.goalH - R) { b.z = PITCH.goalH - R; if (b.vz > 0) b.vz *= -0.1; hit = true; }
      const inside = netSide === 0 ? b.y < -R : b.y > L + R;
      if (inside) {
        const k = 1 - 3.5 * DT;
        b.vx *= k; b.vy *= k;
      }
      if (hit && !netHit) { netHit = true; emit({ type: 'net' }); }
    }
  }
  function nearMiss() {
    if (s.t - shotT < 3 && shotTeam >= 0) { emit({ type: 'chance', team: shotTeam }); shotT = -99; }
  }

  // the lines: a goal, or out of play. True when play stopped.
  function lines(x0, y0, z0) {
    for (let g = 0; g < 2; g++) {
      const gy = g ? L : 0, sg = g ? 1 : -1;
      if ((b.y - gy) * sg > R && (y0 - gy) * sg <= R) {
        const f = (gy + sg * R - y0) / (b.y - y0 || 1e-9), xc = x0 + (b.x - x0) * f, zc = z0 + (b.z - z0) * f;
        if (Math.abs(xc - CX) < HG && zc < PITCH.goalH) goal(gy === attackY(0) ? 0 : 1, gy);
        else goalLine(gy, xc, zc);
        return true;
      }
    }
    if (b.x < -R || b.x > W + R) {
      const t = b.last >= 0 ? 1 - players[b.last].team : 0;
      out('throw', t, b.x < 0 ? 0 : W, clamp(b.y, 1, L - 1));
      return true;
    }
    return false;
  }
  function goalLine(gy, xc, zc) {
    const def = ownY(0) === gy ? 0 : 1;
    if (s.t - shotT < 3 && shotTeam === 1 - def && Math.abs(xc - CX) < HG + 2.5 && zc < PITCH.goalH + 1.2) nearMiss();
    const lt = b.last >= 0 ? players[b.last].team : 1 - def;
    if (lt === def) out('corner', 1 - def, xc < CX ? 0.6 : W - 0.6, gy === 0 ? 0.6 : L - 0.6);
    else out('goalkick', def, xc < CX ? CX - PITCH.sixW / 2 : CX + PITCH.sixW / 2, gy === 0 ? PITCH.sixD : L - PITCH.sixD);
  }
  function out(kind, team, x, y) {
    emit({ type: 'out', kind });
    emit({ type: 'whistle', kind: 'out' });
    award(kind, team, x, y);
  }

  function goal(team, gy) {
    const scorerTeamKick = lastKick[team];
    let scorer, own = false;
    const last = b.last, lt = last >= 0 ? players[last].team : team;
    if (lt === team) scorer = last;
    else if (lastDeliberate && !M[last].gk) { scorer = last; own = true; }
    else if (scorerTeamKick >= 0 && s.t - lastKickT[team] < 6) scorer = scorerTeamKick;
    else { scorer = last; own = true; }
    if (scorer < 0) { scorer = team * 11 + 10; own = false; }
    s.score[team]++;
    if (!own && s.t - shotT < 4 && shotTeam === team && !shotCounted) { s.stats.onTarget[team]++; shotCounted = true; }
    const pen = penKick && !own;
    scorers.push({ team, name: players[scorer].name, minute: Math.max(1, s.minute + 1 > halfEndMinute() ? halfEndMinute() : s.minute + 1), own, pen });
    emit({ type: 'goal', team, scorer, minute: scorers[scorers.length - 1].minute, own });
    emit({ type: 'whistle', kind: 'goal' });
    netSide = gy === 0 ? 0 : 1; netHit = false;
    s.phase = 'goal'; s.phaseT = 0;
    s.kick = null; s.after = null; afterSide = -1;
    for (const h of H) { h.charging = false; h.pend = false; }
    goalTeam = team; goalScorer = own ? -1 : scorer;
    if (!own) setAnim(players[scorer], 'celebrate');
  }

  function goalStep() {
    ballPhysics();
    const ct = goalTeam;
    // the scorer wheels away to the nearest corner flag, his team after him; the rest trudge back
    const sc = goalScorer >= 0 ? players[goalScorer] : null;
    const fx = sc && sc.x < CX ? 2 : W - 2, fy = attackY(ct) === 0 ? 3 : L - 3;
    for (let i = 0; i < 22; i++) {
      const p = players[i], m = M[i];
      if (p.off) { walkOff(i); continue; }
      if (m.downT > 0) m.downT -= DT;
      if (i === goalScorer) {
        toward(i, fx, fy, 0.85);
        integrate(i);
        setAnim(p, 'celebrate');
        continue;
      }
      if (p.team === ct && sc && !m.gk && s.phaseT > 0.6) toward(i, sc.x, sc.y, 0.7);
      else {
        ai.kickoffSpot(i, 1 - ct, tmp);
        toward(i, tmp.x, tmp.y, s.phaseT > 1.5 ? 0.5 : 0.1);
      }
      if (m.gk) { const p0 = players[i]; p0.x += p0.vx * DT; p0.y += p0.vy * DT; setAnim(p0, 'stand'); }
      else integrate(i);
      if (p.team === ct && sc && Math.hypot(p.x - sc.x, p.y - sc.y) < 2.5) setAnim(p, 'celebrate');
    }
    separate();
    if (s.phaseT >= P.goalT) {
      if (s.clock >= halfLen()) endHalf();
      else kickoff(1 - ct);
    }
  }

  // ---------- set pieces ----------
  function award(kind, team, x, y) {
    s.phase = 'setpiece'; s.phaseT = 0;
    clearActions();
    let taker = -1;
    if (kind === 'goalkick') taker = GK[team];
    else if (kind === 'penalty') {
      let best = -1;
      for (let i = team * 11 + 1; i < team * 11 + 11; i++) {
        if (!live(i)) continue;
        const v = M[i].shooting * 2 - (M[i].downT > 0 ? 5 : 0);
        if (v > best) { best = v; taker = i; }
      }
    } else taker = nearestTo(team, x, y, -1);
    const ag = attackY(team), f = fwd(team);
    let aim;
    if (kind === 'throw') aim = Math.atan2(f * 0.35, x < CX ? 1 : -1);
    else if (kind === 'corner') aim = Math.atan2((ag === 0 ? PITCH.spot : L - PITCH.spot) - y, CX - x);
    else if (kind === 'goalkick') aim = Math.atan2(f, 0);
    else aim = Math.atan2(ag - y, CX - x);
    s.setpiece = { kind, team, x, y, taker, aim };
    spReady = false; spReadyT = 0;
    spPlaced = kind === 'freekick' || kind === 'penalty';
    if (spPlaced) resetBall(x, y);
    b.owner = -1;
    if (kind === 'corner') s.stats.corners[team]++;
    for (let t = 0; t < 2; t++) if (!cpuSide[t]) s.control[t] = t === team && !M[taker].gk ? taker : nearestTo(t, x, y, -1);
    if (kind === 'penalty') emit({ type: 'penalty', team });
  }
  // where the taker stands: behind the ball along the aim (on the line, for a throw)
  function takerSpot(sp, out) {
    if (sp.kind === 'throw') { out.x = sp.x < CX ? -0.25 : W + 0.25; out.y = sp.y; return out; }
    out.x = sp.x - Math.cos(sp.aim) * 0.55; out.y = sp.y - Math.sin(sp.aim) * 0.55;
    return out;
  }

  function setStep(inputs) {
    const sp = s.setpiece, tk = sp.taker, tp = players[tk];
    const humanTaker = !cpuSide[sp.team];
    // the ball rolls out, then is fetched to the spot
    if (!spPlaced) {
      ballPhysics();
      if (s.phaseT > 0.7) { resetBall(sp.x, sp.y); spPlaced = true; }
    } else if (sp.kind === 'throw' && spReady) {
      b.x = tp.x + Math.cos(sp.aim) * 0.1; b.y = tp.y; b.z = 2.1; b.vx = b.vy = b.vz = 0;
    }
    ai.setShape();
    takerSpot(sp, tmp);
    const sx = tmp.x, sy = tmp.y;
    for (let i = 0; i < 22; i++) {
      const p = players[i], m = M[i];
      if (p.off) { walkOff(i); continue; }
      if (i === tk) {
        if (!spReady) {
          toward(i, sx, sy, 1);
          integrate(i);
          if ((spPlaced && Math.hypot(p.x - sx, p.y - sy) < 0.4) || s.phaseT > P.snapT) {
            if (!spPlaced) { resetBall(sp.x, sp.y); spPlaced = true; }
            p.x = sx; p.y = sy; p.vx = p.vy = 0; spReady = true;
          }
        } else { p.vx = p.vy = 0; p.dir = sp.aim; setAnim(p, sp.kind === 'throw' ? 'throw' : 'stand'); }
        continue;
      }
      if (m.downT > 0) { m.downT -= DT; p.vx *= 0.85; p.vy *= 0.85; setAnim(p, 'down'); integrate(i); continue; }
      if (m.slideT > 0) { m.slideT -= DT; p.vx *= 0.9; p.vy *= 0.9; integrate(i); continue; }
      if (p.human && !humanTaker && p.team !== sp.team) {
        const h = H[p.team], inp = inputs[p.team] || EMPTY_INPUT;
        readStick(h, inp);
        steer(i, h.ix * m.top * h.im, h.iy * m.top * h.im);
      } else if (m.gk) toward(i, m.tx, m.ty, 0.8);
      else toward(i, m.tx, m.ty, m.run);
      integrate(i);
    }
    separate();
    if (sp.kind !== 'penalty' && sp.kind !== 'kickoff' && s.clock >= halfLen()) { endHalf(); return; }
    if (!spReady) return;
    spReadyT += DT;
    if (humanTaker) {
      const h = H[sp.team], inp = inputs[sp.team] || EMPTY_INPUT;
      readStick(h, inp);
      if (h.im > 0.3) sp.aim = clampAim(sp, Math.atan2(h.iy, h.ix));
      tp.dir = sp.aim;
      const fire = kickButton(h, inp);
      if (fire && spReadyT > 0.25) takeHuman(sp, fire === 'hold', h.fireCharge);
      else if (idle(h, inp) >= P.idleTake) takeKick(sp, aimed(sp, ai.setpiece()));
    } else if (spReadyT >= P.cpuTake + (sp.kind === 'corner' || sp.kind === 'penalty' ? 0.4 : 0)) {
      takeKick(sp, aimed(sp, ai.setpiece()));
    }
  }
  // seconds a human side has left its taker alone: no stick, no button
  function idle(h, inp) {
    if (h.im > 0 || inp.kick || h.charging) h.idle = 0;
    else h.idle += DT;
    return h.idle;
  }
  function aimed(sp, pl) {
    sp.aim = Math.atan2(pl.ty - b.y, pl.tx - b.x);
    players[sp.taker].dir = sp.aim;
    return pl;
  }
  // the aim can't point off the pitch from a throw or a corner, and a penalty goes at the goal
  function clampAim(sp, a) {
    if (sp.kind === 'penalty') {
      // no further round than just inside a post
      const g = Math.atan2(attackY(sp.team) - sp.y, 0), lim = Math.atan2(HG - 0.6, PITCH.spot);
      return g + clamp(wrapA(a - g), -lim, lim);
    }
    if (sp.kind === 'throw' || sp.kind === 'corner' || sp.kind === 'goalkick') {
      const nx = sp.x < 1 ? 1 : sp.x > W - 1 ? -1 : 0, ny = sp.kind === 'throw' ? 0 : sp.y < 1 ? 1 : sp.y > L - 1 ? -1 : sp.kind === 'goalkick' ? (sp.y < CX ? 1 : -1) : 0;
      const n = Math.atan2(ny, nx), lim = sp.kind === 'corner' ? Math.PI / 4 : Math.PI / 2 - 0.15;
      return n + clamp(wrapA(a - n), -lim, lim);
    }
    return a;
  }
  function takeHuman(sp, hold, charge) {
    const ax = Math.cos(sp.aim), ay = Math.sin(sp.aim), tk = sp.taker;
    beginPlay(sp);
    if (sp.kind === 'throw') {
      b.z = 2.1;
      const d = hold ? 12 + charge * 14 : assistDist(tk, ax, ay, 14);
      const l = loft(d, 0.1);
      kick(tk, ax, ay, Math.min(l.speed, 16), Math.min(l.vz, 6), 0, 'throw', hold ? charge : 0.3);
      return;
    }
    if (hold) humanHold(tk, ax, ay, charge);
    else humanPass(tk, ax, ay);
    if (sp.kind === 'penalty') penKick = true;
  }
  function takeKick(sp, pl) {
    beginPlay(sp);
    if (sp.kind === 'throw') b.z = 2.1;
    runPlan(sp.taker, pl);
    if (sp.kind === 'penalty') penKick = true;
  }
  function beginPlay(sp) {
    s.phase = 'play'; s.phaseT = 0;
    s.setpiece = null;
    if (sp.kind !== 'throw') { b.x = sp.x; b.y = sp.y; b.z = 0; }
    b.vx = b.vy = b.vz = 0;
    if (sp.kind === 'penalty' || s.phase === 'pens') penaltyKeeper(sp.team);
  }

  // ---------- human control ----------
  function readStick(h, inp) {
    const x = clamp(+inp.x || 0, -1, 1), y = clamp(+inp.y || 0, -1, 1), m = Math.hypot(x, y);
    if (m > 0.2) { h.ix = x / m; h.iy = y / m; h.im = Math.min(1, m); } else { h.im = 0; }
  }
  // the kick button: returns 'tap' or 'hold' on the step it fires, else null; keeps s.kick
  function kickButton(h, inp) {
    const down = !!inp.kick, pressed = down && !h.prev, released = !down && h.prev;
    h.prev = down;
    if (pressed) { h.charging = true; h.holdT = 0; }
    if (!h.charging) return null;
    h.holdT += DT;
    const charge = clamp((h.holdT - P.tap) / (P.full - P.tap), 0, 1);
    s.kick = h.holdT > P.tap ? { charge } : { charge: 0 };
    if (released || h.holdT >= P.auto) {
      h.charging = false;
      s.kick = null;
      h.fireCharge = charge;
      return h.holdT < P.tap ? 'tap' : 'hold';
    }
    return null;
  }

  function humanSide(t, inp) {
    const h = H[t];
    readStick(h, inp);
    const c = s.control[t];
    if (c < 0 || players[c].off) { h.prev = !!inp.kick; h.charging = false; return; }
    const p = players[c], m = M[c];
    const busy = m.slideT > 0 || m.downT > 0;
    const down = !!inp.kick, pressed = down && !h.prev;
    const near = Math.hypot(b.x - p.x, b.y - p.y);
    const ax = h.im > 0.2 ? h.ix : Math.cos(p.dir), ay = h.im > 0.2 ? h.iy : Math.sin(p.dir);
    if (pressed && !busy && !h.charging) {
      const mine = b.owner === c || (b.owner < 0 && near < 1.8 && b.z < 0.45);
      if (b.owner < 0 && near < 1.4 && b.z >= 0.45 && b.z < 2.7) {
        h.prev = true;
        aerial(c, ax, ay);
        return;
      }
      if (!mine && !(b.owner >= 0 && M[b.owner].gk && M[b.owner].gkState === 'hold')) {
        h.prev = true;
        if (b.owner < 0 || players[b.owner].team !== t) {
          // a little help: a slide near the ball's line goes where the ball is going
          const f = ballAt(clamp(near / 7, 0.1, 0.4), tmp), fx = f.x - p.x, fy = f.y - p.y, fd = Math.hypot(fx, fy) || 1;
          if (fd < 5 && (fx * ax + fy * ay) / fd > Math.cos(P.slideAssist)) startSlide(c, fx, fy);
          else startSlide(c, ax, ay);
        }
        return;
      }
    }
    if (busy) { h.prev = down; h.charging = false; s.kick = null; return; }
    const fire = kickButton(h, inp);
    if (fire) { h.pend = true; h.pendTtl = 0.4; h.pendHold = fire === 'hold'; h.pendCharge = h.fireCharge; }
    if (h.pend) {
      h.pendTtl -= DT;
      const reach = Math.hypot(b.x - p.x, b.y - p.y) < P.kickR && b.z < 0.9 && (b.owner < 0 || b.owner === c);
      if (reach) {
        h.pend = false;
        if (h.pendHold) humanHold(c, ax, ay, h.pendCharge);
        else humanPass(c, ax, ay);
      } else if (h.pendTtl <= 0 && (b.owner !== c || h.pendTtl < -0.6)) h.pend = false; // his own ball: a moment longer to reach it
    }
  }

  // switch to the teammate best placed for the ball; never away from the carrier
  function switchControl(t) {
    const h = H[t];
    let cur = s.control[t];
    if (cur >= 0 && (players[cur].off || M[cur].gk)) cur = -1;
    const o = b.owner;
    if (o >= 0 && players[o].team === t && !M[o].gk) cur = o;
    else if (o >= 0 && players[o].team === t) { /* our keeper has it: stay */ }
    else if (h.charging || h.pend) { /* mid-kick */ }
    else if (passTo >= 0 && players[passTo].team === t && !M[passTo].gk) cur = passTo;
    else if (cur < 0 || M[cur].slideT <= 0) {
      ballAt(0.3, tmp);
      let best = -1, bd = 1e9;
      for (let i = t * 11 + 1; i < t * 11 + 11; i++) {
        const p = players[i];
        if (p.off) continue;
        const d = Math.hypot(p.x - tmp.x, p.y - tmp.y) + (M[i].downT > 0 ? 4 : 0);
        if (d < bd) { bd = d; best = i; }
      }
      if (cur < 0) cur = best;
      else if (best !== cur) {
        const dc = Math.hypot(players[cur].x - tmp.x, players[cur].y - tmp.y) + (M[cur].downT > 0 ? 4 : 0);
        if (dc - bd > P.switchHyst) cur = best;
      }
    }
    if (cur !== s.control[t]) { h.pend = false; }
    s.control[t] = cur;
  }

  function nearestTo(t, x, y, not) {
    let best = -1, bd = 1e9;
    for (let i = t * 11 + 1; i < t * 11 + 11; i++) {
      if (i === not || players[i].off) continue;
      const d = hdist(i, x, y) + (M[i].downT > 0 ? 3 : 0);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // ---------- kicks ----------
  function kick(i, ax, ay, speed, vz, spin, kind, power) {
    const p = players[i], m = M[i];
    const l = Math.hypot(ax, ay) || 1;
    ax /= l; ay /= l;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) { ax = 0; ay = fwd(p.team); }
    b.vx = ax * speed; b.vy = ay * speed; b.vz = vz; b.spin = clamp(spin, -P.spinMax, P.spinMax);
    if (vz > 0 && b.z < 0.02) b.z = 0.02;
    b.owner = -1; b.last = i;
    lastKick[p.team] = i; lastKickT[p.team] = s.t; lastDeliberate = true; penKick = false;
    m.noTouch = P.noTouch; m.plan = null; m.held = 0; m.touchCd = 0;
    p.dir = Math.atan2(ay, ax);
    lockAnim(i, kind === 'header' ? 'header' : kind === 'throw' ? 'throw' : 'kick', 0.25);
    emit({ type: 'kick', player: i, power: clamp(power, 0, 1), kind });
    s.after = null; afterSide = -1;
    if (!cpuSide[p.team] && !m.gk && kind !== 'throw') { s.after = { t: P.after }; afterSide = p.team; afterBy = i; }
    passTo = -1; passT = 0;
    fresh = true;
    // a man on the ball as it's struck blocks it now and then; otherwise it gets away clean
    freeT = 0.12;
    for (let j = (1 - p.team) * 11; j < (1 - p.team) * 11 + 11; j++) {
      const q = players[j];
      if (q.off || M[j].downT > 0 || Math.hypot(q.x - b.x, q.y - b.y) > P.reach + 0.15) continue;
      if (rand(s) < P.block + M[j].tackling * 0.03) freeT = 0;
      break;
    }
    // a shot: toward the goal mouth from shooting range
    const gy = attackY(p.team), dy = gy - b.y;
    if (kind === 'shot' || ((kind === 'header' || kind === 'volley') && ay * dy > 0)) {
      const tx = b.x + (ax / (ay || 1e-9)) * dy;
      if (kind === 'shot' || (Math.abs(dy) < 25 && Math.abs(tx - CX) < HG + 4)) {
        s.stats.shots[p.team]++;
        shotT = s.t; shotTeam = p.team; shotCounted = false;
      }
    }
  }

  // a tap: along the facing, nudged onto a teammate within the assist cone, strength from the line
  function assistDist(i, ax, ay, dflt) {
    const p = players[i];
    let lineD = 1e9;
    for (let j = p.team * 11; j < p.team * 11 + 11; j++) {
      if (j === i || players[j].off) continue;
      const dx = players[j].x - p.x, dy = players[j].y - p.y, proj = dx * ax + dy * ay;
      if (proj < 3) continue;
      if (Math.abs(dx * ay - dy * ax) < 7 && proj < lineD) lineD = proj;
    }
    return lineD < 1e9 ? lineD : dflt;
  }
  function humanPass(i, ax, ay) {
    const p = players[i];
    let best = -1, bs = 1e9;
    for (let j = p.team * 11; j < p.team * 11 + 11; j++) {
      if (j === i || players[j].off) continue;
      const dx = players[j].x - b.x, dy = players[j].y - b.y, d = Math.hypot(dx, dy);
      if (d < 3 || d > 55) continue;
      const c = (dx * ax + dy * ay) / d;
      if (c <= 0) continue;
      const ang = Math.acos(Math.min(1, c));
      if (ang > P.assist) continue;
      const sc = ang * 30 + d * 0.04;
      if (sc < bs) { bs = sc; best = j; }
    }
    let dist, kx = ax, ky = ay;
    if (best >= 0) {
      const q = players[best], d0 = Math.hypot(q.x - b.x, q.y - b.y), T = d0 / 14;
      const tx = q.x + q.vx * T * 0.6, ty = q.y + q.vy * T * 0.6;
      kx = tx - b.x; ky = ty - b.y; dist = Math.hypot(kx, ky);
      const sp = passSpeed(dist);
      kick(i, kx, ky, sp, 0, 0, 'pass', sp / 32);
      aimPass(best, tx, ty, T + 1.2);
      return;
    }
    dist = assistDist(i, ax, ay, 18);
    const sp = passSpeed(dist);
    kick(i, kx, ky, sp, 0, 0, 'pass', sp / 32);
  }
  function humanHold(i, ax, ay, charge) {
    const p = players[i], m = M[i];
    const gy = attackY(p.team), dg = Math.hypot(CX - b.x, gy - b.y);
    // toward the goal from range: a little help onto the mouth
    const toG = Math.atan2(gy - b.y, CX - b.x), a0 = Math.atan2(ay, ax), off = wrapA(toG - a0);
    let kind = 'clear';
    if (dg < 40 && Math.abs(off) < 0.6) {
      kind = 'shot';
      // the nearest point inside the posts
      const hit = b.x + (ax / (ay || 1e-9)) * (gy - b.y);
      if (Math.abs(hit - CX) > HG - 0.5 && Math.abs(off) < 0.3) {
        const tx = CX + Math.sign(hit - CX) * (HG - 0.6);
        const want = Math.atan2(gy - b.y, tx - b.x), d = wrapA(want - a0);
        ax = Math.cos(a0 + d * 0.5); ay = Math.sin(a0 + d * 0.5);
      }
    }
    const speed = P.shot0 + P.shotK * charge + m.shooting * P.shotSk;
    const vz = P.lift0 + P.shotLift * charge * charge;
    if (kind !== 'shot') kind = vz > 3 ? 'lob' : 'clear';
    kick(i, ax, ay, speed, vz, 0, kind, 0.3 + charge * 0.7);
  }
  // a header or a volley along (ax, ay)
  function aerial(i, ax, ay) {
    const p = players[i], m = M[i], head = b.z > 1.1;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d > 0.6) { p.x += (b.x - p.x) * 0.5; p.y += (b.y - p.y) * 0.5; } // the stretch / the dive at it
    const speed = head ? P.header + m.shooting * 0.6 : P.volley + m.shooting * 1.1;
    const gy = attackY(p.team), atGoal = (gy - b.y) * ay > 0 && Math.abs(gy - b.y) < 22;
    const vz = head ? (atGoal ? 0.6 - b.z * 0.4 : 2.5) : atGoal ? 1.6 : 3;
    kick(i, ax, ay, speed, vz, 0, head ? 'header' : 'volley', speed / 28);
    lastDeliberate = true;
  }

  function aftertouch() {
    if (!s.after) return;
    s.after.t -= DT;
    if (s.after.t <= 0 || afterSide < 0 || b.owner >= 0 || b.last !== afterBy) { s.after = null; afterSide = -1; return; }
    const h = H[afterSide];
    if (h.im < 0.2) return;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp < 2) return;
    const ux = b.vx / sp, uy = b.vy / sp;
    const across = h.ix * -uy + h.iy * ux, along = h.ix * ux + h.iy * uy;
    b.spin = clamp(b.spin + across * h.im * P.atSpin * DT, -P.spinMax, P.spinMax);
    if (along < -0.35) {
      if (b.z < 6) b.vz += P.atLift * -along * DT;
      const k = 1 - 0.5 * DT;
      b.vx *= k; b.vy *= k;
    } else if (along > 0.35 && (b.z > 0.02 || b.vz > 0)) b.vz -= P.atDip * along * DT;
  }

  // ---------- touches ----------
  function touches() {
    if (b.owner >= 0 && M[b.owner].gk && M[b.owner].gkState === 'hold') return;
    if (b.z > 1.7) return;
    if (freeT > 0) { freeT -= DT; return; }
    let o = b.owner;
    if (o >= 0 && (players[o].off || hdist(o, b.x, b.y) > P.keepR || M[o].downT > 0)) b.owner = o = -1;
    let best = -1, bd = 1e9, ownerIn = false;
    const r2 = P.reach * P.reach, own2 = P.ownReach * P.ownReach;
    for (let i = 0; i < 22; i++) {
      const p = players[i], m = M[i];
      if (p.off || m.noTouch > 0 || m.downT > 0 || m.slideT > 0) continue;
      if (m.gk && inBox(p.team, p.x, p.y)) continue; // hands, in keepers()
      const dx = b.x - p.x, dy = b.y - p.y, d2 = dx * dx + dy * dy;
      if (i === o) { if (d2 <= own2) ownerIn = true; continue; }
      if (d2 > r2) continue;
      if (o >= 0 && players[o].team === p.team) continue;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (o >= 0 && ownerIn && best >= 0) {
      // both on it: a standing tackle
      const mb = M[best], mo = M[o];
      const edge = clamp(0.55 + (mb.tackling - (mo.pace + mo.passing) / 2) * 0.05, 0.2, 1);
      if (rand(s) < P.steal * edge * (players[o].human ? P.userGuard : 1) * DT) {
        take(best);
        M[o].noTouch = 0.35;
        emit({ type: 'tackle', player: best, won: true });
        return;
      }
      best = -1;
    }
    if (best >= 0 && o >= 0 && players[best].team !== players[o].team) {
      // he knocked it on and a man got to it first: a quick contest, by tackling against the
      // dribbler, and slower while the dribbler is still close enough to shield it
      const mb = M[best], mo = M[o];
      const edge = clamp(0.6 + (mb.tackling - (mo.pace + mo.passing) / 2) * 0.05, 0.25, 1.1);
      const shield = hdist(o, b.x, b.y) < P.reach * 1.8 ? P.steal / P.poach : 1;
      if (rand(s) < P.poach * shield * edge * (players[o].human ? P.userGuard : 1) * DT) {
        take(best);
        M[o].noTouch = 0.3;
        emit({ type: 'tackle', player: best, won: true });
        return;
      }
      best = -1;
    }
    if (best >= 0) { firstTouch(best); return; }
    if (o >= 0 && ownerIn && M[o].touchCd <= 0) dribbleTouch(o);
  }
  function touched(i) {
    if (s.after && i !== afterBy) { s.after = null; afterSide = -1; }
    if (i !== b.last) penKick = false;
    b.last = i;
    if (passTo === i) { passTo = -1; passT = 0; }
    M[i].receive = 0;
  }
  function take(i) {
    const p = players[i];
    touched(i);
    lastDeliberate = false;
    b.owner = i;
    fresh = true;
    b.vx = p.vx * 0.6; b.vy = p.vy * 0.6; b.vz = 0; if (b.z < 0.4) b.z = 0; b.spin = 0;
    const m = M[i];
    m.touchCd = 0.1; m.held = 0; m.plan = null; m.thinkT = 0.25 + rand(s) * 0.3;
  }
  // a loose ball reaches a player: he tames it, or it's too hot and comes off him
  function firstTouch(i) {
    const p = players[i], m = M[i];
    const rx = b.vx - p.vx, ry = b.vy - p.vy, rel = Math.hypot(rx, ry, b.vz);
    const tame = P.trap + m.passing * P.trapPass - (b.z > 0.9 ? 4 : 0);
    if (rel < tame) { take(i); return; }
    // a block, a deflection
    touched(i);
    lastDeliberate = false;
    // half come back off him, half glance on past
    const back = rand(s) < (rel > tame + 6 ? 0.3 : 0.5), k = back ? 0.35 + rand(s) * 0.2 : 0.45 + rand(s) * 0.25, a = (rand(s) - 0.5) * (back ? 2.4 : 1.6);
    const c = Math.cos(a), sn = Math.sin(a);
    const vx = (back ? -b.vx : b.vx) * k, vy = (back ? -b.vy : b.vy) * k;
    b.vx = vx * c - vy * sn + p.vx * 0.5; b.vy = vx * sn + vy * c + p.vy * 0.5;
    b.vz = Math.abs(b.vz) * 0.3 + rand(s) * 2.5;
    b.spin = 0; b.owner = -1;
    m.noTouch = 0.3;
  }
  // the dribble: knock it on along the wish, a little faster than he runs
  function dribbleTouch(o) {
    const p = players[o], m = M[o];
    touched(o);
    lastDeliberate = false;
    if (m.wmag < 0.2) {
      const tx = p.x + Math.cos(p.dir) * 0.35, ty = p.y + Math.sin(p.dir) * 0.35;
      b.vx = p.vx + (tx - b.x) * 3; b.vy = p.vy + (ty - b.y) * 3;
      m.touchCd = 0.08;
    } else {
      // close control with a man on him: shorter knocks
      let near = 1e9;
      for (let j = (1 - p.team) * 11; j < (1 - p.team) * 11 + 11; j++) {
        if (players[j].off) continue;
        const d = Math.abs(players[j].x - p.x) + Math.abs(players[j].y - p.y);
        if (d < near) near = d;
      }
      // the pace he's going at or means to go at, and a lead on top, shorter with a man near
      const want = m.top * P.carry * Math.min(1, m.wmag);
      const along = Math.max(p.vx * m.wx + p.vy * m.wy, want * 0.7);
      // a man winding up a kick keeps it at his feet
      const winding = p.human && (H[p.team].charging || H[p.team].pend);
      const close = winding ? 0.2 : clamp(near / 6, 0.35, 1);
      const sp = Math.min(along, want) + P.lead * close * Math.min(1, m.wmag + 0.3);
      b.vx = m.wx * sp; b.vy = m.wy * sp;
      m.touchCd = P.touchCd;
    }
    b.vz = 0; if (b.z < 0.4) b.z = 0; b.spin = 0;
  }

  // ---------- slides and fouls ----------
  function startSlide(i, ax, ay) {
    const p = players[i], m = M[i];
    const l = Math.hypot(ax, ay) || 1;
    ax /= l; ay /= l;
    const sp = Math.max(P.slideV, Math.hypot(p.vx, p.vy) * 1.1);
    p.vx = ax * sp; p.vy = ay * sp; p.dir = Math.atan2(ay, ax);
    m.slideT = P.slideT; m.slideWon = false; m.slideHit = false;
    setAnim(p, 'slide');
  }
  function slideStep(i) {
    const p = players[i], m = M[i];
    m.slideT -= DT;
    const k = 1 - 2.2 * DT;
    p.vx *= k; p.vy *= k;
    setAnim(p, 'slide');
    const fx = p.x + Math.cos(p.dir) * 0.55, fy = p.y + Math.sin(p.dir) * 0.55;
    const active = m.slideT > P.slideT * 0.15 && s.phase === 'play';
    if (active && !m.slideWon && !m.slideHit) {
      const heldByKeeper = b.owner >= 0 && M[b.owner].gk && M[b.owner].gkState === 'hold';
      if (!heldByKeeper && b.z < 0.7 && Math.hypot(b.x - fx, b.y - fy) < P.slideR * (0.4 + m.tackling * 0.09)) {
        // the ball first: it's won, knocked on along the slide
        const old = b.owner;
        touched(i);
        lastDeliberate = false;
        const a = p.dir + (rand(s) - 0.5) * 0.8, v = 4 + rand(s) * 5;
        b.vx = Math.cos(a) * v; b.vy = Math.sin(a) * v; b.vz = rand(s) * 1.5; b.owner = -1; b.spin = 0;
        m.slideWon = true;
        m.noTouch = 0.15;
        if (old >= 0 && players[old].team !== p.team) M[old].noTouch = 0.4;
        emit({ type: 'tackle', player: i, won: true });
      } else {
        for (let j = (1 - p.team) * 11; j < (1 - p.team) * 11 + 11; j++) {
          const q = players[j], mq = M[j];
          if (q.off || mq.downT > 0 || (mq.gk && mq.gkState === 'hold')) continue;
          if (Math.hypot(q.x - fx, q.y - fy) < 0.6 || Math.hypot(q.x - p.x, q.y - p.y) < 0.55) {
            m.slideHit = true;
            foul(i, j);
            return;
          }
        }
      }
    }
    if (m.slideT <= 0) {
      m.slideT = 0;
      if (!m.slideWon && !m.slideHit) emit({ type: 'tackle', player: i, won: false });
      m.downT = P.downT;
      setAnim(p, 'down');
    }
  }

  function foul(i, v) {
    const p = players[i], q = players[v], t = p.team, d = 1 - t;
    emit({ type: 'foul', player: i, victim: v });
    emit({ type: 'whistle', kind: 'foul' });
    s.stats.fouls[t]++;
    M[v].downT = P.foulDown; M[v].slideT = 0;
    setAnim(q, 'down');
    // how bad: from behind, and the last man stopping a run on goal
    const qa = Math.hypot(q.vx, q.vy) > 0.5 ? Math.atan2(q.vy, q.vx) : q.dir;
    const behind = Math.cos(wrapA(p.dir - qa)) > 0.4;
    const nearBall = Math.hypot(b.x - q.x, b.y - q.y) < 2.5;
    const og = ownY(t), qd = Math.abs(q.y - og);
    let cover = 0;
    for (let j = t * 11 + 1; j < t * 11 + 11; j++) if (j !== i && !players[j].off && Math.abs(players[j].y - og) < qd - 1) cover++;
    const lastMan = cover === 0 && nearBall && qd < 40;
    const red = lastMan ? 0.3 : behind ? 0.03 : 0.005;
    const yellow = (behind ? 0.3 : 0.07) + (nearBall ? 0.05 : 0);
    const r = rand(s);
    if (r < red) card(i, 'red');
    else if (r < red + yellow) card(i, p.card === 1 ? 'red2' : 'yellow');
    if (inBox(t, q.x, q.y)) award('penalty', d, CX, og === 0 ? PITCH.spot : L - PITCH.spot);
    else award('freekick', d, clamp(q.x, 0.5, W - 0.5), clamp(q.y, 0.5, L - 0.5));
  }
  function card(i, c) {
    const p = players[i], t = p.team;
    if (c === 'yellow') {
      p.card = 1; s.stats.yellow[t]++;
      emit({ type: 'card', player: i, colour: 'yellow' });
      return;
    }
    if (c === 'red2') { s.stats.yellow[t]++; emit({ type: 'card', player: i, colour: 'yellow' }); }
    p.card = 2; p.off = true; s.stats.red[t]++;
    emit({ type: 'card', player: i, colour: 'red' });
    if (b.owner === i) b.owner = -1;
    if (s.control[t] === i) s.control[t] = -1;
    M[i].slideT = 0; M[i].downT = 0;
  }

  // ---------- keepers ----------
  function keepers() {
    for (const k of GK) keeper(k);
  }
  function keeper(k) {
    const p = players[k], m = M[k], t = p.team, gy = ownY(t), f = fwd(t);
    if (p.off) return;
    if (m.gkState === 'hold') {
      m.gkT += DT;
      p.vx *= 0.8; p.vy *= 0.8;
      p.x += p.vx * DT; p.y += p.vy * DT;
      setAnim(p, 'catch');
      if (m.gkT >= P.gkHold && s.phase === 'play') {
        const pl = ai.distribute(k);
        m.gkState = 'set';
        p.dir = Math.atan2(pl.ty - p.y, pl.tx - p.x);
        b.x = p.x + Math.cos(p.dir) * 0.4; b.y = p.y + Math.sin(p.dir) * 0.4;
        if (pl.kind === 'throw') b.z = 1.6;
        runPlan(k, pl);
        if (pl.kind === 'throw') setAnim(p, 'throw');
      }
      return;
    }
    if (m.gkState === 'dive') {
      m.gkT += DT;
      p.x += m.dvx * DT; p.y += m.dvy * DT;
      const k2 = 1 - 1.2 * DT;
      m.dvx *= k2; m.dvy *= k2;
      p.vx = m.dvx; p.vy = m.dvy;
      setAnim(p, 'dive');
      hands(k);
      if (m.gkT >= m.diveDur) { m.gkState = 'down'; m.gkT = 0; p.vx = p.vy = 0; }
      return;
    }
    if (m.gkState === 'down') {
      m.gkT += DT;
      setAnim(p, 'down');
      if (m.gkT > 0.45) { m.gkState = 'set'; m.gkT = 0; }
      return;
    }
    // set: on the line between ball and goal, closer to the ball the further it is
    const dx = b.x - CX, dy = b.y - gy, dist = Math.hypot(dx, dy) || 1;
    const ours = b.owner >= 0 && players[b.owner].team === t;
    let d = ours ? clamp(dist * 0.12, 1, 8) : clamp(dist * 0.085, 0.6, 3.2);
    let tx = CX + (dx / dist) * d, ty = gy + (dy / dist) * d, run = 0.75;
    tx = clamp(tx, CX - HG - 0.4, CX + HG + 0.4);
    // a shot coming: get across, or dive
    const vToward = -b.vy * f; // speed toward this goal
    let shotIn = false;
    if (b.owner < 0 && vToward > 7 && dist < 40 && s.t - shotT < 2.5 && shotTeam !== t) {
      const tk = (p.y - b.y) / (b.vy || 1e-9);
      if (tk > 0 && tk < 1.6) {
        // where it crosses his line, the curl reckoned in
        const sp0 = Math.hypot(b.vx, b.vy) || 1;
        const xc = b.x + b.vx * tk + (-b.vy / sp0) * 0.5 * P.magnus * b.spin * sp0 * tk * tk;
        let zc = b.z + b.vz * tk - 0.5 * P.g * tk * tk;
        if (zc < 0) zc = 0.3;
        if (Math.abs(xc - CX) < HG + 1.2 && zc < PITCH.goalH + 0.6) {
          shotIn = true;
          m.seen += DT;
          const need = xc - p.x;
          const reach = P.gkReach + m.keeping * 0.03;
          if (Math.abs(need) > reach && tk < 0.6 && m.seen > P.gkReact - m.keeping * 0.008) {
            const v = Math.min(P.gkDiveV + m.keeping * P.gkDiveSk, Math.abs(need) / Math.max(tk, 0.1) + 0.6);
            m.gkState = 'dive'; m.gkT = 0; m.diveDur = clamp(tk + 0.25, 0.35, 0.8);
            m.dvx = Math.sign(need) * v; m.dvy = f * 0.6;
            p.dir = Math.atan2(0, Math.sign(need));
            setAnim(p, 'dive');
            hands(k);
            return;
          }
          tx = clamp(xc, CX - HG - 0.6, CX + HG + 0.6); ty = p.y; run = 1;
        }
      }
    }
    if (!shotIn) m.seen = 0;
    // come for it: a loose ball in the box he gets to first, or a runner through on goal
    if (!shotIn && !ours && inBox(t, b.x, b.y) && b.z < 2.6) {
      const mine = intercept(k, tmp);
      let theirs = 1e9;
      for (let j = (1 - t) * 11; j < (1 - t) * 11 + 11; j++) if (!players[j].off) theirs = Math.min(theirs, Math.hypot(players[j].x - b.x, players[j].y - b.y) / M[j].top);
      let ourOut = 1e9;
      for (let j = t * 11 + 1; j < t * 11 + 11; j++) if (!players[j].off) ourOut = Math.min(ourOut, Math.hypot(players[j].x - b.x, players[j].y - b.y) / M[j].top);
      const loose = b.owner < 0;
      if ((loose && mine < theirs + 0.1 && mine < ourOut + 0.3) || (!loose && dist < 13 && b.owner >= 0 && players[b.owner].team !== t)) {
        tx = tmp.x; ty = tmp.y; run = 1;
        if (!loose) { tx = b.x - (dx / dist) * 0.8; ty = b.y - (dy / dist) * 0.8; }
      }
    }
    toward(k, tx, ty, run);
    p.x += p.vx * DT; p.y += p.vy * DT;
    // the line: never behind it
    if (gy === 0 ? p.y < 0.3 : p.y > L - 0.3) p.y = gy === 0 ? 0.3 : L - 0.3;
    const sp = Math.hypot(p.vx, p.vy);
    face(p, Math.atan2(b.y - p.y, b.x - p.x), 10);
    setAnim(p, sp > 0.6 ? 'run' : 'stand');
    hands(k);
  }
  // the keeper's hands meet the ball: a catch, a parry, or beaten
  function hands(k) {
    const p = players[k], m = M[k], t = p.team;
    if (m.saveCd > 0 || s.phase === 'goal') return;
    if (b.owner >= 0 && players[b.owner].team === t) return;
    if (!inBox(t, p.x, p.y) && !(s.phase === 'pens')) return;
    const diving = m.gkState === 'dive';
    let hx = p.x, hy = p.y;
    if (diving) { const v = Math.hypot(m.dvx, m.dvy) || 1; hx += (m.dvx / v) * 0.45; hy += (m.dvy / v) * 0.45; }
    const r = (diving ? 0.85 : 0.6) + m.keeping * 0.025;
    const d = Math.hypot(b.x - hx, b.y - hy);
    if (d > r || b.z > (diving ? 2.45 : 2.6)) return;
    const v = Math.hypot(b.vx, b.vy, b.vz);
    if (b.owner >= 0) {
      // at a dribbler's feet: smother it, sometimes
      m.saveCd = 0.35;
      if (rand(s) < 0.25 + m.keeping * 0.05) catchBall(k, false);
      return;
    }
    if (v < 9) { catchBall(k, false); return; }
    // a shot
    m.saveCd = 0.6;
    const onT = s.t - shotT < 3 && shotTeam === 1 - t;
    // at him it's held, at the end of his reach it's a fingertip: the stretch, the pace and his keeping
    const vh = Math.hypot(b.vx, b.vy) || 1, across = Math.abs((hx - b.x) * -b.vy + (hy - b.y) * b.vx) / vh;
    const stretch = Math.min(1, across / r);
    const stop = clamp(P.gkBase + m.keeping * P.gkSkill - stretch * stretch * P.gkStretch - Math.max(0, v - 18) * P.gkPace - (diving ? P.gkDivePen : 0) - (b.z > 2 ? 0.08 : 0), 0.1, 0.98);
    if (rand(s) < stop) {
      if (onT && !shotCounted) { s.stats.onTarget[1 - t]++; shotCounted = true; }
      s.stats.saves[t]++;
      if (v < P.gkCatchV + m.keeping * 1.2 && rand(s) < 0.65) { catchBall(k, true); return; }
      // parry: back out, wide, up; a high one tipped over
      touched(k);
      lastDeliberate = false;
      const f = fwd(t);
      const tip = b.z > 1.5 && rand(s) < 0.6;
      if (tip) { b.vx *= 0.5; b.vy *= 0.45; b.vz = 4 + rand(s) * 2; }
      else {
        const side = b.x < p.x ? -1 : 1, wide = rand(s) < 0.65;
        b.vx = side * (wide ? 7 + rand(s) * 7 : 3 + rand(s) * 5) + b.vx * 0.2;
        b.vy = f * (wide ? rand(s) * 3 - 1.5 : Math.abs(b.vy) * 0.25 + 2 + rand(s) * 3);
        b.vz = 1.5 + rand(s) * 3;
      }
      b.spin = 0;
      emit({ type: 'save', player: k, kind: diving ? 'dive' : 'parry' });
    } else {
      // beaten: a fingertip that only slows it
      b.vx *= 0.88; b.vy *= 0.88;
      touched(k);
      lastDeliberate = false;
      b.last = lastKick[1 - t] >= 0 && s.t - lastKickT[1 - t] < 3 ? lastKick[1 - t] : k;
    }
  }
  function catchBall(k, save) {
    const p = players[k], m = M[k];
    touched(k);
    lastDeliberate = false;
    if (save) emit({ type: 'save', player: k, kind: 'catch' });
    const prev = b.owner;
    if (prev >= 0 && prev !== k) M[prev].noTouch = 0.5;
    b.owner = k; b.vx = b.vy = b.vz = 0; b.spin = 0; b.z = 1;
    m.gkState = 'hold'; m.gkT = 0; m.dvx = m.dvy = 0;
    p.vx *= 0.3; p.vy *= 0.3;
    setAnim(p, 'catch');
    s.after = null; afterSide = -1;
    shotT = -99;
  }
  // a penalty: the keeper guesses a side, often
  function penaltyKeeper(team) {
    const k = GK[1 - team], m = M[k];
    m.saveCd = 0; m.seen = 0;
    if (rand(s) < P.penGuess) { m.guess = rand(s) < 0.5 ? -1 : 1; m.gkState = 'dive'; m.gkT = -0.12 - rand(s) * 0.15; m.diveDur = 0.7; m.dvx = m.guess * (P.gkDiveV + m.keeping * P.gkDiveSk * 0.8); m.dvy = 0; }
  }

  // ---------- the shoot-out ----------
  function startShootout() {
    s.half = 5;
    s.phase = 'pens'; s.phaseT = 0;
    s.pens = [0, 0];
    const first = rand(s) < 0.5 ? 0 : 1;
    s.shootout = { kicks: [[], []], next: first };
    for (let t = 0; t < 2; t++) {
      const list = [];
      for (let i = t * 11 + 1; i < t * 11 + 11; i++) if (!players[i].off) list.push(i);
      list.sort((a, c) => M[c].shooting - M[a].shooting || a - c);
      if (!players[t * 11].off) list.push(t * 11);
      pk.order[t] = list;
    }
    pk.n = [0, 0];
    penSetup();
  }
  function penSetup() {
    const t = s.shootout.next, d = 1 - t;
    s.up = t;
    clearActions();
    const list = pk.order[t], taker = list[pk.n[t] % list.length];
    pk.team = t; pk.stage = 'set'; pk.t = 0; pk.scored = false;
    resetBall(CX, PITCH.spot);
    b.last = -1;
    let k = 0;
    for (let i = 0; i < 22; i++) {
      const p = players[i], m = M[i];
      m.gkState = 'set'; m.slideT = 0; m.downT = 0; m.lock = 0; m.saveCd = 0; m.seen = 0;
      p.vx = p.vy = 0;
      if (p.off) continue;
      if (i === taker) { p.x = CX; p.y = PITCH.spot + 1.8; p.dir = -Math.PI / 2; }
      else if (i === GK[d]) { p.x = CX; p.y = 0.4; p.dir = Math.PI / 2; }
      else {
        // the rest wait in the centre circle, arm in arm
        const a = (k++ / 20) * Math.PI - Math.PI;
        p.x = CX + Math.cos(a) * 7; p.y = L / 2 + Math.sin(a) * 4 + 2; p.dir = -Math.PI / 2;
      }
      setAnim(p, 'stand');
    }
    s.setpiece = { kind: 'penalty', team: t, x: CX, y: PITCH.spot, taker, aim: -Math.PI / 2 };
    s.control[t] = cpuSide[t] ? -1 : taker;
    s.control[d] = -1;
    spReady = true; spReadyT = 0; spPlaced = true;
    emit({ type: 'penalty', team: t });
  }
  function pensStep(inputs) {
    pk.t += DT;
    const t = pk.team, d = 1 - t, sp = s.setpiece;
    if (pk.stage === 'set') {
      const tp = players[sp.taker];
      if (!cpuSide[t]) {
        const h = H[t], inp = inputs[t] || EMPTY_INPUT;
        readStick(h, inp);
        if (h.im > 0.3) sp.aim = clampAim(sp, Math.atan2(h.iy, h.ix));
        tp.dir = sp.aim;
        const fire = pk.t > 0.4 ? kickButton(h, inp) : (h.prev = !!inp.kick, null);
        if (!fire && idle(h, inp) >= P.idleTake) {
          // nobody at the keys: he takes it himself
          penaltyKeeper(t);
          runPlan(sp.taker, aimed(sp, ai.setpiece()));
          pk.stage = 'run'; pk.t = 0;
        } else if (fire) {
          const ax = Math.cos(sp.aim), ay = Math.sin(sp.aim);
          penaltyKeeper(t);
          if (fire === 'hold') humanHold(sp.taker, ax, ay, h.fireCharge);
          else kick(sp.taker, ax, ay, passSpeed(12, 9), 0, 0, 'shot', 0.3);
          pk.stage = 'run'; pk.t = 0;
        }
      } else if (pk.t > P.cpuTake + 0.3) {
        const pl = ai.setpiece();
        penaltyKeeper(t);
        runPlan(sp.taker, pl);
        pk.stage = 'run'; pk.t = 0;
      }
      return;
    }
    const x0 = b.x, y0 = b.y, z0 = b.z;
    if (pk.stage === 'run') {
      for (let t2 = 0; t2 < 2; t2++) if (!cpuSide[t2]) aftertouchFor(t2, inputs[t2] || EMPTY_INPUT);
      ballPhysics();
      keeperPen(GK[d]);
      // the line crossed?
      if (b.y < -R && y0 >= -R) {
        const f = (-R - y0) / (b.y - y0 || 1e-9), xc = x0 + (b.x - x0) * f, zc = z0 + (b.z - z0) * f;
        if (Math.abs(xc - CX) < HG && zc < PITCH.goalH) { pk.scored = true; netSide = 0; netHit = false; }
        penDone();
        return;
      }
      const held = b.owner === GK[d];
      const away = b.vy > 0.5 && s.t - shotT > 0.1 && b.last === GK[d];
      const dead = Math.hypot(b.vx, b.vy) < 0.4 && b.z < 0.05;
      if (held || (away && pk.t > 0.6) || (dead && pk.t > 0.5) || pk.t > 4 || b.x < -R || b.x > W + R) penDone();
      return;
    }
    // done: a pause to see it, then the next
    ballPhysics();
    keeperPen(GK[d]);
    if (pk.t > 1.6) {
      const k = s.shootout.kicks;
      const t0 = k[0].length, t1 = k[1].length, p0 = s.pens[0], p1 = s.pens[1];
      let over = false;
      if (t0 <= 5 && t1 <= 5) {
        if (p0 + (5 - t0) < p1 || p1 + (5 - t1) < p0) over = true;
        else if (t0 === 5 && t1 === 5 && p0 !== p1) over = true;
      } else if (t0 === t1 && p0 !== p1) over = true;
      if (over) {
        s.setpiece = null;
        s.phase = 'fulltime'; s.phaseT = 0;
        s.up = 0;
        emit({ type: 'whistle', kind: 'full' });
        emit({ type: 'fulltime' });
        return;
      }
      s.shootout.next = 1 - t;
      penSetup();
    }
  }
  function penDone() {
    const t = pk.team;
    pk.stage = 'done'; pk.t = 0;
    pk.n[t]++;
    s.shootout.kicks[t].push(pk.scored);
    if (pk.scored) s.pens[t]++;
    emit({ type: 'pen', team: t, scored: pk.scored });
    s.after = null; afterSide = -1;
  }
  function keeperPen(k) {
    const p = players[k], m = M[k];
    if (m.gkState === 'dive') {
      m.gkT += DT;
      if (m.gkT >= 0) { p.x += m.dvx * DT; p.y += m.dvy * DT; setAnim(p, 'dive'); hands(k); }
      if (m.gkT >= m.diveDur) { m.gkState = 'down'; m.gkT = 0; }
      return;
    }
    if (m.gkState === 'hold') { p.vx = p.vy = 0; setAnim(p, 'catch'); return; }
    if (m.gkState === 'down') { setAnim(p, 'down'); return; }
    // no guess: read it like any shot
    const t = p.team, f = fwd(t);
    if (b.owner < 0 && -b.vy * f > 5) {
      const tk = (p.y - b.y) / (b.vy || 1e-9);
      m.seen += DT;
      if (tk > 0 && tk < 1.2) {
        const xc = b.x + b.vx * tk, need = xc - p.x;
        if (Math.abs(need) > P.gkReach && m.seen > P.gkReact - m.keeping * 0.008) {
          const v = Math.min(P.gkDiveV + m.keeping * P.gkDiveSk, Math.abs(need) / Math.max(tk, 0.1) + 0.6);
          m.gkState = 'dive'; m.gkT = 0; m.diveDur = 0.7; m.dvx = Math.sign(need) * v; m.dvy = 0;
          return;
        }
        toward(k, clamp(xc, CX - HG, CX + HG), p.y, 1);
        p.x += p.vx * DT;
      }
    }
    hands(k);
  }
  function aftertouchFor(t, inp) {
    readStick(H[t], inp);
    aftertouch();
  }

  // ---------- the result ----------
  function result() {
    const sc = s.score, pn = s.pens;
    const winner = sc[0] !== sc[1] ? (sc[0] > sc[1] ? 0 : 1) : pn && pn[0] !== pn[1] ? (pn[0] > pn[1] ? 0 : 1) : -1;
    return { score: [sc[0], sc[1]], pens: pn ? [pn[0], pn[1]] : null, winner, scorers: scorers.map(x => ({ ...x })), stats: s.stats };
  }

  return match;
}
