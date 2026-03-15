"use client";

import { useState, useEffect, useCallback } from "react";

interface Stats {
  totalPageViews: number;
  uniqueVisitorsThisMonth: number;
  uniqueVisitorsAllTime: number;
  avgWatchTimeMs: number;
  avgSwitchTimeMs: number;
  topStreams: { id: string; location: string; category: string; count: number }[];
  categoryBreakdown: Record<string, number>;
  dailyViews: Record<string, number>;
}

function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#1a1918]/60 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6">
      <p className="text-[#8a8578] text-xs uppercase tracking-widest font-medium mb-2">{label}</p>
      <p className="text-[#e8e4dc] text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[#5c5850] text-xs mt-1">{sub}</p>}
    </div>
  );
}

function BarChart({ data, maxBars = 14 }: { data: Record<string, number>; maxBars?: number }) {
  const entries = Object.entries(data).sort((a, b) => a[0].localeCompare(b[0])).slice(-maxBars);
  const max = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="flex items-end gap-1.5 h-32">
      {entries.map(([label, value]) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-amber-500/30 rounded-t-sm min-h-[2px] transition-all duration-500"
            style={{ height: `${(value / max) * 100}%` }}
          />
          <span className="text-[8px] text-[#5c5850] rotate-[-45deg] origin-top-left whitespace-nowrap">
            {label.slice(5)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async (key: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/analytics?key=${encodeURIComponent(key)}`);
      if (!res.ok) {
        if (res.status === 401) {
          setError("Invalid password");
          setAuthenticated(false);
        } else {
          setError("Failed to fetch analytics");
        }
        return;
      }
      const data = await res.json();
      setStats(data.stats);
      setAuthenticated(true);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    fetchStats(password);
  };

  // Auto-refresh every 30s
  useEffect(() => {
    if (!authenticated) return;
    const interval = setInterval(() => fetchStats(password), 30000);
    return () => clearInterval(interval);
  }, [authenticated, password, fetchStats]);

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#0f0e0d] flex items-center justify-center p-4">
        <div className="bg-[#1a1918]/80 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-8 w-full max-w-sm shadow-2xl">
          <h1 className="text-[#e8e4dc] text-xl font-semibold tracking-wide mb-1">Stillview Admin</h1>
          <p className="text-[#5c5850] text-sm mb-6">Enter your admin password to continue.</p>

          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-[#0f0e0d] border border-white/[0.08] rounded-xl px-4 py-3 text-[#e8e4dc] text-sm placeholder-[#3a3832] focus:outline-none focus:border-amber-500/30 transition-colors"
              autoFocus
            />
            {error && (
              <p className="text-red-400/80 text-xs mt-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full mt-4 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/20 text-amber-200 rounded-xl px-4 py-3 text-sm font-medium transition-all disabled:opacity-40"
            >
              {loading ? "Checking..." : "Enter Dashboard"}
            </button>
          </form>

          <a href="/" className="block text-center text-[#5c5850] text-xs mt-6 hover:text-[#8a8578] transition-colors">
            Back to Stillview
          </a>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const totalCategoryViews = Object.values(stats.categoryBreakdown).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="min-h-screen bg-[#0f0e0d] text-[#e8e4dc]">
      {/* Header */}
      <div className="border-b border-white/[0.04] px-8 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-wide">Stillview Dashboard</h1>
          <p className="text-[#5c5850] text-xs mt-1">Analytics & stream performance</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => fetchStats(password)}
            className="text-xs text-[#8a8578] hover:text-[#e8e4dc] transition-colors"
          >
            Refresh
          </button>
          <a href="/" className="text-xs text-amber-500/60 hover:text-amber-400 transition-colors">
            View Site
          </a>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-8 py-8 space-y-8">
        {/* Key metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Unique Visitors (30d)"
            value={stats.uniqueVisitorsThisMonth}
            sub={`${stats.uniqueVisitorsAllTime} all-time`}
          />
          <StatCard
            label="Page Views"
            value={stats.totalPageViews}
          />
          <StatCard
            label="Avg Session Duration"
            value={formatDuration(stats.avgWatchTimeMs)}
            sub="time on site"
          />
          <StatCard
            label="Avg Switch Time"
            value={formatDuration(stats.avgSwitchTimeMs)}
            sub="between streams"
          />
        </div>

        {/* Daily views chart */}
        <div className="bg-[#1a1918]/60 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6">
          <p className="text-[#8a8578] text-xs uppercase tracking-widest font-medium mb-4">
            Daily Page Views (Last 14 Days)
          </p>
          {Object.keys(stats.dailyViews).length > 0 ? (
            <BarChart data={stats.dailyViews} />
          ) : (
            <p className="text-[#3a3832] text-sm text-center py-8">No data yet — views will appear here as visitors arrive.</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top streams */}
          <div className="bg-[#1a1918]/60 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6">
            <p className="text-[#8a8578] text-xs uppercase tracking-widest font-medium mb-4">
              Most Viewed Streams
            </p>
            {stats.topStreams.length > 0 ? (
              <div className="space-y-3">
                {stats.topStreams.slice(0, 10).map((stream, i) => (
                  <div key={stream.id} className="flex items-center gap-3">
                    <span className="text-[#3a3832] text-xs font-mono w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#c4bfb4] truncate">{stream.location}</p>
                      <p className="text-[10px] text-[#5c5850] uppercase tracking-wide">{stream.category}</p>
                    </div>
                    <span className="text-sm font-mono text-amber-500/70 tabular-nums">{stream.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#3a3832] text-sm text-center py-6">No stream views recorded yet.</p>
            )}
          </div>

          {/* Category breakdown */}
          <div className="bg-[#1a1918]/60 backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6">
            <p className="text-[#8a8578] text-xs uppercase tracking-widest font-medium mb-4">
              Category Breakdown
            </p>
            {Object.keys(stats.categoryBreakdown).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(stats.categoryBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([category, count]) => (
                    <div key={category}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-[#c4bfb4] capitalize">{category}</span>
                        <span className="text-xs font-mono text-[#5c5850]">
                          {count} ({Math.round((count / totalCategoryViews) * 100)}%)
                        </span>
                      </div>
                      <div className="h-1.5 bg-[#0f0e0d] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500/40 rounded-full transition-all duration-700"
                          style={{ width: `${(count / totalCategoryViews) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-[#3a3832] text-sm text-center py-6">No category data yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
