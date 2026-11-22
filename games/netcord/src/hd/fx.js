// What the ball and the players leave behind: soft points for chalk and dust puffs (a ball on a
// line, a bounce on clay, the tape clipped), a flash at the strings on a hit and the ball's short
// motion trail; and marks on clay — each bounce's oval and the players' footprints — kept in a
// ring of slots in one dynamic buffer, drawn just over the court. events() runs every sim step
// (60 Hz), so the effects keep to the sim's time and freeze with it.
//
//   const fx = createFx(R, { demo });  fx.venue(look, colourAt);
//   fx.events(list, match);  fx.ball(match.s.ball);  …  fx.drawMarks();  fx.drawPoints();
import { C, cordY, lineDistance, mix, rgbOf, shade } from './court.js';

const DT = 1 / 60;
const MARK_VERTS = 18; // a hexagon fan
const TRAIL = 9;

export function createFx(R, { demo = false } = {}) {
  const MAX_P = demo ? 160 : 600, MAX_M = demo ? 80 : 320;
  const parts = [];
  const pdata = new Float32Array((MAX_P + TRAIL + 4) * 8);
  let seed = 4421;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let look = null, colourAt = () => [150, 150, 150];

  // ---------- marks: slots of one hexagon each, written in place ----------
  const gl = R.gl;
  const mbuf = R.buffer(new ArrayBuffer(MAX_M * MARK_VERTS * 20));
  const one = new ArrayBuffer(MARK_VERTS * 20), f32 = new Float32Array(one), i8 = new Int8Array(one), u8 = new Uint8Array(one);
  let mNext = 0, mCount = 0;
  function mark(x, z, along, l, w, col) {
    const c = rgbOf(col).map(v => Math.max(0, Math.min(255, Math.round(v))));
    const ax = Math.cos(along), az = Math.sin(along), y = 0.005;
    const pt = k => {
      const t = (k / 6) * Math.PI * 2, u = Math.cos(t) * l, v = Math.sin(t) * w;
      return [x + ax * u - az * v, y, z + az * u + ax * v];
    };
    let n = 0;
    const put = p => {
      const o = n * 5, b = n * 20 + 12;
      f32[o] = p[0];
      f32[o + 1] = p[1];
      f32[o + 2] = p[2];
      i8[b] = 0;
      i8[b + 1] = 127;
      i8[b + 2] = 0;
      u8[b + 4] = c[0];
      u8[b + 5] = c[1];
      u8[b + 6] = c[2];
      u8[b + 7] = 255;
      n++;
    };
    for (let k = 0; k < 6; k++) {
      // counter-clockwise seen from above: centre, k + 1, k
      put([x, y, z]);
      put(pt(k + 1));
      put(pt(k));
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, mbuf.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, mNext * MARK_VERTS * 20, u8);
    mNext = (mNext + 1) % MAX_M;
    mCount = Math.min(MAX_M, mCount + 1);
  }

  // ---------- particles ----------
  function puff(x, y, z, o) {
    if (parts.length >= MAX_P) parts.shift();
    parts.push({
      x, y, z,
      vx: o.vx ?? 0, vy: o.vy ?? 0, vz: o.vz ?? 0,
      t: 0, life: o.life ?? 0.8, s0: o.s0 ?? 0.1, s1: o.s1 ?? o.s0 ?? 0.1,
      c: o.c ?? [1, 1, 1], a: o.a ?? 0.6, add: !!o.add, grav: o.grav ?? 0, drag: o.drag ?? 2,
    });
  }
  const unit = c => rgbOf(c).map(v => v / 255);
  function dust(x, z, col, n, k = 1) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, sp = (0.3 + rnd() * 0.8) * k;
      puff(x, 0.03, z, { vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: (0.3 + rnd() * 0.7) * k, s0: 0.07 * k, s1: 0.32 * k, life: 0.7 + rnd() * 0.6, c: col, a: 0.55, drag: 3.2, grav: -0.4 });
    }
  }

  // ---------- the ball's trail ----------
  const trail = new Float32Array(TRAIL * 3);
  let tN = 0, tHead = 0, lastLive = false;
  const feet = [0, 0];

  function onBounce(e, s) {
    const x = e.x ?? s?.ball?.x ?? 0, z = e.z ?? s?.ball?.z ?? 0;
    const surf = e.surface ?? look?.surface ?? 'hard';
    const b = s?.ball, along = b ? Math.atan2(b.vz, b.vx) : 0, sp = b ? Math.hypot(b.vx, b.vz) : 10;
    const onLine = lineDistance(x, z) <= C.ballR * 1.25 && Math.abs(x) < C.double + 0.2 && Math.abs(z) < C.base + 0.2;
    if (surf === 'clay') {
      const g = colourAt(x, z);
      mark(x, z, along, 0.05 + Math.min(0.12, sp * 0.004), 0.032, mix(g, shade(g, 0.72), 0.75));
      dust(x, z, unit(shade(g, 1.15)), onLine ? 6 : 3, 0.8);
    } else if (surf === 'grass') {
      dust(x, z, [0.55, 0.62, 0.4], 1, 0.5);
    }
    if (onLine) {
      // the chalk (or the paint's dust) jumps where the ball clipped the line
      const chalk = surf === 'grass' ? 1 : surf === 'clay' ? 0.6 : 0.35;
      for (let i = 0; i < Math.round(10 * chalk); i++) {
        const a = rnd() * Math.PI * 2, v = 0.4 + rnd() * 1.1;
        puff(x, 0.02, z, { vx: Math.cos(a) * v + (b?.vx ?? 0) * 0.04, vz: Math.sin(a) * v + (b?.vz ?? 0) * 0.04, vy: 0.6 + rnd() * 1.4, s0: 0.06, s1: 0.3, life: 0.6 + rnd() * 0.5, c: [0.97, 0.97, 0.95], a: 0.75 * chalk + 0.15, drag: 3.5, grav: -1.2 });
      }
    }
  }
  function onStep(e, s) {
    const p = s?.players?.[e.player];
    if (!p || look?.surface !== 'clay') return;
    const sp = Math.hypot(p.vx ?? 0, p.vz ?? 0);
    const dir = sp > 0.3 ? Math.atan2(p.vz, p.vx) : Math.atan2(-Math.cos(p.yaw ?? 0), -Math.sin(p.yaw ?? 0));
    feet[e.player] ^= 1;
    const side = feet[e.player] ? 1 : -1, ox = -Math.sin(dir) * 0.12 * side, oz = Math.cos(dir) * 0.12 * side;
    const g = colourAt(p.x, p.z);
    mark(p.x + ox, p.z + oz, dir, sp > 5 ? 0.2 : 0.14, 0.055, mix(g, shade(g, 0.8), 0.6));
    if (sp > 4.5) dust(p.x + ox, p.z + oz, unit(shade(g, 1.12)), 1, 0.7);
  }

  return {
    get marks() {
      return mCount;
    },
    get particles() {
      return parts.length;
    },
    /** the venue's look and ground colour, for marks and dust */
    venue(L, at) {
      look = L;
      colourAt = at;
    },
    /** a new match or a new venue: clear everything */
    reset() {
      parts.length = 0;
      mCount = 0;
      mNext = 0;
      tN = 0;
    },
    /** a flash and a few motes at the racket's strings */
    hit(p, power = 0.5) {
      puff(p[0], p[1], p[2], { s0: 0.12 + power * 0.1, s1: 0.32, life: 0.14, c: [1, 1, 0.85], add: true, a: 1 });
    },
    /** this sim step's events */
    events(list, match) {
      const s = match?.s;
      for (const e of list ?? []) {
        switch (e.type) {
          case 'bounce':
            onBounce(e, s);
            break;
          case 'step':
            onStep(e, s);
            break;
          case 'net':
            if (e.cord && s?.ball) {
              const x = s.ball.x;
              for (let i = 0; i < 4; i++) puff(x, cordY(x), 0, { vx: (rnd() - 0.5) * 0.6, vy: 0.3 + rnd() * 0.4, vz: (rnd() - 0.5) * 0.6, s0: 0.04, s1: 0.16, life: 0.5, c: [0.95, 0.95, 0.92], a: 0.5 });
            }
            break;
        }
      }
      // the particles move with the sim
      for (const q of parts) {
        q.t += DT;
        const k = Math.exp(-q.drag * DT);
        q.vx *= k;
        q.vz *= k;
        q.vy = q.vy * k + q.grav * DT;
        q.x += q.vx * DT;
        q.y = Math.max(0.01, q.y + q.vy * DT);
        q.z += q.vz * DT;
      }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].t >= parts[i].life) parts.splice(i, 1);
      // the ball's last positions
      const b = s?.ball;
      if (b && b.live && !b.inHand) {
        if (!lastLive) tN = 0;
        trail[tHead * 3] = b.x;
        trail[tHead * 3 + 1] = b.y;
        trail[tHead * 3 + 2] = b.z;
        tHead = (tHead + 1) % TRAIL;
        tN = Math.min(TRAIL, tN + 1);
        lastLive = true;
      } else {
        lastLive = false;
        tN = 0;
      }
    },
    drawMarks() {
      if (!mCount) return;
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-3, -10);
      R.drawStatic(mbuf, 0, mCount * MARK_VERTS);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    },
    /** particles and the trail (scale: how much larger the ball is drawn) */
    drawPoints(ball, scale = 1) {
      let n = 0;
      const put = (x, y, z, size, r, g, b, a) => {
        const o = n * 8;
        pdata[o] = x;
        pdata[o + 1] = y;
        pdata[o + 2] = z;
        pdata[o + 3] = size;
        pdata[o + 4] = r;
        pdata[o + 5] = g;
        pdata[o + 6] = b;
        pdata[o + 7] = a;
        n++;
      };
      if (ball && tN > 2 && Math.hypot(ball.vx, ball.vy, ball.vz) > 7) {
        for (let k = 1; k < tN; k++) {
          const i = (tHead - 1 - k + TRAIL * 2) % TRAIL, f = 1 - k / tN, a = 0.32 * f;
          put(trail[i * 3], trail[i * 3 + 1], trail[i * 3 + 2], C.ballR * 2.1 * scale * (0.45 + 0.55 * f), 0.86 * a, 0.92 * a, 0.3 * a, a);
        }
      }
      for (const q of parts) {
        const k = q.t / q.life, size = q.s0 + (q.s1 - q.s0) * k;
        if (q.add) {
          const i = (1 - k) * (1 - k);
          put(q.x, q.y, q.z, size, q.c[0] * i, q.c[1] * i, q.c[2] * i, 0);
        } else {
          const a = q.a * (1 - k) * Math.min(1, q.t * 12);
          put(q.x, q.y, q.z, size, q.c[0] * a, q.c[1] * a, q.c[2] * a, a);
        }
      }
      if (n) R.drawPoints(pdata, n);
    },
    destroy() {
      mbuf.destroy();
    },
  };
}
