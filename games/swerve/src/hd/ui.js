// Drawing kit for Swerve's screens, in the look of 90s TV football graphics: navy caption
// panels with a chalk rule and a yellow tab, slanted name straps, a mown pitch behind it all,
// Saira Condensed for every word (Bowlby One for the logo only). Everything works in the
// 1920 × 1080 space the renderer scales the context to. Whatever can be tapped records its
// rectangle as it is drawn (hot), so hitAt() answers with what the screen showed there.
import { drawPrompt } from '@nostalgia/input';
import { shirtLook } from '../clubs.js';

export const W = 1920, H = 1080, TAU = Math.PI * 2;
export const FONT = "'Saira Condensed','Arial Narrow',sans-serif";
export const LOGO = "'Bowlby One','Arial Black',Impact,sans-serif";
export const COL = {
  navy: '#0d1b2a', navy2: '#17324f', navy3: '#21466c', chalk: '#f4f1e8', dim: 'rgba(244,241,232,0.64)',
  faint: 'rgba(244,241,232,0.32)', ghost: 'rgba(244,241,232,0.1)', yellow: '#ffd23f', amber: '#f5a623',
  red: '#e63946', ok: '#7bd88f', up: '#5fd38a', down: '#ff6b6b', grass: '#17663a', grassD: '#0f4d2a', ink: '#0d1b2a',
};
export const clamp01 = v => Math.max(0, Math.min(1, v || 0));
export const ease = q => q * q * (3 - 2 * q);
export const blink = (t, hz = 2) => Math.floor(t * hz) % 2 === 0;
export function alpha(hex, a) {
  if (hex[0] !== '#') return hex;
  const h = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1, 7), n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** black or chalk, whichever reads on a colour */
export function inkOn(hex) {
  const h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16);
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return l > 150 ? COL.ink : COL.chalk;
}

// ---------- the tap map ----------
let rects = [], rectsFor = null;
export function beginHits(state) { rects = []; rectsFor = state; }
export const hot = (x, y, w, h, hit) => rects.push({ x, y, w, h, hit });
export function hitAt(state, x, y) {
  if (state !== rectsFor) return null;
  for (let k = rects.length - 1; k >= 0; k--) {
    const r = rects[k];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.hit;
  }
  return null;
}
/** for test harnesses: every text squeezed to fit, { s, w, max } */
export const debug = { squeezed: [], hits: () => rects.slice() };

// ---------- type ----------
export function font(g, size, wgt = 700) { g.font = `${wgt} ${size}px ${FONT}`; }
export function measure(g, s, size, wgt = 700, spacing = 0) {
  font(g, size, wgt);
  if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
  const w = g.measureText(String(s)).width;
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  return w;
}
/** a line of text; `max` squeezes it to fit (and notes the squeeze for the test harness) */
export function text(g, s, x, y, size, col, { wgt = 700, align = 'left', spacing = 0, shadow = false, max = 0, face = FONT, italic = false } = {}) {
  s = String(s ?? '');
  g.font = `${italic ? 'italic ' : ''}${face === LOGO ? 400 : wgt} ${size}px ${face}`;
  g.textAlign = align; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
  if (max) {
    const w = g.measureText(s).width;
    if (w > max) debug.squeezed.push({ s, w: Math.round(w), max: Math.round(max) });
  }
  const fill = (dx, dy) => {
    if (max) g.fillText(s, x + dx, y + dy, max);
    else g.fillText(s, x + dx, y + dy);
  };
  if (shadow) { g.fillStyle = 'rgba(0,0,0,0.55)'; fill(2, 3); }
  g.fillStyle = col;
  fill(0, 0);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}
