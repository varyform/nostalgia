// The three theatres of the Saltmere Reach, where the Tern Accord holds the coast against the
// Cinder Pact: an archipelago, a desert of mesas cut by a canyon, and a range of snow peaks.
// Each is a height function of (x, z) (world.js samples it on its grid), the level of its
// water, the height of the ground beyond the map's edge, its sky, and its named sites: flat
// pads for bases and targets, and runways. Places and factions are invented for Contrail.
import { fbm, polyDist, ridged, smooth } from './noise.js';

// ---------- Glasswater Keys: islands in a warm sea ----------
const ISLANDS = [
  // x, z, radius, peak
  [0, 10400, 3300, 340], // Port Halcyon, home
  [2600, -9200, 3700, 520], // Cinder Key, the Pact's airstrip
  [-7000, -2200, 1050, 130], // west picket islet
  [6800, -3600, 1150, 160], // east picket islet
  [-9200, 7200, 2500, 640], // Mount Ember, a volcano
  [9200, 9000, 1900, 280],
  [-4200, -10200, 1500, 240],
  [10400, -11000, 2100, 430],
  [-11300, -8300, 1300, 210],
  [4300, 3600, 800, 90],
  [-3400, 4300, 1000, 150],
  [11600, -400, 1400, 340],
  [-12000, 1500, 1700, 300],
  [-1500, -4300, 600, 70],
];
function keys(x, z) {
  let y = -90;
  for (const [cx, cz, r, peak] of ISLANDS) {
    const d = Math.hypot(x - cx, z - cz) / r;
    if (d >= 1.25) continue;
    const warp = fbm(x, z, 17, 1400, 3) * 0.22, dd = d + warp;
    if (dd >= 1) continue;
    const bump = (1 - dd * dd) ** 2;
    let hy = -90 + (peak + 110) * bump + fbm(x, z, 29, 700, 4) * peak * 0.28 * bump;
    if (cx === -9200) hy -= 260 * smooth(0.18, 0, d); // the crater
    y = Math.max(y, hy);
  }
  return y;
}

// ---------- Ochre Waste: mesas, a canyon, a salt road ----------
const RIVER = [[-14600, -700], [-9000, 900], [-4200, 1500], [-800, 300], [3200, 2400], [8200, 2000], [14600, 4300]];
const ROAD = [[12600, -11600], [8600, -8400], [6000, -5200], [1600, -3400], [-3600, -4600], [-8400, -3000], [-12200, -5200]];
function waste(x, z) {
  let y = 70 + fbm(x, z, 41, 5200, 4) * 50 + fbm(x, z, 43, 900, 3) * 10;
  const m = fbm(x, z, 47, 3600, 4) + fbm(x, z, 53, 9000, 2) * 0.3;
  // mesas: flat tops in two steps, steep walls
  y += smooth(0.18, 0.24, m) * 210 + smooth(0.42, 0.47, m) * 190;
  y += ridged(x, z, 59, 2600, 3) * 40 * smooth(0.1, 0.3, m);
  const r = polyDist(RIVER, x, z).d;
  y = Math.min(y, -14 + smooth(150, 520, r) * (y + 14)); // the canyon down to the river
  const road = polyDist(ROAD, x, z).d;
  if (road < 260) y = y + (Math.min(y, 120) - y) * smooth(260, 40, road) * smooth(0.2, 0.5, m); // cuttings
  return y;
}

// ---------- Hollow Spires: ridges, a glacial valley, a lake ----------
const VALLEY = [[0, 14600], [0, 8000], [-2600, 2600], [-3600, -1000], [-1200, -6400], [3800, -11600], [5200, -14600]];
const PEAKS = [
  [-6600, -3600, 2200, 2350], // radar peak west
  [5600, -1400, 2000, 2250], // radar peak east
  [-4200, -10600, 1900, 2450], // radar peak north
  [-9000, 6000, 3000, 2600],
  [8600, 7600, 3200, 2500],
];
function spires(x, z) {
  const v = polyDist(VALLEY, x, z).d;
  const rid = ridged(x, z, 61, 5200, 5);
  let y = 500 + rid * 1700 + fbm(x, z, 67, 2400, 4) * 260;
  for (const [cx, cz, r, peak] of PEAKS) {
    const d = Math.hypot(x - cx, z - cz) / r;
    if (d < 1) y = Math.max(y, y + (peak - y) * (1 - d * d) ** 2);
  }
  const floor = 330 + fbm(x, z, 71, 3000, 3) * 40;
  y = floor + (y - floor) * smooth(500, 2600, v) ** 1.4;
  // the lake basin, below the water line
  const lake = Math.hypot((x + 3300) / 1.6, z - 400) / 1200;
  if (lake < 1.4) y = Math.min(y, 200 + 160 * smooth(0.5, 1.4, lake));
  return y;
}

