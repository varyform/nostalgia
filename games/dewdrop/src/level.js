// Stage format and parsing. A stage is a 32 × 18 text grid (16:9, one character per tile)
// plus a little JSON-ish metadata; parseStage() turns it into the static level the simulation
// and the renderer read. Row 0 stays clear: the HUD sits over it.
//
//   .  air                 #  earth (solid)           =  branch (stand on it, jump up through, ↓ drops)
//   H  vine (climb)        +  vine through a branch   -  hanging vine (grab it, shimmy along)
//   T  spring mushroom     ^  thorns                  ~  pond
//   <  >  stream bank: solid ground whose current carries you left / right
//   x  dry leaf: a branch that crumbles a moment after you stand on it, and grows back
//   o  glowberry           *  firefly (bonus)         D  the moonbloom (home; its lowest tile)
//   P  Dew's start (the tile she stands in)           a b c d  bramble knots, where pursuers spawn
//
//   meta: { id, name, par (seconds of time bonus), waves: [[kind, knot, delay]…],
//           wind: [[x, y, w, h, kind, strength]…]  kind 'L' / 'R' drift (tiles/s), 'U' updraft
//           movers: [[x, y, w, dx, dy, period, phase]…]  lily pads gliding there and back }
export const COLS = 32, ROWS = 18;

export const SOLID = '#T<>';
export const KINDS = ['chase', 'patrol', 'hop'];

export function parseStage(def, world = 0, { lenient = false } = {}) {
  const map = def.map;
  if (map.length !== ROWS) throw new Error(`${def.id}: ${map.length} rows, want ${ROWS}`);
  const L = {
    id: def.id, name: def.name, world, par: def.par ?? 60, hint: def.hint ?? null,
    t: [], berries: [], flies: [], knots: {}, start: null, door: null, crumbles: [], crumbleAt: new Map(),
    waves: (def.waves ?? []).map(([kind, knot, delay]) => ({ kind, knot, delay })),
    wind: (def.wind ?? []).map(([x, y, w, h, kind, k]) => ({ x, y, w, h, kind, k })),
    movers: (def.movers ?? []).map(([x, y, w, dx, dy, period, phase = 0]) => ({ x, y, w, dx, dy, period, phase })),
  };
  // a berry or firefly on a hanging vine or a climbing vine keeps the vine under it
  const at = (c, r) => map[r]?.[c] ?? '.';
  const under = (c, r) => {
    if (at(c - 1, r) === '-' && at(c + 1, r) === '-') return '-';
    if (isClimb(at(c, r - 1)) && isClimb(at(c, r + 1))) return 'H';
    return '.';
  };
  map.forEach((row, r) => {
    if (row.length !== COLS) throw new Error(`${def.id}: row ${r} is ${row.length} wide, want ${COLS}`);
    const out = [];
    for (let c = 0; c < COLS; c++) {
      let ch = row[c];
      if (ch === 'o') { L.berries.push({ x: c + 0.5, y: r + 0.5 }); ch = under(c, r); }
      else if (ch === '*') { L.flies.push({ x: c + 0.5, y: r + 0.5 }); ch = under(c, r); }
      else if (ch === 'P') { L.start = { x: c + 0.5, y: r + 1 }; ch = '.'; }
      else if (ch === 'D') { L.door = { c, r, x: c + 0.5, y: r + 1 }; ch = '.'; }
      else if (ch >= 'a' && ch <= 'd') { L.knots[ch] = { x: c + 0.5, y: r + 1 }; ch = '.'; }
      else if (ch === 'x') { L.crumbleAt.set(r * COLS + c, L.crumbles.length); L.crumbles.push({ c, r }); }
      out.push(ch);
    }
    L.t.push(out);
  });
  if (lenient) return L;
  if (!L.start) throw new Error(`${def.id}: Dew needs a start (P)`);
  if (!L.door) throw new Error(`${def.id}: place the moonbloom (D)`);
  if (!L.berries.length) throw new Error(`${def.id}: add at least one glowberry`);
  for (const w of L.waves) {
    if (!L.knots[w.knot]) throw new Error(`${def.id}: wave at missing knot "${w.knot}"`);
    if (!KINDS.includes(w.kind)) throw new Error(`${def.id}: unknown pursuer "${w.kind}"`);
  }
  return L;
}

// ---------- tile queries on the static grid ----------
export const tile = (L, c, r) => (c < 0 || c >= COLS || r < 0 ? '#' : r >= ROWS ? '~' : L.t[r][c]);
export const isSolid = ch => SOLID.includes(ch);
export const isClimb = ch => ch === 'H' || ch === '+';
