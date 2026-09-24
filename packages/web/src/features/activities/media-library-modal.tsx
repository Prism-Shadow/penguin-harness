/**
 * The picker over uploaded media. It browses this activity's own workspace, or the uploads
 * of the project's other activities, never the shared WAF checkout, and hands back a
 * `media/uploads/...` reference for the caller to bind. A file from another activity is
 * copied into this one first, so each activity keeps owning its files.
 */
import { useEffect, useRef, useState } from "react";
import type { LibraryFile, UploadedMedia } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { toastSuccess } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  activityEndpointParts,
  fileSizeText,
  libraryMatches,
  uploadKindFor,
} from "./media-library";
import { MediaPlayer } from "./media-player";
import { otherActivitiesFiles, selectionKey } from "./project-media";
import type { SceneAssetType } from "./scene-assets";
import { SEGMENT, SEGMENTS, SEGMENT_OFF, SEGMENT_ON } from "./segment-styles";

type Scope = "here" | "all";

/** One row the picker lists, from this activity or another. */
interface Entry {
  key: string;
  name: string;
  kind: UploadedMedia["kind"];
  byteLength: number;
  updatedAt: string;
  src: string;
  /** The activity it comes from, when that is not this one. */
  from?: LibraryFile;
  path: string;
}

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
  /** This activity's API endpoint, `/api/projects/<project>/activities/<activity>`. */
  endpoint: string;
  loading: boolean;
  onClose: () => void;
  /** The chosen reference; `copied` is set when the file was just copied from another activity. */
  onPick: (path: string, copied?: UploadedMedia) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState("");
  const [scope, setScope] = useState<Scope>("here");
  const [others, setOthers] = useState<LibraryFile[] | null>(null);
  const [othersError, setOthersError] = useState("");
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");
  const alive = useRef(true);
  const words = S.activities.projectMedia;
  const { projectBase, activityId } = activityEndpointParts(endpoint);
  const kind = uploadKindFor(type);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (scope !== "all" || others || othersError) return;
    void apiFetch<{ files: LibraryFile[] }>(`${projectBase}/media-library`)
      .then((value) => {
        if (alive.current) setOthers(value.files);
      })
      .catch((e: unknown) => {
        if (alive.current) setOthersError(apiErrorText(e));
      });
  }, [scope, others, othersError, projectBase]);

  const needle = query.trim().toLowerCase();
  const pool = otherActivitiesFiles(others ?? [], activityId, kind);
  const entries: Entry[] =
    scope === "here"
      ? libraryMatches(media, type, query).map((entry) => ({
          key: entry.path,
          name: entry.name,
          kind: entry.kind,
          byteLength: entry.byteLength,
          updatedAt: entry.updatedAt,
          src: `${endpoint}/media-upload?path=${encodeURIComponent(entry.path)}`,
          path: entry.path,
        }))
      : pool
          .filter(
            (file) =>
              !needle ||
              file.name.toLowerCase().includes(needle) ||
              file.activityTitle.toLowerCase().includes(needle),
          )
          .map((file) => ({
            key: selectionKey(file),
            name: file.name,
            kind: file.kind,
            byteLength: file.byteLength,
            updatedAt: file.updatedAt,
            src: `${projectBase}/${encodeURIComponent(file.activityId)}/media-upload?path=${encodeURIComponent(file.path)}`,
            from: file,
            path: file.path,
          }));
  // Both lists are filtered to this asset's kind, so a pick can only ever match it.
  const selected = entries.find((entry) => entry.key === chosen);
  const listLoading = scope === "here" ? loading : !others && !othersError;
  const nothing = scope === "here" ? !media.length : !!others && !pool.length;

  async function use(entry: Entry) {
    if (!entry.from) return onPick(entry.path);
    setCopying(true);
    setCopyError("");
    try {
      const stored = await apiFetch<UploadedMedia>(`${endpoint}/media-uploads/copy`, {
        method: "POST",
        body: { fromActivityId: entry.from.activityId, path: entry.from.path },
      });
      toastSuccess(words.copied(stored.name));
      onPick(stored.path, stored);
    } catch (e) {
      if (alive.current) setCopyError(apiErrorText(e));
    } finally {
      if (alive.current) setCopying(false);
    }
  }

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
            disabled={!selected || copying}
            onClick={() => {
              if (selected) void use(selected);
            }}
          >
            {copying ? words.copying : S.activities.libraryUse}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          {scope === "here" ? S.activities.libraryHint : words.copyHint}
        </p>
        <div role="group" aria-label={words.scope.label} className={SEGMENTS}>
          {(["here", "all"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === scope}
              onClick={() => {
                setScope(option);
                setChosen("");
                setCopyError("");
              }}
              className={`${SEGMENT} ${option === scope ? SEGMENT_ON : SEGMENT_OFF}`}
            >
              {words.scope[option]}
            </button>
          ))}
        </div>
        <Input
          size="sm"
          label={S.activities.librarySearch}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {copyError && (
          <p role="alert" className={`break-words text-xs ${toneInk.danger}`}>
            {copyError}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="max-h-72 space-y-1 overflow-auto" aria-label={S.activities.libraryTitle}>
            {scope === "all" && othersError ? (
              <p role="alert" className={`text-xs ${toneInk.danger}`}>
                {othersError}
              </p>
            ) : listLoading ? (
              <p role="status" className="text-xs text-gray-500">
                {S.activities.libraryLoading}
              </p>
            ) : nothing ? (
              <p className="text-xs text-gray-500">
                {scope === "here" ? S.activities.libraryEmpty : words.otherEmpty}
              </p>
            ) : !entries.length ? (
              <p className="text-xs text-gray-500">{S.activities.libraryNoMatches}</p>
            ) : (
              entries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  aria-pressed={entry.key === chosen}
                  onClick={() => setChosen(entry.key)}
                  className={`flex w-full items-baseline justify-between gap-3 rounded-md border p-2 text-left text-xs ${
                    entry.key === chosen
                      ? "border-gray-400 bg-gray-100 dark:border-gray-600 dark:bg-gray-800"
                      : "border-gray-200 dark:border-gray-800"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block break-all">{entry.name}</span>
                    {entry.from && (
                      <span className="block truncate text-gray-500">
                        {entry.from.productCode} / {entry.from.refNum} · {entry.from.activityTitle}
                      </span>
                    )}
                  </span>
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
                <MediaPlayer kind={selected.kind} src={selected.src} label={selected.name} />
                <dl className="space-y-0.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{S.activities.libraryFile}</dt>
                    <dd className="min-w-0 break-all">{selected.name}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{S.activities.librarySize}</dt>
                    <dd>{fileSizeText(selected.byteLength)}</dd>
                  </div>
                  {selected.from && (
                    <div className="flex gap-2">
                      <dt className="text-gray-500">{words.columns.activity}</dt>
                      <dd className="min-w-0 break-words">
                        {selected.from.productCode} / {selected.from.refNum} ·{" "}
                        {selected.from.activityTitle}
                      </dd>
                    </div>
                  )}
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
