declare module "safe-regex" {
  /**
   * True when the pattern's worst-case running time stays linear in the input — no
   * catastrophic backtracking (nested or ambiguous quantifiers). A static shape read of
   * the pattern, not an engine: it runs once, at config parse, and refuses a rule whose
   * `match` it distrusts rather than letting one hang a fetch later.
   */
  function safeRegex(re: RegExp | string): boolean;
  export = safeRegex;
}
