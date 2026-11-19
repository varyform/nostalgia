// The flight's 2D layer: the head-up display (pitch ladder, heading, speed and height tapes,
// target boxes, seeker and lock cues, gun pipper, bomb and rocket impact points, warnings), the
// cockpit's lower panel with the radar scope and the stores display, the chase view's compact
// readouts, sortie messages and the touch controls.
import { MISSIONS } from '../missions.js';
import { BULLET_V, G, IR_CONE, KINDS, RADAR_RANGE, ROCKET_V, STALL, WEAPONS, WEAPON_NAME, add, bankOf, dirOf, dist, headingOf, mul, norm, predictBomb, sub } from '../sim.js';
import { pads, THROTTLE_MAX } from '../touch.js';
import { COL, H, W, fmt } from '@nostalgia/gl/ui';

const KT = 1.944, FT = 3.281;
const TAU = Math.PI * 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

/** where rockets fired now would hit the ground (they fall at a third of g) */
function rocketImpact(sim) {
  const P = sim.player, W0 = sim.world;
  let p = [...P.pos], v = mul(P.f, P.speed + ROCKET_V);
  for (let t = 0; t < 5; t += 0.05) {
    v = [v[0], v[1] - G * 0.35 * 0.05, v[2]];
    p = add(p, mul(v, 0.05));
    if (p[1] < W0.heightAt(p[0], p[2])) return p;
  }
  return null;
}

export function drawHud(ui, app, V) {
  const g = ui.g, sim = app.sim, P = sim.player;
  if (!P) return;
  const cockpit = app.view === 'cockpit' && P.alive, t = app.t;
  const blink = Math.floor(t * 3) % 2 === 0;
  const hc = COL.green;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const W0 = sim.world, agl = P.pos[1] - W0.heightAt(P.pos[0], P.pos[2]);

  // ---------- target markers (every view) ----------
  const T = P.target;
  const flying = sim.status === 'fly' && P.alive;
  if (flying) {
    for (const a of sim.actors) {
      if (!a.alive || a === P || a === T) continue;
      const d = dist(a.pos, P.pos);
      if (d > (a.air ? 9000 : 6000)) continue;
      const s = V.project(a.pos);
      if (!s || s.x < 0 || s.x > W || s.y < 0 || s.y > H) continue;
      const col = a.team === 'blue' ? COL.cyan : a.obj ? COL.amber : COL.greenDim;
      const r = 14;
      ui.line([s.x - r, s.y - r + 6, s.x - r, s.y - r, s.x - r + 6, s.y - r], col, 2);
      ui.line([s.x + r - 6, s.y + r, s.x + r, s.y + r, s.x + r, s.y + r - 6], col, 2);
      if (a.team === 'blue' && d < 6000) ui.text(KINDS[a.kind].label, s.x, s.y + r + 18, 16, col, { align: 'center' });
    }
    if (T) targetBox(ui, app, V, T, P, blink);
  }

  // ---------- the HUD proper ----------
  if (cockpit) {
    hudCockpit(ui, app, V, P, sim, agl, blink, hc);
    panel(ui, app, V, P, sim, blink);
  } else if (P.alive) compact(ui, app, P, sim, agl);

  // ---------- warnings ----------
  if (flying) {
    const warns = [];
    if (sim.threat) {
      warns.push(['MISSILE', COL.red, true]);
      // which way it comes from
      const m = sim.threat, rel = wrap(headingOf(norm(sub(m.pos, P.pos))) - headingOf(P.f));
      const cx = W / 2, cy = cockpit ? 470 : 540, R = 250;
      const x = cx + Math.sin(rel) * R, y = cy - Math.cos(rel) * R * 0.8;
      if (blink) {
        g.save(); g.translate(x, y); g.rotate(rel);
        g.beginPath(); g.moveTo(0, -22); g.lineTo(16, 10); g.lineTo(-16, 10); g.closePath();
        g.fillStyle = COL.red; g.fill(); g.restore();
        ui.text((dist(m.pos, P.pos) / 1000).toFixed(1), x, y + 34, 18, COL.red, { align: 'center', wgt: 700 });
      }
    } else if (sim.spiked) warns.push(['SAM RADAR', COL.amber, false]);
    const sink = -P.vel[1], tti = sink > 1 ? agl / sink : Infinity;
    if (!P.ground && (tti < 4.5 || (agl < 60 && P.f[1] < -0.05))) warns.push(['PULL UP', COL.red, true]);
    if (P.stalled) warns.push(['STALL', COL.amber, true]);
    if (P.fuel <= 0) warns.push(['NO FUEL', COL.red, true]);
    else if (P.lowFuel) warns.push(['FUEL LOW', COL.amber, false]);
    if (sim.outside) warns.push(['AREA LIMIT', COL.amber, false]);
    let y = cockpit ? 650 : 760;
    for (const [s, c, flash] of warns) {
      if (!flash || blink) {
        const w = ui.width(s, 30, 700, 4) + 40;
        ui.panel(W / 2 - w / 2, y - 34, w, 46, { fill: 'rgba(30,6,4,0.55)', edge: c, r: 4 });
        ui.text(s, W / 2, y, 30, c, { align: 'center', wgt: 700, sp: 4 });
      }
      y += 54;
    }
  }

  // ---------- messages and the objective ----------
  let my = cockpit ? 190 : 150;
  for (const m of V.msgs) {
    const a = Math.min(1, (6 - m.t) * 1.5, m.t * 6);
    g.globalAlpha = Math.max(0, a);
    ui.text(m.text.toUpperCase(), W / 2, my, 24, COL.ink, { align: 'center', wgt: 600, sp: 2 });
    g.globalAlpha = 1;
    my += 32;
  }
  objective(ui, app, sim, V);

  // ---------- the end of the sortie ----------
  const big = (s, c, sub2) => {
    ui.panel(W / 2 - 420, 360, 840, sub2 ? 170 : 120, { fill: 'rgba(5,9,14,0.7)', edge: c });
    ui.text(s, W / 2, 440, 58, c, { align: 'center', wgt: 700, sp: 10 });
    if (sub2) ui.text(sub2, W / 2, 495, 26, COL.ink, { align: 'center', wgt: 500, sp: 1 });
  };
  if (sim.status === 'down') big(sim.reason === 'Shot down' ? 'SHOT DOWN' : 'CRASHED', COL.red, sim.reason === 'Shot down' ? 'The Seraph is lost' : sim.reason);
  else if (sim.status === 'failed') big('MISSION FAILED', COL.amber, sim.reason);
  else if (sim.status === 'landed') big('LANDED', COL.green, 'Welcome home. Landing bonus 1,500');
  else if (sim.complete && sim.completeT < 5) big('OBJECTIVES COMPLETE', COL.green, 'Return to base and land, or end the sortie from the pause menu');

  if (app.touch?.active && app.state === 'play') touchPads(ui, app);
}

