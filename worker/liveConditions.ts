import { LAKE_LOUISE_TRAIL_CATALOG } from './lakelouiseCatalog.ts';
import { TORONTO_STATIC_CATALOGS } from './torontoCatalogs.ts';

export const ALLOWED_WEBCAM_HOSTS = new Set([
  'cameras.skibanff.com',
  'cams.skilouise.com',
  'banffnorquay.com',
  'www.banffnorquay.com',
  'mountstlouis.com',
  'www.mountstlouis.com',
  'i.ytimg.com',
  'gleneden.on.ca',
  'www.gleneden.on.ca',
]);

const MEMORY_TTL_MS = 5 * 60 * 1000;
let memCachedPayload: Record<string, unknown> | null = null;
let memCachedAt = 0;
let inflightPromise: Promise<Record<string, unknown>> | null = null;

export function normName(str: string): string {
  if (!str) return '';
  const raw = String(str)
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/&/g, 'and')
    .replace(/&#039;|['’`]/g, '');
  const stripped = raw
    .replace(
      /\b(\d+\s*person|quad|triple|chairlift|chair|express|xpress|high speed|six pack|luxury|fixed grip|conveyor|carpet|gondola|platter|t-bar|lift|the|ii|i)\b/g,
      ' '
    )
    .replace(/[^a-z0-9]+/g, '');
  if (stripped.length >= 2) return stripped;
  return raw.replace(/\b(the|ii|i)\b/g, ' ').replace(/[^a-z0-9]+/g, '');
}

function decodeEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&#039;|&apos;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#xB0;|&deg;|&#176;/gi, '°')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&#8722;|&minus;/g, '−')
    .replace(/&nbsp;|&#160;/g, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function xmlVal(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return decodeEntities(m[1]).trim();
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; PowderlineSkiConditions/1.0; +https://github.com/wch930/ski-cond)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

interface ResortBlockSummary {
  reportTime?: string | null;
  overnightCm: number;
  snow24hCm: number;
  snow7dCm: number;
  baseCm: number;
  seasonCm: number;
  runsOpen: number;
  runsTotal: number;
  liftsOpen: number;
  liftsTotal: number;
  highTempC: number;
}

async function fetchSkiBig3Summary() {
  const html = await fetchText('https://weather-api.skibig3.com/PrintableResortConditions', 7500);
  const fullText = stripTags(html);
  const timeMatch = fullText.match(
    /Daily Snow Report\s+([A-Za-z]+\s+\d+,\s+\d{4}\s+\d+:\d+\s*[AP]M)/i
  );
  const reportTime = timeMatch ? timeMatch[1] : null;

  const blocks: ResortBlockSummary[] = [];
  const regex =
    /OVERNIGHT\s+24 HOURS\s+7 DAYS\s+BASE\s+CUMULATIVE\s+(\d+)\s*cm\s*\/[^0-9]*(\d+)\s*cm\s*\/[^0-9]*(\d+)\s*cm\s*\/[^0-9]*(\d+)\s*cm\s*\/[^0-9]*(\d+)\s*cm\s*\/[\s\S]*?RUNS\s+LIFTS\s+TODAY'S HIGH\s+(\d+)\s*\/\s*(\d+)\s+(\d+)\s*\/\s*(\d+)\s+(-?\d+)\s*°C/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(fullText)) !== null) {
    blocks.push({
      reportTime,
      overnightCm: Number(m[1]),
      snow24hCm: Number(m[2]),
      snow7dCm: Number(m[3]),
      baseCm: Number(m[4]),
      seasonCm: Number(m[5]),
      runsOpen: Number(m[6]),
      runsTotal: Number(m[7]),
      liftsOpen: Number(m[8]),
      liftsTotal: Number(m[9]),
      highTempC: Number(m[10]),
    });
  }
  return {
    reportTime,
    lakelouise: blocks[0] || null,
    norquay: blocks[1] || null,
    sunshine: blocks[2] || null,
  };
}

type Difficulty = 'green' | 'blue' | 'black' | 'double-black';

interface ParsedLift {
  name: string;
  normName: string;
  status: 'open' | 'closed';
  hours: string;
  liftType: string;
  zone: string;
}

interface ParsedTrail {
  name: string;
  normName: string;
  difficulty: Difficulty;
  groomed: boolean;
  status: 'open' | 'closed';
  zone: string;
}

async function fetchSunshineLive(sbSummary: ResortBlockSummary | null | undefined) {
  const [xmlRes, ltRes] = await Promise.allSettled([
    fetchText('https://xml.skibanff.com', 7500),
    fetchText('https://www.skibanff.com/the-mountain/mountain-report/lifts-trails-report', 9000),
  ]);

  const data = {
    overnightCm: sbSummary?.overnightCm ?? 0,
    snow24hCm: sbSummary?.snow24hCm ?? 0,
    snow48hCm: sbSummary?.snow24hCm ?? 0,
    snow7dCm: sbSummary?.snow7dCm ?? 18,
    baseCm: sbSummary?.baseCm ?? 28,
    upperBaseCm: sbSummary?.baseCm ?? 28,
    seasonCm: sbSummary?.seasonCm ?? 63,
    runsOpen: sbSummary?.runsOpen ?? 4,
    runsTotal: sbSummary?.runsTotal ?? 139,
    groomedCount: 0,
    liftsOpen: sbSummary?.liftsOpen ?? 3,
    liftsTotal: sbSummary?.liftsTotal ?? 12,
    tempCurrentC: sbSummary?.highTempC ?? -8,
    tempHighC: sbSummary?.highTempC ?? -8,
    weatherSummary: 'Partly Cloudy',
    notes: '',
    lastUpdated: sbSummary?.reportTime || new Date().toISOString(),
    dailyRunReportPdf: null as string | null,
    dailyGroomingPdf: null as string | null,
    lifts: [] as ParsedLift[],
    trails: [] as ParsedTrail[],
  };

  if (xmlRes.status === 'fulfilled') {
    const xml = xmlRes.value;
    const updated = xmlVal(xml, 'last_updated');
    if (updated) data.lastUpdated = `${updated} MT`;
    const tc = xmlVal(xml, 'temp-current');
    if (tc) data.tempCurrentC = parseFloat(tc);
    const th = xmlVal(xml, 'temp-high');
    if (th) data.tempHighC = parseFloat(th);
    const wn = xmlVal(xml, 'weather-note');
    if (wn) data.weatherSummary = wn;
    const s12 = xmlVal(xml, 'snowfall-12-hours-lower');
    if (s12) data.overnightCm = parseInt(s12, 10) || 0;
    const s24 = xmlVal(xml, 'snowfall-24-hours-lower');
    if (s24) data.snow24hCm = Math.max(parseInt(s24, 10) || 0, data.snow24hCm);
    const s7 = xmlVal(xml, 'snowfall-7-days-lower');
    if (s7) data.snow7dCm = parseInt(s7, 10) || data.snow7dCm;
    const stot = xmlVal(xml, 'snowfall-total-lower');
    if (stot) data.seasonCm = parseInt(stot, 10) || data.seasonCm;
    const base = xmlVal(xml, 'base-lower');
    if (base) {
      data.baseCm = parseInt(base, 10) || data.baseCm;
      data.upperBaseCm = data.baseCm;
    }
    const ro = xmlVal(xml, 'runs-open');
    if (ro) data.runsOpen = parseInt(ro, 10) || data.runsOpen;
    const rt = xmlVal(xml, 'runs-total');
    if (rt) data.runsTotal = parseInt(rt, 10) || data.runsTotal;
    const lo = xmlVal(xml, 'lifts-open');
    if (lo) data.liftsOpen = parseInt(lo, 10) || data.liftsOpen;
    const lt = xmlVal(xml, 'lifts-total');
    if (lt) data.liftsTotal = parseInt(lt, 10) || data.liftsTotal;
    const notes = xmlVal(xml, 'notes');
    if (notes) data.notes = notes.replace(/\s+/g, ' ').trim();
  }

  if (ltRes.status === 'fulfilled') {
    const html = ltRes.value;
    const lifts: ParsedLift[] = [];

    const liftParts = html.split(/class="node\s+node--type-lift\b/i).slice(1);
    for (const part of liftParts) {
      const chunk = part.slice(0, 1600);
      const hoursMatch = chunk.match(/class="[^"]*\bhours\b[^"]*">([\s\S]*?)<\/div>/i);
      const hours = hoursMatch ? stripTags(hoursMatch[1]) : '9:00am - 4:00pm';

      const titleMatch = chunk.match(/class="[^"]*\btitle\b[^"]*">([\s\S]*?)<\/div>\s*(?:<div class="[^"]*icon-|$)/i)
        || chunk.match(/class="[^"]*\btitle\b[^"]*">([\s\S]*?)<\/div>/i);
      let rawTitle = '';
      if (titleMatch) {
        // Remove nested hours div before stripping tags
        const withoutNested = titleMatch[1].replace(/<div[\s\S]*?<\/div>/gi, ' ');
        rawTitle = stripTags(withoutNested);
      }
      if (!rawTitle) continue;

      const statusMatch = chunk.match(/icon-status[\s\S]{0,200}?<span[^>]*>([\s\S]*?)<\/span>/i);
      const statusTxt = statusMatch ? stripTags(statusMatch[1]).toLowerCase() : '';
      const status = statusTxt.includes('open') ? 'open' : 'closed';

      let liftType = 'chair_lift';
      if (/gondola/i.test(rawTitle)) liftType = 'gondola';
      else if (/conveyor|carpet|mitey/i.test(rawTitle)) liftType = 'magic_carpet';

      lifts.push({
        name: rawTitle,
        normName: normName(rawTitle),
        status,
        hours,
        liftType,
        zone: 'Sunshine Village',
      });
    }

    const trails: ParsedTrail[] = [];
    let currentZone = 'Lookout & Village';
    const tokenRe =
      /<h[23][^>]*>([\s\S]*?)<\/h[23]>|class="node\s+node--type-trail\b([\s\S]*?)(?=class="node\s+node--type-|<h[23]\b|<footer\b|<\/main>)/gi;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(html)) !== null) {
      if (m[1] !== undefined) {
        const htxt = stripTags(m[1]);
        if (/Goat|Lookout|Standish|Divide|Delirium|Wild West/i.test(htxt) && htxt.length < 45) {
          currentZone = htxt;
        }
        continue;
      }
      const chunk = (m[2] || '').slice(0, 1800);
      const levelMatch = chunk.match(/icon-level[\s\S]{0,200}?<span[^>]*>([\s\S]*?)<\/span>/i);
      const condMatch = chunk.match(/icon-condition[\s\S]{0,200}?<span[^>]*>([\s\S]*?)<\/span>/i);
      const statusMatch = chunk.match(/icon-status[\s\S]{0,200}?<span[^>]*>([\s\S]*?)<\/span>/i);

      const titleBlockMatch = chunk.match(/class="[^"]*\btitle\b[^"]*">([\s\S]*?)<\/div>\s*(?:<div class="[^"]*icon-|$)/i);
      if (!titleBlockMatch) continue;
      const cleanedTitle = stripTags(titleBlockMatch[1].replace(/<div[\s\S]*?<\/div>/gi, ' '));
      if (!cleanedTitle) continue;

      const levelTxt = levelMatch ? stripTags(levelMatch[1]).toLowerCase() : '';
      const condTxt = condMatch ? stripTags(condMatch[1]).toLowerCase() : '';
      const statusTxt = statusMatch ? stripTags(statusMatch[1]).toLowerCase() : '';

      let difficulty: Difficulty = 'blue';
      if (levelTxt.includes('easiest')) difficulty = 'green';
      else if (levelTxt.includes('more difficult')) difficulty = 'blue';
      else if (levelTxt.includes('extreme') || levelTxt.includes('double')) difficulty = 'double-black';
      else if (levelTxt.includes('most difficult')) difficulty = 'black';

      const groomed = condTxt.includes('groomed');
      const status = statusTxt.includes('open') ? 'open' : 'closed';

      trails.push({
        name: cleanedTitle,
        normName: normName(cleanedTitle),
        difficulty,
        groomed,
        status,
        zone: currentZone,
      });
    }

    if (lifts.length > 0) data.lifts = lifts;
    if (trails.length > 0) {
      data.trails = trails;
      data.groomedCount =
        trails.filter((t) => t.groomed && t.status === 'open').length ||
        trails.filter((t) => t.groomed).length;
    }
  }

  return data;
}

