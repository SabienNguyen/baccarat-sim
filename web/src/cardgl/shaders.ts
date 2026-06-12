// GLSL for the card mesh. deform() is a line-for-line port of
// curlMath.deform and MUST stay in lockstep with it — change both or
// neither. The TS version carries the unit tests that pin this math.

export const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
uniform vec2 uCard;
uniform vec2 uGrab, uDir, uPerp;
uniform float uApex, uRadius, uTheta;
uniform mat4 uModel, uPV;
uniform float uShadowPass;
out vec2 vUV;
out vec3 vNormal;
out float vShadowAlpha;

const float PI = 3.14159265359;
const float R_MIN = 0.75;

vec3 deform(vec2 p) {
  vec2 d = p - uGrab;
  float du = dot(d, uPerp);
  float dv = dot(d, uDir);
  if (uApex < 1e-3) return vec3(p, 0.0);
  float a = uApex;
  float r = max(uRadius, R_MIN);
  float vt = a + 0.5 * PI * r;
  float s = vt - dv;
  float v2; float z;
  if (s <= 0.0) { v2 = dv; z = 0.0; }
  else if (s < PI * r) {
    float phi = s / r;
    v2 = vt - r * sin(phi);
    z = r * (1.0 - cos(phi));
  } else {
    float e = s - PI * r;
    v2 = vt + e * cos(uTheta);
    z = 2.0 * r + e * sin(uTheta);
  }
  return vec3(uGrab + du * uPerp + v2 * uDir, z);
}

void main() {
  vec3 P = deform(aPos);
  // finite-difference normal: exact in every region, no case analysis
  vec3 Px = deform(aPos + vec2(1.5, 0.0));
  vec3 Py = deform(aPos + vec2(0.0, 1.5));
  vec3 N = normalize(cross(Px - P, Py - P));
  vec4 world = uModel * vec4(P, 1.0);
  vNormal = mat3(uModel) * N;
  vUV = aPos / uCard;
  if (uShadowPass > 0.5) {
    // flatten onto the felt, offset along the light, fade with height
    vec2 sxy = world.xy + vec2(2.0, 3.0) + world.z * vec2(0.18, 0.45);
    vShadowAlpha = mix(0.38, 0.10, clamp(world.z / 50.0, 0.0, 1.0));
    gl_Position = uPV * vec4(sxy, 0.0, 1.0);
  } else {
    vShadowAlpha = 0.0;
    gl_Position = uPV * world;
  }
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vNormal;
in float vShadowAlpha;
uniform sampler2D uTop, uBot;
uniform float uShadowPass;
uniform vec3 uLight;
out vec4 frag;

// the flat card's diffuse term — lighting is normalized against it so an
// unbent card renders at exactly 1.0 and the DOM handoff is seamless
const float FLAT_DIFF = 0.7913;

void main() {
  if (uShadowPass > 0.5) {
    float a = texture(uTop, vUV).a;
    if (a < 0.01) discard;
    frag = vec4(0.0, 0.0, 0.0, a * vShadowAlpha);
    return;
  }
  vec4 tex = gl_FrontFacing
    ? texture(uTop, vUV)
    : texture(uBot, vec2(1.0 - vUV.x, vUV.y)); // the underside, seen mirrored
  if (tex.a < 0.01) discard;
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  float diff = max(dot(n, uLight), 0.0);
  float light = clamp(0.62 + 0.38 * (diff / FLAT_DIFF), 0.0, 1.12);
  // sheen rolling over the crease
  vec3 h = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, h), 0.0), 28.0) * 0.16;
  frag = vec4(tex.rgb * light + vec3(spec), tex.a);
}`;
