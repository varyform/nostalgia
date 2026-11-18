// The seven skies a round can fall under. Ground colours are RGB triplets by depth below the
// surface: a lit rim, a second rim, then topsoil → middle → deep → bedrock. `vein` lights
// glowing seams in the rock (alien and volcanic fields only).
export const THEME = {
  dusk: {
    name: 'Ember Dusk', sky: ['#160c33', '#4a1a58', '#a63a5c', '#f0805a', '#ffc98a'], horizon: 0.78,
    sun: { x: 0.7, y: 0.66, r: 120, col: '#ffe0a8', glow: '#ff9a5a' }, stars: 0.25,
    far: ['#3c1a48', '#5e2552'], haze: '#ff8a6a', cloud: '#ff9f86',
    ground: { rim: [255, 196, 128], rim2: [220, 122, 78], top: [156, 76, 56], mid: [108, 46, 48], deep: [64, 26, 40], bed: [30, 14, 26] },
    sea: [80, 40, 120], accent: '#ffb877', ink: '#2a1030',
  },
  night: {
    name: 'Moonlit Ridge', sky: ['#01030b', '#050d2c', '#0c1c4c', '#1d3570'], horizon: 0.82,
    moon: { x: 0.24, y: 0.2, r: 46, col: '#eef3ff' }, stars: 1,
    far: ['#0d1a3c', '#14254e'], haze: '#3a5aa0', cloud: '#2a3c6c',
    ground: { rim: [196, 224, 255], rim2: [118, 148, 200], top: [62, 80, 120], mid: [40, 52, 88], deep: [24, 32, 58], bed: [10, 14, 30] },
    sea: [30, 60, 120], accent: '#9cc4ff', ink: '#050a1c',
  },
  desert: {
    name: 'Dune Sea', sky: ['#1f5fb4', '#4f97dc', '#a6d6f2', '#ffe8c2'], horizon: 0.85,
    sun: { x: 0.82, y: 0.16, r: 70, col: '#fffbe6', glow: '#ffe7a6' }, stars: 0,
    far: ['#d9a777', '#e9bd8a'], haze: '#ffe1b0', cloud: '#ffffff',
    ground: { rim: [255, 238, 186], rim2: [244, 206, 136], top: [226, 170, 100], mid: [198, 134, 76], deep: [152, 94, 58], bed: [98, 60, 42] },
    sea: [40, 140, 170], accent: '#ffcf7a', ink: '#3a2412',
  },
  arctic: {
    name: 'Glacier Shelf', sky: ['#0b2746', '#2c6898', '#86c4e6', '#e2f6ff'], horizon: 0.8,
    sun: { x: 0.3, y: 0.42, r: 60, col: '#ffffff', glow: '#bfe8ff' }, stars: 0.1,
    far: ['#9cc6e2', '#bcdcf0'], haze: '#e8f8ff', cloud: '#f4fbff',
    ground: { rim: [252, 255, 255], rim2: [216, 238, 252], top: [156, 202, 230], mid: [96, 146, 192], deep: [60, 96, 146], bed: [34, 56, 98] },
    sea: [40, 110, 170], accent: '#bfe8ff', ink: '#0b2034',
  },
  meadow: {
    name: 'Green Reach', sky: ['#1a5aae', '#4a90da', '#9acdf0', '#e6f5ff'], horizon: 0.84,
    sun: { x: 0.16, y: 0.18, r: 64, col: '#fffbe0', glow: '#fff2b0' }, stars: 0,
    far: ['#5c8fb0', '#78a8c0'], haze: '#d8efff', cloud: '#ffffff',
    ground: { rim: [168, 236, 96], rim2: [96, 176, 62], top: [124, 88, 54], mid: [96, 64, 44], deep: [66, 46, 36], bed: [40, 28, 26] },
    sea: [30, 120, 180], accent: '#b8f080', ink: '#10260e',
  },
  xeno: {
    name: 'Xeno Shelf', sky: ['#060119', '#260a48', '#5e1874', '#1aa49c'], horizon: 0.8,
    moon: { x: 0.78, y: 0.22, r: 54, col: '#b8fff0' }, moon2: { x: 0.66, y: 0.12, r: 22, col: '#ffb8f0' }, stars: 0.8,
    far: ['#2a0e4a', '#3e1460'], haze: '#3affd8', cloud: '#7a3aa0',
    ground: { rim: [120, 255, 222], rim2: [70, 196, 196], top: [98, 54, 142], mid: [72, 34, 112], deep: [46, 20, 78], bed: [20, 8, 42] },
    vein: [120, 255, 230], sea: [20, 200, 170], accent: '#7affe0', ink: '#0a0420',
  },
  ash: {
    name: 'Ashfall', sky: ['#080305', '#260809', '#5e160e', '#b63a16'], horizon: 0.86,
    sun: { x: 0.55, y: 0.84, r: 160, col: '#ff7a30', glow: '#ff4a10' }, stars: 0.05, embers: true,
    far: ['#2a0c0c', '#3c120e'], haze: '#ff5a20', cloud: '#3a1a1a',
    ground: { rim: [255, 128, 64], rim2: [126, 64, 52], top: [60, 48, 50], mid: [42, 34, 38], deep: [26, 20, 24], bed: [12, 8, 12] },
    vein: [255, 112, 40], sea: [255, 90, 20], accent: '#ff9a5a', ink: '#120404',
  },
};
