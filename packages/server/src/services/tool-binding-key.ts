/**
 * The grammar of a tool-model binding key — the `[tools]` key a plugin declares and the models
 * table's `toolModels` carries: a short lowercase word, so the TOML key needs no quotes and reads
 * the same in the file, the slot and the API.
 */

/** A binding key's fault, or null when it is one. */
export function toolBindingKeyFault(key: string): string | null {
  return /^[a-z][a-z0-9-]{0,31}$/.test(key)
    ? null
    : `'${key.slice(0, 64)}' is not a binding key: [a-z][a-z0-9-]*, at most 32 characters`;
}
