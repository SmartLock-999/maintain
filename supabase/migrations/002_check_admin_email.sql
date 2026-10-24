CREATE OR REPLACE FUNCTION public.check_admin_email(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.registered_emails r
    WHERE lower(coalesce(to_jsonb(r)->>'email', to_jsonb(r)->>'Email', '')) = lower(p_email)
      AND coalesce(to_jsonb(r)->>'permissions', to_jsonb(r)->>'Permissions', '') = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.check_admin_email(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.check_admin_email(TEXT) TO authenticated;

