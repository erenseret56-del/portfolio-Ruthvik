import { skyLookup } from './shaders'

export const groundVertex = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

/**
 * The country the car is driven over, painted on one flat sheet: farmland in strips and blocks, hedges
 * between the fields, and the road map from drive/driveState.ts (the bending of the grid below is the same
 * arithmetic as roadAt() there, and must stay so). Distance takes on the colour of the sky at the horizon.
 */
export const groundFragment = /* glsl */ `
${skyLookup}
uniform vec2 uOrigin; // world position of the scene's origin
uniform float uTime;
varying vec3 vPos;

const float CELL = 640.0;
const float HALF = 4.4;

float hash12(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p))) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 p = vPos.xz + uOrigin;
  vec3 ray = vPos - cameraPosition;
  float dist = length(ray);
  vec3 v = ray / dist;
  // metres of ground under one pixel: what every fine pattern has to fade out against
  float px = max(length(dFdx(p)), length(dFdy(p)));

  // ---- the bent grid (see roadAt) ----
  float a = p.y * 0.0061 + 1.3;
  float b = p.y * 0.0143 + p.x * 0.0037 + 4.1;
  float c = p.x * 0.0057 + 2.2;
  float e = p.x * 0.0131 - p.y * 0.0041 + 0.7;
  vec2 q = p + vec2(60.0 * sin(a) + 30.0 * sin(b), 60.0 * sin(c) + 30.0 * sin(e));
  vec2 gradX = vec2(1.0 + 0.111 * cos(b), 0.366 * cos(a) + 0.429 * cos(b));
  vec2 gradZ = vec2(0.342 * cos(c) + 0.393 * cos(e), 1.0 - 0.123 * cos(e));
  float dx = abs(q.x - CELL * floor(q.x / CELL + 0.5)) / length(gradX);
  float dz = abs(q.y - CELL * floor(q.y / CELL + 0.5)) / length(gradZ);
  float road = min(dx, dz);
  float other = max(dx, dz);
  float along = dx < dz ? q.y : q.x;

  // ---- fields ----
  vec2 block = q / CELL;
  vec2 lot = fract(block) * 3.0;
  vec2 lotId = floor(block) * 3.0 + floor(lot);
  float kind = hash12(lotId + 17.0);
  float turn = hash12(lotId + 91.0);
  vec3 pasture = vec3(0.30, 0.36, 0.13);
  vec3 wheat = vec3(0.47, 0.41, 0.21);
  vec3 earth = vec3(0.29, 0.23, 0.17);
  vec3 crop = vec3(0.19, 0.29, 0.11);
  vec3 field = kind < 0.36 ? pasture : kind < 0.62 ? wheat : kind < 0.78 ? earth : crop;
  field *= 0.86 + 0.28 * hash12(lotId + 5.0);
  // drilled rows, running whichever way that field was worked
  float rows = sin((turn < 0.5 ? q.x : q.y) * (kind < 0.36 ? 0.0 : 1.9));
  field *= 1.0 + 0.1 * rows * (1.0 - smoothstep(0.15, 0.7, px));
  // wear, damp and the grain of the grass, each at its own scale
  float patchy = vnoise(p / 46.0) * 0.6 + vnoise(p / 13.0) * 0.4;
  field *= 0.78 + 0.44 * patchy;
  field *= 1.0 + 0.2 * (vnoise(p * 2.3) - 0.5) * (1.0 - smoothstep(0.08, 0.5, px));
  // close to, it is made of blades and stalks and stones
  field *= 1.0 + 0.3 * (vnoise(p * 8.0) - 0.5) * (1.0 - smoothstep(0.03, 0.2, px));
  field *= 1.0 + 0.34 * (vnoise(vec2(p.x * 31.0, p.y * 27.0)) - 0.5) * (1.0 - smoothstep(0.012, 0.07, px));
  // hedges between fields
  vec2 edge = min(fract(lot), 1.0 - fract(lot)) * (CELL / 3.0);
  float hedge = 1.0 - smoothstep(1.3, 2.1 + px, min(edge.x, edge.y) + 0.9 * (vnoise(p / 3.0) - 0.5));
  field = mix(field, vec3(0.07, 0.11, 0.05), hedge * 0.9);

  // ---- road ----
  float grit = vnoise(p * 5.0);
  float verge = 1.0 - smoothstep(HALF + 0.6, HALF + 3.6 + 2.2 * vnoise(p / 4.0), road);
  vec3 col = mix(field, vec3(0.36, 0.31, 0.22) * (0.8 + 0.4 * grit), verge * 0.85);
  float tarmac = 1.0 - smoothstep(HALF - px, HALF + px, road);
  vec3 asphalt = vec3(0.105, 0.105, 0.115) * (0.82 + 0.3 * vnoise(p / 2.2) + 0.14 * grit * (1.0 - smoothstep(0.05, 0.3, px)));
  asphalt *= 1.0 + 0.35 * (vnoise(p * 38.0) - 0.5) * (1.0 - smoothstep(0.01, 0.06, px));
  // where the wheels run it is worn smoother and darker
  asphalt *= 1.0 - 0.16 * exp(-pow((abs(road - 2.2) - 0.9) / 0.5, 2.0));
  // paint: a broken centre line and a solid one down each edge, none of it across a junction
  float junction = 1.0 - smoothstep(HALF + 1.0, HALF + 10.0, other);
  float lineFade = (1.0 - junction) * (1.0 - smoothstep(0.35, 1.3, px));
  float w = 0.075 + 0.5 * px;
  float dash = smoothstep(0.0, 0.03, abs(fract(along / 12.0) - 0.5) - 0.2);
  float centre = (1.0 - smoothstep(w, w + px, road)) * dash;
  float side = 1.0 - smoothstep(w, w + px, abs(road - (HALF - 0.55)));
  asphalt = mix(asphalt, vec3(0.78, 0.74, 0.62), max(centre, side) * lineFade * (0.75 + 0.25 * grit));

  // a low sun on tarmac: the sky comes back off it at a shallow angle, and the sun itself as a long streak
  vec3 mirror = vec3(v.x, -v.y, v.z);
  float shallow = pow(1.0 - clamp(-v.y, 0.0, 1.0), 5.0);
  vec3 sheen = horizonColor(atan(mirror.x, -mirror.z)) * shallow * 0.5;
  float toSun = max(dot(mirror, uSunDir), 0.0);
  sheen += vec3(1.0, 0.72, 0.42) * (pow(toSun, 220.0) * 1.1 + pow(toSun, 24.0) * 0.22) * shallow;
  col = mix(col, asphalt + sheen, tarmac);

  // ---- light ----
  // slow cloud shadow drifting over the land, and the warmth of the hour
  float cloud = smoothstep(0.3, 0.7, vnoise(p / 520.0 + uTime * 0.006) * 0.6 + vnoise(p / 190.0 - uTime * 0.004) * 0.4);
  col *= mix(vec3(0.58, 0.62, 0.76), vec3(1.06, 0.97, 0.84), cloud);
  // grass and crops glow when the sun is behind them
  float against = pow(max(dot(v, uSunDir), 0.0), 3.0);
  col += field * vec3(1.0, 0.7, 0.35) * against * 0.3 * (1.0 - tarmac);

  // ---- distance ----
  float haze = 1.0 - exp(-dist / 2100.0);
  haze = max(haze, smoothstep(3800.0, 5600.0, dist));
  col = mix(col, horizonColor(atan(v.x, -v.z)) * 0.96, haze);

  gl_FragColor = vec4(col, 1.0);
}
`

