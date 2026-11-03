/** Pure bookkeeping of the small reflection copies (kept apart from React Native for tests). */

/** The long side of a copy, in px: a faded mirror image under a piece at most 300 pt wide needs no more. */
export const COPY_LONG_SIDE = 600;
export const COPY_CACHE_LIMIT = 64;

const hash = (text: string, seed: number) => {
  let h = seed;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/** The same picture always gets the same file, across launches too; a data: URI is not kept as a name. */
export const copyName = (uri: string) => `${hash(uri, 2166136261)}-${hash(uri, 40389)}-${uri.length.toString(36)}`;

export type CopyCache = {
  /** A copy's uri, `null` if it can't be made, `undefined` if it isn't known yet. */
  peek: (uri: string) => string | null | undefined;
  /** Makes the copy unless it is known or under way. Never rejects. */
  request: (uri: string) => Promise<string | null>;
};

type Job = { key: string; uri: string; done: Promise<string | null>; resolve: (copy: string | null) => void };

/**
 * One decode at a time, since each one holds a full-size photo in memory, and the latest asked for first, so that
 * a piece in focus never waits behind those a swipe has already left. Results sit in a bounded least-recently-used map.
 */
export function createCopyCache(make: (uri: string) => Promise<string | null>, limit = COPY_CACHE_LIMIT): CopyCache {
  const results = new Map<string, string | null>();
  const jobs = new Map<string, Job>();
  const waiting: Job[] = [];
  let running = false;

  const remember = (key: string, copy: string | null) => {
    results.delete(key);
    results.set(key, copy);
    if (results.size > limit) results.delete(results.keys().next().value as string);
  };
  const pump = async () => {
    if (running) return;
    running = true;
    // Requests of one commit arrive together: the order is settled before the first job is taken.
    await Promise.resolve();
    for (let job = waiting.pop(); job; job = waiting.pop()) {
      let copy: string | null = null;
      try { copy = await make(job.uri); } catch { copy = null; }
      remember(job.key, copy);
      jobs.delete(job.key);
      job.resolve(copy);
    }
    running = false;
  };

  return {
    peek: uri => {
      const key = copyName(uri);
      const copy = results.get(key);
      if (copy === undefined) return undefined;
      remember(key, copy);
      return copy;
    },
    request: uri => {
      const key = copyName(uri);
      const known = results.get(key);
      if (known !== undefined) return Promise.resolve(known);
      const queued = jobs.get(key);
      if (queued) {
        const at = waiting.indexOf(queued);
        if (at >= 0) { waiting.splice(at, 1); waiting.push(queued); }
        return queued.done;
      }
      let resolve!: (copy: string | null) => void;
      const done = new Promise<string | null>(r => { resolve = r; });
      const job = { key, uri, done, resolve };
      jobs.set(key, job);
      waiting.push(job);
      void pump();
      return done;
    }
  };
}
