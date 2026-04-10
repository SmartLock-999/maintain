import { create } from 'zustand'
import { supabase } from '@/utils/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export type DeviceStatus = 'online' | 'offline' | 'unknown'
export type UsageStatus = 'active' | 'idle' | 'unknown'
export type LocationStatus = 'ok' | 'stale' | 'unknown'

export type DeviceRow = {
  id: string
  user_id: string
  device_code: string | null
  display_name: string | null
  name: string | null
  mac_address: string | null
  connection_status: string | null
  usage_status: string | null
  location_status: string | null
  last_seen_at: string | null
  last_lat: number | null
  last_lng: number | null
}

type DevicesState = {
  devices: DeviceRow[]
  isLoading: boolean
  error: string | null
  setDevices: (rows: DeviceRow[]) => void
  fetchDevices: (userId: string) => Promise<void>
  subscribeDevices: (userId: string) => void
  unsubscribe: () => void
}

let channel: RealtimeChannel | null = null

export const useDevicesStore = create<DevicesState>((set, get) => ({
  devices: [],
  isLoading: false,
  error: null,
  setDevices: (rows) => set({ devices: rows }),
  fetchDevices: async (userId) => {
    set({ isLoading: true, error: null })
    const { data, error } = await supabase
      .from('devices')
      .select(
        'id,user_id,device_code,display_name,name,mac_address,connection_status,usage_status,location_status,last_seen_at,last_lat,last_lng',
      )
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false, nullsFirst: false })

    if (error) {
      set({ isLoading: false, error: error.message })
      return
    }
    set({ isLoading: false, devices: (data ?? []) as DeviceRow[] })
  },
  subscribeDevices: (userId) => {
    get().unsubscribe()

    channel = supabase
      .channel(`devices_user_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'devices', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as DeviceRow
          set((s) => {
            const existing = s.devices
            const idx = existing.findIndex((d) => d.id === row.id)
            if (payload.eventType === 'DELETE') {
              return { devices: existing.filter((d) => d.id !== (payload.old as DeviceRow).id) }
            }
            if (idx === -1) {
              return { devices: [row, ...existing] }
            }
            const next = [...existing]
            next[idx] = { ...next[idx], ...row }
            return { devices: next }
          })
        },
      )
      .subscribe()
  },
  unsubscribe: () => {
    if (channel) {
      supabase.removeChannel(channel)
      channel = null
    }
  },
}))
