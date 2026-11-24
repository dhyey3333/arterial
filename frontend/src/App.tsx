import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { LiveProvider } from './data/LiveProvider';
import { createLiveSource, type DataSource } from './lib/api';
import { API_URL, USE_FIXTURES } from './lib/config';
import { CommandCenter } from './pages/CommandCenter';

const Traffic = lazy(() => import('./pages/Traffic'));
const Forecast = lazy(() => import('./pages/Forecast'));
const Incidents = lazy(() => import('./pages/Incidents'));
const Routes = lazy(() => import('./pages/Routes'));
const Analytics = lazy(() => import('./pages/Analytics'));
const System = lazy(() => import('./pages/System'));
const NotFound = lazy(() => import('./pages/NotFound'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const page = (el: React.ReactNode) => <Suspense fallback={<div className="page-loading" aria-busy="true" />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <CommandCenter /> },
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
