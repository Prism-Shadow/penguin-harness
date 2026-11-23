/** Serve the same installed HTML, assets and SDK by URL in dev and on the static site. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, posix } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { pageSdkFile } from "../../../../server/src/workbenches/page-sdk";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const apps = [
  ["default_agent", "slides", "use-bento-slides"],
  ["default_agent", "images", "multimodal-tools"],
  ["penguin_support", "support", "penguin-support"],
] as const;
const modelControl = join(root, "plugins/use-bento-slides/workbenches/slides/ui/model-control.tsx");
const png = join(root, "packages/desktop/build/icons/256x256.png");
const css = join(root, "packages/web/public/workbench-ui.css");

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
    for (const [agent, id, plugin] of apps) {
      const dest = api + "/agents/" + agent + "/workbenches/" + id;
      const dir = join(root, "plugins", plugin, "workbenches", id, "ui");
      files.set(
        dest + "/sdk/amsp.js",
        "export * from " + JSON.stringify(base + prefix + "/amsp.js"),
      );
      files.set(dest + "/sdk/workbench.js", (await pageSdkFile("workbench.js")).body);
      for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || entry.name.endsWith(".tsx")) continue;
        const path = join(entry.parentPath, entry.name);
        const name = relative(dir, path).split("\\").join("/");
        const body = readFileSync(path);
        let content: string | Uint8Array = name.endsWith(".css")
          ? body
              .toString()
              .replaceAll(
                'url("/workbench-ui.css")',
                'url("' + base + prefix + '/workbench-ui.css")',
              )
          : body;
        if (name === "index.html") {
          const document = body
            .toString()
            .replace(/<link\b[^>]*\bhref="\/workbench-ui\.css"[^>]*>/g, "")
            .replace(/ (href|src)="([^"#]+)"/g, (attribute: string, key: string, path: string) => {
              if (path.startsWith("/") || /^[a-z]+:/i.test(path)) return attribute;
              return " " + key + '="' + base + posix.join(dest, "ui", path) + '"';
            });
          content = document.replace(
            "<head>",
            '<head><link rel="stylesheet" data-workbench-base href="' +
              base +
              prefix +
              '/workbench-ui.css"><script src="' +
              base +
              prefix +
              '/workbench-requests.js"></script>',
          );
        }
        files.set(dest + "/ui/" + name, content);
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
