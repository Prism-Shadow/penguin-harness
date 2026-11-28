/**
 * A system app that opens in the App Center's window, as the whole app: its full screen,
 * `/app/:projectId/system_agent/:appKey[?at=<location inside it>]`, the counterpart of an Agent
 * workbench's full page and, like it, outside the app shell. The same page's document fills the
 * window, in the frame every contributed page uses (lib/page-frame.tsx), with no window around it.
 *
 * - It starts at `at`, and the page's own moves replace `at` in this address, so a reload comes
 *   back to the same place.
 * - The floating exit ball and the command palette's "Exit full page" go back to the app's window
 *   at the place the page is now. A link inside the page (`penguin:navigate`) goes where it says.
 * - Until the server's pages have arrived the page says it is opening; a key that names no such
 *   app here (safe mode has none, or the viewer may not see it) says so, and the exit still leads
 *   to the App Center.
 */
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import type { PaletteAction } from "@prismshadow/penguin-ui";
import { windowAddress } from "../../lib/app-window-address";
import { useFullPageFrameAddress } from "../../lib/frame-address";
import { PageFrame } from "../../lib/page-frame";
import { usePaletteActions } from "../../lib/palette-actions";
import { useShortcutLabel } from "../../lib/shortcuts/use-keymap";
import { localizedText } from "../../lib/skill-use";
import { S } from "../../lib/strings";
import { systemAppKey, useSystemApps } from "../../lib/system-apps";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useWebAppPagesPending } from "../../lib/web-app-pages";
import { useLocale } from "../../state/locale";
import { rememberProject } from "../../state/project";
import { WorkbenchExitBall } from "../workbenches";

export function SystemAppPage() {
  const params = useParams();
  const projectId = params["projectId"] ?? "";
  const appKey = params["appKey"] ?? "";
  const navigate = useNavigate();
  const { locale } = useLocale();
  const pending = useWebAppPagesPending();
  const app = useSystemApps().find((one) => one.key === appKey && one.frame !== undefined);
  const title = app === undefined ? null : localizedText(locale, app.title, app.titleZh);
  useDocumentTitle(title);

  const { at, onLocation, onNavigate, place } = useFullPageFrameAddress();

  const exit = useMemo<PaletteAction[]>(
    () => [
      {
        id: "exit-full-page",
        label: S.appCenter.exitToWindow,
        keywords: ["exit", "leave", "full page", "app", "window"],
        run: () => {
          rememberProject(projectId);
          void navigate(windowAddress(systemAppKey(appKey), place()));
        },
      },
    ],
    [navigate, projectId, appKey, place],
  );
  usePaletteActions(exit);
  const paletteShortcut = useShortcutLabel("palette.toggle");

  return (
    // A window of its own (`isolate`), as an Agent workbench's full page is; the theme's canvas
    // shows through a page that paints no background of its own.
    <div className="relative isolate h-full w-full bg-canvas pt-[var(--window-band-height,0px)]">
      {app?.frame !== undefined && title !== null ? (
        <PageFrame
          src={app.frame}
          title={title}
          projectId={projectId}
          at={at}
          onLocation={onLocation}
          onNavigate={onNavigate}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-fg-muted">
          <span role="status">
            {pending ? S.workbenches.loadingPage : S.workbenches.noSuchPage}
          </span>
          <span>{S.workbenches.exitHint(paletteShortcut)}</span>
        </div>
      )}
      <WorkbenchExitBall label={S.workbenches.exitFullPageButton} onExit={() => exit[0]!.run()} />
    </div>
  );
}
