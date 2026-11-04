/** The one layout of a finished try-on: the photo takes what is left above a row of small pieces and the three buttons. */
export const RESULT_RADIUS = 28;
export const PIECE_SIZE = 44;
export const ACTIONS_HEIGHT = 58;
export const ACTION_GAP = 8;
export const RESULT_GAP = 10;
export const MIN_PHOTO = 130;

export function resultPhotoHeight({ available, chrome = 0, pieces = true, min = MIN_PHOTO }: { available: number; chrome?: number; pieces?: boolean; min?: number }) {
  const room = available - chrome - (pieces ? PIECE_SIZE + RESULT_GAP : 0) - RESULT_GAP - ACTIONS_HEIGHT;
  return Math.max(min, Math.floor(room));
}

/** Until the list has been measured: the window less what stands around every list of the «Образ» tab on a phone. */
export const estimatedViewport = (windowHeight: number, top: number, tabBarSpace = 100) => windowHeight - top - tabBarSpace - 12 - 58 - 60;

/** One of the three buttons in a row across `width`. */
export const actionCellWidth = (width: number) => (width - ACTION_GAP * 2) / 3;
export const ACTION_FONT = 12;
export const ACTION_INSET = 4;

/** Every label the three buttons can show: all must fit a cell at 320 pt in every language. */
export const RESULT_ACTION_LABELS = ['В галерею', 'Сохранено', 'Сохранить', 'Сохранён', 'Ещё раз'];

/** A safe overestimate of a label's width in the app's font: wide CJK glyphs at full size, the rest at 0.62 em. */
export const labelWidth = (text: string, fontSize = ACTION_FONT) =>
  [...text].reduce((sum, char) => sum + (/[⺀-鿿＀-￯]/.test(char) ? 1 : 0.62) * fontSize, 0);
