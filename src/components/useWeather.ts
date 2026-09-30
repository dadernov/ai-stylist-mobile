import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { cachedWeather, fetchWeather, storedWeather, Weather, WeatherError, WeatherUnavailable } from '../services/weather';

/**
 * The weather for a screen: the last known value at once, a fresh one loaded
 * in the background when it is older than half an hour, and again whenever the
 * app comes back to the foreground with stale weather.
 */
export function useWeather(active = true) {
  const [weather, setWeather] = useState<Weather | null>(cachedWeather());
  const [error, setError] = useState<WeatherError | null>(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null);
    try { const value = await fetchWeather(force); if (alive.current) setWeather(value); }
    catch (reason) { if (alive.current) setError(reason instanceof WeatherUnavailable ? reason.reason : 'network'); }
    finally { if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      const known = await storedWeather();
      if (cancelled) return;
      if (known) setWeather(current => current && current.fetchedAt >= known.fetchedAt ? current : known);
      if (!cachedWeather()) void load();
    })();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && !cachedWeather()) void load();
    });
    return () => { cancelled = true; subscription.remove(); };
  }, [active, load]);
  return { weather, error, loading, reload: () => load(true) };
}
