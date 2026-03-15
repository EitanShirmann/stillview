import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), ".analytics");
const EVENTS_FILE = path.join(DATA_DIR, "events.jsonl");

// Ensure data directory exists
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// POST — receive events from client
export async function POST(req: NextRequest) {
  try {
    const event = await req.json();

    // Basic validation
    if (!event.type || !event.sessionId) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }

    // Add server timestamp and IP hash for unique visitor counting
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || "unknown";
    // Simple hash — not reversible, just for counting uniques
    const ipHash = Buffer.from(ip).toString("base64").slice(0, 12);

    const record = {
      ...event,
      serverTs: Date.now(),
      ipHash,
    };

    ensureDir();
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(record) + "\n");

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }
}

// GET — return aggregated analytics (protected by password)
export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get("key");
  const adminKey = process.env.ADMIN_KEY || "stillview2024";

  if (password !== adminKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  ensureDir();

  if (!fs.existsSync(EVENTS_FILE)) {
    return NextResponse.json({ events: [], stats: getEmptyStats() });
  }

  const raw = fs.readFileSync(EVENTS_FILE, "utf-8").trim();
  if (!raw) {
    return NextResponse.json({ events: [], stats: getEmptyStats() });
  }

  const events = raw.split("\n").map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);

  const stats = computeStats(events);

  return NextResponse.json({ stats, recentEvents: events.slice(-200) });
}

function getEmptyStats() {
  return {
    totalPageViews: 0,
    uniqueVisitorsThisMonth: 0,
    uniqueVisitorsAllTime: 0,
    avgWatchTimeMs: 0,
    avgSwitchTimeMs: 0,
    topStreams: [],
    categoryBreakdown: {},
    dailyViews: {},
  };
}

interface AnalyticsEvent {
  type: string;
  sessionId: string;
  visitorId: string;
  timestamp: number;
  serverTs: number;
  ipHash: string;
  streamId?: string;
  streamLocation?: string;
  category?: string;
  switchTimeMs?: number;
  durationMs?: number;
  totalTimeMs?: number;
  [key: string]: unknown;
}

function computeStats(events: AnalyticsEvent[]) {
  const now = Date.now();
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;

  // Unique visitors
  const allVisitors = new Set(events.map((e) => e.visitorId));
  const monthVisitors = new Set(
    events.filter((e) => e.serverTs >= monthAgo).map((e) => e.visitorId)
  );

  // Page views
  const pageViews = events.filter((e) => e.type === "page_view");

  // Stream views for top streams
  const streamViews = events.filter((e) => e.type === "stream_view");
  const streamCounts: Record<string, { count: number; location: string; category: string }> = {};
  for (const ev of streamViews) {
    if (!ev.streamId) continue;
    if (!streamCounts[ev.streamId]) {
      streamCounts[ev.streamId] = { count: 0, location: ev.streamLocation || ev.streamId, category: ev.category || "unknown" };
    }
    streamCounts[ev.streamId].count++;
  }
  const topStreams = Object.entries(streamCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([id, data]) => ({ id, ...data }));

  // Average switch time
  const switchTimes = streamViews
    .map((e) => e.switchTimeMs)
    .filter((t): t is number => typeof t === "number" && t > 0 && t < 300000); // cap at 5 min
  const avgSwitchTimeMs = switchTimes.length > 0
    ? Math.round(switchTimes.reduce((a, b) => a + b, 0) / switchTimes.length)
    : 0;

  // Average watch time (from session_end total time)
  const sessionEnds = events.filter((e) => e.type === "session_end");
  const watchTimes = sessionEnds
    .map((e) => e.totalTimeMs)
    .filter((t): t is number => typeof t === "number" && t > 0 && t < 7200000); // cap at 2 hrs
  const avgWatchTimeMs = watchTimes.length > 0
    ? Math.round(watchTimes.reduce((a, b) => a + b, 0) / watchTimes.length)
    : 0;

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  for (const ev of streamViews) {
    const cat = ev.category || "unknown";
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  }

  // Daily views (last 30 days)
  const dailyViews: Record<string, number> = {};
  for (const ev of pageViews) {
    if (ev.serverTs < monthAgo) continue;
    const day = new Date(ev.serverTs).toISOString().split("T")[0];
    dailyViews[day] = (dailyViews[day] || 0) + 1;
  }

  return {
    totalPageViews: pageViews.length,
    uniqueVisitorsThisMonth: monthVisitors.size,
    uniqueVisitorsAllTime: allVisitors.size,
    avgWatchTimeMs,
    avgSwitchTimeMs,
    topStreams,
    categoryBreakdown,
    dailyViews,
  };
}
