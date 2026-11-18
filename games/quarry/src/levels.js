// Quarry's eight hand-made levels, 16 × 11 cells each. After the eighth they cycle, harder.
//
//   .  soil              g  gem in soil         c  ore crate in soil
//   -  tunnel (east–west)  |  tunnel (north–south)  +  tunnel crossing
//   H  the drill's start (a crossing)        S  the grubs' den (a crossing, in a corner)
//
// Two tunnel cells side by side are joined when both run that way ('-', '+', 'H', 'S' east–west;
// '|', '+', 'H', 'S' north–south), so parallel tunnels stay apart.
export const COLS = 16, ROWS = 11, U = 16;

export const LEVELS = [
  {
    name: 'TOPSOIL',
    map: [
      'S---------+.....',
      '.ggg......|..c..',
      '.gg..c....|.ggg.',
      '.gg.......|.ggg.',
      '.gg..ggg..|.ggg.',
      '.....ggg..|..c..',
      '..c..ggg..|.gg..',
      '.gg.......|.gg..',
      '.gg..c....|.gg..',
      '.gg.......+-H---',
      '...ggg....ggg...',
    ],
  },
  {
    name: 'CLAY PITS',
    map: [
      '...............S',
      '.g..g..g..g..g.|',
      '.g..g..g..g..g.|',
      '.g..g..g..g..g.|',
      '.c..c..c..c..c.|',
      '..gg.gg.gg.gg.g|',
      '+--------------+',
      '|..g.g.g.g.g.g..',
      '|.c...........c.',
      'H..g.g.g.g.g.g..',
      '..ggg..gg..ggg..',
    ],
  },
  {
    name: 'ROOTWORK',
    map: [
      'S-----+...ggggg.',
      '.ggg..|..gg..c..',
      '.ggg..|..gg.....',
      '......+---+..gg.',
      '..c.......|..gg.',
      '.gg..c....|.ggg.',
      '.gg.......+--+..',
      '.gg..ggg.....|.c',
      '.ggg......c..|.g',
      '..c..ggg.....H.g',
      '.ggg.........ggg',
    ],
  },
  {
    name: 'CHALK SEAM',
    map: [
      'g.....c........S',
      '.g............g|',
      '..g...c......g.|',
      '...g..ggg...g..|',
      '....g.ggg..g...|',
      '.c...g....g....|',
      '......g..g..c..|',
      '..c....gg......|',
      '.ggg...gg...ggg|',
      '+------H-------+',
      '.ggg..gggg..ggg.',
    ],
  },
  {
    name: 'IRONSTONE',
    map: [
      '+-------------+S',
      '|.c.c.c...c.c.|.',
      '|.g.g.g...g.g.|.',
      '|.g.g.g...g.g.|c',
      '|.gg.gg.gg.gg.|g',
      '|..c..ggg..c..|g',
      '|.....ggg.....|g',
      '|..g..ggg..g..|.',
      '|..g.......g..|.',
      '+------H------+.',
      '..gg..gggg..gg..',
    ],
  },
  {
    name: 'FLINT BEDS',
    map: [
      'S-+.............',
      '..|.g.g.g.g.g.g.',
      '..|g.g.g.g.g.g.g',
      '..|.......c....c',
      '..+------+......',
      '.g.g.g...|..c...',
      '.g.g.g...|.g.g.g',
      'g.g.g.g..|g.g.g.',
      '...c.....|...c..',
      '.g.g.g...H.g.g.g',
      '.g.g.g.g...g.g.g',
    ],
  },
  {
    name: 'SLATE HOLLOW',
    map: [
      '.ggg.......ggg.S',
      '.gg..c....c..gg|',
      '.gg..........gg|',
      '...+-------+...|',
      '.c.|.ggggg.|.c.|',
      '...|.g...g.|...|',
      '...|.ggggg.|...|',
      '...+---H---+---+',
      '.gg...ggg....gg.',
      '.gg..c....c..gg.',
      '..gggg....gggg..',
    ],
  },
  {
    name: 'THE DEEP',
    map: [
      'S-----+.....gggg',
      '..c...|..c..gggg',
      '.ggg..|..ggg....',
      '.ggg..+---+..c..',
      '.ggg......|.ggg.',
      '....c.....|.ggg.',
      '.gg...c...|.ggg.',
      '.gg.......+--+..',
      '.gg..ggg..c..|.c',
      '.....ggg.....H.g',
      '..c..ggg......gg',
    ],
  },
];

const H_RUN = '-+HS', V_RUN = '|+HS';

// The level as flat arrays (index = row * COLS + col). Edge extents run 0..U: hA[i] is how far
// the tunnel from cell i reaches east towards i + 1, hB[i] how far the one from i + 1 reaches
// west; vA / vB the same southwards. A pair adds up to U or more when the passage is open.
export function parseLevel(def) {
  const n = COLS * ROWS;
  const L = {
    cell: new Uint8Array(n), gem: new Uint8Array(n),
    hA: new Uint8Array(n), hB: new Uint8Array(n), vA: new Uint8Array(n), vB: new Uint8Array(n),
    crates: [], start: null, spawn: null, gemCount: 0,
  };
  const at = (c, r) => def.map[r]?.[c] ?? '.';
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const ch = at(c, r), i = r * COLS + c;
      if (H_RUN.includes(ch) || V_RUN.includes(ch)) L.cell[i] = 1;
      if (ch === 'g') { L.gem[i] = 1; L.gemCount++; }
      if (ch === 'c') L.crates.push({ x: c, y: r });
      if (ch === 'H') L.start = { x: c, y: r };
      if (ch === 'S') L.spawn = { x: c, y: r };
      if (c < COLS - 1 && H_RUN.includes(ch) && H_RUN.includes(at(c + 1, r))) L.hA[i] = L.hB[i] = U;
      if (r < ROWS - 1 && V_RUN.includes(ch) && V_RUN.includes(at(c, r + 1))) L.vA[i] = L.vB[i] = U;
    }
  return L;
}
