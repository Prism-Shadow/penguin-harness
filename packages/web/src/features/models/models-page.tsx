/**
 * Model config page.
 *
 * Model entries are persisted as two independent fields, `provider` and `model_id`;
 * the (provider, model_id) pair is the entry's unique key — **zero
 * concatenation** anywhere in the pipeline, `model_id` is sent to MMSP verbatim as the
 * upstream request id. The dialog's identity section = (group dropdown, upstream id input);
 * changing either one is a rename, submitted as a paired `renamedFrom` (the server uses it
 * to migrate the credential and pointers).
 *
 * The list is purely for "finding a model": grouped by vendor (group header = logo + vendor
 * name + count + the collapse chevron), with one card per model within a group — the card
 * shows only the display name + status badges (default / vision / fast / free / discount), while
 * context, pricing, and key status are folded into a single line of small text. Clicking a card opens the config dialog
 * (credentials, context, pricing, vision toggle, plus set as default / set as vision model /
 * delete). The group header's right side holds the group's actions in a fixed order
 * (group-header.ts): its balance (one menu: pin, refresh, when it was read), the connection
 * ("Not connected", which connects, or one "Connected" menu: Sync models on Penguin Go,
 * Reconnect, Disconnect — group-connection.tsx), Add model (an icon) on the groups
 * that take hand-added models (custom, vLLM, OpenRouter, TokenDance, SiliconFlow, user-defined),
 * the speed test, and the gear last on every group: a menu with the group's sort and the group
 * settings (group-settings-menu.tsx, provider-settings-dialog.tsx).
 *
 * Each group orders its own models (model-sort.ts): by the price billed right now, low to high
 * unless the user picked otherwise from the gear, or by name. The choice is remembered per group
 * in this browser, applies to search results too, and leaves the group order and the chat model
 * picker alone.
 *
 * The groups stand in two areas (model-group-pins.ts): the favourites, always shown, then the
 * rest under one full-width bar that folds them away (folded by default). A star on each header,
 * shown on hover or focus, moves a group across; searching shows both areas, unfolded.
 *
 * A group holds its connection once — base URL, key and protocol in `[providers.<id>]`,
 * written by Connect and the group settings — and a model stores only what it overrides: every
 * field it leaves blank follows the group (connection.ts), and a field the group leaves blank
 * too is the client's default; the catalog is never a fallback. The dialogs say a blank field
 * follows the group without repeating the group's value, and a card prints the key the model is
 * actually used with. The "get model id / API key" external links sit next to the
 * corresponding input's label in the dialogs, never in the header. A TokenDance banner above
 * the groups offers its connect flow until the group holds a key. The group list ends with an
 * "add group" action (user-defined groups share custom's semantics; the group appears once the
 * first model saves successfully — groups are carried by the model entry's provider field).
 *
 * The page header holds two owner-only catalog actions next to the search box, both run by the
 * server: "Add new models" adds the presets the table lacks (shown only while there are some,
 * see catalog-sync.ts) and touches nothing else; "Restore defaults", behind a danger
 * confirmation, puts every built-in model back to the catalog while keeping keys and the
 * user's own models. Nothing else ever rewrites an existing row's catalog facts.
 *
 * Saving does a PUT full-table replace (models not present are deleted; an empty apiKey
 * means keep the existing value); only the owner can edit. The config dialog's Save (Add, for a
 * new model) is live once something changed and nothing is wrong; the dialog waits for the
 * write and closes only once it landed — a refused one leaves the table as it was and the draft
 * in the dialog — and closing it with unsaved edits asks first.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, ReactNode } from "react";
import type {
  CredentialInfo,
  ModelProtocolDetectRequest,
  ModelRefDto,
  ModelsResponse,
  ModelsUpdateRequest,
  ModelTestRequest,
  ModelUpdateEntry,
  ModelVisionDetectRequest,
  ProviderConnectionDto,
  ProviderConnectionUpdate,
} from "@prismshadow/penguin-server/api";
import {
  Badge,
  Button,
  Checkbox,
  Chevron,
  ChevronFlip,
  ConfirmModal,
  EmptyState,
  FieldError,
  FieldLabel,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Input,
  Link,
  Modal,
  NAV_FILL,
  NoticeStrip,
  PageFrame,
  PageHeader,
  PasswordInput,
  ProviderLogo,
  ROW_HOVER_BUTTON,
  Segmented,
  Select,
  SkeletonList,
  Spinner,
  Switch,
  TodoNotice,
  buttonClass,
  setDragPreview,
  toastError,
  toastInfo,
  toastSuccess,
  useFormDraft,
  useGuardedClose,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { closeUnlessBusy } from "../../lib/busy-close";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useProject } from "../../state/project";
import { useAuth } from "../../state/auth";
import { useLocale } from "../../state/locale";
import { USD_TO_CNY, useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { AiCreateModal } from "../ai-create";
import { AiCreateButtons } from "../ai-create/ai-create-buttons";
import { formatDateTime, humanizeTokens } from "../../lib/format";
import {
  MODEL_PROVIDERS,
  PENGUIN_GO_PROVIDER_ID,
  canonicalClientType,
  catalogEntryFor,
  fastModeProtocol,
  groupKeyReaches,
  isAddableGroup,
  modelHomepageUrl,
  providerInfo,
  unroutableVendorModel,
} from "@prismshadow/penguin-core/model-catalog";
import type {
  FastModeProtocol,
  ModelProviderBridgeAuth,
  ModelProviderInfo,
} from "@prismshadow/penguin-core/model-catalog";
import {
  allGroupKeys,
  discountedPrice,
  fractionOff,
  groupModelRows,
  isFreeModel,
  sameModelRef,
  userProviderInfo,
} from "./model-grouping";
import {
  commitModelGroupOrder,
  loadModelGroupOrder,
  saveModelGroupOrder,
} from "./model-group-order";
import { TAG_TONE, modelTags } from "./model-tags";
import { protocolPathForModel } from "./protocol-path";
import { ProtocolSuffixMenu } from "./protocol-suffix";
import {
  DEFAULT_CUSTOM_CLIENT_TYPE,
  detectableBaseUrl,
  displayWidthCh,
  envHintKeyFor,
  isCustomLikeGroup,
  isGenericProtocolClientType,
  needsProtocolDetectOnSave,
  protocolForPersist,
  protocolSelectorValue,
} from "./protocol-types";
import type { InheritedProtocol, ProtocolClientType } from "./protocol-types";
import {
  isGroupExpanded,
  loadExpandedProviders,
  saveExpandedProviders,
  toggleExpandedProvider,
} from "./model-group-expansion";
import {
  initialModelGroupPins,
  initialModelGroupsFolded,
  isModelGroupPinned,
  modelGroupLayout,
  pinsAfterDrop,
  storeModelGroupPins,
  storeModelGroupsFolded,
  withModelGroupPinned,
} from "./model-group-pins";
import type { ModelGroupPins } from "./model-group-pins";
import { clearDraftModelRef } from "../chat/draft-cache";
import { useUpdateBadges } from "../../lib/use-update-badges";
import { dismissTodo } from "../../lib/todo-dismissals";
import { refreshProjectTodos } from "../../lib/use-project-todos";
import { AddNewModelsButton, AddNewModelsConfirm, RestoreDefaultsConfirm } from "./preset-sync";
import type { PresetSyncHost } from "./preset-sync";
import { buildImportedRows, groupImportConnection } from "./group-import";
import {
  applyProviderUpdate,
  groupKeyMissesRow,
  groupShape,
  inheritedConnection,
  rowKey,
} from "./connection";
import type { ProviderConnections } from "./connection";
import { ProviderSettingsDialog } from "./provider-settings-dialog";
import { GroupSettingsControl } from "./group-settings-menu";
import {
  initialModelGroupSorts,
  modelGroupSortOf,
  sortModelGroups,
  storeModelGroupSorts,
  withModelGroupSort,
} from "./model-sort";
import type { ModelGroupSort } from "./model-sort";
import { tpsTone, ttftTone } from "./speed-test";
import type { SpeedResult, SpeedTone } from "./speed-test";
import { toneInk } from "../../lib/tone";
import { KeyAuthDialog } from "./key-auth-dialog";
import type { KeyAuthTexts } from "./key-auth-dialog";
import {
  HEADER_BUTTON,
  HEADER_LABEL,
  HEADER_SQUARE,
  groupHeaderActions,
  groupKeyFromEnv,
  groupKeyStored,
} from "./group-header";
import type { GroupHeaderAction } from "./group-header";
import { GroupBalance } from "./group-balance";
import { DisconnectConfirm, GroupConnection } from "./group-connection";
import { DetailsFold, MODEL_DIALOG_SLOTS, foldedErrors, foldedSlots } from "./model-dialog-details";
import type { ModelDialogSlot } from "./model-dialog-details";
import { isPinned, usePinnedBalance } from "./balance";
import { TOKENDANCE_PROVIDER_ID, TokenDanceBanner } from "./tokendance-banner";

/**
 * The authorization flows a group's Connect dialog can run, keyed by the flow named in that
 * group's catalog descriptor. Everything the two differ in lives here — the four
 * endpoint calls and the copy — because everything else about the dialog is shared, and a
 * group picks its entry by carrying `bridgeAuth` rather than by being named in this file.
 */
const KEY_AUTH: Record<
  ModelProviderBridgeAuth["flow"],
  { endpoints: api.KeyAuthEndpoints; texts: KeyAuthTexts }
> = {
  "penguin-go": {
    endpoints: api.platformAuthEndpoints,
    texts: {
      intro: S.models.platformKeyIntro,
      appliedBody: S.models.platformKeyAppliedBody,
      errors: S.models.platformKeyErrors,
    },
  },
  modelscope: {
    endpoints: api.modelScopeAuthEndpoints,
    texts: {
      intro: S.models.modelScopeKeyIntro,
      appliedBody: S.models.modelScopeKeyAppliedBody,
      errors: S.models.modelScopeKeyErrors,
    },
  },
};

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

/** Metric tone -> text color classes for the card speed badges. */
const TONE_CLASS: Record<SpeedTone, string> = {
  green: toneInk.success,
  yellow: toneInk.attention,
  red: toneInk.danger,
};

/**
 * In-page Map key for a paired reference — the same NUL-separated shape the server uses, and
 * never persisted. Keys every per-model side table the page holds: speed results, spend totals.
 */
const refMapKey = (provider: string, modelId: string) => `${provider}\u0000${modelId}`;

/**
 * Context window (tokens) recorded for a custom or user-group model whose field is left blank.
 *
 * A million, not the 128000 the rest of the app assumes for an *unknown* window. The two answer
 * different questions: the assumption exists so a model with nothing on file still gets a
 * conservative compaction threshold, while this is a value the dialog is about to WRITE, on an
 * entry the user is adding by hand — and models being added by hand today are large-window ones.
 * Guessing low there costs real capacity (the ring reads full, compaction fires early) for a
 * model that can hold far more; guessing high costs a number the user narrows once, when the
 * endpoint turns out to serve less. Preset entries left blank still mean "unknown" and stay
 * blank.
 */
const CUSTOM_CONTEXT_DEFAULT = 1000000;

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
 * The client type an entry carries of its own after it is moved into `provider`, where
 * `inherited` is the protocol a row there follows when it sets none (the group's table; none by
 * default).
 *
 * A group that decides a protocol is followed: the entry drops whatever it carried and stores
 * nothing, so it speaks what the rest of the group speaks and keeps following a later change of
 * the group's protocol. A custom-like group is the exception for a generic protocol the entry
 * already chose — protocol detection and the in-field picker manage those, and the choice stays.
 * Moving to Custom with nothing to follow keeps a generic protocol and otherwise switches to
 * the generic OpenAI Chat Completions client — an unroutable or vendor-pinned type must not
 * leak into a custom group. Every other group keeps the current value: a first-party group
 * auto-routes by id.
 */
export function clientTypeAfterProviderChange(
  provider: string,
  current: string,
  inherited: InheritedProtocol = {},
): string {
  const generic = current.trim() !== "" && isGenericProtocolClientType(current);
  if (inherited.clientType?.trim()) return isCustomLikeGroup(provider) && generic ? current : "";
  if (provider !== "custom") return current;
  return generic ? current : "openai-chat";
}

/**
 * Who asked for a detection run. Only the failure wording differs: a manual run reports a
 * failure, a save-triggered one reports the fallback it is proceeding with.
 */
type DetectMode = "manual" | "save";

/**
 * What a detection run yields. The server probes neighbouring forms of the URL that was
 * typed, so it reports back which one actually served the protocol; `baseUrl` carries that
 * form only when it differs from what the field held, i.e. only when the field needs
 * correcting.
 */
interface DetectOutcome {
  clientType: string;
  baseUrl?: string;
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
  /** Upstream model id (i.e. the stored model_id, sent to MMSP verbatim). */
  modelId: string;
  /**
   * The identity as loaded (paired reference): differing from the current (provider,
   * modelId) in either field means a rename — submitted as a paired renamedFrom, which the
   * server uses to migrate the credential and pointers. null for a new entry.
   */
  original: ModelRefDto | null;
  /**
   * What the model is called: the user's own name, or the built-in catalog's. Absent means the
   * model has no name (a custom one, or a catalog row loaded before the name was filled in) and
   * asks the server to inherit the catalog's; the empty string means a name the user cleared,
   * which is a different request — see rowToEntry.
   */
  displayName?: string;
  /**
   * Whether to treat this as a vision model: the row's `vision` annotation, absent meaning
   * supported (a new Project writes `false` where the catalog says a preset takes no images);
   * custom models are editable here.
   */
  vision: boolean;
  /** Environment variable name used as fallback when api_key is empty (given by the server based on catalog/protocol). */
  envKey?: string;
  /** Masked preview of the env-fallback value (first-party official entries only; the plaintext never leaves the server). */
  envKeyMasked?: string;
  contextWindow: string;
  /** Per-model max output tokens ("" = inherit the Agent setting): caps output per request; user-only, never preset by the catalog. */
  maxTokens: string;
  /**
   * Per-model fast mode (premium faster serving tier, MMSP `fast_mode`): off by default;
   * user-only, never preset by the catalog, editable on every model (preset ones included).
   * Models without a fast tier reject requests carrying it, hence the standing hint while ON.
   */
  fastMode: boolean;
  /**
   * The row's OWN MMSP client type — an override of its group's. Empty means the row follows its
   * group (connection.ts): a gateway preset follows its group's protocol, a vendor preset is
   * routed by the vendor family its id begins with, and a NEW custom model starts with nothing
   * selected until the user picks from the base URL field's suffix or a detection run fills it
   * in. Never persisted empty for a custom-like entry that would otherwise resolve to no
   * protocol — see protocolForPersist.
   */
  clientType: string;
  /** Price buckets in USD per million tokens: the list price, any promotion kept in `discount`. */
  cacheRead: string;
  cacheWrite: string;
  output: string;
  /**
   * The running promotion the server reports for this row: a fraction off the list price above
   * (0.5 = half price), stored outside the config file and applied when usage is priced. Absent
   * when the row has none.
   */
  discount?: number;
  /**
   * The row's OWN base URL input (empty = follow the group, else the client's default endpoint);
   * compared against originalBaseUrl to decide omit/override/clear (null).
   */
  baseUrl: string;
  originalBaseUrl: string;
  /** Newly entered API key of the row's own; empty means keep the existing value. */
  apiKeyInput: string;
  clearApiKey: boolean;
  /** The row's OWN stored key (masked) and base URL; a group key is in the page's providers map. */
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

/**
 * MMSP's compatible clients that speak an OpenAI protocol, plus the deprecated bare `openai`
 * alias: an entry pinned to one of them names no vendor, so its endpoint cannot be inferred
 * (see the dialog's base URL policy). `openai-official` is deliberately absent — it is
 * OpenAI's own client, with OpenAI's default endpoint.
 */
const OPENAI_COMPATIBLE_CLIENT_TYPES: ReadonlySet<string> = new Set([
  "openai",
  "openai-chat",
  "openai-responses",
  "openai-chat-vllm-adapter",
  "openai-embedding",
]);

/**
 * What to tell the owner of an entry its vendor group cannot route — `null` when there is
 * nothing wrong with it, `"custom"` when there is: an id of no vendor family MMSP knows, added
 * by hand into a group that routes by id, belongs under a custom group where a protocol can be
 * picked or detected. `clientType` is the protocol the entry is used with — its own, else its
 * group's — since a group protocol set in the group settings routes it too.
 *
 * Judged on the CURRENT reference rather than the identity as loaded (isPreset): an id the
 * user has just retyped is a different model.
 */
export function unroutableFix(
  provider: string,
  modelId: string,
  clientType: string,
): "custom" | null {
  return unroutableVendorModel(provider, modelId, clientType) ? "custom" : null;
}

/**
 * Whether this row already has (or will have, after this edit) an API key: its own, a key typed
 * into the dialog and not saved yet, its group's, or an env fallback the server proved is set —
 * the ladder connection.ts's rowKey walks, with the group's stored connection beside it.
 * `clearApiKey` drops the row's OWN key only, so a row whose group holds a key keeps a key
 * through a clear.
 */
export function hasKey(row: RowState, group?: ProviderConnectionDto): boolean {
  return rowKey(row, group).source !== "none";
}

/**
 * The model card's key status line, most specific first: a key typed but not yet saved has no
 * mask of its own and just reads as configured; otherwise the mask of the key the row is used
 * with — its own, its group's, or a detected env fallback's (the server reports that one only
 * where the environment may lend it) — so every source of a key reads alike, and "not
 * configured" only where there is none. The source is the card's tooltip's business
 * (keyStatusNote), not this line's.
 */
export function keyStatusText(row: RowState, group?: ProviderConnectionDto): string {
  const key = rowKey(row, group);
  if (key.source === "none") return S.models.noKey;
  return key.masked ?? S.models.keyConfigured;
}

/**
 * The quiet note on a card's key status naming where an inherited key comes from — the group's
 * key, or the environment — and nothing for a key that is the model's own (or typed in), which
 * needs no explaining.
 */
export function keyStatusNote(row: RowState, group?: ProviderConnectionDto): string | undefined {
  const { source } = rowKey(row, group);
  if (source === "provider") return S.models.keyFromGroup;
  if (source === "env") return S.models.readFromEnv;
  return undefined;
}

/**
 * A counter that advances on every clock hour, for prices that change with the time of day.
 *
 * DeepSeek's off-peak rate starts and ends on the hour, and every window a catalog schedule can
 * express is hour-aligned, so waking once an hour is enough to keep a card honest — a page left
 * open at 08:59 would otherwise still be promising half price at 09:05. It re-aims at the next
 * hour each time rather than running on a fixed interval, so it neither drifts nor fires 60
 * times to catch one transition.
 */
function useHourTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (): void => {
      const now = new Date();
      const next = new Date(now);
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      timer = setTimeout(() => {
        setTick((n) => n + 1);
        schedule();
      }, next.getTime() - now.getTime());
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return tick;
}

/**
 * What to call a model in prose — its display name, or its upstream id when it has none.
 *
 * The blank test is `trim()`, not `!== undefined`: the display name is optional and the dialog
 * clears it to an empty string, so `displayName ?? modelId` would quote an empty name back at
 * the user — which is how a save confirmation came to read 「」.
 */
export function modelLabelOf(displayName: string | undefined, modelId: string): string {
  return displayName?.trim() || modelId;
}

/**
 * What to store for one price bucket on submit: the value as typed, or — when the field still
 * holds exactly what was loaded into it — the stored number byte for byte.
 *
 * Loading rounds the stored USD to four decimals so it is typeable (`usdToInput`), so
 * re-encoding an untouched field would commit that rounding as the new price: a silent edit of
 * a number nobody changed. Small, but not nothing — a catalog row listed at CNY 0.05 per
 * million lands on $0.0071 instead of $0.00714285…, which is a price change: the save would
 * cancel the row's promotion, and a scheduled row would leave the catalog's peak price and
 * lose its off-peak mark. Editing the field is what makes the typed value authoritative.
 */
export function priceToSubmit(
  formValue: string,
  storedUsd: string | undefined,
  currency: Currency,
): string {
  if (
    storedUsd !== undefined &&
    storedUsd !== "" &&
    formValue.trim() === usdToInput(storedUsd, currency)
  ) {
    return storedUsd;
  }
  return inputToUsd(formValue, currency);
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
  if (m.envKeyMasked !== undefined) row.envKeyMasked = m.envKeyMasked;
  if (m.credential) row.credential = m.credential;
  if (m.discount !== undefined) row.discount = m.discount;
  return row;
}

/**
 * The env-fallback variables the server proved are set (exported for unit tests): it reports
 * `envKeyMasked` only for a variable that currently holds a value, and an environment is
 * process-wide, so one row carrying it settles the question for every entry reading the same
 * variable. A hint may promise "leave this empty and the environment covers it" only for a
 * variable in here — elsewhere the page cannot tell a set variable from an absent one, and an
 * empty field would leave the model with no key at all.
 */
export function detectedEnvKeys(rows: readonly RowState[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.envKeyMasked !== undefined && row.envKey !== undefined) keys.add(row.envKey);
  }
  return keys;
}

