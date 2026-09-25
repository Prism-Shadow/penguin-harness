/**
 * A decodable book's word pronunciations, at the head of the Audios section: how many words
 * the story shows and how many still lack sounds, **Refresh words** to bring them in line
 * with the story (espeak-ng fills the sounds it can), and **Ask a model for the rest**, whose
 * proposal is listed here and accepted with **Use these sounds**.
 *
 * It reads the book's recorded reading mode and espeak-ng's status itself; everything it
 * changes goes through the page, which owns the draft.
 */
import { useEffect, useState } from "react";
import type {
  ActivityRunSummary,
  AssetManifest,
  BookWordsState,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  PHONEMES_RUN_MAX_WORDS,
  bookWordAssets,
  isDecodable,
  latestPhonemesRun,
  parseProposal,
  proposalRows,
  wordsWithoutSounds,
  type BookMode,
} from "./book-words";

type MediaAsset = AssetManifest["assets"][string][number];

export function BookWordsPanel({
  endpoint,
  language,
  group,
  runs,
  revision,
  chosenMode,
  editable,
  canChange,
  canGenerate,
  onRefresh,
  onAskModel,
  onUseSounds,
}: {
  endpoint: string;
  language: string;
  group: readonly MediaAsset[];
  runs: readonly ActivityRunSummary[];
  /** The saved draft's revision, which a proposal must have been made against. */
  revision: string;
  /** The reading mode chosen on this page, which counts only where the product records none. */
  chosenMode: BookMode | "";
  editable: boolean;
  /** Whether a draft change can go now: nothing running and nothing unsaved. */
  canChange: boolean;
  canGenerate: boolean;
  onRefresh: (bookMode: BookMode | undefined) => void;
  onAskModel: (words: string[]) => void;
  onUseSounds: (runId: string) => void;
}) {
  const [state, setState] = useState<BookWordsState | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<BookWordsState>(`${endpoint}/book-words`)
      .then((value) => {
        if (!cancelled) setState(value);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const run = latestPhonemesRun(runs, language);
  const [candidate, setCandidate] = useState<{ runId: string; text: string | null } | null>(null);
  const wanted = run?.status === "succeeded" && run.hasCandidate ? run.runId : null;
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    apiFetch<{ candidate: string | null }>(
      `${endpoint}/runs/${encodeURIComponent(wanted)}/candidate`,
    )
      .then((value) => {
        if (!cancelled) setCandidate({ runId: wanted, text: value.candidate });
      })
      .catch(() => {
        if (!cancelled) setCandidate({ runId: wanted, text: null });
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, wanted]);

  const words = S.activities.bookWords;
  const all = bookWordAssets(group);
  const decodable = isDecodable(state, chosenMode, all.length > 0);
  const missing = wordsWithoutSounds(group);
  const proposal = candidate && candidate.runId === wanted ? parseProposal(candidate.text) : null;
  const proposed = proposal ? proposalRows(proposal, group) : [];
  // Only what accepting would change: a word that has sounds by now keeps them. A proposal
  // whose every word has sounds (it was accepted) is done and not shown again.
  const rows = proposed.filter((row) => row.applies);
  const stale = !!run && run.inputRevision !== revision;
  if (!state) return null;
  return (
    <section className="space-y-2" aria-label={words.group}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {words.group}
        <InfoPopover label={words.group}>
          <p>{words.about}</p>
        </InfoPopover>
      </h3>
      {!decodable ? (
        <p className="text-xs text-gray-500">{words.notDecodable}</p>
      ) : (
        <>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {words.count(all.length)}
            {all.length > 0 && (
              <> · {missing.length ? words.missing(missing.length) : words.allSounded}</>
            )}
          </p>
          {missing.length > 0 && !state.espeak.available && (
            <p className={`text-xs ${toneInk.attention}`}>{words.espeakMissing}</p>
          )}
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!canChange}
                onClick={() => onRefresh(state.bookMode ? undefined : "decodable")}
              >
                {words.refresh}
              </Button>
              {missing.length > 0 && (
                <Button
                  size="sm"
                  disabled={!canGenerate}
                  onClick={() => onAskModel(missing.slice(0, PHONEMES_RUN_MAX_WORDS))}
                >
                  {words.askModel}
                </Button>
              )}
            </div>
          )}
          {missing.length > PHONEMES_RUN_MAX_WORDS && (
            <p className="text-xs text-gray-500">{words.askFirst(PHONEMES_RUN_MAX_WORDS)}</p>
          )}
          {run?.status === "running" && <p className="text-xs text-gray-500">{words.asking}</p>}
          {run && (run.status === "failed" || run.status === "conflict") && (
            <p className={`break-words text-xs ${toneInk.danger}`}>
              {words.proposalFailed}
              {run.error ? ` ${run.error}` : ""}
            </p>
          )}
          {proposal && (rows.length > 0 || proposed.length === 0) && (
            <section className="space-y-2" aria-label={words.proposal}>
              <h4 className="text-xs font-semibold">{words.proposal}</h4>
              {rows.length ? (
                <ul className="space-y-0.5 text-xs">
                  {rows.map((row) => (
                    <li key={row.normalizedWord}>
                      <span className="font-medium">{row.word}</span>: {row.sounds.join(" ")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500">{words.noneProposed}</p>
              )}
              {stale && <p className="text-xs text-gray-500">{words.proposalStale}</p>}
              {editable && (
                <Button
                  size="sm"
                  disabled={!canChange || stale || !rows.length}
                  onClick={() => onUseSounds(run!.runId)}
                >
                  {words.useSounds}
                </Button>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
