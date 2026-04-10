import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'

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

export function LeafletPositionsMap({ markers, className }: { markers: MarkerItem[]; className?: string }) {
  const center = useMemo(() => {
    const first = markers[0]
    if (first) return [first.lat, first.lng] as [number, number]
    return [22.6273, 120.3014] as [number, number]
  }, [markers])

  return (
    <div className={className}>
      <MapContainer center={center} zoom={markers.length ? 13 : 12} className="h-full w-full">
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FitToMarkers markers={markers} />
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
