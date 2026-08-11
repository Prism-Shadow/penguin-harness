/**
 * Tools tab's "MCP Server" block: a table of configured servers (name / transport /
 * target) with vault-style immediate persistence — Add/Edit happens in a modal whose
 * fields follow the chosen transport, deletion sits behind a confirmation. Every
 * operation PUTs the whole `mcpServers` list through the config route; the server
 * re-validates each entry via the core transport resolver, so a rejected save surfaces
 * inside the modal instead of half-applying.
 */
import { useState } from "react";
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { Input, Textarea } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Segmented } from "../../components/ui/segmented";
import { toastError, toastSuccess } from "../../components/ui/toast";
import {
  emptyMcpForm,
  formToServer,
  serverToForm,
  type McpFormError,
  type McpFormField,
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
  }
}

/**
 * The transport's target input (command / url) with the connectivity test riding inside
 * the field — the same in-field idiom as the models dialog's base-URL suffix, but
 * interactive. Padding reserves room so typed text never slides under the button.
 */
function InFieldTest({
  label,
  required,
  error,
  value,
  onChange,
  placeholder,
  testing,
  disabled,
  onTest,
}: {
  label: string;
  required?: boolean;
  error?: string | undefined;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testing: boolean;
  disabled: boolean;
  onTest: () => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <span className="relative block">
        <Input
          size="sm"
          required={required}
          invalid={Boolean(error)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-16 font-mono"
          placeholder={placeholder}
          autoComplete="off"
        />
        <button
          type="button"
          disabled={testing || disabled || value.trim() === ""}
          onClick={onTest}
          className="absolute inset-y-0 right-1.5 my-auto h-6 rounded px-1.5 text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          {testing ? S.agent.mcpTesting : S.agent.mcpTestShort}
        </button>
      </span>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </label>
  );
}

/** Table cell summary: the spawn line for stdio, the URL for http/sse. */
function targetOf(entry: MCPServerConfig): string {
  const c = entry.config;
  if (typeof c["url"] === "string") return c["url"];
  const command = typeof c["command"] === "string" ? c["command"] : "";
  const args = Array.isArray(c["args"]) ? c["args"].map((a) => String(a)).join(" ") : "";
  return args ? `${command} ${args}` : command;
}

export function McpServersSection({
  agentId,
  initial,
}: {
  agentId: string;
  initial: MCPServerConfig[];
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [servers, setServers] = useState<MCPServerConfig[]>(initial);
  const [busy, setBusy] = useState(false);
  // Modal state: editIndex null = adding, a number = editing that row; closed when form is null.
  const [form, setForm] = useState<McpServerFormState | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<McpFormField, McpFormError>>>({});
  // Server-side rejection (transport validation 400) rendered at the modal's foot.
  const [modalError, setModalError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  // Connectivity probe: runs the current form state through POST /config/mcp-test
  // (server-side connect + discovery, nothing saved); result renders inside the modal.
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  // http leads (the Add modal's default), stdio second, legacy sse last.
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

  /** Persist the full list (immediate, vault-style); returns null on success or an error message. */
  const persist = async (next: MCPServerConfig[]): Promise<string | null> => {
    if (!projectId || !agentId) return S.common.unknownError;
    setBusy(true);
    try {
      const res = await api.putAgentConfig(projectId, agentId, {
        config: { mcpServers: next },
      });
      setServers(res.config.mcpServers);
      toastSuccess(S.common.saved);
      return null;
    } catch (e) {
      return apiErrorText(e);
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setForm(emptyMcpForm());
    setEditIndex(null);
    setFieldErrors({});
    setModalError(null);
    setTestResult(null);
  };

  const openEdit = (index: number) => {
    const entry = servers[index];
    if (!entry) return;
    setForm(serverToForm(entry));
    setEditIndex(index);
    setFieldErrors({});
    setModalError(null);
    setTestResult(null);
  };

  const closeModal = () => {
    setForm(null);
    setEditIndex(null);
  };

  const patchForm = (patch: Partial<McpServerFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setFieldErrors({});
    setModalError(null);
    setTestResult(null);
  };

  /** Probes the current form state (unsaved values on purpose: verify before persisting). */
  const testConnection = async () => {
    if (!form || !projectId) return;
    const built = formToServer(form);
    if (!built.ok) {
      setFieldErrors(built.errors);
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testAgentMcpServer(projectId, agentId, built.server);
      setTestResult(
        res.ok
          ? { ok: true, text: S.agent.mcpTestOk(res.tools ?? []) }
          : { ok: false, text: S.agent.mcpTestFail(res.error ?? S.common.unknownError) },
      );
    } catch (e) {
      setTestResult({ ok: false, text: S.agent.mcpTestFail(apiErrorText(e)) });
    } finally {
      setTesting(false);
    }
  };

  const submitModal = async () => {
    if (!form) return;
    const built = formToServer(form);
    if (!built.ok) {
      setFieldErrors(built.errors);
      return;
    }
    // Same-name collision against the other rows (the edited row may keep its own name).
    const clash = servers.some((s, i) => i !== editIndex && s.name === built.server.name);
    if (clash) {
      setFieldErrors({ name: { code: "required" } });
      setModalError(S.agent.mcpDuplicateName);
      return;
    }
    const next =
      editIndex === null
        ? [...servers, built.server]
        : servers.map((s, i) => (i === editIndex ? built.server : s));
    const err = await persist(next);
    if (err !== null) {
      setModalError(err);
      return;
    }
    closeModal();
  };

  const confirmDelete = async () => {
    if (deleting === null) return;
    const err = await persist(servers.filter((_, i) => i !== deleting));
    if (err !== null) toastError(err);
    setDeleting(null);
  };

  if (!projectId) return null;

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-xs font-medium text-gray-500">{S.agent.mcpServers}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.agent.mcpDesc}</p>
      </div>

      {servers.length === 0 ? (
        <p className="py-2 text-xs text-gray-400 dark:text-gray-500">{S.agent.mcpEmpty}</p>
      ) : (
        <div className="overflow-x-auto overflow-y-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                <th className="px-3 py-2.5">{S.agent.mcpName}</th>
                <th className="px-3 py-2.5">{S.agent.mcpTransport}</th>
                <th className="px-3 py-2.5">{S.agent.mcpTarget}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {servers.map((entry, index) => (
                <tr
                  key={entry.name}
                  className="border-b border-gray-100 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
                >
                  <td className="px-3 py-2 font-mono text-xs">{entry.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {serverToForm(entry).transport}
                  </td>
                  <td className="max-w-[360px] truncate px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {targetOf(entry)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => openEdit(index)}
                    >
                      {S.common.edit}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setDeleting(index)}
                    >
                      {S.agent.mcpRemove}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Button size="sm" variant="primary" disabled={busy} onClick={openAdd}>
        {S.agent.mcpAdd}
      </Button>

      <Modal
        open={form !== null}
        title={editIndex === null ? S.agent.mcpAdd : S.agent.mcpEditTitle}
        onClose={closeModal}
        footer={
          <>
            <Button onClick={closeModal}>{S.common.cancel}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void submitModal()}>
              {S.common.save}
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-3">
            {/* Transport first, as tab-style switches — the choice decides every field below. */}
            <div className="space-y-1">
              <Segmented
                options={transportOptions}
                value={form.transport}
                onChange={(v) => patchForm({ transport: v })}
              />
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {transportHints[form.transport]}
              </p>
            </div>
            <Input
              size="sm"
              label={S.agent.mcpName}
              required
              hint={S.agent.mcpNameHint}
              error={errorText(fieldErrors.name)}
              value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })}
              className="font-mono"
              placeholder="filesystem"
              autoComplete="off"
            />
            {form.transport === "stdio" ? (
              <>
                <InFieldTest
                  label={S.agent.mcpCommand}
                  required
                  error={errorText(fieldErrors.command)}
                  value={form.command}
                  onChange={(v) => patchForm({ command: v })}
                  placeholder="npx"
                  testing={testing}
                  disabled={busy}
                  onTest={() => void testConnection()}
                />
                <Textarea
                  size="sm"
                  mono
                  label={S.agent.mcpArgs}
                  hint={S.agent.mcpArgsHint}
                  rows={3}
                  value={form.argsText}
                  onChange={(e) => patchForm({ argsText: e.target.value })}
                  placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
                />
                <Textarea
                  size="sm"
                  mono
                  label={S.agent.mcpEnv}
                  hint={S.agent.mcpEnvHint}
                  error={errorText(fieldErrors.env)}
                  rows={2}
                  value={form.envText}
                  onChange={(e) => patchForm({ envText: e.target.value })}
                  placeholder="API_TOKEN=..."
                />
                <Input
                  size="sm"
                  label={S.agent.mcpCwd}
                  hint={S.agent.mcpCwdHint}
                  value={form.cwd}
                  onChange={(e) => patchForm({ cwd: e.target.value })}
                  className="font-mono"
                  autoComplete="off"
                />
              </>
            ) : (
              <>
                <InFieldTest
                  label={S.agent.mcpUrl}
                  required
                  error={errorText(fieldErrors.url)}
                  value={form.url}
                  onChange={(v) => patchForm({ url: v })}
                  placeholder="https://example.com/mcp"
                  testing={testing}
                  disabled={busy}
                  onTest={() => void testConnection()}
                />
                <Textarea
                  size="sm"
                  mono
                  label={S.agent.mcpHeaders}
                  hint={S.agent.mcpHeadersHint}
                  error={errorText(fieldErrors.headers)}
                  rows={2}
                  value={form.headersText}
                  onChange={(e) => patchForm({ headersText: e.target.value })}
                  placeholder="Authorization: Bearer ..."
                />
              </>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Input
                size="sm"
                label={S.agent.mcpConnectTimeout}
                error={errorText(fieldErrors.connectTimeoutMs)}
                value={form.connectTimeoutMs}
                inputMode="numeric"
                onChange={(e) => patchForm({ connectTimeoutMs: e.target.value })}
                className="font-mono"
                autoComplete="off"
              />
              <Input
                size="sm"
                label={S.agent.toolTimeout}
                error={errorText(fieldErrors.timeoutMs)}
                value={form.timeoutMs}
                inputMode="numeric"
                onChange={(e) => patchForm({ timeoutMs: e.target.value })}
                className="font-mono"
                autoComplete="off"
              />
              <Input
                size="sm"
                label={S.agent.toolMaxOutput}
                error={errorText(fieldErrors.maxOutputLength)}
                value={form.maxOutputLength}
                inputMode="numeric"
                onChange={(e) => patchForm({ maxOutputLength: e.target.value })}
                className="font-mono"
                autoComplete="off"
              />
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">{S.agent.mcpBudgetsHint}</p>
            {testResult && (
              <p
                className={
                  testResult.ok
                    ? "text-xs text-green-700 dark:text-green-400"
                    : "text-xs text-red-600 dark:text-red-400"
                }
              >
                {testResult.text}
              </p>
            )}
            {modalError && <p className="text-xs text-red-600 dark:text-red-400">{modalError}</p>}
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={deleting !== null}
        title={S.agent.mcpDeleteTitle}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.agent.mcpDeleteConfirm(servers[deleting]?.name ?? "") : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