function targetBox(ui, app, V, T, P, blink) {
  const g = ui.g, s = V.project(T.pos), d = dist(T.pos, P.pos);
  const locked = P.irLock === T || P.radarLock === T;
  const col = locked ? COL.red : T.obj ? COL.amber : COL.green;
  const label = `${KINDS[T.kind].label}  ${(d / 1000).toFixed(1)}`;
  if (s && s.x > 30 && s.x < W - 30 && s.y > 30 && s.y < H - 30) {
    const r = 24;
    g.strokeStyle = col; g.lineWidth = 2.5;
    if (locked) {
      g.beginPath(); g.moveTo(s.x, s.y - r * 1.3); g.lineTo(s.x + r * 1.3, s.y); g.lineTo(s.x, s.y + r * 1.3); g.lineTo(s.x - r * 1.3, s.y); g.closePath(); g.stroke();
    }
    g.strokeRect(s.x - r, s.y - r, r * 2, r * 2);
    ui.text(label, s.x + r + 8, s.y - r + 14, 18, col, { wgt: 600 });
    if (T.obj) ui.text('TARGET', s.x + r + 8, s.y - r + 34, 15, col, { wgt: 600, sp: 2 });
  } else {
    // off screen: an arrow round the middle pointing at it
    const cam = V.cam, rel = sub(T.pos, cam.eye);
    const r = [cam.f[1] * cam.u[2] - cam.f[2] * cam.u[1], cam.f[2] * cam.u[0] - cam.f[0] * cam.u[2], cam.f[0] * cam.u[1] - cam.f[1] * cam.u[0]];
    const x = rel[0] * r[0] + rel[1] * r[1] + rel[2] * r[2], y = rel[0] * cam.u[0] + rel[1] * cam.u[1] + rel[2] * cam.u[2];
    const a = Math.atan2(x, y), R = 330;
    const cx = W / 2 + Math.sin(a) * R, cy = H / 2 - Math.cos(a) * R * 0.85;
    g.save(); g.translate(cx, cy); g.rotate(a);
    g.beginPath(); g.moveTo(0, -20); g.lineTo(14, 8); g.lineTo(0, 2); g.lineTo(-14, 8); g.closePath();
    g.fillStyle = col; g.fill(); g.restore();
    ui.text(label, cx, cy + 34, 17, col, { align: 'center' });
  }
  void blink;
}

