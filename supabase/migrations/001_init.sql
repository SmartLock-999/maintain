CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  name TEXT NOT NULL,
  ble_name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  mac_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_code TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS usage_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS location_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_lat NUMERIC;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_lng NUMERIC;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE devices
SET
  display_name = COALESCE(display_name, name),
  device_code = COALESCE(device_code, mac_address, ble_name)
WHERE
  display_name IS NULL OR device_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_devices_user_last_seen ON devices(user_id, last_seen_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_user_device_code ON devices(user_id, device_code);

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  lat NUMERIC NOT NULL,
  lng NUMERIC NOT NULL,
  accuracy_m NUMERIC,
  source TEXT NOT NULL DEFAULT 'browser_geolocation',
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_user_captured ON positions(user_id, captured_at DESC);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices' AND policyname='devices_select_own'
  ) THEN
    CREATE POLICY devices_select_own ON devices
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices' AND policyname='devices_write_own'
  ) THEN
    CREATE POLICY devices_write_own ON devices
      FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='positions' AND policyname='positions_select_own'
  ) THEN
    CREATE POLICY positions_select_own ON positions
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='positions' AND policyname='positions_insert_own'
  ) THEN
    CREATE POLICY positions_insert_own ON positions
      FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

GRANT SELECT ON devices TO anon;
GRANT ALL PRIVILEGES ON devices TO authenticated;
GRANT SELECT ON positions TO anon;
GRANT ALL PRIVILEGES ON positions TO authenticated;
