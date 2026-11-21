export type UnitSystem = 'metric' | 'imperial';
export type Lang = 'zh' | 'en';
export type ThemeMode = 'day' | 'dusk';

export type Difficulty = 'green' | 'blue' | 'black' | 'double-black';

export interface LiftItem {
  name: string;
  normName: string;
  status: 'open' | 'closed';
  hours: string;
  liftType: string;
  zone: string;
}

export interface TrailItem {
  name: string;
  normName: string;
  difficulty: Difficulty;
  groomed: boolean;
  status: 'open' | 'closed';
  zone: string;
}

export interface DailyForecast {
  date: string;
  weatherCode: number;
  tempMaxC: number;
  tempMinC: number;
  snowCm: number;
  windMaxKmh: number;
}

export interface WebcamItem {
  id: string;
  title: string;
  url: string;
}

export interface ResortData {
  id: string;
  regionId: string;
  name: string;
  nameZh: string;
  shortName: string;
  tagline: string;
  taglineEn: string;
  coordinates: [number, number];
  mapViewport: {
    center: [number, number];
    zoom: number;
    pitch: number;
    bearing: number;
  };
  elevationBaseM: number;
  elevationSummitM: number;
  verticalDropM: number;
  skiableAcres: number;
  distanceFromBanffKm: number;
  driveMinutesFromBanff: number;
  officialUrl: string;
  geojsonUrl: string;
  status: 'open' | 'closed';
  snow: {
    overnightCm: number;
    snow24hCm: number;
    snow48hCm: number;
    snow7dCm: number;
    baseCm: number;
    upperBaseCm: number;
    seasonCm: number;
    forecast7dCm: number;
  };
  terrain: {
    runsOpen: number;
    runsTotal: number;
    runsOpenPct: number;
    groomedCount: number;
    liftsOpen: number;
    liftsTotal: number;
    liftsOpenPct: number;
  };
  weather: {
    tempCurrentC: number;
    tempSummitC: number;
    tempBaseC: number;
    tempHighC: number;
    feelsLikeC: number;
    windKmh: number;
    windGustKmh: number;
    weatherCode: number;
    summary: string;
    dailyForecast: DailyForecast[];
  };
  notes: string;
  lastUpdated: string;
  dailyRunReportPdf?: string | null;
  dailyGroomingPdf?: string | null;
  webcams: WebcamItem[];
  lifts: LiftItem[];
  trails: TrailItem[];
}

export interface RegionInfo {
  id: string;
  name: string;
  nameZh: string;
  province: string;
  active: boolean;
  center?: [number, number];
  zoom?: number;
}

export interface ConditionsPayload {
  fetchedAt: string;
  source: string;
  cacheHit?: boolean;
  stale?: boolean;
  regions: RegionInfo[];
  resorts: ResortData[];
}

export interface SelectedMapFeature {
  featureType: 'trail' | 'lift';
  name: string;
  normName: string;
  status: 'open' | 'closed';
  difficulty?: Difficulty;
  groomed?: boolean;
  gladed?: boolean;
  liftType?: string;
  hours?: string;
  zone?: string;
  lengthMeters?: number;
  coordinates?: [number, number];
}