function hudCockpit(ui, app, V, P, sim, agl, blink, hc) {
  const g = ui.g, cx = W / 2;
  // the flight-path marker: where the jet is actually going
  const fpm = V.project(add(V.cam.eye, mul(norm(P.vel[0] || P.vel[1] || P.vel[2] ? P.vel : P.f), 2000)));
  const bore = V.project(add(V.cam.eye, mul(P.f, 2000)));
  g.save();
  g.beginPath(); g.rect(560, 90, 800, 700); g.clip();
  // ---- the pitch ladder, rolled with the jet ----
  const hv = headingOf(P.f), bank = bankOf(P.f, P.u);
  const pitch = Math.asin(Math.max(-1, Math.min(1, P.f[1])));
  for (let deg = -80; deg <= 80; deg += 10) {
    const th = (deg * Math.PI) / 180;
    if (Math.abs(th - pitch) > 0.55) continue;
    const s = V.project(add(V.cam.eye, mul(dirOf(hv, th), 3000)));
    if (!s) continue;
    g.save(); g.translate(s.x, s.y); g.rotate(-bank);
    const half = deg === 0 ? 300 : 120, gap = deg === 0 ? 60 : 46;
    g.strokeStyle = hc; g.lineWidth = deg === 0 ? 2.5 : 2;
    if (deg < 0) g.setLineDash([12, 10]);
    g.beginPath();
    g.moveTo(-half, 0); g.lineTo(-gap, 0); g.moveTo(gap, 0); g.lineTo(half, 0);
    if (deg) { const tick = deg > 0 ? 12 : -12; g.moveTo(-half, 0); g.lineTo(-half, tick); g.moveTo(half, 0); g.lineTo(half, tick); }
    g.stroke(); g.setLineDash([]);
    if (deg) {
      ui.text(String(Math.abs(deg)), -half - 12, 7, 18, hc, { align: 'right' });
      ui.text(String(Math.abs(deg)), half + 12, 7, 18, hc, { align: 'left' });
    }
    g.restore();
  }
  g.restore();
  // boresight cross
  if (bore) ui.line([bore.x - 22, bore.y, bore.x - 8, bore.y, bore.x - 8, bore.y + 8, bore.x, bore.y, bore.x + 8, bore.y + 8, bore.x + 8, bore.y, bore.x + 22, bore.y], hc, 2);
  if (fpm) {
    g.strokeStyle = hc; g.lineWidth = 2.5;
    g.beginPath(); g.arc(fpm.x, fpm.y, 10, 0, TAU);
    g.moveTo(fpm.x - 10, fpm.y); g.lineTo(fpm.x - 26, fpm.y); g.moveTo(fpm.x + 10, fpm.y); g.lineTo(fpm.x + 26, fpm.y); g.moveTo(fpm.x, fpm.y - 10); g.lineTo(fpm.x, fpm.y - 20);
    g.stroke();
  }
  // ---- heading tape ----
  const hdg = ((hv * 180) / Math.PI + 360) % 360;
  g.save(); g.beginPath(); g.rect(cx - 300, 70, 600, 70); g.clip();
  for (let d = Math.floor(hdg / 5) * 5 - 35; d <= hdg + 35; d += 5) {
    const x = cx + (d - hdg) * 8.4, major = ((d % 10) + 10) % 10 === 0;
    ui.line([x, 120, x, major ? 104 : 112], hc, 2);
    if (major) ui.text(String(((d / 10 + 36) % 36) | 0).padStart(2, '0'), x, 96, 18, hc, { align: 'center' });
  }
  // home on the tape
  const home = sim.world.site('home'), hb = ((headingOf(norm([home.x - P.pos[0], 0, home.z - P.pos[2]])) * 180) / Math.PI + 360) % 360;
  let dh = ((hb - hdg + 540) % 360) - 180;
  dh = Math.max(-34, Math.min(34, dh));
  ui.text('H', cx + dh * 8.4, 138, 16, COL.cyan, { align: 'center', wgt: 700 });
  g.restore();
  ui.line([cx, 124, cx - 8, 134, cx + 8, 134, cx, 124], hc, 2);
  // ---- speed and altitude ----
  const kt = P.speed * KT, ft = P.pos[1] * FT;
  tape(ui, 620, 440, kt, 10, 50, 5.2, 'left', hc);
  tape(ui, 1300, 440, ft, 100, 500, 0.5, 'right', hc);
  ui.panel(484, 420, 122, 40, { fill: 'rgba(3,10,6,0.8)', edge: hc, r: 3 });
  ui.text(`${Math.round(kt)}`, 596, 450, 26, hc, { align: 'right', wgt: 700 });
  ui.panel(1314, 420, 132, 40, { fill: 'rgba(3,10,6,0.8)', edge: hc, r: 3 });
  ui.text(`${Math.round(ft / 10) * 10}`, 1324, 450, 26, hc, { align: 'left', wgt: 700 });
  if (agl * FT < 2000) ui.text(`R ${Math.max(0, Math.round((agl * FT) / 10) * 10)}`, 1300, 640, 20, agl < 100 ? COL.amber : hc);
  const thr = Math.round(Math.min(1, P.throttle) * 100);
  ui.text(P.burner ? 'AB' : `${thr}%`, 620, 640, 22, P.burner ? COL.amber : hc, { align: 'right', wgt: 700 });
  const gs = P.prevG ?? 1;
  void gs;
  ui.text(`M ${(P.speed / 340).toFixed(2)}`, 620, 668, 18, hc, { align: 'right' });
  // ---- the weapon cue ----
  weaponCue(ui, app, V, P, sim, blink, hc, fpm);
  ui.text(`${WEAPON_NAME[WEAPONS[P.sel]]} ${P.stores[WEAPONS[P.sel]]}`, 760, 760, 22, hc, { wgt: 700, sp: 1 });
  ui.text(`GUN ${P.gun}`, 1160, 760, 22, hc, { align: 'right', wgt: 700, sp: 1 });
  if (P.ground) ui.text(P.speed < 3 ? 'BRAKES' : 'ROLLING', cx, 720, 20, hc, { align: 'center' });
}

