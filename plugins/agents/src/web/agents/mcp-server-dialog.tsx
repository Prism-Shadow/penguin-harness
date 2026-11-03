/**
 * The add / edit dialog of one MCP Server entry (mcp-servers-section.tsx lists them). Its fields
 * follow the chosen transport; the permission menu and the three budgets sit beside them. A
 * standalone "test connection" button probes the entry as typed (nothing saved; the result is a
 * toast, the models dialog idiom). The server fills vault values only into an entry saved as it
 * is: while the form still says what the saved entry says, the test sends the saved entry itself
 * (mcp-servers-form.ts `entryToTest`), and a new or changed entry that reads the vault is
 * answered "save first", a muted note beside the button rather than a failure. An entry a plugin
 * installed says so at the top: reinstalling the plugin replaces it.
 *
 * A record dialog under the settings commit model: the dialog is one form, Save is live only
 * while the entry as Save would write it (mcp-servers-form.ts `formToServer`) differs from the
 * stored one and is valid, and closing it with unsaved edits (Cancel, Esc, the ×, a press
 * outside) asks first. A field's error shows once the field differs from what the dialog opened
 * with — an untouched required field is marked by its asterisk, not by an error — and every
 * error shows once a test is asked for an entry that cannot be built. A rejection from the
 * server lands at the dialog's foot, and the dialog stays open with what was typed. The form is
 * mounted only while the dialog is open.
 */
import { useState } from "react";
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";
import {
  Button,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Input,
  Modal,
  OptionMenu,
  Segmented,
  Textarea,
  toastError,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
  type OptionMenuChoice,
} from "@prismshadow/penguin-ui";

import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { toneInk } from "../../lib/tone";
import { useAgentLocation } from "../../lib/agent-location";
import {
  emptyMcpForm,
  entryToTest,
  formToServer,
  serverToForm,
  type McpFormError,
  type McpFormField,
  type McpPermissionMode,
  type McpServerFormState,
  type McpTransportKind,
} from "./mcp-servers-form";

/** Maps a validation error code to its localized message. */
function errorText(err: McpFormError | undefined): string | undefined {
  if (!err) return undefined;
  switch (err.code) {
    case "required":
      return S.common.requiredField;
    case "name_charset":
      return S.agent.mcpNameInvalid;
    case "url_invalid":
      return S.agent.mcpUrlInvalid;
    case "kv_line":
      return S.agent.mcpLineInvalid(err.line ?? 1);
    case "number":
      return S.agent.mcpNumberInvalid;
    case "duplicate":
      return S.agent.mcpDuplicateName;
  }
}

/** The form field each validated field is typed into. */
const FIELD_INPUT: Record<McpFormField, keyof McpServerFormState> = {
  name: "name",
  command: "command",
  url: "url",
  env: "envText",
  headers: "headersText",
  connectTimeoutMs: "connectTimeoutMs",
  timeoutMs: "timeoutMs",
  maxOutputLength: "maxOutputLength",
};

/** Every text field trimmed: the comparison basis of a form that does not build an entry yet. */
function trimmed(form: McpServerFormState): McpServerFormState {
  const out = { ...form };
  for (const key of Object.keys(out) as (keyof McpServerFormState)[]) {
    const value = out[key];
    if (typeof value === "string") (out as Record<string, unknown>)[key] = value.trim();
  }
  return out;
}

/** What Save would write, for the dirty comparison: the built entry, or the trimmed form. */
function normalizeMcp(form: McpServerFormState): unknown {
  const built = formToServer(form);
  return built.ok ? built.server : { invalid: trimmed(form) };
}

export interface McpServerDialogProps {
  /** The entry being edited; null adds a new one. */
  entry: MCPServerConfig | null;
  /** The other entries' names: the entry may not take one of them. */
  takenNames: readonly string[];
  projectId: string;
  agentId: string;
  /** A plugin's title in the UI language, by its name: who installed an entry that says so. */
  pluginTitle: (name: string) => string;
  /** Writes the entry; resolves with null when stored, else with why it was refused. */
  onSubmit: (server: MCPServerConfig) => Promise<string | null>;
  onClose: () => void;
}

