// Swerve's formations. Eleven slots each: slot 0 the keeper, then the defenders, midfielders and
// forwards, each line from left to right as the team sees it (attacking away from its own goal).
// x runs 0..1 across, y 0..1 from the team's own goal line (0) to the opponent's (1): where each
// player stands in the team's middle-of-the-road shape. ai.js slides and squeezes the shape with
// the ball and with who has it, so a slot is a home, not a cage. The squad screen draws them.
//
//   FORMATIONS['4-4-2'].slots[k] → { role: 'GK' | 'DF' | 'MF' | 'FW', x, y }
//   FORMATION_KEYS               → the display order

// a line of players: one depth, or a depth each (wide men a step up or back)
const line = (role, xs, y) => xs.map((x, k) => ({ role, x, y: Array.isArray(y) ? y[k] : y }));
const shape = (...lines) => ({ slots: [{ role: 'GK', x: 0.5, y: 0.02 }, ...lines.flat()] });

export const FORMATIONS = {
  '4-4-2': shape(
    line('DF', [0.14, 0.38, 0.62, 0.86], [0.23, 0.19, 0.19, 0.23]),
    line('MF', [0.14, 0.38, 0.62, 0.86], [0.5, 0.45, 0.45, 0.5]),
    line('FW', [0.38, 0.62], 0.76),
  ),
  '4-3-3': shape(
    line('DF', [0.14, 0.38, 0.62, 0.86], [0.23, 0.19, 0.19, 0.23]),
    line('MF', [0.28, 0.5, 0.72], [0.47, 0.42, 0.47]),
    line('FW', [0.16, 0.5, 0.84], [0.72, 0.78, 0.72]),
  ),
  '4-5-1': shape(
    line('DF', [0.14, 0.38, 0.62, 0.86], [0.23, 0.19, 0.19, 0.23]),
    line('MF', [0.1, 0.3, 0.5, 0.7, 0.9], [0.5, 0.46, 0.4, 0.46, 0.5]),
    line('FW', [0.5], 0.77),
  ),
  '5-3-2': shape(
    line('DF', [0.08, 0.3, 0.5, 0.7, 0.92], [0.27, 0.19, 0.17, 0.19, 0.27]),
    line('MF', [0.28, 0.5, 0.72], [0.47, 0.43, 0.47]),
    line('FW', [0.38, 0.62], 0.75),
  ),
  '3-5-2': shape(
    line('DF', [0.28, 0.5, 0.72], [0.2, 0.18, 0.2]),
    line('MF', [0.1, 0.3, 0.5, 0.7, 0.9], [0.52, 0.45, 0.4, 0.45, 0.52]),
    line('FW', [0.38, 0.62], 0.76),
  ),
  '4-2-4': shape(
    line('DF', [0.14, 0.38, 0.62, 0.86], [0.23, 0.19, 0.19, 0.23]),
    line('MF', [0.38, 0.62], 0.43),
    line('FW', [0.12, 0.38, 0.62, 0.88], [0.7, 0.76, 0.76, 0.7]),
  ),
  '3-4-3': shape(
    line('DF', [0.28, 0.5, 0.72], [0.2, 0.18, 0.2]),
    line('MF', [0.14, 0.38, 0.62, 0.86], [0.5, 0.44, 0.44, 0.5]),
    line('FW', [0.16, 0.5, 0.84], [0.72, 0.78, 0.72]),
  ),
  '5-4-1': shape(
    line('DF', [0.08, 0.3, 0.5, 0.7, 0.92], [0.26, 0.19, 0.17, 0.19, 0.26]),
    line('MF', [0.14, 0.38, 0.62, 0.86], [0.48, 0.44, 0.44, 0.48]),
    line('FW', [0.5], 0.76),
  ),
};

export const FORMATION_KEYS = ['4-4-2', '4-3-3', '4-5-1', '5-3-2', '3-5-2', '4-2-4', '3-4-3', '5-4-1'];
