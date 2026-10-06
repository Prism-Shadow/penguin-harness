/**
 * The question card: an assistant reply that asks the user to choose renders, in place of the
 * block it was written as, as a card they can answer — the shape a plan-sharpening interview
 * produces round after round. Everything about WHAT a card contains lives in ask-block.ts;
 * this file is the part that holds a draft, sends it, and shows what was sent.
 *
 * **The answer travels as an ordinary user message.** Submit composes text (composeAskAnswers)
 * and hands it to the same send path the composer uses, so the engine, the transcript and the
 * context see a user who typed their answer — no new message type, no pending-request
 * protocol, no turn the agent is blocked inside. The cost is the one this shape implies: a
 * card is answerable once its turn has ENDED (while streaming, the block is still being
 * written, so the parent renders plain Markdown instead), and the agent cannot wait for an
 * answer inside the same turn — it ends its turn and reads the answer as the next one.
 *
 * **A card never pre-selects its recommendation.** The author's suggestion is a hint on the
 * row, not a default: a default would turn a stray double-click on Submit into an answer the
 * user never gave. For the same reason Submit refuses to send an empty answer, and Skip —
 * which IS a deliberate act — records the question as skipped rather than quietly adopting
 * the recommendation.
 *
 * **Drafts are held per message, not per card.** A round asks several questions at once, so
 * the message carrying them offers one "submit all" for the cards still unanswered; that
 * button has to read every card's draft, which is why the state lives in the body and the
 * cards themselves are presentational.
 */
import { useEffect, useMemo, useState } from "react";
import type { AskAnswer, AskCard as AskCardData, AssistantSegment } from "./ask-block";
import { composeAskAnswers, splitAskBlocks } from "./ask-block";
import { S } from "../../lib/strings";
import { Badge, Button, GlyphIcon, ICON_SIZE, Md } from "@prismshadow/penguin-ui";

/** A question mark in a circle, drawn like the rest of the icon set (stroke paths, 24×24). */
const ASK_ICON =
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.4a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1 .8-1 1.6v.3M12 17h.01";

/** One card's answer while the user is still shaping it. */
interface AskDraft {
  /** Chosen option indices. */
  selected: ReadonlySet<number>;
  /** The free-text row's content. */
  other: string;
  /** The free-text row is open (its input is showing). */
  otherOpen: boolean;
  /** The answer has been sent: the card shows what was sent and offers a re-answer. */
  sent: boolean;
  /** It was sent as a skip; only meaningful once `sent`. */
  skipped: boolean;
  /** Submit was pressed with nothing chosen — show the hint instead of sending. */
  blocked: boolean;
}

function emptyDraft(): AskDraft {
  return {
    selected: new Set(),
    other: "",
    otherOpen: false,
    sent: false,
    skipped: false,
    blocked: false,
  };
}

/** Whether the user has said anything for this card: a choice, or text in the free-text row. */
function answered(draft: AskDraft): boolean {
  return draft.selected.size > 0 || draft.other.trim() !== "";
}

function toAnswer(card: AskCardData, draft: AskDraft, skipped: boolean): AskAnswer {
  return {
    title: card.title,
    choices: card.options.filter((o) => draft.selected.has(o.index)).map((o) => o.text),
    other: draft.other,
    skipped,
  };
}

/** The lines a sent card shows back, matching what composeAskAnswers put in the message. */
function sentLines(
  card: AskCardData,
  draft: AskDraft,
  labels: { other: string; skipped: string },
): string[] {
  if (draft.skipped) return [labels.skipped];
  const lines = card.options.filter((o) => draft.selected.has(o.index)).map((o) => o.text);
  if (draft.other.trim() !== "") lines.push(`${labels.other}${draft.other.trim()}`);
  return lines;
}

/** One assistant text run and the cards around it, with the index each card has among them. */
type Block = { kind: "text"; text: string } | { kind: "ask"; card: AskCardData; index: number };

function toBlocks(text: string): Block[] {
  let index = 0;
  return splitAskBlocks(text).map((segment: AssistantSegment) =>
    segment.kind === "ask" ? { kind: "ask", card: segment.card, index: index++ } : segment,
  );
}

/**
 * The body of an assistant message: its prose runs, and every question card among them.
 * Without `onSubmit` the cards still render — a nested conversation's transcript still has to
 * show what was asked — but their rows are inert, since nothing here can send a message on
 * that conversation's behalf.
 */
