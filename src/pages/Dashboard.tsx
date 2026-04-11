import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

  const [mqttList, setMqttList] = useState<MqttListRow[]>([])
  const [registered, setRegistered] = useState<RegisteredEmailRow[]>([])
  const [deviceCreds, setDeviceCreds] = useState<DeviceCredentialRow[]>([])
  const [positions, setPositions] = useState<PositionRow[]>([])
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [locationsLoading, setLocationsLoading] = useState(false)
  const [locationsError, setLocationsError] = useState<string | null>(null)
  const [activeLocationIndex, setActiveLocationIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [selectedAccount, setSelectedAccount] = useState<string>('all')

  const connectivityRunRef = useRef(0)
  const connectivityRunningRef = useRef(false)
  const [deviceOnlineByDeviceId, setDeviceOnlineByDeviceId] = useState<Record<string, { online: boolean; updatedAt: number }>>({})
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
    }

    return userIds
  }, [getAccountAliases, registered])

  useEffect(() => {
    if (selectedAccount === 'all') return
    const normalized = toAccountKey(selectedAccount)
    if (normalized && normalized !== selectedAccount) setSelectedAccount(normalized)
  }, [selectedAccount, toAccountKey])

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
    const filtered =
      selectedAccount === 'all' ? positions : positions.filter((p) => accountMatches(p.user_id, selectedAccount))
    return filtered
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
  }, [accountLabel, accountMatches, positions, selectedAccount, toAccountKey])

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
      const primaryUserIds = resolveRegisteredUserIds(selectedAccount)

      if (primaryUserIds.size === 0 && aliases.email) {
        const res = await supabase
          .from('registered_emails')
          .select('user_id, email')
          .ilike('email', aliases.email)
          .limit(5)

        if (!cancelled) {
          const rows = (res.data ?? []) as RegisteredEmailRow[]
          for (const row of rows) {
            const userId = String(row.user_id ?? '').trim()
            const email = String(row.email ?? '').trim()
            if (aliases.normalizedValues.has(email.toLowerCase()) && isUuid(userId)) {
              primaryUserIds.add(userId)
            }
          }
        }
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

      const primaryLocations = (primaryRes.data ?? []) as LocationRow[]
      if (primaryLocations.length > 0) {
        setLocations(primaryLocations)
        setLocationsLoading(false)
        setActiveLocationIndex(0)
        return
      }

      const fallbackOwnerIds = new Set<string>()
      for (const d of deviceCreds) {
        if (isIgnoredShareRow(d)) continue
        const shareFrom = String(d.share_from ?? '').trim()
        if (!shareFrom) continue
        if (!accountMatches(d.user_id, selectedAccount)) continue

        const sharedOwnerIds = resolveRegisteredUserIds(shareFrom)
        for (const userId of sharedOwnerIds) {
          fallbackOwnerIds.add(userId)
        }
      }

      if (fallbackOwnerIds.size === 0) {
        setLocations([])
        setLocationsLoading(false)
        setActiveLocationIndex(0)
        return
      }

      const fallbackRes = await supabase
        .from('locations')
        .select('id,user_id,name,lat,lng,radius')
        .in('user_id', Array.from(fallbackOwnerIds))
        .order('name', { ascending: true })

      if (cancelled) return
      if (fallbackRes.error) {
        setLocations([])
        setLocationsError(fallbackRes.error.message)
      } else {
        setLocations((fallbackRes.data ?? []) as LocationRow[])
      }
      setLocationsLoading(false)
      setActiveLocationIndex(0)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [accountMatches, deviceCreds, envMissing.length, getAccountAliases, resolveRegisteredUserIds, selectedAccount])

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
      const preferred = isOwned
        ? rows.find((r) => accountMatches(r.user_id, selectedAccount) && !String(r.share_from ?? '').trim())
        : rows.find((r) => accountMatches(r.user_id, selectedAccount) && String(r.share_from ?? '').trim())
      out.push(preferred ?? rows[0])
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

  const deviceConnectionById = useMemo(() => {
    const nowMs = Date.now()
    const ttlMs = 5 * 60_000
    const map: Record<string, 'Online' | 'Offline' | 'Unknown'> = {}
    for (const d of deviceCreds) {
      const rec = deviceOnlineByDeviceId[d.id]
      if (!rec) {
        map[d.id] = 'Unknown'
        continue
      }
      const stale = nowMs - rec.updatedAt > ttlMs
      if (stale) {
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

  const mqttServerStatus = useMemo(() => {
    const nowMs = Date.now()
    const ttlMs = 2 * 60_000
    const map: Record<number, 'Online' | 'Offline' | 'Unknown'> = {}
    for (const row of mqttListVisible) {
      const rec = serverOnlineByNo[row.server_no]
      if (!rec) {
        map[row.server_no] = 'Unknown'
        continue
      }
      const stale = nowMs - rec.updatedAt > ttlMs
      if (stale) {
        map[row.server_no] = 'Unknown'
        continue
      }
      map[row.server_no] = rec.online ? 'Online' : 'Offline'
    }

    for (const d of deviceCreds) {
      if (isIgnoredShareRow(d)) continue
      const no = d.server_no != null && d.server_no > 0 ? d.server_no : 1
      const s = deviceConnectionById[d.id] ?? 'Unknown'
      if (s === 'Online') map[no] = 'Online'
    }

    return map
  }, [deviceConnectionById, deviceCreds, mqttListVisible, serverOnlineByNo])

  useEffect(() => {
    if (envMissing.length) return
    if (!mqttListVisible.length) return
    const connectTimeoutMs = 8000
    const intervalMs = 60_000

    let cancelled = false

    const checkServer = (serverNo: number, rawUrl: string) =>
      new Promise<void>((resolve) => {
        const url = normalizeBrokerUrl(rawUrl)
        const creds = deviceCreds.find(
          (d) =>
            !isIgnoredShareRow(d) &&
            (d.server_no ?? 1) === serverNo &&
            String(d.mqtt_user ?? '').trim() &&
            String(d.mqtt_pass ?? '').trim(),
        )

        const client = mqtt.connect(url, {
          username: creds?.mqtt_user ?? undefined,
          password: creds?.mqtt_pass ?? undefined,
          reconnectPeriod: 0,
          keepalive: 30,
          clean: true,
          connectTimeout: connectTimeoutMs,
        })

        let settled = false
        const done = (online: boolean) => {
          if (settled) return
          settled = true
          try {
            client.end(true)
          } catch {
            void 0
          }
          if (!cancelled) setServerOnlineByNo((prev) => ({ ...prev, [serverNo]: { online, updatedAt: Date.now() } }))
          resolve()
        }

        const t = window.setTimeout(() => done(false), connectTimeoutMs)
        client.on('connect', () => {
          window.clearTimeout(t)
          done(true)
        })
        client.on('error', (e) => {
          window.clearTimeout(t)
          const msg = String((e as Error | undefined)?.message ?? '').toLowerCase()
          const authError =
            msg.includes('not authorized') || msg.includes('bad username') || msg.includes('identifier rejected')
          done(authError)
        })
        client.on('close', () => {
          window.clearTimeout(t)
          if (!settled) done(false)
        })
      })

    const run = async () => {
      for (const row of mqttListVisible) {
        if (cancelled) return
        if (!row.url?.trim()) continue
        await checkServer(row.server_no, row.url)
      }
    }

    void run()
    const t = window.setInterval(() => void run(), intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [deviceCreds, envMissing.length, mqttListVisible])

  useEffect(() => {
    if (envMissing.length) return
    if (!deviceCreds.length) return
    const maxConcurrency = 6
    const connectTimeoutMs = 8000
    const messageTimeoutMs = 5000
    const intervalMs = 60_000

    let cancelled = false

    const checkOne = (d: DeviceCredentialRow, runId: number) =>
      new Promise<void>((resolve) => {
        if (cancelled) return resolve()
        const deviceId = d.id

        const no = d.server_no != null && d.server_no > 0 ? d.server_no : 1
        const raw = mqttMap[no]
        const url = raw ? normalizeBrokerUrl(raw) : null
        if (!url || !raw?.trim()) return resolve()
        if (!d.mqtt_user || !d.mqtt_pass) return resolve()
        if (!d.device_name) return resolve()

        const client = mqtt.connect(url, {
          username: d.mqtt_user,
          password: d.mqtt_pass,
          reconnectPeriod: 0,
          keepalive: 30,
          clean: true,
          connectTimeout: connectTimeoutMs,
        })

        let settled = false
        const statusTopic = `device/${d.mqtt_user}/${d.device_name}/status`

        const done = () => {
          if (settled) return
          settled = true
          if (runId !== connectivityRunRef.current) {
            try {
              client.end(true)
            } catch {
              void 0
            }
            return resolve()
          }
          try {
            client.end(true)
          } catch {
            void 0
          }
          resolve()
        }

        const onMessage = (topic: string, payload: Uint8Array) => {
          if (topic !== statusTopic) return
          const text = new TextDecoder().decode(payload)
          const action = parseStatusAction(text)
          const a = String(action ?? '').trim().toLowerCase()
          const online = a !== 'offline' && a !== 'disconnected'
          setDeviceOnlineByDeviceId((prev) => ({ ...prev, [deviceId]: { online, updatedAt: Date.now() } }))
          done()
        }

        const t = window.setTimeout(() => {
          done()
        }, messageTimeoutMs)

        client.on('connect', () => {
          client.on('message', onMessage)
          client.subscribe(statusTopic, { qos: 0 }, () => {
            window.clearTimeout(t)
            window.setTimeout(() => done(), messageTimeoutMs)
          })
        })

        client.on('error', () => done())
        client.on('close', () => done())
      })

    const runBatch = async () => {
      if (connectivityRunningRef.current) return
      connectivityRunningRef.current = true
      const runId = Date.now()
      connectivityRunRef.current = runId

      const queue = deviceCreds.slice()
      const workers = Array.from({ length: Math.min(maxConcurrency, queue.length) }, async () => {
        while (queue.length && !cancelled && connectivityRunRef.current === runId) {
          const d = queue.shift()
          if (!d) break
          await checkOne(d, runId)
        }
      })
      await Promise.all(workers)
      if (!cancelled) connectivityRunningRef.current = false
    }

    void runBatch()
    const t = window.setInterval(() => void runBatch(), intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(t)
      connectivityRunningRef.current = false
    }
  }, [deviceCreds, envMissing.length, mqttMap])

  return (
    <AppShell>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs text-slate-400">即時監控</div>
          <h1 className="text-lg font-semibold tracking-wide">管理總覽</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRefreshNonce((v) => v + 1)} disabled={envMissing.length > 0}>
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
                <Select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}>
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
              來源：MQTT status topic（每 60 秒刷新，5 分鐘未更新視為未知）
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
                className="h-[420px] w-full overflow-hidden rounded-xl border border-slate-800/60"
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              <div>最近 {positions.length} 筆（每 30 秒自動刷新）</div>
              <div>定位點 {locationItems.length} 個</div>
              {locationItems.length ? <div>目前：{locationItems[Math.max(0, Math.min(activeLocationIndex, locationItems.length - 1))]?.name ?? '—'}</div> : null}
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
                      onClick={() => setSelectedAccount(a.key)}
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
                          onClick={() => setSelectedAccount(a.key)}
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
          <div className="mt-2 text-xs text-slate-400">連線狀態來源：device/&lt;mqtt_user&gt;/&lt;device_name&gt;/status（每 60 秒自動刷新）</div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
