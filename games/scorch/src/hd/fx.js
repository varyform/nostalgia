// Effects in world metres: tyre smoke, dust and spray by surface, sparks, debris, fire and smoke,
// explosions (flash, fireball, shock ring, debris), muzzle flashes and pickup sparkles; and the
// weather in screen space: rain with splashes (docks), snow drifting with the camera (pass).
// Particles live in one capped pool; soft ones are drawn from pre-made puff sprites, the glowing
// ones additively. Nothing here touches the sim.
import { TAU, alpha, canvas, clamp, puff } from './gfx.js';

// kind → [sprite colour (null: drawn), additive, layer (0 under the cars, 1 over)]
const KIND = {
  smoke: ['#cfcfcf', false, 1], soot: ['#191614', false, 1], dust: [null, false, 0], spray: ['#e8f0f8', false, 0],
  snow: ['#ffffff', false, 0], fire: ['#ff7a20', true, 1], core: ['#ffe4a8', true, 1], flash: ['#fff1d8', true, 1],
  spark: [null, true, 1], debris: [null, false, 0], ring: [null, true, 1], muzzle: [null, true, 1], glint: [null, true, 1],
  steam: ['#f4f6f8', false, 1], ember: [null, true, 1],
};

export function createFx({ max = 1800 } = {}) {
  const P = [];
  const sprites = {};
  const sprite = col => (sprites[col] ??= puff(64, col, 0.3));
  let dustCol = '#c8a080';
  const rand = Math.random;

  function add(kind, x, y, vx, vy, life, size, o = {}) {
    if (P.length >= max) { if (kind === 'smoke' || kind === 'dust' || kind === 'spray') return; P.shift(); }
    P.push({ kind, x, y, vx, vy, life, max: life, size, grow: o.grow ?? 0, drag: o.drag ?? 2, a: o.a ?? 1, rot: o.rot ?? rand() * TAU, vr: o.vr ?? 0, col: o.col, len: o.len ?? 0 });
  }
  const api = {
    get count() { return P.length; },
    setDust(c) { dustCol = c; },
    clear() { P.length = 0; },
    add,
    smoke(x, y, vx, vy, k = 1) { add('smoke', x, y, vx * 0.3 + (rand() - 0.5), vy * 0.3 + (rand() - 0.5), 0.9 + rand() * 0.8, 0.8 + rand() * 0.6, { grow: 1.5 * k, a: 0.5 * k, drag: 1.5, vr: (rand() - 0.5) }); },
    soot(x, y, k = 1) { add('soot', x, y, (rand() - 0.5) * 1.2 + 1.2, (rand() - 0.5) * 1.2 - 0.6, 1.4 + rand() * 1.2, 0.6 + rand() * 0.5, { grow: 0.85, a: 0.55 * k, drag: 0.6, vr: (rand() - 0.5) }); },
    dust(x, y, vx, vy, k = 1, col) { add('dust', x, y, vx * 0.25 + (rand() - 0.5) * 2, vy * 0.25 + (rand() - 0.5) * 2, 0.7 + rand() * 0.7, 0.9 + rand() * 0.6, { grow: 1.5, a: 0.42 * k, col: col ?? dustCol, drag: 1.8 }); },
    spray(x, y, vx, vy, k = 1, col = '#e8f0f8') {
      for (let i = 0; i < 2; i++) { const a = Math.atan2(vy, vx) + Math.PI + (rand() - 0.5) * 1.6, v = 3 + rand() * 5; add('spray', x, y, Math.cos(a) * v + vx * 0.3, Math.sin(a) * v + vy * 0.3, 0.3 + rand() * 0.3, 0.12 + rand() * 0.14, { grow: 0.6, a: 0.8 * k, col, drag: 3 }); }
    },
    sparks(x, y, n, dir = null, sp = 14) {
      for (let i = 0; i < n; i++) { const a = dir == null ? rand() * TAU : dir + (rand() - 0.5) * 1.4, v = sp * (0.4 + rand() * 0.8); add('spark', x, y, Math.cos(a) * v, Math.sin(a) * v, 0.18 + rand() * 0.3, 0.05 + rand() * 0.05, { drag: 4, col: rand() < 0.5 ? '#fff4c8' : '#ffb040' }); }
    },
    debris(x, y, n, sp = 9, col = '#2a2624') {
      for (let i = 0; i < n; i++) { const a = rand() * TAU, v = sp * (0.3 + rand()); add('debris', x, y, Math.cos(a) * v, Math.sin(a) * v, 1.2 + rand() * 1.2, 0.12 + rand() * 0.28, { drag: 2.6, vr: (rand() - 0.5) * 20, col: rand() < 0.3 ? '#5a5048' : col }); }
    },
    fire(x, y, k = 1) {
      add('fire', x + (rand() - 0.5) * 0.6, y + (rand() - 0.5) * 0.6, (rand() - 0.5) * 1.5 + 0.8, (rand() - 0.5) * 1.5 - 0.8, 0.35 + rand() * 0.35, 0.5 + rand() * 0.5 * k, { grow: -0.6, a: 0.75, drag: 1 });
      if (rand() < 0.5) add('core', x + (rand() - 0.5) * 0.4, y + (rand() - 0.5) * 0.4, 0, 0, 0.2 + rand() * 0.15, 0.35 * k, { grow: -0.8, a: 0.8 });
    },
    ember(x, y) { const a = rand() * TAU, v = 1 + rand() * 3; add('ember', x, y, Math.cos(a) * v + 1, Math.sin(a) * v - 1, 0.6 + rand() * 0.8, 0.05, { drag: 0.8 }); },
    boom(x, y, big = 1) {
      add('flash', x, y, 0, 0, 0.22, 7 * big, { grow: 8, a: 1 });
      add('ring', x, y, 0, 0, 0.45, 1, { grow: 26 * big });
      for (let i = 0; i < 18 * big; i++) { const a = rand() * TAU, v = 4 + rand() * 9 * big; add('fire', x, y, Math.cos(a) * v, Math.sin(a) * v, 0.4 + rand() * 0.5, 1.0 + rand() * 1.4 * big, { grow: 1.5, a: 0.9, drag: 3.5 }); }
      for (let i = 0; i < 8 * big; i++) { const a = rand() * TAU, v = 2 + rand() * 4; add('core', x, y, Math.cos(a) * v, Math.sin(a) * v, 0.25 + rand() * 0.2, 1.2 + rand() * big, { grow: 2, a: 1, drag: 3 }); }
      for (let i = 0; i < 16 * big; i++) { const a = rand() * TAU, v = 2 + rand() * 6; add('soot', x, y, Math.cos(a) * v, Math.sin(a) * v, 1.4 + rand() * 1.4, 1.2 + rand() * 1.0, { grow: 1.3, a: 0.7, drag: 1.6, vr: (rand() - 0.5) }); }
      api.sparks(x, y, 26 * big, null, 22);
      api.debris(x, y, 14 * big, 14);
      for (let i = 0; i < 8; i++) api.ember(x, y);
    },
    muzzle(x, y, a) {
      add('muzzle', x, y, 0, 0, 0.06, 0.9, { rot: a });
      add('smoke', x + Math.cos(a) * 0.4, y + Math.sin(a) * 0.4, Math.cos(a) * 2, Math.sin(a) * 2, 0.35, 0.25, { grow: 1.2, a: 0.25, drag: 3 });
    },
    glint(x, y, col) {
      add('ring', x, y, 0, 0, 0.5, 0.4, { grow: 7, col });
      for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, v = 3 + rand() * 3; add('glint', x, y, Math.cos(a) * v, Math.sin(a) * v, 0.45 + rand() * 0.3, 0.12, { drag: 3, col }); }
    },
    step(dt) {
      if (dt <= 0) return;
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i];
        p.life -= dt;
        if (p.life <= 0) { P[i] = P[P.length - 1]; P.pop(); continue; }
        const f = Math.exp(-p.drag * dt);
        p.vx *= f; p.vy *= f; p.x += p.vx * dt; p.y += p.vy * dt;
        p.size = Math.max(0.01, p.size + p.grow * dt); p.rot += p.vr * dt;
      }
    },
    /** layer 0: under the cars (dust, spray, debris), 1: over them */
    draw(g, v, layer) {
      const { P: S } = v, cx = v.cw / 2 - v.x * S + v.sx, cy = v.ch / 2 - v.y * S + v.sy, mx = v.cw / S / 2 + 6, my = v.ch / S / 2 + 6;
      let add = false;
      const mode = on => { if (on !== add) { g.globalCompositeOperation = on ? 'lighter' : 'source-over'; add = on; } };
      for (const p of P) {
        const K = KIND[p.kind];
        if (K[2] !== layer || Math.abs(p.x - v.x) > mx || Math.abs(p.y - v.y) > my) continue;
        const q = clamp(p.life / p.max, 0, 1), X = cx + p.x * S, Y = cy + p.y * S, r = p.size * S;
        mode(K[1]);
        switch (p.kind) {
          case 'spark': case 'glint': case 'ember': {
            g.globalAlpha = q; g.strokeStyle = p.col ?? '#ffb040'; g.lineWidth = Math.max(1, p.size * S * (p.kind === 'ember' ? 1.5 : 1));
            g.beginPath(); g.moveTo(X, Y); g.lineTo(X - p.vx * 0.035 * S, Y - p.vy * 0.035 * S); g.stroke();
            break;
          }
          case 'debris': {
            g.globalAlpha = Math.min(1, q * 3); g.fillStyle = p.col;
            g.save(); g.translate(X, Y); g.rotate(p.rot); g.fillRect(-r / 2, -r / 3, r, r * 0.66); g.restore();
            break;
          }
          case 'ring': {
            g.globalAlpha = q * 0.7; g.strokeStyle = p.col ?? '#ffe0b0'; g.lineWidth = Math.max(1, (0.15 + q * 0.5) * S);
            g.beginPath(); g.arc(X, Y, r, 0, TAU); g.stroke();
            break;
          }
          case 'muzzle': {
            g.globalAlpha = 1; g.save(); g.translate(X, Y); g.rotate(p.rot);
            g.drawImage(sprite('#ffcf6a'), -r * 0.6, -r * 0.6, r * 1.2, r * 1.2);
            g.fillStyle = '#fff6d8'; g.beginPath(); g.moveTo(0, -r * 0.18); g.lineTo(r * 1.1, 0); g.lineTo(0, r * 0.18); g.lineTo(r * 0.25, 0); g.closePath(); g.fill();
            g.beginPath(); g.moveTo(r * 0.1, 0); g.lineTo(r * 0.45, -r * 0.4); g.lineTo(r * 0.3, 0); g.lineTo(r * 0.45, r * 0.4); g.closePath(); g.fill();
            g.restore();
            break;
          }
          default: {
            const col = K[0] ?? p.col;
            // smoke and fire fade in fast and out slow; fire shifts toward soot as it dies
            const a = p.a * (p.kind === 'flash' ? q * q : Math.min(1, (1 - q) * 6) * q);
            g.globalAlpha = clamp(a, 0, 1);
            g.drawImage(sprite(col), X - r, Y - r, r * 2, r * 2);
          }
        }
      }
      mode(false); g.globalAlpha = 1;
    },
  };
  return api;
}

