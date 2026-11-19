// The three theatres of the Marchland, where the Marchland Guard holds the river country against
// the Grey Combine: a jungle river delta at hazy midday, a farmland-and-forest valley in autumn
// light, and a misty mountain pass at dawn. All invented for Treeline.
//
// Each theatre is data for world.js:
//   shape(x, z)          the raw ground height (m) before rivers, roads and pads are cut in
//   forest(x, z, y)      0..1, how wooded the ground is (world.js clears roads, pads, towns, water)
//   farm(x, z, y)        0..1, how likely the ground is farmland (fields), or null for none
//   water, edge          the water line, and the ground height beyond the map
//   rivers [{ pts, w }]  polylines (x, z) carved below the water line, w = width (m)
//   roads [{ name, pts, w }]  polylines flattened into the ground; convoys drive them by name
//   towns [{ x, z, r, label, n }]  villages: n houses scattered in radius r (no masking)
//   sites { name: { x, z, r, label, pad, kind, h } }  flat places: pad = a cleared landing pad
//                        (kind 'farp' home base, 'lz' landing zone), others are target areas
//   trees [{ name, col, trunk, shape, h: [min, max], r: [min, max] }]  the tree kinds
//                        (shape: 'cone' | 'round' | 'palm' | 'tall'); kind index = place in the list
//   sky, land            the look: sky colours, sun, fog; ground palette per cover type
//   start { x, z, heading }  where a mission starts when it doesn't say (on the home pad)
// World axes: x east, y up, z south (north is −z, heading 0). Metres. The map is ±6400 m.
import { fbm, polyDist, ridged, smooth } from '@nostalgia/gl/noise';

// ---------- Mirewater Delta: jungle, mangroves, braided channels to the sea ----------
const D_MAIN = [[300, -6600], [600, -5200], [-200, -3800], [900, -2400], [400, -800], [1400, 600], [800, 2200], [1600, 3800], [1200, 5400], [1800, 6800]];
const D_WEST = [[400, -800], [-900, 200], [-2200, 400], [-3000, 1600], [-2600, 3200], [-3600, 4800], [-3400, 6800]];
const D_EAST = [[1400, 600], [2800, 400], [4200, 1400], [5000, 3000], [6200, 4200], [6800, 4600]];
const D_CREEK = [[-200, -3800], [-1600, -4400], [-3000, -4000], [-4600, -4800], [-6800, -4600]];
const D_ROAD = [[6800, -5000], [5000, -4300], [3400, -3200], [2200, -2000], [900, -1500], [-600, -1300], [-2000, -2200], [-2600, -2600]];
function delta(x, z) {
  let y = 4 + fbm(x, z, 11, 1800, 4) * 3 + fbm(x, z, 13, 300, 3) * 1.2;
  // jungle hills to the north-west and north-east
  const hw = Math.max(0, 1 - Math.hypot((x + 4200) / 2200, (z + 3400) / 1700)), he = Math.max(0, 1 - Math.hypot((x - 4300) / 1800, (z + 4800) / 1500));
  y += (hw ** 1.6) * (170 + fbm(x, z, 17, 700, 4) * 60) + (he ** 1.6) * (140 + fbm(x, z, 19, 600, 4) * 50);
  y += smooth(0.1, 0.6, fbm(x, z, 23, 2600, 3)) * 18;
  // the sea along the south
  y -= smooth(3600, 6200, z + fbm(x, z, 29, 1500, 3) * 700) * 14;
  return y;
}
const deltaForest = (x, z, y) => (y < 0.6 ? 0 : smooth(-0.35, 0.15, fbm(x, z, 31, 900, 4)) * (0.6 + 0.4 * smooth(1, 6, y)));
const deltaFarm = (x, z, y) => (y > 1.2 && y < 9 ? smooth(0.25, 0.45, fbm(x, z, 37, 1400, 3)) : 0);

