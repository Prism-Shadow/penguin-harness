/**
 * Tools tab's "MCP Server" block: a table of configured servers (name / transport /
 * target) with vault-style immediate persistence — Add/Edit happens in a modal whose
 * fields follow the chosen transport, deletion sits behind a confirmation. Every
 * operation PUTs the whole `mcpServers` list through the config route; the server
 * re-validates each entry via the core transport resolver, so a rejected save surfaces
 * inside the modal instead of half-applying.
 *
 * Connectivity testing mirrors the models page: the modal carries a standalone
 * "test connection" button in a top action row (result as a toast, tool count +
 * latency — the models dialog idiom), and the section header offers a bulk test that
 * probes every configured server sequentially behind a confirm dialog, writing a
 * tone-colored badge onto each row as its result lands (the group speed-test idiom).
 */
import { useState } from "react";
import type { MCPServerConfig, ToolExposure } from "@prismshadow/penguin-core/interfaces";
import * as api from "../../api/endpoints";
import type { McpServerTestResponse } from "@prismshadow/penguin-server/api";
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
  transportOf,
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
    case "duplicate":
      return S.agent.mcpDuplicateName;
  }
}

/** Table cell summary: the spawn line for stdio, the URL for http/sse. */
function targetOf(entry: MCPServerConfig): string {
  const c = entry.config;
  if (typeof c["url"] === "string") return c["url"];
  const command = typeof c["command"] === "string" ? c["command"] : "";
  const args = Array.isArray(c["args"]) ? c["args"].map((a) => String(a)).join(" ") : "";
  return args ? `${command} ${args}` : command;
}

/** One row's bulk-test outcome ("pending" while its turn runs). */
type RowTestResult = McpServerTestResponse | "pending";

/** Row badge for the bulk test (the model card's speed-badge idiom: small, tone-colored, reason on hover). */
function TestBadge({ result }: { result: RowTestResult | undefined }) {
  if (result === undefined) return null;
  if (result === "pending") {
    return (
      <span className="text-[11px] whitespace-nowrap text-gray-400">{S.agent.mcpTestPending}</span>
    );
  }
  if (result.ok) {
    return (
      <span className="text-[11px] font-medium whitespace-nowrap text-emerald-600 dark:text-emerald-400">
        {S.agent.mcpTestBadge(result.tools?.length ?? 0, result.latencyMs)}
      </span>
    );
  }
  return (
    <span
      title={result.error}
      className="text-[11px] font-medium whitespace-nowrap text-red-600 dark:text-red-400"
    >
      {S.agent.mcpTestBadgeFail}
    </span>
  );
}

