import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CloudUpload, RefreshCw, Send } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/utils/supabase'
import { formatTs } from '@/utils/time'
import { createBrokerLink, type BrokerLink } from '@/utils/mqttBroker'

type MqttListRow = { server_no: number; url: string }

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

type FirmwareVersionRow = {
  id: string
  server_no: number
  version: string
  file_name: string
  storage_path: string
  file_size: number | null
  notes: string | null
  uploaded_by: string | null
  created_at: string
}

function displayDeviceName(d: DeviceCredentialRow): string {
  const custom = d.device_name_custom?.trim()
  if (custom) return custom
  const initial = d.device_name_initial?.trim()
  if (initial) return initial
  const name = d.device_name?.trim()
  if (name) return name
  return d.id
}

function deviceKeyOf(d: DeviceCredentialRow): string {
  return `${String(d.mqtt_user ?? '').trim()}/${String(d.device_name ?? '').trim()}`
}

function commandTopicOf(d: DeviceCredentialRow): string {
  return `device/${String(d.mqtt_user ?? '').trim()}/${String(d.device_name ?? '').trim()}/command`
}

function statusTopicOf(d: DeviceCredentialRow): string {
  return `device/${String(d.mqtt_user ?? '').trim()}/${String(d.device_name ?? '').trim()}/status`
}

function parseAction(payloadText: string): string {
  const text = payloadText.trim()
  if (!text) return ''
  try {
    const parsed = JSON.parse(text) as { action?: unknown }
    if (parsed && typeof parsed.action === 'string') return parsed.action
  } catch {
    void 0
  }
  return text
}

