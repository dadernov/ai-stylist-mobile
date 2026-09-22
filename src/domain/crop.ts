export type CropRect = { x: number; y: number; width: number; height: number };
export type CropHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function moveCrop(rect: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  const min = 0.12;
  if (handle === 'move') return { ...rect, x: clamp(rect.x + dx, 0, 1 - rect.width), y: clamp(rect.y + dy, 0, 1 - rect.height) };
  let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min);
  if (handle.includes('e')) right = clamp(right + dx, left + min, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function cropPixels(rect: CropRect, width: number, height: number) {
  const originX = Math.max(0, Math.floor(rect.x * width));
  const originY = Math.max(0, Math.floor(rect.y * height));
  return { originX, originY, width: Math.max(1, Math.min(width - originX, Math.round(rect.width * width))), height: Math.max(1, Math.min(height - originY, Math.round(rect.height * height))) };
}
