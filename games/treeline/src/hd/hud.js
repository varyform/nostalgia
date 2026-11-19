// The flight's 2D layer. In the cockpit: the head-up display on the windscreen (heading tape,
// airspeed and radar-altitude tapes with the assist's holds, vertical speed, a horizon bar, the
// hover cue — the velocity over the ground as a vector from the centre — the gun's aim, rocket
// impact, target box and lock) over the instrument panel (the tactical map, the threat warning
// scope, torque, rotor rpm and collective, fuel and hull, warning lights, the stores and the
// target camera's readout). In the chase view a compact readout; in the gunner's sight the
// thermal camera's reticle. Every view: target markers, warnings, messages, the objective, the
// end-of-mission banner and the touch controls.
import { pads } from '../touch.js';
import { GUN_RANGE, G, KINDS, RKT_V, STORES, STORE_NAME, add, cross, dist, headingOf, mul, norm, sub } from '../sim.js';
import { mapImage } from './terrain.js';
import { COL, H, W, alpha, fmt } from './ui.js';

const KT = 1.944, FT = 3.281, FPM = 196.85;
const TAU = Math.PI * 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// the theatres' maps, one canvas each (the tactical display and the briefing)
const maps = new Map();
export function mapCanvas(world, n = 256) {
  const key = `${world.index}:${n}`;
  if (maps.has(key)) return maps.get(key);
  const c = document.createElement('canvas');
  c.width = n; c.height = n;
  c.getContext('2d').putImageData(new ImageData(mapImage(world, n), n, n), 0, 0);
  maps.set(key, c);
  return c;
}

/** a body-frame direction (yaw + right, pitch + up) in the world */
function bodyDir(P, yaw, pitch) {
  const r = P.r ?? cross(P.f, P.u), cp = Math.cos(pitch);
  return norm(add(add(mul(P.f, cp * Math.cos(yaw)), mul(r, cp * Math.sin(yaw))), mul(P.u, Math.sin(pitch))));
}
/** where rockets fired now would hit the ground */
function rocketImpact(sim) {
  const P = sim.player, W0 = sim.world;
  let p = [...P.pos], v = add(P.vel, mul(P.f, RKT_V));
  for (let t = 0; t < 6; t += 0.04) {
    v = [v[0], v[1] - G * 0.04, v[2]];
    p = add(p, mul(v, 0.04));
    if (p[1] < W0.heightAt(p[0], p[2])) return { p, t };
  }
  return null;
}
const symbol = k => ({ radar: 'R', sam: 'S', mantis: 'H', stiletto: 'J', aa: 'A', aatrack: 'A', tank: 'T', apc: 'C', bunker: 'B' })[k] ?? '?';

export function drawHud(ui, app, V) {
  const g = ui.g, sim = app.sim, P = sim.player;
  if (!P) return;
  const view = P.alive ? app.view : 'chase', t = app.t, blink = Math.floor(t * 3) % 2 === 0;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const flying = sim.status === 'fly' && P.alive;
  const T = P.target;

  if (view === 'sight' && T && flying) sight(ui, app, V, P, T, sim, blink);
  else {
    // ---------- unit markers (cockpit and chase) ----------
    if (flying) {
      for (const a of sim.actors) {
        if (!a.alive || a === P || a === T) continue;
        const d = dist(a.pos, P.pos);
        if (d > (a.air ? 6000 : 4000)) continue;
        if (!a.obj && a.team !== 'blue' && !a.sees && d > 1500) continue;
        const s = V.project(add(a.pos, [0, 1.5, 0]));
        if (!s || s.x < 0 || s.x > W || s.y < 0 || s.y > H) continue;
        const col = a.team === 'blue' ? COL.cyan : a.obj ? COL.amber : COL.hudDim, r = 12;
        ui.line([s.x - r, s.y - r + 5, s.x - r, s.y - r, s.x - r + 5, s.y - r], col, 2);
        ui.line([s.x + r - 5, s.y + r, s.x + r, s.y + r, s.x + r, s.y + r - 5], col, 2);
        if (a.team === 'blue' && d < 1500) ui.text(KINDS[a.kind].label, s.x, s.y + r + 17, 15, col, { align: 'center' });
      }
      if (T) targetBox(ui, V, T, P, sim, blink);
      lzMarker(ui, V, sim);
    }
    if (view === 'cockpit') { hudCockpit(ui, app, V, P, sim, blink); panel(ui, app, P, sim, blink); }
    else compact(ui, app, P, sim, blink);
  }

  // ---------- warnings ----------
  if (flying) {
    const warns = [];
    if (sim.threat) {
      warns.push(['MISSILE', COL.red, true]);
      const m = sim.threat, rel = wrap(headingOf(norm(sub(m.pos, P.pos))) - P.hdg);
      const cx = W / 2, cy = view === 'cockpit' ? 440 : 520, R = 250;
      const x = cx + Math.sin(rel) * R, y = cy - Math.cos(rel) * R * 0.8;
      if (blink) {
        g.save(); g.translate(x, y); g.rotate(rel);
        g.beginPath(); g.moveTo(0, -22); g.lineTo(16, 10); g.lineTo(-16, 10); g.closePath();
        g.fillStyle = COL.red; g.fill(); g.restore();
        ui.text((dist(m.pos, P.pos) / 1000).toFixed(1), x, y + 34, 18, COL.red, { align: 'center', wgt: 700 });
      }
    } else if (sim.spikes?.length) warns.push(['RADAR', COL.amber, false]);
    if ((P.rpm ?? 1) < 0.9) warns.push(['ROTOR RPM', COL.red, true]);
    else if ((P.torque ?? 0) > 1.05) warns.push(['OVERTORQUE', COL.amber, true]);
    if ((P.settling ?? 0) > 0.35) warns.push(['SETTLING', COL.red, true]);
    if (!P.ground && P.vs < -6 && P.agl < 40) warns.push(['SINK RATE', COL.red, true]);
    if (P.fuel <= 0) warns.push(['NO FUEL', COL.red, true]);
    else if (P.lowFuel) warns.push(['FUEL LOW', COL.amber, false]);
    if (sim.outside) warns.push(['AREA LIMIT', COL.amber, false]);
    let y = view === 'cockpit' ? 640 : 760;
    if (view === 'sight') y = 820;
    for (const [s, c, fl] of warns.slice(0, 3)) {
      if (!fl || blink) {
        const w = ui.width(s, 28, 700, 4) + 40;
        ui.panel(W / 2 - w / 2, y - 32, w, 44, { fill: 'rgba(30,6,4,0.55)', edge: c, r: 4 });
        ui.text(s, W / 2, y, 28, c, { align: 'center', wgt: 700, sp: 4 });
      }
      y += 52;
    }
  }

  // ---------- messages and the objective ----------
  let my = view === 'cockpit' ? 170 : 150;
  for (const m of V.msgs) {
    const a = Math.min(1, (6 - m.t) * 1.5, m.t * 6);
    g.globalAlpha = Math.max(0, a);
    ui.text(String(m.text).toUpperCase(), W / 2, my, 23, COL.ink, { align: 'center', wgt: 600, sp: 2 });
    g.globalAlpha = 1;
    my += 30;
  }
  objective(ui, app, sim, V);
  rescue(ui, sim);

  // ---------- the end of the mission ----------
  const big = (s, c, sub2) => {
    ui.panel(W / 2 - 440, 340, 880, sub2 ? 170 : 120, { fill: 'rgba(6,9,6,0.72)', edge: c });
    ui.text(s, W / 2, 420, 58, c, { align: 'center', wgt: 700, sp: 10 });
    if (sub2) ui.text(sub2, W / 2, 475, 26, COL.ink, { align: 'center', wgt: 500, sp: 1 });
  };
  if (sim.status === 'down') big(/shot/i.test(sim.reason ?? '') ? 'SHOT DOWN' : 'CRASHED', COL.red, sim.reason || 'The Gadfly is lost');
  else if (sim.status === 'failed') big('MISSION FAILED', COL.amber, sim.reason);
  else if (sim.status === 'landed') big('MISSION COMPLETE', COL.hud, 'Down safe at the FARP');
  else if (sim.complete && sim.completeT < 5) big('OBJECTIVE COMPLETE', COL.hud, 'Fly home and set down on the pad, or end it from the pause menu');

  if (app.touch?.active && app.state === 'play' && !app.demo) touchPads(ui, app, P);
}

