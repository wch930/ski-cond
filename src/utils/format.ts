import type { Difficulty, LiftItem, ResortData, TrailItem, UnitSystem, Lang } from '../types';

export function normKey(str: string): string {
  if (!str) return '';
  const raw = str
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/&#039;|['’`]/g, '');
  const stripped = raw
    .replace(
      /\b(quad|chairlift|chair|express|high speed|six pack|luxury|fixed grip|conveyor|carpet|gondola|platter|t-bar|the|ii|i)\b/g,
      ' '
    )
    .replace(/[^a-z0-9]+/g, '');
  if (stripped.length >= 2) return stripped;
  return raw.replace(/\b(the|ii|i)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
}

export function formatSnow(cm: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    const inches = cm / 2.54;
    const rounded = inches < 10 ? Math.round(inches * 10) / 10 : Math.round(inches);
    return `${rounded}"`;
  }
  return `${Math.round(cm * 10) / 10} cm`;
}

export function formatTemp(c: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    return `${Math.round((c * 9) / 5 + 32)}°F`;
  }
  return `${Math.round(c * 10) / 10}°C`;
}

export function formatElev(m: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    return `${Math.round(m * 3.28084).toLocaleString()} ft`;
  }
  return `${m.toLocaleString()} m`;
}

export function formatLength(m: number, unit: UnitSystem): string {
  if (!m) return '';
  if (unit === 'imperial') {
    const ft = Math.round(m * 3.28084);
    return ft >= 5280 ? `${(ft / 5280).toFixed(1)} mi` : `${ft.toLocaleString()} ft`;
  }
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`;
}

export function formatWind(kmh: number, unit: UnitSystem): string {
  if (unit === 'imperial') {
    return `${Math.round(kmh * 0.621371)} mph`;
  }
  return `${Math.round(kmh)} km/h`;
}

export function difficultyLabel(diff: Difficulty, lang: Lang): string {
  const zh: Record<Difficulty, string> = {
    green: '绿道 · 初级',
    blue: '蓝道 · 中级',
    black: '黑道 · 高级',
    'double-black': '双黑 · 专家',
  };
  const en: Record<Difficulty, string> = {
    green: 'Beginner',
    blue: 'Intermediate',
    black: 'Advanced',
    'double-black': 'Expert',
  };
  return lang === 'zh' ? zh[diff] : en[diff];
}

export function liftTypeLabel(liftType: string, lang: Lang): string {
  const t = (liftType || '').toLowerCase();
  if (t.includes('gondola')) return lang === 'zh' ? '箱式缆车 Gondola' : 'Gondola';
  if (t.includes('carpet') || t.includes('conveyor')) return lang === 'zh' ? '魔毯 Magic Carpet' : 'Magic Carpet';
  if (t.includes('platter') || t.includes('t-bar') || t.includes('drag')) return lang === 'zh' ? '拖牵 T-Bar' : 'Surface Lift';
  return lang === 'zh' ? '吊椅缆车 Chairlift' : 'Chairlift';
}

export function weatherDescription(code: number, lang: Lang): string {
  if (code === 0) return lang === 'zh' ? '晴朗蓝天' : 'Bluebird Clear';
  if (code <= 2) return lang === 'zh' ? '晴间多云' : 'Partly Cloudy';
  if (code === 3) return lang === 'zh' ? '高山多云' : 'Overcast';
  if (code === 45 || code === 48) return lang === 'zh' ? '山间云雾' : 'Alpine Fog';
  if (code >= 71 && code <= 77) return lang === 'zh' ? '正在降雪' : 'Snowing';
  if (code === 85 || code === 86) return lang === 'zh' ? '阵雪粉雪' : 'Snow Showers';
  return lang === 'zh' ? '高山干冷' : 'Crisp Alpine';
}

const TRAIL_ALIAS_MAP: Record<string, string> = {
  banffavenue: 'banffave',
  boutrysbowl: 'bountysbowl',
  strawberrypark: 'strawberryterrainpark',
};

function canonicalTrailKey(k: string): string {
  const normalized = k.replace(/avenue/g, 'ave');
  return TRAIL_ALIAS_MAP[normalized] || normalized;
}

/**
 * Matches a GeoJSON feature (trail or lift) from OpenStreetMap against the live resort status list
 */
export function matchLiftStatus(
  osmProps: Record<string, any>,
  resort: ResortData
): LiftItem | undefined {
  const key = osmProps.normName || normKey(osmProps.name || '');
  const lType = String(osmProps.liftType || '').toLowerCase();

  // 1. Exact normName match first
  const exact = resort.lifts.find((l) => l.normName && l.normName === key);
  if (exact) return exact;

  // 2. Gondola match (e.g. Sunshine Gondola I & II <-> official "Gondola")
  if (lType === 'gondola') {
    const gondola = resort.lifts.find(
      (l) => l.liftType === 'gondola' || /gondola/i.test(l.name)
    );
    if (gondola) return gondola;
  }

  // 3. Controlled prefix match for chairlifts (e.g. "Tee Pee Town" <-> "Teepee Town")
  const compactKey = key.replace(/\s+/g, '');
  return resort.lifts.find((l) => {
    if (!l.normName || l.liftType === 'magic_carpet') return false;
    return l.normName === compactKey;
  });
}

export function matchTrailStatus(
  osmProps: Record<string, any>,
  resort: ResortData
): TrailItem | undefined {
  if (osmProps.isUnnamed) return undefined;
  const rawKey = osmProps.normName || normKey(osmProps.name || '');
  if (!rawKey) return undefined;

  const targetKey = canonicalTrailKey(rawKey);
  return resort.trails.find((t) => canonicalTrailKey(t.normName) === targetKey);
}
