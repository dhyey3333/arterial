import { useReducedMotion } from 'motion/react';
import { Suspense, lazy, useEffect, useRef, useState, type ComponentType } from 'react';
import { Pause, Play } from 'lucide-react';
import { hasGpuWebGL } from '../lib/gpu';
import type { HyperspeedProps } from '../components/reactbits/Hyperspeed';

// three.js loads only when the close comes near; if its code cannot be fetched the card keeps its ground
const Hyperspeed = lazy<ComponentType<HyperspeedProps>>(() =>
  import('../components/reactbits/Hyperspeed').catch(() => ({ default: () => null })),
);

// the traffic at night as it looks: tail lights going away in brake red, headlights coming on in warm
// white, the street lights the same
const TAILS = ['#c9362d', '#e2563c', '#9c2b25'];
const HEADS = ['#f4f1ea', '#ffffff', '#d6d0c4'];
const POLES = ['#e8e2d4'];

/**
 * The page's last screen stands on a night highway rushing towards the horizon (React Bits' Hyperspeed):
 * the subject the whole product watches, as the one effect on the page. It loads as the section comes
 * near and only where there is a GPU to draw it; it pauses with its button and rests off screen; under
 * reduced motion it is a still. It is decoration: it shows no data and says nothing.
 */
export function CloseRoad() {
  const host = useRef<HTMLDivElement>(null);
  const reduce = !!useReducedMotion();
  const [near, setNear] = useState(false);
  const [gpu] = useState(() => hasGpuWebGL());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el || near) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return (
    <>
      <div className="lp-close__road" ref={host} aria-hidden="true">
        {near && gpu && (
          <Suspense fallback={null}>
            <Hyperspeed
              curve="gentle"
              curvature={0.5}
              speed={0.7}
              fov={88}
              lanes={3}
              density={34}
              trailLength={1.1}
              poles={18}
              dust={40}
              glow={0.25}
              reflections={0.45}
              tailColors={TAILS}
              headColors={HEADS}
              poleColors={POLES}
              roadColor="#0a0a0a"
              roadOpacity={0.6}
              lineColor="#232323"
              background="transparent"
              interactive={false}
              paused={paused}
            />
          </Suspense>
        )}
      </div>
      {near && gpu && !reduce && (
        <button type="button" className="lp-pause lp-close__pause" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play the road' : 'Pause the road'} aria-pressed={paused}>
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
      )}
    </>
  );
}
