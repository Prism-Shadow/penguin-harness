/**
 * Proxy options (admin only, server-global): two switches — "Application uses the proxy" (the
 * server's own outbound dispatcher) and "Agent environment uses the proxy" (command subprocess
 * environments) — sharing one proxy address.
 *
 * The page follows the settings commit model. Each switch writes the moment it is flipped, with
 * only its own value in the PUT, shows the new position at once and settles on the server's
 * answer; a refused write puts it back and says why in a toast. The address is a typed form: it
 * is written only by Save, which is live only while the address differs from the stored one,
 * and Reset puts the stored address back. Both switches act on the SAVED address, so while the
 * address has unsaved edits they are disabled with a hint to save it first — a flip must never
 * leave the user unsure which address it applied to. The server validates and normalizes the
 * address (bare "host:port" is stored as "http://host:port"); a rejected address renders inline
 * under the input, writes nothing, and the edit stays. Every write takes effect without a
 * restart.
 *
 * Settings hydrate when the section mounts — which is every time it is navigated to — and the
 * controls and Save stay disabled until they arrive. A saved response is adopted as the new
 * baseline, including the address in the exact form the server stored, so the page reflects
 * what is on the server rather than what was typed at it. Leaving the page, or the dialog, with
 * an unsaved address asks first (settings-dialog.tsx).
 *
 * The reachability test sits BELOW the save row, in its own block, because it measures the
 * SAVED configuration: only a PUT moves the server's outbound dispatcher, so a typed-but-unsaved
 * address is not in the path the probes travel. Reading top to bottom — edit, save, then
 * measure — is what makes that honest without a warning banner. Any write — a save or a flipped
 * switch — clears results that now describe a superseded configuration.
 *
 * One request per target, fired together and rendered as each lands. A single response carrying
 * all of them would hold every row blank until the slowest answered, which for a host that
 * black-holes connections is the full five-second timeout with five working results behind it.
 *
 * It carries its own busy flag rather than borrowing Save's: a measurement is not an unsaved
 * edit, so it neither blocks Save nor is blocked by it.
 *
 * The targets — name and exact URL — come from the server and are listed before anyone presses
 * the button, so the page shows concretely what will be requested and a reader can see that
 * these are plain unauthenticated GETs. A frontend copy of that list could drift from the URLs
 * the server really fetches, so it is fetched, not hard-coded.
 */
import { useEffect, useRef, useState } from "react";
import type {
  ProxyProbeDto,
  ProxyProbeProvider,
  ProxyProbeTargetDto,
  ServerSettings,
} from "@prismshadow/penguin-server/api";
import {
  Button,
  Input,
  PrefRow,
  SettingsGroup,
  SettingsSection,
  ToggleRow,
  toastError,
  toastSuccess,
  useFormDraft,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useInstantSetting } from "../../lib/instant-setting";
import { toneInk } from "../../lib/tone";
import { SETTINGS_SCOPE } from "../../lib/unsaved/scopes";

/** Brand names: identical in every locale, so they are keyed off the server's provider id rather than doubled into both dictionaries. */
const PROVIDER_LABEL: Record<ProxyProbeProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  // GLM's two hosts, named by the one each key comes from: the global endpoint the catalog
  // defaults to, and the mainland one a bigmodel.cn key needs.
  zai: "Z.AI",
  bigmodel: "BigModel",
};

