// The look of the seven scenes: one theme each (sky, ink-wash ridges, the middle distance, the
// floor, lanterns, the light on the figures, the weather), going from the sunset path through
// the Keep's lantern-lit night to dawn. The static layers are painted once per theme and size
// into offscreen strips that tile sideways, so a frame only blits them at their parallax and
// adds what moves: flickering lantern glow, braziers, mist and the drifting embers and ash.
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---------- colour ----------
const cache = new Map();
// '#rrggbb', or the 'rgba(r,g,b,a)' that mix() returns, so a mix can be mixed again
export function rgb(col) {
  let c = cache.get(col);
  if (!c) {
    if (col[0] === '#') { const n = parseInt(col.slice(1), 16); c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    else c = col.slice(col.indexOf('(') + 1).split(',', 3).map(Number);
    cache.set(col, c);
  }
  return c;
}
export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const mix = (h1, h2, t, a = 1) => { const p = rgb(h1), q = rgb(h2), k = clamp(t, 0, 1); return css([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k], a); };
export const alpha = (col, a) => css(rgb(col), a);
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ---------- themes ----------
// light: which side the key light comes from (−1 left, 1 right), key: its colour on the
// figures' lit edges; amb/ambK: the tint over every figure; shade: their far sides
export const THEMES = {
  dusk: {
    sky: ['#2b1d3f', '#b14c5a', '#f7a25e'], body: { sun: true, x: 0.74, y: 0.55, r: 0.075, c: '#ffd690' }, stars: 0.15,
    ridges: ['#a0667a', '#6e4566', '#432a48'], mist: '#f4a474', hz: 0.66, mid: 'pines',
    ground: ['#5a3a32', '#1e1414'], floor: 'path', lamps: { kind: 'stone', every: 11, c: '#ffb060' },
    light: 1, key: '#ffbd7a', amb: '#6a3048', ambK: 0.16, shade: '#1a1020', weather: { embers: 26, ash: 22 }, fog: '#f0a078',
  },
  gate: {
    sky: ['#141230', '#46284e', '#b4525a'], body: { x: 0.22, y: 0.24, r: 0.035, c: '#f6e8d2' }, stars: 0.45,
    ridges: ['#6a4262', '#432a48', '#2a1a30'], mist: '#c06070', hz: 0.6, mid: 'wall',
    ground: ['#3e3438', '#141014'], floor: 'stone', lamps: { kind: 'hang', every: 7, c: '#ff9a4a' },
    light: -1, key: '#ff9e6a', amb: '#3a2448', ambK: 0.22, shade: '#0e0a14', weather: { embers: 40, ash: 30 }, fog: '#a05068',
  },
  court: {
    sky: ['#080a1a', '#15183a', '#2c2a50'], body: { x: 0.8, y: 0.17, r: 0.04, c: '#f2ead8' }, stars: 0.9,
    ridges: ['#262a4c', '#1a1c38'], mist: '#3a3a64', hz: 0.48, mid: 'court',
    ground: ['#403834', '#16120f'], floor: 'gravel', lamps: { kind: 'hang', every: 5, c: '#ffae58' },
    light: -1, key: '#ffb070', amb: '#1c2048', ambK: 0.26, shade: '#080a18', weather: { embers: 24, ash: 14 }, fog: '#40406a',
  },
  hall: {
    indoor: true, sky: ['#100a08', '#22150e', '#2e1c12'], window: ['#10183a', '#2a3a6a'], stars: 0.5,
    ridges: ['#1e2850'], mist: '#3a4670', hz: 0.5, mid: 'hall',
    ground: ['#563420', '#1a0e08'], floor: 'wood', shine: true, lamps: { kind: 'hang', every: 6, c: '#ffb050' },
    light: -1, key: '#ffb060', amb: '#3a2010', ambK: 0.24, shade: '#0a0604', weather: { embers: 14, ash: 10 }, fog: '#3a2414',
  },
  stair: {
    indoor: true, sky: ['#121622', '#1c2230', '#262c3a'], window: ['#0c1230', '#2a3666'], stars: 0.7,
    ridges: ['#1a2248'], mist: '#3a4670', hz: 0.55, mid: 'stair',
    ground: ['#4a4c54', '#16171c'], floor: 'steps', lamps: { kind: 'hang', every: 7, c: '#ffbc70' },
    light: 1, key: '#ffc080', amb: '#1c2236', ambK: 0.26, shade: '#080a12', weather: { embers: 14, ash: 26 }, fog: '#2a3044',
  },
  throne: {
    indoor: true, sky: ['#140505', '#280b07', '#3a120a'], window: null, stars: 0,
    ridges: [], mist: '#5a1a10', hz: 0.5, mid: 'throne',
    ground: ['#241212', '#050303'], floor: 'lacquer', shine: true, lamps: { kind: 'brazier', every: 8, c: '#ff7a30' },
    light: -1, key: '#ff8a40', amb: '#4a1008', ambK: 0.26, shade: '#0a0202', weather: { embers: 70, ash: 18 }, fog: '#4a1208',
  },
  garden: {
    sky: ['#3a4a7e', '#c48aa2', '#ffd6a2'], body: { sun: true, x: 0.8, y: 0.6, r: 0.08, c: '#fff2c4' }, stars: 0.1,
    ridges: ['#b0a8c8', '#8a88b0', '#646890'], mist: '#ffdcc8', hz: 0.64, mid: 'garden',
    ground: ['#56663e', '#1e2618'], floor: 'grass', lamps: { kind: 'stone', every: 13, c: null },
    light: 1, key: '#ffe0b0', amb: '#9a7a9a', ambK: 0.1, shade: '#2a2030', weather: { embers: 4, ash: 8, petals: 26 }, fog: '#ffe2d0',
  },
};

// ---------- the painted layers ----------
// strips tile sideways: anything near an edge is painted again one strip-width over
function tiled(W, fn) { for (const o of [-W, 0, W]) fn(o); }
// a ridge line that wraps at W: whole sine periods plus a little hashed roughness
// a ridge's skyline: its height at x
function ridgeY(W, base, amp, seed) {
  const ks = [1, 2, 3, 5, 8].map((k, i) => [k, hash(seed, i) * TAU, 1 / (i + 1.2)]);
  return x => { let s = 0; for (const [k, ph, a] of ks) s += Math.sin((x / W) * TAU * k + ph) * a; return base - amp * (0.55 + 0.32 * s) - hash(seed, Math.round(x / 9) % Math.round(W / 9)) * amp * 0.05; };
}
function ridge(c, W, H, base, amp, seed, col, mist) {
  const y = ridgeY(W, base, amp, seed);
  c.beginPath(); c.moveTo(0, H);
  for (let x = 0; x <= W; x += 6) c.lineTo(x, y(x));
  c.lineTo(W, H); c.closePath();
  const gr = c.createLinearGradient(0, base - amp, 0, base + amp * 0.2);
  gr.addColorStop(0, col); gr.addColorStop(1, mix(col, mist, 0.55));
  c.fillStyle = gr; c.fill();
  // brushed light on the slopes facing the sky
  c.strokeStyle = alpha(mist, 0.12); c.lineWidth = 2;
  c.beginPath(); for (let x = 0; x <= W; x += 6) { const yy = y(x) + 3; if (x) c.lineTo(x, yy); else c.moveTo(x, yy); } c.stroke();
  return y;
}
function mistBand(c, W, y, h, col, a) {
  const gr = c.createLinearGradient(0, y - h, 0, y + h);
  gr.addColorStop(0, alpha(col, 0)); gr.addColorStop(0.5, alpha(col, a)); gr.addColorStop(1, alpha(col, 0));
  c.fillStyle = gr; c.fillRect(0, y - h, W, h * 2);
}
// an upturned roof over (x, y): width w, height h
function roof(c, x, y, w, h, col, edge) {
  c.fillStyle = col;
  c.beginPath(); c.moveTo(x - w * 0.62, y - h * 0.15);
  c.quadraticCurveTo(x - w * 0.45, y - h * 0.05, x - w * 0.32, y - h * 0.7);
  c.lineTo(x + w * 0.32, y - h * 0.7);
  c.quadraticCurveTo(x + w * 0.45, y - h * 0.05, x + w * 0.62, y - h * 0.15);
  c.lineTo(x + w * 0.5, y); c.lineTo(x - w * 0.5, y); c.closePath(); c.fill();
  if (edge) { c.strokeStyle = edge; c.lineWidth = Math.max(1, h * 0.06); c.beginPath(); c.moveTo(x - w * 0.6, y - h * 0.15); c.quadraticCurveTo(x - w * 0.45, y - h * 0.05, x - w * 0.32, y - h * 0.7); c.stroke(); }
}
// the Keep on its crag: tiers of roofs with lit windows. The crag runs down to `foot`, so the
// ridge painted over it afterwards hides where it meets the mountains
function keep(c, x, base, s, col, lit, foot) {
  c.fillStyle = col;
  c.beginPath(); c.moveTo(x - s * 2.4, foot); for (let k = 0; k <= 10; k++) { const q = k / 10, xx = x - s * 2.4 + q * s * 4.6, hh = Math.sin(q * Math.PI) ** 0.6 * s * 1.35 * (0.85 + hash(k, 77) * 0.3); c.lineTo(xx, base - hh); } c.lineTo(x + s * 2.2, foot); c.fill();
  let y = base - s * 1.3, w = s * 1.4;
  for (let i = 0; i < 4; i++) {
    const h = s * (0.55 - i * 0.06);
    c.fillStyle = col; c.fillRect(x - w * 0.38, y - h, w * 0.76, h);
    c.fillStyle = lit; for (let k = 0; k < 3; k++) c.fillRect(x - w * 0.26 + k * w * 0.22, y - h * 0.7, w * 0.08, h * 0.35);
    roof(c, x, y - h, w, s * 0.4, col);
    y -= h + s * 0.25; w *= 0.78;
  }
  c.fillStyle = col; c.fillRect(x - s * 0.03, y - s * 0.5, s * 0.06, s * 0.5);
}
function pine(c, x, base, h, col, seed) {
  // a leaning trunk and flat pads of needles, each pad a cluster of soft lobes (ink-wash pines)
  const lean = (hash(seed, 1) - 0.5) * h * 0.25, top = [x + lean, base - h];
  c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round';
  c.lineWidth = h * 0.035; c.beginPath(); c.moveTo(x, base); c.quadraticCurveTo(x + lean * 0.2 + h * 0.05 * (hash(seed, 2) - 0.5), base - h * 0.55, top[0], top[1]); c.stroke();
  for (let i = 0; i < 5; i++) {
    const q = 0.42 + i * 0.13, yy = base - h * q, xx = x + lean * q * q, w = h * (0.36 - i * 0.055) * (0.75 + hash(seed, i + 9) * 0.5), side = i % 2 ? 1 : -1, cx = xx + side * w * 0.3;
    c.lineWidth = h * 0.012; c.beginPath(); c.moveTo(xx, yy + h * 0.02); c.lineTo(cx, yy); c.stroke();
    for (let j = 0; j < 4; j++) { const lx = cx + (j - 1.5) * w * 0.28, r = w * (0.2 + hash(seed + j, i) * 0.1); c.beginPath(); c.ellipse(lx, yy - r * 0.2, r, r * 0.38, 0, Math.PI, 0); c.fill(); }
  }
  c.lineCap = 'butt';
}
function lattice(c, x, y, w, h, frame, light) {
  const gr = c.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, light[0]); gr.addColorStop(1, light[1]);
  c.fillStyle = gr; c.fillRect(x, y, w, h);
  c.strokeStyle = frame; c.lineWidth = Math.max(2, w * 0.03);
  c.beginPath();
  for (let k = 1; k < 4; k++) { c.moveTo(x + (w * k) / 4, y); c.lineTo(x + (w * k) / 4, y + h); }
  for (let k = 1; k < 6; k++) { c.moveTo(x, y + (h * k) / 6); c.lineTo(x + w, y + (h * k) / 6); }
  c.stroke();
  c.lineWidth = Math.max(4, w * 0.08); c.strokeRect(x, y, w, h);
}
function blossomTree(c, x, base, h, trunk, bloom, seed) {
  c.strokeStyle = trunk; c.lineCap = 'round';
  const branch = (x0, y0, a, len, w, d) => {
    const x1 = x0 + Math.cos(a) * len, y1 = y0 - Math.sin(a) * len;
    c.lineWidth = w; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2 + len * 0.15 * (hash(seed, d * 7 + (x0 | 0)) - 0.5), (y0 + y1) / 2, x1, y1); c.stroke();
    if (d > 0) { branch(x1, y1, a + 0.45 + hash(seed, d) * 0.3, len * 0.68, w * 0.62, d - 1); branch(x1, y1, a - 0.5 - hash(seed, d + 3) * 0.3, len * 0.66, w * 0.6, d - 1); }
    else for (let k = 0; k < 5; k++) { c.fillStyle = bloom[k % bloom.length]; c.beginPath(); c.arc(x1 + (hash(seed + k, x1 | 0) - 0.5) * len, y1 + (hash(seed + k, y1 | 0) - 0.5) * len * 0.6, len * (0.18 + hash(k, seed) * 0.14), 0, TAU); c.fill(); }
  };
  branch(x, base, Math.PI / 2 + (hash(seed, 0) - 0.5) * 0.4, h * 0.42, h * 0.06, 4);
  c.lineCap = 'butt';
}

