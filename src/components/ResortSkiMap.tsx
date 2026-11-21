import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  type MapMouseEvent,
} from 'maplibre-gl';
import { Box, Compass, Layers, LocateFixed, Navigation, Play, Sparkles, X } from 'lucide-react';
import type {
  Difficulty,
  Lang,
  ResortData,
  SelectedMapFeature,
  UnitSystem,
} from '../types';
import {
  difficultyLabel,
  formatElev,
  formatLength,
  formatWind,
  liftTypeLabel,
  matchLiftStatus,
  matchTrailStatus,
} from '../utils/format';
import { buildSimulatedRun, snapPositionToMountain } from '../utils/geoLocate';
import { DifficultyIcon } from './DifficultyIcon';

type BasemapStyle = 'winter' | 'topo' | 'satellite';
type StatusFilter = 'all' | 'open' | 'groomed';

interface UserGpsState {
  lng: number;
  lat: number;
  accuracyM: number | null;
  altitudeM: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  isSimulated: boolean;
}

interface Props {
  resort: ResortData;
  unit: UnitSystem;
  lang: Lang;
  selectedFeature: SelectedMapFeature | null;
  onSelectFeature: (feat: SelectedMapFeature | null) => void;
  focusNormKey: { type: 'trail' | 'lift'; normName: string; ts: number } | null;
}

