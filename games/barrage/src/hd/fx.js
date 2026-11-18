// Render-only effects in reference units (1920 × 1080): fireballs, shock rings, debris, smoke,
// sparks, embers, beam traces, damage and cash numbers, screen shake and flash. Fed by sim
// events; stepped by wall time; capped so a big chain stays cheap.
import { glow, glowSprite } from './field.js';

const TAU = Math.PI * 2;
const MAX_PARTS = 900;

export function createFx() {
  let parts = [], booms = [], pops = [], beams = [], rings = [];
  const S = { shake: 0, flash: 0, flashCol: '#ffffff' };
  const rand = Math.random;
  function part(p) { if (parts.length < MAX_PARTS) parts.push(p); }
  function spray(x, y, n, o) {
    for (let i = 0; i < n; i++) {
      const a = o.dir != null ? o.dir + (rand() - 0.5) * (o.spread ?? 1) : rand() * TAU, s = (o.speed ?? 300) * (0.25 + rand() * 0.75);
      part({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.lift ?? 0), life: (o.life ?? 1) * (0.5 + rand() * 0.6), max: o.life ?? 1, size: (o.size ?? 5) * (0.5 + rand()), col: o.cols[(rand() * o.cols.length) | 0], grav: o.grav ?? 900, kind: o.kind ?? 'debris', drag: o.drag ?? 0.6, rot: rand() * TAU, spin: (rand() - 0.5) * 12 });
    }
  }
  function boom(x, y, r, kind, col, ground) {
    const k = Math.min(1, r / 130);
    booms.push({ x, y, r, t: 0, life: 0.55 + k * 0.9, kind, col });
    rings.push({ x, y, r0: r * 0.4, r1: r * (kind === 'ion' ? 2.2 : 1.7), t: 0, life: 0.45 + k * 0.5, col: kind === 'ion' ? '#c9a8ff' : '#fff0d0' });
    S.shake = Math.min(28, S.shake + 4 + r * 0.22);
    if (r >= 70) { S.flash = Math.max(S.flash, 0.55 + k * 0.3); S.flashCol = kind === 'ion' ? '#d8c0ff' : '#fff6e0'; }
    const hot = kind === 'ion' ? ['#ffffff', '#d6b8ff', '#9a6aff'] : ['#ffffff', '#fff2b0', '#ffc060', '#ff7a2a'];
    spray(x, y, Math.min(70, 10 + r * 0.6), { cols: hot, speed: 260 + r * 7, life: 0.45 + k * 0.5, size: 3 + k * 2, grav: 300, kind: 'spark', drag: 2.2 });
    if (kind !== 'ion') {
      const smoke = Math.min(26, 4 + r * 0.22);
      for (let i = 0; i < smoke; i++) {
        const a = rand() * TAU, d = rand() * r * 0.9;
        part({ x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.7, vx: (rand() - 0.5) * 50, vy: -30 - rand() * 60, life: 1.6 + rand() * 1.8 + k, max: 2.8 + k, size: 16 + r * 0.5 * rand() + 10, col: rand() < 0.5 ? '#4a4248' : '#6a6268', grav: -14, kind: 'smoke', drag: 0.4 });
      }
    }
    if (ground) spray(x, y, Math.min(60, 8 + r * 0.45), { cols: ground, speed: 200 + r * 5, life: 1.3, size: 4 + k * 4, grav: 1300, lift: 120, kind: 'debris', drag: 0.3 });
  }
  function pop(x, y, text, col, size = 34) { pops.push({ x, y, text, col, size, t: 0, life: 1.3 }); }
  /** A running total under one key (burn ticks, cash trickles): one number that keeps counting. */
  function tally(key, x, y, amount, fmt, col, size = 30) {
    const p = pops.find(q => q.key === key && q.t < 0.8);
    if (p) { p.sum += amount; p.text = fmt(p.sum); p.t = Math.min(p.t, 0.25); p.size = Math.min(size * 1.5, size + Math.sqrt(p.sum)); return; }
    pops.push({ x, y, text: fmt(amount), col, size, t: 0, life: 1.3, key, sum: amount });
  }
  function beam(pts, col) { beams.push({ pts, col, t: 0, life: 0.75 }); S.shake = Math.min(28, S.shake + 6); }

  function step(dt) {
    for (const p of parts) {
      p.life -= dt;
      p.vy += p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.kind === 'smoke') p.size += dt * 14;
    }
    parts = parts.filter(p => p.life > 0 && p.y < 1300);
    for (const b of booms) b.t += dt;
    booms = booms.filter(b => b.t < b.life);
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < r.life);
    for (const p of pops) { p.t += dt; p.y -= dt * 46; }
    pops = pops.filter(p => p.t < p.life);
    for (const b of beams) b.t += dt;
    beams = beams.filter(b => b.t < b.life);
    S.shake = Math.max(0, S.shake - dt * 46);
    S.flash = Math.max(0, S.flash - dt * 1.6);
  }

  function drawBack(g) {
    // smoke sits behind the tanks and fire
    for (const p of parts) {
      if (p.kind !== 'smoke') continue;
      const a = Math.min(1, p.life / p.max) * 0.3;
      g.globalAlpha = a; g.drawImage(glowSprite(p.col), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    g.globalAlpha = 1;
  }
  function drawFront(g) {
    for (const b of booms) {
      const k = b.t / b.life, grow = Math.min(1, b.t / (0.06 + b.r / 900)), r = b.r * (0.35 + 0.75 * grow);
      const a = 1 - k;
      if (b.kind === 'ion') {
        glow(g, '#9a6aff', b.x, b.y, r * 2.4, a * 0.9);
        glow(g, '#ffffff', b.x, b.y, r * 0.9 * (1 - k), a);
        g.strokeStyle = `rgba(214,190,255,${a * 0.9})`; g.lineWidth = 3;
        for (let i = 0; i < 7; i++) {
          const a0 = (i / 7) * TAU + b.t * 3;
          g.beginPath(); g.moveTo(b.x, b.y);
          for (let s = 1; s <= 5; s++) g.lineTo(b.x + Math.cos(a0 + Math.sin(s * 7 + b.t * 30) * 0.3) * r * (s / 5), b.y + Math.sin(a0 + Math.cos(s * 5 + b.t * 30) * 0.3) * r * (s / 5));
          g.stroke();
        }
        continue;
      }
      glow(g, b.col ?? '#ff8a3a', b.x, b.y, r * 2.6, a * 0.85);
      const gr = g.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      gr.addColorStop(0, `rgba(255,255,240,${a})`);
      gr.addColorStop(0.35, `rgba(255,214,120,${a * 0.95})`);
      gr.addColorStop(0.7, `rgba(255,110,40,${a * 0.75})`);
      gr.addColorStop(1, 'rgba(120,30,20,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, r, 0, TAU); g.fill();
      if (b.t < 0.09) glow(g, '#ffffff', b.x, b.y, r * 1.4, 1 - b.t / 0.09);
    }
    for (const r of rings) {
      const k = r.t / r.life, rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      g.strokeStyle = r.col; g.globalAlpha = (1 - k) * 0.7; g.lineWidth = 2 + (1 - k) * 8;
      g.beginPath(); g.arc(r.x, r.y, rad, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
    for (const p of parts) {
      if (p.kind === 'smoke') continue;
      const a = Math.min(1, p.life / (p.max * 0.5));
      if (p.kind === 'spark' || p.kind === 'ember') {
        glow(g, p.col, p.x, p.y, p.size * 2.4, a);
      } else {
        g.globalAlpha = a; g.fillStyle = p.col;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8); g.restore();
      }
    }
    g.globalAlpha = 1;
    for (const b of beams) {
      const a = 1 - b.t / b.life;
      for (const [w, col, al] of [[34, b.col, 0.25], [14, b.col, 0.6], [5, '#ffffff', 1]]) {
        g.strokeStyle = col; g.globalAlpha = a * al; g.lineWidth = w * (0.6 + a * 0.4); g.lineCap = 'round';
        g.beginPath();
        b.pts.forEach((p, i) => { if (i === 0 || b.pts[i - 1].cut) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); });
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }
  function drawPops(g, font) {
    for (const p of pops) {
      const k = p.t / p.life, a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3, s = p.size * (k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : 1.1 - Math.min(0.1, k));
      g.globalAlpha = a; g.font = `700 ${s}px ${font}`; g.textAlign = 'center'; g.lineJoin = 'round';
      g.strokeStyle = 'rgba(10,6,16,0.85)'; g.lineWidth = 7; g.strokeText(p.text, p.x, p.y);
      g.fillStyle = p.col; g.fillText(p.text, p.x, p.y);
    }
    g.globalAlpha = 1; g.textAlign = 'left';
  }
  function clear() { parts = []; booms = []; pops = []; beams = []; rings = []; S.shake = 0; S.flash = 0; }
  return Object.assign(S, { spray, part, boom, pop, tally, beam, step, drawBack, drawFront, drawPops, clear, get count() { return parts.length; } });
}
