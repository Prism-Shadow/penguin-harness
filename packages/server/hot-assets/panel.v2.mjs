/**
 * Demo UI panel, v2: visibly different code (banner + shouted preview), same
 * state document. Booting it with v1's parked state proves the UI hot swap
 * keeps user state.
 */
export const panel = {
  name: "demo-panel",
  version: 2,
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
        { style: { border: "2px solid #7c3aed", borderRadius: 8, padding: 16 } },
        R.createElement(
          "div",
          { style: { fontWeight: 700, color: "#7c3aed", marginBottom: 8 } },
          "demo-panel v2 — hot swapped, state kept",
        ),
        R.createElement("input", {
          value: text,
          placeholder: "type something; it survives hot swaps",
          onChange: (e) => store.setState({ text: e.target.value }),
          style: { width: "100%", marginBottom: 8 },
        }),
        R.createElement("div", { style: { marginBottom: 8 } }, `shouting: ${text.toUpperCase()}`),
        R.createElement(
          "button",
          { onClick: () => store.setState({ clicks: store.getState().clicks + 1 }) },
          `clicked ${clicks} times (still counting)`,
        ),
      );
    };
    return {
      park: () => store.getState(),
      Component,
    };
  },
};
