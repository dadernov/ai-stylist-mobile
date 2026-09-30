import { TryOnProgress } from '../services/ai';

type Translate = (source: string, vars?: Record<string, string | number>) => string;

// A try-on takes about two minutes from the tap to the finished look.
export const EXPECTED_TRYON_MS = 120000;

/** What a running try-on is doing now, in words; `stageName` names a garment of an older per-garment try-on. */
export function tryOnStatusLabel(progress: TryOnProgress | undefined, t: Translate, stageName?: (stage: string) => string) {
  if (!progress?.stage) return t('Генерируем образ…');
  switch (progress.stage) {
    case 'upload': return t('Отправляем фото…');
    case 'queue': return t('Место в очереди: {position}', { position: progress.position || 1 });
    case 'composite': return t('Восстанавливаем лицо и фон…');
    // 'outfit' is a whole look in one provider call: there are no layers to count.
    case 'outfit': return t('Надеваем весь образ…');
    // A layered look: the base look is ready, the upper layers go on over it.
    case 'layers': return t('Надеваем верхние слои…');
    default: return stageName
      ? t('Надеваем: {name} ({step} из {total})…', { name: stageName(progress.stage), step: progress.done.length + 1, total: progress.total })
      : t('Генерируем образ…');
  }
}
