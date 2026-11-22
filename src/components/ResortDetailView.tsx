import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CableCar,
  Camera,
  ExternalLink,
  FileText,
  MountainSnow,
  Search,
  Snowflake,
  X,
} from 'lucide-react';
import type {
  Lang,
  ResortData,
  SelectedMapFeature,
  TrailItem,
  UnitSystem,
} from '../types';
import {
  formatElev,
  formatSnow,
  formatTemp,
  formatWind,
  liftTypeLabel,
  weatherDescription,
} from '../utils/format';
import { DifficultyIcon } from './DifficultyIcon';
import { ResortSkiMap } from './ResortSkiMap';

type TabKey = 'terrain' | 'snow' | 'webcams';
type ListFilter = 'all' | 'open' | 'groomed';

interface Props {
  resort: ResortData;
  unit: UnitSystem;
  lang: Lang;
  onBack: () => void;
}

export function ResortDetailView({ resort, unit, lang, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('terrain');
  const [search, setSearch] = useState('');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [selectedFeature, setSelectedFeature] = useState<SelectedMapFeature | null>(null);
  const [focusNormKey, setFocusNormKey] = useState<{
    type: 'trail' | 'lift';
    normName: string;
    ts: number;
  } | null>(null);
  const [mobilePane, setMobilePane] = useState<'map' | 'list'>('map');
  const [camNonce, setCamNonce] = useState<number>(() => Date.now());

  // Reset selected feature when switching resort
  const [prevResortId, setPrevResortId] = useState(resort.id);
  if (prevResortId !== resort.id) {
    setPrevResortId(resort.id);
    setSelectedFeature(null);
    setFocusNormKey(null);
  }

  const q = search.trim().toLowerCase();

  const filteredLifts = useMemo(() => {
    return [...resort.lifts]
      .filter((l) => {
        if (listFilter === 'open' && l.status !== 'open') return false;
        if (listFilter === 'groomed') return false;
        if (q && !l.name.toLowerCase().includes(q) && !l.zone.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [resort.lifts, listFilter, q]);

  const groupedTrails = useMemo(() => {
    const filtered = resort.trails.filter((t) => {
      if (listFilter === 'open' && t.status !== 'open') return false;
      if (listFilter === 'groomed' && !(t.status === 'open' && t.groomed)) return false;
      if (q && !t.name.toLowerCase().includes(q) && !t.zone.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    const map = new Map<string, TrailItem[]>();
    for (const t of filtered) {
      const zone = t.zone || resort.shortName;
      if (!map.has(zone)) map.set(zone, []);
      map.get(zone)!.push(t);
    }

    for (const [, arr] of map) {
      arr.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }

    return Array.from(map.entries()).sort((a, b) => {
      const aOpen = a[1].filter((t) => t.status === 'open').length;
      const bOpen = b[1].filter((t) => t.status === 'open').length;
      if (aOpen !== bOpen) return bOpen - aOpen;
      return a[0].localeCompare(b[0]);
    });
  }, [resort.trails, resort.shortName, listFilter, q]);

  const handleClickLift = (normName: string, name: string, status: 'open' | 'closed', liftType: string, hours: string, zone: string) => {
    setFocusNormKey({ type: 'lift', normName, ts: Date.now() });
    setSelectedFeature({
      featureType: 'lift',
      name,
      normName,
      status,
      liftType,
      hours,
      zone,
    });
    setMobilePane('map');
  };

  const handleClickTrail = (t: TrailItem) => {
    setFocusNormKey({ type: 'trail', normName: t.normName, ts: Date.now() });
    setSelectedFeature({
      featureType: 'trail',
      name: t.name,
      normName: t.normName,
      status: t.status,
      difficulty: t.difficulty,
      groomed: t.groomed,
      zone: t.zone,
    });
    setMobilePane('map');
  };

  return (
    <div className="detail-workspace" data-mobile-pane={mobilePane}>
      <aside className="detail-sidebar" aria-label="Resort Conditions and Trail Directory">
        <div className="detail-sidebar__top">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button id="back-overview-btn" type="button" className="back-link-btn" onClick={onBack}>
              <ArrowLeft size={14} />
              <span>
                {resort.regionId === 'toronto'
                  ? lang === 'zh'
                    ? '返回多伦多周边雪场'
                    : 'Back to Toronto Resorts'
                  : lang === 'zh'
                    ? '返回班夫雪场总览'
                    : 'Back to Banff Resorts'}
              </span>
            </button>
            <a
              href={resort.officialUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: '0.73rem',
                color: 'var(--ink-muted)',
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{lang === 'zh' ? '官网雪报' : 'Official'}</span>
              <ExternalLink size={12} />
            </a>
          </div>

          <div className="detail-title-row">
            <div>
              <h1>{lang === 'zh' ? resort.nameZh : resort.name}</h1>
              <div className="detail-title-sub">
                {resort.name} · ▲ {formatElev(resort.elevationSummitM, unit)} (↕{' '}
                {formatElev(resort.verticalDropM, unit)})
              </div>
            </div>
            <span className={`status-badge ${resort.status === 'open' ? 'is-open' : 'is-closed'}`}>
              <span className="status-dot" />
              {resort.status === 'open' ? (lang === 'zh' ? '营业中' : 'OPEN') : 'CLOSED'}
            </span>
          </div>

          <div className="detail-quick-kpis">
            <div className="mini-kpi">
              <span className="mini-kpi__label">{lang === 'zh' ? '开放雪道' : 'Open Runs'}</span>
              <span className="mini-kpi__val">
                {resort.terrain.runsOpen}/{resort.terrain.runsTotal}
              </span>
            </div>
            <div className="mini-kpi">
              <span className="mini-kpi__label">{lang === 'zh' ? '运行缆车' : 'Open Lifts'}</span>
              <span className="mini-kpi__val">
                {resort.terrain.liftsOpen}/{resort.terrain.liftsTotal}
              </span>
            </div>
            <div className="mini-kpi">
              <span className="mini-kpi__label">{lang === 'zh' ? '雪底厚度' : 'Snow Base'}</span>
              <span className="mini-kpi__val">
                {formatSnow(resort.snow.upperBaseCm || resort.snow.baseCm, unit)}
              </span>
            </div>
            <div className="mini-kpi">
              <span className="mini-kpi__label">{lang === 'zh' ? '7日新雪' : '7d Snow'}</span>
              <span className="mini-kpi__val" style={{ color: 'var(--accent-alpine)' }}>
                +{formatSnow(resort.snow.snow7dCm, unit)}
              </span>
            </div>
          </div>
        </div>

        {/* Sidebar Navigation Tabs */}
        <div className="sidebar-tabs" role="tablist">
          <button
            id="tab-terrain"
            type="button"
            role="tab"
            aria-selected={activeTab === 'terrain'}
            className={`sidebar-tab ${activeTab === 'terrain' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('terrain')}
          >
            <MountainSnow size={14} />
            <span>{lang === 'zh' ? '缆车 & 雪道' : 'Lifts & Runs'}</span>
          </button>
          <button
            id="tab-snow"
            type="button"
            role="tab"
            aria-selected={activeTab === 'snow'}
            className={`sidebar-tab ${activeTab === 'snow' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('snow')}
          >
            <Snowflake size={14} />
            <span>{lang === 'zh' ? '雪况 & 预报' : 'Snow & 7d'}</span>
          </button>
          <button
            id="tab-webcams"
            type="button"
            role="tab"
            aria-selected={activeTab === 'webcams'}
            className={`sidebar-tab ${activeTab === 'webcams' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('webcams')}
          >
            <Camera size={14} />
            <span>{lang === 'zh' ? '实时摄像头' : 'Webcams'}</span>
          </button>
        </div>

        <div className="sidebar-scroll">
          {activeTab === 'terrain' && (
            <>
              <div className="filter-toolbar">
                <div className="search-box">
                  <Search size={15} />
                  <input
                    id="trail-search-input"
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={
                      lang === 'zh'
                        ? '搜索雪道或缆车，点击可在地图定位...'
                        : 'Search lifts or trails to locate on map...'
                    }
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      style={{
                        position: 'absolute',
                        right: 8,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--ink-muted)',
                        padding: 2,
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="filter-pills-row">
                  <button
                    type="button"
                    className={`filter-pill ${listFilter === 'all' ? 'is-active' : ''}`}
                    onClick={() => setListFilter('all')}
                  >
                    {lang === 'zh' ? '全部列表' : 'All'}
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${listFilter === 'open' ? 'is-active' : ''}`}
                    onClick={() => setListFilter('open')}
                  >
                    {lang === 'zh'
                      ? `仅看开放 (${resort.terrain.runsOpen}道 / ${resort.terrain.liftsOpen}缆)`
                      : `Open Only (${resort.terrain.runsOpen})`}
                  </button>
                  <button
                    type="button"
                    className={`filter-pill ${listFilter === 'groomed' ? 'is-active' : ''}`}
                    onClick={() => setListFilter('groomed')}
                  >
                    {lang === 'zh'
                      ? `已压雪 (${resort.terrain.groomedCount})`
                      : `Groomed (${resort.terrain.groomedCount})`}
                  </button>
                </div>
              </div>

              {/* Lifts Section */}
              {filteredLifts.length > 0 && (
                <div className="directory-group">
                  <div className="directory-group__header">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <CableCar size={14} />
                      {lang === 'zh' ? '缆车状态 LIFTS' : 'LIFTS'}
                    </span>
                    <span className="tabular">
                      {resort.terrain.liftsOpen}/{resort.terrain.liftsTotal}{' '}
                      {lang === 'zh' ? '开放' : 'Open'}
                    </span>
                  </div>
                  {filteredLifts.map((lift) => {
                    const isSel =
                      selectedFeature?.featureType === 'lift' &&
                      selectedFeature.normName === lift.normName;
                    return (
                      <button
                        key={lift.name}
                        type="button"
                        className={`directory-row ${isSel ? 'is-selected' : ''}`}
                        onClick={() =>
                          handleClickLift(
                            lift.normName,
                            lift.name,
                            lift.status,
                            lift.liftType,
                            lift.hours,
                            lift.zone
                          )
                        }
                      >
                        <div className="directory-row__left">
                          <CableCar
                            size={15}
                            style={{
                              color:
                                lift.status === 'open' ? 'var(--accent-lift)' : 'var(--ink-muted)',
                              flexShrink: 0,
                            }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div className="directory-row__name">{lift.name}</div>
                            <div className="directory-row__sub">
                              {liftTypeLabel(lift.liftType, lang)} · {lift.hours}
                            </div>
                          </div>
                        </div>
                        <div className="directory-row__right">
                          <span
                            className={`row-status ${
                              lift.status === 'open' ? 'is-open' : 'is-closed'
                            }`}
                          >
                            {lift.status === 'open'
                              ? lang === 'zh'
                                ? '运行中'
                                : 'OPEN'
                              : lang === 'zh'
                                ? '关闭'
                                : 'CLOSED'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Trails Grouped by Zone */}
              {groupedTrails.map(([zone, trails]) => {
                const openInZone = trails.filter((t) => t.status === 'open').length;
                return (
                  <div key={zone} className="directory-group">
                    <div className="directory-group__header">
                      <span>{zone}</span>
                      <span className="tabular">
                        {openInZone}/{trails.length} {lang === 'zh' ? '道开放' : 'open'}
                      </span>
                    </div>
                    {trails.map((t) => {
                      const isSel =
                        selectedFeature?.featureType === 'trail' &&
                        selectedFeature.normName === t.normName;
                      return (
                        <button
                          key={`${zone}-${t.name}`}
                          type="button"
                          className={`directory-row ${isSel ? 'is-selected' : ''}`}
                          onClick={() => handleClickTrail(t)}
                        >
                          <div className="directory-row__left">
                            <DifficultyIcon difficulty={t.difficulty} />
                            <span className="directory-row__name">{t.name}</span>
                          </div>
                          <div className="directory-row__right">
                            {t.groomed && (
                              <span className="groomed-chip">
                                {lang === 'zh' ? '压雪' : 'Groomed'}
                              </span>
                            )}
                            <span
                              className={`row-status ${
                                t.status === 'open' ? 'is-open' : 'is-closed'
                              }`}
                            >
                              {t.status === 'open'
                                ? lang === 'zh'
                                  ? '开放'
                                  : 'OPEN'
                                : lang === 'zh'
                                  ? '未开'
                                  : 'CLOSED'}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              {filteredLifts.length === 0 && groupedTrails.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 12px', color: 'var(--ink-muted)', fontSize: '0.84rem' }}>
                  {lang === 'zh' ? '没有匹配的雪道或缆车' : 'No matching lifts or trails found'}
                </div>
              )}
            </>
          )}

          {activeTab === 'snow' && (
            <>
              <div className="panel-block">
                <h3 className="panel-block__title">
                  <span>{lang === 'zh' ? '实时降雪与雪底报告' : 'Live Snowfall & Base Depth'}</span>
                  <span style={{ fontWeight: 500, fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                    {resort.lastUpdated}
                  </span>
                </h3>
                <div className="snow-detail-grid">
                  <div className="snow-detail-item">
                    <div className="snow-detail-item__label">
                      {lang === 'zh' ? '过夜新雪' : 'Overnight'}
                    </div>
                    <div className="snow-detail-item__val">
                      {formatSnow(resort.snow.overnightCm, unit)}
                    </div>
                  </div>
                  <div className="snow-detail-item">
                    <div className="snow-detail-item__label">
                      {lang === 'zh' ? '24小时新雪' : '24 Hours'}
                    </div>
                    <div className="snow-detail-item__val">
                      {formatSnow(resort.snow.snow24hCm, unit)}
                    </div>
                  </div>
                  <div className="snow-detail-item">
                    <div className="snow-detail-item__label">
                      {lang === 'zh' ? '7日累计降雪' : '7-Day Snow'}
                    </div>
                    <div className="snow-detail-item__val" style={{ color: 'var(--accent-alpine)' }}>
                      {formatSnow(resort.snow.snow7dCm, unit)}
                    </div>
                  </div>
                  <div className="snow-detail-item">
                    <div className="snow-detail-item__label">
                      {lang === 'zh' ? '山顶雪底' : 'Upper Base'}
                    </div>
                    <div className="snow-detail-item__val">
                      {formatSnow(resort.snow.upperBaseCm, unit)}
                    </div>
                  </div>
                  <div className="snow-detail-item">
                    <div className="snow-detail-item__label">
                      {lang === 'zh' ? '山腰雪底' : 'Mid/Lower Base'}
                    </div>
                    <div className="snow-detail-item__val">
                      {formatSnow(resort.snow.baseCm, unit)}
                    </div>
                  </div>
                  <div className="snow-detail-item">
                    <div className="snow-detail-item__label">
                      {lang === 'zh' ? '本季总降雪' : 'Season Total'}
                    </div>
                    <div className="snow-detail-item__val">
                      {formatSnow(resort.snow.seasonCm, unit)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="panel-block">
                <h3 className="panel-block__title">
                  <span>{lang === 'zh' ? '高山实时气象' : 'Current Mountain Weather'}</span>
                  <span>{weatherDescription(resort.weather.weatherCode, lang)}</span>
                </h3>
                <div className="snow-detail-grid">
                  <div className="snow-detail-item">
                    <div className="snow-detail-item__label">
                      {lang === 'zh' ? '山顶气温' : 'Summit Temp'}
                    </div>
                    <div className="snow-detail-item__val">
                      {formatTemp(resort.weather.tempSummitC, unit)}
                    </div>
                  </div>
                  <div className="snow-detail-item">
                    <div className="snow-detail-item__label">
                      {lang === 'zh' ? '山脚气温' : 'Base Temp'}
                    </div>
                    <div className="snow-detail-item__val">
                      {formatTemp(resort.weather.tempBaseC, unit)}
                    </div>
                  </div>
                  <div className="snow-detail-item">
                    <div className="snow-detail-item__label">
                      {lang === 'zh' ? '山脊风速' : 'Ridge Wind'}
                    </div>
                    <div className="snow-detail-item__val">
                      {formatWind(resort.weather.windKmh, unit)}
                    </div>
                  </div>
                </div>
              </div>

              {resort.notes && (
                <div className="panel-block">
                  <h3 className="panel-block__title">
                    <span>{lang === 'zh' ? '雪场巡逻队今日公告' : 'Mountain Operations Report'}</span>
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.81rem', lineHeight: 1.55, color: 'var(--ink-secondary)' }}>
                    {resort.notes}
                  </p>
                  {(resort.dailyRunReportPdf || resort.dailyGroomingPdf) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      {resort.dailyRunReportPdf && (
                        <a
                          href={resort.dailyRunReportPdf}
                          target="_blank"
                          rel="noreferrer"
                          className="icon-btn"
                          style={{ textDecoration: 'none' }}
                        >
                          <FileText size={13} />
                          <span>{lang === 'zh' ? '每日雪道 PDF' : 'Daily Run PDF'}</span>
                        </a>
                      )}
                      {resort.dailyGroomingPdf && (
                        <a
                          href={resort.dailyGroomingPdf}
                          target="_blank"
                          rel="noreferrer"
                          className="icon-btn"
                          style={{ textDecoration: 'none' }}
                        >
                          <FileText size={13} />
                          <span>{lang === 'zh' ? '每日压雪 PDF' : 'Grooming PDF'}</span>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}

              {resort.weather.dailyForecast.length > 0 && (
                <div className="panel-block">
                  <h3 className="panel-block__title">
                    <span>{lang === 'zh' ? '未来 7 日高山降雪预报' : '7-Day Alpine Forecast'}</span>
                    <span className="tabular" style={{ color: 'var(--accent-alpine)' }}>
                      +{formatSnow(resort.snow.forecast7dCm, unit)}
                    </span>
                  </h3>
                  <div className="forecast-list">
                    {resort.weather.dailyForecast.map((d, i) => (
                      <div key={d.date} className="forecast-row">
                        <strong className="tabular">
                          {i === 0 ? (lang === 'zh' ? '今日' : 'Today') : d.date.slice(5)}
                        </strong>
                        <span style={{ color: 'var(--ink-secondary)' }}>
                          {weatherDescription(d.weatherCode, lang)}
                        </span>
                        <span className="tabular" style={{ color: 'var(--ink-secondary)' }}>
                          {formatTemp(d.tempMinC, unit)} / {formatTemp(d.tempMaxC, unit)}
                        </span>
                        <span className="forecast-snow-badge">
                          {d.snowCm > 0 ? `+${formatSnow(d.snowCm, unit)}` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'webcams' && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: '0.78rem', color: 'var(--ink-secondary)', fontWeight: 600 }}>
                  {lang === 'zh' ? '雪场官方实时监控画面' : 'Live Mountain Webcams'}
                </span>
                {resort.webcams.length > 0 && (
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ height: 28 }}
                    onClick={() => setCamNonce(Date.now())}
                  >
                    {lang === 'zh' ? '刷新画面' : 'Reload Cams'}
                  </button>
                )}
              </div>
              {resort.webcams.length === 0 ? (
                <div className="panel-block" style={{ textAlign: 'center', padding: '22px 16px' }}>
                  <p style={{ margin: '0 0 12px', fontSize: '0.83rem', color: 'var(--ink-secondary)' }}>
                    {lang === 'zh'
                      ? `${resort.nameZh} 实时画面由官方 Live View 页面提供，可点击下方按钮查看雪坡实况。`
                      : `Live slope cameras for ${resort.name} are hosted directly on the resort's official Live View portal.`}
                  </p>
                  <a
                    href={resort.id === 'gleneden' ? 'https://gleneden.on.ca/live-view/' : resort.officialUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="icon-btn"
                    style={{ textDecoration: 'none', display: 'inline-flex' }}
                  >
                    <span>{lang === 'zh' ? '打开官网实时画面' : 'Open Official Live Cams'}</span>
                    <ExternalLink size={13} />
                  </a>
                </div>
              ) : (
                <div className="webcam-grid">
                  {resort.webcams.map((cam) => (
                    <div key={cam.id} className="webcam-card">
                      <img
                        src={`/api/webcam?url=${encodeURIComponent(cam.url)}&_t=${camNonce}`}
                        alt={cam.title}
                        loading="lazy"
                        onError={(e) => {
                          // Direct fallback if running without server proxy
                          const target = e.currentTarget;
                          if (!target.dataset.directTried) {
                            target.dataset.directTried = '1';
                            target.src = cam.url;
                          }
                        }}
                      />
                      <div className="webcam-card__caption">
                        <span>{cam.title}</span>
                        {cam.linkUrl ? (
                          <a
                            href={cam.linkUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: 'var(--accent-alpine)',
                              fontSize: '0.72rem',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <span>{lang === 'zh' ? '视频直播' : 'Watch Live'}</span>
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span style={{ color: 'var(--status-open)', fontSize: '0.7rem' }}>● LIVE</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Main Interactive Real-Time 3D/2D Ski Trail Map */}
      <ResortSkiMap
        resort={resort}
        unit={unit}
        lang={lang}
        selectedFeature={selectedFeature}
        onSelectFeature={setSelectedFeature}
        focusNormKey={focusNormKey}
      />

      {/* Mobile View Switcher */}
      <div className="mobile-view-switch" role="group" aria-label="Switch mobile pane">
        <button
          type="button"
          className={mobilePane === 'map' ? 'is-active' : ''}
          onClick={() => setMobilePane('map')}
        >
          {lang === 'zh' ? '实时雪道图' : 'Live Map'}
        </button>
        <button
          type="button"
          className={mobilePane === 'list' ? 'is-active' : ''}
          onClick={() => setMobilePane('list')}
        >
          {lang === 'zh' ? '雪道/雪况列表' : 'Trails & Snow'}
        </button>
      </div>
    </div>
  );
}
