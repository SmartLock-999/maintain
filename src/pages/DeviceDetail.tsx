import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, MapPin, RefreshCw } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/utils/supabase'
import { formatTs } from '@/utils/time'

type DeviceRow = {
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

type PositionRow = {
  id: string
  user_id: string
  lat: number
  lng: number
  accuracy_m: number | null
  captured_at: string
}

function osmEmbedUrl(lat: number, lng: number) {
  const pad = 0.01
  const left = lng - pad
  const right = lng + pad
  const top = lat + pad
  const bottom = lat - pad
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lng}`
}

export default function DeviceDetailPage() {
  const { deviceId } = useParams()
  const user = useAuthStore((s) => s.user)
  const [device, setDevice] = useState<DeviceRow | null>(null)
  const [positions, setPositions] = useState<PositionRow[]>([])
  const [selected, setSelected] = useState<{ lat: number; lng: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const canMap = (selected?.lat != null && selected?.lng != null) || (device?.last_lat != null && device?.last_lng != null)
  const mapUrl = useMemo(() => {
    if (!canMap) return null
    if (selected) return osmEmbedUrl(selected.lat, selected.lng)
    if (!device || device.last_lat == null || device.last_lng == null) return null
    return osmEmbedUrl(device.last_lat, device.last_lng)
  }, [canMap, device, selected])

  const fetchAll = useCallback(async () => {
    if (!deviceId || !user?.id) return
    setBusy(true)
    setErr(null)
    try {
      const dRes = await supabase
        .from('devices')
        .select(
          'id,user_id,device_code,display_name,name,mac_address,connection_status,usage_status,location_status,last_seen_at,last_lat,last_lng',
        )
        .eq('id', deviceId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (dRes.error) throw dRes.error
      setDevice((dRes.data as DeviceRow | null) ?? null)

      const pRes = await supabase
        .from('positions')
        .select('id,user_id,lat,lng,accuracy_m,captured_at')
        .eq('user_id', user.id)
        .order('captured_at', { ascending: false })
        .limit(50)
      if (pRes.error) throw pRes.error
      setPositions((pRes.data as PositionRow[]) ?? [])
    } catch (e) {
      const message = e instanceof Error ? e.message : '讀取失敗'
      setErr(message)
    } finally {
      setBusy(false)
    }
  }, [deviceId, user?.id])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!deviceId || !user?.id) return
    const channel = supabase
      .channel(`device_${deviceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'devices', filter: `id=eq.${deviceId}` },
        (payload) => {
          const next = payload.new as DeviceRow
          if (next.user_id !== user.id) return
          setDevice((prev) => ({ ...(prev ?? next), ...next }))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [deviceId, user?.id])

  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`positions_user_${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'positions', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as PositionRow
          setPositions((prev) => [row, ...prev].slice(0, 50))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Link className="inline-flex items-center gap-1 hover:text-slate-200" to="/">
              <ArrowLeft className="h-4 w-4" />
              總覽
            </Link>
          </div>
          <h1 className="mt-1 text-lg font-semibold tracking-wide">設備詳情</h1>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void fetchAll()} disabled={busy}>
          <RefreshCw className="h-4 w-4" />
          重新讀取
        </Button>
      </div>

      {err ? (
        <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{err}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>設備狀態</CardTitle>
            </CardHeader>
            <CardContent>
              {!device ? (
                <div className="text-sm text-slate-300">找不到設備或無權限</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-base font-semibold">{device.display_name ?? device.name ?? '未命名設備'}</div>
                      <div className="mt-1 font-mono text-xs text-slate-400">{device.device_code ?? device.mac_address ?? '—'}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="accent" label={`連線：${device.connection_status ?? 'unknown'}`} />
                      <StatusBadge tone="muted" label={`使用：${device.usage_status ?? 'unknown'}`} />
                      <StatusBadge tone="muted" label={`定位：${device.location_status ?? 'unknown'}`} />
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">最後回報：{formatTs(device.last_seen_at)}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>設備位置</CardTitle>
            </CardHeader>
            <CardContent>
              {!device ? null : canMap && mapUrl ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-slate-200">
                    <MapPin className="h-4 w-4 text-cyan-200" />
                    {selected ? `${selected.lat}, ${selected.lng}（選取位置）` : `${device.last_lat}, ${device.last_lng}`}
                  </div>
                  <div className="overflow-hidden rounded-lg border border-slate-800/60">
                    <iframe className="h-[420px] w-full" src={mapUrl} loading="lazy" title="device-map" />
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-300">尚無設備定位資料</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="h-full">
            <CardHeader>
              <CardTitle>帳號位置紀錄（每 5 分鐘）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
                {positions.length === 0 ? (
                  <div className="text-sm text-slate-300">尚無位置紀錄</div>
                ) : (
                  positions.map((p) => (
                    <button
                      key={p.id}
                      className="w-full rounded-lg border border-slate-800/60 bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
                      onClick={() => setSelected({ lat: p.lat, lng: p.lng })}
                    >
                      <div className="text-xs text-slate-400">{formatTs(p.captured_at)}</div>
                      <div className="mt-1 font-mono text-xs text-slate-200">
                        {p.lat}, {p.lng}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">accuracy: {p.accuracy_m ?? '—'}m</div>
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
