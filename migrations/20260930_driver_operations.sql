CREATE TABLE IF NOT EXISTS driver_journeys (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES logistics_drivers(id),
  empresa_id INTEGER REFERENCES companies(id),
  vehicle_id INTEGER REFERENCES logistics_vehicles(id),
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMP NOT NULL DEFAULT now(),
  ended_at TIMESTAMP,
  start_latitude NUMERIC(10,7),
  start_longitude NUMERIC(10,7),
  end_latitude NUMERIC(10,7),
  end_longitude NUMERIC(10,7),
  start_odometer NUMERIC(12,2),
  end_odometer NUMERIC(12,2),
  observation TEXT,
  device_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE UNIQUE INDEX IF NOT EXISTS driver_journeys_one_active ON driver_journeys(driver_id) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS driver_odometer_entries (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES logistics_drivers(id),
  empresa_id INTEGER REFERENCES companies(id),
  vehicle_id INTEGER REFERENCES logistics_vehicles(id),
  journey_id INTEGER REFERENCES driver_journeys(id),
  value NUMERIC(12,2) NOT NULL,
  entry_type TEXT NOT NULL,
  observation TEXT,
  recorded_at TIMESTAMP NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS driver_fuel_entries (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES logistics_drivers(id),
  empresa_id INTEGER REFERENCES companies(id),
  vehicle_id INTEGER REFERENCES logistics_vehicles(id),
  liters NUMERIC(10,3) NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL,
  odometer NUMERIC(12,2),
  fuel_type TEXT NOT NULL,
  station_name TEXT,
  receipt_base64 TEXT,
  observation TEXT,
  recorded_at TIMESTAMP NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS delivery_proofs (
  id SERIAL PRIMARY KEY,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id),
  driver_id INTEGER NOT NULL REFERENCES logistics_drivers(id),
  empresa_id INTEGER REFERENCES companies(id),
  signature_base64 TEXT,
  photos_json TEXT,
  observation TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  captured_at TIMESTAMP NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL UNIQUE
);
