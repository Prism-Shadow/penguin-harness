/**
 * The Machine dialog's toolbar: every verb the machine takes now in one row of flat buttons, as a
 * file manager lays out its commands — the primary one first in the primary look, the rest
 * ghosts, wrapping where the row does not fit, set apart by spacing alone (no rule above or below
 * it). A verb that cannot run now stays in place, greyed, and ONE muted sentence under the row
 * (`note`) says why — never a hover the reader has to find. A request in flight greys every one.
 * `data-verb` names each button for whatever reads the markup.
 */
import { ICON_SIZE } from "../../../icon-scale";
import { Button } from "../../actions/button/button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

/** One verb: its key, word and glyph, whether it is the primary, and whether it waits. */
export interface MachineToolbarItem<V extends string = string> {
  verb: V;
  label: string;
  /** A registry path from `ICONS`. */
  glyph: string;
  primary: boolean;
  /** It cannot run now; `note` says why. */
  held: boolean;
}

export interface MachineToolbarProps<V extends string = string> {
  items: readonly MachineToolbarItem<V>[];
  /** The toolbar's accessible name. */
  label: string;
  /** A request is in flight: every verb waits for it. */
  busy: boolean;
  /** The one sentence on the verbs that wait; null when none does. */
  note?: string | null;
  onAct: (verb: V) => void;
}

export function MachineToolbar<V extends string>({
  items,
  label,
  busy,
  note = null,
  onAct,
}: MachineToolbarProps<V>) {
  return (
    <>
      <div role="toolbar" aria-label={label} className="flex flex-wrap items-center gap-1">
        {items.map((item) => (
          <Button
            key={item.verb}
            size="sm"
            variant={item.primary ? "primary" : "ghost"}
            data-verb={item.verb}
            disabled={busy || item.held}
            onClick={() => onAct(item.verb)}
          >
            <GlyphIcon d={item.glyph} size={ICON_SIZE.inlineGlyph} />
            {item.label}
          </Button>
        ))}
      </div>
      {note !== null && (
        <p data-held="" className="mt-1.5 text-xs text-fg-muted">
          {note}
        </p>
      )}
    </>
  );
}
