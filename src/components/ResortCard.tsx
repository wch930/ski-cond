import { ArrowUpRight, CableCar, MountainSnow, Snowflake, Thermometer, Wind } from 'lucide-react';
import type { Lang, ResortData, UnitSystem } from '../types';
import {
  formatElev,
  formatSnow,
  formatTemp,
  formatWind,
  weatherDescription,
} from '../utils/format';

interface Props {
  resort: ResortData;
  unit: UnitSystem;
  lang: Lang;
  onOpenMap: (resortId: string) => void;
}

export function ResortCard({ resort, unit, lang, onOpenMap }: Props) {
  const openLifts = resort.lifts.filter((l) => l.status === 'open');
  const isOpen = resort.status === 'open';

  return (
    <article
      id={`resort-card-${resort.id}`}
      className="resort-card"
      onClick={() => onOpenMap(resort.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenMap(resort.id);
        }
      }}
    >
      <div className="resort-card__header">
        <div className="resort-card__top-row">
          <span className={`status-badge ${isOpen ? 'is-open' : 'is-closed'}`}>
            <span className="status-dot" />
            {isOpen
              ? lang === 'zh'
                ? '营业中 · LIVE'
                : 'OPEN · LIVE'
              : lang === 'zh'
                ? '暂未开放'
                : 'CLOSED'}
          </span>
          <span className="resort-card__elev">
            ▲ {formatElev(resort.elevationSummitM, unit)} · ↕ {formatElev(resort.verticalDropM, unit)}
          </span>
        </div>

        <h2 className="resort-card__title">
          <span>{resort.shortName}</span>
          <span className="resort-card__zh">
            {lang === 'zh' ? resort.nameZh : `${resort.driveMinutesFromBanff} min from Banff`}
          </span>
        </h2>

        <p className="resort-card__tagline">
          {lang === 'zh' ? resort.tagline : resort.taglineEn}
        </p>
      </div>

      {/* Core 3 Pillars: Open Runs | Snow Base/7d | Open Lifts */}
      <div className="resort-card__primary-metrics">
        <div className="primary-metric">
          <span className="primary-metric__label">
            <MountainSnow size={14} />
            {lang === 'zh' ? '开放雪道' : 'Open Runs'}
          </span>
          <div className="primary-metric__number">
            {resort.terrain.runsOpen}
            <span className="primary-metric__denom"> / {resort.terrain.runsTotal}</span>
          </div>
          <div className="meter-track">
            <div
              className="meter-fill"
              style={{ width: `${Math.max(4, resort.terrain.runsOpenPct)}%` }}
            />
          </div>
          <span className="primary-metric__meta">
            {lang === 'zh'
              ? `已压雪 ${resort.terrain.groomedCount} 条`
              : `${resort.terrain.groomedCount} groomed`}
          </span>
        </div>

        <div className="primary-metric">
          <span className="primary-metric__label">
            <Snowflake size={14} />
            {lang === 'zh' ? '雪底厚度' : 'Snow Base'}
          </span>
          <div className="primary-metric__number">
            {formatSnow(resort.snow.upperBaseCm || resort.snow.baseCm, unit)}
          </div>
          <div className="meter-track">
            <div
              className="meter-fill"
              style={{ width: `${Math.min(100, Math.round((resort.snow.upperBaseCm / 150) * 100))}%` }}
            />
          </div>
          <span className="primary-metric__meta">
            {lang === 'zh'
              ? `7日新雪 +${formatSnow(resort.snow.snow7dCm, unit)}`
              : `7d: +${formatSnow(resort.snow.snow7dCm, unit)}`}
          </span>
        </div>

        <div className="primary-metric">
          <span className="primary-metric__label">
            <CableCar size={14} />
            {lang === 'zh' ? '运行缆车' : 'Open Lifts'}
          </span>
          <div className="primary-metric__number">
            {resort.terrain.liftsOpen}
            <span className="primary-metric__denom"> / {resort.terrain.liftsTotal}</span>
          </div>
          <div className="meter-track">
            <div
              className="meter-fill is-lift"
              style={{ width: `${Math.max(6, resort.terrain.liftsOpenPct)}%` }}
            />
          </div>
          <span className="primary-metric__meta">
            {lang === 'zh'
              ? `运力开启 ${resort.terrain.liftsOpenPct}%`
              : `${resort.terrain.liftsOpenPct}% spinning`}
          </span>
        </div>
      </div>

      {/* Detailed Snowfall Breakdown */}
      <div className="snow-depth-grid">
        <div className="snow-stat">
          <span className="snow-stat__label">{lang === 'zh' ? '24h 新雪' : '24h Snow'}</span>
          <span className={`snow-stat__val ${resort.snow.snow24hCm > 0 ? 'is-highlight' : ''}`}>
            {formatSnow(resort.snow.snow24hCm, unit)}
          </span>
        </div>
        <div className="snow-stat">
          <span className="snow-stat__label">{lang === 'zh' ? '7日降雪' : '7-Day'}</span>
          <span className="snow-stat__val is-highlight">
            {formatSnow(resort.snow.snow7dCm, unit)}
          </span>
        </div>
        <div className="snow-stat">
          <span className="snow-stat__label">{lang === 'zh' ? '本季累计' : 'Season'}</span>
          <span className="snow-stat__val">{formatSnow(resort.snow.seasonCm, unit)}</span>
        </div>
        <div className="snow-stat">
          <span className="snow-stat__label">{lang === 'zh' ? '未来7日预报' : 'Next 7d Est.'}</span>
          <span className="snow-stat__val">
            +{formatSnow(resort.snow.forecast7dCm, unit)}
          </span>
        </div>
      </div>

      {/* Active Lifts + Live Alpine Weather + Patrol Snippet */}
      <div className="resort-card__body">
        {openLifts.length > 0 && (
          <div className="open-lifts-row">
            {openLifts.slice(0, 4).map((l) => (
              <span key={l.name} className="open-lift-tag">
                ● {l.name}
              </span>
            ))}
            {openLifts.length > 4 && (
              <span className="open-lift-tag">+{openLifts.length - 4}</span>
            )}
          </div>
        )}

        <div className="weather-mini-row">
          <div className="weather-mini-row__left">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Thermometer size={14} />
              <strong className="tabular">{formatTemp(resort.weather.tempCurrentC, unit)}</strong>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Wind size={14} />
              <span className="tabular">{formatWind(resort.weather.windKmh, unit)}</span>
            </span>
          </div>
          <span>{weatherDescription(resort.weather.weatherCode, lang)}</span>
        </div>

        {resort.notes && <p className="resort-card__note">{resort.notes}</p>}
      </div>

      <div className="resort-card__footer">
        <span className="updated-stamp">
          {lang === 'zh' ? `距班夫镇 ${resort.driveMinutesFromBanff} 分钟车程` : `Updated ${resort.lastUpdated}`}
        </span>
        <button
          id={`open-map-btn-${resort.id}`}
          type="button"
          className="cta-map-btn"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMap(resort.id);
          }}
        >
          <span>{lang === 'zh' ? '实时雪道地图' : 'Live Trail Map'}</span>
          <ArrowUpRight size={15} />
        </button>
      </div>
    </article>
  );
}
