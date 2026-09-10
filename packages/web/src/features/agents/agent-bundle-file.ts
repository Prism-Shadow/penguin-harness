/**
 * Picking and saving Agent bundles (`<agentId>-export.zip`, or a bare `penguin-agent.json`):
 * the porting side of the Agents page, apart from the snapshot helpers in snapshot-file.ts.
 */
import type { AgentBundleKind } from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";

/** Accept list for the bundle picker: the zip and the bare definition, with MIME types for pickers that map extensions to types. */
export const AGENT_BUNDLE_ACCEPT = ".zip,.json,application/zip,application/json";

/**
 * Agent-id suggestion from a bundle file name: `<agentId>-export.zip` or `<agentId>-docker.zip`
 * → `<agentId>`; a bare `penguin-agent.json` suggests nothing. Both export kinds are named
 * after the agent and both re-import, so both suffixes are recognized here.
 */
export function agentIdFromBundleName(fileName: string): string {
  const stem = fileName.replace(/\.(zip|json)$/i, "");
  if (stem === "penguin-agent") return "";
  return stem.replace(/-(export|docker)$/, "");
}

/**
 * Fetches the bundle and saves it through a temporary object-URL anchor, so a failed request
 * surfaces as a thrown ApiError instead of the error JSON landing on disk as the download
 * (the skills tab's export takes the same route for the same reason).
 */
export async function downloadAgentBundle(
  projectId: string,
  agentId: string,
  kind: AgentBundleKind = "api",
): Promise<void> {
  const res = await fetch(api.agentBundleUrl(projectId, agentId, kind));
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? S.common.unknownError,
    );
  }
  const url = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${agentId}-${kind === "docker" ? "docker" : "export"}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
