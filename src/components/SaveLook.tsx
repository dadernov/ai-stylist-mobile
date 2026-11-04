import { createContext, Dispatch, ReactNode, SetStateAction, useContext, useEffect, useRef, useState } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Heart } from 'lucide-react-native';
import { useT } from '../constants/i18n';
import { useTheme } from '../constants/ThemeContext';
import { addLook, isLookSaved, removeLook } from '../domain/favorites';
import { successHaptic } from '../services/haptics';
import { durableLook } from '../services/tryOnPhotos';
import { GeneratedLook } from '../types/looks';
import { Pill } from './studio/Glass';
import { font } from './studio/studio';

type FavoritesApi = {
  favorites: GeneratedLook[];
  setFavorites: Dispatch<SetStateAction<GeneratedLook[]>>;
  login: string;
  notify: (message: string) => void;
};

const Context = createContext<FavoritesApi | null>(null);
export const FavoritesProvider = ({ value, children }: { value: FavoritesApi; children: ReactNode }) => <Context.Provider value={value}>{children}</Context.Provider>;

/** The favourites as they are; a window drawn through OverlayHost hands them on with FavoritesProvider, being outside this tree. */
export function useFavorites() {
  const api = useContext(Context);
  if (!api) throw new Error('Missing favorites provider');
  return api;
}

/** The one way to save a look anywhere in the app: one tap saves (its picture as a kept file), the next removes. */
export function useSaveLook(look: GeneratedLook | null | undefined, options?: { onAdded?: () => void }) {
  const { favorites, setFavorites, login, notify } = useFavorites();
  const t = useT();
  const saved = look ? isLookSaved(favorites, look) : false;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // A failure belongs to the look it happened to.
  useEffect(() => { setFailed(false); }, [look?.id, look?.tryOnImageUri]);
  /** Saves; a look already saved stays as it is (a double tap on the photo never unsaves). True only when this call saved it. */
  const save = async () => {
    if (!look || working.current || saved) return false;
    setFailed(false);
    working.current = true;
    setBusy(true);
    try {
      const kept = await durableLook(look, login);
      setFavorites(previous => addLook(previous, kept));
      successHaptic();
      notify(t('Добавлено в избранное'));
      options?.onAdded?.();
      return true;
    } catch {
      if (mounted.current) setFailed(true);
      return false;
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const toggle = async () => {
    if (!look || working.current) return;
    if (!saved) { await save(); return; }
    setFailed(false);
    // A bare look seen over a favourite with a picture: the picture is not this heart's to delete.
    if (removeLook(favorites, look) === favorites) { notify(t('Образ остаётся в избранном вместе с примеркой')); return; }
    setFavorites(previous => removeLook(previous, look));
    notify(t('Убрано из избранного'));
  };
  return { saved, busy, failed, save, toggle };
}

/** «Сохранить в избранное», «В избранном» once saved. `compact` is for a narrow card. A failure is said under it: a toast can't show over a window on iOS. */
export function SaveLookButton({ look, variant = 'glass', compact, style, onAdded }: {
  look: GeneratedLook; variant?: 'glass' | 'primary'; compact?: boolean; style?: StyleProp<ViewStyle>; onAdded?: () => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const { saved, busy, failed, toggle } = useSaveLook(look, { onAdded });
  return (
    <View style={[styles.wrap, style]}>
      <Pill variant={saved ? 'glass' : variant} size={compact ? 'sm' : 'md'} icon={Heart} iconFill={saved} loading={busy}
        title={saved ? t('В избранном') : compact ? t('В избранное') : t('Сохранить в избранное')}
        accessibilityLabel={saved ? t('В избранном') : t('Сохранить в избранное')} accessibilityState={{ selected: saved }}
        onPress={() => { void toggle(); }} />
      {failed ? <Text accessibilityRole="alert" style={[font('regular'), styles.error, { color: colors.danger }]}>{t('Не удалось сохранить образ. Проверь интернет и место на устройстве.')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  error: { fontSize: 13, lineHeight: 18 }
});
