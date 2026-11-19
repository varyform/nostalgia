// The WebGL2 renderer: flat-shaded triangles lit by one sun, fog into the sky's horizon, a
// gradient sky with a sun, soft round points for particles; instanced props, translucent
// meshes, ground shadows, height mist and a thermal view. See index.ts for the API.
import {
  hexRGB,
  invert4,
  mul4,
  perspective,
  planes,
  sphereVisible,
  viewOf,
  type M4,
  type Plane,
  type V3,
} from './math.ts';
import { INSTANCE_FLOATS as INSTANCE } from './instances.ts';
import {
  BLOB_FS,
  BLOB_VS,
  FS,
  INST_FS,
  INST_VS,
  PT_FS,
  PT_VS,
  SHADOW_FS,
  SHADOW_VS,
  SKY_FS,
  SKY_VS,
  VS,
} from './shaders.ts';

/** a camera: eye, unit forward, unit up, vertical fov (radians), clip range */
export interface Camera {
  eye: V3;
  f: V3;
  u: V3;
  fov: number;
  near: number;
  far: number;
}
/** mist lying below `top` (soft over ±40 m), `density` per metre, in `col` (default: the sky's haze) */
export interface Mist {
  top: number;
  density: number;
  col?: string;
}
/** a sky: colours as '#hex' / 'rgb(…)', the unit sun direction, ambient light 0..1, fog density per metre */
export interface Sky {
  zenith: string;
  horizon: string;
  haze: string;
  sunCol: string;
  sunN: V3;
  ambient: number;
  fog: number;
  mist?: Mist | null;
}
/** frame() options: a thermal view; a viewport [x, y, w, h] in canvas pixels from the bottom left (an inset) */
export interface FrameOptions {
  thermal?: boolean | number;
  viewport?: readonly number[] | null;
}
/** a static vertex buffer (20-byte vertices, see mesh.ts) */
export interface Buffer {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  destroy(): void;
}
/** a [first, count] vertex range in a buffer: one mesh */
export type Range = readonly [number, number] | readonly number[];
/** what the last frame() set up */
export interface FrameState {
  vp: M4 | null;
  view: M4 | null;
  proj: M4 | null;
  eye: V3;
  focal: number;
  planes: Plane[];
  sky: Sky | null;
}
/** an instance buffer: 9 floats each (x y z yaw width height r g b), see instances() */
export interface Instances {
  /** instances in it */
  readonly count: number;
  /** replace the data (it may grow) */
  update(data: Float32Array): void;
  destroy(): void;
}
/**
 * drawInstanced() options: the distance range [near, far] from the eye to each instance,
 * dithered out across a `fade`-metre band centred on each edge (two LODs with far = near
 * cross-fade exactly), a colour multiplier, culling, and alpha (< 1: blended, as drawMesh)
 */
export interface InstanceOptions {
  near?: number;
  far?: number;
  fade?: number;
  tint?: V3 | null;
  cull?: boolean;
  alpha?: number;
}
/** what this engine build can do (for games written against a newer one) */
export interface Features {
  instancing: boolean;
  glass: boolean;
  shadow: boolean;
  stencil: boolean;
  blob: boolean;
  mist: boolean;
  thermal: boolean;
  viewport: boolean;
}

