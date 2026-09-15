"use client";

import { useLayoutEffect, useRef, useState } from "react";

const PAUSE_MS = 1000; // fixed dwell time at each end, regardless of length
const PIXELS_PER_SECOND = 60; // scroll speed for the sliding portion

type Phase = "start" | "revealing" | "end" | "returning";

export function ScrollingText({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const [phase, setPhase] = useState<Phase>("start");
  const [hovering, setHovering] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const container = containerRef.current;
      const textEl = textRef.current;
      if (!container || !textEl) return;
      const overflow = textEl.scrollWidth - container.clientWidth;
      setOverflowPx(overflow > 0 ? overflow : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text]);

  const slideMs = (overflowPx / PIXELS_PER_SECOND) * 1000;

  useLayoutEffect(() => {
    if (!hovering || overflowPx === 0) {
      setPhase("start");
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    // Drives a repeating start-pause -> reveal -> end-pause -> return
    // cycle, where the reveal/return durations scale with actual
    // distance (slideMs), and the two pauses stay a fixed, readable
    // length regardless of message length.
    const sequence: Array<{ phase: Phase; durationMs: number }> = [
      { phase: "start", durationMs: PAUSE_MS },
      { phase: "revealing", durationMs: slideMs },
      { phase: "end", durationMs: PAUSE_MS },
      { phase: "returning", durationMs: slideMs },
    ];

    let index = 0;
    function runStep() {
      setPhase(sequence[index].phase);
      timerRef.current = setTimeout(() => {
        index = (index + 1) % sequence.length;
        runStep();
      }, sequence[index].durationMs);
    }
    runStep();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hovering, overflowPx, slideMs]);

  const translated = phase === "revealing" || phase === "end";

  return (
    <div
      ref={containerRef}
      className="scrolling-text"
      title={text}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <span
        ref={textRef}
        className="scrolling-text-inner"
        style={{
          transform: translated ? `translateX(-${overflowPx}px)` : "translateX(0)",
          transitionDuration: `${slideMs}ms`,
        }}
      >
        {text}
      </span>
    </div>
  );
}