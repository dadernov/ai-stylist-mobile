import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { zh } from './translations';

// Локализация на основе исходной строки: русский текст в коде является ключом.
// При языке 'zh' строка ищется в словаре zh; если перевода нет — показывается
// исходный русский (безопасный фолбэк, ничего не ломается). Поддерживается
// подстановка переменных через {name}: t('Привет, {name}', { name: 'Аня' }).

export type Lang = 'ru' | 'zh';

const STORAGE_KEY = 'appLanguage';

// Модульный синглтон активного языка — чтобы перевод работал и вне React-компонентов
// (например, в функциях-построителях рекомендаций на уровне модуля).
let activeLang: Lang = 'ru';

export function setActiveLang(lang: Lang) {
  activeLang = lang;
}

export function getActiveLang(): Lang {
  return activeLang;
}

export function translate(source: string, vars?: Record<string, string | number>): string {
  let out = activeLang === 'zh' ? zh[source] ?? source : source;
  if (vars) {
    for (const key of Object.keys(vars)) {
      out = out.split(`{${key}}`).join(String(vars[key]));
    }
  }
  return out;
}

type LanguageContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggle: () => void;
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'ru',
  setLang: () => {},
  toggle: () => {}
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ru');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'ru' || stored === 'zh') {
          setActiveLang(stored);
          setLangState(stored);
        }
      })
      .catch((error) => console.warn('Failed to load language', error));
  }, []);

  // Держим модульный синглтон в синхроне до рендера детей.
  useMemo(() => setActiveLang(lang), [lang]);

  const setLang = (next: Lang) => {
    setActiveLang(next);
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch((error) => console.warn('Failed to save language', error));
  };

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      toggle: () => setLang(lang === 'ru' ? 'zh' : 'ru')
    }),
    [lang]
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
