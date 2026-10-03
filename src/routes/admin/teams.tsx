import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import {
  ShieldCheck,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Users,
  FileText,
  X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/teams")({
  component: TeamsModule,
});

function TeamsModule() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Selected Team Detail Modal
  const [selectedSafe, setSelectedSafe] = useState<string | null>(null);
  const [teamDetail, setTeamDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      const res = await adminApi.getTeams({ page, limit: 15, search });
      if (res.success) {
        setItems(res.items || []);
        setTotal(res.total || 0);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load teams");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, [page, search]);

  const loadTeamDetail = async (safeAddress: string) => {
    try {
      setSelectedSafe(safeAddress);
      setDetailLoading(true);
      const res = await adminApi.getTeamDetail(safeAddress);
      if (res.success) {
        setTeamDetail(res);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load team detail");
    } finally {
      setDetailLoading(false);
    }
  };

  const totalPages = Math.ceil(total / 15) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            Team Treasuries (Safe Multi-sig)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Oversee team Safe multisig treasuries, member roles, and pending proposal approval queues.
          </p>
        </div>

        <button
          onClick={fetchTeams}
          disabled={loading}
          className="px-3.5 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-semibold text-slate-300 transition-all flex items-center gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Search Filter Bar */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by Safe address, team name, or creator..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500 transition-all"
          />
        </div>
      </div>

      {/* Teams Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-4">Safe Address</th>
                <th className="p-4">Team Name</th>
                <th className="p-4">Created By</th>
                <th className="p-4">Approval Threshold</th>
                <th className="p-4">Created Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
                    Loading team treasuries...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    No team treasuries found matching search filter.
                  </td>
                </tr>
              ) : (
                items.map((t: any) => (
                  <tr key={t.safe_address} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 font-mono text-emerald-400">{t.safe_address}</td>
                    <td className="p-4 font-bold text-slate-100">{t.name || "Unnamed Team"}</td>
                    <td className="p-4 font-mono text-slate-400">{t.created_by}</td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                        {t.approval_rule ? `${t.approval_rule} approvals` : "Majority (>50%)"}
                      </span>
                    </td>
                    <td className="p-4 text-slate-400">
                      {new Date(t.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => loadTeamDetail(t.safe_address)}
                        className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-medium transition-all"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>
            Showing {items.length} of {total} teams
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Team Detail Modal */}
      {selectedSafe && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  Team Treasury Inspector
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedSafe}</p>
              </div>
              <button
                onClick={() => setSelectedSafe(null)}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading ? (
              <div className="py-12 text-center text-slate-500">
                <RefreshCw className="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
                Fetching team details...
              </div>
            ) : teamDetail ? (
              <div className="space-y-6">
                {/* Members Section */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Users className="h-4 w-4 text-emerald-400" />
                    Team Members ({teamDetail.members?.length || 0})
                  </h4>

                  <div className="space-y-2">
                    {teamDetail.members?.map((m: any) => (
                      <div
                        key={m.address}
                        className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs"
                      >
                        <div className="font-mono text-slate-200">{m.address}</div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] uppercase font-bold">
                            {m.role}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">
                            {m.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Proposals Queue */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <FileText className="h-4 w-4 text-emerald-400" />
                    Proposals Queue ({teamDetail.proposals?.length || 0})
                  </h4>

                  {teamDetail.proposals?.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4 bg-slate-950/40 rounded-xl border border-slate-800/60">
                      No proposals in queue.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {teamDetail.proposals?.map((prop: any) => (
                        <div
                          key={prop.id}
                          className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-emerald-400 uppercase">
                              {prop.kind}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                              {prop.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center justify-between">
                            <span>To: {prop.to_address}</span>
                            <span>Value: {prop.value}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
