/** Full-screen triangle that hands each fragment its world-space view ray. */
export const rayVertex = /* glsl */ `
uniform float uDepth;
varying vec3 vDir;
void main() {
  vec4 v = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vDir = transpose(mat3(viewMatrix)) * (v.xyz / v.w);
  gl_Position = vec4(position.xy, uDepth, 1.0);
}
`

/** Shared lookup into the cropped panorama (uSky) by longitude / latitude. */
const skyLookup = /* glsl */ `
uniform sampler2D uSky;
uniform vec3 uCrop; // lonSpan, latMin, latMax (radians)
uniform vec3 uSunDir;
vec2 skyUV(float lon, float lat) {
  return vec2(lon / uCrop.x + 0.5, (lat - uCrop.y) / (uCrop.z - uCrop.y));
}
// dusk falls off around the sun: full warmth near it, cooler and darker away from it
vec3 skyGrade(vec3 c, vec3 dir) {
  float ang = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
  float nearSun = exp(-ang * ang / 0.075);
  return mix(c * vec3(0.7, 0.75, 0.9), c, nearSun);
}
// blurred colour of the sky just above the horizon: what distant haze fades into
vec3 horizonColor(float lon) {
  vec3 dir = normalize(vec3(sin(lon), 0.026, -cos(lon)));
  return skyGrade(textureLod(uSky, skyUV(lon, 0.026), 5.0).rgb, dir);
}
vec3 belowHorizon(float lon, float lat) {
  vec3 hz = horizonColor(lon);
  vec3 deep = vec3(0.1, 0.115, 0.165);
  return mix(hz, deep, smoothstep(0.0, -0.26, lat) * 0.94);
}
`

export const skyFragment = /* glsl */ `
${skyLookup}
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float lon = atan(d.x, -d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  // explicit gradients, unwrapped across the +-180 degree seam of a full-circle sky, so no mip line shows there
  vec2 uv = skyUV(lon, max(lat, 0.012));
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  gx.x -= floor(gx.x + 0.5);
  gy.x -= floor(gy.x + 0.5);
  vec3 col = skyGrade(textureGrad(uSky, uv, gx, gy).rgb, d);
  col = mix(belowHorizon(lon, lat), col, smoothstep(0.004, 0.024, lat));

  // sun: small hot disc + layered bloom, screened over the photo
  float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
  float disc = smoothstep(0.0105, 0.0058, ang);
  float bloom = exp(-ang * ang / 0.0011) * 0.85 + exp(-ang / 0.065) * 0.42;
  vec3 sun = vec3(1.0, 0.94, 0.82) * disc + vec3(1.0, 0.62, 0.32) * bloom;
  col = 1.0 - (1.0 - col) * (1.0 - clamp(sun, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * Raymarched cumulus deck below the camera. Rendered to a low-res target (premultiplied alpha),
 * lit by a single low sun with a few shadow taps, and faded into the photographic horizon.
 */
export const cloudFragment = /* glsl */ `
precision highp sampler3D;
${skyLookup}
uniform sampler3D uNoise;
uniform vec3 uOffset;
uniform float uSteps;
varying vec3 vDir;

const float Y_TOP = -62.0;
const float Y_BOT = -1100.0;
const float MAX_DIST = 15000.0;

