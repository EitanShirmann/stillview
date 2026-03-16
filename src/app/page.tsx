"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { streams, categories, type Stream, type Category } from "@/lib/streams";
import { trackPageView, trackStreamView, trackCategoryChange, trackGlobeOpen } from "@/lib/analytics";

const Globe = dynamic(() => import("@/components/Globe"), { ssr: false });

/** Deterministic shuffle — Fisher-Yates with a seed so it's stable per session */
function shuffleArray<T>(arr: T[], seed = 42): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Spread streams so same-location entries aren't adjacent */
function spreadStreams(arr: Stream[]): Stream[] {
  const shuffled = shuffleArray(arr, Date.now() % 100000);
  // Simple greedy: avoid consecutive same location prefix
  const result: Stream[] = [];
  const remaining = [...shuffled];
  while (remaining.length > 0) {
    const lastLoc = result.length > 0 ? result[result.length - 1].location.split(",")[0] : "";
    const idx = remaining.findIndex((s) => s.location.split(",")[0] !== lastLoc);
    if (idx !== -1) {
      result.push(remaining.splice(idx, 1)[0]);
    } else {
      result.push(remaining.shift()!);
    }
  }
  return result;
}

function LiveIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] tracking-widest uppercase text-[var(--sv-text-muted)]">
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-breathe absolute inline-flex h-full w-full rounded-full bg-[var(--sv-accent)]" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--sv-accent-muted)]" />
      </span>
      live
    </span>
  );
}

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-[10px] tracking-widest uppercase transition-all duration-500 rounded-full border whitespace-nowrap font-semibold ${
        active
          ? "border-[var(--sv-accent-muted)] text-white bg-[var(--sv-accent-glow)]"
          : "border-transparent text-[var(--sv-stone-300)] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

// Find Big Bear Lake index to use as default
const BIG_BEAR_ID = "big-bear-eagles";

export default function Home() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [transitioning, setTransitioning] = useState(false);
  const [globeView, setGlobeView] = useState(false);
  const [stripHovered, setStripHovered] = useState(false);
  const [muted, setMuted] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // Easter egg states
  const [sofiaClicks, setSofiaClicks] = useState(0);
  const [showSofia, setShowSofia] = useState(false);
  const [momClicks, setMomClicks] = useState(0);
  const [showMom, setShowMom] = useState(false);
  const sofiaTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const momTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const filteredStreams = useMemo(() => {
    const base =
      activeCategory === "all"
        ? streams
        : streams.filter((s) => s.category === activeCategory);
    return spreadStreams(base);
  }, [activeCategory]);

  // Set Big Bear as default on first load
  useEffect(() => {
    const idx = filteredStreams.findIndex((s) => s.id === BIG_BEAR_ID);
    if (idx !== -1 && activeCategory === "all") {
      setCurrentIndex(idx);
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeStream = filteredStreams[currentIndex] || filteredStreams[0];

  // Analytics: page view on mount
  useEffect(() => {
    trackPageView();
  }, []);

  // Analytics: track each stream view
  useEffect(() => {
    if (activeStream) {
      trackStreamView(activeStream.id, activeStream.location, activeStream.category);
    }
  }, [activeStream]);

  const goTo = useCallback(
    (index: number) => {
      const clamped =
        ((index % filteredStreams.length) + filteredStreams.length) %
        filteredStreams.length;
      if (clamped === currentIndex) return;
      setTransitioning(true);
      setTimeout(() => {
        setCurrentIndex(clamped);
        setTransitioning(false);
      }, 600);
    },
    [currentIndex, filteredStreams.length]
  );

  const prev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex]);
  const next = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex]);

  const toggleMute = useCallback(() => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      const cmd = muted ? "unMute" : "mute";
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: cmd, args: [] }),
        "*"
      );
      setMuted(!muted);
    }
  }, [muted]);

  useEffect(() => {
    setCurrentIndex(0);
    if (activeCategory) trackCategoryChange(activeCategory);
  }, [activeCategory]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Escape") setGlobeView(false);
      else if (e.key === "g") {
        setGlobeView((v) => {
          if (!v) trackGlobeOpen();
          return !v;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next]);

  const handleGlobeStreamClick = useCallback(
    (stream: Stream) => {
      const idx = filteredStreams.findIndex((s) => s.id === stream.id);
      if (idx !== -1) {
        goTo(idx);
        setGlobeView(false);
      }
    },
    [filteredStreams, goTo]
  );

  // Easter egg: Sofia — 5 clicks on location card
  const handleLocationCardClick = useCallback(() => {
    const next = sofiaClicks + 1;
    setSofiaClicks(next);
    if (next >= 5) {
      setSofiaClicks(0);
      setShowSofia(true);
      clearTimeout(sofiaTimer.current);
      sofiaTimer.current = setTimeout(() => setShowSofia(false), 2000);
    }
  }, [sofiaClicks]);

  // Easter egg: Mom — 5 clicks on Stillview card
  const handleStillviewClick = useCallback(() => {
    const next = momClicks + 1;
    setMomClicks(next);
    if (next >= 5) {
      setMomClicks(0);
      setShowMom(true);
      clearTimeout(momTimer.current);
      momTimer.current = setTimeout(() => setShowMom(false), 2000);
    }
  }, [momClicks]);

  // Auto-scroll filmstrip to active stream
  useEffect(() => {
    if (stripRef.current) {
      const thumb = stripRef.current.children[currentIndex] as HTMLElement;
      if (thumb) {
        thumb.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [currentIndex]);

  const counter = `${currentIndex + 1} / ${filteredStreams.length}`;

  return (
    <div className="h-dvh w-screen overflow-hidden bg-[var(--sv-bg-base)] relative">
      {/* ── Fullscreen Video ── */}
      <div
        className={`absolute overflow-hidden transition-opacity duration-1000 ${
          transitioning ? "opacity-0" : "opacity-100"
        }`}
        style={{ top: "-80px", left: "-80px", right: "-80px", bottom: "-300px" }}
      >
        {activeStream.source?.type === "windy" ? (
          <iframe
            key={activeStream.source.webcamId}
            src={`https://webcams.windy.com/webcams/public/embed/player/${activeStream.source.webcamId}/day`}
            allow="autoplay; fullscreen"
            tabIndex={-1}
            style={{
              border: "none",
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            key={activeStream.videoId}
            src={`https://www.youtube.com/embed/${activeStream.videoId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&showinfo=0&loop=1&playsinline=1&enablejsapi=1&iv_load_policy=3&disablekb=1&fs=0`}
            allow="autoplay; encrypted-media; autoplay *"
            tabIndex={-1}
            style={{
              border: "none",
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          />
        )}
        {/* Invisible overlay to block embed UI interaction */}
        <div className="absolute inset-0 z-[1]" />
      </div>


      {/* ── Globe Overlay (centered, large) ── */}
      <div
        className={`absolute inset-0 z-30 flex items-center justify-center transition-all duration-700 ${
          globeView
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Scrim behind globe */}
        <div
          className="absolute inset-0 bg-[var(--sv-stone-950)]/85 backdrop-blur-sm"
          onClick={() => setGlobeView(false)}
        />

        {/* Globe container */}
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="w-[min(85vh,85vw)] sm:w-[min(75vh,75vw)] max-w-[650px]">
            <Globe
              streams={filteredStreams}
              activeStream={activeStream}
              onStreamClick={(stream) => {
                handleGlobeStreamClick(stream);
                setGlobeView(false);
              }}
            />
          </div>

          <p className="text-[9px] tracking-[0.2em] uppercase text-[var(--sv-text-faint)]">
            hover over a dot to preview &middot; click to view &middot; drag to
            rotate
          </p>
        </div>
      </div>

      {/* ── Stream UI ── */}
      <div className="absolute inset-0 flex flex-col z-10">
        {/* Top bar — frosted glass card */}
        <div className="flex justify-center px-3 pt-8 sm:pt-10 lg:pt-14">
          <div
            className="inline-flex flex-col items-center bg-[var(--sv-stone-950)]/40 backdrop-blur-xl border border-white/[0.06] rounded-2xl px-3 py-3 sm:px-6 sm:py-4 shadow-[0_4px_30px_rgba(0,0,0,0.3)] cursor-pointer select-none relative overflow-hidden"
            onClick={handleStillviewClick}
          >
            <div className="flex items-center gap-3 sm:gap-4 mb-2 sm:mb-3">
              <h1 className="text-[var(--sv-stone-100)] text-sm font-semibold tracking-[0.4em] uppercase">
                Stillview
              </h1>
              {/* Globe toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setGlobeView((v) => !v);
                }}
                className={`p-1.5 rounded-full transition-all duration-500 ${
                  globeView
                    ? "text-[var(--sv-accent)] bg-[var(--sv-accent-glow)]"
                    : "text-[var(--sv-stone-500)] hover:text-[var(--sv-text-primary)]"
                }`}
                title="Toggle globe (G)"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </button>
            </div>

            {/* Category pills */}
            <div className="flex items-center justify-center gap-1 sm:gap-1.5 flex-wrap">
              <CategoryPill
                label="All"
                active={activeCategory === "all"}
                onClick={() => setActiveCategory("all")}
              />
              {categories.map((cat) => (
                <CategoryPill
                  key={cat.key}
                  label={cat.label}
                  active={activeCategory === cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                />
              ))}
            </div>

            {/* Mom Easter egg */}
            <div
              className={`absolute inset-x-0 bottom-0 flex justify-center pb-1.5 transition-all duration-500 ${
                showMom ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
              }`}
            >
              <span className="text-[11px] text-amber-400 font-medium tracking-wide">
                love you, Mom
              </span>
            </div>
          </div>
        </div>

        {/* Spacer with nav arrows */}
        <div className="flex-1 flex items-center justify-between px-3 sm:px-6">
          <button
            onClick={prev}
            className="p-2.5 sm:p-3 rounded-full bg-[var(--sv-stone-950)]/30 backdrop-blur-xl border border-white/[0.06] text-[var(--sv-stone-400)] hover:text-white hover:bg-[var(--sv-stone-950)]/50 transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.3)]"
            title="Previous stream"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={next}
            className="p-2.5 sm:p-3 rounded-full bg-[var(--sv-stone-950)]/30 backdrop-blur-xl border border-white/[0.06] text-[var(--sv-stone-400)] hover:text-white hover:bg-[var(--sv-stone-950)]/50 transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.3)]"
            title="Next stream"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* Bottom section */}
        <div className="px-4 sm:px-8 pb-8 flex items-end justify-between">
          {/* Location info — glassmorphism card, left-aligned */}
          <div
            className="animate-fade-in bg-[var(--sv-stone-950)]/40 backdrop-blur-xl border border-white/[0.06] rounded-2xl px-4 py-3 sm:px-6 sm:py-4 shadow-[0_4px_30px_rgba(0,0,0,0.3)] max-w-[280px] sm:max-w-sm cursor-pointer select-none relative overflow-hidden"
            key={activeStream.id}
            onClick={handleLocationCardClick}
          >
            <p className="text-[var(--sv-stone-50)] text-base sm:text-lg font-semibold tracking-wide">
              {activeStream.location}
            </p>
            <p className="text-[var(--sv-stone-400)] text-xs sm:text-sm italic mt-1 font-medium">
              {activeStream.description}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <LiveIndicator />
              <span className="text-[10px] text-[var(--sv-text-faint)] tracking-wide font-mono">
                {counter}
              </span>
            </div>

            {/* Sofia Easter egg */}
            <div
              className={`transition-all duration-500 overflow-hidden ${
                showSofia ? "max-h-8 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0"
              }`}
            >
              <span className="text-[11px] text-amber-400 font-medium tracking-wide">
                love you, Sofia
              </span>
            </div>
          </div>

          {/* Mute/Unmute button */}
          <button
            onClick={toggleMute}
            className="p-3 rounded-full bg-[var(--sv-stone-950)]/40 backdrop-blur-xl border border-white/[0.06] text-[var(--sv-stone-300)] hover:text-white transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.3)] self-end"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Scrim when filmstrip is open ── */}
      <div
        className={`absolute inset-0 bg-[var(--sv-stone-950)]/60 transition-opacity duration-500 pointer-events-none z-15 ${
          stripHovered ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* ── Bottom filmstrip (hidden by default) ── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20"
        style={{ top: "auto" }}
        onMouseEnter={() => setStripHovered(true)}
        onMouseLeave={() => setStripHovered(false)}
        onClick={(e) => {
          // Toggle on tap for mobile (clicking chevron area)
          if (!(e.target as HTMLElement).closest("button")) {
            setStripHovered((v) => !v);
          }
        }}
      >
        {/* Chevron trigger — thin hover zone at very bottom */}
        <div
          className={`flex justify-center cursor-pointer transition-all duration-500 ${
            stripHovered ? "pb-2 pt-3" : "pb-1 pt-1"
          }`}
        >
          <div className="flex items-center gap-2">
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              className={`transition-all duration-500 ${
                stripHovered
                  ? "rotate-180 text-[var(--sv-stone-300)]"
                  : "text-[var(--sv-stone-600)]"
              }`}
            >
              <path
                d="M5 8L10 13L15 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className={`text-[8px] tracking-[0.15em] uppercase font-medium transition-all duration-500 ${
                stripHovered ? "text-[var(--sv-stone-400)] opacity-100" : "text-[var(--sv-stone-700)] opacity-0"
              }`}
            >
              Browse streams
            </span>
          </div>
        </div>

        {/* Filmstrip — slides up on hover */}
        <div
          className={`transition-all duration-500 ease-out ${
            stripHovered
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-full pointer-events-none"
          }`}
        >
          <div className="bg-[var(--sv-stone-950)]/70 backdrop-blur-xl border-t border-white/[0.04]">
            <div
              ref={stripRef}
              className="flex gap-1.5 sm:gap-2 lg:gap-3 px-3 sm:px-4 lg:px-6 py-2 sm:py-3 lg:py-4 overflow-x-auto scrollbar-hide scroll-smooth"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {filteredStreams.map((stream, idx) => {
                const isActive = idx === currentIndex;
                return (
                  <button
                    key={stream.id}
                    onClick={() => goTo(idx)}
                    className={`flex-shrink-0 overflow-hidden transition-all duration-300 relative group/thumb w-[120px] h-[68px] sm:w-[140px] sm:h-[80px] lg:w-[180px] lg:h-[100px] xl:w-[200px] xl:h-[112px] ${
                      isActive
                        ? "ring-2 ring-amber-400/60 scale-105"
                        : "opacity-60 hover:opacity-100 hover:scale-105"
                    }`}
                  >
                    <img
                      src={`https://img.youtube.com/vi/${stream.videoId}/hqdefault.jpg`}
                      alt={stream.location}
                      className="w-full h-full object-cover"
                      draggable={false}
                      loading="lazy"
                    />
                    {/* Label overlay */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                      <p className="text-[9px] text-white/90 font-medium truncate leading-tight">
                        {stream.location}
                      </p>
                    </div>
                    {isActive && (
                      <div className="absolute top-1.5 right-1.5">
                        <span className="block w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
