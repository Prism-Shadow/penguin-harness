/**
 * Models → Built-in: agents Penguin downloads, runs and updates itself. One card for GitHub
 * Copilot: paste a PAT, Set up, and it becomes a coding agent like the Local CLI ones. Polls
 * while a download runs. Admin-only, like the routes it calls.
 */
import { useCallback, useEffect, useState } from "react";
import type { BuiltinAgentInfo, CodingAgentTestResult } from "@prismshadow/penguin-server/api";
import {
  cancelBuiltinCopilot,
  listBuiltinAgents,
  removeBuiltinCopilot,
  replaceBuiltinCopilotToken,
  setupBuiltinCopilot,
  testCodingAgent,
} from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Modal } from "../../components/ui/modal";
import { PasswordInput } from "../../components/ui/password-input";
import { ProviderLogo } from "../../components/ui/provider-logo";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError } from "../../components/ui/toast";
import { codingAgentLogo } from "../chat/coding-agent-models";
import { builtinActions, builtinSubtitle, progressPercent } from "./builtin-model";

const PAT_URL = "https://github.com/settings/personal-access-tokens/new";
const LICENSE_URL = "https://github.com/github/copilot-cli/blob/main/LICENSE.md";
const APPROX_MB = 150;

export function BuiltinPanel() {
  const [agents, setAgents] = useState<BuiltinAgentInfo[] | null>(null);
  const load = useCallback(() => {
    void listBuiltinAgents()
      .then((res) => setAgents(res.agents))
      .catch((e: unknown) => toastError(apiErrorText(e)));
  }, []);
  useEffect(load, [load]);
  const downloading = agents?.some((a) => a.status === "downloading") === true;
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, [downloading, load]);

  return (
    <section aria-label={S.models.viewBuiltin}>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{S.models.builtinIntro}</p>
      {agents === null ? (
        <SkeletonList rows={1} />
      ) : (
        <ul className="space-y-2">
          {agents.map((agent) => (
            <CopilotCard key={agent.id} info={agent} onChanged={load} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CopilotCard({ info, onChanged }: { info: BuiltinAgentInfo; onChanged: () => void }) {
  const actions = builtinActions(info);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [tested, setTested] = useState<CodingAgentTestResult | null>(null);
  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    work()
      .then(onChanged)
      .catch((e: unknown) => toastError(apiErrorText(e)))
      .finally(() => setBusy(false));
  };
  const percent = progressPercent(info);
  const subtitle = builtinSubtitle(info);

  return (
    <li className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderLogo
          provider={codingAgentLogo(info.agentId, info.title)}
          className="h-8 w-8 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {info.title}
          </div>
          <div className="truncate text-xs text-gray-500 dark:text-gray-400">
            {subtitle.kind === "downloading"
              ? S.models.builtinDownloading(percent)
              : subtitle.kind === "update-available"
                ? S.models.builtinUpdateAvailable(subtitle.installed, subtitle.pinned)
                : subtitle.kind === "ready"
                  ? S.models.builtinReady(subtitle.version)
                  : subtitle.kind === "download-size"
                    ? S.models.builtinDownloadSize(APPROX_MB)
                    : null}
            {info.tokenMasked !== null && (
              <span className="ml-2 font-mono">{S.models.builtinToken(info.tokenMasked)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {info.status === "not-installed" && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{S.models.builtinCopilotAbout}</p>
        )}
        {info.envPending && (
          <p className={`text-xs ${toneInk.attention}`}>{S.models.cliEnvPending}</p>
        )}
        {info.message !== null && (
          <p role="status" className={`rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}>
            {info.message}
          </p>
        )}
        {actions.needsToken && (
          <div className="space-y-1.5">
            <PasswordInput
              size="sm"
              label={S.models.builtinTokenLabel}
              hint={S.models.builtinTokenHint}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
            <a
              href={PAT_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-[var(--accent-fg)] underline-offset-2 hover:underline"
            >
              {S.models.builtinTokenCreate}
            </a>
          </div>
        )}
        {(actions.setup || actions.update || (actions.retry && info.installedVersion === null)) && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {S.models.builtinTerms}{" "}
            <a
              href={LICENSE_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[var(--accent-fg)] underline-offset-2 hover:underline"
            >
              {S.models.builtinTermsLink}
            </a>
          </p>
        )}
        {tested !== null && (
          <p
            role="status"
            className={`rounded-md border px-3 py-2 text-xs ${tested.ok ? toneStrip.success : toneStrip.danger}`}
          >
            {tested.ok
              ? S.models.cliTestOk(info.title, tested.ms, tested.reply)
              : `${S.models.cliTestStart(info.title, tested.message ?? "")} ${S.models.builtinPatHint}`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {(actions.setup || actions.retry) && (
            <Button
              size="sm"
              variant="primary"
              disabled={busy || (actions.needsToken && token.trim() === "")}
              onClick={() => {
                const sendToken = actions.needsToken ? token.trim() : undefined;
                act(() => setupBuiltinCopilot(sendToken));
                setToken("");
              }}
            >
              {actions.setup ? S.models.builtinSetup : S.models.builtinRetry}
            </Button>
          )}
          {actions.update && (
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => act(() => setupBuiltinCopilot())}
            >
              {S.models.builtinUpdate}
            </Button>
          )}
          {actions.cancel && (
            <Button size="sm" disabled={busy} onClick={() => act(cancelBuiltinCopilot)}>
              {S.models.builtinCancel}
            </Button>
          )}
          {actions.test && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setTested(null);
                act(() => testCodingAgent(info.agentId).then(setTested));
              }}
            >
              {S.models.cliTest}
            </Button>
          )}
          {actions.replaceToken && (
            <Button size="sm" disabled={busy} onClick={() => setReplacing(true)}>
              {S.models.builtinReplaceToken}
            </Button>
          )}
          {actions.remove && (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setRemoving(true)}>
              {S.models.builtinRemove}
            </Button>
          )}
        </div>
      </div>

      <Modal
        open={replacing}
        title={S.models.builtinReplaceTokenTitle}
        onClose={() => setReplacing(false)}
        footer={
          <>
            <Button size="sm" onClick={() => setReplacing(false)}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || token.trim() === ""}
              onClick={() => {
                act(() => replaceBuiltinCopilotToken(token.trim()));
                setToken("");
                setReplacing(false);
              }}
            >
              {S.common.save}
            </Button>
          </>
        }
      >
        <PasswordInput
          size="sm"
          label={S.models.builtinTokenLabel}
          hint={S.models.builtinTokenHint}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="font-mono"
          autoComplete="off"
        />
      </Modal>

      <ConfirmModal
        open={removing}
        title={S.models.builtinRemoveTitle}
        confirmLabel={S.models.builtinRemove}
        onClose={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false);
          act(removeBuiltinCopilot);
        }}
      >
        {S.models.builtinRemoveBody}
      </ConfirmModal>
    </li>
  );
}
