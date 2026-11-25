import type { ReactNode } from "react";
import { Button, ChevronDown, GlyphIcon, IconButton, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

export interface PromptAction {
  id: string;
  label: string;
  preview?: string;
  hint?: string;
  glyph?: string;
  slot?: string;
  current?: boolean;
  disabled?: boolean;
  menu?: boolean;
  expanded?: boolean;
  run: () => void;
  wrap?: (button: ReactNode) => ReactNode;
}

export function shortPromptTitle(value: string, locale: string): string {
  const units = Array.from(
    new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(value),
    (item) => item.segment,
  );
  const limit = locale.startsWith("zh") ? 8 : 18;
  return units.length > limit ? units.slice(0, limit - 1).join("") + "…" : value;
}

export function PromptButton({ action }: { action: PromptAction }) {
  const button = (
    <Button
      size="sm"
      variant="ghost"
      data-slot={action.slot}
      aria-current={action.current || undefined}
      aria-haspopup={action.menu ? "menu" : undefined}
      aria-expanded={action.menu ? Boolean(action.expanded) : undefined}
      disabled={action.disabled === true}
      aria-label={action.label}
      title={action.hint ?? action.label}
      onClick={action.run}
      className="h-9 min-w-0 max-w-full !justify-start gap-2 !px-2 text-start aria-current:text-accent"
      leading={
        action.glyph ? (
          <GlyphIcon
            d={action.glyph}
            size={ICON_SIZE.rowLead}
            className={
              action.slot === "saved-prompt" ? "shrink-0 text-accent" : "shrink-0 text-fg-subtle"
            }
          />
        ) : undefined
      }
    >
      <span className="min-w-0 truncate">{action.preview ?? action.label}</span>
      {action.menu && (
        <ChevronDown size={ICON_SIZE.caretDense} className="shrink-0 text-fg-subtle" />
      )}
    </Button>
  );
  return action.wrap ? <>{action.wrap(button)}</> : button;
}

export function PromptActionRow({
  prompts,
  manage,
}: {
  prompts: PromptAction[];
  manage?: PromptAction;
}) {
  return (
    <div
      role="group"
      aria-label={S.chat.start.examplesTitle}
      data-slot="examples"
      className="mt-3 flex w-full min-w-0 flex-wrap items-center gap-1.5"
    >
      {prompts.map((action) => (
        <PromptButton key={action.id} action={action} />
      ))}
      {manage && (
        <IconButton
          label={manage.label}
          variant="ghost"
          onClick={manage.run}
          className="min-h-9 min-w-8 shrink-0"
        >
          <GlyphIcon d={manage.glyph!} size={ICON_SIZE.rowLead} />
        </IconButton>
      )}
    </div>
  );
}
