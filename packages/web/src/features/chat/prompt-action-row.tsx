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
  iconOnly?: boolean;
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
  if (action.iconOnly) {
    return (
      <IconButton label={action.label} variant="ghost" onClick={action.run}>
        <GlyphIcon d={action.glyph!} size={ICON_SIZE.rowLead} />
      </IconButton>
    );
  }
  return (
    <Button
      size="sm"
      variant={action.slot ? "secondary" : "ghost"}
      data-slot={action.slot}
      aria-current={action.current || undefined}
      disabled={action.disabled === true}
      aria-label={action.label}
      title={action.hint ?? action.label}
      onClick={action.run}
      className="min-h-9 max-w-full whitespace-nowrap"
      leading={
        action.glyph ? <GlyphIcon d={action.glyph} size={ICON_SIZE.inlineGlyph} /> : undefined
      }
    >
      <span className="min-w-0 truncate">{action.preview ?? action.label}</span>
    </Button>
  );
}

export function PromptActionRow({ actions }: { actions: PromptAction[] }) {
  const row = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(0);
  const [open, setOpen] = useState(false);
  // Hidden items keep their intrinsic width at the start of the row, outside the flex flow.
  // An actual font/locale change therefore resizes them even when they are in the dialog.
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const children = Array.from(element.children) as HTMLElement[];
    const more = children.pop()!;
    const fit = () => {
      const width = element.clientWidth;
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      const widths = children.map((child) => child.getBoundingClientRect().width);
      const total = widths.reduce((sum, w, i) => sum + w + (i ? gap : 0), 0);
      if (total <= width) {
        setVisible(widths.length);
        return;
      }
      let used = more.getBoundingClientRect().width;
      let count = 0;
      for (const w of widths) {
        if (used + gap + w > width) break;
        used += gap + w;
        count++;
      }
      setVisible(count);
    };
    fit();
    const observer = new ResizeObserver(fit);
    [element, more, ...children].forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [actions]);
  const hidden = "invisible pointer-events-none absolute start-0";
  const hasMore = visible < actions.length;
  return (
    <>
      <div
        ref={row}
        role="group"
        aria-label={S.chat.start.examplesTitle}
        data-slot="examples"
        className="relative mt-4 flex w-full min-w-0 items-center justify-center gap-2 py-1"
      >
        {actions.map((action, i) => (
          <div
            key={action.id}
            inert={i >= visible}
            className={`min-w-0 max-w-full shrink-0 ${i >= visible ? hidden : ""}`}
          >
            <PromptButton action={action} />
          </div>
        ))}
        <div inert={!hasMore} className={`min-w-0 max-w-full shrink-0 ${!hasMore ? hidden : ""}`}>
          <IconButton
            label={S.chat.start.moreExamples}
            aria-haspopup="dialog"
            aria-expanded={open}
            variant="ghost"
            onClick={() => setOpen(true)}
          >
            <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.rowLead} />
          </IconButton>
        </div>
      </div>
      <Modal
        open={open && hasMore}
        title={S.chat.start.moreExamples}
        onClose={() => setOpen(false)}
        widthClass="sm:max-w-md"
      >
        <div className="flex min-w-0 flex-col gap-1">
          {actions.slice(visible).map((action) => (
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
        </div>
      </Modal>
    </>
  );
}