/** words broken into lines that fit w at this size */
export function wrap(g, s, size, w, wgt = 500) {
  font(g, size, wgt);
  const out = [];
  let line = '';
  for (const word of String(s).split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (line && g.measureText(next).width > w) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}
const PST = { font: FONT };
export function prompt(g, app, s, x, y, size, col = COL.dim, align = 'center') {
  if (!app.input) return;
  drawPrompt(g, app.input, s, x, y, { font: `700 ${size}px ${FONT}`, size: size * 1.25, color: col, align, letterSpacing: 1, style: PST });
}

// ---------- shapes ----------
export function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
/** a navy caption panel: a glassy gradient, a chalk hairline on top, a yellow tab on the left */
export function panel(g, x, y, w, h, { a = 0.88, tab = true, edge = null, lw = 2 } = {}) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, `rgba(27,52,82,${a})`); gr.addColorStop(0.12, `rgba(16,34,54,${a})`); gr.addColorStop(1, `rgba(9,20,33,${a})`);
  rr(g, x, y, w, h, 6);
  g.fillStyle = gr; g.fill();
  if (edge) { g.strokeStyle = edge; g.lineWidth = lw; g.stroke(); }
  g.fillStyle = 'rgba(244,241,232,0.35)'; g.fillRect(x + 6, y + 1, w - 12, 2);
  if (tab) { g.fillStyle = COL.yellow; g.fillRect(x, y + 10, 6, Math.min(48, h - 20)); }
}
/** a slanted strap: a menu entry, a button; yellow when picked */
export function strap(g, x, y, w, h, sel, t = 0, { col = COL.yellow } = {}) {
  const k = h * 0.32;
  g.beginPath(); g.moveTo(x + k, y); g.lineTo(x + w, y); g.lineTo(x + w - k, y + h); g.lineTo(x, y + h); g.closePath();
  if (sel) {
    const glow = 0.6 + Math.sin(t * 5) * 0.25;
    g.save();
    g.shadowColor = alpha(col, 0.55 * glow); g.shadowBlur = 24;
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, '#fff1a8'); gr.addColorStop(0.45, col); gr.addColorStop(1, '#d9a400');
    g.fillStyle = col === COL.yellow ? gr : col; g.fill();
    g.restore();
    // a sheen running along it
    g.save(); g.clip();
    const sx = x - 200 + ((t * 420) % (w + 400));
    const sg = g.createLinearGradient(sx, 0, sx + 160, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.35)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg; g.fillRect(x, y, w, h);
    g.restore();
  } else {
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, 'rgba(33,70,108,0.92)'); gr.addColorStop(1, 'rgba(13,27,42,0.92)');
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(244,241,232,0.18)'; g.lineWidth = 2; g.stroke();
  }
}
export function button(g, x, y, w, h, label, sel, t, hit, { size = 32, col, sub = null } = {}) {
  strap(g, x, y, w, h, sel, t, { col });
  const k = h * 0.32;
  text(g, label, x + w / 2, y + h / 2 + size * 0.36 - (sub ? 8 : 0), size, sel ? COL.ink : COL.chalk, { wgt: 800, align: 'center', spacing: 2, max: w - k * 2 - 16 });
  if (sub) text(g, sub, x + w / 2, y + h / 2 + 24, 20, sel ? 'rgba(13,27,42,0.7)' : COL.dim, { wgt: 700, align: 'center', spacing: 1, max: w - k * 2 - 16 });
  if (hit) hot(x, y, w, h, hit);
}
/** ◀ ▶ either side of a row, each a tap target ({ d: -1 | 1, row }) */
export function arrows(g, x, y, w, h, row, sel, t) {
  const s = h * 0.32, cy = y + h / 2, wob = sel ? Math.sin(t * 6) * 3 : 0;
  g.fillStyle = sel ? COL.ink : COL.faint;
  g.beginPath(); g.moveTo(x + 14 - wob, cy); g.lineTo(x + 14 + s * 1.1 - wob, cy - s); g.lineTo(x + 14 + s * 1.1 - wob, cy + s); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(x + w - 14 + wob, cy); g.lineTo(x + w - 14 - s * 1.1 + wob, cy - s); g.lineTo(x + w - 14 - s * 1.1 + wob, cy + s); g.closePath(); g.fill();
  hot(x, y, h * 1.2, h, { d: -1, row });
  hot(x + w - h * 1.2, y, h * 1.2, h, { d: 1, row });
}
export function bar(g, x, y, w, h, q, col, back = 'rgba(244,241,232,0.1)') {
  g.fillStyle = back; g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x, y, w * clamp01(q), h);
}
/** n of 5 stars, half ones too */
export function stars(g, n, x, y, size, col = COL.yellow) {
  for (let k = 0; k < 5; k++) {
    const cx = x + k * size * 1.15 + size / 2, cy = y, f = clamp01(n - k);
    const path = () => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? size * 0.22 : size * 0.5, a = -Math.PI / 2 + (i * Math.PI) / 5;
        if (i) g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        else g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.closePath();
    };
    path(); g.fillStyle = 'rgba(244,241,232,0.14)'; g.fill();
    if (f > 0) {
      g.save(); g.beginPath(); g.rect(cx - size / 2, cy - size / 2, size * f, size); g.clip();
      path(); g.fillStyle = col; g.fill(); g.restore();
    }
  }
}

