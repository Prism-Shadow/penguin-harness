/**
 * A group's settings — the gear at the end of every group header (owner only): the connection
 * the group holds once, in `[providers.<id>]`, which every model in it follows for each field it
 * leaves blank (the group key only where it reaches the model: core's groupKeyReaches). This is
 * also where the group key is set by hand.
 *
 * Three fields, in the model dialog's rhythm: the group key, the base URL, and the protocol as
 * the base URL field's in-field suffix menu, whose first row "Not set" sets none (a model with no
 * protocol of its own is then routed by its id; on custom and user-defined groups each model
 * keeps its own). Every group takes a protocol, Penguin Go and OpenCode Go included: a model's
 * own protocol always wins over its group's. The fields hold the file's values and nothing else:
 * the catalog only seeds a new Project's file and is never a fallback, so the dialog does not
 * quote it (Restore defaults puts the catalog's values back). Where the catalog names the
 * vendor's model list, a link to it closes the dialog's body.
 *
 * Saving sends the fields that changed and nothing else (`PUT …/models/providers/:id`), and never
 * probes the endpoint, with one exception: a custom or user-defined group given a base URL, left
 * on "Not set" and holding no model with a protocol of its own has nothing that decides how its
 * models are spoken to, so the endpoint is asked once first (a miss saves on Chat Completions, as
 * the model dialog does).
 *
 * Everything that decides what is shown and what is sent is a pure function below, so the rules
 * are checked without a DOM; the component only holds the draft and runs the requests.
 */
