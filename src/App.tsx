import { useCallback, useEffect, useMemo, useState } from 'react';
import { CableCar, Compass, MountainSnow, Snowflake, Sparkles } from 'lucide-react';
import type { ConditionsPayload, Lang, ThemeMode, UnitSystem } from './types';
import { formatSnow } from './utils/format';
import { TopNav } from './components/TopNav';
import { ResortCard } from './components/ResortCard';
import { BanffRegionalMap } from './components/BanffRegionalMap';
import { ResortDetailView } from './components/ResortDetailView';

const TORONTO_RESORT_IDS = new Set(['bluemountain', 'mslm', 'horseshoe', 'gleneden']);

function readRouteFromHash(): { regionId: string; resortId: string | null } {
  const h = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(h);
  const resortId = params.get('resort');
  const rawRegion = params.get('region');
  if (resortId && TORONTO_RESORT_IDS.has(resortId)) {
    return { regionId: 'toronto', resortId };
  }
  if (rawRegion === 'toronto' || rawRegion === 'banff') {
    return { regionId: rawRegion, resortId };
  }
  return { regionId: 'banff', resortId };
}

export function App() {
  const [payload, setPayload] = useState<ConditionsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string>(
    () => readRouteFromHash().regionId
  );
  const [selectedResortId, setSelectedResortId] = useState<string | null>(
    () => readRouteFromHash().resortId
  );
  const [unit, setUnit] = useState<UnitSystem>('metric');
  const [lang, setLang] = useState<Lang>('zh');
  const [theme, setTheme] = useState<ThemeMode>('day');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => {
      const next = readRouteFromHash();
      setSelectedRegionId(next.regionId);
      setSelectedResortId(next.resortId);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const allResorts = useMemo(() => payload?.resorts ?? [], [payload]);
  const regions = useMemo(() => payload?.regions ?? [], [payload]);

  const selectRegion = useCallback((regionId: string) => {
    setSelectedRegionId(regionId);
    setSelectedResortId(null);
    if (regionId === 'banff') {
      window.history.pushState(null, '', window.location.pathname);
    } else {
      window.history.pushState(null, '', `#region=${regionId}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const selectResort = useCallback(
    (id: string | null) => {
      setSelectedResortId(id);
      if (id) {
        const found = allResorts.find((r) => r.id === id);
        const targetRegion = found?.regionId || (TORONTO_RESORT_IDS.has(id) ? 'toronto' : selectedRegionId);
        setSelectedRegionId(targetRegion);
        window.history.pushState(null, '', `#resort=${id}`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        if (selectedRegionId === 'banff') {
          window.history.pushState(null, '', window.location.pathname);
        } else {
          window.history.pushState(null, '', `#region=${selectedRegionId}`);
        }
      }
    },
    [allResorts, selectedRegionId]
  );

  const fetchPayload = useCallback(async (force: boolean): Promise<ConditionsPayload | null> => {
    try {
      const res = await fetch(force ? '/api/conditions?refresh=1' : '/api/conditions');
      if (!res.ok) throw new Error('API unavailable');
      return (await res.json()) as ConditionsPayload;
    } catch {
      try {
        const fb = await fetch('/data/fallback-conditions.json');
        return (await fb.json()) as ConditionsPayload;
      } catch {
        return null;
      }
    }
  }, []);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    const data = await fetchPayload(true);
    if (data) setPayload(data);
    setIsRefreshing(false);
  }, [fetchPayload]);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      const data = await fetchPayload(false);
      if (active) {
        if (data) setPayload(data);
        setLoading(false);
      }
    };
    void sync();
    const timer = setInterval(() => {
      void sync();
    }, 5 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [fetchPayload]);

  const selectedResort = useMemo(
    () => allResorts.find((r) => r.id === selectedResortId) ?? null,
    [allResorts, selectedResortId]
  );

  const effectiveRegionId = selectedResort ? selectedResort.regionId : selectedRegionId;

  const activeRegion = useMemo(
    () => regions.find((r) => r.id === effectiveRegionId) ?? regions[0],
    [regions, effectiveRegionId]
  );

  const regionResorts = useMemo(
    () => allResorts.filter((r) => r.regionId === effectiveRegionId),
    [allResorts, effectiveRegionId]
  );

  const resortCountByRegion = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of allResorts) {
      counts[r.regionId] = (counts[r.regionId] || 0) + 1;
    }
    return counts;
  }, [allResorts]);

  const isToronto = effectiveRegionId === 'toronto';

  // Aggregate active region totals
  const summary = useMemo(() => {
    if (!regionResorts.length) {
      return {
        runsOpen: 0,
        runsTotal: 0,
        liftsOpen: 0,
        liftsTotal: 0,
        groomedTotal: 0,
        best7dResort: '',
        best7dCm: 0,
        bestForecastResort: '',
        bestForecastCm: 0,
        deepestBaseResort: '',
        deepestBaseCm: 0,
      };
    }
    let runsOpen = 0;
    let runsTotal = 0;
    let liftsOpen = 0;
    let liftsTotal = 0;
    let groomedTotal = 0;
    let best7d = regionResorts[0];
    let bestForecast = regionResorts[0];
    let deepest = regionResorts[0];

    for (const r of regionResorts) {
      runsOpen += r.terrain.runsOpen;
      runsTotal += r.terrain.runsTotal;
      liftsOpen += r.terrain.liftsOpen;
      liftsTotal += r.terrain.liftsTotal;
      groomedTotal += r.terrain.groomedCount;
      if (r.snow.snow7dCm > best7d.snow.snow7dCm) best7d = r;
      if (r.snow.forecast7dCm > bestForecast.snow.forecast7dCm) bestForecast = r;
      if ((r.snow.upperBaseCm || r.snow.baseCm) > (deepest.snow.upperBaseCm || deepest.snow.baseCm)) {
        deepest = r;
      }
    }

    const fmtName = (r: (typeof regionResorts)[number]) =>
      lang === 'zh' ? r.nameZh.replace(/滑雪度假村|滑雪场/g, '') : r.shortName;

    return {
      runsOpen,
      runsTotal,
      liftsOpen,
      liftsTotal,
      groomedTotal,
      best7dResort: fmtName(best7d),
      best7dCm: best7d.snow.snow7dCm,
      bestForecastResort: fmtName(bestForecast),
      bestForecastCm: bestForecast.snow.forecast7dCm,
      deepestBaseResort: fmtName(deepest),
      deepestBaseCm: deepest.snow.upperBaseCm || deepest.snow.baseCm,
    };
  }, [regionResorts, lang]);

  const showForecastInStrip = summary.best7dCm === 0 && summary.bestForecastCm > 0;

  return (
    <>
      <TopNav
        regions={regions}
        selectedRegionId={effectiveRegionId}
        onSelectRegion={selectRegion}
        resorts={regionResorts}
        selectedResortId={selectedResort?.id ?? null}
        onSelectResort={selectResort}
        unit={unit}
        onChangeUnit={setUnit}
        lang={lang}
        onChangeLang={setLang}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'day' ? 'dusk' : 'day'))}
        isRefreshing={isRefreshing}
        onRefresh={handleManualRefresh}
      />

      {loading && !payload ? (
        <main className="overview-shell">
          <div
            style={{
              padding: '72px 20px',
              textAlign: 'center',
              color: 'var(--ink-secondary)',
              fontSize: '0.95rem',
            }}
          >
            {lang === 'zh'
              ? '正在同步班夫与多伦多周边雪场官方实时雪况...'
              : 'Syncing live snow conditions across Banff & Greater Toronto resorts...'}
          </div>
        </main>
      ) : selectedResort ? (
        <ResortDetailView
          resort={selectedResort}
          unit={unit}
          lang={lang}
          onBack={() => selectResort(null)}
        />
      ) : (
        <main className="overview-shell">
          {/* Hero & Region Switcher */}
          <section className="hero-bar">
            <div className="hero-bar__title-group">
              <div className="region-selector-row" role="tablist" aria-label="Ski Regions">
                {regions.map((reg) => {
                  const isSelected = reg.id === selectedRegionId;
                  const count = resortCountByRegion[reg.id] || 0;
                  if (reg.active) {
                    return (
                      <button
                        key={reg.id}
                        id={`region-chip-${reg.id}`}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        className={`region-chip is-clickable ${isSelected ? 'is-active' : ''}`}
                        onClick={() => selectRegion(reg.id)}
                      >
                        <Compass size={13} />
                        <span>{lang === 'zh' ? reg.nameZh : reg.name}</span>
                        {count > 0 && <span className="region-chip__count">{count}</span>}
                      </button>
                    );
                  }
                  return (
                    <span key={reg.id} className="region-chip is-upcoming">
                      <Compass size={13} />
                      <span>{lang === 'zh' ? reg.nameZh : reg.name}</span>
                    </span>
                  );
                })}
              </div>
              <h1 className="hero-h1">
                {isToronto
                  ? lang === 'zh'
                    ? '多伦多周边 · 安省四大雪场实时雪况与雪道地图'
                    : 'Greater Toronto & Southern Ontario · Live Snow Report & Trail Maps'
                  : lang === 'zh'
                    ? 'Banff 班夫国家公园 · 实时雪况与雪道地图'
                    : 'Banff National Park · Live Snow Report & Trail Maps'}
              </h1>
              <p className="hero-subtitle">
                {isToronto
                  ? lang === 'zh'
                    ? '覆盖多伦多 40 分钟至 2 小时车程四大主力雪场（蓝山 Blue Mountain · 圣路易斯月石山 MSLM · 马蹄谷 Horseshoe · 格伦伊登 Glen Eden），直连官方雪报、7 日降雪预报与全山雪道缆车地图。'
                    : 'Live slope & lift status, snowmaking readiness, 7-day snow forecasts, and interactive OpenStreetMap trail maps across Blue Mountain, Mount St. Louis Moonstone, Horseshoe Valley, and Glen Eden.'
                  : lang === 'zh'
                    ? '直连 SkiBig3 三大雪场官方数据源与高山气象站，随时查看今日开放雪道、实时降雪厚度（cm）与运行缆车，点击任一雪场即可探索实时雪道图。'
                    : 'Live snow depth, open runs, groomed terrain, and spinning lifts across Banff Sunshine, Lake Louise, and Mt. Norquay. Select any mountain to explore its interactive trail map.'}
              </p>
            </div>

            {payload?.fetchedAt && (
              <div style={{ fontSize: '0.76rem', color: 'var(--ink-muted)' }}>
                {lang === 'zh' ? '官方源同步时间：' : 'Live feed synced: '}
                <span className="tabular">
                  {new Date(payload.fetchedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}
          </section>

          {/* Regional Aggregate Telemetry Strip */}
          <section className="telemetry-strip" aria-label="Regional aggregate ski conditions">
            <div className="telemetry-cell">
              <span className="telemetry-cell__label">
                <MountainSnow size={14} />
                {lang === 'zh'
                  ? isToronto
                    ? '多伦多周边开放雪道'
                    : '班夫今日开放雪道'
                  : 'Total Open Trails'}
              </span>
              <span className="telemetry-cell__value">
                {summary.runsOpen} / {summary.runsTotal}
              </span>
              <span className="telemetry-cell__sub">
                {summary.runsOpen > 0
                  ? lang === 'zh'
                    ? `共已压雪 ${summary.groomedTotal} 条`
                    : `${summary.groomedTotal} groomed runs open`
                  : lang === 'zh'
                    ? '开板前准备中 · 可提前浏览全山雪道图'
                    : 'Pre-season prep · Full trail maps ready'}
              </span>
            </div>

            <div className="telemetry-cell">
              <span className="telemetry-cell__label">
                <CableCar size={14} />
                {lang === 'zh' ? '正在运行缆车' : 'Spinning Lifts'}
              </span>
              <span className="telemetry-cell__value">
                {summary.liftsOpen} / {summary.liftsTotal}
              </span>
              <span className="telemetry-cell__sub">
                {isToronto
                  ? lang === 'zh'
                    ? '含高速 8 人/6 人吊椅与初学者魔毯'
                    : '8-pack & 6-pack express chairs & carpets'
                  : lang === 'zh'
                    ? '含高速箱式缆车与高速吊椅'
                    : 'Gondolas, high-speed quads & carpets'}
              </span>
            </div>

            <div className="telemetry-cell">
              <span className="telemetry-cell__label">
                <Snowflake size={14} />
                {showForecastInStrip
                  ? lang === 'zh'
                    ? '未来7日降雪预报'
                    : '7-Day Snow Forecast'
                  : lang === 'zh'
                    ? '7日最佳降雪'
                    : 'Best 7-Day Snow'}
              </span>
              <span className="telemetry-cell__value" style={{ color: 'var(--accent-alpine)' }}>
                +{formatSnow(showForecastInStrip ? summary.bestForecastCm : summary.best7dCm, unit)}
              </span>
              <span className="telemetry-cell__sub">
                {showForecastInStrip ? summary.bestForecastResort : summary.best7dResort}
              </span>
            </div>

            <div className="telemetry-cell">
              <span className="telemetry-cell__label">
                <Sparkles size={14} />
                {lang === 'zh' ? '当前最厚雪底' : 'Deepest Snow Base'}
              </span>
              <span className="telemetry-cell__value">
                {formatSnow(summary.deepestBaseCm, unit)}
              </span>
              <span className="telemetry-cell__sub">
                {summary.deepestBaseCm > 0
                  ? summary.deepestBaseResort
                  : lang === 'zh'
                    ? '等待降温人工造雪窗口'
                    : 'Awaiting snowmaking cold snap'}
              </span>
            </div>
          </section>

          {/* Resort Telemetry Cards */}
          <section
            className={`resorts-grid ${regionResorts.length === 4 ? 'is-quad' : ''}`}
            aria-label="Ski Resorts"
          >
            {regionResorts.map((resort) => (
              <ResortCard
                key={resort.id}
                resort={resort}
                unit={unit}
                lang={lang}
                onOpenMap={(id) => selectResort(id)}
              />
            ))}
          </section>

          {/* Regional Interactive Map */}
          <BanffRegionalMap
            region={activeRegion}
            resorts={regionResorts}
            unit={unit}
            lang={lang}
            onSelectResort={(id) => selectResort(id)}
          />
        </main>
      )}
    </>
  );
}

export default App;
