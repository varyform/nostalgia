// Attract-mode autopilot: plays a run through a virtual gamepad, pressing the pad bindings
// listed in game.json, so the game reads it exactly like a player. It flies the plane to the
// flak line, drops pods and jumps, steers the canopy, then crosses the map on a grid path
// that keeps clear of minefields and gives patrols a wide berth: crouching near them,
// shooting the ones that spot it (or wander too close), lobbing the odd grenade. At the
// objective it plants charges (or takes the codebook) and runs for the helicopter.
import meta from '../game.json';
import { W, H, TAU, clamp, dist, angDiff, hitsObstacle, isWater, losFactor } from './game.js';

// W3C standard mapping, by the button names game.json binds
const STANDARD = { South: 0, East: 1, West: 2, North: 3, L1: 4, R1: 5, L2: 6, R2: 7, Select: 8, Start: 9, L3: 10, R3: 11, Up: 12, Down: 13, Left: 14, Right: 15 };
const button = action => STANDARD[meta.input.actions[action].pad[0]];
// createInput rescales stick axes past its 0.2 deadzone; pre-skew them so angles come out exact
const DZ = 0.2;
const undz = v => (Math.abs(v) < 1e-4 ? 0 : Math.sign(v) * (Math.abs(v) * (1 - DZ) + DZ));
const RUN_CAP = 110; // seconds: a run that hasn't wrapped up by then restarts
const STEP = 40; // path grid cell, world px
const COLS = Math.ceil(W / STEP),
  ROWS = Math.ceil(H / STEP);

