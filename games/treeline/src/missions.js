// The campaign: twelve missions for the Marchland Guard, four in each theatre, against the Grey
// Combine. A mission lists its units (where they stand or drive, what they do, which ones are
// the objective), when its waves come in, what the Gadfly carries and how it is won or lost:
//
//   goal 'destroy'  every unit marked obj destroyed (strikes, SAM hunts)
//   goal 'ambush'   every obj vehicle destroyed before one drives to `to` metres along its road
//   goal 'escort'   at least `need` of the convoy (kind 'ally') reach `to` metres along their road
//   goal 'rescue'   land at the `lz` site, wait while the survivors board, land back at home
//
// type is what the briefing calls it. Units: kind (sim.js KINDS), at a site name or [x, z], off
// [dx, dz] from it, n of them in a row `gap` metres apart, hdg (degrees, 0 north); or road (a
// theatre road's name), s (metres along it), dir (+1 along the road, −1 back), to (where it
// stops); alt (aircraft, above the ground); ai (aircraft: 'patrol' | 'hunt' | 'strike', which
// goes for the convoy or the landing zone); wave (0 at the start; others come in when `waves`
// says: after 'time' t | 'kill' n | 'clear' | 'lz' (the Gadfly is down at the LZ) | 'pass' s (the
// convoy's lead is s metres along), with an optional delay).
export const TYPES = { destroy: 'STRIKE', ambush: 'CONVOY AMBUSH', escort: 'ESCORT', rescue: 'RESCUE' };

