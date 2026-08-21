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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CredentialInfo,
  ModelProtocolDetectRequest,
  ModelRefDto,
  ModelsResponse,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelUpdateEntry,
  ModelVisionDetectRequest,
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
  canonicalClientType,
  catalogEntryFor,
  fastModeProtocol,
  modelHomepageUrl,
  providerInfo,
  resolveModelEnv,
} from "@prismshadow/penguin-core/model-catalog";
import type { FastModeProtocol, ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import { groupModelRows, isFreeModel, sameModelRef, userProviderInfo } from "./model-grouping";
import { protocolPathForModel } from "./protocol-path";
import { ProtocolSuffixMenu } from "./protocol-suffix";
import {
  DEFAULT_CUSTOM_CLIENT_TYPE,
  detectableBaseUrl,
  displayWidthCh,
  envHintClientType,
  isCustomLikeGroup,
  isGenericProtocolClientType,
  needsProtocolDetectOnSave,
  protocolForPersist,
  protocolSelectorValue,
} from "./protocol-types";
import type { ProtocolClientType } from "./protocol-types";
import {
  isGroupExpanded,
  loadExpandedProviders,
  saveExpandedProviders,
  toggleExpandedProvider,
} from "./model-group-expansion";
import { clearDraftModelRef } from "../chat/draft-cache";
import { syncRowsWithCatalog } from "./catalog-sync";
import { tpsTone, ttftTone } from "./speed-test";
import type { SpeedResult, SpeedTone } from "./speed-test";
import { toneInk, toneStrip } from "../../lib/tone";
import { InfoPopover } from "../../components/ui/info-popover";

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

/** Group-header action glyphs (24x24 line paths): add, bulk key, external link, gauge for speed test. */
const PLUS_ICON = "M12 5v14M5 12h14";
const KEY_ICON =
  "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4";
const EXTERNAL_LINK_ICON =
  "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3";

/** Speed-test glyphs (24x24 line paths): gauge for the group action, clock = TTFT, zap = TPS. */
const GAUGE_ICON = "M12 14l3.5-3.5M20.49 17A10 10 0 1 0 3.5 17";
const CLOCK_ICON = "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 7v5l3.5 2";
const ZAP_ICON = "M13 2 3 14h9l-1 8 10-12h-9l1-8Z";

/** Env-fallback chip glyphs (24x24 line paths): check = variable detected, alert triangle = missing. */
const CHECK_ICON = "M20 6 9 17l-5-5";
const ALERT_ICON =
  "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01";

/** Metric tone -> text color classes for the card speed badges. */
const TONE_CLASS: Record<SpeedTone, string> = {
  green: toneInk.success,
  yellow: toneInk.attention,
  red: toneInk.danger,
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

/**
 * Moving an existing model to Custom keeps a generic protocol client type (protocol
 * detection / the in-field picker manage those) and otherwise switches to the generic
 * OpenAI Chat Completions client — an unroutable or vendor-pinned type must not leak
 * into a custom group.
 */
export function clientTypeAfterProviderChange(provider: string, current: string): string {
  if (provider !== "custom") return current;
  return current.trim() !== "" && isGenericProtocolClientType(current) ? current : "openai-chat";
}

/**
 * Who asked for a detection run. Only the failure wording differs: a manual run reports a
 * failure, a save-triggered one reports the fallback it is proceeding with.
 */
type DetectMode = "manual" | "save";

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
  /** Whether the server process currently has a non-empty value for envKey (presence only; the value never leaves the server). */
  envKeyPresent?: boolean;
  contextWindow: string;
  /** Per-model max output tokens ("" = inherit the Agent setting): caps output per request; user-only, never preset by the catalog. */
  maxTokens: string;
  /**
   * Per-model fast mode (premium faster serving tier, AgentHub `fast_mode`): off by default;
   * user-only, never preset by the catalog, editable on every model (preset ones included).
   * Models without a fast tier reject requests carrying it, hence the standing hint while ON.
   */
  fastMode: boolean;
  /**
   * AgentHub client protocol. Empty for preset models (auto-routed from the model id) and
   * for a NEW custom model, which starts with nothing selected until the user picks from
   * the base URL field's suffix or a detection run fills it in; gateway groups start on
   * their preset pin. Never persisted empty for a custom-like entry — see protocolForPersist.
   */
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
    fastMode: m.fastMode === true,
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
  if (m.envKeyPresent !== undefined) row.envKeyPresent = m.envKeyPresent;
  if (m.credential) row.credential = m.credential;
  return row;
}

/**
 * Whether the model dialog offers the fast-mode switch for a draft row, and on which protocol
 * the parameter would travel.
 *
 * `protocol` is AgentHub's own answer (see fastModeProtocol): `undefined` means the routed
 * client rejects `fast_mode` — or the id routes to no client at all — so arming the switch
 * could only produce a turn-killing error, and it is not offered. `show` adds the one
 * exception: a row that already stores fast mode keeps its switch regardless, because a
 * value that arrived another way (a hand-edited config, `penguin config model add
 * --fast-mode`, or an upstream id renamed afterwards) has to remain switchable off — the
 * runtime rejection tells the user to turn it off in the model settings, and that has to be
 * true. `protocol` also picks the warning copy: only Anthropic's fast mode is a gated
 * research preview.
 *
 * The client type is resolved through protocolForPersist — the one the entry will actually
 * be SAVED with — rather than the raw field, for the same reason envHintClientType exists: a
 * custom-like group leaves the protocol empty until detection or a manual pick fills it in,
 * and fastModeProtocol then falls back to routing by model id. Typing an id that routes to a
 * client with no fast tier (`kimi-k3`, `gemini-3-pro`) into a custom group would hide a
 * switch that the persisted `openai-chat` entry can in fact serve. An empty result keeps the
 * id-based routing the preset and vendor groups genuinely use.
 */
export function fastModeState(
  row: Pick<RowState, "provider" | "modelId" | "clientType" | "baseUrl" | "fastMode">,
): { protocol: FastModeProtocol | undefined; show: boolean } {
  const protocol = fastModeProtocol(
    row.modelId.trim(),
    protocolForPersist(row.provider, row.clientType) || undefined,
    row.baseUrl.trim() || undefined,
  );
  return { protocol, show: protocol !== undefined || row.fastMode };
}

/**
 * Layout of the dialog's capability row, which carries the vision-support and fast-mode
 * switches side by side in the two-up grid.
 *
 * Neither switch is guaranteed to be there: vision is read-only catalog metadata on preset
 * models (no switch at all), and fast mode is withheld wherever the routed client rejects the
 * parameter (see fastModeState). So the pair is a coincidence, not an invariant, and the row
 * degrades in both directions — with neither switch it must not be rendered at all (an empty
 * grid still draws the parent's `space-y` gap), and with exactly one the lone switch spans
 * both columns rather than sitting in a half-width cell next to dead space.
 */
export function capabilityRow(present: { vision: boolean; fastMode: boolean }): {
  show: boolean;
  cellClass: string | undefined;
} {
  const both = present.vision && present.fastMode;
  return { show: present.vision || present.fastMode, cellClass: both ? undefined : "col-span-2" };
}

/** Row edit state -> wire entry (exported for unit tests): the single funnel into the config PUT. */
export function rowToEntry(row: RowState): ModelUpdateEntry {
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
  // Never persists an empty protocol for a custom-like entry (that entry could not start —
  // see protocolForPersist); preset / vendor rows keep "" so AgentHub infers from the id.
  const clientType = protocolForPersist(row.provider, row.clientType);
  if (clientType) entry.clientType = clientType;
  // Supported by default: submit false only when explicitly marked "unsupported" (preset vision models and checked custom models aren't persisted).
  if (!row.vision) entry.vision = false;
  // Output cap ("" = inherit the Agent setting): submitted only when filled; omitting clears the stored annotation.
  const mt = Number(row.maxTokens.trim());
  if (row.maxTokens.trim() && Number.isFinite(mt) && mt > 0) entry.maxTokens = mt;
  // Off by default: submitted only when enabled (omitting clears the stored annotation; the server never persists false).
  if (row.fastMode) entry.fastMode = true;
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
  /**
   * Expanded vendor groups — hydrated from this Project's persisted set (DeepSeek-only
   * on a first visit; every other group, including user-defined ones arriving with the
   * async row load, starts collapsed), written back on every toggle so the user's
   * choices survive a refresh. Searching force-opens the rendered groups without
   * touching this set (see model-group-expansion.ts).
   */
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpandedProviders(projectId));
  // Project resolved on first load / switched: swap in that Project's persisted expansion set.
  useEffect(() => {
    setExpanded(loadExpandedProviders(projectId));
  }, [projectId]);
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
        clearDraftModelRef(userId, projectId);
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
  /** Non-empty search query: groups are filtered to matches and force-opened while it lasts. */
  const searching = query.trim() !== "";

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

  /**
   * Header toggles are inert while searching: every rendered group is force-opened (see
   * isGroupExpanded), so a flip would change nothing visibly and only silently mutate the
   * state restored once the query clears. Computed outside the state updater (sidebar
   * toggleGroup convention): the persistence write is a side effect, and updaters must
   * stay pure (double-invoked in StrictMode).
   */
  const toggleGroup = (id: string) => {
    if (searching) return;
    const next = toggleExpandedProvider(expanded, id);
    setExpanded(next);
    saveExpandedProviders(projectId, next);
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-1.5 text-xl font-semibold">
            {S.models.title}
            {!isOwner && <InfoPopover label={S.models.title}>{S.models.readOnlyHint}</InfoPopover>}
          </h1>
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
              const open = isGroupExpanded(expanded, group.provider.id, searching);
              return (
                <section
                  key={group.provider.id}
                  className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                >
                  {/* Group header: collapse button (logo + vendor name + count) + group-level
                      actions on the right. Actions are separate elements because buttons can't
                      nest. The row is a size container: the sidebar can narrow it while the
                      viewport remains desktop-sized, so action labels must respond to this
                      row's actual width rather than viewport breakpoints. Narrow rows never
                      hide an action — each one keeps its icon (with aria-label + title) and
                      only sheds its text label. */}
                  <div className="@container flex items-center gap-2 bg-gray-50 pr-2 transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900/60 dark:hover:bg-gray-800/60">
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
                      // custom), new models belong to that group. Narrow rows never hide a
                      // group action — they drop its label and keep the icon (same pattern
                      // for every action in this row), so the button stays reachable.
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        disabled={busy}
                        aria-label={`${S.models.addToGroup} ${group.provider.label}`}
                        title={S.models.addToGroup}
                        onClick={() => setAddingTo(group.provider.id)}
                      >
                        <GlyphIcon d={PLUS_ICON} size={13} />
                        <span className="hidden @3xl:inline">{S.models.addToGroup}</span>
                      </Button>
                    )}
                    {isOwner && group.provider.id !== "custom" && (
                      // Bulk key action: icon-only while this row is narrow, labeled from
                      // @3xl up. The button itself never disappears — aria-label + title
                      // carry the name while the visible label is dropped.
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        disabled={busy}
                        aria-label={`${S.models.groupApiKey} ${group.provider.label}`}
                        title={S.models.groupApiKey}
                        onClick={() => setGroupKeyFor(group.provider.id)}
                      >
                        <GlyphIcon d={KEY_ICON} size={13} />
                        <span className="hidden @3xl:inline">{S.models.groupApiKey}</span>
                      </Button>
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
                        {/* Compact rows keep this accessible action icon-only. */}
                        <span className="hidden @3xl:inline">
                          {speedRunning === group.provider.id
                            ? S.models.speedPending
                            : S.models.speedTest}
                        </span>
                      </Button>
                    )}
                    {group.provider.apiKeyUrl && (
                      // External link: its label is the last one admitted as space grows
                      // (@4xl); below that it collapses to the external-link glyph with a
                      // small padding bump for a usable touch target.
                      <a
                        href={group.provider.apiKeyUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={`${S.models.getApiKey} ${group.provider.label}`}
                        title={S.models.getApiKey}
                        className="inline-flex shrink-0 items-center whitespace-nowrap p-1 text-xs text-brand-600 underline-offset-2 hover:underline @4xl:p-0 dark:text-brand-300"
                      >
                        <GlyphIcon d={EXTERNAL_LINK_ICON} size={13} className="@4xl:hidden" />
                        <span className="hidden @4xl:inline">{S.models.getApiKey} ↗</span>
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
          <div className="block">
            <Input
              size="sm"
              label={S.models.groupNameLabel}
              info={S.models.addGroupDesc}
              infoLabel={S.models.groupNameLabel}
              required
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
          </div>
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
  // Env-fallback chip: only rows without a stored key show it — a stored key never
  // consults the variable, so the chip would be noise there. Rows without a known
  // fallback keep the plain "not configured" text.
  const envChip = !hasKey(row) && row.envKey !== undefined ? row.envKey : undefined;
  const meta = [
    row.contextWindow ? humanizeTokens(Number(row.contextWindow)) : null,
    // Three prices (cache read / cache write / output); units are explained in the config dialog, not repeated on the card.
    priced
      ? `${displayPrice(row.cacheRead, currency)} / ${displayPrice(row.cacheWrite, currency)} / ${displayPrice(row.output, currency)}`
      : null,
    // Key status: the mask when configured; rows on an env fallback carry the chip instead.
    row.credential?.apiKeyMasked && !row.clearApiKey
      ? row.credential.apiKeyMasked
      : hasKey(row)
        ? S.models.keyConfigured
        : envChip !== undefined
          ? null
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
        {/* Free rows (all three price buckets 0, e.g. :free variants / openrouter/free): a
            light-yellow badge so zero-cost models stand out at a glance (informational, kept
            distinct from the amber warning tone the proxy-vision badge uses). */}
        {isFreeModel(row) && <Badge tone="yellow">{S.models.freeBadge}</Badge>}
        {row.vision && <Badge tone="green">{S.models.visionBadge}</Badge>}
        {isVisionModel && <Badge tone="amber">{S.models.visionModelBadge}</Badge>}
        {/* Fast mode moves the model onto a premium price list that the recorded prices do not
            reflect, so it has to be visible without opening the dialog (amber, like the other
            badge that flags a standing cost/behavior choice). */}
        {row.fastMode && <Badge tone="amber">{S.models.fastModeBadge}</Badge>}
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
        {/* Env-fallback status, visible on the card itself (not tucked into the dialog):
            success tone when the server sees the variable, attention tone when the key
            would be read from a variable that is not set — that request will 401. */}
        {envChip !== undefined && (
          <span
            className={`flex min-w-0 shrink items-center gap-1 font-mono text-[11px] font-medium ${
              row.envKeyPresent ? toneInk.success : toneInk.attention
            }`}
            title={
              row.envKeyPresent
                ? S.models.envKeyPresentTitle(envChip)
                : S.models.envKeyMissingTitle(envChip)
            }
          >
            <GlyphIcon d={row.envKeyPresent ? CHECK_ICON : ALERT_ICON} size={11} />
            <span className="truncate">env: {envChip}</span>
          </span>
        )}
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
    // openai-chat protocol (env fallback OPENAI_*), and gateways additionally pre-fill their
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
      // A new custom model claims no vision support until it is detected or switched on by
      // hand (per maintainer). Vendor and gateway adds keep the old optimistic default:
      // their ids are catalog-known, so the capability is already established for them.
      vision: !isCustomLikeGroup(addProvider),
      contextWindow: "",
      maxTokens: "",
      fastMode: false,
      // No protocol is preselected for a custom / user-defined group: it is detected from
      // the endpoint (on demand, or on save while still unset) or picked by hand. Vendor
      // groups auto-route by model id, and gateways keep their preset Chat Completions pin.
      clientType: vendorAdd || isCustomLikeGroup(addProvider) ? "" : "openai-chat",
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
  /** Fast mode is being switched ON and awaits the premium-billing warning's confirmation. */
  const [confirmingFastMode, setConfirmingFastMode] = useState(false);
  /** Protocol detection in progress (custom / user-defined groups only). */
  const [detecting, setDetecting] = useState(false);
  /**
   * Whether the last detection run came back empty, purely to tint the suffix trigger
   * amber. That tint is the control's own appearance, not a message occupying the form —
   * the wording of both outcomes lives in a toast. It is deliberately the only trace left:
   * a hit needs none, because the suffix then shows the protocol it applied.
   */
  const [detectFailed, setDetectFailed] = useState(false);
  /**
   * Monotonic run counter: each detection captures it and only the newest run may apply
   * its result — a manual protocol pick or a re-run supersedes anything still in flight.
   */
  const detectSeq = useRef(0);
  /**
   * The run currently in flight, so a second trigger joins it instead of starting a rival
   * probe: clicking Detect while the save path is already probing (or vice versa) must not
   * double-fire, and the save path needs the SAME run's verdict to decide whether to go on.
   */
  const detectInFlight = useRef<Promise<string | null> | null>(null);
  /** Vision probe in progress (its own control, so its own busy state). */
  const [visionDetecting, setVisionDetecting] = useState(false);
  /** Single-flight guard for the vision probe: it bills the user, so never twice at once. */
  const visionInFlight = useRef<Promise<void> | null>(null);
  const isNew = row === null;
  const preset = row !== null && isPreset(row);

  // Read from the live form, not the saved row, so editing the upstream id, the protocol or
  // the base URL updates the answer as it is typed.
  const { protocol: fastProtocol, show: showFastMode } = fastModeState(form);

  // Vision support and fast mode share one row; either can be missing, so the row's own
  // presence and the cell width follow from which switches are actually there (capabilityRow).
  const showVision = !preset;
  const { show: showCapabilityRow, cellClass: toggleCellClass } = capabilityRow({
    vision: showVision,
    fastMode: showFastMode,
  });

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
      // Like base URL, the form's current value is always sent (not just when true): an
      // unsaved toggle-off must override a stored fast_mode=true, so the probe tests
      // exactly the draft's serving tier.
      body.fastMode = form.fastMode;
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
   * Protocol detection: POST /models/detect probes the base URL for the three generic
   * protocols (openai-responses → ant-messages → openai-chat, first hit wins) and applies
   * the result to the form's clientType. Resolves to the detected client type, or null
   * when nothing matched / the probe failed, so the save path can decide from the same run
   * whether it may go on.
   *
   * No API key is required. The server resolves the probe credential in three layers — the
   * key typed here, else this entry's stored key, else the environment variable for
   * whichever protocol each probe speaks (ANTHROPIC_* / OPENAI_*) — and a keyless probe
   * still identifies a route that answers in a protocol's own error shape. So the button
   * is always live and a failure explains itself afterwards instead of being pre-empted by
   * a disabled control.
   *
   * Outcomes are announced with a toast, like the connectivity test in this same dialog:
   * transient and non-blocking, nothing to dismiss before carrying on. The Toaster portals
   * to document.body at z-[100] against the Modal's z-50, so a toast raised from inside
   * this dialog renders above it rather than behind or clipped by it.
   *
   * Every failure — unreachable, timeout, gateway junk, nothing matched, an invalid URL
   * that never left the browser, a server error — raises the SAME message naming the two
   * things the user can act on (API key, base URL). Per maintainer: the finer distinctions
   * are invisible from the outside, and wording one of them as "the endpoint responded"
   * read as success. The per-probe outcomes stay in the endpoint's response for debugging.
   *
   * A stale run (superseded by a manual pick or a newer run) discards its result instead
   * of clobbering the form, and stays silent.
   */
  const detectOnce = async (mode: DetectMode): Promise<string | null> => {
    // What an empty result means depends on who asked. A manual run simply failed; a save
    // run silently resolves to the compatible client and says so, because the save it was
    // serving is still going through.
    const failed = () => {
      setDetectFailed(true);
      if (mode === "save") toastInfo(S.models.detectFellBack);
      else toastError(S.models.detectFailedBody);
    };
    const baseUrl = form.baseUrl.trim();
    // An unusable URL is just another failure: the server would 400 it, and the user gets
    // the same message either way rather than a distinct piece of API error text.
    if (!detectableBaseUrl(baseUrl)) {
      failed();
      return null;
    }
    const seq = ++detectSeq.current;
    setDetecting(true);
    setDetectFailed(false);
    try {
      const body: ModelProtocolDetectRequest = { baseUrl };
      const key = form.apiKeyInput.trim();
      if (key) body.apiKey = key;
      else if (form.clearApiKey) body.clearApiKey = true;
      const modelId = form.modelId.trim();
      if (modelId) {
        body.provider = form.provider;
        body.modelId = modelId;
      }
      const res = await api.detectProtocol(projectId, body);
      if (seq !== detectSeq.current) return null;
      if (res.detected) {
        set({ clientType: res.detected });
        return res.detected;
      }
      failed();
      return null;
    } catch {
      if (seq === detectSeq.current) failed();
      return null;
    } finally {
      if (seq === detectSeq.current) setDetecting(false);
    }
  };

  /**
   * Single-flight wrapper: a second trigger joins the run already in progress rather than
   * starting a rival probe (the button while the save path is probing, or vice versa).
   */
  const runDetect = (mode: DetectMode): Promise<string | null> => {
    if (detectInFlight.current) return detectInFlight.current;
    const run = detectOnce(mode).finally(() => {
      detectInFlight.current = null;
    });
    detectInFlight.current = run;
    return run;
  };

  /**
   * The Detect button. Announces BOTH outcomes: the user asked a question and gets an
   * answer either way. (The save path calls runDetect directly instead — a hit there needs
   * no announcement of its own, since the save it was serving carries straight on.)
   */
  const detectFromButton = async () => {
    const detected = await runDetect("manual");
    if (detected === null) return; // detectOnce already raised the failure toast
    toastSuccess(S.models.detectedProtocol(S.models.protocolNames[detected] ?? detected));
  };

  /**
   * Vision probe. Mirrors protocol detection — always clickable, single-flight, toast-only
   * — with one deliberate difference: it is a REAL completion on the user's credential
   * (an image request cannot be shaped to cost nothing the way the protocol probes are), so
   * it only ever runs from this button, never implicitly and never on save.
   *
   * Three outcomes, because "the probe failed" and "the model says no" are different facts:
   * a hit switches vision ON, a definitive image rejection switches it OFF, and a probe
   * that learned nothing leaves the switch exactly as the user had it.
   */
  const detectVisionFromButton = async () => {
    if (visionInFlight.current) return;
    const modelId = form.modelId.trim();
    if (!modelId) {
      toastError(S.models.detectVisionNeedsId);
      return;
    }
    setVisionDetecting(true);
    const run = (async () => {
      try {
        const body: ModelVisionDetectRequest = { provider: form.provider, modelId };
        const key = form.apiKeyInput.trim();
        if (key) body.apiKey = key;
        else if (form.clearApiKey) body.clearApiKey = true;
        const bu = form.baseUrl.trim();
        body.baseUrl = bu ? bu : null;
        if (form.clientType.trim()) body.clientType = form.clientType.trim();
        const res = await api.detectVision(projectId, body);
        if (res.outcome === "supported") {
          set({ vision: true });
          toastSuccess(S.models.detectVisionOk);
        } else if (res.outcome === "unsupported") {
          set({ vision: false });
          toastInfo(S.models.detectVisionNo);
        } else {
          toastError(S.models.detectFailedBody);
        }
      } catch {
        toastError(S.models.detectFailedBody);
      } finally {
        setVisionDetecting(false);
      }
    })();
    visionInFlight.current = run.finally(() => {
      visionInFlight.current = null;
    });
    await visionInFlight.current;
  };

  /**
   * Manual protocol override from the in-field picker. Bumping the run counter supersedes
   * any in-flight detection, so a late result cannot clobber a choice the user just made.
   */
  const pickProtocol = (clientType: ProtocolClientType) => {
    detectSeq.current++;
    setDetecting(false);
    setDetectFailed(false);
    set({ clientType });
  };

  /**
   * Validate and convert pricing back to USD storage; returns null on validation failure —
   * every error is placed below the offending input, which is highlighted red (no more
   * top-level banner: it's too far from the error site, and with three price fields it's
   * hard to tell which one is wrong).
   */
  // base URL required-field policy: an OpenAI-protocol endpoint can't be
  // inferred — required for custom / user-defined groups and entries with an explicit
  // openai protocol (gateway groups already have it pre-filled); optional for entries
  // auto-routed within a first-party vendor group (the client has its own official
  // default endpoint). Shared by validation and the label's required "*" mark.
  const openAiLike =
    form.clientType.trim().toLowerCase().includes("openai") ||
    form.provider === "custom" ||
    providerInfo(form.provider) === undefined;
  const baseUrlRequired = !preset && openAiLike;
  // Custom-like groups (custom + user-defined) pick among AgentHub's generic protocol
  // clients: the base URL field's suffix becomes the protocol picker there, unless the
  // entry carries a legacy vendor-pinned client_type — that keeps the read-only note below
  // instead. Gateways stay pinned to their preset protocol (their base URL is fixed too).
  const customLikeGroup = form.provider === "custom" || providerInfo(form.provider) === undefined;
  const showProtocolSelector =
    customLikeGroup && isGenericProtocolClientType(form.clientType) && !preset;
  // A viewer without edit rights gets the plain grey suffix: the picker would offer writes
  // the save path rejects anyway.
  const showProtocolPicker = showProtocolSelector && canEdit;
  // Protocol-path suffix shown inside the base URL field (every model, even while the
  // field is empty): the path the client appends to the base URL, i.e. the endpoint
  // shape a custom URL must serve. Recomputed from the live form so switching the
  // group in add mode updates it.
  const protocolPath = protocolPathForModel(form.provider, form.clientType);
  // Which protocol the picker shows as chosen — null while a fresh custom model has none.
  const protocolChoice = protocolSelectorValue(form.clientType);
  // In the picker, an unchosen protocol has no path to show: the field would otherwise
  // display /chat/completions and read as a decision the user never made. The placeholder
  // takes its place until a pick or a detection lands. (The read-only suffix used by preset
  // groups keeps showing the real path — those entries genuinely route that way.)
  const suffixLabel =
    showProtocolPicker && protocolChoice === null ? S.models.protocolUnset : protocolPath;

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
    if (baseUrlRequired && !baseUrl) errs.baseUrl = S.models.baseUrlRequired;

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

  /**
   * Commit one dialog action. Saving a custom-like entry whose protocol is still unset
   * detects it FIRST and continues with whatever comes back: asking the endpoint is more
   * reliable than guessing, so it is worth the round-trip.
   *
   * A probe that finds nothing no longer blocks (per maintainer: 默认都走兼容类型). The save
   * goes through on the compatible client, with a toast saying that is what happened —
   * detection is an accuracy improvement, not a gate, and refusing to save left the user
   * stuck on an endpoint that simply cannot be probed. Nothing unstartable is written
   * either way, because the fallback is a real client.
   *
   * The other actions (set-default / set-vision-proxy / remove) do not probe: they are not
   * the user saying "this model is ready", and rowToEntry's fallback still applies.
   */
  const submit = async (action: DialogAction) => {
    const next = validated();
    if (!next) return;
    if (needsProtocolDetectOnSave(action, next.provider, next.clientType)) {
      // Joins a run already started from the Detect button rather than probing twice.
      const detected = await runDetect("save");
      onSubmit({ ...next, clientType: detected ?? DEFAULT_CUSTOM_CLIENT_TYPE }, action);
      return;
    }
    onSubmit(next, action);
  };

  // Provider info for the current group (updates live as the group dropdown
  // changes): the "get model id / API key" links come from it (shown next to
  // the model id and API key labels in both the add and edit dialogs; custom
  // and self-defined groups have no link).
  const dialogProvider = providerInfo(form.provider);
  // env fallback resolves live from the current form (uses the same
  // resolveModelEnv as the server's getModels): explicit client_type takes
  // priority, otherwise auto-route by model_id; no fallback if it can't be routed.
  //
  // Custom and user-defined groups opt out of the model_id half (per maintainer): typing
  // `claude-sonnet-5` into a custom group must not quietly imply the Anthropic client and
  // its ANTHROPIC_* key. Those groups default to the compatible client, which is also what
  // gets persisted when nothing is picked or detected — so keying the hint off it is what
  // the entry will actually read after saving.
  const liveEnvKey = resolveModelEnv(
    form.modelId.trim(),
    envHintClientType(form.provider, form.clientType),
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
            {/* Required mark, hand-placed: this label row is custom (link on the right), so FieldLabel's asterisk doesn't apply. */}
            <span className="ml-0.5 text-red-500 dark:text-red-400" aria-hidden>
              *
            </span>
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
          required
          value={form.modelId}
          disabled={!canEdit}
          invalid={Boolean(fieldErrors.modelId)}
          onChange={(e) => set({ modelId: e.target.value })}
          className="font-mono"
          autoFocus={isNew}
          placeholder={S.models.modelIdHint}
        />
        {fieldErrors.modelId && <FieldError>{fieldErrors.modelId}</FieldError>}
      </label>
      {autoRouteMiss && (
        <div
          role="alert"
          className={`flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-xs ${toneStrip.attention}`}
        >
          <span>{S.models.autoRouteNone}</span>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() =>
              set({
                provider: "custom",
                clientType: clientTypeAfterProviderChange("custom", form.clientType),
              })
            }
          >
            {S.models.useCustomGroup}
          </Button>
        </div>
      )}
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
          onChange={(e) => {
            const provider = e.target.value;
            set({ provider, clientType: clientTypeAfterProviderChange(provider, form.clientType) });
          }}
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
        isNew
          ? vendorGroup
            ? S.models.addTitleVendor
            : customLikeGroup
              ? // Custom / user-defined groups no longer pin one protocol (detection + selector), so the title drops the "(OpenAI protocol)" suffix gateways keep.
                S.models.addTitleCustom
              : S.models.addTitle
          : S.models.editTitle
      }
      onClose={onClose}
      widthClass="sm:max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>{S.common.cancel}</Button>
          {canEdit && (
            <Button
              variant="primary"
              // Saving may have to probe the endpoint first (protocol still unset), which
              // is a network round-trip: the label says so and the button locks, matching
              // the "test connection" convention used inside this dialog.
              disabled={detecting}
              onClick={() => {
                // Validate first: if validation fails, the inline field errors show right away without popping the confirm dialog.
                if (!validated()) return;
                if (isNew || row === null) {
                  void submit("save");
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
              {detecting ? S.models.detecting : S.common.confirm}
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
                <GlyphIcon d={EXTERNAL_LINK_ICON} />
              </a>
            )}
          </div>
        )}

        {/* Adding a model: protocol note first (preset direct-vendor group = only the
            vendor's official protocol, named via the group label — the in-field suffix
            on the base URL below says which path; custom / self-defined group / gateway
            = fixed OpenAI protocol), then the identity fields ("get model id / API key"
            links next to the respective inputs; fill in the id to test connectivity —
            verify before saving). */}
        {isNew && (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {vendorGroup && dialogProvider
                ? S.models.vendorProtocolHint(dialogProvider.label)
                : customLikeGroup
                  ? S.models.addProtocolHintDetect
                  : S.models.addProtocolHint}
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

        {/* 2) base URL (required for custom / user-defined groups and explicit openai protocol — see
            baseUrlRequired). The in-field suffix at the right edge shows the protocol path the
            client appends to the base URL — the endpoint shape a custom URL must serve; it
            renders for every model and stays while the field is empty (hints the shape before
            typing). Reuses the unit-adornment idiom of the context window / max tokens fields
            below; the error text sits outside the relative wrapper (see Input.invalid).

            For custom / user-defined groups that suffix IS the protocol SELECTOR (see
            protocol-suffix.tsx): the path is one-to-one with the three generic protocol
            clients, so picking one reuses it instead of taking a form row of its own.
            Elsewhere (preset groups, read-only viewers) it stays the plain grey label it has
            always been.

            The detect ACTION sits at this field's top-right instead, next to the label — the
            same idiom as the API key field's "get API key" link above (per maintainer). It is
            gated on the API key, and a disabled row buried inside the suffix menu could not
            say so where the user is looking.

            A <div>, not a <label>: the picker is a <button>, and a label may not contain a
            second labelable element besides its control — the click would fire the button AND
            re-focus the input. Same shape as the API key block above; the input carries an
            aria-label so it stays named. */}
        <div className="block">
          {showProtocolPicker ? (
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                {S.models.baseUrl}
                {baseUrlRequired && (
                  <span className="ml-0.5 text-red-500 dark:text-red-400" aria-hidden>
                    *
                  </span>
                )}
              </span>
              {/* Always live: no API key is needed (the server falls back to the stored key
                  and then to the protocol's env var), and anything that does go wrong is
                  explained in a popup. `detecting` only guards re-entrancy. */}
              <button
                type="button"
                disabled={detecting}
                onClick={() => void detectFromButton()}
                title={S.models.detectProtocolHint}
                className="flex shrink-0 items-center gap-1 text-xs text-brand-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline dark:text-brand-300 dark:disabled:text-gray-500"
              >
                {detecting && (
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent"
                  />
                )}
                {detecting ? S.models.detecting : S.models.detectProtocol}
              </button>
            </span>
          ) : (
            <FieldLabel required={baseUrlRequired}>{S.models.baseUrl}</FieldLabel>
          )}
          <div className="relative">
            <Input
              size="sm"
              aria-label={S.models.baseUrl}
              required={baseUrlRequired}
              value={form.baseUrl}
              disabled={!canEdit}
              invalid={Boolean(fieldErrors.baseUrl)}
              // Editing the URL retires the previous run's verdict: it described the old
              // endpoint, and leaving it up would keep asserting a result for a URL that is
              // no longer in the field.
              onChange={(e) => {
                setDetectFailed(false);
                set({ baseUrl: e.target.value });
              }}
              // Detection on leaving the field (custom / user-defined groups): only a
              // probeable URL the user actually changed in this dialog triggers a run —
              // typing never fires requests, and a click-through must not rewrite a working
              className="font-mono"
              // Reserve room so the typed URL never slides under the suffix. Input and
              // suffix share the same monospace size, so the suffix width is its display
              // width in ch (CJK placeholder glyphs count double), plus the right offset
              // and — for the interactive version — its padding, gap and chevron. The
              // picker never changes width between states, so this holds for all of them.
              style={{
                paddingRight: `calc(${displayWidthCh(suffixLabel)}ch + ${showProtocolPicker ? "2.25rem" : "1.25rem"})`,
              }}
              // The read-only suffix is hover-transparent (pointer-events-none), so the
              // explanation rides on the input's title; the picker carries its own.
              title={S.models.baseUrlSuffixTitle}
              placeholder={preset ? S.models.baseUrlHint : "https://…"}
            />
            {showProtocolPicker ? (
              <div className="absolute inset-y-0 right-1 flex items-center">
                <ProtocolSuffixMenu
                  value={protocolChoice}
                  path={suffixLabel}
                  detecting={detecting}
                  tone={detectFailed ? "warn" : null}
                  onPick={pickProtocol}
                />
              </div>
            ) : (
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-xs text-gray-400">
                {protocolPath}
              </span>
            )}
          </div>
          {fieldErrors.baseUrl && <FieldError>{fieldErrors.baseUrl}</FieldError>}
          {/* No detection verdict is rendered here (per maintainer): a result must not take
              up room in the form. Both outcomes are toasts, and where the protocol ENDED UP
              is already visible in the suffix above, which is the thing that actually holds
              it. Nothing conditional remains below the field, so the idle and post-detection
              layouts are identical — no reserved height, no shift. */}
        </div>

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
        {/* Legacy entries carrying a client_type other than the standard openai-chat
            (historical config): read-only display. Compared canonically so the deprecated
            bare "openai" spelling (pre-0.4.2 configs) is not flagged as legacy either, and
            skipped when the protocol selector above already represents it (generic protocol
            types in custom-like groups are editable there). */}
        {!isNew &&
          !preset &&
          !showProtocolSelector &&
          form.clientType &&
          canonicalClientType(form.clientType) !== "openai-chat" && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {S.models.clientTypeLocked(form.clientType)}
            </p>
          )}

        {/* 6) Capability switches — vision support and fast mode side by side on one row,
            reusing the dialog's two-up grid (same `grid grid-cols-2 items-start gap-2` as the
            context-window / max-tokens row above, which already carries two full inputs at
            phone width; two compact switches are strictly narrower). `items-start` keeps both
            cells top-aligned when only one of them grows a muted hint line, and the hint text
            wraps inside its half-width cell rather than overflowing. Each switch is optional,
            so the row itself is conditional and a lone switch takes the whole width
            (toggleCellClass) — the layout must not depend on both being present. */}
        {showCapabilityRow && (
          <div className="grid grid-cols-2 items-start gap-2">
            {/* Vision capability: for preset models it's flagged by the built-in catalog
                (read-only, so no cell at all); custom models toggle it here — an iOS-style
                switch sitting inline right next to the label (per owner: no full-row stretch,
                no standing explanation text). Only the OFF state shows one small muted line:
                images are then read via the configured vision proxy model (describe_image). */}
            {showVision && (
              <div className={toggleCellClass}>
                {/* Detect sits inline after the switch — the protocol control's idiom, but next
                    to the setting it fills in rather than at a field's top-right, since this row
                    has no field to hang off. Always clickable, single-flight, toast-only, like
                    protocol detection; it just costs a real (tiny) completion, so it never runs
                    on its own. `flex-wrap` is what lets the switch and the trigger share a
                    half-width cell: when they do not both fit, the trigger drops onto its own
                    line inside the cell instead of widening the grid column. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                  {canEdit && (
                    <button
                      type="button"
                      disabled={visionDetecting}
                      onClick={() => void detectVisionFromButton()}
                      title={S.models.detectVisionHint}
                      className="flex shrink-0 items-center gap-1 text-xs text-brand-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline dark:text-brand-300 dark:disabled:text-gray-500"
                    >
                      {visionDetecting && (
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent"
                        />
                      )}
                      {visionDetecting ? S.models.detectingVision : S.models.detectVision}
                    </button>
                  )}
                </div>
                {!form.vision && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {S.models.visionOffProxyHint}
                  </p>
                )}
              </div>
            )}

            {/* Fast mode: per-model opt-in to the provider's faster serving tier (premium
                pricing). Offered only where AgentHub's routed client actually puts the
                parameter on the wire (fastModeProtocol) — a model whose client rejects it
                would otherwise arm a switch that kills the next turn. Same inline-switch shape
                as vision; the one small muted line appears in the non-default (ON) state, and
                the label's hover title reveals it before toggling. Enabling is confirmed
                (premium billing), disabling is immediate. */}
            {showFastMode && (
              <div className={toggleCellClass}>
                <label
                  className={`inline-flex items-center gap-2 ${canEdit ? "cursor-pointer" : "cursor-not-allowed"}`}
                  title={S.models.fastModeHint}
                >
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                    {S.models.fastMode}
                  </span>
                  <Switch
                    checked={form.fastMode}
                    disabled={!canEdit}
                    onChange={(fastMode) => {
                      // Only the ON direction is confirmed: it is the one that starts spending
                      // at premium rates. Turning it off costs nothing and must stay one click
                      // — it is the documented escape from a model that rejects the parameter.
                      if (fastMode) setConfirmingFastMode(true);
                      else set({ fastMode: false });
                    }}
                    aria-label={S.models.fastMode}
                  />
                </label>
                {form.fastMode && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {S.models.fastModeHint}
                  </p>
                )}
                {/* Reachable only for a stored annotation the rule would not have offered (a
                    hand-edited config, `--fast-mode`, or an id renamed after the fact): the
                    switch is kept visible precisely so it can be turned off, and says why it
                    should be. */}
                {form.fastMode && fastProtocol === undefined && (
                  <p className={`mt-1 text-xs ${toneInk.attention}`}>
                    {S.models.fastModeUnsupported}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Premium-billing warning, stacked on the config dialog the same way: fast mode moves
          the model onto the provider's premium price list while the recorded per-token prices
          stay standard, so the Cost center under-reports it — and on the Anthropic protocol
          access is a gated research preview that answers 429 until granted. Warning tone (the
          alert triangle) rather than the save pencil: nothing is being written yet, the point
          is what enabling costs. */}
      {confirmingFastMode && (
        <ConfirmModal
          open
          title={S.models.fastModeConfirmTitle}
          tone="danger"
          onClose={() => setConfirmingFastMode(false)}
          onConfirm={() => {
            setConfirmingFastMode(false);
            set({ fastMode: true });
          }}
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">{S.models.fastModeConfirmBody}</p>
          {fastProtocol === "anthropic" && (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {S.models.fastModeConfirmPreview}
            </p>
          )}
        </ConfirmModal>
      )}

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
            void submit(action);
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
          required
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
