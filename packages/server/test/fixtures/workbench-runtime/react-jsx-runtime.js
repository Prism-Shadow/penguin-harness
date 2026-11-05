export function jsx(type, props, key) {
  return { type, props, key: key ?? null };
}
export const jsxs = jsx;
