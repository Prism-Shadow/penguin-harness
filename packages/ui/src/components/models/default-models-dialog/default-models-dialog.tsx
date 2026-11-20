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
 * - A row may carry a hint: a line that stays under its title (what the default is used for).
 * - The dialog writes nothing itself: each picker commits its own pick (a picker on its own row
 *   commits on change), so the foot holds one button that closes the dialog.
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
  /** A sentence over the rows: what the defaults are, or why the dialog opened. */
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

export function DefaultModelsDialog({
  open,
  title,
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
    </Modal>
  );
}
