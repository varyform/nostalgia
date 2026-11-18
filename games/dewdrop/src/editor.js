// The stage editor: paint a 32 × 18 garden with the mouse (or a cursor with keys / pad), pick
// a garden theme, keep up to three stages in the browser and test-play them. Bramble knots
// a–d bring their pursuers: a Prickle, a Snag, a Hopburr and a second Prickle.
// Logic only; the renderer draws it from `app.editor`.
import { COLS, ROWS, parseStage } from './level.js';

export const BRUSHES = ['.', '#', '=', 'H', '+', '-', 'T', '^', '~', '<', '>', 'x', 'o', '*', 'P', 'D', 'a', 'b', 'c', 'd'];
export const BRUSH_NAMES = {
  '.': 'Air', '#': 'Earth', '=': 'Branch', H: 'Vine', '+': 'Vine through branch', '-': 'Hanging vine', T: 'Toadstool',
  '^': 'Thorns', '~': 'Pond', '<': 'Brook west', '>': 'Brook east', x: 'Dry leaf', o: 'Glowberry', '*': 'Firefly',
  P: 'Dew starts here', D: 'Moonbloom (home)', a: 'Knot: Prickle', b: 'Knot: Snag', c: 'Knot: Hopburr', d: 'Knot: late Prickle',
};
const UNIQUE = 'PDabcd';
const WAVES = { a: ['chase', 4], b: ['patrol', 3], c: ['hop', 7], d: ['chase', 12] };
const SLOTS = 3;
// toolbar on row 0: one tile per brush, then buttons
export const BUTTONS = [
  { id: 'world', c: 21, w: 3 }, { id: 'slot', c: 24, w: 2 }, { id: 'test', c: 26, w: 3 }, { id: 'exit', c: 29, w: 3 },
];

function blank() {
  const rows = Array.from({ length: ROWS }, () => '.'.repeat(COLS).split(''));
  for (let c = 0; c < COLS; c++) { rows[16][c] = '#'; rows[17][c] = '~'; }
  rows[15][2] = 'P'; rows[15][29] = 'D'; rows[15][15] = 'o';
  return rows;
}

export function createEditor(app, { listen, cv, save }) {
  const E = {
    grid: blank(), world: 0, slot: 0, brush: 1, cur: { c: 15, r: 9 }, hover: null, msg: null, dirty: false,
    open, update, stage, level: null,
  };
  const S = app.save;
  function load(slot) {
    E.slot = slot;
    const s = S.custom?.[slot];
    E.grid = s ? s.map.map(r => r.split('')) : blank();
    E.world = s?.world ?? 0;
    refresh();
  }
  function store() {
    S.custom = S.custom ?? [];
    S.custom[E.slot] = { world: E.world, map: E.grid.map(r => r.join('')) };
    save();
    E.dirty = false;
  }
  function refresh() { E.level = parseStage(def(), E.world, { lenient: true }); }
  function def() {
    const map = E.grid.map(r => r.join(''));
    const waves = [];
    for (const k of 'abcd') if (map.some(r => r.includes(k))) waves.push([WAVES[k][0], k, WAVES[k][1]]);
    return { id: 'C' + (E.slot + 1), name: 'Your garden ' + (E.slot + 1), par: 90, world: E.world, waves, map };
  }
  function open() { if (!E.level) load(E.slot); E.msg = null; }
  function say(text) { E.msg = { text, t: 2.5 }; }

  function paint(c, r, b) {
    if (r < 1 || r >= ROWS || c < 0 || c >= COLS) return;
    const ch = BRUSHES[b];
    if (E.grid[r][c] === ch) return;
    if (UNIQUE.includes(ch)) for (const row of E.grid) for (let i = 0; i < COLS; i++) if (row[i] === ch) row[i] = '.';
    E.grid[r][c] = ch;
    E.dirty = true;
    refresh();
  }
  function stage() {
    const d = def();
    try { parseStage(d, d.world); } catch (e) { say(String(e.message).replace(/^C\d: /, '')); return null; }
    return d;
  }
  function button(id) {
    if (id === 'world') { E.world = (E.world + 1) % 4; E.dirty = true; refresh(); }
    else if (id === 'slot') { if (E.dirty) store(); load((E.slot + 1) % SLOTS); say('Garden ' + (E.slot + 1)); }
    else if (id === 'test') pending = 'test';
    else if (id === 'exit') pending = 'exit';
  }

  // ---------- mouse ----------
  let painting = -1, pending = null;
  const cell = e => {
    const r = cv.getBoundingClientRect();
    return { c: Math.floor(((e.clientX - r.left) / r.width) * COLS), r: Math.floor(((e.clientY - r.top) / r.height) * ROWS) };
  };
  const active = () => app.state === 'editor';
  listen(cv, 'contextmenu', e => { if (active()) e.preventDefault(); });
  listen(cv, 'mousedown', e => {
    if (!active()) return;
    const q = cell(e);
    if (q.r === 0) {
      if (q.c < BRUSHES.length) E.brush = q.c;
      for (const b of BUTTONS) if (q.c >= b.c && q.c < b.c + b.w) button(b.id);
      return;
    }
    painting = e.button === 2 ? 0 : E.brush;
    E.cur = q;
    paint(q.c, q.r, painting);
  });
  listen(window, 'mousemove', e => {
    if (!active()) return;
    const q = cell(e);
    E.hover = q.r >= 0 && q.r < ROWS && q.c >= 0 && q.c < COLS ? q : null;
    if (painting >= 0 && E.hover) { E.cur = q; paint(q.c, q.r, painting); }
  });
  listen(window, 'mouseup', () => { if (painting >= 0 && E.dirty) store(); painting = -1; });

  // ---------- keys / pad, once per step; returns 'play' or 'exit' when leaving ----------
  function update() {
    const I = app.input, hit = a => I.pressed(a);
    if (E.msg && (E.msg.t -= 1 / 60) <= 0) E.msg = null;
    const c = E.cur;
    if (hit('left')) c.c = Math.max(0, c.c - 1);
    if (hit('right')) c.c = Math.min(COLS - 1, c.c + 1);
    if (hit('up')) c.r = Math.max(1, c.r - 1);
    if (hit('down')) c.r = Math.min(ROWS - 1, c.r + 1);
    if (hit('edit')) E.brush = (E.brush + 1) % BRUSHES.length;
    if (I.held('start')) paint(c.c, c.r, E.brush);
    if (I.released('start') && E.dirty) store();
    if (hit('restart')) pending = 'test';
    if (hit('back')) pending = 'exit';
    const p = pending;
    pending = null;
    if (p === 'test') { store(); return stage() ? 'play' : null; }
    if (p === 'exit') { store(); return 'exit'; }
    return null;
  }
  return E;
}
