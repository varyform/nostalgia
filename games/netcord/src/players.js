// Netcord's world: the Meridian Tour's 32 players, the invented nations they play for, and the
// eight tournaments of a season with their courts. Everything here is invented: no real player,
// tournament, place or brand. Pure data and small helpers, no DOM.
//
//   PLAYERS[k]   { id, name, short, country, hand, height, ratings, style, kit, skin, hair, rank }
//                ratings { speed, power, accuracy, spin, serve, volley, stamina } 1..9; rank the
//                ranking the tour begins with (1 = the best)
//   NATIONS[c]   { name, flag: [three colours, top to bottom], mark: the hoist triangle's colour }
//   VENUES[k]    { id, name, short, city, country, surface, tier: 'crown' | 'open', draw: 16 | 32,
//                  sets (best of, for the matches simulated), points[], prize[] (by the round reached:
//                  0 = lost the first match … rounds = won it), colours, roof, night, crown? }

export const RATINGS = ['speed', 'power', 'accuracy', 'spin', 'serve', 'volley', 'stamina'];
export const RATING_LABEL = { speed: 'SPEED', power: 'POWER', accuracy: 'ACCURACY', spin: 'SPIN', serve: 'SERVE', volley: 'VOLLEY', stamina: 'STAMINA' };
export const STYLES = ['baseline', 'serve-volley', 'all-round', 'counter'];
export const STYLE_LABEL = { baseline: 'Baseliner', 'serve-volley': 'Serve & volley', 'all-round': 'All-rounder', counter: 'Counter-puncher' };
export const SURFACES = ['hard', 'clay', 'grass', 'indoor'];
export const SURFACE_LABEL = { hard: 'Hard', clay: 'Clay', grass: 'Grass', indoor: 'Indoor carpet' };
export const TOUR = 'Meridian Tour';
export const CROWNS = 'the Four Crowns';

// flags: three bars and a hoist triangle in a fourth colour (no real nation's flag)
export const NATIONS = {
  ALM: { name: 'Almora', flag: ['#5a33a0', '#f4f1e8', '#e2722b'], mark: '#0f7c8c' },
  BRV: { name: 'Brevant', flag: ['#1d3f8f', '#f2c230', '#1d3f8f'], mark: '#c8102e' },
  CAL: { name: 'Caldessa', flag: ['#e2722b', '#2e8b57', '#e2722b'], mark: '#f4f1e8' },
  DUV: { name: 'Duvessa', flag: ['#6a2c91', '#f4f1e8', '#6a2c91'], mark: '#e4b62a' },
  EST: { name: 'Estmark', flag: ['#f4f1e8', '#2f6fb5', '#f4f1e8'], mark: '#c8102e' },
  FEN: { name: 'Fenmoor', flag: ['#1f6b3a', '#141414', '#d9b23a'], mark: '#f4f1e8' },
  GAL: { name: 'Galvaro', flag: ['#f2c230', '#b3132b', '#f2c230'], mark: '#1d3f8f' },
  HAL: { name: 'Halcyra', flag: ['#0f7c8c', '#f4f1e8', '#0f2f5c'], mark: '#e4f33a' },
  JOR: { name: 'Jorvald', flag: ['#18325e', '#c8102e', '#f4f1e8'], mark: '#e4b62a' },
  KES: { name: 'Kesmira', flag: ['#1f6b3a', '#f2c230', '#1f6b3a'], mark: '#c8102e' },
  LUN: { name: 'Lunaria', flag: ['#2b2f6e', '#cfd8e6', '#2b2f6e'], mark: '#e4b62a' },
  MAR: { name: 'Marovia', flag: ['#7a1a2a', '#e8b830', '#7a1a2a'], mark: '#f4f1e8' },
  PEL: { name: 'Pelluca', flag: ['#2e8b57', '#f4f1e8', '#e2722b'], mark: '#2b2f6e' },
  ROV: { name: 'Rovenna', flag: ['#141414', '#e8b830', '#2f6fb5'], mark: '#f4f1e8' },
  TAM: { name: 'Tamberg', flag: ['#c8102e', '#141414', '#f4f1e8'], mark: '#2e8b57' },
};
export const NATION_CODES = Object.keys(NATIONS);

const SKIN = ['#f1c9a5', '#e0ac85', '#c98e62', '#a96f47', '#7c4f31', '#5a3822'];
const HAIR = ['#1b1410', '#3a2618', '#6b4426', '#a8743a', '#d8b26a', '#8a8a8a'];

