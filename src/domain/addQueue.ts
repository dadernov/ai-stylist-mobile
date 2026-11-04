/**
 * Several gallery photos added at once: one at a time, as the host is small and each garment may start a paid flat picture.
 *
 * waiting -> analyzing -> (the item is in the wardrobe now) flat -> done; analyzing -> failed -> (retry) waiting.
 * The item lands before its flat picture is awaited, so a closed app never loses it. A flat is asked for only on a photo's first
 * run: after a failure or an interruption it may be paid for already, so a further run goes without one (the card has the
 * cut-out, and «Выровнять фото» is one tap away).
 */
export type AddStage = 'waiting' | 'analyzing' | 'flat' | 'done' | 'failed' | 'cancelled';
export type AddError = 'network' | 'unread' | 'photo' | 'consent' | 'tooLarge';
export type AddEntry = { id: string; uri: string; stage: AddStage; askFlat: boolean; flatMade?: boolean; itemId?: string; review?: boolean; error?: AddError };

export const MAX_BATCH = 10;
/** Seedream 5.0 Flash at 1K, ai-server/fal_tryon.py. /analyze runs on the host's own models. */
export const FLAT_USD = 0.027;

const isActive = (entry: AddEntry) => entry.stage === 'waiting' || entry.stage === 'analyzing' || entry.stage === 'flat';
/** The server turned the file down for its size: the same bytes would fail again, so it is not offered for a retry. */
export const canRetry = (entry: AddEntry) => entry.stage === 'failed' && entry.error !== 'tooLarge';
const holdsPlace = (entry: AddEntry) => isActive(entry) || canRetry(entry);
export const queueActive = (queue: AddEntry[]) => queue.some(isActive);
/** How many more photos fit in the batch under way; a failed one keeps its place, it can still be retried. */
export const roomInQueue = (queue: AddEntry[]) => Math.max(0, MAX_BATCH - queue.filter(holdsPlace).length);

const change = (queue: AddEntry[], id: string, next: (entry: AddEntry) => AddEntry) => queue.map(entry => (entry.id === id ? next(entry) : entry));

/** A new batch starts clean once the last one is over, but for what can still be retried; what does not fit is left out and counted. */
export function enqueue(queue: AddEntry[], uris: string[], makeId: (index: number) => string) {
  const kept = queueActive(queue) ? queue : queue.filter(holdsPlace);
  const taken = uris.slice(0, roomInQueue(kept));
  const added: AddEntry[] = taken.map((uri, index) => ({ id: makeId(index), uri, stage: 'waiting', askFlat: true }));
  return { queue: [...kept, ...added], dropped: uris.length - taken.length };
}

/** The next to run: none while another one is under way. */
export const nextToRun = (queue: AddEntry[]) => (queue.some(entry => entry.stage === 'analyzing' || entry.stage === 'flat') ? null : queue.find(entry => entry.stage === 'waiting') ?? null);

export const markAnalyzing = (queue: AddEntry[], id: string) => change(queue, id, entry => ({ ...entry, stage: 'analyzing', error: undefined }));

/** In the wardrobe from here on. A flat on its way keeps the queue waiting for it. */
export const markLanded = (queue: AddEntry[], id: string, itemId: string, review: boolean, flatComing: boolean) =>
  change(queue, id, entry => ({ ...entry, stage: flatComing ? 'flat' : 'done', itemId, review }));

export const markFlatSettled = (queue: AddEntry[], id: string, made: boolean) => change(queue, id, entry => ({ ...entry, stage: 'done', flatMade: made }));

export const markFailed = (queue: AddEntry[], id: string, error: AddError) =>
  change(queue, id, entry => (entry.stage === 'analyzing' || entry.stage === 'waiting' ? { ...entry, stage: 'failed', error, askFlat: entry.askFlat && error === 'consent' } : entry));