export interface GL {
  gl: WebGL2RenderingContext;
  state: FrameState;
  features: Features;
  /** upload interleaved vertices (an ArrayBuffer of 20-byte vertices) */
  buffer(data: ArrayBuffer | ArrayBufferView): Buffer;
  /** clear, draw the sky, set up the camera and the sun for the meshes that follow */
  frame(cam: Camera, sky: Sky, opts?: FrameOptions): void;
  /** is a sphere (centre, radius) inside the view? */
  visible(c: V3, r: number): boolean;
  /** draw part of a static buffer, untransformed */
  drawStatic(buf: Buffer, first: number, count: number): void;
  /**
   * draw one mesh with a model matrix, an optional colour multiplier, back faces culled unless
   * cull is false; alpha < 1 blends it (depth tested, not written): draw those after the opaque
   * ones, far to near, before the points
   */
  drawMesh(buf: Buffer, range: Range, model: M4, tint?: V3 | null, cull?: boolean, alpha?: number): void;
  /** upload instances: 9 floats each, x y z yaw width height r g b (instanceData() packs them) */
  instances(data: Float32Array): Instances;
  /** draw a mesh once per instance in [first, first + count) */
  drawInstanced(buf: Buffer, range: Range, ib: Instances, first?: number, count?: number, opts?: InstanceOptions): void;
  /**
   * a mesh's shadow, flattened along `dir` (toward the light; default the sun) onto the plane
   * [nx, ny, nz, d]: after the opaque draws. With `stencil`, each call darkens a pixel once.
   */
  drawShadow(buf: Buffer, range: Range, model: M4, plane: ArrayLike<number>, alpha?: number, dir?: V3 | null): void;
  /** a soft round shadow of radius r lying on the plane with normal n through c */
  drawBlob(c: V3, r: number, n?: V3, alpha?: number): void;
  /** particles: data holds n points of 8 floats (x y z size r g b a, premultiplied) */
  drawPoints(data: Float32Array, n: number): void;
  /** how hot the following draws look in the thermal view, 0..1 (0: by their brightness) */
  heat(v: number): void;
  /** has the context been lost? (then nothing draws) */
  lost(): boolean;
  /** free the engine's own GL objects; the context is kept for whoever boots on this canvas next */
  destroy(): void;
}

interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  at: number;
}

/**
 * A renderer on a canvas, or null without WebGL2; throws if a shader fails to build. `stencil`
 * asks for a stencil buffer, so overlapping triangles of a drawShadow() darken only once.
 */