export const THEATRES = [
  {
    id: 'keys', name: 'Glasswater Keys', short: 'KEYS', seed: 4103, water: 0, edge: -90, shape: keys,
    blurb: 'A scatter of reef islands. The Pact holds Cinder Key in the north; the Accord, Port Halcyon in the south.',
    sky: { zenith: '#2d6fb7', horizon: '#cde4ee', sun: [0.42, 0.62, -0.66], sunCol: '#fff4d8', fog: 1 / 9000, ambient: 0.5, haze: '#e8f2f4' },
    land: {
      deep: '#1d5d8c', shallow: '#3fb3b6', sand: '#e9d7a5', low: '#5f9e4a', mid: '#3f7c3b', high: '#7a7352', rock: '#7d7466', top: '#5d554c',
    },
    props: 'palm',
    sites: {
      home: { x: 0, z: 10500, r: 700, h: 16, label: 'Port Halcyon', runway: { len: 2600, wid: 64, dir: 0 } },
      picketW: { x: -7000, z: -2200, r: 260, label: 'West picket' },
      picketE: { x: 6800, z: -3600, r: 260, label: 'East picket' },
      cinder: { x: 2600, z: -8700, r: 900, label: 'Cinder Key', runway: { len: 1900, wid: 54, dir: 90 } },
      depot: { x: 3300, z: -9700, r: 360 },
      ember: { x: -9200, z: 7200, label: 'Mount Ember' },
    },
    lanes: {
      ships: [[-12500, -6400], [-6000, -5400], [-1800, -6200], [3800, -3200], [8800, 600], [13000, 2800]],
      bombers: [[-2500, -15500], [-1200, -4000], [0, 9800]],
    },
    start: { x: 0, z: 8200, y: 1500, heading: 0 },
  },
  {
    id: 'waste', name: 'Ochre Waste', short: 'WASTE', seed: 5207, water: 0, edge: 80, shape: waste,
    blurb: 'Mesas and salt flats, split by the Sandglass canyon. The Pact runs its supplies down the salt road.',
    sky: { zenith: '#3c78b9', horizon: '#f1dcb4', sun: [-0.35, 0.72, -0.6], sunCol: '#fff0d0', fog: 1 / 9500, ambient: 0.48, haze: '#f6e7c8' },
    land: {
      deep: '#2c5c6a', shallow: '#4f8f86', sand: '#d9b27a', low: '#d1a466', mid: '#c48a52', high: '#b8743f', rock: '#9e5a35', top: '#d7b07a',
    },
    props: 'rock',
    river: RIVER, road: ROAD,
    sites: {
      home: { x: -7000, z: 9600, r: 700, label: 'Brightwell', runway: { len: 2400, wid: 60, dir: 90 } },
      redstack: { x: 8600, z: -8600, r: 900, label: 'Redstack', runway: { len: 1800, wid: 54, dir: 40 } },
      bridge: { x: -800, z: 300, label: 'Sandglass Bridge' },
      copperwell: { x: 9600, z: 7600, r: 600, label: 'Copperwell' },
      anvil: { x: 1500, z: -6500, label: 'The Anvil' },
      saltpan: { x: -12200, z: -5200, r: 500, label: 'Saltpan depot' },
    },
    lanes: {
      courier: [[-12600, 12600], [-6000, 6000], [0, 4800], [5200, 6200], [9600, 7600]],
    },
    start: { x: -7000, z: 7400, y: 1600, heading: 30 },
  },
  {
    id: 'spires', name: 'Hollow Spires', short: 'SPIRES', seed: 6311, water: 260, edge: 1500, shape: spires,
    blurb: 'Snow ridges round one long glacial valley. The Pact has dug in at its far end, under the Iron Crown.',
    sky: { zenith: '#27315f', horizon: '#eba57c', sun: [0.55, 0.32, -0.77], sunCol: '#ffd2a8', fog: 1 / 8200, ambient: 0.42, haze: '#f2c29e' },
    land: {
      deep: '#24465e', shallow: '#3e6f84', sand: '#8c8a74', low: '#4e6b3c', mid: '#2f5134', high: '#6d6a66', rock: '#5c5a5c', top: '#eef2f7',
    },
    props: 'pine',
    valley: VALLEY,
    sites: {
      home: { x: 0, z: 10800, r: 600, label: 'Frostgate', runway: { len: 2600, wid: 64, dir: 0 } },
      peakW: { x: -6600, z: -3600, r: 150, label: 'Peak radar W' },
      peakE: { x: 5600, z: -1400, r: 150, label: 'Peak radar E' },
      peakN: { x: -4200, z: -10600, r: 150, label: 'Peak radar N' },
      forge: { x: -1600, z: -6000, r: 700, label: 'Cold Forge' },
      crown: { x: 3700, z: -11300, r: 700, label: 'Iron Crown' },
      town: { x: 0, z: 6400, r: 500, label: 'Hollowmere' },
    },
    lanes: {
      bombers: [[-9000, -15500], [-4200, -3000], [0, 6400]],
    },
    start: { x: 0, z: 8800, y: 1700, heading: 0 },
  },
];