async function fetchNorquayLive(sbSummary: ResortBlockSummary | null | undefined) {
  const data = {
    overnightCm: sbSummary?.overnightCm ?? 0,
    snow24hCm: sbSummary?.snow24hCm ?? 0,
    snow48hCm: sbSummary?.snow24hCm ?? 0,
    snow7dCm: sbSummary?.snow7dCm ?? 8,
    baseCm: 30,
    upperBaseCm: sbSummary?.baseCm ?? 35,
    seasonCm: sbSummary?.seasonCm ?? 31,
    runsOpen: sbSummary?.runsOpen ?? 2,
    runsTotal: sbSummary?.runsTotal ?? 80,
    groomedCount: 2,
    liftsOpen: sbSummary?.liftsOpen ?? 2,
    liftsTotal: sbSummary?.liftsTotal ?? 7,
    tempCurrentC: sbSummary?.highTempC ?? -7,
    tempHighC: sbSummary?.highTempC ?? -7,
    weatherSummary: 'Crisp Alpine Conditions',
    notes: '',
    lastUpdated: sbSummary?.reportTime || new Date().toISOString(),
    dailyRunReportPdf: null as string | null,
    dailyGroomingPdf: null as string | null,
    lifts: [] as ParsedLift[],
    trails: [] as ParsedTrail[],
  };

  try {
    const html = await fetchText('https://banffnorquay.com/conditions/', 9000);
    const text = stripTags(html);

    const mOvernight = text.match(/(\d+)\s*cm\s*Overnight/i);
    const m24 = text.match(/(\d+)\s*cm\s*Last 24 Hours/i);
    const m7 = text.match(/(\d+)\s*cm\s*Last 7 Days/i);
    const mLowerBase = text.match(/Snow Base\s*-\s*Lower Mountain\s*(\d+)\s*cm/i);
    const mUpperBase = text.match(/Snow Base\s*-\s*Upper Mountain\s*(\d+)\s*cm/i);
    const mSeason =
      text.match(/(\d+)\s*cm\s*Upper Mountain[\s\S]{0,30}?Year to Date/i) ||
      text.match(/(\d+)\s*cm\s*Year to Date Snowfall/i);
    if (mOvernight) data.overnightCm = Number(mOvernight[1]);
    if (m24) data.snow24hCm = Number(m24[1]);
    if (m7) data.snow7dCm = Math.max(Number(m7[1]), data.snow7dCm);
    if (mLowerBase) data.baseCm = Number(mLowerBase[1]);
    if (mUpperBase) data.upperBaseCm = Number(mUpperBase[1]);
    if (mSeason) data.seasonCm = Math.max(Number(mSeason[1]), data.seasonCm);

    const noteMatch = text.match(/(We have \d+ runs open[^.]+(?:\.[^.]+){0,3}\.)/i);
    if (noteMatch) data.notes = noteMatch[1].trim();

    const lifts: ParsedLift[] = [];
    const trails: ParsedTrail[] = [];

    const accordions = html.split(/jet-accordion__item\b/i).slice(1);
    for (const acc of accordions) {
      const labelMatch = acc.match(
        /class="jet-toggle__label-text">([\s\S]*?)<span\s+class="([^"]*\blift-status\b[^"]*)">([\s\S]*?)<\/span>\s*<\/div>/i
      );
      if (!labelMatch) continue;
      const liftName = stripTags(labelMatch[1]);
      if (!liftName) continue;
      const liftStatusCls = labelMatch[2] || '';
      const liftStatusTxt = stripTags(labelMatch[3]).toLowerCase();
      const isOpen = liftStatusCls.includes('is-open') || liftStatusTxt === 'open';

      let liftType = 'chair_lift';
      if (/carpet|tube|rundle/i.test(liftName)) liftType = 'magic_carpet';

      lifts.push({
        name: liftName,
        normName: normName(liftName),
        status: isOpen ? 'open' : 'closed',
        hours: '9:00am - 4:00pm',
        liftType,
        zone: liftName.replace(/\s*Chair.*$/i, ''),
      });

      const runRows = acc.split(/jet-listing-grid__item\b/i).slice(1);
      for (const row of runRows) {
        const nameMatch = row.match(
          /conditions-run-name[\s\S]{0,400}?jet-listing-dynamic-field__content[^>]*>([\s\S]*?)<\/div>/i
        );
        if (!nameMatch) continue;
        const rName = stripTags(nameMatch[1]);
        if (!rName) continue;

        const diffMatch = row.match(/class="([^"]*\brun-difficulty\b[^"]*)"/i);
        const diffCls = diffMatch ? diffMatch[1] : '';
        let difficulty: Difficulty = 'blue';
        if (/beginner|easy|green/i.test(diffCls)) difficulty = 'green';
        else if (/intermediate|blue/i.test(diffCls)) difficulty = 'blue';
        else if (/double|extreme|expert/i.test(diffCls)) difficulty = 'double-black';
        else if (/advanced|black/i.test(diffCls)) difficulty = 'black';

        const statusMatch = row.match(/class="([^"]*\brun-status\b[^"]*)"/i);
        const sCls = statusMatch ? statusMatch[1] : '';
        const rOpen = sCls.includes('status-open');

        const groomMatch = row.match(/class="([^"]*groom[^"]*)"/i);
        const gCls = groomMatch ? groomMatch[1] : '';
        const groomed =
          gCls.includes('groomed-yes') ||
          gCls.includes('status-open') ||
          gCls.includes('is-groomed') ||
          (rOpen && difficulty !== 'double-black' && !/chute|gully|glade|bowl/i.test(rName));

        trails.push({
          name: rName,
          normName: normName(rName),
          difficulty,
          groomed,
          status: rOpen ? 'open' : 'closed',
          zone: liftName,
        });
      }
    }

    if (lifts.length > 0) {
      data.lifts = lifts;
      data.liftsOpen = lifts.filter((l) => l.status === 'open').length || data.liftsOpen;
      data.liftsTotal = Math.max(lifts.length, data.liftsTotal);
    }
    if (trails.length > 0) {
      data.trails = trails;
      const openTrails = trails.filter((t) => t.status === 'open');
      if (openTrails.length > 0) data.runsOpen = openTrails.length;
      data.groomedCount = trails.filter((t) => t.status === 'open' && t.groomed).length;
    }
  } catch {
    // Keep SkiBig3 summary fallback
  }

  return data;
}

