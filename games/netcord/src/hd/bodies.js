// The players, rebuilt every frame from the rig: figure.pose(p) puts the rig's joints in court
// space, and each bone becomes a flat-shaded prism with pointed ends (thighs and upper arms in
// shorts and sleeves, skin below, socks and shoes), the spine a lofted torso from the hips to the
// shoulders, a head with hair and the kit's band, and the racket from out.racket: a frame ring,
// a throat, a taped handle, and see-through strings. Both players go into one dynamic vertex
// buffer (a few thousand vertices), drawn in one call, and each casts its own shadow on the court.
//
//   const B = createBodies(R);
//   B.update(match, app);  B.draw();  … B.shadows(sky);  … B.glass();  B.destroy();
import { Joint } from '@nostalgia/rig';
import { HEIGHT, RACKET, createFigure, newPose } from '../figure.js';
import { rgbOf, shade } from './court.js';

const SKINS = ['#f0c6a2', '#dfa983', '#c88c63', '#a86c46', '#80502f', '#5e3a22'];
const HAIRS = ['#2a1d14', '#4b3121', '#6e4b2b', '#a6773f', '#d9b475', '#18181a', '#8c8a86'];
const FALLBACK_KITS = [
  { shirt: '#f4f4f0', shorts: '#1f2a44', band: '#e2463a' },
  { shirt: '#3b6fd0', shorts: '#f4f4f0', band: '#f2d43a' },
];
const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const GROUND = [0, 1, 0, 0];

// ---------- a growable buffer of the engine's 20-byte vertices, written in place ----------
function emitter(cap) {
  let ab, f32, i8, u8;
  const alloc = c => {
    const old = u8;
    cap = c;
    ab = new ArrayBuffer(cap * 20);
    f32 = new Float32Array(ab);
    i8 = new Int8Array(ab);
    u8 = new Uint8Array(ab);
    if (old) u8.set(old.subarray(0, Math.min(old.length, u8.length)));
  };
  alloc(cap);
  const E = {
    n: 0,
    get cap() {
      return cap;
    },
    get bytes() {
      return u8.subarray(0, E.n * 20);
    },
    reset() {
      E.n = 0;
    },
    /** a flat triangle facing away from ref; col [r, g, b] 0..255 */
    tri(a, b, c, col, ref, k = 255) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz);
      if (!(L > 1e-12)) return;
      nx /= L;
      ny /= L;
      nz /= L;
      let p = b, q = c;
      if (ref) {
        const cx = (a[0] + b[0] + c[0]) / 3 - ref[0], cy = (a[1] + b[1] + c[1]) / 3 - ref[1], cz = (a[2] + b[2] + c[2]) / 3 - ref[2];
        if (nx * cx + ny * cy + nz * cz < 0) {
          p = c;
          q = b;
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
      }
      if (E.n + 3 > cap) alloc(cap * 2);
      for (const v of [a, p, q]) {
        const o = E.n * 5, bb = E.n * 20 + 12;
        f32[o] = v[0];
        f32[o + 1] = v[1];
        f32[o + 2] = v[2];
        i8[bb] = Math.round(nx * 127);
        i8[bb + 1] = Math.round(ny * 127);
        i8[bb + 2] = Math.round(nz * 127);
        i8[bb + 3] = 0;
        u8[bb + 4] = col[0];
        u8[bb + 5] = col[1];
        u8[bb + 6] = col[2];
        u8[bb + 7] = k;
        E.n++;
      }
    },
    quad(a, b, c, d, col, ref) {
      E.tri(a, b, c, col, ref);
      E.tri(a, c, d, col, ref);
    },
  };
  return E;
}

// ---------- small vector helpers (arrays) ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** a unit vector at right angles to d */
const perp = d => norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]));

const RING = Array.from({ length: 9 }, () => [0, 0, 0]);
const RING2 = Array.from({ length: 9 }, () => [0, 0, 0]);

/** a bone: a prism from a (radius r0) to b (r1) with low pointed ends */
function prism(E, a, b, r0, r1, col, n = 6, caps = true) {
  const d = sub(b, a), L = len(d);
  if (!(L > 1e-5)) return;
  const dn = mul(d, 1 / L), p1 = perp(dn), p2 = cross(dn, p1), mid = lerp(a, b, 0.5);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const A = RING[i], Bq = RING2[i];
    for (let k = 0; k < 3; k++) {
      const o = p1[k] * c + p2[k] * s;
      A[k] = a[k] + o * r0;
      Bq[k] = b[k] + o * r1;
    }
  }
  const tipA = sub(a, mul(dn, r0 * 0.55)), tipB = add(b, mul(dn, r1 * 0.55));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    E.quad(RING[i], RING[j], RING2[j], RING2[i], col, mid);
    if (caps) {
      E.tri(RING[i], RING[j], tipA, col, mid);
      E.tri(RING2[i], RING2[j], tipB, col, mid);
    }
  }
}