/**
 * Whether the model dialog offers the fast-mode switch for a draft row, and on which protocol
 * the parameter would travel.
 *
 * `protocol` is the routed MMSP client's own answer (see fastModeProtocol): `undefined`
 * means that client rejects `fast_mode` — or the id routes to no client at all — so arming
 * the switch could only produce a turn-killing error, and it is not offered. `show` adds
 * the one exception: a row that already stores fast mode keeps its switch regardless, because a
 * value that arrived another way (a hand-edited config, `penguin config model add
 * --fast-mode`, or an upstream id renamed afterwards) has to remain switchable off — the
 * runtime rejection tells the user to turn it off in the model settings, and that has to be
 * true. `protocol` also picks the warning copy: only Anthropic's fast mode is a gated
 * research preview.
 *
 * The client type and base URL are the ones the entry will actually be USED with — its own,
 * else what it inherits from its group (`inherited`, none by default) — and for a custom-like
 * entry that resolves to none, the compatible client it will be saved on, for the same reason
 * envHintClientType exists: a custom-like group leaves the protocol empty until detection or a
 * manual pick fills it in, and fastModeProtocol would then
 * fall back to routing by model id. Typing an id that routes to a client with no fast tier
 * (`kimi-k3`, `deepseek-v4-pro`) into a custom group would hide a switch that the persisted
 * `openai-chat` entry can in fact serve. An empty result keeps the id-based routing the preset
 * and vendor groups genuinely use.
 */