// ---------- Amberfold Vale: a farmed valley floor, forested slopes, an autumn ridge line ----------
const V_RIVER = [[-1400, -6800], [-800, -5000], [300, -3600], [-200, -2200], [300, -800], [-300, 700], [500, 2200], [-200, 3800], [600, 5400], [200, 6800]];
const V_ROAD = [[-800, 6800], [-1200, 5200], [-900, 3600], [-1300, 2600], [-700, 1200], [-500, -200], [300, -800], [1100, -1500], [1800, -2400], [1500, -3800], [600, -5000], [700, -6800]];
const V_LANE = [[-3000, 5200], [-1200, 5200], [-900, 3600], [-1300, 2600], [-700, 1200], [-500, -200], [300, -800], [1100, -1500], [1800, -2400]];
function vale(x, z) {
  const w = x + fbm(x, z, 41, 3000, 3) * 900;
  const across = Math.abs(w) / 4400;
  let y = 70 + smooth(0.34, 1.05, across) ** 1.3 * 400 + ridged(x, z, 43, 2300, 4) * 120 * smooth(0.3, 0.9, across);
  y += fbm(x, z, 47, 1200, 4) * 26 + fbm(x, z, 53, 350, 3) * 5;
  y += Math.max(0, 1 - Math.hypot((x - 3800) / 900, (z + 3800) / 900)) ** 1.5 * 140; // Beacon Hill
  return y;
}
const valeForest = (x, z, y) => smooth(-0.1, 0.4, fbm(x, z, 59, 1100, 4) + smooth(120, 260, y) * 0.5 - 0.3);
const valeFarm = (x, z, y) => smooth(150, 105, y);

// ---------- Greyhorn Pass: peaks, pine slopes, a road climbing to the saddle ----------
const P_VALLEY = [[0, 6800], [-300, 5200], [-1300, 3400], [-800, 1600], [600, 200], [200, -1600], [700, -3200], [500, -4400], [-300, -5600], [-600, -6800]];
const P_ROAD = [[-200, 6800], [-600, 5600], [-1100, 4200], [-1500, 3300], [-900, 2400], [-500, 1500], [700, 700], [300, -300], [-100, -1100], [500, -1900], [900, -2800], [400, -3400], [700, -3900], [500, -4400]];
function pass(x, z) {
  const v = polyDist(P_VALLEY, x, z).d;
  const along = smooth(6800, -4400, z); // the floor climbs toward the saddle
  const floor = 360 + along * 760 + fbm(x, z, 61, 1600, 3) * 30 - smooth(-4400, -6800, z) * 260;
  const peaks = 850 + ridged(x, z, 67, 2600, 5) * 900 + fbm(x, z, 71, 3200, 3) * 180;
  let y = floor + Math.max(0, peaks - floor) * smooth(450, 2300, v + fbm(x, z, 73, 900, 3) * 260) ** 1.35;
  // the Shelter shoulder: a high bench west of the pass
  y += Math.max(0, 1 - Math.hypot((x + 2600) / 1100, (z + 800) / 1100)) ** 2 * 40;
  // the tarn below the road
  const lake = Math.hypot((x + 2300) / 1.5, z - 2400) / 520;
  if (lake < 1.5) y = Math.min(y, 296 + 190 * smooth(0.55, 1.5, lake));
  return y;
}
const passForest = (x, z, y) => smooth(1250, 1000, y) * smooth(-0.25, 0.2, fbm(x, z, 79, 800, 4) + 0.1);

