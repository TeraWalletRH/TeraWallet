import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import {
  AtSign,
  Search,
  Plus,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  X,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/tags")({
  component: TagsModule,
});

function TagsModule() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Register Tag Modal
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Delete Confirm Modal
  const [deletingTag, setDeletingTag] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTags = async () => {
    try {
      setLoading(true);
      const res = await adminApi.getTags({ page, limit: 15, search });
      if (res.success) {
        setItems(res.items || []);
        setTotal(res.total || 0);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load tags");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, [page, search]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTag.trim() || !newOwner.trim()) {
      toast.error("Tag and owner EVM address are required");
      return;
    }

    try {
      setSubmitting(true);
      const res = await adminApi.registerTag(newTag, newOwner);
      if (res.success) {
        toast.success(res.message || "Tag assigned successfully");
        setShowRegisterModal(false);
        setNewTag("");
        setNewOwner("");
        fetchTags();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to assign tag");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingTag) return;
    try {
      setDeleting(true);
      const res = await adminApi.deleteTag(deletingTag);
      if (res.success) {
        toast.success(res.message || `@${deletingTag} released`);
        setDeletingTag(null);
        fetchTags();
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to delete tag");
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / 15) || 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <AtSign className="h-5 w-5 text-emerald-400" />
            Handle Tags Moderation (@tags)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Register, reassign, or release registered user handle tags. Lookalike collisions are automatically prevented.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchTags}
            disabled={loading}
            className="px-3.5 py-2 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl text-xs font-semibold text-slate-300 transition-all flex items-center gap-2"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
            Refresh
          </button>

          <button
            onClick={() => setShowRegisterModal(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
          >
            <Plus className="h-4 w-4" />
            Assign Tag
          </button>
        </div>
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
            placeholder="Search by tag name or owner EVM address..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-xs focus:outline-none focus:border-emerald-500 transition-all"
          />
        </div>
      </div>

      {/* Tags Table */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-4">Handle Tag</th>
                <th className="p-4">Collision Skeleton</th>
                <th className="p-4">Owner Address</th>
                <th className="p-4">Claim Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    <RefreshCw className="h-6 w-6 animate-spin text-emerald-400 mx-auto mb-2" />
                    Loading handle tags...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
                    No handle tags found matching search filter.
                  </td>
                </tr>
              ) : (
                items.map((t: any) => (
                  <tr key={t.tag} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 font-bold text-emerald-400">@{t.tag}</td>
                    <td className="p-4 font-mono text-slate-400">{t.skeleton}</td>
                    <td className="p-4 font-mono text-slate-200">{t.owner_address}</td>
                    <td className="p-4 text-slate-400">
                      {new Date(t.claimed_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => setDeletingTag(t.tag)}
                        className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ml-auto"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Release
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
            Showing {items.length} of {total} handle tags
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

      {/* Assign Tag Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <AtSign className="h-5 w-5 text-emerald-400" />
                Assign Handle Tag
              </h3>
              <button
                onClick={() => setShowRegisterModal(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Handle Tag Name (without @)
                </label>
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="e.g. alice"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Owner EVM Address
                </label>
                <input
                  type="text"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl flex items-center gap-2"
                >
                  {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  Assign Tag
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingTag && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-4 text-center">
            <div className="h-12 w-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto">
              <AlertTriangle className="h-6 w-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white">Release @{deletingTag}?</h3>
              <p className="text-xs text-slate-400">
                This will delete the handle tag registration and make @{deletingTag} available for re-registration.
              </p>
            </div>

            <div className="pt-4 flex justify-center gap-3">
              <button
                onClick={() => setDeletingTag(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-rose-500 hover:bg-rose-400 text-slate-950 text-xs font-bold rounded-xl flex items-center gap-2"
              >
                {deleting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                Confirm Release
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