export function ProxySection() {
  /** Stored settings as hydrated on mount (null until then): what the switches show, the address's baseline. */
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  /** The address form. Trimmed before comparing: Save sends it trimmed. */
  const address = useFormDraft(settings?.proxyUrl ?? "", {
    scope: SETTINGS_SCOPE,
    normalize: (value) => value.trim(),
  });
  /** Inline error under the address input (the server's invalid_proxy_url rejection). */
  const [addressError, setAddressError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** What the probe would request, listed before it is run (null until it arrives). */
  const [targets, setTargets] = useState<ProxyProbeTargetDto[] | null>(null);
  /** Results by provider (null until a run starts, then filled one at a time), and the probe's own busy flag. */
  const [results, setResults] = useState<Map<ProxyProbeProvider, ProxyProbeDto> | null>(null);
  const [probing, setProbing] = useState(false);
  /**
   * Which run each in-flight answer belongs to. A result can land after its run stopped being
   * the current one — a save adopts new settings mid-flight — and a row filled from a
   * superseded run would report a path nothing travelled.
   */
  const runSeq = useRef(0);

  /**
   * Adopt server-side truth. The address draft follows it only while it holds no edits of its
   * own (useFormDraft), so a switch flipped beside a half-typed address keeps the typing.
   */
  const adopt = (next: ServerSettings) => {
    setSettings(next);
    // Results describe the path they travelled; a write may have replaced it. Bumping the run
    // counter also discards whatever is still in flight against the old one.
    runSeq.current += 1;
    setResults(null);
    setProbing(false);
  };

  /** One switch, written alone: the PUT carries only its own field. */
  const forApp = useInstantSetting(settings?.proxyForApp ?? true, async (next) => {
    adopt((await api.adminPutSettings({ proxyForApp: next })).settings);
  });
  const forAgent = useInstantSetting(settings?.proxyForAgent ?? true, async (next) => {
    adopt((await api.adminPutSettings({ proxyForAgent: next })).settings);
  });

  useEffect(() => {
    let cancelled = false;
    void api
      .adminGetSettings()
      .then((res) => {
        if (!cancelled) adopt(res.settings);
      })
      .catch((e: unknown) => {
        // Controls stay disabled; leaving and returning to the section retries the fetch.
        if (!cancelled) toastError(apiErrorText(e));
      });
    // The target list is static server-side, so its failure is not worth a second toast on
    // top of the settings one — the block simply stays empty until a retry succeeds.
    void api
      .adminGetProxyProbeTargets()
      .then((res) => {
        if (!cancelled) setTargets(res.targets);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /** Writes the address alone; the stored (normalized) form comes back as the new baseline. */
  const save = async () => {
    if (settings === null || busy || !address.dirty) return;
    setBusy(true);
    setAddressError(null);
    try {
      const res = await api.adminPutSettings({ proxyUrl: address.draft });
      adopt(res.settings);
      address.adopt(res.settings.proxyUrl ?? "");
      toastSuccess(S.common.saved);
    } catch (e) {
      // The address is the only validated field: its rejection renders inline;
      // anything else (auth, network) is a generic failure toast. Either way the edit stays.
      if (e instanceof ApiError && e.code === "invalid_proxy_url") {
        setAddressError(apiErrorText(e));
      } else {
        toastError(apiErrorText(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const runProbe = () => {
    if (settings === null || targets === null || probing) return;
    const run = (runSeq.current += 1);
    setProbing(true);
    // The previous run's numbers go now rather than lingering under a running test: a stale
    // figure beside a live one cannot be told apart. An empty map, not null — null is "never
    // run", and the rows read it to tell "not tested" from "still measuring".
    setResults(new Map());
    // One toast per run, not one per target: a lost session fails every request identically,
    // and six copies of the same sentence is not six pieces of information.
    let reported = false;
    void Promise.allSettled(
      targets.map((t) =>
        api
          .adminProbeProxy(t.provider)
          .then((res) => {
            if (runSeq.current !== run) return;
            setResults((prev) => new Map(prev ?? []).set(res.probe.provider, res.probe));
          })
          .catch((e: unknown) => {
            // Every outcome the probe itself can have, reachable or not, comes back inside a
            // 200; only the request failing (a lost session, a dead server) lands here.
            if (runSeq.current !== run || reported) return;
            reported = true;
            toastError(apiErrorText(e));
          }),
      ),
    ).finally(() => {
      if (runSeq.current === run) setProbing(false);
    });
  };

  const hydrated = settings !== null;
  // The switches act on the saved address: with edits pending they wait for Save.
  const switchesHeld = !hydrated || address.dirty || forApp.busy || forAgent.busy;
  const heldHint = address.dirty ? { hint: S.settings.saveProxyAddressFirst } : {};

  return (
    <>
      <SettingsSection
        actions={
          <>
            <Button
              size="sm"
              disabled={!address.dirty || busy}
              onClick={() => {
                address.reset();
                setAddressError(null);
              }}
            >
              {S.common.reset}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!hydrated || !address.dirty || busy}
              onClick={() => void save()}
            >
              {S.common.save}
            </Button>
          </>
        }
      >
        <SettingsGroup>
          <ToggleRow
            label={S.settings.proxyForApp}
            {...heldHint}
            checked={forApp.value}
            onChange={(next) => void forApp.set(next)}
            disabled={switchesHeld}
          />
          <ToggleRow
            label={S.settings.proxyForAgent}
            {...heldHint}
            checked={forAgent.value}
            onChange={(next) => void forAgent.set(next)}
            disabled={switchesHeld}
          />
          {/* The error stands under the box, inside the control's column; the row keeps its
              title on the first line. */}
          <PrefRow label={S.settings.proxyAddress}>
            <div className="w-64 min-w-0">
              <Input
                aria-label={S.settings.proxyAddress}
                size="sm"
                value={address.draft}
                placeholder={S.settings.proxyAddressPlaceholder}
                disabled={!hydrated}
                {...(addressError !== null ? { error: addressError } : {})}
                onChange={(e) => {
                  address.setDraft(e.target.value);
                  if (addressError !== null) setAddressError(null);
                }}
              />
            </div>
          </PrefRow>
        </SettingsGroup>
      </SettingsSection>
      <section className="mt-6">
        <SettingsGroup>
          <PrefRow label={S.settings.proxyProbe}>
            <Button
              size="sm"
              disabled={!hydrated || targets === null || probing}
              aria-busy={probing}
              onClick={runProbe}
            >
              {probing ? S.settings.proxyProbeRunning : S.settings.proxyProbeRun}
            </Button>
          </PrefRow>
        </SettingsGroup>
        <ul className="mt-3 space-y-3">
          {(targets ?? []).map((t) => {
            // This row's own answer, shown the moment it exists — the rows still waiting keep
            // saying so beside it. Checked on `probe.outcome` itself rather than through a
            // boolean, so the failure branch narrows to the kinds the dictionary has a word for.
            const probe = results?.get(t.provider);
            const outcomeText =
              probe !== undefined
                ? probe.outcome === "reachable"
                  ? S.settings.proxyProbeLatency(probe.ms)
                  : S.settings.proxyProbeFailure[probe.outcome]
                : probing
                  ? S.settings.proxyProbeRunning
                  : S.settings.proxyProbeIdle;
            const reachable = probe !== undefined && probe.outcome === "reachable";
            return (
              <li key={t.provider}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {PROVIDER_LABEL[t.provider]}
                  </span>
                  <span
                    className={`shrink-0 text-xs tabular-nums ${
                      probe === undefined
                        ? // No verdict yet: secondary text, not a status tone — an absence
                          // is not a judgement about the target.
                          "text-gray-500 dark:text-gray-400"
                        : reachable
                          ? toneInk.success
                          : toneInk.danger
                    }`}
                  >
                    {outcomeText}
                    {/* A bare number does not say "reachable"; the word travels with it for
                        anyone who cannot see the colour. */}
                    {reachable && (
                      <span className="sr-only"> · {S.settings.proxyProbeReachableState}</span>
                    )}
                  </span>
                </div>
                <div className="truncate font-mono text-xs text-gray-400 dark:text-gray-500">
                  {t.url}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