// fine samples sit on shared spherical shells (uniform in log-distance) so neighbouring pixels agree
const float SHELL = 0.028;
float snapToShell(float t, float j) {
  return exp((ceil(log(t) / SHELL) + j * 0.1) * SHELL);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float coverage(vec2 xz) {
  float a = texture(uNoise, vec3(xz / 6100.0, 0.31)).b;
  vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * xz;
  float b = texture(uNoise, vec3(r / 2700.0 + 0.37, 0.72)).b;
  return a * 0.6 + b * 0.4;
}

// x: silhouette inflated by grow (conservative, for skipping clear air). y: true silhouette before erosion.
vec2 silhouette(vec3 p, float grow) {
  float h = (p.y - Y_BOT) / (Y_TOP - Y_BOT);
  if (h <= 0.0 || h >= 1.0) return vec2(0.0);
  vec3 q = p + uOffset;
  float cov = smoothstep(0.38, 0.66, coverage(q.xz));
  // towering cumulus where coverage is high, a low unbroken floor everywhere else
  float top = mix(0.26, 1.0, cov);
  float profile = smoothstep(0.0, 0.06, h) * smoothstep(top, top * 0.5, h);
  float amount = clamp(profile * mix(0.42, 1.0, cov) + smoothstep(0.17, 0.03, h) * 0.6, 0.0, 1.0);
  float base = texture(uNoise, q / 1900.0).r;
  float wide = min(amount + grow, 1.0);
  return vec2(
    clamp((base - (1.0 - wide)) / max(wide, 1e-3), 0.0, 1.0),
    clamp((base - (1.0 - amount)) / max(amount, 1e-3), 0.0, 1.0)
  );
}

// carve billows into the silhouette with higher-frequency noise
float erode(vec3 p, float d) {
  vec3 q = p + uOffset;
  float detail = texture(uNoise, q / 520.0 + vec3(0.0, uOffset.x * 0.00003, 0.0)).g;
  return clamp((d - detail * 0.3 * (1.0 - d * 0.7)) / (1.0 - detail * 0.3), 0.0, 1.0);
}

void main() {
  vec3 rd = normalize(vDir);
  if (rd.y > -0.0015) { gl_FragColor = vec4(0.0); return; }
  float tEnter = max((Y_TOP - cameraPosition.y) / rd.y, 0.0);
  float tExit = min((Y_BOT - cameraPosition.y) / rd.y, MAX_DIST);
  if (tEnter >= tExit) { gl_FragColor = vec4(0.0); return; }

  float lon = atan(rd.x, -rd.z);
  vec3 haze = horizonColor(lon);
  float cosT = dot(rd, uSunDir);
  // forward-scatter lobe gives clouds near the sun their bright rims
  float g = 0.76;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5);
  float phase = 0.42 + min(hg, 9.0) * 0.2;

  vec3 sunCol = vec3(1.0, 0.52, 0.24) * 3.4;
  vec3 ambTop = vec3(0.19, 0.225, 0.345);
  vec3 ambBot = vec3(0.04, 0.05, 0.088);

  float jitter = ign(gl_FragCoord.xy);
  float t = tEnter;
  vec3 sum = vec3(0.0);
  float T = 1.0;
  bool armed = true;
  float fineUntil = -1.0;
  int steps = int(uSteps);
  for (int i = 0; i < 128; i++) {
    if (i >= steps || t > tExit || T < 0.015) break;
    vec3 p = cameraPosition + rd * t;
    float stride = max(22.0, t * 0.065);
    float dt = t * (exp(SHELL) - 1.0);
    bool forced = t < fineUntil;
    vec2 s = silhouette(p, 0.14);
    if (s.x <= 0.0 && !forced) {
      // clear air: take a long stride
      armed = true;
      t += stride;
      continue;
    }
    if (armed && !forced) {
      // first contact: rewind one stride and walk it in fine steps so thin edges are never skipped
      armed = false;
      fineUntil = t;
      t = snapToShell(max(t - stride, max(tEnter, 1.0)), jitter);
      continue;
    }
    float d = s.y > 0.0 ? erode(p, s.y) : 0.0;
    if (d > 0.003) {
      float h = (p.y - Y_BOT) / (Y_TOP - Y_BOT);
      float ld = silhouette(p + uSunDir * 55.0, 0.0).y * 90.0 + silhouette(p + uSunDir * 230.0, 0.0).y * 300.0;
      float shadow = exp(-ld * 0.021);
      float up = silhouette(p + vec3(0.0, 80.0, 0.0), 0.0).y;
      vec3 amb = mix(ambBot, ambTop, smoothstep(0.0, 0.9, h)) * (1.0 - up * 0.6);
      // thin edges scatter more light than dense cores
      float edge = 1.0 - smoothstep(0.0, 0.45, d);
      vec3 lit = sunCol * shadow * phase * (0.55 + 0.75 * edge) + amb;
      lit = 1.0 - exp(-lit * 1.2);
      lit = pow(lit, vec3(0.4545));
      float fog = 1.0 - exp(-max(t - 900.0, 0.0) / 7000.0);
      lit = mix(lit, haze, fog);
      float a = 1.0 - exp(-d * 0.027 * dt);
      sum += T * a * lit;
      T *= 1.0 - a;
    }
    t += dt;
  }
  if (T > 0.015 && t < tExit) {
    // out of steps before reaching the cloud floor: close the ray with shaded haze rather than leave a hole
    float fog = 1.0 - exp(-max(t - 900.0, 0.0) / 7000.0);
    sum += T * mix(vec3(0.27, 0.27, 0.33), haze, fog);
    T = 0.0;
  }
  // the far deck dissolves into haze instead of ending on a hard line
  float far = smoothstep(0.008, 0.04, -rd.y);
  gl_FragColor = vec4(sum, 1.0 - T) * far;
}
`

export const cloudCompositeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`

