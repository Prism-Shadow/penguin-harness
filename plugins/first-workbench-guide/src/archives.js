import { strToU8, zipSync } from "fflate";
import handler from "./templates/index.ts?raw";
import page from "./templates/page.html?raw";
import client from "./templates/board.js?raw";
import style from "./templates/board.css?raw";
import license from "../LICENSE?raw";
const json = (value) => JSON.stringify(value, null, 2) + "\n";

export function archive(guide, kind) {
  const id = guide.boardId,
    design = guide.design;
  const pkg = {
    name: id,
    version: "1.0.0",
    type: "module",
    penguin: {
      version: "2026.11.22.1",
      appCenter: { show: true, title: design.title },
      modules: [
        {
          name: "Workbench",
          requires: { host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" } },
          provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
          contributes: {
            "WebModule.sessionTabs": [
              {
                id: id + ".main",
                key: "main",
                title: design.title,
                renderer: { iframe: { src: "ui/index.html" } },
              },
            ],
          },
        },
      ],
    },
  };
  const workbench = {
    "package.json": json(pkg),
    "index.ts": handler,
    "definition.ts": "export const definition = " + json({ id, ...design }) + ";",
    "ui/index.html": page,
    "ui/board.js": client,
    "ui/style.css": style,
  };
  let files = workbench;
  if (kind === "plugin") {
    const table = {
      ifaces: {},
      types: {},
      modules: {
        ChecklistPlugin: {
          name: "ChecklistPlugin",
          kind: "component",
          requires: {},
          provides: {},
          children: [],
          contributes: {
            "PluginLibraryModule.cards": [
              { id: id + ".card", title: design.title, category: "utilities", preinstall: false },
            ],
            "PluginLibraryModule.workbenches": [
              { id: id + ".workbench", name: id, path: "workbenches/" + id },
            ],
          },
        },
      },
      plugin: { modules: ["ChecklistPlugin"], replaces: [] },
    };
    files = {
      "package.json": json({
        name: id,
        version: "1.0.0",
        description: design.title,
        license: "Apache-2.0",
        keywords: ["penguin-plugin", "workbench"],
      }),
      "ifaces.json": json(table),
      LICENSE: license,
      ...Object.fromEntries(
        Object.entries(workbench).map(([name, source]) => [
          "workbenches/" + id + "/" + name,
          source,
        ]),
      ),
    };
  }
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, source]) => [name, strToU8(source)])),
  );
}
