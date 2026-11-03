import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { COPY_LONG_SIDE, copyName, createCopyCache } from './reflectionCache';
import { isCutout } from './studio';

const WEB = Platform.OS === 'web';

/** react-native-svg decodes the file it is given at full size: a reflection gets a small copy, in the cache directory. */
async function makeCopy(uri: string): Promise<string | null> {
  if (!FileSystem.cacheDirectory) return null;
  const dir = `${FileSystem.cacheDirectory}reflections/`;
  const cutout = isCutout(uri);
  const target = `${dir}${copyName(uri)}.${cutout ? 'png' : 'jpg'}`;
  if ((await FileSystem.getInfoAsync(target)).exists) return target;
  const rendered = await ImageManipulator.manipulate(uri).renderAsync();
  try {
    const { width, height } = rendered;
    if (Math.max(width, height) <= COPY_LONG_SIDE) return uri;
    const resized = await ImageManipulator.manipulate(rendered)
      .resize(width >= height ? { width: COPY_LONG_SIDE } : { height: COPY_LONG_SIDE }).renderAsync();
    try {
      // A cut-out keeps its transparency.
      const saved = await resized.saveAsync(cutout ? { format: SaveFormat.PNG } : { format: SaveFormat.JPEG, compress: 0.8 });
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      await FileSystem.moveAsync({ from: saved.uri, to: target });
      return target;
    } finally { resized.release(); }
  } finally { rendered.release(); }
}

const copies = createCopyCache(makeCopy);

/** Starts on a copy ahead of its piece coming into view. */
export const prepareReflectionCopy = (uri: string) => { if (!WEB) void copies.request(uri); };

/** The picture to mirror: `undefined` until the copy exists, `null` if there is none and never will be. On the web, the browser scales the original. */
export function useReflectionCopy(uri: string | undefined): string | null | undefined {
  const [, setMade] = useState(0);
  const copy = !uri ? null : WEB ? uri : copies.peek(uri);
  useEffect(() => {
    if (!uri || copy !== undefined) return;
    let alive = true;
    void copies.request(uri).then(() => { if (alive) setMade(n => n + 1); });
    return () => { alive = false; };
  }, [uri, copy]);
  return copy;
}