// ---------- weather, in screen space ----------
export function createWeather(kind, { n = 260 } = {}) {
  const R = Math.random, drops = [];
  for (let i = 0; i < n; i++) drops.push({ x: R(), y: R(), z: 0.4 + R() * 0.6, ph: R() * TAU });
  const splashes = [];
  let lastX = null, lastY = null;
  return {
    kind,
    draw(g, v, dt, t) {
      const { cw, ch, u = ch / 1080 } = v;
      // the camera's move this frame, so near flakes slide past faster than far ones
      const mx = lastX == null ? 0 : (v.x - lastX) * v.P, my = lastY == null ? 0 : (v.y - lastY) * v.P;
      lastX = v.x; lastY = v.y;
      if (kind === 'rain') {
        g.strokeStyle = 'rgba(200,215,235,0.35)'; g.lineCap = 'round';
        g.beginPath();
        for (const d of drops) {
          d.y += dt * (2.2 + d.z * 1.6) * (ch / cw) * 1.6; d.x += dt * 0.12 * d.z;
          d.x -= (mx * d.z * 1.2) / cw; d.y -= (my * d.z * 1.2) / ch;
          d.x -= Math.floor(d.x); d.y -= Math.floor(d.y);
          const X = d.x * cw, Y = d.y * ch, l = (18 + d.z * 26) * u;
          g.lineWidth = (1 + d.z * 1.4) * u;
          g.moveTo(X, Y); g.lineTo(X - l * 0.18, Y - l);
        }
        g.stroke();
        // splashes on the ground: small rings that open and fade
        for (let i = 0; i < dt * 140; i++) splashes.push({ x: R() * cw, y: R() * ch, t: 0 });
        g.strokeStyle = 'rgba(210,225,240,0.5)'; g.lineWidth = 1.2 * u;
        g.beginPath();
        for (const s of splashes) { s.t += dt; s.x -= mx; s.y -= my; const r = (2 + s.t * 40) * u * (v.P / 36); g.moveTo(s.x + r, s.y); g.ellipse(s.x, s.y, r, r * 0.8, 0, 0, TAU); }
        g.globalAlpha = 0.6; g.stroke(); g.globalAlpha = 1;
        for (let i = splashes.length - 1; i >= 0; i--) if (splashes[i].t > 0.25) splashes.splice(i, 1);
        g.lineCap = 'butt';
      } else if (kind === 'snow') {
        g.fillStyle = 'rgba(255,255,255,0.85)';
        for (const d of drops) {
          d.ph += dt * (0.8 + d.z);
          d.x += dt * (0.025 + Math.sin(d.ph) * 0.02) * d.z; d.y += dt * 0.05 * d.z;
          d.x -= (mx * (0.6 + d.z * 0.8)) / cw; d.y -= (my * (0.6 + d.z * 0.8)) / ch;
          d.x -= Math.floor(d.x); d.y -= Math.floor(d.y);
          const r = (1.4 + d.z * d.z * 4.5) * u;
          g.globalAlpha = 0.45 + d.z * 0.5;
          g.beginPath(); g.arc(d.x * cw, d.y * ch, r, 0, TAU); g.fill();
        }
        g.globalAlpha = 1;
      }
      void t;
    },
  };
}

