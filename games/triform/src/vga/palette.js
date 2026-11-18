// The VGA palette: every colour goes through the 6-bit DAC (64 levels per channel), and
// gradients are ordered-dithered between neighbouring ramp entries, the way 256-colour
// games faked smooth shading.
const q6 = v => Math.round((Math.round((Math.max(0, Math.min(255, v)) / 255) * 63) * 255) / 63);
export function vga(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = q6(n >> 16), g = q6((n >> 8) & 255), b = q6(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
export const rgbOf = hex => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};
const ramp = list => list.map(vga);

// 4 × 4 Bayer matrix, 0..15
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const dither = (x, y, f) => f * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5;

// per zone: wall ramp (dark → light), liquid ramp, sky gradient stops, accent
export const ZONE_PAL = [
  { // slag pits
    wall: ramp(['#120806', '#24100a', '#3a1a10', '#562816', '#76381e', '#9c5028', '#c4743a']),
    liquid: ramp(['#3c0800', '#801800', '#c83400', '#f86a10', '#ffb040', '#fff0a0']),
    sky: ramp(['#080202', '#1a0604', '#300a06', '#4a1008', '#66180a', '#86240c']),
    far: ramp(['#1c0806', '#2a0e08', '#3a140a']), glow: ramp(['#ff7a1a', '#ffc040', '#ffe890']),
    accent: vga('#ff9a2a'),
  },
  { // coolant works
    wall: ramp(['#060c14', '#0c1a28', '#142a3e', '#1e3e58', '#2c5a7a', '#40809e', '#62a8c4']),
    liquid: ramp(['#002a2a', '#00504a', '#088070', '#30b8a0', '#7ae8d0', '#d0fff4']),
    sky: ramp(['#02060c', '#040e1a', '#081828', '#0c2438', '#10304a', '#163e5a']),
    far: ramp(['#081626', '#0c2034', '#122c44']), glow: ramp(['#40d8ff', '#90f0ff', '#e0ffff']),
    accent: vga('#50e8ff'),
  },
  { // core spire
    wall: ramp(['#0a0614', '#160e26', '#24163a', '#342052', '#4a2e6e', '#66428e', '#8a60b0']),
    liquid: ramp(['#300030', '#600a5a', '#a01890', '#e040c8', '#ff90f0', '#ffe0ff']),
    sky: ramp(['#000002', '#02020a', '#060414', '#0a0820', '#120c2e', '#1a103c']),
    far: ramp(['#140c24', '#1c1230', '#26183e']), glow: ramp(['#40ff90', '#a0ffc8', '#e8fff0']),
    accent: vga('#60ff9a'),
  },
  { // foreman core
    wall: ramp(['#10040a', '#200812', '#34101e', '#4c182c', '#6a2440', '#8e3458', '#b85074']),
    liquid: ramp(['#3c0800', '#801800', '#c83400', '#f86a10', '#ffb040', '#fff0a0']),
    sky: ramp(['#040002', '#100208', '#200410', '#34081a', '#4a0c24', '#64102e']),
    far: ramp(['#200810', '#2c0c18', '#3a1020']), glow: ramp(['#ff3060', '#ff8090', '#ffd0d8']),
    accent: vga('#ff4070'),
  },
];

export const C = {
  black: vga('#000000'), white: vga('#ffffff'),
  ink: vga('#f0f0e8'), dim: vga('#8a8a98'), dark: vga('#202028'), shadow: vga('#08080c'),
  steel: ramp(['#20242c', '#3a404c', '#5a6272', '#8892a4', '#b8c2d2', '#e8f0ff']),
  visor: ramp(['#004860', '#00a0c8', '#60f0ff']),
  amber: ramp(['#2a1404', '#4e2808', '#7a420e', '#a86418', '#d88e2a', '#ffc050']),
  olive: ramp(['#141a08', '#26300e', '#3c4a16', '#566a20', '#76902e', '#a0bc44']),
  red: ramp(['#300404', '#700a08', '#b01810', '#f03a20', '#ff8060']),
  yellow: ramp(['#3a2c00', '#7a5c00', '#c09400', '#f0cc10', '#fff080']),
  ice: ramp(['#0e2a40', '#1e4e72', '#3a86b4', '#78c4ec', '#c8f0ff']),
  grate: ramp(['#2a2018', '#4a3a28', '#6e5838', '#94784c', '#b89c68', '#ddc690']),
  mesh: ramp(['#0a0c10', '#1a1e26', '#2c323e', '#46505e']),
  green: ramp(['#022a10', '#06582a', '#10904a', '#30d070', '#a0ffc0']),
  cyan: ramp(['#003040', '#00708a', '#10b8d8', '#80f0ff']),
  purple: ramp(['#200830', '#40125a', '#702a98', '#a850d8', '#e0a0ff']),
  hud: ramp(['#06060a', '#101018', '#1c1c28', '#2c2c3c', '#44445a', '#6a6a86']),
};
