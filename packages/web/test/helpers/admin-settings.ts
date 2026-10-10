/**
 * A server behind the package's fetch fake ({@link stubFetch}) for the Settings dialog's suites:
 * the signed-in admin (`/api/me`) and the server-global settings (`/api/admin/settings`), which
 * a PUT merges into and echoes, the way the real route does. A test can refuse the next PUT
 * with {@link AdminSettingsServer.refuseNext}.
 */
import type { MeResponse, ServerSettings } from "@prismshadow/penguin-server/api";
import { apiError, json, stubFetch } from "./fetch";
import type { FakeFetch, FetchRequest } from "./fetch";

export const ADMIN_ME: MeResponse = {
  user: {
    userId: "admin",
    isAdmin: true,
    passwordIsInitial: false,
    createdAt: "2026-01-01T00:00:00Z",
  },
  previewIsolated: true,
  desktopMode: false,
  sessionVia: "password",
  uploadLimits: {
    attachmentMaxMb: 100,
    attachmentTotalMb: 120,
    attachmentMaxCount: 10,
    imageMaxMb: 5,
    attachmentLimitMinMb: 1,
    attachmentLimitMaxMb: 1024,
  },
  companyMode: true,
};

export const STORED_SETTINGS: ServerSettings = {
  proxyForApp: true,
  proxyForAgent: false,
  proxyUrl: "http://proxy.local:8080",
  attachmentMaxMb: 100,
  attachmentTotalMb: 120,
  companyMode: true,
  browserExtensionsEnabled: true,
  agentApiEnabled: true,
};

export interface AdminSettingsServer {
  fetch: FakeFetch;
  /** What the server holds now. */
  stored(): ServerSettings;
  /** The bodies of every settings PUT, oldest first. */
  puts(): unknown[];
  /** The next settings PUT answers this error instead of storing. */
  refuseNext(status: number, code: string): void;
}

export function adminSettingsServer(
  initial: ServerSettings = STORED_SETTINGS,
): AdminSettingsServer {
  let settings = { ...initial };
  let refusal: { status: number; code: string } | null = null;
  const answer = (request: FetchRequest): Response => {
    if (request.path === "/api/me") return json(ADMIN_ME);
    if (request.path === "/api/admin/settings/proxy-probe") return json({ targets: [] });
    if (request.path === "/api/admin/settings" && request.method === "GET") {
      return json({ settings });
    }
    if (request.path === "/api/admin/settings" && request.method === "PUT") {
      if (refusal !== null) {
        const { status, code } = refusal;
        refusal = null;
        return apiError(status, code);
      }
      const body = request.body as Partial<ServerSettings>;
      settings = {
        ...settings,
        ...body,
        // The server stores an address in its canonical form.
        ...(typeof body.proxyUrl === "string"
          ? {
              proxyUrl:
                body.proxyUrl.trim() === ""
                  ? null
                  : /^[a-z0-9]+:\/\//.test(body.proxyUrl.trim())
                    ? body.proxyUrl.trim()
                    : `http://${body.proxyUrl.trim()}`,
            }
          : {}),
      };
      return json({ settings });
    }
    return apiError(404, "not_found");
  };
  const fetch = stubFetch(answer);
  return {
    fetch,
    stored: () => settings,
    puts: () =>
      fetch.requests
        .filter((r) => r.path === "/api/admin/settings" && r.method === "PUT")
        .map((r) => r.body),
    refuseNext: (status, code) => {
      refusal = { status, code };
    },
  };
}