function parseOtaText(payloadText: string): string {
  try {
    const parsed = JSON.parse(payloadText) as { action?: string; message?: string; percent?: number; status?: string }
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.message === 'string' && parsed.message) return parsed.message
      if (typeof parsed.percent === 'number') return `更新中 ${parsed.percent}%`
      if (typeof parsed.status === 'string') return parsed.status
    }
  } catch {
    void 0
  }
  return payloadText
}

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function FirmwarePage() {
  const user = useAuthStore((s) => s.user)
  const envMissing = useAuthStore((s) => s.envMissing)

  const [mqttList, setMqttList] = useState<MqttListRow[]>([])
  const [deviceCreds, setDeviceCreds] = useState<DeviceCredentialRow[]>([])
  const [versions, setVersions] = useState<FirmwareVersionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  const [selectedServerNo, setSelectedServerNo] = useState<number | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])

  const [uploadVersion, setUploadVersion] = useState('')
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  const [sendMsg, setSendMsg] = useState<string | null>(null)

  const [serverOnline, setServerOnline] = useState<Record<string, boolean>>({})
  const [deviceOnline, setDeviceOnline] = useState<Record<string, boolean>>({})
  const [otaLog, setOtaLog] = useState<Record<string, string>>({})

  const linksRef = useRef<Map<string, BrokerLink>>(new Map())
  const onlineRef = useRef<Record<string, boolean>>({})

  // ── 資料載入 ──
  const fetchAll = useCallback(async () => {
    if (envMissing.length) return
    setLoading(true)
    setLoadError(null)
    const [mqttRes, devRes, verRes] = await Promise.all([
      supabase.from('mqtt_list').select('server_no, url').order('server_no', { ascending: true }),
      supabase
        .from('device_credentials')
        .select('id, user_id, device_name, device_name_initial, device_name_custom, mqtt_user, mqtt_pass, server_no, share_from'),
      supabase
        .from('firmware_versions')
        .select('id, server_no, version, file_name, storage_path, file_size, notes, uploaded_by, created_at')
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    const err = mqttRes.error?.message || devRes.error?.message || verRes.error?.message || null
    if (err) {
      setLoadError(err)
      setLoading(false)
      return
    }
    setMqttList((mqttRes.data ?? []) as MqttListRow[])
    setDeviceCreds((devRes.data ?? []) as DeviceCredentialRow[])
    setVersions((verRes.data ?? []) as FirmwareVersionRow[])
    setLoading(false)
  }, [envMissing.length])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll, refreshNonce])

  const mqttMap = useMemo(() => {
    const m: Record<number, string> = {}
    for (const row of mqttList) {
      if (row.server_no != null && row.url && row.url.trim()) m[row.server_no] = row.url
    }
    return m
  }, [mqttList])

  const serverNumbers = useMemo(() => Object.keys(mqttMap).map(Number).sort((a, b) => a - b), [mqttMap])

  useEffect(() => {
    if (selectedServerNo == null && serverNumbers.length) setSelectedServerNo(serverNumbers[0])
  }, [selectedServerNo, serverNumbers])

  // 伺服器上的所有設備（不分擁有者，管理員可一次更新全部）
  // 以 mqtt_user + device_name 去重（同一實體設備可能同時有擁有者列與分享列）
  const allDevices = useMemo(() => {
    const byKey = new Map<string, DeviceCredentialRow>()
    for (const d of deviceCreds) {
      const u = String(d.mqtt_user ?? '').trim()
      const n = String(d.device_name ?? '').trim()
      // 分享列若無 mqtt_user/device_name 無法識別，略過（其擁有者列仍會出現在清單）
      if (String(d.share_from ?? '').trim() && !(u && n)) continue
      const key = u && n ? `${u}::${n}` : `id:${d.id}`
      const prev = byKey.get(key)
      if (!prev) {
        byKey.set(key, d)
        continue
      }
      // 偏好含 mqtt_pass 的列（才能對該設備發送指令）
      if (!String(prev.mqtt_pass ?? '').trim() && String(d.mqtt_pass ?? '').trim()) byKey.set(key, d)
    }
    return Array.from(byKey.values())
  }, [deviceCreds])

  const devicesByServer = useMemo(() => {
    const m = new Map<number, DeviceCredentialRow[]>()
    for (const d of allDevices) {
      if (d.server_no == null) continue
      const no = Number(d.server_no)
      if (!m.has(no)) m.set(no, [])
      m.get(no)!.push(d)
    }
    for (const list of m.values()) list.sort((a, b) => displayDeviceName(a).localeCompare(displayDeviceName(b)))
    return m
  }, [allDevices])

  const currentDevices = useMemo(
    () => (selectedServerNo == null ? [] : devicesByServer.get(selectedServerNo) ?? []),
    [devicesByServer, selectedServerNo],
  )

  const serverVersions = useMemo(
    () => (selectedServerNo == null ? [] : versions.filter((v) => v.server_no === selectedServerNo)),
    [versions, selectedServerNo],
  )

  const selectedVersion = useMemo(
    () => serverVersions.find((v) => v.id === selectedVersionId) ?? null,
    [serverVersions, selectedVersionId],
  )

  // 切換伺服器時重置選取
  useEffect(() => {
    setSelectedVersionId(null)
    setSelectedDeviceIds([])
    setSendMsg(null)
  }, [selectedServerNo])

  // ── 長連線：每個 (server_no, mqtt_user) 一條，訂閱設備 status ──
  const brokerKey = useMemo(() => {
    const devPart = allDevices
      .map((d) => `${d.id}:${d.mqtt_user}:${d.server_no}`)
      .sort()
      .join('|')
    const mapPart = Object.entries(mqttMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('|')
    return `${devPart}||${mapPart}`
  }, [allDevices, mqttMap])

  useEffect(() => {
    if (!allDevices.length || !Object.keys(mqttMap).length) return

    type Group = { no: number; cred: DeviceCredentialRow; devices: DeviceCredentialRow[] }
    const groups = new Map<string, Group>()
    for (const d of allDevices) {
      const no = Number(d.server_no)
      if (!mqttMap[no]) continue
      const mqttUser = String(d.mqtt_user ?? '').trim()
      if (!mqttUser || !String(d.mqtt_pass ?? '').trim()) continue
      const key = `${no}::${mqttUser}`
      if (!groups.has(key)) groups.set(key, { no, cred: d, devices: [] })
      groups.get(key)!.devices.push(d)
    }

    const links = linksRef.current
    for (const [key, g] of groups.entries()) {
      if (!g.cred.mqtt_user || !g.cred.mqtt_pass) continue
      const link = createBrokerLink({
        serverNo: g.no,
        mqttList: mqttMap,
        username: String(g.cred.mqtt_user).trim(),
        password: String(g.cred.mqtt_pass),
        clientId: `maint_fw_${g.no}_${Math.random().toString(36).slice(2, 8)}`,
        onStatus: (online) => {
          onlineRef.current[key] = online
          setServerOnline({ ...onlineRef.current })
        },
      })

      for (const d of g.devices) {
        const dk = deviceKeyOf(d)
        link.subscribe(statusTopicOf(d), (_topic, payloadText) => {
          const action = parseAction(payloadText)
          const online = action !== '' && action !== 'offline' && action !== 'disconnected'
          setDeviceOnline((prev) => ({ ...prev, [dk]: online }))
          if (action === 'ota_progress' || action === 'ota_start' || action === 'ota_result' || action === 'ota_error') {
            setOtaLog((prev) => ({ ...prev, [dk]: parseOtaText(payloadText) }))
          }
        })
      }

      links.set(key, link)
    }

    return () => {
      for (const link of links.values()) link.close()
      links.clear()
      onlineRef.current = {}
      setServerOnline({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerKey])

  // ── 上傳韌體 ──
  const onUpload = useCallback(async () => {
    setUploadMsg(null)
    setUploadErr(null)
    if (selectedServerNo == null) {
      setUploadErr('請先選擇伺服器')
      return
    }
    const version = uploadVersion.trim()
    if (!version) {
      setUploadErr('請填寫版本號')
      return
    }
    if (!uploadFile) {
      setUploadErr('請選擇 .bin 韌體檔案')
      return
    }
    if (!/\.bin$/i.test(uploadFile.name)) {
      setUploadErr('僅接受 .bin 韌體檔案')
      return
    }

    setUploading(true)
    try {
      const safeName = uploadFile.name.replace(/[^\w.\-]+/g, '_')
      const storagePath = `server_${selectedServerNo}/${version}/${Date.now()}_${safeName}`
      const upRes = await supabase.storage.from('firmware').upload(storagePath, uploadFile, {
        contentType: 'application/octet-stream',
        upsert: false,
      })
      if (upRes.error) throw upRes.error

      const insRes = await supabase.from('firmware_versions').insert({
        server_no: selectedServerNo,
        version,
        file_name: uploadFile.name,
        storage_path: storagePath,
        file_size: uploadFile.size,
        notes: uploadNotes.trim() || null,
        uploaded_by: user?.email ?? user?.id ?? null,
      })
      if (insRes.error) throw insRes.error

      setUploadMsg(`已上傳版本 ${version}`)
      setUploadVersion('')
      setUploadNotes('')
      setUploadFile(null)
      setRefreshNonce((n) => n + 1)
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : '上傳失敗')
    } finally {
      setUploading(false)
    }
  }, [selectedServerNo, uploadVersion, uploadFile, uploadNotes, user?.email, user?.id])

  // ── 發送遠端更新 ──
  const onSendOta = useCallback(async () => {
    setSendMsg(null)
    if (!selectedVersion) {
      setSendMsg('請先選擇要更新的韌體版本')
      return
    }
    if (!selectedDeviceIds.length) {
      setSendMsg('請至少勾選一台設備')
      return
    }
    const targets = currentDevices.filter((d) => selectedDeviceIds.includes(d.id))
    if (!targets.length) {
      setSendMsg('找不到可更新的設備')
      return
    }

    const pub = supabase.storage.from('firmware').getPublicUrl(selectedVersion.storage_path)
    // 修正：ESP32 無法解析含有空格的 URL
    // 使用 encodeURI 處理整串網址，確保空格轉為 %20 且保留協定與路徑結構
    let url = pub.data.publicUrl
    if (url) {
      url = encodeURI(url)
    }

    if (!url) {
      setSendMsg('無法取得韌體下載網址')
      return
    }

    setSending(true)
    let okCount = 0
    let failCount = 0
    const logPatch: Record<string, string> = {}

    for (const d of targets) {
      const no = Number(d.server_no)
      const mqttUser = String(d.mqtt_user ?? '').trim()
      if (!mqttUser || !String(d.mqtt_pass ?? '').trim()) {
        failCount += 1
        logPatch[deviceKeyOf(d)] = '缺少 MQTT 憑證，無法送出'
        continue
      }
      const link = linksRef.current.get(`${no}::${mqttUser}`)
      const payload = JSON.stringify({
        action: 'ota',
        url,
        version: selectedVersion.version,
        ts: Date.now(),
      })
      if (link && link.isConnected()) {
        const sent = link.publish(commandTopicOf(d), payload, 1)
        if (sent) {
          okCount += 1
          logPatch[deviceKeyOf(d)] = '已送出更新指令'
        } else {
          failCount += 1
          logPatch[deviceKeyOf(d)] = '送出失敗（連線中斷）'
        }
      } else {
        failCount += 1
        logPatch[deviceKeyOf(d)] = '伺服器未連線，無法送出'
      }
    }

    setOtaLog((prev) => ({ ...prev, ...logPatch }))
    setSending(false)
    setSendMsg(`已送出 ${okCount} 台${failCount ? `，失敗 ${failCount} 台` : ''}`)
  }, [selectedVersion, selectedDeviceIds, currentDevices])

  const allSelected = currentDevices.length > 0 && selectedDeviceIds.length === currentDevices.length
  const toggleAll = () => {
    setSelectedDeviceIds(allSelected ? [] : currentDevices.map((d) => d.id))
  }
  const toggleOne = (id: string) => {
    setSelectedDeviceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-wide">韌體更新</h1>
          <div className="mt-1 text-xs text-slate-400">上傳 ESP 程式並對伺服器下的設備遠端燒錄</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setRefreshNonce((n) => n + 1)} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          重新讀取
        </Button>
      </div>

      {envMissing.length ? (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          環境變數未設定：{envMissing.join('、')}
        </div>
      ) : null}
      {loadError ? (
        <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{loadError}</div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <div className="mb-1 text-xs text-slate-400">伺服器</div>
          <Select
            value={selectedServerNo ?? ''}
            onChange={(e) => setSelectedServerNo(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">請選擇</option>
            {serverNumbers.map((no) => {
              const online = Object.entries(serverOnline)
                .filter(([k]) => k.startsWith(`${no}::`))
                .some(([, v]) => v)
              return (
                <option key={no} value={no}>
                  Server #{no}（{online ? '線上' : '離線'}）
                </option>
              )
            })}
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-1">
          {selectedServerNo == null ? null : (
            <StatusBadge
              tone={
                Object.entries(serverOnline)
                  .filter(([k]) => k.startsWith(`${selectedServerNo}::`))
                  .some(([, v]) => v)
                  ? 'success'
                  : 'danger'
              }
              label={
                Object.entries(serverOnline)
                  .filter(([k]) => k.startsWith(`${selectedServerNo}::`))
                  .some(([, v]) => v)
                  ? 'MQTT 已連線'
                  : 'MQTT 未連線'
              }
            />
          )}
          <span className="text-xs text-slate-400">設備 {currentDevices.length} 台</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>上傳新韌體</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs text-slate-400">版本號</div>
                <Input
                  placeholder="例如 1.0.5"
                  value={uploadVersion}
                  onChange={(e) => setUploadVersion(e.target.value)}
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-400">備註（選填）</div>
                <Input
                  placeholder="例如 修正 WiFi 重連"
                  value={uploadNotes}
                  onChange={(e) => setUploadNotes(e.target.value)}
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-400">韌體檔案（.bin）</div>
                <input
                  type="file"
                  accept=".bin"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className="block w-full cursor-pointer rounded-md border border-slate-700/60 bg-slate-950/40 text-sm text-slate-300 file:mr-3 file:cursor-pointer file:border-0 file:bg-cyan-400/15 file:px-3 file:py-2 file:text-sm file:text-cyan-100"
                />
                {uploadFile ? (
                  <div className="mt-1 text-xs text-slate-400">
                    {uploadFile.name}（{formatSize(uploadFile.size)}）
                  </div>
                ) : null}
              </div>
              {uploadErr ? <div className="text-sm text-rose-300">{uploadErr}</div> : null}
              {uploadMsg ? <div className="text-sm text-emerald-300">{uploadMsg}</div> : null}
              <Button onClick={() => void onUpload()} disabled={uploading || selectedServerNo == null}>
                <CloudUpload className="h-4 w-4" />
                {uploading ? '上傳中…' : '上傳'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>版本清單{selectedServerNo == null ? '' : `（Server #${selectedServerNo}）`}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
              {serverVersions.length === 0 ? (
                <div className="text-sm text-slate-300">尚無韌體版本</div>
              ) : (
                serverVersions.map((v) => (
                  <button
                    key={v.id}
                    className={
                      'w-full rounded-lg border px-3 py-2 text-left transition ' +
                      (selectedVersionId === v.id
                        ? 'border-cyan-400/50 bg-cyan-400/10'
                        : 'border-slate-800/60 bg-white/5 hover:bg-white/10')
                    }
                    onClick={() => setSelectedVersionId(v.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm text-slate-100">{v.version}</span>
                      <span className="text-xs text-slate-400">{formatSize(v.file_size)}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-400">{v.file_name}</div>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                      <span>{formatTs(v.created_at)}</span>
                      <span className="truncate">{v.uploaded_by ?? ''}</span>
                    </div>
                    {v.notes ? <div className="mt-1 text-xs text-slate-400">{v.notes}</div> : null}
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>設備清單與遠端更新</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Button onClick={() => void onSendOta()} disabled={sending || !selectedVersion || !selectedDeviceIds.length}>
              <Send className="h-4 w-4" />
              {sending ? '發送中…' : '發送遠端更新'}
            </Button>
            <span className="text-xs text-slate-400">
              已選 {selectedDeviceIds.length} 台
              {selectedVersion ? `，目標版本 ${selectedVersion.version}` : '，請先選擇版本'}
            </span>
            {sendMsg ? <span className="text-xs text-cyan-200">{sendMsg}</span> : null}
          </div>

          {currentDevices.length === 0 ? (
            <div className="text-sm text-slate-300">此伺服器沒有可更新的設備</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-left text-xs text-slate-400">
                  <tr className="border-b border-slate-800/60">
                    <th className="w-10 px-3 py-2">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    </th>
                    <th className="px-3 py-2 font-medium">設備名稱</th>
                    <th className="px-3 py-2 font-medium">擁有者</th>
                    <th className="px-3 py-2 font-medium">mqtt_user</th>
                    <th className="px-3 py-2 font-medium">device_name</th>
                    <th className="px-3 py-2 font-medium">狀態</th>
                    <th className="px-3 py-2 font-medium">更新狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {currentDevices.map((d) => {
                    const dk = deviceKeyOf(d)
                    const online = deviceOnline[dk]
                    const hasCred = Boolean(String(d.mqtt_user ?? '').trim() && String(d.mqtt_pass ?? '').trim())
                    return (
                      <tr key={d.id} className="border-b border-slate-800/40">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedDeviceIds.includes(d.id)}
                            onChange={() => toggleOne(d.id)}
                          />
                        </td>
                        <td className="px-3 py-2 text-slate-100">
                          {displayDeviceName(d)}
                          {hasCred ? null : (
                            <span className="ml-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
                              無憑證
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-300">{d.user_id ? String(d.user_id) : '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">{d.mqtt_user ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">{d.device_name ?? '—'}</td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            tone={online === true ? 'success' : online === false ? 'danger' : 'muted'}
                            label={online === true ? '在線' : online === false ? '離線' : '未知'}
                          />
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-300">{otaLog[dk] ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  )
}
