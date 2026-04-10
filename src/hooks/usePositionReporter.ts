import { useEffect, useMemo, useRef } from 'react'
import { supabase } from '@/utils/supabase'
import { useLocationStore } from '@/stores/locationStore'

type ReporterOptions = {
  userId: string | null
}

const INTERVAL_MS = 5 * 60 * 1000

function toPermissionState(v: PermissionState): 'prompt' | 'granted' | 'denied' {
  if (v === 'granted') return 'granted'
  if (v === 'denied') return 'denied'
  return 'prompt'
}

export function usePositionReporter(opts: ReporterOptions) {
  const userId = opts.userId
  const enabled = useLocationStore((s) => s.enabled)
  const setEnabled = useLocationStore((s) => s.setEnabled)
  const setPermission = useLocationStore((s) => s.setPermission)
  const setReporting = useLocationStore((s) => s.setReporting)
  const setLastReportedAt = useLocationStore((s) => s.setLastReportedAt)
  const setLastError = useLocationStore((s) => s.setLastError)
  const timerRef = useRef<number | null>(null)

  const canUseGeolocation = useMemo(() => typeof navigator !== 'undefined' && !!navigator.geolocation, [])

  useEffect(() => {
    if (!userId) return
    if (!enabled) {
      setReporting(false)
      return
    }
    if (!canUseGeolocation) {
      setPermission('denied')
      setLastError('此瀏覽器不支援定位功能')
      return
    }

    let cancelled = false

    const stop = () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      setReporting(false)
    }

    const writeOnce = async () => {
      return new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            if (cancelled) return
            const capturedAt = new Date().toISOString()
            const { error } = await supabase.from('positions').insert({
              user_id: userId,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: pos.coords.accuracy,
              source: 'browser_geolocation',
              captured_at: capturedAt,
            })

            if (error) {
              setLastError(error.message)
              resolve()
              return
            }
            setLastError(null)
            setLastReportedAt(capturedAt)
            resolve()
          },
          (err) => {
            if (cancelled) return
            if (err.code === 1) {
              setPermission('denied')
              stop()
            }
            setLastError(err.message)
            resolve()
          },
          { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
        )
      })
    }

    const start = async () => {
      setReporting(true)
      await writeOnce()
      if (cancelled) return
      timerRef.current = window.setInterval(() => {
        void writeOnce()
      }, INTERVAL_MS)
    }

    const initPermission = async () => {
      try {
        if (!('permissions' in navigator)) {
          setPermission('unknown')
          await start()
          return
        }

        const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
        if (cancelled) return
        setPermission(toPermissionState(status.state))
        status.onchange = () => {
          setPermission(toPermissionState(status.state))
          if (status.state === 'denied') stop()
        }
        if (status.state === 'denied') {
          setLastError('定位權限已拒絕')
          stop()
          return
        }
        await start()
      } catch {
        setPermission('unknown')
        await start()
      }
    }

    void initPermission()

    return () => {
      cancelled = true
      stop()
    }
  }, [enabled, userId, canUseGeolocation, setLastError, setLastReportedAt, setPermission, setReporting])

  return {
    requestEnable: () => setEnabled(true),
  }
}
