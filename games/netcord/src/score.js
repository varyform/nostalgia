// Netcord's scoreboard: tennis scoring as plain data and pure functions, no DOM, no randomness.
// Points 0, 15, 30, 40, deuce and advantage; games to six by two with a tiebreak at 6–6 (first to
// seven by two); best of 1, 3 or 5 sets. The server changes every game; in a tiebreak the player
// whose turn it is serves the first point, then each serves two in turn, and the other serves the
// next set's first game (the tiebreak counts as a game served by whoever began it). Ends change
// after the odd games of a set (a set that ends on an odd game total too), and in a tiebreak
// after every six points. Points are served from the deuce court when the game's (or tiebreak's)
// points played so far are even, else from the ad court.
//
//   const sc = createScore({ sets: 3, server: 0, names: ['DANVIK', 'KORREL'] });
//   const r = pointWon(sc, winner);   // → { game, set, match /* the winner or −1 */, change: bool }
//   sc.label                          // '15–30' (the server's points first), 'DEUCE', 'ADV KORREL', 'TIEBREAK 4–3'

const CALL = ['0', '15', '30', '40'];

export function createScore({ sets = 3, server = 0, names = ['P1', 'P2'] } = {}) {
  const best = sets === 5 ? 5 : sets === 1 ? 1 : 3;
  const sc = {
    points: [0, 0], games: [0, 0], sets: [], tiebreak: false, label: '', serveNo: 1,
    // additive: best of, sets won, who serves this point and who served this game, who began the
    // tiebreak, each finished set's tiebreak (the loser's points) or null, the end of it all
    best, need: (best + 1) / 2, won: [0, 0], server, gameServer: server, tbFirst: -1, tbs: [], done: false, winner: -1,
    names: names.slice(0, 2),
  };
  sc.label = label(sc);
  return sc;
}

/** points played in this game (or tiebreak) so far */
export const played = sc => sc.points[0] + sc.points[1];
/** the court the next point is served from: 'deuce' or 'ad' */
export const court = sc => (played(sc) % 2 === 0 ? 'deuce' : 'ad');

/** who serves point n (0-based) of a tiebreak that `first` began */
export function tiebreakServer(first, n) {
  if (n === 0) return first;
  return ((n - 1) >> 1) % 2 === 0 ? 1 - first : first;
}

export function label(sc) {
  if (sc.done) return 'MATCH';
  const a = sc.server, b = 1 - a, pa = sc.points[a], pb = sc.points[b];
  if (sc.tiebreak) return `TIEBREAK ${pa}–${pb}`;
  if (pa >= 3 && pb >= 3) {
    if (pa === pb) return 'DEUCE';
    return `ADV ${sc.names[pa > pb ? a : b]}`;
  }
  return `${CALL[Math.min(pa, 3)]}–${CALL[Math.min(pb, 3)]}`;
}

/** the point `w` (0 | 1) won: moves the score on, returns what it finished */
export function pointWon(sc, w) {
  const r = { game: -1, set: -1, match: -1, change: false };
  if (sc.done) return r;
  const l = 1 - w;
  sc.points[w]++;
  sc.serveNo = 1;
  if (sc.tiebreak) {
    const pw = sc.points[w], pl = sc.points[l];
    if (pw >= 7 && pw - pl >= 2) {
      sc.games[w]++;
      sc.tbs.push(pl);
      r.game = w;
      endSet(sc, w, r);
      r.change = true; // 7–6 is an odd total: always a change
    } else {
      if ((pw + pl) % 6 === 0) r.change = true;
      sc.server = tiebreakServer(sc.tbFirst, pw + pl);
    }
  } else {
    const pw = sc.points[w], pl = sc.points[l];
    if (pw >= 4 && pw - pl >= 2) {
      sc.games[w]++;
      r.game = w;
      const gw = sc.games[w], gl = sc.games[l];
      if ((gw >= 6 && gw - gl >= 2) || gw === 7) {
        sc.tbs.push(null);
        endSet(sc, w, r);
        if ((gw + gl) % 2 === 1) r.change = true;
      } else {
        sc.points[0] = sc.points[1] = 0;
        if ((gw + gl) % 2 === 1) r.change = true;
        nextGame(sc);
        if (sc.games[0] === 6 && sc.games[1] === 6) {
          sc.tiebreak = true;
          sc.tbFirst = sc.gameServer;
          sc.server = sc.gameServer;
        }
      }
    }
  }
  sc.label = label(sc);
  return r;
}

function nextGame(sc) {
  sc.gameServer = 1 - sc.gameServer;
  sc.server = sc.gameServer;
}

function endSet(sc, w, r) {
  sc.sets.push([sc.games[0], sc.games[1]]);
  sc.won[w]++;
  r.set = w;
  sc.points[0] = sc.points[1] = 0;
  sc.games[0] = sc.games[1] = 0;
  sc.tiebreak = false;
  sc.tbFirst = -1;
  if (sc.won[w] >= sc.need) {
    sc.done = true;
    sc.winner = w;
    r.match = w;
    return;
  }
  nextGame(sc);
}

/** would the point decide a game, set or match for `w`? → 0 none, 1 game, 2 set, 3 match */
export function stakes(sc, w) {
  if (sc.done) return 0;
  const l = 1 - w, pw = sc.points[w] + 1, pl = sc.points[l];
  let game;
  if (sc.tiebreak) game = pw >= 7 && pw - pl >= 2;
  else game = pw >= 4 && pw - pl >= 2;
  if (!game) return 0;
  const gw = sc.games[w] + 1, gl = sc.games[l];
  const set = sc.tiebreak || (gw >= 6 && gw - gl >= 2) || gw === 7;
  if (!set) return 1;
  return sc.won[w] + 1 >= sc.need ? 3 : 2;
}

/** how much rides on the next point, 0..1: deuce, break, set and match points weigh most */
export function pressure(sc) {
  const a = stakes(sc, 0), b = stakes(sc, 1);
  const top = Math.max(a, b);
  let p = top === 3 ? 1 : top === 2 ? 0.8 : top === 1 ? 0.4 : 0.1;
  if (top === 1 && stakes(sc, 1 - sc.server) === 1) p = 0.6; // a break point
  if (sc.tiebreak) p = Math.max(p, 0.5);
  return p;
}

/** every set as [g0, g1] so far, the one being played included when it has begun */
export function setScores(sc) {
  const out = sc.sets.map(s => s.slice());
  if (!sc.done && (sc.games[0] || sc.games[1] || sc.points[0] || sc.points[1])) out.push(sc.games.slice());
  return out;
}
