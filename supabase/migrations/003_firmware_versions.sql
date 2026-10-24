-- ─────────────────────────────────────────────────────────────
-- ESP 韌體版本管理：管理員上傳 .bin 後，透過 MQTT 指令讓設備遠端更新
-- ─────────────────────────────────────────────────────────────

-- 1) Storage bucket：韌體檔案（公開讀取，ESP32 可直接以 URL 下載）
INSERT INTO storage.buckets (id, name, public)
VALUES ('firmware', 'firmware', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2) Storage 政策：任何人可讀取（ESP32 下載用），登入者可寫入
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'firmware_public_read'
  ) THEN
    CREATE POLICY firmware_public_read ON storage.objects
      FOR SELECT TO anon, authenticated
      USING (bucket_id = 'firmware');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'firmware_auth_write'
  ) THEN
    CREATE POLICY firmware_auth_write ON storage.objects
      FOR ALL TO authenticated
      USING (bucket_id = 'firmware')
      WITH CHECK (bucket_id = 'firmware');
  END IF;
END $$;

-- 3) 韌體版本表：記錄每個伺服器上傳過的版本
CREATE TABLE IF NOT EXISTS public.firmware_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_no INTEGER NOT NULL,
  version TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size BIGINT,
  notes TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_firmware_versions_server
  ON public.firmware_versions (server_no, created_at DESC);

ALTER TABLE public.firmware_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'firmware_versions' AND policyname = 'firmware_versions_select'
  ) THEN
    CREATE POLICY firmware_versions_select ON public.firmware_versions
      FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'firmware_versions' AND policyname = 'firmware_versions_write'
  ) THEN
    CREATE POLICY firmware_versions_write ON public.firmware_versions
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT ON public.firmware_versions TO anon;
GRANT ALL PRIVILEGES ON public.firmware_versions TO authenticated;
