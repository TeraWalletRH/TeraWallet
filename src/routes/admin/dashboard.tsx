import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import {
  Users,
  AtSign,
  Mail,
  ShieldCheck,
  CreditCard,
  Lock,
  Coins,
  Activity,
  ArrowUpRight,
  RefreshCw,
  TrendingUp,
  Clock,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export const Route = createFileRoute("/admin/dashboard" as any)({
  component: AdminDashboardOverview,
});

const sampleChartData = [
  { name: "Mon", accounts: 4, jobs: 12, staking: 1500 },
  { name: "Tue", accounts: 7, jobs: 18, staking: 2300 },
  { name: "Wed", accounts: 9, jobs: 24, staking: 3100 },
  { name: "Thu", accounts: 12, jobs: 31, staking: 4500 },
  { name: "Fri", accounts: 15, jobs: 39, staking: 5200 },
  { name: "Sat", accounts: 18, jobs: 44, staking: 6800 },
  { name: "Sun", accounts: 22, jobs: 52, staking: 8100 },
];

function AdminDashboardOverview() {
  const [stats, setStats] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await adminApi.getStats();
      if (res.success) {
        setStats(res.stats);
        setRecentActivity(res.recentActivity || []);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load platform metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const cards = [
    {
      title: "Total Accounts",
      value: stats?.totalAccounts ?? 0,
      icon: Users,
      color: "from-blue-500/20 to-indigo-500/20 text-blue-400 border-blue-500/30",
      href: "/admin/accounts",
      desc: "Smart wallets & EOAs",
    },
    {
      title: "Active Session Keys",
      value: stats?.totalActiveSessions ?? 0,
      icon: ShieldCheck,
      color: "from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/30",
      href: "/admin/accounts",
      desc: "Delegated session scopes",
    },
    {
      title: "Registered Handles",
      value: stats?.totalTags ?? 0,
      icon: AtSign,
      color: "from-purple-500/20 to-pink-500/20 text-purple-400 border-purple-500/30",
      href: "/admin/tags",
      desc: "Verified @tags",
    },
    {
      title: "Business Emails",
      value: stats?.totalBusinessEmails ?? 0,
      icon: Mail,
      color: "from-amber-500/20 to-orange-500/20 text-amber-400 border-amber-500/30",
      href: "/admin/business-emails",
      desc: "Verified merchant inboxes",
    },
    {
      title: "Team Treasuries",
      value: stats?.totalTeams ?? 0,
      icon: ShieldCheck,
      color: "from-cyan-500/20 to-blue-500/20 text-cyan-400 border-cyan-500/30",
      href: "/admin/teams",
      desc: "Safe multi-sig treasuries",
    },
    {
      title: "Payment Links",
      value: stats?.totalPaymentLinks ?? 0,
      icon: CreditCard,
      color: "from-emerald-500/20 to-green-500/20 text-emerald-400 border-emerald-500/30",
      href: "/admin/payment-links",
      desc: "Merchant checkout requests",
    },
    {
      title: "Private Jobs",
      value: (stats?.totalPrivateSendJobs ?? 0) + (stats?.totalPrivateBridgeJobs ?? 0),
      icon: Lock,
      color: "from-rose-500/20 to-pink-500/20 text-rose-400 border-rose-500/30",
      href: "/admin/private-jobs",
      desc: "Mixer & bridge operations",
    },
    {
      title: "Staking Epochs",
      value: stats?.totalStakedEpochs ?? 0,
      icon: Coins,
      color: "from-amber-500/20 to-yellow-500/20 text-amber-400 border-amber-500/30",
      href: "/admin/staking",
      desc: "Custodial TERA rewards",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-gradient-to-r from-slate-900 via-slate-900/90 to-emerald-950/40 border border-slate-800 rounded-2xl relative overflow-hidden">
        <div className="space-y-1 relative z-10">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <h2 className="text-xl font-bold text-white tracking-tight">Platform System Overview</h2>
          </div>
          <p className="text-xs text-slate-400">
            Real-time telemetry and management metrics across Tera Wallet operations.
          </p>
        </div>

        <button
          onClick={fetchStats}
          disabled={loading}
          className="self-start md:self-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-all flex items-center gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          Refresh Stats
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm">
          {error}
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.title}
              to={card.href as any}
              className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-all hover:shadow-lg hover:shadow-emerald-500/5 group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400">{card.title}</span>
                  <div
                    className={`h-9 w-9 rounded-xl bg-gradient-to-br border flex items-center justify-center ${card.color}`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-white tracking-tight">
                  {loading ? "..." : card.value}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">{card.desc}</span>
                <span className="text-emerald-400 font-medium group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                  View <ArrowUpRight className="h-3 w-3" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Analytics Chart & Activity Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Platform Growth & Activity</h3>
            </div>
            <span className="text-xs text-slate-500 font-mono">Weekly aggregate</span>
          </div>

          <div className="h-64 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sampleChartData}>
                <defs>
                  <linearGradient id="colorAccounts" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorJobs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    borderRadius: "12px",
                    color: "#f8fafc",
                    fontSize: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="accounts"
                  stroke="#10b981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorAccounts)"
                  name="Accounts"
                />
                <Area
                  type="monotone"
                  dataKey="jobs"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorJobs)"
                  name="Private Jobs"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recent Admin Audit Activity Feed */}
        <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4 flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Recent Audit Logs</h3>
            </div>
            <Link to={"/admin/audit-logs" as any} className="text-xs text-emerald-400 hover:underline">
              View all
            </Link>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto max-h-72 pr-1">
            {recentActivity.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                No recent administrative activity logged.
              </div>
            ) : (
              recentActivity.map((log: any, idx: number) => (
                <div
                  key={log.id || idx}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-400">{log.action}</span>
                    <span className="text-[10px] text-slate-500">
                      {log.created_at ? new Date(log.created_at).toLocaleTimeString() : "Just now"}
                    </span>
                  </div>
                  <div className="text-slate-400 font-mono text-[11px] truncate">
                    {log.target_entity}: {log.target_id}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
