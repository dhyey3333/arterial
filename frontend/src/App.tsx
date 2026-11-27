import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { LiveProvider } from './data/LiveProvider';
import { createLiveSource, type DataSource } from './lib/api';
import { API_URL, USE_FIXTURES } from './lib/config';
import Landing from './pages/Landing';

const pages = {
  console: () => import('./pages/CommandCenter').then((m) => ({ default: m.CommandCenter })),
  traffic: () => import('./pages/Traffic'),
  forecast: () => import('./pages/Forecast'),
  incidents: () => import('./pages/Incidents'),
  routes: () => import('./pages/Routes'),
  analytics: () => import('./pages/Analytics'),
  system: () => import('./pages/System'),
};
const CommandCenter = lazy(pages.console);
const Traffic = lazy(pages.traffic);
const Forecast = lazy(pages.forecast);
const Incidents = lazy(pages.incidents);
const Routes = lazy(pages.routes);
const Analytics = lazy(pages.analytics);
const System = lazy(pages.system);
const NotFound = lazy(() => import('./pages/NotFound'));

/**
 * Page transitions stay smooth only if the next page is already here: once the
 * first view has settled, fetch every page's code while the browser is idle, so
 * a tab change swaps content in the same frame instead of flashing a blank view.
 */
function usePrefetchPages() {
  useEffect(() => {
    const run = () => Object.values(pages).forEach((load) => void load().catch(() => undefined));
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) {
      const id = idle(run, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(run, 1500);
    return () => clearTimeout(t);
  }, []);
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const page = (el: React.ReactNode) => <Suspense fallback={<div className="page-loading" aria-busy="true" />}>{el}</Suspense>;

const router = createBrowserRouter([
  // the front door: what Arterial is, then into the console
  { path: '/', element: <Landing /> },
  {
    element: <AppShell />,
    children: [
      { path: 'console', element: page(<CommandCenter />) },
      { path: 'traffic', element: page(<Traffic />) },
      { path: 'forecast', element: page(<Forecast />) },
      { path: 'incidents', element: page(<Incidents />) },
      { path: 'incidents/:id', element: page(<Incidents />) },
      { path: 'routes', element: page(<Routes />) },
      { path: 'analytics', element: page(<Analytics />) },
      { path: 'system', element: page(<System />) },
      { path: '*', element: page(<NotFound />) },
    ],
  },
]);

function useDataSource(): DataSource | null {
  const [source, setSource] = useState<DataSource | null>(() => (USE_FIXTURES ? null : createLiveSource(API_URL)));
  useEffect(() => {
    if (!USE_FIXTURES) return;
    let alive = true;
    // Fixtures load as their own chunk, so the live build never ships them on first load.
    void import('./fixtures/source').then((m) => alive && setSource(m.createFixtureSource()));
    return () => {
      alive = false;
    };
  }, []);
  return source;
}

export default function App() {
  const source = useDataSource();
  usePrefetchPages();
  if (!source) return <div className="page-loading" aria-busy="true" />;
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <LiveProvider source={source}>
          <RouterProvider router={router} />
        </LiveProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}
