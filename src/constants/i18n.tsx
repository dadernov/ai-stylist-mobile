import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { zh } from './translations';
import { en } from './translations.en';

// Локализация на основе исходной строки: русский текст в коде является ключом.
// Для 'en' и 'zh' строка ищется в своём словаре; если перевода нет — показывается
// исходный русский (безопасный фолбэк, ничего не ломается). Поддерживается
// подстановка переменных через {name}: t('Привет, {name}', { name: 'Аня' }).

export type Lang = 'ru' | 'en' | 'zh';
export const LANGUAGES: { code: Lang; label: string; locale: string }[] = [
  { code: 'ru', label: 'Русский', locale: 'ru-RU' },
  { code: 'en', label: 'English', locale: 'en-US' },
  { code: 'zh', label: '中文', locale: 'zh-CN' },
];
const DICTIONARIES: Record<Lang, Record<string, string> | null> = { ru: null, en, zh };
const isLang = (value: unknown): value is Lang => value === 'ru' || value === 'en' || value === 'zh';

const STORAGE_KEY = 'appLanguage';

/** Язык телефона как подсказка по умолчанию; финальный выбор делает человек. */
export function deviceLanguage(): Lang {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    if (locale.startsWith('ru') || locale.startsWith('uk') || locale.startsWith('be') || locale.startsWith('kk')) return 'ru';
    if (locale.startsWith('zh')) return 'zh';
    return 'en';
  } catch {
    return 'ru';
  }
}

// Модульный синглтон активного языка — чтобы перевод работал и вне React-компонентов
// (например, в функциях-построителях рекомендаций на уровне модуля).
let activeLang: Lang = deviceLanguage();

export function setActiveLang(lang: Lang) {
  activeLang = lang;
}

export function getActiveLang(): Lang {
  return activeLang;
}

export const localeFor = (lang: Lang = activeLang) => LANGUAGES.find(item => item.code === lang)?.locale || 'ru-RU';

/** Перевод на указанный язык, независимо от текущего языка интерфейса. */
export function translateIn(lang: Lang, source: string) {
  const dictionary = DICTIONARIES[lang];
  return dictionary ? dictionary[source] ?? source : source;
}

export function translate(source: string, vars?: Record<string, string | number>): string {
  const dictionary = DICTIONARIES[activeLang];
  let out = dictionary ? dictionary[source] ?? source : source;
  if (vars) {
    for (const key of Object.keys(vars)) {
      out = out.split(`{${key}}`).join(String(vars[key]));
    }
  }
  return out;
}

type LanguageContextValue = {
  lang: Lang;
  /** false, пока человек ни разу не выбрал язык (первый запуск). */
  chosen: boolean;
  ready: boolean;
  setLang: (lang: Lang) => void;
  toggle: () => void;
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'ru',
  chosen: true,
  ready: true,
  setLang: () => {},
  toggle: () => {}
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(activeLang);
  const [chosen, setChosen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (isLang(stored)) {
          setActiveLang(stored);
          setLangState(stored);
          setChosen(true);
        }
      })
      .catch((error) => console.warn('Failed to load language', error))
      .finally(() => setReady(true));
  }, []);

  // Держим модульный синглтон в синхроне до рендера детей.
  useMemo(() => setActiveLang(lang), [lang]);

  const setLang = (next: Lang) => {
    setActiveLang(next);
    setLangState(next);
    setChosen(true);
    AsyncStorage.setItem(STORAGE_KEY, next).catch((error) => console.warn('Failed to save language', error));
  };

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      chosen,
      ready,
      setLang,
      toggle: () => setLang(LANGUAGES[(LANGUAGES.findIndex(item => item.code === lang) + 1) % LANGUAGES.length].code)
    }),
    [lang, chosen, ready]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

// Хук-обёртка: возвращает функцию перевода, меняющую идентичность при смене языка,
// чтобы компоненты перерендеривались.
export function useT() {
  const { lang } = useLanguage();
  return useMemo(() => (source: string, vars?: Record<string, string | number>) => translate(source, vars), [lang]);
}
