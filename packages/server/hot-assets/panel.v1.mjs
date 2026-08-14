/**
 * Demo UI panel, v1 — the web platform bundle in miniature. Plain browser ESM
 * with zero imports: every dependency (react, zustand) is injected by the web
 * shell through `deps` — the seed-table mechanism from the proposal, in one
 * argument.
 *
 * Contract: `export const panel = { name, version, create(deps, state) }`;
 * create returns `{ park(), Component }`. `state` is the parked document of
 * the previous panel instance (or null on first boot) — hot swap = park →
 * import new code → create(deps, parkedState).
 */
export const panel = {
  name: "demo-panel",
  version: 1,
  create(deps, state) {
    const { react: R, createStore, useStore } = deps;
    const old = state !== null && typeof state === "object" ? state : {};
    const store = createStore(() => ({
      text: typeof old.text === "string" ? old.text : "",
      clicks: typeof old.clicks === "number" ? old.clicks : 0,
    }));
    const Component = () => {
      const text = useStore(store, (s) => s.text);
      const clicks = useStore(store, (s) => s.clicks);
      return R.createElement(
        "div",
        { style: { border: "1px solid #ccc", borderRadius: 8, padding: 16 } },
        R.createElement("div", { style: { fontWeight: 600, marginBottom: 8 } }, "demo-panel v1"),
        R.createElement("input", {
          value: text,
          placeholder: "type something; it survives hot swaps",
          onChange: (e) => store.setState({ text: e.target.value }),
          style: { width: "100%", marginBottom: 8 },
        }),
        R.createElement(
          "button",
          { onClick: () => store.setState({ clicks: store.getState().clicks + 1 }) },
          `clicked ${clicks} times`,
        ),
      );
    };
    return {
      park: () => store.getState(),
      Component,
    };
  },
};
