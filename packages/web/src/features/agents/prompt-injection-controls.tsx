/**
 * Shared prompt-injection controls for the Skills / Vault / Schedules tabs, mirroring the
 * Memory tab's layout: an enable-switch card (label + switch, the memory tab's exact card
 * shape) that writes immediately (so toggling never drags an unfinished prompt edit along),
 * an amber alert when the template lacks the feature's section placeholder — with one-click
 * insert, or one-click migration when the template still carries the legacy hardcoded
 * section — and an editable prompt section (mono textarea + placeholder-chip reference +
 * confirm-first save). The toggle and prompt govern prompt injection only — the feature
 * itself keeps working with the switch off (vault values still reach subprocesses, tasks
 * still fire, skills stay invocable).
 *
 * Exposed as a hook returning render slots (the useSaveConfirm convention) because the pieces
 * straddle the host tab's own content: the switch and alert sit above it, the prompt editor
 * below. The hook owns the config state; the tab seeds it via `applyConfig` from the
 * getAgentConfig response it loads in parallel with its own data. `canEdit` carries the host
 * tab's permission model (member-level on Skills, owner-only on Vault / Schedules).
 */
import { useCallback, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type {
  AgentConfigDto,
  AgentSchedulesConfigDto,
  AgentSkillsConfigDto,
  AgentVaultConfigDto,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";
import { useSaveConfirm } from "../../components/ui/confirm-modal";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { toneStrip } from "../../lib/tone";
import { InfoPopover } from "../../components/ui/info-popover";

export type PromptInjectionFeature = "skills" | "vault" | "schedules";

/** The strings each feature section supplies (S.skills / S.vault / S.schedule); migrate/legacyTemplate exist only where a legacy hardcoded section does. */
interface PromptInjectionStrings {
  enable: string;
  templateMissing: string;
  legacyTemplate?: string;
  insertPlaceholder: string;
  migrate?: string;
  promptSection: string;
  promptSectionHint: string;
  promptLabel: string;
  promptPlaceholders: ReadonlyArray<readonly [string, string]>;
}

/** The three feature DTOs share this shape; `legacySectionPresent` is absent on schedules (it never had a hardcoded section). */
interface SectionConfigState {
  enabled: boolean;
  prompt: string;
  templateHasPlaceholder: boolean;
  legacySectionPresent?: boolean;
}

/** Same contract as the Prompt tab's inserter: execCommand keeps the textarea's native undo stack, with a state-splice fallback. */
function insertPromptToken(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  setValue: (next: string) => void,
  token: string,
): void {
  const el = ref.current;
  if (el) {
    el.focus();
    const inserted = document.execCommand?.("insertText", false, token);
    if (inserted) return; // onChange updates state from e.target.value
  }
  const start = el ? el.selectionStart : value.length;
  const end = el ? el.selectionEnd : value.length;
  setValue(value.slice(0, start) + token + value.slice(end));
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    const caret = start + token.length;
    el.setSelectionRange(caret, caret);
  });
}

