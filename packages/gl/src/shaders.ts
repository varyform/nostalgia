// GLSL for the engine's programs (see gl.ts).

// shared by the mesh, instance and point shaders: the height mist and the thermal palette
const COMMON = `
uniform vec4 uMist; uniform vec3 uMistCol; uniform float uThermal, uHeat;
// extra fog below uMist.x (soft over ±40 m), uMist.y per metre; uMist.z > 0.5 turns it on
float mistAt(float d, float y) { return (1.0 - exp(-d * uMist.y)) * smoothstep(uMist.x + 40.0, uMist.x - 40.0, y); }
// white-hot thermal: brightness (and heat) → a green-grey ramp
vec3 thermal(float v) { return mix(vec3(0.02, 0.05, 0.035), vec3(0.86, 1.0, 0.84), clamp(v, 0.0, 1.0)); }
vec3 thermalOf(vec3 c, float heat) { return thermal(mix(dot(c, vec3(0.3, 0.59, 0.11)) * 0.55 + 0.06, 1.0, heat)); }`;

export const VS = `#version 300 es
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

/**
 * Instances: the mesh at each instance's position, turned by its yaw about +y (as a part's
 * `yaw`), x and z scaled by its width, y by its height, its colour multiplied by the
 * instance's. uFade = (near, far, band, 0): the instance is dithered out across a band
 * centred on each edge; one wholly outside is moved off screen.
 */
export const INST_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol;
layout(location=3) in vec4 iPos; layout(location=4) in vec2 iSize; layout(location=5) in vec3 iCol;
uniform mat4 uVP; uniform vec3 uEye, uSun, uTint; uniform float uAmb; uniform vec4 uFade;
out vec3 vCol; out vec3 vRel; out float vKind; out vec3 vN; out vec2 vFade;
void main() {
  float cy = cos(iPos.w), sy = sin(iPos.w);
  vec3 p = aPos * vec3(iSize.x, iSize.y, iSize.x);
  vec3 w = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy) + iPos.xyz;
  vec3 m = aNor / vec3(iSize.x, iSize.y, iSize.x);
  vec3 n = normalize(vec3(m.x * cy + m.z * sy, m.y, -m.x * sy + m.z * cy));
  float lit = uAmb + (1.0 - uAmb) * max(dot(n, uSun), 0.0) + 0.12 * max(-dot(n, uSun), 0.0) * 0.5;
  vKind = aCol.a;
  vCol = (aCol.a < 0.25 ? aCol.rgb : aCol.rgb * lit) * iCol * uTint;
  vN = n;
  vRel = w - uEye;
  float d = length(iPos.xyz - uEye), band = max(uFade.z, 0.001);
  vFade = clamp(vec2((d - uFade.x) / band + 0.5, (uFade.y - d) / band + 0.5), 0.0, 1.0);
  gl_Position = vFade.x <= 0.0 || vFade.y <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : uVP * vec4(w, 1.0);
}`;

/** the lit-surface fragment shader; `dither` adds the instances' distance fade */
const surfaceFS = (dither: boolean) => `#version 300 es
precision highp float;
in vec3 vCol; in vec3 vRel; in float vKind; in vec3 vN;${dither ? ' in vec2 vFade;' : ''}
uniform vec3 uFog, uSun, uSunCol, uEye; uniform float uDensity, uAlpha;
out vec4 o;${COMMON}
void main() {${
  dither
    ? `
  float h = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (1.0 - h >= vFade.x || h >= vFade.y) discard;`
    : ''
}
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
  vec3 fog = uFog;
  if (uMist.z > 0.5) c = mix(c, uMistCol, mistAt(d, vRel.y + uEye.y));
  if (uThermal > 0.5) {
    c = vKind < 0.25 ? thermal(1.0) : thermalOf(c, vKind < 0.7 ? -0.3 : uHeat);
    fog = thermal(0.22);
  }
  o = vec4(mix(c, fog, f), uAlpha);
}`;
export const FS = surfaceFS(false);
export const INST_FS = surfaceFS(true);

