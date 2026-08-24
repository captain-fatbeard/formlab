import { useEffect, useState, useRef } from 'react'
import type { Map as LeafletMap } from 'leaflet'

interface ActivityMapProps {
  polyline: string
}

export function ActivityMap({ polyline }: ActivityMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<LeafletMap | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return

    let cancelled = false

    async function initMap() {
      try {
        const [L, polylineLib] = await Promise.all([
          import('leaflet'),
          import('@mapbox/polyline'),
        ])

        // Import leaflet CSS
        await import('leaflet/dist/leaflet.css')

        if (cancelled || !mapRef.current) return

        const coords = polylineLib.decode(polyline)
        if (coords.length === 0) {
          setError(true)
          return
        }

        const latLngs = coords.map(([lat, lng]: [number, number]) => L.default.latLng(lat, lng))

        const map = L.default.map(mapRef.current, {
          zoomControl: true,
          // The OpenStreetMap and CARTO tile licences both require credit —
          // this was switched off, which is a licensing problem as well as a
          // missing affordance.
          attributionControl: true,
        })
        leafletMapRef.current = map

        // Dark CartoDB tiles to match app theme
        L.default.tileLayer(
          'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          {
            maxZoom: 19,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          }
        ).addTo(map)

        // Route line in accent color
        const routeLine = L.default.polyline(latLngs, {
          color: '#14b8a6',
          weight: 3,
          opacity: 0.9,
        }).addTo(map)

        // Start marker (green)
        L.default.circleMarker(latLngs[0], {
          radius: 7,
          fillColor: '#14b8a6',
          fillOpacity: 1,
          color: '#0e1515',
          weight: 2,
        }).addTo(map)

        // End marker (red)
        L.default.circleMarker(latLngs[latLngs.length - 1], {
          radius: 7,
          fillColor: '#f87171',
          fillOpacity: 1,
          color: '#111919',
          weight: 2,
        }).addTo(map)

        // Fit after a frame, and again whenever the card resizes: fitting
        // against a container Leaflet has not measured yet leaves the route as
        // a fifth of a map showing half the Baltic.
        const bounds = routeLine.getBounds()
        const fit = () => {
          map.invalidateSize()
          map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 })
        }
        requestAnimationFrame(fit)

        const observer = new ResizeObserver(fit)
        observer.observe(mapRef.current)
        resizeObserverRef.current = observer
      } catch {
        setError(true)
      }
    }

    initMap()

    return () => {
      cancelled = true
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
      }
    }
  }, [polyline])

  if (error) {
    return (
      <div className="h-80 rounded-[var(--radius-lg)] bg-bg-secondary border border-border-subtle flex items-center justify-center text-text-muted">
        Failed to load map
      </div>
    )
  }

  return (
    <div
      ref={mapRef}
      className="h-80 rounded-[var(--radius-lg)] border border-border-subtle overflow-hidden"
    />
  )
}
