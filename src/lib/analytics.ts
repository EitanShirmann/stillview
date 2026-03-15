/** Client-side analytics helper — sends events to /api/analytics */

let sessionId: string | null = null;
let pageLoadTime = 0;
let lastStreamTime = 0;

function getSessionId(): string {
  if (sessionId) return sessionId;
  // Check sessionStorage first
  const stored = typeof window !== "undefined" ? sessionStorage.getItem("sv_sid") : null;
  if (stored) {
    sessionId = stored;
    return stored;
  }
  // Generate a new session ID
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  sessionId = id;
  if (typeof window !== "undefined") {
    sessionStorage.setItem("sv_sid", id);
  }
  return id;
}

function getVisitorId(): string {
  if (typeof window === "undefined") return "server";
  let vid = localStorage.getItem("sv_vid");
  if (!vid) {
    vid = `v-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem("sv_vid", vid);
  }
  return vid;
}

function sendEvent(type: string, data: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const payload = {
    type,
    sessionId: getSessionId(),
    visitorId: getVisitorId(),
    timestamp: Date.now(),
    ...data,
  };
  // Use sendBeacon for reliability (works even on page close)
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  navigator.sendBeacon("/api/analytics", blob);
}

export function trackPageView() {
  pageLoadTime = Date.now();
  lastStreamTime = Date.now();
  sendEvent("page_view", {
    url: window.location.pathname,
    referrer: document.referrer || null,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  });
}

export function trackStreamView(streamId: string, streamLocation: string, category: string) {
  const now = Date.now();
  const switchTime = lastStreamTime > 0 ? now - lastStreamTime : 0;
  lastStreamTime = now;
  sendEvent("stream_view", {
    streamId,
    streamLocation,
    category,
    switchTimeMs: switchTime,
  });
}

export function trackStreamWatch(streamId: string, durationMs: number) {
  sendEvent("stream_watch", {
    streamId,
    durationMs,
  });
}

export function trackCategoryChange(category: string) {
  sendEvent("category_change", { category });
}

export function trackGlobeOpen() {
  sendEvent("globe_open");
}

export function trackSessionEnd() {
  const totalTime = pageLoadTime > 0 ? Date.now() - pageLoadTime : 0;
  sendEvent("session_end", { totalTimeMs: totalTime });
}

// Auto-track session end on page unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", trackSessionEnd);
}