async function fetchLakeLouiseLive(sbSummary: ResortBlockSummary | null | undefined) {
  const data = {
    overnightCm: sbSummary?.overnightCm ?? 0,
    snow24hCm: sbSummary?.snow24hCm ?? 0,
    snow48hCm: 0,
    snow7dCm: sbSummary?.snow7dCm ?? 10,
    baseCm: 23,
    upperBaseCm: sbSummary?.baseCm ?? 28,
    seasonCm: sbSummary?.seasonCm ?? 44,
    runsOpen: sbSummary?.runsOpen ?? 6,
    runsTotal: sbSummary?.runsTotal ?? 164,
    groomedCount: 5,
    liftsOpen: sbSummary?.liftsOpen ?? 4,
    liftsTotal: sbSummary?.liftsTotal ?? 11,
    tempCurrentC: sbSummary?.highTempC ?? -11,
    tempHighC: sbSummary?.highTempC ?? -11,
    weatherSummary: 'Cold & Crisp Alpine Snow',
    notes: '',
    lastUpdated: sbSummary?.reportTime || new Date().toISOString(),
    dailyRunReportPdf: 'https://lamp10.skilouise.com/conditions/run_report.pdf',
    dailyGroomingPdf: 'https://lamp10.skilouise.com/conditions/grooming_report.pdf',
    lifts: [] as ParsedLift[],
    trails: [] as ParsedTrail[],
  };

  let narrative = '';
  try {
    const html = await fetchText('https://www.skilouise.com/snow-conditions/', 9000);
    const text = stripTags(html);

    const timeMatch = text.match(
      /Upper Mountain Snowfall\s*([A-Za-z]+\s+\d+,\s+\d{4}\s*\|\s*\d+:\d+\s*[ap]m)/i
    );
    if (timeMatch) data.lastUpdated = `${timeMatch[1].replace(/\s*\|\s*/, ' ')} MT`;

    const upperMatch = text.match(
      /Upper Mountain Snowfall[\s\S]{0,120}?(\d+)\s*cm[\s\S]{0,40}?Overnight\s*(\d+)\s*cm[\s\S]{0,40}?Last 24 Hours\s*(\d+)\s*cm[\s\S]{0,40}?Last 48 Hours\s*(\d+)\s*cm[\s\S]{0,40}?Last 7 Days\s*(\d+)\s*cm[\s\S]{0,40}?Base\s*(\d+)\s*cm[\s\S]{0,40}?This Season/i
    );
    if (upperMatch) {
      data.overnightCm = Number(upperMatch[1]);
      data.snow24hCm = Number(upperMatch[2]);
      data.snow48hCm = Number(upperMatch[3]);
      data.snow7dCm = Number(upperMatch[4]);
      data.upperBaseCm = Number(upperMatch[5]);
      data.seasonCm = Number(upperMatch[6]);
    }

    const midBaseMatch = text.match(
      /Mid Mountain Snowfall[\s\S]{0,260}?(\d+)\s*cm\s*[\d.]+\s*in\s*Base/i
    );
    if (midBaseMatch) data.baseCm = Number(midBaseMatch[1]);
    else data.baseCm = data.upperBaseCm;

    const mLifts = text.match(/(\d+)\s*Lifts Open/i);
    const mRuns = text.match(/(\d+)\s*Runs Open/i);
    const mGroom = text.match(/(\d+)\s*Groomed/i);
    if (mLifts) data.liftsOpen = Number(mLifts[1]);
    if (mRuns) data.runsOpen = Number(mRuns[1]);
    if (mGroom) data.groomedCount = Number(mGroom[1]);

    const statusNarrative = text.match(
      /LIFT\s*\/\s*RUN STATUS\s*([\s\S]{20,550}?)\s*\d+\s*Lifts Open/i
    );
    if (statusNarrative) {
      narrative = statusNarrative[1].trim();
      data.notes = narrative;
    }
  } catch {
    // Keep SkiBig3 summary fallback
  }

  const narLower = narrative.toLowerCase();
  const canonicalLifts = [
    { name: 'Grizzly Express Gondola', zone: 'Front Side', liftType: 'gondola', matchKeys: ['grizzly', 'gondola'] },
    { name: 'Glacier Express Quad', zone: 'Front Side', liftType: 'chair_lift', matchKeys: ['glacier'] },
    { name: 'Juniper Express Quad', zone: 'Front Side', liftType: 'chair_lift', matchKeys: ['juniper'] },
    { name: 'Sunny Side Magic Carpet', zone: 'Base & Learning', liftType: 'magic_carpet', matchKeys: ['magic carpet', 'sunny carpet'] },
    { name: 'Top of the World Express', zone: 'Front Side Upper', liftType: 'chair_lift', matchKeys: ['top of the world'] },
    { name: 'Summit Chair', zone: 'Summit & Back Bowls', liftType: 'chair_lift', matchKeys: ['summit chair'] },
    { name: 'Ptarmigan Quad', zone: 'Back Bowls & Ptarmigan', liftType: 'chair_lift', matchKeys: ['ptarmigan'] },
    { name: 'Paradise Triple', zone: 'Paradise Bowl', liftType: 'chair_lift', matchKeys: ['paradise'] },
    { name: 'Larch Express Quad', zone: 'Larch Area', liftType: 'chair_lift', matchKeys: ['larch'] },
    { name: 'Pipestone Express', zone: 'Front Side', liftType: 'chair_lift', matchKeys: ['pipestone'] },
    { name: "Richardson's Ridge Express", zone: "Richardson's Ridge", liftType: 'chair_lift', matchKeys: ['richardson'] },
  ];

  data.lifts = canonicalLifts.map((l, idx) => {
    const mentionedOpen = l.matchKeys.some((k) => narLower.includes(k));
    const isOpen = narrative ? mentionedOpen : idx < data.liftsOpen;
    return {
      name: l.name,
      normName: normName(l.name),
      status: isOpen ? 'open' : 'closed',
      hours: l.liftType === 'gondola' ? '8:30am - 4:00pm' : '9:00am - 4:00pm',
      liftType: l.liftType,
      zone: l.zone,
    };
  });

  const earlyCorridorPriority = [
    'deerrun',
    'lowerflight',
    'baldeagle',
    'wiwaxy',
    'easystreet',
    'juniper',
    'pika',
    'meadowlark',
  ];

  const allTrails: ParsedTrail[] = LAKE_LOUISE_TRAIL_CATALOG.map((t) => {
    const mentioned = Boolean(narLower && t.name.length >= 4 && narLower.includes(t.name.toLowerCase()));
    let zone = 'Front Side';
    if (/larch|wolverine|bobcat|lynx|lookout/i.test(t.name)) zone = 'Larch Area';
    else if (/paradise|boomerang|cornice|saddleback/i.test(t.name)) zone = 'Paradise & Back Bowls';
    else if (/gully|whitehorn|summit|east bowl|er3|er7/i.test(t.name)) zone = 'Back Bowls & Whitehorn';
    else if (/ptarmigan|007|cache/i.test(t.name)) zone = 'Ptarmigan';

    return {
      name: t.name,
      normName: t.normName,
      difficulty: t.difficulty,
      groomed: false,
      status: mentioned ? 'open' : 'closed',
      zone,
    };
  });

  let openNow = allTrails.filter((t) => t.status === 'open').length;
  for (const key of earlyCorridorPriority) {
    if (openNow >= data.runsOpen) break;
    const hit = allTrails.find((t) => t.status !== 'open' && t.normName === key);
    if (hit) {
      hit.status = 'open';
      openNow++;
    }
  }
  let groomAssigned = 0;
  for (const t of allTrails) {
    if (t.status === 'open' && groomAssigned < data.groomedCount) {
      t.groomed = true;
      groomAssigned++;
    }
  }

  allTrails.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  data.trails = allTrails;
  return data;
}

function buildStaticFallback(resortId: string, zoneName: string) {
  const cat = TORONTO_STATIC_CATALOGS[resortId];
  if (!cat) return { lifts: [] as ParsedLift[], trails: [] as ParsedTrail[] };
  return {
    lifts: cat.lifts.map((l) => ({
      name: l.name,
      normName: l.normName,
      status: 'closed' as const,
      hours: '9:00am - 9:00pm',
      liftType: l.liftType,
      zone: zoneName,
    })),
    trails: cat.trails.map((t) => ({
      name: t.name,
      normName: t.normName,
      difficulty: t.difficulty,
      groomed: false,
      status: 'closed' as const,
      zone: zoneName,
    })),
  };
}

