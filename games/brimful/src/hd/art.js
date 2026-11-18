// HD venue art: palettes and the static layers of each venue, painted once per venue and size
// into offscreen canvases. Coordinates are a 1920 × 1080 reference frame; `u` scales to pixels.
//   back:  sky, scenery and the wall behind the customers
//   front: counters, dispensers and doors, drawn over the customers
export const REF_W = 1920, REF_H = 1080;
export const HUD_H = 96, TOP = 108, BAND = 242, X0 = 262, U = 70;
export const COUNTER = 150; // counter top, from a band's top
export const rowY = r => TOP + r * BAND;

export const ART = {
  pier: {
    sky: ['#251a4d', '#6a2f78', '#d4527c', '#ffa25e', '#ffd38a'], sea: ['#2c5d9c', '#173a70', '#0e2550'],
    top: '#fff3e4', topEdge: '#ff5d7e', front: '#36b5ad', frontDark: '#227f7c', trim: '#ffffff', floor: '#8a5a3c',
    drink: '#ff7aa6', drinkDark: '#d84a7c', foam: '#fff6f2', glass: 'rgba(220,240,255,0.55)', metal: ['#f4f7fb', '#9aa7b8', '#5b6578'],
    door: '#a0583e', doorDark: '#6b3626', light: '#ffb070', accent: '#ff6f91', hud: '#ffe1c2', shirt: ['#ffd166', '#4ecdc4', '#ff8fab', '#a0e7e5', '#f9c74f', '#90be6d'],
  },
  lodge: {
    sky: ['#0d1430', '#18244a', '#24345f', '#33497a', '#4a6595'], sea: ['#e8f1ff', '#b9cbe6', '#8fa5c8'],
    top: '#8a5634', topEdge: '#d9a441', front: '#5a3420', frontDark: '#3a2014', trim: '#e8c172', floor: '#4a2a18',
    drink: '#8b4a2b', drinkDark: '#5e2e18', foam: '#fff1dc', glass: 'rgba(255,240,220,0.5)', metal: ['#ffe7b0', '#c8964a', '#7a5626'],
    door: '#6e3f24', doorDark: '#43240f', light: '#ffb347', accent: '#ffcc66', hud: '#ffe9c4', shirt: ['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#e9c46a', '#8ab17d'],
  },
  market: {
    sky: ['#0b0620', '#1c0d3a', '#341255', '#4e1a62', '#6b2468'], sea: ['#1b0f33', '#120a24', '#0a0616'],
    top: '#c8342b', topEdge: '#ffcf5a', front: '#7a1f2b', frontDark: '#4e1220', trim: '#ffcf5a', floor: '#2a1838',
    drink: '#c9a27a', drinkDark: '#8a6440', foam: '#f5e6cf', glass: 'rgba(255,230,210,0.5)', metal: ['#ffe2a8', '#d29a3c', '#8a5a1c'],
    door: '#3a1f3f', doorDark: '#22102a', light: '#ff8a3c', accent: '#ffcf5a', hud: '#ffe3b0', shirt: ['#06d6a0', '#ef476f', '#ffd166', '#118ab2', '#f78c6b', '#83c5be'],
  },
  moon: {
    sky: ['#010208', '#03061a', '#060b2a', '#0a1238', '#101a48'], sea: ['#7c7f8e', '#55586a', '#33364a'],
    top: '#e9eef8', topEdge: '#46f0ff', front: '#2b3350', frontDark: '#1a2036', trim: '#46f0ff', floor: '#1c2238',
    drink: '#6bff9e', drinkDark: '#22c46a', foam: '#e8fff0', glass: 'rgba(200,255,255,0.45)', metal: ['#f0f6ff', '#a6b4cc', '#5a6884'],
    door: '#384463', doorDark: '#232b44', light: '#46f0ff', accent: '#9b8cff', hud: '#d8f7ff', shirt: ['#ff9f1c', '#cbf3f0', '#ff6b9d', '#8ac926', '#b8b8ff', '#ffbf69'],
  },
};

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}
// a soft round light, white in the middle; tinted copies are made per colour
const glows = new Map();
export function glowSprite(col) {
  let c = glows.get(col);
  if (!c) {
    c = canvas(128, 128);
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, col); gr.addColorStop(0.35, col + '88'); gr.addColorStop(1, col + '00');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    glows.set(col, c);
  }
  return c;
}
export function glow(g, col, x, y, r, a = 1) {
  const pa = g.globalAlpha, op = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = pa * a;
  g.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = pa; g.globalCompositeOperation = op;
}
const vgrad = (g, y0, y1, stops) => {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => gr.addColorStop(i / (stops.length - 1), c));
  return gr;
};
// deterministic scatter
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// ---------- the back layer ----------
export function paintBack(g, id, rows) {
  const A = ART[id];
  g.fillStyle = vgrad(g, 0, REF_H, A.sky); g.fillRect(0, 0, REF_W, REF_H);
  if (id === 'pier') {
    // sun low over the sea, the sea below the horizon
    glow(g, '#ffcf8a', 1380, 330, 420, 0.8);
    g.fillStyle = '#fff0c8'; g.beginPath(); g.arc(1380, 330, 92, 0, Math.PI * 2); g.fill();
    g.fillStyle = vgrad(g, 360, REF_H, A.sea); g.fillRect(0, 360, REF_W, REF_H - 360);
    for (let i = 0; i < 90; i++) {
      const y = 370 + hash(i) * 700, w = 40 + hash(i + 9) * 160;
      g.fillStyle = `rgba(255,${190 + hash(i + 3) * 60 | 0},170,${0.12 + 0.25 * (1 - (y - 360) / 720)})`;
      g.fillRect(hash(i + 5) * REF_W, y, w, 4);
    }
    // the pier stretching out, with posts
    g.fillStyle = '#3a2238';
    for (let x = 0; x < REF_W; x += 120) g.fillRect(x, 300, 16, 70);
  } else if (id === 'lodge') {
    // a log wall
    for (let y = HUD_H; y < REF_H; y += 44) {
      g.fillStyle = vgrad(g, y, y + 44, ['#7a4a2c', '#5c341d', '#3f2212']);
      g.fillRect(0, y, REF_W, 44);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y + 40, REF_W, 4);
      for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(255,220,160,0.05)'; g.fillRect(hash(y + k) * REF_W, y + 10, 140, 3); }
    }
  } else if (id === 'market') {
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,240,255,${0.2 + hash(i) * 0.6})`; const s = 1 + hash(i + 2) * 2.5; g.fillRect(hash(i + 7) * REF_W, hash(i + 11) * REF_H, s, s); }
    glow(g, '#ff9a4a', 960, 1100, 900, 0.35);
  } else {
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(220,235,255,${0.25 + hash(i) * 0.75})`; const s = 1 + hash(i + 2) * 2.6; g.fillRect(hash(i + 7) * REF_W, hash(i + 11) * REF_H, s, s); }
    // Earth over the crater rim
    glow(g, '#5ab4ff', 1560, 250, 260, 0.5);
    const e = g.createRadialGradient(1530, 220, 10, 1560, 250, 110);
    e.addColorStop(0, '#9fe0ff'); e.addColorStop(0.6, '#2f7fd6'); e.addColorStop(1, '#123a7a');
    g.fillStyle = e; g.beginPath(); g.arc(1560, 250, 110, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(120,220,140,0.75)';
    g.beginPath(); g.ellipse(1530, 230, 40, 26, 0.6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(1600, 290, 30, 18, -0.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,20,0.45)'; g.beginPath(); g.arc(1600, 270, 110, -0.3, 2.2); g.fill();
  }
  // each band's wall strip behind the customers
  rows.forEach((row, r) => {
    const y0 = rowY(r), ex = X0 + row.len * U;
    if (id === 'pier') {
      // a railing at the edge of the boardwalk, sea behind
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(X0 - 60, y0 + 92, ex - X0 + 140, 7);
      for (let x = X0 - 40; x < ex + 80; x += 54) g.fillRect(x, y0 + 92, 6, 58);
      g.fillStyle = 'rgba(40,20,60,0.35)'; g.fillRect(X0 - 60, y0 + 120, ex - X0 + 140, 30);
    } else if (id === 'lodge') {
      // windows on the snowy night
      for (let k = 0; k < 4; k++) {
        const wx = 520 + k * 300, wy = y0 + 14, ww = 150, wh = 104;
        g.fillStyle = '#2a1608'; g.fillRect(wx - 12, wy - 12, ww + 24, wh + 24);
        g.fillStyle = vgrad(g, wy, wy + wh, ['#0d1736', '#203560', '#3d5a8a']); g.fillRect(wx, wy, ww, wh);
        g.fillStyle = '#e8f1ff'; g.fillRect(wx, wy + wh - 18, ww, 18);
        for (let p = 0; p < 3; p++) {
          const px = wx + 25 + p * 50, h = 50 + hash(k * 3 + p + r) * 20;
          g.fillStyle = '#1f4a3a'; g.beginPath(); g.moveTo(px, wy + wh - 18 - h); g.lineTo(px - 20, wy + wh - 14); g.lineTo(px + 20, wy + wh - 14); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.moveTo(px, wy + wh - 18 - h); g.lineTo(px - 8, wy + wh - 4 - h * 0.7); g.lineTo(px + 8, wy + wh - 4 - h * 0.7); g.fill();
        }
        g.fillStyle = '#2a1608'; g.fillRect(wx + ww / 2 - 4, wy, 8, wh); g.fillRect(wx, wy + wh / 2 - 4, ww, 8);
        glow(g, '#ffb347', wx + ww / 2, wy + wh + 60, 160, 0.25);
      }
      // a fireplace glow on the wall near the dispensers
      glow(g, '#ff8a2a', 200, y0 + 120, 200, 0.18);
    } else if (id === 'market') {
      // stall awnings in alternating stripes
      for (let x = X0 - 40, k = 0; x < ex + 80; x += 90, k++) {
        g.fillStyle = k % 2 ? '#1f8a70' : '#e8493f';
        g.beginPath(); g.moveTo(x, y0 + 12); g.lineTo(x + 90, y0 + 12); g.lineTo(x + 80, y0 + 52); g.quadraticCurveTo(x + 45, y0 + 64, x + 10, y0 + 52); g.closePath(); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y0 + 12, 90, 8);
      }
      g.fillStyle = 'rgba(10,4,20,0.4)'; g.fillRect(X0 - 60, y0 + 64, ex - X0 + 140, 90);
    } else {
      // dome struts glowing faintly
      g.strokeStyle = 'rgba(70,240,255,0.35)'; g.lineWidth = 4;
      for (let x = X0 + 40; x < ex + 60; x += 180) { g.beginPath(); g.moveTo(x, y0 + 4); g.lineTo(x + 40, y0 + 150); g.stroke(); }
      g.beginPath(); g.moveTo(X0 - 60, y0 + 6); g.lineTo(ex + 80, y0 + 6); g.stroke();
      // the crater floor beyond the glass
      g.fillStyle = vgrad(g, y0 + 104, y0 + 150, ['#5e6275', '#34374a']);
      g.beginPath(); g.moveTo(X0 - 60, y0 + 150);
      for (let x = X0 - 60; x <= ex + 80; x += 40) g.lineTo(x, y0 + 112 + Math.sin(x * 0.013 + r) * 10 + hash(x + r) * 8);
      g.lineTo(ex + 80, y0 + 150); g.fill();
    }
  });
  // the HUD band
  g.fillStyle = 'rgba(0,0,0,0.42)'; g.fillRect(0, 0, REF_W, HUD_H);
}

