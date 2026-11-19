export interface Vec2 {
  x: number;
  y: number;
}

export const vec2 = (x = 0, y = 0): Vec2 => ({ x, y });

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Hermite smoothstep on [0, 1]. */
export const smoothstep = (t: number): number => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/** Wraps a phase into [0, 1). */
export const wrap01 = (v: number): number => ((v % 1) + 1) % 1;

const HALF_PI = Math.PI / 2;
/** π/2 in two parts: the second is what the first has to round off, for reducing an angle. */
const HALF_PI_HIGH = 1.5707963267341256;
const HALF_PI_LOW = 6.0771005065061922e-11;

/** Taylor series on [-π/4, π/4], where they've converged to double precision by here. */
function sinNear(x: number): number {
  const z = x * x;
  // prettier-ignore
  return x + x * z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880 + z * (-1 / 39916800 +
    z * (1 / 6227020800 + z * (-1 / 1307674368000 + z / 355687428096000)))))));
}

function cosNear(x: number): number {
  const z = x * x;
  // prettier-ignore
  return 1 + z * (-1 / 2 + z * (1 / 24 + z * (-1 / 720 + z * (1 / 40320 + z * (-1 / 3628800 +
    z * (1 / 479001600 + z * (-1 / 87178291200 + z / 20922789888000)))))));
}

/** atan(x) for x in [0, 1]: halve the angle twice, then a series that converges quickly. */
function atanNear(x: number): number {
  const t = x / (1 + Math.sqrt(1 + x * x));
  const u = t / (1 + Math.sqrt(1 + t * t));
  const z = u * u;
  // prettier-ignore
  return 4 * u * (1 + z * (-1 / 3 + z * (1 / 5 + z * (-1 / 7 + z * (1 / 9 + z * (-1 / 11 + z * (1 / 13 +
    z * (-1 / 15 + z * (1 / 17 + z * (-1 / 19 + z / 21))))))))));
}

const atan = (x: number): number => {
  const a = Math.abs(x);
  const r = a > 1 ? HALF_PI - atanNear(1 / a) : atanNear(a);
  return x < 0 ? -r : r;
};

/**
 * The maths the sim runs on. JavaScript lets every engine round `Math.sin` and
 * its kin its own way, and they do (Chrome's and Safari's disagree), so a fight
 * played on one would drift on another. These are built only from what the
 * language fixes to the last bit (+, -, ×, ÷, `Math.sqrt`), so online peers and the
 * server checking a run all get the same numbers. A test keeps the others out.
 */
export const Exact = {
  sin(x: number): number {
    const k = Math.round(x / HALF_PI);
    const r = x - k * HALF_PI_HIGH - k * HALF_PI_LOW;
    switch (((k % 4) + 4) % 4) {
      case 0:
        return sinNear(r);
      case 1:
        return cosNear(r);
      case 2:
        return -sinNear(r);
      default:
        return -cosNear(r);
    }
  },
  cos(x: number): number {
    const k = Math.round(x / HALF_PI);
    const r = x - k * HALF_PI_HIGH - k * HALF_PI_LOW;
    switch (((k % 4) + 4) % 4) {
      case 0:
        return cosNear(r);
      case 1:
        return -sinNear(r);
      case 2:
        return -cosNear(r);
      default:
        return sinNear(r);
    }
  },
  atan2(y: number, x: number): number {
    if (x > 0) return atan(y / x);
    if (x < 0) return y < 0 ? atan(y / x) - Math.PI : atan(y / x) + Math.PI;
    return y > 0 ? HALF_PI : y < 0 ? -HALF_PI : 0;
  },
  acos(x: number): number {
    return Exact.atan2(Math.sqrt((1 - x) * (1 + x)), x);
  },
  hypot(x: number, y: number, z = 0): number {
    return Math.sqrt(x * x + y * y + z * z);
  },
  /** `base` to a whole power `n` (0 or more), by multiplying. */
  powi(base: number, n: number): number {
    let r = 1;
    for (let i = 0; i < n; i++) r *= base;
    return r;
  },
};

export const distance = (a: Vec2, b: Vec2): number => Exact.hypot(b.x - a.x, b.y - a.y);

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** `a`, shifted by whole turns to lie within π of `b` (shortest-way blending). */
export const nearestAngle = (a: number, b: number): number =>
  a - Math.round((a - b) / (2 * Math.PI)) * 2 * Math.PI;

/**
 * CSS's cubic-bezier(x1, y1, x2, y2) at `t`: the curve from (0, 0) to (1, 1)
 * with those two handles, time across and the value up. x1 and x2 must be
 * within 0..1, so time only runs forward; y may go past either end (an
 * overshoot). Plain arithmetic, so it's the same in every browser.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // The curve's own parameter where its time is t, by halves.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 28; i++) {
    const s = (lo + hi) / 2;
    if (bezierAt(x1, x2, s) < t) lo = s;
    else hi = s;
  }
  return bezierAt(y1, y2, (lo + hi) / 2);
}

/** One coordinate of the curve from 0 to 1 with handles at `p1` and `p2`, at parameter `s`. */
export const bezierAt = (p1: number, p2: number, s: number): number => {
  const u = 1 - s;
  return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s;
};