/** a cached screen-sized grade per theme: vignette, tint, light falling across the frame */
export function grade(theme, cw, ch) {
  const c = canvas(cw, ch), g = c.getContext('2d'), m = Math.max(cw, ch);
  const vig = (col, a, r0 = 0.45) => { const gr = g.createRadialGradient(cw / 2, ch / 2, m * r0 * 0.5, cw / 2, ch / 2, m * 0.75); gr.addColorStop(0, alpha(col, 0)); gr.addColorStop(1, alpha(col, a)); g.fillStyle = gr; g.fillRect(0, 0, cw, ch); };
  const sun = (col, a) => { const gr = g.createLinearGradient(0, 0, cw, ch); gr.addColorStop(0, alpha(col, a)); gr.addColorStop(0.6, alpha(col, 0)); g.fillStyle = gr; g.fillRect(0, 0, cw, ch); };
  if (theme === 'canyon') { sun('#ffcf8a', 0.16); vig('#3a1206', 0.5); }
  else if (theme === 'docks') { g.fillStyle = 'rgba(70,90,110,0.12)'; g.fillRect(0, 0, cw, ch); vig('#0a1018', 0.6); }
  else if (theme === 'pass') { sun('#ffffff', 0.18); vig('#1a2a48', 0.42); }
  else { vig('#05040a', 0.78, 0.3); }
  return c;
}
