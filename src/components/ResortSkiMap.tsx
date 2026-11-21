import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  type MapMouseEvent,
} from 'maplibre-gl';
import { Box, Compass, Layers, Sparkles, X } from 'lucide-react';
import type {
  Difficulty,
  Lang,
  ResortData,
  SelectedMapFeature,
  UnitSystem,
} from '../types';
import {
  difficultyLabel,
  formatLength,
  liftTypeLabel,
  matchLiftStatus,
  matchTrailStatus,
} from '../utils/format';
import { DifficultyIcon } from './DifficultyIcon';

type BasemapStyle = 'winter' | 'topo' | 'satellite';
type StatusFilter = 'all' | 'open' | 'groomed';

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

  const [rawGeojson, setRawGeojson] = useState<any | null>(null);
  const [basemap, setBasemap] = useState<BasemapStyle>('winter');
  const [is3D, setIs3D] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [diffFilter, setDiffFilter] = useState<Record<Difficulty, boolean>>({
    green: true,
    blue: true,
    black: true,
    'double-black': true,
  });
  const [mapReady, setMapReady] = useState(false);

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
      if (p.featureType === 'lift') {
        const liveLift = matchLiftStatus(p, resort);
        return {
          ...f,
          properties: {
            ...p,
            liveStatus: liveLift?.status ?? 'closed',
            hours: liveLift?.hours ?? '9:00am - 4:00pm',
            zone: liveLift?.zone ?? resort.shortName,
            displayLabel: `${p.name} ${liveLift?.status === 'open' ? '● OPEN' : ''}`.trim(),
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
          terrarium: {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 14,
          },
          'ski-network': {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
        },
        terrain: {
          source: 'terrarium',
          exaggeration: 1.22,
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
            source: 'terrarium',
            paint: {
              'hillshade-exaggeration': 0.5,
              'hillshade-shadow-color': '#1e293b',
              'hillshade-highlight-color': '#ffffff',
            },
          },
          // Closed trails (subtle dashed)
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
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.4, 15, 2.5],
              'line-dasharray': [2, 2.2],
              'line-opacity': 0.36,
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
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5.5, 15, 9],
              'line-opacity': 0.92,
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
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.2, 15, 5.6],
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
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.8, 15, 3],
              'line-dasharray': [3, 2],
              'line-opacity': 0.55,
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
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 15, 9.5],
              'line-opacity': 0.95,
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
              'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3.5, 15, 5.5],
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
      pitch: resort.mapViewport.pitch,
      bearing: resort.mapViewport.bearing,
      maxPitch: 72,
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

    map.on('load', () => {
      setMapReady(true);
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

  // Fly camera smoothly when switching resorts
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: resort.mapViewport.center,
      zoom: resort.mapViewport.zoom,
      pitch: is3D ? resort.mapViewport.pitch : 0,
      bearing: is3D ? resort.mapViewport.bearing : 0,
      duration: 1100,
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
      if (p.featureType === 'lift') {
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
      return (
        p.normName === focusNormKey.normName ||
        p.normName.includes(focusNormKey.normName) ||
        focusNormKey.normName.includes(p.normName)
      );
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
          pitch: is3D ? 50 : 0,
          duration: 950,
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

  // 3D Terrain toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (is3D) {
      map.setTerrain({ source: 'terrarium', exaggeration: 1.22 });
      map.easeTo({ pitch: resort.mapViewport.pitch, bearing: resort.mapViewport.bearing, duration: 650 });
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
      pitch: is3D ? resort.mapViewport.pitch : 0,
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
            id="map-filter-all"
            type="button"
            className={`hud-btn ${statusFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            {lang === 'zh' ? '全部雪道' : 'All Trails'}
          </button>
          <button
            id="map-filter-open"
            type="button"
            className={`hud-btn ${statusFilter === 'open' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('open')}
          >
            <span style={{ color: statusFilter === 'open' ? '#4ade80' : '#16a34a' }}>●</span>
            {lang === 'zh' ? `仅看开放 (${resort.terrain.runsOpen})` : `Open Only (${resort.terrain.runsOpen})`}
          </button>
          <button
            id="map-filter-groomed"
            type="button"
            className={`hud-btn ${statusFilter === 'groomed' ? 'is-active' : ''}`}
            onClick={() => setStatusFilter('groomed')}
          >
            <Sparkles size={13} />
            {lang === 'zh' ? `压雪道 (${resort.terrain.groomedCount})` : `Groomed (${resort.terrain.groomedCount})`}
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
