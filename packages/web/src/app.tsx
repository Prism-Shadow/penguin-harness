/**
 * App root component: CodeHighlighter -> Locale -> Theme -> Auth -> LocaleScope -> Router provider
 * composition. The code highlighter is the app's worker-backed one
 * (features/chat/code-highlight.ts), handed to every code surface of the shared UI package below.
 * LocaleScope (a remount boundary) sits inside AuthProvider: switching language rebuilds the UI tree without
 * re-fetching auth, avoiding a full-screen white flash from RequireAuth briefly seeing user=undefined.
 * Also installs the app-wide file-drop guard: a file dropped outside the chat area — the only
 * region that claims file drags (features/chat/drop-zone.tsx) — must not trigger the browser's
 * default navigate-to-file, which would silently replace the running app and any unsent draft.
 * The guard is deliberately silent: no overlay, no attachment, no toast. It does not make a
 * drop on the sidebar do something; it makes it do nothing.
 */
import { useEffect } from "react";
import { CodeHighlighterProvider } from "@prismshadow/penguin-ui";
import { LocaleProvider, LocaleScope } from "./state/locale";
import { ThemeProvider } from "./state/theme";
import { AuthProvider } from "./state/auth";
import { AppRouter } from "./router";
import { Toaster } from "./components/ui/toast";
import { TooltipLayer } from "./components/ui/tooltip";
import { guardWindowDragOver, guardWindowDrop } from "./lib/file-drop";
import { highlightCode } from "./features/chat/code-highlight";

/**
 * `initialPath`: mount the app on an in-memory router opened at that path instead of the
 * browser's address bar (see AppRouter) — for a host document that frames the app.
 */
export function App({ initialPath }: { initialPath?: string } = {}) {
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
    <CodeHighlighterProvider highlight={highlightCode}>
      <LocaleProvider>
        <ThemeProvider>
          <AuthProvider>
            <LocaleScope>
              <AppRouter {...(initialPath === undefined ? {} : { initialPath })} />
              {/* Top toast overlay: portaled to body, z-index above modals, shared site-wide. */}
              <Toaster />
              {/* The hover hints of every `data-tooltip` element: one listener set, one panel. */}
              <TooltipLayer />
            </LocaleScope>
          </AuthProvider>
        </ThemeProvider>
      </LocaleProvider>
    </CodeHighlighterProvider>
  );
}
