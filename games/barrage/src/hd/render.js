// The HD renderer: the battlefield and the app's screens as lit vectors at the window's own
// resolution, 16:9. Everything is laid out in a 1920 × 1080 reference frame; one sim cell is
// 1.5 reference units. The ground and the sky are cached images (field.js), so a frame is two
// blits, the tanks, what is in the air, the effects and the HUD. It only reads state.
//
//   const view = createHdRenderer(canvas, app);
//   view.events(sim.events, sim);  view.draw(app);  view.hit(x, y, app) → touch target;  view.toCell(x, y)
import { fitWide } from '@nostalgia/game/runtime';
import { AI_LEVELS, BARREL, H, PIVOT, THEMES, W, maxPower } from '../sim.js';
import { WEAPON } from '../weapons.js';
import { cloudSprite, createGround, glow, paintSky, rgb } from './field.js';
import { createFx } from './fx.js';
import { BACK, BTN, DRIVE, HUD, PAD, REF_H, REF_W, SHOP_BTN, TRAY_CLOSE, WEAPON_CHIP, finalRect, goodRect, inside, menuRect, near, pauseRect, setupRect, trayRect } from './layout.js';
import { createScreens } from './screens.js';
import { THEME } from './themes.js';
import { drawGlider, drawShield, drawTank } from './tank.js';
import { F, TAU, createUi, money } from './ui.js';

const K = REF_W / W; // reference units per cell