export function AssistantBody({
  text,
  onSubmit,
}: {
  text: string;
  onSubmit?: (text: string) => Promise<boolean>;
}) {
  const blocks = useMemo(() => toBlocks(text), [text]);
  const cardCount = useMemo(() => blocks.filter((b) => b.kind === "ask").length, [blocks]);
  const [drafts, setDrafts] = useState<AskDraft[]>(() =>
    Array.from({ length: cardCount }, emptyDraft),
  );
  const [sending, setSending] = useState(false);

  // A settled message's cards do not change, but a re-render can arrive with different text
  // (a replayed or healed item). Rebuild the drafts then, keeping the ones already shaped, so
  // the array can never drift out of step with the cards it describes.
  useEffect(() => {
    setDrafts((prev) =>
      prev.length === cardCount
        ? prev
        : Array.from({ length: cardCount }, (_, i) => prev[i] ?? emptyDraft()),
    );
  }, [cardCount]);

  const labels = useMemo(() => ({ other: S.ask.answerOther, skipped: S.ask.answerSkipped }), []);

  const patch = (index: number, next: Partial<AskDraft>) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...next } : d)));

  /** Sends one composed message for `indices`, marking those cards sent on success. */
  const send = async (answers: AskAnswer[], indices: number[], skipped: boolean): Promise<void> => {
    if (onSubmit === undefined || sending) return;
    setSending(true);
    try {
      const ok = await onSubmit(composeAskAnswers(answers, labels)).catch(() => false);
      // On failure the sender has already said why (its own error toast); the draft stays
      // editable so the answer is not lost.
      if (!ok) return;
      setDrafts((prev) =>
        prev.map((d, i) =>
          indices.includes(i) ? { ...d, sent: true, skipped, blocked: false } : d,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  const draftAt = (index: number): AskDraft => drafts[index] ?? emptyDraft();

  const toggle = (index: number, card: AskCardData, option: number) => {
    const draft = draftAt(index);
    const selected = new Set(draft.selected);
    if (card.multi) {
      if (selected.has(option)) selected.delete(option);
      else selected.add(option);
    } else {
      const wasOnly = selected.size === 1 && selected.has(option);
      selected.clear();
      if (!wasOnly) selected.add(option);
    }
    patch(index, { selected, blocked: false });
  };

  const submitCard = (index: number, card: AskCardData) => {
    const draft = draftAt(index);
    if (!answered(draft)) {
      patch(index, { blocked: true });
      return;
    }
    void send([toAnswer(card, draft, false)], [index], false);
  };

  const skipCard = (index: number, card: AskCardData) => {
    void send([toAnswer(card, draftAt(index), true)], [index], true);
  };

  const pending = Array.from({ length: cardCount }, (_, i) => i).filter((i) => !draftAt(i).sent);
  const submitAllPending = pending.filter((i) => answered(draftAt(i)));

  return (
    <>
      {blocks.map((block, i) =>
        block.kind === "text" ? (
          <Md key={`t${i}`} text={block.text} streaming={false} />
        ) : (
          <AskCardView
            key={`a${i}`}
            card={block.card}
            draft={draftAt(block.index)}
            readOnly={onSubmit === undefined}
            busy={sending}
            labels={labels}
            onToggle={(option) => toggle(block.index, block.card, option)}
            onOpenOther={() => patch(block.index, { otherOpen: true, blocked: false })}
            onOtherChange={(value) => patch(block.index, { other: value, blocked: false })}
            onSkip={() => skipCard(block.index, block.card)}
            onSubmit={() => submitCard(block.index, block.card)}
            onReanswer={() => patch(block.index, { sent: false, skipped: false })}
          />
        ),
      )}
      {cardCount > 1 && pending.length > 0 && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="text-xs text-gray-400">
            {S.ask.pendingCount(pending.length, cardCount)}
          </span>
          <Button
            size="sm"
            variant="primary"
            disabled={onSubmit === undefined || sending || submitAllPending.length < pending.length}
            onClick={() =>
              void send(
                submitAllPending.map((i) => toAnswer(blockCard(blocks, i), draftAt(i), false)),
                submitAllPending,
                false,
              )
            }
          >
            {S.ask.submitAll}
          </Button>
        </div>
      )}
    </>
  );
}

/** The card stored at `index` (the batch button reads cards by their index among all cards). */
function blockCard(blocks: readonly Block[], index: number): AskCardData {
  const block = blocks.find((b) => b.kind === "ask" && b.index === index);
  // Unreachable: indices come from the same list. Falling back keeps the type honest.
  if (block === undefined || block.kind !== "ask") throw new Error("ask card missing");
  return block.card;
}

function AskCardView({
  card,
  draft,
  readOnly,
  busy,
  labels,
  onToggle,
  onOpenOther,
  onOtherChange,
  onSkip,
  onSubmit,
  onReanswer,
}: {
  card: AskCardData;
  draft: AskDraft;
  readOnly: boolean;
  busy: boolean;
  labels: { other: string; skipped: string };
  onToggle: (option: number) => void;
  onOpenOther: () => void;
  onOtherChange: (value: string) => void;
  onSkip: () => void;
  onSubmit: () => void;
  onReanswer: () => void;
}) {
  const locked = readOnly || busy || draft.sent;
  const otherNumber = card.options.length + 1;

  const rowClass = (selected: boolean) =>
    [
      "flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors",
      readOnly ? "cursor-default" : "cursor-pointer",
      selected
        ? "border-[var(--accent-bg)] bg-[var(--accent-bg)]/8 text-gray-900 dark:text-gray-50"
        : readOnly
          ? "border-transparent text-gray-600 dark:text-gray-300"
          : "border-transparent text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/60",
    ].join(" ");

  return (
    <div
      // Read by the notification hook: "pending" is the one card state that is answerable
      // right now (a read-only card belongs to a nested conversation nothing here can send
      // on, and a sent one is waiting for the agent, not the user).
      data-ask-card={readOnly ? "readonly" : draft.sent ? "sent" : "pending"}
      className="my-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/60"
      onKeyDown={(event) => {
        // Enter submits from anywhere in the card except a control that already acts on Enter
        // (the option rows and the two buttons would otherwise fire twice).
        if (event.key !== "Enter" || draft.sent) return;
        if ((event.target as HTMLElement).tagName === "BUTTON") return;
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-start gap-2">
        <GlyphIcon
          d={ASK_ICON}
          size={ICON_SIZE.inlineGlyph}
          className="mt-0.5 shrink-0 text-gray-400"
        />
        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{card.title}</span>
        <span className="min-w-0 flex-1" />
        {card.multi && <Badge tone="neutral">{S.ask.multiSelect}</Badge>}
      </div>

      {draft.sent ? (
        <div className="mt-2 pl-6">
          <ul className="space-y-0.5 text-sm text-gray-500 dark:text-gray-400">
            {sentLines(card, draft, labels).map((line, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {!readOnly && (
            <Button size="sm" variant="ghost" className="mt-1" onClick={onReanswer}>
              {S.ask.reanswer}
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-col gap-0.5">
            {card.options.map((option) => {
              const selected = draft.selected.has(option.index);
              return (
                <button
                  key={option.index}
                  type="button"
                  disabled={locked}
                  aria-pressed={card.multi ? selected : undefined}
                  aria-checked={card.multi ? undefined : selected}
                  role={card.multi ? "checkbox" : "radio"}
                  className={rowClass(selected)}
                  onClick={() => onToggle(option.index)}
                >
                  <span className="w-3 shrink-0 pt-0.5 text-xs text-gray-400">{option.index}</span>
                  <span className="min-w-0 flex-1">{option.text}</span>
                  {card.recommended.includes(option.index) && (
                    <Badge tone="info">{S.ask.recommended}</Badge>
                  )}
                </button>
              );
            })}

            {/* The free-text row is part of every card, so a question the options do not cover
                is still answerable without the author having remembered to offer it. */}
            {draft.otherOpen ? (
              <div className={rowClass(draft.other.trim() !== "")}>
                <span className="w-3 shrink-0 pt-0.5 text-xs text-gray-400">{otherNumber}</span>
                <input
                  autoFocus
                  value={draft.other}
                  disabled={locked}
                  placeholder={S.ask.otherPlaceholder}
                  aria-label={S.ask.other}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
                  onChange={(event) => onOtherChange(event.target.value)}
                />
              </div>
            ) : (
              <button
                type="button"
                disabled={locked}
                className={rowClass(false)}
                onClick={onOpenOther}
              >
                <span className="w-3 shrink-0 pt-0.5 text-xs text-gray-400">{otherNumber}</span>
                <span className="min-w-0 flex-1">{S.ask.other}</span>
              </button>
            )}
          </div>

          {draft.blocked && (
            <p className="mt-1.5 pl-5 text-xs text-amber-600 dark:text-amber-500">
              {S.ask.needChoice}
            </p>
          )}

          {!readOnly && (
            <div className="mt-2 flex items-center justify-end gap-1">
              <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip}>
                {S.ask.skip}
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={onSubmit}>
                {S.ask.submit}
                <span className="opacity-60">⏎</span>
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
