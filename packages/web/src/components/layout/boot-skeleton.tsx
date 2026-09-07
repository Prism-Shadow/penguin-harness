/**
 * What the screen shows while the app is not yet able to: the frame of AppLayout — a sidebar
 * on wide screens, a top bar on narrow ones — with nothing in it.
 *
 * It exists twice on purpose. index.html carries the same frame as static markup with its own
 * inline CSS, so the very first paint (before the bundle has even been fetched) already has the
 * shape of the app; React then replaces it with this component while `/api/me` is in flight
 * (RequireAuth), and with the real layout once the user is known. The two copies must agree on
 * the frame — widths, the bar's height, the colours — or the boot visibly jumps: keep the
 * dimensions here in step with index.html and AppLayout when any of them changes.
 *
 * Sidebar width follows the persisted collapse preference the layout itself reads, so a user
 * who keeps the rail narrow does not watch a wide panel snap shut on every boot.
 */
export function BootSkeleton() {
  let collapsed = false;
  try {
    collapsed = localStorage.getItem("penguin.sidebarCollapsed") === "1";
  } catch {
    // Site data blocked: the default width is as good a guess as any.
  }
  return (
    <div className="flex h-full" aria-hidden>
      <aside
        className={`hidden shrink-0 border-r border-gray-200 bg-gray-50 md:block dark:border-gray-800 dark:bg-gray-900 ${
          collapsed ? "w-12" : "w-64 lg:w-72"
        }`}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="h-12 shrink-0 border-b border-gray-200 bg-white md:hidden dark:border-gray-800 dark:bg-gray-950" />
        <main className="min-h-0 min-w-0 flex-1" />
      </div>
    </div>
  );
}