export function createHdRenderer(cv, app) {
  const g = cv.getContext('2d');
  let cw = 1, ch = 1, u = 1, destroyed = false, lastApp = null;
  const ground = createGround(), fx = createFx(), ui = createUi(g);
  let sky = null, skyKey = '', fieldCols = null, clouds = [];
  const trails = new Map(), ghosts = new Map(), travel = new Map(), recoil = new Map();
  let themeId = 'dusk';
  const screens = createScreens(g, ui, { drawField: (a, t) => drawField(a, t), hud: (a, t) => hud(a, t) });

  function fit(w, h) {
    cw = w; ch = h; u = ch / REF_H;
    sky = null;
    if (lastApp) draw(lastApp);
  }
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });
  const ref = (sx = 0, sy = 0) => g.setTransform(u, 0, 0, u, sx * u, sy * u);

  // ---------- a new field: theme, sky, clouds ----------
  function newField(sim) {
    fieldCols = sim.terrain.cols;
    themeId = THEMES[sim.theme] ?? 'dusk';
    ground.setTheme(themeId);
    sky = null;
    trails.clear(); ghosts.clear(); travel.clear(); recoil.clear();
    fx.clear();
    const T = THEME[themeId];
    clouds = Array.from({ length: 5 }, (_, i) => ({ x: Math.random() * 2400 - 240, y: 70 + Math.random() * 300, s: 0.6 + Math.random() * 0.9, img: cloudSprite(T.cloud, i * 977 + sim.round), a: 0.25 + Math.random() * 0.35 }));
  }
  const groundCols = () => { const G = THEME[themeId].ground; return [rgb(G.rim), rgb(G.top), rgb(G.mid), rgb(G.top, 0.8)]; };

  // ---------- events → effects ----------
  function events(list, sim) {
    if (sim.terrain.cols !== fieldCols) newField(sim);
    for (const e of list) {
      const x = (e.x ?? 0) * K, y = (e.y ?? 0) * K;
      switch (e.type) {
        case 'boom': {
          const col = e.kind === 'death' ? '#ff7a3a' : WEAPON[e.w]?.col ?? '#ffb060';
          fx.boom(x, y, e.r * K, e.kind, col.length === 7 ? col : '#ff9a4a', e.kind === 'ion' ? null : groundCols());
          if (e.kind !== 'ion') ground.burn(e.x, e.y, e.r, e.kind === 'death' ? 1.2 : 1);
          break;
        }
        case 'heap':
          fx.spray(x, y, 30, { cols: groundCols(), speed: 260, life: 1, size: 7, grav: 900, kind: 'debris' });
          fx.shake = Math.min(20, fx.shake + 6);
          break;
        case 'hit':
          if (e.cause === 'fire') fx.tally('burn' + e.tank, x, y - 20, e.dmg, n => `-${n}`, '#ffb35a', 28);
          else fx.pop(x, y - 20, `-${e.dmg}`, e.cause === 'fall' ? '#ffd9a0' : '#ff6b74', 30 + Math.min(20, e.dmg * 0.4));
          break;
        case 'shield': {
          const t = sim.tanks[e.tank];
          fx.spray(x, y, e.cause === 'fire' ? 2 : 16, { cols: ['#ffffff', '#9fe0ff'], speed: 280, life: 0.5, size: 4, grav: 0, kind: 'spark', drag: 3 });
          if (e.absorbed) fx.tally('shield' + e.tank, x, y - 50, e.absorbed, n => `-${n}`, '#8fd8ff', 26);
          if (e.down) fx.pop(t.x * K, t.y * K - 80, 'SHIELD DOWN', '#8fd8ff', 24);
          break;
        }
        case 'cash': if (e.amount > 0) fx.tally('cash' + e.player, x + 30, y - 40, e.amount, n => '+' + money(n), '#ffe08a', 24); break;
        case 'fire': {
          const a = (-e.angle * Math.PI) / 180;
          fx.spray(x, y, 14, { cols: ['#ffffff', '#fff0b0', '#ffb050'], dir: a, spread: 0.7, speed: 420, life: 0.3, size: 4, grav: 0, kind: 'spark', drag: 6 });
          for (let k = 0; k < 4; k++) fx.part({ x, y, vx: Math.cos(a) * 60 + (Math.random() - 0.5) * 40, vy: Math.sin(a) * 60 - 20, life: 1.2, max: 1.4, size: 14 + k * 4, col: '#6a6068', grav: -10, kind: 'smoke', drag: 1 });
          recoil.set(e.tank, 1);
          fx.shake = Math.min(28, fx.shake + 3);
          break;
        }
        case 'death': {
          const t = sim.tanks[e.tank], col = app.colors[sim.players[t.p].color];
          fx.spray(x, y, 26, { cols: [col, '#2a2630', '#4a4450'], speed: 520, life: 1.6, size: 8, grav: 1100, lift: 260, kind: 'debris', drag: 0.4 });
          break;
        }
        case 'kill': { const t = sim.tanks[e.tank]; fx.pop(t.x * K, t.y * K - 90, 'DESTROYED', '#ffffff', 30); break; }
        case 'land': if (e.dist > 6) fx.spray(x, y, 10, { cols: groundCols(), speed: 160, life: 0.7, size: 5, grav: 700, dir: -Math.PI / 2, spread: 2.4, kind: 'debris' }); break;
        case 'blink':
          for (const p of [e.from, e.to]) fx.spray(p.x * K, (p.y - 6) * K, 30, { cols: ['#ffffff', '#ff9cf0', '#b28aff'], speed: 300, life: 0.8, size: 5, grav: 0, kind: 'spark', drag: 2 });
          trails.clear();
          break;
        case 'shieldUp': case 'patch': {
          const t = sim.tanks[e.tank];
          fx.spray(t.x * K, (t.y - 6) * K, 24, { cols: e.type === 'patch' ? ['#7dff9a', '#ffffff'] : ['#8fd8ff', '#ffffff'], speed: 220, life: 0.7, size: 4, grav: -100, kind: 'spark', drag: 2 });
          if (e.type === 'patch') fx.pop(t.x * K, t.y * K - 60, '+ARMOUR', '#7dff9a', 26);
          break;
        }
        case 'beam': fx.beam(e.pts.map(p => ({ x: p.x * K, y: p.y * K, cut: p.cut })), '#7affea'); break;
        case 'skip': case 'bounce': case 'split': fx.spray(x, y, 10, { cols: ['#ffffff', '#cfe6ff'], speed: 240, life: 0.4, size: 3, grav: 200, kind: 'spark', drag: 3 }); break;
        case 'spill': fx.spray(x, y, 24, { cols: ['#ffd060', '#ff8a2a', '#ff4a10'], speed: 300, life: 0.7, size: 5, grav: 500, kind: 'spark', drag: 1.5 }); break;
        case 'drive': if (Math.random() < 0.3) { const t = sim.tanks[e.tank]; fx.spray(t.x * K, t.y * K, 2, { cols: groundCols(), speed: 80, life: 0.5, size: 3, grav: 400, dir: -Math.PI / 2, spread: 2, kind: 'debris' }); } break;
        case 'wrap': for (const tr of trails.values()) tr.pts.push(null); break;
      }
    }
  }

  // ---------- the field ----------
  let lastT = 0, DTF = 1 / 60;
  function trailsUpdate(sim, dt) {
    const live = new Set();
    for (const p of sim.projectiles) {
      live.add(p.id);
      let tr = trails.get(p.id);
      if (!tr) { tr = { pts: [], col: WEAPON[p.w]?.col ?? '#ffffff', owner: p.owner, gen: p.gen, fade: 1 }; trails.set(p.id, tr); }
      const last = tr.pts[tr.pts.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 3) tr.pts.push({ x: p.x, y: p.y });
      if (tr.pts.length > 420) tr.pts.shift();
    }
    for (const [id, tr] of trails) {
      if (live.has(id)) continue;
      if (tr.fade === 1 && tr.gen === 0 && tr.pts.length > 3) ghosts.set(tr.owner, tr.pts.slice());
      tr.fade -= dt * 1.4;
      if (tr.fade <= 0) trails.delete(id);
    }
  }
  function strokePts(pts) {
    g.beginPath();
    let pen = false;
    for (const p of pts) {
      if (!p) { pen = false; continue; }
      if (pen) g.lineTo(p.x, p.y); else { g.moveTo(p.x, p.y); pen = true; }
    }
    g.stroke();
  }
  function drawField(app, t) {
    const sim = app.sim;
    if (sim.terrain.cols !== fieldCols) newField(sim);
    ground.update(sim.terrain);
    trailsUpdate(sim, DTF);
    const T = THEME[themeId];
    const sx = (Math.random() - 0.5) * fx.shake, sy = (Math.random() - 0.5) * fx.shake;
    const key = themeId + ':' + cw + 'x' + ch + ':' + sim.round;
    if (!sky || skyKey !== key) { sky = paintSky(themeId, cw, ch, sim.round * 31 + 7); skyKey = key; }
    g.setTransform(1, 0, 0, 1, sx * u * 0.4, sy * u * 0.4);
    g.drawImage(sky, 0, 0);
    ref(sx * 0.6, sy * 0.6);
    // clouds drift with the wind
    for (const c of clouds) {
      c.x += (sim.wind * 0.9 + 4) * c.s * DTF;
      if (c.x > 2200) c.x = -500; else if (c.x < -520) c.x = 2180;
      g.globalAlpha = c.a; g.drawImage(c.img, c.x, c.y, 512 * c.s, 200 * c.s);
    }
    g.globalAlpha = 1;
    if (T.embers && Math.random() < 0.5) fx.part({ x: Math.random() * 1920, y: 1100, vx: (sim.wind + (Math.random() - 0.5) * 20) * 2, vy: -60 - Math.random() * 80, life: 5, max: 5, size: 2 + Math.random() * 2, col: '#ff7a30', grav: -6, kind: 'ember', drag: 0.1 });
    ref(sx, sy);
    fx.drawBack(g);
    g.imageSmoothingEnabled = true;
    g.drawImage(ground.cv, 0, 0, W, H, 0, 0, REF_W, REF_H);
    // world in cells
    g.save();
    g.scale(K, K);
    // islands sit in a sea (lava under ash)
    if (sim.sea) {
      const sea = T.sea, wy = sim.sea;
      const sg = g.createLinearGradient(0, wy, 0, H);
      sg.addColorStop(0, `rgba(${sea[0]},${sea[1]},${sea[2]},0.62)`); sg.addColorStop(1, `rgba(${sea[0] >> 2},${sea[1] >> 2},${sea[2] >> 2},0.92)`);
      g.fillStyle = sg;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, wy + Math.sin(x * 0.03 + t * 1.6) * 2 + Math.sin(x * 0.011 - t) * 1.5);
      g.lineTo(W, H); g.closePath(); g.fill();
      g.strokeStyle = `rgba(255,255,255,0.35)`; g.lineWidth = 1; g.stroke();
    }
    drawTanks(app, sim, t);
    drawAir(sim, t);
    g.restore();
    fx.drawFront(g);
    labels(app, sim, t);
    fx.drawPops(g, F);
    if (fx.flash > 0) { g.globalAlpha = Math.min(0.75, fx.flash); g.fillStyle = fx.flashCol; g.fillRect(-40, -40, REF_W + 80, REF_H + 80); g.globalAlpha = 1; }
    ref();
  }
  function drawTanks(app, sim, t) {
    const cur = sim.tank;
    // the last shot's arc, faint, while a person aims
    const human = sim.phase === 'aim' && cur && !sim.players[cur.p].ai && app.state === 'play' && !app.attract;
    if (human && ghosts.has(cur.i)) {
      g.setLineDash([3, 5]); g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1.2;
      strokePts(ghosts.get(cur.i));
      g.setLineDash([]);
    }
    for (const tk of sim.tanks) {
      if (tk.exploded) continue;
      const prev = travel.get(tk.i) ?? { x: tk.x, d: 0 };
      prev.d += tk.x - prev.x; prev.x = tk.x;
      travel.set(tk.i, prev);
      const col = app.colors[sim.players[tk.p].color] ?? '#cccccc';
      const rc = recoil.get(tk.i) ?? 0;
      if (rc > 0) recoil.set(tk.i, Math.max(0, rc - DTF * 4));
      const a = (tk.angle * Math.PI) / 180;
      g.save();
      if (rc) g.translate(-Math.cos(a) * rc * 2, Math.sin(a) * rc * 1);
      drawTank(g, tk, { col, time: t, travel: prev.d, wreck: tk.hp <= 0 });
      g.restore();
      if (tk.hp <= 0 && Math.random() < 0.3) fx.part({ x: tk.x * K, y: (tk.y - 10) * K, vx: (Math.random() - 0.5) * 30, vy: -60, life: 1.6, max: 1.6, size: 12, col: '#2a2428', grav: -20, kind: 'smoke', drag: 0.5 });
      if (tk.shield) drawShield(g, tk, t);
      if (tk.gliding) drawGlider(g, tk, t);
    }
    // aim line
    if (human && !app.tray.open && !app.driving) {
      const a = (cur.angle * Math.PI) / 180, x0 = cur.x + Math.cos(a) * BARREL, y0 = cur.y - PIVOT - Math.sin(a) * BARREL;
      const len = 14 + cur.power * 0.06;
      g.setLineDash([2, 3]); g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * len, y0 - Math.sin(a) * len); g.stroke();
      g.setLineDash([]);
    }
  }
  function drawAir(sim, t) {
    // trails
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const tr of trails.values()) {
      g.strokeStyle = tr.col; g.globalAlpha = 0.5 * tr.fade; g.lineWidth = 1.4;
      strokePts(tr.pts.slice(-160));
    }
    g.globalAlpha = 1;
    for (const p of sim.projectiles) {
      const col = WEAPON[p.w]?.col ?? '#ffffff';
      if (p.mode === 'roll') {
        const r = 5;
        g.save(); g.translate(p.x, p.y - r); g.rotate(p.x / r);
        const bg = g.createRadialGradient(-1.5, -1.5, 0.5, 0, 0, r);
        bg.addColorStop(0, '#f0e0c0'); bg.addColorStop(1, '#6a5640');
        g.fillStyle = bg; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(40,30,20,0.6)'; g.lineWidth = 0.6;
        g.beginPath(); g.moveTo(-3, -1); g.lineTo(1, 1); g.lineTo(3, -2); g.stroke();
        g.restore();
        continue;
      }
      if (p.mode === 'drill') {
        g.save(); g.translate(p.x, p.y); g.rotate(Math.atan2(p.dy, p.dx));
        g.fillStyle = '#c0ffd0'; g.beginPath(); g.moveTo(6, 0); g.lineTo(-3, -3); g.lineTo(-3, 3); g.closePath(); g.fill();
        g.restore();
        glow(g, '#c0ffd0', p.x, p.y, 8, 0.6);
        if (Math.random() < 0.5) fx.part({ x: p.x * K, y: p.y * K, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 200, life: 0.4, max: 0.4, size: 3, col: '#ffe8b0', grav: 600, kind: 'spark', drag: 1 });
        continue;
      }
      const big = WEAPON[p.w]?.big, r = p.gen ? 1.6 : big ? 3.4 : 2.4;
      glow(g, col.length === 7 ? col : '#ffffff', p.x, p.y, r * 5, 0.8);
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(p.x, p.y, r * 0.7, 0, TAU); g.fill();
      if (p.kind === 'seek') { g.strokeStyle = col; g.lineWidth = 0.8; g.beginPath(); g.arc(p.x, p.y, r * 2 + Math.sin(t * 20) * 0.6, 0, TAU); g.stroke(); }
    }
    // burning gel
    if (sim.flames.length) {
      for (const f of sim.flames) {
        const life = 1 - f.t / f.life, fl = 0.7 + 0.3 * Math.sin(t * 23 + f.x * 1.7);
        const r = (4 + 4 * life) * fl;
        glow(g, '#ff6a1a', f.x, f.y - 2, r * 2.2, 0.55 * life + 0.2);
        glow(g, '#ffd060', f.x, f.y - 2.5, r * 0.9, 0.8 * life);
      }
      const n = Math.min(4, Math.ceil(sim.flames.length / 12));
      for (let k = 0; k < n; k++) {
        const f = sim.flames[(Math.random() * sim.flames.length) | 0];
        fx.part({ x: f.x * K, y: (f.y - 4) * K, vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 60, life: 1.4, max: 1.6, size: 10 + Math.random() * 8, col: '#3a2a26', grav: -10, kind: 'smoke', drag: 0.6 });
        if (Math.random() < 0.6) fx.part({ x: f.x * K, y: (f.y - 4) * K, vx: (Math.random() - 0.5) * 60, vy: -80 - Math.random() * 100, life: 0.8, max: 0.8, size: 2.4, col: '#ffb040', grav: -20, kind: 'ember', drag: 0.4 });
        if (Math.random() < 0.15) ground.burn(f.x, f.y + 2, 3, 0.5);
      }
    }
  }
  function labels(app, sim, t) {
    const cur = sim.tank;
    for (const tk of sim.tanks) {
      if (tk.exploded) continue;
      const x = tk.x * K, y = tk.y * K;
      // armour bar
      const w = 46, k = Math.max(0, tk.hp) / 100;
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.roundRect(x - w / 2 - 2, y + 7, w + 4, 9, 4); g.fill();
      g.fillStyle = k > 0.55 ? '#6ef08a' : k > 0.28 ? '#ffd23f' : '#ff5a5f';
      if (k > 0) { g.beginPath(); g.roundRect(x - w / 2, y + 9, w * k, 5, 2.5); g.fill(); }
      if (tk.shield) { g.fillStyle = '#8fd8ff'; g.fillRect(x - w / 2, y + 16, w * Math.min(1, tk.shield.hp / 100), 2); }
    }
    if (cur && cur.alive && (sim.phase === 'aim') && app.state !== 'title') {
      const P = sim.players[cur.p], col = app.colors[P.color], x = cur.x * K, y = cur.y * K - 62 + Math.sin(t * 5) * 4;
      ui.outlined(P.name, x, y - 22, 24, col, 'rgba(6,4,12,0.9)', 6);
      g.fillStyle = col;
      g.beginPath(); g.moveTo(x - 10, y - 6); g.lineTo(x + 10, y - 6); g.lineTo(x, y + 6); g.closePath(); g.fill();
      glow(g, col.length === 7 ? col : '#ffffff', x, y, 26, 0.4);
    }
  }

  // ---------- HUD ----------
  function hud(app, t) {
    const sim = app.sim, tk = sim.tank;
    if (!tk) return;
    const P = sim.players[tk.p], col = app.colors[P.color], kb = app.input.device.kind;
    ui.panel(HUD.x, HUD.y, HUD.w, HUD.h, 22, 0.66);
    // who
    g.fillStyle = col; g.beginPath(); g.arc(62, 48, 14, 0, TAU); g.fill();
    glow(g, col, 62, 48, 30, 0.35);
    ui.fit(P.name.toUpperCase(), 88, 60, 32, '#ffffff', 300, 700, 'left', 2);
    ui.label(`ROUND ${sim.round}/${sim.setup.rounds} · ${money(P.cash)}${P.ai ? ' · ' + AI_LEVELS[P.ai].toUpperCase() : ''}`, 88, 88, 18, 'rgba(255,255,255,0.62)', 600, 'left', 1);
    // angle
    const elev = tk.angle <= 90 ? tk.angle : 180 - tk.angle;
    ui.label('ANGLE', 470, 42, 16, 'rgba(255,255,255,0.55)', 600, 'left', 3);
    ui.label(`${elev.toFixed(0)}°`, 470, 88, 40, '#ffffff', 700);
    ui.label(tk.angle > 90.5 ? '◀' : tk.angle < 89.5 ? '▶' : '▲', 560, 86, 26, THEME[themeId].accent, 700);
    // power
    const mp = maxPower(tk);
    ui.label('POWER', 640, 42, 16, 'rgba(255,255,255,0.55)', 600, 'left', 3);
    ui.label(String(Math.round(tk.power)), 1140, 42, 22, '#ffffff', 700, 'right');
    const bx = 640, by = 60, bw = 500, bh = 20;
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.roundRect(bx, by, bw, bh, 10); g.fill();
    g.fillStyle = 'rgba(255,80,90,0.25)'; g.beginPath(); g.roundRect(bx + (bw * mp) / 1000, by, bw * (1 - mp / 1000), bh, [0, 10, 10, 0]); g.fill();
    const pg = g.createLinearGradient(bx, 0, bx + bw, 0);
    pg.addColorStop(0, '#4cb4ff'); pg.addColorStop(0.55, '#ffd23f'); pg.addColorStop(1, '#ff5a5f');
    g.fillStyle = pg; g.beginPath(); g.roundRect(bx, by, Math.max(bh, (bw * tk.power) / 1000), bh, 10); g.fill();
    // weapon
    const w = WEAPON[tk.weapon], n = w.id === 'pellet' ? '∞' : '×' + (P.inv[w.id] ?? 0);
    const R = WEAPON_CHIP;
    ui.chip(R.x, R.y, R.w, R.h, true, w.col);
    glow(g, w.col, R.x + 40, R.y + 36, 28, 0.7);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(R.x + 40, R.y + 36, 7, 0, TAU); g.fill();
    ui.fit(w.name.toUpperCase(), R.x + 70, R.y + 47, 30, '#ffffff', 230, 700, 'left', 2);
    ui.label(n, R.x + R.w - 18, R.y + 47, 28, w.col, 700, 'right');
    // wind and walls
    const wx = 1700, wl = Math.min(1, Math.abs(sim.wind) / 50) * 80;
    ui.label('WIND', 1620, 42, 16, 'rgba(255,255,255,0.55)', 600, 'left', 3);
    ui.label(sim.wind ? String(Math.abs(sim.wind)) : 'CALM', 1880, 42, 20, '#ffffff', 700, 'right');
    if (sim.wind) {
      const d = Math.sign(sim.wind), x0 = wx + 60 - (d * wl) / 2, x1 = wx + 60 + (d * wl) / 2;
      g.strokeStyle = '#9fe8ff'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, 70); g.lineTo(x1, 70); g.stroke();
      g.fillStyle = '#9fe8ff'; g.beginPath(); g.moveTo(x1 + d * 12, 70); g.lineTo(x1 - d * 4, 60); g.lineTo(x1 - d * 4, 80); g.closePath(); g.fill();
    }
    ui.label(`WALLS: ${sim.walls.toUpperCase()}`, 1880, 94, 15, 'rgba(255,255,255,0.5)', 600, 'right', 2);
    // buttons for pointer players during a person's turn
    const human = sim.phase === 'aim' && !P.ai && app.state === 'play';
    ui.chip(BTN.pause.x, BTN.pause.y, BTN.pause.w, BTN.pause.h, false);
    g.fillStyle = '#ffffff'; g.fillRect(BTN.pause.x + 19, BTN.pause.y + 14, 7, 22); g.fillRect(BTN.pause.x + 32, BTN.pause.y + 14, 7, 22);
    if (human && !app.touch?.active) {
      ui.chip(BTN.gear.x, BTN.gear.y, BTN.gear.w, BTN.gear.h, app.tray.open, '#8fd8ff');
      ui.label('GEAR', BTN.gear.x + BTN.gear.w / 2, BTN.gear.y + 34, 22, '#ffffff', 700, 'center', 2);
      ui.chip(BTN.fire.x, BTN.fire.y, BTN.fire.w, BTN.fire.h, true, '#ff6b5a');
      ui.label('FIRE', BTN.fire.x + BTN.fire.w / 2, BTN.fire.y + 34, 22, '#ffb0a0', 700, 'center', 3);
    }
    if (human && kb === 'keyboard' && app.stT > 0.2 && !app.touch?.active && !app.tray.open && !app.driving) {
      ui.legend(app.input, [[['aim', 'ANGLE'], ['power', 'POWER'], ['coarse', 'BIG STEPS'], ['fire', 'FIRE'], ['next', 'WEAPON'], ['items', 'GEAR'], ['move', 'DRIVE']]], 960, 1046, 40, 18);
    } else if (human && kb === 'gamepad' && !app.tray.open && !app.driving) {
      ui.legend(app.input, [[['aim', 'ANGLE'], ['power', 'POWER'], ['coarse', 'BIG STEPS'], ['fire', 'FIRE'], ['next', 'WEAPON'], ['items', 'GEAR'], ['drive', 'HOLD + ◀▶ DRIVE']]], 960, 1046, 40, 18);
    }
    if (human) overlays(app, t);
  }
  function overlays(app, t) {
    const sim = app.sim, tk = sim.tank, P = sim.players[tk.p];
    if (app.tray.open) {
      const items = app.trayItems();
      items.forEach((it, i) => {
        const R = trayRect(i, items.length), on = i === app.tray.sel;
        ui.panel(R.x, R.y, R.w, R.h, 18, on ? 0.9 : 0.75, on ? it.col : 'rgba(255,255,255,0.18)');
        glow(g, it.col, R.x + 34, R.y + 36, 24, on ? 0.9 : 0.5);
        g.fillStyle = '#ffffff'; g.beginPath(); g.arc(R.x + 34, R.y + 36, 6, 0, TAU); g.fill();
        ui.fit(it.name.toUpperCase(), R.x + 60, R.y + 46, 24, '#ffffff', R.w - 70, 700, 'left', 1);
        const sub = it.kind === 'fuel' ? `DRIVE · FUEL ${Math.round(tk.fuel)} +${it.n}` : `×${it.n}`;
        ui.label(sub, R.x + 60, R.y + 78, 18, on ? it.col : 'rgba(255,255,255,0.6)', 600, 'left', 1);
      });
      ui.chip(TRAY_CLOSE.x, TRAY_CLOSE.y, TRAY_CLOSE.w, TRAY_CLOSE.h, false);
      ui.label('✕', TRAY_CLOSE.x + 30, TRAY_CLOSE.y + 41, 30, '#ffffff', 700, 'center');
      const it = items[app.tray.sel];
      if (it) ui.label(it.blurb, 960, 318, 22, 'rgba(255,255,255,0.8)', 500, 'center');
      ui.prompt(app.input, '{change} CHOOSE · {fire} USE · {items} CLOSE', 960, 360, 20, 'rgba(255,255,255,0.75)', 'center');
    } else if (app.driving) {
      ui.panel(700, 170, 520, 90, 20, 0.8, '#ffcf5a');
      ui.label(`DRIVING · FUEL ${Math.round(tk.fuel)} · CELLS ${P.inv.fuel ?? 0}`, 960, 210, 26, '#ffcf5a', 700, 'center', 2);
      ui.prompt(app.input, '{aim} MOVE · {fire} DONE', 960, 240, 20, 'rgba(255,255,255,0.8)', 'center');
    }
    if (app.touch?.active) touchPad(app, t);
  }
  function roundBtn(C, text, on, col = '#ffffff', size = 34) {
    g.fillStyle = on ? 'rgba(255,255,255,0.32)' : 'rgba(10,8,20,0.45)';
    g.beginPath(); g.arc(C.x, C.y, C.r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 3; g.stroke();
    ui.label(text, C.x, C.y + size * 0.36, size, col, 700, 'center', 1);
  }
  function touchPad(app) {
    const held = new Set();
    for (const p of app.touch.ptrs.values()) { const h = hit(p.x, p.y, app); if (h) held.add(h.act); }
    if (app.driving) {
      roundBtn(DRIVE.driveL, '◀', held.has('driveL'));
      roundBtn(DRIVE.driveR, '▶', held.has('driveR'));
      const R = DRIVE.driveDone;
      ui.chip(R.x, R.y, R.w, R.h, true, '#ffcf5a');
      ui.label('DONE', R.x + R.w / 2, R.y + 52, 30, '#ffffff', 700, 'center', 2);
      return;
    }
    if (app.tray.open) return;
    roundBtn(PAD.angleL, '↶', held.has('angleL'));
    roundBtn(PAD.angleR, '↷', held.has('angleR'));
    roundBtn(PAD.powerUp, '+', held.has('powerUp'), '#ffd23f', 44);
    roundBtn(PAD.powerDown, '−', held.has('powerDown'), '#ffd23f', 44);
    roundBtn(PAD.gear, 'GEAR', app.tray.open, '#8fd8ff', 22);
    glow(g, '#ff5a3a', PAD.fire.x, PAD.fire.y, PAD.fire.r * 1.6, 0.4);
    roundBtn(PAD.fire, 'FIRE', held.has('fire'), '#ffd0c0', 40);
    ui.label('DRAG ON THE FIELD TO AIM', 960, 1050, 20, 'rgba(255,255,255,0.55)', 600, 'center', 3);
  }

  // ---------- frame ----------
  function draw(app) {
    lastApp = app;
    const t = app.t, dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    DTF = dt;
    fx.step(dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    screens.draw(app, t);
    ref();
    if (app.demo) ui.label('DEMO', 1880, 1060, 26, `rgba(255,255,255,${0.35 + 0.25 * Math.sin(t * 3)})`, 700, 'right', 6);
    if (app.fade > 0) { g.globalAlpha = Math.min(1, app.fade); g.fillStyle = '#000'; g.fillRect(0, 0, REF_W, REF_H); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  const unfit = fitWide(cv, { onFit: fit });

  // ---------- pointer targets (canvas pixels in) ----------
  function hit(px, py, app) {
    const x = px / u, y = py / u, sim = app.sim;
    switch (app.state) {
      case 'title': { const items = app.titleItems(), i = items.findIndex((_, k) => inside(menuRect(k, items.length), x, y)); return i >= 0 ? { act: 'menu', i } : null; }
      case 'manual': return inside(BACK, x, y) ? { act: 'back' } : { act: 'page' };
      case 'setup': {
        if (inside(BACK, x, y)) return { act: 'back' };
        const rows = app.setupRows();
        for (let i = 0; i < rows.length; i++) {
          const R = setupRect(app, i);
          if (!inside(R, x, y)) continue;
          if (rows[i] === 'start') return { act: 'setupRow', row: i, dir: 0 };
          const v = R.x + R.w * (rows[i].startsWith('p') ? 0.55 : 0.5);
          if (x < v) return { act: 'setupRow', row: i, dir: 0 };
          return { act: 'setupRow', row: i, dir: x < (v + R.x + R.w) / 2 ? -1 : 1 };
        }
        return null;
      }
      case 'play': {
        if (inside(BTN.pause, x, y)) return { act: 'pause' };
        const tk = sim.tank;
        if (!tk || sim.phase !== 'aim' || sim.players[tk.p].ai) return null;
        if (app.tray.open) {
          const items = app.trayItems();
          for (let i = 0; i < items.length; i++) if (inside(trayRect(i, items.length), x, y)) return { act: 'trayItem', i };
          if (inside(TRAY_CLOSE, x, y)) return { act: 'trayClose' };
          return { act: 'trayClose' };
        }
        if (app.driving) {
          if (near(DRIVE.driveL, x, y, 1.2)) return { act: 'driveL' };
          if (near(DRIVE.driveR, x, y, 1.2)) return { act: 'driveR' };
          if (inside(DRIVE.driveDone, x, y)) return { act: 'driveDone' };
          return { act: 'none' };
        }
        if (inside(WEAPON_CHIP, x, y)) return { act: x < WEAPON_CHIP.x + 60 ? 'prev' : 'next' };
        if (y < HUD.y + HUD.h + 4) return { act: 'none' };
        if (app.touch?.active) {
          for (const k of ['angleL', 'angleR', 'powerUp', 'powerDown', 'gear', 'fire']) if (near(PAD[k], x, y, 1.15)) return { act: k };
        } else {
          if (inside(BTN.gear, x, y)) return { act: 'gear' };
          if (inside(BTN.fire, x, y)) return { act: 'fire' };
        }
        return null;
      }
      case 'pause': { for (let i = 0; i < 2; i++) if (inside(pauseRect(i), x, y)) return { act: 'pauseItem', i }; return { act: 'none' }; }
      case 'final': { for (let i = 0; i < 2; i++) if (inside(finalRect(i), x, y)) return { act: 'finalItem', i }; return { act: 'none' }; }
      case 'shop': {
        for (const k of ['buy', 'sell', 'done']) if (inside(SHOP_BTN[k], x, y)) return { act: k };
        for (let col = 0; col < 2; col++) for (let i = 0; i < (col ? 7 : 17); i++) if (inside(goodRect(col, i), x, y)) return { act: 'good', col, i };
        return { act: 'none' };
      }
    }
    return { act: 'tap' };
  }
  const toCell = (px, py) => ({ x: px / u / K, y: py / u / K });
  return { draw, events, hit, toCell, destroy() { destroyed = true; unfit(); } };
}
