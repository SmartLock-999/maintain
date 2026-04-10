import { useEffect, useMemo, useRef, useState } from 'react'

type GoogleMarkerInput = {
  id: string
  lat: number
  lng: number
  title?: string
  subtitle?: string
}

type GoogleWindow = Window & typeof globalThis & { google?: typeof google }

function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  const w = window as GoogleWindow
  if (w.google?.maps) return Promise.resolve(w.google as typeof google)

  const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps="1"]')
  if (existing) {
    return new Promise((resolve, reject) => {
      const onLoad = () => resolve(w.google as typeof google)
      const onError = () => reject(new Error('Google Maps 載入失敗'))
      existing.addEventListener('load', onLoad, { once: true })
      existing.addEventListener('error', onError, { once: true })
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.dataset.googleMaps = '1'
    script.async = true
    script.defer = true
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`
    script.onload = () => resolve(w.google as typeof google)
    script.onerror = () => reject(new Error('Google Maps 載入失敗'))
    document.head.appendChild(script)
  })
}

const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#0b1020' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#e6f1ff' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b1020' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#1b2a4a' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#9bb0d0' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0f1730' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#0f1730' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#1b2a4a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9bb0d0' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#0f1730' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#060a14' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5b6b8a' }] },
]

export function GooglePositionsMap({
  apiKey,
  markers,
  className,
}: {
  apiKey: string | null
  markers: GoogleMarkerInput[]
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const infoRef = useRef<google.maps.InfoWindow | null>(null)
  const gmarkersRef = useRef<google.maps.Marker[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const center = useMemo(() => {
    const first = markers[0]
    if (first) return { lat: first.lat, lng: first.lng }
    return { lat: 22.6273, lng: 120.3014 }
  }, [markers])

  useEffect(() => {
    if (!apiKey) {
      setLoadError('尚未設定 Google Maps API Key')
      return
    }

    let cancelled = false
    loadGoogleMaps(apiKey)
      .then((g) => {
        if (cancelled) return
        setLoadError(null)
        if (!containerRef.current) return
        if (!mapRef.current) {
          mapRef.current = new g.maps.Map(containerRef.current, {
            center,
            zoom: markers.length ? 13 : 12,
            styles: DARK_STYLE,
            disableDefaultUI: false,
            mapTypeControl: false,
            fullscreenControl: false,
            streetViewControl: false,
            clickableIcons: false,
          })
          infoRef.current = new g.maps.InfoWindow()
        } else {
          mapRef.current.setCenter(center)
        }
      })
      .catch((e) => {
        if (cancelled) return
        const message = e instanceof Error ? e.message : 'Google Maps 載入失敗'
        setLoadError(message)
      })

    return () => {
      cancelled = true
    }
  }, [apiKey, center, markers.length])

  useEffect(() => {
    const map = mapRef.current
    const w = window as GoogleWindow
    if (!map || !w.google?.maps) return

    for (const m of gmarkersRef.current) m.setMap(null)
    gmarkersRef.current = []

    const g = w.google as typeof google
    const info = infoRef.current ?? new g.maps.InfoWindow()
    infoRef.current = info

    const bounds = new g.maps.LatLngBounds()
    for (const item of markers) {
      const pos = { lat: item.lat, lng: item.lng }
      bounds.extend(pos)
      const marker = new g.maps.Marker({
        position: pos,
        map,
        title: item.title,
      })
      marker.addListener('click', () => {
        const title = item.title ? `<div style="font-weight:600;margin-bottom:2px;">${item.title}</div>` : ''
        const subtitle = item.subtitle ? `<div style="color:#9BB0D0;font-size:12px;">${item.subtitle}</div>` : ''
        info.setContent(`<div style="color:#0B1020;">${title}${subtitle}</div>`)
        info.open({ anchor: marker, map })
      })
      gmarkersRef.current.push(marker)
    }

    if (markers.length >= 2) map.fitBounds(bounds, 60)
  }, [markers])

  if (loadError) {
    return (
      <div className={className}>
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{loadError}</div>
      </div>
    )
  }

  return <div ref={containerRef} className={className} />
}
