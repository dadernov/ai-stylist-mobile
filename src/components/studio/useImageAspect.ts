import { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';
import { aspectOf, frameAspect, MeasuredAspect } from './imageFit';

// A picture's shape never changes under its uri; pages reopen and leaf without measuring again.
const known = new Map<string, number>();

/** The picture's width ÷ height: `undefined` while it is measured, `null` without a picture or when it can't be measured. */
export function useImageAspect(uri: string | null | undefined): MeasuredAspect {
  const [failed, setFailed] = useState<string | null>(null);
  const [, setMeasured] = useState(0);
  useEffect(() => {
    if (!uri || known.has(uri)) return;
    let alive = true;
    Image.getSize(uri, (width, height) => {
      if (!alive) return;
      const aspect = aspectOf(width, height);
      if (aspect) { known.set(uri, aspect); setMeasured(n => n + 1); } else setFailed(uri);
    }, () => { if (alive) setFailed(uri); });
    return () => { alive = false; };
  }, [uri]);
  if (!uri || failed === uri) return null;
  return known.get(uri);
}

/**
 * The shape of a frame where a look develops from a photo and then shows it. `settling`: the result is here but not yet
 * measured, so its reveal waits a moment rather than starting in a frame about to change.
 */
export function useFrameAspect(sourceUri: string | null | undefined, resultUri: string | null | undefined, developing: boolean) {
  const source = useImageAspect(sourceUri);
  const result = useImageAspect(resultUri);
  const developed = useRef(developing);
  if (developing) developed.current = true;
  return { aspect: frameAspect(Boolean(resultUri), result, source, developed.current), settling: Boolean(resultUri) && result === undefined };
}
