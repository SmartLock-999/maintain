import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const FALLBACK_URL = 'https://example.supabase.co'
const FALLBACK_KEY = 'public-anon-key'

export function getEnvMissing(): string[] {
  const missing: string[] = []
  if (!supabaseUrl || !supabaseUrl.trim()) missing.push('VITE_SUPABASE_URL')
  if (!supabaseAnonKey || !supabaseAnonKey.trim()) missing.push('VITE_SUPABASE_ANON_KEY')
  return missing
}

export const supabase = createClient(supabaseUrl?.trim() || FALLBACK_URL, supabaseAnonKey?.trim() || FALLBACK_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})
