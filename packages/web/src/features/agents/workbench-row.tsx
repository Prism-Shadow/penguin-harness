/** The identity and settings menu of one installed workbench. */
import { useState } from "react";
import type { IconRef, WorkbenchInfo } from "@prismshadow/penguin-server/api";
import {
  Dropdown,
  GlyphIcon,
  IconButton,
  ICONS,
  ICON_SIZE,
  ImageIcon,
  Menu,
  MenuItem,
  MenuSeparator,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { useAgentLocation } from "../../lib/agent-location";
import { useInstantSetting } from "../../lib/instant-setting";
import { S } from "../../lib/strings";
import { useProject } from "../../state/project";
import { SkillTile } from "../skills";

/** Edge of the row's mark, in px: the tile every settings row leads with. */
const MARK_PX = 36;

/**
 * The row's mark: the declared App Center icon, else (and when its image fails to load) the
 * plugin's icon on the tile, else the anvil tile.
 */
export function WorkbenchMark({
  workbench,
  pluginIcon,
}: {
  workbench: WorkbenchInfo;
  /** The icon of the plugin the workbench came from, when it came from one. */
  pluginIcon?: IconRef | undefined;
}) {
  const { icon } = workbench;
  const tile = (shown: IconRef | undefined) => (
    <SkillTile name={workbench.id} fallback={ICONS.anvil} {...(shown ? { icon: shown } : {})} />
  );
  // A monochrome icon is a line drawing: it takes the tile's tint, as a skill's icon does.
  if (icon === undefined) return tile(pluginIcon);
  if (icon.tint) return tile(icon);
  return (
    <ImageIcon icon={icon} size={MARK_PX} className="rounded-lg" fallback={tile(pluginIcon)} />
  );
}

export function WorkbenchRowMenu({
  title,
  disabled,
  workbench,
  agentId,
  hasTabs,
  onSwitched,
  onOpen,
  onFiles,
  source,
  onReload,
  onHistory,
  onExport,
  onRemove,
}: {
  /** The row's title, for the button's and the menu's accessible name. */
  title: string;
  disabled: boolean;
  workbench: WorkbenchInfo;
  agentId: string;
  hasTabs: boolean;
  onSwitched: (workbench: WorkbenchInfo) => void;
  onOpen?: (() => void) | undefined;
  onFiles: () => void;
  source?: { title: string; show: () => void } | undefined;
  /** Absent while the workbench does not run: there is nothing to reload. */
  onReload?: (() => void) | undefined;
  onHistory: () => void;
  onExport: () => void;
  /** Asks first: the tab's remove confirmation. */
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { currentProject } = useProject();
  const machineId = useAgentLocation();
  const chatTabs = useInstantSetting(workbench.showInChat !== false, async (show: boolean) => {
    if (!currentProject) return;
    const result = await api.setWorkbenchChatVisibility(
      currentProject.projectId,
      agentId,
      workbench.id,
      show,
      machineId,
    );
    onSwitched(result.workbench);
  });
  const appCenter = useInstantSetting(workbench.appCenter?.show === true, async (show: boolean) => {
    if (!currentProject) return;
    const result = await api.setWorkbenchAppCenter(
      currentProject.projectId,
      agentId,
      workbench.id,
      show,
      machineId,
    );
    onSwitched(result.workbench);
  });
  const hasChat = hasTabs && workbench.showInChat !== undefined;
  const hasAppCenter = machineId === null;
  const saving = chatTabs.busy || appCenter.busy;
  const label = `${S.workbenches.more} ${title}`;
  /** A row closes the menu, handing focus back to its button, then acts. */
  const pick = (run: () => void) => () => {
    setOpen(false);
    run();
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="w-56"
      portal={{ direction: "down", align: "right" }}
      button={
        <IconButton
          size="sm"
          label={label}
          // No tooltip while the menu is open: it would sit on top of the panel.
          title={open ? "" : S.workbenches.more}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.iconButton} filled />
        </IconButton>
      }
    >
      <Menu label={label} density="sm" className="py-1">
        {hasChat && (
          <MenuItem
            glyph={ICONS.appWindow}
            label={S.workbenches.showInChat}
            checked={chatTabs.value}
            aria-disabled={saving}
            onSelect={() => {
              if (!saving) void chatTabs.set(!chatTabs.value);
            }}
          />
        )}
        {hasAppCenter && (
          <MenuItem
            glyph={ICONS.tiles}
            label={S.workbenches.showInAppCenter}
            checked={appCenter.value}
            aria-disabled={saving}
            onSelect={() => {
              if (!saving) void appCenter.set(!appCenter.value);
            }}
          />
        )}
        {(hasChat || hasAppCenter) && <MenuSeparator />}
        {onOpen && (
          <MenuItem
            glyph={ICONS.arrowUpRight}
            label={S.workbenches.openAction}
            onSelect={pick(onOpen)}
          />
        )}
        <MenuItem
          glyph={ICONS.folderOpen}
          label={S.workbenches.viewFiles}
          onSelect={pick(onFiles)}
        />
        {source && (
          <MenuItem
            glyph={ICONS.puzzle}
            label={S.workbenches.viewPlugin(source.title)}
            onSelect={pick(source.show)}
          />
        )}
        {onReload !== undefined && (
          <MenuItem glyph={ICONS.refresh} label={S.workbenches.reload} onSelect={pick(onReload)} />
        )}
        <MenuItem
          glyph={ICONS.history}
          label={S.workbenches.historyAction}
          onSelect={pick(onHistory)}
        />
        <MenuItem
          glyph={ICONS.download}
          label={S.workbenches.exportWorkbench}
          onSelect={pick(onExport)}
        />
        <MenuSeparator />
        <MenuItem
          glyph={ICONS.trash}
          label={S.workbenches.remove}
          danger
          onSelect={pick(onRemove)}
        />
      </Menu>
    </Dropdown>
  );
}
