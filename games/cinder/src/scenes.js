// The climb through the Cinder Keep: seven scenes, walked left to right. A foe waits off to the
// right at `x` and sets out when Wren passes `at`; `x` sits 9 m past `at`, beyond the edge of
// the view, so a foe that hasn't set out is never on screen. Foes come one at a time and rise
// in skill. A gate is a drop gate's centre; the archer stands on the wall walk at `x` and looses
// about every `every` seconds while no foe is out. tools/verify.mjs checks that no foe has a
// gate between it and where it meets Wren, and that every scene is won by the strong pilot.
export const SCENES = [
  {
    id: 'path', name: 'The Switchback Path', theme: 'dusk', w: 52,
    foes: [{ kind: 'footman', at: 12, x: 21 }, { kind: 'footman', at: 32, x: 41 }],
    gates: [], archer: null,
  },
  {
    id: 'gate', name: 'The Ash Gate', theme: 'gate', w: 46,
    foes: [{ kind: 'footman', at: 8, x: 17 }, { kind: 'brawler', at: 28, x: 37 }],
    gates: [], archer: null,
  },
  {
    id: 'court', name: 'The Lantern Court', theme: 'court', w: 60,
    foes: [{ kind: 'brawler', at: 8, x: 17 }],
    gates: [], archer: { x: 56, every: 2.6 },
  },
  {
    id: 'hall', name: 'The Hall of Drops', theme: 'hall', w: 56,
    foes: [{ kind: 'footman', at: 3, x: 12 }, { kind: 'adept', at: 38, x: 47 }],
    gates: [18, 24.5, 31],
    archer: null,
  },
  {
    id: 'stair', name: 'The Bell Stair', theme: 'stair', w: 48,
    foes: [{ kind: 'brawler', at: 8, x: 17 }, { kind: 'adept', at: 28, x: 37 }],
    gates: [], archer: null,
  },
  {
    id: 'throne', name: "The Regent's Hall", theme: 'throne', w: 32,
    foes: [{ kind: 'regent', at: 7, x: 16 }],
    gates: [], archer: null,
  },
  {
    id: 'garden', name: 'The Dawn Garden', theme: 'garden', w: 34,
    foes: [], gates: [], archer: null, teacher: { x: 27 },
  },
];