export const cloudCompositeFragment = /* glsl */ `
uniform sampler2D uClouds;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  // small tent filter hides the ray-march dither from the low-res target
  vec4 c = texture2D(uClouds, vUv) * 0.28;
  c += texture2D(uClouds, vUv + uTexel * vec2(1.2, 0.4)) * 0.18;
  c += texture2D(uClouds, vUv + uTexel * vec2(-1.2, -0.4)) * 0.18;
  c += texture2D(uClouds, vUv + uTexel * vec2(-0.4, 1.2)) * 0.18;
  c += texture2D(uClouds, vUv + uTexel * vec2(0.4, -1.2)) * 0.18;
  gl_FragColor = c;
}
`

/** Bakes one Z slice of a tileable Perlin-Worley volume: R shape, G erosion detail, B low-frequency coverage. */
export const noiseBakeFragment = /* glsl */ `
uniform float uZ;
varying vec2 vUv;

vec3 hash33(vec3 p) {
  uvec3 q = uvec3(ivec3(p)) * uvec3(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return -1.0 + 2.0 * vec3(q) * (1.0 / float(0xffffffffu));
}
float remap(float x, float a, float b, float c, float d) {
  return (((x - a) / (b - a)) * (d - c)) + c;
}
float gradientNoise(vec3 x, float freq) {
  vec3 p = floor(x);
  vec3 w = fract(x);
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  vec3 ga = hash33(mod(p + vec3(0.0, 0.0, 0.0), freq));
  vec3 gb = hash33(mod(p + vec3(1.0, 0.0, 0.0), freq));
  vec3 gc = hash33(mod(p + vec3(0.0, 1.0, 0.0), freq));
  vec3 gd = hash33(mod(p + vec3(1.0, 1.0, 0.0), freq));
  vec3 ge = hash33(mod(p + vec3(0.0, 0.0, 1.0), freq));
  vec3 gf = hash33(mod(p + vec3(1.0, 0.0, 1.0), freq));
  vec3 gg = hash33(mod(p + vec3(0.0, 1.0, 1.0), freq));
  vec3 gh = hash33(mod(p + vec3(1.0, 1.0, 1.0), freq));
  float va = dot(ga, w - vec3(0.0, 0.0, 0.0));
  float vb = dot(gb, w - vec3(1.0, 0.0, 0.0));
  float vc = dot(gc, w - vec3(0.0, 1.0, 0.0));
  float vd = dot(gd, w - vec3(1.0, 1.0, 0.0));
  float ve = dot(ge, w - vec3(0.0, 0.0, 1.0));
  float vf = dot(gf, w - vec3(1.0, 0.0, 1.0));
  float vg = dot(gg, w - vec3(0.0, 1.0, 1.0));
  float vh = dot(gh, w - vec3(1.0, 1.0, 1.0));
  return va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va)
    + u.x * u.y * (va - vb - vc + vd) + u.y * u.z * (va - vc - ve + vg)
    + u.z * u.x * (va - vb - ve + vf) + u.x * u.y * u.z * (-va + vb + vc - vd + ve - vf - vg + vh);
}
float worley(vec3 uv, float freq) {
  vec3 id = floor(uv);
  vec3 p = fract(uv);
  float minDist = 1e4;
  for (float x = -1.0; x <= 1.0; x++)
    for (float y = -1.0; y <= 1.0; y++)
      for (float z = -1.0; z <= 1.0; z++) {
        vec3 offset = vec3(x, y, z);
        vec3 h = hash33(mod(id + offset, vec3(freq))) * 0.5 + 0.5;
        h += offset;
        vec3 d = p - h;
        minDist = min(minDist, dot(d, d));
      }
  return 1.0 - minDist;
}
float perlinFbm(vec3 p, float freq, int octaves) {
  float G = exp2(-0.85);
  float amp = 1.0;
  float noise = 0.0;
  for (int i = 0; i < octaves; i++) {
    noise += amp * gradientNoise(p * freq, freq);
    freq *= 2.0;
    amp *= G;
  }
  return noise;
}
float worleyFbm(vec3 p, float freq) {
  return worley(p * freq, freq) * 0.625 + worley(p * freq * 2.0, freq * 2.0) * 0.25 + worley(p * freq * 4.0, freq * 4.0) * 0.125;
}
void main() {
  vec3 p = vec3(vUv, uZ);
  float pf = mix(1.0, perlinFbm(p, 4.0, 5), 0.5);
  pf = abs(pf * 2.0 - 1.0);
  float w = worleyFbm(p, 4.0);
  float shape = remap(pf, 0.0, 1.0, w, 1.0);
  float detail = worleyFbm(p, 5.0) * 0.6 + worleyFbm(p, 10.0) * 0.4;
  float low = perlinFbm(p, 2.0, 4) * 0.5 + 0.5;
  gl_FragColor = vec4(shape, detail, low, 1.0);
}
`

