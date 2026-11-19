// The campaign: twelve sorties, four in each theatre, against the Cinder Pact. A mission lists
// its units (where they stand or fly, what they do, which ones are the objective), when its
// waves come in, what the jet carries and how the sortie is won or lost:
//
//   goal 'destroy'    every unit marked obj destroyed
//   goal 'intercept'  every bomber down before one reaches the end of its lane
//   goal 'escort'     the courier reaches the end of its lane alive
//   goal 'air'        every enemy aircraft down
//
// Units: kind (sim.js KINDS), at a site name or [x, z], off [dx, dz] from it, n of them in a
// row `gap` metres apart, alt (air, above the ground), hdg (degrees, 0 north), ai (air:
// patrol | hunt | escort | raid | route), lane (a theatre lane, or 'road' / 'river'), s (start
// metres along it), wave (0 at the start; others come in when `waves` says).
export const MISSIONS = [
  // ---------- Glasswater Keys ----------
  {
    name: 'Picket Line', theatre: 0, goal: 'destroy', text: 'Destroy both radar pickets',
    brief: 'Two Pact radar pickets on the outer islets watch every take-off from Port Halcyon. Blind them both. Expect light flak and a pair of fighters out of Cinder Key once they know you are there.',
    load: { ir: 4, radar: 2, rockets: 16, bombs: 0 },
    units: [
      { kind: 'radar', at: 'picketW', obj: true },
      { kind: 'aa', at: 'picketW', off: [160, 90] },
      { kind: 'radar', at: 'picketE', obj: true },
      { kind: 'aa', at: 'picketE', off: [-140, 120] },
      { kind: 'fighter', at: 'cinder', off: [0, 2000], alt: 2200, hdg: 180, ai: 'patrol', n: 2, gap: 400, wave: 1 },
    ],
    waves: [{ after: 'kill', n: 1, delay: 4 }],
  },
  {
    name: 'Long Shadow', theatre: 0, goal: 'intercept', text: 'Down the bombers before they reach Port Halcyon',
    brief: 'Four heavy bombers are coming down the channel for the harbour at Port Halcyon, with fighters riding along. Every bomber must fall before it reaches the coast. Radar missiles first, then close in.',
    load: { ir: 4, radar: 4, rockets: 0, bombs: 0 },
    units: [
      { kind: 'bomber', lane: 'bombers', s: 0, alt: 2400, n: 4, gap: 320, obj: true, ai: 'route' },
      { kind: 'fighter', lane: 'bombers', s: 300, alt: 2700, n: 2, gap: 500, ai: 'escort' },
      { kind: 'fighter', at: [5000, -9000], alt: 3000, hdg: 200, ai: 'hunt', n: 2, gap: 400, wave: 1 },
    ],
    waves: [{ after: 'time', t: 50 }],
  },
  {
    name: 'Low Tide', theatre: 0, goal: 'destroy', text: 'Sink the supply tender and its gunboats',
    brief: 'A supply tender is slipping between the Keys with two gunboats as escort, carrying fuel for Cinder Key. Sink all three. Their flak is thick at low level: come in fast with rockets or bombs.',
    load: { ir: 2, radar: 2, rockets: 16, bombs: 4 },
    units: [
      { kind: 'tender', lane: 'ships', s: 7000, obj: true },
      { kind: 'gunboat', lane: 'ships', s: 7500, obj: true },
      { kind: 'gunboat', lane: 'ships', s: 6400, obj: true },
      { kind: 'fighter', at: [-2000, -9000], alt: 2600, hdg: 160, ai: 'patrol', n: 2, gap: 400 },
    ],
  },
  {
    name: 'Cinder Key', theatre: 0, goal: 'destroy', text: 'Destroy the fuel tanks and hangars',
    brief: 'Cinder Key is the last Pact airstrip in the Keys. Burn its fuel tanks and its hangars and the islands are ours. Two SAM sites cover the strip; keep low behind the ridge until you are in range.',
    load: { ir: 4, radar: 2, rockets: 12, bombs: 6 },
    units: [
      { kind: 'depot', at: 'depot', off: [-90, 0], obj: true },
      { kind: 'depot', at: 'depot', off: [90, 0], obj: true },
      { kind: 'depot', at: 'depot', off: [0, 110], obj: true },
      { kind: 'hangar', at: 'cinder', off: [-500, 160], hdg: 0, obj: true },
      { kind: 'hangar', at: 'cinder', off: [0, 160], hdg: 0, obj: true },
      { kind: 'hangar', at: 'cinder', off: [500, 160], hdg: 0, obj: true },
      { kind: 'sam', at: 'cinder', off: [-1300, -700] },
      { kind: 'sam', at: 'cinder', off: [1300, 500] },
      { kind: 'aa', at: 'cinder', off: [0, -300] },
      { kind: 'aa', at: 'depot', off: [250, -150] },
      { kind: 'aa', at: 'cinder', off: [-800, 300] },
      { kind: 'fighter', at: 'cinder', off: [0, 2600], alt: 2000, hdg: 90, ai: 'patrol', n: 2, gap: 400 },
      { kind: 'fighter', at: 'cinder', off: [-3000, -2000], alt: 2600, hdg: 150, ai: 'hunt', n: 2, gap: 400, wave: 1 },
    ],
    waves: [{ after: 'kill', n: 3, delay: 2 }],
  },
  // ---------- Ochre Waste ----------
  {
    name: 'Salt Road', theatre: 1, goal: 'destroy', text: 'Stop the convoy before it reaches Saltpan',
    brief: 'A Pact convoy is grinding west along the salt road toward the Saltpan depot. Six trucks: none may arrive. Flak trucks ride with it. Rockets work well on a straight stretch of road.',
    load: { ir: 2, radar: 2, rockets: 19, bombs: 4 },
    units: [
      { kind: 'truck', lane: 'road', s: 17000, n: 6, gap: 70, obj: true },
      { kind: 'flaktruck', lane: 'road', s: 16900 },
      { kind: 'flaktruck', lane: 'road', s: 16520 },
      { kind: 'fighter', at: 'redstack', off: [-3000, 2000], alt: 2400, hdg: 250, ai: 'hunt', n: 2, gap: 400, wave: 1 },
    ],
    waves: [{ after: 'time', t: 70 }],
  },
  {
    name: 'Courier', theatre: 1, goal: 'escort', text: 'Bring the courier to Copperwell',
    brief: 'An Accord courier plane is crossing the Waste with the staff of the eastern front aboard. It is slow and unarmed. Stay close, and break up every Pact flight that turns in on it.',
    start: { x: -11400, z: 12000, y: 1900, heading: 45 },
    load: { ir: 6, radar: 4, rockets: 0, bombs: 0 },
    units: [
      { kind: 'courier', lane: 'courier', s: 0, alt: 1500, ai: 'route' },
      { kind: 'fighter', at: [-2000, -2000], alt: 2600, hdg: 300, ai: 'raid', n: 2, gap: 400, wave: 1 },
      { kind: 'fighter', at: [6000, 1000], alt: 2800, hdg: 270, ai: 'raid', n: 2, gap: 400, wave: 2 },
      { kind: 'fighter', at: [12000, 12000], alt: 2800, hdg: 300, ai: 'raid', n: 3, gap: 400, wave: 3 },
    ],
    waves: [{ after: 'time', t: 15 }, { after: 'time', t: 70 }, { after: 'time', t: 120 }],
  },
  {
    name: 'Sandglass Bridge', theatre: 1, goal: 'destroy', text: 'Drop Sandglass Bridge',
    brief: 'Sandglass Bridge is the only crossing of the canyon fit for armour. Drop it. It is built of stone and steel: it takes bombs, placed well. SAMs sit on both rims.',
    load: { ir: 2, radar: 2, rockets: 12, bombs: 6 },
    units: [
      { kind: 'bridge', at: 'bridge', obj: true },
      { kind: 'sam', at: 'bridge', off: [-1800, -1400] },
      { kind: 'sam', at: 'bridge', off: [1600, 1500] },
      { kind: 'aa', at: 'bridge', off: [300, -420] },
      { kind: 'aa', at: 'bridge', off: [-350, 420] },
      { kind: 'fighter', at: 'bridge', off: [0, -6000], alt: 2600, hdg: 90, ai: 'patrol', n: 2, gap: 400 },
    ],
  },
  {
    name: 'The Anvil', theatre: 1, goal: 'air', text: 'Clear the sky over the Anvil',
    brief: 'The Pact is massing fighters over the Anvil mesa to cover its retreat. Sweep them out of the sky, wave after wave. Their flight leader flies a black-nosed jet: he is good.',
    load: { ir: 6, radar: 4, rockets: 0, bombs: 0 },
    units: [
      { kind: 'fighter', at: 'anvil', alt: 2400, hdg: 180, ai: 'patrol', n: 3, gap: 500 },
      { kind: 'fighter', at: 'anvil', off: [3000, -3000], alt: 3000, hdg: 220, ai: 'hunt', n: 3, gap: 500, wave: 1 },
      { kind: 'fighter', at: 'anvil', off: [-3000, -3500], alt: 3200, hdg: 160, ai: 'hunt', n: 2, gap: 500, wave: 2 },
      { kind: 'ace', at: 'anvil', off: [-3000, -3000], alt: 3400, hdg: 160, ai: 'hunt', wave: 2 },
    ],
    waves: [{ after: 'clear', delay: 6 }, { after: 'clear', delay: 6 }],
  },
  // ---------- Hollow Spires ----------
  {
    name: 'Blind Eye', theatre: 2, goal: 'destroy', text: 'Destroy the three peak radars',
    brief: 'Three radar stations on the high peaks see every Accord flight leave Frostgate. Knock all three off their summits. Each one has a SAM beside it: hug the valleys and pop up to fire.',
    load: { ir: 4, radar: 2, rockets: 19, bombs: 0 },
    units: [
      { kind: 'radar', at: 'peakW', obj: true },
      { kind: 'sam', at: 'peakW', off: [900, 1300] },
      { kind: 'radar', at: 'peakE', obj: true },
      { kind: 'sam', at: 'peakE', off: [-1100, 900] },
      { kind: 'radar', at: 'peakN', obj: true },
      { kind: 'sam', at: 'peakN', off: [1300, 600] },
      { kind: 'aa', at: 'peakE', off: [110, 60] },
      { kind: 'fighter', at: [0, -4000], alt: 3200, hdg: 180, ai: 'patrol', n: 2, gap: 400 },
    ],
  },
  {
    name: 'Avalanche', theatre: 2, goal: 'intercept', text: 'Stop the bombers over Hollowmere',
    brief: 'Five bombers are crossing the northern ridges for the valley town of Hollowmere, escorted. None may reach it. You will have hunters on you within the minute.',
    load: { ir: 6, radar: 4, rockets: 0, bombs: 0 },
    units: [
      { kind: 'bomber', lane: 'bombers', s: 0, alt: 3400, n: 5, gap: 300, obj: true, ai: 'route' },
      { kind: 'fighter', lane: 'bombers', s: 300, alt: 3700, n: 3, gap: 450, ai: 'escort' },
      { kind: 'fighter', at: [7000, -9000], alt: 3800, hdg: 220, ai: 'hunt', n: 2, gap: 400, wave: 1 },
    ],
    waves: [{ after: 'time', t: 40 }],
  },
  {
    name: 'Cold Forge', theatre: 2, goal: 'destroy', text: 'Destroy the four foundry halls',
    brief: 'Down in the valley the Cold Forge turns out the Pact\'s missiles. Destroy all four foundry halls. Three SAM batteries and heavy flak guard it; fighters will scramble as soon as the first hall burns.',
    load: { ir: 4, radar: 2, rockets: 16, bombs: 6 },
    units: [
      { kind: 'factory', at: 'forge', off: [-260, -200], hdg: 20, obj: true },
      { kind: 'factory', at: 'forge', off: [240, -240], hdg: 20, obj: true },
      { kind: 'factory', at: 'forge', off: [-220, 260], hdg: 20, obj: true },
      { kind: 'factory', at: 'forge', off: [280, 220], hdg: 20, obj: true },
      { kind: 'sam', at: 'forge', off: [-1500, 900] },
      { kind: 'sam', at: 'forge', off: [1600, -500] },
      { kind: 'sam', at: 'forge', off: [0, -1700] },
      { kind: 'aa', at: 'forge', off: [0, 0] },
      { kind: 'aa', at: 'forge', off: [-560, 0] },
      { kind: 'aa', at: 'forge', off: [560, 40] },
      { kind: 'aa', at: 'forge', off: [0, 560] },
      { kind: 'fighter', at: 'forge', off: [0, -5000], alt: 3000, hdg: 180, ai: 'patrol', n: 2, gap: 400 },
      { kind: 'fighter', at: 'crown', alt: 3200, hdg: 200, ai: 'hunt', n: 2, gap: 400, wave: 1 },
    ],
    waves: [{ after: 'kill', n: 1, delay: 3 }],
  },
  {
    name: 'Iron Crown', theatre: 2, goal: 'destroy', text: 'Destroy the command bunker and its two aces',
    brief: 'The Pact\'s high command sits in a bunker under the Iron Crown, at the head of the valley, guarded by its two best pilots. Crack the bunker, bring down both aces, and the war in the Reach is over.',
    load: { ir: 6, radar: 4, rockets: 16, bombs: 6 },
    units: [
      { kind: 'bunker', at: 'crown', obj: true },
      { kind: 'hangar', at: 'crown', off: [-420, 300], hdg: 40 },
      { kind: 'hangar', at: 'crown', off: [400, 340], hdg: -30 },
      { kind: 'sam', at: 'crown', off: [-1600, 600] },
      { kind: 'sam', at: 'crown', off: [1500, 900] },
      { kind: 'sam', at: 'crown', off: [200, -1600] },
      { kind: 'aa', at: 'crown', off: [-200, -200] },
      { kind: 'aa', at: 'crown', off: [260, -120] },
      { kind: 'aa', at: 'crown', off: [0, 300] },
      { kind: 'aa', at: 'crown', off: [-700, -500] },
      { kind: 'ace', at: 'crown', off: [-1500, 3000], alt: 3000, hdg: 180, ai: 'patrol', n: 2, gap: 600, obj: true },
      { kind: 'fighter', at: 'crown', off: [3000, -2000], alt: 3200, hdg: 200, ai: 'hunt', n: 2, gap: 400, wave: 1 },
    ],
    waves: [{ after: 'time', t: 35 }],
  },
];

export const RANKS = [
  [0, 'Pilot Officer'], [6000, 'Flying Officer'], [16000, 'Flight Lieutenant'], [32000, 'Squadron Leader'],
  [55000, 'Wing Commander'], [85000, 'Group Captain'], [120000, 'Air Commodore'],
];
export const rankOf = score => RANKS.reduce((r, [s, name]) => (score >= s ? name : r), RANKS[0][1]);
