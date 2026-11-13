/** Types for verify-windows-artifacts.mjs, which the release workflow runs and a typechecked test imports. */
export declare function verifyWindowsArtifacts(
  outDir?: string,
  options?: { requireSigning?: boolean },
): Promise<{
  installer: string;
  version: string;
  sha512: string;
  size: number;
  blockmap: "matched";
  reports: Array<{ status: number; path: string }>;
}>;
