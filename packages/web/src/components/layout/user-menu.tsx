/**
 * The account menu, shared by both avatars that open one: the pinned sidebar's user row and
 * the collapsed rail's avatar. One component rather than a copy per anchor — the rows
 * (System settings, the update entry, sign out) and the dialog behind the first of them must
 * stay the same menu from either side, and a second copy is how two menus drift apart.
 *
 * Only the trigger differs, so the trigger is the caller's: it is handed the menu's own open
 * state, which is what keeps "what opening means" here rather than in two places.
 *
 * The settings dialog is mounted OUTSIDE the panel: the panel's children unmount the moment
 * the menu closes, and the settings row closes the menu as it opens the dialog.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { Dropdown, menuItemClass } from "../ui/dropdown";
import type { DropdownPortal } from "../ui/dropdown";
import { UpdateRow } from "../account/update-row";
import { openUpdateModal } from "../../lib/use-update-flow";
import { SettingsDialog } from "../../features/settings/settings-dialog";

export function UserMenu({
  trigger,
  menuClass,
  portal,
  anchorRect,
  anchorOwner,
  className,
}: {
  /** The anchor's own look, wired to this menu's state: the sidebar's full-width row, the rail's avatar. */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  /** Panel size and, for an in-flow panel, its docking direction (see Dropdown). */
  menuClass?: string;
  /** Escape the anchor's clipping box by rendering the panel through a body portal. */
  portal?: DropdownPortal;
  /** Place the panel against this viewport box instead of the anchor's own — the rail hangs its menu off the rail's outer edge rather than over the rail. */
  anchorRect?: { top: number; bottom: number; left: number; right: number } | null;
  /** The element `anchorRect` was measured from, so only a scroll that moved it dismisses the panel. */
  anchorOwner?: () => HTMLElement | null;
  /** Extra classes for the anchor container (e.g. `mt-auto` in a flex column). */
  className?: string;
}) {
  const navigate = useNavigate();
  const { logout, desktopMode } = useAuth();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <Dropdown
        open={open}
        setOpen={setOpen}
        button={trigger({ open, toggle: () => setOpen(!open) })}
        {...(className !== undefined ? { className } : {})}
        {...(menuClass !== undefined ? { menuClass } : {})}
        {...(portal !== undefined ? { portal } : {})}
        {...(anchorRect !== undefined ? { anchorRect } : {})}
        {...(anchorOwner !== undefined ? { anchorOwner } : {})}
      >
        <div className="py-1">
          {/* System settings dialog: everyone gets the row — the dialog always has the
              personal pages, and the server-global ones inside it stay gated by the
              section registry rather than by this row. The preference rows that used to
              stack here live on its pages now. */}
          <button
            type="button"
            className={menuItemClass}
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
          >
            {S.settings.systemSettings}
          </button>
          {/* Update entry, directly under the settings entry rather than on a page inside
              it: one row for both backends (the server release here, the shell's own
              updater in the desktop window), naming where the update flow stands and
              opening the update modal — where the flow is explained and acted on. The
              modal is mounted by the app layout, so it outlives this menu. Hidden where
              this session can update nothing (a browser signed into a desktop-mode
              server, see updateModeFor). */}
          <UpdateRow
            menuItemClass={menuItemClass}
            onOpen={() => {
              setOpen(false);
              openUpdateModal();
            }}
          />
          {/* Hidden in desktop mode: the window IS the session — logging out would
              strand the user on a login page whose password was never shown. */}
          {!desktopMode && (
            <button
              type="button"
              className="block w-full px-3.5 py-2 text-left text-sm text-red-600 transition-colors duration-150 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              onClick={() => {
                setOpen(false);
                void logout().then(() => navigate("/login"));
              }}
            >
              {S.auth.logout}
            </button>
          )}
        </div>
      </Dropdown>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
