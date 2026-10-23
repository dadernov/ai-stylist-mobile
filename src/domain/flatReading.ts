import type { AiResult, FlatAnalysis, FlatGarment } from '../services/ai';

// The photo's doubts about its own reading: the flat's reading replaces them with its own.
const READING_DOUBTS = ['Тип вещи определён неуверенно', 'Рисунок определён неуверенно'];

/**
 * The draft's analysis once the flat picture's reading arrives (/garment-flat, the flat and the photo read together).
 * Category, pattern and colour come from the flat's reading; what only the photo can tell stays: the analysis id the
 * saved category teaches, its cut-out, and its own warnings (a background it could not remove, a person in it) with
 * the review they ask for. An empty flat palette never clears a colour the photo gave.
 */
export function mergeFlatReading(photo: AiResult, flat: FlatAnalysis, options: { keepPhotoCategory?: boolean } = {}): AiResult {
  // keepPhotoCategory: the flat's category is not taken (a section set by hand for another kind of thing), and with it
  // nothing that follows from it: its season, traits, candidates and doubt. Colour and pattern still come.
  const keep = Boolean(options.keepPhotoCategory);
  const [categoryDoubt] = READING_DOUBTS;
  const answered = keep ? READING_DOUBTS.filter(doubt => doubt !== categoryDoubt) : READING_DOUBTS;
  const photoOwn = (photo.warnings || []).filter(warning => !answered.some(doubt => warning.startsWith(doubt)));
  const flatWarnings = (flat.warnings || []).filter(warning => !(keep && warning.startsWith(categoryDoubt)));
  const colour = flat.palette?.length ? { dominantColor: flat.dominantColor ?? photo.dominantColor, palette: flat.palette }
    : { dominantColor: photo.dominantColor, palette: photo.palette };
  const category = keep ? { category: photo.category, section: photo.section, categoryCandidates: photo.categoryCandidates,
    season: photo.season, traits: photo.traits } : {};
  return {
    ...photo,
    ...flat,
    ...colour,
    ...category,
    analysisId: photo.analysisId,
    bgRemovedBase64: photo.bgRemovedBase64,
    backgroundRemoved: photo.backgroundRemoved,
    warnings: Array.from(new Set([...flatWarnings, ...photoOwn])),
    needsReview: Boolean(keep ? photo.needsReview : flat.needsReview) || photo.backgroundRemoved === false
  };
}

/** Whether a reading's category may go into the draft: not into a section the person chose by hand for another kind of thing. */
export function categoryFitsSection(category: string, sectionOfCategory: string, manualSection: string | null): boolean {
  return Boolean(category) && (!manualSection || sectionOfCategory === manualSection);
}

/** /garment-flat's answer. "checked" false: the server could not compare the flat with the photo (the picture is
 *  paid for, so it still comes); an older server sends no "checked", and its flats were all shown as they came. */
export function readFlatResponse(result: any): FlatGarment {
  if (typeof result?.image !== 'string') throw new Error('no image');
  const analysis = result.analysis && typeof result.analysis === 'object' && typeof result.analysis.category === 'string' ? result.analysis : undefined;
  return { image: result.image, analysis, checked: result.checked !== false };
}
