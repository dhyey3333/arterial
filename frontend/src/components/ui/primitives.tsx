import { animate, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  CircleAlert,
  Copy,
  CircleCheck,
  CircleDashed,
  Info,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { HealthStatus, IncidentSeverity, SegmentLevel } from '../../lib/contract';
import { LEVEL_LABEL, SEVERITY_LABEL } from '../../lib/format';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

// ---------- Page head ----------

/** The page's own title row: an h1, one line on what the page answers, and its controls. */
export function PageHead({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="phead enter">
      <div>
        <h1 className="phead__title">{title}</h1>
        {lede && <p className="phead__lede">{lede}</p>}
      </div>
      {children && <div className="phead__aside">{children}</div>}
    </header>
  );
}

// ---------- Section: a title over a hairline, no box ----------

export function Section({
  title,
  meta,
  actions,
  children,
  className = '',
  enter,
  as: Tag = 'section',
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Entrance delay in ms; omit for no entrance. */
  enter?: number;
  as?: 'section' | 'div';
}) {
  const headingId = useId();
  return (
    <Tag
      className={`sect ${enter !== undefined ? 'enter' : ''} ${className}`}
      style={enter !== undefined ? ({ '--i': enter } as React.CSSProperties) : undefined}
      aria-labelledby={title ? headingId : undefined}
    >
      {(title || actions) && (
        <header className="sect__head">
          <div>
            {title && (
              <h2 className="sect__title" id={headingId}>
                {title}
              </h2>
            )}
            {meta && <p className="sect__meta">{meta}</p>}
          </div>
          {actions && <div className="sect__actions">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}

// ---------- Animated number ----------

/**
 * Tweens between values in 320 ms with a strong ease-out, writing straight to
 * the DOM so a stream of updates never re-renders the page. Reduced motion
 * snaps to the new value.
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number | null;
  format: (v: number | null) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(value);
  const shown = useRef<number | null>(value);
  const [initial] = useState(() => format(value));
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Start from what is on screen, so an update that lands mid-tween continues instead of jumping.
    const from = shown.current;
    prev.current = value;
    if (value === null || from === null || reduce || from === value) {
      shown.current = value;
      el.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.26,
      ease: EASE_OUT,
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = formatRef.current(v);
      },
    });
    return () => controls.stop();
  }, [value, reduce]);

  return (
    <span ref={ref} className={className}>
      {initial}
    </span>
  );
}

// ---------- Stat tile ----------

export function Stat({
  label,
  value,
  format,
  unit,
  note,
  tone,
  children,
}: {
  label: string;
  value: number | null;
  format: (v: number | null) => string;
  unit?: string;
  note?: ReactNode;
  tone?: 'default' | 'warn' | 'bad';
  children?: ReactNode;
}) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <p className="stat__label">{label}</p>
      <p className="stat__value">
        <AnimatedNumber value={value} format={format} />
        {unit && <span className="stat__unit">{unit}</span>}
      </p>
      {note && <p className="stat__note">{note}</p>}
      {children}
    </div>
  );
}

// ---------- Level and severity badges ----------

const LEVEL_ICON: Record<SegmentLevel, LucideIcon> = {
  free: CircleCheck,
  moderate: CircleAlert,
  heavy: TriangleAlert,
  severe: OctagonAlert,
  no_data: CircleDashed,
};

export function LevelBadge({ level, size = 'md', label }: { level: SegmentLevel; size?: 'sm' | 'md'; label?: string }) {
  const Icon = LEVEL_ICON[level];
  return (
    <span className={`badge badge--${size} badge--level-${level}`}>
      <Icon aria-hidden="true" size={size === 'sm' ? 12 : 14} strokeWidth={2.25} />
      <span>{label ?? LEVEL_LABEL[level]}</span>
    </span>
  );
}

const SEVERITY_ICON: Record<IncidentSeverity, LucideIcon> = {
  low: Info,
  medium: CircleAlert,
  high: TriangleAlert,
  critical: OctagonAlert,
};

export function SeverityBadge({ severity, size = 'md' }: { severity: IncidentSeverity; size?: 'sm' | 'md' }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className={`badge badge--${size} badge--sev-${severity}`}>
      <Icon aria-hidden="true" size={size === 'sm' ? 12 : 14} strokeWidth={2.25} />
      <span>{SEVERITY_LABEL[severity]}</span>
    </span>
  );
}

export function LevelSwatch({ level }: { level: SegmentLevel }) {
  return <span className={`swatch swatch--${level}`} aria-hidden="true" />;
}

// ---------- Health ----------

const HEALTH_LABEL: Record<HealthStatus, string> = { ok: 'Healthy', degraded: 'Degraded', down: 'Down', unknown: 'Unknown' };

export function Health({ status, label }: { status: HealthStatus; label?: string }) {
  return (
    <span className={`health health--${status}`}>
      <span className="health__dot" aria-hidden="true" />
      {label ?? HEALTH_LABEL[status]}
    </span>
  );
}

// ---------- Segmented control ----------

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: { value: T; label: string; extra?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const name = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const extras = options.map((o) => (typeof o.extra === 'object' ? '' : String(o.extra ?? ''))).join();
  useIndicator(
    rootRef,
    thumbRef,
    (active, thumb) => {
      if (!active) {
        thumb.style.opacity = '0';
        return;
      }
      thumb.style.opacity = '1';
      thumb.style.width = `${active.offsetWidth}px`;
      thumb.style.transform = `translateX(${active.offsetLeft}px)`;
    },
    [value, options.length, extras],
  );
  return (
    <div ref={rootRef} className={`segmented ${className}`} role="radiogroup" aria-label={label}>
      <span ref={thumbRef} className="segmented__thumb" aria-hidden="true" />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label key={String(o.value)} className={`segmented__option ${active ? 'is-active' : ''}`} data-active={active}>
            <input
              type="radio"
              className="visually-hidden"
              name={name}
              checked={active}
              onChange={() => onChange(o.value)}
            />
            <span className="segmented__text">
              {o.label}
              {o.extra}
            </span>
          </label>
        );
      })}
    </div>
  );
}

// ---------- States ----------

export function Notice({
  tone = 'neutral',
  title,
  children,
  action,
  icon: Icon = Info,
}: {
  tone?: 'neutral' | 'warn' | 'bad';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" size={18} className="notice__icon" />
      <div className="notice__text">
        <p className="notice__title">{title}</p>
        {children && <div className="notice__body">{children}</div>}
      </div>
      {action && <div className="notice__action">{action}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children && <p className="empty__body">{children}</p>}
    </div>
  );
}

// ---------- Copy an id ----------

/** An id you can copy with one click; the icon swaps to a tick for a moment as confirmation. */
export function CopyId({ value, label = 'id' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <span className="copyid-wrap">
      <button
        type="button"
        className={`copyid ${copied ? 'is-copied' : ''}`}
        aria-label={`Copy ${label} ${value}`}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        <span className="mono">{value}</span>
        <span className="copyid__icons" aria-hidden="true">
          <Copy size={12} className="copyid__copy" />
          <Check size={12} className="copyid__check" />
        </span>
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied ? `Copied ${value}` : ''}
      </span>
    </span>
  );
}

// ---------- Small helpers ----------

export function KeyValue({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((it) => (
        <div key={it.k} className="kv__row">
          <dt>{it.k}</dt>
          <dd>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Places a sliding indicator (a tab underline, a segmented thumb) under the
 * element marked data-active="true" inside `containerRef`. The move is a CSS
 * transition on transform, so it stays smooth on the compositor while a new
 * page or map is loading on the main thread. The first placement and any
 * resize snap without a transition.
 */
export function useIndicator(
  containerRef: React.RefObject<HTMLElement | null>,
  indicatorRef: React.RefObject<HTMLElement | null>,
  place: (active: HTMLElement | null, indicator: HTMLElement) => void,
  deps: unknown[],
) {
  const placed = useRef(false);
  const placeRef = useRef(place);
  placeRef.current = place;
  const run = useCallback(
    (animate: boolean) => {
      const root = containerRef.current;
      const ind = indicatorRef.current;
      if (!root || !ind) return;
      const active = root.querySelector<HTMLElement>('[data-active="true"]');
      if (!animate) ind.style.transition = 'none';
      placeRef.current(active, ind);
      if (!animate) {
        void ind.offsetWidth; // commit the snap before transitions come back
        ind.style.transition = '';
      }
    },
    [containerRef, indicatorRef],
  );
  useLayoutEffect(() => {
    run(placed.current);
    placed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    const root = containerRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => run(false));
    ro.observe(root);
    root.querySelectorAll('[data-active]').forEach((el) => ro.observe(el));
    void document.fonts?.ready.then(() => run(false));
    return () => ro.disconnect();
  }, [run, containerRef]);
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
