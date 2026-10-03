import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import {
  CreditCard,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Ban,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/payment-links")({
  component: PaymentLinksModule,
});

function PaymentLinksModule() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);

  // Cancel Link confirmation state
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const fetchLinks = async () => {
    try {
      setLoading(true);
      const res = await adminApi.getPaymentLinks({
        page,
        limit: 15,
        search,
        status: status === "all" ? "" : status,
      });
      if (res.success) {
        setItems(res.items || []);
        setTotal(res.total || 0);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load payment links");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLinks();
  }, [page, search, status]);

  const handleCancelLink = async () => {
    if (!cancellingId) return;
    try {
      setCancelling(true);
      const res = await adminApi.cancelPaymentLink(cancellingId);
      if (res.success) {
        toast.success(res.message || `Payment link ${cancellingId} cancelled`);
        setCancellingId(null);
        fetchLinks();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel payment link");
    } finally {
      setCancelling(false);
    }
  };

  const totalPages = Math.ceil(total / 15) || 1;

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "paid":
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold uppercase">
            Paid
          </span>
        );
      case "cancelled":
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-semibold uppercase">
            Cancelled
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-semibold uppercase">
            Open
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-400" />
            Merchant Payment Links
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Monitor merchant USDG payment checkout links and force-cancel open links when necessary.
          </p>
        </div>

        <button
          onClick={fetchLinks}
          disabled={loading}
          className="px-3.5 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-semibold text-slate-300 transition-all flex items-center gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Search & Filter Bar */}
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
            placeholder="Search by link ID, merchant address, or payer..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500 transition-all"
          />
        </div>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-full sm:w-44 px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-300 text-xs focus:outline-none focus:border-emerald-500"
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Payment Links Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-4">Link ID</th>
                <th className="p-4">Merchant Address</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Status</th>
                <th className="p-4">Note / Details</th>
                <th className="p-4">Created Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
                    Loading payment links...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No payment links found matching search filter.
                  </td>
                </tr>
              ) : (
                items.map((link: any) => (
                  <tr key={link.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 font-mono font-bold text-emerald-400">{link.id}</td>
                    <td className="p-4 font-mono text-slate-200">{link.merchant}</td>
                    <td className="p-4 font-semibold text-white">
                      {link.amount} <span className="text-[11px] text-slate-400 font-normal">USDG</span>
                    </td>
                    <td className="p-4">{getStatusBadge(link.status)}</td>
                    <td className="p-4 text-slate-400 max-w-xs truncate">{link.note || "—"}</td>
                    <td className="p-4 text-slate-400">
                      {new Date(link.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      {link.status === "open" ? (
                        <button
                          onClick={() => setCancellingId(link.id)}
                          className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ml-auto"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          Cancel
                        </button>
                      ) : (
                        <span className="text-slate-600 font-mono text-[11px]">—</span>
                      )}
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
            Showing {items.length} of {total} payment links
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

      {/* Cancel Confirmation Modal */}
      {cancellingId && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto">
              <AlertTriangle className="h-6 w-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white">Cancel Link {cancellingId}?</h3>
              <p className="text-xs text-slate-400">
                This will mark the merchant payment link as cancelled and prevent any future payment settlement.
              </p>
            </div>

            <div className="pt-4 flex justify-center gap-3">
              <button
                onClick={() => setCancellingId(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Go Back
              </button>
              <button
                onClick={handleCancelLink}
                disabled={cancelling}
                className="px-4 py-2 bg-rose-500 hover:bg-rose-400 text-slate-950 text-xs font-bold rounded-xl flex items-center gap-2"
              >
                {cancelling && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
