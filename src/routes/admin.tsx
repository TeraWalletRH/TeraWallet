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
      <div className="min-h-screen bg-[#0d1712] text-[#f2f0ee] font-sans antialiased">
        <Toaster position="top-right" theme="dark" />
        <Outlet />
      </div>
    );
  }

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-[#0d1712] flex flex-col items-center justify-center text-[#9da998] gap-3 font-sans">
        <RefreshCw className="h-8 w-8 animate-spin text-[#8a9765]" />
        <p className="text-sm font-medium font-mono uppercase tracking-wider">Verifying admin credentials...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1712] text-[#f2f0ee] font-sans flex flex-col md:flex-row antialiased">
      <Toaster position="top-right" theme="dark" />

      {/* Mobile Top Bar */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-[#16251c] border-b border-[#243b2c]">
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="Tera Wallet Logo"
            className="h-7 w-auto object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).src = "/tera/logo.png";
            }}
          />
          <span className="font-bold text-sm tracking-tight text-[#f7f4de]">TERA ADMIN</span>
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-md bg-[#243b2c] text-[#c4cebf] hover:text-white"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-[#142119] border-r border-[#243b2c] flex flex-col transition-transform duration-200 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Brand Logo Header */}
        <div className="p-5 border-b border-[#243b2c] flex items-center justify-between bg-[#111c15]">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Tera Wallet Logo"
              className="h-9 w-auto object-contain drop-shadow-[0_2px_8px_rgba(138,151,101,0.3)]"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/tera/logo.png";
              }}
            />
            <div>
              <h1 className="font-bold text-base tracking-tight text-[#f7f4de] leading-none">TERA WALLET</h1>
              <span className="text-[10px] font-semibold tracking-widest text-[#8a9765] uppercase font-mono mt-0.5 block">
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
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider font-mono transition-all ${
                  isActive
                    ? "bg-[#243b2c] text-[#f7f4de] border border-[#768143] shadow-md shadow-[#768143]/10"
                    : "text-[#9da998] hover:text-[#f7f4de] hover:bg-[#1a2c20]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${isActive ? "text-[#8a9765]" : "text-[#72806a]"}`} />
                  <span>{item.name}</span>
                </div>
                {isActive && <ChevronRight className="h-3.5 w-3.5 text-[#8a9765]" />}
              </Link>
            );
          })}
        </nav>

        {/* User Info & Sign Out Footer */}
        <div className="p-4 border-t border-[#243b2c] bg-[#111c15] flex items-center justify-between">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="h-8 w-8 rounded-full bg-[#243b2c] border border-[#768143]/50 flex items-center justify-center text-xs font-semibold text-[#f7f4de] shrink-0 font-mono">
              AD
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-[#f7f4de] truncate">Master Operator</p>
              <p className="text-[10px] text-[#8a9765] font-mono flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#8a9765] inline-block animate-pulse" />
                Session Active
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title="Sign out"
            className="p-2 text-[#72806a] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Desktop Header */}
        <header className="hidden md:flex items-center justify-between px-8 py-4 bg-[#142119]/80 border-b border-[#243b2c] backdrop-blur-md sticky top-0 z-40">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-[#72806a]">Admin Console /</span>
            <h2 className="text-lg font-bold text-[#f7f4de] tracking-tight">
              {NAV_ITEMS.find((i) => i.href === location.pathname)?.name || "Dashboard Overview"}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3 py-1 rounded-full bg-[#243b2c]/80 border border-[#768143]/40 text-[#8a9765] text-xs font-mono uppercase tracking-wider flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#8a9765] animate-pulse" />
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