// ---------- the pitch behind every screen ----------
export function backdrop(g, t, { dark = 0.45 } = {}) {
  const n = 12, sw = W / n;
  for (let k = 0; k < n; k++) {
    g.fillStyle = k % 2 ? '#145a32' : '#17663a';
    g.fillRect(k * sw, 0, sw + 1, H);
  }
  // chalk: the halfway line and centre circle, seen sideways, drifting slowly
  g.save();
  g.globalAlpha = 0.16;
  g.strokeStyle = '#f4f1e8'; g.lineWidth = 6;
  const ox = Math.sin(t * 0.07) * 40;
  g.beginPath(); g.moveTo(W / 2 + ox, -10); g.lineTo(W / 2 + ox, H + 10); g.stroke();
  g.beginPath(); g.arc(W / 2 + ox, H / 2, 210, 0, TAU); g.stroke();
  g.beginPath(); g.rect(-6, H / 2 - 330, 300, 660); g.stroke();
  g.beginPath(); g.rect(W - 294, H / 2 - 330, 300, 660); g.stroke();
  g.restore();
  // night falls at the edges
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 1.0);
  vg.addColorStop(0, `rgba(4,14,9,${dark * 0.3})`); vg.addColorStop(1, `rgba(2,8,5,${Math.min(0.95, dark + 0.35)})`);
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
}

// ---------- kits ----------
/** a shirt in a club's kit, centred on x, y, s tall; the shorts beneath when `shorts` */
export function shirt(g, kit, x, y, s, { shorts = false, num = null } = {}) {
  if (!kit) return;
  const w = s * 1.1, hw = w / 2, top = y - s / 2;
  const path = () => {
    g.beginPath();
    g.moveTo(x - hw * 0.42, top);
    g.quadraticCurveTo(x, top + s * 0.12, x + hw * 0.42, top);
    g.lineTo(x + hw, top + s * 0.16); g.lineTo(x + hw * 0.82, top + s * 0.42); g.lineTo(x + hw * 0.62, top + s * 0.36);
    g.lineTo(x + hw * 0.62, top + s); g.lineTo(x - hw * 0.62, top + s); g.lineTo(x - hw * 0.62, top + s * 0.36);
    g.lineTo(x - hw * 0.82, top + s * 0.42); g.lineTo(x - hw, top + s * 0.16);
    g.closePath();
  };
  g.save();
  path();
  g.fillStyle = kit.shirt; g.fill();
  g.clip();
  g.fillStyle = kit.trim ?? kit.shirt;
  const p = kit.pattern;
  if (p === 'stripes') for (let k = -3; k <= 3; k += 2) g.fillRect(x + (k * w) / 8 - w / 16, top, w / 8, s);
  else if (p === 'hoops') for (let k = 1; k < 7; k += 2) g.fillRect(x - hw, top + (k * s) / 7, w, s / 7);
  else if (p === 'halves') g.fillRect(x, top, hw, s);
  else if (p === 'sash') { g.beginPath(); g.moveTo(x - hw * 0.62, top + s * 0.1); g.lineTo(x - hw * 0.3, top); g.lineTo(x + hw * 0.62, top + s * 0.78); g.lineTo(x + hw * 0.62, top + s); g.closePath(); g.fill(); }
  // collar and cuffs in the trim
  g.fillStyle = kit.trim ?? kit.shirt;
  g.beginPath(); g.moveTo(x - hw * 0.42, top); g.quadraticCurveTo(x, top + s * 0.12, x + hw * 0.42, top); g.lineTo(x + hw * 0.3, top); g.quadraticCurveTo(x, top + s * 0.2, x - hw * 0.3, top); g.closePath(); g.fill();
  // a fold of shade
  const sh = g.createLinearGradient(x - hw, 0, x + hw, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0.25)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.08)'); sh.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = sh; g.fillRect(x - hw, top, w, s);
  g.restore();
  path(); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = Math.max(1.5, s * 0.03); g.stroke();
  if (num != null) text(g, String(num), x, top + s * 0.68, s * 0.42, inkOn(shirtLook(kit)), { wgt: 800, align: 'center' });
  if (shorts) {
    const sy = top + s * 1.04, sh2 = s * 0.34;
    g.fillStyle = kit.shorts;
    g.beginPath(); g.moveTo(x - hw * 0.62, sy); g.lineTo(x + hw * 0.62, sy); g.lineTo(x + hw * 0.7, sy + sh2); g.lineTo(x + hw * 0.06, sy + sh2); g.lineTo(x, sy + sh2 * 0.5); g.lineTo(x - hw * 0.06, sy + sh2); g.lineTo(x - hw * 0.7, sy + sh2); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = Math.max(1.5, s * 0.03); g.stroke();
    g.fillStyle = kit.socks;
    g.fillRect(x - hw * 0.6, sy + sh2 + s * 0.06, hw * 0.4, s * 0.3);
    g.fillRect(x + hw * 0.2, sy + sh2 + s * 0.06, hw * 0.4, s * 0.3);
  }
}

