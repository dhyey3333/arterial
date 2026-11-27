import { useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

// Bengaluru at night from the air: the lit arterial and the elevated metro line through the city.
// "Aerial Night View of Bengaluru Metro Cityscape" by Spotlight States on Pexels (Pexels License), the
// opening 8.3 s re-encoded to 1280x720 H.264. Stock footage of the city, not Arterial's data.
const SRC = '/landing/hero-night.mp4';
const POSTER = '/landing/hero-night.jpg';
// seconds the two copies overlap at the seam, so the loop never jumps
const SEAM = 0.9;

/**
 * The hero's picture: a real night view of Bengaluru, looping without a visible seam. Its first frame shows
 * at once (57 KB), and the video fades in over it as soon as it can play, so a slow connection still sees a
 * picture straight away. Two copies of the same clip take turns: as one nears its end the other starts from
 * the beginning and they cross-fade. It pauses with its button and while off screen; under reduced motion,
 * or when the browser asks to save data, it is the still.
 */
export function HeroVideo() {
  const reduce = !!useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const front = useRef<0 | 1>(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const wake = useRef<() => void>(() => {});
  const saveData = typeof navigator !== 'undefined' && !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
  const still = reduce || saveData;

  useEffect(() => {
    const el = host.current;
    const pair = [a.current, b.current];
    if (still || !el || !pair[0] || !pair[1]) return;
    const vids = pair as HTMLVideoElement[];
    let raf = 0;
    let visible = true;
    let handing = false;
    let timer = 0;

    const tick = () => {
      raf = 0;
      const cur = vids[front.current];
      const next = vids[1 - front.current];
      const d = cur.duration;
      if (!handing && Number.isFinite(d) && d > SEAM * 2 && cur.currentTime >= d - SEAM) {
        // hand over: the other copy starts from the top and fades in as this one fades out
        handing = true;
        next.currentTime = 0;
        void next.play().catch(() => {});
        next.classList.add('is-front');
        cur.classList.remove('is-front');
        front.current = (1 - front.current) as 0 | 1;
        timer = window.setTimeout(() => {
          cur.pause();
          handing = false;
        }, SEAM * 1000 + 120);
      }
      if (visible && !pausedRef.current) raf = requestAnimationFrame(tick);
    };
    const run = () => {
      const cur = vids[front.current];
      if (!visible || pausedRef.current) {
        vids.forEach((v) => v.pause());
        cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      void cur.play().catch(() => {});
      if (!raf) raf = requestAnimationFrame(tick);
    };
    wake.current = run;

    const onPlaying = () => setPlaying(true);
    vids[0].addEventListener('playing', onPlaying, { once: true });
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      run();
    });
    io.observe(el);
    run();
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      vids.forEach((v) => v.pause());
      vids[0].removeEventListener('playing', onPlaying);
      wake.current = () => {};
    };
  }, [still]);

  useEffect(() => {
    wake.current();
  }, [paused]);

  return (
    <div className="lp-viz">
      <div className={`lp-video ${playing ? 'is-playing' : ''}`} ref={host} aria-hidden="true">
        <img className="lp-video__poster" src={POSTER} alt="" decoding="async" fetchPriority="high" />
        {!still && (
          <>
            <video ref={a} className="lp-video__clip is-front" src={SRC} muted playsInline preload="auto" disablePictureInPicture />
            <video ref={b} className="lp-video__clip" src={SRC} muted playsInline preload="auto" disablePictureInPicture />
          </>
        )}
      </div>
      {!still && (
        <button type="button" className="lp-pause" onClick={() => setPaused((p) => !p)} aria-label={paused ? 'Play the video' : 'Pause the video'} aria-pressed={paused}>
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
