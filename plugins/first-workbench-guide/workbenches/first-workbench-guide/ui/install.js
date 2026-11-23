export async function request(url, body) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(value?.error?.message ?? value?.error ?? "HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  return value;
}
export function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function install(guide, zip, api = request) {
  // The guide is served at .../workbenches/<guide>/ui/index.html, including on a machine.
  const workbenches = "../../";
  const inspect = async () => {
    const { workbenches: rows } = await api(
      "../../../workbenches?" + new URLSearchParams({ id: guide.boardId }),
    );
    return rows.find((row) => row.id === guide.boardId);
  };
  let loaded;
  try {
    ({ workbench: loaded } = await api(workbenches + "archive", zip));
  } catch (error) {
    if (error.status !== 409) throw error;
    loaded = await inspect();
  }
  if (loaded?.id !== guide.boardId || loaded.error || !loaded.tabs?.some((t) => t.key === "main"))
    throw Error(loaded?.error || "load-failed");
  const board = await api(workbenches + guide.boardId + "/api/board");
  if (board.id !== guide.boardId || board.title !== guide.design.title) throw Error("wrong-board");
}
export async function verify(guide, label, api = request) {
  const root = "../../" + guide.boardId + "/api/";
  const id = "test-" + token();
  const get = () => api(root + "board");
  const action = (op, fields) => api(root + "items", { op, id, ...fields });
  const initial = await get();
  if (initial.id !== guide.boardId || initial.title !== guide.design.title)
    throw Error("wrong-board");
  if (initial.items.some((i) => i.id === id)) throw Error("test-failed");
  try {
    await action("add", { task: label, group: label });
    const item = (await get()).items.find((i) => i.id === id);
    if (!item || item.done !== false || item.task !== label) throw Error("test-failed");
    await action("check", { done: true });
    if (!(await get()).items.some((i) => i.id === id && i.done === true))
      throw Error("test-failed");
  } finally {
    // A disconnected POST may have been committed; remove only this run's random test item.
    await action("remove", {});
  }
  if ((await get()).items.some((i) => i.id === id)) throw Error("test-failed");
}
export function appUrl(id, path = location.pathname) {
  const match = path.match(
    /^(.*?)\/(?:server\/([^/]+)\/)?api\/projects\/([^/]+)\/agents\/([^/]+)\/workbenches\/[^/]+\/ui\//,
  );
  if (!match) return null;
  return (
    match[1] +
    "/app/" +
    match[3] +
    "/" +
    match[4] +
    "/" +
    encodeURIComponent(id) +
    (match[2] ? "?machine=" + match[2] : "")
  );
}
