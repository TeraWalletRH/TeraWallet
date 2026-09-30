import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import {
  Users,
  Search,
  Shield,
  Key,
  Trash2,
  RefreshCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  X,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/accounts" as any)({
  component: AccountsModule,
});

function AccountsModule() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Selected account for detail modal
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [accountDetail, setAccountDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Revoke session state
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const res = await adminApi.getAccounts({ page, limit: 15, search });
      if (res.success) {
        setItems(res.items || []);
        setTotal(res.total || 0);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [page, search]);

  const loadDetail = async (address: string) => {
    try {
      setSelectedAddress(address);
      setDetailLoading(true);
      const res = await adminApi.getAccountDetail(address);
      if (res.success) {
        setAccountDetail(res);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch account detail");
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      setRevokingId(sessionId);
      const res = await adminApi.revokeSessionKey(sessionId);
      if (res.success) {
        toast.success("Session key revoked successfully");
        if (selectedAddress) {
          loadDetail(selectedAddress);
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to revoke session key");
    } finally {
      setRevokingId(null);
    }
  };

  const totalPages = Math.ceil(total / 15) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Users className="h-5 w-5 text-emerald-400" />
            Accounts & Session Keys
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage user accounts, inspect delegated session scopes, and revoke active sessions.
          </p>
        </div>

        <button
          onClick={fetchAccounts}
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
            placeholder="Search by owner address or smart account address..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500 transition-all"
          />
        </div>
      </div>

      {/* Accounts Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-4">Owner Address</th>
                <th className="p-4">Smart Account</th>
                <th className="p-4">Chain ID</th>
                <th className="p-4">Created Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
                    Loading accounts...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    No accounts found matching search filter.
                  </td>
                </tr>
              ) : (
                items.map((acc: any) => (
                  <tr key={acc.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 font-mono text-emerald-400">{acc.owner_address}</td>
                    <td className="p-4 font-mono text-slate-200">{acc.account_address}</td>
                    <td className="p-4 font-mono">
                      <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[11px] text-slate-300">
                        {acc.chain_id}
                      </span>
                    </td>
                    <td className="p-4 text-slate-400">
                      {new Date(acc.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => loadDetail(acc.account_address)}
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
            Showing {items.length} of {total} accounts
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

      {/* Detail Modal */}
      {selectedAddress && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Shield className="h-5 w-5 text-emerald-400" />
                  Account Inspection
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedAddress}</p>
              </div>
              <button
                onClick={() => setSelectedAddress(null)}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading ? (
              <div className="py-12 text-center text-slate-500">
                <RefreshCw className="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
                Fetching account details...
              </div>
            ) : accountDetail ? (
              <div className="space-y-6">
                {/* Account Info Cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-[11px] text-slate-500 uppercase font-semibold">
                      Owner EOA
                    </span>
                    <p className="text-xs font-mono text-emerald-400 truncate">
                      {accountDetail.account?.owner_address}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
                    <span className="text-[11px] text-slate-500 uppercase font-semibold">
                      Chain Network
                    </span>
                    <p className="text-xs font-semibold text-slate-200">
                      Robinhood Chain (ID: {accountDetail.account?.chain_id || 4663})
                    </p>
                  </div>
                </div>

                {/* Session Keys */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Key className="h-4 w-4 text-emerald-400" />
                    Delegated Session Keys ({accountDetail.sessionKeys?.length || 0})
                  </h4>

                  {accountDetail.sessionKeys?.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4 bg-slate-950/40 rounded-xl border border-slate-800/60">
                      No active session keys registered for this account.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {accountDetail.sessionKeys?.map((sk: any) => (
                        <div
                          key={sk.id}
                          className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-4 text-xs"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-slate-200 truncate">
                                {sk.session_key_address}
                              </span>
                              {sk.is_revoked ? (
                                <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-medium">
                                  Revoked
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-medium">
                                  Active
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500">
                              Expires: {new Date(sk.expires_at).toLocaleString()}
                            </p>
                          </div>

                          {!sk.is_revoked && (
                            <button
                              onClick={() => handleRevokeSession(sk.id)}
                              disabled={revokingId === sk.id}
                              className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 shrink-0"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Revoke
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Intent History */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Recent Intents ({accountDetail.intents?.length || 0})
                  </h4>

                  {accountDetail.intents?.length === 0 ? (
                    <p className="text-xs text-slate-500 italic p-4 bg-slate-950/40 rounded-xl border border-slate-800/60">
                      No transaction intents recorded.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {accountDetail.intents?.map((intent: any) => (
                        <div
                          key={intent.id}
                          className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-semibold text-emerald-400">
                              {intent.intent_type}
                            </span>
                            <span className="text-[11px] text-slate-500 ml-2">
                              Agent: {intent.agent_id}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {intent.status}
                          </span>
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