function tape(ui, x, cy, val, minor, major, ppu, side, col) {
  const g = ui.g, s = side === 'left' ? -1 : 1;
  g.save(); g.beginPath(); g.rect(x + (s < 0 ? -110 : 0), cy - 200, 110, 400); g.clip();
  const span = 200 / ppu;
  for (let v = Math.floor((val - span) / minor) * minor; v <= val + span; v += minor) {
    if (v < 0) continue;
    const y = cy - (v - val) * ppu, mj = Math.round(v) % major === 0;
    ui.line([x, y, x + s * (mj ? 18 : 10), y], col, 2);
    if (mj && Math.abs(y - cy) > 22) ui.text(String(Math.round(v)), x + s * 26, y + 6, 17, col, { align: s < 0 ? 'right' : 'left' });
  }
  g.restore();
  ui.line([x, cy - 200, x, cy + 200], col, 1.5);
  ui.line([x + s * 4, cy, x + s * 16, cy - 10, x + s * 16, cy + 10, x + s * 4, cy], col, 2);
}

function weaponCue(ui, app, V, P, sim, blink, hc, fpm) {
  const g = ui.g, w = WEAPONS[P.sel], T = P.target, f = V.focal;
  if (w === 'ir' && P.stores.ir > 0) {
    const c = V.project(add(V.cam.eye, mul(P.f, 2000))), r = Math.tan(IR_CONE) * f;
    if (c) {
      g.strokeStyle = P.irLock ? COL.red : hc; g.lineWidth = 2;
      if (!P.irLock) g.setLineDash([10, 12]);
      g.beginPath(); g.arc(c.x, c.y, r, 0, TAU); g.stroke(); g.setLineDash([]);
    }
    const tr = P.irTrack && V.project(P.irTrack.pos);
    if (tr) {
      g.strokeStyle = P.irLock ? COL.red : hc; g.lineWidth = 2.5;
      g.beginPath(); g.arc(tr.x, tr.y, P.irLock ? 30 : 30 + 20 * (1 - P.irT / 0.45), 0, TAU); g.stroke();
    }
    if (P.irLock) ui.text('IR LOCK  SHOOT', W / 2, 718, 24, COL.red, { align: 'center', wgt: 700, sp: 3 });
  } else if (w === 'radar' && P.stores.radar > 0) {
    if (P.radarLock) { if (blink) ui.text('RDR LOCK  SHOOT', W / 2, 718, 24, COL.red, { align: 'center', wgt: 700, sp: 3 }); }
    else if (P.radarT > 0) ui.text('RDR ACQ', W / 2, 718, 22, hc, { align: 'center', wgt: 700, sp: 3 });
    else if (!T?.air) ui.text('RDR  NO AIR TARGET', W / 2, 718, 20, COL.greenDim, { align: 'center', wgt: 600, sp: 2 });
    else if (dist(T.pos, P.pos) > RADAR_RANGE) ui.text('RDR  OUT OF RANGE', W / 2, 718, 20, COL.greenDim, { align: 'center', wgt: 600, sp: 2 });
  } else if (w === 'bombs' && P.stores.bombs > 0 && !P.ground) {
    const hit = predictBomb(sim), s = hit && V.project(hit.pos);
    if (s) {
      if (fpm) ui.line([fpm.x, fpm.y + 22, s.x, s.y], hc, 1.5, [6, 8]);
      ui.line([s.x - 16, s.y, s.x + 16, s.y], hc, 2.5); ui.line([s.x, s.y - 16, s.x, s.y + 16], hc, 2.5);
      g.strokeStyle = hc; g.beginPath(); g.arc(s.x, s.y, 22, 0, TAU); g.stroke();
      ui.text(`${hit.t.toFixed(1)}s`, s.x + 30, s.y + 6, 16, hc);
    } else ui.text('CCIP', W / 2, 718, 20, COL.greenDim, { align: 'center' });
  } else if (w === 'rockets' && P.stores.rockets > 0) {
    const p = rocketImpact(sim), s = p && V.project(p);
    if (s) {
      g.strokeStyle = hc; g.lineWidth = 2.5;
      g.beginPath(); g.arc(s.x, s.y, 16, 0, TAU); g.moveTo(s.x + 2, s.y); g.arc(s.x, s.y, 2, 0, TAU); g.stroke();
    }
  }
  // the gun's lead pipper on an aircraft in range
  if (T?.air && T.alive) {
    const D = dist(T.pos, P.pos);
    if (D < 2200) {
      const tof = D / (BULLET_V + P.speed), lead = add(T.pos, mul(T.vel ?? mul(T.f, T.speed), tof));
      lead[1] += 0.5 * G * tof * tof;
      const s = V.project(lead);
      if (s) {
        g.strokeStyle = D < 1300 ? hc : COL.greenDim; g.lineWidth = 2.5;
        g.beginPath(); g.arc(s.x, s.y, 26, 0, TAU); g.stroke();
        g.beginPath(); g.arc(s.x, s.y, 34, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, 1 - D / 2200)); g.stroke();
        g.fillStyle = hc; g.fillRect(s.x - 2, s.y - 2, 4, 4);
      }
    }
  }
}

