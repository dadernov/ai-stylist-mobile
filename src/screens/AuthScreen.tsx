import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { ThemeColors } from '../constants/theme';
import { useTheme, useThemedStyles } from '../constants/ThemeContext';
import { AppPressable } from '../components/AppPressable';

type AuthScreenProps = {
  onLogin: (displayName: string, phone: string, method: string) => void;
};

type Step = 'phone' | 'code';

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
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [step, setStep] = useState<Step>('phone');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [demoOtp, setDemoOtp] = useState('');

  const formattedPhone = useMemo(() => formatPhone(phoneDigits), [phoneDigits]);

  const handlePhoneChange = (text: string) => {
    const digits = text.replace(/\D/g, '');
    if (digits.startsWith('8')) {
      setPhoneError('Номер должен начинаться с +7, а не с 8.');
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
      setPhoneError('Введите номер в формате +7 XXX XXX XX XX.');
      return;
    }

    const generated = String(Math.floor(1000 + Math.random() * 9000));
    setDemoOtp(generated);
    setStep('code');
    setOtp('');
    setOtpError('');

    if (__DEV__) {
      Alert.alert('DEV-режим', `Код подтверждения: ${generated}`);
    }
  };

  const verifyOtp = async () => {
    if (!otp.trim()) {
      setOtpError('Введите код из SMS.');
      return;
    }
    if (otp.trim() !== demoOtp) {
      setOtpError('Неверный код.');
      return;
    }

    const displayName = name.trim() || 'Гость';
    const phone = `+7${phoneDigits}`;
    onLogin(displayName, phone, 'Телефон');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Вход</Text>
      <Text style={styles.subtitle}>Подтверди номер телефона, чтобы сохранять гардероб и образы.</Text>

      {step === 'phone' ? (
        <View style={styles.form}>
          <Text style={styles.label}>Имя</Text>
          <TextInput
            placeholder="Например, Алина"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={name}
            onChangeText={setName}
          />
          <Text style={styles.label}>Телефон</Text>
          <TextInput
            placeholder="+7 999 000 00 00"
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="phone-pad"
            value={formattedPhone}
            onChangeText={handlePhoneChange}
          />
          {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}
          <AppPressable style={styles.primaryButton} onPress={requestOtp}>
            <Text style={styles.primaryButtonText}>Отправить код</Text>
          </AppPressable>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>Код из SMS</Text>
          <TextInput
            placeholder="4 цифры"
            placeholderTextColor={colors.muted}
            style={styles.input}
            keyboardType="number-pad"
            value={otp}
            onChangeText={setOtp}
            maxLength={4}
          />
          {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}
          <AppPressable style={styles.primaryButton} onPress={verifyOtp}>
            <Text style={styles.primaryButtonText}>Подтвердить</Text>
          </AppPressable>
          <AppPressable style={styles.linkButton} onPress={() => setStep('phone')}>
            <Text style={styles.linkText}>Изменить номер</Text>
          </AppPressable>
        </View>
      )}

      <Text style={styles.hint}>Реальную отправку SMS подключим на бэкенде. Сейчас это демо-режим.</Text>
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
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: c.text
  },
  subtitle: {
    marginTop: 6,
    fontSize: 14,
    color: c.muted,
    lineHeight: 20
  },
  form: {
    marginTop: 20,
    gap: 10
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: c.text
  },
  input: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: c.text
  },
  errorText: {
    color: '#B14444',
    fontSize: 12
  },
  primaryButton: {
    marginTop: 12,
    backgroundColor: c.buttonPrimaryBg,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center'
  },
  primaryButtonText: {
    color: c.buttonPrimaryText,
    fontSize: 16,
    fontWeight: '600'
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 4
  },
  linkText: {
    color: c.muted,
    fontSize: 13
  },
  hint: {
    marginTop: 12,
    fontSize: 12,
    color: c.muted
  }
});
