// The battlefield's cached layers. The ground is painted cell for cell into a W × H image
// (one pixel per sim cell) and only the columns that changed are repainted; it is drawn
// scaled up with smoothing, which gives the soft edge. The sky (gradient, sun or moons,
// stars, far ridges) is painted once per round and size. Scorch marks are render-only.
import { H, W } from '../terrain.js';
import { THEME } from './themes.js';

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
const glows = new Map();
/** A soft round light, tinted; cached per colour. */
export function glowSprite(col) {
  let c = glows.get(col);
  if (!c) {
    c = canvas(128, 128);
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, col); gr.addColorStop(0.3, col + 'aa'); gr.addColorStop(0.65, col + '33'); gr.addColorStop(1, col + '00');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    glows.set(col, c);
  }
  return c;
}
export function glow(g, col, x, y, r, a = 1) {
  if (r <= 0 || a <= 0) return;
  const pa = g.globalAlpha, op = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = pa * a;
  g.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = pa; g.globalCompositeOperation = op;
}
const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const rgb = (c, k = 1) => `rgb(${(c[0] * k) | 0},${(c[1] * k) | 0},${(c[2] * k) | 0})`;
export { rgb };

/** The ground image, kept in step with the sim terrain by column versions. */
export function createGround() {
  const cv = canvas(W, H), cx = cv.getContext('2d');
  const img = cx.createImageData(W, H), px = new Uint32Array(img.data.buffer);
  const seen = new Uint32Array(W), dirty = new Uint8Array(W);
  const scorch = new Uint8Array(W * H);
  const wob = new Float32Array(W);
  let theme = null, lut = null, vein = null;
  const LUT = 900;

  function setTheme(id) {
    theme = THEME[id] ?? THEME.dusk;
    const G = theme.ground, mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    lut = new Float32Array(LUT * 3);
    for (let d = 0; d < LUT; d++) {
      let c;
      if (d < 3) c = G.rim;
      else if (d < 7) c = mix(G.rim2, G.top, (d - 3) / 4);
      else if (d < 80) c = mix(G.top, G.mid, (d - 7) / 73);
      else if (d < 240) c = mix(G.mid, G.deep, (d - 80) / 160);
      else c = mix(G.deep, G.bed, Math.min(1, (d - 240) / 260));
      lut.set(c, d * 3);
    }
    vein = theme.vein ?? null;
    for (let x = 0; x < W; x++) wob[x] = Math.sin(x * 0.021) * 7 + Math.sin(x * 0.067 + 1.3) * 3;
    scorch.fill(0);
    seen.fill(0xffffffff);
  }
  function paint(cols, x) {
    const r = cols[x];
    for (let y = 0, i = x; y < H; y++, i += W) px[i] = 0;
    for (let k = 0; k < r.length; k += 2) {
      const top = r[k], bot = r[k + 1], off = k === 0 ? 0 : 9;
      for (let y = top, i = top * W + x; y < bot; y++, i += W) {
        const d = Math.min(LUT - 1, y - top + off);
        let cr = lut[d * 3], cg = lut[d * 3 + 1], cb = lut[d * 3 + 2];
        let s = 0.95 + hash(x, y) * 0.09;
        if (d > 5 && (((y + wob[x]) / 15) | 0) & 1) s *= 0.955;
        cr *= s; cg *= s; cb *= s;
        if (vein && d > 12) {
          const v = Math.abs(Math.sin(x * 0.043 + y * 0.09 + Math.sin(x * 0.011) * 3));
          if (v < 0.035) { const k2 = 1 - v / 0.035; cr += (vein[0] - cr) * k2 * 0.8; cg += (vein[1] - cg) * k2 * 0.8; cb += (vein[2] - cb) * k2 * 0.8; }
        }
        const sc = scorch[i];
        if (sc) { const k2 = 1 - (sc / 255) * 0.78; cr *= k2; cg *= k2; cb *= k2; }
        px[i] = 0xff000000 | (Math.min(255, cb) << 16) | (Math.min(255, cg) << 8) | Math.min(255, cr);
      }
    }
  }
  /** Repaint what changed since the last call. */
  function update(terrain) {
    const ver = terrain.ver, cols = terrain.cols;
    let x0 = W, x1 = -1;
    for (let x = 0; x < W; x++) {
      if (seen[x] === ver[x] && !dirty[x]) continue;
      seen[x] = ver[x]; dirty[x] = 0;
      paint(cols, x);
      if (x < x0) x0 = x;
      x1 = x;
    }
    if (x1 >= x0) cx.putImageData(img, 0, 0, x0, 0, x1 - x0 + 1, H);
  }
  /** Blacken the ground around a blast (render-only). */
  function burn(bx, by, r, strength = 1) {
    const ring = 5 + r * 0.35, R = r + ring;
    const xa = Math.max(0, Math.floor(bx - R)), xb = Math.min(W - 1, Math.ceil(bx + R));
    const ya = Math.max(0, Math.floor(by - R)), yb = Math.min(H - 1, Math.ceil(by + R));
    for (let x = xa; x <= xb; x++) {
      let touched = false;
      for (let y = ya; y <= yb; y++) {
        const d = Math.hypot(x - bx, y - by);
        if (d > R) continue;
        const k = d < r ? 1 : 1 - (d - r) / ring;
        const v = Math.min(255, (k * k * 190 * strength * (0.92 + hash(x, y) * 0.16)) | 0), i = y * W + x;
        if (v > scorch[i]) { scorch[i] = v; touched = true; }
      }
      if (touched) dirty[x] = 1;
    }
  }
  return { cv, setTheme, update, burn, get theme() { return theme; } };
}

