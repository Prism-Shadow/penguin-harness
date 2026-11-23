/**
 * An app in its window, over the main area: the App Center's grid opens it, and so do the sidebar's
 * app list, the Agent's settings row and the full page's exit. The sidebar and the rest of the
 * app stay. The title bar (the UI package's `AppWindowBar`) names the app, switches between its
 * pages when it has two or more (a segmented control after the name), and carries three flat
 * buttons: minimize, which hides the window and keeps the app running; open it full screen (the
 * full page of the page shown, whose exit comes back to this window); and close, which ends the
 * app. Where the window lives and what minimize keeps is app-center-windows.tsx's.
 *
 * The page itself is the same frame the full page shows, read the same way (useAppPageTab): it
 * follows the workbench as it reloads. A page may ask to fill the app, which is the full screen
 * button's. When the workbench is gone, the window says so to its host, which ends the app.
 */
import { useEffect, useState, type ReactNode } from "react";
import { AppWindowBar, ICON_SIZE, Segmented } from "@prismshadow/penguin-ui";
import type { LocatedShortcut } from "./arrangement";
import { S } from "../../lib/strings";
import { localizedText } from "../../lib/skill-use";
import { workbenchAppPath } from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { useAppPageTab, WorkbenchFrame } from "../workbenches";
import { FrameAppBody } from "./frame-app-body";
import { TileIcon } from "./app-tile";

/** The title bar's icon: one rung above a line glyph in the same slot, as an avatar sits. */
const BAR_ICON_PX = ICON_SIZE.sectionMark;

interface WindowProps {
  appKey: string;
  projectId: string;
  shortcut: LocatedShortcut;
  title: string;
  onMinimize: () => void;
  onClose: () => void;
  /** Opens the full page at `path`: the page the window shows. */
  onFullScreen: (path: string) => void;
  /** The app's workbench is gone (removed, or its Agent with it). */
  onGone: () => void;
}

export function AppCenterWindow(props: WindowProps) {
  const src = props.shortcut.system?.frame;
  if (src === undefined) return <AgentWorkbenchWindow {...props} />;
  return (
    <WindowShell {...props} fullScreen={() => props.onFullScreen(props.shortcut.path)}>
      <FrameAppBody
        appKey={props.appKey}
        projectId={props.projectId}
        src={src}
        title={props.title}
      />
    </WindowShell>
  );
}

function WindowShell({
  title,
  shortcut,
  onMinimize,
  onClose,
  fullScreen,
  controls,
  children,
}: Pick<WindowProps, "title" | "shortcut" | "onMinimize" | "onClose"> & {
  fullScreen: () => void;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col">
      <AppWindowBar
        icon={<TileIcon shortcut={shortcut} title={title} size={BAR_ICON_PX} />}
        title={title}
        controls={controls}
        labels={{
          minimize: S.appCenter.windowMinimize,
          fullScreen: S.appCenter.windowFullScreen,
          close: S.appCenter.windowClose,
        }}
        onMinimize={onMinimize}
        onFullScreen={fullScreen}
        onClose={onClose}
      />
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  );
}

function AgentWorkbenchWindow(props: WindowProps) {
  const { projectId, shortcut, onFullScreen, onGone } = props;
  const { locale } = useLocale();
  const machineId = shortcut.machineId ?? null;
  const { tab, pages, off, gone, failure } = useAppPageTab({
    projectId,
    agentId: shortcut.agentId,
    workbenchId: shortcut.workbenchId,
    tabKey: shortcut.tab,
    machineId,
    ownEvents: false,
  });
  useEffect(() => {
    if (gone) onGone();
    // Once per answer that says so: the host's handler is a fresh function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone]);
  /** The page picked in the bar; until then the one the shortcut opens. */
  const [picked, setPicked] = useState<string | null>(null);
  const shown = (picked === null ? null : pages.find((page) => page.key === picked)) ?? tab;
  const fullScreen = () =>
    onFullScreen(
      shown
        ? workbenchAppPath(projectId, shortcut.agentId, shortcut.workbenchId, shown.key, machineId)
        : shortcut.path,
    );
  return (
    <WindowShell
      {...props}
      fullScreen={fullScreen}
      controls={
        pages.length >= 2 && shown ? (
          <div className="shrink-0">
            <Segmented
              options={pages.map((page) => ({
                value: page.key,
                label: localizedText(locale, page.title, page.titleZh),
              }))}
              value={shown.key}
              onChange={setPicked}
              cols={Math.min(pages.length, 5) as 2 | 3 | 4 | 5}
            />
          </div>
        ) : undefined
      }
    >
      {shown ? (
        // Keyed on the page: each one is its own document, and the bar switches between them.
        <WorkbenchFrame
          key={shown.tabId}
          projectId={projectId}
          tab={shown}
          onFillApp={fullScreen}
        />
      ) : (
        <p
          role="status"
          className="flex h-full items-center justify-center px-6 text-sm text-fg-muted"
        >
          {tab === undefined && failure === null
            ? S.workbenches.loadingPage
            : (failure ?? (off ? S.workbenches.offPage : S.workbenches.noSuchPage))}
        </p>
      )}
    </WindowShell>
  );
}