/**
 * Paint a theme at a canvas size. Returns the layers and the numbers the frame needs.
 * P: pixels per metre, GY: the ground line.
 */
export function buildLayers(name, cw, ch, P, GY) {
  const th = THEMES[name] ?? THEMES.dusk, u = ch / 1080;
  const L = { th, name };
  // the sky (or the far wall) and its sun or moon
  L.sky = canvas(cw, ch);
  {
    const c = L.sky.getContext('2d', { alpha: false }), gr = c.createLinearGradient(0, 0, 0, GY);
    gr.addColorStop(0, th.sky[0]); gr.addColorStop(0.62, th.sky[1]); gr.addColorStop(1, th.sky[2]);
    c.fillStyle = gr; c.fillRect(0, 0, cw, ch);
    if (!th.indoor && th.stars) for (let i = 0; i < 220; i++) {
      const x = hash(i, 1) * cw, y = hash(i, 2) ** 1.7 * ch * 0.5;
      c.fillStyle = `rgba(255,248,235,${(0.2 + hash(i, 4) * 0.7) * th.stars * (1 - y / (ch * 0.5))})`; c.fillRect(x, y, (1 + hash(i, 3) * 1.6) * u, (1 + hash(i, 3) * 1.6) * u);
    }
    const B = th.body;
    if (B) {
      const bx = B.x * cw, by = B.y * ch, br = B.r * ch;
      const gl = c.createRadialGradient(bx, by, br * 0.6, bx, by, br * (B.sun ? 7 : 5));
      gl.addColorStop(0, alpha(B.c, B.sun ? 0.55 : 0.35)); gl.addColorStop(1, alpha(B.c, 0));
      c.fillStyle = gl; c.fillRect(0, 0, cw, ch);
      c.fillStyle = B.c; c.beginPath(); c.arc(bx, by, br, 0, TAU); c.fill();
      if (!B.sun) { c.fillStyle = 'rgba(150,140,170,0.25)'; for (const [dx, dy, r] of [[-0.3, -0.2, 0.22], [0.25, 0.3, 0.16], [0.35, -0.25, 0.1]]) { c.beginPath(); c.arc(bx + dx * br, by + dy * br, r * br, 0, TAU); c.fill(); } }
      else { // thin cloud bars across the low sun
        c.fillStyle = alpha(th.sky[1], 0.55);
        for (let k = 0; k < 4; k++) { const yy = by - br * 0.6 + k * br * 0.45, w = br * (2.4 + hash(k, 9) * 3); c.beginPath(); c.ellipse(bx + (hash(k, 8) - 0.5) * br * 2, yy, w, br * 0.06, 0, 0, TAU); c.fill(); }
      }
    }
    if (th.indoor) { // the far wall's panels
      c.fillStyle = 'rgba(0,0,0,0.18)';
      for (let x = 0; x < cw; x += 180 * u) c.fillRect(x, 0, 6 * u, GY);
    }
    // the vignette, baked in: darker toward the corners
    const vg = c.createRadialGradient(cw / 2, ch * 0.55, ch * 0.35, cw / 2, ch * 0.5, cw * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(8,2,0,0.45)');
    c.fillStyle = vg; c.fillRect(0, 0, cw, ch);
  }
  // the far strip: ink-wash ridges (outside) or the lattice windows on the back wall (inside)
  const W = Math.round(cw * 1.25);
  L.W = W;
  L.farTop = Math.round(ch * 0.12); const FH = Math.round(GY - L.farTop);
  L.far = canvas(W, FH);
  {
    const c = L.far.getContext('2d'), hz = th.hz * ch - L.farTop;
    if (!th.indoor) {
      th.ridges.forEach((col, i) => {
        const n = th.ridges.length, base = hz + i * FH * 0.06, amp = FH * (0.42 - i * 0.09) * (th.mid === 'court' ? 0.45 : 1);
        if (i === 0 && th.mid === 'pines') {
          // behind the far ridge, sunk so only the crag's crown shows above it
          const s = 52 * u, xk = W * 0.62, y = ridgeY(W, base, amp, 11);
          let low = 0; for (let x = xk - s * 2.4; x <= xk + s * 2.2; x += 6) low = Math.max(low, y(x));
          keep(c, xk, Math.min(low, y(xk) + s * 0.95), s, mix(col, '#000000', 0.15), '#ffcf7a', FH);
        }
        ridge(c, W, FH, base, amp, 11 + i * 7, col, th.mist);
        mistBand(c, W, base + FH * 0.02, FH * 0.05, th.mist, 0.35 - i * 0.06);
        void n;
      });
    } else if (th.window) {
      // windows onto the night: a slice of sky, a moon and a ridge in each
      for (let k = 0; k < 4; k++) {
        const x = ((k + 0.5) / 4) * W, w = 150 * u, h = (th.mid === 'stair' ? 380 : 300) * u, y = FH * 0.18;
        const win = canvas(w, h), wc = win.getContext('2d');
        const gr = wc.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, th.window[0]); gr.addColorStop(1, th.window[1]); wc.fillStyle = gr; wc.fillRect(0, 0, w, h);
        for (let i = 0; i < 20; i++) { wc.fillStyle = `rgba(255,255,255,${0.3 + hash(i, k) * 0.5})`; wc.fillRect(hash(i, k + 5) * w, hash(i, k + 9) * h * 0.6, 2 * u, 2 * u); }
        if (k === 1) { wc.fillStyle = '#f2ead8'; wc.beginPath(); wc.arc(w * 0.6, h * 0.25, 22 * u, 0, TAU); wc.fill(); }
        ridge(wc, w, h, h * 0.92, h * 0.25, 40 + k, th.ridges[0], th.mist);
        c.save();
        c.beginPath();
        if (th.mid === 'stair') { c.moveTo(x - w / 2, y + h); c.lineTo(x - w / 2, y + w / 2); c.arc(x, y + w / 2, w / 2, Math.PI, 0); c.lineTo(x + w / 2, y + h); c.closePath(); }
        else c.rect(x - w / 2, y, w, h);
        c.clip(); c.drawImage(win, x - w / 2, y); c.restore();
        // the lattice over it
        c.strokeStyle = th.mid === 'stair' ? '#20242e' : '#1a100a'; c.lineWidth = 5 * u;
        c.beginPath();
        for (let j = 1; j < 4; j++) { c.moveTo(x - w / 2 + (w * j) / 4, y + (th.mid === 'stair' ? w * 0.2 : 0)); c.lineTo(x - w / 2 + (w * j) / 4, y + h); }
        for (let j = 1; j < 6; j++) { c.moveTo(x - w / 2, y + (h * j) / 6); c.lineTo(x + w / 2, y + (h * j) / 6); }
        c.stroke(); c.lineWidth = 12 * u; if (th.mid !== 'stair') c.strokeRect(x - w / 2, y, w, h);
        // moonlight falling from it
        const sh = c.createLinearGradient(0, y, 0, FH);
        sh.addColorStop(0, 'rgba(150,170,230,0.10)'); sh.addColorStop(1, 'rgba(150,170,230,0)');
        c.fillStyle = sh; c.beginPath(); c.moveTo(x - w / 2, y + h); c.lineTo(x + w / 2, y + h); c.lineTo(x + w * 1.1, FH); c.lineTo(x - w * 0.1, FH); c.fill();
      }
      // a wainscot along the floor
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, FH * 0.82, W, FH * 0.18);
      c.fillStyle = 'rgba(255,200,140,0.06)'; c.fillRect(0, FH * 0.82, W, 3 * u);
    } else {
      // the Regent's back wall: hanging ember banners between dark panels
      for (let k = 0; k < 6; k++) {
        const x = ((k + 0.5) / 6) * W, w = 90 * u, y = FH * 0.05, h = FH * 0.62;
        c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x - w * 0.8, 0, w * 1.6, FH);
        c.fillStyle = '#6a140c'; c.beginPath(); c.moveTo(x - w / 2, y); c.lineTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.lineTo(x, y + h - w * 0.4); c.lineTo(x - w / 2, y + h); c.fill();
        c.strokeStyle = '#c8902c'; c.lineWidth = 3 * u; c.stroke();
        // a flame mark woven in it (the Keep's own)
        c.fillStyle = '#d89a30'; c.beginPath(); c.moveTo(x, y + h * 0.25); c.quadraticCurveTo(x + w * 0.28, y + h * 0.42, x, y + h * 0.55); c.quadraticCurveTo(x - w * 0.28, y + h * 0.42, x, y + h * 0.25); c.fill();
        c.fillStyle = '#6a140c'; c.beginPath(); c.arc(x, y + h * 0.48, w * 0.08, 0, TAU); c.fill();
        c.fillStyle = '#2a0a06'; c.fillRect(x - w * 0.7, y - 10 * u, w * 1.4, 10 * u);
      }
    }
  }
  // the middle distance
  L.midTop = Math.round(ch * 0.04); const MH = Math.round(GY - L.midTop + 2);
  L.mid = canvas(W, MH);
  {
    const c = L.mid.getContext('2d'), base = MH - 2, ink = mix(th.ridges.at(-1) ?? '#000000', '#000000', 0.45);
    const lit = '#ffcf80';
    switch (th.mid) {
      case 'pines': {
        ridge(c, W, MH, base - 10 * u, 120 * u, 77, mix(ink, th.mist, 0.15), th.mist);
        for (let i = 0; i < 7; i++) tiled(W, o => pine(c, o + hash(i, 61) * W, base - 40 * u * hash(i, 62), (170 + hash(i, 63) * 190) * u, mix(ink, th.mist, 0.12 + hash(i, 64) * 0.22), i));
        mistBand(c, W, base - 30 * u, 60 * u, th.mist, 0.25);
        break;
      }
      case 'wall': {
        // the Keep's outer wall, its towers and the gatehouse over the Ash Gate
        const wall = mix(ink, th.sky[1], 0.12), top = base - 330 * u;
        c.fillStyle = wall; c.fillRect(0, top, W, MH - top);
        c.fillStyle = mix(wall, '#000000', 0.25);
        for (let y = top + 30 * u; y < base; y += 34 * u) for (let x = ((y / (34 * u)) % 2) * 40 * u; x < W; x += 80 * u) c.fillRect(x, y, 3 * u, 34 * u);
        for (let y = top + 30 * u; y < base; y += 34 * u) c.fillRect(0, y, W, 2 * u);
        for (let x = 0; x < W; x += 46 * u) c.fillRect(x, top - 26 * u, 30 * u, 26 * u);
        for (let k = 0; k < 3; k++) tiled(W, o => {
          const x = o + ((k + 0.3) / 3) * W, w = 220 * u, tt = top - 180 * u;
          c.fillStyle = mix(wall, '#000000', 0.1); c.fillRect(x - w / 2, tt, w, base - tt);
          c.fillStyle = lit; c.fillRect(x - 18 * u, tt + 60 * u, 36 * u, 50 * u);
          roof(c, x, tt, w * 1.3, 120 * u, mix(wall, '#000000', 0.35));
          roof(c, x, tt - 100 * u, w * 0.8, 90 * u, mix(wall, '#000000', 0.35));
        });
        mistBand(c, W, base - 10 * u, 50 * u, th.mist, 0.3);
        break;
      }
      case 'court': {
        // halls round the court: plastered walls, paper windows lit from inside, curved roofs
        for (let k = 0; k < 4; k++) tiled(W, o => {
          const x = o + ((k + 0.5) / 4) * W, w = (460 + hash(k, 5) * 160) * u, h = (220 + hash(k, 6) * 120) * u, y = base - h;
          c.fillStyle = mix(ink, '#3a3450', 0.5); c.fillRect(x - w / 2, y, w, h);
          for (let j = 0; j < 4; j++) lattice(c, x - w / 2 + w * (0.08 + j * 0.23), y + h * 0.25, w * 0.16, h * 0.5, mix(ink, '#000000', 0.3), ['#ffd890', '#e8903a']);
          roof(c, x, y, w * 1.25, 140 * u, mix(ink, '#000000', 0.25), 'rgba(255,200,140,0.15)');
          roof(c, x, y - 110 * u, w * 0.6, 90 * u, mix(ink, '#000000', 0.25));
        });
        // strings of lanterns across the court
        for (let k = 0; k < 3; k++) {
          const x0 = (k / 3) * W, x1 = x0 + W / 3, y0 = base - 420 * u;
          c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 2 * u; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, y0 + 80 * u, x1, y0); c.stroke();
          for (let j = 1; j < 6; j++) { const q = j / 6, x = x0 + (x1 - x0) * q, y = y0 + 4 * q * (1 - q) * 40 * u; c.fillStyle = 'rgba(255,170,80,0.25)'; c.beginPath(); c.arc(x, y + 14 * u, 24 * u, 0, TAU); c.fill(); c.fillStyle = '#ff9a40'; c.beginPath(); c.ellipse(x, y + 14 * u, 9 * u, 12 * u, 0, 0, TAU); c.fill(); }
        }
        break;
      }
      case 'hall': case 'stair': {
        const wood = th.mid === 'hall' ? '#3a1a10' : '#2a2e3a';
        if (th.mid === 'stair') {
          // the stair climbing behind, and the great bell on its beam
          c.fillStyle = '#1e222c';
          c.beginPath(); c.moveTo(0, base); for (let k = 0; k <= 14; k++) { const x = (k / 14) * W * 0.5, y = base - k * 38 * u; c.lineTo(x, y); c.lineTo(x + W / 28, y); } c.lineTo(W * 0.5, base); c.fill();
          c.beginPath(); c.moveTo(W, base); for (let k = 0; k <= 14; k++) { const x = W - (k / 14) * W * 0.4, y = base - k * 38 * u; c.lineTo(x, y); c.lineTo(x - W / 35, y); } c.lineTo(W * 0.6, base); c.fill();
          const bx = W * 0.55, by = base - 640 * u;
          c.fillStyle = '#1a140e'; c.fillRect(bx - 260 * u, by - 30 * u, 520 * u, 34 * u);
          c.fillStyle = '#4a3a20'; c.fillRect(bx - 6 * u, by, 12 * u, 50 * u);
          const bg = c.createLinearGradient(bx - 110 * u, 0, bx + 110 * u, 0);
          bg.addColorStop(0, '#2a2416'); bg.addColorStop(0.35, '#8a6a34'); bg.addColorStop(0.5, '#b08848'); bg.addColorStop(1, '#2a2014');
          c.fillStyle = bg; c.beginPath(); c.moveTo(bx - 60 * u, by + 50 * u); c.quadraticCurveTo(bx - 80 * u, by + 220 * u, bx - 120 * u, by + 300 * u); c.lineTo(bx + 120 * u, by + 300 * u); c.quadraticCurveTo(bx + 80 * u, by + 220 * u, bx + 60 * u, by + 50 * u); c.quadraticCurveTo(bx, by + 30 * u, bx - 60 * u, by + 50 * u); c.fill();
          c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 5 * u; for (const f of [0.35, 0.75]) { c.beginPath(); c.moveTo(bx - (60 + 55 * f) * u, by + (50 + 250 * f) * u); c.lineTo(bx + (60 + 55 * f) * u, by + (50 + 250 * f) * u); c.stroke(); }
        }
        // pillars and beams
        c.fillStyle = wood;
        c.fillRect(0, 0, W, 40 * u);
        for (let k = 0; k < 5; k++) tiled(W, o => {
          const x = o + ((k + 0.25) / 5) * W, w = 60 * u, gr = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
          gr.addColorStop(0, mix(wood, '#000000', 0.5)); gr.addColorStop(0.35, mix(wood, '#ffb070', 0.18)); gr.addColorStop(1, mix(wood, '#000000', 0.6));
          c.fillStyle = gr; c.fillRect(x - w / 2, 0, w, base);
          c.fillStyle = mix(wood, '#000000', 0.4); c.fillRect(x - w * 0.7, base - 26 * u, w * 1.4, 26 * u); c.fillRect(x - w * 0.7, 30 * u, w * 1.4, 22 * u);
        });
        break;
      }
      case 'throne': {
        // the dais and the empty throne at the far end, great pillars with gold bands
        const tx = W * 0.5, ty = base;
        c.fillStyle = '#1a0806'; c.fillRect(tx - 340 * u, ty - 60 * u, 680 * u, 60 * u); c.fillRect(tx - 260 * u, ty - 110 * u, 520 * u, 50 * u);
        c.fillStyle = '#2a0c08'; c.beginPath(); c.moveTo(tx - 110 * u, ty - 110 * u); c.lineTo(tx - 120 * u, ty - 420 * u); c.quadraticCurveTo(tx, ty - 500 * u, tx + 120 * u, ty - 420 * u); c.lineTo(tx + 110 * u, ty - 110 * u); c.fill();
        c.strokeStyle = '#a8742a'; c.lineWidth = 6 * u; c.stroke();
        for (let k = 0; k < 4; k++) tiled(W, o => {
          const x = o + ((k + 0.12) / 4) * W, w = 90 * u, gr = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
          gr.addColorStop(0, '#2a0604'); gr.addColorStop(0.4, '#8a1c10'); gr.addColorStop(1, '#1a0402');
          c.fillStyle = gr; c.fillRect(x - w / 2, 0, w, base);
          c.fillStyle = '#b8862e'; for (const y of [0.18, 0.5, 0.86]) c.fillRect(x - w * 0.55, base * y, w * 1.1, 12 * u);
        });
        break;
      }
      case 'garden': {
        ridge(c, W, MH, base - 30 * u, 90 * u, 91, mix(th.ridges.at(-1), th.mist, 0.3), th.mist);
        // the pavilion, plum trees in blossom, the pond's far bank
        const px = W * 0.3, py = base - 60 * u;
        c.fillStyle = '#4a3a4a'; c.fillRect(px - 120 * u, py - 160 * u, 14 * u, 160 * u); c.fillRect(px + 106 * u, py - 160 * u, 14 * u, 160 * u);
        roof(c, px, py - 160 * u, 380 * u, 120 * u, '#3a2c3a', 'rgba(255,220,200,0.3)');
        c.fillStyle = 'rgba(200,215,240,0.45)'; c.beginPath(); c.ellipse(W * 0.7, base - 20 * u, 360 * u, 28 * u, 0, 0, TAU); c.fill();
        for (let i = 0; i < 6; i++) tiled(W, o => blossomTree(c, o + hash(i, 71) * W, base - 10 * u, (260 + hash(i, 72) * 200) * u, '#3a2a30', ['#f6c4d4', '#ffe0ea', '#e898b4'], i));
        mistBand(c, W, base - 20 * u, 50 * u, th.mist, 0.35);
        break;
      }
    }
  }
  // light sprites: a soft glow, and a mist puff
  L.glow = canvas(256, 256);
  { const c = L.glow.getContext('2d'), gr = c.createRadialGradient(128, 128, 4, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 256, 256); }
  L.warm = tint(L.glow, th.lamps.c ?? '#ffffff');
  L.dust = tint(L.glow, mix(th.ground[0], '#e0d4c4', 0.6));
  L.mist = canvas(512, 128);
  { const c = L.mist.getContext('2d'), gr = c.createRadialGradient(256, 64, 4, 256, 64, 256); gr.addColorStop(0, alpha(th.fog, 0.5)); gr.addColorStop(1, alpha(th.fog, 0)); c.setTransform(1, 0, 0, 0.25, 0, 48); c.fillStyle = gr; c.fillRect(0, 0, 512, 512); }
  // the floor's gradient, from the walking line down
  L.floor = (g => { const gr = g.createLinearGradient(0, GY - 6 * u, 0, ch); gr.addColorStop(0, th.ground[0]); gr.addColorStop(1, th.ground[1]); return gr; });
  void P;
  return L;
}
function tint(src, col) {
  const c = canvas(src.width, src.height), x = c.getContext('2d');
  x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
  return c;
}