export const hillsVertex = /* glsl */ `
uniform float uRadius;
uniform float uHeight;
uniform float uSeed;
varying float vUp;
varying vec3 vDir;
void main() {
  float a = atan(position.x, position.z);
  // a skyline built from a few folded waves: ridges, shoulders and the odd notch
  float ridge = 0.34 + 0.3 * abs(sin(a * 3.0 + uSeed)) + 0.22 * abs(sin(a * 7.3 + 0.4 + uSeed * 2.0))
    + 0.1 * abs(sin(a * 17.1 + 2.0 * uSeed)) + 0.04 * sin(a * 41.0 + uSeed);
  vUp = uv.y;
  vec3 p = vec3(sin(a) * uRadius, uv.y * ridge * uHeight, cos(a) * uRadius);
  vDir = p;
  // rides with the camera: far enough off that it should not be seen to move
  gl_Position = projectionMatrix * viewMatrix * vec4(p + vec3(cameraPosition.x, 0.0, cameraPosition.z), 1.0);
}
`

export const hillsFragment = /* glsl */ `
${skyLookup}
uniform vec3 uTint;
uniform float uHaze;
varying float vUp;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 air = horizonColor(atan(d.x, -d.z));
  // thicker air at the foot than at the crest, and the side toward the sun burns out into it
  float veil = uHaze + (1.0 - uHaze) * 0.5 * (1.0 - vUp);
  veil = mix(veil, 1.0, 0.35 * pow(max(dot(d, uSunDir), 0.0), 6.0));
  gl_FragColor = vec4(mix(uTint, air * 0.96, veil), 1.0);
}
`

export const beamVertex = /* glsl */ `
uniform vec3 uBase;
uniform float uHeight;
varying vec2 vUv;
void main() {
  vUv = uv;
  // upright sheet that always turns to face the camera, never thinner than a couple of pixels
  vec3 toCam = cameraPosition - uBase;
  toCam.y = 0.0;
  float dist = length(toCam);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  float width = max(5.0, dist * 0.008);
  vec3 p = uBase + vec3(0.0, uv.y * uHeight, 0.0) + right * (uv.x - 0.5) * width;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

export const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float across = exp(-x * x * 26.0) + exp(-x * x * 4.0) * 0.22;
  float along = smoothstep(0.0, 0.03, vUv.y) * pow(1.0 - vUv.y, 1.7);
  gl_FragColor = vec4(uColor * across * along * uOpacity, 1.0);
}
`

export const propVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** A propeller at speed: not four blades but a grey disc, a little denser where the blades are, yellow at the tips. */
export const propFragment = /* glsl */ `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  float theta = atan(c.y, c.x);
  float body = smoothstep(0.16, 0.24, r) * (1.0 - smoothstep(0.94, 1.0, r));
  float blades = pow(abs(cos(2.0 * (theta - uTime * 9.0 - uPhase))), 5.0);
  float tip = smoothstep(0.86, 0.9, r) * (1.0 - smoothstep(0.95, 0.99, r));
  vec3 col = mix(vec3(0.06, 0.06, 0.07), vec3(0.85, 0.66, 0.12), tip);
  float alpha = body * (0.12 + 0.16 * blades + 0.09 * tip);
  gl_FragColor = vec4(col, alpha);
}
`
