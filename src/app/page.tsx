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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [muted, setMuted] = useState(false);
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

  const randomStream = useCallback(() => {
    let rand = Math.floor(Math.random() * filteredStreams.length);
    // Avoid landing on the same stream
    if (filteredStreams.length > 1 && rand === currentIndex) {
      rand = (rand + 1) % filteredStreams.length;
    }
    goTo(rand);
    // Unmute after a short delay so the new iframe has loaded
    setTimeout(() => {
      const iframe = iframeRef.current;
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: "command", func: "unMute", args: [] }),
          "*"
        );
        setMuted(false);
      }
    }, 1200);
  }, [currentIndex, filteredStreams.length, goTo]);

  const toggleMute = useCallback(() => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      // Always unmute — never mute again
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: "unMute", args: [] }),
        "*"
      );
      setMuted(false);
    }
  }, []);

  useEffect(() => {
    setCurrentIndex(0);
    if (activeCategory) trackCategoryChange(activeCategory);
  }, [activeCategory]);

  // Auto-unmute on first user interaction (browser requires gesture for sound)
  useEffect(() => {
    const unmute = () => {
      const iframe = iframeRef.current;
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: "command", func: "unMute", args: [] }),
          "*"
        );
        setMuted(false);
      }
      // Remove listeners after first interaction
      window.removeEventListener("click", unmute);
      window.removeEventListener("keydown", unmute);
    };
    // Also try unmuting after iframe loads (works if browser allows it)
    const timer = setTimeout(unmute, 2000);
    window.addEventListener("click", unmute);
    window.addEventListener("keydown", unmute);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", unmute);
      window.removeEventListener("keydown", unmute);
    };
  }, []);

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
            src={`https://www.youtube.com/embed/${activeStream.videoId}?autoplay=1&mute=0&controls=0&modestbranding=1&rel=0&showinfo=0&loop=1&playsinline=1&enablejsapi=1&iv_load_policy=3&disablekb=1&fs=0`}
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
        {/* Top bar — frosted glass card + dice */}
        <div className="flex items-center justify-center gap-3 sm:gap-4 px-3 pt-8 sm:pt-10 lg:pt-14">
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

          {/* Dice — random stream button, outside navbar */}
          <button
            onClick={randomStream}
            className="self-stretch aspect-square flex items-center justify-center rounded-2xl bg-[var(--sv-stone-950)]/40 backdrop-blur-xl border border-white/[0.06] shadow-[0_4px_30px_rgba(0,0,0,0.3)] text-[var(--sv-stone-500)] hover:text-white hover:bg-[var(--sv-stone-950)]/60 transition-all duration-500 hover:rotate-180 hover:scale-110"
            title="Random stream"
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="2" width="20" height="20" rx="3" />
              <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          </button>
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

          {/* Sound button — shows unmute prompt if muted, otherwise sound-on indicator */}
          <button
            onClick={toggleMute}
            className={`p-3 rounded-full bg-[var(--sv-stone-950)]/40 backdrop-blur-xl border border-white/[0.06] transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.3)] self-end ${
              muted
                ? "text-white animate-pulse border-white/20"
                : "text-[var(--sv-stone-500)] hover:text-[var(--sv-stone-300)]"
            }`}
            title={muted ? "Click to unmute" : "Sound on"}
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

      {/* ── Scrim when drawer is open ── */}
      <div
        className={`absolute inset-0 bg-[var(--sv-stone-950)]/60 backdrop-blur-[2px] transition-all duration-500 z-15 ${
          drawerOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setDrawerOpen(false)}
      />

      {/* ── Browse Streams Drawer ── */}
      <div
        className="absolute left-0 right-0 bottom-0 z-20 overflow-hidden"
        style={{ top: "auto" }}
      >
        {/* Drawer handle / toggle bar — always visible */}
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-[var(--sv-stone-950)]/60 backdrop-blur-xl border-t border-white/[0.06] cursor-pointer group/handle hover:bg-[var(--sv-stone-950)]/80 transition-all duration-300"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            className={`transition-transform duration-500 text-[var(--sv-stone-400)] group-hover/handle:text-white ${
              drawerOpen ? "rotate-180" : ""
            }`}
          >
            <path
              d="M5 12L10 7L15 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[10px] tracking-[0.15em] uppercase font-semibold text-[var(--sv-stone-400)] group-hover/handle:text-white transition-colors duration-300">
            {drawerOpen ? "Close" : "Browse streams"}
          </span>
          <span className="text-[10px] text-[var(--sv-stone-600)] font-mono">
            {filteredStreams.length}
          </span>
        </button>

        {/* Drawer content — height-animated grid */}
        <div
          className="transition-[max-height,opacity] duration-500 ease-out overflow-hidden"
          style={{
            maxHeight: drawerOpen ? "50vh" : "0px",
            opacity: drawerOpen ? 1 : 0,
          }}
        >
          <div className="bg-[var(--sv-stone-950)]/85 backdrop-blur-2xl overflow-y-auto scrollbar-hide" style={{ maxHeight: "50vh" }}>
            <div
              ref={stripRef}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-1 p-2 sm:p-3"
            >
              {filteredStreams.map((stream, idx) => {
                const isActive = idx === currentIndex;
                return (
                  <button
                    key={stream.id}
                    onClick={() => { goTo(idx); setDrawerOpen(false); }}
                    className={`relative overflow-hidden aspect-video transition-all duration-300 group/thumb ${
                      isActive
                        ? "ring-2 ring-amber-400/70 ring-offset-1 ring-offset-black/50"
                        : "opacity-70 hover:opacity-100 hover:scale-[1.03]"
                    }`}
                  >
                    <img
                      src={`https://img.youtube.com/vi/${stream.videoId}/mqdefault.jpg`}
                      alt={stream.location}
                      className="w-full h-full object-cover"
                      draggable={false}
                      loading="lazy"
                    />
                    {/* Gradient overlay with label */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover/thumb:opacity-100 transition-opacity duration-300" />
                    <div className="absolute inset-x-0 bottom-0 px-2 py-1.5">
                      <p className="text-[10px] sm:text-[11px] text-white/90 font-semibold truncate leading-tight drop-shadow-lg">
                        {stream.location}
                      </p>
                      <p className="text-[8px] sm:text-[9px] text-white/50 truncate leading-tight mt-0.5 opacity-0 group-hover/thumb:opacity-100 transition-opacity duration-300">
                        {stream.description}
                      </p>
                    </div>
                    {isActive && (
                      <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-amber-500/90 rounded-full px-1.5 py-0.5">
                        <span className="block w-1.5 h-1.5 rounded-full bg-white animate-breathe" />
                        <span className="text-[7px] font-bold text-white uppercase tracking-wider">Now</span>
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
