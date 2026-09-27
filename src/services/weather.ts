import * as Location from 'expo-location';
import { Precipitation, precipitationFromCode } from '../domain/outfits';

// Одна точка получения погоды для «Конструктора» и «Идей»: температура, осадки,
// ветер (в м/с) и город. Результат кешируется, чтобы два экрана не спрашивали
// геопозицию и сеть дважды.
export type Weather = { temperature: number; code: number | null; wind: number | null; city: string | null; precipitation: Precipitation; fetchedAt: number };
export type WeatherError = 'permission' | 'network';

const TTL = 15 * 60 * 1000;
let cached: Weather | null = null;
let inflight: Promise<Weather> | null = null;

const withTimeout = <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> =>
  Promise.race([promise, new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(message)), ms))]);

/** Полная расшифровка кодов WMO от Open-Meteo (раньше код 63 показывался как «переменная облачность»). */
export function describeWeatherCode(code: number | null | undefined): string {
  if (typeof code !== 'number') return 'переменная облачность';
  if (code === 0) return 'ясно';
  if (code === 1) return 'переменная облачность';
  if (code === 2) return 'облачно';
  if (code === 3) return 'пасмурно';
  if (code === 45) return 'туман';
  if (code === 48) return 'изморозь';
  if (code >= 51 && code <= 57) return 'морось';
  if (code >= 61 && code <= 67) return 'дождь';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'снег';
  if (code >= 80 && code <= 82) return 'ливень';
  if (code >= 95) return 'гроза';
  return 'переменная облачность';
}

export class WeatherUnavailable extends Error {
  constructor(public reason: WeatherError) { super(reason); }
}

export function cachedWeather() {
  return cached && Date.now() - cached.fetchedAt < TTL ? cached : null;
}

export async function fetchWeather(force = false): Promise<Weather> {
  const fresh = cachedWeather();
  if (fresh && !force) return fresh;
  if (inflight) return inflight;
  inflight = (async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new WeatherUnavailable('permission');
    try {
      const location = await withTimeout(Location.getCurrentPositionAsync({}), 12000, 'geolocation timeout');
      const { latitude, longitude } = location.coords;
      // Город нужен только для подписи: если геокодер молчит, погода всё равно есть.
      const geo = await withTimeout(Location.reverseGeocodeAsync({ latitude, longitude }), 8000, 'geocode timeout').catch(() => []);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}`
        + '&current=temperature_2m,weathercode,wind_speed_10m,precipitation&wind_speed_unit=ms&timezone=auto';
      const response = await withTimeout(fetch(url), 8000, 'weather fetch timeout');
      const data = await response.json();
      const current = data?.current || {};
      if (typeof current.temperature_2m !== 'number') throw new Error('no temperature');
      const code = typeof current.weathercode === 'number' ? current.weathercode : null;
      // Код погоды описывает небо; если он «облачно», а осадки уже идут — верим осадкам.
      let precipitation = precipitationFromCode(code);
      if (!precipitation && typeof current.precipitation === 'number' && current.precipitation > 0.1) {
        precipitation = current.temperature_2m <= 0 ? 'snow' : 'rain';
      }
      cached = {
        temperature: current.temperature_2m, code, precipitation,
        wind: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : null,
        city: geo[0]?.city || null, fetchedAt: Date.now()
      };
      return cached;
    } catch (error) {
      if (error instanceof WeatherUnavailable) throw error;
      throw new WeatherUnavailable('network');
    }
  })();
  try { return await inflight; } finally { inflight = null; }
}
