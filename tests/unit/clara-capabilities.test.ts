import assert from 'node:assert/strict';
import test from 'node:test';

const { getClaraWeather, getClaraJoke, isClaraJokeRequest, isClaraWeatherRequest } = await import('../../server/modules/clara/weather');
const { advanceProductCreation, createClaraProduct } = await import('../../server/modules/clara/product-creation');

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('Clara weather requests current API fields and formats the returned observation', async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.hostname.startsWith('geocoding-api')) {
      return jsonResponse({ results: [{ latitude: -23.5, longitude: -46.6, name: 'São Paulo', country: 'Brasil' }] });
    }
    return jsonResponse({ current: {
      temperature_2m: 24, apparent_temperature: 25, relative_humidity_2m: 60,
      weather_code: 61, wind_speed_10m: 8, time: '2026-10-26T12:00',
    } });
  };
  const result = await getClaraWeather('Qual o clima em São Paulo?', fetcher);
  assert.match(urls[1]!.searchParams.get('current')!, /weather_code/);
  assert.match(urls[1]!.searchParams.get('current')!, /wind_speed_10m/);
  assert.doesNotMatch(urls[1]!.searchParams.get('current')!, /weathercode|windspeed_10m/);
  assert.match(result.response, /24°C/);
  assert.match(result.response, /Chuva leve/);
  assert.equal(result.data?.cidade, 'São Paulo, Brasil');
});

test('Clara weather requests a daily tomorrow forecast and formats rain probability', async () => {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.hostname.startsWith('geocoding-api')) return jsonResponse({ results: [{ latitude: 1, longitude: 2, name: 'Curitiba', country: 'Brasil' }] });
    return jsonResponse({ daily: {
      weather_code: [0, 63], temperature_2m_max: [20, 25], temperature_2m_min: [10, 16],
      precipitation_probability_max: [0, 70],
    } });
  };
  const result = await getClaraWeather('Vai chover amanhã em Curitiba?', fetcher);
  assert.match(urls[1]!.searchParams.get('daily')!, /weather_code/);
  assert.equal(urls[1]!.searchParams.get('forecast_days'), '2');
  assert.match(result.response, /16°C a 25°C/);
  assert.match(result.response, /70%/);
});

test('Clara reports unknown cities and API failures without fabricating weather', async () => {
  const noCityFetcher: typeof fetch = async () => jsonResponse({ results: [] });
  assert.match((await getClaraWeather('clima em lugar inexistente', noCityFetcher)).response, /não encontrada/);
  const failingFetcher: typeof fetch = async () => new Response('', { status: 503 });
  await assert.rejects(getClaraWeather('clima em Curitiba', failingFetcher), /Geocoding HTTP 503/);
});

test('Clara can tell a deterministic synthetic joke', () => {
  assert.match(getClaraJoke(1), /uva/);
  assert.equal(isClaraJokeRequest('Clara, me conta uma piada!'), true);
  assert.equal(isClaraJokeRequest('me fala uma piada'), true);
  assert.equal(isClaraJokeRequest('lista de produtos'), false);
  assert.equal(isClaraWeatherRequest('Clara, qual o clima em Curitiba?'), true);
});

test('product flow requires all fields and an explicit confirmation before persistence', () => {
  const name = advanceProductCreation({ action: 'create_product', step: 'name', data: {} }, 'Maçã Fuji');
  assert.equal(name.context?.step, 'category');
  const rejectedCategory = advanceProductCreation(name.context!, 'Fruta', ['Frutas']);
  assert.equal(rejectedCategory.context?.step, 'category');
  assert.match(rejectedCategory.response, /Escolha uma categoria existente/);
  const category = advanceProductCreation(name.context!, 'frutas', ['Frutas']);
  assert.equal(category.context?.step, 'unit');
  const unit = advanceProductCreation(category.context!, 'kg');
  assert.equal(unit.context?.step, 'confirm');
  assert.equal(advanceProductCreation(unit.context!, 'não sei').create, undefined);
  assert.equal(advanceProductCreation(unit.context!, 'cancelar').cancelled, true);
  const confirmed = advanceProductCreation(unit.context!, 'confirmar');
  assert.deepEqual(confirmed.create, { name: 'Maçã Fuji', category: 'Frutas', unit: 'kg' });
});

test('Clara uses and returns the database-generated product ID', async () => {
  let calls = 0;
  let insertedInput: Record<string, unknown> | undefined;
  const created = await createClaraProduct(
    { name: 'Maçã Fuji', category: 'Frutas', unit: 'kg' },
    async (input) => {
      calls++;
      insertedInput = input;
      return { ...input, id: 734, name: input.name!, category: input.category!, unit: input.unit! };
    },
  );
  assert.equal(calls, 1);
  assert.equal(created.id, 734);
  assert.equal('id' in (insertedInput || {}), false);
  assert.equal(insertedInput?.basePrice, null);
});
