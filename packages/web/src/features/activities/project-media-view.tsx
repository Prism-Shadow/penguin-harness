/**
 * The project media library: every file uploaded to any activity of the project, as a grid
 * of thumbnails or a table, narrowed by type, product and a search. Several files download
 * together as one zip; one file downloads as itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { LibraryFile, ProjectMediaListing } from "@prismshadow/penguin-server/api";
import { ApiError, apiFetch } from "../../api/client";
import { Button, labelButtonClass } from "../../components/ui/button";
import { ChipGroup } from "../../components/ui/chip-group";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { InfoPopover } from "../../components/ui/info-popover";
import { Input } from "../../components/ui/input";
import { Segmented } from "../../components/ui/segmented";
import { Select } from "../../components/ui/select";
import { toastError } from "../../components/ui/toast";
import { apiErrorText } from "../../lib/api-error";
import { ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { downloadBundle } from "./download-bundle";
import { fileSizeText } from "./media-library";
import { MediaPlayer } from "./media-player";
import {
  BUNDLE_LIMIT,
  LIBRARY_KINDS,
  LIBRARY_SORTS,
  bundleItems,
  filterLibrary,
  productCodes,
  selectAll,
  selectedFiles,
  selectionKey,
  sortLibrary,
  toggleOne,
  type LibraryKindFilter,
  type LibrarySort,
  type LibraryView,
} from "./project-media";
import { SCENE_ASSET_ICON } from "./scene-asset-icons";

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";
const LINK = "text-left font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300";

const basePath = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/activities`;

/** Where one file's bytes are served: its own activity's upload route. */
function fileUrl(projectId: string, file: LibraryFile): string {
  return `${basePath(projectId)}/${encodeURIComponent(file.activityId)}/media-upload?path=${encodeURIComponent(file.path)}`;
}

const activityText = (file: LibraryFile) =>
  `${file.productCode} / ${file.refNum} · ${file.activityTitle}`;

