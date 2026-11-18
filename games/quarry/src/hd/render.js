// The HD renderer: the field and every screen as vectors at the window's own resolution, in
// the largest 16:9 box. The 16 × 11 field sits in the middle under a strip of sky, the HUD in
// the rock on either side. The backdrop (sky, strata, pebbles) is painted once per level;
// tunnels are stroked into their own layer as the dig grows (the rim drawn behind what is
// already cut); the lamp-light is a quarter-resolution darkness mask over the terrain.
// It only reads `app` and `sim.s`.
//
//   const view = createHdRenderer(canvas, app);
//   view.level(sim); view.events(sim.events, sim); view.draw(app);
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';
import { COLS, GOLD_LIFE, ROWS, SCORE, STREAK, U } from '../sim.js';
import { layout as touchLayout } from '../touch.js';
import { TAU, canvas, crateSprite, gemSprite, goldSprite, lightSprite, mix, paintBackdrop, palOf, rgba } from './art.js';
import { drawDrill, drawGrub, drawLamp } from './sprites.js';

const HEAD = "'Bungee','Impact','Arial Black',sans-serif";
const BODY = "'Rubik','Trebuchet MS',system-ui,sans-serif";
const INK = '#fff4e4', DIM = 'rgba(255,236,214,0.62)', GOLD = '#ffd24a';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = t => 1 - (1 - clamp(t, 0, 1)) ** 3;
const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');

