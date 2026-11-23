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
  SidebarListHeader,
  SidebarControl,
  SearchInput,
  Dropdown,
  Menu,
  MenuRadioItem,
  ICONS,
  ICON_SIZE,
  type RowActionItem,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { agentSettingsPath } from "../../lib/agent-location";
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
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState(false);
  const [sort, setSort] = useState<"default" | "name" | "running">("default");
  if (agent === null || rows.length === 0) return null;
  const visible = rows.filter((row) =>
    row.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  if (sort === "name") visible.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "running") visible.sort((a, b) => Number(b.running) - Number(a.running));
  const endSearch = () => {
    setQuery("");
    setSearching(false);
  };

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
      <SidebarListHeader
        label={S.sidebarApps.title}
        searching={searching}
        fold={{
          open: !folded,
          toggle: () => {
            writeFolded(!folded);
            setFolded(!folded);
          },
        }}
      >
        {searching ? (
          <SearchInput
            icon
            alwaysClearable
            autoFocus
            className="min-w-0 flex-1"
            aria-label={S.sidebarApps.search}
            placeholder={S.sidebarApps.search}
            clearLabel={S.chat.searchClear}
            value={query}
            onChange={setQuery}
            onClear={endSearch}
          />
        ) : (
          <SidebarControl
            glyph={ICONS.search}
            label={S.sidebarApps.search}
            onClick={() => setSearching(true)}
          />
        )}
        <Dropdown
          open={sorting}
          setOpen={setSorting}
          portal={{ direction: "down", align: "right" }}
          menuClass="w-44"
          button={
            <SidebarControl
              glyph={ICONS.slidersHorizontal}
              label={S.sidebarApps.sort}
              aria-haspopup="menu"
              aria-expanded={sorting}
              onClick={() => setSorting(!sorting)}
            />
          }
        >
          <Menu label={S.sidebarApps.sort}>
            {(["default", "name", "running"] as const).map((value) => (
              <MenuRadioItem
                key={value}
                label={S.sidebarApps.order[value]}
                checked={sort === value}
                onSelect={() => {
                  setSort(value);
                  setSorting(false);
                }}
              />
            ))}
          </Menu>
        </Dropdown>
        <SidebarControl
          glyph={ICONS.gear}
          label={S.sidebarApps.manage}
          onClick={() => go(agentSettingsPath(agent.agentId, agent.machineId, "workbenches"))}
        />
      </SidebarListHeader>
      <Fold open={!folded || searching}>
        {visible.length === 0 && (
          <p className="px-2.5 pt-2 text-xs text-fg-muted">{S.sidebarApps.noMatches}</p>
        )}
        <ul aria-label={S.sidebarApps.title} className="space-y-px">
          {visible.map((row) => {
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