// the cockpit's lower panel: the radar on the left, stores and damage on the right
function panel(ui, app, V, P, sim, blink) {
  const g = ui.g;
  g.fillStyle = '#11161b';
  g.beginPath(); g.moveTo(0, H); g.lineTo(0, 860); g.lineTo(380, 820); g.quadraticCurveTo(960, 780, 1540, 820); g.lineTo(W, 860); g.lineTo(W, H); g.closePath(); g.fill();
  g.strokeStyle = '#2a333b'; g.lineWidth = 3; g.stroke();
  // canopy bow
  g.strokeStyle = 'rgba(14,18,22,0.92)'; g.lineWidth = 18;
  g.beginPath(); g.moveTo(-10, 300); g.quadraticCurveTo(140, 40, 520, -10); g.moveTo(W + 10, 300); g.quadraticCurveTo(W - 140, 40, W - 520, -10); g.stroke();
  radarScope(ui, sim, P, 300, 960, 108, blink);
  // the warning lights
  const lights = [['MSL', !!sim.threat, COL.red], ['SAM', sim.spiked, COL.amber], ['STALL', P.stalled, COL.amber], ['FUEL', P.lowFuel, COL.amber], ['DMG', P.hp < 50, COL.red], ['AB', P.burner, COL.amber]];
  lights.forEach(([s, on, c], i) => {
    const x = 690 + i * 92, y = 900;
    ui.panel(x, y, 80, 36, { fill: on ? c : '#1b2228', edge: '#33404a', r: 3 });
    ui.text(s, x + 40, y + 25, 17, on ? '#120a06' : '#56636d', { align: 'center', wgt: 700, sp: 1 });
  });
  // fuel and throttle bars
  bar(ui, 690, 960, 540, 'FUEL', P.fuel / 100, P.fuel < 20 ? COL.amber : COL.green, `${Math.round(P.fuel)}%`);
  bar(ui, 690, 1004, 540, 'THR', P.throttle / 1.2, P.burner ? COL.amber : COL.green, P.burner ? 'AB' : `${Math.round(Math.min(1, P.throttle) * 100)}%`);
  bar(ui, 690, 1048, 540, 'HULL', Math.max(0, P.hp) / 100, P.hp < 40 ? COL.red : COL.green, `${Math.max(0, Math.round(P.hp))}%`);
  if (!app.touch?.active) stores(ui, P, 1620, 960); // the touch buttons sit there
}
function bar(ui, x, y, w, label, v, col, txt) {
  ui.text(label, x, y + 6, 16, '#7b8893', { wgt: 700, sp: 2 });
  ui.panel(x + 70, y - 10, w - 160, 18, { fill: '#0b0f13', edge: '#2a333b', r: 3 });
  ui.g.fillStyle = col; ui.g.fillRect(x + 72, y - 8, (w - 164) * Math.max(0, Math.min(1, v)), 14);
  ui.text(txt, x + w, y + 6, 17, col, { align: 'right', wgt: 700 });
}
function stores(ui, P, cx, cy) {
  const g = ui.g;
  ui.panel(cx - 170, cy - 112, 340, 224, { fill: '#061008', edge: '#2a333b', r: 8 });
  // a plan of the jet with its pylons
  g.strokeStyle = COL.greenDim; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, cy - 80); g.lineTo(cx + 70, cy + 30); g.lineTo(cx + 18, cy + 40); g.lineTo(cx + 14, cy + 60); g.lineTo(cx - 14, cy + 60); g.lineTo(cx - 18, cy + 40); g.lineTo(cx - 70, cy + 30); g.closePath(); g.stroke();
  WEAPONS.forEach((w, i) => {
    const sel = P.sel === i, y = cy - 78 + i * 34, n = P.stores[w];
    ui.text(`${sel ? '>' : ' '} ${WEAPON_NAME[w]}`, cx - 154, y, 17, sel ? COL.green : n > 0 ? COL.greenDim : '#2d4a33', { wgt: 700 });
    ui.text(String(n), cx + 154, y, 17, sel ? COL.green : n > 0 ? COL.greenDim : '#2d4a33', { align: 'right', wgt: 700 });
  });
  ui.text(`GUN ${P.gun}`, cx - 154, cy + 78, 17, COL.greenDim, { wgt: 700 });
  ui.text(`CM ${P.decoys}`, cx + 154, cy + 78, 17, P.decoys ? COL.greenDim : COL.amber, { align: 'right', wgt: 700 });
}