function parseNumOrZero(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const m = val.match(/-?\d+(\.\d+)?/);
    if (m) return parseFloat(m[0]);
  }
  return 0;
}

/**
 * 1. Blue Mountain Resort (Collingwood, ON) — Official Alterra mtnpowder JSON feed
 */
async function fetchBlueMountainLive() {
  const fallback = buildStaticFallback('bluemountain', 'Blue Mountain');
  const data = {
    overnightCm: 0,
    snow24hCm: 0,
    snow48hCm: 0,
    snow7dCm: 0,
    baseCm: 0,
    upperBaseCm: 0,
    seasonCm: 0,
    runsOpen: 0,
    runsTotal: 43,
    groomedCount: 0,
    liftsOpen: 0,
    liftsTotal: 11,
    tempCurrentC: null as number | null,
    tempHighC: null as number | null,
    weatherSummary: 'Escarpment Conditions',
    notes: '',
    lastUpdated: new Date().toISOString(),
    dailyRunReportPdf: null as string | null,
    dailyGroomingPdf: null as string | null,
    lifts: fallback.lifts,
    trails: fallback.trails,
  };

  try {
    const raw = await fetchText('https://mtnpowder.com/feed?resortId=3', 8000);
    const feed = JSON.parse(raw);
    const sr = feed?.SnowReport || {};
    const baseArea = sr.BaseArea || {};
    const summitArea = sr.SummitArea || baseArea;

    if (feed?.LastUpdate) {
      data.lastUpdated = String(feed.LastUpdate).replace(/T/, ' ').slice(0, 16) + ' ET';
    }

    data.overnightCm = parseNumOrZero(summitArea.SinceLiftsClosedCm ?? baseArea.SinceLiftsClosedCm);
    data.snow24hCm = parseNumOrZero(summitArea.Last24HoursCm ?? baseArea.Last24HoursCm);
    data.snow48hCm = parseNumOrZero(summitArea.Last48HoursCm ?? baseArea.Last48HoursCm);
    data.snow7dCm = parseNumOrZero(summitArea.Last7DaysCm ?? baseArea.Last7DaysCm);
    data.baseCm = parseNumOrZero(baseArea.BaseCm ?? sr.SnowBaseRangeCM);
    data.upperBaseCm = Math.max(data.baseCm, parseNumOrZero(summitArea.BaseCm));
    data.seasonCm = parseNumOrZero(sr.SeasonTotalCm);

    if (typeof sr.TotalOpenTrails === 'number') data.runsOpen = sr.TotalOpenTrails;
    if (typeof sr.TotalTrails === 'number' && sr.TotalTrails > 0) data.runsTotal = sr.TotalTrails;
    if (typeof sr.GroomedTrails === 'number') data.groomedCount = sr.GroomedTrails;
    if (typeof sr.TotalOpenLifts === 'number') data.liftsOpen = sr.TotalOpenLifts;
    if (typeof sr.TotalLifts === 'number' && sr.TotalLifts > 0) data.liftsTotal = sr.TotalLifts;

    const ccBase = feed?.CurrentConditions?.Base || {};
    const ccSummit = feed?.CurrentConditions?.Summit || {};
    const tStr = ccSummit.TemperatureC !== '--' ? ccSummit.TemperatureC : ccBase.TemperatureC;
    if (tStr && tStr !== '--' && !Number.isNaN(parseFloat(tStr))) {
      data.tempCurrentC = parseFloat(tStr);
    }
    const thStr = ccBase.TemperatureHighC;
    if (thStr && thStr !== '--' && !Number.isNaN(parseFloat(thStr))) {
      data.tempHighC = parseFloat(thStr);
    }
    if (ccBase.Skies && ccBase.Skies !== '--') {
      data.weatherSummary = String(ccBase.Skies);
    }

    const reportTxt = [sr.Alert, sr.Report, sr.News]
      .filter((s) => typeof s === 'string' && s.trim() && s.trim() !== '--')
      .map((s) => stripTags(s))
      .join(' ');
    if (reportTxt) {
      data.notes = reportTxt.slice(0, 280);
    } else if (data.runsOpen === 0) {
      data.notes =
        'Winter snowmaking & grooming preparations underway on the Niagara Escarpment; check 7-day forecast for upcoming snowmaking windows.';
    }

    const lifts: ParsedLift[] = [];
    const trails: ParsedTrail[] = [];
    for (const area of feed?.MountainAreas || []) {
      const zone = area?.Name || 'Blue Mountain';
      for (const l of area?.Lifts || []) {
        const lName = String(l?.Name || '').trim();
        if (!lName) continue;
        const stEn = String(l?.StatusEnglish || l?.Status || '').toLowerCase();
        const isOpen = stEn === 'open' || (stEn.includes('open') && !stEn.includes('closed'));
        const icon = String(l?.LiftIcon || l?.LiftType || '').toLowerCase();
        let liftType = 'chair_lift';
        if (icon.includes('carpet') || icon.includes('conveyor') || /ripper|explorer|rider|undergrad/i.test(lName)) {
          liftType = 'magic_carpet';
        } else if (icon.includes('gondola')) {
          liftType = 'gondola';
        }
        lifts.push({
          name: lName,
          normName: normName(lName),
          status: isOpen ? 'open' : 'closed',
          hours: l?.NightHours && l.NightHours !== '--' ? '9:00am - 9:00pm' : '9:00am - 4:30pm',
          liftType,
          zone,
        });
      }

      for (const t of area?.Trails || []) {
        const rawDiff = String(t?.Difficulty || '');
        if (rawDiff === 'Snowshoe' || rawDiff === 'Hiking' || t?.Nordic === 'Yes') continue;
        const tName = String(t?.Name || '').trim();
        if (!tName) continue;

        let difficulty: Difficulty = 'blue';
        const icon = String(t?.TrailIcon || '');
        if (rawDiff === 'Easy' || icon === 'GreenCircle') difficulty = 'green';
        else if (rawDiff === 'Intermediate' || icon === 'BlueSquare' || icon === 'Park') difficulty = 'blue';
        else if (rawDiff === 'Extreme Terrain' || icon === 'ExtremeTerrain' || /double/i.test(icon)) {
          difficulty = 'double-black';
        } else if (rawDiff.includes('Difficult') || icon === 'BlackDiamond') {
          difficulty = 'black';
        }

        const stEn = String(t?.StatusEnglish || t?.Status || '').toLowerCase();
        const isOpen = stEn === 'open' || (stEn.includes('open') && !stEn.includes('closed'));
        const groomed = t?.Grooming === 'Yes';

        trails.push({
          name: tName,
          normName: normName(tName),
          difficulty,
          groomed,
          status: isOpen ? 'open' : 'closed',
          zone,
        });
      }
    }

    if (lifts.length > 0) data.lifts = lifts;
    if (trails.length > 0) {
      data.trails = trails;
      const openCnt = trails.filter((t) => t.status === 'open').length;
      if (openCnt > data.runsOpen) data.runsOpen = openCnt;
    }
  } catch {
    // Keep static catalog fallback
  }

  return data;
}

/**
 * 2. Mount St. Louis Moonstone (Coldwater, ON) — Official /status/ HTML report
 */
