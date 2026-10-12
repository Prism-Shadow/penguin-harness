/**
 * The gear at the end of every group header, and the menu it opens:
 *
 * - **Sort**, three radio rows — price low to high (the default), price high to low, name — the
 *   current one checked (model-sort.ts orders the rows). A view preference that writes nothing
 *   to the Project, so it is there for members too, and a page busy writing never blocks it.
 * - a rule, then **Group settings…**, which opens the group settings dialog
 *   (provider-settings-dialog.tsx), as the gear itself did before it held a menu. Owner only, and
 *   it waits while the page is writing.
 *
 * The header shows no sort label: the checked row is the indication, and the gear's hover hint
 * names the current sort. The gear keeps its icon and its accessible name. Choosing a sort from
 * the keyboard hands focus back to the gear, as Escape does; Group settings… does so for every
 * pointer too, so the dialog returns focus to the gear when it closes.
 */
import { useRef, useState } from "react";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import {
  Button,
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Menu,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { HEADER_SQUARE } from "./group-header";
import { MODEL_GROUP_SORTS } from "./model-sort";
import type { ModelGroupSort } from "./model-sort";

/** What the gear's name is: the action and the group, the same words the gear always carried. */
const gearName = (provider: ModelProviderInfo): string =>
  `${S.models.groupSettings} ${provider.label}`;

/** The menu's rows: the sort section, then — when there is one — the settings entry. */
export function GroupSettingsMenu({
  provider,
  sort,
  onSort,
  settings,
}: {
  provider: ModelProviderInfo;
  /** The group's current sort: its row is the checked one. */
  sort: ModelGroupSort;
  onSort: (sort: ModelGroupSort) => void;
  /** The owner's way into the group settings; absent for a member, who has the sort alone. */
  settings?: { onOpen: () => void; disabled: boolean } | undefined;
}) {
  return (
    <Menu density="sm" label={gearName(provider)}>
      <MenuLabel>{S.models.sortHeading}</MenuLabel>
      {MODEL_GROUP_SORTS.map((mode) => (
        <MenuRadioItem
          key={mode}
          label={S.models.sortModes[mode]}
          checked={mode === sort}
          onSelect={() => onSort(mode)}
        />
      ))}
      {settings !== undefined && (
        <>
          <MenuSeparator />
          <MenuItem
            label={S.models.groupSettingsEntry}
            disabled={settings.disabled}
            onSelect={settings.onOpen}
          />
        </>
      )}
    </Menu>
  );
}

/** The gear and its menu, in the header's one box (group-header.ts). */
export function GroupSettingsControl({
  provider,
  sort,
  onSort,
  onSettings,
  busy,
}: {
  provider: ModelProviderInfo;
  sort: ModelGroupSort;
  onSort: (sort: ModelGroupSort) => void;
  /** Opens the group settings dialog; absent for a member. */
  onSettings?: (() => void) | undefined;
  /** The page is writing: the settings entry waits, the sort does not. */
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** The gear, kept from its own click (a keyboard press clicks it too) to take focus back. */
  const gear = useRef<HTMLButtonElement | null>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) gear.current?.focus();
  };
  /** Whether the row being chosen was reached from the keyboard (its focus ring is showing). */
  const fromKeyboard = () =>
    document.activeElement instanceof HTMLElement &&
    document.activeElement.matches(":focus-visible");
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      className="flex shrink-0"
      menuClass="w-48 max-w-[calc(100vw-2rem)] origin-top-right"
      portal={{ direction: "down", align: "right" }}
      button={
        <Button
          size="icon"
          variant="ghost"
          className={HEADER_SQUARE}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={gearName(provider)}
          title={S.models.groupMenuTitle(S.models.sortModes[sort])}
          onClick={(e) => {
            gear.current = e.currentTarget;
            setOpen(!open);
          }}
        >
          <GlyphIcon d={ICONS.gear} size={ICON_SIZE.groupHeaderAction} />
        </Button>
      }
    >
      <GroupSettingsMenu
        provider={provider}
        sort={sort}
        onSort={(next) => {
          close(fromKeyboard());
          onSort(next);
        }}
        settings={
          onSettings === undefined
            ? undefined
            : {
                disabled: busy,
                onOpen: () => {
                  close(true);
                  onSettings();
                },
              }
        }
      />
    </Dropdown>
  );
}