/** the radar: heading up, 16 km across the rings, the home field, aircraft and ground units */
export function radarScope(ui, sim, P, cx, cy, R, blink, range = 16000) {
  const g = ui.g;
  g.fillStyle = '#04100a'; g.beginPath(); g.arc(cx, cy, R + 8, 0, TAU); g.fill();
  g.strokeStyle = '#2a333b'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = 'rgba(138,247,164,0.22)'; g.lineWidth = 1.5;
  for (const k of [1 / 3, 2 / 3, 1]) { g.beginPath(); g.arc(cx, cy, R * k, 0, TAU); g.stroke(); }
  const h = headingOf(P.f), c = Math.cos(-h), s = Math.sin(-h);
  const at = p => {
    const dx = p[0] - P.pos[0], dz = p[2] - P.pos[2];
    const x = dx * c - dz * s, z = dx * s + dz * c;
    return [cx + (x / range) * R * 2, cy + (z / range) * R * 2, Math.hypot(x, z) < range / 2];
  };
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
  const home = sim.world.site('home'), [hx, hy] = at([home.x, 0, home.z]);
  ui.text('H', hx, hy + 7, 18, COL.cyan, { align: 'center', wgt: 700 });
  for (const a of sim.actors) {
    if (!a.alive || a === P) continue;
    const [x, y, inside] = at(a.pos);
    if (!inside) continue;
    const col = a.team === 'blue' ? COL.cyan : a === P.target ? COL.red : a.obj ? COL.amber : COL.green;
    g.fillStyle = col;
    if (a.air) {
      const r = headingOf(a.f) - h;
      g.save(); g.translate(x, y); g.rotate(r);
      g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.restore();
    } else if (a.obj) { g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.fill(); }
    else g.fillRect(x - 3, y - 3, 6, 6);
    if (a === P.target) { g.strokeStyle = COL.red; g.lineWidth = 1.5; g.strokeRect(x - 9, y - 9, 18, 18); }
  }
  for (const m of sim.missiles) {
    const [x, y, inside] = at(m.pos);
    if (!inside) continue;
    g.fillStyle = m.tgt === P ? (blink ? COL.red : COL.amber) : '#e6efe9';
    g.fillRect(x - 2, y - 2, 4, 4);
  }
  g.restore();
  g.fillStyle = COL.green;
  g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 6, cy + 6); g.lineTo(cx - 6, cy + 6); g.closePath(); g.fill();
  ui.text(`${range / 2000}`, cx + R - 4, cy + R - 4, 15, COL.greenDim, { align: 'right' });
}

