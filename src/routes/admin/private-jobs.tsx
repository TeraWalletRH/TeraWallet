import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import {
  Lock,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ArrowRightLeft,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/private-jobs" as any)({
  component: PrivateJobsModule,
});

function PrivateJobsModule() {
  const [jobType, setJobType] = useState<"send" | "bridge">("send");
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Retry job state
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await adminApi.getPrivateJobs({ page, limit: 15, type: jobType });
      if (res.success) {
        setItems(res.items || []);
        setTotal(res.total || 0);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load private jobs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [page, jobType]);

  const handleRetryJob = async (id: string) => {
    try {
      setRetryingId(id);
      const res = await adminApi.retryPrivateJob(jobType, id);
      if (res.success) {
        toast.success(res.message || `Job ${id} reset to awaiting_deposit`);
        fetchJobs();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to retry job");
    } finally {
      setRetryingId(null);
    }
  };

  const totalPages = Math.ceil(total / 15) || 1;

  const getStatusBadge = (st: string) => {
    if (st.includes("confirmed")) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold uppercase">
          {st}
        </span>
      );
    }
    if (st.includes("failed") || st.includes("expired")) {
      return (
        <span className="px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-semibold uppercase">
          {st}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-semibold uppercase">
        {st}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Lock className="h-5 w-5 text-emerald-400" />
            Private Send & Cross-Chain Bridge Operations
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Monitor privacy-preserving mixer deposits, bridge relay jobs, and trigger manual state retries.
          </p>
        </div>

        <button
          onClick={fetchJobs}
          disabled={loading}
          className="px-3.5 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-semibold text-slate-300 transition-all flex items-center gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          Refresh Pipeline
        </button>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center gap-2 p-1.5 bg-slate-900 border border-slate-800 rounded-2xl w-fit">
        <button
          onClick={() => {
            setJobType("send");
            setPage(1);
          }}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            jobType === "send"
              ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Lock className="h-3.5 w-3.5" />
          Private Send Mixer Jobs
        </button>

        <button
          onClick={() => {
            setJobType("bridge");
            setPage(1);
          }}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
            jobType === "bridge"
              ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          Private Cross-Chain Bridge Jobs
        </button>
      </div>

      {/* Jobs Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-4">Job ID</th>
                <th className="p-4">Asset</th>
                <th className="p-4">Sender Address</th>
                <th className="p-4">{jobType === "bridge" ? "Destination & Recipient" : "Recipient Address"}</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Status</th>
                <th className="p-4">Created Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
                    Loading private jobs...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No private jobs found in queue.
                  </td>
                </tr>
              ) : (
                items.map((job: any) => (
                  <tr key={job.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 font-mono text-emerald-400">{job.id.slice(0, 8)}...</td>
                    <td className="p-4 font-bold text-white">{job.asset_symbol}</td>
                    <td className="p-4 font-mono text-slate-300">{job.sender_address}</td>
                    <td className="p-4 font-mono text-slate-200">
                      {jobType === "bridge"
                        ? `Chain ${job.destination_chain_id}: ${job.recipient_address}`
                        : job.recipient_address}
                    </td>
                    <td className="p-4 font-semibold text-white">{job.amount}</td>
                    <td className="p-4">{getStatusBadge(job.status)}</td>
                    <td className="p-4 text-slate-400">
                      {new Date(job.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleRetryJob(job.id)}
                        disabled={retryingId === job.id}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ml-auto disabled:opacity-50"
                      >
                        <RotateCcw
                          className={`h-3.5 w-3.5 ${retryingId === job.id ? "animate-spin text-emerald-400" : ""}`}
                        />
                        Reset / Retry
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
            Showing {items.length} of {total} {jobType === "bridge" ? "bridge" : "send"} jobs
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
    </div>
  );
}
