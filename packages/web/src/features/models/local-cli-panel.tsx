/**
 * Models → Local CLI: the coding agents installed on the server machine, as model sources
 * next to the API providers. One card per agent — logo, name and who makes it, version and
 * sign-in state, the model it will use — and the selected card opens to its Model and
 * Reasoning effort, remembered for the agent and applied to its new Sessions. Agents that are
 * not installed wait in a folded list with a link to install them. Starting one is starting a
 * chat with it picked in the model dropdown; its Sessions are ordinary Sessions.
 */
import { useCallback, useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryResponse,
  CodingAgentServerInfo,
  CodingAgentTestResult,
} from "@prismshadow/penguin-server/api";
import {
  discoverCodingAgents,
  listCodingAgents,
  refreshCodingAgents,
  removeCodingAgent,
  setCodingAgentModel,
  setCodingAgentOption,
  testCodingAgent,
} from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneDot, toneInk, toneStrip, type Tone } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { CopyButton, ROW_COPY_CLASS } from "../../components/ui/copy-button";
import { ProviderLogo } from "../../components/ui/provider-logo";
import { Select } from "../../components/ui/select";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError } from "../../components/ui/toast";
import { AddAgentModal } from "./add-agent-modal";
import {
  buildAgentCards,
  cardReadiness,
  currentModel,
  effortOptionOf,
  modelOptionOf,
  type AgentCardModel,
  type CardReadiness,
} from "../coding-agents/agent-cards";
import { CODING_AGENT_PROVIDER, codingAgentLogo } from "../chat/coding-agent-models";

/**
 * Whether this tab has already started the first probe on its own. Module scope, not the
 * component: the panel remounts whenever the admin switches views, and a probe can take a
 * while, so a component-level flag would start a second one on the way back, or retry a
 * failing one on every visit.
 */
let autoProbeStarted = false;