export function ProjectMediaView({
  projectId,
  available,
}: {
  projectId: string;
  available: boolean;
}) {
  const words = S.activities.projectMedia;
  const [listing, setListing] = useState<ProjectMediaListing | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<LibraryKindFilter>("all");
  const [product, setProduct] = useState("");
  const [sort, setSort] = useState<LibrarySort>("name");
  const [view, setView] = useState<LibraryView>("grid");
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [focused, setFocused] = useState("");
  const [downloading, setDownloading] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!available) return;
    void apiFetch<ProjectMediaListing>(`${basePath(projectId)}/media-library`)
      .then((value) => {
        if (alive.current) setListing(value);
      })
      .catch((e: unknown) => {
        if (alive.current) setError(apiErrorText(e));
      });
  }, [projectId, available]);

  const files = useMemo(() => listing?.files ?? [], [listing]);
  const products = useMemo(() => productCodes(files), [files]);
  const shown = useMemo(
    () => sortLibrary(filterLibrary(files, { kind, productCode: product, query }), sort),
    [files, kind, product, query, sort],
  );
  // Chosen files stay chosen while a filter hides them, and download with the rest.
  const chosen = useMemo(
    () => selectedFiles(sortLibrary(files, sort), selection),
    [files, sort, selection],
  );
  const detail = files.find((file) => selectionKey(file) === focused);
  const overLimit = chosen.length > BUNDLE_LIMIT;

  const download = useCallback(async () => {
    setDownloading(true);
    try {
      await downloadBundle(
        `${basePath(projectId)}/media-library/bundle`,
        { items: bundleItems(chosen) },
        "media-library-selection.zip",
      );
    } catch (e) {
      toastError(
        e instanceof ApiError && e.code === "bundle_too_large" ? words.tooLarge : apiErrorText(e),
      );
    } finally {
      if (alive.current) setDownloading(false);
    }
  }, [projectId, chosen, words]);

  const checkbox = (file: LibraryFile) => (
    <input
      type="checkbox"
      aria-label={words.selectFile(file.name)}
      checked={selection.has(selectionKey(file))}
      onChange={() => setSelection((current) => toggleOne(current, file))}
      className="h-4 w-4 accent-brand-600"
    />
  );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-1.5 text-lg font-semibold">
            {words.title}
            <InfoPopover label={words.title}>{words.about}</InfoPopover>
          </h1>
          <Link to="/activities" className={labelButtonClass("secondary", "sm")}>
            {words.back}
          </Link>
        </header>
        {!available && (
          <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {S.activities.unavailable}
          </p>
        )}
        {error && (
          <p role="alert" className={`text-sm ${toneInk.danger}`}>
            {error}
          </p>
        )}
        {listing?.truncated && (
          <p role="status" className={`rounded-md border p-3 text-xs ${toneStrip.attention}`}>
            {words.truncated(files.length)}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Input
              size="sm"
              type="search"
              aria-label={words.search}
              placeholder={words.search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <ChipGroup
            label={words.kind}
            value={kind}
            onChange={setKind}
            options={LIBRARY_KINDS.map((option) => ({ value: option, label: words.kinds[option] }))}
          />
          <div className="w-44">
            <Select
              size="sm"
              aria-label={words.product}
              value={product}
              onChange={(event) => setProduct(event.target.value)}
            >
              <option value="">{words.anyProduct}</option>
              {products.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <Select
              size="sm"
              aria-label={words.sort}
              value={sort}
              onChange={(event) => setSort(event.target.value as LibrarySort)}
            >
              {LIBRARY_SORTS.map((option) => (
                <option key={option} value={option}>
                  {words.sorts[option]}
                </option>
              ))}
            </Select>
          </div>
          <div role="group" aria-label={words.view} className="w-36">
            <Segmented
              cols={2}
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: words.views.grid },
                { value: "table", label: words.views.table },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!shown.length}
            onClick={() => setSelection((current) => selectAll(current, shown))}
          >
            {words.selectAll}
          </Button>
          <Button size="sm" disabled={!selection.size} onClick={() => setSelection(new Set())}>
            {words.clear}
          </Button>
          <span className="text-xs text-gray-500" aria-live="polite">
            {words.selectedCount(chosen.length)}
          </span>
          {chosen.length === 1 ? (
            <a
              href={fileUrl(projectId, chosen[0]!)}
              download={chosen[0]!.name}
              className={labelButtonClass("primary", "sm")}
            >
              {words.download(1)}
            </a>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={!chosen.length || overLimit || downloading || !available}
              onClick={() => void download()}
            >
              {downloading ? words.downloading : words.download(chosen.length)}
            </Button>
          )}
          {overLimit && (
            <span className={`text-xs ${toneInk.attention}`}>
              {words.downloadLimit(BUNDLE_LIMIT)}
            </span>
          )}
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section aria-label={words.files} className="min-w-0">
            {!listing && !error ? (
              <p role="status" className="text-xs text-gray-500">
                {words.loading}
              </p>
            ) : !files.length ? (
              <EmptyState title={words.empty} />
            ) : !shown.length ? (
              <p className="text-sm text-gray-500">{words.noMatches}</p>
            ) : view === "grid" ? (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {shown.map((file) => {
                  const key = selectionKey(file);
                  return (
                    <li
                      key={key}
                      className={`relative flex flex-col overflow-hidden rounded-lg border ${
                        key === focused
                          ? "border-gray-400 dark:border-gray-500"
                          : "border-gray-200 dark:border-gray-800"
                      }`}
                    >
                      <span className="absolute left-2 top-2 rounded bg-white/90 p-0.5 dark:bg-gray-900/90">
                        {checkbox(file)}
                      </span>
                      <button
                        type="button"
                        aria-pressed={key === focused}
                        onClick={() => setFocused(key)}
                        className="flex flex-1 flex-col text-left"
                      >
                        <span className="flex aspect-square w-full items-center justify-center bg-gray-50 text-gray-400 dark:bg-gray-900">
                          {file.kind === "image" ? (
                            <img
                              src={fileUrl(projectId, file)}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <GlyphIcon
                              d={SCENE_ASSET_ICON[file.kind]}
                              size={ICON_SIZE.sectionMark}
                            />
                          )}
                        </span>
                        <span className="space-y-0.5 p-2">
                          <span className="block truncate text-xs font-medium">{file.name}</span>
                          <span className="block truncate text-xs text-gray-500">
                            {S.activities.mediaTypes[file.kind]} · {fileSizeText(file.byteLength)}
                          </span>
                          <span className="block truncate text-xs text-gray-500">
                            {file.productCode} / {file.refNum}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={HEAD}>
                      <th className={TH}>{words.columns.select}</th>
                      <th className={TH}>{words.columns.name}</th>
                      <th className={TH}>{words.columns.type}</th>
                      <th className={TH}>{words.columns.size}</th>
                      <th className={TH}>{words.columns.activity}</th>
                      <th className={TH}>{words.columns.updated}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                    {shown.map((file) => (
                      <tr key={selectionKey(file)}>
                        <td className={TD}>{checkbox(file)}</td>
                        <td className={`${TD} break-all`}>
                          <button
                            type="button"
                            aria-pressed={selectionKey(file) === focused}
                            className={LINK}
                            onClick={() => setFocused(selectionKey(file))}
                          >
                            {file.name}
                          </button>
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {S.activities.mediaTypes[file.kind]}
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {fileSizeText(file.byteLength)}
                        </td>
                        <td className={TD}>
                          <Link
                            to={`/activities/${encodeURIComponent(file.activityId)}`}
                            className={LINK}
                          >
                            {activityText(file)}
                          </Link>
                        </td>
                        <td className={`${TD} whitespace-nowrap text-gray-500`}>
                          {new Date(file.updatedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section aria-label={words.details} className="space-y-2">
            <h2 className="text-sm font-semibold">{words.details}</h2>
            {!detail ? (
              <p className="text-xs text-gray-500">{words.detailsEmpty}</p>
            ) : (
              <>
                {detail.kind === "image" ? (
                  <ZoomableImage
                    key={selectionKey(detail)}
                    src={fileUrl(projectId, detail)}
                    alt={detail.name}
                    className="max-h-72 max-w-full rounded border border-gray-200 bg-gray-50 object-contain dark:border-gray-800 dark:bg-gray-900"
                  />
                ) : (
                  <MediaPlayer
                    kind={detail.kind}
                    src={fileUrl(projectId, detail)}
                    label={detail.name}
                  />
                )}
                <dl className="space-y-0.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{words.columns.name}</dt>
                    <dd className="min-w-0 break-all">{detail.name}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{words.columns.type}</dt>
                    <dd>
                      {S.activities.mediaTypes[detail.kind]} · {detail.mimeType}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{words.columns.size}</dt>
                    <dd>{fileSizeText(detail.byteLength)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{words.columns.activity}</dt>
                    <dd className="min-w-0 break-words">{activityText(detail)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-gray-500">{words.columns.updated}</dt>
                    <dd>{new Date(detail.updatedAt).toLocaleString()}</dd>
                  </div>
                </dl>
                <Link
                  to={`/activities/${encodeURIComponent(detail.activityId)}`}
                  className={labelButtonClass("secondary", "sm")}
                >
                  {words.openActivity}
                </Link>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
