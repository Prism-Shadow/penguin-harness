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
      variant="secondary"
      data-slot={action.slot}
      aria-current={action.current || undefined}
      aria-haspopup={action.menu ? "menu" : undefined}
      aria-expanded={action.menu ? Boolean(action.expanded) : undefined}
      disabled={action.disabled === true}
      aria-label={action.label}
      title={action.hint ?? action.label}
      onClick={action.run}
      className="h-9 min-w-0 max-w-full gap-2 rounded-[var(--ui-radius-pill)] !px-3.5 aria-current:border-accent aria-current:bg-accent-muted aria-current:text-accent aria-expanded:bg-control-hover"
      leading={
        action.glyph ? (
          <GlyphIcon
            d={action.glyph}
            size={ICON_SIZE.rowLead}
            className={
              action.current || action.slot === "saved-prompt"
                ? "shrink-0 text-accent"
                : "shrink-0 text-fg-muted"
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
      className="mt-4 flex w-full min-w-0 flex-wrap items-center justify-center gap-2"
    >
      {prompts.map((action) => (
        <PromptButton key={action.id} action={action} />
      ))}
      {manage && (
        <IconButton
          label={manage.label}
          variant="secondary"
          onClick={manage.run}
          className="size-9 shrink-0 rounded-[var(--ui-radius-pill)] text-fg-muted hover:text-fg"
        >
          <GlyphIcon d={manage.glyph!} size={ICON_SIZE.rowLead} />
        </IconButton>
      )}
    </div>
  );
}
