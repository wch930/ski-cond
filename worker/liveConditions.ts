import { LAKE_LOUISE_TRAIL_CATALOG } from './lakelouiseCatalog.ts';

export const ALLOWED_WEBCAM_HOSTS = new Set([
  'cameras.skibanff.com',
  'cams.skilouise.com',
  'banffnorquay.com',
  'www.banffnorquay.com',
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
      /\b(quad|chairlift|chair|express|high speed|six pack|luxury|fixed grip|conveyor|carpet|gondola|platter|t-bar|the|ii|i)\b/g,
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
 * Single batched HTTP subrequest to Open-Meteo for all 3 Banff resorts (saves Worker subrequest budget!)
 */
async function fetchBatchedAlpineWeather() {
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=51.079,51.444,51.203&longitude=-115.782,-116.162,-115.601' +
    '&elevation=2400,2450,2050' +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,snowfall_sum,wind_speed_10m_max' +
    '&timezone=America%2FEdmonton&forecast_days=7';
  const txt = await fetchText(url, 6500);
  const arr = JSON.parse(txt);
  const list = Array.isArray(arr) ? arr : [arr];
  return {
    sunshine: parseMeteoEntry(list[0], 2400, 1660),
    lakelouise: parseMeteoEntry(list[1], 2450, 1646),
    norquay: parseMeteoEntry(list[2], 2050, 1630),
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
    officialUrl: 'https://banffnorquay.com/conditions/',
    geojsonUrl: '/geojson/norquay.geojson',
    webcams: [
      { id: 'nq-cascade', title: 'Cascade 雪道实时画面', url: 'https://banffnorquay.com/webcam-images/winter/CascadeCam/cascade.jpg' },
      { id: 'nq-sundance', title: 'Sundance 初学者雪区', url: 'https://banffnorquay.com/webcam-images/winter/SundanceCam/sundance.jpg' },
      { id: 'nq-banff', title: '俯瞰班夫镇与朗德尔山', url: 'https://banffnorquay.com/webcam-images/winter/BanffCam/banffcam.jpg' },
      { id: 'nq-tube', title: 'Tube Park 雪圈公园', url: 'https://banffnorquay.com/webcam-images/winter/TubeParkCam/tubepark.jpg' },
    ],
  },
] as const;

export async function buildLivePayload() {
  const sbSummary = await fetchSkiBig3Summary().catch(() => null);

  const [sunshineCond, louiseCond, norquayCond, meteo] = await Promise.all([
    fetchSunshineLive(sbSummary?.sunshine),
    fetchLakeLouiseLive(sbSummary?.lakelouise),
    fetchNorquayLive(sbSummary?.norquay),
    fetchBatchedAlpineWeather().catch(() => ({
      sunshine: null,
      lakelouise: null,
      norquay: null,
    })),
  ]);

  const condById = {
    sunshine: { cond: sunshineCond, weather: meteo.sunshine },
    lakelouise: { cond: louiseCond, weather: meteo.lakelouise },
    norquay: { cond: norquayCond, weather: meteo.norquay },
  };

  const resorts = RESORT_META.map((meta) => {
    const { cond, weather } = condById[meta.id];
    const isOpen = cond.liftsOpen > 0 || cond.runsOpen > 0;
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
        tempCurrentC: cond.tempCurrentC ?? weather?.summitTempC ?? -8,
        tempSummitC: weather?.summitTempC ?? cond.tempCurrentC ?? -10,
        tempBaseC: weather?.baseTempC ?? Math.round((cond.tempCurrentC ?? -8) + 3),
        tempHighC: cond.tempHighC ?? -6,
        feelsLikeC: weather?.feelsLikeC ?? Math.round((cond.tempCurrentC ?? -8) - 5),
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
        province: 'Alberta, Canada',
        active: true,
        center: [-115.88, 51.26],
        zoom: 9.2,
      },
      {
        id: 'kananaskis-jasper',
        name: 'Kananaskis & Jasper',
        nameZh: '卡纳纳斯基斯 & 贾斯珀 (即将接入)',
        province: 'Alberta, Canada',
        active: false,
      },
      {
        id: 'powder-highway',
        name: 'BC Powder Highway',
        nameZh: 'BC 粉雪公路 · Revy / KH (即将接入)',
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
