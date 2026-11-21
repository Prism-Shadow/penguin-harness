/** Types for library-payload.mjs, which the server's typechecked tests import. */
export declare function libraryPayload(repoRoot: string): Promise<{
  entries: { rel: string; abs: string; exec: boolean }[];
  names: string[];
  cleanup: () => Promise<void>;
}>;
