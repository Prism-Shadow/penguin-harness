/**
 * App main layout:
 * - >=md: left single-column sidebar (Project / new chat / nav / Session list / user config) + main content;
 * - <md: top thin bar (hamburger -> sidebar drawer + brand name) + main content.
 * All chrome uses solid backgrounds and avoids stacking contexts (frosted-glass/transform would trap overlay z-index).
 */
import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { Drawer } from "../ui/drawer";
import { Sidebar } from "./sidebar";
import { ChangePasswordDialog } from "../account/change-password-dialog";

/** Narrow-rail nav icons (matches Sidebar NAV_ICONS). */
const RAIL_NAV: ReadonlyArray<{ to: string; label: string; icon: string }> = [
  { to: "/chat", label: "chat", icon: "M8 10h8M8 14h5M21 12a9 9 0 1 1-4.2-7.6L21 4v5h-5" },
  {
    to: "/agents",
    label: "agents",
    icon: "M12 3v3m-6 4a6 6 0 0 1 12 0v5a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-5zm3 3h.01M15 13h.01",
  },
  {
    to: "/skills",
    label: "skills",
    icon: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  },
  {
    to: "/models",
    label: "models",
    icon: "M7 7h10v10H7zM4 10h3m10 0h3M4 14h3m10 0h3M10 4v3m4-3v3m-4 10v3m4-3v3",
  },
  { to: "/usage", label: "usage", icon: "M4 20V10m6 10V4m6 16v-7m4 7H2" },
  { to: "/traces", label: "traces", icon: "M4 6h16M4 12h10M4 18h13" },
];

export function AppLayout() {
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  // Desktop sidebar collapse (persisted): collapsed state leaves a narrow rail to expand from.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("penguin.sidebarCollapsed") === "1",
  );
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("penguin.sidebarCollapsed", next ? "1" : "0");
      return next;
    });

  return (
    <div className="flex h-full">
      {/* Desktop: single-column sidebar (collapsible to a narrow rail) */}
      <aside
        className={`hidden shrink-0 border-r border-gray-200 bg-gray-50 md:block dark:border-gray-800 dark:bg-gray-900 ${
          collapsed ? "w-12" : "w-64 lg:w-72"
        }`}
      >
        {collapsed ? (
          // Collapsed narrow rail: expand button on top, icon nav below, user avatar at the bottom; no Logo shown.
          <div className="flex h-full flex-col items-center gap-1 py-2.5">
            <button
              type="button"
              title={S.nav.expandSidebar}
              aria-label={S.nav.expandSidebar}
              onClick={toggleCollapsed}
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M9 6l6 6-6 6M20 4v16" />
              </svg>
            </button>
            <nav className="mt-1 flex flex-col items-center gap-1">
              {RAIL_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
                      isActive
                        ? "bg-gray-200/70 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                        : "text-gray-500 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    }`
                  }
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d={item.icon} />
                  </svg>
                </NavLink>
              ))}
            </nav>
            <button
              type="button"
              title={`${user?.userId ?? ""} · ${S.nav.expandSidebar}`}
              aria-label={user?.userId ?? S.auth.admin}
              onClick={toggleCollapsed}
              className="mt-auto flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white dark:bg-gray-200 dark:text-gray-900"
            >
              {(user?.userId ?? "?").slice(0, 1).toUpperCase()}
            </button>
          </div>
        ) : (
          <Sidebar onCollapse={toggleCollapsed} />
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: top thin bar (hamburger + brand) */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 md:hidden dark:border-gray-800 dark:bg-gray-950">
          <button
            type="button"
            aria-label={S.chat.sessionList}
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold">{S.appName}</span>
        </header>

        {/* Initial-password notice banner (seed/admin-set password): disappears once passwordIsInitial clears after a successful change */}
        {user?.passwordIsInitial && (
          <div className="flex shrink-0 items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
            <span>{S.account.initialPasswordBanner}</span>
            <button
              type="button"
              className="shrink-0 font-medium underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100"
              onClick={() => setChangePasswordOpen(true)}
            >
              {S.account.changeNow}
            </button>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />

      {/* Mobile: sidebar drawer */}
      <Drawer open={drawerOpen} side="left" title={S.appName} onClose={() => setDrawerOpen(false)}>
        <div className="h-full bg-gray-50 dark:bg-gray-900">
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </div>
      </Drawer>
    </div>
  );
}
