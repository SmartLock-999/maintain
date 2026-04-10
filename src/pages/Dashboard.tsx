import { useEffect, useMemo, useRef, useState } from 'react'
import { Server, Users, Wifi } from 'lucide-react'
import type { MqttClient } from 'mqtt'
import mqtt from 'mqtt'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/utils/supabase'
import { formatTs } from '@/utils/time'
import { GooglePositionsMap } from '@/components/maps/GooglePositionsMap'

type RegisteredEmailRow = {
  email: string
  permissions?: string | null
  Permissions?: string | null
}

type DeviceCredentialRow = {
  id: string
  user_id: string
  device_name: string | null
  device_name_initial?: string | null
  device_name_custom?: string | null
  mqtt_user?: string | null
  mqtt_pass?: string | null
  server_no?: number | null
  share_from?: string | null
}

type MqttListRow = {
  server_no: number
  url: string
}

type PositionRow = {
  id: string
  user_id: string
  lat: number | string
  lng: number | string
  accuracy_m?: number | string | null
  captured_at?: string | null
  created_at?: string | null
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function getPermissions(row: RegisteredEmailRow | null | undefined): string {
  const v = row?.permissions ?? row?.Permissions
  return typeof v === 'string' ? v : ''
}

function displayDeviceName(d: DeviceCredentialRow): string {
  const custom = d.device_name_custom?.trim()
  if (custom) return custom
  const initial = d.device_name_initial?.trim()
  if (initial) return initial
  const name = d.device_name?.trim()
  if (name) return name
  const mqttUser = d.mqtt_user?.trim()
  if (mqttUser) return mqttUser
  return d.id
}

function normalizeBrokerUrl(raw: string): string {
  const s = raw.trim()
  if (/^wss?:\/\//i.test(s)) return s
  return `wss://${s}:8884/mqtt`
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const envMissing = useAuthStore((s) => s.envMissing)
  const [serverOk, setServerOk] = useState<boolean | null>(null)
  const [serverErr, setServerErr] = useState<string | null>(null)

  const [mqttList, setMqttList] = useState<MqttListRow[]>([])
  const [registered, setRegistered] = useState<RegisteredEmailRow[]>([])
  const [deviceCreds, setDeviceCreds] = useState<DeviceCredentialRow[]>([])
  const [positions, setPositions] = useState<PositionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [devicesModalOpen, setDevicesModalOpen] = useState(false)
  const [devicesModalUserId, setDevicesModalUserId] = useState<string | null>(null)

  const mqttClientsRef = useRef<Record<string, MqttClient | null>>({})
  const [mqttStatusByDeviceId, setMqttStatusByDeviceId] = useState<Record<string, string>>({})

  const mqttMap = useMemo(() => {
    const m: Record<number, string> = {}
    for (const row of mqttList) {
      if (row.server_no != null && row.url) m[row.server_no] = row.url
    }
    return m
  }, [mqttList])

  const adminCount = useMemo(() => registered.filter((r) => getPermissions(r) === 'admin').length, [registered])

  const deviceStatsByUser = useMemo(() => {
    const stats: Record<string, { owned: number; sharedIn: number; sharedOut: number; total: number }> = {}
    const ensure = (k: string) => (stats[k] ??= { owned: 0, sharedIn: 0, sharedOut: 0, total: 0 })
    for (const d of deviceCreds) {
      const userId = String(d.user_id ?? '')
      if (!userId) continue
      const s = ensure(userId)
      s.total += 1
      if (d.share_from) s.sharedIn += 1
      else s.owned += 1
      if (d.share_from) {
        const ownerId = String(d.share_from)
        if (ownerId) ensure(ownerId).sharedOut += 1
      }
    }
    return stats
  }, [deviceCreds])

  const positionsMarkers = useMemo(() => {
    const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || null
    const filtered = accountFilter === 'all' ? positions : positions.filter((p) => String(p.user_id) === accountFilter)
    const markers = filtered
      .map((p) => {
        const lat = asNumber(p.lat)
        const lng = asNumber(p.lng)
        if (lat === null || lng === null) return null
        const ts = p.captured_at ?? p.created_at ?? null
        return {
          id: p.id,
          lat,
          lng,
          title: String(p.user_id ?? ''),
          subtitle: ts ? formatTs(ts) : undefined,
        }
      })
      .filter(Boolean) as { id: string; lat: number; lng: number; title?: string; subtitle?: string }[]
    return { apiKey, markers }
  }, [accountFilter, positions])

  useEffect(() => {
    if (envMissing.length) {
      setServerOk(false)
      setServerErr('尚未設定 Supabase 環境變數')
      return
    }
    let cancelled = false
    const ping = async () => {
      const { error } = await supabase.from('devices').select('id', { count: 'exact', head: true }).limit(1)
      if (cancelled) return
      if (error) {
        setServerOk(false)
        setServerErr(error.message)
        return
      }
      setServerOk(true)
      setServerErr(null)
    }
    void ping()
    const t = window.setInterval(() => void ping(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [envMissing.length])

  useEffect(() => {
    if (envMissing.length) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setLoadError(null)
      const [mqttRes, regRes, devRes, posRes] = await Promise.all([
        supabase.from('mqtt_list').select('server_no, url').order('server_no', { ascending: true }),
        supabase.from('registered_emails').select('*').order('email', { ascending: true }),
        supabase
          .from('device_credentials')
          .select('id, user_id, device_name, device_name_initial, device_name_custom, mqtt_user, mqtt_pass, server_no, share_from'),
        supabase
          .from('positions')
          .select('id, user_id, lat, lng, accuracy_m, captured_at, created_at')
          .order('captured_at', { ascending: false, nullsFirst: false })
          .limit(200),
      ])

      if (cancelled) return
      const err =
        mqttRes.error?.message ||
        regRes.error?.message ||
        devRes.error?.message ||
        posRes.error?.message ||
        null
      if (err) {
        setLoadError(err)
        setLoading(false)
        return
      }

      setMqttList((mqttRes.data ?? []) as MqttListRow[])
      setRegistered((regRes.data ?? []) as RegisteredEmailRow[])
      setDeviceCreds((devRes.data ?? []) as DeviceCredentialRow[])
      setPositions((posRes.data ?? []) as PositionRow[])
      setLoading(false)
    }

    void run()
    const t = window.setInterval(() => void run(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [envMissing.length])

  const onOpenDevicesModal = (userId: string) => {
    setDevicesModalUserId(userId)
    setDevicesModalOpen(true)
  }

  const modalDevices = useMemo(() => {
    if (!devicesModalUserId) return []
    return deviceCreds.filter((d) => String(d.user_id) === devicesModalUserId)
  }, [deviceCreds, devicesModalUserId])

  const brokerUrlFor = (d: DeviceCredentialRow): string | null => {
    const no = d.server_no != null && d.server_no > 0 ? d.server_no : 1
    const raw = mqttMap[no]
    if (!raw) return null
    return normalizeBrokerUrl(raw)
  }

  const stopDeviceClient = (deviceId: string) => {
    const current = mqttClientsRef.current[deviceId]
    if (current) {
      try {
        current.end(true)
      } catch {
        void 0
      }
    }
    mqttClientsRef.current[deviceId] = null
    setMqttStatusByDeviceId((prev) => ({ ...prev, [deviceId]: 'Disconnected' }))
  }

  const testDeviceMqtt = (d: DeviceCredentialRow) => {
    const deviceId = d.id
    stopDeviceClient(deviceId)
    const url = brokerUrlFor(d)
    if (!url) {
      setMqttStatusByDeviceId((prev) => ({ ...prev, [deviceId]: 'NoServerUrl' }))
      return
    }
    if (!d.mqtt_user || !d.mqtt_pass) {
      setMqttStatusByDeviceId((prev) => ({ ...prev, [deviceId]: 'NoCredentials' }))
      return
    }

    setMqttStatusByDeviceId((prev) => ({ ...prev, [deviceId]: 'Connecting...' }))
    const client = mqtt.connect(url, {
      username: d.mqtt_user,
      password: d.mqtt_pass,
      reconnectPeriod: 3000,
      keepalive: 30,
      clean: true,
    })

    mqttClientsRef.current[deviceId] = client
    client.on('connect', () => setMqttStatusByDeviceId((prev) => ({ ...prev, [deviceId]: 'Connected' })))
    client.on('reconnect', () => setMqttStatusByDeviceId((prev) => ({ ...prev, [deviceId]: 'Connecting...' })))
    client.on('close', () => setMqttStatusByDeviceId((prev) => ({ ...prev, [deviceId]: 'Disconnected' })))
    client.on('error', () => setMqttStatusByDeviceId((prev) => ({ ...prev, [deviceId]: 'Error' })))
  }

  useEffect(() => {
    if (!devicesModalOpen) {
      for (const id of Object.keys(mqttClientsRef.current)) stopDeviceClient(id)
    }
  }, [devicesModalOpen])

  return (
    <AppShell>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs text-slate-400">即時監控</div>
          <h1 className="text-lg font-semibold tracking-wide">管理總覽</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (devicesModalUserId) onOpenDevicesModal(devicesModalUserId)
              else if (registered[0]?.email) onOpenDevicesModal(registered[0].email)
            }}
            disabled={!registered.length || envMissing.length > 0}
          >
            <Users className="h-4 w-4" />
            管理設備
          </Button>
        </div>
      </div>

      {envMissing.length ? (
        <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          尚未設定環境變數：{envMissing.join(', ')}（請參考 `.env.example`）
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>服務狀態</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <Server className="h-4 w-4 text-cyan-200" />
                Supabase 連線
              </div>
              <StatusBadge
                tone={serverOk === true ? 'success' : serverOk === false ? 'danger' : 'warning'}
                label={serverOk === true ? '正常' : serverOk === false ? '異常' : '檢查中'}
              />
            </div>
            <div className="mt-2 text-xs text-slate-400">{serverErr ? `錯誤：${serverErr}` : '每 30 秒自動檢查一次'}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>帳號</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <Users className="h-4 w-4 text-cyan-200" />
                註冊帳號
              </div>
              <StatusBadge
                tone={registered.length ? 'success' : 'muted'}
                label={`${registered.length} 筆`}
              />
            </div>
            <div className="mt-2 text-xs text-slate-400">管理員：{adminCount} 筆</div>
            <div className="mt-1 text-xs text-slate-400">登入：{user?.email ?? '—'}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>資料狀態</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-slate-400">設備</div>
                <div className="mt-1 text-lg font-semibold text-cyan-200">{deviceCreds.length}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">伺服器</div>
                <div className="mt-1 text-lg font-semibold text-slate-200">{mqttList.length}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">定位點</div>
                <div className="mt-1 text-lg font-semibold text-slate-200">{positions.length}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle>定位點（positions）</CardTitle>
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-400">帳號</div>
                <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
                  <option value="all">全部</option>
                  {registered.map((r) => (
                    <option key={r.email} value={r.email}>
                      {r.email}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadError ? (
              <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{loadError}</div>
            ) : (
              <GooglePositionsMap
                apiKey={positionsMarkers.apiKey}
                markers={positionsMarkers.markers}
                className="h-[420px] w-full overflow-hidden rounded-xl border border-slate-800/60"
              />
            )}
            <div className="mt-2 text-xs text-slate-400">最近 {positions.length} 筆（每 30 秒自動刷新）</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>MQTT 伺服器（mqtt_list）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mqttList.length === 0 ? (
                <div className="text-sm text-slate-300">{loading ? '讀取中…' : '目前沒有資料'}</div>
              ) : (
                mqttList.map((s) => (
                  <div key={s.server_no} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800/60 bg-white/5 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-slate-100">Server #{s.server_no}</div>
                      <div className="text-xs text-slate-400 break-all">{s.url}</div>
                    </div>
                    <div className="pt-0.5">
                      <StatusBadge tone="muted" label="Configured" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader>
          <CardTitle>註冊帳號（registered_emails）</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full">
            <thead className="bg-white/5">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Permissions</th>
                <th className="px-5 py-3 font-medium">Owned</th>
                <th className="px-5 py-3 font-medium">Shared In</th>
                <th className="px-5 py-3 font-medium">Shared Out</th>
                <th className="px-5 py-3 font-medium">Total</th>
                <th className="px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td className="px-5 py-5 text-sm text-slate-300" colSpan={7}>
                    讀取中…
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td className="px-5 py-5 text-sm text-rose-200" colSpan={7}>
                    {loadError}
                  </td>
                </tr>
              ) : registered.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-sm text-slate-300" colSpan={7}>
                    目前沒有資料
                  </td>
                </tr>
              ) : (
                registered.map((r) => {
                  const s = deviceStatsByUser[r.email] ?? { owned: 0, sharedIn: 0, sharedOut: 0, total: 0 }
                  const perms = getPermissions(r) || '—'
                  return (
                    <tr key={r.email} className="text-sm text-slate-200 hover:bg-white/5">
                      <td className="px-5 py-3 font-mono text-xs text-slate-200">{r.email}</td>
                      <td className="px-5 py-3">
                        <StatusBadge tone={perms === 'admin' ? 'success' : 'muted'} label={perms} />
                      </td>
                      <td className="px-5 py-3 text-slate-100">{s.owned}</td>
                      <td className="px-5 py-3 text-slate-100">{s.sharedIn}</td>
                      <td className="px-5 py-3 text-slate-100">{s.sharedOut}</td>
                      <td className="px-5 py-3 text-slate-100">{s.total}</td>
                      <td className="px-5 py-3">
                        <button
                          className="text-cyan-200 underline decoration-cyan-400/30 underline-offset-4 hover:text-cyan-100"
                          onClick={() => onOpenDevicesModal(r.email)}
                        >
                          查看設備
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={devicesModalOpen}
        title={devicesModalUserId ? `設備列表：${devicesModalUserId}` : '設備列表'}
        onClose={() => setDevicesModalOpen(false)}
      >
        <div className="space-y-3">
          {modalDevices.length === 0 ? (
            <div className="text-sm text-slate-300">沒有設備資料</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800/60">
              <table className="min-w-[980px] w-full">
                <thead className="bg-white/5">
                  <tr className="text-left text-xs text-slate-400">
                    <th className="px-4 py-3 font-medium">設備</th>
                    <th className="px-4 py-3 font-medium">server_no</th>
                    <th className="px-4 py-3 font-medium">mqtt_user</th>
                    <th className="px-4 py-3 font-medium">share_from</th>
                    <th className="px-4 py-3 font-medium">連線</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {modalDevices.map((d) => {
                    const status = mqttStatusByDeviceId[d.id] ?? 'Disconnected'
                    const tone: 'success' | 'warning' | 'danger' | 'muted' =
                      status === 'Connected'
                        ? 'success'
                        : status === 'Connecting...'
                          ? 'warning'
                          : status === 'Error'
                            ? 'danger'
                            : status === 'NoCredentials' || status === 'NoServerUrl'
                              ? 'muted'
                              : 'muted'
                    return (
                      <tr key={d.id} className="text-sm text-slate-200 hover:bg-white/5">
                        <td className="px-4 py-3">
                          <div className="font-medium">{displayDeviceName(d)}</div>
                          <div className="text-xs text-slate-400">ID: {d.id}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-200">{d.server_no ?? 1}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-200">{d.mqtt_user ?? '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{d.share_from ?? '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Wifi className="h-4 w-4 text-cyan-200" />
                            <StatusBadge tone={tone} label={status} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button size="sm" onClick={() => testDeviceMqtt(d)}>
                              測試連線
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => stopDeviceClient(d.id)}>
                              斷開
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-xs text-slate-400">連線測試參考附件邏輯：依 server_no 從 mqtt_list 取得 URL，使用 mqtt_user/mqtt_pass 連線。</div>
        </div>
      </Modal>
    </AppShell>
  )
}
