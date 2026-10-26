export type ClaraWeatherFetch = typeof fetch;

const WMO_CODES: Record<number, [string, string]> = {
  0: ['Céu limpo', '☀️'], 1: ['Principalmente limpo', '🌤️'], 2: ['Parcialmente nublado', '⛅'],
  3: ['Nublado', '☁️'], 45: ['Névoa', '🌫️'], 48: ['Névoa com geada', '🌫️'],
  56: ['Garoa congelante leve', '🌧️'], 57: ['Garoa congelante intensa', '🌧️'],
  51: ['Garoa leve', '🌦️'], 53: ['Garoa moderada', '🌦️'], 55: ['Garoa intensa', '🌦️'],
  61: ['Chuva leve', '🌧️'], 63: ['Chuva moderada', '🌧️'], 65: ['Chuva forte', '🌧️'],
  66: ['Chuva congelante leve', '🌧️'], 67: ['Chuva congelante forte', '🌧️'], 77: ['Grãos de neve', '🌨️'],
  71: ['Neve leve', '🌨️'], 73: ['Neve moderada', '🌨️'], 75: ['Neve forte', '🌨️'],
  80: ['Pancadas de chuva leves', '🌦️'], 81: ['Pancadas de chuva moderadas', '🌧️'],
  82: ['Pancadas de chuva fortes', '🌧️'], 85: ['Neve rápida leve', '🌨️'], 86: ['Neve rápida forte', '🌨️'],
  95: ['Tempestade', '⛈️'], 96: ['Tempestade com granizo', '⛈️'], 99: ['Tempestade forte com granizo', '⛈️'],
};

function extractCity(message: string): string {
  const match = message.match(/\bem\s+(.+?)(?=\s+(?:hoje|amanh[ãa]|agora|essa semana|nesta semana)|[?!.,]|$)/i);
  return match?.[1]?.trim() || 'São Paulo';
}

export async function getClaraWeather(
  message: string,
  fetcher: ClaraWeatherFetch = fetch,
): Promise<{ response: string; data?: Record<string, unknown> }> {
  const city = extractCity(message);
  const request = (url: string) => fetcher(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'VivaFrutaz/1.0' },
  });
  const geoRes = await request(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`,
  );
  if (!geoRes.ok) throw new Error(`Geocoding HTTP ${geoRes.status}`);
  const geoData = await geoRes.json() as any;
  const location = geoData?.results?.[0];
  if (!location) {
    return { response: `⚠️ Cidade **"${city}"** não encontrada. Tente com outro nome (ex: "São Paulo", "Rio de Janeiro").` };
  }

  const { latitude, longitude, name: cityName, country } = location;
  const isTomorrow = /amanh[ãa]/i.test(message);
  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.searchParams.set('latitude', String(latitude));
  forecastUrl.searchParams.set('longitude', String(longitude));
  forecastUrl.searchParams.set('timezone', 'auto');
  if (isTomorrow) {
    forecastUrl.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
    forecastUrl.searchParams.set('forecast_days', '2');
  } else {
    forecastUrl.searchParams.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m');
    forecastUrl.searchParams.set('forecast_days', '1');
  }
  const weatherRes = await request(forecastUrl.toString());
  if (!weatherRes.ok) throw new Error(`Weather HTTP ${weatherRes.status}`);
  const weather = await weatherRes.json() as any;

  if (isTomorrow) {
    const day = 1;
    const code = weather?.daily?.weather_code?.[day];
    const [description, emoji] = WMO_CODES[code] ?? ['Condição desconhecida', '🌡️'];
    const maximum = weather?.daily?.temperature_2m_max?.[day];
    const minimum = weather?.daily?.temperature_2m_min?.[day];
    const rain = weather?.daily?.precipitation_probability_max?.[day];
    if (maximum == null || minimum == null) throw new Error('Forecast data unavailable');
    return {
      response: `${emoji} **Previsão para amanhã em ${cityName}${country ? `, ${country}` : ''}**\n\n` +
        `• ${emoji} Condição: **${description}**\n• 🌡️ Temperatura: **${Math.round(minimum)}°C a ${Math.round(maximum)}°C**\n` +
        (rain == null ? '' : `• ☔ Probabilidade máxima de precipitação: **${Math.round(rain)}%**\n`) +
        '\n_Projeção meteorológica Open-Meteo; a previsão pode mudar._',
      data: { cidade: `${cityName}, ${country}`, minima: minimum, maxima: maximum, descricao: description, probabilidadePrecipitacao: rain },
    };
  }

  const current = weather?.current;
  if (!current || current.temperature_2m == null) throw new Error('Current weather data unavailable');
  const code = current.weather_code;
  const [description, emoji] = WMO_CODES[code] ?? ['Condição desconhecida', '🌡️'];
  const temperature = Math.round(current.temperature_2m);
  const feelsLike = Math.round(current.apparent_temperature ?? temperature);
  const humidity = current.relative_humidity_2m;
  const wind = Math.round(current.wind_speed_10m ?? 0);
  const updatedAt = current.time || new Date().toISOString();
  return {
    response: `${emoji} **Clima em ${cityName}${country ? `, ${country}` : ''}**\n\n` +
      `• 🌡️ Temperatura: **${temperature}°C** (sensação ${feelsLike}°C)\n• ${emoji} Condição: **${description}**\n` +
      (humidity == null ? '' : `• 💧 Umidade: **${humidity}%**\n`) +
      `• 💨 Vento: **${wind} km/h**\n\n_Atualizado em: ${updatedAt} — Open-Meteo_`,
    data: { cidade: `${cityName}, ${country}`, temperatura: temperature, descricao: description, atualizadoEm: updatedAt },
  };
}

export function isClaraJokeRequest(message: string): boolean {
  const normalized = message.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /^\s*piadas?\b/.test(normalized) ||
    /\b(?:conte|conta|faca|faz|manda|me conta|me conte|me fala|fale)\b.*\bpiadas?\b/.test(normalized);
}

export function isClaraWeatherRequest(message: string): boolean {
  const normalized = message.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\b(?:clima|tempo|previsao do tempo|chuva|temperatura|vai chover|como esta o tempo)\b/.test(normalized);
}

const JOKES = [
  'Por que a banana foi ao médico? Porque não estava se sentindo muito bem… estava descascando! 🍌',
  'O que a uva falou quando foi pisada? Nada, só soltou um vinho! 🍇',
  'Por que a laranja não atravessou a rua? Porque preferiu ficar no suco! 🍊',
];
export function getClaraJoke(index = Math.floor(Math.random() * JOKES.length)): string {
  return `😄 ${JOKES[((index % JOKES.length) + JOKES.length) % JOKES.length]}`;
}
