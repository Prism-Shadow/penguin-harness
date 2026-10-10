/**
 * The Evaluation Center's import dialog — the Skills and Hooks tabs' import, in a Benchmark's
 * words. Two paths, recommended first:
 *
 * - The source field takes a folder link in a repository such as
 *   Prism-Shadow/penguin-harness-benchmark, a local path or a description. It becomes a prompt
 *   (benchmark-import-prompt.ts, previewed read-only) that can be copied, or opened as a new chat's
 *   draft with the Project's default Agent; nothing is sent until the user sends it, and the server
 *   never fetches the link — the Agent does, at a commit it pins.
 * - A zip of a package — what a Benchmark page's Export downloads — is uploaded for the server to
 *   check and write (`POST …/benchmarks/archive`). An id that is taken answers 409, and the
 *   overwrite confirm says what an overwrite costs: the Benchmark's files, its evaluation records
 *   and its run results.
 *
 * Any member of the Project may take either path: a Benchmark belongs to the Project.
 */
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { AgentSummary, BenchmarkSummary } from "@prismshadow/penguin-server/api";
import {
  Button,
  ConfirmModal,
  CopiedStatus,
  CopyCheckGlyph,
  HiddenFileInput,
  Modal,
  Textarea,
  buttonClass,
  toastSuccess,
  useCopied,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { agentDisplayName } from "../../state/project";
import { pickDefaultAgent, useAiBridge } from "../ai-create";
import { benchmarkImportChat, buildBenchmarkImportPrompt } from "./benchmark-import-prompt";

/** What one upload came to: written, refused for a taken id (the confirm's question), or refused with a reason to show. */
export type ArchiveUploadResult =
  | { kind: "imported"; benchmark: BenchmarkSummary }
  | { kind: "exists"; benchmarkId: string }
  | { kind: "refused"; message: string };

/**
 * Posts one zip to the import route. A 409 `benchmark_exists` is the question the overwrite
 * confirm asks, about the id its `details.benchmarkId` names (`fallbackId`, the picked file's
 * stem, covers an answer without it); anything else refused is a reason to show.
 */
export async function uploadBenchmarkArchive(
  projectId: string,
  dataBase64: string,
  options: { overwrite: boolean; fallbackId: string },
): Promise<ArchiveUploadResult> {
  try {
    const { benchmark } = await api.importBenchmarkArchive(projectId, {
      dataBase64,
      ...(options.overwrite ? { overwrite: true } : {}),
    });
    return { kind: "imported", benchmark };
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === "benchmark_exists") {
      return { kind: "exists", benchmarkId: e.details?.benchmarkId ?? options.fallbackId };
    }
    return { kind: "refused", message: apiErrorText(e) };
  }
}

/** A zip waiting on the overwrite confirm: the payload to resend with `overwrite`, and the id it would replace. */
interface PendingOverwrite {
  dataBase64: string;
  benchmarkId: string;
}

/** The upload's `<label>`, in the Button look of the Skills tab's. */
const UPLOAD_LABEL_CLASS = buttonClass("secondary", "sm");

