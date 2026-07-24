/**
 * Model config page.
 *
 * Model entries are persisted as two independent fields, `provider` and `model_id`;
 * the (provider, model_id) pair is the entry's unique key — **zero
 * concatenation** anywhere in the pipeline, `model_id` is sent to AgentHub verbatim as the
 * upstream request id. The dialog's identity section = (group dropdown, upstream id input);
 * changing either one is a rename, submitted as a paired `renamedFrom` (the server uses it
 * to migrate the credential and pointers).
 *
 * The list is purely for "finding a model": grouped by vendor (group header = logo + vendor
 * name + count, collapsible), with one card per model within a group — the card shows only
 * the display name + upstream id + status badges (default / vision / proxy-read), while
 * context, pricing, and key status are folded into a single line of small text. Clicking a
 * card opens the config dialog (credentials, context, pricing, vision toggle, plus set as
 * default / set as vision model / delete); the "add model" entry point lives in each group
 * header (owner only) and reuses the same dialog — provider is pre-filled with that group;
 * the protocol follows group semantics: a first-party vendor group doesn't persist
 * client_type (AgentHub auto-routes by upstream id, with env fallback resolved live from the
 * id), while custom / user-defined groups / gateways use a fixed OpenAI protocol, and
 * gateways (OpenRouter / SiliconFlow / Qwen Token Plan) additionally pre-fill their endpoint
 * base URL; the "get model id / API key" external links sit next to the corresponding
 * input's label (shown in both add and edit dialogs). The group list ends with an "add
 * group" action (user-defined groups share custom's semantics; the group appears once the
 * first model saves successfully — groups are carried by the model entry's provider field,
 * not persisted separately). The header also holds an owner-only "sync presets" action next
 * to the search box (union-merge with the built-in catalog, see catalog-sync.ts).
 *
 * Saving does a PUT full-table replace (models not present are deleted; an empty apiKey
 * means keep the existing value); only the owner can edit.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CredentialInfo,
  ModelRefDto,
  ModelsResponse,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelUpdateEntry,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useProject } from "../../state/project";
import { useAuth } from "../../state/auth";
import { USD_TO_CNY, useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { FieldError, FieldLabel } from "../../components/ui/field";
import { PasswordInput } from "../../components/ui/password-input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";
import { Badge } from "../../components/ui/badge";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ProviderLogo } from "../../components/ui/provider-logo";
import { SkeletonList } from "../../components/ui/skeleton";
import { EmptyState } from "../../components/ui/empty-state";
import { formatDateTime, humanizeTokens } from "../../lib/format";
import {
  MODEL_PROVIDERS,
  catalogEntryFor,
  modelHomepageUrl,
  providerInfo,
  resolveModelEnv,
} from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import { groupModelRows, sameModelRef, userProviderInfo } from "./model-grouping";
import { draftKey, loadDraft, saveDraft } from "../chat/draft-cache";
import { syncRowsWithCatalog } from "./catalog-sync";
import { tpsTone, ttftTone } from "./speed-test";
import type { SpeedResult, SpeedTone } from "./speed-test";

/** Display currency follows the user setting (pricing is always stored in USD/million tokens; conversion happens only for display and input). */
const CURRENCY_SYMBOL: Record<Currency, string> = { USD: "$", CNY: "¥" };

/** Trailing-zero-trimmed price storage value (keeps up to 6 decimal places, for USD persistence). */
function trimNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return String(Math.round(v * 1e6) / 1e6);
}

/** Trailing-zero-trimmed display/input value (keeps up to 4 decimal places): absorbs floating-point noise from USD<->CNY(x7) round trips. */
function trim4(v: number): string {
  if (!Number.isFinite(v)) return "0";
  return String(Math.round(v * 1e4) / 1e4);
}

/** USD/million-token string -> display string in the selected currency (with symbol). */
function displayPrice(usdStr: string, currency: Currency): string {
  const n = Number(usdStr || "0");
  const v = currency === "CNY" ? n * USD_TO_CNY : n;
  return `${CURRENCY_SYMBOL[currency]}${trim4(v)}`;
}

/** USD storage string -> input string in the selected currency (for edit-form initialization; empty value passes through). */
function usdToInput(usdStr: string, currency: Currency): string {
  const t = usdStr.trim();
  if (!t) return "";
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return currency === "CNY" ? trim4(n * USD_TO_CNY) : trim4(n);
}

/** Input string in the selected currency -> USD storage string (converted before submit; empty/invalid passes through). */
function inputToUsd(inputStr: string, currency: Currency): string {
  const t = inputStr.trim();
  if (!t) return "";
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return currency === "CNY" ? trimNum(n / USD_TO_CNY) : trimNum(n);
}

/** Group-header action glyphs (24x24 line paths): add, bulk key, gauge for speed test. */
const PLUS_ICON = "M12 5v14M5 12h14";
const KEY_ICON =
  "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4";

/** Speed-test glyphs (24x24 line paths): gauge for the group action, clock = TTFT, zap = TPS. */
const GAUGE_ICON = "M12 14l3.5-3.5M20.49 17A10 10 0 1 0 3.5 17";
const CLOCK_ICON = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 7v5l3.5 2";
const ZAP_ICON = "M13 2 3 14h9l-1 8 10-12h-9l1-8Z";

/** Metric tone -> text color classes for the card speed badges. */
const TONE_CLASS: Record<SpeedTone, string> = {
  green: "text-green-600 dark:text-green-400",
  yellow: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
};

/** In-page key for one model's speed result. */
const speedKey = (provider: string, modelId: string) => `${provider}\u0000${modelId}`;

/** Default context window (tokens) for custom models when left unset. */
const CUSTOM_CONTEXT_DEFAULT = 128000;

/** Numeric input filter: context window keeps digits only. */
export function digitsOnly(v: string): string {
  return v.replace(/[^\d]/g, "");
}

/** Numeric input filter: pricing keeps digits and **at most one** decimal point. */
export function decimalOnly(v: string): string {
  const cleaned = v.replace(/[^\d.]/g, "");
  const i = cleaned.indexOf(".");
  return i === -1 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, "");
}

/** Local edit state for one model row (string-typed for form use; parsed uniformly on save). */
export interface RowState {
  /**
   * Vendor id (entry field, i.e. group membership): a value not in the catalog list is a
   * user-defined group, kept **verbatim** — an operation that only edits the key,
   * for instance, must not silently rewrite it to custom; each forms its own group when
   * displayed (see model-grouping).
   */
  provider: string;
  /** Upstream model id (i.e. the stored model_id, sent to AgentHub verbatim). */
  modelId: string;
  /**
   * The identity as loaded (paired reference): differing from the current (provider,
   * modelId) in either field means a rename — submitted as a paired renamedFrom, which the
   * server uses to migrate the credential and pointers. null for a new entry.
   */
  original: ModelRefDto | null;
  /** Display name from the built-in catalog; absent for custom models. */
  displayName?: string;
  /**
   * Whether to treat this as a vision model (effective semantics): the server already
   * resolves this via "TOML vision annotation -> built-in catalog -> default support";
   * preset models are annotated by the catalog, custom models are editable (supported by
   * default).
   */
  vision: boolean;
  /** Environment variable name used as fallback when api_key is empty (given by the server based on catalog/protocol). */
  envKey?: string;
  contextWindow: string;
  /** Per-model max output tokens ("" = inherit the Agent setting): caps output per request; user-only, never preset by the catalog. */
  maxTokens: string;
  /** AgentHub client protocol: defaults for preset models (auto-routed), "openai" for new custom models; kept as-is, not user-editable. */
  clientType: string;
  cacheRead: string;
  cacheWrite: string;
  output: string;
  /** Current base_url input; compared against originalBaseUrl to decide omit/override/clear (null). */
  baseUrl: string;
  originalBaseUrl: string;
  /** Newly entered API key; empty means keep the existing value. */
  apiKeyInput: string;
  clearApiKey: boolean;
  credential?: CredentialInfo;
}

