// HD art: the per-level palettes, the painted backdrop (sky strip, rock side panels, the
// strata of the field) and the baked sprites (gems, crate, gold), all drawn once at the
// window's resolution. Drawing the moving things lives in sprites.js.
export const TAU = Math.PI * 2;
export const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
export const hex = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export const rgba = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };
export const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
function seeded(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// strata top → deep, tunnel rim and hole, the gem's light and dark, sky top and horizon
export const PAL = [
  { bands: ['#9a6a3c', '#7d5030', '#5e3a24', '#432818'], rim: '#c99a64', hole: '#170e0a', gem: ['#7dffb0', '#13a85a'], sky: ['#1d2550', '#e5895a'] },
  { bands: ['#a88a5c', '#8e6c48', '#6a4e3a', '#4a3630'], rim: '#d8bc8c', hole: '#140f0e', gem: ['#8fd8ff', '#1f6fd0'], sky: ['#142440', '#f0b070'] },
  { bands: ['#8a7a6a', '#6e6058', '#524a48', '#3a3438'], rim: '#bcae9c', hole: '#0e0c0e', gem: ['#ff8a9a', '#c0183a'], sky: ['#201838', '#d86a6a'] },
  { bands: ['#c8c0a8', '#a89c84', '#7e7464', '#585044'], rim: '#efe8d2', hole: '#16130f', gem: ['#e0a0ff', '#8030c0'], sky: ['#1a2a4a', '#e8c090'] },
  { bands: ['#8a4a34', '#6c3628', '#50261e', '#381a16'], rim: '#c07a5c', hole: '#140908', gem: ['#ffe27a', '#d08a10'], sky: ['#2a1a30', '#f08a4a'] },
  { bands: ['#707a80', '#565e66', '#40464e', '#2c3038'], rim: '#a4b0b8', hole: '#0b0d10', gem: ['#9affef', '#14a89a'], sky: ['#101c34', '#8ab0d0'] },
  { bands: ['#5a6470', '#465060', '#363c4c', '#262a38'], rim: '#8e9cb0', hole: '#0a0b10', gem: ['#ffb070', '#e05a10'], sky: ['#0c1024', '#6a5a9a'] },
  { bands: ['#4a3a4e', '#3a2c40', '#2a2032', '#1c1424'], rim: '#7e6a88', hole: '#08060c', gem: ['#ffffff', '#88a8ff'], sky: ['#06040e', '#3a2050'] },
];
export const palOf = level => PAL[level % PAL.length];

// the whole frame behind the field: sky strip, side rock, and the field's soil
export function paintBackdrop(level, cw, ch, F) {
  const Z = palOf(level), c = canvas(cw, ch), g = c.getContext('2d'), R = seeded(level * 977 + 13);
  const { x: fx, y: fy, ts } = F, fw = 16 * ts, fh = 11 * ts;
  // sky strip with a horizon glow and a few stars
  const sky = g.createLinearGradient(0, 0, 0, fy);
  sky.addColorStop(0, Z.sky[0]); sky.addColorStop(1, Z.sky[1]);
  g.fillStyle = sky; g.fillRect(0, 0, cw, fy + 2);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 40; i++) g.fillRect(R() * cw, R() * fy * 0.6, 1 + R() * 1.5, 1 + R() * 1.5);
  // hills and a headframe silhouette on the horizon
  g.fillStyle = mix(Z.sky[0], '#000000', 0.35);
  g.beginPath(); g.moveTo(0, fy);
  for (let x = 0; x <= cw; x += cw / 24) g.lineTo(x, fy - (0.18 + 0.12 * Math.sin(x * 0.006 + level) + 0.08 * Math.sin(x * 0.017)) * fy);
  g.lineTo(cw, fy); g.fill();
  const hx = fx + ts * (level % 2 ? 13.5 : 1.8), hb = fy, hh = fy * 0.75, lw = Math.max(1, ts * 0.05);
  g.strokeStyle = mix(Z.sky[0], '#000000', 0.55); g.lineWidth = lw;
  g.beginPath();
  g.moveTo(hx - ts * 0.4, hb); g.lineTo(hx, hb - hh); g.lineTo(hx + ts * 0.4, hb);
  g.moveTo(hx - ts * 0.25, hb - hh * 0.4); g.lineTo(hx + ts * 0.25, hb - hh * 0.4);
  g.moveTo(hx - ts * 0.15, hb - hh * 0.7); g.lineTo(hx + ts * 0.15, hb - hh * 0.7);
  g.stroke();
  g.beginPath(); g.arc(hx, hb - hh, ts * 0.14, 0, TAU); g.stroke();
  // the rock: strata run across the whole width, the side panels darker
  const bandY = [0, 3.6, 7.2, 9.6, 11].map(v => fy + v * ts);
  for (let b = 0; b < 4; b++) {
    const y0 = bandY[b], y1 = bandY[b + 1], k = b;
    g.fillStyle = Z.bands[k];
    g.beginPath();
    g.moveTo(0, y0 + (b ? Math.sin(0) * ts * 0.15 : 0));
    for (let x = 0; x <= cw + 8; x += 8) g.lineTo(x, y0 + (b ? Math.sin(x / ts * 0.9 + b * 2) * ts * 0.16 + Math.sin(x / ts * 2.3 + b) * ts * 0.05 : 0));
    g.lineTo(cw, ch); g.lineTo(0, ch); g.fill();
    if (b) { // seam line
      g.strokeStyle = rgba(mix(Z.bands[k], '#000000', 0.5), 0.6); g.lineWidth = ts * 0.04;
      g.beginPath();
      for (let x = 0; x <= cw + 8; x += 8) { const y = y0 + Math.sin(x / ts * 0.9 + b * 2) * ts * 0.16 + Math.sin(x / ts * 2.3 + b) * ts * 0.05; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    void y1;
  }
  // grain: speckles and pebbles
  for (let i = 0; i < (cw * (ch - fy)) / (ts * ts) * 26; i++) {
    const x = R() * cw, y = fy + R() * (ch - fy), r = ts * (0.015 + R() * 0.03);
    g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,240,220,0.12)';
    g.fillRect(x, y, r * 2, r * 2);
  }
  for (let i = 0; i < (cw * (ch - fy)) / (ts * ts) * 0.9; i++) {
    const x = R() * cw, y = fy + ts * 0.1 + R() * (ch - fy), rx = ts * (0.05 + R() * 0.1), ry = rx * (0.55 + R() * 0.3);
    const base = mix(Z.bands[Math.min(3, Math.floor((y - fy) / ts / 3))], R() < 0.5 ? '#ffffff' : '#000000', 0.25);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x + rx * 0.2, y + ry * 0.3, rx, ry, 0, 0, TAU); g.fill();
    g.fillStyle = base; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(x - rx * 0.3, y - ry * 0.35, rx * 0.4, ry * 0.3, 0, 0, TAU); g.fill();
  }
  // roots hanging into the topsoil, fossil curls in the deep
  g.strokeStyle = rgba(mix(Z.bands[0], '#000000', 0.45), 0.8); g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    let x = fx + R() * fw, y = fy;
    g.lineWidth = ts * (0.03 + R() * 0.03);
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { const nx = x + (R() - 0.5) * ts * 0.8, ny = y + ts * (0.2 + R() * 0.35); g.quadraticCurveTo(x + (R() - 0.5) * ts * 0.5, (y + ny) / 2, nx, ny); x = nx; y = ny; }
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,240,220,0.16)'; g.lineWidth = ts * 0.035;
  for (let i = 0; i < 5; i++) {
    const x = fx + R() * fw, y = fy + ts * (8 + R() * 2.6), r = ts * (0.12 + R() * 0.12);
    g.beginPath();
    for (let a = 0; a < TAU * 2.2; a += 0.2) { const rr = r * (1 - a / (TAU * 2.6)); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; if (a) g.lineTo(px, py); else g.moveTo(px, py); }
    g.stroke();
  }
  // side panels: the same rock, in shadow, behind glass
  for (const [x0, x1] of [[0, fx], [fx + fw, cw]]) {
    const gr = g.createLinearGradient(x0 < fx ? fx : fx + fw, 0, x0 < fx ? 0 : cw, 0);
    gr.addColorStop(0, 'rgba(6,4,8,0.55)'); gr.addColorStop(1, 'rgba(6,4,8,0.85)');
    g.fillStyle = gr; g.fillRect(x0, fy, x1 - x0, ch - fy);
  }
  // the field's frame: a timber lining at the edges
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = ts * 0.12;
  g.strokeRect(fx - ts * 0.06, fy - ts * 0.02, fw + ts * 0.12, fh + ts * 0.08);
  g.strokeStyle = rgba(Z.rim, 0.35); g.lineWidth = ts * 0.03;
  g.strokeRect(fx - ts * 0.12, fy - ts * 0.04, fw + ts * 0.24, fh + ts * 0.2);
  // grass along the surface
  g.fillStyle = '#3c6a2a'; g.fillRect(0, fy - ts * 0.06, cw, ts * 0.1);
  g.strokeStyle = '#5c9a3a'; g.lineWidth = Math.max(1, ts * 0.025);
  g.beginPath();
  for (let x = 0; x < cw; x += ts * 0.07) { const hgt = ts * (0.06 + R() * 0.1); g.moveTo(x, fy - ts * 0.02); g.lineTo(x + (R() - 0.5) * ts * 0.06, fy - ts * 0.02 - hgt); }
  g.stroke();
  return c;
}

