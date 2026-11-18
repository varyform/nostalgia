// The HD renderer: the turning tower as a lit 3D cylinder at the window's own resolution, in
// the largest 16:9 box. The camera looks a little down on it, so courses of brick and the
// ledges curve round the drum; Clink is always at the front. Behind it the sky, far islands
// and clouds slide by as the tower turns, the sea moves and mirrors the tower's foot. It only
// reads `app` and `sim.s` / `sim.T`.
//
//   const view = createRenderer(canvas, app);
//   view.events(sim.events, sim); view.draw(app); view.menuAt(x, y)
import { drawPrompt, drawGlyphs, glyphs, measureGlyphs } from '@nostalgia/input';
import { fitWide } from '@nostalgia/game/runtime';
import { BONUS, COLS, HERO_H, K, P as PHYS, SCORE, SEA, adiff, colOf } from '../sim.js';
import { layout as touchLayout } from '../touch.js';
import { TAU, THEMES, canvas, clamp, css, drawClink, drawCrab, drawDrip, drawGem, drawJelly, drawKite, drawSquall, drawUrchin, mix, mixc, rgb } from './art.js';

const HEAD = "'Lilita One','Arial Black',sans-serif";
const BODY = "'Nunito','Trebuchet MS',system-ui,sans-serif";
const INK = '#fffaf0', DIM = 'rgba(240,246,255,0.66)', GOLD = '#ffd24a', RED = '#ff6a5a';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ.-';
const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');
const TILT = 0.2; // how far the camera looks down on the drum
const SEG = TAU / COLS;
const LIGHT = -0.6; // the sun comes from the upper left
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function createRenderer(cv) {
  const g = cv.getContext('2d');
  let cw = 1, ch = 1, u = 1, R = 1, PR = 1, RH = 1, cx = 0, baseY = 0, colPx = 1, destroyed = false, lastApp = null;
  let themeKey = '', TH = THEMES.harbour, skyC = null, bodyGrad = null, isles = null, clouds = null, sunSpr = null, vign = null;
  // the view the scene is drawn from: angle, height, how far the tower has sunk, the spin
  let V = { th: 0, y: 2, sink: 0 };

  function fit(w, h) {
    cw = w; ch = h; u = ch / 1080;
    RH = ch / 19.5; R = ch * 0.255; PR = R * 0.17; cx = cw / 2; baseY = ch * 0.6; colPx = (TAU * R) / COLS;
    themeKey = '';
    vign = canvas(cw, ch);
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 2, ch * 0.55, ch * 0.4, cw / 2, ch / 2, cw * 0.62);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,10,0.42)');
    v.fillStyle = gr; v.fillRect(0, 0, cw, ch);
  }
  const unfit = fitWide(cv, { onFit: fit });
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });

  // ---------- the theme's cached layers ----------
  function useTheme(name) {
    const key = name + cw + 'x' + ch;
    if (key === themeKey) return;
    themeKey = key; TH = THEMES[name] ?? THEMES.harbour;
    // sky with its stars
    skyC = canvas(cw, ch);
    const s = skyC.getContext('2d'), gr = s.createLinearGradient(0, 0, 0, ch * 0.72);
    gr.addColorStop(0, TH.sky[0]); gr.addColorStop(0.55, TH.sky[1]); gr.addColorStop(1, TH.sky[2]);
    s.fillStyle = gr; s.fillRect(0, 0, cw, ch);
    if (TH.stars) for (let i = 0; i < 260; i++) {
      const x = hash(i, 1) * cw, y = hash(i, 2) ** 1.6 * ch * 0.62, r = (0.6 + hash(i, 3) * 1.6) * u;
      s.fillStyle = `rgba(255,255,255,${(0.25 + hash(i, 4) * 0.7) * TH.stars})`; s.beginPath(); s.arc(x, y, r, 0, TAU); s.fill();
    }
    // the cylinder's light across its width: ambient, sun, a specular stripe, darker limbs
    bodyGrad = (x0, x1, stone) => {
      const b = g.createLinearGradient(x0, 0, x1, 0), [lit, mid, dark] = stone.map(rgb);
      for (let k = 0; k <= 24; k++) {
        const t = k / 24, phi = Math.asin(clamp(t * 2 - 1, -1, 1));
        const dif = Math.max(0, Math.cos(phi - LIGHT)), spec = Math.max(0, Math.cos(phi - LIGHT * 0.55)) ** 40 * 0.35;
        const limb = Math.cos(phi) ** 0.35;
        let c = mixc(dark, mid, clamp(0.25 + dif * 0.9, 0, 1));
        c = mixc(c, lit, clamp(dif - 0.55, 0, 1) * 1.6);
        c = mixc([0, 0, 0], c, 0.35 + 0.65 * limb);
        c = mixc(c, [255, 255, 255], spec);
        b.addColorStop(t, css(c));
      }
      return b;
    };
    // far islands and distant spindles, wrapping round the whole horizon
    const PW = Math.round(cw * 2.4);
    isles = canvas(PW, ch * 0.14);
    const ig = isles.getContext('2d'), ih = isles.height;
    ig.fillStyle = TH.isle;
    for (let i = 0; i < 9; i++) {
      const x0 = hash(i, 7) * PW, w = (0.05 + hash(i, 8) * 0.14) * PW, h = (0.15 + hash(i, 9) * 0.55) * ih;
      for (const off of [0, PW, -PW]) {
        ig.beginPath(); ig.moveTo(x0 + off - w / 2, ih);
        for (let k = 0; k <= 12; k++) { const t = k / 12; ig.lineTo(x0 + off - w / 2 + t * w, ih - Math.sin(t * Math.PI) ** 0.7 * h * (0.75 + 0.25 * hash(i, k))); }
        ig.lineTo(x0 + off + w / 2, ih); ig.fill();
      }
    }
    for (let i = 0; i < 4; i++) {
      const x = ((i + 0.3) / 4) * PW, w = (10 + hash(i, 11) * 8) * u, h = (0.55 + hash(i, 12) * 0.4) * ih;
      ig.fillStyle = mix(TH.isle, TH.sky[2], 0.35);
      ig.fillRect(x - w / 2, ih - h, w, h);
      ig.beginPath(); ig.ellipse(x, ih - h, w * 0.75, w * 0.25, 0, 0, TAU); ig.fill();
    }
    // clouds
    const CW = Math.round(cw * 2.2);
    clouds = canvas(CW, ch * 0.5);
    const cg = clouds.getContext('2d');
    for (let i = 0; i < 16; i++) {
      const x = hash(i, 21) * CW, y = (0.1 + hash(i, 22) * 0.75) * clouds.height, w = (90 + hash(i, 23) * 220) * u;
      for (let k = 0; k < 6; k++) {
        const bx = x + (k - 2.5) * w * 0.28, by = y - Math.sin((k / 5) * Math.PI) * w * 0.12, br = w * (0.18 + hash(i, k + 30) * 0.12);
        for (const off of [0, CW, -CW]) {
          const gr2 = cg.createRadialGradient(bx + off, by, br * 0.2, bx + off, by, br);
          gr2.addColorStop(0, css(rgb(TH.cloud), 0.5)); gr2.addColorStop(1, css(rgb(TH.cloud), 0));
          cg.fillStyle = gr2; cg.beginPath(); cg.arc(bx + off, by, br, 0, TAU); cg.fill();
        }
      }
    }
    // the sun or the moon
    const sr = (TH.sun?.r ?? TH.moon?.r ?? 0.05) * ch;
    sunSpr = canvas(sr * 8, sr * 8);
    const sg = sunSpr.getContext('2d'), sc = sr * 4;
    const glow = sg.createRadialGradient(sc, sc, sr * 0.5, sc, sc, sr * 4);
    glow.addColorStop(0, css(rgb(TH.sun?.c ?? '#f4f0ff'), 0.6)); glow.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = glow; sg.fillRect(0, 0, sr * 8, sr * 8);
    sg.fillStyle = TH.sun?.c ?? '#f6f2ff'; sg.beginPath(); sg.arc(sc, sc, sr, 0, TAU); sg.fill();
    if (TH.moon) { sg.fillStyle = 'rgba(120,110,170,0.35)'; for (const [dx, dy, rr] of [[-0.3, -0.2, 0.22], [0.25, 0.3, 0.16], [0.35, -0.3, 0.1]]) { sg.beginPath(); sg.arc(sc + dx * sr, sc + dy * sr, rr * sr, 0, TAU); sg.fill(); } }
  }

  // ---------- projection: angle φ round the drum (0 = the front), radius r, height h ----------
  const phiOf = th => adiff(th, V.th) * SEG;
  const Yh = h => baseY - (h - V.sink - V.y) * RH;
  const PX = (phi, r) => cx + r * Math.sin(phi);
  const PY = (phi, r, h) => Yh(h) + TILT * r * Math.cos(phi);
  const lightAt = phi => Math.max(0, Math.cos(phi - LIGHT)) * (0.35 + 0.65 * Math.max(0, Math.cos(phi)) ** 0.4);

  // ---------- text ----------
  function label(s, x, y, size, col, { font = BODY, wgt = 800, align = 'left', spacing = 0, shadow = false } = {}) {
    g.font = `${font === HEAD ? 400 : wgt} ${Math.round(size * u)}px ${font}`;
    g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    if (shadow) { g.fillStyle = 'rgba(0,10,30,0.55)'; g.fillText(s, x + 3 * u, y + 4 * u); }
    g.fillStyle = col; g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
  }
  const GST = { font: BODY };
  const prompt = (input, s, x, y, size, col, align = 'center') =>
    drawPrompt(g, input, s, x, y, { font: `700 ${Math.round(size * u)}px ${BODY}`, size: size * 1.35 * u, color: col, align, letterSpacing: 1 * u, style: GST });
  function legend(input, rows, x0, y, size = 22) {
    const gs = size * 1.3 * u, gap = 6 * u;
    rows.forEach((r, i) => {
      let w = 0;
      const parts = r.map(([a, l]) => { const list = glyphs(input, a); g.font = `700 ${Math.round(size * u)}px ${BODY}`; const lw = g.measureText(l).width, gw = measureGlyphs(g, list, gs, GST, gap); w += gw + 12 * u + lw; return { list, l, lw, gw }; });
      w += (parts.length - 1) * 36 * u;
      let x = x0 - w / 2;
      const yc = y + i * 46 * u;
      for (const p of parts) {
        drawGlyphs(g, p.list, x, yc, gs, GST, gap);
        label(p.l, x + p.gw + 12 * u, yc + size * 0.36 * u, size, DIM, { wgt: 700 });
        x += p.gw + 12 * u + p.lw + 36 * u;
      }
    });
  }
  function glass(x, y, w, h, r = 24, a = 0.55) {
    g.fillStyle = `rgba(6,14,30,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r * u); g.fill();
    g.strokeStyle = 'rgba(200,230,255,0.18)'; g.lineWidth = 2 * u; g.stroke();
  }
  const shade = a => { g.fillStyle = `rgba(2,6,16,${a})`; g.fillRect(0, 0, cw, ch); };

  // ---------- effects: world particles round the drum, screen particles, pop-ups ----------
  let parts = [], sparts = [], pops = [], shake = 0, flash = 0, flashCol = '255,255,255', squash = 0, warn = { t: 0, side: 1 }, tick = 0, bolt = 0;
  const rand = Math.random;
  const weather = Array.from({ length: 90 }, () => ({ x: rand(), y: rand(), z: 0.4 + rand() * 0.6, p: rand() }));
  function burst(th, y, n, cols, sp = 3, { r = 0.55, life = 0.7, grav = 14, size = 0.08, up = 2 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, v = sp * (0.3 + rand() * 0.7);
      parts.push({ th, y, r, vth: Math.cos(a) * v * 0.35, vy: Math.sin(a) * v + up, vr: (rand() - 0.3) * 0.6, life: life * (0.6 + rand() * 0.6), max: life, c: cols[i % cols.length], size: size * (0.6 + rand() * 0.8), grav });
    }
  }
  function sburst(x, y, n, cols, sp, life = 0.7, grav = 600) {
    for (let i = 0; i < n; i++) { const a = rand() * TAU, v = sp * (0.3 + rand() * 0.7); sparts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp * 0.3, life: life * (0.6 + rand() * 0.6), max: life, c: cols[i % cols.length], size: (3 + rand() * 5) * u, grav }); }
  }
  function pop(th, y, s, col = GOLD) { pops.push({ th, y, s, t: 1.2, col }); }
  function events(list, sim) {
    const s = sim.s;
    for (const e of list) {
      const th = e.th ?? s?.hero?.th ?? 0, y = e.y ?? 0;
      switch (e.type) {
        case 'land': if (e.v > 5) { squash = Math.min(1, e.v / 16); burst(th, y, 6, ['#ffffff', TH.ledge[0]], 2.2, { up: 1, size: 0.07, grav: 6 }); } break;
        case 'jump': squash = -0.6; burst(th, y, 4, ['#ffffff'], 1.5, { up: 0.5, size: 0.05, grav: 4, life: 0.4 }); break;
        case 'step': squash = 0.3; break;
        case 'shoot': burst(th + (s.hero.dir * 0.3), y + 0.75, 3, ['#bff4ff'], 1, { size: 0.05, life: 0.3, grav: -2 }); break;
        case 'pop': burst(th, y + 0.35, 16, ['#e28cff', '#6a1f8a', '#ffffff'], 6, { up: 3 }); shake = 0.15; break;
        case 'stun': burst(th, y + 0.5, 8, ['#fff6a0', '#ffffff'], 3); break;
        case 'push': burst(th, y + 0.3, 8, ['#ffffff', '#ffd0b0'], 3); break;
        case 'crabfall': pop(th, y + 1, String(SCORE.crab)); break;
        case 'crabsplash': case 'drip': burst(th, y, e.type === 'drip' ? 5 : 14, ['#bfe8ff', '#ffffff'], e.type === 'drip' ? 2 : 5, { up: 3, size: 0.06 }); break;
        case 'hit': shake = 0.3; flash = 0.25; flashCol = '255,120,100'; burst(th, y + 1, 10, ['#fff6a0', '#ffffff'], 4); break;
        case 'bonk': burst(th, y + HERO_H, 4, ['#ffffff'], 2); break;
        case 'splash': shake = 0.35; burst(th, SEA, 34, ['#ffffff', '#bfe8ff', TH.sea[0]], 9, { up: 6, size: 0.1, life: 1.2, r: 0.7 }); break;
        case 'door': case 'doorout': burst(th, y + 0.6, 8, ['#2a2a3a', '#ffffff'], 1.6, { grav: -1, size: 0.1, life: 0.6 }); break;
        case 'crumble': burst(th, y, 14, [TH.ledge[0], TH.ledge[1], TH.stone[2]], 2.5, { up: -1, size: 0.09, life: 1.1, grav: 18 }); shake = 0.08; break;
        case 'creak': burst(th, y, 3, [TH.ledge[1]], 1, { up: -1, size: 0.05, grav: 12 }); break;
        case 'regrow': burst(th, y, 6, [TH.accent, '#ffffff'], 1.5, { grav: -2, size: 0.05 }); break;
        case 'squall': warn = { t: 1.2, side: e.side }; break;
        case 'crown': flash = 0.5; flashCol = '255,230,140'; burst(th, y + 1, 30, [GOLD, '#ffffff', TH.accent], 7, { up: 4, life: 1.4 }); break;
        case 'sunk': shake = 0.5; burst(V.th, SEA + V.sink, 40, ['#ffffff', '#bfe8ff'], 10, { up: 7, size: 0.12, life: 1.4, r: 1.05 }); break;
        case 'score': pop(e.th, e.y + 1.2, String(e.n)); break;
        case 'life': pop(s.hero.th, s.hero.y + 2.2, '1UP', '#7affb0'); break;
        case 'tick': tick = 1; break;
        case 'timeup': flash = 0.4; flashCol = '255,80,60'; break;
        case 'respawn': burst(th, y + 0.6, 14, [TH.accent, '#ffffff'], 3, { grav: -2 }); break;
        case 'gem': if (bonusMap) { const p = bonusMap(e.x, e.y); sburst(p.x, p.y, 10, ['#ffffff', '#7affd0', GOLD], 260 * u, 0.6, 200 * u); } break;
        case 'skim': if (bonusMap) { const p = bonusMap(s.bonus.x + BONUS.kx, 0); sburst(p.x, p.y, 16, ['#ffffff', '#bfe8ff'], 360 * u, 0.8, 900 * u); } break;
      }
    }
  }
  function stepFx(dt) {
    for (const p of parts) { p.life -= dt; p.th += p.vth * dt; p.y += p.vy * dt; p.vy -= p.grav * dt; p.r += p.vr * dt * 0.2; }
    parts = parts.filter(p => p.life > 0 && p.y > SEA - 1);
    for (const p of sparts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; }
    sparts = sparts.filter(p => p.life > 0);
    for (const p of pops) p.t -= dt;
    pops = pops.filter(p => p.t > 0);
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt * 1.5); warn.t = Math.max(0, warn.t - dt);
    squash += (0 - squash) * Math.min(1, dt * 12); tick = Math.max(0, tick - dt * 2.5); bolt = Math.max(0, bolt - dt);
  }

  // ---------- backdrop: sky, sun, clouds, islands, the sea ----------
  let hzY = 0;
  function drawBackdrop(t) {
    g.drawImage(skyC, 0, 0);
    hzY = ch * 0.6 + clamp((V.y - 2) * RH * 0.035, 0, ch * 0.09);
    const turn = V.th / COLS;
    const body = TH.sun ?? TH.moon;
    if (body) {
      const PW = cw * 2.4, x = (((body.x * cw + turn * PW) % PW) + PW) % PW, y = body.y * ch + (hzY - ch * 0.6) * 0.6;
      for (const xx of [x, x - PW]) if (xx > -sunSpr.width && xx < cw + sunSpr.width) g.drawImage(sunSpr, xx - sunSpr.width / 2, y - sunSpr.height / 2);
    }
    const cxo = (((turn * clouds.width * 0.8 + t * 6 * u) % clouds.width) + clouds.width) % clouds.width;
    const cy = ch * 0.02 + clamp(V.y * RH * 0.02, 0, ch * 0.08);
    g.drawImage(clouds, cxo - clouds.width, cy); g.drawImage(clouds, cxo, cy);
    const ixo = ((turn * isles.width) % isles.width + isles.width) % isles.width;
    g.drawImage(isles, ixo - isles.width, hzY - isles.height + 2 * u); g.drawImage(isles, ixo, hzY - isles.height + 2 * u);
    if (TH.weather === 'rain' && rand() < 0.004) bolt = 0.25;
    if (bolt > 0) { g.fillStyle = `rgba(220,230,255,${bolt * 1.2})`; g.fillRect(0, 0, cw, hzY); }
    // the sea, to the horizon
    const sg = g.createLinearGradient(0, hzY, 0, ch);
    sg.addColorStop(0, mix(TH.sea[0], TH.sky[2], 0.45)); sg.addColorStop(0.25, TH.sea[0]); sg.addColorStop(1, TH.sea[1]);
    g.fillStyle = sg; g.fillRect(0, hzY, cw, ch - hzY);
    // swell lines, closer together towards the horizon, drifting as the tower turns
    g.lineWidth = 2 * u;
    for (let k = 1; k <= 20; k++) {
      const d = k / 20, y = hzY + (ch - hzY) * d * d * 1.05;
      if (y > ch) break;
      const amp = (1.5 + d * 7) * u, wl = (60 + d * 260) * u, sh = turn * cw * (0.6 + d * 2.4) + t * (10 + d * 30) * u * (k % 2 ? 1 : -1);
      g.strokeStyle = `rgba(255,255,255,${0.05 + d * 0.1})`;
      g.beginPath();
      for (let x = -wl; x <= cw + wl; x += wl / 6) {
        const xx = x + (sh % wl), yy = y + Math.sin((x / wl) * TAU + t * 1.5 + k) * amp;
        if (x === -wl) g.moveTo(xx, yy); else g.lineTo(xx, yy);
      }
      g.stroke();
    }
  }

  // ---------- the tower ----------
  // a band round the drum between angles a0..a1 at radius r, heights h0 (top) and h1 (bottom)
  function band(a0, a1, r, h0, h1, n = 5) {
    g.beginPath();
    for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; const x = PX(a, r), y = PY(a, r, h0); if (k) g.lineTo(x, y); else g.moveTo(x, y); }
    for (let k = n; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / n; g.lineTo(PX(a, r), PY(a, r, h1)); }
    g.closePath();
  }
  // a slab sticking out of the drum: the top face (h) and the front face down to h − thick
  function slab(a0, a1, h, thick, r1, top, front, side, capL, capR) {
    const n = 5, r0 = R * 0.98;
    g.fillStyle = front; band(a0, a1, r1, h, h - thick, n); g.fill();
    g.fillStyle = top;
    g.beginPath();
    for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; const x = PX(a, r1), y = PY(a, r1, h); if (k) g.lineTo(x, y); else g.moveTo(x, y); }
    for (let k = n; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / n; g.lineTo(PX(a, r0), PY(a, r0, h)); }
    g.closePath(); g.fill();
    // an end you can see: the left end on the right of the drum, the right end on the left
    g.fillStyle = side;
    for (const [a, on] of [[a0, capL && Math.sin(a0) > 0], [a1, capR && Math.sin(a1) < 0]]) {
      if (!on) continue;
      g.beginPath(); g.moveTo(PX(a, r0), PY(a, r0, h)); g.lineTo(PX(a, r1), PY(a, r1, h)); g.lineTo(PX(a, r1), PY(a, r1, h - thick)); g.lineTo(PX(a, r0), PY(a, r0, h - thick)); g.closePath(); g.fill();
    }
  }
  function drawTower(s, T, t, { hideHero = false } = {}) {
    const hLo = V.y + V.sink - (ch - baseY) / RH - 2, hHi = V.y + V.sink + baseY / RH + 2;
    const top = T.rows + 0.15, rLo = Math.max(0, Math.floor(hLo)), rHi = Math.min(T.rows - 1, Math.ceil(hHi));
    const seaH = SEA + V.sink; // the waterline in tower heights
    const bottom = Math.max(seaH, hLo);
    const [lit, mid, dark] = TH.stone;

    // its reflection in the sea
    const yw = PY(0, R, seaH);
    if (yw < ch) {
      g.save();
      g.globalAlpha = 0.32;
      const grad = bodyGrad(cx - R, cx + R, TH.stone);
      const depth = Math.min(ch - yw + 4 * u, (Math.min(top, hHi) - seaH) * RH);
      for (let y = 0; y < depth; y += 5 * u) {
        const off = Math.sin(y * 0.045 / u + t * 2.2) * (2 + y * 0.03) * u;
        g.save(); g.translate(off, 0); g.fillStyle = grad;
        g.fillRect(cx - R * (1 - y / ch * 0.1), yw + y, R * 2 * (1 - y / ch * 0.1), 5.5 * u); g.restore();
      }
      g.restore();
      const rg = g.createLinearGradient(0, yw, 0, Math.min(ch, yw + depth));
      rg.addColorStop(0, css(rgb(TH.sea[0]), 0.1)); rg.addColorStop(1, css(rgb(TH.sea[1]), 0.85));
      g.fillStyle = rg; g.fillRect(cx - R * 1.2, yw, R * 2.4, depth);
    }

    // the cells, nearest the back first
    const cells = [];
    for (let r = rLo; r <= Math.min(T.rows, rHi + 1); r++) for (let c = 0; c < COLS; c++) {
      const a0 = phiOf(c), mid0 = a0 + SEG / 2;
      cells.push({ c, r, a0, a1: a0 + SEG, depth: Math.cos(mid0) });
    }
    cells.sort((a, b) => a.depth - b.depth);
    const ledgeOf = (c, r) => {
      const k = T.at(c, r);
      if (k === K.BLOCK) return 'block';
      if (k === K.LEDGE || k === K.DOOR || k === K.EXIT || k === K.SLIP || k === K.CRUMB || k === K.BLINK) return k;
      return T.at(c, r - 1) === K.BLOCK ? null : null;
    };

    // back ledges first: only their ends show past the drum
    for (const e of cells) if (e.depth < 0) drawCell(s, T, e, ledgeOf, t, true);

    // the drum
    const yTop = Yh(top), yBot = Yh(bottom);
    g.fillStyle = bodyGrad(cx - R, cx + R, TH.stone);
    g.beginPath();
    g.moveTo(cx - R, PY(-Math.PI / 2, R, top));
    g.lineTo(cx - R, PY(-Math.PI / 2, R, bottom));
    for (let k = 0; k <= 24; k++) { const a = -Math.PI / 2 + (Math.PI * k) / 24; g.lineTo(PX(a, R), PY(a, R, bottom)); }
    g.lineTo(cx + R, PY(Math.PI / 2, R, top));
    for (let k = 24; k >= 0; k--) { const a = -Math.PI / 2 + (Math.PI * k) / 24; g.lineTo(PX(a, R), PY(a, R, top)); }
    g.closePath(); g.fill();
    void yTop; void yBot;
    // courses and joints of brick
    g.strokeStyle = css(rgb(TH.mortar), 0.55); g.lineWidth = Math.max(1, 1.6 * u);
    g.beginPath();
    const k0 = Math.max(Math.ceil(bottom * 2), 0), k1 = Math.floor(Math.min(top, hHi) * 2);
    for (let k = k0; k <= k1; k++) {
      const h = k / 2;
      for (let j = 0; j <= 16; j++) { const a = -Math.PI / 2 + (Math.PI * j) / 16, x = PX(a, R), y = PY(a, R, h); if (j) g.lineTo(x, y); else g.moveTo(x, y); }
    }
    g.stroke();
    g.beginPath();
    for (let k = k0; k < k1; k++) {
      const h = k / 2, off = (k & 1) * 0.25;
      for (let j = 0; j < 32; j++) {
        const a = phiOf(j * 0.5 + off);
        if (Math.cos(a) < 0.08) continue;
        const x = PX(a, R); g.moveTo(x, PY(a, R, h)); g.lineTo(x, PY(a, R, h + 0.5));
      }
    }
    g.stroke();
    // a few bricks a shade lighter or darker
    for (let k = k0; k < k1; k++) {
      const h = k / 2, off = (k & 1) * 0.25;
      for (let j = 0; j < 32; j++) {
        const q = hash(j, k);
        if (q > 0.22) continue;
        const a0 = phiOf(j * 0.5 + off), a1 = a0 + SEG / 2;
        if (Math.cos(a0) < 0.1 || Math.cos(a1) < 0.1) continue;
        g.fillStyle = q < 0.11 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';
        band(a0 + 0.01, a1 - 0.01, R, h + 0.48, h + 0.02, 2); g.fill();
      }
    }
    // wet, weedy stone at the foot
    if (seaH + 2.5 > hLo) {
      const wg = g.createLinearGradient(0, Yh(seaH + 2.4), 0, Yh(seaH));
      wg.addColorStop(0, 'rgba(10,40,30,0)'); wg.addColorStop(1, 'rgba(10,40,30,0.55)');
      g.fillStyle = wg; band(-Math.PI / 2, Math.PI / 2, R, seaH + 2.4, seaH, 16); g.fill();
    }
    // the crown: a stone lip, merlons and a pennant
    if (top < hHi) {
      g.fillStyle = mix(lit, '#ffffff', 0.2);
      g.beginPath(); g.ellipse(cx, Yh(top + 0.25), R * 1.06, TILT * R * 1.06, 0, 0, TAU); g.fill();
      g.fillStyle = mix(mid, dark, 0.3); band(-Math.PI / 2, Math.PI / 2, R * 1.06, top + 0.25, top - 0.15, 16); g.fill();
      for (let j = 0; j < 16; j++) {
        const a0 = phiOf(j + 0.15), a1 = a0 + SEG * 0.55;
        if (Math.cos(a0) < -0.2 && Math.cos(a1) < -0.2) continue;
        if (Math.cos((a0 + a1) / 2) < 0) continue;
        g.fillStyle = mix(dark, lit, lightAt((a0 + a1) / 2)); band(a0, a1, R * 1.04, top + 0.85, top + 0.25, 3); g.fill();
        g.fillStyle = mix(lit, '#ffffff', 0.3); g.beginPath(); g.moveTo(PX(a0, R * 1.04), PY(a0, R * 1.04, top + 0.85)); g.lineTo(PX(a1, R * 1.04), PY(a1, R * 1.04, top + 0.85)); g.lineTo(PX(a1, R * 0.9), PY(a1, R * 0.9, top + 0.85)); g.lineTo(PX(a0, R * 0.9), PY(a0, R * 0.9, top + 0.85)); g.fill();
      }
      const fx = cx, fy = Yh(top + 0.25);
      g.strokeStyle = '#3a2a1a'; g.lineWidth = 4 * u; g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - RH * 2.6); g.stroke();
      g.fillStyle = TH.accent;
      g.beginPath(); g.moveTo(fx, fy - RH * 2.6);
      for (let k = 0; k <= 8; k++) g.lineTo(fx + k * RH * 0.16, fy - RH * 2.6 + Math.sin(t * 6 - k * 0.7) * RH * 0.08 + k * RH * 0.03);
      for (let k = 8; k >= 0; k--) g.lineTo(fx + k * RH * 0.16, fy - RH * 2.0 + Math.sin(t * 6 - k * 0.7) * RH * 0.08 - k * RH * 0.03);
      g.fill();
    }

    // wall features, lift shafts and the shadows under the ledges
    for (const e of cells) if (e.depth > 0.05) drawWall(s, T, e, t);
    T.lifts.forEach((L, i) => {
      const a0 = phiOf(L.c), a1 = a0 + SEG;
      if (Math.cos(a0 + SEG / 2) < 0.05) return;
      g.fillStyle = 'rgba(0,0,0,0.28)'; band(a0 + SEG * 0.18, a1 - SEG * 0.18, R, L.r1 + 1.6, Math.max(bottom, L.r0 - 0.2), 4); g.fill();
      g.strokeStyle = 'rgba(30,30,40,0.7)'; g.lineWidth = 3 * u;
      for (const f of [0.28, 0.72]) { const a = a0 + SEG * f; g.beginPath(); g.moveTo(PX(a, R), PY(a, R, L.r1 + 1.6)); g.lineTo(PX(a, R), PY(a, R, Math.max(bottom, L.r0 - 0.2))); g.stroke(); }
      void i;
    });
    // ledges and blocks, the back of the front half first
    for (const e of cells) if (e.depth >= 0) drawCell(s, T, e, ledgeOf, t, false);
    // the lifts' platforms
    T.lifts.forEach((L, i) => {
      const a0 = phiOf(L.c), a1 = a0 + SEG, dp = Math.cos(a0 + SEG / 2);
      if (dp < -0.6) return;
      const ly = s.lifts[i].y, li = lightAt(a0 + SEG / 2);
      g.strokeStyle = 'rgba(40,40,50,0.8)'; g.lineWidth = 2 * u;
      for (const f of [0.12, 0.88]) { const a = a0 + SEG * f; g.beginPath(); g.moveTo(PX(a, R + PR * 0.8), PY(a, R + PR * 0.8, ly)); g.lineTo(PX(a, R * 1.0), PY(a, R, L.r1 + 1.6)); g.stroke(); }
      slab(a0, a1, ly, 0.22, R + PR * 1.05, mix('#5a6470', '#e6edf5', 0.3 + li * 0.7), mix('#1a1e26', '#8a96a6', li), '#2a3038', true, true);
      g.fillStyle = '#ffd24a';
      for (const f of [0.2, 0.5, 0.8]) { const a = a0 + SEG * f; g.beginPath(); g.arc(PX(a, R + PR * 1.05), PY(a, R + PR * 1.05, ly - 0.11), 2.5 * u, 0, TAU); g.fill(); }
    });
    // the sea's edge round the foot
    if (yw < ch + RH) {
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3 * u;
      g.beginPath();
      for (let k = 0; k <= 24; k++) { const a = -Math.PI / 2 + (Math.PI * k) / 24, x = PX(a, R * 1.02), y = PY(a, R * 1.02, seaH) + Math.sin(k * 1.7 + t * 3) * 2.5 * u; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 2 * u;
      g.beginPath();
      for (let k = 0; k <= 24; k++) { const a = -Math.PI / 2 + (Math.PI * k) / 24, x = PX(a, R * 1.12), y = PY(a, R * 1.12, seaH - 0.1) + Math.sin(k * 2.3 - t * 2.4) * 3 * u; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    drawActors(s, T, t, hideHero);
  }

  function drawWall(s, T, e, t) {
    const k = T.at(e.c, e.r), { a0, r } = e, li = lightAt(a0 + SEG / 2);
    if (k === K.WINDOW) {
      arch(a0 + SEG * 0.33, a0 + SEG * 0.67, r + 0.3, r + 0.95, 0.3);
      const warm = TH.stars || TH.weather === 'embers';
      g.fillStyle = warm ? mix('#3a2410', '#ffc46a', 0.5 + Math.sin(t * 2 + e.c) * 0.1) : mix('#0c1420', '#2a4660', li); g.fill();
      g.strokeStyle = mix(TH.stone[2], TH.stone[0], li); g.lineWidth = 3 * u; g.stroke();
    } else if (k === K.DOOR || k === K.EXIT) {
      const exit = k === K.EXIT;
      arch(a0 + SEG * 0.2, a0 + SEG * 0.8, r + 0.02, r + 0.95, 0.42);
      const dg = g.createLinearGradient(0, PY(a0, R, r + 1.3), 0, PY(a0, R, r));
      dg.addColorStop(0, exit ? '#5a3a08' : '#05070c'); dg.addColorStop(1, exit ? mix('#ffd24a', '#ffffff', 0.4 + Math.sin(t * 4) * 0.3) : '#20304a');
      g.fillStyle = dg; g.fill();
      g.strokeStyle = exit ? GOLD : mix(TH.stone[2], '#ffffff', 0.25 + li * 0.5); g.lineWidth = (exit ? 6 : 5) * u; g.stroke();
      if (exit && rand() < 0.2) burst(e.c + 0.5 + (rand() - 0.5) * 0.5, r + rand() * 1.2, 1, [GOLD, '#ffffff'], 0.6, { grav: -1.5, size: 0.05, r: 0.05, life: 0.8 });
    } else if (k === K.SPOUT) {
      const a = a0 + SEG / 2, x = PX(a, R), y = PY(a, R, r + 0.7);
      g.fillStyle = mix('#203040', '#8aa0b0', li); g.beginPath(); g.ellipse(x, y, RH * 0.22 * Math.cos(a), RH * 0.18, 0, 0, TAU); g.fill();
      g.fillStyle = '#05080c'; g.beginPath(); g.ellipse(x, y + RH * 0.04, RH * 0.12 * Math.cos(a), RH * 0.09, 0, 0, TAU); g.fill();
    }
  }
  // an arched opening on the drum: sides at a0, a1 from h0 up to h1, a rounded top rising rise
  function arch(a0, a1, h0, h1, rise) {
    g.beginPath();
    g.moveTo(PX(a0, R), PY(a0, R, h0)); g.lineTo(PX(a0, R), PY(a0, R, h1));
    for (let k = 1; k <= 8; k++) { const q = k / 8, a = a0 + (a1 - a0) * q; g.lineTo(PX(a, R), PY(a, R, h1 + Math.sin(q * Math.PI) * rise)); }
    g.lineTo(PX(a1, R), PY(a1, R, h0)); g.closePath();
  }

  function drawCell(s, T, e, ledgeOf, t, back) {
    const { c, r, a0, a1 } = e, k = ledgeOf(c, r);
    if (!k) return;
    const mid = a0 + SEG / 2, li = lightAt(mid) * (back ? 0.4 : 1);
    const nl = ledgeOf((c + COLS - 1) % COLS, r), nr = ledgeOf((c + 1) % COLS, r);
    if (k === 'block') {
      const top = r + 1, ro = R + PR * 1.1;
      slab(a0, a1, top, 1, ro, mix(TH.stone[1], TH.stone[0], 0.4 + li * 0.6), mix(TH.stone[2], TH.stone[0], li * 0.85), mix(TH.stone[2], TH.stone[1], 0.4), nl !== 'block', nr !== 'block');
      if (!back) { g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2 * u; g.beginPath(); for (let j = 0; j <= 5; j++) { const a = a0 + (SEG * j) / 5; const x = PX(a, ro), y = PY(a, ro, r + 0.5); if (j) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
      return;
    }
    if (!back) { // the shadow it throws on the wall
      g.fillStyle = 'rgba(0,0,0,0.22)'; band(a0, a1, R * 1.001, r - 0.28, r - 0.62, 4); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.12)'; band(a0, a1, R * 1.001, r - 0.62, r - 0.95, 4); g.fill();
    }
    let top = TH.ledge[0], front = TH.ledge[1], alpha = 1, jit = 0, thick = 0.3;
    if (k === K.SLIP) { top = '#f4fdff'; front = '#7fc4e8'; }
    else if (k === K.EXIT) { top = '#fff3c0'; front = '#d49a28'; }
    else if (k === K.CRUMB) {
      top = mix(TH.ledge[0], '#a08060', 0.45); front = mix(TH.ledge[1], '#5a4030', 0.45);
      const q = s.crumb[r * COLS + c];
      if (q && !q.gone) jit = (rand() - 0.5) * 3 * u;
      if (q && q.gone) { alpha = q.t < 0.6 ? 1 - q.t / 0.6 : 0.12; if (q.t >= 0.6) { ghost(a0, a1, r); return; } }
    } else if (k === K.BLINK) {
      const ph = ((s.t + (c + r) * 0.4) % PHYS.blink) / PHYS.blink, on = PHYS.blinkOn / PHYS.blink;
      top = mix(TH.accent, '#ffffff', 0.5); front = mix(TH.accent, '#000000', 0.35);
      if (ph >= on) { ghost(a0, a1, r, TH.accent); return; }
      if (ph > on - 0.12 && Math.floor(t * 16) % 2) alpha = 0.35;
      thick = 0.24;
    }
    g.save();
    g.globalAlpha = alpha;
    if (jit) g.translate(jit, 0);
    const ro = R + PR;
    slab(a0, a1, r, thick, ro, mix(front, top, 0.45 + li * 0.55), mix(mixHex(front, '#000000', 0.55), front, li), mixHex(front, '#000000', 0.45), nl !== k, nr !== k);
    if (k === K.SLIP && !back) { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2 * u; g.beginPath(); const p0 = a0 + SEG * 0.2, p1 = a0 + SEG * 0.6; g.moveTo(PX(p0, ro * 0.995), PY(p0, ro * 0.995, r) - u); g.lineTo(PX(p1, ro * 0.995), PY(p1, ro * 0.995, r) - u); g.stroke(); }
    if (k === K.CRUMB && !back) { g.strokeStyle = 'rgba(40,20,10,0.6)'; g.lineWidth = 1.5 * u; g.beginPath(); for (const f of [0.3, 0.65]) { const a = a0 + SEG * f; g.moveTo(PX(a, ro), PY(a, ro, r)); g.lineTo(PX(a + SEG * 0.06, ro), PY(a, ro, r - 0.15)); g.lineTo(PX(a - SEG * 0.03, ro), PY(a, ro, r - thick)); } g.stroke(); }
    if (k === K.BLINK && !back) { g.globalAlpha = alpha * 0.35; g.fillStyle = TH.accent; band(a0, a1, ro * 1.01, r + 0.1, r - thick - 0.1, 4); g.fill(); }
    g.restore();
  }
  const mixHex = (a, b, t) => mix(a, b, t);
  function ghost(a0, a1, r, col = '#ffffff') {
    g.strokeStyle = css(rgb(col), 0.25); g.lineWidth = 2 * u; g.setLineDash([6 * u, 6 * u]);
    band(a0, a1, R + PR, r, r - 0.25, 4); g.stroke(); g.setLineDash([]);
  }

  // ---------- the people on the tower ----------
  function drawActors(s, T, t, hideHero) {
    const list = [];
    for (const f of s.foes) {
      if (f.dead > 0) continue;
      const a = phiOf(f.th);
      if (Math.cos(a) < 0.02) continue;
      list.push({ a, f });
    }
    list.sort((p, q) => Math.cos(p.a) - Math.cos(q.a));
    const rr = R + PR * 0.55;
    for (const { a, f } of list) {
      const x = PX(a, rr), y = PY(a, rr, f.y), z = RH * 1.15, al = clamp(Math.cos(a) * 3, 0, 1);
      if (f.k === 'urchin') drawUrchin(g, x, y, z, t, (f.th * TAU * 0.6) % TAU, al);
      else if (f.k === 'jelly') drawJelly(g, x, y, z, t + f.c, f.stun > 0, al);
      else if (f.k === 'crab') drawCrab(g, x, y, z, t, Math.sign(adiff(s.hero.th, f.th)) || 1, f.vy ? t * 10 : f.push ? Math.sin(t * 30) * 0.3 : 0, al);
      else if (f.k === 'drip' && f.t >= 0.5 && f.y > f.to) drawDrip(g, PX(a, R + PR * 0.3), PY(a, R + PR * 0.3, f.y), z);
    }
    // contact shadow, then Clink
    const h = s.hero;
    if (!hideHero && h.state !== 'sunk') {
      const crown = s.status === 'sink', hy = crown ? Math.max(h.y - V.sink, SEA + 0.15) + V.sink : h.y;
      const door = h.state === 'door', p = door ? h.doorT / PHYS.door : 0;
      let alpha = door ? (p < 0.3 ? 1 - p / 0.3 : p > 0.75 ? (p - 0.75) / 0.25 : 0) : 1;
      if (h.inv > 0 && s.status === 'play' && !door && Math.floor(t * 12) % 2) alpha *= 0.45;
      const x = cx + (door ? 0 : 0), y = PY(0, rr, hy) + (crown && h.y - V.sink <= SEA + 0.15 ? Math.sin(t * 3) * 3 * u : 0);
      if (h.ground && !door) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(x, y + 2 * u, RH * 0.42, RH * 0.1, 0, 0, TAU); g.fill(); }
      const sq = clamp(squash + (h.ground ? 0 : -clamp(h.vy / 30, -0.3, 0.3)), -0.6, 1);
      drawClink(g, x, y, h.dir, RH * 1.42, { walk: h.walkT / 0.75 * 0.5 + (h.th * 0.5), air: !h.ground, squash: sq, shoot: h.shootT > 0 ? 1 : 0, hurt: h.state === 'knock' ? 1 : 0, t, alpha });
    }
    // bubbles
    for (const b of s.shots) {
      const a = phiOf(b.th);
      if (Math.cos(a) < 0) continue;
      const x = PX(a, R + PR * 0.7), y = PY(a, R + PR * 0.7, b.y), r = RH * (0.16 + b.t * 0.3);
      const bg = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      bg.addColorStop(0, 'rgba(255,255,255,0.9)'); bg.addColorStop(0.6, 'rgba(150,230,255,0.35)'); bg.addColorStop(1, 'rgba(120,210,255,0.7)');
      g.fillStyle = bg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    // squalls fly across the front, whatever way the tower turns
    for (const q of s.squalls) {
      const x = cx + q.sx * colPx, y = PY(0, R + PR * 1.5, q.y);
      if (x < -RH * 3 || x > cw + RH * 3) continue;
      drawSquall(g, x, y, RH * 1.3, t, Math.sign(q.v));
    }
    // world particles and pop-ups
    for (const p of parts) {
      const a = phiOf(p.th);
      if (Math.cos(a) < 0) continue;
      const rr2 = R + PR * p.r * 2, x = PX(a, rr2), y = PY(a, rr2, p.y);
      g.fillStyle = css(rgb(p.c), clamp(p.life / p.max, 0, 1));
      g.beginPath(); g.arc(x, y, p.size * RH, 0, TAU); g.fill();
    }
    for (const p of pops) {
      const a = phiOf(p.th);
      if (Math.cos(a) < 0) continue;
      g.globalAlpha = clamp(p.t * 2, 0, 1);
      label(p.s, PX(a, R + PR), PY(a, R + PR, p.y + (1.2 - p.t) * 1.2), 30, p.col, { font: HEAD, align: 'center', shadow: true });
      g.globalAlpha = 1;
    }
  }

  function drawWeather(t, dt) {
    const w = TH.weather;
    if (w === 'snow' || w === 'rain' || w === 'embers' || w === 'motes' || w === 'mist') {
      for (const p of weather) {
        if (w === 'snow') { p.y += dt * 0.07 * p.z; p.x += dt * 0.02 * Math.sin(t + p.p * 9); }
        else if (w === 'rain') { p.y += dt * 1.3 * p.z; p.x -= dt * 0.25 * p.z; }
        else if (w === 'embers') { p.y -= dt * 0.05 * p.z; p.x += dt * 0.015 * Math.sin(t * 2 + p.p * 9); }
        else { p.y -= dt * 0.012 * p.z; p.x += dt * 0.01; }
        p.y = ((p.y % 1) + 1) % 1; p.x = ((p.x % 1) + 1) % 1;
        const x = ((p.x + V.th / COLS * (0.4 + p.z)) % 1) * cw, y = p.y * ch;
        if (w === 'rain') { g.strokeStyle = `rgba(200,215,235,${0.25 * p.z})`; g.lineWidth = 1.5 * u; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 6 * u, y + 26 * u * p.z); g.stroke(); }
        else if (w === 'snow') { g.fillStyle = `rgba(255,255,255,${0.5 + 0.4 * p.z})`; g.beginPath(); g.arc(x, y, (1.5 + p.z * 2.5) * u, 0, TAU); g.fill(); }
        else if (w === 'embers') { g.fillStyle = `rgba(255,${150 + p.p * 80 | 0},80,${0.5 * p.z + 0.3 * Math.sin(t * 5 + p.p * 20)})`; g.beginPath(); g.arc(x, y, (1 + p.z * 2) * u, 0, TAU); g.fill(); }
        else if (w === 'motes') { g.fillStyle = css(rgb(TH.accent), 0.25 * p.z + 0.15 * Math.sin(t * 2 + p.p * 20)); g.beginPath(); g.arc(x, y, (1 + p.z * 2) * u, 0, TAU); g.fill(); }
        else if (w === 'mist' && p.p < 0.15) { g.fillStyle = 'rgba(230,240,235,0.05)'; g.beginPath(); g.ellipse(x, y, 240 * u * p.z, 60 * u * p.z, 0, 0, TAU); g.fill(); }
      }
    }
    if (w === 'gulls') for (let k = 0; k < 3; k++) {
      const x = ((((t * 0.03 + k * 0.37 + V.th / COLS * 0.7) % 1) + 1) % 1) * cw * 1.2 - cw * 0.1, y = ch * (0.12 + k * 0.07) + Math.sin(t * 0.7 + k) * 10 * u, fl = Math.sin(t * 6 + k * 2) * 6 * u;
      g.strokeStyle = 'rgba(40,50,70,0.6)'; g.lineWidth = 2.5 * u;
      g.beginPath(); g.moveTo(x - 14 * u, y - fl); g.quadraticCurveTo(x - 6 * u, y - 6 * u, x, y); g.quadraticCurveTo(x + 6 * u, y - 6 * u, x + 14 * u, y - fl); g.stroke();
    }
  }

  // ---------- the Kite Run ----------
  let bonusMap = null;
  function drawBonus(app, t) {
    const s = app.sim.s, b = s.bonus;
    V = { th: b.x * 0.8, y: 2, sink: 0 };
    drawBackdrop(t);
    const seaY = ch * 0.84, UX = cw / 12, UY = (seaY - ch * 0.16) / BONUS.h;
    bonusMap = (x, y) => ({ x: (x - b.x) * UX, y: seaY - y * UY });
    // the next tower, coming up on the horizon
    const near = clamp(b.t / BONUS.dur, 0, 1), tx = cw * (1.15 - near * 0.4), tw = R * (0.1 + near * 0.16), tt = hzY - ch * (0.1 + near * 0.16);
    g.fillStyle = bodyGrad(tx - tw, tx + tw, THEMES[nextTheme(app)].stone); g.fillRect(tx - tw, tt, tw * 2, hzY - tt);
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.beginPath(); g.ellipse(tx, tt, tw, tw * TILT, 0, 0, TAU); g.fill();
    // the nearer sea, rolling past
    const wg = g.createLinearGradient(0, seaY - 20 * u, 0, ch);
    wg.addColorStop(0, css(rgb(TH.sea[0]), 0.0)); wg.addColorStop(0.2, css(rgb(TH.sea[0]), 0.85)); wg.addColorStop(1, TH.sea[1]);
    g.fillStyle = wg;
    g.beginPath(); g.moveTo(0, ch);
    for (let x = 0; x <= cw; x += 20 * u) g.lineTo(x, seaY + Math.sin((x / UX + b.x) * 1.7 + t * 2) * 8 * u);
    g.lineTo(cw, ch); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3 * u; g.beginPath();
    for (let x = 0; x <= cw; x += 20 * u) { const y = seaY + Math.sin((x / UX + b.x) * 1.7 + t * 2) * 8 * u; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    // sea-glass
    b.gems.forEach((gm, i) => { if (gm.got) return; const p = bonusMap(gm.x, gm.y); if (p.x > -50 * u && p.x < cw + 50 * u) drawGem(g, p.x, p.y, RH * 1.5, t, i); });
    // the kite, with Clink hanging under it
    const kx = BONUS.kx * UX, ky = seaY - b.ky * UY, tilt = clamp(-b.vy * 0.06, -0.35, 0.35);
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(kx, ky + RH * 0.5); g.lineTo(kx - RH * 0.1, ky + RH * 1.4); g.stroke();
    drawKite(g, kx, ky - RH * 0.1, RH * 1.6, t, tilt);
    drawClink(g, kx - RH * 0.1, ky + RH * 2.45, 1, RH * 1.1, { air: true, t, squash: 0 });
    // its reflection
    g.globalAlpha = 0.18; g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(kx, seaY + 10 * u, RH * 0.8, RH * 0.12, 0, 0, TAU); g.fill(); g.globalAlpha = 1;
    for (const p of sparts) { g.fillStyle = css(rgb(p.c), clamp(p.life / p.max, 0, 1)); g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill(); }
    // its HUD
    glass(cw / 2 - 300 * u, 24 * u, 600 * u, 92 * u);
    label('KITE RUN', cw / 2, 66 * u, 36, GOLD, { font: HEAD, align: 'center', spacing: 3 });
    label(`SEA-GLASS  ${b.got} / ${b.n}`, cw / 2, 102 * u, 24, INK, { align: 'center', spacing: 2 });
    const left = clamp(1 - b.t / BONUS.dur, 0, 1);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(cw / 2 - 260 * u, 124 * u, 520 * u, 8 * u);
    g.fillStyle = GOLD; g.fillRect(cw / 2 - 260 * u, 124 * u, 520 * u * left, 8 * u);
    if (b.t < 2.5 && !app.demo) prompt(app.input, '{steer} Steer the kite', cw / 2, ch * 0.3, 28, INK);
    if (b.done) {
      shade(clamp(b.doneT * 0.6, 0, 0.5));
      label(b.got === b.n ? 'PERFECT!' : 'WELL FLOWN', cw / 2, ch * 0.42, 96, b.got === b.n ? GOLD : INK, { font: HEAD, align: 'center', spacing: 4, shadow: true });
      label(`${b.got} × ${SCORE.gem}${b.got === b.n ? `  +  ${SCORE.perfect}` : ''}`, cw / 2, ch * 0.52, 36, INK, { align: 'center', spacing: 2 });
    }
  }
  const nextTheme = app => app.towers[(app.sim.s.tower + 1) % app.towers.length].theme;

  // ---------- HUD ----------
  function drawHud(app, t) {
    const s = app.sim.s, T = app.sim.T;
    glass(24 * u, 22 * u, 300 * u, 96 * u);
    label('SCORE', 48 * u, 56 * u, 20, DIM, { spacing: 3 });
    label(pad6(s.score), 48 * u, 100 * u, 42, INK, { font: HEAD, spacing: 2 });
    // the clock
    const low = s.time < 10.5 && s.status === 'play';
    glass(cw / 2 - 170 * u, 22 * u, 340 * u, 96 * u);
    label(`TOWER ${s.tower + 1 + s.loop * app.towers.length} · ${T.name.toUpperCase()}`, cw / 2, 54 * u, 20, DIM, { align: 'center', spacing: 2 });
    const big = 46 * (1 + tick * 0.18);
    label(String(Math.ceil(s.time)), cw / 2, 104 * u, big, low ? (Math.floor(t * 4) % 2 ? RED : INK) : INK, { font: HEAD, align: 'center', spacing: 2 });
    // lives and the best
    glass(cw - 324 * u, 22 * u, 300 * u, 96 * u);
    label('HI ' + pad6(app.hi), cw - 48 * u, 56 * u, 20, DIM, { align: 'right', spacing: 2 });
    for (let k = 0; k < Math.min(6, s.lives); k++) drawClink(g, cw - 66 * u - k * 44 * u, 108 * u, -1, 42 * u, { t: 0 });
    // how high: a slim meter at the right edge
    const mx = cw - 40 * u, m0 = ch * 0.84, m1 = ch * 0.2, top = T.rows - 1;
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.roundRect(mx - 5 * u, m1, 10 * u, m0 - m1, 5 * u); g.fill();
    const best = m0 - (m0 - m1) * clamp(s.maxRow / top, 0, 1), now = m0 - (m0 - m1) * clamp(s.hero.y / top, 0, 1);
    g.fillStyle = css(rgb(TH.accent), 0.5); g.beginPath(); g.roundRect(mx - 5 * u, best, 10 * u, m0 - best, 5 * u); g.fill();
    g.fillStyle = GOLD; g.beginPath(); g.arc(mx, m1, 8 * u, 0, TAU); g.fill();
    g.fillStyle = INK; g.beginPath(); g.arc(mx, now, 9 * u, 0, TAU); g.fill();
    // a squall is coming
    if (warn.t > 0 && Math.floor(t * 8) % 2) {
      const x = warn.side < 0 ? 40 * u : cw - 90 * u, y = baseY;
      g.fillStyle = '#ffffff';
      g.beginPath(); const d = warn.side < 0 ? -1 : 1; g.moveTo(x + 25 * u - d * 20 * u, y - 26 * u); g.lineTo(x + 25 * u + d * 20 * u, y); g.lineTo(x + 25 * u - d * 20 * u, y + 26 * u); g.fill();
    }
  }
  function banner(title, sub, a, col = INK) {
    if (a <= 0) return;
    g.globalAlpha = clamp(a, 0, 1);
    label(title, cw / 2, ch * 0.36, 92, col, { font: HEAD, align: 'center', spacing: 4, shadow: true });
    if (sub) label(sub, cw / 2, ch * 0.36 + 62 * u, 32, INK, { align: 'center', spacing: 2, shadow: true });
    g.globalAlpha = 1;
  }
  function drawBanners(app, t) {
    const s = app.sim.s, st = s.status, k = s.statusT;
    if (st === 'ready') banner(`TOWER ${s.tower + 1 + s.loop * app.towers.length}`, s.loop ? `${app.sim.T.name} · round ${s.loop + 1}` : app.sim.T.name, Math.min(k * 3, (PHYS.ready + 0.6 - k) * 3), GOLD);
    if (st === 'play' && k < 0.8 && s.t < 1) banner(`TOWER ${s.tower + 1 + s.loop * app.towers.length}`, 'Climb to the crown door!', (0.8 - k) * 2, GOLD);
    if (st === 'splash') banner('SPLASH!', s.lives > 1 ? 'Back to the last safe ledge' : '', Math.min(k * 3, 1.5));
    if (st === 'timeup') banner('TIME UP', '', Math.min(k * 3, 1.5), RED);
    if (st === 'over') banner('GAME OVER', `TOWER ${s.reached + 1}  ·  ${pad6(s.score)}`, Math.min(k * 2, 1), RED);
    if (st === 'sink') banner('WOUND DOWN!', s.time > 0 ? `TIME BONUS  ${Math.ceil(s.time)} × ${SCORE.second}` : `TOWER BONUS  ${SCORE.tower * (1 + (s.tower % 8))}`, Math.min(k * 2, 1), GOLD);
    if (app.demo) label('DEMO', cw / 2, ch - 36 * u, 26, Math.floor(t * 2) % 2 ? GOLD : DIM, { font: HEAD, align: 'center', spacing: 4 });
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
    for (const [b, on, name] of [[L.jump, T.jump, 'JUMP'], [L.fire, T.fire, 'BUBBLE']]) {
      g.fillStyle = on ? 'rgba(127,240,255,0.35)' : 'rgba(255,255,255,0.1)'; g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill(); g.stroke();
      label(name, b.x, b.y + 9 * L.u, 24 * (L.u / u), INK, { font: HEAD, align: 'center' });
    }
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(L.pause.x, L.pause.y, L.pause.r, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = INK; g.fillRect(L.pause.x - 12 * L.u, L.pause.y - 15 * L.u, 8 * L.u, 30 * L.u); g.fillRect(L.pause.x + 4 * L.u, L.pause.y - 15 * L.u, 8 * L.u, 30 * L.u);
  }

  // ---------- screens ----------
  function logo(x, y, size, t) {
    g.font = `400 ${Math.round(size * u)}px ${HEAD}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = 8 * u + 'px';
    g.fillStyle = 'rgba(0,10,30,0.5)'; g.fillText('SPINDLE', x + 7 * u, y + 9 * u);
    const gr = g.createLinearGradient(0, y - size * u * 0.8, 0, y);
    gr.addColorStop(0, '#fff6d8'); gr.addColorStop(0.45, '#ffd24a'); gr.addColorStop(0.5, '#f0a030'); gr.addColorStop(1, '#a8501a');
    g.fillStyle = gr; g.fillText('SPINDLE', x, y);
    g.strokeStyle = 'rgba(255,250,230,0.5)'; g.lineWidth = 2 * u; g.strokeText('SPINDLE', x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
    void t;
  }
  const menuBox = [];
  function drawMenu(app, x, y, t) {
    const items = app.items();
    menuBox.length = 0;
    items.forEach((it, k) => {
      const sel = k === app.menu, yy = y + k * 72 * u, w = 460 * u, h = 58 * u;
      menuBox.push({ x: x - w / 2, y: yy - h / 2, w, h, i: k, tower: it === 'tower' });
      if (sel) {
        g.fillStyle = 'rgba(255,210,74,0.16)'; g.beginPath(); g.roundRect(x - w / 2, yy - h / 2, w, h, h / 2); g.fill();
        g.strokeStyle = css(rgb(GOLD), 0.5 + Math.sin(t * 5) * 0.25); g.lineWidth = 2 * u; g.stroke();
      }
      const text = it === 'play' ? 'PLAY' : it === 'exit' ? 'EXIT' : `◀  TOWER ${app.pick + 1}  ▶`;
      label(text, x, yy + 13 * u, 34, sel ? GOLD : DIM, { font: HEAD, align: 'center', spacing: 3 });
      if (it === 'tower') label(app.towers[app.pick].name.toUpperCase(), x, yy + 44 * u, 18, DIM, { align: 'center', spacing: 2 });
    });
  }
  function howTo(app, x0, y0, w, t) {
    label('HOW TO CLIMB', x0 + w / 2, y0 + 52 * u, 30, GOLD, { font: HEAD, align: 'center', spacing: 2 });
    const rows = [
      ['clink', 'CLINK', 'Walk round the tower, jump the gaps'],
      ['door', 'DOORWAYS', 'Push up: a tunnel to the far side'],
      ['urchin', `URCHIN  ${SCORE.urchin}`, 'Bubble it, or jump it'],
      ['jelly', `JELLYFISH  ${SCORE.jelly}`, 'A bubble stuns it a while'],
      ['crab', `DOOR CRAB  ${SCORE.crab}`, 'Bubbles push it off its ledge'],
      ['squall', 'SQUALL', 'Can’t be stopped: jump it'],
    ];
    rows.forEach(([icon, a, b], k) => {
      const y = y0 + 112 * u + k * 60 * u, ix = x0 + 70 * u;
      if (icon === 'clink') drawClink(g, ix, y + 14 * u, 1, 58 * u, { t, walk: t * 1.5 });
      else if (icon === 'urchin') drawUrchin(g, ix, y + 14 * u, 52 * u, t, t * 3);
      else if (icon === 'jelly') drawJelly(g, ix, y + 18 * u, 52 * u, t, false);
      else if (icon === 'crab') drawCrab(g, ix, y + 16 * u, 52 * u, t, 1, 0);
      else if (icon === 'squall') drawSquall(g, ix, y - 6 * u, 44 * u, t, 1);
      else { g.fillStyle = '#0a1020'; g.beginPath(); g.roundRect(ix - 16 * u, y - 30 * u, 32 * u, 44 * u, [16 * u, 16 * u, 2 * u, 2 * u]); g.fill(); g.strokeStyle = '#ffd24a'; g.lineWidth = 3 * u; g.stroke(); }
      label(a, x0 + 130 * u, y, 24, INK, { font: HEAD, spacing: 1 });
      label(b, x0 + 390 * u, y, 21, DIM, { wgt: 700 });
    });
    label('Ledges that crack, blink or slip · lifts · a clock', x0 + w / 2, y0 + 490 * u, 20, DIM, { align: 'center' });
  }
  function scores(app, x0, y0, w, t) {
    label('BEST CLIMBERS', x0 + w / 2, y0 + 52 * u, 30, GOLD, { font: HEAD, align: 'center', spacing: 2 });
    app.save.table.forEach((e, k) => {
      const y = y0 + 110 * u + k * 46 * u, hl = k === app.rank, col = hl ? (Math.floor(t * 4) % 2 ? GOLD : INK) : INK;
      label(`${k + 1}`, x0 + w * 0.2, y, 22, DIM, { align: 'right' });
      label(e.n, x0 + w * 0.26, y, 26, col, { font: HEAD, spacing: 3 });
      label(pad6(e.s), x0 + w * 0.66, y, 26, col, { align: 'right', spacing: 1 });
      label(`TOWER ${e.t}`, x0 + w * 0.84, y, 20, DIM, { align: 'right', spacing: 1 });
    });
  }
  function drawTitle(app, t) {
    const sim = app.sim;
    useTheme(sim.T.theme);
    V = { th: (t * 0.55) % COLS, y: 9 + Math.sin(t * 0.15) * 6, sink: 0 };
    drawBackdrop(t);
    g.save(); g.translate(-cw * 0.22, 0);
    drawTower(sim.s, sim.T, t, { hideHero: true });
    g.restore();
    drawWeather(t, 1 / 60);
    shade(0.25);
    logo(cw * 0.3, 210 * u, 170, t);
    label('CLIMB  ·  TURN  ·  WIND IT DOWN', cw * 0.3, 270 * u, 24, INK, { align: 'center', spacing: 5, shadow: true });
    drawMenu(app, cw * 0.3, 760 * u, t);
    const pw = 860 * u, px = cw * 0.53, py = 140 * u, ph = 560 * u;
    glass(px, py, pw, ph, 24, 0.62);
    if (app.page === 0) howTo(app, px, py, pw, t); else scores(app, px, py, pw, t);
    legend(app.input, [[['walk', 'Walk'], ['jump', 'Jump'], ['fire', 'Bubble'], ['enter', 'Doorway'], ['sound', app.soundOn ? 'Sound on' : 'Sound off']]], px + pw / 2, 770 * u, 22);
    prompt(app.input, '{start} Play', px + pw / 2, 850 * u, 26, Math.floor(t * 2) % 2 ? GOLD : INK);
  }
  function drawEntry(app, t) {
    const sim = app.sim;
    useTheme(sim.T.theme);
    V = { th: (t * 0.4) % COLS, y: 6, sink: 0 };
    drawBackdrop(t);
    drawTower(sim.s, sim.T, t, { hideHero: true });
    shade(0.6);
    logo(cw / 2, 200 * u, 120, t);
    const pw = 860 * u, px = cw / 2 - pw / 2;
    glass(px, 290 * u, pw, 560 * u, 24, 0.7);
    label('A NEW BEST CLIMBER', cw / 2, 370 * u, 40, GOLD, { font: HEAD, align: 'center', spacing: 2 });
    label(`SCORE ${pad6(sim.s.score)}   ·   TOWER ${sim.s.reached + 1}`, cw / 2, 430 * u, 28, INK, { align: 'center', spacing: 2 });
    label('ENTER YOUR INITIALS', cw / 2, 500 * u, 24, DIM, { align: 'center', spacing: 3 });
    const E = app.entry;
    for (let k = 0; k < 3; k++) {
      const x = cw / 2 + (k - 1) * 150 * u, sel = k === E.pos;
      g.fillStyle = sel ? 'rgba(255,210,74,0.18)' : 'rgba(255,255,255,0.06)';
      g.beginPath(); g.roundRect(x - 58 * u, 540 * u, 116 * u, 150 * u, 18 * u); g.fill();
      if (sel) { g.strokeStyle = css(rgb(GOLD), 0.6 + Math.sin(t * 6) * 0.3); g.lineWidth = 3 * u; g.stroke(); }
      label(LETTERS[E.letters[k]], x, 650 * u, 96, sel ? GOLD : INK, { font: HEAD, align: 'center' });
    }
    prompt(app.input, '{letters} Letters    {jump} Next    {start} Done', cw / 2, 780 * u, 24, DIM);
  }

  // ---------- frame ----------
  let lastT = performance.now();
  function draw(app) {
    lastApp = app;
    const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    stepFx(dt);
    const t = app.t, sim = app.sim, s = sim.s;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (app.state === 'title') drawTitle(app, t);
    else if (app.state === 'entry') drawEntry(app, t);
    else if (s.status === 'bonus') { useTheme(sim.T.theme); drawBonus(app, t); }
    else {
      useTheme(sim.T.theme);
      bonusMap = null;
      V = { th: s.cam.th, y: s.cam.y, sink: s.sinkY };
      const sx = shake > 0 ? (rand() - 0.5) * shake * 30 * u : 0, sy = shake > 0 ? (rand() - 0.5) * shake * 30 * u : 0;
      g.save(); g.translate(sx, sy);
      drawBackdrop(t);
      drawTower(s, sim.T, t);
      drawWeather(t, dt);
      g.restore();
      drawHud(app, t);
      drawBanners(app, t);
      if (app.state === 'pause') {
        shade(0.55);
        label('PAUSED', cw / 2, ch * 0.46, 90, INK, { font: HEAD, align: 'center', spacing: 4 });
        prompt(app.input, '{pause} Play on      {quit} Quit', cw / 2, ch * 0.56, 26, DIM);
      }
      drawTouch(app);
    }
    if (s?.status === 'bonus' && app.state === 'pause') { shade(0.55); label('PAUSED', cw / 2, ch * 0.46, 90, INK, { font: HEAD, align: 'center', spacing: 4 }); }
    g.drawImage(vign, 0, 0);
    if (flash > 0) { g.fillStyle = `rgba(${flashCol},${flash * 0.9})`; g.fillRect(0, 0, cw, ch); }
    if (app.fade > 0) { g.fillStyle = `rgba(2,6,16,${app.fade})`; g.fillRect(0, 0, cw, ch); }
  }
  /** what a tap at (x, y) on the title picks: { i } a menu item, { i, d } the tower arrows */
  function menuAt(x, y) {
    const b = menuBox.find(m => x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h);
    if (!b) return null;
    if (b.tower) { const rel = (x - b.x) / b.w; return { i: b.i, d: rel < 0.25 ? -1 : rel > 0.75 ? 1 : 0 }; }
    return { i: b.i, d: 0 };
  }
  function destroy() { destroyed = true; unfit(); }
  void colOf;
  return { draw, events, menuAt, destroy };
}
