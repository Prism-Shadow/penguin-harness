/**
 * The second step of the Session row menu's "Schedule a task": a two-row chooser — let the AI
 * create it (the conversation opens with its scheduled-tasks panel and the AI dialog up) or
 * set it up by hand (the form, pinned to that Session) — anchored where the menu was. The row
 * menu itself is a flat list (session-row-menu.tsx), so the fork lives in a small panel of its
 * own rather than a nested submenu.
 */
import type { AnchorRect } from "../../lib/context-menu";
import { S } from "../../lib/strings";
import { Dropdown } from "../../components/ui/dropdown";
import { MAGIC_WAND_ICON } from "../../components/ui/icons";
import {
  PENCIL_ICON,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";

export function ScheduleCreateChooser({
  anchor,
  anchorOwner,
  canManual,
  onClose,
  onAi,
  onManual,
}: {
  /** Where the panel hangs (the row menu's own anchor); null keeps it closed. */
  anchor: AnchorRect | null;
  /** The scroller whose movement dismisses it (the row menu's anchorOwner). */
  anchorOwner: () => HTMLElement | null;
  /** Whether the manual form is offered: writes are owner-only, the AI path is open to every member. */
  canManual: boolean;
  onClose: () => void;
  onAi: () => void;
  onManual: () => void;
}) {
  /** Close first, then act (a dialog or a navigation follows). */
  const choose = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Dropdown
      open={anchor !== null}
      setOpen={(v) => {
        if (!v) onClose();
      }}
      portal={{ direction: "down", align: "left" }}
      anchorRect={anchor}
      anchorOwner={anchorOwner}
      className="contents"
      menuClass="w-40"
      button={null}
    >
      <div className="px-2.5 pt-1.5 pb-0.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
        {S.schedule.createAction}
      </div>
      <button type="button" className={overflowMenuRowClass} onClick={choose(onAi)}>
        {overflowMenuGlyph(MAGIC_WAND_ICON)}
        {S.aiCreate.withAi}
      </button>
      {canManual && (
        <button type="button" className={overflowMenuRowClass} onClick={choose(onManual)}>
          {overflowMenuGlyph(PENCIL_ICON)}
          {S.aiCreate.manual}
        </button>
      )}
    </Dropdown>
  );
}
