import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  ChevronRight,
  FileScan,
  FolderHeart,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  Pill,
  ShieldAlert,
  TrendingUp,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { formatSessionBadge } from '../lib/session';
import { BrandLogo } from './BrandLogo';
import { ThemeToggle } from './ThemeToggle';
import type { AuthUser } from '../types/api';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

interface AppShellProps {
  user: AuthUser;
  sessionExpiresAt?: string | null;
  sessionRememberMe?: boolean;
  platformTitle: string;
  accent: 'teal' | 'blue' | 'slate';
  navItems: NavItem[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  onLogout: () => void;
  notifications: NotificationItem[];
  onMarkNotificationRead: (id: string) => void;
  onRunScheduler: () => void;
  children: React.ReactNode;
}

export function getPatientNavItems(isCaregiver: boolean): NavItem[] {
  const items: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'medicines', label: 'My Medicines', icon: <Pill className="w-4 h-4" /> },
    { id: 'pharmacy-locator', label: 'Pharmacy Locator', icon: <MapPin className="w-4 h-4" /> },
    { id: 'prescriptions', label: 'Prescriptions OCR', icon: <FileScan className="w-4 h-4" /> },
    { id: 'records', label: 'Records & Visits', icon: <Calendar className="w-4 h-4" /> },
    { id: 'interactions', label: 'Interactions & Care', icon: <ShieldAlert className="w-4 h-4" /> },
    { id: 'analytics', label: 'Adherence Analytics', icon: <BarChart3 className="w-4 h-4" /> },
  ];
  if (isCaregiver) {
    return items.filter((i) => i.id !== 'prescriptions');
  }
  return items;
}

export function getPharmacyNavItems(): NavItem[] {
  return [
    { id: 'pharma-overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'pharma-inventory', label: 'Batch Inventory', icon: <Package className="w-4 h-4" /> },
    { id: 'pharma-transactions', label: 'Stock Ledger', icon: <Truck className="w-4 h-4" /> },
    { id: 'pharma-analytics', label: 'Analytics & ML', icon: <TrendingUp className="w-4 h-4" /> },
  ];
}

export function getAdminNavItems(): NavItem[] {
  return [
    { id: 'admin-audit', label: 'Audit & Jobs', icon: <Activity className="w-4 h-4" /> },
    { id: 'admin-users', label: 'Users & Tenants', icon: <Users className="w-4 h-4" /> },
  ];
}

export const AppShell: React.FC<AppShellProps> = ({
  user,
  sessionExpiresAt,
  sessionRememberMe = false,
  platformTitle,
  accent,
  navItems,
  activeTab,
  onSelectTab,
  onLogout,
  notifications,
  onMarkNotificationRead,
  onRunScheduler,
  children,
}) => {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const unreadCount = notifications.filter((n) => n.status !== 'read').length;
  const currentNavLabel = navItems.find((i) => i.id === activeTab)?.label ?? 'Workspace';

  const activeNavClasses =
    accent === 'blue'
      ? 'bg-blue-50 text-blue-800 font-semibold'
      : accent === 'slate'
      ? 'bg-slate-100 text-slate-900 font-semibold'
      : 'bg-teal-50 text-teal-800 font-semibold';

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
        <BrandLogo />
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-4 py-4 border-b border-slate-100">
        <p className="text-xs font-medium text-slate-500">Active Platform</p>
        <p className="font-display text-sm font-bold text-slate-900 mt-0.5 flex items-center gap-1.5">
          {accent === 'blue' ? (
            <Building2 className="w-4 h-4 text-blue-700 shrink-0" />
          ) : (
            <FolderHeart className="w-4 h-4 text-teal-700 shrink-0" />
          )}
          <span className="leading-snug">{platformTitle}</span>
        </p>
      </div>

      <nav aria-label="Primary Sidebar" className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                setMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer whitespace-nowrap ${
                isActive
                  ? activeNavClasses
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 space-y-3">
        <div className="text-xs text-slate-600">
          <p className="font-semibold text-slate-900 truncate">{user.fullName}</p>
          <p className="truncate text-slate-500">
            {user.role.charAt(0).toUpperCase() + user.role.slice(1)} · {user.email}
          </p>
          {sessionExpiresAt && (
            <p className="mt-1 text-[11px] font-mono text-slate-500 tabular-nums">
              {formatSessionBadge(sessionExpiresAt, sessionRememberMe)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out / Switch Portal</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-68 shrink-0 bg-white border-r border-slate-200">
        <div className="sticky top-0 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-64 max-w-full bg-white h-full border-r border-slate-200 z-10">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 min-w-0">
              <span className="hidden sm:inline truncate">{platformTitle}</span>
              <ChevronRight className="hidden sm:inline w-4 h-4 text-slate-400 shrink-0" />
              <span className="font-display font-semibold text-slate-900 truncate">
                {currentNavLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 relative">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setNotifOpen((prev) => !prev)}
              aria-label={`Notifications (${unreadCount} unread)`}
              className="relative inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Bell className="w-4 h-4" />
              <span>Alerts</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 text-[11px] font-semibold bg-amber-600 text-white rounded tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div
                role="region"
                aria-label="Notifications panel"
                className="absolute right-0 top-12 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <span className="font-display text-sm font-semibold text-slate-900">
                    Notification Center
                  </span>
                  <button
                    type="button"
                    onClick={onRunScheduler}
                    className="text-xs font-medium text-teal-700 hover:text-teal-800 cursor-pointer"
                  >
                    Run Reminder Scan
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500">No notifications recorded yet.</p>
                  ) : (
                    notifications.slice(0, 12).map((n) => (
                      <div
                        key={n.id}
                        className={`p-3.5 text-xs space-y-1 ${
                          n.status === 'read' ? 'bg-white text-slate-500' : 'bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">{n.title}</span>
                          {n.status !== 'read' && (
                            <button
                              type="button"
                              onClick={() => onMarkNotificationRead(n.id)}
                              className="text-[11px] font-medium text-teal-700 hover:underline cursor-pointer shrink-0"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                        <p className="text-slate-600 leading-relaxed">{n.body}</p>
                        <p className="text-[11px] font-mono text-slate-400 tabular-nums">
                          {n.kind.replace('_', ' ')} · {n.created_at.slice(0, 16).replace('T', ' ')} UTC
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>

        <footer className="border-t border-slate-200 bg-white px-6 py-3 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span>
              Informational management platform only · Not a diagnostic tool or substitute for licensed clinical care.
            </span>
          </span>
          <span className="font-mono text-slate-400">VeroMed</span>
        </footer>
      </div>
    </div>
  );
};
