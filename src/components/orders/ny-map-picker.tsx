'use client'

import { useEffect, useRef } from 'react'

// NY State bounding box center and default zoom
const NY_CENTER: [number, number] = [42.9, -75.5]
const NY_ZOOM = 6

export interface MapPickerValue {
  lat: number | null
  lon: number | null
}

interface NyMapPickerProps {
  value: MapPickerValue
  onChange: (lat: number, lon: number) => void
  className?: string
}

// This component renders a Leaflet map. It must only be rendered client-side
// because Leaflet depends on `window`. The parent uses React.lazy to ensure
// this file is never executed on the server.
export function NyMapPicker({ value, onChange, className }: NyMapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const markerRef = useRef<import('leaflet').Marker | null>(null)

  // Bootstrap Leaflet once the container is mounted
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      // Import the reprojected WGS84 GeoJSON — JSON modules are statically
      // bundled by Vite and do not execute on the server.
      const nyOutline = (await import('#/assets/ny-outline.json')).default

      if (cancelled || !containerRef.current) return

      // Fix the broken default icon paths that bundlers cause
      delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
        iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
        shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
      })

      const map = L.map(containerRef.current, {
        center: NY_CENTER,
        zoom: NY_ZOOM,
        zoomControl: true,
      })
      mapRef.current = map

      // OpenStreetMap tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map)

      // NY State outline from properly reprojected GeoJSON
      L.geoJSON(nyOutline as Parameters<typeof L.geoJSON>[0], {
        style: {
          color: '#dc4444',
          weight: 2,
          fillColor: '#dc4444',
          fillOpacity: 0.06,
          dashArray: '4 3',
        },
      }).addTo(map)

      // Place marker if a value already exists
      if (value.lat !== null && value.lon !== null) {
        const marker = L.marker([value.lat, value.lon], { draggable: true })
        marker.addTo(map)
        marker.on('dragend', () => {
          const pos = marker.getLatLng()
          onChange(round6(pos.lat), round6(pos.lng))
        })
        markerRef.current = marker
      }

      // Click to place / move marker
      map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        const lat = round6(e.latlng.lat)
        const lon = round6(e.latlng.lng)

        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lon])
        } else {
          const marker = L.marker([lat, lon], { draggable: true })
          marker.addTo(map)
          marker.on('dragend', () => {
            const pos = marker.getLatLng()
            onChange(round6(pos.lat), round6(pos.lng))
          })
          markerRef.current = marker
        }

        onChange(lat, lon)
      })
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external value → marker position (e.g. when user types in the inputs)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    ;(async () => {
      const L = (await import('leaflet')).default

      if (value.lat === null || value.lon === null) {
        if (markerRef.current) {
          markerRef.current.remove()
          markerRef.current = null
        }
        return
      }

      if (markerRef.current) {
        markerRef.current.setLatLng([value.lat, value.lon])
      } else {
        const marker = L.marker([value.lat, value.lon], { draggable: true })
        marker.addTo(map)
        marker.on('dragend', () => {
          const pos = marker.getLatLng()
          onChange(round6(pos.lat), round6(pos.lng))
        })
        markerRef.current = marker
      }
    })()
  }, [value.lat, value.lon, onChange])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
        markerRef.current = null
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: 240, width: '100%', borderRadius: 8, overflow: 'hidden' }}
    />
  )
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6
}
