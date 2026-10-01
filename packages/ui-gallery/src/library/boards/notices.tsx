/**
 * 提示条: the package's NoticeStrip in every tone — plain, with the leading mark a call site draws
 * (`data-slot="icon"`, which a theme that draws its own tone mark hides), and with actions — then
 * the Notice built on it in its three variants with its action slots, and the page to-do.
 */
import { Button, Dot, ICONS, Notice, NoticeStrip, TodoNotice } from "@prismshadow/penguin-ui";
import type { NoticeStripTone } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const TONES: readonly NoticeStripTone[] = ["info", "success", "attention", "danger", "neutral"];

const STRIP_CLASS = "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm";

export function NoticesBoard() {
  const { S } = useGallery();
  const t = S.library.notices;
  return (
    <div className="gf-board">
      <BoardGroup title={t.plain}>
        <div className="lib-stack">
          {TONES.map((tone) => (
            <NoticeStrip key={tone} tone={tone} as="p" className={STRIP_CLASS}>
              {t.texts[tone]}
            </NoticeStrip>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.dotted}>
        <div className="lib-stack">
          {TONES.map((tone) => (
            <NoticeStrip key={tone} tone={tone} className={STRIP_CLASS}>
              <span data-slot="icon" className="flex">
                <Dot tone={tone} />
              </span>
              <span>{t.texts[tone]}</span>
            </NoticeStrip>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.withActions}>
        <div className="lib-stack">
          {(["info", "attention", "danger"] as const).map((tone) => (
            <NoticeStrip key={tone} tone={tone} className={STRIP_CLASS}>
              <span className="min-w-0 flex-1">{t.texts[tone]}</span>
              <span data-slot="actions" className="flex shrink-0 gap-2">
                <Button size="sm" variant="ghost">
                  {t.dismiss}
                </Button>
                <Button size="sm">{t.action}</Button>
              </span>
            </NoticeStrip>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.variants}>
        <div className="lib-stack">
          <span className="lib-caption">{t.variantNames.strip}</span>
          <div className="lib-box">
            <Notice tone="danger" variant="strip" retry={{ label: t.retry, onClick: noop }}>
              {t.texts.danger}
            </Notice>
          </div>
          <span className="lib-caption">{t.variantNames.callout}</span>
          <Notice
            tone="attention"
            variant="callout"
            title={t.calloutTitle}
            glyph={ICONS.info}
            dismiss={{ label: t.dismiss, onClick: noop }}
            action={{ label: t.action, onClick: noop }}
          >
            {t.calloutBody}
          </Notice>
          <span className="lib-caption">{t.variantNames.inline}</span>
          <Notice tone="info" variant="inline" dismiss={{ onClick: noop }}>
            {t.texts.info}
          </Notice>
        </div>
      </BoardGroup>
      <BoardGroup title={t.todo}>
        <div className="lib-stack">
          <TodoNotice
            text={t.todoText}
            actionLabel={t.todoAction}
            onAction={noop}
            dismissLabel={t.todoDismiss}
            onDismiss={noop}
          />
        </div>
      </BoardGroup>
    </div>
  );
}

function noop() {}