import { useRef, useState } from "react";
import type {
  ModelProtocolDetectRequest,
  ModelsResponse,
  ProviderConnectionDto,
  ProviderConnectionUpdate,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  Checkbox,
  FieldError,
  FieldLabel,
  Input,
  Link,
  Modal,
  PasswordInput,
  toastError,
  toastInfo,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import { providerEnvFallbackKey } from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { S } from "../../lib/strings";
import { protocolPathForModel } from "./protocol-path";
import { ProtocolSuffixMenu } from "./protocol-suffix";
import {
  DEFAULT_CUSTOM_CLIENT_TYPE,
  detectableBaseUrl,
  displayWidthCh,
  isCustomLikeGroup,
  isGenericProtocolClientType,
  protocolSelectorValue,
} from "./protocol-types";
import type { ProtocolClientType } from "./protocol-types";
import type { RowState } from "./models-page";

/** A group's row as this dialog reads it: what it stores of its own. */
type GroupRow = Pick<RowState, "clientType" | "originalBaseUrl">;

/** The dialog's fields as typed. */
export interface ProviderSettingsDraft {
  /** A new group key; empty keeps the stored one. */
  apiKey: string;
  /** The "clear the group key" box (only offered while one is stored). */
  clearApiKey: boolean;
  /** The group's base URL; empty means none (its models then use the client's default endpoint). */
  baseUrl: string;
  /** The group's protocol, or null for "Not set". */
  clientType: string | null;
}

/**
 * The protocol the picker shows checked: "Not set" (null) while the group sets none, the group's
 * pick from the generic trio, or — for a stored protocol outside the trio, written from the CLI —
 * that protocol itself, so the dialog never misstates the setting. Saving leaves such a value as
 * it is unless another row is picked (providerSettingsUpdate compares against what is stored).
 */
export function protocolChoice(
  draft: Pick<ProviderSettingsDraft, "clientType">,
): ProtocolClientType | string | null {
  if (draft.clientType === null) return null;
  return isGenericProtocolClientType(draft.clientType)
    ? protocolSelectorValue(draft.clientType)
    : draft.clientType;
}

/** The draft a group's stored connection opens as. */
export function initialDraft(group: ProviderConnectionDto | undefined): ProviderSettingsDraft {
  return {
    apiKey: "",
    clearApiKey: false,
    baseUrl: group?.baseUrl ?? "",
    clientType: group?.clientType?.trim() ? group.clientType : null,
  };
}

/**
 * What saving sends: the fields that differ from what the group stores, and no others — a base
 * URL or protocol cleared is sent as `null`, a key only when one was typed (or the clear box
 * ticked on a stored one). Null when nothing changed.
 */
export function providerSettingsUpdate(
  group: ProviderConnectionDto | undefined,
  draft: ProviderSettingsDraft,
): ProviderConnectionUpdate | null {
  const update: ProviderConnectionUpdate = {};
  const baseUrl = draft.baseUrl.trim();
  if (baseUrl !== (group?.baseUrl ?? "").trim()) update.baseUrl = baseUrl === "" ? null : baseUrl;
  const clientType = draft.clientType?.trim() || null;
  if (clientType !== (group?.clientType?.trim() || null)) update.clientType = clientType;
  const apiKey = draft.apiKey.trim();
  if (apiKey !== "") update.apiKey = apiKey;
  else if (draft.clearApiKey && group?.apiKeyMasked) update.clearApiKey = true;
  return Object.keys(update).length > 0 ? update : null;
}

/**
 * Whether the group's base URL is required: on custom and user-defined groups, whose models
 * speak a generic protocol to the user's own server, while some model in the group stores no
 * base URL of its own and would be left with the client's default endpoint.
 */
export function providerBaseUrlRequired(providerId: string, rows: readonly GroupRow[]): boolean {
  return isCustomLikeGroup(providerId) && rows.some((r) => r.originalBaseUrl.trim() === "");
}

/** Whether saving must be refused for a missing base URL (see providerBaseUrlRequired). */
export function providerBaseUrlMissing(
  providerId: string,
  rows: readonly GroupRow[],
  draft: Pick<ProviderSettingsDraft, "baseUrl">,
): boolean {
  return draft.baseUrl.trim() === "" && providerBaseUrlRequired(providerId, rows);
}

/**
 * Whether saving asks the endpoint for its protocol first: only where nothing else would decide
 * it — a custom or user-defined group, given a base URL, left on "Not set", with no model that
 * stores a protocol of its own. A protocol picked, a built-in group and a model's own protocol
 * all mean there is nothing to probe for.
 */
export function providerDetectOnSave(
  providerId: string,
  rows: readonly GroupRow[],
  draft: Pick<ProviderSettingsDraft, "baseUrl" | "clientType">,
): boolean {
  return (
    isCustomLikeGroup(providerId) &&
    draft.baseUrl.trim() !== "" &&
    draft.clientType === null &&
    !rows.some((r) => r.clientType.trim() !== "")
  );
}

/**
 * The detection request: the base URL in the field (or, left blank, the one the group stores),
 * the key typed, and the group — never a model, since this dialog has none, which is how the
 * server knows to back the probes with the GROUP key when no key is typed. Null when there is no
 * URL that could be probed: Detect then waits for one.
 */
export function providerDetectRequest(
  providerId: string,
  group: ProviderConnectionDto | undefined,
  draft: Pick<ProviderSettingsDraft, "apiKey" | "clearApiKey" | "baseUrl">,
): ModelProtocolDetectRequest | null {
  const baseUrl = draft.baseUrl.trim() || group?.baseUrl?.trim() || "";
  if (!detectableBaseUrl(baseUrl)) return null;
  const apiKey = draft.apiKey.trim();
  return {
    baseUrl,
    provider: providerId,
    ...(apiKey ? { apiKey } : draft.clearApiKey ? { clearApiKey: true } : {}),
  };
}

/**
 * The environment variable a blank group key would be covered by, or undefined: core's
 * providerEnvFallbackKey on the group as drafted (a first-party vendor group left on the
 * vendor's own endpoint and client, or a provider-scoped variable on the group's endpoint —
 * never a gateway, custom, vLLM or user-defined group), and a variable the server reported a
 * value for. Knowing a variable's name is not knowing it is set, so `detected` is what decides.
 */
export function groupEnvKey(
  providerId: string,
  draft: Pick<ProviderSettingsDraft, "baseUrl" | "clientType">,
  detected: ReadonlySet<string>,
): string | undefined {
  const envKey = providerEnvFallbackKey(providerId, {
    baseUrl: draft.baseUrl,
    clientType: draft.clientType ?? undefined,
  });
  return envKey !== undefined && detected.has(envKey) ? envKey : undefined;
}

export function ProviderSettingsDialog({
  projectId,
  provider,
  group,
  rows,
  detectedEnvKeys,
  onClose,
  onSaved,
}: {
  projectId: string;
  /** The group (synthesized for a user-defined one). */
  provider: ModelProviderInfo;
  /** What the group stores now; undefined for a group with no table yet. */
  group: ProviderConnectionDto | undefined;
  /** The group's models as stored. */
  rows: readonly GroupRow[];
  /** Env-fallback variables the server reported a value for (see the page's detectedEnvKeys). */
  detectedEnvKeys: ReadonlySet<string>;
  onClose: () => void;
  /** The table the server answered with, once the group's connection is written. */
  onSaved: (res: ModelsResponse) => void;
}) {
  const [draft, setDraft] = useState<ProviderSettingsDraft>(() => initialDraft(group));
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  /** Tints the protocol suffix amber after a probe that found nothing (its words go in a toast). */
  const [detectFailed, setDetectFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Run counter: a manual pick or an edited URL supersedes a probe still in flight. */
  const detectSeq = useRef(0);

  const id = provider.id;
  const customLike = isCustomLikeGroup(id);
  const envKey = group?.apiKeyMasked ? undefined : groupEnvKey(id, draft, detectedEnvKeys);
  const keyPlaceholder = group?.apiKeyMasked
    ? S.models.apiKeyKeepHint
    : envKey !== undefined
      ? S.models.apiKeyEnvHint(envKey)
      : undefined;
  const required = providerBaseUrlRequired(id, rows);

  const set = (patch: Partial<ProviderSettingsDraft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const choice = protocolChoice(draft);
  // The suffix reads the path the group's models will be sent to: the picked protocol's. "Not
  // set" names no path, since each model then decides (by its own protocol, or its id).
  const suffix =
    draft.clientType !== null
      ? protocolPathForModel("custom", draft.clientType)
      : S.models.protocolNone;
  // Detect needs a URL to probe: the field's, else the one the group stores.
  const detectable = providerDetectRequest(id, group, draft) !== null;

  /** One probe of the draft's endpoint; resolves to what it found, or null. */
  const detect = async (
    mode: "manual" | "save",
  ): Promise<{ clientType: string; baseUrl?: string } | null> => {
    const failed = () => {
      setDetectFailed(true);
      if (mode === "save") toastInfo(S.models.detectFellBack);
      else toastError(S.models.detectFailedBody);
    };
    const body = providerDetectRequest(id, group, draft);
    if (body === null) {
      failed();
      return null;
    }
    const seq = ++detectSeq.current;
    setDetecting(true);
    setDetectFailed(false);
    try {
      const res = await api.detectProtocol(projectId, body);
      if (seq !== detectSeq.current) return null;
      if (!res.detected) {
        failed();
        return null;
      }
      // The protocol may have answered on a tidied-up form of the URL; the field takes the one
      // that answered whenever it differs from what was probed.
      const served =
        res.baseUrl !== undefined && res.baseUrl !== body.baseUrl ? res.baseUrl : undefined;
      set({ clientType: res.detected, ...(served !== undefined ? { baseUrl: served } : {}) });
      return { clientType: res.detected, ...(served !== undefined ? { baseUrl: served } : {}) };
    } catch {
      if (seq === detectSeq.current) failed();
      return null;
    } finally {
      if (seq === detectSeq.current) setDetecting(false);
    }
  };

  const detectFromButton = async () => {
    const found = await detect("manual");
    if (found === null) return;
    const name = S.models.protocolNames[found.clientType] ?? found.clientType;
    toastSuccess(
      found.baseUrl === undefined
        ? S.models.detectedProtocol(name)
        : S.models.detectedProtocolAndUrl(name, found.baseUrl),
    );
  };

  const pickProtocol = (clientType: string | null) => {
    detectSeq.current++;
    setDetecting(false);
    setDetectFailed(false);
    set({ clientType });
  };

  const save = async () => {
    if (providerBaseUrlMissing(id, rows, draft)) {
      setBaseUrlError(S.models.baseUrlRequired);
      return;
    }
    let next = draft;
    if (providerDetectOnSave(id, rows, draft)) {
      const found = await detect("save");
      next = {
        ...draft,
        clientType: found?.clientType ?? DEFAULT_CUSTOM_CLIENT_TYPE,
        ...(found?.baseUrl !== undefined ? { baseUrl: found.baseUrl } : {}),
      };
    }
    const update = providerSettingsUpdate(group, next);
    if (update === null) {
      toastInfo(S.common.noChangesToSave);
      return;
    }
    setSaving(true);
    try {
      const res = await api.putProviderConnection(projectId, id, update);
      toastSuccess(S.common.saved);
      onSaved(res);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || detecting;
  return (
    <Modal
      open
      title={S.models.groupSettingsTitle(provider.label)}
      onClose={() => !saving && onClose()}
      // Wide enough for the longest catalog endpoint and its protocol path to read whole in
      // the base URL field (66 + 17 monospace columns, plus the suffix menu's chevron).
      widthClass="sm:max-w-3xl"
      footer={
        <>
          <Button size="sm" disabled={saving} onClick={onClose}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
            {detecting ? S.models.detecting : S.common.save}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* The group key. A <div>, not a <label>: PasswordInput brings its own, and the console
            link beside the title is a second interactive element. */}
        <div className="block">
          <span className="mb-1 flex items-baseline justify-between gap-2">
            <FieldLabel block={false}>{S.models.apiKey}</FieldLabel>
            {provider.apiKeyUrl && (
              <Link
                href={provider.apiKeyUrl}
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
            value={draft.apiKey}
            onChange={(e) => set({ apiKey: e.target.value, clearApiKey: false })}
            className="font-mono"
            autoComplete="off"
            autoFocus
            placeholder={keyPlaceholder}
          />
        </div>
        {envKey !== undefined && S.models.providerEnvNotes[id] && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {S.models.providerEnvNotes[id]}
          </p>
        )}
        {group?.apiKeyMasked && !draft.apiKey && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-mono">{group.apiKeyMasked}</span>
            {group.createdAt && (
              <span className="text-gray-400">
                {S.common.created} {formatDateTime(group.createdAt)}
              </span>
            )}
            <Checkbox
              checked={draft.clearApiKey}
              onChange={(on) => set({ clearApiKey: on })}
              label={S.models.clearGroupKey}
            />
          </div>
        )}

        {/* The base URL, with the detect action at its top-right and the protocol as its in-field
            suffix — the model dialog's idiom. A <div>: the suffix menu is a <button>. */}
        <div className="block">
          <span className="mb-1 flex items-baseline justify-between gap-2">
            <FieldLabel required={required} block={false}>
              {S.models.baseUrl}
            </FieldLabel>
            <Button
              variant="link"
              size="sm"
              loading={detecting}
              disabled={saving || !detectable}
              onClick={() => void detectFromButton()}
              title={detectable ? S.models.detectProtocolHint : S.models.detectNeedsBaseUrl}
              className="shrink-0"
            >
              {detecting ? S.models.detecting : S.models.detectProtocol}
            </Button>
          </span>
          <div className="relative">
            <Input
              size="sm"
              aria-label={S.models.baseUrl}
              required={required}
              value={draft.baseUrl}
              invalid={baseUrlError !== null}
              onChange={(e) => {
                // An edited URL retires the previous probe's verdict, which described the old one.
                detectSeq.current++;
                setDetecting(false);
                setDetectFailed(false);
                setBaseUrlError(null);
                set({ baseUrl: e.target.value });
              }}
              className="font-mono"
              style={{ paddingRight: `calc(${displayWidthCh(suffix)}ch + 2.25rem)` }}
              title={S.models.baseUrlSuffixTitle}
              placeholder={S.models.baseUrlNone}
            />
            <div className="absolute inset-y-0 right-1 flex items-center">
              <ProtocolSuffixMenu
                value={choice}
                path={suffix}
                detecting={detecting}
                tone={detectFailed ? "warn" : null}
                follow={{
                  label: S.models.protocolNone,
                  description: customLike
                    ? S.models.protocolEachModel
                    : S.models.protocolRoutedById,
                  onPick: () => pickProtocol(null),
                }}
                onPick={pickProtocol}
              />
            </div>
          </div>
          {baseUrlError !== null && <FieldError>{baseUrlError}</FieldError>}
        </div>

        {/* The vendor's model list, for picking what to add or checking an id: the group's own
            reference page, so it closes the body rather than sitting beside one field. */}
        {provider.modelsUrl && (
          <Link href={provider.modelsUrl} external variant="standalone" className="text-xs">
            {S.models.modelList}
          </Link>
        )}
      </div>
    </Modal>
  );
}
