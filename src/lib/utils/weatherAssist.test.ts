// src/lib/utils/weatherAssist.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mapWmoToWeatherOption, cleanCity, fetchLiveSiteWeather } from './weatherAssist';

describe('weatherAssist', () => {
  it('mapWmoToWeatherOption memetakan kode cuaca Open-Meteo ke opsi resmi laporan', () => {
    // Cerah
    expect(mapWmoToWeatherOption(0).weather).toBe('Cerah');
    expect(mapWmoToWeatherOption(1, 10).weather).toBe('Cerah');

    // Berawan
    expect(mapWmoToWeatherOption(2).weather).toBe('Berawan');
    expect(mapWmoToWeatherOption(3).weather).toBe('Berawan');

    // Gerimis
    expect(mapWmoToWeatherOption(51).weather).toBe('Gerimis');

    // Hujan
    expect(mapWmoToWeatherOption(61).weather).toBe('Hujan');
    expect(mapWmoToWeatherOption(80).weather).toBe('Hujan');

    // Hujan Deras
    expect(mapWmoToWeatherOption(65).weather).toBe('Hujan Deras');
    expect(mapWmoToWeatherOption(95).weather).toBe('Hujan Deras');
  });

  it('cleanCity membersihkan nama kota dan kabupaten', () => {
    expect(cleanCity('Cikarang, Jawa Barat')).toBe('Cikarang');
    expect(cleanCity('Kabupaten Bekasi, Jawa Barat')).toBe('Bekasi');
    expect(cleanCity('Kota Surabaya')).toBe('Surabaya');
    expect(cleanCity('')).toBe('');
  });

  it('fetchLiveSiteWeather mengambil cuaca via Open-Meteo dan mengembalikan saran', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('open-meteo.com/v1/forecast')) {
        return {
          ok: true,
          json: async () => ({
            current_weather: {
              temperature: 32.4,
              windspeed: 12.0,
              weathercode: 1
            },
            daily: {
              precipitation_probability_max: [15]
            },
            hourly: {
              relative_humidity_2m: [72]
            }
          })
        } as any;
      }
      return { ok: false } as any;
    });

    const res = await fetchLiveSiteWeather({ lat: -6.30, lng: 107.17, cityName: 'Cikarang' });

    expect(res).not.toBeNull();
    expect(res?.weather).toBe('Cerah');
    expect(res?.temp).toBe(32);
    expect(res?.rainProb).toBe(15);
    expect(res?.humidity).toBe(72);
    expect(res?.locationName).toBe('Cikarang');

    globalThis.fetch = origFetch;
  });
});
