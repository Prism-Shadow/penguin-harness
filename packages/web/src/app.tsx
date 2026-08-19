/**
 * App root component: Locale -> Theme -> Auth -> LocaleScope -> Router provider composition.
 * LocaleScope (a remount boundary) sits inside AuthProvider: switching language rebuilds the UI tree without
 * re-fetching auth, avoiding a full-screen white flash from RequireAuth briefly seeing user=undefined.
 * Also installs the app-wide file-drop guard: a file dropped outside the chat area — the only
 * region that claims file drags (features/chat/drop-zone.tsx) — must not trigger the browser's
 * default navigate-to-file, which would silently replace the running app and any unsent draft.
 * The guard is deliberately silent: no overlay, no attachment, no toast. It does not make a
 * drop on the sidebar do something; it makes it do nothing.
 */
import { useEffect } from "react";
import { LocaleProvider, LocaleScope } from "./state/locale";
import { ThemeProvider } from "./state/theme";
import { AuthProvider } from "./state/auth";
import { AppRouter } from "./router";
import { Toaster } from "./components/ui/toast";
import { guardWindowDragOver, guardWindowDrop } from "./lib/file-drop";

export function App() {
  // The guard reads `defaultPrevented` rather than assuming it runs last: the chat area's
  // drop zone is a window listener too, so the two fire in registration order. Both orders
  // converge — whichever runs second either finds the drag already claimed and bails, or
  // upgrades the no-drop cursor to copy (see lib/file-drop.ts).
  useEffect(() => {
    window.addEventListener("dragover", guardWindowDragOver);
    window.addEventListener("drop", guardWindowDrop);
    return () => {
      window.removeEventListener("dragover", guardWindowDragOver);
      window.removeEventListener("drop", guardWindowDrop);
    };
  }, []);
  return (
    <LocaleProvider>
      <ThemeProvider>
        <AuthProvider>
          <LocaleScope>
            <AppRouter />
            {/* Top toast overlay: portaled to body, z-index above modals, shared site-wide. */}
            <Toaster />
          </LocaleScope>
        </AuthProvider>
      </ThemeProvider>
    </LocaleProvider>
  );
}
