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
    <div className="min-h-screen bg-[#0d1712] flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background Decorative Forest Blobs */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#768143]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-[#243b2c]/30 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-[#16251c]/95 border border-[#243b2c] rounded-2xl p-8 shadow-2xl backdrop-blur-xl relative z-10">
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-16 w-16 mb-4 flex items-center justify-center">
            <img
              src="/logo.png"
              alt="Tera Wallet Logo"
              className="h-14 w-auto object-contain drop-shadow-[0_4px_12px_rgba(138,151,101,0.35)]"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/tera/logo.png";
              }}
            />
          </div>
          <h1 className="text-2xl font-bold text-[#f7f4de] tracking-tight">TERA WALLET</h1>
          <p className="text-xs font-semibold text-[#8a9765] mt-1 font-mono uppercase tracking-widest">
            Admin Console Sign In
          </p>
          <p className="text-xs text-[#9da998] mt-2 max-w-xs leading-relaxed">
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
            <label className="block text-xs font-semibold text-[#c4cebf] uppercase font-mono tracking-wider mb-2">
              Master Admin Passcode
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8a9765]" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin passcode..."
                className="w-full pl-10 pr-4 py-3 bg-[#0b130e] border border-[#2e4736] rounded-xl text-[#f7f4de] placeholder-[#647460] text-sm focus:outline-none focus:border-[#8a9765] focus:ring-1 focus:ring-[#8a9765] transition-all font-mono"
                autoFocus
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-[#243b2c] hover:bg-[#52643e] border border-[#768143] hover:border-[#8a9765] text-[#f7f4de] hover:text-white font-bold rounded-xl text-sm transition-all shadow-lg shadow-[#768143]/15 flex items-center justify-center gap-2 disabled:opacity-50 font-mono uppercase tracking-wider"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#8a9765]" />
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

        <div className="mt-8 pt-6 border-t border-[#243b2c] text-center">
          <p className="text-[11px] text-[#72806a] font-mono uppercase tracking-wider">
            Protected Environment • Robinhood Chain Mainnet (4663)
          </p>
        </div>
      </div>
    </div>
  );
}
