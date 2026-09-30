import * as Crypto from 'expo-crypto';
import { WardrobeItem } from '../data/mock';
import { GeneratedLook, SavedLook, TryOnHistoryItem } from '../types/looks';
import { Session } from './auth';
import { analyzeTryOnGenerateLook, getTryOnJob, TryOnGenerateResult, TryOnProgress, TryOnQualityMode, TuckMode } from './ai';
import { ApiError } from './http';
import { accountKey } from './accountStorage';
import { loadValidated, saveJson } from './storage';
import { cacheTryOnImage, reanchorTryOnUri } from './tryOnPhotos';

export type TryOnJob = { id: string; context: string; itemIds: string[]; garments?: { id: string; name: string }[]; name: string; createdAt: number; tuckMode: TuckMode;
  // A draft ('fast') or the final ('quality'). Jobs saved before drafts existed have none and were finals.
  quality?: TryOnQualityMode;
  status: 'pending' | 'succeeded' | 'failed' | 'retry'; result?: TryOnHistoryItem; error?: string;
  // Live stage of a running job (kept in memory only; previews are throwaway frames).
  progress?: TryOnProgress };
export type JobSnapshot = { jobs: TryOnJob[]; ready: boolean; readOnly?: boolean; error?: string };
type Inputs = { modelUri: string; items: WardrobeItem[]; context: string; tuckMode: TuckMode; quality: TryOnQualityMode;
  // Generate every layer anew instead of building on layers the server kept from an earlier look.
  fresh?: boolean };
const qualityOf = (job: TryOnJob): TryOnQualityMode => job.quality || 'quality';

export const tryOnContext = (modelUri: string, items: WardrobeItem[]) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
  JSON.stringify([modelUri, [...items].sort((a, b) => a.id.localeCompare(b.id)).map(i => [i.id, i.section, i.category, i.sourceImageUri || i.imageUri])]));