// [first, last, nation, hand, height, style, speed, power, accuracy, spin, serve, volley, stamina, shirt, shorts, band, skin, hair]
const ROSTER = [
  ['Aurel', 'Danvik', 'GAL', 'R', 1.88, 'all-round', 8, 8, 8, 8, 8, 7, 8, '#f4f1e8', '#1b2a4a', '#c8102e', 2, 1],
  ['Mathis', 'Korrel', 'JOR', 'R', 1.94, 'serve-volley', 6, 9, 7, 6, 9, 9, 6, '#18325e', '#f4f1e8', '#f4f1e8', 0, 3],
  ['Emeric', 'Sauvalle', 'BRV', 'L', 1.82, 'baseline', 8, 7, 8, 9, 6, 5, 9, '#f2c230', '#1d3f8f', '#1d3f8f', 1, 0],
  ['Ilan', 'Veskari', 'KES', 'R', 1.85, 'counter', 9, 6, 8, 7, 6, 6, 9, '#1f6b3a', '#f4f1e8', '#f2c230', 3, 0],
  ['Jonah', 'Brannock', 'HAL', 'R', 1.91, 'all-round', 7, 8, 7, 7, 8, 7, 7, '#0f7c8c', '#f4f1e8', '#0f2f5c', 0, 4],
  ['Pavo', 'Lindqvar', 'EST', 'R', 1.86, 'baseline', 7, 8, 7, 8, 7, 5, 8, '#2f6fb5', '#f4f1e8', '#f4f1e8', 0, 4],
  ['Casimir', 'Quillon', 'BRV', 'L', 1.79, 'counter', 9, 6, 7, 8, 6, 6, 8, '#f4f1e8', '#f4f1e8', '#1d3f8f', 1, 2],
  ['Tiago', 'Marchetty', 'CAL', 'R', 1.89, 'baseline', 7, 8, 8, 8, 7, 5, 7, '#e2722b', '#141414', '#f4f1e8', 2, 0],
  ['Oskar', 'Halvorne', 'JOR', 'R', 1.96, 'serve-volley', 5, 9, 6, 6, 9, 8, 6, '#c8102e', '#f4f1e8', '#18325e', 0, 4],
  ['Rune', 'Ostrander', 'EST', 'L', 1.84, 'all-round', 7, 7, 7, 7, 7, 7, 7, '#f4f1e8', '#2f6fb5', '#2f6fb5', 0, 3],
  ['Dario', 'Pellacci', 'PEL', 'R', 1.8, 'baseline', 8, 6, 7, 8, 6, 5, 8, '#2e8b57', '#f4f1e8', '#e2722b', 2, 0],
  ['Lev', 'Teverell', 'MAR', 'R', 1.87, 'all-round', 7, 7, 7, 6, 7, 7, 7, '#7a1a2a', '#f4f1e8', '#f4f1e8', 1, 1],
  ['Anselm', 'Grieve', 'HAL', 'R', 1.9, 'serve-volley', 6, 8, 6, 6, 8, 8, 6, '#0f2f5c', '#0f2f5c', '#f4f1e8', 0, 2],
  ['Bastien', 'Lorquet', 'BRV', 'R', 1.81, 'counter', 8, 6, 7, 7, 6, 6, 8, '#1d3f8f', '#f4f1e8', '#f2c230', 1, 1],
  ['Nico', 'Rovane', 'ROV', 'L', 1.85, 'baseline', 7, 7, 7, 8, 6, 5, 7, '#141414', '#141414', '#e8b830', 2, 0],
  ['Silas', 'Okoro', 'LUN', 'R', 1.92, 'all-round', 7, 8, 6, 6, 8, 6, 7, '#cfd8e6', '#2b2f6e', '#2b2f6e', 5, 0],
  ['Falk', 'Messeling', 'TAM', 'R', 1.89, 'baseline', 6, 8, 7, 7, 7, 5, 7, '#c8102e', '#141414', '#f4f1e8', 0, 2],
  ['Hugo', 'Castenade', 'CAL', 'R', 1.78, 'counter', 8, 5, 7, 7, 5, 6, 8, '#f4f1e8', '#2e8b57', '#e2722b', 2, 1],
  ['Yannick', 'Dorval', 'DUV', 'R', 1.88, 'serve-volley', 6, 7, 6, 6, 8, 8, 6, '#6a2c91', '#f4f1e8', '#f4f1e8', 4, 0],
  ['Ivo', 'Strand', 'EST', 'R', 1.93, 'baseline', 6, 8, 6, 7, 7, 4, 7, '#f4f1e8', '#141414', '#2f6fb5', 0, 4],
  ['Mateo', 'Ferrandis', 'PEL', 'R', 1.83, 'baseline', 7, 6, 7, 7, 6, 5, 7, '#e2722b', '#f4f1e8', '#2e8b57', 3, 0],
  ['Quentin', 'Haverly', 'HAL', 'L', 1.86, 'all-round', 7, 6, 6, 7, 7, 6, 6, '#f4f1e8', '#0f7c8c', '#0f7c8c', 0, 1],
  ['Elias', 'Mondragh', 'FEN', 'R', 1.9, 'all-round', 6, 7, 6, 6, 7, 6, 6, '#1f6b3a', '#d9b23a', '#141414', 1, 0],
  ['Tobiah', 'Krell', 'JOR', 'R', 1.95, 'serve-volley', 5, 8, 5, 5, 8, 7, 5, '#f4f1e8', '#c8102e', '#c8102e', 0, 3],
  ['Marek', 'Zolani', 'MAR', 'R', 1.84, 'counter', 7, 5, 7, 6, 5, 5, 7, '#f4f1e8', '#7a1a2a', '#7a1a2a', 2, 0],
  ['Remy', 'Vantongre', 'DUV', 'R', 1.8, 'baseline', 7, 5, 6, 7, 5, 5, 7, '#f4f1e8', '#6a2c91', '#6a2c91', 3, 1],
  ['Callum', 'Brisk', 'FEN', 'L', 1.87, 'serve-volley', 6, 7, 5, 5, 7, 7, 5, '#d9b23a', '#141414', '#1f6b3a', 0, 4],
  ['Joaquin', 'Seravale', 'GAL', 'R', 1.82, 'baseline', 6, 6, 6, 7, 5, 4, 7, '#b3132b', '#f4f1e8', '#f2c230', 2, 0],
  ['Bram', 'Hollister', 'TAM', 'R', 1.91, 'all-round', 5, 7, 6, 5, 7, 6, 6, '#141414', '#f4f1e8', '#c8102e', 0, 2],
  ['Taavi', 'Kalmer', 'KES', 'R', 1.85, 'counter', 7, 5, 6, 6, 5, 5, 6, '#f2c230', '#1f6b3a', '#1f6b3a', 1, 3],
  ['Ludo', 'Ferrante', 'CAL', 'L', 1.79, 'baseline', 6, 5, 6, 6, 5, 4, 6, '#2e8b57', '#2e8b57', '#f4f1e8', 2, 1],
  ['Wendel', 'Asheby', 'LUN', 'R', 1.88, 'all-round', 5, 6, 5, 5, 6, 5, 6, '#2b2f6e', '#cfd8e6', '#cfd8e6', 4, 0],
];

