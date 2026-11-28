/**
 * The toolbar's page size button and its menu (page-size.ts): Fit to panel, the common sizes, and
 * Custom size…, the one in force checked. The glyph takes the accent while a fixed size is in
 * force, and the tooltip names it with the zoom it is drawn at in the panel. The same control
 * stands in the Chrome surface's toolbar, where the size is the tab's own Chrome window.
 */
import { useState } from "react";
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import {
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  MenuSeparator,
} from "@prismshadow/penguin-ui";
import { ToolButton } from "./browser-toolbar";
import type { Size } from "./geometry";
import { PageSizeDialog } from "./page-size-dialog";
import { PAGE_SIZE_PRESETS, fixedPageSize, pageSizeLabel, resizeTab, sameSize } from "./page-size";
import { S } from "./strings";

export function PageSizeMenu({
  tab,
  slot,
}: {
  /** The tab on screen; null with none open, which leaves the button disabled. */
  tab: BuiltinBrowserTab | null;
  /** The panel's page area the page is drawn in; null where it is not (the user's Chrome). */
  slot: Size | null;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const size = fixedPageSize(tab);
  const label = pageSizeLabel(size, slot);
  const preset = PAGE_SIZE_PRESETS.some((choice) => sameSize(choice, size));
  const choose = (next: Size | null) => () => {
    setOpen(false);
    if (tab !== null) void resizeTab(tab.id, next);
  };

  return (
    <>
      <Dropdown
        open={open}
        setOpen={setOpen}
        portal={{ direction: "down", align: "right" }}
        menuClass="w-52"
        button={
          <ToolButton
            label={label}
            on={size !== null}
            disabled={tab === null}
            tooltipSuppressed={open}
            aria-haspopup="menu"
            aria-expanded={open}
            data-testid="builtin-browser-page-size"
            onClick={() => setOpen(!open)}
          >
            <GlyphIcon d={ICONS.monitor} size={ICON_SIZE.iconButton} />
          </ToolButton>
        }
      >
        <Menu density="sm" label={S.builtinBrowser.pageSize}>
          <MenuItem
            role="menuitemradio"
            checked={size === null}
            label={S.builtinBrowser.fitPanel}
            onSelect={choose(null)}
          />
          <MenuSeparator />
          {PAGE_SIZE_PRESETS.map((choice) => (
            <MenuItem
              key={`${choice.width}x${choice.height}`}
              role="menuitemradio"
              checked={sameSize(choice, size)}
              label={S.builtinBrowser.sizeChoice(choice.width, choice.height)}
              onSelect={choose(choice)}
            />
          ))}
          <MenuSeparator />
          <MenuItem
            role="menuitemradio"
            checked={size !== null && !preset}
            label={S.builtinBrowser.customSize}
            {...(size !== null && !preset
              ? { trailing: S.builtinBrowser.sizeChoice(size.width, size.height) }
              : {})}
            onSelect={() => {
              setOpen(false);
              setCustom(true);
            }}
          />
        </Menu>
      </Dropdown>
      {custom && tab !== null && (
        <PageSizeDialog tabId={tab.id} initial={size} onClose={() => setCustom(false)} />
      )}
    </>
  );
}
