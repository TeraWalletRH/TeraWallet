import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { FileText, RefreshCw, ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/audit-logs")({
  component: AuditLogsModule,
});

function AuditLogsModule() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Selected JSON details popup
  const [selectedDetails, setSelectedDetails] = useState<any>(null);

  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      const res = await adminApi.getAuditLogs({ page, limit: 15 });
      if (res.success) {
        setItems(res.items || []);
        setTotal(res.total || 0);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [page]);

  const totalPages = Math.ceil(total / 15) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-400" />
            Admin Action Audit Trail
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Immutable administrative operation log tracking all modification and destruction actions.
          </p>
        </div>

        <button
          onClick={fetchAuditLogs}
          disabled={loading}
          className="px-3.5 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-semibold text-slate-300 transition-all flex items-center gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Audit Logs Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-4">Action</th>
                <th className="p-4">Target Entity</th>
                <th className="p-4">Target ID</th>
                <th className="p-4">IP Address</th>
                <th className="p-4">Timestamp</th>
                <th className="p-4 text-right">Payload Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
                    Loading audit logs...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    No audit log records recorded yet.
                  </td>
                </tr>
              ) : (
                items.map((log: any) => (
                  <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 font-bold text-emerald-400">{log.action}</td>
                    <td className="p-4 font-mono text-slate-300">{log.target_entity}</td>
                    <td className="p-4 font-mono text-slate-200 truncate max-w-xs">{log.target_id}</td>
                    <td className="p-4 font-mono text-slate-400">{log.ip || "127.0.0.1"}</td>
                    <td className="p-4 text-slate-400">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => setSelectedDetails(log.details || {})}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ml-auto"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Inspect Details
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
            Showing {items.length} of {total} audit records
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

      {/* JSON Inspection Modal */}
      {selectedDetails && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-400" />
                Payload Action Details
              </h3>
              <button
                onClick={() => setSelectedDetails(null)}
                className="px-2 py-1 rounded bg-slate-800 text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-emerald-400 text-xs font-mono overflow-auto max-h-72 whitespace-pre-wrap">
              {JSON.stringify(selectedDetails, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