// ---------- the target ----------
function targetBox(ui, V, T, P, sim, blink) {
  const g = ui.g, s = V.project(add(T.pos, [0, 1.5, 0])), d = dist(T.pos, P.pos);
  const locked = sim.lockState === 'lock', hidden = !P.tgtSeen;
  const col = locked ? COL.red : hidden ? COL.hudDim : T.obj ? COL.amber : COL.hud;
  const label = `${KINDS[T.kind].label}  ${(d / 1000).toFixed(1)}`;
  if (s && s.x > 30 && s.x < W - 30 && s.y > 30 && s.y < H - 30) {
    const r = 22;
    g.strokeStyle = col; g.lineWidth = 2.5;
    if (hidden) g.setLineDash([6, 6]);
    g.strokeRect(s.x - r, s.y - r, r * 2, r * 2);
    g.setLineDash([]);
    if (locked) {
      g.beginPath(); g.moveTo(s.x, s.y - r * 1.4); g.lineTo(s.x + r * 1.4, s.y); g.lineTo(s.x, s.y + r * 1.4); g.lineTo(s.x - r * 1.4, s.y); g.closePath(); g.stroke();
    } else if (sim.lockState === 'seek') {
      g.beginPath(); g.arc(s.x, s.y, r * 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(P.lock ?? 0, 0, 1)); g.stroke();
    }
    ui.text(label, s.x + r + 8, s.y - r + 14, 17, col, { wgt: 600 });
    ui.text(hidden ? 'MASKED' : T.obj ? 'OBJECTIVE' : locked ? 'LOCK' : '', s.x + r + 8, s.y - r + 33, 14, col, { wgt: 600, sp: 2 });
    void blink;
  } else {
    // off screen: an arrow round the middle pointing at it
    const cam = V.cam, rel = sub(T.pos, cam.eye), r = cross(cam.f, cam.u);
    const x = rel[0] * r[0] + rel[1] * r[1] + rel[2] * r[2], y = rel[0] * cam.u[0] + rel[1] * cam.u[1] + rel[2] * cam.u[2];
    const behind = rel[0] * cam.f[0] + rel[1] * cam.f[1] + rel[2] * cam.f[2] < 0;
    const a = Math.atan2(x, behind && Math.abs(x) < 1 ? -1 : y), R = 320;
    const cx = W / 2 + Math.sin(a) * R, cy = H / 2 - Math.cos(a) * R * 0.85;
    g.save(); g.translate(cx, cy); g.rotate(a);
    g.beginPath(); g.moveTo(0, -20); g.lineTo(14, 8); g.lineTo(0, 2); g.lineTo(-14, 8); g.closePath();
    g.fillStyle = col; g.fill(); g.restore();
    ui.text(label, cx, cy + 34, 16, col, { align: 'center' });
  }
}
function lzMarker(ui, V, sim) {
  const L = sim.complete ? sim.world.site('home') : sim.lz && !sim.lz.done ? sim.lz.site : null;
  if (!L) return;
  const s = V.project([L.x, L.y + 3, L.z]);
  if (!s || s.x < 0 || s.x > W || s.y < 0 || s.y > H) return;
  ui.line([s.x - 16, s.y, s.x, s.y - 11, s.x + 16, s.y, s.x, s.y + 11, s.x - 16, s.y], COL.cyan, 2);
  ui.text(sim.complete ? 'HOME' : 'LZ', s.x, s.y + 30, 15, COL.cyan, { align: 'center', wgt: 700, sp: 2 });
}