export const THEATRES = [
  {
    id: 'delta', name: 'Mirewater Delta', short: 'DELTA', seed: 7101, water: 0, edge: -12, shape: delta, forest: deltaForest, farm: deltaFarm,
    blurb: 'Jungle and mangrove on a hundred channels. The Combine runs its river posts from the hills to the north.',
    sky: { zenith: '#5d8fb0', horizon: '#dfe6d2', sun: [0.25, 0.9, -0.35], sunCol: '#fff6dc', fog: 1 / 3400, ambient: 0.55, haze: '#d4dcc4', time: 'midday' },
    land: { deep: '#2f4f48', shallow: '#5d7a5a', mud: '#7a6a48', grass: '#5f8a3a', field: ['#8fae4a', '#6f9a3e', '#a8b860', '#7c8e44'], forest: '#2f5a28', town: '#8a7a5e', road: '#9a8462', rock: '#6e6a58', snow: '#e8ecef', pad: '#8a8270' },
    trees: [
      { name: 'palm', shape: 'palm', col: '#4f7f2c', trunk: '#6d5a3c', h: [13, 19], r: [4, 6] },
      { name: 'canopy', shape: 'round', col: '#2e5e26', trunk: '#4c3a26', h: [18, 27], r: [7, 11] },
      { name: 'mangrove', shape: 'round', col: '#3c6a30', trunk: '#3a2e22', h: [9, 13], r: [5, 8] },
    ],
    treeKind: (x, z, y, rnd) => (y < 3 ? 2 : rnd < 0.18 ? 0 : 1),
    rivers: [{ pts: D_MAIN, w: 120 }, { pts: D_WEST, w: 80 }, { pts: D_EAST, w: 70 }, { pts: D_CREEK, w: 60 }],
    roads: [{ name: 'levee', pts: D_ROAD, w: 9 }],
    towns: [
      { x: -2600, z: -2600, r: 220, label: 'Stilt Village', n: 14 },
      { x: 3000, z: -2900, r: 200, label: 'Kettle Landing', n: 10 },
      { x: -4300, z: 3500, r: 160, label: 'Fenpost', n: 6 },
    ],
    sites: {
      home: { x: -4200, z: 4100, r: 120, label: 'Fenpost FARP', pad: true, kind: 'farp' },
      reedfort: { x: 400, z: -4200, r: 220, label: 'Reed Fort' },
      depot: { x: 2400, z: -1700, r: 160, label: 'Kettle depot' },
      stilts: { x: -2300, z: -2350, r: 90, label: 'Stilt Village LZ', pad: true, kind: 'lz' },
      bridge: { x: 620, z: -1460, label: 'Levee Bridge' },
      samN: { x: 1500, z: -5200, r: 140, label: 'North battery' },
      samE: { x: 4200, z: -3600, r: 140, label: 'East battery' },
      hills: { x: -4200, z: -3400, label: 'Ashwood Hills' },
    },
    start: { x: -4200, z: 4100, heading: 0 },
  },
  {
    id: 'vale', name: 'Amberfold Vale', short: 'VALE', seed: 7202, water: 50, edge: 300, shape: vale, forest: valeForest, farm: valeFarm,
    blurb: 'Farms and beechwoods in autumn colour, a river down the middle. The Combine is pushing armour south along the valley road.',
    sky: { zenith: '#4a73a8', horizon: '#f2d6a8', sun: [-0.55, 0.42, -0.72], sunCol: '#ffe2b0', fog: 1 / 4200, ambient: 0.5, haze: '#eed7b4', time: 'afternoon' },
    land: { deep: '#2d4a5a', shallow: '#4a6e72', mud: '#7d6a4a', grass: '#8b9a4e', field: ['#c9a85a', '#a88a46', '#7f8e3e', '#b37a42'], forest: '#6a5a2c', town: '#9a8a70', road: '#a89a80', rock: '#857a68', snow: '#eef0f2', pad: '#8c8676' },
    trees: [
      { name: 'beech', shape: 'round', col: '#c8782c', trunk: '#4e3c2a', h: [16, 24], r: [6, 9] },
      { name: 'birch', shape: 'tall', col: '#e0b83a', trunk: '#d8d2c4', h: [14, 20], r: [3.5, 5] },
      { name: 'pine', shape: 'cone', col: '#2f4a2a', trunk: '#4a3826', h: [17, 26], r: [3.5, 5] },
      { name: 'maple', shape: 'round', col: '#b8382a', trunk: '#4a3424', h: [13, 19], r: [5, 8] },
    ],
    treeKind: (x, z, y, rnd) => (y > 300 ? (rnd < 0.6 ? 2 : 1) : rnd < 0.45 ? 0 : rnd < 0.7 ? 1 : rnd < 0.85 ? 3 : 2),
    rivers: [{ pts: V_RIVER, w: 70 }],
    roads: [{ name: 'valley', pts: V_ROAD, w: 9 }, { name: 'harvest', pts: V_LANE, w: 8 }],
    towns: [
      { x: -1900, z: 2700, r: 240, label: 'Hollin', n: 16 },
      { x: 2400, z: -2500, r: 260, label: 'Marrow', n: 18 },
      { x: -200, z: -5200, r: 200, label: 'Tarnby', n: 10 },
    ],
    sites: {
      home: { x: -3000, z: 5200, r: 120, label: 'Hollin FARP', pad: true, kind: 'farp' },
      bridge: { x: 300, z: -800, label: 'Millrace Bridge' },
      marrow: { x: 2400, z: -2500, r: 260, label: 'Marrow' },
      beacon: { x: 3800, z: -3800, r: 160, label: 'Beacon Hill' },
      tarnby: { x: -200, z: -5200, r: 200, label: 'Tarnby' },
      woods: { x: -3200, z: -1800, label: 'Gallow Woods' },
    },
    start: { x: -3000, z: 5200, heading: 0 },
  },
  {
    id: 'pass', name: 'Greyhorn Pass', short: 'PASS', seed: 7303, water: 300, edge: 1400, shape: pass, forest: passForest, farm: null,
    blurb: 'Pine slopes under bare grey peaks, a road of switchbacks up to the saddle. Mist lies in the valley at dawn; the air is thin up high.',
    sky: { zenith: '#3a4a72', horizon: '#e8b898', sun: [0.62, 0.18, -0.76], sunCol: '#ffcfa0', fog: 1 / 2600, ambient: 0.46, haze: '#c9c2c4', time: 'dawn', mist: 520 },
    land: { deep: '#2a3e50', shallow: '#46606e', mud: '#6c6250', grass: '#5e6e44', field: ['#6e7a4a', '#7a7a52', '#5c6a42', '#828056'], forest: '#2c3e2c', town: '#7a7266', road: '#8a8478', rock: '#6c6a6c', snow: '#eef2f6', pad: '#827e76' },
    trees: [
      { name: 'spruce', shape: 'cone', col: '#24402e', trunk: '#3a2e24', h: [16, 26], r: [3.5, 5.5] },
      { name: 'fir', shape: 'cone', col: '#2e4a34', trunk: '#3e3226', h: [12, 20], r: [3, 4.5] },
      { name: 'larch', shape: 'cone', col: '#b89a3a', trunk: '#4a3a28', h: [14, 22], r: [3.5, 5] },
    ],
    treeKind: (x, z, y, rnd) => (rnd < 0.5 ? 0 : rnd < 0.85 ? 1 : 2),
    rivers: [],
    roads: [{ name: 'pass', pts: P_ROAD, w: 9 }],
    towns: [
      { x: -500, z: 4600, r: 180, label: 'Greyford', n: 10 },
      { x: 600, z: -4600, r: 160, label: 'Gatehouse', n: 6 },
    ],
    sites: {
      home: { x: -700, z: 5600, r: 120, label: 'Greyford FARP', pad: true, kind: 'farp' },
      shelter: { x: -2600, z: -800, r: 90, label: 'High Shelter LZ', pad: true, kind: 'lz' },
      battery: { x: 1300, z: -2400, r: 200, label: 'Cliff Battery' },
      gate: { x: 500, z: -4400, r: 260, label: 'The Gatehouse' },
      tarn: { x: -2300, z: 2400, label: 'Greyhorn Tarn' },
    },
    start: { x: -700, z: 5600, heading: 0 },
  },
];
