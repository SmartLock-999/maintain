import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, Wifi } from 'lucide-react'
import mqtt from 'mqtt'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useAuthStore } from '@/stores/authStore'
import { supabase } from '@/utils/supabase'
import { formatTs } from '@/utils/time'
import { LeafletPositionsMap } from '@/components/maps/LeafletPositionsMap'

type RegisteredEmailRow = {
  user_id?: string | null
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

type LocationRow = {
  id: string
  user_id: string
  name?: string | null
  lat: number | string
  lng: number | string
  radius?: number | string | null
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

function isIgnoredShareRow(d: DeviceCredentialRow): boolean {
  const shareFrom = String(d.share_from ?? '').trim()
  if (!shareFrom) return false
  const userId = String(d.user_id ?? '').trim()
  const deviceName = String(d.device_name ?? '').trim()
  if (!userId || !deviceName) return false
  return userId === deviceName
}

function isUuid(v: string): boolean {
  const s = v.trim()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true
  if (/^[0-9a-f]{32}$/i.test(s)) return true
  return false
}

function deviceIdentityKey(d: DeviceCredentialRow): string {
  const mqttUser = String(d.mqtt_user ?? '').trim()
  const deviceName = String(d.device_name ?? '').trim()
  if (mqttUser && deviceName) return `${mqttUser}::${deviceName}`
  return String(d.id ?? '').trim()
}

function normalizeBrokerUrl(raw: string): string {
  const s = raw.trim()
  if (/^wss?:\/\//i.test(s)) return s
  return `wss://${s}:8884/mqtt`
}

function parseStatusAction(payloadText: string): string {
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

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const envMissing = useAuthStore((s) => s.envMissing)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [mqttRefreshNonce, setMqttRefreshNonce] = useState(0)

  const [mqttList, setMqttList] = useState<MqttListRow[]>([])
  const [registered, setRegistered] = useState<RegisteredEmailRow[]>([])
  const [deviceCreds, setDeviceCreds] = useState<DeviceCredentialRow[]>([])
  const [positions, setPositions] = useState<PositionRow[]>([])
  const [accountPositions, setAccountPositions] = useState<PositionRow[]>([])
  const [accountPositionsLoading, setAccountPositionsLoading] = useState(false)
  const [accountPositionsError, setAccountPositionsError] = useState<string | null>(null)
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [locationsError, setLocationsError] = useState<string | null>(null)
  const [activeLocationIndex, setActiveLocationIndex] = useState(0)
  const [activePositionIndex, setActivePositionIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedAccount, setSelectedAccount] = useState<string>('all')
  const [selectedAccountLocationUserIds, setSelectedAccountLocationUserIds] = useState<string[]>([])

  // 長連線用：key = device.id，value = { online, updatedAt }
  const [deviceOnlineByDeviceId, setDeviceOnlineByDeviceId] = useState<Record<string, { online: boolean; updatedAt: number }>>({})
  // 長連線用：key = server_no，value = { online, updatedAt }
  const [serverOnlineByNo, setServerOnlineByNo] = useState<Record<number, { online: boolean; updatedAt: number }>>({})

  const adminCount = useMemo(() => registered.filter((r) => getPermissions(r) === 'admin').length, [registered])

  const emailToUserId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const r of registered) {
      const email = String(r.email ?? '').trim()
      const userId = String(r.user_id ?? '').trim()
      if (email && userId) map[email.toLowerCase()] = userId
    }
    return map
  }, [registered])

  const userIdToEmail = useMemo(() => {
    const map: Record<string, string> = {}
    for (const r of registered) {
      const email = String(r.email ?? '').trim()
      const userId = String(r.user_id ?? '').trim()
      if (email && userId) map[userId] = email
    }
    return map
  }, [registered])

  const toAccountKey = useCallback((raw: unknown): string => {
    const v = String(raw ?? '').trim()
    if (!v) return ''
    const lower = v.toLowerCase()
    const mapped = emailToUserId[lower]
    return mapped ?? v
  }, [emailToUserId])

  const getAccountAliases = useCallback((raw: unknown) => {
    const values = new Set<string>()
    const normalizedValues = new Set<string>()
    const push = (value: unknown) => {
      const text = String(value ?? '').trim()
      if (!text) return
      values.add(text)
      normalizedValues.add(text.toLowerCase())
    }

    const text = String(raw ?? '').trim()
    if (!text) {
      return {
        values,
        normalizedValues,
        userId: '',
        email: '',
      }
    }

    const key = toAccountKey(text)
    const email = userIdToEmail[key] ?? (text.includes('@') ? text : '')
    const mappedUserId = emailToUserId[text.toLowerCase()] ?? (isUuid(key) ? key : '')

    push(text)
    push(key)
    push(email)
    push(mappedUserId)

    return {
      values,
      normalizedValues,
      userId: mappedUserId || (isUuid(key) ? key : ''),
      email,
    }
  }, [emailToUserId, toAccountKey, userIdToEmail])

  const accountMatches = useCallback((account: unknown, target: unknown) => {
    const accountAliases = getAccountAliases(account)
    const targetAliases = getAccountAliases(target)
    for (const value of targetAliases.normalizedValues) {
      if (accountAliases.normalizedValues.has(value)) return true
    }
    return false
  }, [getAccountAliases])

  const resolveRegisteredUserIds = useCallback((raw: unknown) => {
    const aliases = getAccountAliases(raw)
    const userIds = new Set<string>()

    const direct = String(raw ?? '').trim()
    if (direct && isUuid(direct)) userIds.add(direct)
    if (direct && direct.includes('@')) {
      const mapped = emailToUserId[direct.toLowerCase()]
      if (mapped && isUuid(mapped)) userIds.add(mapped)
    }

    if (aliases.userId && isUuid(aliases.userId)) userIds.add(aliases.userId)

    for (const row of registered) {
      const rowUserId = String(row.user_id ?? '').trim()
      const rowEmail = String(row.email ?? '').trim()
      if (!rowUserId || !isUuid(rowUserId)) continue

      if (
        aliases.normalizedValues.has(rowUserId.toLowerCase()) ||
        (rowEmail && aliases.normalizedValues.has(rowEmail.toLowerCase()))
      ) {
        userIds.add(rowUserId)
      }

      if (direct && direct.includes('@') && rowEmail && rowEmail.toLowerCase() === direct.toLowerCase()) {
        userIds.add(rowUserId)
      }
    }

    return userIds
  }, [emailToUserId, getAccountAliases, registered])

  const selectAccount = useCallback(
    async (raw: string) => {
      const v = String(raw ?? '').trim()
      if (!v || v === 'all') {
        setSelectedAccount('all')
        setSelectedAccountLocationUserIds([])
        setActivePositionIndex(0)
        return
      }

      setSelectedAccount(v)
      setActivePositionIndex(0)

      const userIds: string[] = []

      if (isUuid(v)) {
        userIds.push(v)
        setSelectedAccountLocationUserIds(userIds)
        return
      }

      if (v.includes('@')) {
        const mapped = emailToUserId[v.toLowerCase()]
        if (mapped && isUuid(mapped)) userIds.push(mapped)

        if (!userIds.length) {
          const res = await supabase
            .from('registered_emails')
            .select('user_id')
            .eq('email', v)
            .limit(1)
            .maybeSingle()

          if (!res.error) {
            const fetchedId = String(res.data?.user_id ?? '').trim()
            if (fetchedId && isUuid(fetchedId)) userIds.push(fetchedId)
          }
        }

        if (!userIds.length) {
          for (const d of deviceCreds) {
            if (isIgnoredShareRow(d)) continue
            const rawUserId = String(d.user_id ?? '').trim()
            if (rawUserId.toLowerCase() === v.toLowerCase() || accountMatches(rawUserId, v)) {
              const key = toAccountKey(rawUserId)
              if (key && isUuid(key)) { userIds.push(key); break }
              if (rawUserId && isUuid(rawUserId)) { userIds.push(rawUserId); break }
            }
          }
        }
      }

      setSelectedAccountLocationUserIds(userIds)
    },
    [accountMatches, deviceCreds, emailToUserId, toAccountKey],
  )

  const accountLabel = useCallback((accountKey: string): string => {
    if (!accountKey) return '—'
    return userIdToEmail[accountKey] ?? accountKey
  }, [userIdToEmail])

  const registeredByAccountKey = useMemo(() => {
    const map: Record<string, RegisteredEmailRow> = {}
    for (const r of registered) {
      const key = toAccountKey(r.user_id ?? r.email)
      if (key) map[key] = r
    }
    return map
  }, [registered, toAccountKey])

  const accounts = useMemo(() => {
    const s = new Set<string>()
    for (const r of registered) {
      const key = toAccountKey(r.user_id ?? r.email)
      if (key) s.add(key)
    }
    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const key = toAccountKey(d.user_id)
      if (key) s.add(key)
    }
    for (const p of positions) {
      const key = toAccountKey(p.user_id)
      if (key) s.add(key)
    }

    const list = Array.from(s)
      .map((key) => ({ key, label: accountLabel(key) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return list
  }, [accountLabel, deviceCreds, positions, registered, toAccountKey])

  const deviceOwnershipById = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const deviceId = String(d.id ?? '').trim()
      if (!deviceId) continue
      const shareFrom = String(d.share_from ?? '').trim()
      const ownerKey = toAccountKey(shareFrom || d.user_id)
      if (!ownerKey) continue
      const existing = map.get(deviceId)
      if (!existing) {
        map.set(deviceId, ownerKey)
        continue
      }
      if (shareFrom) map.set(deviceId, ownerKey)
    }
    return map
  }, [deviceCreds, toAccountKey])

  const deviceStatsByUser = useMemo(() => {
    const ownedBy: Record<string, Set<string>> = {}
    const sharedInBy: Record<string, Set<string>> = {}
    const sharedOutBy: Record<string, Set<string>> = {}
    const ensure = (m: Record<string, Set<string>>, k: string) => (m[k] ??= new Set<string>())

    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const shareFrom = String(d.share_from ?? '').trim()
      const recipientKey = toAccountKey(d.user_id)
      const key = deviceIdentityKey(d)
      if (shareFrom) {
        const ownerKey = toAccountKey(shareFrom)
        if (ownerKey) ensure(sharedOutBy, ownerKey).add(key)
        if (recipientKey) ensure(sharedInBy, recipientKey).add(key)
      } else {
        const ownerKey = recipientKey
        if (ownerKey) ensure(ownedBy, ownerKey).add(key)
      }
    }

    const stats: Record<string, { owned: number; sharedIn: number; sharedOut: number; total: number }> = {}
    const keys = new Set<string>([
      ...Object.keys(ownedBy),
      ...Object.keys(sharedInBy),
      ...Object.keys(sharedOutBy),
    ])
    for (const key of keys) {
      const owned = ownedBy[key]?.size ?? 0
      const sharedIn = sharedInBy[key]?.size ?? 0
      const sharedOut = sharedOutBy[key]?.size ?? 0
      const total = new Set<string>([
        ...(ownedBy[key] ? Array.from(ownedBy[key]) : []),
        ...(sharedInBy[key] ? Array.from(sharedInBy[key]) : []),
      ]).size
      stats[key] = { owned, sharedIn, sharedOut, total }
    }
    return stats
  }, [deviceCreds, toAccountKey])

  const positionsMarkers = useMemo(() => {
    const source = selectedAccount === 'all' ? positions : accountPositions
    return source
      .map((p) => {
        const lat = asNumber(p.lat)
        const lng = asNumber(p.lng)
        if (lat === null || lng === null) return null
        const ts = p.captured_at ?? p.created_at ?? null
        const accountKey = toAccountKey(p.user_id)
        return {
          id: p.id,
          lat,
          lng,
          title: accountLabel(accountKey),
          subtitle: ts ? formatTs(ts) : undefined,
        }
      })
      .filter(Boolean) as { id: string; lat: number; lng: number; title?: string; subtitle?: string }[]
  }, [accountLabel, accountPositions, positions, selectedAccount, toAccountKey])

  const locationItems = useMemo(() => {
    return locations
      .map((l) => {
        const lat = asNumber(l.lat)
        const lng = asNumber(l.lng)
        if (lat === null || lng === null) return null
        const radiusM = l.radius != null ? asNumber(l.radius) : null
        return {
          id: l.id,
          lat,
          lng,
          name: typeof l.name === 'string' ? l.name : undefined,
          radiusM,
        }
      })
      .filter(Boolean) as { id: string; lat: number; lng: number; name?: string; radiusM?: number | null }[]
  }, [locations])

  // ── 資料載入（Supabase）──
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
  }, [envMissing.length, refreshNonce])

  // ── 帳號定位點載入 ──
  useEffect(() => {
    if (envMissing.length) return
    if (selectedAccount === 'all') {
      setAccountPositions([])
      setAccountPositionsLoading(false)
      setAccountPositionsError(null)
      return
    }

    let cancelled = false
    const run = async () => {
      setAccountPositionsLoading(true)
      setAccountPositionsError(null)

      const candidates = new Set<string>()
      for (const id of selectedAccountLocationUserIds) {
        const v = String(id ?? '').trim()
        if (v && isUuid(v)) candidates.add(v)
      }
      if (candidates.size === 0) {
        for (const id of resolveRegisteredUserIds(selectedAccount)) {
          const v = String(id ?? '').trim()
          if (v && isUuid(v)) candidates.add(v)
        }
      }
      if (candidates.size === 0) {
        for (const d of deviceCreds) {
          if (isIgnoredShareRow(d)) continue
          if (!accountMatches(d.user_id, selectedAccount)) continue
          const key = toAccountKey(d.user_id)
          if (key && isUuid(key)) candidates.add(key)
          const rawUserId = String(d.user_id ?? '').trim()
          if (rawUserId && isUuid(rawUserId)) candidates.add(rawUserId)
        }
      }

      if (candidates.size === 0) {
        const text = String(selectedAccount ?? '').trim()
        if (text.includes('@')) {
          const res = await supabase
            .from('registered_emails')
            .select('user_id, email')
            .ilike('email', `%${text}%`)
            .limit(5)

          if (!cancelled && !res.error) {
            const rows = (res.data ?? []) as RegisteredEmailRow[]
            for (const row of rows) {
              const userId = String(row.user_id ?? '').trim()
              const email = String(row.email ?? '').trim()
              if (email && email.toLowerCase() === text.toLowerCase() && isUuid(userId)) candidates.add(userId)
            }
          }
        }
        if (candidates.size === 0 && isUuid(text)) {
          candidates.add(text)
        }
      }

      if (candidates.size === 0) {
        if (!cancelled) {
          setAccountPositions([])
          setAccountPositionsError('positions：查詢失敗（找不到可用的 user_id）')
          setAccountPositionsLoading(false)
        }
        return
      }

      const res = await supabase
        .from('positions')
        .select('id, user_id, lat, lng, accuracy_m, captured_at, created_at')
        .in('user_id', Array.from(candidates))
        .order('captured_at', { ascending: false, nullsFirst: false })
        .limit(200)

      if (cancelled) return
      if (res.error) {
        setAccountPositions([])
        setAccountPositionsError(res.error.message)
      } else {
        setAccountPositions((res.data ?? []) as PositionRow[])
        setActivePositionIndex(0)
      }
      setAccountPositionsLoading(false)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [
    accountMatches,
    deviceCreds,
    emailToUserId,
    envMissing.length,
    resolveRegisteredUserIds,
    selectedAccount,
    selectedAccountLocationUserIds,
    toAccountKey,
  ])

  // ── 帳號定位點（locations 表）──
  useEffect(() => {
    if (envMissing.length) return
    if (selectedAccount === 'all') {
      setLocations([])
      setLocationsError(null)
      setLocationsLoading(false)
      setActiveLocationIndex(0)
      return
    }

    let cancelled = false
    const run = async () => {
      setLocationsLoading(true)
      setLocationsError(null)

      const aliases = getAccountAliases(selectedAccount)
      const primaryUserIds = new Set<string>()
      for (const id of selectedAccountLocationUserIds) {
        const v = String(id ?? '').trim()
        if (v && isUuid(v)) primaryUserIds.add(v)
      }
      if (primaryUserIds.size === 0) {
        for (const id of resolveRegisteredUserIds(selectedAccount)) primaryUserIds.add(id)
      }

      if (primaryUserIds.size === 0) {
        for (const d of deviceCreds) {
          if (isIgnoredShareRow(d)) continue
          if (!accountMatches(d.user_id, selectedAccount)) continue
          const key = toAccountKey(d.user_id)
          if (key && isUuid(key)) primaryUserIds.add(key)
          const rawUserId = String(d.user_id ?? '').trim()
          if (rawUserId && isUuid(rawUserId)) primaryUserIds.add(rawUserId)
        }
      }

      if (primaryUserIds.size === 0 && aliases.email) {
        const res = await supabase
          .from('registered_emails')
          .select('user_id, email')
          .eq('email', aliases.email)
          .limit(5)

        if (!cancelled) {
          const rows = (res.data ?? []) as RegisteredEmailRow[]
          for (const row of rows) {
            const userId = String(row.user_id ?? '').trim()
            if (isUuid(userId)) {
              primaryUserIds.add(userId)
            }
          }
        }
      }

      if (primaryUserIds.size === 0 && isUuid(String(selectedAccount ?? '').trim())) {
        primaryUserIds.add(String(selectedAccount).trim())
      }

      if (primaryUserIds.size === 0) {
        setLocations([])
        setLocationsError('查詢失敗（找不到可用的 user_id）')
        setLocationsLoading(false)
        setActiveLocationIndex(0)
        return
      }

      const primaryRes = await supabase
        .from('locations')
        .select('id,user_id,name,lat,lng,radius')
        .in('user_id', Array.from(primaryUserIds))
        .order('name', { ascending: true })

      if (cancelled) return

      if (primaryRes.error) {
        setLocations([])
        setLocationsError(primaryRes.error.message)
        setLocationsLoading(false)
        setActiveLocationIndex(0)
        return
      }

      setLocations((primaryRes.data ?? []) as LocationRow[])
      setLocationsLoading(false)
      setActiveLocationIndex(0)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [
    accountMatches,
    deviceCreds,
    envMissing.length,
    getAccountAliases,
    resolveRegisteredUserIds,
    selectedAccount,
    selectedAccountLocationUserIds,
    toAccountKey,
  ])

  const selectedDevices = useMemo(() => {
    if (selectedAccount === 'all') return []

    const rowsById = new Map<string, DeviceCredentialRow[]>()
    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const id = String(d.id ?? '').trim()
      if (!id) continue
      if (!rowsById.has(id)) rowsById.set(id, [])
      rowsById.get(id)!.push(d)
    }

    const ownedDeviceIds = new Set<string>()
    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const shareFrom = String(d.share_from ?? '').trim()
      if (shareFrom) continue
      if (accountMatches(d.user_id, selectedAccount)) ownedDeviceIds.add(String(d.id ?? '').trim())
    }

    const visibleDeviceIds = new Set<string>(ownedDeviceIds)
    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const shareFrom = String(d.share_from ?? '').trim()
      if (shareFrom && accountMatches(d.user_id, selectedAccount)) visibleDeviceIds.add(String(d.id ?? '').trim())
    }

    const out: DeviceCredentialRow[] = []
    for (const id of visibleDeviceIds) {
      const rows = rowsById.get(id) ?? []
      if (!rows.length) continue
      const isOwned = ownedDeviceIds.has(id)
      const ownerRow = rows.find((r) => !String(r.share_from ?? '').trim()) ?? null
      const recipientShareRow = rows.find((r) => accountMatches(r.user_id, selectedAccount) && String(r.share_from ?? '').trim()) ?? null
      const ownedRow = rows.find((r) => accountMatches(r.user_id, selectedAccount) && !String(r.share_from ?? '').trim()) ?? null

      if (isOwned) {
        out.push(ownedRow ?? ownerRow ?? rows[0])
        continue
      }

      if (!recipientShareRow) {
        out.push(rows[0])
        continue
      }

      if (!ownerRow) {
        out.push(recipientShareRow)
        continue
      }

      out.push({
        id: ownerRow.id,
        user_id: recipientShareRow.user_id,
        device_name: ownerRow.device_name ?? recipientShareRow.device_name,
        device_name_initial: recipientShareRow.device_name_initial,
        device_name_custom: recipientShareRow.device_name_custom,
        mqtt_user: ownerRow.mqtt_user,
        mqtt_pass: ownerRow.mqtt_pass,
        server_no: ownerRow.server_no,
        share_from: recipientShareRow.share_from,
      })
    }

    out.sort((a, b) => displayDeviceName(a).localeCompare(displayDeviceName(b)))
    return out
  }, [accountMatches, deviceCreds, selectedAccount])

  const mqttListVisible = useMemo(() => mqttList.filter((r) => r.url && r.url.trim()), [mqttList])

  const mqttMap = useMemo(() => {
    const m: Record<number, string> = {}
    for (const row of mqttListVisible) {
      if (row.server_no != null && row.url) m[row.server_no] = row.url
    }
    return m
  }, [mqttListVisible])


  // stable key：只有設備憑證或 broker URL 真正改變時才重建長連線
  const mqttStableKey = useMemo(() => {
    const devPart = deviceCreds
      .filter((d) => !isIgnoredShareRow(d) && d.mqtt_user && d.mqtt_pass && d.device_name)
      .map((d) => `${d.id}:${d.mqtt_user}:${d.server_no}`)
      .sort()
      .join('|')
    const mapPart = Object.entries(mqttMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('|')
    return `${devPart}||${mapPart}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceCreds, mqttMap, mqttRefreshNonce])
  // ── 長連線 MQTT：仿網頁版，每個 server_no 一條持久連線 ──
  // ● 連上後訂閱所有設備的 status topic（retain 即時反映）
  // ● 分享設備（share_from 不為空）用主設備（owner）的憑證建連線與訂閱
  // ● topic → device ids 映射：同一設備的主帳號 row 和分享 row 共用同一 id，
  //   因此收到訊息後一次更新所有對應 id，主/分享帳號狀態自動同步
  useEffect(() => {
    if (envMissing.length) return
    if (!deviceCreds.length || !Object.keys(mqttMap).length) return
    // 1. 建立 owner row 查找表：key = `${mqtt_user}/${device_name}`
    const ownerByTopicKey = new Map<string, DeviceCredentialRow>()
    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      if (String(d.share_from ?? '').trim()) continue
      const mqttUser = String(d.mqtt_user ?? '').trim()
      const deviceName = String(d.device_name ?? '').trim()
      if (mqttUser && deviceName && d.mqtt_pass) {
        ownerByTopicKey.set(`${mqttUser}/${deviceName}`, d)
      }
    }

    // 2. 按 server_no 分組，建立 topic → device ids 映射
    //    同一個 topic 的主設備 row 和所有分享設備 row 的 id 通常相同，
    //    這裡統一收集，確保一次更新所有相關 id
    type ServerGroup = {
      ownerCred: DeviceCredentialRow
      topicsToIds: Map<string, string[]>
    }
    const groups = new Map<number, ServerGroup>()

    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const mqttUser = String(d.mqtt_user ?? '').trim()
      const deviceName = String(d.device_name ?? '').trim()
      if (!mqttUser || !deviceName) continue

      const no = d.server_no != null && d.server_no > 0 ? d.server_no : 1
      if (!mqttMap[no]) continue

      // 找這台設備的 owner row（有憑證）
      const ownerRow = ownerByTopicKey.get(`${mqttUser}/${deviceName}`)
      if (!ownerRow) continue

      if (!groups.has(no)) {
        groups.set(no, { ownerCred: ownerRow, topicsToIds: new Map() })
      }
      const group = groups.get(no)!

      const topic = `device/${mqttUser}/${deviceName}/status`
      if (!group.topicsToIds.has(topic)) group.topicsToIds.set(topic, [])
      const ids = group.topicsToIds.get(topic)!
      if (!ids.includes(d.id)) ids.push(d.id)
    }

    const cleanups: (() => void)[] = []
    let mounted = true

    for (const [no, group] of groups.entries()) {
      const rawUrl = mqttMap[no]
      if (!rawUrl) continue
      const url = normalizeBrokerUrl(rawUrl)
      const { ownerCred, topicsToIds } = group
      if (!ownerCred.mqtt_user || !ownerCred.mqtt_pass) continue

      let isActive = true

      const client = mqtt.connect(url, {
        username: ownerCred.mqtt_user,
        password: ownerCred.mqtt_pass,
        clientId: `maint_${no}_${Math.random().toString(36).slice(2, 8)}`,
        reconnectPeriod: 5000,   // 長連線：斷線自動重連
        keepalive: 30,
        clean: true,
      })

      client.on('connect', () => {
        if (!isActive || !mounted) return
        setServerOnlineByNo((prev) => ({ ...prev, [no]: { online: true, updatedAt: Date.now() } }))

        // 訂閱所有設備的 status topic
        const topics = Array.from(topicsToIds.keys())
        if (topics.length) client.subscribe(topics, { qos: 0 })
      })

      client.on('message', (topic, payload) => {
        if (!isActive || !mounted) return
        const text = new TextDecoder().decode(payload).trim()
        const action = parseStatusAction(text)
        const a = String(action ?? '').trim().toLowerCase()
        const online = a !== 'offline' && a !== 'disconnected'

        // 更新所有對應此 topic 的 device ids（含主設備與分享設備）
        const ids = topicsToIds.get(topic)
        if (!ids) return
        setDeviceOnlineByDeviceId((prev) => {
          const next = { ...prev }
          for (const id of ids) {
            next[id] = { online, updatedAt: Date.now() }
          }
          return next
        })
      })

      client.on('error', () => {
        // auth 錯誤等不強制標記 Offline（可能只是憑證問題，伺服器仍在線）
      })

      client.on('close', () => {
        if (!isActive || !mounted) return
        setServerOnlineByNo((prev) => ({ ...prev, [no]: { online: false, updatedAt: Date.now() } }))
      })

      client.on('reconnect', () => {
        if (!isActive || !mounted) return
        // 重連中：暫時標記為 false，等 connect 事件再改回 true
        setServerOnlineByNo((prev) => ({ ...prev, [no]: { online: false, updatedAt: Date.now() } }))
      })

      cleanups.push(() => {
        isActive = false
        try { client.end(true) } catch { void 0 }
      })
    }

    return () => {
      mounted = false
      cleanups.forEach((fn) => fn())
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mqttStableKey, envMissing.length])

  // ── 設備連線狀態（長連線策略：直接信任 message 事件，不需 TTL 強制失效）──
  const deviceConnectionById = useMemo(() => {
    const map: Record<string, 'Online' | 'Offline' | 'Unknown'> = {}
    for (const d of deviceCreds) {
      const rec = deviceOnlineByDeviceId[d.id]
      if (!rec) {
        map[d.id] = 'Unknown'
        continue
      }
      map[d.id] = rec.online ? 'Online' : 'Offline'
    }
    return map
  }, [deviceCreds, deviceOnlineByDeviceId])

  const selectedDeviceConnectionStats = useMemo(() => {
    let online = 0
    let offline = 0
    let unknown = 0
    const seen = new Set<string>()
    for (const d of selectedDevices) {
      if (seen.has(d.id)) continue
      seen.add(d.id)
      const s = deviceConnectionById[d.id] ?? 'Unknown'
      if (s === 'Online') online += 1
      else if (s === 'Offline') offline += 1
      else unknown += 1
    }
    return { online, offline, unknown }
  }, [deviceConnectionById, selectedDevices])

  const allOnlineDevicesCount = useMemo(() => {
    let count = 0
    const best = new Map<string, 'Online' | 'Offline' | 'Unknown'>()
    const rank = (s: 'Online' | 'Offline' | 'Unknown') => (s === 'Online' ? 3 : s === 'Offline' ? 2 : 1)

    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const mqttUser = String(d.mqtt_user ?? '').trim()
      if (!mqttUser) continue
      const next = deviceConnectionById[d.id] ?? 'Unknown'
      const prev = best.get(mqttUser)
      if (!prev || rank(next) > rank(prev)) best.set(mqttUser, next)
    }

    for (const s of best.values()) {
      if (s === 'Online') count += 1
    }
    return count
  }, [deviceConnectionById, deviceCreds])

  const totalDevicesCount = useMemo(() => {
    const set = new Set<string>()
    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const mqttUser = String(d.mqtt_user ?? '').trim()
      if (mqttUser) set.add(mqttUser)
    }
    return set.size
  }, [deviceCreds])

  const deviceOnlineStatsByUser = useMemo(() => {
    const map: Record<string, { online: number; total: number }> = {}

    const rank = (s: 'Online' | 'Offline' | 'Unknown') => (s === 'Online' ? 3 : s === 'Offline' ? 2 : 1)
    const bestStatusByUser: Record<string, Map<string, 'Online' | 'Offline' | 'Unknown'>> = {}
    const ensureBest = (k: string) => (bestStatusByUser[k] ??= new Map<string, 'Online' | 'Offline' | 'Unknown'>())

    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const userKey = toAccountKey(d.user_id)
      if (!userKey) continue
      const key = deviceIdentityKey(d)
      const best = ensureBest(userKey)
      const nextStatus = deviceConnectionById[d.id] ?? 'Unknown'
      const prev = best.get(key)
      if (!prev || rank(nextStatus) > rank(prev)) best.set(key, nextStatus)
    }

    for (const [userKey, best] of Object.entries(bestStatusByUser)) {
      let online = 0
      let total = 0
      for (const s of best.values()) {
        total += 1
        if (s === 'Online') online += 1
      }
      map[userKey] = { online, total }
    }

    return map
  }, [deviceConnectionById, deviceCreds, toAccountKey])

  // ── 伺服器狀態（長連線策略：直接信任 connect/close 事件）──
  const mqttServerStatus = useMemo(() => {
    const map: Record<number, 'Online' | 'Offline' | 'Unknown'> = {}

    for (const row of mqttListVisible) {
      const rec = serverOnlineByNo[row.server_no]
      if (!rec) {
        map[row.server_no] = 'Unknown'
      } else {
        map[row.server_no] = rec.online ? 'Online' : 'Offline'
      }
    }

    // 保底：若有設備已確認 Online，對應伺服器至少是 Online
    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const no = d.server_no != null && d.server_no > 0 ? d.server_no : 1
      const s = deviceConnectionById[d.id] ?? 'Unknown'
      if (s === 'Online') map[no] = 'Online'
    }

    return map
  }, [deviceConnectionById, deviceCreds, mqttListVisible, serverOnlineByNo])

  return (
    <AppShell>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs text-slate-400">即時監控</div>
          <h1 className="text-lg font-semibold tracking-wide">管理總覽</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => {
            setRefreshNonce((v) => v + 1)
            setMqttRefreshNonce((v) => v + 1)
          }} disabled={envMissing.length > 0}>
            重新整理
          </Button>
        </div>
      </div>

      {envMissing.length ? (
        <div className="mb-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          尚未設定環境變數：{envMissing.join(', ')}（請參考 `.env.example`）
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                tone={accounts.length ? 'success' : 'muted'}
                label={`${accounts.length} 筆`}
              />
            </div>
            <div className="mt-2 text-xs text-slate-400">管理員：{adminCount} 筆</div>
            <div className="mt-1 text-xs text-slate-400">登入：{user?.email ?? '—'}</div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-400">選擇帳號</div>
                <Select
                  value={selectedAccount}
                  onChange={(e) => void selectAccount(e.target.value)}
                  className="h-8 w-[260px] max-w-full px-2 text-xs"
                >
                  <option value="all">請選擇…</option>
                  {accounts.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </div>
              {selectedAccount !== 'all' ? (
                <div className="text-xs text-slate-400">
                  線上 {deviceOnlineStatsByUser[selectedAccount]?.online ?? 0} / {deviceOnlineStatsByUser[selectedAccount]?.total ?? 0}
                </div>
              ) : (
                <div className="text-xs text-slate-400">選擇帳號後顯示該帳號設備資料</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>設備狀態</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-slate-400">設備</div>
                <div className="mt-1 text-lg font-semibold text-cyan-200">{totalDevicesCount}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">伺服器</div>
                <div className="mt-1 text-lg font-semibold text-slate-200">{mqttListVisible.length}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">線上設備</div>
                <div className="mt-1 text-lg font-semibold text-slate-200">{allOnlineDevicesCount}</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              來源：MQTT retain status topic（長連線，即時更新）
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle>定位點（positions）</CardTitle>
              <div className="text-xs text-slate-400">帳號：{selectedAccount === 'all' ? '全部' : accountLabel(selectedAccount)}</div>
            </div>
          </CardHeader>
          <CardContent>
            {loadError ? (
              <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{loadError}</div>
            ) : (
              <LeafletPositionsMap
                markers={positionsMarkers}
                locations={locationItems}
                activeLocationIndex={activeLocationIndex}
                onActiveLocationIndexChange={setActiveLocationIndex}
                activeMarkerIndex={positionsMarkers.length > 0 ? Math.max(0, Math.min(activePositionIndex, positionsMarkers.length - 1)) : undefined}
                className="h-[420px] w-full overflow-hidden rounded-xl border border-slate-800/60"
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <div>
                最近 {selectedAccount === 'all' ? positions.length : accountPositions.length} 筆（每 30 秒自動刷新）
              </div>
              {positionsMarkers.length > 1 && selectedAccount !== 'all' ? (
                <div className="flex items-center gap-1">
                  <button
                    className="rounded px-1.5 py-0.5 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-30"
                    onClick={() => setActivePositionIndex((i) => Math.max(0, i - 1))}
                    disabled={activePositionIndex <= 0}
                  >{'<'}</button>
                  <span className="text-slate-300">
                    GPS {activePositionIndex + 1}/{positionsMarkers.length}
                    {positionsMarkers[activePositionIndex]?.subtitle ? ` · ${positionsMarkers[activePositionIndex].subtitle}` : ''}
                  </span>
                  <button
                    className="rounded px-1.5 py-0.5 text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-30"
                    onClick={() => setActivePositionIndex((i) => Math.min(positionsMarkers.length - 1, i + 1))}
                    disabled={activePositionIndex >= positionsMarkers.length - 1}
                  >{'>'}</button>
                </div>
              ) : null}
              <div>定位點 {locationItems.length} 個</div>
              {locationItems.length ? <div>目前：{locationItems[Math.max(0, Math.min(activeLocationIndex, locationItems.length - 1))]?.name ?? '—'}</div> : null}
              {accountPositionsLoading ? <div>positions 讀取中…</div> : null}
              {accountPositionsError ? <div className="text-rose-200">{accountPositionsError}</div> : null}
              {locationsLoading ? <div>locations 讀取中…</div> : null}
              {locationsError ? <div className="text-rose-200">locations：{locationsError}</div> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>MQTT 伺服器（mqtt_list）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {mqttListVisible.length === 0 ? (
                <div className="text-sm text-slate-300">{loading ? '讀取中…' : '目前沒有資料'}</div>
              ) : (
                mqttListVisible.map((s) => {
                  const status = mqttServerStatus[s.server_no] ?? 'Unknown'
                  const tone = status === 'Online' ? 'success' : status === 'Offline' ? 'danger' : 'muted'
                  const label = status === 'Online' ? '線上' : status === 'Offline' ? '離線' : '未知'
                  return (
                  <div key={s.server_no} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800/60 bg-white/5 px-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-slate-100">Server #{s.server_no}</div>
                      <div className="text-xs text-slate-400 break-all">{s.url}</div>
                    </div>
                    <div className="pt-0.5">
                      <StatusBadge tone={tone} label={label} />
                    </div>
                  </div>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader>
          <CardTitle>帳號清單</CardTitle>
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
                <th className="px-5 py-3 font-medium">選取</th>
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
              ) : accounts.length === 0 ? (
                <tr>
                  <td className="px-5 py-6 text-sm text-slate-300" colSpan={7}>
                    目前沒有資料
                  </td>
                </tr>
              ) : (
                accounts.map((a) => {
                  const s = deviceStatsByUser[a.key] ?? { owned: 0, sharedIn: 0, sharedOut: 0, total: 0 }
                  const perms = getPermissions(registeredByAccountKey[a.key]) || '—'
                  const isSelected = selectedAccount === a.key
                  return (
                    <tr
                      key={a.key}
                      className={`cursor-pointer text-sm hover:bg-white/5 ${isSelected ? 'bg-cyan-400/5 text-cyan-100' : 'text-slate-200'}`}
                      onClick={() => void selectAccount(a.key)}
                    >
                      <td className="px-5 py-3">
                        <div className="font-mono text-xs">{a.label}</div>
                        {userIdToEmail[a.key] ? <div className="mt-0.5 font-mono text-[10px] text-slate-400">{a.key}</div> : null}
                      </td>
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
                          onClick={() => void selectAccount(a.key)}
                        >
                          {isSelected ? '已選取' : '選取'}
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

      <Card className="mt-4 overflow-hidden">
        <CardHeader>
          <CardTitle>帳號設備（device_credentials）</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-slate-200">目前選取：{selectedAccount === 'all' ? '—' : accountLabel(selectedAccount)}</div>
            <div className="text-xs text-slate-400">
              線上 {selectedDeviceConnectionStats.online} ｜ 離線 {selectedDeviceConnectionStats.offline} ｜ 未知 {selectedDeviceConnectionStats.unknown}
            </div>
          </div>

          {selectedAccount === 'all' ? (
            <div className="text-sm text-slate-300">請先選擇帳號</div>
          ) : selectedDevices.length === 0 ? (
            <div className="text-sm text-slate-300">沒有設備資料</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800/60">
              <table className="min-w-[980px] w-full">
                <thead className="bg-white/5">
                  <tr className="text-left text-xs text-slate-400">
                    <th className="px-4 py-3 font-medium">user_id</th>
                    <th className="px-4 py-3 font-medium">設備</th>
                    <th className="px-4 py-3 font-medium">server_no</th>
                    <th className="px-4 py-3 font-medium">mqtt_user</th>
                    <th className="px-4 py-3 font-medium">share_from</th>
                    <th className="px-4 py-3 font-medium">連線</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {selectedDevices.map((d) => {
                    const s = deviceConnectionById[d.id] ?? 'Unknown'
                    const tone: 'success' | 'danger' | 'muted' = s === 'Online' ? 'success' : s === 'Offline' ? 'danger' : 'muted'
                    const label = s === 'Online' ? '線上' : s === 'Offline' ? '離線' : '未知'
                    const updatedAt = deviceOnlineByDeviceId[d.id]?.updatedAt ?? null
                    const ownerKey = deviceOwnershipById.get(d.id) ?? toAccountKey(d.user_id)
                    return (
                      <tr key={d.id} className="text-sm text-slate-200 hover:bg-white/5">
                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{accountLabel(ownerKey)}</td>
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
                            <StatusBadge tone={tone} label={label} />
                          </div>
                          <div className="mt-1 text-xs text-slate-400">最後更新：{formatTs(updatedAt ? new Date(updatedAt).toISOString() : null)}</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 text-xs text-slate-400">連線狀態來源：device/&lt;mqtt_user&gt;/&lt;device_name&gt;/status（長連線，retain 即時反映）</div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
