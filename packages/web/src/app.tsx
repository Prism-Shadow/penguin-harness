/**
 * App root component: ClipboardWriter -> CodeHighlighter -> Locale -> Theme -> Background -> Auth -> LocaleScope ->
 * the shell's root (the router, from the booted module tree — see web-root.ts) provider
 * composition, with the app-wide overlays (toasts, tooltips, the unsaved-changes prompt)
 * beside the router. The shared UI package's copy controls get the app's clipboard
 * writer, and every code surface of the package gets the app's worker-backed code highlighter
 * (features/chat/code-highlight.ts).
 * LocaleScope (a remount boundary) sits inside AuthProvider: switching language rebuilds the UI tree without
 * re-fetching auth, avoiding a full-screen white flash from RequireAuth briefly seeing user=undefined.
 * The shell's root renders inside an error boundary whose fallback is the rescue panel
 * (rescue/rescue-panel.tsx); the command palette and the safe-mode marker mount beside it, each
 * in its own boundary, so a page that throws leaves the way back — the palette's harness
 * history, safe mode — on screen.
 * Also installs the app-wide file-drop guard: a file dropped outside the chat area — the only
 * region that claims file drags (features/chat/drop-zone.tsx) — must not trigger the browser's
 * default navigate-to-file, which would silently replace the running app and any unsent draft.
 * The guard is deliberately silent: no overlay, no attachment, no toast. It does not make a
 * drop on the sidebar do something; it makes it do nothing.
 */
import { useEffect, type ComponentType } from "react";

import {
  ClipboardWriterProvider,
  CodeHighlighterProvider,
  Toaster,
  TooltipLayer,
} from "@prismshadow/penguin-ui";
import { LocaleProvider, LocaleScope } from "./state/locale";
import { ThemeProvider } from "./state/theme";
import { BackgroundProvider } from "./state/background";
import { AuthProvider } from "./state/auth";
import type { AppRouterProps } from "./web-app/router";
import { UnsavedPrompt } from "./lib/unsaved/unsaved-prompt";
import { writeClipboard } from "./lib/clipboard";
import { guardWindowDragOver, guardWindowDrop } from "./lib/file-drop";
import { highlightCode } from "./lib/code-highlight";
import { ErrorBoundary } from "./rescue/error-boundary";
import { RescuePalette } from "./web-app";
import { RescuePanel } from "./rescue/rescue-panel";
import { SafeModeMarker } from "./rescue/safe-mode-marker";

const rescuePanel = (error: unknown) => <RescuePanel error={error} />;
const nothing = () => null;

/**
 * `Root`: the shell's root component, which `bootWeb()` returns. `initialPath`: mount the app on
 * an in-memory router opened at that path instead of the browser's address bar (see AppRouter)
 * — for a host document that frames the app.
 */
export function App({
  Root,
  initialPath,
}: {
  Root: ComponentType<AppRouterProps>;
  initialPath?: string;
}) {
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
    <ClipboardWriterProvider write={writeClipboard}>
      <CodeHighlighterProvider highlight={highlightCode}>
        <LocaleProvider>
          <ThemeProvider>
            <BackgroundProvider>
              <AuthProvider>
                <LocaleScope>
                  <ErrorBoundary fallback={rescuePanel}>
                    <Root {...(initialPath === undefined ? {} : { initialPath })} />
                  </ErrorBoundary>
                  <ErrorBoundary fallback={nothing}>
                    <RescuePalette />
                  </ErrorBoundary>
                  <ErrorBoundary fallback={nothing}>
                    <SafeModeMarker />
                  </ErrorBoundary>
                  {/* Top toast overlay: portaled to body, z-index above modals, shared site-wide. */}
                  <Toaster />
                  {/* The one "discard unsaved changes?" prompt every leave asks through, and the
                    unload guard while a form is dirty. Inside LocaleScope, so it reads the
                    dictionary of the language on screen. */}
                  <UnsavedPrompt />
                  {/* The hover hints of every `data-tooltip` element: one listener set, one panel. */}
                  <TooltipLayer />
                </LocaleScope>
              </AuthProvider>
            </BackgroundProvider>
          </ThemeProvider>
        </LocaleProvider>
      </CodeHighlighterProvider>
    </ClipboardWriterProvider>
  );
}
