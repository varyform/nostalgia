// The HD renderer: draws the simulation and the app's screens as vectors at the window's own
// resolution, 16:9. It frames the room being played and lets the wider view show the edges of
// its neighbours on the zone grid; the camera eases from room to room instead of flipping.
// It only reads state, exactly like the VGA renderer.
//
//   const view = createHdRenderer(canvas);
//   view.events(sim.events, sim);
//   view.draw(app);
import { drawGlyphs, drawPrompt, glyphs, measureGlyphs } from '@nostalgia/input';
import { COLS, MAP_COLS, ROOMS, ROWS, ZONES, roomAt } from '../world.js';
import { FORMS, UPGRADES } from '../sim.js';
import { C, ZONE_PAL } from '../vga/palette.js';
import { canvas, drawDoor, makeBackdrop, mix, paintRoom, rgba } from './art.js';
import {
  drawBlock, drawBoss, drawCore, drawEnemy, drawEnergy, drawForm, drawGen, drawPlate, drawPod, drawProbe, drawSwitch, drawUpgrade, glow,
} from './sprites.js';

const VH = 26, VW = (VH * 16) / 9; // tiles in view: a room (40 × 23) plus a margin of its neighbours
const F = "'Chakra Petch','Segoe UI',system-ui,sans-serif";
const DARK = [0.42, 0.36, 0.5, 0.45]; // ambient darkness per zone, lit up around lights
const FORM_COL = { android: C.steel, raptor: C.amber, tank: C.olive };
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pad6 = n => String(Math.max(0, n | 0)).padStart(6, '0');
const clock = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');

