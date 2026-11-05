/**
 * A file cited in an organization's messages, read-only: a title row (the label or name, the full
 * path on hover, copy the path, download, and close where the host has no close of its own) over
 * the Files panel's preview pane. Markdown reads in the reader, its outline and find in the title
 * row as the Files panel has them, text as highlighted source, an image and a PDF from their URL.
 *
 * The file comes from the organization's cited-file route, which serves only the organization's
 * handbook and workspaces; its refusal and a missing file each read as their own sentence rather
 * than a status code. Every kind is fetched once first, so an image the server refused says so
 * instead of drawing as a broken picture.
 */
import { useEffect, useState } from "react";
import {
  CloseButton,
  CopyButton,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  PreviewPane,
  ReaderFindBar,
  ReaderTools,
  languageForFileName,
  useMarkdownReader,
} from "@prismshadow/penguin-ui";
import type { PreviewView } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { previewKindOf } from "../../lib/workspace-tree";
import { useReaderFind } from "../../lib/reader-find";
import { pathLabel } from "./path-capsules";

/** One cited file: the path as written, and the label the writer gave it. */
export interface CitedFile {
  path: string;
  label?: string;
}

type Loaded =
  | { state: "loading" }
  | { state: "text"; content: string }
  | { state: "url" }
  | { state: "error"; message: string };

function refusalText(status: number): string {
  if (status === 403) return S.company.citedFile.refused;
  if (status === 404) return S.company.citedFile.notFound;
  return S.company.citedFile.failed(String(status));
}

export function CitedFilePreview({
  projectId,
  orgId,
  file,
  onClose,
}: {
  projectId: string;
  orgId: string;
  file: CitedFile;
  /** Drawn as the title row's close; a host with a close of its own (a dock tab) leaves it out. */
  onClose?: () => void;
}) {
  const name = pathLabel(file.path);
  const kind = previewKindOf(name);
  const url = api.orgCitedFileUrl(projectId, orgId, file.path);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const reader = useMarkdownReader(useReaderFind());

  useEffect(() => {
    let live = true;
    setLoaded({ state: "loading" });
    void (async () => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (!res.ok || (kind !== "text" && kind !== "md")) {
          await res.body?.cancel();
          if (live)
            setLoaded(
              res.ok ? { state: "url" } : { state: "error", message: refusalText(res.status) },
            );
          return;
        }
        const content = await res.text();
        if (live) setLoaded({ state: "text", content });
      } catch (err) {
        if (live)
          setLoaded({ state: "error", message: S.company.citedFile.failed(apiErrorText(err)) });
      }
    })();
    return () => {
      live = false;
    };
  }, [url, kind]);

  const view: PreviewView =
    loaded.state === "loading"
      ? { kind: "opening" }
      : loaded.state === "error"
        ? { kind: "error", message: loaded.message }
        : kind === "image"
          ? { kind: "image", src: url, alt: name }
          : kind === "pdf"
            ? { kind: "pdf", src: url, title: name }
            : kind === "unsupported" || loaded.state !== "text"
              ? { kind: "unsupported", message: S.company.citedFile.unsupported }
              : kind === "md"
                ? { kind: "markdown", text: loaded.content, docKey: file.path }
                : {
                    kind: "source",
                    code: loaded.content,
                    language: languageForFileName(name),
                    wrap: true,
                  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <GlyphIcon
          d={ICONS.file}
          size={ICON_SIZE.inlineGlyph}
          className="shrink-0 text-fg-subtle"
        />
        {reader.findShown ? (
          <ReaderFindBar reader={reader} className="flex-1" />
        ) : (
          <p
            className="min-w-0 flex-1 truncate text-sm font-medium text-fg"
            data-tooltip={file.path}
            data-tooltip-extra
          >
            {file.label ?? name}
          </p>
        )}
        <ReaderTools reader={reader} />
        <CopyButton text={file.path} label={S.company.citedFile.copyPath} className="shrink-0" />
        <a
          href={api.orgCitedFileUrl(projectId, orgId, file.path, true)}
          download
          aria-label={S.company.citedFile.download}
          data-tooltip={S.company.citedFile.download}
          className="shrink-0 rounded-sm p-1 text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg-muted"
        >
          <GlyphIcon d={ICONS.download} size={ICON_SIZE.inlineGlyph} />
        </a>
        {onClose !== undefined && (
          <CloseButton onClose={onClose} label={S.company.citedFile.close} className="shrink-0" />
        )}
      </div>
      <PreviewPane view={view} reader={reader} className="min-h-0 flex-1" />
    </div>
  );
}
