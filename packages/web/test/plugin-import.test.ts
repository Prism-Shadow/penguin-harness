/**
 * The plugin import flows' pure half (features/plugins/plugin-import): the client-side size
 * guard, the optional plugin-name field, the name a failed import is about, and the code → copy
 * mapping.
 *
 * What matters is agreement with the SERVER rather than these functions' own arithmetic. The
 * size guard exists only to save a user a pointless upload, so it must draw the line exactly
 * where the server does (`>` the cap, not `>=`) — a stricter client silently blocks a legal
 * file, a looser one replaces a clear refusal with a 413 after a long base64 upload. The name
 * field is the same kind of agreement on a different rule: what it holds back is a request the
 * server would answer 400 for, and what it must NOT hold back is the empty field, which is how
 * the archive gets to name the plugin. The name and the message both feed a confirmation the
 * user reads before overwriting a plugin directory, so a miss there either names the wrong
 * plugin or asks in English.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/client";
import { MB_BYTES } from "../src/lib/upload-limits";
import { S } from "../src/lib/strings";
import {
  PLUGIN_NAME_PATTERN,
  PLUGIN_ZIP_LIMIT_MB,
  pluginImportErrorText,
  pluginNameBody,
  pluginNameFromError,
  pluginNameFromUrl,
  pluginNameInvalid,
  pluginZipTooLarge,
} from "../src/features/plugins/plugin-import";

describe("pluginZipTooLarge", () => {
  it("refuses one byte over the cap and accepts a zip of exactly the cap", () => {
    // The server's check is `bytes.length > limit`, so the boundary file is legal; pinning both
    // sides is the point, since an off-by-one here would be invisible in normal use and would
    // reject exactly the archive a user just repacked to fit.
    expect(pluginZipTooLarge(PLUGIN_ZIP_LIMIT_MB * MB_BYTES)).toBe(false);
    expect(pluginZipTooLarge(PLUGIN_ZIP_LIMIT_MB * MB_BYTES + 1)).toBe(true);
    expect(pluginZipTooLarge(0)).toBe(false);
  });
});

describe("pluginNameFromUrl", () => {
  it("names the repository of a GitHub repo URL, a trailing .git included", () => {
    expect(pluginNameFromUrl("https://github.com/acme/my-plugin")).toBe("my-plugin");
    expect(pluginNameFromUrl("https://github.com/acme/my-plugin.git")).toBe("my-plugin");
  });

  it("names the plugin root a tree URL points at, not the ref in front of it", () => {
    // The plugin is the SUBDIRECTORY (the shallowest one carrying plugin.json), and the ref
    // names a commit: the confirmation used to name the commit whenever the paste was of a
    // directory rather than a whole repo.
    expect(pluginNameFromUrl("https://github.com/acme/mono/tree/main/plugins/review")).toBe(
      "review",
    );
    expect(pluginNameFromUrl("https://github.com/acme/mono/tree/main/skills/a/b/c")).toBe("c");
    // No subdirectory at all: the URL still has to name something, and the repo is what it
    // carries.
    expect(pluginNameFromUrl("https://github.com/acme/mono/tree/main")).toBe("mono");
  });

  it("names the file a plain link points at, and is unmoved by a query, a fragment or a trailing slash", () => {
    expect(pluginNameFromUrl("https://example.com/downloads/web-design.zip")).toBe("web-design");
    // What a browser address bar hands back: a token, an anchor, or the slash copy-paste adds.
    expect(pluginNameFromUrl("https://example.com/x.zip?token=abc#frag")).toBe("x");
    expect(pluginNameFromUrl("https://github.com/acme/my-plugin/")).toBe("my-plugin");
  });
});

describe("pluginNameInvalid", () => {
  it("accepts the empty field — the name is optional — and every name the rule allows", () => {
    // Empty is the normal case (the archive names the plugin), so holding it to the rule would
    // block precisely the import that never needed a name.
    expect(pluginNameInvalid("")).toBe(false);
    expect(pluginNameInvalid("   ")).toBe(false);
    expect(pluginNameInvalid("web-design")).toBe(false);
    expect(pluginNameInvalid("web_design2")).toBe(false);
    // The surrounding blanks are the user's typing, not a name: they are trimmed before the check
    // rather than reported as a broken one.
    expect(pluginNameInvalid("  web-design  ")).toBe(false);
  });

  it("rejects what the server would answer 400 for, so the submit never earns that 400", () => {
    // The name IS the directory the plugin is installed into, so a space, a dot, a slash or a
    // non-ASCII character is a 400 on the route — and has to be an inline message here instead.
    for (const name of ["web design", "web.design", "a/b", "a\\b", "插件", "web-design!"]) {
      expect(pluginNameInvalid(name), name).toBe(true);
    }
  });

  it("pins the pattern the inline message quotes", () => {
    // The copy spells the rule out (^[A-Za-z0-9_-]+$) for a user who wants to see it; this keeps
    // the quotation honest.
    expect(PLUGIN_NAME_PATTERN.source).toBe("^[A-Za-z0-9_-]+$");
  });
});

describe("pluginNameBody", () => {
  it("omits the field entirely when the box is empty, so the server names the plugin itself", () => {
    // Never `name: ""`: the server reads an absent name as "name it after the archive" and an
    // empty one as a name that breaks the rule — the exact 400 this field exists to keep away.
    expect(pluginNameBody("")).toEqual({});
    expect("name" in pluginNameBody("   ")).toBe(false);
  });

  it("sends the typed name, trimmed", () => {
    expect(pluginNameBody("  web-design ")).toEqual({ name: "web-design" });
  });
});

describe("pluginNameFromError", () => {
  it("reads the name out of the 409's own sentence", () => {
    // The wording the plugin routes answer with today, quoted from the route itself rather than
    // invented: the confirmation names a plugin the user is about to overwrite, and a wrong
    // name there is worse than no confirmation at all.
    const err = new ApiError(
      409,
      "plugin_exists",
      "A user plugin named web-design is already installed.",
    );
    expect(pluginNameFromError(err, "fallback")).toBe("web-design");
  });

  it("also reads the tail form the skill and hook imports parse", () => {
    const err = new ApiError(409, "plugin_exists", "Plugin is already installed: web-design");
    expect(pluginNameFromError(err, "fallback")).toBe("web-design");
  });

  it("falls back to the caller's own name when the message names nothing", () => {
    // A reworded server message must not leave the confirmation nameless; the picked file's
    // stem (or the name the URL spells) is what the caller passes.
    expect(pluginNameFromError(new ApiError(409, "plugin_exists", "conflict"), "picked")).toBe(
      "picked",
    );
    expect(pluginNameFromError(new Error("boom"), "picked")).toBe("picked");
  });
});

describe("pluginImportErrorText", () => {
  /** The codes the upload, download and delete routes answer with for anything a user can fix. */
  const CODES = [
    "plugin_exists",
    "plugin_builtin",
    "unsupported_url",
    "blocked_url",
    "download_failed",
    "invalid_plugin",
    "plugin_too_large",
  ];

  it("localizes every code the routes answer with, instead of showing the server's English message", () => {
    for (const code of CODES) {
      const text = pluginImportErrorText(new ApiError(400, code, "An English server message."));
      expect(text, code).toBe((S.plugins.importErrors as Record<string, string>)[code]);
      expect(text, code).not.toBe("An English server message.");
      expect(text.length, code).toBeGreaterThan(0);
    }
  });

  it("leaves codes it does not name to the shared mapping, and unknown failures to the generic text", () => {
    expect(pluginImportErrorText(new ApiError(403, "admin_required", "Admin only."))).toBe(
      (S.errors.byCode as Record<string, string>).admin_required,
    );
    expect(pluginImportErrorText(new Error("boom"))).toBe(S.common.unknownError);
  });

  it("maps the 413 the upload route answers for an over-size zip just as it maps the download one", () => {
    // Both import routes answer `plugin_too_large` from the same cap, so the one code → copy row
    // covers both — this pins the UPLOAD flow, whose over-size refusal used to arrive as
    // `bad_request` (a code with no copy of its own, so it showed the server's English sentence).
    // The mapping is keyed by code rather than by route or status, which is what makes that hold.
    const text = pluginImportErrorText(
      new ApiError(413, "plugin_too_large", "The archive exceeds the 14MB limit."),
    );
    expect(text).toBe((S.plugins.importErrors as Record<string, string>).plugin_too_large);
    expect(text).not.toBe("The archive exceeds the 14MB limit.");
  });

  it("leaves bad_request to the server's own sentence", () => {
    // The upload route's remaining refusals are bad_requests whose sentence is about the request
    // in hand ("The zip archive is empty."), which says more than any generic line could — so the
    // code deliberately stays out of both tables.
    expect(
      pluginImportErrorText(new ApiError(400, "bad_request", "The zip archive is empty.")),
    ).toBe("The zip archive is empty.");
  });
});