export function LocalCliPanel() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin === true;
  const navigate = useNavigate();
  const [saved, setSaved] = useState<CodingAgentServerInfo[] | null>(null);
  const [discovery, setDiscovery] = useState<CodingAgentDiscoveryResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [availableOpen, setAvailableOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<AgentCardModel | null>(null);

  const load = useCallback(() => {
    void Promise.all([listCodingAgents(), discoverCodingAgents()])
      .then(([agents, found]) => {
        setSaved(agents.agents);
        setDiscovery(found);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const rescan = useCallback(() => {
    setScanning(true);
    refreshCodingAgents()
      .then((found) => {
        setDiscovery(found);
        return listCodingAgents().then((agents) => setSaved(agents.agents));
      })
      .catch((e: unknown) => toastError(apiErrorText(e)))
      .finally(() => setScanning(false));
  }, []);

  // The models, versions and failures come from a probe, which is saved once run. Until the
  // first one, an admin's visit runs it so every card opens with its model dropdown.
  useEffect(() => {
    if (!isAdmin || autoProbeStarted || discovery === null || saved === null) return;
    if (discovery.probedAt !== undefined) return;
    if (saved.length === 0 && !discovery.candidates.some((c) => c.detected)) return;
    autoProbeStarted = true;
    rescan();
  }, [isAdmin, discovery, saved, rescan]);

  const { installed, available } = buildAgentCards(
    saved ?? [],
    discovery,
    S.codingAgents.setupRequired,
  );
  const loading = saved === null && !failed;

  return (
    <section aria-label={S.models.viewLocalCli}>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{S.models.localCliIntro}</p>
      {failed && (
        <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>
          {S.models.cliScanFailed}
        </div>
      )}
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {S.models.installedClis(installed.length)}
          </h2>
          {installed.length > 0 && (
            <span className="truncate text-xs text-gray-500 dark:text-gray-400">
              {S.models.cliReadyCount(
                installed.filter((card) => cardReadiness(card) === "ready").length,
                installed.length,
              )}
            </span>
          )}
        </div>
        {isAdmin && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              {S.models.cliAddAgent}
            </Button>
            <Button size="sm" onClick={rescan} disabled={scanning}>
              {scanning ? S.models.cliScanning : S.models.cliRescan}
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <SkeletonList rows={3} />
      ) : installed.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {S.models.cliNone}
        </p>
      ) : (
        <ul className="space-y-2">
          {installed.map((card) => (
            <CliCard
              key={`${card.key}:${discovery?.probedAt ?? 0}`}
              card={card}
              selected={selected === card.agentId}
              isAdmin={isAdmin}
              scanning={scanning}
              onSelect={() => setSelected(selected === card.agentId ? null : card.agentId)}
              onChanged={load}
              onStartChat={() =>
                navigate("/chat/new", {
                  state: { modelRef: { provider: CODING_AGENT_PROVIDER, modelId: card.agentId } },
                })
              }
              onRemove={() => setRemoving(card)}
            />
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-200 dark:border-gray-800">
          <button
            type="button"
            aria-expanded={availableOpen}
            onClick={() => setAvailableOpen((open) => !open)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            <Chevron open={availableOpen} />
            {S.models.availableClis(available.length)}
          </button>
          {availableOpen && (
            <div className="border-t border-gray-200 p-3 dark:border-gray-800">
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                {isAdmin ? S.models.cliInstallSteps : S.models.cliInstallStepsMember}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {available.map((card) => (
                  <AvailableCard key={card.key} card={card} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <AddAgentModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} />
      <ConfirmModal
        open={removing !== null}
        title={S.codingAgents.removeConfirmTitle}
        confirmLabel={S.models.cliRemove}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing !== null) {
            void removeCodingAgent(removing.agentId)
              .then(load)
              .catch((e: unknown) => toastError(apiErrorText(e)));
          }
          setRemoving(null);
        }}
      >
        {removing !== null ? S.codingAgents.removeConfirmBody(removing.title) : ""}
      </ConfirmModal>
    </section>
  );
}

/**
 * One installed agent. Collapsed it reads like a model row — logo, name · maker, version and
 * sign-in state, the model it will use; selected it opens to the settings its Sessions start
 * with, plus the way to start one.
 */
function CliCard({
  card,
  selected,
  isAdmin,
  scanning,
  onSelect,
  onChanged,
  onStartChat,
  onRemove,
}: {
  card: AgentCardModel;
  selected: boolean;
  isAdmin: boolean;
  scanning: boolean;
  onSelect: () => void;
  onChanged: () => void;
  onStartChat: () => void;
  onRemove: () => void;
}) {
  const model = currentModel(card);
  const panelId = useId();
  const modelOption = modelOptionOf(card.options);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<CodingAgentTestResult | null>(null);
  // A Test that passed since the last probe outranks that probe's failure.
  const readiness = cardReadiness(tested?.ok === true ? { ...card, probeError: undefined } : card);
  const runTest = () => {
    setTesting(true);
    setTested(null);
    testCodingAgent(card.agentId)
      .then(setTested)
      .catch((e: unknown) => toastError(apiErrorText(e)))
      .finally(() => setTesting(false));
  };
  const effortOption = effortOptionOf(card.options);
  const remember = (option: CodingAgentConfigOption, value: string, isModel: boolean) => {
    const name = option.options.find((o) => o.value === value)?.name;
    const request = isModel
      ? setCodingAgentModel(card.agentId, {
          configId: option.id,
          value,
          ...(name !== undefined ? { name } : {}),
        })
      : setCodingAgentOption(card.agentId, { configId: option.id, value });
    void request.then(onChanged).catch((e: unknown) => toastError(apiErrorText(e)));
  };
  // The model the agent will use, chosen in the row: its advertised list once a probe has
  // read one, otherwise the plain name of what it will use.
  // A remembered model the latest probe no longer lists stays in the list, so the row never
  // claims the agent uses a model it will not.
  const modelChoices =
    modelOption && model !== null && !modelOption.options.some((o) => o.value === model.value)
      ? [{ value: model.value, name: model.name }, ...modelOption.options]
      : (modelOption?.options ?? []);
  const modelText =
    scanning && card.startable
      ? S.models.cliReadingModels
      : (model?.name ??
        (readiness === "failed" || readiness === "setup"
          ? S.models.cliNoModels
          : S.models.cliDefault));
  const modelControl =
    modelOption && modelChoices.length > 0 ? (
      <Select
        size="sm"
        aria-label={`${card.title} ${S.models.cliModel}`}
        value={model?.value ?? ""}
        disabled={!isAdmin}
        onChange={(e) => remember(modelOption, e.target.value, true)}
      >
        {modelChoices.map((value) => (
          <option key={value.value} value={value.value}>
            {value.name}
          </option>
        ))}
      </Select>
    ) : (
      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{modelText}</p>
    );
  const effortValue = String(
    (effortOption && card.rememberedOptions?.[effortOption.id]) ?? effortOption?.currentValue ?? "",
  );
  return (
    <li
      className={`rounded-lg border bg-white transition-colors duration-150 dark:bg-gray-900 ${
        selected
          ? "border-gray-400 shadow-sm dark:border-gray-600"
          : "border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3 pr-4">
        <button
          type="button"
          aria-expanded={selected}
          aria-controls={panelId}
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
        >
          <ProviderLogo
            provider={codingAgentLogo(card.agentId, card.title)}
            className="h-8 w-8 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
              <span className="truncate font-medium text-gray-900 dark:text-gray-100">
                {card.title}
              </span>
              {card.vendor && (
                <span className="truncate text-gray-500 dark:text-gray-400">· {card.vendor}</span>
              )}
            </div>
            {card.version && (
              <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                {card.version}
              </div>
            )}
            {/* Below lg, beside the sidebar, the row has no room for the dropdown; it opens
                with the card instead. */}
            {!selected && (
              <div className="truncate text-xs text-gray-500 lg:hidden dark:text-gray-400">
                {S.models.cliModelSummary(modelText)}
              </div>
            )}
          </div>
        </button>
        <div className="hidden w-56 shrink-0 lg:block">{modelControl}</div>
        <ReadinessMark readiness={readiness} />
      </div>

      {selected && (
        <div
          id={panelId}
          className="min-w-0 space-y-3 border-t border-gray-100 px-4 pb-4 pt-3 dark:border-gray-800"
        >
          {card.commandLine !== "" && (
            <div className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
              {card.commandLine}
            </div>
          )}
          {readiness === "failed" && (
            <p
              className={`rounded-md border px-3 py-2 text-xs [overflow-wrap:anywhere] ${toneStrip.danger}`}
            >
              {card.probeError
                ? S.models.cliProbeFailed(card.title, card.probeError)
                : S.models.cliProbeFailedPlain(card.title)}
            </p>
          )}
          <div className="space-y-1.5 lg:hidden">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {S.models.cliModel}
            </span>
            {modelControl}
          </div>
          {effortOption && effortOption.options.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {S.models.cliEffort}
              </span>
              <Select
                size="sm"
                aria-label={`${card.title} ${S.models.cliEffort}`}
                value={effortValue}
                disabled={!isAdmin}
                onChange={(e) => remember(effortOption, e.target.value, false)}
              >
                {effortOption.options.map((value) => (
                  <option key={value.value} value={value.value}>
                    {value.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {readiness === "signIn" && card.authHint && (
            <p className={`rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}>
              {S.models.cliSignInHint(card.authHint)}
            </p>
          )}
          {card.setupHint && <p className={`text-xs ${toneInk.attention}`}>{card.setupHint}</p>}
          {(testing || tested !== null) && (
            <TestResultRow card={card} testing={testing} result={tested} />
          )}
          <div className="flex flex-wrap gap-2">
            {card.startable && (
              <Button size="sm" variant="primary" onClick={onStartChat}>
                {S.models.cliStartChat}
              </Button>
            )}
            {card.startable && isAdmin && (
              <Button size="sm" onClick={runTest} disabled={testing}>
                {testing ? S.models.cliTesting : tested ? S.models.cliRetest : S.models.cliTest}
              </Button>
            )}
            {card.saved && isAdmin && (
              <Button size="sm" variant="danger" onClick={onRemove}>
                {S.models.cliRemove}
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * An agent not installed on the server machine: who makes it, the command that installs it
 * where one works on every OS (with a copy button, since it runs in the server's terminal,
 * not here), and a link to its install page.
 */
function AvailableCard({ card }: { card: AgentCardModel }) {
  return (
    <li className="min-w-0 space-y-2 rounded-md bg-gray-50 px-3 py-2.5 dark:bg-gray-900">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderLogo
          provider={codingAgentLogo(card.agentId, card.title)}
          className="h-6 w-6 shrink-0 opacity-60"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-gray-900 dark:text-gray-100">{card.title}</div>
          {card.vendor && (
            <div className="truncate text-xs text-gray-500 dark:text-gray-400">{card.vendor}</div>
          )}
        </div>
        {card.homepageUrl && (
          <a
            href={card.homepageUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs font-medium text-[var(--accent-fg)] underline-offset-2 hover:underline"
          >
            {S.models.cliInstall}
          </a>
        )}
      </div>
      {card.installCommand && (
        <div className="flex min-w-0 items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 dark:border-gray-800 dark:bg-gray-950">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700 dark:text-gray-300">
            {card.installCommand}
          </code>
          <CopyButton
            text={card.installCommand}
            label={S.models.cliCopyInstall(card.title)}
            className={ROW_COPY_CLASS}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Whether the agent can run a prompt now, at the card's right edge: a state dot and its word,
 * so the colour is never the only carrier. "Sign-in unknown" says why in its tooltip.
 */
function ReadinessMark({ readiness }: { readiness: CardReadiness }) {
  const mark: Record<CardReadiness, { tone: Tone; label: string; title?: string }> = {
    ready: { tone: "success", label: S.models.cliReady },
    signIn: { tone: "attention", label: S.models.cliSignInRequired },
    setup: { tone: "attention", label: S.models.cliNeedsSetup },
    failed: { tone: "danger", label: S.models.cliWontStart },
    unknown: {
      tone: "muted",
      label: S.models.cliSignInUnknown,
      title: S.models.cliSignInUnknownTitle,
    },
  };
  const { tone, label, title } = mark[readiness];
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"
      {...(title !== undefined ? { title } : {})}
    >
      <span aria-hidden className={`block h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} />
      {label}
    </span>
  );
}

/** A connection test's outcome, under the card it ran for: what the agent answered, or why not. */
function TestResultRow({
  card,
  testing,
  result,
}: {
  card: AgentCardModel;
  testing: boolean;
  result: CodingAgentTestResult | null;
}) {
  if (testing || result === null) {
    return (
      <p role="status" className="text-xs text-gray-500 dark:text-gray-400">
        {S.models.cliTesting}
      </p>
    );
  }
  const text = result.ok
    ? S.models.cliTestOk(card.title, result.ms, result.reply)
    : result.failure === "start"
      ? S.models.cliTestStart(card.title, result.message ?? "")
      : result.failure === "timeout"
        ? S.models.cliTestTimeout(card.title)
        : result.failure === "failed"
          ? S.models.cliTestFailed(card.title, result.message ?? "")
          : S.models.cliTestReply(card.title, result.reply);
  return (
    <p
      role="status"
      className={`rounded-md border px-3 py-2 text-xs ${result.ok ? toneStrip.success : toneStrip.danger}`}
    >
      {text}
    </p>
  );
}
