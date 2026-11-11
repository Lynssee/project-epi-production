// src/lib/utils/weatherAssist.ts
// Smart Weather Assist untuk Laporan Harian Lapangan (project-epi, Fase 4)
// Mengambil prakiraan cuaca instan Open-Meteo berdasarkan GPS / Kota Proyek
// dan memetakan ke 5 opsi resmi sistem ('Cerah', 'Berawan', 'Gerimis', 'Hujan', 'Hujan Deras')

export type WeatherOption = 'Cerah' | 'Berawan' | 'Gerimis' | 'Hujan' | 'Hujan Deras';

export interface WeatherAssistResult {
  weather: WeatherOption;
  label: string;
  icon: string;
  temp: number;
  rainProb: number;
  humidity: number;
  windSpeed: number;
  locationName: string;
}

const memoryCache = new Map<string, { data: WeatherAssistResult; expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 menit di perangkat lapangan

/**
 * Pemetaan WMO weather code Open-Meteo ke 5 opsi cuaca Laporan Harian EPI
 */
export function mapWmoToWeatherOption(code: number, rainProb = 0): { weather: WeatherOption; icon: string; label: string } {
  const c = Number(code);
  if (c === 0 || (c === 1 && rainProb < 25)) {
    return { weather: 'Cerah', icon: '☀️', label: 'Cerah' };
  }
  if ([1, 2, 3, 45, 48].includes(c)) {
    return { weather: 'Berawan', icon: '⛅', label: 'Berawan' };
  }
  if ([51, 53, 55, 56, 57].includes(c)) {
    return { weather: 'Gerimis', icon: '🌦️', label: 'Gerimis' };
  }
  if ([61, 63, 80, 81].includes(c)) {
    return { weather: 'Hujan', icon: '🌧️', label: 'Hujan' };
  }
  if ([65, 66, 67, 82, 95, 96, 99].includes(c) || rainProb >= 70) {
    return { weather: 'Hujan Deras', icon: '⛈️', label: 'Hujan Deras' };
  }
  return { weather: 'Berawan', icon: '⛅', label: 'Berawan' };
}

/**
 * Bersihkan string nama kota
 */
export function cleanCity(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.split(',')[0].replace(/kabupaten|kota|kecamatan/gi, '').trim();
}

/**
 * Fetch cuaca lokasi live via Open-Meteo (Gratis, zero-key, fail-open)
 */
export async function fetchLiveSiteWeather({
  lat = null,
  lng = null,
  cityName = ''
}: {
  lat?: number | null;
  lng?: number | null;
  cityName?: string;
} = {}): Promise<WeatherAssistResult | null> {
  let targetLat = lat;
  let targetLng = lng;
  let locLabel = cityName || 'Lokasi GPS';

  const clean = cleanCity(cityName);

  // 1. Jika koordinat belum ada tapi ada nama kota, lakukan geocoding
  if ((targetLat == null || targetLng == null) && clean) {
    try {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=1&language=id&country=ID`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        const hit = geoData?.results?.[0];
        if (hit?.latitude && hit?.longitude) {
          targetLat = Number(hit.latitude);
          targetLng = Number(hit.longitude);
          locLabel = hit.name || clean;
        }
      }
    } catch {
      // fail-open
    }
  }

  // Fallback koordinat jika keduanya nihil
  if (targetLat == null || targetLng == null) {
    return null;
  }

  const cacheKey = `${targetLat.toFixed(2)},${targetLng.toFixed(2)}`;
  const now = Date.now();
  const cached = memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${targetLat}&longitude=${targetLng}&current_weather=true&hourly=relative_humidity_2m&daily=precipitation_probability_max&timezone=Asia%2FJakarta&forecast_days=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });

    if (res.ok) {
      const data = await res.json();
      const cur = data?.current_weather;
      const rainProb = Number(data?.daily?.precipitation_probability_max?.[0] || 0);

      // Ambil humidity terdekat
      const hourlyRh = data?.hourly?.relative_humidity_2m || [];
      const currentHour = new Date().getHours();
      const humidity = Number(hourlyRh[currentHour] || hourlyRh[0] || 75);

      if (cur) {
        const mapped = mapWmoToWeatherOption(cur.weathercode, rainProb);
        const result: WeatherAssistResult = {
          weather: mapped.weather,
          label: mapped.label,
          icon: mapped.icon,
          temp: Math.round(Number(cur.temperature) || 30),
          rainProb,
          humidity,
          windSpeed: Math.round(Number(cur.windspeed) || 0),
          locationName: locLabel
        };

        memoryCache.set(cacheKey, {
          data: result,
          expiresAt: now + CACHE_TTL_MS
        });

        return result;
      }
    }
  } catch {
    // fail-open: jangan putus alur laporan di lapangan
  }

  return null;
}
