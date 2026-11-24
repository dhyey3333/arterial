import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { NavLink, Outlet, useLocation } from 'react-router';
import {
  Activity,
  ChartColumn,
  FlaskConical,
  Radar,
  Route,
  Server,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useLive } from '../../data/store';
import { useSource } from '../../data/LiveProvider';
import { fmtAgo, fmtTime } from '../../lib/format';
import { useNow } from '../ui/primitives';

interface NavItem {
  to: string;
  label: string;
  title: string;
  lede: string;
  icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Command center', title: 'Command center', lede: 'Live conditions, alerts and what slows next.', icon: Radar },
  { to: '/traffic', label: 'Traffic', title: 'Traffic', lede: 'Speed, density and flow on every segment, from the latest 30-second window.', icon: Activity },
  { to: '/forecast', label: 'Forecast', title: 'Forecast', lede: 'Where traffic is likely to slow in the next 5 to 15 minutes, and how sure the model is.', icon: TrendingUp },
  { to: '/incidents', label: 'Incidents', title: 'Incidents', lede: 'Abnormal patterns found in the simulated stream, with the evidence for each.', icon: TriangleAlert },
  { to: '/routes', label: 'Routes', title: 'Routes', lede: 'The fastest path under current conditions, against the usual route.', icon: Route },
  { to: '/analytics', label: 'Analytics', title: 'Analytics', lede: 'Peaks, problem corridors and reliability across the stored simulated history.', icon: ChartColumn },
  { to: '/system', label: 'System', title: 'System', lede: 'The Condense pipeline, Kafka, and this browser’s live stream.', icon: Server },
];

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

function StreamPill() {
  const conn = useLive((s) => s.connection);
  const now = useNow(1000);
  const label =
    conn.state === 'live'
      ? 'Live'
      : conn.state === 'connecting'
        ? 'Connecting'
        : conn.state === 'reconnecting'
          ? `Reconnecting${conn.nextRetryMs ? ` in ${Math.ceil(conn.nextRetryMs / 1000)} s` : ''}`
          : conn.state === 'offline'
            ? 'Offline, retrying'
            : 'Not connected';
  const title = conn.lastEventAt ? `Last event ${fmtAgo(conn.lastEventAt, now)}` : 'No events yet';
  return (
    <span className={`pill pill--${conn.state}`} role="status" aria-live="polite" title={title}>
      <span className="pill__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function Clock() {
  const now = useNow(1000);
  return (
    <span className="topbar__clock num" aria-label="Time in Bengaluru">
      {fmtTime(now)} <span className="muted">IST</span>
    </span>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const source = useSource();
  const reduce = useReducedMotion();
  const current = NAV.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to))) ?? NAV[0];
  const segments = useLive((s) => s.network?.segments.length ?? 0);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="rail" aria-label="Main">
        <div className="rail__brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#121821" />
            <path d="M7 23c4-1 6-4 8-8s5-7 10-8" fill="none" stroke="#4c9dff" strokeWidth="3" strokeLinecap="round" />
            <circle cx="25" cy="7" r="3" fill="#3fd4e4" />
          </svg>
          <div>
            <p className="rail__name">Arterial</p>
            <p className="rail__tag">Traffic intelligence</p>
          </div>
        </div>
        <nav className="rail__nav">
          <LayoutGroup id="nav">
            <ul>
              {NAV.map((item) => {
                const active = item === current;
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.to === '/'} className={`rail__link ${active ? 'is-active' : ''}`}>
                      {active && (
                        <motion.span
                          layoutId="nav-active"
                          className="rail__active"
                          transition={reduce ? { duration: 0 } : { type: 'tween', duration: 0.18, ease: EASE_OUT }}
                        />
                      )}
                      <Icon size={17} aria-hidden="true" className="rail__icon" />
                      <span className="rail__label">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </LayoutGroup>
        </nav>
        <div className="rail__foot">
          <p className="rail__area">
            South-east Bengaluru
            <span className="muted">{segments ? ` · ${segments} segments` : ''}</span>
          </p>
          <p className="rail__note muted">Simulated telemetry. Never connected to real vehicles or signals.</p>
        </div>
      </aside>

      <div className="shell__main">
        {source.kind === 'fixtures' && (
          <div className="fixture-banner" role="note">
            <FlaskConical size={15} aria-hidden="true" />
            <span>
              <strong>Design fixtures.</strong> Hand-written sample data for building this interface. Not live, and not output
              from the simulator or any model.
            </span>
          </div>
        )}
        <header className="topbar">
          <div className="topbar__titles">
            <h1 className="topbar__title">{current.title}</h1>
            <p className="topbar__lede">{current.lede}</p>
          </div>
          <div className="topbar__status">
            <span className="tag">{source.label}</span>
            <Clock />
            <StreamPill />
          </div>
        </header>
        <main id="main" className="page" key={pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