/** The sky behind everything, painted at canvas size. */
export function paintSky(themeId, cw, ch, seed = 1) {
  const T = THEME[themeId] ?? THEME.dusk;
  const c = canvas(cw, ch), g = c.getContext('2d'), u = ch / 1080;
  g.setTransform(u, 0, 0, u, 0, 0);
  const gr = g.createLinearGradient(0, 0, 0, 1080);
  T.sky.forEach((col, i) => gr.addColorStop((i / (T.sky.length - 1)) * T.horizon, col));
  gr.addColorStop(1, T.sky[T.sky.length - 1]);
  g.fillStyle = gr; g.fillRect(0, 0, 1920, 1080);
  let s = seed >>> 0;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  if (T.stars) {
    const n = Math.round(420 * T.stars);
    for (let i = 0; i < n; i++) {
      const x = rand() * 1920, y = rand() * rand() * 860, r = 0.6 + rand() * rand() * 2.2;
      g.globalAlpha = (0.25 + rand() * 0.75) * (1 - y / 1100);
      g.fillStyle = rand() < 0.15 ? '#ffe9c0' : rand() < 0.2 ? '#c0d8ff' : '#ffffff';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  const body = (b, halo) => {
    if (!b) return;
    const x = b.x * 1920, y = b.y * 1080;
    glow(g, b.glow ?? b.col, x, y, b.r * (halo ? 4.5 : 3), halo ? 0.8 : 0.45);
    const bg = g.createRadialGradient(x - b.r * 0.3, y - b.r * 0.3, b.r * 0.1, x, y, b.r);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, b.col);
    g.fillStyle = bg; g.beginPath(); g.arc(x, y, b.r, 0, Math.PI * 2); g.fill();
    if (!halo) { // craters on a moon
      g.globalAlpha = 0.12; g.fillStyle = '#000';
      for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(x + (rand() - 0.5) * b.r, y + (rand() - 0.5) * b.r, b.r * (0.1 + rand() * 0.15), 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
    }
  };
  body(T.sun, true); body(T.moon, false); body(T.moon2, false);
  // two far ridges, hazier with distance
  const ridge = (col, base, amp, f, a) => {
    g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.moveTo(0, 1080);
    const ph = rand() * 10, ph2 = rand() * 10;
    for (let x = 0; x <= 1920; x += 12) g.lineTo(x, base - Math.abs(Math.sin(x * f + ph)) * amp - Math.sin(x * f * 2.7 + ph2) * amp * 0.3);
    g.lineTo(1920, 1080); g.closePath(); g.fill(); g.globalAlpha = 1;
  };
  ridge(T.far[0], 700, 150, 0.0042, 0.75);
  ridge(T.far[1], 780, 110, 0.0071, 0.85);
  const hz = g.createLinearGradient(0, 560, 0, 1080);
  hz.addColorStop(0, T.haze + '00'); hz.addColorStop(1, T.haze + '55');
  g.fillStyle = hz; g.fillRect(0, 560, 1920, 520);
  return c;
}

/** A soft cloud, tinted. */
export function cloudSprite(col, seed) {
  const c = canvas(512, 200), g = c.getContext('2d');
  let s = seed >>> 0;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  for (let k = 0; k < 9; k++) {
    const x = 90 + rand() * 330, y = 90 + (rand() - 0.5) * 50, r = 40 + rand() * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col + 'aa'); gr.addColorStop(1, col + '00');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return c;
}
