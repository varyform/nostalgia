// Level format and parsing. A level is a 28 × 16 text grid, one character per tile, plus a
// name; parseLevel() turns it into the static level the simulation, solver and renderer read.
//
//   .  water (open)          #  coral brick: stand on it, dig it, it grows back
//   =  bedrock (never digs)  H  ladder        -  rope (hang and go hand over hand)
//   ~  false brick: looks like coral, gives way under anyone
//   ^  the rising stair: a ladder that appears once every glimmer is gathered
//   *  a glimmer (shard)     P  Wren's start  G  a sentinel's start
//
// The stair (or a ladder) must reach the top row: Wren leaves by climbing off the top.
export const COLS = 28, ROWS = 16;
// sub-steps per tile: positions are whole numbers of 1/U tile, so the simulation is exact
export const U = 12;

export function parseLevel(def, { lenient = false } = {}) {
  const map = def.map;
  if (map.length !== ROWS) throw new Error(`${def.id}: ${map.length} rows, want ${ROWS}`);
  const L = { id: def.id, name: def.name, world: def.world ?? 0, speed: def.speed ?? null, t: [], shards: [], guards: [], stair: [], start: null };
  map.forEach((row, r) => {
    if (row.length !== COLS) throw new Error(`${def.id}: row ${r} is ${row.length} wide, want ${COLS}`);
    const out = [];
    for (let c = 0; c < COLS; c++) {
      let ch = row[c];
      if (ch === '*') { L.shards.push({ c, r }); ch = '.'; }
      else if (ch === 'P') { L.start = { c, r }; ch = '.'; }
      else if (ch === 'G') { L.guards.push({ c, r }); ch = '.'; }
      else if (ch === '^') L.stair.push({ c, r });
      else if (!'.#=H-~'.includes(ch)) throw new Error(`${def.id}: unknown tile "${ch}" at ${c},${r}`);
      out.push(ch);
    }
    L.t.push(out);
  });
  // where a sentinel that crumbled away comes back: open tiles near the top
  L.respawn = [];
  for (let r = 0; r < 3 && !L.respawn.length; r++)
    for (let c = 0; c < COLS; c++) if (L.t[r][c] === '.' && !L.shards.some(s => s.c === c && s.r === r)) L.respawn.push({ c, r });
  if (!L.respawn.length) L.respawn = L.guards.map(g => ({ ...g }));
  if (lenient) return L;
  if (!L.start) throw new Error(`${def.id}: Wren needs a start (P)`);
  if (!L.shards.length) throw new Error(`${def.id}: add at least one glimmer`);
  if (!L.t[0].some(ch => ch === 'H' || ch === '^')) throw new Error(`${def.id}: a ladder or the stair must reach the top row`);
  if (L.guards.length > 6) throw new Error(`${def.id}: at most six sentinels`);
  return L;
}

// static tile tests (the live ones, with holes and the stair, are in sim.js)
export const tileAt = (L, c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? '=' : L.t[r][c]);