// ---------- the cockpit's head-up display ----------
function hudCockpit(ui, app, V, P, sim, blink) {
  const g = ui.g, cx = W / 2, hc = COL.hud;
  const bore = V.project(add(V.cam.eye, mul(P.f, 1000)));
  // the horizon bar and pitch marks every 10°, rolled with the airframe
  g.save(); g.beginPath(); g.rect(560, 150, 800, 620); g.clip();
  const roll = P.roll ?? 0, pitch = P.pitch ?? 0;
  for (let deg = -30; deg <= 30; deg += 10) {
    const th = (deg * Math.PI) / 180;
    if (Math.abs(th - pitch) > 0.45) continue;
    const d = [Math.sin(P.hdg) * Math.cos(th), Math.sin(th), -Math.cos(P.hdg) * Math.cos(th)];
    const s = V.project(add(V.cam.eye, mul(d, 1000)));
    if (!s) continue;
    g.save(); g.translate(s.x, s.y); g.rotate(-roll);
    const half = deg === 0 ? 320 : 90, gap = deg === 0 ? 80 : 40;
    g.strokeStyle = deg === 0 ? hc : COL.hudDim; g.lineWidth = deg === 0 ? 2.5 : 2;
    if (deg < 0) g.setLineDash([10, 9]);
    g.beginPath(); g.moveTo(-half, 0); g.lineTo(-gap, 0); g.moveTo(gap, 0); g.lineTo(half, 0); g.stroke(); g.setLineDash([]);
    if (deg) ui.text(String(Math.abs(deg)), half + 10, 6, 16, COL.hudDim);
    g.restore();
  }
  g.restore();
  // the boresight (where the rockets go): a small W
  if (bore) ui.line([bore.x - 24, bore.y, bore.x - 12, bore.y, bore.x - 6, bore.y + 8, bore.x, bore.y, bore.x + 6, bore.y + 8, bore.x + 12, bore.y, bore.x + 24, bore.y], hc, 2);

  // ---- the hover cue: velocity over the ground, body frame, from the centre ----
  const r = P.r ?? cross(P.f, P.u), fh = norm([P.f[0], 0, P.f[2]]), rh = norm([r[0], 0, r[2]]);
  const vf = P.vel[0] * fh[0] + P.vel[2] * fh[2], vr = P.vel[0] * rh[0] + P.vel[2] * rh[2];
  const hx = cx, hy = 540, slow = P.gs < 12, k = slow ? 9 : 2.2;
  g.strokeStyle = hc; g.lineWidth = 2;
  g.beginPath(); g.arc(hx, hy, 9, 0, TAU); g.stroke();
  if (slow) { g.setLineDash([4, 6]); g.beginPath(); g.arc(hx, hy, 9 * 5, 0, TAU); g.stroke(); g.setLineDash([]); }
  const ex = hx + clamp(vr * k, -150, 150), ey = hy - clamp(vf * k, -150, 150);
  ui.line([hx, hy, ex, ey], hc, 3);
  g.fillStyle = hc; g.beginPath(); g.arc(ex, ey, 5, 0, TAU); g.fill();
  if (slow) ui.text('HOVER', hx, hy + 76, 15, COL.hudDim, { align: 'center', sp: 3 });

  // ---- heading tape ----
  const hdg = (((P.hdg * 180) / Math.PI) % 360 + 360) % 360;
  g.save(); g.beginPath(); g.rect(cx - 300, 60, 600, 74); g.clip();
  for (let d = Math.floor(hdg / 5) * 5 - 40; d <= hdg + 40; d += 5) {
    const x = cx + (d - hdg) * 7.6, major = ((d % 10) + 10) % 10 === 0;
    ui.line([x, 118, x, major ? 102 : 110], hc, 2);
    if (major) {
      const n = ((d % 360) + 360) % 360, lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? String(n / 10).padStart(2, '0');
      ui.text(lab, x, 94, 18, hc, { align: 'center' });
    }
  }
  // the bearings home and to the target on the tape
  const mark = (p, txt, col) => {
    const b = ((headingOf(norm([p[0] - P.pos[0], 0, p[2] - P.pos[2]])) * 180) / Math.PI + 360) % 360;
    const dh = clamp(((b - hdg + 540) % 360) - 180, -38, 38);
    ui.text(txt, cx + dh * 7.6, 134, 16, col, { align: 'center', wgt: 700 });
  };
  const home = sim.world.site('home');
  mark([home.x, 0, home.z], 'H', COL.cyan);
  if (P.target) mark(P.target.pos, '◆', COL.amber);
  if (sim.lz && !sim.lz.done) mark([sim.lz.site.x, 0, sim.lz.site.z], 'L', COL.cyan);
  g.restore();
  ui.line([cx, 122, cx - 8, 132, cx + 8, 132, cx, 122], hc, 2);
  ui.text(String(Math.round(hdg)).padStart(3, '0'), cx, 160, 20, hc, { align: 'center', wgt: 700 });

  // ---- airspeed (left) and radar altitude (right) tapes ----
  // with touch the tapes close in and shorten, clear of the HOVER and TGT pads
  const touch = !!app.touch?.active, sx = touch ? 740 : 640, ax = touch ? 1180 : 1280, vx = touch ? 1340 : 1420, th = touch ? 160 : 200;
  const kt = P.speed * KT, ft = Math.max(0, P.agl * FT);
  tape(ui, sx, 440, kt, 5, 20, 3.2, 'left', hc, P.assist && P.hold?.speed != null ? P.hold.speed * KT : null, th);
  tape(ui, ax, 440, ft, 10, 50, 1.4, 'right', ft < 30 ? COL.amber : hc, P.assist && P.hold?.alt != null ? (P.hold.alt - (P.pos[1] - P.agl)) * FT : null, th);
  ui.panel(sx - 120, 420, 112, 40, { fill: 'rgba(3,10,4,0.75)', edge: hc, r: 3 });
  ui.text(`${Math.round(kt)}`, sx - 20, 450, 26, hc, { align: 'right', wgt: 700 });
  ui.text('KT', sx, 440 + th + 40, 16, COL.hudDim, { align: 'center', sp: 2 });
  ui.panel(ax + 8, 420, 112, 40, { fill: 'rgba(3,10,4,0.75)', edge: ft < 30 ? COL.amber : hc, r: 3 });
  ui.text(`${Math.round(ft)}`, ax + 18, 450, 26, ft < 30 ? COL.amber : hc, { wgt: 700 });
  ui.text('R FT', ax, 440 + th + 40, 16, COL.hudDim, { align: 'center', sp: 2 });
  // vertical speed: a caret on a short scale beside the altitude
  const vs = clamp(P.vs * FPM, -2000, 2000), vy = 440 - (Math.sign(vs) * Math.sqrt(Math.abs(vs) / 2000)) * 150;
  ui.line([vx, 290, vx, 590], COL.hudDim, 1.5);
  for (const v of [-1, -0.5, 0, 0.5, 1]) ui.line([vx, 440 - v * 150, vx + 10, 440 - v * 150], COL.hudDim, 1.5);
  ui.line([vx - 4, vy, vx - 16, vy - 8, vx - 16, vy + 8, vx - 4, vy], P.vs < -5 ? COL.amber : hc, 2.5);
  ui.text(`${P.vs >= 0 ? '+' : '−'}${Math.abs(Math.round(P.vs * FPM / 10) * 10)}`, vx + 20, vy + 6, 16, hc);
  // torque and collective under the speed tape
  ui.text(`TRQ ${Math.round((P.torque ?? 0) * 100)}%`, sx, 440 + th + 72, 19, (P.torque ?? 0) > 1.05 ? COL.red : (P.torque ?? 0) > 0.95 ? COL.amber : hc, { align: 'center', wgt: 700 });
  ui.text(`NR ${Math.round((P.rpm ?? 1) * 100)}%`, ax, 440 + th + 72, 19, (P.rpm ?? 1) < 0.92 ? COL.red : hc, { align: 'center', wgt: 700 });

  // ---- the gun's aim, rocket impact ----
  aimCues(ui, V, P, sim, hc);
  const w = STORES[P.sel];
  ui.text(`${STORE_NAME[w]}  ${P.ammo?.[w] ?? 0}`, 760, 760, 21, hc, { wgt: 700, sp: 1 });
  ui.text(`GUN ${P.gun}`, 1160, 760, 21, hc, { align: 'right', wgt: 700, sp: 1 });
  ui.text(P.assist ? 'ASSIST' : 'MANUAL', cx, 760, 16, P.assist ? COL.hudDim : COL.amber, { align: 'center', wgt: 700, sp: 3 });
  if (sim.lockState === 'lock' && blink) ui.text('LOCK  SHOOT', cx, 700, 24, COL.red, { align: 'center', wgt: 700, sp: 3 });
  else if (sim.lockState === 'seek') ui.text('SEEKING', cx, 700, 20, hc, { align: 'center', wgt: 700, sp: 3 });
  if (P.ground) ui.text('ON THE SKIDS', cx, 650, 18, COL.hudDim, { align: 'center', sp: 3 });
}

