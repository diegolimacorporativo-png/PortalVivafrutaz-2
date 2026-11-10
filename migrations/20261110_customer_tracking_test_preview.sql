-- Short-lived administrative preview for testing the customer tracking page.
-- This setting never changes delivery, route, journey, or GPS records.
ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS customer_tracking_preview_until TIMESTAMP,
  ADD COLUMN IF NOT EXISTS customer_tracking_preview_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
