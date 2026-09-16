export type Gender = 'male' | 'female' | 'unspecified';

export type StylePreferences = {
  gender: Gender;
  beautyAdvice: boolean;
};

export const isGender = (value: unknown): value is Gender =>
  value === 'male' || value === 'female' || value === 'unspecified';

export const genderOptions: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
  { value: 'unspecified', label: 'Не указывать' }
];
