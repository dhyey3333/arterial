import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { Activity, ArrowRight, ChartColumn, Radar, Route, Server, TrendingUp, TriangleAlert, type LucideIcon } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { CloseRoad } from '../landing/CloseRoad';
import { useSource } from '../data/LiveProvider';
import { useLive } from '../data/store';
import type { SegmentLevel } from '../lib/contract';
import { ForecastScrub } from '../landing/ForecastScrub';
import { HeroVideo } from '../landing/HeroVideo';
import { HeroPanel } from '../landing/HeroPanel';
import { PipelineFlow } from '../landing/PipelineFlow';
import { WeekPeaks } from '../landing/WeekPeaks';
import { networkOrBundled, toPlane } from '../landing/geometry';
import '../landing/landing.css';

const REPO = 'https://github.com/dhyey3333/arterial';

const VIEWS: { to: string; label: string; line: string; icon: LucideIcon }[] = [
  { to: '/console', label: 'Command center', line: 'The map, alerts, roads about to slow and incidents, on one screen.', icon: Radar },
  { to: '/traffic', label: 'Traffic', line: 'Speed, density and flow on every segment, sortable.', icon: Activity },
  { to: '/forecast', label: 'Forecast', line: 'Each road 5, 10 and 15 minutes ahead, with its range.', icon: TrendingUp },
  { to: '/incidents', label: 'Incidents', line: 'Abnormal patterns with the evidence that raised them.', icon: TriangleAlert },
  { to: '/routes', label: 'Routes', line: 'A* over current speeds, against the usual route.', icon: Route },
  { to: '/analytics', label: 'Analytics', line: 'Peaks, problem corridors and reliability over days.', icon: ChartColumn },
  { to: '/system', label: 'System', line: 'The Condense pipeline, Kafka and this browser’s stream.', icon: Server },
];

/**
 * Give the network the visitor is looking at the shared name, so the View Transition into the console
 * grows that network into the console's map (and the way back shrinks it again).
 */
function nameVisibleNetwork() {
  const nets = [...document.querySelectorAll<HTMLElement | SVGElement>('.lp-net')];
  let best: Element | null = null;
  let bestArea = 0;
  for (const n of nets) {
    const r = n.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    if (w * h > bestArea) {
      bestArea = w * h;
      best = n;
    }
  }
  for (const n of nets) (n as HTMLElement).style.viewTransitionName = n === best ? 'network' : 'none';
}