async function fetchMslmLive() {
  const fallback = buildStaticFallback('mslm', 'Mount St. Louis');
  const data = {
    overnightCm: 0,
    snow24hCm: 0,
    snow48hCm: 0,
    snow7dCm: 0,
    baseCm: 0,
    upperBaseCm: 0,
    seasonCm: 0,
    runsOpen: 0,
    runsTotal: 36,
    groomedCount: 0,
    liftsOpen: 0,
    liftsTotal: 12,
    tempCurrentC: null as number | null,
    tempHighC: null as number | null,
    weatherSummary: 'Ontario Snowbelt',
    notes: '',
    lastUpdated: 'Live Status Report',
    dailyRunReportPdf: null as string | null,
    dailyGroomingPdf: null as string | null,
    lifts: fallback.lifts,
    trails: fallback.trails,
  };

  try {
    const html = await fetchText('https://www.mountstlouis.com/status/', 8500);
    const text = stripTags(html);

    const mBase = text.match(/Base Depth:\s*(\d+)\s*cm/i);
    if (mBase) {
      data.baseCm = Number(mBase[1]);
      data.upperBaseCm = data.baseCm;
    }
    const m24 = text.match(/Natural Snow in Last 24 Hrs:\s*(\d+)\s*cm/i);
    if (m24) data.snow24hCm = Number(m24[1]);

    const mSlopes = text.match(/(\d+)\s*\/\s*(\d+)\s*Open Slopes/i);
    if (mSlopes) {
      data.runsOpen = Number(mSlopes[1]);
      data.runsTotal = Number(mSlopes[2]);
    }

    // Parse slope & lift tables (deduplicated across Day & Night tabs)
    const trailMap = new Map<string, ParsedTrail>();
    const liftMap = new Map<string, ParsedLift>();

    const secRe =
      /<h[2-5][^>]*>\s*(Mount St\.\s*Louis Slopes|Moonstone Slopes|Mount St\.\s*Louis Lifts|Moonstone Lifts)\s*<\/h[2-5]>\s*<table[^>]*>([\s\S]*?)<\/table>/gi;
    let m: RegExpExecArray | null;
    while ((m = secRe.exec(html)) !== null) {
      const heading = stripTags(m[1]);
      const tableHtml = m[2];
      const isLiftSec = /Lifts/i.test(heading);
      const zone = /Moonstone/i.test(heading) ? 'Moonstone' : 'Mount St. Louis';

      const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rm: RegExpExecArray | null;
      while ((rm = rowRe.exec(tableHtml)) !== null) {
        const row = rm[1];
        const titleM = row.match(/class\s*=\s*["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
        const statusM = row.match(/class\s*=\s*["'][^"']*\bstatus\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
        if (!titleM) continue;
        const itemName = stripTags(titleM[1]);
        if (!itemName) continue;
        const stTxt = statusM ? stripTags(statusM[1]).toLowerCase() : 'closed';
        const isOpen = stTxt.includes('open') && !stTxt.includes('closed');
        const nKey = normName(itemName);

        if (isLiftSec) {
          let liftType = 'chair_lift';
          if (/carpet|kinder/i.test(itemName)) liftType = 'magic_carpet';
          const prev = liftMap.get(nKey);
          liftMap.set(nKey, {
            name: itemName,
            normName: nKey,
            status: isOpen || prev?.status === 'open' ? 'open' : 'closed',
            hours: '9:00am - 9:00pm',
            liftType,
            zone,
          });
        } else {
          const diffM = row.match(/class\s*=\s*["']([^"']*\bdifficulty\b[^"']*fa-[^"']*)["']/i);
          const dCls = diffM ? diffM[1].toLowerCase() : '';
          let difficulty: Difficulty = 'blue';
          if (dCls.includes('easy')) difficulty = 'green';
          else if (dCls.includes('more-difficult')) difficulty = 'blue';
          else if (dCls.includes('extreme') || dCls.includes('double')) difficulty = 'double-black';
          else if (dCls.includes('most-difficult')) difficulty = 'black';

          const prev = trailMap.get(nKey);
          const openMerged = isOpen || prev?.status === 'open';
          trailMap.set(nKey, {
            name: itemName,
            normName: nKey,
            difficulty,
            groomed: openMerged && difficulty !== 'double-black',
            status: openMerged ? 'open' : 'closed',
            zone,
          });
        }
      }
    }

    if (liftMap.size > 0) {
      data.lifts = Array.from(liftMap.values());
      data.liftsTotal = data.lifts.length;
      data.liftsOpen = data.lifts.filter((l) => l.status === 'open').length;
    }
    if (trailMap.size > 0) {
      data.trails = Array.from(trailMap.values());
      data.runsTotal = Math.max(data.runsTotal, data.trails.length);
      const openRuns = data.trails.filter((t) => t.status === 'open').length;
      if (openRuns > 0) data.runsOpen = openRuns;
      data.groomedCount = data.trails.filter((t) => t.status === 'open' && t.groomed).length;
    }
    if (data.runsOpen === 0 && !data.notes) {
      data.notes =
        'Snowbelt snowmaking guns primed across Mount St. Louis & Moonstone; historically one of the earliest resorts to open in Ontario.';
    }
  } catch {
    // Keep static fallback
  }

  return data;
}

/**
 * 3. Horseshoe Valley Resort (Barrie, ON) — Official /ski-report-trails/ HTML report
 */
async function fetchHorseshoeLive() {
  const fallback = buildStaticFallback('horseshoe', 'Horseshoe Valley');
  const data = {
    overnightCm: 0,
    snow24hCm: 0,
    snow48hCm: 0,
    snow7dCm: 0,
    baseCm: 0,
    upperBaseCm: 0,
    seasonCm: 0,
    runsOpen: 0,
    runsTotal: 28,
    groomedCount: 0,
    liftsOpen: 0,
    liftsTotal: 6,
    tempCurrentC: null as number | null,
    tempHighC: null as number | null,
    weatherSummary: 'Barrie Snowbelt',
    notes: '',
    lastUpdated: 'Live Alpine Report',
    dailyRunReportPdf: null as string | null,
    dailyGroomingPdf: null as string | null,
    lifts: fallback.lifts,
    trails: fallback.trails,
  };

  try {
    const html = await fetchText('https://horseshoeresort.com/ski-report-trails/', 8500);

    const snow24M = html.match(
      /weather-entry\s+snowfall[\s\S]{0,260}?<span class="data">\s*(-?\d+(?:\.\d+)?)\s*<\/span>/i
    );
    if (snow24M) data.snow24hCm = Math.max(0, Math.round(parseFloat(snow24M[1])));

    const alpineSecM = html.match(/<section[^>]*report-alpine[^>]*>([\s\S]*?)<\/section>/i);
    if (alpineSecM) {
      const alp = alpineSecM[1];
      const baseM = alp.match(/<dt>\s*Base Depth\s*<\/dt>\s*<dd>\s*(\d+)/i);
      if (baseM) {
        data.baseCm = Number(baseM[1]);
        data.upperBaseCm = data.baseCm;
      }
      const hoursM = alp.match(/<dt>\s*Hours\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i);
      const condM = alp.match(/<dt>\s*Conditions\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/i);
      const hoursTxt = hoursM ? stripTags(hoursM[1]) : '';
      const condTxt = condM ? stripTags(condM[1]) : '';
      if (condTxt) data.notes = condTxt;
      else if (hoursTxt) data.notes = `Alpine Hours: ${hoursTxt}.`;

      const trails: ParsedTrail[] = [];
      const tableRe = /<table class="report-table">([\s\S]*?)<\/table>/gi;
      let tm: RegExpExecArray | null;
      while ((tm = tableRe.exec(alp)) !== null) {
        const tbl = tm[1];
        const thM = tbl.match(/<th class="run-level">([\s\S]*?)<\/th>/i);
        const thHtml = thM ? thM[1] : '';
        let difficulty: Difficulty = 'blue';
        let zone = 'Main Alpine';
        if (/Green circle|\bEasy\b/i.test(thHtml)) difficulty = 'green';
        else if (/Blue square/i.test(thHtml)) difficulty = 'blue';
        else if (/Black diamond|More Difficult/i.test(thHtml)) difficulty = 'black';
        else if (/Terrain Park|Orange Pill/i.test(thHtml)) {
          difficulty = 'blue';
          zone = 'Terrain Park';
        }

        const bodyM = tbl.match(/<tbody>([\s\S]*?)<\/tbody>/i);
        if (!bodyM) continue;
        const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
        let rm: RegExpExecArray | null;
        while ((rm = rowRe.exec(bodyM[1])) !== null) {
          const cells = Array.from(rm[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi));
          if (cells.length < 2) continue;
          const rName = stripTags(cells[0][2]);
          if (!rName) continue;
          const anyOpen = cells
            .slice(1)
            .some((c) => /\bopen\b/i.test(c[1]) && !/\bclosed\b/i.test(c[1]));
          trails.push({
            name: rName,
            normName: normName(rName),
            difficulty,
            groomed: anyOpen,
            status: anyOpen ? 'open' : 'closed',
            zone,
          });
        }
      }

      if (trails.length > 0) {
        data.trails = trails;
        data.runsTotal = trails.length;
        data.runsOpen = trails.filter((t) => t.status === 'open').length;
        data.groomedCount = trails.filter((t) => t.status === 'open' && t.groomed).length;
      }
    }

    const liftsSecM = html.match(/<section[^>]*report-lifts[^>]*>([\s\S]*?)<\/section>/i);
    if (liftsSecM) {
      const lifts: ParsedLift[] = [];
      const bodyM = liftsSecM[1].match(/<tbody>([\s\S]*?)<\/tbody>/i);
      if (bodyM) {
        const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
        let rm: RegExpExecArray | null;
        while ((rm = rowRe.exec(bodyM[1])) !== null) {
          const cells = Array.from(rm[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi));
          if (cells.length < 2) continue;
          const lName = stripTags(cells[0][2]);
          if (!lName) continue;
          const anyOpen = cells
            .slice(1)
            .some((c) => /\bopen\b/i.test(c[1]) && !/\bclosed\b/i.test(c[1]));
          let liftType = 'chair_lift';
          if (/carpet|snow school/i.test(lName)) liftType = 'magic_carpet';
          lifts.push({
            name: lName,
            normName: normName(lName),
            status: anyOpen ? 'open' : 'closed',
            hours: '9:00am - 9:00pm',
            liftType,
            zone: 'Horseshoe Valley',
          });
        }
      }
      if (lifts.length > 0) {
        data.lifts = lifts;
        data.liftsTotal = lifts.length;
        data.liftsOpen = lifts.filter((l) => l.status === 'open').length;
      }
    }
  } catch {
    // Keep static fallback
  }

  return data;
}

/**
 * 4. Glen Eden (Milton, ON) — Official /at-glen-eden/slope-conditions/ HTML report
 */
async function fetchGlenEdenLive() {
  const fallback = buildStaticFallback('gleneden', 'Glen Eden');
  const data = {
    overnightCm: 0,
    snow24hCm: 0,
    snow48hCm: 0,
    snow7dCm: 0,
    baseCm: 0,
    upperBaseCm: 0,
    seasonCm: 0,
    runsOpen: 0,
    runsTotal: 17,
    groomedCount: 0,
    liftsOpen: 0,
    liftsTotal: 6,
    tempCurrentC: null as number | null,
    tempHighC: null as number | null,
    weatherSummary: 'Halton Escarpment',
    notes: '',
    lastUpdated: 'Live Slope Report',
    dailyRunReportPdf: null as string | null,
    dailyGroomingPdf: null as string | null,
    lifts: fallback.lifts,
    trails: fallback.trails,
  };

  try {
    const html = await fetchText('https://gleneden.on.ca/at-glen-eden/slope-conditions/', 8500);

    const dateM = html.match(/<div class="today-date">([\s\S]*?)<\/div>/i);
    if (dateM) data.lastUpdated = stripTags(dateM[1]);

    const baseM = html.match(
      /<div class="label">\s*Base Depth\s*<\/div>\s*<div class="value">\s*(\d+)\s*cm/i
    );
    if (baseM) {
      data.baseCm = Number(baseM[1]);
      data.upperBaseCm = data.baseCm;
    }

    const snow24M = html.match(
      /<div class="label">\s*New Snow[^<]*<\/div>\s*<div class="value">\s*(\d+)\s*cm/i
    );
    if (snow24M) data.snow24hCm = Number(snow24M[1]);

    const runsPartM = html.match(
      /<h2 class="type-header">\s*Runs\s*<\/h2>([\s\S]*?)(?=<h2 class="type-header">\s*Lifts|<\/section>)/i
    );
    if (runsPartM) {
      const trails: ParsedTrail[] = [];
      let currentZone = 'Escarpment';
      const tokenRe =
        /<h3 class="location">([\s\S]*?)<\/h3>|<div class="lift-run\s+([^"]*)">([\s\S]*?)<div class="lift-run__meta-status">([\s\S]*?)<\/div>\s*<\/div>/gi;
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(runsPartM[1])) !== null) {
        if (m[1] !== undefined) {
          const z = stripTags(m[1]);
          if (z && z.toLowerCase() !== 'general') currentZone = z;
          continue;
        }
        const cls = (m[2] || '').toLowerCase();
        const inner = m[3] || '';
        const stTxt = stripTags(m[4] || '').toLowerCase();
        const titleM = inner.match(/<div class="title">([\s\S]*?)<\/div>/i);
        if (!titleM) continue;
        const rName = stripTags(titleM[1]);
        if (!rName) continue;

        let difficulty: Difficulty = 'blue';
        if (/icon-easy/i.test(inner)) difficulty = 'green';
        else if (/icon-intermediate/i.test(inner)) difficulty = 'blue';
        else if (/icon-double|icon-expert/i.test(inner)) difficulty = 'double-black';
        else if (/icon-difficult|icon-advanced/i.test(inner)) difficulty = 'black';
        else if (/icon-terrain/i.test(inner)) difficulty = 'blue';

        const isOpen = (cls.includes('open') || stTxt.includes('open')) && !stTxt.includes('closed');
        trails.push({
          name: rName,
          normName: normName(rName),
          difficulty,
          groomed: isOpen,
          status: isOpen ? 'open' : 'closed',
          zone: /icon-terrain/i.test(inner) ? 'Terrain Park' : currentZone,
        });
      }
      if (trails.length > 0) {
        data.trails = trails;
        data.runsTotal = trails.length;
        data.runsOpen = trails.filter((t) => t.status === 'open').length;
        data.groomedCount = trails.filter((t) => t.status === 'open' && t.groomed).length;
      }
    }

    const liftsPartM = html.match(
      /<h2 class="type-header">\s*Lifts\s*<\/h2>([\s\S]*?)(?=<h2 class="type-header"|<\/section>|<footer)/i
    );
    if (liftsPartM) {
      const lifts: ParsedLift[] = [];
      const itemRe =
        /<div class="lift-run\s+([^"]*)">([\s\S]*?)<div class="lift-run__meta-status">([\s\S]*?)<\/div>\s*<\/div>/gi;
      let lm: RegExpExecArray | null;
      while ((lm = itemRe.exec(liftsPartM[1])) !== null) {
        const cls = (lm[1] || '').toLowerCase();
        const inner = lm[2] || '';
        const stTxt = stripTags(lm[3] || '').toLowerCase();
        const titleM = inner.match(/<div class="title">([\s\S]*?)<\/div>/i);
        if (!titleM) continue;
        const lName = stripTags(titleM[1]);
        if (!lName) continue;
        const isOpen = (cls.includes('open') || stTxt.includes('open')) && !stTxt.includes('closed');
        const liftType = /carpet/i.test(lName) ? 'magic_carpet' : 'chair_lift';
        lifts.push({
          name: lName,
          normName: normName(lName),
          status: isOpen ? 'open' : 'closed',
          hours: '8:30am - 9:30pm',
          liftType,
          zone: 'Glen Eden',
        });
      }
      if (lifts.length > 0) {
        data.lifts = lifts;
        data.liftsTotal = lifts.length;
        data.liftsOpen = lifts.filter((l) => l.status === 'open').length;
      }
    }

    if (data.runsOpen === 0 && !data.notes) {
      data.notes =
        'Closest ski hills to West GTA in Kelso Conservation Area (Milton); night skiing runs until 9:30pm once winter snowmaking begins.';
    }
  } catch {
    // Keep static fallback
  }

  return data;
}

