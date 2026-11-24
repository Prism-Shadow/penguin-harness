import { useLayoutEffect, useRef, useState } from "react";
import { Button, GlyphIcon, IconButton, ICONS, ICON_SIZE, Modal } from "@prismshadow/penguin-ui";
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
  run: () => void;
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
  return (
    <Button
      size="sm"
      variant="ghost"
      data-slot={action.slot}
      aria-current={action.current || undefined}
      disabled={action.disabled === true}
      aria-label={action.label}
      title={action.hint ?? action.label}
      onClick={action.run}
      className="h-9 min-w-0 max-w-full !justify-start gap-2 !px-1.5 text-start aria-current:text-accent"
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
    </Button>
  );
}

export function PromptActionRow({
  prompts,
  manage,
  shuffle,
}: {
  prompts: PromptAction[];
  manage?: PromptAction;
  shuffle: PromptAction;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(1);
  const [open, setOpen] = useState(false);
  // Measure the actual composer column. The rem-wide probe follows the reader's text size
  // even when the pane's pixel width is unchanged.
  const measure = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const parent = rail.current;
    const unit = measure.current;
    if (!parent || !unit) return;
    const fit = () => {
      const width = parent.clientWidth / unit.getBoundingClientRect().width;
      setCapacity(width >= 36 ? 3 : width >= 21 ? 2 : 1);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    observer.observe(unit);
    return () => observer.disconnect();
  }, []);
  const visible = prompts.slice(0, capacity);
  const overflow = prompts.slice(capacity);
  const hasMore = overflow.length > 0;
  const showShuffle = visible.some((action) => action.slot === "suggestion");

  return (
    <>
      <div
        ref={rail}
        role="group"
        aria-label={S.chat.start.examplesTitle}
        data-slot="examples"
        className="mt-3 flex w-full min-w-0 items-center gap-1"
      >
        <div className="relative grid min-w-0 flex-1 auto-cols-fr grid-flow-col">
          <span
            ref={measure}
            aria-hidden="true"
            className="pointer-events-none invisible absolute w-[1rem]"
          />
          {visible.map((action) => (
            <PromptButton key={action.id} action={action} />
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 border-s border-line ps-1">
          {showShuffle && (
            <IconButton
              label={shuffle.label}
              variant="ghost"
              onClick={shuffle.run}
              className="min-h-9 min-w-8"
            >
              <GlyphIcon d={ICONS.refresh} size={ICON_SIZE.rowLead} />
            </IconButton>
          )}
          {manage && (
            <IconButton
              label={manage.label}
              variant="ghost"
              onClick={manage.run}
              className="min-h-9 min-w-8"
            >
              <GlyphIcon d={manage.glyph!} size={ICON_SIZE.rowLead} />
            </IconButton>
          )}
          {hasMore && (
            <IconButton
              label={S.chat.start.moreExamples}
              aria-haspopup="dialog"
              aria-expanded={open}
              variant="ghost"
              onClick={() => setOpen(true)}
              className="min-h-9 min-w-8"
            >
              <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.rowLead} />
            </IconButton>
          )}
        </div>
      </div>
      <Modal
        open={open && hasMore}
        title={S.chat.start.moreExamples}
        onClose={() => setOpen(false)}
        widthClass="sm:max-w-md"
      >
        <div className="flex min-w-0 flex-col gap-1">
          {overflow.map((action) => (
            <Button
              key={action.id}
              variant="ghost"
              aria-current={action.current || undefined}
              disabled={action.disabled === true}
              className="h-auto w-full min-w-0 justify-start whitespace-normal text-start"
              onClick={() => {
                setOpen(false);
                action.run();
              }}
            >
              {action.glyph && <GlyphIcon d={action.glyph} size={ICON_SIZE.inlineGlyph} />}
              <span className="min-w-0 [overflow-wrap:anywhere]">{action.label}</span>
            </Button>
          ))}
          {!showShuffle && (
            <Button
              variant="ghost"
              size="sm"
              onClick={shuffle.run}
              className="mt-1 self-start"
              leading={<GlyphIcon d={ICONS.refresh} size={ICON_SIZE.inlineGlyph} />}
            >
              {shuffle.label}
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