export function createGL(
  cv: HTMLCanvasElement,
  { antialias = true, stencil = false }: { antialias?: boolean; stencil?: boolean } = {},
): GL | null {
  const ctx = cv.getContext('webgl2', {
    antialias,
    alpha: false,
    depth: true,
    stencil,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!ctx) return null;
  const gl: WebGL2RenderingContext = ctx;
  const hasStencil = !!gl.getContextAttributes()?.stencil;
  function program(vs: string, fs: string): Program {
    const p = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, vs],
      [gl.FRAGMENT_SHADER, fs],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    for (const s of gl.getAttachedShaders(p) ?? []) gl.deleteShader(s);
    const u: Program['u'] = {},
      n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i)!.name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u, at: -1 };
  }
  const mesh = program(VS, FS),
    sky = program(SKY_VS, SKY_FS),
    pts = program(PT_VS, PT_FS);
  // the others are built on first use: a game that never draws them never pays for them
  let inst: Program | null = null,
    shadow: Program | null = null,
    blob: Program | null = null;
  const maxPt = Math.min(256, (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1]);
  const skyVao = gl.createVertexArray();
  let bound: Buffer | null = null,
    cur: Program | null = null;

  function attribs() {
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.BYTE, true, 20, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 20, 16);
  }
  function buffer(data: ArrayBuffer | ArrayBufferView): Buffer {
    const vao = gl.createVertexArray(),
      vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    attribs();
    gl.bindVertexArray(null);
    bound = null;
    return {
      vao,
      vbo,
      destroy() {
        gl.deleteBuffer(vbo);
        gl.deleteVertexArray(vao);
        if (bound?.vao === vao) bound = null;
      },
    };
  }
  // the particle buffer: position, size, colour (premultiplied rgba) as floats
  const ptVao = gl.createVertexArray(),
    ptVbo = gl.createBuffer();
  gl.bindVertexArray(ptVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, ptVbo);
  gl.bufferData(gl.ARRAY_BUFFER, 4096 * 32, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
  gl.bindVertexArray(null);
  let ptCap = 4096;
  // the blob: a disc of two rings, solid inside 0.45 r, fading to the rim
  let blobVao: WebGLVertexArrayObject | null = null,
    blobVbo: WebGLBuffer | null = null,
    blobN = 0;

  const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const state: FrameState = { vp: null, view: null, proj: null, eye: [0, 0, 0], focal: 1, planes: [], sky: null };
  let fogCol = [1, 1, 1],
    density = 1e-4,
    frameNo = 0,
    thermal = 0,
    heatV = 0,
    sunCol = [1, 1, 1],
    stencilRef = 0;
  let mist = [0, 0, 0, 0],
    mistCol = [1, 1, 1],
    eye: V3 = [0, 0, 0],
    sun: V3 = [0, 1, 0],
    amb = 0.5;

  /** make p current, with this frame's camera, sun, fog, mist and thermal uniforms */
  function use(p: Program) {
    if (cur !== p) {
      gl.useProgram(p.p);
      cur = p;
    }
    if (p.at === frameNo) return;
    p.at = frameNo;
    const u = p.u;
    if (u.uVP) gl.uniformMatrix4fv(u.uVP, false, state.vp!);
    if (u.uEye) gl.uniform3fv(u.uEye, eye as Float32List);
    if (u.uSun) gl.uniform3fv(u.uSun, sun as Float32List);
    if (u.uAmb) gl.uniform1f(u.uAmb, amb);
    if (u.uFog) gl.uniform3fv(u.uFog, fogCol);
    if (u.uDensity) gl.uniform1f(u.uDensity, density);
    if (u.uSunCol) gl.uniform3fv(u.uSunCol, sunCol);
    if (u.uMist) gl.uniform4fv(u.uMist, mist);
    if (u.uMistCol) gl.uniform3fv(u.uMistCol, mistCol);
    if (u.uThermal) gl.uniform1f(u.uThermal, thermal);
    if (u.uHeat) gl.uniform1f(u.uHeat, heatV);
    if (u.uAlpha) gl.uniform1f(u.uAlpha, 1);
  }

  function frame(cam: Camera, S: Sky, opts: FrameOptions = {}) {
    frameNo++;
    const vpt = opts.viewport;
    const x = vpt ? vpt[0] : 0,
      y = vpt ? vpt[1] : 0,
      w = vpt ? vpt[2] : cv.width,
      h = vpt ? vpt[3] : cv.height;
    gl.viewport(x, y, w, h);
    if (vpt) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(x, y, w, h);
    } else gl.disable(gl.SCISSOR_TEST);
    const proj = perspective(cam.fov, w / h, cam.near, cam.far),
      view = viewOf(cam.eye, cam.f, cam.u);
    const vp = mul4(proj, view);
    state.vp = vp;
    state.view = view;
    state.proj = proj;
    state.eye = cam.eye;
    state.focal = h / 2 / Math.tan(cam.fov / 2);
    state.planes = planes(vp);
    fogCol = hexRGB(S.horizon);
    density = S.fog;
    sunCol = hexRGB(S.sunCol);
    thermal = opts.thermal ? 1 : 0;
    heatV = 0;
    stencilRef = 0;
    const M = S.mist;
    mist = M ? [M.top, M.density, 1, 0] : [0, 0, 0, 0];
    mistCol = hexRGB(M?.col ?? S.haze);
    eye = cam.eye;
    sun = S.sunN;
    amb = S.ambient;
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | (hasStencil ? gl.STENCIL_BUFFER_BIT : 0));
    // the sky, behind everything
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky.p);
    cur = sky;
    const rot = viewOf([0, 0, 0], cam.f, cam.u);
    gl.uniformMatrix4fv(sky.u.uInv, false, invert4(mul4(proj, rot)));
    gl.uniform3fv(sky.u.uZen, hexRGB(S.zenith));
    gl.uniform3fv(sky.u.uHor, fogCol);
    gl.uniform3fv(sky.u.uHaze, hexRGB(S.haze));
    gl.uniform3fv(sky.u.uSun, S.sunN as Float32List);
    gl.uniform3fv(sky.u.uSunCol, sunCol);
    gl.uniform1f(sky.u.uThermal, thermal);
    gl.bindVertexArray(skyVao);
    bound = null;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    use(mesh);
    gl.uniformMatrix4fv(mesh.u.uM, false, I);
    gl.uniform3f(mesh.u.uTint, 1, 1, 1);
    state.sky = S;
  }
  const visible = (c: V3, r: number) => sphereVisible(state.planes, c, r);
  function bind(buf: Buffer) {
    if (bound !== buf) {
      gl.bindVertexArray(buf.vao);
      bound = buf;
    }
  }
  function drawStatic(buf: Buffer, first: number, count: number) {
    if (cur !== mesh) use(mesh);
    bind(buf);
    gl.uniformMatrix4fv(mesh.u.uM, false, I);
    gl.uniform3f(mesh.u.uTint, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, first, count);
  }
  /** blending on for alpha < 1 (depth tested, not written); returns whether it was */
  function blend(p: Program, alpha: number) {
    if (!(alpha < 1)) return false;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(p.u.uAlpha, Math.max(0, alpha));
    return true;
  }
  function unblend(p: Program) {
    gl.uniform1f(p.u.uAlpha, 1);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
  function drawMesh(buf: Buffer, range: Range, model: M4, tint: V3 | null = null, cull = true, alpha = 1) {
    if (cur !== mesh) use(mesh);
    bind(buf);
    if (cull) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(mesh.u.uM, false, model);
    if (tint) gl.uniform3fv(mesh.u.uTint, tint as Float32List);
    else gl.uniform3f(mesh.u.uTint, 1, 1, 1);
    const b = blend(mesh, alpha);
    gl.drawArrays(gl.TRIANGLES, range[0], range[1]);
    if (b) unblend(mesh);
    if (!cull) gl.enable(gl.CULL_FACE);
  }

  // ---------- instances ----------
  interface InstanceBuffer extends Instances {
    vbo: WebGLBuffer;
    cap: number;
    vaos: Map<Buffer, { vao: WebGLVertexArrayObject; first: number }>;
  }
  const owned = new Set<InstanceBuffer>();
  function pointAt(first: number) {
    const S = INSTANCE * 4,
      o = first * S;
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, S, o);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, S, o + 16);
    gl.vertexAttribPointer(5, 3, gl.FLOAT, false, S, o + 24);
  }
  function instances(data: Float32Array): Instances {
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    let count = Math.floor(data.length / INSTANCE);
    const ib: InstanceBuffer = {
      vbo,
      cap: data.length,
      vaos: new Map(),
      get count() {
        return count;
      },
      update(d) {
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        if (d.length > ib.cap) {
          ib.cap = d.length;
          gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW);
        } else gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
        count = Math.floor(d.length / INSTANCE);
      },
      destroy() {
        if (!owned.has(ib)) return;
        gl.deleteBuffer(vbo);
        for (const v of ib.vaos.values()) gl.deleteVertexArray(v.vao);
        ib.vaos.clear();
        owned.delete(ib);
        bound = null;
      },
    };
    owned.add(ib);
    return ib;
  }
  function drawInstanced(
    buf: Buffer,
    range: Range,
    ibx: Instances,
    first = 0,
    count = ibx.count - first,
    o: InstanceOptions = {},
  ) {
    const ib = ibx as InstanceBuffer;
    if (count <= 0 || !range[1]) return;
    inst ??= program(INST_VS, INST_FS);
    use(inst);
    let v = ib.vaos.get(buf);
    if (!v) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
      attribs();
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.vbo);
      for (const k of [3, 4, 5]) {
        gl.enableVertexAttribArray(k);
        gl.vertexAttribDivisor(k, 1);
      }
      pointAt(first);
      v = { vao, first };
      ib.vaos.set(buf, v);
    } else {
      gl.bindVertexArray(v.vao);
      if (v.first !== first) {
        gl.bindBuffer(gl.ARRAY_BUFFER, ib.vbo);
        pointAt(first);
        v.first = first;
      }
    }
    bound = null;
    const u = inst.u,
      cull = o.cull ?? true;
    gl.uniform4f(u.uFade, o.near ?? -1e9, o.far ?? 1e9, o.fade ?? 0, 0);
    if (o.tint) gl.uniform3fv(u.uTint, o.tint as Float32List);
    else gl.uniform3f(u.uTint, 1, 1, 1);
    if (!cull) gl.disable(gl.CULL_FACE);
    const b = blend(inst, o.alpha ?? 1);
    gl.drawArraysInstanced(gl.TRIANGLES, range[0], range[1], count);
    if (b) unblend(inst);
    if (!cull) gl.enable(gl.CULL_FACE);
  }

  // ---------- shadows ----------
  function shade(p: Program, alpha: number) {
    gl.uniform1f(p.u.uAlpha, alpha);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -8);
  }
  function unshade() {
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
  }
  function drawShadow(
    buf: Buffer,
    range: Range,
    model: M4,
    plane: ArrayLike<number>,
    alpha = 0.45,
    dir: V3 | null = null,
  ) {
    shadow ??= program(SHADOW_VS, SHADOW_FS);
    use(shadow);
    bind(buf);
    const d = dir ?? sun,
      L = Math.hypot(d[0], d[1], d[2]) || 1;
    gl.uniformMatrix4fv(shadow.u.uM, false, model);
    gl.uniform4f(shadow.u.uPlane, plane[0], plane[1], plane[2], plane[3]);
    gl.uniform3f(shadow.u.uDir, d[0] / L, d[1] / L, d[2] / L);
    shade(shadow, alpha);
    if (hasStencil) {
      // a pixel darkens once per call, however many of the mesh's triangles cover it
      if (++stencilRef > 255) {
        gl.clearStencil(0);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        stencilRef = 1;
      }
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.NOTEQUAL, stencilRef, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    }
    gl.drawArrays(gl.TRIANGLES, range[0], range[1]);
    if (hasStencil) gl.disable(gl.STENCIL_TEST);
    unshade();
  }
  function drawBlob(c: V3, r: number, n: V3 = [0, 1, 0], alpha = 0.5) {
    blob ??= program(BLOB_VS, BLOB_FS);
    use(blob);
    if (!blobVao) {
      const v = blobDisc(24);
      blobN = v.length / 3;
      blobVao = gl.createVertexArray();
      blobVbo = gl.createBuffer();
      gl.bindVertexArray(blobVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, blobVbo);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    } else gl.bindVertexArray(blobVao);
    bound = null;
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    gl.uniform3f(blob.u.uC, c[0], c[1], c[2]);
    gl.uniform3f(blob.u.uN, n[0] / L, n[1] / L, n[2] / L);
    gl.uniform1f(blob.u.uR, r);
    shade(blob, alpha);
    gl.drawArrays(gl.TRIANGLES, 0, blobN);
    unshade();
  }

  function drawPoints(data: Float32Array, n: number) {
    if (!n) return;
    bound = null;
    use(pts);
    gl.uniformMatrix4fv(pts.u.uVP, false, state.vp!);
    gl.uniform3fv(pts.u.uEye, state.eye as Float32List);
    gl.uniform1f(pts.u.uFocal, state.focal);
    gl.uniform1f(pts.u.uMaxPt, maxPt);
    gl.uniform3fv(pts.u.uFog, fogCol);
    gl.uniform1f(pts.u.uDensity, density);
    gl.bindVertexArray(ptVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ptVbo);
    if (n > ptCap) {
      ptCap = n * 2;
      gl.bufferData(gl.ARRAY_BUFFER, ptCap * 32, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 8);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    use(mesh);
  }
  function heat(v: number) {
    heatV = v;
    for (const p of [mesh, inst])
      if (p && p.at === frameNo) {
        use(p);
        gl.uniform1f(p.u.uHeat, v);
      }
    use(mesh);
  }
  const features: Features = {
    instancing: true,
    glass: true,
    shadow: true,
    stencil: hasStencil,
    blob: true,
    mist: true,
    thermal: true,
    viewport: true,
  };
  return {
    gl,
    state,
    features,
    buffer,
    frame,
    visible,
    drawStatic,
    drawMesh,
    instances,
    drawInstanced,
    drawShadow,
    drawBlob,
    drawPoints,
    heat,
    lost: () => gl.isContextLost(),
    destroy() {
      gl.deleteBuffer(ptVbo);
      gl.deleteVertexArray(ptVao);
      gl.deleteVertexArray(skyVao);
      gl.deleteBuffer(blobVbo);
      gl.deleteVertexArray(blobVao);
      for (const ib of owned) ib.destroy();
      for (const p of [mesh, sky, pts, inst, shadow, blob]) if (p) gl.deleteProgram(p.p);
      gl.bindVertexArray(null);
      gl.useProgram(null);
    },
  };
}

/** the blob's disc: triangles of (x, z on the unit disc, opacity), solid inside 0.45, fading to the rim */
export function blobDisc(seg = 24): Float32Array {
  const v: number[] = [];
  const at = (k: number, R: number, a: number) => [
    Math.cos((k / seg) * Math.PI * 2) * R,
    Math.sin((k / seg) * Math.PI * 2) * R,
    a,
  ];
  for (let k = 0; k < seg; k++) {
    v.push(0, 0, 1, ...at(k, 0.45, 1), ...at(k + 1, 0.45, 1));
    v.push(...at(k, 0.45, 1), ...at(k, 1, 0), ...at(k + 1, 1, 0));
    v.push(...at(k, 0.45, 1), ...at(k + 1, 1, 0), ...at(k + 1, 0.45, 1));
  }
  return new Float32Array(v);
}