function parseMeteoEntry(j: any, summitElevationM: number, baseElevationM: number) {
  if (!j) return null;
  const cur = j.current || {};
  const daily = j.daily || {};
  const days = (daily.time || []).map((date: string, idx: number) => ({
    date,
    weatherCode: daily.weather_code?.[idx] ?? 0,
    tempMaxC: Math.round(daily.temperature_2m_max?.[idx] ?? -5),
    tempMinC: Math.round(daily.temperature_2m_min?.[idx] ?? -12),
    snowCm: Math.round((daily.snowfall_sum?.[idx] ?? 0) * 10) / 10,
    windMaxKmh: Math.round(daily.wind_speed_10m_max?.[idx] ?? 15),
  }));
  const forecast7dSnowCm =
    Math.round(days.reduce((acc: number, d: { snowCm: number }) => acc + d.snowCm, 0) * 10) / 10;
  const elevDiffKm = Math.max(0, (summitElevationM - baseElevationM) / 1000);
  const summitTempC =
    typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m * 10) / 10 : null;
  const baseTempC =
    summitTempC !== null ? Math.round((summitTempC + elevDiffKm * 6.0) * 10) / 10 : null;

  return {
    summitTempC,
    baseTempC,
    feelsLikeC:
      typeof cur.apparent_temperature === 'number' ? Math.round(cur.apparent_temperature) : null,
    windKmh: typeof cur.wind_speed_10m === 'number' ? Math.round(cur.wind_speed_10m) : 12,
    windGustKmh: typeof cur.wind_gusts_10m === 'number' ? Math.round(cur.wind_gusts_10m) : 22,
    weatherCode: cur.weather_code ?? 2,
    forecast7dSnowCm,
    daily: days,
  };
}

/**
 * Single batched HTTP subrequest to Open-Meteo for all 7 resorts across Banff & Greater Toronto!
 */
async function fetchBatchedAlpineWeather() {
  const url =
    'https://api.open-meteo.com/v1/forecast?' +
    'latitude=51.079,51.444,51.203,44.502,44.625,44.548,43.504&' +
    'longitude=-115.782,-116.162,-115.601,-80.316,-79.668,-79.674,-79.943&' +
    'elevation=2400,2450,2050,450,395,405,305&' +
    'current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m&' +
    'daily=weather_code,temperature_2m_max,temperature_2m_min,snowfall_sum,wind_speed_10m_max&' +
    'timezone=auto&forecast_days=7';
  const txt = await fetchText(url, 7000);
  const arr = JSON.parse(txt);
  const list = Array.isArray(arr) ? arr : [arr];
  return {
    sunshine: parseMeteoEntry(list[0], 2400, 1660),
    lakelouise: parseMeteoEntry(list[1], 2450, 1646),
    norquay: parseMeteoEntry(list[2], 2050, 1630),
    bluemountain: parseMeteoEntry(list[3], 450, 230),
    mslm: parseMeteoEntry(list[4], 395, 227),
    horseshoe: parseMeteoEntry(list[5], 405, 311),
    gleneden: parseMeteoEntry(list[6], 305, 232),
  };
}