/** a low-poly ellipsoid: centre, radius, up (y squash) and a forward for orientation */
function ball(E, c, r, ry, up, fwd, col, seg = 8, rings = 5) {
  const right = norm(cross(fwd, up));
  const pt = (i, j) => {
    const th = (j / rings) * Math.PI, ph = (i / seg) * Math.PI * 2;
    const s = Math.sin(th) * r, y = Math.cos(th) * ry;
    return [
      c[0] + up[0] * y + right[0] * Math.cos(ph) * s + fwd[0] * Math.sin(ph) * s,
      c[1] + up[1] * y + right[1] * Math.cos(ph) * s + fwd[1] * Math.sin(ph) * s,
      c[2] + up[2] * y + right[2] * Math.cos(ph) * s + fwd[2] * Math.sin(ph) * s,
    ];
  };
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), cc = pt(i + 1, j + 1), d = pt(i, j + 1);
      if (j === 0) E.tri(a, cc, d, col, c);
      else if (j === rings - 1) E.tri(a, b, cc, col, c);
      else E.quad(a, b, cc, d, col, c);
    }
}

const J = name => Joint[name] * 3;
const jp = (buf, name) => {
  const o = J(name);
  return [buf[o], buf[o + 1], buf[o + 2]];
};

function hashOf(s) {
  let h = 2166136261;
  for (const ch of String(s ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** a player's colours, from app.players[i] (kit, skin, hair, racket) or a stable fallback */
export function lookOfPlayer(meta, i) {
  const m = meta ?? {}, k = m.kit ?? FALLBACK_KITS[i % 2], h = hashOf(m.id ?? m.name ?? i);
  const c = v => rgbOf(v);
  return {
    shirt: c(k.shirt ?? FALLBACK_KITS[i % 2].shirt),
    shorts: c(k.shorts ?? FALLBACK_KITS[i % 2].shorts),
    band: c(k.band ?? k.shirt ?? '#e2463a'),
    skin: c(m.skin ?? SKINS[h % SKINS.length]),
    hair: c(m.hair ?? HAIRS[(h >>> 8) % HAIRS.length]),
    shoe: c(k.shoes ?? '#f2f2ef'),
    sock: c('#f7f7f4'),
    frame: c(m.racket ?? (h & 1 ? '#22252b' : '#f2f2f0')),
    accent: c(k.band ?? '#e2463a'),
    tape: c('#1a1a1e'),
    strings: c('#f4f2e4'),
  };
}

export function createBodies(R) {
  const figs = [createFigure(), createFigure()];
  const outs = [newPose(), newPose()];
  const E = emitter(12000), S = emitter(256);
  let buf = R.buffer(new ArrayBuffer(E.cap * 20)), bufCap = E.cap;
  let sbuf = R.buffer(new ArrayBuffer(S.cap * 20)), sCap = S.cap;
  const ranges = [null, null];
  let looks = [null, null], metas = [null, null], strings = 0;
  const gl = R.gl;

  function upload(b, E2, capRef, make) {
    gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
    if (E2.cap > capRef) {
      gl.bufferData(gl.ARRAY_BUFFER, E2.cap * 20, gl.DYNAMIC_DRAW);
      make(E2.cap);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, E2.bytes);
  }

  /** one player into E (and the strings into S) */
  function body(o, L, height) {
    const q = o.joints, s = (height || HEIGHT) / HEIGHT;
    const P = name => jp(q, name);
    const pelvis = P('pelvis');
    if (!Number.isFinite(pelvis[0]) || !Number.isFinite(pelvis[1])) return false;
    const up = [0, 1, 0];
    const hipN = P('hipNear'), hipF = P('hipFar'), shN = P('shoulderNear'), shF = P('shoulderFar');
    const belly = P('belly'), waist = P('waist'), ribs = P('ribs'), chest = P('chest'), head = P('head');
    // which way the body faces: square to the hips, the way the feet point
    const hipAxis = sub(hipN, hipF), shAxis = sub(shN, shF);
    const feet = add(sub(P('toeNear'), P('ankleNear')), sub(P('toeFar'), P('ankleFar')));
    let fwd = norm(cross(up, norm([hipAxis[0] + shAxis[0], 0, hipAxis[2] + shAxis[2]])));
    if (dot(fwd, feet) < 0) fwd = mul(fwd, -1);

    // the torso, lofted through rings from the crotch to the shoulders
    const spineUp = norm(sub(chest, pelvis));
    const rings = [
      { c: sub(pelvis, mul(spineUp, 0.08 * s)), t: 0, w: 0.16, d: 0.1 },
      { c: pelvis, t: 0, w: 0.185, d: 0.115 },
      { c: belly, t: 0.25, w: 0.16, d: 0.11 },
      { c: waist, t: 0.5, w: 0.15, d: 0.105 },
      { c: ribs, t: 0.8, w: 0.17, d: 0.118 },
      { c: sub(chest, mul(spineUp, 0.02 * s)), t: 1, w: 0.19, d: 0.105 },
    ];
    const N = 8, pts = [];
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      const u = norm(sub(rings[Math.min(rings.length - 1, i + 1)].c, rings[Math.max(0, i - 1)].c));
      let ax = lerp(hipAxis, shAxis, r.t);
      ax = norm(sub(ax, mul(u, dot(ax, u))));
      const f = cross(u, ax);
      const ring = [];
      for (let k = 0; k < N; k++) {
        const th = ((k + 0.5) / N) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
        ring.push(add(r.c, add(mul(ax, c * r.w * s), mul(f, sn * r.d * s))));
      }
      pts.push(ring);
    }
    for (let i = 0; i + 1 < rings.length; i++) {
      const col = i < 2 ? L.shorts : L.shirt, ref = lerp(rings[i].c, rings[i + 1].c, 0.5);
      for (let k = 0; k < N; k++) E.quad(pts[i][k], pts[i][(k + 1) % N], pts[i + 1][(k + 1) % N], pts[i + 1][k], col, ref);
    }
    const bot = sub(rings[0].c, mul(spineUp, 0.03 * s)), top = add(chest, mul(spineUp, 0.035 * s));
    for (let k = 0; k < N; k++) {
      E.tri(pts[0][k], pts[0][(k + 1) % N], bot, L.shorts, rings[1].c);
      E.tri(pts[5][k], pts[5][(k + 1) % N], top, L.shirt, rings[4].c);
    }

    // limbs
    for (const side of ['Near', 'Far']) {
      const sh = P(`shoulder${side}`), el = P(`elbow${side}`), wr = P(`wrist${side}`), hd = P(`hand${side}`);
      prism(E, sh, lerp(sh, el, 0.42), 0.064 * s, 0.056 * s, L.shirt, 6);
      prism(E, lerp(sh, el, 0.3), el, 0.047 * s, 0.04 * s, L.skin, 6);
      prism(E, el, wr, 0.04 * s, 0.031 * s, L.skin, 6);
      prism(E, wr, add(hd, mul(sub(hd, wr), 0.35)), 0.034 * s, 0.03 * s, L.skin, 5);
      const hip = P(`hip${side}`), kn = P(`knee${side}`), an = P(`ankle${side}`), toe = P(`toe${side}`);
      prism(E, hip, lerp(hip, kn, 0.46), 0.092 * s, 0.083 * s, L.shorts, 6);
      prism(E, lerp(hip, kn, 0.38), kn, 0.07 * s, 0.053 * s, L.skin, 6);
      prism(E, kn, an, 0.052 * s, 0.036 * s, L.skin, 6);
      prism(E, lerp(kn, an, 0.78), an, 0.041 * s, 0.039 * s, L.sock, 6, false);
      const fd = norm(sub(toe, an)), heel = sub(an, add(mul(fd, 0.07 * s), [0, 0.035 * s, 0]));
      prism(E, heel, toe, 0.05 * s, 0.038 * s, L.shoe, 6);
    }

    // neck, head, hair, band
    const hu = norm(sub(head, chest));
    prism(E, chest, sub(head, mul(hu, 0.06 * s)), 0.05 * s, 0.047 * s, L.skin, 6);
    const hf = norm(sub(fwd, mul(hu, dot(fwd, hu))));
    const rh = 0.112 * s;
    ball(E, head, rh, rh * 1.16, hu, hf, L.skin);
    ball(E, add(head, add(mul(hu, 0.03 * s), mul(hf, -0.03 * s))), rh * 0.98, rh * 1.08, hu, hf, L.hair, 8, 4);
    prism(E, add(head, mul(hu, 0.03 * s)), add(head, mul(hu, 0.07 * s)), rh * 1.04, rh * 1.0, L.band, 8, false);
    // a nose, so the face reads
    prism(E, add(add(head, mul(hf, rh * 0.85)), mul(hu, -0.01)), add(add(head, mul(hf, rh * 1.12)), mul(hu, -0.03)), 0.018 * s, 0.01 * s, shade(L.skin, 0.95), 4);

    racket(o.racket, L);
    return true;
  }

  function racket(rk, L) {
    if (!rk?.grip || !rk?.head) return;
    const grip = rk.grip, hc = rk.head;
    let ax = sub(hc, grip);
    ax = len(ax) > 0.15 ? norm(ax) : norm(rk.up ?? [0, 1, 0]);
    let n = rk.normal ? sub(rk.normal, mul(ax, dot(rk.normal, ax))) : perp(ax);
    n = len(n) > 1e-4 ? norm(n) : perp(ax);
    const sd = cross(ax, n);
    const A = RACKET.headLength / 2, Bw = RACKET.headWidth / 2, NS = 16;
    const rim = (th, dr, dn) => {
      const c = Math.cos(th), sn = Math.sin(th);
      // a point on the ellipse, pushed out (dr) in the plane and along the face normal (dn)
      const ex = c * (A + dr), ey = sn * (Bw + dr);
      return [hc[0] + ax[0] * ex + sd[0] * ey + n[0] * dn, hc[1] + ax[1] * ex + sd[1] * ey + n[1] * dn, hc[2] + ax[2] * ex + sd[2] * ey + n[2] * dn];
    };
    const T = 0.009, D = 0.012;
    for (let i = 0; i < NS; i++) {
      const t0 = (i / NS) * Math.PI * 2, t1 = ((i + 1) / NS) * Math.PI * 2, tm = (t0 + t1) / 2;
      const ref = rim(tm, 0, 0), col = Math.cos(tm) > 0.55 ? L.accent : L.frame;
      const o0 = rim(t0, T, D), o1 = rim(t1, T, D), O0 = rim(t0, T, -D), O1 = rim(t1, T, -D);
      const i0 = rim(t0, -T, D), i1 = rim(t1, -T, D), I0 = rim(t0, -T, -D), I1 = rim(t1, -T, -D);
      E.quad(o0, o1, O1, O0, col, ref);
      E.quad(i0, i1, I1, I0, col, ref);
      E.quad(o0, o1, i1, i0, col, ref);
      E.quad(O0, O1, I1, I0, col, ref);
    }
    // the throat: two bars from the bottom of the head to the shaft
    const throat = sub(hc, mul(ax, A + 0.07));
    for (const th of [Math.PI - 0.55, Math.PI + 0.55]) prism(E, rim(th, 0, 0), throat, 0.009, 0.01, L.frame, 4, false);
    // the shaft and the taped handle, past the hand to the butt
    const butt = sub(grip, mul(ax, RACKET.grip));
    prism(E, throat, lerp(throat, butt, 0.35), 0.012, 0.014, L.frame, 6, false);
    prism(E, lerp(throat, butt, 0.33), butt, 0.016, 0.018, L.tape, 6);
    // the strings: a see-through ellipse, both faces
    const c = hc;
    for (let i = 0; i < NS; i++) {
      const a = rim((i / NS) * Math.PI * 2, -T, 0), b = rim(((i + 1) / NS) * Math.PI * 2, -T, 0);
      S.tri(c, a, b, L.strings, add(c, n));
      S.tri(c, a, b, L.strings, sub(c, n));
    }
  }

  return {
    ranges,
    outs,
    /** pose both players of the match (but those `hide` names) and rebuild the buffer */
    update(match, app, hide = null) {
      E.reset();
      S.reset();
      const s = match?.s;
      for (let i = 0; i < 2; i++) {
        ranges[i] = null;
        const p = s?.players?.[i];
        if (!p || hide?.[i]) continue;
        const meta = app?.players?.[i] ?? null;
        if (metas[i] !== meta || !looks[i]) {
          metas[i] = meta;
          looks[i] = lookOfPlayer(meta, i);
        }
        const first = E.n;
        figs[i].pose(p, outs[i]);
        if (body(outs[i], looks[i], p.height ?? meta?.height)) ranges[i] = [first, E.n - first];
        else E.n = first;
      }
      strings = S.n;
      upload(buf, E, bufCap, c => (bufCap = c));
      if (S.n) upload(sbuf, S, sCap, c => (sCap = c));
    },
    draw() {
      if (E.n) R.drawStatic(buf, 0, E.n);
    },
    /** each player's shadow on the court, along dir (toward the light) */
    shadows(alpha, dir) {
      for (const r of ranges) if (r) R.drawShadow(buf, r, I4, GROUND, alpha, dir);
    },
    glass() {
      if (strings) R.drawMesh(sbuf, [0, strings], I4, null, false, 0.42);
    },
    /** the head's position of player i this frame, or null */
    headOf(i) {
      if (!ranges[i]) return null;
      return jp(outs[i].joints, 'head');
    },
    destroy() {
      buf.destroy();
      sbuf.destroy();
    },
  };
}