/** a mesh flattened along uDir onto a plane (uPlane: n, d), darkening what it covers */
export const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP, uM; uniform vec3 uEye, uDir; uniform vec4 uPlane;
out vec3 vRel;
void main() {
  vec3 w = (uM * vec4(aPos, 1.0)).xyz;
  // along uDir (toward the light) onto the plane; a low light is held to a 5:1 stretch
  float k = max(dot(uPlane.xyz, uDir), 0.2);
  w -= uDir * ((dot(uPlane.xyz, w) + uPlane.w) / k);
  w += uPlane.xyz * 0.06;
  vRel = w - uEye;
  gl_Position = uVP * vec4(w, 1.0);
}`;
export const SHADOW_FS = `#version 300 es
precision highp float;
in vec3 vRel;
uniform float uDensity, uAlpha;
out vec4 o;
void main() {
  float f = 1.0 - exp(-pow(length(vRel) * uDensity, 1.6));
  o = vec4(0.0, 0.0, 0.0, uAlpha * (1.0 - f));
}`;
/** a soft disc on a plane: aPos = (x, z on the unit disc, opacity) */
export const BLOB_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP; uniform vec3 uEye, uC, uN; uniform float uR;
out vec3 vRel; out float vA;
void main() {
  vec3 t = normalize(cross(uN, abs(uN.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0))), b = cross(uN, t);
  vec3 w = uC + (t * aPos.x + b * aPos.y) * uR + uN * 0.08;
  vA = aPos.z;
  vRel = w - uEye;
  gl_Position = uVP * vec4(w, 1.0);
}`;
export const BLOB_FS = `#version 300 es
precision highp float;
in vec3 vRel; in float vA;
uniform float uDensity, uAlpha;
out vec4 o;
void main() {
  float f = 1.0 - exp(-pow(length(vRel) * uDensity, 1.6));
  o = vec4(0.0, 0.0, 0.0, uAlpha * vA * vA * (3.0 - 2.0 * vA) * (1.0 - f));
}`;

export const SKY_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vP;
void main() { vP = P[gl_VertexID]; gl_Position = vec4(vP, 0.999, 1.0); }`;
export const SKY_FS = `#version 300 es
precision highp float;
in vec2 vP;
uniform mat4 uInv; uniform vec3 uZen, uHor, uHaze, uSun, uSunCol; uniform float uThermal;
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
  // thermal: a cold sky, a little warmer at the horizon
  if (uThermal > 0.5) c = mix(vec3(0.02, 0.05, 0.035), vec3(0.86, 1.0, 0.84), 0.22 * (1.0 - h));
  o = vec4(c, 1.0);
}`;
export const PT_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in float aSize; layout(location=2) in vec4 aCol;
uniform mat4 uVP; uniform vec3 uEye; uniform float uFocal, uMaxPt; uniform vec4 uMist;
out vec4 vCol; out float vFog; out float vMist;
uniform float uDensity;
void main() {
  gl_Position = uVP * vec4(aPos, 1.0);
  float d = length(aPos - uEye);
  gl_PointSize = clamp(aSize * uFocal / max(d, 1.0), 1.5, uMaxPt);
  vFog = 1.0 - exp(-pow(d * uDensity, 1.6));
  vMist = uMist.z > 0.5 ? (1.0 - exp(-d * uMist.y)) * smoothstep(uMist.x + 40.0, uMist.x - 40.0, aPos.y) : 0.0;
  vCol = aCol;
}`;
export const PT_FS = `#version 300 es
precision mediump float;
in vec4 vCol; in float vFog; in float vMist;
uniform vec3 uFog, uMistCol; uniform float uThermal;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - r);
  vec4 s = vCol;
  vec3 fog = uFog;
  if (uThermal > 0.5) {
    // fire is white-hot, smoke a little warm
    float l = dot(s.rgb, vec3(0.3, 0.59, 0.11));
    vec3 hot = mix(vec3(0.02, 0.05, 0.035), vec3(0.86, 1.0, 0.84), s.a < 0.05 ? min(1.0, l * 3.0) : 0.35);
    s.rgb = s.a < 0.05 ? hot : hot * s.a;
    fog = mix(vec3(0.02, 0.05, 0.035), vec3(0.86, 1.0, 0.84), 0.22);
  }
  if (vMist > 0.0) { s.rgb = mix(s.rgb, uMistCol * s.a, vMist); a *= 1.0 - vMist * (1.0 - s.a); }
  // premultiplied: alpha 0 adds light (fire), alpha 1 covers (smoke)
  vec3 c = mix(s.rgb, fog * s.a, vFog);
  o = vec4(c * a * (1.0 - vFog * (1.0 - s.a)), s.a * a * (1.0 - vFog * 0.6));
}`;