const RESORT_META = [
  {
    id: 'sunshine',
    regionId: 'banff',
    name: 'Banff Sunshine Village',
    nameZh: '班夫阳光村滑雪场',
    shortName: 'Sunshine Village',
    tagline: '加拿大全天然粉雪标杆 · 横跨大陆分水岭三座雪峰',
    taglineEn: '100% Natural Rocky Mountain Powder across 3 Peaks on the Continental Divide',
    coordinates: [-115.782, 51.079],
    mapViewport: { center: [-115.781, 51.084], zoom: 13.4, pitch: 48, bearing: -145 },
    elevationBaseM: 1660,
    elevationSummitM: 2730,
    verticalDropM: 1070,
    skiableAcres: 3358,
    distanceFromBanffKm: 15,
    driveMinutesFromBanff: 18,
    hubName: 'Banff',
    hubNameZh: '班夫镇',
    distanceFromHubKm: 15,
    driveMinutesFromHub: 18,
    officialUrl: 'https://www.skibanff.com/the-mountain/mountain-report/current-conditions',
    geojsonUrl: '/geojson/sunshine.geojson',
    webcams: [
      { id: 'ss-standish', title: 'Mount Standish 山顶视角', url: 'https://cameras.skibanff.com/dynamic/10m' },
      { id: 'ss-lookout', title: 'Lookout Mountain 大陆分水岭', url: 'https://cameras.skibanff.com/dynamic/14m' },
      { id: 'ss-goats', title: "Goat's Eye 陡坡视角", url: 'https://cameras.skibanff.com/dynamic/15m' },
      { id: 'ss-village', title: 'Village 阳光村大本营', url: 'https://cameras.skibanff.com/dynamic/17m' },
    ],
  },
  {
    id: 'lakelouise',
    regionId: 'banff',
    name: 'Lake Louise Ski Resort',
    nameZh: '露易丝湖滑雪场',
    shortName: 'Lake Louise',
    tagline: '4,200 英亩四面环山巨型地形 · 世界级冰川全景雪场',
    taglineEn: '4,200 Acres across Four Mountain Faces with Iconic Glacier Views',
    coordinates: [-116.162, 51.444],
    mapViewport: { center: [-116.142, 51.456], zoom: 13.1, pitch: 48, bearing: 28 },
    elevationBaseM: 1646,
    elevationSummitM: 2637,
    verticalDropM: 991,
    skiableAcres: 4200,
    distanceFromBanffKm: 58,
    driveMinutesFromBanff: 42,
    hubName: 'Banff',
    hubNameZh: '班夫镇',
    distanceFromHubKm: 58,
    driveMinutesFromHub: 42,
    officialUrl: 'https://www.skilouise.com/snow-conditions/',
    geojsonUrl: '/geojson/lakelouise.geojson',
    webcams: [
      { id: 'll-base', title: 'Base Area 缆车大本营', url: 'https://cams.skilouise.com/cam2.jpg' },
      { id: 'll-glacier', title: 'Whitehorn / Glacier 山腰', url: 'https://cams.skilouise.com/cam3.jpg' },
      { id: 'll-ptarmigan', title: 'Ptarmigan 远眺露易丝湖谷地', url: 'https://cams.skilouise.com/cam6.jpg' },
      { id: 'll-larch', title: 'Larch / Temple 后山碗区', url: 'https://cams.skilouise.com/cam8.jpg' },
    ],
  },
  {
    id: 'norquay',
    regionId: 'banff',
    name: 'Mt. Norquay',
    nameZh: '诺奎山滑雪场',
    shortName: 'Mt. Norquay',
    tagline: '距班夫镇仅 10 分钟车程 · 传奇陡坡与班夫唯一夜滑',
    taglineEn: 'Banff Town’s Backyard Hill · 10 Minutes from Downtown & Night Skiing',
    coordinates: [-115.601, 51.203],
    mapViewport: { center: [-115.603, 51.203], zoom: 14.3, pitch: 46, bearing: -110 },
    elevationBaseM: 1630,
    elevationSummitM: 2133,
    verticalDropM: 503,
    skiableAcres: 190,
    distanceFromBanffKm: 6,
    driveMinutesFromBanff: 10,
    hubName: 'Banff',
    hubNameZh: '班夫镇',
    distanceFromHubKm: 6,
    driveMinutesFromHub: 10,
    officialUrl: 'https://banffnorquay.com/conditions/',
    geojsonUrl: '/geojson/norquay.geojson',
    webcams: [
      { id: 'nq-cascade', title: 'Cascade 雪道实时画面', url: 'https://banffnorquay.com/webcam-images/winter/CascadeCam/cascade.jpg' },
      { id: 'nq-sundance', title: 'Sundance 初学者雪区', url: 'https://banffnorquay.com/webcam-images/winter/SundanceCam/sundance.jpg' },
      { id: 'nq-banff', title: '俯瞰班夫镇与朗德尔山', url: 'https://banffnorquay.com/webcam-images/winter/BanffCam/banffcam.jpg' },
      { id: 'nq-tube', title: 'Tube Park 雪圈公园', url: 'https://banffnorquay.com/webcam-images/winter/TubeParkCam/tubepark.jpg' },
    ],
  },
  {
    id: 'bluemountain',
    regionId: 'toronto',
    name: 'Blue Mountain Resort',
    nameZh: '蓝山滑雪度假村',
    shortName: 'Blue Mountain',
    tagline: '安省最大高山滑雪度假村 · 尼亚加拉断崖 43 条雪道与全山夜滑',
    taglineEn: 'Ontario’s Largest Mountain Resort · 43 Trails & Night Skiing on Georgian Bay',
    coordinates: [-80.316, 44.501],
    mapViewport: { center: [-80.316, 44.500], zoom: 14.0, pitch: 46, bearing: -125 },
    elevationBaseM: 230,
    elevationSummitM: 450,
    verticalDropM: 220,
    skiableAcres: 365,
    distanceFromBanffKm: 158,
    driveMinutesFromBanff: 115,
    hubName: 'Toronto',
    hubNameZh: '多伦多',
    distanceFromHubKm: 158,
    driveMinutesFromHub: 115,
    officialUrl: 'https://www.bluemountain.ca/mountain/mountain-report',
    geojsonUrl: '/geojson/bluemountain.geojson',
    webcams: [
      {
        id: 'bm-village',
        title: 'Village Base 蓝山度假村大本营',
        url: 'https://i.ytimg.com/vi/52ar9bJWTIA/hqdefault.jpg',
        linkUrl: 'https://www.youtube.com/watch?v=52ar9bJWTIA',
      },
      {
        id: 'bm-south',
        title: 'South Base 南坡大本营',
        url: 'https://i.ytimg.com/vi/fVzgIfHAG3U/hqdefault.jpg',
        linkUrl: 'https://www.youtube.com/watch?v=fVzgIfHAG3U',
      },
      {
        id: 'bm-valley',
        title: 'Valley Express 谷底高速缆车',
        url: 'https://i.ytimg.com/vi/yYxZrTBne3I/hqdefault.jpg',
        linkUrl: 'https://www.youtube.com/watch?v=yYxZrTBne3I',
      },
      {
        id: 'bm-calamity',
        title: 'Calamity Lane 断崖陡坡视角',
        url: 'https://i.ytimg.com/vi/ezyjNLLIUh0/hqdefault.jpg',
        linkUrl: 'https://www.youtube.com/watch?v=ezyjNLLIUh0',
      },
    ],
  },
  {
    id: 'mslm',
    regionId: 'toronto',
    name: 'Mount St. Louis Moonstone',
    nameZh: '圣路易斯月石山滑雪场',
    shortName: 'Mt. St. Louis',
    tagline: '安省粉雪带口碑王牌 · 高速 8 人加热吊椅与顶级地形公园',
    taglineEn: 'Ontario Snowbelt Favorite · 8-Pack Heated Express Chair & Premier Terrain Parks',
    coordinates: [-79.669, 44.625],
    mapViewport: { center: [-79.6685, 44.626], zoom: 14.5, pitch: 46, bearing: -60 },
    elevationBaseM: 227,
    elevationSummitM: 395,
    verticalDropM: 168,
    skiableAcres: 170,
    distanceFromBanffKm: 132,
    driveMinutesFromBanff: 80,
    hubName: 'Toronto',
    hubNameZh: '多伦多',
    distanceFromHubKm: 132,
    driveMinutesFromHub: 80,
    officialUrl: 'https://www.mountstlouis.com/status/',
    geojsonUrl: '/geojson/mslm.geojson',
    webcams: [
      { id: 'mslm-base', title: 'St. Louis Base 圣路易斯大本营', url: 'https://mountstlouis.com/webcams-upload/mslm-base/image-1.jpg' },
      { id: 'mslm-moonstone', title: 'Moonstone Base 月石大本营', url: 'https://mountstlouis.com/webcams-upload/moonstone-base/image-1.jpg' },
      { id: 'mslm-adv', title: 'Adventure 8 高速八人缆车山顶', url: 'https://mountstlouis.com/webcams-upload/adventure-top/image-1.jpg' },
      { id: 'mslm-park', title: 'Outback / Junkyard 地形公园', url: 'https://mountstlouis.com/webcams-upload/junkyard/image-1.jpg' },
    ],
  },
  {
    id: 'horseshoe',
    regionId: 'toronto',
    name: 'Horseshoe Valley Resort',
    nameZh: '马蹄谷滑雪度假村',
    shortName: 'Horseshoe Valley',
    tagline: '距多伦多仅 1 小时车程 · 巴里雪带家庭友好雪道与夜滑胜地',
    taglineEn: '1 Hour North of Toronto · Barrie Snowbelt Groomers, Glades & Night Skiing',
    coordinates: [-79.674, 44.548],
    mapViewport: { center: [-79.6738, 44.5475], zoom: 14.9, pitch: 45, bearing: 155 },
    elevationBaseM: 311,
    elevationSummitM: 405,
    verticalDropM: 94,
    skiableAcres: 100,
    distanceFromBanffKm: 112,
    driveMinutesFromBanff: 68,
    hubName: 'Toronto',
    hubNameZh: '多伦多',
    distanceFromHubKm: 112,
    driveMinutesFromHub: 68,
    officialUrl: 'https://horseshoeresort.com/ski-report-trails/',
    geojsonUrl: '/geojson/horseshoe.geojson',
    webcams: [
      {
        id: 'hs-chalet',
        title: 'Main Chalet 主木屋与雪坡直播',
        url: 'https://i.ytimg.com/vi/B2EggpbHHhQ/hqdefault.jpg',
        linkUrl: 'https://www.youtube.com/watch?v=B2EggpbHHhQ',
      },
      {
        id: 'hs-alpine',
        title: 'Alpine Slopes 雪道实时直播',
        url: 'https://i.ytimg.com/vi/RnvgDV96v-Q/hqdefault.jpg',
        linkUrl: 'https://www.youtube.com/live/RnvgDV96v-Q',
      },
    ],
  },
  {
    id: 'gleneden',
    regionId: 'toronto',
    name: 'Glen Eden',
    nameZh: '格伦伊登滑雪场',
    shortName: 'Glen Eden',
    tagline: '大多伦多西区最近雪场（Milton）· 40 分钟直达下班夜滑首选',
    taglineEn: 'Closest Hills to West GTA in Milton · 40-Min Commute for After-Work Night Laps',
    coordinates: [-79.943, 43.504],
    mapViewport: { center: [-79.9425, 43.5042], zoom: 15.2, pitch: 45, bearing: -20 },
    elevationBaseM: 232,
    elevationSummitM: 305,
    verticalDropM: 73,
    skiableAcres: 45,
    distanceFromBanffKm: 62,
    driveMinutesFromBanff: 42,
    hubName: 'Toronto',
    hubNameZh: '多伦多',
    distanceFromHubKm: 62,
    driveMinutesFromHub: 42,
    officialUrl: 'https://gleneden.on.ca/at-glen-eden/slope-conditions/',
    geojsonUrl: '/geojson/gleneden.geojson',
    webcams: [],
  },
] as const;

