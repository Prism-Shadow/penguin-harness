import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";
import { definition } from "./definition.js";

type Item = { id: string; group: string; task: string; doneWhen: string; done: boolean };
export default {
  modules: {
    Workbench: {
      create({ use: { host } }) {
        let queue: Promise<unknown> = Promise.resolve();
        const read = (): Item[] =>
          (host.getState() as Item[] | null) ??
          definition.items.map((item, i) => ({ ...item, id: "initial-" + i, done: false }));
        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                const board = () => ({ id: definition.id, title: definition.title, items: read() });
                if (req.path === "/board" && req.method === "GET") return { body: board() };
                if (req.path !== "/items" || req.method !== "POST") return { status: 404 };
                const update = async (): Promise<WorkbenchResponse> => {
                  const action = req.body as {
                    op?: string;
                    id?: string;
                    task?: string;
                    done?: boolean;
                    group?: string;
                  } | null;
                  if (
                    !action ||
                    typeof action.id !== "string" ||
                    !/^[a-z0-9-]{1,80}$/.test(action.id)
                  )
                    return { status: 400 };
                  const items = read(),
                    index = items.findIndex((i) => i.id === action.id);
                  let next: Item[];
                  if (action.op === "add") {
                    if (
                      typeof action.task !== "string" ||
                      !action.task.trim() ||
                      action.task.length > 180 ||
                      typeof action.group !== "string" ||
                      !action.group.trim() ||
                      action.group.length > 60
                    )
                      return { status: 400 };
                    if (index >= 0) return { status: 409 };
                    next = [
                      ...items,
                      {
                        id: action.id,
                        task: action.task.trim(),
                        group: action.group.trim(),
                        doneWhen: "",
                        done: false,
                      },
                    ];
                  } else if (action.op === "remove") {
                    next = items.filter((i) => i.id !== action.id);
                  } else if (action.op === "check" && typeof action.done === "boolean") {
                    if (index < 0) return { status: 404 };
                    next = items.map((item, i) =>
                      i === index ? { ...item, done: action.done! } : item,
                    );
                  } else return { status: 400 };
                  await host.setState(next);
                  return { body: board() };
                };
                const result = queue.then(update);
                queue = result.catch(() => undefined);
                return result;
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