// the chase and target views: plain readouts, the radar small in a corner
function compact(ui, app, P, sim, agl) {
  const hc = COL.green;
  const pan = (x, y, w, h) => ui.panel(x, y, w, h, { fill: 'rgba(4,10,8,0.55)', edge: 'rgba(138,247,164,0.25)', r: 4 });
  pan(40, 900, 520, 140);
  ui.text(`${Math.round(P.speed * KT)} KT`, 64, 948, 30, hc, { wgt: 700 });
  ui.text(`${Math.round(P.pos[1] * FT / 10) * 10} FT`, 300, 948, 30, hc, { wgt: 700 });
  ui.text(P.burner ? 'AB' : `THR ${Math.round(Math.min(1, P.throttle) * 100)}%`, 64, 990, 20, P.burner ? COL.amber : hc, { wgt: 600 });
  ui.text(`R ${Math.max(0, Math.round(agl * FT / 10) * 10)}`, 300, 990, 20, agl < 100 ? COL.amber : hc, { wgt: 600 });
  ui.text(`FUEL ${Math.round(P.fuel)}%   HULL ${Math.max(0, Math.round(P.hp))}%`, 64, 1024, 18, P.lowFuel || P.hp < 40 ? COL.amber : COL.greenDim, { wgt: 600, sp: 1 });
  pan(W - 560, 900, 520, 140);
  const w = WEAPONS[P.sel];
  ui.text(`${WEAPON_NAME[w]} ${P.stores[w]}`, W - 536, 948, 28, hc, { wgt: 700 });
  ui.text(`GUN ${P.gun}   CM ${P.decoys}`, W - 536, 990, 20, hc, { wgt: 600 });
  const lock = P.irLock || P.radarLock;
  ui.text(lock ? 'LOCK' : sim.lockState === 'seek' ? 'SEEK' : '', W - 64, 948, 26, lock ? COL.red : hc, { align: 'right', wgt: 700, sp: 2 });
  ui.text(app.view === 'target' ? 'TARGET VIEW' : 'CHASE VIEW', W - 64, 1024, 16, COL.greenDim, { align: 'right', wgt: 600, sp: 2 });
  radarScope(ui, sim, P, 120, 790, 70, Math.floor(app.t * 3) % 2 === 0);
  if (P.stalled && P.speed < STALL) void 0;
}

