import { useMemo, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { RADII, ThemeColors, TYPE } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { useT } from '../constants/i18n';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { FadeInView } from '../components/ui/FadeInView';

type AuthScreenProps = {
  onLogin: (displayName: string, phone: string, method: string) => void;
};

type Step = 'phone' | 'code';

type Field = 'name' | 'phone' | 'otp';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const formatPhone = (digits: string) => {
  const part1 = digits.slice(0, 3);
  const part2 = digits.slice(3, 6);
  const part3 = digits.slice(6, 8);
  const part4 = digits.slice(8, 10);
  const chunks = [] as string[];
  if (part1) chunks.push(part1);
  if (part2) chunks.push(part2);
  if (part3) chunks.push(part3);
  if (part4) chunks.push(part4);
  return `+7 ${chunks.join(' ')}`.trim();
};

export function AuthScreen({ onLogin }: AuthScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const t = useT();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [step, setStep] = useState<Step>('phone');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [demoOtp, setDemoOtp] = useState('');
  const [focusedField, setFocusedField] = useState<Field | null>(null);

  const formattedPhone = useMemo(() => formatPhone(phoneDigits), [phoneDigits]);

  const handlePhoneChange = (text: string) => {
    const digits = text.replace(/\D/g, '');
    if (digits.startsWith('8')) {
      setPhoneError(t('Номер должен начинаться с +7, а не с 8.'));
      return;
    }
    let normalized = digits;
    if (normalized.startsWith('7')) normalized = normalized.slice(1);
    normalized = normalized.slice(0, 10);
    setPhoneDigits(normalized);
    setPhoneError('');
  };

  const requestOtp = async () => {
    if (phoneDigits.length !== 10) {
      setPhoneError(t('Введите номер в формате +7 XXX XXX XX XX.'));
      return;
    }

    const generated = String(Math.floor(1000 + Math.random() * 9000));
    setDemoOtp(generated);
    setStep('code');
    setOtp('');
    setOtpError('');

    if (__DEV__) {
      Alert.alert(t('DEV-режим'), t('Код подтверждения: {code}', { code: generated }));
    }
  };

  const verifyOtp = async () => {
    if (!otp.trim()) {
      setOtpError(t('Введите код из SMS.'));
      return;
    }
    if (otp.trim() !== demoOtp) {
      setOtpError(t('Неверный код.'));
      return;
    }

    const displayName = name.trim() || 'Гость';
    const phone = `+7${phoneDigits}`;
    onLogin(displayName, phone, 'Телефон');
  };

  const fieldStyle = (field: Field) => [styles.input, focusedField === field && styles.inputFocused];

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[colors.heroTo, colors.heroFrom] as const}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <ScreenHeader
        eyebrow={t('Добро пожаловать')}
        title={t('Вход')}
        subtitle={t('Подтверди номер телефона, чтобы сохранять гардероб и образы.')}
      />

      {step === 'phone' ? (
        <FadeInView key="phone" style={styles.form}>
          <Text style={styles.label}>{t('Имя')}</Text>
          <TextInput
            placeholder={t('Например, Алина')}
            placeholderTextColor={colors.muted}
            style={fieldStyle('name')}
            value={name}
            onChangeText={setName}
            onFocus={() => setFocusedField('name')}
            onBlur={() => setFocusedField(null)}
          />
          <Text style={styles.label}>{t('Телефон')}</Text>
          <TextInput
            placeholder="+7 999 000 00 00"
            placeholderTextColor={colors.muted}
            style={fieldStyle('phone')}
            keyboardType="phone-pad"
            value={formattedPhone}
            onChangeText={handlePhoneChange}
            onFocus={() => setFocusedField('phone')}
            onBlur={() => setFocusedField(null)}
          />
          {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
          <PrimaryButton
            title={t('Отправить код')}
            onPress={requestOtp}
            variant="gold"
            size="lg"
            style={styles.submitButton}
          />
        </FadeInView>
      ) : (
        <FadeInView key="code" style={styles.form}>
          <Text style={styles.label}>{t('Код из SMS')}</Text>
          <Text style={styles.sentTo}>{t('Код отправлен на номер {phone}', { phone: formattedPhone })}</Text>
          <TextInput
            placeholder="0000"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.otpInput, focusedField === 'otp' && styles.inputFocused]}
            keyboardType="number-pad"
            value={otp}
            onChangeText={setOtp}
            maxLength={4}
            onFocus={() => setFocusedField('otp')}
            onBlur={() => setFocusedField(null)}
          />
          {__DEV__ && demoOtp ? (
            <Text style={styles.devHint}>{t('Код для входа (демо): {code}', { code: demoOtp })}</Text>
          ) : null}
          {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}
          <PrimaryButton
            title={t('Подтвердить')}
            onPress={verifyOtp}
            variant="gold"
            size="lg"
            style={styles.submitButton}
          />
          <PrimaryButton title={t('Изменить номер')} onPress={() => setStep('phone')} variant="ghost" />
        </FadeInView>
      )}

      <Text style={styles.hint}>{t('Реальную отправку SMS подключим на бэкенде. Сейчас это демо-режим.')}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: c.background
  },
  form: {
    gap: 10
  },
  label: {
    ...TYPE.eyebrow,
    fontSize: 10.5,
    color: c.accentGold,
    marginTop: 4
  },
  sentTo: {
    ...TYPE.caption,
    color: c.muted
  },
  input: {
    backgroundColor: c.card,
    borderRadius: RADII.md,
    borderWidth: 1.5,
    borderColor: c.border,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 15,
    color: c.text
  },
  inputFocused: {
    borderColor: c.accentGold,
    backgroundColor: c.card
  },
  otpInput: {
    fontFamily: MONO,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 12,
    textAlign: 'center',
    paddingVertical: 14
  },
  devHint: {
    ...TYPE.caption,
    color: c.accentGold,
    backgroundColor: c.accentGoldSoft,
    borderWidth: 1,
    borderColor: c.goldHairline,
    borderRadius: RADII.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    overflow: 'hidden'
  },
  errorText: {
    ...TYPE.caption,
    color: c.danger
  },
  submitButton: {
    marginTop: 10
  },
  hint: {
    marginTop: 18,
    ...TYPE.caption,
    color: c.muted,
    textAlign: 'center'
  }
});
