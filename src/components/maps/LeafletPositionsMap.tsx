import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { LayersControl, MapContainer, TileLayer, Circle, CircleMarker, Popup, Tooltip, useMap } from 'react-leaflet'

type MarkerItem = {
  id: string
  lat: number
  lng: number
  title?: string
  subtitle?: string
}

type LocationItem = {
  id: string
  lat: number
  lng: number
  name?: string
  radiusM?: number | null
}

const MAP_ZOOM_STORAGE_KEY = 'smart-lock-console.map.zoom'

function readStoredZoom(): number | null {
  try {
    const raw = window.localStorage.getItem(MAP_ZOOM_STORAGE_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function persistZoom(zoom: number) {
  try {
    window.localStorage.setItem(MAP_ZOOM_STORAGE_KEY, String(zoom))
  } catch {
    void 0
  }
}

function FitToPoints({ points, disabled }: { points: Array<{ lat: number; lng: number }>; disabled?: boolean }) {
  const map = useMap()
  const [didFit, setDidFit] = useState(false)

  useEffect(() => {
    if (disabled) return
    if (!points.length) return
    if (didFit) return
    const latLngs = points.map((m) => [m.lat, m.lng] as [number, number])
    map.fitBounds(latLngs, { padding: [40, 40] })
    setDidFit(true)
  }, [didFit, disabled, map, points])

  return null
}

function LocateControl() {
  const map = useMap()
  const [busy, setBusy] = useState(false)
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracyM?: number } | null>(null)

  const onClick = useCallback(() => {
    if (!navigator.geolocation) return
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false)
        const { latitude, longitude, accuracy } = pos.coords
        setPos({ lat: latitude, lng: longitude, accuracyM: Number.isFinite(accuracy) ? accuracy : undefined })
        map.flyTo([latitude, longitude], map.getZoom(), { animate: true, duration: 0.7 })
      },
      () => {
        setBusy(false)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 10_000 },
    )
  }, [map])

  return (
    <>
      {pos ? (
        <>
          {pos.accuracyM ? (
            <Circle
              center={[pos.lat, pos.lng]}
              radius={pos.accuracyM}
              pathOptions={{ color: '#22C55E', weight: 1, fillColor: '#22C55E', fillOpacity: 0.12 }}
            />
          ) : null}
          <CircleMarker
            center={[pos.lat, pos.lng]}
            radius={7}
            pathOptions={{ color: '#22C55E', weight: 2, fillColor: '#22C55E', fillOpacity: 0.45 }}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-semibold">定位點</div>
                <div className="text-xs opacity-80">
                  {pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        </>
      ) : null}
      <div className="absolute left-3 top-3 z-[1000]">
        <button
          type="button"
          onClick={onClick}
          disabled={busy || !navigator.geolocation}
          className="rounded-lg border border-slate-800/60 bg-slate-950/80 px-3 py-2 text-xs text-slate-100 shadow backdrop-blur transition hover:bg-slate-950 disabled:opacity-60"
        >
          {busy ? '定位中…' : '定位'}
        </button>
      </div>
    </>
  )
}

function ZoomReporter({ onZoomChange }: { onZoomChange?: (zoom: number) => void }) {
  const map = useMap()

  useEffect(() => {
    const onZoomEnd = () => {
      const z = map.getZoom()
      persistZoom(z)
      onZoomChange?.(z)
    }

    map.on('zoomend', onZoomEnd)
    return () => {
      map.off('zoomend', onZoomEnd)
    }
  }, [map, onZoomChange])

  return null
}

function FlyToActiveLocation({ active }: { active: LocationItem | null }) {
  const map = useMap()

  useEffect(() => {
    if (!active) return
    map.flyTo([active.lat, active.lng], map.getZoom(), { animate: true, duration: 0.7 })
  }, [active, map])

  return null
}

