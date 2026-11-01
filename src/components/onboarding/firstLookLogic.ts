import { WardrobeItem } from '../../data/mock';
import { accessorySlot, TRYON_SECTIONS } from '../../domain/accessories';

/** The account already lives in the app: anything on this device. */
export const hasLocalHistory = (data: { items: number; photo: boolean; jobs: number; looks: number }) =>
  data.items > 0 || data.photo || data.jobs > 0 || data.looks > 0;

/** ...or anything it keeps on the server. Deleted items and a bare gender do not count. */
export const remoteHasCloset = (remote: { items?: { deleted?: boolean }[]; profile?: { data?: Record<string, unknown> } | null }) =>
  Boolean(remote.items?.some(item => !item.deleted))
  || typeof remote.profile?.data?.modelBlob === 'string' || typeof remote.profile?.data?.avatarBlob === 'string';

export type GateDecision = 'show' | 'hide' | 'hide-and-remember';
/**
 * Whether the first-minute flow opens for this account. Never when the account's data could not be read or the server
 * could not be asked (`remote` null): an existing account on a new phone would look brand new. Then nothing is
 * remembered either, and the next launch asks again.
 */
export function firstLookDecision({ unreadable, local, remote }: { unreadable: boolean; local: boolean; remote: boolean | null }): GateDecision {
  if (local) return 'hide-and-remember';
  if (unreadable || remote === null) return 'hide';
  return remote ? 'hide-and-remember' : 'show';
}

export type FirstLookStep = 'you' | 'garment' | 'magic';
/** Without a photo of the person there is nothing to dress: after the garment step the flow goes into the app. */
export const nextStep = (step: FirstLookStep, state: { hasPhoto: boolean; hasGarment: boolean }): FirstLookStep | 'app' => {
  if (step === 'you') return 'garment';
  if (step === 'garment') return state.hasPhoto && state.hasGarment ? 'magic' : 'app';
  return 'app';
};

/** The same rule as the try-on sheet (AiTryOnPreview): a section it dresses, and an accessory it has a slot for. */
export const canTryOn = (item: WardrobeItem) =>
  Boolean(item.imageUri) && TRYON_SECTIONS.includes(item.section) && (item.section !== 'Аксессуары' || Boolean(accessorySlot(item)));

export type MagicView = 'starting' | 'waiting' | 'ready' | 'failed';
export function magicView(job: { status: string; result?: { imageUri?: string } } | undefined, startFailed: boolean): MagicView {
  if (job?.status === 'succeeded' && job.result?.imageUri) return 'ready';
  if (job?.status === 'failed' || job?.status === 'retry' || job?.status === 'succeeded') return 'failed';
  if (job?.status === 'pending') return 'waiting';
  return startFailed ? 'failed' : 'starting';
}

export type QuestionId = 'style' | 'event' | 'colors';
export type Question = { id: QuestionId; title: string; options: { value: string; label: string }[] };
// Style and event values are keys of STYLES and EVENTS (domain/outfits), which the ideas read.
export const QUESTIONS: Question[] = [
  { id: 'style', title: 'Что тебе ближе?', options: [
    { value: 'Кэжуал', label: 'Кэжуал' }, { value: 'Минимализм', label: 'Минимализм' },
    { value: 'Классика', label: 'Классика' }, { value: 'Стритвир', label: 'Стритвир' }] },
  { id: 'event', title: 'Куда чаще всего идёшь?', options: [
    { value: 'Работа', label: 'Работа' }, { value: 'Учёба', label: 'Учёба' },
    { value: 'Прогулка', label: 'Прогулка' }, { value: 'Вечеринка', label: 'Вечеринка' }] },
  { id: 'colors', title: 'Какие цвета тебе по душе?', options: [
    { value: 'neutral', label: 'Спокойные' }, { value: 'dark', label: 'Тёмные' },
    { value: 'pastel', label: 'Пастельные' }, { value: 'bright', label: 'Яркие' }] },
];