function objective(ui, app, sim, V) {
  const M = MISSIONS[sim.mi], o = sim.objectives();
  const x = 40, y = 30, cockpit = app.view === 'cockpit' && sim.player.alive;
  ui.panel(x, y, 470, sim.complete ? 104 : 80, { fill: 'rgba(4,10,8,0.5)', edge: 'rgba(138,247,164,0.2)', r: 4 });
  ui.text(`${String(sim.mi + 1).padStart(2, '0')}  ${M.name.toUpperCase()}`, x + 18, y + 30, 20, COL.ink, { wgt: 700, sp: 2 });
  const done = o.pct ? `${o.done}%` : `${o.done}/${o.total}`;
  ui.text(`${M.text}`, x + 18, y + 58, 17, sim.complete ? COL.green : COL.dim, { wgt: 500 });
  ui.text(done, x + 452, y + 30, 20, sim.complete ? COL.green : COL.amber, { align: 'right', wgt: 700 });
  if (sim.complete) {
    const home = sim.world.site('home'), P = sim.player;
    const d = Math.hypot(home.x - P.pos[0], home.z - P.pos[2]) / 1000;
    ui.text(`RTB  ${home.label.toUpperCase()}  ${d.toFixed(1)} KM`, x + 18, y + 88, 17, COL.cyan, { wgt: 700, sp: 1 });
    // the runway on the HUD
    const s = V.project([home.runway.x, home.y + 5, home.runway.z]);
    if (s && s.x > 0 && s.x < W && s.y > 0 && s.y < H) {
      ui.line([s.x - 18, s.y, s.x, s.y - 12, s.x + 18, s.y, s.x, s.y + 12, s.x - 18, s.y], COL.cyan, 2);
      ui.text('HOME', s.x, s.y + 32, 15, COL.cyan, { align: 'center', wgt: 700, sp: 2 });
    }
  }
  ui.text(`${fmt(app.camp.score + sim.score)}`, W - 40, 58, 28, COL.ink, { align: 'right', wgt: 700, sp: 1 });
  ui.text(`SCORE  ·  AIRFRAMES ${app.camp.airframes}`, W - 40, 82, 15, COL.dim, { align: 'right', wgt: 600, sp: 2 });
  void cockpit;
}

function touchPads(ui, app) {
  const g = ui.g, u = ui.u, P = pads(W * u, H * u), k = 1 / u;
  const T = app.touch;
  g.lineWidth = 3;
  for (const name of ['gun', 'fire', 'weapon', 'target', 'decoy', 'view', 'pause']) {
    const b = P[name], on = T.held?.[name];
    g.beginPath(); g.arc(b.x * k, b.y * k, b.r * k, 0, TAU);
    g.fillStyle = on ? 'rgba(138,247,164,0.35)' : 'rgba(10,20,16,0.35)'; g.fill();
    g.strokeStyle = 'rgba(138,247,164,0.6)'; g.stroke();
    ui.text(b.label, b.x * k, b.y * k + 8, name === 'gun' ? 28 : 20, COL.green, { align: 'center', wgt: 700, sp: 1 });
  }
  const S = P.slider, x = S.x * k, y0 = S.y0 * k, y1 = S.y1 * k, w = S.w * k;
  ui.panel(x - w / 2, y1, w, y0 - y1, { fill: 'rgba(10,20,16,0.35)', edge: 'rgba(138,247,164,0.5)', r: 10 });
  const ab = y0 - (y0 - y1) / THROTTLE_MAX;
  ui.line([x - w / 2, ab, x + w / 2, ab], COL.amber, 2);
  const thr = app.sim.player.throttle, ty = y0 - (y0 - y1) * (thr / THROTTLE_MAX);
  ui.panel(x - w / 2 - 6, ty - 12, w + 12, 24, { fill: thr > 1 ? COL.amber : COL.green, edge: null, r: 6 });
  ui.text('THR', x, y0 + 30, 17, COL.green, { align: 'center', wgt: 700 });
  if (T.stick) {
    const sx = T.stick.x0 * k, sy = T.stick.y0 * k, R = P.stickR * k;
    g.beginPath(); g.arc(sx, sy, R, 0, TAU); g.strokeStyle = 'rgba(138,247,164,0.45)'; g.stroke();
    let dx = T.stick.x * k - sx, dy = T.stick.y * k - sy;
    const L = Math.hypot(dx, dy);
    if (L > R) { dx *= R / L; dy *= R / L; }
    g.beginPath(); g.arc(sx + dx, sy + dy, 40, 0, TAU); g.fillStyle = 'rgba(138,247,164,0.35)'; g.fill();
  } else ui.text('DRAG TO FLY', 300, 760, 20, 'rgba(138,247,164,0.5)', { align: 'center', wgt: 700, sp: 3 });
}