function LocationSwitcher({
  activeIndex,
  activeName,
  total,
  onPrev,
  onNext,
}: {
  activeIndex: number
  activeName?: string | null
  total: number
  onPrev: () => void
  onNext: () => void
}) {
  if (total <= 1) return null

  const name = String(activeName ?? '').trim()

  return (
    <div className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-lg border border-slate-800/60 bg-slate-950/80 px-2 py-1 text-xs text-slate-100 shadow backdrop-blur">
        <button
          type="button"
          onClick={onPrev}
          className="rounded-md px-2 py-1 transition hover:bg-white/10"
          aria-label="prev-location"
          title="上一個定位點"
        >
          {'<'}
        </button>
        <div className="min-w-[56px] text-center tabular-nums">
          {activeIndex + 1}/{total}
        </div>
        {name ? (
          <div className="max-w-[180px] truncate text-slate-200" title={name}>
            {name}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onNext}
          className="rounded-md px-2 py-1 transition hover:bg-white/10"
          aria-label="next-location"
          title="下一個定位點"
        >
          {'>'}
        </button>
      </div>
    </div>
  )
}

export function LeafletPositionsMap({
  markers,
  locations,
  activeLocationIndex,
  onActiveLocationIndexChange,
  className,
  onZoomChange,
}: {
  markers: MarkerItem[]
  locations?: LocationItem[]
  activeLocationIndex?: number
  onActiveLocationIndexChange?: (index: number) => void
  className?: string
  onZoomChange?: (zoom: number) => void
}) {
  const savedZoom = useMemo(() => readStoredZoom(), [])

  const safeLocations = useMemo(() => locations ?? [], [locations])
  const [internalActiveIndex, setInternalActiveIndex] = useState(0)
  const activeIndex = activeLocationIndex ?? internalActiveIndex
  const setActiveIndex = onActiveLocationIndexChange ?? setInternalActiveIndex

  useEffect(() => {
    if (!safeLocations.length) {
      if (activeIndex !== 0) setActiveIndex(0)
      return
    }
    if (activeIndex < 0 || activeIndex >= safeLocations.length) setActiveIndex(0)
  }, [activeIndex, safeLocations.length, setActiveIndex])

  const activeLocation = safeLocations.length ? safeLocations[Math.max(0, Math.min(activeIndex, safeLocations.length - 1))] : null

  const center = useMemo(() => {
    if (activeLocation) return [activeLocation.lat, activeLocation.lng] as [number, number]
    const first = markers[0]
    if (first) return [first.lat, first.lng] as [number, number]
    return [22.6273, 120.3014] as [number, number]
  }, [activeLocation, markers])

  const pointsToFit = useMemo(() => {
    const points: Array<{ lat: number; lng: number }> = []
    for (const m of markers) points.push({ lat: m.lat, lng: m.lng })
    for (const l of safeLocations) points.push({ lat: l.lat, lng: l.lng })
    return points
  }, [markers, safeLocations])

  const onPrev = useCallback(() => {
    if (safeLocations.length <= 1) return
    const next = (activeIndex - 1 + safeLocations.length) % safeLocations.length
    setActiveIndex(next)
  }, [activeIndex, safeLocations.length, setActiveIndex])

  const onNext = useCallback(() => {
    if (safeLocations.length <= 1) return
    const next = (activeIndex + 1) % safeLocations.length
    setActiveIndex(next)
  }, [activeIndex, safeLocations.length, setActiveIndex])

  return (
    <div className={className}>
      <MapContainer
        center={center}
        zoom={savedZoom ?? (markers.length || safeLocations.length ? 13 : 12)}
        className="h-full w-full"
        zoomControl={false}
        maxZoom={22}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="衛星（Google）">
            <TileLayer
              url="https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&scale=2"
              subdomains={['mt0', 'mt1', 'mt2', 'mt3']}
              attribution="&copy; Google Maps"
              maxNativeZoom={21}
              maxZoom={22}
              detectRetina
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenStreetMap">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxNativeZoom={19}
              maxZoom={22}
              detectRetina
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Carto Light">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              maxNativeZoom={20}
              maxZoom={22}
              detectRetina
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Carto Dark">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              maxNativeZoom={20}
              maxZoom={22}
              detectRetina
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        <FitToPoints points={pointsToFit} disabled={savedZoom != null} />
        <ZoomReporter onZoomChange={onZoomChange} />
        <LocateControl />
        <LocationSwitcher
          activeIndex={activeIndex}
          activeName={activeLocation?.name ?? null}
          total={safeLocations.length}
          onPrev={onPrev}
          onNext={onNext}
        />
        <FlyToActiveLocation active={activeLocation} />
        {markers.map((m) => (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lng]}
            radius={7}
            pathOptions={{ color: '#00E5FF', weight: 2, fillColor: '#00E5FF', fillOpacity: 0.35 }}
          >
            {m.title || m.subtitle ? (
              <Popup>
                <div className="text-sm">
                  {m.title ? <div className="font-semibold">{m.title}</div> : null}
                  {m.subtitle ? <div className="text-xs opacity-80">{m.subtitle}</div> : null}
                </div>
              </Popup>
            ) : null}
          </CircleMarker>
        ))}
        {safeLocations.map((l, idx) => {
          const isActive = idx === activeIndex
          const stroke = isActive ? '#F59E0B' : '#FBBF24'
          const fill = isActive ? '#F59E0B' : '#FBBF24'
          const weight = isActive ? 3 : 2
          const fillOpacity = isActive ? 0.22 : 0.12
          return (
            <Fragment key={l.id}>
              {l.radiusM ? (
                <Circle
                  center={[l.lat, l.lng]}
                  radius={l.radiusM}
                  pathOptions={{ color: stroke, weight: 1, fillColor: fill, fillOpacity: 0.08 }}
                />
              ) : null}
              <CircleMarker
                center={[l.lat, l.lng]}
                radius={8}
                pathOptions={{ color: stroke, weight, fillColor: fill, fillOpacity }}
                eventHandlers={{
                  click: () => setActiveIndex(idx),
                }}
              >
                {l.name ? (
                  <Tooltip permanent direction="top" offset={[0, -10]} opacity={1}>
                    <div className="rounded bg-slate-950/90 px-2 py-1 text-xs text-slate-100 shadow">
                      {l.name}
                    </div>
                  </Tooltip>
                ) : null}
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold">{l.name ?? '定位點'}</div>
                    <div className="text-xs opacity-80">
                      {l.lat.toFixed(6)}, {l.lng.toFixed(6)}
                    </div>
                    {l.radiusM ? <div className="text-xs opacity-80">radius: {l.radiusM}m</div> : null}
                  </div>
                </Popup>
              </CircleMarker>
            </Fragment>
          )
        })}
      </MapContainer>
    </div>
  )
}
