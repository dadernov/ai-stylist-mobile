import * as Location from 'expo-location';
import storage from './keyValueStorage';
import { Precipitation, precipitationFromCode } from '../domain/outfits';

export type Weather = { temperature: number; code: number | null; wind: number | null; city: string | null; precipitation: Precipitation; fetchedAt: number };
// 'location': the phone could not tell where it is (indoors, GPS off), which is
// not a network problem and should not be reported as one.
export type WeatherError = 'permission' | 'location' | 'network';

// Weather changes slowly: half an hour is fresh, and up to three hours an old
// value is shown at once while a new one loads.
const TTL = 30 * 60 * 1000;
const STALE_OK = 3 * 60 * 60 * 1000;
const STORAGE_KEY = 'lastWeather';
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

/** The last weather this phone saw, fresh or not older than three hours: shown at once on launch. */
export async function storedWeather(): Promise<Weather | null> {
  if (cached && Date.now() - cached.fetchedAt < STALE_OK) return cached;
  try {
    const value = JSON.parse((await storage.getItem(STORAGE_KEY)) || 'null') as Weather | null;
    if (value && typeof value.temperature === 'number' && Date.now() - value.fetchedAt < STALE_OK) {
      cached = cached && cached.fetchedAt > value.fetchedAt ? cached : value;
      return cached;
    }
  } catch { /* a missing or broken value only means no instant weather */ }
  return null;
}

// Weather needs the district, not the doorstep: a recent known position comes
// back at once, a fresh coarse fix in a few seconds even indoors, where a
// precise GPS fix used to time out.
async function position() {
  const recent = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60 * 1000, requiredAccuracy: 5000 }).catch(() => null);
  if (recent) return recent.coords;
  try {
    const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }), 10000, 'geolocation timeout');
    return fresh.coords;
  } catch {
    const old = await Location.getLastKnownPositionAsync({}).catch(() => null);
    if (old) return old.coords;
    throw new WeatherUnavailable('location');
  }
}

export async function fetchWeather(force = false): Promise<Weather> {
  const fresh = cachedWeather();
  if (fresh && !force) return fresh;
  if (inflight) return inflight;
  inflight = (async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new WeatherUnavailable('permission');
    const { latitude, longitude } = await position();
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}`
        + '&current=temperature_2m,weather_code,wind_speed_10m,precipitation&wind_speed_unit=ms&timezone=auto';
      const [response, geo] = await Promise.all([
        withTimeout(fetch(url), 8000, 'weather fetch timeout'),
        // The city name is a nicety: never wait long for it, never fail on it.
        withTimeout(Location.reverseGeocodeAsync({ latitude, longitude }), 5000, 'geocode timeout').catch(() => []),
      ]);
      const data = await response.json();
      const current = data?.current || {};
      if (typeof current.temperature_2m !== 'number') throw new Error('no temperature');
      const rawCode = current.weather_code ?? current.weathercode;
      const code = typeof rawCode === 'number' ? rawCode : null;
      let precipitation = precipitationFromCode(code);
      if (!precipitation && typeof current.precipitation === 'number' && current.precipitation > 0.1) {
        precipitation = current.temperature_2m <= 0 ? 'snow' : 'rain';
      }
      cached = {
        temperature: current.temperature_2m, code, precipitation,
        wind: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : null,
        city: geo[0]?.city || geo[0]?.subregion || geo[0]?.region || null, fetchedAt: Date.now()
      };
      void storage.setItem(STORAGE_KEY, JSON.stringify(cached)).catch(() => {});
      return cached;
    } catch (error) {
      if (error instanceof WeatherUnavailable) throw error;
      throw new WeatherUnavailable('network');
    }
  })();
  try { return await inflight; } finally { inflight = null; }
}
