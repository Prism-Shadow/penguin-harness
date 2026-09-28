/**
 * The Asset Library: every asset the media plan asks for, and every file uploaded for the
 * activity, in one place. It answers the questions the scene tree cannot at a glance: what
 * is still unbound across all scenes, which uploads nothing uses, and which assets share a
 * file. An asset opens in the editor from here.
 */
import { useState } from "react";
import type { AssetManifest, UploadedMedia } from "@prismshadow/penguin-server/api";
import { Badge, type BadgeTone } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { S } from "../../lib/strings";
import {
  filterPlanned,
  filterUploads,
  plannedEntries,
  uploadEntries,
  type LibraryBinding,
  type LibraryKind,
  type PlannedEntry,
} from "./asset-library";
import { fileSizeText } from "./media-library";
import { SEGMENT, SEGMENTS, SEGMENT_OFF, SEGMENT_ON } from "./segment-styles";

type MediaAsset = AssetManifest["assets"][string][number];

const KINDS: readonly LibraryKind[] = ["all", "audio", "image", "video", "animation"];
const BINDINGS: readonly LibraryBinding[] = ["any", "unbound", "bound"];
const SOURCE_TONE: Record<NonNullable<PlannedEntry["source"]>, BadgeTone> = {
  generated: "brand",
  upload: "gray",
  checkout: "gray",
};

const HEAD =
  "border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-400";
const TH = "whitespace-nowrap px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";
const LINK = "text-left font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300";

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  text,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  text: (value: T) => string;
}) {
  return (
    <div role="group" aria-label={label} className={SEGMENTS}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={`${SEGMENT} ${option === value ? SEGMENT_ON : SEGMENT_OFF}`}
        >
          {text(option)}
        </button>
      ))}
    </div>
  );
}

export function AssetLibraryView({
  assets,
  uploads,
  uploadsLoading,
  endpoint,
  onOpen,
}: {
  /** The open language's group of the media plan; empty before media is planned. */
  assets: readonly MediaAsset[];
  uploads: readonly UploadedMedia[];
  uploadsLoading: boolean;
  endpoint: string;
  onOpen: (key: string) => void;
}) {
  const words = S.activities.assetLibrary;
  const [kind, setKind] = useState<LibraryKind>("all");
  const [binding, setBinding] = useState<LibraryBinding>("any");
  const [query, setQuery] = useState("");
  const planned = plannedEntries(assets);
  const files = uploadEntries(uploads, assets);
  const shownPlanned = filterPlanned(planned, kind, binding, query);
  const shownFiles = filterUploads(files, kind, binding, query);
  const uploadUrl = (path: string) => `${endpoint}/media-upload?path=${encodeURIComponent(path)}`;

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">{S.activities.libraryTitle}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Chips
          label={words.kind}
          options={KINDS}
          value={kind}
          onChange={setKind}
          text={(value) => S.activities.mediaTypes[value]}
        />
        <Chips
          label={words.binding}
          options={BINDINGS}
          value={binding}
          onChange={setBinding}
          text={(value) => words.bindings[value]}
        />
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
      </div>

      <section aria-label={words.planned} className="space-y-2">
        <h4 className="text-xs font-semibold">
          {words.planned}{" "}
          <span className="font-normal text-gray-500">
            {words.count(shownPlanned.length, planned.length)}
          </span>
        </h4>
        {!planned.length ? (
          <p className="text-xs text-gray-500">{words.noPlan}</p>
        ) : !shownPlanned.length ? (
          <p className="text-xs text-gray-500">{words.noMatch}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>{words.columns.asset}</th>
                  <th className={TH}>{words.columns.type}</th>
                  <th className={TH}>{words.columns.binding}</th>
                  <th className={TH}>{words.columns.scenes}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {shownPlanned.map((entry) => (
                  <tr key={entry.key}>
                    <td className={TD}>
                      <button type="button" className={LINK} onClick={() => onOpen(entry.key)}>
                        {entry.key}
                      </button>
                      <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                        {entry.description}
                      </p>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>
                      {S.activities.mediaTypes[entry.type]}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {entry.source ? (
                        <Badge tone={SOURCE_TONE[entry.source]}>
                          {words.sources[entry.source]}
                        </Badge>
                      ) : (
                        <Badge tone="amber">{words.unbound}</Badge>
                      )}
                    </td>
                    <td className={`${TD} text-xs text-gray-500 dark:text-gray-400`}>
                      {entry.sceneIds.join(", ") || S.activities.noSceneUsage}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label={words.uploaded} className="space-y-2">
        <h4 className="text-xs font-semibold">
          {words.uploaded}{" "}
          <span className="font-normal text-gray-500">
            {words.count(shownFiles.length, files.length)}
          </span>
        </h4>
        {uploadsLoading ? (
          <p role="status" className="text-xs text-gray-500">
            {S.activities.libraryLoading}
          </p>
        ) : !files.length ? (
          <p className="text-xs text-gray-500">{S.activities.librarySectionEmpty}</p>
        ) : !shownFiles.length ? (
          <p className="text-xs text-gray-500">{words.noMatch}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>{words.columns.file}</th>
                  <th className={TH}>{words.columns.type}</th>
                  <th className={TH}>{words.columns.size}</th>
                  <th className={TH}>{words.columns.usedBy}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                {shownFiles.map(({ upload, usedBy }) => (
                  <tr key={upload.path}>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        {upload.kind === "image" && (
                          <img
                            src={uploadUrl(upload.path)}
                            alt=""
                            loading="lazy"
                            className="h-8 w-8 shrink-0 rounded border border-gray-200 object-cover dark:border-gray-800"
                          />
                        )}
                        <span className="min-w-0 break-all text-xs">{upload.name}</span>
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs`}>
                      {S.activities.mediaTypes[upload.kind]}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-xs tabular-nums`}>
                      {fileSizeText(upload.byteLength)}
                    </td>
                    <td className={`${TD} text-xs`}>
                      {usedBy.length ? (
                        <span className="flex flex-wrap gap-x-2">
                          {usedBy.map((key) => (
                            <button
                              key={key}
                              type="button"
                              className={LINK}
                              onClick={() => onOpen(key)}
                            >
                              {key}
                            </button>
                          ))}
                        </span>
                      ) : (
                        <span className="text-gray-500">{words.unused}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