export function McpServerDialog({
  entry,
  takenNames,
  projectId,
  agentId,
  pluginTitle,
  onSubmit,
  onClose,
}: McpServerDialogProps) {
  const [initial] = useState(() => (entry === null ? emptyMcpForm() : serverToForm(entry)));
  const form = useFormDraft(initial, { normalize: normalizeMcp });
  // Server-side rejection (transport validation 400) rendered at the dialog's foot.
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestClose = useGuardedClose(onClose, form.scope, { locked: busy });
  // Connectivity probe: runs the current form through POST /config/mcp-test (server-side
  // connect + discovery, nothing saved); the result pops as a toast.
  const [testing, setTesting] = useState(false);
  /** The machine the Agent lives on: the probe runs there, where the server would. */
  const machineId = useAgentLocation();
  // The probe's "save first" answer (an unsaved entry that reads the vault), shown beside the
  // test button until the form changes.
  const [saveFirst, setSaveFirst] = useState(false);
  /** A test was asked for an entry that cannot be built: every error shows, untouched or not. */
  const [revealAll, setRevealAll] = useState(false);

  // http leads (the Add dialog's default), stdio second, legacy sse last.
  const transportOptions: ReadonlyArray<{ value: McpTransportKind; label: string }> = [
    { value: "http", label: "http" },
    { value: "stdio", label: "stdio" },
    { value: "sse", label: "sse" },
  ];
  const transportHints: Record<McpTransportKind, string> = {
    http: S.agent.mcpTransportHttp,
    stdio: S.agent.mcpTransportStdio,
    sse: S.agent.mcpTransportSse,
  };
  // auto leads (the default); an explicit level below it overrides every tool's readOnlyHint.
  const permissionOptions: ReadonlyArray<OptionMenuChoice<McpPermissionMode>> = [
    {
      value: "auto",
      triggerLabel: S.agent.mcpPermissionAuto,
      label: S.agent.mcpPermissionAutoLabel,
      description: S.agent.mcpPermissionAutoDescription,
    },
    {
      value: "r",
      triggerLabel: S.agent.permissionReadLabel,
      label: S.agent.permissionReadLabel,
      description: S.agent.mcpPermissionReadDescription,
    },
    {
      value: "rw",
      triggerLabel: S.agent.permissionReadWriteLabel,
      label: S.agent.permissionReadWriteLabel,
      description: S.agent.mcpPermissionReadWriteDescription,
    },
  ];

  const draft = form.draft;
  const built = formToServer(draft);
  const errors: Partial<Record<McpFormField, McpFormError>> = built.ok ? {} : { ...built.errors };
  // Same-name collision against the other rows (the edited row may keep its own name),
  // rendered under the name field itself, like every other validation error.
  if (built.ok && takenNames.includes(built.server.name)) errors.name = { code: "duplicate" };
  const valid = Object.keys(errors).length === 0;
  /** A field's error, shown once the field was edited (an untouched required field has its asterisk). */
  const errorOf = (field: McpFormField): string | undefined => {
    const err = errors[field];
    if (err === undefined) return undefined;
    const input = FIELD_INPUT[field];
    const edited = draft[input] !== form.baseline[input];
    return revealAll || edited || err.code !== "required" ? errorText(err) : undefined;
  };

  const patch = (next: Partial<McpServerFormState>) => {
    form.patch(next);
    setRefused(null);
    setSaveFirst(false);
  };

  /**
   * Probes the form as typed (unsaved values on purpose: verify before persisting). An untouched
   * saved entry goes as saved; a new or changed one that reads the vault is answered "save
   * first" — no vault value is filled into an unsaved entry — which shows beside the button as a
   * note, not as a failure.
   */
  const testConnection = async () => {
    const tested = entryToTest(draft, entry ?? undefined);
    if (!tested.ok) {
      setRevealAll(true);
      return;
    }
    setTesting(true);
    setSaveFirst(false);
    try {
      const res = await api.testAgentMcpServer(projectId, agentId, tested.server, machineId);
      if (res.ok) toastSuccess(S.agent.mcpTestOk(res.tools?.length ?? 0, res.latencyMs));
      else if (res.saveFirst === true) setSaveFirst(true);
      else toastError(S.agent.mcpTestFail(res.error ?? S.common.unknownError));
    } catch (e) {
      toastError(S.agent.mcpTestFail(apiErrorText(e)));
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    if (!built.ok || !valid || !form.dirty || busy) return;
    setBusy(true);
    try {
      const refusal = await onSubmit(built.server);
      if (refusal === null) onClose();
      else setRefused(refusal);
    } finally {
      setBusy(false);
    }
  };

  // The form's target field (command / url) — the same gate the models dialog uses for its
  // test button (disabled until the identity is filled in).
  const targetFilled =
    draft.transport === "stdio" ? draft.command.trim() !== "" : draft.url.trim() !== "";

  return (
    <Modal
      open
      title={entry === null ? S.agent.mcpAdd : S.agent.mcpEditTitle}
      onClose={requestClose}
      footer={
        <>
          <Button size="sm" onClick={requestClose}>
            {S.common.cancel}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!form.dirty || !valid || busy}
            onClick={() => void submit()}
          >
            {S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {draft.plugin !== undefined && (
          <p className="text-xs text-fg-muted">
            {S.agent.mcpFromPlugin(pluginTitle(draft.plugin))}
          </p>
        )}
        {/* Transport first, as tab-style switches — the choice decides every field below. A
            field of the entry, so it saves with it. */}
        <div className="space-y-1">
          <Segmented
            options={transportOptions}
            value={draft.transport}
            onChange={(v) => patch({ transport: v })}
          />
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {transportHints[draft.transport]}
          </p>
        </div>
        {/* Entry-level action right under the tabs — the models dialog idiom: a standalone
            test button, enabled once the target (command / url) is filled in; the result
            pops as a toast. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={testing || busy || !targetFilled}
            onClick={() => void testConnection()}
          >
            {testing ? S.agent.mcpTesting : S.agent.mcpTest}
          </Button>
          {/* Not a failure: the entry reads the vault and is not saved as it is, so the test
              fills nothing in — a muted line with the key in the attention tone, no red. */}
          {saveFirst && (
            <span className={`inline-flex items-center ${ICON_GAP.row} text-xs text-fg-muted`}>
              <GlyphIcon
                d={ICONS.key}
                size={ICON_SIZE.inlineGlyph}
                className={`shrink-0 ${toneInk.attention}`}
              />
              {S.agent.mcpTestSaveFirst}
            </span>
          )}
        </div>
        <Input
          size="sm"
          label={S.agent.mcpName}
          required
          hint={S.agent.mcpNameHint}
          error={errorOf("name")}
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          className="font-mono"
          placeholder="filesystem"
          autoComplete="off"
        />
        {draft.transport === "stdio" ? (
          <>
            <Input
              size="sm"
              label={S.agent.mcpCommand}
              required
              error={errorOf("command")}
              value={draft.command}
              onChange={(e) => patch({ command: e.target.value })}
              className="font-mono"
              placeholder="npx"
              autoComplete="off"
            />
            <Textarea
              size="sm"
              mono
              label={S.agent.mcpArgs}
              hint={S.agent.mcpArgsHint}
              rows={3}
              value={draft.argsText}
              onChange={(e) => patch({ argsText: e.target.value })}
              placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
            />
            <Textarea
              size="sm"
              mono
              label={S.agent.mcpEnv}
              hint={S.agent.mcpEnvHint}
              error={errorOf("env")}
              rows={2}
              value={draft.envText}
              onChange={(e) => patch({ envText: e.target.value })}
              placeholder="API_TOKEN=..."
            />
            <Input
              size="sm"
              label={S.agent.mcpCwd}
              hint={S.agent.mcpCwdHint}
              value={draft.cwd}
              onChange={(e) => patch({ cwd: e.target.value })}
              className="font-mono"
              autoComplete="off"
            />
          </>
        ) : (
          <>
            <Input
              size="sm"
              label={S.agent.mcpUrl}
              required
              error={errorOf("url")}
              value={draft.url}
              onChange={(e) => patch({ url: e.target.value })}
              className="font-mono"
              placeholder="https://example.com/mcp"
              autoComplete="off"
            />
            <Textarea
              size="sm"
              mono
              label={S.agent.mcpHeaders}
              hint={S.agent.mcpHeadersHint}
              error={errorOf("headers")}
              rows={2}
              value={draft.headersText}
              onChange={(e) => patch({ headersText: e.target.value })}
              placeholder="Authorization: Bearer ..."
            />
          </>
        )}
        <div className="space-y-1">
          <OptionMenu
            size="sm"
            fullWidth
            label={S.agent.mcpPermission}
            options={permissionOptions}
            value={draft.permission}
            onChange={(v) => patch({ permission: v })}
          />
          <p className="text-xs text-gray-400 dark:text-gray-500">{S.agent.mcpPermissionHint}</p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Input
            size="sm"
            label={S.agent.mcpConnectTimeout}
            error={errorOf("connectTimeoutMs")}
            value={draft.connectTimeoutMs}
            inputMode="numeric"
            onChange={(e) => patch({ connectTimeoutMs: e.target.value })}
            className="font-mono"
            autoComplete="off"
          />
          <Input
            size="sm"
            label={S.agent.toolTimeout}
            error={errorOf("timeoutMs")}
            value={draft.timeoutMs}
            inputMode="numeric"
            onChange={(e) => patch({ timeoutMs: e.target.value })}
            className="font-mono"
            autoComplete="off"
          />
          <Input
            size="sm"
            label={S.agent.toolMaxOutput}
            error={errorOf("maxOutputLength")}
            value={draft.maxOutputLength}
            inputMode="numeric"
            onChange={(e) => patch({ maxOutputLength: e.target.value })}
            className="font-mono"
            autoComplete="off"
          />
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">{S.agent.mcpBudgetsHint}</p>
        {refused && <p className="text-xs text-red-600 dark:text-red-400">{refused}</p>}
      </div>
    </Modal>
  );
}