// ---------- a formation on a little pitch ----------
/** slots ({ role, x 0…1 across, y 0…1 from the own goal }) drawn on a pitch, own goal at the
 *  bottom; `labels[i]` under each dot; `sel` / `mark` slot indexes lit; hits { slot } when `tap` */
export function formation(g, slots, x, y, w, h, { kit = null, gk = null, labels = null, nums = null, sel = -1, mark = -1, tap = null, size = 1, t = 0 } = {}) {
  g.save();
  rr(g, x, y, w, h, 8);
  g.clip();
  const n = 8;
  for (let k = 0; k < n; k++) { g.fillStyle = k % 2 ? '#155d34' : '#196b3c'; g.fillRect(x, y + (k * h) / n, w, h / n + 1); }
  g.strokeStyle = 'rgba(244,241,232,0.5)'; g.lineWidth = 2;
  const m = 10;
  g.strokeRect(x + m, y + m, w - m * 2, h - m * 2);
  g.beginPath(); g.moveTo(x + m, y + h / 2); g.lineTo(x + w - m, y + h / 2); g.stroke();
  g.beginPath(); g.arc(x + w / 2, y + h / 2, w * 0.13, 0, TAU); g.stroke();
  const bw = w * 0.56, bh = h * 0.15;
  g.strokeRect(x + (w - bw) / 2, y + m, bw, bh); g.strokeRect(x + (w - bw) / 2, y + h - m - bh, bw, bh);
  g.restore();
  const r = 20 * size;
  (slots ?? []).forEach((sl, i) => {
    const px = x + m + 18 + sl.x * (w - m * 2 - 36), py = y + h - m - 24 - sl.y * (h - m * 2 - 48);
    const k = i === 0 ? gk ?? kit : kit;
    if (i === mark || i === sel) {
      g.fillStyle = i === mark ? alpha(COL.yellow, 0.35 + 0.2 * Math.sin(t * 8)) : 'rgba(255,210,63,0.25)';
      g.beginPath(); g.arc(px, py, r * 1.6, 0, TAU); g.fill();
    }
    if (k) shirt(g, k, px, py, r * 1.6, { num: nums?.[i] ?? null });
    else {
      g.fillStyle = sl.role === 'GK' ? COL.amber : COL.chalk;
      g.beginPath(); g.arc(px, py, r * 0.6, 0, TAU); g.fill();
    }
    if (labels?.[i]) text(g, labels[i], px, py + r * 1.35 + 14 * size, 19 * size, i === sel || i === mark ? COL.yellow : COL.chalk, { wgt: 700, align: 'center', shadow: true, max: Math.max(60, (w / 5.2)) });
    if (tap) hot(px - r * 1.6, py - r * 1.4, r * 3.2, r * 3.2, { ...tap, slot: i });
  });
}