export function createHdRenderer(cv) {
  const g = cv.getContext('2d');
  const offs = [];
  const listen = (t, type, fn) => { t.addEventListener(type, fn); offs.push(() => t.removeEventListener(type, fn)); };
  let cw = 1, ch = 1, u = 1, ts = 1, F = { x: 0, y: 0, ts: 1 }, destroyed = false, lastApp = null;
  let bg = null, bgKey = '', tun = null, tg = null, seen = null, tunKey = '', vign = null;
  let dark = null, dg = null, gem = null, gemKey = '', crate = null, gold = null;
  const LIGHT = lightSprite(128);

  // the largest 16:9 box in the window at device resolution (capped); sized from the window,
  // never from the canvas itself
  function fit() {
    let w = innerWidth, h = innerHeight;
    if (w / h > 16 / 9) w = (h * 16) / 9; else h = (w * 9) / 16;
    const dpr = Math.min(devicePixelRatio || 1, 2, 2560 / w);
    cv.style.width = Math.round(w) + 'px'; cv.style.height = Math.round(h) + 'px';
    cw = cv.width = Math.round(w * dpr); ch = cv.height = Math.round(h * dpr);
    u = ch / 1080; ts = ch / 11.75;
    F = { x: (cw - COLS * ts) / 2, y: ch - ROWS * ts - ts * 0.2, ts };
    bgKey = ''; tunKey = ''; gemKey = '';
    crate = crateSprite(ts); gold = goldSprite(ts);
    dark = canvas((COLS * ts) / 4, (ROWS * ts) / 4); dg = dark.getContext('2d');
    vign = canvas(cw, ch);
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 2, ch / 2, ch * 0.45, cw / 2, ch / 2, cw * 0.62);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.45)');
    v.fillStyle = gr; v.fillRect(0, 0, cw, ch);
  }
  listen(window, 'resize', fit);
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) listen(document, ev, fit);
  fit();
  // a still demo frame is drawn once; draw it again when the web fonts arrive
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });

  const X = x => F.x + (x / U + 0.5) * ts, Y = y => F.y + (y / U + 0.5) * ts;

  // ---------- the level's layers ----------
  function syncLayers(s) {
    const key = s.level + ':' + cw + 'x' + ch;
    if (bgKey !== key) { bgKey = key; bg = paintBackdrop(s.level, cw, ch, F); }
    if (gemKey !== key) { gemKey = key; gem = gemSprite(palOf(s.level), ts); }
    const tk = s.loadId + ':' + cw + 'x' + ch;
    if (tunKey !== tk) {
      tunKey = tk;
      tun = canvas(COLS * ts, ROWS * ts); tg = tun.getContext('2d');
      const n = s.cell.length;
      seen = { cell: new Uint8Array(n), hA: new Uint8Array(n), hB: new Uint8Array(n), vA: new Uint8Array(n), vB: new Uint8Array(n), ver: -1 };
    }
    if (seen.ver === s.digVer) return;
    seen.ver = s.digVer;
    const Z = palOf(s.level), w = ts * 0.72, rw = w + ts * 0.14;
    const cx = i => ((i % COLS) + 0.5) * ts, cy = i => (Math.floor(i / COLS) + 0.5) * ts;
    tg.lineCap = 'round';
    const piece = (x0, y0, x1, y1) => {
      tg.globalCompositeOperation = 'source-over'; tg.strokeStyle = Z.hole; tg.lineWidth = w;
      tg.beginPath(); tg.moveTo(x0, y0); tg.lineTo(x1, y1); tg.stroke();
      tg.globalCompositeOperation = 'destination-over'; tg.strokeStyle = Z.rim; tg.lineWidth = rw;
      tg.beginPath(); tg.moveTo(x0, y0); tg.lineTo(x1, y1); tg.stroke();
    };
    const dot = (x, y) => {
      tg.globalCompositeOperation = 'source-over'; tg.fillStyle = Z.hole; tg.beginPath(); tg.arc(x, y, w / 2, 0, TAU); tg.fill();
      tg.globalCompositeOperation = 'destination-over'; tg.fillStyle = Z.rim; tg.beginPath(); tg.arc(x, y, rw / 2, 0, TAU); tg.fill();
    };
    const k = ts / U;
    for (let i = 0; i < s.cell.length; i++) {
      if (s.cell[i] && !seen.cell[i]) { dot(cx(i), cy(i)); seen.cell[i] = 1; }
      if (s.hA[i] > seen.hA[i]) { piece(cx(i) + seen.hA[i] * k, cy(i), cx(i) + s.hA[i] * k, cy(i)); seen.hA[i] = s.hA[i]; }
      if (s.hB[i] > seen.hB[i]) { piece(cx(i) + ts - seen.hB[i] * k, cy(i), cx(i) + ts - s.hB[i] * k, cy(i)); seen.hB[i] = s.hB[i]; }
      if (s.vA[i] > seen.vA[i]) { piece(cx(i), cy(i) + seen.vA[i] * k, cx(i), cy(i) + s.vA[i] * k); seen.vA[i] = s.vA[i]; }
      if (s.vB[i] > seen.vB[i]) { piece(cx(i), cy(i) + ts - seen.vB[i] * k, cx(i), cy(i) + ts - s.vB[i] * k); seen.vB[i] = s.vB[i]; }
    }
    tg.globalCompositeOperation = 'source-over';
  }

  // ---------- text ----------
  function label(s, x, y, size, col, { font = BODY, wgt = 700, align = 'left', spacing = 0 } = {}) {
    g.font = `${font === HEAD ? 400 : wgt} ${Math.round(size * u)}px ${font}`;
    g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
  }
  const GST = { font: BODY };
  const prompt = (input, s, x, y, size, col, align = 'center') =>
    drawPrompt(g, input, s, x, y, { font: `600 ${Math.round(size * u)}px ${BODY}`, size: size * 1.35 * u, color: col, align, letterSpacing: 1.2 * u, style: GST });
  function legend(input, rows, cx, y, size = 22) {
    const gs = size * 1.3 * u, gap = 6 * u;
    rows.forEach((r, i) => {
      let w = 0;
      const parts = r.map(([a, l]) => { const list = glyphs(input, a); g.font = `600 ${Math.round(size * u)}px ${BODY}`; const lw = g.measureText(l).width; const gw = measureGlyphs(g, list, gs, GST, gap); w += gw + 12 * u + lw; return { list, l, lw, gw }; });
      w += (parts.length - 1) * 40 * u;
      let x = cx - w / 2;
      const yc = y + i * 46 * u;
      for (const p of parts) {
        drawGlyphs(g, p.list, x, yc, gs, GST, gap);
        label(p.l, x + p.gw + 12 * u, yc + size * 0.36 * u, size, DIM, { wgt: 600 });
        x += p.gw + 12 * u + p.lw + 40 * u;
      }
    });
  }
  function glass(x, y, w, h, r = 26, a = 0.62) {
    g.fillStyle = `rgba(14,9,12,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r * u); g.fill();
    g.strokeStyle = 'rgba(255,220,180,0.16)'; g.lineWidth = 2 * u; g.stroke();
  }
  const shade = a => { g.fillStyle = `rgba(6,4,6,${a})`; g.fillRect(0, 0, cw, ch); };

  // ---------- particles and effects (pixels) ----------
  let parts = [], pops = [], shake = 0, flash = 0, flashCol = '255,255,255', ring = [];
  const squash = new Map(), trail = [];
  const motes = Array.from({ length: 70 }, (_, i) => ({ x: Math.random() * COLS, y: Math.random() * ROWS, z: (i % 2) + Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.15, vy: -0.05 - Math.random() * 0.08 }));
  const rand = Math.random;
  function burst(x, y, n, cols, sp, life = 0.6, grav = 900, size = 0.05) {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, v = sp * ts * (0.3 + rand() * 0.7);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * ts * 0.3, life: life * (0.5 + rand() * 0.5), max: life, col: cols[i % cols.length], r: size * ts * (0.6 + rand() * 0.8), grav: grav * u });
    }
  }
  function events(list, sim) {
    const s = sim?.s;
    if (!s) return;
    const Z = palOf(s.level);
    for (const e of list) {
      const x = X(e.x), y = Y(e.y);
      switch (e.type) {
        case 'dig': {
          const back = [[-1, 0], [0, -1], [1, 0], [0, 1]][e.dir] ?? [0, 0];
          for (let k = 0; k < 3; k++) parts.push({ x: x - back[0] * ts * -0.4, y: y - back[1] * ts * -0.4, vx: (back[0] * 2 + (rand() - 0.5) * 2) * ts, vy: (back[1] * 2 - rand() * 2) * ts, life: 0.5, max: 0.5, col: Z.bands[Math.min(3, Math.floor(e.y / U / 3))], r: ts * (0.03 + rand() * 0.04), grav: 1400 * u });
          break;
        }
        case 'gem': burst(x, y, 12, [Z.gem[0], '#ffffff', Z.gem[1]], 3, 0.6, 300, 0.04); break;
        case 'streak': ring.push({ x, y, t: 0, col: Z.gem[0] }); pops.push({ x, y: y - ts * 0.5, s: 'STREAK ' + SCORE.streak, t: 1.4, col: Z.gem[0], big: true }); break;
        case 'score': if (e.n >= SCORE.kill && e.n !== SCORE.streak) pops.push({ x, y: y - ts * 0.4, s: String(e.n), t: 1.1, col: e.n >= SCORE.gold ? GOLD : INK }); break;
        case 'push': burst(x, y + ts * 0.3, 3, [Z.bands[1]], 1.5, 0.4, 900, 0.04); break;
        case 'thud': {
          const c = s.crates.find(k => k.x === e.x && k.y === e.y);
          if (c) squash.set(c.id, 0.3);
          burst(x, y + ts * 0.4, 10, [Z.rim, Z.bands[1]], 2.5, 0.6, 1200, 0.05); shake = Math.max(shake, 0.15);
          break;
        }
        case 'burst': burst(x, y, 30, [GOLD, '#fff6b0', '#c88a4a', '#8a5428'], 5, 0.9, 1600, 0.06); shake = Math.max(shake, 0.3); flash = 0.08; flashCol = '255,220,120'; break;
        case 'gold': burst(x, y, 18, [GOLD, '#ffffff'], 3.5, 0.7, 200, 0.05); ring.push({ x, y, t: 0, col: GOLD }); break;
        case 'fire': flash = Math.max(flash, 0.04); flashCol = '160,230,255'; break;
        case 'fizzle': burst(x, y, 10, ['#bff4ff', '#ffffff', '#5ad0f0'], 2.5, 0.35, 0, 0.035); break;
        case 'kill': {
          const cols = e.how === 'eat' ? ['#7ab8ff', '#ffffff'] : e.kind === 'burrower' ? ['#ff7a4a', '#a8281a', '#ffd0a0'] : ['#c088ff', '#5a2a9a', '#ffffff'];
          burst(x, y, 26, cols, 4.5, 0.8, 1100, 0.06); ring.push({ x, y, t: 0, col: cols[0] });
          if (e.how === 'crush') shake = Math.max(shake, 0.2);
          break;
        }
        case 'spawn': burst(x, y, 16, ['#ff5a3a', '#5a2a9a', '#2a1a20'], 2.5, 0.8, -200, 0.05); break;
        case 'morph': burst(x, y, 14, e.to === 'burrower' ? ['#ff7a4a', '#ffd0a0'] : ['#c088ff', '#ffffff'], 2.5, 0.5, 0, 0.04); break;
        case 'gemlost': burst(x, y, 10, [Z.gem[1], '#444'], 2, 0.5, 600, 0.04); break;
        case 'goldlost': case 'goldgone': burst(x, y, 8, ['#a8620a', '#ffc928'], 1.5, 0.5, 400, 0.04); break;
        case 'bonusshow': ring.push({ x, y, t: 0, col: GOLD }); break;
        case 'bonus': flash = 0.25; flashCol = '255,230,150'; ring.push({ x, y, t: 0, col: GOLD, big: true }); burst(x, y, 30, [GOLD, '#ffffff'], 5, 1, 0, 0.05); break;
        case 'die': burst(x, y, 50, ['#ffd45a', '#f0a020', '#9aa2b4', '#ffffff'], 6, 1.2, 1400, 0.07); shake = 0.5; flash = 0.18; flashCol = '255,90,60'; break;
        case 'respawn': ring.push({ x, y, t: 0, col: '#ffd45a' }); break;
        case 'life': pops.push({ x, y: y - ts * 0.6, s: '1UP', t: 1.6, col: '#9fffb4', big: true }); break;
        case 'clear': flash = 0.15; flashCol = '255,255,255'; break;
      }
    }
  }
  function stepFx(dt) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 2; }
    parts = parts.filter(p => p.life > 0);
    if (parts.length > 600) parts.splice(0, parts.length - 600);
    for (const p of pops) { p.t -= dt; p.y -= ts * 0.5 * dt; }
    pops = pops.filter(p => p.t > 0);
    for (const r of ring) r.t += dt;
    ring = ring.filter(r => r.t < (r.big ? 1 : 0.6));
    for (const [k, v] of squash) { if (v - dt <= 0) squash.delete(k); else squash.set(k, v - dt); }
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
  }

  // ---------- the field ----------
  let heroSquash = 0, lastFace = -1, lastMoving = false, spin = 0;
  function drawField(app, dt, t) {
    const s = app.sim.s, Z = palOf(s.level), h = s.hero;
    syncLayers(s);
    const sh = shake > 0 ? shake * ts * 0.12 : 0;
    g.save();
    if (sh) g.translate((rand() - 0.5) * sh, (rand() - 0.5) * sh);
    g.drawImage(bg, 0, 0);
    g.drawImage(tun, F.x, F.y);
    // the den: a ring of stones round a dark mouth, glowing while a grub climbs out
    {
      const x = X(s.den.x * U), y = Y(s.den.y * U), busy = s.mons.some(m => m.state === 'emerge');
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(x, y, ts * 0.3, 0, TAU); g.fill();
      for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU; g.fillStyle = k % 2 ? mix(Z.rim, '#000000', 0.3) : mix(Z.rim, '#000000', 0.5); g.beginPath(); g.ellipse(x + Math.cos(a) * ts * 0.36, y + Math.sin(a) * ts * 0.36, ts * 0.08, ts * 0.06, a, 0, TAU); g.fill(); }
      if (busy) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.5 + Math.sin(t * 12) * 0.2; g.drawImage(LIGHT, x - ts * 0.6, y - ts * 0.6, ts * 1.2, ts * 1.2); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    }
    // crates
    for (const c of s.crates) {
      const x = X(c.x), y = Y(c.y), sq = squash.get(c.id) ?? 0;
      g.save(); g.translate(x, y + ts * 0.44);
      if (c.state === 'wobble') g.rotate(Math.sin(c.t * 40) * 0.07);
      let sx = 1, sy = 1;
      if (c.state === 'fall') { sx = 0.93; sy = 1.08; }
      if (sq) { const k = Math.sin((sq / 0.3) * Math.PI) * 0.18; sx = 1 + k; sy = 1 - k; }
      g.scale(sx, sy);
      g.drawImage(crate, -crate.width / 2, -crate.height + ts * 0.08);
      g.restore();
    }
    // lamplight: darkness over the terrain, holes round the lights
    const amb = s.frenzy > 0 ? 0.32 : 0.6;
    dg.globalCompositeOperation = 'source-over';
    dg.clearRect(0, 0, dark.width, dark.height);
    dg.fillStyle = `rgba(6,3,10,${amb})`; dg.fillRect(0, 0, dark.width, dark.height);
    dg.globalCompositeOperation = 'destination-out';
    const q = 0.25, hole = (x, y, r, a = 1) => { dg.globalAlpha = a; dg.drawImage(LIGHT, (x - F.x - r) * q, (y - F.y - r) * q, 2 * r * q, 2 * r * q); };
    const hx = X(h.x), hy = Y(h.y), flick = 1 + Math.sin(t * 17) * 0.03 + Math.sin(t * 5.3) * 0.04;
    if (s.status !== 'dying') {
      hole(hx, hy, ts * 2.6 * flick);
      const d = [[1, 0], [0, 1], [-1, 0], [0, -1]][h.face];
      hole(hx + d[0] * ts * 1.4, hy + d[1] * ts * 1.4, ts * 1.9 * flick, 0.9);
      hole(hx + d[0] * ts * 2.8, hy + d[1] * ts * 2.8, ts * 1.4 * flick, 0.6);
    }
    if (s.shot) hole(X(s.shot.x), Y(s.shot.y), ts * 1.5);
    if (s.bonus.state === 'shown') hole(X(s.bonus.x), Y(s.bonus.y), ts * (2.2 + Math.sin(t * 4) * 0.2));
    for (const gd of s.gold) hole(X(gd.x), Y(gd.y), ts * 1.1, 0.8);
    for (let i = 0; i < s.gem.length; i++) if (s.gem[i]) hole(((i % COLS) + 0.5) * ts + F.x, (Math.floor(i / COLS) + 0.5) * ts + F.y, ts * 0.75, 0.45);
    dg.globalAlpha = 1;
    g.drawImage(dark, F.x, F.y, COLS * ts, ROWS * ts);

    // gems: bob and glint
    for (let i = 0; i < s.gem.length; i++) {
      if (!s.gem[i]) continue;
      const x = ((i % COLS) + 0.5) * ts + F.x, y = (Math.floor(i / COLS) + 0.5) * ts + F.y + Math.sin(t * 2 + i) * ts * 0.03;
      g.drawImage(gem, x - gem.width / 2, y - gem.height / 2);
      const tw = (t * 0.7 + i * 0.37) % 4;
      if (tw < 0.3) {
        const k = Math.sin((tw / 0.3) * Math.PI), r = ts * 0.22 * k;
        g.strokeStyle = `rgba(255,255,255,${k})`; g.lineWidth = ts * 0.025;
        g.beginPath(); g.moveTo(x + ts * 0.1 - r, y - ts * 0.12); g.lineTo(x + ts * 0.1 + r, y - ts * 0.12); g.moveTo(x + ts * 0.1, y - ts * 0.12 - r); g.lineTo(x + ts * 0.1, y - ts * 0.12 + r); g.stroke();
      }
    }
    // gold piles (blinking out at the end)
    for (const gd of s.gold) {
      if (gd.t > GOLD_LIFE - 3 && Math.floor(t * 8) % 2) continue;
      const x = X(gd.x), y = Y(gd.y) + ts * 0.2, pop = ease(gd.t / 0.3);
      g.save(); g.translate(x, y); g.scale(pop, pop); g.drawImage(gold, -gold.width / 2, -gold.height * 0.6); g.restore();
    }
    // the lamp
    if (s.bonus.state === 'shown') {
      const x = X(s.bonus.x), y = Y(s.bonus.y) + Math.sin(t * 3) * ts * 0.06;
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.55; g.drawImage(LIGHT, x - ts, y - ts, ts * 2, ts * 2); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.save(); g.translate(x, y); g.scale(ts * 1.25, ts * 1.25); drawLamp(g, t); g.restore();
    }
    // grubs
    for (const m of s.mons) {
      const x = X(m.x), y = Y(m.y), dx = hx - x, dy = hy - y, dl = Math.hypot(dx, dy) || 1;
      const scared = s.frenzy > 0 ? 1 : 0, blink = scared && s.frenzy < 2 && Math.floor(t * 8) % 2 === 0;
      g.save(); g.translate(x, y);
      let k = ts * 0.95;
      if (m.state === 'emerge') { const e = ease(m.t / 0.9); k *= e; g.rotate((1 - e) * 3); }
      if (m.state === 'morph') k *= 1 + Math.sin(m.t * 40) * 0.12;
      g.scale(k, k);
      const kind = m.state === 'morph' && Math.floor(m.t * 20) % 2 ? m.to : m.kind;
      drawGrub(g, kind, m.dir, t + m.id * 0.7, [dx / dl, dy / dl], scared, blink);
      g.restore();
    }
    // the drill
    if (h.face !== lastFace && lastFace >= 0) heroSquash = 0.16;
    if (lastMoving && !h.moving) heroSquash = Math.max(heroSquash, 0.12);
    lastFace = h.face; lastMoving = h.moving;
    heroSquash = Math.max(0, heroSquash - dt);
    if (h.moving) spin += dt * (h.pushing ? 6 : 10);
    if (s.status !== 'dying' || s.statusT < 0.15) {
      let sq = 1 + (h.moving ? Math.sin(t * 30) * 0.025 : 0);
      if (heroSquash > 0) sq *= 1 - Math.sin((heroSquash / 0.16) * Math.PI) * 0.12;
      g.save(); g.translate(hx, hy + (h.moving ? Math.sin(t * 24) * ts * 0.01 : 0)); g.scale(ts, ts);
      drawDrill(g, h.face, spin, sq, s.frenzy, t);
      g.restore();
      if (s.frenzy > 0) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35 + Math.sin(t * 8) * 0.1; g.drawImage(LIGHT, hx - ts * 1.2, hy - ts * 1.2, ts * 2.4, ts * 2.4); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    }
    // the shot and its trail
    if (s.shot) { trail.push([X(s.shot.x), Y(s.shot.y)]); if (trail.length > 8) trail.shift(); } else trail.length = 0;
    if (trail.length) {
      g.globalCompositeOperation = 'lighter';
      trail.forEach(([x, y], k) => { const a = (k + 1) / trail.length, r = ts * (0.15 + a * 0.3); g.globalAlpha = a * 0.7; g.drawImage(LIGHT, x - r, y - r, r * 2, r * 2); });
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      const [x, y] = trail[trail.length - 1];
      g.fillStyle = '#e8ffff'; g.beginPath(); g.arc(x, y, ts * 0.1, 0, TAU); g.fill();
      g.strokeStyle = '#5ad0f0'; g.lineWidth = ts * 0.04; g.stroke();
    }
    // dust hanging in the lamplight, at two depths: it slides against the drill's moves
    for (const m of motes) {
      const k = m.z * 0.35, x = F.x + ((((m.x + t * m.vx - (h.x / U) * k) % COLS) + COLS) % COLS) * ts;
      const y = F.y + ((((m.y + t * m.vy - (h.y / U) * k) % ROWS) + ROWS) % ROWS) * ts;
      const near = Math.max(0, 1 - Math.hypot(x - hx, y - hy) / (ts * 3.2));
      if (near <= 0) continue;
      g.fillStyle = `rgba(255,236,200,${near * (0.25 + m.z * 0.35)})`;
      g.beginPath(); g.arc(x, y, ts * (0.012 + m.z * 0.02), 0, TAU); g.fill();
    }
    // particles, rings, pops
    for (const p of parts) { g.globalAlpha = clamp(p.life / p.max, 0, 1); g.fillStyle = p.col; g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    for (const r of ring) {
      const span = r.big ? 1 : 0.6, k = r.t / span;
      g.strokeStyle = rgba(r.col, 1 - k); g.lineWidth = ts * 0.06 * (1 - k);
      g.beginPath(); g.arc(r.x, r.y, ts * (0.3 + k * (r.big ? 3 : 1.2)), 0, TAU); g.stroke();
    }
    for (const p of pops) {
      const a = clamp(p.t * 2, 0, 1);
      g.globalAlpha = a;
      label(p.s, p.x, p.y, p.big ? 34 : 28, 'rgba(0,0,0,0.6)', { font: HEAD, align: 'center' });
      label(p.s, p.x - 2 * u, p.y - 2 * u, p.big ? 34 : 28, p.col, { font: HEAD, align: 'center' });
      g.globalAlpha = 1;
    }
    g.restore();
  }

  // ---------- HUD in the side rock ----------
  function hudLabel(s, x, y) { label(s, x, y, 20, DIM, { font: HEAD, align: 'center', spacing: 2 }); }
  function drawHud(app, t) {
    const s = app.sim.s, Z = palOf(s.level), lx = F.x / 2, rx = cw - F.x / 2, top = F.y + 70 * u;
    hudLabel('SCORE', lx, top);
    label(pad6(s.score), lx, top + 54 * u, 40, INK, { align: 'center' });
    hudLabel(app.demo ? 'DEMO' : 'HIGH', lx, top + 130 * u);
    if (app.demo) { if (Math.floor(t * 2) % 2) label('· · ·', lx, top + 170 * u, 30, GOLD, { align: 'center' }); }
    else label(pad6(app.hi), lx, top + 170 * u, 30, GOLD, { align: 'center' });
    hudLabel('DRILLS', lx, top + 250 * u);
    const n = Math.min(s.lives, 6);
    for (let k = 0; k < n; k++) {
      const x = lx + ((k % 3) - 1) * 62 * u, y = top + 300 * u + Math.floor(k / 3) * 56 * u;
      g.save(); g.translate(x, y); g.scale(52 * u, 52 * u); drawDrill(g, 0, 0, 1, 0, 0); g.restore();
    }
    if (!n) label('LAST ONE', lx, top + 305 * u, 20, DIM, { align: 'center', spacing: 1 });

    hudLabel('LEVEL', rx, top);
    label(String(s.level + 1), rx, top + 62 * u, 56, INK, { font: HEAD, align: 'center' });
    label(s.name, rx, top + 96 * u, 19, rgba(Z.gem[0], 0.9), { align: 'center', spacing: 1.5 });
    // the shot's charge, or the lamp's time
    const lamp = s.frenzy > 0, k = lamp ? s.frenzy / s.P.frenzy : 1 - s.reload / s.P.reload, cy = top + 215 * u, r = 46 * u;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 10 * u; g.beginPath(); g.arc(rx, cy, r, 0, TAU); g.stroke();
    const ready = !lamp && k >= 1;
    g.strokeStyle = lamp ? GOLD : ready ? '#7ff0ff' : '#3a9ac0'; g.lineWidth = 10 * u;
    g.beginPath(); g.arc(rx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(k, 0, 1)); g.stroke();
    if (ready) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.25 + Math.sin(t * 5) * 0.12; g.drawImage(LIGHT, rx - r * 1.6, cy - r * 1.6, r * 3.2, r * 3.2); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
    label(lamp ? Math.ceil(s.frenzy) + 's' : ready ? 'FIRE' : Math.round(k * 100) + '%', rx, cy + 9 * u, lamp ? 28 : 24, lamp ? GOLD : ready ? INK : DIM, { align: 'center' });
    hudLabel(lamp ? 'LAMP' : 'SHOT', rx, cy + r + 40 * u);
    // gems left, and the streak's pips
    const gy = top + 360 * u;
    g.drawImage(gem, rx - 46 * u - gem.width / 2, gy - gem.height / 2 - 12 * u);
    label(String(s.gems), rx + 22 * u, gy, 36, INK, { align: 'center' });
    hudLabel('GEMS LEFT', rx, gy + 42 * u);
    const live = s.status === 'play' && s.t - s.lastGem < 1.25 ? s.streak : 0;
    for (let i = 0; i < STREAK; i++) {
      const x = rx + (i - (STREAK - 1) / 2) * 22 * u, y = gy + 78 * u;
      g.fillStyle = i < live ? Z.gem[0] : 'rgba(255,255,255,0.14)';
      g.beginPath(); g.arc(x, y, 7 * u, 0, TAU); g.fill();
    }
  }
  function banner(title, sub, t0, col = INK) {
    const k = ease(t0 / 0.35), cy = F.y + ROWS * ts * 0.45;
    g.save(); g.globalAlpha = k;
    glass(cw / 2 - 360 * u, cy - 95 * u, 720 * u, 170 * u, 30, 0.7);
    g.translate(cw / 2, cy); g.scale(0.85 + k * 0.15, 0.85 + k * 0.15);
    label(title, 0, 0, 72, col, { font: HEAD, align: 'center', spacing: 2 });
    if (sub) label(sub, 0, 52 * u, 26, DIM, { align: 'center', spacing: 2 });
    g.restore();
  }
  function drawBanners(app, t) {
    const s = app.sim.s;
    if (s.status === 'ready') banner(`LEVEL ${s.level + 1}`, `${s.name}  ·  ${s.levelT > 0 ? 'TRY AGAIN' : 'GET READY'}`, s.statusT);
    else if (s.status === 'clear' && s.statusT > 0.3) banner('LEVEL CLEAR', s.gems ? 'THE GRUBS ARE GONE' : 'EVERY GEM TAKEN', s.statusT - 0.3, GOLD);
    else if (s.status === 'over') banner('GAME OVER', `SCORE ${pad6(s.score)}`, s.statusT, '#ff8a6a');
    void t;
  }
  function drawSurface(app, t) {
    if (app.demo) label('DEMO', cw / 2, F.y - ts * 0.18, 22, Math.floor(t * 2) % 2 ? GOLD : DIM, { font: HEAD, align: 'center', spacing: 3 });
  }
  function drawTouch(app) {
    const T = app.touch;
    if (!T?.active || app.state !== 'play') return;
    const L = touchLayout(cw, ch);
    g.lineWidth = 3 * L.u;
    if (T.stick) {
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.beginPath(); g.arc(T.stick.x0, T.stick.y0, L.stickR, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.arc(T.stick.x, T.stick.y, L.stickR * 0.4, 0, TAU); g.fill();
    }
    g.fillStyle = T.fire ? 'rgba(127,240,255,0.35)' : 'rgba(255,255,255,0.1)'; g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.arc(L.fire.x, L.fire.y, L.fire.r, 0, TAU); g.fill(); g.stroke();
    label('FIRE', L.fire.x, L.fire.y + 10 * L.u, 28 * (L.u / u), INK, { font: HEAD, align: 'center' });
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(L.pause.x, L.pause.y, L.pause.r, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = INK; g.fillRect(L.pause.x - 12 * L.u, L.pause.y - 15 * L.u, 8 * L.u, 30 * L.u); g.fillRect(L.pause.x + 4 * L.u, L.pause.y - 15 * L.u, 8 * L.u, 30 * L.u);
  }

  // ---------- screens ----------
  function logo(cx, y, size, t) {
    const Z = palOf(0);
    g.font = `400 ${Math.round(size * u)}px ${HEAD}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = 6 * u + 'px';
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillText('QUARRY', cx + 8 * u, y + 10 * u);
    const gr = g.createLinearGradient(0, y - size * u * 0.75, 0, y);
    gr.addColorStop(0, '#ffe8a8'); gr.addColorStop(0.3, Z.bands[0]); gr.addColorStop(0.31, Z.bands[1]); gr.addColorStop(0.62, Z.bands[2]); gr.addColorStop(0.63, Z.bands[3]); gr.addColorStop(1, '#2a160c');
    g.fillStyle = gr; g.fillText('QUARRY', cx, y);
    const half = g.measureText('QUARRY').width / 2;
    g.strokeStyle = 'rgba(255,230,190,0.5)'; g.lineWidth = 2 * u; g.strokeText('QUARRY', cx, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
    // a gem set beside the name
    const gx = cx + half + gem.width * 0.45, gy = y - size * u * 0.5;
    g.drawImage(gem, gx - gem.width / 2, gy - gem.height / 2 + Math.sin(t * 2) * 4 * u);
  }
  const menuBox = [];
  function drawMenu(app, y, t) {
    const items = app.items();
    menuBox.length = 0;
    items.forEach((it, k) => {
      const sel = k === app.menu, yy = y + k * 70 * u, w = 360 * u, h = 56 * u;
      menuBox.push({ x: cw / 2 - w / 2, y: yy - h / 2, w, h });
      if (sel) {
        g.fillStyle = 'rgba(255,210,74,0.16)'; g.beginPath(); g.roundRect(cw / 2 - w / 2, yy - h / 2, w, h, h / 2); g.fill();
        g.strokeStyle = rgba(GOLD, 0.5 + Math.sin(t * 5) * 0.25); g.lineWidth = 2 * u; g.stroke();
      }
      label(it === 'play' ? 'PLAY' : 'EXIT', cw / 2, yy + 13 * u, 34, sel ? GOLD : DIM, { font: HEAD, align: 'center', spacing: 3 });
    });
  }
  function howTo(app, x0, y0, w, t) {
    const Z = palOf(0);
    label('HOW TO DIG', x0 + w / 2, y0 + 50 * u, 28, GOLD, { font: HEAD, align: 'center', spacing: 2 });
    const rows = [
      ['gem', `GEM  ${SCORE.gem}`, `${STREAK} in a row: ${SCORE.streak}`],
      ['gold', `GOLD  ${SCORE.gold}`, 'Drop a crate two rows to break it'],
      ['walker', `GRUB  ${SCORE.kill}`, 'Shoot it down a tunnel, or crush it'],
      ['burrower', 'BORER', 'Digs through soil, eats gems and gold'],
      ['lamp', `LAMP  ${SCORE.bonus}`, 'The grubs run from its light'],
      ['scared', 'CATCH THEM', '200, 400, 800 … while it burns'],
    ];
    rows.forEach(([icon, a, b], k) => {
      const y = y0 + 110 * u + k * 56 * u, ix = x0 + 80 * u;
      g.save(); g.translate(ix, y - 8 * u);
      if (icon === 'gem') g.drawImage(gem, -gem.width / 2, -gem.height / 2);
      else if (icon === 'gold') g.drawImage(gold, -gold.width / 2, -gold.height / 2);
      else { const s = 62 * u; g.scale(s, s); if (icon === 'lamp') drawLamp(g, t); else drawGrub(g, icon === 'scared' ? 'walker' : icon, 0, t + k, [1, 0], icon === 'scared' ? 1 : 0, false); }
      g.restore();
      label(a, x0 + 140 * u, y, 24, INK, { font: HEAD, spacing: 1 });
      label(b, x0 + 400 * u, y, 22, DIM, { wgt: 500 });
    });
    void Z;
  }
  function scores(app, x0, y0, w, t) {
    label('BEST DIGGERS', x0 + w / 2, y0 + 50 * u, 28, GOLD, { font: HEAD, align: 'center', spacing: 2 });
    app.save.table.forEach((e, k) => {
      const y = y0 + 100 * u + k * 33 * u, hl = k === app.rank, col = hl ? (Math.floor(t * 4) % 2 ? GOLD : INK) : INK;
      label(`${k + 1}`, x0 + w * 0.28, y, 22, DIM, { align: 'right' });
      label(e.n, x0 + w * 0.34, y, 24, col, { font: HEAD, spacing: 2 });
      label(pad6(e.s), x0 + w * 0.66, y, 24, col, { align: 'right', spacing: 1 });
      label(`L${e.l}`, x0 + w * 0.76, y, 20, DIM, { align: 'right' });
    });
  }
  function drawTitle(app, t) {
    g.drawImage(bg, 0, 0);
    if (tun) g.drawImage(tun, F.x, F.y);
    shade(0.62);
    logo(cw / 2, 205 * u, 150, t);
    label('DIG  ·  GATHER  ·  DROP  ·  RUN', cw / 2, 262 * u, 24, DIM, { align: 'center', spacing: 5 });
    // the drill trundling along under the title
    const dx = ((t * 0.12) % 1.3) - 0.15;
    g.save(); g.translate(dx * cw, 300 * u); g.scale(70 * u, 70 * u); drawDrill(g, 0, t * 10, 1 + Math.sin(t * 30) * 0.02, 0, t); g.restore();
    const pw = 960 * u, px = cw / 2 - pw / 2, py = 345 * u, ph = 440 * u;
    glass(px, py, pw, ph);
    if (app.page === 0) howTo(app, px, py, pw, t); else scores(app, px, py, pw, t);
    drawMenu(app, 840 * u, t);
    legend(app.input, [[['move', 'Dig'], ['fire', 'Fire'], ['pause', 'Pause'], ['sound', app.soundOn ? 'Sound on' : 'Sound off']]], cw / 2, 1010 * u, 22);
  }
  function drawEntry(app, t) {
    g.drawImage(bg, 0, 0);
    shade(0.7);
    logo(cw / 2, 205 * u, 120, t);
    const pw = 860 * u, px = cw / 2 - pw / 2;
    glass(px, 300 * u, pw, 560 * u);
    label('A NEW BEST DIGGER', cw / 2, 380 * u, 40, GOLD, { font: HEAD, align: 'center', spacing: 2 });
    label(`SCORE ${pad6(app.sim.s.score)}   ·   LEVEL ${app.sim.s.level + 1}`, cw / 2, 440 * u, 28, INK, { align: 'center', spacing: 2 });
    label('ENTER YOUR INITIALS', cw / 2, 510 * u, 24, DIM, { align: 'center', spacing: 3 });
    const E = app.entry;
    for (let k = 0; k < 3; k++) {
      const x = cw / 2 + (k - 1) * 150 * u, sel = k === E.pos;
      g.fillStyle = sel ? 'rgba(255,210,74,0.18)' : 'rgba(255,255,255,0.06)';
      g.beginPath(); g.roundRect(x - 58 * u, 550 * u, 116 * u, 150 * u, 18 * u); g.fill();
      if (sel) { g.strokeStyle = rgba(GOLD, 0.6 + Math.sin(t * 6) * 0.3); g.lineWidth = 3 * u; g.stroke(); }
      label(E.letters[k], x, 660 * u, 96, sel ? GOLD : INK, { font: HEAD, align: 'center' });
    }
    prompt(app.input, '{up} {down} Letter    {fire} Next    {start} Done', cw / 2, 790 * u, 24, DIM);
  }

  // ---------- frame ----------
  let lastT = performance.now();
  function draw(app) {
    lastApp = app;
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    stepFx(dt);
    const t = app.t, s = app.sim.s;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#07050a'; g.fillRect(0, 0, cw, ch);
    if (s) syncLayers(s);
    if (app.state === 'title') drawTitle(app, t);
    else if (app.state === 'entry') drawEntry(app, t);
    else {
      drawField(app, dt, t);
      drawHud(app, t);
      drawSurface(app, t);
      drawBanners(app, t);
      if (app.state === 'pause') {
        shade(0.55);
        label('PAUSED', cw / 2, ch * 0.46, 90, INK, { font: HEAD, align: 'center', spacing: 4 });
        prompt(app.input, '{pause} Play on      {quit} Quit', cw / 2, ch * 0.56, 26, DIM);
      }
      drawTouch(app);
    }
    g.drawImage(vign, 0, 0);
    if (flash > 0) { g.fillStyle = `rgba(${flashCol},${flash * 1.6})`; g.fillRect(0, 0, cw, ch); }
    if (app.fade > 0) { g.fillStyle = `rgba(0,0,0,${app.fade})`; g.fillRect(0, 0, cw, ch); }
  }
  function menuAt(x, y) {
    const i = menuBox.findIndex(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    return i < 0 ? null : i;
  }
  function level(sim) { if (sim.s) syncLayers(sim.s); parts = []; pops = []; ring = []; squash.clear(); }
  function destroy() { destroyed = true; offs.forEach(off => off()); }
  return { draw, events, level, menuAt, destroy };
}
