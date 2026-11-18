// The battlefield ground: W columns of H cells (y grows downward, the floor is y = H). Each
// column is a short list of solid runs, [top, bottom) pairs sorted top to bottom, so a crater,
// a tunnel or a floating lump is just a split run. Loose earth falls: a run with air under it
// drops (accelerating) until it rests on the run below or the floor. Deterministic and
// independent of the screen; the renderer watches `ver` (bumped per changed column).
//
//   const t = createTerrain();  t.shape(heights);  t.carveCircle(x, y, r);  t.addCircle(x, y, r);
//   t.solid(x, y);  t.groundAt(x, y) → first solid y at or below y;  t.step() → still settling?
export const W = 1280, H = 720;

export function createTerrain() {
  /** @type {number[][]} */
  let cols = Array.from({ length: W }, () => [H - 40, H]);
  const ver = new Uint32Array(W);
  const speed = new Float32Array(W);
  const active = new Uint8Array(W);
  let activeList = [];

  function wake(x) {
    if (!active[x]) { active[x] = 1; activeList.push(x); }
  }
  function shape(heights) {
    cols = Array.from({ length: W }, (_, x) => [Math.max(0, Math.min(H, Math.round(heights[x]))), H]);
    for (const r of cols) if (r[0] >= H) r.length = 0;
    for (let x = 0; x < W; x++) { ver[x]++; active[x] = 0; speed[x] = 0; }
    activeList = [];
  }
  function solid(x, y) {
    if (x < 0 || x >= W || y < 0) return false;
    if (y >= H) return true;
    const r = cols[x];
    for (let i = 0; i < r.length; i += 2) {
      if (y < r[i]) return false;
      if (y < r[i + 1]) return true;
    }
    return false;
  }
  /** First solid cell at or below y in column x (H: none, the floor). */
  function groundAt(x, y) {
    if (x < 0 || x >= W) return H;
    const r = cols[x];
    for (let i = 0; i < r.length; i += 2) if (r[i + 1] > y) return Math.max(r[i], y);
    return H;
  }
  const top = x => (x < 0 || x >= W || !cols[x].length ? H : cols[x][0]);

  /** Remove [a, b) from column x; returns the cells removed. */
  function cut(x, a, b) {
    a = Math.max(0, Math.round(a)); b = Math.min(H, Math.round(b));
    if (x < 0 || x >= W || b <= a) return 0;
    const r = cols[x];
    let removed = 0, hit = false;
    for (let i = 0; i < r.length; i += 2) if (r[i + 1] > a && r[i] < b) { hit = true; break; }
    if (!hit) return 0;
    const out = [];
    for (let i = 0; i < r.length; i += 2) {
      const t = r[i], bo = r[i + 1];
      if (bo <= a || t >= b) { out.push(t, bo); continue; }
      removed += Math.min(bo, b) - Math.max(t, a);
      if (t < a) out.push(t, a);
      if (bo > b) out.push(b, bo);
    }
    cols[x] = out; ver[x]++; wake(x);
    return removed;
  }
  /** Fill [a, b) in column x; returns the cells added. */
  function fill(x, a, b) {
    a = Math.max(0, Math.round(a)); b = Math.min(H, Math.round(b));
    if (x < 0 || x >= W || b <= a) return 0;
    const r = cols[x], out = [];
    let na = a, nb = b, placed = false, before = 0;
    for (let i = 0; i < r.length; i += 2) before += r[i + 1] - r[i];
    for (let i = 0; i < r.length; i += 2) {
      const t = r[i], bo = r[i + 1];
      if (bo < na) out.push(t, bo);
      else if (t > nb) { if (!placed) { out.push(na, nb); placed = true; } out.push(t, bo); }
      else { na = Math.min(na, t); nb = Math.max(nb, bo); }
    }
    if (!placed) out.push(na, nb);
    let after = 0;
    for (let i = 0; i < out.length; i += 2) after += out[i + 1] - out[i];
    if (after === before) return 0;
    cols[x] = out; ver[x]++; wake(x);
    return after - before;
  }
  function carveCircle(cx, cy, rad) {
    let n = 0;
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(W - 1, Math.ceil(cx + rad));
    for (let x = x0; x <= x1; x++) {
      const d = rad * rad - (x - cx) * (x - cx);
      if (d <= 0) continue;
      const dy = Math.sqrt(d);
      n += cut(x, cy - dy, cy + dy);
    }
    return n;
  }
  function addCircle(cx, cy, rad) {
    let n = 0;
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(W - 1, Math.ceil(cx + rad));
    for (let x = x0; x <= x1; x++) {
      const d = rad * rad - (x - cx) * (x - cx);
      if (d <= 0) continue;
      const dy = Math.sqrt(d);
      n += fill(x, cy - dy, cy + dy);
    }
    return n;
  }

  /** One settling step: loose runs fall. Returns true while anything is still falling. */
  function step() {
    if (!activeList.length) return false;
    const next = [];
    for (const x of activeList) {
      const r = cols[x];
      let floor = H, moved = false;
      speed[x] = Math.min(speed[x] + 0.3, 9);
      const sp = Math.max(1, Math.floor(speed[x]));
      for (let i = r.length - 2; i >= 0; i -= 2) {
        const gap = floor - r[i + 1];
        if (gap > 0) { const m = Math.min(gap, sp); r[i] += m; r[i + 1] += m; moved = true; }
        floor = r[i];
      }
      if (moved) {
        // runs that now touch merge
        const out = [r[0], r[1]];
        for (let i = 2; i < r.length; i += 2) {
          if (r[i] <= out[out.length - 1]) out[out.length - 1] = Math.max(out[out.length - 1], r[i + 1]);
          else out.push(r[i], r[i + 1]);
        }
        cols[x] = out; ver[x]++;
        next.push(x);
      } else { active[x] = 0; speed[x] = 0; }
    }
    activeList = next;
    return next.length > 0;
  }
  const settling = () => activeList.length > 0;
  /** Cells of solid ground in total (for invariants). */
  function mass() {
    let n = 0;
    for (const r of cols) for (let i = 0; i < r.length; i += 2) n += r[i + 1] - r[i];
    return n;
  }
  return {
    W, H, ver, shape, solid, groundAt, top, cut, fill, carveCircle, addCircle, step, settling, mass,
    get cols() { return cols; },
  };
}