export function fastModeState(
  row: Pick<RowState, "provider" | "modelId" | "clientType" | "baseUrl" | "fastMode">,
  inherited: {
    clientType?: string | undefined;
    baseUrl?: string | undefined;
  } = {},
): { protocol: FastModeProtocol | undefined; show: boolean } {
  const clientType =
    row.clientType.trim() ||
    inherited.clientType?.trim() ||
    (isCustomLikeGroup(row.provider) ? DEFAULT_CUSTOM_CLIENT_TYPE : "");
  const protocol = fastModeProtocol(
    row.modelId.trim(),
    clientType || undefined,
    row.baseUrl.trim() || inherited.baseUrl?.trim() || undefined,
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

/**
 * What the model dialogs' API key and base URL fields say while blank (exported for unit tests).
 * Where the group's setting covers a blank field, the field says so and nothing more — not the
 * group's URL, not its masked key: those are the group's, shown in its settings.
 *
 * - API key, most specific first: a key of the model's own means keep it; a group key that
 *   reaches the model (connection.ts) means it follows the group; a variable the environment
 *   holds (`envKey`, only where nothing else covers the model) means the environment answers; a
 *   group key that does NOT reach the model — its own base URL is on another origin — is said
 *   outright, since the card will read "not configured"; otherwise nothing truthful can be said.
 * - Base URL: the group's setting where it has one; else the shape a required one takes; else
 *   what an empty one means — the client's default endpoint.
 */
export function connectionPlaceholders(
  draft: Pick<RowState, "provider" | "modelId" | "baseUrl" | "credential">,
  group: ProviderConnectionDto | undefined,
  { envKey, baseUrlRequired }: { envKey?: string | undefined; baseUrlRequired: boolean },
): { apiKey: string | undefined; baseUrl: string } {
  const inherited = inheritedConnection(draft.provider, draft.modelId, group, draft.baseUrl);
  const apiKey = draft.credential?.apiKeyMasked
    ? S.models.apiKeyKeepHint
    : inherited.apiKeySource === "provider"
      ? S.models.inheritFromGroup
      : envKey !== undefined
        ? S.models.apiKeyEnvHint(envKey)
        : groupKeyMissesRow(draft.baseUrl, group)
          ? S.models.keyNotReachedNote
          : undefined;
  const baseUrl =
    inherited.baseUrl !== undefined
      ? S.models.inheritFromGroup
      : baseUrlRequired
        ? "https://…"
        : S.models.baseUrlNone;
  return { apiKey, baseUrl };
}

/**
 * Row edit state -> wire entry (exported for unit tests): the single funnel into the config PUT.
 * A model sends only what it sets of its own; `group` is its group's stored connection, against
 * which a blank protocol is judged (see protocolForPersist).
 */
export function rowToEntry(row: RowState, group?: ProviderConnectionDto): ModelUpdateEntry {
  // provider and modelId are always submitted as separate fields ((provider, modelId) is the entry's unique key, no concatenation).
  const entry: ModelUpdateEntry = { provider: row.provider, modelId: row.modelId };
  // Rename (either provider or model_id changing is a key change): include the original paired reference so the server
  // migrates the credential and unknown fields (otherwise a full-table replace would drop them).
  if (row.original && !sameModelRef(row.original, rowRef(row))) {
    entry.renamedFrom = row.original;
  }
  // Display name: submitted whenever the row carries one at all, the empty string included —
  // absent means "inherit whatever the catalog calls this model" and empty means "the user
  // cleared it", so a row that simply has no name must not travel as a deletion. The server
  // only persists a name that differs from the built-in catalog (keeps preset configs clean).
  if (row.displayName !== undefined) entry.displayName = row.displayName.trim();
  const cw = Number(row.contextWindow.trim());
  if (row.contextWindow.trim() && Number.isFinite(cw)) entry.contextWindow = cw;
  // Only the row's own protocol: a blank one follows the group. The exception is a custom-like
  // entry that would resolve to none, which could not start (see protocolForPersist); preset /
  // vendor rows keep "" so MMSP routes by the id's vendor family.
  const clientType = protocolForPersist(
    row.provider,
    row.clientType,
    inheritedConnection(row.provider, row.modelId, group),
  );
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
  // The promotion is never sent: the server keeps the stored one unless this entry renames
  // the row or changes its price.
  if (row.apiKeyInput.trim()) entry.apiKey = row.apiKeyInput.trim();
  if (row.clearApiKey) entry.clearApiKey = true;
  const baseUrl = row.baseUrl.trim();
  if (baseUrl !== row.originalBaseUrl) {
    // Submit only on change: non-empty overrides, empty explicitly sets null to clear.
    entry.baseUrl = baseUrl ? baseUrl : null;
  }
  return entry;
}

/**
 * Private drag payload type of a provider-group reorder. Deliberately NOT the sidebar's
 * group MIME: the sidebar renders alongside this page, so one shared type would let a
 * group dragged out of the conversation list paint a drop line here (and vice versa) —
 * two unrelated orders that happen to be dragged the same way.
 */
const MODEL_GROUP_DRAG_MIME = "application/x-penguin-model-group";

/**
 * Is the drag in flight one of our group reorders? `types` is readable during dragover
 * (unlike getData), so the payload authorizes the drop rather than React state alone:
 * without it, a `dragGroup` left behind by a header that unmounted mid-drag would make the
 * page swallow an unrelated drag, paint a phantom line, and commit on release.
 */
const isModelGroupDrag = (e: ReactDragEvent): boolean =>
  e.dataTransfer.types.includes(MODEL_GROUP_DRAG_MIME);

/** Dragging a group needs a pointer that can drag — HTML5 drag-and-drop never fires from touch (the sidebar's query). */
const DRAG_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

export function ModelsPage() {
  useDocumentTitle(S.models.title);
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const isOwner = currentProject?.role === "owner";
  /** The Models trail's raised badge, or undefined — "Add new models" and the notice appear with it. */
  const todo = useUpdateBadges().todos.models;
  /** What the trail says, read at render time: `S` is a live binding swapped on locale change. */
  const syncNote = todo ? S.todo.presetUpdates(todo.count) : "";
  /** The notice's confirmation of adding the new presets is open (it lists the refs the delta named). */
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  /** "Restore defaults" is waiting on its danger confirmation. */
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const userId = useAuth().user?.userId ?? null;
  /** Per-model speed results (in-memory, reset on every project switch; "pending" while that model's turn is running). */
  const [speedResults, setSpeedResults] = useState<Map<string, SpeedResult | "pending">>(new Map());
  /** Group whose speed-test confirmation dialog is open (provider id). */
  const [speedFor, setSpeedFor] = useState<string | null>(null);
  /** Group currently being speed-tested (provider id); tests run strictly one model at a time. */
  const [speedRunning, setSpeedRunning] = useState<string | null>(null);
  /**
   * The running test was asked to stop. A ref for the loop, which reads it between probes; the
   * state mirror disables the stop button meanwhile, since the probe in flight still has to
   * come back before the loop can see it.
   */
  const speedStopRef = useRef(false);
  const [speedStopping, setSpeedStopping] = useState(false);
  /** The balance pinned beside the user name, so its group's header keeps the pin to undo it. */
  const pinnedBalance = usePinnedBalance();

  const [rows, setRows] = useState<RowState[] | null>(null);
  /** Every group's stored connection (`[providers.<id>]`), off the same responses as `rows`. */
  const [providers, setProviders] = useState<ProviderConnections>({});
  const [defaultModel, setDefaultModel] = useState<ModelRefDto | undefined>(undefined);
  // Vision model used for read_file's proxy reads (describes images for session models with vision=false).
  const [visionModel, setVisionModel] = useState<ModelRefDto | undefined>(undefined);
  /** Edit target: paired reference of an existing row. */
  const [editing, setEditing] = useState<ModelRefDto | null>(null);
  /**
   * Whether the dialog about to open should already have moved its row into the custom
   * group: set by a card's "move to custom group" action, which is a shortcut into the
   * config dialog rather than a write of its own — the move needs a protocol and a base URL,
   * and the dialog is where those are picked and confirmed.
   */
  const [editingMovedToCustom, setEditingMovedToCustom] = useState(false);
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
  /**
   * This Project's manual group order (empty = the catalog's own sequence). Hydrated and
   * re-hydrated exactly like the expansion set above, and written back on every drop.
   */
  const [groupOrder, setGroupOrder] = useState<readonly string[]>(() =>
    loadModelGroupOrder(projectId),
  );
  useEffect(() => {
    setGroupOrder(loadModelGroupOrder(projectId));
  }, [projectId]);
  /**
   * Which groups stay out of the fold: the user's differences from the default pinned set
   * (model-group-pins.ts), per browser like the sidebar nav's, so not re-read on a Project switch.
   */
  const [groupPins, setGroupPins] = useState(initialModelGroupPins);
  /**
   * How each group orders its models, where the user changed it from price low to high
   * (model-sort.ts); per browser like the pins, so not re-read on a Project switch.
   */
  const [groupSorts, setGroupSorts] = useState(initialModelGroupSorts);
  /** The UI language, which a sort by name collates in. */
  const { locale } = useLocale();
  /** Whether the collapsible groups are folded away under their bar; folded by default, remembered per browser. */
  const [groupsFolded, setGroupsFolded] = useState(initialModelGroupsFolded);
  /**
   * The group whose star takes focus once its header re-mounts in the other area: moving a
   * group moves its section to another container, and the star that had focus goes with the
   * old one — a keyboard user would be dropped onto <body>.
   */
  const lockFocusRef = useRef<string | null>(null);
  /** The fold bar: where focus goes when the moved group lands in the folded (inert) area. */
  const foldBarRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Whether the reorder gesture is offered at all. A stored order still APPLIES without
   * it: the arrangement is per Project and implicit, so there is nothing to degrade —
   * a phone renders what its owner arranged at a desk.
   */
  const [canDrag, setCanDrag] = useState(() => window.matchMedia(DRAG_POINTER_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DRAG_POINTER_QUERY);
    const onChange = (e: MediaQueryListEvent) => setCanDrag(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  /** Group header being dragged (its provider id) and the live drop hint (target group + which edge). */
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [groupDropHint, setGroupDropHint] = useState<{ key: string; after: boolean } | null>(null);
  /** Group (provider id) whose Disconnect confirmation is open (its Connected menu's last row). */
  const [disconnectFor, setDisconnectFor] = useState<string | null>(null);
  /** Group (provider id) whose settings dialog (the header's gear) is open. */
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  /** Vendor group (provider id) whose authorization dialog is open (groups that publish a key-minting flow only). */
  const [oauthFor, setOauthFor] = useState<string | null>(null);
  /** Whether the open authorization actually wrote a key — see the dialog's `onClose`. */
  const keyLanded = useRef(false);
  /** User-defined group (provider id) whose delete confirmation is open (built-in groups never offer this). */
  const [deleteGroupFor, setDeleteGroupFor] = useState<string | null>(null);
  /** "Add group" popup (user-defined group): create-only hands off to that group's add-model dialog, import mode fills the group from its endpoint (see AddGroupDialog). */
  const [addGroupOpen, setAddGroupOpen] = useState(false);
  /** "Add models with AI" dialog: the prompt goes to the Project's default agent. */
  const [aiAddOpen, setAiAddOpen] = useState(false);
  /** Initial load failure: shown inline only when the whole page has no content (there's no context to pop a toast against). */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Currency follows the user setting (toggled in sidebar settings).
  const { currency } = useTheme();

  /**
   * Lifetime Token total per model, keyed by the paired reference. Fetched on its own rather
   * than folded into the model list: it is telemetry hanging off a configuration page, and a
   * stats failure must cost the figure, not the page — so the failure path just leaves the map
   * empty and every card renders without its number.
   */
  const [usedTokens, setUsedTokens] = useState<Map<string, number>>(new Map());
  const hourTick = useHourTick();

  /** Takes in a table the server answered with: the rows, the groups' connections, the two refs. */
  const adopt = useCallback((res: ModelsResponse) => {
    setRows(res.models.map(toRow));
    setProviders(res.providers ?? {});
    setDefaultModel(res.defaultModel);
    setVisionModel(res.visionModel);
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setRows(null);
    setLoadError(null);
    // Speed results are keyed by (provider, model_id) only, so another Project's identically
    // named model would inherit a timing measured against a different endpoint and key —
    // drop them along with the rows they annotate whenever the active Project changes.
    setSpeedResults(new Map());
    try {
      adopt(await api.getModels(projectId));
    } catch (e) {
      setLoadError(apiErrorText(e));
    }
    try {
      const totals = await api.getUsageModelTotals(projectId);
      setUsedTokens(
        new Map(totals.totals.map((t) => [refMapKey(t.provider, t.modelId), t.tokens])),
      );
    } catch {
      // Fail-soft, and deliberately silent: the page's job is configuring models, and a figure
      // that could not be read is shown as absent rather than as an error the user cannot act on.
      setUsedTokens(new Map());
    }
  }, [projectId, adopt]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Writes the whole table (the dialog's Save / Add, set default, set vision model, delete).
   * Resolves with whether it landed. On failure the table on screen stays as the server last
   * answered — nothing that was not written shows as if it had been — and the error is a toast;
   * a dialog that asked keeps its draft open for a retry.
   */
  const persist = async (
    nextRows: RowState[],
    nextDefault: ModelRefDto | undefined,
    nextVision: ModelRefDto | undefined,
    /** Success toast text (defaults to "saved"); on failure this function shows an error toast instead. */
    successText?: string,
    /** Group connections written in the same request (an import writes its group's once). */
    providerUpdates?: Record<string, ProviderConnectionUpdate>,
  ): Promise<boolean> => {
    if (!projectId) return false;
    setBusy(true);
    // The vision model pointer must point to a row that still exists and isn't marked "doesn't support images" (invalidated on delete/re-annotation).
    const effectiveVision =
      nextVision && nextRows.some((r) => sameModelRef(rowRef(r), nextVision) && r.vision)
        ? nextVision
        : undefined;
    // Each row's blank fields are judged against its group as this request will leave it.
    const groupAfter = (id: string) =>
      providerUpdates?.[id] !== undefined
        ? applyProviderUpdate(providers[id], providerUpdates[id]!)
        : providers[id];
    try {
      const body: ModelsUpdateRequest = {
        models: nextRows.map((r) => rowToEntry(r, groupAfter(r.provider))),
      };
      if (providerUpdates !== undefined) body.providers = providerUpdates;
      if (nextDefault) body.defaultModel = nextDefault;
      if (effectiveVision) body.visionModel = effectiveVision;
      const res = await api.putModels(projectId, body);
      adopt(res);
      // Default model changed: drop the stored draft's model selection so the draft chat
      // follows the new default (a stored pick would otherwise pin the old model forever).
      if (userId && res.defaultModel && !sameModelRef(res.defaultModel, defaultModel)) {
        clearDraftModelRef(userId, projectId);
      }
      toastSuccess(successText ?? S.common.saved);
      return true;
    } catch (e) {
      toastError(apiErrorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * The groups on screen, each one's models in that group's sort. `hourTick` re-sorts on the
   * hour: a price sort reads the rate billed right now, which an off-peak tier changes.
   */
  const groups = useMemo(
    () =>
      rows
        ? sortModelGroups(groupModelRows(rows, query, groupOrder), groupSorts, new Date(), locale)
        : [],
    [rows, query, groupOrder, groupSorts, locale, hourTick],
  );
  /**
   * Every group the library could show, empty built-ins included — the sequence a drop is
   * committed against, so a provider currently holding no models keeps its catalog place
   * rather than arriving as a newcomer the day one is added to it.
   */
  const allKeys = useMemo(() => allGroupKeys(rows ?? []), [rows]);
  /** Env-fallback variables the server reported a value for: the only ones a key hint may promise. */
  const envKeysDetected = useMemo(() => detectedEnvKeys(rows ?? []), [rows]);
  /** Non-empty search query: groups are filtered to matches and force-opened while it lasts. */
  const searching = query.trim() !== "";

  /**
   * What the two catalog actions (preset-sync.tsx) run against: this Project's saved table, the
   * page's busy flag, and the Models badge re-probe. Null until a Project is open.
   */
  const presetHost: PresetSyncHost | null = projectId
    ? {
        projectId,
        adopt,
        setBusy,
        refreshTodos: () => refreshProjectTodos(projectId),
      }
    : null;

  const syncPlatformModels = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await api.syncPlatformModels(projectId);
      adopt(res);
      // The platform's sync only adds the models it newly offers; the ones already here keep
      // their prices, protocols and promotions.
      if (res.added === 0) toastInfo(S.models.platformUpToDate);
      else toastSuccess(S.models.platformSyncAdded(res.added));
    } catch (error) {
      if (error instanceof ApiError && error.code === "platform_reauthorization_required") {
        keyLanded.current = false;
        setOauthFor(PENGUIN_GO_PROVIDER_ID);
      } else {
        toastError(apiErrorText(error));
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Group speed test: one real request per model, strictly sequential (concurrent probes
   * trip provider rate limits), each result written to the card as it lands. The
   * confirmation dialog (speedFor) has already warned about quota by the time this runs.
   * A stop takes effect between probes: the one in flight is not abandoned (its request is
   * already billed), its result lands like the others, and no further probe starts.
   */
  const runSpeedTest = async (providerId: string) => {
    if (!projectId || !rows) return;
    const targets = rows.filter((r) => r.provider === providerId);
    speedStopRef.current = false;
    setSpeedRunning(providerId);
    try {
      for (const row of targets) {
        if (speedStopRef.current) break;
        const key = refMapKey(row.provider, row.modelId);
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
      setSpeedStopping(false);
    }
  };

  const stopSpeedTest = () => {
    speedStopRef.current = true;
    setSpeedStopping(true);
  };

  /**
   * Import-mode landing from the add-group dialog: one table PUT carrying the group's connection
   * (base URL, protocol, key — written once, in `[providers.<name>]`) and the appended rows,
   * which store nothing of it and follow the group; then the new group is opened so the result is
   * visible immediately. Returns persist's verdict so the dialog stays up (fields intact) when
   * saving failed; the table then stays as it stood, so the dialog's own name check does not
   * report the name as taken on the retry.
   */
  const importGroup = async (
    nextRows: RowState[],
    name: string,
    connection: ProviderConnectionUpdate,
    added: number,
    skipped: number,
  ): Promise<boolean> => {
    if (!projectId) return false;
    const ok = await persist(
      nextRows,
      defaultModel,
      visionModel,
      S.models.groupImported(added, skipped),
      { [name]: connection },
    );
    if (!ok) return false;
    if (!expanded.has(name)) {
      const next = new Set(expanded);
      next.add(name);
      setExpanded(next);
      saveExpandedProviders(projectId, next);
    }
    setAddGroupOpen(false);
    return true;
  };
  const editingRow =
    editing !== null ? rows?.find((r) => sameModelRef(rowRef(r), editing)) : undefined;
  const closeModelDialog = () => {
    setEditing(null);
    setEditingMovedToCustom(false);
    setAddingTo(null);
  };

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

  /** Adopts new pin choices — the header's star and a drop across the areas — unless nothing changed. */
  const savePins = (next: ModelGroupPins) => {
    if (next === groupPins) return;
    storeModelGroupPins(next);
    setGroupPins(next);
  };

  /** Adopts a group's sort from its gear menu (store-then-set), unless it is the current one. */
  const chooseSort = (id: string, sort: ModelGroupSort) => {
    const next = withModelGroupSort(groupSorts, id, sort);
    if (next === groupSorts) return;
    storeModelGroupSorts(next);
    setGroupSorts(next);
  };

  /** Fold or unfold the collapsible groups (store-then-set, as toggleGroup). */
  const toggleGroupsFolded = () => {
    const next = !groupsFolded;
    storeModelGroupsFolded(next);
    setGroupsFolded(next);
  };

  /**
   * Drag-reorder wiring of one group header. Returns the props the header row spreads and
   * the edge a drop would land on, or nothing at all when the gesture is not offered:
   * without a drag-capable pointer, and while a search query is active — the query filters
   * the list to matches, so a drop there would commit an arrangement made against a subset
   * the user is about to dismiss.
   */
  const groupDragProps = (key: string) => {
    if (!canDrag || searching) {
      return { header: {}, dropEdge: null as "above" | "below" | null };
    }
    const dragging = dragGroup;
    /** Which half of the header the pointer is in — the edge the drop would land on. */
    const edgeOf = (e: ReactDragEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      return e.clientY - rect.top > rect.height / 2;
    };
    const acceptsDrop = dragging !== null && dragging !== key;
    return {
      header: {
        draggable: true,
        onDragStart: (e: ReactDragEvent) => {
          // dragstart fires AT the source node, so target === currentTarget exactly when
          // the header row itself is what the browser picked up. A drag begun on anything
          // inside it that is natively draggable (selected text, a link) belongs to that
          // element, and claiming it would overwrite its payload and effect and turn a
          // release over any other header into a silent reorder.
          if (e.target !== e.currentTarget) return;
          e.dataTransfer.setData(MODEL_GROUP_DRAG_MIME, key);
          e.dataTransfer.effectAllowed = "move" as const;
          // The browser would lift the header's own paint alone — no section edge, its dark
          // fill let through — so the image is the header's opaque chip instead.
          setDragPreview(e);
          setDragGroup(key);
        },
        onDragEnd: () => {
          setDragGroup(null);
          setGroupDropHint(null);
        },
        onDragOver: (e: ReactDragEvent) => {
          if (!acceptsDrop || !isModelGroupDrag(e)) return;
          e.preventDefault();
          // preventDefault alone only says "a drop may land here"; the effect still has to
          // be one effectAllowed permits, or a modifier held during the drag resolves it to
          // "none" and the drop event never fires.
          e.dataTransfer.dropEffect = "move";
          const after = edgeOf(e);
          setGroupDropHint((prev) =>
            prev?.key === key && prev.after === after ? prev : { key, after },
          );
        },
        // dragleave also fires when the pointer merely crosses onto one of the header's OWN
        // children — the collapse button spans most of the row, and up to six actions
        // follow it — so clearing unconditionally strobes the indicator. relatedTarget is
        // where the drag is going: still inside means nothing changed.
        onDragLeave: (e: ReactDragEvent) => {
          const to = e.relatedTarget;
          if (to instanceof Node && e.currentTarget.contains(to)) return;
          setGroupDropHint((prev) => (prev?.key === key ? null : prev));
        },
        onDrop: (e: ReactDragEvent) => {
          if (!acceptsDrop || dragging === null || !isModelGroupDrag(e)) return;
          e.preventDefault();
          const next = commitModelGroupOrder(groupOrder, allKeys, dragging, key, edgeOf(e));
          // commitModelGroupOrder hands back its input for a drop that moves nothing: no state
          // update, and no freshly allocated identical array written to storage.
          if (next !== groupOrder) {
            setGroupOrder(next);
            saveModelGroupOrder(projectId, next);
          }
          // A drop on a header in the other area moves the group into that area too.
          savePins(pinsAfterDrop(groupPins, dragging, key));
          setDragGroup(null);
          setGroupDropHint(null);
        },
      },
      dropEdge:
        acceptsDrop && groupDropHint?.key === key
          ? groupDropHint.after
            ? ("below" as const)
            : ("above" as const)
          : null,
    };
  };

  // Which dialog the open authorization runs: the group's descriptor decides, so a group with
  // a bridge flow gets the shared bridge dialog and every other authorizable group gets the
  // PKCE one. Null means the open group authorizes some other way (or none).
  const oauthFlow = oauthFor === null ? undefined : providerInfo(oauthFor)?.bridgeAuth?.flow;
  const oauthKeyAuth = oauthFlow === undefined ? null : KEY_AUTH[oauthFlow];

  /** TokenDance's rows, for the banner: shown while the group has models and no key of its own. */
  const tokenDanceRows = rows?.filter((row) => row.provider === TOKENDANCE_PROVIDER_ID) ?? [];
  const showTokenDanceBanner =
    tokenDanceRows.length > 0 && !groupKeyStored(providers[TOKENDANCE_PROVIDER_ID]);
  /**
   * How many of a group's models use its group key: those with no key of their own that the key
   * reaches (no base URL of their own, or one on the group's origin).
   */
  const groupKeyUsers = (id: string) =>
    rows?.filter(
      (r) =>
        r.provider === id &&
        !r.credential?.apiKeyMasked &&
        groupKeyReaches(r.originalBaseUrl, providers[id]?.baseUrl),
    ).length ?? 0;

  /**
   * One of a group header's actions (group-header.ts decides which, and in what order). Every
   * button keeps an accessible name of "action group" and a title; on a narrow header the ones
   * that carry words drop them and keep their icon.
   */
  const renderGroupAction = (
    group: (typeof groups)[number],
    action: GroupHeaderAction,
    keyStored: boolean,
  ): ReactNode => {
    const { provider } = group;
    switch (action) {
      case "balance":
        return <GroupBalance projectId={projectId} provider={provider} />;
      case "connect":
        // One control: "Not connected", which connects when pressed, or a "Connected" menu (Sync
        // models on Penguin Go, Reconnect, Disconnect); a member reads the status alone.
        return (
          <GroupConnection
            provider={provider}
            connected={keyStored}
            isOwner={isOwner}
            busy={busy}
            actions={{
              onConnect: () => {
                keyLanded.current = false;
                setOauthFor(group.provider.id);
              },
              onSyncModels: () => void syncPlatformModels(),
              onDisconnect: () => setDisconnectFor(group.provider.id),
            }}
          />
        );
      case "speedTest": {
        // One icon for both directions: it starts a run (after the confirmation) and, while
        // its own group's run is going, stops it — the gauge turns into the registry's square in
        // a circle. Every other group's waits its turn.
        const running = speedRunning === group.provider.id;
        const verb = running ? S.models.speedTestStop : S.models.speedTest;
        return (
          <Button
            size="icon"
            variant="ghost"
            className={HEADER_SQUARE}
            disabled={busy || (running ? speedStopping : speedRunning !== null)}
            aria-label={`${verb} ${provider.label}`}
            title={verb}
            onClick={() => (running ? stopSpeedTest() : setSpeedFor(group.provider.id))}
          >
            <GlyphIcon
              d={running ? ICONS.stopCircle : ICONS.gauge}
              size={ICON_SIZE.groupHeaderAction}
            />
          </Button>
        );
      }
      case "addModel":
        // Only the groups that take hand-added models: custom, vLLM, the three gateways that
        // list a fraction of what they serve, and user-defined ones. The rest carry the catalog's
        // presets, which the server enforces too (model_not_addable). An icon, like the speed
        // test and the gear it stands beside.
        return (
          <Button
            size="icon"
            variant="ghost"
            className={HEADER_SQUARE}
            disabled={busy}
            aria-label={`${S.models.addToGroup} ${provider.label}`}
            title={S.models.addToGroup}
            onClick={() => setAddingTo(group.provider.id)}
          >
            <GlyphIcon d={ICONS.plus} size={ICON_SIZE.groupHeaderAction} />
          </Button>
        );
      case "deleteGroup":
        // Whole-group delete, user-defined groups only: a built-in group is catalog identity
        // (its rows delete one by one), a user-defined group exists solely through its rows.
        return (
          <Button
            size="icon"
            variant="ghost"
            className={HEADER_BUTTON}
            disabled={busy}
            aria-label={`${S.models.deleteGroup} ${provider.label}`}
            title={S.models.deleteGroup}
            onClick={() => setDeleteGroupFor(group.provider.id)}
          >
            <GlyphIcon d={ICONS.trash} size={ICON_SIZE.groupHeaderAction} />
            <span className={HEADER_LABEL}>{S.models.deleteGroup}</span>
          </Button>
        );
      case "settings":
        // The gear, icon only like the speed test it stands beside: the pair closes every header
        // at the same right edge. Its menu holds the group's sort, which every member has and a
        // busy page never blocks, and, for the owner, the group's connection settings in full
        // (base URL, key, protocol).
        return (
          <GroupSettingsControl
            provider={provider}
            sort={modelGroupSortOf(groupSorts, group.provider.id)}
            onSort={(sort) => chooseSort(group.provider.id, sort)}
            onSettings={isOwner ? () => setSettingsFor(group.provider.id) : undefined}
            busy={busy}
          />
        );
    }
  };

  /**
   * One group: its header — the collapse button (logo, name, count, chevron, the recommended
   * pill), the star that moves it between the favourites and the collapsible area, and its
   * actions — and its cards.
   */
  const renderGroup = (group: (typeof groups)[number]) => {
    const open = isGroupExpanded(expanded, group.provider.id, searching);
    const pinned = isModelGroupPinned(group.provider.id, groupPins);
    const drag = groupDragProps(group.provider.id);
    const keyStored = groupKeyStored(providers[group.provider.id]);
    const actions = groupHeaderActions(group.provider, {
      isOwner,
      keyStored,
      keyFromEnv: groupKeyFromEnv(group.rows),
      balancePinned: isPinned(pinnedBalance, projectId, group.provider.id),
    });
    return (
      // The drop indicator is drawn against the WHOLE group, so "below" reads as
      // after this group and its model cards rather than between the header and
      // its own first card. It needs this wrapper to live in: the section clips
      // its children (overflow-hidden carries the expand/collapse transition).
      // Absolutely positioned, so it costs no layout width and cannot push the
      // header's actions out of a narrow page.
      <div key={group.provider.id} className="relative">
        {drag.dropEdge !== null && (
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-accent ${
              drag.dropEdge === "above" ? "-top-1.5" : "-bottom-1.5"
            }`}
          />
        )}
        <section className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          {/* Group header: collapse button (logo + vendor name + count + chevron) +
              the group's actions on the right, in group-header.ts's order. Actions are
              separate elements because buttons can't nest. The row is a size
              container: the sidebar can narrow it while the viewport remains
              desktop-sized, so labels respond to this row's actual width rather than
              viewport breakpoints. Narrow rows never hide an action — each one keeps
              its icon (with aria-label + title) and only sheds its text. When even the
              icons leave the name too little room to be read whole, the actions move to
              a line of their own below it, as one block: the left cluster's flex
              basis is its content, so a short name is never truncated to keep the
              actions beside it. Only a name wider than the whole row truncates, down to
              a floor, so it is never squeezed to nothing. The row is also the drag
              handle for reordering the group (groupDragProps), and the `group` its star
              shows on. */}
          <div
            {...drag.header}
            className={`group @container flex flex-wrap items-center gap-x-2 bg-gray-50 pr-1.5 transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900/60 dark:hover:bg-gray-800/60${canDrag && !searching ? " cursor-grab" : ""}`}
          >
            {/* The left cluster: the collapse button, sized to what it shows, the star right
                  after it, and the rest of the cluster, which folds the group on a click as the
                  button does (the button is the keyboard's way). */}
            <div className="flex min-w-[10rem] flex-auto items-center">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggleGroup(group.provider.id)}
                className="flex min-w-0 items-center gap-2 py-2 pl-3 pr-2 text-left"
              >
                <ProviderLogo
                  provider={group.provider.id}
                  className="h-5 w-5 shrink-0 text-gray-700 dark:text-gray-300"
                />
                {/* The vendor name is the only thing in this button allowed to take
                    the remaining space, and the only one that truncates. */}
                <span className="min-w-0 truncate text-sm font-semibold">
                  {group.provider.label}
                </span>
                {/* The count as the model picker's rail writes it: a bare number, with
                    the words kept for assistive tech. */}
                <span
                  aria-hidden
                  className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500"
                >
                  {group.rows.length}
                </span>
                <span className="sr-only">{S.models.modelCount(group.rows.length)}</span>
                {/* The chevron follows the name and its count rather than the row's far
                    edge, so it reads as part of the group it folds. */}
                <Chevron open={open} className="text-gray-400" />
                {/* The recommendation rides the collapse bar itself, so it is read with
                    the group's name rather than as a caption floating above the
                    section. `shrink-0` keeps it whole: the vendor name beside it is
                    the element allowed to truncate on a narrow page. */}
                {group.provider.recommended && (
                  // The theme's tag, outlined like the card marks below it: an outline is
                  // enough to make it a tag, and a block of colour on the collapse bar
                  // competes with the vendor name it is endorsing. `attention` asks the
                  // reader to look here, and is the tone nearest the gold this mark has
                  // always worn. It gives way on a narrow row before the name does.
                  <span className="hidden shrink-0 @lg:inline-flex">
                    <Badge tone="attention">{S.models.recommendedGroup}</Badge>
                  </span>
                )}
              </button>
              {/* The favourite star: solid while the group is a favourite (always shown), an
                  outline while it is collapsible (under the fold bar). The sidebar nav's row
                  toggle — flat, shown on the header's hover or its own focus, always where
                  nothing hovers since it is then the only way to move a group — and it keeps
                  its place at rest, so nothing shifts when it shows. A view preference, so
                  members have it too. */}
              <button
                ref={(el) => {
                  if (el === null || lockFocusRef.current !== group.provider.id) return;
                  lockFocusRef.current = null;
                  el.focus();
                  // A group that lands in the folded (inert) area cannot take focus: the bar
                  // that unfolds it is the nearest place to stand. Read once this commit is
                  // done, since it may be mounting the bar together with the group.
                  if (document.activeElement !== el) {
                    queueMicrotask(() => foldBarRef.current?.focus());
                  }
                }}
                type="button"
                aria-label={`${S.models.pinGroup} ${group.provider.label}`}
                aria-pressed={pinned}
                data-tooltip={pinned ? S.models.unpinGroup : S.models.pinGroup}
                onClick={(e) => {
                  // A keyboard toggle follows its group into the other area (lockFocusRef).
                  if (e.currentTarget.matches(":focus-visible")) {
                    lockFocusRef.current = group.provider.id;
                  }
                  savePins(withModelGroupPinned(groupPins, group.provider.id, !pinned));
                }}
                className={`${ROW_HOVER_BUTTON} hover:text-fg [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100`}
              >
                <GlyphIcon d={ICONS.star} size={ICON_SIZE.iconButton} filled={pinned} />
              </button>
              <span
                aria-hidden
                className="min-w-0 flex-auto self-stretch"
                onClick={() => toggleGroup(group.provider.id)}
              />
            </div>
            {actions.length > 0 && (
              <div className="ml-auto flex shrink-0 items-center gap-2 py-1">
                {actions.map((action) => (
                  <Fragment key={action}>{renderGroupAction(group, action, keyStored)}</Fragment>
                ))}
              </div>
            )}
          </div>

          {/* Expand/collapse: grid-template-rows goes between 0fr and 1fr — no need to
              measure content height. The grid carries the theme's layout motion, which
              decides how the fold moves (and stills it under reduced motion). The clip is on
              the grid's own box, not on the row inside it: between 0fr and 1fr the box gets f
              of the content's height but the row only f² of it, so a body clipped at the row
              vanished ahead of the space it left, a blank band under it (CollapsibleSection
              has the same fix). Content stays in the DOM while collapsed (height is 0), so
              both directions animate. The section keeps its own head rather than being a
              CollapsibleSection: the head is the group's drag handle and a size container,
              and its chevron follows the group's name. */}
          <div
            data-layout-motion
            className={`grid overflow-clip ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
            {/* inert while collapsed: a card with zero height shouldn't still be Tab-focusable or clickable. */}
            <div className="min-h-0" inert={!open}>
              <div
                className={`grid grid-cols-1 gap-2 border-t border-gray-200 p-3 transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3 dark:border-gray-800 ${open ? "opacity-100" : "opacity-0"}`}
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
                      group={providers[row.provider]}
                      currency={currency}
                      isDefault={sameModelRef(rowRef(row), defaultModel)}
                      isVisionModel={sameModelRef(rowRef(row), visionModel)}
                      speed={speedResults.get(refMapKey(row.provider, row.modelId))}
                      usedTokens={usedTokens.get(refMapKey(row.provider, row.modelId))}
                      hourTick={hourTick}
                      onOpen={() => {
                        setEditingMovedToCustom(false);
                        setEditing(rowRef(row));
                      }}
                      onMoveToCustom={
                        isOwner
                          ? () => {
                              setEditingMovedToCustom(true);
                              setEditing(rowRef(row));
                            }
                          : undefined
                      }
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  };

  /** The two areas (model-group-pins.ts), each in the page's group order. */
  const layout = modelGroupLayout(groups, (group) => group.provider.id, groupPins, {
    searching,
    folded: groupsFolded,
  });

  return (
    <PageFrame>
      {/* The header holds search, the owner-only catalog pair — "Add new models" and "Restore
          defaults" — and the pair of create buttons: the AI path and the group form, offered side
          by side (per-model entry points still live in each group header); on narrow screens the
          actions wrap to their own line and the search box shrinks flexibly, fixed width at >=sm.
          A member reads why nothing here is editable behind the title's "?". */}
      <PageHeader
        title={S.models.title}
        info={isOwner ? undefined : S.models.readOnlyHint}
        actions={
          <>
            <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
              <Input
                size="sm"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={S.models.searchPlaceholder}
              />
            </div>
            {/* "Add new models" appears only while new presets are actually waiting, and the
                accent says so — adding nothing is a no-op, and a permanent button spent the
                header's width on one. That is also why the dot is gone: it marked this button as
                the end of the models trail, and on a button that exists only when the trail does,
                it would be lit every time it was seen. The sr-only sentence stays, folding what is
                waiting into the accessible name in the wording the trail carried down.
                Owner-only — the gate never raises this for a member. */}
            {isOwner && todo && presetHost && (
              <AddNewModelsButton
                onOpen={() => setSyncConfirmOpen(true)}
                disabled={busy || rows === null}
                note={syncNote}
              />
            )}
            {/* Always there for the owner, and quiet: it rewrites every built-in model, so it
                waits behind a danger confirmation that says what it resets and what it keeps. */}
            {isOwner && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRestoreOpen(true)}
                disabled={busy || rows === null}
              >
                {S.models.restoreDefaults}
              </Button>
            )}
            {isOwner && (
              <AiCreateButtons
                size="sm"
                // Only the form needs the table: AddGroupDialog is mounted behind `rows`, so
                // without it the manual button would be a dead click. The AI path is left live
                // precisely because a failed load is one of the things it can repair.
                manualDisabled={rows === null}
                onAi={() => setAiAddOpen(true)}
                onManual={() => setAddGroupOpen(true)}
              />
            )}
          </>
        }
      >
        {/* Last stop on the Models trail, in the one shape all four dismissible trails use:
            directly under the title, naming what is waiting, carrying the add itself, and
            carrying the way down for someone who has looked and decided to stay off the
            catalog. Only new presets are counted (catalog-sync.ts): a stored model that differs
            from the catalog may be the user's own edit, and nothing offers to put it back. The
            toolbar's "Add new models" runs the same add directly. */}
        {isOwner && todo && (
          <TodoNotice
            text={syncNote}
            actionLabel={S.todo.updateNow}
            busy={syncing}
            onAction={() => setSyncConfirmOpen(true)}
            dismissLabel={S.todo.dismiss}
            onDismiss={() => dismissTodo(projectId, "models", todo.signature)}
          />
        )}
      </PageHeader>

      {/* Above every group, while the TokenDance group has models but no key: its own connect
          flow, pitched as the way to skip setting keys by hand. */}
      {isOwner && showTokenDanceBanner && (
        <TokenDanceBanner
          onConnect={() => {
            keyLanded.current = false;
            setOauthFor(TOKENDANCE_PROVIDER_ID);
          }}
        />
      )}

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
          {layout.shown.map(renderGroup)}
          {layout.fold !== null && (
            <>
              {/* The bar that folds the collapsible groups away, the sidebar nav's toggle with
                  the count of what it holds. It stands above them, so it stays put while they
                  open and close. A search shows every match and no bar (modelGroupLayout). */}
              <button
                ref={foldBarRef}
                type="button"
                aria-expanded={!layout.fold.folded}
                aria-controls="models-collapsible-groups"
                onClick={toggleGroupsFolded}
                className={`flex h-6 w-full items-center justify-center ${ICON_GAP.tight} rounded-md ${NAV_FILL.selected} text-xs text-fg-subtle transition-colors duration-150 hover:bg-fg/10 hover:text-fg`}
              >
                {S.models.foldedGroups(layout.fold.groups.length)}
                <ChevronFlip up={!layout.fold.folded} />
              </button>
              {/* The fold: the nav's height tween, groups kept mounted but inert while folded,
                  clipped on the grid's box rather than its row (the blank-band fix above). Its
                  own bottom padding, not the list's gap, spaces it from what follows, so a
                  folded area adds no second gap under the bar. */}
              <div
                id="models-collapsible-groups"
                data-layout-motion
                className={`mb-0 grid overflow-clip ${layout.fold.folded ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
              >
                <div className="min-h-0" inert={layout.fold.folded}>
                  <div
                    className={`space-y-3 pb-3 transition-opacity duration-200 ${layout.fold.folded ? "opacity-0" : "opacity-100"}`}
                  >
                    {layout.fold.groups.map(renderGroup)}
                  </div>
                </div>
              </div>
            </>
          )}
          {isOwner && query.trim() === "" && (
            // "Add group" (user-defined group): hidden while searching (the group list itself is being filtered).
            <button
              type="button"
              onClick={() => setAddGroupOpen(true)}
              className="w-full rounded-md border border-dashed border-gray-300 px-3 py-2.5 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
            >
              ＋ {S.models.addGroup}
            </button>
          )}
        </div>
      )}

      {loadError && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{loadError}</p>}

      {disconnectFor !== null && (
        <DisconnectConfirm
          host={{ projectId, adopt, setBusy }}
          provider={providerInfo(disconnectFor) ?? userProviderInfo(disconnectFor)}
          busy={busy}
          onClose={() => setDisconnectFor(null)}
        />
      )}

      {rows && settingsFor !== null && (
        <ProviderSettingsDialog
          projectId={projectId}
          provider={providerInfo(settingsFor) ?? userProviderInfo(settingsFor)}
          group={providers[settingsFor]}
          rows={rows.filter((r) => r.provider === settingsFor)}
          detectedEnvKeys={envKeysDetected}
          onClose={() => setSettingsFor(null)}
          onSaved={(res) => {
            adopt(res);
            setSettingsFor(null);
          }}
        />
      )}

      {/* NOT gated on `rows`, unlike its neighbours. This dialog outlives a table reload: it
          stays open after the key lands to report the outcome, and `load()` blanks `rows` on
          its first line, so gating it there would unmount it mid-flow — and its mount effect
          opens a NEW authorization, which is how a completed authorization ended up offering
          itself again. `count` is only read while the flow is still running, so a reload's
          momentary absence of rows reads as zero and is never seen. */}
      {projectId &&
        oauthFor !== null &&
        (oauthKeyAuth !== null ? (
          <KeyAuthDialog
            projectId={projectId}
            providerLabel={
              MODEL_PROVIDERS.find((provider) => provider.id === oauthFor)?.label ?? oauthFor
            }
            count={groupKeyUsers(oauthFor)}
            endpoints={oauthKeyAuth.endpoints}
            texts={oauthKeyAuth.texts}
            onClose={() => {
              setOauthFor(null);
              if (keyLanded.current) void load();
              keyLanded.current = false;
            }}
            onApplied={() => {
              keyLanded.current = true;
            }}
          />
        ) : (
          <ModelOAuthDialog
            projectId={projectId}
            provider={MODEL_PROVIDERS.find((p) => p.id === oauthFor) ?? userProviderInfo(oauthFor)}
            count={groupKeyUsers(oauthFor)}
            onClose={() => {
              setOauthFor(null);
              // The reload waits for the dismissal rather than racing the open dialog: the key
              // was written server-side, so the table in hand is stale in exactly one place, and
              // reloading brings the masked key back. Gated on a key having landed, because
              // `load` also drops this Project's speed results — measurements that cost real API
              // quota and live only in page memory — and a cancelled flow changed nothing.
              if (keyLanded.current) void load();
              keyLanded.current = false;
            }}
            onApplied={() => {
              // The dialog stays open and reports the outcome itself (its `done` phase), because
              // the authorization ran in another tab and a toast would be announced to a window
              // nobody is looking at. All this seam does is record that the dismissal has a
              // reload to do.
              keyLanded.current = true;
            }}
          />
        ))}

      {rows && deleteGroupFor !== null && (
        <ConfirmModal
          open
          title={S.models.deleteGroupTitle}
          tone="danger"
          onClose={() => setDeleteGroupFor(null)}
          onConfirm={() => {
            const target = deleteGroupFor;
            setDeleteGroupFor(null);
            const removed = rows.filter((r) => r.provider === target);
            if (removed.length === 0) return;
            // Same pointer rule as single-model delete: a default/vision reference into the
            // deleted group is dropped, otherwise the server rejects the dangling pair.
            void persist(
              rows.filter((r) => r.provider !== target),
              defaultModel?.provider === target ? undefined : defaultModel,
              visionModel?.provider === target ? undefined : visionModel,
              S.models.groupDeleted(removed.length),
            );
          }}
          confirmLabel={S.common.delete}
          cancelLabel={S.common.cancel}
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {/* Offered on user-defined groups only, whose display info is always synthesized. */}
            {S.models.deleteGroupConfirm(
              userProviderInfo(deleteGroupFor).label,
              rows.filter((r) => r.provider === deleteGroupFor).length,
            )}
          </p>
        </ConfirmModal>
      )}

      {/* The add, confirm-first from both entries — the header button and the notice: the
          body is what an add does and leaves alone, over the list of exactly what it adds. */}
      {todo && syncConfirmOpen && presetHost && (
        <AddNewModelsConfirm
          host={presetHost}
          title={S.todo.modelsConfirmTitle(todo.count)}
          items={todo.items}
          busy={syncing}
          setSyncing={setSyncing}
          onClose={() => setSyncConfirmOpen(false)}
        />
      )}

      {/* Restore defaults: it rewrites every built-in model, so the body says, item by item,
          what goes back to the catalog and what is kept, and that it is final. */}
      {restoreOpen && presetHost && (
        <RestoreDefaultsConfirm
          host={presetHost}
          busy={syncing}
          setSyncing={setSyncing}
          onClose={() => setRestoreOpen(false)}
        />
      )}

      {speedFor !== null && (
        <Modal open title={S.models.speedTestTitle} onClose={() => setSpeedFor(null)}>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {S.models.speedTestConfirm(rows?.filter((r) => r.provider === speedFor).length ?? 0)}
          </p>
          {/* This dialog builds its action row in the body rather than through Modal's
              `footer`, so it carries the footer's sm rung itself. */}
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" onClick={() => setSpeedFor(null)}>
              {S.common.cancel}
            </Button>
            <Button
              size="sm"
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
      {/* The AI path for what the group import cannot read: a listing page that is not an
          OpenAI-compatible /models endpoint, or a service described in words. The table reloads
          on every mount, so the group the agent adds is there when the page is next visited. */}
      {projectId !== null && (
        <AiCreateModal
          open={aiAddOpen}
          onClose={() => setAiAddOpen(false)}
          title={S.models.aiAddTitle}
          intro={S.models.aiAddIntro}
          placeholder={S.models.aiAddPlaceholder}
          examples={S.models.aiAddExamples}
          tail={S.models.aiAddTail(projectId)}
          agents={agents}
        />
      )}

      {rows && addGroupOpen && (
        <AddGroupDialog
          projectId={projectId}
          rows={rows}
          onClose={() => setAddGroupOpen(false)}
          onManual={(name) => {
            setAddGroupOpen(false);
            setAddingTo(name);
          }}
          onImport={importGroup}
        />
      )}

      {rows && (addingTo !== null || editingRow) && (
        <ModelDialog
          projectId={projectId}
          row={addingTo !== null ? null : (editingRow ?? null)}
          addProvider={addingTo ?? "custom"}
          movedToCustom={editingMovedToCustom}
          existingRefs={rows.map(rowRef)}
          providers={providers}
          detectedEnvKeys={envKeysDetected}
          currency={currency}
          canEdit={isOwner}
          isDefault={editingRow !== undefined && sameModelRef(rowRef(editingRow), defaultModel)}
          isVisionModel={editingRow !== undefined && sameModelRef(rowRef(editingRow), visionModel)}
          onClose={closeModelDialog}
          // The dialog stays open, its draft intact, until the write answers; it closes only
          // once the table holds what it sent.
          onSubmit={async (next, action) => {
            const isNew = addingTo !== null;
            let ok: boolean;
            if (action === "remove") {
              // Filter by the **identity as loaded**: rows / pointers are both keyed by the
              // paired reference as loaded. If the user edited identity fields before
              // deleting, next's current reference wouldn't match any row -> nothing gets
              // deleted while it still reports "saved".
              const removed = next.original;
              ok = await persist(
                rows.filter((r) => !sameModelRef(rowRef(r), removed)),
                sameModelRef(removed, defaultModel) ? undefined : defaultModel,
                sameModelRef(removed, visionModel) ? undefined : visionModel,
              );
            } else {
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
              ok = await persist(nextRows, ptr.defaultModel, ptr.visionModel);
            }
            if (ok) closeModelDialog();
            return ok;
          }}
        />
      )}
    </PageFrame>
  );
}

// ---------------------------------------------------------------------------
// Add-group dialog
// ---------------------------------------------------------------------------

/**
 * "Add group" in two modes, chosen under the name field:
 *
 * - **Create only** — the light path: a valid name hands off to that group's add-model
 *   dialog (groups are carried by model entries, so the group appears once the first
 *   model saves; canceling leaves nothing behind).
 * - **Import models** — fills the brand-new group from its endpoint, in the add-model
 *   dialog's field rhythm: API key first, then the base URL with the detect action at its
 *   top-right and the in-field protocol picker as manual override (ProtocolSuffixMenu —
 *   the same one-to-one path menu). Only once a protocol is determined (detected or
 *   picked) does the "import all models" action appear; it lists the endpoint
 *   (POST models/list) and hands the group's connection and the appended rows to the page
 *   for one table PUT: the base URL, protocol and key are written once, as the group's, and
 *   the rows store nothing of them.
 *
 * Detection failure turns the suffix amber and keeps both ways out usable — pick the
 * protocol by hand, or switch back to create-only. Errors render inside the dialog;
 * nothing persists until a listing succeeded. A name the rule refuses, or one already taken,
 * is said under the field as it is typed, and holds both actions until it is fixed. Closing
 * the dialog with anything typed asks first; nothing closes it while an import is running.
 */
function AddGroupDialog({
  projectId,
  rows,
  onClose,
  onManual,
  onImport,
}: {
  projectId: string;
  rows: RowState[];
  onClose: () => void;
  /** Create-only confirm: open the add-model dialog for the named group. */
  onManual: (name: string) => void;
  /** Import landing: persist the group's connection and the appended rows; resolves false when saving failed (the dialog stays open). */
  onImport: (
    nextRows: RowState[],
    name: string,
    connection: ProviderConnectionUpdate,
    added: number,
    skipped: number,
  ) => Promise<boolean>;
}) {
  /**
   * What is typed or found: the name, and for an import the key, the base URL and the protocol
   * the import will speak (null until a detection lands or the user picks one). The mode is how
   * the dialog is used, not something typed, so switching it asks nothing on the way out.
   */
  const form = useFormDraft<{
    name: string;
    apiKey: string;
    baseUrl: string;
    clientType: ProtocolClientType | null;
  }>({ name: "", apiKey: "", baseUrl: "", clientType: null });
  const { name, apiKey, baseUrl, clientType } = form.draft;
  const [mode, setMode] = useState<"create" | "import">("create");
  const [detecting, setDetecting] = useState(false);
  const [detectFailed, setDetectFailed] = useState(false);
  /** Progress line while list/save runs (null = idle); also gates every action against re-entry. */
  const [importing, setImporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Detection run counter: a manual pick or an edited URL supersedes an in-flight run (same convention as the model dialog). */
  const detectSeq = useRef(0);

  const trimmed = name.trim();
  /** What is wrong with the name as typed; an empty one is only marked required. */
  const nameError =
    trimmed === ""
      ? null
      : !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(trimmed)
        ? S.models.groupNameInvalid
        : MODEL_PROVIDERS.some((p) => p.id === trimmed) || rows.some((r) => r.provider === trimmed)
          ? S.models.groupNameExists
          : null;
  const nameValid = trimmed !== "" && nameError === null;

  const confirmCreate = () => {
    if (nameValid) onManual(trimmed);
  };

  const detect = async () => {
    const url = baseUrl.trim();
    setError(null);
    if (!detectableBaseUrl(url)) {
      setError(S.models.groupImportNeedUrl);
      return;
    }
    const seq = ++detectSeq.current;
    setDetecting(true);
    setDetectFailed(false);
    try {
      const key = apiKey.trim();
      const res = await api.detectProtocol(projectId, {
        baseUrl: url,
        ...(key ? { apiKey: key } : {}),
      });
      if (seq !== detectSeq.current) return;
      const detected = res.detected !== undefined ? protocolSelectorValue(res.detected) : null;
      if (detected !== null) {
        form.patch({ clientType: detected });
        const name = S.models.protocolNames[detected] ?? detected;
        // The protocol may have answered on a tidied-up form of the URL (a `/v1` added or
        // dropped, a pasted endpoint path removed); the import must speak to that one, so
        // the field takes it and the toast says so.
        if (res.baseUrl !== undefined && res.baseUrl !== url) {
          form.patch({ baseUrl: res.baseUrl });
          toastSuccess(S.models.detectedProtocolAndUrl(name, res.baseUrl));
        } else {
          toastSuccess(S.models.detectedProtocol(name));
        }
      } else {
        setDetectFailed(true);
        // Same condition the model dialog reports, so it gets the same sentence.
        setError(S.models.detectFailedBody);
      }
    } catch (e) {
      if (seq !== detectSeq.current) return;
      setDetectFailed(true);
      setError(apiErrorText(e));
    } finally {
      if (seq === detectSeq.current) setDetecting(false);
    }
  };

  const pickProtocol = (t: ProtocolClientType) => {
    detectSeq.current++;
    setDetecting(false);
    setDetectFailed(false);
    setError(null);
    form.patch({ clientType: t });
  };

  const runImport = async () => {
    if (!nameValid || clientType === null) return;
    const n = trimmed;
    const url = baseUrl.trim();
    if (!detectableBaseUrl(url)) {
      setError(S.models.groupImportNeedUrl);
      return;
    }
    setError(null);
    setImporting(S.models.groupImportListing);
    try {
      const key = apiKey.trim();
      const listed = await api.listEndpointModels(projectId, {
        baseUrl: url,
        clientType,
        ...(key ? { apiKey: key } : {}),
      });
      if (!listed.ok || !listed.models) {
        setError(
          listed.unsupported
            ? S.models.groupImportUnsupported
            : (listed.message ?? S.models.groupImportFailed),
        );
        return;
      }
      const built = buildImportedRows(rows, n, listed.models);
      if (built.added === 0) {
        setError(S.models.groupImportEmpty);
        return;
      }
      setImporting(S.models.groupImportSaving(built.added));
      await onImport(
        [...rows, ...built.rows],
        n,
        groupImportConnection({ baseUrl: url, clientType, apiKey: key }),
        built.added,
        built.skipped,
      );
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setImporting(null);
    }
  };

  const busy = importing !== null;
  const requestClose = useGuardedClose(...closeUnlessBusy(busy, onClose, form.scope));
  const suffixLabel =
    clientType === null ? S.models.protocolUnset : protocolPathForModel(trimmed, clientType);

  return (
    <Modal
      open
      title={S.models.addGroupTitle}
      onClose={requestClose}
      // The group settings' width: the group's base URL and its protocol path read whole.
      widthClass="sm:max-w-3xl"
      footer={
        <>
          <Button size="sm" disabled={busy} onClick={requestClose}>
            {S.common.cancel}
          </Button>
          {mode === "create" ? (
            <Button size="sm" variant="primary" disabled={!nameValid} onClick={confirmCreate}>
              {S.common.confirm}
            </Button>
          ) : (
            // The import action exists only once the protocol is determined (detected or
            // hand-picked): before that there is nothing meaningful to run.
            clientType !== null && (
              <Button
                size="sm"
                variant="primary"
                disabled={busy || !nameValid}
                onClick={() => void runImport()}
              >
                {S.models.groupImportAll}
              </Button>
            )
          )}
        </>
      }
    >
      <div className="space-y-3">
        <div className="block">
          <Input
            size="sm"
            label={S.models.groupNameLabel}
            info={S.models.addGroupDesc}
            infoLabel={S.models.groupNameLabel}
            required
            value={name}
            invalid={nameError !== null}
            onChange={(e) => form.patch({ name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mode === "create") confirmCreate();
            }}
            placeholder={S.models.groupNameHint}
            className="font-mono"
            autoFocus
          />
          {nameError && <FieldError>{nameError}</FieldError>}
        </div>
        <Segmented
          cols={2}
          options={[
            { value: "create", label: S.models.groupModeCreate },
            { value: "import", label: S.models.groupModeImport },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === "import" && (
          <>
            <PasswordInput
              size="sm"
              label={S.models.apiKey}
              value={apiKey}
              onChange={(e) => {
                form.patch({ apiKey: e.target.value });
                setError(null);
              }}
              className="font-mono"
              autoComplete="off"
              placeholder={S.models.groupImportKeyHint}
            />
            {/* Base URL with the detect action at its top-right and the in-field protocol
                picker — the add-model dialog's idiom, so the two flows read as one. */}
            <div className="block">
              <span className="mb-1 flex items-baseline justify-between gap-2">
                <FieldLabel required block={false}>
                  {S.models.baseUrl}
                </FieldLabel>
                <Button
                  variant="link"
                  size="sm"
                  loading={detecting}
                  disabled={busy}
                  onClick={() => void detect()}
                  title={S.models.detectProtocolHint}
                  className="shrink-0"
                >
                  {detecting ? S.models.detecting : S.models.detectProtocol}
                </Button>
              </span>
              <div className="relative">
                <Input
                  size="sm"
                  aria-label={S.models.baseUrl}
                  required
                  value={baseUrl}
                  disabled={busy}
                  onChange={(e) => {
                    // An edited URL retires the previous verdict: protocol and failure tone
                    // both described the old endpoint.
                    detectSeq.current++;
                    setDetecting(false);
                    setDetectFailed(false);
                    setError(null);
                    form.patch({ baseUrl: e.target.value });
                  }}
                  className="font-mono"
                  style={{ paddingRight: `calc(${displayWidthCh(suffixLabel)}ch + 2.25rem)` }}
                  title={S.models.baseUrlSuffixTitle}
                  placeholder="https://…"
                />
                <div className="absolute inset-y-0 right-1 flex items-center">
                  <ProtocolSuffixMenu
                    value={clientType}
                    path={suffixLabel}
                    detecting={detecting}
                    tone={detectFailed ? "warn" : null}
                    onPick={pickProtocol}
                  />
                </div>
              </div>
            </div>
            {importing !== null && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{importing}</p>
            )}
          </>
        )}
        {error && <FieldError>{error}</FieldError>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Model card
// ---------------------------------------------------------------------------

/**
 * Card: display name + lifetime Token spend + status badges; context / pricing / key status folded
 * into one line of small text; group speed-test results (TTFT / TPS, tone-colored) ride the
 * title row's right edge. All three lines are one click target opening the config dialog (the
 * model homepage link lives in there); a row whose model id its group cannot route adds a
 * warning strip below them, which carries its own action and therefore its own click target.
 */
export function ModelCard({
  row,
  group,
  currency,
  isDefault,
  isVisionModel,
  speed,
  usedTokens,
  hourTick,
  onOpen,
  onMoveToCustom,
}: {
  row: RowState;
  /** The row's group's stored connection: what its blank fields follow. */
  group?: ProviderConnectionDto | undefined;
  currency: Currency;
  isDefault: boolean;
  isVisionModel: boolean;
  speed?: SpeedResult | "pending";
  /** Lifetime Tokens spent on this model; absent for a model that has never run. */
  usedTokens?: number;
  /** Bumped on the hour (see useHourTick): the cue to re-read a time-of-day price. */
  hourTick: number;
  onOpen: () => void;
  /** Opens the config dialog with this row already moved to the custom group; absent for a member, who cannot write the config. */
  onMoveToCustom?: () => void;
}) {
  /**
   * A stored entry that sits in a vendor group under an id MMSP cannot place, judged on the
   * protocol it is actually used with (its own, else its group's). Saving one is refused now,
   * so this can only be a row that predates that rule — it stays in the config untouched, and
   * the card is where its owner finds out, because every other sign of it arrives as a failed
   * request minutes into a conversation.
   */
  const fix = unroutableFix(
    row.provider,
    row.modelId,
    row.clientType.trim() ||
      (inheritedConnection(row.provider, row.modelId, group).clientType ?? ""),
  );
  /** Where an inherited key comes from (the group, or the environment), as the key's hover note. */
  const keyNote = keyStatusNote(row, group);
  const priced = row.cacheRead || row.cacheWrite || row.output;
  /**
   * What is taken off this row's list price right now: its running promotion, its live
   * off-peak tier, or both. `discountedPrice` returns nothing for a row with neither — no
   * promotion, and a schedule that is inside its peak windows or on a price edited away from
   * the catalog's peak price.
   *
   * `hourTick` is in the dependency list for the schedule: a scheduled row's price changes on
   * the hour with nobody touching the page, and a card left open would otherwise keep printing
   * a rate that stopped applying.
   */
  const discount = useMemo(() => discountedPrice(row), [row, hourTick]);
  // The buckets to print: what the seller bills right now. The stored numbers are the list
  // price, so they differ whenever a discount applies.
  const shownPrice = discount
    ? {
        cacheRead: String(discount.billed.cacheRead),
        cacheWrite: String(discount.billed.cacheWrite),
        output: String(discount.billed.output),
      }
    : { cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, output: row.output };
  /**
   * Every standing mark this row carries (model-tags.ts, shared with the model picker's rows),
   * in one horizontal row of its own.
   *
   * They had been sharing the title's line, where each was width the model's NAME had to give
   * up — a long name truncated to make room for a mark that could have been read anywhere. A
   * row of their own costs one line and gives the name the whole of the first.
   */
  const tags = modelTags({
    isDefault,
    vision: row.vision,
    isVisionModel,
    fastMode: row.fastMode,
    free: isFreeModel(row),
    discount,
  });

  const priceLine = (a: string, b: string, c: string): string =>
    `${displayPrice(a, currency)} / ${displayPrice(b, currency)} / ${displayPrice(c, currency)}`;
  const meta: ReactNode[] = [
    row.contextWindow ? humanizeTokens(Number(row.contextWindow)) : null,
    // Three prices (cache read / cache write / output); units are explained in the config dialog, not repeated on the card.
    // One price, the one being billed right now. What the row would cost without the promotion
    // answers no question a reader of this list is asking, and spending the meta line's width
    // on it pushes out the figures that do.
    priced ? (
      <span>{priceLine(shownPrice.cacheRead, shownPrice.cacheWrite, shownPrice.output)}</span>
    ) : null,
    // Key status (see keyStatusText): the mask of the key the model is used with — its own, its
    // group's or a detected env fallback's — a plain "configured" for a key typed but not yet
    // saved, or "not configured". An inherited key says where it comes from on hover only: the
    // line reads the same whatever the source, and the source is a detail.
    keyNote !== undefined ? (
      <span data-tooltip={keyNote}>{keyStatusText(row, group)}</span>
    ) : (
      keyStatusText(row, group)
    ),
  ].filter((v) => v !== null);

  const speedBadges =
    speed === "pending" ? (
      <span className="shrink-0 text-xs text-gray-400">{S.models.speedPending}</span>
    ) : speed ? (
      speed.ok ? (
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
          {speed.ttftMs !== undefined && (
            <span
              className={`flex items-center gap-1 ${TONE_CLASS[ttftTone(speed.ttftMs)]}`}
              data-tooltip={S.models.ttftTitle}
            >
              <GlyphIcon d={ICONS.clock} size={11} />
              {Math.round(speed.ttftMs)}ms
            </span>
          )}
          {speed.tps !== undefined && (
            <span
              className={`flex items-center gap-1 ${TONE_CLASS[tpsTone(speed.tps)]}`}
              data-tooltip={S.models.tpsTitle}
            >
              <GlyphIcon d={ICONS.zap} size={11} />
              {speed.tps} tok/s
            </span>
          )}
        </span>
      ) : (
        <span
          className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400"
          data-tooltip={speed.message}
        >
          {S.models.speedFailed}
        </span>
      )
    ) : null;
  return (
    // The card is a box holding the button rather than being one: the routing warning below
    // carries an action of its own, and buttons cannot nest (the group header solves the same
    // problem the same way). overflow-hidden lets the warning strip fill the rounded corners.
    <div className="flex w-full flex-col overflow-hidden rounded-md border border-gray-200 transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-800/40">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-1 flex-col gap-1 px-3 py-2.5 text-left"
      >
        {/* 1. What the model is called — the name alone. The upstream id used to share this row,
            but it is a detail you go looking for rather than one you scan by, and it is a click
            away in the config dialog; the width it was taking now belongs to the name. */}
        <span className="flex w-full min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {modelLabelOf(row.displayName, row.modelId)}
          </span>
          {/* What this model has spent over its whole life, on the row's right edge. Recessive by
              design — grey, on the small rung below the name: it is context for a name you are
              scanning past, not a figure the page is about. A model that has never run shows
              nothing rather than a zero, which would read as a measurement instead of an
              absence. */}
          {usedTokens !== undefined && usedTokens > 0 && (
            <span
              className="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500"
              data-tooltip={S.models.usedTokensTitle}
            >
              {S.models.usedTokens(humanizeTokens(usedTokens))}
            </span>
          )}
        </span>
        {/* 2. Every standing mark, on one row of its own (see `tags`). The row is rendered even
            when empty: most models carry no mark at all, and letting it collapse would leave the
            grid ragged — cards in the same row of a two-column grid stretch to the tallest, so an
            absent line shows up as uneven padding rather than as a shorter card. Its height is
            the tags' own — an empty row holds one invisible tag, which is that height in every
            theme — so a card with marks and a card without are exactly as tall. */}
        <span className="flex w-full flex-wrap items-center gap-1">
          {tags.map((tag) => (
            <Badge key={tag.key} tone={tag.tone} size="sm" tooltip={tag.title}>
              {tag.label}
            </Badge>
          ))}
          {tags.length === 0 && (
            <span aria-hidden className="invisible flex">
              <Badge size="sm">&nbsp;</Badge>
            </span>
          )}
        </span>
        {/* 3. Meta line: the truncating text takes the flexible space; speed badges keep their own
            non-shrinking slot on the right so the numbers never wrap or get pushed out. */}
        <span className="flex w-full items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs text-gray-400 dark:text-gray-500">
            {meta.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && " · "}
                {part}
              </Fragment>
            ))}
          </span>
          {speedBadges}
        </span>
      </button>
      {/* The routing warning and its way out (see unroutableFix): the move the config dialog's
          own button performs, so the owner lands where the problem is fixed rather than on a
          second explanation. */}
      {fix !== null && (
        <NoticeStrip
          tone="attention"
          className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs"
        >
          <span className="min-w-0">{S.models.vendorRowUnroutable}</span>
          {onMoveToCustom && (
            <Button size="sm" className="shrink-0" onClick={onMoveToCustom}>
              {S.models.moveToCustomGroup}
            </Button>
          )}
        </NoticeStrip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config dialog (shared by editing an existing model / adding a custom model)
// ---------------------------------------------------------------------------

type DialogAction = "save" | "setDefault" | "setVisionModel" | "remove";

/**
 * Confirmation text per action (S is a live runtime binding, must be read at render time, not
 * frozen at module scope). A save is confirmed only when it cancels the row's running
 * promotion — the one thing it destroys besides the fields it writes; an ordinary save writes
 * at once.
 */
const CONFIRM_TITLE: Record<DialogAction, () => string> = {
  save: () => S.models.confirmCancelPromotionTitle,
  setDefault: () => S.models.confirmDefaultTitle,
  setVisionModel: () => S.models.confirmVisionModelTitle,
  remove: () => S.models.confirmDeleteTitle,
};
const CONFIRM_BODY: Record<DialogAction, (name: string, promotionPct: number) => string> = {
  save: (n, pct) => S.models.confirmCancelPromotion(n, pct),
  setDefault: (n) => S.models.confirmDefault(n),
  setVisionModel: (n) => S.models.confirmVisionModel(n),
  remove: (n) => S.models.confirmDelete(n),
};

/** A draft as a save sends it, for telling a real edit from typing the stored value back. */
const trimmedRow = (row: RowState): RowState =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ]),
  ) as unknown as RowState;

function ModelDialog({
  projectId,
  row,
  addProvider,
  movedToCustom,
  existingRefs,
  providers,
  detectedEnvKeys,
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
  /** Edit mode: open with the row already moved into the custom group (a card's "move to custom group" action). */
  movedToCustom: boolean;
  existingRefs: ModelRefDto[];
  /** Every group's stored connection: what the form's blank fields follow, shown as placeholders. */
  providers: ProviderConnections;
  /** Env-fallback variables the server reported a value for (see detectedEnvKeys): the only ones the key hint may promise. */
  detectedEnvKeys: ReadonlySet<string>;
  currency: Currency;
  canEdit: boolean;
  isDefault: boolean;
  isVisionModel: boolean;
  onClose: () => void;
  /** Writes the row; resolves with whether it landed (the host closes the dialog when it did). */
  onSubmit: (row: RowState, action: DialogAction) => Promise<boolean>;
}) {
  // What the dialog opens on, and what a close compares the draft with: the stored row, the row
  // already moved into the custom group when the dialog was opened to make that move, or a blank
  // model. Pricing input is displayed/entered in the current currency; converted back to USD
  // storage on submit (RowState always stores USD).
  const [opening] = useState<RowState>(() => {
    if (row) {
      return {
        ...row,
        cacheRead: usdToInput(row.cacheRead, currency),
        cacheWrite: usdToInput(row.cacheWrite, currency),
        output: usdToInput(row.output, currency),
        // Opened from a card's "move to custom group": the same edit the dialog's own button
        // makes, applied before the form is first painted so the user arrives at the protocol
        // control instead of having to find the move again in here.
        ...(movedToCustom
          ? {
              provider: "custom",
              clientType: clientTypeAfterProviderChange(
                "custom",
                row.clientType,
                inheritedConnection("custom", row.modelId, providers.custom),
              ),
            }
          : {}),
      };
    }
    // New model: the base URL, the key and the protocol start blank, and blank means "follow
    // the group" — the endpoint, protocol and key its `[providers.<id>]` table holds (a new
    // Project writes a gateway's there). The fields say so in their placeholders, and typing
    // into one makes it this model's own. A custom / user-defined group with nothing to inherit
    // leaves the protocol to detection or a manual pick. provider keeps the entry point's
    // original value (a user-defined group must not collapse into custom), stored as a separate
    // field from model_id, with no concatenation on save.
    //
    // A first-party vendor group cannot be reached here at all: it carries the built-in
    // catalog and nothing else, so no entry point opens this dialog on one (the group
    // headers drop the action, the empty state opens custom, and a new group's name may not
    // collide with a built-in id).
    return {
      provider: addProvider,
      modelId: "",
      original: null,
      // A new custom model claims no vision support until it is detected or switched on by
      // hand (per maintainer). A model added to a gateway or vLLM keeps the optimistic default.
      vision: !isCustomLikeGroup(addProvider),
      contextWindow: "",
      maxTokens: "",
      fastMode: false,
      clientType: "",
      cacheRead: "",
      cacheWrite: "",
      output: "",
      baseUrl: "",
      originalBaseUrl: "",
      apiKeyInput: "",
      clearApiKey: false,
    };
  });
  const draft = useFormDraft(opening, { normalize: trimmedRow });
  const form = draft.draft;
  /**
   * The Details fold (model-dialog-details.tsx): closed whenever the dialog opens, never
   * remembered. A wrong field inside it opens it.
   */
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** Connectivity test in progress. */
  const [testing, setTesting] = useState(false);
  /** The write is in flight (its protocol probe included): the dialog waits for its answer. */
  const [saving, setSaving] = useState(false);
  /**
   * Action pending confirmation: set as default / set as vision proxy model / delete, and a
   * save that would cancel the row's running promotion. An ordinary save is not confirmed.
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
  const detectInFlight = useRef<Promise<DetectOutcome | null> | null>(null);
  /** Vision probe in progress (its own control, so its own busy state). */
  const [visionDetecting, setVisionDetecting] = useState(false);
  /** Single-flight guard for the vision probe: it bills the user, so never twice at once. */
  const visionInFlight = useRef<Promise<void> | null>(null);
  const isNew = row === null;
  const preset = row !== null && isPreset(row);
  /** The loaded row's running promotion, explained under the price fields. */
  const promotion = fractionOff(row?.discount);
  /**
   * The draft's group's stored connection, and what a blank field of this draft follows: the
   * group's table and nothing else. The draft's own base URL decides whether the group's key
   * reaches it (a base URL on another origin than the group's endpoint gets none).
   */
  const group = providers[form.provider];
  const inherited = inheritedConnection(form.provider, form.modelId, group, form.baseUrl);
  /** The protocol the draft is used with: its own, else the inherited one ("" = routed by id). */
  const effectiveClientType = form.clientType.trim() || inherited.clientType || "";

  // Read from the live form, not the saved row, so editing the upstream id, the protocol or
  // the base URL updates the answer as it is typed.
  const { protocol: fastProtocol, show: showFastMode } = fastModeState(form, inherited);

  // Vision support and fast mode share one row; either can be missing, so the row's own
  // presence and the cell width follow from which switches are actually there (capabilityRow).
  const showVision = !preset;
  const { show: showCapabilityRow, cellClass: toggleCellClass } = capabilityRow({
    vision: showVision,
    fastMode: showFastMode,
  });

  const set = (patch: Partial<RowState>) => draft.patch(patch);

  /**
   * What a failed probe says. An entry its group cannot place fails upstream with MMSP's own
   * sentence — `No client for model "<id>": its family is not known`, or `Unknown client
   * type "<type>"` for a pin MMSP does not have, then the list of client types it does have —
   * which names an internal vocabulary and leaves the reader to infer what to do about it.
   * That case gets a message naming the problem and the fix its own shape calls for
   * (unroutableFix, which reads the config rather than matching that text); every
   * other failure still relays the upstream text, which is what makes a wrong key or a wrong
   * endpoint diagnosable. The relayed sentence is not lost either way: it goes to the console,
   * where a developer looking into a report can still read it.
   */
  const reportTestFailure = (message: string) => {
    if (unroutableFix(form.provider, form.modelId, effectiveClientType) === null) {
      toastError(S.models.testFailed(message));
      return;
    }
    console.warn(`[models] ${form.provider}/${form.modelId.trim()}: ${message}`);
    toastError(S.models.testNotRoutable);
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
      // - base URL isn't sensitive, so the frontend always sends the form's current value (empty
      //   means null = none of the model's own, so the group's applies).
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
      else reportTestFailure(res.message ?? "");
    } catch (e) {
      reportTestFailure(apiErrorText(e));
    } finally {
      setTesting(false);
    }
  };

  /**
   * Protocol detection: POST /models/detect probes the base URL for the three detectable
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
  const detectOnce = async (mode: DetectMode): Promise<DetectOutcome | null> => {
    // What an empty result means depends on who asked. A manual run simply failed; a save
    // run silently resolves to the compatible client and says so, because the save it was
    // serving is still going through.
    const failed = () => {
      setDetectFailed(true);
      if (mode === "save") toastInfo(S.models.detectFellBack);
      else toastError(S.models.detectFailedBody);
    };
    // The model's own base URL, or — left blank — the one it follows, so a model in a group
    // whose settings name the endpoint can be probed without retyping it.
    const baseUrl = form.baseUrl.trim() || inherited.baseUrl?.trim() || "";
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
        // The protocol may have answered on a tidied-up form of the URL (a `/v1` added or
        // dropped, a pasted endpoint path removed). Saving the typed form would persist a
        // base URL the detected protocol is not served at, so the field takes the one that
        // answered and the outcome carries it on to the save path.
        const served = res.baseUrl;
        const patch = served !== undefined && served !== baseUrl ? { baseUrl: served } : {};
        set({ clientType: res.detected, ...patch });
        return { clientType: res.detected, ...patch };
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
  const runDetect = (mode: DetectMode): Promise<DetectOutcome | null> => {
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
    const name = S.models.protocolNames[detected.clientType] ?? detected.clientType;
    toastSuccess(
      detected.baseUrl === undefined
        ? S.models.detectedProtocol(name)
        : S.models.detectedProtocolAndUrl(name, detected.baseUrl),
    );
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
   * Manual protocol override from the in-field picker — a protocol of the model's own, or null
   * to drop it and follow the group again. Bumping the run counter supersedes any in-flight
   * detection, so a late result cannot clobber a choice the user just made.
   */
  const pickProtocol = (clientType: ProtocolClientType | null) => {
    detectSeq.current++;
    setDetecting(false);
    setDetectFailed(false);
    set({ clientType: clientType ?? "" });
  };

  /**
   * Validate and convert pricing back to USD storage; returns null on validation failure —
   * every error is placed below the offending input, which is highlighted red (no more
   * top-level banner: it's too far from the error site, and with three price fields it's
   * hard to tell which one is wrong).
   */
  // base URL required-field policy: an endpoint behind a compatible OpenAI-protocol client
  // can't be inferred — needed for custom / user-defined groups and entries using one of those
  // clients; not for entries routed within a first-party vendor group, nor for an
  // `openai-official` pin (an official client has its vendor's default endpoint). The Penguin
  // Go relay needs one too: its shared key must never fall through to a vendor default. The
  // FIELD is required only where nothing else supplies the endpoint — the group's settings fill
  // a blank one, so there it may stay blank. Shared by validation and the label's required "*"
  // mark.
  const openAiLike =
    OPENAI_COMPATIBLE_CLIENT_TYPES.has(effectiveClientType.toLowerCase()) ||
    form.provider === "custom" ||
    providerInfo(form.provider) === undefined;
  const baseUrlRequired =
    (form.provider === PENGUIN_GO_PROVIDER_ID || (!preset && openAiLike)) &&
    !inherited.baseUrl?.trim();
  // Custom-like groups (custom + user-defined) pick among the protocol clients the picker
  // offers (PROTOCOL_CLIENT_TYPES): the base URL field's suffix becomes the protocol picker
  // there, unless the entry is pinned to a client outside them — that keeps the read-only note
  // below instead. Gateways stay pinned to their preset protocol (their base URL is fixed too).
  const customLikeGroup = form.provider === "custom" || providerInfo(form.provider) === undefined;
  const showProtocolSelector =
    customLikeGroup && isGenericProtocolClientType(form.clientType) && !preset;
  // A viewer without edit rights gets the plain grey suffix: the picker would offer writes
  // the save path rejects anyway.
  const showProtocolPicker = showProtocolSelector && canEdit;
  // Protocol-path suffix shown inside the base URL field (every model, even while the
  // field is empty): the path the client appends to the base URL, i.e. the endpoint
  // shape a custom URL must serve. Recomputed from the live form so switching the
  // group in add mode, or typing an id of another vendor family, updates it.
  const protocolPath = protocolPathForModel(form.provider, effectiveClientType, form.modelId);
  // Which protocol the picker shows as the model's own — null while it has none.
  const protocolChoice = protocolSelectorValue(form.clientType);
  // A protocol the group decides (its settings name one): the picker's first row follows it,
  // and with no protocol of its own the model shows the group's path.
  const followGroup =
    inherited.clientType !== undefined
      ? {
          label: S.models.protocolFollowGroup,
          description: S.models.protocolNames[inherited.clientType] ?? inherited.clientType,
          onPick: () => pickProtocol(null),
        }
      : undefined;
  // In the picker, a protocol neither chosen nor inherited has no path to show: the field
  // would otherwise display /chat/completions and read as a decision the user never made. The
  // placeholder takes its place until a pick or a detection lands. (The read-only suffix used
  // by preset groups keeps showing the real path — those entries genuinely route that way.)
  const suffixLabel =
    showProtocolPicker && protocolChoice === null && followGroup === undefined
      ? S.models.protocolUnset
      : protocolPath;

  const modelLabel = modelLabelOf(form.displayName, form.modelId);

  /**
   * What is wrong with the draft, per field — read live, since Save waits until nothing is.
   * Each error sits below its input, which turns red: closer to the error site than a banner.
   */
  const fieldErrors = ((): FieldErrors => {
    const modelId = form.modelId.trim();
    const ref: ModelRefDto = { provider: form.provider, modelId };
    const errs: FieldErrors = {};
    if (!modelId) errs.modelId = S.common.requiredField;
    // A new or renamed (provider, modelId) must not duplicate another entry (renaming back to itself isn't a conflict).
    else if (!sameModelRef(ref, form.original) && existingRefs.some((r) => sameModelRef(r, ref))) {
      errs.modelId = S.models.modelIdExists;
    }
    if (baseUrlRequired && !form.baseUrl.trim()) errs.baseUrl = S.models.baseUrlRequired;

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
    return errs;
  })();
  const valid = Object.keys(fieldErrors).length === 0;
  /**
   * Whether the dialog holds a change to save: an edit, or the move to the custom group it was
   * opened to make (that move is where it opened, so closing asks nothing about it).
   */
  const changed = draft.dirty || movedToCustom;
  // Errors show once there is something to save; an empty model id is marked by its asterisk.
  const shownErrors: FieldErrors =
    changed && form.modelId.trim() === ""
      ? { ...fieldErrors, modelId: undefined }
      : changed
        ? fieldErrors
        : {};
  // A wrong field inside the closed fold opens it, so Save never waits on something out of view.
  // Keyed on which fields are wrong: a reader who folds it again is left alone until another one is.
  const foldedWrong = foldedErrors(shownErrors, isNew).join(" ");
  useEffect(() => {
    if (foldedWrong !== "") setDetailsOpen(true);
  }, [foldedWrong]);

  /** The row a save sends, from a valid draft: prices back in USD, defaults filled in. */
  const built = ((): { row: RowState; cancelsPromotion: boolean } | null => {
    if (!valid) return null;
    const modelId = form.modelId.trim();
    const contextWindow = form.contextWindow.trim();
    const cacheRead = priceToSubmit(form.cacheRead, row?.cacheRead, currency);
    const cacheWrite = priceToSubmit(form.cacheWrite, row?.cacheWrite, currency);
    const output = priceToSubmit(form.output, row?.output, currency);
    // The server cancels the promotion of a row saved with a new price or identity, so the row
    // drops it too: the card would otherwise keep showing it until the save lands.
    const cancelsPromotion =
      row !== null &&
      (cacheRead !== row.cacheRead ||
        cacheWrite !== row.cacheWrite ||
        output !== row.output ||
        form.provider !== row.provider ||
        modelId !== row.modelId);
    return {
      row: {
        ...form,
        modelId,
        // Custom models with an empty context window fall back to the default value (preset models left empty just mean "unknown", not auto-filled).
        contextWindow:
          !preset && !contextWindow ? String(CUSTOM_CONTEXT_DEFAULT) : form.contextWindow,
        cacheRead,
        cacheWrite,
        output,
        ...(cancelsPromotion ? { discount: undefined } : {}),
      },
      cancelsPromotion,
    };
  })();
  /** Saving now would cancel the row's running promotion, which is asked about first. */
  const dropsPromotion = built !== null && built.cancelsPromotion && promotion !== undefined;

  /**
   * Commit one dialog action and wait for its answer: the host closes the dialog once the write
   * lands, and on a failure the dialog stays as it was, draft and all. Saving a custom-like
   * entry whose protocol is still unset detects it FIRST and continues with whatever comes back:
   * asking the endpoint is more reliable than guessing, so it is worth the round-trip.
   *
   * A probe that finds nothing no longer blocks (per maintainer: 默认都走兼容类型). The save
   * goes through on the compatible client, with a toast saying that is what happened —
   * detection is an accuracy improvement, not a gate, and refusing to save left the user
   * stuck on an endpoint that simply cannot be probed. Nothing unstartable is written
   * either way, because the fallback is a real client.
   *
   * The other actions (set-default / set-vision-proxy / remove) do not probe: they are not
   * the user saying "this model is ready", and rowToEntry's fallback still applies. Remove
   * names the row as loaded and writes nothing of the draft; set-default and set-vision-proxy
   * carry the draft with them, so they wait for it to be valid like Save does.
   */
  const submit = async (action: DialogAction) => {
    let next: RowState;
    if (action === "remove") next = form;
    else if (built !== null) next = built.row;
    else return;
    setSaving(true);
    let closed = false;
    try {
      if (needsProtocolDetectOnSave(action, next.provider, next.clientType, inherited)) {
        // Joins a run already started from the Detect button rather than probing twice.
        const detected = await runDetect("save");
        next = {
          ...next,
          clientType: detected?.clientType ?? DEFAULT_CUSTOM_CLIENT_TYPE,
          // The draft was snapshotted before the probe, so a base URL the probe corrected
          // has to be carried over by hand — otherwise the entry saves a URL the detected
          // protocol is not served at.
          ...(detected?.baseUrl !== undefined ? { baseUrl: detected.baseUrl } : {}),
        };
      }
      closed = await onSubmit(next, action);
    } finally {
      if (!closed) setSaving(false);
    }
  };
  /** Every way out — Cancel, Esc, the ×, a press outside — asks first while the draft holds edits. */
  const requestClose = useGuardedClose(...closeUnlessBusy(saving, onClose, draft.scope));

  // Provider info for the current group (updates live as the group dropdown
  // changes): the "get model id / API key" links come from it (shown next to
  // the model id and API key labels in both the add and edit dialogs; custom
  // and self-defined groups have no link).
  const dialogProvider = providerInfo(form.provider);
  // The variable a blank key may be PRESENTED as covered by, for the entry as drafted (core's
  // modelEnvPreviewKey, which the server's masked preview reads too) on its EFFECTIVE shape:
  // undefined for every row whose endpoint — its own or the one it follows — is not the
  // vendor's own (a gateway's endpoint, a custom or vLLM server, a vendor group pointed at a
  // proxy) and for a keyless vLLM / custom row with no base URL anywhere. The hint and the
  // stored-mask block below follow this.
  const liveEnvKey = envHintKeyFor(
    form.provider,
    form.modelId,
    form.clientType,
    form.baseUrl,
    groupShape(group),
  );
  // An id this entry's group cannot place (see unroutableFix). The save is refused by the
  // server for a new or rekeyed entry, so the warning and its way out are shown before the
  // attempt; a row that was already stored keeps saving and carries the same warning on its
  // card.
  const routingFix = unroutableFix(form.provider, form.modelId, effectiveClientType);

  /** Identity section: upstream model id (renamable; "get model id" link next
   * to the label) + display name and group side by side (both editable;
   * group is the entry's provider field — changing either is a key change,
   * submitted together as renamedFrom). */
  const identityFields = (
    <>
      <label className="block">
        <span className="mb-1 flex items-baseline justify-between gap-2">
          <FieldLabel required block={false}>
            {S.models.modelId}
          </FieldLabel>
          <span className="flex shrink-0 items-baseline gap-2">
            {/* The model-homepage entry lives in the dialog header (top-right button); only the "get model ids" provider link stays here. */}
            {dialogProvider?.modelsUrl && (
              <Link
                href={dialogProvider.modelsUrl}
                external
                variant="standalone"
                className="shrink-0 text-xs"
              >
                {S.models.getModelIds}
              </Link>
            )}
          </span>
        </span>
        <Input
          size="sm"
          required
          value={form.modelId}
          disabled={!canEdit}
          invalid={Boolean(shownErrors.modelId)}
          onChange={(e) => set({ modelId: e.target.value })}
          className="font-mono"
          autoFocus={isNew}
          placeholder={S.models.modelIdHint}
        />
        {shownErrors.modelId && <FieldError>{shownErrors.modelId}</FieldError>}
      </label>
      {routingFix !== null && (
        <NoticeStrip
          tone="attention"
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-xs"
        >
          <span>{S.models.autoRouteNone}</span>
          {canEdit && (
            <Button
              size="sm"
              className="shrink-0"
              onClick={() =>
                set({
                  provider: "custom",
                  clientType: clientTypeAfterProviderChange(
                    "custom",
                    form.clientType,
                    inheritedConnection("custom", form.modelId, providers.custom),
                  ),
                })
              }
            >
              {S.models.useCustomGroup}
            </Button>
          )}
        </NoticeStrip>
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
            set({
              provider,
              clientType: clientTypeAfterProviderChange(
                provider,
                form.clientType,
                inheritedConnection(provider, form.modelId, providers[provider]),
              ),
            });
          }}
        >
          {/* Built-in groups: the ones that take hand-added models (custom, vLLM, OpenRouter,
              TokenDance, SiliconFlow), and the group the row was loaded in — a row already in
              another gateway or a vendor group may stay there, but no other row may be moved
              into one (the server refuses that as an addition, model_not_addable). The current
              value stays listed so it is valid. */}
          {MODEL_PROVIDERS.filter(
            (p) =>
              isAddableGroup(p.id) || p.id === row?.original?.provider || p.id === form.provider,
          ).map((p) => (
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

  // The variable a blank API key would actually be covered by: no key of the model's own nor
  // of its group's, the entry routes to a variable (resolved live, so it follows the id /
  // protocol as they are edited), and that variable is one the server reported a value for.
  // Knowing a variable's *name* is not knowing it is set — promising an unset one would tell
  // the user to leave the field empty and leave the model with no key at all.
  const envHintKey =
    !form.credential?.apiKeyMasked &&
    inherited.apiKeySource !== "provider" &&
    liveEnvKey !== undefined &&
    detectedEnvKeys.has(liveEnvKey)
      ? liveEnvKey
      : undefined;
  const { apiKey: apiKeyHint, baseUrl: baseUrlHint } = connectionPlaceholders(form, group, {
    envKey: envHintKey,
    baseUrlRequired,
  });
  // Default endpoint note (zhipu / moonshot each have domestic / international
  // endpoints): shown only when the env fallback hint appears (hence keyed off the same
  // envHintKey) and this entry actually goes through the provider's own client (the
  // resolved envKey matches the provider) — entries going through the OpenAI
  // client (OPENAI_API_KEY) have no provider default endpoint to speak of.
  const envNote =
    envHintKey !== undefined && envHintKey === dialogProvider?.envKey
      ? S.models.providerEnvNotes[form.provider]
      : undefined;
  // The add dialog's note on the protocol a new model will speak, inside its Details: the
  // group's (with blank fields following the group where it also names the endpoint, the user's
  // own endpoint where it does not), or — a custom / user-defined group with nothing to follow —
  // how to pick or detect one. A group that sets no protocol routes the model by its id, which
  // needs no note.
  const inheritedProtocolName =
    inherited.clientType !== undefined
      ? (S.models.protocolNames[inherited.clientType] ?? inherited.clientType)
      : undefined;
  const addNote =
    inheritedProtocolName !== undefined
      ? inherited.baseUrl !== undefined
        ? S.models.addProtocolHintInherit(inheritedProtocolName)
        : S.models.addProtocolHintPinned(inheritedProtocolName)
      : customLikeGroup
        ? S.models.addProtocolHintDetect
        : undefined;

  /**
   * The dialog's blocks below the identity fields, each placed in view or inside the Details fold
   * by foldedSlots: the add dialog folds all of them (a new model follows its group, so the
   * connection fields are overrides), the settings dialog folds the limits, the prices and the
   * capability switches.
   */
  const slots: Record<ModelDialogSlot, ReactNode> = {
    // Model-level actions: test connectivity (for a new model, fill in the id and key to verify
    // before saving) / set default / set as vision proxy model / remove.
    actions: canEdit && (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={testing || !form.modelId.trim()} onClick={() => void runTest()}>
          {testing ? S.models.testing : S.models.testConnection}
        </Button>
        {/* Setting the default or the vision model writes the draft with it, so those two wait
            for it to be valid, like Save; removing writes nothing of the draft. */}
        {!isNew && !isDefault && (
          <Button size="sm" disabled={saving || !valid} onClick={() => setConfirming("setDefault")}>
            {S.models.setDefault}
          </Button>
        )}
        {!isNew && form.vision && !isVisionModel && (
          <Button
            size="sm"
            title={S.models.visionModelHint}
            disabled={saving || !valid}
            onClick={() => setConfirming("setVisionModel")}
          >
            {S.models.setVisionModel}
          </Button>
        )}
        {!isNew && (
          <>
            <span className="min-w-0 flex-1" />
            <Button
              size="sm"
              variant="danger"
              disabled={saving}
              onClick={() => setConfirming("remove")}
            >
              {S.models.remove}
            </Button>
          </>
        )}
      </div>
    ),
    // API key — "get API key" link next to the label. PasswordInput carries its own show/hide
    // toggle and brings its own <label> wrapper, so this outer container is a <div> (a nested
    // <label> is invalid).
    apiKey: (
      <div className="space-y-1">
        <div className="block">
          <span className="mb-1 flex items-baseline justify-between gap-2">
            <FieldLabel block={false}>{S.models.apiKey}</FieldLabel>
            {dialogProvider?.apiKeyUrl && (
              <Link
                href={dialogProvider.apiKeyUrl}
                external
                variant="standalone"
                className="shrink-0 text-xs"
              >
                {S.models.getApiKey}
              </Link>
            )}
          </span>
          <PasswordInput
            size="sm"
            aria-label={S.models.apiKey}
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
              <Checkbox
                checked={form.clearApiKey}
                onChange={(on) => set({ clearApiKey: on })}
                label={S.models.clearApiKey}
              />
            )}
          </div>
        )}
        {/* Detected first-party env fallback, shown like a stored key (same slot, same mask
            rule): the created-at position says where the key comes from instead, and there is
            no clear control — an environment variable cannot be cleared from here. Typing a new
            key hides this like the stored block; once saved, the stored key takes priority and
            the display switches to the stored form. The mask is the SAVED row's: once the draft
            resolves to another variable or to none (a proxy base URL typed over a vendor row),
            it is hidden rather than left promising a key the draft will not have. */}
        {!form.credential?.apiKeyMasked &&
          form.envKeyMasked !== undefined &&
          liveEnvKey === form.envKey &&
          !form.apiKeyInput && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-mono">{form.envKeyMasked}</span>
              <span className="text-gray-400">{S.models.readFromEnv}</span>
            </div>
          )}
      </div>
    ),
    // Base URL (required for custom / user-defined groups and explicit openai protocol — see
    // baseUrlRequired). The in-field suffix at the right edge shows the protocol path the client
    // appends to the base URL — the endpoint shape a custom URL must serve; it renders for every
    // model and stays while the field is empty. For custom / user-defined groups that suffix IS
    // the protocol SELECTOR (protocol-suffix.tsx). The detect ACTION sits at this field's
    // top-right, next to the label. A <div>, not a <label>: the picker is a <button>, and a
    // label may not contain a second labelable element besides its control; the input carries
    // an aria-label so it stays named. No detection verdict is rendered under the field (both
    // outcomes are toasts, and the suffix shows where the protocol ended up), so the idle and
    // post-detection layouts are identical.
    baseUrl: (
      <div className="block">
        {showProtocolPicker ? (
          <span className="mb-1 flex items-baseline justify-between gap-2">
            <FieldLabel required={baseUrlRequired} block={false}>
              {S.models.baseUrl}
            </FieldLabel>
            {/* Always live: no API key is needed (the server falls back to the stored key
                and then to the protocol's env var), and anything that does go wrong is
                explained in a popup. `detecting` only guards re-entrancy. */}
            <Button
              variant="link"
              size="sm"
              loading={detecting}
              onClick={() => void detectFromButton()}
              title={S.models.detectProtocolHint}
              className="shrink-0"
            >
              {detecting ? S.models.detecting : S.models.detectProtocol}
            </Button>
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
            invalid={Boolean(shownErrors.baseUrl)}
            // Editing the URL retires the previous run's verdict: it described the old
            // endpoint, and leaving it up would keep asserting a result for a URL that is
            // no longer in the field.
            onChange={(e) => {
              setDetectFailed(false);
              set({ baseUrl: e.target.value });
            }}
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
            placeholder={baseUrlHint}
          />
          {showProtocolPicker ? (
            <div className="absolute inset-y-0 right-1 flex items-center">
              <ProtocolSuffixMenu
                value={protocolChoice}
                path={suffixLabel}
                detecting={detecting}
                tone={detectFailed ? "warn" : null}
                follow={followGroup}
                onPick={pickProtocol}
              />
            </div>
          ) : (
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-xs text-gray-400">
              {protocolPath}
            </span>
          )}
        </div>
        {shownErrors.baseUrl && <FieldError>{shownErrors.baseUrl}</FieldError>}
      </div>
    ),
    // Context window + max output tokens side by side (one row): the "Token" unit sits inside
    // each box as a muted right suffix. Placeholders cannot scroll, so at this half width they
    // carry only a short line; the full explanation lives in the input's title (hover). Max
    // output tokens: per-model cap on the request's output — when set it wins over the Agent's
    // system_config value; empty inherits it (lets a small-context local model stay under its
    // window).
    limits: (
      <div className="grid grid-cols-2 items-start gap-2">
        <Input
          label={S.models.contextWindow}
          size="sm"
          value={form.contextWindow}
          inputMode="numeric"
          disabled={!canEdit}
          error={shownErrors.contextWindow}
          onChange={(e) => set({ contextWindow: digitsOnly(e.target.value) })}
          // Half-width cell: the placeholder is wider than the box in English, and an input
          // clips at its padding box, so an unclipped one runs past the value area and collides
          // with the unit. `truncate` ends it in an ellipsis instead, which reads as "there is
          // more" rather than as text colliding; the title has it in full.
          className="truncate font-mono"
          affix={{ trailing: S.models.tokenUnit }}
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
        <Input
          label={S.models.maxTokens}
          size="sm"
          value={form.maxTokens}
          inputMode="numeric"
          disabled={!canEdit}
          error={shownErrors.maxTokens}
          onChange={(e) => set({ maxTokens: digitsOnly(e.target.value) })}
          // Truncated for the same reason as the context window beside it.
          className="truncate font-mono"
          affix={{ trailing: S.models.tokenUnit }}
          // Short placeholder (fits the half-width box); the full explanation incl. the small-context advice is the hover title.
          title={S.models.maxTokensTitle}
          placeholder={S.models.maxTokensHint}
        />
      </div>
    ),
    // Pricing: three fields side by side with self-contained labels (… price) — no standalone
    // section heading; currency and unit (/M tok) are shown inside the input. Errors land right
    // under the offending field. The fields hold the list price, not the promotional price the
    // card prints: the promotion is stored apart and taken off when usage is priced, which the
    // line under them says, since typing a different price cancels it.
    pricing: (
      <div className="space-y-1">
        <div className="grid grid-cols-3 items-start gap-2">
          {(
            [
              ["cacheRead", S.models.priceCacheRead, form.cacheRead],
              ["cacheWrite", S.models.priceCacheWrite, form.cacheWrite],
              ["output", S.models.priceOutput, form.output],
            ] as Array<[keyof FieldErrors & keyof RowState, string, string]>
          ).map(([key, label, value]) => (
            <Input
              key={key}
              label={label}
              size="sm"
              value={value}
              inputMode="decimal"
              disabled={!canEdit}
              error={shownErrors[key]}
              onChange={(e) => set({ [key]: decimalOnly(e.target.value) })}
              className="text-right font-mono"
              affix={{ leading: CURRENCY_SYMBOL[currency], trailing: S.models.priceUnitShort }}
            />
          ))}
        </div>
        {promotion !== undefined && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {S.models.promotionPriceHint(Math.round(promotion * 100))}
          </p>
        )}
      </div>
    ),
    // Capability switches — vision support and fast mode side by side on one row, reusing the
    // dialog's two-up grid. `items-start` keeps both cells top-aligned when only one of them
    // grows a muted hint line. Each switch is optional, so the row itself is conditional and a
    // lone switch takes the whole width (toggleCellClass).
    capabilities: showCapabilityRow && (
      <div className="grid grid-cols-2 items-start gap-2">
        {/* Vision capability: for preset models it's flagged by the built-in catalog
            (read-only, so no cell at all); custom models toggle it here — an iOS-style
            switch sitting inline right next to the label. Only the OFF state shows one small
            muted line: images are then read via the configured vision proxy model. */}
        {showVision && (
          <div className={toggleCellClass}>
            {/* Detect sits inline after the switch, next to the setting it fills in. Always
                clickable, single-flight, toast-only, like protocol detection; it just costs a
                real (tiny) completion, so it never runs on its own. `flex-wrap` lets the
                trigger drop onto its own line inside a half-width cell. */}
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
                <Button
                  variant="link"
                  size="sm"
                  loading={visionDetecting}
                  onClick={() => void detectVisionFromButton()}
                  title={S.models.detectVisionHint}
                  className="shrink-0"
                >
                  {visionDetecting ? S.models.detectingVision : S.models.detectVision}
                </Button>
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
            pricing). Offered only where MMSP's routed client actually puts the parameter on
            the wire (fastModeProtocol). The one small muted line appears in the non-default
            (ON) state, and the label's hover title reveals it before toggling. Enabling is
            confirmed (premium billing), disabling is immediate. */}
        {showFastMode && (
          <div className={toggleCellClass}>
            <label
              className={`inline-flex items-center gap-2 ${canEdit ? "cursor-pointer" : "cursor-not-allowed"}`}
              data-tooltip={S.models.fastModeHint}
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
              <p className={`mt-1 text-xs ${toneInk.attention}`}>{S.models.fastModeUnsupported}</p>
            )}
          </div>
        )}
      </div>
    ),
  };
  const folded = foldedSlots(isNew);
  /** The blocks in view (`false`) or in the fold (`true`), in the dialog's order; absent ones skipped. */
  const slotNodes = (inFold: boolean) =>
    MODEL_DIALOG_SLOTS.filter((slot) => folded.has(slot) === inFold && slots[slot]).map((slot) => (
      <Fragment key={slot}>{slots[slot]}</Fragment>
    ));

  return (
    <Modal
      open
      title={isNew ? S.models.addTitle : S.models.editTitle}
      onClose={requestClose}
      // The group settings' width: the longest catalog endpoint and its protocol path read
      // whole in the base URL field.
      widthClass="sm:max-w-3xl"
      footer={
        <>
          <Button size="sm" disabled={saving} onClick={requestClose}>
            {S.common.cancel}
          </Button>
          {canEdit && (
            <Button
              size="sm"
              variant="primary"
              // Live once there is a change and nothing is wrong with it. Saving may have to
              // probe the endpoint first (protocol still unset), which is a network round-trip:
              // the label says so, matching the "test connection" convention in this dialog.
              disabled={!changed || !valid || saving || detecting}
              onClick={() => {
                if (dropsPromotion) setConfirming("save");
                else void submit("save");
              }}
            >
              {detecting ? S.models.detecting : isNew ? S.models.addAction : S.common.save}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {/* Header: the logo, and beside it one line each for the name, the upstream id and the
            marks. The marks used to share the name's line, where they pushed a long name into
            wrapping under them and left the header two ragged lines tall; on a line of their
            own the name keeps the width it needs. Same pills the cards wear, so the list and
            the dialog agree about what a mark looks like. The model homepage entry stays a
            small secondary button on the right — a property of the model, not an input. */}
        {!isNew && (
          <div className="flex items-center gap-3 rounded-md bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
            <ProviderLogo
              provider={form.provider}
              className="h-6 w-6 shrink-0 text-gray-700 dark:text-gray-300"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-sm font-medium">{modelLabel}</span>
              {/* Upstream id in small text: when there's no display name the line above is
                  already showing it, so don't repeat. Tested on the trimmed value, not on
                  `undefined`: clearing the field leaves an empty string, which is just as
                  nameless. */}
              {form.displayName?.trim() && (
                <span className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                  {form.modelId}
                </span>
              )}
              {(isDefault || form.vision || isVisionModel) && (
                <span className="flex flex-wrap items-center gap-1 pt-0.5">
                  {isDefault && (
                    <Badge tone={TAG_TONE.status} size="sm">
                      {S.models.default}
                    </Badge>
                  )}
                  {form.vision && (
                    <Badge tone={TAG_TONE.capability} size="sm">
                      {S.models.visionBadge}
                    </Badge>
                  )}
                  {isVisionModel && (
                    <Badge tone={TAG_TONE.capability} size="sm">
                      {S.models.visionModelBadge}
                    </Badge>
                  )}
                </span>
              )}
            </div>
            {row && modelHomepageUrl(row.provider, row.modelId) && (
              <a
                href={modelHomepageUrl(row.provider, row.modelId)}
                target="_blank"
                rel="noopener noreferrer"
                className={`${buttonClass("secondary", "sm")} shrink-0`}
              >
                {S.models.homepage}
                {/* External-link glyph (opens in a new tab) */}
                <GlyphIcon d={ICONS.externalLink} />
              </a>
            )}
          </div>
        )}

        {/* Adding a model: the identity fields alone are in view (the "get model id" link next
            to the id); everything else is in Details, since a new model follows its group. */}
        {isNew && identityFields}

        {/* In view on a saved model: its actions, the API key and the base URL. */}
        {slotNodes(false)}

        {/* Identity on a saved model: model id (renamable) + display name and group. */}
        {!isNew && identityFields}
        {/* An entry pinned to a protocol the dialog cannot edit — a pin outside a custom-like
            group or a client outside the picker's (a Penguin Go row the platform added, a
            vLLM-adapter row in a custom group), or a pin from an older config: read-only
            display. Compared canonically so the deprecated bare "openai" spelling (pre-0.4.2
            configs) is not flagged either, skipped when the protocol selector above already
            represents it (the picker's protocols in custom-like groups are editable there), and
            skipped when the value IS what the model would follow anyway — that is this group's
            normal protocol, not a leftover from an older config, and "kept as configured" would
            misdescribe it. */}
        {!isNew &&
          !preset &&
          !showProtocolSelector &&
          form.clientType &&
          form.clientType !== inherited.clientType &&
          canonicalClientType(form.clientType) !== "openai-chat" && (
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {S.models.clientTypeLocked(form.clientType)}
            </p>
          )}

        {/* Details: the limits, the prices and the capability switches — and, when adding,
            the connection overrides and the connectivity test too (foldedSlots). Closed on
            every open; a wrong field inside it opens it. */}
        <DetailsFold open={detailsOpen} onToggle={() => setDetailsOpen((open) => !open)}>
          {isNew && addNote !== undefined && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{addNote}</p>
          )}
          {slotNodes(true)}
        </DetailsFold>
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
          confirmLabel={S.common.confirm}
          cancelLabel={S.common.cancel}
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">{S.models.fastModeConfirmBody}</p>
          {fastProtocol === "anthropic" && (
            <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
              {S.models.fastModeConfirmPreview}
            </p>
          )}
        </ConfirmModal>
      )}

      {/* Confirmation before an action that writes config (set default / set as vision proxy
          model / remove), or a save that cancels a running promotion: stacked on top of the
          config dialog. Losing the promotion or the row is what the danger tone marks. */}
      {confirming && (
        <ConfirmModal
          open
          title={CONFIRM_TITLE[confirming]()}
          tone={confirming === "remove" || confirming === "save" ? "danger" : "primary"}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            const action = confirming;
            setConfirming(null);
            void submit(action);
          }}
          confirmLabel={
            confirming === "remove"
              ? S.common.delete
              : confirming === "save"
                ? S.common.save
                : S.common.confirm
          }
          cancelLabel={S.common.cancel}
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {CONFIRM_BODY[confirming](modelLabel, Math.round((promotion ?? 0) * 100))}
          </p>
        </ConfirmModal>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Authorize a new API key for a provider group
// ---------------------------------------------------------------------------

/** Where the dialog is: opening a flow, holding one, waiting on an outcome, or reporting a failure. */
/**
 * `done` exists because the authorization happens in ANOTHER TAB. A toast fired at the moment
 * the poll sees the key would be announced to a window the user is not looking at, and by the
 * time they switch back it has faded — the outcome of the one step they left the app for is the
 * one thing they must not have to guess at. So the dialog stays put and says it instead, and is
 * dismissed deliberately.
 */
type OAuthPhase = "starting" | "ready" | "waiting" | "failed" | "done";

/** How often the redirect flow's outcome is asked for while the user is in the other tab. */
const OAUTH_POLL_MS = 2000;

/**
 * Mint a fresh group key for a provider group by authorizing in the browser: it is written as
 * the group's key, which every model without a key of its own uses.
 *
 * The dialog never handles the key, and never handles the PKCE verifier either: it opens a
 * flow, sends the user to the provider's page, and asks the server how that flow ended. Two
 * routes back — the provider redirects to the server (polled here), or, when that redirect
 * cannot reach the harness, the user carries a one-time code across by hand.
 */
function ModelOAuthDialog({
  projectId,
  provider,
  count,
  onClose,
  onApplied,
}: {
  projectId: string;
  provider: ModelProviderInfo;
  /** Models in the group with no key of their own: the ones that will use the new group key. */
  count: number;
  onClose: () => void;
  onApplied: (applied: number) => void;
}) {
  const [manual, setManual] = useState(false);
  const [phase, setPhase] = useState<OAuthPhase>("starting");
  const [flow, setFlow] = useState<{ flowId: string; authorizeUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  /** How many models use the group key the flow wrote — the sentence the `done` phase reports. */
  const [applied, setApplied] = useState(0);
  /** Bumped to reopen a flow after a failure; switching modes reopens one too (the URL differs). */
  const [attempt, setAttempt] = useState(0);
  // Latest-callback ref: the parent passes an inline arrow, and depending on its identity
  // would tear down and restart the poll interval on every render.
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  // A flow is opened as soon as the dialog shows, so the authorize URL is already in hand
  // when the button is pressed — window.open then runs inside that click's own user
  // activation, which is what keeps a popup blocker out of the way.
  useEffect(() => {
    let cancelled = false;
    setPhase("starting");
    setFlow(null);
    setError(null);
    setCode("");
    void (async () => {
      try {
        const res = await api.startModelOAuth(projectId, {
          provider: provider.id,
          mode: manual ? "manual" : "callback",
        });
        if (cancelled) return;
        setFlow(res);
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setError(apiErrorText(e));
        setPhase("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, provider.id, manual, attempt]);

  // Redirect mode: the outcome lands on the server, so this tab only learns of it by asking.
  // A flow that has expired answers 404, which reads the same as never coming back.
  useEffect(() => {
    if (phase !== "waiting" || manual || flow === null) return;
    let stopped = false;
    const tick = async (): Promise<void> => {
      try {
        const res = await api.getModelOAuthStatus(projectId, flow.flowId);
        if (stopped) return;
        if (res.status === "done") {
          // The server's own count, not the table in hand: `rows` is kept through a rejected
          // save so the user can fix and retry, so it can name models the server never wrote.
          const n = res.applied ?? count;
          setApplied(n);
          setPhase("done");
          onAppliedRef.current(n);
          return;
        }
        if (res.status === "error") {
          setError(res.error ? S.models.oauthErrors[res.error] : S.models.oauthTimedOut);
          setPhase("failed");
        }
      } catch {
        if (stopped) return;
        setError(S.models.oauthTimedOut);
        setPhase("failed");
      }
    };
    const timer = window.setInterval(() => void tick(), OAUTH_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase, manual, flow, projectId, count]);

  const openAuthorizePage = (): void => {
    if (flow === null) return;
    window.open(flow.authorizeUrl, "_blank", "noopener,noreferrer");
    if (!manual) setPhase("waiting");
  };

  const submitCode = async (): Promise<void> => {
    if (flow === null) return;
    setPhase("waiting");
    setError(null);
    try {
      const res = await api.submitModelOAuthCode(projectId, flow.flowId, code.trim());
      if (res.ok) {
        const n = res.applied ?? count;
        setApplied(n);
        setPhase("done");
        onAppliedRef.current(n);
        return;
      }
      setError(res.error ? S.models.oauthErrors[res.error] : S.models.oauthTimedOut);
      setPhase("failed");
    } catch (e) {
      setError(apiErrorText(e));
      setPhase("failed");
    }
  };

  const primary =
    phase === "failed" ? (
      <Button size="sm" variant="primary" onClick={() => setAttempt((n) => n + 1)}>
        {S.models.oauthRetry}
      </Button>
    ) : manual ? (
      <Button
        size="sm"
        variant="primary"
        disabled={flow === null || phase === "waiting" || !code.trim()}
        onClick={() => void submitCode()}
      >
        {S.models.oauthSubmitCode}
      </Button>
    ) : (
      <Button size="sm" variant="primary" disabled={flow === null} onClick={openAuthorizePage}>
        {S.models.oauthAuthorize}
      </Button>
    );

  return (
    <Modal
      open
      title={S.models.oauthTitle(provider.label)}
      onClose={onClose}
      footer={
        // Done is an outcome, not a choice: a "cancel" beside it would offer to undo a key that
        // is already written.
        phase === "done" ? (
          <Button size="sm" onClick={onClose}>
            {S.common.close}
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={onClose}>
              {S.common.cancel}
            </Button>
            {primary}
          </>
        )
      }
    >
      <div className="space-y-3">
        {phase === "done" ? (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {S.models.oauthAppliedBody(provider.label, applied)}
          </p>
        ) : (
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {S.models.oauthIntro(provider.label, count)}
          </p>
        )}
        {phase !== "done" && manual && (
          <>
            {/* In the dialog body, directly above the code Input: it takes the same rung the
                field does, not the page-level md. */}
            <Button size="sm" variant="ghost" disabled={flow === null} onClick={openAuthorizePage}>
              <GlyphIcon d={ICONS.signIn} size={13} />
              {S.models.oauthAuthorize}
            </Button>
            <Input
              size="sm"
              label={S.models.oauthCodeLabel}
              hint={S.models.oauthManualHint}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
          </>
        )}
        {phase === "waiting" && !manual && (
          <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <Spinner size="xs" label={S.common.loading} />
            {S.models.oauthWaiting}
          </p>
        )}
        {error !== null && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {phase !== "done" && (
          <Button variant="link" size="sm" onClick={() => setManual((v) => !v)}>
            {manual ? S.models.oauthCallbackSwitch : S.models.oauthManualSwitch}
          </Button>
        )}
      </div>
    </Modal>
  );
}