export const PLAYERS = ROSTER.map((r, k) => {
  const [first, last, country, hand, height, style] = r;
  const ratings = Object.fromEntries(RATINGS.map((a, i) => [a, r[6 + i]]));
  return Object.freeze({
    id: last.toLowerCase(),
    name: `${first} ${last}`,
    first,
    short: last.toUpperCase(),
    country,
    hand: hand === 'L' ? 'left' : 'right',
    height,
    ratings: Object.freeze(ratings),
    style,
    kit: Object.freeze({ shirt: r[13], shorts: r[14], band: r[15] }),
    skin: SKIN[r[16]],
    hair: HAIR[r[17]],
    rank: k + 1,
  });
});
const BY_ID = new Map(PLAYERS.map(p => [p.id, p]));
export const playerById = id => BY_ID.get(id) ?? null;
/** a player's overall level, 1..9 */
export const overall = p => RATINGS.reduce((s, a) => s + (p?.ratings?.[a] ?? 1), 0) / RATINGS.length;

// what reaching each round earns: index 0 = lost the first match … the last = won the event
const POINTS = { crown: [45, 180, 360, 720, 1200, 2000], open: [20, 90, 180, 300, 500] };
const PRIZE = { crown: [35000, 70000, 140000, 300000, 750000, 1500000], open: [8000, 16000, 32000, 70000, 140000] };

