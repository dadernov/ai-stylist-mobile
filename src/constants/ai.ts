/**
 * Адрес и ключ AI-сервера.
 *
 * Раньше IP был зашит в код: смена хостинга требовала правки исходников и
 * новой сборки. Теперь оба значения приходят из конфигурации сборки, а
 * запасной адрес нужен только для локальной разработки.
 *
 * Токен уезжает в бандл, то есть его можно оттуда достать. Это не секрет, а
 * ключ, который поднимает порог и который можно отозвать на сервере, не
 * выпуская новую версию приложения; от утёкшего защищает суточная квота на
 * устройство. Настоящая защита появится вместе с аккаунтами.
 */
const FALLBACK_AI_BASE_URL = 'https://62.60.238.183.nip.io';

const envBaseUrl = process.env.EXPO_PUBLIC_AI_BASE_URL?.trim();

const selected = envBaseUrl && envBaseUrl.length > 0 ? envBaseUrl : FALLBACK_AI_BASE_URL;

export const AI_BASE_URL = selected.replace(/\/+$/, '');

export const AI_CLIENT_TOKEN = process.env.EXPO_PUBLIC_AI_CLIENT_TOKEN?.trim() || '';
