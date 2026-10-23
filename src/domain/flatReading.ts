import type { AiResult, FlatAnalysis } from '../services/ai';

// The photo's doubts about its own reading: the flat's reading replaces them with its own.
const READING_DOUBTS = ['Тип вещи определён неуверенно', 'Рисунок определён неуверенно'];

/**
 * The draft's analysis once the flat picture's reading arrives (/garment-flat, the flat and the photo read together).
 * Category, pattern and colour come from the flat's reading; what only the photo can tell stays: the analysis id the
 * saved category teaches, its cut-out, and its own warnings (a background it could not remove, a person in it) with
 * the review they ask for. An empty flat palette never clears a colour the photo gave.
 */
export function mergeFlatReading(photo: AiResult, flat: FlatAnalysis): AiResult {
  const photoOwn = (photo.warnings || []).filter(warning => !READING_DOUBTS.some(doubt => warning.startsWith(doubt)));
  const colour = flat.palette?.length ? { dominantColor: flat.dominantColor ?? photo.dominantColor, palette: flat.palette }
    : { dominantColor: photo.dominantColor, palette: photo.palette };
  return {
    ...photo,
    ...flat,
    ...colour,
    analysisId: photo.analysisId,
    bgRemovedBase64: photo.bgRemovedBase64,
    backgroundRemoved: photo.backgroundRemoved,
    warnings: Array.from(new Set([...(flat.warnings || []), ...photoOwn])),
    needsReview: Boolean(flat.needsReview) || photo.backgroundRemoved === false
  };
}

/** Whether a reading's category may go into the draft: not into a section the person chose by hand for another kind of thing. */
export function categoryFitsSection(category: string, sectionOfCategory: string, manualSection: string | null): boolean {
  return Boolean(category) && (!manualSection || sectionOfCategory === manualSection);
}
