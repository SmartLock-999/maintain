-- 於 device_credentials 增加韌體版本欄位，記錄該設備最後一次派送的韌體版本
alter table public.device_credentials
  add column if not exists firmware_version text;
