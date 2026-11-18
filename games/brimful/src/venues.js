// The four venues and the difficulty of each screen. Pure data, shared by the simulation and
// both renderers (which pick their own art per venue id).
//
// Counters run from the dispenser (x = 0, Pip's end) to the door (x = len). Lengths differ
// per counter so the doors stagger, and differ per venue.

export const VENUES = [
  {
    id: 'pier', name: 'Pier Parlour', drink: 'Strawberry shake', show: 'band', showName: 'The Pier Brass Band',
    blurb: 'Sunset on the boardwalk', lens: [16, 18, 20, 18], screens: 3,
  },
  {
    id: 'lodge', name: 'Snowcap Lodge', drink: 'Hot cocoa', show: 'juggler', showName: 'Snowball Juggler',
    blurb: 'Fireside after the slopes', lens: [19, 17, 19, 17], screens: 3,
  },
  {
    id: 'market', name: 'Lantern Market', drink: 'Bubble tea', show: 'dragon', showName: 'The Paper Dragon',
    blurb: 'Midnight among the stalls', lens: [20, 18, 16, 18], screens: 3,
  },
  {
    id: 'moon', name: 'Crater Café', drink: 'Orbit float', show: 'rover', showName: 'The Dancing Rover',
    blurb: 'Earthrise over the dome', lens: [17, 20, 17, 20], screens: 3,
  },
];

// Difficulty of one screen. `d` climbs by one per screen across the tour; every loop of the
// tour adds four more, so the second time round starts where the first tour's third venue was.
export function screenParams(venue, screen, loop = 0) {
  const d = venue * 3 + screen + loop * 4;
  return {
    d,
    quota: Math.min(10 + Math.round(d * 1.6), 34), // customers to serve on this screen
    maxPer: Math.min(2 + Math.floor(d / 3), 4), // at most this many at one counter
    spawn: 1.6 + 1.8 * 0.9 ** d, // seconds between arrivals, on average
    walk: 0.8 + 0.65 * (1 - 0.88 ** d), // walking speed, counter units / s
    push: 4.4 + 3.1 * 0.9 ** d, // how far a caught glass pushes a customer back
    drink: Math.max(0.8, 1.5 - d * 0.05), // seconds spent drinking
    empty: Math.min(6, 3.4 + d * 0.15), // speed of an empty sliding back
    tip: 0.22, // chance an empty comes back with a tip
    start: Math.min(1 + Math.floor(d / 5), 2), // customers already waiting at each counter
  };
}

// The Order Up! bonus round: sequence lengths per round, and how fast it is shown.
export function bonusParams(loop = 0) {
  return { rounds: [3, 4, 5, 6], on: Math.max(0.26, 0.42 - loop * 0.05), gap: 0.14, wait: 4 };
}
