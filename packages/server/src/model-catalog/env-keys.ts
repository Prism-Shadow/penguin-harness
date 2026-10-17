/**
 * The environment variable a row with no key reads, as the UI presents it (PRN-021): only with
 * no base URL on the row or its group, where core hands MMSP nothing and the routed client reads
 * its own pair. Core's effectiveConnection decides whether a row is handed nothing; this names
 * the variable for the server's `GET /models` preview, the machine sync's report, the web
 * dialogs' hints and the CLI's list, so none of them can disagree with what a Session does.
 */
import { effectiveConnection, mmspClient } from "@prismshadow/penguin-core/model-connection";
import type {
  ModelCredentialShape,
  ProviderConnectionShape,
} from "@prismshadow/penguin-core/model-connection";
import { isVendorGroup, providerInfo } from "./catalog.js";
import { resolveModelEnv } from "./routing.js";

/**
 * The variable a group's settings may present as covering a blank group key, or undefined —
 * the group dialog's hint. Only a group with no base URL has one: its rows are handed nothing
 * (core's effectiveConnection, `env`) and the routed client reads its own variable. That is the
 * group protocol's variable when it names one, else, for a first-party vendor group whose rows
 * route by id to the vendor's own client, the vendor's (isVendorGroup); nothing for a gateway,
 * custom, vLLM or user-defined group with no protocol.
 */
export function providerEnvFallbackKey(
  providerId: string,
  group: Pick<ProviderConnectionShape, "baseUrl" | "clientType"> | undefined,
): string | undefined {
  if (group?.baseUrl?.trim()) return undefined;
  const client = mmspClient(group?.clientType);
  if (client !== undefined) return `${client.env}_API_KEY`;
  return isVendorGroup(providerId) ? providerInfo(providerId)?.envKey : undefined;
}

/**
 * The variable a row with no key authenticates with, or undefined. Only with no base URL on the
 * row or its group (core's effectiveConnection, `apiKeySource === "env"`): the `*_API_KEY` the
 * client MMSP routes the row to reads (resolveModelEnv on the effective protocol, the id's
 * family otherwise). A row with a key in the file, or sent to a base URL from the file, gets
 * none. `entry` is the row's OWN values, key included, and `group` its `[providers.<id>]` table.
 *
 * The server's `GET /models` preview, the machine sync's report, the web dialog's hint and the
 * CLI's list read this, so they cannot disagree with what a Session gets.
 */
export function modelEnvPreviewKey(
  entry: ModelCredentialShape & { apiKey?: string | undefined },
  group: ProviderConnectionShape | undefined,
): string | undefined {
  const effective = effectiveConnection(entry, group);
  return effective.apiKeySource === "env"
    ? resolveModelEnv(entry.modelId, effective.clientType)?.envKey
    : undefined;
}
