// The HD renderer: the simulation and the app's screens as lit vectors at the window's own
// resolution, 16:9. Everything is drawn in a 1920 × 1080 reference frame scaled to fit. Each
// scene's still art is painted once per size into two layers (the sky at half resolution, the
// houses, floors and stairs at full); water, clouds, lamps, characters and the HUD are drawn
// every frame. It only reads state.
//
//   const view = createRenderer(canvas, app);
//   view.events(sim.events, sim);  view.draw(app);  view.hit(x, y, app) → touch target
import { fitWide } from '@nostalgia/game/runtime';
import { drawPrompt, drawGlyphs, glyphs, measureGlyphs } from '@nostalgia/input';
import { LETTERS } from '../app.js';
import { BOTTOM, FLOOR_Y, H, SCENES, W, WATER_Y } from '../scenes.js';
import { PUNCH_T, bagPos } from '../sim.js';
import { pads } from '../touch.js';
import { ART, KITE, TAU, canvas, glow, hash, paintBack, paintFront, paintSky } from './art.js';
import { drawBird, drawClementine, drawCrate, drawGlove, drawHat, drawKeep, drawRumbold, drawSandbag, drawShot, drawSpring, drawThrower, drawWick, star5 } from './sprites.js';

const F = "'Fredoka','Trebuchet MS',system-ui,sans-serif", LOGO = "'Lobster Two','Georgia',serif";
const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');
const SURFACE = 952; // where the water meets the quay wall
const MISS_TEXT = {
  brute: 'Rumbold caught you!', swipe: 'Walloped by Rumbold!', bottle: 'Hit by a flying bottle!', pot: 'Bonked by a flowerpot!',
  soot: 'Smacked by a soot bag!', bird: { park: 'Mobbed by the magpie!', roofs: 'Bowled over by the owl!' }, sank: { heart: 'A paper heart sank!', note: 'A note sank without a sound!', star: 'A star went out in the canal!' },
};
const KEEP_COL = { heart: '#ff5d7e', note: '#7b5cff', star: '#ffe066' };

