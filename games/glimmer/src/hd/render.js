// The HD renderer: draws the level and every screen as vectors at the window's own
// resolution, 16:9. The 28 × 16 field sits centred under a HUD band, the backdrop fills the
// rest. Static tiles are painted once per level into a layer; the water is a darkness buffer
// with holes punched around Wren's lamp and every glimmer, then soft glows on top. It only
// reads `app`, `sim.s` and `sim.L`.
//
//   const view = createRenderer(canvas, app);
//   view.level(sim);           // a new level was loaded
//   view.events(sim.events, sim);
//   view.draw(app);
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';
import { fitWide } from '@nostalgia/game/runtime';
import { savedAgo } from '@nostalgia/save';
import { BRUSH_NAMES } from '../editor.js';
import { BRUSHES, frame, pads, toolbar } from '../layout.js';
import { COLS, ROWS, U, parseLevel } from '../level.js';
import { LEVELS, WORLDS } from '../levels.js';
import { T } from '../sim.js';
import { PAL, TAU, canvas, glow, hash2, makeBackdrop, makeTiles, paintLevel, rgba, thumbnail } from './art.js';
import { drawSentinel, drawShard, drawWren } from './sprites.js';

const SERIF = "'Cinzel','Trajan Pro','Georgia',serif";
const SANS = "'Nunito','Trebuchet MS',system-ui,sans-serif";
const INK = '#f2fbff', DIM = 'rgba(225,240,250,0.62)', GOLD = '#ffd77a';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');
const ease = t => 1 - (1 - clamp(t, 0, 1)) ** 3;

