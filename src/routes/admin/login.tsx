import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { adminApi, setAdminToken } from "@/lib/admin-api";
import { Shield, Lock, ArrowRight, Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/login" as any)({
  component: AdminLogin,
});

function AdminLogin() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError("Please enter the admin passcode");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const res = await adminApi.login(password);

      if (res.success && res.token) {
        setAdminToken(res.token);
        toast.success("Welcome, Admin!");
        navigate({ to: "/admin/dashboard" as any });
      } else {
        setError("Authentication failed");
      }
    } catch (err: any) {
      setError(err.message || "Invalid admin passcode");
      toast.error(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background Decorative Gradient Blobs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-xl relative z-10">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/20 mb-4">
            <Shield className="h-7 w-7 text-slate-950 stroke-[2.5]" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">TERA WALLET</h1>
          <p className="text-sm font-medium text-emerald-400 mt-1">Admin Dashboard Sign In</p>
          <p className="text-xs text-slate-400 mt-2 max-w-xs">
            Authorized administrative personnel only. Enter master security passcode to proceed.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium flex items-center gap-2">
              <Lock className="h-4 w-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Master Admin Passcode
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin key..."
                className="w-full pl-10 pr-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                autoFocus
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-sm transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-slate-950" />
                Authenticating...
              </>
            ) : (
              <>
                Sign In to Console
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
          <p className="text-[11px] text-slate-500 font-mono">
            Protected Environment • Robinhood Chain Mainnet (4663)
          </p>
        </div>
      </div>
    </div>
  );
}