export async function buildLivePayload() {
  const sbSummary = await fetchSkiBig3Summary().catch(() => null);

  const [
    sunshineCond,
    louiseCond,
    norquayCond,
    blueCond,
    mslmCond,
    horseshoeCond,
    glenedenCond,
    meteo,
  ] = await Promise.all([
    fetchSunshineLive(sbSummary?.sunshine),
    fetchLakeLouiseLive(sbSummary?.lakelouise),
    fetchNorquayLive(sbSummary?.norquay),
    fetchBlueMountainLive(),
    fetchMslmLive(),
    fetchHorseshoeLive(),
    fetchGlenEdenLive(),
    fetchBatchedAlpineWeather().catch(() => ({
      sunshine: null,
      lakelouise: null,
      norquay: null,
      bluemountain: null,
      mslm: null,
      horseshoe: null,
      gleneden: null,
    })),
  ]);

  const condById = {
    sunshine: { cond: sunshineCond, weather: meteo.sunshine },
    lakelouise: { cond: louiseCond, weather: meteo.lakelouise },
    norquay: { cond: norquayCond, weather: meteo.norquay },
    bluemountain: { cond: blueCond, weather: meteo.bluemountain },
    mslm: { cond: mslmCond, weather: meteo.mslm },
    horseshoe: { cond: horseshoeCond, weather: meteo.horseshoe },
    gleneden: { cond: glenedenCond, weather: meteo.gleneden },
  };

  const resorts = RESORT_META.map((meta) => {
    const { cond, weather } = condById[meta.id];
    const isOpen = cond.liftsOpen > 0 || cond.runsOpen > 0;
    const curTemp = cond.tempCurrentC ?? weather?.summitTempC ?? weather?.baseTempC ?? -4;
    const highTemp =
      cond.tempHighC ?? weather?.daily?.[0]?.tempMaxC ?? Math.round(curTemp + 2);
    return {
      ...meta,
      status: isOpen ? 'open' : 'closed',
      snow: {
        overnightCm: cond.overnightCm,
        snow24hCm: cond.snow24hCm,
        snow48hCm: cond.snow48hCm ?? cond.snow24hCm,
        snow7dCm: cond.snow7dCm,
        baseCm: cond.baseCm,
        upperBaseCm: cond.upperBaseCm ?? cond.baseCm,
        seasonCm: cond.seasonCm,
        forecast7dCm: weather?.forecast7dSnowCm ?? 0,
      },
      terrain: {
        runsOpen: cond.runsOpen,
        runsTotal: cond.runsTotal,
        runsOpenPct: Math.round((cond.runsOpen / Math.max(1, cond.runsTotal)) * 100),
        groomedCount: cond.groomedCount,
        liftsOpen: cond.liftsOpen,
        liftsTotal: cond.liftsTotal,
        liftsOpenPct: Math.round((cond.liftsOpen / Math.max(1, cond.liftsTotal)) * 100),
      },
      weather: {
        tempCurrentC: curTemp,
        tempSummitC: weather?.summitTempC ?? curTemp,
        tempBaseC: weather?.baseTempC ?? Math.round(curTemp + 2),
        tempHighC: highTemp,
        feelsLikeC: weather?.feelsLikeC ?? Math.round(curTemp - 4),
        windKmh: weather?.windKmh ?? 14,
        windGustKmh: weather?.windGustKmh ?? 25,
        weatherCode: weather?.weatherCode ?? 2,
        summary: cond.weatherSummary,
        dailyForecast: weather?.daily ?? [],
      },
      notes: cond.notes,
      lastUpdated: cond.lastUpdated,
      dailyRunReportPdf: cond.dailyRunReportPdf,
      dailyGroomingPdf: cond.dailyGroomingPdf,
      lifts: cond.lifts,
      trails: cond.trails,
    };
  });

  return {
    fetchedAt: new Date().toISOString(),
    source: 'live-official-feeds',
    regions: [
      {
        id: 'banff',
        name: 'Banff National Park · SkiBig3',
        nameZh: '班夫国家公园 · SkiBig3',
        shortName: 'Banff',
        shortNameZh: '班夫',
        province: 'Alberta, Canada',
        active: true,
        center: [-115.86, 51.25],
        zoom: 9.15,
        hubLabel: '📍 Banff Town 班夫镇',
        hubCoordinates: [-115.5708, 51.1784],
      },
      {
        id: 'toronto',
        name: 'Greater Toronto · Southern Ontario',
        nameZh: '多伦多周边 · 安省雪场',
        shortName: 'Toronto Area',
        shortNameZh: '多伦多周边',
        province: 'Ontario, Canada',
        active: true,
        center: [-79.88, 44.12],
        zoom: 7.45,
        hubLabel: '📍 Toronto 多伦多',
        hubCoordinates: [-79.3832, 43.6532],
      },
      {
        id: 'quebec-laurentians',
        name: 'Mont-Tremblant & Quebec',
        nameZh: '翠湖山庄 & 魁北克 (即将接入)',
        province: 'Quebec, Canada',
        active: false,
      },
      {
        id: 'powder-highway',
        name: 'BC Powder Highway',
        nameZh: 'BC 粉雪公路 · Whistler / Revy (即将接入)',
        province: 'British Columbia, Canada',
        active: false,
      },
    ],
    resorts,
  };
}

export async function getLiveConditions({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && memCachedPayload && now - memCachedAt < MEMORY_TTL_MS) {
    return { ...memCachedPayload, cacheHit: true };
  }
  if (!inflightPromise) {
    inflightPromise = buildLivePayload()
      .then((res) => {
        memCachedPayload = res;
        memCachedAt = Date.now();
        return res;
      })
      .catch((err) => {
        if (memCachedPayload) return { ...memCachedPayload, stale: true };
        throw err;
      })
      .finally(() => {
        inflightPromise = null;
      });
  }
  return inflightPromise;
}
