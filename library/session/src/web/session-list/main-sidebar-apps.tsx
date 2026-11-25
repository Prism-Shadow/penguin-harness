/**
 * The sidebar Apps group lists the current Project’s open app pages in this window.
 * Opening a running row selects its workspace page. The same page owns minimize, restore and
 * close, whether it renders a native route, a contributed iframe or an Agent workbench.
 * An Agent workbench's row also carries what manages the workbench itself (reload, version
 * history, download, removal): the app's pane draws nothing above its content.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { PAGE_DRAG_TYPE, S, TileIcon, agentSettingsPath, usePageWorkspace, useProject, useWorkbenchActions } from "@prismshadow/penguin-web/internal";
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

/** One workbench row's management actions and the dialogs they open, scoped to its own Agent. */
function WorkbenchRowActions({
  row,
  children,
}: {
  row: SidebarAppRow;
  children: (manage: RowActionItem[]) => ReactNode;
}) {
  const projectId = useProject().currentProject?.projectId ?? null;
  const { actions, modals } = useWorkbenchActions({
    projectId,
    agentId: row.agentId,
    machineId: row.machineId,
  });
  return (
    <>
      {children(actions({ id: row.workbenchId }, true))}
      {modals}
    </>
  );
}

export function MainSidebarApps({ onNavigate }: { onNavigate?: () => void }) {
  const workspace = usePageWorkspace();
  const { rows } = useSidebarApps(workspace?.layout.pages);
  const navigate = useNavigate();
  const [folded, setFolded] = useState(readFolded);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState(false);
  const [sort, setSort] = useState<"default" | "name" | "recent">("default");
  const list = useRef<HTMLUListElement>(null);
  const activeId = workspace?.current?.id;
  const activeAppKey = rows.find((row) => row.page.id === activeId)?.key;
  useLayoutEffect(() => {
    // Reveal a newly selected app in the sidebar, including when it opens from the App Center.
    list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest" });
  }, [activeAppKey]);
  if (!workspace || rows.length === 0) return null;
  const visible = rows.filter((row) =>
    row.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  if (sort === "name") visible.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "recent") {
    const recent = new Map(workspace.layout.recent.map((id, index) => [id, index]));
    visible.sort(
      (a, b) => (recent.get(a.page.id) ?? Infinity) - (recent.get(b.page.id) ?? Infinity),
    );
  }
  const endSearch = () => {
    setQuery("");
    setSearching(false);
  };

  const go = (to: string) => {
    void navigate(to);
    onNavigate?.();
  };
  const open = (row: SidebarAppRow) => {
    workspace.openPage(row.page);
    onNavigate?.();
  };
  const menuOf = (row: SidebarAppRow, manage: readonly RowActionItem[]): RowActionItem[] => {
    const page = row.page;
    const act = (fn: () => void) => () => {
      fn();
      onNavigate?.();
    };
    const actions: RowActionItem[] = [
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
        id: "separate",
        label: S.pageWorkspace.separate,
        glyph: ICONS.externalLink,
        onSelect: act(() => workspace.separate(page)),
      },
      {
        id: "fullscreen",
        label: S.appCenter.windowFullScreen,
        glyph: ICONS.cornersOut,
        onSelect: act(() => workspace.fullScreen(page)),
      },
      {
        id: "close",
        label: S.common.close,
        glyph: ICONS.cross,
        onSelect: act(() => workspace.close(page.id)),
      },
    ];
    if (sort === "default") {
      const index = visible.findIndex((item) => item.key === row.key);
      const previous = visible[index - 1];
      const next = visible[index + 1];
      if (previous)
        actions.push({
          id: "up",
          label: S.sidebarApps.moveUp,
          glyph: ICONS.chevronUp,
          onSelect: () => workspace.reorder(page.id, previous.page.id),
        });
      if (next)
        actions.push({
          id: "down",
          label: S.sidebarApps.moveDown,
          glyph: ICONS.chevronDown,
          onSelect: () => workspace.reorder(next.page.id, page.id),
        });
    }
    if (!row.system) {
      // The workbench's own group, ruled off from the window's; removal stays last.
      const remove = manage.find((item) => item.danger === true);
      const group: RowActionItem[] = [
        ...manage.filter((item) => item !== remove),
        {
          id: "settings",
          label: S.sidebarApps.viewInSettings,
          glyph: ICONS.gear,
          onSelect: () => go(agentSettingsPath(row.agentId, row.machineId, "workbenches")),
        },
        ...(remove ? [remove] : []),
      ];
      group[0] = { ...group[0]!, separated: true };
      actions.push(...group);
    }
    return actions;
  };
  return (
    <nav aria-label={S.sidebarApps.title}>
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
            {(["default", "name", "recent"] as const).map((value) => (
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
          onClick={() => go("/plugins")}
        />
      </SidebarListHeader>
      <Fold open={!folded || searching}>
        {visible.length === 0 && (
          <p className="px-2.5 pt-2 text-xs text-fg-muted">{S.sidebarApps.noMatches}</p>
        )}
        <ul ref={list} aria-label={S.sidebarApps.title} className="space-y-px pt-0.5">
          {visible.map((row) => {
            const render = (manage: readonly RowActionItem[]) => {
              const actions = menuOf(row, manage);
              const state = S.appCenter.running;
              const name = S.sidebarApps.rowName(row.title, row.agentName, state);
              return (
                <AppRow
                  key={row.key}
                  appKey={row.key}
                  drag={{
                    draggable: true,
                    onDragStart(event) {
                      event.dataTransfer.setData(PAGE_DRAG_TYPE, row.page.id);
                      event.dataTransfer.effectAllowed = "move";
                    },
                    onDragOver(event) {
                      if (sort === "default" && event.dataTransfer.types.includes(PAGE_DRAG_TYPE))
                        event.preventDefault();
                    },
                    onDrop(event) {
                      const id = event.dataTransfer.getData(PAGE_DRAG_TYPE);
                      if (sort === "default" && rows.some((item) => item.page.id === id)) {
                        event.preventDefault();
                        workspace.reorder(id, row.page.id);
                      }
                    },
                  }}
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
                  active={activeAppKey === row.key}
                  running
                  build={row.build}
                  menuActions={actions}
                  windowActions={actions.filter(
                    (item) => item.id === "fullscreen" || item.id === "close",
                  )}
                  moreLabel={S.chat.moreActions}
                  onOpen={() => open(row)}
                />
              );
            };
            // A system app has no versions and is never removed: its row manages the window only.
            return row.system ? (
              render([])
            ) : (
              <WorkbenchRowActions key={row.key} row={row}>
                {render}
              </WorkbenchRowActions>
            );
          })}
        </ul>
      </Fold>
    </nav>
  );
}
