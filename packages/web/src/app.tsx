/**
 * App root component: Locale -> Theme -> Auth -> LocaleScope -> Router provider composition.
 * LocaleScope (a remount boundary) sits inside AuthProvider: switching language rebuilds the UI tree without
 * re-fetching auth, avoiding a full-screen white flash from RequireAuth briefly seeing user=undefined.
 * Also installs the app-wide file-drop guard: a file dropped where no drop zone claimed it
 * (the composer's FileDropZone is the only one) must not trigger the browser's default
 * navigate-to-file, which would silently replace the running app.
 */
import { useEffect } from "react";
import { LocaleProvider, LocaleScope } from "./state/locale";
import { ThemeProvider } from "./state/theme";
import { AuthProvider } from "./state/auth";
import { AppRouter } from "./router";
import { Toaster } from "./components/ui/toast";
import { guardWindowDragOver, guardWindowDrop } from "./lib/file-drop";

export function App() {
  // Window listeners run after any React drop-zone handler on the bubble path, so the guard
  // only acts on file drags nothing claimed (see lib/file-drop.ts).
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
