import { useCallback, useEffect, useMemo, useState } from 'react'
import { LayersControl, MapContainer, TileLayer, Circle, CircleMarker, Popup, useMap } from 'react-leaflet'

type MarkerItem = {
  id: string
  lat: number
  lng: number
  title?: string
  subtitle?: string
}

function FitToMarkers({ markers }: { markers: MarkerItem[] }) {
  const map = useMap()

  useEffect(() => {
    if (!markers.length) return
    const latLngs = markers.map((m) => [m.lat, m.lng] as [number, number])
    map.fitBounds(latLngs, { padding: [40, 40] })
  }, [map, markers])

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
        map.flyTo([latitude, longitude], Math.max(map.getZoom(), 15), { animate: true, duration: 0.7 })
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

export function LeafletPositionsMap({ markers, className }: { markers: MarkerItem[]; className?: string }) {
  const center = useMemo(() => {
    const first = markers[0]
    if (first) return [first.lat, first.lng] as [number, number]
    return [22.6273, 120.3014] as [number, number]
  }, [markers])

  return (
    <div className={className}>
      <MapContainer
        center={center}
        zoom={markers.length ? 13 : 12}
        className="h-full w-full"
        zoomControl={false}
        maxZoom={22}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="OpenStreetMap">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxNativeZoom={19}
              maxZoom={22}
              detectRetina
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="衛星（Esri）">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              attribution="Tiles &copy; Esri"
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
        <FitToMarkers markers={markers} />
        <LocateControl />
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
      </MapContainer>
    </div>
  )
}
