// The VGA renderer: draws the simulation and the app's screens at 320 × 200 pixels, shown at
// 4:3 with hard pixels. It only reads state; the simulation never learns how big a tile is.
//
//   const view = createVgaRenderer(canvas);
//   view.events(sim.events);   // particles and shake from what happened this frame
//   view.draw(app);            // app = { state, sim, input, … } (see app.js)
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';
import { fitPixels } from '@nostalgia/game/runtime';
import { COLS, MAP_COLS, ROOMS, ROWS, ZONES } from '../world.js';
import { FORMS, UPGRADES } from '../sim.js';
import { T, makeBackdrop, paintRoom } from './art.js';
import { drawText, textWidth, wrap } from './font.js';
import { BAYER, C, ZONE_PAL } from './palette.js';
import {
  drawBlock, drawBoss, drawCore, drawEnemy, drawEnergy, drawForm, drawGen, drawPlate, drawPod, drawProbe, drawSwitch, drawUpgrade, pen,
} from './sprites.js';

export const W = 320, H = 200;
const VIEW_W = COLS * T, VIEW_H = ROWS * T; // one room: 320 × 184
const HUD_Y = VIEW_H;

export function createVgaRenderer(cv) {
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  // 320 × 200 shown at 4:3
  const unfit = fitPixels(cv, { width: 320, height: 240 });

  const backdrops = {};
  const backdrop = z => (backdrops[z] ??= makeBackdrop(z, VIEW_H));
  let layer = null, layerKey = '', hazards = [];
  let parts = [], shake = 0, flash = 0, flashColor = C.white;
  let ambient = [];
  let lastRoom = null, shownRoom = null, nameT = 0;
  const rand = Math.random;

  // ---------- text and prompts ----------
  const text = (s, x, y, c = C.ink, sc = 1, sh = C.shadow) => drawText(g, s, x, y, c, sc, sh);
  const ctext = (s, y, c = C.ink, sc = 1, sh = C.shadow) => drawText(g, s, Math.round((W - textWidth(s, sc)) / 2), y, c, sc, sh);
  const GS = 10;
  const style = () => ({
    pixel: true, brand: false, measure: s => textWidth(s),
    text: (c, s, x, y, col) => drawText(g, s, Math.round(x - textWidth(s) / 2), Math.round(y - 3.5), col),
    cap: C.steel[4], edge: C.steel[2], capInk: C.black, pad: C.hud[4], padInk: C.white, ink: C.ink, dim: C.dim,
  });
  // prompt with {action} glyphs; y is the top of the words
  const prompt = (input, s, x, y, c = C.ink, align = 'left') =>
    drawPrompt(g, input, s, x, y + 3.5, { size: GS, gap: 3, color: c, align, style: style() });
  // rows of [action, label, all?] pairs laid out in aligned columns
  function legend(input, rows, y, pitch = 12, c = C.ink) {
    const st = style(), gw = [], lw = [];
    const gl = (a, all) => glyphs(input, a, all);
    for (const r of rows) r.forEach(([a, l, all], k) => { gw[k] = Math.max(gw[k] || 0, measureGlyphs(g, gl(a, all), GS, st, 2)); lw[k] = Math.max(lw[k] || 0, textWidth(l)); });
    const total = gw.reduce((w, x, k) => w + (k ? 14 : 0) + x + 4 + lw[k], 0);
    rows.forEach((r, i) => {
      let x = Math.round((W - total) / 2);
      const yc = y + i * pitch;
      r.forEach(([a, l, all], k) => {
        const gs = gl(a, all);
        drawGlyphs(g, gs, x + gw[k] - measureGlyphs(g, gs, GS, st, 2), yc, GS, st, 2);
        text(l, x + gw[k] + 4, yc - 3, c);
        x += gw[k] + 4 + lw[k] + 14;
      });
    });
  }
  function panel(x, y, w, h, fill = C.hud[1]) {
    g.fillStyle = C.black; g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = fill; g.fillRect(x, y, w, h);
    g.fillStyle = C.hud[4]; g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h);
    g.fillStyle = C.hud[0]; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);
  }
  // darken a region with an ordered-dither veil (f = share of pixels blacked out)
  const veils = [];
  function veil(f, x = 0, y = 0, w = W, h = H) {
    const k = Math.max(0, Math.min(16, Math.round(f * 16)));
    if (!veils[k]) {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const cg = c.getContext('2d');
      cg.fillStyle = C.black;
      for (let i = 0; i < 16; i++) if (BAYER[i] < k) cg.fillRect(i & 3, i >> 2, 1, 1);
      veils[k] = g.createPattern(c, 'repeat');
    }
    g.fillStyle = veils[k];
    g.fillRect(x, y, w, h);
  }
  const shadeBand = (y, h, f = 0.5) => veil(f, 0, y, W, h);

  // ---------- particles ----------
  const P = (x, y, vx, vy, life, color, size = 1, grav = 0) => parts.push({ x, y, vx, vy, life, max: life, color, size, grav });
  function burst(x, y, n, colors, speed = 60, life = 0.6, grav = 120, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, s = speed * (0.3 + rand() * 0.7);
      P(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + rand() * 0.5), colors[Math.floor(rand() * colors.length)], size, grav);
    }
  }
  function events(list, sim) {
    const z = sim?.room?.zone ?? 0, Z = ZONE_PAL[z];
    for (const e of list) {
      const x = e.x * T, y = e.y * T;
      switch (e.type) {
        case 'boom': burst(x, y, e.big ? 40 : 18, [C.yellow[4], C.amber[5], C.red[3], C.steel[2]], e.big ? 110 : 70, 0.8, 60, e.big ? 2 : 1); shake = Math.max(shake, e.big ? 0.3 : 0.12); break;
        case 'die': burst(x, y, 60, [C.white, C.yellow[4], C.amber[4], C.red[3], C.steel[3]], 120, 1.2, 80, 2); shake = 0.5; flash = 0.15; flashColor = C.white; break;
        case 'crunch': shake = Math.max(shake, 0.2); break;
        case 'debris': burst(x, y, 4, C.grate, 70, 0.9, 260, 2); break;
        case 'steam': for (let i = 0; i < 3; i++) P(x + rand() * 8 - 4, y, rand() * 10 - 5, -20 - rand() * 20, 1.2, C.ice[3 + (i & 1)], 1, -10); break;
        case 'melt': case 'shatter': burst(x, y, 20, [C.ice[3], C.ice[4], C.white], 80, 0.8, 200); break;
        case 'spark': burst(x, y, e.src === 'shell' ? 10 : 5, e.src === 'shell' ? [C.amber[5], C.yellow[4], C.steel[3]] : [C.cyan[3], C.white], 50, 0.3, 100); if (e.src === 'shell') shake = Math.max(shake, 0.08); break;
        case 'tink': burst(x, y, 6, [C.white, C.steel[4]], 60, 0.25, 0); break;
        case 'hit': burst(x, y, 6, [C.white, C.yellow[4]], 50, 0.3, 50); break;
        case 'cannon': shake = Math.max(shake, 0.08); burst(x, y, 8, [C.yellow[4], C.amber[5], C.steel[2]], 40, 0.35, -20); break;
        case 'zap': burst(x, y - 8, 16, [C.yellow[4], C.cyan[3], C.white], 90, 0.4, 0); flash = 0.08; flashColor = C.yellow[4]; break;
        case 'pit': flash = 0.1; flashColor = C.red[2]; break;
        case 'warp': burst(x, y, 14, [C.cyan[3], C.white], 40, 0.5, 0); break;
        case 'hurt': flash = 0.05; flashColor = C.red[3]; break;
        case 'morph': for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; P(x, y, Math.cos(a) * 70, Math.sin(a) * 50, 0.4, i % 2 ? C.white : C.cyan[3], 1, 0); } break;
        case 'land': case 'leap': burst(x, y, e.type === 'leap' || e.hard ? 10 : 5, [Z.wall[4], Z.wall[5]], 40, 0.4, 100); break;
        case 'pickup': case 'check': burst(x, y, 14, [C.green[3], C.green[4], C.white], 50, 0.6, -30); break;
        case 'upgrade': burst(x, y, 40, [C.white, C.yellow[4], C.cyan[3]], 90, 1, 0); flash = 0.12; flashColor = C.white; break;
        case 'switch': burst(x, y, 10, [C.green[3], C.white], 50, 0.4, 0); break;
        case 'splash': burst(x, y, 6, e.kind === 'icicle' ? [C.ice[3], C.white] : e.kind === 'blob' ? [C.amber[5], C.yellow[4]] : [C.red[3], C.red[4]], 50, 0.4, 150); break;
        case 'bossdead': flash = 0.3; flashColor = C.white; shake = 0.6; break;
        case 'phase': flash = 0.2; flashColor = C.red[3]; break;
        case 'field': burst(x, y, 20, [C.cyan[3], C.white], 80, 0.5, 0); break;
        case 'thud': shake = Math.max(shake, 0.15); burst(x, y, 10, [Z.wall[4], C.steel[3]], 40, 0.5, 120); break;
        case 'room': parts = []; break;
      }
    }
  }
  function stepParts(dt) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    parts = parts.filter(p => p.life > 0);
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
  }

  // ---------- the world ----------
  function roomLayer(sim) {
    const r = sim.room, key = r.id + ':' + r.version;
    if (key !== layerKey) {
      layer = paintRoom(r, r.zone, layer);
      layerKey = key;
      hazards = [];
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if ('~!'.includes(r.tiles[y][x])) hazards.push([x, y, r.tiles[y][x]]);
    }
    return layer;
  }

  function ambientFx(z, dt, t) {
    if (lastRoom !== z) { ambient = []; lastRoom = z; }
    const Z = ZONE_PAL[z];
    if (ambient.length < 30 && rand() < 0.5) {
      if (z === 0 || z === 3) ambient.push({ x: rand() * W, y: VIEW_H + 2, vx: rand() * 6 - 3, vy: -12 - rand() * 18, c: Z.glow[rand() < 0.3 ? 1 : 0], life: 8 });
      else if (z === 1) ambient.push({ x: rand() * W, y: -2, vx: 2 + rand() * 3, vy: 8 + rand() * 8, c: C.ice[rand() < 0.5 ? 3 : 2], life: 20 });
      else ambient.push({ x: rand() * W, y: rand() * VIEW_H, vx: 0, vy: 0, c: rand() < 0.5 ? C.white : C.green[3], life: 0.4 + rand() * 0.8 });
    }
    for (const a of ambient) {
      a.x += a.vx * dt + (z === 0 ? Math.sin(t * 2 + a.y * 0.1) * 0.2 : 0); a.y += a.vy * dt; a.life -= dt;
      g.fillStyle = a.c; g.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
    }
    ambient = ambient.filter(a => a.life > 0 && a.y > -4 && a.y < VIEW_H + 4);
  }

  function drawHazards(z, t) {
    const Z = ZONE_PAL[z];
    for (const [x, y, c] of hazards) {
      const px = x * T, py = y * T;
      if (c === '~') {
        for (let i = 0; i < T; i++) {
          const w = Math.sin((px + i) * 0.5 + t * 4) + Math.sin((px + i) * 0.21 - t * 2.3);
          g.fillStyle = w > 0.8 ? Z.liquid[5] : w > -0.3 ? Z.liquid[4] : Z.liquid[3];
          g.fillRect(px + i, py + (w > 1.2 ? -1 : 0), 1, 2);
        }
        if (((x * 7 + Math.floor(t * 3)) % 11) === 0) { g.fillStyle = Z.liquid[5]; g.fillRect(px + 3, py - 2 - Math.floor((t * 10) % 3), 1, 1); }
      } else {
        const on = (Math.floor(t * 12) + x * 3) % 7;
        if (on < 2) {
          g.fillStyle = on ? C.cyan[3] : C.yellow[4];
          let yy = py - 1;
          for (let i = 0; i < T; i++) { yy = py - 1 - ((i * 5 + Math.floor(t * 40)) % 3); g.fillRect(px + i, yy, 1, 1); }
        }
        g.fillStyle = (Math.floor(t * 8) + x) % 2 ? C.yellow[3] : C.yellow[2];
        g.fillRect(px, py, T, 1);
      }
    }
  }

  function drawDoors(sim, t) {
    const r = sim.room;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const c = r.tiles[y][x];
        if (c < '1' || c > '4') continue;
        const d = r.doors[c], px = x * T, py = y * T;
        if (c === '4') {
          // the sentinel's force field
          if (d.open) continue;
          for (let j = 0; j < T; j++) {
            const k = (Math.floor(t * 30) + j * 3 + y * 7) % 8;
            g.fillStyle = k < 2 ? C.white : k < 5 ? C.cyan[3] : C.cyan[2];
            g.fillRect(px + 2 + ((j + Math.floor(t * 20)) % 3) - 1, py + j, 3, 1);
          }
          continue;
        }
        const h = Math.round(T * (1 - d.anim));
        if (h <= 0) continue;
        g.fillStyle = C.steel[1]; g.fillRect(px, py, T, h);
        for (let j = 0; j < h; j++) { g.fillStyle = ((j + y * T) >> 1) % 2 ? C.yellow[3] : C.hud[0]; g.fillRect(px + 2, py + j, 4, 1); }
        g.fillStyle = C.steel[3]; g.fillRect(px, py, 1, h); g.fillStyle = C.steel[0]; g.fillRect(px + T - 1, py, 1, h);
        if (h < T) { g.fillStyle = C.steel[4]; g.fillRect(px, py + h - 1, T, 1); }
      }
  }

  function drawPlayer(sim, t) {
    const p = sim.p;
    if (sim.status === 'dead' || sim.status === 'gameover') return;
    if (p.inv > 0 && Math.floor(t * 20) % 2 && sim.status === 'play') return;
    const fx = (p.x + p.w / 2) * T, fy = (p.y + p.h) * T;
    if (p.morphT > 0) {
      const k = p.morphT / 0.3;
      drawForm(g, k > 0.5 ? p.morphFrom : p.form, fx, fy, p, t);
      // shimmer: white noise inside the bigger silhouette
      const bw = 34, bh = 30;
      g.fillStyle = C.white;
      for (let i = 0; i < 40; i++) g.fillRect(Math.round(fx - bw / 2 + rand() * bw), Math.round(fy - rand() * bh), 1, 1);
      g.fillStyle = C.cyan[3];
      const rr = Math.round((1 - k) * 20);
      g.fillRect(Math.round(fx - rr), Math.round(fy - 14 - rr * 0.7), rr * 2, 1);
      g.fillRect(Math.round(fx - rr), Math.round(fy - 14 + rr * 0.7), rr * 2, 1);
      return;
    }
    drawForm(g, p.form, fx, fy, p, t);
    if (p.flaming) drawFlame(p);
    if (p.probe) {
      const pr = p.probe;
      drawProbe(g, (pr.x + pr.w / 2) * T, (pr.y + pr.h) * T, t);
      // tether
      g.fillStyle = C.green[2];
      const ax = fx + p.face * -1, ay = fy - 22, bx = (pr.x + pr.w / 2) * T, by = (pr.y + pr.h / 2) * T;
      for (let i = 0; i < 1; i += 0.08) if (Math.floor(i * 25 + t * 10) % 2) g.fillRect(Math.round(ax + (bx - ax) * i), Math.round(ay + (by - ay) * i), 1, 1);
    }
  }
  function drawFlame(p) {
    const f = p.face, x0 = (f > 0 ? p.x + p.w : p.x) * T, y0 = (p.y + 1.1) * T;
    for (let i = 0; i < 44; i++) {
      const spread = 1 + i * 0.18, n = Math.floor(spread * 1.5);
      for (let k = 0; k < n; k++) {
        const yy = y0 + (rand() - 0.5) * spread * 2, life = i / 44;
        g.fillStyle = life < 0.25 ? C.white : life < 0.5 ? C.yellow[4] : life < 0.8 ? C.amber[5] : C.red[3];
        if (rand() < 0.8 - life * 0.4) g.fillRect(Math.round(x0 + f * i), Math.round(yy), 1, 1);
      }
    }
  }

  function drawShots(sim, t) {
    const r = sim.room;
    for (const o of r.shots) {
      const x = Math.round(o.x * T), y = Math.round(o.y * T);
      if (o.src === 'bolt') {
        g.fillStyle = C.cyan[2]; g.fillRect(x - Math.sign(o.vx) * 3, y + 1, 6, 1);
        g.fillStyle = C.cyan[3]; g.fillRect(x, y, 6, 3); g.fillStyle = C.white; g.fillRect(x + 1, y + 1, 4, 1);
      } else {
        g.fillStyle = C.amber[3]; g.fillRect(x - Math.sign(o.vx) * 4, y + 1, 4, 2);
        g.fillStyle = C.amber[5]; g.fillRect(x, y, 6, 4); g.fillStyle = C.yellow[4]; g.fillRect(x + 1, y + 1, 3, 2);
      }
    }
    for (const o of r.eshots) {
      const x = Math.round(o.x * T), y = Math.round(o.y * T);
      if (o.kind === 'icicle') { g.fillStyle = C.ice[3]; g.fillRect(x, y, 4, 6); g.fillStyle = C.white; g.fillRect(x + 1, y + 5, 2, 3); g.fillRect(x + 1, y, 1, 5); }
      else if (o.kind === 'blob') { g.fillStyle = C.amber[4]; g.fillRect(x, y, 6, 6); g.fillStyle = C.yellow[4]; g.fillRect(x + 1, y + 1, 3, 3); g.fillStyle = C.red[3]; g.fillRect(x + 2, y + 6, 2, 2); }
      else { const k = Math.floor(t * 20) % 2; g.fillStyle = k ? C.red[4] : C.red[3]; g.fillRect(x, y, 5, 4); g.fillStyle = C.white; g.fillRect(x + 1, y + 1, 2, 2); }
    }
  }

  function drawWorld(app, dt) {
    const sim = app.sim, r = sim.room, z = r.zone, now = app.t;
    const p = sim.p;
    const sx = shake > 0 ? Math.round((rand() - 0.5) * 4 * Math.min(1, shake * 6)) : 0;
    const sy = shake > 0 ? Math.round((rand() - 0.5) * 3 * Math.min(1, shake * 6)) : 0;
    g.save();
    g.beginPath(); g.rect(0, 0, VIEW_W, VIEW_H); g.clip();
    g.translate(sx, sy);
    const bd = backdrop(z), pcx = p ? (p.x + p.w / 2) / COLS : 0.5;
    g.drawImage(bd.far, -Math.round(pcx * 36), 0);
    g.drawImage(bd.mid, -Math.round(pcx * 76), 0);
    ambientFx(z, dt, now);
    g.drawImage(roomLayer(sim), 0, 0);
    drawHazards(z, now);
    drawDoors(sim, now);
    for (const e of r.ents) {
      const x = e.x * T, y = (e.y + e.h) * T;
      if (e.kind === 'plate') drawPlate(g, e, x, y);
      else if (e.kind === 'switch') drawSwitch(g, e, x, y, now);
      else if (e.kind === 'gen') drawGen(g, e, x, y, now);
      else if (e.kind === 'core' && !e.broken) drawCore(g, e, x, y, now);
      else if (e.kind === 'check') drawPod(g, e, x, y, now, sim.check?.room === r.id && sim.check?.i === e.i);
      else if (e.kind === 'energy') drawEnergy(g, e, x, y, now);
      else if (e.kind === 'upgrade') drawUpgrade(g, e, x, y, now);
    }
    for (const b of r.blocks) drawBlock(g, b, b.x * T, b.y * T);
    if (sim.boss && !sim.boss.dead) {
      const b = sim.boss;
      if (!(b.dying && Math.floor(now * 16) % 2)) drawBoss(g, b, b.x * T, b.y * T, now, sim);
    }
    for (const e of r.enemies) drawEnemy(g, e, (e.x + e.w / 2) * T, (e.y + e.h) * T, e.t, z);
    if (p) drawPlayer(sim, now);
    drawShots(sim, now);
    for (const q of parts) {
      g.fillStyle = q.color;
      const s = q.size > 1 && q.life < q.max * 0.5 ? 1 : q.size;
      g.fillRect(Math.round(q.x), Math.round(q.y), s, s);
    }
    if (flash > 0) { g.globalAlpha = Math.min(0.6, flash * 4); g.fillStyle = flashColor; g.fillRect(0, 0, VIEW_W, VIEW_H); g.globalAlpha = 1; }
    // room name for a moment after entering
    if (r !== shownRoom) { shownRoom = r; nameT = 2.5; }
    nameT -= dt;
    if (nameT > 0 && !app.demo) text(r.name, 4, VIEW_H - 10, ZONE_PAL[z].accent);
    g.restore();
  }

  // ---------- HUD ----------
  const FORM_COL = { android: C.steel, raptor: C.amber, tank: C.olive };
  function formIcon(form, x, y, on, cd) {
    const R = pen(g, x, y), c = FORM_COL[form];
    R(0, 0, 14, 12, on ? c[1] : C.hud[1]);
    R(0, 0, 14, 1, on ? C.white : C.hud[3]);
    const k = on ? 4 : 2;
    if (form === 'android') { R(5, 2, 4, 3, c[k]); R(6, 3, 3, 1, C.visor[on ? 2 : 0]); R(4, 5, 6, 4, c[k - 1]); R(5, 9, 1, 2, c[k - 1]); R(8, 9, 1, 2, c[k - 1]); }
    if (form === 'raptor') { R(2, 5, 7, 3, c[k]); R(8, 2, 5, 3, c[k]); R(9, 5, 4, 1, c[k - 1]); R(3, 8, 1, 3, c[k - 1]); R(6, 8, 1, 3, c[k - 1]); R(0, 6, 2, 1, c[k - 1]); }
    if (form === 'tank') { R(1, 7, 12, 4, C.steel[on ? 2 : 1]); R(2, 4, 9, 3, c[k]); R(4, 2, 5, 2, c[k]); R(9, 3, 4, 1, c[k - 1]); }
    if (cd > 0) { g.fillStyle = C.black; for (let j = 0; j < 12; j++) for (let i = (j & 1); i < 14; i += 2) g.fillRect(x + i, y + j, 1, 1); }
  }
  function drawHud(app) {
    const sim = app.sim, p = sim.p, y = HUD_Y;
    for (let j = 0; j < 16; j++) { g.fillStyle = j === 0 ? C.hud[4] : j === 1 ? C.hud[3] : j < 8 ? C.hud[2] : C.hud[1]; g.fillRect(0, y + j, W, 1); }
    // energy
    text('EN', 4, y + 5, C.dim, 1, null);
    const en = Math.max(0, p ? p.energy : 0);
    g.fillStyle = C.black; g.fillRect(17, y + 4, 62, 8);
    for (let i = 0; i < 20; i++) {
      const lit = en > i * 5;
      const col = en <= 25 ? C.red : en <= 50 ? C.yellow : C.green;
      g.fillStyle = lit ? col[3] : C.hud[2]; g.fillRect(18 + i * 3, y + 5, 2, 6);
      if (lit) { g.fillStyle = col[4]; g.fillRect(18 + i * 3, y + 5, 2, 1); }
    }
    if (en <= 25 && Math.floor(app.t * 4) % 2) text('!', 82, y + 5, C.red[3], 1, null);
    // forms
    FORMS.forEach((f, i) => formIcon(f, 90 + i * 16, y + 2, p && p.form === f, p && p.form !== f ? p.morphCd : 0));
    // upgrades: small lit lamps under each form's colour
    Object.keys(UPGRADES).forEach((u, i) => {
      const on = sim.upgrades[u], R = pen(g, 142 + i * 10, y + 4);
      R(0, 0, 8, 8, on ? C.hud[3] : C.hud[1]);
      if (u === 'blaster') { R(1, 3, 5, 2, on ? C.steel[4] : C.hud[3]); R(5, 2, 2, 2, on ? C.visor[2] : C.hud[3]); }
      if (u === 'flame') { R(3, 1, 2, 6, on ? C.amber[5] : C.hud[3]); R(2, 3, 1, 3, on ? C.red[3] : C.hud[3]); }
      if (u === 'probe') { R(2, 3, 4, 3, on ? C.steel[4] : C.hud[3]); R(1, 2, 6, 1, on ? C.green[3] : C.hud[3]); }
    });
    // lives
    { const R = pen(g, 176, y + 4); R(0, 1, 5, 6, C.steel[3]); R(1, 3, 4, 1, C.visor[2]); R(0, 1, 5, 1, C.steel[5]); }
    text('X' + Math.max(0, sim.lives), 183, y + 5, C.ink, 1, null);
    // zone and time
    const zn = ZONES[sim.room?.zone ?? 0].name;
    text(zn, 204, y + 5, ZONE_PAL[sim.room?.zone ?? 0].accent, 1, null);
    const tt = clock(sim.t);
    text(tt, W - 4 - textWidth(tt), y + 5, C.ink, 1, null);
  }
  function bossBar(sim) {
    const b = sim.boss;
    if (!b || b.dead) return;
    const w = 120, x = (W - w) / 2, y = 4;
    shadeBand(0, 18, 0.5);
    text(b.name, Math.round((W - textWidth(b.name)) / 2), y, C.red[4]);
    g.fillStyle = C.black; g.fillRect(x - 1, y + 9, w + 2, 5);
    g.fillStyle = C.red[1]; g.fillRect(x, y + 10, w, 3);
    g.fillStyle = C.red[3]; g.fillRect(x, y + 10, Math.round((w * b.hp) / b.maxHp), 3);
    g.fillStyle = C.red[4]; g.fillRect(x, y + 10, Math.round((w * b.hp) / b.maxHp), 1);
  }
  function message(app) {
    const m = app.sim.message;
    if (!m || app.demo) return;
    const lines = m.text.split(' · ');
    const y0 = app.sim.boss && !app.sim.boss.dead ? 22 : 6;
    const h = lines.length * 12 + 4;
    shadeBand(y0 - 3, h + 2, 0.6);
    lines.forEach((l, i) => prompt(app.input, l, W / 2, y0 + i * 12, m.big ? C.yellow[4] : C.ink, 'center'));
  }

  // ---------- screens ----------
  let titleScroll = 0;
  function logo(y, sc = 4) {
    const s = 'TRIFORM', w = textWidth(s, sc), x = Math.round((W - w) / 2);
    const ramp = [C.white, C.steel[5], C.steel[4], C.cyan[3], C.cyan[2], C.visor[1], C.visor[0]];
    drawText(g, s, x + 2, y + 2, C.black, sc);
    drawText(g, s, x + 1, y + 1, C.hud[0], sc);
    drawText(g, s, x, y, r => ramp[r], sc);
    // a glint running across the letters
    const gx = Math.round(((titleScroll * 1.5) % 400) - 40);
    g.save(); g.beginPath(); g.rect(gx, y, 3, 7 * sc); g.clip();
    drawText(g, s, x, y, C.white, sc);
    g.restore();
  }
  function titleBg(app, dt) {
    titleScroll += dt * 12;
    const bd = backdrop(0);
    g.drawImage(bd.far, -Math.round((titleScroll * 0.3) % 40), 0);
    g.drawImage(bd.far, -Math.round((titleScroll * 0.3) % 40) + 360, 0);
    g.drawImage(bd.mid, -Math.round(titleScroll % 80), 0);
    g.drawImage(bd.mid, -Math.round(titleScroll % 80) + 400, 0);
    g.fillStyle = C.black; g.fillRect(0, VIEW_H, W, H - VIEW_H);
    ambientFx(0, dt, app.t);
  }
  function drawTitle(app, dt) {
    titleBg(app, dt);
    shadeBand(0, H, 0.35);
    logo(10);
    ctext('ANVIL FOUNDRY · HIGH ORBIT', 42, ZONE_PAL[0].accent);
    // the three forms on a plinth, one lit at a time
    const pick = Math.floor(app.t / 2) % 3, fake = { face: 1, vx: 0, vy: 0, ground: true, walk: app.t * 8, swing: null, spCd: 0, sprint: 0, atkCd: 0, flaming: false, ladder: false, probe: null };
    const xs = [92, 160, 232];
    g.fillStyle = C.steel[1]; g.fillRect(60, 86, 200, 3); g.fillStyle = C.steel[3]; g.fillRect(60, 86, 200, 1);
    FORMS.forEach((f, i) => {
      const lit = i === pick;
      if (lit) for (let k = 0; k < 6; k++) { g.fillStyle = C.cyan[k % 2 ? 2 : 1]; g.fillRect(xs[i] - 16 + k * 6, 86, 3, 1); }
      drawForm(g, f, xs[i], 86, { ...fake, vx: lit ? 0.01 : 0, walk: lit ? app.t * 6 : 0 }, app.t);
      if (!lit) veil(0.25, xs[i] - 20, 50, 40, 36);
      const label = f.toUpperCase();
      text(label, Math.round(xs[i] - textWidth(label) / 2), 92, lit ? C.ink : C.dim);
    });
    const blurb = ['CLIMBS · DUCTS · STRIKES', 'BITES · LEAPS · SWIPES', 'TREADS · CANNON · SHOVES'][pick];
    ctext(blurb, 102, FORM_COL[FORMS[pick]][4]);
    const input = app.input, kb = input.device.kind !== 'gamepad';
    const rows = [
      [['move', 'MOVE'], ['jump', 'JUMP']],
      [['attack', 'ATTACK'], ['special', 'SPECIAL']],
      [['morph', 'MORPH', true], ['pause', 'PAUSE']],
    ];
    const last = [['map', 'MAP']];
    if (kb) last.push(['sound', 'SOUND']);
    rows.push(last);
    if (kb) rows.push([['forms', 'FORM', true], ['fullscreen', 'FULLSCREEN']]);
    if (kb && app.hdr?.supported) rows.push([['hdr', app.hdr.label]]);
    if (app.onExit) (rows[rows.length - 1].length < 2 ? rows[rows.length - 1] : rows[rows.push([]) - 1]).push(['quit', 'EXIT']);
    const items = app.items();
    legend(input, rows, 118, items.length > 1 ? 10 : 11);
    if (items.length > 1) {
      // CONTINUE (the autosave) over NEW GAME; the picked one blinks between arrows
      items.forEach((it, k) => {
        const s = it === 'continue' ? 'CONTINUE · ' + app.saved.label : 'NEW GAME', y = 167 + k * 10, on = k === app.menu, x = Math.round((W - textWidth(s)) / 2);
        text(s, x, y, on ? C.yellow[4] : C.dim);
        if (on && Math.floor(app.t * 3) % 2) { text('>', x - 10, y, C.yellow[4]); text('<', x + textWidth(s) + 4, y, C.yellow[4]); }
      });
    } else if (Math.floor(app.t * 2) % 2) prompt(input, 'PRESS {start} TO START', W / 2, 178, C.yellow[4], 'center');
    const best = app.best;
    const hs = 'BEST ' + String(best.score).padStart(6, '0') + (best.time ? '  ' + clock(best.time) : ''), so = 'SOUND ' + (app.soundOn ? 'ON' : 'OFF');
    const sx = Math.round((W - textWidth(hs) - 18 - textWidth(so)) / 2);
    text(hs, sx, 190, C.amber[4]); text(so, sx + textWidth(hs) + 18, 190, C.dim);
  }
  const INTRO = [
    'FORTY YEARS AFTER THE LAST SHIFT, THE ORBITAL FOUNDRY ANVIL IS STILL BURNING.',
    'ITS MIND, THE FOREMAN, LOCKED THE CREW OUT AND KEPT ON BUILDING. NOBODY KNOWS WHAT.',
    'DEEP IN THE SLAG PITS A SALVAGE FRAME REBOOTS: UNIT T-3, CALLED TRIFORM.',
    'ANDROID, RAPTOR, TANK. ONE BODY, THREE SHAPES. EACH LOCK IN THE FOUNDRY WANTS ONE OF THEM.',
    'CLIMB TO THE CORE. SILENCE THE FOREMAN.',
  ];
  function drawIntro(app, dt) {
    titleBg(app, dt);
    shadeBand(0, H, 0.6);
    logo(12, 2);
    let y = 40, chars = Math.floor(app.stT * 40);
    for (const para of INTRO) {
      for (const line of wrap(para, 280)) {
        if (chars <= 0) break;
        text(line.slice(0, chars), 20, y, C.ink);
        chars -= line.length; y += 10;
      }
      y += 6;
    }
    if (Math.floor(app.t * 2) % 2) prompt(app.input, 'PRESS {start}', W / 2, 182, C.yellow[4], 'center');
  }
  const clock = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  function drawPause(app) {
    veil(0.25, 0, 0, W, VIEW_H);
    panel(90, 44, 140, 96);
    ctext('PAUSED', 52, C.yellow[4], 2);
    const rows = [[['pause', 'RESUME']], [['restart', 'RETRY ROOM']], [['quit', 'QUIT']]];
    if (app.input.device.kind !== 'gamepad') rows.push([['sound', app.soundOn ? 'SOUND OFF' : 'SOUND ON']]);
    legend(app.input, rows, 78, 12);
  }
  function drawMap(app) {
    const sim = app.sim;
    g.fillStyle = C.black; g.fillRect(0, 0, W, VIEW_H);
    ctext('ANVIL FOUNDRY', 6, C.ink, 1);
    const cw = 44, ch = 26, ox = Math.round((W - MAP_COLS * cw) / 2), oy = 22;
    for (const def of ROOMS) {
      const m = sim.mem[def.id], x = ox + def.col * cw, y = oy + def.row * ch, Z = ZONE_PAL[def.zone];
      g.fillStyle = C.hud[1]; g.fillRect(x, y, cw - 3, ch - 3);
      if (!m?.visited) { g.fillStyle = C.hud[2]; g.fillRect(x + 1, y + 1, cw - 5, ch - 5); continue; }
      // a 1-pixel-per-tile thumbnail of the room as it is now
      for (let ty = 0; ty < ROWS; ty++)
        for (let tx = 0; tx < COLS; tx++) {
          const c = m.tiles[ty][tx];
          if (c === '.') continue;
          g.fillStyle = c === '#' ? Z.wall[3] : '~^!'.includes(c) ? C.red[3] : c === 'H' ? Z.wall[5] : c === 'B' ? C.grate[4] : c === 'I' ? C.ice[3] : c === '%' ? C.mesh[3] : c === '=' ? Z.wall[4] : C.yellow[3];
          g.fillRect(x + 1 + tx, y + 1 + ty, 1, 1);
        }
      const bossHere = def.ents.find(e => e[0] === 'boss');
      if (bossHere && !m.bossDead) { g.fillStyle = C.red[4]; g.fillRect(x + cw - 9, y + 2, 4, 4); }
      if (def.ents.some(e => e[0] === 'check')) { g.fillStyle = C.green[3]; g.fillRect(x + 2, y + ch - 7, 2, 2); }
    }
    const r = sim.room;
    if (Math.floor(app.t * 4) % 2) {
      const x = ox + r.col * cw, y = oy + r.row * ch;
      g.fillStyle = C.white;
      g.fillRect(x - 1, y - 1, cw - 1, 1); g.fillRect(x - 1, y + ch - 3, cw - 1, 1); g.fillRect(x - 1, y - 1, 1, ch - 1); g.fillRect(x + cw - 3, y - 1, 1, ch - 1);
      const p = sim.p;
      g.fillRect(x + 1 + Math.round(p.x + p.w / 2) - 1, y + 1 + Math.round(p.y + p.h / 2) - 1, 2, 2);
    }
    ZONES.slice(0, 3).forEach((zz, i) => { const Z = ZONE_PAL[i]; g.fillStyle = Z.wall[4]; g.fillRect(40 + i * 90, 132, 6, 6); text(zz.name, 50 + i * 90, 132, C.dim); });
    const s = Math.floor(sim.t);
    ctext('TIME ' + clock(s) + '   SCORE ' + String(sim.score).padStart(6, '0') + '   LOST ' + sim.deaths, 146, C.ink);
    prompt(app.input, '{map} CLOSE', W / 2, 166, C.dim, 'center');
  }
  function drawOver(app) {
    veil(0.3, 0, 0, W, VIEW_H);
    panel(70, 54, 180, 70);
    ctext('SYSTEMS OFFLINE', 62, C.red[4], 2);
    ctext('SCORE ' + String(app.sim.score).padStart(6, '0'), 86, C.ink);
    ctext('THE FOREMAN KEEPS BUILDING', 98, C.dim);
    if (app.stT > 1.2 && Math.floor(app.t * 2) % 2) prompt(app.input, 'PRESS {start}', W / 2, 110, C.yellow[4], 'center');
  }
  function drawVictory(app, dt) {
    const sim = app.sim;
    titleScroll += dt * 6;
    const bd = backdrop(2);
    g.drawImage(bd.far, -Math.round((titleScroll * 0.2) % 40), 0);
    g.fillStyle = C.black; g.fillRect(0, VIEW_H, W, H - VIEW_H);
    shadeBand(0, H, 0.45);
    ctext('THE FOREMAN IS SILENT', 14, C.yellow[4], 2);
    const lines = ['THE FURNACES COOL. ANVIL FALLS QUIET.', 'FOR THE FIRST TIME IN FORTY YEARS', 'THE STATION IS LISTENING FOR ITS CREW.'];
    lines.forEach((l, i) => ctext(l, 40 + i * 10, C.ink));
    const fake = { face: 1, vx: 0, vy: 0, ground: true, walk: 0, swing: null, spCd: 0, sprint: 0, atkCd: 0, flaming: false, ladder: false, probe: null };
    drawForm(g, FORMS[Math.floor(app.t / 1.5) % 3], 160, 104, fake, app.t);
    panel(80, 112, 160, 52);
    const rows = [['TIME', clock(sim.t)], ['SCORE', String(sim.score).padStart(6, '0')], ['UNITS LOST', String(sim.deaths)], ['BEST TIME', app.best.time ? clock(app.best.time) : '--:--']];
    rows.forEach(([a, b], i) => { text(a, 90, 118 + i * 11, C.dim); text(b, 230 - textWidth(b), 118 + i * 11, C.ink); });
    if (app.stT > 2 && Math.floor(app.t * 2) % 2) prompt(app.input, 'PRESS {start}', W / 2, 176, C.yellow[4], 'center');
  }

  let last = performance.now();
  function draw(app) {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    stepParts(dt);
    g.fillStyle = C.black; g.fillRect(0, 0, W, H);
    const s = app.state;
    if (s === 'title') return drawTitle(app, dt);
    if (s === 'intro') return drawIntro(app, dt);
    if (s === 'victory') return drawVictory(app, dt);
    if (!app.sim.room) return;
    drawWorld(app, dt);
    drawHud(app);
    if (s === 'map') return drawMap(app);
    bossBar(app.sim);
    message(app);
    if (s === 'pause') drawPause(app);
    if (s === 'over') drawOver(app);
    if (app.fade > 0) veil(app.fade, 0, 0, W, H);
  }

  return {
    draw,
    events,
    destroy() { unfit(); },
  };
}