export function McpServersSection({
  agentId,
  initial,
  initialExposure,
}: {
  agentId: string;
  initial: MCPServerConfig[];
  initialExposure: ToolExposure;
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;

  const [servers, setServers] = useState<MCPServerConfig[]>(initial);
  const [exposure, setExposure] = useState<ToolExposure>(initialExposure);
  const [busy, setBusy] = useState(false);
  // Modal state: editIndex null = adding, a number = editing that row; closed when form is null.
  const [form, setForm] = useState<McpServerFormState | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<McpFormField, McpFormError>>>({});
  // Server-side rejection (transport validation 400) rendered at the modal's foot.
  const [modalError, setModalError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  // Connectivity probe: runs the current form state through POST /config/mcp-test
  // (server-side connect + discovery, nothing saved); the result pops as a toast.
  const [testing, setTesting] = useState(false);
  // Bulk test: confirm dialog open / run in progress / per-row results keyed by server name.
  const [testAllOpen, setTestAllOpen] = useState(false);
  const [testAllRunning, setTestAllRunning] = useState(false);
  const [rowResults, setRowResults] = useState<Map<string, RowTestResult>>(new Map());

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

  /** Exposure is Agent-wide and persists independently of the MCP server rows. */
  const persistExposure = async (next: ToolExposure): Promise<void> => {
    if (!projectId || !agentId || busy || next === exposure) return;
    setBusy(true);
    try {
      const res = await api.putAgentConfig(projectId, agentId, {
        config: { toolExposure: next },
      });
      setExposure(res.config.toolExposure);
      toastSuccess(S.common.saved);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const openAdd = () => {
    setForm(emptyMcpForm());
    setEditIndex(null);
    setFieldErrors({});
    setModalError(null);
  };

  const openEdit = (index: number) => {
    const entry = servers[index];
    if (!entry) return;
    setForm(serverToForm(entry));
    setEditIndex(index);
    setFieldErrors({});
    setModalError(null);
  };

  const closeModal = () => {
    setForm(null);
    setEditIndex(null);
  };

  const patchForm = (patch: Partial<McpServerFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setFieldErrors({});
    setModalError(null);
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
    try {
      const res = await api.testAgentMcpServer(projectId, agentId, built.server);
      if (res.ok) toastSuccess(S.agent.mcpTestOk(res.tools?.length ?? 0, res.latencyMs));
      else toastError(S.agent.mcpTestFail(res.error ?? S.common.unknownError));
    } catch (e) {
      toastError(S.agent.mcpTestFail(apiErrorText(e)));
    } finally {
      setTesting(false);
    }
  };

  /**
   * Bulk test (section-level): every configured server through the same probe, strictly
   * sequential — parallel probes would spawn every stdio child at once — with each row's
   * badge updating as its result lands.
   */
  const runTestAll = async () => {
    if (!projectId) return;
    setTestAllRunning(true);
    try {
      for (const entry of servers) {
        setRowResults((prev) => new Map(prev).set(entry.name, "pending"));
        let result: McpServerTestResponse;
        try {
          result = await api.testAgentMcpServer(projectId, agentId, entry);
        } catch (e) {
          result = { ok: false, error: apiErrorText(e) };
        }
        setRowResults((prev) => new Map(prev).set(entry.name, result));
      }
    } finally {
      setTestAllRunning(false);
    }
  };

  const submitModal = async () => {
    if (!form) return;
    const built = formToServer(form);
    if (!built.ok) {
      setFieldErrors(built.errors);
      return;
    }
    // Same-name collision against the other rows (the edited row may keep its own name);
    // rendered under the name field itself, like every other validation error.
    const clash = servers.some((s, i) => i !== editIndex && s.name === built.server.name);
    if (clash) {
      setFieldErrors({ name: { code: "duplicate" } });
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

  // The form's target field (command / url) — the same gate the models dialog uses for its
  // test button (disabled until the identity is filled in).
  const targetFilled =
    form !== null &&
    (form.transport === "stdio" ? form.command.trim() !== "" : form.url.trim() !== "");
  const showBadges = rowResults.size > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-md border border-gray-200 p-3 dark:border-gray-800">
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {S.agent.toolExposure}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {exposure === "lazy"
              ? S.agent.toolExposureLazyHint
              : exposure === "auto"
                ? S.agent.toolExposureAutoHint
                : S.agent.toolExposureDirectHint}
          </p>
        </div>
        <div className="w-60 shrink-0">
          <Segmented
            cols={3}
            options={[
              { value: "direct", label: S.agent.toolExposureDirect },
              { value: "auto", label: S.agent.toolExposureAuto },
              { value: "lazy", label: S.agent.toolExposureLazy },
            ]}
            value={exposure}
            onChange={(next) => void persistExposure(next)}
          />
        </div>
      </div>

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
                {/* Bulk-test badge column appears only once results exist (no headline). */}
                {showBadges && <th className="px-3 py-2.5" />}
                {/* Bulk test lives in the table's own header bar, over the actions column. */}
                <th className="px-3 py-1 text-right font-normal whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || testAllRunning}
                    onClick={() => setTestAllOpen(true)}
                  >
                    {testAllRunning ? S.agent.mcpTestPending : S.agent.mcpTest}
                  </Button>
                </th>
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
                    {transportOf(entry)}
                  </td>
                  <td className="max-w-[360px] truncate px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {targetOf(entry)}
                  </td>
                  {showBadges && (
                    <td className="px-3 py-2 text-right">
                      <TestBadge result={rowResults.get(entry.name)} />
                    </td>
                  )}
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
                <Input
                  size="sm"
                  label={S.agent.mcpCommand}
                  required
                  error={errorText(fieldErrors.command)}
                  value={form.command}
                  onChange={(e) => patchForm({ command: e.target.value })}
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
                <Input
                  size="sm"
                  label={S.agent.mcpUrl}
                  required
                  error={errorText(fieldErrors.url)}
                  value={form.url}
                  onChange={(e) => patchForm({ url: e.target.value })}
                  className="font-mono"
                  placeholder="https://example.com/mcp"
                  autoComplete="off"
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
            {modalError && <p className="text-xs text-red-600 dark:text-red-400">{modalError}</p>}
          </div>
        )}
      </Modal>

      {/* Bulk-test confirm (the group speed-test idiom): explain what will run, then go. */}
      <Modal
        open={testAllOpen}
        title={S.agent.mcpTest}
        onClose={() => setTestAllOpen(false)}
        footer={
          <>
            <Button onClick={() => setTestAllOpen(false)}>{S.common.cancel}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setTestAllOpen(false);
                void runTestAll();
              }}
            >
              {S.agent.mcpTestAllStart}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.agent.mcpTestAllConfirm(servers.length)}
        </p>
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
