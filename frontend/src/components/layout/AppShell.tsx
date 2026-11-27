import { useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
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
import { useIndicator, useNow } from '../ui/primitives';
import { IncidentNotifier } from '../IncidentNotifier';
import { BrandMark } from '../BrandMark';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Map and inbox views fill the screen and scroll inside their own columns. */
  fill?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/console', label: 'Command center', icon: Radar, fill: true },
  { to: '/traffic', label: 'Traffic', icon: Activity },
  { to: '/forecast', label: 'Forecast', icon: TrendingUp, fill: true },
  { to: '/incidents', label: 'Incidents', icon: TriangleAlert, fill: true },
  { to: '/routes', label: 'Routes', icon: Route, fill: true },
  { to: '/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/system', label: 'System', icon: Server },
];

function StreamPill() {
  const conn = useLive((s) => s.connection);
  const source = useSource();
  const now = useNow(1000);
  const label =
    conn.state === 'live'
      ? // the design fixtures stream sample data: "Live" beside the fixtures banner would contradict it
        source.kind === 'fixtures'
        ? 'Sample stream'
        : 'Live'
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
    <span className="clock num" aria-label="Time in India">
      {fmtTime(now)} <span className="muted">IST</span>
    </span>
  );
}

function Mark() {
  return <BrandMark className="brand__mark" />;
}

export function AppShell() {
  const { pathname } = useLocation();
  // the console needs the network and the stream: start them (once) when any console page opens
  useEffect(() => useLive.getState().want(), []);
  const source = useSource();
  const reduce = useReducedMotion();
  const current = NAV.find((n) => pathname.startsWith(n.to)) ?? null;
  const incidents = useLive((s) => s.incidents);
  const activeIncidents = Object.values(incidents).filter((i) => i.status === 'active').length;
  // the region the API serves: a city, or the national tier
  const region = useLive((s) => s.network?.region?.name) ?? '';
  const tabsRef = useRef<HTMLElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);

  // The underline is one element moved with transform: a 100px bar scaled to the tab's width.
  useIndicator(
    tabsRef,
    indRef,
    (active, ind) => {
      if (!active) {
        ind.style.opacity = '0';
        return;
      }
      ind.style.opacity = '1';
      ind.style.transform = `translateX(${active.offsetLeft + 10}px) scaleX(${(active.offsetWidth - 20) / 100})`;
    },
    [current?.to, activeIncidents > 0],
  );

  // On a narrow screen the tab row scrolls: keep the current tab in view.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.tabs__link.is-active');
    const row = el?.closest<HTMLElement>('.tabs');
    if (!el || !row || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
  }, [pathname, reduce]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {source.kind === 'fixtures' && (
        <div className="strip" role="note">
          <FlaskConical size={14} aria-hidden="true" />
          <span>
            <strong>Design fixtures.</strong>{' '}
            <span className="strip__long">Hand-written sample data for building this interface. Not live, and not output from the simulator or any model.</span>
            <span className="strip__short">Hand-written sample data. Not live, not from the simulator or any model.</span>
          </span>
        </div>
      )}
      <header className="bar">
        <Link to="/" viewTransition className="brand" aria-label="Arterial home">
          <Mark />
          <span className="brand__name">Arterial</span>
          {region && (
            <>
              <span className="brand__sep" aria-hidden="true">
                /
              </span>
              <span className="brand__area">{region}</span>
            </>
          )}
        </Link>
        <nav className="tabs" aria-label="Main" ref={tabsRef}>
          <ul className="tabs__list">
            {NAV.map((item) => {
              const active = item === current;
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink to={item.to} className={`tabs__link ${active ? 'is-active' : ''}`} data-active={active}>
                    <Icon size={15} aria-hidden="true" />
                    {item.label}
                    {item.to === '/incidents' && activeIncidents > 0 && (
                      <span key={activeIncidents} className="tabs__count num" aria-label={`${activeIncidents} active`}>
                        {activeIncidents}
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
          <span ref={indRef} className="tabs__ind" aria-hidden="true" />
        </nav>
        <div className="bar__status">
          {/* the fixtures banner already says where the data comes from; a real API names itself here */}
          {source.kind !== 'fixtures' && <span className="source">{source.label}</span>}
          <Clock />
          <StreamPill />
        </div>
      </header>
      <main id="main" className={`view ${current?.fill ? 'view--fill' : ''}`} key={pathname.startsWith('/incidents') ? '/incidents' : pathname}>
        <Outlet />
      </main>
      <IncidentNotifier />
    </div>
  );
}
