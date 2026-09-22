import { useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { FormScrollView } from '../components/ui/FormScrollView';
import { LinearGradient } from 'expo-linear-gradient';
import { RADII, ThemeColors, TYPE } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { AppPressable } from '../components/AppPressable';
import { FadeInView } from '../components/ui/FadeInView';
import { registerAccount, signIn, Session } from '../services/auth';

type AuthScreenProps = {
  onAuthenticated: (session: Session) => void;
  /** Раньше вход был по телефону; таким людям нужно объяснить, почему их спрашивают снова. */
  returning?: boolean;
};

type Mode = 'signIn' | 'register';
type Field = 'login' | 'password' | 'name';

export function AuthScreen({ onAuthenticated, returning = false }: AuthScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { colors } = useTheme();
  const [mode, setMode] = useState<Mode>(returning ? 'register' : 'signIn');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState<Field | null>(null);

  const submit = async () => {
    if (busy) return;
    Keyboard.dismiss();
    setError('');
    setBusy(true);
    try {
      const session = mode === 'register'
        ? await registerAccount(login.trim(), password, name.trim())
        : await signIn(login.trim(), password);
      onAuthenticated(session);
    } catch (problem: any) {
      setError(problem?.message || t('Не удалось войти. Попробуй ещё раз.'));
    } finally {
      setBusy(false);
    }
  };

  const fieldStyle = (field: Field) => [styles.input, focused === field && styles.inputFocused];

  return (
    <FormScrollView contentContainerStyle={styles.container}>
      <LinearGradient colors={[colors.heroTo, colors.heroFrom] as const} style={StyleSheet.absoluteFill} pointerEvents="none" />

      <ScreenHeader
        eyebrow={t('Добро пожаловать')}
        title={t(mode === 'register' ? 'Регистрация' : 'Вход')}
        subtitle={t(returning
          ? 'Вход по SMS больше не используется. Заведи логин и пароль — гардероб и образы останутся на месте.'
          : 'Логин и пароль, чтобы сохранять гардероб и образы.')}
      />

      <FadeInView key={mode} style={styles.form}>
        {mode === 'register' && (
          <>
            <Text style={styles.label}>{t('Имя')}</Text>
            <TextInput
              placeholder={t('Например, Алина')}
              placeholderTextColor={colors.muted}
              style={fieldStyle('name')}
              value={name}
              onChangeText={setName}
              onFocus={() => setFocused('name')}
              onBlur={() => setFocused(null)}
              accessibilityLabel={t('Имя')}
              returnKeyType="done"
              onSubmitEditing={Keyboard.dismiss}
            />
          </>
        )}

        <Text style={styles.label}>{t('Логин')}</Text>
        <TextInput
          placeholder="alina"
          placeholderTextColor={colors.muted}
          style={fieldStyle('login')}
          value={login}
          onChangeText={setLogin}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          onFocus={() => setFocused('login')}
          onBlur={() => setFocused(null)}
          accessibilityLabel={t('Логин')}
          returnKeyType="done"
          onSubmitEditing={Keyboard.dismiss}
        />

        <Text style={styles.label}>{t('Пароль')}</Text>
        <TextInput
          placeholder="••••••••"
          placeholderTextColor={colors.muted}
          style={fieldStyle('password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType={mode === 'register' ? 'newPassword' : 'password'}
          onFocus={() => setFocused('password')}
          onBlur={() => setFocused(null)}
          accessibilityLabel={t('Пароль')}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        {mode === 'register' && <Text style={styles.hint}>{t('Не короче 8 символов.')}</Text>}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <PrimaryButton
          title={t(mode === 'register' ? 'Создать аккаунт' : 'Войти')}
          onPress={submit}
          disabled={busy}
          variant="gold"
          size="lg"
          style={styles.submitButton}
        />
        {busy && <ActivityIndicator color={colors.accentGold} />}

        <AppPressable
          onPress={() => { setMode(mode === 'register' ? 'signIn' : 'register'); setError(''); }}
          accessibilityRole="button"
        >
          <Text style={styles.switch}>
            {t(mode === 'register' ? 'Уже есть аккаунт — войти' : 'Нет аккаунта — зарегистрироваться')}
          </Text>
        </AppPressable>
      </FadeInView>
    </FormScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flexGrow: 1, padding: 24, gap: 18, justifyContent: 'center' },
  form: { gap: 10 },
  label: { ...TYPE.caption, color: c.muted, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: c.border, borderRadius: RADII.md, paddingHorizontal: 16, paddingVertical: 14,
    color: c.text, backgroundColor: c.card, fontSize: 16
  },
  inputFocused: { borderColor: c.accentGold },
  hint: { color: c.muted, fontSize: 12 },
  errorText: { color: c.danger, fontSize: 13 },
  submitButton: { marginTop: 14 },
  switch: { color: c.accentGold, fontSize: 14, textAlign: 'center', paddingVertical: 12 }
});
