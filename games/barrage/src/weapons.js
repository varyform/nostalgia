// What the shop sells: ordnance (WEAPONS) and gear (ITEMS). Pure data; sim.js gives each `kind`
// its behaviour. Prices are per bundle of `qty`; selling refunds half the unit price.
//
//   kind   shell  a ballistic round that bursts on contact (r = blast radius in cells, dmg at the centre)
//          skip   bursts, then hops on along the ground `hops` times
//          split  breaks into `n` bomblets at the top of its arc
//          burst  bursts, then scatters `n` bomblets
//          fire   spills `n` burning droplets that run downhill
//          roll   lands and rolls down the slope until it stops or meets a tank
//          drill  bores straight on through the ground for `len` cells, then bursts
//          dirt   piles a ball of earth (r) where it lands
//          beam   a straight energy line along the barrel, no gravity, length from power
//          seek   steers toward the nearest enemy once it falls
//          ion    a wide energy flash that hurts tanks and hardly touches the ground
export const WEAPONS = [
  { id: 'pellet', name: 'Pellet', kind: 'shell', r: 15, dmg: 32, price: 0, qty: 0, col: '#ffe9a8', blurb: 'The standard round. Always in the rack.' },
  { id: 'mortar', name: 'Mortar', kind: 'shell', r: 24, dmg: 48, price: 1200, qty: 5, col: '#ffd27a', blurb: 'A heavier round with a wider burst.' },
  { id: 'thumper', name: 'Thumper', kind: 'shell', r: 38, dmg: 68, price: 3000, qty: 3, col: '#ffb057', blurb: 'Cracks hillsides open.' },
  { id: 'sunburst', name: 'Sunburst', kind: 'shell', r: 74, dmg: 100, price: 9000, qty: 1, col: '#fff27a', big: true, blurb: 'A small sun, for a moment.' },
  { id: 'daybreak', name: 'Daybreak', kind: 'shell', r: 128, dmg: 130, price: 20000, qty: 1, col: '#ffffff', big: true, blurb: 'Takes a mountain off the map.' },
  { id: 'skipstone', name: 'Skipstone', kind: 'skip', r: 18, dmg: 34, hops: 3, price: 4000, qty: 3, col: '#9ff0ff', blurb: 'Bursts, then skips on twice more.' },
  { id: 'hailstorm', name: 'Hailstorm', kind: 'split', r: 22, dmg: 42, n: 5, price: 7500, qty: 2, col: '#cfe6ff', blurb: 'Splits into five bomblets at the top of its arc.' },
  { id: 'firecracker', name: 'Firecracker', kind: 'burst', r: 20, dmg: 30, n: 7, sub: { r: 13, dmg: 16 }, price: 5500, qty: 3, col: '#ff8ad8', blurb: 'Bursts and scatters seven sparks.' },
  { id: 'wildfire', name: 'Wildfire', kind: 'fire', r: 12, dmg: 18, n: 26, price: 5000, qty: 3, col: '#ff8a2a', blurb: 'Burning gel that runs downhill.' },
  { id: 'inferno', name: 'Inferno', kind: 'fire', r: 16, dmg: 26, n: 64, price: 11000, qty: 2, col: '#ff5a1f', blurb: 'A flood of it.' },
  { id: 'boulder', name: 'Boulder', kind: 'roll', r: 30, dmg: 60, price: 3500, qty: 4, col: '#d8c3a0', blurb: 'Rolls down the slope into whoever waits below.' },
  { id: 'auger', name: 'Auger', kind: 'drill', r: 20, dmg: 40, len: 170, price: 3000, qty: 4, col: '#c0ffd0', blurb: 'Bores through hills to reach a tank behind.' },
  { id: 'excavator', name: 'Excavator', kind: 'shell', r: 52, dmg: 10, price: 1500, qty: 4, col: '#b6a58c', blurb: 'Scoops out a big pit. Barely scratches paint.' },
  { id: 'mudball', name: 'Mudball', kind: 'dirt', r: 36, dmg: 0, price: 1000, qty: 5, col: '#a07850', blurb: 'Drops a lump of earth. Builds a wall, fills a pit.' },
  { id: 'earthwork', name: 'Earthwork', kind: 'dirt', r: 72, dmg: 0, price: 2500, qty: 3, col: '#8a6440', blurb: 'Raises a whole hill where it lands.' },
  { id: 'lance', name: 'Arc Lance', kind: 'beam', r: 7, dmg: 58, price: 8000, qty: 2, col: '#7affea', blurb: 'A straight line of light. Power sets its reach.' },
  { id: 'seeker', name: 'Seeker', kind: 'seek', r: 28, dmg: 60, price: 9500, qty: 2, col: '#ff6b8a', blurb: 'Steers for the nearest enemy on the way down.' },
  { id: 'ion', name: 'Ion Bloom', kind: 'ion', r: 88, dmg: 62, price: 6500, qty: 2, col: '#b28aff', blurb: 'A wide flash that hurts tanks, not ground.' },
];

// gear: used on your turn (shields, patch, blink, fuel), or by itself (glider, when you fall)
export const ITEMS = [
  { id: 'buckler', name: 'Buckler', kind: 'shield', hp: 45, price: 3000, qty: 2, col: '#8fd8ff', blurb: 'A light shield bubble. Soaks 45.' },
  { id: 'aegis', name: 'Aegis', kind: 'shield', hp: 100, price: 7000, qty: 1, col: '#6aa8ff', blurb: 'A solid shield. Soaks 100.' },
  { id: 'bastion', name: 'Bastion', kind: 'shield', hp: 180, price: 12000, qty: 1, col: '#c48aff', blurb: 'The heaviest shield. Soaks 180.' },
  { id: 'glider', name: 'Glider', kind: 'glider', price: 2000, qty: 3, col: '#ffe08a', blurb: 'Opens by itself when you fall: no fall damage.' },
  { id: 'patch', name: 'Patch Kit', kind: 'patch', hp: 35, price: 3500, qty: 2, col: '#7dff9a', blurb: 'Welds 35 armour back on. Power comes back with it.' },
  { id: 'fuel', name: 'Fuel Cell', kind: 'fuel', fuel: 150, price: 1500, qty: 3, col: '#ffcf5a', blurb: 'Lets the tank crawl a short way.' },
  { id: 'blink', name: 'Blink Beacon', kind: 'blink', price: 4500, qty: 1, col: '#ff9cf0', blurb: 'Jumps the tank to a random spot. Once a turn.' },
];

export const WEAPON = Object.fromEntries(WEAPONS.map(w => [w.id, w]));
export const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));
export const GOODS = [...WEAPONS.filter(w => w.price > 0), ...ITEMS];
export const GOOD = Object.fromEntries(GOODS.map(g => [g.id, g]));
export const MAX_STOCK = 99;
/** Refund for one unit sold back. */
export const unitRefund = g => Math.floor(g.price / g.qty / 2);