export const MISSIONS = [
  // ---------- Mirewater Delta ----------
  {
    name: 'Reed Fort', theatre: 0, goal: 'destroy', type: 'STRIKE', text: 'Destroy the radar and the fuel at Reed Fort',
    brief: 'The Combine has a river post at Reed Fort, a radar mast and two fuel dumps on a mud island in the north channel. Burn them. Light guns only, and a pair of carriers on the bank. Keep low over the jungle on the way in.',
    load: { gun: 600, rkt: 38, atm: 6, aam: 2, flares: 12 },
    units: [
      { kind: 'radar', at: 'reedfort', obj: true },
      { kind: 'depot', at: 'reedfort', off: [-90, 60], obj: true },
      { kind: 'depot', at: 'reedfort', off: [80, 90], obj: true },
      { kind: 'aa', at: 'reedfort', off: [40, -110] },
      { kind: 'apc', at: 'reedfort', off: [-200, -60], hdg: 90 },
      { kind: 'apc', at: 'reedfort', off: [170, 170], hdg: 200 },
    ],
  },
  {
    name: 'Mudline', theatre: 0, goal: 'ambush', type: 'CONVOY AMBUSH', text: 'Stop the convoy before the Levee Bridge',
    fail: 'The convoy crossed the Levee Bridge',
    brief: 'A Combine supply column is running west down the levee road toward the Levee Bridge: trucks and fuel bowsers, carriers riding with them and an AA track at the tail. Not one supply vehicle may cross. Hit it from the treeline.',
    load: { gun: 600, rkt: 38, atm: 8, aam: 2, flares: 12 },
    units: [
      { kind: 'truck', road: 'levee', s: 2300, to: 7246, n: 4, gap: 40, obj: true },
      { kind: 'fueler', road: 'levee', s: 2120, to: 7246, n: 2, gap: 40, obj: true },
      { kind: 'apc', road: 'levee', s: 2380, to: 7246 },
      { kind: 'apc', road: 'levee', s: 2040, to: 7246 },
      { kind: 'aatrack', road: 'levee', s: 1980, to: 7246 },
      { kind: 'aa', at: 'samE', off: [-200, 300] },
    ],
  },
  {
    name: 'Stilt Village', theatre: 0, goal: 'rescue', type: 'RESCUE', text: 'Bring the survivors out of Stilt Village', lz: 'stilts', survivors: 4, wait: 12,
    brief: 'A Guard patrol boat went down in the creek; four of its crew are hiding at Stilt Village. Land on the clearing by the huts and wait while they climb aboard, then bring them home to Fenpost. Carriers are combing the jungle, and the Combine will send a Mantis once you are seen.',
    load: { gun: 600, rkt: 38, atm: 6, aam: 4, flares: 12 },
    units: [
      { kind: 'apc', at: 'stilts', off: [600, -300], hdg: 250 },
      { kind: 'apc', at: 'stilts', off: [-500, -500], hdg: 120 },
      { kind: 'aa', at: 'stilts', off: [900, 200] },
      { kind: 'truck', at: 'stilts', off: [700, -350], hdg: 250 },
      { kind: 'mantis', at: 'hills', alt: 60, ai: 'strike', wave: 1 },
    ],
    waves: [{ after: 'lz', delay: 4 }],
  },
  {
    name: 'Silent Channel', theatre: 0, goal: 'destroy', type: 'SAM HUNT', text: 'Destroy the SAM batteries and their radar',
    brief: 'Two SAM batteries and a search radar close the north channel to everything that flies. Take them out. Below thirty metres the radar cannot see you through the ground clutter; the launchers need it, or a long look of their own. Two Mantis gunships patrol the hills.',
    load: { gun: 600, rkt: 38, atm: 8, aam: 4, flares: 14 },
    units: [
      { kind: 'radar', at: 'samN', off: [0, 0], obj: true },
      { kind: 'sam', at: 'samN', off: [-140, 90], obj: true },
      { kind: 'sam', at: 'samN', off: [150, 60], obj: true },
      { kind: 'aa', at: 'samN', off: [10, 160] },
      { kind: 'sam', at: 'samE', obj: true },
      { kind: 'aa', at: 'samE', off: [130, -90] },
      { kind: 'mantis', at: 'hills', off: [1800, 400], alt: 70, ai: 'patrol' },
      { kind: 'mantis', at: 'samE', off: [-600, -900], alt: 70, ai: 'patrol', wave: 1 },
    ],
    waves: [{ after: 'kill', n: 2, delay: 5 }],
  },
  // ---------- Amberfold Vale ----------
  {
    name: 'Harvest Road', theatre: 1, goal: 'escort', type: 'ESCORT', text: 'See the supply trucks safe to Marrow', need: 3,
    brief: 'Four Guard trucks of food and ammunition are leaving Hollin for Marrow up the harvest road. The Combine has armour hidden in Gallow Woods along the way. The trucks halt when they meet trouble: clear the road ahead, and at least three must arrive.',
    load: { gun: 600, rkt: 38, atm: 8, aam: 2, flares: 12 },
    units: [
      { kind: 'ally', road: 'harvest', s: 4600, to: 10400, n: 4, gap: 45 },
      { kind: 'tank', road: 'harvest', s: 6900, off: [140, 0], hdg: 240 },
      { kind: 'tank', road: 'harvest', s: 7150, off: [-160, 0], hdg: 120 },
      { kind: 'apc', road: 'harvest', s: 6600, off: [-120, 0], hdg: 90 },
      { kind: 'aa', road: 'harvest', s: 9300, off: [220, 0] },
      { kind: 'apc', road: 'harvest', s: 9600, off: [-150, 0], hdg: 200 },
      { kind: 'mantis', at: 'tarnby', alt: 70, ai: 'strike', wave: 1 },
    ],
    waves: [{ after: 'pass', s: 7400, delay: 2 }],
  },
  {
    name: 'Millrace Bridge', theatre: 1, goal: 'destroy', type: 'STRIKE', text: 'Drop the Millrace Bridge',
    brief: 'The Millrace Bridge is the only crossing heavy armour can use. Bring it down: it is stone and steel and will take guided missiles or a lot of rockets. AA guns sit on both banks and a SAM launcher covers it from the east.',
    load: { gun: 600, rkt: 38, atm: 8, aam: 2, flares: 12 },
    units: [
      { kind: 'bridge', at: 'bridge', obj: true },
      { kind: 'aa', at: 'bridge', off: [-260, 180] },
      { kind: 'aa', at: 'bridge', off: [280, -200] },
      { kind: 'sam', at: 'bridge', off: [1300, -300] },
      { kind: 'tank', at: 'bridge', off: [-120, -320], hdg: 180 },
      { kind: 'tank', at: 'bridge', off: [200, 330], hdg: 0 },
      { kind: 'apc', at: 'bridge', off: [-420, -80], hdg: 90 },
    ],
  },
  {
    name: 'Iron Column', theatre: 1, goal: 'ambush', type: 'CONVOY AMBUSH', text: 'Stop the tanks before they cross the Millrace',
    fail: 'The tanks crossed the Millrace',
    brief: 'Four Combine tanks are rolling south down the valley road from Tarnby for the Millrace crossing, with two AA tracks for cover. Stop all four tanks before they cross. Rounds glance off their armour: use the Thorns, and keep a hill between you and the AA.',
    load: { gun: 600, rkt: 38, atm: 10, aam: 2, flares: 14 },
    units: [
      { kind: 'tank', road: 'valley', s: 12700, dir: -1, to: 8300, n: 4, gap: 55, obj: true },
      { kind: 'aatrack', road: 'valley', s: 12780, dir: -1, to: 8300 },
      { kind: 'aatrack', road: 'valley', s: 12460, dir: -1, to: 8300 },
      { kind: 'apc', road: 'valley', s: 12400, dir: -1, to: 8300 },
      { kind: 'mantis', at: 'tarnby', alt: 80, ai: 'hunt', wave: 1 },
    ],
    waves: [{ after: 'kill', n: 2, delay: 6 }],
  },
  {
    name: 'Beacon Hill', theatre: 1, goal: 'destroy', type: 'SAM HUNT', text: 'Destroy the radar on Beacon Hill and its SAMs',
    brief: 'From the top of Beacon Hill a Combine radar sees the whole vale, and three SAM launchers below it shoot at anything it finds. Destroy the radar and all three launchers. Expect a Stiletto jet once the first one falls.',
    load: { gun: 600, rkt: 38, atm: 8, aam: 4, flares: 16 },
    units: [
      { kind: 'radar', at: 'beacon', obj: true },
      { kind: 'sam', at: 'beacon', off: [-600, 400], obj: true },
      { kind: 'sam', at: 'beacon', off: [500, 600], obj: true },
      { kind: 'sam', at: 'beacon', off: [-300, -700], obj: true },
      { kind: 'aa', at: 'beacon', off: [120, 80] },
      { kind: 'aa', at: 'beacon', off: [-700, 900] },
      { kind: 'mantis', at: 'marrow', off: [400, -400], alt: 70, ai: 'patrol' },
      { kind: 'stiletto', at: [5200, -6200], alt: 500, hdg: 220, ai: 'hunt', wave: 1 },
    ],
    waves: [{ after: 'kill', n: 1, delay: 8 }],
  },
  // ---------- Greyhorn Pass ----------
  {
    name: 'High Shelter', theatre: 2, goal: 'rescue', type: 'RESCUE', text: 'Lift the climbers off the High Shelter', lz: 'shelter', survivors: 3, wait: 14,
    brief: 'Three Guard scouts are pinned down at the High Shelter, a hut on a bench 1,250 m up. The air is thin there: hover power is short, so come in slow and do not overload the rotor. Land, wait for them, and bring them down to Greyford.',
    load: { gun: 600, rkt: 19, atm: 6, aam: 4, flares: 14 },
    units: [
      { kind: 'apc', at: 'shelter', off: [700, 400], hdg: 300 },
      { kind: 'aa', at: 'shelter', off: [1100, -500] },
      { kind: 'apc', at: 'shelter', off: [-600, -700], hdg: 60 },
      { kind: 'mantis', at: 'battery', alt: 80, ai: 'strike', wave: 1 },
      { kind: 'mantis', at: 'gate', alt: 80, ai: 'strike', wave: 1 },
    ],
    waves: [{ after: 'lz', delay: 3 }],
  },
  {
    name: 'Switchbacks', theatre: 2, goal: 'escort', type: 'ESCORT', text: 'Take the supply column up the switchbacks', need: 3,
    brief: 'A Guard column must climb the pass road to the saddle camp before the Combine closes it. Tanks are dug in on the bends and an AA gun watches from above. The trucks halt when they meet trouble: clear each bend, and bring at least three of the four up.',
    load: { gun: 600, rkt: 38, atm: 10, aam: 2, flares: 14 },
    units: [
      { kind: 'ally', road: 'pass', s: 2400, to: 7600, n: 4, gap: 45 },
      { kind: 'tank', road: 'pass', s: 4300, off: [120, 0], hdg: 180 },
      { kind: 'tank', road: 'pass', s: 5600, off: [-130, 0], hdg: 160 },
      { kind: 'apc', road: 'pass', s: 4700, off: [-110, 0], hdg: 200 },
      { kind: 'aa', road: 'pass', s: 6400, off: [260, 0] },
      { kind: 'tank', road: 'pass', s: 7000, off: [150, 0], hdg: 180 },
      { kind: 'mantis', at: 'battery', alt: 80, ai: 'strike', wave: 1 },
    ],
    waves: [{ after: 'pass', s: 4600, delay: 2 }],
  },
  {
    name: 'Cliff Battery', theatre: 2, goal: 'destroy', type: 'STRIKE', text: 'Destroy the three gun bunkers on the cliff',
    brief: 'Three Combine gun bunkers on the cliffs above the road shell everything that moves in the pass. Destroy all three. A SAM pair and its radar cover the battery; come up the gullies, unmask, fire, and drop back.',
    load: { gun: 600, rkt: 38, atm: 10, aam: 2, flares: 16 },
    units: [
      { kind: 'bunker', at: 'battery', off: [-110, -40], obj: true },
      { kind: 'bunker', at: 'battery', off: [100, -60], obj: true },
      { kind: 'bunker', at: 'battery', off: [0, 110], obj: true },
      { kind: 'radar', at: 'battery', off: [-300, -300] },
      { kind: 'sam', at: 'battery', off: [600, -500] },
      { kind: 'sam', at: 'battery', off: [-600, -600] },
      { kind: 'aa', at: 'battery', off: [200, 200] },
      { kind: 'aa', at: 'battery', off: [-250, 150] },
      { kind: 'mantis', at: 'gate', alt: 80, ai: 'hunt', wave: 1 },
    ],
    waves: [{ after: 'kill', n: 1, delay: 4 }],
  },
  {
    name: 'The Gatehouse', theatre: 2, goal: 'destroy', type: 'STRIKE', text: 'Destroy the Combine command post at the Gatehouse',
    brief: 'The Combine runs its war from a command post at the Gatehouse, on the saddle of the pass, behind two bunkers, SAMs and tanks. Destroy the command post and both bunkers and the pass is ours. Mantis gunships and a Stiletto will come for you.',
    load: { gun: 600, rkt: 38, atm: 12, aam: 4, flares: 18 },
    units: [
      { kind: 'command', at: 'gate', hdg: 20, obj: true },
      { kind: 'bunker', at: 'gate', off: [-180, 120], obj: true },
      { kind: 'bunker', at: 'gate', off: [190, 90], obj: true },
      { kind: 'radar', at: 'gate', off: [0, -260] },
      { kind: 'sam', at: 'gate', off: [-800, 500] },
      { kind: 'sam', at: 'gate', off: [700, 700] },
      { kind: 'aa', at: 'gate', off: [-60, 220] },
      { kind: 'aa', at: 'gate', off: [260, -120] },
      { kind: 'tank', at: 'gate', off: [-350, 400], hdg: 170 },
      { kind: 'tank', at: 'gate', off: [300, 450], hdg: 190 },
      { kind: 'mantis', at: 'gate', off: [0, -1500], alt: 90, ai: 'patrol' },
      { kind: 'mantis', at: 'battery', alt: 80, ai: 'hunt', wave: 1 },
      { kind: 'stiletto', at: [-3000, -6200], alt: 1900, hdg: 160, ai: 'hunt', wave: 2 },
    ],
    waves: [{ after: 'kill', n: 2, delay: 8 }, { after: 'kill', n: 5, delay: 10 }],
  },
];

export const RANKS = [
  [0, 'Flight Cadet'], [5000, 'Warrant Officer'], [13000, 'Chief Warrant'], [25000, 'Lieutenant'],
  [42000, 'Captain'], [64000, 'Major'], [90000, 'Colonel'],
];
export const rankOf = score => RANKS.reduce((r, [s, name]) => (score >= s ? name : r), RANKS[0][1]);
