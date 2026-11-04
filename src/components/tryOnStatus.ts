import { TryOnProgress } from '../services/ai';

type Translate = (source: string, vars?: Record<string, string | number>) => string;

// A try-on takes about a minute from the tap to the finished look (50-60 s measured).
export const EXPECTED_TRYON_MS = 60000;

/** What a running try-on is doing now, in words; `stageName` names a garment of an older per-garment try-on. */
export function tryOnStatusLabel(progress: TryOnProgress | undefined, t: Translate, stageName?: (stage: string) => string) {
  if (!progress?.stage) return t('Создаю образ…');
  switch (progress.stage) {
    case 'upload': return t('Несём фото в примерочную…');
    case 'queue': return t('Твоё место в очереди: {position}', { position: progress.position || 1 });
    case 'composite': return t('Последние штрихи: лицо и фон…');
    // 'outfit' is a whole look in one provider call: there are no layers to count.
    case 'outfit': return t('Создаю образ…');
    // A layered look: the base look is ready, the upper layers go on over it.
    case 'layers': return t('Добавляем верхние слои…');
    default: return stageName
      ? t('Надеваем: {name} ({step} из {total})…', { name: stageName(progress.stage), step: progress.done.length + 1, total: progress.total })
      : t('Создаю образ…');
  }
}
