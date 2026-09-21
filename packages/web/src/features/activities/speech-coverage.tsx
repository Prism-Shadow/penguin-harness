/**
 * What narration one language still needs, and one way to ask for all of it. The list
 * and the button are driven by the same pure model, so the count an author reads is
 * exactly the work the button starts.
 */
import { useState } from "react";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { InfoPopover } from "../../components/ui/info-popover";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { pendingSpeechKeys, speechStatuses, speechTally } from "./bulk-speech";

type MediaAsset = AssetManifest["assets"][string][number];

export function SpeechCoverage({
  assets,
  language,
  editable,
  canGenerate,
  onSelect,
  onGenerateAll,
  queued,
  onCancelQueue,
}: {
  assets: readonly MediaAsset[];
  language: string;
  editable: boolean;
  canGenerate: boolean;
  /** Open one narration in the workbench's detail panel. */
  onSelect: (key: string) => void;
  onGenerateAll: (keys: string[]) => void;
  /** How many narrations are still queued; 0 when no bulk run is in flight. */
  queued: number;
  onCancelQueue: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const statuses = speechStatuses(assets);
  const tally = speechTally(assets);
  const pending = pendingSpeechKeys(assets);
  if (!tally.total) return <p className="text-sm text-gray-500">{S.activities.bulkSpeechNone}</p>;
  return (
    <section className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {S.activities.bulkSpeechTitle}
        <InfoPopover label={S.activities.bulkSpeechTitle}>
          <p>{S.activities.bulkSpeechHelp}</p>
        </InfoPopover>
      </h4>
      <p className="text-xs text-gray-500">
        {S.activities.bulkSpeechTally(tally.ready, tally.total)}
        {tally.pending > 0 ? ` · ${S.activities.bulkSpeechPending(tally.pending)}` : ""}
      </p>
      {tally.blocked > 0 && (
        <p className={`text-xs ${toneInk.attention}`}>
          {S.activities.bulkSpeechBlocked(tally.blocked)}
        </p>
      )}
      <ul className="space-y-1">
        {statuses.map((status) => (
          <li key={status.key}>
            <button
              type="button"
              onClick={() => onSelect(status.key)}
              className="flex w-full flex-wrap items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              <span className="min-w-0 break-all">
                <span className="font-medium">{status.key}</span>
                <span className="text-gray-500"> · {status.sceneIds.join(", ")}</span>
              </span>
              <span
                className={`shrink-0 ${status.state === "ready" ? "text-gray-500" : toneInk.attention}`}
              >
                {S.activities.speechState[status.state]}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editable && queued > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className={`text-xs ${toneInk.busy}`}>
            {S.activities.bulkSpeechQueued(queued)}
          </p>
          <Button size="sm" onClick={onCancelQueue}>
            {S.activities.bulkSpeechStop}
          </Button>
        </div>
      ) : (
        editable &&
        pending.length > 0 && (
          <Button size="sm" disabled={!canGenerate} onClick={() => setConfirming(true)}>
            {S.activities.bulkSpeechGenerate(pending.length)}
          </Button>
        )
      )}
      {confirming && (
        <ConfirmModal
          open
          tone="primary"
          title={S.activities.bulkSpeechTitle}
          confirmLabel={S.activities.bulkSpeechGenerate(pending.length)}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onGenerateAll(pending);
          }}
        >
          <p>{S.activities.bulkSpeechConfirm(pending.length, language)}</p>
        </ConfirmModal>
      )}
    </section>
  );
}