function OpenConsole({ className = '', children = 'Open the console' }: { className?: string; children?: React.ReactNode }) {
  return (
    <Link to="/console" viewTransition className={`lp-btn lp-btn--primary ${className}`} onClick={nameVisibleNetwork}>
      {children}
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

/** Where the picture's data comes from, said under the headline's eyebrow. */
function SourceLine() {
  const source = useSource();
  const conn = useLive((s) => s.connection);
  const live = conn.state === 'live';
  const text =
    source.kind === 'fixtures'
      ? 'Showing design fixtures: hand-written sample data'
      : live
        ? 'Simulated telemetry, streaming now'
        : 'Waiting for the stream; roads drawn without data';
  return (
    <p className={`lp-status ${live ? 'is-live' : ''}`}>
      <span className="lp-status__dot" aria-hidden="true" />
      {text}
    </p>
  );
}

/** The nav's readout of the stream, in mono: what a control room glances at first. */
function StreamReadout() {
  const source = useSource();
  const conn = useLive((s) => s.connection);
  const live = conn.state === 'live';
  const text = source.kind === 'fixtures' ? 'stream: fixtures' : live ? 'stream: live' : 'stream: down';
  return (
    <span className={`lp-readout ${live || source.kind === 'fixtures' ? 'is-on' : ''}`}>
      <span className="lp-readout__dot" aria-hidden="true" />
      {text}
    </span>
  );
}

export default function Landing() {
  const network = useLive((s) => s.network);
  const states = useLive((s) => s.states);
  const predictions = useLive((s) => s.predictions);
  const plane = useMemo(() => toPlane(network), [network]);
  const net = useMemo(() => networkOrBundled(network), [network]);
  const region = net.region?.name ?? 'Bengaluru';

  const levels = useMemo(() => {
    const ids = Object.keys(states);
    if (!ids.length) return null;
    const out: Record<string, SegmentLevel> = {};
    for (const id of ids) out[id] = states[id].level;
    return out;
  }, [states]);

  useEffect(() => {
    document.title = "Arterial: traffic forecasts for India's control rooms";
    return () => {
      document.title = 'Arterial · Traffic intelligence';
    };
  }, []);

  return (
    <div className="lp">
      <a className="skip-link" href="#lp-main">
        Skip to content
      </a>
      <header className="lp-nav">
        <div className="lp-wrap lp-nav__bar">
          <a className="lp-brand" href="#top" aria-label="Arterial, top of the page">
            <BrandMark size={26} className="lp-brand__mark" />
            Arterial
          </a>
          <nav className="lp-nav__links" aria-label="Sections">
            <a href="#forecast">Forecast</a>
            <a href="#pipeline">Pipeline</a>
            <a href="#peaks">Analytics</a>
            <a href="#views">Console</a>
            <a href="#faq">Questions</a>
          </nav>
          <StreamReadout />
          <OpenConsole className="lp-btn--sm" />
        </div>
      </header>

      <main id="lp-main">
        <section className="lp-hero" id="top" aria-labelledby="lp-h1">
          <HeroVideo />
          <div className="lp-hero__veil" aria-hidden="true" />
          <div className="lp-wrap lp-hero__content">
            <SourceLine />
            <h1 id="lp-h1" className="lp-h1">
              <span className="lp-rise" style={{ '--i': 1 } as React.CSSProperties}>
                Traffic forecasts for India&rsquo;s control rooms
              </span>
            </h1>
            <p className="lp-lead lp-rise" style={{ '--i': 3 } as React.CSSProperties}>
              Arterial rates every road segment every 30 seconds, flags abnormal patterns with their evidence, and forecasts where traffic
              slows in the next 15 minutes.
            </p>
            <div className="lp-ctas lp-rise" style={{ '--i': 4 } as React.CSSProperties}>
              <OpenConsole />
              <a className="lp-btn lp-btn--ghost" href="#forecast">
                Watch a jam form
              </a>
            </div>
            <p className="lp-fine lp-rise" style={{ '--i': 5 } as React.CSSProperties}>
              {plane.segments.length} segments in {region} / 30-second windows / forecasts 5, 10 and 15 min ahead
            </p>
          </div>
          <div className="lp-wrap lp-hero__panel">
            <HeroPanel />
          </div>
        </section>

        <ForecastScrub plane={plane} now={levels} predictions={predictions?.predictions ?? null} />

        <section className="lp-section" id="pipeline" aria-labelledby="lp-pipe-h">
          <div className="lp-wrap">
            <div className="lp-head lp-head--split">
              <div>
                <p className="lp-eyebrow">Pipeline</p>
                <h2 id="lp-pipe-h" className="lp-h2">
                  Thirty seconds, every segment
                </h2>
              </div>
              <p className="lp-lede">
                Simulated vehicles stream into Kafka. Condense transforms check each event, close a 30-second window per segment, then raise
                alerts, flag incidents and make forecasts side by side.
              </p>
            </div>
            <PipelineFlow />
            <ul className="lp-points">
              <li>
                <strong>Four custom transforms</strong> and one Split utility, all on Condense.
              </li>
              <li>
                <strong>Rejected events are counted</strong>, never dropped, in telemetry-rejected.
              </li>
              <li>
                <strong>One live stream</strong> carries the results to every open console.
              </li>
            </ul>
          </div>
        </section>

        <WeekPeaks />

        <section className="lp-section" id="views" aria-labelledby="lp-views-h">
          <div className="lp-wrap">
            <div className="lp-head lp-head--split">
              <div>
                <p className="lp-eyebrow">The console</p>
                <h2 id="lp-views-h" className="lp-h2">
                  Seven views, one question each
                </h2>
              </div>
              <p className="lp-lede">Every view below is the running console. Open one and you are in it.</p>
            </div>
            <div className="lp-shots">
              <figure className="lp-shot">
                <img src="/landing/incident-detail.webp" srcSet="/landing/incident-detail-720.webp 720w, /landing/incident-detail.webp 1280w" sizes="(max-width: 760px) 92vw, 560px" width={1280} height={822} alt="An Arterial incident page: a flow breakdown on Sarjapur Road with its evidence table and the note that it is a simulated anomaly." loading="lazy" />
                <figcaption>
                  <strong>Incidents with evidence.</strong> The usual value, the observed one and the change, marked as a simulated anomaly.
                </figcaption>
              </figure>
              <figure className="lp-shot">
                <img src="/landing/routes-detail.webp" srcSet="/landing/routes-detail-720.webp 720w, /landing/routes-detail.webp 1280w" sizes="(max-width: 760px) 92vw, 560px" width={1280} height={822} alt="Arterial's route planner: Silk Board Junction to Bellandur drawn on the map, with the recommended route's time, distance and delay." loading="lazy" />
                <figcaption>
                  <strong>Routes around the jam forming now.</strong> A* over current speeds, set beside the route that is fastest when roads run
                  free.
                </figcaption>
              </figure>
            </div>
            <ul className="lp-views">
              {VIEWS.map((v) => {
                const Icon = v.icon;
                return (
                  <li key={v.to}>
                    <Link to={v.to} viewTransition className="lp-view" onClick={v.to === '/console' ? nameVisibleNetwork : undefined}>
                      <span className="lp-view__icon" aria-hidden="true">
                        <Icon size={18} />
                      </span>
                      <span className="lp-view__label">{v.label}</span>
                      <span className="lp-view__line">{v.line}</span>
                      <ArrowRight className="lp-view__go" size={16} aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="lp-section" id="faq" aria-labelledby="lp-faq-h">
          <div className="lp-wrap lp-faq">
            <div className="lp-head">
              <p className="lp-eyebrow">Questions</p>
              <h2 id="lp-faq-h" className="lp-h2">
                What Arterial is, plainly
              </h2>
            </div>
            <dl className="lp-qa">
              <div>
                <dt>Is the traffic real?</dt>
                <dd>No. Every vehicle comes from Arterial’s own simulator. Arterial never connects to a real vehicle, traffic signal or roadside device.</dd>
              </div>
              <div>
                <dt>What part of Arterial runs today?</dt>
                <dd>The console, on hand-written design fixtures. The simulator, the Condense pipeline and the API are built in the Configure 2026 window, 28 to 29 November.</dd>
              </div>
              <div>
                <dt>How good are Arterial’s forecasts?</dt>
                <dd>Not measured yet. Each model is scored on held-out windows against persistence, the speed staying as it is, and the console shows that score beside it.</dd>
              </div>
              <div>
                <dt>Which roads does Arterial cover?</dt>
                <dd>
                  Today, the design fixtures: {plane.segments.length} segments in south-east {region}, on Outer Ring Road, Hosur Road, Sarjapur Road and the streets of HSR Layout,
                  Koramangala and BTM Layout. The backend is built to run India&rsquo;s national highways and whole cities street by street; each is listed here once it runs.
                </dd>
              </div>
              <div>
                <dt>Can I use Arterial’s code?</dt>
                <dd>
                  Yes. It is on <a href={REPO}>GitHub</a> under the MIT licence.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="lp-cta" aria-labelledby="lp-cta-h">
          <div className="lp-wrap">
            <div className="lp-cta__card">
              <CloseRoad />
              <p className="lp-cta__kicker">For the people who answer the phone when a road stops</p>
              <h2 id="lp-cta-h" className="lp-cta__title">
                Know where it slows before the calls come in
              </h2>
              <OpenConsole />
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot__grid">
          <div className="lp-foot__brand">
            <BrandMark size={40} className="lp-foot__mark" />
            <p className="lp-foot__name">Arterial</p>
            <p className="lp-foot__line">Traffic intelligence for control rooms, built to run from a national highway down to a single junction.</p>
            <StreamReadout />
          </div>

          <nav className="lp-foot__cols" aria-label="Footer">
            <div>
              <p className="lp-foot__h">Console</p>
              <ul>
                {VIEWS.map((v) => (
                  <li key={v.to}>
                    <Link to={v.to} viewTransition className="lp-foot__link" onClick={v.to === '/console' ? nameVisibleNetwork : undefined}>
                      {v.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="lp-foot__h">Project</p>
              <ul>
                <li>
                  <a className="lp-foot__link" href={REPO}>
                    Source on GitHub
                  </a>
                </li>
                <li>
                  <a className="lp-foot__link" href={`${REPO}/blob/main/docs/ARCHITECTURE.md`}>
                    Architecture
                  </a>
                </li>
                <li>
                  <a className="lp-foot__link" href={`${REPO}/blob/main/docs/API.md`}>
                    API
                  </a>
                </li>
                <li>
                  <a className="lp-foot__link" href={`${REPO}/blob/main/docs/BUILD-PLAN.md`}>
                    Build plan
                  </a>
                </li>
                <li>
                  <a className="lp-foot__link" href={`${REPO}/blob/main/docs/COMPLIANCE.md`}>
                    Compliance and AI use
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="lp-foot__h">Data</p>
              <ul className="lp-foot__facts">
                <li>Simulated vehicles only, never real ones</li>
                <li>Road shapes traced from OpenStreetMap</li>
                <li>Basemap tiles from OpenFreeMap</li>
                <li>A new window every 30 seconds</li>
              </ul>
            </div>
          </nav>
        </div>

        <div className="lp-wrap lp-foot__bar">
          <span>&copy; 2026 Arterial team · MIT licence · Built for Configure 2026</span>
          <span>Map data &copy; OpenStreetMap contributors (ODbL) · Tiles: OpenFreeMap, &copy; OpenMapTiles · Hero video: <a className="lp-foot__credit" href="https://www.pexels.com/video/aerial-night-view-of-bengaluru-metro-cityscape-39457313/">Spotlight States on Pexels</a></span>
        </div>
      </footer>
    </div>
  );
}
