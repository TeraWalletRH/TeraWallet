import { createFileRoute, Link, Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { adminApi, removeAdminToken } from "@/lib/admin-api";
import {
  LayoutDashboard,
  Users,
  AtSign,
  Mail,
  ShieldCheck,
  CreditCard,
  Lock,
  Coins,
  FileText,
  LogOut,
  Shield,
  Menu,
  X,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { Toaster, toast } from "sonner";

export const Route = createFileRoute("/admin" as any)({
  component: AdminLayout,
});

const NAV_ITEMS = [
  { name: "Overview", href: "/admin/dashboard", icon: LayoutDashboard },
  { name: "Accounts & Sessions", href: "/admin/accounts", icon: Users },
  { name: "Handle Tags (@tags)", href: "/admin/tags", icon: AtSign },
  { name: "Business Emails", href: "/admin/business-emails", icon: Mail },
  { name: "Team Treasuries", href: "/admin/teams", icon: ShieldCheck },
  { name: "Payment Links", href: "/admin/payment-links", icon: CreditCard },
  { name: "Private Jobs", href: "/admin/private-jobs", icon: Lock },
  { name: "TERA Staking", href: "/admin/staking", icon: Coins },
  { name: "Audit Trail", href: "/admin/audit-logs", icon: FileText },
];

function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    // If on /admin/login, don't check auth for redirect loop
    if (location.pathname === "/admin/login") {
      setIsAuthenticated(false);
      return;
    }

    adminApi
      .me()
      .then(() => setIsAuthenticated(true))
      .catch(() => {
        setIsAuthenticated(false);
        removeAdminToken();
        navigate({ to: "/admin/login" as any });
      });
  }, [location.pathname]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await adminApi.logout();
      removeAdminToken();
      toast.success("Logged out successfully");
      navigate({ to: "/admin/login" as any });
    } catch {
      removeAdminToken();
      navigate({ to: "/admin/login" as any });
    } finally {
      setLoggingOut(false);
    }
  };

  // If on login route, render children directly
  if (location.pathname === "/admin/login") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased">
        <Toaster position="top-right" theme="dark" />
        <Outlet />
      </div>
    );
  }

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3 font-sans">
        <RefreshCw className="h-8 w-8 animate-spin text-emerald-500" />
        <p className="text-sm font-medium">Verifying admin credentials...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col md:flex-row antialiased">
      <Toaster position="top-right" theme="dark" />

      {/* Mobile Top Bar */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Shield className="h-5 w-5" />
          </div>
          <span className="font-bold text-sm tracking-tight text-white">TERA ADMIN</span>
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-md bg-slate-800 text-slate-300 hover:text-white"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-800/80 flex flex-col transition-transform duration-200 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Brand Logo */}
        <div className="p-6 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-slate-950 shadow-md shadow-emerald-500/20 font-bold">
              <Shield className="h-5 w-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="font-bold text-base tracking-tight text-white leading-none">TERA WALLET</h1>
              <span className="text-[10px] font-semibold tracking-wider text-emerald-400 uppercase">
                Admin Console
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.href ||
              (item.href === "/admin/dashboard" && location.pathname === "/admin");

            return (
              <Link
                key={item.href}
                to={item.href as any}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
                  <span>{item.name}</span>
                </div>
                {isActive && <ChevronRight className="h-3.5 w-3.5 text-emerald-400" />}
              </Link>
            );
          })}
        </nav>

        {/* User Info & Sign Out Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="h-8 w-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-200 shrink-0">
              AD
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-slate-200 truncate">Master Operator</p>
              <p className="text-[10px] text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                Session Active
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title="Sign out"
            className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Desktop Header */}
        <header className="hidden md:flex items-center justify-between px-8 py-4 bg-slate-900/40 border-b border-slate-800/60 backdrop-blur-md sticky top-0 z-40">
          <div>
            <span className="text-xs font-medium text-slate-400">Admin Console /</span>
            <h2 className="text-lg font-bold text-white tracking-tight">
              {NAV_ITEMS.find((i) => i.href === location.pathname)?.name || "Dashboard Overview"}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Robinhood Chain (4663)
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-4 md:p-8 flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