export function createPilot({ G, restart }) {
  const pad = {
    id: 'Dropzone autopilot (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  const press = action => {
    const b = pad.buttons[button(action)];
    b.pressed = b.touched = true;
    b.value = 1;
  };
  const leftStick = (x, y) => {
    pad.axes[0] = undz(x);
    pad.axes[1] = undz(y);
  };
  const rightStick = a => {
    pad.axes[2] = undz(Math.cos(a));
    pad.axes[3] = undz(Math.sin(a));
  };

  let s = null;
  const pilot = { pad, fade: 0, reset, step };

  function reset() {
    const w = G.world;
    s = {
      t: 0,
      pods: 0,
      tx: clamp(w.objCamp.x + (w.objCamp.x < W / 2 ? 1 : -1) * 120, 220, W - 220), // where to come down
      landed: false,
      cells: new Uint8Array(COLS * ROWS), // 0 unknown, 1 walkable, 2 blocked
      path: null,
      pi: 0,
      key: '',
      planT: 0,
      aim: -Math.PI / 2,
      foe: null,
      foeT: 0,
      holdT: 0,
      burst: 0,
      gCd: 4,
      medCd: 0,
      reCd: 0,
      stCd: 0,
      evade: null,
      chargeAt: -9,
      stuckT: 0,
      lastX: 0,
      lastY: 0,
      detour: 0,
      detourA: 0,
      ambush: Math.random() < 0.75, // most runs also pick off a guard that strays too close
      ending: false,
    };
    pilot.fade = 1; // fade in while the first terrain chunks get painted
  }

  function step(dt) {
    for (const b of pad.buttons) {
      b.pressed = b.touched = false;
      b.value = 0;
    }
    pad.axes.fill(0);
    pad.timestamp++;
    if (!s || !G.world) return;
    s.t += dt;
    s.gCd -= dt;
    s.medCd -= dt;
    s.reCd -= dt;
    s.stCd -= dt;
    if (!s.ending && (G.state === 'end' || s.t > RUN_CAP)) s.ending = true;
    if (s.ending) {
      pilot.fade = Math.min(1, pilot.fade + dt * 1.6);
      if (pilot.fade >= 1) restart();
      return;
    }
    pilot.fade = Math.max(0, pilot.fade - dt * 1.6);
    rightStick(s.aim); // a deflected stick also keeps the input on "gamepad" (aim from the stick, not a mouse)
    if (G.state === 'flight') flight();
    else if (G.state === 'para') para();
    else if (G.state === 'ground') ground(dt);
  }

  // ---------- flight & canopy ----------
  function flight() {
    const pl = G.plane;
    if (!pl) return;
    leftStick(clamp((s.tx - pl.x) / 220, -1, 1), 0);
    if (s.pods === 0 && s.t > 0.8) {
      press('pod');
      s.pods = 1;
    } else if (s.pods === 1 && pl.y < G.aaY + 470) {
      press('pod');
      s.pods = 2;
    } else if (s.pods === 2 && pl.y < G.aaY + 300) press('jump');
  }
  function para() {
    const p = G.player,
      w = G.world;
    leftStick(clamp((s.tx - p.x) / 200 - w.wind / 85, -1, 1), -0.45);
  }

  // ---------- ground ----------
  const inMines = (w, x, y) => w.mineFields.some(m => dist(x, y, m.x, m.y) < m.r + 34);
  function walkable(i, j) {
    if (i < 0 || j < 0 || i >= COLS || j >= ROWS) return false;
    const k = j * COLS + i;
    if (!s.cells[k]) {
      const w = G.world,
        x = (i + 0.5) * STEP,
        y = (j + 0.5) * STEP;
      s.cells[k] = hitsObstacle(w, x, y, 13) || inMines(w, x, y) ? 2 : 1;
    }
    return s.cells[k] === 1;
  }
  function nearestCell(x, y) {
    const ci = Math.floor(x / STEP),
      cj = Math.floor(y / STEP);
    for (let r = 0; r < 6; r++)
      for (let j = cj - r; j <= cj + r; j++)
        for (let i = ci - r; i <= ci + r; i++)
          if ((Math.abs(i - ci) === r || Math.abs(j - cj) === r) && walkable(i, j)) return j * COLS + i;
    return -1;
  }
  // A* on the coarse grid; water is slow and patrols are worth a detour
  function findPath(sx, sy, gx, gy) {
    const w = G.world,
      start = nearestCell(sx, sy),
      goal = nearestCell(gx, gy);
    if (start < 0 || goal < 0) return null;
    const foes = w.enemies.filter(e => e.state !== 'dead' && dist(e.x, e.y, sx, sy) < 1600);
    const gi = goal % COLS,
      gj = (goal / COLS) | 0;
    const N = COLS * ROWS,
      g = new Float32Array(N).fill(Infinity),
      from = new Int32Array(N).fill(-1),
      shut = new Uint8Array(N);
    const heap = [],
      push = (k, f) => {
        heap.push([f, k]);
        let i = heap.length - 1;
        while (i > 0) {
          const pa = (i - 1) >> 1;
          if (heap[pa][0] <= heap[i][0]) break;
          [heap[pa], heap[i]] = [heap[i], heap[pa]];
          i = pa;
        }
      },
      pop = () => {
        const top = heap[0],
          last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = i * 2 + 1,
              r = l + 1;
            let m = i;
            if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
            if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
            if (m === i) break;
            [heap[m], heap[i]] = [heap[i], heap[m]];
            i = m;
          }
        }
        return top[1];
      };
    const h = (i, j) => {
      const dx = Math.abs(i - gi),
        dy = Math.abs(j - gj);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    const cost = (i, j) => {
      const x = (i + 0.5) * STEP,
        y = (j + 0.5) * STEP;
      let c = isWater(w, x, y) ? 3 : 1;
      for (const e of foes) if (Math.abs(e.x - x) < 170 && Math.abs(e.y - y) < 170 && dist(e.x, e.y, x, y) < 170) c += 4;
      return c;
    };
    g[start] = 0;
    push(start, 0);
    let expanded = 0;
    while (heap.length && expanded++ < 9000) {
      const k = pop();
      if (shut[k]) continue;
      shut[k] = 1;
      if (k === goal) break;
      const i = k % COLS,
        j = (k / COLS) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di,
            nj = j + dj;
          if (!walkable(ni, nj)) continue;
          if (di && dj && (!walkable(i + di, j) || !walkable(i, j + dj))) continue; // no corner cutting
          const nk = nj * COLS + ni,
            ng = g[k] + (di && dj ? 1.414 : 1) * cost(ni, nj);
          if (ng < g[nk]) {
            g[nk] = ng;
            from[nk] = k;
            push(nk, ng + h(ni, nj));
          }
        }
    }
    if (from[goal] < 0 && goal !== start) return null;
    const pts = [];
    for (let k = goal; k >= 0; k = from[k]) pts.push({ x: (k % COLS + 0.5) * STEP, y: (((k / COLS) | 0) + 0.5) * STEP });
    pts.reverse();
    pts.push({ x: gx, y: gy });
    // pull the string: skip cells while the straight line stays clear
    const clear = (a, b) => {
      const n = Math.ceil(dist(a.x, a.y, b.x, b.y) / 10);
      for (let q = 1; q < n; q++) {
        const x = a.x + ((b.x - a.x) * q) / n,
          y = a.y + ((b.y - a.y) * q) / n;
        if (hitsObstacle(w, x, y, 11) || inMines(w, x, y)) return false;
      }
      return true;
    };
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; ) {
      let j = Math.min(pts.length - 1, i + 14);
      while (j > i + 1 && !clear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  // where to head next: a pod nearby, the objective, away from a planted charge, the LZ
  function goal() {
    const w = G.world,
      p = G.player;
    if (s.evade) return { key: 'evade', x: s.evade.x, y: s.evade.y };
    if (G.objDone) return { key: 'lz', x: w.lz.x, y: w.lz.y };
    if (s.t - s.landed < 25) {
      const i = w.pods.findIndex(q => q.landed && !q.collected && dist(q.x, q.y, p.x, p.y) < 560);
      if (i >= 0) return { key: 'pod' + i, x: w.pods[i].x, y: w.pods[i].y };
    }
    let t = null,
      td = 1e9;
    for (const q of w.targets) {
      const d = dist(q.x, q.y, p.x, p.y);
      if (!q.done && d < td) {
        t = q;
        td = d;
      }
    }
    if (!t) return { key: 'lz', x: w.lz.x, y: w.lz.y };
    if (t.type === 'intel') return { key: 'intel', x: t.x, y: t.y, t };
    const k = w.targets.indexOf(t);
    if (s.key === 'T' + k && s.approach) return s.approach;
    const r = t.ob.r + 36,
      a = Math.atan2(p.y - t.y, p.x - t.x);
    // the side facing us, or the nearest free spot around the target
    for (let q = 0; q < 12; q++) {
      const b = a + (q % 2 ? 1 : -1) * Math.ceil(q / 2) * 0.5,
        x = t.x + Math.cos(b) * r,
        y = t.y + Math.sin(b) * r;
      if (!hitsObstacle(w, x, y, 11)) return (s.approach = { key: 'T' + k, x, y, t });
    }
    return (s.approach = { key: 'T' + k, x: t.x + Math.cos(a) * r, y: t.y + Math.sin(a) * r, t });
  }

  // sandbags, trunks and crates stop bullets without blocking sight: don't trade fire through them
  function clearShot(w, p, e) {
    const d = dist(p.x, p.y, e.x, e.y),
      n = Math.floor((d - 26) / 8);
    for (let q = 0; q <= n; q++) {
      const k = (14 + q * 8) / d;
      if (hitsObstacle(w, p.x + (e.x - p.x) * k, p.y + (e.y - p.y) * k, 1.5)) return false;
    }
    return true;
  }

  // the enemy worth shooting right now, if any
  function pickFoe() {
    const w = G.world,
      p = G.player;
    let best = null,
      bs = 1e9;
    for (const e of w.enemies) {
      if (e.state === 'dead') continue;
      const d = dist(e.x, e.y, p.x, p.y);
      if (d > 440) continue;
      const range = e.state === 'alert' ? 420 : e.state === 'search' || e.aware > 0.45 ? 300 : s.ambush ? 220 : 0;
      if (d > range || losFactor(w, p.x, p.y, e.x, e.y) < 0.35 || !clearShot(w, p, e)) continue;
      const sc = d - (e.state === 'alert' ? 160 : 0);
      if (sc < bs) {
        bs = sc;
        best = e;
      }
    }
    return best;
  }

  function ground(dt) {
    const w = G.world,
      p = G.player;
    if (!p || p.hp <= 0) return;
    if (!s.landed) {
      s.landed = s.t;
      s.lastX = p.x;
      s.lastY = p.y;
      // attract mode carries enough charges for the whole objective
      p.charges = Math.max(p.charges, w.targets.filter(t => t.type !== 'intel').length);
    }
    if (p.mags < 1) p.mags = 2;

    // --- combat
    s.foeT -= dt;
    if (s.foeT <= 0 || (s.foe && s.foe.state === 'dead')) {
      s.foe = pickFoe();
      s.foeT = 0.25;
    }
    const foe = s.foe;
    let threat = false;
    const near = p.stance === 'crouch' ? 400 : 330; // some hysteresis, or the stance flaps at the edge
    for (const e of w.enemies)
      if (e.state !== 'dead' && Math.abs(e.x - p.x) < near && Math.abs(e.y - p.y) < near && dist(e.x, e.y, p.x, p.y) < near) {
        threat = true;
        break;
      }
    let hold = false;
    if (foe) {
      const a = Math.atan2(foe.y - p.y, foe.x - p.x),
        d = dist(foe.x, foe.y, p.x, p.y);
      s.aim += clamp(angDiff(s.aim, a), -dt * 7, dt * 7);
      const on = Math.abs(angDiff(s.aim, a)) < 0.1;
      s.burst = (s.burst + dt) % 0.72;
      if (on && s.burst < 0.34 && !p.interacting) press('fire');
      if (on && foe.state === 'alert' && d > 170 && d < 290 && p.grenades > 0 && s.gCd <= 0) {
        press('grenade');
        s.gCd = 7 + Math.random() * 5;
      }
      // stand and fight a little, then press on (shooting on the move) so a stand-off can't stall the run
      s.holdT += dt;
      if (s.holdT > 6) s.holdT = 0;
      hold = foe.state === 'alert' && d < 330 && !s.evade && s.holdT < 3;
    } else s.holdT = 0;
    // a bunker that has seen us gets a grenade from the edge of its arc
    if (!foe && s.gCd <= 0 && p.grenades > 0)
      for (const b of w.bunkers) {
        const d = dist(b.x, b.y, p.x, p.y);
        if (b.dead || b.aware < 1 || d < 170 || d > 300) continue;
        const a = Math.atan2(b.y - p.y, b.x - p.x);
        s.aim += clamp(angDiff(s.aim, a), -dt * 7, dt * 7);
        if (Math.abs(angDiff(s.aim, a)) < 0.1) {
          press('grenade');
          s.gCd = 6 + Math.random() * 4;
        }
        hold = true;
        break;
      }
    if (p.hp < 55 && p.medkits > 0 && s.medCd <= 0) {
      press('medkit');
      s.medCd = 3;
    }
    if (!foe && p.ammo < 12 && p.mags > 0 && p.reloadT <= 0 && s.reCd <= 0) {
      press('reload');
      s.reCd = 2;
    }

    // --- objective
    const gl = goal();
    if (s.evade && G.charges.length === 0 && s.t - s.chargeAt > 5.4) s.evade = null;
    let mx = 0,
      my = 0;
    if (gl.key !== 'evade' && gl.t && gl.t.type === 'intel' && dist(gl.t.x, gl.t.y, p.x, p.y) < 40) {
      if (!foe) press('interact'); // hold to take the codebook
      hold = true;
    } else if (gl.t && gl.t.ob && !s.evade && dist(gl.t.x, gl.t.y, p.x, p.y) < gl.t.ob.r + 58 && p.charges > 0 && !G.charges.length) {
      press('charge');
      s.chargeAt = s.t;
      // run back the way we came, well clear of the blast
      const a = Math.atan2(p.y - gl.t.y, p.x - gl.t.x);
      for (let q = 0; q < 10; q++) {
        const b = a + (q % 2 ? 1 : -1) * Math.ceil(q / 2) * 0.45,
          x = clamp(p.x + Math.cos(b) * 330, 40, W - 40),
          y = clamp(p.y + Math.sin(b) * 330, 40, H - 40);
        if (nearestCell(x, y) >= 0) {
          s.evade = { x, y };
          break;
        }
      }
    }

    // --- movement
    s.planT -= dt;
    if (gl.key !== s.key || s.planT <= 0 || !s.path) {
      s.key = gl.key;
      s.path = findPath(p.x, p.y, gl.x, gl.y);
      s.pi = 1;
      s.planT = 2.5;
    }
    let tx = gl.x,
      ty = gl.y;
    if (s.path) {
      while (s.pi < s.path.length - 1 && dist(s.path[s.pi].x, s.path[s.pi].y, p.x, p.y) < 22) s.pi++;
      const q = s.path[Math.min(s.pi, s.path.length - 1)];
      tx = q.x;
      ty = q.y;
    }
    const dg = dist(gl.x, gl.y, p.x, p.y),
      arrived = dg < (gl.key === 'lz' ? 14 : 10);
    if (!hold && !arrived) {
      let a = Math.atan2(ty - p.y, tx - p.x);
      if (s.detour > 0) {
        s.detour -= dt;
        a = s.detourA;
      }
      mx = Math.cos(a);
      my = Math.sin(a);
      if (!foe) s.aim += clamp(angDiff(s.aim, a), -dt * 4, dt * 4); // look where we go
      // stuck on something the grid missed: sidestep and replan
      s.stuckT += dt;
      if (s.stuckT > 1) {
        if (dist(p.x, p.y, s.lastX, s.lastY) < 20) {
          s.detour = 0.6;
          s.detourA = a + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
          s.planT = 0;
        }
        s.stuckT = 0;
        s.lastX = p.x;
        s.lastY = p.y;
      }
    } else {
      s.stuckT = 0;
      s.lastX = p.x;
      s.lastY = p.y;
    }
    leftStick(mx, my);

    // --- stance: low near patrols, upright (and sprinting) to clear a charge or reach the helicopter
    const rush = !!s.evade || (G.objDone && !foe);
    const want = rush ? 'stand' : threat || foe ? 'crouch' : 'stand';
    if (p.stance !== want && s.stCd <= 0) {
      press(p.stance === 'prone' ? 'prone' : 'crouch');
      s.stCd = 0.6;
    }
    if (rush && p.stance === 'stand' && (mx || my)) press('sprint');
    s.aim = ((s.aim % TAU) + TAU) % TAU;
  }

  return pilot;
}
