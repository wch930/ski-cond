import { useCallback, useEffect, useMemo, useState } from 'react';
import { CableCar, Compass, MountainSnow, Snowflake, Sparkles } from 'lucide-react';
import type { ConditionsPayload, Lang, ThemeMode, UnitSystem } from './types';
import { formatSnow } from './utils/format';
import { TopNav } from './components/TopNav';
import { ResortCard } from './components/ResortCard';
import { BanffRegionalMap } from './components/BanffRegionalMap';
import { ResortDetailView } from './components/ResortDetailView';

function readResortFromHash(): string | null {
  const h = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(h);
  return params.get('resort');
}

export function App() {
  const [payload, setPayload] = useState<ConditionsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedResortId, setSelectedResortId] = useState<string | null>(() =>
    readResortFromHash()
  );
  const [unit, setUnit] = useState<UnitSystem>('metric');
  const [lang, setLang] = useState<Lang>('zh');
  const [theme, setTheme] = useState<ThemeMode>('day');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    const onHash = () => {
      setSelectedResortId(readResortFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const selectResort = useCallback((id: string | null) => {
    setSelectedResortId(id);
    if (id) {
      window.history.pushState(null, '', `#resort=${id}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.history.pushState(null, '', window.location.pathname);
    }
  }, []);

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

  const resorts = useMemo(() => payload?.resorts ?? [], [payload]);
  const selectedResort = useMemo(
    () => resorts.find((r) => r.id === selectedResortId) ?? null,
    [resorts, selectedResortId]
  );

  // Aggregate Banff SkiBig3 regional totals
  const summary = useMemo(() => {
    if (!resorts.length) {
      return {
        runsOpen: 0,
        runsTotal: 0,
        liftsOpen: 0,
        liftsTotal: 0,
        groomedTotal: 0,
        best7dResort: '',
        best7dCm: 0,
        deepestBaseResort: '',
        deepestBaseCm: 0,
      };
    }
    let runsOpen = 0;
    let runsTotal = 0;
    let liftsOpen = 0;
    let liftsTotal = 0;
    let groomedTotal = 0;
    let best7d = resorts[0];
    let deepest = resorts[0];

    for (const r of resorts) {
      runsOpen += r.terrain.runsOpen;
      runsTotal += r.terrain.runsTotal;
      liftsOpen += r.terrain.liftsOpen;
      liftsTotal += r.terrain.liftsTotal;
      groomedTotal += r.terrain.groomedCount;
      if (r.snow.snow7dCm > best7d.snow.snow7dCm) best7d = r;
      if ((r.snow.upperBaseCm || r.snow.baseCm) > (deepest.snow.upperBaseCm || deepest.snow.baseCm)) {
        deepest = r;
      }
    }

    return {
      runsOpen,
      runsTotal,
      liftsOpen,
      liftsTotal,
      groomedTotal,
      best7dResort: lang === 'zh' ? best7d.nameZh.replace('滑雪场', '') : best7d.shortName,
      best7dCm: best7d.snow.snow7dCm,
      deepestBaseResort: lang === 'zh' ? deepest.nameZh.replace('滑雪场', '') : deepest.shortName,
      deepestBaseCm: deepest.snow.upperBaseCm || deepest.snow.baseCm,
    };
  }, [resorts, lang]);

  return (
    <>
      <TopNav
        resorts={resorts}
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
              ? '正在同步班夫三大雪场（Sunshine · Lake Louise · Norquay）官方实时雪况...'
              : 'Syncing live snow conditions from Banff SkiBig3 resorts...'}
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
              <div className="region-selector-row">
                {(payload?.regions ?? []).map((reg) => (
                  <span
                    key={reg.id}
                    className={`region-chip ${reg.active ? 'is-active' : 'is-upcoming'}`}
                  >
                    <Compass size={13} />
                    <span>{lang === 'zh' ? reg.nameZh : reg.name}</span>
                  </span>
                ))}
              </div>
              <h1 className="hero-h1">
                {lang === 'zh'
                  ? 'Banff 班夫国家公园 · 实时雪况与雪道地图'
                  : 'Banff National Park · Live Snow Report & Trail Maps'}
              </h1>
              <p className="hero-subtitle">
                {lang === 'zh'
                  ? '直连 SkiBig3 三大雪场官方数据源与高山气象站，随时查看今日开放雪道、实时降雪厚度（cm）与运行缆车，点击任一雪场即可探索 3D 实时雪道图。'
                  : 'Live snow depth, open runs, groomed terrain, and spinning lifts across Banff Sunshine, Lake Louise, and Mt. Norquay. Select any mountain to explore its live 3D trail map.'}
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

          {/* Banff SkiBig3 Aggregate Telemetry Strip */}
          <section className="telemetry-strip" aria-label="Banff aggregate ski conditions">
            <div className="telemetry-cell">
              <span className="telemetry-cell__label">
                <MountainSnow size={14} />
                {lang === 'zh' ? '班夫今日开放雪道' : 'Total Open Trails'}
              </span>
              <span className="telemetry-cell__value">
                {summary.runsOpen} / {summary.runsTotal}
              </span>
              <span className="telemetry-cell__sub">
                {lang === 'zh'
                  ? `三大雪场共已压雪 ${summary.groomedTotal} 条`
                  : `${summary.groomedTotal} groomed runs across Banff`}
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
                {lang === 'zh'
                  ? '含高速箱式缆车与高速吊椅'
                  : 'Gondolas, high-speed quads & carpets'}
              </span>
            </div>

            <div className="telemetry-cell">
              <span className="telemetry-cell__label">
                <Snowflake size={14} />
                {lang === 'zh' ? '7日最佳降雪' : 'Best 7-Day Snow'}
              </span>
              <span className="telemetry-cell__value" style={{ color: 'var(--accent-alpine)' }}>
                +{formatSnow(summary.best7dCm, unit)}
              </span>
              <span className="telemetry-cell__sub">{summary.best7dResort}</span>
            </div>

            <div className="telemetry-cell">
              <span className="telemetry-cell__label">
                <Sparkles size={14} />
                {lang === 'zh' ? '当前最厚雪底' : 'Deepest Snow Base'}
              </span>
              <span className="telemetry-cell__value">
                {formatSnow(summary.deepestBaseCm, unit)}
              </span>
              <span className="telemetry-cell__sub">{summary.deepestBaseResort}</span>
            </div>
          </section>

          {/* 3 Banff Resort Telemetry Cards */}
          <section className="resorts-grid" aria-label="Banff Ski Resorts">
            {resorts.map((resort) => (
              <ResortCard
                key={resort.id}
                resort={resort}
                unit={unit}
                lang={lang}
                onOpenMap={(id) => selectResort(id)}
              />
            ))}
          </section>

          {/* Regional Interactive Map of Banff National Park */}
          <BanffRegionalMap
            resorts={resorts}
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
