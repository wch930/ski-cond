import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl';
import type { Lang, ResortData, UnitSystem } from '../types';
import { formatSnow } from '../utils/format';

interface Props {
  resorts: ResortData[];
  unit: UnitSystem;
  lang: Lang;
  onSelectResort: (resortId: string) => void;
}

export function BanffRegionalMap({ resorts, unit, lang, onSelectResort }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

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
      center: [-115.86, 51.25],
      zoom: 9.15,
      pitch: 28,
      bearing: -8,
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

    // Banff Town reference pin
    const townEl = document.createElement('div');
    townEl.style.cssText =
      'background:#0f172a;color:#f8fafc;padding:3px 8px;border-radius:99px;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.25);pointer-events:none;';
    townEl.textContent = '📍 Banff Town 班夫镇';
    new Marker({ element: townEl, anchor: 'center' })
      .setLngLat([-115.5708, 51.1784])
      .addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const r of resorts) {
      const el = document.createElement('div');
      el.className = 'banff-resort-pin';
      const snowVal = formatSnow(r.snow.upperBaseCm || r.snow.baseCm, unit);
      const titleTxt = lang === 'zh' ? r.nameZh.replace('滑雪场', '') : r.shortName;
      const runLbl = lang === 'zh' ? '道' : 'runs';
      const liftLbl = lang === 'zh' ? '缆' : 'lifts';

      el.innerHTML = `
        <div class="banff-resort-pin__name">
          <span>${titleTxt}</span>
          <span style="color:#16a34a;font-size:10px;">● LIVE</span>
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

      const marker = new Marker({ element: el, anchor: 'bottom' })
        .setLngLat(r.coordinates)
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [resorts, unit, lang, onSelectResort]);

  return (
    <section className="regional-map-section" aria-label="Banff National Park Ski Map">
      <div className="regional-map-header">
        <div>
          <h2>
            {lang === 'zh'
              ? '班夫国家公园 · SkiBig3 实时地理分布图'
              : 'Banff National Park · SkiBig3 Live Regional Map'}
          </h2>
          <p>
            {lang === 'zh'
              ? '沿加拿大一号公路（Trans-Canada Hwy 1）分布的三大高山雪场，点击任一雪场标牌直接进入 3D 实时雪道与缆车地图'
              : 'Click any resort callout along the Bow Valley corridor to launch its interactive 3D live trail & lift map'}
          </p>
        </div>
      </div>
      <div ref={containerRef} className="regional-map-canvas" id="banff-regional-map" />
    </section>
  );
}
