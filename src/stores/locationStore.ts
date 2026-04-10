import { create } from 'zustand'

export type LocationPermission = 'unknown' | 'prompt' | 'granted' | 'denied'

type LocationState = {
  enabled: boolean
  permission: LocationPermission
  isReporting: boolean
  lastReportedAt: string | null
  lastError: string | null
  setEnabled: (v: boolean) => void
  setPermission: (v: LocationPermission) => void
  setReporting: (v: boolean) => void
  setLastReportedAt: (v: string | null) => void
  setLastError: (v: string | null) => void
}

export const useLocationStore = create<LocationState>((set) => ({
  enabled: false,
  permission: 'unknown',
  isReporting: false,
  lastReportedAt: null,
  lastError: null,
  setEnabled: (v) => set({ enabled: v }),
  setPermission: (v) => set({ permission: v }),
  setReporting: (v) => set({ isReporting: v }),
  setLastReportedAt: (v) => set({ lastReportedAt: v }),
  setLastError: (v) => set({ lastError: v }),
}))
