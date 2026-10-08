/**
 * The assessment's items, edited without JSON: each item's question, its choices, which of
 * them is correct and whether they shuffle; items and choices added and removed. The
 * interaction is fixed per item and titles are derived, so both are shown, not edited.
 * Nothing is saved while a blocker stands, and each blocker names its item.
 */
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { S } from "../../lib/strings";
import { toneStrip } from "../../lib/tone";
import {
  addChoice,
  addItem,
  blockers,
  canRemoveChoice,
  itemTitle,
  itemsChanged,
  readItems,
  removeChoice,
  removeItem,
  setCorrect,
  updateItem,
  writeItems,
  type AssessmentBlocker,
  type AssessmentDraftItem,
} from "./assessment-items";

function blockerText(blocker: AssessmentBlocker): string {
  const words = S.activities.assessment.blockers;
  if (blocker.code === "noItems") return words.noItems;
  return words[blocker.code](blocker.item + 1);
}

export function AssessmentItemsEditor({
  value,
  savedValue = value,
  onChange,
  editable,
  busy,
  onSave,
}: {
  /** The assessment document as saved. */
  value: unknown;
  savedValue?: unknown;
  onChange?: (value: Record<string, unknown>) => void;
  /** Whether this viewer may change it here. */
  editable: boolean;
  busy: boolean;
  onSave: (value: Record<string, unknown>) => void;
}) {
  const words = S.activities.assessment;
  const saved = useMemo(() => readItems(savedValue), [savedValue]);
  const current = useMemo(() => readItems(value), [value]);
  const [localItems, setLocalItems] = useState<AssessmentDraftItem[]>(() => current ?? []);
  const items = onChange ? (current ?? []) : localItems;
  const setItems = (
    update: AssessmentDraftItem[] | ((items: AssessmentDraftItem[]) => AssessmentDraftItem[]),
  ) => {
    const next = typeof update === "function" ? update(items) : update;
    if (onChange) onChange(writeItems(next, value));
    else setLocalItems(next);
  };
  if (!saved || !current) return <p className="text-xs text-gray-500">{words.unsupported}</p>;
  const found = blockers(items);
  const changed = itemsChanged(items, saved);
  const locked = !editable || busy;
  const change = (index: number, update: (item: AssessmentDraftItem) => AssessmentDraftItem) =>
    setItems((current) => updateItem(current, index, update));

  return (
    <section aria-label={words.items} className="space-y-3">
      <h4 className="text-xs font-semibold">{words.items}</h4>
      {items.length > 0 && (
        <ol className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800/60 dark:border-gray-800">
          {items.map((item, index) => (
            <li
              key={item.origin ?? `new-${index}`}
              aria-label={words.itemTitle(index + 1, itemTitle(value, index))}
              className="space-y-2 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {words.itemTitle(index + 1, itemTitle(value, index))}
                </span>
                <span className="text-xs text-gray-500">{words.interaction[item.interaction]}</span>
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked}
                    onClick={() => setItems((current) => removeItem(current, index))}
                  >
                    {words.removeItem}
                  </Button>
                )}
              </div>
              <Textarea
                size="sm"
                label={words.question}
                rows={2}
                value={item.question}
                readOnly={!editable}
                disabled={editable && busy}
                onChange={(event) => {
                  const question = event.target.value;
                  change(index, (current) => ({ ...current, question }));
                }}
              />
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={item.shuffle}
                  disabled={locked}
                  onChange={(shuffle) => change(index, (current) => ({ ...current, shuffle }))}
                />
                {words.shuffle}
              </label>
              <ul className="space-y-1">
                {item.choices.map((choice, position) => (
                  <li key={position} className="flex items-center gap-2">
                    <input
                      type={item.interaction === "SIMPLE_CHOICE" ? "radio" : "checkbox"}
                      name={`assessment-item-${index}-correct`}
                      aria-label={words.correctOf(position + 1)}
                      title={words.correct}
                      checked={choice.isCorrect}
                      disabled={locked}
                      onChange={(event) => {
                        const on = event.target.checked;
                        change(index, (current) => setCorrect(current, choice.id, on));
                      }}
                      className="h-4 w-4 shrink-0 accent-brand-600"
                    />
                    <Input
                      size="sm"
                      aria-label={words.choice(position + 1)}
                      className="min-w-0 flex-1"
                      value={choice.text}
                      readOnly={!editable}
                      disabled={editable && busy}
                      onChange={(event) => {
                        const text = event.target.value;
                        change(index, (current) => ({
                          ...current,
                          choices: current.choices.map((entry) =>
                            entry.id === choice.id ? { ...entry, text } : entry,
                          ),
                        }));
                      }}
                    />
                    {editable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={words.removeChoiceOf(position + 1)}
                        disabled={locked || !canRemoveChoice(item)}
                        onClick={() => change(index, (current) => removeChoice(current, choice.id))}
                      >
                        {words.removeChoice}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  onClick={() => change(index, addChoice)}
                >
                  {words.addChoice}
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
      {editable && found.length > 0 && (
        <div role="alert" className={`rounded-md border p-3 text-xs ${toneStrip.danger}`}>
          <ul className="list-disc space-y-0.5 pl-4">
            {found.map((blocker, index) => (
              <li key={index}>{blockerText(blocker)}</li>
            ))}
          </ul>
        </div>
      )}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={locked}
            onClick={() => setItems((current) => addItem(current))}
          >
            {words.addItem}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={locked || !changed}
            onClick={() => setItems(saved)}
          >
            {words.reset}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={locked || !changed || found.length > 0}
            onClick={() => onSave(writeItems(items, value))}
          >
            {words.save}
          </Button>
        </div>
      )}
    </section>
  );
}