export function usePromptInjection({
  agentId,
  feature,
  strings,
  canEdit,
  onConfigChanged,
}: {
  agentId: string;
  feature: PromptInjectionFeature;
  strings: PromptInjectionStrings;
  /** The host tab's permission model: false renders everything read-only (switch disabled, buttons hidden, prompt not saveable). */
  canEdit: boolean;
  /** Config writes happen here directly, so the settings page must refetch its own copy — otherwise a later Prompt-tab save from stale data would silently revert them. */
  onConfigChanged?: (() => void) | undefined;
}): {
  applyConfig: (config: AgentConfigDto) => void;
  toggleCard: ReactNode;
  alertStrip: ReactNode;
  promptSection: ReactNode;
} {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;

  // null until the host tab's load delivers the config (the slots render nothing until then).
  const [state, setState] = useState<SectionConfigState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [switchBusy, setSwitchBusy] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const { requestSave, element: saveConfirm } = useSaveConfirm();

  // Stable so the host tab's load() can list it as a dependency without re-triggering itself.
  const applyConfig = useCallback(
    (config: AgentConfigDto) => {
      const dto: AgentVaultConfigDto | AgentSkillsConfigDto | AgentSchedulesConfigDto =
        config[feature];
      setState(dto);
      setPrompt(dto.prompt);
    },
    [feature],
  );

  /** The PUT body for this feature (a computed key would widen the request type, so switch explicitly). */
  const featurePatch = (patch: { enabled?: boolean; prompt?: string }) =>
    feature === "skills"
      ? { config: { skills: patch } }
      : feature === "vault"
        ? { config: { vault: patch } }
        : { config: { schedules: patch } };

  const toggleEnabled = async (next: boolean) => {
    if (!projectId) return;
    setSwitchBusy(true);
    try {
      const res = await api.putAgentConfig(projectId, agentId, featurePatch({ enabled: next }));
      applyConfig(res.config);
      toastSuccess(S.agent.savedTakesEffect);
      onConfigChanged?.();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setSwitchBusy(false);
    }
  };

  /** One idempotent config write: migrates the legacy section when present, else inserts the placeholder. */
  const insertPlaceholder = async () => {
    if (!projectId) return;
    const insert =
      feature === "skills"
        ? api.insertSkillsPlaceholder
        : feature === "vault"
          ? api.insertVaultPlaceholder
          : api.insertSchedulesPlaceholder;
    try {
      const dto = await insert(projectId, agentId);
      setState(dto);
      setPrompt(dto.prompt);
      toastSuccess(S.agent.savedTakesEffect);
      onConfigChanged?.();
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };

  /** Saves the prompt through the ordinary config write (confirm-first, like the other settings tabs). */
  const savePrompt = () =>
    requestSave(() => {
      if (!projectId) return;
      void api
        .putAgentConfig(projectId, agentId, featurePatch({ prompt }))
        .then((res) => {
          applyConfig(res.config);
          toastSuccess(S.agent.savedTakesEffect);
          onConfigChanged?.();
        })
        .catch((e: unknown) => toastError(apiErrorText(e)));
    });

  const toggleCard = state !== null && (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{strings.enable}</p>
      <Switch
        checked={state.enabled}
        onChange={(v) => void toggleEnabled(v)}
        disabled={switchBusy || !canEdit}
      />
    </div>
  );

  // Legacy templates get the migration wording (and the legacy strings always exist for the
  // features that can report legacySectionPresent); everything else gets the plain insert.
  const legacy = state?.legacySectionPresent === true;
  const alertStrip = state !== null && !state.templateHasPlaceholder && (
    <div
      className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${toneStrip.attention}`}
    >
      <p className="text-xs">
        {legacy ? (strings.legacyTemplate ?? strings.templateMissing) : strings.templateMissing}
      </p>
      {canEdit && (
        <Button size="sm" className="shrink-0" onClick={() => void insertPlaceholder()}>
          {legacy ? (strings.migrate ?? strings.insertPlaceholder) : strings.insertPlaceholder}
        </Button>
      )}
    </div>
  );

  const promptSection = state !== null && (
    <section className="space-y-2.5 rounded-lg border border-gray-200 p-3.5 dark:border-gray-800">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200">
        {strings.promptSection}
        <InfoPopover label={strings.promptSection}>{strings.promptSectionHint}</InfoPopover>
      </h3>
      <Textarea
        ref={promptRef}
        label={strings.promptLabel}
        mono
        size="sm"
        rows={12}
        readOnly={!canEdit}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      {/* Placeholder reference, the Prompt/Memory tab convention — a chip inserts at the cursor. */}
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
        <p className="mb-2 text-xs font-semibold text-gray-500">{S.agent.placeholdersTitle}</p>
        <ul className="space-y-1">
          {strings.promptPlaceholders.map(([token, desc]) => (
            <li key={token} className="flex items-center gap-3 text-xs">
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => insertPromptToken(promptRef, prompt, setPrompt, token!)}
                title={S.memory.insertToken}
                className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono font-semibold text-gray-800 transition-colors duration-150 hover:border-gray-400 hover:bg-gray-100 disabled:pointer-events-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-700"
              >
                {token}
              </button>
              <span className="text-gray-500 dark:text-gray-400">{desc}</span>
            </li>
          ))}
        </ul>
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" onClick={savePrompt}>
            {S.common.save}
          </Button>
        </div>
      )}
      {saveConfirm}
    </section>
  );

  return { applyConfig, toggleCard, alertStrip, promptSection };
}