function tape(ui, x, cy, val, minor, major, ppu, side, col, hold, half = 200) {
  const g = ui.g, s = side === 'left' ? -1 : 1;
  g.save(); g.beginPath(); g.rect(x + (s < 0 ? -110 : 0), cy - half, 110, half * 2); g.clip();
  const span = half / ppu;
  for (let v = Math.floor((val - span) / minor) * minor; v <= val + span; v += minor) {
    if (v < 0) continue;
    const y = cy - (v - val) * ppu, mj = Math.round(v) % major === 0;
    ui.line([x, y, x + s * (mj ? 16 : 9), y], col, 2);
    if (mj && Math.abs(y - cy) > 22) ui.text(String(Math.round(v)), x + s * 24, y + 6, 16, col, { align: s < 0 ? 'right' : 'left' });
  }
  if (hold != null) {
    const y = clamp(cy - (hold - val) * ppu, cy - half + 4, cy + half - 4);
    g.strokeStyle = COL.cyan; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + s * 10, y - 8); g.lineTo(x + s * 10, y + 8); g.lineTo(x, y + 8); g.stroke();
  }
  g.restore();
  ui.line([x, cy - half, x, cy + half], col, 1.5);
  ui.line([x + s * 4, cy, x + s * 16, cy - 10, x + s * 16, cy + 10, x + s * 4, cy], col, 2);
}

function aimCues(ui, V, P, sim, hc) {
  const g = ui.g;
  // the chin gun's line, as the turret points it
  const gd = bodyDir(P, P.gunYaw ?? 0, P.gunPitch ?? 0), gp = V.project(add(P.pos, mul(gd, Math.min(GUN_RANGE, P.target ? dist(P.target.pos, P.pos) : 900))));
  if (gp) {
    g.strokeStyle = P.slaved ? hc : COL.hudDim; g.lineWidth = 2;
    ui.line([gp.x - 14, gp.y, gp.x - 5, gp.y], g.strokeStyle, 2); ui.line([gp.x + 5, gp.y, gp.x + 14, gp.y], g.strokeStyle, 2);
    ui.line([gp.x, gp.y - 14, gp.x, gp.y - 5], g.strokeStyle, 2); ui.line([gp.x, gp.y + 5, gp.x, gp.y + 14], g.strokeStyle, 2);
  }
  if (STORES[P.sel] === 'rkt' && (P.ammo?.rkt ?? 0) > 0) {
    const hit = rocketImpact(sim), s = hit && V.project(hit.p);
    if (s) {
      g.strokeStyle = hc; g.lineWidth = 2.5;
      g.beginPath(); g.arc(s.x, s.y, 15, 0, TAU); g.stroke();
      g.fillStyle = hc; g.fillRect(s.x - 2, s.y - 2, 4, 4);
      ui.text(`${(dist(hit.p, P.pos) / 1000).toFixed(1)}`, s.x + 22, s.y + 6, 15, hc);
    }
  }
}

