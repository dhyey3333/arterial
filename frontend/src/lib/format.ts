import type { IncidentSeverity, IncidentType, SegmentLevel, Trend, AlertKind } from './contract';

const LOCALE = 'en-IN';
const TZ = 'Asia/Kolkata';

const intFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneFmt = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compactFmt = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: TZ,
});
const shortTimeFmt = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TZ,
});
const plural = new Intl.PluralRules(LOCALE);

const isNum = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export const DASH = '–';

export function fmtInt(v: number | null | undefined): string {
  return isNum(v) ? intFmt.format(v) : DASH;
}

export function fmtOne(v: number | null | undefined): string {
  return isNum(v) ? oneFmt.format(v) : DASH;
}

/** One decimal under 100, whole numbers above: 12.4, 1,180. */
export function fmtNum(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  return Math.abs(v) >= 100 ? intFmt.format(Math.round(v)) : oneFmt.format(v);
}

export function fmtCompact(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  return Math.abs(v) < 10_000 ? intFmt.format(v) : compactFmt.format(v);
}

export function fmtSpeed(v: number | null | undefined): string {
  return isNum(v) ? intFmt.format(Math.round(v)) : DASH;
}

export function fmtSigned(v: number | null | undefined, digits = 0): string {
  if (!isNum(v)) return DASH;
  // Round half away from zero, so a drop and a gain of the same size print the same.
  const f = 10 ** digits;
  const r = (Math.sign(v) * Math.round(Math.abs(v) * f)) / f;
  if (r === 0) return '0';
  const body = digits === 0 ? intFmt.format(Math.abs(r)) : oneFmt.format(Math.abs(r));
  return `${r > 0 ? '+' : '−'}${body}`;
}

export function fmtPct(v: number | null | undefined, { fromRatio = false } = {}): string {
  if (!isNum(v)) return DASH;
  return `${intFmt.format(Math.round(fromRatio ? v * 100 : v))}%`;
}

export function fmtDistance(m: number | null | undefined): string {
  if (!isNum(m)) return DASH;
  if (m < 1000) return `${intFmt.format(Math.round(m / 10) * 10)} m`;
  return `${oneFmt.format(m / 1000)} km`;
}

export function fmtKm(m: number | null | undefined): string {
  return isNum(m) ? oneFmt.format(m / 1000) : DASH;
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (!isNum(seconds)) return DASH;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')} min` : `${h} h`;
}

export function fmtTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : timeFmt.format(d);
}

export function fmtShortTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : shortTimeFmt.format(d);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : dateTimeFmt.format(d);
}

export function fmtAgo(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso === null || iso === undefined) return DASH;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return DASH;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h} h ago`;
}

export function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

/** "1 vehicle", "412 vehicles". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${plural.select(n) === 'one' ? one : many}`;
}

export const LEVEL_LABEL: Record<SegmentLevel, string> = {
  free: 'Free flow',
  moderate: 'Moderate',
  heavy: 'Heavy',
  severe: 'Severe',
  no_data: 'No data',
};

export const TREND_LABEL: Record<Trend, string> = {
  improving: 'Improving',
  stable: 'Steady',
  worsening: 'Worsening',
};

export const INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  sudden_speed_drop: 'Sudden speed drop',
  abnormal_accumulation: 'Abnormal build-up',
  flow_breakdown: 'Flow breakdown',
  possible_blockage: 'Possible blockage',
  unusual_density: 'Unusual density',
};

export const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  emerging: 'Emerging',
  escalated: 'Escalated',
  sustained: 'Sustained',
  cleared: 'Cleared',
};

export const LEVEL_RANK: Record<SegmentLevel, number> = { no_data: -1, free: 0, moderate: 1, heavy: 2, severe: 3 };
export const SEVERITY_RANK: Record<IncidentSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
