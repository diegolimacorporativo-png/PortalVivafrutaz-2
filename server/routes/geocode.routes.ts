import type { Express } from "express";

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const geocodeCache = new Map<string, { expiresAt: number; results: GeocodeResult[] }>();
let nextNominatimRequestAt = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

export interface GeocodeResult {
  lat: string;
  lon: string;
  display_name?: string;
}

function queryValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildGeocodeUrl(query: Record<string, unknown>): URL | null {
  const street = queryValue(query.street);
  const number = queryValue(query.number);
  const city = queryValue(query.city);
  const state = queryValue(query.state);
  const neighborhood = queryValue(query.neighborhood);
  const postalCode = queryValue(query.postalcode).replace(/\D/g, "");
  const freeText = queryValue(query.q);

  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "br");
  url.searchParams.set("addressdetails", "1");

  if (street || city || postalCode) {
    if (street) {
      const streetLine = [number, street].filter(Boolean).join(" ");
      url.searchParams.set("street", neighborhood ? `${streetLine}, ${neighborhood}` : streetLine);
    }
    if (city) url.searchParams.set("city", city);
    if (state) url.searchParams.set("state", state);
    if (postalCode.length === 8) url.searchParams.set("postalcode", postalCode);
  } else if (freeText) {
    url.searchParams.set("q", freeText);
  } else {
    return null;
  }

  return url;
}

async function fetchNominatim(url: URL): Promise<Response> {
  // Nominatim's public endpoint asks applications to stay at or below one
  // request per second. This queue and the cache apply within this Node process.
  let release!: () => void;
  const previous = nominatimQueue;
  nominatimQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const delay = Math.max(0, nextNominatimRequestAt - Date.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    nextNominatimRequestAt = Date.now() + 1100;
    return await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'VivaFrutaz/1.0 (comercial@vivafrutaz.com)',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        Accept: 'application/json',
      },
    });
  } finally {
    release();
  }
}

function normalizeResults(payload: unknown): GeocodeResult[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item: any) => {
    const lat = Number(item?.lat);
    const lon = Number(item?.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      return [];
    }
    return [{ lat: String(lat), lon: String(lon), display_name: typeof item.display_name === "string" ? item.display_name : undefined }];
  });
}

export function register(app: Express) {
  app.get('/api/geocode', async (req, res) => {
    const url = buildGeocodeUrl(req.query as Record<string, unknown>);
    if (!url) return res.status(400).json({ message: 'Informe rua, cidade, CEP ou endereço para localizar.' });

    const cacheKey = url.toString();
    const cached = geocodeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return res.json(cached.results);

    try {
      const response = await fetchNominatim(url);
      if (!response.ok) {
        // Keep the provider's response body out of the API/logs; it may contain
        // upstream diagnostics and is not useful to the end user.
        return res.status(response.status === 429 ? 503 : 502).json({
          message: response.status === 429
            ? 'O serviço de mapas está temporariamente ocupado. Tente novamente em instantes.'
            : 'Não foi possível consultar o serviço de mapas agora.',
        });
      }

      const results = normalizeResults(await response.json());
      geocodeCache.set(cacheKey, { results, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
      if (geocodeCache.size > 500) {
        const firstKey = geocodeCache.keys().next().value;
        if (firstKey) geocodeCache.delete(firstKey);
      }
      return res.json(results);
    } catch {
      return res.status(503).json({ message: 'O serviço de mapas não respondeu. Confira a conexão e tente novamente.' });
    }
  });
}
