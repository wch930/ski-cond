import { RefreshCw, Sun, Moon, Map as MapIcon } from 'lucide-react';
import type { Lang, ResortData, ThemeMode, UnitSystem } from '../types';

interface Props {
  resorts: ResortData[];
  selectedResortId: string | null;
  onSelectResort: (id: string | null) => void;
  unit: UnitSystem;
  onChangeUnit: (u: UnitSystem) => void;
  lang: Lang;
  onChangeLang: (l: Lang) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function TopNav({
  resorts,
  selectedResortId,
  onSelectResort,
  unit,
  onChangeUnit,
  lang,
  onChangeLang,
  theme,
  onToggleTheme,
  isRefreshing,
  onRefresh,
}: Props) {
  return (
    <header className="top-nav">
      <div className="top-nav__inner">
        <button
          id="nav-home-btn"
          type="button"
          className="brand-btn"
          onClick={() => onSelectResort(null)}
          title={lang === 'zh' ? '返回班夫雪场总览' : 'Back to Banff Overview'}
        >
          <span className="brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 64 64" fill="none">
              <path d="M8 48L25 18L36 36L44 24L56 48H8Z" fill="#F8FAFC" />
              <path d="M25 18L31.5 29L27 32L23 28.5L19 31L25 18Z" fill="#38BDF8" />
              <path d="M14 53H50" stroke="#F97316" strokeWidth="4.5" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-text">
            <span className="brand-title">POWDERLINE · 雪线</span>
            <span className="brand-sub">
              {lang === 'zh' ? 'Banff 班夫实时雪况与雪道图' : 'Banff Live Snow & Trail Maps'}
            </span>
          </span>
        </button>

        <nav className="nav-center" aria-label="Ski Resorts">
          <button
            id="nav-overview-pill"
            type="button"
            className={`resort-tab-pill ${selectedResortId === null ? 'is-active' : ''}`}
            onClick={() => onSelectResort(null)}
          >
            <MapIcon size={14} />
            <span>{lang === 'zh' ? '班夫总览' : 'Banff All (3)'}</span>
          </button>
          {resorts.map((r) => (
            <button
              key={r.id}
              id={`nav-resort-${r.id}`}
              type="button"
              className={`resort-tab-pill ${selectedResortId === r.id ? 'is-active' : ''}`}
              onClick={() => onSelectResort(r.id)}
            >
              <span>{lang === 'zh' ? r.nameZh.replace('滑雪场', '') : r.shortName}</span>
              <span className="resort-tab-pill__metric">
                {r.terrain.runsOpen}/{r.terrain.runsTotal}
              </span>
            </button>
          ))}
        </nav>

        <div className="nav-actions">
          <div className="segmented-toggle" role="group" aria-label="Unit system">
            <button
              id="unit-metric-btn"
              type="button"
              className={unit === 'metric' ? 'is-active' : ''}
              onClick={() => onChangeUnit('metric')}
            >
              cm / °C
            </button>
            <button
              id="unit-imperial-btn"
              type="button"
              className={unit === 'imperial' ? 'is-active' : ''}
              onClick={() => onChangeUnit('imperial')}
            >
              in / °F
            </button>
          </div>

          <div className="segmented-toggle" role="group" aria-label="Language">
            <button
              id="lang-zh-btn"
              type="button"
              className={lang === 'zh' ? 'is-active' : ''}
              onClick={() => onChangeLang('zh')}
            >
              中文
            </button>
            <button
              id="lang-en-btn"
              type="button"
              className={lang === 'en' ? 'is-active' : ''}
              onClick={() => onChangeLang('en')}
            >
              EN
            </button>
          </div>

          <button
            id="theme-toggle-btn"
            type="button"
            className="icon-btn"
            onClick={onToggleTheme}
            title={theme === 'day' ? '切换夜滑深色模式' : '切换冰川日间模式'}
          >
            {theme === 'day' ? <Moon size={15} /> : <Sun size={15} />}
          </button>

          <button
            id="refresh-live-btn"
            type="button"
            className="icon-btn"
            onClick={onRefresh}
            disabled={isRefreshing}
            title={lang === 'zh' ? '立即拉取雪场官方最新雪况' : 'Fetch live official snow report'}
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            <span>{lang === 'zh' ? (isRefreshing ? '同步中' : '实时刷新') : isRefreshing ? 'Syncing' : 'Refresh'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