// ---------- the floor ----------
export function drawFloor(g, L, cw, ch, GY, P, cam, t) {
  const th = L.th, u = ch / 1080;
  g.fillStyle = L.floor(g); g.fillRect(0, GY - 6 * u, cw, ch - GY + 6 * u);
  const off = cam * P, vx = cw / 2;
  const line = (x0, y0, x1, y1) => { g.moveTo(x0, y0); g.lineTo(x1, y1); };
  g.lineWidth = 2 * u;
  switch (th.floor) {
    case 'wood': case 'lacquer': case 'stone': case 'steps': {
      // boards (or flags) running away from us: joints that fan out toward the viewer
      const step = th.floor === 'stone' ? 1.6 : th.floor === 'steps' ? 1.2 : 0.8;
      g.strokeStyle = th.floor === 'lacquer' ? 'rgba(255,120,60,0.08)' : 'rgba(0,0,0,0.28)';
      g.beginPath();
      const x0 = Math.floor((cam - cw / P) / step) * step;
      for (let x = x0; x < cam + cw / P; x += step) { const sx = vx + x * P - off; line(sx, GY, sx + (sx - vx) * 0.9, ch); }
      for (const f of th.floor === 'steps' ? [0.18, 0.45, 0.8] : [0.12, 0.3, 0.55, 0.85]) line(0, GY + (ch - GY) * f, cw, GY + (ch - GY) * f);
      g.stroke();
      if (th.floor === 'stone' || th.floor === 'steps') { g.strokeStyle = 'rgba(255,230,200,0.06)'; g.beginPath(); line(0, GY + 2 * u, cw, GY + 2 * u); g.stroke(); }
      break;
    }
    case 'path': case 'gravel': case 'grass': {
      // stones, pebbles or tufts scattered on the ground, fixed to the world
      const n = 40, span = cw / P + 4, base = Math.floor(cam - span / 2);
      for (let i = 0; i < n * (span / 12); i++) {
        const cell = base + Math.floor(i / (n / 12)), k = i % (n / 12), x = cell + hash(cell, k), d = hash(k, cell + 3);
        const sx = vx + (x - cam) * P * (1 + d * 0.9), sy = GY + (ch - GY) * d * d * 0.95 + 4 * u;
        if (sx < -40 * u || sx > cw + 40 * u) continue;
        const r = (3 + d * 12) * u * (0.6 + hash(cell, k + 7));
        if (th.floor === 'grass') { g.strokeStyle = `rgba(20,40,10,${0.25 + d * 0.3})`; g.beginPath(); line(sx, sy, sx - r * 0.3, sy - r * 1.6); line(sx, sy, sx + r * 0.4, sy - r * 1.3); g.stroke(); }
        else { g.fillStyle = `rgba(0,0,0,${0.12 + d * 0.18})`; g.beginPath(); g.ellipse(sx, sy, r, r * 0.4, 0, 0, TAU); g.fill(); g.fillStyle = `rgba(255,220,190,${0.04 + d * 0.04})`; g.beginPath(); g.ellipse(sx - r * 0.2, sy - r * 0.15, r * 0.6, r * 0.2, 0, 0, TAU); g.fill(); }
      }
      break;
    }
  }
  // the lip of the walking line
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, GY - 1 * u, cw, 3 * u);
  void t;
}

