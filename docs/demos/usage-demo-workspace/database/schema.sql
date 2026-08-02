CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  assigned_driver_id TEXT,
  scheduled_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);

CREATE TABLE delivery_incidents (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  severity INTEGER NOT NULL,
  decision_owner TEXT NOT NULL,
  next_handoff TEXT NOT NULL,
  opened_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP
);

