import {
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
  SearchInput,
  SidebarControl,
  SidebarListHeader,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { GROUP_MODE_ICONS, SORT_MODE_ICONS } from "../../components/ui/group-list";
import { WorkspaceSelect } from "../chat";
import { NEW_CHAT_ICON } from "../../lib/main-sidebar-persistence";
import type { MainSidebarState } from "./main-sidebar-controller";

export function renderMainListHeader(scope: MainSidebarState) {
  const {
    navigate,
    currentProjectId,
    groupMode,
    sortMode,
    searchOpen,
    setSearchOpen,
    searchInputRef,
    searchTitle,
    searchQuery,
    setSearchQuery,
    listSettingsOpen,
    setListSettingsOpen,
    canDrag,
    setGroupMode,
    setSortMode,
    closeSearch,
    newChat,
    newEntity,
    newEntityLabel,
    addWorkspace,
    onNavigate,
  } = scope;
  return (
    <SidebarListHeader label={S.chat.sessionListByMode[groupMode]} searching={searchOpen}>
      {searchOpen ? (
        /* Expanded field: the magnifier, the input and the clear ×, one bordered
             box filling the row (its width rides the column tween). Esc and × both
             collapse it and drop the filter, which is why the × stays while it is empty. */
        <SearchInput
          ref={searchInputRef}
          icon
          alwaysClearable
          autoFocus
          className="min-w-0 flex-1"
          value={searchQuery}
          onChange={setSearchQuery}
          onClear={closeSearch}
          placeholder={S.chat.searchSessionsPlaceholder}
          aria-label={S.chat.searchSessions}
          clearLabel={S.chat.searchClear}
        />
      ) : (
        <SidebarControl
          label={S.chat.searchSessions}
          tooltip={searchTitle}
          glyph={ICONS.search}
          onClick={() => setSearchOpen(true)}
        />
      )}
      <Dropdown
        open={listSettingsOpen}
        setOpen={setListSettingsOpen}
        portal={{ direction: "down", align: "right" }}
        menuClass="w-40"
        button={
          <SidebarControl
            label={S.chat.listSettings}
            glyph={ICONS.slidersHorizontal}
            active={listSettingsOpen}
            aria-haspopup="menu"
            aria-expanded={listSettingsOpen}
            onClick={() => setListSettingsOpen(!listSettingsOpen)}
          />
        }
      >
        <Menu density="sm">
          <MenuLabel>{S.chat.groupModeSection}</MenuLabel>
          <MenuRadioItem
            glyph={GROUP_MODE_ICONS.workspace}
            label={S.chat.groupByWorkspace}
            checked={groupMode === "workspace"}
            onSelect={() => {
              setGroupMode("workspace");
              setListSettingsOpen(false);
            }}
          />
          <MenuRadioItem
            glyph={GROUP_MODE_ICONS.agent}
            label={S.chat.groupByAgent}
            checked={groupMode === "agent"}
            onSelect={() => {
              setGroupMode("agent");
              setListSettingsOpen(false);
            }}
          />
          <MenuRadioItem
            glyph={GROUP_MODE_ICONS.time}
            label={S.chat.groupByTime}
            checked={groupMode === "time"}
            onSelect={() => {
              setGroupMode("time");
              setListSettingsOpen(false);
            }}
          />
          <MenuSeparator />
          <MenuLabel>{S.chat.sortModeSection}</MenuLabel>
          {/* Manual order is offered only where a drag can actually happen (see canDrag). */}
          {canDrag && (
            <MenuRadioItem
              glyph={SORT_MODE_ICONS.manual}
              label={S.chat.sortManual}
              checked={sortMode === "manual"}
              onSelect={() => {
                setSortMode("manual");
                setListSettingsOpen(false);
              }}
            />
          )}
          <MenuRadioItem
            glyph={SORT_MODE_ICONS.recent}
            label={S.chat.sortRecent}
            checked={sortMode === "recent"}
            onSelect={() => {
              setSortMode("recent");
              setListSettingsOpen(false);
            }}
          />
        </Menu>
      </Dropdown>
      {/* Mode-dependent create — what gets created follows the grouping mode, and the
            icon follows suit (the folder with a plus, the robot with a plus badge):
            agent grouping opens the Agents page's existing create dialog (route
            state); workspace grouping opens the SAME directory-browse menu the
            draft's workspace picker uses — the picked directory registers as a
            workspace group immediately, Sessions or not. Time buckets are not
            something to create into, so that mode starts a plain new conversation
            and wears the compose glyph without a plus badge. */}
      {newEntity === "agent" ? (
        <SidebarControl
          label={newEntityLabel}
          glyph={<GlyphIcon d={ICONS.robotPlus} size={ICON_SIZE.iconButton} />}
          onClick={() => {
            navigate("/agents", { state: { create: true } });
            onNavigate?.();
          }}
        />
      ) : newEntity === "chat" ? (
        <SidebarControl
          label={newEntityLabel}
          glyph={<GlyphIcon d={NEW_CHAT_ICON} size={ICON_SIZE.iconButton} />}
          onClick={() => newChat()}
        />
      ) : (
        <WorkspaceSelect
          // Remount per Project: the picker browses lazily and caches the listing
          // for its lifetime, so a long-lived instance would show the PREVIOUS
          // Project's directories after a switch — and register that path into the
          // new Project's registry.
          key={currentProjectId ?? "no-project"}
          projectId={currentProjectId ?? ""}
          workspace=""
          onChange={addWorkspace}
          // The sidebar's + is where a workspace is CREATED, so it is where the
          // machine is chosen; the draft and settings pickers edit a workspace that
          // already has one.
          chooseMachine
          clearable={false}
          trigger={(open, toggle) => (
            <SidebarControl
              label={newEntityLabel}
              glyph={<GlyphIcon d={ICONS.folderPlus} size={ICON_SIZE.iconButton} />}
              active={open}
              aria-expanded={open}
              onClick={toggle}
            />
          )}
        />
      )}
    </SidebarListHeader>
  );
}
