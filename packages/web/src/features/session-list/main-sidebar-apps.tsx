/**
 * The sidebar Apps group lists the Agent's workbenches and the current Project's open apps.
 * Opening a running row selects its workspace page. The same page owns minimize, restore and
 * close, whether it renders a native route, a contributed iframe or an Agent workbench.
 */
import { useLayoutEffect, useRef, useState } from "react";
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
import { usePageWorkspace } from "../../lib/page-workspace";
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
  const workspace = usePageWorkspace();
  const { agent, pagesByKey, rows, reload } = useSidebarApps(
    workspace?.layout.pages,
    workspace?.current?.id,
  );
  const restore = useRestoreApp();
  const navigate = useNavigate();
  const [folded, setFolded] = useState(readFolded);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState(false);
  const [sort, setSort] = useState<"default" | "name" | "running">("default");
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const box = list.current;
    const active = box?.querySelector('[aria-current="page"]');
    if (!box || !active || !box.clientHeight || box.scrollHeight <= box.clientHeight) return;
    // Reveal an app selected through another entry without moving the sidebar's other groups.
    const bounds = box.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    if (item.top < bounds.top) box.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) box.scrollTop += item.bottom - bounds.bottom;
  }, [workspace?.current?.id, rows.length, folded, searching, sort]);
  if (rows.length === 0) return null;
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
    const page = pagesByKey.get(row.key);
    if (page && workspace) workspace.focus(page);
    else restore(row.key, row.shortcut ?? undefined);
    onNavigate?.();
  };
  const removeFromSidebar = (row: SidebarAppRow) => {
    if (!agent) return;
    void api
      .setWorkbenchSidebar(agent.projectId, row.agentId, row.workbenchId, false, row.machineId)
      .then(reload, toastApiError);
  };
  const menuOf = (row: SidebarAppRow): RowActionItem[] => {
    const page = pagesByKey.get(row.key);
    const actions: RowActionItem[] = [];
    if (page && workspace) {
      const act = (fn: () => void) => () => {
        fn();
        onNavigate?.();
      };
      actions.push(
        workspace.layout.visible.includes(page.id)
          ? {
              id: "minimize",
              label: S.appCenter.windowMinimize,
              glyph: ICONS.minus,
              onSelect: act(() => workspace.minimize(page.id)),
            }
          : {
              id: "restore",
              label: S.pageWorkspace.restore,
              glyph: ICONS.appWindow,
              onSelect: () => open(row),
            },
        {
          id: "fullscreen",
          label: page.kind === "system" ? S.pageWorkspace.whole : S.appCenter.windowFullScreen,
          glyph: ICONS.square,
          onSelect: act(() =>
            page.kind === "system" ? workspace.whole(page) : workspace.fullScreen(page),
          ),
        },
        {
          id: "close",
          label: S.common.close,
          glyph: ICONS.cross,
          onSelect: act(() => workspace.close(page.id)),
        },
      );
    } else {
      actions.push({
        id: "open",
        label: S.sidebarApps.open,
        glyph: ICONS.appWindow,
        onSelect: () => open(row),
      });
    }
    if (row.shortcut)
      actions.push({
        id: "remove",
        label: S.sidebarApps.removeFromSidebar,
        glyph: ICONS.eyeOff,
        onSelect: () => removeFromSidebar(row),
      });
    if (!row.system)
      actions.push({
        id: "settings",
        label: S.sidebarApps.viewInSettings,
        glyph: ICONS.gear,
        onSelect: () => go(agentSettingsPath(row.agentId, row.machineId, "workbenches")),
      });
    return actions;
  };
  return (
    <nav aria-label={S.sidebarApps.title} className="pt-2.5">
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
        {agent && (
          <SidebarControl
            glyph={ICONS.gear}
            label={S.sidebarApps.manage}
            onClick={() => go(agentSettingsPath(agent.agentId, agent.machineId, "workbenches"))}
          />
        )}
      </SidebarListHeader>
      <Fold open={!folded || searching}>
        {visible.length === 0 && (
          <p className="px-2.5 pt-2 text-xs text-fg-muted">{S.sidebarApps.noMatches}</p>
        )}
        <ul
          ref={list}
          aria-label={S.sidebarApps.title}
          className="max-h-[min(8rem,18dvh)] space-y-px overflow-y-auto md:max-h-[min(12rem,25dvh)]"
        >
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
                      ...(row.system && { system: row.system }),
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
    </nav>
  );
}