// ---------- lanterns, braziers and their light ----------
// world positions: every `every` metres, from 2 m
export function lampsIn(L, x0, x1) {
  const e = L.th.lamps.every, out = [];
  for (let k = Math.max(0, Math.floor((x0 - 2) / e)); 2 + k * e < x1; k++) out.push({ x: 2 + k * e + (hash(k, 5) - 0.5) * e * 0.3, k });
  return out;
}
export function flicker(t, k) { return 0.82 + 0.1 * Math.sin(t * 9.1 + k * 3) + 0.06 * Math.sin(t * 23.7 + k * 7) + 0.04 * Math.sin(t * 3.3 + k); }
/** one lamp at screen x on the floor line GY; s: px per metre */
export function drawLamp(g, L, sx, GY, s, t, k, u) {
  const th = L.th, kind = th.lamps.kind, col = th.lamps.c, f = flicker(t, k);
  let lx = sx, ly;
  if (kind === 'stone') {
    // a stone lantern: foot, post, fire box and a curved cap
    const st = mix(th.ground[0], '#000000', 0.25), lt = mix(st, th.key, 0.25);
    g.fillStyle = st;
    g.fillRect(sx - 0.18 * s, GY - 0.12 * s, 0.36 * s, 0.12 * s);
    g.fillRect(sx - 0.07 * s, GY - 0.72 * s, 0.14 * s, 0.6 * s);
    g.fillRect(sx - 0.2 * s, GY - 0.8 * s, 0.4 * s, 0.08 * s);
    g.fillRect(sx - 0.15 * s, GY - 1.1 * s, 0.3 * s, 0.3 * s);
    g.beginPath(); g.moveTo(sx - 0.32 * s, GY - 1.08 * s); g.quadraticCurveTo(sx, GY - 1.3 * s, sx + 0.32 * s, GY - 1.08 * s); g.lineTo(sx + 0.05 * s, GY - 1.32 * s); g.lineTo(sx - 0.05 * s, GY - 1.32 * s); g.closePath(); g.fill();
    g.fillStyle = lt; g.fillRect(sx - 0.07 * s, GY - 0.72 * s, 0.03 * s, 0.6 * s);
    ly = GY - 0.95 * s;
    g.fillStyle = col ? mix('#3a1a08', col, f) : '#1a1414'; g.fillRect(sx - 0.08 * s, GY - 1.04 * s, 0.16 * s, 0.17 * s);
  } else if (kind === 'hang') {
    // a paper lantern hanging on its cord
    ly = GY - 2.65 * s;
    g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, ly - 0.25 * s); g.stroke();
    g.fillStyle = '#1a0e08'; g.fillRect(sx - 0.1 * s, ly - 0.27 * s, 0.2 * s, 0.05 * s); g.fillRect(sx - 0.1 * s, ly + 0.22 * s, 0.2 * s, 0.05 * s);
    const pg = g.createRadialGradient(sx - 0.05 * s, ly - 0.05 * s, 0.02 * s, sx, ly, 0.24 * s);
    pg.addColorStop(0, mix('#fff2c0', col, 0.3 * (1 - f))); pg.addColorStop(0.7, col); pg.addColorStop(1, mix(col, '#5a1a08', 0.6));
    g.fillStyle = pg; g.beginPath(); g.ellipse(sx, ly, 0.19 * s, 0.24 * s, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(90,30,10,0.45)'; g.lineWidth = 1.5 * u;
    g.beginPath(); for (const v of [-0.12, 0, 0.12]) { g.moveTo(sx - 0.19 * s * Math.sqrt(1 - (v / 0.24) ** 2), ly + v * s); g.lineTo(sx + 0.19 * s * Math.sqrt(1 - (v / 0.24) ** 2), ly + v * s); } g.stroke();
    g.strokeStyle = '#a02818'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(sx, ly + 0.27 * s); g.lineTo(sx + Math.sin(t * 1.3 + k) * 0.03 * s, ly + 0.45 * s); g.stroke();
  } else {
    // a brazier: a bronze bowl on three legs, its fire licking up
    ly = GY - 1.25 * s;
    g.strokeStyle = '#2a1a10'; g.lineWidth = 0.05 * s;
    g.beginPath(); g.moveTo(sx - 0.28 * s, GY); g.lineTo(sx - 0.1 * s, GY - 0.9 * s); g.moveTo(sx + 0.28 * s, GY); g.lineTo(sx + 0.1 * s, GY - 0.9 * s); g.moveTo(sx, GY); g.lineTo(sx, GY - 0.9 * s); g.stroke();
    g.fillStyle = '#5a3a1a'; g.beginPath(); g.moveTo(sx - 0.38 * s, GY - 1.05 * s); g.quadraticCurveTo(sx, GY - 0.7 * s, sx + 0.38 * s, GY - 1.05 * s); g.closePath(); g.fill();
    g.fillStyle = '#b08040'; g.fillRect(sx - 0.4 * s, GY - 1.07 * s, 0.8 * s, 0.04 * s);
    for (let j = 0; j < 5; j++) {
      const ph = t * (3 + j * 0.7) + j * 2 + k, hgt = (0.35 + 0.25 * Math.sin(ph) ** 2) * s, x = sx + (j - 2) * 0.12 * s + Math.sin(ph * 1.7) * 0.03 * s;
      g.fillStyle = j % 2 ? '#ffd070' : col;
      g.beginPath(); g.moveTo(x - 0.1 * s, GY - 1.06 * s); g.quadraticCurveTo(x - 0.06 * s, GY - 1.06 * s - hgt * 0.6, x + Math.sin(ph) * 0.04 * s, GY - 1.06 * s - hgt); g.quadraticCurveTo(x + 0.06 * s, GY - 1.06 * s - hgt * 0.6, x + 0.1 * s, GY - 1.06 * s); g.fill();
    }
  }
  if (!col) return;
  // its glow, breathing with the flame
  const r = (kind === 'brazier' ? 2.4 : kind === 'hang' ? 1.5 : 1.0) * s * (0.92 + f * 0.1);
  g.globalAlpha = 0.6 * f; g.drawImage(L.warm, lx - r, ly - r, r * 2, r * 2);
  g.globalAlpha = 1;
}
/** its reflection on a polished floor */
export function drawShine(g, L, sx, GY, s, t, k) {
  if (!L.th.shine || !L.th.lamps.c) return;
  const f = flicker(t, k), h = (L.th.lamps.kind === 'brazier' ? 1.6 : 1.2) * s, w = 0.5 * s;
  g.globalAlpha = 0.28 * f; g.drawImage(L.warm, sx - w, GY + 0.05 * s, w * 2, h);
  g.globalAlpha = 1;
}