// ---------- the instrument panel ----------
function panel(ui, app, P, sim, blink) {
  const g = ui.g;
  // canopy frame: the bows either side and the top rail
  g.strokeStyle = 'rgba(16,20,16,0.95)'; g.lineWidth = 16;
  g.beginPath(); g.moveTo(-10, 330); g.quadraticCurveTo(150, 60, 560, -10); g.moveTo(W + 10, 330); g.quadraticCurveTo(W - 150, 60, W - 560, -10); g.stroke();
  g.lineWidth = 10; g.beginPath(); g.moveTo(250, 800); g.lineTo(150, 330); g.moveTo(W - 250, 800); g.lineTo(W - 150, 330); g.stroke();
  // the panel: a glare shield, then the instruments
  g.fillStyle = '#121612';
  g.beginPath(); g.moveTo(0, H); g.lineTo(0, 850); g.lineTo(330, 812); g.quadraticCurveTo(960, 772, 1590, 812); g.lineTo(W, 850); g.lineTo(W, H); g.closePath(); g.fill();
  g.strokeStyle = '#2b3329'; g.lineWidth = 3; g.stroke();
  // with touch the right of the panel is under the pads: the instruments close up to the left
  const touch = !!app.touch?.active, bx = touch ? 350 : 470, bw = touch ? 280 : 330, lx = touch ? 860 : 1100;
  tactical(ui, app, sim, P, touch ? 40 : 60, 846, touch ? 290 : 360, 220, blink);
  rwr(ui, sim, P, touch ? 740 : 960, 966, touch ? 86 : 96, blink);
  // engines and rotor: torque, rotor rpm, collective
  const trq = P.torque ?? 0, nr = P.rpm ?? 1;
  bar(ui, bx, 872, bw, 'TRQ', trq / 1.2, trq > 1.05 ? COL.red : trq > 0.95 ? COL.amber : COL.hud, `${Math.round(trq * 100)}%`, 1 / 1.2);
  bar(ui, bx, 912, bw, 'NR', (nr - 0.6) / 0.5, nr < 0.92 ? COL.red : COL.hud, `${Math.round(nr * 100)}%`, 0.4 / 0.5);
  bar(ui, bx, 952, bw, 'COLL', P.collective ?? 0, COL.hud, `${Math.round((P.collective ?? 0) * 100)}`);
  bar(ui, bx, 992, bw, 'FUEL', P.fuel / 100, P.fuel < 20 ? COL.amber : COL.hud, `${Math.round(P.fuel)}%`);
  bar(ui, bx, 1032, bw, 'HULL', Math.max(0, P.hp) / 100, P.hp < 40 ? COL.red : COL.hud, `${Math.max(0, Math.round(P.hp))}%`);
  // the warning lights
  const lights = [['MSL', !!sim.threat, COL.red], ['RDR', !!sim.spikes?.length, COL.amber], ['NR', nr < 0.92, COL.red], ['TRQ', trq > 1.05, COL.amber],
    ['VRS', (P.settling ?? 0) > 0.35, COL.red], ['FUEL', !!P.lowFuel, COL.amber], ['DMG', P.hp < 50, COL.red], ['SEEN', (sim.seen ?? 0) > 0, COL.amber]];
  lights.forEach(([s, on, c], i) => {
    const x = lx + (i % 4) * 84, y = 860 + Math.floor(i / 4) * 44;
    ui.panel(x, y, 76, 34, { fill: on && (c !== COL.red || blink) ? c : '#1a201a', edge: '#323c32', r: 3 });
    ui.text(s, x + 38, y + 24, 16, on ? '#140c06' : '#56625a', { align: 'center', wgt: 700, sp: 1 });
  });
  ui.text(`FLARES ${P.flares}   GUN ${P.gun}`, lx, 978, 18, COL.hudDim, { wgt: 700, sp: 1 });
  ui.text(`${P.assist ? 'ASSIST ON' : 'ASSIST OFF'}${P.aboard ? `   ABOARD ${P.aboard}` : ''}`, lx, 1008, 18, P.assist ? COL.hudDim : COL.amber, { wgt: 700, sp: 1 });
  if (!app.touch?.active) stores(ui, P, sim, 1560, 846, 320, 220);
}
function bar(ui, x, y, w, label, v, col, txt, mark = null) {
  ui.text(label, x, y + 6, 15, '#7d8a7f', { wgt: 700, sp: 2 });
  ui.panel(x + 62, y - 9, w - 140, 16, { fill: '#0a0e0a', edge: '#2b3329', r: 3 });
  ui.g.fillStyle = col; ui.g.fillRect(x + 64, y - 7, (w - 144) * clamp(v, 0, 1), 12);
  if (mark != null) ui.line([x + 64 + (w - 144) * mark, y - 11, x + 64 + (w - 144) * mark, y + 9], COL.ink, 2);
  ui.text(txt, x + w, y + 6, 16, col, { align: 'right', wgt: 700 });
}
/** the tactical map: heading-up, 5 km across, terrain, roads, units, LZ and home */
function tactical(ui, app, sim, P, x, y, w, h, blink, range = 5000) {
  const g = ui.g, W0 = sim.world, cx = x + w / 2, cy = y + h * 0.62, k = h / range * 1.6;
  ui.panel(x, y, w, h, { fill: '#050a06', edge: '#2b3329', r: 6 });
  g.save(); g.beginPath(); g.rect(x + 3, y + 3, w - 6, h - 6); g.clip();
  g.translate(cx, cy); g.rotate(-P.hdg);
  const img = mapCanvas(W0), S = 12800 * k;
  g.globalAlpha = 0.75; g.imageSmoothingEnabled = true;
  g.drawImage(img, (-6400 - P.pos[0]) * k, (-6400 - P.pos[2]) * k, S, S);
  g.globalAlpha = 1;
  const at = p => [(p[0] - P.pos[0]) * k, (p[2] - P.pos[2]) * k];
  g.strokeStyle = 'rgba(230,220,190,0.5)'; g.lineWidth = 1.5;
  for (const R of W0.roads) { g.beginPath(); R.pts.forEach(([a, b], i) => { const [px, py] = at([a, 0, b]); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); }
  const home = W0.site('home'), [hx, hy] = at([home.x, 0, home.z]);
  g.save(); g.translate(hx, hy); g.rotate(P.hdg); ui.text('H', 0, 7, 18, COL.cyan, { align: 'center', wgt: 700 }); g.restore();
  if (sim.lz && !sim.lz.done) { const [lx, ly] = at([sim.lz.site.x, 0, sim.lz.site.z]); g.strokeStyle = COL.cyan; g.lineWidth = 2; g.strokeRect(lx - 7, ly - 7, 14, 14); }
  for (const a of sim.actors) {
    if (!a.alive || a === P) continue;
    if (a.team === 'red' && !a.obj && !a.sees && dist(a.pos, P.pos) > 2500) continue;
    const [px, py] = at(a.pos);
    const col = a.team === 'blue' ? COL.cyan : a === P.target ? COL.red : a.obj ? COL.amber : COL.hud;
    g.fillStyle = col;
    if (a.air) { g.beginPath(); g.moveTo(px, py - 6); g.lineTo(px + 5, py + 5); g.lineTo(px - 5, py + 5); g.closePath(); g.fill(); }
    else if (a.obj) { g.beginPath(); g.moveTo(px, py - 6); g.lineTo(px + 6, py); g.lineTo(px, py + 6); g.lineTo(px - 6, py); g.closePath(); g.fill(); }
    else g.fillRect(px - 3, py - 3, 6, 6);
    if (a === P.target) { g.strokeStyle = COL.red; g.lineWidth = 1.5; g.strokeRect(px - 9, py - 9, 18, 18); }
  }
  for (const m of sim.missiles) {
    if (m.team === 'blue') continue;
    const [px, py] = at(m.pos);
    g.fillStyle = blink ? COL.red : COL.amber; g.fillRect(px - 2.5, py - 2.5, 5, 5);
  }
  g.restore();
  g.fillStyle = COL.hud;
  g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx + 6, cy + 6); g.lineTo(cx, cy + 3); g.lineTo(cx - 6, cy + 6); g.closePath(); g.fill();
  ui.text('TSD', x + 12, y + 24, 15, COL.hudDim, { wgt: 700, sp: 2 });
  ui.text(`${range / 2000} KM`, x + w - 12, y + h - 12, 14, COL.hudDim, { align: 'right' });
}
/** the threat warning scope: who has the Gadfly on radar or in sight, by bearing */
function rwr(ui, sim, P, cx, cy, R, blink) {
  const g = ui.g;
  g.fillStyle = '#050a06'; g.beginPath(); g.arc(cx, cy, R + 8, 0, TAU); g.fill();
  g.strokeStyle = '#2b3329'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = 'rgba(180,245,138,0.2)'; g.lineWidth = 1.5;
  for (const k of [0.5, 1]) { g.beginPath(); g.arc(cx, cy, R * k, 0, TAU); g.stroke(); }
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; ui.line([cx + Math.sin(a) * R * 0.9, cy - Math.cos(a) * R * 0.9, cx + Math.sin(a) * R, cy - Math.cos(a) * R], 'rgba(180,245,138,0.3)', 1.5); }
  const put = (p, txt, col, inner) => {
    const rel = wrap(headingOf(norm(sub(p, P.pos))) - P.hdg), d = inner ? R * 0.45 : R * 0.75;
    const x = cx + Math.sin(rel) * d, y = cy - Math.cos(rel) * d;
    ui.text(txt, x, y + 7, 20, col, { align: 'center', wgt: 700 });
  };
  for (const a of sim.spikes ?? []) put(a.pos, symbol(a.kind), COL.amber, false);
  for (const a of sim.actors) if (a.alive && a.sees && a.team === 'red' && !(sim.spikes ?? []).includes(a)) put(a.pos, symbol(a.kind), COL.hudDim, true);
  if (sim.threat && blink) put(sim.threat.pos, 'M', COL.red, false);
  ui.text('RWR', cx, cy - R - 16, 14, COL.hudDim, { align: 'center', wgt: 700, sp: 2 });
}
/** the stores page: the selected store, the rounds, the target camera's readout */
function stores(ui, P, sim, x, y, w, h) {
  ui.panel(x, y, w, h, { fill: '#050a06', edge: '#2b3329', r: 6 });
  ui.text('WPN', x + 14, y + 24, 15, COL.hudDim, { wgt: 700, sp: 2 });
  STORES.forEach((s, i) => {
    const sel = P.sel === i, n = P.ammo?.[s] ?? 0, yy = y + 56 + i * 30;
    ui.text(`${sel ? '>' : ' '} ${STORE_NAME[s]}`, x + 14, yy, 18, sel ? COL.hud : n > 0 ? COL.hudDim : '#33503a', { wgt: 700 });
    ui.text(String(n), x + w - 14, yy, 18, sel ? COL.hud : n > 0 ? COL.hudDim : '#33503a', { align: 'right', wgt: 700 });
  });
  const T = P.target;
  if (T) {
    const d = dist(T.pos, P.pos);
    ui.text(`TGT ${KINDS[T.kind].label}`, x + 14, y + 170, 18, T.obj ? COL.amber : COL.hud, { wgt: 700 });
    ui.text(`${(d / 1000).toFixed(2)} KM`, x + w - 14, y + 170, 18, COL.hud, { align: 'right', wgt: 700 });
    ui.text(P.tgtSeen ? (sim.lockState === 'lock' ? 'LOCKED' : sim.lockState === 'seek' ? 'SEEKING' : 'IN SIGHT') : 'MASKED', x + 14, y + 200, 16, P.tgtSeen ? COL.hudDim : COL.amber, { wgt: 700, sp: 2 });
  } else ui.text('NO TARGET', x + 14, y + 185, 17, COL.hudDim, { wgt: 700, sp: 2 });
}

