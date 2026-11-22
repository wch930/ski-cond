import { useEffect, useRef } from 'react';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl';
import type { Lang, RegionInfo, ResortData, UnitSystem } from '../types';
import { formatSnow } from '../utils/format';

interface Props {
  region?: RegionInfo;
  resorts: ResortData[];
  unit: UnitSystem;
  lang: Lang;
  onSelectResort: (resortId: string) => void;
}

export function BanffRegionalMap({ region, resorts, unit, lang, onSelectResort }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hubMarkerRef = useRef<Marker | null>(null);
  const markersRef = useRef<Marker[]>([]);

  const isToronto = region?.id === 'toronto';

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
          voyager: {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© Esri, HERE, Garmin, OpenStreetMap contributors',
          },
          terrarium: {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 14,
          },
        },
        layers: [
          {
            id: 'voyager-base',
            type: 'raster',
            source: 'voyager',
          },
          {
            id: 'rockies-hillshade',
            type: 'hillshade',
            source: 'terrarium',
            paint: {
              'hillshade-exaggeration': 0.42,
              'hillshade-shadow-color': '#334155',
              'hillshade-highlight-color': '#ffffff',
            },
          },
        ],
      },
      center: region?.center ?? [-115.86, 51.25],
      zoom: region?.zoom ?? 9.15,
      pitch: isToronto ? 12 : 28,
      bearing: isToronto ? 0 : -8,
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Frame active region resorts + hub city pin cleanly with padding so no callout clips
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const hubCoords =
      region?.hubCoordinates ?? (isToronto ? [-79.3832, 43.6532] : [-115.5708, 51.1784]);
    const hubLabel =
      region?.hubLabel ?? (isToronto ? '📍 Toronto 多伦多' : '📍 Banff Town 班夫镇');

    if (resorts.length > 0) {
      const bounds = new LngLatBounds();
      bounds.extend(hubCoords);
      for (const r of resorts) {
        bounds.extend(r.coordinates);
      }
      map.fitBounds(bounds, {
        padding: { top: 82, bottom: 52, left: 90, right: 90 },
        pitch: isToronto ? 12 : 28,
        bearing: isToronto ? 0 : -8,
        maxZoom: 9.6,
        duration: 0,
      });
    }

    if (hubMarkerRef.current) {
      hubMarkerRef.current.remove();
      hubMarkerRef.current = null;
    }

    const townEl = document.createElement('div');
    townEl.style.cssText =
      'background:#0f172a;color:#f8fafc;padding:3px 8px;border-radius:99px;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.25);pointer-events:none;white-space:nowrap;';
    townEl.textContent = hubLabel;
    hubMarkerRef.current = new Marker({ element: townEl, anchor: 'center' })
      .setLngLat(hubCoords)
      .addTo(map);
  }, [region, resorts, isToronto]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const r of resorts) {
      const el = document.createElement('div');
      el.className = 'banff-resort-pin';
      const baseDepth = r.snow.upperBaseCm || r.snow.baseCm || 0;
      const snowVal =
        baseDepth > 0
          ? formatSnow(baseDepth, unit)
          : `+${formatSnow(r.snow.forecast7dCm, unit)} 7d`;
      const titleTxt = lang === 'zh' ? r.nameZh.replace(/滑雪度假村|滑雪场/g, '') : r.shortName;
      const runLbl = lang === 'zh' ? '道' : 'runs';
      const liftLbl = lang === 'zh' ? '缆' : 'lifts';
      const isOpen = r.status === 'open';
      const statusHtml = isOpen
        ? `<span style="color:#16a34a;font-size:10px;">● LIVE</span>`
        : `<span style="color:#64748b;font-size:10px;">○ ${lang === 'zh' ? '待开板' : 'CLOSED'}</span>`;

      el.innerHTML = `
        <div class="banff-resort-pin__name">
          <span>${titleTxt}</span>
          ${statusHtml}
        </div>
        <div class="banff-resort-pin__stats">
          <span>${r.terrain.runsOpen}/${r.terrain.runsTotal} ${runLbl}</span>
          <span>·</span>
          <span>${r.terrain.liftsOpen}/${r.terrain.liftsTotal} ${liftLbl}</span>
          <span>·</span>
          <span class="banff-resort-pin__snow">${snowVal}</span>
        </div>
      `;
      el.addEventListener('click', () => onSelectResort(r.id));

      // Separate closely spaced Barrie hills (MSLM north, Horseshoe south-east, Blue Mountain west)
      let anchor: 'bottom' | 'top-left' | 'bottom-left' | 'bottom-right' = 'bottom';
      if (r.id === 'horseshoe') anchor = 'top-left';
      else if (r.id === 'mslm') anchor = 'bottom-left';
      else if (r.id === 'bluemountain') anchor = 'bottom-right';

      const marker = new Marker({ element: el, anchor })
        .setLngLat(r.coordinates)
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [resorts, unit, lang, onSelectResort]);

  return (
    <section
      className="regional-map-section"
      aria-label={isToronto ? 'Greater Toronto Ski Map' : 'Banff National Park Ski Map'}
    >
      <div className="regional-map-header">
        <div>
          <h2>
            {isToronto
              ? lang === 'zh'
                ? '多伦多周边 · 安省雪带实时地理分布图'
                : 'Greater Toronto & Ontario Snowbelt · Live Regional Map'
              : lang === 'zh'
                ? '班夫国家公园 · SkiBig3 实时地理分布图'
                : 'Banff National Park · SkiBig3 Live Regional Map'}
          </h2>
          <p>
            {isToronto
              ? lang === 'zh'
                ? '从西区 Milton（Glen Eden）到 400 号高速巴里雪带（Horseshoe · MSLM）与蓝山度假村（Blue Mountain），点击任一标牌直接进入雪道地图'
                : 'Click any resort callout from Milton to Barrie & Georgian Bay to launch its interactive trail & lift map'
              : lang === 'zh'
                ? '沿加拿大一号公路（Trans-Canada Hwy 1）分布的三大高山雪场，点击任一雪场标牌直接进入实时雪道与缆车地图'
                : 'Click any resort callout along the Bow Valley corridor to launch its interactive live trail & lift map'}
          </p>
        </div>
      </div>
      <div ref={containerRef} className="regional-map-canvas" id="banff-regional-map" />
    </section>
  );
}
