// The ground of a theatre: a seeded, deterministic height field on a 192 × 192 grid of 150 m
// cells (28.8 km square, centred on the origin), shaped by the theatre's islands, mesas or
// ridges, then flattened under its sites and runways and carved along its rivers and valleys.
// Shared by the sim (collisions, terrain masking), the autopilot, the renderer and the tools.
//
//   const w = createWorld(0);                 // theatre index → cached world
//   w.heightAt(x, z);                         // the surface, water included, exactly as drawn
//   w.raw[k], w.h[k]                          // grid heights (k = j * (N + 1) + i): raw, and drawn
//   w.site('home') → { x, z, y, … }           // a named place from theatres.js
//
// World axes: x east, y up, z south (so north is −z, heading 0). Metres.
import { lerp, smooth } from '@nostalgia/gl/noise';
import { gridHeight } from '@nostalgia/gl/terrain';
import { THEATRES } from './theatres.js';

export { fbm, lerp, polyAt, polyDist, polyLen, ridged, smooth } from '@nostalgia/gl/noise';

export const CELL = 150, N = 192, SIZE = CELL * N, HALF = SIZE / 2, V = N + 1;

// a rectangle's signed outside distance (≤ 0 inside), for runways: centre, half sizes, heading
function rectDist(x, z, R) {
  const c = Math.cos(R.dir), s = Math.sin(R.dir), dx = x - R.x, dz = z - R.z;
  const along = dx * s - dz * c, across = dx * c + dz * s; // heading dir: along points that way
  return Math.max(Math.abs(along) - R.len / 2, Math.abs(across) - R.wid / 2);
}

const worlds = new Map();
export function createWorld(index) {
  if (worlds.has(index)) return worlds.get(index);
  const T = THEATRES[index], raw = new Float32Array(V * V), h = new Float32Array(V * V);
  const water = T.water;
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL;
    let y = T.shape(x, z);
    // the map's rim blends into the ground beyond it
    const e = smooth(HALF - 2600, HALF, Math.max(Math.abs(x), Math.abs(z)));
    y = lerp(y, T.edge, e);
    raw[j * V + i] = y;
  }
  const at = (x, z) => {
    const i = Math.max(0, Math.min(N, Math.round((x + HALF) / CELL))), j = Math.max(0, Math.min(N, Math.round((z + HALF) / CELL)));
    return raw[j * V + i];
  };
  // sites: flat pads (and runways), at the ground they stand on unless the theatre says
  const sites = {};
  for (const [name, s] of Object.entries(T.sites)) {
    const y = Math.max(water + 6, s.h ?? at(s.x, s.z));
    sites[name] = { name, ...s, y, runway: s.runway && { ...s.runway, x: s.runway.x ?? s.x, z: s.runway.z ?? s.z, dir: ((s.runway.dir ?? 0) * Math.PI) / 180 } };
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
    const x = -HALF + i * CELL, z = -HALF + j * CELL, k = j * V + i;
    let y = raw[k];
    for (const s of Object.values(sites)) {
      if (s.r) {
        const d = Math.hypot(x - s.x, z - s.z);
        y = lerp(y, s.y, smooth(s.r * 1.9, s.r, d));
      }
      if (s.runway) y = lerp(y, s.y, smooth(260, 60, rectDist(x, z, s.runway)));
    }
    raw[k] = y;
    h[k] = Math.max(y, water);
  }
  // the surface the terrain mesh draws (its cells split along a–d); the theatre's edge beyond the grid
  const edge = Math.max(T.edge, water);
  const heightAt = (x, z) => gridHeight(h, N, -HALF, CELL, x, z, edge);
  /** is (x, z) over water (the raw ground is under the water line)? */
  const wet = (x, z) => {
    const i = Math.max(0, Math.min(N, Math.round((x + HALF) / CELL))), j = Math.max(0, Math.min(N, Math.round((z + HALF) / CELL)));
    return raw[j * V + i] < water + 0.5;
  };
  // nothing in between a and b blocks the view (terrain masking for SAM radars)
  function clear(ax, ay, az, bx, by, bz, samples = 12) {
    for (let k = 1; k < samples; k++) {
      const t = k / samples;
      if (heightAt(ax + (bx - ax) * t, az + (bz - az) * t) > ay + (by - ay) * t - 4) return false;
    }
    return true;
  }
  const w = { index, T, raw, h, water, sites, heightAt, wet, clear, site: name => sites[name] };
  worlds.set(index, w);
  return w;
}
