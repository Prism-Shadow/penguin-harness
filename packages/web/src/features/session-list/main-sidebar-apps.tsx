/**
 * The sidebar's 「应用」 group, at the top of the scroll area under the three nav rows and above the
 * conversations (PRFC-0033): the apps of the Agent the page works under, then any other app still
 * running in a window, each marked running (use-sidebar-apps.ts). It is not there while the Agent
 * has no app in the sidebar and nothing runs.
 *
 * - A row opens the app in the App Center's window over the main area (lib/running-apps.ts):
 *   the same live window when the app runs, and closing or minimizing it returns to the page the
 *   row was clicked on. The row is selected while its window is on screen. It carries the tile's
 *   marks: running, building (it does not open until built, unless it runs) and failed.
 * - A row's menu: Open; Remove from sidebar (the Workbenches row's 「展示到侧边栏」, the
 *   installation's setting every member shares), for a row the Agent's setting lists; View in
 *   agent settings.
 * - The header folds the group like a conversation group's, remembered in this browser, and its
 *   action opens the Agent's Workbenches sub-page.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  APP_ROW_ICON_PX,
  AppRow,
  Fold,
  GroupHeader,
  ICONS,
  ICON_SIZE,
  type RowActionItem,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { Icon } from "../../components/ui/group-list";
import { agentSettingsPath } from "../../lib/agent-location";
import { GROUP_ACTION_CLASS } from "../../lib/main-sidebar-persistence";
import { useRestoreApp } from "../../lib/running-apps";
import { S } from "../../lib/strings";
import { toastApiError } from "../../lib/toast-api-error";
import { TileIcon } from "../app-center";
import { useSidebarApps, type SidebarAppRow } from "./use-sidebar-apps";

/** Whether the group is folded, per browser: a viewer's convenience, kept through a reload. */
const FOLDED_KEY = "penguin.sidebarApps.folded";

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeFolded(folded: boolean): void {
  try {
    if (folded) localStorage.setItem(FOLDED_KEY, "1");
    else localStorage.removeItem(FOLDED_KEY);
  } catch {
    // Storage refused (a private window): the fold holds for this visit only.
  }
}

/** The words a row's state is said in: the same as the App Center tile's. */
function stateOf(row: SidebarAppRow): string | null {
  if (row.running) return S.appCenter.running;
  if (row.build === "building") return S.appCenter.building;
  if (row.build === "failed") return S.appCenter.broken;
  return null;
}

export function MainSidebarApps({ onNavigate }: { onNavigate?: () => void }) {
  const { agent, rows, reload } = useSidebarApps();
  const restore = useRestoreApp();
  const navigate = useNavigate();
  const [folded, setFolded] = useState(readFolded);
  if (agent === null || rows.length === 0) return null;

  const go = (to: string) => {
    void navigate(to);
    onNavigate?.();
  };
  const open = (row: SidebarAppRow) => {
    restore(row.key, row.shortcut ?? undefined);
    onNavigate?.();
  };
  const removeFromSidebar = (row: SidebarAppRow) =>
    void api
      .setWorkbenchSidebar(agent.projectId, row.agentId, row.workbenchId, false, row.machineId)
      .then(reload, toastApiError);
  const menuOf = (row: SidebarAppRow): RowActionItem[] => [
    { id: "open", label: S.sidebarApps.open, glyph: ICONS.appWindow, onSelect: () => open(row) },
    // Only the Agent's setting lists a row; one shown because it runs has nothing to remove.
    ...(row.shortcut !== null
      ? [
          {
            id: "remove",
            label: S.sidebarApps.removeFromSidebar,
            glyph: ICONS.eyeOff,
            onSelect: () => removeFromSidebar(row),
          },
        ]
      : []),
    {
      id: "settings",
      label: S.sidebarApps.viewInSettings,
      glyph: ICONS.gear,
      onSelect: () => go(agentSettingsPath(row.agentId, row.machineId, "workbenches")),
    },
  ];

  return (
    <div className="pt-2.5">
      <GroupHeader
        open={!folded}
        onToggle={() => {
          writeFolded(!folded);
          setFolded(!folded);
        }}
        glyph={ICONS.tiles}
        label={S.sidebarApps.title}
        uppercase
        actions={
          <button
            type="button"
            data-tooltip={S.sidebarApps.manage}
            aria-label={S.sidebarApps.manage}
            onClick={() => go(agentSettingsPath(agent.agentId, agent.machineId, "workbenches"))}
            className={GROUP_ACTION_CLASS}
          >
            <Icon d={ICONS.gear} size={ICON_SIZE.groupHeaderAction} />
          </button>
        }
      />
      <Fold open={!folded}>
        <ul aria-label={S.sidebarApps.title} className="space-y-px">
          {rows.map((row) => {
            const state = stateOf(row);
            const name = S.sidebarApps.rowName(row.title, row.agentName, state);
            return (
              <AppRow
                key={row.key}
                appKey={row.key}
                icon={
                  <TileIcon
                    shortcut={{
                      workbenchId: row.workbenchId,
                      ...(row.icon !== null ? { icon: row.icon } : {}),
                    }}
                    title={row.title}
                    size={APP_ROW_ICON_PX}
                  />
                }
                name={row.title}
                {...(name !== row.title ? { label: name, hint: name } : {})}
                active={row.shown}
                running={row.running}
                build={row.build}
                menuActions={menuOf(row)}
                moreLabel={S.chat.moreActions}
                onOpen={() => open(row)}
              />
            );
          })}
        </ul>
      </Fold>
    </div>
  );
}
