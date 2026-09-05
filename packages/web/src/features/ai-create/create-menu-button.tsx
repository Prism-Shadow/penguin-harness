/**
 * The header control of every creatable object: a split "Create" button. Its main half runs the
 * primary path — the AI one by default, the wand being the mark of "ask the agent" — and its
 * caret opens a two-row menu offering both paths, so the manual form never hides behind the AI
 * one. AiWandButton and AiCreateButton are the same entry for headers with less room.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { ICON_SIZE } from "../../lib/icon-scale";
import { Button } from "../../components/ui/button";
import type { ButtonProps } from "../../components/ui/button";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ChevronDown, MAGIC_WAND_ICON } from "../../components/ui/icons";
import {
  PENCIL_ICON,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";

export type CreateAction = "ai" | "manual";

export interface CreateMenuButtonProps {
  /** The main half's label (default: the generic "Create"). */
  label?: string;
  onAi: () => void;
  onManual: () => void;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
  /** Which path the main half runs (default "ai"); the menu always offers both. */
  primaryAction?: CreateAction;
}

export function CreateMenuButton({
  label,
  onAi,
  onManual,
  size = "md",
  variant = "primary",
  primaryAction = "ai",
}: CreateMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const run = (action: CreateAction) => {
    setOpen(false);
    (action === "ai" ? onAi : onManual)();
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      className="inline-block"
      portal={{ direction: "down", align: "right" }}
      menuClass="w-52"
      button={
        <div className="inline-flex">
          <Button
            size={size}
            variant={variant}
            className="rounded-r-none"
            onClick={() => run(primaryAction)}
          >
            <GlyphIcon d={primaryAction === "ai" ? MAGIC_WAND_ICON : PENCIL_ICON} />
            {label ?? S.common.create}
          </Button>
          <Button
            size={size}
            variant={variant}
            className={`rounded-l-none border-l-0 ${size === "sm" ? "px-1.5" : "px-2"}`}
            aria-haspopup="menu"
            aria-expanded={open}
            title={S.aiCreate.moreWays}
            aria-label={S.aiCreate.moreWays}
            onClick={() => setOpen((v) => !v)}
          >
            {/* A hairline in the button's own ink, so the halves read as one control with a seam in any variant. */}
            <span aria-hidden className="mr-1.5 h-4 w-px bg-current opacity-30" />
            <ChevronDown size={ICON_SIZE.caret} />
          </Button>
        </div>
      }
    >
      <div role="menu" className="py-1">
        <button
          type="button"
          role="menuitem"
          className={overflowMenuRowClass}
          onClick={() => run("ai")}
        >
          {overflowMenuGlyph(MAGIC_WAND_ICON)}
          {S.aiCreate.withAi}
        </button>
        <button
          type="button"
          role="menuitem"
          className={overflowMenuRowClass}
          onClick={() => run("manual")}
        >
          {overflowMenuGlyph(PENCIL_ICON)}
          {S.aiCreate.manual}
        </button>
      </div>
    </Dropdown>
  );
}

/** Icon-only "Create with AI" (the wand alone), named by its tooltip and accessible name. */
export function AiWandButton({
  variant = "secondary",
  className,
  ...rest
}: Omit<ButtonProps, "size" | "children" | "title" | "aria-label">) {
  return (
    <Button
      size="icon"
      variant={variant}
      title={S.aiCreate.withAi}
      aria-label={S.aiCreate.withAi}
      className={className}
      {...rest}
    >
      <GlyphIcon d={MAGIC_WAND_ICON} size={ICON_SIZE.iconButton} />
    </Button>
  );
}

/** "Create with AI" with the wand and a label (the label defaults to that phrase). */
export function AiCreateButton({
  label,
  ...rest
}: Omit<ButtonProps, "children"> & { label?: string }) {
  return (
    <Button {...rest}>
      <GlyphIcon d={MAGIC_WAND_ICON} />
      {label ?? S.aiCreate.withAi}
    </Button>
  );
}
