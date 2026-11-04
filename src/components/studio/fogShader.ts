/**
 * The generation fog, as a Skia runtime effect (SkSL): a real, if small, raymarch through a volume of light.
 * Six slices are walked front to back; each one's density is warped fractal noise, shaded by how much fog lies
 * towards the light and accumulated by Beer-Lambert, so thick clouds read as depth rather than as a flat gradient.
 *
 * Written for this app, no code copied. The look was studied from, without taking any code:
 * - adithyavis/awesome-mobile-app-animations, ChatGPTVoiceProfiles (no licence file, hence ideas only: layered FBM in Skia):
 *   https://github.com/adithyavis/awesome-mobile-app-animations/tree/main/src/ChatGPTVoiceProfiles
 * - rit3zh/reacticx, Siri Orb (MIT): https://reacticx.com/docs/components/siri-orb
 * Runs on @shopify/react-native-skia (MIT): https://github.com/Shopify/react-native-skia
 *
 * uCover thickens the fog until it is opaque and uOpen parts it from the top down, along a noisy edge with a rim of
 * light: the finished look comes through the very same fog that was drifting while it was made.
 */
export const FOG_SKSL = `
uniform float2 uSize;
uniform float uTime;
uniform float uCover;
uniform float uOpen;
uniform float uDark;
uniform float3 uTintA;
uniform float3 uTintB;

float hash(float2 p) {
  p = fract(p * float2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
float fbm(float2 p) {
  float sum = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 3; i++) {
    sum += amp * noise(p);
    p = float2(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y) + 7.3;
    amp *= 0.5;
  }
  return sum;
}
// The fog's thickness at a point of the volume: noise whose coordinates are themselves pushed by slow noise.
float density(float2 p, float z, float t) {
  float2 q = p * (1.05 + z * 0.55) + float2(z * 3.7, -z * 2.3);
  float2 warp = float2(noise(q * 0.9 + float2(t * 0.09, -t * 0.05)), noise(q * 0.9 + float2(5.2 - t * 0.06, 1.3 + t * 0.08)));
  float d = fbm(q + 1.5 * warp + float2(-t * 0.04, t * 0.06));
  return smoothstep(0.42, 0.74, d);
}

half4 main(float2 frag) {
  float2 uv = frag / uSize;
  float2 p = (frag - 0.5 * uSize) / min(uSize.x, uSize.y);
  float t = uTime;
  float breath = 0.5 + 0.5 * sin(t * 0.7);
  float2 light = normalize(float2(-0.5 + 0.35 * sin(t * 0.13), -0.8));

  float3 sum = float3(0.0);
  float through = 1.0;
  for (int i = 0; i < 6; i++) {
    float z = float(i) / 5.0;
    float d = density(p, z, t);
    if (d > 0.01) {
      // Fog towards the light shades this slice: the soft relief that makes it volumetric.
      float lit = clamp(1.0 - 1.35 * density(p + light * 0.2, z, t), 0.0, 1.0);
      float3 body = mix(uTintA, uTintB, z * 0.6 + 0.4 * d);
      float3 shade = mix(body * mix(0.58, 0.34, uDark), mix(float3(1.0), body, mix(0.12, 0.42, uDark)), lit * lit * (3.0 - 2.0 * lit));
      float slice = 1.0 - exp(-d * 0.62);
      sum += through * slice * shade;
      through *= 1.0 - slice;
    }
  }
  // A slow glow in the middle of the volume, breathing.
  float2 toCore = p - float2(0.05 * sin(t * 0.21), 0.08 * cos(t * 0.17));
  float core = exp(-3.2 * dot(toCore, toCore));
  float3 glow = mix(uTintB, float3(1.0), 0.55) * core * (0.2 + 0.16 * breath) * mix(1.0, 0.7, uDark);

  float thick = 1.0 - through;
  float veil = mix(0.14, 0.2, uDark) + 0.05 * breath;
  float a = clamp(thick * 0.92 + veil * through, 0.0, 1.0);
  // Thin places fall to the volume's own tint, not to black.
  float3 ground = mix(uTintA, float3(1.0), 0.45) * mix(1.0, 0.34, uDark);
  float3 color = sum + through * ground + glow;

  // The reveal: first opaque, then parted from the top along a noisy edge.
  a = mix(a, 1.0, uCover);
  float edge = (fbm(float2(p.x * 2.4 + t * 0.1, uv.y * 1.6)) - 0.45) * 0.34;
  float front = uOpen * 1.7 - 0.35;
  float open = smoothstep(front - 0.13, front + 0.13, uv.y + edge);
  float rim = open * (1.0 - open) * 4.0 * step(0.001, uOpen) * (1.0 - step(0.999, uOpen));
  color = mix(color, float3(1.0), rim * 0.75);
  a *= open;
  return half4(half3(clamp(color, 0.0, 1.0) * a), half(a));
}
`;