// ---------- the chase view ----------
function compact(ui, app, P, sim, blink) {
  if (!P.alive) return;
  const hc = COL.hud, pan = (x, y, w, h) => ui.panel(x, y, w, h, { fill: 'rgba(5,10,6,0.55)', edge: 'rgba(180,245,138,0.25)', r: 4 });
  pan(40, 900, 560, 140);
  ui.text(`${Math.round(P.speed * KT)} KT`, 64, 948, 30, hc, { wgt: 700 });
  ui.text(`R ${Math.max(0, Math.round(P.agl * FT))} FT`, 280, 948, 30, P.agl * FT < 30 ? COL.amber : hc, { wgt: 700 });
  ui.text(`VS ${P.vs >= 0 ? '+' : '−'}${Math.abs(Math.round(P.vs * FPM / 10) * 10)}`, 64, 990, 20, P.vs < -5 ? COL.amber : hc, { wgt: 600 });
  ui.text(`TRQ ${Math.round((P.torque ?? 0) * 100)}%   NR ${Math.round((P.rpm ?? 1) * 100)}%`, 280, 990, 20, (P.torque ?? 0) > 1.05 || (P.rpm ?? 1) < 0.92 ? COL.red : hc, { wgt: 600 });
  ui.text(`FUEL ${Math.round(P.fuel)}%   HULL ${Math.max(0, Math.round(P.hp))}%   ${P.assist ? 'ASSIST' : 'MANUAL'}`, 64, 1024, 18, P.lowFuel || P.hp < 40 ? COL.amber : COL.hudDim, { wgt: 600, sp: 1 });
  if (!app.touch?.active) {
    pan(W - 560, 900, 520, 140);
    const w = STORES[P.sel];
    ui.text(`${STORE_NAME[w]} ${P.ammo?.[w] ?? 0}`, W - 536, 948, 28, hc, { wgt: 700 });
    ui.text(`GUN ${P.gun}   FLARES ${P.flares}`, W - 536, 990, 20, hc, { wgt: 600 });
    const lock = sim.lockState === 'lock';
    ui.text(lock ? 'LOCK' : sim.lockState === 'seek' ? 'SEEK' : '', W - 64, 948, 26, lock ? COL.red : hc, { align: 'right', wgt: 700, sp: 2 });
    ui.text('CHASE VIEW', W - 64, 1024, 16, COL.hudDim, { align: 'right', wgt: 600, sp: 2 });
  }
  rwr(ui, sim, P, 112, 800, 60, blink);
}

