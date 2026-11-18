// The glass: seven colours of hand-blown marble and the prism, painted once per size into
// sprites. Light comes from the lamp at the upper left, so every marble has its highlight there,
// light gathered on its far side (as through real glass), a shadow to the lower right and a
// coloured caustic inside the shadow. Each colour also carries its own core shape (a ribbon,
// bubbles, a ring…) so colours can be told apart without hue alone.
//
//   const S = marbleSprites(radiusInDevicePx);
//   S.still[c] (whole marble), S.base[c] + S.core[c] (rotates as it rolls) + S.gloss, S.shadow[c]
//   drawPrism(g, x, y, r, t, spin)  // the prism is painted live: its colours turn
export const TAU = Math.PI * 2;
export const GLASS = [
  { name: 'Ruby', base: '#e0283f', light: '#ff9aa4', dark: '#4e0612', core: 'ribbon' },
  { name: 'Amber', base: '#ef8a1e', light: '#ffd598', dark: '#5a2600', core: 'bubbles' },
  { name: 'Citrine', base: '#f0d030', light: '#fff7b8', dark: '#5e4800', core: 'ring' },
  { name: 'Jade', base: '#23b86c', light: '#a6f2c6', dark: '#053a26', core: 'twin' },
  { name: 'Lagoon', base: '#1ec4d6', light: '#b0f8ff', dark: '#033e52', core: 'wave' },
  { name: 'Cobalt', base: '#3360f2', light: '#a8bcff', dark: '#0a1660', core: 'star' },
  { name: 'Amethyst', base: '#a54ce8', light: '#e4b8ff', dark: '#33085c', core: 'spiral' },
];
export const PRISM_COLS = ['#ff6b8b', '#ffb35c', '#fff07a', '#7cf2a8', '#6fe6ff', '#8aa2ff', '#d68cff', '#ff6b8b'];

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
// '#rrggbb' or 'rgba(r,g,b,a)' → [r, g, b]; mixing helpers must take their own output
export function rgbOf(col) {
  if (col.startsWith('#')) { const n = parseInt(col.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = col.match(/[\d.]+/g) ?? ['255', '255', '255'];
  return [+m[0], +m[1], +m[2]];
}
export const rgba = (col, a) => { const [r, g, b] = rgbOf(col); return `rgba(${r},${g},${b},${a})`; };

// a soft round light, white in the middle; tinted copies cached per colour
const glows = new Map();
export function glow(g, col, x, y, r, a = 1) {
  let s = glows.get(col);
  if (!s) {
    s = canvas(64, 64);
    const x2 = s.getContext('2d'), gr = x2.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.35, rgba(col, 0.45)); gr.addColorStop(1, rgba(col, 0));
    x2.fillStyle = gr; x2.fillRect(0, 0, 64, 64);
    glows.set(col, s);
  }
  const ga = g.globalAlpha;
  g.globalAlpha = ga * a;
  g.drawImage(s, x - r, y - r, r * 2, r * 2);
  g.globalAlpha = ga;
}

function paintBase(x, R, G) {
  const gr = x.createRadialGradient(-0.32 * R, -0.4 * R, 0.04 * R, -0.1 * R, -0.1 * R, 1.12 * R);
  gr.addColorStop(0, G.light); gr.addColorStop(0.32, G.base); gr.addColorStop(0.82, G.dark); gr.addColorStop(1, G.dark);
  x.fillStyle = gr; x.beginPath(); x.arc(0, 0, R, 0, TAU); x.fill();
  // light focused through the glass onto its far side
  const fo = x.createRadialGradient(0.3 * R, 0.42 * R, 0, 0.3 * R, 0.42 * R, 0.72 * R);
  fo.addColorStop(0, rgba(G.light, 0.75)); fo.addColorStop(0.5, rgba(G.base, 0.25)); fo.addColorStop(1, rgba(G.base, 0));
  x.fillStyle = fo; x.beginPath(); x.arc(0, 0, R, 0, TAU); x.fill();
  x.strokeStyle = rgba(G.dark, 0.7); x.lineWidth = Math.max(1, R * 0.04); x.beginPath(); x.arc(0, 0, R * 0.98, 0, TAU); x.stroke();
}
function paintCore(x, R, G) {
  x.save();
  x.beginPath(); x.arc(0, 0, R * 0.86, 0, TAU); x.clip();
  x.strokeStyle = rgba(G.light, 0.5); x.fillStyle = rgba(G.light, 0.42); x.lineWidth = R * 0.11; x.lineCap = 'round';
  const s = R;
  switch (G.core) {
    case 'ribbon':
      x.beginPath(); x.moveTo(-0.6 * s, 0.35 * s); x.bezierCurveTo(-0.2 * s, -0.5 * s, 0.2 * s, 0.5 * s, 0.6 * s, -0.35 * s); x.stroke();
      x.lineWidth = R * 0.05; x.strokeStyle = rgba('#ffffff', 0.3);
      x.beginPath(); x.moveTo(-0.6 * s, 0.35 * s); x.bezierCurveTo(-0.2 * s, -0.5 * s, 0.2 * s, 0.5 * s, 0.6 * s, -0.35 * s); x.stroke();
      break;
    case 'bubbles':
      for (const [bx, by, br] of [[-0.25, -0.1, 0.17], [0.2, 0.18, 0.13], [0.08, -0.32, 0.09], [-0.05, 0.38, 0.07]]) {
        x.beginPath(); x.arc(bx * s, by * s, br * s, 0, TAU); x.fill();
      }
      break;
    case 'ring':
      x.beginPath(); x.arc(0, 0, 0.42 * s, 0, TAU); x.stroke();
      x.beginPath(); x.arc(0, 0, 0.12 * s, 0, TAU); x.fill();
      break;
    case 'twin':
      for (const o of [-0.2, 0.2]) { x.beginPath(); x.ellipse(o * s, 0, 0.16 * s, 0.6 * s, 0, 0, TAU); x.stroke(); }
      break;
    case 'wave':
      x.beginPath();
      for (let k = 0; k <= 20; k++) { const px = (-0.75 + 1.5 * (k / 20)) * s, py = Math.sin((k / 20) * TAU * 1.5) * 0.22 * s; if (k) x.lineTo(px, py); else x.moveTo(px, py); }
      x.stroke();
      break;
    case 'star':
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4;
        x.beginPath(); x.moveTo(Math.cos(a) * 0.62 * s, Math.sin(a) * 0.62 * s); x.lineTo(-Math.cos(a) * 0.62 * s, -Math.sin(a) * 0.62 * s);
        x.lineWidth = R * (k % 2 ? 0.06 : 0.11); x.stroke();
      }
      break;
    case 'spiral':
      x.beginPath();
      for (let k = 0; k <= 40; k++) { const a = k * 0.32, rr = 0.04 * s + k * 0.0145 * s; const px = Math.cos(a) * rr, py = Math.sin(a) * rr; if (k) x.lineTo(px, py); else x.moveTo(px, py); }
      x.stroke();
      break;
  }
  x.restore();
}
export function paintGloss(x, R) {
  const h = x.createRadialGradient(-0.34 * R, -0.42 * R, 0, -0.34 * R, -0.42 * R, 0.5 * R);
  h.addColorStop(0, 'rgba(255,255,255,0.9)'); h.addColorStop(0.45, 'rgba(255,255,255,0.35)'); h.addColorStop(1, 'rgba(255,255,255,0)');
  x.save(); x.translate(-0.34 * R, -0.42 * R); x.rotate(-0.65); x.scale(1, 0.62); x.translate(0.34 * R, 0.42 * R);
  x.fillStyle = h; x.beginPath(); x.arc(-0.34 * R, -0.42 * R, 0.5 * R, 0, TAU); x.fill();
  x.restore();
  x.fillStyle = 'rgba(255,255,255,0.95)'; x.beginPath(); x.arc(-0.4 * R, -0.46 * R, 0.085 * R, 0, TAU); x.fill();
  // the lamp's second reflection, and light caught on the lower rim
  x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.ellipse(0.28 * R, -0.52 * R, 0.1 * R, 0.05 * R, 0.5, 0, TAU); x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.28)'; x.lineWidth = 0.06 * R; x.lineCap = 'round';
  x.beginPath(); x.arc(0, 0, 0.86 * R, 0.15 * Math.PI, 0.62 * Math.PI); x.stroke();
}
function paintShadow(x, R, G) {
  const sh = x.createRadialGradient(0.22 * R, 0.4 * R, 0.2 * R, 0.22 * R, 0.4 * R, 1.15 * R);
  sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(0.6, 'rgba(0,0,0,0.25)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = sh; x.beginPath(); x.ellipse(0.22 * R, 0.4 * R, 1.15 * R, 0.95 * R, 0.5, 0, TAU); x.fill();
  if (G) {
    const ca = x.createRadialGradient(0.5 * R, 0.66 * R, 0, 0.5 * R, 0.66 * R, 0.42 * R);
    ca.addColorStop(0, rgba(G.light, 0.6)); ca.addColorStop(1, rgba(G.base, 0));
    x.fillStyle = ca; x.beginPath(); x.ellipse(0.5 * R, 0.66 * R, 0.42 * R, 0.3 * R, 0.6, 0, TAU); x.fill();
  }
}

// R: the marble's radius in device pixels
export function marbleSprites(R) {
  const sz = Math.ceil(R * 2 + 4), sh = Math.ceil(R * 3.4);
  const mk = (size, paint) => { const c = canvas(size, size), x = c.getContext('2d'); x.translate(size / 2, size / 2); paint(x); return c; };
  const S = { R, size: sz, shSize: sh, still: [], base: [], core: [], shadow: [], gloss: mk(sz, x => paintGloss(x, R)) };
  GLASS.forEach((G, c) => {
    S.base[c] = mk(sz, x => paintBase(x, R, G));
    S.core[c] = mk(sz, x => paintCore(x, R, G));
    S.shadow[c] = mk(sh, x => paintShadow(x, R, G));
    S.still[c] = mk(sz, x => { paintBase(x, R, G); paintCore(x, R, G); paintGloss(x, R); });
  });
  S.shadow[7] = mk(sh, x => paintShadow(x, R, { light: '#fff6d8', base: '#ffffff' }));
  return S;
}

// the prism, in reference units at (x, y): clear glass with a turning rainbow inside
export function drawPrism(g, x, y, r, t, spin = 0) {
  g.save();
  g.translate(x, y);
  g.beginPath(); g.arc(0, 0, r, 0, TAU); g.clip();
  if (g.createConicGradient) {
    const cg = g.createConicGradient(t * 0.8 + spin, 0, 0);
    PRISM_COLS.forEach((c, k) => cg.addColorStop(k / (PRISM_COLS.length - 1), c));
    g.fillStyle = cg;
  } else {
    const lg = g.createLinearGradient(-r, -r, r, r);
    PRISM_COLS.forEach((c, k) => lg.addColorStop(k / (PRISM_COLS.length - 1), c));
    g.fillStyle = lg;
  }
  g.fillRect(-r, -r, r * 2, r * 2);
  // milky clear glass over it, thinner at the middle
  const m = g.createRadialGradient(0, 0, 0.1 * r, 0, 0, r);
  m.addColorStop(0, 'rgba(255,255,255,0.75)'); m.addColorStop(0.55, 'rgba(255,255,255,0.25)'); m.addColorStop(1, 'rgba(40,30,70,0.55)');
  g.fillStyle = m; g.fillRect(-r, -r, r * 2, r * 2);
  // a faceted star inside
  g.rotate(spin - t * 0.3);
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = r * 0.06;
  g.beginPath();
  for (let k = 0; k < 6; k++) { const a = (k * TAU) / 6; g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62); }
  g.stroke();
  g.restore();
  g.save(); g.translate(x, y); g.scale(r, r); paintGloss(g, 1); g.restore();
}