export function ImportBenchmarkModal({
  projectId,
  agents,
  onClose,
  onImported,
}: {
  projectId: string;
  agents: readonly AgentSummary[];
  onClose: () => void;
  /** A zip was written: the Benchmark as the list now reads it. The dialog has toasted it already. */
  onImported: (benchmark: BenchmarkSummary) => void;
}) {
  const { openAiChat } = useAiBridge();
  const [source, setSource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // A refusal lands under the upload button, at the foot of a dialog whose body may scroll — an
  // overwrite refused while the Benchmark is being evaluated among them: bring it into view.
  const uploadErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (uploadError !== null) uploadErrorRef.current?.scrollIntoView({ block: "nearest" });
  }, [uploadError]);
  // Non-null shows the overwrite confirm (the upload answered 409 benchmark_exists).
  const [overwriting, setOverwriting] = useState<PendingOverwrite | null>(null);
  // Copy feedback lives at the button: its glyph flips to the check while copied.
  const promptCopy = useCopied();

  const trimmedSource = source.trim();
  // The preview stands a placeholder in for the source until one is entered.
  const chatPrompt = buildBenchmarkImportPrompt(
    trimmedSource || S.benchmark.importSourceToken,
    projectId,
  );
  const executor = pickDefaultAgent(agents);
  const chat = benchmarkImportChat(trimmedSource, projectId, agents);

  const openChat = () => {
    if (chat === null) return;
    openAiChat(chat);
    onClose();
  };

  const upload = async (dataBase64: string, fallbackId: string, overwrite: boolean) => {
    setUploading(true);
    setUploadError(null);
    const result = await uploadBenchmarkArchive(projectId, dataBase64, { overwrite, fallbackId });
    setUploading(false);
    if (result.kind === "imported") {
      setOverwriting(null);
      toastSuccess(S.benchmark.importDoneToast);
      onImported(result.benchmark);
    } else if (result.kind === "exists") {
      setOverwriting({ dataBase64, benchmarkId: result.benchmarkId });
    } else {
      setOverwriting(null);
      setUploadError(result.message);
    }
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    const fallbackId = file.name.replace(/\.zip$/i, "").replace(/-v\d{4}\.\d{2}\.\d{2}\.\d+$/, "");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the data:…;base64, prefix.
      void upload(dataUrl.slice(dataUrl.indexOf(",") + 1), fallbackId, false);
    };
    reader.onerror = () => setUploadError(S.common.unknownError);
    reader.readAsDataURL(file);
  };

  return (
    <>
      {/* Recommended chat import on top, zip upload below (the Skills tab's shape). */}
      <Modal open title={S.benchmark.importBenchmark} onClose={onClose} widthClass="sm:max-w-lg">
        <div className="space-y-4">
          <section>
            <p className="text-sm font-medium">{S.benchmark.importChatTitle}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{S.benchmark.importChatWhy}</p>
            <div className="mt-2.5 space-y-3">
              {/* A description may run to several lines, so the field is multi-line. */}
              <Textarea
                label={S.benchmark.importSourceLabel}
                hint={S.benchmark.importSourceHint}
                size="sm"
                rows={3}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder={S.benchmark.importSourcePlaceholder}
              />
              <Textarea
                label={S.benchmark.importPromptLabel}
                size="sm"
                rows={5}
                readOnly
                value={chatPrompt}
                className="text-fg-muted"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={trimmedSource === ""}
                  onClick={() => promptCopy.flash(chatPrompt)}
                >
                  <CopyCheckGlyph copied={promptCopy.copied} size={12} />
                  {S.benchmark.importCopyPrompt}
                </Button>
                <CopiedStatus copied={promptCopy.copied} />
                <Button size="sm" variant="primary" disabled={chat === null} onClick={openChat}>
                  {S.benchmark.importOpenChat}
                </Button>
                {/* Who the draft goes to: the Project's default Agent, not the one in view. */}
                {executor !== null ? (
                  <span className="text-xs text-fg-muted">
                    {S.aiCreate.byAgent(agentDisplayName(executor))}
                  </span>
                ) : (
                  <span className={`text-xs ${toneInk.attention}`}>{S.aiCreate.noAgent}</span>
                )}
              </div>
            </div>
          </section>

          <section className="border-t border-line pt-4">
            <p className="text-sm font-medium">{S.benchmark.importUploadTitle}</p>
            <p className="mt-0.5 text-xs text-fg-muted">{S.benchmark.importUploadDesc}</p>
            <label
              className={`${UPLOAD_LABEL_CLASS} mt-2.5 ${uploading ? "pointer-events-none opacity-60" : ""}`}
            >
              <HiddenFileInput accept=".zip" disabled={uploading} onChange={onPickFile} />
              {uploading ? S.benchmark.importUploading : S.benchmark.importUploadAction}
            </label>
            {uploadError !== null && (
              <p ref={uploadErrorRef} className={`mt-1.5 text-xs ${toneInk.danger}`}>
                {uploadError}
              </p>
            )}
          </section>
        </div>
      </Modal>

      {/* The import dialog stays underneath, so cancelling returns to it; confirming resends the same zip with overwrite. */}
      <ConfirmModal
        open={overwriting !== null}
        title={S.benchmark.importOverwriteTitle}
        confirmLabel={S.benchmark.importOverwriteAction}
        cancelLabel={S.common.cancel}
        busy={uploading}
        onClose={() => setOverwriting(null)}
        onConfirm={() => {
          if (overwriting !== null) {
            void upload(overwriting.dataBase64, overwriting.benchmarkId, true);
          }
        }}
      >
        <p className="text-sm text-fg-muted">
          {overwriting !== null ? S.benchmark.importOverwriteBody(overwriting.benchmarkId) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