// ---------- generation ----------

/** Smooth 1-D value noise over [0, 1) at a frequency of `f` bumps across the field. */
function noise1(rand, f) {
  const n = Math.ceil(f) + 2, v = Array.from({ length: n + 1 }, () => rand() * 2 - 1);
  return t => {
    const p = t * f, i = Math.floor(p), k = p - i, s = k * k * (3 - 2 * k);
    return v[i] * (1 - s) + v[i + 1] * s;
  };
}

export const LANDS = ['hills', 'peaks', 'mesas', 'islands', 'dunes', 'canyon'];
export const LAND_NAMES = { hills: 'Rolling hills', peaks: 'Peaks', mesas: 'Mesas', islands: 'Islands', dunes: 'Dunes', canyon: 'Canyon' };

/** Column heights (top y) for a land kind; `slots` are where the tanks will stand. */
export function generate(rand, kind, slots) {
  const h = new Float32Array(W);
  const n1 = noise1(rand, 3), n2 = noise1(rand, 7), n3 = noise1(rand, 17), n4 = noise1(rand, 40);
  const fine = x => n3(x) * 10 + n4(x) * 3;
  for (let x = 0; x < W; x++) {
    const t = x / W;
    let y;
    switch (kind) {
      case 'peaks': {
        const ridge = 1 - Math.abs(n2(t)), big = 1 - Math.abs(n1(t));
        y = 610 - big * 260 - ridge * 120 + fine(t);
        break;
      }
      case 'mesas': {
        const raw = 470 + n1(t) * 140 + n2(t) * 70, step = 56;
        const q = Math.round(raw / step) * step, k = (raw - q) / step;
        y = q + Math.max(-0.5, Math.min(0.5, k * 3)) * step + n4(t) * 2;
        break;
      }
      case 'islands': {
        y = 690;
        for (const s of slots) {
          const d = (x - s) / 70;
          y = Math.min(y, 470 + n1(t) * 60 + d * d * 60 + n3(t) * 8);
        }
        y = Math.min(y, 640 + n2(t) * 40);
        break;
      }
      case 'dunes': {
        const w = Math.sin(t * Math.PI * 2 * 5 + n1(t) * 3);
        y = 520 + n1(t) * 90 - (w > 0 ? w : w * 0.4) * 34 + n4(t) * 2;
        break;
      }
      case 'canyon': {
        const c = 0.5 + n1(t) * 0.12, d = Math.abs(t - c) / 0.18;
        y = 330 + n2(t) * 50 + fine(t) + Math.max(0, 1 - d * d) * 300;
        break;
      }
      default:
        y = 500 + n1(t) * 150 + n2(t) * 60 + fine(t);
    }
    h[x] = y;
  }
  // a level pad under every tank, eased into the land around it
  for (const s of slots) {
    let sum = 0, cnt = 0;
    for (let x = s - 14; x <= s + 14; x++) if (x >= 0 && x < W) { sum += h[x]; cnt++; }
    const lvl = sum / cnt;
    for (let x = s - 30; x <= s + 30; x++) {
      if (x < 0 || x >= W) continue;
      const d = Math.abs(x - s), k = d <= 14 ? 1 : 1 - (d - 14) / 16;
      h[x] = h[x] * (1 - k) + lvl * k;
    }
  }
  for (let x = 0; x < W; x++) h[x] = Math.max(170, Math.min(H - 24, h[x]));
  return h;
}
