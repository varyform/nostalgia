// A small WebGL2 renderer: flat-shaded triangles with per-face normals lit by one sun (ambient
// plus diffuse, a glint on water), exponential fog into the sky's horizon, a gradient sky with
// a sun, and soft round points for every particle. Static geometry lives in big buffers drawn
// a chunk at a time; moving things share one buffer of meshes drawn with a model matrix.
//
//   const R = createGL(canvas, { antialias });     // null without WebGL2
//   R.frame(cam, sky);                              // clear, sky; cam: { eye, f, u, fov, near, far }
//   R.drawStatic(buf, first, count);  R.drawMesh(range, model, tint);  R.drawPoints(data, n);
//
// Vertex layout (20 bytes): position f32 × 3, normal i8 × 4 (normalised), colour u8 × 4; the
// colour's alpha is 255 for lit surfaces, 128 for water, 0 for things that glow.
const VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol;
uniform mat4 uVP, uM; uniform vec3 uEye, uSun, uTint; uniform float uAmb;
out vec3 vCol; out vec3 vRel; out float vKind; out vec3 vN;
void main() {
  vec4 w = uM * vec4(aPos, 1.0);
  vec3 n = normalize(mat3(uM) * aNor);
  float lit = uAmb + (1.0 - uAmb) * max(dot(n, uSun), 0.0) + 0.12 * max(-dot(n, uSun), 0.0) * 0.5;
  vKind = aCol.a;
  vCol = aCol.a < 0.25 ? aCol.rgb * uTint : aCol.rgb * lit * uTint;
  vN = n;
  vRel = w.xyz - uEye;
  gl_Position = uVP * w;
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vCol; in vec3 vRel; in float vKind; in vec3 vN;
uniform vec3 uFog, uSun, uSunCol; uniform float uDensity;
out vec4 o;
void main() {
  vec3 c = vCol;
  float d = length(vRel);
  vec3 v = vRel / d;
  if (vKind > 0.3 && vKind < 0.7) {
    // water: a sun glint and a brighter sheen toward the horizon
    vec3 r = reflect(v, vec3(0.0, 1.0, 0.0));
    c += uSunCol * pow(max(dot(r, uSun), 0.0), 180.0) * 0.9;
    c = mix(c, uFog, pow(1.0 - abs(v.y), 6.0) * 0.45);
  }
  float f = 1.0 - exp(-pow(d * uDensity, 1.6));
  o = vec4(mix(c, uFog, f), 1.0);
}`;
const SKY_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vP;
void main() { vP = P[gl_VertexID]; gl_Position = vec4(vP, 0.999, 1.0); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vP;
uniform mat4 uInv; uniform vec3 uZen, uHor, uHaze, uSun, uSunCol;
out vec4 o;
void main() {
  vec4 a = uInv * vec4(vP, 1.0, 1.0);
  vec3 d = normalize(a.xyz / a.w);
  float h = max(d.y, 0.0);
  vec3 c = mix(uHor, uZen, pow(h, 0.55));
  c = mix(c, uHaze, pow(1.0 - h, 10.0) * 0.6);
  if (d.y < 0.0) c = mix(uHor, uHaze * 0.92, min(1.0, -d.y * 3.0));
  float s = max(dot(d, uSun), 0.0);
  c += uSunCol * (pow(s, 1400.0) * 2.5 + pow(s, 24.0) * 0.22 + pow(s, 4.0) * 0.06);
  o = vec4(c, 1.0);
}`;
const PT_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in float aSize; layout(location=2) in vec4 aCol;
uniform mat4 uVP; uniform vec3 uEye; uniform float uFocal, uMaxPt;
out vec4 vCol; out float vFog;
uniform float uDensity;
void main() {
  gl_Position = uVP * vec4(aPos, 1.0);
  float d = length(aPos - uEye);
  gl_PointSize = clamp(aSize * uFocal / max(d, 1.0), 1.5, uMaxPt);
  vFog = 1.0 - exp(-pow(d * uDensity, 1.6));
  vCol = aCol;
}`;
const PT_FS = `#version 300 es
precision mediump float;
in vec4 vCol; in float vFog;
uniform vec3 uFog;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - r);
  // premultiplied: alpha 0 adds light (fire), alpha 1 covers (smoke)
  vec3 c = mix(vCol.rgb, uFog * vCol.a, vFog);
  o = vec4(c * a * (1.0 - vFog * (1.0 - vCol.a)), vCol.a * a * (1.0 - vFog * 0.6));
}`;

export const hexRGB = h => {
  if (h.startsWith('rgb')) { const m = h.match(/[\d.]+/g).map(Number); return [m[0] / 255, m[1] / 255, m[2] / 255]; }
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// ---------- matrices (column-major) ----------
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
export function viewOf(e, f, u) {
  const r = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -d(r, e), -d(u, e), d(f, e), 1]);
}
/** a model matrix: mesh x → right, y → up, z → back, scaled by s, at p */
export function modelOf(p, f, u, s = 1, out = new Float32Array(16)) {
  const r = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
  out[0] = r[0] * s; out[1] = r[1] * s; out[2] = r[2] * s; out[3] = 0;
  out[4] = u[0] * s; out[5] = u[1] * s; out[6] = u[2] * s; out[7] = 0;
  out[8] = -f[0] * s; out[9] = -f[1] * s; out[10] = -f[2] * s; out[11] = 0;
  out[12] = p[0]; out[13] = p[1]; out[14] = p[2]; out[15] = 1;
  return out;
}
export function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
export function invert4(m) {
  const a = m, o = new Float32Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
  const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
  const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
  o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
  o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
  o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
  o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return o;
}
/** the six frustum planes of a view-projection, each [nx, ny, nz, d] (inside: n·p + d > 0) */
export function planes(m) {
  const row = i => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3), out = [];
  for (const [s, r] of [[1, r0], [-1, r0], [1, r1], [-1, r1], [1, r2], [-1, r2]]) {
    const p = [r3[0] + s * r[0], r3[1] + s * r[1], r3[2] + s * r[2], r3[3] + s * r[3]], l = Math.hypot(p[0], p[1], p[2]);
    out.push(p.map(v => v / l));
  }
  return out;
}

export function createGL(cv, { antialias = true } = {}) {
  const gl = cv.getContext('webgl2', { antialias, alpha: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) return null;
  function program(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  const mesh = program(VS, FS), sky = program(SKY_VS, SKY_FS), pts = program(PT_VS, PT_FS);
  const maxPt = Math.min(256, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]);
  const skyVao = gl.createVertexArray();

  /** a static buffer of interleaved vertices (ArrayBuffer, 20 bytes each) */
  function buffer(data) {
    const vao = gl.createVertexArray(), vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 20, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 20, 16);
    gl.bindVertexArray(null);
    return { vao, vbo, destroy() { gl.deleteBuffer(vbo); gl.deleteVertexArray(vao); } };
  }
  // the particle buffer: position, size, colour (premultiplied rgba) as floats
  const ptVao = gl.createVertexArray(), ptVbo = gl.createBuffer();
  gl.bindVertexArray(ptVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, ptVbo);
  gl.bufferData(gl.ARRAY_BUFFER, 4096 * 32, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
  gl.bindVertexArray(null);
  let ptCap = 4096;

  const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const state = { vp: null, view: null, proj: null, eye: [0, 0, 0], focal: 1, planes: [], sky: null };
  let fogCol = [1, 1, 1], density = 1e-4;

  function frame(cam, S) {
    const w = cv.width, h = cv.height;
    gl.viewport(0, 0, w, h);
    const proj = perspective(cam.fov, w / h, cam.near, cam.far), view = viewOf(cam.eye, cam.f, cam.u);
    const vp = mul4(proj, view);
    state.vp = vp; state.view = view; state.proj = proj; state.eye = cam.eye; state.focal = h / 2 / Math.tan(cam.fov / 2);
    state.planes = planes(vp);
    fogCol = hexRGB(S.horizon); density = S.fog;
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.clearColor(fogCol[0], fogCol[1], fogCol[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // the sky, behind everything
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky.p);
    const rot = viewOf([0, 0, 0], cam.f, cam.u);
    gl.uniformMatrix4fv(sky.u.uInv, false, invert4(mul4(proj, rot)));
    gl.uniform3fv(sky.u.uZen, hexRGB(S.zenith)); gl.uniform3fv(sky.u.uHor, fogCol); gl.uniform3fv(sky.u.uHaze, hexRGB(S.haze));
    gl.uniform3fv(sky.u.uSun, S.sunN); gl.uniform3fv(sky.u.uSunCol, hexRGB(S.sunCol));
    gl.bindVertexArray(skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.useProgram(mesh.p);
    gl.uniformMatrix4fv(mesh.u.uVP, false, vp);
    gl.uniform3fv(mesh.u.uEye, cam.eye); gl.uniform3fv(mesh.u.uSun, S.sunN); gl.uniform1f(mesh.u.uAmb, S.ambient);
    gl.uniform3fv(mesh.u.uFog, fogCol); gl.uniform1f(mesh.u.uDensity, density); gl.uniform3fv(mesh.u.uSunCol, hexRGB(S.sunCol));
    gl.uniformMatrix4fv(mesh.u.uM, false, I); gl.uniform3f(mesh.u.uTint, 1, 1, 1);
    state.sky = S;
  }
  /** is a sphere (centre, radius) inside the view? */
  function visible(c, r) {
    for (const p of state.planes) if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3] < -r) return false;
    return true;
  }
  let bound = null;
  function bind(buf) { if (bound !== buf) { gl.bindVertexArray(buf.vao); bound = buf; } }
  function drawStatic(buf, first, count) {
    bind(buf);
    gl.uniformMatrix4fv(mesh.u.uM, false, I); gl.uniform3f(mesh.u.uTint, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, first, count);
  }
  function drawMesh(buf, range, model, tint = null, cull = true) {
    bind(buf);
    if (cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(mesh.u.uM, false, model);
    if (tint) gl.uniform3fv(mesh.u.uTint, tint); else gl.uniform3f(mesh.u.uTint, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, range[0], range[1]);
    if (!cull) gl.enable(gl.CULL_FACE);
  }
  /** particles: data holds n points of 8 floats (x y z size r g b a, premultiplied) */
  function drawPoints(data, n) {
    if (!n) return;
    bound = null;
    gl.useProgram(pts.p);
    gl.uniformMatrix4fv(pts.u.uVP, false, state.vp); gl.uniform3fv(pts.u.uEye, state.eye);
    gl.uniform1f(pts.u.uFocal, state.focal); gl.uniform1f(pts.u.uMaxPt, maxPt);
    gl.uniform3fv(pts.u.uFog, fogCol); gl.uniform1f(pts.u.uDensity, density);
    gl.bindVertexArray(ptVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ptVbo);
    if (n > ptCap) { ptCap = n * 2; gl.bufferData(gl.ARRAY_BUFFER, ptCap * 32, gl.DYNAMIC_DRAW); }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * 8);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.useProgram(mesh.p);
  }
  return {
    gl, state, buffer, frame, visible, drawStatic, drawMesh, drawPoints,
    lost: () => gl.isContextLost(),
    destroy() { gl.deleteBuffer(ptVbo); gl.deleteVertexArray(ptVao); gl.deleteVertexArray(skyVao); for (const p of [mesh, sky, pts]) gl.deleteProgram(p.p); },
  };
}
