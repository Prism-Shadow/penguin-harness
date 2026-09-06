/**
 * The draft page's card in surface mode: instead of the composer, one line for a first
 * prompt and the button that opens the surface. Agent and Workspace are still chosen on the
 * row below the card, exactly as for a conversation — a surface Session is created with
 * them, then opened (see draft-view.tsx).
 */
import { useState, type KeyboardEvent } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { S } from "../../lib/strings";

export function SurfaceComposer({
  label,
  unavailable,
  busy,
  onOpen,
}: {
  /** The surface's label, in the interface language. */
  label: string;
  /** The surface is not among what the server contributes (its plugin is not loaded). */
  unavailable: boolean;
  busy: boolean;
  onOpen: (prompt: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const disabled = unavailable || busy;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && !disabled) {
      e.preventDefault();
      onOpen(prompt);
    }
  };
  return (
    <div
      data-testid="surface-composer"
      className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="mb-3 text-sm font-medium text-gray-900 dark:text-gray-100">{label}</div>
      {unavailable ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{S.chat.surface.unavailable}</p>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={S.chat.surface.promptPlaceholder}
            autoFocus
            disabled={busy}
            className="flex-1"
          />
          <Button variant="primary" onClick={() => onOpen(prompt)} disabled={disabled}>
            {busy ? S.chat.surface.opening : S.chat.surface.open}
          </Button>
        </div>
      )}
    </div>
  );
}