/** What a failed request means for its photo. A refusal for size stands even when the app left the screen meanwhile. */
export const requestOutcome = (status: number | undefined, away: boolean): AddError | 'interrupted' =>
  status === 413 ? 'tooLarge' : away ? 'interrupted' : 'network';

/** The long side a batch photo is kept at, as the single add's picker bounds it; null when it is within that already. */
export const UPLOAD_LONG_SIDE = 4096;
export function uploadResize(width: number, height: number, max = UPLOAD_LONG_SIDE): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

/** Cut off by the app leaving the screen: runs again by itself, without a second flat. */
export const markInterrupted = (queue: AddEntry[], id: string) =>
  change(queue, id, entry => (entry.stage === 'analyzing' ? { ...entry, stage: 'waiting', askFlat: false } : entry));

export const retryEntry = (queue: AddEntry[], id: string) =>
  change(queue, id, entry => (canRetry(entry) ? { ...entry, stage: 'waiting', error: undefined } : entry));

export const retryFailed = (queue: AddEntry[], error?: AddError) =>
  queue.map(entry => (canRetry(entry) && (!error || entry.error === error) ? { ...entry, stage: 'waiting' as const, error: undefined } : entry));

/** Stops what has not landed. An item in the wardrobe stays, and its flat, already being made, still reaches the card. */
export const cancelQueue = (queue: AddEntry[]) =>
  queue.map(entry => (entry.stage === 'waiting' || entry.stage === 'analyzing' || entry.stage === 'failed' ? { ...entry, stage: 'cancelled' as const } : entry));

/** After the app was closed: nothing is running any more. */
export const recoverQueue = (queue: AddEntry[]) => queue.map(entry =>
  entry.stage === 'analyzing' ? { ...entry, stage: 'waiting' as const, askFlat: false }
  : entry.stage === 'flat' ? { ...entry, stage: 'done' as const } : entry);

/** The strip closed: only what still runs stays. Closing is offered once nothing runs. */
export const clearFinished = (queue: AddEntry[]) => queue.filter(isActive);

export function queueSummary(queue: AddEntry[]) {
  const count = (stage: AddStage) => queue.filter(entry => entry.stage === stage).length;
  const cancelled = count('cancelled');
  const flats = queue.filter(entry => entry.flatMade).length;
  return { total: queue.length - cancelled, landed: queue.filter(entry => entry.itemId).length, failed: count('failed'), retryable: queue.filter(canRetry).length, waiting: count('waiting'), cancelled,
    review: queue.filter(entry => entry.review).length, flats, costUsd: Number((flats * FLAT_USD).toFixed(3)), active: queueActive(queue) };
}

/** `reanchor`: a written-down path goes stale when the app's folder moves on an update (services/photos); no path left drops the entry. */
export function decodeAddQueue(value: unknown, reanchor: (uri: string) => string | undefined = uri => uri): AddEntry[] {
  if (!Array.isArray(value)) return [];
  const stages: AddStage[] = ['waiting', 'analyzing', 'flat', 'done', 'failed', 'cancelled'];
  return value.filter(entry => entry && typeof entry.id === 'string' && typeof entry.uri === 'string' && stages.includes(entry.stage))
    .map(entry => ({ entry, uri: reanchor(entry.uri) })).filter(({ uri }) => Boolean(uri))
    .map(({ entry, uri }) => ({ id: entry.id, uri: uri as string, stage: entry.stage, askFlat: entry.askFlat === true, flatMade: entry.flatMade === true || undefined,
      itemId: typeof entry.itemId === 'string' ? entry.itemId : undefined, review: entry.review === true || undefined,
      error: ['network', 'unread', 'photo', 'consent', 'tooLarge'].includes(entry.error) ? entry.error : undefined }));
}

/** The server was not sure of the garment, or could not cut it out: the person is asked to look. */
export const needsCheck = (reading: { needsReview?: boolean; backgroundRemoved?: boolean }) => Boolean(reading.needsReview) || reading.backgroundRemoved === false;
