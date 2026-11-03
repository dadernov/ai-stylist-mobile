import { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { frameAspect, MeasuredAspect, measureAspect, pictureFit, rememberAspect } from './imageFit';

// A picture's shape never changes under its uri; pages reopen and leaf without measuring again.
const known = new Map<string, number>();
const getSize = (uri: string, ok: (width: number, height: number) => void, fail: () => void) => { Image.getSize(uri, ok, () => fail()); };

/** The picture's width ÷ height: `undefined` while it is measured (a few seconds at most), `null` without a picture or when it can't be measured. */
export function useImageAspect(uri: string | null | undefined): MeasuredAspect {
  const [measured, setMeasured] = useState<{ uri: string; aspect: number | null } | null>(null);
  useEffect(() => {
    if (!uri || known.has(uri)) return;
    return measureAspect(uri, getSize, aspect => {
      if (aspect) rememberAspect(known, uri, aspect);
      setMeasured({ uri, aspect });
    });
  }, [uri]);
  if (!uri) return null;
  return known.get(uri) ?? (measured?.uri === uri ? measured.aspect : undefined);
}

/**
 * The shape of a frame where a look develops from a photo and then shows it. `settling`: the result is here but not yet
 * measured, so its reveal waits a moment rather than starting in a frame about to change. `fit`: how the result sits in
 * that frame; unless its own shape is known, the frame may be another shape, and a result is never cropped.
 */
export function useFrameAspect(sourceUri: string | null | undefined, resultUri: string | null | undefined, developing: boolean) {
  const source = useImageAspect(sourceUri);
  const result = useImageAspect(resultUri);
  const developed = useRef(developing);
  if (developing) developed.current = true;
  return { aspect: frameAspect(Boolean(resultUri), result, source, developed.current), settling: Boolean(resultUri) && result === undefined, fit: pictureFit(result) };
}