/** The row's current paired reference (the config's unique key). */
export function rowRef(row: Pick<RowState, "provider" | "modelId">): ModelRefDto {
  return { provider: row.provider, modelId: row.modelId };
}

/**
 * After saving a model config, which entries the defaultModel / visionModel pointers should
 * point to (always paired references).
 *
 * The key case is a **rename** (either provider or model_id changes): if a pointer still
 * points at the old reference, what gets submitted is a reference no longer present in
 * models, and the server responds with a flat 400 (it validates that defaultModel/
 * visionModel must be in models).
 */
export function nextPointers(args: {
  /** The paired reference being edited; null for a new model. */
  editing: ModelRefDto | null;
  /** The paired reference after saving (differing from editing in either field means a rename). */
  ref: ModelRefDto;
  action: DialogAction;
  defaultModel: ModelRefDto | undefined;
  visionModel: ModelRefDto | undefined;
}): { defaultModel: ModelRefDto | undefined; visionModel: ModelRefDto | undefined } {
  const { editing, ref, action, defaultModel, visionModel } = args;
  const isNew = editing === null;
  const renamedFrom = !isNew && !sameModelRef(editing, ref) ? editing : null;
  const follow = (p: ModelRefDto | undefined) => (sameModelRef(p, renamedFrom) ? ref : p);
  return {
    defaultModel:
      action === "setDefault"
        ? ref
        : // The first model added (when there was no previous default) is auto-set as default.
          isNew && !defaultModel
          ? ref
          : follow(defaultModel),
    visionModel: action === "setVisionModel" ? ref : follow(visionModel),
  };
}

/** Fields in the config dialog that can be highlighted red on error (keys match RowState field names, so they can be cleared per edit action). */
type FieldErrors = Partial<
  Record<
    "modelId" | "baseUrl" | "contextWindow" | "maxTokens" | "cacheRead" | "cacheWrite" | "output",
    string
  >
>;

/**
 * Preset model (present in the built-in catalog): id and vision annotation are read-only,
 * only credentials/pricing/context are configurable. Determined by the built-in catalog
 * (not by vendor group): a model added via a group header belongs to that vendor group but
 * isn't in the catalog, so it's still treated as a custom model when edited (vision is
 * checkable, base URL is required, an empty context falls back to the default). Matches
 * the catalog using the **identity as loaded** (original's paired reference).
 */
function isPreset(row: RowState): boolean {
  return (
    row.original !== null &&
    catalogEntryFor(row.original.provider, row.original.modelId) !== undefined
  );
}

/** Whether this row already has (or will have, after this edit) an API key configured. */
function hasKey(row: RowState): boolean {
  return (
    !row.clearApiKey && (Boolean(row.apiKeyInput.trim()) || Boolean(row.credential?.apiKeyMasked))
  );
}

/** DTO -> row edit state (exported for unit tests): provider and modelId are both entry fields, never decomposed. */
export function toRow(m: ModelsResponse["models"][number]): RowState {
  const row: RowState = {
    provider: m.provider,
    modelId: m.modelId,
    original: { provider: m.provider, modelId: m.modelId },
    vision: m.vision !== false,
    contextWindow: m.contextWindow !== undefined ? String(m.contextWindow) : "",
    maxTokens: m.maxTokens !== undefined ? String(m.maxTokens) : "",
    clientType: m.clientType ?? "",
    cacheRead: m.pricing ? String(m.pricing.cacheRead) : "",
    cacheWrite: m.pricing ? String(m.pricing.cacheWrite) : "",
    output: m.pricing ? String(m.pricing.output) : "",
    baseUrl: m.credential?.baseUrl ?? "",
    originalBaseUrl: m.credential?.baseUrl ?? "",
    apiKeyInput: "",
    clearApiKey: false,
  };
  if (m.displayName !== undefined) row.displayName = m.displayName;
  if (m.envKey !== undefined) row.envKey = m.envKey;
  if (m.credential) row.credential = m.credential;
  return row;
}

function rowToEntry(row: RowState): ModelUpdateEntry {
  // provider and modelId are always submitted as separate fields ((provider, modelId) is the entry's unique key, no concatenation).
  const entry: ModelUpdateEntry = { provider: row.provider, modelId: row.modelId };
  // Rename (either provider or model_id changing is a key change): include the original paired reference so the server
  // migrates the credential and unknown fields (otherwise a full-table replace would drop them).
  if (row.original && !sameModelRef(row.original, rowRef(row))) {
    entry.renamedFrom = row.original;
  }
  // Display name: the server only persists it when it differs from the built-in catalog (keeps preset model configs clean).
  if (row.displayName?.trim()) entry.displayName = row.displayName.trim();
  const cw = Number(row.contextWindow.trim());
  if (row.contextWindow.trim() && Number.isFinite(cw)) entry.contextWindow = cw;
  if (row.clientType.trim()) entry.clientType = row.clientType.trim();
  // Supported by default: submit false only when explicitly marked "unsupported" (preset vision models and checked custom models aren't persisted).
  if (!row.vision) entry.vision = false;
  // Output cap ("" = inherit the Agent setting): submitted only when filled; omitting clears the stored annotation.
  const mt = Number(row.maxTokens.trim());
  if (row.maxTokens.trim() && Number.isFinite(mt) && mt > 0) entry.maxTokens = mt;
  const cr = Number(row.cacheRead.trim());
  const cwr = Number(row.cacheWrite.trim());
  const out = Number(row.output.trim());
  if (
    row.cacheRead.trim() &&
    row.cacheWrite.trim() &&
    row.output.trim() &&
    Number.isFinite(cr) &&
    Number.isFinite(cwr) &&
    Number.isFinite(out)
  ) {
    entry.pricing = { cacheRead: cr, cacheWrite: cwr, output: out };
  }
  if (row.apiKeyInput.trim()) entry.apiKey = row.apiKeyInput.trim();
  if (row.clearApiKey) entry.clearApiKey = true;
  const baseUrl = row.baseUrl.trim();
  if (baseUrl !== row.originalBaseUrl) {
    // Submit only on change: non-empty overrides, empty explicitly sets null to clear.
    entry.baseUrl = baseUrl ? baseUrl : null;
  }
  return entry;
}

