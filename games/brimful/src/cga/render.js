// The CGA renderer: 320 × 200 in four colours, shown at 4:3 with hard pixels, integer-scaled
// when the window allows and letterboxed in black. Each venue picks a CGA palette and its own
// backdrop colour (colour 0), the way CGA games swapped them. It only reads state.
//
//   const view = createCgaRenderer(canvas, app);
//   view.events(sim.events, sim);  view.draw(app);  view.hit(x, y, app) → touch target
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';
import { fitPixels } from '@nostalgia/game/runtime';
import { LETTERS } from '../app.js';
import { ROWS, SHOW_T } from '../sim.js';
import { VENUES } from '../venues.js';
import { drawText, textWidth, wrap } from './font.js';
import { HATS, buildSprites, canvas } from './sprites.js';

export const W = 320, H = 200;
const HUD_H = 12, TOP = 14, BAND = 46, X0 = 34, U = 13;
const COUNTER_Y = 28; // counter top, from a band's top
const P1 = ['#55ffff', '#ff55ff', '#ffffff'], P0 = ['#55ff55', '#ff5555', '#ffff55'];
const PAL = {
  title: ['#000000', ...P1],
  pier: ['#0000aa', ...P1],
  lodge: ['#000000', ...P0],
  market: ['#0000aa', ...P0],
  moon: ['#000000', ...P1],
  bonus: ['#000000', ...P0],
};
const DRINK = { pier: 2, lodge: 2, market: 1, moon: 1 }; // the colour each venue's drink is
const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');
const rowY = r => TOP + r * BAND;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function createCgaRenderer(cv) {
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  // 320 × 200 at 4:3; whole multiples from twice the size up
  const unfit = fitPixels(cv, { width: 320, height: 240, snap: 2 });

  // palette state: P = current colours, spr(name…) = sprites in them
  let palKey = '', P = PAL.title, spr = buildSprites(P);
  const sprites = {};
  function usePal(key) {
    if (key === palKey) return;
    palKey = key; P = PAL[key];
    spr = sprites[key] ??= buildSprites(P);
  }
  const C = i => P[i];
  const rect = (x, y, w, h, c) => { g.fillStyle = typeof c === 'number' ? P[c] : c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const pat = {};
  // a 4 × 4 ordered dither of colour c over the backdrop, f = coverage 0..1
  function dither(x, y, w, h, c, f) {
    const key = palKey + c + ':' + Math.round(f * 16);
    let p = pat[key];
    if (!p) {
      const t = canvas(4, 4), tg = t.getContext('2d');
      tg.fillStyle = P[c];
      for (let i = 0; i < 16; i++) if (BAYER[i] < Math.round(f * 16)) tg.fillRect(i & 3, i >> 2, 1, 1);
      p = pat[key] = g.createPattern(t, 'repeat');
    }
    g.fillStyle = p; g.fillRect(x, y, w, h);
  }

  // ---------- text and prompts ----------
  const text = (s, x, y, c = 3, sc = 1, sh = null) => drawText(g, s, x, y, C(c), sc, sh == null ? null : C(sh));
  const ctext = (s, y, c = 3, sc = 1, sh = null) => text(s, Math.round((W - textWidth(s, sc)) / 2), y, c, sc, sh);
  const rtext = (s, x, y, c = 3) => text(s, x - textWidth(s), y, c);
  const GS = 9;
  const style = () => ({
    pixel: true, brand: false, measure: s => textWidth(s),
    text: (_c, s, x, y, col) => drawText(g, s, Math.round(x - textWidth(s) / 2), Math.round(y - 3.5), col),
    cap: P[3], edge: P[1], capInk: P[0] === '#000000' ? '#000000' : P[0], pad: P[2], padInk: P[3], ink: P[3], dim: P[1],
  });
  const prompt = (input, s, x, y, c = 3, align = 'left') => drawPrompt(g, input, s, x, y + 3.5, { size: GS, gap: 3, color: C(c), align, style: style() });
  function legend(input, rows, y, pitch = 12, c = 3) {
    const st = style(), gw = [], lw = [];
    const gl = (a, all) => glyphs(input, a, all);
    for (const r of rows) r.forEach(([a, l, all], k) => { gw[k] = Math.max(gw[k] || 0, measureGlyphs(g, gl(a, all), GS, st, 2)); lw[k] = Math.max(lw[k] || 0, textWidth(l)); });
    const total = gw.reduce((w, x, k) => w + (k ? 12 : 0) + x + 4 + lw[k], 0);
    rows.forEach((r, i) => {
      let x = Math.round((W - total) / 2);
      const yc = y + i * pitch;
      r.forEach(([a, l, all], k) => {
        const gs = gl(a, all);
        drawGlyphs(g, gs, x + gw[k] - measureGlyphs(g, gs, GS, st, 2), yc, GS, st, 2);
        text(l, x + gw[k] + 4, yc - 3, c);
        x += gw[k] + 4 + lw[k] + 12;
      });
    });
  }
  function box(x, y, w, h, c = 3) {
    rect(x - 1, y - 1, w + 2, h + 2, 0);
    rect(x, y, w, h, c); rect(x + 1, y + 1, w - 2, h - 2, 0);
    rect(x + 2, y + 2, w - 4, h - 4, c === 3 ? 1 : 3); rect(x + 3, y + 3, w - 6, h - 6, 0);
  }

  // ---------- particles ----------
  let parts = [], shake = 0, flash = 0;
  const rand = Math.random;
  const doorT = [0, 0, 0, 0];
  function burst(x, y, n, cols, speed = 40, life = 0.6, grav = 80) {
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, s = speed * (0.3 + rand() * 0.7);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life: life * (0.5 + rand() * 0.5), c: cols[Math.floor(rand() * cols.length)], grav });
    }
  }
  function events(list, sim) {
    for (const e of list) {
      const y = e.row != null ? rowY(e.row) + COUNTER_Y : 100, x = e.x != null ? X0 + e.x * U : 160;
      const dc = DRINK[sim.V?.id] ?? 2;
      switch (e.type) {
        case 'catch': burst(x, y - 6, 6, [3, dc], 30, 0.4); break;
        case 'collect': burst(x, y - 4, 4, [3], 25, 0.3); break;
        case 'slide': if (e.perfect) burst(X0 + 6, y - 8, 8, [3, 1], 35, 0.5, 20); break;
        case 'spill': burst(X0, y - 4, 14, [dc, 3], 30, 0.7, 160); break;
        case 'tip': burst(x, y - 4, 16, [3, 2, 1], 50, 0.8, 60); break;
        case 'miss': shake = 0.35; flash = 0.12; if (e.cause !== 'grab') burst(e.cause === 'crash' ? X0 + sim.rows[e.row].len * U + 4 : X0 - 4, y - 2, 18, [3, 1], 60, 0.8, 200); break;
        case 'clear': for (let k = 0; k < 4; k++) burst(60 + k * 66, 40 + rand() * 120, 14, [1, 2, 3], 60, 1.2, 60); break;
        case 'enter': case 'out': doorT[e.row] = 0.45; break;
        case 'life': flash = 0.1; break;
        case 'screen': case 'bonus': parts = []; break;
        case 'round': burst(160, 100, 20, [1, 2, 3], 70, 0.9, 40); break;
        case 'perfect': for (let k = 0; k < 3; k++) burst(80 + k * 80, 100, 20, [1, 2, 3], 80, 1.2, 50); break;
      }
    }
  }
  function stepParts(dt) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    parts = parts.filter(p => p.life > 0);
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
    for (let r = 0; r < 4; r++) doorT[r] = Math.max(0, doorT[r] - dt);
  }
  function drawParts() { for (const p of parts) rect(p.x, p.y, 1, 1, p.c); }

  // ---------- the venue: backdrop, counters, dispensers and doors, cached per venue ----------
  const layers = {};
  function venueLayer(sim) {
    const V = sim.V, key = V.id + sim.rows.map(r => r.len).join(',');
    if (!layers[key]) {
      const c = canvas(W, H);
      paintVenue(c.getContext('2d'), V, sim.rows);
      layers[key] = c;
    }
    return layers[key];
  }
  function paintVenue(x, V, rows) {
    const id = V.id;
    const fill = (px, py, w, h, ci) => { x.fillStyle = P[ci]; x.fillRect(px, py, w, h); };
    const dz = (px, py, w, h, ci, f) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (BAYER[((py + j) & 3) * 4 + ((px + i) & 3)] < f * 16) fill(px + i, py + j, 1, 1, ci); };
    fill(0, 0, W, H, 0);
    // the scene behind the counters
    if (id === 'pier') {
      for (let k = 0; k < 6; k++) dz(0, 14 + k * 6, W, 6, 2, 0.5 - k * 0.08); // sunset glow
      fill(0, 52, W, 1, 3);
      for (let yy = 53; yy < H; yy += 2) dz(0, yy, W, 1, 1, 0.1 + 0.3 * ((yy - 53) / 150)); // the sea
      for (let k = 0; k < 24; k++) fill((k * 53) % W, 56 + ((k * 37) % 140), 3, 1, 3); // glints
      for (let j = -8; j <= 8; j++) { const w = Math.round(Math.sqrt(64 - j * j) * 1.2); fill(196 - w, 26 + j, w * 2, 1, 3); } // the sun
    } else if (id === 'lodge') {
      for (let yy = HUD_H; yy < H; yy += 4) { fill(0, yy, W, 3, 2); dz(0, yy, W, 3, 0, 0.35); } // log wall
      for (let r = 0; r < ROWS; r++) for (let k = 0; k < 3; k++) { // windows on a snowy night with pines
        const wx = 70 + k * 80, wy = rowY(r) + 4;
        fill(wx - 1, wy - 1, 24, 18, 3); fill(wx, wy, 22, 16, 0);
        for (let p = 0; p < 3; p++) { const px = wx + 3 + p * 7; for (let j = 0; j < 7; j++) fill(px + 3 - (j >> 1), wy + 6 + j, 1 + (j >> 1) * 2, 1, 1); }
        for (let s = 0; s < 6; s++) fill(wx + ((s * 7 + r * 3) % 21), wy + ((s * 5) % 9), 1, 1, 3);
        fill(wx + 10, wy, 2, 16, 3);
      }
    } else if (id === 'market') {
      for (let k = 0; k < 60; k++) fill((k * 71) % W, 14 + ((k * 43) % 180), 1, 1, 3); // night sky
      for (let r = 0; r < ROWS; r++) {
        const yy = rowY(r);
        for (let k = 0; k < 10; k++) { // striped awnings
          const ax = 40 + k * 28;
          for (let j = 0; j < 5; j++) fill(ax + j, yy + 1 + j, 14 - j * 2, 1, k % 2 ? 1 : 2);
        }
        for (let px = 40; px < W; px++) fill(px, yy + 9 + Math.round(Math.sin(px / 14) * 2), 1, 1, 3); // lantern string
      }
    } else { // moon
      for (let k = 0; k < 90; k++) fill((k * 97) % W, 14 + ((k * 61) % 186), 1, 1, k % 7 ? 1 : 3); // stars
      for (let j = -11; j <= 11; j++) { const w = Math.round(Math.sqrt(121 - j * j) * 1.2); fill(214 - w, 28 + j, w * 2, 1, 1); } // Earth
      fill(206, 22, 8, 5, 3); fill(216, 30, 9, 4, 3); dz(200, 17, 30, 23, 0, 0.25);
      for (let r = 0; r < ROWS; r++) { const yy = rowY(r); for (let k = 0; k < 7; k++) { const ax = 56 + k * 38; fill(ax, yy + 2, 2, 24, 1); } fill(40, yy + 2, W - 40, 1, 1); } // dome struts
    }
    // HUD strip
    fill(0, 0, W, HUD_H, 0); fill(0, HUD_H, W, 1, 1);
    rows.forEach((row, r) => {
      const y0 = rowY(r), cy = y0 + COUNTER_Y, ex = X0 + row.len * U;
      // door at the far end
      fill(ex, y0 + 4, 10, COUNTER_Y - 4, 0);
      fill(ex, y0 + 4, 1, COUNTER_Y - 4, 3); fill(ex + 9, y0 + 4, 1, COUNTER_Y - 4, 3); fill(ex, y0 + 4, 10, 1, 3);
      // counter: bright edge, top, front panel in the venue's pattern
      fill(X0 - 6, cy, ex - X0 + 8, 1, 3);
      fill(X0 - 6, cy + 1, ex - X0 + 8, 2, 1);
      const fy = cy + 3, fh = 6;
      fill(X0 - 6, fy, ex - X0 + 8, fh, 0);
      for (let px = X0 - 6; px < ex + 2; px++) for (let j = 0; j < fh; j++) {
        let on = false;
        if (id === 'pier') on = px % 6 === 0 || j === fh - 1;
        else if (id === 'lodge') on = j % 3 === 1 && (px + j * 3) % 9 > 1;
        else if (id === 'market') on = (px + j) % 6 === 0 || (px - j) % 6 === 0;
        else on = (j === 1 || j === fh - 2) && px % 4 === 0 || j === fh - 1;
        if (on) fill(px, fy + j, 1, 1, id === 'lodge' || id === 'market' ? 2 : 1);
      }
      // floor where Pip walks
      const fl = fy + fh;
      fill(0, fl, ex + 10, BAND - (fl - y0), 0);
      for (let px = 0; px < ex + 10; px += 2) fill(px + ((fl >> 1) & 1), fl + BAND - (fl - y0) - 1, 1, 1, 1);
      // the dispenser at Pip's end
      const dc = DRINK[id];
      fill(4, y0 + 6, 20, COUNTER_Y - 6, 0);
      fill(4, y0 + 6, 20, 2, 3); fill(4, y0 + 6, 1, COUNTER_Y - 6, 3); fill(23, y0 + 6, 1, COUNTER_Y - 6, 3);
      fill(7, y0 + 10, 14, 8, dc); fill(8, y0 + 11, 3, 3, 3); // tank with a highlight
      fill(9, y0 + 20, 10, 2, 1); fill(9, y0 + 23, 10, 2, 1);
      fill(24, y0 + 12, X0 - 24, 2, 3); fill(X0 - 1, y0 + 14, 2, 3, 3); // arm and spout
    });
  }

  // ---------- pieces ----------
  function glass(px, by, fill, dc, full = true) {
    // by: the glass's base row; 5 wide, 7 tall
    px = Math.round(px); by = Math.round(by);
    rect(px, by - 7, 1, 7, 3); rect(px + 4, by - 7, 1, 7, 3); rect(px, by - 1, 5, 1, 3);
    const h = Math.round(fill * 6);
    if (h > 0) rect(px + 1, by - 1 - h, 3, h, dc);
    if (full && fill >= 1) rect(px, by - 8, 5, 1, 3);
  }
  function customerSprite(c, sim) {
    let name = 'cust';
    if (c.state === 'pushed') name = 'custReach';
    else if (c.state === 'drink') name = 'custDrink';
    else if (c.look > 0.5) name = 'custLook';
    const shirt = c.kind % 2 ? '2' : '1';
    const walking = c.state === 'walk' && !sim.show;
    const bob = walking && Math.floor(c.bob * 6) % 2 ? 1 : 0;
    return { name, shirt, bob };
  }
  function drawCustomer(c, r, sim, t) {
    const y0 = rowY(r), cy = y0 + COUNTER_Y, px = Math.round(X0 + c.x * U - 5);
    const { name, shirt, bob } = customerSprite(c, sim);
    const img = spr(name, false, shirt), top = cy - 13 + bob - (c.catchT > 0 ? 1 : 0);
    g.drawImage(img, px, top);
    const hat = HATS[sim.V.id][c.kind % 3];
    g.drawImage(spr('hat:' + sim.V.id + (c.kind % 3), false, shirt, hat), px, top);
    if (c.state === 'drink') glass(px - 1, top + 9, Math.max(0, c.t / sim.P.drink), DRINK[sim.V.id], false);
    if (c.look > 0.5 && Math.floor(t * 3 + c.kind) % 2) g.drawImage(spr('note'), px + 7, top - 3);
  }
  function drawPip(sim, t) {
    const sv = sim.server, y0 = rowY(sv.row), feet = y0 + BAND - 1;
    const px = Math.round(X0 + sv.x * U - 5);
    let name = 'pip', flip = false;
    if (sim.status === 'clear') name = Math.floor(t * 4) % 2 ? 'pipCheer' : 'pip';
    else if (sv.catchT > 0) name = 'pipCheer';
    else if (sv.moving) name = Math.floor(sv.run * 10) % 2 ? 'pipWalk1' : 'pipWalk2';
    else if (sv.x < 0.7 && (sv.fill > 0 || sv.throwT > 0)) { name = 'pipPour'; flip = true; }
    if (sv.moving) flip = sv.face < 0;
    const hopUp = sv.hop > 0 ? Math.round(Math.sin((sv.hop / 0.12) * Math.PI) * 3) : 0;
    g.drawImage(spr(name, flip), px, feet - 16 - hopUp);
    // the glass under the tap
    if (sv.fill > 0 && sv.x < 0.7) {
      const dc = DRINK[sim.V.id], by = y0 + COUNTER_Y;
      glass(X0 - 2, by, sv.fill, dc);
      if (sv.fill < 1 || sv.over > 0) rect(X0, y0 + 17, 1, by - 7 - (y0 + 17) - Math.round(sv.fill * 6) + 6, dc); // the stream
      if (sv.over > 0.2 && Math.floor(t * 12) % 2) rect(X0 - 3, by - 8, 7, 1, dc); // foaming over
    }
  }

  // ---------- the counters scene ----------
  function drawScene(app, t) {
    const sim = app.sim, V = sim.V;
    usePal(V.id);
    g.drawImage(venueLayer(sim), 0, 0);
    const dc = DRINK[V.id];
    // little live touches
    if (V.id === 'pier') {
      for (let k = 0; k < 8; k++) rect((k * 47 + t * 9) % W, 60 + ((k * 29) % 130), 3, 1, 3);
    } else if (V.id === 'moon') {
      for (let k = 0; k < 6; k++) if (Math.floor(t * 2 + k * 1.7) % 3 === 0) rect((k * 89) % W, 20 + ((k * 53) % 170), 1, 1, 3);
    } else if (V.id === 'market') {
      for (let r = 0; r < ROWS; r++) for (let k = 0; k < 8; k++) {
        const lx = 52 + k * 34, ly = rowY(r) + 11 + Math.round(Math.sin(lx / 14) * 2);
        rect(lx, ly, 4, 5, 2);
        if ((k + r + Math.floor(t * 3)) % 4) rect(lx + 1, ly + 1, 2, 3, 3);
      }
    } else {
      for (let r = 0; r < ROWS; r++) if (Math.floor(t * 5 + r) % 3 === 0) rect(70 + (r * 80) % 240, rowY(r) + 10, 1, 1, 3); // snow past a window
    }
    sim.rows.forEach((row, r) => {
      const y0 = rowY(r), cy = y0 + COUNTER_Y, ex = X0 + row.len * U;
      // an open door while someone passes
      if (doorT[r] > 0) { rect(ex + 1, y0 + 5, 8, COUNTER_Y - 5, 1); rect(ex + 1, y0 + 5, 3, COUNTER_Y - 5, 0); }
      for (const c of row.cust) drawCustomer(c, r, sim, t);
      // redraw the counter top over the customers' waists
      rect(X0 - 6, cy, ex - X0 + 8, 1, 3);
      rect(X0 - 6, cy + 1, ex - X0 + 8, 2, 1);
      for (const tp of row.tips) {
        if (tp.t > 7 && Math.floor(t * 8) % 2) continue;
        g.drawImage(spr('coin'), Math.round(X0 + tp.x * U - 2), cy - 4);
      }
      for (const gl of row.glasses) {
        const gx = X0 + gl.x * U - 2;
        if (gl.full) glass(gx, cy, 1, dc); else glass(gx, cy, 0, dc, false);
      }
    });
    drawPip(sim, t);
    // the customer who climbed over
    if (sim.status === 'miss' && sim.miss) {
      const m = sim.miss, y0 = rowY(m.row), cy = y0 + COUNTER_Y;
      if (m.cause === 'grab') g.drawImage(spr('custGrab', false, '2'), X0 - 6, cy - 12);
      if (Math.floor(t * 6) % 2) {
        const mx = m.cause === 'crash' ? X0 + sim.rows[m.row].len * U + 5 : X0 - 2;
        rect(mx - 6, cy - 14, 13, 1, 3); rect(mx - 6, cy + 6, 13, 1, 3); rect(mx - 6, cy - 14, 1, 21, 3); rect(mx + 6, cy - 14, 1, 21, 3);
      }
    }
    drawParts();
  }

  function hud(app, t) {
    const sim = app.sim, best = Math.max(app.scores[0]?.score ?? 0, sim.score);
    rect(0, 0, W, HUD_H, 0);
    if (sim.show) { marquee(sim, t); return; }
    text(pad6(sim.score), 3, 3, 3);
    text('HI ' + pad6(best), 66, 3, 1);
    const V = sim.V;
    if (sim.mode === 'bonus') { text('BONUS ROUND', 150, 3, 2); return; }
    text(`${V.name.split(' ')[0]} ${sim.screen + 1}-${V.screens}`, 150, 3, 2);
    // spare lives as glasses, clear of the touch pause button; then the customers still to serve
    for (let i = 0; i < Math.min(sim.lives - 1, 5); i++) glass(W - 22 - i * 8, 10, 1, DRINK[V.id] ?? 2);
    const left = sim.quota - sim.served;
    rtext(String(left), W - 22 - Math.min(5, Math.max(0, sim.lives - 1)) * 8 - 2, 3, 3);
  }
  // the tip's street show marches across the top
  function marquee(sim, t) {
    const S = sim.show, k = S.kind, f = Math.floor(t * 4) % 2 ? 1 : 2;
    const p = S.t / SHOW_T, px = -40 + p * (W + 60);
    const names = { band: ['tuba', 'drum'], juggler: ['jug', 'jug'], dragon: ['dragon', 'dragon'], rover: ['rover', 'rover'] }[k];
    g.drawImage(spr(names[0] + f), Math.round(px), 0);
    g.drawImage(spr(names[1] + (3 - f)), Math.round(px - 16), 0);
    if (k === 'dragon') for (let i = 1; i < 4; i++) rect(Math.round(px - 4 - i * 9), 5 + Math.round(Math.sin(t * 8 + i) * 2), 9, 3, i % 2 ? 2 : 3);
    for (let i = 0; i < 3; i++) g.drawImage(spr('note'), Math.round(px + 14 + i * 9), 1 + ((Math.floor(t * 6) + i) % 3));
    const label = sim.V.showName.toUpperCase() + '!';
    const lx = px < W / 2 ? W - textWidth(label) - 4 : 4;
    text(label, lx, 3, Math.floor(t * 4) % 2 ? 3 : 2);
  }

  // ---------- the bonus round ----------
  const PAD_POS = [[160, 52], [212, 92], [160, 132], [108, 92]];
  const PAD_W = 40, PAD_H = 30;
  function padIcon(k, cx, cy, lit) {
    const c = lit ? 0 : 3, d = lit ? 0 : [2, 1, 3, 2][k];
    if (k === 0) { rect(cx - 3, cy - 8, 7, 12, c); rect(cx - 2, cy - 6, 5, 9, d); rect(cx + 1, cy - 12, 1, 5, c); } // tall shake
    else if (k === 1) { rect(cx - 5, cy - 5, 9, 9, c); rect(cx - 4, cy - 4, 7, 6, d); rect(cx + 4, cy - 3, 2, 1, c); rect(cx + 5, cy - 3, 1, 4, c); rect(cx + 4, cy, 2, 1, c); } // mug
    else if (k === 2) { rect(cx - 4, cy - 8, 9, 12, c); rect(cx - 3, cy - 6, 7, 9, d); for (let i = 0; i < 3; i++) rect(cx - 2 + i * 2, cy + 1, 1, 1, c); rect(cx + 2, cy - 12, 1, 5, c); } // bubble tea
    else { rect(cx - 5, cy - 6, 11, 2, c); rect(cx - 4, cy - 4, 9, 8, c); rect(cx - 3, cy - 3, 7, 6, d); rect(cx - 2, cy - 10, 5, 4, c); } // float with a scoop
  }
  function drawBonus(app, t) {
    usePal('bonus');
    const b = app.sim.bonus;
    rect(0, 0, W, H, 0);
    for (let k = 0; k < 50; k++) rect((k * 61) % W, 14 + ((k * 37) % 180), 1, 1, 1);
    hud(app, t);
    ctext('ORDER UP!', 18, 3, 2, 2);
    const names = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
    PAD_POS.forEach(([cx, cy], k) => {
      const lit = b.lit === k, bad = b.phase === 'fail' && b.wrong === k && Math.floor(t * 8) % 2;
      const x = cx - PAD_W / 2, y = cy - PAD_H / 2;
      rect(x, y, PAD_W, PAD_H, bad ? 2 : lit ? 3 : 1);
      rect(x + 1, y + 1, PAD_W - 2, PAD_H - 2, lit || bad ? (bad ? 2 : 3) : 0);
      if (!lit && !bad) dither(x + 2, y + 2, PAD_W - 4, PAD_H - 4, 1, 0.12);
      padIcon(k, cx, cy + 2, lit || bad);
      if (app.input && !app.touch?.active) text(names[k][0], x + 2, y + 2, lit ? 0 : 1);
    });
    // the customer in the middle, calling the order
    const calling = b.phase === 'show' && b.lit >= 0;
    g.drawImage(spr(calling ? 'custLook' : 'cust', false, '2'), 155, 84);
    g.drawImage(spr('hat:bonus', false, '2', HATS.pier[1]), 155, 84);
    // round pips
    const R = b.B.rounds;
    R.forEach((n, i) => rect(160 - R.length * 6 + i * 12, 164, 8, 4, i < b.got ? 3 : i === b.round ? 2 : 1));
    let msg = '';
    if (b.phase === 'intro') msg = 'REMEMBER THE ORDER, THEN REPEAT IT';
    else if (b.phase === 'show') msg = `ROUND ${b.round + 1}: WATCH THE ORDER`;
    else if (b.phase === 'input') msg = `YOUR TURN  ${b.idx}/${R[b.round]}`;
    else if (b.phase === 'good') msg = 'ORDER UP!';
    else if (b.phase === 'fail') msg = 'WRONG ORDER!';
    else if (b.phase === 'perfect' || b.phase === 'done') msg = 'PERFECT MEMORY!  +2000';
    ctext(msg, 174, b.phase === 'fail' ? 2 : 3);
    ctext(`BONUS ${b.points}`, 183, 1);
    if (b.phase === 'intro' && app.input) prompt(app.input, '{pads} OR TAP THE PADS', 160, 152, 1, 'center');
    drawParts();
  }

  // ---------- screens ----------
  function drawTitle(app, t) {
    usePal('title');
    rect(0, 0, W, H, 0);
    for (let k = 0; k < 40; k++) rect((k * 83) % W, (k * 47) % H, 1, 1, 1);
    // a big glass filling, brimming and starting over
    const ph = (t * 0.35) % 1, f = Math.min(1, ph * 1.4);
    const gx = 34, gy = 26;
    rect(gx, gy, 2, 34, 3); rect(gx + 20, gy, 2, 34, 3); rect(gx, gy + 34, 22, 2, 3);
    rect(gx + 2, gy + 34 - Math.round(f * 32), 18, Math.round(f * 32), 2);
    if (f >= 1) { rect(gx - 1, gy - 3, 24, 3, 3); for (let i = 0; i < 3; i++) rect(gx + 4 + i * 6, gy + 6 + ((Math.floor(t * 10) + i * 3) % 24), 2, 2, 3); }
    rect(gx + 14, gy - 14, 2, 18, 1); rect(gx + 14, gy - 14, 8, 2, 1); // straw
    text('BRIMFUL', 78, 28, 2, 4); text('BRIMFUL', 76, 26, 3, 4);
    text('A SODA FOUNTAIN FRENZY', 78, 60, 1);
    const items = app.titleItems();
    items.forEach((it, i) => {
      const m = menuBox(app, i), on = i === app.menu;
      if (on) { rect(m.x + 10, m.y, m.w - 20, 11, 2); text('>', m.x + 14, m.y + 2, 3); }
      ctext(m.name, m.y + 2, on ? 3 : 1);
    });
    const input = app.input, kb = input.device.kind === 'keyboard';
    const extra = [['pause', 'PAUSE']];
    if (kb) extra.push(['sound', app.soundOn ? 'SOUND ON' : 'SOUND OFF']);
    if (app.onExit) extra.push(['quit', 'EXIT']);
    const ly = items.length > 3 ? 130 : 128 + (items.length - 2) * 8;
    [[['switch', 'COUNTER'], ['walk', 'WALK']], [['pour', 'HOLD TO FILL, LET GO TO SLIDE']], extra].forEach((r, i) => legend(input, [r], ly + i * 12, 12, i === 1 ? 3 : 1));
    if (Math.floor(t * 2) % 2) prompt(input, 'PRESS {start}', 160, 172, 2, 'center');
    ctext('FILL TO THE BRIM · CATCH EVERY EMPTY', 189, 1);
  }
  // a title entry's box (shared with the touch test); four entries sit closer together
  const NAMES = { play: 'PLAY', scores: 'HIGH SCORES', exit: 'EXIT' };
  function menuBox(app, i) {
    const items = app.titleItems(), n = items.length, it = items[i];
    const name = it === 'continue' ? `CONTINUE  ${app.saved?.label ?? ''}` : NAMES[it];
    const w = Math.max(120, textWidth(name, 1) + 44);
    return { x: Math.round((W - w) / 2), y: (n > 3 ? 74 : 82) + i * (n > 3 ? 12 : 13), w, h: n > 3 ? 12 : 13, name };
  }
  function drawScores(app, t) {
    usePal('title');
    rect(0, 0, W, H, 0);
    ctext('BEST SERVERS', 14, 3, 2, 2);
    app.scores.forEach((s, i) => {
      const y = 40 + i * 15, on = i === app.newRank && Math.floor(t * 4) % 2;
      const venue = VENUES[s.venue ?? 0]?.name ?? '';
      text(`${i + 1}.`, 40, y, on ? 3 : 1);
      text(s.name, 62, y, on ? 2 : 3);
      text(pad6(s.score), 100, y, 3);
      text((s.loop ? `TOUR ${s.loop + 1} ` : '') + venue.toUpperCase(), 150, y, on ? 2 : 1);
    });
    if (Math.floor(t * 2) % 2) prompt(app.input, 'PRESS {start}', 160, 172, 2, 'center');
  }
  function drawCard(app, t) {
    const sim = app.sim;
    if (sim.mode === 'bonus') {
      usePal('bonus'); rect(0, 0, W, H, 0);
      ctext('BONUS ROUND', 50, 2, 1);
      ctext('ORDER UP!', 66, 3, 3, 2);
      wrap('THE CUSTOMER CALLS AN ORDER. REPEAT IT ON THE FOUR PADS. EACH ROUND IS ONE LONGER.', 260).forEach((l, i) => ctext(l, 110 + i * 10, 1));
      return;
    }
    drawScene(app, t);
    hud(app, t);
    const V = sim.V;
    box(40, 60, 240, 80);
    ctext(V.name.toUpperCase(), 72, 3, 2, 2);
    ctext(V.blurb.toUpperCase(), 94, 1);
    ctext(`SCREEN ${sim.screen + 1} OF ${V.screens}` + (sim.loop ? `  ·  TOUR ${sim.loop + 1}` : ''), 108, 3);
    ctext(`TODAY: ${V.drink.toUpperCase()}`, 122, 2);
  }
  function statusOverlay(app) {
    const sim = app.sim;
    if (sim.status === 'ready') {
      box(120, 88, 80, 22);
      ctext(sim.statusT < 0.9 ? 'READY' : 'SERVE!', 96, 3);
    } else if (sim.status === 'miss' && sim.statusT > 0.6) {
      const msg = { crash: 'A GLASS FLEW OFF THE END!', drop: 'AN EMPTY HIT THE FLOOR!', grab: 'A CUSTOMER GOT FED UP!' }[sim.miss?.cause] ?? '';
      box(40, 86, 240, 28);
      ctext(msg, 92, 3);
      ctext(sim.lives > 0 ? `${sim.lives} ${sim.lives === 1 ? 'LIFE' : 'LIVES'} LEFT` : 'LAST ONE...', 103, 2);
    } else if (sim.status === 'over' || app.state === 'over') {
      box(70, 76, 180, 46);
      ctext('CLOSING TIME', 84, 2, 2);
      ctext(`SCORE ${pad6(sim.score)}`, 106, 3);
    }
  }
  function drawClear(app, t) {
    drawScene(app, t);
    hud(app, t);
    const sim = app.sim;
    box(70, 70, 180, 60);
    ctext('SCREEN CLEAR!', 80, 3, 2, 2);
    ctext(`${sim.tally?.served ?? 0} SERVED`, 100, 1);
    ctext(`BONUS ${sim.tally?.bonus ?? 0}`, 112, 3);
    for (let i = 0; i < 6; i++) g.drawImage(spr('heart'), 80 + i * 30, 60 + Math.round(Math.sin(t * 5 + i) * 3));
  }
  function drawPause(app, t) {
    drawGame(app, t);
    box(80, 70, 160, 60);
    ctext('PAUSED', 80, 3, 2);
    prompt(app.input, '{pause} RESUME', 160, 102, 3, 'center');
    prompt(app.input, '{quit} QUIT TO TITLE', 160, 116, 1, 'center');
  }
  function drawInitials(app) {
    usePal('title');
    rect(0, 0, W, H, 0);
    ctext('A NEW HIGH SCORE!', 24, 2, 2);
    ctext(pad6(app.sim.score), 48, 3, 2);
    ctext('ENTER YOUR INITIALS', 76, 1);
    const E = app.entry;
    for (let i = 0; i < 3; i++) {
      const x = 118 + i * 30, on = i === E.pos;
      if (on) { rect(x - 3, 92, 22, 26, 2); rect(x - 2, 93, 20, 24, 0); }
      text(LETTERS[E.letters[i]], x + 2, 98, on ? 3 : 1, 2);
      if (on) { text('+', x + 5, 84, 3); text('-', x + 5, 121, 3); }
    }
    rect(214, 98, 34, 15, 1); rect(215, 99, 32, 13, 0); text('OK', 225, 102, 3);
    prompt(app.input, '{letters} PICK  {start} NEXT', 160, 150, 3, 'center');
    ctext('OR TYPE THEM', 164, 1);
  }
  function drawTouch(app) {
    const T = app.touch;
    if (!T?.active || (app.state !== 'play' && app.state !== 'bonus')) return;
    rect(W - 13, 0, 13, HUD_H, 0); rect(W - 10, 3, 2, 7, 3); rect(W - 6, 3, 2, 7, 3); // pause
    if (app.state !== 'play') return;
    const on = T.pour, x = W - 34, y = H - 30;
    rect(x, y, 32, 28, on ? 3 : 1); rect(x + 1, y + 1, 30, 26, 0);
    glass(x + 13, y + 19, on ? 1 : 0.4, on ? 2 : 1);
    text('POUR', x + 5, y + 20, on ? 3 : 1);
  }

  function drawGame(app, t) {
    const sim = app.sim;
    if (sim.mode === 'bonus') { drawBonus(app, t); return; }
    drawScene(app, t);
    hud(app, t);
    statusOverlay(app);
  }

  let lastT = 0;
  function draw(app) {
    const t = app.t, dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    stepParts(dt);
    g.save();
    if (shake > 0) g.translate(Math.round((rand() - 0.5) * 4 * shake), Math.round((rand() - 0.5) * 4 * shake));
    switch (app.state) {
      case 'title': drawTitle(app, t); break;
      case 'scores': drawScores(app, t); break;
      case 'card': drawCard(app, t); break;
      case 'clear': drawClear(app, t); break;
      case 'pause': drawPause(app, t); break;
      case 'initials': drawInitials(app); break;
      default: drawGame(app, t); if (app.demo && app.sim.status === 'clear') drawClear(app, t);
    }
    g.restore();
    if (flash > 0) { g.fillStyle = P[3]; g.globalAlpha = 1; if (Math.floor(flash * 40) % 2) g.fillRect(0, HUD_H + 1, W, 1); }
    if (app.demo) {
      rect(0, H - 9, W, 9, 0);
      ctext('DEMO · BRIMFUL', H - 8, Math.floor(t * 2) % 2 ? 3 : 1);
    }
    drawTouch(app);
    // fade: CGA can't dim, so wipe in black bands
    if (app.fade > 0) for (let y = 0; y < H; y += 8) rect(0, y, W, Math.ceil(8 * Math.min(1, app.fade)), '#000000');
  }

  // ---------- touch targets ----------
  function hit(x, y, app) {
    const inside = (rx, ry, w, h) => x >= rx && x < rx + w && y >= ry && y < ry + h;
    switch (app.state) {
      case 'title': {
        const items = app.titleItems();
        for (let i = 0; i < items.length; i++) { const m = menuBox(app, i); if (inside(m.x, m.y, m.w, m.h)) return { act: 'menu', i }; }
        return null;
      }
      case 'play': {
        if (inside(W - 16, 0, 16, 16)) return { act: 'pause' };
        if (inside(W - 36, H - 32, 36, 32)) return { act: 'pour' };
        const r = Math.floor((y - TOP) / BAND);
        if (r < 0 || r >= ROWS) return null;
        const len = app.sim.rows[r]?.len ?? 16;
        return { act: 'row', row: r, x: Math.max(0, Math.min(len - 1.2, (x - X0) / U)) };
      }
      case 'bonus': {
        if (inside(W - 16, 0, 16, 16)) return { act: 'pause' };
        for (let k = 0; k < 4; k++) { const [cx, cy] = PAD_POS[k]; if (inside(cx - PAD_W / 2 - 4, cy - PAD_H / 2 - 4, PAD_W + 8, PAD_H + 8)) return { act: 'pad', pad: k }; }
        return null;
      }
      case 'initials': {
        if (inside(210, 94, 42, 23)) return { act: 'ok' };
        const i = Math.floor((x - 113) / 30);
        if (i >= 0 && i < 3 && y >= 78 && y < 132) {
          if (i !== app.entry.pos) return { act: i < app.entry.pos ? 'left' : 'right' };
          return { act: y < 105 ? 'up' : 'down' };
        }
        return null;
      }
    }
    return null;
  }

  return { draw, events, hit, destroy() { unfit(); } };
}