export function createRenderer(cv) {
  let g = cv.getContext('2d'); // the buffers below borrow it while they're drawn into
  let cw = 1, ch = 1, F = frame(1, 1), u = 1, ts = 1, vign = null, destroyed = false, lastApp = null;
  // the water and the darkness are soft, so both are drawn at half resolution and scaled up
  // once each: the frame's full-size passes are the backdrop, the tiles and the darkness
  const lc = document.createElement('canvas'), lg = lc.getContext('2d');
  const bc = document.createElement('canvas'), bg = bc.getContext('2d');
  let backdrops = {}, tiles = {}, layers = new Map(), thumbs = new Map(), darks = new Map();
  function fit(w, h) {
    cw = w; ch = h; F = frame(cw, ch); u = F.u; ts = F.ts;
    lc.width = bc.width = Math.ceil(cw / 2); lc.height = bc.height = Math.ceil(ch / 2);
    vign = canvas(cw / 2, ch / 2);
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 4, ch / 4, ch * 0.22, cw / 4, ch / 4, cw * 0.31);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
    v.fillStyle = gr; v.fillRect(0, 0, cw, ch);
    backdrops = {}; tiles = {}; layers = new Map(); thumbs = new Map(); darks = new Map();
  }
  // the deep's darkness for a reach, vignette included, before the lights are cut out of it
  function darkOf(world, editor) {
    const key = world * 2 + (editor ? 1 : 0);
    let c = darks.get(key);
    if (!c) {
      c = canvas(lc.width, lc.height);
      const x = c.getContext('2d');
      x.fillStyle = `rgba(0,4,10,${editor ? PAL[world].dark * 0.4 : PAL[world].dark})`; x.fillRect(0, 0, c.width, c.height);
      x.drawImage(vign, 0, 0);
      darks.set(key, c);
    }
    return c;
  }
  const unfit = fitWide(cv, { onFit: fit });
  // the still demo frame is drawn once; draw it again when the web fonts arrive
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });

  const LIGHT = canvas(128, 128);
  {
    const x = LIGHT.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.65)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  }
  const backdrop = w => backdrops[w] ?? (backdrops[w] = makeBackdrop(w, bc.width, bc.height));
  const tileSet = w => tiles[w] ?? (tiles[w] = makeTiles(PAL[w], Math.round(ts), w));
  function layerFor(L) {
    const w = L.world ?? 0, key = w + ':' + L.t.map(r => r.join('')).join('');
    let e = layers.get(key);
    if (!e) {
      e = paintLevel(L, PAL[w], tileSet(w), F);
      layers.set(key, e);
      if (layers.size > 4) layers.delete(layers.keys().next().value);
    }
    return e;
  }
  function thumbOf(i, w, h) {
    let c = thumbs.get(i);
    if (!c) { c = thumbnail(parseLevel(LEVELS[i]), w, h); thumbs.set(i, c); }
    return c;
  }

  // ---------- text ----------
  const setFont = (size, wgt, fam) => { g.font = `${wgt} ${Math.round(size * u)}px ${fam}`; };
  function label(s, x, y, size, col, wgt = 700, align = 'left', spacing = 0, fam = SANS) {
    setFont(size, wgt, fam); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
  }
  function labelW(s, size, wgt = 700, spacing = 0, fam = SANS) {
    setFont(size, wgt, fam);
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    const w = g.measureText(s).width;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    return w;
  }
  const GST = { font: SANS };
  const prompt = (input, s, x, y, size, col, align = 'left', wgt = 700) =>
    drawPrompt(g, input, s, x, y, { font: `${wgt} ${Math.round(size * u)}px ${SANS}`, size: size * 1.35 * u, gap: size * 0.55 * u, color: col, align, letterSpacing: 1.5 * u, style: GST });
  // rows of [action, label, all?] in aligned columns, centred on cx
  function legend(input, rows, cx, y, pitch = 46, size = 21) {
    const gs = size * 1.3 * u, gap = 6 * u, gw = [], lw = [];
    const gl = (a, all) => glyphs(input, a, all);
    for (const r of rows) r.forEach(([a, l, all], k) => { gw[k] = Math.max(gw[k] || 0, measureGlyphs(g, gl(a, all), gs, GST, gap)); lw[k] = Math.max(lw[k] || 0, labelW(l, size, 700, 1.5)); });
    const colGap = 44 * u, inner = 14 * u;
    const total = gw.reduce((w, x, k) => w + (k ? colGap : 0) + x + inner + lw[k], 0);
    rows.forEach((r, i) => {
      let x = cx - total / 2;
      const yc = y + i * pitch * u;
      r.forEach(([a, l, all], k) => {
        const list = gl(a, all);
        drawGlyphs(g, list, x + gw[k] - measureGlyphs(g, list, gs, GST, gap), yc, gs, GST, gap);
        label(l, x + gw[k] + inner, yc + size * 0.36 * u, size, DIM, 700, 'left', 1.5);
        x += gw[k] + inner + lw[k] + colGap;
      });
    });
  }
  function glass(x, y, w, h, r = 26, a = 0.62) {
    g.fillStyle = `rgba(4,16,24,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r * u); g.fill();
    g.strokeStyle = 'rgba(190,240,255,0.18)'; g.lineWidth = 2 * u; g.stroke();
  }
  const shade = (a, col = '2,8,14') => { g.fillStyle = `rgba(${col},${a})`; g.fillRect(0, 0, cw, ch); };
  const pulse = (t, k = 4) => 0.55 + Math.sin(t * k) * 0.45;

  // ---------- particles (tile units, field coordinates) ----------
  let parts = [], shake = 0, flash = 0, flashCol = '255,255,255';
  const rand = Math.random;
  const P = (x, y, vx, vy, life, col, size = 0.08, grav = 0, gl = null, kind = 'dot', text = '') => parts.push({ x, y, vx, vy, life, max: life, col, size, grav, gl, kind, text });
  function burst(x, y, n, cols, speed = 4, life = 0.6, grav = 8, size = 0.08, gl = null) {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, s = speed * (0.3 + rand() * 0.7);
      P(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + rand() * 0.5), cols[Math.floor(rand() * cols.length)], size * (0.6 + rand() * 0.8), grav, gl);
    }
  }
  const chunk = (x, y, Z, n, up = 3) => { for (let i = 0; i < n; i++) P(x + (rand() - 0.5) * 0.8, y + (rand() - 0.5) * 0.3, (rand() - 0.5) * 3, -rand() * up, 0.5 + rand() * 0.4, Z.brick[Math.floor(rand() * 3)], 0.06 + rand() * 0.06, 16, null, 'chunk'); };
  function events(list, sim) {
    if (!sim?.L) return;
    const Z = PAL[sim.L.world ?? 0];
    for (const e of list) {
      const { x, y } = e;
      switch (e.type) {
        case 'dig': chunk(x, y - 0.4, Z, 6, 4); break;
        case 'fizzle': burst(x, y - 0.4, 6, [Z.brick[2]], 2, 0.3, 6); break;
        case 'regrow': burst(x, y, 8, [Z.crust[0], Z.crust[1], Z.crust[2]], 1.2, 1, -1, 0.05); break;
        case 'sealed': burst(x, y - 0.4, 6, [Z.brick[2], Z.brick[3]], 1.5, 0.4, 4, 0.05); break;
        case 'shard':
          burst(x, y, 22, [Z.shard[1], Z.shard[2], '#ffffff'], 5, 0.7, -2, 0.08, Z.glow);
          P(x, y - 0.4, 0, -1.5, 0.9, Z.shard[1], 0.5, 0, null, 'text', '250');
          break;
        case 'reveal': revealAt = performance.now(); flash = 0.12; flashCol = Z.glow; break;
        case 'trap':
          burst(x, y - 0.2, 10, [Z.golem[1], Z.golem[2]], 2.5, 0.5, 8, 0.07);
          P(x, y - 0.9, 0, -1.2, 0.8, '#ffffff', 0.35, 0, null, 'text', '75');
          break;
        case 'crush':
          burst(x, y, 26, [Z.golem[0], Z.golem[1], Z.golem[2]], 5, 0.9, 12, 0.1);
          burst(x, y, 8, [Z.eye], 3, 0.6, 2, 0.06, Z.eyeGlow);
          shake = Math.max(shake, 0.18);
          break;
        case 'respawn': burst(x, y, 18, [Z.golem[2], `rgb(${Z.rune})`], 2.5, 0.6, -1, 0.06, Z.rune); break;
        case 'free': burst(x, y + 0.4, 6, [Z.brick[2]], 2, 0.4, 8, 0.05); break;
        case 'lift': case 'drop': burst(x, y, 8, [Z.shard[1]], 2, 0.4, 0, 0.05, Z.glow); break;
        case 'land': if (e.n > 24) burst(x, y + 0.45, 6, ['rgba(220,240,255,0.8)'], 2, 0.35, 4, 0.05); break;
        case 'die':
          burst(x, y, 30, ['#ffe7a3', '#ff6f5e', '#2fb7a6'], 6, 1, 10, 0.1, '255,200,120');
          for (let i = 0; i < 14; i++) P(x + (rand() - 0.5) * 0.6, y, (rand() - 0.5) * 0.8, -1 - rand() * 2.5, 1.6, 'rgba(200,240,255,0.7)', 0.05 + rand() * 0.06, -1, null, 'bubble');
          shake = 0.35; flash = 0.15; flashCol = '255,120,100';
          break;
        case 'clear': burst(x, 0.3, 40, [Z.shard[1], '#ffffff', Z.accent], 6, 1.3, -1, 0.09, Z.glow); break;
      }
    }
  }
  function stepParts(dt) {
    for (const p of parts) {
      p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - dt * (p.kind === 'bubble' ? 0.5 : 1.8);
      if (p.kind === 'bubble') p.x += Math.sin(p.life * 9 + p.max * 13) * dt * 0.4;
    }
    parts = parts.filter(p => p.life > 0);
    if (parts.length > 600) parts.splice(0, parts.length - 600);
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
  }
  function drawParts() {
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.kind === 'text') {
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
        label(p.text, F.x0 + p.x * ts, F.y0 + p.y * ts, 24 + p.size * 10, rgba(p.col.startsWith('#') ? p.col : '#ffffff', a), 800, 'center', 1);
        g.restore();
        continue;
      }
      g.globalAlpha = a;
      if (p.kind === 'bubble') { g.strokeStyle = p.col; g.lineWidth = 0.02; g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.stroke(); }
      else if (p.kind === 'chunk') { g.fillStyle = p.col; g.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 1.6); }
      else { g.fillStyle = p.col; g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill(); }
    }
    g.globalAlpha = 1;
    for (const p of parts) if (p.gl && p.kind !== 'text') glow(g, p.gl, p.x, p.y, p.size * 5, (p.life / p.max) * 0.5);
  }

  // ---------- backdrop: water, light from above, ruins in three depths, drifting motes ----------
  let camX = COLS / 2, motes = [], revealAt = 0;
  // into the half-size buffer, in full-size coordinates; `well` darkens the field behind the
  // tiles, `dim` the whole screen behind a menu
  function drawBackdrop(world, dt, t, focusX = COLS / 2, { well = false, dim = 0 } = {}) {
    const B = backdrop(world), Z = PAL[world], g0 = g;
    camX += (focusX - camX) * (1 - Math.exp(-dt * 1.5));
    const k = (camX / COLS - 0.5) * 2, slack = B.W * 2 - cw;
    g = bg;
    g.setTransform(0.5, 0, 0, 0.5, 0, 0);
    g.globalCompositeOperation = 'copy';
    g.drawImage(B.sky, 0, 0, cw, ch);
    // shafts of light swaying down from the surface
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = cw * (0.12 + i * 0.2) + Math.sin(t * 0.17 + i * 1.7) * 60 * u - k * 30 * u, w = (70 + (i % 3) * 40) * u;
      const a = 0.05 + Math.sin(t * 0.4 + i * 2.3) * 0.025;
      const gr = g.createLinearGradient(0, 0, 0, ch * 0.9);
      gr.addColorStop(0, `rgba(${Z.ray},${a})`); gr.addColorStop(1, `rgba(${Z.ray},0)`);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w * 2.4 - 160 * u, ch * 0.9); g.lineTo(x - 160 * u, ch * 0.9); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.drawImage(B.mid, -slack / 2 - k * slack * 0.3, 0, B.W * 2, ch);
    g.drawImage(B.near, -slack / 2 - k * slack * 0.5, 0, B.W * 2, ch);
    // motes and bubbles
    while (motes.length < 46) motes.push({ x: rand() * cw, y: rand() * ch, s: (0.6 + rand() * 1.8) * u, v: (6 + rand() * 18) * u, p: rand() * TAU, b: rand() < 0.25 });
    for (const m of motes) {
      m.y -= m.v * dt * (m.b ? 2.5 : 1); m.x += Math.sin(t * 0.6 + m.p) * dt * 8 * u;
      if (m.y < -10) { m.y = ch + 10; m.x = rand() * cw; }
      const a = 0.25 + Math.sin(t * 1.3 + m.p) * 0.15;
      if (m.b) { g.strokeStyle = `rgba(${Z.mote},${a})`; g.lineWidth = 1.2 * u; g.beginPath(); g.arc(m.x, m.y, m.s * 2.2, 0, TAU); g.stroke(); }
      else { g.fillStyle = `rgba(${Z.mote},${a})`; g.fillRect(m.x, m.y, m.s, m.s); }
    }
    if (well) { g.fillStyle = 'rgba(0,6,12,0.28)'; g.fillRect(F.x0, F.y0, F.w, F.h); }
    if (dim) { g.fillStyle = `rgba(2,8,14,${dim})`; g.fillRect(0, 0, cw, ch); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(vign, 0, 0); }
    g = g0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(bc, 0, 0, cw, ch);
  }

  // ---------- holes and the stair ----------
  function cavity(Z, c, r, top, bot) {
    if (bot <= top) return;
    const gr = g.createLinearGradient(0, r + top, 0, r + bot);
    gr.addColorStop(0, Z.cavity[0]); gr.addColorStop(1, Z.cavity[1]);
    g.fillStyle = gr; g.fillRect(c - 0.005, r + top, 1.01, bot - top);
    // a ragged rim
    g.fillStyle = Z.brick[0];
    for (let i = 0; i < 4; i++) { const h = hash2(c * 7 + i, r); g.fillRect(c + i * 0.25, r + top, 0.25, 0.03 + (h % 5) * 0.012); }
  }
  function drawHoles(Z, s, Tl) {
    for (const h of s.holes) {
      const sprite = Tl.bricks[hash2(h.c, h.r) % 4], px = Math.round(ts);
      if (h.ph === 0) {
        const k = h.t / T.dig;
        cavity(Z, h.c, h.r, 0, k);
        if (rand() < 0.5) chunk(h.c + 0.5, h.r + k * 0.8, Z, 1, 2);
      } else if (h.ph === 1) {
        cavity(Z, h.c, h.r, 0, 1);
        g.fillStyle = Z.brick[0];
        g.fillRect(h.c + 0.1, h.r + 0.88, 0.25, 0.12); g.fillRect(h.c + 0.55, h.r + 0.9, 0.3, 0.1);
        // the brick starts growing back: a crust round the rim
        if (h.t > T.open - 90) {
          const k = (h.t - (T.open - 90)) / 90;
          g.fillStyle = rgba(Z.crust[0], 0.7 * k);
          g.fillRect(h.c, h.r, 1, 0.06 * k); g.fillRect(h.c, h.r + 1 - 0.08 * k, 1, 0.08 * k);
        }
      } else {
        const k = h.t / T.fill, top = 1 - k;
        cavity(Z, h.c, h.r, 0, top);
        g.drawImage(sprite, 0, Math.floor(top * px), px, Math.max(1, Math.ceil(k * px)), h.c, h.r + top, 1, k);
      }
    }
  }
  function drawStair(L, Z, s, Tl, t) {
    if (!s?.revealed) return;
    const age = (s.t - s.revealT) / 60, n = L.stair.length;
    const order = [...L.stair].sort((a, b) => b.r - a.r);
    order.forEach((p, i) => {
      const k = clamp(age * 2.2 - (i / Math.max(1, n)) * 1.4, 0, 1);
      if (k <= 0) return;
      g.globalAlpha = k * (0.85 + Math.sin(t * 4 + p.r) * 0.1);
      g.drawImage(Tl.ladder, p.c, p.r, 1, 1);
      g.globalAlpha = 1;
      glow(g, Z.glow, p.c + 0.5, p.r + 0.5, 0.9, 0.18 * k);
    });
  }

  // ---------- the scene: L the level, s the live state (null in the editor) ----------
  const prevAnim = new Map();
  function heroPose(h) {
    if (h.dig) return 'dig';
    if (h.mode === 'fall') return 'fall';
    if (h.mode === 'ladder') return 'ladder';
    if (h.mode === 'bar') return 'bar';
    return h.moved ? 'run' : 'stand';
  }
  function drawScene(L, s, dt, t, { focus = null, editor = false } = {}) {
    const world = L.world ?? 0, Z = PAL[world], Tl = tileSet(world);
    const h = s?.hero;
    drawBackdrop(world, dt, t, focus ?? (h ? h.x / U + 0.5 : COLS / 2), { well: true });
    const sx = shake > 0 ? (rand() - 0.5) * shake * 0.35 * ts : 0, sy = shake > 0 ? (rand() - 0.5) * shake * 0.35 * ts : 0;
    // the field: a dim well behind the tiles, a frame round it
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = rgba(Z.stone[2], 0.35); g.lineWidth = 3 * u; g.strokeRect(F.x0 - 4 * u, F.y0 - 4 * u, F.w + 8 * u, F.h + 8 * u);
    g.drawImage(layerFor(L), F.x0 + sx, F.y0 + sy);
    g.setTransform(ts, 0, 0, ts, F.x0 + sx, F.y0 + sy);
    if (s) drawHoles(Z, s, Tl);
    drawStair(L, Z, s, Tl, t);
    if (editor) { g.globalAlpha = 0.45; for (const p of L.stair) g.drawImage(Tl.ladder, p.c, p.r, 1, 1); g.globalAlpha = 1; }
    // glimmers lying about
    const shards = s ? s.shards.filter(k => k.st === 0) : L.shards;
    for (const k of shards) drawShard(g, k.c + 0.5, k.r + 0.52 + Math.sin(t * 2.2 + k.c * 1.3) * 0.05, Z, t);
    // the sentinels
    const guards = s ? s.guards : L.guards.map((p, i) => ({ id: i, x: p.c * U, y: p.r * U, st: 'walk', mode: 'stand', face: -1, anim: 0, carry: -1 }));
    for (const o of guards) {
      if (o.st === 'dead') {
        // forming again at the top
        const k = 1 - o.t / T.respawn;
        if (k > 0.55) {
          const a = (k - 0.55) / 0.45;
          drawSentinel(g, o.rc, o.rr, Z, { pose: 'stand', t, alpha: a * 0.8, id: o.id, face: 1 });
          glow(g, Z.rune, o.rc + 0.5, o.rr + 0.5, 1.2, 0.35 * a);
        }
        continue;
      }
      const moved = prevAnim.get(o.id) !== o.anim;
      prevAnim.set(o.id, o.anim);
      const pose = o.st === 'trap' ? 'trap' : o.st === 'climb' ? 'climb' : o.mode === 'fall' ? 'fall' : o.mode === 'ladder' ? 'ladder' : o.mode === 'bar' ? 'bar' : moved ? 'run' : 'stand';
      const shakeX = o.st === 'trap' && o.t < 50 ? Math.sin(t * 50) * 0.03 : 0;
      drawSentinel(g, o.x / U, o.y / U, Z, { pose, ph: (o.anim / U) * Math.PI, face: o.face, t, carry: o.carry >= 0, shake: shakeX, id: o.id });
    }
    // Wren
    const showHero = h && !(s.status === 'dying' && s.statusT > 12) && s.status !== 'dead';
    if (showHero) {
      const pose = heroPose(h), ph = pose === 'ladder' ? (h.y / U) * Math.PI : pose === 'bar' ? (h.x / U) * Math.PI : (h.anim / U) * Math.PI;
      const a = s.status === 'clear' ? clamp(1 - s.statusT / 30, 0, 1) : 1;
      drawWren(g, h.x / U, h.y / U, { pose, ph, face: h.face, t, dig: h.dig ? 1 - h.dig / T.dig : 0, alpha: a });
    }
    if (!s && L.start) drawWren(g, L.start.c, L.start.r, { pose: 'stand', t });
    drawParts();

    // the deep: darkness with light around every glowing thing
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'copy';
    lg.drawImage(darkOf(world, editor), 0, 0);
    lg.globalCompositeOperation = 'destination-out';
    const k = ts / 2, ox = F.x0 / 2, oy = F.y0 / 2;
    const hole = (x, y, r, a = 1) => { lg.globalAlpha = a; lg.drawImage(LIGHT, ox + (x - r) * k, oy + (y - r) * k, r * 2 * k, r * 2 * k); };
    if (showHero) hole(h.x / U + 0.5, h.y / U + 0.3, 4.6 + Math.sin(t * 3) * 0.1);
    for (const p of shards) hole(p.c + 0.5, p.r + 0.5, 1.8, 0.8);
    if (s?.revealed) for (const p of L.stair) hole(p.c + 0.5, p.r + 0.5, 1.4, 0.6);
    for (const o of guards) if (o.st !== 'dead') hole(o.x / U + 0.6, o.y / U + 0.25, 0.9, 0.5);
    lg.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(lc, 0, 0, cw, ch);
    // glows on top
    g.setTransform(ts, 0, 0, ts, F.x0 + sx, F.y0 + sy);
    if (showHero) {
      const lx = h.x / U + 0.5 + (h.mode === 'ladder' ? 0 : h.face * 0.03), ly = h.y / U + (h.dig ? 0.13 : h.mode === 'bar' ? 0.06 : 0.07);
      glow(g, '255,225,150', lx, ly, 1.1, 0.5);
      glow(g, '255,200,120', h.x / U + 0.5, h.y / U + 0.5, 2.2, 0.12);
    }
    for (const p of shards) glow(g, Z.glow, p.c + 0.5, p.r + 0.5, 0.95, 0.5 + Math.sin(t * 3 + p.c) * 0.12);
    for (const o of guards) {
      if (o.st === 'dead' || o.mode === 'ladder') continue;
      glow(g, Z.eyeGlow, o.x / U + 0.5 + o.face * 0.07, o.y / U + 0.22, 0.45, 0.55);
      if (o.carry >= 0) glow(g, Z.glow, o.x / U + 0.5, o.y / U + 0.56, 0.6, 0.45);
    }
    if (s?.revealed) { const a = clamp(1 - (performance.now() - revealAt) / 900, 0, 1); for (const p of L.stair) glow(g, Z.glow, p.c + 0.5, p.r + 0.5, 1.4, 0.35 * a); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (flash > 0) { g.fillStyle = `rgba(${flashCol},${flash * 1.4})`; g.fillRect(0, 0, cw, ch); }
  }

  // ---------- HUD (the band above the field) ----------
  function helmetIcon(x, y, r) {
    g.fillStyle = '#8a5a1c'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.fillStyle = '#e0a646'; g.beginPath(); g.arc(x, y, r * 0.88, 0, TAU); g.fill();
    g.fillStyle = '#ffe7a3'; g.beginPath(); g.arc(x + r * 0.28, y + r * 0.05, r * 0.45, 0, TAU); g.fill();
  }
  function drawHud(app) {
    const s = app.sim.s, L = app.sim.L, Z = PAL[L.world ?? 0], y = F.y0 * 0.66;
    const gr = g.createLinearGradient(0, 0, 0, F.y0);
    gr.addColorStop(0, 'rgba(2,8,14,0.8)'); gr.addColorStop(1, 'rgba(2,8,14,0.2)');
    g.fillStyle = gr; g.fillRect(0, 0, cw, F.y0 - 4 * u);
    const id = app.custom ? 'EDIT' : L.id;
    label(id, F.x0, y, 26, Z.accent, 700, 'left', 2, SERIF);
    label(L.name.toUpperCase(), F.x0 + labelW(id, 26, 700, 2, SERIF) + 22 * u, y, 21, DIM, 700, 'left', 3);
    // glimmers
    const total = L.shards.length, got = s.tally.shards, cx = cw / 2;
    g.save(); g.translate(cx - 70 * u, y - 9 * u); g.scale(52 * u, 52 * u); drawShard(g, 0, 0, Z, app.t, 0.9); g.restore();
    glow(g, Z.glow, cx - 70 * u, y - 9 * u, 26 * u, 0.35);
    if (s.revealed) label(s.status === 'clear' ? 'OUT!' : 'CLIMB OUT!', cx - 44 * u, y, 26, `rgba(255,240,200,${pulse(app.t, 6)})`, 800, 'left', 3);
    else label(`${got} / ${total}`, cx - 44 * u, y, 26, INK, 800, 'left', 1);
    // score and lives
    const right = F.x0 + F.w;
    label(pad6(s.score), right - 300 * u, y, 28, INK, 800, 'right', 2);
    const n = Math.min(app.run.lives, 9);
    for (let i = 0; i < n; i++) helmetIcon(right - 270 * u + i * 30 * u, y - 9 * u, 11 * u);
    if (app.touch?.active && app.state === 'play') drawTouch(app);
  }
  function drawTouch(app) {
    const T2 = app.touch, Lp = pads(cw, ch);
    const ring = (c, txt, on) => {
      g.fillStyle = on ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(c.x, c.y, c.r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 2 * u; g.stroke();
      label(txt, c.x, c.y + 9 * u, 24, 'rgba(255,255,255,0.85)', 800, 'center', 2);
    };
    ring(Lp.digL, '◀ DIG', T2.digL); ring(Lp.digR, 'DIG ▶', T2.digR); ring(Lp.pause, 'II', false);
    if (T2.stick) {
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2 * u;
      g.beginPath(); g.arc(T2.stick.x0, T2.stick.y0, Lp.stickR, 0, TAU); g.stroke();
      const dx = T2.stick.x - T2.stick.x0, dy = T2.stick.y - T2.stick.y0, d = Math.min(Lp.stickR, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(T2.stick.x0 + Math.cos(a) * d, T2.stick.y0 + Math.sin(a) * d, 40 * u, 0, TAU); g.fill();
    } else label('DRAG TO MOVE', 220 * u, ch - 80 * u, 20, 'rgba(255,255,255,0.35)', 700, 'center', 3);
  }

  // ---------- screens ----------
  function logo(cy, size, t) {
    const s = 'GLIMMER';
    setFont(size, 700, SERIF);
    if ('letterSpacing' in g) g.letterSpacing = size * 0.08 * u + 'px';
    const w = g.measureText(s).width, x = cw / 2 - w / 2;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(0,10,20,0.6)'; g.fillText(s, x + 5 * u, cy + 7 * u);
    const gr = g.createLinearGradient(x, cy - size * 0.8 * u, x + w, cy);
    const sweep = (t * 0.18) % 1.6 - 0.3;
    gr.addColorStop(0, '#9fe9ff'); gr.addColorStop(clamp(sweep - 0.08, 0, 1), '#e8fbff');
    gr.addColorStop(clamp(sweep, 0, 1), '#ffffff'); gr.addColorStop(clamp(sweep + 0.08, 0, 1), '#ffe3a0'); gr.addColorStop(1, '#e0a646');
    g.fillStyle = gr; g.fillText(s, x, cy);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    glow(g, '140,230,255', cw / 2, cy - size * 0.35 * u, w * 0.55, 0.16 + Math.sin(t * 2) * 0.04);
  }
  // a little scene: Wren digging a trap, a sentinel walking into it
  function vignette(cx, fy, sc, t) {
    const Z = PAL[0], Tl = tileSet(0), ph = (t * 0.45) % 1;
    g.save(); g.translate(cx, fy); g.scale(sc, sc);
    for (let c = -4; c <= 3; c++) if (c !== 0) g.drawImage(Tl.bricks[(c + 8) % 4], c, 0, 1, 1);
    cavity(Z, 0, 0, 0, 1);
    drawWren(g, -2, -1, { pose: ph < 0.25 ? 'dig' : 'stand', dig: (ph * 4) % 1, face: 1, t });
    const gx = ph < 0.25 ? 3 : 3 - Math.min(3, (ph - 0.25) * 8);
    const inHole = gx <= 0;
    drawSentinel(g, inHole ? 0 : gx, inHole ? 0 : -1, Z, { pose: inHole ? 'trap' : 'run', ph: t * 9, face: -1, t });
    drawShard(g, -3.5, -0.48 + Math.sin(t * 2) * 0.05, Z, t);
    drawShard(g, 2.6, -1.5 + Math.sin(t * 2 + 1) * 0.05, Z, t);
    g.restore();
    glow(g, '255,225,150', cx - 1.5 * sc, fy - 0.9 * sc, sc * 1.4, 0.35);
    glow(g, Z.glow, cx - 3.5 * sc, fy - 0.5 * sc, sc * 0.9, 0.5);
    glow(g, Z.glow, cx + 2.6 * sc, fy - 1.5 * sc, sc * 0.9, 0.5);
  }
  let pan = 0;
  function sceneryBackdrop(world, dt, t, dim) { pan += dt; drawBackdrop(world, dt, t, COLS / 2 + Math.sin(pan * 0.12) * 12, { dim }); }
  function menuRects(app) {
    // four entries (CONTINUE first) sit a little higher and closer, clear of the legend
    const items = app.titleItems(), four = items.length > 3;
    return items.map((it, i) => ({ it, x: cw / 2 - 200 * u, y: (four ? 528 : 560) * u + i * (four ? 60 : 64) * u, w: 400 * u, h: 54 * u }));
  }
  function drawTitle(app, dt) {
    const t = app.t;
    sceneryBackdrop(0, dt, t, 0.35);
    logo(250 * u, 170, t);
    label('GATHER THE LIGHT OF A DROWNED CITY', cw / 2, 318 * u, 22, PAL[0].accent, 700, 'center', 7);
    vignette(cw / 2, 450 * u, 56 * u, t);
    const names = { play: 'PLAY', editor: 'LEVEL EDITOR', exit: 'EXIT' };
    menuRects(app).forEach((m, i) => {
      const on = i === app.menu;
      if (on) { glass(m.x, m.y, m.w, m.h, 27, 0.55); glow(g, '255,225,150', m.x + 32 * u, m.y + m.h / 2, 28 * u, 0.7); }
      if (m.it === 'continue') {
        // the checkpoint under its entry: where the run stands and how long ago
        label('CONTINUE', cw / 2, m.y + 29 * u, on ? 27 : 24, on ? '#ffffff' : DIM, 700, 'center', 5, SERIF);
        label(`${app.saved.label} · ${savedAgo(app.saved.at)}`, cw / 2, m.y + 47 * u, 15, on ? PAL[0].accent : 'rgba(255,255,255,0.42)', 700, 'center', 2);
      } else label(names[m.it], cw / 2, m.y + m.h * 0.7, on ? 32 : 27, on ? '#ffffff' : DIM, 700, 'center', 5, SERIF);
    });
    const input = app.input, kb = input.device.kind === 'keyboard';
    const rows = [[['move', 'RUN'], ['climb', 'CLIMB'], ['digL', 'DIG LEFT'], ['digR', 'DIG RIGHT']], [['restart', 'GIVE UP LEVEL'], ['pause', 'PAUSE']]];
    const extra = [];
    if (kb) extra.push(['sound', 'SOUND'], ['fullscreen', 'FULL SCREEN']);
    if (app.onExit) extra.push(['quit', 'EXIT']);
    if (extra.length) rows.push(extra);
    legend(input, rows, cw / 2, 790 * u, 46, 20);
    prompt(input, 'PRESS {start}', cw / 2, 965 * u, 28, `rgba(255,215,122,${pulse(t)})`, 'center', 800);
    const total = Object.values(app.save.best).reduce((a, b) => a + b, 0);
    label(`REACHED ${LEVELS[app.save.reached].id}    BEST TOTAL ${pad6(total)}    SOUND ${app.soundOn ? 'ON' : 'OFF'}`, cw / 2, 1040 * u, 17, 'rgba(255,255,255,0.42)', 700, 'center', 3);
  }
  function selectRect(i) {
    const w = Math.floor(i / 8), k = i % 8, tw = 156 * u, th = Math.round((tw * 16) / 28);
    return { x: 470 * u + k * (tw + 16 * u), y: 160 * u + w * 190 * u, w: tw, h: th };
  }
  function drawSelect(app, dt) {
    const t = app.t, sel = app.sel, world = LEVELS[sel].world;
    sceneryBackdrop(world, dt, t, 0.6);
    label('CHOOSE A LEVEL', cw / 2, 100 * u, 44, '#ffffff', 700, 'center', 8, SERIF);
    WORLDS.forEach((W, w) => {
      const y = 160 * u + w * 190 * u;
      label(W.name.toUpperCase(), 440 * u, y + 52 * u, 21, w === world ? PAL[w].accent : DIM, 700, 'right', 2, SERIF);
      label(W.blurb, 440 * u, y + 82 * u, 15, 'rgba(255,255,255,0.4)', 600, 'right', 0.5);
    });
    LEVELS.forEach((d, i) => {
      const r = selectRect(i), locked = i > app.save.reached, on = i === sel, best = app.save.best[d.id];
      if (on) glow(g, PAL[d.world].glow, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.85, 0.3);
      g.save();
      g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 10 * u); g.clip();
      g.globalAlpha = locked ? 0.22 : on ? 1 : 0.72;
      g.drawImage(thumbOf(i, Math.round(r.w), Math.round(r.h)), r.x, r.y, r.w, r.h);
      g.restore();
      g.strokeStyle = on ? '#ffffff' : 'rgba(255,255,255,0.14)'; g.lineWidth = (on ? 4 : 2) * u;
      g.beginPath(); g.roundRect(r.x, r.y, r.w, r.h, 10 * u); g.stroke();
      label(d.id, r.x + 4 * u, r.y + r.h + 26 * u, 19, on ? '#ffffff' : DIM, 800, 'left', 2);
      if (best) label(pad6(best), r.x + r.w - 2 * u, r.y + r.h + 26 * u, 15, GOLD, 700, 'right', 1);
      if (locked) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.roundRect(cx - 16 * u, cy - 4 * u, 32 * u, 25 * u, 5 * u); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 5 * u; g.beginPath(); g.arc(cx, cy - 5 * u, 10 * u, Math.PI, TAU); g.stroke();
      }
    });
    const d = LEVELS[sel], locked = sel > app.save.reached;
    glass(220 * u, 950 * u, cw - 440 * u, 90 * u, 24, 0.55);
    label(`${d.id}  ${d.name.toUpperCase()}`, 260 * u, 1005 * u, 28, '#ffffff', 700, 'left', 3, SERIF);
    const guards = d.map.join('').split('G').length - 1, shards = d.map.join('').split('*').length - 1;
    label(locked ? 'CLEAR THE LEVEL BEFORE IT TO REACH THIS ONE' : `${shards} GLIMMERS · ${guards ? guards + (guards > 1 ? ' SENTINELS' : ' SENTINEL') : 'NO SENTINELS'}`, 800 * u, 1004 * u, 19, DIM, 700, 'left', 2);
    prompt(app.input, locked ? '{back} BACK' : '{start} PLAY   {back} BACK', cw - 260 * u, 1004 * u, 21, 'rgba(255,255,255,0.75)', 'right');
  }
  function drawReady(app) {
    const d = app.def, t = app.stT, W = WORLDS[d.world ?? 0], long = app.worldIntro;
    shade(0.35 * (1 - ease((t - (long ? 2.4 : 1.2)) * 3)));
    const a = clamp(t * 4, 0, 1) * (1 - clamp((t - (long ? 2.7 : 1.4)) * 4, 0, 1));
    if (a <= 0) return;
    g.globalAlpha = a;
    const w = 1000 * u, h = (long ? 320 : 230) * u, x = (cw - w) / 2, y = (ch - h) / 2 - 20 * u;
    glass(x, y, w, h, 30, 0.66);
    let yy = y + 70 * u;
    if (long) {
      label(W.name.toUpperCase(), cw / 2, yy + 8 * u, 50, PAL[d.world].accent, 700, 'center', 8, SERIF);
      label(W.blurb, cw / 2, yy + 52 * u, 21, DIM, 600, 'center', 1);
      yy += 110 * u;
    }
    label(app.custom ? 'YOUR LEVEL' : 'LEVEL ' + d.id, cw / 2, yy, 22, DIM, 800, 'center', 6);
    label(d.name, cw / 2, yy + 56 * u, 48, '#ffffff', 700, 'center', 2, SERIF);
    if (!app.custom && d.index === 0 && d.world === 0) label('Gather every glimmer, then climb out the top', cw / 2, yy + 100 * u, 21, GOLD, 700, 'center', 1);
    g.globalAlpha = 1;
  }
  function drawPause(app) {
    shade(0.5);
    const w = 660 * u, h = 440 * u, x = (cw - w) / 2, y = (ch - h) / 2;
    glass(x, y, w, h);
    label('PAUSED', cw / 2, y + 95 * u, 58, '#ffffff', 700, 'center', 12, SERIF);
    const rows = [[['pause', 'RESUME']], [['restart', 'GIVE UP THE LEVEL']], [['quit', app.custom ? 'BACK TO EDITOR' : 'CHOOSE LEVEL']]];
    if (app.input.device.kind === 'keyboard') rows.push([['sound', app.soundOn ? 'SOUND OFF' : 'SOUND ON']]);
    legend(app.input, rows, cw / 2, y + 180 * u, 58, 23);
  }
  function drawClear(app) {
    const s = app.sim.s, Tt = s.tally, t = app.stT;
    shade(0.45 * ease(t * 2));
    const w = 820 * u, h = 560 * u, x = (cw - w) / 2, y = (ch - h) / 2;
    glass(x, y, w, h, 30, 0.7);
    label('OUT INTO THE LIGHT', cw / 2, y + 88 * u, 46, '#fff3cf', 700, 'center', 4, SERIF);
    label(app.custom ? 'YOUR LEVEL' : `${app.def.id}  ${app.def.name.toUpperCase()}`, cw / 2, y + 132 * u, 21, DIM, 700, 'center', 4);
    const rows = [
      ['GLIMMERS', `${Tt.shards} × 250`, Tt.shards * 250],
      ['SENTINELS TRAPPED', `${Tt.traps} × 75`, Tt.traps * 75],
      ['SENTINELS SEALED IN', `${Tt.crushed} × 75`, Tt.crushed * 75],
      ['LEVEL BONUS', '', 1500],
    ];
    rows.forEach(([a, b, v], i) => {
      const k = clamp((t - 0.25 - i * 0.28) * 3, 0, 1);
      if (k <= 0) return;
      g.globalAlpha = k;
      const yy = y + 212 * u + i * 56 * u;
      label(a, x + 70 * u, yy, 24, DIM, 700, 'left', 3);
      label(b, x + 520 * u, yy, 20, 'rgba(255,255,255,0.45)', 700, 'right', 1);
      label(String(Math.round(v * k)), x + w - 70 * u, yy, 28, '#ffffff', 800, 'right', 1);
      g.globalAlpha = 1;
    });
    const k = clamp((t - 1.4) * 3, 0, 1);
    if (k > 0) {
      g.globalAlpha = k;
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x + 60 * u, y + 425 * u, w - 120 * u, 2 * u);
      label('LEVEL SCORE', x + 70 * u, y + 472 * u, 26, GOLD, 700, 'left', 3);
      label(String(s.levelScore), x + w - 70 * u, y + 472 * u, 36, GOLD, 800, 'right', 1);
      const notes = [app.newBest ? 'NEW BEST!' : null, app.lifeUp ? 'EXTRA LIFE!' : null].filter(Boolean).join('   ');
      if (notes) label(notes, cw / 2, y + 520 * u, 21, `rgba(160,255,200,${pulse(app.t, 6)})`, 800, 'center', 6);
      g.globalAlpha = 1;
    }
    if (t > 1.2) {
      const last = !app.custom && app.level === LEVELS.length - 1;
      prompt(app.input, app.custom ? '{start} BACK TO EDITOR' : last ? '{start} TO THE SURFACE' : '{start} NEXT LEVEL   {back} CHOOSE', cw / 2, y + h + 50 * u, 25, `rgba(255,215,122,${pulse(app.t)})`, 'center', 800);
    }
  }
  function drawOver(app) {
    shade(0.55);
    const w = 760 * u, h = 330 * u, x = (cw - w) / 2, y = (ch - h) / 2;
    glass(x, y, w, h);
    label('THE DEEP KEEPS YOU', cw / 2, y + 95 * u, 46, '#ff9e8a', 700, 'center', 4, SERIF);
    label('SCORE ' + pad6(app.sim.s.score), cw / 2, y + 150 * u, 25, '#ffffff', 700, 'center', 4);
    label('CONTINUE?  ' + Math.max(0, Math.ceil(10 - app.stT)), cw / 2, y + 215 * u, 32, GOLD, 800, 'center', 6);
    if (app.stT > 1) prompt(app.input, '{start} YES   {back} NO', cw / 2, y + 282 * u, 23, 'rgba(255,255,255,0.8)', 'center', 800);
  }
  function drawEnding(app, dt) {
    const t = app.stT;
    sceneryBackdrop(0, dt, app.t);
    // the surface opening up: more and more light
    const k = clamp(t / 6, 0, 1);
    g.fillStyle = `rgba(220,250,255,${0.25 * k})`; g.fillRect(0, 0, cw, ch);
    glow(g, '255,250,220', cw / 2, -ch * 0.1, ch * (0.6 + k * 0.6), 0.5 + k * 0.4);
    g.drawImage(vign, 0, 0, cw, ch);
    const sc = 110 * u, rise = (1 - ease(t / 5)) * 260 * u;
    g.save(); g.setTransform(sc, 0, 0, sc, 0, 0);
    drawWren(g, cw / 2 / sc - 0.5, (620 * u + rise) / sc - 1, { pose: 'fall', t: app.t, ph: app.t * 4 });
    for (let i = 0; i < 9; i++) {
      const a = app.t * 0.6 + (i / 9) * TAU;
      drawShard(g, cw / 2 / sc + Math.cos(a) * 1.6, (560 * u + rise) / sc + Math.sin(a) * 0.6, PAL[i % 4], app.t, 0.8);
    }
    g.restore();
    glow(g, '255,225,150', cw / 2, 560 * u + rise, sc * 2, 0.4);
    const lines = ['The last glimmer of the drowned city is gathered.', 'Wren rises through the old light into the open sea,', 'and far below, the sentinels finally stand still.'];
    g.shadowColor = 'rgba(0,30,45,0.85)'; g.shadowBlur = 14 * u;
    lines.forEach((l, i) => { const a = clamp((t - 0.8 - i * 1.2) * 2, 0, 1); if (a > 0) label(l, cw / 2, 190 * u + i * 52 * u, 29, `rgba(242,251,255,${a})`, 700, 'center'); });
    g.shadowColor = 'transparent'; g.shadowBlur = 0;
    if (t > 4) {
      label('SCORE ' + pad6(app.run.score), cw / 2, 930 * u, 29, '#ffffff', 800, 'center', 4);
      prompt(app.input, 'PRESS {start}', cw / 2, 1000 * u, 25, `rgba(255,215,122,${pulse(app.t)})`, 'center', 800);
    }
  }
  function drawEditor(app, dt) {
    const E = app.editor, L = E.level, t = app.t;
    L.world = E.world;
    drawScene(L, null, dt, t, { focus: COLS / 2, editor: true });
    g.setTransform(ts, 0, 0, ts, F.x0, F.y0);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1 / ts;
    g.beginPath();
    for (let c = 1; c < COLS; c++) { g.moveTo(c, 0); g.lineTo(c, ROWS); }
    for (let r = 1; r < ROWS; r++) { g.moveTo(0, r); g.lineTo(COLS, r); }
    g.stroke();
    // what the art hides: false bricks
    g.fillStyle = 'rgba(255,120,120,0.85)';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (L.t[r][c] === '~') { g.beginPath(); g.arc(c + 0.5, r + 0.5, 0.1, 0, TAU); g.fill(); }
    const cur = E.cur, hov = E.hover;
    g.strokeStyle = `rgba(255,255,255,${pulse(t, 6)})`; g.lineWidth = 3 / ts;
    g.strokeRect(cur.c + 0.04, cur.r + 0.04, 0.92, 0.92);
    if (hov) { g.strokeStyle = 'rgba(160,230,255,0.6)'; g.strokeRect(hov.c + 0.04, hov.r + 0.04, 0.92, 0.92); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = 'rgba(2,10,18,0.9)'; g.fillRect(0, 0, cw, F.y0 - 2 * u);
    const names = { world: WORLDS[E.world].name.replace('The ', '').split(' ')[0].toUpperCase(), slot: 'LEVEL ' + (E.slot + 1), clear: 'CLEAR', test: '▶ TEST', exit: 'EXIT' };
    for (const b of toolbar(cw, ch)) {
      if (b.kind === 'brush') {
        const on = b.i === E.brush;
        g.fillStyle = on ? 'rgba(160,230,255,0.25)' : 'rgba(255,255,255,0.06)';
        g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 8 * u); g.fill();
        brushIcon(b.b, b.x, b.y, b.w, E.world, t);
        if (on) { g.strokeStyle = '#ffffff'; g.lineWidth = 2 * u; g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 8 * u); g.stroke(); }
      } else {
        g.fillStyle = b.id === 'test' ? 'rgba(120,230,170,0.25)' : 'rgba(255,255,255,0.08)';
        g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 10 * u); g.fill();
        label(names[b.id], b.x + b.w / 2, b.y + b.h * 0.64, 18, '#ffffff', 800, 'center', 1);
      }
    }
    const name = BRUSH_NAMES[BRUSHES[E.brush]];
    const by = F.y0 + F.h + 6 * u;
    glass(F.x0, by, F.w, ch - by - 4 * u, 12, 0.75);
    label(name.toUpperCase(), F.x0 + 18 * u, ch - 12 * u, 17, GOLD, 800, 'left', 2);
    if (E.msg) label(E.msg.text, cw / 2, ch - 12 * u, 19, '#ffb0a8', 800, 'center', 1);
    else prompt(app.input, 'CLICK PAINTS · RIGHT CLICK ERASES   {pick} CURSOR  {start} PAINT  {edit} BRUSH  {restart} TEST  {back} EXIT', F.x0 + F.w - 18 * u, ch - 18 * u, 15, 'rgba(255,255,255,0.7)', 'right');
  }
  function brushIcon(b, x, y, s, world, t) {
    const Z = PAL[world], Tl = tileSet(world);
    g.save(); g.translate(x, y); g.scale(s, s);
    g.beginPath(); g.rect(0.04, 0.04, 0.92, 0.92); g.clip();
    const pic = img => g.drawImage(img, 0.12, 0.12, 0.76, 0.76);
    switch (b) {
      case '.': g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 0.06; g.beginPath(); g.moveTo(0.28, 0.28); g.lineTo(0.72, 0.72); g.moveTo(0.72, 0.28); g.lineTo(0.28, 0.72); g.stroke(); break;
      case '#': pic(Tl.bricks[0]); break;
      case '=': pic(Tl.stone[1]); break;
      case 'H': pic(Tl.ladder); break;
      case '-': g.drawImage(Tl.rope, 0.05, 0.3, 0.9, 0.9); break;
      case '~': pic(Tl.traps[0]); g.fillStyle = 'rgba(255,120,120,0.9)'; g.beginPath(); g.arc(0.5, 0.5, 0.09, 0, TAU); g.fill(); break;
      case '^': g.globalAlpha = 0.55 + Math.sin(t * 4) * 0.25; pic(Tl.ladder); g.globalAlpha = 1; break;
      case '*': drawShard(g, 0.5, 0.52, Z, t); break;
      case 'P': g.translate(0.1, 0.06); g.scale(0.8, 0.8); drawWren(g, 0, 0, { pose: 'stand', t }); break;
      case 'G': g.translate(0.1, 0.06); g.scale(0.8, 0.8); drawSentinel(g, 0, 0, Z, { pose: 'stand', t, face: -1 }); break;
    }
    g.restore();
  }

  let lastT = performance.now();
  function draw(app) {
    lastApp = app;
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    stepParts(dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    const s = app.state, sim = app.sim;
    if (s === 'title') drawTitle(app, dt);
    else if (s === 'select') drawSelect(app, dt);
    else if (s === 'ending') drawEnding(app, dt);
    else if (s === 'editor') drawEditor(app, dt);
    else if (sim.L) {
      drawScene(sim.L, sim.s, dt, app.t);
      if (!app.demo) drawHud(app);
      if (s === 'ready') drawReady(app);
      else if (s === 'pause') drawPause(app);
      else if (s === 'clear') drawClear(app);
      else if (s === 'over') drawOver(app);
    }
    if (app.fade > 0) shade(Math.min(1, app.fade), '0,0,0');
  }

  return {
    draw,
    events,
    level() { parts = []; shake = 0; flash = 0; prevAnim.clear(); },
    // touch picks: which level tile or title entry is under a canvas point
    tileAt(x, y) {
      for (let i = 0; i < LEVELS.length; i++) { const r = selectRect(i); if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h + 34 * u) return i; }
      return null;
    },
    menuAt(x, y) {
      const m = lastApp ? menuRects(lastApp) : [];
      const i = m.findIndex(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
      return i >= 0 ? i : null;
    },
    destroy() { destroyed = true; unfit(); },
  };
}