export class TryOnJobStore {
  private snapshot: JobSnapshot = { jobs: [], ready: false };
  private listeners = new Set<() => void>();
  private working = new Set<string>();
  private active = false;
  private writable = true;
  private checkedFailed = false;
  private initialized?: Promise<void>;
  constructor(private session: Session) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  private emit() { this.listeners.forEach(listener => listener()); }
  private async save() {
    if (!this.writable) throw new Error('История примерок повреждена и сохранена без изменений.');
    try { await saveJson(accountKey(this.session.login, 'tryOnJobs'), this.snapshot.jobs.map(({ progress: _progress, ...job }) => job)); }
    catch (error) {
      this.snapshot = { ...this.snapshot, error: 'Не удалось сохранить историю примерок. Освободи место на устройстве.' }; this.emit(); throw error;
    }
  }
  private async update(id: string, patch: Partial<TryOnJob>) {
    const previous = this.snapshot.jobs.find(job => job.id === id);
    if (!previous || Object.entries(patch).every(([key, value]) => previous[key as keyof TryOnJob] === value)) return;
    this.snapshot = { ...this.snapshot, jobs: this.snapshot.jobs.map(job => job.id === id ? { ...job, ...patch } : job) };
    this.emit(); await this.save();
  }
  private setProgress(id: string, progress?: TryOnProgress) {
    const job = this.snapshot.jobs.find(job => job.id === id);
    if (!job || job.status !== 'pending') return;
    const same = (a?: TryOnProgress, b?: TryOnProgress) => JSON.stringify(a || null) === JSON.stringify(b || null);
    if (same(job.progress, progress)) return;
    this.snapshot = { ...this.snapshot, jobs: this.snapshot.jobs.map(current => current.id === id ? { ...current, progress } : current) };
    this.emit();
  }
  async activate(session: Session) {
    this.session = session; this.active = true;
    if (!this.initialized) this.initialized = this.load();
    await this.initialized;
    for (const job of this.snapshot.jobs) if (['pending', 'retry'].includes(job.status)) void this.poll(job);
    if (!this.active || !this.writable || this.checkedFailed) return;
    this.checkedFailed = true;
    const now = Date.now();
    const recentFailed = this.snapshot.jobs.filter(job => job.status === 'failed' && job.createdAt <= now
      && job.createdAt >= now - 24 * 60 * 60 * 1000).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
    for (const job of recentFailed) void this.reconcileFailed(job);
  }
  deactivate() { this.active = false; }
  private async load() {
    const result = await loadValidated(accountKey(this.session.login, 'tryOnJobs'), value => {
      if (!Array.isArray(value) || value.some(j => !j || typeof j.id !== 'string' || typeof j.context !== 'string'
        || !Array.isArray(j.itemIds) || !j.itemIds.every((id: unknown) => typeof id === 'string')
        || (j.garments != null && (!Array.isArray(j.garments) || j.garments.some((g: any) => !g || typeof g.id !== 'string' || typeof g.name !== 'string')))
        || typeof j.name !== 'string' || !Number.isFinite(j.createdAt) || !['auto', 'tucked', 'untucked'].includes(j.tuckMode)
        || (j.quality != null && !['fast', 'quality'].includes(j.quality))
        || !['pending', 'succeeded', 'failed', 'retry'].includes(j.status)
        || (j.error != null && typeof j.error !== 'string') || (j.status === 'succeeded' && !j.result)
        || (j.result != null && (typeof j.result.imageUri !== 'string' || typeof j.result.id !== 'string' || !Number.isFinite(j.result.updatedAt)
          || (j.result.warning != null && typeof j.result.warning !== 'string'))))) throw new Error('Invalid jobs');
      return value as TryOnJob[];
    });
    this.writable = !result.failed;
    this.snapshot = { ready: true, readOnly: result.failed, jobs: (result.value || []).map(job => job.result ? { ...job, result: { ...job.result, imageUri: reanchorTryOnUri(job.result.imageUri) || job.result.imageUri } } : job),
      error: result.failed ? 'История примерок не читается. Исходные данные сохранены без изменений.' : undefined };
    this.emit();
  }
  async importLooks(looks: (GeneratedLook | SavedLook)[], items: WardrobeItem[]) {
    if (!this.snapshot.ready || !this.writable) return;
    const known = new Set(this.snapshot.jobs.flatMap(job => job.result ? [job.result.imageUri] : []));
    const imported: TryOnJob[] = [];
    for (const look of looks) {
      const frames = [...(look.tryOnHistory || [])];
      if (look.tryOnImageUri) frames.push({ id: look.id, imageUri: look.tryOnImageUri,
        updatedAt: look.tryOnUpdatedAt || ('createdAt' in look ? look.createdAt : 0),
        warning: look.tryOnWarning, tuckMode: look.tuckMode, qualityMode: look.tryOnQualityMode });
      for (const frame of frames) {
        const imageUri = reanchorTryOnUri(frame.imageUri) || frame.imageUri;
        if (known.has(imageUri)) continue;
        known.add(imageUri);
        imported.push({ id: Crypto.randomUUID(), context: `legacy:${look.id}`, itemIds: [...look.itemIds],
          garments: look.itemIds.flatMap(id => { const item = items.find(item => item.id === id); return item ? [{ id, name: item.name }] : []; }),
          name: 'name' in look ? look.name : look.title, createdAt: frame.updatedAt, tuckMode: frame.tuckMode || 'auto',
          status: 'succeeded', result: { ...frame, imageUri } });
      }
    }
    if (!imported.length) return;
    this.snapshot = { ...this.snapshot, jobs: [...this.snapshot.jobs, ...imported].sort((a, b) => b.createdAt - a.createdAt) };
    this.emit();
    await this.save();
  }
  private async complete(job: TryOnJob, response: TryOnGenerateResult) {
    if (!response.outputUrl) return false;
    const stored = await cacheTryOnImage(response.outputUrl, job.id, this.session.login);
    await this.update(job.id, { status: 'succeeded', error: undefined, progress: undefined, result: { id: job.id, imageUri: stored.imageUri,
      updatedAt: response.updatedAt || Date.now(), warning: response.warning, tuckMode: job.tuckMode, qualityMode: qualityOf(job) } });
    return true;
  }
  private async reconcileFailed(job: TryOnJob) {
    if (!this.active || this.working.has(job.id)) return;
    this.working.add(job.id);
    const session = this.session;
    try {
      // A server-side repair can make a previously rejected job available again.
      const response = await getTryOnJob(job.id, session);
      if (this.active && this.session.login === session.login && this.snapshot.jobs.find(current => current.id === job.id)?.status === 'failed') {
        await this.complete(job, response);
      }
    } catch { /* A single read never changes a failed job into pending/retry or submits paid work. */ }
    finally { this.working.delete(job.id); }
  }
  async start(request: Inputs) {
    // A caller that names no quality asks for the final, as before drafts existed.
    const input = { ...request, quality: request.quality || 'quality' };
    if (!this.snapshot.ready || !this.writable) throw new Error(this.snapshot.error || 'История ещё загружается.');
    // A draft and the final of the same look are separate jobs: one may run while the other is shown.
    const existing = this.snapshot.jobs.find(job => job.context === input.context && qualityOf(job) === input.quality && job.status === 'pending');
    if (existing) { void this.poll(existing); return; }
    const retry = this.snapshot.jobs.find(job => job.context === input.context && job.tuckMode === input.tuckMode
      && qualityOf(job) === input.quality && job.status === 'retry');
    const job: TryOnJob = retry || { id: Crypto.randomUUID(), context: input.context, itemIds: input.items.map(i => i.id),
      garments: input.items.map(i => ({ id: i.id, name: i.name })),
      name: input.items.map(i => i.name).join(' + '), createdAt: Date.now(), status: 'pending', tuckMode: input.tuckMode, quality: input.quality };
    if (this.working.has(job.id)) return;
    this.working.add(job.id);
    this.snapshot = { ...this.snapshot, error: undefined, jobs: [{ ...job, status: 'pending', error: undefined }, ...this.snapshot.jobs.filter(j => j.id !== job.id)] };
    this.emit();
    try {
      await this.save();
      // Tops and outerwear may come in several layers; the server puts them
      // on in their natural order, whatever order they were chosen in.
      const layers = (section: string) => input.items.filter(i => i.section === section && i.imageUri);
      const uriOf = (item?: { sourceImageUri?: string; imageUri?: string }) => item?.sourceImageUri || item?.imageUri;
      const [top, top2, top3, top4] = layers('Верх');
      const [outer, outer2] = layers('Верхняя одежда');
      const response = await analyzeTryOnGenerateLook(input.modelUri, uriOf(top), uriOf(layers('Низ')[0]), uriOf(layers('Обувь')[0]), job.tuckMode, false,
        qualityOf(job), uriOf(outer), top?.category, outer?.category, job.id, this.session, Boolean(input.fresh),
        { top2Uri: uriOf(top2), top2Category: top2?.category, outer2Uri: uriOf(outer2), outer2Category: outer2?.category,
          top3Uri: uriOf(top3), top3Category: top3?.category, top4Uri: uriOf(top4), top4Category: top4?.category });
      if (await this.complete(job, response)) return;
    } catch (error: any) {
      if (error instanceof ApiError && error.status && error.status < 500) {
        await this.update(job.id, { status: 'failed', error: error.message }).catch(() => {}); return;
      }
      await this.update(job.id, { status: 'retry', error: error?.message || 'Не удалось получить результат. Повтори загрузку.' }).catch(() => {});
    } finally { this.working.delete(job.id); }
    void this.poll(job);
  }
  async poll(job: TryOnJob) {
    if (this.working.has(job.id) || !this.active) return;
    this.working.add(job.id);
    let failures = 0;
    const deadline = Date.now() + 20 * 60 * 1000;
    try {
      while (this.active && Date.now() < deadline) {
        try {
          const response = await getTryOnJob(job.id, this.session);
          if (await this.complete(job, response)) return;
          failures = 0;
          await this.update(job.id, { status: 'pending', error: undefined });
          this.setProgress(job.id, response.progress);
        } catch (error: any) {
          if (error instanceof ApiError && error.status === 200) {
            await this.update(job.id, { status: 'failed', error: error.message }); return;
          }
          if (++failures >= 3 || (error instanceof ApiError && error.status === 401)) {
            await this.update(job.id, { status: 'retry', error: error?.message || 'Проверь соединение и повтори загрузку результата.' }); return;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      if (this.active) await this.update(job.id, { status: 'retry', error: 'Примерка ещё не завершена. Повтори проверку результата.' });
    } catch { /* The journal stays available in memory; save() exposes a storage error. */ }
    finally { this.working.delete(job.id); }
  }
}
