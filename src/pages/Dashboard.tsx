import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Plus, Radar, Search, Server } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useAuthStore } from '@/stores/authStore'
import { useDevicesStore } from '@/stores/devicesStore'
import { useLocationStore } from '@/stores/locationStore'
import { usePositionReporter } from '@/hooks/usePositionReporter'
import { supabase } from '@/utils/supabase'
import { formatTs, minutesAgo } from '@/utils/time'

function toneFromConnection(v: string | null | undefined): 'success' | 'warning' | 'danger' | 'muted' {
  const s = (v ?? 'unknown').toLowerCase()
  if (s === 'online' || s === 'connected') return 'success'
  if (s === 'offline' || s === 'disconnected') return 'danger'
  if (s === 'unknown') return 'muted'
  return 'warning'
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const envMissing = useAuthStore((s) => s.envMissing)
  const { devices, isLoading, error, fetchDevices, subscribeDevices, unsubscribe } = useDevicesStore()
  const { permission, isReporting, lastReportedAt, lastError, enabled } = useLocationStore()
  const [q, setQ] = useState('')
  const [connFilter, setConnFilter] = useState('all')
  const [usageFilter, setUsageFilter] = useState('all')
  const [locFilter, setLocFilter] = useState('all')
  const [serverOk, setServerOk] = useState<boolean | null>(null)
  const [serverErr, setServerErr] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)

  const reporter = usePositionReporter({ userId: user?.id ?? null })

  const permissionLabel = useMemo(() => {
    if (permission === 'granted') return '已授權'
    if (permission === 'denied') return '已拒絕'
    if (permission === 'prompt') return '待授權'
    return '未知'
  }, [permission])

  useEffect(() => {
    if (!user?.id) return
    void fetchDevices(user.id)
    subscribeDevices(user.id)
    return () => {
      unsubscribe()
    }
  }, [fetchDevices, subscribeDevices, unsubscribe, user?.id])

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

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return devices
      .filter((d) => (connFilter === 'all' ? true : (d.connection_status ?? 'unknown') === connFilter))
      .filter((d) => (usageFilter === 'all' ? true : (d.usage_status ?? 'unknown') === usageFilter))
      .filter((d) => (locFilter === 'all' ? true : (d.location_status ?? 'unknown') === locFilter))
      .filter((d) => {
        if (!s) return true
        const dn = (d.display_name ?? d.name ?? '').toLowerCase()
        const code = (d.device_code ?? d.mac_address ?? '').toLowerCase()
        return dn.includes(s) || code.includes(s)
      })
  }, [connFilter, devices, locFilter, q, usageFilter])

  const connOptions = useMemo(() => {
    const s = new Set<string>()
    for (const d of devices) s.add(d.connection_status ?? 'unknown')
    return ['all', ...Array.from(s).sort()]
  }, [devices])

  const usageOptions = useMemo(() => {
    const s = new Set<string>()
    for (const d of devices) s.add(d.usage_status ?? 'unknown')
    return ['all', ...Array.from(s).sort()]
  }, [devices])

  const locOptions = useMemo(() => {
    const s = new Set<string>()
    for (const d of devices) s.add(d.location_status ?? 'unknown')
    return ['all', ...Array.from(s).sort()]
  }, [devices])

  const onlineCount = useMemo(() => devices.filter((d) => toneFromConnection(d.connection_status) === 'success').length, [devices])
  const offlineCount = useMemo(() => devices.filter((d) => toneFromConnection(d.connection_status) === 'danger').length, [devices])
  const staleCount = useMemo(() => {
    return devices.filter((d) => {
      const mins = minutesAgo(d.last_seen_at)
      return mins !== null && mins >= 10
    }).length
  }, [devices])

  return (
    <AppShell>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs text-slate-400">即時監控</div>
          <h1 className="text-lg font-semibold tracking-wide">設備總覽</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)} disabled={!user?.id || envMissing.length > 0}>
            <Plus className="h-4 w-4" />
            新增設備
          </Button>
          <Button variant="secondary" size="sm" onClick={() => user?.id && void fetchDevices(user.id)} disabled={!user?.id}>
            <Radar className="h-4 w-4" />
            手動同步
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
            <CardTitle>定位回報</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-200">
                <MapPin className="h-4 w-4 text-cyan-200" />
                權限：{permissionLabel}
              </div>
              <StatusBadge
                tone={permission === 'granted' ? 'success' : permission === 'denied' ? 'danger' : 'warning'}
                label={isReporting ? '每 5 分鐘回報中' : enabled ? '未回報' : '未啟用'}
              />
            </div>
            <div className="mt-2 text-xs text-slate-400">最後回報：{formatTs(lastReportedAt)}</div>
            {lastError ? <div className="mt-2 text-xs text-rose-200">{lastError}</div> : null}

            {!enabled && !envMissing.length ? (
              <div className="mt-3">
                <Button size="sm" onClick={() => reporter.requestEnable()}>
                  啟用定位（每 5 分鐘回報）
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>設備摘要</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-slate-400">Online</div>
                <div className="mt-1 text-lg font-semibold text-emerald-200">{onlineCount}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Offline</div>
                <div className="mt-1 text-lg font-semibold text-rose-200">{offlineCount}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Stale ≥10m</div>
                <div className="mt-1 text-lg font-semibold text-amber-200">{staleCount}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full items-center gap-2 lg:max-w-md">
          <div className="text-slate-400">
            <Search className="h-4 w-4" />
          </div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋設備名稱 / 代碼" />
        </div>
        <div className="text-xs text-slate-400">登入：{user?.email ?? '—'}</div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div>
          <div className="mb-1 text-xs text-slate-400">連線狀態</div>
          <Select value={connFilter} onChange={(e) => setConnFilter(e.target.value)}>
            {connOptions.map((v) => (
              <option key={v} value={v}>
                {v === 'all' ? '全部' : v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-400">使用狀態</div>
          <Select value={usageFilter} onChange={(e) => setUsageFilter(e.target.value)}>
            {usageOptions.map((v) => (
              <option key={v} value={v}>
                {v === 'all' ? '全部' : v}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <div className="mb-1 text-xs text-slate-400">定位狀態</div>
          <Select value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
            {locOptions.map((v) => (
              <option key={v} value={v}>
                {v === 'all' ? '全部' : v}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full">
            <thead className="bg-white/5">
              <tr className="text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">設備名稱</th>
                <th className="px-5 py-3 font-medium">代碼</th>
                <th className="px-5 py-3 font-medium">連線</th>
                <th className="px-5 py-3 font-medium">使用</th>
                <th className="px-5 py-3 font-medium">定位</th>
                <th className="px-5 py-3 font-medium">最後回報</th>
                <th className="px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td className="px-5 py-5 text-sm text-slate-300" colSpan={7}>
                    讀取中…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td className="px-5 py-5 text-sm text-rose-200" colSpan={7}>
                    {error}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-sm text-slate-300" colSpan={7}>
                    找不到符合條件的設備
                  </td>
                </tr>
              ) : (
                filtered.map((d) => (
                  <tr key={d.id} className="text-sm text-slate-200 hover:bg-white/5">
                    <td className="px-5 py-3">
                      <div className="font-medium">{d.display_name ?? d.name ?? '未命名設備'}</div>
                      <div className="text-xs text-slate-400">ID: {d.id}</div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-200">{d.device_code ?? d.mac_address ?? '—'}</td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={toneFromConnection(d.connection_status)} label={d.connection_status ?? 'unknown'} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge tone="muted" label={d.usage_status ?? 'unknown'} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge tone="muted" label={d.location_status ?? 'unknown'} />
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-300">{formatTs(d.last_seen_at)}</td>
                    <td className="px-5 py-3">
                      <Link
                        className="text-cyan-200 underline decoration-cyan-400/30 underline-offset-4 hover:text-cyan-100"
                        to={`/devices/${d.id}`}
                      >
                        查看
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={addOpen} title="新增設備" onClose={() => setAddOpen(false)}>
        <div className="space-y-3">
          {addErr ? (
            <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{addErr}</div>
          ) : null}
          <label className="block">
            <div className="mb-1 text-xs text-slate-400">設備名稱</div>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如：大門鎖" />
          </label>
          <label className="block">
            <div className="mb-1 text-xs text-slate-400">設備代碼</div>
            <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="例如：LOCK-001" />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setAddOpen(false)} disabled={addBusy}>
              取消
            </Button>
            <Button
              onClick={async () => {
                setAddErr(null)
                if (!user?.id) {
                  setAddErr('尚未登入')
                  return
                }
                if (!newName.trim() || !newCode.trim()) {
                  setAddErr('請填寫設備名稱與代碼')
                  return
                }
                setAddBusy(true)
                const { error } = await supabase.from('devices').insert({
                  user_id: user.id,
                  name: newName.trim(),
                  display_name: newName.trim(),
                  device_code: newCode.trim(),
                  connection_status: 'unknown',
                  usage_status: 'unknown',
                  location_status: 'unknown',
                })
                setAddBusy(false)
                if (error) {
                  setAddErr(error.message)
                  return
                }
                setNewName('')
                setNewCode('')
                setAddOpen(false)
              }}
              disabled={addBusy}
            >
              新增
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  )
}
