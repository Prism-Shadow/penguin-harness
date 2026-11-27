import { useEffect, useMemo, useState } from "react";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { Segmented } from "@prismshadow/penguin-ui";
import type { LocatedShortcut } from "./arrangement";
import {
  S,
  localizedText,
  useInstallManifest,
  workbenchAppPath,
  useDocumentTitle,
  usePaletteActions,
  useLocale,
  setSelectedAppPath,
  pathWithAt,
  useWindowFrameAddress,
} from "@prismshadow/penguin-web/internal";

import {
  useAppPageTab,
  useWorkbenchPaletteActions,
  WorkbenchFrame,
  WorkbenchPageStatus,
} from "../workbenches";
import { WorkbenchRepairButton } from "@prismshadow/penguin-web/features/ai-create";
import { FrameAppBody } from "./frame-app-body";

interface WindowProps {
  appKey: string;
  projectId: string;
  shortcut: LocatedShortcut;
  title: string;
  /** Opens the full page at `path`: the page the window shows, at the place it is. */
  onFullScreen: (path: string) => void;
  exitFullScreen?: () => void;
  /** The app's workbench is gone (removed, or its Agent with it). */
  onGone: () => void;
}

/** A full-screen window names the page and offers its way out in the palette. */
function useFullScreenExit(title: string, exit: () => void) {
  useDocumentTitle(title);
  const actions = useMemo(
    () => [
      {
        id: "exit-full-page",
        label: S.workbenches.exitToWindow,
        keywords: ["exit", "full page"],
        run: exit,
      },
    ],
    [exit],
  );
  usePaletteActions(actions);
}

/** A system app has no versions: its full screen adds the exit alone. */
function SystemFullScreenActions({ title, exit }: { title: string; exit: () => void }) {
  useFullScreenExit(title, exit);
  return null;
}

/**
 * A workbench's full screen hides the sidebar row that carries its menu, so the palette also
 * offers its reload, version history and download while it is shown.
 */
function FullScreenActions({
  title,
  exit,
  projectId,
  shortcut,
  workbench,
  running,
}: Pick<WindowProps, "title" | "projectId" | "shortcut"> & {
  exit: () => void;
  workbench: WorkbenchInfo | null;
  running: boolean;
}) {
  // Registered ahead of the exit, which the palette therefore lists first.
  const modals = useWorkbenchPaletteActions(
    { projectId, agentId: shortcut.agentId, machineId: shortcut.machineId ?? null },
    workbench,
    title,
    running,
  );
  useFullScreenExit(title, exit);
  return modals;
}

function InstallManifest({
  projectId,
  shortcut,
  tab,
}: Pick<WindowProps, "projectId" | "shortcut"> & { tab?: string }) {
  useInstallManifest(
    projectId,
    shortcut.agentId,
    shortcut.workbenchId,
    tab,
    shortcut.machineId ?? null,
  );
  return null;
}

export function AppCenterWindow(props: WindowProps) {
  const src = props.shortcut.system?.frame;
  if (src === undefined) return <AgentWorkbenchWindow {...props} />;
  return (
    <section aria-label={props.title} className="relative h-full min-h-0">
      {props.exitFullScreen && (
        <SystemFullScreenActions title={props.title} exit={props.exitFullScreen} />
      )}
      <FrameAppBody
        appKey={props.appKey}
        projectId={props.projectId}
        src={src}
        title={props.title}
      />
    </section>
  );
}

function AgentWorkbenchWindow(props: WindowProps) {
  const { projectId, shortcut, onFullScreen, onGone } = props;
  const { locale } = useLocale();
  const machineId = shortcut.machineId ?? null;
  const { tab, workbench, pages, off, gone, failure } = useAppPageTab({
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
  /** Keep the selected workbench page when the window changes panes. */
  const [picked, setPicked] = useState<string | null>(null);
  const shown = (picked === null ? null : pages.find((page) => page.key === picked)) ?? tab;
  const path = shown
    ? workbenchAppPath(projectId, shortcut.agentId, shortcut.workbenchId, shown.key, machineId)
    : shortcut.path;
  useEffect(() => setSelectedAppPath(props.appKey, path), [props.appKey, path]);
  // The window's address keeps where the page is, per page of the workbench.
  const { at, onLocation, onNavigate, place } = useWindowFrameAddress(props.appKey, shown?.key);
  return (
    <section aria-label={props.title} className="flex h-full min-h-0 flex-col">
      {props.exitFullScreen && (
        <>
          <FullScreenActions
            title={shown?.title ?? props.title}
            exit={props.exitFullScreen}
            projectId={projectId}
            shortcut={shortcut}
            workbench={workbench}
            running={!off}
          />
          <InstallManifest projectId={projectId} shortcut={shortcut} tab={shown?.key} />
        </>
      )}
      {/* Only a workbench of several pages draws anything above its content: the switch between
          them. The app's own actions are in its sidebar row's menu. */}
      {!props.exitFullScreen && pages.length >= 2 && shown && (
        <div className="shrink-0 overflow-x-auto px-2 py-1">
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
      )}
      <div className="relative min-h-0 flex-1">
        {shown ? (
          // Keyed on the page: each one is its own document, and the selector switches between them.
          <WorkbenchFrame
            key={shown.tabId}
            projectId={projectId}
            agentId={shortcut.agentId}
            tab={shown}
            at={at}
            onLocation={onLocation}
            onNavigate={onNavigate}
            onFillApp={() => onFullScreen(pathWithAt(path, place()))}
          />
        ) : (
          <WorkbenchPageStatus
            projectId={projectId}
            agentId={shortcut.agentId}
            machineId={machineId}
            workbench={workbench}
            loading={tab === undefined && failure === null}
            off={off}
            failure={failure}
            repair={(failed) => <WorkbenchRepairButton target={failed} />}
          />
        )}
      </div>
    </section>
  );
}
