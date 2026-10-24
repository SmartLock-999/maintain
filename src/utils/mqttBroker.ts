// MQTT Broker URL 候選工具
// 用途：mqtt_list.url 若只存 hostname（無 protocol），自動在 EMQX(8084) 與 HiveMQ(8884) 之間切換
import mqtt from 'mqtt'

// 雙埠快取：每個 server_no 上次成功連線的埠（8084 EMQX / 8884 HiveMQ），下次優先用
export const LAST_SUCCESS_PORT_KEY = 'maint_mqtt_last_success_port'

export function readLastPortMap(): Record<number, number> {
  try {
    return JSON.parse(localStorage.getItem(LAST_SUCCESS_PORT_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

export function writeLastPort(serverNo: number, port: number) {
  try {
    const m = readLastPortMap()
    m[serverNo] = port
    localStorage.setItem(LAST_SUCCESS_PORT_KEY, JSON.stringify(m))
  } catch {
    void 0
  }
}

/**
 * 解析 mqtt_list.url 並回傳「候選 URL 陣列」：
 *   ① 已有 wss?:// protocol        → 單一 URL（使用者明確指定，不自動切換）
 *   ② 只有 hostname (無 protocol)   → 兩個候選，優先順序：
 *        - 上次成功的埠（若存在）排第一
 *        - 其次 8084 (EMQX Serverless) 與 8884 (HiveMQ / 一般商用)
 *      連線失敗時由呼叫端自動輪換
 */
export function getBrokerCandidates(serverNo: number, mqttList: Record<number, string>): string[] | null {
  const raw = String(mqttList[serverNo] ?? '').trim()
  if (!raw) return null
  if (/^wss?:\/\//i.test(raw)) return [raw]
  const lastPort = readLastPortMap()[serverNo]
  const ports =
    lastPort === 8084 || lastPort === 8884
      ? [lastPort, lastPort === 8084 ? 8884 : 8084]
      : [8084, 8884]
  return ports.map((p) => `wss://${raw}:${p}/mqtt`)
}

export function parsePortFromUrl(url: string): number | null {
  try {
    const u = new URL(url)
    return u.port ? parseInt(u.port, 10) : u.protocol === 'wss:' ? 443 : 80
  } catch {
    return null
  }
}

export type BrokerLink = {
  /** 是否已連線 */
  isConnected: () => boolean
  /** 發佈訊息；未連線時回傳 false */
  publish: (topic: string, payload: string, qos?: 0 | 1) => boolean
  /** 訂閱 topic 並註冊訊息處理器（重新連線後會自動重新訂閱） */
  subscribe: (topic: string, handler: (topic: string, payloadText: string) => void) => void
  /** 關閉連線並釋放資源 */
  close: () => void
}

/**
 * 建立一條可自動換埠的長連線：
 *  - 逐候選嘗試（EMQX 8084 / HiveMQ 8884），連上後記錄成功埠
 *  - 連上後自動重連（同埠）；連上過後斷線 → 4 秒重試
 *  - 尚未連上就失敗 → 依序換下一個候選（300ms）；非自動模式固定 5 秒重試
 */
export function createBrokerLink(opts: {
  serverNo: number
  mqttList: Record<number, string>
  username: string
  password: string
  clientId?: string
  onStatus?: (online: boolean) => void
}): BrokerLink {
  const candidates = getBrokerCandidates(opts.serverNo, opts.mqttList) ?? []
  const handlers = new Map<string, (topic: string, payloadText: string) => void>()
  const autoSwap = candidates.length > 1

  let client: mqtt.MqttClient | null = null
  let candIdx = 0
  let connected = false
  let everConnected = false
  let closed = false
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null

  const clearWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog)
      watchdog = null
    }
  }

  const scheduleRetry = (ms: number) => {
    if (closed || retry) return
    retry = setTimeout(() => {
      retry = null
      if (!closed) connectOnce()
    }, ms)
  }

  const onFail = () => {
    if (closed || retry) return
    if (autoSwap) {
      candIdx = (candIdx + 1) % candidates.length
      scheduleRetry(300)
    } else {
      scheduleRetry(5000)
    }
  }

  function connectOnce() {
    if (closed || !candidates.length) return
    const url = candidates[candIdx % candidates.length]
    clearWatchdog()
    if (client) {
      try {
        client.end(true)
      } catch {
        void 0
      }
      client = null
    }
    connected = false

    const c = mqtt.connect(url, {
      username: opts.username,
      password: opts.password,
      clientId: opts.clientId ?? `maint_link_${opts.serverNo}_${Math.random().toString(36).slice(2, 8)}`,
      reconnectPeriod: 0, // 自行控制重連（才能換埠）
      keepalive: 60,
      connectTimeout: 15000,
      clean: true,
    })
    client = c

    watchdog = setTimeout(() => {
      if (!closed && !connected) onFail()
    }, 10_000)

    c.on('connect', () => {
      connected = true
      everConnected = true
      clearWatchdog()
      const port = parsePortFromUrl(url)
      if (port) writeLastPort(opts.serverNo, port)
      for (const topic of handlers.keys()) c.subscribe(topic, { qos: 0 })
      opts.onStatus?.(true)
    })

    c.on('message', (topic, payload) => {
      const h = handlers.get(topic)
      if (h) h(topic, payload.toString())
    })

    c.on('close', () => {
      if (closed) return
      connected = false
      opts.onStatus?.(false)
      if (retry) return
      if (everConnected) scheduleRetry(4000)
      else onFail()
    })

    c.on('error', () => {
      if (!closed && !connected) onFail()
    })
  }

  connectOnce()

  return {
    isConnected: () => connected,
    publish: (topic, payload, qos = 1) => {
      if (!client || !connected) return false
      client.publish(topic, payload, { qos, retain: false })
      return true
    },
    subscribe: (topic, handler) => {
      handlers.set(topic, handler)
      if (client && connected) client.subscribe(topic, { qos: 0 })
    },
    close: () => {
      closed = true
      clearWatchdog()
      if (retry) {
        clearTimeout(retry)
        retry = null
      }
      if (client) {
        try {
          client.end(true)
        } catch {
          void 0
        }
        client = null
      }
    },
  }
}
