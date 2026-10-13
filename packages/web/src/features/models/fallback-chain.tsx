/**
 * The Project's model fallback chain, as the Models page edits it.
 *
 * The chain is what a Session moves onto when its own model answers 429 (see the server's
 * `rate_limited` outcome): first entry tried first. An empty chain is the default and means
 * no failover at all, so a rate-limited turn retries on its own model as it always has.
 *
 * The order is the whole meaning of the list, which is why the controls are ↑ / ↓ rather
 * than a drag handle: a two-entry chain is the common case, and the keyboard reaches these.
 */
import { useState } from "react";
import { Button } from "@prismshadow/penguin-ui";
import type { ModelInfo, ModelRefDto } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

/** Whether two references name the same (provider, model) pair. */
export function sameChainRef(a: ModelRefDto, b: ModelRefDto): boolean {
  return a.provider === b.provider && a.modelId === b.modelId;
}

/**
 * Moves one entry by `delta` (−1 up, +1 down). A move that would leave the list returns it
 * unchanged, so a caller can wire the buttons without bounds checks of its own.
 */
export function moveInChain(
  chain: readonly ModelRefDto[],
  index: number,
  delta: number,
): ModelRefDto[] {
  const target = index + delta;
  if (index < 0 || index >= chain.length || target < 0 || target >= chain.length) {
    return [...chain];
  }
  const next = [...chain];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/** Appends a model, ignoring one already in the chain (a chain lists each model once). */
export function addToChain(chain: readonly ModelRefDto[], ref: ModelRefDto): ModelRefDto[] {
  return chain.some((entry) => sameChainRef(entry, ref)) ? [...chain] : [...chain, ref];
}

/** Drops the entry at `index`. */
export function removeFromChain(chain: readonly ModelRefDto[], index: number): ModelRefDto[] {
  return chain.filter((_, i) => i !== index);
}

/** The chain as one card: the entries in order, and a picker that appends one of the Project's models. */
export function FallbackChainCard({
  chain,
  models,
  onChange,
}: {
  chain: readonly ModelRefDto[];
  models: readonly ModelInfo[];
  onChange: (next: ModelRefDto[]) => void;
}) {
  const [pick, setPick] = useState("");
  const choices = models
    .map((m) => ({ provider: m.provider, modelId: m.modelId }))
    .filter((ref) => !chain.some((entry) => sameChainRef(entry, ref)));
  const picked = choices.find((ref) => `${ref.provider}/${ref.modelId}` === pick);

  return (
    <section className="rounded-lg border border-border p-4" data-testid="fallback-chain">
      <h2 className="text-sm font-semibold text-fg">{S.models.fallbackChain}</h2>
      <p className="mt-1 text-xs text-fg-subtle">{S.models.fallbackChainHint}</p>
      {chain.length === 0 ? (
        <p className="mt-3 text-xs text-fg-subtle" data-testid="fallback-chain-empty">
          {S.models.fallbackChainEmpty}
        </p>
      ) : (
        <ol className="mt-3 space-y-1">
          {chain.map((ref, index) => (
            <li
              key={`${ref.provider}/${ref.modelId}`}
              className="flex items-center gap-2 text-sm"
              data-testid="fallback-chain-row"
            >
              <span className="w-5 text-xs text-fg-subtle">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-fg">
                {ref.provider} / {ref.modelId}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={S.models.fallbackChainUp}
                disabled={index === 0}
                onClick={() => onChange(moveInChain(chain, index, -1))}
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={S.models.fallbackChainDown}
                disabled={index === chain.length - 1}
                onClick={() => onChange(moveInChain(chain, index, 1))}
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={S.models.fallbackChainRemove}
                onClick={() => onChange(removeFromChain(chain, index))}
              >
                ✕
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex items-center gap-2">
        <select
          className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg"
          aria-label={S.models.fallbackChainAdd}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">{S.models.fallbackChainPick}</option>
          {choices.map((ref) => (
            <option key={`${ref.provider}/${ref.modelId}`} value={`${ref.provider}/${ref.modelId}`}>
              {ref.provider} / {ref.modelId}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={picked === undefined}
          onClick={() => {
            if (picked === undefined) return;
            onChange(addToChain(chain, picked));
            setPick("");
          }}
        >
          {S.models.fallbackChainAdd}
        </Button>
      </div>
    </section>
  );
}
