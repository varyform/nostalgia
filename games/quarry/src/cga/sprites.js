// The CGA sprites: little index grids (0 black, 1–3 the palette's colours, -1 clear) drawn in
// code, then baked into canvases for each of the four palettes the levels use.
//
//   const S = makeSprites(pal);    // pal: four CSS colours
//   S.drill[face][frame], S.walker[frame], S.borer[frame], S.scared[frame], S.crate, S.gem …
const grid = (w, h) => Array.from({ length: h }, () => Array.from({ length: w }, () => -1));
const put = (G, x, y, c) => { if (G[y] && x >= 0 && x < G[y].length) G[y][x] = c; };
function fromRows(rows) {
  const w = Math.max(...rows.map(r => r.length)), G = grid(w, rows.length);
  rows.forEach((r, y) => r.split('').forEach((ch, x) => { if (ch !== '.') G[y][x] = +ch; }));
  return G;
}
const mirror = G => G.map(r => [...r].reverse());
// a quarter turn clockwise (right-facing → down-facing)
const turn = G => { const h = G.length, w = G[0].length, R = grid(h, w); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) R[x][h - 1 - y] = G[y][x]; return R; };
const flipV = G => [...G].reverse();

// the drill, facing right: a round-topped cab with a porthole, a striped bit, track below
function drill(frame) {
  const G = fromRows([
    '...33333........',
    '..3111113.......',
    '.311000113......',
    '.3110300113.....',
    '31110000113.....',
    '31111111113.....',
    '31111111113.....',
    '3111111111......',
    '.333333333......',
    '2.2.2.2.2.2.....',
    '.2222222222.....',
    '................',
  ]);
  // the bit: a cone from column 11, stripes running with the frame
  const rows = [[3, 11, 12], [4, 11, 13], [5, 11, 15], [6, 11, 14], [7, 11, 12]];
  for (const [y, a, b] of rows) for (let x = a; x <= b; x++) put(G, x, y, (x + y + frame) % 2 ? 3 : 2);
  if (frame) { put(G, 0, 9, 2); put(G, 1, 9, -1); for (let x = 1; x < 11; x += 2) { put(G, x, 9, 2); put(G, x + 1, 9, -1); } }
  return G;
}
function walker(frame) {
  const G = fromRows([
    '....222222....',
    '..2222222222..',
    '.222322223222.',
    '.223032230322.',
    '.222322223222.',
    '22222222222222',
    '.222222222222.',
    '..2222222222..',
  ]);
  const legs = frame ? ['2.2..2..2..2.2', '.2..2....2..2.'] : ['.2..2.22.2..2.', '2..2......2..2'];
  legs.forEach((r, k) => r.split('').forEach((ch, x) => { if (ch === '2') put(G, x, 8 + k, 2); }));
  return G;
}
function borer(frame) {
  const G = fromRows([
    '.3.1.1..1.1.3.',
    '..3222222223..',
    '.222222222222.',
    '22233222233222',
    '22300322300322',
    '22233222233222',
    '22222222222222',
    '.2223333332222',
    '..2.3.3.3.32..',
    '.2..2....2..2.',
  ]);
  if (frame) { put(G, 1, 0, -1); put(G, 12, 0, -1); put(G, 0, 0, 3); put(G, 13, 0, 3); for (let x = 4; x <= 10; x += 2) { put(G, x, 8, 2); put(G, x + 1, 8, 3); } }
  return G;
}
function scared(frame) {
  const G = fromRows([
    '....111111....',
    '..1111111111..',
    '.111311113111.',
    '.113331133311.',
    '.111311113111.',
    '11111111111111',
    '.111.1111.111.',
    '..11.1..1.11..',
  ]);
  const mouth = frame ? [4, 6, 8] : [5, 7, 9];
  for (const x of mouth) put(G, x, 6, 3);
  if (frame) for (const x of [1, 5, 9, 12]) put(G, x, 8, 1); else for (const x of [2, 6, 8, 11]) put(G, x, 8, 1);
  return G;
}
const CRATE = fromRows([
  '33333333333333',
  '30000000000003',
  '30333333333303',
  '30310000001303',
  '30301001010303',
  '30300110100303',
  '30300101100303',
  '30301010010303',
  '30310000001303',
  '30333333333303',
  '30000000000003',
  '33333333333333',
]);
const GEM = fromRows([
  '..1111..',
  '.133111.',
  '13311111',
  '11111111',
  '.111111.',
  '..1111..',
  '...11...',
]);
const GOLD = fromRows([
  '....33......',
  '...3223.33..',
  '..322333223.',
  '.3223.32223.',
  '32333322333.',
  '322332223323',
  '.3333333333.',
]);
function lamp(frame) {
  const G = fromRows([
    '..333...',
    '.3...3..',
    '.33333..',
    '3.....3.',
    '3..2..3.',
    '3.222.3.',
    '3.232.3.',
    '3..3..3.',
    '.33333..',
    '1111111.',
  ]);
  if (frame) { put(G, 3, 4, 3); put(G, 3, 5, 2); put(G, 2, 5, -1); put(G, 4, 5, -1); }
  return G;
}
const LIFE = fromRows([
  '.3333....',
  '311031...',
  '31111132.',
  '31111123.',
  '.333332..',
  '2.2.2.2..',
]);

function bake(G, pal) {
  const h = G.length, w = G[0].length, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (G[y][x] >= 0) { g.fillStyle = pal[G[y][x]]; g.fillRect(x, y, 1, 1); }
  return c;
}
export function makeSprites(pal) {
  const b = G => bake(G, pal);
  const d = [0, 1].map(drill);
  return {
    // by facing: RIGHT, DOWN, LEFT, UP
    drill: [d.map(b), d.map(G => b(turn(G))), d.map(G => b(mirror(G))), d.map(G => b(flipV(turn(G))))],
    walker: [0, 1].map(f => b(walker(f))),
    borer: [0, 1].map(f => b(borer(f))),
    scared: [0, 1].map(f => b(scared(f))),
    crate: b(CRATE), gem: b(GEM), gold: b(GOLD), lamp: [0, 1].map(f => b(lamp(f))), life: b(LIFE),
  };
}