export function ModelsPage() {
  useDocumentTitle(S.models.title);
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  const userId = useAuth().user?.userId ?? null;
  /** Per-model speed results (in-memory, reset on every project switch; "pending" while that model's turn is running). */
  const [speedResults, setSpeedResults] = useState<Map<string, SpeedResult | "pending">>(new Map());
  /** Group whose speed-test confirmation dialog is open (provider id). */
  const [speedFor, setSpeedFor] = useState<string | null>(null);
  /** Group currently being speed-tested (provider id); tests run strictly one model at a time. */
  const [speedRunning, setSpeedRunning] = useState<string | null>(null);

  const [rows, setRows] = useState<RowState[] | null>(null);
  const [defaultModel, setDefaultModel] = useState<ModelRefDto | undefined>(undefined);
  // Vision model used for describe_image proxy-reads (describes images for session models with vision=false).
  const [visionModel, setVisionModel] = useState<ModelRefDto | undefined>(undefined);
  /** Edit target: paired reference of an existing row. */
  const [editing, setEditing] = useState<ModelRefDto | null>(null);
  /** Target group (provider id) for adding a model: taken from the group header entry point, falling back to custom when empty. */
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** Collapsed vendor groups (all expanded by default). */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Vendor group (provider id) currently having its API key configured in bulk. */
  const [groupKeyFor, setGroupKeyFor] = useState<string | null>(null);
  /** "Add group" popup (user-defined group): a valid name proceeds to that group's add-model dialog. */
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupNameError, setGroupNameError] = useState<string | null>(null);
  /** Initial load failure: shown inline only when the whole page has no content (there's no context to pop a toast against). */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Currency follows the user setting (toggled in sidebar settings).
  const { currency } = useTheme();

  const load = useCallback(async () => {
    if (!projectId) return;
    setRows(null);
    setLoadError(null);
    // Speed results are keyed by (provider, model_id) only, so another Project's identically
    // named model would inherit a timing measured against a different endpoint and key —
    // drop them along with the rows they annotate whenever the active Project changes.
    setSpeedResults(new Map());
    try {
      const res = await api.getModels(projectId);
      setRows(res.models.map(toRow));
      setDefaultModel(res.defaultModel);
      setVisionModel(res.visionModel);
    } catch (e) {
      setLoadError(apiErrorText(e));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Changes save immediately (dialog confirm / set default / set vision model / delete):
   * avoids the trap of "still have to click save after confirming". On failure, the error
   * is echoed back and local changes are kept so the user can fix and retry.
   */
  const persist = async (
    nextRows: RowState[],
    nextDefault: ModelRefDto | undefined,
    nextVision: ModelRefDto | undefined,
    /** Success toast text (defaults to "saved"); on failure this function shows an error toast instead. */
    successText?: string,
  ): Promise<boolean> => {
    if (!projectId) return false;
    setBusy(true);
    // The vision model pointer must point to a row that still exists and isn't marked "doesn't support images" (invalidated on delete/re-annotation).
    const effectiveVision =
      nextVision && nextRows.some((r) => sameModelRef(rowRef(r), nextVision) && r.vision)
        ? nextVision
        : undefined;
    try {
      const body: ModelsUpdateRequest = { models: nextRows.map(rowToEntry) };
      if (nextDefault) body.defaultModel = nextDefault;
      if (effectiveVision) body.visionModel = effectiveVision;
      const res = await api.putModels(projectId, body);
      setRows(res.models.map(toRow));
      setDefaultModel(res.defaultModel);
      setVisionModel(res.visionModel);
      // Default model changed: drop the stored draft's model selection so the draft chat
      // follows the new default (a stored pick would otherwise pin the old model forever).
      if (userId && res.defaultModel && !sameModelRef(res.defaultModel, defaultModel)) {
        const key = draftKey(userId, projectId);
        const draft = loadDraft(key);
        if (draft.modelRef) saveDraft(key, { ...draft, modelRef: undefined });
      }
      toastSuccess(successText ?? S.common.saved);
      return true;
    } catch (e) {
      setRows(nextRows);
      if (nextDefault !== undefined) setDefaultModel(nextDefault);
      if (effectiveVision !== undefined) setVisionModel(effectiveVision);
      toastError(apiErrorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => (rows ? groupModelRows(rows, query) : []), [rows, query]);

  /**
   * "Sync presets": merge the built-in catalog into the current table (union; the catalog
   * wins on differing preset entries, local additions and API keys stay untouched — see
   * catalog-sync.ts). No-op with a toast when everything is already up to date.
   */
  const syncPresets = async () => {
    if (!rows) return;
    const merged = syncRowsWithCatalog(rows);
    if (merged.added === 0 && merged.updated === 0) {
      toastInfo(S.models.syncUpToDate);
      return;
    }
    await persist(
      merged.rows,
      defaultModel,
      visionModel,
      S.models.syncDone(merged.added, merged.updated),
    );
  };

  /**
   * Group speed test: one real request per model, strictly sequential (concurrent probes
   * trip provider rate limits), each result written to the card as it lands. The
   * confirmation dialog (speedFor) has already warned about quota by the time this runs.
   */
  const runSpeedTest = async (providerId: string) => {
    if (!projectId || !rows) return;
    const targets = rows.filter((r) => r.provider === providerId);
    setSpeedRunning(providerId);
    try {
      for (const row of targets) {
        const key = speedKey(row.provider, row.modelId);
        setSpeedResults((prev) => new Map(prev).set(key, "pending"));
        try {
          const res = await api.testModel(projectId, {
            provider: row.provider,
            modelId: row.modelId,
            speed: true,
          });
          setSpeedResults((prev) => new Map(prev).set(key, res));
        } catch (e) {
          setSpeedResults((prev) =>
            new Map(prev).set(key, {
              ok: false,
              message: apiErrorText(e),
            }),
          );
        }
      }
    } finally {
      setSpeedRunning(null);
    }
  };

  /**
   * "Add group" confirm: a valid name that doesn't conflict with a built-in group or an
   * existing provider proceeds directly to that group's add-model dialog — groups are
   * carried by the model entry's provider field and aren't persisted separately, so the
   * group appears once the first model saves successfully (canceling leaves nothing behind).
   */
  const confirmAddGroup = () => {
    const name = groupName.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
      setGroupNameError(S.models.groupNameInvalid);
      return;
    }
    if (MODEL_PROVIDERS.some((p) => p.id === name) || rows?.some((r) => r.provider === name)) {
      setGroupNameError(S.models.groupNameExists);
      return;
    }
    setAddGroupOpen(false);
    setGroupName("");
    setAddingTo(name);
  };
  const editingRow =
    editing !== null ? rows?.find((r) => sameModelRef(rowRef(r), editing)) : undefined;

  if (!projectId) return null;

  const toggleGroup = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">{S.models.title}</h1>
            {!isOwner && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{S.models.readOnlyHint}</p>
            )}
          </div>
          {/* The header holds search plus the owner-only "sync presets" action (add-model
              entry points live in each group header); on narrow screens (flex-wrap wraps it
              to its own line) the search box shrinks flexibly, fixed width at >=sm. */}
          <div className="flex min-w-0 max-w-full grow items-center gap-2 sm:grow-0">
            <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
              <Input
                size="sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={S.models.searchPlaceholder}
              />
            </div>
            {isOwner && (
              <Button
                size="sm"
                onClick={() => void syncPresets()}
                disabled={busy || rows === null}
                title={S.models.syncCatalogHint}
              >
                {S.models.syncCatalog}
              </Button>
            )}
          </div>
        </div>

        {rows === null ? (
          <SkeletonList rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={S.models.empty}
            action={
              isOwner && <Button onClick={() => setAddingTo("custom")}>{S.models.addCustom}</Button>
            }
          />
        ) : groups.length === 0 ? (
          <EmptyState title={S.models.noSearchResults} />
        ) : (
          <div className="space-y-3">
            {groups.map((group) => {
              const open = !collapsed.has(group.provider.id);
              return (
                <section
                  key={group.provider.id}
                  className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                >
                  {/* Group header: collapse button (logo + vendor name + count) + group-level
                      actions on the right (bulk configure key, get-key link). Actions are
                      separate elements — can't be nested inside the collapse button (buttons
                      can't nest). The hover highlight applies to the whole header row (not
                      individual buttons) so the header reads as a single unit. */}
                  <div className="flex items-center gap-2 bg-gray-50 pr-2 transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900/60 dark:hover:bg-gray-800/60">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleGroup(group.provider.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
                    >
                      <ProviderLogo
                        provider={group.provider.id}
                        className="h-5 w-5 shrink-0 text-gray-700 dark:text-gray-300"
                      />
                      {/* Vendor name can truncate (min-w-0): the actions on the right must not
                          shrink, otherwise on narrow screens it would get pushed out of the
                          button box and overlap the action text. */}
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {group.provider.label}
                      </span>
                      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-gray-400">
                        {S.models.modelCount(group.rows.length)}
                      </span>
                    </button>
                    {isOwner && (
                      // Add-model entry point: present on every group header (including
                      // custom), new models belong to that group. The page header has no
                      // global add button, so this doesn't collapse on narrow screens either.
                      <span className="shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setAddingTo(group.provider.id)}
                        >
                          <GlyphIcon d={PLUS_ICON} size={13} />
                          {S.models.addToGroup}
                        </Button>
                      </span>
                    )}
                    {isOwner && group.provider.id !== "custom" && (
                      // Not enough room on phone width for group-level actions: collapse it
                      // (per-model keys can still be configured in the card dialog). Wrapped
                      // in a span and hidden there: passing hidden directly to Button conflicts
                      // with its inline-flex base class.
                      <span className="hidden shrink-0 sm:block">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setGroupKeyFor(group.provider.id)}
                        >
                          <GlyphIcon d={KEY_ICON} size={13} />
                          {S.models.groupApiKey}
                        </Button>
                      </span>
                    )}
                    {isOwner && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        disabled={busy || speedRunning !== null}
                        aria-label={`${S.models.speedTest} ${group.provider.label}`}
                        title={
                          speedRunning === group.provider.id
                            ? S.models.speedPending
                            : S.models.speedTest
                        }
                        onClick={() => setSpeedFor(group.provider.id)}
                      >
                        <GlyphIcon d={GAUGE_ICON} size={13} />
                        {/* Phone width: icon only (the header can't fit three labeled actions at 390px). */}
                        <span className="hidden sm:inline">
                          {speedRunning === group.provider.id
                            ? S.models.speedPending
                            : S.models.speedTest}
                        </span>
                      </Button>
                    )}
                    {group.provider.apiKeyUrl && (
                      // Not enough room on phone width for all group-level actions: collapse
                      // it the same way as "bulk configure key", keeping the add entry and
                      // vendor name + count from crowding each other.
                      <a
                        href={group.provider.apiKeyUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hidden shrink-0 whitespace-nowrap text-xs text-brand-600 underline-offset-2 hover:underline sm:inline dark:text-brand-300"
                      >
                        {S.models.getApiKey} ↗
                      </a>
                    )}
                    {/* Collapse arrow sits at the far right of the header (after group actions); it too can be clicked to collapse. */}
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={group.provider.label}
                      onClick={() => toggleGroup(group.provider.id)}
                      className="shrink-0 p-1.5"
                    >
                      <Chevron open={open} className="text-gray-400" />
                    </button>
                  </div>

                  {/* Expand/collapse height transition: grid-template-rows tweens between
                      0fr and 1fr, with the inner overflow-hidden handling clipping — pure
                      CSS, no need to measure content height. Content stays in the DOM while
                      collapsed (height is 0), so both directions animate. */}
                  <div
                    className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                  >
                    {/* inert while collapsed: a card with zero height shouldn't still be Tab-focusable or clickable. */}
                    <div className="overflow-hidden" inert={!open}>
                      <div
                        className={`grid gap-2 border-t border-gray-200 p-2.5 transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3 dark:border-gray-800 ${open ? "opacity-100" : "opacity-0"}`}
                      >
                        {group.rows.length === 0 ? (
                          // An empty group only ever occurs for custom (always shown when there's no search query, to host the add entry point).
                          <p className="col-span-full py-1 text-center text-xs text-gray-400 dark:text-gray-500">
                            {S.models.groupEmptyHint}
                          </p>
                        ) : (
                          group.rows.map((row) => (
                            <ModelCard
                              key={`${row.provider}:${row.modelId}`}
                              row={row}
                              currency={currency}
                              isDefault={sameModelRef(rowRef(row), defaultModel)}
                              isVisionModel={sameModelRef(rowRef(row), visionModel)}
                              speed={speedResults.get(speedKey(row.provider, row.modelId))}
                              onOpen={() => setEditing(rowRef(row))}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
            {isOwner && query.trim() === "" && (
              // "Add group" (user-defined group): hidden while searching (the group list itself is being filtered).
              <button
                type="button"
                onClick={() => {
                  setGroupName("");
                  setGroupNameError(null);
                  setAddGroupOpen(true);
                }}
                className="w-full rounded-md border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
              >
                ＋ {S.models.addGroup}
              </button>
            )}
          </div>
        )}

        {loadError && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{loadError}</p>}
      </div>

      {rows && groupKeyFor && (
        <GroupKeyDialog
          // A user-defined group isn't in the catalog list: synthesize vendor info with custom semantics (label is the group name).
          provider={
            MODEL_PROVIDERS.find((p) => p.id === groupKeyFor) ?? userProviderInfo(groupKeyFor)
          }
          count={rows.filter((r) => r.provider === groupKeyFor).length}
          onClose={() => setGroupKeyFor(null)}
          onSubmit={(key) => {
            const target = groupKeyFor;
            setGroupKeyFor(null);
            const affected = rows.filter((r) => r.provider === target);
            if (affected.length === 0) return;
            const nextRows = rows.map((r) =>
              r.provider === target ? { ...r, apiKeyInput: key, clearApiKey: false } : r,
            );
            // Success toast is shown inside persist (with "configured N" text); on failure
            // only an error toast is shown, no false success report (persist swallows the
            // error and doesn't reject, so a .then can't unconditionally report success).
            void persist(
              nextRows,
              defaultModel,
              visionModel,
              S.models.groupKeyApplied(affected.length),
            );
          }}
        />
      )}

      {speedFor !== null && (
        <Modal open title={S.models.speedTestTitle} onClose={() => setSpeedFor(null)}>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.models.speedTestConfirm(rows?.filter((r) => r.provider === speedFor).length ?? 0)}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setSpeedFor(null)}>{S.common.cancel}</Button>
            <Button
              variant="primary"
              onClick={() => {
                const id = speedFor;
                setSpeedFor(null);
                if (id) void runSpeedTest(id);
              }}
            >
              {S.models.speedTestStart}
            </Button>
          </div>
        </Modal>
      )}
      {addGroupOpen && (
        <Modal
          open
          title={S.models.addGroupTitle}
          onClose={() => setAddGroupOpen(false)}
          widthClass="sm:max-w-sm"
          footer={
            <>
              <Button onClick={() => setAddGroupOpen(false)}>{S.common.cancel}</Button>
              <Button variant="primary" onClick={confirmAddGroup}>
                {S.common.confirm}
              </Button>
            </>
          }
        >
          <label className="block">
            <Input
              size="sm"
              label={S.models.groupNameLabel}
              value={groupName}
              invalid={Boolean(groupNameError)}
              onChange={(e) => {
                setGroupName(e.target.value);
                setGroupNameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmAddGroup();
              }}
              placeholder={S.models.groupNameHint}
              className="font-mono"
              autoFocus
            />
            {groupNameError && <FieldError>{groupNameError}</FieldError>}
          </label>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{S.models.addGroupDesc}</p>
        </Modal>
      )}

      {rows && (addingTo !== null || editingRow) && (
        <ModelDialog
          projectId={projectId}
          row={addingTo !== null ? null : (editingRow ?? null)}
          addProvider={addingTo ?? "custom"}
          existingRefs={rows.map(rowRef)}
          currency={currency}
          canEdit={isOwner}
          isDefault={editingRow !== undefined && sameModelRef(rowRef(editingRow), defaultModel)}
          isVisionModel={editingRow !== undefined && sameModelRef(rowRef(editingRow), visionModel)}
          onClose={() => {
            setEditing(null);
            setAddingTo(null);
          }}
          onSubmit={(next, action) => {
            const isNew = addingTo !== null;
            setEditing(null);
            setAddingTo(null);
            if (action === "remove") {
              // Filter by the **identity as loaded**: rows / pointers are both keyed by the
              // paired reference as loaded. If the user edited identity fields before
              // deleting, next's current reference wouldn't match any row -> nothing gets
              // deleted while it still reports "saved".
              const removed = next.original;
              void persist(
                rows.filter((r) => !sameModelRef(rowRef(r), removed)),
                sameModelRef(removed, defaultModel) ? undefined : defaultModel,
                sameModelRef(removed, visionModel) ? undefined : visionModel,
              );
              return;
            }
            const nextRows = isNew
              ? [...rows, next]
              : rows.map((r) => (sameModelRef(rowRef(r), editing) ? next : r));
            const ptr = nextPointers({
              editing: isNew ? null : editing,
              ref: rowRef(next),
              action,
              defaultModel,
              visionModel,
            });
            void persist(nextRows, ptr.defaultModel, ptr.visionModel);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model card
// ---------------------------------------------------------------------------

/**
 * Card: display name + upstream id + status badges; context / pricing / key status folded
 * into one line of small text; group speed-test results (TTFT / TPS, tone-colored) ride the
 * title row's right edge. The whole card is clickable (the model homepage link lives in the
 * config dialog).
 */
function ModelCard({
  row,
  currency,
  isDefault,
  isVisionModel,
  speed,
  onOpen,
}: {
  row: RowState;
  currency: Currency;
  isDefault: boolean;
  isVisionModel: boolean;
  speed?: SpeedResult | "pending";
  onOpen: () => void;
}) {
  const priced = row.cacheRead || row.cacheWrite || row.output;
  const meta = [
    row.contextWindow ? humanizeTokens(Number(row.contextWindow)) : null,
    // Three prices (cache read / cache write / output); units are explained in the config dialog, not repeated on the card.
    priced
      ? `${displayPrice(row.cacheRead, currency)} / ${displayPrice(row.cacheWrite, currency)} / ${displayPrice(row.output, currency)}`
      : null,
    // Key status: shows the mask when configured, otherwise "not configured" (doesn't mention environment variables).
    row.credential?.apiKeyMasked && !row.clearApiKey
      ? row.credential.apiKeyMasked
      : hasKey(row)
        ? S.models.keyConfigured
        : S.models.noKey,
  ].filter((v): v is string => v !== null);

  const speedBadges =
    speed === "pending" ? (
      <span className="shrink-0 text-[11px] text-gray-400">{S.models.speedPending}</span>
    ) : speed ? (
      speed.ok ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium">
          {speed.ttftMs !== undefined && (
            <span
              className={`flex items-center gap-0.5 ${TONE_CLASS[ttftTone(speed.ttftMs)]}`}
              title={S.models.ttftTitle}
            >
              <GlyphIcon d={CLOCK_ICON} size={11} />
              {Math.round(speed.ttftMs)}ms
            </span>
          )}
          {speed.tps !== undefined && (
            <span
              className={`flex items-center gap-0.5 ${TONE_CLASS[tpsTone(speed.tps)]}`}
              title={S.models.tpsTitle}
            >
              <GlyphIcon d={ZAP_ICON} size={11} />
              {speed.tps} tok/s
            </span>
          )}
        </span>
      ) : (
        <span
          className="shrink-0 text-[11px] font-medium text-red-600 dark:text-red-400"
          title={speed.message}
        >
          {S.models.speedFailed}
        </span>
      )
    ) : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 rounded-md border border-gray-200 px-3 py-2.5 text-left transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-800/40"
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">{row.displayName ?? row.modelId}</span>
        {isDefault && <Badge tone="brand">{S.models.default}</Badge>}
        {row.vision && <Badge tone="green">{S.models.visionBadge}</Badge>}
        {isVisionModel && <Badge tone="amber">{S.models.visionModelBadge}</Badge>}
      </span>
      {/* Upstream id in small text (grouping already separates by group, no composite id is
          shown anymore); when there's no display name, the main line is already the
          upstream id, so it isn't repeated on a second line. */}
      {row.displayName !== undefined && (
        <span className="truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
          {row.modelId}
        </span>
      )}
      {/* Meta line: the truncating text takes the flexible space; speed badges keep their own
          non-shrinking slot on the right so the numbers never wrap or get pushed out. */}
      <span className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400 dark:text-gray-500">
          {meta.join(" · ")}
        </span>
        {speedBadges}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Config dialog (shared by editing an existing model / adding a custom model)
// ---------------------------------------------------------------------------

type DialogAction = "save" | "setDefault" | "setVisionModel" | "remove";

/** Confirmation text per action (S is a live runtime binding, must be read at render time, not frozen at module scope). */
const CONFIRM_TITLE: Record<DialogAction, () => string> = {
  save: () => S.models.confirmSaveTitle,
  setDefault: () => S.models.confirmDefaultTitle,
  setVisionModel: () => S.models.confirmVisionModelTitle,
  remove: () => S.models.confirmDeleteTitle,
};
const CONFIRM_BODY: Record<DialogAction, (name: string) => string> = {
  save: (n) => S.models.confirmSave(n),
  setDefault: (n) => S.models.confirmDefault(n),
  setVisionModel: (n) => S.models.confirmVisionModel(n),
  remove: (n) => S.models.confirmDelete(n),
};

function ModelDialog({
  projectId,
  row,
  addProvider,
  existingRefs,
  currency,
  canEdit,
  isDefault,
  isVisionModel,
  onClose,
  onSubmit,
}: {
  projectId: string;
  row: RowState | null;
  /** Target group for add mode (row is null): the group of the header entry point / falls back to custom when empty. */
  addProvider: string;
  existingRefs: ModelRefDto[];
  currency: Currency;
  canEdit: boolean;
  isDefault: boolean;
  isVisionModel: boolean;
  onClose: () => void;
  onSubmit: (row: RowState, action: DialogAction) => void;
}) {
  // Pricing input is displayed/entered in the current currency; converted back to USD storage on submit (RowState always stores USD).
  const [form, setForm] = useState<RowState>(() => {
    if (row) {
      return {
        ...row,
        cacheRead: usdToInput(row.cacheRead, currency),
        cacheWrite: usdToInput(row.cacheWrite, currency),
        output: usdToInput(row.output, currency),
      };
    }
    // New model: protocol follows group semantics — a first-party vendor group
    // doesn't persist client_type (AgentHub auto-routes by upstream id, with env fallback
    // resolved live from the id); custom / user-defined groups / gateways use a fixed
    // openai protocol (env fallback OPENAI_*), and gateways additionally pre-fill their
    // endpoint base URL. provider keeps the entry point's original value (a user-defined
    // group must not collapse into custom), stored as a separate field from model_id, with
    // no concatenation on save.
    const info = providerInfo(addProvider);
    const vendorAdd =
      info !== undefined && info.id !== "custom" && info.gatewayBaseUrl === undefined;
    return {
      provider: addProvider,
      modelId: "",
      original: null,
      vision: true,
      contextWindow: "",
      maxTokens: "",
      clientType: vendorAdd ? "" : "openai",
      cacheRead: "",
      cacheWrite: "",
      output: "",
      baseUrl: info?.gatewayBaseUrl ?? "",
      originalBaseUrl: "",
      apiKeyInput: "",
      clearApiKey: false,
    };
  });
  /** Field-level validation errors: text below the corresponding input, input highlighted red — closer to the error site than a top-level banner. */
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  /** Connectivity test in progress. */
  const [testing, setTesting] = useState(false);
  /**
   * Action pending confirmation: anything that writes to the Project config goes through a
   * confirmation step — save config / set as default / set as vision proxy model / delete.
   * (Adding a new custom model isn't confirmed: opening the dialog is itself a clear intent.)
   */
  const [confirming, setConfirming] = useState<DialogAction | null>(null);
  const isNew = row === null;
  const preset = row !== null && isPreset(row);

  const set = (patch: Partial<RowState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    // Clear the error marker for whichever field was changed (keys match RowState field names).
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(patch)) delete next[k as keyof FieldErrors];
      return next;
    });
  };

  /**
   * Connectivity test: POST /models/test, sending the paired reference (provider, modelId)
   * in the request body (no URL-encoding concerns), along with the form's not-yet-saved
   * apiKey / baseUrl as overrides — so the user can verify right after typing a key without
   * saving first (an unsaved new model is entirely sourced from the request body: verify
   * before persisting).
   */
  const runTest = async () => {
    setTesting(true);
    try {
      // Always tests against the **current form draft**, unaffected by already-persisted
      // values (per user intent: test exactly what's typed right now):
      // - API key: use it if newly typed; if "clear" is checked, send clearApiKey (the
      //   server won't fall back to the stored key); only if neither applies does the server
      //   read the stored key (the frontend never sees the plaintext key, only its mask).
      // - base URL isn't sensitive, so the frontend always sends the form's current value (empty means null = explicitly no base URL).
      const key = form.apiKeyInput.trim();
      const bu = form.baseUrl.trim();
      const body: ModelTestRequest = {
        provider: form.provider,
        modelId: form.modelId.trim(),
        baseUrl: bu ? bu : null,
      };
      if (key) body.apiKey = key;
      else if (form.clearApiKey) body.clearApiKey = true;
      if (form.clientType.trim()) body.clientType = form.clientType.trim();
      const res = await api.testModel(projectId, body);
      if (res.ok) toastSuccess(S.models.testOk(res.latencyMs ?? 0));
      else toastError(S.models.testFailed(res.message ?? ""));
    } catch (e) {
      toastError(S.models.testFailed(apiErrorText(e)));
    } finally {
      setTesting(false);
    }
  };

  /**
   * Validate and convert pricing back to USD storage; returns null on validation failure —
   * every error is placed below the offending input, which is highlighted red (no more
   * top-level banner: it's too far from the error site, and with three price fields it's
   * hard to tell which one is wrong).
   */
  const validated = (): RowState | null => {
    const modelId = form.modelId.trim();
    const ref: ModelRefDto = { provider: form.provider, modelId };
    const baseUrl = form.baseUrl.trim();
    const errs: FieldErrors = {};
    if (!modelId) errs.modelId = S.common.requiredField;
    // A new or renamed (provider, modelId) must not duplicate another entry (renaming back to itself isn't a conflict).
    else if (!sameModelRef(ref, form.original) && existingRefs.some((r) => sameModelRef(r, ref))) {
      errs.modelId = S.models.modelIdExists;
    }
    // base URL required-field policy: an OpenAI-protocol endpoint can't be
    // inferred — required for custom / user-defined groups and entries with an explicit
    // openai protocol (gateway groups already have it pre-filled); optional for entries
    // auto-routed within a first-party vendor group (the client has its own official
    // default endpoint).
    const openAiLike =
      form.clientType.trim().toLowerCase().includes("openai") ||
      form.provider === "custom" ||
      providerInfo(form.provider) === undefined;
    if (!preset && openAiLike && !baseUrl) errs.baseUrl = S.models.baseUrlRequired;

    // Under PUT full-table replace semantics, omitting pricing means deleting it: all three
    // prices must be either all empty or all filled, to avoid a partial entry silently
    // clearing already-configured pricing (context window likewise must be a valid number, to prevent silent loss).
    const priceFields = [
      ["cacheRead", form.cacheRead.trim()],
      ["cacheWrite", form.cacheWrite.trim()],
      ["output", form.output.trim()],
    ] as const;
    const filled = priceFields.filter(([, v]) => v !== "").length;
    for (const [key, v] of priceFields) {
      // Partial fill: highlight the missing fields red (the filled-in ones are fine).
      if (v === "" && filled > 0) errs[key] = S.models.pricingAllOrNone;
      else if (v !== "" && !Number.isFinite(Number(v))) errs[key] = S.models.pricingInvalid;
    }
    const contextWindow = form.contextWindow.trim();
    if (contextWindow && !Number.isFinite(Number(contextWindow))) {
      errs.contextWindow = S.models.contextWindowInvalid;
    }
    // Output cap: digits-only input can still hold "0"/pasted junk; the server requires a positive integer.
    const maxTokensInput = form.maxTokens.trim();
    if (
      maxTokensInput &&
      !(Number.isInteger(Number(maxTokensInput)) && Number(maxTokensInput) > 0)
    ) {
      errs.maxTokens = S.models.maxTokensInvalid;
    }

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return null;
    }
    setFieldErrors({});
    return {
      ...form,
      modelId,
      // Custom models with an empty context window fall back to the default value (preset models left empty just mean "unknown", not auto-filled).
      contextWindow:
        !preset && !contextWindow ? String(CUSTOM_CONTEXT_DEFAULT) : form.contextWindow,
      cacheRead: inputToUsd(form.cacheRead, currency),
      cacheWrite: inputToUsd(form.cacheWrite, currency),
      output: inputToUsd(form.output, currency),
    };
  };

  const submit = (action: DialogAction) => {
    const next = validated();
    if (next) onSubmit(next, action);
  };

  // Provider info for the current group (updates live as the group dropdown
  // changes): the "get model id / API key" links come from it (shown next to
  // the model id and API key labels in both the add and edit dialogs; custom
  // and self-defined groups have no link).
  const dialogProvider = providerInfo(form.provider);
  // env fallback resolves live from the current form (uses the same
  // resolveModelEnv as the server's getModels): explicit
  // client_type takes priority, otherwise auto-route by model_id; no
  // fallback if it can't be routed.
  const liveEnvKey = resolveModelEnv(
    form.modelId.trim(),
    form.clientType.trim() || undefined,
  )?.envKey;
  // First-party provider group (built-in, non-gateway, non-custom): adding
  // goes through auto-routing — show a hint when the id can't be routed
  // (doesn't block saving: the routing table evolves with the AgentHub
  // version, so it's judged at runtime).
  const vendorGroup =
    dialogProvider !== undefined &&
    dialogProvider.id !== "custom" &&
    dialogProvider.gatewayBaseUrl === undefined;
  const autoRouteMiss =
    isNew &&
    vendorGroup &&
    !form.clientType.trim() &&
    form.modelId.trim() !== "" &&
    liveEnvKey === undefined;

  /** Identity section: upstream model id (renamable; "get model id" link next
   * to the label) + display name and group side by side (both editable;
   * group is the entry's provider field — changing either is a key change,
   * submitted together as renamedFrom). */
  const identityFields = (
    <>
      <label className="block">
        <span className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            {S.models.modelId}
          </span>
          <span className="flex shrink-0 items-baseline gap-2.5">
            {/* The model-homepage entry lives in the dialog header (top-right button); only the "get model ids" provider link stays here. */}
            {dialogProvider?.modelsUrl && (
              <a
                href={dialogProvider.modelsUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="shrink-0 text-xs text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
              >
                {S.models.getModelIds} ↗
              </a>
            )}
          </span>
        </span>
        <Input
          size="sm"
          value={form.modelId}
          disabled={!canEdit}
          invalid={Boolean(fieldErrors.modelId)}
          onChange={(e) => set({ modelId: e.target.value })}
          className="font-mono"
          autoFocus={isNew}
          placeholder={S.models.modelIdHint}
        />
        {fieldErrors.modelId && <FieldError>{fieldErrors.modelId}</FieldError>}
        {/* Hint when auto-routing misses (first-party provider group, adding): warns without blocking. */}
        {autoRouteMiss && (
          <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
            {S.models.autoRouteNone}
          </span>
        )}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Input
          size="sm"
          label={S.models.displayName}
          value={form.displayName ?? ""}
          disabled={!canEdit}
          onChange={(e) => set({ displayName: e.target.value })}
          placeholder={S.models.displayNameHint}
        />
        <Select
          size="sm"
          label={S.models.providerGroup}
          value={form.provider}
          disabled={!canEdit}
          onChange={(e) => set({ provider: e.target.value })}
        >
          {MODEL_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {/* Self-defined groups are listed too (including the current value): options
              = non-catalog providers among existing entries (plus the current
              provider as a fallback), sorted by name and appended after the
              built-in groups — keeps the selected value always valid, and lets an
              entry be regrouped into an existing self-defined group. */}
          {[...new Set(existingRefs.map((r) => r.provider).concat(form.provider))]
            .filter((p) => !MODEL_PROVIDERS.some((k) => k.id === p))
            .sort()
            .map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
        </Select>
      </div>
    </>
  );

  // Hint for a blank API key: an existing key means keep the original value;
  // no existing key but an env var fallback exists means use the env var
  // (the fallback name resolves live, so it updates as the id / protocol is edited).
  const apiKeyHint = form.credential?.apiKeyMasked
    ? S.models.apiKeyKeepHint
    : liveEnvKey
      ? S.models.apiKeyEnvHint(liveEnvKey)
      : S.models.apiKeyKeepHint;
  // Default endpoint note (zhipu / moonshot each have domestic / international
  // endpoints): shown only when the env fallback hint appears (no existing key)
  // and this entry actually goes through the provider's own client (the
  // resolved envKey matches the provider) — entries going through the OpenAI
  // client (OPENAI_API_KEY) have no provider default endpoint to speak of.
  const envNote =
    !form.credential?.apiKeyMasked && liveEnvKey && liveEnvKey === dialogProvider?.envKey
      ? S.models.providerEnvNotes[form.provider]
      : undefined;

  return (
    <Modal
      open
      title={
        isNew ? (vendorGroup ? S.models.addTitleVendor : S.models.addTitle) : S.models.editTitle
      }
      onClose={onClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          {canEdit && (
            <Button
              variant="primary"
              onClick={() => {
                // Validate first: if validation fails, the inline field errors show right away without popping the confirm dialog.
                if (!validated()) return;
                if (isNew || row === null) {
                  submit("save");
                  return;
                }
                // Nothing changed: report it instead of confirming a no-op write (the
                // baseline is rebuilt exactly like the form's initial state, so a plain
                // JSON compare is field-exact).
                const initial: RowState = {
                  ...row,
                  cacheRead: usdToInput(row.cacheRead, currency),
                  cacheWrite: usdToInput(row.cacheWrite, currency),
                  output: usdToInput(row.output, currency),
                };
                if (JSON.stringify(form) === JSON.stringify(initial)) {
                  toastInfo(S.common.noChangesToSave);
                  return;
                }
                setConfirming("save");
              }}
            >
              {S.common.confirm}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {/* Header: logo + display name + badges + upstream id (existing model); the model
            homepage entry lives here as a small secondary button on the right (moved out of
            the form body — it's a property of the model, not an input). */}
        {!isNew && (
          <div className="flex items-center gap-2.5 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
            <ProviderLogo
              provider={form.provider}
              className="h-6 w-6 shrink-0 text-gray-700 dark:text-gray-300"
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                {form.displayName ?? form.modelId}
                {isDefault && <Badge tone="brand">{S.models.default}</Badge>}
                {form.vision && <Badge tone="green">{S.models.visionBadge}</Badge>}
                {isVisionModel && <Badge tone="amber">{S.models.visionModelBadge}</Badge>}
              </span>
              {/* Upstream id in small text: when there's no display name, the main line is already showing it, so don't repeat. */}
              {form.displayName !== undefined && (
                <span className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                  {form.modelId}
                </span>
              )}
            </div>
            {row && modelHomepageUrl(row.provider, row.modelId) && (
              <a
                href={modelHomepageUrl(row.provider, row.modelId)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 transition-colors duration-150 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {S.models.homepage}
                {/* External-link glyph (opens in a new tab) */}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="shrink-0"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
                </svg>
              </a>
            )}
          </div>
        )}

        {/* Adding a model: protocol note first (first-party provider group = auto-route
            by id; custom / self-defined group / gateway = fixed OpenAI protocol), then
            the identity fields ("get model id / API key" links next to the respective
            inputs; fill in the id to test connectivity — verify before saving). */}
        {isNew && (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {vendorGroup ? S.models.addAutoRouteHint : S.models.addProtocolHint}
            </p>
            {identityFields}
          </>
        )}

        {/* Model-level actions pinned at the top: test connectivity (for a new model,
            fill in the id and key to verify before saving) / set default / set as
            vision proxy model / remove. */}
        {canEdit && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={testing || !form.modelId.trim()}
                onClick={() => void runTest()}
              >
                {testing ? S.models.testing : S.models.testConnection}
              </Button>
              {!isNew && !isDefault && (
                <Button size="sm" onClick={() => setConfirming("setDefault")}>
                  {S.models.setDefault}
                </Button>
              )}
              {!isNew && form.vision && !isVisionModel && (
                <Button
                  size="sm"
                  title={S.models.visionModelHint}
                  onClick={() => setConfirming("setVisionModel")}
                >
                  {S.models.setVisionModel}
                </Button>
              )}
              {!isNew && (
                <>
                  <span className="min-w-0 flex-1" />
                  <Button size="sm" variant="danger" onClick={() => setConfirming("remove")}>
                    {S.models.remove}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 1) API key — the most commonly used, placed first in the field section; "get API key"
            link next to the label. PasswordInput carries its own show/hide toggle and brings its
            own <label> wrapper, so this outer container is a <div> (a nested <label> is invalid). */}
        <div className="block">
          <span className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
              {S.models.apiKey}
            </span>
            {dialogProvider?.apiKeyUrl && (
              <a
                href={dialogProvider.apiKeyUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="shrink-0 text-xs text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
              >
                {S.models.getApiKey} ↗
              </a>
            )}
          </span>
          <PasswordInput
            size="sm"
            value={form.apiKeyInput}
            disabled={!canEdit}
            onChange={(e) => set({ apiKeyInput: e.target.value, clearApiKey: false })}
            className="font-mono"
            autoComplete="off"
            autoFocus={!isNew}
            placeholder={apiKeyHint}
          />
        </div>
        {envNote && <p className="text-xs text-gray-400 dark:text-gray-500">{envNote}</p>}
        {form.credential?.apiKeyMasked && !form.apiKeyInput && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-mono">{form.credential.apiKeyMasked}</span>
            {form.credential.createdAt && (
              <span className="text-gray-400">
                {S.common.created} {formatDateTime(form.credential.createdAt)}
              </span>
            )}
            {canEdit && (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form.clearApiKey}
                  onChange={(e) => set({ clearApiKey: e.target.checked })}
                />
                {S.models.clearApiKey}
              </label>
            )}
          </div>
        )}

        {/* 2) base URL */}
        <Input
          size="sm"
          label={S.models.baseUrl}
          value={form.baseUrl}
          disabled={!canEdit}
          onChange={(e) => set({ baseUrl: e.target.value })}
          className="font-mono"
          placeholder={preset ? S.models.baseUrlHint : "https://…"}
          {...(fieldErrors.baseUrl ? { error: fieldErrors.baseUrl } : {})}
        />

        {/* 3) Context window + max output tokens side by side (one row): the "Token" unit
            sits inside each box as a muted right suffix. Placeholders cannot scroll, so at
            this half width they carry only a short line; the full explanation lives in the
            input's title (hover) — the owner explicitly prefers saving the vertical space
            over a visible hint line. Only field errors appear under a cell. Max output
            tokens: per-model cap on the request's output — when set it wins over the
            Agent's system_config value; empty inherits it (lets a small-context local
            model stay under its window). */}
        <div className="grid grid-cols-2 items-start gap-2">
          <label className="block">
            <FieldLabel>{S.models.contextWindow}</FieldLabel>
            <span className="relative block">
              <Input
                size="sm"
                value={form.contextWindow}
                inputMode="numeric"
                disabled={!canEdit}
                invalid={Boolean(fieldErrors.contextWindow)}
                onChange={(e) => set({ contextWindow: digitsOnly(e.target.value) })}
                className="pr-12 font-mono"
                // The title mirrors the placeholder: at half width the (EN) copy can clip, hover reveals it in full.
                title={
                  preset
                    ? S.models.contextWindowHint
                    : S.models.contextWindowDefaultHint(CUSTOM_CONTEXT_DEFAULT)
                }
                placeholder={
                  preset
                    ? S.models.contextWindowHint
                    : S.models.contextWindowDefaultHint(CUSTOM_CONTEXT_DEFAULT)
                }
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-gray-400">
                {S.models.tokenUnit}
              </span>
            </span>
            {fieldErrors.contextWindow && <FieldError>{fieldErrors.contextWindow}</FieldError>}
          </label>
          <label className="block">
            <FieldLabel>{S.models.maxTokens}</FieldLabel>
            <span className="relative block">
              <Input
                size="sm"
                value={form.maxTokens}
                inputMode="numeric"
                disabled={!canEdit}
                invalid={Boolean(fieldErrors.maxTokens)}
                onChange={(e) => set({ maxTokens: digitsOnly(e.target.value) })}
                className="pr-12 font-mono"
                // Short placeholder (fits the half-width box); the full explanation incl. the small-context advice is the hover title.
                title={S.models.maxTokensTitle}
                placeholder={S.models.maxTokensHint}
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-gray-400">
                {S.models.tokenUnit}
              </span>
            </span>
            {fieldErrors.maxTokens && <FieldError>{fieldErrors.maxTokens}</FieldError>}
          </label>
        </div>

        {/* 4) Pricing: three fields side by side with self-contained labels (… price) — no
            standalone section heading; currency and unit (/M tok) are shown inside the input.
            Errors land right under the offending field (which is also outlined red): with
            three fields side by side, only sticking close to the field makes clear which one it is. */}
        <div className="grid grid-cols-3 items-start gap-2">
          {(
            [
              ["cacheRead", S.models.priceCacheRead, form.cacheRead],
              ["cacheWrite", S.models.priceCacheWrite, form.cacheWrite],
              ["output", S.models.priceOutput, form.output],
            ] as Array<[keyof FieldErrors & keyof RowState, string, string]>
          ).map(([key, label, value]) => (
            <label key={key} className="block">
              <FieldLabel>{label}</FieldLabel>
              <span className="relative block">
                <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-xs text-gray-400">
                  {CURRENCY_SYMBOL[currency]}
                </span>
                <Input
                  size="sm"
                  value={value}
                  inputMode="decimal"
                  disabled={!canEdit}
                  invalid={Boolean(fieldErrors[key])}
                  onChange={(e) => set({ [key]: decimalOnly(e.target.value) })}
                  className="pl-4 pr-11 text-right font-mono"
                />
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-gray-400">
                  {S.models.priceUnitShort}
                </span>
              </span>
              {fieldErrors[key] && <FieldError>{fieldErrors[key]}</FieldError>}
            </label>
          ))}
        </div>

        {/* 5) Identity: model id (renamable) + display name and group (side by side) */}
        {!isNew && identityFields}
        {/* Legacy entries carrying a non-openai client_type (historical config): read-only display. */}
        {!isNew && !preset && form.clientType && form.clientType !== "openai" && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {S.models.clientTypeLocked(form.clientType)}
          </p>
        )}

        {/* Vision capability: for preset models it's flagged by the built-in catalog (read-only);
            custom models toggle it here — an iOS-style switch sitting inline right next to the
            label (per owner: no full-row stretch, no standing explanation text). Only the OFF
            state shows one small muted line: images are then read via the configured vision
            proxy model (describe_image). */}
        {!preset && (
          <div>
            <label
              className={`inline-flex items-center gap-2 ${canEdit ? "cursor-pointer" : "cursor-not-allowed"}`}
            >
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                {S.models.vision}
              </span>
              <Switch
                checked={form.vision}
                disabled={!canEdit}
                onChange={(vision) => set({ vision })}
                aria-label={S.models.vision}
              />
            </label>
            {!form.vision && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {S.models.visionOffProxyHint}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Confirmation before writing config (save / set default / set as vision proxy model / remove): stacked on top of the config dialog. */}
      {confirming && (
        <ConfirmModal
          open
          title={CONFIRM_TITLE[confirming]()}
          tone={confirming === "remove" ? "danger" : "primary"}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            const action = confirming;
            setConfirming(null);
            submit(action);
          }}
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {CONFIRM_BODY[confirming](form.displayName ?? form.modelId)}
          </p>
        </ConfirmModal>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Set a single API key for an entire provider group
// ---------------------------------------------------------------------------

/** Write the same API key to every model in a provider group (one account's key is usually valid for all of that provider's models). */
function GroupKeyDialog({
  provider,
  count,
  onClose,
  onSubmit,
}: {
  provider: ModelProviderInfo;
  count: number;
  onClose: () => void;
  onSubmit: (apiKey: string) => void;
}) {
  const [key, setKey] = useState("");
  return (
    <Modal
      open
      title={S.models.groupApiKeyTitle(provider.label)}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          <Button variant="primary" disabled={!key.trim()} onClick={() => onSubmit(key.trim())}>
            {S.common.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Input
          size="sm"
          label={S.models.apiKey}
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="font-mono"
          autoComplete="off"
          autoFocus
          placeholder={S.models.apiKeyEnvHint(provider.envKey)}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {S.models.groupApiKeyHint(count)}
        </p>
        {/* Default endpoint note (zhipu / moonshot): same wording as the single-model dialog's env fallback hint. */}
        {S.models.providerEnvNotes[provider.id] && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {S.models.providerEnvNotes[provider.id]}
          </p>
        )}
        {provider.apiKeyUrl && (
          <a
            href={provider.apiKeyUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-block text-xs text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
          >
            {S.models.getApiKey} ↗
          </a>
        )}
      </div>
    </Modal>
  );
}
