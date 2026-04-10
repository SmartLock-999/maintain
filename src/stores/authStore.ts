import type { Session, User } from '@supabase/supabase-js'
import { create } from 'zustand'
import { supabase, getEnvMissing } from '@/utils/supabase'

type AuthState = {
  envMissing: string[]
  session: Session | null
  user: User | null
  isReady: boolean
  error: string | null
  setError: (v: string | null) => void
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  envMissing: getEnvMissing(),
  session: null,
  user: null,
  isReady: false,
  error: null,
  setError: (v) => set({ error: v }),
  signOut: async () => {
    const missing = get().envMissing
    if (missing.length) return
    await supabase.auth.signOut()
  },
}))

let authInitialized = false

export function initAuth() {
  if (authInitialized) return
  authInitialized = true

  const missing = getEnvMissing()
  useAuthStore.setState({ envMissing: missing })
  if (missing.length) {
    useAuthStore.setState({ isReady: true })
    return
  }

  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      useAuthStore.setState({ error: error.message, isReady: true })
      return
    }
    useAuthStore.setState({ session: data.session, user: data.session?.user ?? null, isReady: true })
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.setState({ session, user: session?.user ?? null })
  })
}
