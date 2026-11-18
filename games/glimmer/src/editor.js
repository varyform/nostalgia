// The level editor: paint a 28 × 16 level with the mouse (or a cursor with keys / pad), pick a
// reach for its look and sentinel pace, keep up to three levels in the browser and test-play
// them. Logic only; the renderer draws it from `app.editor`, the toolbar geometry is layout.js.
import { canvasPoint } from '@nostalgia/game/runtime';
import { COLS, ROWS, parseLevel } from './level.js';
import { BRUSHES, cellAt, toolbar } from './layout.js';

export const BRUSH_NAMES = {
  '.': 'Open water', '#': 'Coral brick (diggable)', '=': 'Bedrock', H: 'Ladder', '-': 'Rope', '~': 'False brick',
  '^': 'Rising stair (appears at the end)', '*': 'Glimmer', P: 'Wren starts here', G: 'Sentinel',
};
const SLOTS = 3;

function blank() {
  const rows = Array.from({ length: ROWS }, () => '.'.repeat(COLS).split(''));
  for (let c = 0; c < COLS; c++) rows[15][c] = '#';
  for (let r = 0; r < 15; r++) rows[r][26] = '^';
  rows[14][2] = 'P'; rows[14][13] = '*';
  return rows;
}

export function createEditor(app, { listen, cv, save }) {
  const E = {
    grid: blank(), world: 0, slot: 0, brush: 1, cur: { c: 13, r: 8 }, hover: null, msg: null, dirty: false,
    open, update, level: null, def,
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
  function def() { return { id: 'C' + (E.slot + 1), name: 'Your level ' + (E.slot + 1), world: E.world, map: E.grid.map(r => r.join('')) }; }
  function refresh() { E.level = parseLevel(def(), { lenient: true }); }
  function open() { if (!E.level) load(E.slot); E.msg = null; armed = false; }
  function say(text) { E.msg = { text, t: 2.5 }; }

  function paint(c, r, b) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    const ch = BRUSHES[b];
    if (E.grid[r][c] === ch) return;
    if (ch === 'P') for (const row of E.grid) for (let i = 0; i < COLS; i++) if (row[i] === 'P') row[i] = '.';
    if (ch === 'G' && E.grid.reduce((n, row) => n + row.filter(x => x === 'G').length, 0) >= 6) { say('Six sentinels at most'); return; }
    E.grid[r][c] = ch;
    E.dirty = true;
    app.sfx?.('paint');
    refresh();
  }
  function playable() {
    const d = def();
    try { parseLevel(d); } catch (e) { say(String(e.message).replace(/^C\d: /, '')); app.sfx?.('deny'); return null; }
    return d;
  }
  function button(id) {
    if (id === 'world') { E.world = (E.world + 1) % 4; E.dirty = true; refresh(); store(); }
    else if (id === 'slot') { if (E.dirty) store(); load((E.slot + 1) % SLOTS); say('Level ' + (E.slot + 1)); }
    else if (id === 'clear') { E.grid = blank(); E.dirty = true; refresh(); store(); say('Cleared'); }
    else pending = id;
  }

  // ---------- mouse ----------
  // armed: the Enter that opened the editor has been let go, so holding it paints
  let painting = -1, pending = null, armed = false;
  const active = () => app.state === 'editor';
  listen(cv, 'contextmenu', e => { if (active()) e.preventDefault(); });
  listen(cv, 'mousedown', e => {
    if (!active()) return;
    const p = canvasPoint(cv, e);
    const hit = toolbar(cv.width, cv.height).find(t => p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h);
    if (hit) { if (hit.kind === 'brush') E.brush = hit.i; else button(hit.id); return; }
    const q = cellAt(cv.width, cv.height, p.x, p.y);
    if (q.r < 0 || q.r >= ROWS || q.c < 0 || q.c >= COLS) return;
    painting = e.button === 2 ? 0 : E.brush;
    E.cur = q;
    paint(q.c, q.r, painting);
  });
  listen(window, 'mousemove', e => {
    if (!active()) return;
    const p = canvasPoint(cv, e), q = cellAt(cv.width, cv.height, p.x, p.y);
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
    if (hit('up')) c.r = Math.max(0, c.r - 1);
    if (hit('down')) c.r = Math.min(ROWS - 1, c.r + 1);
    if (hit('edit')) E.brush = (E.brush + 1) % BRUSHES.length;
    if (!I.held('start')) armed = true;
    else if (armed) paint(c.c, c.r, E.brush);
    if (I.released('start') && E.dirty) store();
    if (hit('restart')) pending = 'test';
    if (hit('back')) pending = 'exit';
    const p = pending;
    pending = null;
    if (p === 'test') { store(); return playable() ? 'play' : null; }
    if (p === 'exit') { store(); return 'exit'; }
    return null;
  }
  return E;
}