export function createRenderer(cv, app0) {
  const g = cv.getContext('2d');
  let cw = 1, ch = 1, u = 1, destroyed = false, lastApp = app0, vign = null;
  let layers = { key: '', sky: null, back: null };
  function fit(w, h) {
    cw = w; ch = h; u = ch / H;
    vign = canvas(cw / 2, ch / 2);
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 4, ch / 4, ch * 0.2, cw / 4, ch / 4, cw * 0.31);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.42)');
    v.fillStyle = gr; v.fillRect(0, 0, cw / 2, ch / 2);
    layers = { key: '', sky: null, back: null };
    if (lastApp) draw(lastApp);
  }
  // the still demo frame is drawn once; draw it again when the web fonts arrive
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });
  const ref = () => g.setTransform(u, 0, 0, u, 0, 0);
  function sceneLayers(id) {
    const key = id + ':' + cw;
    if (layers.key !== key) {
      const make = (paint, k) => { const c = canvas(cw * k, ch * k), x = c.getContext('2d'); x.setTransform(u * k, 0, 0, u * k, 0, 0); paint(x, id); return c; };
      layers = { key, sky: make(paintSky, 0.5), back: make(paintBack, 1) };
    }
    return layers;
  }

  // ---------- text ----------
  const font = (size, wgt = 600, fam = F) => { g.font = `${wgt} ${size}px ${fam}`; };
  const spacing = s => { if ('letterSpacing' in g) g.letterSpacing = s + 'px'; };
  function label(s, x, y, size, col, wgt = 600, align = 'left', sp = 0) {
    font(size, wgt); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic'; spacing(sp);
    g.fillText(s, x, y); spacing(0); g.textAlign = 'left';
  }
  function outlined(s, x, y, size, col, line = '#2a1230', lw = 8, align = 'center', sp = 0, fam = F) {
    font(size, 700, fam); g.textAlign = align; g.lineJoin = 'round'; spacing(sp);
    g.strokeStyle = line; g.lineWidth = lw; g.strokeText(s, x, y);
    g.fillStyle = col; g.fillText(s, x, y); spacing(0); g.textAlign = 'left';
  }
  function labelW(s, size, wgt = 600, sp = 0) { font(size, wgt); spacing(sp); const w = g.measureText(s).width; spacing(0); return w; }
  const GST = { font: F };
  const prompt = (input, s, x, y, size, col, align = 'left', wgt = 600) =>
    drawPrompt(g, input, s, x, y, { font: `${wgt} ${size}px ${F}`, size: size * 1.3, color: col, align, letterSpacing: 1, style: GST });
  function legend(input, row, cx, y, size = 24) {
    const gs = size * 1.3, gap = 6, colGap = 40, inner = 10;
    const parts = row.map(([a, l]) => ({ list: glyphs(input, a), l }));
    for (const p of parts) { p.gw = measureGlyphs(g, p.list, gs, GST, gap); p.lw = labelW(p.l, size, 500, 1); }
    let x = cx - (parts.reduce((w, p) => w + p.gw + inner + p.lw, 0) + colGap * (parts.length - 1)) / 2;
    for (const p of parts) {
      drawGlyphs(g, p.list, x, y, gs, GST, gap);
      label(p.l, x + p.gw + inner, y + size * 0.36, size, 'rgba(255,255,255,0.88)', 500, 'left', 1);
      x += p.gw + inner + p.lw + colGap;
    }
  }
  function panel(x, y, w, h, r = 28, a = 0.72) {
    g.fillStyle = `rgba(28,14,40,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 3; g.stroke();
  }
  const shadeAll = a => { g.fillStyle = `rgba(10,4,20,${a})`; g.fillRect(0, 0, W, H); };
  const pulse = t => 0.55 + 0.45 * Math.sin(t * 4);

  // ---------- particles, pop-ups, shake ----------
  let parts = [], pops = [], shake = 0, flash = 0, flashCol = '#ffffff', ripples = [];
  const rand = Math.random;
  function burst(x, y, n, cols, speed = 300, life = 0.7, grav = 600, size = 6, lit = false) {
    if (parts.length > 500) return;
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, s = speed * (0.3 + rand() * 0.7);
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.4, life: life * (0.5 + rand() * 0.5), max: life, col: cols[Math.floor(rand() * cols.length)], size: size * (0.6 + rand() * 0.8), grav, lit, spin: rand() * TAU });
    }
  }
  const pop = (x, y, text, col = '#ffffff', size = 34) => pops.push({ x, y, text, col, size, life: 1.1 });
  function events(list, sim) {
    const A = ART[sim.sc.id];
    for (const e of list) {
      switch (e.type) {
        case 'catch': {
          const c = KEEP_COL[e.kind];
          burst(e.x, e.y, 18, [c, '#ffffff', A.accent], 320, 0.8, 300, 6, true);
          pop(e.x, e.y - 50, '+' + e.pts, '#ffffff', e.pts >= 300 ? 40 : 32);
          break;
        }
        case 'smash': burst(e.x, e.y, 16, e.kind === 'pot' ? ['#c4622d', '#e07b40', '#3fa34d'] : e.kind === 'bottle' ? ['#8fe0a0', '#46aa5a', '#ffffff'] : ['#1b1b22', '#55555f'], 360, 0.7, 1300, 7); pop(e.x, e.y - 30, '+' + e.pts, '#ffe066', 28); break;
        case 'birdhit': burst(e.x, e.y, 14, ['#ffffff', '#141420', '#2c3f8a'], 260, 0.9, 200, 6); pop(e.x, e.y - 40, '+' + e.pts, '#ffe066', 32); break;
        case 'bonk': burst(e.x, e.y, 26, ['#b8803f', '#6e4420', '#ffe066'], 420, 0.9, 1400, 9); pop(e.x, e.y - 60, 'BONK! +' + e.pts, '#ffe066', 44); shake = 0.35; break;
        case 'fling': burst(e.x, e.y - 100, 30, ['#ffe066', '#ffffff', '#ff5a4a'], 600, 0.8, 300, 8, true); pop(e.x, e.y - 160, (e.cause === 'swing' ? 'THWUMP! +' : 'HAYMAKER! +') + e.pts, '#ffe066', 52); shake = 0.5; flash = 0.15; flashCol = '#fff2b0'; break;
        case 'power': burst(e.x, e.y - 50, 30, ['#ff5a4a', '#ffe066', '#ffffff'], 380, 0.9, 100, 7, true); pop(e.x, e.y - 120, 'HAYMAKER!', '#ff8a7a', 48); flash = 0.2; flashCol = '#ff5a4a'; break;
        case 'splash': ripples.push({ x: e.x, t: 0, big: !!e.big }); burst(e.x, SURFACE, e.big ? 40 : 10, ['#cfeaff', '#ffffff', ART[sim.sc.id].water[0]], e.big ? 520 : 220, 0.8, 1500, e.big ? 8 : 5); break;
        case 'sink': ripples.push({ x: e.x, t: 0, big: false }); break;
        case 'miss': shake = 0.4; flash = 0.3; flashCol = '#ff4060'; break;
        case 'thud': burst(e.x, e.y, 12, ['#d8c8b0', '#9a8a78'], 200, 0.5, 800, 6); shake = Math.max(shake, 0.15); break;
        case 'swipe': burst(e.x + e.face * 110, e.y - 120, 6, ['#ffffff'], 200, 0.3, 0, 5); break;
        case 'boing': burst(e.x, FLOOR_Y[sim.gim.f ?? BOTTOM] - 40, 14, ['#ff8a3d', '#ffffff'], 300, 0.6, 600, 6); break;
        case 'toss': burst(e.x, e.y, 6, [KEEP_COL[e.kind] ?? '#ffffff', '#ffffff'], 120, 0.5, -60, 4, true); break;
        case 'clear': for (let k = 0; k < 7; k++) burst(200 + k * 250, 200 + rand() * 300, 26, ['#ff6f91', '#ffd166', '#06d6a0', '#46f0ff', '#ffffff'], 500, 1.8, 500, 9); break;
        case 'life': pop(960, 520, 'EXTRA LIFE!', '#ffd166', 60); flash = 0.15; flashCol = '#ffd166'; break;
        case 'scene': parts = []; pops = []; ripples = []; break;
        case 'climb': ripples.push({ x: e.x, t: 0, big: true }); break;
      }
    }
  }
  function stepFx(dt) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.spin += dt * 6; }
    parts = parts.filter(p => p.life > 0);
    for (const p of pops) { p.life -= dt; p.y -= 60 * dt; }
    pops = pops.filter(p => p.life > 0);
    for (const r of ripples) r.t += dt;
    ripples = ripples.filter(r => r.t < 1.4);
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
  }
  function drawFx() {
    for (const p of parts) {
      const a = Math.min(1, p.life / (p.max * 0.4));
      if (p.lit) glow(g, p.col.length === 7 ? p.col : '#ffffff', p.x, p.y, p.size * 3.5, a * 0.5);
      g.globalAlpha = a; g.fillStyle = p.col;
      g.save(); g.translate(p.x, p.y); g.rotate(p.spin); g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7); g.restore();
    }
    g.globalAlpha = 1;
    for (const p of pops) { g.globalAlpha = Math.min(1, p.life * 2.5); outlined(p.text, p.x, p.y, p.size, p.col, 'rgba(30,8,30,0.85)', 6); }
    g.globalAlpha = 1;
  }

  // ---------- the moving scenery ----------
  function skyLife(id, t) {
    if (id === 'harbour') {
      g.fillStyle = 'rgba(255,214,200,0.32)';
      for (let i = 0; i < 5; i++) {
        const x = ((i * 470 + t * (8 + i * 3)) % (W + 400)) - 200, y = 40 + (i % 3) * 30;
        g.beginPath(); g.ellipse(x, y, 120, 16, 0, 0, TAU); g.ellipse(x + 60, y - 10, 70, 14, 0, 0, TAU); g.fill();
      }
      // gulls far off
      g.strokeStyle = 'rgba(60,30,60,0.6)'; g.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        const x = ((i * 640 + t * 40) % (W + 200)) - 100, y = 70 + Math.sin(t + i) * 12, f = Math.sin(t * 6 + i) * 6;
        g.beginPath(); g.moveTo(x - 12, y - f); g.quadraticCurveTo(x - 6, y - 6, x, y); g.quadraticCurveTo(x + 6, y - 6, x + 12, y - f); g.stroke();
      }
    } else if (id === 'park') {
      for (let i = 0; i < 6; i++) {
        const x = ((i * 380 + t * (10 + i * 4)) % (W + 400)) - 200, y = 60 + (i % 3) * 70, s = 0.7 + (i % 3) * 0.25;
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.beginPath(); g.ellipse(x, y, 90 * s, 26 * s, 0, 0, TAU); g.ellipse(x - 40 * s, y + 4, 50 * s, 22 * s, 0, 0, TAU); g.ellipse(x + 30 * s, y - 16 * s, 50 * s, 30 * s, 0, 0, TAU); g.fill();
      }
    } else {
      for (let i = 0; i < 70; i++) {
        const a = 0.35 + 0.65 * Math.abs(Math.sin(t * (0.8 + hash(i) * 2) + i));
        g.fillStyle = `rgba(255,255,240,${a})`;
        g.fillRect(hash(i * 13) * W, hash(i * 29) * 560, 2.5, 2.5);
      }
    }
  }
  function constellation(sim, t) {
    const n = sim.sc.id === 'roofs' ? sim.caught : 0;
    g.strokeStyle = 'rgba(200,220,255,0.18)'; g.lineWidth = 2; g.setLineDash([6, 8]);
    const lines = [[0, 1], [0, 2], [1, 3], [2, 5], [3, 4], [4, 5], [3, 6], [5, 7], [6, 8], [7, 8], [0, 4], [4, 8], [8, 9], [9, 10], [10, 11]];
    g.beginPath(); for (const [a, b] of lines) { g.moveTo(...KITE[a]); g.lineTo(...KITE[b]); } g.stroke();
    g.setLineDash([]);
    g.strokeStyle = 'rgba(255,240,170,0.75)'; g.lineWidth = 3;
    g.beginPath(); for (const [a, b] of lines) if (a < n && b < n) { g.moveTo(...KITE[a]); g.lineTo(...KITE[b]); } g.stroke();
    KITE.forEach(([x, y], i) => {
      if (i < n) { glow(g, '#ffe066', x, y, 34 + Math.sin(t * 3 + i) * 4, 0.8); star5(g, x, y, 11, '#fff6c0', t * 0.5 + i); }
      else { g.fillStyle = 'rgba(200,220,255,0.35)'; g.beginPath(); g.arc(x, y, 4, 0, TAU); g.fill(); }
    });
  }
  function water(id, t) {
    const A = ART[id];
    const gr = g.createLinearGradient(0, SURFACE, 0, H); A.water.forEach((c, i) => gr.addColorStop(i / (A.water.length - 1), c));
    g.fillStyle = gr; g.fillRect(0, SURFACE, W, H - SURFACE);
    // reflections of the lights, then the wave lines
    if (id !== 'park') for (let x = 120; x < W; x += 420) { g.fillStyle = 'rgba(255,200,120,0.18)'; for (let k = 0; k < 5; k++) g.fillRect(x - 20 + Math.sin(t * 2 + k) * 10, SURFACE + 14 + k * 20, 40 - k * 5, 4); }
    if (id === 'roofs') { g.fillStyle = 'rgba(240,240,220,0.22)'; for (let k = 0; k < 5; k++) g.fillRect(240 + Math.sin(t * 1.6 + k) * 14, SURFACE + 12 + k * 22, 50 - k * 6, 4); }
    g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 2.5;
    for (let r = 0; r < 4; r++) {
      const y0 = SURFACE + 10 + r * 30;
      g.beginPath();
      for (let x = 0; x <= W; x += 30) { const y = y0 + Math.sin(x / 80 + t * (1.6 + r * 0.3) + r) * 4; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    if (id === 'park') {
      // lily pads, a duck paddling
      for (let i = 0; i < 7; i++) { const x = (hash(i) * W + Math.sin(t * 0.5 + i) * 8), y = SURFACE + 40 + hash(i + 3) * 70; g.fillStyle = '#4f9443'; g.beginPath(); g.ellipse(x, y, 26, 10, 0, 0.3, TAU); g.lineTo(x, y); g.fill(); }
      const dx = ((t * 40) % (W + 200)) - 100, dy = SURFACE + 34 + Math.sin(t * 3) * 2;
      g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(dx, dy, 22, 11, 0, 0, TAU); g.fill(); g.beginPath(); g.arc(dx + 16, dy - 14, 9, 0, TAU); g.fill();
      g.fillStyle = '#ff9a2a'; g.beginPath(); g.moveTo(dx + 24, dy - 15); g.lineTo(dx + 34, dy - 12); g.lineTo(dx + 24, dy - 10); g.fill();
    } else if (id === 'harbour') {
      // boats bobbing at their moorings
      for (const [bx, col] of [[420, '#e84a5f'], [1280, '#2bb3a3']]) {
        const by = SURFACE + 50 + Math.sin(t * 1.4 + bx) * 4, rot = Math.sin(t * 1.1 + bx) * 0.04;
        g.save(); g.translate(bx, by); g.rotate(rot);
        g.fillStyle = col; g.beginPath(); g.moveTo(-90, -10); g.lineTo(90, -10); g.lineTo(66, 22); g.lineTo(-66, 22); g.fill();
        g.fillStyle = '#f4efe2'; g.fillRect(-90, -16, 180, 8);
        g.fillStyle = '#f4efe2'; g.beginPath(); g.roundRect(-30, -40, 50, 26, 6); g.fill(); g.fillStyle = '#3a4a6a'; g.fillRect(-22, -34, 12, 10); g.fillRect(-4, -34, 12, 10);
        g.restore();
      }
    }
    for (const r of ripples) {
      const k = r.t / 1.4;
      g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - k)})`; g.lineWidth = 3;
      g.beginPath(); g.ellipse(r.x, SURFACE + 22, (r.big ? 40 : 18) + k * (r.big ? 140 : 70), 6 + k * 10, 0, 0, TAU); g.stroke();
    }
  }
  function lamps(id, t) {
    if (id === 'park') return;
    const A = ART[id];
    for (let x = 280; x < W; x += 420) {
      const y = FLOOR_Y[BOTTOM];
      g.fillStyle = '#1d1a2c'; g.fillRect(x - 4, y - 150, 8, 150); g.fillRect(x - 14, y - 6, 28, 6);
      g.fillStyle = '#2a2638'; g.beginPath(); g.moveTo(x - 16, y - 150); g.lineTo(x + 16, y - 150); g.lineTo(x + 10, y - 186); g.lineTo(x - 10, y - 186); g.fill();
      const fl = 0.85 + 0.15 * Math.sin(t * 13 + x) * Math.sin(t * 7.3 + x * 2);
      g.fillStyle = A.lamp; g.fillRect(x - 9, y - 182, 18, 28);
      glow(g, A.lamp, x, y - 168, 110 * fl, 0.7);
    }
  }
  function chimneySmoke(t) {
    for (const x of [540, 1000, 1280]) {
      for (let i = 0; i < 5; i++) {
        const k = ((t * 0.3 + i / 5) % 1), y = FLOOR_Y[0] - 96 - k * 120;
        g.fillStyle = `rgba(150,160,190,${0.22 * (1 - k)})`;
        g.beginPath(); g.arc(x + Math.sin(t + i) * 10 + k * 40, y, 10 + k * 22, 0, TAU); g.fill();
      }
    }
  }

  // ---------- the cast ----------
  // draw at x, and again across the edge when close to it on a wrap floor
  function wrapDraw(x, f, wrap, fn) {
    fn(x);
    if (wrap) { if (x < 120) fn(x + W); else if (x > W - 120) fn(x - W); }
  }
  function heroPose(sim) {
    const h = sim.hero;
    if (sim.status === 'miss') return { pose: 'daze' };
    if (sim.status === 'clear') return { pose: 'cheer' };
    if (h.mode === 'fall') return { pose: 'fall' };
    if (h.mode === 'fly') return { pose: 'fly', sq: -0.12 };
    if (h.punchT > 0) return { pose: 'punch', punch: Math.sin(Math.PI * Math.min(1, (PUNCH_T - h.punchT) / (PUNCH_T * 0.7))) };
    if (h.catchT > 0) return { pose: 'catch', sq: -0.05 };
    if (h.moving) return { pose: 'walk' };
    return { pose: 'stand' };
  }
  function drawHero(sim, t) {
    const h = sim.hero, P = heroPose(sim), wrap = h.mode === 'floor' && sim.sc.floors[h.f].wrap;
    const blinkOff = h.power > 0 && h.power < 1.5 && Math.floor(t * 10) % 2;
    wrapDraw(h.x, h.f, wrap, x => {
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(x, h.y, 30, 7, 0, 0, TAU); g.fill();
      if (h.power > 0 && !blinkOff) glow(g, '#ff7a5a', x, h.y - 90, 120, 0.45 + 0.15 * Math.sin(t * 12));
      drawWick(g, x, h.y, { ...P, face: h.face, t, run: h.run, power: h.power > 0 && !blinkOff ? 1 : 0, blink: Math.sin(t * 0.9) > 0.99 });
    });
  }
  function brutePose(sim, t) {
    const b = sim.brute;
    if (b.mode === 'flung') return { pose: 'flung' };
    if (b.mode === 'climb') return { pose: 'climb', wet: 1 };
    if (b.stun > 0) return { pose: 'stun' };
    if (b.act === 'swipe') return b.actT > 0 ? { pose: 'wind' } : { pose: 'swipe', k: Math.min(1, -b.actT / 0.16) };
    if (b.act === 'drop' || b.act === 'leap') return { pose: 'crouch' };
    if (b.act === 'throw') return { pose: b.actT > 0.15 ? 'wind' : 'throw', k: 1 - Math.max(0, b.actT) / 0.15 };
    if (b.act === 'flex') return { pose: 'flex' };
    if (b.mode === 'leap') return { pose: 'leap' };
    if (b.mode === 'fall') return { pose: 'fall' };
    if (b.mode === 'stair' || (b.mode === 'floor' && (b.dir || b.goal >= 0) && sim.status === 'play')) return { pose: 'walk' };
    void t;
    return { pose: 'stand' };
  }
  function drawBrute(sim, t) {
    const b = sim.brute;
    if (b.mode === 'out') return;
    const P = brutePose(sim, t), wrap = b.mode === 'floor' && sim.sc.floors[b.f].wrap;
    let face = b.face;
    if (b.mode === 'stair') { const st = sim.sc.stairs[b.stair]; face = Math.sign(st.xt - st.xb) * b.sdir; }
    if (b.mode === 'flung') face = Math.sign(b.vx) || 1;
    if (b.mode === 'climb') { g.save(); g.beginPath(); g.rect(0, 0, W, SURFACE + 6); g.clip(); }
    wrapDraw(b.x, b.f, wrap, x => {
      if (b.mode === 'floor' || b.mode === 'stair') { g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x, b.y, 56, 10, 0, 0, TAU); g.fill(); }
      drawRumbold(g, x, b.y, { ...P, face, t, run: b.run, spin: b.spin });
    });
    if (b.mode === 'climb') g.restore();
  }
  function drawSweet(sim, t) {
    const s = sim.sweet;
    const sinking = sim.keeps.some(k => k.state === 'float' && k.floatT < 2) || (sim.status === 'miss' && sim.miss?.cause === 'sank');
    const pose = sim.status === 'clear' || s.cheer > 0 ? 'cheer' : s.toss > 0 ? 'toss' : sinking ? 'worry' : s.pause > 0 || sim.status !== 'play' ? 'stand' : 'walk';
    drawClementine(g, s.x, FLOOR_Y[0], { pose, face: s.dir, t, run: s.walkT, toss: 1 - s.toss / 0.45, keep: sim.sc.keep });
    if (s.cheer > 0) { const k = 1 - s.cheer / 0.8; drawKeep(g, s.x + 20, FLOOR_Y[0] - 170 - k * 60, 'heart', t, { a: 1 - k, s: 0.6 }); }
  }
  function drawKeeps(sim, t) {
    for (const k of sim.keeps) {
      if (k.state === 'fall') drawKeep(g, k.x, k.y, k.kind, t + k.ph);
      else {
        const by = SURFACE + 14 + Math.sin(t * 3 + k.ph) * 4, warn = k.floatT < 2 && Math.floor(t * 8) % 2;
        drawKeep(g, k.x, by, k.kind, t * 0.4 + k.ph, { a: Math.min(1, 0.35 + k.floatT / 2), s: 0.9 });
        const ring = 1 - k.floatT / sim.P.float;
        g.strokeStyle = warn ? '#ff4060' : 'rgba(255,255,255,0.75)'; g.lineWidth = 5;
        g.beginPath(); g.arc(k.x, by, 40, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - ring)); g.stroke();
      }
    }
  }
  function drawProps(sim, t) {
    const gm = sim.gim;
    if (gm.kind === 'crate' && gm.state !== 'gone') drawCrate(g, gm.x, gm.y, { hanging: gm.state === 'hang', spin: gm.spin });
    if (gm.kind === 'crate' && gm.state === 'gone') { g.strokeStyle = '#3a2418'; g.lineWidth = 3; g.beginPath(); g.moveTo(gm.x, 150); g.lineTo(gm.x, 200 + Math.sin(t * 2) * 6); g.stroke(); }
    if (gm.kind === 'spring') drawSpring(g, gm.x, FLOOR_Y[gm.f], gm.squash, t);
    if (gm.kind === 'swing') { const p = bagPos(gm); drawSandbag(g, gm.px, gm.py, p.x, p.y, gm.th); }
    const G0 = sim.glove;
    if (G0.state === 'ready') drawGlove(g, G0.x, FLOOR_Y[G0.f], t);
    const T = sim.thrower;
    if (T) drawThrower(g, T.x, T.y, { kind: sim.sc.id === 'roofs' ? 'sweep' : 'pinch', dir: T.dir, wind: T.state === 'wind' ? 1 - T.t / 0.7 : 0, t });
  }
  function drawPests(sim, t) {
    for (const s of sim.shots) drawShot(g, s.x, s.y, s.kind, t, s.spin);
    const B = sim.bird;
    if (!B) return;
    const kind = sim.sc.id === 'roofs' ? 'owl' : 'magpie';
    if (B.state === 'warn' && Math.floor(t * 8) % 2) {
      const x = B.dir > 0 ? 46 : W - 46;
      g.fillStyle = 'rgba(255,64,96,0.85)'; g.beginPath(); g.arc(x, B.y, 30, 0, TAU); g.fill();
      outlined('!', x, B.y + 16, 44, '#ffffff', '#5a0a1a', 6);
    }
    if (B.state === 'swoop' || B.state === 'hit') drawBird(g, B.x, B.y, { kind, dir: B.dir, t, hit: B.state === 'hit' });
  }

  function drawScene(app, t) {
    const sim = app.sim, id = sim.sc.id, L = sceneLayers(id);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(L.sky, 0, 0, cw, ch);
    ref();
    skyLife(id, t);
    if (id === 'roofs') constellation(sim, t);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(L.back, 0, 0);
    ref();
    if (shake > 0) g.translate((rand() - 0.5) * 26 * shake, (rand() - 0.5) * 26 * shake);
    if (id === 'roofs') chimneySmoke(t);
    water(id, t);
    lamps(id, t);
    drawProps(sim, t);
    drawSweet(sim, t);
    drawBrute(sim, t);
    drawHero(sim, t);
    paintFront(g, id);
    drawKeeps(sim, t);
    drawPests(sim, t);
    drawFx();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(vign, 0, 0, cw, ch);
    ref();
  }

  // ---------- HUD and overlays ----------
  function hud(app, t) {
    const sim = app.sim, A = ART[sim.sc.id], best = Math.max(app.scores[0]?.score ?? 0, sim.score);
    const grd = g.createLinearGradient(0, 0, 0, 96); grd.addColorStop(0, 'rgba(10,4,20,0.7)'); grd.addColorStop(1, 'rgba(10,4,20,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, 110);
    label('SCORE', 36, 32, 18, 'rgba(255,255,255,0.6)', 600, 'left', 3);
    outlined(pad6(sim.score), 36, 72, 40, '#ffffff', 'rgba(0,0,0,0.55)', 6, 'left', 2);
    label('HI ' + pad6(best), 250, 70, 24, A.hud, 600, 'left', 2);
    outlined(sim.sc.name.toUpperCase() + (sim.loop ? `  ×${sim.loop + 1}` : ''), 960, 46, 32, A.hud, 'rgba(0,0,0,0.55)', 6, 'center', 3);
    // keepsakes caught so far
    const n = sim.quota, gap = 30, x0 = 960 - ((n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      const x = x0 + i * gap, on = i < sim.caught;
      g.globalAlpha = on ? 1 : 0.3;
      drawKeep(g, x, 76, sim.sc.keep, on ? t + i : 0, { s: 0.5 });
      g.globalAlpha = 1;
    }
    for (let i = 0; i < Math.min(sim.lives - 1, 6); i++) drawHat(g, 1860 - i * 46, 66, 0.9);
    const h = sim.hero;
    if (h.power > 0) {
      const k = h.power / sim.P.power;
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.roundRect(1300, 54, 260, 16, 8); g.fill();
      g.fillStyle = h.power < 1.5 && Math.floor(t * 10) % 2 ? '#ffffff' : '#ff5a4a'; g.beginPath(); g.roundRect(1300, 54, 260 * k, 16, 8); g.fill();
      label('HAYMAKER', 1300, 44, 18, '#ff8a7a', 700, 'left', 3);
    }
  }
  function overlay(app, t) {
    const sim = app.sim;
    if (sim.status === 'ready' && !app.demo) {
      const go = sim.statusT > 1.1;
      outlined(go ? 'Go!' : 'Ready…', 960, 560, 100, go ? '#ffd166' : '#ffffff', '#2a1230', 14);
    } else if (sim.status === 'miss' && sim.statusT > 0.5) {
      const m = sim.miss, raw = MISS_TEXT[m?.cause] ?? '', msg = typeof raw === 'string' ? raw : (raw[sim.sc.id] ?? raw[m?.kind] ?? Object.values(raw)[0]);
      panel(520, 440, 880, 180, 36, 0.82);
      outlined(msg, 960, 525, 54, '#ff9cb0', '#2a1230', 10);
      label(sim.lives > 1 ? `${sim.lives - 1} ${sim.lives === 2 ? 'life' : 'lives'} left` : 'That was the last one…', 960, 588, 32, '#ffffff', 500, 'center', 2);
    } else if (sim.status === 'clear') {
      const k = Math.min(1, sim.statusT * 3);
      g.save(); g.translate(960, 520); g.scale(0.7 + 0.3 * k, 0.7 + 0.3 * k); g.rotate(Math.sin(t * 3) * 0.02); g.translate(-960, -520);
      panel(560, 380, 800, 290, 44, 0.84);
      outlined('Scene clear!', 960, 482, 92, '#ffffff', '#2a1230', 14);
      label(`All ${sim.quota} ${sim.sc.keepName} caught`, 960, 548, 32, 'rgba(255,255,255,0.8)', 500, 'center', 2);
      outlined('BONUS ' + (sim.tally?.bonus ?? 0), 960, 625, 52, '#ffd166', '#2a1230', 10);
      g.restore();
      if (rand() < 0.3) burst(rand() * W, -20, 2, ['#ff6f91', '#ffd166', '#06d6a0', '#46f0ff'], 120, 3, 300, 9);
    } else if (sim.status === 'over') {
      shadeAll(0.35);
      panel(560, 380, 800, 300, 40, 0.85);
      outlined('Game over', 960, 505, 100, '#ffd166', '#2a1230', 14);
      label('SCORE ' + pad6(sim.score), 960, 600, 42, '#ffffff', 700, 'center', 4);
    }
  }

  // ---------- screens ----------
  const backSim = { sc: SCENES[0] };
  function titleBack(t, dim = 0.5) {
    const L = sceneLayers('harbour');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(L.sky, 0, 0, cw, ch);
    ref(); skyLife('harbour', t);
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(L.back, 0, 0); ref();
    water('harbour', t); lamps('harbour', t); paintFront(g, 'harbour');
    void backSim;
    shadeAll(dim);
  }
  const menuNames = { continue: 'CONTINUE', play: 'NEW GAME', scores: 'HIGH SCORES', exit: 'EXIT' };
  function menuRects(app) {
    const items = app.titleItems();
    return items.map((_, i) => ({ x: 1210 - 260, y: 440 + i * 76 - (items.length - 3) * 20, w: 520, h: 66 }));
  }
  function drawTitle(app, t) {
    titleBack(t, 0.42);
    // Clementine on the balcony, a heart drifting down to Wick; Rumbold flexing behind
    const ph = (t * 0.22) % 1;
    drawClementine(g, 420, 520, { pose: ph < 0.12 ? 'toss' : 'stand', face: 1, t, toss: ph / 0.12, keep: 'heart' });
    drawKeep(g, 470 + Math.sin(t * 2) * 40, 400 + ph * 520, 'heart', t, { s: 1.4 });
    drawRumbold(g, 700, 900, { pose: 'flex', face: -1, t });
    drawWick(g, 470, 910, { pose: ph > 0.8 ? 'catch' : 'stand', face: 1, t });
    // the logo
    g.save(); g.translate(1210, 250); g.rotate(-0.04);
    font(200, 700, LOGO); g.textAlign = 'center'; g.lineJoin = 'round';
    g.strokeStyle = '#2a1230'; g.lineWidth = 26; g.strokeText('Keepsake', 0, 0);
    const lg = g.createLinearGradient(0, -160, 0, 30); lg.addColorStop(0, '#fff1f4'); lg.addColorStop(0.5, '#ffb0c0'); lg.addColorStop(1, '#ff5d7e');
    g.fillStyle = lg; g.fillText('Keepsake', 0, 0);
    g.restore(); g.textAlign = 'left';
    label('A LAMPLIGHTER’S COURTSHIP IN THREE SCENES', 1210, 320, 28, '#ffe2c4', 600, 'center', 6);
    const items = app.titleItems();
    menuRects(app).forEach((m, i) => {
      const on = i === app.menu, it = items[i];
      if (on) { panel(m.x, m.y, m.w, m.h, 30, 0.6); glow(g, '#ff7a8a', m.x + 34, m.y + m.h / 2, 30, 0.9); }
      label(menuNames[it], 1210, m.y + (it === 'continue' ? 40 : 46), on ? 38 : 32, on ? '#ffffff' : 'rgba(255,255,255,0.62)', 700, 'center', 4);
      if (it === 'continue' && app.resume) label(`${app.resume.label} · ${app.resumeAgo()}`, 1210, m.y + 62, 18, on ? '#ffd166' : 'rgba(255,220,160,0.6)', 500, 'center', 2);
    });
    const input = app.input, kb = input.device.kind === 'keyboard', last = menuRects(app).at(-1), ly = last.y + last.h + 56;
    if (app.touch?.active) label('LEFT HALF: STICK TO WALK AND CLIMB · RIGHT: PUNCH', 1210, ly + 20, 24, '#ffffff', 600, 'center', 2);
    else {
      legend(input, [['move', 'WALK'], ['climb', 'STAIRS'], ['punch', 'PUNCH']], 1210, ly);
      const extra = [['pause', 'PAUSE']];
      if (kb) extra.push(['sound', app.soundOn ? 'SOUND ON' : 'SOUND OFF'], ['fullscreen', 'FULL SCREEN'], ...(app.hdr?.supported ? [['hdr', app.hdr.label]] : []));
      if (app.onExit) extra.push(['quit', 'EXIT']);
      legend(input, extra, 1210, ly + 50, 22);
    }
    prompt(input, 'PRESS {start}', 1210, 1000, 36, `rgba(255,215,140,${pulse(t)})`, 'center', 700);
    label('CATCH EVERY KEEPSAKE · DODGE RUMBOLD · GRAB THE HAYMAKER', 960, 1060, 20, 'rgba(255,255,255,0.45)', 500, 'center', 4);
  }
  function drawScores(app, t) {
    titleBack(t, 0.6);
    panel(460, 90, 1000, 900, 40, 0.8);
    outlined('Sweetest Scores', 960, 200, 76, '#ffd166', '#2a1230', 12, 'center', 2, LOGO);
    app.scores.forEach((s, i) => {
      const y = 300 + i * 80, on = i === app.newRank, col = on ? `rgba(255,209,102,${pulse(t)})` : '#ffffff';
      if (on) { g.fillStyle = 'rgba(255,209,102,0.12)'; g.beginPath(); g.roundRect(500, y - 52, 920, 70, 20); g.fill(); }
      label(`${i + 1}`, 560, y, 40, 'rgba(255,255,255,0.5)', 700, 'right');
      label(s.name, 610, y, 44, col, 700, 'left', 6);
      label(pad6(s.score), 900, y, 44, col, 700, 'right', 2);
      label((s.loop ? `×${s.loop + 1} · ` : '') + (SCENES[s.scene ?? 0]?.name ?? ''), 960, y, 30, 'rgba(255,255,255,0.6)', 500, 'left');
    });
    prompt(app.input, 'PRESS {start}', 960, 1040, 32, `rgba(255,215,140,${pulse(t)})`, 'center');
  }
  function drawCard(app, t) {
    const sim = app.sim, sc = sim.sc, A = ART[sc.id];
    drawScene(app, t);
    hud(app, t);
    shadeAll(0.45);
    const k = Math.min(1, app.stT * 3);
    g.save(); g.translate(960, 540); g.scale(0.8 + 0.2 * k, 0.8 + 0.2 * k); g.translate(-960, -540); g.globalAlpha = k;
    panel(440, 320, 1040, 420, 44, 0.84);
    label(`SCENE ${sim.stage + 1}` + (sim.loop ? `  ·  ROUND ${sim.loop + 1}, FASTER` : ''), 960, 400, 28, A.accent, 700, 'center', 6);
    outlined(sc.name, 960, 510, 100, '#ffffff', '#2a1230', 14, 'center', 0, LOGO);
    label(sc.blurb, 960, 580, 32, A.hud, 500, 'center', 1);
    label(`Catch ${sc.quota} ${sc.keepName} before they sink`, 960, 640, 30, 'rgba(255,255,255,0.78)', 500, 'center', 1);
    drawKeep(g, 1400, 660, sc.keep, t, { s: 1.4 });
    g.restore(); g.globalAlpha = 1;
  }
  function drawPause(app, t) {
    drawScene(app, t); hud(app, t);
    shadeAll(0.5);
    panel(640, 380, 640, 300, 40, 0.85);
    outlined('Paused', 960, 480, 90, '#ffffff', '#2a1230', 12);
    prompt(app.input, '{pause} RESUME', 960, 570, 32, '#ffffff', 'center');
    prompt(app.input, '{quit} QUIT TO TITLE', 960, 630, 28, 'rgba(255,255,255,0.65)', 'center');
  }
  function letterRect(i) { return { x: 960 - 230 + i * 160 - 60, y: 420, w: 120, h: 170 }; }
  const OK = { x: 1240, y: 450, w: 170, h: 110 };
  function drawInitials(app, t) {
    titleBack(t, 0.6);
    outlined('A new high score!', 960, 190, 90, '#ffd166', '#2a1230', 14, 'center', 0, LOGO);
    outlined(pad6(app.sim.score), 960, 300, 70, '#ffffff', '#2a1230', 10);
    label('ENTER YOUR INITIALS', 960, 380, 30, 'rgba(255,255,255,0.75)', 600, 'center', 6);
    const E = app.entry;
    for (let i = 0; i < 3; i++) {
      const R = letterRect(i), on = i === E.pos;
      panel(R.x, R.y, R.w, R.h, 26, on ? 0.9 : 0.6);
      if (on) { glow(g, '#ff7a8a', R.x + R.w / 2, R.y + R.h / 2, 120, 0.4); g.strokeStyle = '#ffb0c0'; g.lineWidth = 5; g.beginPath(); g.roundRect(R.x, R.y, R.w, R.h, 26); g.stroke(); }
      outlined(LETTERS[E.letters[i]], R.x + R.w / 2, R.y + 125, 110, on ? '#ffffff' : 'rgba(255,255,255,0.7)', '#2a1230', 10);
      if (on) { label('▲', R.x + R.w / 2, R.y - 14, 34, '#ffd166', 700, 'center'); label('▼', R.x + R.w / 2, R.y + R.h + 44, 34, '#ffd166', 700, 'center'); }
    }
    panel(OK.x, OK.y, OK.w, OK.h, 26, 0.75);
    label('OK', OK.x + OK.w / 2, OK.y + 74, 50, '#ffd166', 700, 'center', 4);
    prompt(app.input, '{letters} PICK A LETTER · {start} NEXT · OR TYPE THEM', 960, 760, 30, '#ffffff', 'center');
  }
  function drawTouch(app) {
    const T = app.touch;
    if (!T?.active || app.state !== 'play') return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const P = pads(cw, ch);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(P.pause.x, P.pause.y, P.pause.r, 0, TAU); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(P.pause.x - 12 * u, P.pause.y - 14 * u, 8 * u, 28 * u); g.fillRect(P.pause.x + 4 * u, P.pause.y - 14 * u, 8 * u, 28 * u);
    g.fillStyle = T.punch ? 'rgba(255,90,74,0.55)' : 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(P.punch.x, P.punch.y, P.punch.r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 4 * u; g.stroke();
    font(30 * u, 700); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.fillText('PUNCH', P.punch.x, P.punch.y + 10 * u); g.textAlign = 'left';
    const s = T.stick;
    if (s) {
      g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 4 * u; g.beginPath(); g.arc(s.x0, s.y0, P.stickR, 0, TAU); g.stroke();
      const dx = s.x - s.x0, dy = s.y - s.y0, d = Math.hypot(dx, dy), m = Math.min(1, P.stickR / (d || 1));
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(s.x0 + dx * m, s.y0 + dy * m, P.stickR * 0.42, 0, TAU); g.fill();
    }
    ref();
  }

  let lastT = 0;
  function draw(app) {
    lastApp = app;
    const t = app.t, dt = Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    stepFx(dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b0716'; g.fillRect(0, 0, cw, ch);
    ref();
    switch (app.state) {
      case 'title': drawTitle(app, t); break;
      case 'scores': drawScores(app, t); break;
      case 'initials': drawInitials(app, t); break;
      case 'card': drawCard(app, t); break;
      case 'pause': drawPause(app, t); break;
      default: drawScene(app, t); if (!app.demo) hud(app, t); overlay(app, t);
    }
    ref();
    if (flash > 0) { g.globalAlpha = Math.min(0.35, flash); g.fillStyle = flashCol; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    if (app.demo) label('DEMO', 1884, 1060, 26, `rgba(255,255,255,${0.35 + 0.25 * Math.sin(t * 3)})`, 700, 'right', 6);
    drawTouch(app);
    if (app.fade > 0) { g.globalAlpha = Math.min(1, app.fade); g.fillStyle = '#0b0716'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  const unfit = fitWide(cv, { onFit: fit });

  // ---------- touch targets (canvas pixels in) ----------
  function hit(px, py, app) {
    if (!app) return { act: 'tap' };
    const x = px / u, y = py / u;
    const inside = R => x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h;
    if (app.state === 'title') {
      const m = menuRects(app).findIndex(inside);
      return m >= 0 ? { act: 'menu', i: m } : { act: 'tap' };
    }
    if (app.state === 'initials') {
      if (inside(OK)) return { act: 'ok' };
      for (let i = 0; i < 3; i++) {
        const R = letterRect(i);
        if (inside({ x: R.x - 20, y: R.y - 70, w: R.w + 40, h: R.h + 140 })) {
          if (i !== app.entry.pos) return { act: i < app.entry.pos ? 'left' : 'right' };
          return { act: y < R.y + R.h / 2 ? 'up' : 'down' };
        }
      }
    }
    return { act: 'tap' };
  }
  void WATER_Y;
  return { draw, events, hit, destroy() { destroyed = true; unfit(); } };
}
