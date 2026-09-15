"use client";

import { useLayoutEffect, useRef, useState } from "react";

export function ScrollingText({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useLayoutEffect(() => {
    function measure() {
      const container = containerRef.current;
      const textEl = textRef.current;
      if (!container || !textEl) return;

      const overflow = textEl.scrollWidth - container.clientWidth;
      setOverflowPx(overflow > 0 ? overflow : 0);
    }

    measure();

    // Re-measure on resize — a column's available width can change if the
    // window resizes or the sidebar/browser zoom changes.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text]);

  return (
    <div ref={containerRef} className="scrolling-text" title={text}>
      <span
        ref={textRef}
        className="scrolling-text-inner"
        style={{ "--scroll-distance": `-${overflowPx}px` } as React.CSSProperties}
      >
        {text}
      </span>
    </div>
  );
}