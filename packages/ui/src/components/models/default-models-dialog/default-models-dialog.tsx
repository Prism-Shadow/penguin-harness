/**
 * The Project's default models, in one dialog: the default chat model, then each multimodal
 * default (text generation, image understanding, image, video and speech generation, speech
 * recognition), then the tool defaults (web search, page reading) in a quieter group.
 *
 * The dialog lays the rows out; every row's picker is the caller's (the app's model picker,
 * filtered to the models that can serve that row), and so is every word. A row nothing can serve
 * shows the caller's empty state in the picker's place — a sentence, and optionally the action
 * that would make a candidate appear (connecting a provider) — so the reader learns why the row
 * cannot be set rather than meeting a picker with nothing in it.
 *
 * - A section's title is its eyebrow; a `quiet` section's rows read in the muted ink, the way a
 *   secondary group of a settings page does.
 * - What the defaults are is behind a "?" beside the title (`info`); a sentence over the rows
 *   (`intro`) is for why the dialog opened on its own, which the reader needs to see.
 * - A row may carry a hint: a line that stays under its title (what the default is used for).
 * - The dialog writes nothing itself: each picker commits its own pick (a picker on its own row
 *   commits on change), so the foot holds one button that closes the dialog.
 * - The sections without the dialog are `DefaultModelSections`, for a settings page that lists
 *   the same defaults: one layout for both, so the page and the dialog never drift apart.
 */
import type { ReactNode } from "react";
import { Button } from "../../actions/button/button";
import { TextAction } from "../../actions/text-action/text-action";
import { Text } from "../../content/typography/typography";
import { Modal } from "../../overlays/modal/modal";

/** One default: its name and its picker, or the empty state when nothing can serve it. */
export interface DefaultModelRow {
  key: string;
  title: string;
  /** A line kept under the title: what this default is used for. */
  hint?: string;
  /** The picker. Absent: nothing can serve the row, and `empty` stands in its place. */
  control?: ReactNode;
  /** What stands in for the picker when nothing can serve the row. */
  empty?: { text: string; action?: { label: string; onClick: () => void } };
}

/** A run of rows under one eyebrow. */
export interface DefaultModelSection {
  key: string;
  title?: string;
  /** A secondary group: its rows read in the muted ink. */
  quiet?: boolean;
  rows: readonly DefaultModelRow[];
}

export interface DefaultModelsDialogProps {
  open: boolean;
  title: string;
  /** What the defaults are and when they save, behind a "?" beside the title. */
  info?: ReactNode;
  /** A sentence kept over the rows: why the dialog opened by itself. */
  intro?: ReactNode;
  sections: readonly DefaultModelSection[];
  /** The foot's one button, which closes the dialog. */
  doneLabel: string;
  onClose: () => void;
  closeLabel?: string;
}

function Row({ row, quiet }: { row: DefaultModelRow; quiet: boolean }) {
  return (
    <div
      data-default-row={row.key}
      className="grid grid-cols-1 items-center gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_16rem]"
    >
      <div className="min-w-0">
        <p className={`text-sm ${quiet ? "text-fg-muted" : "font-medium"}`}>{row.title}</p>
        {row.hint !== undefined && <p className="mt-0.5 text-xs text-fg-subtle">{row.hint}</p>}
      </div>
      <div className="min-w-0">
        {row.control ??
          (row.empty && (
            <p className="text-xs text-fg-muted">
              {row.empty.text}
              {row.empty.action && (
                <>
                  {" "}
                  <TextAction onClick={row.empty.action.onClick}>
                    {row.empty.action.label}
                  </TextAction>
                </>
              )}
            </p>
          ))}
      </div>
    </div>
  );
}

/** Each section under its eyebrow, its rows ruled apart; a section with no rows is left out. */
export function DefaultModelSections({ sections }: { sections: readonly DefaultModelSection[] }) {
  return (
    <div className="space-y-6">
      {sections
        .filter((section) => section.rows.length > 0)
        .map((section) => (
          <section key={section.key} data-default-section={section.key}>
            {section.title !== undefined && (
              <h3 className="mb-2 flex">
                <Text variant="eyebrow" as="span">
                  {section.title}
                </Text>
              </h3>
            )}
            <div className="divide-y divide-line-muted">
              {section.rows.map((row) => (
                <Row key={row.key} row={row} quiet={section.quiet === true} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

export function DefaultModelsDialog({
  open,
  title,
  info,
  intro,
  sections,
  doneLabel,
  onClose,
  closeLabel,
}: DefaultModelsDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      {...(info !== undefined ? { titleInfo: info } : {})}
      onClose={onClose}
      widthClass="sm:max-w-2xl"
      {...(closeLabel !== undefined ? { closeLabel } : {})}
      footer={
        <Button size="sm" variant="primary" onClick={onClose}>
          {doneLabel}
        </Button>
      }
    >
      <div className="space-y-6">
        {intro !== undefined && <div className="text-sm text-fg-muted">{intro}</div>}
        <DefaultModelSections sections={sections} />
      </div>
    </Modal>
  );
}
