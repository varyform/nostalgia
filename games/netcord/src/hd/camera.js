// The cameras. Each view is an eye, a point looked at and a field of view, worked out from the
// match every frame; the result follows them through a spring, and a change of view (or the
// 'behind' camera swapping ends) glides from where the camera was over most of a second.
//
//   'tv'      high behind the near baseline, the whole court in view, drifting with the ball;
//             at the serve it leans a little toward the server's end and closes in
//   'behind'  low behind the human's player (the server's in a demo), from whichever end he's at
//   'side'    from the stands beside the court, level with the ball
//   'high'    overhead, the near end at the bottom of the screen
//   'umpire'  from the umpire's chair, turning with the ball
//
//   const cam = createCamera();  cam.update(app, match.s, dt) → { eye, f, u, fov, near, far }
import { C } from './court.js';

export const VIEWS = ['tv', 'behind', 'side', 'high', 'umpire'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => t * t * (3 - 2 * t);

/** where a view wants the camera: { eye, at, fov } */
function want(view, s, focus, human, umpire) {
  const b = focus;
  const server = s?.server ?? 0, sEnd = s?.end?.[server] ?? 1;
  const serving = s?.phase === 'serve';
  switch (view) {
    case 'behind': {
      const i = human >= 0 ? human : server;
      const p = s?.players?.[i] ?? { x: 0, z: 12 };
      const e = s?.end?.[i] ?? (p.z >= 0 ? 1 : -1);
      const ez = clamp(p.z + e * 6.2, -C.endZ - 0.9, C.endZ + 0.9);
      return { eye: [p.x * 0.7 + b.x * 0.1, 3.1, ez], at: [p.x * 0.35 + b.x * 0.25, 0.7, -e * 7.5], fov: 0.98 };
    }
    case 'side':
      return { eye: [19.5, 10.5, b.z * 0.25], at: [0, 0.2, b.z * 0.35], fov: 0.86 };
    case 'high':
      return { eye: [b.x * 0.06, 36, 5.5 + b.z * 0.05], at: [b.x * 0.08, 0, 0.5 + b.z * 0.06], fov: 0.9 };
    case 'umpire': {
      const u = umpire ?? [-7.55, 2.75, 0];
      return { eye: [u[0] - 0.3, u[1] + 0.45, u[2]], at: [1.6 + b.x * 0.15, 0.25, b.z * 0.75], fov: 1.15 };
    }
    default: {
      // tv: the whole court, from high over the near stand (the near player's feet and a lob
      // over the far baseline both in the picture)
      const lean = serving ? sEnd * 0.8 : 0;
      return {
        eye: [b.x * 0.16, 12.5, 28.5],
        at: [b.x * 0.32, 0, 1.2 + b.z * 0.08 + lean],
        fov: serving ? 0.655 : 0.68,
      };
    }
  }
}

export function createCamera() {
  const cam = { eye: [0, 12.5, 28.5], f: [0, -0.4, -0.92], u: [0, 0.92, -0.4], fov: 0.68, near: 0.3, far: 520 };
  const cur = { eye: [0, 12.5, 28.5], at: [0, 0, 1.2], fov: 0.68 };
  const focus = { x: 0, z: 0 };
  let view = null, from = null, blendT = 1, lastEnd = 0, ready = false;

  function update(app, s, dt = 1 / 60, umpire = null) {
    const v = VIEWS.includes(app?.camera) ? app.camera : 'tv';
    const human = app?.human ?? -1;
    // the ball, followed gently (the ball's own jitter never shakes the picture)
    const b = s?.ball, tx = clamp(b?.x ?? 0, -7, 7), tz = clamp(b?.z ?? 0, -15, 15);
    const k = ready ? 1 - Math.exp(-dt * 2.4) : 1;
    focus.x += (tx - focus.x) * k;
    focus.z += (tz - focus.z) * k;
    const w = want(v, s, focus, human, umpire);
    // a change of view, or the 'behind' camera's player changing ends: glide from here
    const i = human >= 0 ? human : (s?.server ?? 0);
    const end = s?.end?.[i] ?? 1;
    if (ready && (v !== view || (v === 'behind' && end !== lastEnd))) {
      from = { eye: [...cur.eye], at: [...cur.at], fov: cur.fov };
      blendT = 0;
    }
    view = v;
    lastEnd = end;
    if (!ready) {
      cur.eye = [...w.eye];
      cur.at = [...w.at];
      cur.fov = w.fov;
      ready = true;
    } else if (blendT < 1) {
      blendT = Math.min(1, blendT + dt / 0.9);
      const e = ease(blendT);
      for (let a = 0; a < 3; a++) {
        cur.eye[a] = from.eye[a] + (w.eye[a] - from.eye[a]) * e;
        cur.at[a] = from.at[a] + (w.at[a] - from.at[a]) * e;
      }
      cur.fov = from.fov + (w.fov - from.fov) * e;
    } else {
      const q = 1 - Math.exp(-dt * 5);
      for (let a = 0; a < 3; a++) {
        cur.eye[a] += (w.eye[a] - cur.eye[a]) * q;
        cur.at[a] += (w.at[a] - cur.at[a]) * q;
      }
      cur.fov += (w.fov - cur.fov) * q;
    }
    // forward, and an up square to it (the overhead view keeps the near end at the bottom)
    let f = [cur.at[0] - cur.eye[0], cur.at[1] - cur.eye[1], cur.at[2] - cur.eye[2]];
    const L = Math.hypot(f[0], f[1], f[2]) || 1;
    f = [f[0] / L, f[1] / L, f[2] / L];
    const ref = Math.abs(f[1]) > 0.97 ? [0, 0, -1] : [0, 1, 0];
    let r = [f[1] * ref[2] - f[2] * ref[1], f[2] * ref[0] - f[0] * ref[2], f[0] * ref[1] - f[1] * ref[0]];
    const rl = Math.hypot(r[0], r[1], r[2]) || 1;
    r = [r[0] / rl, r[1] / rl, r[2] / rl];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    cam.eye = cur.eye;
    cam.f = f;
    cam.u = u;
    cam.fov = cur.fov;
    cam.near = v === 'high' ? 1 : 0.3;
    return cam;
  }
  return {
    cam,
    update,
    get view() {
      return view;
    },
    /** jump straight to the next view (a new match) */
    reset() {
      ready = false;
      blendT = 1;
    },
  };
}
