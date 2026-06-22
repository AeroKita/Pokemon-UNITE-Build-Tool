import { useEffect, useRef, useState, type ReactNode } from "react";

interface MarqueeTextProps {
  children: ReactNode;
  className?: string;
}

/** Horizontally scrolls overflowing text; stays centered when it fits. */
export function MarqueeText({ children, className = "" }: MarqueeTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [marquee, setMarquee] = useState(false);
  const [durationSec, setDurationSec] = useState(12);

  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const update = () => {
      const overflow = measure.scrollWidth > container.clientWidth + 1;
      setMarquee(overflow);
      if (overflow) {
        const px = measure.scrollWidth - container.clientWidth;
        setDurationSec(Math.min(24, Math.max(8, px / 28)));
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div
      ref={containerRef}
      className={`text-marquee-host relative min-w-0 overflow-hidden ${className}`}
    >
      <span ref={measureRef} className="pointer-events-none invisible absolute whitespace-nowrap">
        {children}
      </span>
      {marquee ? (
        <div
          className="text-marquee-track"
          style={{ ["--text-marquee-duration" as string]: `${durationSec}s` }}
        >
          <span className="text-marquee-segment whitespace-nowrap">{children}</span>
          <span aria-hidden className="text-marquee-segment whitespace-nowrap">
            {children}
          </span>
        </div>
      ) : (
        <p className="whitespace-nowrap text-center">{children}</p>
      )}
    </div>
  );
}
