import { useEffect, useRef, useState } from "react";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";

/** One immutable run per mount; changing the selected asset cannot display an old response. */
export function MediaTextReview({
  endpoint,
  target,
  currentText,
  stale,
  editable,
  canAccept,
  onAccept,
}: {
  endpoint: string;
  target: NonNullable<ActivityRunSummary["mediaText"]>;
  currentText: string;
  stale: boolean;
  editable: boolean;
  canAccept: boolean;
  onAccept: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load() {
    if (pending.current || text !== null) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await apiFetch<{ candidate: string | null }>(endpoint);
      const candidate = JSON.parse(result.candidate ?? "null");
      if (
        !candidate ||
        candidate.language !== target.language ||
        candidate.assetKey !== target.assetKey ||
        candidate.type !== target.type ||
        typeof candidate.text !== "string" ||
        !candidate.text.trim() ||
        candidate.text.length > 5000
      )
        throw new Error(S.activities.invalidTextCandidate);
      if (alive.current) setText(candidate.text);
    } catch (error) {
      if (alive.current) setError(apiErrorText(error));
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  }
  return (
    <div className="space-y-3 text-xs">
      {error && (
        <p role="alert" className={toneInk.danger}>
          {error}
        </p>
      )}
      {text === null ? (
        <Button size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? S.activities.loading : error ? S.common.retry : S.activities.reviewText}
        </Button>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <h6 className="mb-1 font-semibold">{S.activities.originalText}</h6>
              <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
                {target.text || S.activities.noOriginalText}
              </p>
            </div>
            <div>
              <h6 className="mb-1 font-semibold">{S.activities.suggestedText}</h6>
              <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{text}</p>
            </div>
          </div>
          {text === currentText ? (
            <p className="text-gray-500">{S.activities.matchingText}</p>
          ) : stale ? (
            <p className="text-gray-500">{S.activities.olderText}</p>
          ) : null}
          {editable && text !== currentText && (
            <Button size="sm" disabled={!canAccept} onClick={onAccept}>
              {S.activities.acceptText}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
