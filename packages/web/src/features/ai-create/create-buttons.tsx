/**
 * The header control of every creatable object: two separate buttons, not a split control, a
 * caret menu or a mode switch. Both paths are then visible at once and neither hides behind the
 * other — the reader chooses between two things they can see, instead of discovering the second
 * one inside the first. The wand button always carries the accent and the hand button never
 * does, so the pair reads the same on every page.
 */
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { HAND_ICON, MAGIC_WAND_ICON } from "../../components/ui/icons";

export interface CreateButtonsProps {
  onAi: () => void;
  /** Absent: the manual path is not offered on this surface (a member who may not write the form's target still gets the AI path). */
  onManual?: () => void;
  size?: "sm" | "md";
  /** Labels when the object has its own verb ("Import with AI" / "Import manually"); default S.aiCreate.withAi / S.aiCreate.manual. */
  aiLabel?: string;
  manualLabel?: string;
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
  onManual,
  size = "sm",
  aiLabel,
  manualLabel,
  disabled,
  manualDisabled,
  className,
}: CreateButtonsProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <Button size={size} variant="primary" disabled={disabled} onClick={onAi}>
        <GlyphIcon d={MAGIC_WAND_ICON} />
        {aiLabel ?? S.aiCreate.withAi}
      </Button>
      {onManual !== undefined && (
        <Button
          size={size}
          variant="secondary"
          disabled={disabled === true || manualDisabled === true}
          onClick={onManual}
        >
          <GlyphIcon d={HAND_ICON} />
          {manualLabel ?? S.aiCreate.manual}
        </Button>
      )}
    </div>
  );
}
