import { useEffect, useState } from "react";
import { Segmented } from "@prismshadow/penguin-ui";
import type { LocatedShortcut } from "./arrangement";
import { S } from "../../lib/strings";
import { localizedText } from "../../lib/skill-use";
import { workbenchAppPath } from "../../lib/workbench-tabs";
import { useLocale } from "../../state/locale";
import { useAppPageTab, WorkbenchFrame } from "../workbenches";
import { FrameAppBody } from "./frame-app-body";
import { setSelectedAppPath } from "../../lib/running-apps";

interface WindowProps {
  appKey: string;
  projectId: string;
  shortcut: LocatedShortcut;
  title: string;
  /** Opens the full page at `path`: the page the window shows. */
  onFullScreen: (path: string) => void;
  /** The app's workbench is gone (removed, or its Agent with it). */
  onGone: () => void;
}

export function AppCenterWindow(props: WindowProps) {
  const src = props.shortcut.system?.frame;
  if (src === undefined) return <AgentWorkbenchWindow {...props} />;
  return (
    <section aria-label={props.title} className="relative h-full min-h-0">
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
  /** Keep the selected workbench page when the window changes panes. */
  const [picked, setPicked] = useState<string | null>(null);
  const shown = (picked === null ? null : pages.find((page) => page.key === picked)) ?? tab;
  const path = shown
    ? workbenchAppPath(projectId, shortcut.agentId, shortcut.workbenchId, shown.key, machineId)
    : shortcut.path;
  useEffect(() => setSelectedAppPath(props.appKey, path), [props.appKey, path]);
  return (
    <section aria-label={props.title} className="flex h-full min-h-0 flex-col">
      {pages.length >= 2 && shown && (
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
            onFillApp={() => onFullScreen(path)}
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
      </div>
    </section>
  );
}
