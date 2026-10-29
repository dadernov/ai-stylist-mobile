import { useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, Text, TextInput, View, Linking } from 'react-native';
import { FormScrollView } from '../components/ui/FormScrollView';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Glass, Pill } from '../components/studio/Glass';
import { font, glassFill, hairline, inkSoft, INK, INK_ON_DARK } from '../components/studio/studio';
import { AppPressable } from '../components/AppPressable';
import { FadeInView } from '../components/ui/FadeInView';
import { registerAccount, signIn, Session } from '../services/auth';
import { privacyUrl } from '../constants/ai';

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
  const { colors, isDark } = useTheme();
  const ink = isDark ? INK_ON_DARK : INK;
  const soft = inkSoft(isDark);
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

  const fieldStyle = (field: Field) => [styles.input,
    { color: ink, backgroundColor: glassFill(isDark), borderColor: focused === field ? ink : hairline(isDark) }];

  return (
    // The studio backdrop is drawn by App behind the safe area, so it runs under the notch and home indicator.
    <FormScrollView contentContainerStyle={styles.container}>

      <ScreenHeader
        title={t(mode === 'register' ? 'Регистрация' : 'Вход')}
        subtitle={t(returning
          ? 'Вход по SMS больше не используется. Заведи логин и пароль — гардероб и образы останутся на месте.'
          : 'Логин и пароль, чтобы сохранять гардероб и образы.')}
      />

      <Glass radius={28} style={styles.card}><FadeInView key={mode} style={styles.form}>
        {mode === 'register' && (
          <>
            <Text style={[styles.label, { color: soft }]}>{t('Имя')}</Text>
            <TextInput
              placeholder={t('Например, Алина')}
              placeholderTextColor={soft}
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

        <Text style={[styles.label, { color: soft }]}>{t('Логин')}</Text>
        <TextInput
          placeholder="alina"
          placeholderTextColor={soft}
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

        <Text style={[styles.label, { color: soft }]}>{t('Пароль')}</Text>
        <TextInput
          placeholder="••••••••"
          placeholderTextColor={soft}
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
        {mode === 'register' && <Text style={[styles.hint, { color: soft }]}>{t('Не короче 8 символов.')}</Text>}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pill
          variant="primary"
          title={t(mode === 'register' ? 'Создать аккаунт' : 'Войти')}
          onPress={submit}
          disabled={busy}
          busy={busy}
          haptics={false}
          style={styles.submitButton}
        />
        {busy && <ActivityIndicator color={ink} />}
        {mode === 'register' && <AppPressable accessibilityRole="link" onPress={() => { void Linking.openURL(privacyUrl()).catch(() => {}); }}>
          <Text style={[styles.legal, { color: soft }]}>
            {t('Создавая аккаунт, ты принимаешь')} <Text style={[styles.legalLink, { color: ink }]}>{t('политику конфиденциальности')}</Text>.
          </Text>
        </AppPressable>}

        <AppPressable
          onPress={() => { setMode(mode === 'register' ? 'signIn' : 'register'); setError(''); }}
          accessibilityRole="button"
        >
          <Text style={[styles.switch, { color: ink }]}>
            {t(mode === 'register' ? 'Уже есть аккаунт — войти' : 'Нет аккаунта — зарегистрироваться')}
          </Text>
        </AppPressable>
      </FadeInView></Glass>
    </FormScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flexGrow: 1, padding: 20, gap: 18, justifyContent: 'center' },
  card: { borderRadius: 28 },
  form: { gap: 10, padding: 20 },
  label: { ...font('medium'), fontSize: 13, marginTop: 6 },
  input: { ...font('regular'), borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16 },
  hint: { ...font('regular'), fontSize: 12 },
  errorText: { ...font('medium'), color: c.danger, fontSize: 13 },
  submitButton: { marginTop: 14 },
  switch: { ...font('semibold'), fontSize: 14, textAlign: 'center', paddingVertical: 12 },
  legal: { ...font('regular'), fontSize: 12, lineHeight: 18, textAlign: 'center' },
  legalLink: { ...font('medium'), textDecorationLine: 'underline' }
});