export function createHdRenderer(cv) {
  const g = cv.getContext('2d');
  const offs = [];
  let cw = 1, ch = 1, ts = 1, u = 1, vign = null, destroyed = false, lastApp = null;
  const lc = document.createElement('canvas'), lg = lc.getContext('2d');
  let layers = new Map(), backdrops = {}, thumbs = new Map();
  // the largest 16:9 box in the window, at device resolution (capped)
  function fit() {
    let w = innerWidth, h = innerHeight;
    if (w / h > 16 / 9) w = (h * 16) / 9; else h = (w * 9) / 16;
    const dpr = Math.min(devicePixelRatio || 1, 2, 2560 / w);
    cv.style.width = Math.round(w) + 'px'; cv.style.height = Math.round(h) + 'px';
    cw = cv.width = Math.round(w * dpr); ch = cv.height = Math.round(h * dpr);
    ts = ch / VH; u = ch / 1080;
    lc.width = Math.ceil(cw / 2); lc.height = Math.ceil(ch / 2);
    vign = canvas(cw, ch);
    const v = vign.getContext('2d'), gr = v.createRadialGradient(cw / 2, ch / 2, ch * 0.35, cw / 2, ch / 2, cw * 0.62);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
    v.fillStyle = gr; v.fillRect(0, 0, cw, ch);
    layers = new Map(); backdrops = {}; thumbs = new Map();
  }
  const listen = (t, type, fn) => { t.addEventListener(type, fn); offs.push(() => t.removeEventListener(type, fn)); };
  listen(window, 'resize', fit);
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) listen(document, ev, fit);
  fit();
  // the still demo frame is drawn once; draw it again when the web font arrives
  void document.fonts?.ready.then(() => { if (!destroyed && lastApp) draw(lastApp); });

  // a soft black disc: punched out of the darkness buffer around each light
  const LIGHT = canvas(128, 128);
  {
    const x = LIGHT.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  }

  // ---------- text ----------
  const font = (size, wgt = 600) => { g.font = `${wgt} ${Math.round(size * u)}px ${F}`; };
  function label(s, x, y, size, col, wgt = 600, align = 'left', spacing = 0) {
    font(size, wgt); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    g.fillText(s, x, y);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.textAlign = 'left';
  }
  function labelW(s, size, wgt = 600, spacing = 0) {
    font(size, wgt);
    if ('letterSpacing' in g) g.letterSpacing = spacing * u + 'px';
    const w = g.measureText(s).width;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    return w;
  }
  const GST = { font: F };
  // a line with {action} glyphs, its vertical centre at y
  const prompt = (input, s, x, y, size, col, align = 'left', wgt = 600) =>
    drawPrompt(g, input, s, x, y, { font: `${wgt} ${Math.round(size * u)}px ${F}`, size: size * 1.35 * u, color: col, align, letterSpacing: 2 * u, style: GST });
  // rows of [action, label, all?] pairs in aligned columns, centred on cx
  function legend(input, rows, cx, y, pitch = 46, size = 22) {
    const gs = size * 1.3 * u, gap = 6 * u, gw = [], lw = [];
    const gl = (a, all) => glyphs(input, a, all);
    for (const r of rows) r.forEach(([a, l, all], k) => { gw[k] = Math.max(gw[k] || 0, measureGlyphs(g, gl(a, all), gs, GST, gap)); lw[k] = Math.max(lw[k] || 0, labelW(l, size, 600, 2)); });
    const colGap = 48 * u, inner = 14 * u;
    const total = gw.reduce((w, x, k) => w + (k ? colGap : 0) + x + inner + lw[k], 0);
    rows.forEach((r, i) => {
      let x = cx - total / 2;
      const yc = y + i * pitch * u;
      r.forEach(([a, l, all], k) => {
        const list = gl(a, all);
        drawGlyphs(g, list, x + gw[k] - measureGlyphs(g, list, gs, GST, gap), yc, gs, GST, gap);
        label(l, x + gw[k] + inner, yc + size * 0.36 * u, size, 'rgba(240,240,232,0.85)', 600, 'left', 2);
        x += gw[k] + inner + lw[k] + colGap;
      });
    });
  }
  function glass(x, y, w, h, r = 18, a = 0.62) {
    g.fillStyle = `rgba(8,10,16,${a})`; g.beginPath(); g.roundRect(x, y, w, h, r * u); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1.5 * u; g.stroke();
  }
  const shade = (a, x = 0, y = 0, w = cw, h = ch) => { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(x, y, w, h); };

  // ---------- particles (world tiles, global coordinates) ----------
  let parts = [], shake = 0, flash = 0, flashCol = '#ffffff';
  const rand = Math.random;
  const P = (x, y, vx, vy, life, col, size = 0.12, grav = 0, gl = null) => parts.push({ x, y, vx, vy, life, max: life, col, size, grav, gl });
  function burst(x, y, n, cols, speed = 8, life = 0.6, grav = 15, size = 0.12, gl = null) {
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, s = speed * (0.3 + rand() * 0.7);
      P(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + rand() * 0.5), cols[Math.floor(rand() * cols.length)], size * (0.6 + rand() * 0.8), grav, gl);
    }
  }
  function events(list, sim) {
    const r = sim?.room;
    if (!r) return;
    const ox = r.col * COLS, oy = r.row * ROWS, Z = ZONE_PAL[r.zone];
    for (const e of list) {
      const x = e.x + ox, y = e.y + oy;
      switch (e.type) {
        case 'boom': burst(x, y, e.big ? 50 : 22, [C.yellow[4], C.amber[5], C.red[3], C.steel[2]], e.big ? 14 : 9, 0.9, 8, e.big ? 0.22 : 0.14, 'orange'); shake = Math.max(shake, e.big ? 0.35 : 0.14); break;
        case 'die': burst(x, y, 70, [C.white, C.yellow[4], C.amber[4], C.red[3], C.steel[3]], 15, 1.3, 10, 0.2, 'amber'); shake = 0.55; flash = 0.18; flashCol = '#ffffff'; break;
        case 'crunch': shake = Math.max(shake, 0.2); break;
        case 'debris': burst(x, y, 6, C.grate, 9, 1, 32, 0.22); break;
        case 'steam': for (let i = 0; i < 3; i++) P(x + rand() - 0.5, y, rand() * 1.2 - 0.6, -2.5 - rand() * 2.5, 1.3, C.ice[3 + (i & 1)], 0.3, -1.2); break;
        case 'melt': case 'shatter': burst(x, y, 26, [C.ice[3], C.ice[4], C.white], 10, 0.9, 25, 0.14, 'ice'); break;
        case 'spark': burst(x, y, e.src === 'shell' ? 12 : 6, e.src === 'shell' ? [C.amber[5], C.yellow[4], C.steel[3]] : [C.cyan[3], C.white], 7, 0.35, 12, 0.1, e.src === 'shell' ? 'amber' : 'cyan'); if (e.src === 'shell') shake = Math.max(shake, 0.08); break;
        case 'tink': burst(x, y, 7, [C.white, C.steel[4]], 8, 0.25, 0, 0.08, 'white'); break;
        case 'hit': burst(x, y, 8, [C.white, C.yellow[4]], 7, 0.3, 6, 0.1, 'yellow'); break;
        case 'cannon': shake = Math.max(shake, 0.08); burst(x, y, 10, [C.yellow[4], C.amber[5], C.steel[2]], 5, 0.4, -3, 0.16, 'amber'); break;
        case 'zap': burst(x, y - 1, 20, [C.yellow[4], C.cyan[3], C.white], 11, 0.45, 0, 0.1, 'cyan'); flash = 0.08; flashCol = C.yellow[4]; break;
        case 'pit': flash = 0.12; flashCol = C.red[2]; break;
        case 'warp': burst(x, y, 16, [C.cyan[3], C.white], 5, 0.6, 0, 0.12, 'cyan'); break;
        case 'hurt': flash = 0.06; flashCol = C.red[3]; break;
        case 'morph': for (let i = 0; i < 30; i++) { const a = (i / 30) * TAU; P(x, y, Math.cos(a) * 9, Math.sin(a) * 6, 0.45, i % 2 ? C.white : C.cyan[3], 0.12, 0, 'cyan'); } break;
        case 'land': case 'leap': burst(x, y, e.type === 'leap' || e.hard ? 12 : 6, [Z.wall[4], Z.wall[5]], 5, 0.45, 12, 0.14); break;
        case 'pickup': case 'check': burst(x, y, 18, [C.green[3], C.green[4], C.white], 6, 0.7, -4, 0.12, 'green'); break;
        case 'upgrade': burst(x, y, 50, [C.white, C.yellow[4], C.cyan[3]], 11, 1.1, 0, 0.14, 'white'); flash = 0.14; flashCol = '#ffffff'; break;
        case 'switch': burst(x, y, 12, [C.green[3], C.white], 6, 0.45, 0, 0.1, 'green'); break;
        case 'splash': burst(x, y, 8, e.kind === 'icicle' ? [C.ice[3], C.white] : e.kind === 'blob' ? [C.amber[5], C.yellow[4]] : [C.red[3], C.red[4]], 6, 0.45, 20, 0.12, e.kind === 'icicle' ? 'ice' : 'orange'); break;
        case 'bossdead': flash = 0.3; flashCol = '#ffffff'; shake = 0.6; break;
        case 'phase': flash = 0.22; flashCol = C.red[3]; break;
        case 'field': burst(x, y, 24, [C.cyan[3], C.white], 10, 0.55, 0, 0.12, 'cyan'); break;
        case 'thud': shake = Math.max(shake, 0.15); burst(x, y, 12, [Z.wall[4], C.steel[3]], 5, 0.5, 15, 0.16); break;
      }
    }
  }
  function stepParts(dt) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    parts = parts.filter(p => p.life > 0);
    if (parts.length > 900) parts.splice(0, parts.length - 900);
    shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
  }

  // ---------- camera ----------
  let cam = null, curRoom = null, prevId = null, enterT = 1;
  function camera(sim, dt) {
    const r = sim.room, p = sim.p;
    if (r !== curRoom) {
      const near = curRoom && Math.abs(curRoom.col - r.col) + Math.abs(curRoom.row - r.row) === 1;
      prevId = curRoom && curRoom.id !== r.id ? curRoom.id : null;
      if (!near) cam = null;
      if (curRoom?.id !== r.id) enterT = near ? 0 : 1;
      curRoom = r;
    }
    enterT = Math.min(1, enterT + dt / 0.45);
    // centre on the room, leaning a little toward the player
    const pcx = p ? p.x + p.w / 2 : COLS / 2, pcy = p ? p.y + p.h / 2 : ROWS / 2;
    const tx = r.col * COLS + COLS / 2 + clamp((pcx - COLS / 2) / (COLS / 2), -1, 1) * 1.6;
    const ty = r.row * ROWS + ROWS / 2 + clamp((pcy - ROWS / 2) / (ROWS / 2), -1, 1) * 0.5;
    if (!cam) cam = { x: tx, y: ty };
    const k = 1 - Math.exp(-dt * 7);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  }

  // ---------- room layers ----------
  // One canvas per room, repainted only when its tiles change. Neighbours are painted at most
  // one per frame, so walking into a new part of the map never costs more than one paint.
  let paintBudget = 1;
  const sigOf = rows => rows.map(r => (typeof r === 'string' ? r : r.join(''))).join('');
  function layerFor(def, sim, current) {
    const m = sim.mem[def.id], visits = m?.visits ?? 0, version = current ? sim.room.version : -1;
    const e = layers.get(def.id);
    if (e && e.visits === visits && (!current || e.version === version)) return e.cv;
    const tiles = m?.tiles ?? def.map, sig = sigOf(tiles);
    if (e && e.sig === sig) { e.visits = visits; e.version = version; return e.cv; }
    if (!current) { if (paintBudget <= 0) return e?.cv ?? null; paintBudget--; }
    const cv2 = paintRoom(tiles, def.zone, ts);
    layers.set(def.id, { visits, version, sig, cv: cv2 });
    if (layers.size > 8) for (const k of layers.keys()) if (k !== def.id && k !== sim.room.id) { layers.delete(k); break; }
    return cv2;
  }
  // runs of liquid and live rail in the current room, animated on top of the layer
  let hazards = [], hazardKey = '';
  function hazardsOf(r) {
    const key = r.id + ':' + r.version + ':' + r.mem.visits;
    if (key === hazardKey) return;
    hazardKey = key; hazards = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; ) {
        const c = r.tiles[y][x];
        if ((c === '~' && r.tiles[y - 1]?.[x] !== '~') || c === '!') {
          let x1 = x;
          while (x1 < COLS && r.tiles[y][x1] === c && (c === '!' || r.tiles[y - 1]?.[x1] !== '~')) x1++;
          hazards.push({ x0: x, x1, y, c });
          x = x1;
        } else x++;
      }
  }

  // ---------- world ----------
  let lights = [];
  const light = (x, y, r, a = 1) => lights.push(x, y, r, a);
  let amb = [], ambZone = -1;
  function ambient(z, dt, ox, oy) {
    if (z !== ambZone) { amb = []; ambZone = z; }
    if (amb.length < 60 && rand() < 0.6) {
      if (z === 0 || z === 3) amb.push({ x: rand() * VW, y: VH + 0.5, vx: rand() * 0.8 - 0.4, vy: -1.5 - rand() * 2.2, life: 12, k: z === 0 ? 'orange' : 'pink', s: 0.05 + rand() * 0.06 });
      else if (z === 1) amb.push({ x: rand() * VW, y: -0.5, vx: 0.3 + rand() * 0.4, vy: 1 + rand() * 1, life: 30, k: 'ice', s: 0.05 + rand() * 0.06 });
      else amb.push({ x: rand() * VW, y: rand() * VH, vx: 0, vy: 0, life: 0.4 + rand() * 0.9, k: rand() < 0.5 ? 'white' : 'green', s: 0.04 + rand() * 0.04, tw: true });
    }
    for (const a of amb) {
      a.x += a.vx * dt + (z === 0 ? Math.sin(a.y * 1.3) * 0.01 : 0); a.y += a.vy * dt; a.life -= dt;
      const al = a.tw ? Math.sin((a.life / 1.3) * Math.PI) : 0.8;
      glow(g, a.k, ox + a.x * ts, oy + a.y * ts, a.s * ts * 3, al * 0.8);
    }
    amb = amb.filter(a => a.life > 0 && a.y > -1 && a.y < VH + 1);
  }

  let bdZone = -1, bdPrev = -1, bdK = 1;
  function backdrop(z, camX, dt) {
    if (z !== bdZone) { bdPrev = bdZone; bdZone = z; bdK = bdPrev < 0 ? 1 : 0; }
    bdK = Math.min(1, bdK + dt / 0.6);
    const one = (zz, a) => {
      const bd = (backdrops[zz] ??= makeBackdrop(zz, cw, ch));
      g.globalAlpha = a;
      for (const [img, f] of [[bd.far, 0.08], [bd.mid, 0.25]]) {
        const off = -(((camX * ts * f) % cw) + cw) % cw;
        g.drawImage(img, Math.round(off), 0); g.drawImage(img, Math.round(off) + cw, 0);
      }
      g.globalAlpha = 1;
    };
    if (bdK < 1 && bdPrev >= 0) one(bdPrev, 1);
    one(z, bdK);
  }

  function drawLiquid(h, P2, t) {
    const { x0, x1, y } = h;
    g.beginPath(); g.moveTo(x0, y + 0.45);
    for (let x = x0; x <= x1 + 0.001; x += 0.25) g.lineTo(x, y + 0.06 + Math.sin(x * 2.1 + t * 3.2) * 0.06 + Math.sin(x * 0.9 - t * 1.7) * 0.05);
    g.lineTo(x1, y + 0.45); g.closePath();
    const gr = g.createLinearGradient(0, y, 0, y + 0.45);
    gr.addColorStop(0, P2.liquid[5]); gr.addColorStop(0.35, P2.liquid[4]); gr.addColorStop(1, rgba(P2.liquid[3], 0));
    g.fillStyle = gr; g.fill();
    const key = h.zone === 1 ? 'cyan' : h.zone === 2 ? 'pink' : 'orange';
    for (let x = x0 + 1; x < x1; x += 3) glow(g, key, x + 0.5, y + 0.1, 2.2, 0.35);
    // bubbles
    const n = Math.floor(t * 2);
    for (let k = 0; k < (x1 - x0) / 6; k++) {
      const bx = x0 + ((k * 7.3 + n * 3.1) % (x1 - x0)), ph = (t * 2) % 1;
      g.strokeStyle = rgba(P2.liquid[5], 1 - ph); g.lineWidth = 0.04;
      g.beginPath(); g.arc(bx, y + 0.05 - ph * 0.2, 0.08 + ph * 0.1, 0, TAU); g.stroke();
    }
  }
  function drawRail(h, t) {
    const { x0, x1, y } = h;
    g.fillStyle = (Math.floor(t * 8) % 2) ? C.yellow[3] : C.yellow[2];
    g.fillRect(x0, y, x1 - x0, 0.06);
    g.strokeStyle = rgba(C.cyan[3], 0.9); g.lineWidth = 0.05; g.lineJoin = 'bevel';
    for (let x = x0; x < x1; x += 2) {
      if ((Math.floor(t * 14) + x * 3) % 5 > 1) continue;
      g.beginPath(); g.moveTo(x, y);
      for (let i = 1; i <= 6; i++) g.lineTo(Math.min(x1, x + i * 0.33), y - 0.15 - rand() * 0.35);
      g.stroke();
      glow(g, 'cyan', x + 1, y - 0.2, 1.4, 0.6);
    }
  }

  function doorsOf(tiles, openOf, current, t) {
    // a door group's tiles form vertical runs; each run is one slab
    for (let x = 0; x < COLS; x++)
      for (let y = 0; y < ROWS; y++) {
        const c = tiles[y][x];
        if (c < '1' || c > '4' || (y > 0 && tiles[y - 1][x] === c)) continue;
        let len = 1;
        while (y + len < ROWS && tiles[y + len][x] === c) len++;
        const k = openOf(c);
        if (c === '4') {
          // the sentinel's force field
          if (k >= 1) continue;
          const gr = g.createLinearGradient(x, 0, x + 1, 0);
          gr.addColorStop(0, rgba(C.cyan[2], 0)); gr.addColorStop(0.5, rgba(C.cyan[3], 0.75)); gr.addColorStop(1, rgba(C.cyan[2], 0));
          g.fillStyle = gr; g.fillRect(x, y, 1, len);
          g.strokeStyle = rgba('#ffffff', 0.7); g.lineWidth = 0.05;
          g.beginPath();
          for (let j = 0; j <= len; j += 0.25) g.lineTo(x + 0.5 + Math.sin(j * 5 + t * 18) * 0.18, y + j);
          g.stroke();
          if (current) for (let j = 1; j < len; j += 2) { glow(g, 'cyan', x + 0.5, y + j, 1.4, 0.5); light(x + 0.5, y + j, 3, 0.6); }
          continue;
        }
        drawDoor(g, x, y, k, len);
        if (current && k < 1) glow(g, 'amber', x + 0.5, y + len * (1 - k) - 0.1, 0.6, 0.6);
      }
  }

  function drawFlame(p) {
    const f = p.face, x0 = f > 0 ? p.x + p.w - 0.1 : p.x + 0.1, y0 = p.y + 0.5;
    for (let i = 0; i < 16; i++) {
      const d = (i / 15) * 5.4, yy = y0 + (d / 5.4) * 0.7 + (rand() - 0.5) * 0.3 * (d / 5.4), r = 0.3 + d * 0.17;
      const key = i < 3 ? 'white' : i < 7 ? 'yellow' : i < 12 ? 'orange' : 'red';
      glow(g, key, x0 + f * d + (rand() - 0.5) * 0.2, yy, r * 1.6, 0.75 - i * 0.03);
    }
  }

  function drawPlayer(sim, now) {
    const p = sim.p;
    if (!p || sim.status === 'dead' || sim.status === 'gameover') return;
    const fx = p.x + p.w / 2, fy = p.y + p.h;
    if (p.inv > 0 && sim.status === 'play' && Math.floor(now * 20) % 2) g.globalAlpha = 0.45;
    if (p.morphT > 0) {
      const k = p.morphT / 0.3; // 1 → 0
      g.globalAlpha = k; drawForm(g, p.morphFrom, fx, fy, p, now);
      g.globalAlpha = 1 - k; drawForm(g, p.form, fx, fy, p, now);
      g.globalAlpha = 1;
      glow(g, 'white', fx, fy - 1.6, 2.5 + (1 - k) * 1.5, k);
      glow(g, 'cyan', fx, fy - 1.6, 4.5, 0.6);
      g.strokeStyle = rgba(C.cyan[3], k); g.lineWidth = 0.08;
      g.beginPath(); g.ellipse(fx, fy - 1.6, (1 - k) * 3.2 + 0.4, (1 - k) * 2.2 + 0.3, 0, 0, TAU); g.stroke();
      const sy = fy - 3.6 * (1 - k);
      g.fillStyle = rgba('#ffffff', 0.8); g.fillRect(fx - 1.8, sy, 3.6, 0.06);
    } else drawForm(g, p.form, fx, fy, p, now);
    g.globalAlpha = 1;
    if (p.flaming) drawFlame(p);
    if (p.probe) {
      const pr = p.probe, bx = pr.x + pr.w / 2, by = pr.y + pr.h / 2;
      g.strokeStyle = rgba(C.green[3], 0.5); g.lineWidth = 0.05; g.setLineDash([0.15, 0.15]); g.lineDashOffset = -now * 2;
      g.beginPath(); g.moveTo(fx - p.face * 0.1, fy - 2.7); g.lineTo(bx, by); g.stroke(); g.setLineDash([]);
      drawProbe(g, bx, by, now);
    }
  }

  function drawShots(r) {
    for (const o of r.shots) {
      const x = o.x + o.w / 2, y = o.y + o.h / 2, d = Math.sign(o.vx);
      if (o.src === 'bolt') {
        g.fillStyle = rgba(C.cyan[2], 0.5); g.beginPath(); g.roundRect(x - d * 0.9 - 0.45, y - 0.08, 0.9, 0.16, 0.08); g.fill();
        g.fillStyle = C.white; g.beginPath(); g.roundRect(x - 0.35, y - 0.1, 0.7, 0.2, 0.1); g.fill();
        glow(g, 'cyan', x, y, 1.1, 1);
      } else {
        g.fillStyle = rgba(C.amber[4], 0.45); g.beginPath(); g.roundRect(x - d * 1.1 - 0.55, y - 0.12, 1.1, 0.24, 0.12); g.fill();
        g.fillStyle = C.yellow[4]; g.beginPath(); g.roundRect(x - 0.38, y - 0.18, 0.76, 0.36, 0.16); g.fill();
        glow(g, 'amber', x, y, 1.3, 1);
      }
    }
    for (const o of r.eshots) {
      const x = o.x + o.w / 2, y = o.y + o.h / 2;
      if (o.kind === 'icicle') {
        g.fillStyle = C.ice[3]; g.beginPath(); g.moveTo(x - 0.22, y - 0.5); g.lineTo(x + 0.22, y - 0.5); g.lineTo(x, y + 0.55); g.fill();
        glow(g, 'ice', x, y, 0.9, 0.6);
      } else if (o.kind === 'blob') {
        g.fillStyle = C.amber[5]; g.beginPath(); g.arc(x, y, 0.38, 0, TAU); g.fill();
        g.fillStyle = C.yellow[4]; g.beginPath(); g.arc(x - 0.1, y - 0.1, 0.18, 0, TAU); g.fill();
        glow(g, 'orange', x, y, 1.6, 0.9);
      } else {
        g.fillStyle = C.red[4]; g.beginPath(); g.arc(x, y, 0.24, 0, TAU); g.fill();
        g.fillStyle = C.white; g.beginPath(); g.arc(x, y, 0.1, 0, TAU); g.fill();
        glow(g, 'red', x, y, 1.1, 1);
      }
    }
  }

  function drawWorld(app, dt) {
    const sim = app.sim, r = sim.room, z = r.zone, now = app.t;
    camera(sim, dt);
    paintBudget = 1;
    hazardsOf(r);
    lights = [];
    const sx = shake > 0 ? (rand() - 0.5) * 0.5 * Math.min(1, shake * 6) : 0;
    const sy = shake > 0 ? (rand() - 0.5) * 0.4 * Math.min(1, shake * 6) : 0;
    const camPx = Math.round((cam.x - VW / 2 + sx) * ts), camPy = Math.round((cam.y - VH / 2 + sy) * ts);
    g.setTransform(1, 0, 0, 1, 0, 0);
    backdrop(z, cam.x, dt);
    // rooms in view: this one, the edges of its neighbours, bulkhead where the grid is empty
    const c0 = Math.floor((cam.x - VW / 2) / COLS), c1 = Math.floor((cam.x + VW / 2) / COLS);
    const r0 = Math.floor((cam.y - VH / 2) / ROWS), r1 = Math.floor((cam.y + VH / 2) / ROWS);
    const order = [];
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) order.push([col, row]);
    // the current room first: it is always painted, the neighbours share the frame's budget
    order.sort((a, b) => (a[0] === r.col && a[1] === r.row ? -1 : 0) - (b[0] === r.col && b[1] === r.row ? -1 : 0));
    const drawn = [];
    for (const [col, row] of order) {
      const def = roomAt(col, row), X = Math.round(col * COLS * ts) - camPx, Y = Math.round(row * ROWS * ts) - camPy;
      const W2 = Math.round((col + 1) * COLS * ts) - camPx - X, H2 = Math.round((row + 1) * ROWS * ts) - camPy - Y;
      if (!def) { drawn.push({ X, Y, W2, H2 }); continue; }
      const current = def.id === r.id, img = layerFor(def, sim, current);
      drawn.push({ def, X, Y, W2, H2, img, current });
    }
    for (const d of drawn) {
      if (!d.def) {
        const gr = g.createLinearGradient(d.X, d.Y, d.X + d.W2, d.Y + d.H2);
        gr.addColorStop(0, ZONE_PAL[z].wall[0]); gr.addColorStop(1, '#000000');
        g.fillStyle = gr; g.fillRect(d.X, d.Y, d.W2, d.H2);
        continue;
      }
      if (d.img) g.drawImage(d.img, d.X, d.Y, d.W2, d.H2);
      g.setTransform(ts, 0, 0, ts, d.X, d.Y);
      if (d.current) {
        const P2 = ZONE_PAL[z];
        for (const h of hazards) { h.zone = z; if (h.c === '~') drawLiquid(h, P2, now); else drawRail(h, now); }
        doorsOf(r.tiles, c => r.doors[c].anim, true, now);
      } else {
        const m = sim.mem[d.def.id];
        doorsOf(m?.tiles ?? d.def.map, c => (m?.perm.has(+c) || m?.perm.has(c) ? 1 : 0), false, now);
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    // the rooms around are out of play: dimmed, easing as the camera moves over
    for (const d of drawn) {
      if (!d.def) continue;
      const a = d.current ? 0.55 * (1 - enterT) : d.def.id === prevId ? 0.55 * enterT : 0.55;
      if (a > 0.01) shade(a, d.X, d.Y, d.W2, d.H2);
    }
    const ox = Math.round(r.col * COLS * ts) - camPx, oy = Math.round(r.row * ROWS * ts) - camPy;
    g.setTransform(ts, 0, 0, ts, ox, oy);
    // lights from the props, then the darkness with those lights cut out of it
    for (const e of r.ents) {
      const lx = e.x + e.w / 2, ly = e.y + e.h / 2;
      if (e.kind === 'check' || e.kind === 'energy' || e.kind === 'upgrade' || e.kind === 'gen' || (e.kind === 'core' && !e.broken) || e.kind === 'switch') light(lx, ly, e.kind === 'upgrade' ? 6 : 3.5, 0.8);
    }
    for (const e of r.enemies) light(e.x + e.w / 2, e.y + e.h / 2, 2.5, 0.5);
    if (sim.boss && !sim.boss.dead) light(sim.boss.x + sim.boss.w / 2, sim.boss.y + sim.boss.h / 2, 8, 0.9);
    for (const q of parts) if (q.gl) light(q.x - r.col * COLS, q.y - r.row * ROWS, 1.5, 0.3 * (q.life / q.max));
    if (sim.p) light(sim.p.x + sim.p.w / 2, sim.p.y + sim.p.h / 2, 7, 1);
    if (sim.p?.probe) light(sim.p.probe.x, sim.p.probe.y, 4, 0.9);
    if (sim.p?.flaming) light(sim.p.x + sim.p.w / 2 + sim.p.face * 3, sim.p.y + 1.2, 7, 1);
    for (const o of r.shots) light(o.x, o.y, 3, 0.8);
    for (const o of r.eshots) light(o.x, o.y, 2.5, 0.6);
    for (const h of hazards) for (let x = h.x0 + 1; x < h.x1; x += 3) light(x, h.y, h.c === '~' ? 4 : 3, 0.6);
    g.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, lc.width, lc.height);
    lg.fillStyle = `rgba(0,0,0,${DARK[z]})`; lg.fillRect(0, 0, lc.width, lc.height);
    lg.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < lights.length; i += 4) {
      const lx = (ox + lights[i] * ts) / 2, ly = (oy + lights[i + 1] * ts) / 2, lr = (lights[i + 2] * ts) / 2;
      lg.globalAlpha = lights[i + 3];
      lg.drawImage(LIGHT, lx - lr, ly - lr, lr * 2, lr * 2);
    }
    lg.globalAlpha = 1; lg.globalCompositeOperation = 'source-over';
    g.drawImage(lc, 0, 0, cw, ch);
    ambient(z, dt, 0, 0);

    // actors on top of the darkness
    g.setTransform(ts, 0, 0, ts, ox, oy);
    for (const e of r.ents) {
      const x = e.x, y = e.y + e.h;
      if (e.kind === 'plate') drawPlate(g, e, x, y);
      else if (e.kind === 'switch') drawSwitch(g, e, x, y, now);
      else if (e.kind === 'gen') drawGen(g, e, x, y, now);
      else if (e.kind === 'core' && !e.broken) drawCore(g, e, x, y, now);
      else if (e.kind === 'check') drawPod(g, e, x, y, now, sim.check?.room === r.id && sim.check?.i === e.i);
      else if (e.kind === 'energy') drawEnergy(g, e, x, y, now);
      else if (e.kind === 'upgrade') drawUpgrade(g, e, x, y, now);
    }
    for (const b of r.blocks) drawBlock(g, b, b.x, b.y);
    const b = sim.boss;
    if (b && !b.dead && !(b.dying && Math.floor(now * 16) % 2)) drawBoss(g, b, b.x, b.y, now, sim);
    for (const e of r.enemies) drawEnemy(g, e, e.x + e.w / 2, e.y + e.h, e.t, z);
    drawPlayer(sim, now);
    drawShots(r);
    g.setTransform(ts, 0, 0, ts, -camPx, -camPy);
    for (const q of parts) {
      const a = Math.min(1, (q.life / q.max) * 1.5);
      if (q.gl) glow(g, q.gl, q.x, q.y, q.size * 3, a * 0.7);
      g.globalAlpha = a; g.fillStyle = q.col;
      g.beginPath(); g.arc(q.x, q.y, q.size * 0.5, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (flash > 0) { g.globalAlpha = Math.min(0.55, flash * 4); g.fillStyle = flashCol; g.fillRect(0, 0, cw, ch); g.globalAlpha = 1; }
    g.drawImage(vign, 0, 0);
  }

  // ---------- HUD ----------
  const fakeBody = (walk = 0) => ({ face: 1, vx: walk ? 1 : 0, vy: 0, ground: true, walk, swing: null, spCd: 0, sprint: 0, atkCd: 0, flaming: false, ladder: false, probe: null });
  function formIcon(form, cx, cy, s, now) {
    g.save(); g.translate(cx, cy); g.scale(s, s);
    drawForm(g, form, form === 'raptor' ? 0.3 : 0, form === 'raptor' ? 1.85 : 1.6, fakeBody(), now);
    g.restore();
  }
  function drawHud(app) {
    const sim = app.sim, p = sim.p, pd = 36 * u;
    const top = g.createLinearGradient(0, 0, 0, 140 * u);
    top.addColorStop(0, 'rgba(0,0,0,0.65)'); top.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = top; g.fillRect(0, 0, cw, 140 * u);
    // energy
    const en = Math.max(0, p ? p.energy : 0), low = en <= 25, mid = en <= 50;
    label('ENERGY', pd, 42 * u, 16, 'rgba(255,255,255,0.55)', 600, 'left', 4);
    const bx = pd, by = 54 * u, bw = 360 * u, bh = 20 * u;
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.roundRect(bx, by, bw, bh, bh / 2); g.fill();
    const col = low ? C.red : mid ? C.yellow : C.green;
    if (en > 0) {
      const gr = g.createLinearGradient(bx, 0, bx + bw, 0);
      gr.addColorStop(0, col[2]); gr.addColorStop(1, col[4]);
      g.fillStyle = gr; g.beginPath(); g.roundRect(bx, by, Math.max(bh, (bw * en) / 100), bh, bh / 2); g.fill();
      glow(g, low ? 'red' : mid ? 'yellow' : 'green', bx + (bw * en) / 100, by + bh / 2, 40 * u, low ? 0.5 + Math.sin(app.t * 10) * 0.4 : 0.5);
    }
    g.fillStyle = 'rgba(0,0,0,0.45)';
    for (let i = 1; i < 10; i++) g.fillRect(bx + (bw * i) / 10 - u, by, 2 * u, bh);
    label(String(Math.ceil(en)), bx + bw + 16 * u, by + bh - 2 * u, 26, low ? C.red[4] : '#ffffff', 700);
    // lives
    for (let i = 0; i < Math.min(8, sim.lives); i++) {
      const lx = pd + 10 * u + i * 26 * u, ly = 104 * u;
      g.fillStyle = C.steel[4]; g.beginPath(); g.roundRect(lx - 8 * u, ly - 9 * u, 16 * u, 15 * u, 5 * u); g.fill();
      g.fillStyle = C.visor[2]; g.fillRect(lx - 1 * u, ly - 5 * u, 8 * u, 4 * u);
    }
    // where we are, or the boss
    const zn = ZONES[sim.room?.zone ?? 0].name, accent = ZONE_PAL[sim.room?.zone ?? 0].accent;
    const boss = sim.boss && !sim.boss.dead ? sim.boss : null;
    label(zn, cw / 2, 38 * u, 15, accent, 700, 'center', 6);
    label(boss ? boss.name : sim.room?.name ?? '', cw / 2, 74 * u, 30, boss ? C.red[4] : '#ffffff', 700, 'center', 5);
    if (boss) {
      const w = 520 * u, x = (cw - w) / 2, y = 88 * u, h = 12 * u, k = boss.hp / boss.maxHp;
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fill();
      const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, C.red[2]); gr.addColorStop(1, C.red[4]);
      if (k > 0) { g.fillStyle = gr; g.beginPath(); g.roundRect(x, y, Math.max(h, w * k), h, h / 2); g.fill(); }
      glow(g, 'red', x + w * k, y + h / 2, 30 * u, 0.6);
    }
    // score and time
    label('SCORE', cw - pd, 42 * u, 16, 'rgba(255,255,255,0.55)', 600, 'right', 4);
    label(pad6(sim.score), cw - pd, 80 * u, 38, '#ffffff', 700, 'right', 3);
    label('TIME ' + clock(sim.t), cw - pd, 106 * u, 16, 'rgba(255,255,255,0.55)', 600, 'right', 3);
    // forms: the three chips, their cooldown and whether their upgrade is fitted
    const bot = g.createLinearGradient(0, ch - 150 * u, 0, ch);
    bot.addColorStop(0, 'rgba(0,0,0,0)'); bot.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = bot; g.fillRect(0, ch - 150 * u, cw, 150 * u);
    const ups = Object.fromEntries(Object.entries(UPGRADES).map(([k, f]) => [f, k]));
    FORMS.forEach((f, i) => {
      const cx = pd + 46 * u + i * 104 * u, cy = ch - 64 * u, r = 42 * u, on = p && p.form === f, c = FORM_COL[f];
      g.fillStyle = on ? rgba(c[1], 0.85) : 'rgba(10,12,18,0.6)'; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.strokeStyle = on ? c[5] : 'rgba(255,255,255,0.18)'; g.lineWidth = (on ? 3 : 1.5) * u; g.stroke();
      if (on) glow(g, f === 'android' ? 'cyan' : f === 'raptor' ? 'amber' : 'yellow', cx, cy, r * 1.6, 0.35);
      g.save(); g.beginPath(); g.arc(cx, cy, r - 2 * u, 0, TAU); g.clip();
      g.globalAlpha = on ? 1 : 0.55;
      formIcon(f, cx, cy, (f === 'android' ? 19 : 17) * u, app.t);
      g.restore(); g.globalAlpha = 1;
      if (p && !on && p.morphCd > 0) {
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * (p.morphCd / 0.7)); g.fill();
      }
      const up = ups[f];
      if (sim.upgrades[up]) {
        g.fillStyle = C.yellow[4]; g.beginPath(); g.arc(cx + r * 0.72, cy - r * 0.72, 9 * u, 0, TAU); g.fill();
        g.fillStyle = C.black; g.beginPath(); g.arc(cx + r * 0.72, cy - r * 0.72, 4 * u, 0, TAU); g.fill();
      }
    });
  }
  function message(app) {
    const m = app.sim.message;
    if (!m || app.demo) return;
    const lines = m.text.split(' · '), size = 24, lh = 40 * u;
    const h = lines.length * lh + 26 * u, w = Math.min(cw - 80 * u, 1100 * u), y = ch - 150 * u - h;
    glass((cw - w) / 2, y, w, h, 16, 0.55);
    lines.forEach((l, i) => prompt(app.input, l, cw / 2, y + 13 * u + lh * (i + 0.5), size, m.big ? C.yellow[4] : '#f0f0e8', 'center'));
  }

  // ---------- screens ----------
  let pan = 0;
  function scenery(zone, dt, speed = 3) {
    pan += dt * speed;
    g.setTransform(1, 0, 0, 1, 0, 0);
    backdrop(zone, pan, dt);
    ambient(zone, dt, 0, 0);
  }
  function emblem(cx, cy, s, now) {
    // three facets of one triangle, one per form
    const pts = [[0, -1], [0.866, 0.5], [-0.866, 0.5]], mid = [0, 0];
    const cols = [C.steel[4], C.amber[4], C.olive[4]], lit = Math.floor(now / 2) % 3;
    for (let i = 0; i < 3; i++) {
      const a = pts[i], b = pts[(i + 1) % 3];
      g.beginPath(); g.moveTo(cx + mid[0] * s, cy + mid[1] * s); g.lineTo(cx + a[0] * s, cy + a[1] * s); g.lineTo(cx + b[0] * s, cy + b[1] * s); g.closePath();
      g.fillStyle = i === lit ? cols[i] : mix(cols[i], '#000000', 0.45); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3 * u; g.stroke();
    }
    glow(g, 'white', cx, cy, s * 1.4, 0.25);
  }
  function logo(cy, size, now) {
    const s = 'TRIFORM';
    font(size, 700);
    if ('letterSpacing' in g) g.letterSpacing = size * 0.16 * u + 'px';
    const w = g.measureText(s).width, x = cw / 2 - w / 2 + size * 0.08 * u;
    const gr = g.createLinearGradient(0, cy - size * 0.8 * u, 0, cy);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, C.steel[4]); gr.addColorStop(0.55, C.cyan[3]); gr.addColorStop(1, C.visor[0]);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillText(s, x + 6 * u, cy + 6 * u);
    g.fillStyle = gr; g.fillText(s, x, cy);
    // a glint running across the letters
    g.save(); g.beginPath(); g.rect(x, cy - size * u, w, size * 1.2 * u); g.clip();
    const gx = x - 200 * u + (((now * 0.35) % 1.6) / 1.6) * (w + 400 * u);
    const sh = g.createLinearGradient(gx - 60 * u, 0, gx + 60 * u, 0);
    sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.85)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.fillText(s, x, cy);
    g.restore();
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  }
  function drawTitle(app, dt) {
    scenery(0, dt, 2);
    shade(0.45);
    g.drawImage(vign, 0, 0);
    const now = app.t;
    emblem(cw / 2, 92 * u, 46 * u, now);
    logo(262 * u, 140, now);
    label('ANVIL FOUNDRY  ·  HIGH ORBIT', cw / 2, 310 * u, 20, ZONE_PAL[0].accent, 600, 'center', 8);
    // the three forms on lit plinths
    const pick = Math.floor(now / 2) % 3, xs = [cw / 2 - 330 * u, cw / 2, cw / 2 + 330 * u], base = 560 * u, sc = 52 * u;
    FORMS.forEach((f, i) => {
      const lit = i === pick, c = FORM_COL[f];
      g.fillStyle = lit ? rgba(c[2], 0.9) : 'rgba(30,32,40,0.8)';
      g.beginPath(); g.ellipse(xs[i], base, 130 * u, 18 * u, 0, 0, TAU); g.fill();
      if (lit) { glow(g, 'cyan', xs[i], base - 60 * u, 200 * u, 0.25); glow(g, 'white', xs[i], base, 120 * u, 0.25); }
      g.save(); g.translate(xs[i], base); g.scale(sc, sc);
      g.globalAlpha = lit ? 1 : 0.4;
      drawForm(g, f, 0, 0, fakeBody(lit ? now * 6 : 0), now);
      g.restore(); g.globalAlpha = 1;
      label(f.toUpperCase(), xs[i], base + 52 * u, 24, lit ? '#ffffff' : 'rgba(255,255,255,0.4)', 700, 'center', 6);
    });
    const blurb = ['CLIMBS  ·  DUCTS  ·  STRIKES  ·  BLASTER', 'BITES  ·  LEAPS  ·  SWIPES  ·  FLAME', 'TREADS  ·  CANNON  ·  SHOVES  ·  PROBE'][pick];
    label(blurb, cw / 2, base + 92 * u, 18, FORM_COL[FORMS[pick]][5], 600, 'center', 4);
    const input = app.input, kb = input.device.kind !== 'gamepad';
    const rows = [
      [['move', 'MOVE'], ['jump', 'JUMP'], ['attack', 'ATTACK']],
      [['special', 'SPECIAL'], ['morph', 'MORPH', true], ['pause', 'PAUSE']],
    ];
    const last = [['map', 'MAP']];
    if (kb) last.push(['sound', 'SOUND'], ['fullscreen', 'FULLSCREEN']);
    if (app.onExit) last.push(['quit', 'EXIT']);
    rows.push(last);
    legend(input, rows, cw / 2, 740 * u, 50, 20);
    const pulse = 0.55 + Math.sin(now * 4) * 0.45;
    prompt(input, 'PRESS {start} TO START', cw / 2, 930 * u, 30, rgba(C.yellow[4], pulse), 'center', 700);
    const best = app.best;
    label('BEST ' + pad6(best.score) + (best.time ? '   ·   ' + clock(best.time) : '') + '      SOUND ' + (app.soundOn ? 'ON' : 'OFF'), cw / 2, 1030 * u, 18, 'rgba(255,255,255,0.5)', 600, 'center', 4);
  }
  const INTRO = [
    'Forty years after the last shift, the orbital foundry ANVIL is still burning.',
    'Its mind, the FOREMAN, locked the crew out and kept on building. Nobody knows what.',
    'Deep in the Slag Pits a salvage frame reboots: unit T-3, called TRIFORM.',
    'Android, raptor, tank. One body, three shapes. Each lock in the foundry wants one of them.',
    'Climb to the core. Silence the Foreman.',
  ];
  function drawIntro(app, dt) {
    scenery(0, dt, 2);
    shade(0.65);
    g.drawImage(vign, 0, 0);
    logo(150 * u, 64, app.t);
    let chars = Math.floor(app.stT * 45), y = 300 * u;
    const w = 1300 * u;
    font(30, 500);
    for (const para of INTRO) {
      // wrap by measured width
      const words = para.split(' '), lines = [];
      let line = '';
      for (const wd of words) { const t2 = line ? line + ' ' + wd : wd; if (g.measureText(t2).width > w && line) { lines.push(line); line = wd; } else line = t2; }
      lines.push(line);
      for (const l of lines) {
        if (chars <= 0) break;
        label(l.slice(0, chars), cw / 2 - w / 2, y, 30, '#e8e8e0', 500);
        chars -= l.length; y += 46 * u;
      }
      y += 24 * u;
    }
    prompt(app.input, 'PRESS {start}', cw / 2, 990 * u, 26, rgba(C.yellow[4], 0.55 + Math.sin(app.t * 4) * 0.45), 'center', 700);
  }
  function drawPause(app) {
    shade(0.45);
    const w = 560 * u, h = 400 * u, x = (cw - w) / 2, y = (ch - h) / 2;
    glass(x, y, w, h);
    label('PAUSED', cw / 2, y + 90 * u, 54, C.yellow[4], 700, 'center', 12);
    const rows = [[['pause', 'RESUME']], [['restart', 'RETRY ROOM']], [['quit', 'QUIT']]];
    if (app.input.device.kind !== 'gamepad') rows.push([['sound', app.soundOn ? 'SOUND OFF' : 'SOUND ON']]);
    legend(app.input, rows, cw / 2, y + 170 * u, 56, 24);
  }
  function thumb(def, sim, w, h) {
    const m = sim.mem[def.id], key = m.visits + ':' + (sim.room?.id === def.id ? sim.room.version : '-');
    const e = thumbs.get(def.id);
    if (e && e.key === key) return e.cv;
    const c = canvas(w, h), x = c.getContext('2d'), Z = ZONE_PAL[def.zone];
    x.scale(w / COLS, h / ROWS);
    x.fillStyle = rgba(Z.sky[2], 0.9); x.fillRect(0, 0, COLS, ROWS);
    for (let ty = 0; ty < ROWS; ty++)
      for (let tx = 0; tx < COLS; tx++) {
        const t2 = m.tiles[ty][tx];
        if (t2 === '.') continue;
        x.fillStyle = t2 === '#' ? Z.wall[3] : '~^!'.includes(t2) ? C.red[3] : t2 === 'H' ? Z.wall[5] : t2 === 'B' ? C.grate[4] : t2 === 'I' ? C.ice[3] : t2 === '%' ? C.mesh[3] : t2 === '=' ? Z.wall[4] : C.yellow[3];
        x.fillRect(tx - 0.02, ty - 0.02, 1.04, 1.04);
      }
    thumbs.set(def.id, { key, cv: c });
    return c;
  }
  function drawMap(app) {
    const sim = app.sim;
    shade(0.82);
    label('ANVIL FOUNDRY', cw / 2, 90 * u, 34, '#ffffff', 700, 'center', 10);
    const cwid = 250 * u, chei = Math.round((cwid * ROWS) / COLS), gap = 14 * u;
    const ox = (cw - (MAP_COLS * cwid + (MAP_COLS - 1) * gap)) / 2, oy = 140 * u;
    for (const def of ROOMS) {
      const m = sim.mem[def.id], x = ox + def.col * (cwid + gap), y = oy + def.row * (chei + gap);
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.roundRect(x, y, cwid, chei, 8 * u); g.fill();
      if (!m?.visited) continue;
      g.drawImage(thumb(def, sim, Math.round(cwid), chei), x, y, cwid, chei);
      if (def.ents.some(e => e[0] === 'boss') && !m.bossDead) { g.fillStyle = C.red[4]; g.beginPath(); g.arc(x + cwid - 14 * u, y + 14 * u, 7 * u, 0, TAU); g.fill(); }
      if (def.ents.some(e => e[0] === 'check')) { g.fillStyle = C.green[3]; g.beginPath(); g.arc(x + 14 * u, y + chei - 14 * u, 6 * u, 0, TAU); g.fill(); }
    }
    const r = sim.room, p = sim.p, x = ox + r.col * (cwid + gap), y = oy + r.row * (chei + gap);
    const a = 0.6 + Math.sin(app.t * 6) * 0.4;
    g.strokeStyle = rgba('#ffffff', a); g.lineWidth = 3 * u; g.beginPath(); g.roundRect(x - 3 * u, y - 3 * u, cwid + 6 * u, chei + 6 * u, 10 * u); g.stroke();
    if (p) { const px = x + ((p.x + p.w / 2) / COLS) * cwid, py = y + ((p.y + p.h / 2) / ROWS) * chei; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(px, py, 6 * u, 0, TAU); g.fill(); glow(g, 'white', px, py, 24 * u, a); }
    ZONES.slice(0, 3).forEach((z, i) => {
      const lx = cw / 2 - 450 * u + i * 330 * u, ly = 820 * u;
      g.fillStyle = ZONE_PAL[i].wall[4]; g.beginPath(); g.roundRect(lx, ly - 14 * u, 18 * u, 18 * u, 4 * u); g.fill();
      label(z.name, lx + 30 * u, ly, 18, 'rgba(255,255,255,0.7)', 600, 'left', 4);
    });
    label('TIME ' + clock(sim.t) + '     SCORE ' + pad6(sim.score) + '     UNITS LOST ' + sim.deaths, cw / 2, 900 * u, 22, '#ffffff', 600, 'center', 4);
    prompt(app.input, '{map} CLOSE', cw / 2, 980 * u, 22, 'rgba(255,255,255,0.6)', 'center');
  }
  function drawOver(app) {
    shade(0.5);
    const w = 760 * u, h = 300 * u, x = (cw - w) / 2, y = (ch - h) / 2;
    glass(x, y, w, h);
    label('SYSTEMS OFFLINE', cw / 2, y + 100 * u, 56, C.red[4], 700, 'center', 10);
    label('SCORE ' + pad6(app.sim.score), cw / 2, y + 160 * u, 26, '#ffffff', 600, 'center', 4);
    label('THE FOREMAN KEEPS BUILDING', cw / 2, y + 200 * u, 18, 'rgba(255,255,255,0.5)', 600, 'center', 4);
    if (app.stT > 1.2) prompt(app.input, 'PRESS {start}', cw / 2, y + 255 * u, 24, rgba(C.yellow[4], 0.55 + Math.sin(app.t * 4) * 0.45), 'center', 700);
  }
  function drawVictory(app, dt) {
    const sim = app.sim;
    scenery(2, dt, 4);
    shade(0.45);
    g.drawImage(vign, 0, 0);
    label('THE FOREMAN IS SILENT', cw / 2, 140 * u, 64, C.yellow[4], 700, 'center', 10);
    ['The furnaces cool. ANVIL falls quiet.', 'For the first time in forty years', 'the station is listening for its crew.']
      .forEach((l, i) => label(l, cw / 2, 220 * u + i * 42 * u, 28, '#e8e8e0', 500, 'center'));
    g.save(); g.translate(cw / 2, 540 * u); g.scale(56 * u, 56 * u);
    drawForm(g, FORMS[Math.floor(app.t / 1.5) % 3], 0, 0, fakeBody(), app.t);
    g.restore();
    glow(g, 'cyan', cw / 2, 480 * u, 220 * u, 0.2);
    const w = 620 * u, h = 260 * u, x = (cw - w) / 2, y = 600 * u;
    glass(x, y, w, h);
    const rows = [['TIME', clock(sim.t)], ['SCORE', pad6(sim.score)], ['UNITS LOST', String(sim.deaths)], ['BEST TIME', app.best.time ? clock(app.best.time) : '--:--']];
    rows.forEach(([a, b], i) => { label(a, x + 50 * u, y + 66 * u + i * 52 * u, 24, 'rgba(255,255,255,0.55)', 600, 'left', 4); label(b, x + w - 50 * u, y + 66 * u + i * 52 * u, 28, '#ffffff', 700, 'right', 3); });
    if (app.stT > 2) prompt(app.input, 'PRESS {start}', cw / 2, 960 * u, 26, rgba(C.yellow[4], 0.55 + Math.sin(app.t * 4) * 0.45), 'center', 700);
  }

  let last = performance.now();
  function draw(app) {
    lastApp = app;
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    stepParts(dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, cw, ch);
    const s = app.state;
    if (s === 'title') drawTitle(app, dt);
    else if (s === 'intro') drawIntro(app, dt);
    else if (s === 'victory') drawVictory(app, dt);
    else if (app.sim.room) {
      drawWorld(app, dt);
      if (s === 'map') drawMap(app);
      else {
        drawHud(app);
        message(app);
        if (s === 'pause') drawPause(app);
        if (s === 'over') drawOver(app);
      }
    }
    if (app.fade > 0) shade(Math.min(1, app.fade));
  }

  return {
    draw,
    events,
    destroy() { destroyed = true; offs.forEach(f => f()); },
  };
}
