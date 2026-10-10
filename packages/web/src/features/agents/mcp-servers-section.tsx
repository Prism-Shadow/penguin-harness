/**
 * Tools tab's "MCP Server" block: a table of configured servers (name / transport /
 * target) with vault-style immediate persistence — Add/Edit happens in a dialog whose
 * fields follow the chosen transport (mcp-server-dialog.tsx), deletion sits behind a
 * confirmation. Every operation PUTs the whole `mcpServers` list through the config route;
 * the server re-validates each entry via the core transport resolver, so a rejected save
 * surfaces inside the dialog instead of half-applying.
 *
 * Connectivity testing mirrors the models page: the dialog carries a standalone
 * "test connection" button (result as a toast, tool count + latency — the models dialog
 * idiom), and the section header offers a bulk test that probes every configured server
 * sequentially behind a confirm dialog, writing a tone-colored badge onto each row as its
 * result lands (the group speed-test idiom).
 *
 * The permission control mirrors the builtin tool table's, with a third `auto` state: it
 * decides which of the server's tool calls stop for approval, and nothing about what the
 * remote server is able to do.
 */
import { useState } from "react";
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";
import {
  Button,
  ConfirmModal,
  InfoPopover,
  Modal,
  SettingsEmpty,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toastError,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import type { McpServerTestResponse } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { permissionOf, transportOf } from "./mcp-servers-form";
import { McpServerDialog } from "./mcp-server-dialog";
import { toneInk } from "../../lib/tone";

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
      <span className="text-xs whitespace-nowrap text-gray-400">{S.agent.mcpTestPending}</span>
    );
  }
  if (result.ok) {
    return (
      <span className={`text-xs font-medium whitespace-nowrap ${toneInk.success}`}>
        {S.agent.mcpTestBadge(result.tools?.length ?? 0, result.latencyMs)}
      </span>
    );
  }
  return (
    <span
      data-tooltip={result.error}
      className={`text-xs font-medium whitespace-nowrap ${toneInk.danger}`}
    >
      {S.agent.mcpTestBadgeFail}
    </span>
  );
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
  // The add / edit dialog: null closed, `index` null adding, a number editing that row.
  const [dialog, setDialog] = useState<{ index: number | null } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  // Bulk test: confirm dialog open / run in progress / per-row results keyed by server name.
  const [testAllOpen, setTestAllOpen] = useState(false);
  const [testAllRunning, setTestAllRunning] = useState(false);
  const [rowResults, setRowResults] = useState<Map<string, RowTestResult>>(new Map());

  /** Persist the full list (immediate, vault-style); returns null on success or an error message. */
  const persist = async (next: MCPServerConfig[]): Promise<string | null> => {
    if (!projectId || !agentId) return S.common.unknownError;
    setBusy(true);
    try {
      const res = await api.putAgentConfig(projectId, agentId, {
        config: { mcpServers: next },
      });
      setServers(res.config.mcpServers);
      toastSuccess(S.agent.savedTakesEffect);
      return null;
    } catch (e) {
      return apiErrorText(e);
    } finally {
      setBusy(false);
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

  /** The dialog's write: the entry added, or put in place of the row it edits. */
  const submitEntry = (index: number | null, server: MCPServerConfig) =>
    persist(
      index === null ? [...servers, server] : servers.map((s, i) => (i === index ? server : s)),
    );

  const confirmDelete = async () => {
    if (deleting === null) return;
    const err = await persist(servers.filter((_, i) => i !== deleting));
    if (err !== null) toastError(err);
    setDeleting(null);
  };

  if (!projectId) return null;

  const showBadges = rowResults.size > 0;

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
        {S.agent.mcpServers}
        <InfoPopover label={S.agent.mcpServers}>{S.agent.mcpDesc}</InfoPopover>
      </p>

      {servers.length === 0 ? (
        <SettingsEmpty>{S.agent.mcpEmpty}</SettingsEmpty>
      ) : (
        <Table tableClassName="min-w-[520px]">
          <TableHead>
            <TableHeaderCell>{S.agent.mcpName}</TableHeaderCell>
            <TableHeaderCell>{S.agent.mcpTransport}</TableHeaderCell>
            <TableHeaderCell>{S.agent.mcpPermission}</TableHeaderCell>
            <TableHeaderCell>{S.agent.mcpTarget}</TableHeaderCell>
            {/* Bulk-test badge column appears only once results exist (no headline). */}
            {showBadges && <TableHeaderCell />}
            {/* Bulk test lives in the table's own header bar, over the actions column: a
                tighter cell than a column name's, so the button does not heighten the bar. */}
            <th scope="col" className="px-3 py-1 text-right font-normal whitespace-nowrap">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || testAllRunning}
                onClick={() => setTestAllOpen(true)}
              >
                {testAllRunning ? S.agent.mcpTestPending : S.agent.mcpTest}
              </Button>
            </th>
          </TableHead>
          <TableBody>
            {servers.map((entry, index) => (
              <TableRow key={entry.name}>
                <TableCell className="font-mono text-xs">{entry.name}</TableCell>
                <TableCell className="font-mono text-xs text-gray-500 dark:text-gray-400">
                  {transportOf(entry)}
                </TableCell>
                <TableCell className="font-mono text-xs text-gray-500 dark:text-gray-400">
                  {permissionOf(entry)}
                </TableCell>
                <TableCell className="max-w-[360px] truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                  {targetOf(entry)}
                </TableCell>
                {showBadges && (
                  <TableCell align="right">
                    <TestBadge result={rowResults.get(entry.name)} />
                  </TableCell>
                )}
                <TableCell align="right" nowrap>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setDialog({ index })}
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        onClick={() => setDialog({ index: null })}
      >
        {S.agent.mcpAdd}
      </Button>

      {/* Mounted only while open, and keyed by the row: every opening starts from its entry. */}
      {dialog !== null && (
        <McpServerDialog
          key={dialog.index ?? "new"}
          entry={dialog.index === null ? null : (servers[dialog.index] ?? null)}
          takenNames={servers.filter((_, i) => i !== dialog.index).map((s) => s.name)}
          projectId={projectId}
          agentId={agentId}
          onSubmit={(server) => submitEntry(dialog.index, server)}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Bulk-test confirm (the group speed-test idiom): explain what will run, then go. */}
      <Modal
        open={testAllOpen}
        title={S.agent.mcpTest}
        onClose={() => setTestAllOpen(false)}
        footer={
          <>
            <Button size="sm" onClick={() => setTestAllOpen(false)}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
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
        confirmLabel={S.common.delete}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {deleting !== null ? S.agent.mcpDeleteConfirm(servers[deleting]?.name ?? "") : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