export const noiseBakeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const contrailVertex = /* glsl */ `
uniform vec3 uOrigin;
uniform vec3 uDir;
uniform float uLength;
uniform float uTime;
uniform float uSpeed;
uniform float uLift;
varying vec2 vUv;
varying float vDist;
varying float vWidth;

float bob(float t) { return 1.5 * sin(0.42 * t) + 0.6 * sin(0.97 * t + 1.3); }

void main() {
  vUv = uv;
  float dist = uLength * pow(uv.x, 1.7);
  vDist = dist;
  // vapour spreads quickly at first, then slowly
  float width = 1.1 + 5.5 * (1.0 - exp(-dist / 240.0)) + dist * 0.007;
  vWidth = width;
  // each parcel keeps the altitude the aircraft had when it was emitted, then sinks a little
  float emitted = uTime - dist / uSpeed;
  float y = bob(emitted) - bob(uTime) - dist * 0.006 + uLift * exp(-dist / 260.0);
  vec3 p = uOrigin + uDir * dist + vec3(0.0, y + (uv.y - 0.5) * width, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

export const contrailFragment = /* glsl */ `
uniform float uTravel;
uniform float uFade;
uniform float uOpacity;
uniform float uSeed;
varying vec2 vUv;
varying float vDist;
varying float vWidth;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

void main() {
  float v = (vUv.y - 0.5) * 2.0;
  // noise is anchored to the air mass, so the pattern streams backwards with the wind
  float air = vDist - uTravel;
  float age = clamp(vDist / uFade, 0.0, 1.0);
  float n1 = fbm(vec2(air / 26.0, v * 1.6 * vWidth / 9.0 + uSeed));
  float n2 = fbm(vec2(air / 9.0 + 40.0, v * 3.2 + uSeed * 3.0));
  float edge = abs(v) + (n1 - 0.5) * mix(0.3, 1.5, age) + (n2 - 0.5) * 0.4;
  float body = 1.0 - smoothstep(0.25, 0.95, edge);
  float born = smoothstep(4.0, 46.0, vDist);
  float breakup = mix(1.0, smoothstep(0.3, 0.72, n1 + (1.0 - age) * 0.25), smoothstep(0.25, 1.0, age));
  float fade = 1.0 - smoothstep(0.3, 1.0, age);
  float thin = mix(1.0, 0.5, smoothstep(0.0, 0.6, age));
  float grain = 0.68 + 0.5 * n2;
  float alpha = body * born * breakup * fade * thin * grain * uOpacity;
  if (alpha < 0.003) discard;
  // back-lit ice crystals: warm white core, slightly cooler underside
  vec3 col = mix(vec3(0.86, 0.74, 0.7), vec3(1.0, 0.93, 0.84), smoothstep(-0.7, 0.5, v) * 0.6 + body * 0.4);
  gl_FragColor = vec4(col, alpha);
}
`
