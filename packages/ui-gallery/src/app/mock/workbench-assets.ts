/** Serve the same installed HTML, assets and SDK by URL in dev and on the static site. */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { EARLY_SUPPORT } from "./workbench-revisions";
import { pageSdkFile } from "../../../../server/src/workbenches/page-sdk";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const shipped = (plugin: string, id: string) =>
  join(root, "plugins", plugin, "workbenches", id, "ui");
/** The pinned Self-Evolution Workbench's built page, through the package's `./workbenches/*` export. */
const rsiWorkbenchUi = dirname(
  createRequire(import.meta.url).resolve(
    "@penguinharness/rsi-workbench/workbenches/benchmark/ui/index.html",
  ),
);
const apps = [
  ["default_agent", "slides", shipped("use-bento-slides", "slides")],
  ["default_agent", "images", shipped("multimodal-tools", "images")],
  ["default_agent", "benchmark", rsiWorkbenchUi],
  ["penguin_support", "support", shipped("penguin-support", "support")],
] as const;
const modelControl = join(root, "plugins/use-bento-slides/workbenches/slides/ui/model-control.tsx");
const png = join(root, "packages/desktop/build/icons/256x256.png");
const css = join(root, "packages/web/public/workbench-ui.css");

/** Keep the document beside its ordinary API mount, even when it uses a historical asset set. */
function addPages(
  files: Map<string, string | Uint8Array>,
  dir: string,
  assetDir: string,
  entryPage: string,
  base: string,
  prefix: string,
) {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith(".tsx")) continue;
    const path = join(entry.parentPath, entry.name);
    const name = relative(dir, path).split("\\").join("/");
    const body = readFileSync(path);
    let content: string | Uint8Array = name.endsWith(".css")
      ? body
          .toString()
          .replaceAll('url("/workbench-ui.css")', 'url("' + base + prefix + '/workbench-ui.css")')
      : body;
    if (name === "index.html") {
      const document = body
        .toString()
        .replace(/<link\b[^>]*\bhref="\/workbench-ui\.css"[^>]*>/g, "")
        .replace(/ (href|src)="([^"#]+)"/g, (attribute: string, key: string, path: string) => {
          if (path.startsWith("/") || /^[a-z]+:/i.test(path)) return attribute;
          return " " + key + '="' + base + posix.join(assetDir, path) + '"';
        });
      // A page that links the shared components' stylesheet gets no base stylesheet, as in the
      // app (lib/workbench-theme.ts): its unlayered rules would beat the components' layered ones.
      const baseSheet = /<link\b[^>]*\bdata-penguin-ui\b/.test(document)
        ? ""
        : '<link rel="stylesheet" data-workbench-base href="' +
          base +
          prefix +
          '/workbench-ui.css">';
      content = document.replace(
        "<head>",
        "<head>" +
          baseSheet +
          '<script src="' +
          base +
          prefix +
          '/workbench-requests.js"></script>',
      );
    }
    files.set(name === "index.html" ? entryPage : assetDir + "/" + name, content);
  }
}

async function assets(base: string, modelUrl: string) {
  const files = new Map<string, string | Uint8Array>();
  const prefix = "demo-workbenches";
  files.set(prefix + "/amsp.js", (await pageSdkFile("amsp.js")).body);
  files.set(prefix + "/workbench-ui.css", readFileSync(css));
  files.set(
    prefix + "/workbench-requests.js",
    readFileSync(new URL("./workbench-requests.js", import.meta.url)),
  );
  for (const machine of ["", "/server/gpu-box-a8f3c2"]) {
    const api = prefix + machine + "/api/projects/demo";
    files.set(
      api + "/multimodal-tools/sessions/image-example/files/penguin.png",
      readFileSync(png),
    );
    for (const [agent, id, dir] of apps) {
      const dest = api + "/agents/" + agent + "/workbenches/" + id;
      files.set(
        dest + "/sdk/amsp.js",
        "export * from " + JSON.stringify(base + prefix + "/amsp.js"),
      );
      files.set(dest + "/sdk/workbench.js", (await pageSdkFile("workbench.js")).body);
      const ui = dest + "/ui";
      addPages(files, dir, ui, ui + "/index.html", base, prefix);
      if (id === "support") {
        addPages(
          files,
          join(
            root,
            "packages/ui-gallery/fixtures/workbench-history/support-" + EARLY_SUPPORT.revision,
          ),
          ui + "/history/" + EARLY_SUPPORT.revision,
          ui + "/history-" + EARLY_SUPPORT.revision + ".html",
          base,
          prefix,
        );
      }
      if (id === "slides")
        files.set(dest + "/ui/model-control.js", "export * from " + JSON.stringify(modelUrl));
    }
  }
  return files;
}

const mime: Record<string, string> = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  json: "application/json",
  txt: "text/plain",
};
export function workbenchAssets(): Plugin {
  let base = "/";
  let control = "";
  return {
    name: "penguin:gallery-workbench-assets",
    configResolved(config) {
      base = config.base;
    },
    buildStart() {
      if (this.meta.watchMode) return;
      control = this.emitFile({ type: "chunk", id: modelControl });
    },
    async generateBundle() {
      for (const [fileName, source] of await assets(base, base + this.getFileName(control)))
        this.emitFile({ type: "asset", fileName, source });
    },
    async configureServer(server) {
      const files = await assets(base, base + "@fs/" + modelControl);
      server.middlewares.use((req, res, next) => {
        const name = new URL(req.url ?? "/", "http://gallery.invalid").pathname.slice(base.length);
        const content = files.get(name);
        if (content === undefined) return next();
        res.setHeader("Content-Type", mime[name.split(".").pop()!] ?? "application/octet-stream");
        res.end(content);
      });
    },
  };
}
