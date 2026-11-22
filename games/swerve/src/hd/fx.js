// Effects in pitch metres, and the small helpers every part of the HD view shares: the oblique
// projection (a height z rises up the screen by z·ZK), maths, a seeded hash, colours that mix
// their own output (mix() returns rgba(…), which rgb() reads back), offscreen canvases.
//
// The effects: kick dust, grass sprayed by slides and hard kicks, slide marks that fade, chalk
// flecks off the woodwork, the net's ripple (pitch.js asks netAt() while drawing a goal), the
// camera's shake and the goal flash, and confetti over the screen on a goal. Particles live in
// one capped pool, soft ones drawn from pre-made puff sprites. Nothing here touches the sim.
export const TAU = Math.PI * 2;
/** how far a metre of height rises up the screen, in metres of pitch */
export const ZK = 0.8;
/** the sun: where a metre of height throws its shadow on the grass (x, y metres) */
export const SUN = [0.42, 0.26];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const hash = (a, b = 0) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export const strHash = s => { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
/** a seeded generator, for painting the same thing every time */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- colour ----------
const cache = new Map();
/** '#rgb', '#rrggbb', 'rgb(…)' or 'rgba(…)' → [r, g, b] */
export function rgb(col) {
  let c = cache.get(col);
  if (!c) {
    if (typeof col !== 'string') c = [128, 128, 128];
    else if (col[0] === '#') {
      const h = col.length === 4 ? col.slice(1).split('').map(x => x + x).join('') : col.slice(1, 7), n = parseInt(h, 16);
      c = Number.isNaN(n) ? [128, 128, 128] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else {
      c = col.slice(col.indexOf('(') + 1).split(',', 3).map(v => parseFloat(v));
      if (c.length < 3 || c.some(Number.isNaN)) c = [128, 128, 128];
    }
    if (cache.size > 4000) cache.clear();
    cache.set(col, c);
  }
  return c;
}
export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const mix = (h1, h2, t, a = 1) => { const p = rgb(h1), q = rgb(h2), k = clamp(t, 0, 1); return css([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k], a); };
export const alpha = (col, a) => css(rgb(col), a);
/** darker (k < 0) or lighter (k > 0) */
export const shade = (col, k) => (k < 0 ? mix(col, '#000000', -k) : mix(col, '#ffffff', k));
/** 0 (black) .. 1 (white), perceived */
export const luma = col => { const [r, g, b] = rgb(col); return (r * 0.299 + g * 0.587 + b * 0.114) / 255; };

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
/** a soft round puff of one colour with an alpha falloff */
export function puff(size, col = '#ffffff', hard = 0.35) {
  const c = canvas(size, size), g = c.getContext('2d'), r = size / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, alpha(col, 1)); gr.addColorStop(hard, alpha(col, 0.55)); gr.addColorStop(1, alpha(col, 0));
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}

// ---------- the effects ----------
// kind → [sprite colour (null: drawn as a shape), layer (0 on the grass under the players, 1 over)]
const KIND = { dust: ['#d9d2b0', 0], puff: ['#ffffff', 1], blade: [null, 1], fleck: [null, 1], spark: [null, 1] };
const CONFETTI = ['#ffd23f', '#ffffff', '#ff5a4e', '#4fc3ff', '#7be07b'];

export function createFx({ max = 900 } = {}) {
  const P = [], C = [], marks = [];
  const sprites = {};
  const sprite = col => (sprites[col] ??= puff(48, col, 0.3));
  const rand = Math.random;
  // the nets: [top, bottom] ripples, each { u, w, amp, age } (u across the mouth 0..1, w up 0..1)
  const nets = [[], []];
  const api = {
    shake: 0, flash: 0, flashCol: '#ffffff', roar: 0,
    get count() { return P.length + C.length; },
    clear() { P.length = 0; C.length = 0; marks.length = 0; nets[0].length = 0; nets[1].length = 0; api.shake = 0; api.flash = 0; api.roar = 0; },
    add,
    /** a puff of dry dust off a boot */
    dust(x, y, k = 1, n = 3) {
      for (let i = 0; i < n; i++) {
        const a = rand() * TAU, v = (0.4 + rand() * 1.2) * k;
        add('dust', x, y, 0.05, Math.cos(a) * v, Math.sin(a) * v, 0.3 + rand() * 0.4, 0.5 + rand() * 0.7, 0.25 * k + 0.08, { grow: 1.2, drag: 2.6, grav: 0, vz: 0.4 });
      }
    },
    /** grass and a little earth flung up behind a slide or a hard strike, against (dx, dy) */
    spray(x, y, dx, dy, k = 1) {
      const n = Math.round(4 + 5 * k), a0 = Math.atan2(dy, dx);
      for (let i = 0; i < n; i++) {
        const a = a0 + (rand() - 0.5) * 1.5, v = 2 + rand() * 4 * k;
        add('blade', x, y, 0.05, Math.cos(a) * v, Math.sin(a) * v, 0.45 + rand() * 0.4, 0.09 + rand() * 0.08, 1, { vz: 1.5 + rand() * 3 * k, grav: 14, drag: 1.2, vr: (rand() - 0.5) * 30, col: rand() < 0.2 ? '#5b4a2c' : rand() < 0.5 ? '#3f8f3e' : '#64b45a' });
      }
      api.dust(x, y, 0.6 * k, 2);
    },
    /** white flecks off a post or the bar at height z */
    flecks(x, y, z) {
      for (let i = 0; i < 10; i++) { const a = rand() * TAU, v = 2 + rand() * 5; add('fleck', x, y, z, Math.cos(a) * v, Math.sin(a) * v, 0.35 + rand() * 0.3, 0.05 + rand() * 0.05, 1, { vz: (rand() - 0.3) * 5, grav: 12, drag: 1.5, col: '#ffffff' }); }
      add('puff', x, y, z, 0, 0, 0.3, 0.6, 0.5, { grow: 2.5, drag: 0 });
    },
    /** a slide's mark on the grass, from (x0, y0) to (x1, y1); fades over 25 s */
    mark(x0, y0, x1, y1) {
      marks.push({ x0, y0, x1, y1, t: 0 });
      if (marks.length > 120) marks.shift();
    },
    /** the ball hits the net of goal `end` (0 top, 1 bottom) at u across (0..1) and w up (0..1) */
    ripple(end, u, w, amp = 0.5) {
      const list = nets[end ? 1 : 0];
      list.push({ u: clamp(u, 0, 1), w: clamp(w, 0, 1), amp, age: 0 });
      if (list.length > 3) list.shift();
    },
    /** how far (metres, outwards) the net of goal `end` bulges at (u, w) now */
    netAt(end, u, w) {
      let d = 0;
      for (const r of nets[end ? 1 : 0]) {
        const du = (u - r.u) * 2.2, dw = w - r.w, dist = Math.sqrt(du * du + dw * dw), e = Math.exp(-r.age * 2.4);
        d += r.amp * e * (Math.exp(-dist * dist * 6) * Math.cos(r.age * 13) + 0.35 * Math.sin(dist * 16 - r.age * 22) * Math.exp(-dist * 1.6));
      }
      return d;
    },
    netLive(end) { return nets[end ? 1 : 0].length > 0; },
    /** a burst of paper over the whole screen, in the scorers' colours with the gold */
    confetti(cols = CONFETTI, n = 140) {
      const pal = [...cols, '#ffd23f', '#ffffff'];
      for (let i = 0; i < n; i++) {
        C.push({ x: rand(), y: -0.05 - rand() * 0.5, vx: (rand() - 0.5) * 0.12, vy: 0.12 + rand() * 0.18, rot: rand() * TAU, vr: (rand() - 0.5) * 12, sw: rand() * TAU, s: 0.6 + rand() * 0.8, col: pal[(rand() * pal.length) | 0], life: 3.5 + rand() * 1.5 });
      }
      if (C.length > 400) C.splice(0, C.length - 400);
    },
    hit(k) { api.shake = Math.max(api.shake, k); },
    flashOn(k, col = '#ffffff') { api.flash = Math.max(api.flash, k); api.flashCol = col; },
    step(dt) {
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.life -= dt;
        if (p.life <= 0) { P.splice(i, 1); continue; }
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy *= d;
        p.vz -= p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.z < 0) { p.z = 0; p.vz = 0; p.vx *= 0.5; p.vy *= 0.5; p.vr *= 0.5; }
        p.size += p.grow * dt; p.rot += p.vr * dt;
      }
      for (let i = C.length - 1; i >= 0; i--) {
        const c = C[i];
        c.life -= dt;
        if (c.life <= 0) { C.splice(i, 1); continue; }
        c.sw += dt * 5; c.x += (c.vx + Math.sin(c.sw) * 0.04) * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
      }
      for (let i = marks.length - 1; i >= 0; i--) if ((marks[i].t += dt) > 25) marks.splice(i, 1);
      for (const list of nets) for (let i = list.length - 1; i >= 0; i--) if ((list[i].age += dt) > 2.2) list.splice(i, 1);
      api.shake = Math.max(0, api.shake - dt * 1.6);
      api.flash = Math.max(0, api.flash - dt * 1.8);
      api.roar = Math.max(0, api.roar - dt * 0.16);
    },
    /** the slide marks: on the grass, before anything else stands on it */
    drawMarks(g, v) {
      if (!marks.length) return;
      const { P: k } = v;
      g.lineCap = 'round';
      for (const m of marks) {
        const a = 0.22 * (1 - m.t / 25);
        g.strokeStyle = `rgba(30,52,22,${a.toFixed(3)})`; g.lineWidth = 0.32 * k;
        g.beginPath(); g.moveTo(v.X(m.x0), v.Y(m.y0, 0)); g.lineTo(v.X(m.x1), v.Y(m.y1, 0)); g.stroke();
        g.strokeStyle = `rgba(200,220,170,${(a * 0.35).toFixed(3)})`; g.lineWidth = 0.08 * k;
        g.beginPath(); g.moveTo(v.X(m.x0) + 0.06 * k, v.Y(m.y0, 0)); g.lineTo(v.X(m.x1) + 0.06 * k, v.Y(m.y1, 0)); g.stroke();
      }
      g.lineCap = 'butt';
    },
    /** particles of one layer (0 on the grass, 1 in the air) */
    draw(g, v, layer) {
      const { P: k } = v;
      for (const p of P) {
        const def = KIND[p.kind];
        if (def[1] !== layer) continue;
        const X = v.X(p.x), Y = v.Y(p.y, p.z), q = p.life / p.max;
        if (X < -60 || Y < -60 || X > v.cw + 60 || Y > v.ch + 60) continue;
        if (def[0]) {
          const s = p.size * k;
          g.globalAlpha = clamp(p.a * Math.min(1, q * 2), 0, 1);
          g.drawImage(sprite(p.col ?? def[0]), X - s / 2, Y - s / 2, s, s);
        } else {
          g.globalAlpha = clamp(Math.min(1, q * 3), 0, 1);
          g.fillStyle = p.col ?? '#ffffff';
          const s = p.size * k;
          g.save(); g.translate(X, Y); g.rotate(p.rot); g.fillRect(-s / 2, -s * 0.18, s, s * 0.36); g.restore();
        }
      }
      g.globalAlpha = 1;
    },
    /** confetti and the goal flash, over the whole canvas */
    drawScreen(g, cw, ch) {
      if (api.flash > 0.01) { g.fillStyle = alpha(api.flashCol, api.flash * 0.45); g.fillRect(0, 0, cw, ch); }
      if (!C.length) return;
      const u = ch / 1080;
      for (const c of C) {
        const X = c.x * cw, Y = c.y * ch;
        if (Y < -20) continue;
        g.globalAlpha = clamp(c.life, 0, 1);
        g.fillStyle = c.col;
        const w = 14 * u * c.s, h = 8 * u * c.s * Math.abs(Math.cos(c.sw));
        g.save(); g.translate(X, Y); g.rotate(c.rot); g.fillRect(-w / 2, -h / 2, w, Math.max(1, h)); g.restore();
      }
      g.globalAlpha = 1;
    },
  };
  function add(kind, x, y, z, vx, vy, life, size, a = 1, o = {}) {
    if (P.length >= max) { if (kind === 'dust' || kind === 'blade') return; P.shift(); }
    P.push({ kind, x, y, z, vx, vy, vz: o.vz ?? 0, life, max: life, size, grow: o.grow ?? 0, drag: o.drag ?? 2, grav: o.grav ?? 0, a, rot: o.rot ?? rand() * TAU, vr: o.vr ?? 0, col: o.col });
  }
  return api;
}