// ---------- baked sprites (centred on their canvas) ----------
export function gemSprite(Z, ts) {
  const s = ts * 0.62, c = canvas(s * 2, s * 2), g = c.getContext('2d'), m = s;
  const halo = g.createRadialGradient(m, m, 0, m, m, s);
  halo.addColorStop(0, rgba(Z.gem[0], 0.35)); halo.addColorStop(1, rgba(Z.gem[0], 0));
  g.fillStyle = halo; g.fillRect(0, 0, s * 2, s * 2);
  const r = s * 0.42;
  // a brilliant cut seen from the side: crown and pavilion facets
  const pts = [[-1, -0.25], [-0.55, -0.75], [0.55, -0.75], [1, -0.25], [0, 1]].map(([x, y]) => [m + x * r, m + y * r]);
  g.fillStyle = Z.gem[1]; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  const facet = (list, col) => { g.fillStyle = col; g.beginPath(); list.forEach(([x, y], i) => (i ? g.lineTo(m + x * r, m + y * r) : g.moveTo(m + x * r, m + y * r))); g.closePath(); g.fill(); };
  facet([[-1, -0.25], [-0.55, -0.75], [-0.2, -0.25]], mix(Z.gem[0], Z.gem[1], 0.2));
  facet([[-0.2, -0.25], [-0.55, -0.75], [0.55, -0.75], [0.2, -0.25]], Z.gem[0]);
  facet([[0.2, -0.25], [0.55, -0.75], [1, -0.25]], mix(Z.gem[0], Z.gem[1], 0.45));
  facet([[-1, -0.25], [-0.2, -0.25], [0, 1]], mix(Z.gem[0], Z.gem[1], 0.35));
  facet([[0.2, -0.25], [1, -0.25], [0, 1]], mix(Z.gem[1], '#000000', 0.25));
  facet([[-0.2, -0.25], [0.2, -0.25], [0, 1]], mix(Z.gem[0], Z.gem[1], 0.6));
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = Math.max(1, ts * 0.015);
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(m - r * 0.35, m - r * 0.55, r * 0.16, r * 0.08, -0.3, 0, TAU); g.fill();
  return c;
}
export function crateSprite(ts) {
  const s = ts * 0.88, pad = ts * 0.08, c = canvas(s + pad * 2, s + pad * 2), g = c.getContext('2d'), x = pad, y = pad;
  g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.roundRect(x + s * 0.04, y + s * 0.08, s, s, s * 0.08); g.fill();
  const wood = g.createLinearGradient(0, y, 0, y + s);
  wood.addColorStop(0, '#c88a4a'); wood.addColorStop(1, '#8a5428');
  g.fillStyle = wood; g.beginPath(); g.roundRect(x, y, s, s, s * 0.08); g.fill();
  // planks and grain
  g.strokeStyle = 'rgba(60,30,10,0.55)'; g.lineWidth = s * 0.03;
  for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x + s * 0.06, y + (s * k) / 4); g.lineTo(x + s * 0.94, y + (s * k) / 4); g.stroke(); }
  g.strokeStyle = 'rgba(255,220,170,0.18)'; g.lineWidth = s * 0.012;
  for (let k = 0; k < 8; k++) { const yy = y + s * (0.08 + k * 0.115); g.beginPath(); g.moveTo(x + s * 0.1, yy); g.bezierCurveTo(x + s * 0.4, yy - s * 0.03, x + s * 0.6, yy + s * 0.03, x + s * 0.9, yy); g.stroke(); }
  // a cross brace
  g.strokeStyle = '#6a3c1a'; g.lineWidth = s * 0.1; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x + s * 0.16, y + s * 0.84); g.lineTo(x + s * 0.84, y + s * 0.16); g.stroke();
  g.strokeStyle = 'rgba(255,220,170,0.25)'; g.lineWidth = s * 0.025;
  g.beginPath(); g.moveTo(x + s * 0.16, y + s * 0.8); g.lineTo(x + s * 0.8, y + s * 0.16); g.stroke();
  // iron corners and rivets
  g.fillStyle = '#4a4e58';
  for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { g.beginPath(); g.roundRect(x + cx * s * 0.76, y + cy * s * 0.76, s * 0.24, s * 0.24, s * 0.05); g.fill(); }
  g.fillStyle = '#aab0bc';
  for (const [cx, cy] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) { g.beginPath(); g.arc(x + cx * s, y + cy * s, s * 0.035, 0, TAU); g.fill(); }
  // ore glinting between the slats
  g.fillStyle = '#ffd24a';
  for (const [ox, oy] of [[0.32, 0.22], [0.62, 0.48], [0.38, 0.72], [0.7, 0.76]]) { g.beginPath(); g.arc(x + ox * s, y + oy * s, s * 0.03, 0, TAU); g.fill(); }
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = s * 0.025; g.beginPath(); g.roundRect(x, y, s, s, s * 0.08); g.stroke();
  return c;
}
export function goldSprite(ts) {
  const s = ts * 0.9, c = canvas(s, s * 0.6), g = c.getContext('2d'), R = seeded(5);
  const nug = (x, y, r) => {
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
    gr.addColorStop(0, '#fff6b0'); gr.addColorStop(0.5, '#ffc928'); gr.addColorStop(1, '#a8620a');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 0.78, R() * 2, 0, TAU); g.fill();
  };
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(s / 2, s * 0.5, s * 0.42, s * 0.08, 0, 0, TAU); g.fill();
  const list = [[0.22, 0.42, 0.11], [0.4, 0.44, 0.13], [0.6, 0.43, 0.12], [0.78, 0.44, 0.1], [0.32, 0.3, 0.1], [0.52, 0.28, 0.12], [0.7, 0.31, 0.09], [0.46, 0.16, 0.09]];
  for (const [x, y, r] of list) nug(x * s, y * s, r * s);
  return c;
}
// soft round light: white centre fading out (for 'lighter' glows and the darkness mask)
export function lightSprite(size = 128) {
  const c = canvas(size, size), g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}
export function tint(src, col) {
  const c = canvas(src.width, src.height), g = c.getContext('2d');
  g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
  return c;
}
