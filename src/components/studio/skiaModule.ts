import { ComponentType, ReactNode } from 'react';
import { FOG_SKSL } from './fogShader';

export type FogUniforms = { uSize: number[]; uTime: number; uCover: number; uOpen: number; uDark: number; uTintA: number[]; uTintB: number[] };
export type FogModule = {
  Canvas: ComponentType<{ style?: object; children?: ReactNode }>;
  Fill: ComponentType<{ children?: ReactNode }>;
  Shader: ComponentType<{ source: unknown; uniforms: FogUniforms }>;
  effect: unknown;
};

let cached: FogModule | null | undefined;

// Loaded on first use, as readyNotification does: without the package, its native side (an old build) or a compiled
// shader, the generation view keeps its gradient instead of failing. Metro treats a require in a try as optional.
export function loadFog(): FogModule | null {
  if (cached !== undefined) return cached;
  try {
    const skia = require('@shopify/react-native-skia');
    const effect = skia.Skia.RuntimeEffect.Make(FOG_SKSL);
    cached = effect ? { Canvas: skia.Canvas, Fill: skia.Fill, Shader: skia.Shader, effect } : null;
  } catch {
    cached = null;
  }
  return cached;
}
