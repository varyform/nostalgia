// The attract demo's driver for the player's car: the same driver the rivals have (ai.js), its
// wishes turned into the held keys a player would press. The wheel is ramped by the sim, so a key
// is held while the wheel is short of where the driver wants it; throttle and brake that the
// driver wants partly are pulsed. It keeps its own memory and random numbers, never the sim's.
//
//   const pilot = createPilot(race, 0, { skill: 0.7 });
//   race.step([pilot()]);
import { createDriver } from './ai.js';

export function createPilot(race, i = 0, { skill = 0.7, aggression = 0.5, seed = 7 } = {}) {
  const drive = createDriver(race, i, { skill, aggression, seed });
  let up = 0, down = 0;
  return () => {
    const k = drive(), car = race.s.cars[i];
    const diff = k.steer - car.steer;
    // pulse width: an accumulator per pedal, pressed whenever it fills
    up += k.throttle; down += k.brake;
    const out = {
      up: up >= 1, down: down >= 1, left: diff < -0.08, right: diff > 0.08,
      fire: k.fire, mine: k.mine, turbo: k.turbo,
    };
    if (out.up) up -= 1;
    if (out.down) down -= 1;
    // holding a full lock: keep the key down rather than let the wheel drift back
    if (Math.abs(k.steer) > 0.92 && Math.sign(k.steer) === Math.sign(car.steer)) { out.left = k.steer < 0; out.right = k.steer > 0; }
    return out;
  };
}