// ---------- the gunner's sight: a thermal camera on the target ----------
function sight(ui, app, V, P, T, sim, blink) {
  const g = ui.g, cx = W / 2, cy = H / 2, hc = COL.thermal;
  // a green phosphor wash, the frame's dark corners and a few scan lines
  g.fillStyle = 'rgba(40,120,60,0.22)'; g.fillRect(0, 0, W, H);
  const gr = g.createRadialGradient(cx, cy, 300, cx, cy, 1050);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = (Math.floor(app.t * 40) % 6); y < H; y += 6) g.fillRect(0, y, W, 2);
  // the reticle
  ui.line([cx - 300, cy, cx - 40, cy], hc, 2); ui.line([cx + 40, cy, cx + 300, cy], hc, 2);
  ui.line([cx, cy - 220, cx, cy - 40], hc, 2); ui.line([cx, cy + 40, cx, cy + 220], hc, 2);
  for (const s of [-1, 1]) for (const k of [1, 2, 3, 4]) { ui.line([cx + s * k * 60, cy - 8, cx + s * k * 60, cy + 8], hc, 2); ui.line([cx - 8, cy + s * k * 50, cx + 8, cy + s * k * 50], hc, 2); }
  const box = 46, locked = sim.lockState === 'lock';
  g.strokeStyle = locked ? COL.red : hc; g.lineWidth = 3;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) ui.line([cx + sx * box, cy + sy * (box - 16), cx + sx * box, cy + sy * box, cx + sx * (box - 16), cy + sy * box], g.strokeStyle, 3);
  if (sim.lockState === 'seek') { g.beginPath(); g.arc(cx, cy, 70, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(P.lock ?? 0, 0, 1)); g.stroke(); }
  // the readouts
  const d = dist(T.pos, P.pos), fov = (V.cam.fov * 180) / Math.PI;
  const panel = (x, y, w, h) => ui.panel(x, y, w, h, { fill: 'rgba(0,0,0,0.45)', edge: alpha(hc, 0.35), r: 3 });
  panel(40, 150, 480, 130);
  ui.text('TADS  ·  WHT HOT', 64, 190, 22, hc, { wgt: 700, sp: 3 });
  ui.text(`${KINDS[T.kind].label}${T.obj ? '  ·  OBJECTIVE' : ''}`, 64, 228, 24, T.obj ? COL.amber : hc, { wgt: 700, sp: 2 });
  ui.text(P.tgtSeen ? 'LINE OF SIGHT' : 'MASKED  ·  NO LOS', 64, 260, 18, P.tgtSeen ? alpha(hc, 0.7) : COL.amber, { wgt: 700, sp: 2 });
  panel(W - 520, 150, 480, 130);
  ui.text(`RNG ${Math.round(d)} M`, W - 64, 190, 24, hc, { align: 'right', wgt: 700, sp: 2 });
  ui.text(`FOV ${fov.toFixed(1)}°   ×${(60 / fov).toFixed(0)}`, W - 64, 228, 20, alpha(hc, 0.8), { align: 'right', wgt: 600, sp: 2 });
  const brg = wrap(headingOf(norm(sub(T.pos, P.pos))) - P.hdg);
  ui.text(`AZ ${brg >= 0 ? 'R' : 'L'}${Math.abs(Math.round((brg * 180) / Math.PI))}°`, W - 64, 260, 18, alpha(hc, 0.7), { align: 'right', wgt: 600, sp: 2 });
  // where the sensor looks against the nose: a bar under the picture
  const ax = cx + clamp(brg / Math.PI, -1, 1) * 400;
  ui.line([cx - 400, 980, cx + 400, 980], alpha(hc, 0.5), 2);
  ui.line([cx, 972, cx, 988], alpha(hc, 0.5), 2);
  g.fillStyle = hc; g.fillRect(ax - 6, 972, 12, 16);
  const w = STORES[P.sel];
  ui.text(`${STORE_NAME[w]} ${P.ammo?.[w] ?? 0}   GUN ${P.gun}`, cx, 1030, 22, hc, { align: 'center', wgt: 700, sp: 2 });
  if (locked && blink) ui.text('LOCK', cx, cy + 120, 30, COL.red, { align: 'center', wgt: 700, sp: 8 });
  // the flight numbers the pilot still needs
  ui.text(`${Math.round(P.speed * KT)} KT   R ${Math.max(0, Math.round(P.agl * FT))} FT   VS ${Math.round(P.vs * FPM / 10) * 10}`, 84, 1030, 20, alpha(hc, 0.8), { wgt: 700, sp: 1 });
}

