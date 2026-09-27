import { useCallback, useEffect, useState } from 'react';
import { cachedWeather, fetchWeather, Weather, WeatherError, WeatherUnavailable } from '../services/weather';

export function useWeather(active = true) {
  const [weather, setWeather] = useState<Weather | null>(cachedWeather());
  const [error, setError] = useState<WeatherError | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null);
    try { setWeather(await fetchWeather(force)); }
    catch (reason) { setError(reason instanceof WeatherUnavailable ? reason.reason : 'network'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (active && !cachedWeather()) void load(); }, [active, load]);
  return { weather, error, loading, reload: () => load(true) };
}
