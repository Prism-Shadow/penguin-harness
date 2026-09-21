/**
 * The picker over media uploaded for this activity. It browses the activity's own
 * workspace, never the shared WAF checkout, and hands back a `media/uploads/...`
 * reference for the caller to bind.
 */
import { useState } from "react";
import type { UploadedMedia } from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { S } from "../../lib/strings";
import { fileSizeText, libraryMatches } from "./media-library";
import { MediaPlayer } from "./media-player";
import type { SceneAssetType } from "./scene-assets";

export function MediaLibraryModal({
  media,
  type,
  endpoint,
  loading,
  onClose,
  onPick,
}: {
  media: readonly UploadedMedia[];
  type: SceneAssetType;
  endpoint: string;
  loading: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState("");
  const matches = libraryMatches(media, type, query);
  // `libraryMatches` filters to this asset's kind, so a pick can only ever match it.
  const selected = matches.find((entry) => entry.path === chosen);
  return (
    <Modal
      open
      title={S.activities.libraryTitle}
      onClose={onClose}
      widthClass="max-w-3xl"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!selected}
            onClick={() => {
              if (selected) onPick(selected.path);
            }}
          >
            {S.activities.libraryUse}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500">{S.activities.libraryHint}</p>
        <Input
          size="sm"
          label={S.activities.librarySearch}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="max-h-72 space-y-1 overflow-auto" aria-label={S.activities.libraryTitle}>
            {loading ? (
              <p role="status" className="text-xs text-gray-500">
                {S.activities.libraryLoading}
              </p>
            ) : !media.length ? (
              <p className="text-xs text-gray-500">{S.activities.libraryEmpty}</p>
            ) : !matches.length ? (
              <p className="text-xs text-gray-500">{S.activities.libraryNoMatches}</p>
            ) : (
              matches.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  aria-pressed={entry.path === chosen}
                  onClick={() => setChosen(entry.path)}
                  className={`flex w-full items-baseline justify-between gap-3 rounded-md border p-2 text-left text-xs ${
                    entry.path === chosen
                      ? "border-gray-400 bg-gray-100 dark:border-gray-600 dark:bg-gray-800"
                      : "border-gray-200 dark:border-gray-800"
                  }`}
                >
                  <span className="min-w-0 break-all">{entry.name}</span>
                  <span className="shrink-0 text-gray-500">{fileSizeText(entry.byteLength)}</span>
                </button>
              ))
            )}
          </div>
          <section className="space-y-2" aria-label={S.activities.librarySelected}>
            <p className="text-xs font-medium">{S.activities.librarySelected}</p>
            {!selected ? (
              <p className="text-xs text-gray-500">{S.activities.libraryChoosePrompt}</p>
            ) : (
              <>
                <MediaPlayer
                  kind={selected.kind}
                  src={`${endpoint}/media-upload?path=${encodeURIComponent(selected.path)}`}
                  label={selected.name}
                />
                <dl className="space-y-0.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{S.activities.libraryFile}</dt>
                    <dd className="min-w-0 break-all">{selected.name}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{S.activities.librarySize}</dt>
                    <dd>{fileSizeText(selected.byteLength)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{S.activities.libraryUploadedAt}</dt>
                    <dd>{new Date(selected.updatedAt).toLocaleString()}</dd>
                  </div>
                </dl>
              </>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
}
