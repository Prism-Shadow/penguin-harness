import { S } from "@prismshadow/penguin-web/internal";
import { apiErrorText } from "@prismshadow/penguin-web/internal";
import { useLocale } from "@prismshadow/penguin-web/internal";
import { useProject } from "@prismshadow/penguin-web/internal";
import { localizedText } from "@prismshadow/penguin-web/internal";
import { McpServerMarks } from "@prismshadow/penguin-web/internal";

import { permissionOf, transportOf } from "./mcp-servers-form";
import { McpServerDialog } from "./mcp-server-dialog";
import { toneInk } from "@prismshadow/penguin-web/internal";

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
  // The row changed on disk since the list was read: nothing was tested, nothing failed.
  if (result.saveFirst === true) {
    return (
      <span
        data-tooltip={S.agent.mcpTestSaveFirst}
        data-tooltip-extra
        data-tooltip-content="text"
        className="text-xs whitespace-nowrap text-fg-muted"
      >
        {S.agent.mcpTestSaveFirstBadge}
      </span>
    );
  }
  return (
    <span
      data-tooltip={result.error}
      data-tooltip-extra
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
  const permissionNames = {
    auto: S.agent.mcpPermissionAuto,
    r: S.agent.permissionReadLabel,
    rw: S.agent.permissionReadWriteLabel,
  };
  const { currentProject } = useProject();
  const { locale } = useLocale();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  /** The machine the Agent lives on (null: this server): its servers, probes and library. */
  const machineId = useAgentLocation();

  const [servers, setServers] = useState<MCPServerConfig[]>(initial);
  /** What keeps each server from connecting, by name, as the server reads it. */
  const [status, setStatus] = useState<ReadonlyMap<string, AgentMcpServerItem>>(new Map());
  /** Plugin name → its title in the UI language, for the provenance marks; a plugin not in the library shows its name. */
  const [pluginTitles, setPluginTitles] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  // The add / edit dialog: null closed, `index` null adding, a number editing that row.
  const [dialog, setDialog] = useState<{ index: number | null } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  // Bulk test: confirm dialog open / run in progress / per-row results keyed by server name.
  const [testAllOpen, setTestAllOpen] = useState(false);
  const [testAllRunning, setTestAllRunning] = useState(false);
  const [rowResults, setRowResults] = useState<Map<string, RowTestResult>>(new Map());

  /** Reads the servers' state again: what each waits for moved with the list (or the vault). */
  const reloadStatus = useCallback(() => {
    if (!projectId || !agentId) return;
    api.getAgentMcpServers(projectId, agentId, machineId).then(
      (res) => setStatus(new Map(res.servers.map((server) => [server.name, server]))),
      () => setStatus(new Map()),
    );
  }, [projectId, agentId, machineId]);
  useEffect(reloadStatus, [reloadStatus]);

  // The library, once, for the titles of the plugins that installed servers here.
  const hasPluginEntries = servers.some((entry) => entry.plugin !== undefined);
  useEffect(() => {
    if (!hasPluginEntries) return;
    let cancelled = false;
    api.getPluginLibrary(machineId).then(
      (res) => {
        if (cancelled) return;
        const titles = new Map<string, string>();
        for (const plugin of res.groups.flatMap((group) => group.plugins)) {
          titles.set(
            plugin.name,
            localizedText(locale, plugin.title || plugin.name, plugin.titleZh),
          );
        }
        setPluginTitles(titles);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [hasPluginEntries, locale, machineId]);
  const pluginTitle = (name: string) => pluginTitles.get(name) ?? name;

  /** Persist the full list (immediate, vault-style); returns null on success or an error message. */
  const persist = async (next: MCPServerConfig[]): Promise<string | null> => {
    if (!projectId || !agentId) return S.common.unknownError;
    setBusy(true);
    try {
      const res = await api.putAgentConfig(
        projectId,
        agentId,
        { config: { mcpServers: next } },
        machineId,
      );
      setServers(res.config.mcpServers);
      reloadStatus();
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
          result = await api.testAgentMcpServer(projectId, agentId, entry, machineId);
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
  const waiting = (name: string) => {
    const state = status.get(name);
    return state !== undefined && (state.missingKeys.length > 0 || state.signIn);
  };
  const showStatus = servers.some((entry) => waiting(entry.name));

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
            {/* What a server waits for (vault keys, a sign-in): a column only while one does (no headline). */}
            {showStatus && <TableHeaderCell />}
            {/* Bulk-test badge column appears only once results exist (no headline). */}
            {showBadges && <TableHeaderCell />}
            {/* Bulk test lives in the table's own header bar, over the actions column: a
                tighter cell than a column name's, so the button does not heighten the bar. It
                tests every row, so it says so — with the plug glyph and "Test all" — rather than
                reading as the title of a column whose rows carry no test of their own (a single
                server is tested from its edit dialog). */}
            <th scope="col" className="px-3 py-1 text-right font-normal whitespace-nowrap">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || testAllRunning}
                onClick={() => setTestAllOpen(true)}
              >
                <GlyphIcon d={ICONS.plug} size={ICON_SIZE.iconButton} />
                {testAllRunning ? S.agent.mcpTestPending : S.agent.mcpTestAll}
              </Button>
            </th>
          </TableHead>
          <TableBody>
            {servers.map((entry, index) => (
              <TableRow key={entry.name}>
                <TableCell nowrap className="font-mono text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    {entry.name}
                    {entry.plugin !== undefined && (
                      <span
                        role="img"
                        aria-label={S.agent.mcpInstalledBy(pluginTitle(entry.plugin))}
                        data-tooltip={S.agent.mcpInstalledBy(pluginTitle(entry.plugin))}
                        data-tooltip-content="text"
                        className="inline-flex text-fg-subtle"
                      >
                        <GlyphIcon d={ICONS.puzzle} size={ICON_SIZE.inlineGlyph} />
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs text-gray-500 dark:text-gray-400">
                  {transportOf(entry)}
                </TableCell>
                <TableCell className="text-xs text-gray-500 dark:text-gray-400">
                  {permissionNames[permissionOf(entry)]}
                </TableCell>
                {/* The target takes the width the other columns leave and truncates in it: a
                    max-width of 0 keeps the URL's own length out of the column sizing, and the
                    100% width hands this column the remainder, so a long URL never pushes the
                    status marks or the actions out of view. */}
                <TableCell className="w-full max-w-0 font-mono text-xs text-gray-500 dark:text-gray-400">
                  <span
                    className="block truncate"
                    data-tooltip={targetOf(entry)}
                    data-tooltip-content="code"
                  >
                    {targetOf(entry)}
                  </span>
                </TableCell>
                {showStatus && (
                  <TableCell align="right">
                    {waiting(entry.name) && (
                      <McpServerMarks
                        keys={status.get(entry.name)?.missingKeys ?? []}
                        where={isOwner ? S.plugins.mcpSetUpWhere : S.plugins.mcpSetUpByOwner}
                        signIn={status.get(entry.name)?.signIn ?? false}
                      />
                    )}
                  </TableCell>
                )}
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
          pluginTitle={pluginTitle}
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
        {deleting !== null && servers[deleting]?.plugin !== undefined && (
          <p className="mt-2 text-xs text-fg-muted">
            {S.agent.mcpRemoveFromPlugin(pluginTitle(servers[deleting]!.plugin!))}
          </p>
        )}
      </ConfirmModal>
    </div>
  );
}
