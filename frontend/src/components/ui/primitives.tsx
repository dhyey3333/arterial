import { animate, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  CircleAlert,
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

// ---------- Panel ----------

export function Panel({
  title,
  meta,
  actions,
  children,
  className = '',
  enter,
  id,
  bodyClassName = '',
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Entrance delay in ms; omit for no entrance. */
  enter?: number;
  id?: string;
  bodyClassName?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      className={`panel ${enter !== undefined ? 'enter' : ''} ${className}`}
      style={enter !== undefined ? ({ '--i': enter } as React.CSSProperties) : undefined}
      aria-labelledby={title ? headingId : undefined}
    >
      {(title || actions) && (
        <header className="panel__head">
          <div className="panel__titles">
            {title && (
              <h2 className="panel__title" id={headingId}>
                {title}
              </h2>
            )}
            {meta && <p className="panel__meta">{meta}</p>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      <div className={`panel__body ${bodyClassName}`}>{children}</div>
    </section>
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
  const [initial] = useState(() => format(value));
  const reduce = useReducedMotion();
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    prev.current = value;
    if (value === null || from === null || reduce || from === value) {
      el.textContent = formatRef.current(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.32,
      ease: EASE_OUT,
      onUpdate: (v) => {
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
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const name = useId();
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <label key={String(o.value)} className={`segmented__option ${active ? 'is-active' : ''}`}>
            <input
              type="radio"
              className="visually-hidden"
              name={name}
              checked={active}
              onChange={() => onChange(o.value)}
            />
            {active && (
              <motion.span
                layoutId={`${name}-thumb`}
                className="segmented__thumb"
                transition={{ type: 'tween', duration: 0.18, ease: EASE_OUT }}
              />
            )}
            <span className="segmented__text">{o.label}</span>
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

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