export function ResortSkiMap({
  resort,
  unit,
  lang,
  selectedFeature,
  onSelectFeature,
  focusNormKey,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const gpsMarkerRef = useRef<Marker | null>(null);
  const gpsConeElRef = useRef<SVGSVGElement | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const simTimerRef = useRef<number | null>(null);
  const compassHeadingRef = useRef<number | null>(null);
  const followUserRef = useRef<boolean>(true);

  const [rawGeojson, setRawGeojson] = useState<any | null>(null);
  const [basemap, setBasemap] = useState<BasemapStyle>('winter');
  // Default to crisp 2D Alpine Relief (zero perspective parallax, 100% razor-sharp trail-to-lift alignment)
  // with 1-click 3D toggle at true 1:1 elevation scale!
  const [is3D, setIs3D] = useState<boolean>(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [diffFilter, setDiffFilter] = useState<Record<Difficulty, boolean>>({
    green: true,
    blue: true,
    black: true,
    'double-black': true,
  });
  const [mapReady, setMapReady] = useState(false);

  // Live On-Mountain GPS state
  const [gpsActive, setGpsActive] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsState, setGpsState] = useState<UserGpsState | null>(null);
  const [followUser, setFollowUser] = useState<boolean>(true);

  useEffect(() => {
    followUserRef.current = followUser;
  }, [followUser]);

  // Load OpenStreetMap GeoJSON for current resort
  useEffect(() => {
    let cancelled = false;
    fetch(resort.geojsonUrl)
      .then((r) => r.json())
      .then((fc) => {
        if (!cancelled) setRawGeojson(fc);
      })
      .catch(() => {
        if (!cancelled) setRawGeojson(null);
      });
    return () => {
      cancelled = true;
    };
  }, [resort.geojsonUrl]);

  // Enrich GeoJSON with LIVE open/closed/groomed status from resort telemetry
  const enrichedGeojson = useMemo(() => {
    if (!rawGeojson) return null;
    const features = (rawGeojson.features || []).map((f: any) => {
      const p = f.properties || {};
      if (p.featureType === 'lift' || p.featureType === 'lift-station') {
        const liveLift = matchLiftStatus(p, resort);
        return {
          ...f,
          properties: {
            ...p,
            liveStatus: liveLift?.status ?? 'closed',
            hours: liveLift?.hours ?? '9:00am - 4:00pm',
            zone: liveLift?.zone ?? resort.shortName,
            displayLabel:
              p.featureType === 'lift'
                ? `${p.name} ${liveLift?.status === 'open' ? '● OPEN' : ''}`.trim()
                : '',
          },
        };
      }

      const liveTrail = matchTrailStatus(p, resort);
      const difficulty: Difficulty = liveTrail?.difficulty || p.difficulty || 'blue';
      const liveStatus = liveTrail?.status ?? 'closed';
      const groomed = Boolean(liveTrail?.groomed);
      return {
        ...f,
        properties: {
          ...p,
          difficulty,
          liveStatus,
          groomed,
          zone: liveTrail?.zone ?? resort.shortName,
          displayLabel: p.isUnnamed ? '' : p.name,
        },
      };
    });

    return {
      type: 'FeatureCollection',
      features,
    };
  }, [rawGeojson, resort]);

  // Compute live nearest ski trail & nearest open lift whenever GPS updates
  const snappedInfo = useMemo(() => {
    if (!gpsState) return null;
    return snapPositionToMountain(gpsState.lng, gpsState.lat, resort, enrichedGeojson);
  }, [gpsState, resort, enrichedGeojson]);

  // Initialize MapLibre GL map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
          winter: {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© Esri, HERE, Garmin, OpenStreetMap contributors',
          },
          topo: {
            type: 'raster',
            tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 16,
            attribution: '© OpenTopoMap (CC-BY-SA)',
          },
          satellite: {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 18,
            attribution: '© Esri World Imagery',
          },
          'terrain-dem': {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 15,
          },
          'hillshade-dem': {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 15,
          },
          'ski-network': {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
        },
        layers: [
          {
            id: 'base-winter',
            type: 'raster',
            source: 'winter',
            layout: { visibility: 'visible' },
          },
          {
            id: 'base-topo',
            type: 'raster',
            source: 'topo',
            layout: { visibility: 'none' },
          },
          {
            id: 'base-satellite',
            type: 'raster',
            source: 'satellite',
            layout: { visibility: 'none' },
          },
          {
            id: 'alpine-hillshade',
            type: 'hillshade',
            source: 'hillshade-dem',
            paint: {
              'hillshade-exaggeration': 0.38,
              'hillshade-shadow-color': '#1e293b',
              'hillshade-highlight-color': '#ffffff',
            },
          },
          // Closed trails subtle casing
          {
            id: 'trails-closed-casing',
            type: 'line',
            source: 'ski-network',
            filter: ['all', ['==', ['get', 'featureType'], 'trail'], ['==', ['get', 'liveStatus'], 'closed']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#ffffff',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.0, 15, 4.8],
              'line-opacity': 0.45,
            },
          },
          // Closed trails (dashed difficulty color)
          {
            id: 'trails-closed',
            type: 'line',
            source: 'ski-network',
            filter: ['all', ['==', ['get', 'featureType'], 'trail'], ['==', ['get', 'liveStatus'], 'closed']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': [
                'match',
                ['get', 'difficulty'],
                'green',
                '#16a34a',
                'blue',
                '#2563eb',
                'double-black',
                '#dc2626',
                '#1e293b',
              ],
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.8, 15, 3.0],
              'line-dasharray': [2, 2],
              'line-opacity': 0.62,
            },
          },
          // Open trails white snow halo casing
          {
            id: 'trails-open-casing',
            type: 'line',
            source: 'ski-network',
            filter: ['all', ['==', ['get', 'featureType'], 'trail'], ['==', ['get', 'liveStatus'], 'open']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#ffffff',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5.8, 15, 9.5],
              'line-opacity': 0.94,
            },
          },
          // Open trails vivid difficulty line
          {
            id: 'trails-open',
            type: 'line',
            source: 'ski-network',
            filter: ['all', ['==', ['get', 'featureType'], 'trail'], ['==', ['get', 'liveStatus'], 'open']],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': [
                'match',
                ['get', 'difficulty'],
                'green',
                '#16a34a',
                'blue',
                '#2563eb',
                'double-black',
                '#dc2626',
                '#0f172a',
              ],
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.4, 15, 5.8],
              'line-opacity': 1,
            },
          },
          // Groomed centerline indicator on open groomed trails
          {
            id: 'trails-groomed-stripe',
            type: 'line',
            source: 'ski-network',
            filter: [
              'all',
              ['==', ['get', 'featureType'], 'trail'],
              ['==', ['get', 'liveStatus'], 'open'],
              ['==', ['get', 'groomed'], true],
            ],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#bae6fd',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 1.8],
              'line-dasharray': [1.5, 2],
            },
          },
          // Closed lifts
          {
            id: 'lifts-closed',
            type: 'line',
            source: 'ski-network',
            filter: ['all', ['==', ['get', 'featureType'], 'lift'], ['==', ['get', 'liveStatus'], 'closed']],
            layout: { 'line-cap': 'round' },
            paint: {
              'line-color': '#475569',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.0, 15, 3.2],
              'line-dasharray': [3, 2],
              'line-opacity': 0.65,
            },
          },
          // Open lifts white casing
          {
            id: 'lifts-open-casing',
            type: 'line',
            source: 'ski-network',
            filter: ['all', ['==', ['get', 'featureType'], 'lift'], ['==', ['get', 'liveStatus'], 'open']],
            layout: { 'line-cap': 'round' },
            paint: {
              'line-color': '#ffffff',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6.2, 15, 10],
              'line-opacity': 0.96,
            },
          },
          // Open lifts vivid vermilion cable
          {
            id: 'lifts-open',
            type: 'line',
            source: 'ski-network',
            filter: ['all', ['==', ['get', 'featureType'], 'lift'], ['==', ['get', 'liveStatus'], 'open']],
            layout: { 'line-cap': 'round' },
            paint: {
              'line-color': '#ea580c',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.6, 15, 5.8],
            },
          },
          // Lift Base & Summit Station Bullwheel Terminals (anchors lifts cleanly to trailheads!)
          {
            id: 'lift-stations-closed',
            type: 'circle',
            source: 'ski-network',
            minzoom: 12.5,
            filter: [
              'all',
              ['==', ['get', 'featureType'], 'lift-station'],
              ['==', ['get', 'liveStatus'], 'closed'],
            ],
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.5, 2.6, 15, 4.4],
              'circle-color': '#ffffff',
              'circle-stroke-color': '#475569',
              'circle-stroke-width': 1.6,
            },
          },
          {
            id: 'lift-stations-open',
            type: 'circle',
            source: 'ski-network',
            minzoom: 12,
            filter: [
              'all',
              ['==', ['get', 'featureType'], 'lift-station'],
              ['==', ['get', 'liveStatus'], 'open'],
            ],
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 3.6, 15, 6.0],
              'circle-color': [
                'case',
                ['==', ['get', 'stationRole'], 'base'],
                '#ea580c',
                '#ffffff',
              ],
              'circle-stroke-color': '#ea580c',
              'circle-stroke-width': 2.4,
            },
          },
          // Selected feature highlight halo
          {
            id: 'selected-highlight',
            type: 'line',
            source: 'ski-network',
            filter: ['==', ['get', 'normName'], '__none__'],
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#f59e0b',
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 7, 15, 11],
              'line-opacity': 0.85,
            },
          },
          // Trail & Lift labels
          {
            id: 'trail-labels',
            type: 'symbol',
            source: 'ski-network',
            minzoom: 13.4,
            filter: ['all', ['==', ['get', 'featureType'], 'trail'], ['!=', ['get', 'displayLabel'], '']],
            layout: {
              'symbol-placement': 'line',
              'text-field': ['get', 'displayLabel'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 11,
              'text-max-angle': 35,
            },
            paint: {
              'text-color': '#0f172a',
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.8,
            },
          },
          {
            id: 'lift-labels',
            type: 'symbol',
            source: 'ski-network',
            minzoom: 12.2,
            filter: ['==', ['get', 'featureType'], 'lift'],
            layout: {
              'symbol-placement': 'line',
              'text-field': ['get', 'displayLabel'],
              'text-font': ['Noto Sans Regular'],
              'text-size': 12,
            },
            paint: {
              'text-color': [
                'case',
                ['==', ['get', 'liveStatus'], 'open'],
                '#9a3412',
                '#334155',
              ],
              'text-halo-color': '#ffffff',
              'text-halo-width': 2.2,
            },
          },
        ],
      },
      center: resort.mapViewport.center,
      zoom: resort.mapViewport.zoom,
      pitch: 0,
      bearing: 0,
      maxPitch: 70,
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');

    const hoverPopup = new Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
    });
    popupRef.current = hoverPopup;

    const interactiveLayers = ['lifts-open', 'lifts-closed', 'trails-open', 'trails-closed'];

    const markReady = () => setMapReady(true);
    map.on('style.load', markReady);
    map.on('load', markReady);
    if (map.isStyleLoaded()) {
      markReady();
    }

    // Disengage auto-follow when user manually drags the map
    map.on('dragstart', () => {
      if (followUserRef.current) {
        setFollowUser(false);
      }
    });

    map.on('mousemove', (e: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
      if (!hits.length) {
        map.getCanvas().style.cursor = '';
        hoverPopup.remove();
        return;
      }
      map.getCanvas().style.cursor = 'pointer';
      const top = hits[0];
      const p = top.properties || {};
      const statusBadge =
        p.liveStatus === 'open'
          ? '<span style="color:#16a34a;font-weight:700;">● OPEN</span>'
          : '<span style="color:#64748b;font-weight:600;">CLOSED</span>';
      const groomTxt = p.groomed ? ' · <span style="color:#0284c7;font-weight:700;">已压雪</span>' : '';
      hoverPopup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div style="font-family:var(--font-sans);font-size:12px;color:#0f172a;padding:2px 4px;">
            <strong>${p.name}</strong><br/>
            ${statusBadge}${groomTxt}
          </div>`
        )
        .addTo(map);
    });

    map.on('click', (e: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: interactiveLayers });
      if (!hits.length) return;
      const p = hits[0].properties || {};
      onSelectFeature({
        featureType: p.featureType,
        name: p.name,
        normName: p.normName,
        status: p.liveStatus,
        difficulty: p.difficulty,
        groomed: Boolean(p.groomed),
        gladed: Boolean(p.gladed),
        liftType: p.liftType,
        hours: p.hours,
        zone: p.zone,
        lengthMeters: Number(p.lengthMeters || 0),
        coordinates: [e.lngLat.lng, e.lngLat.lat],
      });
    });

    mapRef.current = map;

    return () => {
      hoverPopup.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop any GPS watch / simulation cleanly on unmount
  const stopAllGps = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    if (gpsMarkerRef.current) {
      gpsMarkerRef.current.remove();
      gpsMarkerRef.current = null;
      gpsConeElRef.current = null;
    }
    setGpsActive(false);
    setGpsLoading(false);
    setGpsState(null);
    setGpsError(null);
  }, []);

  useEffect(() => {
    return () => {
      stopAllGps();
    };
  }, [stopAllGps]);

  // Listen for phone compass orientation while GPS is active
  useEffect(() => {
    if (!gpsActive) return;
    const onOrientation = (ev: DeviceOrientationEvent) => {
      const webkitHdg = (ev as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      let hdg: number | null = null;
      if (typeof webkitHdg === 'number' && !Number.isNaN(webkitHdg)) {
        hdg = webkitHdg;
      } else if (typeof ev.alpha === 'number' && !Number.isNaN(ev.alpha)) {
        hdg = (360 - ev.alpha) % 360;
      }
      if (hdg !== null) {
        compassHeadingRef.current = hdg;
        const mapBearing = mapRef.current?.getBearing() ?? 0;
        if (gpsConeElRef.current) {
          gpsConeElRef.current.style.transform = `rotate(${hdg - mapBearing}deg)`;
        }
      }
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation, true);
    };
  }, [gpsActive]);

  // Create or update Skier GPS Marker on the MapLibre canvas
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !gpsState) return;

    if (!gpsMarkerRef.current) {
      const root = document.createElement('div');
      root.className = 'skier-gps-marker';
      root.innerHTML = `
        <div class="skier-gps-pulse"></div>
        <svg class="skier-gps-cone" viewBox="0 0 64 64" fill="none">
          <defs>
            <radialGradient id="hdgGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#0284c7" stop-opacity="0.55"/>
              <stop offset="100%" stop-color="#0284c7" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <path d="M32 32 L14 6 A30 30 0 0 1 50 6 Z" fill="url(#hdgGrad)"/>
        </svg>
        <div class="skier-gps-dot"></div>
      `;
      gpsConeElRef.current = root.querySelector('svg');
      gpsMarkerRef.current = new Marker({ element: root, anchor: 'center' })
        .setLngLat([gpsState.lng, gpsState.lat])
        .addTo(map);
    } else {
      gpsMarkerRef.current.setLngLat([gpsState.lng, gpsState.lat]);
    }

    const effectiveHeading = gpsState.headingDeg ?? compassHeadingRef.current;
    if (gpsConeElRef.current) {
      if (effectiveHeading !== null && effectiveHeading !== undefined) {
        const mapBearing = map.getBearing();
        gpsConeElRef.current.style.opacity = '1';
        gpsConeElRef.current.style.transform = `rotate(${effectiveHeading - mapBearing}deg)`;
      } else {
        gpsConeElRef.current.style.opacity = '0';
      }
    }

    // Auto-follow camera ONLY if user is on the resort (or in simulated run) and followUser is enabled
    const distM = Math.hypot(
      (gpsState.lng - resort.coordinates[0]) * 70000,
      (gpsState.lat - resort.coordinates[1]) * 111000
    );
    if (followUser && (gpsState.isSimulated || distM < 15000)) {
      map.easeTo({
        center: [gpsState.lng, gpsState.lat],
        zoom: Math.max(map.getZoom(), 14.8),
        duration: 550,
      });
    }
  }, [gpsState, followUser, resort.coordinates]);

  const startRealGps = () => {
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    if (!navigator.geolocation) {
      setGpsError(lang === 'zh' ? '当前浏览器不支持 GPS 定位' : 'Geolocation not supported');
      setGpsActive(true);
      return;
    }

    // Request iOS compass permission if available (must happen inside user click gesture)
    const DevOrient = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DevOrient?.requestPermission === 'function') {
      DevOrient.requestPermission().catch(() => {});
    }

    setGpsActive(true);
    setGpsLoading(true);
    setGpsError(null);
    setFollowUser(true);

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setGpsLoading(false);
        setGpsError(null);
        const { longitude, latitude, accuracy, altitude, speed, heading } = pos.coords;
        setGpsState({
          lng: longitude,
          lat: latitude,
          accuracyM: typeof accuracy === 'number' ? Math.round(accuracy) : null,
          altitudeM: typeof altitude === 'number' ? Math.round(altitude) : null,
          speedKmh: typeof speed === 'number' && speed >= 0 ? Math.round(speed * 3.6) : null,
          headingDeg:
            typeof heading === 'number' && !Number.isNaN(heading) && heading >= 0
              ? Math.round(heading)
              : compassHeadingRef.current,
          isSimulated: false,
        });
      },
      (err) => {
        setGpsLoading(false);
        setGpsError(
          err.code === 1
            ? lang === 'zh'
              ? '未授予位置权限（可点击下方体验雪道模拟滑行）'
              : 'Location permission denied (try Demo Run below)'
            : lang === 'zh'
              ? '暂无法获取卫星定位信号（可体验雪道模拟滑行）'
              : 'GPS signal unavailable (try Demo Run below)'
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1500,
        timeout: 12000,
      }
    );
  };

  const startSimulatedSkiRun = () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current);
    }

    const waypoints = buildSimulatedRun(resort, enrichedGeojson);
    if (!waypoints.length) return;

    setGpsActive(true);
    setGpsLoading(false);
    setGpsError(null);
    setFollowUser(true);

    let idx = 0;
    const pushStep = (i: number) => {
      const wp = waypoints[i % waypoints.length];
      setGpsState({
        lng: wp.lng,
        lat: wp.lat,
        accuracyM: 5,
        altitudeM: wp.altitudeM,
        speedKmh: wp.speedKmh,
        headingDeg: wp.headingDeg,
        isSimulated: true,
      });
    };

    pushStep(0);
    simTimerRef.current = window.setInterval(() => {
      idx = (idx + 1) % waypoints.length;
      pushStep(idx);
    }, 900);
  };

  const toggleGpsButton = () => {
    if (gpsActive) {
      stopAllGps();
    } else {
      startRealGps();
    }
  };

  // Fly camera smoothly when switching resorts
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (simTimerRef.current !== null) {
      stopAllGps();
    }
    map.flyTo({
      center: resort.mapViewport.center,
      zoom: resort.mapViewport.zoom,
      pitch: is3D ? 45 : 0,
      bearing: is3D ? resort.mapViewport.bearing : 0,
      duration: 1000,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resort.id]);

  // Push enriched GeoJSON + active filters into MapLibre
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !enrichedGeojson) return;

    const activeDiffs = (Object.keys(diffFilter) as Difficulty[]).filter((d) => diffFilter[d]);

    const filteredFeatures = enrichedGeojson.features.filter((f: any) => {
      const p = f.properties;
      if (p.featureType === 'lift' || p.featureType === 'lift-station') {
        if (statusFilter === 'open') return p.liveStatus === 'open';
        return true;
      }
      if (!activeDiffs.includes(p.difficulty)) return false;
      if (statusFilter === 'open') return p.liveStatus === 'open';
      if (statusFilter === 'groomed') return p.liveStatus === 'open' && p.groomed;
      return true;
    });

    const src = map.getSource('ski-network') as GeoJSONSource | undefined;
    if (src) {
      src.setData({
        type: 'FeatureCollection',
        features: filteredFeatures,
      });
    }
  }, [enrichedGeojson, mapReady, statusFilter, diffFilter]);

  // Highlight selected trail / lift
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (selectedFeature?.normName) {
      map.setFilter('selected-highlight', [
        'all',
        ['==', ['get', 'featureType'], selectedFeature.featureType],
        ['==', ['get', 'normName'], selectedFeature.normName],
      ]);
    } else {
      map.setFilter('selected-highlight', ['==', ['get', 'normName'], '__none__']);
    }
  }, [selectedFeature, mapReady]);

  // Fly to trail or lift when clicked in sidebar directory
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focusNormKey || !enrichedGeojson) return;

    const matches = enrichedGeojson.features.filter((f: any) => {
      const p = f.properties;
      if (p.featureType !== focusNormKey.type) return false;
      if (!p.normName || !focusNormKey.normName) return false;
      return p.normName === focusNormKey.normName;
    });

    if (matches.length > 0) {
      const bounds = new LngLatBounds();
      let totalLength = 0;
      for (const m of matches) {
        totalLength += Number(m.properties?.lengthMeters || 0);
        for (const coord of m.geometry.coordinates) {
          bounds.extend(coord as [number, number]);
        }
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: 110,
          maxZoom: 15.6,
          pitch: is3D ? 45 : 0,
          duration: 900,
        });
      }
      const p0 = matches[0].properties;
      onSelectFeature({
        featureType: p0.featureType,
        name: p0.name,
        normName: p0.normName,
        status: p0.liveStatus,
        difficulty: p0.difficulty,
        groomed: Boolean(p0.groomed),
        gladed: Boolean(p0.gladed),
        liftType: p0.liftType,
        hours: p0.hours,
        zone: p0.zone,
        lengthMeters: totalLength || p0.lengthMeters,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNormKey]);

  // Basemap switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setLayoutProperty('base-winter', 'visibility', basemap === 'winter' ? 'visible' : 'none');
    map.setLayoutProperty('base-topo', 'visibility', basemap === 'topo' ? 'visible' : 'none');
    map.setLayoutProperty('base-satellite', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
    map.setLayoutProperty('alpine-hillshade', 'visibility', basemap === 'topo' ? 'none' : 'visible');
  }, [basemap, mapReady]);

  // True 1:1 3D Terrain toggle (exaggeration: 1.0 eliminates vertical parallax distortion)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (is3D) {
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.0 });
      map.easeTo({ pitch: 45, bearing: resort.mapViewport.bearing, duration: 650 });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, bearing: 0, duration: 650 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is3D, mapReady]);

  const toggleDiff = (d: Difficulty) => {
    setDiffFilter((prev) => ({ ...prev, [d]: !prev[d] }));
  };

  const resetCamera = () => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: resort.mapViewport.center,
      zoom: resort.mapViewport.zoom,
      pitch: is3D ? 45 : 0,
      bearing: is3D ? resort.mapViewport.bearing : 0,
      duration: 800,
    });
  };

  return (
    <div className="map-stage">
      {/* Top Floating Map Controls HUD */}
      <div className="map-hud-top">
        <div className="map-hud-group" role="group" aria-label="Trail status filter">
          <button
            id="map-gps-btn"
            type="button"
            className={`hud-btn ${gpsActive ? 'is-gps-active' : ''}`}
            onClick={toggleGpsButton}
            title={lang === 'zh' ? '开启/关闭滑雪中实时 GPS 定位与雪道识别' : 'Toggle live on-mountain ski GPS'}
          >
            <LocateFixed size={14} />
            <span>{lang === 'zh' ? (gpsActive ? '定位中' : '雪上定位') : gpsActive ? 'GPS On' : 'Ski GPS'}</span>
          </button>

          <button
            id="map-filter-all"
            type="button"
            className={`hud-btn ${statusFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            {lang === 'zh' ? '全部雪道' : 'All'}
          </button>
          <button
            id="map-filter-open"
            type="button"
            className={`hud-btn ${statusFilter === 'open' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('open')}
          >
            <span style={{ color: statusFilter === 'open' ? '#4ade80' : '#16a34a' }}>●</span>
            {lang === 'zh' ? `仅看开放 (${resort.terrain.runsOpen})` : `Open (${resort.terrain.runsOpen})`}
          </button>
          <button
            id="map-filter-groomed"
            type="button"
            className={`hud-btn ${statusFilter === 'groomed' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('groomed')}
          >
            <Sparkles size={13} />
            {lang === 'zh' ? `压雪 (${resort.terrain.groomedCount})` : `Groomed (${resort.terrain.groomedCount})`}
          </button>
        </div>

        <div className="map-hud-group" role="group" aria-label="Difficulty filter">
          {(['green', 'blue', 'black', 'double-black'] as Difficulty[]).map((d) => (
            <button
              key={d}
              id={`map-diff-${d}`}
              type="button"
              className={`hud-btn ${diffFilter[d] ? 'is-active' : ''}`}
              onClick={() => toggleDiff(d)}
              style={{ opacity: diffFilter[d] ? 1 : 0.45 }}
            >
              <DifficultyIcon difficulty={d} />
              <span>
                {d === 'green'
                  ? lang === 'zh'
                    ? '绿'
                    : 'Green'
                  : d === 'blue'
                    ? lang === 'zh'
                      ? '蓝'
                      : 'Blue'
                    : d === 'black'
                      ? lang === 'zh'
                        ? '黑'
                        : 'Black'
                      : lang === 'zh'
                        ? '双黑'
                        : '2xBlk'}
              </span>
            </button>
          ))}
        </div>

        <div className="map-hud-group" role="group" aria-label="Basemap and 3D controls">
          <Layers size={14} style={{ marginLeft: 4, color: 'var(--ink-muted)' }} />
          <button
            id="basemap-winter"
            type="button"
            className={`hud-btn ${basemap === 'winter' ? 'is-active' : ''}`}
            onClick={() => setBasemap('winter')}
          >
            {lang === 'zh' ? '雪山图' : 'Winter'}
          </button>
          <button
            id="basemap-topo"
            type="button"
            className={`hud-btn ${basemap === 'topo' ? 'is-active' : ''}`}
            onClick={() => setBasemap('topo')}
          >
            {lang === 'zh' ? '等高线' : 'Topo'}
          </button>
          <button
            id="basemap-satellite"
            type="button"
            className={`hud-btn ${basemap === 'satellite' ? 'is-active' : ''}`}
            onClick={() => setBasemap('satellite')}
          >
            {lang === 'zh' ? '卫星' : 'Satellite'}
          </button>
          <button
            id="toggle-3d-btn"
            type="button"
            className={`hud-btn ${is3D ? 'is-active' : ''}`}
            onClick={() => setIs3D((v) => !v)}
          >
            <Box size={13} />
            <span>{is3D ? '3D' : '2D'}</span>
          </button>
          <button
            id="reset-camera-btn"
            type="button"
            className="hud-btn"
            onClick={resetCamera}
            title={lang === 'zh' ? '重置雪山视角' : 'Reset Mountain Camera'}
          >
            <Compass size={14} />
          </button>
        </div>
      </div>

      <div ref={containerRef} className="map-canvas" id="resort-live-ski-map" />

      <div className="map-bottom-left-stack">
        {/* Live On-Mountain GPS Telemetry HUD Card */}
        {gpsActive && (
          <div className="gps-hud-card" role="status" aria-live="polite">
            <div className="gps-hud-card__header">
              <span className="gps-live-pill">
                <Navigation size={13} />
                {gpsLoading
                  ? lang === 'zh'
                    ? '正在搜寻卫星定位...'
                    : 'Acquiring GPS...'
                  : gpsState?.isSimulated
                    ? lang === 'zh'
                      ? '● 雪道滑行模拟演示中'
                      : '● Simulated Ski Run'
                    : lang === 'zh'
                      ? '● 雪上实时 GPS 追踪'
                      : '● Live Ski GPS Active'}
              </span>
              <button
                type="button"
                className="icon-btn"
                style={{ height: 24, padding: '0 6px' }}
                onClick={stopAllGps}
                title={lang === 'zh' ? '关闭定位省电' : 'Stop GPS'}
              >
                <X size={13} />
              </button>
            </div>

            {gpsError && (
              <div style={{ fontSize: '0.76rem', color: 'var(--ink-secondary)' }}>{gpsError}</div>
            )}

            {gpsState && snappedInfo && (
              <>
                <div className="gps-hud-card__trail-box">
                  {snappedInfo.onResort ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', fontWeight: 700 }}>
                          {lang === 'zh' ? '当前识别雪道' : 'Current Trail'}
                        </span>
                        {snappedInfo.nearestTrail && (
                          <span
                            className={`row-status ${
                              snappedInfo.nearestTrail.status === 'open' ? 'is-open' : 'is-closed'
                            }`}
                          >
                            {snappedInfo.nearestTrail.status === 'open'
                              ? lang === 'zh'
                                ? '开放'
                                : 'OPEN'
                              : lang === 'zh'
                                ? '未开'
                                : 'CLOSED'}
                          </span>
                        )}
                      </div>

                      {snappedInfo.nearestTrail ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: '0.92rem' }}>
                          <DifficultyIcon difficulty={snappedInfo.nearestTrail.difficulty} />
                          <span>{snappedInfo.nearestTrail.name}</span>
                          <span className="tabular" style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', fontWeight: 600 }}>
                            ({snappedInfo.nearestTrail.distanceM < 15
                              ? lang === 'zh'
                                ? '雪道上'
                                : 'on run'
                              : `${snappedInfo.nearestTrail.distanceM}m`})
                          </span>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                          {lang === 'zh' ? '位于雪场区域内（非标记雪道）' : 'Within resort boundary'}
                        </div>
                      )}

                      {snappedInfo.nearestOpenLift && (
                        <div style={{ fontSize: '0.73rem', color: 'var(--ink-secondary)' }}>
                          {lang === 'zh' ? '最近运行缆车：' : 'Nearest open lift: '}
                          <strong>{snappedInfo.nearestOpenLift.name}</strong>{' '}
                          <span className="tabular">
                            ({formatLength(snappedInfo.nearestOpenLift.distanceM, unit)})
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: '0.78rem', color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
                      {lang === 'zh'
                        ? `已获取你的实时 GPS（距 ${resort.nameZh} 约 ${snappedInfo.distanceToResortKm.toLocaleString()} km）。到雪场后将自动锁定所在雪道与最近缆车。`
                        : `GPS locked (${snappedInfo.distanceToResortKm.toLocaleString()} km from ${resort.shortName}). Auto-snaps to trails when on mountain.`}
                    </div>
                  )}
                </div>

                <div className="gps-hud-stats">
                  <div className="gps-hud-stat">
                    <span className="gps-hud-stat__lbl">{lang === 'zh' ? '实时海拔' : 'Altitude'}</span>
                    <span className="gps-hud-stat__val">
                      {gpsState.altitudeM !== null ? formatElev(gpsState.altitudeM, unit) : '—'}
                    </span>
                  </div>
                  <div className="gps-hud-stat">
                    <span className="gps-hud-stat__lbl">{lang === 'zh' ? '滑行时速' : 'Speed'}</span>
                    <span className="gps-hud-stat__val">
                      {gpsState.speedKmh !== null ? formatWind(gpsState.speedKmh, unit) : '0 km/h'}
                    </span>
                  </div>
                  <div className="gps-hud-stat">
                    <span className="gps-hud-stat__lbl">{lang === 'zh' ? 'GPS 精度' : 'Accuracy'}</span>
                    <span className="gps-hud-stat__val">
                      {gpsState.accuracyM !== null ? `±${gpsState.accuracyM}m` : '—'}
                    </span>
                  </div>
                </div>
              </>
            )}

            <div className="gps-hud-actions">
              {gpsState && (snappedInfo?.onResort || gpsState.isSimulated) && (
                <button
                  type="button"
                  className="icon-btn"
                  style={{ height: 28, fontSize: '0.73rem' }}
                  onClick={() => {
                    setFollowUser(true);
                    mapRef.current?.flyTo({
                      center: [gpsState.lng, gpsState.lat],
                      zoom: 15.2,
                      duration: 600,
                    });
                  }}
                >
                  <LocateFixed size={12} />
                  <span>{followUser ? (lang === 'zh' ? '视角跟随中' : 'Following') : lang === 'zh' ? '回到我的位置' : 'Re-center'}</span>
                </button>
              )}

              {gpsState && !snappedInfo?.onResort && !gpsState.isSimulated && (
                <button
                  type="button"
                  className="icon-btn"
                  style={{ height: 28, fontSize: '0.73rem' }}
                  onClick={() => {
                    mapRef.current?.flyTo({
                      center: [gpsState.lng, gpsState.lat],
                      zoom: 14,
                      duration: 900,
                    });
                  }}
                >
                  <span>{lang === 'zh' ? '查看我的当前城市位置' : 'Pan to My Location'}</span>
                </button>
              )}

              {(!snappedInfo?.onResort || gpsError || gpsState?.isSimulated) && (
                <button
                  id="gps-demo-run-btn"
                  type="button"
                  className="icon-btn"
                  style={{
                    height: 28,
                    fontSize: '0.73rem',
                    borderColor: 'var(--accent-alpine)',
                    color: 'var(--accent-alpine)',
                  }}
                  onClick={gpsState?.isSimulated ? startRealGps : startSimulatedSkiRun}
                >
                  <Play size={12} />
                  <span>
                    {gpsState?.isSimulated
                      ? lang === 'zh'
                        ? '切回真实 GPS'
                        : 'Use Real GPS'
                      : lang === 'zh'
                        ? '模拟雪道滑行定位'
                        : 'Demo Ski Run'}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Selected Trail / Lift Telemetry Card */}
        {selectedFeature && (
          <div className="map-feature-card" role="dialog" aria-label="Selected feature details">
            <div className="map-feature-card__top">
              <h3 className="map-feature-card__title">
                {selectedFeature.featureType === 'trail' && selectedFeature.difficulty && (
                  <DifficultyIcon difficulty={selectedFeature.difficulty} />
                )}
                <span>{selectedFeature.name}</span>
              </h3>
              <button
                type="button"
                className="icon-btn"
                style={{ height: 26, padding: '0 6px' }}
                onClick={() => onSelectFeature(null)}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span className={`row-status ${selectedFeature.status === 'open' ? 'is-open' : 'is-closed'}`}>
                {selectedFeature.status === 'open'
                  ? lang === 'zh'
                    ? '● 实时开放 OPEN'
                    : '● OPEN'
                  : lang === 'zh'
                    ? '暂未开放 CLOSED'
                    : 'CLOSED'}
              </span>
              {selectedFeature.groomed && (
                <span className="groomed-chip">
                  {lang === 'zh' ? '今日已压雪 Groomed' : 'Groomed Today'}
                </span>
              )}
              {selectedFeature.featureType === 'trail' && selectedFeature.difficulty && (
                <span className="row-status is-closed">
                  {difficultyLabel(selectedFeature.difficulty, lang)}
                </span>
              )}
              {selectedFeature.featureType === 'lift' && selectedFeature.liftType && (
                <span className="row-status is-closed">
                  {liftTypeLabel(selectedFeature.liftType, lang)}
                </span>
              )}
            </div>

            <div className="map-feature-card__meta">
              {selectedFeature.zone && (
                <span>
                  {lang === 'zh' ? '区域：' : 'Zone: '}
                  <strong>{selectedFeature.zone}</strong>
                </span>
              )}
              {selectedFeature.lengthMeters ? (
                <span>
                  {lang === 'zh' ? '实测长度：' : 'Length: '}
                  <strong className="tabular">{formatLength(selectedFeature.lengthMeters, unit)}</strong>
                </span>
              ) : null}
              {selectedFeature.featureType === 'lift' && selectedFeature.hours && (
                <span>
                  {lang === 'zh' ? '运营时间：' : 'Hours: '}
                  <strong className="tabular">{selectedFeature.hours}</strong>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Map Symbology Legend */}
      <div className="map-legend" aria-label="Map Legend">
        <span className="legend-item">
          <span className="legend-line is-lift-open" />
          {lang === 'zh' ? '运行中缆车' : 'Open Lift'}
        </span>
        <span className="legend-item">
          <DifficultyIcon difficulty="green" />
          {lang === 'zh' ? '绿道' : 'Easy'}
        </span>
        <span className="legend-item">
          <DifficultyIcon difficulty="blue" />
          {lang === 'zh' ? '蓝道' : 'Interm.'}
        </span>
        <span className="legend-item">
          <DifficultyIcon difficulty="black" />
          {lang === 'zh' ? '黑道' : 'Adv.'}
        </span>
        <span className="legend-item">
          <DifficultyIcon difficulty="double-black" />
          {lang === 'zh' ? '双黑' : 'Expert'}
        </span>
        <span className="legend-item">
          <span className="legend-line is-closed-dash" />
          {lang === 'zh' ? '未开放(虚线)' : 'Closed'}
        </span>
      </div>
    </div>
  );
}
