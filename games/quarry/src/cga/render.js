// The CGA renderer: 320 × 200 in four colours, shown at 4:3, integer-scaled and letterboxed.
// Each level picks one of the card's palettes. The soil is painted once per level into a
// layer and the tunnels are cut into it as the extents grow; sprites are baked per palette.
// It only reads `app` and `sim.s`.
//
//   const view = createCgaRenderer(canvas, app);
//   view.level(sim); view.events(sim.events, sim); view.draw(app);
import { drawPrompt } from '@nostalgia/input';
import { fitPixels } from '@nostalgia/game/runtime';
import { COLS, GOLD_LIFE, ROWS, SCORE, STREAK, U } from '../sim.js';
import { layout as touchLayout } from '../touch.js';
import { drawText, textWidth } from './font.js';
import { makeSprites } from './sprites.js';

export const W = 320, H = 200;
const FY = 22, CW = 20, CH = 16; // field top, cell size in pixels
const FW = COLS * CW, FH = ROWS * CH;
// palette 0 low (green, red, brown), 1 high (cyan, magenta, white), 0 high, 1 low
const PALS = [
  ['#000000', '#00aa00', '#aa0000', '#aa5500'],
  ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  ['#000000', '#55ff55', '#ff5555', '#ffff55'],
  ['#000000', '#00aaaa', '#aa00aa', '#aaaaaa'],
];
// soil textures (4 × 4, palette indices), three bands per level: topsoil, middle, deep
const TEX = [
  ['3333', '3033', '3333', '3330'], ['3323', '3333', '2333', '3333'], ['3232', '2323', '3232', '2323'],
  ['3030', '0303', '3030', '0303'], ['2222', '2022', '2222', '2220'], ['3333', '3333', '3030', '3333'],
  ['2323', '3333', '3232', '3333'], ['3203', '0332', '3023', '2330'],
];
const BANDS = [[0, 1, 2], [5, 6, 4], [1, 7, 3], [0, 2, 4], [6, 1, 3], [5, 7, 2], [1, 0, 4], [7, 2, 3]];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function createCgaRenderer(cv) {
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  // 320 × 200 at 4:3, a whole multiple when the window allows
  const unfit = fitPixels(cv, { width: 320, height: 240, snap: 1 });

  const sprites = PALS.map(() => null);
  let P = PALS[0], S = null;
  function usePalette(i) { P = PALS[i]; S = sprites[i] ??= makeSprites(P); }
  usePalette(0);

  // ---------- the soil layer and its tunnels ----------
  const field = document.createElement('canvas');
  field.width = FW; field.height = FH;
  const fg = field.getContext('2d');
  let seen = null, loadId = -1;
  function paintSoil(level) {
    const bands = BANDS[level % BANDS.length];
    for (let y = 0; y < FH; y++) {
      const band = bands[Math.min(2, Math.floor(y / CH / 4))], tex = TEX[band][y & 3];
      for (let x = 0; x < FW; x++) { fg.fillStyle = P[+tex[x & 3]]; fg.fillRect(x, y, 1, 1); }
    }
    // a thin seam between the bands
    fg.fillStyle = P[0];
    for (let x = 0; x < FW; x += 2) { fg.fillRect(x, 4 * CH - 1, 1, 1); fg.fillRect(x + 1, 8 * CH - 1, 1, 1); }
  }
  const cut = (x, y, w, h) => { fg.fillStyle = P[0]; fg.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  function cutCell(i) { const cx = (i % COLS) * CW + CW / 2, cy = Math.floor(i / COLS) * CH + CH / 2; cut(cx - 8, cy - 6, 16, 12); }
  function cutEdge(i, horiz, a, b) {
    const cx = (i % COLS) * CW + CW / 2, cy = Math.floor(i / COLS) * CH + CH / 2;
    if (horiz) {
      if (a) cut(cx - 8, cy - 6, a * (CW / U) + 16, 12);
      if (b) cut(cx + CW - b * (CW / U) - 8, cy - 6, b * (CW / U) + 16, 12);
    } else {
      if (a) cut(cx - 8, cy - 6, 16, a * (CH / U) + 12);
      if (b) cut(cx - 8, cy + CH - b * (CH / U) - 6, 16, b * (CH / U) + 12);
    }
  }
  function syncTunnels(s) {
    if (s.loadId !== loadId) {
      loadId = s.loadId;
      usePalette(s.level % PALS.length);
      paintSoil(s.level);
      seen = { cell: new Uint8Array(s.cell.length), hA: new Uint8Array(s.cell.length), hB: new Uint8Array(s.cell.length), vA: new Uint8Array(s.cell.length), vB: new Uint8Array(s.cell.length), ver: -1 };
    }
    if (seen.ver === s.digVer) return;
    seen.ver = s.digVer;
    for (let i = 0; i < s.cell.length; i++) {
      if (s.cell[i] && !seen.cell[i]) { cutCell(i); seen.cell[i] = 1; }
      if (s.hA[i] !== seen.hA[i] || s.hB[i] !== seen.hB[i]) { cutEdge(i, true, s.hA[i], s.hB[i]); seen.hA[i] = s.hA[i]; seen.hB[i] = s.hB[i]; }
      if (s.vA[i] !== seen.vA[i] || s.vB[i] !== seen.vB[i]) { cutEdge(i, false, s.vA[i], s.vB[i]); seen.vA[i] = s.vA[i]; seen.vB[i] = s.vB[i]; }
    }
  }

  // ---------- text, prompts, boxes ----------
  const text = (s, x, y, c = 3, sc = 1) => drawText(g, s, x, y, typeof c === 'number' ? P[c] : c, sc);
  const ctext = (s, y, c = 3, sc = 1) => text(s, Math.round((W - textWidth(s, sc)) / 2), y, c, sc);
  const rtext = (s, xr, y, c = 3) => text(s, xr - textWidth(s), y, c);
  const style = () => ({
    pixel: true, brand: false, measure: s => textWidth(s),
    text: (cx, s, x, y, col) => drawText(g, s, Math.round(x - textWidth(s) / 2), Math.round(y - 3.5), col),
    cap: P[3], edge: P[2], capInk: P[0], pad: P[1], padInk: P[0], ink: P[3], dim: P[1],
  });
  const prompt = (input, s, y, c = 3) => drawPrompt(g, input, s, W / 2, y + 3.5, { size: 9, gap: 3, color: P[c], align: 'center', style: style() });
  function box(x, y, w, h, edge = 2) {
    g.fillStyle = P[0]; g.fillRect(x - 2, y - 2, w + 4, h + 4);
    g.fillStyle = P[edge]; g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
  }
  // ordered-dither veil: f = share of pixels blacked out
  const veils = [];
  function veil(f) {
    const k = Math.max(0, Math.min(16, Math.round(f * 16)));
    if (!k) return;
    if (!veils[k]) {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const cg = c.getContext('2d');
      cg.fillStyle = '#000';
      for (let i = 0; i < 16; i++) if (BAYER[i] < k) cg.fillRect(i & 3, i >> 2, 1, 1);
      veils[k] = g.createPattern(c, 'repeat');
    }
    g.fillStyle = veils[k]; g.fillRect(0, 0, W, H);
  }
  function ring(cx, cy, r, c) {
    g.fillStyle = P[c];
    for (let a = 0; a < 64; a++) { const t = (a / 64) * Math.PI * 2; g.fillRect(Math.round(cx + Math.cos(t) * r), Math.round(cy + Math.sin(t) * r), 1, 1); }
  }

  // ---------- effects ----------
  let parts = [], pops = [], flash = 0, shake = 0;
  const px = x => x * (CW / U) + CW / 2, py = y => y * (CH / U) + CH / 2 + FY;
  function burst(x, y, n, cols, sp = 40) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random() * 0.7); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 0.4 + Math.random() * 0.4, c: cols[i % cols.length] }); }
  }
  function events(list) {
    for (const e of list) {
      const x = px(e.x), y = py(e.y);
      switch (e.type) {
        case 'dig': if (Math.random() < 0.5) burst(x, y, 2, [3, 2], 25); break;
        case 'gem': burst(x, y, 5, [1, 3], 35); break;
        case 'streak': pops.push({ x, y: y - 6, s: String(SCORE.streak), t: 1.2, c: 1 }); break;
        case 'score': if (e.n >= SCORE.kill && e.n !== SCORE.streak) pops.push({ x, y: y - 6, s: String(e.n), t: 1, c: 3 }); break;
        case 'burst': burst(x, y, 14, [3, 2, 3], 60); shake = 0.2; break;
        case 'thud': shake = 0.1; burst(x, y + 6, 4, [3], 20); break;
        case 'kill': burst(x, y, 12, e.how === 'eat' ? [1, 3] : [2, 3], 55); break;
        case 'fizzle': burst(x, y, 4, [3, 1], 30); break;
        case 'die': flash = 0.25; shake = 0.3; burst(x, y, 20, [1, 3, 2], 70); break;
        case 'bonus': flash = 0.12; break;
        case 'gemlost': burst(x, y, 4, [1], 20); break;
      }
    }
  }
  function stepFx(dt) {
    for (const p of parts) { p.life -= dt; p.vy += 120 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    parts = parts.filter(p => p.life > 0);
    for (const p of pops) { p.t -= dt; p.y -= 12 * dt; }
    pops = pops.filter(p => p.t > 0);
    flash = Math.max(0, flash - dt); shake = Math.max(0, shake - dt);
  }

  // ---------- the play field ----------
  const blit = (img, x, y) => g.drawImage(img, Math.round(x), Math.round(y));
  function drawField(app, t) {
    const s = app.sim.s, blink = Math.floor(t * 8) % 2;
    syncTunnels(s);
    const sx = shake > 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
    g.save();
    g.translate(sx, 0);
    g.drawImage(field, 0, FY);
    // gems, set in a pocket of black so they read on any soil
    for (let i = 0; i < s.gem.length; i++) {
      if (!s.gem[i]) continue;
      const x = (i % COLS) * CW + CW / 2, y = Math.floor(i / COLS) * CH + CH / 2 + FY;
      g.fillStyle = P[0]; g.fillRect(x - 5, y - 4, 10, 9);
      blit(S.gem, x - 4, y - 3);
      if ((i * 7 + Math.floor(t * 3)) % 23 === 0) { g.fillStyle = P[3]; g.fillRect(x - 1, y - 3, 1, 1); g.fillRect(x - 2, y - 2, 3, 1); }
    }
    for (const gd of s.gold) {
      if (gd.t > GOLD_LIFE - 3 && blink) continue;
      blit(S.gold, px(gd.x) - 6, py(gd.y) - 1);
    }
    if (s.bonus.state === 'shown') blit(S.lamp[Math.floor(t * 4) % 2], px(s.bonus.x) - 4, py(s.bonus.y) - 5);
    for (const c of s.crates) {
      const wob = c.state === 'wobble' ? (Math.floor(c.t * 16) % 2 ? 1 : -1) : 0;
      blit(S.crate, px(c.x) - 7 + wob, py(c.y) - 6);
    }
    // grubs
    for (const m of s.mons) {
      const x = px(m.x), y = py(m.y), f = Math.floor((t + m.id * 0.13) * 7) % 2;
      let img = s.frenzy > 0 ? S.scared[f] : m.kind === 'burrower' ? S.borer[f] : S.walker[f];
      if (s.frenzy > 0 && s.frenzy < 2 && blink) img = S.walker[f];
      if (m.state === 'morph' && blink) img = m.to === 'burrower' ? S.borer[f] : S.walker[f];
      if (m.state === 'emerge') {
        const k = Math.min(1, m.t / 0.9), h = Math.max(1, Math.round(img.height * k));
        g.drawImage(img, 0, 0, img.width, h, Math.round(x - 7), Math.round(y + 5 - h), img.width, h);
      } else blit(img, x - 7, y - 5);
    }
    // the drill
    const h = s.hero;
    if (s.status !== 'dying' || (s.statusT < 1.4 && blink)) {
      const face = s.status === 'dying' ? Math.floor(s.statusT * 10) % 4 : h.face;
      const img = S.drill[face][h.moving ? Math.floor(t * 12) % 2 : 0];
      const showLamp = s.frenzy > 0 && blink;
      blit(img, px(h.x) - img.width / 2, py(h.y) - img.height / 2);
      if (showLamp) { g.fillStyle = P[3]; g.fillRect(Math.round(px(h.x)) - 1, Math.round(py(h.y)) - 8, 2, 2); }
    }
    if (s.shot) {
      const x = Math.round(px(s.shot.x)), y = Math.round(py(s.shot.y));
      g.fillStyle = P[blink ? 3 : 1]; g.fillRect(x - 2, y - 2, 4, 4);
      g.fillStyle = P[blink ? 1 : 3]; g.fillRect(x - 1, y - 1, 2, 2);
    }
    for (const p of parts) { g.fillStyle = P[p.c]; g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
    for (const p of pops) { const w = textWidth(p.s); text(p.s, p.x - w / 2, p.y - 3, p.c); }
    g.restore();
  }
  function drawHud(app, t) {
    const s = app.sim.s;
    g.fillStyle = P[0]; g.fillRect(0, 0, W, FY);
    text('SCORE', 4, 3, 2);
    text(String(s.score).padStart(6, '0'), 38, 3, 3);
    for (let k = 0; k < Math.min(s.lives, 7); k++) blit(S.life, 4 + k * 11, 12);
    const lv = `LEVEL ${s.level + 1}`;
    text(lv, Math.round(W / 2 - textWidth(lv) / 2), 3, 3);
    text(s.name, Math.round(W / 2 - textWidth(s.name) / 2), 12, 1);
    if (app.demo) { if (Math.floor(t * 2) % 2) rtext('DEMO', W - 4, 3, 2); }
    else rtext('HI ' + String(app.hi).padStart(6, '0'), W - 4, 3, 2);
    // the shot's charge, or the lamp running down
    const lamp = s.frenzy > 0, k = lamp ? s.frenzy / s.P.frenzy : 1 - s.reload / s.P.reload;
    const bx = W - 4 - 40, by = 13;
    text(lamp ? 'LAMP' : 'SHOT', bx - 28, 12, lamp ? 1 : 3);
    g.fillStyle = P[2]; g.fillRect(bx, by, 40, 5);
    g.fillStyle = P[0]; g.fillRect(bx + 1, by + 1, 38, 3);
    const full = !lamp && k >= 1;
    if (!full || Math.floor(t * 4) % 2) { g.fillStyle = P[lamp ? 1 : full ? 3 : 1]; g.fillRect(bx + 1, by + 1, Math.round(38 * Math.min(1, k)), 3); }
    g.fillStyle = P[2];
    for (let x = 0; x < W; x += 2) g.fillRect(x, FY - 2, 1, 1);
  }
  function drawBanners(app, t) {
    const s = app.sim.s;
    if (s.status === 'ready') {
      box(96, 80, 128, 38, 1);
      ctext(`LEVEL ${s.level + 1}`, 87, 3);
      ctext(s.name, 98, 1);
      if (Math.floor(t * 3) % 2) ctext(s.levelT > 0 ? 'TRY AGAIN' : 'GET READY', 108, 2);
    } else if (s.status === 'clear' && s.statusT > 0.4) {
      box(92, 84, 136, 28, 3);
      ctext('LEVEL CLEAR', 90, 3);
      ctext(s.gems ? 'THE GRUBS ARE GONE' : 'EVERY GEM TAKEN', 100, 1);
    } else if (s.status === 'over') {
      box(100, 88, 120, 20, 2);
      ctext('GAME OVER', 95, 3);
    }
    if (s.streak >= 3 && s.status === 'play' && s.t - s.lastGem < 1.25) {
      const k = `${s.streak}/${STREAK}`;
      text(k, W - 4 - textWidth(k), FY + 2, 1);
    }
  }
  function drawTouch(app) {
    const T = app.touch;
    if (!T?.active || app.state !== 'play') return;
    const L = touchLayout(W, H);
    if (T.stick) { ring(T.stick.x0, T.stick.y0, L.stickR, 1); g.fillStyle = P[3]; g.fillRect(Math.round(T.stick.x) - 2, Math.round(T.stick.y) - 2, 5, 5); }
    ring(L.fire.x, L.fire.y, L.fire.r, T.fire ? 3 : 2);
    text('FIRE', L.fire.x - 11, L.fire.y - 3, T.fire ? 3 : 2);
    ring(L.pause.x, L.pause.y, L.pause.r, 1);
    g.fillStyle = P[1]; g.fillRect(Math.round(L.pause.x) - 3, Math.round(L.pause.y) - 3, 2, 7); g.fillRect(Math.round(L.pause.x) + 1, Math.round(L.pause.y) - 3, 2, 7);
  }

  // ---------- screens ----------
  const logoFill = r => P[r < 2 ? 3 : r < 5 ? 2 : 1];
  function drawLogo(y) {
    const s = 'QUARRY', w = textWidth(s, 4);
    drawText(g, s, Math.round((W - w) / 2), y, logoFill, 4);
    blit(S.drill[0][Math.floor(Date.now() / 120) % 2], Math.round((W - w) / 2) - 26, y + 7);
    blit(S.gem, Math.round((W + w) / 2) + 8, y + 10);
  }
  // the title's menu rows: three (CONTINUE, PLAY, EXIT) sit a little higher and closer
  const itemY = (n, k) => (n > 2 ? 156 + k * 9 : 160 + k * 10);
  function drawTitle(app, t) {
    g.fillStyle = P[0]; g.fillRect(0, 0, W, H);
    // a band of soil at top and bottom
    for (let y = 0; y < 6; y++) for (let x = 0; x < W; x++) {
      g.fillStyle = P[+TEX[0][y & 3][x & 3]]; g.fillRect(x, y, 1, 1);
      g.fillStyle = P[+TEX[2][y & 3][x & 3]]; g.fillRect(x, H - 6 + y, 1, 1);
    }
    drawLogo(14);
    ctext('DIG  ·  GATHER  ·  DROP  ·  RUN', 48, 1);
    if (app.page === 0) {
      ctext('HOW TO DIG', 62, 2);
      const rows = [
        [S.gem, `GEM ${SCORE.gem}`, `${STREAK} IN A ROW ${SCORE.streak}`],
        [S.gold, `GOLD ${SCORE.gold}`, 'DROP A CRATE 2 ROWS'],
        [S.walker[Math.floor(t * 6) % 2], `GRUB ${SCORE.kill}`, 'SHOOT OR CRUSH IT'],
        [S.borer[Math.floor(t * 6) % 2], 'BORER', 'EATS GEMS AND GOLD'],
        [S.lamp[Math.floor(t * 4) % 2], `LAMP ${SCORE.bonus}`, 'GRUBS RUN FROM IT'],
        [S.scared[Math.floor(t * 6) % 2], 'CATCH THEM', '200 400 800 ...'],
      ];
      rows.forEach(([img, a, b], k) => {
        const y = 74 + k * 12;
        blit(img, 48 - img.width / 2, y + 3 - img.height / 2);
        text(a, 66, y, 3);
        text(b, 150, y, 1);
      });
    } else {
      ctext('BEST DIGGERS', 62, 2);
      app.save.table.forEach((e, k) => {
        const y = 73 + k * 8, hl = k === app.rank;
        if (hl && Math.floor(t * 4) % 2) return;
        const c = hl ? 1 : 3;
        rtext(`${k + 1}.`, 104, y, 2);
        text(e.n, 112, y, c);
        rtext(String(e.s).padStart(6, '0'), 202, y, c);
        rtext(`L${e.l}`, 226, y, 2);
      });
    }
    const items = app.items();
    items.forEach((it, k) => {
      const label = it === 'continue' ? `CONTINUE · ${app.saved.label}`.toUpperCase() : it === 'play' ? 'PLAY' : 'EXIT TO DOS', y = itemY(items.length, k), sel = k === app.menu;
      const w = textWidth(label);
      text(label, (W - w) / 2, y, sel ? 3 : 1);
      if (sel && Math.floor(t * 3) % 2) { text('>', (W - w) / 2 - 10, y, 2); text('<', (W + w) / 2 + 4, y, 2); }
    });
    prompt(app.input, '{move} DIG  {fire} FIRE  {sound} SOUND', 186, 1);
  }
  function drawEntry(app, t) {
    g.fillStyle = P[0]; g.fillRect(0, 0, W, H);
    drawLogo(14);
    ctext('A NEW BEST DIGGER', 56, 2);
    ctext(`SCORE ${String(app.sim.s.score).padStart(6, '0')}   LEVEL ${app.sim.s.level + 1}`, 70, 3);
    ctext('ENTER YOUR INITIALS', 88, 1);
    const E = app.entry, x0 = W / 2 - 40;
    for (let k = 0; k < 3; k++) {
      const x = x0 + k * 28, sel = k === E.pos;
      drawText(g, E.letters[k], x, 104, P[sel ? 3 : 1], 3);
      if (!sel || Math.floor(t * 4) % 2) { g.fillStyle = P[sel ? 2 : 1]; g.fillRect(x - 1, 129, 17, 2); }
    }
    prompt(app.input, '{up} {down} LETTER   {fire} NEXT   {start} DONE', 150, 1);
  }

  // ---------- frame ----------
  let lastT = performance.now(), lastBorder = '#000';
  let lastApp = null;
  function draw(app) {
    lastApp = app;
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    stepFx(dt);
    const t = app.t;
    if (app.sim.s) syncTunnels(app.sim.s);
    if (app.state === 'title') drawTitle(app, t);
    else if (app.state === 'entry') drawEntry(app, t);
    else {
      g.fillStyle = P[0]; g.fillRect(0, 0, W, H);
      drawField(app, t);
      drawHud(app, t);
      drawBanners(app, t);
      if (app.state === 'pause') {
        veil(0.5);
        box(84, 78, 152, 40, 3);
        ctext('PAUSED', 86, 3);
        prompt(app.input, '{pause} PLAY ON   {quit} QUIT', 102, 1);
      }
      drawTouch(app);
    }
    // a flash is the border (overscan) colour, the way the card did it
    const border = flash > 0 && Math.floor(flash * 30) % 2 ? P[2] : '#000';
    if (border !== lastBorder) { lastBorder = border; document.body.style.background = border; }
    if (app.fade > 0) veil(app.fade);
  }
  function menuAt(x, y) {
    const n = lastApp?.items().length ?? 2;
    for (let k = 0; k < n; k++) if (Math.abs(y - (itemY(n, k) + 3)) < (n > 2 ? 5 : 6)) return k;
    return null;
  }
  function level(sim) { if (sim.s) syncTunnels(sim.s); parts = []; pops = []; }
  function destroy() { unfit(); document.body.style.background = ''; }
  return { draw, events, level, menuAt, destroy };
}
