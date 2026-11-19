// The attract demo's player, and the proof player of tools/verify.mjs. It reads the state the way
// a player reads the screen (moves and their windups, the gates' rise and shake, the archer's
// draw) and answers after a reaction time, so its skill is how fast and how right it reads.
//   skill 1: quick, nearly always right — clears every scene; 0.75 (the demo): plausible, slips
//   now and then and sometimes loses.
// It keeps its own memory and its own random numbers, never the sim's, so watching changes nothing.
import { MOVES, isAttack } from './moves.js';
import { EMPTY_INPUT } from './sim.js';

export function createPilot(sim, { skill = 0.75, seed = 7 } = {}) {
  let rng = seed | 0;
  const rand = () => {
    let t = (rng = (rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // a choice reaction (which height?): about a third of a second for a fair player, 0.15 s at skill 1
  const react = () => 0.12 + (1 - skill) * 0.8 + rand() * (0.05 + (1 - skill) * 0.2);
  const right = () => rand() < 0.5 + 0.5 * skill;
  let last = { ...EMPTY_INPUT }, t0 = -1, sceneOf = -1;
  let m; // memory for this attempt at this scene
  const fresh = () => ({ seen: -1, plan: null, at: 0, bowed: new Set(), noBow: new Set(), opened: {}, prevY: {}, gamble: {}, dartSeen: -1, dartPlan: null, dartAt: 0, aggr: 0, mood: 0, guardUp: false });
  m = fresh();

  return () => {
    const s = sim.s;
    if (!s) return { ...EMPTY_INPUT };
    if (s.scene !== sceneOf || s.t < t0) { m = fresh(); sceneOf = s.scene; }
    t0 = s.t;
    const out = { ...EMPTY_INPUT };
    const tap = a => { out[a] = !last[a]; };
    if (s.status === 'play') drive(s, out, tap);
    last = out;
    return out;
  };

  function drive(s, out, tap) {
    const h = s.hero, free = ['idle', 'walk', 'run', 'block', 'blockLow', 'duck', 'cheer'].includes(h.move);
    watchGates(s);
    // the ending: walk up to Master Oriel in run stance and bow
    if (s.teacher) {
      if (h.stance !== 'run') return free && tap('stance');
      if (s.teacher.x - h.x > 1.6) { out.right = true; return; }
      return free && tap('bow');
    }
    const f = s.engaged, d = f ? f.x - h.x : 99;
    if (f && (f.ai === 'arrive' || f.ai === 'bow' || f.ai === 'ready') && d < 6) return meet(s, f, d, out, tap, free);
    if (f && f.ai === 'fight') return fight(s, f, d, out, tap, free);
    travel(s, out, tap, free);
  }

  // a foe walking in: stop, answer its bow (most of the time), then take the guard
  function meet(s, f, d, out, tap, free) {
    const h = s.hero;
    if (!m.bowed.has(f.id) && !m.noBow.has(f.id)) (rand() < 0.35 + 0.6 * skill ? m.bowed : m.noBow).add(f.id);
    if (h.move === 'bow') return;
    if (m.bowed.has(f.id) && h.stance === 'run' && f.ai === 'bow' && !f.honoured && f.moveT > 0.15) return free && tap('bow');
    if (m.bowed.has(f.id) && (f.ai === 'arrive' || (f.ai === 'bow' && !f.honoured)) && h.stance === 'run') return; // wait for its bow
    if (h.stance === 'run' && free) return tap('stance');
  }

  function fight(s, f, d, out, tap, free) {
    const h = s.hero, dist = Math.abs(d), dir = Math.sign(d) || 1;
    const toward = dir > 0 ? 'right' : 'left', away = dir > 0 ? 'left' : 'right';
    if (h.stance === 'run') return free && tap('stance');
    // a foe running in after her: meet it with a kick while it's still in run stance
    if (f.stance === 'run' || f.move === 'stance') {
      if (free && f.stance === 'run' && dist < MOVES.kickMid.reach + 0.45 + 0.6 * skill && rand() < 0.2 + 0.8 * skill) tap('kick');
      return;
    }
    // a spell of caution now and then: stand in the high guard and strike only into openings,
    // the way a player who can't count on reacting in time does
    if (s.t >= m.mood && !isAttack(f.move)) { m.mood = s.t + 0.5 + rand() * 0.6; m.guardUp = rand() < 0.85 - 0.65 * skill; }
    const guardUp = m.guardUp && dist < MOVES.kickMid.reach + 0.4;
    // the foe's swing: read it, then guard it (or beat it to the punch)
    if (isAttack(f.move)) {
      const fm = MOVES[f.move];
      if (f.atk !== m.seen) {
        m.seen = f.atk;
        m.at = s.t + react();
        const left = (fm.on - f.moveT) / f.tempo; // seconds of windup still to come when it's read
        const quick = MOVES.punchMid.on / h.tempo + 0.05;
        if (f.move !== 'palm' && dist <= MOVES.punchMid.reach - 0.05 && left - (m.at - s.t) > quick && rand() < 0.15 + 0.4 * skill) m.plan = 'beat';
        else m.plan = right() ? guardFor(fm.height) : wrongFor(fm.height);
      }
      if (f.moveT < fm.off && dist <= fm.reach + 0.3) {
        if (s.t < m.at) { if (guardUp && free) hold('block', out, away); return; } // not read yet
        if (m.plan === 'beat') { if (free) tap('punch'); return; }
        return hold(m.plan, out, away);
      }
    }
    if (!free) return;
    // Wren's own swing: after reading how the foe stands
    const opening = f.move === 'hit' || f.move === 'stance' || (isAttack(f.move) && f.moveT >= MOVES[f.move].off) || f.cd > 0.25;
    const inPunch = dist <= MOVES.punchMid.reach - 0.05, inKick = dist <= MOVES.kickMid.reach - 0.05;
    m.aggr += 1 / 60;
    if (inKick && (opening || (!guardUp && m.aggr > 0.25 + rand() * (1.2 - skill)))) {
      let hgt = ['high', 'mid', 'low'][Math.floor(rand() * 3)];
      if (f.move === 'block') hgt = 'low';
      else if (f.move === 'blockLow') hgt = rand() < 0.5 ? 'high' : 'mid';
      else if (f.move === 'duck') hgt = rand() < 0.5 ? 'mid' : 'low';
      if (rand() > skill * 0.9 + 0.1) hgt = ['high', 'mid', 'low'][Math.floor(rand() * 3)];
      const kind = !inPunch || (opening && f.move === 'hit' && rand() < 0.3) ? 'kick' : rand() < 0.7 ? 'punch' : 'kick';
      m.aggr = 0;
      if (hgt === 'high') out.up = true;
      if (hgt === 'low') out.down = true;
      return tap(kind);
    }
    if (guardUp) return hold('block', out, away);
    if (dist > MOVES.punchMid.reach - 0.15) out[toward] = true;
  }
  function guardFor(h) { return h === 'low' ? 'blockLow' : h === 'high' ? 'duck' : 'block'; }
  function wrongFor(h) { return h === 'low' ? 'block' : h === 'mid' ? (rand() < 0.5 ? 'duck' : 'blockLow') : 'blockLow'; }
  function hold(plan, out, away) {
    if (plan === 'block') out[away] = true;
    else if (plan === 'blockLow') { out[away] = true; out.down = true; }
    else if (plan === 'duck') out.down = true;
  }

  // between fights: run on, wait out the gates, duck or block the darts
  function travel(s, out, tap, free) {
    const h = s.hero;
    const threat = dartThreat(s);
    if (threat) {
      if (threat.h === 'mid') {
        if (h.stance === 'run') { if (free) tap('stance'); return; }
        if (threat.close) out.left = true; // hold the block as it comes in
        return;
      }
      if (threat.close) { out.down = true; return; }
    }
    if (h.stance !== 'run') { if (free && !threat) tap('stance'); return; }
    // a gate: wait clear of its blade (behind the line a shut gate stops Wren at), go as it opens;
    // once past that line, never stop under it
    const g = s.gates.find(g => g.x + 0.5 > h.x);
    if (g && g.x - h.x < 1.6 && h.x <= g.x - 0.5 + 1e-6 && !gateGo(s, g)) {
      if (h.x < g.x - 0.6) out.right = true; // close up to the gate, then wait
      return;
    }
    out.right = true;
  }
  function watchGates(s) {
    for (const g of s.gates) {
      const was = m.prevY[g.x] ?? 1;
      if (g.y === 0 && was > 0) m.opened[g.x] = s.t;
      if (g.y > 0) m.opened[g.x] = null;
      m.prevY[g.x] = g.y;
    }
  }
  function gateGo(s, g) {
    if (g.y > 0 || g.shake > 0) {
      // a weaker player sometimes chances it on the shake, once it has registered — and is
      // usually too late
      if (g.shake > 0 && g.y === 0) {
        const k = g.x + ':' + Math.floor(s.t / 3);
        if (m.gamble[k] === undefined) m.gamble[k] = rand() < (1 - skill) * 0.6 ? s.t + react() : -1;
        return m.gamble[k] > 0 && s.t >= m.gamble[k];
      }
      return false;
    }
    const since = m.opened[g.x];
    if (since == null) return skill < 0.95 && rand() < 0.02; // open, but for how long? wait for the next one
    return s.t - since < 0.5 + 0.9 * skill;
  }
  // the dart that matters next: one in flight, or the archer's draw, once read
  function dartThreat(s) {
    const a = s.archer, h = s.hero;
    if (!a || h.x >= a.x - 1.5) return null;
    const d = s.darts.filter(d => d.x > h.x).sort((p, q) => p.x - q.x)[0];
    const key = d ? d : a.st === 'draw' ? a : null;
    if (!key) { m.dartPlan = null; return null; }
    const id = d ? d.id : s.dartN + 1; // the dart being drawn is the next one loosed
    if (m.dartSeen !== id) { m.dartSeen = id; m.dartAt = s.t + react(); m.dartPlan = rand() < 0.8 + 0.2 * skill ? key.h : key.h === 'high' ? 'mid' : 'high'; } // a plain cue: rarely misread
    if (s.t < m.dartAt) return null;
    const eta = d ? (d.x - h.x) / (-d.vx + 2.6) : 9;
    return { h: m.dartPlan, close: eta < 0.45 };
  }
}
