export const meshVertex = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4 uModel, uViewProjection, uLightVP;
uniform mat3 uNormal;
out vec3 vWorld, vNormal;
out vec2 vUv;
out vec4 vLightClip;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = uNormal * aNormal;
  vUv = aUv;
  vLightClip = uLightVP * world;
  gl_Position = uViewProjection * world;
}
`;

export const phongFragment = `#version 300 es
precision highp float;
in vec3 vWorld, vNormal;
in vec2 vUv;
in vec4 vLightClip;
out vec4 fragColor;

uniform vec3 uEye, uSunDir, uPointPosition, uColor, uTerms;
uniform float uAmbient, uSpecular, uGloss, uReflection, uBias;
uniform bool uSun, uPoint, uShadow, uTiled, uBump, uBlinn, uSelected, uCapture;
uniform sampler2D uStone, uNormalMap, uDepth;
uniform samplerCube uEnvironment;
uniform highp samplerCubeShadow uPointDepth;
uniform vec2 uPointClip;
uniform bool uPointShadow;
uniform int uPcfRadius;

float shadowFactor(vec3 surfaceNormal) {
  vec3 shadow = vLightClip.xyz / vLightClip.w * 0.5 + 0.5;
  if (!uShadow || any(lessThanEqual(shadow, vec3(0.0))) ||
      any(greaterThanEqual(shadow, vec3(1.0)))) return 1.0;
  float bias = max(0.20 * uBias, uBias * (1.0 - dot(surfaceNormal, uSunDir)));
  if (uPcfRadius == 0) {
    return step(shadow.z - bias, texture(uDepth, shadow.xy).r);
  }
  vec2 texel = 1.0 / vec2(textureSize(uDepth, 0));
  float visibility = 0.0;
  float samples = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if (abs(x) > uPcfRadius || abs(y) > uPcfRadius) continue;
      vec2 uv = shadow.xy + vec2(float(x), float(y)) * texel;
      float closest = texture(uDepth, uv).r;
      visibility += step(shadow.z - bias, closest);
      samples += 1.0;
    }
  }
  return visibility / samples;
}

float pointVisibility(vec3 fromLight, vec3 geometricNormal) {
  if (!uPointShadow) return 1.0;
  vec3 axes = abs(fromLight);
  // Perspective depth on the selected face uses its forward axis, even at a cube seam.
  float d = max(axes.x, max(axes.y, axes.z));
  float near = uPointClip.x, far = uPointClip.y;
  if (d <= near || d >= far) return 1.0;
  float incidence = clamp(dot(geometricNormal, -normalize(fromLight)), 0.0, 1.0);
  float texelWidth = 2.0 * d / float(textureSize(uPointDepth, 0).x);
  float biasedD = max(near, d - texelWidth * (1.0 - incidence));
  float referenceDepth = far / (far - near) * (1.0 - near / biasedD);
  return texture(uPointDepth, vec4(fromLight, referenceDepth));
}

vec3 directLight(vec3 n, vec3 v, vec3 l, vec3 albedo) {
  float incidence = max(dot(n, l), 0.0);
  if (incidence == 0.0) return vec3(0.0);
  vec3 reflectedLight = reflect(-l, n);
  float specAngle = uBlinn ? max(dot(n, normalize(l + v)), 0.0)
                          : max(dot(v, reflectedLight), 0.0);
  float spec = uSpecular * pow(specAngle, uGloss);
  return uTerms.y * albedo * incidence + uTerms.z * vec3(spec);
}

void main() {
  vec3 geometricNormal = normalize(vNormal);
  vec3 n = geometricNormal;
  vec2 uv = vUv * vec2(7.0, 6.0);
  if (uTiled && uBump) {
    // Floor U points along +X and V along -Z. T, B and N form a right-handed frame.
    mat3 tbn = mat3(vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, -1.0), n);
    n = normalize(tbn * (texture(uNormalMap, uv).xyz * 2.0 - 1.0));
  }
  vec3 albedo = uColor;
  if (uTiled) albedo *= texture(uStone, uv).rgb;
  vec3 v = normalize(uEye - vWorld);
  vec3 light = uTerms.x * uAmbient * albedo * vec3(0.90, 0.96, 1.0);
  if (uSun) {
    light += shadowFactor(geometricNormal) * vec3(0.98, 0.84, 0.67)
             * directLight(n, v, uSunDir, albedo);
  }
  if (uPoint) {
    vec3 delta = uPointPosition - vWorld;
    float attenuation = 1.0 / (1.0 + 0.18 * dot(delta, delta));
    light += pointVisibility(-delta, geometricNormal) * 1.28 * attenuation * vec3(1.0, 0.72, 0.47)
             * directLight(n, v, normalize(delta), albedo);
  }
  if (uReflection > 0.0) {
    vec3 reflectedView = reflect(-v, n);
    float edge = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    float strength = min(0.97, uReflection + 0.13 * edge);
    light = mix(light, texture(uEnvironment, reflectedView).rgb, strength);
  }
  if (uSelected) {
    float rim = smoothstep(0.47, 0.90, 1.0 - abs(dot(geometricNormal, v)));
    light = mix(light, vec3(0.21, 0.85, 0.68), 0.15 + 0.63 * rim);
  }
  // The cubemap stores linear light; display passes encode it for an sRGB canvas.
  vec3 clamped = clamp(light, 0.0, 1.0);
  vec3 encoded = mix(clamped * 12.92, 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055,
                     step(vec3(0.0031308), clamped));
  fragColor = vec4(uCapture ? clamped : encoded, 1.0);
}
`;

export const simpleVertex = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uModel, uViewProjection;
void main() {
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
}
`;

export const depthFragment = `#version 300 es
precision highp float;
void main() {}
`;

export const pickFragment = `#version 300 es
precision highp float;
uniform int uId;
out vec4 fragColor;
void main() {
  fragColor = vec4(float(uId) / 255.0, 0.0, 0.0, 1.0);
}
`;

export const skyVertex = `#version 300 es
out vec2 vScreen;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vScreen = p * 2.0 - 1.0;
  gl_Position = vec4(vScreen, 1.0, 1.0);
}
`;

export const skyFragment = `#version 300 es
precision highp float;
in vec2 vScreen;
uniform mat4 uInverseVP;
uniform vec3 uEye, uSunDir;
uniform bool uCapture;
out vec4 fragColor;
void main() {
  vec4 farPoint = uInverseVP * vec4(vScreen, 1.0, 1.0);
  vec3 ray = normalize(farPoint.xyz / farPoint.w - uEye);
  vec3 sky = mix(vec3(0.80, 0.76, 0.65), vec3(0.39, 0.55, 0.62), smoothstep(-0.12, 0.65, ray.y));
  float sun = pow(max(dot(ray, uSunDir), 0.0), 36.0);
  sky = mix(sky, vec3(1.0, 0.86, 0.58), sun * 0.7);
  sky = mix(sky, vec3(0.24, 0.30, 0.26), smoothstep(0.03, 0.80, -ray.y));
  fragColor = vec4(uCapture ? sky : 1.055 * pow(sky, vec3(1.0 / 2.4)) - 0.055, 1.0);
}
`;