// ---------- objective, rescue ----------
function objective(ui, app, sim) {
  const M = sim.mission ?? {}, o = sim.objectives?.() ?? { done: 0, total: 0 };
  const x = 40, y = 30, P = sim.player;
  const tall = sim.complete;
  ui.panel(x, y, 480, tall ? 104 : 80, { fill: 'rgba(5,10,6,0.5)', edge: 'rgba(180,245,138,0.2)', r: 4 });
  ui.text(`${String((sim.mi ?? 0) + 1).padStart(2, '0')}  ${String(M.name ?? '').toUpperCase()}`, x + 18, y + 30, 20, COL.ink, { wgt: 700, sp: 2 });
  ui.fit(String(M.text ?? M.goal ?? ''), x + 18, y + 58, 17, 380, sim.complete ? COL.hud : COL.dim, { wgt: 500 });
  ui.text(o.pct ? `${o.done}%` : `${o.done}/${o.total}`, x + 462, y + 30, 20, sim.complete ? COL.hud : COL.amber, { align: 'right', wgt: 700 });
  if (tall) {
    const home = sim.world.site('home');
    ui.text(`RTB  ${String(home.label).toUpperCase()}  ${(Math.hypot(home.x - P.pos[0], home.z - P.pos[2]) / 1000).toFixed(1)} KM`, x + 18, y + 88, 17, COL.cyan, { wgt: 700, sp: 1 });
  }
  ui.text(fmt((app.camp?.score ?? 0) + (sim.score ?? 0)), W - 40, 58, 28, COL.ink, { align: 'right', wgt: 700, sp: 1 });
  ui.text(`SCORE  ·  AIRFRAMES ${app.camp?.airframes ?? 0}`, W - 40, 82, 15, COL.dim, { align: 'right', wgt: 600, sp: 2 });
}
function rescue(ui, sim) {
  const L = sim.lz;
  if (!L || L.done || !(L.t > 0)) return;
  const k = clamp(L.t / L.need, 0, 1), x = W / 2 - 200, y = 250;
  ui.panel(x, y, 400, 56, { fill: 'rgba(5,10,6,0.6)', edge: COL.cyan, r: 4 });
  ui.text('SURVIVORS BOARDING', W / 2, y + 24, 17, COL.cyan, { align: 'center', wgt: 700, sp: 3 });
  ui.g.fillStyle = COL.cyan; ui.g.fillRect(x + 16, y + 34, 368 * k, 10);
}

// ---------- touch ----------
function touchPads(ui, app, P) {
  const g = ui.g, u = ui.u, Pd = pads(W * u, H * u), k = 1 / u, T = app.touch, hc = COL.hud;
  g.lineWidth = 3;
  for (const name of ['gun', 'fire', 'weapon', 'target', 'decoy', 'hover', 'view', 'pause']) {
    const b = Pd[name], on = T.held?.[name];
    if (!b) continue;
    g.beginPath(); g.arc(b.x * k, b.y * k, b.r * k, 0, TAU);
    g.fillStyle = on ? 'rgba(180,245,138,0.35)' : 'rgba(10,20,12,0.35)'; g.fill();
    g.strokeStyle = 'rgba(180,245,138,0.6)'; g.stroke();
    const label = name === 'weapon' ? STORE_NAME[STORES[P.sel]].split(' ')[1] : b.label;
    const count = name === 'weapon' ? P.ammo?.[STORES[P.sel]] : name === 'decoy' ? P.flares : name === 'gun' ? P.gun : null;
    ui.text(label, b.x * k, b.y * k + (count != null ? 0 : 7), name === 'gun' ? 28 : 18, hc, { align: 'center', wgt: 700, sp: 1 });
    if (count != null) ui.text(String(count), b.x * k, b.y * k + 24, 15, COL.hudDim, { align: 'center', wgt: 700 });
  }
  // the collective: a slot whose middle holds the height
  const S = Pd.slider, x = S.x * k, y0 = S.y0 * k, y1 = S.y1 * k, w = S.w * k, mid = (y0 + y1) / 2;
  ui.panel(x - w / 2, y1, w, y0 - y1, { fill: 'rgba(10,20,12,0.35)', edge: 'rgba(180,245,138,0.5)', r: 10 });
  ui.line([x - w / 2, mid, x + w / 2, mid], COL.hudDim, 2);
  ui.text('▲', x, y1 + 30, 18, COL.hudDim, { align: 'center' }); ui.text('▼', x, y0 - 14, 18, COL.hudDim, { align: 'center' });
  const c = T.coll ?? 0, ty = mid - (c * (y0 - y1)) / 2;
  ui.panel(x - w / 2 - 6, ty - 12, w + 12, 24, { fill: T.coll != null ? hc : COL.hudDim, edge: null, r: 6 });
  ui.text('COLL', x, y0 + 30, 16, hc, { align: 'center', wgt: 700 });
  // the cyclic: a floating stick on the left half
  if (T.stick) {
    const sx = T.stick.x0 * k, sy = T.stick.y0 * k, R = Pd.stickR * k;
    g.beginPath(); g.arc(sx, sy, R, 0, TAU); g.strokeStyle = 'rgba(180,245,138,0.45)'; g.stroke();
    let dx = T.stick.x * k - sx, dy = T.stick.y * k - sy;
    const L = Math.hypot(dx, dy);
    if (L > R) { dx *= R / L; dy *= R / L; }
    g.beginPath(); g.arc(sx + dx, sy + dy, 40, 0, TAU); g.fillStyle = 'rgba(180,245,138,0.35)'; g.fill();
  } else ui.text('DRAG TO FLY', 330, 700, 20, 'rgba(180,245,138,0.5)', { align: 'center', wgt: 700, sp: 3 });
}