// ---------- the front layer ----------
export function paintFront(g, id, rows) {
  const A = ART[id];
  rows.forEach((row, r) => {
    const y0 = rowY(r), cy = y0 + COUNTER, ex = X0 + row.len * U;
    // the floor Pip walks on
    const fy = cy + 58, fh = y0 + BAND - fy;
    g.fillStyle = vgrad(g, fy, fy + fh, [shade(A.floor, 0.12), A.floor]);
    g.fillRect(0, fy, ex + 120, fh);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    if (id === 'pier') for (let x = 0; x < ex + 120; x += 64) g.fillRect(x, fy, 3, fh);
    else if (id === 'lodge') { g.fillStyle = 'rgba(200,60,50,0.35)'; g.fillRect(0, fy + 8, ex + 120, fh - 16); }
    else if (id === 'market') for (let x = 0; x < ex + 120; x += 40) g.fillRect(x, fy + ((x / 40) % 2) * (fh / 2), 40, fh / 2);
    else { g.fillStyle = 'rgba(70,240,255,0.18)'; g.fillRect(0, fy, ex + 120, 2); for (let x = 0; x < ex + 120; x += 90) g.fillRect(x, fy, 2, fh); }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, fy + fh - 4, ex + 120, 4);
    // door at the far end
    g.fillStyle = A.doorDark; g.beginPath(); g.roundRect(ex + 4, y0 + 18, 86, cy - y0 - 14, [18, 18, 0, 0]); g.fill();
    g.fillStyle = A.door; g.beginPath(); g.roundRect(ex + 14, y0 + 28, 66, cy - y0 - 24, [12, 12, 0, 0]); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(ex + 47, y0 + 62, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = A.trim; g.beginPath(); g.arc(ex + 68, y0 + 100, 5, 0, Math.PI * 2); g.fill();
    // counter: front panel, then the top slab with its edge
    g.fillStyle = vgrad(g, cy + 10, cy + 60, [A.front, A.frontDark]);
    g.beginPath(); g.roundRect(X0 - 56, cy + 8, ex - X0 + 66, 52, [0, 0, 8, 8]); g.fill();
    g.save(); g.beginPath(); g.rect(X0 - 56, cy + 8, ex - X0 + 66, 52); g.clip();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    if (id === 'pier') for (let x = X0 - 50; x < ex + 10; x += 36) g.fillRect(x, cy + 8, 6, 52);
    else if (id === 'lodge') for (let k = 0; k < 3; k++) g.fillRect(X0 - 56, cy + 18 + k * 14, ex - X0 + 66, 4);
    else if (id === 'market') for (let x = X0 - 50; x < ex + 10; x += 46) { g.beginPath(); g.arc(x, cy + 34, 14, 0, Math.PI * 2); g.fill(); }
    else { g.fillStyle = 'rgba(70,240,255,0.55)'; g.fillRect(X0 - 56, cy + 30, ex - X0 + 66, 3); }
    g.restore();
    g.fillStyle = vgrad(g, cy - 12, cy + 10, [A.top, shade(A.top, -0.18)]);
    g.beginPath(); g.roundRect(X0 - 64, cy - 12, ex - X0 + 82, 22, 8); g.fill();
    g.fillStyle = A.topEdge; g.fillRect(X0 - 60, cy + 6, ex - X0 + 74, 5);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(X0 - 52, cy - 10, ex - X0 + 60, 3);
    // the dispenser
    drawDispenser(g, A, y0, cy);
  });
}
function drawDispenser(g, A, y0, cy) {
  const x = 52, w = 150, top = y0 + 20;
  const M = A.metal;
  // body
  g.fillStyle = vgrad(g, top, cy + 10, [M[0], M[1], M[2]]);
  g.beginPath(); g.roundRect(x, top, w, cy - top + 4, [30, 30, 10, 10]); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(x + 14, top + 16, 8, cy - top - 30);
  // the tank window with the drink in it
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.roundRect(x + 30, top + 18, w - 60, 70, 14); g.fill();
  g.fillStyle = vgrad(g, top + 36, top + 86, [A.drink, A.drinkDark]); g.beginPath(); g.roundRect(x + 36, top + 36, w - 72, 46, 10); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 42, top + 40, 10, 34);
  // arm and spout reaching over the counter end
  g.fillStyle = M[1]; g.beginPath(); g.roundRect(x + w - 10, top + 30, X0 - (x + w) + 22, 16, 8); g.fill();
  g.fillStyle = M[2]; g.beginPath(); g.roundRect(X0 - 10, top + 38, 20, 30, 6); g.fill();
  g.fillStyle = M[0]; g.beginPath(); g.arc(x + w / 2, top + 110, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = A.accent; g.beginPath(); g.arc(x + w / 2, top + 110, 9, 0, Math.PI * 2); g.fill();
}
// lighten (t > 0) or darken a #rrggbb colour
export function shade(hex, t) {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = c => Math.round(t > 0 ? c + (255 - c) * t : c * (1 + t));
  const r = f(n >> 16), gg = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1);
}