function venue(id, name, short, city, country, surface, tier, colours, { roof = false, night = false, crown = null } = {}) {
  const draw = tier === 'crown' ? 32 : 16;
  return Object.freeze({
    id, name, short, city, country, surface, tier, draw, sets: tier === 'crown' ? 5 : 3,
    points: POINTS[tier], prize: PRIZE[tier],
    colours: Object.freeze(colours), roof, night, crown,
  });
}
// the season, in calendar order; the four crowns are the big ones, one on each surface
export const VENUES = [
  venue('kestrel', 'Kestrel Open', 'KESTREL', 'Port Kestrel', 'HAL', 'hard', 'open',
    { court: '#2c5f9e', surround: '#3d7a4f', line: '#f4f6f2', boards: '#0f2f5c', accent: '#f2c230', seats: '#20466e' }),
  venue('coralbay', 'Coralbay Championships', 'CORALBAY', 'Coralbay', 'CAL', 'hard', 'crown',
    { court: '#1f6fb2', surround: '#2a8a7a', line: '#f4f6f2', boards: '#13224a', accent: '#ff8a5c', seats: '#1d3b66' },
    { night: true, crown: 'The Coral Crown' }),
  venue('velmont', 'Velmont Indoor', 'VELMONT', 'Velmont', 'TAM', 'indoor', 'open',
    { court: '#5b3a7a', surround: '#2b2440', line: '#f1eef6', boards: '#16121f', accent: '#c8102e', seats: '#3a2f52' },
    { roof: true, night: true }),
  venue('sablecoast', 'Sable Coast Open', 'SABLE COAST', 'Sablemar', 'PEL', 'clay', 'open',
    { court: '#c0623a', surround: '#a8532f', line: '#f6efe6', boards: '#2e8b57', accent: '#f4f1e8', seats: '#6d3a24' }),
  venue('rocheval', 'Rocheval Championships', 'ROCHEVAL', 'Rocheval', 'BRV', 'clay', 'crown',
    { court: '#b9572e', surround: '#a24a26', line: '#f6efe6', boards: '#1f5a3a', accent: '#f2c230', seats: '#5c2f1c' },
    { crown: 'The Clay Crown' }),
  venue('ashgrove', 'Ashgrove Lawn Classic', 'ASHGROVE', 'Ashgrove', 'FEN', 'grass', 'open',
    { court: '#5a9a42', surround: '#4b8737', line: '#f8f8f2', boards: '#1f3d2a', accent: '#d9b23a', seats: '#2c4a32' }),
  venue('larkmead', 'Larkmead Championships', 'LARKMEAD', 'Larkmead', 'HAL', 'grass', 'crown',
    { court: '#4f8f3a', surround: '#3f7a2f', line: '#f8f8f2', boards: '#2c1f5e', accent: '#e4f33a', seats: '#2b2752' },
    { crown: 'The Lawn Crown' }),
  venue('northlight', 'Northlight Finals', 'NORTHLIGHT', 'Northlight', 'EST', 'indoor', 'crown',
    { court: '#1e3a5f', surround: '#14233a', line: '#eef3f8', boards: '#0b1424', accent: '#7fd3ff', seats: '#1b2a44' },
    { roof: true, night: true, crown: 'The Night Crown' }),
];
const VENUE_BY_ID = new Map(VENUES.map(v => [v.id, v]));
export const venueById = id => VENUE_BY_ID.get(id) ?? VENUES[0];
export const CROWN_IDS = VENUES.filter(v => v.tier === 'crown').map(v => v.id);
/** what the renderer reads as app.venue */
export const venueLook = v => ({ id: v.id, name: v.name, short: v.short, surface: v.surface, colours: v.colours, roof: v.roof, night: v.night });

// the colours a created player can wear
export const KITS = [
  { shirt: '#f4f1e8', shorts: '#f4f1e8', band: '#e4f33a' },
  { shirt: '#3b1f6b', shorts: '#f4f1e8', band: '#e4f33a' },
  { shirt: '#0b5d3b', shorts: '#f4f1e8', band: '#f4f1e8' },
  { shirt: '#e4f33a', shorts: '#141414', band: '#141414' },
  { shirt: '#c8102e', shorts: '#f4f1e8', band: '#f4f1e8' },
  { shirt: '#1d3f8f', shorts: '#1d3f8f', band: '#f2c230' },
  { shirt: '#141414', shorts: '#141414', band: '#ff8a5c' },
  { shirt: '#0f7c8c', shorts: '#f4f1e8', band: '#0f2f5c' },
];
export { SKIN, HAIR };
