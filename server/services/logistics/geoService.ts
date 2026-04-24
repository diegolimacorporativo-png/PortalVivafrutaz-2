/**
 * Geo Service — VivaFrutaz
 * Integrates with ViaCEP (free, no API key) for Brazilian address lookup.
 * Optionally geocodes to lat/lng using Nominatim (OpenStreetMap, free).
 */

import axios from 'axios';

export interface CepResult {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge?: string;
  erro?: boolean;
  latitude?: number;
  longitude?: number;
}

/**
 * Looks up a Brazilian CEP via ViaCEP API (no API key required).
 */
export async function lookupCep(cep: string): Promise<CepResult | null> {
  const cleanCep = cep.replace(/\D/g, '');
  if (cleanCep.length !== 8) return null;

  try {
    const resp = await axios.get(`https://viacep.com.br/ws/${cleanCep}/json/`, { timeout: 5000 });
    if (resp.data?.erro) return null;
    return resp.data as CepResult;
  } catch {
    return null;
  }
}

/**
 * Geocodes an address string to lat/lng using Nominatim (OpenStreetMap).
 * Rate-limited to 1 request/second per OSM policy.
 */
export async function geocodeAddress(address: string, city: string, state: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const query = encodeURIComponent(`${address}, ${city}, ${state}, Brazil`);
    const resp = await axios.get(
      `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`,
      {
        timeout: 8000,
        headers: { 'User-Agent': 'VivaFrutaz-ERP/1.0' },
      }
    );
    if (resp.data?.length > 0) {
      return { lat: parseFloat(resp.data[0].lat), lng: parseFloat(resp.data[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Full lookup: CEP → address + coordinates.
 */
export async function lookupCepWithCoords(cep: string): Promise<CepResult | null> {
  const result = await lookupCep(cep);
  if (!result) return null;

  if (result.logradouro && result.localidade) {
    const coords = await geocodeAddress(result.logradouro, result.localidade, result.uf);
    if (coords) {
      result.latitude = coords.lat;
      result.longitude = coords.lng;
    }
  }

  return result;
}
