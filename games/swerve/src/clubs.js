// The Halvane League: an invented country's sixteen clubs, two divisions of eight, and every
// player on their books. Pure data and a seeded generator, no DOM: the same squads come out on
// every load, so a career only has to remember who moved where (career.js).
//
//   CLUBS          [{ id, name, short, town, nick, tier 1…5, div 1|2, kit: { home, away }, gk }]
//   PLAYERS        every player, generated once: { id, name, num, pos, club, pace, shooting,
//                  passing, tackling, keeping, star, weak, value }
//   squadOf(id)    a club's own players, as generated
//   clubOf(id)     a club by id
//   rating(p, role) how well a player fills a role ('GK' | 'DF' | 'MF' | 'FW'), 1…9 (decimals)
//   overall(p)     rating in his own position
//
// Tiers set the level: tier 1 clubs are the league's giants, tier 5 its strugglers. Each squad
// has one or two stars well above its level and a weak link or two below it.
export const COUNTRY = 'Halvane';
export const LEAGUE = 'Halvane League';
export const CUP = 'Lantern Cup';
export const DIVISIONS = { 1: 'First Division', 2: 'Second Division' };
export const POSITIONS = ['GK', 'DF', 'MF', 'FW'];
export const SQUAD_MIN = 14;
export const SQUAD_MAX = 22;

const kit = (shirt, shorts, socks, trim, pattern = 'plain') => ({ shirt, shorts, socks, trim, pattern });
const def = (id, name, short, town, nick, tier, home, away) => ({ id, name, short, town, nick, tier, home, away });
// prettier-ignore
const DATA = [
  // the First Division
  def('dunmarrow', 'Dunmarrow City', 'DUN', 'Dunmarrow', 'the Skylarks', 1,
    kit('#7fb8e6', '#ffffff', '#7fb8e6', '#0d2b55'), kit('#8c1d40', '#ffffff', '#8c1d40', '#7fb8e6')),
  def('ostervale', 'Ostervale United', 'OST', 'Ostervale', 'the Reds', 1,
    kit('#c8102e', '#111111', '#c8102e', '#ffffff', 'stripes'), kit('#f4f1ea', '#f4f1ea', '#f4f1ea', '#c8102e')),
  def('copperhall', 'Copperhall Forest', 'COP', 'Copperhall', 'the Foresters', 2,
    kit('#1f7a3a', '#ffffff', '#1f7a3a', '#f2c230', 'hoops'), kit('#f2c230', '#1f7a3a', '#f2c230', '#1f7a3a')),
  def('ironbeck', 'Ironbeck Borough', 'IRO', 'Ironbeck', 'the Ironmen', 2,
    kit('#14284b', '#14284b', '#ffffff', '#ffffff', 'halves'), kit('#f07c1e', '#14284b', '#f07c1e', '#14284b')),
  def('saltmere', 'Saltmere Wanderers', 'SAL', 'Saltmere', 'the Gulls', 2,
    kit('#7a1f3d', '#ffffff', '#7a1f3d', '#8fc7e8', 'sash'), kit('#8fc7e8', '#7a1f3d', '#8fc7e8', '#7a1f3d')),
  def('highcairn', 'Highcairn Victoria', 'HIG', 'Highcairn', 'the Magpies', 3,
    kit('#f4f4f0', '#111111', '#111111', '#111111', 'stripes'), kit('#e8d24a', '#111111', '#e8d24a', '#111111')),
  def('marlhythe', 'Marlhythe Dynamo', 'MAR', 'Marlhythe', 'the Dynamos', 3,
    kit('#1f4fbf', '#ffffff', '#1f4fbf', '#ffffff'), kit('#d22a2a', '#d22a2a', '#ffffff', '#ffffff')),
  def('pellbridge', 'Pellbridge Town', 'PEL', 'Pellbridge', 'the Wasps', 3,
    kit('#f5a623', '#111111', '#f5a623', '#111111', 'hoops'), kit('#f4f1ea', '#111111', '#f4f1ea', '#f5a623')),
  // the Second Division
  def('kettleford', 'Kettleford Athletic', 'KET', 'Kettleford', 'the Kettles', 4,
    kit('#c8102e', '#ffffff', '#c8102e', '#ffffff'), kit('#ffffff', '#c8102e', '#ffffff', '#c8102e')),
  def('corriwick', 'Corriwick Albion', 'COR', 'Corriwick', 'the Albion', 4,
    kit('#2f6fd0', '#ffffff', '#2f6fd0', '#ffffff', 'stripes'), kit('#e03c31', '#e03c31', '#e03c31', '#ffffff')),
  def('fenwold', 'Fenwold Harriers', 'FEN', 'Fenwold', 'the Harriers', 4,
    kit('#8cc63f', '#14284b', '#8cc63f', '#14284b', 'halves'), kit('#14284b', '#14284b', '#8cc63f', '#8cc63f')),
  def('brackenmoor', 'Brackenmoor Rovers', 'BRA', 'Brackenmoor', 'the Ferns', 4,
    kit('#8a5a2b', '#efe3c2', '#8a5a2b', '#efe3c2', 'sash'), kit('#efe3c2', '#8a5a2b', '#efe3c2', '#8a5a2b')),
  def('tamsford', 'Tamsford Rangers', 'TAM', 'Tamsford', 'the Monarchs', 5,
    kit('#5b2a86', '#5b2a86', '#f2c230', '#f2c230'), kit('#f2c230', '#5b2a86', '#f2c230', '#5b2a86')),
  def('westerlow', 'Westerlow County', 'WES', 'Westerlow', 'the Tide', 5,
    kit('#138a8a', '#ffffff', '#138a8a', '#ffffff', 'hoops'), kit('#f05a28', '#ffffff', '#f05a28', '#ffffff')),
  def('glenhallow', 'Glenhallow FC', 'GLE', 'Glenhallow', 'the Ravens', 5,
    kit('#1a1a1a', '#1a1a1a', '#d42a2a', '#d42a2a', 'stripes'), kit('#ffe14d', '#1a1a1a', '#ffe14d', '#1a1a1a')),
  def('lowmarsh', 'Lowmarsh Athletic', 'LOW', 'Lowmarsh', 'the Flamingos', 5,
    kit('#e86aa6', '#1a1a1a', '#e86aa6', '#1a1a1a'), kit('#1a1a1a', '#e86aa6', '#1a1a1a', '#e86aa6')),
];

