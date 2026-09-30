/**
 * The header control of every creatable object: two separate buttons, not a split control, a
 * caret menu or a mode switch. Both paths are then visible at once and neither hides behind the
 * other — the reader chooses between two things they can see, instead of discovering the second
 * one inside the first. The wand button always carries the accent and the hand button never
 * does, so the pair reads the same on every page.
 *
 * Both labels are the caller's: the app names the two paths ("Create with AI" / "Create
 * manually", or an object's own verb, "Import with AI").
 */
import { Button } from "../button/button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";

export interface CreateButtonsProps {
  onAi: () => void;
  /** The AI path's label. */
  aiLabel: string;
  /** Absent: the manual path is not offered on this surface. */
  onManual?: () => void;
  /** The manual path's label; required wherever `onManual` is given. */
  manualLabel?: string;
  size?: "sm" | "md";
  /** Greys both paths. */
  disabled?: boolean;
  /**
   * Greys the manual path alone — for a surface whose form needs data it failed to load. The AI
   * path stays live on purpose: it only composes a prompt and opens a conversation, and that
   * conversation is often what repairs the configuration the failed load was reading.
   */
  manualDisabled?: boolean;
  className?: string;
}

export function CreateButtons({
  onAi,
  aiLabel,
  onManual,
  manualLabel,
  size = "sm",
  disabled,
  manualDisabled,
  className,
}: CreateButtonsProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <Button size={size} variant="primary" disabled={disabled} onClick={onAi}>
        <GlyphIcon d={ICONS.wand} />
        {aiLabel}
      </Button>
      {onManual !== undefined && (
        <Button
          size={size}
          variant="secondary"
          disabled={disabled === true || manualDisabled === true}
          onClick={onManual}
        >
          <GlyphIcon d={ICONS.hand} />
          {manualLabel}
        </Button>
      )}
    </div>
  );
}