// ---------- weather: embers, ash, petals; a little mist ----------
export function makeWeather(seed = 1) {
  const list = [];
  for (let i = 0; i < 90; i++) list.push({ x: hash(i, seed), y: hash(i, seed + 1), z: 0.4 + hash(i, seed + 2) * 1.1, p: hash(i, seed + 3) });
  return list;
}
export function drawWeather(g, L, W, cw, ch, cam, P, t) {
  const w = L.th.weather, u = ch / 1080;
  let i = 0;
  const kinds = [['embers', w.embers ?? 0], ['ash', w.ash ?? 0], ['petals', w.petals ?? 0]];
  for (const [kind, n] of kinds) for (let j = 0; j < n && i < W.length; j++, i++) {
    const p = W[i];
    // a closed-form drift (so a still frame and a paused one agree): embers rise, ash and petals fall
    const v = kind === 'embers' ? -0.035 : kind === 'ash' ? 0.025 : 0.04;
    const yy = (((p.y + t * v * p.z) % 1) + 1) % 1;
    const xx = (((p.x + t * 0.012 * (kind === 'embers' ? 1 : 2) + Math.sin(t * 0.8 + p.p * 20) * 0.01 - (cam * P * p.z * 0.6) / (cw * 1.2)) % 1) + 1) % 1;
    const x = xx * cw * 1.2 - cw * 0.1, y = yy * ch;
    if (kind === 'embers') {
      const a = (0.5 + 0.5 * Math.sin(t * 6 + p.p * 30)) * (0.4 + p.z * 0.4);
      g.fillStyle = `rgba(255,${(140 + p.p * 90) | 0},70,${a})`;
      g.fillRect(x, y, (1.4 + p.z * 2.2) * u, (1.4 + p.z * 2.2) * u);
    } else if (kind === 'ash') {
      g.fillStyle = `rgba(200,195,190,${0.18 + p.z * 0.15})`;
      g.save(); g.translate(x, y); g.rotate(t * (p.p - 0.5) * 2 + p.p * 6); g.fillRect(-2.5 * p.z * u, -1 * p.z * u, 5 * p.z * u, 2 * p.z * u); g.restore();
    } else {
      g.fillStyle = `rgba(255,${(190 + p.p * 40) | 0},${(210 + p.p * 30) | 0},${0.5 + p.z * 0.3})`;
      g.beginPath(); g.ellipse(x, y, 4 * p.z * u, 2 * p.z * u, t * (p.p + 0.3) * 2 + p.p * 9, 0, TAU); g.fill();
    }
  }
}
export function drawMist(g, L, cw, ch, GY, cam, P, t) {
  const u = ch / 1080;
  for (let k = 0; k < 2; k++) {
    const par = 0.3 + k * 0.25, w = cw * (0.7 + hash(k, 2) * 0.5), h = (90 + k * 30) * u;
    const span = cw + w;
    const x = ((((hash(k, 1) * span - cam * P * par + t * (8 + k * 5) * u) % span) + span) % span) - w;
    g.globalAlpha = L.th.indoor ? 0.35 : 0.55;
    g.drawImage(L.mist, x, GY - h * (1.6 - k * 0.35), w, h);
  }
  g.globalAlpha = 1;
}