// ---------- colour: a perceptual distance, for kit clashes ----------
export function hexRgb(hex) {
  const h = String(hex).replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const n = parseInt(f, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function lab(hex) {
  const lin = c => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hexRgb(hex).map(lin);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** CIE76 ΔE between two colours: under ~25 reads as the same colour across a pitch */
export function deltaE(a, b) {
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
const mixHex = (a, b, t) => {
  const p = hexRgb(a), q = hexRgb(b);
  return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
// how much of a shirt the trim covers, by pattern: what the shirt looks like from the stands
const TRIM_SHARE = { plain: 0.08, stripes: 0.45, hoops: 0.45, halves: 0.5, sash: 0.22 };
export const shirtLook = k => mixHex(k.shirt, k.trim ?? k.shirt, TRIM_SHARE[k.pattern] ?? 0.1);

// keepers' shirts: each club's is the one that stands out most from both its kits
export const GK_COLOURS = ['#2a9d3f', '#f2d12e', '#7a3fb0', '#ff8c1a', '#16a0c8', '#222222', '#9aa0a6', '#e5e5e5'];
function keeperFor(colours) {
  let best = GK_COLOURS[0], bd = -1;
  for (const c of GK_COLOURS) {
    const d = Math.min(...colours.map(x => deltaE(c, x)));
    if (d > bd) { bd = d; best = c; }
  }
  return best;
}
const gkKit = shirt => ({ shirt, shorts: deltaE(shirt, '#111111') > 40 ? '#111111' : '#f4f4f4', socks: shirt });

export const CLUBS = DATA.map(({ id, name, short, town, nick, tier, home, away }, i) => ({
  id, name, short, town, nick, tier, div: i < 8 ? 1 : 2,
  kit: { home, away },
  gk: gkKit(keeperFor([shirtLook(home), shirtLook(away), home.shorts])),
}));
const BY_ID = new Map(CLUBS.map(c => [c.id, c]));
export const clubOf = id => BY_ID.get(id) ?? null;

// ---------- seeded chance ----------
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hashStr = s => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------- names ----------
// prettier-ignore
const START = ['Ab', 'Al', 'Ash', 'Bal', 'Bar', 'Bel', 'Bran', 'Brom', 'Cal', 'Car', 'Cor', 'Dal', 'Dar', 'Del', 'Dun', 'El',
  'Fal', 'Fen', 'Gal', 'Gar', 'Gor', 'Hal', 'Har', 'Hol', 'Ing', 'Jas', 'Kal', 'Kel', 'Kes', 'Lan', 'Lin', 'Lor', 'Mal',
  'Mar', 'Mor', 'Nal', 'Ned', 'Nor', 'Ok', 'Ol', 'Os', 'Pal', 'Pel', 'Quil', 'Ral', 'Ren', 'Ros', 'Sal', 'Sel', 'Sor',
  'Tal', 'Tam', 'Tor', 'Ul', 'Val', 'Ven', 'Vor', 'Wal', 'Wen', 'Yar', 'Zel', 'Ty', 'Mo', 'Sa', 'Ka', 'Le', 'Ri', 'Du',
  'Bo', 'Fa', 'Ade', 'Bru', 'Cas', 'Dov', 'Esk', 'Gro', 'Hen', 'Ivo', 'Jor', 'Kov', 'Lud', 'Mik', 'Nyl', 'Ost', 'Pry'];
const MID = ['a', 'e', 'i', 'o', 'an', 'er', 'in', 'or', 'el', 'ar', 'u', 'en'];
// prettier-ignore
const END = ['ley', 'ton', 'by', 'son', 'sen', 'ard', 'ick', 'ock', 'ford', 'wood', 'well', 'more', 'man', 'ner', 'ow',
  'en', 'is', 'os', 'ez', 'ini', 'ano', 'ovic', 'ak', 'as', 'ei', 'ani', 'ola', 'ssen', 'dal', 'strom', 'berg', 'ke',
  'ka', 'eda', 'ou', 'ette', 'ade', 'emi', 'ura', 'oye', 'ham', 'stead', 'ling', 'ister', 'ach', 'unde', 'aro', 'ic'];
const BAD = ['ass', 'fuk', 'fag', 'shit', 'cum', 'dick', 'tit', 'nig', 'cock', 'porn', 'rap', 'wank', 'sex', 'piss', 'anal', 'poo', 'fart', 'hell', 'damn', 'kill', 'nazi', 'sod', 'bum', 'cun', 'twat', 'slut', 'hor', 'kok', 'puta', 'arse'];
const cap = s => s[0].toUpperCase() + s.slice(1);
function surname(R, used) {
  for (let k = 0; k < 200; k++) {
    const pick = a => a[Math.floor(R() * a.length)];
    let s = pick(START) + (R() < 0.35 ? pick(MID) : '') + pick(END);
    s = cap(s.toLowerCase().replace(/(.)\1\1+/g, '$1$1'));
    const low = s.toLowerCase();
    // no tongue-twisters: three vowels running, a doubled a/i/u, or a stammered syllable
    if (s.length < 4 || s.length > 10 || /[aeiou]{3}|aa|ii|uu|(\w\w)\1/.test(low) || used.has(s) || BAD.some(b => low.includes(b))) continue;
    used.add(s);
    return s;
  }
  return 'Doe' + used.size;
}

// ---------- ratings ----------
export const ATTRS = ['pace', 'shooting', 'passing', 'tackling', 'keeping'];
const BASE = { 1: 6.3, 2: 5.7, 3: 5.1, 4: 4.5, 5: 4.0 };
// what a position leans on: + above the club's level, − below it
const LEAN = {
  GK: { keeping: 1.6, pace: -1.2, shooting: -3, passing: -1.2, tackling: -2.5 },
  DF: { tackling: 1.4, pace: 0.2, passing: -0.4, shooting: -1.6, keeping: -4 },
  MF: { passing: 1.4, pace: 0.2, tackling: -0.2, shooting: -0.2, keeping: -4 },
  FW: { shooting: 1.5, pace: 0.9, passing: -0.3, tackling: -2, keeping: -4 },
};
const W = {
  GK: { keeping: 0.8, pace: 0.1, passing: 0.1 },
  DF: { tackling: 0.45, pace: 0.25, passing: 0.2, shooting: 0.1 },
  MF: { passing: 0.4, pace: 0.2, tackling: 0.2, shooting: 0.2 },
  FW: { shooting: 0.45, pace: 0.35, passing: 0.2 },
};
/** how well p fills a role, 1…9: a keeper in the outfield (or the reverse) is hopeless */
export function rating(p, role = p.pos) {
  let r = 0;
  for (const [k, w] of Object.entries(W[role] ?? W.MF)) r += (p[k] ?? 1) * w;
  if (role !== p.pos) r *= role === 'GK' || p.pos === 'GK' ? 0.35 : 0.82;
  return r;
}
export const overall = p => rating(p, p.pos);
const clampR = v => Math.max(1, Math.min(9, Math.round(v)));
/** transfer value, rounded to 5K: about 60K for a 3, 190K for a 5, 600K for a 7, 1.8M for a 9 */
export function valueOf(p, salt = 0) {
  const v = 20000 * 1.76 ** (overall(p) - 1) * (0.88 + 0.24 * ((hashStr(p.id) + salt) % 100) / 100);
  return Math.max(10000, Math.round(v / 5000) * 5000);
}

// the line-up of a generated squad: 2–3 keepers, 6 defenders, 6 midfielders, 4 forwards
const SHAPE = R => [['GK', R() < 0.4 ? 3 : 2], ['DF', 6], ['MF', R() < 0.5 ? 6 : 7], ['FW', R() < 0.5 ? 4 : 3]];
function makePlayers() {
  const used = new Set(), out = [];
  for (const c of CLUBS) {
    const R = rng(hashStr('swerve:' + c.id));
    const list = [];
    for (const [pos, n] of SHAPE(R)) for (let k = 0; k < n; k++) list.push({ pos, first: k < (pos === 'GK' ? 1 : pos === 'DF' ? 4 : pos === 'MF' ? 4 : 2) });
    // a star or two, a weak link or two, never the same man
    const idx = list.map((_, i) => i).filter(i => list[i].first);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    shuffle(idx);
    const nStar = R() < 0.5 ? 1 : 2, nWeak = R() < 0.5 ? 1 : 2;
    idx.slice(0, nStar).forEach(i => (list[i].star = true));
    idx.slice(nStar, nStar + nWeak).forEach(i => (list[i].weak = true));
    const nums = new Set(), firstNums = { GK: [1], DF: [2, 3, 5, 6], MF: [4, 7, 8, 11], FW: [9, 10] };
    list.forEach((s, i) => {
      const base = BASE[c.tier] + (s.first ? 0.3 : -0.5) + (s.star ? 1.7 : 0) - (s.weak ? 1.6 : 0);
      const p = { id: `${c.id}-${i}`, name: surname(R, used), num: 0, pos: s.pos, club: c.id };
      for (const a of ATTRS) p[a] = clampR(base + (LEAN[s.pos][a] ?? 0) + (R() - 0.5) * 2.2);
      if (s.pos !== 'GK') p.keeping = Math.min(p.keeping, 2);
      if (s.star) p.star = true;
      if (s.weak) p.weak = true;
      // the first choices wear 1–11, the rest the higher numbers
      let n = s.first ? (firstNums[s.pos].shift() ?? 0) : 0;
      if (!n) { n = 12; while (nums.has(n)) n++; }
      nums.add(n);
      p.num = n;
      p.value = valueOf(p);
      list[i] = p;
    });
    out.push(...list);
  }
  return out;
}
export const PLAYERS = makePlayers();
const P_BY_ID = new Map(PLAYERS.map(p => [p.id, p]));
export const playerOf = id => P_BY_ID.get(id) ?? null;
const SQUADS = new Map(CLUBS.map(c => [c.id, PLAYERS.filter(p => p.club === c.id)]));
export const squadOf = id => SQUADS.get(id) ?? [];
