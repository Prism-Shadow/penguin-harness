/**
 * A channel's composer: a growing textarea (Enter sends, Shift+Enter breaks the
 * line, an IME's accepting Enter never sends), the send button, the one-line hint that only
 * an @ reaches an employee, and the `@` autocomplete — a portaled panel above the box
 * (through Dropdown's portal, so no ancestor's overflow clips it) listing the channel's own members —
 * employees with their titles, then people, then everyone — ranked against what was typed,
 * walked with the arrow keys and picked with Enter or Tab. A pick types the bare id (`@ceo`), which is
 * what the server resolves; Escape dismisses the panel for that token until it changes.
 */
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { S } from "../../lib/strings";
import { ICON_GAP } from "../../lib/icon-scale";
import { Button } from "../../components/ui/button";
import { Dropdown } from "../../components/ui/dropdown";
import { noAutofill } from "../../components/ui/input";
import { PrincipalChip } from "./shared";
import {
  insertMention,
  mentionInsertId,
  mentionQueryAt,
  rankMentionCandidates,
} from "./channel-mentions";
import type { MentionCandidate, MentionKind } from "./channel-mentions";

/** The box grows with the draft up to this many pixels, then scrolls inside. */
const MAX_BOX_PX = 160;

function kindTitle(kind: MentionKind): string {
  if (kind === "employee") return S.company.channels.employees;
  if (kind === "member") return S.company.channels.members;
  return S.company.channels.mentionAll;
}

export function ChannelComposer({
  candidates,
  names,
  onSend,
}: {
  candidates: readonly MentionCandidate[];
  names: ReadonlyMap<string, string>;
  /** Sends the draft; resolves true once it is in the stream (the draft is then cleared). */
  onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  /** The `start:query` token Escape dismissed the panel for; typing on changes the token and reopens it. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  const mention = mentionQueryAt(text, caret);
  const suggestions = mention === null ? [] : rankMentionCandidates(candidates, mention.query);
  const tokenKey = mention === null ? null : `${mention.start}:${mention.query}`;
  const panelOpen = mention !== null && suggestions.length > 0 && dismissed !== tokenKey;
  const active = suggestions[Math.min(highlight, Math.max(0, suggestions.length - 1))];

  // The box follows its content up to the cap, so a long draft stays in view without a
  // scrollbar appearing at the second line.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_BOX_PX)}px`;
  }, [text]);

  const pick = (c: MentionCandidate) => {
    if (mention === null) return;
    const next = insertMention(text, mention.start, caret, mentionInsertId(c, candidates));
    setText(next.text);
    setCaret(next.caret);
    setHighlight(0);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  };

  const send = async () => {
    const body = text.trim();
    if (body === "" || sending) return;
    setSending(true);
    try {
      if (await onSend(body)) {
        setText("");
        setCaret(0);
      }
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (panelOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (active) pick(active);
        return;
      }
    }
    // Enter sends; Shift+Enter breaks the line. The isComposing guard keeps an IME's
    // candidate-accepting Enter from sending the raw pinyin.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const rows: Array<{ c: MentionCandidate; i: number; head: boolean }> = suggestions.map(
    (c, i) => ({ c, i, head: i === 0 || suggestions[i - 1]!.kind !== c.kind }),
  );

  return (
    <div className="shrink-0 border-t border-gray-200 pt-3 dark:border-gray-800">
      <div className={`flex items-end ${ICON_GAP.menu}`}>
        <Dropdown
          className="min-w-0 flex-1"
          open={panelOpen}
          setOpen={(v) => {
            if (!v) setDismissed(tokenKey);
          }}
          portal={{ direction: "up", align: "left" }}
          menuClass="w-80"
          focusOnOpen={false}
          button={
            <textarea
              ref={inputRef}
              rows={1}
              value={text}
              placeholder={S.company.channels.placeholder}
              aria-label={S.company.channels.placeholder}
              aria-autocomplete="list"
              aria-expanded={panelOpen}
              aria-controls={panelOpen ? listId : undefined}
              aria-activedescendant={
                panelOpen && active ? `${listId}-${active.principal}` : undefined
              }
              disabled={sending}
              {...noAutofill}
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
                setHighlight(0);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onKeyDown={onKeyDown}
              className="block max-h-40 min-h-[2.75rem] w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm leading-relaxed placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:placeholder:text-gray-500"
            />
          }
        >
          <div id={listId} role="listbox" aria-label={S.company.channels.mentionPanel}>
            {rows.map(({ c, i, head }) => (
              <div key={c.principal}>
                {head && (
                  <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                    {kindTitle(c.kind)}
                  </p>
                )}
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${c.principal}`}
                  aria-selected={i === highlight}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(c)}
                  className={`flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left text-xs transition-colors duration-150 ${
                    i === highlight ? "bg-gray-100 dark:bg-gray-800" : ""
                  }`}
                >
                  <span className="min-w-0 truncate">
                    <PrincipalChip principal={c.principal} names={names} />
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                    {c.kind === "all"
                      ? S.company.channels.mentionAllDesc
                      : c.kind === "employee"
                        ? (c.detail ?? "")
                        : ""}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </Dropdown>
        <Button
          variant="primary"
          disabled={sending || text.trim() === ""}
          onClick={() => void send()}
        >
          {S.company.channels.send}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
        {S.company.channels.composerHint}
      </p>
    </div>
  );
}
